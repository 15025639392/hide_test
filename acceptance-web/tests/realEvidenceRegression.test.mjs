import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { buildTargetOutput, parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';

const SESSION_5CC_PATH = firstExistingPath([
  '/Users/ldy/Desktop/gps_data/gnss_evidence_5ccf3a9f-1d85-4c2b-8b24-61839d459845.jsonl',
  '/Users/ldy/Desktop/device_fix_track_evidence_20260523_210422/track_sessions/5ccf3a9f-1d85-4c2b-8b24-61839d459845/evidence.jsonl'
]);
const SESSION_0DD_PATH = '/Users/ldy/Desktop/device_fix_track_evidence_20260523_210422/track_sessions/0ddf2d35-02e2-454c-9057-667265fe8a71/evidence.jsonl';
const WATCH_TRANSPORT_PATH = '/Users/ldy/Desktop/数据/outdoor_track_evidence_v1(3).jsonl';
const WATCH_POSITION_SNAP_PATH = '/Users/ldy/Desktop/数据/outdoor_track_evidence_v1.jsonl';

const modelCache = new Map();
const productCache = new Map();

function firstExistingPath(paths) {
  return paths.find((path) => existsSync(path)) ?? paths[0];
}

function buildModelFromEvidence(path) {
  if (modelCache.has(path)) return modelCache.get(path);
  const model = parseEvidenceJsonl(readFileSync(path, 'utf8'), path);
  modelCache.set(path, model);
  return model;
}

function buildProductFromEvidence(path) {
  if (productCache.has(path)) return productCache.get(path);
  const model = buildModelFromEvidence(path);
  const product = buildSixLayerTrackProduct(model);
  productCache.set(path, product);
  return product;
}

function trackPointsTouchingRawRange(product, startRawPointId, endRawPointId) {
  return product.track.filter((point) =>
    (point.sourceRawPointId >= startRawPointId && point.sourceRawPointId <= endRawPointId)
      || point.contributingRawPointIds?.some((rawPointId) =>
        rawPointId >= startRawPointId && rawPointId <= endRawPointId));
}

function distanceForPoints(points) {
  return points.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters || 0 : 0), 0);
}

function scenarioByName(product, name, startRawPointId, endRawPointId) {
  return product.scenarios.find((scenario) =>
    scenario.scenario === name
      && scenario.rawRange?.startRawPointId <= endRawPointId
      && scenario.rawRange?.endRawPointId >= startRawPointId);
}

