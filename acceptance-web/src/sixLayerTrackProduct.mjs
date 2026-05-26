import { createRecentMotionSummaryIndex, recentMotionStats } from './timeWindowIndex.mjs';

const EARTH_RADIUS_METERS = 6_371_000;
const START_TOLERANCE_NANOS = 1_000_000_000;
const MOTION_LOOKBACK_NANOS = 5_000_000_000;
const NANOS_PER_SECOND = 1_000_000_000;

export const SIX_LAYER_TRACK_ALGORITHM_VERSION = 'six-layer-evidence-v17.0';

export const DEFAULT_SIX_LAYER_TRACK_CONFIG = Object.freeze({
  maxIntakeAccuracyMeters: 80,
  weakCloudAccuracyMeters: 30,
  firstFixGoodAccuracyMeters: 20,
  firstFixRelaxedAccuracyMeters: 30,
  gapSeconds: 120,
  recoveryCloudMinSamples: 2,
  recoveryFastPathAccuracyMeters: 10,
  recoveryFastPathMaxSpeedMetersPerSecond: 2.5,
  stationarySessionCollapseEnabled: true,
  stationarySessionMinRawPoints: 20,
  stationarySessionMinDurationSeconds: 60,
  stationarySessionMaxBboxMeters: 80,
  stationarySessionMaxNetDistanceMeters: 80,
  stationarySessionMaxPathRateMetersPerSecond: 0.05,
  stationarySessionMinSpeedSampleRatio: 0.8,
  stationarySessionMinZeroSpeedRatio: 0.95,
  stationarySessionMaxAverageReportedSpeedMetersPerSecond: 0.3,
  dwellDriftCollapseEnabled: true,
  dwellDriftCoreAccuracyMeters: 30,
  dwellDriftMinCoreSamples: 10,
  dwellDriftMinRawPoints: 20,
  dwellDriftMinDurationSeconds: 60,
  dwellDriftMaxCoreGapSeconds: 60,
  dwellDriftMaxExtensionGapSeconds: 10,
  dwellDriftMaxExtensionPathMeters: 40,
  dwellDriftMaxReportedSpeedMetersPerSecond: 1.6,
  dwellDriftMaxAverageSpeedMetersPerSecond: 1.5,
  dwellDriftMinZeroSpeedRatio: 0.3,
  dwellDriftMaxBboxMeters: 100,
  dwellDriftMaxNetDistanceMeters: 80,
  weakRecoveryShapePreserveEnabled: true,
  weakRecoveryShapeMinSamples: 3,
  weakRecoveryShapeMaxRadiusMeters: 25,
  weakRecoveryShapeMinDistanceFromTrustedMeters: 50,
  weakRecoveryShapeMaxBestAccuracyMeters: 35,
  weakRecoveryShapeExtensionGapSeconds: 500,
  weakRecoveryShapeExtensionDistanceMeters: 130,
  weakRecoveryShapeMaxExtensionSamples: 5,
  roundTripLineSimplifyEnabled: true,
  roundTripLineMinTrackPoints: 20,
  roundTripLineMaxEndpointDistanceMeters: 6,
  roundTripLineMinTurnDistanceMeters: 80,
  roundTripLineMaxCrossTrackMeters: 35,
  roundTripLineMaxRawPointIdSpanBefore: 240,
  roundTripLineMaxRawPointIdSpanAfter: 300,
  roundTripLineSimplifyToleranceMeters: 3,
  roundTripSameRoadCollapseEnabled: true,
  roundTripSameRoadMaxBboxMeters: 80,
  roundTripSameRoadMaxApproachPairDistanceMeters: 35,
  closedLoopRoundTripEnabled: true,
  closedLoopRoundTripMinTrackPoints: 30,
  closedLoopRoundTripMaxTrackPoints: 180,
  closedLoopRoundTripMinPathMeters: 120,
  closedLoopRoundTripMinBboxMeters: 30,
  closedLoopRoundTripMaxBboxMeters: 250,
  closedLoopRoundTripMaxEndpointDistanceMeters: 8,
  closedLoopRoundTripMaxNetPathRatio: 0.08,
  closedLoopRoundTripMaxRawPointIdSpan: 900,
  enclosedGapClusterEnabled: true,
  enclosedGapClusterMinGapRecoveries: 3,
  enclosedGapClusterMinStationaryAnchors: 3,
  enclosedGapClusterMaxBboxMeters: 90,
  enclosedGapClusterMinDurationSeconds: 300,
  enclosedGapClusterMinRawPointIdSpan: 200,
  enclosedLoopSettlementEnabled: true,
  enclosedLoopSettlementMaxBboxMeters: 90,
  enclosedLoopSettlementMaxCorridorDistanceMeters: 16,
  enclosedLoopSettlementMinRemovedTrackPoints: 6,
  restPhotoMicroMoveEnabled: true,
  restPhotoMicroMoveMinTrackPoints: 8,
  restPhotoMicroMoveMaxTrackPoints: 25,
  restPhotoMicroMoveMinPathMeters: 20,
  restPhotoMicroMoveMaxPathMeters: 120,
  restPhotoMicroMoveMaxBboxMeters: 25,
  restPhotoMicroMoveMaxEndpointDistanceMeters: 12,
  restPhotoMicroMoveMinPathNetRatio: 4,
  restPhotoMicroMoveMaxDurationSeconds: 300,
  restPhotoMicroMoveSimplifyEnabled: true,
  restPhotoMicroMoveSimplifyMinDurationSeconds: 60,
  restPhotoMicroMoveSimplifyToleranceMeters: 6,
  restPhotoMicroMoveSimplifyMinPathReductionRatio: 0.25,
  restPhotoMicroMoveSimplifyMaxOutputTrackPoints: 6,
  restPhotoMicroMoveCollapseMaxBboxMeters: 25,
  restPhotoMicroMoveCollapseMaxNetDistanceMeters: 12,
  restPhotoMicroMoveCollapseMaxPathMeters: 70,
  restPhotoMicroMoveLongCollapseMinDurationSeconds: 180,
  restPhotoMicroMoveLongCollapseMaxBboxMeters: 28,
  restPhotoMicroMoveLongCollapseMaxNetDistanceMeters: 10,
  restPhotoMicroMoveLongCollapseMaxPathMeters: 120,
  movingSpikeCleanupEnabled: true,
  movingSpikeMaxReportedSpeedMetersPerSecond: 0.2,
  movingSpikeMinDetourMeters: 1.5,
  movingSpikeMinLateralMeters: 2.5,
  movingSpikeMinNeighborDistanceMeters: 5,
  movingSpikeMaxBridgeDistanceMeters: 15,
  positionSnapRecoveryEnabled: true,
  positionSnapRecoveryMinWeakPoints: 1,
  positionSnapRecoveryMinBridgeDistanceMeters: 20,
  positionSnapRecoveryMaxReportedSpeedMetersPerSecond: 2,
  denseAreaIntentEnabled: true,
  denseAreaIntentMinTrackPoints: 8,
  denseAreaIntentMaxSampleGapSeconds: 20,
  denseAreaIntentForwardMinNetDistanceMeters: 20,
  denseAreaIntentStationaryMaxNetDistanceMeters: 12,
  denseAreaIntentStationaryMaxBboxMeters: 35,
  denseAreaIntentStationaryMaxPathMeters: 60,
  denseAreaIntentRoundTripMinPathMeters: 80,
  denseAreaIntentRoundTripMaxNetPathRatio: 0.15,
  denseAreaIntentControlsMainRouteSettlement: true,
  denseMainRouteSettlementEnabled: true,
  denseMainRouteMinTrackPoints: 12,
  denseMainRouteMinNetDistanceMeters: 25,
  denseMainRouteMaxBboxMeters: 120,
  denseMainRouteMaxPathNetRatio: 3,
  denseMainRouteSimplifyToleranceMeters: 4,
  denseMainRouteMinPathReductionRatio: 0.15,
  interwovenCorridorSimplifyEnabled: false,
  interwovenCorridorMinTrackPoints: 30,
  interwovenCorridorMinRawPointIdSpan: 200,
  interwovenCorridorMaxRawPointIdSpan: 600,
  interwovenCorridorMaxEndpointDistanceMeters: 6,
  interwovenCorridorMaxBboxMeters: 80,
  interwovenCorridorSimplifyToleranceMeters: 3,
  stationaryDistanceMeters: 5,
  stationaryAccuracyMultiplier: 1.5,
  stationaryCloudMinSamples: 2,
  slowMovementMinDistanceMeters: 2.5,
  lowAccuracyRescueMaxAccuracyMeters: 35,
  lowAccuracyRescueMinDistanceMeters: 2.5,
  continuityRescueMaxSpeedMetersPerSecond: 6,
  impossibleSpeedMetersPerSecond: 12,
  transportSpeedMetersPerSecond: 3.5,
  transportMinDistanceMeters: 20,
  locationAltitudeAscentMaxVerticalAccuracyMeters: 20,
  locationAltitudeAscentMinGainMeters: 1,
  locationAltitudeAscentMaxStepGainMeters: 30,
  barometerAscentMinGainMeters: 1,
  barometerAscentMaxSampleGapNanos: 30_000_000_000,
  barometerAscentMaxVerticalSpeedMetersPerSecond: 2,
  barometerPressureJumpMeters: 20,
  collapseStationarySession: false,
  barometerCleaningEnabled: false,
  cloudTemporalDecaySeconds: 20
});

export function normalizeSixLayerTrackConfig(overrides = {}) {
  const config = { ...DEFAULT_SIX_LAYER_TRACK_CONFIG };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!(key in config)) continue;
    if (typeof config[key] === 'boolean') {
      config[key] = value === true;
    } else {
      const number = Number(value);
      if (Number.isFinite(number)) config[key] = number;
    }
  }
  return config;
}

export function reviewTrackPointScenarioCoverage(product, startTrackPointId, endTrackPointId) {
  const start = Number(startTrackPointId);
  const end = Number(endTrackPointId);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      valid: false,
      reason: 'invalid_track_point_range',
      requestedTrackPointRange: { startTrackPointId, endTrackPointId },
      trackPointCount: 0,
      rawRange: { startRawPointId: null, endRawPointId: null },
      scenarioCoverage: [],
      primaryScenarios: [],
      contextScenarios: []
    };
  }
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  const trackPoints = (product?.track || []).filter((point) =>
    point.trackPointId >= normalizedStart && point.trackPointId <= normalizedEnd);
  const scenarioCoverage = (product?.scenarioCoverage || [])
    .map((coverage) => scenarioCoverageRangeHit(coverage, normalizedStart, normalizedEnd))
    .filter(Boolean);
  const primaryScenarios = uniqueStrings(trackPoints
    .map((point) => point.primaryExplanation?.scenario)
    .filter(Boolean));
  const contextScenarios = uniqueStrings(trackPoints
    .flatMap((point) => (point.scenarioContexts || []).map((context) => context.scenario))
    .filter(Boolean));
  return {
    valid: true,
    requestedTrackPointRange: {
      startTrackPointId: normalizedStart,
      endTrackPointId: normalizedEnd
    },
    trackPointCount: trackPoints.length,
    rawRange: trackSpanRawPointRange(trackPoints),
    scenarioCoverage,
    primaryScenarios,
    contextScenarios
  };
}

export function buildSixLayerTrackProduct(modelOrEvents, options = {}) {
  const config = normalizeSixLayerTrackConfig(options.config);
  const events = Array.isArray(modelOrEvents) ? modelOrEvents : modelOrEvents?.events || [];
  const sourceFilePath = Array.isArray(modelOrEvents)
    ? options.sourceFilePath || ''
    : modelOrEvents?.filePath || '';
  const evidence = buildEvidence(events);
  const product = emptyProduct(evidence.strategyVersion, sourceFilePath,
    evidence.recordStartElapsedRealtimeNanos, evidence.recordEndElapsedRealtimeNanos);
  product.config = config;
  product.usesDefaultConfig = isDefaultConfig(config);

  const motionIndex = createRecentMotionSummaryIndex(evidence.motionWindows, MOTION_LOOKBACK_NANOS);
  const trackState = createTrackState();

  for (const rawPoint of evidence.rawPoints) {
    product.stats.rawPointCount++;
    const epoch = findSamplingEpoch(rawPoint, evidence.samplingEpochs);
    const intake = intakeRawPoint(rawPoint, epoch, evidence, trackState, config);
    if (!intake.accepted) {
      const point = excludedPoint(rawPoint, 'intake_rejected', intake.reason, epoch, null, {
        activityState: 'unknown',
        boundaryState: 'none',
        gnssAltitudeResult: 'unavailable',
        gnssAltitudeReason: null
      });
      product.excluded.intakeRejected.push(point);
      product.rawPointDecisions.push(rawPointDecision(point, false, false, false));
      continue;
    }

    trackState.lastLegalElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
    trackState.legalFixKeys.add(fixKey(rawPoint));
    const motion = classifyActivity(rawPoint, motionIndex);
    const decision = decideHorizontal(rawPoint, epoch, motion, trackState, config);
    const gnssAltitude = applyGnssAltitude(rawPoint, decision, trackState, product, config);
    const settlement = settleDecision(decision, gnssAltitude);

    if (decision.result === 'anchor' || decision.result === 'accept') {
      if (decision.startsNewSegment && trackState.previousTrustedTrackPoint) {
        trackState.segmentId++;
      }
      const targetPoint = {
        trackPointId: ++trackState.trackPointId,
        sourceRawPointId: rawPoint.rawPointId,
        recomputedDecisionId: ++trackState.decisionId,
        segmentId: trackState.segmentId,
        lat: decision.lat,
        lng: decision.lng,
        elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
        timeMillis: rawPoint.timeMillis,
        result: decision.result,
        reason: decision.reason,
        distanceDeltaMeters: decision.distanceDeltaMeters,
        movingTimeDeltaSeconds: decision.movingTimeDeltaSeconds,
        startsNewSegment: decision.startsNewSegment,
        cloudType: decision.cloudType,
        cloudId: decision.cloudId,
        cloudSampleCount: decision.cloudSampleCount,
        cloudWeightSum: decision.cloudWeightSum,
        cloudWeightedRadiusMeters: decision.cloudWeightedRadiusMeters,
        representativeRawPointId: decision.representativeRawPointId ?? rawPoint.rawPointId,
        contributingRawPointIds: decision.contributingRawPointIds ?? [rawPoint.rawPointId],
        reportedSpeedMetersPerSecond: rawPoint.speed,
        coordinateSource: 'raw',
        virtualCoordinate: false,
        activityState: decision.activityState,
        boundaryState: decision.boundaryState,
        gnssAltitudeResult: gnssAltitude.result,
        gnssAltitudeReason: gnssAltitude.reason,
        countsDistance: settlement.countsDistance,
        countsMovingTime: settlement.countsMovingTime,
        countsAscentWindow: settlement.countsAscentWindow,
        entersTrustedGpx: settlement.entersTrustedGpx
      };
      product.track.push(targetPoint);
      product.rawPointDecisions.push(rawPointDecision(targetPoint,
        settlement.countsDistance, settlement.countsMovingTime, settlement.entersTrustedGpx));
      trackState.previousTrustedTrackPoint = targetPoint;
      if (decision.reason === 'gap_recovery') product.stats.gapCount++;
    } else {
      const bucket = decision.result === 'weak' ? product.excluded.weak : product.excluded.rejected;
      const point = excludedPoint(rawPoint, decision.result, decision.reason, epoch, decision, {
        activityState: decision.activityState,
        boundaryState: decision.boundaryState,
        gnssAltitudeResult: gnssAltitude.result,
        gnssAltitudeReason: gnssAltitude.reason
      });
      bucket.push(point);
      product.rawPointDecisions.push(rawPointDecision(point, false, false, false));
      if (decision.reason === 'transport_risk') {
        product.stats.transportCount++;
        trackState.inTransportMode = true;
        trackState.lastTransportRawPoint = rawPoint;
      }
    }
    if (decision.result === 'anchor' || decision.result === 'accept') {
      trackState.inTransportMode = false;
      trackState.lastTransportRawPoint = null;
    }
  }

  const collapsedStationarySession = collapseStationarySession(product, evidence, config);
  const denseAreaIntents = collapsedStationarySession
    ? []
    : analyzeDenseAreaIntents(product, config);
  const settledDenseMainRoute = collapsedStationarySession
    ? false
    : settleDenseMainRouteSpans(product, config, denseAreaIntents);
  const collapsedDwellDrift = collapsedStationarySession
    ? false
    : collapseDwellDriftClouds(product, evidence, config, denseAreaIntents);
  const preservedWeakRecoveryShape = collapsedStationarySession
    ? false
    : preserveWeakRecoveryShapeAnchors(product, evidence, config);
  const simplifiedRoundTripLine = collapsedStationarySession
    ? false
    : simplifyRoundTripLineSpans(product, config, denseAreaIntents);
  const simplifiedInterwovenCorridor = collapsedStationarySession
    ? false
    : simplifyInterwovenCorridorSpans(product, config);
  const simplifiedRestPhotoMicroMove = collapsedStationarySession
    ? false
    : simplifyRestPhotoMicroMoveSpans(product, config, denseAreaIntents);
  const cleanedMovingSpikes = collapsedStationarySession
    ? false
    : cleanMovingSpikePoints(product, config);
  const settledEnclosedLoop = collapsedStationarySession
    ? false
    : settleEnclosedLoopClusters(product, config, denseAreaIntents);
  const settledPositionSnapRecovery = collapsedStationarySession
    ? false
    : settlePositionSnapRecoveries(product, config);
  if (collapsedStationarySession || settledDenseMainRoute || collapsedDwellDrift || preservedWeakRecoveryShape
      || simplifiedRoundTripLine || simplifiedInterwovenCorridor
      || simplifiedRestPhotoMicroMove || cleanedMovingSpikes || settledEnclosedLoop
      || settledPositionSnapRecovery) {
    recomputeLocationAltitudeAscent(product, evidence, config);
  }
  product.denseAreaIntents = denseAreaIntents;
  applyBarometerAscent(product, evidence, config);
  finalizeStats(product);
  addPostSettlementScenarios(product);
  product.denseAreaSettlementPlan = buildDenseAreaSettlementPlan(product, denseAreaIntents);
  product.denseIntentConflicts = buildDenseIntentConflicts(product);
  applyForwardSpineArbitrationReview(product, denseAreaIntents);
  attachExplanationModel(product);
  product.scenarioCoverage = buildScenarioCoverage(product);
  product.findings = buildFindings(product, evidence);
  return product;
}

function buildEvidence(events) {
  const rawPoints = [];
  const samplingEpochs = [];
  const motionWindows = [];
  const barometerWindows = [];
  let metadata = {};

  for (const event of events || []) {
    if (event?.event === 'session_metadata') {
      metadata = { ...metadata, ...event };
    } else if (event?.event === 'raw_location') {
      const rawPoint = normalizeRawPoint(event);
      if (rawPoint) rawPoints.push(rawPoint);
    } else if (event?.event === 'sampling_policy') {
      samplingEpochs.push(normalizeSamplingEpoch(event));
    } else if (event?.event === 'device_motion_window') {
      motionWindows.push(normalizeMotionWindow(event));
    } else if (event?.event === 'barometer_window') {
      barometerWindows.push(normalizeBarometerWindow(event));
    }
  }

  const recordStartElapsedRealtimeNanos =
    numberField(metadata, 'recordStartElapsedRealtimeNanos')
    ?? numberField(metadata, 'createdElapsedRealtimeNanos')
    ?? firstFinite(rawPoints.map((point) => point.elapsedRealtimeNanos));
  const recordEndElapsedRealtimeNanos =
    numberField(metadata, 'recordEndElapsedRealtimeNanos')
    ?? numberField(metadata, 'completedElapsedRealtimeNanos')
    ?? numberField(metadata, 'endedElapsedRealtimeNanos')
    ?? numberField(metadata, 'stoppedElapsedRealtimeNanos')
    ?? lastFinite(rawPoints.map((point) => point.elapsedRealtimeNanos));

  return {
    strategyVersion: metadata.strategyVersion || '',
    recordStartElapsedRealtimeNanos,
    recordEndElapsedRealtimeNanos,
    rawPoints,
    samplingEpochs: samplingEpochs.sort((a, b) => a.startedElapsedRealtimeNanos - b.startedElapsedRealtimeNanos),
    motionWindows,
    barometerWindows
  };
}

function normalizeRawPoint(event) {
  const lat = numberField(event, 'lat');
  const lng = numberField(event, 'lng');
  if (lat === null || lng === null) return null;
  return {
    ...event,
    rawPointId: numberField(event, 'rawPointId') ?? null,
    provider: event.provider ?? event.source ?? event.sourceKind ?? event.trustClass ?? '',
    lat,
    lng,
    accuracy: numberField(event, 'accuracy'),
    altitude: numberField(event, 'altitude'),
    verticalAccuracy: numberField(event, 'verticalAccuracy'),
    speed: numberField(event, 'speed'),
    bearing: numberField(event, 'bearing'),
    elapsedRealtimeNanos: numberField(event, 'elapsedRealtimeNanos'),
    timeMillis: numberField(event, 'timeMillis'),
    samplingEpochId: numberField(event, 'samplingEpochId'),
    callbackReceivedElapsedRealtimeNanos: numberField(event, 'callbackReceivedElapsedRealtimeNanos'),
    callbackDelayNanos: numberField(event, 'callbackDelayNanos'),
    isMock: event.isMock === true || event.mock === true || event.isFromMockProvider === true
  };
}

function normalizeSamplingEpoch(event) {
  const started = numberField(event, 'samplingEpochStartedElapsedRealtimeNanos')
    ?? numberField(event, 'locationRequestRegisteredElapsedRealtimeNanos')
    ?? numberField(event, 'eventElapsedRealtimeNanos')
    ?? 0;
  return {
    epochId: numberField(event, 'samplingEpochId') ?? numberField(event, 'epochId') ?? null,
    state: String(event.state || event.samplingState || ''),
    startedElapsedRealtimeNanos: started,
    requestedMinTimeMs: numberField(event, 'locationRequestMinTimeMs')
      ?? numberField(event, 'requestedMinTimeMs'),
    requestedMinDistanceMeters: numberField(event, 'locationRequestMinDistanceMeters')
      ?? numberField(event, 'requestedMinDistanceMeters')
  };
}

function normalizeMotionWindow(event) {
  const start = numberField(event, 'startElapsedRealtimeNanos')
    ?? numberField(event, 'firstElapsedRealtimeNanos');
  const end = numberField(event, 'endElapsedRealtimeNanos')
    ?? numberField(event, 'lastElapsedRealtimeNanos');
  return {
    ...event,
    firstElapsedRealtimeNanos: start,
    lastElapsedRealtimeNanos: end,
    deviceStill: isStillMotionWindow(event),
    isDeviceStill: isStillMotionWindow(event),
    dynamicAccelRmsMps2: numberField(event, 'linearAccelerationRmsMps2')
      ?? numberField(event, 'accelerometerDynamicRmsMps2')
      ?? numberField(event, 'dynamicAccelRmsMps2'),
    gyroscopeRmsRadps: numberField(event, 'gyroscopeRmsRadps'),
    stepDelta: numberField(event, 'stepCounterDelta') ?? numberField(event, 'stepDelta') ?? 0,
    stepDetectorCount: numberField(event, 'stepDetectorCount') ?? 0
  };
}

function normalizeBarometerWindow(event) {
  return {
    ...event,
    windowId: numberField(event, 'barometerWindowId') ?? null,
    startElapsedRealtimeNanos: numberField(event, 'startElapsedRealtimeNanos')
      ?? numberField(event, 'firstElapsedRealtimeNanos')
      ?? numberField(event, 'endElapsedRealtimeNanos')
      ?? numberField(event, 'lastElapsedRealtimeNanos'),
    endElapsedRealtimeNanos: numberField(event, 'endElapsedRealtimeNanos')
      ?? numberField(event, 'lastElapsedRealtimeNanos')
      ?? numberField(event, 'startElapsedRealtimeNanos')
      ?? numberField(event, 'firstElapsedRealtimeNanos'),
    avgPressureHpa: numberField(event, 'avgPressureHpa'),
    avgRawBarometerAltitudeMeters: numberField(event, 'avgRawBarometerAltitudeMeters'),
    deltaRawBarometerAltitudeMeters: numberField(event, 'deltaRawAltitudeMeters')
      ?? numberField(event, 'deltaRawBarometerAltitudeMeters')
  };
}

function emptyProduct(strategyVersion, sourceFilePath, recordStart, recordEnd) {
  return {
    algorithmVersion: SIX_LAYER_TRACK_ALGORITHM_VERSION,
    strategyVersion,
    sourceFilePath,
    track: [],
    excluded: {
      weak: [],
      rejected: [],
      intakeRejected: []
    },
    rawPointDecisions: [],
    barometerWindowDecisions: [],
    stats: {
      routeDistanceMeters: 0,
      totalDistanceMeters: 0,
      suspectedDistanceMeters: 0,
      movingTimeSeconds: 0,
      recordStartElapsedRealtimeNanos: recordStart,
      recordEndElapsedRealtimeNanos: recordEnd,
      segmentCount: 0,
      gapCount: 0,
      transportCount: 0,
      rawPointCount: 0,
      trustedPointCount: 0,
      weakPointCount: 0,
      rejectedPointCount: 0,
      intakeRejectedPointCount: 0,
      barometerTotalAscentMeters: -1,
      barometerAscentSampleCount: 0,
      barometerAscentRejectedSampleCount: 0,
      barometerAscentConfidence: 'none',
      locationAltitudeTotalAscentMeters: -1,
      locationAltitudeAscentSampleCount: 0,
      locationAltitudeAscentRejectedSampleCount: 0,
      locationAltitudeAscentConfidence: 'none',
      selectedTotalAscentMeters: null,
      selectedAscentSource: 'NONE'
    },
    gnssAltitudeResult: null,
    barometerAscentResult: null,
    selectedAscentResult: null,
    explanationModel: null,
    scenarios: [],
    scenarioCoverage: [],
    findings: []
  };
}

function createTrackState() {
  return {
    segmentId: 1,
    trackPointId: 0,
    decisionId: 0,
    previousTrustedTrackPoint: null,
    inTransportMode: false,
    lastTransportRawPoint: null,
    stationaryCloud: null,
    recoveryCloud: null,
    lastLegalElapsedRealtimeNanos: null,
    legalFixKeys: new Set(),
    gnssAltitudeAnchorMeters: null
  };
}

