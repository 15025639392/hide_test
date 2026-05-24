import {
  createRecentMotionSummaryIndex,
  recentMotionStats
} from './timeWindowIndex.mjs';

const START_TOLERANCE_NANOS = 1_000_000_000;
const FIRST_FIX_GOOD_ACCURACY_METERS = 20;
const MOTION_WINDOW_NANOS = 5_000_000_000;
const EARTH_RADIUS_METERS = 6_371_000;
const MOTION_SUPPORTED_MIN_SPEED_METERS_PER_SECOND = 0.8;
const MOTION_SUPPORTED_MAX_SPEED_METERS_PER_SECOND = 3.5;
const MOTION_SUPPORTED_MIN_DISTANCE_METERS = 2.5;
const LOW_QUALITY_SEGMENT_MIN_DURATION_SECONDS = 60;
const LOW_QUALITY_SEGMENT_MIN_ACTIVE_RATIO = 0.7;
const LOW_QUALITY_SEGMENT_MIN_LOW_QUALITY_RATIO = 0.7;
const LOW_QUALITY_SEGMENT_MIN_PLAUSIBLE_DISTANCE_METERS = 25;
const LOW_QUALITY_SEGMENT_MIN_MOVING_STEPS = 8;
const LOW_QUALITY_SEGMENT_MIN_BBOX_METERS = 25;
const LOW_QUALITY_SEGMENT_MIN_STEP_METERS = 1.8;
const LOW_QUALITY_SEGMENT_MAX_STEP_METERS = 10;
const LOW_QUALITY_SEGMENT_SIMPLIFY_TOLERANCE_METERS = 12;
const LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS = 35;
const LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS = 2.5;
const WEAK_SIGNAL_DIRECTION_HOLD_MIN_HISTORY_METERS = 12;
const WEAK_SIGNAL_DIRECTION_HOLD_MIN_HINT_METERS = 20;
const WEAK_SIGNAL_DIRECTION_HOLD_MAX_HINT_METERS = 80;
const WEAK_SIGNAL_DIRECTION_HOLD_LATERAL_METERS = 25;
const WEAK_SIGNAL_DIRECTION_HOLD_MIN_RUN_POINTS = 2;
const WEAK_SIGNAL_DIRECTION_HOLD_MAX_HINTS = 20;
const ADAPTIVE_SHADOW_MAX_DIFFERENCES = 50;
const ADAPTIVE_SHADOW_DISTANCE_REVIEW_METERS = 30;
const ADAPTIVE_SHADOW_DISTANCE_REVIEW_RATIO = 0.05;
const ADAPTIVE_SHADOW_TRUSTED_POINT_REVIEW_MIN_DELTA = 3;
const ADAPTIVE_SHADOW_TRUSTED_POINT_REVIEW_RATIO = 0.05;
const ADAPTIVE_SHADOW_CHANGED_REVIEW_RATIO = 0.1;
const ADAPTIVE_SHADOW_FIELD_NAMES = Object.freeze([
  'weakCloudAccuracyMeters',
  'gapSeconds',
  'stationaryDistanceMeters',
  'transportSpeedMetersPerSecond',
  'transportMinDistanceMeters',
  'continuityRescueMaxSpeedMetersPerSecond'
]);
const ADAPTIVE_SHADOW_CANDIDATES = Object.freeze([
  {
    id: 'adaptive-balanced',
    label: '综合自适应',
    description: '同时观察弱点云、GAP、静止噪声、交通和连续性救回阈值。',
    fields: ADAPTIVE_SHADOW_FIELD_NAMES
  },
  {
    id: 'adaptive-gap-sensitive',
    label: 'GAP 敏感',
    description: '只观察采样节奏推导出的 GAP 阈值会改变什么。',
    fields: Object.freeze(['gapSeconds'])
  },
  {
    id: 'adaptive-stationary-noise',
    label: '静止噪声',
    description: '只观察静止点云噪声半径对轨迹压漂移的影响。',
    fields: Object.freeze(['stationaryDistanceMeters'])
  },
  {
    id: 'adaptive-weak-signal-rescue',
    label: '弱信号救回',
    description: '只观察弱点云和连续性救回速度阈值对低质量移动的影响。',
    fields: Object.freeze([
      'weakCloudAccuracyMeters',
      'continuityRescueMaxSpeedMetersPerSecond'
    ])
  },
  {
    id: 'adaptive-weak-signal-direction-hold',
    label: '弱信号方向保持',
    description: '弱信号低速/逗留区不补路线，只冻结进入弱区前的稳定主方向作为导航线索。',
    fields: Object.freeze([
      'weakSignalDirectionHoldEnabled'
    ]),
    overrides: Object.freeze({
      weakSignalDirectionHoldEnabled: true
    }),
    postProcess: 'weak_signal_direction_hold'
  },
  {
    id: 'adaptive-transport-guard',
    label: '交通守卫',
    description: '只观察疑似交通速度和最小距离阈值是否误伤徒步。',
    fields: Object.freeze([
      'transportSpeedMetersPerSecond',
      'transportMinDistanceMeters'
    ])
  }
]);
const BAROMETER_ASCENT_ALPHA = 0.35;
const BAROMETER_ASCENT_CLIMB_THRESHOLD_METERS = 3;
const BAROMETER_ASCENT_DROP_THRESHOLD_METERS = 1.5;
const BAROMETER_ASCENT_MAX_VERTICAL_SPEED_METERS_PER_SECOND = 2;
const BAROMETER_ASCENT_MAX_SAMPLE_GAP_NANOS = 30_000_000_000;

export const DEFAULT_TARGET_PRODUCT_CONFIG = Object.freeze({
  maxIntakeAccuracyMeters: 80,
  weakCloudAccuracyMeters: 30,
  continuityRescueMaxAccuracyMeters: 650,
  continuityRescueMaxSpeedMetersPerSecond: 6,
  lowAccuracyRescueMaxAccuracyMeters: LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS,
  lowAccuracyRescueMinDistanceMeters: LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS,
  weakSignalDirectionHoldEnabled: false,
  weakSignalDirectionHoldMinHistoryMeters: WEAK_SIGNAL_DIRECTION_HOLD_MIN_HISTORY_METERS,
  weakSignalDirectionHoldMinHintMeters: WEAK_SIGNAL_DIRECTION_HOLD_MIN_HINT_METERS,
  weakSignalDirectionHoldMaxHintMeters: WEAK_SIGNAL_DIRECTION_HOLD_MAX_HINT_METERS,
  weakSignalDirectionHoldLateralMeters: WEAK_SIGNAL_DIRECTION_HOLD_LATERAL_METERS,
  weakSignalDirectionHoldMinRunPoints: WEAK_SIGNAL_DIRECTION_HOLD_MIN_RUN_POINTS,
  gapSeconds: 120,
  stationaryDistanceMeters: 5,
  stationaryAccuracyMultiplier: 1.5,
  impossibleSpeedMetersPerSecond: 12,
  transportSpeedMetersPerSecond: 3.5,
  transportMinDistanceMeters: 20,
  cloudTemporalDecaySeconds: 20,
  collapseStationarySession: true,
  lowQualityMotionRebuildEnabled: false,
  stationarySessionStillRatio: 0.95,
  stationarySessionAnchorRatio: 0.8,
  barometerCleaningEnabled: false,
  barometerVerticalMotionMinRangeMeters: 3,
  barometerVerticalMotionMinWindowCount: 5,
  locationAltitudeAscentMaxVerticalAccuracyMeters: 20,
  locationAltitudeAscentMinGainMeters: 1,
  locationAltitudeAscentMaxStepGainMeters: 30
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
  product.sessionProfile = buildSessionProfile(evidence, config);
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
        intake.reason, epoch, null));
      continue;
    }

    engineEligibleRawPointIds.add(rawPoint.rawPointId);
    const decision = engine.decide(rawPoint, epoch, evidence.motionIndex, previousTrustedTrackPoint);
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
  recoverStationaryExitMovement(product, evidence, config);
  collapseStationarySessionIfNeeded(product, evidence);
  recomputeAscentStats(product, evidence);
  product.adaptiveShadows = buildAdaptiveShadows(events, config, product, product.sessionProfile,
    sourceFilePath, options);
  product.adaptiveShadow = product.adaptiveShadows[0] ?? null;
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
  product.lowQualityMotionRebuild = {
    mode: config.lowQualityMotionRebuildEnabled ? 'track' : 'review_only',
    candidateCount: 0,
    candidates: [],
    rawIntervalCandidateCount: 0,
    rawIntervalCandidates: [],
    rawIntervalScan: {
      scannedIntervalCount: 0,
      rejectedIntervalCount: 0
    },
    scannedMovingGoodFixCount: 0,
    skipped: {
      transportBoundary: 0,
      missingLowQualityBoundary: 0,
      sourceOutsideInterval: 0,
      criteriaRejected: 0,
      lowQualityMixRejected: 0,
      trackAlreadyExpressed: 0,
      structureTooShort: 0
    },
    rejectedExamples: []
  };
  if (!Array.isArray(evidence.rawPoints) || evidence.rawPoints.length === 0) return;
  let changed = false;
  const candidates = [];
  const rebuiltTrack = product.track.length > 0 ? [product.track[0]] : [];
  const reclassifiedRawPointIds = new Set();
  const rawStatusById = lowQualityRawStatusById(product);
  for (let index = 1; index < product.track.length; index++) {
    const point = product.track[index];
    const previous = rebuiltTrack.at(-1) || product.track[index - 1];
    if (point.reason !== 'moving_good_fix') {
      rebuiltTrack.push(point);
      continue;
    }
    product.lowQualityMotionRebuild.scannedMovingGoodFixCount++;
    const next = product.track[index + 1] || null;
    if (!previous || isTransportRiskReason(previous.reason) || isTransportRiskReason(point.reason)
        || isTransportRiskReason(next?.reason)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'transportBoundary', '前后存在疑似交通工具风险');
      rebuiltTrack.push(point);
      continue;
    }
    if (!next || !isLowQualityMotionBoundary(next)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'missingLowQualityBoundary', '后一个目标点不是 stationary_anchor / gap_recovery / continuity_rescue_gap_recovery');
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
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'sourceOutsideInterval', '候选 moving_good_fix 不在可重建 raw 区间内');
      rebuiltTrack.push(point);
      continue;
    }
    const summary = summarizeLowQualityMotionInterval(intervalRawPoints, evidence.motionIndex);
    if (!isLowQualityMotionSegment(summary)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'criteriaRejected', lowQualitySegmentRejectMessage(summary));
      rebuiltTrack.push(point);
      continue;
    }
    const decisionMix = lowQualityIntervalDecisionMix(intervalRawPoints, rawStatusById);
    if (!hasStrongLowQualityDecisionMix(decisionMix)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'lowQualityMixRejected', lowQualityDecisionMixRejectMessage(decisionMix));
      rebuiltTrack.push(point);
      continue;
    }
    if (!hasInsufficientTrackExpression(decisionMix)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'trackAlreadyExpressed', '现有清洗轨迹已覆盖该区间的主要运动形状');
      rebuiltTrack.push(point);
      continue;
    }
    const structureRawPoints = selectLowQualityMotionStructure(intervalRawPoints);
    if (structureRawPoints.length < 2) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'structureTooShort', '抽稀后不足 2 个结构点');
      rebuiltTrack.push(point);
      continue;
    }
    const rebuiltPoints = buildLowQualityMotionTrackPoints(point, previous,
      intervalRawPoints, structureRawPoints, summary);
    if (!lowQualityRebuildMayChangeTrack(point, rebuiltPoints)) {
      addLowQualityRejectedExample(product.lowQualityMotionRebuild, point,
        'trackAlreadyExpressed', '开启低质量重建不会改变轨迹、里程或运动时间');
      rebuiltTrack.push(point);
      continue;
    }
    candidates.push(lowQualityMotionCandidate(point, previous, next, summary,
      rebuiltPoints, decisionMix));
    if (!config.lowQualityMotionRebuildEnabled) {
      rebuiltTrack.push(point);
      continue;
    }
    for (const rebuiltPoint of rebuiltPoints) {
      rebuiltTrack.push(rebuiltPoint);
    }
    for (const rawPoint of intervalRawPoints) {
      reclassifiedRawPointIds.add(rawPoint.rawPointId);
    }
    changed = true;
  }
  product.lowQualityMotionRebuild.candidateCount = candidates.length;
  product.lowQualityMotionRebuild.candidates = candidates;
  const rawIntervalCandidates = scanLowQualityRawIntervals(product, evidence, config,
    engineEligibleRawPointIds, candidates);
  product.lowQualityMotionRebuild.rawIntervalCandidateCount = rawIntervalCandidates.length;
  product.lowQualityMotionRebuild.rawIntervalCandidates = rawIntervalCandidates;
  if (!changed) return;
  product.track = rebuiltTrack;
  removeExcludedRawPoints(product, reclassifiedRawPointIds);
  reconcileTrackSegments(product, config);
  renumberTrackPoints(product);
  recomputeProductStats(product);
}

