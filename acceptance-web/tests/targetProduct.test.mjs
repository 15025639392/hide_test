import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import { buildTargetTrackProduct } from '../src/targetProduct.mjs';

test('buildTargetTrackProduct rebuilds target track from pure evidence', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","locationRequestMinTimeMs":1000,"locationRequestMinDistanceMeters":0,"eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
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
  assert.equal(product.stats.routeDistanceMeters, product.stats.totalDistanceMeters);
  assert.equal(product.stats.movingTimeSeconds, 3);
  assert.equal(product.adaptiveShadow.assessment.level, 'same');
});

test('buildTargetTrackProduct exposes read-only session profile', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":20000000000,"endElapsedRealtimeNanos":21000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":23000000000,"endElapsedRealtimeNanos":24000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00002,"lng":120,"accuracy":10,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00007,"lng":120,"accuracy":30,"elapsedRealtimeNanos":8000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000071,"lng":120,"accuracy":50,"elapsedRealtimeNanos":20000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });
  const profile = product.sessionProfile;

  assert.equal(profile.version, 1);
  assert.equal(profile.raw.sampleCount, 4);
  assert.equal(profile.raw.validTimeSampleCount, 4);
  assert.equal(profile.sampleInterval.sampleCount, 3);
  assert.equal(profile.sampleInterval.p50Seconds, 5);
  assert.equal(profile.sampleInterval.longGapCount, 0);
  assert.equal(profile.accuracy.p50Meters, 20);
  assert.equal(profile.accuracy.p75Meters, 35);
  assert.equal(profile.accuracy.weakRatio, 0.25);
  assert.equal(profile.motion.windowCount, 4);
  assert.equal(profile.motion.activeRatio, 0.25);
  assert.ok(profile.movement.adjacentSpeedP50MetersPerSecond > 1);
  assert.ok(profile.stationary.radiusSampleCount >= 2);
  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 3]);
});

test('buildTargetTrackProduct exposes adaptive shadow without changing fixed track', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00006,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00060,"lng":120,"accuracy":5,"elapsedRealtimeNanos":65000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });
  const shadow = product.adaptiveShadow;

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 4]);
  assert.equal(product.track.at(-1).reason, 'moving_good_fix');
  assert.ok(Array.isArray(product.adaptiveShadows));
  assert.equal(product.adaptiveShadows[0], shadow);
  assert.equal(shadow.id, 'adaptive-balanced');
  assert.equal(shadow.mode, 'shadow_only');
  assert.equal(shadow.thresholds.fixed.gapSeconds, 120);
  assert.equal(shadow.thresholds.adaptive.gapSeconds, 30);
  assert.ok(shadow.track.length >= 2);
  assert.ok(shadow.track.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)));
  assert.equal(shadow.impact.fixed.trustedPointCount, product.stats.trustedPointCount);
  assert.ok(Number.isFinite(shadow.impact.fixed.routeDistanceMeters));
  assert.ok(Number.isFinite(shadow.impact.adaptive.routeDistanceMeters));
  assert.equal(
    shadow.impact.delta.trustedPointCount,
    shadow.impact.adaptive.trustedPointCount - shadow.impact.fixed.trustedPointCount
  );
  assert.equal(
    shadow.impact.delta.gapCount,
    shadow.impact.adaptive.gapCount - shadow.impact.fixed.gapCount
  );
  assert.equal(shadow.assessment.level, 'review');
  assert.ok(shadow.assessment.reasons.some((reason) => reason.code === 'gap_count_changed'));
  assert.ok(shadow.summary.changedCount >= 1);
  const raw4Difference = shadow.differences.find((difference) => difference.rawPointId === 4);
  assert.equal(raw4Difference.fixed.reason, 'moving_good_fix');
  assert.equal(raw4Difference.adaptive.reason, 'gap_recovery');
  const gapShadow = product.adaptiveShadows.find((candidate) =>
    candidate.id === 'adaptive-gap-sensitive');
  const stationaryShadow = product.adaptiveShadows.find((candidate) =>
    candidate.id === 'adaptive-stationary-noise');
  assert.equal(gapShadow.thresholds.adaptive.gapSeconds, 30);
  assert.equal(stationaryShadow.thresholds.adaptive.gapSeconds, 120);
});

