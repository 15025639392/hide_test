import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceStreamingScenarioRecognizer,
  createStreamingScenarioRecognizerState
} from '../src/track-cleaning/streamingScenarioRecognizer.mjs';

test('streaming scenario recognizer emits moving spike cleanup proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: spikeTrack()
  }, {
    enabled: true,
    emitOpenWindows: false
  });

  assert.equal(state.proposals.length, 1);
  assert.deepEqual({
    ...state.proposals[0],
    evidence: {
      ...state.proposals[0].evidence,
      detourMeters: 'checked',
      lateralMeters: 'checked',
      bridgeDistanceMeters: 'checked'
    }
  }, {
    id: 'moving-spike:2-3-4',
    scenario: 'moving_spike_cleanup',
    confidence: 0.82,
    rawRange: range(2, 4),
    influenceRange: range(2, 4),
    metricRange: range(2, 4),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'remove_single_point_spike',
    localRebuild: 'moving_spike_line_bridge',
    evidence: {
      previousRawPointId: 2,
      spikeRawPointId: 3,
      nextRawPointId: 4,
      reportedSpeedMetersPerSecond: 0,
      detourMeters: 'checked',
      lateralMeters: 'checked',
      bridgeDistanceMeters: 'checked',
      speedPolicy: 'strict_low_reported_speed'
    }
  });
  assert.ok(state.proposals[0].evidence.detourMeters > 1.5);
  assert.ok(state.proposals[0].evidence.lateralMeters > 2.5);
  assert.ok(state.proposals[0].evidence.bridgeDistanceMeters < 15);
});

test('streaming scenario recognizer keeps a small open window for the latest point', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: spikeTrack().slice(0, 2)
  }, {
    enabled: true
  });

  assert.deepEqual(state.proposals, []);
  assert.deepEqual(state.openWindows.map((window) => ({
    id: window.id,
    scenario: window.scenario,
    range: window.influenceRange,
    reason: window.reason
  })), [
    {
      id: 'moving-spike-open:1-2',
      scenario: 'moving_spike_cleanup',
      range: range(2, 2),
      reason: 'awaiting_next_point'
    }
  ]);
});

test('streaming scenario recognizer does not emit the same proposal twice', () => {
  const first = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: spikeTrack()
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const second = advanceStreamingScenarioRecognizer(first, {
    track: spikeTrack()
  }, {
    enabled: true,
    emitOpenWindows: false
  });

  assert.equal(first.proposals.length, 1);
  assert.equal(second.proposals.length, 0);
  assert.deepEqual(second.emittedProposalIds, ['moving-spike:2-3-4']);
});

test('streaming scenario recognizer emits position snap recovery proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120),
      point(4, 30.00026, 120, {
        reportedSpeedMetersPerSecond: 0.8
      })
    ],
    excluded: {
      weak: [
        weakPoint(2),
        weakPoint(3)
      ]
    }
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'position_snap_recovery');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    evidence: {
      ...proposal.evidence,
      bridgeDistanceMeters: 'checked'
    }
  }, {
    id: 'position-snap:1-4',
    scenario: 'position_snap_recovery',
    confidence: 0.82,
    rawRange: range(2, 4),
    influenceRange: range(2, 4),
    metricRange: range(2, 4),
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
    action: 'reset_position_snap_recovery_delta',
    localRebuild: 'position_snap_recovery_anchor',
    evidence: {
      previousRawPointId: 1,
      recoveryRawPointId: 4,
      weakRawPointIds: [2, 3],
      bridgeDistanceMeters: 'checked',
      reportedSpeedMetersPerSecond: 0.8,
      countsDistance: false,
      countsMovingTime: false
    }
  });
  assert.ok(proposal.evidence.bridgeDistanceMeters > 20);
});

test('streaming scenario recognizer emits weak recovery endpoint proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120, {
        elapsedRealtimeNanos: 1_000_000_000
      })
    ],
    excluded: {
      weak: [
        weakGapRecoveryPoint(2, 150, 2, 170, 48),
        weakGapRecoveryPoint(3, 152, 0, 168, 38),
        weakGapRecoveryPoint(4, 153, 1, 167, 33),
        weakGapRecoveryPoint(5, 156, 2, 168, 64)
      ]
    },
    lastProcessedRawPointId: 6
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'weak_recovery_endpoint');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      gapSeconds: 'checked',
      coreRadiusMeters: 'checked',
      cloudRadiusMeters: 'checked',
      distanceFromPreviousTrustedMeters: 'checked'
    }
  }, {
    id: 'weak-recovery-endpoint:2-5',
    scenario: 'weak_recovery_endpoint',
    confidence: 'checked',
    rawRange: range(2, 5),
    influenceRange: range(2, 5),
    metricRange: range(2, 5),
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
    anchorRawPointIds: [4, 5],
    action: 'preserve_endpoint_anchor',
    localRebuild: 'weak_recovery_shape_anchor',
    evidence: {
      previousTrustedRawPointId: 1,
      coreStartRawPointId: 2,
      coreEndRawPointId: 4,
      coreSampleCount: 3,
      preservedRawPointCount: 4,
      preservedRawPointIds: [2, 3, 4, 5],
      representativeRawPointId: 4,
      gapSeconds: 'checked',
      coreRadiusMeters: 'checked',
      cloudRadiusMeters: 'checked',
      bestAccuracyMeters: 33,
      distanceFromPreviousTrustedMeters: 'checked',
      endpointRawPointId: 5,
      coordinatePolicy: 'cloud_center_then_endpoint_when_same_road_rewrite',
      countsDistance: false,
      countsMovingTime: false,
      countsElevation: false
    }
  });
  assert.ok(proposal.evidence.distanceFromPreviousTrustedMeters > 50);
});

