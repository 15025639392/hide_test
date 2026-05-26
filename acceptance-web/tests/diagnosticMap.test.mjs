import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetOutput,
  explainDecisionReason,
  isEvidenceCandidatePath,
  parseEvidenceJsonl,
  projectPoint
} from '../src/diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from '../src/sixLayerTrackProduct.mjs';

test('evidence path detection accepts exported evidence jsonl', () => {
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl.json'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/location_evidence_session-1.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/gnss_evidence_5ccf3a9f-1d85-4c2b-8b24-61839d459845.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/diagnostic.jsonl'), false);
});

test('parseEvidenceJsonl parses pure evidence without recorded result events', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v1"}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"elapsedRealtimeNanos":1000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106.001,"accuracy":9,"elapsedRealtimeNanos":2000}'
  ].join('\n'));

  assert.equal(model.summary.rawCount, 2);
  assert.equal(model.summary.decisionCount, 0);
});

test('buildTargetOutput exposes raw and evidence summaries', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1"}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"elapsedRealtimeNanos":1000}'
  ].join('\n'));
  const output = buildTargetOutput(model);

  assert.equal(output.rawTrack.length, 1);
  assert.ok(output.findings.includes('配速不可计算'));
});

test('buildTargetOutput uses recomputed target product instead of recorded decisions', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.0002,"lng":106,"accuracy":8,"elapsedRealtimeNanos":31000000000}'
  ].join('\n'));
  const product = buildSixLayerTrackProduct(model);
  const output = buildTargetOutput(model, product);

  assert.equal(output.summaries.raw.unexplainedCount, 0);
  assert.equal(output.summaries.decision.decisionCount, 2);
  assert.equal(output.summaries.decision.anchorCount, 1);
  assert.equal(output.summaries.decision.acceptCount, 1);
  assert.equal(output.summaries.decision.intakeRejectedCount, 0);
  assert.equal(output.summaries.decision.weakCount, 0);
  assert.equal(output.summaries.decision.rejectCount, 0);
  assert.ok(Array.isArray(output.denseAreaSettlementPlan));
  assert.ok(Array.isArray(output.denseIntentConflicts));
  assert.ok(Array.isArray(output.forwardSpineCandidates));
  assert.ok(Array.isArray(output.forwardSpineOverlaps));
  assert.ok(Array.isArray(output.forwardSpineConflicts));
  assert.ok(Array.isArray(output.forwardSpineDecisions));
  assert.ok(!output.findings.some((finding) => finding.includes('未解释 raw_location')));
});

test('buildTargetOutput preserves recorded ascent summary when target product has Location altitude fallback', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"ascent_summary","selectedTotalAscentMeters":42,"selectedAscentSource":"BAROMETER","barometerTotalAscentMeters":42}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"altitude":100,"verticalAccuracy":4,"speed":2,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.00012,"lng":106,"accuracy":8,"altitude":110,"verticalAccuracy":4,"speed":2,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));
  const product = buildSixLayerTrackProduct(model, {
    config: { stationarySessionCollapseEnabled: false }
  });
  const output = buildTargetOutput(model, product);

  assert.equal(product.stats.selectedAscentSource, 'GNSS');
  assert.equal(output.selectedTotalAscentMeters, 42);
  assert.equal(output.selectedAscentSource, 'BAROMETER');
  assert.equal(output.summaries.pressure.selectedAscentSource, 'BAROMETER');
  assert.equal(output.summaries.pressure.barometerTotalAscentMeters, 42);
  assert.equal(output.summaries.pressure.locationAltitudeTotalAscentMeters, 10);
});

test('buildTargetOutput treats collapsed stationary contributing raw points as explained', () => {
  const events = [
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}'
  ];
  for (let rawPointId = 1; rawPointId <= 24; rawPointId++) {
    const elapsed = rawPointId * 10_000_000_000;
    events.push(`{"event":"raw_location","rawPointId":${rawPointId},"provider":"gps","lat":30,"lng":120,"accuracy":5,"speed":0,"elapsedRealtimeNanos":${elapsed}}`);
  }
  const model = parseEvidenceJsonl(events.join('\n'));
  const product = buildSixLayerTrackProduct(model);
  const output = buildTargetOutput(model, product);

  assert.equal(product.stationarySessionCollapsed, true);
  assert.deepEqual(product.track[0].contributingRawPointIds, Array.from(
    { length: 24 }, (_, index) => index + 1));
  assert.equal(output.summaries.raw.unexplainedCount, 0);
  assert.ok(!output.findings.some((finding) => finding.includes('未解释 raw_location')));
});

test('explainDecisionReason returns Chinese reason guidance with fallback', () => {
  const known = explainDecisionReason('accept', 'moving_good_fix');
  assert.equal(known.title, '移动好点');
  for (const reason of [
    'recovery_transport_suspected_kept',
    'stationary_continuity_jitter',
    'stationary_anchor_redundant',
    'motion_supported_low_speed',
    'continuity_rescue_low_accuracy',
    'stationary_low_accuracy_tail',
    'missing_position_source'
  ]) {
    const explanation = explainDecisionReason('accept', reason);
    assert.ok(!explanation.meaning.includes('还没有这个算法原因'));
  }
  const unknown = explainDecisionReason('accept', 'custom_reason');
  assert.ok(unknown.meaning.includes('还没有这个算法原因'));
});

test('parseEvidenceJsonl keeps malformed lines as parse errors', () => {
  const model = parseEvidenceJsonl('{"event":"session_metadata"}\nnot-json');
  assert.equal(model.parseErrors.length, 1);
});

test('projectPoint maps bounds into svg coordinate space', () => {
  const point = projectPoint({ lat: 29.5, lng: 106.5 }, {
    minLat: 29,
    maxLat: 30,
    minLng: 106,
    maxLng: 107
  }, 200, 100);

  assert.equal(point.x, 100);
  assert.equal(point.y, 50);
});
