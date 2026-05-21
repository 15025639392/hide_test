const START_TOLERANCE_NANOS = 1_000_000_000;
const FIRST_FIX_GOOD_ACCURACY_METERS = 20;
const MOTION_WINDOW_NANOS = 5_000_000_000;
const EARTH_RADIUS_METERS = 6_371_000;
const MOTION_SUPPORTED_MIN_SPEED_METERS_PER_SECOND = 0.8;
const MOTION_SUPPORTED_MAX_SPEED_METERS_PER_SECOND = 3.5;
const MOTION_SUPPORTED_MIN_DISTANCE_METERS = 2.5;
const LOW_QUALITY_SEGMENT_MIN_DURATION_SECONDS = 60;
const LOW_QUALITY_SEGMENT_MIN_ACTIVE_RATIO = 0.7;
const LOW_QUALITY_SEGMENT_MIN_PLAUSIBLE_DISTANCE_METERS = 25;
const LOW_QUALITY_SEGMENT_MIN_MOVING_STEPS = 8;
const LOW_QUALITY_SEGMENT_MIN_BBOX_METERS = 25;
const LOW_QUALITY_SEGMENT_MIN_STEP_METERS = 1.8;
const LOW_QUALITY_SEGMENT_MAX_STEP_METERS = 10;
const LOW_QUALITY_SEGMENT_SIMPLIFY_TOLERANCE_METERS = 12;
const LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS = 35;
const LOW_ACCURACY_RESCUE_MIN_USED_IN_FIX = 5;
const LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS = 2.5;

export const DEFAULT_TARGET_PRODUCT_CONFIG = Object.freeze({
  maxIntakeAccuracyMeters: 80,
  weakCloudAccuracyMeters: 30,
  continuityRescueMaxAccuracyMeters: 650,
  continuityRescueMaxSpeedMetersPerSecond: 6,
  gapSeconds: 120,
  stationaryDistanceMeters: 5,
  stationaryAccuracyMultiplier: 1.5,
  impossibleSpeedMetersPerSecond: 12,
  transportSpeedMetersPerSecond: 3.5,
  transportMinDistanceMeters: 20,
  cloudTemporalDecaySeconds: 20,
  collapseStationarySession: true,
  stationarySessionStillRatio: 0.95,
  stationarySessionAnchorRatio: 0.8,
  barometerCleaningEnabled: false,
  barometerVerticalMotionMinRangeMeters: 3,
  barometerVerticalMotionMinWindowCount: 5
});

const DEFAULT_CLOUD_RULES = {
  START_CLOUD: { minSamples: 1, minWeight: 0.03, minRadius: 0, accuracyMultiplier: 1 },
  MOVING_CLOUD: { minSamples: 1, minWeight: 0.03, minRadius: 15, accuracyMultiplier: 1.5 },
  TRANSPORT_RISK_CLOUD: { minSamples: 1, minWeight: 0.03, minRadius: 15, accuracyMultiplier: 1.5 },
  STATIONARY_CLOUD: { minSamples: 2, minWeight: 0.08, minRadius: 8, accuracyMultiplier: 1.2 },
  RECOVERY_CLOUD: { minSamples: 2, minWeight: 0.08, minRadius: 12, accuracyMultiplier: 1.5 }
};

export function buildTargetTrackProduct(modelOrEvents, options = {}) {
  const config = normalizeConfig(options.config);
  const events = Array.isArray(modelOrEvents) ? modelOrEvents : modelOrEvents?.events || [];
  const sourceFilePath = Array.isArray(modelOrEvents) ? options.sourceFilePath || '' : modelOrEvents?.filePath || '';
  const evidence = buildEvidence(events);
  const engine = createTrackTrustEngine(config);
  const product = emptyProduct(evidence.strategyVersion, sourceFilePath,
    evidence.recordStartElapsedRealtimeNanos, evidence.recordEndElapsedRealtimeNanos);
  product.config = config;
  product.usesDefaultConfig = isDefaultConfig(config);
  let previousTrustedTrackPoint = null;
  let activeStationaryAnchor = null;
  let segmentId = 1;
  let trackPointId = 0;
  let decisionId = 0;
  let rawPointCount = 0;
  const engineEligibleRawPointIds = new Set();

  for (const rawPoint of evidence.rawPoints) {
    rawPointCount++;
    const epoch = findSamplingEpoch(rawPoint, evidence.samplingEpochs);
    const intake = acceptRawPoint(rawPoint, epoch, evidence, config);
    if (!intake.accepted && !canRescueContinuityPoint(rawPoint,
      previousTrustedTrackPoint, intake.reason, config)) {
      product.excluded.intakeRejected.push(excludedPoint(rawPoint, 'intake_rejected',
        intake.reason, epoch));
      continue;
    }

    engineEligibleRawPointIds.add(rawPoint.rawPointId);
    const snapshot = findGnssSnapshot(rawPoint, evidence.gnssById);
    const decision = engine.decide(rawPoint, epoch, snapshot, evidence.motionSummaries,
      previousTrustedTrackPoint);
    decisionId++;

    if (decision.result === 'anchor' || decision.result === 'accept') {
      if (isRedundantStationaryAnchor(rawPoint, decision, activeStationaryAnchor, config)) {
        product.excluded.rejected.push(excludedPoint(rawPoint, 'reject',
          'stationary_anchor_redundant', epoch, decision));
        continue;
      }
      if (isStationaryGapRecovery(rawPoint, decision, activeStationaryAnchor, config)) {
        product.excluded.rejected.push(excludedPoint(rawPoint, 'reject',
          'stationary_gap_recovery_jitter', epoch, decision));
        continue;
      }
      if (decision.startsNewSegment && previousTrustedTrackPoint) {
        segmentId++;
      }
      const targetPoint = {
        trackPointId: ++trackPointId,
        sourceRawPointId: rawPoint.rawPointId,
        recomputedDecisionId: decisionId,
        segmentId,
        lat: decision.cloudCenterLatitude,
        lng: decision.cloudCenterLongitude,
        elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
        timeMillis: rawPoint.timeMillis,
        result: decision.result,
        reason: decision.reason,
        distanceDeltaMeters: decision.distanceDeltaMeters,
        movingTimeDeltaSeconds: decision.movingTimeDeltaSeconds,
        cloudType: decision.cloudType,
        cloudId: decision.cloudId,
        cloudSampleCount: decision.cloudSampleCount,
        cloudWeightSum: decision.cloudWeightSum,
        cloudWeightedRadiusMeters: decision.cloudWeightedRadiusMeters,
        representativeRawPointId: decision.representativeRawPointId,
        contributingRawPointIds: decision.contributingRawPointIds,
        coordinateSource: decision.coordinateSource,
        virtualCoordinate: decision.coordinateSource !== 'raw'
      };
      product.track.push(targetPoint);
      previousTrustedTrackPoint = targetPoint;
      activeStationaryAnchor = decision.reason === 'stationary_anchor'
        ? targetPoint
        : null;
    } else if (decision.result === 'weak') {
      product.excluded.weak.push(excludedPoint(rawPoint, decision.result, decision.reason,
        epoch, decision));
    } else {
      product.excluded.rejected.push(excludedPoint(rawPoint, decision.result, decision.reason,
        epoch, decision));
    }
  }

  product.stats.rawPointCount = rawPointCount;
  recomputeProductStats(product);
  rebuildLowQualityMotionSegments(product, evidence, config, engineEligibleRawPointIds);
  pruneIsolatedStationaryMovement(product, config);
  pruneStationaryLowSpeedTail(product, config);
  collapseStationarySessionIfNeeded(product, evidence);
  product.findings = buildFindings(product, evidence);
  return product;
}

function isRedundantStationaryAnchor(rawPoint, decision, activeStationaryAnchor, config) {
  if (decision.reason !== 'stationary_anchor' || !activeStationaryAnchor) {
    return false;
  }
  const distance = distanceMeters(activeStationaryAnchor.lat, activeStationaryAnchor.lng,
    decision.cloudCenterLatitude, decision.cloudCenterLongitude);
  return distance <= stationaryThreshold(rawPoint, config);
}

