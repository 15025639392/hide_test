const GPS_PROVIDER = 'gps';
const START_TOLERANCE_NANOS = 1_000_000_000;
const FIRST_FIX_GOOD_ACCURACY_METERS = 20;
const MOTION_WINDOW_NANOS = 5_000_000_000;
const EARTH_RADIUS_METERS = 6_371_000;

export const DEFAULT_TARGET_PRODUCT_CONFIG = Object.freeze({
  maxIntakeAccuracyMeters: 80,
  weakCloudAccuracyMeters: 30,
  gapSeconds: 120,
  stationaryDistanceMeters: 5,
  stationaryAccuracyMultiplier: 1.5,
  impossibleSpeedMetersPerSecond: 12,
  transportSpeedMetersPerSecond: 3.5,
  transportMinDistanceMeters: 20,
  cloudTemporalDecaySeconds: 20,
  collapseStationarySession: true,
  stationarySessionStillRatio: 0.95,
  stationarySessionAnchorRatio: 0.8
});

const DEFAULT_CLOUD_RULES = {
  START_CLOUD: { minSamples: 1, minWeight: 0.03, minRadius: 0, accuracyMultiplier: 1 },
  MOVING_CLOUD: { minSamples: 1, minWeight: 0.03, minRadius: 15, accuracyMultiplier: 1.5 },
  STATIONARY_CLOUD: { minSamples: 2, minWeight: 0.08, minRadius: 8, accuracyMultiplier: 1.2 },
  RECOVERY_CLOUD: { minSamples: 2, minWeight: 0.08, minRadius: 12, accuracyMultiplier: 1.5 }
};

export function buildTargetTrackProduct(modelOrEvents, options = {}) {
  const config = normalizeConfig(options.config);
  const events = Array.isArray(modelOrEvents) ? modelOrEvents : modelOrEvents?.events || [];
  const sourceFilePath = Array.isArray(modelOrEvents) ? options.sourceFilePath || '' : modelOrEvents?.filePath || '';
  const evidence = buildEvidence(events);
  const engine = createTrackTrustEngine(config);
  const product = emptyProduct(evidence.strategyVersion, sourceFilePath);
  product.config = config;
  product.usesDefaultConfig = isDefaultConfig(config);
  let previousTrustedTrackPoint = null;
  let segmentId = 1;
  let trackPointId = 0;
  let decisionId = 0;
  let rawPointCount = 0;

  for (const rawPoint of evidence.rawPoints) {
    rawPointCount++;
    const epoch = findSamplingEpoch(rawPoint, evidence.samplingEpochs);
    const intake = acceptRawPoint(rawPoint, epoch, evidence, config);
    if (!intake.accepted) {
      product.excluded.intakeRejected.push(excludedPoint(rawPoint, 'intake_rejected',
        intake.reason, epoch));
      continue;
    }

    const snapshot = findGnssSnapshot(rawPoint, evidence.gnssById);
    const decision = engine.decide(rawPoint, epoch, snapshot, evidence.motionSummaries,
      previousTrustedTrackPoint);
    decisionId++;

    if (decision.result === 'reject' && decision.reason === 'transport_suspected') {
      product.stats.transportCount++;
    }

    if (decision.result === 'anchor' || decision.result === 'accept') {
      if (decision.startsNewSegment && previousTrustedTrackPoint) {
        segmentId++;
        product.stats.gapCount++;
      }
      const targetPoint = {
        trackPointId: ++trackPointId,
        sourceRawPointId: rawPoint.rawPointId,
        sourceDecisionId: decisionId,
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
        virtualCoordinate: true
      };
      product.track.push(targetPoint);
      product.stats.totalDistanceMeters += decision.distanceDeltaMeters;
      product.stats.movingTimeSeconds += decision.movingTimeDeltaSeconds;
      previousTrustedTrackPoint = targetPoint;
    } else if (decision.result === 'weak') {
      product.excluded.weak.push(excludedPoint(rawPoint, decision.result, decision.reason,
        epoch, decision));
    } else {
      product.excluded.rejected.push(excludedPoint(rawPoint, decision.result, decision.reason,
        epoch, decision));
    }
  }

  product.stats.rawPointCount = rawPointCount;
  product.stats.trustedPointCount = product.track.length;
  product.stats.weakPointCount = product.excluded.weak.length;
  product.stats.rejectedPointCount = product.excluded.rejected.length;
  product.stats.intakeRejectedPointCount = product.excluded.intakeRejected.length;
  product.stats.segmentCount = product.track.length === 0
    ? 0
    : new Set(product.track.map((point) => point.segmentId)).size;
  collapseStationarySessionIfNeeded(product, evidence);
  product.alignment = compareWithRecordedDecisions(product, evidence.recordedDecisionsByRawPointId);
  product.findings = buildFindings(product, evidence);
  return product;
}

