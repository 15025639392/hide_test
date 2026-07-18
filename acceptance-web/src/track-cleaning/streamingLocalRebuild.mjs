const EARTH_RADIUS_METERS = 6_371_000;

// L4 (device recorder mode): the real-time on-device use case records for 5+
// hours, so the full output track cannot be held in RAM. Each advance already
// exposes lastAppliedProductTrackPoints (the points newly committed this
// advance) — the natural flush stream the app persists to its GPX/store. In
// flush mode we stop retaining the cumulative committedTrack; the emitted
// stream reconstructs exactly the offline committedTrack (verified byte-
// identical by the device-mode golden). Default OFF (offline/oracle: retain
// everything, tests/replay unchanged). Set DEVICE_FLUSH=1 to enable.
// Browser-safe env read: `process` is Node-only; in the web app it is undefined.
function readEnv(name) {
  return (typeof process !== 'undefined' && process.env) ? process.env[name] : undefined;
}
const DEVICE_FLUSH = readEnv('DEVICE_FLUSH') === '1'
  || readEnv('DEVICE_FLUSH') === 'true';
const DEVICE_DEDUP_WINDOW = Number(readEnv('DEVICE_DEDUP_WINDOW')) || 1024;

export const STREAMING_LOCAL_REBUILD_VERSION = 'streaming-local-rebuild-v0';

export function createStreamingLocalRebuildState(overrides = {}) {
  return {
    version: STREAMING_LOCAL_REBUILD_VERSION,
    committedTrack: cloneArray(overrides.committedTrack),
    emittedRawPointIds: cloneArray(overrides.emittedRawPointIds)
      .map((value) => finiteNumber(value))
      .filter(Number.isFinite),
    emittedRawPointIdsEvicted: finiteNumber(overrides.emittedRawPointIdsEvicted) ?? 0,
    trackPointId: finiteNumber(overrides.trackPointId) ?? 0,
    lastAppliedProductTrackPoints: cloneArray(overrides.lastAppliedProductTrackPoints),
    lastAppliedOwnershipRangeCount:
      finiteNumber(overrides.lastAppliedOwnershipRangeCount) ?? 0,
    unsupportedScenarioCount: finiteNumber(overrides.unsupportedScenarioCount) ?? 0,
    stats: {
      productTrackPointCount: finiteNumber(overrides.stats?.productTrackPointCount) ?? 0,
      totalDistanceMeters: finiteNumber(overrides.stats?.totalDistanceMeters) ?? 0,
      movingTimeSeconds: finiteNumber(overrides.stats?.movingTimeSeconds) ?? 0
    }
  };
}

export function applyStreamingLocalRebuild(
  previousState = {},
  baseKernel = {},
  scenarioSettlementSession = {}
) {
  const state = createStreamingLocalRebuildState(previousState);
  const next = {
    ...state,
    committedTrack: [...state.committedTrack],
    emittedRawPointIds: [...state.emittedRawPointIds],
    lastAppliedProductTrackPoints: [],
    // Running totals (see appendProductPoint). Carried from the prior advance
    // and incremented per newly committed point instead of re-reducing the
    // whole committedTrack each advance — same summation order, byte-identical,
    // and O(1) per point instead of O(n). Also decouples the metrics from
    // committedTrack retention so device mode can flush the output.
    stats: { ...state.stats }
  };
  const proposalsById = new Map((scenarioSettlementSession.lastSettlementPlan?.activeProposals || [])
    .map((proposal) => [String(proposal.id), proposal]));
  const rawPointsById = rawPointEvidenceById(baseKernel);

  for (const ownership of scenarioSettlementSession
    .settlementState?.lastAppliedMetricOwnershipRanges || []) {
    const range = normalizeRange(ownership.range);
    if (!range) continue;
    const proposal = ownership.proposalId === null || ownership.proposalId === undefined
      ? null
      : proposalsById.get(String(ownership.proposalId));
    const rebuilt = rebuildOwnershipRange(ownership, range, proposal, baseKernel, rawPointsById);
    if (rebuilt.unsupported) next.unsupportedScenarioCount++;
    for (const point of rebuilt.points) appendProductPoint(next, point);
  }

  next.lastAppliedOwnershipRangeCount =
    scenarioSettlementSession.settlementState?.lastAppliedMetricOwnershipRanges?.length || 0;
  if (DEVICE_FLUSH && next.emittedRawPointIds.length > DEVICE_DEDUP_WINDOW) {
    next.emittedRawPointIdsEvicted = (finiteNumber(next.emittedRawPointIdsEvicted) ?? 0)
      + (next.emittedRawPointIds.length - DEVICE_DEDUP_WINDOW);
    next.emittedRawPointIds = next.emittedRawPointIds.slice(-DEVICE_DEDUP_WINDOW);
  }
  return next;
}

export function streamingLocalRebuildSnapshot(state = {}) {
  const normalized = createStreamingLocalRebuildState(state);
  return {
    version: normalized.version,
    committedTrackPointCount: normalized.committedTrack.length,
    lastAppliedProductTrackPointCount: normalized.lastAppliedProductTrackPoints.length,
    lastAppliedOwnershipRangeCount: normalized.lastAppliedOwnershipRangeCount,
    unsupportedScenarioCount: normalized.unsupportedScenarioCount,
    stats: normalized.stats
  };
}

