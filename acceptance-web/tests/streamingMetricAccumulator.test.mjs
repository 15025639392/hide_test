import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';
import {
  applyStreamingMetricSettlement,
  advanceStreamingMetricAccumulator,
  createStreamingMetricAccumulatorState,
  streamingMetricSnapshot
} from '../src/track-cleaning/streamingMetricAccumulator.mjs';

test('streaming metric accumulator matches full product for window ascent and descent', () => {
  const events = [
    barometerWindow(1, 1_000_000_000, 1_000_000_000, 100, {
      windowAscentMeters: 0,
      windowDescentMeters: 0
    }),
    barometerWindow(2, 26_000_000_000, 31_000_000_000, 112, {
      avgPressureHpa: 999,
      windowAscentMeters: 12,
      windowDescentMeters: 0
    }),
    barometerWindow(3, 56_000_000_000, 61_000_000_000, 105, {
      avgPressureHpa: 999.5,
      windowAscentMeters: 0,
      windowDescentMeters: 7
    })
  ];

  const full = buildSixLayerTrackProduct(events);
  const first = advanceStreamingMetricAccumulator(
    createStreamingMetricAccumulatorState(),
    events.slice(0, 1)
  );
  const streamed = advanceStreamingMetricAccumulator(first, events.slice(1));

  assert.equal(first.stats.barometerAscentSampleCount, 1);
  assert.equal(first.stats.selectedAscentSource, 'NONE');
  assert.deepEqual(metricProjection(streamed), metricProjection(full));
  assert.equal(streamed.selectedAscentResult.source, 'BAROMETER');
  assert.equal(streamed.selectedAscentResult.totalAscentMeters, 12);
  assert.equal(streamed.selectedAscentResult.totalDescentMeters, 7);
});

test('streaming metric accumulator falls back to barometer altitude deltas', () => {
  const events = [
    barometerWindow(1, 1_000_000_000, 1_000_000_000, 100),
    barometerWindow(2, 4_000_000_000, 4_000_000_000, 102.5),
    barometerWindow(3, 7_000_000_000, 7_000_000_000, 101)
  ];

  const full = buildSixLayerTrackProduct(events);
  const streamed = advanceStreamingMetricAccumulator(
    createStreamingMetricAccumulatorState(),
    events
  );

  assert.deepEqual(metricProjection(streamed), metricProjection(full));
  assert.equal(streamed.stats.selectedTotalAscentMeters, 2.5);
  assert.equal(streamed.stats.selectedTotalDescentMeters, 1.5);
});

test('streaming metric accumulator rejects out-of-order barometer windows', () => {
  const state = advanceStreamingMetricAccumulator(
    createStreamingMetricAccumulatorState(),
    [
      barometerWindow(2, 4_000_000_000, 4_000_000_000, 102),
      barometerWindow(1, 1_000_000_000, 1_000_000_000, 100)
    ]
  );

  assert.equal(state.barometerWindowDecisions[1].result, 'rejected');
  assert.equal(state.barometerWindowDecisions[1].reason, 'barometer_window_out_of_order');
  assert.equal(state.stats.barometerAscentSampleCount, 1);
  assert.equal(state.stats.barometerAscentRejectedSampleCount, 1);
  assert.equal(streamingMetricSnapshot(state).barometerWindowDecisionCount, 2);
});

test('streaming metric snapshot slices committed barometer windows by raw ownership time', () => {
  const state = advanceStreamingMetricAccumulator(createStreamingMetricAccumulatorState(), [
    barometerWindow(1, 1_000_000_000, 1_000_000_000, 100, {
      windowAscentMeters: 0,
      windowDescentMeters: 0
    }),
    barometerWindow(2, 26_000_000_000, 31_000_000_000, 112, {
      windowAscentMeters: 12,
      windowDescentMeters: 0
    }),
    barometerWindow(3, 56_000_000_000, 61_000_000_000, 105, {
      windowAscentMeters: 0,
      windowDescentMeters: 7
    })
  ]);
  const snapshot = streamingMetricSnapshot(state, settlementState([
    ownership('base_kernel', 1, 2)
  ]), rawTimeline());

  assert.equal(snapshot.selectedAscentResult.totalAscentMeters, 12);
  assert.equal(snapshot.selectedAscentResult.totalDescentMeters, 7);
  assert.equal(snapshot.settlement.committedSelectedAscentResult.source, 'BAROMETER');
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalAscentMeters, 12);
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalDescentMeters, 0);
  assert.deepEqual(snapshot.settlement.committedBarometerWindowSlices.map((slice) => ({
    windowId: slice.windowId,
    rawRange: slice.rawRange,
    ascentDeltaMeters: rounded(slice.ascentDeltaMeters),
    descentDeltaMeters: rounded(slice.descentDeltaMeters),
    countsElevation: slice.countsElevation
  })), [
    {
      windowId: 1,
      rawRange: range(1, 2),
      ascentDeltaMeters: 0,
      descentDeltaMeters: 0,
      countsElevation: true
    },
    {
      windowId: 2,
      rawRange: range(1, 2),
      ascentDeltaMeters: 12,
      descentDeltaMeters: 0,
      countsElevation: true
    }
  ]);
});

