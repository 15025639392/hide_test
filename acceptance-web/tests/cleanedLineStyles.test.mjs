import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCleanedLineFeatures,
  cleanedRouteLinePoints,
  cleanedLineStyleForPoint
} from '../src/cleanedLineStyles.mjs';

test('cleaned line features highlight enabled scenario repair spans', () => {
  const dataset = { id: 'dataset-1', color: '#2dd4bf' };
  const points = [
    { trackPointId: 1, lat: 30, lng: 120 },
    {
      trackPointId: 2,
      lat: 30.001,
      lng: 120.001,
      primaryExplanation: {
        source: 'scenario',
        scenario: 'round_trip_line',
        scenarioLabel: '往返线形'
      }
    },
    { trackPointId: 3, lat: 30.002, lng: 120.002 }
  ];

  const features = buildCleanedLineFeatures(dataset, points, {
    enabledScenarioRepairIds: ['round_trip_line']
  });

  assert.equal(features.length, 2);
  assert.equal(features[0].properties.lineStyle, 'scenario_rewrite');
  assert.equal(features[0].properties.scenario, 'round_trip_line');
  assert.equal(features[0].properties.lineColor, '#facc15');
  assert.ok(features[0].properties.lineWidth > 4);
  assert.equal(features[1].properties.lineStyle, 'default');
});

test('cleaned line features do not style disabled repair contexts', () => {
  const dataset = { id: 'dataset-1', color: '#2dd4bf' };
  const points = [
    { trackPointId: 1, lat: 30, lng: 120 },
    {
      trackPointId: 2,
      lat: 30.001,
      lng: 120.001,
      scenarioContexts: [{ scenario: 'round_trip_line', scenarioLabel: '往返线形' }]
    },
    { trackPointId: 3, lat: 30.002, lng: 120.002 }
  ];

  const features = buildCleanedLineFeatures(dataset, points, {
    enabledScenarioRepairIds: []
  });
  const style = cleanedLineStyleForPoint(points[1], new Set());

  assert.equal(features.length, 1);
  assert.equal(features[0].properties.lineStyle, 'default');
  assert.equal(features[0].geometry.coordinates.length, 3);
  assert.equal(style.repairEnabled, false);
});

test('cleaned line styles mark settled rest photo micro movement as rewrite', () => {
  const point = {
    trackPointId: 2,
    lat: 30.001,
    lng: 120.001,
    primaryExplanation: {
      source: 'scenario',
      scenario: 'rest_photo_micro_move',
      scenarioLabel: '拍照/休息微移动'
    }
  };

  const style = cleanedLineStyleForPoint(point, new Set(['rest_photo_micro_move']));

  assert.equal(style.lineStyle, 'scenario_rewrite');
  assert.equal(style.repairKind, 'rewrite');
  assert.equal(style.repairLabel, '休息小移动');
  assert.equal(style.repairEnabled, true);
});

test('cleaned line bridges over stationary drift explanation anchors', () => {
  const dataset = { id: 'dataset-1', color: '#2dd4bf' };
  const points = [
    { trackPointId: 1, lat: 30, lng: 120 },
    {
      trackPointId: 2,
      lat: 30.01,
      lng: 120.01,
      reason: 'stationary_drift_anchor',
      routeLineVertex: false,
      routeLineStrategy: 'bridge_previous_next',
      primaryExplanation: {
        source: 'scenario',
        scenario: 'stationary_drift_collapse',
        scenarioLabel: '停留漂移压缩'
      }
    },
    { trackPointId: 3, lat: 30.002, lng: 120.002 }
  ];

  const features = buildCleanedLineFeatures(dataset, points, {
    enabledScenarioRepairIds: ['stationary_drift_collapse']
  });
  const routePoints = cleanedRouteLinePoints(points);

  assert.deepEqual(routePoints.map((point) => point.trackPointId), [1, 3]);
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates, [
    [120, 30],
    [120.002, 30.002]
  ]);
  assert.equal(features[0].properties.startTrackPointId, 1);
  assert.equal(features[0].properties.endTrackPointId, 3);
});
