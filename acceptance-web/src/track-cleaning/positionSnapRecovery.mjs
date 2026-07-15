const EARTH_RADIUS_METERS = 6_371_000;

const SIMPLE_RECOVERY_REASONS = new Set([
  'moving_good_fix',
  'motion_supported_low_speed',
  'continuity_rescue_low_accuracy'
]);

const UNSTABLE_PREFIX_WEAK_REASONS = new Set([
  'implied_speed_unconfirmed_by_reported_speed',
  'weak_horizontal_accuracy',
  'implied_speed_too_high'
]);

export function findPositionSnapRecoveryCandidates(track = [], weakByRawPointId = new Map(),
  config = {}) {
  const unstableCandidates = [];
  for (let previousIndex = 0; previousIndex < track.length - 3; previousIndex++) {
    const candidate = unstableTransportPrefixCandidate(
      track,
      previousIndex,
      weakByRawPointId,
      config
    );
    if (candidate) unstableCandidates.push(candidate);
  }

  const candidates = [...unstableCandidates];
  for (let recoveryIndex = 1; recoveryIndex < track.length; recoveryIndex++) {
    const candidate = simpleWeakJumpCandidate(
      track,
      recoveryIndex,
      weakByRawPointId,
      config
    );
    if (!candidate || candidates.some((item) =>
      rawRangesOverlap(item.rawRange, candidate.rawRange))) {
      continue;
    }
    candidates.push(candidate);
  }

  return nonOverlappingCandidates(candidates);
}

export function unstablePositionSnapRecoveryOpenWindow(
  track = [],
  weakByRawPointId = new Map(),
  config = {}
) {
  if (track.length < 2) return null;
  let firstTransportIndex = track.length - 1;
  while (firstTransportIndex >= 0
      && isTransportTrackReason(track[firstTransportIndex]?.reason)) {
    firstTransportIndex--;
  }
  firstTransportIndex++;
  const previousIndex = firstTransportIndex - 1;
  if (previousIndex < 0) return null;

  const previous = track[previousIndex];
  const transportTail = track.slice(firstTransportIndex);
  if (!eligibleStablePrevious(previous) || transportTail.length === 0) return null;
  if (transportTail.length > config.positionSnapRecoveryUnstablePrefixMaxTransportPoints) {
    return null;
  }

  const latest = transportTail.at(-1);
  const bridgeDistanceMeters = distanceMeters(previous, latest);
  if (bridgeDistanceMeters < config.positionSnapRecoveryMinBridgeDistanceMeters) return null;

  const coverage = unstablePrefixCoverage(previous, latest, transportTail, weakByRawPointId);
  if (!coverage
      || coverage.weakRawPointIds.length
        < config.positionSnapRecoveryUnstablePrefixMinWeakPoints) {
    return null;
  }

  return {
    previousRawPointId: previous.sourceRawPointId,
    rawRange: rawPointRange([...coverage.coveredRawPointIds, latest.sourceRawPointId]),
    acceptedTransportRawPointIds: transportTail.map((point) => point.sourceRawPointId)
  };
}

function simpleWeakJumpCandidate(track, recoveryIndex, weakByRawPointId, config) {
  const previousIndex = recoveryIndex - 1;
  const previous = track[previousIndex];
  const point = track[recoveryIndex];
  if (!hasValidLngLat(previous) || !hasValidLngLat(point)) return null;
  if (!point.entersTrustedGpx || point.reason === 'gap_recovery') return null;
  if (!SIMPLE_RECOVERY_REASONS.has(point.reason)) return null;
  const reportedSpeed = Number.isFinite(point.reportedSpeedMetersPerSecond)
    ? point.reportedSpeedMetersPerSecond
    : null;
  if (reportedSpeed !== null
      && reportedSpeed > config.positionSnapRecoveryMaxReportedSpeedMetersPerSecond) {
    return null;
  }
  const bridgeDistanceMeters = distanceMeters(previous, point);
  if (bridgeDistanceMeters < config.positionSnapRecoveryMinBridgeDistanceMeters) return null;
  const weakPoints = [];
  for (let rawPointId = previous.sourceRawPointId + 1;
    rawPointId < point.sourceRawPointId; rawPointId++) {
    const weak = weakByRawPointId.get(rawPointId);
    if (weak?.reason === 'implied_speed_unconfirmed_by_reported_speed') {
      weakPoints.push(weak);
    }
  }
  if (weakPoints.length < config.positionSnapRecoveryMinWeakPoints) return null;
  const weakRawPointIds = uniqueNumbers(weakPoints.map((weak) =>
    finiteNumber(weak.rawPointId ?? weak.sourceRawPointId)));
  const suppressedRawPointIds = [...weakRawPointIds];
  const rawPointIds = uniqueNumbers([...suppressedRawPointIds, point.sourceRawPointId]);
  return {
    recoveryKind: 'weak_jump',
    previousIndex,
    recoveryIndex,
    previousRawPointId: previous.sourceRawPointId,
    recoveryRawPointId: point.sourceRawPointId,
    continuationRawPointId: null,
    weakRawPointIds,
    suppressedAcceptedRawPointIds: [],
    suppressedRawPointIds,
    rawPointIds,
    rawRange: rawPointRange(rawPointIds),
    bridgeDistanceMeters,
    reportedSpeedMetersPerSecond: reportedSpeed,
    detourMeters: null,
    maxReversalAngleDegrees: null,
    continuationAngleDeltaDegrees: null
  };
}

