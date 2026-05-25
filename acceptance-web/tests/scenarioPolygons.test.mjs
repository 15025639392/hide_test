import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScenarioPolygonFeatures,
  scenarioPolygonForPoints
} from '../src/scenarioPolygons.mjs';

test('scenarioPolygonForPoints returns a closed visible polygon for one point', () => {
  const polygon = scenarioPolygonForPoints([
    { rawPointId: 1, lat: 30, lng: 120, accuracy: 8 }
  ]);

  assert.ok(polygon);
  assert.ok(polygon.areaMeters2 > 0);
  assert.deepEqual(polygon.coordinates[0], polygon.coordinates.at(-1));
});

test('continuous scenario coverage renders as one polygon region', () => {
  const features = buildScenarioPolygonFeatures({
    id: 'dataset-1',
    fileName: 'fixture-evidence.jsonl',
    model: {
      points: [
        { rawPointId: 1, lat: 30, lng: 120, accuracy: 8 },
        { rawPointId: 2, lat: 30.0002, lng: 120.0003, accuracy: 8 },
        { rawPointId: 3, lat: 30.0003, lng: 120.00005, accuracy: 8 }
      ]
    },
    targetProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 1, lat: 30, lng: 120 },
        { trackPointId: 2, sourceRawPointId: 2, lat: 30.0002, lng: 120.0003 },
        { trackPointId: 3, sourceRawPointId: 3, lat: 30.0003, lng: 120.00005 }
      ],
      scenarios: [
        {
          scenarioId: 7,
          scenario: 'closed_loop_round_trip',
          confidence: 0.82,
          rawRange: { startRawPointId: 1, endRawPointId: 3 },
          action: 'classify_loop_without_rewrite',
          localRebuild: 'round_trip_diagnostic'
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 7,
          scenario: 'closed_loop_round_trip',
          scenarioLabel: '闭合往返/回环',
          confidence: 0.82,
          continuousCoverage: true,
          rawRange: { startRawPointId: 1, endRawPointId: 3 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 3 },
          trackPointIds: [1, 2, 3],
          summary: 'loop coverage'
        }
      ]
    }
  });

  assert.equal(features.length, 1);
  assert.equal(features[0].properties.label, '闭合往返/回环');
  assert.equal(features[0].properties.trackCoverage, '#1-3');
  assert.equal(features[0].properties.rawRange, 'Raw#1-3');
  assert.ok(features[0].properties.areaMeters2 > 0);
});

test('discrete scenario coverage splits distant trigger points into separate polygons', () => {
  const features = buildScenarioPolygonFeatures({
    id: 'dataset-1',
    fileName: 'fixture-evidence.jsonl',
    model: {
      points: [
        { rawPointId: 10, lat: 30, lng: 120, accuracy: 6 },
        { rawPointId: 50, lat: 30.02, lng: 120.02, accuracy: 6 }
      ]
    },
    targetProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 10, lat: 30, lng: 120 },
        { trackPointId: 2, sourceRawPointId: 50, lat: 30.02, lng: 120.02 }
      ],
      scenarios: [
        {
          scenarioId: 3,
          scenario: 'gap_recovery_boundary',
          confidence: 0.85,
          rawRange: { startRawPointId: 10, endRawPointId: 50 },
          anchorRawPointIds: [10, 50],
          action: 'reset_segment_zero_delta',
          localRebuild: 'gap_recovery_anchor',
          evidence: { rawPointIds: [10, 50] }
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 3,
          scenario: 'gap_recovery_boundary',
          scenarioLabel: 'GAP 恢复边界',
          confidence: 0.85,
          continuousCoverage: false,
          rawRange: { startRawPointId: 10, endRawPointId: 50 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 2 },
          trackPointIds: [1, 2],
          summary: 'gap boundaries'
        }
      ]
    }
  });

  assert.equal(features.length, 2);
  assert.deepEqual(features.map((feature) => feature.properties.regionIndex), [0, 1]);
  assert.ok(features.every((feature) => feature.properties.regionCount === 2));
  assert.ok(features.every((feature) => feature.properties.areaMeters2 > 0));
});

test('scenario polygons use full scenario product when current target has repairs disabled', () => {
  const dataset = {
    id: 'dataset-1',
    fileName: 'fixture-evidence.jsonl',
    model: {
      points: [
        { rawPointId: 1, lat: 30, lng: 120, accuracy: 8 },
        { rawPointId: 2, lat: 30.0002, lng: 120.0003, accuracy: 8 }
      ]
    },
    targetProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 1, lat: 30, lng: 120 }
      ],
      scenarios: [],
      scenarioCoverage: []
    },
    scenarioProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 1, lat: 30, lng: 120 },
        { trackPointId: 2, sourceRawPointId: 2, lat: 30.0002, lng: 120.0003 }
      ],
      scenarios: [
        {
          scenarioId: 8,
          scenario: 'round_trip_line',
          confidence: 0.7,
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          action: 'simplify_round_trip_line',
          localRebuild: 'round_trip_line_simplified'
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 8,
          scenario: 'round_trip_line',
          scenarioLabel: '往返线形',
          confidence: 0.7,
          continuousCoverage: true,
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 2 },
          trackPointIds: [1, 2],
          summary: 'full scenario coverage'
        }
      ]
    }
  };

  const features = buildScenarioPolygonFeatures(dataset);

  assert.equal(features.length, 1);
  assert.equal(features[0].properties.scenario, 'round_trip_line');
  assert.equal(features[0].properties.trackCoverage, '#1-2');
});
