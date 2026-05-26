import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import {
  SIX_LAYER_TRACK_ALGORITHM_VERSION,
  buildSixLayerTrackProduct,
  reviewTrackPointScenarioCoverage
} from '../src/sixLayerTrackProduct.mjs';

function scenarioByName(product, name) {
  return product.scenarios.find((scenario) => scenario.scenario === name);
}

function scenarioByIntent(product, intent) {
  return product.scenarios.find((scenario) =>
    scenario.scenario === 'dense_area_intent'
    && scenario.evidence?.intent === intent);
}

function rawPointAdder(events, baseLat, baseLng) {
  const cosLat = Math.cos(baseLat * Math.PI / 180);
  return (rawPointId, elapsedSeconds, eastMeters, northMeters, accuracy = 5,
    speed = 1, motion = 'active') => {
    events.push(motionWindowEvent(elapsedSeconds, motion));
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat: baseLat + northMeters / 111_111,
      lng: baseLng + eastMeters / (111_111 * cosLat),
      accuracy,
      speed,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
  };
}

function motionWindowEvent(elapsedSeconds, motion) {
  const still = motion === 'still';
  return {
    event: 'device_motion_window',
    startElapsedRealtimeNanos: Math.max(0, elapsedSeconds - 1) * 1_000_000_000,
    endElapsedRealtimeNanos: elapsedSeconds * 1_000_000_000,
    linearAccelerationRmsMps2: still ? 0.03 : 0.6,
    gyroscopeRmsRadps: still ? 0.01 : 0.2,
    stepDetectorCount: still ? 0 : 1
  };
}

function loopEvents(baseLat, baseLng, offsets, firstRawPointId = 1, stepSeconds = 3) {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    }
  ];
  const addRaw = rawPointAdder(events, baseLat, baseLng);
  offsets.forEach(([eastMeters, northMeters], index) => {
    addRaw(firstRawPointId + index, 1 + index * stepSeconds, eastMeters, northMeters,
      3, 1, 'active');
  });
  return events;
}

test('buildSixLayerTrackProduct builds a normal walk with separate altitude lines', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"six-layer-doc","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"barometer_window","barometerWindowId":1,"startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":1000000000,"avgPressureHpa":1000,"avgRawBarometerAltitudeMeters":100}',
    '{"event":"barometer_window","barometerWindowId":2,"startElapsedRealtimeNanos":31000000000,"endElapsedRealtimeNanos":31000000000,"avgPressureHpa":999,"avgRawBarometerAltitudeMeters":110}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":105,"verticalAccuracy":4,"elapsedRealtimeNanos":31000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.equal(product.algorithmVersion, SIX_LAYER_TRACK_ALGORITHM_VERSION);
  assert.equal(product.explanationModel.mode, 'scenario_primary_with_contexts_and_primitive_facts');
  assert.equal(product.track.length, 2);
  assert.equal(product.track[0].reason, 'first_fix_good');
  assert.equal(product.track[1].reason, 'moving_good_fix');
  assert.equal(product.track[1].primaryExplanation.source, 'primitive');
  assert.equal(product.track[1].primaryExplanation.result, 'accept');
  assert.ok(product.track[1].primitiveFacts.includes('distance_counted'));
  assert.ok(product.rawPointDecisions[1].primitiveFacts.includes('moving_time_counted'));
  assert.ok(product.stats.totalDistanceMeters > 10);
  assert.equal(product.stats.movingTimeSeconds, 30);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 5);
  assert.equal(product.stats.barometerTotalAscentMeters, 10);
  assert.equal(product.stats.selectedAscentSource, 'BAROMETER');
});

test('buildSixLayerTrackProduct keeps gap recovery zero-delta and resets ascent boundary', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":5,"altitude":220,"verticalAccuracy":4,"elapsedRealtimeNanos":130000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'gap_recovery');
  assert.equal(product.track[1].startsNewSegment, true);
  assert.equal(product.track[1].distanceDeltaMeters, 0);
  assert.equal(product.track[1].movingTimeDeltaSeconds, 0);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 0);
  assert.equal(product.stats.gapCount, 1);
  const gapScenario = scenarioByName(product, 'gap_recovery_boundary');
  assert.ok(gapScenario);
  assert.equal(gapScenario.action, 'reset_segment_zero_delta');
  assert.equal(gapScenario.localRebuild, 'gap_recovery_anchor');
  assert.deepEqual(gapScenario.anchorRawPointIds, [2]);
  assert.equal(gapScenario.evidence.recoveryCount, 1);
  assert.deepEqual(gapScenario.evidence.rawPointIds, [2]);
  assert.equal(gapScenario.evidence.zeroDistanceCount, 1);
  assert.equal(gapScenario.evidence.zeroMovingTimeCount, 1);
});

test('buildSixLayerTrackProduct keeps near-anchor post-gap drift pending', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":10,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00002,"lng":120,"accuracy":8,"elapsedRealtimeNanos":130000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1]);
  assert.equal(product.excluded.weak.length, 1);
  assert.equal(product.excluded.weak[0].reason, 'gap_recovery_pending');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.gapCount, 0);
});