test('streaming metric snapshot does not count elevation through hard boundaries', () => {
  const state = advanceStreamingMetricAccumulator(createStreamingMetricAccumulatorState(), [
    barometerWindow(1, 1_000_000_000, 1_000_000_000, 100, {
      windowAscentMeters: 0,
      windowDescentMeters: 0
    }),
    barometerWindow(2, 26_000_000_000, 31_000_000_000, 112, {
      windowAscentMeters: 12,
      windowDescentMeters: 0
    }),
    barometerWindow(3, 56_000_000_000, 61_000_000_000, 120, {
      windowAscentMeters: 8,
      windowDescentMeters: 0
    })
  ]);
  const snapshot = streamingMetricSnapshot(state, settlementState([
    ownership('base_kernel', 1, 1),
    ownership('hard_boundary', 2, 3, {
      proposalId: 'transport-1',
      scenario: 'transport_contamination',
      hardBoundary: true,
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    })
  ]), rawTimeline());

  assert.equal(snapshot.settlement.committedSelectedAscentResult.source, 'NONE');
  assert.deepEqual(snapshot.settlement.committedBarometerWindowSlices.map((slice) => ({
    windowId: slice.windowId,
    ownerType: slice.ownerType,
    ascentDeltaMeters: rounded(slice.ascentDeltaMeters),
    countsElevation: slice.countsElevation
  })), [
    { windowId: 1, ownerType: 'base_kernel', ascentDeltaMeters: 0, countsElevation: true },
    { windowId: 2, ownerType: 'hard_boundary', ascentDeltaMeters: 0, countsElevation: false },
    { windowId: 3, ownerType: 'hard_boundary', ascentDeltaMeters: 0, countsElevation: false }
  ]);
});

test('streaming metric settlement selects committed GNSS altitude fallback', () => {
  const state = applyStreamingMetricSettlement(createStreamingMetricAccumulatorState(), {
    committedCursorRawPointId: 3,
    lastAppliedMetricOwnershipRanges: [ownership('base_kernel', 1, 3)]
  }, rawTimeline(), gnssBaseTrack([100, 112, 105]));
  const snapshot = streamingMetricSnapshot(state, settlementState([
    ownership('base_kernel', 1, 3)
  ]), rawTimeline(), gnssBaseTrack([100, 112, 105]));

  assert.equal(state.stats.locationAltitudeTotalAscentMeters, 12);
  assert.equal(state.stats.locationAltitudeTotalDescentMeters, 7);
  assert.equal(state.stats.selectedAscentSource, 'GNSS');
  assert.equal(state.gnssAltitudeResult.confidence, 'high');
  assert.equal(snapshot.settlement.committedSelectedAscentResult.source, 'GNSS');
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalAscentMeters, 12);
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalDescentMeters, 7);
  assert.deepEqual(state.lastAppliedGnssAltitudePointDecisions.map((decision) => ({
    rawPointId: decision.rawPointId,
    result: decision.result,
    reason: decision.reason,
    ascentDeltaMeters: decision.ascentDeltaMeters,
    descentDeltaMeters: decision.descentDeltaMeters
  })), [
    {
      rawPointId: 1,
      result: 'reset',
      reason: 'gnss_altitude_anchor',
      ascentDeltaMeters: 0,
      descentDeltaMeters: 0
    },
    {
      rawPointId: 2,
      result: 'accepted',
      reason: 'gnss_altitude_accepted',
      ascentDeltaMeters: 12,
      descentDeltaMeters: 0
    },
    {
      rawPointId: 3,
      result: 'accepted',
      reason: 'gnss_altitude_accepted',
      ascentDeltaMeters: 0,
      descentDeltaMeters: 7
    }
  ]);
});