test('buildTargetTrackProduct uses record end minus record start as moving time', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000,"recordEndElapsedRealtimeNanos":9000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":2000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.stats.movingTimeSeconds, 8);
  assert.equal(product.stats.recordStartElapsedRealtimeNanos, 1000000000);
  assert.equal(product.stats.recordEndElapsedRealtimeNanos, 9000000000);
});

test('buildTargetTrackProduct computes Location altitude fallback ascent from trusted raw altitude', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":103.5,"verticalAccuracy":4,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0002,"lng":120,"accuracy":5,"altitude":102,"verticalAccuracy":4,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0003,"lng":120,"accuracy":5,"altitude":106,"verticalAccuracy":4,"elapsedRealtimeNanos":10000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.stats.locationAltitudeAscentSampleCount, 4);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 7.5);
});

test('buildTargetTrackProduct computes barometer and Location altitude ascent separately', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"barometer_window","barometerWindowId":1,"endElapsedRealtimeNanos":1000000000,"avgPressureHpa":1000,"avgRawAltitudeMeters":100}',
    '{"event":"barometer_window","barometerWindowId":2,"endElapsedRealtimeNanos":31000000000,"avgPressureHpa":999,"avgRawAltitudeMeters":110}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":130,"verticalAccuracy":4,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.stats.barometerAscentSampleCount, 2);
  assert.equal(product.stats.barometerAscentRejectedSampleCount, 0);
  assert.equal(product.stats.barometerTotalAscentMeters, 3.5);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 30);
});

test('buildTargetTrackProduct keeps Location altitude path when barometer is unusable', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"barometer_window","barometerWindowId":1,"endElapsedRealtimeNanos":1000000000,"avgPressureHpa":0,"avgRawAltitudeMeters":100}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":104,"verticalAccuracy":4,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.stats.barometerTotalAscentMeters, -1);
  assert.equal(product.stats.barometerAscentSampleCount, 0);
  assert.equal(product.stats.barometerAscentRejectedSampleCount, 1);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 4);
});

test('buildTargetTrackProduct excludes poor vertical accuracy from Location altitude ascent', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"altitude":100,"verticalAccuracy":4,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"altitude":140,"verticalAccuracy":60,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0002,"lng":120,"accuracy":5,"altitude":104,"verticalAccuracy":4,"elapsedRealtimeNanos":7000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.stats.locationAltitudeAscentSampleCount, 2);
  assert.equal(product.stats.locationAltitudeAscentRejectedSampleCount, 1);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 4);
});

test('buildTargetTrackProduct builds from pure evidence without Android decisions', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","strategyVersion":"stage2-track-trust-v3-sampling-cloud","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
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

test('buildTargetTrackProduct accepts normalized non-Android position providers', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":2,"state":"PAUSED","eventElapsedRealtimeNanos":11000000000}',
    '{"event":"sampling_policy","samplingEpochId":3,"state":"MOVING","eventElapsedRealtimeNanos":20000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"watch_gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 1);
  assert.equal(product.track[0].reason, 'first_fix_good');
  assert.equal(product.excluded.intakeRejected.length, 0);
});

test('buildTargetTrackProduct rejects raw points without a normalized position source', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].reason, 'missing_position_source');
});

test('buildTargetTrackProduct keeps gap recovery in target track with zero delta', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":2,"state":"PAUSED","eventElapsedRealtimeNanos":11000000000}',
    '{"event":"sampling_policy","samplingEpochId":3,"state":"MOVING","eventElapsedRealtimeNanos":20000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":5,"elapsedRealtimeNanos":130000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'gap_recovery');
  assert.equal(product.track[1].segmentId, 2);
  assert.equal(product.track[1].distanceDeltaMeters, 0);
  assert.equal(product.track[1].movingTimeDeltaSeconds, 0);
  assert.equal(product.stats.routeDistanceMeters, 0);
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.gapCount, 1);
});