function isStationaryGapRecovery(rawPoint, decision, activeStationaryAnchor, config) {
  if (decision.reason !== 'gap_recovery' || !activeStationaryAnchor) {
    return false;
  }
  const distance = distanceMeters(activeStationaryAnchor.lat, activeStationaryAnchor.lng,
    decision.cloudCenterLatitude, decision.cloudCenterLongitude);
  return distance <= stationaryThreshold(rawPoint, config);
}

function rebuildLowQualityMotionSegments(product, evidence, config, engineEligibleRawPointIds) {
  if (!Array.isArray(evidence.rawPoints) || evidence.rawPoints.length === 0) return;
  let changed = false;
  const rebuiltTrack = product.track.length > 0 ? [product.track[0]] : [];
  const reclassifiedRawPointIds = new Set();
  for (let index = 1; index < product.track.length; index++) {
    const point = product.track[index];
    const previous = rebuiltTrack.at(-1) || product.track[index - 1];
    if (point.reason !== 'moving_good_fix') {
      rebuiltTrack.push(point);
      continue;
    }
    const next = product.track[index + 1] || null;
    if (!previous || isTransportRiskReason(previous.reason) || isTransportRiskReason(point.reason)
        || isTransportRiskReason(next?.reason)) {
      rebuiltTrack.push(point);
      continue;
    }
    if (!next || !isLowQualityMotionBoundary(next)) {
      rebuiltTrack.push(point);
      continue;
    }
    const intervalEndNanos = next.elapsedRealtimeNanos;
    const nextContributingRawPointIds = new Set(next.contributingRawPointIds || []);
    const intervalRawPoints = evidence.rawPoints.filter((rawPoint) =>
      rawPoint.elapsedRealtimeNanos > previous.elapsedRealtimeNanos
      && rawPoint.elapsedRealtimeNanos < intervalEndNanos
      && engineEligibleRawPointIds.has(rawPoint.rawPointId)
      && Number.isFinite(rawPoint.accuracy)
      && rawPoint.accuracy <= config.weakCloudAccuracyMeters
      && !nextContributingRawPointIds.has(rawPoint.rawPointId));
    if (!intervalRawPoints.some((rawPoint) => rawPoint.rawPointId === point.sourceRawPointId)) {
      rebuiltTrack.push(point);
      continue;
    }
    const summary = summarizeLowQualityMotionInterval(intervalRawPoints, evidence.motionSummaries);
    if (!isLowQualityMotionSegment(summary)) {
      rebuiltTrack.push(point);
      continue;
    }
    const structureRawPoints = selectLowQualityMotionStructure(intervalRawPoints);
    if (structureRawPoints.length < 2) {
      rebuiltTrack.push(point);
      continue;
    }
    const rebuiltPoints = buildLowQualityMotionTrackPoints(point, previous,
      intervalRawPoints, structureRawPoints, summary);
    for (const rebuiltPoint of rebuiltPoints) {
      rebuiltTrack.push(rebuiltPoint);
    }
    for (const rawPoint of intervalRawPoints) {
      reclassifiedRawPointIds.add(rawPoint.rawPointId);
    }
    changed = true;
  }
  if (!changed) return;
  product.track = rebuiltTrack;
  removeExcludedRawPoints(product, reclassifiedRawPointIds);
  reconcileTrackSegments(product, config);
  renumberTrackPoints(product);
  recomputeProductStats(product);
}

function summarizeLowQualityMotionInterval(rawPoints, motionSummaries) {
  if (rawPoints.length === 0) {
    return {
      sampleCount: 0,
      durationSeconds: 0,
      activeRatio: 0,
      plausibleDistanceMeters: 0,
      movingStepCount: 0,
      maxAdjacentGapSeconds: 0,
      bboxDiagonalMeters: 0,
      rawPointIds: []
    };
  }
  let activeCount = 0;
  let plausibleDistanceMeters = 0;
  let movingStepCount = 0;
  let maxAdjacentGapSeconds = 0;
  let minLat = rawPoints[0].lat;
  let maxLat = rawPoints[0].lat;
  let minLng = rawPoints[0].lng;
  let maxLng = rawPoints[0].lng;
  for (let index = 0; index < rawPoints.length; index++) {
    const rawPoint = rawPoints[index];
    if (hasRecentActiveMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)) activeCount++;
    minLat = Math.min(minLat, rawPoint.lat);
    maxLat = Math.max(maxLat, rawPoint.lat);
    minLng = Math.min(minLng, rawPoint.lng);
    maxLng = Math.max(maxLng, rawPoint.lng);
    if (index === 0) continue;
    const previous = rawPoints[index - 1];
    const elapsedDelta = rawPoint.elapsedRealtimeNanos - previous.elapsedRealtimeNanos;
    if (elapsedDelta <= 0) continue;
    const elapsedSeconds = elapsedDelta / 1_000_000_000;
    maxAdjacentGapSeconds = Math.max(maxAdjacentGapSeconds, elapsedSeconds);
    if (elapsedDelta > 10_000_000_000) continue;
    const distance = distanceMeters(previous.lat, previous.lng, rawPoint.lat, rawPoint.lng);
    if (distance >= LOW_QUALITY_SEGMENT_MIN_STEP_METERS
        && distance <= LOW_QUALITY_SEGMENT_MAX_STEP_METERS) {
      plausibleDistanceMeters += distance;
      movingStepCount++;
    }
  }
  const first = rawPoints[0];
  const last = rawPoints.at(-1);
  return {
    sampleCount: rawPoints.length,
    durationSeconds: Math.max(0,
      (last.elapsedRealtimeNanos - first.elapsedRealtimeNanos) / 1_000_000_000),
    activeRatio: activeCount / rawPoints.length,
    plausibleDistanceMeters,
    movingStepCount,
    maxAdjacentGapSeconds,
    bboxDiagonalMeters: distanceMeters(minLat, minLng, maxLat, maxLng),
    rawPointIds: rawPoints.map((rawPoint) => rawPoint.rawPointId)
  };
}

function isLowQualityMotionBoundary(point) {
  return point.reason === 'stationary_anchor'
    || point.reason === 'gap_recovery'
    || point.reason === 'continuity_rescue_gap_recovery';
}

function isLowQualityMotionSegment(summary) {
  return summary.durationSeconds >= LOW_QUALITY_SEGMENT_MIN_DURATION_SECONDS
    && summary.activeRatio >= LOW_QUALITY_SEGMENT_MIN_ACTIVE_RATIO
    && summary.plausibleDistanceMeters >= LOW_QUALITY_SEGMENT_MIN_PLAUSIBLE_DISTANCE_METERS
    && summary.movingStepCount >= LOW_QUALITY_SEGMENT_MIN_MOVING_STEPS
    && summary.maxAdjacentGapSeconds <= 10
    && summary.bboxDiagonalMeters >= LOW_QUALITY_SEGMENT_MIN_BBOX_METERS;
}

function selectLowQualityMotionStructure(rawPoints) {
  const simplified = simplifyRawPoints(rawPoints, LOW_QUALITY_SEGMENT_SIMPLIFY_TOLERANCE_METERS);
  const selected = [];
  for (const rawPoint of simplified) {
    const previous = selected.at(-1);
    if (!previous || distanceMeters(previous.lat, previous.lng, rawPoint.lat, rawPoint.lng)
        >= MOTION_SUPPORTED_MIN_DISTANCE_METERS || rawPoint === simplified.at(-1)) {
      selected.push(rawPoint);
    }
  }
  return selected;
}

function buildLowQualityMotionTrackPoints(template, previousTrackPoint, rawPoints,
  structureRawPoints, summary) {
  const rawIndexById = new Map(rawPoints.map((rawPoint, index) => [rawPoint.rawPointId, index]));
  const points = [];
  let previousPoint = previousTrackPoint;
  let contributionStartIndex = 0;
  for (const rawPoint of structureRawPoints) {
    const rawIndex = rawIndexById.get(rawPoint.rawPointId);
    const contributingRawPointIds = rawPoints
      .slice(contributionStartIndex, Number.isFinite(rawIndex) ? rawIndex + 1 : contributionStartIndex)
      .map((point) => point.rawPointId);
    contributionStartIndex = Number.isFinite(rawIndex) ? rawIndex + 1 : contributionStartIndex;
    points.push({
      ...template,
      sourceRawPointId: rawPoint.rawPointId,
      lat: rawPoint.lat,
      lng: rawPoint.lng,
      elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
      timeMillis: rawPoint.timeMillis,
      result: 'accept',
      reason: 'motion_supported_low_quality',
      distanceDeltaMeters: distanceMeters(previousPoint.lat, previousPoint.lng,
        rawPoint.lat, rawPoint.lng),
      movingTimeDeltaSeconds: Math.max(0,
        (rawPoint.elapsedRealtimeNanos - previousPoint.elapsedRealtimeNanos) / 1_000_000_000),
      cloudType: 'LOW_QUALITY_MOTION',
      cloudSampleCount: summary.sampleCount,
      cloudWeightedRadiusMeters: summary.bboxDiagonalMeters,
      representativeRawPointId: rawPoint.rawPointId,
      contributingRawPointIds,
      coordinateSource: 'raw',
      virtualCoordinate: false
    });
    previousPoint = points.at(-1);
  }
  return points;
}