function scanLowQualityRawIntervals(product, evidence, config, engineEligibleRawPointIds,
  rebuildCandidates) {
  const intervals = [];
  let current = [];
  for (const rawPoint of evidence.rawPoints) {
    if (!isLowQualityRawIntervalPoint(rawPoint, config, engineEligibleRawPointIds)) {
      pushRawInterval(intervals, current);
      current = [];
      continue;
    }
    const previous = current.at(-1);
    if (previous && rawPoint.elapsedRealtimeNanos - previous.elapsedRealtimeNanos > 10_000_000_000) {
      pushRawInterval(intervals, current);
      current = [];
    }
    current.push(rawPoint);
  }
  pushRawInterval(intervals, current);

  const rawStatusById = lowQualityRawStatusById(product);
  const candidates = [];
  product.lowQualityMotionRebuild.rawIntervalScan.scannedIntervalCount = intervals.length;
  for (const interval of intervals) {
    const summary = summarizeLowQualityMotionInterval(interval, evidence.motionIndex);
    if (!isLowQualityMotionSegment(summary)) {
      product.lowQualityMotionRebuild.rawIntervalScan.rejectedIntervalCount++;
      continue;
    }
    const decisionMix = lowQualityIntervalDecisionMix(interval, rawStatusById);
    if (!hasStrongLowQualityDecisionMix(decisionMix)) {
      product.lowQualityMotionRebuild.rawIntervalScan.rejectedIntervalCount++;
      continue;
    }
    if (!hasInsufficientTrackExpression(decisionMix)) {
      product.lowQualityMotionRebuild.rawIntervalScan.rejectedIntervalCount++;
      continue;
    }
    const overlappingCandidates = overlappingLowQualityRebuildCandidates(interval, rebuildCandidates);
    if (overlappingCandidates.length === 0) {
      product.lowQualityMotionRebuild.rawIntervalScan.rejectedIntervalCount++;
      continue;
    }
    candidates.push(rawIntervalLowQualityMotionCandidate(interval, summary, decisionMix,
      overlappingCandidates));
    if (candidates.length >= 20) break;
  }
  return candidates;
}

function isLowQualityRawIntervalPoint(rawPoint, config, engineEligibleRawPointIds) {
  return engineEligibleRawPointIds.has(rawPoint.rawPointId)
    && Number.isFinite(rawPoint.elapsedRealtimeNanos)
    && validCoordinate(rawPoint.lat, rawPoint.lng)
    && Number.isFinite(rawPoint.accuracy)
    && rawPoint.accuracy <= config.weakCloudAccuracyMeters;
}

function pushRawInterval(intervals, rawPoints) {
  if (rawPoints.length >= 2) intervals.push(rawPoints);
}

function lowQualityRawStatusById(product) {
  const statusById = new Map();
  for (const point of product.track) {
    for (const rawPointId of point.contributingRawPointIds || [point.sourceRawPointId]) {
      statusById.set(rawPointId, 'trusted');
    }
  }
  for (const point of product.excluded.weak) {
    statusById.set(point.rawPointId, 'weak');
  }
  for (const point of product.excluded.rejected) {
    statusById.set(point.rawPointId, 'rejected');
  }
  for (const point of product.excluded.intakeRejected) {
    statusById.set(point.rawPointId, 'intake_rejected');
  }
  return statusById;
}

function lowQualityIntervalDecisionMix(rawPoints, rawStatusById) {
  const mix = {
    rawCount: rawPoints.length,
    trustedCount: 0,
    weakCount: 0,
    rejectedCount: 0,
    intakeRejectedCount: 0,
    unexplainedCount: 0,
    lowQualityCount: 0,
    lowQualityRatio: 0,
    longestLowQualityRunCount: 0,
    longestLowQualityRunRatio: 0
  };
  let currentLowQualityRunCount = 0;
  for (const rawPoint of rawPoints) {
    const status = rawStatusById.get(rawPoint.rawPointId);
    if (status === 'trusted') mix.trustedCount++;
    else if (status === 'weak') mix.weakCount++;
    else if (status === 'rejected') mix.rejectedCount++;
    else if (status === 'intake_rejected') mix.intakeRejectedCount++;
    else mix.unexplainedCount++;
    if (isLowQualityDecisionStatus(status)) {
      mix.lowQualityCount++;
      currentLowQualityRunCount++;
      mix.longestLowQualityRunCount = Math.max(mix.longestLowQualityRunCount,
        currentLowQualityRunCount);
    } else {
      currentLowQualityRunCount = 0;
    }
  }
  mix.lowQualityRatio = ratio(mix.lowQualityCount, mix.rawCount);
  mix.longestLowQualityRunRatio = ratio(mix.longestLowQualityRunCount, mix.rawCount);
  return mix;
}

function isLowQualityDecisionStatus(status) {
  return status === 'weak' || status === 'rejected';
}

function hasStrongLowQualityDecisionMix(decisionMix) {
  return decisionMix.lowQualityRatio >= LOW_QUALITY_SEGMENT_MIN_LOW_QUALITY_RATIO
    && decisionMix.longestLowQualityRunRatio >= LOW_QUALITY_SEGMENT_MIN_LOW_QUALITY_RATIO;
}

function hasInsufficientTrackExpression(decisionMix) {
  const maxExpressedRatio = 1 - LOW_QUALITY_SEGMENT_MIN_LOW_QUALITY_RATIO;
  return ratio(decisionMix.trustedCount, decisionMix.rawCount) <= maxExpressedRatio;
}

function lowQualityDecisionMixRejectMessage(decisionMix) {
  return `weak/reject 占比 ${decisionMix.lowQualityRatio.toFixed(2)}，连续占比 ${decisionMix.longestLowQualityRunRatio.toFixed(2)}，未达到 ${LOW_QUALITY_SEGMENT_MIN_LOW_QUALITY_RATIO}`;
}

function lowQualityRebuildMayChangeTrack(point, rebuiltPoints) {
  if (rebuiltPoints.length !== 1) return true;
  const rebuilt = rebuiltPoints[0];
  if (rebuilt.sourceRawPointId !== point.sourceRawPointId) return true;
  if (distanceMeters(rebuilt.lat, rebuilt.lng, point.lat, point.lng) > 1) return true;
  const distanceDelta = Math.abs((rebuilt.distanceDeltaMeters || 0)
    - (point.distanceDeltaMeters || 0));
  if (distanceDelta > 0.5) return true;
  const movingTimeDelta = Math.abs((rebuilt.movingTimeDeltaSeconds || 0)
    - (point.movingTimeDeltaSeconds || 0));
  return movingTimeDelta > 1;
}

function overlappingLowQualityRebuildCandidates(rawPoints, rebuildCandidates) {
  const intervalRawPointIds = new Set(rawPoints.map((rawPoint) => rawPoint.rawPointId));
  return (rebuildCandidates || []).filter((candidate) =>
    (candidate.rawPointIds || []).some((rawPointId) => intervalRawPointIds.has(rawPointId)));
}

function rawIntervalLowQualityMotionCandidate(rawPoints, summary, decisionMix,
  overlappingCandidates) {
  const structureRawPoints = selectLowQualityMotionStructure(rawPoints);
  return {
    kind: 'raw_interval_review',
    rawPointIds: summary.rawPointIds,
    structureRawPointIds: structureRawPoints.map((rawPoint) => rawPoint.rawPointId),
    enablingRebuildMayChange: true,
    overlappingCandidateRawPointIds: Array.from(new Set(overlappingCandidates
      .flatMap((candidate) => candidate.rawPointIds || []))),
    decisionMix,
    summary: {
      sampleCount: summary.sampleCount,
      durationSeconds: summary.durationSeconds,
      activeRatio: summary.activeRatio,
      plausibleDistanceMeters: summary.plausibleDistanceMeters,
      movingStepCount: summary.movingStepCount,
      maxAdjacentGapSeconds: summary.maxAdjacentGapSeconds,
      bboxDiagonalMeters: summary.bboxDiagonalMeters
    },
    previewTrack: structureRawPoints.map((rawPoint) => ({
      sourceRawPointId: rawPoint.rawPointId,
      lat: rawPoint.lat,
      lng: rawPoint.lng,
      elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos
    }))
  };
}

function addLowQualityRejectedExample(rebuild, point, reason, message) {
  rebuild.skipped[reason] = (rebuild.skipped[reason] || 0) + 1;
  if (rebuild.rejectedExamples.length >= 5) return;
  rebuild.rejectedExamples.push({
    sourceRawPointId: point.sourceRawPointId,
    reason,
    message
  });
}

function lowQualitySegmentRejectMessage(summary) {
  const reasons = [];
  if (summary.durationSeconds < LOW_QUALITY_SEGMENT_MIN_DURATION_SECONDS) {
    reasons.push(`时长 ${summary.durationSeconds.toFixed(1)}s < ${LOW_QUALITY_SEGMENT_MIN_DURATION_SECONDS}s`);
  }
  if (summary.activeRatio < LOW_QUALITY_SEGMENT_MIN_ACTIVE_RATIO) {
    reasons.push(`active ${summary.activeRatio.toFixed(2)} < ${LOW_QUALITY_SEGMENT_MIN_ACTIVE_RATIO}`);
  }
  if (summary.plausibleDistanceMeters < LOW_QUALITY_SEGMENT_MIN_PLAUSIBLE_DISTANCE_METERS) {
    reasons.push(`合理步距 ${summary.plausibleDistanceMeters.toFixed(1)}m < ${LOW_QUALITY_SEGMENT_MIN_PLAUSIBLE_DISTANCE_METERS}m`);
  }
  if (summary.movingStepCount < LOW_QUALITY_SEGMENT_MIN_MOVING_STEPS) {
    reasons.push(`移动步数 ${summary.movingStepCount} < ${LOW_QUALITY_SEGMENT_MIN_MOVING_STEPS}`);
  }
  if (summary.maxAdjacentGapSeconds > 10) {
    reasons.push(`相邻间隔 ${summary.maxAdjacentGapSeconds.toFixed(1)}s > 10s`);
  }
  if (summary.bboxDiagonalMeters < LOW_QUALITY_SEGMENT_MIN_BBOX_METERS) {
    reasons.push(`bbox ${summary.bboxDiagonalMeters.toFixed(1)}m < ${LOW_QUALITY_SEGMENT_MIN_BBOX_METERS}m`);
  }
  return reasons.length > 0 ? reasons.join('；') : '未满足低质量运动段组合条件';
}