test('buildTargetTrackProduct keeps transport-like recovery after a long gap as a new segment', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.01,"lng":120,"accuracy":15,"elapsedRealtimeNanos":130000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0103,"lng":120,"accuracy":15,"elapsedRealtimeNanos":132000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0106,"lng":120,"accuracy":15,"elapsedRealtimeNanos":134000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

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
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
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
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":35,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"network","lat":30.0004,"lng":120,"accuracy":5,"elapsedRealtimeNanos":13000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 3);
  assert.equal(product.track[1].reason, 'transport_suspected_kept');
  assert.equal(product.track[1].cloudType, 'TRANSPORT_RISK_CLOUD');
  assert.equal(product.track[1].coordinateSource, 'raw');
  assert.equal(product.track[1].virtualCoordinate, false);
  assert.equal(product.track[2].sourceRawPointId, 4);
  assert.equal(product.track[2].reason, 'moving_good_fix');
  assert.equal(product.excluded.weak.length, 1);
  assert.equal(product.excluded.weak[0].reason, 'weak_signal_stage2');
  assert.equal(product.excluded.rejected.length, 0);
  assert.equal(product.excluded.intakeRejected.length, 0);
  assert.equal(product.stats.transportCount, 1);
});

test('buildTargetTrackProduct keeps continuous transport-like evidence as risk instead of deleting it', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.0005,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.0015,"lng":120,"accuracy":5,"elapsedRealtimeNanos":41000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.0030,"lng":120,"accuracy":5,"elapsedRealtimeNanos":71000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 4);
  assert.equal(product.track[1].reason, 'transport_suspected_kept');
  assert.equal(product.track[2].reason, 'transport_suspected_kept');
  assert.equal(product.track[3].reason, 'transport_suspected_kept');
  assert.ok(product.track.slice(1).every((point) => point.coordinateSource === 'raw'));
  assert.equal(product.excluded.rejected.length, 0);
  assert.equal(product.stats.suspectedDistanceMeters,
    product.track[1].distanceDeltaMeters + product.track[2].distanceDeltaMeters
    + product.track[3].distanceDeltaMeters);
  assert.equal(product.stats.transportCount, 3);
});

test('buildTargetTrackProduct keeps high-speed evidence when reported speed supports real movement', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29.60957711,"lng":106.50348649,"accuracy":16.776222,"speed":14.92,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":29.60941662,"lng":106.50348031,"accuracy":8.955809,"speed":14.83,"elapsedRealtimeNanos":2000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":29.60929297,"lng":106.50345473,"accuracy":7.651239,"speed":14.6,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":29.60916716,"lng":106.50344466,"accuracy":6.425503,"speed":14.38,"elapsedRealtimeNanos":4000000000}'
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

  assert.equal(product.stationarySessionCollapsed, true);
  assert.equal(product.track.length, 1);
  assert.equal(product.track[0].reason, 'stationary_session_anchor');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 10);
});

test('buildTargetTrackProduct only lets barometer evidence block stationary collapse when enabled', () => {
  const stationaryEvents = [
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
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
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":9000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000014,"lng":120,"accuracy":5,"elapsedRealtimeNanos":11000000000}'
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
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationSampleCount":0,"linearAccelerationRmsMps2":0,"accelerometerSampleCount":10,"accelerometerDynamicRmsMps2":0.5,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationSampleCount":0,"linearAccelerationRmsMps2":0,"accelerometerSampleCount":10,"accelerometerDynamicRmsMps2":0.5,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":2000000000}'
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
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.5,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":0.5,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":2000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 1);
  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.excluded.rejected[0].reason, 'stationary_continuity_jitter');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.movingTimeSeconds, 1);
});

test('buildTargetTrackProduct keeps one anchor for a stationary cluster', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"PAUSED","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":7000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.filter((point) => point.reason === 'stationary_anchor').length, 1);
  assert.equal(product.excluded.rejected.filter((point) =>
    point.reason === 'stationary_anchor_redundant').length, 1);
  assert.equal(product.stats.routeDistanceMeters, 0);
});

test('buildTargetTrackProduct collapses zero-distance stationary gap recoveries', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"PAUSED","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":130000000000,"endElapsedRealtimeNanos":131000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":132000000000,"endElapsedRealtimeNanos":133000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000011,"lng":120,"accuracy":5,"elapsedRealtimeNanos":5000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000012,"lng":120,"accuracy":5,"elapsedRealtimeNanos":130000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":132000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.stationarySessionCollapsed, true);
  assert.equal(product.track.length, 1);
  assert.equal(product.track[0].reason, 'stationary_session_anchor');
  assert.equal(product.stats.totalDistanceMeters, 0);
  assert.equal(product.stats.routeDistanceMeters, 0);
  assert.equal(product.stats.segmentCount, 1);
});

