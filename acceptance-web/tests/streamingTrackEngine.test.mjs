import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceStreamingTrackEngine,
  createStreamingTrackEngineState,
  finishStreamingTrackEngine
} from '../src/track-cleaning/streamingTrackEngine.mjs';

const CONFIG = { stationarySessionCollapseEnabled: false };

test('streaming track engine advances intake, base kernel and settlement cursor from chunks', () => {
  const lines = normalWalkLines();
  const first = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    jsonlChunk: `${lines.slice(0, 3).join('\n')}\n`
  });
  const second = advanceStreamingTrackEngine(first, {
    jsonlChunk: lines.slice(3).join('\n'),
    finish: true
  });

  assert.deepEqual(first.baseKernel.track.map((point) => point.sourceRawPointId), [1]);
  assert.equal(first.scenarioSettlementSession.settlementState.committedCursorRawPointId, 1);
  assert.deepEqual(second.baseKernel.track.map((point) => point.sourceRawPointId), [1, 2, 3]);
  assert.equal(second.baseKernel.stats.movingTimeSeconds, 60);
  assert.equal(second.scenarioSettlementSession.settlementState.committedCursorRawPointId, 3);
  assert.equal(second.lastAdvanceSummary.newEvidenceEventCount, lines.length - 3);
  assert.equal(second.evidenceIntake.finished, true);
});

test('streaming track engine does not process duplicate evidence events twice', () => {
  const first = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000)
    ]
  });
  const duplicate = advanceStreamingTrackEngine(first, {
    events: [
      locationSample(11, 1, 30, 120, 5, 1_000_000_000)
    ]
  });

  assert.equal(duplicate.evidenceIntake.duplicateEventCount, 1);
  assert.equal(duplicate.lastAdvanceSummary.newEvidenceEventCount, 0);
  assert.equal(duplicate.baseKernel.stats.rawPointCount, 1);
  assert.deepEqual(duplicate.baseKernel.track.map((point) => point.sourceRawPointId), [1]);
});

test('streaming track engine commits only safe prefix while an open window blocks', () => {
  const blocked = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: normalWalkEvents(),
    openWindows: [
      {
        id: 'stationary-open',
        metricOwner: true,
        influenceRange: range(2, 3)
      }
    ]
  });

  assert.deepEqual(blocked.baseKernel.track.map((point) => point.sourceRawPointId), [1, 2, 3]);
  assert.equal(blocked.scenarioSettlementSession.settlementState.committedCursorRawPointId, 1);
  assert.deepEqual(blocked.scenarioSettlementSession.settlementState.blockingRanges.map((item) =>
    item.range), [range(2, 3)]);
  assert.equal(blocked.lastAdvanceSummary.metrics.settlement.committedCursorRawPointId, 1);
  assert.equal(blocked.lastAdvanceSummary.metrics.settlement.lastCommitWatermark, 2);
  assert.equal(blocked.lastAdvanceSummary.streamingSettlementState.schemaVersion,
    'track-sdk-streaming-settlement-state-v1');
  assert.equal(blocked.lastAdvanceSummary.streamingSettlementState.committedCursorSampleId, 1);
  assert.equal(blocked.lastAdvanceSummary.streamingSettlementState.lastCommitWatermark, 2);
  assert.deepEqual(
    blocked.lastAdvanceSummary.streamingSettlementState.blockingRanges.map((item) => ({
      sampleRange: item.sampleRange,
      affectedMetricGates: item.affectedMetricGates
    })),
    [{
      sampleRange: sampleRange(2, 3),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    }]
  );
  assert.deepEqual(blocked.lastAdvanceSummary.metrics.settlement.blockingRanges.map((item) =>
    item.range), [range(2, 3)]);
  assert.deepEqual(
    blocked.lastAdvanceSummary.metrics.settlement.committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      range: item.range
    })),
    [{ type: 'base_kernel', range: range(1, 1) }]
  );

  const resumed = advanceStreamingTrackEngine(blocked, {
    openWindows: []
  });
  assert.equal(resumed.lastAdvanceSummary.newEvidenceEventCount, 0);
  assert.equal(resumed.scenarioSettlementSession.settlementState.committedCursorRawPointId, 3);
  assert.equal(resumed.lastAdvanceSummary.streamingSettlementState.committedCursorSampleId, 3);
  assert.deepEqual(resumed.scenarioSettlementSession.settlementState.blockingRanges, []);
  assert.deepEqual(resumed.lastAdvanceSummary.streamingSettlementState.blockingRanges, []);
});

test('streaming track engine carries GAP recovery through settlement cursor', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000),
      locationSample(12, 2, 30.001, 120, 5, 130_000_000_000, {
        speedMetersPerSecond: 1
      })
    ]
  });

  assert.equal(state.baseKernel.track[1].reason, 'gap_recovery');
  assert.equal(state.baseKernel.track[1].distanceDeltaMeters, 0);
  assert.equal(state.baseKernel.stats.gapCount, 1);
  assert.equal(state.scenarioSettlementSession.settlementState.committedCursorRawPointId, 2);
});

test('streaming track engine applies neutral motion windows across JSONL chunks', () => {
  const lines = [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000),
    motionWindow(12, 14_000_000_000, 15_000_000_000, {
      accelerometerDynamicRmsMps2: 0.8,
      gyroscopeRmsRadps: 0.16,
      stepCounterDelta: 4
    }),
    locationSample(13, 2, 30.00003, 120, 5, 15_000_000_000, {
      speedMetersPerSecond: 0.25
    })
  ].map((event) => JSON.stringify(event));

  const first = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    jsonlChunk: `${lines.slice(0, 4).join('\n')}\n`
  });
  const second = advanceStreamingTrackEngine(first, {
    jsonlChunk: lines.slice(4).join('\n'),
    finish: true
  });

  assert.deepEqual(first.baseKernel.track.map((point) => point.sourceRawPointId), [1]);
  assert.deepEqual(second.baseKernel.track.map((point) => point.sourceRawPointId), [1, 2]);
  assert.equal(second.baseKernel.track[1].reason, 'motion_supported_low_speed');
  assert.equal(second.baseKernel.track[1].activityState, 'walking');
  assert.equal(second.scenarioSettlementSession.settlementState.committedCursorRawPointId, 2);
});

