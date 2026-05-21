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
  assert.equal(isEvidenceCandidatePath('/tmp/gnss_evidence_session-1.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/diagnostic.jsonl'), false);
});

test('parseEvidenceJsonl parses pure evidence without recorded result events', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v1"}',
    '{"event":"gnss_snapshot","snapshotId":7,"receivedElapsedRealtimeNanos":900,"visibleTotal":10,"usedInFixTotal":7,"usedAvgCn0":30,"allAvgCn0":28,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"elapsedRealtimeNanos":1000,"sourceGnssSnapshotId":7}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106.001,"accuracy":9,"elapsedRealtimeNanos":2000}'
  ].join('\n'));

  assert.equal(model.summary.rawCount, 2);
  assert.equal(model.summary.decisionCount, 0);
  assert.equal(model.summary.gnssSnapshotCount, 1);
  assert.equal(model.points[0].gnss.usedAvgCn0, 30);
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
  assert.equal(output.summaries.decision.intakeRejectedCount, 1);
  assert.ok(!output.findings.some((finding) => finding.includes('未解释 raw_location')));
});

test('explainDecisionReason returns Chinese reason guidance with fallback', () => {
  const known = explainDecisionReason('accept', 'moving_good_fix');
  assert.equal(known.title, '移动好点');
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
