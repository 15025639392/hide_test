import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCommitPlanToStreamingState,
  createStreamingSettlementState,
  exportStreamingSettlementStateContract,
  streamingSettlementSnapshot
} from '../src/streamingSettlementState.mjs';

test('applyCommitPlanToStreamingState advances cursor through normal and hard-boundary ranges', () => {
  const state = applyCommitPlanToStreamingState(createStreamingSettlementState(), {
    status: 'committable',
    commitWatermark: 30,
    blockingRanges: [],
    committableRanges: [
      { type: 'normal', range: range(1, 9) },
      {
        type: 'hard_boundary',
        proposalId: 'gap-1',
        scenario: 'gap_recovery_boundary',
        range: range(10, 10),
        affectedMetricGates: ['distance', 'moving_time', 'elevation']
      },
      { type: 'normal', range: range(11, 30) }
    ],
    metricOwnershipRanges: [
      { type: 'base_kernel', range: range(1, 9) },
      {
        type: 'hard_boundary',
        proposalId: 'gap-1',
        scenario: 'gap_recovery_boundary',
        range: range(10, 10),
        hardBoundary: true,
        affectedMetricGates: ['distance', 'moving_time', 'elevation']
      },
      { type: 'base_kernel', range: range(11, 30) }
    ]
  });

  assert.equal(state.committedCursorRawPointId, 30);
  assert.equal(state.commitSequence, 3);
  assert.equal(state.lastCommitPlanStatus, 'committable');
  assert.equal(state.lastCommitWatermark, 30);
  assert.deepEqual(state.committedRanges.map((item) => item.range), [
    range(1, 9),
    range(10, 10),
    range(11, 30)
  ]);
  assert.deepEqual(state.hardBoundaryCheckpoints, [
    {
      proposalId: 'gap-1',
      scenario: 'gap_recovery_boundary',
      range: range(10, 10),
      affectedMetricGates: ['distance', 'moving_time', 'elevation'],
      commitSequence: 2
    }
  ]);
  assert.deepEqual(state.committedMetricOwnershipRanges.map((item) => ({
    type: item.type,
    proposalId: item.proposalId,
    scenario: item.scenario,
    range: item.range,
    affectedMetricGates: item.affectedMetricGates
  })), [
    {
      type: 'base_kernel',
      proposalId: null,
      scenario: null,
      range: range(1, 9),
      affectedMetricGates: []
    },
    {
      type: 'hard_boundary',
      proposalId: 'gap-1',
      scenario: 'gap_recovery_boundary',
      range: range(10, 10),
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    },
    {
      type: 'base_kernel',
      proposalId: null,
      scenario: null,
      range: range(11, 30),
      affectedMetricGates: []
    }
  ]);
});

test('applyCommitPlanToStreamingState is idempotent for already committed ranges', () => {
  const commitPlan = {
    status: 'committable',
    commitWatermark: 5,
    blockingRanges: [],
    committableRanges: [
      { type: 'normal', range: range(1, 5) }
    ],
    metricOwnershipRanges: [
      { type: 'base_kernel', range: range(1, 5) }
    ]
  };
  const first = streamingSettlementSnapshot(commitPlan);
  const second = applyCommitPlanToStreamingState(first, commitPlan);

  assert.equal(first.committedCursorRawPointId, 5);
  assert.equal(first.lastCommitWatermark, 5);
  assert.equal(second.committedCursorRawPointId, 5);
  assert.equal(second.lastCommitPlanStatus, 'committable');
  assert.equal(second.lastCommitWatermark, 5);
  assert.equal(second.lastAppliedRangeCount, 0);
  assert.deepEqual(second.committedRanges, first.committedRanges);
  assert.deepEqual(second.lastAppliedMetricOwnershipRanges, []);
  assert.deepEqual(second.committedMetricOwnershipRanges, first.committedMetricOwnershipRanges);
});

