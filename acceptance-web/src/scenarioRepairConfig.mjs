import {
  normalizeSixLayerTrackConfig
} from './sixLayerTrackProduct.mjs';

export const SCENARIO_REPAIR_OPTIONS = Object.freeze([
  {
    id: 'stationary_session_collapse',
    label: '整段静止压缩',
    configKey: 'stationarySessionCollapseEnabled',
    kind: 'rewrite'
  },
  {
    id: 'stationary_drift_collapse',
    label: '停留漂移压缩',
    configKey: 'dwellDriftCollapseEnabled',
    kind: 'rewrite'
  },
  {
    id: 'weak_recovery_endpoint',
    label: '弱信号端点保留',
    configKey: 'weakRecoveryShapePreserveEnabled',
    kind: 'rewrite'
  },
  {
    id: 'same_road_round_trip',
    label: '同路往返中心线',
    configKey: 'roundTripSameRoadCollapseEnabled',
    kind: 'rewrite'
  },
  {
    id: 'round_trip_line',
    label: '往返线形抽稀',
    configKey: 'roundTripLineSimplifyEnabled',
    kind: 'rewrite'
  },
  {
    id: 'closed_loop_round_trip',
    label: '闭合往返标注',
    configKey: 'closedLoopRoundTripEnabled',
    kind: 'diagnostic'
  },
  {
    id: 'enclosed_gap_cluster',
    label: '遮挡聚集标注',
    configKey: 'enclosedGapClusterEnabled',
    kind: 'diagnostic'
  },
  {
    id: 'rest_photo_micro_move',
    label: '休息微移动标注',
    configKey: 'restPhotoMicroMoveEnabled',
    kind: 'diagnostic'
  }
]);

export const DEFAULT_SCENARIO_REPAIR_IDS = Object.freeze(
  SCENARIO_REPAIR_OPTIONS.map((option) => option.id)
);

export function scenarioRepairConfigFromIds(enabledIds, baseOverrides = {}) {
  const enabled = new Set(enabledIds || DEFAULT_SCENARIO_REPAIR_IDS);
  const overrides = { ...baseOverrides };
  for (const option of SCENARIO_REPAIR_OPTIONS) {
    overrides[option.configKey] = enabled.has(option.id);
  }
  return normalizeSixLayerTrackConfig(overrides);
}

export function fullScenarioRepairConfig(baseOverrides = {}) {
  return scenarioRepairConfigFromIds(DEFAULT_SCENARIO_REPAIR_IDS, baseOverrides);
}

export function scenarioRepairSummary(enabledIds) {
  const enabled = enabledScenarioRepairIds(enabledIds);
  if (enabled.length === SCENARIO_REPAIR_OPTIONS.length) return '全部修复';
  if (enabled.length === 0) return '未启用修复';
  if (enabled.length === 1) {
    return scenarioRepairLabel(enabled[0]);
  }
  return `${enabled.length}/${SCENARIO_REPAIR_OPTIONS.length} 项修复`;
}

export function enabledScenarioRepairIds(enabledIds) {
  const validIds = new Set(SCENARIO_REPAIR_OPTIONS.map((option) => option.id));
  return [...new Set(enabledIds || DEFAULT_SCENARIO_REPAIR_IDS)]
    .filter((id) => validIds.has(id));
}

export function scenarioRepairLabel(id) {
  return SCENARIO_REPAIR_OPTIONS.find((option) => option.id === id)?.label || id || '-';
}

export function scenarioRepairOption(id) {
  return SCENARIO_REPAIR_OPTIONS.find((option) => option.id === id) || null;
}