function simplifyRawPoints(rawPoints, toleranceMeters) {
  if (rawPoints.length <= 2) return rawPoints;
  const projected = projectRawPoints(rawPoints);
  const simplified = simplifyProjectedPoints(projected, toleranceMeters);
  return simplified.map((point) => point.rawPoint);
}

function projectRawPoints(rawPoints) {
  const origin = rawPoints[0];
  const originLatRad = radians(origin.lat);
  return rawPoints.map((rawPoint) => ({
    rawPoint,
    x: EARTH_RADIUS_METERS * radians(rawPoint.lng - origin.lng) * Math.cos(originLatRad),
    y: EARTH_RADIUS_METERS * radians(rawPoint.lat - origin.lat)
  }));
}

function simplifyProjectedPoints(points, toleranceMeters) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = perpendicularDistanceMeters(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= toleranceMeters) return [points[0], points.at(-1)];
  const left = simplifyProjectedPoints(points.slice(0, maxIndex + 1), toleranceMeters);
  const right = simplifyProjectedPoints(points.slice(maxIndex), toleranceMeters);
  return left.slice(0, -1).concat(right);
}

function perpendicularDistanceMeters(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y
    - lineEnd.y * lineStart.x) / Math.hypot(dx, dy);
}

function removeExcludedRawPoints(product, rawPointIds) {
  product.excluded.weak = product.excluded.weak
    .filter((point) => !rawPointIds.has(point.rawPointId));
  product.excluded.rejected = product.excluded.rejected
    .filter((point) => !rawPointIds.has(point.rawPointId));
  product.excluded.intakeRejected = product.excluded.intakeRejected
    .filter((point) => !rawPointIds.has(point.rawPointId));
}

function reconcileTrackSegments(product, config) {
  let segmentId = 1;
  let previous = null;
  for (const point of product.track) {
    if (previous) {
      const elapsedDelta = point.elapsedRealtimeNanos - previous.elapsedRealtimeNanos;
      const crossesGap = elapsedDelta > config.gapSeconds * 1_000_000_000;
      const suppressesSimplifiedLowQualityGap = previous.reason === 'motion_supported_low_quality'
        && point.reason === 'motion_supported_low_quality';
      const startsTransportRecovery = point.reason === 'recovery_transport_suspected_kept';
      if ((crossesGap && !suppressesSimplifiedLowQualityGap) || startsTransportRecovery) {
        segmentId++;
      }
      if (!crossesGap && point.reason === 'continuity_rescue_gap_recovery') {
        point.reason = 'gap_recovery';
      }
    }
    point.segmentId = segmentId;
    previous = point;
  }
}

function renumberTrackPoints(product) {
  product.track.forEach((point, index) => {
    point.trackPointId = index + 1;
  });
}

function pruneIsolatedStationaryMovement(product, config) {
  const prunedTrack = [];
  for (let index = 0; index < product.track.length; index++) {
    const point = product.track[index];
    const next = product.track[index + 1];
    if (point.reason === 'moving_good_fix'
        && next?.reason === 'stationary_anchor'
        && distanceMeters(point.lat, point.lng, next.lat, next.lng)
          <= Math.max(config.stationaryDistanceMeters, 10)) {
      product.excluded.rejected.push(trackPointAsRejected(point,
        'isolated_stationary_movement'));
      continue;
    }
    prunedTrack.push(point);
  }
  product.track = prunedTrack;
  recomputeProductStats(product);
}

function pruneStationaryLowSpeedTail(product, config) {
  const removeIndexes = new Map();
  const tailDistanceMeters = Math.max(config.stationaryDistanceMeters, 10);
  for (let index = 0; index < product.track.length; index++) {
    const anchor = product.track[index];
    if (anchor.reason !== 'stationary_anchor') continue;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const point = product.track[cursor];
      const reason = stationaryTailRejectReason(point);
      if (!reason) break;
      if (distanceMeters(point.lat, point.lng, anchor.lat, anchor.lng) > tailDistanceMeters) break;
      removeIndexes.set(cursor, reason);
    }
  }
  if (removeIndexes.size === 0) return;
  product.track = product.track.filter((point, index) => {
    if (!removeIndexes.has(index)) return true;
    product.excluded.rejected.push(trackPointAsRejected(point, removeIndexes.get(index)));
    return false;
  });
  recomputeProductStats(product);
}

function stationaryTailRejectReason(point) {
  if (point.reason === 'motion_supported_low_speed') return 'stationary_low_speed_tail';
  if (point.reason === 'continuity_rescue_low_accuracy') return 'stationary_low_accuracy_tail';
  return '';
}

function isTransportRiskReason(reason) {
  return reason === 'transport_suspected_kept'
    || reason === 'recovery_transport_suspected_kept';
}

function trackPointAsRejected(point, reason) {
  return {
    rawPointId: point.sourceRawPointId,
    lat: point.lat,
    lng: point.lng,
    elapsedRealtimeNanos: point.elapsedRealtimeNanos,
    result: 'reject',
    reason,
    samplingEpochId: null,
    cloudType: point.cloudType || '',
    cloudId: point.cloudId ?? null,
    cloudSampleCount: point.cloudSampleCount ?? 0,
    cloudWeightedRadiusMeters: point.cloudWeightedRadiusMeters ?? null
  };
}

function recomputeProductStats(product) {
  product.stats.routeDistanceMeters = routeDistanceMeters(product.track);
  product.stats.totalDistanceMeters = sumTrackField(product.track, 'distanceDeltaMeters');
  product.stats.suspectedDistanceMeters = product.track
    .filter((point) => isTransportRiskReason(point.reason))
    .reduce((sum, point) =>
      sum + (Number.isFinite(point.distanceDeltaMeters) ? point.distanceDeltaMeters : 0), 0);
  product.stats.movingTimeSeconds = recordDurationSeconds(product);
  product.stats.trustedPointCount = product.track.length;
  product.stats.weakPointCount = product.excluded.weak.length;
  product.stats.rejectedPointCount = product.excluded.rejected.length;
  product.stats.intakeRejectedPointCount = product.excluded.intakeRejected.length;
  const segmentCount = product.track.length === 0
    ? 0
    : new Set(product.track.map((point) => point.segmentId)).size;
  product.stats.segmentCount = segmentCount;
  product.stats.gapCount = Math.max(0, segmentCount - 1);
  product.stats.transportCount = product.track.filter((point) =>
    isTransportRiskReason(point.reason)).length;
}

function sumTrackField(track, field) {
  return track.reduce((sum, point) => sum + (Number.isFinite(point[field]) ? point[field] : 0), 0);
}

function routeDistanceMeters(track) {
  let total = 0;
  for (let index = 1; index < track.length; index++) {
    const previous = track[index - 1];
    const current = track[index];
    total += distanceMeters(previous.lat, previous.lng, current.lat, current.lng);
  }
  return total;
}

export function normalizeTargetProductConfig(config = {}) {
  return normalizeConfig(config);
}