test('streaming scenario recognizer keeps weak recovery endpoint open before enough samples', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120, {
        elapsedRealtimeNanos: 1_000_000_000
      })
    ],
    excluded: {
      weak: [
        weakGapRecoveryPoint(2, 150, 2, 170, 48),
        weakGapRecoveryPoint(3, 152, 0, 168, 38)
      ]
    },
    lastProcessedRawPointId: 3
  }, {
    enabled: true
  });
  const recoveryOpen = state.openWindows.find((window) =>
    window.scenario === 'weak_recovery_endpoint');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'weak_recovery_endpoint'), false);
  assert.ok(recoveryOpen);
  assert.deepEqual({
    id: recoveryOpen.id,
    scenario: recoveryOpen.scenario,
    range: recoveryOpen.influenceRange,
    reason: recoveryOpen.reason,
    preservedRawPointCount: recoveryOpen.evidence.preservedRawPointCount
  }, {
    id: 'weak-recovery-open:2-3',
    scenario: 'weak_recovery_endpoint',
    range: range(2, 3),
    reason: 'awaiting_weak_recovery_shape_samples',
    preservedRawPointCount: 2
  });
});

test('streaming scenario recognizer emits GAP recovery hard boundary proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120),
      point(2, 30.001, 120, {
        reason: 'gap_recovery',
        segmentId: 2,
        startsNewSegment: true,
        distanceDeltaMeters: 0,
        movingTimeDeltaSeconds: 0,
        countsDistance: false,
        countsMovingTime: false
      })
    ]
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'gap_recovery_boundary');

  assert.ok(proposal);
  assert.deepEqual(proposal, {
    id: 'gap-recovery:2',
    scenario: 'gap_recovery_boundary',
    confidence: 0.85,
    rawRange: range(2, 2),
    influenceRange: range(2, 2),
    metricRange: range(2, 2),
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
    action: 'reset_segment_zero_delta',
    localRebuild: 'gap_recovery_anchor',
    evidence: {
      recoveryRawPointId: 2,
      trackPointId: 2,
      segmentId: 2,
      startsNewSegment: true,
      distanceDeltaMeters: 0,
      movingTimeDeltaSeconds: 0,
      countsDistance: false,
      countsMovingTime: false
    }
  });
});

test('streaming scenario recognizer emits transport contamination hard boundary proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120)
    ],
    excluded: {
      rejected: [
        {
          rawPointId: 2,
          reason: 'transport_risk',
          distanceDeltaMeters: 111.2,
          movingTimeDeltaSeconds: 3
        }
      ]
    }
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'transport_contamination');

  assert.ok(proposal);
  assert.deepEqual(proposal, {
    id: 'transport-contamination:2',
    scenario: 'transport_contamination',
    confidence: 0.8,
    rawRange: range(2, 2),
    influenceRange: range(2, 2),
    metricRange: range(2, 2),
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['distance', 'moving_time', 'elevation'],
    action: 'preserve_route_exclude_hiking_metrics',
    localRebuild: 'transport_route_passthrough',
    evidence: {
      rejectedRawPointIds: [2],
      keptRawPointIds: [],
      pendingRawPointIds: [],
      suspectedDistanceMeters: 111.2,
      suspectedMovingTimeSeconds: 3,
      routePreserved: true,
      countsDistance: false,
      countsMovingTime: false
    }
  });
});

