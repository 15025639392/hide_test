import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';
import {
  advanceStreamingBaseTrackKernel,
  createStreamingBaseTrackKernelState
} from '../src/track-cleaning/streamingBaseTrackKernel.mjs';

const CONFIG = { stationarySessionCollapseEnabled: false };

// 正确性回归 #4：对一段 still 稳定驻留，流式 base kernel 必须与批处理一致地
// 产出可信 stationary_anchor，而不是把整段驻留全判 stationary_cloud_jitter 丢弃
// （否则误删本应可信的驻留锚点，可信轨迹/GPX 少点、里程锚点错位）。
test('streaming base kernel keeps a stationary_anchor for a stable still dwell, matching the full product', () => {
  const cos = Math.cos(30 * Math.PI / 180);
  const lat = (northMeters) => 30 + northMeters / 111_111;
  const lng = (eastMeters) => 120 + eastMeters / (111_111 * cos);
  const events = [sessionMetadata(), samplingPolicy()];
  for (let t = 4; t <= 30; t += 2) {
    events.push(motionWindow(100 + t, (t - 1) * 1_000_000_000, t * 1_000_000_000, {
      linearAccelerationRmsMps2: 0.03,
      gyroscopeRmsRadps: 0.01,
      stepDetectorCount: 0
    }));
  }
  events.push(locationSample(1, lat(0), lng(0), 5, 1_000_000_000));
  for (let i = 0; i < 12; i++) {
    events.push(locationSample(2 + i, lat(i % 2 === 0 ? 0 : 2), lng(i % 3 === 0 ? 0 : 1.5), 5,
      (6 + i * 2) * 1_000_000_000, { speedMetersPerSecond: 0 }));
  }
  events.push(locationSample(14, lat(111), lng(0), 5, 40_000_000_000));

  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const streamed = advanceStreamingBaseTrackKernel(
    createStreamingBaseTrackKernelState({ config: CONFIG }), events);

  // 本测试文件的核心契约：流式 base kernel 必须逐点匹配批处理 full product。
  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  // 且必须保留一个可信驻留锚点。
  assert.ok(streamed.track.some((point) => point.reason === 'stationary_anchor'),
    'stable still dwell must yield a trusted stationary_anchor');
});

test('streaming base kernel matches full product for normal movement batches', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    locationSample(2, 30.0001, 120, 5, 31_000_000_000),
    locationSample(3, 30.0002, 120, 5, 61_000_000_000)
  ];
  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const first = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events.slice(0, 3));
  const streamed = advanceStreamingBaseTrackKernel(first, events.slice(3));

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
});

test('streaming base kernel preserves GNSS altitude evidence on trusted track points', () => {
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000, {
      altitudeMeters: 100,
      verticalAccuracyMeters: 4
    }),
    locationSample(2, 30.0001, 120, 5, 31_000_000_000, {
      altitudeMeters: 108,
      verticalAccuracyMeters: 5
    })
  ]);

  assert.deepEqual(streamed.track.map((point) => ({
    sourceRawPointId: point.sourceRawPointId,
    altitude: point.altitude,
    verticalAccuracy: point.verticalAccuracy
  })), [
    { sourceRawPointId: 1, altitude: 100, verticalAccuracy: 4 },
    { sourceRawPointId: 2, altitude: 108, verticalAccuracy: 5 }
  ]);
});

test('streaming base kernel preserves GAP recovery boundary semantics', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    locationSample(2, 30.001, 120, 5, 130_000_000_000, {
      speedMetersPerSecond: 1
    })
  ];
  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const first = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events.slice(0, 3));
  const streamed = advanceStreamingBaseTrackKernel(first, events.slice(3));

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.equal(streamed.track[1].reason, 'gap_recovery');
  assert.equal(streamed.track[1].distanceDeltaMeters, 0);
  assert.equal(streamed.track[1].movingTimeDeltaSeconds, 0);
  assert.equal(streamed.stats.gapCount, 1);
});

test('streaming base kernel keeps high-accuracy-error points as weak raw decisions', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    locationSample(2, 30.0001, 120, 100, 31_000_000_000)
  ];
  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events);

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.equal(streamed.excluded.intakeRejected.length, 0);
  assert.equal(streamed.excluded.weak.length, 1);
  assert.equal(streamed.excluded.weak[0].reason, 'weak_horizontal_accuracy');
});

