import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetOutput,
  explainDecisionReason,
  isEvidenceCandidatePath,
  parseEvidenceJsonl,
  projectPoint
} from '../src/diagnosticMap.mjs';
import { buildTargetTrackProduct } from '../src/targetProduct.mjs';

test('evidence path detection accepts exported evidence jsonl', () => {
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl.json'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/location_evidence_session-1.jsonl'), false);
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
    '{"event":"raw_location","rawPointId":2,"provider":"network","lat":29.001,"lng":106,"accuracy":8,"elapsedRealtimeNanos":2000000000}'
  ].join('\n'));
  const product = buildTargetTrackProduct(model);
  const output = buildTargetOutput(model, product);

  assert.equal(output.summaries.raw.unexplainedCount, 0);
  assert.equal(output.summaries.decision.decisionCount, 2);
  assert.equal(output.summaries.decision.anchorCount, 1);
  assert.equal(output.summaries.decision.acceptCount, 1);
  assert.equal(output.summaries.decision.intakeRejectedCount, 0);
  assert.equal(output.summaries.sessionProfile.raw.sampleCount, 2);
  assert.equal(output.summaries.sessionProfile.sampleInterval.p50Seconds, 1);
  assert.equal(output.summaries.adaptiveShadow.mode, 'shadow_only');
  assert.ok(Array.isArray(output.summaries.adaptiveShadows));
  assert.equal(output.summaries.adaptiveShadows[0].id, 'adaptive-balanced');
  assert.ok(Array.isArray(output.summaries.adaptiveShadow.track));
  assert.ok(Number.isFinite(output.summaries.adaptiveShadow.impact.fixed.trustedPointCount));
  assert.ok(Number.isFinite(output.summaries.adaptiveShadow.impact.delta.trustedPointCount));
  assert.ok(output.summaries.adaptiveShadow.assessment.label.length > 0);
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
  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });
  const output = buildTargetOutput(model, product);

  assert.equal(product.stats.selectedAscentSource, 'LOCATION_ALTITUDE');
  assert.equal(output.selectedTotalAscentMeters, 42);
  assert.equal(output.selectedAscentSource, 'BAROMETER');
  assert.equal(output.summaries.pressure.selectedAscentSource, 'BAROMETER');
  assert.equal(output.summaries.pressure.barometerTotalAscentMeters, 42);
  assert.equal(output.summaries.pressure.locationAltitudeTotalAscentMeters, 10);
});

test('buildTargetOutput treats collapsed stationary contributing raw points as explained', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":11000000000,"endElapsedRealtimeNanos":12000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":9000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000014,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000}'
  ].join('\n'));
  const product = buildTargetTrackProduct(model);
  const output = buildTargetOutput(model, product);

  assert.equal(product.stationarySessionCollapsed, true);
  assert.deepEqual(product.track[0].contributingRawPointIds, [1, 3]);
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
    'motion_supported_low_quality',
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
