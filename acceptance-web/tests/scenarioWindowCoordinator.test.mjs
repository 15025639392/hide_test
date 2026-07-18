import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRangeRelation,
  coordinateScenarioProposals,
  normalizeScenarioProposal,
  rangesOverlap
} from '../src/track-cleaning/scenarioWindowCoordinator.mjs';

function proposal(id, scenario, start, end, overrides = {}) {
  return {
    id,
    scenario,
    rawRange: {
      startRawPointId: start,
      endRawPointId: end
    },
    influenceRange: {
      startRawPointId: start,
      endRawPointId: end
    },
    metricRange: {
      startRawPointId: start,
      endRawPointId: end
    },
    confidence: 0.8,
    action: 'test',
    localRebuild: 'test',
    ...overrides
  };
}

test('classifyRangeRelation separates adjacent, nested, equal and partial ranges', () => {
  assert.equal(classifyRangeRelation(range(1, 10), range(11, 20)), 'adjacent');
  assert.equal(classifyRangeRelation(range(1, 10), range(12, 20)), 'disjoint');
  assert.equal(classifyRangeRelation(range(1, 10), range(3, 5)), 'nested');
  assert.equal(classifyRangeRelation(range(1, 10), range(1, 10)), 'equal');
  assert.equal(classifyRangeRelation(range(1, 10), range(8, 15)), 'partial');
  assert.equal(rangesOverlap(range(1, 10), range(11, 20)), false);
  assert.equal(rangesOverlap(range(1, 10), range(10, 20)), true);
});

test('coordinateScenarioProposals allows diagnostic windows to overlap metric owners', () => {
  const plan = coordinateScenarioProposals([
    proposal('route-1', 'dense_main_route_settlement', 10, 40),
    proposal('intent-1', 'dense_area_intent', 10, 40, {
      metricOwner: false
    })
  ]);

  assert.deepEqual(plan.activeProposals.map((item) => item.id), ['route-1']);
  assert.deepEqual(plan.contextProposals.map((item) => item.id), ['intent-1']);
  assert.equal(plan.contextProposals[0].coordinatorState, 'context_only');
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.ownership.map((item) => item.proposalId), ['route-1']);
});