test('buildTargetTrackProduct keeps low-speed movement when motion evidence is active', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":5.5,"gyroscopeRmsRadps":2.0,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":5.5,"gyroscopeRmsRadps":2.0,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.equal(product.track.length, 2);
  assert.equal(product.track[1].reason, 'motion_supported_low_speed');
  assert.equal(product.track[1].coordinateSource, 'raw');
  assert.equal(product.track[1].virtualCoordinate, false);
  assert.ok(product.track[1].distanceDeltaMeters > 2.5);
  assert.equal(product.excluded.rejected.length, 0);
});

test('buildTargetTrackProduct can apply low-quality movement rebuild when explicitly enabled', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":10000000000,"endElapsedRealtimeNanos":11000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":15000000000,"endElapsedRealtimeNanos":16000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":20000000000,"endElapsedRealtimeNanos":21000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":25000000000,"endElapsedRealtimeNanos":26000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":30000000000,"endElapsedRealtimeNanos":31000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":35000000000,"endElapsedRealtimeNanos":36000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":40000000000,"endElapsedRealtimeNanos":41000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":45000000000,"endElapsedRealtimeNanos":46000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":50000000000,"endElapsedRealtimeNanos":51000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":55000000000,"endElapsedRealtimeNanos":56000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":60000000000,"endElapsedRealtimeNanos":61000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":65000000000,"endElapsedRealtimeNanos":66000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":70000000000,"endElapsedRealtimeNanos":71000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":75000000000,"endElapsedRealtimeNanos":76000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":80000000000,"endElapsedRealtimeNanos":81000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":85000000000,"endElapsedRealtimeNanos":86000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":90000000000,"endElapsedRealtimeNanos":91000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":95000000000,"endElapsedRealtimeNanos":96000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":100000000000,"endElapsedRealtimeNanos":101000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":105000000000,"endElapsedRealtimeNanos":106000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":110000000000,"endElapsedRealtimeNanos":111000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":8,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.000027,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":10000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000054,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":18000000000}',
    '{"event":"raw_location","rawPointId":15,"provider":"gps","lat":30.000054,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":18000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000081,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":26000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000108,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":34000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000135,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":42000000000}',
    '{"event":"raw_location","rawPointId":7,"provider":"gps","lat":30.000162,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":50000000000}',
    '{"event":"raw_location","rawPointId":8,"provider":"gps","lat":30.000189,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":58000000000}',
    '{"event":"raw_location","rawPointId":9,"provider":"gps","lat":30.000216,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":66000000000}',
    '{"event":"raw_location","rawPointId":10,"provider":"gps","lat":30.000243,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":74000000000}',
    '{"event":"raw_location","rawPointId":11,"provider":"gps","lat":30.00028,"lng":120,"accuracy":8,"speed":0.7,"elapsedRealtimeNanos":82000000000}',
    '{"event":"raw_location","rawPointId":12,"provider":"gps","lat":30.000281,"lng":120,"accuracy":18,"speed":0,"elapsedRealtimeNanos":100000000000}',
    '{"event":"raw_location","rawPointId":13,"provider":"gps","lat":30.000282,"lng":120,"accuracy":18,"speed":0,"elapsedRealtimeNanos":105000000000}',
    '{"event":"raw_location","rawPointId":14,"provider":"gps","lat":30.000283,"lng":120,"accuracy":18,"speed":0,"elapsedRealtimeNanos":110000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: {
      collapseStationarySession: false,
      lowQualityMotionRebuildEnabled: true
    }
  });

  assert.equal(product.lowQualityMotionRebuild.mode, 'track');
  assert.equal(product.lowQualityMotionRebuild.candidateCount, 1);
  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 11, 13]);
  assert.equal(product.track[1].reason, 'motion_supported_low_quality');
  assert.equal(product.track[1].cloudType, 'LOW_QUALITY_MOTION');
  assert.equal(product.track[1].coordinateSource, 'raw');
  assert.equal(product.track[2].reason, 'motion_supported_low_quality');
  assert.deepEqual(product.track[1].contributingRawPointIds, [2]);
  assert.deepEqual(product.track[2].contributingRawPointIds, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(product.excluded.intakeRejected.length, 1);
  assert.equal(product.excluded.intakeRejected[0].rawPointId, 15);
  assert.equal(product.excluded.intakeRejected[0].reason, 'duplicate_fix');
  assert.equal(product.track[2].segmentId, 1);
  assert.equal(product.track[3].segmentId, 1);
  assert.equal(product.track[1].segmentId, 1);
  assert.ok(product.stats.totalDistanceMeters > 25);
  assert.equal(product.stats.segmentCount, 1);
  assert.equal(product.stats.gapCount, 0);
});