function normalizeConfig(config = {}) {
  const merged = { ...DEFAULT_TARGET_PRODUCT_CONFIG, ...config };
  return {
    maxIntakeAccuracyMeters: positiveNumber(merged.maxIntakeAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.maxIntakeAccuracyMeters),
    weakCloudAccuracyMeters: positiveNumber(merged.weakCloudAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakCloudAccuracyMeters),
    continuityRescueMaxAccuracyMeters: positiveNumber(merged.continuityRescueMaxAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.continuityRescueMaxAccuracyMeters),
    continuityRescueMaxSpeedMetersPerSecond: positiveNumber(merged.continuityRescueMaxSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.continuityRescueMaxSpeedMetersPerSecond),
    gapSeconds: positiveNumber(merged.gapSeconds, DEFAULT_TARGET_PRODUCT_CONFIG.gapSeconds),
    stationaryDistanceMeters: positiveNumber(merged.stationaryDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryDistanceMeters),
    stationaryAccuracyMultiplier: positiveNumber(merged.stationaryAccuracyMultiplier, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryAccuracyMultiplier),
    impossibleSpeedMetersPerSecond: positiveNumber(merged.impossibleSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.impossibleSpeedMetersPerSecond),
    transportSpeedMetersPerSecond: positiveNumber(merged.transportSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.transportSpeedMetersPerSecond),
    transportMinDistanceMeters: positiveNumber(merged.transportMinDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.transportMinDistanceMeters),
    cloudTemporalDecaySeconds: positiveNumber(merged.cloudTemporalDecaySeconds, DEFAULT_TARGET_PRODUCT_CONFIG.cloudTemporalDecaySeconds),
    collapseStationarySession: merged.collapseStationarySession !== false,
    stationarySessionStillRatio: positiveNumber(merged.stationarySessionStillRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionStillRatio),
    stationarySessionAnchorRatio: positiveNumber(merged.stationarySessionAnchorRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionAnchorRatio),
    barometerCleaningEnabled: merged.barometerCleaningEnabled === true,
    barometerVerticalMotionMinRangeMeters: positiveNumber(merged.barometerVerticalMotionMinRangeMeters, DEFAULT_TARGET_PRODUCT_CONFIG.barometerVerticalMotionMinRangeMeters),
    barometerVerticalMotionMinWindowCount: positiveNumber(merged.barometerVerticalMotionMinWindowCount, DEFAULT_TARGET_PRODUCT_CONFIG.barometerVerticalMotionMinWindowCount)
  };
}

function collapseStationarySessionIfNeeded(product, evidence) {
  if (!product.config.collapseStationarySession || product.track.length <= 1) {
    return;
  }
  const stillRatio = stillMotionRatio(evidence.motionSummaries);
  const stationaryAnchorCount = product.track.filter((point) =>
    point.reason === 'stationary_anchor'
    || point.reason === 'first_fix_good'
    || point.reason === 'first_fix_relaxed').length;
  const stationaryAnchorRatio = stationaryAnchorCount / product.track.length;
  if (stillRatio < product.config.stationarySessionStillRatio
      || stationaryAnchorRatio < product.config.stationarySessionAnchorRatio) {
    return;
  }
  if (hasBarometerVerticalMotion(evidence, product.config)) {
    product.stationarySessionCollapseBlockedByBarometer = true;
    return;
  }
  const center = weightedTrackCenter(product.track);
  product.track = [{
    ...product.track[0],
    lat: center.lat,
    lng: center.lng,
    result: 'anchor',
    reason: 'stationary_session_anchor',
    segmentId: 1,
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'STATIONARY_SESSION',
    cloudId: null,
    cloudSampleCount: product.track.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId: center.representativeRawPointId,
    contributingRawPointIds: product.track.map((point) => point.sourceRawPointId),
    virtualCoordinate: true
  }];
  product.stats.routeDistanceMeters = 0;
  product.stats.totalDistanceMeters = 0;
  product.stats.suspectedDistanceMeters = 0;
  product.stats.movingTimeSeconds = recordDurationSeconds(product);
  product.stats.segmentCount = 1;
  product.stats.gapCount = 0;
  product.stats.transportCount = 0;
  product.stats.trustedPointCount = 1;
  product.stationarySessionCollapsed = true;
}

function stillMotionRatio(motionSummaries) {
  if (!Array.isArray(motionSummaries) || motionSummaries.length === 0) {
    return 0;
  }
  const stillCount = motionSummaries.filter((summary) =>
    summary.deviceStill === true || summary.isDeviceStill === true).length;
  return stillCount / motionSummaries.length;
}

function hasBarometerVerticalMotion(evidence, config) {
  if (!config.barometerCleaningEnabled) {
    return false;
  }
  const altitudeSamples = [];
  let validWindowCount = 0;
  for (const window of evidence.barometerWindows) {
    const values = [
      window.minRawAltitudeMeters,
      window.maxRawAltitudeMeters,
      window.avgRawAltitudeMeters
    ].filter(Number.isFinite);
    if (values.length === 0) continue;
    validWindowCount++;
    altitudeSamples.push(...values);
  }
  if (validWindowCount < config.barometerVerticalMotionMinWindowCount
      || altitudeSamples.length === 0) {
    return false;
  }
  return Math.max(...altitudeSamples) - Math.min(...altitudeSamples)
    >= config.barometerVerticalMotionMinRangeMeters;
}

function weightedTrackCenter(track) {
  let totalWeight = 0;
  let lat = 0;
  let lng = 0;
  for (const point of track) {
    const weight = Number.isFinite(point.cloudWeightSum) && point.cloudWeightSum > 0
      ? point.cloudWeightSum : 1;
    totalWeight += weight;
    lat += weight * point.lat;
    lng += weight * point.lng;
  }
  lat /= Math.max(totalWeight, 1e-9);
  lng /= Math.max(totalWeight, 1e-9);
  let radiusTotal = 0;
  let representativeRawPointId = track[0].sourceRawPointId;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of track) {
    const distance = distanceMeters(lat, lng, point.lat, point.lng);
    const weight = Number.isFinite(point.cloudWeightSum) && point.cloudWeightSum > 0
      ? point.cloudWeightSum : 1;
    radiusTotal += weight * distance * distance;
    if (distance < closestDistance) {
      closestDistance = distance;
      representativeRawPointId = point.sourceRawPointId;
    }
  }
  return {
    lat,
    lng,
    weight: totalWeight,
    radiusMeters: Math.sqrt(radiusTotal / Math.max(totalWeight, 1e-9)),
    representativeRawPointId
  };
}

function isDefaultConfig(config) {
  return Object.entries(DEFAULT_TARGET_PRODUCT_CONFIG)
    .every(([key, value]) => config[key] === value);
}

function buildEvidence(events) {
  const rawPoints = [];
  const gnssById = new Map();
  const samplingEpochs = [];
  const motionSummaries = [];
  const barometerWindows = [];
  let recordStartElapsedRealtimeNanos = null;
  let recordEndElapsedRealtimeNanos = null;
  let strategyVersion = 'stage2-track-trust-v3-sampling-cloud';

  for (const event of events) {
    if (event.event === 'session_metadata') {
      strategyVersion = String(event.strategyVersion || strategyVersion);
      recordStartElapsedRealtimeNanos = numberField(event, 'recordStartElapsedRealtimeNanos')
        ?? numberField(event, 'createdElapsedRealtimeNanos')
        ?? recordStartElapsedRealtimeNanos;
      recordEndElapsedRealtimeNanos = numberField(event, 'recordEndElapsedRealtimeNanos')
        ?? numberField(event, 'completedElapsedRealtimeNanos')
        ?? numberField(event, 'endedElapsedRealtimeNanos')
        ?? numberField(event, 'stoppedElapsedRealtimeNanos')
        ?? recordEndElapsedRealtimeNanos;
    } else if (event.event === 'raw_location') {
      rawPoints.push(normalizeRawPoint(event));
    } else if (event.event === 'gnss_snapshot') {
      const id = numberField(event, 'snapshotId');
      if (id !== null) gnssById.set(id, event);
    } else if (event.event === 'sampling_policy') {
      samplingEpochs.push(normalizeSamplingEpoch(event, samplingEpochs.length + 1));
    } else if (event.event === 'device_motion_window') {
      motionSummaries.push(deviceMotionWindowAsMotionEvidence(event));
    } else if (event.event === 'barometer_window') {
      barometerWindows.push(normalizeBarometerWindow(event));
    }
  }

  rawPoints.sort(compareRawPointTime);
  samplingEpochs.sort((a, b) => a.startedElapsedRealtimeNanos - b.startedElapsedRealtimeNanos);
  if (recordStartElapsedRealtimeNanos === null && rawPoints.length > 0) {
    recordStartElapsedRealtimeNanos = rawPoints[0].elapsedRealtimeNanos;
  }
  if (recordEndElapsedRealtimeNanos === null && rawPoints.length > 0) {
    recordEndElapsedRealtimeNanos = rawPoints.at(-1).elapsedRealtimeNanos;
  }
  return {
    rawPoints,
    gnssById,
    samplingEpochs,
    motionSummaries,
    barometerWindows,
    recordStartElapsedRealtimeNanos,
    recordEndElapsedRealtimeNanos,
    strategyVersion
  };
}

