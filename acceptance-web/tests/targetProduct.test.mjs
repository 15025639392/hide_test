import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import { buildTargetTrackProduct } from '../src/targetProduct.mjs';

test('buildTargetTrackProduct rebuilds target track from pure evidence', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","locationRequestMinTimeMs":1000,"locationRequestMinDistanceMeters":0,"eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":32}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.strategyVersion, 'stage2-track-trust-v3-sampling-cloud');
  assert.equal(product.track.length, 2);
  assert.equal(product.track[0].result, 'anchor');
  assert.equal(product.track[0].reason, 'first_fix_good');
  assert.equal(product.track[1].result, 'accept');
  assert.equal(product.track[1].reason, 'moving_good_fix');
  assert.equal(product.stats.trustedPointCount, 2);
  assert.ok(product.stats.totalDistanceMeters > 10);
  assert.equal(product.stats.movingTimeSeconds, 3);
});

test('buildTargetTrackProduct builds from pure evidence without Android decisions', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":32}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 2);
  assert.equal(product.track[0].recomputedDecisionId, 1);
  assert.equal(product.track[1].recomputedDecisionId, 2);
});

test('buildTargetTrackProduct uses Android createdElapsedRealtimeNanos as record start', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":5000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000,"samplingEpochId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'before_record_start');
});

test('buildTargetTrackProduct recomputes intake instead of relying on Android intake events', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"network","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'provider_not_gps');
});

test('buildTargetTrackProduct keeps gap recovery in target track with zero delta', () => {
  const model = parseEvidenceJsonl([
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

test('buildTargetTrackProduct keeps transport-like recovery after a long gap as a new segment', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":15,"elapsedRealtimeNanos":130000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0103,"lng":120,"accuracy":15,"elapsedRealtimeNanos":132000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0106,"lng":120,"accuracy":15,"elapsedRealtimeNanos":134000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 3);
  assert.equal(product.track[1].reason, 'recovery_transport_suspected_kept');
  assert.equal(product.track[1].segmentId, 2);
  assert.equal(product.track[1].distanceDeltaMeters, 0);
  assert.equal(product.track[2].reason, 'transport_suspected_kept');
  assert.ok(product.track[2].distanceDeltaMeters > 30);
  assert.equal(product.stats.transportCount, 2);
});

test('buildTargetTrackProduct supports custom cleaning parameters', () => {
  const model = parseEvidenceJsonl([
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

test('buildTargetTrackProduct keeps isolated transport-like evidence as risk instead of deleting it', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":35,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"network","lat":30.0004,"lng":120,"accuracy":5,"elapsedRealtimeNanos":13000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'transport_suspected_kept');
  assert.equal(product.track[1].cloudType, 'TRANSPORT_RISK_CLOUD');
  assert.equal(product.track[1].coordinateSource, 'raw');
  assert.equal(product.track[1].virtualCoordinate, false);
  assert.equal(product.excluded.weak.length, 1);
  assert.equal(product.excluded.weak[0].reason, 'weak_signal_stage2');
  assert.equal(product.excluded.rejected.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'provider_not_gps');
  assert.equal(product.stats.transportCount, 1);
});

test('buildTargetTrackProduct keeps continuous transport-like evidence as risk instead of deleting it', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0005,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0015,"lng":120,"accuracy":5,"elapsedRealtimeNanos":41000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0030,"lng":120,"accuracy":5,"elapsedRealtimeNanos":71000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 4);
  assert.equal(product.track[1].reason, 'transport_suspected_kept');
  assert.equal(product.track[2].reason, 'transport_suspected_kept');
  assert.equal(product.track[3].reason, 'transport_suspected_kept');
  assert.ok(product.track.slice(1).every((point) => point.coordinateSource === 'raw'));
  assert.equal(product.excluded.rejected.length, 0);
  assert.equal(product.stats.transportCount, 3);
});

test('buildTargetTrackProduct keeps high-speed evidence when reported speed supports real movement', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29.60957711,"lng":106.50348649,"accuracy":16.776222,"speed":14.92,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.60941662,"lng":106.50348031,"accuracy":8.955809,"speed":14.83,"elapsedRealtimeNanos":2000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":29.60929297,"lng":106.50345473,"accuracy":7.651239,"speed":14.6,"elapsedRealtimeNanos":3000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":29.60916716,"lng":106.50344466,"accuracy":6.425503,"speed":14.38,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3, 4]);
  assert.equal(product.track[1].reason, 'transport_suspected_kept');
  assert.equal(product.track[2].reason, 'transport_suspected_kept');
  assert.equal(product.track[3].reason, 'transport_suspected_kept');
  assert.ok(product.track.slice(1).every((point) => point.virtualCoordinate === false));
  assert.equal(product.excluded.weak.length, 0);
  assert.equal(product.excluded.rejected.length, 0);
});

test('buildTargetTrackProduct collapses fully stationary sessions to one target point', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":11000000000,"endElapsedRealtimeNanos":12000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
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

test('buildTargetTrackProduct only lets barometer evidence block stationary collapse when enabled', () => {
  const stationaryEvents = [
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":11000000000,"endElapsedRealtimeNanos":12000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"barometer_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"avgRawAltitudeMeters":100,"minRawAltitudeMeters":99.8,"maxRawAltitudeMeters":100.2}',
    '{"event":"barometer_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"avgRawAltitudeMeters":101,"minRawAltitudeMeters":100.8,"maxRawAltitudeMeters":101.2}',
    '{"event":"barometer_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"avgRawAltitudeMeters":102,"minRawAltitudeMeters":101.8,"maxRawAltitudeMeters":102.2}',
    '{"event":"barometer_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"avgRawAltitudeMeters":103,"minRawAltitudeMeters":102.8,"maxRawAltitudeMeters":103.2}',
    '{"event":"barometer_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"avgRawAltitudeMeters":104,"minRawAltitudeMeters":103.8,"maxRawAltitudeMeters":104.2}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":9000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000014,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000,"sourceGnssSnapshotId":1}'
  ];
  const model = parseEvidenceJsonl(stationaryEvents.join('\n'));

  const defaultProduct = buildTargetTrackProduct(model);
  const barometerProduct = buildTargetTrackProduct(model, {
    config: { barometerCleaningEnabled: true }
  });

  assert.equal(defaultProduct.stationarySessionCollapsed, true);
  assert.equal(barometerProduct.stationarySessionCollapsed, undefined);
  assert.equal(barometerProduct.stationarySessionCollapseBlockedByBarometer, true);
  assert.ok(barometerProduct.track.length > 1);
  assert.ok(barometerProduct.findings.some((finding) => finding.includes('气压证据')));
});

test('buildTargetTrackProduct uses accelerometer dynamic RMS when linear acceleration is unavailable', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationSampleCount":0,"linearAccelerationRmsMps2":0,"accelerometerSampleCount":10,"accelerometerDynamicRmsMps2":0.5,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationSampleCount":0,"linearAccelerationRmsMps2":0,"accelerometerSampleCount":10,"accelerometerDynamicRmsMps2":0.5,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":2000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 1);
  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.excluded.rejected[0].reason, 'stationary_continuity_jitter');
  assert.notEqual(product.stationarySessionCollapsed, true);
});

