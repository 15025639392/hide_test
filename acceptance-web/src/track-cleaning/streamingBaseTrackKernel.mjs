import { normalizeSixLayerTrackConfig } from './sixLayerTrackProduct.mjs';
import { createRecentMotionSummaryIndex, recentMotionStats } from './timeWindowIndex.mjs';

const EARTH_RADIUS_METERS = 6_371_000;
const START_TOLERANCE_NANOS = 1_000_000_000;
const MOTION_LOOKBACK_NANOS = 5_000_000_000;
const NANOS_PER_SECOND = 1_000_000_000;

export const STREAMING_BASE_TRACK_KERNEL_VERSION = 'streaming-base-kernel-v0';

export function createStreamingBaseTrackKernelState(overrides = {}) {
  const config = normalizeSixLayerTrackConfig(overrides.config);
  return {
    version: STREAMING_BASE_TRACK_KERNEL_VERSION,
    config,
    sessionContext: cloneObject(overrides.sessionContext) || {},
    samplingEpochs: cloneArray(overrides.samplingEpochs),
    motionWindows: cloneArray(overrides.motionWindows),
    track: cloneArray(overrides.track),
    excluded: {
      weak: cloneArray(overrides.excluded?.weak),
      rejected: cloneArray(overrides.excluded?.rejected),
      intakeRejected: cloneArray(overrides.excluded?.intakeRejected)
    },
    rawPointDecisions: cloneArray(overrides.rawPointDecisions),
    rawPointTimeline: cloneArray(overrides.rawPointTimeline),
    stats: createStats(overrides.stats),
    segmentId: finiteNumber(overrides.segmentId) ?? 1,
    trackPointId: finiteNumber(overrides.trackPointId) ?? 0,
    decisionId: finiteNumber(overrides.decisionId) ?? 0,
    previousTrustedTrackPoint: cloneObject(overrides.previousTrustedTrackPoint),
    inTransportMode: overrides.inTransportMode === true,
    lastTransportRawPoint: cloneObject(overrides.lastTransportRawPoint),
    lastGapRecoveryPendingRawPoint: cloneObject(overrides.lastGapRecoveryPendingRawPoint),
    recoveryCloud: cloneObject(overrides.recoveryCloud),
    stationaryCloud: cloneObject(overrides.stationaryCloud),
    lastLegalElapsedRealtimeNanos: finiteNumber(overrides.lastLegalElapsedRealtimeNanos),
    legalFixKeys: cloneArray(overrides.legalFixKeys),
    legalFixKeysEvicted: finiteNumber(overrides.legalFixKeysEvicted) ?? 0,
    rawPointTimelinePrunedBeforeRawPointId:
      finiteNumber(overrides.rawPointTimelinePrunedBeforeRawPointId),
    lastProcessedRawPointId: finiteNumber(overrides.lastProcessedRawPointId)
  };
}

export function advanceStreamingBaseTrackKernel(previousState = {}, eventsOrBatch = []) {
  const state = createStreamingBaseTrackKernelState(previousState);
  const events = Array.isArray(eventsOrBatch) ? eventsOrBatch : eventsOrBatch?.events || [];
  const next = {
    ...state,
    excluded: {
      weak: [...state.excluded.weak],
      rejected: [...state.excluded.rejected],
      intakeRejected: [...state.excluded.intakeRejected]
    },
    track: [...state.track],
    rawPointDecisions: [...state.rawPointDecisions],
    rawPointTimeline: [...state.rawPointTimeline],
    samplingEpochs: [...state.samplingEpochs],
    motionWindows: [...state.motionWindows],
    legalFixKeys: [...state.legalFixKeys],
    stats: { ...state.stats }
  };

  for (const event of events) {
    if (event?.event === 'session_metadata') {
      applySessionMetadata(next, event);
    } else if (event?.event === 'sampling_policy') {
      upsertSamplingEpoch(next, normalizeSamplingEpoch(event));
    } else if (isMotionWindowEvent(event)) {
      addMotionWindow(next, normalizeMotionWindow(event, state.config));
    } else if (isLocationEvidenceEvent(event)) {
      const rawPoint = normalizeRawPoint(event);
      if (rawPoint) processRawPoint(next, rawPoint);
    }
  }

  finalizeStreamingStats(next);
  return next;
}