test('streaming scenario recognizer emits pressure jump elevation boundary proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120),
      point(2, 30.00003, 120)
    ],
    rawPointTimeline: [
      { rawPointId: 1, elapsedRealtimeNanos: 1_000_000_000 },
      { rawPointId: 2, elapsedRealtimeNanos: 4_000_000_000 }
    ]
  }, {
    enabled: true,
    emitOpenWindows: false,
    metricAccumulator: {
      barometerWindowDecisions: [
        {
          windowId: 7,
          startElapsedRealtimeNanos: 1_000_000_000,
          endElapsedRealtimeNanos: 4_000_000_000,
          result: 'rejected',
          reason: 'pressure_jump_detected',
          ascentDeltaMeters: 0,
          descentDeltaMeters: 0
        }
      ]
    }
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'pressure_jump');

  assert.ok(proposal);
  assert.deepEqual(proposal, {
    id: 'pressure-jump:7:2',
    scenario: 'pressure_jump',
    confidence: 0.78,
    rawRange: range(2, 2),
    influenceRange: range(2, 2),
    metricRange: range(2, 2),
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['elevation'],
    action: 'reset_barometer_anchor_zero_delta',
    localRebuild: 'barometer_pressure_jump_boundary',
    evidence: {
      barometerWindowId: 7,
      boundaryRawPointId: 2,
      startElapsedRealtimeNanos: 1_000_000_000,
      endElapsedRealtimeNanos: 4_000_000_000,
      ascentDeltaMeters: 0,
      descentDeltaMeters: 0,
      countsElevation: false
    }
  });
});

test('streaming scenario recognizer waits for raw coverage before pressure jump proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120)
    ],
    rawPointTimeline: [
      { rawPointId: 1, elapsedRealtimeNanos: 1_000_000_000 }
    ]
  }, {
    enabled: true,
    emitOpenWindows: false,
    metricAccumulator: {
      barometerWindowDecisions: [
        {
          windowId: 7,
          startElapsedRealtimeNanos: 1_000_000_000,
          endElapsedRealtimeNanos: 4_000_000_000,
          result: 'rejected',
          reason: 'pressure_jump_detected'
        }
      ]
    }
  });

  assert.equal(state.proposals.some((item) => item.scenario === 'pressure_jump'), false);
});

test('streaming scenario recognizer emits rest photo micro move proposal at safe cap', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: restPhotoTrack(1, 8)
  }, {
    enabled: true,
    emitOpenWindows: false,
    config: {
      restPhotoMicroMoveMinTrackPoints: 8,
      restPhotoMicroMoveMaxTrackPoints: 8
    }
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'rest_photo_micro_move');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      pathNetRatio: 'checked',
      bboxDiagonalMeters: 'checked'
    }
  }, {
    id: 'rest-photo:1-8',
    scenario: 'rest_photo_micro_move',
    confidence: 'checked',
    rawRange: range(1, 8),
    influenceRange: range(1, 8),
    metricRange: range(1, 8),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'collapse_micro_move_to_rest_anchor',
    localRebuild: 'rest_photo_micro_move_anchor',
    evidence: {
      startTrackPointId: 1,
      endTrackPointId: 8,
      trackPointCount: 8,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      pathNetRatio: 'checked',
      bboxDiagonalMeters: 'checked',
      durationSeconds: 70,
      lowSpeedRatio: 1,
      inputTrackPointCount: 8,
      outputTrackPointCount: 1
    }
  });
  assert.ok(proposal.evidence.pathMeters >= 20);
  assert.ok(proposal.evidence.pathNetRatio >= 4);
  assert.ok(proposal.evidence.bboxDiagonalMeters <= 25);
});

test('streaming scenario recognizer keeps rest photo micro move open before cap', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: restPhotoTrack(1, 8)
  }, {
    enabled: true,
    config: {
      restPhotoMicroMoveMinTrackPoints: 8,
      restPhotoMicroMoveMaxTrackPoints: 10
    }
  });
  const restOpen = state.openWindows.find((window) =>
    window.scenario === 'rest_photo_micro_move');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'rest_photo_micro_move'), false);
  assert.ok(restOpen);
  assert.deepEqual({
    id: restOpen.id,
    scenario: restOpen.scenario,
    range: restOpen.influenceRange,
    reason: restOpen.reason
  }, {
    id: 'rest-photo-open:1-8',
    scenario: 'rest_photo_micro_move',
    range: range(1, 8),
    reason: 'awaiting_micro_move_closure'
  });
});

test('streaming scenario recognizer emits dense main route proposal on finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: denseMainRouteTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: {
      denseMainRouteMinTrackPoints: 10,
      denseMainRouteSimplifyToleranceMeters: 7
    }
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'dense_main_route_settlement');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    evidence: {
      ...proposal.evidence,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      simplifiedPathMeters: 'checked',
      bboxDiagonalMeters: 'checked'
    }
  }, {
    id: 'dense-main-route:1-16',
    scenario: 'dense_main_route_settlement',
    confidence: 0.78,
    rawRange: range(1, 16),
    influenceRange: range(1, 16),
    metricRange: range(1, 16),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'preserve_dense_main_route_skeleton',
    localRebuild: 'dense_main_route_skeleton',
    evidence: {
      intent: 'forward_motion',
      keptRawPointIds: [1, 16],
      inputTrackPointCount: 16,
      outputTrackPointCount: 2,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      simplifiedPathMeters: 'checked',
      bboxDiagonalMeters: 'checked',
      simplifyToleranceMeters: 7
    }
  });
  assert.ok(proposal.evidence.outputTrackPointCount < proposal.evidence.inputTrackPointCount);
  assert.ok(proposal.evidence.simplifiedPathMeters < proposal.evidence.pathMeters);
});