test('coordinateScenarioProposals allows disjoint metric gates to overlap', () => {
  const plan = coordinateScenarioProposals([
    proposal('route-1', 'dense_main_route_settlement', 1, 30, {
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }),
    proposal('pressure-1', 'pressure_jump', 1, 1, {
      hardBoundary: true,
      affectedMetricGates: ['elevation']
    })
  ], {
    firstRawPointId: 1,
    currentRawPointId: 30
  });

  assert.deepEqual(plan.activeProposals.map((item) => item.id), [
    'pressure-1',
    'route-1'
  ]);
  assert.deepEqual(plan.contextProposals, []);
  assert.deepEqual(plan.rejectedProposals, []);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.ownership.map((item) => ({
    proposalId: item.proposalId,
    range: item.metricRange,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      proposalId: 'pressure-1',
      range: range(1, 1),
      affectedMetricGates: ['elevation']
    },
    {
      proposalId: 'route-1',
      range: range(1, 30),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);
  assert.deepEqual(plan.commitPlan.metricOwnershipRanges.map((item) => ({
    proposalId: item.proposalId,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      proposalId: 'route-1',
      range: range(1, 30),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    },
    {
      proposalId: 'pressure-1',
      range: range(1, 1),
      affectedMetricGates: ['elevation']
    }
  ]);
});

test('coordinateScenarioProposals splits broad proposals at hard boundaries', () => {
  const plan = coordinateScenarioProposals([
    proposal('round-trip-1', 'same_road_round_trip', 1, 100, {
      confidence: 0.95
    }),
    proposal('gap-1', 'gap_recovery_boundary', 48, 52, {
      hardBoundary: true,
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    })
  ]);

  assert.deepEqual(plan.activeProposals.map((item) => item.id), [
    'gap-1',
    'round-trip-1:remaining:1-47',
    'round-trip-1:remaining:53-100'
  ]);
  assert.deepEqual(plan.contextProposals.map((item) => item.id), ['round-trip-1']);
  assert.deepEqual(plan.rejectedProposals, []);
  assert.equal(plan.contextProposals[0].coordinatorState, 'hard_boundary_parent_split');
  assert.equal(plan.conflicts[0].resolution, 'split_at_hard_boundary');
  assert.deepEqual(plan.ownership.map((item) => ({
    proposalId: item.proposalId,
    range: item.metricRange
  })), [
    { proposalId: 'gap-1', range: range(48, 52) },
    { proposalId: 'round-trip-1:remaining:1-47', range: range(1, 47) },
    { proposalId: 'round-trip-1:remaining:53-100', range: range(53, 100) }
  ]);
  assertNoOwnershipOverlap(plan.ownership);
});

test('coordinateScenarioProposals splits a broad parent around nested child owners', () => {
  const plan = coordinateScenarioProposals([
    proposal('dense-1', 'dense_main_route_settlement', 1, 100, {
      confidence: 0.9
    }),
    proposal('spike-1', 'moving_spike_cleanup', 44, 46, {
      confidence: 0.7
    })
  ]);

  assert.deepEqual(plan.activeProposals.map((item) => item.id), [
    'spike-1',
    'dense-1:remaining:1-43',
    'dense-1:remaining:47-100'
  ]);
  assert.deepEqual(plan.contextProposals.map((item) => item.id), ['dense-1']);
  assert.equal(plan.contextProposals[0].coordinatorState, 'nested_parent_split');
  assert.equal(plan.conflicts[0].relation, 'nested');
  assert.equal(plan.conflicts[0].resolution, 'split_parent_remaining');
  assert.deepEqual(plan.ownership.map((item) => ({
    proposalId: item.proposalId,
    range: item.metricRange
  })), [
    { proposalId: 'spike-1', range: range(44, 46) },
    { proposalId: 'dense-1:remaining:1-43', range: range(1, 43) },
    { proposalId: 'dense-1:remaining:47-100', range: range(47, 100) }
  ]);
  assertNoOwnershipOverlap(plan.ownership);
});

test('coordinateScenarioProposals splits a parent around multiple nested owners', () => {
  const plan = coordinateScenarioProposals([
    proposal('route-1', 'dense_main_route_settlement', 1, 100),
    proposal('spike-1', 'moving_spike_cleanup', 20, 22),
    proposal('spike-2', 'moving_spike_cleanup', 50, 51, {
      confidence: 0.7
    })
  ]);

  assert.deepEqual(plan.activeProposals.map((item) => item.id), [
    'spike-1',
    'spike-2',
    'route-1:remaining:1-19',
    'route-1:remaining:23-49',
    'route-1:remaining:52-100'
  ]);
  assert.deepEqual(plan.contextProposals.map((item) => item.id), ['route-1']);
  assert.deepEqual(plan.conflicts.map((item) => item.resolution), [
    'split_parent_remaining',
    'split_parent_remaining'
  ]);
  assertNoOwnershipOverlap(plan.ownership);
});

test('coordinateScenarioProposals resolves equal ranges deterministically by confidence', () => {
  const lower = proposal('rest-low', 'rest_photo_micro_move', 20, 35, {
    confidence: 0.5
  });
  const higher = proposal('rest-high', 'rest_photo_micro_move', 20, 35, {
    confidence: 0.9
  });
  const forward = coordinateScenarioProposals([lower, higher]);
  const reverse = coordinateScenarioProposals([higher, lower]);

  assert.deepEqual(forward.activeProposals.map((item) => item.id), ['rest-high']);
  assert.deepEqual(reverse.activeProposals.map((item) => item.id), ['rest-high']);
  assert.deepEqual(forward.contextProposals.map((item) => item.id), ['rest-low']);
  assert.deepEqual(reverse.contextProposals.map((item) => item.id), ['rest-low']);
  assert.equal(forward.conflicts[0].relation, 'equal');
});

test('coordinateScenarioProposals de-overlaps competing moving spikes like batch instead of deadlocking', () => {
  // 复现批处理会去重叠、流式却死锁的两个重叠单点尖刺(对应 fixture 的
  // moving-spike:417-422-425 vs 390-417-422)。批处理按几何分数(detour*2+lateral)保留
  // 高分者、丢弃重叠者;修复前流式把它们判为 partial→conservative_fallback,钉住 watermark
  // 冻结提交游标并在 finish 丢弃该段。修复后应保留高分者、丢弃低分者,且不再冻结。
  const winner = proposal('moving-spike:417-422-425', 'moving_spike_cleanup', 417, 425, {
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    evidence: { detourMeters: 12.04, lateralMeters: 7.35, reportedSpeedMetersPerSecond: 0.89 }
  });
  const loser = proposal('moving-spike:390-417-422', 'moving_spike_cleanup', 390, 422, {
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    evidence: { detourMeters: 11.07, lateralMeters: 6.16, reportedSpeedMetersPerSecond: 0 }
  });

  // 顺序不应影响结果:高分者永远胜出。
  for (const proposals of [[winner, loser], [loser, winner]]) {
    const plan = coordinateScenarioProposals(proposals, {
      firstRawPointId: 390,
      currentRawPointId: 500,
      lookaheadRawPoints: 0
    });

    assert.deepEqual(plan.activeProposals.map((item) => item.id), ['moving-spike:417-422-425']);
    assert.deepEqual(plan.rejectedProposals.map((item) => item.id), ['moving-spike:390-417-422']);
    assert.equal(plan.rejectedProposals[0].coordinatorState, 'moving_spike_overlap_superseded');
    assert.equal(plan.rejectedProposals[0].blockedByProposalId, 'moving-spike:417-422-425');
    // 关键:不再产生 conservative_fallback 冲突,提交不被冻结。
    assert.equal(plan.conflicts.some((conflict) =>
      conflict.resolution === 'conservative_fallback'), false);
    assert.equal(plan.commitPlan.status, 'committable');
  }
});

test('coordinateScenarioProposals rejects unresolved partial metric-owner conflicts', () => {
  const plan = coordinateScenarioProposals([
    proposal('rest-1', 'rest_photo_micro_move', 10, 30),
    proposal('route-1', 'round_trip_line', 20, 45)
  ], {
    currentRawPointId: 80,
    lookaheadRawPoints: 10
  });

  assert.deepEqual(plan.activeProposals.map((item) => item.id), ['rest-1']);
  assert.deepEqual(plan.rejectedProposals.map((item) => item.id), ['route-1']);
  assert.equal(plan.rejectedProposals[0].coordinatorState, 'metric_owner_conflict');
  assert.equal(plan.conflicts[0].relation, 'partial');
  assert.deepEqual(plan.conflicts[0].overlappingMetricGates, [
    'route',
    'distance',
    'moving_time',
    'elevation'
  ]);
  assert.equal(plan.conflicts[0].resolution, 'conservative_fallback');
  assert.equal(plan.commitWatermark, 20);
});

test('coordinateScenarioProposals force-settles blocked conflicts on finish', () => {
  // 数据流终结（finish=true）后不会再有 lookahead 改变已闭合的 conservative_fallback
  // 冲突，若仍让它钉住 watermark 会把冲突点之后的整条尾巴丢弃（真实文件里表现为流式
  // 只提交前半段）。finish 时强制结算：blocker 保持 active、被挡提案保持 rejected，
  // watermark 推进到 currentRawPointId，尾巴不再丢。
  const base = [
    proposal('rest-1', 'rest_photo_micro_move', 10, 30),
    proposal('route-1', 'round_trip_line', 20, 45)
  ];

  const blocked = coordinateScenarioProposals(base, {
    currentRawPointId: 80,
    lookaheadRawPoints: 10
  });
  assert.equal(blocked.commitPlan.status, 'blocked_at_watermark');

  const settled = coordinateScenarioProposals(base, {
    currentRawPointId: 80,
    lookaheadRawPoints: 0,
    finish: true
  });
  // 冲突仍被记录（诊断可见），但不再产出阻塞区间、也不再拉回 watermark。
  assert.equal(settled.conflicts[0].relation, 'partial');
  assert.deepEqual(settled.activeProposals.map((item) => item.id), ['rest-1']);
  assert.deepEqual(settled.rejectedProposals.map((item) => item.id), ['route-1']);
  assert.equal(settled.commitPlan.status, 'committable');
  assert.deepEqual(settled.commitPlan.blockingRanges, []);
  assert.equal(settled.commitPlan.endRawPointId, 80);
});

test('coordinateScenarioProposals still blocks overlaps on the same metric gate', () => {
  const plan = coordinateScenarioProposals([
    proposal('rest-1', 'rest_photo_micro_move', 10, 30, {
      affectedMetricGates: ['distance']
    }),
    proposal('route-1', 'round_trip_line', 20, 45, {
      affectedMetricGates: ['distance', 'moving_time']
    })
  ], {
    currentRawPointId: 80,
    lookaheadRawPoints: 10
  });

  assert.deepEqual(plan.activeProposals.map((item) => item.id), ['rest-1']);
  assert.deepEqual(plan.rejectedProposals.map((item) => item.id), ['route-1']);
  assert.equal(plan.conflicts[0].relation, 'partial');
  assert.deepEqual(plan.conflicts[0].overlappingMetricGates, ['distance']);
  assert.equal(plan.commitPlan.status, 'blocked_at_watermark');
});

test('coordinateScenarioProposals uses open metric windows as the commit watermark', () => {
  const plan = coordinateScenarioProposals([
    proposal('route-1', 'dense_main_route_settlement', 40, 80)
  ], {
    firstRawPointId: 1,
    currentRawPointId: 120,
    lookaheadRawPoints: 10,
    openWindows: [
      {
        id: 'diagnostic',
        metricOwner: false,
        influenceRange: range(1, 10)
      },
      {
        id: 'stationary-open',
        metricOwner: true,
        influenceRange: range(30, 60),
        affectedMetricGates: ['route', 'distance', 'moving_time']
      }
    ]
  });

  assert.equal(plan.commitWatermark, 30);
  assert.equal(plan.commitPlan.status, 'blocked_at_watermark');
  assert.deepEqual(plan.commitPlan.committableRanges, [
    {
      type: 'normal',
      range: {
        startRawPointId: 1,
        endRawPointId: 29
      }
    }
  ]);
  assert.deepEqual(plan.commitPlan.blockingRanges.map((item) => ({
    type: item.type,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'open_window',
      range: range(30, 60),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);
  assert.equal(plan.unresolvedMetricOwnerCount, 1);
});

test('coordinateScenarioProposals partitions committable ranges at active hard boundaries', () => {
  const plan = coordinateScenarioProposals([
    proposal('gap-1', 'gap_recovery_boundary', 10, 10, {
      hardBoundary: true,
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    }),
    proposal('transport-1', 'transport_contamination', 20, 22, {
      hardBoundary: true,
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    })
  ], {
    firstRawPointId: 1,
    currentRawPointId: 30
  });

  assert.equal(plan.commitPlan.status, 'committable');
  assert.deepEqual(plan.commitPlan.hardBoundaries.map((item) => item.proposalId), [
    'gap-1',
    'transport-1'
  ]);
  assert.deepEqual(plan.commitPlan.committableRanges.map((item) => ({
    type: item.type,
    scenario: item.scenario,
    range: item.range
  })), [
    { type: 'normal', scenario: undefined, range: range(1, 9) },
    { type: 'hard_boundary', scenario: 'gap_recovery_boundary', range: range(10, 10) },
    { type: 'normal', scenario: undefined, range: range(11, 19) },
    { type: 'hard_boundary', scenario: 'transport_contamination', range: range(20, 22) },
    { type: 'normal', scenario: undefined, range: range(23, 30) }
  ]);
});

test('coordinateScenarioProposals stops committable ranges before unresolved conflicts', () => {
  const plan = coordinateScenarioProposals([
    proposal('rest-1', 'rest_photo_micro_move', 10, 30),
    proposal('route-1', 'round_trip_line', 20, 45)
  ], {
    firstRawPointId: 1,
    currentRawPointId: 80,
    lookaheadRawPoints: 10
  });

  assert.equal(plan.commitPlan.status, 'blocked_at_watermark');
  assert.equal(plan.commitPlan.commitWatermark, 20);
  assert.deepEqual(plan.commitPlan.blockingRanges.map((item) => ({
    type: item.type,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'unresolved_conflict',
      range: range(20, 30),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(plan.commitPlan.committableRanges, [
    {
      type: 'normal',
      range: range(1, 19)
    }
  ]);
});

test('normalizeScenarioProposal rejects incomplete proposals and fills neutral defaults', () => {
  assert.equal(normalizeScenarioProposal(null), null);
  assert.equal(normalizeScenarioProposal({ id: 'missing-range' }), null);

  const normalized = normalizeScenarioProposal(proposal('p1', 'closed_loop_round_trip', 5, 9, {
    metricOwner: false
  }));

  assert.equal(normalized.id, 'p1');
  assert.equal(normalized.priority, 90);
  assert.equal(normalized.metricOwner, false);
  assert.deepEqual(normalized.metricRange, range(5, 9));
});

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function assertNoOwnershipOverlap(ownership) {
  const sorted = ownership
    .map((item) => item.metricRange)
    .sort((a, b) => a.startRawPointId - b.startRawPointId
      || a.endRawPointId - b.endRawPointId);
  for (let index = 1; index < sorted.length; index++) {
    assert.ok(sorted[index - 1].endRawPointId < sorted[index].startRawPointId,
      `ownership ranges overlap: ${JSON.stringify(sorted)}`);
  }
}

// 正确性回归：commit watermark 必须被“最早的”阻塞点拉住。当同时存在
// 一个更晚的 open window 和一个更早的未解决冲突时，watermark 不能只看 open
// window 而把未解决冲突区间提交出去（否则破坏“已提交不回改”不变量）。
test('coordinateScenarioProposals holds commit watermark at the earliest unresolved conflict even with a later open window', () => {
  const result = coordinateScenarioProposals([
    proposal('owner-A', 'dense_area_intent', 50, 70, {
      affectedMetricGates: ['distance'],
      confidence: 0.9
    }),
    proposal('owner-B', 'dense_area_intent', 60, 90, {
      affectedMetricGates: ['distance'],
      confidence: 0.8
    })
  ], {
    committedCursorRawPointId: 0,
    openWindows: [{
      id: 'ow-late',
      metricOwner: true,
      influenceRange: range(100, 120)
    }]
  });

  // 两个 partial 重叠的 metricOwner 会产生一个 conservative_fallback 冲突，交集 [60,70]。
  const unresolved = result.conflicts.filter(
    (conflict) => conflict.resolution === 'conservative_fallback');
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].range.startRawPointId, 60);

  const { commitPlan } = result;
  // watermark 必须取 open window(100) 与未解决冲突(60) 起点的较小值。
  assert.equal(commitPlan.commitWatermark, 60);
  // 未解决冲突区间 [60,70] 不得落入可提交段。
  assert.ok(commitPlan.endRawPointId < 60,
    `unresolved conflict must not be committed; endRawPointId=${commitPlan.endRawPointId}`);
  const coversConflict = commitPlan.committableRanges.some((entry) =>
    entry.range
      && entry.range.startRawPointId <= 60
      && entry.range.endRawPointId >= 60);
  assert.ok(!coversConflict,
    'committableRanges must not cover the unresolved conflict start (60)');
});