function lowQualityMotionCandidate(point, previous, next, summary, rebuiltPoints, decisionMix) {
  return {
    kind: 'boundary_rebuild',
    sourceRawPointId: point.sourceRawPointId,
    previousTrackPointId: previous?.trackPointId ?? null,
    nextTrackPointId: next?.trackPointId ?? null,
    rawPointIds: summary.rawPointIds,
    structureRawPointIds: rebuiltPoints.map((rebuiltPoint) => rebuiltPoint.sourceRawPointId),
    enablingRebuildMayChange: true,
    decisionMix,
    summary: {
      sampleCount: summary.sampleCount,
      durationSeconds: summary.durationSeconds,
      activeRatio: summary.activeRatio,
      plausibleDistanceMeters: summary.plausibleDistanceMeters,
      movingStepCount: summary.movingStepCount,
      maxAdjacentGapSeconds: summary.maxAdjacentGapSeconds,
      bboxDiagonalMeters: summary.bboxDiagonalMeters
    },
    previewTrack: rebuiltPoints.map((rebuiltPoint) => ({
      sourceRawPointId: rebuiltPoint.sourceRawPointId,
      lat: rebuiltPoint.lat,
      lng: rebuiltPoint.lng,
      elapsedRealtimeNanos: rebuiltPoint.elapsedRealtimeNanos,
      distanceDeltaMeters: rebuiltPoint.distanceDeltaMeters,
      movingTimeDeltaSeconds: rebuiltPoint.movingTimeDeltaSeconds
    }))
  };
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
  return rawPoints.map((rawPoint) => ({
    rawPoint,
    ...projectCoordinateToOrigin(rawPoint.lat, rawPoint.lng, origin)
  }));
}

function projectCoordinateToOrigin(lat, lng, origin) {
  const originLatRad = radians(origin.lat);
  return {
    x: EARTH_RADIUS_METERS * radians(lng - origin.lng) * Math.cos(originLatRad),
    y: EARTH_RADIUS_METERS * radians(lat - origin.lat)
  };
}

function coordinateFromOrigin(origin, x, y) {
  const originLatRad = radians(origin.lat);
  return {
    lat: origin.lat + degrees(y / EARTH_RADIUS_METERS),
    lng: origin.lng + degrees(x / (EARTH_RADIUS_METERS * Math.cos(originLatRad)))
  };
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
  renumberTrackPoints(product);
  recomputeProductStats(product);
}

function pruneStationaryLowSpeedTail(product, config) {
  const removeIndexes = new Map();
  const tailDistanceMeters = Math.max(config.stationaryDistanceMeters, 10);
  for (let index = 0; index < product.track.length; index++) {
    const anchor = product.track[index];
    if (anchor.reason !== 'stationary_anchor') continue;
    const tailIndexes = [];
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const point = product.track[cursor];
      const reason = stationaryTailRejectReason(point);
      if (!reason) break;
      if (distanceMeters(point.lat, point.lng, anchor.lat, anchor.lng) > tailDistanceMeters) break;
      tailIndexes.push(cursor);
    }
    for (const cursor of tailIndexes) {
      const point = product.track[cursor];
      const reason = stationaryTailRejectReason(point);
      if (reason === 'stationary_low_speed_tail'
          && isProtectedContinuousLowSpeedTail(product.track, tailIndexes, cursor)) {
        continue;
      }
      removeIndexes.set(cursor, reason);
    }
  }
  if (removeIndexes.size === 0) return;
  product.track = product.track.filter((point, index) => {
    if (!removeIndexes.has(index)) return true;
    product.excluded.rejected.push(trackPointAsRejected(point, removeIndexes.get(index)));
    return false;
  });
  renumberTrackPoints(product);
  recomputeProductStats(product);
}

function stationaryTailRejectReason(point) {
  if (point.reason === 'motion_supported_low_speed') return 'stationary_low_speed_tail';
  if (point.reason === 'continuity_rescue_low_accuracy') return 'stationary_low_accuracy_tail';
  return '';
}

function isProtectedContinuousLowSpeedTail(track, tailIndexes, index) {
  const lowSpeedTailIndexes = tailIndexes.filter((cursor) =>
    track[cursor].reason === 'motion_supported_low_speed');
  if (!lowSpeedTailIndexes.includes(index)) {
    return false;
  }
  const minIndex = Math.min(...lowSpeedTailIndexes);
  const maxIndex = Math.max(...lowSpeedTailIndexes);
  if (maxIndex - minIndex + 1 !== lowSpeedTailIndexes.length) {
    return false;
  }
  let count = 0;
  let cursor = minIndex - 1;
  while (cursor >= 0 && track[cursor].reason === 'motion_supported_low_speed') {
    count++;
    cursor--;
  }
  return count + lowSpeedTailIndexes.length >= 3;
}

function recoverStationaryExitMovement(product, evidence, config) {
  const rawById = new Map(evidence.rawPoints.map((rawPoint) => [rawPoint.rawPointId, rawPoint]));
  const rejected = product.excluded.rejected
    .filter((point) => point.reason === 'stationary_continuity_jitter')
    .sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos);
  const recoveredRawPointIds = new Set();
  const rebuiltTrack = [];
  let changed = false;

  for (let index = 0; index < product.track.length; index++) {
    const point = product.track[index];
    rebuiltTrack.push(point);
    if (point.reason !== 'stationary_anchor') continue;
    const next = product.track[index + 1];
    if (!next || next.segmentId !== point.segmentId || !shouldAccumulateMovement(next.reason)) {
      continue;
    }
    const candidates = rejected.filter((candidate) =>
      candidate.elapsedRealtimeNanos > point.elapsedRealtimeNanos
      && candidate.elapsedRealtimeNanos < next.elapsedRealtimeNanos
      && !recoveredRawPointIds.has(candidate.rawPointId));
    const exitPoints = selectStationaryExitPoints(point, next, candidates,
      rawById, evidence.motionIndex, config);
    let previous = point;
    for (const exitPoint of exitPoints) {
      rebuiltTrack.push(recoveredStationaryExitTrackPoint(exitPoint,
        rawById.get(exitPoint.rawPointId), previous, point, next));
      recoveredRawPointIds.add(exitPoint.rawPointId);
      previous = rebuiltTrack.at(-1);
      changed = true;
    }
    if (exitPoints.length > 0) {
      next.distanceDeltaMeters = distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
      next.movingTimeDeltaSeconds = Math.max(0,
        (next.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000);
    }
  }

  if (!changed) return;
  product.track = rebuiltTrack;
  product.excluded.rejected = product.excluded.rejected
    .filter((point) => !recoveredRawPointIds.has(point.rawPointId));
  reconcileTrackSegments(product, config);
  renumberTrackPoints(product);
  recomputeProductStats(product);
}

function selectStationaryExitPoints(anchor, next, candidates, rawById, motionSummaries, config) {
  const exitPoints = [];
  let previousDistance = 0;
  for (const candidate of candidates) {
    const rawPoint = rawById.get(candidate.rawPointId);
    if (!rawPoint) continue;
    const distanceFromAnchor = distanceMeters(anchor.lat, anchor.lng, candidate.lat, candidate.lng);
    if (distanceFromAnchor < MOTION_SUPPORTED_MIN_DISTANCE_METERS) {
      continue;
    }
    if (distanceFromAnchor + 0.5 < previousDistance) {
      continue;
    }
    if (distanceFromAnchor >= distanceMeters(anchor.lat, anchor.lng, next.lat, next.lng)) {
      continue;
    }
    if (!hasRecentActiveMotion(candidate.elapsedRealtimeNanos, motionSummaries)) {
      continue;
    }
    if (!Number.isFinite(rawPoint.accuracy) || rawPoint.accuracy > config.weakCloudAccuracyMeters) {
      continue;
    }
    exitPoints.push(candidate);
    previousDistance = distanceFromAnchor;
  }
  return exitPoints;
}