test('watch evidence keeps Raw 661-688 vehicle movement in the route', (t) => {
  if (!existsSync(WATCH_TRANSPORT_PATH)) {
    t.skip('watch transport evidence is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(WATCH_TRANSPORT_PATH);
  const decisions = product.rawPointDecisions.filter((decision) =>
    decision.rawPointId >= 661 && decision.rawPointId <= 688);
  const trackRawPointIds = product.track
    .filter((point) => point.sourceRawPointId >= 661 && point.sourceRawPointId <= 688)
    .map((point) => point.sourceRawPointId);

  assert.equal(decisions.length, 28);
  assert.ok(decisions.every((decision) =>
    decision.horizontalResult === 'accept'
      && decision.horizontalReason === 'transport_suspected_kept'
      && decision.entersTrustedGpx
      && !decision.countsDistance
      && !decision.countsMovingTime));
  assert.deepEqual(trackRawPointIds, Array.from({ length: 28 }, (_, index) => index + 661));
  assert.equal(new Set(decisions.map((decision) => decision.segmentId)).size, 1);
});

test('watch evidence removes Raw 698 low-speed forward spike', (t) => {
  if (!existsSync(WATCH_TRANSPORT_PATH)) {
    t.skip('watch transport evidence is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(WATCH_TRANSPORT_PATH);
  const scenario = product.scenarios.find((item) =>
    item.scenario === 'moving_spike_cleanup'
      && item.evidence?.spikeRawPointId === 698);
  const rawDecision = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 698);
  const bridgePoint = product.track.find((point) =>
    point.suppressedRawPointIds?.includes(698));

  assert.ok(scenario);
  assert.equal(scenario.evidence.previousRawPointId, 697);
  assert.equal(scenario.evidence.nextRawPointId, 699);
  assert.equal(scenario.evidence.speedPolicy, 'competing_low_speed_geometry_override');
  assert.ok(scenario.evidence.detourMeters > 12);
  assert.ok(scenario.evidence.lateralMeters > 6);
  assert.ok(scenario.evidence.forwardAngleDeltaDegrees < 3);
  assert.equal(rawDecision.entersTrustedGpx, false);
  assert.equal(rawDecision.countsDistance, false);
  assert.equal(rawDecision.countsMovingTime, false);
  assert.equal(rawDecision.primaryExplanation.scenario, 'moving_spike_cleanup');
  assert.ok(bridgePoint);
  assert.equal(bridgePoint.sourceRawPointId, 699);
  assert.deepEqual(bridgePoint.suppressedRawPointIds, [698]);
});

test('watch evidence removes Raw 375-378 unstable transport prefix', (t) => {
  if (!existsSync(WATCH_POSITION_SNAP_PATH)) {
    t.skip('watch position snap evidence is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(WATCH_POSITION_SNAP_PATH);
  const scenario = product.scenarios.find((item) =>
    item.scenario === 'position_snap_recovery'
      && item.evidence?.recoveryRawPointId === 379);
  const recovery = product.track.find((point) =>
    point.sourceRawPointId === 379);
  const cleanedDecisions = product.rawPointDecisions.filter((decision) =>
    decision.rawPointId >= 375 && decision.rawPointId <= 378);
  const continuedTransport = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 381);

  assert.ok(scenario);
  assert.equal(scenario.evidence.recoveryKind, 'unstable_transport_prefix');
  assert.deepEqual(scenario.evidence.weakRawPointIds, [373, 374, 376, 378]);
  assert.deepEqual(scenario.evidence.suppressedAcceptedRawPointIds, [375, 377]);
  assert.deepEqual(scenario.evidence.suppressedRawPointIds,
    [373, 374, 375, 376, 377, 378]);
  assert.ok(scenario.evidence.detourMeters > 65);
  assert.ok(scenario.evidence.maxReversalAngleDegrees > 159);
  assert.ok(scenario.evidence.continuationAngleDeltaDegrees < 6);
  assert.equal(cleanedDecisions.length, 4);
  assert.ok(cleanedDecisions.every((decision) =>
    !decision.entersTrustedGpx
      && !decision.countsDistance
      && !decision.countsMovingTime
      && decision.primaryExplanation?.scenario === 'position_snap_recovery'));
  assert.ok(recovery);
  assert.equal(recovery.reason, 'position_snap_recovery_anchor');
  assert.equal(recovery.distanceDeltaMeters, 0);
  assert.equal(recovery.movingTimeDeltaSeconds, 0);
  assert.deepEqual(recovery.suppressedRawPointIds, [373, 374, 375, 376, 377, 378]);
  assert.equal(continuedTransport.horizontalReason, 'transport_suspected_kept');
  assert.equal(continuedTransport.entersTrustedGpx, true);
});

test('real evidence session 5cc key dense rest ranges stay collapsed', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const model = buildModelFromEvidence(SESSION_5CC_PATH);
  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const output = buildTargetOutput(model, product);
  assert.ok(product.findings.some((finding) =>
    finding.includes('dense intent conflict')));
  assert.ok(product.denseIntentConflicts.some((conflict) =>
    conflict.conflict === 'local_micro_move_overrides_dense_forward'
    && conflict.rawRange.startRawPointId === 5050
    && conflict.rawRange.endRawPointId === 5094));
  assert.ok(output.denseIntentConflicts.some((conflict) =>
    conflict.rawRange.startRawPointId === 5050
    && conflict.rawRange.endRawPointId === 5094));
  assert.equal(product.denseIntentConflicts.some((conflict) =>
    conflict.rawRange.startRawPointId === 3862
    && conflict.rawRange.endRawPointId === 3929), false);
  assert.ok(product.forwardSpineConflicts.some((conflict) =>
    conflict.conflict === 'local_micro_move_overrides_forward_spine'
    && conflict.rawRange.startRawPointId === 3862
    && conflict.rawRange.endRawPointId === 3929));
  assert.ok(product.forwardSpineOverlaps.length > product.forwardSpineConflicts.length);
  assert.equal(product.forwardSpineConflicts.some((conflict) =>
    conflict.conflict === 'endpoint_touch_forward_spine_candidates'
    || conflict.conflict === 'overlapping_forward_spine_candidates'
    || conflict.conflict === 'nested_forward_spine_candidate'), false);
  for (const [startRawPointId, endRawPointId] of [
    [1944, 2014],
    [2461, 2483],
    [2795, 2834],
    [4562, 4610],
    [5050, 5094]
  ]) {
    const points = trackPointsTouchingRawRange(product, startRawPointId, endRawPointId);
    const scenario = scenarioByName(product, 'rest_photo_micro_move',
      startRawPointId, endRawPointId);

    assert.equal(points.length, 1);
    assert.equal(points[0].reason, 'rest_photo_micro_move_anchor');
    assert.equal(points[0].countsDistance, false);
    assert.equal(distanceForPoints(points), 0);
    assert.ok(scenario);
    assert.equal(scenario.action, 'collapse_micro_move_to_rest_anchor');
    assert.ok(Array.isArray(scenario.evidence.denseAreaIntents));
    assert.equal(typeof scenario.evidence.localMicroMoveOverridesDenseForward, 'boolean');
  }
});

test('real evidence session 5cc moving spike cleanup feeds later pipeline stages', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const scenario = scenarioByName(product, 'moving_spike_cleanup', 1666, 1668);
  const denseIntent = scenarioByName(product, 'dense_area_intent', 1667, 1685);
  const rawDecision = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 1666);
  const bridgePoint = product.track.find((point) =>
    point.sourceRawPointId === 1667);
  const previousPoint = product.track.find((point) =>
    point.sourceRawPointId === 1665);

  assert.ok(scenario);
  assert.equal(scenario.evidence.previousRawPointId, 1665);
  assert.equal(scenario.evidence.spikeRawPointId, 1666);
  assert.equal(scenario.evidence.nextRawPointId, 1667);
  assert.equal(scenario.evidence.reportedSpeedMetersPerSecond, 0.89);
  assert.ok(scenario.evidence.detourMeters > 6);
  assert.ok(denseIntent);
  assert.deepEqual(denseIntent.rawRange, {
    startRawPointId: 1667,
    endRawPointId: 1685
  });
  assert.equal(denseIntent.evidence.trackPointCount, 16);
  assert.equal(rawDecision.entersTrustedGpx, false);
  assert.equal(rawDecision.countsDistance, false);
  assert.equal(rawDecision.primaryExplanation.scenario, 'moving_spike_cleanup');
  assert.ok(previousPoint);
  assert.deepEqual(previousPoint.contributingRawPointIds, [1665]);
  assert.ok(bridgePoint);
  assert.deepEqual(bridgePoint.contributingRawPointIds, [1667]);
  assert.deepEqual(bridgePoint.suppressedRawPointIds, [1666]);
  assert.equal(bridgePoint.primaryExplanation.scenario, 'moving_spike_cleanup');
});

test('real evidence session 5cc weak rest photo micro movement keeps shape', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const scenario = scenarioByName(product, 'rest_photo_micro_move', 5015, 5042);
  const points = trackPointsTouchingRawRange(product, 5015, 5042);
  const representativeDecision = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 5023);
  const postRestPoint = points.find((point) => point.sourceRawPointId === 5039);

  assert.ok(scenario);
  assert.equal(scenario.action, 'filter_weak_micro_move_shape');
  assert.equal(scenario.localRebuild, 'rest_photo_micro_move_shape_filter');
  assert.equal(scenario.evidence.outputTrackPointCount, 8);
  assert.equal(scenario.evidence.representativeRawPointId, 5023);
  assert.ok(scenario.evidence.anchorDetourMeters > 12);
  assert.deepEqual(points.map((point) => point.sourceRawPointId), [
    5015, 5016, 5017, 5018, 5039, 5040, 5041, 5042
  ]);
  assert.ok(scenario.evidence.keptRawPointIds.includes(5018));
  assert.ok(scenario.evidence.suppressedRawPointIds.includes(5023));
  assert.equal(points.some((point) => point.reason === 'rest_photo_micro_move_anchor'), false);
  assert.ok(postRestPoint);
  assert.equal(postRestPoint.countsMovingTime, false);
  assert.ok(postRestPoint.suppressedRawPointIds.includes(5023));
  assert.equal(representativeDecision.entersTrustedGpx, false);
  assert.equal(representativeDecision.primaryExplanation.scenario, 'rest_photo_micro_move');
});

