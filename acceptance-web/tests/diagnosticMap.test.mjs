import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetOutput,
  explainDecisionReason,
  isDiagnosticCandidatePath,
  isDiagnosticJsonlPath,
  parseDiagnosticJsonl,
  projectPoint
} from '../src/diagnosticMap.mjs';

test('diagnostic path detection accepts exported diagnostic jsonl', () => {
  assert.equal(isDiagnosticJsonlPath('diagnostic.jsonl'), true);
  assert.equal(isDiagnosticJsonlPath('diagnostic.jsonl.json'), true);
  assert.equal(isDiagnosticJsonlPath('device-a/session-1/diagnostic.jsonl'), true);
  assert.equal(isDiagnosticJsonlPath('device-a/session-1/diagnostic.jsonl.json'), true);
  assert.equal(isDiagnosticJsonlPath('device-a/session.json'), false);
  assert.equal(isDiagnosticCandidatePath('one.jsonl'), true);
  assert.equal(isDiagnosticCandidatePath('one.jsonl.json'), true);
  assert.equal(isDiagnosticCandidatePath('session.json'), false);
});

test('parseDiagnosticJsonl links decisions to raw points and builds summary', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v1","deviceBrand":"brand","deviceModel":"model"}',
    '{"event":"gnss_snapshot","snapshotId":7,"usedInFixTotal":8,"usedAvgCn0":31.5}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":5,"elapsedRealtimeNanos":1000,"sourceGnssSnapshotId":7}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good","segmentId":1,"distanceDeltaMeters":0,"movingTimeDeltaSeconds":0,"sourceGnssSnapshotId":7}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106.002,"accuracy":9,"elapsedRealtimeNanos":1000001000}',
    '{"event":"decision","decisionId":2,"rawPointId":2,"result":"weak","reason":"weak_signal_stage2"}'
  ].join('\n'));

  assert.equal(model.sessionId, 'S1');
  assert.equal(model.summary.rawCount, 2);
  assert.equal(model.summary.decisionCount, 2);
  assert.equal(model.summary.trustedCount, 1);
  assert.equal(model.summary.weakCount, 1);
  assert.equal(model.points[0].gnss.usedInFixTotal, 8);
  assert.equal(model.points[1].decision.reasonExplanation.title, '弱点云');
  assert.equal(model.reasonCounts[1].explanation.title, '弱点云');
  assert.deepEqual(model.reasonCounts.map((item) => item.reason), [
    'anchor:first_fix_good',
    'weak:weak_signal_stage2'
  ]);
});

test('parseDiagnosticJsonl treats intake rejection as raw point explanation', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v3"}',
    '{"event":"gnss_snapshot","snapshotId":7,"usedInFixTotal":3,"usedAvgCn0":18,"allAvgCn0":17,"top4AvgCn0":20}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":90,"elapsedRealtimeNanos":1000,"sourceGnssSnapshotId":7}',
    '{"event":"location_intake_rejected","rawPointId":1,"rejectReason":"accuracy_too_large","eventElapsedRealtimeNanos":1000}'
  ].join('\n'));

  assert.equal(model.summary.rawCount, 1);
  assert.equal(model.summary.decisionCount, 0);
  assert.equal(model.summary.intakeRejectedCount, 1);
  assert.equal(model.summary.rejectedCount, 1);
  assert.equal(model.summary.undecidedCount, 0);
  assert.equal(model.points[0].kind, 'intake_rejected');
  assert.equal(model.points[0].decision.result, 'intake_rejected');
  assert.equal(model.points[0].decision.reasonExplanation.title, '精度过大');
  assert.ok(model.points[0].insights.some((item) => item.text.includes('SamplingIntake')));
  assert.deepEqual(model.reasonCounts.map((item) => item.reason), [
    'intake_rejected:accuracy_too_large'
  ]);
});

test('buildTargetOutput calculates target function preview metrics', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v3","deviceBrand":"brand","deviceModel":"model"}',
    '{"event":"gnss_snapshot","snapshotId":7,"visibleTotal":10,"usedInFixTotal":8,"usedAvgCn0":31.5,"top4AvgCn0":34.2}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":7}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good","segmentId":1,"trackPointId":1,"distanceDeltaMeters":0,"movingTimeDeltaSeconds":0,"sourceGnssSnapshotId":7}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106,"accuracy":8,"elapsedRealtimeNanos":61000000000,"sourceGnssSnapshotId":7}',
    '{"event":"decision","decisionId":2,"rawPointId":2,"result":"accept","reason":"moving_good_fix","segmentId":1,"trackPointId":2,"distanceDeltaMeters":120,"movingTimeDeltaSeconds":60,"sourceGnssSnapshotId":7}',
    '{"event":"session_event","eventType":"finish_recording","selectedTotalAscentMeters":42.5,"selectedAscentSource":"BAROMETER","barometerTotalAscentMeters":42.5,"gnssTotalAscentMeters":41.0}',
    '{"event":"pressure_sample","pressureSampleId":1,"pressureHpa":1000,"rawBarometerAltitudeMeters":110,"eventElapsedRealtimeNanos":2000000000}',
    '{"event":"motion_summary","motionSummaryId":1,"firstElapsedRealtimeNanos":1000000000,"lastElapsedRealtimeNanos":2000000000,"isDeviceStill":true}'
  ].join('\n'));

  const output = buildTargetOutput(model);

  assert.equal(output.trackPointCount, 2);
  assert.equal(output.totalDistanceMeters, 120);
  assert.equal(output.movingTimeSeconds, 60);
  assert.equal(output.paceSecondsPerKm, 500);
  assert.equal(output.selectedTotalAscentMeters, 42.5);
  assert.equal(output.summaries.raw.count, 2);
  assert.equal(output.summaries.decision.anchorCount, 1);
  assert.equal(output.summaries.decision.acceptCount, 1);
  assert.equal(output.summaries.gnss.snapshotCount, 1);
  assert.equal(output.summaries.pressure.pressureSampleCount, 1);
  assert.equal(output.summaries.motion.motionSummaryCount, 1);
});