function rebuildOwnershipRange(ownership, range, proposal, baseKernel, rawPointsById) {
  if (ownership.type === 'base_kernel' || !proposal) {
    return { points: baseTrackPointsInRange(baseKernel.track, range), unsupported: false };
  }
  if (proposal.scenario === 'stationary_drift_collapse') {
    return {
      points: stationaryDriftAnchorPoint(proposal, rawPointsById),
      unsupported: false
    };
  }
  if (proposal.scenario === 'stationary_session_collapse') {
    return {
      points: stationarySessionAnchorPoint(proposal, baseKernel.track),
      unsupported: false
    };
  }
  if (proposal.scenario === 'rest_photo_micro_move') {
    return {
      points: restPhotoMicroMovePoints(proposal, baseKernel.track),
      unsupported: false
    };
  }
  if (proposal.scenario === 'enclosed_loop_cluster_settlement') {
    return {
      points: enclosedLoopClusterSettlementPoints(proposal, baseKernel.track),
      unsupported: false
    };
  }
  if (proposal.scenario === 'moving_spike_cleanup') {
    return {
      points: movingSpikeLineBridgePoints(proposal, baseKernel.track),
      unsupported: false
    };
  }
  if (proposal.scenario === 'position_snap_recovery') {
    return {
      points: positionSnapRecoveryAnchorPoint(proposal, baseKernel.track, rawPointsById),
      unsupported: false
    };
  }
  if (proposal.scenario === 'weak_recovery_endpoint') {
    return {
      points: weakRecoveryEndpointAnchorPoint(proposal, baseKernel.track, rawPointsById),
      unsupported: false
    };
  }
  if (proposal.scenario === 'dense_main_route_settlement') {
    return {
      points: denseMainRouteSkeletonPoints(proposal, baseKernel.track),
      unsupported: false
    };
  }
  if (proposal.scenario === 'round_trip_line'
      || proposal.scenario === 'same_road_round_trip') {
    return {
      points: roundTripRoutePoints(proposal, baseKernel.track, rawPointsById),
      unsupported: false
    };
  }
  if (proposal.scenario === 'transport_contamination') {
    return {
      points: baseTrackPointsInRange(baseKernel.track, range).map((point) => ({
        ...point,
        localRebuildApplied: false,
        localRebuildFallback: 'transport_route_passthrough',
        localRebuildScenario: proposal.scenario
      })),
      unsupported: false
    };
  }
  if (proposal.scenario === 'gap_recovery_boundary'
      || proposal.scenario === 'pressure_jump') {
    return {
      points: baseTrackPointsInRange(baseKernel.track, range).map((point) => ({
        ...point,
        localRebuildApplied: false,
        localRebuildFallback: 'known_boundary_passthrough',
        localRebuildScenario: proposal.scenario
      })),
      unsupported: false
    };
  }
  return {
    points: baseTrackPointsInRange(baseKernel.track, range).map((point) => ({
      ...point,
      localRebuildApplied: false,
      localRebuildFallback: 'base_kernel_passthrough',
      localRebuildScenario: proposal.scenario
    })),
    unsupported: true
  };
}

function movingSpikeLineBridgePoints(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange);
  const previousRawPointId = finiteNumber(proposal.evidence?.previousRawPointId);
  const spikeRawPointId = finiteNumber(proposal.evidence?.spikeRawPointId);
  const nextRawPointId = finiteNumber(proposal.evidence?.nextRawPointId);
  const previous = span.find((point) => point.sourceRawPointId === previousRawPointId);
  const spike = span.find((point) => point.sourceRawPointId === spikeRawPointId);
  const next = span.find((point) => point.sourceRawPointId === nextRawPointId);
  if (!previous || !spike || !next || !hasValidLngLat(previous) || !hasValidLngLat(next)) {
    return span.map((point) => ({
      ...point,
      localRebuildApplied: false,
      localRebuildFallback: 'moving_spike_incomplete_passthrough',
      localRebuildScenario: 'moving_spike_cleanup'
    }));
  }
  const activeRawPointIds = pointRawPointIds(next);
  const suppressedRawPointIds = uniqueNumbers([
    ...pointRawPointIds(spike),
    ...suppressedRawPointIdsForPoint(spike),
    ...suppressedRawPointIdsForPoint(next)
  ]);
  const bridgeDistanceMeters = distanceMeters(previous.lat, previous.lng, next.lat, next.lng);
  const bridgeMovingTimeSeconds =
    (spike.countsMovingTime ? finiteNumber(spike.movingTimeDeltaSeconds) ?? 0 : 0)
    + (next.countsMovingTime ? finiteNumber(next.movingTimeDeltaSeconds) ?? 0 : 0);
  return [
    {
      ...previous,
      localRebuildApplied: false,
      localRebuildScenario: 'moving_spike_cleanup',
      localRebuildFallback: 'previous_bridge_anchor'
    },
    {
      ...next,
      distanceDeltaMeters: bridgeDistanceMeters,
      movingTimeDeltaSeconds: bridgeMovingTimeSeconds,
      cloudType: 'MOVING_SPIKE_CLEANUP_CLOUD',
      cloudId: spikeRawPointId,
      cloudSampleCount: activeRawPointIds.length + suppressedRawPointIds.length,
      cloudWeightSum: activeRawPointIds.length + suppressedRawPointIds.length,
      cloudWeightedRadiusMeters: finiteNumber(proposal.evidence?.lateralMeters) ?? 0,
      contributingRawPointIds: activeRawPointIds,
      suppressedRawPointIds,
      boundaryState: 'moving_spike_cleaned',
      countsDistance: bridgeDistanceMeters > 0,
      countsMovingTime: bridgeMovingTimeSeconds > 0,
      countsAscentWindow: false,
      entersTrustedGpx: true,
      localRebuildApplied: true,
      localRebuildScenario: 'moving_spike_cleanup',
      localRebuild: 'moving_spike_line_bridge'
    }
  ];
}