test('streaming track engine accumulates barometer ascent and descent across chunks', () => {
  const lines = [
    sessionMetadata(1),
    samplingPolicy(2),
    barometerWindow(3, 1, 1_000_000_000, 1_000_000_000, 100, {
      windowAscentMeters: 0,
      windowDescentMeters: 0
    }),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000),
    barometerWindow(4, 2, 26_000_000_000, 31_000_000_000, 112, {
      windowAscentMeters: 12,
      windowDescentMeters: 0
    }),
    locationSample(12, 2, 30.0001, 120, 5, 31_000_000_000),
    barometerWindow(5, 3, 56_000_000_000, 61_000_000_000, 105, {
      windowAscentMeters: 0,
      windowDescentMeters: 7
    }),
    locationSample(13, 3, 30.0002, 120, 5, 61_000_000_000)
  ].map((event) => JSON.stringify(event));

  const first = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    jsonlChunk: `${lines.slice(0, 5).join('\n')}\n`
  });
  const second = advanceStreamingTrackEngine(first, {
    jsonlChunk: lines.slice(5).join('\n'),
    finish: true
  });

  assert.equal(first.metricAccumulator.stats.selectedTotalAscentMeters, 12);
  assert.equal(first.metricAccumulator.stats.selectedTotalDescentMeters, 0);
  assert.equal(second.metricAccumulator.stats.selectedTotalAscentMeters, 12);
  assert.equal(second.metricAccumulator.stats.selectedTotalDescentMeters, 7);
  assert.equal(second.metricAccumulator.selectedAscentResult.source, 'BAROMETER');
  assert.equal(second.lastAdvanceSummary.metrics.selectedAscentResult.totalDescentMeters, 7);
  assert.equal(second.lastAdvanceSummary.metrics.settlement.committedCursorRawPointId, 3);
  assert.deepEqual(second.baseKernel.rawPointTimeline.map((point) => point.rawPointId), [3]);
  assert.deepEqual(second.metricAccumulator.barometerWindowDecisions, []);
  assert.deepEqual(
    second.lastAdvanceSummary.metrics.settlement.committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      range: item.range
    })),
    [{ type: 'base_kernel', range: range(1, 3) }]
  );
});

test('streaming track engine selects GNSS altitude fallback without barometer', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000, {
        altitudeMeters: 100,
        verticalAccuracyMeters: 4
      }),
      locationSample(12, 2, 30.0001, 120, 5, 31_000_000_000, {
        altitudeMeters: 112,
        verticalAccuracyMeters: 4
      }),
      locationSample(13, 3, 30.0002, 120, 5, 61_000_000_000, {
        altitudeMeters: 105,
        verticalAccuracyMeters: 4
      })
    ],
    finish: true
  });

  assert.equal(state.baseKernel.track[1].altitude, 112);
  assert.equal(state.baseKernel.track[1].verticalAccuracy, 4);
  assert.equal(state.metricAccumulator.selectedAscentResult.source, 'GNSS');
  assert.equal(state.metricAccumulator.gnssAltitudeResult.totalAscentMeters, 12);
  assert.equal(state.metricAccumulator.gnssAltitudeResult.totalDescentMeters, 7);
  assert.equal(
    state.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.source,
    'GNSS'
  );
  assert.equal(
    state.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.totalDescentMeters,
    7
  );
});

test('streaming track engine keeps barometer metrics pending behind open windows', () => {
  const blocked = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      barometerWindow(3, 1, 1_000_000_000, 1_000_000_000, 100, {
        windowAscentMeters: 0,
        windowDescentMeters: 0
      }),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000),
      barometerWindow(4, 2, 26_000_000_000, 31_000_000_000, 112, {
        windowAscentMeters: 12,
        windowDescentMeters: 0
      }),
      locationSample(12, 2, 30.0001, 120, 5, 31_000_000_000),
      barometerWindow(5, 3, 56_000_000_000, 61_000_000_000, 105, {
        windowAscentMeters: 0,
        windowDescentMeters: 7
      }),
      locationSample(13, 3, 30.0002, 120, 5, 61_000_000_000)
    ],
    openWindows: [
      {
        id: 'rest-open',
        metricOwner: true,
        influenceRange: range(2, 3)
      }
    ]
  });

  assert.equal(blocked.metricAccumulator.stats.selectedTotalAscentMeters, 12);
  assert.equal(blocked.metricAccumulator.stats.selectedTotalDescentMeters, 7);
  assert.equal(
    blocked.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.source,
    'NONE'
  );
  assert.equal(
    blocked.lastAdvanceSummary.metrics.settlement.committedBarometerWindowSliceCount,
    1
  );
  assert.deepEqual(blocked.baseKernel.rawPointTimeline.map((point) => point.rawPointId), [
    1, 2, 3
  ]);
  assert.deepEqual(blocked.metricAccumulator.barometerWindowDecisions.map((decision) =>
    decision.windowId), [2, 3]);
  assert.deepEqual(
    blocked.lastAdvanceSummary.metrics.settlement.blockingRanges.map((item) => item.range),
    [range(2, 3)]
  );

  const resumed = advanceStreamingTrackEngine(blocked, {
    openWindows: []
  });

  assert.equal(
    resumed.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.source,
    'BAROMETER'
  );
  assert.equal(
    resumed.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.totalAscentMeters,
    12
  );
  assert.equal(
    resumed.lastAdvanceSummary.metrics.settlement.committedSelectedAscentResult.totalDescentMeters,
    7
  );
  assert.deepEqual(resumed.baseKernel.rawPointTimeline.map((point) => point.rawPointId), [3]);
  assert.deepEqual(resumed.metricAccumulator.barometerWindowDecisions, []);
});

test('streaming track engine feeds moving spike recognizer proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: movingSpikeEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.enabled, true);
  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.equal(state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .some((proposal) => proposal.scenario === 'moving_spike_cleanup'), true);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'scenario_owner', scenario: 'moving_spike_cleanup', range: range(2, 4) },
    { type: 'base_kernel', scenario: null, range: range(5, 5) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    distanceDeltaMeters: rounded(point.distanceDeltaMeters),
    countsDistance: point.countsDistance,
    contributingRawPointIds: point.contributingRawPointIds || [point.sourceRawPointId],
    suppressedRawPointIds: point.suppressedRawPointIds || []
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      distanceDeltaMeters: 0,
      countsDistance: false,
      contributingRawPointIds: [1],
      suppressedRawPointIds: []
    },
    {
      sourceRawPointId: 2,
      reason: 'moving_good_fix',
      distanceDeltaMeters: 'checked',
      countsDistance: true,
      contributingRawPointIds: [2],
      suppressedRawPointIds: []
    },
    {
      sourceRawPointId: 4,
      reason: 'moving_good_fix',
      distanceDeltaMeters: 'checked',
      countsDistance: true,
      contributingRawPointIds: [4],
      suppressedRawPointIds: [3]
    },
    {
      sourceRawPointId: 5,
      reason: 'moving_good_fix',
      distanceDeltaMeters: 'checked',
      countsDistance: true,
      contributingRawPointIds: [5],
      suppressedRawPointIds: []
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
  assert.ok(state.localRebuild.committedTrack.find((point) =>
    point.sourceRawPointId === 4).distanceDeltaMeters < 20);
});

