import test from 'node:test';
import assert from 'node:assert/strict';

// 跨 L3 裁剪守恒回归（对照 track_cleaning C++ base_kernel_prune_carry_test）：
// 逐点推进 + 每步最激进游标裁剪 vs 单发不裁剪基准，疑似交通六字段与三个排除计数
// 必须守恒。修复前（无 carried* 沉淀）游标越过交通段后统计塌缩归零，本测试转红。
// L3_RETENTION 必须在模块加载前压小，否则短语料触发不了裁剪 —— 故用动态 import。
process.env.L3_RETENTION = '4';
const {
  advanceStreamingBaseTrackKernel,
  createStreamingBaseTrackKernelState,
  pruneStreamingBaseTrackKernelForSettlement
} = await import('../src/track-cleaning/streamingBaseTrackKernel.mjs');

const CONFIG = { stationarySessionCollapseEnabled: false };

test('suspected transport stats survive aggressive L3 pruning (carried sedimentation)', () => {
  const events = [
    sessionMetadata(),
    samplingPolicy(),
    locationSample(1, 30, 120, 5, 1_000_000_000),
    locationSample(2, 30.01, 120, 50, 130_000_000_000, { speedMetersPerSecond: 20 }),
    locationSample(3, 30.0104, 120, 34, 132_000_000_000, { speedMetersPerSecond: 20 }),
    locationSample(4, 30.0106, 120, 36, 133_000_000_000, { speedMetersPerSecond: 20 })
  ];
  // 交通段后接常规步行点，把游标推离交通段，触发 retention=4 的就地删除。
  for (let i = 5; i <= 20; i++) {
    events.push(locationSample(i, 30.0106 + (i - 4) * 0.0001, 120, 5,
      (133 + (i - 4) * 30) * 1_000_000_000));
  }

  const baseline = advanceStreamingBaseTrackKernel(
    createStreamingBaseTrackKernelState({ config: CONFIG }), events);

  let stepped = createStreamingBaseTrackKernelState({ config: CONFIG });
  for (const event of events) {
    stepped = advanceStreamingBaseTrackKernel(stepped, [event]);
    stepped = pruneStreamingBaseTrackKernelForSettlement(stepped, {
      committedCursorRawPointId: stepped.lastProcessedRawPointId
    });
  }
  stepped = advanceStreamingBaseTrackKernel(stepped, []);

  // 非空前提：基准里确有交通统计，且裁剪确实删掉了交通段条目（否则本测试空转）。
  assert.equal(baseline.stats.transportCount, 2);
  assert.ok(stepped.track.length < baseline.track.length,
    'aggressive pruning must actually drop committed entries');

  for (const field of [
    'transportCount',
    'suspectedTransportPointCount',
    'suspectedDistanceMeters',
    'suspectedTransportDistanceMeters',
    'suspectedTransportDurationSeconds',
    'suspectedTransportSegmentCount',
    'suspectedTransportAverageSpeedMetersPerSecond',
    'weakPointCount',
    'rejectedPointCount',
    'intakeRejectedPointCount'
  ]) {
    assert.deepEqual(stepped.stats[field], baseline.stats[field],
      `stats.${field} must be conserved across L3 pruning`);
  }
});

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