test('buildSixLayerTrackProduct preserves a stable weak recovery shape anchor', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00152,"lng":120.00002,"accuracy":48,"speed":0,"elapsedRealtimeNanos":150000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00150,"lng":120.00000,"accuracy":38,"speed":0,"elapsedRealtimeNanos":152000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00149,"lng":120.00001,"accuracy":33,"speed":0,"elapsedRealtimeNanos":153000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.00150,"lng":120.00002,"accuracy":64,"speed":0,"elapsedRealtimeNanos":156000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.00156,"lng":120.00002,"accuracy":8,"speed":1,"elapsedRealtimeNanos":580000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);
  const shapeAnchor = product.track.find((point) =>
    point.reason === 'weak_recovery_shape_anchor');

  assert.ok(shapeAnchor);
  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 4, 6]);
  assert.equal(shapeAnchor.sourceRawPointId, 4);
  assert.deepEqual(shapeAnchor.contributingRawPointIds, [2, 3, 4, 5]);
  assert.equal(shapeAnchor.countsDistance, false);
  assert.equal(shapeAnchor.countsMovingTime, false);
  assert.equal(shapeAnchor.entersTrustedGpx, true);
  assert.equal(shapeAnchor.coordinateSource, 'cloud_center');
  assert.equal(shapeAnchor.virtualCoordinate, true);
  assert.equal(shapeAnchor.primaryExplanation.source, 'scenario');
  assert.equal(shapeAnchor.primaryExplanation.scenario, 'weak_recovery_endpoint');
  assert.equal(shapeAnchor.lat, 30.0015025);
  assert.ok(Math.abs(shapeAnchor.lng - 120.0000125) < 1e-12);
  assert.equal(product.excluded.weak.some((point) =>
    point.rawPointId >= 2 && point.rawPointId <= 5), false);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.weakRecoveryShapePreserve.anchorCount, 1);
  assert.deepEqual(product.scenarios.map((scenario) => scenario.scenario), [
    'weak_recovery_endpoint',
    'gap_recovery_boundary'
  ]);
  const endpointScenario = scenarioByName(product, 'weak_recovery_endpoint');
  assert.equal(endpointScenario.action, 'preserve_endpoint_anchor');
  assert.deepEqual(endpointScenario.rawRange, {
    startRawPointId: 2,
    endRawPointId: 5
  });
  assert.equal(endpointScenario.evidence.endpointRawPointId, 5);
  assert.ok(endpointScenario.confidence > 0.8);
  const gapScenario = scenarioByName(product, 'gap_recovery_boundary');
  assert.equal(gapScenario.action, 'reset_segment_zero_delta');
  assert.equal(gapScenario.localRebuild, 'gap_recovery_anchor');
  assert.deepEqual(gapScenario.anchorRawPointIds, [6]);
  assert.deepEqual(gapScenario.evidence.rawPointIds, [6]);
  const rawDecision = product.rawPointDecisions.find((decision) => decision.rawPointId === 5);
  assert.equal(rawDecision.primaryExplanation.scenario, 'weak_recovery_endpoint');
});

test('buildSixLayerTrackProduct preserves a weak cave endpoint and simplifies the round trip', () => {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    }
  ];
  const cosLat = Math.cos(30 * Math.PI / 180);
  const addRaw = (rawPointId, elapsedSeconds, eastMeters, northMeters, accuracy, speed = 1) => {
    events.push({
      event: 'device_motion_window',
      startElapsedRealtimeNanos: (elapsedSeconds - 1) * 1_000_000_000,
      endElapsedRealtimeNanos: elapsedSeconds * 1_000_000_000,
      linearAccelerationRmsMps2: 0.6,
      gyroscopeRmsRadps: 0.2,
      stepDetectorCount: 1
    });
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat: 30 + northMeters / 111_111,
      lng: 120 + eastMeters / (111_111 * cosLat),
      accuracy,
      speed,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
  };

  addRaw(469, 1, 0, 0, 5);
  let rawPointId = 470;
  let elapsedSeconds = 4;
  for (const eastMeters of [6, 12, 20, 26, 18, 9, 15, 24, 30, 22, 14, 7, 16, 25, 31, 21]) {
    addRaw(rawPointId++, elapsedSeconds, eastMeters, Math.sin(eastMeters) * 4, 5);
    elapsedSeconds += 3;
  }
  addRaw(634, 60, 20, 5, 5);
  addRaw(641, 220, 150, 112, 48, 0);
  addRaw(642, 222, 148, 111, 38, 0);
  addRaw(643, 223, 150, 110, 33, 0);
  addRaw(644, 226, 151, 111, 64, 0);
  addRaw(666, 570, 30, -8, 8);
  elapsedSeconds = 573;
  rawPointId = 668;
  for (const [eastMeters, northMeters] of [
    [24, -4], [18, 2], [10, 4], [4, -2], [12, -5], [20, 3],
    [14, 5], [8, 3], [3, -1], [5, 2], [2, 0]
  ]) {
    addRaw(rawPointId++, elapsedSeconds, eastMeters, northMeters, 5);
    elapsedSeconds += 3;
  }
  addRaw(679, elapsedSeconds, 2, 0, 5);
  addRaw(900, 700, 2, 0, 5);
  addRaw(906, 730, 35, 0, 5);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      restPhotoMicroMoveMaxEndpointDistanceMeters: 100,
      restPhotoMicroMoveMaxBboxMeters: 30,
      restPhotoMicroMoveMaxPathMeters: 200,
      restPhotoMicroMoveMinPathNetRatio: 1
    }
  });
  const collapsed = product.roundTripLineSimplify;
  const shapeIds = product.track.map((point) => point.sourceRawPointId);
  const caveAnchor = product.track.find((point) =>
    point.reason === 'weak_recovery_shape_anchor');

  assert.ok(collapsed);
  assert.ok(caveAnchor);
  assert.equal(collapsed.collapsedSpanCount, 1);
  assert.deepEqual(collapsed.collapsedRawPointRanges[0], {
    startRawPointId: 469,
    turnRawPointId: 643,
    endRawPointId: 678,
    collapsedTrackPointCount: 30
  });
  assert.equal(shapeIds.length, 14);
  assert.deepEqual(shapeIds, [
    469, 473, 475, 477, 481, 485, 644,
    666, 669, 671, 672, 674, 678, 906
  ]);
  assert.equal(product.track[0].reason, 'round_trip_interwoven_start');
  assert.equal(product.track[0].primaryExplanation.scenario, 'same_road_round_trip');
  assert.ok(product.track.slice(0, 6).every((point) =>
    point.coordinateSource === 'same_road_corridor_center'
      && point.virtualCoordinate === true));
  assert.ok(product.track.slice(7, 13).every((point) =>
    point.coordinateSource === 'same_road_corridor_center'
      && point.virtualCoordinate === true));
  for (let index = 0; index < 6; index++) {
    const mirrored = product.track[12 - index];
    assert.equal(product.track[index].lat, mirrored.lat);
    assert.equal(product.track[index].lng, mirrored.lng);
  }
  assert.equal(caveAnchor.sourceRawPointId, 644);
  assert.equal(caveAnchor.coordinateSource, 'weak_recovery_endpoint_raw');
  assert.equal(caveAnchor.primaryExplanation.scenario, 'weak_recovery_endpoint');
  assert.equal(caveAnchor.virtualCoordinate, false);
  assert.deepEqual(caveAnchor.contributingRawPointIds, [641, 642, 643, 644]);
  assert.equal(caveAnchor.lat, 30.000999000999002);
  assert.equal(caveAnchor.lng, 120.0015692396009);
  assert.equal(product.track[12].reason, 'round_trip_interwoven_end');
  assert.equal(product.track[12].countsDistance, true);
  assert.equal(product.track[12].entersTrustedGpx, true);
  assert.equal(product.interwovenCorridorSimplify, undefined);
  assert.deepEqual(product.scenarios
    .filter((scenario) => scenario.scenario !== 'dense_area_intent')
    .map((scenario) => scenario.scenario), [
    'weak_recovery_endpoint',
    'same_road_round_trip',
    'gap_recovery_boundary'
  ]);
  const sameRoadScenario = scenarioByName(product, 'same_road_round_trip');
  assert.equal(sameRoadScenario.action, 'centerline_with_endpoint');
  assert.equal(sameRoadScenario.localRebuild, 'same_road_centerline');
  assert.deepEqual(sameRoadScenario.rawRange, {
    startRawPointId: 469,
    endRawPointId: 678
  });
  assert.deepEqual(sameRoadScenario.anchorRawPointIds, [643, 644]);
  assert.equal(sameRoadScenario.evidence.inputTrackPointCount, 30);
  assert.equal(sameRoadScenario.evidence.outputTrackPointCount, 13);
  assert.ok(Array.isArray(sameRoadScenario.evidence.denseAreaIntents));
  assert.equal(typeof sameRoadScenario.evidence.roundTripIntentSupported, 'boolean');
  assert.ok(sameRoadScenario.confidence > 0.5);
  const gapScenario = scenarioByName(product, 'gap_recovery_boundary');
  assert.equal(gapScenario.action, 'reset_segment_zero_delta');
  assert.deepEqual(gapScenario.evidence.rawPointIds, [906]);
  assert.ok(product.stats.totalDistanceMeters > 0);

  const lineProduct = buildSixLayerTrackProduct(events, {
    config: { roundTripSameRoadCollapseEnabled: false }
  });
  const lineScenario = scenarioByName(lineProduct, 'round_trip_line');
  assert.ok(lineScenario);
  assert.equal(lineScenario.action, 'rdp_line_simplify');
  assert.equal(lineScenario.localRebuild, 'round_trip_polyline');
  assert.deepEqual(lineScenario.rawRange, {
    startRawPointId: 469,
    endRawPointId: 678
  });
});

