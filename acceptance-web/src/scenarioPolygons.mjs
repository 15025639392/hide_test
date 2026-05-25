const METERS_PER_DEGREE_LAT = 111_320;
const DEFAULT_POINT_LIMIT = 2500;
const DEFAULT_MIN_PADDING_METERS = 10;
const DEFAULT_MAX_PADDING_METERS = 45;
const DEFAULT_PADDING_METERS = 16;

const SCENARIO_COLORS = {
  stationary_session_collapse: '#22c55e',
  stationary_drift_collapse: '#84cc16',
  rest_photo_micro_move: '#fb7185',
  enclosed_gap_cluster: '#a78bfa',
  same_road_round_trip: '#14b8a6',
  closed_loop_round_trip: '#f59e0b',
  round_trip_line: '#facc15',
  weak_recovery_endpoint: '#38bdf8',
  gap_recovery_boundary: '#60a5fa',
  transport_contamination: '#ef4444'
};

export function buildScenarioPolygonFeatureCollection(datasets, options = {}) {
  const features = (datasets || [])
    .flatMap((dataset) => buildScenarioPolygonFeatures(dataset, options))
    .sort((left, right) =>
      (right.properties?.areaMeters2 || 0) - (left.properties?.areaMeters2 || 0));
  return { type: 'FeatureCollection', features };
}

export function buildScenarioPolygonFeatures(dataset, options = {}) {
  const product = scenarioPolygonProduct(dataset);
  const coverages = product?.scenarioCoverage || [];
  if (coverages.length === 0) return [];
  const scenarioById = new Map((product?.scenarios || [])
    .map((scenario) => [scenario.scenarioId, scenario]));
  return coverages.flatMap((coverage, coverageIndex) => {
    const scenario = scenarioById.get(coverage.scenarioId) || null;
    return scenarioCoveragePointRegions(dataset, coverage, scenario, options)
      .map((points, regionIndex, regions) =>
        scenarioPolygonFeature(dataset, coverage, scenario, points, coverageIndex,
          regionIndex, regions.length, options))
      .filter(Boolean);
  });
}

export function scenarioPolygonForPoints(points, options = {}) {
  const unique = uniqueGeoPoints(points);
  if (unique.length === 0) return null;
  const projection = projectionForPoints(unique);
  const projected = unique.map((point) => projection.toMeters(point));
  const paddingMeters = polygonPaddingMeters(unique, options);
  const hull = convexHull(projected);
  const ring = projectedRingForHull(hull, projected, paddingMeters);
  if (ring.length < 3) return null;
  const closedRing = closeProjectedRing(ring);
  const coordinates = closedRing.map((point) => projection.toLngLat(point));
  return {
    coordinates,
    areaMeters2: polygonAreaMeters2(closedRing)
  };
}

export function scenarioColor(scenario) {
  return SCENARIO_COLORS[scenario] || '#f8fafc';
}

function scenarioPolygonFeature(dataset, coverage, scenario, points, coverageIndex,
                                regionIndex, regionCount, options) {
  const polygon = scenarioPolygonForPoints(points, options);
  if (!polygon) return null;
  return {
    type: 'Feature',
    properties: {
      datasetId: dataset.id,
      fileName: dataset.fileName || dataset.filePath || '',
      scenarioId: coverage.scenarioId,
      scenario: coverage.scenario || scenario?.scenario || '',
      label: coverage.scenarioLabel || coverage.scenario || scenario?.scenario || '',
      color: scenarioColor(coverage.scenario || scenario?.scenario),
      coverageIndex,
      regionIndex,
      regionCount,
      pointCount: uniqueGeoPoints(points).length,
      confidence: Number.isFinite(coverage.confidence) ? coverage.confidence : null,
      continuousCoverage: coverage.continuousCoverage === true,
      trackCoverage: formatTrackCoverage(coverage),
      rawRange: formatRawRange(coverage.rawRange),
      actionLabel: coverage.actionLabel || coverage.action || scenario?.action || '',
      localRebuildLabel: coverage.localRebuildLabel || coverage.localRebuild
        || scenario?.localRebuild || '',
      summary: coverage.summary || '',
      areaMeters2: polygon.areaMeters2
    },
    geometry: {
      type: 'Polygon',
      coordinates: [polygon.coordinates]
    }
  };
}