// L3: retention margin below the committed cursor for the intermediate base
// buffers (track / rawPointDecisions / excluded). The real cleaned output is
// localRebuild.committedTrack, which is flushed before this prune runs, so
// committed base points are only still needed by (a) the next advance's
// recognizer scan window [cursor-64, head] and (b) localRebuild's next settled
// ranges — both of which sit within a small margin of the cursor because open
// scenario windows pin the cursor at their own start until they settle. The
// margin must therefore exceed the recognizer window (64); 128 keeps 2x
// headroom. Verified byte-identical on the real-output golden (committedTrack)
// down to retention=32 and against the full unit suite. Set L3_RETENTION=0 to
// disable (legacy: only rawPointTimeline pruned) for A/B verification.
const L3_RETENTION = process.env.L3_RETENTION !== undefined
  ? Number(process.env.L3_RETENTION)
  : 128;

// Bounded dedup window for legalFixKeys (device mode) — see streamingTrackEngine.
const DEVICE_FLUSH = process.env.DEVICE_FLUSH === '1'
  || process.env.DEVICE_FLUSH === 'true';
const DEVICE_DEDUP_WINDOW = Number(process.env.DEVICE_DEDUP_WINDOW) || 1024;

export function pruneStreamingBaseTrackKernelForSettlement(previousState = {}, settlementState = {}) {
  const state = createStreamingBaseTrackKernelState(previousState);
  const cursor = finiteNumber(settlementState?.committedCursorRawPointId);
  if (!Number.isFinite(cursor)) return state;
  const boundedFixKeys = DEVICE_FLUSH && state.legalFixKeys.length > DEVICE_DEDUP_WINDOW
    ? {
      keys: state.legalFixKeys.slice(-DEVICE_DEDUP_WINDOW),
      evicted: state.legalFixKeys.length - DEVICE_DEDUP_WINDOW
    }
    : { keys: state.legalFixKeys, evicted: 0 };
  const pruned = {
    ...state,
    legalFixKeys: boundedFixKeys.keys,
    legalFixKeysEvicted: (finiteNumber(state.legalFixKeysEvicted) ?? 0) + boundedFixKeys.evicted,
    rawPointTimeline: state.rawPointTimeline.filter((point) => {
      const rawPointId = finiteNumber(point?.rawPointId);
      return Number.isFinite(rawPointId) && rawPointId >= cursor;
    }),
    rawPointTimelinePrunedBeforeRawPointId: cursor
  };
  if (!(L3_RETENTION > 0)) return pruned;

  const floor = cursor - L3_RETENTION;
  const keepBySource = (point) => {
    const id = finiteNumber(point?.sourceRawPointId ?? point?.rawPointId);
    return !Number.isFinite(id) || id >= floor;
  };
  return {
    ...pruned,
    track: pruned.track.filter(keepBySource),
    rawPointDecisions: pruned.rawPointDecisions.filter((decision) => {
      const id = finiteNumber(decision?.rawPointId);
      return !Number.isFinite(id) || id >= floor;
    }),
    excluded: {
      weak: pruned.excluded.weak.filter(keepBySource),
      rejected: pruned.excluded.rejected.filter(keepBySource),
      intakeRejected: pruned.excluded.intakeRejected.filter(keepBySource)
    }
  };
}