test('buildSixLayerTrackProduct recognizes a closed-loop round trip without a weak endpoint', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [4, -18], [9, -36], [12, -54], [10, -72], [6, -90],
    [2, -108], [-2, -126], [-4, -144], [-2, -126], [2, -108],
    [6, -90], [10, -72], [12, -54], [9, -36], [4, -18], [0, 0]
  ], 1, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: { closedLoopRoundTripMinTrackPoints: 12 }
  });
  const scenario = scenarioByName(product, 'closed_loop_round_trip');

  assert.ok(scenario);
  assert.equal(scenario.action, 'classify_loop_without_rewrite');
  assert.equal(scenario.localRebuild, 'round_trip_diagnostic');
  assert.ok(scenario.evidence.pathMeters > 250);
  assert.ok(scenario.evidence.netDistanceMeters <= 8);
  assert.deepEqual(scenario.evidence.denseAreaIntents, ['round_trip']);
  assert.equal(scenario.evidence.roundTripIntentSupported, true);
  assert.equal(product.track.find((point) =>
    point.sourceRawPointId === scenario.rawRange.startRawPointId)
    .primaryExplanation.scenario, 'closed_loop_round_trip');
});

test('buildSixLayerTrackProduct keeps round-trip intent below concrete loop explanation', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [4, -18], [9, -36], [12, -54], [10, -72], [6, -90],
    [2, -108], [-2, -126], [-4, -144], [-2, -126], [2, -108],
    [6, -90], [10, -72], [12, -54], [9, -36], [4, -18], [0, 0]
  ], 1, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: { closedLoopRoundTripMinTrackPoints: 12 }
  });
  const intentScenario = scenarioByIntent(product, 'round_trip');
  const loopScenario = scenarioByName(product, 'closed_loop_round_trip');
  const firstPoint = product.track.find((point) =>
    point.sourceRawPointId === loopScenario.rawRange.startRawPointId);

  assert.ok(intentScenario);
  assert.ok(loopScenario);
  assert.equal(intentScenario.evidence.intent, 'round_trip');
  assert.ok(product.denseAreaSettlementPlan.some((plan) =>
    plan.intent === 'round_trip'
    && plan.plannedSettlement === 'round_trip_settlement'
    && plan.observedScenarios.includes('closed_loop_round_trip')));
  assert.equal(firstPoint.primaryExplanation.scenario, 'closed_loop_round_trip');
  assert.ok(firstPoint.scenarioContexts.some((scenario) =>
    scenario.scenario === 'dense_area_intent'));
});

