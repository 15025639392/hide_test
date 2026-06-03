import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScenarioPolygonFeatures,
  scenarioColor,
  scenarioCoverageShouldRenderOnMap,
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

test('scenarioColor covers enabled repair scenario ids', () => {
  for (const scenario of [
    'dense_main_route_settlement',
    'enclosed_loop_cluster_settlement',
    'moving_spike_cleanup',
    'position_snap_recovery',
    'rest_photo_micro_move'
  ]) {
    assert.notEqual(scenarioColor(scenario), '#f8fafc', scenario);
  }
});

test('scenario polygons skip unknown scenario colors', () => {
  const dataset = {
    id: 'dataset-1',
    model: {
      points: [
        { rawPointId: 1, lat: 30, lng: 120, accuracy: 8 },
        { rawPointId: 2, lat: 30.0002, lng: 120.0003, accuracy: 8 }
      ]
    },
    targetProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 1, lat: 30, lng: 120 },
        { trackPointId: 2, sourceRawPointId: 2, lat: 30.0002, lng: 120.0003 }
      ],
      scenarios: [
        {
          scenarioId: 99,
          scenario: 'unknown_future_scenario',
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          action: 'reset_segment_zero_delta',
          localRebuild: 'gap_recovery_anchor'
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 99,
          scenario: 'unknown_future_scenario',
          continuousCoverage: true,
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 2 },
          trackPointIds: [1, 2],
          primaryTrackPointCount: 1,
          action: 'reset_segment_zero_delta',
          localRebuild: 'gap_recovery_anchor'
        }
      ]
    }
  };

  assert.equal(scenarioColor('unknown_future_scenario'), null);
  assert.equal(buildScenarioPolygonFeatures(dataset).length, 0);
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
          primaryTrackPointCount: 1,
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
          action: 'reset_segment_zero_delta',
          localRebuild: 'gap_recovery_anchor',
          summary: 'gap boundaries'
        }
      ]
    }
  });

  assert.equal(features.length, 2);
  assert.deepEqual(features.map((feature) => feature.properties.regionIndex), [0, 1]);
  assert.ok(features.every((feature) => feature.properties.regionCount === 2));
  assert.ok(features.every((feature) => feature.properties.rawRange === 'Raw点 10, 50'));
  assert.ok(features.every((feature) => feature.properties.areaMeters2 > 0));
});

test('moving spike cleanup polygon uses previous spike and next raw ids', () => {
  const features = buildScenarioPolygonFeatures({
    id: 'dataset-1',
    fileName: 'fixture-evidence.jsonl',
    model: {
      points: [
        { rawPointId: 1666, lat: 30, lng: 120, accuracy: 6 },
        { rawPointId: 1667, lat: 30.0001, lng: 120.0002, accuracy: 6 },
        { rawPointId: 1668, lat: 30.0002, lng: 120.0003, accuracy: 6 }
      ]
    },
    targetProduct: {
      track: [
        {
          trackPointId: 7,
          sourceRawPointId: 1668,
          contributingRawPointIds: [1667, 1668],
          lat: 30.0002,
          lng: 120.0003
        }
      ],
      scenarios: [
        {
          scenarioId: 9,
          scenario: 'moving_spike_cleanup',
          confidence: 0.82,
          rawRange: { startRawPointId: 1666, endRawPointId: 1668 },
          anchorRawPointIds: [1668],
          action: 'remove_single_point_spike',
          localRebuild: 'moving_spike_line_bridge',
          evidence: {
            previousRawPointId: 1666,
            spikeRawPointId: 1667,
            nextRawPointId: 1668
          }
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 9,
          scenario: 'moving_spike_cleanup',
          scenarioLabel: '移动单点尖刺清理',
          confidence: 0.82,
          continuousCoverage: false,
          rawRange: { startRawPointId: 1666, endRawPointId: 1668 },
          trackPointRange: { startTrackPointId: 7, endTrackPointId: 7 },
          trackPointIds: [7],
          action: 'remove_single_point_spike',
          localRebuild: 'moving_spike_line_bridge',
          summary: 'spike bridge'
        }
      ]
    }
  });

  assert.equal(features.length, 1);
  assert.equal(features[0].properties.rawRange, 'Raw点 1666, 1667, 1668');
  assert.ok(features[0].properties.areaMeters2 > 0);
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
          action: 'simplify_round_trip_line',
          localRebuild: 'round_trip_line_simplified',
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

test('scenario polygons skip pure context coverage on the map', () => {
  const dataset = {
    id: 'dataset-1',
    model: {
      points: [
        { rawPointId: 1, lat: 30, lng: 120, accuracy: 8 },
        { rawPointId: 2, lat: 30.0002, lng: 120.0003, accuracy: 8 }
      ]
    },
    targetProduct: {
      track: [
        { trackPointId: 1, sourceRawPointId: 1, lat: 30, lng: 120 },
        { trackPointId: 2, sourceRawPointId: 2, lat: 30.0002, lng: 120.0003 }
      ],
      scenarios: [
        {
          scenarioId: 22,
          scenario: 'dense_main_route_settlement',
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          action: 'classify_dense_main_route',
          localRebuild: 'diagnostic_only'
        }
      ],
      scenarioCoverage: [
        {
          scenarioId: 22,
          scenario: 'dense_main_route_settlement',
          scenarioLabel: '密集区主路线',
          continuousCoverage: true,
          rawRange: { startRawPointId: 1, endRawPointId: 2 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 2 },
          trackPointIds: [1, 2],
          contextTrackPointCount: 2,
          primaryTrackPointCount: 0,
          rawDecisionContextCount: 2,
          rawDecisionPrimaryCount: 0
        }
      ]
    }
  };

  const [coverage] = dataset.targetProduct.scenarioCoverage;

  assert.equal(scenarioCoverageShouldRenderOnMap(dataset, coverage), false);
  assert.equal(buildScenarioPolygonFeatures(dataset).length, 0);
  coverage.primaryTrackPointCount = 1;
  assert.equal(scenarioCoverageShouldRenderOnMap(dataset, coverage), true);
  let features = buildScenarioPolygonFeatures(dataset);
  assert.equal(features.length, 1);
  assert.equal(features[0].properties.fallbackRegion, false);

  coverage.continuousCoverage = false;
  coverage.trackPointIds = [];
  features = buildScenarioPolygonFeatures(dataset);
  assert.equal(features.length, 1);
  assert.equal(features[0].properties.fallbackRegion, true);
});
