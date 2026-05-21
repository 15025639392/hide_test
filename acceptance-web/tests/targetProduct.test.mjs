import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDiagnosticJsonl } from '../src/diagnosticMap.mjs';
import { buildTargetTrackProduct } from '../src/targetProduct.mjs';

test('buildTargetTrackProduct rebuilds target track from diagnostic raw evidence', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","locationRequestMinTimeMs":1000,"locationRequestMinDistanceMeters":0,"eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":32}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"decision","decisionId":1,"rawPointId":1,"result":"anchor","reason":"first_fix_good"}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}',
    '{"event":"decision","decisionId":2,"rawPointId":2,"result":"accept","reason":"moving_good_fix"}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.strategyVersion, 'stage2-track-trust-v3-sampling-cloud');
  assert.equal(product.track.length, 2);
  assert.equal(product.track[0].result, 'anchor');
  assert.equal(product.track[0].reason, 'first_fix_good');
  assert.equal(product.track[1].result, 'accept');
  assert.equal(product.track[1].reason, 'moving_good_fix');
  assert.equal(product.stats.trustedPointCount, 2);
  assert.ok(product.stats.totalDistanceMeters > 10);
  assert.equal(product.stats.movingTimeSeconds, 3);
  assert.equal(product.alignment.matchedDecisionCount, 2);
});

test('buildTargetTrackProduct does not require Android recorded decisions', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":32}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[0].recomputedDecisionId, 1);
  assert.equal(product.track[1].recomputedDecisionId, 2);
  assert.equal(product.alignment.comparedDecisionCount, 0);
});

test('buildTargetTrackProduct recomputes intake instead of relying on Android intake events', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"network","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'provider_not_gps');
});

test('buildTargetTrackProduct keeps gap recovery in target track with zero delta', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":5,"elapsedRealtimeNanos":130000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'gap_recovery');
  assert.equal(product.track[1].segmentId, 2);
  assert.equal(product.track[1].distanceDeltaMeters, 0);
  assert.equal(product.track[1].movingTimeDeltaSeconds, 0);
  assert.equal(product.stats.gapCount, 1);
});

test('buildTargetTrackProduct supports custom cleaning parameters', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const defaultProduct = buildTargetTrackProduct(model);
  const customProduct = buildTargetTrackProduct(model, { config: { gapSeconds: 2 } });

  assert.equal(defaultProduct.track[1].reason, 'moving_good_fix');
  assert.equal(customProduct.track[1].reason, 'gap_recovery');
  assert.equal(customProduct.usesDefaultConfig, false);
});

test('buildTargetTrackProduct excludes weak, transport and intake rejected evidence', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":35,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"network","lat":30.0004,"lng":120,"accuracy":5,"elapsedRealtimeNanos":13000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 1);
  assert.equal(product.excluded.weak.length, 1);
  assert.equal(product.excluded.weak[0].reason, 'weak_signal_stage2');
  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.excluded.rejected[0].reason, 'transport_suspected');
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'provider_not_gps');
  assert.equal(product.stats.transportCount, 1);
});

test('buildTargetTrackProduct collapses fully stationary sessions to one target point', () => {
  const model = parseDiagnosticJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":1000000000,"lastElapsedRealtimeNanos":2000000000,"isDeviceStill":true}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":3000000000,"lastElapsedRealtimeNanos":4000000000,"isDeviceStill":true}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":5000000000,"lastElapsedRealtimeNanos":6000000000,"isDeviceStill":true}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":7000000000,"lastElapsedRealtimeNanos":8000000000,"isDeviceStill":true}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":9000000000,"lastElapsedRealtimeNanos":10000000000,"isDeviceStill":true}',
    '{"event":"motion_summary","firstElapsedRealtimeNanos":11000000000,"lastElapsedRealtimeNanos":12000000000,"isDeviceStill":true}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":9000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000014,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.stationarySessionCollapsed, true);
  assert.equal(product.track.length, 1);
  assert.equal(product.track[0].reason, 'stationary_session_anchor');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
});