test('buildSixLayerTrackProduct recognizes an enclosed gap cluster', () => {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    }
  ];
  const addRaw = rawPointAdder(events, 30, 120);
  addRaw(1, 1, 0, 0, 5, 1, 'active');
  addRaw(201, 150, 22, 0, 5, 1, 'active');
  addRaw(202, 153, 22.5, 0.2, 5, 0, 'still');
  addRaw(203, 156, 22.7, 0.1, 5, 0, 'still');
  addRaw(401, 310, 42, 18, 5, 1, 'active');
  addRaw(402, 313, 42.1, 18.2, 5, 0, 'still');
  addRaw(403, 316, 42.2, 18.1, 5, 0, 'still');
  addRaw(601, 470, 25, 36, 5, 1, 'active');
  addRaw(602, 473, 25.1, 36.1, 5, 0, 'still');
  addRaw(603, 476, 25.2, 36.2, 5, 0, 'still');

  const product = buildSixLayerTrackProduct(events, {
    config: { enclosedGapClusterMinRawPointIdSpan: 1 }
  });
  const scenario = scenarioByName(product, 'enclosed_gap_cluster');

  assert.ok(scenario);
  assert.equal(scenario.action, 'classify_enclosed_gap_cluster');
  assert.equal(scenario.localRebuild, 'gap_stationary_cluster_diagnostic');
  assert.ok(scenario.evidence.gapRecoveryCount >= 3);
  assert.ok(scenario.evidence.stationaryAnchorCount >= 3);
  assert.ok(Array.isArray(scenario.evidence.denseAreaIntents));
  assert.equal(typeof scenario.evidence.gapClusterIntentSupported, 'boolean');
  assert.equal(typeof scenario.evidence.mixedIntentSupported, 'boolean');
});

test('buildSixLayerTrackProduct preserves dense area main route skeleton first', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [4, 3], [8, -3], [12, 3], [16, -3], [20, 3],
    [24, -3], [28, 3], [32, -3], [36, 3], [40, -3], [44, 3],
    [48, -3], [52, 3], [56, -3], [60, 0]
  ], 700, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      denseMainRouteMinTrackPoints: 10,
      denseMainRouteSimplifyToleranceMeters: 7
    }
  });
  const intent = scenarioByIntent(product, 'forward_motion');
  const scenario = scenarioByName(product, 'dense_main_route_settlement');
  const settledPoints = product.track.filter((point) =>
    point.reason.startsWith('dense_main_route_'));

  assert.ok(intent);
  assert.equal(intent.action, 'classify_dense_area_intent');
  assert.equal(intent.localRebuild, 'dense_area_intent_classifier');
  assert.ok(scenario);
  assert.ok(product.denseAreaSettlementPlan.some((plan) =>
    plan.intent === 'forward_motion'
    && plan.plannedSettlement === 'dense_main_route_settlement'
    && plan.settlementPriority === 10
    && plan.observedScenarios.includes('dense_main_route_settlement')));
  assert.equal(scenario.action, 'preserve_dense_main_route_skeleton');
  assert.equal(scenario.localRebuild, 'dense_main_route_skeleton');
  assert.ok(scenario.evidence.outputTrackPointCount < scenario.evidence.inputTrackPointCount);
  assert.ok(scenario.evidence.simplifiedPathMeters < scenario.evidence.pathMeters);
  assert.ok(product.forwardSpineCandidates.some((candidate) =>
    candidate.source === 'dense_area_intent'
    && candidate.plannedSettlement === 'dense_main_route_settlement'));
  assert.ok(Array.isArray(product.forwardSpineOverlaps));
  assert.ok(Array.isArray(product.forwardSpineConflicts));
  assert.ok(product.forwardSpineDecisions.some((decision) =>
    decision.reason === 'single_forward_spine_candidate'));
  assert.ok(settledPoints.length >= 2);
  assert.equal(settledPoints[0].reason, 'dense_main_route_start');
  assert.equal(settledPoints.at(-1).reason, 'dense_main_route_end');
  assert.ok(settledPoints.some((point) => point.contributingRawPointIds.length > 1));
});

test('buildSixLayerTrackProduct compresses enclosed loop gap drift into anchors', () => {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    }
  ];
  const addRaw = rawPointAdder(events, 30, 120);
  [
    [1, 1, 0, 0, 5, 1, 'active'],
    [2, 4, 8, 0, 5, 1, 'active'],
    [3, 7, 16, 0, 5, 1, 'active'],
    [201, 150, 22, 0, 5, 1, 'active'],
    [202, 153, 22, 0, 5, 0, 'still'],
    [203, 156, 22.2, 0.2, 5, 0, 'still'],
    [401, 310, 48, 35, 5, 1, 'active'],
    [402, 313, 48.2, 35.1, 5, 0, 'still'],
    [403, 316, 48.1, 35.2, 5, 0, 'still'],
    [501, 440, 40, 20, 5, 1, 'active'],
    [502, 443, 40, 20, 5, 0, 'still'],
    [503, 446, 40.2, 20.1, 5, 0, 'still'],
    [601, 570, 25, 4, 5, 1, 'active'],
    [602, 573, 25.1, 4, 5, 0, 'still'],
    [603, 576, 25.2, 4.1, 5, 0, 'still'],
    [604, 750, 1, 0, 5, 1, 'active'],
    [605, 753, 0, 0, 5, 1, 'active']
  ].forEach((args) => addRaw(...args));

  const product = buildSixLayerTrackProduct(events, {
    config: {
      closedLoopRoundTripMinTrackPoints: 8,
      closedLoopRoundTripMinPathMeters: 40,
      closedLoopRoundTripMinBboxMeters: 20,
      closedLoopRoundTripMaxEndpointDistanceMeters: 12,
      closedLoopRoundTripMaxNetPathRatio: 0.3,
      enclosedGapClusterMinRawPointIdSpan: 1
    }
  });
  const scenario = scenarioByName(product, 'enclosed_loop_cluster_settlement');
  const settledDistance = product.track.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters : 0), 0);

  assert.ok(scenario);
  assert.equal(scenario.action, 'compress_enclosed_loop_low_speed_drift');
  assert.equal(scenario.localRebuild, 'enclosed_loop_anchor_settlement');
  assert.ok(scenario.evidence.outputTrackPointCount < scenario.evidence.inputTrackPointCount);
  assert.equal(scenario.evidence.settledDistanceMeters, 0);
  assert.ok(Array.isArray(scenario.evidence.denseAreaIntents));
  assert.equal(typeof scenario.evidence.gapClusterIntentSupported, 'boolean');
  assert.equal(typeof scenario.evidence.mixedIntentSupported, 'boolean');
  assert.equal(settledDistance, 0);
  assert.ok(product.track.some((point) => point.contributingRawPointIds?.includes(401)));
});

