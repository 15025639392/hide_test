import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceStreamingScenarioSettlementSession,
  createStreamingScenarioSettlementSession
} from '../src/streamingScenarioSettlementSession.mjs';

test('streaming scenario session commits normal batches incrementally', () => {
  const session = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 10
    }
  );

  assert.equal(session.settlementState.committedCursorRawPointId, 10);
  assert.deepEqual(session.settlementState.committedRanges.map((item) => item.range), [
    range(1, 10)
  ]);
  assert.equal(session.pendingProposals.length, 0);
  assert.equal(session.lastSettlementPlan.commitPlan.status, 'committable');
});

test('streaming scenario session blocks at an open window and resumes after close', () => {
  const first = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 10
    }
  );
  const blocked = advanceStreamingScenarioSettlementSession(first, {
    currentRawPointId: 30,
    openWindows: [
      {
        id: 'stationary-open',
        metricOwner: true,
        influenceRange: range(15, 40),
        affectedMetricGates: ['route', 'distance', 'moving_time']
      }
    ]
  });

  assert.equal(blocked.settlementState.committedCursorRawPointId, 14);
  assert.deepEqual(blocked.settlementState.lastAppliedRanges.map((item) => item.range), [
    range(11, 14)
  ]);
  assert.deepEqual(blocked.settlementState.blockingRanges.map((item) => ({
    type: item.type,
    id: item.id,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'open_window',
      id: 'stationary-open',
      range: range(15, 40),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);

  const resumed = advanceStreamingScenarioSettlementSession(blocked, {
    currentRawPointId: 50,
    openWindows: [],
    closedProposals: [
      proposal('stationary-1', 'stationary_drift_collapse', 15, 40)
    ]
  });

  assert.equal(resumed.settlementState.committedCursorRawPointId, 50);
  assert.deepEqual(resumed.settlementState.lastAppliedRanges.map((item) => item.range), [
    range(15, 50)
  ]);
  assert.deepEqual(resumed.settlementState.blockingRanges, []);
  assert.deepEqual(resumed.lastSettlementPlan.activeProposals.map((item) => item.id), [
    'stationary-1'
  ]);
  assert.equal(resumed.pendingProposals.length, 0);
});

test('streaming scenario session persists hard-boundary checkpoints across batches', () => {
  const first = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 12
    }
  );
  const blocked = advanceStreamingScenarioSettlementSession(first, {
    currentRawPointId: 25,
    openWindows: [
      {
        id: 'transport-open',
        metricOwner: true,
        influenceRange: range(18, 22)
      }
    ]
  });
  const settled = advanceStreamingScenarioSettlementSession(blocked, {
    currentRawPointId: 30,
    openWindows: [],
    closedProposals: [
      proposal('transport-1', 'transport_contamination', 18, 22, {
        hardBoundary: true,
        affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
      })
    ]
  });

  assert.equal(blocked.settlementState.committedCursorRawPointId, 17);
  assert.equal(settled.settlementState.committedCursorRawPointId, 30);
  assert.deepEqual(settled.settlementState.lastAppliedRanges.map((item) => ({
    type: item.type,
    scenario: item.scenario,
    range: item.range
  })), [
    { type: 'hard_boundary', scenario: 'transport_contamination', range: range(18, 22) },
    { type: 'normal', scenario: null, range: range(23, 30) }
  ]);
  assert.deepEqual(settled.settlementState.hardBoundaryCheckpoints.map((item) => ({
    proposalId: item.proposalId,
    scenario: item.scenario,
    range: item.range
  })), [
    {
      proposalId: 'transport-1',
      scenario: 'transport_contamination',
      range: range(18, 22)
    }
  ]);
});

test('streaming scenario session retains unresolved overlaps until a proposal is retired', () => {
  const blocked = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 80,
      lookaheadRawPoints: 0,
      closedProposals: [
        proposal('rest-1', 'rest_photo_micro_move', 10, 30),
        proposal('route-1', 'round_trip_line', 20, 45)
      ]
    }
  );

  assert.equal(blocked.settlementState.committedCursorRawPointId, 19);
  assert.equal(blocked.lastSettlementPlan.commitPlan.status, 'blocked_at_watermark');
  assert.deepEqual(blocked.pendingProposals.map((item) => item.id), ['rest-1', 'route-1']);

  const resolved = advanceStreamingScenarioSettlementSession(blocked, {
    currentRawPointId: 80,
    retiredProposalIds: ['route-1']
  });

  assert.equal(resolved.settlementState.committedCursorRawPointId, 80);
  assert.deepEqual(resolved.settlementState.blockingRanges, []);
  assert.deepEqual(resolved.lastSettlementPlan.activeProposals.map((item) => item.id), [
    'rest-1'
  ]);
  assert.equal(resolved.pendingProposals.length, 0);
});