function unstableTransportPrefixCandidate(track, previousIndex, weakByRawPointId, config) {
  const previous = track[previousIndex];
  if (!eligibleStablePrevious(previous)) return null;

  const maxPrefixPoints =
    config.positionSnapRecoveryUnstablePrefixMaxTransportPoints - 1;
  for (let prefixCount = config.positionSnapRecoveryUnstablePrefixMinTransportPoints;
    prefixCount <= maxPrefixPoints; prefixCount++) {
    const recoveryIndex = previousIndex + prefixCount + 1;
    const continuationIndex = recoveryIndex + 1;
    const recovery = track[recoveryIndex];
    const continuation = track[continuationIndex];
    if (!recovery || !eligibleContinuation(continuation)) break;

    const acceptedPrefix = track.slice(previousIndex + 1, recoveryIndex);
    if (acceptedPrefix.length !== prefixCount
        || !acceptedPrefix.every((point) => isTransportTrackReason(point.reason))
        || !isTransportTrackReason(recovery.reason)) {
      continue;
    }
    if (recovery.sourceRawPointId - previous.sourceRawPointId
        > config.positionSnapRecoveryUnstablePrefixMaxRawPointSpan) {
      continue;
    }

    const coverage = unstablePrefixCoverage(
      previous,
      recovery,
      acceptedPrefix,
      weakByRawPointId
    );
    if (!coverage
        || coverage.weakRawPointIds.length
          < config.positionSnapRecoveryUnstablePrefixMinWeakPoints) {
      continue;
    }

    const routePoints = [previous, ...acceptedPrefix, recovery];
    const routeMetrics = unstableRouteMetrics(routePoints, continuation);
    if (routeMetrics.bridgeDistanceMeters
          < config.positionSnapRecoveryMinBridgeDistanceMeters
        || routeMetrics.detourMeters
          < config.positionSnapRecoveryUnstablePrefixMinDetourMeters
        || routeMetrics.maxReversalAngleDegrees
          < config.positionSnapRecoveryUnstablePrefixMinReversalAngleDegrees
        || routeMetrics.continuationAngleDeltaDegrees
          > config.positionSnapRecoveryUnstablePrefixMaxContinuationAngleDegrees
        || routeMetrics.continuationDistanceMeters
          > config.positionSnapRecoveryUnstablePrefixMaxContinuationDistanceMeters) {
      continue;
    }

    const suppressedAcceptedRawPointIds = acceptedPrefix.map((point) =>
      point.sourceRawPointId);
    const suppressedRawPointIds = uniqueNumbers([
      ...coverage.weakRawPointIds,
      ...suppressedAcceptedRawPointIds
    ]);
    const rawPointIds = uniqueNumbers([...suppressedRawPointIds, recovery.sourceRawPointId]);
    return {
      recoveryKind: 'unstable_transport_prefix',
      previousIndex,
      recoveryIndex,
      previousRawPointId: previous.sourceRawPointId,
      recoveryRawPointId: recovery.sourceRawPointId,
      continuationRawPointId: continuation.sourceRawPointId,
      weakRawPointIds: coverage.weakRawPointIds,
      suppressedAcceptedRawPointIds,
      suppressedRawPointIds,
      rawPointIds,
      rawRange: rawPointRange(rawPointIds),
      reportedSpeedMetersPerSecond:
        finiteNumber(recovery.reportedSpeedMetersPerSecond),
      ...routeMetrics
    };
  }
  return null;
}