function intakeRawPoint(rawPoint, epoch, evidence, state, config) {
  if (!rawPoint.provider) return rejected('missing_position_source');
  if (rawPoint.isMock) return rejected('mock_location');
  if (!validCoordinate(rawPoint.lat, rawPoint.lng)) return rejected('invalid_coordinate');
  if (!Number.isFinite(rawPoint.elapsedRealtimeNanos)) return rejected('missing_fix_elapsed_realtime');
  if (Number.isFinite(evidence.recordStartElapsedRealtimeNanos)
      && rawPoint.elapsedRealtimeNanos < evidence.recordStartElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return rejected('before_record_start');
  }
  if (!Number.isFinite(rawPoint.accuracy) || rawPoint.accuracy < 0) {
    return rejected('invalid_accuracy');
  }
  if (rawPoint.accuracy > config.maxIntakeAccuracyMeters) {
    return rejected('accuracy_too_large');
  }
  if (state.legalFixKeys.has(fixKey(rawPoint))) return rejected('duplicate_fix');
  if (Number.isFinite(state.lastLegalElapsedRealtimeNanos)
      && rawPoint.elapsedRealtimeNanos <= state.lastLegalElapsedRealtimeNanos) {
    return rejected('out_of_order_fix');
  }
  if (rawPoint.samplingEpochId !== null && !epoch) {
    return rejected('sampling_epoch_mismatch');
  }
  if (epoch && rawPoint.elapsedRealtimeNanos < epoch.startedElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return rejected('sampling_epoch_mismatch');
  }
  return { accepted: true, reason: null };
}

function rejected(reason) {
  return { accepted: false, reason };
}

function decideHorizontal(rawPoint, epoch, motion, state, config) {
  const previous = state.previousTrustedTrackPoint;
  if (!previous) {
    if (rawPoint.accuracy <= config.firstFixGoodAccuracyMeters) {
      return trustedDecision(rawPoint, 'anchor', 'first_fix_good', motion, {
        cloudType: 'START_CLOUD'
      });
    }
    if (rawPoint.accuracy <= config.firstFixRelaxedAccuracyMeters) {
      return trustedDecision(rawPoint, 'anchor', 'first_fix_relaxed', motion, {
        cloudType: 'START_CLOUD'
      });
    }
    return diagnosticDecision(rawPoint, 'weak', 'weak_horizontal_accuracy', motion, {
      cloudType: 'START_CLOUD'
    });
  }

  const distance = distanceMeters(previous.lat, previous.lng, rawPoint.lat, rawPoint.lng);
  const dtSeconds = elapsedSeconds(previous.elapsedRealtimeNanos, rawPoint.elapsedRealtimeNanos);
  const impliedSpeed = dtSeconds > 0 ? distance / dtSeconds : Infinity;
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  const isGap = dtSeconds > config.gapSeconds;

  if (state.inTransportMode) {
    return decideTransportRecovery(rawPoint, motion, state, config);
  }

  const transportRisk = isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config);

  if (isGap) {
    return decideGapRecovery(rawPoint, previous, motion, state, distance, config);
  }

  if (transportRisk) {
    if (isTransportTrackReason(previous.reason)) {
      return trustedDecision(rawPoint, 'accept', 'transport_suspected_kept', motion, {
        boundaryState: 'transport_risk',
        cloudType: 'TRANSPORT_RISK_CLOUD',
        distanceDeltaMeters: distance,
        movingTimeDeltaSeconds: Math.max(0, dtSeconds)
      });
    }
    return diagnosticDecision(rawPoint, 'reject', 'transport_risk', motion, {
      boundaryState: 'transport_risk',
      cloudType: 'TRANSPORT_RISK_CLOUD',
      distanceDeltaMeters: distance,
      movingTimeDeltaSeconds: Math.max(0, dtSeconds)
    });
  }

  if (isImpliedTransportUnconfirmedByReportedSpeed(distance, impliedSpeed, reportedSpeed,
    config)) {
    return diagnosticDecision(rawPoint, 'weak', 'implied_speed_unconfirmed_by_reported_speed',
      motion, {
        cloudType: 'WEAK_CLOUD'
      });
  }

  if (impliedSpeed > config.impossibleSpeedMetersPerSecond) {
    return diagnosticDecision(rawPoint, 'weak', 'implied_speed_too_high', motion, {
      cloudType: 'WEAK_CLOUD'
    });
  }

  if (rawPoint.accuracy > config.weakCloudAccuracyMeters) {
    if (isLowAccuracyRescuePoint(rawPoint, previous, distance, impliedSpeed, config)) {
      return trustedDecision(rawPoint, 'accept', 'continuity_rescue_low_accuracy', motion, {
        distanceDeltaMeters: distance,
        movingTimeDeltaSeconds: Math.max(0, dtSeconds),
        cloudType: 'MOVING_CLOUD'
      });
    }
    return diagnosticDecision(rawPoint, 'weak', 'weak_horizontal_accuracy', motion, {
      cloudType: 'WEAK_CLOUD'
    });
  }

  const stationaryThresholdMeters = stationaryThreshold(rawPoint, config);
  if (distance <= stationaryThresholdMeters) {
    if (motion.state === 'walking' && distance >= config.slowMovementMinDistanceMeters) {
      return trustedDecision(rawPoint, 'accept', 'motion_supported_low_speed', motion, {
        distanceDeltaMeters: distance,
        movingTimeDeltaSeconds: Math.max(0, dtSeconds),
        cloudType: 'MOVING_CLOUD'
      });
    }
    return decideStationaryCloud(rawPoint, previous, motion, state, config,
      stationaryThresholdMeters);
  }

  return trustedDecision(rawPoint, 'accept', 'moving_good_fix', motion, {
    distanceDeltaMeters: distance,
    movingTimeDeltaSeconds: Math.max(0, dtSeconds),
    cloudType: 'MOVING_CLOUD'
  });
}

function decideGapRecovery(rawPoint, previous, motion, state, distance, config) {
  const recoveryCloud = recordBoundaryCloudSample(state, 'recoveryCloud',
    'RECOVERY_CLOUD', rawPoint, previous, config);
  const thresholdMeters = stationaryThreshold(rawPoint, config);
  const cloudFields = boundaryCloudDecisionFields(recoveryCloud);
  if (isRecoveryTransportPoint(rawPoint, recoveryCloud.previousSample, config)) {
    return trustedDecision(rawPoint, 'accept', 'recovery_transport_suspected_kept', motion, {
      ...cloudFields,
      distanceDeltaMeters: 0,
      movingTimeDeltaSeconds: 0,
      startsNewSegment: true,
      boundaryState: 'transport_risk',
      cloudType: 'RECOVERY_CLOUD'
    });
  }
  if (rawPoint.accuracy > config.weakCloudAccuracyMeters) {
    return diagnosticDecision(rawPoint, 'weak', 'gap_recovery_pending', motion, {
      ...cloudFields,
      boundaryState: 'gap_recovery_pending',
      cloudType: 'RECOVERY_CLOUD'
    });
  }
  if (distance <= thresholdMeters && motion.state !== 'walking') {
    return diagnosticDecision(rawPoint, 'weak', 'gap_recovery_pending', motion, {
      ...cloudFields,
      boundaryState: 'gap_recovery_pending',
      cloudType: 'RECOVERY_CLOUD'
    });
  }
  if (!isRecoveryFastPath(rawPoint, distance, thresholdMeters, config)
      && !isBoundaryCloudStable(recoveryCloud, thresholdMeters, config.recoveryCloudMinSamples)) {
    return diagnosticDecision(rawPoint, 'weak', 'gap_recovery_pending', motion, {
      ...cloudFields,
      boundaryState: 'gap_recovery_pending',
      cloudType: 'RECOVERY_CLOUD'
    });
  }
  return trustedDecision(rawPoint, 'accept', 'gap_recovery', motion, {
    ...cloudFields,
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: true,
    boundaryState: 'gap_recovered',
    cloudType: 'RECOVERY_CLOUD'
  });
}

function isRecoveryTransportPoint(rawPoint, previousRawPoint, config) {
  if (!previousRawPoint) return false;
  if (!Number.isFinite(rawPoint.accuracy)
      || rawPoint.accuracy > config.maxIntakeAccuracyMeters) {
    return false;
  }
  const dtSeconds = elapsedSeconds(previousRawPoint.elapsedRealtimeNanos,
    rawPoint.elapsedRealtimeNanos);
  if (dtSeconds <= 0 || dtSeconds > config.gapSeconds) return false;
  const distance = distanceMeters(previousRawPoint.lat, previousRawPoint.lng,
    rawPoint.lat, rawPoint.lng);
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  return isTransportRiskDistance(distance, distance / dtSeconds, reportedSpeed, config);
}

function decideStationaryCloud(rawPoint, previous, motion, state, config,
  thresholdMeters) {
  const stationaryCloud = recordBoundaryCloudSample(state, 'stationaryCloud',
    'STATIONARY_CLOUD', rawPoint, previous, config);
  const cloudFields = boundaryCloudDecisionFields(stationaryCloud);
  if (previous.reason === 'stationary_anchor') {
    return diagnosticDecision(rawPoint, 'reject', 'stationary_anchor_redundant', motion, {
      ...cloudFields,
      cloudType: 'STATIONARY_CLOUD'
    });
  }
  if (motion.state === 'still'
      && isBoundaryCloudStable(stationaryCloud, thresholdMeters, config.stationaryCloudMinSamples)) {
    return trustedDecision(rawPoint, 'anchor', 'stationary_anchor', motion, {
      ...cloudFields,
      distanceDeltaMeters: 0,
      movingTimeDeltaSeconds: 0,
      cloudType: 'STATIONARY_CLOUD'
    });
  }
  return diagnosticDecision(rawPoint, 'reject', 'stationary_cloud_jitter', motion, {
    ...cloudFields,
    cloudType: 'STATIONARY_CLOUD'
  });
}

function decideTransportRecovery(rawPoint, motion, state, config) {
  const reference = state.lastTransportRawPoint || state.previousTrustedTrackPoint;
  if (!reference) {
    state.inTransportMode = false;
    return decideHorizontal(rawPoint, null, motion, state, config);
  }
  const distance = distanceMeters(reference.lat, reference.lng, rawPoint.lat, rawPoint.lng);
  const dtSeconds = elapsedSeconds(reference.elapsedRealtimeNanos, rawPoint.elapsedRealtimeNanos);
  const impliedSpeed = dtSeconds > 0 ? distance / dtSeconds : Infinity;
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  const stillTransport = isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config);

  if (stillTransport) {
    return diagnosticDecision(rawPoint, 'reject', 'transport_risk', motion, {
      boundaryState: 'transport_risk',
      cloudType: 'TRANSPORT_RISK_CLOUD',
      distanceDeltaMeters: distance,
      movingTimeDeltaSeconds: Math.max(0, dtSeconds)
    });
  }
  if (rawPoint.accuracy > config.weakCloudAccuracyMeters) {
    return diagnosticDecision(rawPoint, 'weak', 'transport_recovery_pending', motion, {
      boundaryState: 'transport_recovery_pending',
      cloudType: 'RECOVERY_CLOUD'
    });
  }
  return trustedDecision(rawPoint, 'accept', 'gap_recovery', motion, {
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: true,
    boundaryState: 'transport_recovered',
    cloudType: 'RECOVERY_CLOUD'
  });
}

function isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config) {
  if (distance < config.transportMinDistanceMeters) return false;
  if (reportedSpeed !== null) {
    return reportedSpeed >= config.transportSpeedMetersPerSecond;
  }
  return impliedSpeed >= config.transportSpeedMetersPerSecond;
}

function isImpliedTransportUnconfirmedByReportedSpeed(distance, impliedSpeed, reportedSpeed,
  config) {
  return distance >= config.transportMinDistanceMeters
    && impliedSpeed >= config.transportSpeedMetersPerSecond
    && reportedSpeed !== null
    && reportedSpeed < config.transportSpeedMetersPerSecond;
}

function collapseStationarySession(product, evidence, config) {
  if (!config.stationarySessionCollapseEnabled) return false;
  const rawPoints = evidence.rawPoints || [];
  if (!isStationarySession(rawPoints, config)) return false;

  const representative = stationarySessionRepresentativeRawPoint(rawPoints, config);
  const anchor = stationarySessionAnchor(rawPoints, representative);
  product.track = [anchor];
  product.excluded.weak = [];
  product.excluded.rejected = [];
  product.excluded.intakeRejected = [];
  product.stats.gapCount = 0;
  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.stationarySessionCollapsed = true;
  product.stationarySessionCollapse = {
    collapsedRawPointCount: rawPoints.length,
    startRawPointId: rawPoints[0].rawPointId,
    endRawPointId: rawPoints.at(-1).rawPointId,
    representativeRawPointId: representative.rawPointId,
    bboxDiagonalMeters: bboxDiagonalMeters(rawPoints),
    netDistanceMeters: distanceMeters(rawPoints[0].lat, rawPoints[0].lng,
      rawPoints.at(-1).lat, rawPoints.at(-1).lng),
    durationSeconds: elapsedSeconds(rawPoints[0].elapsedRealtimeNanos,
      rawPoints.at(-1).elapsedRealtimeNanos)
  };
  addScenario(product, stationarySessionScenario(product.stationarySessionCollapse));
  return true;
}

function stationarySessionScenario(collapse) {
  return {
    scenario: 'stationary_session_collapse',
    confidence: stationarySessionConfidence(collapse),
    rawRange: {
      startRawPointId: collapse.startRawPointId,
      endRawPointId: collapse.endRawPointId
    },
    anchorRawPointIds: [collapse.representativeRawPointId],
    action: 'collapse_to_single_anchor',
    localRebuild: 'stationary_session_anchor',
    evidence: {
      collapsedRawPointCount: collapse.collapsedRawPointCount,
      startRawPointId: collapse.startRawPointId,
      endRawPointId: collapse.endRawPointId,
      representativeRawPointId: collapse.representativeRawPointId,
      durationSeconds: scenarioNumber(collapse.durationSeconds),
      bboxDiagonalMeters: scenarioNumber(collapse.bboxDiagonalMeters),
      netDistanceMeters: scenarioNumber(collapse.netDistanceMeters)
    }
  };
}

function stationarySessionConfidence(collapse) {
  const durationScore = Math.min(1, collapse.durationSeconds / 300);
  const bboxScore = 1 - Math.min(1, collapse.bboxDiagonalMeters / 80);
  const netScore = 1 - Math.min(1, collapse.netDistanceMeters / 80);
  return scenarioNumber(clamp01(0.55 + durationScore * 0.15 + bboxScore * 0.15
    + netScore * 0.15));
}

function isStationarySession(rawPoints, config) {
  if (rawPoints.length < config.stationarySessionMinRawPoints) return false;
  const first = rawPoints[0];
  const last = rawPoints.at(-1);
  const durationSeconds = elapsedSeconds(first.elapsedRealtimeNanos, last.elapsedRealtimeNanos);
  if (durationSeconds < config.stationarySessionMinDurationSeconds) return false;
  if (bboxDiagonalMeters(rawPoints) > config.stationarySessionMaxBboxMeters) return false;
  const netDistance = distanceMeters(first.lat, first.lng, last.lat, last.lng);
  if (netDistance > config.stationarySessionMaxNetDistanceMeters) return false;
  if (rawPathMeters(rawPoints) / Math.max(durationSeconds, 1)
      > config.stationarySessionMaxPathRateMetersPerSecond) {
    return false;
  }
  const speeds = rawPoints
    .map((point) => point.speed)
    .filter(Number.isFinite);
  if (speeds.length / rawPoints.length < config.stationarySessionMinSpeedSampleRatio) {
    return false;
  }
  const zeroSpeedRatio = speeds.filter((speed) => speed <= 0.1).length / speeds.length;
  if (zeroSpeedRatio < config.stationarySessionMinZeroSpeedRatio) return false;
  const averageSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  return averageSpeed <= config.stationarySessionMaxAverageReportedSpeedMetersPerSecond;
}

function stationarySessionRepresentativeRawPoint(rawPoints, config) {
  const intervals = findDwellDriftIntervals(rawPoints, config)
    .sort((a, b) => b.coreRawPoints.length - a.coreRawPoints.length
      || b.rawPoints.length - a.rawPoints.length);
  for (const interval of intervals) {
    const movingWeakPoint = interval.rawPoints
      .filter((point) => Number.isFinite(point.speed)
        && point.speed > 0.1
        && point.accuracy >= config.dwellDriftCoreAccuracyMeters)
      .sort((a, b) => b.speed - a.speed || b.accuracy - a.accuracy)[0];
    if (movingWeakPoint) return movingWeakPoint;
  }
  const center = weightedRawCenter(rawPoints);
  return nearestRawPoint(center, rawPoints);
}

function stationarySessionAnchor(rawPoints, representative) {
  const center = {
    lat: representative.lat,
    lng: representative.lng,
    weight: rawPoints.length,
    radiusMeters: Math.sqrt(rawPoints.reduce((sum, point) => {
      const distance = distanceMeters(representative.lat, representative.lng,
        point.lat, point.lng);
      return sum + distance * distance;
    }, 0) / Math.max(rawPoints.length, 1))
  };
  return {
    trackPointId: 0,
    sourceRawPointId: representative.rawPointId,
    recomputedDecisionId: representative.rawPointId,
    segmentId: 1,
    lat: representative.lat,
    lng: representative.lng,
    elapsedRealtimeNanos: representative.elapsedRealtimeNanos,
    timeMillis: representative.timeMillis,
    result: 'anchor',
    reason: 'stationary_session_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: false,
    cloudType: 'STATIONARY_SESSION',
    cloudId: representative.rawPointId,
    cloudSampleCount: rawPoints.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId: representative.rawPointId,
    contributingRawPointIds: rawPoints.map((point) => point.rawPointId),
    coordinateSource: 'raw_representative',
    virtualCoordinate: false,
    activityState: 'stationary_session',
    boundaryState: 'session_collapsed',
    gnssAltitudeResult: 'reset',
    gnssAltitudeReason: 'stationary_suspended',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function analyzeDenseAreaIntents(product, config) {
  if (!config.denseAreaIntentEnabled) return [];
  const candidates = denseAreaIntentCandidates(product.track, config);
  for (const candidate of candidates) {
    addScenario(product, denseAreaIntentScenario(candidate));
  }
  return candidates.map((candidate) => ({
    intent: candidate.intent,
    rawRange: candidate.rawRange,
    trackPointCount: candidate.span.length,
    confidence: candidate.confidence,
    evidence: candidate.evidence
  }));
}

function denseAreaIntentCandidates(track, config) {
  const candidates = [];
  let startIndex = 0;
  while (startIndex < track.length) {
    while (startIndex < track.length && !canBeDenseAreaIntentPoint(track[startIndex])) {
      startIndex++;
    }
    let endIndex = startIndex;
    while (endIndex < track.length && canBeDenseAreaIntentPoint(track[endIndex])) {
      const previous = endIndex > startIndex ? track[endIndex - 1] : null;
      if (previous && elapsedSeconds(previous.elapsedRealtimeNanos,
        track[endIndex].elapsedRealtimeNanos) > config.denseAreaIntentMaxSampleGapSeconds) {
        break;
      }
      endIndex++;
    }
    if (endIndex - startIndex >= config.denseAreaIntentMinTrackPoints) {
      const span = track.slice(startIndex, endIndex);
      const candidate = denseAreaIntentCandidate(span, startIndex, endIndex - 1, config);
      if (candidate) candidates.push(candidate);
    }
    startIndex = Math.max(endIndex + 1, startIndex + 1);
  }
  return nonOverlappingScenarioCandidates(candidates, []);
}

function canBeDenseAreaIntentPoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && !isTransportTrackReason(point.reason);
}

function denseAreaIntentCandidate(span, startIndex, endIndex, config) {
  const pathMeters = trackPathMeters(span);
  const netDistanceMeters = trackNetDistanceMeters(span);
  const bboxMeters = bboxDiagonalMeters(span);
  const gapRecoveryCount = span.filter((point) => point.reason === 'gap_recovery').length;
  const stationaryAnchorCount = span.filter((point) =>
    point.reason === 'stationary_anchor'
    || point.reason === 'stationary_drift_anchor').length;
  const movingCount = span.filter((point) => point.countsDistance === true).length;
  const zeroDistanceCount = span.length - movingCount;
  const rawRange = trackSpanRawPointRange(span);
  const intent = denseAreaIntentName({
    span,
    pathMeters,
    netDistanceMeters,
    bboxMeters,
    gapRecoveryCount,
    stationaryAnchorCount,
    movingCount,
    zeroDistanceCount
  }, config);
  const confidence = denseAreaIntentConfidence(intent, {
    span,
    pathMeters,
    netDistanceMeters,
    bboxMeters,
    gapRecoveryCount,
    stationaryAnchorCount,
    movingCount,
    zeroDistanceCount
  }, config);
  return {
    scenario: 'dense_area_intent',
    intent,
    confidence,
    startIndex,
    endIndex,
    span,
    rawRange,
    evidence: {
      intent,
      trackPointCount: span.length,
      pathMeters: scenarioNumber(pathMeters),
      netDistanceMeters: scenarioNumber(netDistanceMeters),
      bboxDiagonalMeters: scenarioNumber(bboxMeters),
      gapRecoveryCount,
      stationaryAnchorCount,
      movingRatio: scenarioNumber(movingCount / Math.max(span.length, 1)),
      zeroDistanceRatio: scenarioNumber(zeroDistanceCount / Math.max(span.length, 1))
    },
    score: span.length * 10 + pathMeters
  };
}

function denseAreaIntentName(metrics, config) {
  if (metrics.gapRecoveryCount >= config.enclosedGapClusterMinGapRecoveries
      && metrics.stationaryAnchorCount >= config.enclosedGapClusterMinStationaryAnchors) {
    return 'gap_cluster';
  }
  if (metrics.pathMeters >= config.denseAreaIntentRoundTripMinPathMeters
      && metrics.netDistanceMeters / Math.max(metrics.pathMeters, 1)
        <= config.denseAreaIntentRoundTripMaxNetPathRatio) {
    return 'round_trip';
  }
  if (metrics.netDistanceMeters <= config.denseAreaIntentStationaryMaxNetDistanceMeters
      && metrics.bboxMeters <= config.denseAreaIntentStationaryMaxBboxMeters
      && (metrics.zeroDistanceCount >= metrics.movingCount
        || metrics.pathMeters <= config.denseAreaIntentStationaryMaxPathMeters)) {
    return 'stationary';
  }
  if (metrics.netDistanceMeters >= config.denseAreaIntentForwardMinNetDistanceMeters
      && metrics.movingCount > metrics.zeroDistanceCount) {
    return 'forward_motion';
  }
  return 'mixed';
}

function denseAreaIntentConfidence(intent, metrics, config) {
  switch (intent) {
    case 'gap_cluster':
      return scenarioNumber(clamp01(0.55
        + Math.min(1, metrics.gapRecoveryCount
          / Math.max(config.enclosedGapClusterMinGapRecoveries + 2, 1)) * 0.25
        + Math.min(1, metrics.stationaryAnchorCount
          / Math.max(config.enclosedGapClusterMinStationaryAnchors + 2, 1)) * 0.2));
    case 'round_trip':
      return scenarioNumber(clamp01(0.55
        + (1 - Math.min(1, metrics.netDistanceMeters / Math.max(metrics.pathMeters, 1))) * 0.3
        + Math.min(1, metrics.pathMeters
          / Math.max(config.denseAreaIntentRoundTripMinPathMeters * 2, 1)) * 0.15));
    case 'stationary':
      return scenarioNumber(clamp01(0.55
        + (1 - Math.min(1, metrics.netDistanceMeters
          / Math.max(config.denseAreaIntentStationaryMaxNetDistanceMeters, 1))) * 0.25
        + (metrics.zeroDistanceCount / Math.max(metrics.span.length, 1)) * 0.2));
    case 'forward_motion':
      return scenarioNumber(clamp01(0.55
        + Math.min(1, metrics.netDistanceMeters
          / Math.max(config.denseAreaIntentForwardMinNetDistanceMeters * 2, 1)) * 0.25
        + (metrics.movingCount / Math.max(metrics.span.length, 1)) * 0.2));
    default:
      return 0.5;
  }
}

function denseAreaIntentScenario(candidate) {
  return {
    scenario: 'dense_area_intent',
    confidence: candidate.confidence,
    rawRange: candidate.rawRange,
    anchorRawPointIds: uniqueNumbers([
      candidate.span[0]?.sourceRawPointId,
      candidate.span.at(-1)?.sourceRawPointId
    ]),
    action: 'classify_dense_area_intent',
    localRebuild: 'dense_area_intent_classifier',
    evidence: {
      ...candidate.evidence,
      plannedSettlement: denseAreaIntentPlannedSettlement(candidate.intent)
    }
  };
}

function denseAreaIntentPlannedSettlement(intent) {
  switch (intent) {
    case 'forward_motion': return 'dense_main_route_settlement';
    case 'stationary': return 'stationary_drift_or_session_collapse';
    case 'round_trip': return 'round_trip_settlement';
    case 'gap_cluster': return 'enclosed_gap_cluster_settlement';
    default: return 'existing_composite_scenarios';
  }
}

function buildDenseAreaSettlementPlan(product, denseAreaIntents = []) {
  return denseAreaIntents.map((intent) => {
    const plannedSettlement = denseAreaIntentPlannedSettlement(intent.intent);
    const overlappingScenarios = product.scenarios
      .filter((scenario) => scenario.scenario !== 'dense_area_intent'
        && rawRangesOverlap(scenario.rawRange, intent.rawRange))
      .map((scenario) => scenario.scenario);
    return {
      intent: intent.intent,
      rawRange: intent.rawRange,
      confidence: intent.confidence,
      plannedSettlement,
      settlementPriority: denseAreaSettlementPriority(intent.intent),
      observedScenarios: uniqueStrings(overlappingScenarios)
    };
  }).sort((a, b) =>
    a.settlementPriority - b.settlementPriority
    || a.rawRange.startRawPointId - b.rawRange.startRawPointId);
}

function denseAreaSettlementPriority(intent) {
  switch (intent) {
    case 'forward_motion': return 10;
    case 'stationary': return 20;
    case 'round_trip': return 30;
    case 'gap_cluster': return 40;
    case 'mixed': return 90;
    default: return 100;
  }
}

function buildDenseIntentConflicts(product) {
  return product.scenarios
    .filter((scenario) => scenario.evidence?.localMicroMoveOverridesDenseForward === true)
    .filter((scenario) => !restMicroMoveConflictShouldPreferForwardSpine(product, scenario))
    .map((scenario) => ({
      conflict: 'local_micro_move_overrides_dense_forward',
      rawRange: scenario.rawRange,
      scenario: scenario.scenario,
      action: scenario.action,
      localRebuild: scenario.localRebuild,
      denseAreaIntents: scenario.evidence.denseAreaIntents || [],
      pathMeters: scenario.evidence.pathMeters,
      netDistanceMeters: scenario.evidence.netDistanceMeters,
      bboxDiagonalMeters: scenario.evidence.bboxDiagonalMeters,
      lowSpeedRatio: scenario.evidence.lowSpeedRatio,
      resolution: 'prefer_local_rest_photo_micro_move'
    }))
    .sort((a, b) => a.rawRange.startRawPointId - b.rawRange.startRawPointId);
}

function restMicroMoveConflictShouldPreferForwardSpine(product, scenario) {
  if (scenario.scenario !== 'rest_photo_micro_move') return false;
  const intents = scenario.evidence?.denseAreaIntents || [];
  if (intents.length === 0 || intents.some((intent) => intent !== 'forward_motion')) {
    return false;
  }
  return product.scenarios.some((candidate) =>
    candidate.scenario === 'enclosed_loop_cluster_settlement'
      && rawRangesOverlap(candidate.rawRange, scenario.rawRange));
}

function applyForwardSpineArbitrationReview(product, denseAreaIntents = []) {
  const candidates = buildForwardSpineCandidates(product, denseAreaIntents);
  const overlaps = buildForwardSpineOverlaps(candidates);
  const conflicts = buildForwardSpineConflicts(product, candidates, overlaps);
  product.forwardSpineCandidates = candidates;
  product.forwardSpineOverlaps = overlaps;
  product.forwardSpineConflicts = conflicts;
  product.forwardSpineDecisions = buildForwardSpineDecisions(candidates, overlaps, conflicts);
}

function buildForwardSpineCandidates(product, denseAreaIntents = []) {
  const denseIntentCandidates = denseAreaIntents
    .filter((intent) => intent.intent === 'forward_motion')
    .map((intent, index) => forwardSpineCandidateFromIntent(product, intent, index))
    .filter(Boolean);
  const denseMainRouteCandidates = product.scenarios
    .filter((scenario) => scenario.scenario === 'dense_main_route_settlement')
    .map((scenario, index) => forwardSpineCandidateFromScenario(product, scenario, index))
    .filter(Boolean);
  return [...denseIntentCandidates, ...denseMainRouteCandidates]
    .map((candidate, index) => ({
      ...candidate,
      candidateId: `fsp-${index + 1}`
    }));
}

function forwardSpineCandidateFromIntent(product, intent, index) {
  const rawRange = intent.rawRange;
  if (!validRawRange(rawRange)) return null;
  const points = rawDecisionPointsInRange(product, rawRange);
  const endpoints = endpointPair(points);
  return {
    source: 'dense_area_intent',
    sourceScenario: 'dense_area_intent',
    sourceIndex: index,
    rawRange,
    trackPointRange: trackPointRangeForRawRange(product, rawRange),
    directionDegrees: directionDegreesForPoints(endpoints),
    pathMeters: scenarioNumber(intent.evidence?.pathMeters ?? trackPathMeters(points)),
    netDistanceMeters: scenarioNumber(intent.evidence?.netDistanceMeters
      ?? trackNetDistanceMeters(points)),
    bboxDiagonalMeters: scenarioNumber(intent.evidence?.bboxDiagonalMeters
      ?? bboxDiagonalMeters(points)),
    confidence: scenarioNumber(intent.confidence),
    plannedSettlement: denseAreaIntentPlannedSettlement(intent.intent),
    reviewOnly: true
  };
}

function forwardSpineCandidateFromScenario(product, scenario, index) {
  const rawRange = scenario.rawRange;
  if (!validRawRange(rawRange)) return null;
  const points = rawDecisionPointsInRange(product, rawRange);
  const endpoints = endpointPair(points);
  return {
    source: 'dense_main_route_settlement',
    sourceScenario: scenario.scenario,
    sourceScenarioId: scenario.scenarioId,
    sourceIndex: index,
    rawRange,
    trackPointRange: trackPointRangeForRawRange(product, rawRange),
    directionDegrees: directionDegreesForPoints(endpoints),
    pathMeters: scenarioNumber(scenario.evidence?.pathMeters ?? trackPathMeters(points)),
    netDistanceMeters: scenarioNumber(scenario.evidence?.netDistanceMeters
      ?? trackNetDistanceMeters(points)),
    bboxDiagonalMeters: scenarioNumber(scenario.evidence?.bboxDiagonalMeters
      ?? bboxDiagonalMeters(points)),
    confidence: scenarioNumber(scenario.confidence),
    plannedSettlement: scenario.scenario,
    reviewOnly: false
  };
}

function buildForwardSpineOverlaps(candidates) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex++) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const overlap = forwardSpineOverlap(left, right);
      if (overlap) overlaps.push(overlap);
    }
  }
  return overlaps;
}