function positionSnapRecoveryAnchorPoint(proposal, baseTrack, rawPointsById) {
  const recoveryRawPointId = finiteNumber(proposal.evidence?.recoveryRawPointId);
  const recovery = baseTrack.find((point) => point.sourceRawPointId === recoveryRawPointId);
  if (!recovery) return [];
  const weakRawPointIds = cloneArray(proposal.evidence?.weakRawPointIds)
    .map(finiteNumber)
    .filter(Number.isFinite);
  const suppressedRawPointIds = uniqueNumbers([
    ...cloneArray(proposal.evidence?.suppressedRawPointIds)
      .map(finiteNumber)
      .filter(Number.isFinite),
    ...weakRawPointIds
  ]);
  const rawPointIds = uniqueNumbers([...suppressedRawPointIds, recoveryRawPointId]);
  return [{
    ...recovery,
    reason: 'position_snap_recovery_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'POSITION_SNAP_RECOVERY_CLOUD',
    cloudId: proposal.rawRange?.startRawPointId ?? rawPointIds[0] ?? recoveryRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: finiteNumber(proposal.evidence?.bridgeDistanceMeters) ?? 0,
    representativeRawPointId: recovery.representativeRawPointId ?? recovery.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    suppressedRawPointIds,
    activityState: 'position_snap_recovery',
    boundaryState: 'position_snap_recovered',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'position_snap_recovery',
    localRebuild: 'position_snap_recovery_anchor'
  }];
}

function weakRecoveryEndpointAnchorPoint(proposal, baseTrack, rawPointsById) {
  const rawPointIds = uniqueNumbers(cloneArray(proposal.evidence?.preservedRawPointIds)
    .map(finiteNumber));
  const rawPoints = rawPointIds.map((rawPointId) => rawPointsById.get(rawPointId))
    .filter((point) => point && hasValidLngLat(point));
  if (rawPoints.length === 0) return [];
  const center = weightedCenter(rawPoints);
  const representativeRawPointId = finiteNumber(proposal.evidence?.representativeRawPointId)
    ?? finiteNumber(proposal.anchorRawPointIds?.[0])
    ?? nearestPoint(center, rawPoints)?.rawPointId
    ?? rawPoints[0].rawPointId;
  const representative = rawPointsById.get(representativeRawPointId) || rawPoints[0];
  const previousTrustedRawPointId = finiteNumber(proposal.evidence?.previousTrustedRawPointId);
  const previousTrusted = baseTrack.find((point) =>
    point.sourceRawPointId === previousTrustedRawPointId);
  const segmentId = Number.isFinite(previousTrusted?.segmentId)
    ? previousTrusted.segmentId + 1
    : null;
  const endpoint = rawPointsById.get(finiteNumber(proposal.evidence?.endpointRawPointId))
    || rawPoints.at(-1)
    || representative;
  return [{
    sourceRawPointId: representativeRawPointId,
    segmentId,
    lat: center.lat,
    lng: center.lng,
    elapsedRealtimeNanos: representative.elapsedRealtimeNanos,
    timeMillis: representative.timeMillis,
    result: 'anchor',
    reason: 'weak_recovery_shape_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: true,
    cloudType: 'WEAK_RECOVERY_SHAPE_CLOUD',
    cloudId: rawPointIds[0] ?? representativeRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId,
    contributingRawPointIds: rawPointIds,
    shapeEndpointRawPointId: finiteNumber(endpoint.rawPointId),
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
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'weak_recovery_endpoint',
    localRebuild: 'weak_recovery_shape_anchor'
  }];
}