test('streaming scenario session commits split parent ownership around nested cleanup', () => {
  const session = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 100,
      closedProposals: [
        proposal('route-1', 'dense_main_route_settlement', 1, 100),
        proposal('spike-1', 'moving_spike_cleanup', 44, 46)
      ]
    }
  );

  assert.equal(session.settlementState.committedCursorRawPointId, 100);
  assert.deepEqual(session.lastSettlementPlan.activeProposals.map((item) => ({
    id: item.id,
    state: item.coordinatorState,
    range: item.metricRange
  })), [
    { id: 'spike-1', state: 'active', range: range(44, 46) },
    { id: 'route-1:remaining:1-43', state: 'active_split', range: range(1, 43) },
    { id: 'route-1:remaining:47-100', state: 'active_split', range: range(47, 100) }
  ]);
  assert.deepEqual(session.lastSettlementPlan.contextProposals.map((item) => ({
    id: item.id,
    state: item.coordinatorState
  })), [
    { id: 'route-1', state: 'nested_parent_split' }
  ]);
  assert.equal(session.lastSettlementPlan.commitPlan.status, 'committable');
  assert.deepEqual(session.settlementState.committedMetricOwnershipRanges.map((item) => ({
    type: item.type,
    proposalId: item.proposalId,
    parentProposalId: item.parentProposalId,
    range: item.range
  })), [
    {
      type: 'scenario_owner',
      proposalId: 'route-1:remaining:1-43',
      parentProposalId: 'route-1',
      range: range(1, 43)
    },
    {
      type: 'scenario_owner',
      proposalId: 'spike-1',
      parentProposalId: null,
      range: range(44, 46)
    },
    {
      type: 'scenario_owner',
      proposalId: 'route-1:remaining:47-100',
      parentProposalId: 'route-1',
      range: range(47, 100)
    }
  ]);
  assert.equal(session.pendingProposals.length, 0);
});

test('streaming scenario session keeps parent ownership on both sides of hard boundary', () => {
  const session = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 30,
      closedProposals: [
        proposal('route-1', 'same_road_round_trip', 1, 30),
        proposal('gap-1', 'gap_recovery_boundary', 12, 12, {
          hardBoundary: true,
          affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
        })
      ]
    }
  );

  assert.equal(session.settlementState.committedCursorRawPointId, 30);
  assert.deepEqual(session.lastSettlementPlan.activeProposals.map((item) => ({
    id: item.id,
    state: item.coordinatorState,
    range: item.metricRange
  })), [
    { id: 'gap-1', state: 'active', range: range(12, 12) },
    { id: 'route-1:remaining:1-11', state: 'active_split', range: range(1, 11) },
    { id: 'route-1:remaining:13-30', state: 'active_split', range: range(13, 30) }
  ]);
  assert.deepEqual(session.lastSettlementPlan.contextProposals.map((item) => ({
    id: item.id,
    state: item.coordinatorState
  })), [
    { id: 'route-1', state: 'hard_boundary_parent_split' }
  ]);
  assert.deepEqual(session.settlementState.hardBoundaryCheckpoints.map((item) => ({
    proposalId: item.proposalId,
    range: item.range
  })), [
    { proposalId: 'gap-1', range: range(12, 12) }
  ]);
  assert.deepEqual(session.settlementState.committedMetricOwnershipRanges.map((item) => ({
    type: item.type,
    proposalId: item.proposalId,
    parentProposalId: item.parentProposalId,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'scenario_owner',
      proposalId: 'route-1:remaining:1-11',
      parentProposalId: 'route-1',
      range: range(1, 11),
      affectedMetricGates: []
    },
    {
      type: 'hard_boundary',
      proposalId: 'gap-1',
      parentProposalId: null,
      range: range(12, 12),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    },
    {
      type: 'scenario_owner',
      proposalId: 'route-1:remaining:13-30',
      parentProposalId: 'route-1',
      range: range(13, 30),
      affectedMetricGates: []
    }
  ]);
});

test('streaming scenario session commits overlapping ownership only across disjoint metric gates', () => {
  const session = advanceStreamingScenarioSettlementSession(
    createStreamingScenarioSettlementSession(),
    {
      firstRawPointId: 1,
      currentRawPointId: 30,
      closedProposals: [
        proposal('route-1', 'dense_main_route_settlement', 1, 30, {
          affectedMetricGates: ['route', 'distance', 'moving_time']
        }),
        proposal('pressure-1', 'pressure_jump', 1, 1, {
          hardBoundary: true,
          affectedMetricGates: ['elevation']
        })
      ]
    }
  );

  assert.equal(session.settlementState.committedCursorRawPointId, 30);
  assert.deepEqual(session.lastSettlementPlan.conflicts, []);
  assert.deepEqual(session.settlementState.committedMetricOwnershipRanges.map((item) => ({
    type: item.type,
    proposalId: item.proposalId,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'scenario_owner',
      proposalId: 'route-1',
      range: range(1, 30),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    },
    {
      type: 'hard_boundary',
      proposalId: 'pressure-1',
      range: range(1, 1),
      affectedMetricGates: ['elevation']
    }
  ]);
});

function proposal(id, scenario, startRawPointId, endRawPointId, overrides = {}) {
  return {
    id,
    scenario,
    rawRange: range(startRawPointId, endRawPointId),
    influenceRange: range(startRawPointId, endRawPointId),
    metricRange: range(startRawPointId, endRawPointId),
    confidence: 0.8,
    action: 'test',
    localRebuild: 'test',
    ...overrides
  };
}

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}