function forwardSpineOverlap(left, right) {
  const rawOverlap = rawRangeIntersection(left.rawRange, right.rawRange);
  const rawGap = rawRangeGap(left.rawRange, right.rawRange);
  if (!rawOverlap && rawGap > 8) return null;
  const directionDeltaDegrees = angleDeltaDegrees(left.directionDegrees, right.directionDegrees);
  const relationship = rawOverlap
    ? forwardSpineRawOverlapRelationship(left.rawRange, right.rawRange, directionDeltaDegrees)
    : 'endpoint_touch';
  return {
    leftCandidateId: left.candidateId,
    rightCandidateId: right.candidateId,
    relationship,
    rawRange: rawOverlap || rawRangeBetween(left.rawRange, right.rawRange),
    rawOverlapCount: rawOverlap
      ? rawOverlap.endRawPointId - rawOverlap.startRawPointId + 1
      : 0,
    rawGap,
    directionDeltaDegrees: scenarioNumber(directionDeltaDegrees)
  };
}

function forwardSpineRawOverlapRelationship(left, right, directionDeltaDegrees) {
  if (rawRangeContains(left, right) || rawRangeContains(right, left)) {
    return 'nested';
  }
  if (Number.isFinite(directionDeltaDegrees) && directionDeltaDegrees > 45) {
    return 'crossing';
  }
  return 'overlap';
}

function buildForwardSpineConflicts(product, candidates, overlaps) {
  const conflicts = [];
  for (const scenario of product.scenarios) {
    if (scenario.scenario !== 'rest_photo_micro_move') continue;
    if (!restMicroMoveConflictShouldPreferForwardSpine(product, scenario)) continue;
    conflicts.push({
      conflict: 'local_micro_move_overrides_forward_spine',
      rawRange: scenario.rawRange,
      candidateIds: candidates
        .filter((candidate) => rawRangesOverlap(candidate.rawRange, scenario.rawRange))
        .map((candidate) => candidate.candidateId),
      scenario: scenario.scenario,
      action: scenario.action,
      resolution: 'review_forward_spine_preferred',
      reviewOnly: true,
      evidence: {
        pathMeters: scenario.evidence?.pathMeters,
        netDistanceMeters: scenario.evidence?.netDistanceMeters,
        bboxDiagonalMeters: scenario.evidence?.bboxDiagonalMeters,
        denseAreaIntents: scenario.evidence?.denseAreaIntents || []
      }
    });
  }
  return conflicts.sort((a, b) =>
    a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || String(a.conflict).localeCompare(String(b.conflict)));
}

function buildForwardSpineDecisions(candidates, overlaps, conflicts) {
  const conflictedCandidateIds = new Set(conflicts.flatMap((conflict) =>
    conflict.candidateIds || []));
  const decisions = conflicts.map((conflict) => ({
    rawRange: conflict.rawRange,
    candidateIds: conflict.candidateIds || [],
    decision: conflict.reviewOnly ? 'review_only' : forwardSpineDecisionForConflict(conflict),
    reason: conflict.conflict,
    reviewOnly: conflict.reviewOnly !== false
  }));
  for (const candidate of candidates) {
    if (conflictedCandidateIds.has(candidate.candidateId)) continue;
    decisions.push({
      rawRange: candidate.rawRange,
      candidateIds: [candidate.candidateId],
      decision: 'select',
      reason: 'single_forward_spine_candidate',
      reviewOnly: true
    });
  }
  return decisions.sort((a, b) =>
    a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || a.candidateIds.join(',').localeCompare(b.candidateIds.join(',')));
}

function forwardSpineDecisionForConflict(conflict) {
  return 'review_only';
}

function rawDecisionPointsInRange(product, rawRange) {
  if (!validRawRange(rawRange)) return [];
  return product.rawPointDecisions
    .filter((point) => point.rawPointId >= rawRange.startRawPointId
      && point.rawPointId <= rawRange.endRawPointId
      && hasValidLngLat(point))
    .map((point) => ({
      ...point,
      sourceRawPointId: point.rawPointId
    }));
}

function trackPointRangeForRawRange(product, rawRange) {
  const ids = product.track
    .filter((point) => trackPointTouchesRawRange(point, rawRange))
    .map((point) => point.trackPointId);
  return ids.length > 0
    ? { startTrackPointId: Math.min(...ids), endTrackPointId: Math.max(...ids) }
    : { startTrackPointId: null, endTrackPointId: null };
}

function trackPointTouchesRawRange(point, rawRange) {
  if (!validRawRange(rawRange)) return false;
  if (point.sourceRawPointId >= rawRange.startRawPointId
      && point.sourceRawPointId <= rawRange.endRawPointId) {
    return true;
  }
  return (point.contributingRawPointIds || []).some((rawPointId) =>
    rawPointId >= rawRange.startRawPointId && rawPointId <= rawRange.endRawPointId);
}

function endpointPair(points) {
  const valid = (points || []).filter(hasValidLngLat);
  return valid.length >= 2 ? [valid[0], valid.at(-1)] : [];
}

function directionDegreesForPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const [start, end] = points;
  if (!hasValidLngLat(start) || !hasValidLngLat(end)) return null;
  const lat1 = start.lat * Math.PI / 180;
  const lat2 = end.lat * Math.PI / 180;
  const deltaLng = (end.lng - start.lng) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function angleDeltaDegrees(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function rawRangeIntersection(left, right) {
  if (!validRawRange(left) || !validRawRange(right) || !rawRangesOverlap(left, right)) {
    return null;
  }
  return {
    startRawPointId: Math.max(left.startRawPointId, right.startRawPointId),
    endRawPointId: Math.min(left.endRawPointId, right.endRawPointId)
  };
}

function rawRangeGap(left, right) {
  if (!validRawRange(left) || !validRawRange(right) || rawRangesOverlap(left, right)) return 0;
  if (left.endRawPointId < right.startRawPointId) return right.startRawPointId - left.endRawPointId;
  return left.startRawPointId - right.endRawPointId;
}

function rawRangeBetween(left, right) {
  return {
    startRawPointId: Math.min(left.endRawPointId, right.endRawPointId),
    endRawPointId: Math.max(left.startRawPointId, right.startRawPointId)
  };
}

function validRawRange(rawRange) {
  return Number.isFinite(rawRange?.startRawPointId)
    && Number.isFinite(rawRange?.endRawPointId)
    && rawRange.startRawPointId <= rawRange.endRawPointId;
}

function settleDenseMainRouteSpans(product, config, denseAreaIntents = []) {
  if (!config.denseMainRouteSettlementEnabled) return false;
  const forwardIntentRanges = denseAreaIntents
    .filter((intent) => intent.intent === 'forward_motion')
    .map((intent) => intent.rawRange)
    .filter(Boolean);
  const candidates = nonOverlappingScenarioCandidates(
    denseMainRouteCandidates(product.track, config)
      .filter((candidate) =>
        denseMainRouteCandidateAllowedByIntent(candidate, forwardIntentRanges, config)),
    []
  );
  if (candidates.length === 0) return false;

  const settledRanges = [];
  for (const candidate of candidates.sort((a, b) => b.startIndex - a.startIndex)) {
    const settled = denseMainRoutePoints(candidate, config);
    if (settled.length >= candidate.span.length) continue;
    product.track.splice(candidate.startIndex,
      candidate.endIndex - candidate.startIndex + 1, ...settled);
    addScenario(product, denseMainRouteScenario(candidate, settled, config));
    settledRanges.push({
      startRawPointId: candidate.rawRange.startRawPointId,
      endRawPointId: candidate.rawRange.endRawPointId,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: settled.length
    });
  }
  if (settledRanges.length === 0) return false;

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.denseMainRouteSettlement = {
    settledSpanCount: settledRanges.length,
    settledRawPointRanges: settledRanges.reverse()
  };
  return true;
}

function denseMainRouteCandidateAllowedByIntent(candidate, forwardIntentRanges, config) {
  if (!config.denseAreaIntentEnabled || !config.denseAreaIntentControlsMainRouteSettlement) {
    return true;
  }
  return forwardIntentRanges.some((range) => rawRangeContains(range, candidate.rawRange));
}

function denseAreaIntentsForRange(denseAreaIntents, rawRange) {
  return denseAreaIntents.filter((intent) => rawRangesOverlap(intent.rawRange, rawRange));
}

function denseMainRouteCandidates(track, config) {
  const candidates = [];
  let startIndex = 0;
  while (startIndex < track.length) {
    while (startIndex < track.length && !canBeDenseMainRoutePoint(track[startIndex])) {
      startIndex++;
    }
    let endIndex = startIndex;
    while (endIndex < track.length && canBeDenseMainRoutePoint(track[endIndex])) {
      endIndex++;
    }
    if (endIndex - startIndex >= config.denseMainRouteMinTrackPoints) {
      const span = track.slice(startIndex, endIndex);
      const candidate = denseMainRouteCandidate(span, startIndex, endIndex - 1, config);
      if (candidate) candidates.push(candidate);
    }
    startIndex = Math.max(endIndex + 1, startIndex + 1);
  }
  return candidates;
}

function canBeDenseMainRoutePoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && point.countsDistance === true
    && !isTransportTrackReason(point.reason)
    && (point.reason === 'moving_good_fix'
      || point.reason === 'motion_supported_low_speed'
      || point.reason === 'continuity_rescue_low_accuracy');
}

function denseMainRouteCandidate(span, startIndex, endIndex, config) {
  const pathMeters = trackPathMeters(span);
  const netDistanceMeters = trackNetDistanceMeters(span);
  if (netDistanceMeters < config.denseMainRouteMinNetDistanceMeters) return null;
  if (pathMeters / Math.max(netDistanceMeters, 1) > config.denseMainRouteMaxPathNetRatio) {
    return null;
  }
  const bboxMeters = bboxDiagonalMeters(span);
  if (bboxMeters > config.denseMainRouteMaxBboxMeters) return null;
  const keepIndexes = denseMainRouteKeepIndexes(span, config);
  if (keepIndexes.length >= span.length) return null;
  const simplifiedPathMeters = trackPathMeters(keepIndexes.map((index) => span[index]));
  if (simplifiedPathMeters / Math.max(pathMeters, 1)
      > 1 - config.denseMainRouteMinPathReductionRatio) {
    return null;
  }
  return {
    scenario: 'dense_main_route_settlement',
    startIndex,
    endIndex,
    span,
    rawRange: trackSpanRawPointRange(span),
    pathMeters,
    netDistanceMeters,
    bboxMeters,
    simplifiedPathMeters,
    keepIndexes,
    score: span.length * 10 + pathMeters
  };
}

function denseMainRouteKeepIndexes(span, config) {
  const keepIndexes = new Set([0, span.length - 1]);
  simplifySpanByDistance(span, 0, span.length - 1,
    config.denseMainRouteSimplifyToleranceMeters, keepIndexes);
  return [...keepIndexes].sort((a, b) => a - b);
}

function denseMainRoutePoints(candidate, config) {
  const keepIndexes = candidate.keepIndexes ?? denseMainRouteKeepIndexes(candidate.span, config);
  return keepIndexes.map((spanIndex, keepIndex) =>
    denseMainRouteKeptPoint(candidate, keepIndexes, spanIndex, keepIndex));
}

function denseMainRouteKeptPoint(candidate, keepIndexes, spanIndex, keepIndex) {
  const original = candidate.span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keepIndexes[keepIndex - 1];
  const group = candidate.span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const rawPointIds = uniqueRawPointIds(group);
  const previousKept = keepIndex === 0 ? null : candidate.span[previousKeptSpanIndex];
  const distanceDeltaMeters = previousKept
    ? distanceMeters(previousKept.lat, previousKept.lng, original.lat, original.lng)
    : original.distanceDeltaMeters || 0;
  const aggregateMovingTime = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds || 0 : 0), 0);
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keepIndexes.length - 1;
  return {
    ...original,
    reason: denseMainRouteReason(isStart, isEnd),
    distanceDeltaMeters,
    movingTimeDeltaSeconds: aggregateMovingTime,
    cloudType: 'DENSE_MAIN_ROUTE_CLOUD',
    cloudId: candidate.rawRange.startRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: candidate.bboxMeters / 2,
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: 'dense_main_route',
    boundaryState: 'dense_main_route_settled',
    countsDistance: distanceDeltaMeters > 0,
    countsMovingTime: aggregateMovingTime > 0 && distanceDeltaMeters > 0,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function denseMainRouteReason(isStart, isEnd) {
  if (isStart) return 'dense_main_route_start';
  if (isEnd) return 'dense_main_route_end';
  return 'dense_main_route_shape';
}

function denseMainRouteScenario(candidate, settled, config) {
  return {
    scenario: 'dense_main_route_settlement',
    confidence: 0.78,
    rawRange: candidate.rawRange,
    anchorRawPointIds: uniqueNumbers(settled.map((point) => point.sourceRawPointId)),
    action: 'preserve_dense_main_route_skeleton',
    localRebuild: 'dense_main_route_skeleton',
    evidence: {
      intent: 'forward_motion',
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: settled.length,
      pathMeters: scenarioNumber(candidate.pathMeters),
      netDistanceMeters: scenarioNumber(candidate.netDistanceMeters),
      simplifiedPathMeters: scenarioNumber(trackPathMeters(settled)),
      bboxDiagonalMeters: scenarioNumber(candidate.bboxMeters),
      simplifyToleranceMeters: scenarioNumber(config.denseMainRouteSimplifyToleranceMeters)
    }
  };
}

function collapseDwellDriftClouds(product, evidence, config, denseAreaIntents = []) {
  if (!config.dwellDriftCollapseEnabled) return false;
  const intervals = findDwellDriftIntervals(evidence.rawPoints, config)
    .sort((a, b) => b.startIndex - a.startIndex);
  if (intervals.length === 0) return false;

  let changed = false;
  for (const interval of intervals) {
    const rawPointIds = new Set(interval.rawPoints.map((point) => point.rawPointId));
    const trackIndexes = [];
    for (let index = 0; index < product.track.length; index++) {
      if (trackPointOverlapsRawIds(product.track[index], rawPointIds)) {
        trackIndexes.push(index);
      }
    }
    if (trackIndexes.length === 0) continue;

    const insertIndex = trackIndexes[0];
    const template = product.track[insertIndex];
    const collapsedPoint = dwellDriftAnchor(interval, template);
    const removeIndexes = new Set(trackIndexes);
    product.track = product.track.filter((point, index) => !removeIndexes.has(index));
    product.track.splice(insertIndex, 0, collapsedPoint);
    removeExcludedRawPoints(product, rawPointIds);
    addScenario(product, stationaryDwellDriftScenario(interval, denseAreaIntents));
    changed = true;
  }

  if (!changed) return false;
  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.dwellDriftCollapse = {
    collapsedCloudCount: intervals.length,
    collapsedRawPointIds: intervals.flatMap((interval) =>
      interval.rawPoints.map((point) => point.rawPointId))
  };
  return true;
}

function stationaryDwellDriftScenario(interval, denseAreaIntents = []) {
  const first = interval.rawPoints[0];
  const last = interval.rawPoints.at(-1);
  const representative = nearestRawPoint(weightedRawCenter(interval.rawPoints), interval.rawPoints);
  const durationSeconds = elapsedSeconds(first.elapsedRealtimeNanos,
    last.elapsedRealtimeNanos);
  const bboxMeters = bboxDiagonalMeters(interval.rawPoints);
  const netDistanceMeters = distanceMeters(first.lat, first.lng, last.lat, last.lng);
  const coreRatio = interval.coreRawPoints.length / Math.max(interval.rawPoints.length, 1);
  const rawRange = {
    startRawPointId: first.rawPointId,
    endRawPointId: last.rawPointId
  };
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, rawRange);
  return {
    scenario: 'stationary_drift_collapse',
    confidence: scenarioNumber(clamp01(0.5
      + Math.min(1, durationSeconds / 180) * 0.15
      + (1 - Math.min(1, bboxMeters / 100)) * 0.15
      + (1 - Math.min(1, netDistanceMeters / 80)) * 0.1
      + Math.min(1, coreRatio) * 0.1)),
    rawRange,
    anchorRawPointIds: [representative.rawPointId],
    action: 'collapse_drift_cloud',
    localRebuild: 'stationary_drift_anchor',
    evidence: {
      rawPointCount: interval.rawPoints.length,
      coreRawPointCount: interval.coreRawPoints.length,
      coreStartRawPointId: interval.coreRawPoints[0]?.rawPointId ?? null,
      coreEndRawPointId: interval.coreRawPoints.at(-1)?.rawPointId ?? null,
      representativeRawPointId: representative.rawPointId,
      denseAreaIntents: overlappingIntents.map((intent) => intent.intent),
      stationaryIntentSupported: overlappingIntents.some((intent) =>
        intent.intent === 'stationary'),
      durationSeconds: scenarioNumber(durationSeconds),
      bboxDiagonalMeters: scenarioNumber(bboxMeters),
      netDistanceMeters: scenarioNumber(netDistanceMeters),
      coreRatio: scenarioNumber(coreRatio)
    }
  };
}

function preserveWeakRecoveryShapeAnchors(product, evidence, config) {
  if (!config.weakRecoveryShapePreserveEnabled) return false;
  const candidates = weakRecoveryShapeCandidates(product, evidence, config);
  if (candidates.length === 0) return false;

  let changed = false;
  const insertedRawPointIds = [];
  for (const candidate of candidates) {
    const rawPointIds = new Set(candidate.rawPoints.map((point) => point.rawPointId));
    if (product.track.some((point) => trackPointOverlapsRawIds(point, rawPointIds))) {
      continue;
    }

    const insertIndex = product.track.findIndex((point) =>
      point.elapsedRealtimeNanos > candidate.representative.elapsedRealtimeNanos);
    const targetIndex = insertIndex >= 0 ? insertIndex : product.track.length;
    const segmentId = weakRecoveryShapeSegmentId(product.track, targetIndex);
    const anchor = weakRecoveryShapeAnchor(candidate, segmentId);
    product.track.splice(targetIndex, 0, anchor);
    removeExcludedRawPoints(product, rawPointIds);
    addScenario(product, weakRecoveryEndpointScenario(candidate));
    insertedRawPointIds.push(...candidate.rawPoints.map((point) => point.rawPointId));
    changed = true;
  }

  if (!changed) return false;
  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.weakRecoveryShapePreserve = {
    anchorCount: product.track
      .filter((point) => point.reason === 'weak_recovery_shape_anchor').length,
    preservedRawPointIds: insertedRawPointIds
  };
  return true;
}

function weakRecoveryShapeCandidates(product, evidence, config) {
  const rawPointById = new Map(evidence.rawPoints.map((point) => [point.rawPointId, point]));
  const trustedRawPointIds = trackRawPointIds(product.track);
  const latestCloudById = new Map();
  for (const point of product.excluded.weak) {
    if (point.reason !== 'gap_recovery_pending') continue;
    const decision = point.decision;
    const cloudId = decision?.cloudId ?? point.rawPointId;
    const contributingRawPointIds = decision?.contributingRawPointIds?.length
      ? decision.contributingRawPointIds
      : [point.rawPointId];
    const existing = latestCloudById.get(cloudId);
    if (!existing
        || contributingRawPointIds.length > existing.contributingRawPointIds.length
        || point.rawPointId > existing.point.rawPointId) {
      latestCloudById.set(cloudId, { point, contributingRawPointIds });
    }
  }

  const candidates = [];
  for (const snapshot of latestCloudById.values()) {
    const coreRawPoints = snapshot.contributingRawPointIds
      .map((rawPointId) => rawPointById.get(rawPointId))
      .filter(Boolean);
    if (coreRawPoints.length < config.weakRecoveryShapeMinSamples) continue;
    const rawPoints = extendWeakRecoveryShapeRawPoints(coreRawPoints,
      evidence.rawPoints, config, trustedRawPointIds);
    const first = coreRawPoints[0];
    const previousTrusted = previousTrackPointBefore(product.track, first.elapsedRealtimeNanos);
    if (!previousTrusted) continue;
    if (elapsedSeconds(previousTrusted.elapsedRealtimeNanos, first.elapsedRealtimeNanos)
        <= config.gapSeconds) {
      continue;
    }

    const center = rawPointCloudCenter(rawPoints);
    const coreRadiusMeters = cloudRadiusMeters(coreRawPoints);
    if (coreRadiusMeters > config.weakRecoveryShapeMaxRadiusMeters) continue;
    const bestAccuracy = Math.min(...coreRawPoints.map((point) => point.accuracy)
      .filter(Number.isFinite));
    if (!Number.isFinite(bestAccuracy)
        || bestAccuracy > config.weakRecoveryShapeMaxBestAccuracyMeters) {
      continue;
    }
    const distanceFromTrusted = distanceMeters(previousTrusted.lat, previousTrusted.lng,
      center.lat, center.lng);
    if (distanceFromTrusted < config.weakRecoveryShapeMinDistanceFromTrustedMeters) {
      continue;
    }
    const gapSeconds = elapsedSeconds(previousTrusted.elapsedRealtimeNanos,
      first.elapsedRealtimeNanos);

    candidates.push({
      rawPoints,
      coreRawPoints,
      center,
      representative: weakRecoveryShapeRepresentative(center, rawPoints),
      previousTrusted,
      gapSeconds,
      distanceFromTrusted,
      radiusMeters: center.radiusMeters,
      coreRadiusMeters,
      bestAccuracy
    });
  }
  return candidates.sort((a, b) =>
    a.representative.elapsedRealtimeNanos - b.representative.elapsedRealtimeNanos);
}

function extendWeakRecoveryShapeRawPoints(coreRawPoints, allRawPoints, config,
  blockedRawPointIds = new Set()) {
  const included = [...coreRawPoints];
  const rawPointById = new Map(allRawPoints.map((point) => [point.rawPointId, point]));
  const coreRawPointIds = new Set(coreRawPoints.map((point) => point.rawPointId));
  let previous = coreRawPoints.at(-1);
  while (included.length < coreRawPoints.length + config.weakRecoveryShapeMaxExtensionSamples) {
    const next = rawPointById.get(previous.rawPointId + 1);
    if (!next) break;
    if (blockedRawPointIds.has(next.rawPointId) && !coreRawPointIds.has(next.rawPointId)) break;
    const gapSeconds = elapsedSeconds(previous.elapsedRealtimeNanos, next.elapsedRealtimeNanos);
    if (gapSeconds <= 0 || gapSeconds > config.weakRecoveryShapeExtensionGapSeconds) break;
    const distance = distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
    if (distance > config.weakRecoveryShapeExtensionDistanceMeters) break;
    if (!Number.isFinite(next.accuracy)) break;
    included.push(next);
    previous = next;
  }
  return included;
}