test('buildSixLayerTrackProduct classifies dense stationary intent', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [3, 0], [0, 3], [3, 3], [0, 0], [3, -3],
    [0, -3], [3, 0], [0, 3], [2, 0]
  ], 820, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      denseAreaIntentMinTrackPoints: 8,
      stationarySessionCollapseEnabled: false,
      dwellDriftCollapseEnabled: false,
      restPhotoMicroMoveSimplifyEnabled: false
    }
  });
  const intent = scenarioByIntent(product, 'stationary');

  assert.ok(intent);
  assert.equal(intent.evidence.intent, 'stationary');
  assert.ok(intent.evidence.netDistanceMeters <= 12);
  assert.equal(scenarioByName(product, 'dense_main_route_settlement'), undefined);
});

test('buildSixLayerTrackProduct recognizes rest photo micro movement', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [-2, 2], [-5, 1], [-6, 5], [-3, 8], [-7, 12],
    [-5, 9], [-2, 7], [-1, 2], [-6, 1], [-4, -1], [0, 0]
  ], 1, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      restPhotoMicroMoveMaxPathMeters: 200,
      restPhotoMicroMoveSimplifyEnabled: false
    }
  });
  const scenario = scenarioByName(product, 'rest_photo_micro_move');

  assert.ok(scenario);
  assert.equal(scenario.action, 'classify_micro_move_without_rewrite');
  assert.equal(scenario.localRebuild, 'rest_photo_micro_move_diagnostic');
  assert.ok(scenario.evidence.pathMeters >= 20);
  assert.ok(scenario.evidence.bboxDiagonalMeters <= 25);
  assert.ok(Array.isArray(scenario.evidence.denseAreaIntents));
  assert.equal(typeof scenario.evidence.localMicroMoveOverridesDenseForward, 'boolean');
  if (scenario.evidence.localMicroMoveOverridesDenseForward) {
    assert.ok(product.denseIntentConflicts.some((conflict) =>
      conflict.conflict === 'local_micro_move_overrides_dense_forward'
      && conflict.scenario === 'rest_photo_micro_move'
      && conflict.resolution === 'prefer_local_rest_photo_micro_move'));
    assert.ok(product.findings.some((finding) =>
      finding.includes('dense intent conflict')));
  }
});

test('buildSixLayerTrackProduct simplifies confirmed rest photo micro movement', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [8, -3], [1, -10], [10, -14], [-3, -18],
    [9, -16], [-5, -12], [8, -8], [-2, -3], [9, 2],
    [0, 6], [10, 9], [2, 13], [8, 16], [0, 11],
    [6, 5], [-3, 1]
  ], 5050, 8);
  const product = buildSixLayerTrackProduct(events, {
    config: { restPhotoMicroMoveMaxPathMeters: 200 }
  });
  const scenario = scenarioByName(product, 'rest_photo_micro_move');
  const simplifiedPoints = product.track.filter((point) =>
    point.reason.startsWith('rest_photo_micro_move_'));

  assert.ok(scenario);
  assert.equal(scenario.action, 'simplify_micro_move_shape');
  assert.equal(scenario.localRebuild, 'rest_photo_micro_move_simplifier');
  assert.ok(scenario.evidence.outputTrackPointCount < scenario.evidence.inputTrackPointCount);
  assert.ok(scenario.evidence.simplifiedPathMeters < scenario.evidence.pathMeters);
  assert.ok(simplifiedPoints.length <= 6);
  assert.ok(simplifiedPoints.some((point) => point.contributingRawPointIds.length > 1));
  assert.equal(product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 5051).entersTrustedGpx, false);
});

test('buildSixLayerTrackProduct collapses nearly stationary rest photo micro movement', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [8, -3], [1, -10], [10, -14], [-3, -18],
    [9, -16], [-5, -12], [8, -8], [-2, -3], [9, 2],
    [0, 6], [10, 9], [2, 13], [8, 16], [0, 11],
    [6, 5], [-3, 1]
  ], 4562, 8);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      restPhotoMicroMoveCollapseMaxBboxMeters: 25,
      restPhotoMicroMoveCollapseMaxPathMeters: 120
    }
  });
  const scenario = scenarioByName(product, 'rest_photo_micro_move');
  const collapsed = product.track.find((point) =>
    point.reason === 'rest_photo_micro_move_anchor');

  assert.ok(scenario);
  assert.ok(collapsed);
  assert.equal(scenario.action, 'collapse_micro_move_to_rest_anchor');
  assert.equal(scenario.localRebuild, 'rest_photo_micro_move_anchor');
  assert.ok(Array.isArray(scenario.evidence.denseAreaIntents));
  assert.equal(typeof scenario.evidence.forwardIntentOverlapped, 'boolean');
  assert.equal(typeof scenario.evidence.localMicroMoveOverridesDenseForward, 'boolean');
  assert.equal(collapsed.countsDistance, false);
  assert.equal(collapsed.countsMovingTime, false);
  assert.equal(collapsed.contributingRawPointIds.length, scenario.evidence.inputTrackPointCount);
});

test('buildSixLayerTrackProduct collapses short rest micro move foldback', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [5, -1], [8, -3], [3, -6], [-1, -4],
    [2, -1], [6, 1], [1, 4], [-1, 1], [4, -2]
  ], 2461, 7);
  for (const event of events.filter((event) => event.event === 'raw_location')) {
    event.accuracy = 1;
    event.speed = event.rawPointId === 2461 ? 5.2 : 0.6;
  }

  const product = buildSixLayerTrackProduct(events, {
    config: { restPhotoMicroMoveMinTrackPoints: 6 }
  });
  const scenario = scenarioByName(product, 'rest_photo_micro_move');
  const collapsed = product.track.find((point) =>
    point.reason === 'rest_photo_micro_move_anchor');

  assert.ok(scenario);
  assert.ok(collapsed);
  assert.equal(scenario.action, 'collapse_micro_move_to_rest_anchor');
  assert.equal(scenario.evidence.outputTrackPointCount, 1);
  assert.equal(collapsed.countsDistance, false);
  assert.notEqual(collapsed.sourceRawPointId, 2461);
});

