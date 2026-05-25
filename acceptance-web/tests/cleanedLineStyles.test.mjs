import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCleanedLineFeatures,
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