function stationaryDriftAnchorPoint(proposal, rawPointsById) {
  const rawPointIds = rawPointIdsInRange(proposal.rawRange);
  const rawPoints = rawPointIds.map((rawPointId) => rawPointsById.get(rawPointId))
    .filter((point) => point && hasValidLngLat(point));
  if (rawPoints.length === 0) return [];
  const center = weightedCenter(rawPoints);
  const representativeRawPointId = finiteNumber(proposal.evidence?.representativeRawPointId)
    ?? nearestPoint(center, rawPoints)?.rawPointId
    ?? rawPoints[0].rawPointId;
  const representative = rawPointsById.get(representativeRawPointId) || rawPoints[0];
  return [{
    sourceRawPointId: representativeRawPointId,
    segmentId: null,
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
    cloudId: rawPointIds[0] ?? representativeRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: 'cloud_center',
    virtualCoordinate: true,
    routeLineVertex: false,
    routeLineStrategy: 'bridge_previous_next',
    activityState: 'stationary_drift',
    boundaryState: 'dwell_collapsed',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'stationary_drift_collapse',
    localRebuild: 'stationary_drift_anchor'
  }];
}

// stationary_session_collapse 的 localRebuild:把整个静止会话跨度内的 base track 点塌成
// 单个代表锚点(countsDistance/countsMovingTime=false → 不贡献距离/移动时间,消除静止假距离)。
// 与 stationaryDriftAnchorPoint 同形,但源于 base track 保留点(会话由 stationary_anchor /
// dwell 中 gap_recovery 等组成),而非 rejected 漂移原始点。
function stationarySessionAnchorPoint(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange)
    .filter((point) => hasValidLngLat(point));
  if (span.length === 0) return [];
  const center = weightedCenter(span);
  const representativeRawPointId = finiteNumber(proposal.evidence?.representativeRawPointId)
    ?? nearestPoint(center, span)?.sourceRawPointId
    ?? span[0].sourceRawPointId;
  const representative = span.find((point) =>
    finiteNumber(point.sourceRawPointId) === representativeRawPointId) || span[0];
  const contributingRawPointIds = span
    .map((point) => finiteNumber(point.sourceRawPointId))
    .filter(Number.isFinite);
  return [{
    sourceRawPointId: representativeRawPointId,
    segmentId: null,
    lat: center.lat,
    lng: center.lng,
    altitude: representative.altitude,
    verticalAccuracy: representative.verticalAccuracy,
    elapsedRealtimeNanos: representative.elapsedRealtimeNanos,
    timeMillis: representative.timeMillis,
    result: 'anchor',
    reason: 'stationary_session_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    startsNewSegment: false,
    cloudType: 'STATIONARY_SESSION',
    cloudId: contributingRawPointIds[0] ?? representativeRawPointId,
    cloudSampleCount: finiteNumber(proposal.evidence?.rawPointCount) ?? contributingRawPointIds.length,
    cloudWeightSum: center.weight,
    cloudWeightedRadiusMeters: center.radiusMeters,
    representativeRawPointId,
    contributingRawPointIds,
    coordinateSource: 'cloud_center',
    virtualCoordinate: true,
    routeLineVertex: false,
    routeLineStrategy: 'bridge_previous_next',
    activityState: 'stationary_session',
    boundaryState: 'stationary_session_collapsed',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'stationary_session_collapse',
    localRebuild: 'stationary_session_anchor'
  }];
}

function restPhotoMicroMovePoints(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange);
  if (span.length === 0) return [];
  if (proposal.localRebuild === 'rest_photo_micro_move_anchor') {
    return [restPhotoMicroMoveAnchorPoint(proposal, span)];
  }
  if (proposal.localRebuild === 'rest_photo_micro_move_simplifier') {
    return restPhotoMicroMoveSimplifiedPoints(proposal, span);
  }
  return span.map((point) => ({
    ...point,
    localRebuildApplied: false,
    localRebuildFallback: 'diagnostic_passthrough',
    localRebuildScenario: 'rest_photo_micro_move'
  }));
}

function restPhotoMicroMoveAnchorPoint(proposal, span) {
  const representative = restPhotoMicroMoveRepresentative(span);
  const rawPointIds = uniqueNumbers(span.flatMap((point) => pointRawPointIds(point)));
  return {
    ...representative,
    reason: 'rest_photo_micro_move_anchor',
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'REST_PHOTO_MICRO_MOVE_CLOUD',
    cloudId: rawPointIds[0] ?? representative.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: (finiteNumber(proposal.evidence?.bboxDiagonalMeters) ?? 0) / 2,
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
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'rest_photo_micro_move',
    localRebuild: 'rest_photo_micro_move_anchor'
  };
}

function restPhotoMicroMoveSimplifiedPoints(proposal, span) {
  const first = span[0];
  const last = span.at(-1);
  if (span.length <= 2) {
    return span.map((point, index) =>
      restPhotoMicroMoveSimplifiedPoint(proposal, point, pointRawPointIds(point),
        index === 0, index === span.length - 1));
  }
  const midpoint = span[Math.floor(span.length / 2)];
  return [
    restPhotoMicroMoveSimplifiedPoint(proposal, first, pointRawPointIds(first), true, false),
    restPhotoMicroMoveSimplifiedPoint(proposal, midpoint,
      uniqueNumbers(span.slice(1, -1).flatMap((point) => pointRawPointIds(point))),
      false, false),
    restPhotoMicroMoveSimplifiedPoint(proposal, last, pointRawPointIds(last), false, true)
  ];
}