test('streaming track engine feeds position snap recognizer proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: positionSnapEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.deepEqual(state.baseKernel.excluded.weak.map((point) => point.rawPointId), [2, 3]);
  assert.equal(state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .some((proposal) => proposal.scenario === 'position_snap_recovery'), true);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'position_snap_recovery',
      range: range(2, 4),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'hard_boundary', scenario: 'position_snap_recovery', range: range(2, 4) },
    { type: 'base_kernel', scenario: null, range: range(5, 5) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime,
    contributingRawPointIds: point.contributingRawPointIds || [point.sourceRawPointId],
    suppressedRawPointIds: point.suppressedRawPointIds || []
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: [1],
      suppressedRawPointIds: []
    },
    {
      sourceRawPointId: 4,
      reason: 'position_snap_recovery_anchor',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: [2, 3, 4],
      suppressedRawPointIds: [2, 3]
    },
    {
      sourceRawPointId: 5,
      reason: 'moving_good_fix',
      countsDistance: true,
      countsMovingTime: true,
      contributingRawPointIds: [5],
      suppressedRawPointIds: []
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine rebuilds an unstable transport prefix to its recovery anchor', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: unstableTransportPrefixEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });
  const proposal = state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .find((item) =>
      item.scenario === 'position_snap_recovery'
        && item.evidence?.recoveryKind === 'unstable_transport_prefix');
  const rejectedTransportIds =
    state.scenarioSettlementSession.lastSettlementPlan.rejectedProposals
      .filter((item) => item.scenario === 'transport_contamination')
      .map((item) => item.evidence.keptRawPointIds[0]);

  assert.ok(proposal);
  assert.equal(proposal.priority, 5);
  assert.deepEqual(proposal.rawRange, range(2, 8));
  assert.deepEqual(rejectedTransportIds, [4, 6, 8]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    suppressedRawPointIds: point.suppressedRawPointIds || []
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      suppressedRawPointIds: []
    },
    {
      sourceRawPointId: 8,
      reason: 'position_snap_recovery_anchor',
      suppressedRawPointIds: [2, 3, 4, 5, 6, 7]
    },
    {
      sourceRawPointId: 10,
      reason: 'transport_suspected_kept',
      suppressedRawPointIds: []
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine holds an unstable transport prefix across chunks', () => {
  const events = unstableTransportPrefixEvents();
  const pending = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: events.slice(0, 10),
    enableScenarioRecognizers: true
  });
  const settled = advanceStreamingTrackEngine(pending, {
    events: events.slice(10),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });

  assert.ok(pending.scenarioRecognizer.openWindows.some((window) =>
    window.id === 'position-snap-open:1-8'));
  assert.equal(pending.scenarioSettlementSession.settlementState.committedCursorRawPointId, 1);
  assert.deepEqual(pending.localRebuild.committedTrack.map((point) =>
    point.sourceRawPointId), [1]);
  assert.ok(settled.scenarioSettlementSession.lastSettlementPlan.activeProposals.some((item) =>
    item.id === 'position-snap:1-8'));
  assert.deepEqual(settled.localRebuild.committedTrack.map((point) =>
    point.sourceRawPointId), [1, 8, 10]);
});

test('streaming track engine preserves weak recovery endpoint as zero-delta shape anchor', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: weakRecoveryEndpointEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });
  const proposal = state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .find((item) => item.scenario === 'weak_recovery_endpoint');
  const anchor = state.localRebuild.committedTrack.find((point) =>
    point.reason === 'weak_recovery_shape_anchor');

  assert.ok(proposal);
  assert.equal(proposal.hardBoundary, true);
  assert.deepEqual(proposal.anchorRawPointIds, [4, 5]);
  assert.equal(proposal.evidence.previousTrustedRawPointId, 1);
  assert.deepEqual(proposal.evidence.preservedRawPointIds, [2, 3, 4, 5]);
  assert.equal(proposal.evidence.endpointRawPointId, 5);
  assert.equal(proposal.evidence.countsDistance, false);
  assert.equal(proposal.evidence.countsMovingTime, false);
  assert.deepEqual(state.baseKernel.excluded.weak.map((point) => point.rawPointId), [2, 3, 4, 5]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'weak_recovery_endpoint',
      range: range(2, 5),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    },
    {
      scenario: 'gap_recovery_boundary',
      range: range(6, 6),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'hard_boundary', scenario: 'weak_recovery_endpoint', range: range(2, 5) },
    { type: 'hard_boundary', scenario: 'gap_recovery_boundary', range: range(6, 6) }
  ]);
  assert.ok(anchor);
  assert.equal(anchor.sourceRawPointId, 4);
  assert.equal(anchor.startsNewSegment, true);
  assert.equal(anchor.countsDistance, false);
  assert.equal(anchor.countsMovingTime, false);
  assert.deepEqual(anchor.contributingRawPointIds, [2, 3, 4, 5]);
  assert.equal(anchor.shapeEndpointRawPointId, 5);
  assert.equal(anchor.localRebuildScenario, 'weak_recovery_endpoint');
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      countsDistance: false,
      countsMovingTime: false
    },
    {
      sourceRawPointId: 4,
      reason: 'weak_recovery_shape_anchor',
      countsDistance: false,
      countsMovingTime: false
    },
    {
      sourceRawPointId: 6,
      reason: 'gap_recovery',
      countsDistance: false,
      countsMovingTime: false
    }
  ]);
  assert.equal(state.localRebuild.stats.totalDistanceMeters, 0);
  assert.equal(state.localRebuild.stats.movingTimeSeconds, 0);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine blocks cursor while weak recovery endpoint is still forming', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: weakRecoveryEndpointEvents().slice(0, 5),
    enableScenarioRecognizers: true
  });

  assert.deepEqual(state.baseKernel.excluded.weak.map((point) => point.rawPointId), [2, 3]);
  assert.equal(state.lastAdvanceSummary.recognizer.openWindowCount, 1);
  assert.equal(state.scenarioSettlementSession.settlementState.committedCursorRawPointId, 1);
  assert.deepEqual(state.scenarioSettlementSession.settlementState.blockingRanges.map((item) =>
    item.range), [range(2, 3)]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) }
  ]);
});

test('streaming track engine feeds GAP recovery recognizer proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000),
      locationSample(12, 2, 30.001, 120, 5, 130_000_000_000, {
        speedMetersPerSecond: 1
      })
    ],
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.equal(state.baseKernel.track[1].reason, 'gap_recovery');
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'gap_recovery_boundary',
      range: range(2, 2),
      affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'hard_boundary', scenario: 'gap_recovery_boundary', range: range(2, 2) }
  ]);
});