function trackRawPointIds(track) {
  const rawPointIds = new Set();
  for (const point of track) {
    const pointRawPointIds = point.contributingRawPointIds?.length
      ? point.contributingRawPointIds
      : [point.sourceRawPointId];
    for (const rawPointId of pointRawPointIds) {
      rawPointIds.add(rawPointId);
    }
  }
  return rawPointIds;
}

function previousTrackPointBefore(track, elapsedRealtimeNanos) {
  let previous = null;
  for (const point of track) {
    if (point.elapsedRealtimeNanos >= elapsedRealtimeNanos) break;
    previous = point;
  }
  return previous;
}

function weakRecoveryShapeRepresentative(center, rawPoints) {
  return [...rawPoints].sort((a, b) =>
    a.accuracy - b.accuracy
    || distanceMeters(center.lat, center.lng, a.lat, a.lng)
      - distanceMeters(center.lat, center.lng, b.lat, b.lng)
    || a.rawPointId - b.rawPointId)[0];
}

function weakRecoveryShapeSegmentId(track, insertIndex) {
  const next = track[insertIndex] ?? null;
  if (next?.startsNewSegment === true && Number.isFinite(next.segmentId)) {
    return next.segmentId;
  }
  const previous = track[insertIndex - 1] ?? null;
  if (Number.isFinite(previous?.segmentId)) return previous.segmentId + 1;
  return 1;
}

function weakRecoveryShapeAnchor(candidate, segmentId) {
  const representative = candidate.representative;
  const endpoint = candidate.rawPoints.at(-1) ?? representative;
  return {
    trackPointId: 0,
    sourceRawPointId: representative.rawPointId,
    recomputedDecisionId: representative.rawPointId,
    segmentId,
    lat: candidate.center.lat,
    lng: candidate.center.lng,
    elapsedRealtimeNanos: representative.elapsedRealtimeNanos,
    timeMillis: representative.timeMillis,
    result: 'anchor',
    reason: 'weak_recovery_shape_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: true,
    cloudType: 'WEAK_RECOVERY_SHAPE_CLOUD',
    cloudId: candidate.rawPoints[0].rawPointId,
    cloudSampleCount: candidate.rawPoints.length,
    cloudWeightSum: candidate.center.weight,
    cloudWeightedRadiusMeters: candidate.radiusMeters,
    representativeRawPointId: representative.rawPointId,
    contributingRawPointIds: candidate.rawPoints.map((point) => point.rawPointId),
    shapeEndpointRawPointId: endpoint.rawPointId,
    shapeEndpointLat: endpoint.lat,
    shapeEndpointLng: endpoint.lng,
    coordinateSource: 'cloud_center',
    virtualCoordinate: true,
    activityState: 'weak_recovery_shape',
    boundaryState: 'gap_recovery_shape_preserved',
    gnssAltitudeResult: 'reset',
    gnssAltitudeReason: 'gap_recovery_reset',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function addScenario(product, scenario) {
  product.scenarios.push({
    scenarioId: product.scenarios.length + 1,
    ...scenario
  });
}

function weakRecoveryEndpointScenario(candidate) {
  const first = candidate.rawPoints[0];
  const last = candidate.rawPoints.at(-1);
  const endpoint = last ?? candidate.representative;
  return {
    scenario: 'weak_recovery_endpoint',
    confidence: scenarioNumber(weakRecoveryEndpointConfidence(candidate)),
    rawRange: {
      startRawPointId: first.rawPointId,
      endRawPointId: endpoint.rawPointId
    },
    anchorRawPointIds: uniqueNumbers([
      candidate.representative.rawPointId,
      endpoint.rawPointId
    ]),
    action: 'preserve_endpoint_anchor',
    localRebuild: 'weak_recovery_shape_anchor',
    evidence: {
      previousTrustedRawPointId: candidate.previousTrusted.sourceRawPointId,
      coreStartRawPointId: candidate.coreRawPoints[0]?.rawPointId ?? null,
      coreEndRawPointId: candidate.coreRawPoints.at(-1)?.rawPointId ?? null,
      coreSampleCount: candidate.coreRawPoints.length,
      preservedRawPointCount: candidate.rawPoints.length,
      gapSeconds: scenarioNumber(candidate.gapSeconds),
      coreRadiusMeters: scenarioNumber(candidate.coreRadiusMeters),
      cloudRadiusMeters: scenarioNumber(candidate.radiusMeters),
      bestAccuracyMeters: scenarioNumber(candidate.bestAccuracy),
      distanceFromPreviousTrustedMeters: scenarioNumber(candidate.distanceFromTrusted),
      endpointRawPointId: endpoint.rawPointId,
      coordinatePolicy: 'cloud_center_then_endpoint_when_same_road_rewrite'
    }
  };
}

function weakRecoveryEndpointConfidence(candidate) {
  const sampleScore = Math.min(1, candidate.coreRawPoints.length / 5);
  const radiusScore = 1 - Math.min(1, candidate.coreRadiusMeters / 25);
  const accuracyScore = 1 - Math.min(1, candidate.bestAccuracy / 80);
  const distanceScore = Math.min(1, candidate.distanceFromTrusted / 120);
  return clamp01(0.45
    + sampleScore * 0.15
    + radiusScore * 0.15
    + accuracyScore * 0.1
    + distanceScore * 0.15);
}

function simplifyRoundTripLineSpans(product, config, denseAreaIntents = []) {
  if (!config.roundTripLineSimplifyEnabled) return false;
  const candidates = [];
  for (let index = 0; index < product.track.length; index++) {
    if (product.track[index].reason !== 'weak_recovery_shape_anchor') continue;
    const candidate = roundTripLineCandidate(product.track, index, config);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return false;

  const accepted = nonOverlappingRoundTripCandidates(candidates);
  if (accepted.length === 0) return false;

  for (const candidate of accepted.sort((a, b) => b.startIndex - a.startIndex)) {
    const sameRoad = isRoundTripSameRoadCorridor(candidate, config);
    const collapsed = sameRoad
      ? roundTripSameRoadPoints(candidate, config)
      : roundTripLinePoints(candidate, config);
    product.track.splice(candidate.startIndex,
      candidate.endIndex - candidate.startIndex + 1, ...collapsed);
    addScenario(product, roundTripLineScenario(candidate, collapsed, sameRoad, config,
      denseAreaIntents));
  }

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.roundTripLineSimplify = {
    collapsedSpanCount: accepted.length,
    collapsedRawPointRanges: accepted.map((candidate) => ({
      startRawPointId: candidate.start.sourceRawPointId,
      turnRawPointId: candidate.turn.sourceRawPointId,
      endRawPointId: candidate.end.sourceRawPointId,
      collapsedTrackPointCount: candidate.span.length
    }))
  };
  return true;
}

function roundTripLineCandidate(track, turnIndex, config) {
  const turn = track[turnIndex];
  const startLowerRawPointId = turn.sourceRawPointId
    - config.roundTripLineMaxRawPointIdSpanBefore;
  const endUpperRawPointId = turn.sourceRawPointId
    + config.roundTripLineMaxRawPointIdSpanAfter;
  const candidates = [];

  for (let startIndex = turnIndex - 1; startIndex >= 0; startIndex--) {
    const start = track[startIndex];
    if (start.sourceRawPointId < startLowerRawPointId) break;
    if (!canBeRoundTripEndpoint(start)) continue;

    const endIndex = latestRoundTripEndIndex(track, turnIndex, start, endUpperRawPointId,
      config);
    if (endIndex < 0) continue;

    const end = track[endIndex];
    const span = track.slice(startIndex, endIndex + 1);
    if (span.length < config.roundTripLineMinTrackPoints) continue;
    const endpointDistance = distanceMeters(start.lat, start.lng, end.lat, end.lng);
    const turnDistance = Math.min(
      distanceMeters(start.lat, start.lng, turn.lat, turn.lng),
      distanceMeters(end.lat, end.lng, turn.lat, turn.lng)
    );
    if (turnDistance < config.roundTripLineMinTurnDistanceMeters) continue;
    const crossTrack = roundTripLineMaxCrossTrackMeters(span, start, turn, end);
    if (crossTrack > config.roundTripLineMaxCrossTrackMeters) continue;

    candidates.push({
      startIndex,
      turnIndex,
      endIndex,
      start,
      turn,
      end,
      span,
      endpointDistance,
      turnDistance,
      crossTrack
    });
  }

  return candidates.sort((a, b) =>
    b.end.sourceRawPointId - a.end.sourceRawPointId
    || a.start.sourceRawPointId - b.start.sourceRawPointId
    || a.endpointDistance - b.endpointDistance)[0] ?? null;
}

function roundTripLineScenario(candidate, collapsed, sameRoad, config, denseAreaIntents = []) {
  const sameRoadEvidence = sameRoad ? roundTripSameRoadEvidence(candidate) : null;
  const turnEndpointRawPointId = candidate.turn.shapeEndpointRawPointId
    ?? candidate.turn.sourceRawPointId;
  const rawRange = {
    startRawPointId: candidate.start.sourceRawPointId,
    endRawPointId: candidate.end.sourceRawPointId
  };
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, rawRange);
  return {
    scenario: sameRoad ? 'same_road_round_trip' : 'round_trip_line',
    confidence: scenarioNumber(roundTripLineConfidence(candidate, sameRoad, config,
      sameRoadEvidence)),
    rawRange,
    anchorRawPointIds: uniqueNumbers([
      candidate.turn.sourceRawPointId,
      turnEndpointRawPointId
    ]),
    action: sameRoad ? 'centerline_with_endpoint' : 'rdp_line_simplify',
    localRebuild: sameRoad ? 'same_road_centerline' : 'round_trip_polyline',
    evidence: {
      startRawPointId: candidate.start.sourceRawPointId,
      turnRawPointId: candidate.turn.sourceRawPointId,
      endpointRawPointId: turnEndpointRawPointId,
      endRawPointId: candidate.end.sourceRawPointId,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: collapsed.length,
      endpointDistanceMeters: scenarioNumber(candidate.endpointDistance),
      turnDistanceMeters: scenarioNumber(candidate.turnDistance),
      crossTrackMeters: scenarioNumber(candidate.crossTrack),
      simplifyToleranceMeters: scenarioNumber(config.roundTripLineSimplifyToleranceMeters),
      sameRoadBboxMeters: scenarioNumber(sameRoadEvidence?.bboxMeters),
      sameRoadApproachPairDistanceMeters:
        scenarioNumber(sameRoadEvidence?.approachPairDistanceMeters),
      denseAreaIntents: overlappingIntents.map((intent) => intent.intent),
      roundTripIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'round_trip')
    }
  };
}

function roundTripSameRoadEvidence(candidate) {
  const turnSpanIndex = candidate.turnIndex - candidate.startIndex;
  const beforeApproach = candidate.span[turnSpanIndex - 1];
  const afterApproach = candidate.span[turnSpanIndex + 1];
  const sameRoadPoints = candidate.span.filter((point, index) =>
    index !== turnSpanIndex && hasValidLngLat(point));
  return {
    bboxMeters: bboxDiagonalMeters(sameRoadPoints),
    approachPairDistanceMeters: distanceMeters(beforeApproach.lat, beforeApproach.lng,
      afterApproach.lat, afterApproach.lng)
  };
}

function roundTripLineConfidence(candidate, sameRoad, config, sameRoadEvidence) {
  const endpointScore = 1 - Math.min(1,
    candidate.endpointDistance / Math.max(config.roundTripLineMaxEndpointDistanceMeters, 1));
  const crossTrackScore = 1 - Math.min(1,
    candidate.crossTrack / Math.max(config.roundTripLineMaxCrossTrackMeters, 1));
  const turnScore = Math.min(1,
    candidate.turnDistance / Math.max(config.roundTripLineMinTurnDistanceMeters * 2, 1));
  const sameRoadScore = sameRoad && sameRoadEvidence
    ? 1 - Math.min(1,
        sameRoadEvidence.approachPairDistanceMeters
          / Math.max(config.roundTripSameRoadMaxApproachPairDistanceMeters, 1))
    : 0.5;
  return clamp01(0.4
    + endpointScore * 0.2
    + crossTrackScore * 0.15
    + turnScore * 0.1
    + sameRoadScore * 0.15);
}

function latestRoundTripEndIndex(track, turnIndex, start, endUpperRawPointId, config) {
  let endIndex = -1;
  for (let index = turnIndex + 1; index < track.length; index++) {
    const point = track[index];
    if (point.sourceRawPointId > endUpperRawPointId) break;
    if (!canBeRoundTripEndpoint(point)) continue;
    const endpointDistance = distanceMeters(start.lat, start.lng, point.lat, point.lng);
    if (endpointDistance <= config.roundTripLineMaxEndpointDistanceMeters) {
      endIndex = index;
    }
  }
  return endIndex;
}

function canBeRoundTripEndpoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && !isTransportTrackReason(point.reason)
    && point.reason !== 'weak_recovery_shape_anchor';
}

function hasValidLngLat(point) {
  return validCoordinate(point?.lat, point?.lng);
}

function roundTripLineMaxCrossTrackMeters(span, start, turn, end) {
  let maxDistance = 0;
  for (const point of span) {
    if (!hasValidLngLat(point)) continue;
    const distance = Math.min(
      distanceToSegmentMeters(point, start, turn),
      distanceToSegmentMeters(point, turn, end)
    );
    maxDistance = Math.max(maxDistance, distance);
  }
  return maxDistance;
}

function distanceToSegmentMeters(point, start, end) {
  const origin = start;
  const projectedPoint = localMeters(point, origin);
  const projectedStart = { x: 0, y: 0 };
  const projectedEnd = localMeters(end, origin);
  const dx = projectedEnd.x - projectedStart.x;
  const dy = projectedEnd.y - projectedStart.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 0
    ? 0
    : Math.max(0, Math.min(1,
      ((projectedPoint.x - projectedStart.x) * dx
        + (projectedPoint.y - projectedStart.y) * dy) / lengthSquared));
  return Math.hypot(projectedPoint.x - (projectedStart.x + t * dx),
    projectedPoint.y - (projectedStart.y + t * dy));
}

function localMeters(point, origin) {
  const originLatRadians = origin.lat * Math.PI / 180;
  return {
    x: (point.lng - origin.lng) * Math.PI / 180
      * Math.cos(originLatRadians) * EARTH_RADIUS_METERS,
    y: (point.lat - origin.lat) * Math.PI / 180 * EARTH_RADIUS_METERS
  };
}

function nonOverlappingRoundTripCandidates(candidates) {
  const accepted = [];
  for (const candidate of [...candidates].sort((a, b) =>
    a.startIndex - b.startIndex
    || b.endIndex - a.endIndex)) {
    if (accepted.some((existing) =>
      rangesOverlap(candidate.startIndex, candidate.endIndex,
        existing.startIndex, existing.endIndex))) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function roundTripLinePoints(candidate, config) {
  if (isRoundTripSameRoadCorridor(candidate, config)) {
    return roundTripSameRoadPoints(candidate, config);
  }
  const keepIndexes = roundTripLineKeepIndexes(candidate, config);
  return keepIndexes.map((spanIndex, keepIndex) =>
    roundTripKeptPoint(candidate, keepIndexes, spanIndex, keepIndex));
}

function isRoundTripSameRoadCorridor(candidate, config) {
  if (!config.roundTripSameRoadCollapseEnabled) return false;
  const turnSpanIndex = candidate.turnIndex - candidate.startIndex;
  if (turnSpanIndex <= 1 || turnSpanIndex >= candidate.span.length - 2) return false;
  const beforeApproach = candidate.span[turnSpanIndex - 1];
  const afterApproach = candidate.span[turnSpanIndex + 1];
  if (!hasValidLngLat(beforeApproach) || !hasValidLngLat(afterApproach)) return false;
  const sameRoadPoints = candidate.span.filter((point, index) =>
    index !== turnSpanIndex && hasValidLngLat(point));
  if (sameRoadPoints.length < 4) return false;
  if (bboxDiagonalMeters(sameRoadPoints) > config.roundTripSameRoadMaxBboxMeters) {
    return false;
  }
  return distanceMeters(beforeApproach.lat, beforeApproach.lng,
    afterApproach.lat, afterApproach.lng)
    <= config.roundTripSameRoadMaxApproachPairDistanceMeters;
}

function roundTripSameRoadPoints(candidate, config) {
  const turnSpanIndex = candidate.turnIndex - candidate.startIndex;
  const stations = roundTripSameRoadCenterlineStations(candidate, config);
  const coordinatesBySpanIndex = new Map();
  for (const station of stations) {
    coordinatesBySpanIndex.set(station.beforeIndex, station);
    coordinatesBySpanIndex.set(station.afterIndex, station);
  }
  const beforeIndexes = uniqueSorted(stations.map((station) => station.beforeIndex));
  const afterIndexes = uniqueSorted(stations.map((station) => station.afterIndex));
  const keepIndexes = [...beforeIndexes, turnSpanIndex, ...afterIndexes];
  return keepIndexes.map((spanIndex, keepIndex) => {
    const point = roundTripKeptPoint(candidate, keepIndexes, spanIndex, keepIndex);
    if (spanIndex === turnSpanIndex) return sameRoadCaveEndpointPoint(point);
    return sameRoadCenterlinePoint(point, coordinatesBySpanIndex.get(spanIndex));
  });
}

function roundTripSameRoadCenterlineStations(candidate, config) {
  const turnSpanIndex = candidate.turnIndex - candidate.startIndex;
  const beforePath = candidate.span
    .slice(0, turnSpanIndex)
    .map((point, index) => ({ point, index }));
  const afterPath = candidate.span
    .slice(turnSpanIndex + 1)
    .map((point, offset) => ({ point, index: turnSpanIndex + 1 + offset }))
    .reverse();
  const samples = sameRoadCenterlineSamples(beforePath, afterPath);
  const keepSampleIndexes = new Set([0, samples.length - 1]);
  simplifySpanByDistance(samples, 0, samples.length - 1,
    config.roundTripLineSimplifyToleranceMeters, keepSampleIndexes);
  return dedupeCenterlineStations([...keepSampleIndexes]
    .sort((a, b) => a - b)
    .map((index) => samples[index]));
}

function sameRoadCenterlineSamples(beforePath, afterPath) {
  const beforeMetrics = pathMetrics(beforePath);
  const afterMetrics = pathMetrics(afterPath);
  const fractions = new Set([0, 1]);
  for (const value of beforeMetrics.cumulativeDistances) {
    fractions.add(pathFraction(value, beforeMetrics.totalDistance));
  }
  for (const value of afterMetrics.cumulativeDistances) {
    fractions.add(pathFraction(value, afterMetrics.totalDistance));
  }
  return [...fractions]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .map((fraction) => {
      const before = samplePathAtFraction(beforeMetrics, fraction);
      const after = samplePathAtFraction(afterMetrics, fraction);
      return {
        lat: (before.lat + after.lat) / 2,
        lng: (before.lng + after.lng) / 2,
        beforeIndex: before.index,
        afterIndex: after.index
      };
    });
}

function pathMetrics(path) {
  const cumulativeDistances = [0];
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1].point;
    const current = path[index].point;
    cumulativeDistances.push(cumulativeDistances[index - 1]
      + distanceMeters(previous.lat, previous.lng, current.lat, current.lng));
  }
  return {
    path,
    cumulativeDistances,
    totalDistance: cumulativeDistances.at(-1) ?? 0
  };
}

function pathFraction(distance, totalDistance) {
  if (totalDistance <= 0) return 0;
  return Math.max(0, Math.min(1, distance / totalDistance));
}

function samplePathAtFraction(metrics, fraction) {
  const { path, cumulativeDistances, totalDistance } = metrics;
  if (path.length === 0) return { lat: 0, lng: 0, index: 0 };
  if (path.length === 1 || totalDistance <= 0 || fraction <= 0) {
    return pathSample(path[0], path[0].index);
  }
  if (fraction >= 1) {
    return pathSample(path.at(-1), path.at(-1).index);
  }
  const targetDistance = fraction * totalDistance;
  for (let index = 1; index < path.length; index++) {
    if (cumulativeDistances[index] < targetDistance) continue;
    const previousDistance = cumulativeDistances[index - 1];
    const nextDistance = cumulativeDistances[index];
    const segmentFraction = nextDistance <= previousDistance
      ? 0
      : (targetDistance - previousDistance) / (nextDistance - previousDistance);
    const previous = path[index - 1].point;
    const next = path[index].point;
    return {
      lat: previous.lat + (next.lat - previous.lat) * segmentFraction,
      lng: previous.lng + (next.lng - previous.lng) * segmentFraction,
      index: path[index].index
    };
  }
  return pathSample(path.at(-1), path.at(-1).index);
}

function pathSample(pathEntry, index) {
  return {
    lat: pathEntry.point.lat,
    lng: pathEntry.point.lng,
    index
  };
}