function recoveredStationaryExitTrackPoint(point, rawPoint, previous, anchor, next) {
  const elapsedDelta = Math.max(0,
    (point.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000_000);
  return {
    trackPointId: 0,
    sourceRawPointId: point.rawPointId,
    recomputedDecisionId: point.rawPointId,
    segmentId: anchor.segmentId,
    lat: point.lat,
    lng: point.lng,
    elapsedRealtimeNanos: point.elapsedRealtimeNanos,
    timeMillis: rawPoint?.timeMillis ?? point.timeMillis ?? null,
    result: 'accept',
    reason: 'motion_supported_low_speed',
    distanceDeltaMeters: distanceMeters(previous.lat, previous.lng, point.lat, point.lng),
    movingTimeDeltaSeconds: elapsedDelta,
    cloudType: 'STATIONARY_EXIT',
    cloudId: null,
    cloudSampleCount: 1,
    cloudWeightSum: null,
    cloudWeightedRadiusMeters: distanceMeters(anchor.lat, anchor.lng, next.lat, next.lng),
    representativeRawPointId: point.rawPointId,
    contributingRawPointIds: [point.rawPointId],
    coordinateSource: 'raw',
    virtualCoordinate: false
  };
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

function recomputeAscentStats(product, evidence) {
  const barometer = computeBarometerAscent(evidence.barometerWindows);
  const locationAltitude = computeLocationAltitudeAscent(product.track, evidence.rawPoints,
    product.config);
  product.stats.locationAltitudeTotalAscentMeters = locationAltitude.totalAscentMeters;
  product.stats.locationAltitudeAscentSampleCount = locationAltitude.sampleCount;
  product.stats.locationAltitudeAscentRejectedSampleCount = locationAltitude.rejectedSampleCount;
  product.stats.locationAltitudeAscentUsableSampleCount = locationAltitude.usableSampleCount;
  product.stats.locationAltitudeAscentMinVerticalAccuracyMeters =
    locationAltitude.minVerticalAccuracyMeters;
  product.stats.locationAltitudeAscentMaxVerticalAccuracyMeters =
    locationAltitude.maxVerticalAccuracyMeters;
  product.stats.locationAltitudeAscentAvgVerticalAccuracyMeters =
    locationAltitude.avgVerticalAccuracyMeters;
  product.stats.barometerTotalAscentMeters = barometer.totalAscentMeters;
  product.stats.barometerAscentSampleCount = barometer.sampleCount;
  product.stats.barometerAscentRejectedSampleCount = barometer.rejectedSampleCount;
  // Legacy summary fields remain for older consumers; the Web UI displays both paths.
  if (barometer.totalAscentMeters >= 0) {
    product.stats.selectedTotalAscentMeters = barometer.totalAscentMeters;
    product.stats.selectedAscentSource = 'BAROMETER';
  } else if (locationAltitude.totalAscentMeters >= 0) {
    product.stats.selectedTotalAscentMeters = locationAltitude.totalAscentMeters;
    product.stats.selectedAscentSource = 'LOCATION_ALTITUDE';
  } else {
    product.stats.selectedTotalAscentMeters = -1;
    product.stats.selectedAscentSource = 'NONE';
  }
}

function buildAdaptiveShadows(events, fixedConfig, fixedProduct, sessionProfile, sourceFilePath,
  options) {
  if (options.adaptiveShadow === false || options.adaptiveShadows === false) return [];
  return ADAPTIVE_SHADOW_CANDIDATES.map((candidate) =>
    buildAdaptiveShadow(events, fixedConfig, fixedProduct, sessionProfile, sourceFilePath,
      candidate));
}

function buildAdaptiveShadow(events, fixedConfig, fixedProduct, sessionProfile, sourceFilePath,
  candidate) {
  const adaptiveConfig = adaptiveShadowConfig(fixedConfig, sessionProfile, candidate.fields,
    candidate.overrides);
  const adaptiveProduct = buildTargetTrackProduct(events, {
    config: adaptiveConfig,
    sourceFilePath,
    adaptiveShadow: false
  });
  postProcessAdaptiveShadowProduct(candidate, adaptiveProduct, events, adaptiveConfig);
  const diagnosticOnly = isDiagnosticOnlyAdaptiveShadow(candidate);
  const fixedDecisions = rawDecisionMapFromProduct(fixedProduct);
  const adaptiveDecisions = rawDecisionMapFromProduct(adaptiveProduct);
  const rawPointIds = Array.from(new Set([
    ...fixedDecisions.keys(),
    ...adaptiveDecisions.keys()
  ])).sort((a, b) => a - b);
  const differences = [];
  let promotedToTrustedCount = 0;
  let demotedFromTrustedCount = 0;
  let reasonChangedCount = 0;
  for (const rawPointId of rawPointIds) {
    const fixed = fixedDecisions.get(rawPointId) || emptyShadowDecision();
    const adaptive = adaptiveDecisions.get(rawPointId) || emptyShadowDecision();
    if (sameShadowDecision(fixed, adaptive)) continue;
    if (!isTrustedShadowDecision(fixed) && isTrustedShadowDecision(adaptive)) {
      promotedToTrustedCount++;
    } else if (isTrustedShadowDecision(fixed) && !isTrustedShadowDecision(adaptive)) {
      demotedFromTrustedCount++;
    } else {
      reasonChangedCount++;
    }
    if (differences.length < ADAPTIVE_SHADOW_MAX_DIFFERENCES) {
      differences.push({
        rawPointId,
        fixed: shadowDecisionView(fixed),
        adaptive: shadowDecisionView(adaptive),
        changeType: adaptiveShadowChangeType(fixed, adaptive)
      });
    }
  }
  const impact = adaptiveShadowImpact(fixedProduct, adaptiveProduct);
  const summary = {
    rawPointCount: rawPointIds.length,
    changedCount: promotedToTrustedCount + demotedFromTrustedCount + reasonChangedCount,
    promotedToTrustedCount,
    demotedFromTrustedCount,
    reasonChangedCount,
    reportedDifferenceCount: differences.length,
    truncated: differences.length >= ADAPTIVE_SHADOW_MAX_DIFFERENCES
      && promotedToTrustedCount + demotedFromTrustedCount + reasonChangedCount
        > ADAPTIVE_SHADOW_MAX_DIFFERENCES
  };
  const assessment = diagnosticOnly
    ? adaptiveShadowDiagnosticAssessment(adaptiveProduct.weakSignalDirectionHold)
    : adaptiveShadowAssessment(summary, impact);
  return {
    version: 1,
    id: candidate.id,
    label: candidate.label,
    description: candidate.description,
    changedFields: candidate.fields,
    mode: diagnosticOnly ? 'diagnostic_only' : 'shadow_only',
    note: diagnosticOnly
      ? '诊断型候选只输出方向提示，不生成影子轨迹，不改变当前成品轨迹。'
      : '自适应影子只用于对比，不改变当前成品轨迹。',
    thresholds: {
      fixed: shadowThresholdsFromConfig(fixedConfig),
      adaptive: shadowThresholdsFromConfig(adaptiveConfig)
    },
    impact,
    summary,
    assessment,
    track: diagnosticOnly ? [] : adaptiveShadowTrackView(adaptiveProduct.track),
    weakSignalDirectionHold: adaptiveProduct.weakSignalDirectionHold ?? null,
    differences: diagnosticOnly ? [] : differences
  };
}

function isDiagnosticOnlyAdaptiveShadow(candidate) {
  return candidate.postProcess === 'weak_signal_direction_hold';
}

function adaptiveShadowDiagnosticAssessment(directionHold) {
  const hintCount = directionHold?.hintCount ?? 0;
  if (hintCount > 0) {
    return {
      level: 'observe',
      label: '方向提示',
      summary: `生成 ${hintCount} 段弱信号方向提示；不改变轨迹、里程或判点。`,
      reasons: [{
        code: 'weak_signal_direction_hold_hint',
        severity: 'observe',
        message: '方向提示只用于人工判断下一步主方向，不能当作清洗轨迹差异。'
      }]
    };
  }
  return {
    level: 'same',
    label: '无方向提示',
    summary: '没有找到可用的弱信号方向保持线索。',
    reasons: []
  };
}

function postProcessAdaptiveShadowProduct(candidate, adaptiveProduct, events, adaptiveConfig) {
  if (candidate.postProcess !== 'weak_signal_direction_hold') return;
  const evidence = buildEvidence(events);
  applyWeakSignalDirectionHold(adaptiveProduct, evidence, adaptiveConfig);
}

function applyWeakSignalDirectionHold(product, evidence, config) {
  const summary = {
    mode: 'diagnostic_only',
    hintCount: 0,
    candidateRunCount: 0,
    skippedNoHistoryCount: 0,
    skippedShortRunCount: 0,
    maxLateralMeters: 0,
    hints: []
  };
  product.weakSignalDirectionHold = summary;
  if (!config.weakSignalDirectionHoldEnabled || product.track.length === 0) {
    return;
  }

  const rawById = new Map((evidence.rawPoints || []).map((rawPoint) => [
    rawPoint.rawPointId,
    rawPoint
  ]));
  const trackByRawId = trackPointByRawPointId(product);
  const decisionByRawId = rawDecisionMapFromProduct(product);
  const runs = weakSignalDirectionRuns(evidence.rawPoints || [], decisionByRawId,
    trackByRawId, config);
  summary.candidateRunCount = runs.length;

  const stableTrack = (product.track || [])
    .filter((point) => isDirectionStableTrackPoint(point, rawById, config))
    .sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos);

  for (const run of runs) {
    if (run.length < config.weakSignalDirectionHoldMinRunPoints) {
      summary.skippedShortRunCount++;
      continue;
    }
    const history = directionHistoryBefore(stableTrack, run[0].elapsedRealtimeNanos, config);
    if (!history) {
      summary.skippedNoHistoryCount++;
      continue;
    }
    const exit = directionExitAfter(stableTrack, run.at(-1).elapsedRealtimeNanos);
    const hint = weakSignalDirectionHint(run, history, exit, config);
    summary.hints.push(hint);
    summary.maxLateralMeters = Math.max(summary.maxLateralMeters, hint.maxLateralMeters);
    if (summary.hints.length >= WEAK_SIGNAL_DIRECTION_HOLD_MAX_HINTS) {
      break;
    }
  }
  summary.hintCount = summary.hints.length;
}

function trackPointByRawPointId(product) {
  const byRawId = new Map();
  for (const point of product.track || []) {
    if (Number.isFinite(point.sourceRawPointId)) {
      byRawId.set(point.sourceRawPointId, point);
    }
    for (const rawPointId of point.contributingRawPointIds || []) {
      if (!byRawId.has(rawPointId)) byRawId.set(rawPointId, point);
    }
  }
  return byRawId;
}

function weakSignalDirectionRuns(rawPoints, decisionByRawId, trackByRawId, config) {
  const runs = [];
  let current = [];
  for (const rawPoint of rawPoints
    .filter((point) => Number.isFinite(point.elapsedRealtimeNanos))
    .sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos)) {
    const decision = decisionByRawId.get(rawPoint.rawPointId) || emptyShadowDecision();
    const trackPoint = trackByRawId.get(rawPoint.rawPointId) || null;
    if (!isWeakSignalDirectionCandidate(rawPoint, decision, trackPoint, config)) {
      pushWeakSignalDirectionRun(runs, current, config);
      current = [];
      continue;
    }
    const previous = current.at(-1);
    if (previous
        && rawPoint.elapsedRealtimeNanos - previous.elapsedRealtimeNanos
          > config.gapSeconds * 1_000_000_000) {
      pushWeakSignalDirectionRun(runs, current, config);
      current = [];
    }
    current.push(rawPoint);
  }
  pushWeakSignalDirectionRun(runs, current, config);
  return runs;
}

function pushWeakSignalDirectionRun(runs, current, config) {
  if (current.length >= config.weakSignalDirectionHoldMinRunPoints) {
    runs.push(current);
  }
}

function isWeakSignalDirectionCandidate(rawPoint, decision, trackPoint, config) {
  if (!validCoordinate(rawPoint.lat, rawPoint.lng)) return false;
  if (decision.bucket === 'intakeRejected') return false;
  if (trackPoint?.reason === 'continuity_rescue_low_accuracy'
      || trackPoint?.reason === 'motion_supported_low_speed') {
    return true;
  }
  if (trackPoint && isDirectionStableReason(trackPoint.reason)) return false;
  if (decision.bucket === 'weak') return true;
  if (decision.bucket === 'rejected') return weakSignalDirectionRejectReason(decision.reason);
  if (!Number.isFinite(rawPoint.accuracy)) return false;
  return rawPoint.accuracy >= config.weakCloudAccuracyMeters * 0.75
    && (!rawPoint.hasSpeed || !Number.isFinite(rawPoint.speed) || rawPoint.speed <= 1.5);
}

function weakSignalDirectionRejectReason(reason) {
  return reason === 'stationary_cloud_jitter'
    || reason === 'stationary_continuity_jitter'
    || reason === 'stationary_low_speed_tail'
    || reason === 'stationary_low_accuracy_tail'
    || reason === 'isolated_stationary_movement'
    || reason === 'moving_cloud_unstable'
    || reason === 'weak_signal_stage2';
}

function isDirectionStableTrackPoint(point, rawById, config) {
  if (!point || !isDirectionStableReason(point.reason)) return false;
  if (isTransportRiskReason(point.reason)) return false;
  const rawPoint = rawById.get(point.sourceRawPointId);
  return !rawPoint || !Number.isFinite(rawPoint.accuracy)
    || rawPoint.accuracy <= config.weakCloudAccuracyMeters;
}

function isDirectionStableReason(reason) {
  return reason === 'first_fix_good'
    || reason === 'first_fix_relaxed'
    || reason === 'moving_good_fix';
}

function directionHistoryBefore(stableTrack, elapsedRealtimeNanos, config) {
  const before = stableTrack.filter((point) =>
    point.elapsedRealtimeNanos < elapsedRealtimeNanos);
  for (let index = before.length - 1; index > 0; index--) {
    const from = before[index - 1];
    const to = before[index];
    if (from.segmentId !== to.segmentId) continue;
    const line = directionLine(from, to);
    if (line && line.lengthMeters >= config.weakSignalDirectionHoldMinHistoryMeters) {
      return { from, to, line };
    }
  }
  return null;
}