test('real evidence session 5cc high-speed geometry spike cleanup removes raw 1585', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const scenario = scenarioByName(product, 'moving_spike_cleanup', 1578, 1586);
  const rawDecision = product.rawPointDecisions.find((decision) =>
    decision.rawPointId === 1585);
  const bridgePoint = product.track.find((point) =>
    point.suppressedRawPointIds?.includes(1585));

  assert.ok(scenario);
  assert.equal(scenario.evidence.previousRawPointId, 1578);
  assert.equal(scenario.evidence.spikeRawPointId, 1585);
  assert.equal(scenario.evidence.nextRawPointId, 1586);
  assert.equal(scenario.evidence.reportedSpeedMetersPerSecond, 2.57);
  assert.equal(scenario.evidence.speedPolicy, 'high_reported_speed_geometry_override');
  assert.ok(scenario.evidence.detourMeters > 6);
  assert.ok(scenario.evidence.lateralMeters > 6);
  assert.ok(scenario.evidence.forwardAngleDeltaDegrees < 3);
  assert.equal(rawDecision.entersTrustedGpx, false);
  assert.equal(rawDecision.countsDistance, false);
  assert.equal(rawDecision.primaryExplanation.scenario, 'moving_spike_cleanup');
  assert.ok(bridgePoint);
  assert.equal(bridgePoint.sourceRawPointId, 1586);
  assert.deepEqual(bridgePoint.contributingRawPointIds, [1586]);
  assert.deepEqual(bridgePoint.suppressedRawPointIds, [1585]);
  assert.equal(bridgePoint.primaryExplanation.scenario, 'moving_spike_cleanup');
});