test('streaming base kernel uses neutral motion windows for low speed movement', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    motionWindow(30, 14_000_000_000, 15_000_000_000, {
      accelerometerDynamicRmsMps2: 0.8,
      gyroscopeRmsRadps: 0.16,
      stepCounterDelta: 4
    }),
    locationSample(2, 30.00003, 120, 5, 15_000_000_000, {
      speedMetersPerSecond: 0.25
    })
  ];
  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const first = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events.slice(0, 4));
  const streamed = advanceStreamingBaseTrackKernel(first, events.slice(4));

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.equal(streamed.track[1].reason, 'motion_supported_low_speed');
  assert.equal(streamed.track[1].activityState, 'walking');
  assert.ok(streamed.track[1].countsDistance);
});

test('streaming base kernel preserves unconfirmed implied transport weak points', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000, {
      speedMetersPerSecond: 1
    }),
    locationSample(2, 30.0002, 120, 5, 2_000_000_000, {
      speedMetersPerSecond: 1.2
    })
  ];
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events);

  assert.deepEqual(streamed.track.map((point) => point.sourceRawPointId), [1]);
  assert.equal(streamed.excluded.weak[0].reason,
    'implied_speed_unconfirmed_by_reported_speed');
  assert.equal(streamed.rawPointDecisions.find((decision) =>
    decision.rawPointId === 2).horizontalReason,
    'implied_speed_unconfirmed_by_reported_speed');
});

test('streaming base kernel preserves recovery transport continuity', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    locationSample(2, 30.01, 120, 50, 130_000_000_000, {
      speedMetersPerSecond: 20
    }),
    locationSample(3, 30.0104, 120, 34, 132_000_000_000, {
      speedMetersPerSecond: 20
    }),
    locationSample(4, 30.0106, 120, 36, 133_000_000_000, {
      speedMetersPerSecond: 20
    })
  ];
  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events);

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.deepEqual(streamed.track.map((point) => point.sourceRawPointId), [1, 3, 4]);
  assert.deepEqual(streamed.track.map((point) => point.reason), [
    'first_fix_good',
    'recovery_transport_suspected_kept',
    'transport_suspected_kept'
  ]);
  assert.deepEqual(streamed.track.map((point) => point.entersTrustedGpx), [
    true,
    true,
    true
  ]);
  assert.equal(streamed.excluded.weak[0].reason, 'gap_recovery_pending');
  // 里程口径变更（2026-08-01）：kept 的 transport 点计入总里程/移动时长
  // （recovery 锚点 delta=0 不贡献，raw 4 的 ~22.24m/1s 计入）。
  assert.ok(streamed.stats.totalDistanceMeters > 20);
  assert.equal(streamed.stats.movingTimeSeconds, 1);
  assert.equal(streamed.stats.transportCount, 2);
  assert.equal(streamed.stats.suspectedTransportPointCount, 2);
  assert.equal(streamed.stats.suspectedTransportSegmentCount, 1);
  assert.ok(streamed.stats.suspectedTransportDistanceMeters > 20);
  assert.equal(streamed.stats.suspectedTransportDurationSeconds, 1);
  assert.ok(streamed.stats.suspectedTransportAverageSpeedMetersPerSecond > 20);
});

test('streaming base kernel rejects out-of-order fix without moving the cursor backward', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 10_000_000_000),
    locationSample(2, 30.0001, 120, 5, 9_000_000_000)
  ];
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events);

  assert.deepEqual(streamed.track.map((point) => point.sourceRawPointId), [1]);
  assert.equal(streamed.excluded.intakeRejected[0].reason, 'out_of_order_fix');
  assert.equal(streamed.lastLegalElapsedRealtimeNanos, 10_000_000_000);
});

