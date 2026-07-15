import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTargetOutput, parseEvidenceJsonl } from '../src/diagnosticMap.mjs';
import {
  appendEvidenceEvents,
  appendEvidenceJsonlChunk,
  createStreamingEvidenceIntakeState,
  evidenceIntakeJsonl,
  evidenceIntakeSummary,
  finishEvidenceIntake
} from '../src/track-cleaning/streamingEvidenceIntake.mjs';
import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';

test('streaming evidence intake parses split JSONL chunks only at complete lines', () => {
  const lines = neutralWalkLines();
  const text = lines.join('\n');
  const split = text.indexOf('"location_sample"') + 20;
  const first = appendEvidenceJsonlChunk(createStreamingEvidenceIntakeState(),
    text.slice(0, split));

  assert.ok(first.events.length < lines.length);
  assert.ok(first.pendingText.length > 0);

  const finished = appendEvidenceJsonlChunk(first, text.slice(split), { finish: true });
  assert.equal(finished.events.length, lines.length);
  assert.equal(finished.pendingText, '');
  assert.equal(finished.finished, true);
  assert.deepEqual(evidenceIntakeSummary(finished), {
    eventCount: lines.length,
    parseErrorCount: 0,
    pendingTextBytes: 0,
    duplicateEventCount: 0,
    outOfOrderEventCount: 0,
    finished: true,
    chunkCount: 2
  });
});

test('streaming evidence intake output can feed the target product', () => {
  const fullModel = parseEvidenceJsonl(neutralWalkLines().join('\n'));
  const fullProduct = buildSixLayerTrackProduct(fullModel, {
    config: { stationarySessionCollapseEnabled: false }
  });
  const state = finishEvidenceIntake(neutralWalkLines()
    .reduce((current, line) => appendEvidenceJsonlChunk(current, `${line}\n`),
      createStreamingEvidenceIntakeState()));
  const streamModel = parseEvidenceJsonl(evidenceIntakeJsonl(state));
  const streamProduct = buildSixLayerTrackProduct(streamModel, {
    config: { stationarySessionCollapseEnabled: false }
  });
  const streamOutput = buildTargetOutput(streamModel, streamProduct);

  assert.deepEqual(streamProduct.track.map((point) => point.sourceRawPointId),
    fullProduct.track.map((point) => point.sourceRawPointId));
  assert.equal(streamProduct.stats.totalDistanceMeters, fullProduct.stats.totalDistanceMeters);
  assert.equal(streamProduct.stats.movingTimeSeconds, fullProduct.stats.movingTimeSeconds);
  assert.equal(streamProduct.stats.barometerTotalAscentMeters, 12);
  assert.equal(streamProduct.stats.barometerTotalDescentMeters, 7);
  assert.equal(streamOutput.summaries.raw.unexplainedCount, 0);
});

test('streaming evidence intake deduplicates eventSeq and records order issues', () => {
  const state = appendEvidenceEvents(createStreamingEvidenceIntakeState(), [
    neutralEvent(1, 'session_metadata'),
    neutralEvent(3, 'location_sample', { sampleId: 1, lat: 30, lng: 120 }),
    neutralEvent(2, 'motion_window', {
      windowId: 1,
      startElapsedRealtimeNanos: 1,
      endElapsedRealtimeNanos: 2
    }),
    neutralEvent(3, 'location_sample', { sampleId: 1, lat: 30, lng: 120 })
  ]);

  assert.equal(state.events.length, 3);
  assert.equal(state.duplicateEventCount, 1);
  assert.equal(state.outOfOrderEventCount, 1);
});

test('finishEvidenceIntake parses a final line without a trailing newline', () => {
  const state = appendEvidenceJsonlChunk(createStreamingEvidenceIntakeState(),
    JSON.stringify(neutralEvent(1, 'session_metadata')));
  assert.equal(state.events.length, 0);
  assert.ok(state.pendingText.length > 0);

  const finished = finishEvidenceIntake(state);
  assert.equal(finished.events.length, 1);
  assert.equal(finished.pendingText, '');
  assert.equal(finished.finished, true);
});

function neutralWalkLines() {
  return [
    JSON.stringify(neutralEvent(1, 'session_metadata', {
      createdElapsedRealtimeNanos: 1_000_000_000
    })),
    JSON.stringify(neutralEvent(2, 'sampling_policy', {
      samplingEpochId: 1,
      state: 'MOVING_STANDARD',
      startedElapsedRealtimeNanos: 1_000_000_000,
      eventElapsedRealtimeNanos: 1_000_000_000
    })),
    JSON.stringify(neutralEvent(3, 'motion_window', {
      windowId: 1,
      startElapsedRealtimeNanos: 26_000_000_000,
      endElapsedRealtimeNanos: 31_000_000_000,
      accelerometerDynamicRmsMps2: 0.6,
      gyroscopeRmsRadps: 0.2,
      stepCounterDelta: 12
    })),
    JSON.stringify(neutralEvent(4, 'barometer_window', {
      windowId: 1,
      startElapsedRealtimeNanos: 1_000_000_000,
      endElapsedRealtimeNanos: 1_000_000_000,
      avgPressureHpa: 1000,
      avgBarometerAltitudeMeters: 100,
      windowAscentMeters: 0,
      windowDescentMeters: 0
    })),
    JSON.stringify(neutralEvent(5, 'barometer_window', {
      windowId: 2,
      startElapsedRealtimeNanos: 26_000_000_000,
      endElapsedRealtimeNanos: 31_000_000_000,
      avgPressureHpa: 999,
      avgBarometerAltitudeMeters: 112,
      windowAscentMeters: 12,
      windowDescentMeters: 0
    })),
    JSON.stringify(neutralEvent(6, 'barometer_window', {
      windowId: 3,
      startElapsedRealtimeNanos: 56_000_000_000,
      endElapsedRealtimeNanos: 61_000_000_000,
      avgPressureHpa: 999.5,
      avgBarometerAltitudeMeters: 105,
      windowAscentMeters: 0,
      windowDescentMeters: 7
    })),
    JSON.stringify(neutralLocationEvent(7, 1, 30, 120, 100, 1_000_000_000)),
    JSON.stringify(neutralLocationEvent(8, 2, 30.0001, 120, 110, 31_000_000_000)),
    JSON.stringify(neutralLocationEvent(9, 3, 30.0002, 120, 104, 61_000_000_000))
  ];
}

function neutralLocationEvent(eventSeq, sampleId, lat, lng, altitudeMeters,
  fixElapsedRealtimeNanos) {
  return neutralEvent(eventSeq, 'location_sample', {
    sampleId,
    provider: 'gnss',
    lat,
    lng,
    horizontalAccuracyMeters: 5,
    altitudeMeters,
    verticalAccuracyMeters: 4,
    speedMetersPerSecond: 1.2,
    wallTimeMillis: 1_760_000_000_000 + fixElapsedRealtimeNanos / 1_000_000,
    fixElapsedRealtimeNanos,
    receivedElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    callbackDelayNanos: 10_000_000,
    samplingEpochId: 1,
    isMock: false
  });
}

function neutralEvent(eventSeq, event, overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event,
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: eventSeq * 1_000_000_000,
    ...overrides
  };
}