export function normalizeTargetProductConfig(config = {}) {
  return normalizeConfig(config);
}

function normalizeConfig(config = {}) {
  const merged = { ...DEFAULT_TARGET_PRODUCT_CONFIG, ...config };
  return {
    maxIntakeAccuracyMeters: positiveNumber(merged.maxIntakeAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.maxIntakeAccuracyMeters),
    weakCloudAccuracyMeters: positiveNumber(merged.weakCloudAccuracyMeters, DEFAULT_TARGET_PRODUCT_CONFIG.weakCloudAccuracyMeters),
    gapSeconds: positiveNumber(merged.gapSeconds, DEFAULT_TARGET_PRODUCT_CONFIG.gapSeconds),
    stationaryDistanceMeters: positiveNumber(merged.stationaryDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryDistanceMeters),
    stationaryAccuracyMultiplier: positiveNumber(merged.stationaryAccuracyMultiplier, DEFAULT_TARGET_PRODUCT_CONFIG.stationaryAccuracyMultiplier),
    impossibleSpeedMetersPerSecond: positiveNumber(merged.impossibleSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.impossibleSpeedMetersPerSecond),
    transportSpeedMetersPerSecond: positiveNumber(merged.transportSpeedMetersPerSecond, DEFAULT_TARGET_PRODUCT_CONFIG.transportSpeedMetersPerSecond),
    transportMinDistanceMeters: positiveNumber(merged.transportMinDistanceMeters, DEFAULT_TARGET_PRODUCT_CONFIG.transportMinDistanceMeters),
    cloudTemporalDecaySeconds: positiveNumber(merged.cloudTemporalDecaySeconds, DEFAULT_TARGET_PRODUCT_CONFIG.cloudTemporalDecaySeconds),
    collapseStationarySession: merged.collapseStationarySession !== false,
    stationarySessionStillRatio: positiveNumber(merged.stationarySessionStillRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionStillRatio),
    stationarySessionAnchorRatio: positiveNumber(merged.stationarySessionAnchorRatio, DEFAULT_TARGET_PRODUCT_CONFIG.stationarySessionAnchorRatio)
  };
}