test('streaming track engine feeds transport recognizer proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000),
      locationSample(12, 2, 30.001, 120, 5, 4_000_000_000, {
        speedMetersPerSecond: 5
      })
    ],
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.equal(state.baseKernel.track[1].reason, 'transport_suspected_kept');
  assert.equal(state.baseKernel.track[1].entersTrustedGpx, true);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'transport_contamination',
      range: range(2, 2),
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'hard_boundary', scenario: 'transport_contamination', range: range(2, 2) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good'
    },
    {
      sourceRawPointId: 2,
      reason: 'transport_suspected_kept'
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine keeps recovery transport route outside hiking metrics', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: recoveryTransportEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.deepEqual(state.baseKernel.track.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    entersTrustedGpx: point.entersTrustedGpx,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      entersTrustedGpx: true,
      countsDistance: false,
      countsMovingTime: false
    },
    {
      sourceRawPointId: 3,
      reason: 'recovery_transport_suspected_kept',
      entersTrustedGpx: true,
      countsDistance: false,
      countsMovingTime: false
    },
    {
      sourceRawPointId: 4,
      reason: 'transport_suspected_kept',
      entersTrustedGpx: true,
      // 里程口径变更（2026-08-01）：kept 的 transport 点计入总里程/移动时长
      // （recovery 锚点 raw 3 delta=0，故仍 false）。
      countsDistance: true,
      countsMovingTime: true
    }
  ]);
  assert.equal(state.baseKernel.excluded.weak[0].rawPointId, 2);
  assert.equal(state.baseKernel.excluded.weak[0].reason, 'gap_recovery_pending');
  assert.equal(state.baseKernel.stats.transportCount, 2);
  assert.equal(state.lastAdvanceSummary.suspectedTransport.pointCount, 2);
  assert.equal(state.lastAdvanceSummary.suspectedTransport.segmentCount, 1);
  assert.ok(state.lastAdvanceSummary.suspectedTransport.distanceMeters > 20);
  assert.equal(state.lastAdvanceSummary.suspectedTransport.durationSeconds, 1);
  assert.ok(state.lastAdvanceSummary.suspectedTransport.averageSpeedMetersPerSecond > 20);
  assert.equal(state.lastAdvanceSummary.suspectedTransport.diagnosticOnly, true);
  // 里程口径变更（2026-08-01）：kept 的 transport 点计入总里程/移动时长
  // （recovery 锚点 raw 3 delta=0 不贡献，raw 4 的 ~22.24m/1s 计入）。
  assert.ok(state.baseKernel.stats.totalDistanceMeters > 20);
  assert.equal(state.baseKernel.stats.movingTimeSeconds, 1);
  assert.ok(state.baseKernel.track.find((point) =>
    point.sourceRawPointId === 4).distanceDeltaMeters > 20);

  const transportProposals = state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .filter((proposal) => proposal.scenario === 'transport_contamination');
  assert.deepEqual(transportProposals.map((proposal) => ({
    range: proposal.rawRange,
    keptRawPointIds: proposal.evidence.keptRawPointIds,
    rejectedRawPointIds: proposal.evidence.rejectedRawPointIds,
    pendingRawPointIds: proposal.evidence.pendingRawPointIds,
    countsDistance: proposal.evidence.countsDistance,
    countsMovingTime: proposal.evidence.countsMovingTime
  })), [
    {
      range: range(3, 3),
      keptRawPointIds: [3],
      rejectedRawPointIds: [],
      pendingRawPointIds: [],
      // 里程口径变更：kept 的 transport 点证据如实标 true。
      countsDistance: true,
      countsMovingTime: true
    },
    {
      range: range(4, 4),
      keptRawPointIds: [4],
      rejectedRawPointIds: [],
      pendingRawPointIds: [],
      countsDistance: true,
      countsMovingTime: true
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'transport_contamination',
      range: range(3, 3),
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    },
    {
      scenario: 'transport_contamination',
      range: range(4, 4),
      affectedMetricGates: ['distance', 'moving_time', 'elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 2) },
    { type: 'hard_boundary', scenario: 'transport_contamination', range: range(3, 3) },
    { type: 'hard_boundary', scenario: 'transport_contamination', range: range(4, 4) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good'
    },
    {
      sourceRawPointId: 3,
      reason: 'recovery_transport_suspected_kept'
    },
    {
      sourceRawPointId: 4,
      reason: 'transport_suspected_kept'
    }
  ]);
  // 里程口径变更（2026-08-01）：kept 的 transport 点计入产物总里程/移动时长。
  assert.ok(state.localRebuild.stats.totalDistanceMeters > 20);
  assert.equal(state.localRebuild.stats.movingTimeSeconds, 1);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine feeds pressure jump recognizer proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      sessionMetadata(1),
      samplingPolicy(2),
      barometerWindow(3, 1, 1_000_000_000, 1_000_000_000, 100),
      locationSample(11, 1, 30, 120, 5, 1_000_000_000),
      barometerWindow(4, 2, 1_000_000_000, 4_000_000_000, 130),
      locationSample(12, 2, 30.00002, 120, 5, 4_000_000_000)
    ],
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.equal(state.metricAccumulator.stats.barometerAscentRejectedSampleCount, 1);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .hardBoundaryCheckpoints.map((item) => ({
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      scenario: 'pressure_jump',
      range: range(2, 2),
      affectedMetricGates: ['elevation']
    }
  ]);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      type: 'base_kernel',
      scenario: null,
      range: range(1, 1),
      affectedMetricGates: []
    },
    {
      type: 'hard_boundary',
      scenario: 'pressure_jump',
      range: range(2, 2),
      affectedMetricGates: ['elevation']
    }
  ]);
});

test('streaming track engine feeds rest photo micro move proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: {
      ...CONFIG,
      restPhotoMicroMoveMinTrackPoints: 8,
      restPhotoMicroMoveMaxTrackPoints: 8
    }
  }), {
    events: restPhotoMicroMoveEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.equal(state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .some((proposal) => proposal.scenario === 'rest_photo_micro_move'), true);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      type: 'scenario_owner',
      scenario: 'rest_photo_micro_move',
      range: range(1, 8),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime,
    contributingRawPointIds: point.contributingRawPointIds
  })), [
    {
      sourceRawPointId: 1,
      reason: 'rest_photo_micro_move_anchor',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: rawIdRange(1, 8)
    }
  ]);
  assert.equal(state.lastAdvanceSummary.product.committedTrackPointCount, 1);
  assert.equal(state.lastAdvanceSummary.product.stats.totalDistanceMeters, 0);

  const repeated = advanceStreamingTrackEngine(state, {
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });
  assert.equal(repeated.lastAdvanceSummary.newEvidenceEventCount, 0);
  assert.equal(repeated.localRebuild.committedTrack.length, 1);
  assert.equal(repeated.localRebuild.lastAppliedProductTrackPoints.length, 0);
});

