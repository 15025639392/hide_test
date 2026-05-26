import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { buildTargetOutput, parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from '../src/sixLayerTrackProduct.mjs';

const SESSION_5CC_PATH = '/Users/ldy/Desktop/device_fix_track_evidence_20260523_210422/track_sessions/5ccf3a9f-1d85-4c2b-8b24-61839d459845/evidence.jsonl';
const SESSION_0DD_PATH = '/Users/ldy/Desktop/device_fix_track_evidence_20260523_210422/track_sessions/0ddf2d35-02e2-454c-9057-667265fe8a71/evidence.jsonl';

const modelCache = new Map();
const productCache = new Map();

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

test('real evidence session 5cc mixed loop cluster keeps bounded distance', (t) => {
  if (!existsSync(SESSION_5CC_PATH)) {
    t.skip('real evidence session 5cc is not available on this machine');
    return;
  }

  const product = buildProductFromEvidence(SESSION_5CC_PATH);
  const points = trackPointsTouchingRawRange(product, 3192, 3946);
  const settlement = scenarioByName(product, 'enclosed_loop_cluster_settlement',
    3192, 3946);

  assert.equal(points.length, 19);
  assert.ok(distanceForPoints(points) <= 55);
  assert.ok(settlement);
  assert.deepEqual(settlement.rawRange, {
    startRawPointId: 3215,
    endRawPointId: 3938
  });
  assert.equal(settlement.action, 'compress_enclosed_loop_low_speed_drift');
  assert.equal(settlement.evidence.settledDistanceMeters, 0);
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
  assert.equal(distanceForPoints(points), 0);
  assert.ok(scenario);
  assert.deepEqual(scenario.rawRange, {
    startRawPointId: 256,
    endRawPointId: 312
  });
  assert.equal(scenario.evidence.representativeRawPointId, points[0].sourceRawPointId);
});