function restPhotoMicroMoveSimplifiedPoint(proposal, point, rawPointIds, isStart, isEnd) {
  return {
    ...point,
    reason: isStart
      ? 'rest_photo_micro_move_start'
      : isEnd ? 'rest_photo_micro_move_end' : 'rest_photo_micro_move_shape',
    cloudType: 'REST_PHOTO_MICRO_MOVE_CLOUD',
    cloudId: proposal.rawRange?.startRawPointId ?? rawPointIds[0] ?? point.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    contributingRawPointIds: rawPointIds,
    representativeRawPointId: point.representativeRawPointId ?? point.sourceRawPointId,
    activityState: 'rest_photo_micro_move',
    boundaryState: 'rest_photo_micro_move_simplified',
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'rest_photo_micro_move',
    localRebuild: 'rest_photo_micro_move_simplifier'
  };
}

function enclosedLoopClusterSettlementPoints(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange);
  if (span.length === 0) return [];
  const keptRawPointIds = uniqueNumbers(cloneArray(proposal.evidence?.keptRawPointIds)
    .map(finiteNumber))
    .filter((rawPointId) => span.some((point) => point.sourceRawPointId === rawPointId));
  if (keptRawPointIds.length === 0) {
    return span.map((point) => ({
      ...point,
      localRebuildApplied: false,
      localRebuildFallback: 'enclosed_loop_missing_kept_ids',
      localRebuildScenario: 'enclosed_loop_cluster_settlement'
    }));
  }
  const keptIndexes = keptRawPointIds
    .map((rawPointId) => span.findIndex((point) => point.sourceRawPointId === rawPointId))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const points = [];
  let pending = [];
  for (let index = 0; index < span.length; index++) {
    const point = span[index];
    if (!keptIndexes.includes(index)) {
      pending.push(point);
      continue;
    }
    const group = [...pending, point];
    pending = [];
    points.push(enclosedLoopClusterKeptPoint(proposal, group, point,
      index === keptIndexes[0], index === keptIndexes.at(-1)));
  }
  if (pending.length > 0 && points.length > 0) {
    const last = points.at(-1);
    const group = [...pending, last];
    const rawPointIds = uniqueNumbers(group.flatMap((point) => pointRawPointIds(point)));
    const suppressedRawPointIds = uniqueNumbers(group
      .flatMap((point) => suppressedRawPointIdsForPoint(point)));
    last.contributingRawPointIds = rawPointIds;
    if (suppressedRawPointIds.length > 0) last.suppressedRawPointIds = suppressedRawPointIds;
    last.cloudSampleCount = rawPointIds.length + suppressedRawPointIds.length;
    last.cloudWeightSum = rawPointIds.length + suppressedRawPointIds.length;
  }
  return points;
}

function enclosedLoopClusterKeptPoint(proposal, group, fallback, isStart, isEnd) {
  const rawPointIds = uniqueNumbers(group.flatMap((point) => pointRawPointIds(point)));
  const suppressedRawPointIds = uniqueNumbers(group
    .flatMap((point) => suppressedRawPointIdsForPoint(point)));
  return {
    ...fallback,
    reason: fallback.reason === 'gap_recovery'
      ? fallback.reason
      : enclosedLoopClusterReason(fallback, isStart, isEnd),
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    cloudType: 'ENCLOSED_LOOP_SETTLEMENT_CLOUD',
    cloudId: rawPointIds[0] ?? fallback.sourceRawPointId,
    cloudSampleCount: rawPointIds.length + suppressedRawPointIds.length,
    cloudWeightSum: rawPointIds.length + suppressedRawPointIds.length,
    cloudWeightedRadiusMeters: (finiteNumber(proposal.evidence?.bboxDiagonalMeters) ?? 0) / 2,
    representativeRawPointId: fallback.representativeRawPointId ?? fallback.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    ...(suppressedRawPointIds.length > 0 ? { suppressedRawPointIds } : {}),
    coordinateSource: fallback.coordinateSource || 'raw_representative',
    virtualCoordinate: fallback.virtualCoordinate === true,
    activityState: 'enclosed_loop_settlement',
    boundaryState: isStart || isEnd ? 'enclosed_loop_boundary' : 'enclosed_loop_anchor',
    countsDistance: false,
    countsMovingTime: false,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'enclosed_loop_cluster_settlement',
    localRebuild: 'enclosed_loop_anchor_settlement'
  };
}

function enclosedLoopClusterReason(point, isStart, isEnd) {
  if (isStart) return 'enclosed_loop_cluster_start';
  if (isEnd) return 'enclosed_loop_cluster_end';
  if (point.reason === 'rest_photo_micro_move_anchor') return point.reason;
  return 'enclosed_loop_cluster_anchor';
}