test('streaming track engine feeds stationary drift proposals into settlement', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: stationaryDriftEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false
  });

  assert.equal(state.lastAdvanceSummary.recognizer.proposalCount, 1);
  assert.deepEqual(state.baseKernel.excluded.rejected
    .filter((point) => point.reason === 'stationary_cloud_jitter')
    .map((point) => point.rawPointId), rawIdRange(2, 22));
  assert.equal(state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .some((proposal) => proposal.scenario === 'stationary_drift_collapse'), true);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range,
      affectedMetricGates: item.affectedMetricGates
    })), [
    {
      type: 'base_kernel',
      scenario: null,
      range: range(1, 1),
      affectedMetricGates: []
    },
    {
      type: 'scenario_owner',
      scenario: 'stationary_drift_collapse',
      range: range(2, 22),
      affectedMetricGates: ['route', 'distance', 'moving_time']
    },
    {
      type: 'base_kernel',
      scenario: null,
      range: range(23, 23),
      affectedMetricGates: []
    }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime,
    contributingRawPointIds: point.contributingRawPointIds || [point.sourceRawPointId]
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: [1]
    },
    {
      sourceRawPointId: 4,
      reason: 'stationary_drift_anchor',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: rawIdRange(2, 22)
    },
    {
      sourceRawPointId: 23,
      reason: 'moving_good_fix',
      countsDistance: true,
      countsMovingTime: true,
      contributingRawPointIds: [23]
    }
  ]);
  assert.equal(state.lastAdvanceSummary.product.committedTrackPointCount, 3);
  assert.ok(state.lastAdvanceSummary.product.stats.totalDistanceMeters > 100);
});

test('streaming track engine applies dense main route local rebuild on finish', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: {
      ...CONFIG,
      denseMainRouteMaxBboxMeters: 140,
      denseMainRouteMinTrackPoints: 10,
      denseMainRouteSimplifyToleranceMeters: 15
    }
  }), {
    events: denseMainRouteEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });

  const denseProposal = state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .find((proposal) => proposal.scenario === 'dense_main_route_settlement');
  assert.ok(denseProposal);
  assert.equal(denseProposal.localRebuild, 'dense_main_route_skeleton');
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 1) },
    { type: 'scenario_owner', scenario: 'dense_main_route_settlement', range: range(2, 16) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    localRebuild: point.localRebuild || null,
    countsDistance: point.countsDistance
  })), [
    {
      sourceRawPointId: 1,
      reason: 'first_fix_good',
      localRebuild: null,
      countsDistance: false
    },
    {
      sourceRawPointId: 2,
      reason: 'dense_main_route_start',
      localRebuild: 'dense_main_route_skeleton',
      countsDistance: true
    },
    {
      sourceRawPointId: 16,
      reason: 'dense_main_route_end',
      localRebuild: 'dense_main_route_skeleton',
      countsDistance: true
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
  assert.ok(state.localRebuild.committedTrack.at(-1).contributingRawPointIds.length > 1);
  assert.ok(state.localRebuild.stats.totalDistanceMeters < state.baseKernel.stats.totalDistanceMeters);
});

test('streaming track engine applies round trip line local rebuild proposal', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: roundTripRouteEvents(),
    proposals: [
      roundTripProposal('round_trip_line')
    ]
  });

  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'scenario_owner', scenario: 'round_trip_line', range: range(1, 5) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    localRebuild: point.localRebuild,
    contributingRawPointIds: point.contributingRawPointIds,
    countsDistance: point.countsDistance
  })), [
    {
      sourceRawPointId: 1,
      reason: 'round_trip_interwoven_start',
      localRebuild: 'round_trip_polyline',
      contributingRawPointIds: [1],
      countsDistance: false
    },
    {
      sourceRawPointId: 3,
      reason: 'round_trip_turn',
      localRebuild: 'round_trip_polyline',
      contributingRawPointIds: [2, 3],
      countsDistance: true
    },
    {
      sourceRawPointId: 5,
      reason: 'round_trip_interwoven_end',
      localRebuild: 'round_trip_polyline',
      contributingRawPointIds: [4, 5],
      countsDistance: true
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
  assert.equal(state.localRebuild.committedTrack.length, 3);
  assert.ok(state.localRebuild.stats.totalDistanceMeters > 150);
});

test('streaming track engine applies same road round trip centerline proposal', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: roundTripRouteEvents(),
    proposals: [
      roundTripProposal('same_road_round_trip')
    ]
  });

  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'scenario_owner', scenario: 'same_road_round_trip', range: range(1, 5) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    localRebuild: point.localRebuild,
    coordinateSource: point.coordinateSource,
    virtualCoordinate: point.virtualCoordinate
  })), [
    {
      sourceRawPointId: 1,
      reason: 'round_trip_interwoven_start',
      localRebuild: 'same_road_centerline',
      coordinateSource: 'same_road_corridor_center',
      virtualCoordinate: true
    },
    {
      sourceRawPointId: 2,
      reason: 'round_trip_interwoven_shape',
      localRebuild: 'same_road_centerline',
      coordinateSource: 'same_road_corridor_center',
      virtualCoordinate: true
    },
    {
      sourceRawPointId: 3,
      reason: 'round_trip_turn',
      localRebuild: 'same_road_centerline',
      coordinateSource: 'raw',
      virtualCoordinate: false
    },
    {
      sourceRawPointId: 4,
      reason: 'round_trip_interwoven_shape',
      localRebuild: 'same_road_centerline',
      coordinateSource: 'same_road_corridor_center',
      virtualCoordinate: true
    },
    {
      sourceRawPointId: 5,
      reason: 'round_trip_interwoven_end',
      localRebuild: 'same_road_centerline',
      coordinateSource: 'same_road_corridor_center',
      virtualCoordinate: true
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
  assert.equal(state.localRebuild.committedTrack.length, 5);
  assert.ok(state.localRebuild.committedTrack[0].lat > latFromNorthMeters(30, 0));
});

test('streaming track engine applies enclosed loop cluster local rebuild proposal', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: enclosedLoopSettlementEvents(),
    proposals: [
      enclosedLoopSettlementProposal()
    ]
  });

  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    {
      type: 'scenario_owner',
      scenario: 'enclosed_loop_cluster_settlement',
      range: range(1, 8)
    }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    localRebuild: point.localRebuild,
    countsDistance: point.countsDistance,
    countsMovingTime: point.countsMovingTime,
    contributingRawPointIds: point.contributingRawPointIds
  })), [
    {
      sourceRawPointId: 1,
      reason: 'enclosed_loop_cluster_start',
      localRebuild: 'enclosed_loop_anchor_settlement',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: [1]
    },
    {
      sourceRawPointId: 8,
      reason: 'enclosed_loop_cluster_end',
      localRebuild: 'enclosed_loop_anchor_settlement',
      countsDistance: false,
      countsMovingTime: false,
      contributingRawPointIds: rawIdRange(2, 8)
    }
  ]);
  assert.equal(state.localRebuild.stats.totalDistanceMeters, 0);
  assert.equal(state.localRebuild.stats.movingTimeSeconds, 0);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine auto-recognizes same road round trip on finish', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: {
      ...CONFIG,
      ...roundTripRecognizerConfig()
    }
  }), {
    events: roundTripRouteEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });
  const proposal = state.scenarioSettlementSession.lastSettlementPlan.activeProposals
    .find((item) => item.scenario === 'same_road_round_trip');

  assert.ok(proposal);
  assert.equal(proposal.localRebuild, 'same_road_centerline');
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'scenario_owner', scenario: 'same_road_round_trip', range: range(1, 5) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    reason: point.reason,
    localRebuild: point.localRebuild
  })), [
    {
      sourceRawPointId: 1,
      reason: 'round_trip_interwoven_start',
      localRebuild: 'same_road_centerline'
    },
    {
      sourceRawPointId: 2,
      reason: 'round_trip_interwoven_shape',
      localRebuild: 'same_road_centerline'
    },
    {
      sourceRawPointId: 3,
      reason: 'round_trip_turn',
      localRebuild: 'same_road_centerline'
    },
    {
      sourceRawPointId: 4,
      reason: 'round_trip_interwoven_shape',
      localRebuild: 'same_road_centerline'
    },
    {
      sourceRawPointId: 5,
      reason: 'round_trip_interwoven_end',
      localRebuild: 'same_road_centerline'
    }
  ]);
  assert.equal(state.localRebuild.unsupportedScenarioCount, 0);
});