test('streaming scenario recognizer keeps dense main route open before finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: denseMainRouteTrack()
  }, {
    enabled: true,
    config: {
      denseMainRouteMinTrackPoints: 10,
      denseMainRouteSimplifyToleranceMeters: 7
    }
  });
  const denseOpen = state.openWindows.find((window) =>
    window.scenario === 'dense_main_route_settlement');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'dense_main_route_settlement'), false);
  assert.ok(denseOpen);
  assert.deepEqual({
    id: denseOpen.id,
    scenario: denseOpen.scenario,
    range: denseOpen.influenceRange,
    reason: denseOpen.reason
  }, {
    id: 'dense-main-route-open:1-16',
    scenario: 'dense_main_route_settlement',
    range: range(1, 16),
    reason: 'awaiting_dense_route_exit'
  });
});

test('streaming scenario recognizer emits round trip line proposal on finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: roundTripRouteTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: roundTripRecognizerConfig({
      roundTripSameRoadCollapseEnabled: false
    })
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'round_trip_line');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      endpointDistanceMeters: 'checked',
      turnDistanceMeters: 'checked',
      crossTrackMeters: 'checked'
    }
  }, {
    id: 'round_trip_line:1-3-5',
    scenario: 'round_trip_line',
    confidence: 'checked',
    rawRange: range(1, 5),
    influenceRange: range(1, 5),
    metricRange: range(1, 5),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'rdp_line_simplify',
    localRebuild: 'round_trip_polyline',
    evidence: {
      startRawPointId: 1,
      turnRawPointId: 3,
      endpointRawPointId: 3,
      endRawPointId: 5,
      inputTrackPointCount: 5,
      outputTrackPointCount: 3,
      endpointDistanceMeters: 'checked',
      turnDistanceMeters: 'checked',
      crossTrackMeters: 'checked',
      durationSeconds: 120,
      maxSampleGapSeconds: 30,
      simplifyToleranceMeters: 10,
      sameRoadBboxMeters: undefined,
      sameRoadApproachPairDistanceMeters: undefined,
      sameRoadCollapseEligible: false,
      sameRoadCollapseReason: 'same_road_disabled',
      denseAreaIntents: [],
      roundTripIntentSupported: false
    }
  });
  assert.ok(proposal.evidence.endpointDistanceMeters <= 6);
  assert.ok(proposal.evidence.turnDistanceMeters >= 60);
  assert.ok(proposal.evidence.crossTrackMeters <= 10);
});

test('streaming scenario recognizer emits same road round trip proposal on finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: roundTripRouteTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: roundTripRecognizerConfig()
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'same_road_round_trip');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      endpointDistanceMeters: 'checked',
      turnDistanceMeters: 'checked',
      crossTrackMeters: 'checked',
      sameRoadBboxMeters: 'checked',
      sameRoadApproachPairDistanceMeters: 'checked'
    }
  }, {
    id: 'same_road_round_trip:1-3-5',
    scenario: 'same_road_round_trip',
    confidence: 'checked',
    rawRange: range(1, 5),
    influenceRange: range(1, 5),
    metricRange: range(1, 5),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'centerline_with_endpoint',
    localRebuild: 'same_road_centerline',
    evidence: {
      startRawPointId: 1,
      turnRawPointId: 3,
      endpointRawPointId: 3,
      endRawPointId: 5,
      inputTrackPointCount: 5,
      outputTrackPointCount: 5,
      endpointDistanceMeters: 'checked',
      turnDistanceMeters: 'checked',
      crossTrackMeters: 'checked',
      durationSeconds: 120,
      maxSampleGapSeconds: 30,
      simplifyToleranceMeters: 10,
      sameRoadBboxMeters: 'checked',
      sameRoadApproachPairDistanceMeters: 'checked',
      sameRoadCollapseEligible: true,
      sameRoadCollapseReason: 'strong_same_road_geometry_without_round_trip_intent',
      denseAreaIntents: [],
      roundTripIntentSupported: false
    }
  });
  assert.ok(proposal.evidence.sameRoadBboxMeters <= 45);
  assert.ok(proposal.evidence.sameRoadApproachPairDistanceMeters <= 10);
});

test('streaming scenario recognizer uses dense round trip intent for same road review', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: denseAreaIntentTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: roundTripRecognizerConfig({
      roundTripLineMinTrackPoints: 8,
      roundTripLineMaxEndpointDistanceMeters: 10,
      roundTripLineMinTurnDistanceMeters: 40,
      roundTripSameRoadNoIntentMaxBboxMeters: 30
    })
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'same_road_round_trip');

  assert.ok(proposal);
  assert.equal(proposal.evidence.sameRoadCollapseReason, 'round_trip_intent_supported');
  assert.deepEqual(proposal.evidence.denseAreaIntents, ['round_trip']);
  assert.equal(proposal.evidence.roundTripIntentSupported, true);
});