function processRawPoint(state, rawPoint) {
  state.stats.rawPointCount++;
  state.lastProcessedRawPointId = rawPoint.rawPointId;
  recordRawPointTimeline(state, rawPoint);
  const epoch = findSamplingEpoch(rawPoint, state.samplingEpochs);
  const intake = intakeRawPoint(rawPoint, epoch, state);
  if (!intake.accepted) {
    const point = excludedPoint(rawPoint, 'intake_rejected', intake.reason, epoch, null, {
      activityState: 'unknown',
      boundaryState: 'none'
    });
    state.excluded.intakeRejected.push(point);
    state.rawPointDecisions.push(rawPointDecision(point, false, false, false));
    return;
  }

  state.lastLegalElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
  state.legalFixKeys.push(fixKey(rawPoint));
  const motion = classifyActivity(rawPoint, state.motionWindows);
  pruneMotionWindows(state, rawPoint.elapsedRealtimeNanos);
  const decision = decideHorizontal(rawPoint, motion, state, state.config);
  const settlement = settleDecision(decision);

  if (decision.result === 'anchor' || decision.result === 'accept') {
    if (decision.startsNewSegment && state.previousTrustedTrackPoint) {
      state.segmentId++;
    }
    const targetPoint = {
      trackPointId: ++state.trackPointId,
      sourceRawPointId: rawPoint.rawPointId,
      recomputedDecisionId: ++state.decisionId,
      segmentId: state.segmentId,
      lat: decision.lat,
      lng: decision.lng,
      altitude: rawPoint.altitude,
      verticalAccuracy: rawPoint.verticalAccuracy,
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
      countsDistance: settlement.countsDistance,
      countsMovingTime: settlement.countsMovingTime,
      entersTrustedGpx: settlement.entersTrustedGpx
    };
    state.track.push(targetPoint);
    state.rawPointDecisions.push(rawPointDecision(targetPoint,
      settlement.countsDistance, settlement.countsMovingTime, settlement.entersTrustedGpx));
    state.previousTrustedTrackPoint = targetPoint;
    if (decision.reason === 'gap_recovery') state.stats.gapCount++;
    state.inTransportMode = false;
    state.lastTransportRawPoint = null;
    state.lastGapRecoveryPendingRawPoint = null;
  } else {
    const bucket = decision.result === 'weak' ? state.excluded.weak : state.excluded.rejected;
    const point = excludedPoint(rawPoint, decision.result, decision.reason, epoch, decision, {
      activityState: decision.activityState,
      boundaryState: decision.boundaryState
    });
    bucket.push(point);
    state.rawPointDecisions.push(rawPointDecision(point, false, false, false));
    if (decision.reason === 'transport_risk') {
      state.inTransportMode = true;
      state.lastTransportRawPoint = rawPoint;
    }
    if (decision.reason === 'gap_recovery_pending') {
      state.lastGapRecoveryPendingRawPoint = rawPoint;
    }
  }
}

function intakeRawPoint(rawPoint, epoch, state) {
  const config = state.config;
  if (!rawPoint.provider) return rejected('missing_position_source');
  if (rawPoint.isMock) return rejected('mock_location');
  if (!validCoordinate(rawPoint.lat, rawPoint.lng)) return rejected('invalid_coordinate');
  if (!Number.isFinite(rawPoint.elapsedRealtimeNanos)) {
    return rejected('missing_fix_elapsed_realtime');
  }
  if (Number.isFinite(state.stats.recordStartElapsedRealtimeNanos)
      && rawPoint.elapsedRealtimeNanos
        < state.stats.recordStartElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return rejected('before_record_start');
  }
  if (!Number.isFinite(rawPoint.accuracy) || rawPoint.accuracy < 0) {
    return rejected('invalid_accuracy');
  }
  if (state.legalFixKeys.includes(fixKey(rawPoint))) return rejected('duplicate_fix');
  if (Number.isFinite(state.lastLegalElapsedRealtimeNanos)
      && rawPoint.elapsedRealtimeNanos <= state.lastLegalElapsedRealtimeNanos) {
    return rejected('out_of_order_fix');
  }
  if (rawPoint.samplingEpochId !== null && !epoch) {
    return rejected('sampling_epoch_mismatch');
  }
  if (epoch
      && rawPoint.elapsedRealtimeNanos
        < epoch.startedElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
    return rejected('sampling_epoch_mismatch');
  }
  return { accepted: true, reason: null };
}