test('streaming track engine keeps diagnostic context out of metric ownership', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: {
      ...CONFIG,
      restPhotoMicroMoveEnabled: false,
      denseMainRouteSettlementEnabled: false,
      roundTripLineSimplifyEnabled: false,
      roundTripSameRoadCollapseEnabled: false,
      closedLoopRoundTripEnabled: false
    }
  }), {
    events: denseAreaIntentEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });
  const context = state.scenarioSettlementSession.lastSettlementPlan.contextProposals
    .find((proposal) => proposal.scenario === 'dense_area_intent');

  assert.ok(context);
  assert.equal(context.metricOwner, false);
  assert.equal(context.coordinatorState, 'context_only');
  assert.equal(state.scenarioSettlementSession.settlementState.committedCursorRawPointId, 8);
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 8) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) =>
    point.sourceRawPointId), rawIdRange(1, 8));
});

test('streaming track engine keeps enclosed gap cluster out of metric ownership', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: normalWalkEvents(),
    proposals: [
      enclosedGapClusterContextProposal()
    ],
    finish: true
  });
  const context = state.scenarioSettlementSession.lastSettlementPlan.contextProposals
    .find((proposal) => proposal.scenario === 'enclosed_gap_cluster');

  assert.ok(context);
  assert.equal(context.metricOwner, false);
  assert.equal(context.coordinatorState, 'context_only');
  assert.deepEqual(context.affectedMetricGates, []);
  assert.deepEqual(context.anchorRawPointIds, [2, 3]);
  assert.equal(state.lastAdvanceSummary.diagnosticContexts.totalCount, 1);
  assert.deepEqual(state.lastAdvanceSummary.diagnosticContexts.scenarioCounts, [
    { scenario: 'enclosed_gap_cluster', count: 1 }
  ]);
  assert.deepEqual(state.lastAdvanceSummary.diagnosticContexts.contexts[0].rawRange,
    range(1, 3));
  assert.equal(
    state.lastAdvanceSummary.diagnosticContexts.contexts[0].evidence.gapClusterIntentSupported,
    true
  );
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 3) }
  ]);
  assert.deepEqual(state.localRebuild.committedTrack.map((point) =>
    point.sourceRawPointId), rawIdRange(1, 3));
});

test('streaming track engine keeps composite round trip guard out of metric ownership', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: {
      ...CONFIG,
      ...roundTripRecognizerConfig({
        roundTripSameRoadCollapseEnabled: false,
        roundTripLineNoIntentMaxDurationSeconds: 60,
        roundTripLineNoIntentMaxSampleGapSeconds: 10
      })
    }
  }), {
    events: roundTripRouteEvents(),
    enableScenarioRecognizers: true,
    emitScenarioRecognizerOpenWindows: false,
    finish: true
  });
  const context = state.scenarioSettlementSession.lastSettlementPlan.contextProposals
    .find((proposal) => proposal.scenario === 'composite_gap_local_settlement');

  assert.ok(context);
  assert.equal(context.metricOwner, false);
  assert.equal(context.coordinatorState, 'context_only');
  assert.equal(context.evidence.rejectionReason,
    'missing_round_trip_intent_long_composite_span');
  assert.deepEqual(context.anchorRawPointIds, [3]);
  assert.equal(context.evidence.turnRawPointId, 3);
  assert.equal(context.evidence.endpointRawPointId, 3);
  assert.equal(state.lastAdvanceSummary.diagnosticContexts.totalCount, 1);
  assert.equal(state.lastAdvanceSummary.diagnosticContexts.contexts[0].scenario,
    'composite_gap_local_settlement');
  assert.deepEqual(state.scenarioSettlementSession.settlementState
    .committedMetricOwnershipRanges.map((item) => ({
      type: item.type,
      scenario: item.scenario,
      range: item.range
    })), [
    { type: 'base_kernel', scenario: null, range: range(1, 5) }
  ]);
});

test('streaming track engine can let recognizer open windows hold the latest point', () => {
  const state = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: normalWalkEvents().slice(0, 4),
    enableScenarioRecognizers: true
  });

  assert.equal(state.lastAdvanceSummary.recognizer.openWindowCount, 1);
  assert.equal(state.scenarioSettlementSession.settlementState.committedCursorRawPointId, 1);
  assert.deepEqual(state.scenarioSettlementSession.settlementState.blockingRanges.map((item) =>
    item.range), [range(2, 2)]);
});

test('streaming track engine does not accumulate duplicate barometer events twice', () => {
  const first = advanceStreamingTrackEngine(createStreamingTrackEngineState({
    config: CONFIG
  }), {
    events: [
      barometerWindow(1, 1, 1_000_000_000, 1_000_000_000, 100),
      barometerWindow(2, 2, 4_000_000_000, 4_000_000_000, 104)
    ]
  });
  const duplicate = advanceStreamingTrackEngine(first, {
    events: [
      barometerWindow(2, 2, 4_000_000_000, 4_000_000_000, 104)
    ]
  });

  assert.equal(duplicate.evidenceIntake.duplicateEventCount, 1);
  assert.equal(duplicate.lastAdvanceSummary.newEvidenceEventCount, 0);
  assert.equal(duplicate.metricAccumulator.stats.barometerAscentSampleCount, 2);
  assert.equal(duplicate.metricAccumulator.stats.selectedTotalAscentMeters, 4);
});

function normalWalkLines() {
  return normalWalkEvents().map((event) => JSON.stringify(event));
}

function normalWalkEvents() {
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000),
    locationSample(12, 2, 30.0001, 120, 5, 31_000_000_000),
    locationSample(13, 3, 30.0002, 120, 5, 61_000_000_000)
  ];
}

function movingSpikeEvents() {
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000),
    locationSample(12, 2, 30, 120.0001, 5, 31_000_000_000),
    locationSample(13, 3, 30.00008, 120.00015, 5, 61_000_000_000, {
      speedMetersPerSecond: 0
    }),
    locationSample(14, 4, 30, 120.0002, 5, 91_000_000_000),
    locationSample(15, 5, 30, 120.0003, 5, 121_000_000_000)
  ];
}