test('streaming scenario recognizer keeps composite round trip guard as context', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: roundTripRouteTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: roundTripRecognizerConfig({
      roundTripSameRoadCollapseEnabled: false,
      roundTripLineNoIntentMaxDurationSeconds: 60,
      roundTripLineNoIntentMaxSampleGapSeconds: 10
    })
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'composite_gap_local_settlement');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'round_trip_line'
      || item.scenario === 'same_road_round_trip'), false);
  assert.ok(proposal);
  assert.equal(proposal.metricOwner, false);
  assert.equal(proposal.action, 'reject_round_trip_rewrite');
  assert.equal(proposal.localRebuild, 'local_settlement_pipeline');
  assert.deepEqual(proposal.anchorRawPointIds, [3]);
  assert.equal(proposal.evidence.rejectionReason,
    'missing_round_trip_intent_long_composite_span');
  assert.equal(proposal.evidence.sameRoadCollapseReason, 'same_road_disabled');
  assert.equal(proposal.evidence.turnRawPointId, 3);
  assert.equal(proposal.evidence.endpointRawPointId, 3);
  assert.equal(proposal.evidence.roundTripIntentSupported, false);
});

test('streaming scenario recognizer keeps round trip route open before finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: roundTripRouteTrack()
  }, {
    enabled: true,
    config: roundTripRecognizerConfig()
  });
  const routeOpen = state.openWindows.find((window) =>
    window.scenario === 'same_road_round_trip');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'same_road_round_trip' || item.scenario === 'round_trip_line'), false);
  assert.ok(routeOpen);
  assert.deepEqual({
    id: routeOpen.id,
    scenario: routeOpen.scenario,
    range: routeOpen.influenceRange,
    reason: routeOpen.reason
  }, {
    id: 'round-trip-open:1-3-5',
    scenario: 'same_road_round_trip',
    range: range(1, 5),
    reason: 'awaiting_round_trip_exit'
  });
});

test('streaming scenario recognizer emits dense area intent as diagnostic context', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: denseAreaIntentTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true
  });
  const proposal = state.proposals.find((item) => item.scenario === 'dense_area_intent');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      bboxDiagonalMeters: 'checked'
    }
  }, {
    id: 'dense-area-intent:round_trip:1-8',
    scenario: 'dense_area_intent',
    confidence: 'checked',
    rawRange: range(1, 8),
    influenceRange: range(1, 8),
    metricRange: range(1, 8),
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'scheduler_context'],
    action: 'classify_dense_area_intent',
    localRebuild: 'dense_area_intent_classifier',
    evidence: {
      intent: 'round_trip',
      trackPointCount: 8,
      pathMeters: 'checked',
      netDistanceMeters: 'checked',
      bboxDiagonalMeters: 'checked',
      gapRecoveryCount: 0,
      stationaryAnchorCount: 0,
      movingRatio: 1,
      zeroDistanceRatio: 0,
      plannedSettlement: 'round_trip_settlement',
      observedMetricScenarios: [],
      conflictReview: []
    }
  });
});

test('streaming scenario recognizer emits enclosed gap cluster as diagnostic context', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: enclosedGapClusterTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: gapClusterRecognizerConfig()
  });
  const proposal = state.proposals.find((item) => item.scenario === 'enclosed_gap_cluster');
  const gapIntent = state.proposals.find((item) =>
    item.scenario === 'dense_area_intent' && item.evidence.intent === 'gap_cluster');

  assert.ok(gapIntent);
  assert.equal(gapIntent.metricOwner, false);
  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      bboxDiagonalMeters: 'checked'
    }
  }, {
    id: 'enclosed-gap-cluster:1-10',
    scenario: 'enclosed_gap_cluster',
    confidence: 'checked',
    rawRange: range(1, 10),
    influenceRange: range(1, 10),
    metricRange: range(1, 10),
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'gap_cluster_diagnostic'],
    anchorRawPointIds: [2, 3, 4, 6, 7, 9],
    action: 'classify_enclosed_gap_cluster',
    localRebuild: 'gap_stationary_cluster_diagnostic',
    evidence: {
      startTrackPointId: 1,
      endTrackPointId: 10,
      trackPointCount: 10,
      gapRecoveryCount: 3,
      stationaryAnchorCount: 3,
      segmentIds: [1, 2, 3],
      bboxDiagonalMeters: 'checked',
      durationSeconds: 90,
      denseAreaIntents: ['gap_cluster'],
      gapClusterIntentSupported: true,
      mixedIntentSupported: false
    }
  });
  assert.ok(proposal.confidence >= 0.7);
  assert.ok(proposal.evidence.bboxDiagonalMeters <= 20);
});