test('buildSixLayerTrackProduct removes a single low-speed moving spike', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [4, 0], [9, 0], [9, -6], [14, 1], [18, 2]
  ], 1664, 3);
  for (const event of events.filter((event) => event.event === 'raw_location')) {
    event.speed = event.rawPointId === 1667 ? 0 : 1.2;
  }

  const product = buildSixLayerTrackProduct(events);
  const scenario = scenarioByName(product, 'moving_spike_cleanup');
  const rawDecision = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 1667);
  const bridgePoint = product.track.find((point) =>
    point.contributingRawPointIds.includes(1667));

  assert.ok(scenario);
  assert.equal(scenario.action, 'remove_single_point_spike');
  assert.equal(scenario.evidence.spikeRawPointId, 1667);
  assert.equal(rawDecision.entersTrustedGpx, false);
  assert.equal(rawDecision.countsDistance, false);
  assert.equal(bridgePoint.sourceRawPointId, 1668);
});

test('buildSixLayerTrackProduct keeps composable scenario contexts on overlapping spans', () => {
  const events = loopEvents(30, 120, [
    [0, 0], [3, 2], [-2, 4], [4, 7], [-4, 6], [1, 3], [-3, 1], [0, 0],
    [8, -16], [15, -32], [20, -48], [16, -64], [8, -80], [0, -96],
    [-8, -80], [-16, -64], [-20, -48], [-15, -32], [-8, -16], [0, 0]
  ], 1, 3);

  const product = buildSixLayerTrackProduct(events, {
    config: {
      closedLoopRoundTripMinTrackPoints: 18,
      restPhotoMicroMoveSimplifyEnabled: false
    }
  });
  const loopScenario = scenarioByName(product, 'closed_loop_round_trip');
  const photoScenario = scenarioByName(product, 'rest_photo_micro_move');
  const microPoint = product.track.find((point) => point.sourceRawPointId === 4);
  const contextNames = new Set(microPoint.scenarioContexts.map((scenario) =>
    scenario.scenario));

  assert.ok(loopScenario);
  assert.ok(photoScenario);
  assert.ok(photoScenario.rawRange.startRawPointId >= loopScenario.rawRange.startRawPointId);
  assert.ok(photoScenario.rawRange.endRawPointId <= loopScenario.rawRange.endRawPointId);
  assert.equal(microPoint.primaryExplanation.scenario, 'rest_photo_micro_move');
  assert.equal(microPoint.primaryExplanation.scenarioLabel, '拍照/休息微移动');
  assert.equal(microPoint.primaryExplanation.actionLabel, '只标注小范围微移动');
  assert.ok(contextNames.has('rest_photo_micro_move'));
  assert.ok(contextNames.has('closed_loop_round_trip'));
  assert.ok(product.rawPointDecisions.find((decision) => decision.rawPointId === 4)
    .scenarioContexts.some((scenario) => scenario.scenario === 'closed_loop_round_trip'));

  const loopCoverage = product.scenarioCoverage.find((coverage) =>
    coverage.scenario === 'closed_loop_round_trip');
  const photoCoverage = product.scenarioCoverage.find((coverage) =>
    coverage.scenario === 'rest_photo_micro_move');
  assert.deepEqual(loopCoverage.trackPointRange, {
    startTrackPointId: loopScenario.evidence.startTrackPointId,
    endTrackPointId: loopScenario.evidence.endTrackPointId
  });
  assert.equal(loopCoverage.continuousCoverage, true);
  assert.equal(loopCoverage.scenarioLabel, '闭合往返/回环');
  assert.ok(loopCoverage.trackPointIds.includes(microPoint.trackPointId));
  assert.ok(loopCoverage.contextTrackPointCount > photoCoverage.contextTrackPointCount);
  assert.equal(photoCoverage.continuousCoverage, true);
  assert.equal(photoCoverage.localRebuildLabel, '微移动诊断标注');
  assert.ok(photoCoverage.primaryTrackPointCount > 0);

  const review = reviewTrackPointScenarioCoverage(product, 1, 8);
  const reviewedScenarios = new Set(review.scenarioCoverage.map((coverage) =>
    coverage.scenario));
  assert.equal(review.trackPointCount, 8);
  assert.deepEqual(review.rawRange, { startRawPointId: 1, endRawPointId: 8 });
  assert.ok(reviewedScenarios.has('closed_loop_round_trip'));
  assert.ok(reviewedScenarios.has('rest_photo_micro_move'));
  assert.ok(review.primaryScenarios.includes('rest_photo_micro_move'));
});

test('buildSixLayerTrackProduct waits for a stable stationary cloud', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":6000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":8000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 3]);
  assert.equal(product.track[1].reason, 'stationary_anchor');
  assert.equal(product.track[1].cloudSampleCount, 2);
  assert.deepEqual(product.excluded.rejected.map((point) => point.reason), [
    'stationary_cloud_jitter',
    'stationary_anchor_redundant'
  ]);
  assert.equal(product.stats.totalDistanceMeters, 0);
});

test('buildSixLayerTrackProduct keeps transport risk out of hiking truth', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.equal(product.track.length, 1);
  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.excluded.rejected[0].reason, 'transport_risk');
  assert.equal(product.stats.transportCount, 1);
  assert.ok(product.stats.suspectedDistanceMeters > 100);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  const transportScenario = scenarioByName(product, 'transport_contamination');
  assert.ok(transportScenario);
  assert.equal(product.excluded.rejected[0].primaryExplanation.scenario,
    'transport_contamination');
  assert.equal(transportScenario.action, 'exclude_from_hiking_truth');
  assert.equal(transportScenario.localRebuild, 'transport_diagnostic_continuity');
  assert.deepEqual(transportScenario.rawRange, {
    startRawPointId: 2,
    endRawPointId: 2
  });
  assert.deepEqual(transportScenario.evidence.rejectedRawPointIds, [2]);
  assert.equal(transportScenario.evidence.countsDistance, false);
  assert.equal(transportScenario.evidence.countsMovingTime, false);
});