test('real evidence session 5cc composite round trip candidate stays local', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const output = buildTargetOutput(buildModelFromEvidence(SESSION_5CC_PATH), product);
  const sameRoadScenario = scenarioByName(product, 'same_road_round_trip', 417, 900);
  const lineScenario = scenarioByName(product, 'round_trip_line', 417, 900);
  const compositeScenario = scenarioByName(product, 'composite_gap_local_settlement',
    417, 900);
  const compositeContext = output.streamingDiagnosticContexts.contexts.find((context) =>
    context.scenario === 'composite_gap_local_settlement'
      && context.rawRange.startRawPointId === 417
      && context.rawRange.endRawPointId === 900);
  const rejected = product.roundTripLineRejectedCandidates?.find((candidate) =>
    candidate.rawRange.startRawPointId === 417
      && candidate.rawRange.endRawPointId === 900);
  const coverage = product.scenarioCoverage.find((item) =>
    item.scenario === 'composite_gap_local_settlement'
      && item.rawRange.startRawPointId === 417
      && item.rawRange.endRawPointId === 900);
  const points = trackPointsTouchingRawRange(product, 417, 900);
  const reasons = new Set(points.map((point) => point.reason));

  assert.equal(sameRoadScenario, undefined);
  assert.equal(lineScenario, undefined);
  assert.ok(compositeScenario);
  assert.equal(compositeScenario.primaryEligible, false);
  assert.equal(compositeScenario.action, 'reject_round_trip_rewrite');
  assert.equal(compositeScenario.localRebuild, 'local_settlement_pipeline');
  assert.ok(rejected);
  assert.deepEqual(rejected.rawRange, {
    startRawPointId: 417,
    endRawPointId: 900
  });
  assert.equal(rejected.inputTrackPointCount, 71);
  assert.equal(rejected.roundTripIntentSupported, false);
  assert.equal(rejected.sameRoadCollapseReason,
    'missing_round_trip_intent_long_span');
  assert.equal(rejected.rejectionReason,
    'missing_round_trip_intent_long_composite_span');
  assert.equal(rejected.sameRoadBboxMeters, 54.966);
  assert.equal(rejected.sameRoadApproachPairDistanceMeters, 20.628);
  assert.ok(rejected.durationSeconds > 3000);
  assert.ok(rejected.maxSampleGapSeconds > 1000);
  assert.ok(compositeContext);
  assert.equal(compositeContext.metricOwner, false);
  assert.deepEqual(compositeContext.affectedMetricGates, []);
  assert.deepEqual(compositeContext.anchorRawPointIds, [643, 653]);
  assert.equal(compositeContext.evidence.rejectionReason,
    'missing_round_trip_intent_long_composite_span');
  assert.equal(compositeContext.evidence.sameRoadCollapseReason,
    'missing_round_trip_intent_long_span');
  assert.equal(compositeContext.evidence.sameRoadBboxMeters, 54.966);
  assert.equal(compositeContext.evidence.roundTripIntentSupported, false);
  assert.ok(coverage);
  assert.equal(coverage.primaryTrackPointCount, 0);
  assert.equal(coverage.contextTrackPointCount, points.length);
  assert.equal(points.length, 28);
  assert.ok(reasons.has('rest_photo_micro_move_anchor'));
  assert.ok(reasons.has('weak_recovery_shape_anchor'));
  assert.ok(reasons.has('gap_recovery'));
  assert.ok(reasons.has('stationary_anchor'));
  assert.ok(points.every((point) =>
    point.primaryExplanation?.scenario !== 'composite_gap_local_settlement'));
  assert.ok(points.some((point) =>
    point.scenarioContexts?.some((context) =>
      context.scenario === 'composite_gap_local_settlement')));
  assert.ok(distanceForPoints(points) < 130);
});