test('streaming scenario recognizer emits enclosed loop cluster settlement proposal', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: enclosedLoopClusterTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: enclosedLoopClusterConfig()
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'enclosed_loop_cluster_settlement');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    evidence: {
      ...proposal.evidence,
      originalDistanceMeters: 'checked',
      bboxDiagonalMeters: 'checked'
    }
  }, {
    id: 'enclosed-loop-cluster:1-605',
    scenario: 'enclosed_loop_cluster_settlement',
    confidence: 0.84,
    rawRange: range(1, 605),
    influenceRange: range(1, 605),
    metricRange: range(1, 605),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    anchorRawPointIds: [1, 605],
    action: 'compress_enclosed_loop_low_speed_drift',
    localRebuild: 'enclosed_loop_anchor_settlement',
    evidence: {
      keptRawPointIds: [1, 605],
      inputTrackPointCount: 17,
      outputTrackPointCount: 2,
      removedTrackPointCount: 15,
      originalDistanceMeters: 'checked',
      settledDistanceMeters: 0,
      gapRecoveryCount: 3,
      stationaryAnchorCount: 8,
      bboxDiagonalMeters: 'checked',
      durationSeconds: 752,
      denseAreaIntents: ['gap_cluster'],
      gapClusterIntentSupported: true,
      mixedIntentSupported: false
    }
  });
  assert.ok(state.proposals.some((item) =>
    item.scenario === 'dense_area_intent'
    && item.evidence.intent === 'gap_cluster'));
});

test('streaming scenario recognizer keeps enclosed loop cluster open before finish', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: enclosedLoopClusterTrack()
  }, {
    enabled: true,
    config: enclosedLoopClusterConfig()
  });
  const loopOpen = state.openWindows.find((window) =>
    window.scenario === 'enclosed_loop_cluster_settlement');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'enclosed_loop_cluster_settlement'), false);
  assert.ok(loopOpen);
  assert.deepEqual({
    id: loopOpen.id,
    scenario: loopOpen.scenario,
    range: loopOpen.influenceRange,
    reason: loopOpen.reason
  }, {
    id: 'enclosed-loop-open:1-605',
    scenario: 'enclosed_loop_cluster_settlement',
    range: range(1, 605),
    reason: 'awaiting_enclosed_loop_exit'
  });
});

test('streaming scenario recognizer emits closed loop round trip as diagnostic context', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: closedLoopTrack()
  }, {
    enabled: true,
    emitOpenWindows: false,
    finish: true,
    config: {
      roundTripLineSimplifyEnabled: false,
      roundTripSameRoadCollapseEnabled: false
    }
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'closed_loop_round_trip');

  assert.ok(proposal);
  assert.equal(proposal.metricOwner, false);
  assert.equal(proposal.action, 'classify_loop_without_rewrite');
  assert.equal(proposal.localRebuild, 'round_trip_diagnostic');
  assert.deepEqual(proposal.rawRange, range(1, 30));
  assert.equal(proposal.evidence.trackPointCount, 30);
  assert.deepEqual(proposal.evidence.denseAreaIntents, ['round_trip']);
  assert.equal(proposal.evidence.roundTripIntentSupported, true);
});

test('streaming scenario recognizer emits stationary drift collapse after cloud exits', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120)
    ],
    excluded: {
      rejected: stationaryDriftRejectedPoints(2, 22)
    },
    lastProcessedRawPointId: 23
  }, {
    enabled: true,
    emitOpenWindows: false
  });
  const proposal = state.proposals.find((item) =>
    item.scenario === 'stationary_drift_collapse');

  assert.ok(proposal);
  assert.deepEqual({
    ...proposal,
    confidence: 'checked',
    evidence: {
      ...proposal.evidence,
      bboxDiagonalMeters: 'checked',
      netDistanceMeters: 'checked'
    }
  }, {
    id: 'stationary-drift:2-22',
    scenario: 'stationary_drift_collapse',
    confidence: 'checked',
    rawRange: range(2, 22),
    influenceRange: range(2, 22),
    metricRange: range(2, 22),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'collapse_drift_cloud',
    localRebuild: 'stationary_drift_anchor',
    evidence: {
      rawPointCount: 21,
      coreRawPointCount: 21,
      coreStartRawPointId: 2,
      coreEndRawPointId: 22,
      representativeRawPointId: 4,
      durationSeconds: 60,
      bboxDiagonalMeters: 'checked',
      netDistanceMeters: 'checked',
      zeroSpeedRatio: 1,
      averageSpeedMetersPerSecond: 0,
      coreRatio: 1
    }
  });
  assert.ok(proposal.evidence.bboxDiagonalMeters <= 100);
});