test('buildSixLayerTrackProduct does not label low reported speed jumps as transport', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"speed":1,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0002,"lng":120,"accuracy":5,"speed":1.2,"elapsedRealtimeNanos":2000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.equal(product.stats.transportCount, 0);
  assert.equal(scenarioByName(product, 'transport_contamination'), undefined);
  assert.equal(product.excluded.weak[0].reason,
    'implied_speed_unconfirmed_by_reported_speed');
});

test('buildSixLayerTrackProduct resets distance at position snap recovery', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"speed":1,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0002,"lng":120,"accuracy":5,"speed":1.2,"elapsedRealtimeNanos":2000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00023,"lng":120,"accuracy":5,"speed":0.8,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00026,"lng":120,"accuracy":5,"speed":0.8,"elapsedRealtimeNanos":11000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.00035,"lng":120,"accuracy":5,"speed":0.8,"elapsedRealtimeNanos":14000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);
  const scenario = scenarioByName(product, 'position_snap_recovery');
  const recovery = product.track.find((point) => point.sourceRawPointId === 4);

  assert.ok(scenario);
  assert.equal(scenario.action, 'reset_position_snap_recovery_delta');
  assert.equal(scenario.localRebuild, 'position_snap_recovery_anchor');
  assert.equal(recovery.reason, 'position_snap_recovery_anchor');
  assert.equal(recovery.distanceDeltaMeters, 0);
  assert.equal(recovery.countsDistance, false);
  assert.deepEqual(recovery.contributingRawPointIds, [2, 3, 4]);
  assert.equal(product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 2).entersTrustedGpx, false);
  assert.ok(product.track.find((point) => point.sourceRawPointId === 5).countsDistance);
});

test('buildSixLayerTrackProduct keeps recovery transport continuity without hiking distance', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":50,"speed":20,"elapsedRealtimeNanos":130000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0104,"lng":120,"accuracy":34,"speed":20,"elapsedRealtimeNanos":132000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0106,"lng":120,"accuracy":36,"speed":20,"elapsedRealtimeNanos":133000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 3, 4]);
  assert.equal(product.excluded.weak[0].rawPointId, 2);
  assert.equal(product.track[1].reason, 'recovery_transport_suspected_kept');
  assert.equal(product.track[2].reason, 'transport_suspected_kept');
  assert.equal(product.track[1].entersTrustedGpx, false);
  assert.equal(product.track[2].entersTrustedGpx, false);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.stats.transportCount, 2);
  assert.ok(product.stats.suspectedDistanceMeters > 20);
  const transportScenario = scenarioByName(product, 'transport_contamination');
  assert.ok(transportScenario);
  assert.deepEqual(transportScenario.anchorRawPointIds, [3, 4]);
  assert.deepEqual(transportScenario.evidence.keptRawPointIds, [3, 4]);
  assert.deepEqual(transportScenario.evidence.pendingRawPointIds, []);
  assert.equal(transportScenario.evidence.countsDistance, false);
});

test('buildSixLayerTrackProduct rescues continuous low-accuracy hiking points', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00004,"lng":120,"accuracy":32,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00008,"lng":120,"accuracy":32,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00012,"lng":120,"accuracy":42,"elapsedRealtimeNanos":10000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3]);
  assert.equal(product.track[1].reason, 'continuity_rescue_low_accuracy');
  assert.equal(product.track[2].reason, 'continuity_rescue_low_accuracy');
  assert.deepEqual(product.excluded.weak.map((point) => point.rawPointId), [4]);
});

test('buildSixLayerTrackProduct can recover after excluded transport risk', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":14000000000,"endElapsedRealtimeNanos":15000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.002,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00202,"lng":120,"accuracy":5,"elapsedRealtimeNanos":12000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.00208,"lng":120,"accuracy":5,"elapsedRealtimeNanos":15000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 4, 5]);
  assert.equal(product.track[1].reason, 'gap_recovery');
  assert.equal(product.track[1].distanceDeltaMeters, 0);
  assert.equal(product.track[2].reason, 'motion_supported_low_speed');
  assert.equal(product.stats.transportCount, 2);
  assert.ok(product.stats.totalDistanceMeters > 6);
  assert.ok(scenarioByName(product, 'transport_contamination'));
  assert.ok(scenarioByName(product, 'gap_recovery_boundary'));
});