function collapseStationarySessionIfNeeded(product, evidence) {
  if (!product.config.collapseStationarySession || product.track.length <= 1) {
    return;
  }
  const stillRatio = stillMotionRatio(evidence.motionSummaries);
  const stationaryAnchorCount = product.track.filter((point) => point.reason === 'stationary_anchor').length;
  const stationaryAnchorRatio = stationaryAnchorCount / product.track.length;
  if (stillRatio < product.config.stationarySessionStillRatio
      || stationaryAnchorRatio < product.config.stationarySessionAnchorRatio) {
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
  product.stats.totalDistanceMeters = 0;
  product.stats.movingTimeSeconds = 0;
  product.stats.segmentCount = 1;
  product.stats.gapCount = 0;
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
  const recordedDecisionsByRawPointId = new Map();
  let recordStartElapsedRealtimeNanos = null;
  let strategyVersion = 'stage2-track-trust-v3-sampling-cloud';

  for (const event of events) {
    if (event.event === 'session_metadata') {
      strategyVersion = String(event.strategyVersion || strategyVersion);
      recordStartElapsedRealtimeNanos = numberField(event, 'recordStartElapsedRealtimeNanos')
        ?? recordStartElapsedRealtimeNanos;
    } else if (event.event === 'raw_location') {
      rawPoints.push(normalizeRawPoint(event));
    } else if (event.event === 'gnss_snapshot') {
      const id = numberField(event, 'snapshotId');
      if (id !== null) gnssById.set(id, event);
    } else if (event.event === 'sampling_policy') {
      samplingEpochs.push(normalizeSamplingEpoch(event, samplingEpochs.length + 1));
    } else if (event.event === 'motion_summary') {
      motionSummaries.push(event);
    } else if (event.event === 'decision') {
      const rawPointId = numberField(event, 'rawPointId');
      if (rawPointId !== null) recordedDecisionsByRawPointId.set(rawPointId, event);
    }
  }

  rawPoints.sort(compareRawPointTime);
  samplingEpochs.sort((a, b) => a.startedElapsedRealtimeNanos - b.startedElapsedRealtimeNanos);
  if (recordStartElapsedRealtimeNanos === null && rawPoints.length > 0) {
    recordStartElapsedRealtimeNanos = rawPoints[0].elapsedRealtimeNanos;
  }
  return {
    rawPoints,
    gnssById,
    samplingEpochs,
    motionSummaries,
    recordedDecisionsByRawPointId,
    recordStartElapsedRealtimeNanos,
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
  if (rawPoint.provider !== GPS_PROVIDER) return reject('provider_not_gps');
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
  let transportMode = false;
  let resetMovingCloudAfterAccept = false;

  return {
    decide(rawPoint, epoch, snapshot, motionSummaries, previousTrustedTrackPoint) {
      const cloudType = chooseCloudType(rawPoint, epoch, previousTrustedTrackPoint, transportMode, config);
      if (cloudType !== currentCloudType
          || currentCloud === null
          || currentCloud.samplingEpochId !== epoch.samplingEpochId
          || (cloudType === 'MOVING_CLOUD' && resetMovingCloudAfterAccept)) {
        currentCloud = new TrackCloudWindow(nextCloudId++, cloudType, epoch.samplingEpochId, config);
        currentCloudType = cloudType;
        if (cloudType === 'MOVING_CLOUD') resetMovingCloudAfterAccept = false;
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
      } else if (cloudType === 'TRANSPORT_CLOUD') {
        transportMode = true;
        result = 'reject';
        reason = 'transport_suspected';
      } else if (cloudType === 'RECOVERY_CLOUD') {
        if (stable) {
          transportMode = false;
          result = 'accept';
          reason = 'gap_recovery';
          startsNewSegment = previousTrustedTrackPoint !== null;
        } else {
          result = 'weak';
          reason = 'recovery_cloud_pending';
        }
      } else if (cloudType === 'WEAK_CLOUD') {
        result = 'weak';
        reason = 'weak_signal_stage2';
      } else if (cloudType === 'STATIONARY_CLOUD') {
        if (stable && hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionSummaries)) {
          result = 'anchor';
          reason = 'stationary_anchor';
        } else {
          result = 'reject';
          reason = 'stationary_cloud_jitter';
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

      return {
        result,
        reason,
        cloudType,
        cloudId: cloud.cloudId,
        cloudSampleCount: cloud.sampleCount,
        cloudWeightSum: cloud.weightSum,
        cloudWeightedRadiusMeters: cloud.weightedRadiusMeters,
        cloudCenterLatitude: cloud.centerLatitude,
        cloudCenterLongitude: cloud.centerLongitude,
        representativeRawPointId: cloud.representativeRawPointId,
        contributingRawPointIds: cloud.contributingRawPointIds,
        startsNewSegment,
        distanceDeltaMeters,
        movingTimeDeltaSeconds
      };
    }
  };
}

function chooseCloudType(rawPoint, epoch, previousTrustedTrackPoint, transportMode, config) {
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
    if (speed > config.impossibleSpeedMetersPerSecond) return 'WEAK_CLOUD';
    if (speed >= config.transportSpeedMetersPerSecond && distance >= config.transportMinDistanceMeters) {
      return 'TRANSPORT_CLOUD';
    }
  }
  if (transportMode) return 'RECOVERY_CLOUD';
  if (distance < stationaryThreshold(rawPoint, config)) return 'STATIONARY_CLOUD';
  return 'MOVING_CLOUD';
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

function compareWithRecordedDecisions(product, recordedDecisionsByRawPointId) {
  const recomputed = new Map();
  for (const point of product.track) recomputed.set(point.sourceRawPointId, point);
  for (const point of product.excluded.weak) recomputed.set(point.rawPointId, point);
  for (const point of product.excluded.rejected) recomputed.set(point.rawPointId, point);
  let comparedDecisionCount = 0;
  let matchedDecisionCount = 0;
  const mismatches = [];
  for (const [rawPointId, recorded] of recordedDecisionsByRawPointId.entries()) {
    const actual = recomputed.get(rawPointId);
    if (!actual) continue;
    comparedDecisionCount++;
    if (actual.result === recorded.result && actual.reason === recorded.reason) {
      matchedDecisionCount++;
    } else {
      mismatches.push({
        rawPointId,
        recorded: { result: recorded.result, reason: recorded.reason },
        recomputed: { result: actual.result, reason: actual.reason }
      });
    }
  }
  return { comparedDecisionCount, matchedDecisionCount, mismatches };
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
  if (product.alignment.mismatches.length > 0) {
    findings.push(`Web 复算与 Android recorded decision 存在 ${product.alignment.mismatches.length} 个 result/reason 差异`);
  }
  return findings;
}

function emptyProduct(strategyVersion, sourceFilePath) {
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
      totalDistanceMeters: 0,
      movingTimeSeconds: 0,
      segmentCount: 0,
      gapCount: 0,
      transportCount: 0,
      rawPointCount: 0,
      trustedPointCount: 0,
      weakPointCount: 0,
      rejectedPointCount: 0,
      intakeRejectedPointCount: 0
    },
    alignment: {
      comparedDecisionCount: 0,
      matchedDecisionCount: 0,
      mismatches: []
    },
    findings: []
  };
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