test('buildTargetTrackProduct keeps low-quality movement rebuild as review-only by default', () => {
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
  for (let second = 5; second <= 85; second += 5) {
    events.push({
      event: 'device_motion_window',
      startElapsedRealtimeNanos: second * 1_000_000_000,
      endElapsedRealtimeNanos: (second + 1) * 1_000_000_000,
      linearAccelerationRmsMps2: 0.9,
      gyroscopeRmsRadps: 0.2,
      stepCounterDelta: 0,
      stepDetectorCount: 0
    });
  }
  for (let second = 90; second <= 110; second += 5) {
    events.push({
      event: 'device_motion_window',
      startElapsedRealtimeNanos: second * 1_000_000_000,
      endElapsedRealtimeNanos: (second + 1) * 1_000_000_000,
      linearAccelerationRmsMps2: 0.03,
      gyroscopeRmsRadps: 0.01,
      stepCounterDelta: 0,
      stepDetectorCount: 0
    });
  }
  events.push({
    event: 'raw_location',
    rawPointId: 1,
    provider: 'gps',
    lat: 30,
    lng: 120,
    accuracy: 8,
    elapsedRealtimeNanos: 1_000_000_000
  });
  for (let index = 2; index <= 11; index++) {
    events.push({
      event: 'raw_location',
      rawPointId: index,
      provider: 'gps',
      lat: 30 + (index - 1) * 0.000027,
      lng: 120,
      accuracy: index === 11 ? 8 : 25,
      speed: 0.7,
      elapsedRealtimeNanos: (10 + (index - 2) * 8) * 1_000_000_000
    });
  }
  for (let index = 12; index <= 14; index++) {
    events.push({
      event: 'raw_location',
      rawPointId: index,
      provider: 'gps',
      lat: 30.00028 + (index - 12) * 0.000001,
      lng: 120,
      accuracy: 18,
      speed: 0,
      elapsedRealtimeNanos: (100 + (index - 12) * 5) * 1_000_000_000
    });
  }
  const model = parseEvidenceJsonl(events.map((event) => JSON.stringify(event)).join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.lowQualityMotionRebuild.mode, 'review_only');
  assert.equal(product.lowQualityMotionRebuild.candidateCount, 1);
  assert.equal(product.lowQualityMotionRebuild.rawIntervalCandidateCount, 1);
  assert.ok(product.lowQualityMotionRebuild.candidates[0].decisionMix.lowQualityRatio >= 0.7);
  assert.equal(product.track.some((point) => point.reason === 'motion_supported_low_quality'), false);
  assert.ok(product.findings.some((finding) => finding.includes('低质量运动重建候选')));
});