test('buildSixLayerTrackProduct collapses a marked dwell drift cloud into one anchor', () => {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'raw_location',
      rawPointId: 1,
      provider: 'gps',
      lat: 30,
      lng: 120,
      accuracy: 5,
      elapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'raw_location',
      rawPointId: 255,
      provider: 'gps',
      lat: 30.0001,
      lng: 120,
      accuracy: 5,
      elapsedRealtimeNanos: 4_000_000_000
    }
  ];
  let elapsedSeconds = 7;
  let lat = 30.00016;
  for (let rawPointId = 256; rawPointId <= 273; rawPointId++) {
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat,
      lng: 120,
      accuracy: rawPointId < 264 ? 5 : 12,
      speed: rawPointId < 272 ? 1 : 0,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
    elapsedSeconds += 3;
    lat += 2 / 111_111;
  }
  for (let rawPointId = 274; rawPointId <= 307; rawPointId++) {
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat,
      lng: 120,
      accuracy: rawPointId === 301 ? 120 : 90,
      speed: 0,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
    elapsedSeconds += 2;
  }
  let lng = 120;
  for (let rawPointId = 308; rawPointId <= 312; rawPointId++) {
    lng += 3 / (111_111 * Math.cos(30 * Math.PI / 180));
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat,
      lng,
      accuracy: 22,
      speed: 1,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
    elapsedSeconds += 3;
  }

  const product = buildSixLayerTrackProduct(events);
  const collapsed = product.track.find((point) =>
    point.reason === 'stationary_drift_anchor');

  assert.ok(collapsed);
  assert.equal(collapsed.sourceRawPointId, collapsed.representativeRawPointId);
  assert.equal(collapsed.cloudSampleCount, 57);
  assert.deepEqual([
    collapsed.contributingRawPointIds[0],
    collapsed.contributingRawPointIds.at(-1)
  ], [256, 312]);
  assert.equal(product.track.filter((point) =>
    point.sourceRawPointId >= 256 && point.sourceRawPointId <= 312).length, 1);
  assert.equal(product.excluded.weak.some((point) =>
    point.rawPointId >= 256 && point.rawPointId <= 312), false);
  assert.equal(product.excluded.rejected.some((point) =>
    point.rawPointId >= 256 && point.rawPointId <= 312), false);
  assert.equal(product.excluded.intakeRejected.some((point) =>
    point.rawPointId >= 256 && point.rawPointId <= 312), false);
  assert.equal(product.dwellDriftCollapse.collapsedCloudCount, 1);
  assert.equal(collapsed.countsDistance, false);
  const driftScenario = scenarioByName(product, 'stationary_drift_collapse');
  assert.ok(driftScenario);
  assert.equal(collapsed.primaryExplanation.scenario, 'stationary_drift_collapse');
  assert.equal(driftScenario.action, 'collapse_drift_cloud');
  assert.equal(driftScenario.localRebuild, 'stationary_drift_anchor');
  assert.deepEqual(driftScenario.rawRange, {
    startRawPointId: 256,
    endRawPointId: 312
  });
  assert.deepEqual(driftScenario.anchorRawPointIds, [collapsed.representativeRawPointId]);
  assert.equal(driftScenario.evidence.representativeRawPointId,
    collapsed.representativeRawPointId);
  assert.equal(driftScenario.evidence.rawPointCount, 57);
  assert.equal(driftScenario.evidence.coreStartRawPointId, 274);
  assert.equal(driftScenario.evidence.coreEndRawPointId, 307);
});

test('buildSixLayerTrackProduct collapses a whole stationary session near weak drift representative', () => {
  const events = [
    {
      event: 'session_metadata',
      sessionId: 'S1',
      recordStartElapsedRealtimeNanos: 1_000_000_000
    },
    {
      event: 'sampling_policy',
      samplingEpochId: 1,
      state: 'MOVING',
      eventElapsedRealtimeNanos: 1_000_000_000
    }
  ];
  let elapsedSeconds = 1;
  for (let rawPointId = 140; rawPointId <= 170; rawPointId++) {
    const isWeakCore = rawPointId >= 155 && rawPointId <= 166;
    events.push({
      event: 'raw_location',
      rawPointId,
      provider: 'gps',
      lat: rawPointId === 157 ? 30.00003 : 30,
      lng: rawPointId === 157 ? 120.00004 : 120,
      accuracy: isWeakCore ? 70 : 12,
      speed: rawPointId === 157 ? 0.15 : 0,
      elapsedRealtimeNanos: elapsedSeconds * 1_000_000_000
    });
    elapsedSeconds += 10;
  }

  const product = buildSixLayerTrackProduct(events);

  assert.equal(product.track.length, 1);
  assert.equal(product.track[0].reason, 'stationary_session_anchor');
  assert.equal(product.track[0].sourceRawPointId, 157);
  assert.equal(product.track[0].cloudSampleCount, 31);
  assert.deepEqual([
    product.track[0].contributingRawPointIds[0],
    product.track[0].contributingRawPointIds.at(-1)
  ], [140, 170]);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.stats.segmentCount, 1);
  assert.equal(product.stats.gapCount, 0);
  assert.equal(product.stats.weakPointCount, 0);
  assert.equal(product.stats.rejectedPointCount, 0);
  assert.equal(product.stationarySessionCollapse.representativeRawPointId, 157);
  const stationaryScenario = scenarioByName(product, 'stationary_session_collapse');
  assert.ok(stationaryScenario);
  assert.equal(product.track[0].primaryExplanation.scenario, 'stationary_session_collapse');
  assert.equal(product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 157).primaryExplanation.scenario, 'stationary_session_collapse');
  assert.equal(stationaryScenario.action, 'collapse_to_single_anchor');
  assert.equal(stationaryScenario.localRebuild, 'stationary_session_anchor');
  assert.deepEqual(stationaryScenario.rawRange, {
    startRawPointId: 140,
    endRawPointId: 170
  });
  assert.deepEqual(stationaryScenario.anchorRawPointIds, [157]);
  assert.equal(stationaryScenario.evidence.collapsedRawPointCount, 31);
  assert.equal(stationaryScenario.evidence.representativeRawPointId, 157);
});

test('buildSixLayerTrackProduct falls back to GNSS altitude when barometer jumps', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"barometer_window","barometerWindowId":1,"endElapsedRealtimeNanos":1000000000,"avgPressureHpa":1000,"avgRawBarometerAltitudeMeters":100}',
    '{"event":"barometer_window","barometerWindowId":2,"endElapsedRealtimeNanos":4000000000,"avgPressureHpa":990,"avgRawBarometerAltitudeMeters":150}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":104,"verticalAccuracy":4,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildSixLayerTrackProduct(model);

  assert.equal(product.stats.barometerAscentRejectedSampleCount, 1);
  assert.equal(product.stats.barometerTotalAscentMeters, -1);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 4);
  assert.equal(product.stats.selectedAscentSource, 'GNSS');
});

test('buildSixLayerTrackProduct ignores gnss_snapshot input for target decisions', () => {
  const withSnapshot = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","visibleTotal":0,"usedInFixTotal":0,"usedAvgCn0":0,"eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));
  const withoutSnapshot = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const productWithSnapshot = buildSixLayerTrackProduct(withSnapshot);
  const productWithoutSnapshot = buildSixLayerTrackProduct(withoutSnapshot);

  assert.deepEqual(
    productWithSnapshot.track.map((point) => [point.result, point.reason]),
    productWithoutSnapshot.track.map((point) => [point.result, point.reason])
  );
  assert.equal(productWithSnapshot.stats.totalDistanceMeters,
    productWithoutSnapshot.stats.totalDistanceMeters);
});