function directionExitAfter(stableTrack, elapsedRealtimeNanos) {
  return stableTrack.find((point) => point.elapsedRealtimeNanos > elapsedRealtimeNanos) || null;
}

function weakSignalDirectionHint(run, history, exit, config) {
  const anchor = history.to;
  const items = run.map((rawPoint) =>
    weakSignalDirectionProjection(rawPoint, anchor, history.line));
  const maxForwardProgressMeters = Math.max(0,
    ...items.map((item) => item.progressMeters).filter(Number.isFinite));
  const maxBacktrackMeters = Math.max(0,
    ...items.map((item) => -item.progressMeters).filter(Number.isFinite));
  const maxLateralMeters = Math.max(0,
    ...items.map((item) => Math.abs(item.lateralMeters)).filter(Number.isFinite));
  const hintLengthMeters = clamp(
    Math.max(config.weakSignalDirectionHoldMinHintMeters, maxForwardProgressMeters),
    config.weakSignalDirectionHoldMinHintMeters,
    config.weakSignalDirectionHoldMaxHintMeters
  );
  const end = coordinateFromOrigin(anchor,
    history.line.unitX * hintLengthMeters,
    history.line.unitY * hintLengthMeters);
  const exitProjection = exit
    ? weakSignalDirectionProjection(exit, anchor, history.line)
    : null;
  const exitAligned = exitProjection
    && exitProjection.progressMeters > 0
    && Math.abs(exitProjection.lateralMeters) <= config.weakSignalDirectionHoldLateralMeters;
  const confidence = weakSignalDirectionConfidence(maxForwardProgressMeters,
    maxLateralMeters, exitProjection, exitAligned, config);
  return {
    kind: 'weak_signal_direction_hold',
    startRawPointId: run[0].rawPointId,
    endRawPointId: run.at(-1).rawPointId,
    rawPointIds: run.map((rawPoint) => rawPoint.rawPointId),
    rawPointCount: run.length,
    durationSeconds: Math.max(0,
      (run.at(-1).elapsedRealtimeNanos - run[0].elapsedRealtimeNanos) / 1_000_000_000),
    anchorTrackPointId: anchor.trackPointId,
    anchorRawPointId: anchor.sourceRawPointId,
    historyFromTrackPointId: history.from.trackPointId,
    headingDegrees: headingDegreesFromLine(history.line),
    startLat: anchor.lat,
    startLng: anchor.lng,
    endLat: end.lat,
    endLng: end.lng,
    hintLengthMeters,
    maxForwardProgressMeters,
    maxBacktrackMeters,
    maxLateralMeters,
    exitTrackPointId: exit?.trackPointId ?? null,
    exitRawPointId: exit?.sourceRawPointId ?? null,
    exitProgressMeters: exitProjection?.progressMeters ?? null,
    exitLateralMeters: exitProjection?.lateralMeters ?? null,
    confidence,
    status: weakSignalDirectionStatus(maxForwardProgressMeters, maxLateralMeters,
      exitProjection, exitAligned, config)
  };
}

function weakSignalDirectionProjection(point, origin, line) {
  const projected = projectCoordinateToOrigin(point.lat, point.lng, origin);
  return {
    progressMeters: projected.x * line.unitX + projected.y * line.unitY,
    lateralMeters: projected.x * -line.unitY + projected.y * line.unitX
  };
}

function weakSignalDirectionConfidence(maxForwardProgressMeters, maxLateralMeters,
  exitProjection, exitAligned, config) {
  if (exitAligned) return 'high';
  if (maxForwardProgressMeters >= config.weakSignalDirectionHoldMinHistoryMeters
      && maxLateralMeters <= config.weakSignalDirectionHoldLateralMeters) {
    return 'medium';
  }
  if (exitProjection && !exitAligned) return 'low';
  return 'low';
}

function weakSignalDirectionStatus(maxForwardProgressMeters, maxLateralMeters,
  exitProjection, exitAligned, config) {
  if (exitAligned) return 'confirmed_by_exit';
  if (exitProjection && !exitAligned) return 'exit_deviates_from_held_direction';
  if (maxForwardProgressMeters < config.weakSignalDirectionHoldMinHistoryMeters) {
    return 'weak_region_has_little_forward_progress';
  }
  if (maxLateralMeters > config.weakSignalDirectionHoldLateralMeters) {
    return 'weak_region_lateral_noise_high';
  }
  return 'history_direction_only';
}

function directionLine(from, to) {
  if (!from || !to) return null;
  const end = projectCoordinateToOrigin(to.lat, to.lng, from);
  const lengthMeters = Math.hypot(end.x, end.y);
  if (lengthMeters <= 0) return null;
  return {
    origin: { lat: from.lat, lng: from.lng },
    unitX: end.x / lengthMeters,
    unitY: end.y / lengthMeters,
    lengthMeters
  };
}

function headingDegreesFromLine(line) {
  const heading = degrees(Math.atan2(line.unitX, line.unitY));
  return heading < 0 ? heading + 360 : heading;
}

function adaptiveShadowTrackView(track) {
  return (track || []).map((point) => ({
    trackPointId: point.trackPointId,
    sourceRawPointId: point.sourceRawPointId,
    segmentId: point.segmentId,
    lat: point.lat,
    lng: point.lng,
    elapsedRealtimeNanos: point.elapsedRealtimeNanos,
    result: point.result,
    reason: point.reason,
    distanceDeltaMeters: point.distanceDeltaMeters,
    movingTimeDeltaSeconds: point.movingTimeDeltaSeconds,
    contributingRawPointIds: point.contributingRawPointIds || [],
    coordinateSource: point.coordinateSource || null,
    virtualCoordinate: point.virtualCoordinate === true
  }));
}

function adaptiveShadowImpact(fixedProduct, adaptiveProduct) {
  const fixed = shadowStatsView(fixedProduct?.stats);
  const adaptive = shadowStatsView(adaptiveProduct?.stats);
  return {
    fixed,
    adaptive,
    delta: shadowStatsDelta(fixed, adaptive)
  };
}

function shadowStatsView(stats = {}) {
  return {
    routeDistanceMeters: finiteNumberOrNull(stats.routeDistanceMeters),
    totalDistanceMeters: finiteNumberOrNull(stats.totalDistanceMeters),
    suspectedDistanceMeters: finiteNumberOrNull(stats.suspectedDistanceMeters),
    movingTimeSeconds: finiteNumberOrNull(stats.movingTimeSeconds),
    trustedPointCount: finiteNumberOrNull(stats.trustedPointCount),
    weakPointCount: finiteNumberOrNull(stats.weakPointCount),
    rejectedPointCount: finiteNumberOrNull(stats.rejectedPointCount),
    intakeRejectedPointCount: finiteNumberOrNull(stats.intakeRejectedPointCount),
    segmentCount: finiteNumberOrNull(stats.segmentCount),
    gapCount: finiteNumberOrNull(stats.gapCount),
    transportCount: finiteNumberOrNull(stats.transportCount)
  };
}