function dedupeCenterlineStations(stations) {
  const deduped = [];
  for (const station of stations) {
    const previous = deduped.at(-1);
    if (previous
        && previous.beforeIndex === station.beforeIndex
        && previous.afterIndex === station.afterIndex) {
      continue;
    }
    deduped.push(station);
  }
  return deduped;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sameRoadCaveEndpointPoint(point) {
  if (!validCoordinate(point.shapeEndpointLat, point.shapeEndpointLng)) return point;
  return {
    ...point,
    sourceRawPointId: point.shapeEndpointRawPointId ?? point.sourceRawPointId,
    representativeRawPointId: point.shapeEndpointRawPointId ?? point.representativeRawPointId,
    lat: point.shapeEndpointLat,
    lng: point.shapeEndpointLng,
    coordinateSource: 'weak_recovery_endpoint_raw',
    virtualCoordinate: false,
    boundaryState: 'round_trip_cave_endpoint_preserved'
  };
}

function sameRoadCenterlinePoint(point, station) {
  if (!station) return point;
  return {
    ...point,
    lat: station.lat,
    lng: station.lng,
    cloudType: 'ROUND_TRIP_SAME_ROAD_CLOUD',
    coordinateSource: 'same_road_corridor_center',
    virtualCoordinate: true,
    boundaryState: 'round_trip_same_road_collapsed'
  };
}

function roundTripLineKeepIndexes(candidate, config) {
  const keepIndexes = new Set([0, candidate.turnIndex - candidate.startIndex,
    candidate.span.length - 1]);

  const simplifyRange = (startIndex, endIndex) => {
    if (endIndex - startIndex <= 1) return;
    let maxDistance = -1;
    let maxIndex = -1;
    for (let index = startIndex + 1; index < endIndex; index++) {
      const distance = distanceToSegmentMeters(candidate.span[index],
        candidate.span[startIndex], candidate.span[endIndex]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxDistance > config.roundTripLineSimplifyToleranceMeters) {
      keepIndexes.add(maxIndex);
      simplifyRange(startIndex, maxIndex);
      simplifyRange(maxIndex, endIndex);
    }
  };

  simplifyRange(0, candidate.turnIndex - candidate.startIndex);
  simplifyRange(candidate.turnIndex - candidate.startIndex, candidate.span.length - 1);
  return [...keepIndexes].sort((a, b) => a - b);
}

function roundTripKeptPoint(candidate, keepIndexes, spanIndex, keepIndex) {
  const original = candidate.span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keepIndexes[keepIndex - 1];
  const group = candidate.span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const rawPointIds = uniqueRawPointIds(group);
  const aggregateDistance = group.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters || 0 : 0), 0);
  const aggregateMovingTime = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds || 0 : 0), 0);
  const isTurn = original.reason === 'weak_recovery_shape_anchor';
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keepIndexes.length - 1;

  return {
    ...original,
    reason: roundTripKeptReason(original, isStart, isTurn, isEnd),
    distanceDeltaMeters: aggregateDistance,
    movingTimeDeltaSeconds: aggregateMovingTime,
    startsNewSegment: isTurn ? true : original.startsNewSegment === true,
    cloudType: isTurn ? original.cloudType : 'ROUND_TRIP_INTERWOVEN_CLOUD',
    cloudId: candidate.start.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: candidate.crossTrack,
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: isTurn ? original.activityState : 'round_trip_interwoven',
    boundaryState: isTurn ? 'round_trip_turn_preserved' : 'round_trip_interwoven_simplified',
    countsDistance: aggregateDistance > 0,
    countsMovingTime: aggregateMovingTime > 0,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function roundTripKeptReason(original, isStart, isTurn, isEnd) {
  if (isTurn) return original.reason;
  if (isStart) return 'round_trip_interwoven_start';
  if (isEnd) return 'round_trip_interwoven_end';
  return 'round_trip_interwoven_shape';
}

function simplifyInterwovenCorridorSpans(product, config) {
  if (!config.interwovenCorridorSimplifyEnabled) return false;
  const candidates = interwovenCorridorCandidates(product.track, config);
  const accepted = nonOverlappingRoundTripCandidates(candidates);
  if (accepted.length === 0) return false;

  for (const candidate of accepted.sort((a, b) => b.startIndex - a.startIndex)) {
    const simplified = interwovenCorridorPoints(candidate, config);
    product.track.splice(candidate.startIndex,
      candidate.endIndex - candidate.startIndex + 1, ...simplified);
  }

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.interwovenCorridorSimplify = {
    collapsedSpanCount: accepted.length,
    collapsedRawPointRanges: accepted.map((candidate) => ({
      startRawPointId: candidate.start.sourceRawPointId,
      endRawPointId: candidate.end.sourceRawPointId,
      collapsedTrackPointCount: candidate.span.length,
      simplifiedTrackPointCount: interwovenCorridorKeepIndexes(candidate, config).length
    }))
  };
  return true;
}

function interwovenCorridorCandidates(track, config) {
  const candidates = [];
  for (let startIndex = 0; startIndex < track.length; startIndex++) {
    const start = track[startIndex];
    if (!canBeInterwovenCorridorEndpoint(start)) continue;
    let best = null;
    for (let endIndex = startIndex + 1; endIndex < track.length; endIndex++) {
      const end = track[endIndex];
      const rawPointIdSpan = end.sourceRawPointId - start.sourceRawPointId;
      if (rawPointIdSpan > config.interwovenCorridorMaxRawPointIdSpan) break;
      if (rawPointIdSpan < config.interwovenCorridorMinRawPointIdSpan) continue;
      if (!canBeInterwovenCorridorEndpoint(end)) continue;
      if (distanceMeters(start.lat, start.lng, end.lat, end.lng)
          > config.interwovenCorridorMaxEndpointDistanceMeters) {
        continue;
      }

      const span = track.slice(startIndex, endIndex + 1);
      if (span.length < config.interwovenCorridorMinTrackPoints) continue;
      if (!span.some((point) => point.reason === 'gap_recovery')) continue;
      if (span.some((point) => point.reason === 'weak_recovery_shape_anchor')) continue;
      if (bboxDiagonalMeters(span) > config.interwovenCorridorMaxBboxMeters) continue;
      best = {
        startIndex,
        endIndex,
        start,
        end,
        span
      };
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

function canBeInterwovenCorridorEndpoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && !isTransportTrackReason(point.reason)
    && point.reason !== 'gap_recovery'
    && point.reason !== 'weak_recovery_shape_anchor';
}

function interwovenCorridorPoints(candidate, config) {
  const keepIndexes = interwovenCorridorKeepIndexes(candidate, config);
  return keepIndexes.map((spanIndex, keepIndex) =>
    interwovenCorridorKeptPoint(candidate, keepIndexes, spanIndex, keepIndex));
}

function interwovenCorridorKeepIndexes(candidate, config) {
  const keepIndexes = new Set([0, candidate.span.length - 1]);
  simplifySpanByDistance(candidate.span, 0, candidate.span.length - 1,
    config.interwovenCorridorSimplifyToleranceMeters, keepIndexes);
  return [...keepIndexes].sort((a, b) => a - b);
}

function simplifySpanByDistance(points, startIndex, endIndex, toleranceMeters, keepIndexes) {
  if (endIndex - startIndex <= 1) return;
  let maxDistance = -1;
  let maxIndex = -1;
  for (let index = startIndex + 1; index < endIndex; index++) {
    const distance = distanceToSegmentMeters(points[index],
      points[startIndex], points[endIndex]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance > toleranceMeters) {
    keepIndexes.add(maxIndex);
    simplifySpanByDistance(points, startIndex, maxIndex, toleranceMeters, keepIndexes);
    simplifySpanByDistance(points, maxIndex, endIndex, toleranceMeters, keepIndexes);
  }
}

function interwovenCorridorKeptPoint(candidate, keepIndexes, spanIndex, keepIndex) {
  const original = candidate.span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keepIndexes[keepIndex - 1];
  const group = candidate.span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const rawPointIds = uniqueRawPointIds(group);
  const aggregateDistance = group.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters || 0 : 0), 0);
  const aggregateMovingTime = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds || 0 : 0), 0);
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keepIndexes.length - 1;

  return {
    ...original,
    reason: interwovenCorridorReason(isStart, isEnd),
    distanceDeltaMeters: aggregateDistance,
    movingTimeDeltaSeconds: aggregateMovingTime,
    cloudType: 'INTERWOVEN_CORRIDOR_CLOUD',
    cloudId: candidate.start.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: configSafeNumber(candidate.crossTrack, 0),
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: 'interwoven_corridor',
    boundaryState: 'interwoven_corridor_simplified',
    countsDistance: aggregateDistance > 0,
    countsMovingTime: aggregateMovingTime > 0,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function interwovenCorridorReason(isStart, isEnd) {
  if (isStart) return 'interwoven_corridor_start';
  if (isEnd) return 'interwoven_corridor_end';
  return 'interwoven_corridor_shape';
}

function cleanMovingSpikePoints(product, config) {
  if (!config.movingSpikeCleanupEnabled) return false;
  const removeIndexes = [];
  for (let index = 1; index < product.track.length - 1; index++) {
    if (isMovingSpikePoint(product.track[index - 1], product.track[index],
      product.track[index + 1], config)) {
      removeIndexes.push(index);
    }
  }
  if (removeIndexes.length === 0) return false;

  for (const index of removeIndexes.sort((a, b) => b - a)) {
    const spike = product.track[index];
    const next = product.track[index + 1];
    next.contributingRawPointIds = uniqueRawPointIds([spike, next]);
    next.distanceDeltaMeters = distanceMeters(product.track[index - 1].lat,
      product.track[index - 1].lng, next.lat, next.lng);
    next.movingTimeDeltaSeconds = (spike.countsMovingTime ? spike.movingTimeDeltaSeconds || 0 : 0)
      + (next.countsMovingTime ? next.movingTimeDeltaSeconds || 0 : 0);
    next.cloudType = 'MOVING_SPIKE_CLEANUP_CLOUD';
    next.cloudId = spike.sourceRawPointId;
    next.cloudSampleCount = next.contributingRawPointIds.length;
    next.cloudWeightSum = next.contributingRawPointIds.length;
    next.cloudWeightedRadiusMeters = distanceToSegmentMeters(spike,
      product.track[index - 1], next);
    next.boundaryState = 'moving_spike_cleaned';
    next.countsDistance = next.distanceDeltaMeters > 0;
    next.countsMovingTime = next.movingTimeDeltaSeconds > 0;
    product.track.splice(index, 1);
    addScenario(product, movingSpikeScenario(product.track[index - 1], spike, next));
  }

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.movingSpikeCleanup = {
    cleanedPointCount: removeIndexes.length
  };
  return true;
}

function isMovingSpikePoint(previous, point, next, config) {
  if (!hasValidLngLat(previous) || !hasValidLngLat(point) || !hasValidLngLat(next)) return false;
  if (!point.entersTrustedGpx || !next.entersTrustedGpx) return false;
  if (point.reason !== 'motion_supported_low_speed' && point.reason !== 'moving_good_fix') {
    return false;
  }
  if (!Number.isFinite(point.reportedSpeedMetersPerSecond)
      || point.reportedSpeedMetersPerSecond > config.movingSpikeMaxReportedSpeedMetersPerSecond) {
    return false;
  }
  const previousDistance = distanceMeters(previous.lat, previous.lng, point.lat, point.lng);
  const nextDistance = distanceMeters(point.lat, point.lng, next.lat, next.lng);
  const bridgeDistance = distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
  if (previousDistance < config.movingSpikeMinNeighborDistanceMeters
      || nextDistance < config.movingSpikeMinNeighborDistanceMeters
      || bridgeDistance > config.movingSpikeMaxBridgeDistanceMeters) {
    return false;
  }
  const detour = previousDistance + nextDistance - bridgeDistance;
  const lateral = distanceToSegmentMeters(point, previous, next);
  return detour >= config.movingSpikeMinDetourMeters
    && lateral >= config.movingSpikeMinLateralMeters;
}

function movingSpikeScenario(previous, spike, next) {
  return {
    scenario: 'moving_spike_cleanup',
    confidence: 0.82,
    rawRange: {
      startRawPointId: previous.sourceRawPointId,
      endRawPointId: next.sourceRawPointId
    },
    anchorRawPointIds: [next.sourceRawPointId],
    action: 'remove_single_point_spike',
    localRebuild: 'moving_spike_line_bridge',
    evidence: {
      previousRawPointId: previous.sourceRawPointId,
      spikeRawPointId: spike.sourceRawPointId,
      nextRawPointId: next.sourceRawPointId,
      lateralMeters: scenarioNumber(distanceToSegmentMeters(spike, previous, next)),
      bridgeDistanceMeters: scenarioNumber(distanceMeters(previous.lat, previous.lng,
        next.lat, next.lng))
    }
  };
}

function settleEnclosedLoopClusters(product, config, denseAreaIntents = []) {
  if (!config.enclosedLoopSettlementEnabled) return false;
  const loopCandidates = closedLoopRoundTripCandidates(product, config);
  if (loopCandidates.length === 0) return false;
  const clusterCandidates = enclosedGapClusterCandidates(product, config)
    .filter((cluster) => cluster.bboxMeters <= config.enclosedLoopSettlementMaxBboxMeters
      && loopCandidates.some((loop) => rawRangeContains(loop.rawRange, cluster.rawRange)));
  const candidates = nonOverlappingScenarioCandidates(clusterCandidates, []);
  const settledRanges = [];

  for (const candidate of candidates.sort((a, b) => b.startIndex - a.startIndex)) {
    const settlement = enclosedLoopClusterSettledPoints(candidate,
      product.track[candidate.startIndex - 1] ?? null,
      product.track[candidate.endIndex + 1] ?? null,
      config);
    if (!settlement || settlement.removedTrackPointCount
        < config.enclosedLoopSettlementMinRemovedTrackPoints) {
      continue;
    }
    product.track.splice(candidate.startIndex,
      candidate.endIndex - candidate.startIndex + 1, ...settlement.points);
    addScenario(product, enclosedLoopClusterSettlementScenario(candidate, settlement,
      denseAreaIntents));
    settledRanges.push({
      startRawPointId: candidate.rawRange.startRawPointId,
      endRawPointId: candidate.rawRange.endRawPointId,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: settlement.points.length
    });
  }
  if (settledRanges.length === 0) return false;

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.enclosedLoopSettlement = {
    settledSpanCount: settledRanges.length,
    settledRawPointRanges: settledRanges.reverse()
  };
  return true;
}

function enclosedLoopClusterSettledPoints(candidate, previousOutside, nextOutside, config) {
  const keepIndexes = enclosedLoopClusterKeepIndexes(candidate.span, previousOutside,
    nextOutside, config);
  if (keepIndexes.size >= candidate.span.length) return null;
  const sortedKeepIndexes = [...keepIndexes].sort((a, b) => a - b);
  const points = [];
  let pending = [];
  for (let index = 0; index < candidate.span.length; index++) {
    const point = candidate.span[index];
    if (!keepIndexes.has(index)) {
      pending.push(point);
      continue;
    }
    const group = [...pending, point];
    pending = [];
    const settled = enclosedLoopClusterKeptPoint(group, point,
      points.at(-1) ?? null, index === sortedKeepIndexes[0],
      index === sortedKeepIndexes.at(-1));
    points.push(settled);
  }
  if (pending.length > 0 && points.length > 0) {
    const last = points.at(-1);
    last.contributingRawPointIds = uniqueRawPointIds([...pending, last]);
    last.cloudSampleCount = last.contributingRawPointIds.length;
    last.cloudWeightSum = last.contributingRawPointIds.length;
  }
  return {
    points,
    keepRawPointIds: uniqueNumbers(points.map((point) => point.sourceRawPointId)),
    removedTrackPointCount: candidate.span.length - points.length,
    settledDistanceMeters: points.reduce((sum, point) =>
      sum + (point.countsDistance ? point.distanceDeltaMeters || 0 : 0), 0),
    originalDistanceMeters: candidate.span.reduce((sum, point) =>
      sum + (point.countsDistance ? point.distanceDeltaMeters || 0 : 0), 0)
  };
}

function enclosedLoopClusterKeepIndexes(span, previousOutside, nextOutside, config) {
  const keep = new Set();
  const corridorStart = previousOutside ?? span[0];
  const corridorEnd = nextOutside ?? span.at(-1);
  span.forEach((point, index) => {
    if (point.reason === 'gap_recovery'
        || point.reason === 'stationary_anchor'
        || point.reason === 'stationary_drift_anchor'
        || point.reason === 'rest_photo_micro_move_anchor') {
      const corridorDistance = hasValidLngLat(corridorStart)
        && hasValidLngLat(corridorEnd)
        && hasValidLngLat(point)
        ? distanceToSegmentMeters(point, corridorStart, corridorEnd)
        : 0;
      if (corridorDistance <= config.enclosedLoopSettlementMaxCorridorDistanceMeters) {
        keep.add(index);
      }
    }
  });
  if (keep.size === 0) {
    keep.add(enclosedLoopClusterRepresentativeIndex(span, corridorStart, corridorEnd));
  }
  const lastKeptIndex = Math.max(...keep);
  if (lastKeptIndex < span.length - 1) {
    keep.add(span.length - 1);
  }
  return keep;
}

function enclosedLoopClusterRepresentativeIndex(span, corridorStart, corridorEnd) {
  return span
    .map((point, index) => ({
      index,
      score: hasValidLngLat(corridorStart) && hasValidLngLat(corridorEnd) && hasValidLngLat(point)
        ? distanceToSegmentMeters(point, corridorStart, corridorEnd)
        : 0
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)[0]?.index ?? 0;
}

function enclosedLoopClusterKeptPoint(group, fallback, previousSettledPoint, isStart, isEnd) {
  const rawPointIds = uniqueRawPointIds(group);
  return {
    ...fallback,
    reason: fallback.reason === 'gap_recovery'
      ? fallback.reason
      : enclosedLoopClusterReason(fallback, isStart, isEnd),
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'ENCLOSED_LOOP_SETTLEMENT_CLOUD',
    cloudId: rawPointIds[0] ?? fallback.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    representativeRawPointId: fallback.representativeRawPointId ?? fallback.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: fallback.coordinateSource || 'raw_representative',
    virtualCoordinate: fallback.virtualCoordinate === true,
    activityState: 'enclosed_loop_settlement',
    boundaryState: isStart || isEnd ? 'enclosed_loop_boundary' : 'enclosed_loop_anchor',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function enclosedLoopClusterReason(point, isStart, isEnd) {
  if (isStart) return 'enclosed_loop_cluster_start';
  if (isEnd) return 'enclosed_loop_cluster_end';
  if (point.reason === 'rest_photo_micro_move_anchor') return point.reason;
  return 'enclosed_loop_cluster_anchor';
}

function enclosedLoopClusterSettlementScenario(candidate, settlement, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  return {
    scenario: 'enclosed_loop_cluster_settlement',
    confidence: 0.84,
    rawRange: candidate.rawRange,
    anchorRawPointIds: settlement.keepRawPointIds,
    action: 'compress_enclosed_loop_low_speed_drift',
    localRebuild: 'enclosed_loop_anchor_settlement',
    evidence: {
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: settlement.points.length,
      removedTrackPointCount: settlement.removedTrackPointCount,
      originalDistanceMeters: scenarioNumber(settlement.originalDistanceMeters),
      settledDistanceMeters: scenarioNumber(settlement.settledDistanceMeters),
      gapRecoveryCount: candidate.gapRecoveryCount,
      stationaryAnchorCount: candidate.stationaryAnchorCount,
      bboxDiagonalMeters: scenarioNumber(candidate.bboxMeters),
      durationSeconds: scenarioNumber(candidate.durationSeconds),
      denseAreaIntents: overlappingIntents.map((intent) => intent.intent),
      gapClusterIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'gap_cluster'),
      mixedIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'mixed')
    }
  };
}

function settlePositionSnapRecoveries(product, config) {
  if (!config.positionSnapRecoveryEnabled) return false;
  const weakByRawPointId = new Map(product.excluded.weak.map((point) => [
    point.rawPointId ?? point.sourceRawPointId,
    point
  ]));
  const settled = [];
  for (let index = 1; index < product.track.length; index++) {
    const previous = product.track[index - 1];
    const point = product.track[index];
    const candidate = positionSnapRecoveryCandidate(previous, point, weakByRawPointId, config);
    if (!candidate) continue;
    point.reason = 'position_snap_recovery_anchor';
    point.distanceDeltaMeters = 0;
    point.movingTimeDeltaSeconds = 0;
    point.cloudType = 'POSITION_SNAP_RECOVERY_CLOUD';
    point.cloudId = candidate.rawRange.startRawPointId;
    point.cloudSampleCount = candidate.rawPointIds.length;
    point.cloudWeightSum = candidate.rawPointIds.length;
    point.cloudWeightedRadiusMeters = candidate.bridgeDistanceMeters;
    point.representativeRawPointId = point.representativeRawPointId ?? point.sourceRawPointId;
    point.contributingRawPointIds = candidate.rawPointIds;
    point.activityState = 'position_snap_recovery';
    point.boundaryState = 'position_snap_recovered';
    point.countsDistance = false;
    point.countsMovingTime = false;
    point.countsAscentWindow = false;
    point.entersTrustedGpx = true;
    addScenario(product, positionSnapRecoveryScenario(candidate));
    removeExcludedRawPoints(product, new Set(candidate.weakRawPointIds));
    settled.push(candidate);
  }
  if (settled.length === 0) return false;

  rebuildRawPointDecisions(product);
  product.positionSnapRecovery = {
    settledCount: settled.length,
    settledRawPointRanges: settled.map((candidate) => candidate.rawRange)
  };
  return true;
}

function positionSnapRecoveryCandidate(previous, point, weakByRawPointId, config) {
  if (!hasValidLngLat(previous) || !hasValidLngLat(point)) return null;
  if (!point.entersTrustedGpx || point.reason === 'gap_recovery') return null;
  if (point.reason !== 'moving_good_fix' && point.reason !== 'motion_supported_low_speed'
      && point.reason !== 'continuity_rescue_low_accuracy') {
    return null;
  }
  const reportedSpeed = Number.isFinite(point.reportedSpeedMetersPerSecond)
    ? point.reportedSpeedMetersPerSecond
    : null;
  if (reportedSpeed !== null
      && reportedSpeed > config.positionSnapRecoveryMaxReportedSpeedMetersPerSecond) {
    return null;
  }
  const bridgeDistanceMeters = distanceMeters(previous.lat, previous.lng, point.lat, point.lng);
  if (bridgeDistanceMeters < config.positionSnapRecoveryMinBridgeDistanceMeters) return null;
  const weakPoints = [];
  for (let rawPointId = previous.sourceRawPointId + 1;
    rawPointId < point.sourceRawPointId; rawPointId++) {
    const weak = weakByRawPointId.get(rawPointId);
    if (!weak) continue;
    if (weak.reason !== 'implied_speed_unconfirmed_by_reported_speed') continue;
    weakPoints.push(weak);
  }
  if (weakPoints.length < config.positionSnapRecoveryMinWeakPoints) return null;
  const weakRawPointIds = uniqueNumbers(weakPoints.map((weak) =>
    weak.rawPointId ?? weak.sourceRawPointId));
  return {
    previousRawPointId: previous.sourceRawPointId,
    recoveryRawPointId: point.sourceRawPointId,
    weakRawPointIds,
    rawPointIds: uniqueNumbers([...weakRawPointIds, point.sourceRawPointId]),
    rawRange: rawPointRange([...weakRawPointIds, point.sourceRawPointId]),
    bridgeDistanceMeters,
    reportedSpeedMetersPerSecond: reportedSpeed
  };
}

function positionSnapRecoveryScenario(candidate) {
  return {
    scenario: 'position_snap_recovery',
    confidence: 0.82,
    rawRange: candidate.rawRange,
    anchorRawPointIds: [candidate.recoveryRawPointId],
    action: 'reset_position_snap_recovery_delta',
    localRebuild: 'position_snap_recovery_anchor',
    evidence: {
      previousRawPointId: candidate.previousRawPointId,
      recoveryRawPointId: candidate.recoveryRawPointId,
      weakRawPointIds: candidate.weakRawPointIds,
      bridgeDistanceMeters: scenarioNumber(candidate.bridgeDistanceMeters),
      reportedSpeedMetersPerSecond: scenarioNumber(candidate.reportedSpeedMetersPerSecond),
      countsDistance: false,
      countsMovingTime: false
    }
  };
}

function simplifyRestPhotoMicroMoveSpans(product, config, denseAreaIntents = []) {
  if (!config.restPhotoMicroMoveEnabled || !config.restPhotoMicroMoveSimplifyEnabled) {
    return false;
  }
  const candidates = nonOverlappingScenarioCandidates(
    restPhotoMicroMoveCandidates(product, config),
    []
  ).filter((candidate) =>
    restPhotoMicroMoveShouldCollapse(candidate, config)
      || restPhotoMicroMoveNeedsSimplify(candidate, config));
  if (candidates.length === 0) return false;

  const simplifiedRanges = [];
  for (const candidate of candidates.sort((a, b) => b.startIndex - a.startIndex)) {
    const simplified = restPhotoMicroMoveShouldCollapse(candidate, config)
      ? [restPhotoMicroMoveCollapsedPoint(candidate)]
      : restPhotoMicroMoveSimplifiedPoints(candidate, config);
    if (simplified.length >= candidate.span.length) continue;
    product.track.splice(candidate.startIndex,
      candidate.endIndex - candidate.startIndex + 1, ...simplified);
    addScenario(product, restPhotoMicroMoveShouldCollapse(candidate, config)
      ? restPhotoMicroMoveCollapsedScenario(candidate, simplified[0], config, denseAreaIntents)
      : restPhotoMicroMoveSimplifiedScenario(candidate, simplified, config, denseAreaIntents));
    simplifiedRanges.push({
      startRawPointId: candidate.rawRange.startRawPointId,
      endRawPointId: candidate.rawRange.endRawPointId,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: simplified.length
    });
  }
  if (simplifiedRanges.length === 0) return false;

  renumberTrackPoints(product);
  rebuildRawPointDecisions(product);
  product.restPhotoMicroMoveSimplify = {
    simplifiedSpanCount: simplifiedRanges.length,
    simplifiedRawPointRanges: simplifiedRanges.reverse()
  };
  return true;
}

function restPhotoMicroMoveShouldCollapse(candidate, config) {
  const shortFoldback = candidate.bboxMeters <= config.restPhotoMicroMoveCollapseMaxBboxMeters
    && candidate.netDistanceMeters <= config.restPhotoMicroMoveCollapseMaxNetDistanceMeters
    && candidate.pathMeters <= config.restPhotoMicroMoveCollapseMaxPathMeters;
  const longRestDrift = candidate.durationSeconds
      >= config.restPhotoMicroMoveLongCollapseMinDurationSeconds
    && candidate.bboxMeters <= config.restPhotoMicroMoveLongCollapseMaxBboxMeters
    && candidate.netDistanceMeters <= config.restPhotoMicroMoveLongCollapseMaxNetDistanceMeters
    && candidate.pathMeters <= config.restPhotoMicroMoveLongCollapseMaxPathMeters;
  return shortFoldback || longRestDrift;
}

function restPhotoMicroMoveNeedsSimplify(candidate, config) {
  if (candidate.span.length <= 2) return false;
  if (candidate.durationSeconds < config.restPhotoMicroMoveSimplifyMinDurationSeconds) {
    return false;
  }
  if (candidate.pathMeters <= candidate.bboxMeters) return false;
  const reducedPath = restPhotoMicroMoveSimplifiedPath(candidate, config);
  if (!Number.isFinite(reducedPath) || reducedPath <= 0) return false;
  return reducedPath / Math.max(candidate.pathMeters, 1)
    <= 1 - config.restPhotoMicroMoveSimplifyMinPathReductionRatio;
}

function restPhotoMicroMoveCollapsedPoint(candidate) {
  const representative = restPhotoMicroMoveCollapseRepresentative(candidate.span);
  const rawPointIds = uniqueRawPointIds(candidate.span);
  return {
    ...representative,
    reason: 'rest_photo_micro_move_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'REST_PHOTO_MICRO_MOVE_CLOUD',
    cloudId: candidate.rawRange.startRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: candidate.bboxMeters / 2,
    representativeRawPointId: representative.representativeRawPointId
      ?? representative.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: representative.coordinateSource || 'raw_representative',
    virtualCoordinate: representative.virtualCoordinate === true,
    activityState: 'rest_photo_micro_move',
    boundaryState: 'rest_photo_micro_move_collapsed',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function restPhotoMicroMoveCollapseRepresentative(span) {
  const stationary = span.find((point) => point.reason === 'stationary_anchor');
  if (stationary) return stationary;
  return [...span].sort((a, b) =>
    (Number.isFinite(a.reportedSpeedMetersPerSecond) ? a.reportedSpeedMetersPerSecond : 0)
      - (Number.isFinite(b.reportedSpeedMetersPerSecond) ? b.reportedSpeedMetersPerSecond : 0)
    || a.sourceRawPointId - b.sourceRawPointId)[0] ?? span[0];
}

function restPhotoMicroMoveSimplifiedPath(candidate, config) {
  const keepIndexes = restPhotoMicroMoveKeepIndexes(candidate, config);
  const kept = keepIndexes.map((index) => candidate.span[index]);
  return trackPathMeters(kept);
}

function restPhotoMicroMoveSimplifiedPoints(candidate, config) {
  const keepIndexes = restPhotoMicroMoveKeepIndexes(candidate, config);
  const simplified = [];
  keepIndexes.forEach((spanIndex, keepIndex) => {
    simplified.push(restPhotoMicroMoveKeptPoint(candidate, keepIndexes,
      spanIndex, keepIndex, simplified.at(-1) ?? null, config));
  });
  return simplified;
}

function restPhotoMicroMoveKeepIndexes(candidate, config) {
  const keepIndexes = new Set([0, candidate.span.length - 1]);
  simplifySpanByDistance(candidate.span, 0, candidate.span.length - 1,
    config.restPhotoMicroMoveSimplifyToleranceMeters, keepIndexes);
  let sorted = [...keepIndexes].sort((a, b) => a - b);
  const maxOutput = Math.max(2, Math.floor(config.restPhotoMicroMoveSimplifyMaxOutputTrackPoints));
  while (sorted.length > maxOutput) {
    const removable = sorted
      .slice(1, -1)
      .map((spanIndex) => ({
        spanIndex,
        score: restPhotoMicroMoveKeepPriority(candidate.span, sorted, spanIndex)
      }))
      .sort((a, b) => a.score - b.score || a.spanIndex - b.spanIndex)[0];
    if (!removable) break;
    keepIndexes.delete(removable.spanIndex);
    sorted = [...keepIndexes].sort((a, b) => a - b);
  }
  return [...keepIndexes].sort((a, b) => a - b);
}

function restPhotoMicroMoveKeepPriority(span, keepIndexes, spanIndex) {
  const sorted = [...keepIndexes].sort((a, b) => a - b);
  const position = sorted.indexOf(spanIndex);
  if (position <= 0 || position >= sorted.length - 1) return Infinity;
  const previous = span[sorted[position - 1]];
  const current = span[spanIndex];
  const next = span[sorted[position + 1]];
  const detour = distanceMeters(previous.lat, previous.lng, current.lat, current.lng)
    + distanceMeters(current.lat, current.lng, next.lat, next.lng)
    - distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
  return detour;
}

function restPhotoMicroMoveKeptPoint(candidate, keepIndexes, spanIndex, keepIndex,
  previousSimplifiedPoint, config) {
  const fallback = candidate.span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keepIndexes[keepIndex - 1];
  const group = candidate.span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const original = restPhotoMicroMoveRepresentativePoint(group, fallback, config);
  const rawPointIds = uniqueRawPointIds(group);
  const simplifiedDistance = previousSimplifiedPoint
    ? distanceMeters(previousSimplifiedPoint.lat, previousSimplifiedPoint.lng,
      original.lat, original.lng)
    : original.distanceDeltaMeters || 0;
  const aggregateMovingTime = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds || 0 : 0), 0);
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keepIndexes.length - 1;

  return {
    ...original,
    reason: restPhotoMicroMoveReason(isStart, isEnd),
    distanceDeltaMeters: simplifiedDistance,
    movingTimeDeltaSeconds: aggregateMovingTime,
    cloudType: 'REST_PHOTO_MICRO_MOVE_CLOUD',
    cloudId: candidate.rawRange.startRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: candidate.bboxMeters / 2,
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: 'rest_photo_micro_move',
    boundaryState: 'rest_photo_micro_move_simplified',
    countsDistance: simplifiedDistance > 0 && original.countsDistance === true,
    countsMovingTime: aggregateMovingTime > 0 && original.countsMovingTime === true,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function restPhotoMicroMoveRepresentativePoint(group, fallback, config) {
  if (!Number.isFinite(fallback.reportedSpeedMetersPerSecond)
      || fallback.reportedSpeedMetersPerSecond < config.transportSpeedMetersPerSecond) {
    return fallback;
  }
  return [...group]
    .filter((point) => hasValidLngLat(point)
      && (!Number.isFinite(point.reportedSpeedMetersPerSecond)
        || point.reportedSpeedMetersPerSecond < config.transportSpeedMetersPerSecond))
    .sort((a, b) =>
      restPhotoMicroMoveRepresentativeScore(b, fallback)
        - restPhotoMicroMoveRepresentativeScore(a, fallback)
      || a.sourceRawPointId - b.sourceRawPointId)[0] ?? fallback;
}

function restPhotoMicroMoveRepresentativeScore(point, fallback) {
  const speed = Number.isFinite(point.reportedSpeedMetersPerSecond)
    ? point.reportedSpeedMetersPerSecond
    : 0;
  const shapeDistance = hasValidLngLat(point) && hasValidLngLat(fallback)
    ? distanceMeters(point.lat, point.lng, fallback.lat, fallback.lng)
    : 0;
  return shapeDistance - speed * 2;
}

function restPhotoMicroMoveReason(isStart, isEnd) {
  if (isStart) return 'rest_photo_micro_move_start';
  if (isEnd) return 'rest_photo_micro_move_end';
  return 'rest_photo_micro_move_shape';
}

function restPhotoMicroMoveSimplifiedScenario(candidate, simplified, config,
  denseAreaIntents = []) {
  const base = restPhotoMicroMoveScenario(candidate, config, denseAreaIntents);
  return {
    ...base,
    action: 'simplify_micro_move_shape',
    localRebuild: 'rest_photo_micro_move_simplifier',
    anchorRawPointIds: uniqueNumbers(simplified.map((point) => point.sourceRawPointId)),
    evidence: {
      ...base.evidence,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: simplified.length,
      simplifiedPathMeters: scenarioNumber(trackPathMeters(simplified)),
      simplifyToleranceMeters: scenarioNumber(config.restPhotoMicroMoveSimplifyToleranceMeters)
    }
  };
}

function restPhotoMicroMoveCollapsedScenario(candidate, collapsed, config,
  denseAreaIntents = []) {
  const base = restPhotoMicroMoveScenario(candidate, config, denseAreaIntents);
  return {
    ...base,
    action: 'collapse_micro_move_to_rest_anchor',
    localRebuild: 'rest_photo_micro_move_anchor',
    anchorRawPointIds: [collapsed.sourceRawPointId],
    evidence: {
      ...base.evidence,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: 1,
      representativeRawPointId: collapsed.sourceRawPointId,
      collapsedDistanceMeters: 0,
      collapsedMovingTimeSeconds: 0
    }
  };
}

function configSafeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function scenarioNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))];
}

function uniqueRawPointIds(points) {
  const rawPointIds = [];
  const seen = new Set();
  for (const point of points) {
    const pointRawPointIds = point.contributingRawPointIds?.length
      ? point.contributingRawPointIds
      : [point.sourceRawPointId];
    for (const rawPointId of pointRawPointIds) {
      if (seen.has(rawPointId)) continue;
      seen.add(rawPointId);
      rawPointIds.push(rawPointId);
    }
  }
  return rawPointIds;
}

function findDwellDriftIntervals(rawPoints, config) {
  const intervals = [];
  let index = 0;
  while (index < rawPoints.length) {
    if (!isDwellDriftCorePoint(rawPoints[index], config)) {
      index++;
      continue;
    }
    const coreStartIndex = index;
    let coreEndIndex = index;
    while (coreEndIndex + 1 < rawPoints.length
        && isDwellDriftCorePoint(rawPoints[coreEndIndex + 1], config)
        && elapsedSeconds(rawPoints[coreEndIndex].elapsedRealtimeNanos,
          rawPoints[coreEndIndex + 1].elapsedRealtimeNanos)
          <= config.dwellDriftMaxCoreGapSeconds) {
      coreEndIndex++;
    }

    const coreRawPoints = rawPoints.slice(coreStartIndex, coreEndIndex + 1);
    if (coreRawPoints.length >= config.dwellDriftMinCoreSamples) {
      const startIndex = extendDwellDriftBackward(rawPoints, coreStartIndex, config);
      const endIndex = extendDwellDriftForward(rawPoints, coreEndIndex, config);
      const intervalRawPoints = rawPoints.slice(startIndex, endIndex + 1);
      if (isDwellDriftInterval(intervalRawPoints, coreRawPoints, config)) {
        intervals.push({
          startIndex,
          endIndex,
          coreStartIndex,
          coreEndIndex,
          rawPoints: intervalRawPoints,
          coreRawPoints
        });
        index = endIndex + 1;
        continue;
      }
    }
    index = coreEndIndex + 1;
  }
  return intervals;
}

function isDwellDriftCorePoint(rawPoint, config) {
  return Number.isFinite(rawPoint.accuracy)
    && rawPoint.accuracy >= config.dwellDriftCoreAccuracyMeters;
}

function extendDwellDriftBackward(rawPoints, coreStartIndex, config) {
  let startIndex = coreStartIndex;
  let extensionPathMeters = 0;
  while (startIndex > 0) {
    const candidate = rawPoints[startIndex - 1];
    const current = rawPoints[startIndex];
    if (!canExtendDwellDrift(candidate, current, config)) break;
    const stepDistance = distanceMeters(candidate.lat, candidate.lng, current.lat, current.lng);
    if (extensionPathMeters + stepDistance > config.dwellDriftMaxExtensionPathMeters) break;
    extensionPathMeters += stepDistance;
    startIndex--;
  }
  return startIndex;
}

function extendDwellDriftForward(rawPoints, coreEndIndex, config) {
  let endIndex = coreEndIndex;
  let extensionPathMeters = 0;
  while (endIndex + 1 < rawPoints.length) {
    const current = rawPoints[endIndex];
    const candidate = rawPoints[endIndex + 1];
    if (!canExtendDwellDrift(candidate, current, config)) break;
    const stepDistance = distanceMeters(current.lat, current.lng, candidate.lat, candidate.lng);
    if (extensionPathMeters + stepDistance > config.dwellDriftMaxExtensionPathMeters) break;
    extensionPathMeters += stepDistance;
    endIndex++;
  }
  return endIndex;
}

function canExtendDwellDrift(candidate, adjacentPoint, config) {
  if (!candidate || !adjacentPoint) return false;
  if (!Number.isFinite(candidate.elapsedRealtimeNanos)
      || !Number.isFinite(adjacentPoint.elapsedRealtimeNanos)) {
    return false;
  }
  const gapSeconds = Math.abs(candidate.elapsedRealtimeNanos
    - adjacentPoint.elapsedRealtimeNanos) / NANOS_PER_SECOND;
  if (gapSeconds > config.dwellDriftMaxExtensionGapSeconds) return false;
  if (Number.isFinite(candidate.speed)
      && candidate.speed > config.dwellDriftMaxReportedSpeedMetersPerSecond) {
    return false;
  }
  return Number.isFinite(candidate.accuracy)
    && candidate.accuracy <= config.maxIntakeAccuracyMeters;
}

function isDwellDriftInterval(rawPoints, coreRawPoints, config) {
  if (rawPoints.length < config.dwellDriftMinRawPoints) return false;
  const durationSeconds = elapsedSeconds(rawPoints[0].elapsedRealtimeNanos,
    rawPoints.at(-1).elapsedRealtimeNanos);
  if (durationSeconds < config.dwellDriftMinDurationSeconds) return false;
  const finiteSpeeds = rawPoints
    .map((point) => point.speed)
    .filter(Number.isFinite);
  const averageSpeed = finiteSpeeds.length === 0
    ? 0
    : finiteSpeeds.reduce((sum, speed) => sum + speed, 0) / finiteSpeeds.length;
  if (averageSpeed > config.dwellDriftMaxAverageSpeedMetersPerSecond) return false;
  const zeroSpeedRatio = finiteSpeeds.length === 0
    ? 0
    : finiteSpeeds.filter((speed) => speed <= 0.1).length / finiteSpeeds.length;
  if (zeroSpeedRatio < config.dwellDriftMinZeroSpeedRatio) return false;
  if (bboxDiagonalMeters(rawPoints) > config.dwellDriftMaxBboxMeters) return false;
  const netDistance = distanceMeters(rawPoints[0].lat, rawPoints[0].lng,
    rawPoints.at(-1).lat, rawPoints.at(-1).lng);
  if (netDistance > config.dwellDriftMaxNetDistanceMeters) return false;
  return coreRawPoints.length / rawPoints.length >= 0.25;
}

function dwellDriftAnchor(interval, template) {
  const center = weightedRawCenter(interval.rawPoints);
  const first = interval.rawPoints[0];
  const representative = nearestRawPoint(center, interval.rawPoints);
  return {
    trackPointId: 0,
    sourceRawPointId: representative.rawPointId,
    recomputedDecisionId: template.recomputedDecisionId,
    segmentId: template.segmentId,
    lat: center.lat,
    lng: center.lng,
    elapsedRealtimeNanos: representative.elapsedRealtimeNanos,
    timeMillis: representative.timeMillis,
    result: 'anchor',
    reason: 'stationary_drift_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: false,
    cloudType: 'STATIONARY_DRIFT_CLOUD',
    cloudId: first.rawPointId,
    cloudSampleCount: interval.rawPoints.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId: representative.rawPointId,
    contributingRawPointIds: interval.rawPoints.map((point) => point.rawPointId),
    coordinateSource: 'cloud_center',
    virtualCoordinate: true,
    activityState: 'stationary_drift',
    boundaryState: 'dwell_collapsed',
    gnssAltitudeResult: 'reset',
    gnssAltitudeReason: 'stationary_suspended',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true
  };
}

function weightedRawCenter(rawPoints) {
  let weight = 0;
  let lat = 0;
  let lng = 0;
  for (const rawPoint of rawPoints) {
    const pointWeight = 1 / Math.max(rawPoint.accuracy, 5);
    weight += pointWeight;
    lat += rawPoint.lat * pointWeight;
    lng += rawPoint.lng * pointWeight;
  }
  lat /= Math.max(weight, 1e-9);
  lng /= Math.max(weight, 1e-9);
  let radiusTotal = 0;
  for (const rawPoint of rawPoints) {
    const pointWeight = 1 / Math.max(rawPoint.accuracy, 5);
    const distance = distanceMeters(lat, lng, rawPoint.lat, rawPoint.lng);
    radiusTotal += pointWeight * distance * distance;
  }
  return {
    lat,
    lng,
    weight,
    radiusMeters: Math.sqrt(radiusTotal / Math.max(weight, 1e-9))
  };
}

function rawPointCloudCenter(rawPoints) {
  let lat = 0;
  let lng = 0;
  for (const rawPoint of rawPoints) {
    lat += rawPoint.lat;
    lng += rawPoint.lng;
  }
  lat /= Math.max(rawPoints.length, 1);
  lng /= Math.max(rawPoints.length, 1);
  let radiusTotal = 0;
  for (const rawPoint of rawPoints) {
    const distance = distanceMeters(lat, lng, rawPoint.lat, rawPoint.lng);
    radiusTotal += distance * distance;
  }
  return {
    lat,
    lng,
    weight: rawPoints.length,
    radiusMeters: Math.sqrt(radiusTotal / Math.max(rawPoints.length, 1))
  };
}

function nearestRawPoint(center, rawPoints) {
  let best = rawPoints[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rawPoint of rawPoints) {
    const distance = distanceMeters(center.lat, center.lng, rawPoint.lat, rawPoint.lng);
    if (distance < bestDistance) {
      best = rawPoint;
      bestDistance = distance;
    }
  }
  return best;
}

function trackPointOverlapsRawIds(trackPoint, rawPointIds) {
  if (rawPointIds.has(trackPoint.sourceRawPointId)) return true;
  return (trackPoint.contributingRawPointIds || []).some((rawPointId) =>
    rawPointIds.has(rawPointId));
}

function removeExcludedRawPoints(product, rawPointIds) {
  product.excluded.weak = product.excluded.weak
    .filter((point) => !rawPointIds.has(point.rawPointId));
  product.excluded.rejected = product.excluded.rejected
    .filter((point) => !rawPointIds.has(point.rawPointId));
  product.excluded.intakeRejected = product.excluded.intakeRejected
    .filter((point) => !rawPointIds.has(point.rawPointId));
}

function renumberTrackPoints(product) {
  product.track.forEach((point, index) => {
    point.trackPointId = index + 1;
  });
}

function rebuildRawPointDecisions(product) {
  const decisions = [];
  for (const point of product.track) {
    const rawPointIds = point.contributingRawPointIds?.length
      ? point.contributingRawPointIds
      : [point.sourceRawPointId];
    for (const rawPointId of rawPointIds) {
      decisions.push(rawPointDecision({
        ...point,
        sourceRawPointId: rawPointId,
        distanceDeltaMeters: rawPointId === point.sourceRawPointId
          ? point.distanceDeltaMeters
          : 0,
        movingTimeDeltaSeconds: rawPointId === point.sourceRawPointId
          ? point.movingTimeDeltaSeconds
          : 0
      }, point.countsDistance && rawPointId === point.sourceRawPointId,
      point.countsMovingTime && rawPointId === point.sourceRawPointId,
      point.entersTrustedGpx && rawPointId === point.sourceRawPointId));
    }
  }
  for (const point of product.excluded.weak) {
    decisions.push(rawPointDecision(point, false, false, false));
  }
  for (const point of product.excluded.rejected) {
    decisions.push(rawPointDecision(point, false, false, false));
  }
  for (const point of product.excluded.intakeRejected) {
    decisions.push(rawPointDecision(point, false, false, false));
  }
  product.rawPointDecisions = decisions.sort((a, b) => a.rawPointId - b.rawPointId);
}

function recomputeLocationAltitudeAscent(product, evidence, config) {
  product.stats.locationAltitudeTotalAscentMeters = -1;
  product.stats.locationAltitudeAscentSampleCount = 0;
  product.stats.locationAltitudeAscentRejectedSampleCount = 0;
  const rawPointById = new Map(evidence.rawPoints.map((point) => [point.rawPointId, point]));
  const altitudeState = { gnssAltitudeAnchorMeters: null };
  for (const trackPoint of product.track) {
    const rawPoint = rawPointById.get(trackPoint.representativeRawPointId)
      || rawPointById.get(trackPoint.sourceRawPointId);
    if (!rawPoint) continue;
    const gnssAltitude = applyGnssAltitude(rawPoint, trackPoint, altitudeState, product, config);
    trackPoint.gnssAltitudeResult = gnssAltitude.result;
    trackPoint.gnssAltitudeReason = gnssAltitude.reason;
  }
}

function recordBoundaryCloudSample(state, stateKey, cloudType, rawPoint, previous, config) {
  const referenceKey = `${cloudType}|${previous?.trackPointId ?? 0}|${previous?.sourceRawPointId ?? ''}`;
  const previousCloud = state[stateKey];
  const reset = !previousCloud
    || previousCloud.referenceKey !== referenceKey
    || rawPoint.elapsedRealtimeNanos - previousCloud.lastElapsedRealtimeNanos
      > config.gapSeconds * NANOS_PER_SECOND;
  const cloud = reset
    ? {
        referenceKey,
        cloudId: rawPoint.rawPointId,
        cloudType,
        samples: []
      }
    : previousCloud;
  cloud.samples.push(rawPoint);
  cloud.lastElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
  cloud.previousSample = previousCloud?.referenceKey === referenceKey
    ? previousCloud.samples.at(-2) ?? null
    : null;
  state[stateKey] = cloud;
  return cloud;
}

function isTransportTrackReason(reason) {
  return reason === 'recovery_transport_suspected_kept'
    || reason === 'transport_suspected_kept';
}

function boundaryCloudDecisionFields(cloud) {
  return {
    cloudId: cloud.cloudId,
    cloudSampleCount: cloud.samples.length,
    cloudWeightSum: cloud.samples.length,
    cloudWeightedRadiusMeters: cloudRadiusMeters(cloud.samples),
    representativeRawPointId: cloud.samples.at(-1)?.rawPointId ?? null,
    contributingRawPointIds: cloud.samples.map((point) => point.rawPointId)
  };
}

function isBoundaryCloudStable(cloud, thresholdMeters, minSamples) {
  return cloud.samples.length >= minSamples
    && cloudRadiusMeters(cloud.samples) <= thresholdMeters;
}

function isRecoveryFastPath(rawPoint, distance, thresholdMeters, config) {
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  return distance >= thresholdMeters
    && rawPoint.accuracy <= config.recoveryFastPathAccuracyMeters
    && (reportedSpeed === null || reportedSpeed <= config.recoveryFastPathMaxSpeedMetersPerSecond);
}

function isLowAccuracyRescuePoint(rawPoint, previous, distance, impliedSpeed, config) {
  return previous
    && rawPoint.accuracy <= config.lowAccuracyRescueMaxAccuracyMeters
    && distance >= config.lowAccuracyRescueMinDistanceMeters
    && impliedSpeed <= config.continuityRescueMaxSpeedMetersPerSecond;
}

function trustedDecision(rawPoint, result, reason, motion, overrides = {}) {
  return {
    result,
    reason,
    rawPointId: rawPoint.rawPointId,
    lat: rawPoint.lat,
    lng: rawPoint.lng,
    distanceDeltaMeters: overrides.distanceDeltaMeters ?? 0,
    movingTimeDeltaSeconds: overrides.movingTimeDeltaSeconds ?? 0,
    startsNewSegment: overrides.startsNewSegment === true,
    activityState: motion.state,
    activityConfidence: motion.confidence,
    boundaryState: overrides.boundaryState || 'none',
    cloudType: overrides.cloudType || 'MOVING_CLOUD',
    cloudId: overrides.cloudId ?? rawPoint.rawPointId,
    cloudSampleCount: overrides.cloudSampleCount ?? 1,
    cloudWeightSum: overrides.cloudWeightSum ?? 1,
    cloudWeightedRadiusMeters: overrides.cloudWeightedRadiusMeters ?? 0,
    representativeRawPointId: overrides.representativeRawPointId ?? rawPoint.rawPointId,
    contributingRawPointIds: overrides.contributingRawPointIds ?? [rawPoint.rawPointId]
  };
}

function diagnosticDecision(rawPoint, result, reason, motion, overrides = {}) {
  return {
    result,
    reason,
    rawPointId: rawPoint.rawPointId,
    lat: rawPoint.lat,
    lng: rawPoint.lng,
    distanceDeltaMeters: overrides.distanceDeltaMeters ?? 0,
    movingTimeDeltaSeconds: overrides.movingTimeDeltaSeconds ?? 0,
    startsNewSegment: false,
    activityState: motion.state,
    activityConfidence: motion.confidence,
    boundaryState: overrides.boundaryState || 'none',
    cloudType: overrides.cloudType || 'WEAK_CLOUD',
    cloudId: overrides.cloudId ?? rawPoint.rawPointId,
    cloudSampleCount: overrides.cloudSampleCount ?? 1,
    cloudWeightSum: overrides.cloudWeightSum ?? 1,
    cloudWeightedRadiusMeters: overrides.cloudWeightedRadiusMeters ?? 0,
    representativeRawPointId: overrides.representativeRawPointId ?? rawPoint.rawPointId,
    contributingRawPointIds: overrides.contributingRawPointIds ?? [rawPoint.rawPointId]
  };
}

function classifyActivity(rawPoint, motionIndex) {
  const stats = recentMotionStats(rawPoint.elapsedRealtimeNanos, motionIndex, MOTION_LOOKBACK_NANOS);
  if (stats.total === 0) {
    return { state: 'unknown', confidence: 'low', stats };
  }
  if (stats.active > 0 && stats.active >= stats.still) {
    return { state: 'walking', confidence: stats.active >= 2 ? 'high' : 'medium', stats };
  }
  if (stats.still > 0) {
    return { state: 'still', confidence: stats.still >= 2 ? 'high' : 'medium', stats };
  }
  return { state: 'unknown', confidence: 'low', stats };
}

function applyGnssAltitude(rawPoint, decision, state, product, config) {
  const trusted = decision.result === 'anchor' || decision.result === 'accept';
  const moving = decision.result === 'accept'
    && decision.reason !== 'gap_recovery'
    && decision.reason !== 'transport_risk'
    && !isTransportTrackReason(decision.reason);

  if (!Number.isFinite(rawPoint.altitude)) {
    return { result: 'unavailable', reason: 'gnss_altitude_missing' };
  }
  if (!trusted) {
    product.stats.locationAltitudeAscentRejectedSampleCount++;
    return { result: 'rejected', reason: 'horizontal_point_not_trusted' };
  }
  if (!Number.isFinite(rawPoint.verticalAccuracy)
      || rawPoint.verticalAccuracy > config.locationAltitudeAscentMaxVerticalAccuracyMeters) {
    product.stats.locationAltitudeAscentRejectedSampleCount++;
    return {
      result: 'rejected',
      reason: Number.isFinite(rawPoint.verticalAccuracy)
        ? 'vertical_accuracy_too_large'
        : 'vertical_accuracy_missing'
    };
  }
  if (!moving) {
    state.gnssAltitudeAnchorMeters = rawPoint.altitude;
    product.stats.locationAltitudeAscentSampleCount++;
    return { result: 'reset', reason: altitudeResetReason(decision.reason) };
  }

  product.stats.locationAltitudeAscentSampleCount++;
  if (!Number.isFinite(state.gnssAltitudeAnchorMeters)) {
    state.gnssAltitudeAnchorMeters = rawPoint.altitude;
    return { result: 'accepted', reason: 'gnss_altitude_anchor' };
  }
  const delta = rawPoint.altitude - state.gnssAltitudeAnchorMeters;
  if (Math.abs(delta) > config.locationAltitudeAscentMaxStepGainMeters) {
    product.stats.locationAltitudeAscentRejectedSampleCount++;
    state.gnssAltitudeAnchorMeters = rawPoint.altitude;
    return { result: 'rejected', reason: 'gnss_altitude_jump' };
  }
  if (delta >= config.locationAltitudeAscentMinGainMeters) {
    if (product.stats.locationAltitudeTotalAscentMeters < 0) {
      product.stats.locationAltitudeTotalAscentMeters = 0;
    }
    product.stats.locationAltitudeTotalAscentMeters += delta;
  }
  state.gnssAltitudeAnchorMeters = rawPoint.altitude;
  return { result: 'accepted', reason: 'gnss_altitude_accepted' };
}

function altitudeResetReason(horizontalReason) {
  if (horizontalReason === 'gap_recovery') return 'gap_recovery_reset';
  if (horizontalReason === 'stationary_anchor') return 'stationary_suspended';
  if (horizontalReason === 'first_fix_good' || horizontalReason === 'first_fix_relaxed') {
    return 'gnss_altitude_anchor';
  }
  return 'boundary_reset';
}

function applyBarometerAscent(product, evidence, config) {
  const sorted = evidence.barometerWindows
    .filter((window) => Number.isFinite(window.endElapsedRealtimeNanos))
    .sort((a, b) => a.endElapsedRealtimeNanos - b.endElapsedRealtimeNanos);
  let anchorAltitude = null;
  let anchorTime = null;
  let accepted = 0;
  let rejectedCount = 0;
  let total = 0;

  for (const window of sorted) {
    const altitude = window.avgRawBarometerAltitudeMeters;
    const time = window.endElapsedRealtimeNanos;
    let result = 'accumulating';
    let reason = 'barometer_accumulating';
    let delta = 0;

    if (!Number.isFinite(altitude) || window.avgPressureHpa !== null && window.avgPressureHpa <= 0) {
      result = 'rejected';
      reason = 'barometer_unavailable';
      rejectedCount++;
    } else if (!Number.isFinite(anchorAltitude)) {
      result = 'reset';
      reason = 'boundary_reset';
      anchorAltitude = altitude;
      anchorTime = time;
      accepted++;
    } else {
      const dt = Math.max(0, time - anchorTime);
      const rawDelta = altitude - anchorAltitude;
      const verticalSpeed = dt > 0 ? Math.abs(rawDelta) / (dt / NANOS_PER_SECOND) : 0;
      if (dt > config.barometerAscentMaxSampleGapNanos) {
        result = 'reset';
        reason = 'pressure_sample_gap';
        anchorAltitude = altitude;
        anchorTime = time;
        accepted++;
      } else if (Math.abs(rawDelta) >= config.barometerPressureJumpMeters
          || verticalSpeed > config.barometerAscentMaxVerticalSpeedMetersPerSecond) {
        result = 'rejected';
        reason = 'pressure_jump_detected';
        rejectedCount++;
        anchorAltitude = altitude;
        anchorTime = time;
      } else {
        if (rawDelta >= config.barometerAscentMinGainMeters) {
          delta = rawDelta;
          total += delta;
        }
        anchorAltitude = altitude;
        anchorTime = time;
        accepted++;
      }
    }

    product.barometerWindowDecisions.push({
      windowId: window.windowId,
      result,
      reason,
      ascentDeltaMeters: delta,
      activityGate: 'independent',
      boundaryGate: result === 'reset' ? 'reset' : 'open',
      confidence: result === 'rejected' ? 'low' : 'medium'
    });
  }

  product.stats.barometerAscentSampleCount = accepted;
  product.stats.barometerAscentRejectedSampleCount = rejectedCount;
  product.stats.barometerTotalAscentMeters = accepted >= 2 ? total : -1;
  product.stats.barometerAscentConfidence = accepted >= 2 && rejectedCount === 0
    ? 'high'
    : accepted >= 2
      ? 'medium'
      : 'none';
}

function settleDecision(decision, gnssAltitude) {
  const trusted = decision.result === 'anchor' || decision.result === 'accept';
  const transport = isTransportTrackReason(decision.reason);
  const countsDistance = trusted && decision.distanceDeltaMeters > 0
    && decision.reason !== 'gap_recovery'
    && decision.reason !== 'stationary_anchor'
    && decision.reason !== 'stationary_drift_anchor'
    && !transport;
  const countsMovingTime = countsDistance && decision.movingTimeDeltaSeconds > 0;
  return {
    entersTrustedGpx: trusted && !transport,
    countsDistance,
    countsMovingTime,
    countsAscentWindow: countsDistance && gnssAltitude.result === 'accepted'
  };
}

function finalizeStats(product) {
  product.stats.trustedPointCount = product.track.length;
  product.stats.weakPointCount = product.excluded.weak.length;
  product.stats.rejectedPointCount = product.excluded.rejected.length;
  product.stats.intakeRejectedPointCount = product.excluded.intakeRejected.length;
  product.stats.transportCount = product.excluded.rejected
    .filter((point) => point.reason === 'transport_risk').length
    + product.track.filter((point) => isTransportTrackReason(point.reason)).length;
  product.stats.segmentCount = product.track.length === 0
    ? 0
    : new Set(product.track.map((point) => point.segmentId)).size;
  product.stats.totalDistanceMeters = product.track.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters : 0), 0);
  product.stats.routeDistanceMeters = product.stats.totalDistanceMeters;
  product.stats.suspectedDistanceMeters = product.excluded.rejected.reduce((sum, point) =>
    sum + (point.reason === 'transport_risk' ? point.distanceDeltaMeters || 0 : 0), 0);
  product.stats.suspectedDistanceMeters += product.track.reduce((sum, point) =>
    sum + (isTransportTrackReason(point.reason) ? point.distanceDeltaMeters || 0 : 0), 0);
  product.stats.movingTimeSeconds = product.track.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds : 0), 0);
  if (product.stats.locationAltitudeAscentSampleCount >= 2
      && product.stats.locationAltitudeTotalAscentMeters < 0) {
    product.stats.locationAltitudeTotalAscentMeters = 0;
  }
  product.stats.locationAltitudeAscentConfidence =
    product.stats.locationAltitudeAscentSampleCount >= 2
      ? product.stats.locationAltitudeAscentRejectedSampleCount === 0 ? 'high' : 'medium'
      : 'none';
  const selected = chooseSelectedAscent(product.stats);
  product.stats.selectedAscentSource = selected.source;
  product.stats.selectedTotalAscentMeters = selected.totalAscentMeters;
  product.gnssAltitudeResult = {
    totalAscentMeters: product.stats.locationAltitudeTotalAscentMeters,
    sampleCount: product.stats.locationAltitudeAscentSampleCount,
    rejectedSampleCount: product.stats.locationAltitudeAscentRejectedSampleCount,
    confidence: product.stats.locationAltitudeAscentConfidence
  };
  product.barometerAscentResult = {
    totalAscentMeters: product.stats.barometerTotalAscentMeters,
    sampleCount: product.stats.barometerAscentSampleCount,
    rejectedSampleCount: product.stats.barometerAscentRejectedSampleCount,
    confidence: product.stats.barometerAscentConfidence
  };
  product.selectedAscentResult = {
    source: selected.source,
    totalAscentMeters: selected.totalAscentMeters,
    confidence: selected.confidence,
    reason: selected.reason
  };
}