function unstablePrefixCoverage(previous, recovery, acceptedPoints, weakByRawPointId) {
  if (!Number.isFinite(previous?.sourceRawPointId)
      || !Number.isFinite(recovery?.sourceRawPointId)
      || recovery.sourceRawPointId <= previous.sourceRawPointId + 1) {
    return null;
  }
  const acceptedRawPointIds = new Set(acceptedPoints.map((point) =>
    finiteNumber(point.sourceRawPointId)).filter(Number.isFinite));
  const weakRawPointIds = [];
  const coveredRawPointIds = [];
  for (let rawPointId = previous.sourceRawPointId + 1;
    rawPointId < recovery.sourceRawPointId; rawPointId++) {
    if (acceptedRawPointIds.has(rawPointId)) {
      coveredRawPointIds.push(rawPointId);
      continue;
    }
    const weak = weakByRawPointId.get(rawPointId);
    if (!weak || !UNSTABLE_PREFIX_WEAK_REASONS.has(weak.reason)) return null;
    weakRawPointIds.push(rawPointId);
    coveredRawPointIds.push(rawPointId);
  }
  return {
    weakRawPointIds,
    coveredRawPointIds
  };
}

function unstableRouteMetrics(routePoints, continuation) {
  let pathMeters = 0;
  let maxReversalAngleDegrees = 0;
  for (let index = 1; index < routePoints.length; index++) {
    pathMeters += distanceMeters(routePoints[index - 1], routePoints[index]);
    if (index < 2) continue;
    maxReversalAngleDegrees = Math.max(
      maxReversalAngleDegrees,
      angleDeltaDegrees(
        bearingDegrees(routePoints[index - 2], routePoints[index - 1]),
        bearingDegrees(routePoints[index - 1], routePoints[index])
      )
    );
  }
  const previous = routePoints[0];
  const recovery = routePoints.at(-1);
  const bridgeDistanceMeters = distanceMeters(previous, recovery);
  return {
    bridgeDistanceMeters,
    detourMeters: Math.max(0, pathMeters - bridgeDistanceMeters),
    maxReversalAngleDegrees,
    continuationDistanceMeters: distanceMeters(recovery, continuation),
    continuationAngleDeltaDegrees: angleDeltaDegrees(
      bearingDegrees(previous, recovery),
      bearingDegrees(recovery, continuation)
    )
  };
}

function eligibleStablePrevious(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx !== false
    && point.reason !== 'gap_recovery'
    && !isTransportTrackReason(point.reason);
}

function eligibleContinuation(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx !== false
    && point.reason !== 'gap_recovery'
    && point.startsNewSegment !== true;
}

function isTransportTrackReason(reason) {
  return reason === 'recovery_transport_suspected_kept'
    || reason === 'transport_suspected_kept';
}

function nonOverlappingCandidates(candidates) {
  const accepted = [];
  for (const candidate of [...candidates].sort((left, right) =>
    recoveryKindPriority(left.recoveryKind) - recoveryKindPriority(right.recoveryKind)
    || left.rawRange.startRawPointId - right.rawRange.startRawPointId
    || left.rawRange.endRawPointId - right.rawRange.endRawPointId)) {
    if (accepted.some((item) => rawRangesOverlap(item.rawRange, candidate.rawRange))) continue;
    accepted.push(candidate);
  }
  return accepted.sort((left, right) =>
    left.recoveryRawPointId - right.recoveryRawPointId);
}

function recoveryKindPriority(kind) {
  return kind === 'unstable_transport_prefix' ? 0 : 1;
}

function rawRangesOverlap(left, right) {
  return left.startRawPointId <= right.endRawPointId
    && right.startRawPointId <= left.endRawPointId;
}

function rawPointRange(rawPointIds) {
  const values = rawPointIds.filter(Number.isFinite);
  return {
    startRawPointId: Math.min(...values),
    endRawPointId: Math.max(...values)
  };
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasValidLngLat(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function distanceMeters(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(to.lng - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDeltaDegrees(left, right) {
  const normalized = Math.abs(left - right) % 360;
  return normalized > 180 ? 360 - normalized : normalized;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}