function shadowStatsDelta(fixed, adaptive) {
  return Object.fromEntries(Object.keys(fixed).map((key) => [
    key,
    Number.isFinite(fixed[key]) && Number.isFinite(adaptive[key])
      ? adaptive[key] - fixed[key]
      : null
  ]));
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function adaptiveShadowAssessment(summary, impact) {
  const changedCount = summary?.changedCount ?? 0;
  if (changedCount === 0) {
    return {
      level: 'same',
      label: '影子一致',
      summary: '固定阈值和自适应影子没有发现差异。',
      reasons: []
    };
  }

  const reasons = [];
  addAdaptiveShadowReason(reasons, summary?.truncated, 'difference_list_truncated', 'review',
    '分歧数量超过当前展示上限，需要先扩大明细采样再判断。');
  addAdaptiveShadowReason(reasons, (summary?.demotedFromTrustedCount ?? 0) > 0,
    'demoted_trusted_points', 'blocked',
    `影子会降级 ${summary.demotedFromTrustedCount} 个当前可信点，启用前必须逐点核对。`);
  addAdaptiveShadowReason(reasons, Math.abs(impact?.delta?.gapCount ?? 0) > 0,
    'gap_count_changed', 'review',
    `断点数量会变化 ${signedNumberForMessage(impact.delta.gapCount)}，可能改变 segment 和里程解释。`);
  addAdaptiveShadowReason(reasons, Math.abs(impact?.delta?.transportCount ?? 0) > 0,
    'transport_count_changed', 'review',
    `疑似交通点会变化 ${signedNumberForMessage(impact.delta.transportCount)}，需要核对是否误伤徒步。`);
  addAdaptiveShadowReason(reasons,
    exceedsAdaptiveShadowDistanceReview(impact?.delta?.routeDistanceMeters,
      impact?.fixed?.routeDistanceMeters),
    'route_distance_changed', 'review',
    `地图连线变化 ${metersForMessage(impact.delta.routeDistanceMeters)}，超过本样本复核线。`);
  addAdaptiveShadowReason(reasons,
    exceedsAdaptiveShadowDistanceReview(impact?.delta?.totalDistanceMeters,
      impact?.fixed?.totalDistanceMeters),
    'total_distance_changed', 'review',
    `运动里程变化 ${metersForMessage(impact.delta.totalDistanceMeters)}，超过本样本复核线。`);
  addAdaptiveShadowReason(reasons,
    exceedsAdaptiveShadowTrustedPointReview(impact?.delta?.trustedPointCount,
      impact?.fixed?.trustedPointCount),
    'trusted_point_count_changed', 'review',
    `可信点数量变化 ${signedNumberForMessage(impact.delta.trustedPointCount)}，需要确认轨迹形态是否更好。`);
  addAdaptiveShadowReason(reasons,
    adaptiveShadowChangedRate(summary) > ADAPTIVE_SHADOW_CHANGED_REVIEW_RATIO,
    'high_difference_rate', 'review',
    `判点分歧比例约 ${percentForMessage(adaptiveShadowChangedRate(summary))}，不宜直接启用。`);
  addAdaptiveShadowReason(reasons, (summary?.promotedToTrustedCount ?? 0) > 0,
    'promoted_trusted_points', 'observe',
    `影子可能救回 ${summary.promotedToTrustedCount} 个点，需要看这些点是否真的贴合路线。`);
  addAdaptiveShadowReason(reasons, (summary?.reasonChangedCount ?? 0) > 0,
    'reason_changed', 'observe',
    `有 ${summary.reasonChangedCount} 个点的解释原因变化，适合先作为诊断观察。`);

  const level = adaptiveShadowAssessmentLevel(reasons);
  return {
    level,
    label: adaptiveShadowAssessmentLabel(level),
    summary: adaptiveShadowAssessmentSummary(level),
    reasons
  };
}

function addAdaptiveShadowReason(reasons, condition, code, severity, message) {
  if (!condition) return;
  reasons.push({ code, severity, message });
}

function adaptiveShadowAssessmentLevel(reasons) {
  if (reasons.some((reason) => reason.severity === 'blocked')) return 'blocked';
  if (reasons.some((reason) => reason.severity === 'review')) return 'review';
  return 'observe';
}

function adaptiveShadowAssessmentLabel(level) {
  if (level === 'blocked') return '暂不适合启用';
  if (level === 'review') return '需要人工复核';
  if (level === 'observe') return '继续观察';
  return '影子一致';
}

function adaptiveShadowAssessmentSummary(level) {
  if (level === 'blocked') return '影子会降级当前可信轨迹点，当前样本不能作为启用依据。';
  if (level === 'review') return '影子会改变关键轨迹统计，需要结合真实路线逐段复核。';
  if (level === 'observe') return '差异主要是救回或原因变化，先扩大真实样本观察。';
  return '固定阈值和自适应影子没有发现差异。';
}

function exceedsAdaptiveShadowDistanceReview(delta, fixedValue) {
  if (!Number.isFinite(delta)) return false;
  const limit = Math.max(ADAPTIVE_SHADOW_DISTANCE_REVIEW_METERS,
    Math.abs(fixedValue || 0) * ADAPTIVE_SHADOW_DISTANCE_REVIEW_RATIO);
  return Math.abs(delta) > limit;
}

function exceedsAdaptiveShadowTrustedPointReview(delta, fixedValue) {
  if (!Number.isFinite(delta)) return false;
  const limit = Math.max(ADAPTIVE_SHADOW_TRUSTED_POINT_REVIEW_MIN_DELTA,
    Math.ceil(Math.abs(fixedValue || 0) * ADAPTIVE_SHADOW_TRUSTED_POINT_REVIEW_RATIO));
  return Math.abs(delta) >= limit;
}

function adaptiveShadowChangedRate(summary) {
  const rawPointCount = summary?.rawPointCount ?? 0;
  return rawPointCount > 0 ? (summary?.changedCount ?? 0) / rawPointCount : 0;
}

function signedNumberForMessage(value) {
  if (!Number.isFinite(value) || value === 0) return '0';
  return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

function metersForMessage(value) {
  if (!Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}m`;
}

function percentForMessage(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function adaptiveShadowConfig(config, profile, fields = ADAPTIVE_SHADOW_FIELD_NAMES,
  overrides = null) {
  const selectedFields = new Set(fields);
  const adaptiveValues = {
    weakCloudAccuracyMeters: adaptiveWeakCloudAccuracyMeters(config, profile),
    gapSeconds: adaptiveGapSeconds(config, profile),
    stationaryDistanceMeters: adaptiveStationaryDistanceMeters(config, profile),
    transportSpeedMetersPerSecond: adaptiveTransportSpeedMetersPerSecond(config, profile),
    transportMinDistanceMeters: adaptiveTransportMinDistanceMeters(config, profile),
    continuityRescueMaxSpeedMetersPerSecond: adaptiveContinuitySpeedMetersPerSecond(config, profile)
  };
  const nextConfig = { ...config };
  for (const field of ADAPTIVE_SHADOW_FIELD_NAMES) {
    if (selectedFields.has(field)) nextConfig[field] = adaptiveValues[field];
  }
  applyAdaptiveShadowOverrides(nextConfig, overrides, config, profile);
  return normalizeConfig(nextConfig);
}

function applyAdaptiveShadowOverrides(nextConfig, overrides, baseConfig, profile) {
  for (const [field, value] of Object.entries(overrides || {})) {
    nextConfig[field] = typeof value === 'function' ? value(baseConfig, profile) : value;
  }
}

function adaptiveWeakCloudAccuracyMeters(config, profile) {
  const candidate = profile?.accuracy?.p75Meters ?? config.weakCloudAccuracyMeters;
  return clamp(candidate, 20, 50);
}

function adaptiveGapSeconds(config, profile) {
  const normalInterval = profile?.sampleInterval?.p50Seconds
    ?? profile?.sampleInterval?.p75Seconds
    ?? profile?.sampleInterval?.p90Seconds;
  if (!Number.isFinite(normalInterval) || normalInterval <= 0) return config.gapSeconds;
  return clamp(normalInterval * 6, 30, 180);
}

function adaptiveStationaryDistanceMeters(config, profile) {
  const candidate = profile?.stationary?.radiusP75Meters ?? config.stationaryDistanceMeters;
  return clamp(Math.max(config.stationaryDistanceMeters, candidate), 3, 25);
}

function adaptiveTransportSpeedMetersPerSecond(config, profile) {
  const walkingHigh = profile?.movement?.plausibleWalkingSpeedP90MetersPerSecond;
  if (!Number.isFinite(walkingHigh) || walkingHigh <= 0) {
    return config.transportSpeedMetersPerSecond;
  }
  return clamp(walkingHigh * 1.35, 2.5, 5);
}

function adaptiveTransportMinDistanceMeters(config, profile) {
  const adjacentHigh = profile?.movement?.adjacentDistanceP90Meters;
  if (!Number.isFinite(adjacentHigh) || adjacentHigh <= 0) return config.transportMinDistanceMeters;
  return clamp(Math.max(config.transportMinDistanceMeters, adjacentHigh * 1.5), 15, 60);
}

function adaptiveContinuitySpeedMetersPerSecond(config, profile) {
  const walkingHigh = profile?.movement?.plausibleWalkingSpeedP90MetersPerSecond;
  if (!Number.isFinite(walkingHigh) || walkingHigh <= 0) {
    return config.continuityRescueMaxSpeedMetersPerSecond;
  }
  return clamp(walkingHigh * 1.6, 3, 8);
}

function shadowThresholdsFromConfig(config) {
  return {
    weakCloudAccuracyMeters: config.weakCloudAccuracyMeters,
    gapSeconds: config.gapSeconds,
    stationaryDistanceMeters: config.stationaryDistanceMeters,
    transportSpeedMetersPerSecond: config.transportSpeedMetersPerSecond,
    transportMinDistanceMeters: config.transportMinDistanceMeters,
    continuityRescueMaxSpeedMetersPerSecond: config.continuityRescueMaxSpeedMetersPerSecond,
    lowAccuracyRescueMaxAccuracyMeters: config.lowAccuracyRescueMaxAccuracyMeters,
    lowAccuracyRescueMinDistanceMeters: config.lowAccuracyRescueMinDistanceMeters,
    weakSignalDirectionHoldEnabled: config.weakSignalDirectionHoldEnabled
  };
}

function rawDecisionMapFromProduct(product) {
  const decisions = new Map();
  for (const point of product.track || []) {
    setShadowDecision(decisions, point.sourceRawPointId, {
      bucket: 'track',
      result: point.result,
      reason: point.reason,
      trackPointId: point.trackPointId
    });
    for (const rawPointId of point.contributingRawPointIds || []) {
      setShadowDecision(decisions, rawPointId, {
        bucket: 'track_contributing',
        result: point.result,
        reason: point.reason,
        trackPointId: point.trackPointId,
        representativeRawPointId: point.sourceRawPointId
      });
    }
  }
  for (const bucket of ['weak', 'rejected', 'intakeRejected']) {
    for (const point of product.excluded?.[bucket] || []) {
      setShadowDecision(decisions, point.rawPointId, {
        bucket,
        result: point.result,
        reason: point.reason
      });
    }
  }
  return decisions;
}

function setShadowDecision(decisions, rawPointId, decision) {
  if (!Number.isFinite(rawPointId) || decisions.has(rawPointId)) return;
  decisions.set(rawPointId, decision);
}

function emptyShadowDecision() {
  return { bucket: 'missing', result: 'missing', reason: 'missing' };
}

function sameShadowDecision(left, right) {
  return left.bucket === right.bucket
    && left.result === right.result
    && left.reason === right.reason;
}

function shadowDecisionView(decision) {
  return {
    bucket: decision.bucket,
    result: decision.result,
    reason: decision.reason,
    trackPointId: decision.trackPointId ?? null,
    representativeRawPointId: decision.representativeRawPointId ?? null
  };
}

function isTrustedShadowDecision(decision) {
  return decision.bucket === 'track' || decision.bucket === 'track_contributing';
}

function adaptiveShadowChangeType(fixed, adaptive) {
  if (!isTrustedShadowDecision(fixed) && isTrustedShadowDecision(adaptive)) {
    return 'promoted_to_trusted';
  }
  if (isTrustedShadowDecision(fixed) && !isTrustedShadowDecision(adaptive)) {
    return 'demoted_from_trusted';
  }
  return 'reason_changed';
}

function buildSessionProfile(evidence, config) {
  const rawPoints = evidence.rawPoints || [];
  const validTimeRawPoints = rawPoints.filter((point) =>
    Number.isFinite(point.elapsedRealtimeNanos) && point.elapsedRealtimeNanos > 0);
  const validCoordinateRawPoints = validTimeRawPoints.filter((point) =>
    validCoordinate(point.lat, point.lng));
  const intervalsSeconds = [];
  const adjacentDistancesMeters = [];
  const adjacentSpeedsMetersPerSecond = [];
  const plausibleWalkingSpeedsMetersPerSecond = [];
  let sameTimestampCount = 0;
  let longGapCount = 0;

  for (let index = 1; index < validTimeRawPoints.length; index++) {
    const previous = validTimeRawPoints[index - 1];
    const current = validTimeRawPoints[index];
    const elapsedDelta = current.elapsedRealtimeNanos - previous.elapsedRealtimeNanos;
    if (elapsedDelta <= 0) {
      sameTimestampCount++;
      continue;
    }
    const deltaSeconds = elapsedDelta / 1_000_000_000;
    intervalsSeconds.push(deltaSeconds);
    if (deltaSeconds > config.gapSeconds) longGapCount++;
    if (validCoordinate(previous.lat, previous.lng) && validCoordinate(current.lat, current.lng)) {
      const distance = distanceMeters(previous.lat, previous.lng, current.lat, current.lng);
      const speed = distance / deltaSeconds;
      adjacentDistancesMeters.push(distance);
      adjacentSpeedsMetersPerSecond.push(speed);
      if (speed > 0 && speed <= config.continuityRescueMaxSpeedMetersPerSecond) {
        plausibleWalkingSpeedsMetersPerSecond.push(speed);
      }
    }
  }

  const accuracies = rawPoints
    .map((point) => point.accuracy)
    .filter((value) => Number.isFinite(value) && value > 0);
  const accuracyProfile = {
    sampleCount: accuracies.length,
    p50Meters: percentile(accuracies, 0.5),
    p75Meters: percentile(accuracies, 0.75),
    p90Meters: percentile(accuracies, 0.9),
    weakRatio: ratio(accuracies.filter((value) =>
      value > config.weakCloudAccuracyMeters).length, accuracies.length)
  };

  return {
    version: 1,
    raw: {
      sampleCount: rawPoints.length,
      validTimeSampleCount: validTimeRawPoints.length,
      validCoordinateSampleCount: validCoordinateRawPoints.length,
      missingElapsedRealtimeCount: rawPoints.length - validTimeRawPoints.length,
      invalidCoordinateCount: validTimeRawPoints.length - validCoordinateRawPoints.length,
      duplicateLikeCount: duplicateLikeCount(rawPoints),
      sameTimestampCount
    },
    sampleInterval: {
      sampleCount: intervalsSeconds.length,
      p50Seconds: percentile(intervalsSeconds, 0.5),
      p75Seconds: percentile(intervalsSeconds, 0.75),
      p90Seconds: percentile(intervalsSeconds, 0.9),
      maxSeconds: maxOrNull(intervalsSeconds),
      longGapCount
    },
    accuracy: accuracyProfile,
    movement: {
      adjacentSampleCount: adjacentSpeedsMetersPerSecond.length,
      adjacentDistanceP50Meters: percentile(adjacentDistancesMeters, 0.5),
      adjacentDistanceP90Meters: percentile(adjacentDistancesMeters, 0.9),
      adjacentSpeedP50MetersPerSecond: percentile(adjacentSpeedsMetersPerSecond, 0.5),
      adjacentSpeedP75MetersPerSecond: percentile(adjacentSpeedsMetersPerSecond, 0.75),
      adjacentSpeedP90MetersPerSecond: percentile(adjacentSpeedsMetersPerSecond, 0.9),
      plausibleWalkingSpeedP90MetersPerSecond: percentile(plausibleWalkingSpeedsMetersPerSecond, 0.9)
    },
    stationary: stationaryNoiseProfile(validCoordinateRawPoints, evidence.motionIndex,
      accuracyProfile.p50Meters, config),
    motion: motionProfile(evidence.motionSummaries)
  };
}

function stationaryNoiseProfile(rawPoints, motionSummaries, medianAccuracyMeters, config) {
  const stillRawPoints = rawPoints.filter((point) =>
    hasRecentStillMotion(point.elapsedRealtimeNanos, motionSummaries));
  const clusterBreakDistanceMeters = Math.max(config.stationaryDistanceMeters,
    (medianAccuracyMeters ?? config.weakCloudAccuracyMeters) * config.stationaryAccuracyMultiplier * 2);
  const radiusSamples = [];
  let cluster = [];
  for (const rawPoint of stillRawPoints) {
    const previous = cluster.at(-1);
    if (previous) {
      const elapsedDelta = rawPoint.elapsedRealtimeNanos - previous.elapsedRealtimeNanos;
      const distance = distanceMeters(previous.lat, previous.lng, rawPoint.lat, rawPoint.lng);
      if (elapsedDelta > config.gapSeconds * 1_000_000_000
          || distance > clusterBreakDistanceMeters) {
        appendStationaryClusterRadii(radiusSamples, cluster);
        cluster = [];
      }
    }
    cluster.push(rawPoint);
  }
  appendStationaryClusterRadii(radiusSamples, cluster);
  return {
    stillRawPointCount: stillRawPoints.length,
    radiusSampleCount: radiusSamples.length,
    radiusP50Meters: percentile(radiusSamples, 0.5),
    radiusP75Meters: percentile(radiusSamples, 0.75),
    radiusP90Meters: percentile(radiusSamples, 0.9)
  };
}

function appendStationaryClusterRadii(radiusSamples, cluster) {
  if (!Array.isArray(cluster) || cluster.length < 2) return;
  const lat = cluster.reduce((sum, point) => sum + point.lat, 0) / cluster.length;
  const lng = cluster.reduce((sum, point) => sum + point.lng, 0) / cluster.length;
  for (const point of cluster) {
    radiusSamples.push(distanceMeters(lat, lng, point.lat, point.lng));
  }
}

function motionProfile(motionSummaries) {
  const summaries = motionSummaries || [];
  const stillCount = summaries.filter((summary) =>
    summary.deviceStill === true || summary.isDeviceStill === true).length;
  const activeCount = summaries.filter(isActiveMotionSummary).length;
  return {
    windowCount: summaries.length,
    stillRatio: ratio(stillCount, summaries.length),
    activeRatio: ratio(activeCount, summaries.length)
  };
}

function isActiveMotionSummary(summary) {
  const accel = numberField(summary, 'dynamicAccelRmsMps2') ?? 0;
  const gyro = numberField(summary, 'gyroscopeRmsRadps') ?? 0;
  const stepDelta = numberField(summary, 'stepDelta') ?? 0;
  const stepDetectorCount = numberField(summary, 'stepDetectorCount') ?? 0;
  return accel > 0.25 || gyro > 0.08 || stepDelta > 0 || stepDetectorCount > 0;
}

function duplicateLikeCount(rawPoints) {
  const keys = new Set();
  let count = 0;
  for (const rawPoint of rawPoints || []) {
    if (!Number.isFinite(rawPoint.elapsedRealtimeNanos)
        || !validCoordinate(rawPoint.lat, rawPoint.lng)
        || !Number.isFinite(rawPoint.accuracy)) {
      continue;
    }
    const key = `${rawPoint.provider}|${rawPoint.elapsedRealtimeNanos}|${rawPoint.lat.toFixed(7)}|${rawPoint.lng.toFixed(7)}|${rawPoint.accuracy.toFixed(2)}`;
    if (keys.has(key)) {
      count++;
    } else {
      keys.add(key);
    }
  }
  return count;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const weight = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
}

function maxOrNull(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null;
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function computeBarometerAscent(barometerWindows) {
  const engine = createBarometerAscentEngine();
  const windows = [...(barometerWindows || [])].sort((a, b) =>
    (a.endElapsedRealtimeNanos ?? 0) - (b.endElapsedRealtimeNanos ?? 0));
  for (const window of windows) {
    engine.onSample({
      elapsedRealtimeNanos: window.endElapsedRealtimeNanos,
      pressureHpa: window.avgPressureHpa,
      altitudeMeters: window.avgRawAltitudeMeters
    });
  }
  return engine.finish();
}

function createBarometerAscentEngine() {
  let totalAscentMeters = 0;
  let filteredAltitude = null;
  let baseAltitude = null;
  let peakAltitude = null;
  let lastAltitude = null;
  let lastElapsedRealtimeNanos = 0;
  let hasReliableSample = false;
  let sampleCount = 0;
  let rejectedSampleCount = 0;

  function resetAltitudeAnchor(sample) {
    flushPendingGain();
    filteredAltitude = null;
    baseAltitude = null;
    peakAltitude = null;
    lastAltitude = null;
    lastElapsedRealtimeNanos = 0;
    sampleCount++;
    const altitude = filter(sample.altitudeMeters);
    baseAltitude = altitude;
    peakAltitude = altitude;
    lastAltitude = altitude;
    lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
    hasReliableSample = true;
  }

  function filter(altitudeMeters) {
    if (filteredAltitude === null) {
      filteredAltitude = altitudeMeters;
    } else {
      filteredAltitude = BAROMETER_ASCENT_ALPHA * altitudeMeters
        + (1 - BAROMETER_ASCENT_ALPHA) * filteredAltitude;
    }
    return filteredAltitude;
  }

  function passesPhysicalGate(sample) {
    if (lastAltitude === null || lastElapsedRealtimeNanos <= 0) return true;
    if (sample.elapsedRealtimeNanos <= lastElapsedRealtimeNanos) return false;
    const elapsedSeconds =
      (sample.elapsedRealtimeNanos - lastElapsedRealtimeNanos) / 1_000_000_000;
    if (elapsedSeconds <= 0) return true;
    const verticalSpeed = Math.abs(sample.altitudeMeters - lastAltitude) / elapsedSeconds;
    return verticalSpeed <= BAROMETER_ASCENT_MAX_VERTICAL_SPEED_METERS_PER_SECOND;
  }

  function acceptedPendingGain() {
    if (baseAltitude === null || peakAltitude === null) return 0;
    const pendingGain = peakAltitude - baseAltitude;
    return pendingGain >= BAROMETER_ASCENT_CLIMB_THRESHOLD_METERS ? pendingGain : 0;
  }

  function flushPendingGain() {
    totalAscentMeters += acceptedPendingGain();
  }

  function updateTrend(altitude, sample) {
    hasReliableSample = true;
    if (baseAltitude === null) {
      baseAltitude = altitude;
      peakAltitude = altitude;
      lastAltitude = altitude;
      lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
      return;
    }
    if (altitude >= peakAltitude) {
      peakAltitude = altitude;
      lastAltitude = altitude;
      lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
      return;
    }

    const drop = peakAltitude - altitude;
    const pendingGain = peakAltitude - baseAltitude;
    if (drop >= BAROMETER_ASCENT_DROP_THRESHOLD_METERS) {
      if (pendingGain >= BAROMETER_ASCENT_CLIMB_THRESHOLD_METERS) {
        totalAscentMeters += pendingGain;
      }
      baseAltitude = altitude;
      peakAltitude = altitude;
    }
    lastAltitude = altitude;
    lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
  }

  function acceptSample(sample) {
    sampleCount++;
    const altitude = filter(sample.altitudeMeters);
    updateTrend(altitude, sample);
  }

  return {
    onSample(sample) {
      if (!sample
          || !Number.isFinite(sample.elapsedRealtimeNanos)
          || !Number.isFinite(sample.pressureHpa)
          || sample.pressureHpa <= 0
          || !Number.isFinite(sample.altitudeMeters)) {
        rejectedSampleCount++;
        return;
      }
      if (lastElapsedRealtimeNanos > 0
          && sample.elapsedRealtimeNanos - lastElapsedRealtimeNanos
          > BAROMETER_ASCENT_MAX_SAMPLE_GAP_NANOS) {
        resetAltitudeAnchor(sample);
        return;
      }
      if (!passesPhysicalGate(sample)) {
        rejectedSampleCount++;
        return;
      }
      acceptSample(sample);
    },
    finish() {
      return {
        totalAscentMeters: hasReliableSample && sampleCount >= 2
          ? totalAscentMeters + acceptedPendingGain()
          : -1,
        sampleCount,
        rejectedSampleCount
      };
    }
  };
}

function computeLocationAltitudeAscent(track, rawPoints, config) {
  const rawById = new Map(rawPoints.map((point) => [point.rawPointId, point]));
  const samples = [];
  let rejectedSampleCount = 0;
  for (const point of track) {
    if (isTransportRiskReason(point.reason)) {
      rejectedSampleCount++;
      continue;
    }
    const rawPoint = rawById.get(point.sourceRawPointId);
    if (!rawPoint || !Number.isFinite(rawPoint.altitude)) {
      rejectedSampleCount++;
      continue;
    }
    if (!Number.isFinite(rawPoint.verticalAccuracy)
        || rawPoint.verticalAccuracy > config.locationAltitudeAscentMaxVerticalAccuracyMeters) {
      rejectedSampleCount++;
      continue;
    }
    samples.push({
      altitude: rawPoint.altitude,
      verticalAccuracy: rawPoint.verticalAccuracy,
      elapsedRealtimeNanos: point.elapsedRealtimeNanos,
      segmentId: point.segmentId
    });
  }
  samples.sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos);
  if (samples.length < 2) {
    return emptyLocationAltitudeAscent(samples.length, rejectedSampleCount);
  }
  let totalAscentMeters = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous.segmentId !== current.segmentId) continue;
    const gain = current.altitude - previous.altitude;
    if (gain < config.locationAltitudeAscentMinGainMeters) continue;
    if (gain > config.locationAltitudeAscentMaxStepGainMeters) {
      rejectedSampleCount++;
      continue;
    }
    totalAscentMeters += gain;
  }
  const verticalAccuracies = samples.map((sample) => sample.verticalAccuracy);
  return {
    totalAscentMeters,
    sampleCount: samples.length,
    usableSampleCount: samples.length,
    rejectedSampleCount,
    minVerticalAccuracyMeters: Math.min(...verticalAccuracies),
    maxVerticalAccuracyMeters: Math.max(...verticalAccuracies),
    avgVerticalAccuracyMeters: verticalAccuracies.reduce((sum, value) => sum + value, 0)
      / verticalAccuracies.length
  };
}

function emptyLocationAltitudeAscent(sampleCount, rejectedSampleCount) {
  return {
    totalAscentMeters: -1,
    sampleCount,
    usableSampleCount: sampleCount,
    rejectedSampleCount,
    minVerticalAccuracyMeters: null,
    maxVerticalAccuracyMeters: null,
    avgVerticalAccuracyMeters: null
  };
}

function sumTrackField(track, field) {
  return track.reduce((sum, point) => sum + (Number.isFinite(point[field]) ? point[field] : 0), 0);
}

function routeDistanceMeters(track) {
  let total = 0;
  for (let index = 1; index < track.length; index++) {
    const previous = track[index - 1];
    const current = track[index];
    if (previous.segmentId !== current.segmentId) continue;
    if (!Number.isFinite(current.distanceDeltaMeters) || current.distanceDeltaMeters <= 0) continue;
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
    lowAccuracyRescueMaxAccuracyMeters: positiveNumber(merged.lowAccuracyRescueMaxAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.lowAccuracyRescueMaxAccuracyMeters),
    lowAccuracyRescueMinDistanceMeters: positiveNumber(merged.lowAccuracyRescueMinDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.lowAccuracyRescueMinDistanceMeters),
    weakSignalDirectionHoldEnabled: merged.weakSignalDirectionHoldEnabled === true,
    weakSignalDirectionHoldMinHistoryMeters: positiveNumber(merged.weakSignalDirectionHoldMinHistoryMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakSignalDirectionHoldMinHistoryMeters),
    weakSignalDirectionHoldMinHintMeters: positiveNumber(merged.weakSignalDirectionHoldMinHintMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakSignalDirectionHoldMinHintMeters),
    weakSignalDirectionHoldMaxHintMeters: positiveNumber(merged.weakSignalDirectionHoldMaxHintMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakSignalDirectionHoldMaxHintMeters),
    weakSignalDirectionHoldLateralMeters: positiveNumber(merged.weakSignalDirectionHoldLateralMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakSignalDirectionHoldLateralMeters),
    weakSignalDirectionHoldMinRunPoints: positiveNumber(merged.weakSignalDirectionHoldMinRunPoints, DEFAULT_TARGET_PRODUCT_CONFIG.weakSignalDirectionHoldMinRunPoints),
    gapSeconds: positiveNumber(merged.gapSeconds, DEFAULT_TARGET_PRODUCT_CONFIG.gapSeconds),
    stationaryDistanceMeters: positiveNumber(merged.stationaryDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryDistanceMeters),
    stationaryAccuracyMultiplier: positiveNumber(merged.stationaryAccuracyMultiplier, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryAccuracyMultiplier),
    impossibleSpeedMetersPerSecond: positiveNumber(merged.impossibleSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.impossibleSpeedMetersPerSecond),
    transportSpeedMetersPerSecond: positiveNumber(merged.transportSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.transportSpeedMetersPerSecond),
    transportMinDistanceMeters: positiveNumber(merged.transportMinDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.transportMinDistanceMeters),
    cloudTemporalDecaySeconds: positiveNumber(merged.cloudTemporalDecaySeconds, DEFAULT_TARGET_PRODUCT_CONFIG.cloudTemporalDecaySeconds),
    collapseStationarySession: merged.collapseStationarySession !== false,
    lowQualityMotionRebuildEnabled: merged.lowQualityMotionRebuildEnabled === true,
    stationarySessionStillRatio: positiveNumber(merged.stationarySessionStillRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionStillRatio),
    stationarySessionAnchorRatio: positiveNumber(merged.stationarySessionAnchorRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionAnchorRatio),
    barometerCleaningEnabled: merged.barometerCleaningEnabled === true,
    barometerVerticalMotionMinRangeMeters: positiveNumber(merged.barometerVerticalMotionMinRangeMeters, DEFAULT_TARGET_PRODUCT_CONFIG.barometerVerticalMotionMinRangeMeters),
    barometerVerticalMotionMinWindowCount: positiveNumber(merged.barometerVerticalMotionMinWindowCount, DEFAULT_TARGET_PRODUCT_CONFIG.barometerVerticalMotionMinWindowCount),
    locationAltitudeAscentMaxVerticalAccuracyMeters: positiveNumber(
      merged.locationAltitudeAscentMaxVerticalAccuracyMeters,
      DEFAULT_TARGET_PRODUCT_CONFIG.locationAltitudeAscentMaxVerticalAccuracyMeters),
    locationAltitudeAscentMinGainMeters: positiveNumber(
      merged.locationAltitudeAscentMinGainMeters,
      DEFAULT_TARGET_PRODUCT_CONFIG.locationAltitudeAscentMinGainMeters),
    locationAltitudeAscentMaxStepGainMeters: positiveNumber(
      merged.locationAltitudeAscentMaxStepGainMeters,
      DEFAULT_TARGET_PRODUCT_CONFIG.locationAltitudeAscentMaxStepGainMeters)
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
  const shouldCollapseByMotion = stillRatio >= product.config.stationarySessionStillRatio
    && stationaryAnchorRatio >= product.config.stationarySessionAnchorRatio;
  const shouldCollapseByZeroMovement = isZeroMovementStationaryProduct(product);
  if (!shouldCollapseByMotion && !shouldCollapseByZeroMovement) {
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

function isZeroMovementStationaryProduct(product) {
  if (product.track.length === 0 || product.stats.transportCount > 0) {
    return false;
  }
  if (product.track.some((point) =>
    Number.isFinite(point.distanceDeltaMeters) && point.distanceDeltaMeters > 0)) {
    return false;
  }
  if (!product.track.some((point) => point.reason === 'stationary_anchor')) {
    return false;
  }
  return product.track.every((point) => isStationaryCollapseReason(point.reason));
}

function isStationaryCollapseReason(reason) {
  return reason === 'first_fix_good'
    || reason === 'first_fix_relaxed'
    || reason === 'stationary_anchor'
    || reason === 'gap_recovery'
    || reason === 'continuity_rescue_gap_recovery'
    || reason === 'stationary_session_anchor';
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
    samplingEpochs,
    motionSummaries,
    motionIndex: createRecentMotionSummaryIndex(motionSummaries, MOTION_WINDOW_NANOS),
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
    altitude: numberField(event, 'altitude'),
    verticalAccuracy: numberField(event, 'verticalAccuracy'),
    speed: numberField(event, 'speed'),
    hasSpeed: event.hasSpeed === true || numberField(event, 'speed') !== null,
    timeMillis: numberField(event, 'timeMillis'),
    elapsedRealtimeNanos: numberField(event, 'elapsedRealtimeNanos'),
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
    barometerWindowId: numberField(event, 'barometerWindowId'),
    startElapsedRealtimeNanos: numberField(event, 'startElapsedRealtimeNanos'),
    endElapsedRealtimeNanos: numberField(event, 'endElapsedRealtimeNanos'),
    sampleCount: numberField(event, 'sampleCount'),
    avgPressureHpa: numberField(event, 'avgPressureHpa'),
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

function createTrackTrustEngine(config) {
  let nextCloudId = 1;
  let currentCloud = null;
  let currentCloudType = '';
  let resetMovingCloudAfterAccept = false;
  let recoveryPreviousRawPoint = null;

  return {
    decide(rawPoint, epoch, motionSummaries, previousTrustedTrackPoint) {
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

      const cloud = currentCloud.add(rawPoint, motionSummaries);
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
        if (isLowAccuracyRescuePoint(rawPoint, previousTrustedTrackPoint, config)) {
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

function isLowAccuracyRescuePoint(rawPoint, previousTrustedTrackPoint, config) {
  if (!isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint, config)) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.lowAccuracyRescueMaxAccuracyMeters) {
    return false;
  }
  const distance = distanceMeters(previousTrustedTrackPoint.lat, previousTrustedTrackPoint.lng,
    rawPoint.lat, rawPoint.lng);
  return distance >= config.lowAccuracyRescueMinDistanceMeters;
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

  add(rawPoint, motionSummaries) {
    if (!this.origin) this.origin = rawPoint;
    this.samples.push({
      rawPoint,
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
      && (!sample.rawPoint.hasSpeed || sample.rawPoint.speed <= 2.5);
  }

  baseWeight(sample, latestElapsed) {
    const accuracyWeight = clamp(1 / Math.max(sample.rawPoint.accuracy, 3), 0.01, 0.33);
    const motionWeightValue = Math.max(0.25,
      scoreFromMotion(this.cloudType, sample.rawPoint, sample.recentStillMotion) / 100);
    const ageSeconds = Math.max(0,
      (latestElapsed - sample.rawPoint.elapsedRealtimeNanos) / 1_000_000_000);
    const temporalWeight = Math.exp(-ageSeconds / this.config.cloudTemporalDecaySeconds);
    return accuracyWeight * motionWeightValue * temporalWeight;
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

function scoreFromMotion(cloudType, rawPoint, recentStillMotion) {
  const still = recentStillMotion === true;
  if (cloudType === 'STATIONARY_CLOUD') return still ? 100 : 50;
  if (cloudType === 'MOVING_CLOUD') return rawPoint.hasSpeed && rawPoint.speed > 0.5 ? 100 : 70;
  if (cloudType === 'RECOVERY_CLOUD') {
    return still && (!rawPoint.hasSpeed || rawPoint.speed <= 0.5) ? 80 : 70;
  }
  return 50;
}

function hasRecentStillMotion(elapsedRealtimeNanos, motionSource) {
  const stats = recentMotionStats(elapsedRealtimeNanos, motionSource, MOTION_WINDOW_NANOS);
  return stats.total > 0 && stats.still / stats.total >= 0.75;
}

function hasRecentActiveMotion(elapsedRealtimeNanos, motionSource) {
  const stats = recentMotionStats(elapsedRealtimeNanos, motionSource, MOTION_WINDOW_NANOS);
  return stats.total > 0 && stats.active / stats.total >= 0.5;
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
  if (product.lowQualityMotionRebuild?.mode === 'review_only'
      && product.lowQualityMotionRebuild.candidateCount > 0) {
    findings.push(`发现 ${product.lowQualityMotionRebuild.candidateCount} 段低质量运动重建候选，默认仅复核不进入成品轨迹`);
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
      intakeRejectedPointCount: 0,
      locationAltitudeTotalAscentMeters: -1,
      locationAltitudeAscentSampleCount: 0,
      locationAltitudeAscentRejectedSampleCount: 0,
      locationAltitudeAscentUsableSampleCount: 0,
      locationAltitudeAscentMinVerticalAccuracyMeters: null,
      locationAltitudeAscentMaxVerticalAccuracyMeters: null,
      locationAltitudeAscentAvgVerticalAccuracyMeters: null,
      barometerTotalAscentMeters: -1,
      barometerAscentSampleCount: 0,
      barometerAscentRejectedSampleCount: 0,
      selectedTotalAscentMeters: -1,
      selectedAscentSource: 'NONE'
    },
    findings: [],
    lowQualityMotionRebuild: {
      mode: 'review_only',
      candidateCount: 0,
      candidates: [],
      rawIntervalCandidateCount: 0,
      rawIntervalCandidates: [],
      rawIntervalScan: {
        scannedIntervalCount: 0,
        rejectedIntervalCount: 0
      },
      scannedMovingGoodFixCount: 0,
      skipped: {
        transportBoundary: 0,
        missingLowQualityBoundary: 0,
        sourceOutsideInterval: 0,
        criteriaRejected: 0,
        lowQualityMixRejected: 0,
        trackAlreadyExpressed: 0,
        structureTooShort: 0
      },
      rejectedExamples: []
    },
    adaptiveShadow: null,
    adaptiveShadows: []
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
