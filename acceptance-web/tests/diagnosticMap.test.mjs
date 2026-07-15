import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetOutput,
  explainDecisionReason,
  isEvidenceCandidatePath,
  parseEvidenceJsonl,
  projectPoint,
  rawDecisionDisplayState
} from '../src/diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from '../src/track-cleaning/sixLayerTrackProduct.mjs';

test('evidence path detection accepts exported evidence jsonl', () => {
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/evidence.jsonl.json'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/location_evidence_session-1.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/gnss_evidence_5ccf3a9f-1d85-4c2b-8b24-61839d459845.jsonl'), true);
  assert.equal(isEvidenceCandidatePath('/tmp/diagnostic.jsonl'), false);
});

test('raw decision display uses final scenario cleanup instead of base accept', () => {
  assert.deepEqual(rawDecisionDisplayState({
    horizontalResult: 'accept',
    horizontalReason: 'motion_supported_low_speed',
    entersTrustedGpx: false,
    primaryExplanation: {
      source: 'scenario',
      scenario: 'moving_spike_cleanup'
    }
  }), {
    result: 'cleaned',
    reason: 'moving_spike_cleanup'
  });
  assert.deepEqual(rawDecisionDisplayState({
    horizontalResult: 'accept',
    horizontalReason: 'transport_suspected_kept',
    entersTrustedGpx: true,
    primaryExplanation: {
      source: 'scenario',
      scenario: 'transport_contamination'
    }
  }), {
    result: 'accept',
    reason: 'transport_suspected_kept'
  });
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

test('parseEvidenceJsonl and target product consume platform-neutral evidence v1', () => {
  const model = parseEvidenceJsonl([
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"sampling_policy","sessionId":"S1","samplingEpochId":1,"state":"MOVING_STANDARD","startedElapsedRealtimeNanos":1000000000,"eventElapsedRealtimeNanos":1000000000}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"motion_window","sessionId":"S1","windowId":1,"startElapsedRealtimeNanos":26000000000,"endElapsedRealtimeNanos":31000000000,"accelerometerDynamicRmsMps2":0.6,"gyroscopeRmsRadps":0.2,"stepCounterDelta":12}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"barometer_window","sessionId":"S1","windowId":1,"startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":1000000000,"avgPressureHpa":1000,"avgBarometerAltitudeMeters":100,"windowAscentMeters":0,"windowDescentMeters":0}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"barometer_window","sessionId":"S1","windowId":2,"startElapsedRealtimeNanos":26000000000,"endElapsedRealtimeNanos":31000000000,"avgPressureHpa":999,"avgBarometerAltitudeMeters":112,"windowAscentMeters":12,"windowDescentMeters":0}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"barometer_window","sessionId":"S1","windowId":3,"startElapsedRealtimeNanos":56000000000,"endElapsedRealtimeNanos":61000000000,"avgPressureHpa":999.5,"avgBarometerAltitudeMeters":105,"windowAscentMeters":0,"windowDescentMeters":7}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":1,"provider":"gnss","lat":30,"lng":120,"horizontalAccuracyMeters":5,"altitudeMeters":100,"verticalAccuracyMeters":4,"speedMetersPerSecond":1.2,"wallTimeMillis":1760000000000,"fixElapsedRealtimeNanos":1000000000,"receivedElapsedRealtimeNanos":1010000000,"callbackDelayNanos":10000000,"samplingEpochId":1,"isMock":false}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":2,"provider":"gnss","lat":30.0001,"lng":120,"horizontalAccuracyMeters":5,"altitudeMeters":110,"verticalAccuracyMeters":4,"speedMetersPerSecond":1.2,"wallTimeMillis":1760000030000,"fixElapsedRealtimeNanos":31000000000,"receivedElapsedRealtimeNanos":31010000000,"callbackDelayNanos":10000000,"samplingEpochId":1,"isMock":false}',
    '{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":3,"provider":"gnss","lat":30.0002,"lng":120,"horizontalAccuracyMeters":5,"altitudeMeters":104,"verticalAccuracyMeters":4,"speedMetersPerSecond":1.2,"wallTimeMillis":1760000060000,"fixElapsedRealtimeNanos":61000000000,"receivedElapsedRealtimeNanos":61010000000,"callbackDelayNanos":10000000,"samplingEpochId":1,"isMock":false}'
  ].join('\n'));

  assert.equal(model.summary.rawCount, 3);
  assert.equal(model.summary.deviceMotionWindowCount, 1);
  assert.equal(model.points[0].rawPointId, 1);
  assert.equal(model.points[0].accuracy, 5);
  assert.equal(model.points[0].elapsedRealtimeNanos, 1_000_000_000);
  assert.equal(model.points[0].callbackReceivedElapsedRealtimeNanos, 1_010_000_000);

  const product = buildSixLayerTrackProduct(model, {
    config: { stationarySessionCollapseEnabled: false }
  });
  const output = buildTargetOutput(model, product);

  assert.deepEqual(product.track.map((point) => point.sourceRawPointId), [1, 2, 3]);
  assert.equal(product.stats.movingTimeSeconds, 60);
  assert.equal(product.stats.locationAltitudeTotalAscentMeters, 10);
  assert.equal(product.stats.locationAltitudeTotalDescentMeters, 6);
  assert.equal(product.stats.barometerTotalAscentMeters, 12);
  assert.equal(product.stats.barometerTotalDescentMeters, 7);
  assert.equal(product.stats.selectedAscentSource, 'BAROMETER');
  assert.equal(product.selectedAscentResult.totalDescentMeters, 7);
  assert.equal(output.summaries.raw.unexplainedCount, 0);
  assert.equal(output.summaries.motion.deviceMotionWindowCount, 1);
  assert.equal(output.selectedTotalDescentMeters, 7);
  assert.equal(output.summaries.pressure.locationAltitudeTotalDescentMeters, 6);
  assert.equal(output.summaries.pressure.barometerTotalDescentMeters, 7);
  assert.ok(!output.findings.some((finding) => finding.includes('未解释')));
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