test('applyCommitPlanToStreamingState records blockers while committing safe prefix', () => {
  const state = streamingSettlementSnapshot({
    status: 'blocked_at_watermark',
    commitWatermark: 20,
    blockingRanges: [
      {
        type: 'unresolved_conflict',
        id: 'conflict:rest:route',
        relation: 'partial',
        range: range(20, 30),
        affectedMetricGates: ['route', 'distance', 'moving_time']
      }
    ],
    committableRanges: [
      { type: 'normal', range: range(1, 19) }
    ]
  });

  assert.equal(state.committedCursorRawPointId, 19);
  assert.equal(state.lastCommitPlanStatus, 'blocked_at_watermark');
  assert.equal(state.lastCommitWatermark, 20);
  assert.deepEqual(state.blockingRanges, [
    {
      type: 'unresolved_conflict',
      id: 'conflict:rest:route',
      relation: 'partial',
      range: range(20, 30),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);
});

test('applyCommitPlanToStreamingState resumes after a previously blocked prefix', () => {
  const blocked = streamingSettlementSnapshot({
    status: 'blocked_at_watermark',
    commitWatermark: 20,
    blockingRanges: [
      { type: 'open_window', id: 'stationary-open', range: range(20, 40) }
    ],
    committableRanges: [
      { type: 'normal', range: range(1, 19) }
    ]
  });
  const resumed = applyCommitPlanToStreamingState(blocked, {
    status: 'committable',
    commitWatermark: 50,
    blockingRanges: [],
    committableRanges: [
      { type: 'normal', range: range(1, 50) }
    ]
  });

  assert.equal(resumed.committedCursorRawPointId, 50);
  assert.deepEqual(resumed.lastAppliedRanges.map((item) => item.range), [
    range(20, 50)
  ]);
  assert.deepEqual(resumed.blockingRanges, []);
});

test('exportStreamingSettlementStateContract emits sample-based public state', () => {
  const state = streamingSettlementSnapshot({
    status: 'blocked_at_watermark',
    commitWatermark: 12,
    blockingRanges: [
      {
        type: 'open_window',
        id: 'rest-open',
        range: range(12, 18),
        affectedMetricGates: ['route', 'distance', 'moving_time']
      }
    ],
    committableRanges: [
      { type: 'normal', range: range(1, 9) },
      {
        type: 'hard_boundary',
        proposalId: 'pressure-1',
        scenario: 'pressure_jump',
        range: range(10, 10),
        affectedMetricGates: ['elevation']
      },
      { type: 'normal', range: range(11, 11) }
    ],
    metricOwnershipRanges: [
      { type: 'base_kernel', range: range(1, 9) },
      {
        type: 'hard_boundary',
        proposalId: 'pressure-1',
        scenario: 'pressure_jump',
        range: range(10, 10),
        hardBoundary: true,
        affectedMetricGates: ['elevation']
      },
      { type: 'base_kernel', range: range(11, 11) }
    ]
  });

  const exported = exportStreamingSettlementStateContract(state);

  assert.equal(exported.schemaVersion, 'track-sdk-streaming-settlement-state-v1');
  assert.equal(exported.committedCursorSampleId, 11);
  assert.equal(exported.lastCommitPlanStatus, 'blocked_at_watermark');
  assert.equal(exported.lastCommitWatermark, 12);
  assert.deepEqual(exported.committedRanges.map((item) => item.sampleRange), [
    sampleRange(1, 9),
    sampleRange(10, 10),
    sampleRange(11, 11)
  ]);
  assert.deepEqual(exported.committedMetricOwnershipRanges.map((item) => ({
    ownerId: item.ownerId,
    sampleRange: item.sampleRange,
    affectedMetricGates: item.affectedMetricGates,
    hardBoundary: item.hardBoundary,
    commitSequence: item.commitSequence
  })), [
    {
      ownerId: 'base_kernel',
      sampleRange: sampleRange(1, 9),
      affectedMetricGates: [],
      hardBoundary: false,
      commitSequence: 3
    },
    {
      ownerId: 'pressure-1',
      sampleRange: sampleRange(10, 10),
      affectedMetricGates: ['elevation'],
      hardBoundary: true,
      commitSequence: 3
    },
    {
      ownerId: 'base_kernel',
      sampleRange: sampleRange(11, 11),
      affectedMetricGates: [],
      hardBoundary: false,
      commitSequence: 3
    }
  ]);
  assert.deepEqual(exported.hardBoundaryCheckpoints, [
    {
      proposalId: 'pressure-1',
      scenario: 'pressure_jump',
      sampleRange: sampleRange(10, 10),
      affectedMetricGates: ['elevation'],
      commitSequence: 2
    }
  ]);
  assert.deepEqual(exported.blockingRanges, [
    {
      type: 'open_window',
      id: 'rest-open',
      sampleRange: sampleRange(12, 18),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);
  assert.equal(JSON.stringify(exported).includes('RawPointId'), false);
  assert.equal(JSON.stringify(exported).includes('"range"'), false);
});

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function sampleRange(startSampleId, endSampleId) {
  return { startSampleId, endSampleId };
}