test('streaming scenario recognizer keeps stationary drift cloud open at latest raw point', () => {
  const state = advanceStreamingScenarioRecognizer(createStreamingScenarioRecognizerState(), {
    track: [
      point(1, 30, 120)
    ],
    excluded: {
      rejected: stationaryDriftRejectedPoints(2, 22)
    },
    lastProcessedRawPointId: 22
  }, {
    enabled: true
  });
  const driftOpen = state.openWindows.find((window) =>
    window.scenario === 'stationary_drift_collapse');

  assert.equal(state.proposals.some((item) =>
    item.scenario === 'stationary_drift_collapse'), false);
  assert.ok(driftOpen);
  assert.deepEqual({
    id: driftOpen.id,
    scenario: driftOpen.scenario,
    range: driftOpen.influenceRange,
    reason: driftOpen.reason
  }, {
    id: 'stationary-drift-open:2-22',
    scenario: 'stationary_drift_collapse',
    range: range(2, 22),
    reason: 'awaiting_stationary_drift_exit'
  });
});

function spikeTrack() {
  return [
    point(1, 30, 120),
    point(2, 30, 120.0001),
    point(3, 30.00008, 120.00015, { reportedSpeedMetersPerSecond: 0 }),
    point(4, 30, 120.0002),
    point(5, 30, 120.0003)
  ];
}

function restPhotoTrack(startRawPointId, count) {
  return offsetTrack([
    [0, 0], [5, 0], [0, 5], [5, 5],
    [0, 0], [5, -5], [0, -5], [2, 0],
    [4, 2], [1, 1]
  ].slice(0, count), startRawPointId, 10);
}

function denseMainRouteTrack() {
  return offsetTrack([
    [0, 0], [4, 3], [8, -3], [12, 3], [16, -3], [20, 3],
    [24, -3], [28, 3], [32, -3], [36, 3], [40, -3], [44, 3],
    [48, -3], [52, 3], [56, -3], [60, 0]
  ], 1, 4).map((trackPoint, index) => ({
    ...trackPoint,
    result: 'accept',
    countsDistance: true,
    countsMovingTime: true,
    distanceDeltaMeters: index === 0 ? 0 : 5,
    movingTimeDeltaSeconds: index === 0 ? 0 : 4
  }));
}

function roundTripRouteTrack() {
  return offsetTrack([
    [0, 0], [40, 0], [80, 0], [40, 2], [0, 1]
  ], 1, 30).map((trackPoint, index) => ({
    ...trackPoint,
    result: 'accept',
    countsDistance: true,
    countsMovingTime: true,
    distanceDeltaMeters: index === 0 ? 0 : 40,
    movingTimeDeltaSeconds: index === 0 ? 0 : 30
  }));
}

function denseAreaIntentTrack() {
  return offsetTrack([
    [0, 0], [20, 0], [40, 0], [60, 0],
    [40, 0], [20, 0], [0, 0], [8, 0]
  ], 1, 10).map((trackPoint, index) => ({
    ...trackPoint,
    result: 'accept',
    countsDistance: true,
    countsMovingTime: true,
    distanceDeltaMeters: index === 0 ? 0 : 20,
    movingTimeDeltaSeconds: index === 0 ? 0 : 10
  }));
}

function enclosedGapClusterTrack() {
  const reasons = [
    'moving_good_fix',
    'stationary_anchor',
    'gap_recovery',
    'stationary_drift_anchor',
    'moving_good_fix',
    'gap_recovery',
    'stationary_anchor',
    'moving_good_fix',
    'gap_recovery',
    'moving_good_fix'
  ];
  return offsetTrack([
    [0, 0], [2, 0], [4, 1], [3, 2], [1, 2],
    [2, 3], [4, 2], [5, 1], [3, 0], [1, 1]
  ], 1, 10).map((trackPoint, index) => ({
    ...trackPoint,
    reason: reasons[index],
    segmentId: index < 3 ? 1 : index < 6 ? 2 : 3,
    result: index === 0 ? 'anchor' : 'accept',
    countsDistance: false,
    countsMovingTime: false,
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0
  }));
}

function enclosedLoopClusterTrack() {
  const samples = [
    [1, 1, 0, 0, 'moving_good_fix', true],
    [2, 4, 8, 0, 'moving_good_fix', true],
    [3, 7, 16, 0, 'moving_good_fix', true],
    [201, 150, 22, 0, 'gap_recovery', false],
    [202, 153, 22, 0, 'stationary_anchor', false],
    [203, 156, 22.2, 0.2, 'stationary_drift_anchor', false],
    [401, 310, 48, 35, 'gap_recovery', false],
    [402, 313, 48.2, 35.1, 'stationary_anchor', false],
    [403, 316, 48.1, 35.2, 'stationary_drift_anchor', false],
    [501, 440, 40, 20, 'moving_good_fix', true],
    [502, 443, 40, 20, 'stationary_anchor', false],
    [503, 446, 40.2, 20.1, 'stationary_drift_anchor', false],
    [601, 570, 25, 4, 'gap_recovery', false],
    [602, 573, 25.1, 4, 'stationary_anchor', false],
    [603, 576, 25.2, 4.1, 'stationary_drift_anchor', false],
    [604, 750, 1, 0, 'moving_good_fix', true],
    [605, 753, 0, 0, 'moving_good_fix', true]
  ];
  return samples.map(([rawPointId, elapsedSeconds, eastMeters, northMeters, reason,
    countsDistance], index) => point(rawPointId, latFromNorthMeters(30, northMeters),
    lngFromEastMeters(30, 120, eastMeters), {
      trackPointId: index + 1,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000,
      reason,
      result: rawPointId === 1 ? 'anchor' : 'accept',
      countsDistance,
      countsMovingTime: countsDistance,
      distanceDeltaMeters: countsDistance && index > 0 ? 8 : 0,
      movingTimeDeltaSeconds: countsDistance && index > 0 ? 3 : 0
    }));
}