function addPostSettlementScenarios(product) {
  addGapRecoveryScenario(product);
  addTransportContaminationScenario(product);
  addClosedLoopRoundTripScenarios(product, product.config);
  addEnclosedGapClusterScenarios(product, product.config);
  addRestPhotoMicroMoveScenarios(product, product.config);
}

function addGapRecoveryScenario(product) {
  const gapPoints = product.track.filter((point) => point.reason === 'gap_recovery');
  if (gapPoints.length === 0) return;
  addScenario(product, {
    scenario: 'gap_recovery_boundary',
    confidence: 0.85,
    rawRange: rawPointRange(gapPoints.map((point) => point.sourceRawPointId)),
    anchorRawPointIds: gapPoints.map((point) => point.sourceRawPointId),
    action: 'reset_segment_zero_delta',
    localRebuild: 'gap_recovery_anchor',
    evidence: {
      recoveryCount: gapPoints.length,
      rawPointIds: gapPoints.map((point) => point.sourceRawPointId),
      segmentIds: uniqueNumbers(gapPoints.map((point) => point.segmentId)),
      zeroDistanceCount: gapPoints.filter((point) => point.distanceDeltaMeters === 0).length,
      zeroMovingTimeCount: gapPoints
        .filter((point) => point.movingTimeDeltaSeconds === 0).length
    }
  });
}