test('buildTargetTrackProduct does not flag low-quality candidates for a single reject', () => {
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
  for (let second = 5; second <= 85; second += 5) {
    events.push({
      event: 'device_motion_window',
      startElapsedRealtimeNanos: second * 1_000_000_000,
      endElapsedRealtimeNanos: (second + 1) * 1_000_000_000,
      linearAccelerationRmsMps2: 0.9,
      gyroscopeRmsRadps: 0.2,
      stepCounterDelta: 0,
      stepDetectorCount: 0
    });
  }
  events.push({
    event: 'raw_location',
    rawPointId: 1,
    provider: 'gps',
    lat: 30,
    lng: 120,
    accuracy: 5,
    speed: 1,
    elapsedRealtimeNanos: 1_000_000_000
  });
  for (let index = 2; index <= 11; index++) {
    events.push({
      event: 'raw_location',
      rawPointId: index,
      provider: 'gps',
      lat: index === 6
        ? 30 + (index - 2) * 0.000072 + 0.000001
        : 30 + (index - 1) * 0.000072,
      lng: 120,
      accuracy: 5,
      speed: index === 6 ? 0.1 : 1,
      elapsedRealtimeNanos: (10 + (index - 2) * 8) * 1_000_000_000
    });
  }
  const model = parseEvidenceJsonl(events.map((event) => JSON.stringify(event)).join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.excluded.rejected.length, 1);
  assert.equal(product.lowQualityMotionRebuild.candidateCount, 0);
  assert.equal(product.lowQualityMotionRebuild.rawIntervalCandidateCount, 0);
});

test('buildTargetTrackProduct ignores broad low-quality intervals without enabled rebuild impact', () => {
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
  for (let second = 5; second <= 85; second += 5) {
    events.push({
      event: 'device_motion_window',
      startElapsedRealtimeNanos: second * 1_000_000_000,
      endElapsedRealtimeNanos: (second + 1) * 1_000_000_000,
      linearAccelerationRmsMps2: 0.9,
      gyroscopeRmsRadps: 0.2,
      stepCounterDelta: 0,
      stepDetectorCount: 0
    });
  }
  events.push({
    event: 'raw_location',
    rawPointId: 1,
    provider: 'gps',
    lat: 30,
    lng: 120,
    accuracy: 8,
    elapsedRealtimeNanos: 1_000_000_000
  });
  for (let index = 2; index <= 11; index++) {
    events.push({
      event: 'raw_location',
      rawPointId: index,
      provider: 'gps',
      lat: 30 + (index - 1) * 0.000027,
      lng: 120,
      accuracy: index === 11 ? 8 : 25,
      speed: 0.7,
      elapsedRealtimeNanos: (10 + (index - 2) * 8) * 1_000_000_000
    });
  }
  const model = parseEvidenceJsonl(events.map((event) => JSON.stringify(event)).join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.lowQualityMotionRebuild.candidateCount, 0);
  assert.equal(product.lowQualityMotionRebuild.rawIntervalCandidateCount, 0);
  assert.equal(product.track.some((point) => point.reason === 'motion_supported_low_quality'), false);
});

test('buildTargetTrackProduct does not rebuild low-quality movement across raw sampling gaps', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":10000000000,"endElapsedRealtimeNanos":11000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":15000000000,"endElapsedRealtimeNanos":16000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":20000000000,"endElapsedRealtimeNanos":21000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":25000000000,"endElapsedRealtimeNanos":26000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":30000000000,"endElapsedRealtimeNanos":31000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":160000000000,"endElapsedRealtimeNanos":161000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":165000000000,"endElapsedRealtimeNanos":166000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":170000000000,"endElapsedRealtimeNanos":171000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":175000000000,"endElapsedRealtimeNanos":176000000000,"linearAccelerationRmsMps2":0.9,"gyroscopeRmsRadps":0.2,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":8,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.000027,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":10000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000054,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":18000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000081,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":26000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.00020,"lng":120,"accuracy":8,"speed":0.7,"elapsedRealtimeNanos":160000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000227,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":168000000000}',
    '{"event":"raw_location","rawPointId":7,"provider":"gps","lat":30.000254,"lng":120,"accuracy":25,"speed":0.7,"elapsedRealtimeNanos":176000000000}',
    '{"event":"raw_location","rawPointId":8,"provider":"gps","lat":30.000255,"lng":120,"accuracy":18,"speed":0,"elapsedRealtimeNanos":190000000000}',
    '{"event":"raw_location","rawPointId":9,"provider":"gps","lat":30.000256,"lng":120,"accuracy":18,"speed":0,"elapsedRealtimeNanos":195000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.some((point) => point.reason === 'motion_supported_low_quality'), false);
});