function closedLoopTrack() {
  const offsets = [];
  for (let index = 0; index < 8; index++) offsets.push([index * 8, 0]);
  for (let index = 1; index < 8; index++) offsets.push([56, index * 8]);
  for (let index = 1; index < 8; index++) offsets.push([56 - index * 8, 56]);
  for (let index = 1; index < 8; index++) offsets.push([0, 56 - index * 8]);
  offsets.push([0, 0]);
  return offsetTrack(offsets, 1, 10).map((trackPoint, index) => ({
    ...trackPoint,
    result: 'accept',
    countsDistance: true,
    countsMovingTime: true,
    distanceDeltaMeters: index === 0 ? 0 : 8,
    movingTimeDeltaSeconds: index === 0 ? 0 : 10
  }));
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

function gapClusterRecognizerConfig(overrides = {}) {
  return {
    enclosedGapClusterMinRawPointIdSpan: 9,
    enclosedGapClusterMinDurationSeconds: 80,
    denseAreaIntentMinTrackPoints: 8,
    denseAreaIntentMaxSampleGapSeconds: 20,
    ...overrides
  };
}

function enclosedLoopClusterConfig(overrides = {}) {
  return {
    closedLoopRoundTripMinTrackPoints: 8,
    closedLoopRoundTripMinPathMeters: 40,
    closedLoopRoundTripMinBboxMeters: 20,
    closedLoopRoundTripMaxEndpointDistanceMeters: 12,
    closedLoopRoundTripMaxNetPathRatio: 0.3,
    enclosedGapClusterMinRawPointIdSpan: 1,
    denseAreaIntentMinTrackPoints: 8,
    denseAreaIntentMaxSampleGapSeconds: 200,
    ...overrides
  };
}

function offsetTrack(offsets, startRawPointId, secondsStep) {
  return offsets.map(([eastMeters, northMeters], index) => {
    const rawPointId = startRawPointId + index;
    return point(rawPointId, latFromNorthMeters(30, northMeters),
      lngFromEastMeters(30, 120, eastMeters), {
        elapsedRealtimeNanos: (index * secondsStep) * 1_000_000_000,
        reason: 'motion_supported_low_speed',
        reportedSpeedMetersPerSecond: 1.2
      });
  });
}

function stationaryDriftRejectedPoints(startRawPointId, endRawPointId) {
  const points = [];
  for (let rawPointId = startRawPointId; rawPointId <= endRawPointId; rawPointId++) {
    const index = rawPointId - startRawPointId;
    points.push({
      rawPointId,
      reason: 'stationary_cloud_jitter',
      lat: latFromNorthMeters(30, index % 2 === 0 ? 0 : 2),
      lng: lngFromEastMeters(30, 120, index % 3 === 0 ? 0 : 2),
      accuracy: 30,
      speed: 0,
      elapsedRealtimeNanos: index * 3_000_000_000
    });
  }
  return points;
}

function weakPoint(rawPointId) {
  return {
    rawPointId,
    reason: 'implied_speed_unconfirmed_by_reported_speed'
  };
}

function weakGapRecoveryPoint(rawPointId, elapsedSeconds, eastMeters, northMeters, accuracy) {
  return {
    rawPointId,
    reason: 'gap_recovery_pending',
    lat: latFromNorthMeters(30, northMeters),
    lng: lngFromEastMeters(30, 120, eastMeters),
    accuracy,
    speed: 0,
    elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
  };
}

function point(sourceRawPointId, lat, lng, overrides = {}) {
  return {
    trackPointId: sourceRawPointId,
    sourceRawPointId,
    lat,
    lng,
    result: sourceRawPointId === 1 ? 'anchor' : 'accept',
    reason: 'moving_good_fix',
    reportedSpeedMetersPerSecond: 1.2,
    entersTrustedGpx: true,
    ...overrides
  };
}

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function latFromNorthMeters(originLat, northMeters) {
  return originLat + northMeters / 111_320;
}

function lngFromEastMeters(originLat, originLng, eastMeters) {
  return originLng + eastMeters / (111_320 * Math.cos(originLat * Math.PI / 180));
}