// PAUSED 采样策略下，一段"距离够远但速度合理"的跳变，在普通 MOVING 策略里会被判
// moving_good_fix 累计假里程；对齐端上 TrackTrustEngine 的 paused 分支后，必须改判
// gap_recovery（距离/时长不累计、强制新开 segment），且流式与批处理逐点一致。
test('streaming base kernel treats a PAUSED-epoch far jump as gap recovery, matching the full product', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    pausedPolicy(2, 20_000_000_000),
    locationSample(2, 30.0003, 120, 5, 31_000_000_000, {
      samplingEpochId: 2,
      speedMetersPerSecond: 1.1
    })
  ];

  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const first = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events.slice(0, 3));
  const streamed = advanceStreamingBaseTrackKernel(first, events.slice(3));

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.equal(streamed.track[1].reason, 'gap_recovery');
  assert.equal(streamed.track[1].distanceDeltaMeters, 0);
  assert.equal(streamed.track[1].movingTimeDeltaSeconds, 0);
  assert.ok(streamed.track[1].startsNewSegment);
  assert.equal(streamed.track[1].segmentId, 2);
  assert.equal(streamed.stats.totalDistanceMeters, 0);
});

// PAUSED 采样策略下的近距离抖动，与普通静止一样落 stationary，不累计里程。
test('streaming base kernel keeps a PAUSED-epoch near jitter stationary, matching the full product', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    pausedPolicy(2, 20_000_000_000),
    locationSample(2, 30.00002, 120, 5, 31_000_000_000, {
      samplingEpochId: 2,
      speedMetersPerSecond: 0
    })
  ];

  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const streamed = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events);

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  assert.equal(streamed.stats.totalDistanceMeters, 0);
  assert.ok(streamed.track.every((point) => point.reason !== 'moving_good_fix'));
});

// 用户主动暂停：user_pause 与 user_resume 之间的 raw 点必须整段排除（reason user_paused、
// 不入指标/不入可信轨迹），恢复后首个可信点强制断段、跨暂停不累计距离/时长，且流式与批处理
// 逐点一致。
test('streaming base kernel excludes a user-paused span and breaks the segment on resume, matching the full product', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    userPause(15_000_000_000),
    locationSample(2, 30.00001, 120, 5, 16_000_000_000),
    locationSample(3, 30.00002, 120, 5, 20_000_000_000),
    userResume(28_000_000_000),
    locationSample(4, 30.0003, 120, 5, 31_000_000_000, {
      speedMetersPerSecond: 1.1
    })
  ];

  const full = buildSixLayerTrackProduct(events, { config: CONFIG });
  const first = advanceStreamingBaseTrackKernel(createStreamingBaseTrackKernelState({
    config: CONFIG
  }), events.slice(0, 3));
  const streamed = advanceStreamingBaseTrackKernel(first, events.slice(3));

  assert.deepEqual(baseProjection(streamed), baseProjection(full));
  // 暂停段两点被整段排除，不进可信轨迹。
  assert.deepEqual(streamed.track.map((point) => point.sourceRawPointId), [1, 4]);
  const paused = streamed.excluded.intakeRejected.filter((point) => point.reason === 'user_paused');
  assert.equal(paused.length, 2);
  assert.deepEqual(paused.map((point) => point.rawPointId), [2, 3]);
  assert.ok(paused.every((point) => point.pauseEpisodeId === 1));
  // 恢复点强制断段、清零跨暂停里程。
  assert.equal(streamed.track[1].startsNewSegment, true);
  assert.equal(streamed.track[1].segmentId, 2);
  assert.equal(streamed.track[1].distanceDeltaMeters, 0);
  assert.equal(streamed.track[1].movingTimeDeltaSeconds, 0);
  assert.equal(streamed.stats.totalDistanceMeters, 0);
  assert.equal(streamed.stats.movingTimeSeconds, 0);
});

function userPause(eventElapsedRealtimeNanos) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'user_pause',
    sessionId: 'S1',
    eventElapsedRealtimeNanos
  };
}

function userResume(eventElapsedRealtimeNanos) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'user_resume',
    sessionId: 'S1',
    eventElapsedRealtimeNanos
  };
}

function pausedPolicy(samplingEpochId, startedElapsedRealtimeNanos) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'sampling_policy',
    sessionId: 'S1',
    eventSeq: 2 + samplingEpochId,
    eventWallTimeMillis: 1_760_000_000_000 + startedElapsedRealtimeNanos / 1_000_000,
    eventElapsedRealtimeNanos: startedElapsedRealtimeNanos,
    samplingEpochId,
    state: 'PAUSED',
    startedElapsedRealtimeNanos
  };
}