test('buildTargetOutput exposes suspected transport diagnostics separately from hiking truth',
  () => {
    const model = parseEvidenceJsonl([
      '{"event":"session_metadata","sessionId":"S1","recordStartElapsedRealtimeNanos":1000000000}',
      '{"event":"sampling_policy","samplingEpochId":1,"state":"MOVING","eventElapsedRealtimeNanos":1000000000}',
      '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":30,"lng":120,"accuracy":5,"elapsedRealtimeNanos":1000000000}',
      '{"event":"raw_location","rawPointId":2,"provider":"gps","lat":30.001,"lng":120,"accuracy":5,"elapsedRealtimeNanos":4000000000}'
    ].join('\n'));
    const product = buildSixLayerTrackProduct(model);
    const output = buildTargetOutput(model, product);

    assert.equal(output.totalDistanceMeters, 0);
    assert.equal(output.movingTimeSeconds, 0);
    assert.equal(output.suspectedTransportPointCount, 1);
    assert.equal(output.suspectedTransportSegmentCount, 1);
    assert.equal(output.suspectedTransportDurationSeconds, 3);
    assert.ok(output.suspectedTransportDistanceMeters > 100);
    assert.ok(output.suspectedTransportAverageSpeedMetersPerSecond > 30);
    assert.deepEqual(output.summaries.suspectedTransport, {
      pointCount: 1,
      segmentCount: 1,
      distanceMeters: output.suspectedTransportDistanceMeters,
      durationSeconds: 3,
      averageSpeedMetersPerSecond:
        output.suspectedTransportAverageSpeedMetersPerSecond,
      diagnosticOnly: true
    });
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
  assert.equal(output.scenarioSettlementPlan.proposalCount, 0);
  assert.ok(Array.isArray(output.scenarioSettlementPlan.activeProposals));
  assert.equal(output.scenarioSettlementPlan.commitPlan.status, 'committable');
  assert.deepEqual(output.scenarioSettlementPlan.commitPlan.committableRanges, [
    {
      type: 'normal',
      range: {
        startRawPointId: 1,
        endRawPointId: 2
      }
    }
  ]);
  assert.equal(output.streamingSettlementState.committedCursorRawPointId, 2);
  assert.deepEqual(output.streamingSettlementState.hardBoundaryCheckpoints, []);
  assert.equal(output.streamingSettlementStateContract.schemaVersion,
    'track-sdk-streaming-settlement-state-v1');
  assert.equal(output.streamingSettlementStateContract.committedCursorSampleId, 2);
  assert.deepEqual(output.streamingSettlementStateContract.committedRanges.map((item) =>
    item.sampleRange), [
    { startSampleId: 1, endSampleId: 2 }
  ]);
  assert.ok(Array.isArray(output.denseAreaSettlementPlan));
  assert.ok(Array.isArray(output.denseIntentConflicts));
  assert.ok(Array.isArray(output.forwardSpineCandidates));
  assert.ok(Array.isArray(output.forwardSpineOverlaps));
  assert.ok(Array.isArray(output.forwardSpineConflicts));
  assert.ok(Array.isArray(output.forwardSpineDecisions));
  assert.ok(!output.findings.some((finding) => finding.includes('未解释 raw_location')));
});