test('real evidence session 5cc mixed loop cluster keeps bounded distance', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const output = buildTargetOutput(buildModelFromEvidence(SESSION_5CC_PATH), product);
  const points = trackPointsTouchingRawRange(product, 3192, 3946);
  const settlement = scenarioByName(product, 'enclosed_loop_cluster_settlement',
    3192, 3946);
  const loopContext = output.streamingDiagnosticContexts.contexts.find((context) =>
    context.scenario === 'closed_loop_round_trip'
      && context.rawRange.startRawPointId === 2883
      && context.rawRange.endRawPointId === 3037);

  assert.equal(points.length, 19);
  assert.ok(distanceForPoints(points) <= 55);
  assert.ok(settlement);
  assert.deepEqual(settlement.rawRange, {
    startRawPointId: 3215,
    endRawPointId: 3938
  });
  assert.equal(settlement.action, 'compress_enclosed_loop_low_speed_drift');
  assert.equal(settlement.evidence.settledDistanceMeters, 0);
  assert.ok(loopContext);
  assert.equal(loopContext.metricOwner, false);
  assert.deepEqual(loopContext.affectedMetricGates, []);
  assert.equal(loopContext.action, 'classify_loop_without_rewrite');
  assert.equal(loopContext.localRebuild, 'round_trip_diagnostic');
  assert.equal(loopContext.evidence.trackPointCount, 105);
});

test('real evidence session 0dd stationary range collapses to one drift anchor', (t) => {
  if (!existsSync(SESSION_0DD_PATH)) {
    t.skip('real evidence session 0dd is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_0DD_PATH);
  const points = trackPointsTouchingRawRange(product, 256, 312);
  const scenario = scenarioByName(product, 'stationary_drift_collapse', 256, 312);

  assert.equal(points.length, 1);
  assert.equal(points[0].reason, 'stationary_drift_anchor');
  assert.equal(points[0].countsDistance, false);
  assert.equal(points[0].routeLineVertex, false);
  assert.equal(points[0].routeLineStrategy, 'bridge_previous_next');
  assert.equal(distanceForPoints(points), 0);
  assert.ok(scenario);
  assert.deepEqual(scenario.rawRange, {
    startRawPointId: 256,
    endRawPointId: 312
  });
  assert.equal(scenario.evidence.representativeRawPointId, points[0].sourceRawPointId);
});