test('buildTargetTrackProduct prunes low-speed tail before a stationary anchor', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":2000000000,"endElapsedRealtimeNanos":3000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":3000000000,"endElapsedRealtimeNanos":4000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":4000000000,"endElapsedRealtimeNanos":5000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":6000000000,"endElapsedRealtimeNanos":7000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":8000000000,"endElapsedRealtimeNanos":9000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":9000000000,"endElapsedRealtimeNanos":10000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"elapsedRealtimeNanos":3000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000031,"lng":120,"accuracy":5,"elapsedRealtimeNanos":8000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000032,"lng":120,"accuracy":5,"elapsedRealtimeNanos":10000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.some((point) => point.reason === 'motion_supported_low_speed'), false);
  assert.equal(product.track.some((point) => point.reason === 'stationary_anchor'), true);
  assert.equal(product.excluded.rejected.some((point) =>
    point.reason === 'stationary_low_speed_tail'), true);
});

test('buildTargetTrackProduct uses Location continuity for low accuracy rescue', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00004,"lng":120,"accuracy":32,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00008,"lng":120,"accuracy":32,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00012,"lng":120,"accuracy":42,"elapsedRealtimeNanos":10000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3]);
  assert.equal(product.track[1].reason, 'continuity_rescue_low_accuracy');
  assert.equal(product.track[2].reason, 'continuity_rescue_low_accuracy');
  assert.deepEqual(product.excluded.weak.map((point) => point.rawPointId), [4]);
  const directionHoldShadow = product.adaptiveShadows.find((shadow) =>
    shadow.id === 'adaptive-weak-signal-direction-hold');
  assert.equal(directionHoldShadow.thresholds.fixed.weakSignalDirectionHoldEnabled, false);
  assert.equal(directionHoldShadow.thresholds.adaptive.weakSignalDirectionHoldEnabled, true);
  assert.equal(directionHoldShadow.mode, 'diagnostic_only');
  assert.deepEqual(directionHoldShadow.track, []);
  assert.equal(directionHoldShadow.weakSignalDirectionHold.mode, 'diagnostic_only');
});

test('adaptive weak-signal direction hold keeps a navigation hint without rewriting noisy track', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00013,"lng":120,"accuracy":5,"elapsedRealtimeNanos":31000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00017,"lng":120.00030,"accuracy":32,"elapsedRealtimeNanos":61000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00021,"lng":119.99970,"accuracy":32,"elapsedRealtimeNanos":91000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.00025,"lng":120.00028,"accuracy":32,"elapsedRealtimeNanos":121000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.00033,"lng":120,"accuracy":5,"elapsedRealtimeNanos":151000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });
  const directionHoldShadow = product.adaptiveShadows.find((shadow) =>
    shadow.id === 'adaptive-weak-signal-direction-hold');
  const hint = directionHoldShadow.weakSignalDirectionHold.hints[0];

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3, 4, 5, 6]);
  assert.equal(product.track.some((point) => Math.abs(point.lng - 120) > 0.0002), true);
  assert.equal(directionHoldShadow.mode, 'diagnostic_only');
  assert.deepEqual(directionHoldShadow.track, []);
  assert.equal(directionHoldShadow.summary.changedCount, 0);
  assert.equal(directionHoldShadow.assessment.level, 'observe');
  assert.equal(directionHoldShadow.assessment.label, '方向提示');
  assert.equal(directionHoldShadow.weakSignalDirectionHold.hintCount, 1);
  assert.deepEqual(hint.rawPointIds, [3, 4, 5]);
  assert.equal(Math.abs(hint.startLng - 120) < 0.000001, true);
  assert.equal(Math.abs(hint.endLng - 120) < 0.000001, true);
  assert.equal(hint.confidence, 'high');
  assert.equal(hint.status, 'confirmed_by_exit');
});

test('buildTargetTrackProduct prunes low accuracy tail before a stationary anchor', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":5000000000,"endElapsedRealtimeNanos":6000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":32,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.000031,"lng":120,"accuracy":5,"elapsedRealtimeNanos":6000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.000032,"lng":120,"accuracy":5,"elapsedRealtimeNanos":8000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });

  assert.equal(product.track.some((point) => point.sourceRawPointId === 2), false);
  assert.deepEqual(product.track.map((point) => point.trackPointId), [1, 2]);
  assert.equal(product.excluded.rejected.some((point) =>
    point.reason === 'stationary_low_accuracy_tail'), true);
});