test('buildTargetOutput exposes streaming diagnostic context report', () => {
  const model = parseEvidenceJsonl([
    '{"event":"session_metadata","sessionId":"S1"}',
    '{"event":"raw_location","rawPointId":1,"provider":"gps","lat":29,"lng":106,"accuracy":8,"elapsedRealtimeNanos":1000}'
  ].join('\n'));
  const output = buildTargetOutput(model, diagnosticContextProductFixture());

  assert.equal(output.streamingDiagnosticContexts.totalCount, 2);
  assert.deepEqual(output.streamingDiagnosticContexts.scenarioCounts, [
    { scenario: 'dense_area_intent', count: 1 },
    { scenario: 'enclosed_gap_cluster', count: 1 }
  ]);
  assert.deepEqual(output.streamingDiagnosticContexts.contexts.map((context) => ({
    scenario: context.scenario,
    range: context.rawRange,
    metricOwner: context.metricOwner,
    gates: context.affectedMetricGates,
    anchors: context.anchorRawPointIds
  })), [
    {
      scenario: 'dense_area_intent',
      range: { startRawPointId: 1, endRawPointId: 8 },
      metricOwner: false,
      gates: [],
      anchors: [1, 8]
    },
    {
      scenario: 'enclosed_gap_cluster',
      range: { startRawPointId: 2, endRawPointId: 9 },
      metricOwner: false,
      gates: [],
      anchors: [3, 4, 6]
    }
  ]);
  assert.equal(
    output.streamingDiagnosticContexts.contexts[1].evidence.gapClusterIntentSupported,
    true
  );
  assert.equal(
    output.streamingDiagnosticContexts.contexts.some((context) =>
      context.scenario === 'moving_spike_cleanup'),
    false
  );
  assert.ok(output.findings.some((finding) =>
    finding.includes('streaming diagnostic context enclosed_gap_cluster 1 段')));
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

function diagnosticContextProductFixture() {
  return {
    track: [],
    excluded: {
      weak: [],
      rejected: [],
      intakeRejected: []
    },
    stats: {
      trustedPointCount: 0,
      weakPointCount: 0,
      rejectedPointCount: 0,
      intakeRejectedPointCount: 0,
      totalDistanceMeters: 0,
      movingTimeSeconds: 0,
      selectedAscentSource: 'NONE'
    },
    scenarioSettlementPlan: {
      contextProposals: [
        {
          id: 'context:dense',
          scenario: 'dense_area_intent',
          rawRange: { startRawPointId: 1, endRawPointId: 8 },
          metricOwner: false,
          affectedMetricGates: [],
          action: 'classify_dense_area_intent',
          localRebuild: 'dense_area_intent_classifier',
          evidence: {
            sourceScenarioId: 101
          }
        },
        {
          id: 'context:gap',
          scenario: 'enclosed_gap_cluster',
          rawRange: { startRawPointId: 2, endRawPointId: 9 },
          metricOwner: false,
          affectedMetricGates: [],
          action: 'classify_enclosed_gap_cluster',
          localRebuild: 'gap_stationary_cluster_diagnostic',
          evidence: {
            sourceScenarioId: 102
          }
        },
        {
          id: 'active:moving-spike',
          scenario: 'moving_spike_cleanup',
          rawRange: { startRawPointId: 1, endRawPointId: 3 },
          metricOwner: true,
          affectedMetricGates: ['route', 'distance', 'moving_time'],
          action: 'remove_single_point_spike',
          localRebuild: 'moving_spike_line_bridge'
        }
      ]
    },
    streamingSettlementState: {},
    scenarios: [
      {
        scenarioId: 101,
        scenario: 'dense_area_intent',
        rawRange: { startRawPointId: 1, endRawPointId: 8 },
        anchorRawPointIds: [1, 8],
        evidence: {
          intent: 'gap_cluster',
          plannedSettlement: 'enclosed_gap_cluster_settlement'
        }
      },
      {
        scenarioId: 102,
        scenario: 'enclosed_gap_cluster',
        rawRange: { startRawPointId: 2, endRawPointId: 9 },
        anchorRawPointIds: [3, 4, 6],
        evidence: {
          gapRecoveryCount: 3,
          stationaryAnchorCount: 3,
          gapClusterIntentSupported: true
        }
      }
    ]
  };
}

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