function positionSnapEvents() {
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000, {
      speedMetersPerSecond: 1
    }),
    locationSample(12, 2, 30.0002, 120, 5, 2_000_000_000, {
      speedMetersPerSecond: 1.2
    }),
    locationSample(13, 3, 30.00023, 120, 5, 5_000_000_000, {
      speedMetersPerSecond: 0.8
    }),
    locationSample(14, 4, 30.00026, 120, 5, 11_000_000_000, {
      speedMetersPerSecond: 0.8
    }),
    locationSample(15, 5, 30.00035, 120, 5, 14_000_000_000, {
      speedMetersPerSecond: 0.8
    })
  ];
}

function unstableTransportPrefixEvents() {
  const points = [
    [1, 29.603644955104933, 106.50425320404503, 20, 3.95, 1],
    [2, 29.60385450221229, 106.5042583786816, 19.34, 0, 2],
    [3, 29.603288064772393, 106.50444585081547, 55.25, null, 41.2],
    [4, 29.60211104006017, 106.50481700192438, 34.14, 8.16, 45],
    [5, 29.602037750020088, 106.50482485798724, 34.14, 8.16, 46],
    [6, 29.602333397089158, 106.50456261527545, 16.29, 8.44, 47],
    [7, 29.602177135281945, 106.5046545754444, 14, 7.96, 48],
    [8, 29.60205243777343, 106.50470714807193, 14, 8.24, 49],
    [9, 29.60194281137089, 106.5047289244814, 14, 8.68, 50],
    [10, 29.601849091909436, 106.5047400750844, 9.46, 8.64, 51]
  ];
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    ...points.map(([sampleId, lat, lng, accuracy, speed, elapsedSeconds], index) =>
      locationSample(11 + index, sampleId, lat, lng, accuracy,
        elapsedSeconds * 1_000_000_000, {
          ...(speed === null ? {} : { speedMetersPerSecond: speed })
        }))
  ];
}

function weakRecoveryEndpointEvents() {
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000, {
      speedMetersPerSecond: 1
    }),
    locationSample(12, 2,
      latFromNorthMeters(30, 170),
      lngFromEastMeters(30, 120, 2),
      48,
      150_000_000_000, {
        speedMetersPerSecond: 0
      }),
    locationSample(13, 3,
      latFromNorthMeters(30, 168),
      lngFromEastMeters(30, 120, 0),
      38,
      152_000_000_000, {
        speedMetersPerSecond: 0
      }),
    locationSample(14, 4,
      latFromNorthMeters(30, 167),
      lngFromEastMeters(30, 120, 1),
      33,
      153_000_000_000, {
        speedMetersPerSecond: 0
      }),
    locationSample(15, 5,
      latFromNorthMeters(30, 168),
      lngFromEastMeters(30, 120, 2),
      64,
      156_000_000_000, {
        speedMetersPerSecond: 0
      }),
    locationSample(16, 6,
      latFromNorthMeters(30, 174),
      lngFromEastMeters(30, 120, 2),
      8,
      580_000_000_000, {
        speedMetersPerSecond: 1
      })
  ];
}

function recoveryTransportEvents() {
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000),
    locationSample(12, 2, 30.01, 120, 50, 130_000_000_000, {
      speedMetersPerSecond: 20
    }),
    locationSample(13, 3, 30.0104, 120, 34, 132_000_000_000, {
      speedMetersPerSecond: 20
    }),
    locationSample(14, 4, 30.0106, 120, 36, 133_000_000_000, {
      speedMetersPerSecond: 20
    })
  ];
}

function denseMainRouteEvents() {
  const offsets = [
    [0, 0], [8, 6], [16, -6], [24, 6], [32, -6], [40, 6],
    [48, -6], [56, 6], [64, -6], [72, 6], [80, -6], [88, 6],
    [96, -6], [104, 6], [112, -6], [120, 0]
  ];
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    ...offsets.map(([eastMeters, northMeters], index) =>
      locationSample(30 + index, index + 1,
        latFromNorthMeters(30, northMeters),
        lngFromEastMeters(30, 120, eastMeters),
        5,
        1_000_000_000 + index * 4_000_000_000, {
          speedMetersPerSecond: 1.2
        }))
  ];
}

function denseAreaIntentEvents() {
  const offsets = [
    [0, 0], [20, 0], [40, 0], [60, 0],
    [40, 0], [20, 0], [0, 0], [8, 0]
  ];
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    ...offsets.map(([eastMeters, northMeters], index) =>
      locationSample(50 + index, index + 1,
        latFromNorthMeters(30, northMeters),
        lngFromEastMeters(30, 120, eastMeters),
        5,
        1_000_000_000 + index * 10_000_000_000, {
          speedMetersPerSecond: 1.2
        }))
  ];
}

function roundTripRouteEvents() {
  const offsets = [
    [0, 0], [40, 0], [80, 0], [40, 2], [0, 1]
  ];
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    ...offsets.map(([eastMeters, northMeters], index) =>
      locationSample(70 + index, index + 1,
        latFromNorthMeters(30, northMeters),
        lngFromEastMeters(30, 120, eastMeters),
        5,
        1_000_000_000 + index * 30_000_000_000, {
          speedMetersPerSecond: 1.2
        }))
  ];
}

function roundTripProposal(scenario) {
  const sameRoad = scenario === 'same_road_round_trip';
  return {
    id: `${scenario}:1-5`,
    scenario,
    confidence: 0.8,
    rawRange: range(1, 5),
    influenceRange: range(1, 5),
    metricRange: range(1, 5),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: sameRoad ? 'centerline_with_endpoint' : 'rdp_line_simplify',
    localRebuild: sameRoad ? 'same_road_centerline' : 'round_trip_polyline',
    evidence: {
      startRawPointId: 1,
      turnRawPointId: 3,
      endpointRawPointId: 3,
      endRawPointId: 5,
      inputTrackPointCount: 5,
      outputTrackPointCount: sameRoad ? 5 : 3,
      endpointDistanceMeters: 1,
      turnDistanceMeters: 80,
      crossTrackMeters: 2,
      durationSeconds: 120,
      maxSampleGapSeconds: 30,
      simplifyToleranceMeters: 10,
      sameRoadBboxMeters: sameRoad ? 4 : null,
      sameRoadApproachPairDistanceMeters: sameRoad ? 2 : null,
      sameRoadCollapseEligible: sameRoad,
      sameRoadCollapseReason: sameRoad
        ? 'strong_same_road_geometry_without_round_trip_intent'
        : 'not_evaluated',
      denseAreaIntents: [],
      roundTripIntentSupported: false
    }
  };
}

function enclosedLoopSettlementEvents() {
  const offsets = [
    [0, 0], [20, 0], [40, 0], [40, 20],
    [20, 40], [0, 20], [-20, 0], [0, 0]
  ];
  return [
    sessionMetadata(1),
    samplingPolicy(2),
    ...offsets.map(([eastMeters, northMeters], index) =>
      locationSample(90 + index, index + 1,
        latFromNorthMeters(30, northMeters),
        lngFromEastMeters(30, 120, eastMeters),
        5,
        1_000_000_000 + index * 20_000_000_000, {
          speedMetersPerSecond: 1.2
        }))
  ];
}