function denseMainRouteSkeletonPoints(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange);
  if (span.length === 0) return [];
  const keptRawPointIds = uniqueNumbers(cloneArray(proposal.evidence?.keptRawPointIds)
    .map(finiteNumber))
    .filter((rawPointId) => span.some((point) => point.sourceRawPointId === rawPointId));
  if (keptRawPointIds.length < 2) {
    return span.map((point) => ({
      ...point,
      localRebuildApplied: false,
      localRebuildFallback: 'dense_main_route_missing_kept_ids',
      localRebuildScenario: 'dense_main_route_settlement'
    }));
  }
  const keptIndexes = keptRawPointIds
    .map((rawPointId) => span.findIndex((point) => point.sourceRawPointId === rawPointId))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  return keptIndexes.map((spanIndex, keepIndex) =>
    denseMainRouteSkeletonPoint(proposal, span, keptIndexes, spanIndex, keepIndex));
}

function denseMainRouteSkeletonPoint(proposal, span, keptIndexes, spanIndex, keepIndex) {
  const original = span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keptIndexes[keepIndex - 1];
  const group = span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const rawPointIds = uniqueNumbers(group.flatMap((point) => pointRawPointIds(point)));
  const previousKept = keepIndex === 0 ? null : span[previousKeptSpanIndex];
  const distanceDeltaMeters = previousKept && hasValidLngLat(previousKept)
      && hasValidLngLat(original)
    ? distanceMeters(previousKept.lat, previousKept.lng, original.lat, original.lng)
    : finiteNumber(original.distanceDeltaMeters) ?? 0;
  const movingTimeDeltaSeconds = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? finiteNumber(point.movingTimeDeltaSeconds) ?? 0 : 0), 0);
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keptIndexes.length - 1;
  return {
    ...original,
    reason: isStart
      ? 'dense_main_route_start'
      : isEnd ? 'dense_main_route_end' : 'dense_main_route_shape',
    distanceDeltaMeters,
    movingTimeDeltaSeconds,
    cloudType: 'DENSE_MAIN_ROUTE_CLOUD',
    cloudId: proposal.rawRange?.startRawPointId ?? rawPointIds[0] ?? original.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: (finiteNumber(proposal.evidence?.bboxDiagonalMeters) ?? 0) / 2,
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: 'dense_main_route',
    boundaryState: 'dense_main_route_settled',
    countsDistance: distanceDeltaMeters > 0,
    countsMovingTime: movingTimeDeltaSeconds > 0 && distanceDeltaMeters > 0,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: 'dense_main_route_settlement',
    localRebuild: 'dense_main_route_skeleton'
  };
}

function roundTripRoutePoints(proposal, baseTrack, rawPointsById) {
  const candidate = roundTripCandidateFromProposal(proposal, baseTrack);
  if (!candidate) {
    return baseTrackPointsInRange(baseTrack, proposal.rawRange).map((point) => ({
      ...point,
      localRebuildApplied: false,
      localRebuildFallback: 'round_trip_incomplete_passthrough',
      localRebuildScenario: proposal.scenario
    }));
  }
  if (proposal.scenario === 'same_road_round_trip'
      || proposal.localRebuild === 'same_road_centerline') {
    return sameRoadRoundTripPoints(candidate, proposal, rawPointsById);
  }
  return roundTripLinePoints(candidate, proposal, rawPointsById);
}

function roundTripCandidateFromProposal(proposal, baseTrack) {
  const span = baseTrackPointsInRange(baseTrack, proposal.rawRange);
  if (span.length < 3) return null;
  const startRawPointId = finiteNumber(proposal.evidence?.startRawPointId)
    ?? finiteNumber(proposal.rawRange?.startRawPointId);
  const turnRawPointId = finiteNumber(proposal.evidence?.turnRawPointId);
  const endRawPointId = finiteNumber(proposal.evidence?.endRawPointId)
    ?? finiteNumber(proposal.rawRange?.endRawPointId);
  const startIndex = span.findIndex((point) => point.sourceRawPointId === startRawPointId);
  const turnIndex = span.findIndex((point) => point.sourceRawPointId === turnRawPointId);
  const endIndex = span.findIndex((point) => point.sourceRawPointId === endRawPointId);
  if (startIndex < 0 || turnIndex < 0 || endIndex < 0) return null;
  if (!(startIndex < turnIndex && turnIndex < endIndex)) return null;
  const candidateSpan = span.slice(startIndex, endIndex + 1);
  return {
    span: candidateSpan,
    start: candidateSpan[0],
    turn: candidateSpan[turnIndex - startIndex],
    end: candidateSpan.at(-1),
    startIndex: 0,
    turnIndex: turnIndex - startIndex,
    endIndex: candidateSpan.length - 1,
    rawRange: normalizeRange(proposal.rawRange),
    crossTrack: finiteNumber(proposal.evidence?.crossTrackMeters) ?? 0
  };
}

function roundTripLinePoints(candidate, proposal, rawPointsById) {
  const toleranceMeters = finiteNumber(proposal.evidence?.simplifyToleranceMeters) ?? 3;
  const keepIndexes = roundTripLineKeepIndexes(candidate, toleranceMeters);
  return keepIndexes.map((spanIndex, keepIndex) =>
    roundTripPoint(candidate, proposal, rawPointsById, keepIndexes, spanIndex, keepIndex));
}