function decideHorizontal(rawPoint, motion, state, config) {
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

  if (isGap) {
    return decideGapRecovery(rawPoint, previous, motion, state, distance, config);
  }

  if (isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config,
    stationaryThreshold(rawPoint, config))) {
    return trustedDecision(rawPoint, 'accept', 'transport_suspected_kept', motion, {
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

  const thresholdMeters = stationaryThreshold(rawPoint, config);
  if (distance <= thresholdMeters) {
    if (motion.state === 'walking' && distance >= config.slowMovementMinDistanceMeters) {
      return trustedDecision(rawPoint, 'accept', 'motion_supported_low_speed', motion, {
        distanceDeltaMeters: distance,
        movingTimeDeltaSeconds: Math.max(0, dtSeconds),
        cloudType: 'MOVING_CLOUD'
      });
    }
    return decideStationaryCloud(rawPoint, previous, motion, state, config, thresholdMeters);
  }

  return trustedDecision(rawPoint, 'accept', 'moving_good_fix', motion, {
    distanceDeltaMeters: distance,
    movingTimeDeltaSeconds: Math.max(0, dtSeconds),
    cloudType: 'MOVING_CLOUD'
  });
}

function decideStationaryCloud(rawPoint, previous, motion, state, config, thresholdMeters) {
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
  if (!gapRecoveryContinuityCompatible(rawPoint, previous, motion, distance, config)) {
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

function gapRecoveryContinuityCompatible(rawPoint, previous, motion, distance, config) {
  if (!previous
      || !validCoordinate(previous.lat, previous.lng)
      || !validCoordinate(rawPoint.lat, rawPoint.lng)) {
    return false;
  }
  const dtSeconds = elapsedSeconds(previous.elapsedRealtimeNanos, rawPoint.elapsedRealtimeNanos);
  if (dtSeconds <= 0) return false;
  const impliedSpeed = distance / dtSeconds;
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  if (motion.state === 'still' && distance > config.stationaryDistanceMeters * 2) return false;
  if (distance < config.stationaryDistanceMeters
      && motion.state !== 'walking'
      && impliedSpeed > config.continuityRescueMaxSpeedMetersPerSecond) return false;
  if (reportedSpeed !== null && reportedSpeed > config.impossibleSpeedMetersPerSecond) return false;
  return true;
}

function isLowAccuracyRescuePoint(rawPoint, previous, distance, impliedSpeed, config) {
  return previous
    && rawPoint.accuracy <= config.lowAccuracyRescueMaxAccuracyMeters
    && distance >= config.lowAccuracyRescueMinDistanceMeters
    && impliedSpeed <= config.continuityRescueMaxSpeedMetersPerSecond;
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

function settleDecision(decision) {
  const trusted = decision.result === 'anchor' || decision.result === 'accept';
  const transport = decision.reason === 'transport_suspected_kept'
    || decision.reason === 'recovery_transport_suspected_kept';
  const countsDistance = trusted && decision.distanceDeltaMeters > 0
    && decision.reason !== 'gap_recovery'
    && decision.reason !== 'stationary_anchor'
    && decision.reason !== 'stationary_drift_anchor'
    && !transport;
  return {
    entersTrustedGpx: trusted,
    countsDistance,
    countsMovingTime: countsDistance && decision.movingTimeDeltaSeconds > 0,
    countsAscentWindow: false
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
    gnssAltitudeResult: 'unavailable',
    gnssAltitudeReason: null,
    entersTrustedGpx,
    countsDistance,
    countsMovingTime
  };
}

function excludedPoint(rawPoint, result, reason, epoch, decision, extras = {}) {
  return {
    rawPointId: rawPoint.rawPointId,
    result,
    reason,
    samplingEpochId: rawPoint.samplingEpochId,
    samplingState: epoch?.state || '',
    lat: rawPoint.lat,
    lng: rawPoint.lng,
    accuracy: rawPoint.accuracy,
    altitude: rawPoint.altitude,
    verticalAccuracy: rawPoint.verticalAccuracy,
    speed: rawPoint.speed,
    bearing: rawPoint.bearing,
    elapsedRealtimeNanos: rawPoint.elapsedRealtimeNanos,
    timeMillis: rawPoint.timeMillis,
    distanceDeltaMeters: decision?.distanceDeltaMeters ?? 0,
    movingTimeDeltaSeconds: decision?.movingTimeDeltaSeconds ?? 0,
    activityState: extras.activityState || decision?.activityState || 'unknown',
    boundaryState: extras.boundaryState || decision?.boundaryState || 'none'
  };
}

function finalizeStreamingStats(state) {
  state.stats.trustedPointCount = state.track.length;
  state.stats.weakPointCount = state.excluded.weak.length;
  state.stats.rejectedPointCount = state.excluded.rejected.length;
  state.stats.intakeRejectedPointCount = state.excluded.intakeRejected.length;
  const transportSummary = suspectedTransportSummary(state);
  state.stats.transportCount = transportSummary.pointCount;
  state.stats.suspectedTransportPointCount = transportSummary.pointCount;
  state.stats.suspectedDistanceMeters = transportSummary.distanceMeters;
  state.stats.suspectedTransportDistanceMeters = transportSummary.distanceMeters;
  state.stats.suspectedTransportDurationSeconds = transportSummary.durationSeconds;
  state.stats.suspectedTransportSegmentCount = transportSummary.segmentCount;
  state.stats.suspectedTransportAverageSpeedMetersPerSecond =
    transportSummary.averageSpeedMetersPerSecond;
  state.stats.segmentCount = state.track.length === 0
    ? 0
    : new Set(state.track.map((point) => point.segmentId)).size;
  state.stats.totalDistanceMeters = state.track.reduce((sum, point) =>
    sum + (point.countsDistance ? point.distanceDeltaMeters : 0), 0);
  state.stats.routeDistanceMeters = state.stats.totalDistanceMeters;
  state.stats.movingTimeSeconds = state.track.reduce((sum, point) =>
    sum + (point.countsMovingTime ? point.movingTimeDeltaSeconds : 0), 0);
}

function normalizeRawPoint(event) {
  const lat = numberField(event, 'lat');
  const lng = numberField(event, 'lng');
  if (lat === null || lng === null) return null;
  return {
    ...event,
    rawPointId: numberField(event, 'rawPointId') ?? numberField(event, 'sampleId') ?? null,
    provider: event.provider ?? event.source ?? event.sourceKind ?? event.trustClass ?? '',
    lat,
    lng,
    accuracy: numberField(event, 'accuracy')
      ?? numberField(event, 'horizontalAccuracyMeters'),
    altitude: numberField(event, 'altitude')
      ?? numberField(event, 'altitudeMeters'),
    verticalAccuracy: numberField(event, 'verticalAccuracy')
      ?? numberField(event, 'verticalAccuracyMeters'),
    speed: numberField(event, 'speed')
      ?? numberField(event, 'speedMetersPerSecond'),
    bearing: numberField(event, 'bearing')
      ?? numberField(event, 'bearingDegrees'),
    elapsedRealtimeNanos: numberField(event, 'elapsedRealtimeNanos')
      ?? numberField(event, 'fixElapsedRealtimeNanos'),
    timeMillis: numberField(event, 'timeMillis')
      ?? numberField(event, 'wallTimeMillis'),
    samplingEpochId: numberField(event, 'samplingEpochId'),
    callbackReceivedElapsedRealtimeNanos: numberField(event, 'callbackReceivedElapsedRealtimeNanos')
      ?? numberField(event, 'receivedElapsedRealtimeNanos'),
    callbackDelayNanos: numberField(event, 'callbackDelayNanos'),
    isMock: event.isMock === true || event.mock === true || event.isFromMockProvider === true
  };
}

function recordRawPointTimeline(state, rawPoint) {
  const rawPointId = finiteNumber(rawPoint.rawPointId);
  const elapsedRealtimeNanos = finiteNumber(rawPoint.elapsedRealtimeNanos);
  if (!Number.isFinite(rawPointId) || !Number.isFinite(elapsedRealtimeNanos)) return;
  if (state.rawPointTimeline.some((point) => point.rawPointId === rawPointId)) return;
  state.rawPointTimeline.push({ rawPointId, elapsedRealtimeNanos });
  state.rawPointTimeline.sort((a, b) => a.rawPointId - b.rawPointId);
}

function normalizeSamplingEpoch(event) {
  return {
    epochId: numberField(event, 'samplingEpochId') ?? numberField(event, 'epochId') ?? null,
    state: String(event.state || event.samplingState || ''),
    startedElapsedRealtimeNanos: numberField(event, 'samplingEpochStartedElapsedRealtimeNanos')
      ?? numberField(event, 'startedElapsedRealtimeNanos')
      ?? numberField(event, 'locationRequestRegisteredElapsedRealtimeNanos')
      ?? numberField(event, 'eventElapsedRealtimeNanos')
      ?? 0,
    requestedMinTimeMs: numberField(event, 'locationRequestMinTimeMs')
      ?? numberField(event, 'requestedMinTimeMs'),
    requestedMinDistanceMeters: numberField(event, 'locationRequestMinDistanceMeters')
      ?? numberField(event, 'requestedMinDistanceMeters')
  };
}

function normalizeMotionWindow(event, config) {
  const start = numberField(event, 'startElapsedRealtimeNanos')
    ?? numberField(event, 'firstElapsedRealtimeNanos');
  const end = numberField(event, 'endElapsedRealtimeNanos')
    ?? numberField(event, 'lastElapsedRealtimeNanos');
  const normalized = {
    ...event,
    firstElapsedRealtimeNanos: start,
    lastElapsedRealtimeNanos: end,
    deviceStill: isStillMotionWindow(event, config),
    isDeviceStill: isStillMotionWindow(event, config),
    dynamicAccelRmsMps2: numberField(event, 'linearAccelerationRmsMps2')
      ?? numberField(event, 'accelerometerDynamicRmsMps2')
      ?? numberField(event, 'dynamicAccelRmsMps2'),
    gyroscopeRmsRadps: numberField(event, 'gyroscopeRmsRadps'),
    stepDelta: numberField(event, 'stepCounterDelta') ?? numberField(event, 'stepDelta') ?? 0,
    stepDetectorCount: numberField(event, 'stepDetectorCount') ?? 0
  };
  return Number.isFinite(start) && Number.isFinite(end) && start <= end
    ? normalized
    : null;
}

function addMotionWindow(state, motionWindow) {
  if (!motionWindow) return;
  state.motionWindows.push(motionWindow);
}

function pruneMotionWindows(state, elapsedRealtimeNanos) {
  const elapsed = finiteNumber(elapsedRealtimeNanos);
  if (elapsed === null) return;
  const cutoff = elapsed - MOTION_LOOKBACK_NANOS;
  state.motionWindows = state.motionWindows.filter((window) =>
    !Number.isFinite(window.lastElapsedRealtimeNanos)
      || window.lastElapsedRealtimeNanos >= cutoff);
}

function upsertSamplingEpoch(state, epoch) {
  state.samplingEpochs = state.samplingEpochs
    .filter((item) => item.epochId !== epoch.epochId)
    .concat(epoch)
    .sort((a, b) => a.startedElapsedRealtimeNanos - b.startedElapsedRealtimeNanos);
}

function applySessionMetadata(state, event) {
  state.sessionContext = { ...state.sessionContext, ...event };
  const start = numberField(event, 'recordStartElapsedRealtimeNanos')
    ?? numberField(event, 'createdElapsedRealtimeNanos');
  if (Number.isFinite(start)) state.stats.recordStartElapsedRealtimeNanos = start;
  const end = numberField(event, 'recordEndElapsedRealtimeNanos')
    ?? numberField(event, 'completedElapsedRealtimeNanos')
    ?? numberField(event, 'endedElapsedRealtimeNanos')
    ?? numberField(event, 'stoppedElapsedRealtimeNanos');
  if (Number.isFinite(end)) state.stats.recordEndElapsedRealtimeNanos = end;
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

function isLocationEvidenceEvent(event) {
  return event?.event === 'raw_location' || event?.event === 'location_sample';
}

function isMotionWindowEvent(event) {
  return event?.event === 'device_motion_window' || event?.event === 'motion_window';
}

function classifyActivity(rawPoint, motionWindows) {
  const motionIndex = createRecentMotionSummaryIndex(motionWindows, MOTION_LOOKBACK_NANOS);
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

function createStats(overrides = {}) {
  return {
    routeDistanceMeters: finiteNumber(overrides.routeDistanceMeters) ?? 0,
    totalDistanceMeters: finiteNumber(overrides.totalDistanceMeters) ?? 0,
    suspectedDistanceMeters: finiteNumber(overrides.suspectedDistanceMeters) ?? 0,
    suspectedTransportDistanceMeters:
      finiteNumber(overrides.suspectedTransportDistanceMeters) ?? 0,
    suspectedTransportDurationSeconds:
      finiteNumber(overrides.suspectedTransportDurationSeconds) ?? 0,
    suspectedTransportSegmentCount:
      finiteNumber(overrides.suspectedTransportSegmentCount) ?? 0,
    suspectedTransportAverageSpeedMetersPerSecond:
      finiteNumber(overrides.suspectedTransportAverageSpeedMetersPerSecond),
    movingTimeSeconds: finiteNumber(overrides.movingTimeSeconds) ?? 0,
    recordStartElapsedRealtimeNanos: finiteNumber(overrides.recordStartElapsedRealtimeNanos),
    recordEndElapsedRealtimeNanos: finiteNumber(overrides.recordEndElapsedRealtimeNanos),
    segmentCount: finiteNumber(overrides.segmentCount) ?? 0,
    gapCount: finiteNumber(overrides.gapCount) ?? 0,
    transportCount: finiteNumber(overrides.transportCount) ?? 0,
    suspectedTransportPointCount:
      finiteNumber(overrides.suspectedTransportPointCount) ?? 0,
    rawPointCount: finiteNumber(overrides.rawPointCount) ?? 0,
    trustedPointCount: finiteNumber(overrides.trustedPointCount) ?? 0,
    weakPointCount: finiteNumber(overrides.weakPointCount) ?? 0,
    rejectedPointCount: finiteNumber(overrides.rejectedPointCount) ?? 0,
    intakeRejectedPointCount: finiteNumber(overrides.intakeRejectedPointCount) ?? 0
  };
}

function isRecoveryFastPath(rawPoint, distance, thresholdMeters, config) {
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  return distance >= thresholdMeters
    && rawPoint.accuracy <= config.recoveryFastPathAccuracyMeters
    && (reportedSpeed === null || reportedSpeed <= config.recoveryFastPathMaxSpeedMetersPerSecond);
}

function decideTransportRecovery(rawPoint, motion, state, config) {
  const reference = state.lastTransportRawPoint || state.previousTrustedTrackPoint;
  if (!reference) {
    state.inTransportMode = false;
    return decideHorizontal(rawPoint, motion, state, config);
  }
  const distance = distanceMeters(reference.lat, reference.lng, rawPoint.lat, rawPoint.lng);
  const dtSeconds = elapsedSeconds(reference.elapsedRealtimeNanos, rawPoint.elapsedRealtimeNanos);
  const impliedSpeed = dtSeconds > 0 ? distance / dtSeconds : Infinity;
  const reportedSpeed = Number.isFinite(rawPoint.speed) ? rawPoint.speed : null;
  const stillTransport = isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config,
    stationaryThreshold(rawPoint, config));

  if (stillTransport) {
    return trustedDecision(rawPoint, 'accept', 'transport_suspected_kept', motion, {
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
  return isTransportRiskDistance(distance, distance / dtSeconds, reportedSpeed, config,
    stationaryThreshold(rawPoint, config));
}

function isTransportTrackReason(reason) {
  return reason === 'recovery_transport_suspected_kept'
    || reason === 'transport_suspected_kept';
}

function isSuspectedTransportReason(reason) {
  return reason === 'transport_risk'
    || reason === 'transport_recovery_pending'
    || isTransportTrackReason(reason);
}

function suspectedTransportSummary(state) {
  const rejected = state.excluded.rejected
    .filter((point) => point.reason === 'transport_risk');
  const kept = state.track.filter((point) => isTransportTrackReason(point.reason));
  const countedPoints = [...rejected, ...kept];
  const distanceMeters = countedPoints.reduce((sum, point) =>
    sum + Math.max(0, Number(point.distanceDeltaMeters) || 0), 0);
  const durationSeconds = countedPoints.reduce((sum, point) =>
    sum + Math.max(0, Number(point.movingTimeDeltaSeconds) || 0), 0);
  return {
    pointCount: countedPoints.length,
    segmentCount: countSuspectedTransportSegments(state.rawPointDecisions),
    distanceMeters,
    durationSeconds,
    averageSpeedMetersPerSecond: durationSeconds > 0
      ? distanceMeters / durationSeconds
      : null
  };
}

function countSuspectedTransportSegments(rawPointDecisions) {
  let segmentCount = 0;
  let inTransportSegment = false;
  const decisions = [...(rawPointDecisions || [])]
    .sort((left, right) => left.rawPointId - right.rawPointId);
  for (const decision of decisions) {
    const suspectedTransport = isSuspectedTransportReason(decision.horizontalReason);
    if (suspectedTransport && !inTransportSegment) segmentCount++;
    inTransportSegment = suspectedTransport;
  }
  return segmentCount;
}

function isTransportRiskDistance(distance, impliedSpeed, reportedSpeed, config,
  reportedSpeedMinDistance = config.stationaryDistanceMeters) {
  if (reportedSpeed !== null) {
    if (reportedSpeed < config.transportSpeedMetersPerSecond) return false;
    return distance >= config.transportMinDistanceMeters
      || distance >= reportedSpeedMinDistance;
  }
  return distance >= config.transportMinDistanceMeters
    && impliedSpeed >= config.transportSpeedMetersPerSecond;
}

function isImpliedTransportUnconfirmedByReportedSpeed(distance, impliedSpeed, reportedSpeed,
  config) {
  return distance >= config.transportMinDistanceMeters
    && impliedSpeed >= config.transportSpeedMetersPerSecond
    && reportedSpeed !== null
    && reportedSpeed < config.transportSpeedMetersPerSecond;
}

function stationaryThreshold(rawPoint, config) {
  return Math.max(
    config.stationaryDistanceMeters,
    rawPoint.accuracy * config.stationaryAccuracyMultiplier
  );
}

function rejected(reason) {
  return { accepted: false, reason };
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

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isStillMotionWindow(event, config) {
  const accel = numberField(event, 'linearAccelerationRmsMps2')
    ?? numberField(event, 'accelerometerDynamicRmsMps2')
    ?? numberField(event, 'dynamicAccelRmsMps2')
    ?? 0;
  const gyro = numberField(event, 'gyroscopeRmsRadps') ?? 0;
  const steps = (numberField(event, 'stepCounterDelta') ?? numberField(event, 'stepDelta') ?? 0)
    + (numberField(event, 'stepDetectorCount') ?? 0);
  return accel <= config.stillMotionMaxAccelRms && gyro <= config.stillMotionMaxGyroRms && steps === 0;
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

function elapsedSeconds(fromNanos, toNanos) {
  if (!Number.isFinite(fromNanos) || !Number.isFinite(toNanos)) return 0;
  return Math.max(0, (toNanos - fromNanos) / NANOS_PER_SECOND);
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function numberField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) return null;
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => structuredCloneFallback(item)) : [];
}

function cloneObject(value) {
  return value && typeof value === 'object' ? structuredCloneFallback(value) : null;
}

// L1a: existing state elements are treated as immutable across advance()
// (advance only appends new elements / reassigns fields on a fresh `next`),
// so per-advance deep cloning is redundant. Share element references; the
// containing array is still freshly created by cloneArray's map(). This drops
// the JSON.parse(JSON.stringify) serialization cost that dominated each advance.
function structuredCloneFallback(value) {
  return value;
}
