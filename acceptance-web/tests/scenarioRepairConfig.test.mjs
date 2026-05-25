import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCENARIO_REPAIR_IDS,
  SCENARIO_REPAIR_OPTIONS,
  enabledScenarioRepairIds,
  fullScenarioRepairConfig,
  scenarioRepairConfigFromIds,
  scenarioRepairOption,
  scenarioRepairSummary
} from '../src/scenarioRepairConfig.mjs';

test('scenario repair config enables all repair modules by default', () => {
  const config = scenarioRepairConfigFromIds(DEFAULT_SCENARIO_REPAIR_IDS);
  const fullConfig = fullScenarioRepairConfig();

  for (const option of SCENARIO_REPAIR_OPTIONS) {
    assert.equal(config[option.configKey], true, option.configKey);
    assert.equal(fullConfig[option.configKey], true, option.configKey);
  }
  assert.equal(config.weakCloudAccuracyMeters, 30);
  assert.equal(config.gapSeconds, 120);
});

test('scenario repair config disables unchecked modules without changing thresholds', () => {
  const config = scenarioRepairConfigFromIds([
    'weak_recovery_endpoint',
    'round_trip_line'
  ]);

  assert.equal(config.weakRecoveryShapePreserveEnabled, true);
  assert.equal(config.roundTripLineSimplifyEnabled, true);
  assert.equal(config.stationarySessionCollapseEnabled, false);
  assert.equal(config.roundTripSameRoadCollapseEnabled, false);
  assert.equal(config.closedLoopRoundTripEnabled, false);
  assert.equal(config.weakCloudAccuracyMeters, 30);
  assert.equal(config.transportSpeedMetersPerSecond, 3.5);
});

test('scenario repair helpers ignore unknown ids and summarize selection', () => {
  assert.deepEqual(enabledScenarioRepairIds(['round_trip_line', 'unknown']),
    ['round_trip_line']);
  assert.equal(scenarioRepairSummary(['round_trip_line']), '往返线形抽稀');
  assert.equal(scenarioRepairSummary([]), '未启用修复');
  assert.equal(scenarioRepairSummary(DEFAULT_SCENARIO_REPAIR_IDS), '全部修复');
  assert.equal(scenarioRepairOption('round_trip_line').configKey,
    'roundTripLineSimplifyEnabled');
  assert.equal(scenarioRepairOption('unknown'), null);
});