function normalizeRawPoint(event) {
  return {
    ...event,
    rawPointId: numberField(event, 'rawPointId'),
    provider: String(event.provider || ''),
    lat: numberField(event, 'lat'),
    lng: numberField(event, 'lng'),
    accuracy: numberField(event, 'accuracy'),
    speed: numberField(event, 'speed'),
    hasSpeed: event.hasSpeed === true || numberField(event, 'speed') !== null,
    timeMillis: numberField(event, 'timeMillis'),
    elapsedRealtimeNanos: numberField(event, 'elapsedRealtimeNanos'),
    sourceGnssSnapshotId: numberField(event, 'sourceGnssSnapshotId'),
    samplingEpochId: numberField(event, 'samplingEpochId'),
    mock: event.mock === true || event.isMock === true
  };
}

function deviceMotionWindowAsMotionEvidence(event) {
  const linearSampleCount = numberField(event, 'linearAccelerationSampleCount') ?? 0;
  const accelRms = linearSampleCount > 0
    ? numberField(event, 'linearAccelerationRmsMps2') ?? 0
    : numberField(event, 'accelerometerDynamicRmsMps2') ?? 0;
  const gyroRms = numberField(event, 'gyroscopeRmsRadps') ?? 0;
  const stepDelta = numberField(event, 'stepCounterDelta') ?? 0;
  const stepDetectorCount = numberField(event, 'stepDetectorCount') ?? 0;
  return {
    event: 'device_motion_window',
    firstElapsedRealtimeNanos: numberField(event, 'startElapsedRealtimeNanos'),
    lastElapsedRealtimeNanos: numberField(event, 'endElapsedRealtimeNanos'),
    sampleCount: (numberField(event, 'linearAccelerationSampleCount') ?? 0)
      + (numberField(event, 'accelerometerSampleCount') ?? 0)
      + (numberField(event, 'gyroscopeSampleCount') ?? 0)
      + (numberField(event, 'rotationVectorSampleCount') ?? 0),
    dynamicAccelRmsMps2: accelRms,
    gyroscopeRmsRadps: gyroRms,
    stepDelta,
    stepDetectorCount,
    isDeviceStill: accelRms <= 0.18 && gyroRms <= 0.08
      && stepDelta === 0 && stepDetectorCount === 0,
    evidenceSource: 'device_motion_window'
  };
}

function normalizeBarometerWindow(event) {
  return {
    event: 'barometer_window',
    startElapsedRealtimeNanos: numberField(event, 'startElapsedRealtimeNanos'),
    endElapsedRealtimeNanos: numberField(event, 'endElapsedRealtimeNanos'),
    avgRawAltitudeMeters: numberField(event, 'avgRawAltitudeMeters'),
    minRawAltitudeMeters: numberField(event, 'minRawAltitudeMeters'),
    maxRawAltitudeMeters: numberField(event, 'maxRawAltitudeMeters')
  };
}

function normalizeSamplingEpoch(event, fallbackId) {
  const id = numberField(event, 'samplingEpochId')
    ?? numberField(event, 'epochId')
    ?? fallbackId;
  return {
    samplingEpochId: id,
    state: String(event.samplingState || event.state || event.locationRequestState || 'MOVING'),
    minTimeMs: numberField(event, 'locationRequestMinTimeMs') ?? numberField(event, 'minTimeMs') ?? 0,
    minDistanceMeters: numberField(event, 'locationRequestMinDistanceMeters')
      ?? numberField(event, 'minDistanceMeters') ?? 0,
    startedElapsedRealtimeNanos: numberField(event, 'startedElapsedRealtimeNanos')
      ?? numberField(event, 'locationRequestRegisteredElapsedRealtimeNanos')
      ?? numberField(event, 'eventElapsedRealtimeNanos')
      ?? 0
  };
}

function findSamplingEpoch(rawPoint, samplingEpochs) {
  if (rawPoint.samplingEpochId !== null) {
    return samplingEpochs.find((epoch) => epoch.samplingEpochId === rawPoint.samplingEpochId)
      || syntheticEpoch(rawPoint.samplingEpochId, rawPoint.elapsedRealtimeNanos);
  }
  let best = null;
  for (const epoch of samplingEpochs) {
    if (rawPoint.elapsedRealtimeNanos !== null
        && epoch.startedElapsedRealtimeNanos <= rawPoint.elapsedRealtimeNanos) {
      best = epoch;
    }
  }
  if (best) return best;
  if (samplingEpochs.length === 0 && rawPoint.elapsedRealtimeNanos !== null) {
    return syntheticEpoch(1, rawPoint.elapsedRealtimeNanos);
  }
  return null;
}

function syntheticEpoch(id, elapsedRealtimeNanos) {
  return {
    samplingEpochId: id,
    state: 'MOVING',
    minTimeMs: 0,
    minDistanceMeters: 0,
    startedElapsedRealtimeNanos: elapsedRealtimeNanos ?? 0,
    synthetic: true
  };
}

function acceptRawPoint(rawPoint, epoch, evidence, config) {
  if (!epoch) return reject('sampling_contract_violation');
  if (!rawPoint) return reject('invalid_location');
  if (!hasPositionSource(rawPoint)) return reject('missing_position_source');
  if (rawPoint.mock) return reject('mock_location');
  if (!Number.isFinite(rawPoint.elapsedRealtimeNanos) || rawPoint.elapsedRealtimeNanos <= 0) {
    return reject('missing_fix_elapsed_realtime');
  }
  if (evidence.recordStartElapsedRealtimeNanos !== null
      && rawPoint.elapsedRealtimeNanos < evidence.recordStartElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return reject('before_record_start');
  }
  if (rawPoint.elapsedRealtimeNanos < epoch.startedElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return reject('sampling_epoch_mismatch');
  }
  if (!validCoordinate(rawPoint.lat, rawPoint.lng)) return reject('invalid_coordinate');
  if (!Number.isFinite(rawPoint.accuracy) || rawPoint.accuracy <= 0) {
    return reject('invalid_accuracy');
  }
  if (rawPoint.accuracy > config.maxIntakeAccuracyMeters) return reject('accuracy_too_large');
  const key = `${epoch.samplingEpochId}|${rawPoint.provider}|${rawPoint.elapsedRealtimeNanos}|${rawPoint.lat.toFixed(7)}|${rawPoint.lng.toFixed(7)}|${rawPoint.accuracy.toFixed(2)}`;
  evidence.acceptedFixKeys ||= new Set();
  if (evidence.acceptedFixKeys.has(key)) return reject('duplicate_fix');
  if (Number.isFinite(evidence.lastAcceptedFixElapsedRealtimeNanos)
      && rawPoint.elapsedRealtimeNanos <= evidence.lastAcceptedFixElapsedRealtimeNanos) {
    return reject('out_of_order_fix');
  }
  evidence.acceptedFixKeys.add(key);
  evidence.lastAcceptedFixElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
  return { accepted: true, reason: '' };
}

