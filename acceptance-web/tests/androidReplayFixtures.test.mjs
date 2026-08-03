import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTargetOutput, parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';

const FIXTURE_ROOT = fileURLToPath(new URL(
  '../../app/src/test/resources/replay-fixtures/',
  import.meta.url
));
const CONFIG = { stationarySessionCollapseEnabled: false };

test('android replay fixture good walk stays a normal platform-neutral walk', () => {
  const { output, product } = buildFixtureProduct('good_walk');

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2]);
  assert.equal(product.track[1].reason, 'moving_good_fix');
  assert.equal(product.track[1].countsDistance, true);
  assert.equal(product.track[1].countsMovingTime, true);
  assert.ok(product.stats.totalDistanceMeters > 20);
  assert.equal(product.stats.movingTimeSeconds, 10);
  assert.equal(output.summaries.raw.unexplainedCount, 0);
});

test('android replay weak start fixture stays out of hiking metrics', () => {
  const { output, product } = buildFixtureProduct('weak_start_cloud');
  const weak = product.excluded.weak.find((point) => point.rawPointId === 1);

  assert.deepEqual(product.track, []);
  assert.ok(weak);
  assert.equal(weak.reason, 'weak_horizontal_accuracy');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.stats.weakPointCount, 1);
  assert.equal(output.summaries.raw.unexplainedCount, 0);
});

test('android replay GAP recovery fixture does not bridge distance or moving time', () => {
  const { product } = buildFixtureProduct('gap_recovery_after_stationary_gap');
  const recovery = product.track.find((point) => point.sourceRawPointId === 2);
  const boundary = product.scenarios.find((scenario) =>
    scenario.scenario === 'gap_recovery_boundary');

  assert.ok(recovery);
  assert.equal(recovery.reason, 'gap_recovery');
  assert.equal(recovery.startsNewSegment, true);
  assert.equal(recovery.countsDistance, false);
  assert.equal(recovery.countsMovingTime, false);
  assert.equal(product.stats.gapCount, 1);
  assert.equal(product.stats.segmentCount, 2);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.ok(boundary);
  assert.deepEqual(boundary.rawRange, { startRawPointId: 2, endRawPointId: 2 });
  assert.equal(boundary.action, 'reset_segment_zero_delta');
});

test('android replay stationary recovery fixture remains pending and uncounted', () => {
  const { product } = buildFixtureProduct('stationary_recovery_after_gap');
  const pending = product.excluded.weak.find((point) => point.rawPointId === 2);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1]);
  assert.ok(pending);
  assert.equal(pending.reason, 'gap_recovery_pending');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
  assert.equal(product.stats.weakPointCount, 1);
});

test('android replay transport fixture preserves route outside hiking metrics', () => {
  const { product } = buildFixtureProduct('transport_mode');
  const transport = product.track.find((point) => point.sourceRawPointId === 3);
  const transportScenario = product.scenarios.find((scenario) =>
    scenario.scenario === 'transport_contamination');

  assert.deepEqual(product.excluded.rejected, []);
  assert.ok(transport);
  assert.equal(transport.reason, 'transport_suspected_kept');
  assert.equal(transport.entersTrustedGpx, true);
  // 里程口径变更（2026-08-01）：kept 的 transport 点计入总里程/移动时长。
  assert.equal(transport.countsDistance, true);
  assert.equal(transport.countsMovingTime, true);
  assert.equal(product.stats.transportCount, 1);
  assert.equal(product.stats.suspectedTransportSegmentCount, 1);
  assert.ok(product.stats.suspectedTransportDistanceMeters > 0);
  assert.ok(product.stats.suspectedTransportDurationSeconds > 0);
  assert.ok(product.stats.suspectedTransportAverageSpeedMetersPerSecond > 0);
  assert.equal(product.stats.gapCount, 0);
  assert.ok(transportScenario);
  assert.deepEqual(transportScenario.rawRange, { startRawPointId: 3, endRawPointId: 3 });
  assert.deepEqual(transportScenario.evidence.rejectedRawPointIds, []);
  assert.deepEqual(transportScenario.evidence.keptRawPointIds, [3]);
  assert.equal(transportScenario.evidence.routePreserved, true);
  assert.equal(transportScenario.evidence.countsDistance, true);
  assert.equal(transportScenario.evidence.countsMovingTime, true);
  assert.ok(transportScenario.evidence.suspectedDistanceMeters > 0);
  assert.ok(transportScenario.evidence.suspectedDurationSeconds > 0);
});

test('android replay high-frequency transport stays continuous below the 20m step gate', () => {
  const { product } = buildFixtureProduct('transport_high_frequency');
  const transportPoints = product.track.filter((point) =>
    point.reason === 'transport_suspected_kept');

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3, 4]);
  assert.equal(transportPoints.length, 3);
  assert.ok(transportPoints.every((point) => point.entersTrustedGpx));
  // 里程口径变更（2026-08-01）：kept 的 transport 点计入总里程/移动时长。
  assert.ok(transportPoints.every((point) => point.countsDistance));
  assert.ok(transportPoints.every((point) => point.countsMovingTime));
  assert.equal(product.excluded.rejected.length, 0);
  assert.equal(product.excluded.weak.length, 0);
  assert.equal(product.stats.suspectedTransportSegmentCount, 1);
});

test('android replay slow recovery with motion keeps walking metrics', () => {
  const { product } = buildFixtureProduct('stationary_recovery_with_motion');
  const moving = product.track.find((point) => point.sourceRawPointId === 2);

  assert.ok(moving);
  assert.equal(moving.reason, 'moving_good_fix');
  assert.equal(moving.countsDistance, true);
  assert.equal(moving.countsMovingTime, true);
  assert.ok(product.stats.totalDistanceMeters > 8);
  assert.equal(product.stats.movingTimeSeconds, 10);
});

function buildFixtureProduct(name) {
  const path = `${FIXTURE_ROOT}${name}.jsonl`;
  const model = parseEvidenceJsonl(readFileSync(path, 'utf8'), path);
  const product = buildSixLayerTrackProduct(model, { config: CONFIG });
  const output = buildTargetOutput(model, product);
  return { model, output, product };
}