test('buildTargetOutput marks pace and ascent as unavailable when evidence is missing', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good","distanceDeltaMeters":0,"movingTimeDeltaSeconds":0}'
  ].join('\n'));

  const output = buildTargetOutput(model);

  assert.equal(output.paceSecondsPerKm, null);
  assert.equal(output.selectedTotalAscentMeters, null);
  assert.ok(output.findings.includes('配速不可计算'));
  assert.ok(output.findings.includes('累计爬升证据不足'));
});

test('point diagnostic context exposes previous trusted distance time and speed', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good","segmentId":1,"trackPointId":1,"distanceDeltaMeters":0,"movingTimeDeltaSeconds":0}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106,"accuracy":5,"elapsedRealtimeNanos":11000000000}',
    '{"event":"decision","decisionId":2,"rawPointId":2,"result":"accept","reason":"moving_good_fix","segmentId":1,"trackPointId":2,"distanceDeltaMeters":111,"movingTimeDeltaSeconds":10}'
  ].join('\n'));

  const context = model.points[1].diagnosticContext;

  assert.equal(context.previousTrustedRawPointId, 1);
  assert.equal(context.deltaSecondsFromPreviousTrusted, 10);
  assert.ok(context.distanceFromPreviousTrustedMeters > 100);
  assert.ok(context.requiredSpeedMetersPerSecond > 10);
});

test('parseDiagnosticJsonl builds diagnostic evidence findings and point insights', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"v1"}',
    '{"event":"sampling_policy","state":"RECORDING_ACTIVE","locationRequestProvider":"gps","locationRequestMinTimeMs":1000,"locationRequestMinDistanceMeters":0,"eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":7,"receivedElapsedRealtimeNanos":1500000000,"visibleTotal":8,"usedInFixTotal":4,"usedAvgCn0":22.5,"allAvgCn0":21.0,"top4AvgCn0":23.0,"lowCn0VisibleCount":5,"weakUsedCount":3}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":5,"elapsedRealtimeNanos":2000000000,"sourceGnssSnapshotId":7,"gnssQualityStale":false,"sourceGnssSnapshotAgeNanos":500000000}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good","segmentId":1,"distanceDeltaMeters":0,"movingTimeDeltaSeconds":0,"sourceGnssSnapshotId":7}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.001,"lng":106,"accuracy":35,"elapsedRealtimeNanos":12000000000,"callbackReceivedElapsedRealtimeNanos":27000000000,"callbackDelayNanos":15000000000,"sourceGnssSnapshotId":7,"gnssQualityStale":true,"sourceGnssSnapshotAgeNanos":10500000000}',
    '{"event":"decision","decisionId":2,"rawPointId":2,"result":"weak","reason":"weak_signal_stage2","distanceDeltaMeters":0,"movingTimeDeltaSeconds":0,"sourceGnssSnapshotId":7}',
    '{"event":"session_event","eventType":"no_location_timeout","elapsedSinceLastLocationMillis":45000,"eventElapsedRealtimeNanos":45000000000}'
  ].join('\n'));

  assert.equal(model.summary.linkedGnssPointCount, 2);
  assert.equal(model.summary.staleRawCount, 1);
  assert.equal(model.evidence.metrics.weakGnssLinkedCount, 1);
  assert.equal(model.evidence.metrics.noLocationTimeoutCount, 1);
  assert.equal(model.evidence.metrics.samplingPolicyCount, 1);
  assert.ok(model.points[1].diagnosticContext.requiredSpeedMetersPerSecond > 10);
  assert.ok(model.points[1].insights.some((item) => item.text.includes('usedAvgCn0=22.5')));
  assert.ok(model.points[1].insights.some((item) => item.text.includes('不作为 callback age 硬拒绝')));
  assert.ok(model.evidence.findings.some((item) => item.title.includes('low C/N0') || item.title.includes('低 C/N0')));
  assert.ok(model.timelineItems.some((item) => item.type === 'event' && item.kind === 'session_event'));
});

test('explainDecisionReason returns Chinese reason guidance with fallback', () => {
  const weak = explainDecisionReason('weak', 'weak_signal_stage2');
  assert.equal(weak.title, '弱点云');
  assert.ok(weak.evidence.includes('cloudSampleCount'));

  const unknown = explainDecisionReason('reject', 'future_reason');
  assert.equal(unknown.title, 'future_reason');
  assert.ok(unknown.meaning.includes('还没有这个 decision reason'));
});

test('parseDiagnosticJsonl keeps malformed lines as parse errors', () => {
  const model = parseDiagnosticJsonl('{"event":"raw_location","rawPointId":1,"lat":1,"lng":2}\nnot json');

  assert.equal(model.summary.rawCount, 1);
  assert.equal(model.summary.parseErrorCount, 1);
  assert.equal(model.parseErrors[0].lineNumber, 2);
});

test('projectPoint maps bounds into svg coordinate space', () => {
  const pos = projectPoint(
    { lat: 10, lng: 20 },
    { minLat: 0, maxLat: 10, minLng: 10, maxLng: 20 },
    100,
    100,
    10
  );

  assert.equal(pos.x, 90);
  assert.equal(pos.y, 10);
});