test('streaming metric settlement rejects bad GNSS vertical accuracy', () => {
  const state = applyStreamingMetricSettlement(createStreamingMetricAccumulatorState(), {
    committedCursorRawPointId: 3,
    lastAppliedMetricOwnershipRanges: [ownership('base_kernel', 1, 3)]
  }, rawTimeline(), gnssBaseTrack([100, 112, 115], {
    2: { verticalAccuracy: 50 }
  }));

  assert.equal(state.stats.locationAltitudeTotalAscentMeters, 15);
  assert.equal(state.stats.locationAltitudeAscentSampleCount, 2);
  assert.equal(state.stats.locationAltitudeAscentRejectedSampleCount, 1);
  assert.equal(state.stats.locationAltitudeAscentConfidence, 'medium');
  assert.equal(state.selectedAscentResult.source, 'GNSS');
  assert.equal(state.lastAppliedGnssAltitudePointDecisions[1].result, 'rejected');
  assert.equal(
    state.lastAppliedGnssAltitudePointDecisions[1].reason,
    'vertical_accuracy_too_large'
  );
});

test('streaming metric settlement does not count GNSS altitude through elevation gates', () => {
  const state = applyStreamingMetricSettlement(createStreamingMetricAccumulatorState(), {
    committedCursorRawPointId: 3,
    lastAppliedMetricOwnershipRanges: [
      ownership('base_kernel', 1, 1),
      ownership('hard_boundary', 2, 2, {
        proposalId: 'pressure-1',
        scenario: 'pressure_jump',
        hardBoundary: true,
        affectedMetricGates: ['elevation']
      }),
      ownership('base_kernel', 3, 3)
    ]
  }, rawTimeline(), gnssBaseTrack([100, 112, 115]));

  assert.equal(state.stats.locationAltitudeTotalAscentMeters, 0);
  assert.equal(state.stats.locationAltitudeTotalDescentMeters, 0);
  assert.equal(state.selectedAscentResult.source, 'GNSS');
  assert.deepEqual(state.lastAppliedGnssAltitudePointDecisions.map((decision) => ({
    rawPointId: decision.rawPointId,
    result: decision.result,
    reason: decision.reason,
    countsElevation: decision.countsElevation,
    ascentDeltaMeters: decision.ascentDeltaMeters
  })), [
    {
      rawPointId: 1,
      result: 'reset',
      reason: 'gnss_altitude_anchor',
      countsElevation: true,
      ascentDeltaMeters: 0
    },
    {
      rawPointId: 2,
      result: 'suspended',
      reason: 'elevation_gate_closed',
      countsElevation: false,
      ascentDeltaMeters: 0
    },
    {
      rawPointId: 3,
      result: 'accepted',
      reason: 'gnss_altitude_anchor',
      countsElevation: true,
      ascentDeltaMeters: 0
    }
  ]);
});

test('streaming metric settlement applies new ownership incrementally and prunes old windows', () => {
  const accumulated = advanceStreamingMetricAccumulator(createStreamingMetricAccumulatorState(), [
    barometerWindow(1, 1_000_000_000, 1_000_000_000, 100, {
      windowAscentMeters: 0,
      windowDescentMeters: 0
    }),
    barometerWindow(2, 26_000_000_000, 31_000_000_000, 112, {
      windowAscentMeters: 12,
      windowDescentMeters: 0
    }),
    barometerWindow(3, 56_000_000_000, 61_000_000_000, 105, {
      windowAscentMeters: 0,
      windowDescentMeters: 7
    })
  ]);
  const first = applyStreamingMetricSettlement(accumulated, {
    committedCursorRawPointId: 2,
    lastAppliedMetricOwnershipRanges: [ownership('base_kernel', 1, 2)]
  }, rawTimeline());

  assert.equal(first.committedBarometerAscentMeters, 12);
  assert.equal(first.committedBarometerDescentMeters, 0);
  assert.deepEqual(first.barometerWindowDecisions.map((decision) => decision.windowId), [3]);
  assert.equal(first.barometerWindowDecisionsPrunedBeforeElapsedRealtimeNanos, 31_000_000_000);

  const second = applyStreamingMetricSettlement(first, {
    committedCursorRawPointId: 3,
    lastAppliedMetricOwnershipRanges: [ownership('base_kernel', 3, 3)]
  }, rawTimeline().slice(1));
  const snapshot = streamingMetricSnapshot(second, {
    committedCursorRawPointId: 3,
    lastCommitPlanStatus: 'committable',
    lastCommitWatermark: 3,
    committedMetricOwnershipRanges: [ownership('base_kernel', 1, 3)],
    blockingRanges: [],
    hardBoundaryCheckpoints: []
  }, rawTimeline().slice(2));

  assert.equal(second.committedBarometerAscentMeters, 12);
  assert.equal(second.committedBarometerDescentMeters, 7);
  assert.deepEqual(second.barometerWindowDecisions, []);
  assert.equal(snapshot.settlement.lastCommitWatermark, 3);
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalAscentMeters, 12);
  assert.equal(snapshot.settlement.committedSelectedAscentResult.totalDescentMeters, 7);
});