function sameRoadRoundTripPoints(candidate, proposal, rawPointsById) {
  const stations = sameRoadCenterlineStations(candidate,
    finiteNumber(proposal.evidence?.simplifyToleranceMeters) ?? 3);
  const coordinatesBySpanIndex = new Map();
  for (const station of stations) {
    coordinatesBySpanIndex.set(station.beforeIndex, station);
    coordinatesBySpanIndex.set(station.afterIndex, station);
  }
  const beforeIndexes = uniqueNumbers(stations.map((station) => finiteNumber(station.beforeIndex)));
  const afterIndexes = uniqueNumbers(stations.map((station) => finiteNumber(station.afterIndex)));
  const keepIndexes = uniqueNumbers([...beforeIndexes, candidate.turnIndex, ...afterIndexes]);
  return keepIndexes.map((spanIndex, keepIndex) => {
    const point = roundTripPoint(candidate, proposal, rawPointsById,
      keepIndexes, spanIndex, keepIndex);
    if (spanIndex === candidate.turnIndex) return point;
    return sameRoadCenterlinePoint(point, coordinatesBySpanIndex.get(spanIndex));
  });
}

function roundTripPoint(candidate, proposal, rawPointsById, keepIndexes, spanIndex, keepIndex) {
  const original = candidate.span[spanIndex];
  const previousKeptSpanIndex = keepIndex === 0 ? -1 : keepIndexes[keepIndex - 1];
  const group = candidate.span.slice(previousKeptSpanIndex + 1, spanIndex + 1);
  const rawPointIds = uniqueNumbers(group.flatMap((point) => pointRawPointIds(point)));
  const distanceDeltaMeters = group.reduce((sum, point) =>
    sum + (point.countsDistance ? finiteNumber(point.distanceDeltaMeters) ?? 0 : 0), 0);
  const movingTimeDeltaSeconds = group.reduce((sum, point) =>
    sum + (point.countsMovingTime ? finiteNumber(point.movingTimeDeltaSeconds) ?? 0 : 0), 0);
  const isTurn = spanIndex === candidate.turnIndex;
  const isStart = keepIndex === 0;
  const isEnd = keepIndex === keepIndexes.length - 1;
  const point = {
    ...original,
    reason: roundTripReason(original, isStart, isTurn, isEnd),
    distanceDeltaMeters,
    movingTimeDeltaSeconds,
    startsNewSegment: isTurn && original.reason === 'weak_recovery_shape_anchor'
      ? true
      : original.startsNewSegment === true,
    cloudType: isTurn && original.reason === 'weak_recovery_shape_anchor'
      ? original.cloudType
      : 'ROUND_TRIP_INTERWOVEN_CLOUD',
    cloudId: proposal.rawRange?.startRawPointId ?? candidate.start.sourceRawPointId,
    cloudSampleCount: rawPointIds.length,
    cloudWeightSum: rawPointIds.length,
    cloudWeightedRadiusMeters: finiteNumber(proposal.evidence?.crossTrackMeters) ?? 0,
    representativeRawPointId: original.representativeRawPointId ?? original.sourceRawPointId,
    contributingRawPointIds: rawPointIds,
    coordinateSource: original.coordinateSource || 'raw_representative',
    virtualCoordinate: original.virtualCoordinate === true,
    activityState: isTurn && original.reason === 'weak_recovery_shape_anchor'
      ? original.activityState
      : 'round_trip_interwoven',
    boundaryState: isTurn ? 'round_trip_turn_preserved' : 'round_trip_interwoven_simplified',
    countsDistance: distanceDeltaMeters > 0,
    countsMovingTime: movingTimeDeltaSeconds > 0,
    countsAscentWindow: false,
    entersTrustedGpx: true,
    localRebuildApplied: true,
    localRebuildScenario: proposal.scenario,
    localRebuild: proposal.localRebuild || (proposal.scenario === 'same_road_round_trip'
      ? 'same_road_centerline'
      : 'round_trip_polyline')
  };
  return isTurn ? roundTripEndpointPoint(point, proposal, rawPointsById) : point;
}

function roundTripReason(original, isStart, isTurn, isEnd) {
  if (isTurn) {
    return original.reason === 'weak_recovery_shape_anchor'
      ? original.reason
      : 'round_trip_turn';
  }
  if (isStart) return 'round_trip_interwoven_start';
  if (isEnd) return 'round_trip_interwoven_end';
  return 'round_trip_interwoven_shape';
}