function scenarioCoveragePointRegions(dataset, coverage, scenario, options) {
  if (coverage?.continuousCoverage === true) {
    const points = [
      ...rawPointsInRange(dataset, coverage.rawRange),
      ...trackPointsForCoverage(dataset, coverage)
    ];
    return [limitPoints(uniqueGeoPoints(points), options.pointLimit)].filter((region) =>
      region.length > 0);
  }

  const explicitRawPointIds = scenarioExplicitRawPointIds(scenario);
  if (explicitRawPointIds.length > 0) {
    const runs = consecutiveIdRuns(explicitRawPointIds);
    return runs
      .map((ids) => [
        ...rawPointsFromIds(dataset, ids),
        ...trackPointsForRawIds(dataset, coverage, ids)
      ])
      .map((points) => limitPoints(uniqueGeoPoints(points), options.pointLimit))
      .filter((region) => region.length > 0);
  }

  const trackPointIds = uniqueNumbers(coverage?.trackPointIds || []);
  if (trackPointIds.length > 0) {
    return consecutiveIdRuns(trackPointIds)
      .map((ids) => trackPointsFromIds(dataset, ids))
      .map((points) => limitPoints(uniqueGeoPoints(points), options.pointLimit))
      .filter((region) => region.length > 0);
  }

  return [limitPoints(uniqueGeoPoints(rawPointsInRange(dataset, coverage?.rawRange)),
    options.pointLimit)].filter((region) => region.length > 0);
}

function rawPointsInRange(dataset, rawRange) {
  const start = rawRange?.startRawPointId;
  const end = rawRange?.endRawPointId;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return (dataset?.model?.points || [])
    .filter((point) => point.rawPointId >= start && point.rawPointId <= end);
}

function rawPointsFromIds(dataset, rawPointIds) {
  const index = rawPointIndex(dataset);
  return uniqueNumbers(rawPointIds).map((id) => index.get(id)).filter(Boolean);
}

function trackPointsForCoverage(dataset, coverage) {
  return trackPointsFromIds(dataset, coverage?.trackPointIds || []);
}

function trackPointsFromIds(dataset, trackPointIds) {
  const index = trackPointIndex(dataset);
  return uniqueNumbers(trackPointIds).map((id) => index.get(id)).filter(Boolean);
}

function trackPointsForRawIds(dataset, coverage, rawPointIds) {
  const rawIds = new Set(rawPointIds);
  return trackPointsForCoverage(dataset, coverage)
    .filter((point) => trackPointRawIds(point).some((rawPointId) => rawIds.has(rawPointId)));
}

function rawPointIndex(dataset) {
  if (dataset?.rawPointById instanceof Map) return dataset.rawPointById;
  return new Map((dataset?.model?.points || []).map((point) => [point.rawPointId, point]));
}

function trackPointIndex(dataset) {
  if (dataset?.scenarioTrackPointById instanceof Map) return dataset.scenarioTrackPointById;
  const product = scenarioPolygonProduct(dataset);
  return new Map((product?.track || [])
    .map((point) => [point.trackPointId, point]));
}

function scenarioPolygonProduct(dataset) {
  return dataset?.scenarioProduct || dataset?.targetProduct || null;
}

function trackPointRawIds(point) {
  if (Array.isArray(point?.contributingRawPointIds) && point.contributingRawPointIds.length > 0) {
    return uniqueNumbers(point.contributingRawPointIds);
  }
  return [point?.sourceRawPointId ?? point?.rawPointId].filter(Number.isFinite);
}

