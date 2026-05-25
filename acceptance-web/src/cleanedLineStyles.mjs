import { scenarioColor } from './scenarioPolygons.mjs';
import {
  SCENARIO_REPAIR_OPTIONS,
  enabledScenarioRepairIds,
  scenarioRepairLabel,
  scenarioRepairOption
} from './scenarioRepairConfig.mjs';

const DEFAULT_CLEANED_LINE_COLOR = '#ef4444';
const DEFAULT_CLEANED_LINE_WIDTH = 4;
const DEFAULT_CLEANED_LINE_OPACITY = 0.95;

export function buildCleanedLineFeatures(dataset, points, options = {}) {
  const validPoints = (points || []).filter(hasValidLngLat);
  if (validPoints.length < 2) return [];

  const enabledIds = new Set(enabledScenarioRepairIds(options.enabledScenarioRepairIds));
  const features = [];
  let current = null;

  for (let index = 1; index < validPoints.length; index++) {
    const from = validPoints[index - 1];
    const to = validPoints[index];
    const style = cleanedLineStyleForPoint(to, enabledIds);
    const key = cleanedLineStyleKey(style);
    const fromCoordinate = lngLat(from);
    const toCoordinate = lngLat(to);

    if (!current || current.styleKey !== key) {
      if (current) features.push(cleanedLineFeature(current));
      current = {
        dataset,
        style,
        styleKey: key,
        startTrackPointId: from.trackPointId ?? null,
        endTrackPointId: to.trackPointId ?? null,
        coordinates: [fromCoordinate, toCoordinate]
      };
      continue;
    }

    current.endTrackPointId = to.trackPointId ?? current.endTrackPointId;
    current.coordinates.push(toCoordinate);
  }

  if (current) features.push(cleanedLineFeature(current));
  return features;
}

export function cleanedLineStyleForPoint(point, enabledIds = new Set()) {
  const context = preferredEnabledRepairContext(point, enabledIds);
  if (!context) {
    return {
      lineStyle: 'default',
      lineColor: DEFAULT_CLEANED_LINE_COLOR,
      lineWidth: DEFAULT_CLEANED_LINE_WIDTH,
      lineOpacity: DEFAULT_CLEANED_LINE_OPACITY,
      scenario: '',
      scenarioLabel: '',
      repairKind: '',
      repairLabel: '',
      repairEnabled: false
    };
  }

  const option = scenarioRepairOption(context.scenario);
  return {
    lineStyle: option.kind === 'rewrite' ? 'scenario_rewrite' : 'scenario_diagnostic',
    lineColor: scenarioColor(context.scenario),
    lineWidth: option.kind === 'rewrite' ? 6 : 5,
    lineOpacity: option.kind === 'rewrite' ? 0.98 : 0.86,
    scenario: context.scenario,
    scenarioLabel: context.scenarioLabel || context.scenario,
    repairKind: option.kind,
    repairLabel: scenarioRepairLabel(context.scenario),
    repairEnabled: true
  };
}

function preferredEnabledRepairContext(point, enabledIds) {
  const contextsByScenario = new Map(scenarioContextsForPoint(point)
    .map((context) => [context.scenario, context]));
  for (const option of SCENARIO_REPAIR_OPTIONS) {
    if (!enabledIds.has(option.id)) continue;
    const context = contextsByScenario.get(option.id);
    if (context) return context;
  }
  return null;
}

function scenarioContextsForPoint(point) {
  const contexts = [];
  const primary = point?.primaryExplanation;
  if (primary?.source === 'scenario' && primary.scenario) contexts.push(primary);
  contexts.push(...(point?.scenarioContexts || []));

  const seen = new Set();
  return contexts.filter((context) => {
    if (!context?.scenario || seen.has(context.scenario)) return false;
    seen.add(context.scenario);
    return true;
  });
}

function cleanedLineFeature(group) {
  return {
    type: 'Feature',
    properties: {
      datasetId: group.dataset.id,
      kind: 'cleaned',
      color: group.dataset.color,
      startTrackPointId: group.startTrackPointId,
      endTrackPointId: group.endTrackPointId,
      ...group.style
    },
    geometry: {
      type: 'LineString',
      coordinates: group.coordinates
    }
  };
}

function cleanedLineStyleKey(style) {
  return [
    style.lineStyle,
    style.lineColor,
    style.lineWidth,
    style.lineOpacity,
    style.scenario,
    style.repairKind,
    style.repairEnabled
  ].join('|');
}

function hasValidLngLat(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function lngLat(point) {
  return [point.lng, point.lat];
}