function enclosedLoopSettlementProposal() {
  return {
    id: 'enclosed-loop-cluster:1-8',
    scenario: 'enclosed_loop_cluster_settlement',
    confidence: 0.84,
    rawRange: range(1, 8),
    influenceRange: range(1, 8),
    metricRange: range(1, 8),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    anchorRawPointIds: [1, 8],
    action: 'compress_enclosed_loop_low_speed_drift',
    localRebuild: 'enclosed_loop_anchor_settlement',
    evidence: {
      keptRawPointIds: [1, 8],
      inputTrackPointCount: 8,
      outputTrackPointCount: 2,
      removedTrackPointCount: 6,
      originalDistanceMeters: 120,
      settledDistanceMeters: 0,
      gapRecoveryCount: 3,
      stationaryAnchorCount: 3,
      bboxDiagonalMeters: 60,
      durationSeconds: 140,
      denseAreaIntents: ['gap_cluster'],
      gapClusterIntentSupported: true,
      mixedIntentSupported: false
    }
  };
}

function enclosedGapClusterContextProposal() {
  return {
    id: 'enclosed-gap-cluster:1-3',
    scenario: 'enclosed_gap_cluster',
    confidence: 0.8,
    rawRange: range(1, 3),
    influenceRange: range(1, 3),
    metricRange: range(1, 3),
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'gap_cluster_diagnostic'],
    anchorRawPointIds: [2, 3],
    action: 'classify_enclosed_gap_cluster',
    localRebuild: 'gap_stationary_cluster_diagnostic',
    evidence: {
      startTrackPointId: 1,
      endTrackPointId: 3,
      trackPointCount: 3,
      gapRecoveryCount: 1,
      stationaryAnchorCount: 1,
      segmentIds: [1],
      bboxDiagonalMeters: 12,
      durationSeconds: 60,
      denseAreaIntents: ['gap_cluster'],
      gapClusterIntentSupported: true,
      mixedIntentSupported: false
    }
  };
}

function roundTripRecognizerConfig(overrides = {}) {
  return {
    roundTripLineMinTrackPoints: 5,
    roundTripLineMaxEndpointDistanceMeters: 6,
    roundTripLineMinTurnDistanceMeters: 60,
    roundTripLineMaxCrossTrackMeters: 10,
    roundTripLineSimplifyToleranceMeters: 10,
    roundTripSameRoadNoIntentMaxBboxMeters: 45,
    roundTripSameRoadNoIntentMaxApproachPairDistanceMeters: 10,
    ...overrides
  };
}

function restPhotoMicroMoveEvents() {
  const offsets = [
    [0, 0], [5, 0], [0, 5], [5, 5],
    [0, 0], [5, -5], [0, -5], [2, 0]
  ];
  const events = [
    sessionMetadata(1),
    samplingPolicy(2)
  ];
  offsets.forEach(([eastMeters, northMeters], index) => {
    const rawPointId = index + 1;
    const fixElapsedRealtimeNanos = 1_000_000_000 + index * 10_000_000_000;
    if (index > 0) {
      events.push(motionWindow(100 + index,
        fixElapsedRealtimeNanos - 1_000_000_000,
        fixElapsedRealtimeNanos, {
          accelerometerDynamicRmsMps2: 0.8,
          gyroscopeRmsRadps: 0.16,
          stepCounterDelta: 3
        }));
    }
    events.push(locationSample(20 + index, rawPointId,
      latFromNorthMeters(30, northMeters),
      lngFromEastMeters(30, 120, eastMeters),
      1,
      fixElapsedRealtimeNanos));
  });
  return events;
}

function stationaryDriftEvents() {
  const events = [
    sessionMetadata(1),
    samplingPolicy(2),
    locationSample(11, 1, 30, 120, 5, 1_000_000_000, {
      speedMetersPerSecond: 0
    })
  ];
  for (let rawPointId = 2; rawPointId <= 22; rawPointId++) {
    const index = rawPointId - 2;
    events.push(locationSample(20 + rawPointId, rawPointId,
      latFromNorthMeters(30, index % 2 === 0 ? 0 : 2),
      lngFromEastMeters(30, 120, index % 3 === 0 ? 0 : 2),
      30,
      4_000_000_000 + index * 3_000_000_000, {
        speedMetersPerSecond: 0
      }));
  }
  events.push(locationSample(80, 23, 30.001, 120, 5, 67_000_000_000, {
    speedMetersPerSecond: 1.2
  }));
  return events;
}

function sessionMetadata(eventSeq) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'session_metadata',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: 1_000_000_000,
    createdElapsedRealtimeNanos: 1_000_000_000
  };
}

function samplingPolicy(eventSeq) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'sampling_policy',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: 1_000_000_000,
    samplingEpochId: 1,
    state: 'MOVING_STANDARD',
    startedElapsedRealtimeNanos: 1_000_000_000
  };
}

function locationSample(eventSeq, sampleId, lat, lng, horizontalAccuracyMeters,
  fixElapsedRealtimeNanos, overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'location_sample',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    sampleId,
    provider: 'gnss',
    lat,
    lng,
    horizontalAccuracyMeters,
    speedMetersPerSecond: 1.2,
    wallTimeMillis: 1_760_000_000_000 + fixElapsedRealtimeNanos / 1_000_000,
    fixElapsedRealtimeNanos,
    receivedElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    callbackDelayNanos: 10_000_000,
    samplingEpochId: 1,
    isMock: false,
    ...overrides
  };
}

function motionWindow(eventSeq, startElapsedRealtimeNanos, endElapsedRealtimeNanos,
  overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'motion_window',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: endElapsedRealtimeNanos,
    windowId: eventSeq,
    startElapsedRealtimeNanos,
    endElapsedRealtimeNanos,
    ...overrides
  };
}

function barometerWindow(eventSeq, windowId, startElapsedRealtimeNanos,
  endElapsedRealtimeNanos, avgRawBarometerAltitudeMeters, overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'barometer_window',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: endElapsedRealtimeNanos,
    windowId,
    startElapsedRealtimeNanos,
    endElapsedRealtimeNanos,
    avgPressureHpa: 1000,
    avgRawBarometerAltitudeMeters,
    ...overrides
  };
}

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function sampleRange(startSampleId, endSampleId) {
  return { startSampleId, endSampleId };
}

function rawIdRange(startRawPointId, endRawPointId) {
  const values = [];
  for (let rawPointId = startRawPointId; rawPointId <= endRawPointId; rawPointId++) {
    values.push(rawPointId);
  }
  return values;
}

function rounded(value) {
  return Number.isFinite(value) && value > 0 ? 'checked' : value;
}

function latFromNorthMeters(originLat, northMeters) {
  return originLat + northMeters / 111_320;
}

function lngFromEastMeters(originLat, originLng, eastMeters) {
  return originLng + eastMeters / (111_320 * Math.cos(originLat * Math.PI / 180));
}