function hasPositionSource(rawPoint) {
  return nonEmptyString(rawPoint.provider)
    || nonEmptyString(rawPoint.source)
    || nonEmptyString(rawPoint.sourceKind)
    || nonEmptyString(rawPoint.trustClass);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function reject(reason) {
  return { accepted: false, reason };
}

function findGnssSnapshot(rawPoint, gnssById) {
  return rawPoint.sourceGnssSnapshotId !== null ? gnssById.get(rawPoint.sourceGnssSnapshotId) || null : null;
}

function createTrackTrustEngine(config) {
  let nextCloudId = 1;
  let currentCloud = null;
  let currentCloudType = '';
  let resetMovingCloudAfterAccept = false;
  let recoveryPreviousRawPoint = null;

  return {
    decide(rawPoint, epoch, snapshot, motionSummaries, previousTrustedTrackPoint) {
      const cloudType = chooseCloudType(rawPoint, epoch, previousTrustedTrackPoint, config);
      if (cloudType !== currentCloudType
          || currentCloud === null
          || currentCloud.samplingEpochId !== epoch.samplingEpochId
          || ((cloudType === 'MOVING_CLOUD' || cloudType === 'TRANSPORT_RISK_CLOUD')
            && resetMovingCloudAfterAccept)) {
        currentCloud = new TrackCloudWindow(nextCloudId++, cloudType, epoch.samplingEpochId, config);
        currentCloudType = cloudType;
        if (cloudType === 'MOVING_CLOUD' || cloudType === 'TRANSPORT_RISK_CLOUD') {
          resetMovingCloudAfterAccept = false;
        }
        recoveryPreviousRawPoint = null;
      }

      const cloud = currentCloud.add(rawPoint, snapshot, motionSummaries);
      const stable = currentCloud.isStable()
        || (cloudType === 'RECOVERY_CLOUD'
          && currentCloud.recoveryFastPath()
          && recoveryFastPathAllowed(rawPoint, previousTrustedTrackPoint, config));
      let result;
      let reason;
      let startsNewSegment = false;
      let distanceDeltaMeters = 0;
      let movingTimeDeltaSeconds = 0;

      if (cloudType === 'START_CLOUD') {
        result = 'anchor';
        reason = rawPoint.accuracy <= FIRST_FIX_GOOD_ACCURACY_METERS
          ? 'first_fix_good' : 'first_fix_relaxed';
      } else if (cloudType === 'RECOVERY_CLOUD') {
        if (isRecoveryTransportRescuePoint(rawPoint, recoveryPreviousRawPoint, config)) {
          result = 'accept';
          reason = 'recovery_transport_suspected_kept';
          startsNewSegment = previousTrustedTrackPoint !== null
            && recoveryPreviousRawPoint !== null
            && previousTrustedTrackPoint.elapsedRealtimeNanos < recoveryPreviousRawPoint.elapsedRealtimeNanos;
        } else if (stable) {
          result = 'accept';
          reason = 'gap_recovery';
          startsNewSegment = previousTrustedTrackPoint !== null;
        } else if (isRecoveryContinuityRescuePoint(rawPoint, recoveryPreviousRawPoint, config)) {
          result = 'accept';
          reason = 'continuity_rescue_gap_recovery';
          startsNewSegment = previousTrustedTrackPoint !== null;
        } else {
          result = 'weak';
          reason = 'recovery_cloud_pending';
        }
      } else if (cloudType === 'WEAK_CLOUD') {
        if (isLowAccuracyRescuePoint(rawPoint, previousTrustedTrackPoint, snapshot, config)) {
          result = 'accept';
          reason = 'continuity_rescue_low_accuracy';
          resetMovingCloudAfterAccept = true;
          if (previousTrustedTrackPoint) {
            distanceDeltaMeters = distanceMeters(previousTrustedTrackPoint.lat,
              previousTrustedTrackPoint.lng, cloud.centerLatitude, cloud.centerLongitude);
            movingTimeDeltaSeconds = Math.max(0,
              (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000);
          }
        } else {
          result = 'weak';
          reason = 'weak_signal_stage2';
        }
      } else if (cloudType === 'STATIONARY_CLOUD') {
        if (stable && hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)) {
          result = 'anchor';
          reason = 'stationary_anchor';
        } else if (hasRecentActiveMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)
            && isMotionSupportedLowSpeedPoint(rawPoint, previousTrustedTrackPoint, config)) {
          result = 'accept';
          reason = 'motion_supported_low_speed';
          resetMovingCloudAfterAccept = true;
        } else if (!hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)
            && isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint, config)) {
          result = 'reject';
          reason = 'stationary_continuity_jitter';
          resetMovingCloudAfterAccept = true;
        } else {
          result = 'reject';
          reason = 'stationary_cloud_jitter';
        }
      } else if (cloudType === 'TRANSPORT_RISK_CLOUD') {
        result = 'accept';
        reason = 'transport_suspected_kept';
        resetMovingCloudAfterAccept = true;
        if (previousTrustedTrackPoint) {
          distanceDeltaMeters = distanceMeters(previousTrustedTrackPoint.lat,
            previousTrustedTrackPoint.lng, cloud.centerLatitude, cloud.centerLongitude);
          movingTimeDeltaSeconds = Math.max(0,
            (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000);
        }
      } else if (stable) {
        result = 'accept';
        reason = 'moving_good_fix';
        resetMovingCloudAfterAccept = true;
        if (previousTrustedTrackPoint) {
          distanceDeltaMeters = distanceMeters(previousTrustedTrackPoint.lat,
            previousTrustedTrackPoint.lng, cloud.centerLatitude, cloud.centerLongitude);
          movingTimeDeltaSeconds = Math.max(0,
            (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000);
        }
      } else {
        result = 'weak';
        reason = 'moving_cloud_unstable';
      }

      if (cloudType === 'RECOVERY_CLOUD') {
        recoveryPreviousRawPoint = rawPoint;
      }
      const targetCoordinate = targetCoordinateForDecision(rawPoint, cloud, reason);
      if ((result === 'accept' || result === 'anchor')
          && previousTrustedTrackPoint
          && !startsNewSegment
          && shouldAccumulateMovement(reason)) {
        distanceDeltaMeters = distanceMeters(previousTrustedTrackPoint.lat,
          previousTrustedTrackPoint.lng, targetCoordinate.lat, targetCoordinate.lng);
        movingTimeDeltaSeconds = Math.max(0,
          (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000);
      }

      return {
        result,
        reason,
        cloudType,
        cloudId: cloud.cloudId,
        cloudSampleCount: cloud.sampleCount,
        cloudWeightSum: cloud.weightSum,
        cloudWeightedRadiusMeters: cloud.weightedRadiusMeters,
        cloudCenterLatitude: targetCoordinate.lat,
        cloudCenterLongitude: targetCoordinate.lng,
        coordinateSource: targetCoordinate.source,
        representativeRawPointId: cloud.representativeRawPointId,
        contributingRawPointIds: cloud.contributingRawPointIds,
        startsNewSegment,
        distanceDeltaMeters,
        movingTimeDeltaSeconds
      };
    }
  };
}

function chooseCloudType(rawPoint, epoch, previousTrustedTrackPoint, config) {
  if (!previousTrustedTrackPoint) {
    return rawPoint.accuracy > config.weakCloudAccuracyMeters ? 'WEAK_CLOUD' : 'START_CLOUD';
  }
  const elapsedDelta = rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos;
  const deltaSeconds = elapsedDelta / 1_000_000_000;
  if (elapsedDelta > config.gapSeconds * 1_000_000_000) return 'RECOVERY_CLOUD';
  if (rawPoint.accuracy > config.weakCloudAccuracyMeters) return 'WEAK_CLOUD';
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  if (epoch?.state === 'PAUSED') {
    return distance < stationaryThreshold(rawPoint, config) ? 'STATIONARY_CLOUD' : 'RECOVERY_CLOUD';
  }
  if (deltaSeconds > 0) {
    const speed = distance / deltaSeconds;
    if (isTransportRisk(rawPoint, speed, distance, config)) {
      return 'TRANSPORT_RISK_CLOUD';
    }
    if (speed > config.impossibleSpeedMetersPerSecond) return 'WEAK_CLOUD';
  }
  if (distance < stationaryThreshold(rawPoint, config)) return 'STATIONARY_CLOUD';
  return 'MOVING_CLOUD';
}

function isTransportRisk(rawPoint, derivedSpeedMetersPerSecond, distance, config) {
  if (derivedSpeedMetersPerSecond < config.transportSpeedMetersPerSecond
      && (!rawPoint.hasSpeed || rawPoint.speed < config.transportSpeedMetersPerSecond)) {
    return false;
  }
  if (distance >= config.transportMinDistanceMeters) return true;
  return rawPoint.hasSpeed
    && rawPoint.speed >= config.transportSpeedMetersPerSecond
    && distance >= stationaryThreshold(rawPoint, config);
}

function canRescueContinuityPoint(rawPoint, previousTrustedTrackPoint, intakeReason, config) {
  return intakeReason === 'accuracy_too_large'
    && isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint, config);
}

function isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint, config) {
  if (!previousTrustedTrackPoint) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.continuityRescueMaxAccuracyMeters) {
    return false;
  }
  const elapsedDelta = rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos;
  if (elapsedDelta <= 0 || elapsedDelta > config.gapSeconds * 1_000_000_000) return false;
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  const speed = distance / (elapsedDelta / 1_000_000_000);
  return speed <= config.continuityRescueMaxSpeedMetersPerSecond
    || (rawPoint.hasSpeed && rawPoint.speed <= config.continuityRescueMaxSpeedMetersPerSecond);
}

function isLowAccuracyRescuePoint(rawPoint, previousTrustedTrackPoint, snapshot, config) {
  if (!isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint, config)) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS) {
    return false;
  }
  const usedInFixTotal = numberField(snapshot, 'usedInFixTotal') ?? 0;
  if (usedInFixTotal < LOW_ACCURACY_RESCUE_MIN_USED_IN_FIX) return false;
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  return distance >= LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS;
}

function isRecoveryContinuityRescuePoint(rawPoint, previousRawPoint, config) {
  if (!previousRawPoint) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.continuityRescueMaxAccuracyMeters) {
    return false;
  }
  const elapsedDelta = rawPoint.elapsedRealtimeNanos - previousRawPoint.elapsedRealtimeNanos;
  if (elapsedDelta <= 0 || elapsedDelta > config.gapSeconds * 1_000_000_000) return false;
  const distance = distanceMeters(previousRawPoint.lat, previousRawPoint.lng, rawPoint.lat, rawPoint.lng);
  const speed = distance / (elapsedDelta / 1_000_000_000);
  return speed <= config.continuityRescueMaxSpeedMetersPerSecond
    || (rawPoint.hasSpeed && rawPoint.speed <= config.continuityRescueMaxSpeedMetersPerSecond);
}

function isRecoveryTransportRescuePoint(rawPoint, previousRawPoint, config) {
  if (!previousRawPoint) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.maxIntakeAccuracyMeters) {
    return false;
  }
  const elapsedDelta = rawPoint.elapsedRealtimeNanos - previousRawPoint.elapsedRealtimeNanos;
  if (elapsedDelta <= 0 || elapsedDelta > config.gapSeconds * 1_000_000_000) return false;
  const distance = distanceMeters(previousRawPoint.lat, previousRawPoint.lng, rawPoint.lat, rawPoint.lng);
  const speed = distance / (elapsedDelta / 1_000_000_000);
  return isTransportRisk(rawPoint, speed, distance, config);
}

function targetCoordinateForDecision(rawPoint, cloud, reason) {
  if (usesRawCoordinate(reason)) {
    return { lat: rawPoint.lat, lng: rawPoint.lng, source: 'raw' };
  }
  return { lat: cloud.centerLatitude, lng: cloud.centerLongitude, source: 'cloud_center' };
}

function usesRawCoordinate(reason) {
  return reason === 'moving_good_fix'
    || reason === 'transport_suspected_kept'
    || reason === 'recovery_transport_suspected_kept'
    || reason === 'motion_supported_low_speed'
    || reason === 'motion_supported_low_quality'
    || reason === 'gap_recovery'
    || reason?.startsWith('continuity_rescue_');
}

function shouldAccumulateMovement(reason) {
  return reason === 'moving_good_fix'
    || reason === 'transport_suspected_kept'
    || reason === 'recovery_transport_suspected_kept'
    || reason === 'continuity_rescue_low_accuracy'
    || reason === 'motion_supported_low_speed'
    || reason === 'motion_supported_low_quality';
}

function recoveryFastPathAllowed(rawPoint, previousTrustedTrackPoint, config) {
  if (!previousTrustedTrackPoint) return true;
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  return distance >= stationaryThreshold(rawPoint, config);
}

class TrackCloudWindow {
  constructor(cloudId, cloudType, samplingEpochId, config) {
    this.cloudId = cloudId;
    this.cloudType = cloudType;
    this.samplingEpochId = samplingEpochId;
    this.samples = [];
    this.origin = null;
    this.config = config;
  }

  add(rawPoint, snapshot, motionSummaries) {
    if (!this.origin) this.origin = rawPoint;
    this.samples.push({
      rawPoint,
      snapshot,
      recentStillMotion: hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)
    });
    return this.snapshot();
  }

  snapshot() {
    if (this.samples.length === 0 || !this.origin) {
      return emptyCloudSnapshot(this.cloudId, this.cloudType, this.samplingEpochId);
    }
    const latestElapsed = Math.max(...this.samples.map((sample) => sample.rawPoint.elapsedRealtimeNanos));
    const originLatRad = radians(this.origin.lat);
    const projected = this.samples.map((sample) => {
      const x = EARTH_RADIUS_METERS * Math.cos(originLatRad)
        * radians(sample.rawPoint.lng - this.origin.lng);
      const y = EARTH_RADIUS_METERS * radians(sample.rawPoint.lat - this.origin.lat);
      return { sample, x, y, baseWeight: this.baseWeight(sample, latestElapsed) };
    });
    const initial = weightedCenter(projected, 'baseWeight');
    const weighted = projected.map((item) => {
      const initialDistance = Math.hypot(item.x - initial.x, item.y - initial.y);
      return {
        ...item,
        weight: item.baseWeight * this.spatialWeight(initialDistance, item.sample.rawPoint.accuracy)
      };
    });
    const center = weightedCenter(weighted, 'weight');
    const centerLatitude = this.origin.lat + degrees(center.y / EARTH_RADIUS_METERS);
    const centerLongitude = this.origin.lng
      + degrees(center.x / (EARTH_RADIUS_METERS * Math.cos(originLatRad)));
    let radiusTotal = 0;
    let representativeRawPointId = this.samples[this.samples.length - 1].rawPoint.rawPointId;
    let closestDistance = Number.POSITIVE_INFINITY;
    const contributingRawPointIds = [];
    for (const item of weighted) {
      const distance = distanceMeters(item.sample.rawPoint.lat, item.sample.rawPoint.lng,
        centerLatitude, centerLongitude);
      radiusTotal += item.weight * distance * distance;
      contributingRawPointIds.push(item.sample.rawPoint.rawPointId);
      if (distance < closestDistance) {
        closestDistance = distance;
        representativeRawPointId = item.sample.rawPoint.rawPointId;
      }
    }
    return {
      cloudId: this.cloudId,
      cloudType: this.cloudType,
      samplingEpochId: this.samplingEpochId,
      sampleCount: this.samples.length,
      weightSum: center.weight,
      weightedRadiusMeters: Math.sqrt(radiusTotal / Math.max(center.weight, 1e-9)),
      centerLatitude,
      centerLongitude,
      representativeRawPointId,
      contributingRawPointIds
    };
  }

  isStable() {
    const snapshot = this.snapshot();
    const rule = DEFAULT_CLOUD_RULES[this.cloudType] || DEFAULT_CLOUD_RULES.STATIONARY_CLOUD;
    if (snapshot.sampleCount < rule.minSamples || snapshot.weightSum < rule.minWeight) {
      return false;
    }
    if (this.cloudType === 'START_CLOUD') return true;
    return snapshot.weightedRadiusMeters <= this.radiusThreshold();
  }

  recoveryFastPath() {
    if (this.cloudType !== 'RECOVERY_CLOUD' || this.samples.length !== 1) return false;
    const sample = this.samples[0];
    return sample.rawPoint.accuracy <= 10
      && scoreFromGnss(sample.snapshot) >= 80
      && (!sample.rawPoint.hasSpeed || sample.rawPoint.speed <= 2.5);
  }

  baseWeight(sample, latestElapsed) {
    const accuracyWeight = clamp(1 / Math.max(sample.rawPoint.accuracy, 3), 0.01, 0.33);
    const gnssWeightValue = gnssWeight(sample.snapshot);
    const motionWeightValue = Math.max(0.25,
      scoreFromMotion(this.cloudType, sample.rawPoint, sample.recentStillMotion) / 100);
    const ageSeconds = Math.max(0,
      (latestElapsed - sample.rawPoint.elapsedRealtimeNanos) / 1_000_000_000);
    const temporalWeight = Math.exp(-ageSeconds / this.config.cloudTemporalDecaySeconds);
    return accuracyWeight * gnssWeightValue * motionWeightValue * temporalWeight;
  }

  spatialWeight(distanceMetersValue, accuracyMeters) {
    const cloudRadius = this.radiusThreshold();
    if (distanceMetersValue <= cloudRadius) return 1;
    if (distanceMetersValue <= Math.max(cloudRadius, accuracyMeters * 1.5)) return 0.5;
    return 0.1;
  }

  radiusThreshold() {
    const rule = DEFAULT_CLOUD_RULES[this.cloudType] || DEFAULT_CLOUD_RULES.STATIONARY_CLOUD;
    return Math.max(rule.minRadius, median(this.samples.map((sample) => sample.rawPoint.accuracy))
      * rule.accuracyMultiplier);
  }
}