function roundTripEndpointPoint(point, proposal, rawPointsById) {
  const endpointRawPointId = finiteNumber(proposal.evidence?.endpointRawPointId);
  const endpoint = rawPointsById.get(endpointRawPointId);
  if (!endpoint || !hasValidLngLat(endpoint)) return point;
  if (endpointRawPointId === point.sourceRawPointId
      && endpoint.lat === point.lat
      && endpoint.lng === point.lng) {
    return point;
  }
  return {
    ...point,
    sourceRawPointId: endpointRawPointId,
    representativeRawPointId: endpointRawPointId,
    lat: endpoint.lat,
    lng: endpoint.lng,
    coordinateSource: 'weak_recovery_endpoint_raw',
    virtualCoordinate: false,
    boundaryState: 'round_trip_endpoint_preserved'
  };
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

function sameRoadCenterlineStations(candidate, simplifyToleranceMeters) {
  const beforePath = candidate.span
    .slice(0, candidate.turnIndex)
    .map((point, index) => ({ point, index }));
  const afterPath = candidate.span
    .slice(candidate.turnIndex + 1)
    .map((point, offset) => ({ point, index: candidate.turnIndex + 1 + offset }))
    .reverse();
  const samples = sameRoadCenterlineSamples(beforePath, afterPath);
  if (samples.length === 0) return [];
  const keepSampleIndexes = new Set([0, samples.length - 1]);
  simplifySpanByDistance(samples, 0, samples.length - 1, simplifyToleranceMeters,
    keepSampleIndexes);
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

function appendProductPoint(state, point) {
  const rawPointIds = pointRawPointIds(point);
  if (rawPointIds.length > 0
      && rawPointIds.every((rawPointId) => state.emittedRawPointIds.includes(rawPointId))) {
    return;
  }
  for (const rawPointId of rawPointIds) {
    if (!state.emittedRawPointIds.includes(rawPointId)) state.emittedRawPointIds.push(rawPointId);
  }
  const output = {
    ...point,
    baseTrackPointId: point.trackPointId ?? null,
    trackPointId: ++state.trackPointId
  };
  // Device flush mode drops the cumulative retention; the point still goes to
  // lastAppliedProductTrackPoints (this advance's flush) and updates the
  // running metrics below, so the emitted stream + metrics are unchanged.
  if (!DEVICE_FLUSH) state.committedTrack.push(output);
  state.lastAppliedProductTrackPoints.push(output);
  // Incremental metrics (replaces the per-advance full reduce over committedTrack).
  state.stats.productTrackPointCount++;
  if (output.countsDistance) {
    state.stats.totalDistanceMeters += finiteNumber(output.distanceDeltaMeters) ?? 0;
  }
  if (output.countsMovingTime) {
    state.stats.movingTimeSeconds += finiteNumber(output.movingTimeDeltaSeconds) ?? 0;
  }
}

function baseTrackPointsInRange(track = [], range) {
  return cloneArray(track)
    .filter((point) => point?.entersTrustedGpx !== false)
    .filter((point) => {
      const rawPointIds = pointRawPointIds(point);
      return rawPointIds.some((rawPointId) =>
        rawPointId >= range.startRawPointId && rawPointId <= range.endRawPointId);
    })
    .sort((a, b) => finiteNumber(a.sourceRawPointId) - finiteNumber(b.sourceRawPointId));
}

function rawPointEvidenceById(baseKernel = {}) {
  const byId = new Map();
  for (const point of [
    ...(baseKernel.track || []),
    ...(baseKernel.excluded?.weak || []),
    ...(baseKernel.excluded?.rejected || []),
    ...(baseKernel.excluded?.intakeRejected || [])
  ]) {
    const rawPointId = finiteNumber(point?.rawPointId ?? point?.sourceRawPointId);
    if (!Number.isFinite(rawPointId)) continue;
    byId.set(rawPointId, { ...point, rawPointId });
  }
  return byId;
}

function pointRawPointIds(point) {
  return uniqueNumbers([
    ...(Array.isArray(point?.contributingRawPointIds) ? point.contributingRawPointIds : []),
    ...(Array.isArray(point?.suppressedRawPointIds) ? point.suppressedRawPointIds : []),
    point?.sourceRawPointId,
    point?.rawPointId
  ].map(finiteNumber));
}

function suppressedRawPointIdsForPoint(point) {
  return uniqueNumbers(Array.isArray(point?.suppressedRawPointIds)
    ? point.suppressedRawPointIds.map(finiteNumber)
    : []);
}

function rawPointIdsInRange(rangeLike) {
  const range = normalizeRange(rangeLike);
  if (!range) return [];
  const ids = [];
  for (let rawPointId = range.startRawPointId;
    rawPointId <= range.endRawPointId;
    rawPointId++) {
    ids.push(rawPointId);
  }
  return ids;
}

function restPhotoMicroMoveRepresentative(span) {
  const stationary = span.find((point) => point.reason === 'stationary_anchor');
  if (stationary) return stationary;
  return [...span].sort((a, b) =>
    (finiteNumber(a.reportedSpeedMetersPerSecond) ?? 0)
      - (finiteNumber(b.reportedSpeedMetersPerSecond) ?? 0)
    || finiteNumber(a.sourceRawPointId) - finiteNumber(b.sourceRawPointId))[0] ?? span[0];
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
    || finiteNumber(a.rawPointId) - finiteNumber(b.rawPointId))[0] ?? null;
}

function normalizeRange(range) {
  const start = finiteNumber(range?.startRawPointId ?? range?.start);
  const end = finiteNumber(range?.endRawPointId ?? range?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    startRawPointId: Math.min(start, end),
    endRawPointId: Math.max(start, end)
  };
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function hasValidLngLat(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
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

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => structuredCloneFallback(item)) : [];
}

// L1a: share element references instead of per-advance deep cloning; see
// streamingBaseTrackKernel.mjs for the immutability rationale.
function structuredCloneFallback(value) {
  return value;
}