function addTransportContaminationScenario(product) {
  const rejectedTransport = product.excluded.rejected
    .filter((point) => point.reason === 'transport_risk');
  const keptTransport = product.track.filter((point) => isTransportTrackReason(point.reason));
  const pendingTransport = product.excluded.weak
    .filter((point) => point.reason === 'transport_recovery_pending');
  const allRawPointIds = [
    ...rejectedTransport.map((point) => point.rawPointId),
    ...keptTransport.map((point) => point.sourceRawPointId),
    ...pendingTransport.map((point) => point.rawPointId)
  ];
  if (allRawPointIds.length === 0) return;
  addScenario(product, {
    scenario: 'transport_contamination',
    confidence: 0.8,
    rawRange: rawPointRange(allRawPointIds),
    anchorRawPointIds: keptTransport.map((point) => point.sourceRawPointId),
    action: 'exclude_from_hiking_truth',
    localRebuild: 'transport_diagnostic_continuity',
    evidence: {
      rejectedRawPointIds: rejectedTransport.map((point) => point.rawPointId),
      keptRawPointIds: keptTransport.map((point) => point.sourceRawPointId),
      pendingRawPointIds: pendingTransport.map((point) => point.rawPointId),
      suspectedDistanceMeters: scenarioNumber(product.stats.suspectedDistanceMeters),
      countsDistance: false,
      countsMovingTime: false
    }
  });
}

function addClosedLoopRoundTripScenarios(product, config) {
  if (!config.closedLoopRoundTripEnabled) return;
  const candidates = nonOverlappingScenarioCandidates(
    closedLoopRoundTripCandidates(product, config),
    product.scenarios.filter((scenario) =>
      scenario.scenario === 'same_road_round_trip'
      || scenario.scenario === 'round_trip_line')
  );
  for (const candidate of candidates) {
    addScenario(product, closedLoopRoundTripScenario(candidate, config,
      product.denseAreaIntents ?? []));
  }
}