function weightedCenter(items, weightField) {
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const item of items) {
    const itemWeight = item[weightField];
    weight += itemWeight;
    x += itemWeight * item.x;
    y += itemWeight * item.y;
  }
  if (weight <= 0) return { weight: 1, x: 0, y: 0 };
  return { weight, x: x / weight, y: y / weight };
}

function emptyCloudSnapshot(cloudId, cloudType, samplingEpochId) {
  return {
    cloudId,
    cloudType,
    samplingEpochId,
    sampleCount: 0,
    weightSum: 0,
    weightedRadiusMeters: 0,
    centerLatitude: 0,
    centerLongitude: 0,
    representativeRawPointId: null,
    contributingRawPointIds: []
  };
}

function scoreFromGnss(snapshot) {
  if (!snapshot) return 25;
  const used = numberField(snapshot, 'usedInFixTotal') ?? 0;
  const top4 = numberField(snapshot, 'top4AvgCn0') ?? 0;
  if (used >= 8 && top4 >= 28) return 100;
  if (used >= 5 && top4 >= 22) return 70;
  if (used >= 3) return 40;
  return 25;
}

function gnssWeight(snapshot) {
  const score = scoreFromGnss(snapshot);
  if (score >= 80) return 1;
  if (score >= 60) return 0.7;
  if (score >= 35) return 0.4;
  return 0.25;
}

function scoreFromMotion(cloudType, rawPoint, recentStillMotion) {
  const still = recentStillMotion === true;
  if (cloudType === 'STATIONARY_CLOUD') return still ? 100 : 50;
  if (cloudType === 'MOVING_CLOUD') return rawPoint.hasSpeed && rawPoint.speed > 0.5 ? 100 : 70;
  if (cloudType === 'RECOVERY_CLOUD') {
    return still && (!rawPoint.hasSpeed || rawPoint.speed <= 0.5) ? 80 : 70;
  }
  return 50;
}

function hasRecentStillMotion(elapsedRealtimeNanos, motionSummaries) {
  if (!Array.isArray(motionSummaries)) return false;
  const cutoff = elapsedRealtimeNanos - MOTION_WINDOW_NANOS;
  let total = 0;
  let still = 0;
  for (const summary of motionSummaries) {
    const first = numberField(summary, 'firstElapsedRealtimeNanos');
    const last = numberField(summary, 'lastElapsedRealtimeNanos');
    if (first === null || last === null || last < cutoff || first > elapsedRealtimeNanos) continue;
    total++;
    if (summary.deviceStill === true || summary.isDeviceStill === true) still++;
  }
  return total > 0 && still / total >= 0.75;
}

function hasRecentActiveMotion(elapsedRealtimeNanos, motionSummaries) {
  if (!Array.isArray(motionSummaries)) return false;
  const cutoff = elapsedRealtimeNanos - MOTION_WINDOW_NANOS;
  let total = 0;
  let active = 0;
  for (const summary of motionSummaries) {
    const first = numberField(summary, 'firstElapsedRealtimeNanos');
    const last = numberField(summary, 'lastElapsedRealtimeNanos');
    if (first === null || last === null || last < cutoff || first > elapsedRealtimeNanos) continue;
    total++;
    const accel = numberField(summary, 'dynamicAccelRmsMps2') ?? 0;
    const gyro = numberField(summary, 'gyroscopeRmsRadps') ?? 0;
    const stepDelta = numberField(summary, 'stepDelta') ?? 0;
    const stepDetectorCount = numberField(summary, 'stepDetectorCount') ?? 0;
    if (accel >= 0.35 || gyro >= 0.12 || stepDelta > 0 || stepDetectorCount > 0) {
      active++;
    }
  }
  return total > 0 && active / total >= 0.5;
}

function isMotionSupportedLowSpeedPoint(rawPoint, previousTrustedTrackPoint, config) {
  if (!previousTrustedTrackPoint) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.weakCloudAccuracyMeters) {
    return false;
  }
  const elapsedDelta = rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos;
  if (elapsedDelta <= 0 || elapsedDelta > config.gapSeconds * 1_000_000_000) return false;
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  const speed = distance / (elapsedDelta / 1_000_000_000);
  return distance >= MOTION_SUPPORTED_MIN_DISTANCE_METERS
    && speed >= MOTION_SUPPORTED_MIN_SPEED_METERS_PER_SECOND
    && speed <= MOTION_SUPPORTED_MAX_SPEED_METERS_PER_SECOND;
}

function excludedPoint(rawPoint, result, reason, epoch, decision = null) {
  return {
    rawPointId: rawPoint.rawPointId,
    lat: rawPoint.lat,
    lng: rawPoint.lng,
    elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
    result,
    reason,
    samplingEpochId: epoch?.samplingEpochId ?? null,
    cloudType: decision?.cloudType || '',
    cloudId: decision?.cloudId ?? null,
    cloudSampleCount: decision?.cloudSampleCount ?? 0,
    cloudWeightedRadiusMeters: decision?.cloudWeightedRadiusMeters ?? null
  };
}

function buildFindings(product, evidence) {
  const findings = [];
  if (evidence.rawPoints.length === 0) findings.push('缺少 raw_location，无法生成目标成品');
  if (evidence.samplingEpochs.length === 0) {
    findings.push('缺少 sampling_policy，已使用合成 epoch 做低置信复算');
  }
  if (product.stationarySessionCollapseBlockedByBarometer) {
    findings.push('气压证据显示垂直运动，未执行静止整段压缩');
  }
  return findings;
}

function emptyProduct(strategyVersion, sourceFilePath, recordStartElapsedRealtimeNanos,
  recordEndElapsedRealtimeNanos) {
  return {
    strategyVersion,
    sourceFilePath,
    track: [],
    excluded: {
      weak: [],
      rejected: [],
      intakeRejected: []
    },
    stats: {
      routeDistanceMeters: 0,
      totalDistanceMeters: 0,
      suspectedDistanceMeters: 0,
      movingTimeSeconds: 0,
      recordStartElapsedRealtimeNanos,
      recordEndElapsedRealtimeNanos,
      segmentCount: 0,
      gapCount: 0,
      transportCount: 0,
      rawPointCount: 0,
      trustedPointCount: 0,
      weakPointCount: 0,
      rejectedPointCount: 0,
      intakeRejectedPointCount: 0
    },
    findings: []
  };
}

function recordDurationSeconds(product) {
  const start = product.stats.recordStartElapsedRealtimeNanos;
  const end = product.stats.recordEndElapsedRealtimeNanos;
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, (end - start) / 1_000_000_000)
    : 0;
}

function stationaryThreshold(rawPoint, config) {
  return Math.max(config.stationaryDistanceMeters, rawPoint.accuracy * config.stationaryAccuracyMultiplier);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && !(lat === 0 && lng === 0)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

function numberField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) return null;
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function compareRawPointTime(a, b) {
  return (a.elapsedRealtimeNanos ?? a.timeMillis ?? 0) - (b.elapsedRealtimeNanos ?? b.timeMillis ?? 0);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 30;
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function radians(value) {
  return value * Math.PI / 180;
}

function degrees(value) {
  return value * 180 / Math.PI;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const lat1Rad = radians(lat1);
  const lat2Rad = radians(lat2);
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
    + Math.cos(lat1Rad) * Math.cos(lat2Rad)
    * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}