test('buildTargetTrackProduct preserves continuous low-speed tail and stationary exit movement', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
    '{"event":"sampling_policy","samplingEpochId":2,"state":"PAUSED","eventElapsedRealtimeNanos":11000000000}',
    '{"event":"sampling_policy","samplingEpochId":3,"state":"MOVING","eventElapsedRealtimeNanos":20000000000}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":4000000000,"endElapsedRealtimeNanos":5000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":7000000000,"endElapsedRealtimeNanos":8000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":10000000000,"endElapsedRealtimeNanos":11000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":12000000000,"endElapsedRealtimeNanos":13000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":14000000000,"endElapsedRealtimeNanos":15000000000,"linearAccelerationRmsMps2":0.03,"gyroscopeRmsRadps":0.01,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":20000000000,"endElapsedRealtimeNanos":21000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":22000000000,"endElapsedRealtimeNanos":23000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"device_motion_window","startElapsedRealtimeNanos":24000000000,"endElapsedRealtimeNanos":25000000000,"linearAccelerationRmsMps2":4,"gyroscopeRmsRadps":1,"stepCounterDelta":0,"stepDetectorCount":0}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"timeMillis":1000,"elapsedRealtimeNanos":1000000000}',
    '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"timeMillis":4000,"elapsedRealtimeNanos":4000000000}',
    '{"event":"raw_location","rawPointId":3,"provider":"gps","lat":30.00006,"lng":120,"accuracy":5,"timeMillis":7000,"elapsedRealtimeNanos":7000000000}',
    '{"event":"raw_location","rawPointId":4,"provider":"gps","lat":30.00009,"lng":120,"accuracy":5,"timeMillis":10000,"elapsedRealtimeNanos":10000000000}',
    '{"event":"raw_location","rawPointId":5,"provider":"gps","lat":30.000091,"lng":120,"accuracy":5,"timeMillis":12000,"elapsedRealtimeNanos":12000000000}',
    '{"event":"raw_location","rawPointId":6,"provider":"gps","lat":30.000092,"lng":120,"accuracy":5,"timeMillis":13000,"elapsedRealtimeNanos":13000000000}',
    '{"event":"raw_location","rawPointId":7,"provider":"gps","lat":30.000093,"lng":120,"accuracy":5,"timeMillis":14000,"elapsedRealtimeNanos":14000000000}',
    '{"event":"raw_location","rawPointId":8,"provider":"gps","lat":30.00003,"lng":120,"accuracy":5,"timeMillis":20000,"elapsedRealtimeNanos":20000000000}',
    '{"event":"raw_location","rawPointId":9,"provider":"gps","lat":30.00006,"lng":120,"accuracy":5,"timeMillis":22000,"elapsedRealtimeNanos":22000000000}',
    '{"event":"raw_location","rawPointId":10,"provider":"gps","lat":30.00009,"lng":120,"accuracy":5,"timeMillis":24000,"elapsedRealtimeNanos":24000000000}',
    '{"event":"raw_location","rawPointId":11,"provider":"gps","lat":30.00013,"lng":120,"accuracy":5,"timeMillis":26000,"elapsedRealtimeNanos":26000000000}'
  ].join('\n'));

  const product = buildTargetTrackProduct(model, {
    config: { collapseStationarySession: false }
  });
  const trackByRawPointId = new Map(product.track.map((point) =>
    [point.sourceRawPointId, point]));
  const rejectedRawPointIds = new Set(product.excluded.rejected.map((point) =>
    point.rawPointId));

  for (const rawPointId of [2, 3, 4, 8, 9, 10]) {
    assert.equal(trackByRawPointId.get(rawPointId)?.reason, 'motion_supported_low_speed');
    assert.equal(rejectedRawPointIds.has(rawPointId), false);
  }
  assert.equal(trackByRawPointId.get(7)?.reason, 'stationary_anchor');
  assert.equal(trackByRawPointId.get(11)?.reason, 'motion_supported_low_speed');
  assert.deepEqual([8, 9, 10].map((rawPointId) =>
    trackByRawPointId.get(rawPointId)?.timeMillis), [20000, 22000, 24000]);
});