function closedLoopRoundTripCandidates(product, config) {
  const candidates = [];
  const track = product.track;
  for (let startIndex = 0; startIndex < track.length; startIndex++) {
    let best = null;
    const maxEndIndex = Math.min(track.length - 1,
      startIndex + config.closedLoopRoundTripMaxTrackPoints - 1);
    for (let endIndex = startIndex + config.closedLoopRoundTripMinTrackPoints - 1;
      endIndex <= maxEndIndex; endIndex++) {
      const span = track.slice(startIndex, endIndex + 1);
      const rawRange = trackSpanRawPointRange(span);
      if (rawRange.endRawPointId - rawRange.startRawPointId
          > config.closedLoopRoundTripMaxRawPointIdSpan) {
        break;
      }
      if (overlapsScenarioNames(product.scenarios, rawRange,
        ['same_road_round_trip', 'round_trip_line'])) {
        continue;
      }
      const pathMeters = trackPathMeters(span);
      if (pathMeters < config.closedLoopRoundTripMinPathMeters) continue;
      const netDistanceMeters = trackNetDistanceMeters(span);
      if (netDistanceMeters > config.closedLoopRoundTripMaxEndpointDistanceMeters) continue;
      if (netDistanceMeters / Math.max(pathMeters, 1)
          > config.closedLoopRoundTripMaxNetPathRatio) {
        continue;
      }
      const bboxMeters = bboxDiagonalMeters(span);
      if (bboxMeters < config.closedLoopRoundTripMinBboxMeters
          || bboxMeters > config.closedLoopRoundTripMaxBboxMeters) {
        continue;
      }
      const candidate = {
        scenario: 'closed_loop_round_trip',
        startIndex,
        endIndex,
        span,
        rawRange,
        pathMeters,
        netDistanceMeters,
        bboxMeters,
        durationSeconds: trackSpanDurationSeconds(span),
        score: pathMeters + span.length
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

function closedLoopRoundTripScenario(candidate, config, denseAreaIntents = []) {
  const start = candidate.span[0];
  const end = candidate.span.at(-1);
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  const netScore = 1 - Math.min(1,
    candidate.netDistanceMeters / Math.max(config.closedLoopRoundTripMaxEndpointDistanceMeters, 1));
  const pathScore = Math.min(1,
    candidate.pathMeters / Math.max(config.closedLoopRoundTripMinPathMeters * 2, 1));
  const bboxScore = Math.min(1,
    candidate.bboxMeters / Math.max(config.closedLoopRoundTripMinBboxMeters * 2, 1));
  return {
    scenario: 'closed_loop_round_trip',
    confidence: scenarioNumber(clamp01(0.45 + netScore * 0.25
      + pathScore * 0.2 + bboxScore * 0.1)),
    rawRange: candidate.rawRange,
    anchorRawPointIds: uniqueNumbers([start.sourceRawPointId, end.sourceRawPointId]),
    action: 'classify_loop_without_rewrite',
    localRebuild: 'round_trip_diagnostic',
    evidence: {
      startTrackPointId: start.trackPointId,
      endTrackPointId: end.trackPointId,
      trackPointCount: candidate.span.length,
      pathMeters: scenarioNumber(candidate.pathMeters),
      netDistanceMeters: scenarioNumber(candidate.netDistanceMeters),
      bboxDiagonalMeters: scenarioNumber(candidate.bboxMeters),
      durationSeconds: scenarioNumber(candidate.durationSeconds),
      maxEndpointDistanceMeters: scenarioNumber(
        config.closedLoopRoundTripMaxEndpointDistanceMeters),
      denseAreaIntents: overlappingIntents.map((intent) => intent.intent),
      roundTripIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'round_trip')
    }
  };
}

function addEnclosedGapClusterScenarios(product, config) {
  if (!config.enclosedGapClusterEnabled) return;
  const candidates = nonOverlappingScenarioCandidates(
    enclosedGapClusterCandidates(product, config),
    []
  );
  for (const candidate of candidates) {
    addScenario(product, enclosedGapClusterScenario(candidate, config,
      product.denseAreaIntents ?? []));
  }
}

function enclosedGapClusterCandidates(product, config) {
  const gapIndexes = product.track
    .map((point, index) => point.reason === 'gap_recovery' ? index : -1)
    .filter((index) => index >= 0);
  const candidates = [];
  for (let startGap = 0; startGap < gapIndexes.length; startGap++) {
    for (let endGap = startGap + config.enclosedGapClusterMinGapRecoveries - 1;
      endGap < gapIndexes.length; endGap++) {
      const startIndex = Math.max(0, gapIndexes[startGap] - 4);
      const endIndex = Math.min(product.track.length - 1, gapIndexes[endGap] + 10);
      const span = product.track.slice(startIndex, endIndex + 1);
      const rawRange = trackSpanRawPointRange(span);
      if (rawRange.endRawPointId - rawRange.startRawPointId
          < config.enclosedGapClusterMinRawPointIdSpan) {
        continue;
      }
      const gapRecoveryCount = span.filter((point) => point.reason === 'gap_recovery').length;
      if (gapRecoveryCount < config.enclosedGapClusterMinGapRecoveries) continue;
      const stationaryAnchorCount = span.filter((point) =>
        point.reason === 'stationary_anchor'
        || point.reason === 'stationary_drift_anchor').length;
      if (stationaryAnchorCount < config.enclosedGapClusterMinStationaryAnchors) continue;
      const bboxMeters = bboxDiagonalMeters(span);
      if (bboxMeters > config.enclosedGapClusterMaxBboxMeters) continue;
      const durationSeconds = trackSpanDurationSeconds(span);
      if (durationSeconds < config.enclosedGapClusterMinDurationSeconds) continue;
      candidates.push({
        scenario: 'enclosed_gap_cluster',
        startIndex,
        endIndex,
        span,
        rawRange,
        gapRecoveryCount,
        stationaryAnchorCount,
        bboxMeters,
        durationSeconds,
        segmentIds: uniqueNumbers(span.map((point) => point.segmentId)),
        score: gapRecoveryCount * 100 + stationaryAnchorCount * 10 + durationSeconds / 60
      });
    }
  }
  return candidates;
}

function enclosedGapClusterScenario(candidate, config, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  return {
    scenario: 'enclosed_gap_cluster',
    confidence: scenarioNumber(clamp01(0.45
      + Math.min(1, candidate.gapRecoveryCount
        / Math.max(config.enclosedGapClusterMinGapRecoveries + 2, 1)) * 0.25
      + Math.min(1, candidate.stationaryAnchorCount
        / Math.max(config.enclosedGapClusterMinStationaryAnchors + 2, 1)) * 0.15
      + (1 - Math.min(1, candidate.bboxMeters
        / Math.max(config.enclosedGapClusterMaxBboxMeters, 1))) * 0.15)),
    rawRange: candidate.rawRange,
    anchorRawPointIds: uniqueNumbers(candidate.span
      .filter((point) => point.reason === 'gap_recovery'
        || point.reason === 'stationary_anchor'
        || point.reason === 'stationary_drift_anchor')
      .map((point) => point.sourceRawPointId)),
    action: 'classify_enclosed_gap_cluster',
    localRebuild: 'gap_stationary_cluster_diagnostic',
    evidence: {
      startTrackPointId: candidate.span[0].trackPointId,
      endTrackPointId: candidate.span.at(-1).trackPointId,
      trackPointCount: candidate.span.length,
      gapRecoveryCount: candidate.gapRecoveryCount,
      stationaryAnchorCount: candidate.stationaryAnchorCount,
      segmentIds: candidate.segmentIds,
      bboxDiagonalMeters: scenarioNumber(candidate.bboxMeters),
      durationSeconds: scenarioNumber(candidate.durationSeconds),
      denseAreaIntents: overlappingIntents.map((intent) => intent.intent),
      gapClusterIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'gap_cluster'),
      mixedIntentSupported: overlappingIntents
        .some((intent) => intent.intent === 'mixed')
    }
  };
}

function addRestPhotoMicroMoveScenarios(product, config) {
  if (!config.restPhotoMicroMoveEnabled) return;
  const existingRanges = product.scenarios
    .filter((scenario) => scenario.scenario === 'rest_photo_micro_move')
    .map((scenario) => scenario.rawRange)
    .filter(Boolean);
  const candidates = nonOverlappingScenarioCandidates(
    restPhotoMicroMoveCandidates(product, config).filter((candidate) =>
      !existingRanges.some((range) => rawRangesOverlap(range, candidate.rawRange))),
    []
  );
  for (const candidate of candidates) {
    addScenario(product, restPhotoMicroMoveScenario(candidate, config,
      product.denseAreaIntents ?? []));
  }
}

function restPhotoMicroMoveCandidates(product, config) {
  const candidates = [];
  const track = product.track;
  for (let startIndex = 0; startIndex < track.length; startIndex++) {
    let best = null;
    const maxEndIndex = Math.min(track.length - 1,
      startIndex + config.restPhotoMicroMoveMaxTrackPoints - 1);
    for (let endIndex = startIndex + config.restPhotoMicroMoveMinTrackPoints - 1;
      endIndex <= maxEndIndex; endIndex++) {
      const span = track.slice(startIndex, endIndex + 1);
      const rawRange = trackSpanRawPointRange(span);
      const pathMeters = trackPathMeters(span);
      if (pathMeters < config.restPhotoMicroMoveMinPathMeters
          || pathMeters > config.restPhotoMicroMoveMaxPathMeters) {
        continue;
      }
      const netDistanceMeters = trackNetDistanceMeters(span);
      if (netDistanceMeters > config.restPhotoMicroMoveMaxEndpointDistanceMeters) continue;
      if (pathMeters / Math.max(netDistanceMeters, 1)
          < config.restPhotoMicroMoveMinPathNetRatio) {
        continue;
      }
      const bboxMeters = bboxDiagonalMeters(span);
      if (bboxMeters > config.restPhotoMicroMoveMaxBboxMeters) continue;
      const durationSeconds = trackSpanDurationSeconds(span);
      if (durationSeconds > config.restPhotoMicroMoveMaxDurationSeconds) continue;
      const lowSpeedCount = span.filter((point) =>
        point.reason === 'motion_supported_low_speed'
        || point.reason === 'moving_good_fix'
        || point.reason === 'stationary_anchor').length;
      if (lowSpeedCount / span.length < 0.8) continue;
      const candidate = {
        scenario: 'rest_photo_micro_move',
        startIndex,
        endIndex,
        span,
        rawRange,
        pathMeters,
        netDistanceMeters,
        bboxMeters,
        durationSeconds,
        lowSpeedCount,
        score: pathMeters + span.length * 2
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

function restPhotoMicroMoveScenario(candidate, config, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  const intentNames = overlappingIntents.map((intent) => intent.intent);
  return {
    scenario: 'rest_photo_micro_move',
    confidence: scenarioNumber(clamp01(0.45
      + Math.min(1, candidate.pathMeters
        / Math.max(config.restPhotoMicroMoveMinPathMeters * 2, 1)) * 0.2
      + (1 - Math.min(1, candidate.bboxMeters
        / Math.max(config.restPhotoMicroMoveMaxBboxMeters, 1))) * 0.2
      + Math.min(1, candidate.lowSpeedCount / Math.max(candidate.span.length, 1)) * 0.15)),
    rawRange: candidate.rawRange,
    anchorRawPointIds: uniqueNumbers([
      candidate.span[0].sourceRawPointId,
      candidate.span.at(-1).sourceRawPointId
    ]),
    action: 'classify_micro_move_without_rewrite',
    localRebuild: 'rest_photo_micro_move_diagnostic',
    evidence: {
      startTrackPointId: candidate.span[0].trackPointId,
      endTrackPointId: candidate.span.at(-1).trackPointId,
      trackPointCount: candidate.span.length,
      pathMeters: scenarioNumber(candidate.pathMeters),
      netDistanceMeters: scenarioNumber(candidate.netDistanceMeters),
      bboxDiagonalMeters: scenarioNumber(candidate.bboxMeters),
      durationSeconds: scenarioNumber(candidate.durationSeconds),
      lowSpeedRatio: scenarioNumber(candidate.lowSpeedCount
        / Math.max(candidate.span.length, 1)),
      denseAreaIntents: intentNames,
      stationaryIntentSupported: intentNames.includes('stationary'),
      mixedIntentSupported: intentNames.includes('mixed'),
      forwardIntentOverlapped: intentNames.includes('forward_motion'),
      localMicroMoveOverridesDenseForward: intentNames.includes('forward_motion')
        && candidate.pathMeters / Math.max(candidate.netDistanceMeters, 1)
          >= config.restPhotoMicroMoveMinPathNetRatio
    }
  };
}

function nonOverlappingScenarioCandidates(candidates, existingScenarios) {
  const accepted = [];
  const blockedRanges = existingScenarios
    .filter((scenario) => scenarioUsesContinuousRawRange(scenario.scenario))
    .map((scenario) => scenario.rawRange)
    .filter((range) => Number.isFinite(range?.startRawPointId)
      && Number.isFinite(range?.endRawPointId));
  for (const candidate of [...candidates].sort((a, b) =>
    b.score - a.score
    || a.rawRange.startRawPointId - b.rawRange.startRawPointId)) {
    if (blockedRanges.some((range) => rawRangesOverlap(candidate.rawRange, range))) {
      continue;
    }
    if (accepted.some((existing) =>
      rangesOverlap(candidate.startIndex, candidate.endIndex,
        existing.startIndex, existing.endIndex))) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.startIndex - b.startIndex);
}

function overlapsScenarioNames(scenarios, rawRange, names) {
  const targetNames = new Set(names);
  return scenarios.some((scenario) =>
    targetNames.has(scenario.scenario)
    && rawRangesOverlap(rawRange, scenario.rawRange));
}

function rawRangesOverlap(a, b) {
  return Number.isFinite(a?.startRawPointId)
    && Number.isFinite(a?.endRawPointId)
    && Number.isFinite(b?.startRawPointId)
    && Number.isFinite(b?.endRawPointId)
    && a.startRawPointId <= b.endRawPointId
    && b.startRawPointId <= a.endRawPointId;
}

function rawRangeContains(outer, inner) {
  return Number.isFinite(outer?.startRawPointId)
    && Number.isFinite(outer?.endRawPointId)
    && Number.isFinite(inner?.startRawPointId)
    && Number.isFinite(inner?.endRawPointId)
    && outer.startRawPointId <= inner.startRawPointId
    && outer.endRawPointId >= inner.endRawPointId;
}

function trackSpanRawPointRange(span) {
  return rawPointRange(span.flatMap((point) => pointRawPointIds(point)));
}

function trackPathMeters(span) {
  let total = 0;
  for (let index = 1; index < span.length; index++) {
    total += distanceMeters(span[index - 1].lat, span[index - 1].lng,
      span[index].lat, span[index].lng);
  }
  return total;
}

function trackNetDistanceMeters(span) {
  if (span.length < 2) return 0;
  return distanceMeters(span[0].lat, span[0].lng, span.at(-1).lat, span.at(-1).lng);
}

function trackSpanDurationSeconds(span) {
  if (span.length < 2) return 0;
  return elapsedSeconds(span[0].elapsedRealtimeNanos, span.at(-1).elapsedRealtimeNanos);
}

function rawPointRange(rawPointIds) {
  const finite = rawPointIds.filter(Number.isFinite);
  if (finite.length === 0) {
    return { startRawPointId: null, endRawPointId: null };
  }
  return {
    startRawPointId: Math.min(...finite),
    endRawPointId: Math.max(...finite)
  };
}

function attachExplanationModel(product) {
  const scenarioByName = new Map(product.scenarios.map((scenario) =>
    [scenario.scenario, scenario]));
  const scenarioByRawPointId = buildScenarioRawPointIndex(product);

  for (const point of product.track) {
    attachPointExplanation(point, scenarioByName, scenarioByRawPointId);
  }
  for (const point of product.excluded.weak) {
    attachPointExplanation(point, scenarioByName, scenarioByRawPointId);
  }
  for (const point of product.excluded.rejected) {
    attachPointExplanation(point, scenarioByName, scenarioByRawPointId);
  }
  for (const point of product.excluded.intakeRejected) {
    attachPointExplanation(point, scenarioByName, scenarioByRawPointId);
  }
  product.rawPointDecisions = product.rawPointDecisions.map((decision) => {
    const primitiveFacts = primitiveFactsForDecision(decision);
    const scenarioContexts = scenariosForPoint(decision.horizontalReason,
      [decision.rawPointId], scenarioByName, scenarioByRawPointId);
    const directScenario = scenarioForReason(decision.horizontalReason, scenarioByName);
    const scenario = directScenario ?? preferredScenario(scenarioContexts);
    return {
      ...decision,
      primitiveFacts,
      scenarioContexts: scenarioContexts.map(scenarioContext),
      primaryExplanation: primaryExplanation(decision.horizontalResult,
        decision.horizontalReason, primitiveFacts, scenario)
    };
  });
  product.explanationModel = {
    mode: 'scenario_primary_with_contexts_and_primitive_facts',
    primitiveFactVersion: 1,
    scenarioCount: product.scenarios.length,
    stableScenarioCount: product.scenarios.length,
    fallback: 'primitive_reason'
  };
}

function attachPointExplanation(point, scenarioByName, scenarioByRawPointId) {
  const primitiveFacts = primitiveFactsForPoint(point);
  const scenarioContexts = scenariosForPoint(point.reason, pointRawPointIds(point),
    scenarioByName, scenarioByRawPointId);
  const directScenario = scenarioForReason(point.reason, scenarioByName);
  const scenario = directScenario ?? preferredScenario(scenarioContexts);
  point.primitiveFacts = primitiveFacts;
  point.scenarioContexts = scenarioContexts.map(scenarioContext);
  point.primaryExplanation = primaryExplanation(point.result, point.reason,
    primitiveFacts, scenario);
}

function buildScenarioRawPointIndex(product) {
  const scenarioByRawPointId = new Map();
  for (const scenario of product.scenarios) {
    for (const rawPointId of scenarioRawPointIds(scenario)) {
      if (!Number.isFinite(rawPointId)) continue;
      const scenarios = scenarioByRawPointId.get(rawPointId) || [];
      scenarios.push(scenario);
      scenarioByRawPointId.set(rawPointId, scenarios);
    }
  }
  return scenarioByRawPointId;
}

function scenarioRawPointIds(scenario) {
  const ids = new Set();
  addNumbers(ids, scenario.anchorRawPointIds);
  addNumbers(ids, scenario.evidence?.rawPointIds);
  addNumbers(ids, scenario.evidence?.rejectedRawPointIds);
  addNumbers(ids, scenario.evidence?.weakRawPointIds);
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
  const start = scenario.rawRange?.startRawPointId;
  const end = scenario.rawRange?.endRawPointId;
  if (scenarioUsesContinuousRawRange(scenario.scenario)
      && Number.isFinite(start) && Number.isFinite(end) && end >= start
      && end - start <= 1500) {
    for (let rawPointId = start; rawPointId <= end; rawPointId++) {
      ids.add(rawPointId);
    }
  }
  return [...ids];
}

function scenarioUsesContinuousRawRange(name) {
  return name === 'stationary_session_collapse'
    || name === 'stationary_drift_collapse'
    || name === 'weak_recovery_endpoint'
    || name === 'same_road_round_trip'
    || name === 'round_trip_line'
    || name === 'closed_loop_round_trip'
    || name === 'enclosed_gap_cluster'
    || name === 'enclosed_loop_cluster_settlement'
    || name === 'dense_area_intent'
    || name === 'dense_main_route_settlement'
    || name === 'rest_photo_micro_move';
}

function addNumbers(target, values) {
  for (const value of values || []) {
    if (Number.isFinite(value)) target.add(value);
  }
}

function pointRawPointIds(point) {
  if (point.contributingRawPointIds?.length) return point.contributingRawPointIds;
  return [point.sourceRawPointId ?? point.rawPointId].filter(Number.isFinite);
}

function scenariosForPoint(reason, rawPointIds, scenarioByName, scenarioByRawPointId) {
  const scenarios = [];
  const directScenario = scenarioForReason(reason, scenarioByName);
  if (directScenario) scenarios.push(directScenario);
  for (const rawPointId of rawPointIds || []) {
    scenarios.push(...(scenarioByRawPointId.get(rawPointId) || []));
  }
  return sortUniqueScenarios(scenarios);
}

function preferredScenario(scenarios) {
  return sortUniqueScenarios(scenarios)[0] ?? null;
}

function sortUniqueScenarios(scenarios) {
  return [...new Set(scenarios)].sort((a, b) =>
    scenarioPriority(a.scenario) - scenarioPriority(b.scenario)
    || (b.confidence ?? 0) - (a.confidence ?? 0)
    || a.scenarioId - b.scenarioId);
}

function scenarioContext(scenario) {
  const continuousCoverage = scenarioUsesContinuousRawRange(scenario.scenario);
  return {
    scenarioId: scenario.scenarioId,
    scenario: scenario.scenario,
    scenarioLabel: scenarioChineseLabel(scenario.scenario),
    confidence: scenario.confidence,
    action: scenario.action,
    actionLabel: scenarioActionChineseLabel(scenario.action),
    localRebuild: scenario.localRebuild,
    localRebuildLabel: localRebuildChineseLabel(scenario.localRebuild),
    rawRange: scenario.rawRange,
    rawPointIds: continuousCoverage ? [] : scenarioRawPointIds(scenario),
    summary: scenarioExplanationSummary(scenario)
  };
}

function buildScenarioCoverage(product) {
  const coverageById = new Map(product.scenarios.map((scenario) => [
    scenario.scenarioId,
    {
      ...scenarioContext(scenario),
      continuousCoverage: scenarioUsesContinuousRawRange(scenario.scenario),
      trackPointRange: { startTrackPointId: null, endTrackPointId: null },
      trackPointIds: [],
      contextTrackPointCount: 0,
      primaryTrackPointCount: 0,
      rawDecisionContextCount: 0,
      rawDecisionPrimaryCount: 0
    }
  ]));
  for (const point of product.track) {
    for (const context of point.scenarioContexts || []) {
      const coverage = coverageById.get(context.scenarioId);
      if (!coverage) continue;
      coverage.contextTrackPointCount++;
      coverage.trackPointIds.push(point.trackPointId);
      extendTrackPointRange(coverage.trackPointRange, point.trackPointId);
    }
    const primaryId = point.primaryExplanation?.source === 'scenario'
      ? point.primaryExplanation.scenarioId
      : null;
    if (Number.isFinite(primaryId) && coverageById.has(primaryId)) {
      coverageById.get(primaryId).primaryTrackPointCount++;
    }
  }
  for (const decision of product.rawPointDecisions) {
    for (const context of decision.scenarioContexts || []) {
      const coverage = coverageById.get(context.scenarioId);
      if (coverage) coverage.rawDecisionContextCount++;
    }
    const primaryId = decision.primaryExplanation?.source === 'scenario'
      ? decision.primaryExplanation.scenarioId
      : null;
    if (Number.isFinite(primaryId) && coverageById.has(primaryId)) {
      coverageById.get(primaryId).rawDecisionPrimaryCount++;
    }
  }
  return Array.from(coverageById.values()).map((coverage) => ({
    ...coverage,
    trackPointIds: uniqueNumbers(coverage.trackPointIds)
  })).sort((a, b) =>
    nullLast(a.trackPointRange.startTrackPointId, b.trackPointRange.startTrackPointId)
    || nullLast(a.rawRange?.startRawPointId, b.rawRange?.startRawPointId)
    || a.scenarioId - b.scenarioId);
}

function scenarioCoverageRangeHit(coverage, startTrackPointId, endTrackPointId) {
  const matchedTrackPointIds = (coverage.trackPointIds || [])
    .filter((trackPointId) => trackPointId >= startTrackPointId
      && trackPointId <= endTrackPointId);
  if (!coverage.continuousCoverage && matchedTrackPointIds.length === 0) {
    return null;
  }
  const rangeStart = coverage.trackPointRange?.startTrackPointId;
  const rangeEnd = coverage.trackPointRange?.endTrackPointId;
  if (coverage.continuousCoverage
      && (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)
        || rangeStart > endTrackPointId || startTrackPointId > rangeEnd)) {
    return null;
  }
  const matchedTrackPointRange = matchedTrackPointIds.length > 0
    ? {
      startTrackPointId: Math.min(...matchedTrackPointIds),
      endTrackPointId: Math.max(...matchedTrackPointIds)
    }
    : {
      startTrackPointId: Math.max(rangeStart, startTrackPointId),
      endTrackPointId: Math.min(rangeEnd, endTrackPointId)
    };
  return {
    ...coverage,
    matchedTrackPointRange,
    matchedTrackPointIds
  };
}

function extendTrackPointRange(range, trackPointId) {
  if (!Number.isFinite(trackPointId)) return;
  range.startTrackPointId = Number.isFinite(range.startTrackPointId)
    ? Math.min(range.startTrackPointId, trackPointId)
    : trackPointId;
  range.endTrackPointId = Number.isFinite(range.endTrackPointId)
    ? Math.max(range.endTrackPointId, trackPointId)
    : trackPointId;
}

function nullLast(left, right) {
  const leftFinite = Number.isFinite(left);
  const rightFinite = Number.isFinite(right);
  if (leftFinite && rightFinite) return left - right;
  if (leftFinite) return -1;
  if (rightFinite) return 1;
  return 0;
}

function scenarioPriority(name) {
  switch (name) {
    case 'stationary_session_collapse': return 10;
    case 'stationary_drift_collapse': return 20;
    case 'dense_main_route_settlement': return 22;
    case 'rest_photo_micro_move': return 24;
    case 'enclosed_loop_cluster_settlement': return 25;
    case 'enclosed_gap_cluster': return 26;
    case 'position_snap_recovery': return 28;
    case 'same_road_round_trip': return 30;
    case 'closed_loop_round_trip': return 32;
    case 'round_trip_line': return 35;
    case 'weak_recovery_endpoint': return 40;
    case 'gap_recovery_boundary': return 50;
    case 'transport_contamination': return 60;
    case 'dense_area_intent': return 90;
    default: return 100;
  }
}

function scenarioChineseLabel(name) {
  switch (name) {
    case 'weak_recovery_endpoint': return '弱信号端点保留';
    case 'same_road_round_trip': return '同路往返交织';
    case 'closed_loop_round_trip': return '闭合往返/回环';
    case 'round_trip_line': return '往返线形';
    case 'dense_area_intent': return '密集区意图判断';
    case 'enclosed_gap_cluster': return '山洞/室内类遮挡聚集';
    case 'enclosed_loop_cluster_settlement': return '遮挡回环聚集压缩';
    case 'dense_main_route_settlement': return '密集区主路线骨架';
    case 'position_snap_recovery': return '定位跳变恢复';
    case 'stationary_session_collapse': return '整段静止压缩';
    case 'stationary_drift_collapse': return '停留漂移压缩';
    case 'rest_photo_micro_move': return '拍照/休息微移动';
    case 'moving_spike_cleanup': return '移动单点尖刺清理';
    case 'gap_recovery_boundary': return 'GAP 恢复边界';
    case 'transport_contamination': return '交通工具混入';
    default: return name || '未知情景';
  }
}

function scenarioActionChineseLabel(action) {
  switch (action) {
    case 'preserve_endpoint_anchor': return '保留端点锚点';
    case 'centerline_with_endpoint': return '压成中心线并保留端点';
    case 'classify_loop_without_rewrite': return '只标注闭合往返，不改轨迹';
    case 'rdp_line_simplify': return '线形抽稀';
    case 'classify_dense_area_intent': return '判断密集区主意图';
    case 'classify_enclosed_gap_cluster': return '标注遮挡聚集，不跨 GAP 计距';
    case 'compress_enclosed_loop_low_speed_drift': return '压缩遮挡回环内低速碎点';
    case 'preserve_dense_main_route_skeleton': return '保留密集区主路线骨架';
    case 'reset_position_snap_recovery_delta': return '定位跳变恢复点置零';
    case 'collapse_stationary_session': return '整段压成代表点';
    case 'collapse_drift_cloud': return '漂移云压成停留锚点';
    case 'classify_micro_move_without_rewrite': return '只标注小范围微移动';
    case 'simplify_micro_move_shape': return '简化小范围微移动';
    case 'collapse_micro_move_to_rest_anchor': return '压成休息锚点';
    case 'remove_single_point_spike': return '移除单点尖刺';
    case 'reset_segment_zero_delta': return '边界重置，距离和运动时间置零';
    case 'exclude_from_hiking_truth': return '排除出徒步真值';
    default: return action || '无动作';
  }
}

function localRebuildChineseLabel(localRebuild) {
  switch (localRebuild) {
    case 'weak_recovery_shape_anchor': return '弱恢复点云锚点';
    case 'same_road_centerline': return '同路中心线';
    case 'round_trip_diagnostic': return '往返诊断标注';
    case 'round_trip_polyline': return '往返折线';
    case 'dense_area_intent_classifier': return '密集区意图分类';
    case 'gap_stationary_cluster_diagnostic': return 'GAP/静止聚集诊断';
    case 'enclosed_loop_anchor_settlement': return '遮挡回环锚点压缩';
    case 'dense_main_route_skeleton': return '密集区前进骨架';
    case 'position_snap_recovery_anchor': return '定位跳变恢复锚点';
    case 'stationary_session_anchor': return '整段静止代表点';
    case 'stationary_drift_anchor': return '停留漂移代表点';
    case 'rest_photo_micro_move_diagnostic': return '微移动诊断标注';
    case 'rest_photo_micro_move_simplifier': return '微移动简化';
    case 'rest_photo_micro_move_anchor': return '休息微移动锚点';
    case 'moving_spike_line_bridge': return '移动尖刺桥接';
    case 'gap_recovery_anchor': return 'GAP 恢复锚点';
    case 'transport_diagnostic_continuity': return '交通污染诊断连续性';
    default: return localRebuild || '无局部重建';
  }
}

function scenarioForReason(reason, scenarioByName) {
  if (reason === 'stationary_session_anchor') {
    return scenarioByName.get('stationary_session_collapse') ?? null;
  }
  if (reason === 'stationary_drift_anchor') {
    return scenarioByName.get('stationary_drift_collapse') ?? null;
  }
  if (reason === 'weak_recovery_shape_anchor') {
    return scenarioByName.get('weak_recovery_endpoint') ?? null;
  }
  if (String(reason || '').startsWith('round_trip_interwoven_')) {
    return scenarioByName.get('same_road_round_trip')
      ?? scenarioByName.get('round_trip_line')
      ?? null;
  }
  if (String(reason || '').startsWith('interwoven_corridor_')) {
    return scenarioByName.get('interwoven_corridor') ?? null;
  }
  if (String(reason || '').startsWith('enclosed_loop_cluster_')) {
    return scenarioByName.get('enclosed_loop_cluster_settlement') ?? null;
  }
  if (String(reason || '').startsWith('dense_main_route_')) {
    return scenarioByName.get('dense_main_route_settlement') ?? null;
  }
  if (reason === 'position_snap_recovery_anchor') {
    return scenarioByName.get('position_snap_recovery') ?? null;
  }
  if (reason === 'gap_recovery') {
    return scenarioByName.get('gap_recovery_boundary') ?? null;
  }
  if (reason === 'transport_risk'
      || reason === 'transport_recovery_pending'
      || isTransportTrackReason(reason)) {
    return scenarioByName.get('transport_contamination') ?? null;
  }
  return null;
}

function primaryExplanation(result, reason, primitiveFacts, scenario) {
  if (scenario) {
    return {
      source: 'scenario',
      scenarioId: scenario.scenarioId,
      scenario: scenario.scenario,
      scenarioLabel: scenarioChineseLabel(scenario.scenario),
      confidence: scenario.confidence,
      action: scenario.action,
      actionLabel: scenarioActionChineseLabel(scenario.action),
      localRebuild: scenario.localRebuild,
      localRebuildLabel: localRebuildChineseLabel(scenario.localRebuild),
      rawRange: scenario.rawRange,
      summary: scenarioExplanationSummary(scenario)
    };
  }
  return {
    source: 'primitive',
    result,
    reason,
    facts: primitiveFacts.slice(0, 6),
    summary: primitiveExplanationSummary(result, reason, primitiveFacts)
  };
}

function primitiveFactsForPoint(point) {
  return primitiveFactsForDecision({
    intakeResult: point.result === 'intake_rejected' ? 'rejected' : 'accepted',
    intakeReason: point.result === 'intake_rejected' ? point.reason : null,
    horizontalResult: point.result,
    horizontalReason: point.reason,
    activityState: point.activityState || 'unknown',
    boundaryState: point.boundaryState || 'none',
    entersTrustedGpx: point.entersTrustedGpx === true,
    countsDistance: point.countsDistance === true,
    countsMovingTime: point.countsMovingTime === true,
    gnssAltitudeResult: point.gnssAltitudeResult || 'unavailable',
    gnssAltitudeReason: point.gnssAltitudeReason || null
  });
}

function primitiveFactsForDecision(decision) {
  const facts = [];
  facts.push(decision.intakeResult === 'rejected' ? 'sample_invalid' : 'sample_valid');
  if (decision.intakeReason) facts.push(`intake_${decision.intakeReason}`);
  facts.push(horizontalPrimitiveFact(decision.horizontalResult));
  facts.push(...reasonPrimitiveFacts(decision.horizontalReason));
  if (decision.activityState && decision.activityState !== 'unknown') {
    facts.push(`activity_${decision.activityState}`);
  }
  if (decision.boundaryState && decision.boundaryState !== 'none') {
    facts.push(`boundary_${decision.boundaryState}`);
  }
  facts.push(decision.entersTrustedGpx ? 'trusted_gpx_included' : 'trusted_gpx_excluded');
  facts.push(decision.countsDistance ? 'distance_counted' : 'distance_suspended');
  facts.push(decision.countsMovingTime ? 'moving_time_counted' : 'moving_time_suspended');
  facts.push(`gnss_altitude_${decision.gnssAltitudeResult || 'unavailable'}`);
  if (decision.gnssAltitudeReason) facts.push(`gnss_altitude_${decision.gnssAltitudeReason}`);
  return uniqueStrings(facts.filter(Boolean));
}

function horizontalPrimitiveFact(result) {
  if (result === 'anchor' || result === 'accept') return 'horizontal_trusted';
  if (result === 'weak') return 'horizontal_weak';
  if (result === 'reject') return 'horizontal_rejected';
  if (result === 'intake_rejected') return 'horizontal_unavailable';
  return 'horizontal_unknown';
}

function reasonPrimitiveFacts(reason) {
  switch (reason) {
    case 'first_fix_good':
    case 'first_fix_relaxed':
      return ['start_anchor', 'horizontal_accuracy_usable'];
    case 'moving_good_fix':
      return ['movement_continuity'];
    case 'motion_supported_low_speed':
      return ['low_speed_movement', 'motion_supported'];
    case 'continuity_rescue_low_accuracy':
      return ['horizontal_accuracy_weak', 'continuity_supported'];
    case 'position_snap_recovery_anchor':
      return ['position_snap_recovery', 'boundary_reset'];
    case 'weak_horizontal_accuracy':
      return ['horizontal_accuracy_weak'];
    case 'implied_speed_unconfirmed_by_reported_speed':
      return ['speed_implausible', 'reported_speed_not_transport'];
    case 'implied_speed_too_high':
      return ['speed_implausible'];
    case 'gap_recovery':
      return ['continuity_gap', 'boundary_reset'];
    case 'gap_recovery_pending':
      return ['continuity_gap', 'recovery_unstable'];
    case 'transport_risk':
    case 'transport_recovery_pending':
    case 'recovery_transport_suspected_kept':
    case 'transport_suspected_kept':
      return ['transport_risk'];
    case 'stationary_anchor':
    case 'stationary_anchor_redundant':
    case 'stationary_cloud_jitter':
      return ['stationary_cloud'];
    case 'stationary_session_anchor':
      return ['stationary_session'];
    case 'stationary_drift_anchor':
      return ['stationary_drift'];
    case 'weak_recovery_shape_anchor':
      return ['weak_recovery_shape'];
    default:
      if (String(reason || '').startsWith('round_trip_interwoven_')) {
        return ['round_trip_interwoven'];
      }
      if (String(reason || '').startsWith('interwoven_corridor_')) {
        return ['interwoven_corridor'];
      }
      if (String(reason || '').startsWith('dense_main_route_')) {
        return ['dense_main_route'];
      }
      return reason ? [`reason_${reason}`] : [];
  }
}

function scenarioExplanationSummary(scenario) {
  switch (scenario.scenario) {
    case 'weak_recovery_endpoint':
      return '长 GAP 后弱点云被识别为可保留形状端点，局部重建为零距离锚点。';
    case 'same_road_round_trip':
      return '同一路往返点云交织，局部重建为中心线并保留端点。';
    case 'closed_loop_round_trip':
      return '轨迹路径较长但首尾接近，识别为闭合往返/回环片段。';
    case 'round_trip_line':
      return '往返线形被保守抽稀，保留起点、折返点和终点语义。';
    case 'dense_area_intent':
      return `密集区先判断为 ${scenario.evidence?.intent || 'unknown'}，再调度局部 settlement。`;
    case 'enclosed_gap_cluster':
      return '小范围内多次 GAP 恢复和静止锚点聚集，识别为山洞/室内类遮挡片段。';
    case 'enclosed_loop_cluster_settlement':
      return '遮挡聚集叠加闭合往返时，低速碎点并入锚点，避免形成额外折返距离。';
    case 'dense_main_route_settlement':
      return '定位点密集但存在明确前进方向时，先抽出主路线骨架，再让局部情景在骨架周围修复。';
    case 'position_snap_recovery':
      return '定位短时跳变后恢复到稳定位置，恢复锚点重置 delta，避免从跳变前位置硬桥接。';
    case 'stationary_session_collapse':
      return '整段 session 近似静止，压缩为一个代表锚点。';
    case 'stationary_drift_collapse':
      return '停留漂移云被压缩为一个不计距锚点。';
    case 'rest_photo_micro_move':
      return '短时间小范围来回挪动，识别为休息/拍照/找路类微移动。';
    case 'gap_recovery_boundary':
      return 'GAP 后恢复点作为边界重置，距离和运动时间为零。';
    case 'transport_contamination':
      return '疑似交通工具或高速污染被排除在徒步真值之外。';
    default:
      return `${scenario.scenario} 场景解释`;
  }
}

function primitiveExplanationSummary(result, reason, primitiveFacts) {
  if (primitiveFacts.includes('distance_counted')) {
    return '基础内核判定为可计入徒步距离的可信移动点。';
  }
  if (primitiveFacts.includes('trusted_gpx_included')) {
    return '基础内核判定为可信轨迹点，但当前点不累计运动指标。';
  }
  if (result === 'weak') return '基础内核判定为弱证据，仅保留诊断。';
  if (result === 'reject') return '基础内核判定为不可入轨证据，仅保留诊断。';
  if (result === 'intake_rejected') return '入口合法性校验未通过，仅保留 raw 证据。';
  return `基础内核 reason=${reason || '-'}。`;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function chooseSelectedAscent(stats) {
  if (stats.barometerTotalAscentMeters >= 0 && stats.barometerAscentConfidence !== 'none') {
    return {
      source: 'BAROMETER',
      totalAscentMeters: stats.barometerTotalAscentMeters,
      confidence: stats.barometerAscentConfidence,
      reason: 'barometer_primary'
    };
  }
  if (stats.locationAltitudeTotalAscentMeters >= 0
      && stats.locationAltitudeAscentConfidence !== 'none') {
    return {
      source: 'GNSS',
      totalAscentMeters: stats.locationAltitudeTotalAscentMeters,
      confidence: stats.locationAltitudeAscentConfidence,
      reason: 'gnss_altitude_fallback'
    };
  }
  return {
    source: 'NONE',
    totalAscentMeters: null,
    confidence: 'none',
    reason: 'ascent_evidence_unavailable'
  };
}

function excludedPoint(rawPoint, result, reason, epoch, decision, extras = {}) {
  return {
    rawPointId: rawPoint.rawPointId,
    result,
    reason,
    lat: rawPoint.lat,
    lng: rawPoint.lng,
    accuracy: rawPoint.accuracy,
    elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
    timeMillis: rawPoint.timeMillis,
    distanceDeltaMeters: decision?.distanceDeltaMeters ?? 0,
    movingTimeDeltaSeconds: decision?.movingTimeDeltaSeconds ?? 0,
    samplingEpochId: epoch?.epochId ?? rawPoint.samplingEpochId ?? null,
    decision,
    ...extras
  };
}

function rawPointDecision(point, countsDistance, countsMovingTime, entersTrustedGpx) {
  return {
    rawPointId: point.sourceRawPointId ?? point.rawPointId,
    intakeResult: point.result === 'intake_rejected' ? 'rejected' : 'accepted',
    intakeReason: point.result === 'intake_rejected' ? point.reason : null,
    samplingResult: point.samplingEpochId === null ? 'unattributed' : 'attributed',
    horizontalResult: point.result,
    horizontalReason: point.reason,
    activityState: point.activityState || 'unknown',
    boundaryState: point.boundaryState || 'none',
    segmentId: point.segmentId ?? null,
    distanceDeltaMeters: point.distanceDeltaMeters ?? 0,
    movingTimeDeltaSeconds: point.movingTimeDeltaSeconds ?? 0,
    gnssAltitudeResult: point.gnssAltitudeResult || 'unavailable',
    gnssAltitudeReason: point.gnssAltitudeReason || null,
    entersTrustedGpx,
    countsDistance,
    countsMovingTime
  };
}

function buildFindings(product, evidence) {
  const findings = [];
  if (evidence.rawPoints.length === 0) {
    findings.push('缺少 raw_location，无法生成六层清洗轨迹');
  }
  if (product.excluded.intakeRejected.length > 0) {
    findings.push(`intake rejected ${product.excluded.intakeRejected.length} 个 raw_location`);
  }
  if (product.stats.gapCount > 0) {
    findings.push(`GAP recovery ${product.stats.gapCount} 次，已阻止跨 GAP 计距和计爬升`);
  }
  if (product.stats.transportCount > 0) {
    findings.push(`transport risk ${product.stats.transportCount} 个，未计入徒步距离/运动时间/爬升`);
  }
  if (product.stationarySessionCollapsed) {
    findings.push(`stationary session collapse，代表点 Raw#${product.stationarySessionCollapse?.representativeRawPointId ?? '-'}`);
  }
  if (product.dwellDriftCollapse?.collapsedCloudCount > 0) {
    findings.push(`stationary drift collapse ${product.dwellDriftCollapse.collapsedCloudCount} 段，已压缩停留漂移云`);
  }
  if (product.weakRecoveryShapePreserve?.anchorCount > 0) {
    findings.push(`weak recovery shape anchor ${product.weakRecoveryShapePreserve.anchorCount} 个，保留 GAP 后弱信号折返点`);
  }
  if (product.roundTripLineSimplify?.collapsedSpanCount > 0) {
    findings.push(`round-trip line simplify ${product.roundTripLineSimplify.collapsedSpanCount} 段，已压缩低速往返锯齿`);
  }
  if (product.interwovenCorridorSimplify?.collapsedSpanCount > 0) {
    findings.push(`interwoven corridor simplify ${product.interwovenCorridorSimplify.collapsedSpanCount} 段，按窄走廊交织误差抽稀`);
  }
  const denseIntentConflicts = product.denseIntentConflicts || [];
  if (denseIntentConflicts.length > 0) {
    const ranges = denseIntentConflicts.slice(0, 5)
      .map((scenario) =>
        `Raw#${scenario.rawRange.startRawPointId}-${scenario.rawRange.endRawPointId}`);
    findings.push(`dense intent conflict ${denseIntentConflicts.length} 段：局部休息/拍照微移动覆盖粗粒度 forward 判断（${ranges.join(', ')}）`);
  }
  const forwardSpineConflicts = product.forwardSpineConflicts || [];
  if (forwardSpineConflicts.length > 0) {
    const ranges = forwardSpineConflicts.slice(0, 5)
      .map((conflict) =>
        `Raw#${conflict.rawRange.startRawPointId}-${conflict.rawRange.endRawPointId}`);
    findings.push(`forward spine arbitration review ${forwardSpineConflicts.length} 段：多个保方向候选需要仲裁（${ranges.join(', ')}）`);
  }
  if (product.scenarios.length > 0) {
    const scenarioNames = [...new Set(product.scenarios.map((scenario) => scenario.scenario))];
    findings.push(`scenario recognizer ${product.scenarios.length} 个：${scenarioNames.join(', ')}`);
  }
  if (product.stats.selectedAscentSource === 'NONE') {
    findings.push('累计爬升证据不足，selected ascent = NONE');
  }
  if (findings.length === 0) {
    findings.push('六层清洗证据链完整');
  }
  return findings;
}

function findSamplingEpoch(rawPoint, samplingEpochs) {
  if (rawPoint.samplingEpochId !== null) {
    return samplingEpochs.find((epoch) => epoch.epochId === rawPoint.samplingEpochId) || null;
  }
  let active = null;
  for (const epoch of samplingEpochs) {
    if (epoch.startedElapsedRealtimeNanos <= rawPoint.elapsedRealtimeNanos) {
      active = epoch;
    } else {
      break;
    }
  }
  return active;
}

function isStillMotionWindow(event) {
  const accel = numberField(event, 'linearAccelerationRmsMps2')
    ?? numberField(event, 'accelerometerDynamicRmsMps2')
    ?? numberField(event, 'dynamicAccelRmsMps2')
    ?? 0;
  const gyro = numberField(event, 'gyroscopeRmsRadps') ?? 0;
  const steps = (numberField(event, 'stepCounterDelta') ?? numberField(event, 'stepDelta') ?? 0)
    + (numberField(event, 'stepDetectorCount') ?? 0);
  return accel <= 0.08 && gyro <= 0.03 && steps === 0;
}

function fixKey(rawPoint) {
  return [
    rawPoint.provider,
    rawPoint.elapsedRealtimeNanos,
    rawPoint.lat,
    rawPoint.lng,
    rawPoint.accuracy
  ].join('|');
}

function isDefaultConfig(config) {
  return Object.keys(DEFAULT_SIX_LAYER_TRACK_CONFIG).every((key) =>
    config[key] === DEFAULT_SIX_LAYER_TRACK_CONFIG[key]);
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function stationaryThreshold(rawPoint, config) {
  return Math.max(
    config.stationaryDistanceMeters,
    rawPoint.accuracy * config.stationaryAccuracyMultiplier
  );
}

function rawPathMeters(rawPoints) {
  let total = 0;
  for (let index = 1; index < rawPoints.length; index++) {
    total += distanceMeters(rawPoints[index - 1].lat, rawPoints[index - 1].lng,
      rawPoints[index].lat, rawPoints[index].lng);
  }
  return total;
}

function cloudRadiusMeters(rawPoints) {
  if (!Array.isArray(rawPoints) || rawPoints.length <= 1) return 0;
  const center = rawPoints.reduce((acc, point) => ({
    lat: acc.lat + point.lat,
    lng: acc.lng + point.lng
  }), { lat: 0, lng: 0 });
  center.lat /= rawPoints.length;
  center.lng /= rawPoints.length;
  const squared = rawPoints.reduce((sum, point) => {
    const distance = distanceMeters(center.lat, center.lng, point.lat, point.lng);
    return sum + distance * distance;
  }, 0);
  return Math.sqrt(squared / rawPoints.length);
}

function bboxDiagonalMeters(rawPoints) {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return 0;
  const minLat = Math.min(...rawPoints.map((point) => point.lat));
  const maxLat = Math.max(...rawPoints.map((point) => point.lat));
  const minLng = Math.min(...rawPoints.map((point) => point.lng));
  const maxLng = Math.max(...rawPoints.map((point) => point.lng));
  return distanceMeters(minLat, minLng, maxLat, maxLng);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lng2 - lng1);
  const a = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function elapsedSeconds(fromNanos, toNanos) {
  if (!Number.isFinite(fromNanos) || !Number.isFinite(toNanos)) return 0;
  return Math.max(0, (toNanos - fromNanos) / NANOS_PER_SECOND);
}

function numberField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) return null;
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function firstFinite(values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function lastFinite(values) {
  for (let index = values.length - 1; index >= 0; index--) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return null;
}
