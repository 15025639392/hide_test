import { normalizeSixLayerTrackConfig } from './sixLayerTrackProduct.mjs';

const EARTH_RADIUS_METERS = 6_371_000;

export const STREAMING_SCENARIO_RECOGNIZER_VERSION = 'streaming-scenario-recognizer-v0';

export function createStreamingScenarioRecognizerState(overrides = {}) {
  return {
    version: STREAMING_SCENARIO_RECOGNIZER_VERSION,
    enabled: overrides.enabled === true,
    emittedProposalIds: cloneArray(overrides.emittedProposalIds).map(String),
    openWindows: cloneArray(overrides.openWindows),
    lastInputTrackPointId: finiteNumber(overrides.lastInputTrackPointId),
    lastProposalCount: finiteNumber(overrides.lastProposalCount) ?? 0
  };
}

export function advanceStreamingScenarioRecognizer(previousState = {}, baseKernel = {},
  options = {}) {
  const state = createStreamingScenarioRecognizerState(previousState);
  const enabled = options.enabled === true || state.enabled === true;
  if (!enabled) {
    return {
      ...state,
      enabled: false,
      openWindows: [],
      lastProposalCount: 0
    };
  }

  const config = normalizeSixLayerTrackConfig(options.config || baseKernel.config);
  const track = cloneArray(baseKernel.track)
    .filter((point) => point.entersTrustedGpx !== false)
    .sort((a, b) => finiteNumber(a.trackPointId) - finiteNumber(b.trackPointId));
  const weakByRawPointId = new Map((baseKernel.excluded?.weak || [])
    .map((point) => [finiteNumber(point.rawPointId ?? point.sourceRawPointId), point])
    .filter(([rawPointId]) => Number.isFinite(rawPointId)));
  const proposals = [];
  const emittedProposalIds = [...state.emittedProposalIds];
  const metricReviewProposals = [];
  const denseAreaIntentCandidatesForReview = denseAreaIntentClosedCandidates(
    track,
    config,
    options.finish === true
  );
  const denseAreaIntentProposalsForReview = denseAreaIntentCandidatesForReview
    .map((candidate) => denseAreaIntentProposal(candidate));

  for (const proposal of gapRecoveryBoundaryProposals(track)) {
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const proposal of transportContaminationProposals(baseKernel)) {
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const proposal of pressureJumpProposals(
    options.metricAccumulator?.barometerWindowDecisions,
    baseKernel.rawPointTimeline
  )) {
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of weakRecoveryEndpointClosedCandidates(
    baseKernel,
    config,
    options.finish === true
  )) {
    const proposal = weakRecoveryEndpointProposal(candidate);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (let index = 1; index < track.length; index++) {
    const candidate = positionSnapRecoveryCandidate(track[index - 1], track[index],
      weakByRawPointId, config);
    if (!candidate) continue;
    const proposal = positionSnapRecoveryProposal(candidate);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (let index = 1; index < track.length - 1; index++) {
    const candidate = movingSpikeCandidate(track[index - 1], track[index],
      track[index + 1], index, config);
    if (!candidate) continue;
    const proposal = movingSpikeProposal(candidate);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of stationaryDriftCandidates(baseKernel.excluded?.rejected,
    baseKernel.lastProcessedRawPointId, config, options.finish === true)) {
    const proposal = stationaryDriftProposal(candidate);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of restPhotoMicroMoveClosedCandidates(
    track,
    config,
    options.finish === true
  )) {
    const proposal = restPhotoMicroMoveProposal(candidate, config);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    metricReviewProposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of denseMainRouteClosedCandidates(
    track,
    config,
    options.finish === true
  )) {
    const proposal = denseMainRouteProposal(candidate, config);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    metricReviewProposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of roundTripRouteClosedCandidates(
    track,
    config,
    options.finish === true,
    denseAreaIntentProposalsForReview
  )) {
    const proposal = roundTripRouteProposal(candidate, config);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    metricReviewProposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of enclosedLoopClusterSettlementClosedCandidates(
    track,
    config,
    options.finish === true,
    denseAreaIntentProposalsForReview
  )) {
    const proposal = enclosedLoopClusterSettlementProposal(candidate,
      denseAreaIntentProposalsForReview);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    metricReviewProposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of compositeGapLocalSettlementClosedCandidates(
    track,
    config,
    options.finish === true,
    denseAreaIntentProposalsForReview
  )) {
    const proposal = compositeGapLocalSettlementProposal(candidate);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const proposal of denseAreaIntentProposalsForReview
    .map((item) => denseAreaIntentProposalWithReview(item, metricReviewProposals))) {
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of enclosedGapClusterClosedCandidates(
    track,
    config,
    options.finish === true,
    denseAreaIntentProposalsForReview
  )) {
    const proposal = enclosedGapClusterProposal(candidate, config,
      denseAreaIntentProposalsForReview);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  for (const candidate of closedLoopRoundTripClosedCandidates(
    track,
    config,
    options.finish === true,
    denseAreaIntentProposalsForReview
  )) {
    const proposal = closedLoopRoundTripProposal(candidate, config,
      denseAreaIntentProposalsForReview);
    if (emittedProposalIds.includes(proposal.id)) continue;
    proposals.push(proposal);
    emittedProposalIds.push(proposal.id);
  }

  const openWindows = options.emitOpenWindows === false
    ? []
    : [
      ...movingSpikeOpenWindows(track, emittedProposalIds),
      ...stationaryDriftOpenWindows(baseKernel.excluded?.rejected,
        baseKernel.lastProcessedRawPointId, config),
      ...weakRecoveryEndpointOpenWindows(baseKernel, config, emittedProposalIds),
      ...restPhotoMicroMoveOpenWindows(track, config, emittedProposalIds),
      ...denseMainRouteOpenWindows(track, config, emittedProposalIds),
      ...roundTripRouteOpenWindows(track, config, emittedProposalIds),
      ...enclosedLoopClusterSettlementOpenWindows(track, config, emittedProposalIds)
    ];

  return {
    ...state,
    enabled: true,
    emittedProposalIds,
    openWindows,
    lastInputTrackPointId: track.at(-1)?.trackPointId ?? state.lastInputTrackPointId,
    lastProposalCount: proposals.length,
    proposals
  };
}

function gapRecoveryBoundaryProposals(track) {
  return track
    .filter((point) => point?.reason === 'gap_recovery')
    .map((point) => {
      const rawPointId = finiteNumber(point.sourceRawPointId);
      if (!Number.isFinite(rawPointId)) return null;
      const rawRange = range(rawPointId, rawPointId);
      return {
        id: `gap-recovery:${rawPointId}`,
        scenario: 'gap_recovery_boundary',
        confidence: 0.85,
        rawRange,
        influenceRange: rawRange,
        metricRange: rawRange,
        metricOwner: true,
        hardBoundary: true,
        affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
        action: 'reset_segment_zero_delta',
        localRebuild: 'gap_recovery_anchor',
        evidence: {
          recoveryRawPointId: rawPointId,
          trackPointId: finiteNumber(point.trackPointId),
          segmentId: finiteNumber(point.segmentId),
          startsNewSegment: point.startsNewSegment === true,
          distanceDeltaMeters: rounded(finiteNumber(point.distanceDeltaMeters) ?? 0),
          movingTimeDeltaSeconds: rounded(finiteNumber(point.movingTimeDeltaSeconds) ?? 0),
          countsDistance: point.countsDistance === true,
          countsMovingTime: point.countsMovingTime === true
        }
      };
    })
    .filter(Boolean);
}

function transportContaminationProposals(baseKernel = {}) {
  return [
    ...cloneArray(baseKernel.excluded?.rejected)
      .filter((point) => point?.reason === 'transport_risk')
      .map((point) => ({ ...point, transportSource: 'rejected' })),
    ...cloneArray(baseKernel.excluded?.weak)
      .filter((point) => point?.reason === 'transport_recovery_pending')
      .map((point) => ({ ...point, transportSource: 'pending' })),
    ...cloneArray(baseKernel.track)
      .filter((point) => isTransportTrackReason(point?.reason))
      .map((point) => ({ ...point, transportSource: 'kept' }))
  ].map((point) => {
      const rawPointId = finiteNumber(point.rawPointId ?? point.sourceRawPointId);
      if (!Number.isFinite(rawPointId)) return null;
      const rawRange = range(rawPointId, rawPointId);
      return {
        id: `transport-contamination:${rawPointId}`,
        scenario: 'transport_contamination',
        confidence: 0.8,
        rawRange,
        influenceRange: rawRange,
        metricRange: rawRange,
        metricOwner: true,
        hardBoundary: true,
        affectedMetricGates: ['distance', 'moving_time', 'elevation'],
        action: 'preserve_route_exclude_hiking_metrics',
        localRebuild: 'transport_route_passthrough',
        evidence: {
          rejectedRawPointIds: point.transportSource === 'rejected' ? [rawPointId] : [],
          keptRawPointIds: point.transportSource === 'kept' ? [rawPointId] : [],
          pendingRawPointIds: point.transportSource === 'pending' ? [rawPointId] : [],
          suspectedDistanceMeters: rounded(finiteNumber(point.distanceDeltaMeters) ?? 0),
          suspectedMovingTimeSeconds: rounded(finiteNumber(point.movingTimeDeltaSeconds) ?? 0),
          routePreserved: true,
          countsDistance: false,
          countsMovingTime: false
        }
      };
    })
    .filter(Boolean);
}

function pressureJumpProposals(barometerWindowDecisions = [], rawPointTimeline = []) {
  const timeline = normalizedRawPointTimeline(rawPointTimeline);
  return cloneArray(barometerWindowDecisions)
    .filter((decision) => decision?.reason === 'pressure_jump_detected')
    .map((decision) => {
      const rawPointId = rawPointIdForElapsedRealtime(
        timeline,
        finiteNumber(decision.endElapsedRealtimeNanos)
          ?? finiteNumber(decision.startElapsedRealtimeNanos)
      );
      if (!Number.isFinite(rawPointId)) return null;
      const windowId = finiteNumber(decision.windowId);
      const rawRange = range(rawPointId, rawPointId);
      return {
        id: `pressure-jump:${windowId ?? rawPointId}:${rawPointId}`,
        scenario: 'pressure_jump',
        confidence: 0.78,
        rawRange,
        influenceRange: rawRange,
        metricRange: rawRange,
        metricOwner: true,
        hardBoundary: true,
        affectedMetricGates: ['elevation'],
        action: 'reset_barometer_anchor_zero_delta',
        localRebuild: 'barometer_pressure_jump_boundary',
        evidence: {
          barometerWindowId: windowId,
          boundaryRawPointId: rawPointId,
          startElapsedRealtimeNanos: finiteNumber(decision.startElapsedRealtimeNanos),
          endElapsedRealtimeNanos: finiteNumber(decision.endElapsedRealtimeNanos),
          ascentDeltaMeters: rounded(finiteNumber(decision.ascentDeltaMeters) ?? 0),
          descentDeltaMeters: rounded(finiteNumber(decision.descentDeltaMeters) ?? 0),
          countsElevation: false
        }
      };
    })
    .filter(Boolean);
}

function weakRecoveryEndpointClosedCandidates(baseKernel = {}, config, finish = false) {
  return weakRecoveryEndpointCandidates(baseKernel, config)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < baseKernel.lastProcessedRawPointId);
}

function weakRecoveryEndpointOpenWindows(baseKernel = {}, config, emittedProposalIds) {
  const latestRawPointId = finiteNumber(baseKernel.lastProcessedRawPointId);
  if (!Number.isFinite(latestRawPointId)) return [];
  return weakRecoveryEndpointPendingWindows(baseKernel, config)
    .filter((candidate) => candidate.rawRange.endRawPointId === latestRawPointId)
    .filter((candidate) => {
      if (!candidate.eligible) return true;
      return !emittedProposalIds.includes(weakRecoveryEndpointProposalId(candidate));
    })
    .map((candidate) => ({
      id: `weak-recovery-open:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
      scenario: 'weak_recovery_endpoint',
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: candidate.eligible
        ? 'awaiting_weak_recovery_shape_closure'
        : 'awaiting_weak_recovery_shape_samples',
      evidence: {
        previousTrustedRawPointId: candidate.previousTrustedRawPointId,
        preservedRawPointCount: candidate.rawPoints.length,
        gapSeconds: rounded(candidate.gapSeconds),
        cloudRadiusMeters: rounded(candidate.radiusMeters),
        bestAccuracyMeters: rounded(candidate.bestAccuracy),
        distanceFromPreviousTrustedMeters: rounded(candidate.distanceFromTrusted)
      }
    }));
}

function weakRecoveryEndpointCandidates(baseKernel = {}, config) {
  if (!config.weakRecoveryShapePreserveEnabled) return [];
  const candidates = weakRecoveryEndpointPendingWindows(baseKernel, config)
    .filter((candidate) => candidate.eligible);
  return nonOverlappingCandidates(candidates);
}

function weakRecoveryEndpointPendingWindows(baseKernel = {}, config) {
  if (!config.weakRecoveryShapePreserveEnabled) return [];
  const track = cloneArray(baseKernel.track)
    .filter((point) => point.entersTrustedGpx !== false)
    .filter(hasValidLngLat)
    .sort((a, b) => finiteNumber(a.sourceRawPointId) - finiteNumber(b.sourceRawPointId));
  const weakPoints = cloneArray(baseKernel.excluded?.weak)
    .filter((point) => point?.reason === 'gap_recovery_pending')
    .filter(hasValidLngLat)
    .map((point) => ({
      ...point,
      rawPointId: finiteNumber(point.rawPointId ?? point.sourceRawPointId),
      accuracy: finiteNumber(point.accuracy),
      elapsedRealtimeNanos: finiteNumber(point.elapsedRealtimeNanos)
    }))
    .filter((point) =>
      Number.isFinite(point.rawPointId)
      && Number.isFinite(point.elapsedRealtimeNanos)
      && Number.isFinite(point.accuracy))
    .sort((a, b) => a.rawPointId - b.rawPointId);
  const groups = consecutiveGroups(weakPoints, (left, right) =>
    right.rawPointId === left.rawPointId + 1
    && elapsedSeconds(left.elapsedRealtimeNanos, right.elapsedRealtimeNanos)
      <= config.weakRecoveryShapeExtensionGapSeconds
    && distanceMeters(left.lat, left.lng, right.lat, right.lng)
      <= config.weakRecoveryShapeExtensionDistanceMeters);
  const windows = [];
  for (const group of groups) {
    const previousTrusted = previousTrackPointBefore(track, group[0].elapsedRealtimeNanos);
    if (!previousTrusted) continue;
    const gapSeconds = elapsedSeconds(previousTrusted.elapsedRealtimeNanos,
      group[0].elapsedRealtimeNanos);
    if (gapSeconds <= config.gapSeconds) continue;
    if (group.length < config.weakRecoveryShapeMinSamples) {
      windows.push(weakRecoveryPendingWindow(group, previousTrusted, gapSeconds, {
        reason: 'not_enough_samples'
      }));
      continue;
    }
    const coreRawPoints = group.slice(0, config.weakRecoveryShapeMinSamples);
    const coreRadiusMeters = weightedCenter(coreRawPoints).radiusMeters;
    if (coreRadiusMeters > config.weakRecoveryShapeMaxRadiusMeters) {
      windows.push(weakRecoveryPendingWindow(group, previousTrusted, gapSeconds, {
        reason: 'core_radius_too_large',
        coreRawPoints,
        coreRadiusMeters
      }));
      continue;
    }
    const bestAccuracy = Math.min(...coreRawPoints.map((point) => point.accuracy));
    if (!Number.isFinite(bestAccuracy)
        || bestAccuracy > config.weakRecoveryShapeMaxBestAccuracyMeters) {
      windows.push(weakRecoveryPendingWindow(group, previousTrusted, gapSeconds, {
        reason: 'best_accuracy_too_weak',
        coreRawPoints,
        coreRadiusMeters,
        bestAccuracy
      }));
      continue;
    }
    const rawPoints = group.slice(0,
      config.weakRecoveryShapeMinSamples + config.weakRecoveryShapeMaxExtensionSamples);
    const center = weightedCenter(rawPoints);
    const distanceFromTrusted = distanceMeters(previousTrusted.lat, previousTrusted.lng,
      center.lat, center.lng);
    if (distanceFromTrusted < config.weakRecoveryShapeMinDistanceFromTrustedMeters) {
      windows.push(weakRecoveryPendingWindow(group, previousTrusted, gapSeconds, {
        reason: 'too_close_to_previous_trusted',
        coreRawPoints,
        coreRadiusMeters,
        bestAccuracy,
        center,
        distanceFromTrusted
      }));
      continue;
    }
    const representative = weakRecoveryEndpointRepresentative(center, rawPoints);
    windows.push({
      rawRange: rawPointRange(rawPoints.map((point) => point.rawPointId)),
      rawPoints,
      coreRawPoints,
      center,
      representative,
      previousTrustedRawPointId: previousTrusted.sourceRawPointId,
      gapSeconds,
      distanceFromTrusted,
      radiusMeters: center.radiusMeters,
      coreRadiusMeters,
      bestAccuracy,
      eligible: true,
      score: rawPoints.length * 10 - center.radiusMeters
    });
  }
  return windows.sort((a, b) =>
    a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || a.rawRange.endRawPointId - b.rawRange.endRawPointId);
}

function weakRecoveryPendingWindow(group, previousTrusted, gapSeconds, details = {}) {
  const rawPoints = group;
  const center = details.center || weightedCenter(rawPoints);
  const coreRawPoints = details.coreRawPoints || group;
  const bestAccuracy = details.bestAccuracy ?? Math.min(...coreRawPoints
    .map((point) => point.accuracy)
    .filter(Number.isFinite));
  return {
    rawRange: rawPointRange(rawPoints.map((point) => point.rawPointId)),
    rawPoints,
    coreRawPoints,
    center,
    representative: weakRecoveryEndpointRepresentative(center, rawPoints),
    previousTrustedRawPointId: previousTrusted.sourceRawPointId,
    gapSeconds,
    distanceFromTrusted: details.distanceFromTrusted ?? distanceMeters(previousTrusted.lat,
      previousTrusted.lng, center.lat, center.lng),
    radiusMeters: center.radiusMeters,
    coreRadiusMeters: details.coreRadiusMeters ?? center.radiusMeters,
    bestAccuracy: Number.isFinite(bestAccuracy) ? bestAccuracy : null,
    eligible: false,
    pendingReason: details.reason || 'pending'
  };
}

function weakRecoveryEndpointProposal(candidate) {
  const endpoint = candidate.rawPoints.at(-1) ?? candidate.representative;
  return {
    id: weakRecoveryEndpointProposalId(candidate),
    scenario: 'weak_recovery_endpoint',
    confidence: rounded(weakRecoveryEndpointConfidence(candidate)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
    anchorRawPointIds: uniqueNumbers([
      candidate.representative.rawPointId,
      endpoint.rawPointId
    ]),
    action: 'preserve_endpoint_anchor',
    localRebuild: 'weak_recovery_shape_anchor',
    evidence: {
      previousTrustedRawPointId: candidate.previousTrustedRawPointId,
      coreStartRawPointId: candidate.coreRawPoints[0]?.rawPointId ?? null,
      coreEndRawPointId: candidate.coreRawPoints.at(-1)?.rawPointId ?? null,
      coreSampleCount: candidate.coreRawPoints.length,
      preservedRawPointCount: candidate.rawPoints.length,
      preservedRawPointIds: candidate.rawPoints.map((point) => point.rawPointId),
      representativeRawPointId: candidate.representative.rawPointId,
      gapSeconds: rounded(candidate.gapSeconds),
      coreRadiusMeters: rounded(candidate.coreRadiusMeters),
      cloudRadiusMeters: rounded(candidate.radiusMeters),
      bestAccuracyMeters: rounded(candidate.bestAccuracy),
      distanceFromPreviousTrustedMeters: rounded(candidate.distanceFromTrusted),
      endpointRawPointId: endpoint.rawPointId,
      coordinatePolicy: 'cloud_center_then_endpoint_when_same_road_rewrite',
      countsDistance: false,
      countsMovingTime: false,
      countsElevation: false
    }
  };
}

function weakRecoveryEndpointProposalId(candidate) {
  return `weak-recovery-endpoint:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`;
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

function previousTrackPointBefore(track, elapsedRealtimeNanos) {
  let previous = null;
  for (const point of track) {
    if (point.elapsedRealtimeNanos >= elapsedRealtimeNanos) break;
    previous = point;
  }
  return previous;
}

function weakRecoveryEndpointRepresentative(center, rawPoints) {
  return [...rawPoints].sort((a, b) =>
    a.accuracy - b.accuracy
    || distanceMeters(center.lat, center.lng, a.lat, a.lng)
      - distanceMeters(center.lat, center.lng, b.lat, b.lng)
    || a.rawPointId - b.rawPointId)[0] ?? rawPoints[0];
}

function movingSpikeCandidate(previous, point, next, index, config) {
  if (!hasValidLngLat(previous) || !hasValidLngLat(point) || !hasValidLngLat(next)) {
    return null;
  }
  if (!point.entersTrustedGpx || !next.entersTrustedGpx) return null;
  if (point.reason !== 'motion_supported_low_speed' && point.reason !== 'moving_good_fix') {
    return null;
  }
  if (!Number.isFinite(point.reportedSpeedMetersPerSecond)) return null;

  const previousDistance = distanceMeters(previous.lat, previous.lng, point.lat, point.lng);
  const nextDistance = distanceMeters(point.lat, point.lng, next.lat, next.lng);
  const bridgeDistance = distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
  if (previousDistance < config.movingSpikeMinNeighborDistanceMeters
      || nextDistance < config.movingSpikeMinNeighborDistanceMeters
      || bridgeDistance > config.movingSpikeMaxBridgeDistanceMeters) {
    return null;
  }

  const detour = previousDistance + nextDistance - bridgeDistance;
  const lateral = distanceToSegmentMeters(point, previous, next);
  if (detour < config.movingSpikeMinDetourMeters
      || lateral < config.movingSpikeMinLateralMeters) {
    return null;
  }

  const strictSpeed = point.reportedSpeedMetersPerSecond
    <= config.movingSpikeMaxReportedSpeedMetersPerSecond;
  const competingSpeed = point.reportedSpeedMetersPerSecond
    <= config.movingSpikeMaxCompetingReportedSpeedMetersPerSecond;
  if (!strictSpeed && !competingSpeed) return null;

  return {
    index,
    previous,
    spike: point,
    next,
    previousDistanceMeters: previousDistance,
    nextDistanceMeters: nextDistance,
    bridgeDistanceMeters: bridgeDistance,
    detourMeters: detour,
    lateralMeters: lateral,
    reportedSpeedMetersPerSecond: point.reportedSpeedMetersPerSecond,
    speedPolicy: strictSpeed ? 'strict_low_reported_speed' : 'competing_low_reported_speed',
    score: detour * 2 + lateral - point.reportedSpeedMetersPerSecond * 0.25
  };
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
    finiteNumber(weak.rawPointId ?? weak.sourceRawPointId)));
  const rawPointIds = uniqueNumbers([...weakRawPointIds, point.sourceRawPointId]);
  return {
    previousRawPointId: previous.sourceRawPointId,
    recoveryRawPointId: point.sourceRawPointId,
    weakRawPointIds,
    rawPointIds,
    rawRange: rawPointRange(rawPointIds),
    bridgeDistanceMeters,
    reportedSpeedMetersPerSecond: reportedSpeed
  };
}

function positionSnapRecoveryProposal(candidate) {
  return {
    id: `position-snap:${candidate.previousRawPointId}-${candidate.recoveryRawPointId}`,
    scenario: 'position_snap_recovery',
    confidence: 0.82,
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: true,
    affectedMetricGates: ['route', 'distance', 'moving_time', 'elevation'],
    action: 'reset_position_snap_recovery_delta',
    localRebuild: 'position_snap_recovery_anchor',
    evidence: {
      previousRawPointId: candidate.previousRawPointId,
      recoveryRawPointId: candidate.recoveryRawPointId,
      weakRawPointIds: candidate.weakRawPointIds,
      bridgeDistanceMeters: rounded(candidate.bridgeDistanceMeters),
      reportedSpeedMetersPerSecond: rounded(candidate.reportedSpeedMetersPerSecond),
      countsDistance: false,
      countsMovingTime: false
    }
  };
}

function movingSpikeProposal(candidate) {
  const previousRawPointId = candidate.previous.sourceRawPointId;
  const spikeRawPointId = candidate.spike.sourceRawPointId;
  const nextRawPointId = candidate.next.sourceRawPointId;
  return {
    id: `moving-spike:${previousRawPointId}-${spikeRawPointId}-${nextRawPointId}`,
    scenario: 'moving_spike_cleanup',
    confidence: 0.82,
    rawRange: range(previousRawPointId, nextRawPointId),
    influenceRange: range(previousRawPointId, nextRawPointId),
    metricRange: range(previousRawPointId, nextRawPointId),
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'remove_single_point_spike',
    localRebuild: 'moving_spike_line_bridge',
    evidence: {
      previousRawPointId,
      spikeRawPointId,
      nextRawPointId,
      reportedSpeedMetersPerSecond: rounded(candidate.reportedSpeedMetersPerSecond),
      detourMeters: rounded(candidate.detourMeters),
      lateralMeters: rounded(candidate.lateralMeters),
      bridgeDistanceMeters: rounded(candidate.bridgeDistanceMeters),
      speedPolicy: candidate.speedPolicy
    }
  };
}

function stationaryDriftCandidates(rejectedPoints = [], lastProcessedRawPointId, config,
  finish = false) {
  return stationaryDriftGroups(rejectedPoints, config)
    .filter((group) => stationaryDriftGroupIsClosed(group, lastProcessedRawPointId, finish))
    .map((group) => stationaryDriftCandidate(group, config))
    .filter(Boolean);
}

function stationaryDriftGroups(rejectedPoints = [], config) {
  const points = cloneArray(rejectedPoints)
    .filter((point) => point?.reason === 'stationary_cloud_jitter')
    .filter((point) => hasValidLngLat(point))
    .map((point) => ({
      ...point,
      rawPointId: finiteNumber(point.rawPointId ?? point.sourceRawPointId),
      elapsedRealtimeNanos: finiteNumber(point.elapsedRealtimeNanos),
      accuracy: finiteNumber(point.accuracy),
      speed: finiteNumber(point.speed)
    }))
    .filter((point) =>
      Number.isFinite(point.rawPointId) && Number.isFinite(point.elapsedRealtimeNanos))
    .sort((a, b) => a.rawPointId - b.rawPointId);
  return consecutiveGroups(points, (left, right) =>
    elapsedSeconds(left.elapsedRealtimeNanos, right.elapsedRealtimeNanos)
      <= config.dwellDriftMaxExtensionGapSeconds);
}

function stationaryDriftOpenWindows(rejectedPoints = [], lastProcessedRawPointId, config) {
  const cursor = finiteNumber(lastProcessedRawPointId);
  if (!Number.isFinite(cursor)) return [];
  return stationaryDriftGroups(rejectedPoints, config)
    .filter((group) => group.at(-1)?.rawPointId === cursor)
    .map((group) => stationaryDriftCandidate(group, config))
    .filter(Boolean)
    .filter((candidate) => candidate.endRawPointId === finiteNumber(lastProcessedRawPointId))
    .map((candidate) => ({
      id: `stationary-drift-open:${candidate.startRawPointId}-${candidate.endRawPointId}`,
      scenario: 'stationary_drift_collapse',
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: 'awaiting_stationary_drift_exit'
    }));
}

function stationaryDriftGroupIsClosed(group, lastProcessedRawPointId, finish) {
  const endRawPointId = group.at(-1)?.rawPointId;
  if (!Number.isFinite(endRawPointId)) return false;
  if (finish) return true;
  const cursor = finiteNumber(lastProcessedRawPointId);
  return Number.isFinite(cursor) && endRawPointId < cursor;
}

function stationaryDriftCandidate(group, config) {
  if (group.length < config.dwellDriftMinRawPoints) return null;
  const durationSeconds = elapsedSeconds(group[0].elapsedRealtimeNanos,
    group.at(-1).elapsedRealtimeNanos);
  if (durationSeconds < config.dwellDriftMinDurationSeconds) return null;
  const finiteSpeeds = group.map((point) => point.speed).filter(Number.isFinite);
  const averageSpeed = finiteSpeeds.length === 0
    ? 0
    : finiteSpeeds.reduce((sum, speed) => sum + speed, 0) / finiteSpeeds.length;
  if (averageSpeed > config.dwellDriftMaxAverageSpeedMetersPerSecond) return null;
  const zeroSpeedRatio = finiteSpeeds.length === 0
    ? 0
    : finiteSpeeds.filter((speed) => speed <= 0.1).length / finiteSpeeds.length;
  if (zeroSpeedRatio < config.dwellDriftMinZeroSpeedRatio) return null;
  const bboxMeters = bboxDiagonalMeters(group);
  if (bboxMeters > config.dwellDriftMaxBboxMeters) return null;
  const netDistanceMeters = distanceMeters(group[0].lat, group[0].lng,
    group.at(-1).lat, group.at(-1).lng);
  if (netDistanceMeters > config.dwellDriftMaxNetDistanceMeters) return null;
  const corePoints = group.filter((point) =>
    Number.isFinite(point.accuracy) && point.accuracy >= config.dwellDriftCoreAccuracyMeters);
  if (corePoints.length < config.dwellDriftMinCoreSamples) return null;
  if (corePoints.length / group.length < 0.25) return null;
  const center = averageLatLng(group);
  const representative = nearestPoint(center, group);
  return {
    rawRange: range(group[0].rawPointId, group.at(-1).rawPointId),
    startRawPointId: group[0].rawPointId,
    endRawPointId: group.at(-1).rawPointId,
    rawPointIds: group.map((point) => point.rawPointId),
    coreRawPointIds: corePoints.map((point) => point.rawPointId),
    representativeRawPointId: representative?.rawPointId ?? group[0].rawPointId,
    durationSeconds,
    bboxMeters,
    netDistanceMeters,
    zeroSpeedRatio,
    averageSpeed,
    coreRatio: corePoints.length / group.length
  };
}

function stationaryDriftProposal(candidate) {
  return {
    id: `stationary-drift:${candidate.startRawPointId}-${candidate.endRawPointId}`,
    scenario: 'stationary_drift_collapse',
    confidence: rounded(clamp01(0.5
      + Math.min(1, candidate.durationSeconds / 180) * 0.15
      + (1 - Math.min(1, candidate.bboxMeters / 100)) * 0.15
      + (1 - Math.min(1, candidate.netDistanceMeters / 80)) * 0.1
      + Math.min(1, candidate.coreRatio) * 0.1)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'collapse_drift_cloud',
    localRebuild: 'stationary_drift_anchor',
    evidence: {
      rawPointCount: candidate.rawPointIds.length,
      coreRawPointCount: candidate.coreRawPointIds.length,
      coreStartRawPointId: candidate.coreRawPointIds[0] ?? null,
      coreEndRawPointId: candidate.coreRawPointIds.at(-1) ?? null,
      representativeRawPointId: candidate.representativeRawPointId,
      durationSeconds: rounded(candidate.durationSeconds),
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      netDistanceMeters: rounded(candidate.netDistanceMeters),
      zeroSpeedRatio: rounded(candidate.zeroSpeedRatio),
      averageSpeedMetersPerSecond: rounded(candidate.averageSpeed),
      coreRatio: rounded(candidate.coreRatio)
    }
  };
}

function restPhotoMicroMoveClosedCandidates(track, config, finish = false) {
  return nonOverlappingCandidates(restPhotoMicroMoveCandidates(track, config)
    .filter((candidate) =>
      finish || candidate.span.length >= config.restPhotoMicroMoveMaxTrackPoints));
}

function restPhotoMicroMoveOpenWindows(track, config, emittedProposalIds) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  if (!Number.isFinite(latestRawPointId)) return [];
  return restPhotoMicroMoveCandidates(track, config)
    .filter((candidate) => candidate.rawRange.endRawPointId === latestRawPointId)
    .filter((candidate) =>
      candidate.span.length < config.restPhotoMicroMoveMaxTrackPoints)
    .filter((candidate) =>
      !emittedProposalIds.includes(restPhotoMicroMoveProposalId(candidate)))
    .slice(-1)
    .map((candidate) => ({
      id: `rest-photo-open:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
      scenario: 'rest_photo_micro_move',
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: 'awaiting_micro_move_closure',
      evidence: {
        trackPointCount: candidate.span.length,
        pathMeters: rounded(candidate.pathMeters),
        netDistanceMeters: rounded(candidate.netDistanceMeters),
        bboxDiagonalMeters: rounded(candidate.bboxMeters),
        durationSeconds: rounded(candidate.durationSeconds)
      }
    }));
}

function restPhotoMicroMoveCandidates(track, config) {
  const candidates = [];
  if (!config.restPhotoMicroMoveEnabled) return candidates;
  for (let startIndex = 0; startIndex < track.length; startIndex++) {
    let best = null;
    const maxEndIndex = Math.min(track.length - 1,
      startIndex + config.restPhotoMicroMoveMaxTrackPoints - 1);
    for (let endIndex = startIndex + config.restPhotoMicroMoveMinTrackPoints - 1;
      endIndex <= maxEndIndex; endIndex++) {
      const span = track.slice(startIndex, endIndex + 1);
      const candidate = restPhotoMicroMoveCandidate(span, startIndex, endIndex, config);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

function restPhotoMicroMoveCandidate(span, startIndex, endIndex, config) {
  if (span.some((point) => !point.entersTrustedGpx || !hasValidLngLat(point))) return null;
  const rawRange = trackSpanRawPointRange(span);
  if (!rawRange) return null;
  const pathMeters = trackPathMeters(span);
  if (pathMeters < config.restPhotoMicroMoveMinPathMeters
      || pathMeters > config.restPhotoMicroMoveMaxPathMeters) {
    return null;
  }
  const netDistanceMeters = trackNetDistanceMeters(span);
  if (netDistanceMeters > config.restPhotoMicroMoveMaxEndpointDistanceMeters) return null;
  const pathNetRatio = pathMeters / Math.max(netDistanceMeters, 1);
  if (pathNetRatio < config.restPhotoMicroMoveMinPathNetRatio) return null;
  const bboxMeters = bboxDiagonalMeters(span);
  if (bboxMeters > config.restPhotoMicroMoveMaxBboxMeters) return null;
  const durationSeconds = trackSpanDurationSeconds(span);
  if (durationSeconds > config.restPhotoMicroMoveMaxDurationSeconds) return null;
  const lowSpeedCount = span.filter((point) =>
    point.reason === 'motion_supported_low_speed'
    || point.reason === 'moving_good_fix'
    || point.reason === 'stationary_anchor').length;
  const lowSpeedRatio = lowSpeedCount / span.length;
  if (lowSpeedRatio < 0.8) return null;
  return {
    scenario: 'rest_photo_micro_move',
    startIndex,
    endIndex,
    span,
    rawRange,
    pathMeters,
    netDistanceMeters,
    pathNetRatio,
    bboxMeters,
    durationSeconds,
    lowSpeedCount,
    lowSpeedRatio,
    score: pathMeters + span.length * 2
  };
}

function restPhotoMicroMoveProposal(candidate, config) {
  const rebuild = restPhotoMicroMoveRebuild(candidate, config);
  return {
    id: restPhotoMicroMoveProposalId(candidate),
    scenario: 'rest_photo_micro_move',
    confidence: rounded(clamp01(0.45
      + Math.min(1, candidate.pathMeters
        / Math.max(config.restPhotoMicroMoveMinPathMeters * 2, 1)) * 0.2
      + (1 - Math.min(1, candidate.bboxMeters
        / Math.max(config.restPhotoMicroMoveMaxBboxMeters, 1))) * 0.2
      + Math.min(1, candidate.lowSpeedRatio) * 0.15)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: rebuild.action,
    localRebuild: rebuild.localRebuild,
    evidence: {
      startTrackPointId: finiteNumber(candidate.span[0]?.trackPointId),
      endTrackPointId: finiteNumber(candidate.span.at(-1)?.trackPointId),
      trackPointCount: candidate.span.length,
      pathMeters: rounded(candidate.pathMeters),
      netDistanceMeters: rounded(candidate.netDistanceMeters),
      pathNetRatio: rounded(candidate.pathNetRatio),
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      durationSeconds: rounded(candidate.durationSeconds),
      lowSpeedRatio: rounded(candidate.lowSpeedRatio),
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: rebuild.outputTrackPointCount
    }
  };
}

function restPhotoMicroMoveProposalId(candidate) {
  return `rest-photo:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`;
}

function denseMainRouteClosedCandidates(track, config, finish = false) {
  return nonOverlappingCandidates(denseMainRouteCandidates(track, config)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < track.at(-1)?.sourceRawPointId));
}

function denseMainRouteOpenWindows(track, config, emittedProposalIds) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  if (!Number.isFinite(latestRawPointId)) return [];
  return denseMainRouteCandidates(track, config)
    .filter((candidate) => candidate.rawRange.endRawPointId === latestRawPointId)
    .filter((candidate) =>
      !emittedProposalIds.includes(denseMainRouteProposalId(candidate)))
    .slice(-1)
    .map((candidate) => ({
      id: `dense-main-route-open:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
      scenario: 'dense_main_route_settlement',
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: 'awaiting_dense_route_exit',
      evidence: {
        inputTrackPointCount: candidate.span.length,
        pathMeters: rounded(candidate.pathMeters),
        netDistanceMeters: rounded(candidate.netDistanceMeters),
        simplifiedPathMeters: rounded(candidate.simplifiedPathMeters),
        bboxDiagonalMeters: rounded(candidate.bboxMeters)
      }
    }));
}

function denseMainRouteCandidates(track, config) {
  const candidates = [];
  if (!config.denseMainRouteSettlementEnabled) return candidates;
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
  const rawRange = trackSpanRawPointRange(span);
  if (!rawRange) return null;
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
    rawRange,
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

function denseMainRouteProposal(candidate, config) {
  const keptRawPointIds = uniqueNumbers(candidate.keepIndexes
    .map((index) => finiteNumber(candidate.span[index]?.sourceRawPointId)));
  return {
    id: denseMainRouteProposalId(candidate),
    scenario: 'dense_main_route_settlement',
    confidence: 0.78,
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: 'preserve_dense_main_route_skeleton',
    localRebuild: 'dense_main_route_skeleton',
    evidence: {
      intent: 'forward_motion',
      keptRawPointIds,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: keptRawPointIds.length,
      pathMeters: rounded(candidate.pathMeters),
      netDistanceMeters: rounded(candidate.netDistanceMeters),
      simplifiedPathMeters: rounded(candidate.simplifiedPathMeters),
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      simplifyToleranceMeters: rounded(config.denseMainRouteSimplifyToleranceMeters)
    }
  };
}

function denseMainRouteProposalId(candidate) {
  return `dense-main-route:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`;
}

function roundTripRouteClosedCandidates(track, config, finish = false, denseAreaIntents = []) {
  return nonOverlappingCandidates(roundTripRouteCandidates(track, config, denseAreaIntents)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < track.at(-1)?.sourceRawPointId));
}

function compositeGapLocalSettlementClosedCandidates(track, config, finish = false,
  denseAreaIntents = []) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  return nonOverlappingCandidates(roundTripRouteRejectedCandidates(track, config,
    denseAreaIntents)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < latestRawPointId));
}

function roundTripRouteOpenWindows(track, config, emittedProposalIds) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  if (!Number.isFinite(latestRawPointId)) return [];
  return roundTripRouteCandidates(track, config)
    .filter((candidate) => candidate.rawRange.endRawPointId === latestRawPointId)
    .filter((candidate) =>
      !emittedProposalIds.includes(roundTripRouteProposalId(candidate)))
    .slice(-1)
    .map((candidate) => ({
      id: `round-trip-open:${candidate.rawRange.startRawPointId}-${candidate.turnRawPointId}-${candidate.rawRange.endRawPointId}`,
      scenario: candidate.scenario,
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: 'awaiting_round_trip_exit',
      evidence: {
        startRawPointId: candidate.startRawPointId,
        turnRawPointId: candidate.turnRawPointId,
        endRawPointId: candidate.endRawPointId,
        inputTrackPointCount: candidate.span.length,
        endpointDistanceMeters: rounded(candidate.endpointDistanceMeters),
        turnDistanceMeters: rounded(candidate.turnDistanceMeters),
        crossTrackMeters: rounded(candidate.crossTrackMeters),
        durationSeconds: rounded(candidate.durationSeconds),
        maxSampleGapSeconds: rounded(candidate.maxSampleGapSeconds)
      }
    }));
}

function roundTripRouteCandidates(track, config, denseAreaIntents = []) {
  if (!config.roundTripLineSimplifyEnabled && !config.roundTripSameRoadCollapseEnabled) {
    return [];
  }
  const candidates = [];
  for (let turnIndex = 1; turnIndex < track.length - 1; turnIndex++) {
    const turn = track[turnIndex];
    if (!canBeRoundTripPoint(turn)) continue;
    const startLowerRawPointId = turn.sourceRawPointId
      - config.roundTripLineMaxRawPointIdSpanBefore;
    const endUpperRawPointId = turn.sourceRawPointId
      + config.roundTripLineMaxRawPointIdSpanAfter;
    for (let startIndex = turnIndex - 1; startIndex >= 0; startIndex--) {
      const start = track[startIndex];
      if (start.sourceRawPointId < startLowerRawPointId) break;
      if (!canBeRoundTripPoint(start)) continue;
      for (let endIndex = turnIndex + 1; endIndex < track.length; endIndex++) {
        const end = track[endIndex];
        if (end.sourceRawPointId > endUpperRawPointId) break;
        if (!canBeRoundTripPoint(end)) continue;
        const candidate = roundTripRouteCandidate(track, startIndex, turnIndex, endIndex,
          config, denseAreaIntents);
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates.sort((a, b) =>
    b.score - a.score
    || a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || b.rawRange.endRawPointId - a.rawRange.endRawPointId);
}

function roundTripRouteRejectedCandidates(track, config, denseAreaIntents = []) {
  if (!config.roundTripLineSimplifyEnabled) return [];
  const candidates = [];
  for (let turnIndex = 1; turnIndex < track.length - 1; turnIndex++) {
    const turn = track[turnIndex];
    if (!canBeRoundTripPoint(turn)) continue;
    const startLowerRawPointId = turn.sourceRawPointId
      - config.roundTripLineMaxRawPointIdSpanBefore;
    const endUpperRawPointId = turn.sourceRawPointId
      + config.roundTripLineMaxRawPointIdSpanAfter;
    for (let startIndex = turnIndex - 1; startIndex >= 0; startIndex--) {
      const start = track[startIndex];
      if (start.sourceRawPointId < startLowerRawPointId) break;
      if (!canBeRoundTripPoint(start)) continue;
      for (let endIndex = turnIndex + 1; endIndex < track.length; endIndex++) {
        const end = track[endIndex];
        if (end.sourceRawPointId > endUpperRawPointId) break;
        if (!canBeRoundTripPoint(end)) continue;
        const candidate = roundTripRouteCandidate(track, startIndex, turnIndex, endIndex,
          config, denseAreaIntents, { includeCompositeBlocked: true });
        if (candidate?.rejected) candidates.push(candidate);
      }
    }
  }
  return candidates.sort((a, b) =>
    b.score - a.score
    || a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || b.rawRange.endRawPointId - a.rawRange.endRawPointId);
}

function roundTripRouteCandidate(track, startIndex, turnIndex, endIndex, config,
  denseAreaIntents = [], options = {}) {
  const span = track.slice(startIndex, endIndex + 1);
  if (span.length < config.roundTripLineMinTrackPoints) return null;
  const start = span[0];
  const turn = track[turnIndex];
  const end = span.at(-1);
  if (!hasValidLngLat(start) || !hasValidLngLat(turn) || !hasValidLngLat(end)) return null;
  const endpointDistanceMeters = distanceMeters(start.lat, start.lng, end.lat, end.lng);
  if (endpointDistanceMeters > config.roundTripLineMaxEndpointDistanceMeters) return null;
  const turnDistanceMeters = Math.min(
    distanceMeters(start.lat, start.lng, turn.lat, turn.lng),
    distanceMeters(end.lat, end.lng, turn.lat, turn.lng)
  );
  if (turnDistanceMeters < config.roundTripLineMinTurnDistanceMeters) return null;
  const crossTrackMeters = roundTripLineMaxCrossTrackMeters(span, start, turn, end);
  if (crossTrackMeters > config.roundTripLineMaxCrossTrackMeters) return null;
  const rawRange = trackSpanRawPointRange(span);
  if (!rawRange) return null;
  const durationSeconds = trackSpanDurationSeconds(span);
  const maxSampleGapSeconds = trackSpanMaxGapSeconds(span);
  const sameRoadDecision = roundTripSameRoadDecision({
    span,
    startIndex: 0,
    turnIndex: turnIndex - startIndex,
    endIndex: span.length - 1,
    rawRange,
    durationSeconds,
    maxSampleGapSeconds
  }, config, denseAreaIntents);
  const sameRoad = config.roundTripSameRoadCollapseEnabled
    && sameRoadDecision.allowed === true;
  if (!sameRoad && !config.roundTripLineSimplifyEnabled) return null;
  const compositeBlockReason = !sameRoad ? roundTripLineCompositeBlockReason({
    durationSeconds,
    maxSampleGapSeconds
  }, config, sameRoadDecision) : '';
  if (!sameRoad && compositeBlockReason && options.includeCompositeBlocked !== true) {
    return null;
  }
  const scenario = sameRoad ? 'same_road_round_trip' : 'round_trip_line';
  const simplifyToleranceMeters = sameRoad
    ? config.roundTripLineSimplifyToleranceMeters
    : config.roundTripLineSimplifyToleranceMeters;
  const keepIndexes = roundTripLineKeepIndexes({
    span,
    turnIndex: turnIndex - startIndex
  }, simplifyToleranceMeters);
  return {
    scenario,
    startIndex,
    turnIndex,
    endIndex,
    span,
    rawRange,
    startRawPointId: start.sourceRawPointId,
    turnRawPointId: turn.sourceRawPointId,
    endpointRawPointId: turn.shapeEndpointRawPointId ?? turn.sourceRawPointId,
    endRawPointId: end.sourceRawPointId,
    endpointDistanceMeters,
    turnDistanceMeters,
    crossTrackMeters,
    durationSeconds,
    maxSampleGapSeconds,
    simplifyToleranceMeters,
    sameRoadDecision,
    rejected: Boolean(compositeBlockReason),
    rejectionReason: compositeBlockReason || null,
    outputTrackPointCount: sameRoad
      ? sameRoadOutputTrackPointCount(span, turnIndex - startIndex, simplifyToleranceMeters)
      : keepIndexes.length,
    score: turnDistanceMeters * 2 - endpointDistanceMeters - crossTrackMeters
      + (sameRoad ? 30 : 0) + span.length
  };
}

function roundTripRouteProposal(candidate, config) {
  const sameRoad = candidate.scenario === 'same_road_round_trip';
  const sameRoadEvidence = candidate.sameRoadDecision?.evidence ?? {};
  return {
    id: roundTripRouteProposalId(candidate),
    scenario: candidate.scenario,
    confidence: rounded(roundTripRouteConfidence(candidate, config, sameRoadEvidence)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    action: sameRoad ? 'centerline_with_endpoint' : 'rdp_line_simplify',
    localRebuild: sameRoad ? 'same_road_centerline' : 'round_trip_polyline',
    evidence: {
      startRawPointId: candidate.startRawPointId,
      turnRawPointId: candidate.turnRawPointId,
      endpointRawPointId: candidate.endpointRawPointId,
      endRawPointId: candidate.endRawPointId,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: candidate.outputTrackPointCount,
      endpointDistanceMeters: rounded(candidate.endpointDistanceMeters),
      turnDistanceMeters: rounded(candidate.turnDistanceMeters),
      crossTrackMeters: rounded(candidate.crossTrackMeters),
      durationSeconds: rounded(candidate.durationSeconds),
      maxSampleGapSeconds: rounded(candidate.maxSampleGapSeconds),
      simplifyToleranceMeters: rounded(candidate.simplifyToleranceMeters),
      sameRoadBboxMeters: rounded(sameRoadEvidence.bboxMeters),
      sameRoadApproachPairDistanceMeters:
        rounded(sameRoadEvidence.approachPairDistanceMeters),
      sameRoadCollapseEligible: sameRoad,
      sameRoadCollapseReason: candidate.sameRoadDecision?.reason ?? 'not_evaluated',
      denseAreaIntents: denseAreaIntentNames(candidate.sameRoadDecision?.overlappingIntents),
      roundTripIntentSupported: candidate.sameRoadDecision?.roundTripIntentSupported === true
    }
  };
}

function compositeGapLocalSettlementProposal(candidate) {
  return {
    id: `composite-gap-local:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
    scenario: 'composite_gap_local_settlement',
    confidence: rounded(compositeGapLocalSettlementConfidence(candidate)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'round_trip_guard'],
    anchorRawPointIds: uniqueNumbers([
      candidate.turnRawPointId,
      candidate.endpointRawPointId
    ]),
    action: 'reject_round_trip_rewrite',
    localRebuild: 'local_settlement_pipeline',
    primaryEligible: false,
    evidence: {
      rejectedCandidate: 'round_trip_line',
      rejectionReason: candidate.rejectionReason,
      sameRoadCollapseReason: candidate.sameRoadDecision?.reason ?? 'not_evaluated',
      turnRawPointId: candidate.turnRawPointId,
      endpointRawPointId: candidate.endpointRawPointId,
      inputTrackPointCount: candidate.span.length,
      durationSeconds: rounded(candidate.durationSeconds),
      maxSampleGapSeconds: rounded(candidate.maxSampleGapSeconds),
      endpointDistanceMeters: rounded(candidate.endpointDistanceMeters),
      turnDistanceMeters: rounded(candidate.turnDistanceMeters),
      crossTrackMeters: rounded(candidate.crossTrackMeters),
      sameRoadBboxMeters: rounded(candidate.sameRoadDecision?.evidence?.bboxMeters),
      sameRoadApproachPairDistanceMeters:
        rounded(candidate.sameRoadDecision?.evidence?.approachPairDistanceMeters),
      denseAreaIntents: denseAreaIntentNames(candidate.sameRoadDecision?.overlappingIntents),
      roundTripIntentSupported: candidate.sameRoadDecision?.roundTripIntentSupported === true
    }
  };
}

function compositeGapLocalSettlementConfidence(candidate) {
  const durationScore = Math.min(1, (candidate.durationSeconds || 0) / 1800);
  const gapScore = Math.min(1, (candidate.maxSampleGapSeconds || 0) / 600);
  const noIntentScore = candidate.sameRoadDecision?.roundTripIntentSupported ? 0 : 0.2;
  return clamp01(0.45 + durationScore * 0.2 + gapScore * 0.2 + noIntentScore);
}

function roundTripRouteProposalId(candidate) {
  return `${candidate.scenario}:${candidate.startRawPointId}-${candidate.turnRawPointId}-${candidate.endRawPointId}`;
}

function enclosedLoopClusterSettlementClosedCandidates(track, config, finish = false) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  return nonOverlappingCandidates(enclosedLoopClusterSettlementCandidates(track, config)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < latestRawPointId));
}

function enclosedLoopClusterSettlementOpenWindows(track, config, emittedProposalIds) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  if (!Number.isFinite(latestRawPointId)) return [];
  return enclosedLoopClusterSettlementCandidates(track, config)
    .filter((candidate) => candidate.rawRange.endRawPointId === latestRawPointId)
    .filter((candidate) =>
      !emittedProposalIds.includes(enclosedLoopClusterSettlementProposalId(candidate)))
    .slice(-1)
    .map((candidate) => ({
      id: `enclosed-loop-open:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
      scenario: 'enclosed_loop_cluster_settlement',
      metricOwner: true,
      influenceRange: candidate.rawRange,
      rawRange: candidate.rawRange,
      reason: 'awaiting_enclosed_loop_exit',
      evidence: {
        inputTrackPointCount: candidate.span.length,
        outputTrackPointCount: candidate.settlement.outputTrackPointCount,
        removedTrackPointCount: candidate.settlement.removedTrackPointCount,
        bboxDiagonalMeters: rounded(candidate.bboxMeters),
        durationSeconds: rounded(candidate.durationSeconds)
      }
    }));
}

function enclosedLoopClusterSettlementCandidates(track, config) {
  if (!config.enclosedLoopSettlementEnabled) return [];
  const loopCandidates = closedLoopRoundTripCandidates(track, config, []);
  if (loopCandidates.length === 0) return [];
  return enclosedGapClusterCandidates(track, config)
    .filter((cluster) => cluster.bboxMeters <= config.enclosedLoopSettlementMaxBboxMeters)
    .filter((cluster) => loopCandidates.some((loop) =>
      rawRangeContains(loop.rawRange, cluster.rawRange)))
    .map((cluster) => {
      const settlement = enclosedLoopClusterSettlement(cluster,
        track[cluster.startIndex - 1] ?? null,
        track[cluster.endIndex + 1] ?? null,
        config);
      if (!settlement
          || settlement.removedTrackPointCount
            < config.enclosedLoopSettlementMinRemovedTrackPoints) {
        return null;
      }
      return {
        ...cluster,
        settlement,
        score: cluster.score + settlement.removedTrackPointCount * 100
      };
    })
    .filter(Boolean);
}

function enclosedLoopClusterSettlement(candidate, previousOutside, nextOutside, config) {
  const keepIndexes = enclosedLoopClusterKeepIndexes(candidate.span, previousOutside,
    nextOutside, config);
  if (keepIndexes.size >= candidate.span.length) return null;
  const keptRawPointIds = [...keepIndexes].sort((a, b) => a - b)
    .map((index) => finiteNumber(candidate.span[index]?.sourceRawPointId))
    .filter(Number.isFinite);
  const originalDistanceMeters = candidate.span.reduce((sum, point) =>
    sum + (point.countsDistance ? finiteNumber(point.distanceDeltaMeters) ?? 0 : 0), 0);
  return {
    keptRawPointIds,
    outputTrackPointCount: keptRawPointIds.length,
    removedTrackPointCount: candidate.span.length - keptRawPointIds.length,
    originalDistanceMeters,
    settledDistanceMeters: 0
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
  if (lastKeptIndex < span.length - 1) keep.add(span.length - 1);
  return keep;
}

function enclosedLoopClusterRepresentativeIndex(span, corridorStart, corridorEnd) {
  return span
    .map((point, index) => ({
      index,
      score: hasValidLngLat(corridorStart) && hasValidLngLat(corridorEnd)
          && hasValidLngLat(point)
        ? distanceToSegmentMeters(point, corridorStart, corridorEnd)
        : 0
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)[0]?.index ?? 0;
}

function enclosedLoopClusterSettlementProposal(candidate, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  const intentNames = denseAreaIntentNames(overlappingIntents);
  return {
    id: enclosedLoopClusterSettlementProposalId(candidate),
    scenario: 'enclosed_loop_cluster_settlement',
    confidence: 0.84,
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: true,
    hardBoundary: false,
    affectedMetricGates: ['route', 'distance', 'moving_time'],
    anchorRawPointIds: candidate.settlement.keptRawPointIds,
    action: 'compress_enclosed_loop_low_speed_drift',
    localRebuild: 'enclosed_loop_anchor_settlement',
    evidence: {
      keptRawPointIds: candidate.settlement.keptRawPointIds,
      inputTrackPointCount: candidate.span.length,
      outputTrackPointCount: candidate.settlement.outputTrackPointCount,
      removedTrackPointCount: candidate.settlement.removedTrackPointCount,
      originalDistanceMeters: rounded(candidate.settlement.originalDistanceMeters),
      settledDistanceMeters: rounded(candidate.settlement.settledDistanceMeters),
      gapRecoveryCount: candidate.gapRecoveryCount,
      stationaryAnchorCount: candidate.stationaryAnchorCount,
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      durationSeconds: rounded(candidate.durationSeconds),
      denseAreaIntents: intentNames,
      gapClusterIntentSupported: intentNames.includes('gap_cluster'),
      mixedIntentSupported: intentNames.includes('mixed')
    }
  };
}

function enclosedLoopClusterSettlementProposalId(candidate) {
  return `enclosed-loop-cluster:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`;
}

function denseAreaIntentClosedCandidates(track, config, finish = false) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  return denseAreaIntentCandidates(track, config)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < latestRawPointId);
}

function denseAreaIntentCandidates(track, config) {
  const candidates = [];
  if (!config.denseAreaIntentEnabled) return candidates;
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
  return nonOverlappingCandidates(candidates);
}

function denseAreaIntentCandidate(span, startIndex, endIndex, config) {
  const rawRange = trackSpanRawPointRange(span);
  if (!rawRange) return null;
  const pathMeters = trackPathMeters(span);
  const netDistanceMeters = trackNetDistanceMeters(span);
  const bboxMeters = bboxDiagonalMeters(span);
  const gapRecoveryCount = span.filter((point) => point.reason === 'gap_recovery').length;
  const stationaryAnchorCount = span.filter((point) =>
    point.reason === 'stationary_anchor'
    || point.reason === 'stationary_drift_anchor').length;
  const movingCount = span.filter((point) => point.countsDistance === true).length;
  const zeroDistanceCount = span.length - movingCount;
  const metrics = {
    span,
    pathMeters,
    netDistanceMeters,
    bboxMeters,
    gapRecoveryCount,
    stationaryAnchorCount,
    movingCount,
    zeroDistanceCount
  };
  const intent = denseAreaIntentName(metrics, config);
  const confidence = denseAreaIntentConfidence(intent, metrics, config);
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
      pathMeters: rounded(pathMeters),
      netDistanceMeters: rounded(netDistanceMeters),
      bboxDiagonalMeters: rounded(bboxMeters),
      gapRecoveryCount,
      stationaryAnchorCount,
      movingRatio: rounded(movingCount / Math.max(span.length, 1)),
      zeroDistanceRatio: rounded(zeroDistanceCount / Math.max(span.length, 1))
    },
    score: span.length * 10 + pathMeters
  };
}

function denseAreaIntentProposal(candidate) {
  return {
    id: denseAreaIntentProposalId(candidate),
    scenario: 'dense_area_intent',
    confidence: candidate.confidence,
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'scheduler_context'],
    action: 'classify_dense_area_intent',
    localRebuild: 'dense_area_intent_classifier',
    evidence: {
      ...candidate.evidence,
      plannedSettlement: denseAreaIntentPlannedSettlement(candidate.intent)
    }
  };
}

function denseAreaIntentProposalWithReview(proposal, metricReviewProposals = []) {
  const overlappingMetricProposals = metricReviewProposals
    .filter((item) => item.metricOwner !== false)
    .filter((item) => rangesOverlap(item.rawRange, proposal.rawRange));
  const observedMetricScenarios = uniqueStrings(overlappingMetricProposals
    .map((item) => item.scenario));
  const conflictReview = denseAreaIntentConflictReview(proposal, overlappingMetricProposals);
  return {
    ...proposal,
    evidence: {
      ...proposal.evidence,
      observedMetricScenarios,
      conflictReview
    }
  };
}

function denseAreaIntentConflictReview(proposal, overlappingMetricProposals) {
  const intent = proposal.evidence?.intent;
  if (intent !== 'forward_motion') return [];
  return overlappingMetricProposals
    .filter((item) => item.scenario === 'rest_photo_micro_move')
    .map((item) => ({
      conflict: 'local_micro_move_overrides_dense_forward',
      rawRange: item.rawRange,
      scenario: item.scenario,
      action: item.action,
      localRebuild: item.localRebuild,
      resolution: 'prefer_local_rest_photo_micro_move',
      reviewOnly: true
    }));
}

function denseAreaIntentProposalId(candidate) {
  return `dense-area-intent:${candidate.intent}:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`;
}

function canBeDenseAreaIntentPoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && !isTransportTrackReason(point.reason);
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
      return rounded(clamp01(0.55
        + Math.min(1, metrics.gapRecoveryCount
          / Math.max(config.enclosedGapClusterMinGapRecoveries + 2, 1)) * 0.25
        + Math.min(1, metrics.stationaryAnchorCount
          / Math.max(config.enclosedGapClusterMinStationaryAnchors + 2, 1)) * 0.2));
    case 'round_trip':
      return rounded(clamp01(0.55
        + (1 - Math.min(1, metrics.netDistanceMeters
          / Math.max(metrics.pathMeters, 1))) * 0.3
        + Math.min(1, metrics.pathMeters
          / Math.max(config.denseAreaIntentRoundTripMinPathMeters * 2, 1)) * 0.15));
    case 'stationary':
      return rounded(clamp01(0.55
        + (1 - Math.min(1, metrics.netDistanceMeters
          / Math.max(config.denseAreaIntentStationaryMaxNetDistanceMeters, 1))) * 0.25
        + (metrics.zeroDistanceCount / Math.max(metrics.span.length, 1)) * 0.2));
    case 'forward_motion':
      return rounded(clamp01(0.55
        + Math.min(1, metrics.netDistanceMeters
          / Math.max(config.denseAreaIntentForwardMinNetDistanceMeters * 2, 1)) * 0.25
        + (metrics.movingCount / Math.max(metrics.span.length, 1)) * 0.2));
    default:
      return 0.5;
  }
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

function denseAreaIntentsForRange(denseAreaIntents, rawRange) {
  return (denseAreaIntents || [])
    .map((item) => ({
      intent: item.intent ?? item.evidence?.intent,
      rawRange: item.rawRange,
      confidence: finiteNumber(item.confidence)
    }))
    .filter((item) => item.intent && item.rawRange && rangesOverlap(item.rawRange, rawRange));
}

function denseAreaIntentNames(denseAreaIntents) {
  return uniqueStrings((denseAreaIntents || []).map((item) => item.intent));
}

function enclosedGapClusterClosedCandidates(track, config, finish = false,
  denseAreaIntents = []) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  return nonOverlappingCandidates(enclosedGapClusterCandidates(track, config,
    denseAreaIntents)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < latestRawPointId));
}

function enclosedGapClusterCandidates(track, config) {
  const candidates = [];
  if (!config.enclosedGapClusterEnabled) return candidates;
  const gapIndexes = track
    .map((point, index) => point.reason === 'gap_recovery' ? index : -1)
    .filter((index) => index >= 0);
  for (let startGap = 0; startGap < gapIndexes.length; startGap++) {
    for (let endGap = startGap + config.enclosedGapClusterMinGapRecoveries - 1;
      endGap < gapIndexes.length; endGap++) {
      const startIndex = Math.max(0, gapIndexes[startGap] - 4);
      const endIndex = Math.min(track.length - 1, gapIndexes[endGap] + 10);
      const span = track.slice(startIndex, endIndex + 1);
      const rawRange = trackSpanRawPointRange(span);
      if (!rawRange) continue;
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
        segmentIds: uniqueNumbers(span.map((point) => finiteNumber(point.segmentId))),
        score: gapRecoveryCount * 100 + stationaryAnchorCount * 10 + durationSeconds / 60
      });
    }
  }
  return candidates;
}

function enclosedGapClusterProposal(candidate, config, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  const intentNames = denseAreaIntentNames(overlappingIntents);
  return {
    id: `enclosed-gap-cluster:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
    scenario: 'enclosed_gap_cluster',
    confidence: rounded(clamp01(0.45
      + Math.min(1, candidate.gapRecoveryCount
        / Math.max(config.enclosedGapClusterMinGapRecoveries + 2, 1)) * 0.25
      + Math.min(1, candidate.stationaryAnchorCount
        / Math.max(config.enclosedGapClusterMinStationaryAnchors + 2, 1)) * 0.15
      + (1 - Math.min(1, candidate.bboxMeters
        / Math.max(config.enclosedGapClusterMaxBboxMeters, 1))) * 0.15)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'gap_cluster_diagnostic'],
    anchorRawPointIds: uniqueNumbers(candidate.span
      .filter((point) => point.reason === 'gap_recovery'
        || point.reason === 'stationary_anchor'
        || point.reason === 'stationary_drift_anchor')
      .map((point) => finiteNumber(point.sourceRawPointId))),
    action: 'classify_enclosed_gap_cluster',
    localRebuild: 'gap_stationary_cluster_diagnostic',
    evidence: {
      startTrackPointId: finiteNumber(candidate.span[0]?.trackPointId),
      endTrackPointId: finiteNumber(candidate.span.at(-1)?.trackPointId),
      trackPointCount: candidate.span.length,
      gapRecoveryCount: candidate.gapRecoveryCount,
      stationaryAnchorCount: candidate.stationaryAnchorCount,
      segmentIds: candidate.segmentIds,
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      durationSeconds: rounded(candidate.durationSeconds),
      denseAreaIntents: intentNames,
      gapClusterIntentSupported: intentNames.includes('gap_cluster'),
      mixedIntentSupported: intentNames.includes('mixed')
    }
  };
}

function closedLoopRoundTripClosedCandidates(track, config, finish = false,
  denseAreaIntents = []) {
  const latestRawPointId = finiteNumber(track.at(-1)?.sourceRawPointId);
  const blockedRanges = roundTripRouteCandidates(track, config, denseAreaIntents)
    .map((candidate) => candidate.rawRange)
    .filter(Boolean);
  return nonOverlappingCandidates(closedLoopRoundTripCandidates(track, config, blockedRanges)
    .filter((candidate) =>
      finish || candidate.rawRange.endRawPointId < latestRawPointId));
}

function closedLoopRoundTripCandidates(track, config, blockedRanges = []) {
  const candidates = [];
  if (!config.closedLoopRoundTripEnabled) return candidates;
  for (let startIndex = 0; startIndex < track.length; startIndex++) {
    let best = null;
    const maxEndIndex = Math.min(track.length - 1,
      startIndex + config.closedLoopRoundTripMaxTrackPoints - 1);
    for (let endIndex = startIndex + config.closedLoopRoundTripMinTrackPoints - 1;
      endIndex <= maxEndIndex; endIndex++) {
      const span = track.slice(startIndex, endIndex + 1);
      const rawRange = trackSpanRawPointRange(span);
      if (!rawRange) continue;
      if (rawRange.endRawPointId - rawRange.startRawPointId
          > config.closedLoopRoundTripMaxRawPointIdSpan) {
        break;
      }
      if (blockedRanges.some((range) => rangesOverlap(rawRange, range))) continue;
      const candidate = closedLoopRoundTripCandidate(span, startIndex, endIndex, rawRange,
        config);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates;
}

function closedLoopRoundTripCandidate(span, startIndex, endIndex, rawRange, config) {
  if (span.some((point) => !canBeRoundTripPoint(point))) return null;
  const pathMeters = trackPathMeters(span);
  if (pathMeters < config.closedLoopRoundTripMinPathMeters) return null;
  const netDistanceMeters = trackNetDistanceMeters(span);
  if (netDistanceMeters > config.closedLoopRoundTripMaxEndpointDistanceMeters) return null;
  if (netDistanceMeters / Math.max(pathMeters, 1)
      > config.closedLoopRoundTripMaxNetPathRatio) {
    return null;
  }
  const bboxMeters = bboxDiagonalMeters(span);
  if (bboxMeters < config.closedLoopRoundTripMinBboxMeters
      || bboxMeters > config.closedLoopRoundTripMaxBboxMeters) {
    return null;
  }
  return {
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
}

function closedLoopRoundTripProposal(candidate, config, denseAreaIntentProposals = []) {
  const start = candidate.span[0];
  const end = candidate.span.at(-1);
  const overlappingIntents = denseAreaIntentProposals
    .filter((proposal) => rangesOverlap(proposal.rawRange, candidate.rawRange));
  const netScore = 1 - Math.min(1,
    candidate.netDistanceMeters
      / Math.max(config.closedLoopRoundTripMaxEndpointDistanceMeters, 1));
  const pathScore = Math.min(1,
    candidate.pathMeters / Math.max(config.closedLoopRoundTripMinPathMeters * 2, 1));
  const bboxScore = Math.min(1,
    candidate.bboxMeters / Math.max(config.closedLoopRoundTripMinBboxMeters * 2, 1));
  return {
    id: `closed-loop-round-trip:${candidate.rawRange.startRawPointId}-${candidate.rawRange.endRawPointId}`,
    scenario: 'closed_loop_round_trip',
    confidence: rounded(clamp01(0.45 + netScore * 0.25
      + pathScore * 0.2 + bboxScore * 0.1)),
    rawRange: candidate.rawRange,
    influenceRange: candidate.rawRange,
    metricRange: candidate.rawRange,
    metricOwner: false,
    hardBoundary: false,
    affectedMetricGates: [],
    compatibilityTags: ['diagnostic_context', 'round_trip_diagnostic'],
    action: 'classify_loop_without_rewrite',
    localRebuild: 'round_trip_diagnostic',
    evidence: {
      startTrackPointId: finiteNumber(start?.trackPointId),
      endTrackPointId: finiteNumber(end?.trackPointId),
      trackPointCount: candidate.span.length,
      pathMeters: rounded(candidate.pathMeters),
      netDistanceMeters: rounded(candidate.netDistanceMeters),
      bboxDiagonalMeters: rounded(candidate.bboxMeters),
      durationSeconds: rounded(candidate.durationSeconds),
      maxEndpointDistanceMeters: rounded(config.closedLoopRoundTripMaxEndpointDistanceMeters),
      denseAreaIntents: overlappingIntents.map((proposal) => proposal.evidence?.intent)
        .filter(Boolean),
      roundTripIntentSupported: overlappingIntents
        .some((proposal) => proposal.evidence?.intent === 'round_trip')
    }
  };
}

function canBeRoundTripPoint(point) {
  return hasValidLngLat(point)
    && point.entersTrustedGpx === true
    && !isTransportTrackReason(point.reason);
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

function roundTripSameRoadDecision(candidate, config, denseAreaIntents = []) {
  const overlappingIntents = denseAreaIntentsForRange(denseAreaIntents, candidate.rawRange);
  const roundTripIntentSupported = overlappingIntents
    .some((intent) => intent.intent === 'round_trip');
  const rejected = (reason, evidence = null) => ({
    allowed: false,
    reason,
    evidence,
    roundTripIntentSupported,
    overlappingIntents
  });
  if (!config.roundTripSameRoadCollapseEnabled) return rejected('same_road_disabled');
  const turnSpanIndex = candidate.turnIndex;
  if (turnSpanIndex <= 1 || turnSpanIndex >= candidate.span.length - 2) {
    return rejected('turn_not_inside_span');
  }
  const beforeApproach = candidate.span[turnSpanIndex - 1];
  const afterApproach = candidate.span[turnSpanIndex + 1];
  if (!hasValidLngLat(beforeApproach) || !hasValidLngLat(afterApproach)) {
    return rejected('missing_approach_coordinates');
  }
  const sameRoadPoints = candidate.span.filter((point, index) =>
    index !== turnSpanIndex && hasValidLngLat(point));
  if (sameRoadPoints.length < 4) return rejected('too_few_same_road_points');
  const evidence = {
    bboxMeters: bboxDiagonalMeters(sameRoadPoints),
    approachPairDistanceMeters: distanceMeters(beforeApproach.lat, beforeApproach.lng,
      afterApproach.lat, afterApproach.lng)
  };
  if (evidence.bboxMeters > config.roundTripSameRoadMaxBboxMeters) {
    return rejected('same_road_bbox_too_wide', evidence);
  }
  if (evidence.approachPairDistanceMeters
      > config.roundTripSameRoadMaxApproachPairDistanceMeters) {
    return rejected('same_road_approach_pair_too_wide', evidence);
  }
  if (roundTripIntentSupported) {
    return {
      allowed: true,
      reason: 'round_trip_intent_supported',
      evidence,
      roundTripIntentSupported,
      overlappingIntents
    };
  }
  if (candidate.durationSeconds > config.roundTripSameRoadNoIntentMaxDurationSeconds) {
    return rejected('missing_round_trip_intent_long_span', evidence);
  }
  if (candidate.maxSampleGapSeconds > config.roundTripSameRoadNoIntentMaxSampleGapSeconds) {
    return rejected('missing_round_trip_intent_large_gap', evidence);
  }
  if (evidence.bboxMeters > config.roundTripSameRoadNoIntentMaxBboxMeters) {
    return rejected('missing_round_trip_intent_wide_corridor', evidence);
  }
  if (evidence.approachPairDistanceMeters
      > config.roundTripSameRoadNoIntentMaxApproachPairDistanceMeters) {
    return rejected('missing_round_trip_intent_wide_approach_pair', evidence);
  }
  return {
    allowed: true,
    reason: 'strong_same_road_geometry_without_round_trip_intent',
    evidence,
    roundTripIntentSupported,
    overlappingIntents
  };
}

function roundTripLineCompositeBlockReason(candidate, config, sameRoadDecision) {
  if (sameRoadDecision?.allowed === true
      || sameRoadDecision?.roundTripIntentSupported === true) {
    return '';
  }
  if (candidate.durationSeconds > config.roundTripLineNoIntentMaxDurationSeconds) {
    return 'missing_round_trip_intent_long_composite_span';
  }
  if (candidate.maxSampleGapSeconds > config.roundTripLineNoIntentMaxSampleGapSeconds) {
    return 'missing_round_trip_intent_large_composite_gap';
  }
  return '';
}

function roundTripRouteConfidence(candidate, config, sameRoadEvidence) {
  const endpointScore = 1 - Math.min(1,
    candidate.endpointDistanceMeters / Math.max(config.roundTripLineMaxEndpointDistanceMeters, 1));
  const crossTrackScore = 1 - Math.min(1,
    candidate.crossTrackMeters / Math.max(config.roundTripLineMaxCrossTrackMeters, 1));
  const turnScore = Math.min(1,
    candidate.turnDistanceMeters / Math.max(config.roundTripLineMinTurnDistanceMeters * 2, 1));
  const sameRoadScore = sameRoadEvidence
    ? 1 - Math.min(1,
        finiteNumber(sameRoadEvidence.approachPairDistanceMeters)
          / Math.max(config.roundTripSameRoadMaxApproachPairDistanceMeters, 1))
    : 0.5;
  return clamp01(0.4
    + endpointScore * 0.2
    + crossTrackScore * 0.15
    + turnScore * 0.1
    + sameRoadScore * 0.15);
}

function sameRoadOutputTrackPointCount(span, turnIndex, simplifyToleranceMeters) {
  const beforePath = span.slice(0, turnIndex).map((point, index) => ({ point, index }));
  const afterPath = span.slice(turnIndex + 1)
    .map((point, offset) => ({ point, index: turnIndex + 1 + offset }))
    .reverse();
  const samples = sameRoadCenterlineSamples(beforePath, afterPath);
  if (samples.length === 0) return 1;
  const keepSampleIndexes = new Set([0, samples.length - 1]);
  simplifySpanByDistance(samples, 0, samples.length - 1, simplifyToleranceMeters,
    keepSampleIndexes);
  const stations = dedupeCenterlineStations([...keepSampleIndexes]
    .sort((a, b) => a - b)
    .map((index) => samples[index]));
  const beforeIndexes = uniqueNumbers(stations.map((station) => finiteNumber(station.beforeIndex)));
  const afterIndexes = uniqueNumbers(stations.map((station) => finiteNumber(station.afterIndex)));
  return uniqueNumbers([...beforeIndexes, turnIndex, ...afterIndexes]).length;
}

function roundTripLineKeepIndexes(candidate, simplifyToleranceMeters) {
  const keepIndexes = new Set([0, candidate.turnIndex, candidate.span.length - 1]);
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
    if (maxDistance > simplifyToleranceMeters) {
      keepIndexes.add(maxIndex);
      simplifyRange(startIndex, maxIndex);
      simplifyRange(maxIndex, endIndex);
    }
  };
  simplifyRange(0, candidate.turnIndex);
  simplifyRange(candidate.turnIndex, candidate.span.length - 1);
  return [...keepIndexes].sort((a, b) => a - b);
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
    .filter(Number.isFinite)
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
  if (fraction >= 1) return pathSample(path.at(-1), path.at(-1).index);
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

function restPhotoMicroMoveRebuild(candidate, config) {
  const shortFoldback = candidate.bboxMeters <= config.restPhotoMicroMoveCollapseMaxBboxMeters
    && candidate.netDistanceMeters <= config.restPhotoMicroMoveCollapseMaxNetDistanceMeters
    && candidate.pathMeters <= config.restPhotoMicroMoveCollapseMaxPathMeters;
  const longRestDrift = candidate.durationSeconds
      >= config.restPhotoMicroMoveLongCollapseMinDurationSeconds
    && candidate.bboxMeters <= config.restPhotoMicroMoveLongCollapseMaxBboxMeters
    && candidate.netDistanceMeters <= config.restPhotoMicroMoveLongCollapseMaxNetDistanceMeters
    && candidate.pathMeters <= config.restPhotoMicroMoveLongCollapseMaxPathMeters;
  if (shortFoldback || longRestDrift) {
    return {
      action: 'collapse_micro_move_to_rest_anchor',
      localRebuild: 'rest_photo_micro_move_anchor',
      outputTrackPointCount: 1
    };
  }
  return {
    action: 'simplify_micro_move_shape',
    localRebuild: 'rest_photo_micro_move_simplifier',
    outputTrackPointCount: Math.min(3, candidate.span.length)
  };
}

function movingSpikeOpenWindows(track, emittedProposalIds) {
  if (track.length < 2) return [];
  const latest = track.at(-1);
  const previous = track.at(-2);
  if (!latest?.entersTrustedGpx || !previous?.entersTrustedGpx) return [];
  const alreadyResolved = emittedProposalIds.some((id) =>
    id.endsWith(`-${latest.sourceRawPointId}`));
  if (alreadyResolved) return [];
  return [
    {
      id: `moving-spike-open:${previous.sourceRawPointId}-${latest.sourceRawPointId}`,
      scenario: 'moving_spike_cleanup',
      metricOwner: true,
      influenceRange: range(latest.sourceRawPointId, latest.sourceRawPointId),
      rawRange: range(previous.sourceRawPointId, latest.sourceRawPointId),
      reason: 'awaiting_next_point'
    }
  ];
}

function range(startRawPointId, endRawPointId) {
  return { startRawPointId, endRawPointId };
}

function trackSpanRawPointRange(span) {
  const rawPointIds = uniqueNumbers(span.map((point) =>
    finiteNumber(point.sourceRawPointId ?? point.rawPointId)));
  return rawPointIds.length > 0 ? rawPointRange(rawPointIds) : null;
}

function rawPointRange(rawPointIds) {
  const values = rawPointIds.filter(Number.isFinite);
  return range(Math.min(...values), Math.max(...values));
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort();
}

function normalizedRawPointTimeline(rawPointTimeline = []) {
  return cloneArray(rawPointTimeline)
    .map((point) => ({
      rawPointId: finiteNumber(point?.rawPointId),
      elapsedRealtimeNanos: finiteNumber(point?.elapsedRealtimeNanos)
    }))
    .filter((point) =>
      Number.isFinite(point.rawPointId) && Number.isFinite(point.elapsedRealtimeNanos))
    .sort((a, b) => a.elapsedRealtimeNanos - b.elapsedRealtimeNanos
      || a.rawPointId - b.rawPointId);
}

function rawPointIdForElapsedRealtime(timeline, elapsedRealtimeNanos) {
  if (!Number.isFinite(elapsedRealtimeNanos)) return null;
  const pointAtOrAfter = timeline.find((point) =>
    point.elapsedRealtimeNanos >= elapsedRealtimeNanos);
  return pointAtOrAfter?.rawPointId ?? null;
}

function nonOverlappingCandidates(candidates) {
  const accepted = [];
  for (const candidate of [...candidates].sort((a, b) =>
    b.score - a.score
    || a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || a.rawRange.endRawPointId - b.rawRange.endRawPointId)) {
    if (accepted.some((item) => rangesOverlap(item.rawRange, candidate.rawRange))) continue;
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.rawRange.startRawPointId - b.rawRange.startRawPointId
    || a.rawRange.endRawPointId - b.rawRange.endRawPointId);
}

function consecutiveGroups(points, isAdjacent) {
  const groups = [];
  let current = [];
  for (const point of points) {
    const previous = current.at(-1);
    if (previous && !isAdjacent(previous, point)) {
      groups.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function rangesOverlap(left, right) {
  return left.startRawPointId <= right.endRawPointId
    && right.startRawPointId <= left.endRawPointId;
}

function rawRangeContains(parent, child) {
  return parent.startRawPointId <= child.startRawPointId
    && parent.endRawPointId >= child.endRawPointId;
}

function isTransportTrackReason(reason) {
  return reason === 'recovery_transport_suspected_kept'
    || reason === 'transport_suspected_kept';
}

function hasValidLngLat(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function averageLatLng(points) {
  const valid = points.filter(hasValidLngLat);
  if (valid.length === 0) return null;
  return {
    lat: valid.reduce((sum, point) => sum + point.lat, 0) / valid.length,
    lng: valid.reduce((sum, point) => sum + point.lng, 0) / valid.length
  };
}

function weightedCenter(points) {
  let weight = 0;
  let lat = 0;
  let lng = 0;
  for (const point of points) {
    const pointWeight = 1 / Math.max(finiteNumber(point.accuracy) ?? 5, 5);
    weight += pointWeight;
    lat += point.lat * pointWeight;
    lng += point.lng * pointWeight;
  }
  const center = { lat: lat / weight, lng: lng / weight };
  const radiusMeters = points.reduce((max, point) =>
    Math.max(max, distanceMeters(center.lat, center.lng, point.lat, point.lng)), 0);
  return { ...center, weight, radiusMeters };
}

function nearestPoint(target, points) {
  if (!target) return null;
  return [...points].filter(hasValidLngLat).sort((a, b) =>
    distanceMeters(target.lat, target.lng, a.lat, a.lng)
      - distanceMeters(target.lat, target.lng, b.lat, b.lng)
    || a.rawPointId - b.rawPointId
    || a.sourceRawPointId - b.sourceRawPointId)[0] ?? null;
}

function trackPathMeters(span) {
  let total = 0;
  for (let index = 1; index < span.length; index++) {
    if (!hasValidLngLat(span[index - 1]) || !hasValidLngLat(span[index])) continue;
    total += distanceMeters(span[index - 1].lat, span[index - 1].lng,
      span[index].lat, span[index].lng);
  }
  return total;
}

function trackNetDistanceMeters(span) {
  if (span.length < 2 || !hasValidLngLat(span[0]) || !hasValidLngLat(span.at(-1))) return 0;
  return distanceMeters(span[0].lat, span[0].lng, span.at(-1).lat, span.at(-1).lng);
}

function bboxDiagonalMeters(points) {
  const valid = points.filter(hasValidLngLat);
  if (valid.length === 0) return 0;
  const lats = valid.map((point) => point.lat);
  const lngs = valid.map((point) => point.lng);
  return distanceMeters(Math.min(...lats), Math.min(...lngs),
    Math.max(...lats), Math.max(...lngs));
}

function trackSpanDurationSeconds(span) {
  return elapsedSeconds(span[0]?.elapsedRealtimeNanos, span.at(-1)?.elapsedRealtimeNanos);
}

function trackSpanMaxGapSeconds(span) {
  let maxGapSeconds = 0;
  for (let index = 1; index < span.length; index++) {
    maxGapSeconds = Math.max(maxGapSeconds,
      elapsedSeconds(span[index - 1]?.elapsedRealtimeNanos, span[index]?.elapsedRealtimeNanos));
  }
  return maxGapSeconds;
}

function elapsedSeconds(startElapsedRealtimeNanos, endElapsedRealtimeNanos) {
  const start = finiteNumber(startElapsedRealtimeNanos);
  const end = finiteNumber(endElapsedRealtimeNanos);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, (end - start) / 1_000_000_000)
    : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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

function distanceToSegmentMeters(point, start, end) {
  const ax = 0;
  const ay = 0;
  const bx = localEastMeters(start, end);
  const by = localNorthMeters(start, end);
  const px = localEastMeters(start, point);
  const py = localNorthMeters(start, point);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projectionX = ax + t * dx;
  const projectionY = ay + t * dy;
  return Math.hypot(px - projectionX, py - projectionY);
}

function localEastMeters(origin, point) {
  const averageLat = (origin.lat + point.lat) / 2;
  return toRadians(point.lng - origin.lng) * EARTH_RADIUS_METERS
    * Math.cos(toRadians(averageLat));
}

function localNorthMeters(origin, point) {
  return toRadians(point.lat - origin.lat) * EARTH_RADIUS_METERS;
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

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => structuredCloneFallback(item)) : [];
}

function structuredCloneFallback(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value;
}