function metricProjection(productOrState) {
  return {
    decisions: productOrState.barometerWindowDecisions.map((decision) => ({
      windowId: decision.windowId,
      result: decision.result,
      reason: decision.reason,
      ascentDeltaMeters: rounded(decision.ascentDeltaMeters),
      descentDeltaMeters: rounded(decision.descentDeltaMeters),
      activityGate: decision.activityGate,
      boundaryGate: decision.boundaryGate,
      confidence: decision.confidence
    })),
    stats: {
      barometerTotalAscentMeters: rounded(productOrState.stats.barometerTotalAscentMeters),
      barometerTotalDescentMeters: rounded(productOrState.stats.barometerTotalDescentMeters),
      barometerAscentSampleCount: productOrState.stats.barometerAscentSampleCount,
      barometerAscentRejectedSampleCount:
        productOrState.stats.barometerAscentRejectedSampleCount,
      barometerAscentConfidence: productOrState.stats.barometerAscentConfidence,
      selectedTotalAscentMeters: rounded(productOrState.stats.selectedTotalAscentMeters),
      selectedTotalDescentMeters: rounded(productOrState.stats.selectedTotalDescentMeters),
      selectedAscentSource: productOrState.stats.selectedAscentSource
    },
    barometerAscentResult: {
      totalAscentMeters: rounded(productOrState.barometerAscentResult.totalAscentMeters),
      totalDescentMeters: rounded(productOrState.barometerAscentResult.totalDescentMeters),
      sampleCount: productOrState.barometerAscentResult.sampleCount,
      rejectedSampleCount: productOrState.barometerAscentResult.rejectedSampleCount,
      confidence: productOrState.barometerAscentResult.confidence
    },
    selectedAscentResult: {
      source: productOrState.selectedAscentResult.source,
      totalAscentMeters: rounded(productOrState.selectedAscentResult.totalAscentMeters),
      totalDescentMeters: rounded(productOrState.selectedAscentResult.totalDescentMeters),
      confidence: productOrState.selectedAscentResult.confidence,
      reason: productOrState.selectedAscentResult.reason
    }
  };
}

function settlementState(committedMetricOwnershipRanges) {
  return {
    committedCursorRawPointId: 3,
    lastCommitPlanStatus: 'committable',
    committedMetricOwnershipRanges,
    blockingRanges: [],
    hardBoundaryCheckpoints: []
  };
}

function ownership(type, startRawPointId, endRawPointId, overrides = {}) {
  return {
    type,
    proposalId: null,
    scenario: null,
    range: range(startRawPointId, endRawPointId),
    hardBoundary: false,
    affectedMetricGates: [],
    ...overrides
  };
}

function rawTimeline() {
  return [
    { rawPointId: 1, elapsedRealtimeNanos: 1_000_000_000 },
    { rawPointId: 2, elapsedRealtimeNanos: 31_000_000_000 },
    { rawPointId: 3, elapsedRealtimeNanos: 61_000_000_000 }
  ];
}

function gnssBaseTrack(altitudes, overridesByRawPointId = {}) {
  return altitudes.map((altitude, index) => {
    const rawPointId = index + 1;
    const overrides = overridesByRawPointId[rawPointId] || {};
    return {
      trackPointId: rawPointId,
      sourceRawPointId: rawPointId,
      result: rawPointId === 1 ? 'anchor' : 'accept',
      reason: rawPointId === 1 ? 'first_fix_good' : 'moving_good_fix',
      altitude,
      verticalAccuracy: 4,
      elapsedRealtimeNanos: rawTimeline()[index].elapsedRealtimeNanos,
      countsDistance: rawPointId > 1,
      countsMovingTime: rawPointId > 1,
      entersTrustedGpx: true,
      ...overrides
    };
  });
}

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function barometerWindow(windowId, startElapsedRealtimeNanos, endElapsedRealtimeNanos,
  avgRawBarometerAltitudeMeters, overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'barometer_window',
    sessionId: 'S1',
    eventSeq: 100 + windowId,
    eventWallTimeMillis: 1_760_000_000_000 + windowId,
    eventElapsedRealtimeNanos: endElapsedRealtimeNanos,
    windowId,
    startElapsedRealtimeNanos,
    endElapsedRealtimeNanos,
    avgPressureHpa: 1000,
    avgRawBarometerAltitudeMeters,
    ...overrides
  };
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}