function baseProjection(productOrState) {
  return {
    track: productOrState.track.map((point) => ({
      sourceRawPointId: point.sourceRawPointId,
      result: point.result,
      reason: point.reason,
      segmentId: point.segmentId,
      distanceDeltaMeters: rounded(point.distanceDeltaMeters),
      movingTimeDeltaSeconds: rounded(point.movingTimeDeltaSeconds),
      countsDistance: point.countsDistance,
      countsMovingTime: point.countsMovingTime,
      entersTrustedGpx: point.entersTrustedGpx
    })),
    rawPointDecisions: productOrState.rawPointDecisions.map((decision) => ({
      rawPointId: decision.rawPointId,
      intakeResult: decision.intakeResult,
      intakeReason: decision.intakeReason,
      horizontalResult: decision.horizontalResult,
      horizontalReason: decision.horizontalReason,
      countsDistance: decision.countsDistance,
      countsMovingTime: decision.countsMovingTime,
      entersTrustedGpx: decision.entersTrustedGpx
    })),
    stats: {
      rawPointCount: productOrState.stats.rawPointCount,
      trustedPointCount: productOrState.stats.trustedPointCount,
      weakPointCount: productOrState.stats.weakPointCount,
      rejectedPointCount: productOrState.stats.rejectedPointCount,
      intakeRejectedPointCount: productOrState.stats.intakeRejectedPointCount,
      segmentCount: productOrState.stats.segmentCount,
      gapCount: productOrState.stats.gapCount,
      transportCount: productOrState.stats.transportCount,
      suspectedTransportPointCount:
        productOrState.stats.suspectedTransportPointCount,
      suspectedTransportSegmentCount:
        productOrState.stats.suspectedTransportSegmentCount,
      suspectedTransportDistanceMeters:
        rounded(productOrState.stats.suspectedTransportDistanceMeters),
      suspectedTransportDurationSeconds:
        rounded(productOrState.stats.suspectedTransportDurationSeconds),
      suspectedTransportAverageSpeedMetersPerSecond:
        rounded(productOrState.stats.suspectedTransportAverageSpeedMetersPerSecond),
      totalDistanceMeters: rounded(productOrState.stats.totalDistanceMeters),
      movingTimeSeconds: rounded(productOrState.stats.movingTimeSeconds)
    }
  };
}

function sessionMetadata() {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'session_metadata',
    sessionId: 'S1',
    eventSeq: 1,
    eventWallTimeMillis: 1_760_000_000_001,
    eventElapsedRealtimeNanos: 1_000_000_000,
    createdElapsedRealtimeNanos: 1_000_000_000
  };
}

function samplingPolicy() {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'sampling_policy',
    sessionId: 'S1',
    eventSeq: 2,
    eventWallTimeMillis: 1_760_000_000_002,
    eventElapsedRealtimeNanos: 1_000_000_000,
    samplingEpochId: 1,
    state: 'MOVING_STANDARD',
    startedElapsedRealtimeNanos: 1_000_000_000
  };
}

function locationSample(sampleId, lat, lng, horizontalAccuracyMeters, fixElapsedRealtimeNanos,
  overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'location_sample',
    sessionId: 'S1',
    eventSeq: 10 + sampleId,
    eventWallTimeMillis: 1_760_000_000_000 + sampleId,
    eventElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    sampleId,
    provider: 'gnss',
    lat,
    lng,
    horizontalAccuracyMeters,
    speedMetersPerSecond: 1.2,
    wallTimeMillis: 1_760_000_000_000 + fixElapsedRealtimeNanos / 1_000_000,
    fixElapsedRealtimeNanos,
    receivedElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    callbackDelayNanos: 10_000_000,
    samplingEpochId: 1,
    isMock: false,
    ...overrides
  };
}

function motionWindow(eventSeq, startElapsedRealtimeNanos, endElapsedRealtimeNanos,
  overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event: 'motion_window',
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: endElapsedRealtimeNanos,
    windowId: eventSeq,
    startElapsedRealtimeNanos,
    endElapsedRealtimeNanos,
    ...overrides
  };
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}