function scenarioExplicitRawPointIds(scenario) {
  if (!scenario) return [];
  const ids = new Set();
  addNumbers(ids, scenario.anchorRawPointIds);
  addNumbers(ids, scenario.evidence?.rawPointIds);
  addNumbers(ids, scenario.evidence?.rejectedRawPointIds);
  addNumbers(ids, scenario.evidence?.keptRawPointIds);
  addNumbers(ids, scenario.evidence?.pendingRawPointIds);
  addNumbers(ids, [
    scenario.evidence?.startRawPointId,
    scenario.evidence?.endRawPointId,
    scenario.evidence?.turnRawPointId,
    scenario.evidence?.endpointRawPointId,
    scenario.evidence?.representativeRawPointId,
    scenario.evidence?.coreStartRawPointId,
    scenario.evidence?.coreEndRawPointId
  ]);
  return [...ids].sort((left, right) => left - right);
}

function addNumbers(target, values) {
  for (const value of values || []) {
    if (Number.isFinite(value)) target.add(value);
  }
}

function consecutiveIdRuns(ids) {
  const sorted = uniqueNumbers(ids).sort((left, right) => left - right);
  const runs = [];
  let current = [];
  for (const id of sorted) {
    if (current.length === 0 || id <= current.at(-1) + 1) {
      current.push(id);
    } else {
      runs.push(current);
      current = [id];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function limitPoints(points, limit = DEFAULT_POINT_LIMIT) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_POINT_LIMIT;
  if (!Array.isArray(points) || points.length <= safeLimit) return points || [];
  const extremes = extremeGeoPoints(points);
  const sampled = [];
  const lastIndex = points.length - 1;
  const sampleLimit = Math.max(0, safeLimit - extremes.length);
  for (let index = 0; index < sampleLimit; index++) {
    sampled.push(points[Math.round((index / Math.max(sampleLimit - 1, 1)) * lastIndex)]);
  }
  return uniqueGeoPoints([...extremes, ...sampled]).slice(0, safeLimit);
}

function extremeGeoPoints(points) {
  const candidates = [
    minBy(points, (point) => point.lat),
    maxBy(points, (point) => point.lat),
    minBy(points, (point) => point.lng),
    maxBy(points, (point) => point.lng)
  ].filter(Boolean);
  return uniqueGeoPoints(candidates);
}

function minBy(values, selector) {
  return values.reduce((best, value) =>
    best === null || selector(value) < selector(best) ? value : best, null);
}

function maxBy(values, selector) {
  return values.reduce((best, value) =>
    best === null || selector(value) > selector(best) ? value : best, null);
}

function uniqueNumbers(values) {
  return [...new Set((values || []).filter(Number.isFinite))];
}

function uniqueGeoPoints(points) {
  const seen = new Set();
  const unique = [];
  for (const point of points || []) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    const key = `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function projectionForPoints(points) {
  const centerLat = average(points.map((point) => point.lat));
  const centerLng = average(points.map((point) => point.lng));
  const lngScale = Math.max(1e-6,
    METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180));
  return {
    toMeters(point) {
      return {
        x: (point.lng - centerLng) * lngScale,
        y: (point.lat - centerLat) * METERS_PER_DEGREE_LAT
      };
    },
    toLngLat(point) {
      return [
        centerLng + point.x / lngScale,
        centerLat + point.y / METERS_PER_DEGREE_LAT
      ];
    }
  };
}

function projectedRingForHull(hull, projected, paddingMeters) {
  if (hull.length === 1) {
    return regularProjectedPolygon(hull[0], paddingMeters);
  }
  if (hull.length === 2 || polygonAreaMeters2(closeProjectedRing(hull)) < 1) {
    return lineProjectedPolygon(projected, paddingMeters);
  }
  return expandProjectedHull(hull, paddingMeters);
}

function regularProjectedPolygon(center, radiusMeters, sides = 16) {
  const points = [];
  for (let index = 0; index < sides; index++) {
    const angle = (index / sides) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * radiusMeters,
      y: center.y + Math.sin(angle) * radiusMeters
    });
  }
  return points;
}

function lineProjectedPolygon(projected, paddingMeters) {
  const [start, end] = farthestProjectedPair(projected);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return regularProjectedPolygon(start, paddingMeters);
  const nx = -dy / length;
  const ny = dx / length;
  return [
    { x: start.x + nx * paddingMeters, y: start.y + ny * paddingMeters },
    { x: end.x + nx * paddingMeters, y: end.y + ny * paddingMeters },
    { x: end.x - nx * paddingMeters, y: end.y - ny * paddingMeters },
    { x: start.x - nx * paddingMeters, y: start.y - ny * paddingMeters }
  ];
}

function farthestProjectedPair(points) {
  if (points.length <= 1) return [points[0], points[0]];
  let best = [points[0], points[1]];
  let bestDistance = -Infinity;
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      const distance = squaredDistance(points[left], points[right]);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = [points[left], points[right]];
      }
    }
  }
  return best;
}

function expandProjectedHull(hull, paddingMeters) {
  const center = projectedCentroid(hull);
  return hull.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) return point;
    const scale = (distance + paddingMeters) / distance;
    return {
      x: center.x + dx * scale,
      y: center.y + dy * scale
    };
  });
}

function convexHull(points) {
  const sorted = uniqueProjectedPoints(points)
    .sort((left, right) => left.x - right.x || left.y - right.y);
  if (sorted.length <= 1) return sorted;
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2
        && cross(lower.at(-2), lower.at(-1), point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2
        && cross(upper.at(-2), upper.at(-1), point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function uniqueProjectedPoints(points) {
  const seen = new Set();
  const unique = [];
  for (const point of points || []) {
    const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function cross(origin, left, right) {
  return (left.x - origin.x) * (right.y - origin.y)
    - (left.y - origin.y) * (right.x - origin.x);
}

function squaredDistance(left, right) {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function closeProjectedRing(points) {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points.at(-1);
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, { ...first }];
}

function polygonAreaMeters2(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let area = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    area += ring[index].x * ring[index + 1].y - ring[index + 1].x * ring[index].y;
  }
  return Math.abs(area) / 2;
}

function projectedCentroid(points) {
  return {
    x: average(points.map((point) => point.x)),
    y: average(points.map((point) => point.y))
  };
}

function polygonPaddingMeters(points, options) {
  const accuracies = points
    .map((point) => point.accuracy ?? point.horizontalAccuracyMeters)
    .filter((value) => Number.isFinite(value) && value > 0);
  const minPadding = options.minPaddingMeters ?? DEFAULT_MIN_PADDING_METERS;
  const maxPadding = options.maxPaddingMeters ?? DEFAULT_MAX_PADDING_METERS;
  const defaultPadding = options.defaultPaddingMeters ?? DEFAULT_PADDING_METERS;
  const fromAccuracy = accuracies.length > 0 ? median(accuracies) * 0.7 : defaultPadding;
  return clamp(fromAccuracy, minPadding, maxPadding);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTrackCoverage(coverage) {
  if (coverage?.continuousCoverage === true
      && Number.isFinite(coverage.trackPointRange?.startTrackPointId)
      && Number.isFinite(coverage.trackPointRange?.endTrackPointId)) {
    return `#${coverage.trackPointRange.startTrackPointId}-${coverage.trackPointRange.endTrackPointId}`;
  }
  const ids = coverage?.trackPointIds || [];
  if (ids.length > 0) return ids.slice(0, 6).join(', ');
  return '-';
}

function formatRawRange(range) {
  if (Number.isFinite(range?.startRawPointId) && Number.isFinite(range?.endRawPointId)) {
    return `Raw#${range.startRawPointId}-${range.endRawPointId}`;
  }
  return 'Raw#-';
}