test('buildTargetTrackProduct excludes stationary continuity rescue from target product track', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.5,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":0.5,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":2000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 1);
  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.excluded.rejected[0].reason, 'stationary_continuity_jitter');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 0);
});

test('buildTargetTrackProduct keeps one anchor for a stationary cluster', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"PAUSED","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.filter((point) => point.reason === 'stationary_anchor').length, 1);
  assert.equal(product.excluded.rejected.filter((point) =>
    point.reason === 'stationary_anchor_redundant').length, 1);
});

test('buildTargetTrackProduct keeps low-speed movement when motion evidence is active', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":5.5,"gyroscopeRmsRadps":2.0,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":5.5,"gyroscopeRmsRadps":2.0,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'motion_supported_low_speed');
  assert.equal(product.track[1].coordinateSource, 'raw');
  assert.equal(product.track[1].virtualCoordinate, false);
  assert.ok(product.track[1].distanceDeltaMeters > 2.5);
  assert.equal(product.excluded.rejected.length, 0);
});

test('buildTargetTrackProduct prunes low-speed tail before a stationary anchor', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":4000000000,"endElapsedRealtimeNanos":5000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":6000000000,"endElapsedRealtimeNanos":7000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":8000000000,"endElapsedRealtimeNanos":9000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000031,"lng":120,"accuracy":5,"elapsedRealtimeNanos":8000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000032,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.some((point) => point.reason === 'motion_supported_low_speed'), false);
  assert.equal(product.track.some((point) => point.reason === 'stationary_anchor'), true);
  assert.equal(product.excluded.rejected.some((point) =>
    point.reason === 'stationary_low_speed_tail'), true);
});

test('buildTargetTrackProduct limits low accuracy continuity rescue', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"gnss_snapshot","snapshotId":2,"usedInFixTotal":5,"top4AvgCn0":35}',
    '{"event":"gnss_snapshot","snapshotId":3,"usedInFixTotal":4,"top4AvgCn0":35}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00004,"lng":120,"accuracy":32,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":2}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00008,"lng":120,"accuracy":32,"elapsedRealtimeNanos":7000000000,"sourceGnssSnapshotId":3}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00012,"lng":120,"accuracy":42,"elapsedRealtimeNanos":10000000000,"sourceGnssSnapshotId":2}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2]);
  assert.equal(product.track[1].reason, 'continuity_rescue_low_accuracy');
  assert.deepEqual(product.excluded.weak.map((point) => point.rawPointId), [3, 4]);
});

test('buildTargetTrackProduct prunes low accuracy tail before a stationary anchor', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"gnss_snapshot","snapshotId":1,"usedInFixTotal":8,"top4AvgCn0":35}',
    '{"event":"gnss_snapshot","snapshotId":2,"usedInFixTotal":5,"top4AvgCn0":35}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":32,"elapsedRealtimeNanos":4000000000,"sourceGnssSnapshotId":2}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000031,"lng":120,"accuracy":5,"elapsedRealtimeNanos":6000000000,"sourceGnssSnapshotId":1}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000032,"lng":120,"accuracy":5,"elapsedRealtimeNanos":8000000000,"sourceGnssSnapshotId":1}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.some((point) => point.sourceRawPointId === 2), false);
  assert.equal(product.excluded.rejected.some((point) =>
    point.reason === 'stationary_low_accuracy_tail'), true);
});
