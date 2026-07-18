import { normalizeSixLayerTrackConfig } from './sixLayerTrackProduct.mjs';

const NANOS_PER_SECOND = 1_000_000_000;

export const STREAMING_METRIC_ACCUMULATOR_VERSION = 'streaming-metric-accumulator-v0';

export function createStreamingMetricAccumulatorState(overrides = {}) {
  const config = normalizeSixLayerTrackConfig(overrides.config);
  const stats = createStats(overrides.stats);
  return {
    version: STREAMING_METRIC_ACCUMULATOR_VERSION,
    config,
    anchorBarometerAltitudeMeters: finiteNumber(overrides.anchorBarometerAltitudeMeters),
    anchorBarometerElapsedRealtimeNanos: finiteNumber(
      overrides.anchorBarometerElapsedRealtimeNanos
    ),
    totalBarometerAscentMeters: finiteNumber(overrides.totalBarometerAscentMeters) ?? 0,
    totalBarometerDescentMeters: finiteNumber(overrides.totalBarometerDescentMeters) ?? 0,
    hasBarometerDescentEvidence: overrides.hasBarometerDescentEvidence === true,
    lastBarometerWindowEndElapsedRealtimeNanos: finiteNumber(
      overrides.lastBarometerWindowEndElapsedRealtimeNanos
    ),
    barometerWindowDecisions: cloneArray(overrides.barometerWindowDecisions),
    committedMetricSettlementApplied: overrides.committedMetricSettlementApplied === true,
    committedBarometerAscentMeters:
      finiteNumber(overrides.committedBarometerAscentMeters) ?? 0,
    committedBarometerDescentMeters:
      finiteNumber(overrides.committedBarometerDescentMeters) ?? 0,
    committedBarometerWindowIds: cloneArray(overrides.committedBarometerWindowIds)
      .map(String),
    committedBarometerWindowSliceCount:
      finiteNumber(overrides.committedBarometerWindowSliceCount) ?? 0,
    lastAppliedBarometerWindowSlices: cloneArray(overrides.lastAppliedBarometerWindowSlices),
    barometerWindowDecisionsPrunedBeforeElapsedRealtimeNanos: finiteNumber(
      overrides.barometerWindowDecisionsPrunedBeforeElapsedRealtimeNanos
    ),
    gnssAltitudeAnchorMeters: finiteNumber(overrides.gnssAltitudeAnchorMeters),
    committedGnssAltitudeAscentMeters:
      finiteNumber(overrides.committedGnssAltitudeAscentMeters) ?? 0,
    committedGnssAltitudeDescentMeters:
      finiteNumber(overrides.committedGnssAltitudeDescentMeters) ?? 0,
    committedGnssAltitudeSampleRawPointIds:
      cloneArray(overrides.committedGnssAltitudeSampleRawPointIds)
        .map(finiteNumber)
        .filter(Number.isFinite),
    committedGnssAltitudeRejectedRawPointIds:
      cloneArray(overrides.committedGnssAltitudeRejectedRawPointIds)
        .map(finiteNumber)
        .filter(Number.isFinite),
    committedGnssAltitudePointDecisionCount:
      finiteNumber(overrides.committedGnssAltitudePointDecisionCount) ?? 0,
    lastAppliedGnssAltitudePointDecisions:
      cloneArray(overrides.lastAppliedGnssAltitudePointDecisions),
    stats,
    barometerAscentResult: cloneObject(overrides.barometerAscentResult)
      || barometerResultFromStats(stats),
    gnssAltitudeResult: cloneObject(overrides.gnssAltitudeResult)
      || gnssAltitudeResultFromStats(stats),
    selectedAscentResult: cloneObject(overrides.selectedAscentResult)
      || selectedAscentFromStats(stats)
  };
}

export function advanceStreamingMetricAccumulator(previousState = {}, eventsOrBatch = []) {
  const state = createStreamingMetricAccumulatorState(previousState);
  const events = Array.isArray(eventsOrBatch) ? eventsOrBatch : eventsOrBatch?.events || [];
  const next = {
    ...state,
    barometerWindowDecisions: [...state.barometerWindowDecisions],
    stats: { ...state.stats }
  };

  for (const event of events) {
    if (event?.event !== 'barometer_window') continue;
    const window = normalizeBarometerWindow(event);
    processBarometerWindow(next, window);
  }

  finalizeMetricStats(next);
  return next;
}

export function applyStreamingMetricSettlement(
  previousState = {},
  settlementState = {},
  rawPointTimeline = [],
  baseTrack = []
) {
  const state = createStreamingMetricAccumulatorState(previousState);
  const next = {
    ...state,
    barometerWindowDecisions: [...state.barometerWindowDecisions],
    stats: { ...state.stats },
    committedBarometerWindowIds: [...state.committedBarometerWindowIds],
    committedGnssAltitudeSampleRawPointIds: [
      ...state.committedGnssAltitudeSampleRawPointIds
    ],
    committedGnssAltitudeRejectedRawPointIds: [
      ...state.committedGnssAltitudeRejectedRawPointIds
    ],
    lastAppliedBarometerWindowSlices: [],
    lastAppliedGnssAltitudePointDecisions: []
  };
  const timeRanges = committedMetricTimeRanges(
    settlementState?.lastAppliedMetricOwnershipRanges,
    rawPointTimeline
  );
  const windowSlices = barometerWindowSlices(next.barometerWindowDecisions, timeRanges);
  const countedSlices = windowSlices.filter((slice) => slice.countsElevation);

  for (const slice of countedSlices) {
    next.committedBarometerAscentMeters += slice.ascentDeltaMeters;
    next.committedBarometerDescentMeters += slice.descentDeltaMeters;
    const windowId = String(slice.windowId);
    if (!next.committedBarometerWindowIds.includes(windowId)) {
      next.committedBarometerWindowIds.push(windowId);
    }
  }

  next.committedBarometerWindowSliceCount += windowSlices.length;
  next.lastAppliedBarometerWindowSlices = windowSlices;
  applyGnssAltitudeSettlement(next, settlementState?.lastAppliedMetricOwnershipRanges, baseTrack);
  next.committedMetricSettlementApplied = true;
  pruneBarometerWindowDecisions(next, settlementState, rawPointTimeline);
  finalizeMetricStats(next);
  return next;
}

export function streamingMetricSnapshot(
  state = {},
  settlementState = null,
  rawPointTimeline = [],
  baseTrack = []
) {
  const normalized = createStreamingMetricAccumulatorState(state);
  return {
    stats: normalized.stats,
    barometerAscentResult: normalized.barometerAscentResult,
    gnssAltitudeResult: normalized.gnssAltitudeResult,
    selectedAscentResult: normalized.selectedAscentResult,
    barometerWindowDecisionCount: normalized.barometerWindowDecisions.length,
    settlement: settlementState
      ? metricSettlementSnapshot(settlementState, normalized, rawPointTimeline, baseTrack)
      : null
  };
}

function metricSettlementSnapshot(settlementState, metricState, rawPointTimeline, baseTrack) {
  const committedMetric = metricState.committedMetricSettlementApplied
    ? committedMetricSnapshotFromState(metricState)
    : committedMetricSnapshot(metricState, settlementState, rawPointTimeline, baseTrack);
  return {
    committedCursorRawPointId: finiteNumber(settlementState?.committedCursorRawPointId),
    lastCommitPlanStatus: settlementState?.lastCommitPlanStatus || 'none',
    lastCommitWatermark: finiteNumber(settlementState?.lastCommitWatermark),
    committedMetricOwnershipRanges: cloneArray(
      settlementState?.committedMetricOwnershipRanges
    ),
    lastAppliedMetricOwnershipRanges: cloneArray(
      settlementState?.lastAppliedMetricOwnershipRanges
    ),
    blockingRanges: cloneArray(settlementState?.blockingRanges),
    hardBoundaryCheckpoints: cloneArray(settlementState?.hardBoundaryCheckpoints),
    committedBarometerAscentResult: committedMetric.barometerAscentResult,
    committedGnssAltitudeResult: committedMetric.gnssAltitudeResult,
    committedSelectedAscentResult: committedMetric.selectedAscentResult,
    committedBarometerWindowSliceCount: committedMetric.windowSliceCount,
    committedBarometerWindowSlices: committedMetric.windowSlices,
    committedGnssAltitudePointDecisionCount: committedMetric.gnssAltitudePointDecisionCount,
    committedGnssAltitudePointDecisions: committedMetric.gnssAltitudePointDecisions
  };
}

function committedMetricSnapshotFromState(metricState) {
  const sampleCount = metricState.committedBarometerWindowIds.length;
  const confidence = sampleCount >= 2 ? metricState.stats.barometerAscentConfidence : 'none';
  const totalAscentMeters = sampleCount >= 2 ? metricState.committedBarometerAscentMeters : null;
  const totalDescentMeters = sampleCount >= 2 ? metricState.committedBarometerDescentMeters : null;
  const barometerAscentResult = {
    totalAscentMeters,
    totalDescentMeters,
    sampleCount,
    rejectedSampleCount: 0,
    confidence
  };
  const gnssAltitudeResult = committedGnssAltitudeResultFromState(metricState);
  const selectedAscentResult = committedSelectedAscentResult(
    barometerAscentResult,
    gnssAltitudeResult,
    'committed_ascent_evidence_insufficient'
  );
  return {
    barometerAscentResult,
    gnssAltitudeResult,
    selectedAscentResult,
    windowSliceCount: metricState.committedBarometerWindowSliceCount,
    windowSlices: cloneArray(metricState.lastAppliedBarometerWindowSlices),
    gnssAltitudePointDecisionCount: metricState.committedGnssAltitudePointDecisionCount,
    gnssAltitudePointDecisions: cloneArray(metricState.lastAppliedGnssAltitudePointDecisions)
  };
}

function processBarometerWindow(state, window) {
  let result = 'accumulating';
  let reason = 'barometer_accumulating';
  let delta = 0;
  let descentDelta = 0;
  const altitude = window.avgRawBarometerAltitudeMeters;
  const time = window.endElapsedRealtimeNanos;
  const windowAscent = nonNegativeNumber(window.windowAscentMeters);
  const windowDescent = nonNegativeNumber(window.windowDescentMeters);
  const hasWindowGainLoss = windowAscent !== null || windowDescent !== null;

  if (!Number.isFinite(time)
      || (Number.isFinite(state.lastBarometerWindowEndElapsedRealtimeNanos)
        && time <= state.lastBarometerWindowEndElapsedRealtimeNanos)) {
    result = 'rejected';
    reason = 'barometer_window_out_of_order';
    state.stats.barometerAscentRejectedSampleCount++;
  } else if (!Number.isFinite(altitude)
      || window.avgPressureHpa !== null && window.avgPressureHpa <= 0) {
    result = 'rejected';
    reason = 'barometer_unavailable';
    state.stats.barometerAscentRejectedSampleCount++;
    state.lastBarometerWindowEndElapsedRealtimeNanos = time;
  } else if (!Number.isFinite(state.anchorBarometerAltitudeMeters)) {
    if (hasWindowGainLoss) {
      delta = windowAscent ?? 0;
      descentDelta = windowDescent ?? 0;
      state.totalBarometerAscentMeters += delta;
      state.totalBarometerDescentMeters += descentDelta;
      state.hasBarometerDescentEvidence ||= descentDelta > 0 || windowDescent !== null;
    } else {
      result = 'reset';
      reason = 'boundary_reset';
    }
    state.anchorBarometerAltitudeMeters = altitude;
    state.anchorBarometerElapsedRealtimeNanos = time;
    state.stats.barometerAscentSampleCount++;
    state.lastBarometerWindowEndElapsedRealtimeNanos = time;
  } else {
    const dt = Math.max(0, time - state.anchorBarometerElapsedRealtimeNanos);
    const rawDelta = altitude - state.anchorBarometerAltitudeMeters;
    const verticalSpeed = dt > 0 ? Math.abs(rawDelta) / (dt / NANOS_PER_SECOND) : 0;
    if (dt > state.config.barometerAscentMaxSampleGapNanos) {
      result = 'reset';
      reason = 'pressure_sample_gap';
      state.anchorBarometerAltitudeMeters = altitude;
      state.anchorBarometerElapsedRealtimeNanos = time;
      state.stats.barometerAscentSampleCount++;
      state.lastBarometerWindowEndElapsedRealtimeNanos = time;
    } else if (Math.abs(rawDelta) >= state.config.barometerPressureJumpMeters
        || verticalSpeed > state.config.barometerAscentMaxVerticalSpeedMetersPerSecond) {
      result = 'rejected';
      reason = 'pressure_jump_detected';
      state.stats.barometerAscentRejectedSampleCount++;
      state.anchorBarometerAltitudeMeters = altitude;
      state.anchorBarometerElapsedRealtimeNanos = time;
      state.lastBarometerWindowEndElapsedRealtimeNanos = time;
    } else {
      if (hasWindowGainLoss) {
        delta = windowAscent ?? 0;
        descentDelta = windowDescent ?? 0;
        state.totalBarometerAscentMeters += delta;
        state.totalBarometerDescentMeters += descentDelta;
        state.hasBarometerDescentEvidence ||= descentDelta > 0 || windowDescent !== null;
      } else if (rawDelta >= state.config.barometerAscentMinGainMeters) {
        delta = rawDelta;
        state.totalBarometerAscentMeters += delta;
      } else if (-rawDelta >= state.config.barometerAscentMinGainMeters) {
        descentDelta = -rawDelta;
        state.totalBarometerDescentMeters += descentDelta;
        state.hasBarometerDescentEvidence = true;
      }
      state.anchorBarometerAltitudeMeters = altitude;
      state.anchorBarometerElapsedRealtimeNanos = time;
      state.stats.barometerAscentSampleCount++;
      state.lastBarometerWindowEndElapsedRealtimeNanos = time;
    }
  }

  state.barometerWindowDecisions.push({
    windowId: window.windowId,
    startElapsedRealtimeNanos: window.startElapsedRealtimeNanos,
    endElapsedRealtimeNanos: window.endElapsedRealtimeNanos,
    result,
    reason,
    ascentDeltaMeters: delta,
    descentDeltaMeters: descentDelta,
    activityGate: 'independent',
    boundaryGate: result === 'reset' ? 'reset' : 'open',
    confidence: result === 'rejected' ? 'low' : 'medium'
  });
}

function committedMetricSnapshot(metricState, settlementState, rawPointTimeline, baseTrack) {
  const timeRanges = committedMetricTimeRanges(
    settlementState?.committedMetricOwnershipRanges,
    rawPointTimeline
  );
  const windowSlices = barometerWindowSlices(metricState.barometerWindowDecisions, timeRanges);
  const countedSlices = windowSlices.filter((slice) => slice.countsElevation);
  const windowIds = new Set(countedSlices.map((slice) => String(slice.windowId)));
  const sampleCount = windowIds.size;
  const totalAscent = countedSlices.reduce((sum, slice) => sum + slice.ascentDeltaMeters, 0);
  const totalDescent = countedSlices.reduce((sum, slice) => sum + slice.descentDeltaMeters, 0);
  const confidence = sampleCount >= 2 ? metricState.stats.barometerAscentConfidence : 'none';
  const totalAscentMeters = sampleCount >= 2 ? totalAscent : null;
  const totalDescentMeters = sampleCount >= 2 ? totalDescent : null;
  const barometerAscentResult = {
    totalAscentMeters,
    totalDescentMeters,
    sampleCount,
    rejectedSampleCount: 0,
    confidence
  };
  const gnssPreview = previewGnssAltitudeSettlement(
    metricState,
    settlementState?.committedMetricOwnershipRanges,
    baseTrack
  );
  const gnssAltitudeResult = committedGnssAltitudeResultFromState(gnssPreview);
  const selectedAscentResult = committedSelectedAscentResult(
    barometerAscentResult,
    gnssAltitudeResult,
    timeRanges.length === 0
      ? 'no_committed_metric_range'
      : 'committed_ascent_evidence_insufficient'
  );
  return {
    barometerAscentResult,
    gnssAltitudeResult,
    selectedAscentResult,
    windowSliceCount: windowSlices.length,
    windowSlices,
    gnssAltitudePointDecisionCount: gnssPreview.committedGnssAltitudePointDecisionCount,
    gnssAltitudePointDecisions: cloneArray(gnssPreview.lastAppliedGnssAltitudePointDecisions)
  };
}

function applyGnssAltitudeSettlement(state, ownershipRanges, baseTrack) {
  const decisions = [];
  for (const pointSlice of gnssAltitudePointSlices(baseTrack, ownershipRanges)) {
    decisions.push(applyGnssAltitudePoint(state, pointSlice));
  }
  state.lastAppliedGnssAltitudePointDecisions = decisions;
  state.committedGnssAltitudePointDecisionCount += decisions.length;
}

function previewGnssAltitudeSettlement(metricState, ownershipRanges, baseTrack) {
  const preview = createStreamingMetricAccumulatorState(metricState);
  preview.committedGnssAltitudeSampleRawPointIds = [
    ...preview.committedGnssAltitudeSampleRawPointIds
  ];
  preview.committedGnssAltitudeRejectedRawPointIds = [
    ...preview.committedGnssAltitudeRejectedRawPointIds
  ];
  preview.lastAppliedGnssAltitudePointDecisions = [];
  applyGnssAltitudeSettlement(preview, ownershipRanges, baseTrack);
  return preview;
}

function applyGnssAltitudePoint(state, pointSlice) {
  const point = pointSlice.point;
  const rawPointId = finiteNumber(point?.sourceRawPointId ?? point?.rawPointId);
  const altitude = finiteNumber(point?.altitude ?? point?.altitudeMeters);
  const verticalAccuracy = finiteNumber(point?.verticalAccuracy ?? point?.verticalAccuracyMeters);
  const decision = {
    rawPointId,
    trackPointId: finiteNumber(point?.trackPointId),
    ownerType: pointSlice.ownerType,
    proposalId: pointSlice.proposalId,
    parentProposalId: pointSlice.parentProposalId,
    scenario: pointSlice.scenario,
    rawRange: pointSlice.rawRange,
    altitudeMeters: altitude,
    verticalAccuracyMeters: verticalAccuracy,
    countsElevation: pointSlice.countsElevation,
    result: 'unavailable',
    reason: 'gnss_altitude_missing',
    ascentDeltaMeters: 0,
    descentDeltaMeters: 0
  };

  if (!pointSlice.countsElevation) {
    state.gnssAltitudeAnchorMeters = null;
    return {
      ...decision,
      result: 'suspended',
      reason: 'elevation_gate_closed'
    };
  }
  if (!Number.isFinite(altitude)) return decision;

  const trusted = point?.result === 'anchor' || point?.result === 'accept';
  if (!trusted) {
    addGnssRejectedRawPointId(state, rawPointId);
    return {
      ...decision,
      result: 'rejected',
      reason: 'horizontal_point_not_trusted'
    };
  }
  if (!Number.isFinite(verticalAccuracy)
      || verticalAccuracy > state.config.locationAltitudeAscentMaxVerticalAccuracyMeters) {
    addGnssRejectedRawPointId(state, rawPointId);
    return {
      ...decision,
      result: 'rejected',
      reason: Number.isFinite(verticalAccuracy)
        ? 'vertical_accuracy_too_large'
        : 'vertical_accuracy_missing'
    };
  }

  const moving = point?.result === 'accept' && point?.countsDistance === true;
  if (!moving) {
    state.gnssAltitudeAnchorMeters = altitude;
    addGnssSampleRawPointId(state, rawPointId);
    return {
      ...decision,
      result: 'reset',
      reason: altitudeResetReason(point?.reason)
    };
  }

  addGnssSampleRawPointId(state, rawPointId);
  if (!Number.isFinite(state.gnssAltitudeAnchorMeters)) {
    state.gnssAltitudeAnchorMeters = altitude;
    return {
      ...decision,
      result: 'accepted',
      reason: 'gnss_altitude_anchor'
    };
  }

  const delta = altitude - state.gnssAltitudeAnchorMeters;
  if (Math.abs(delta) > state.config.locationAltitudeAscentMaxStepGainMeters) {
    addGnssRejectedRawPointId(state, rawPointId);
    state.gnssAltitudeAnchorMeters = altitude;
    return {
      ...decision,
      result: 'rejected',
      reason: 'gnss_altitude_jump'
    };
  }

  let ascentDeltaMeters = 0;
  let descentDeltaMeters = 0;
  if (delta >= state.config.locationAltitudeAscentMinGainMeters) {
    ascentDeltaMeters = delta;
    state.committedGnssAltitudeAscentMeters += delta;
  } else if (-delta >= state.config.locationAltitudeAscentMinGainMeters) {
    descentDeltaMeters = -delta;
    state.committedGnssAltitudeDescentMeters += -delta;
  }
  state.gnssAltitudeAnchorMeters = altitude;
  return {
    ...decision,
    result: 'accepted',
    reason: 'gnss_altitude_accepted',
    ascentDeltaMeters,
    descentDeltaMeters
  };
}

function gnssAltitudePointSlices(baseTrack, ownershipRanges) {
  const track = normalizedBaseTrack(baseTrack);
  const slices = [];
  for (const ownership of ownershipRanges || []) {
    const range = normalizeRange(ownership?.range);
    if (!range) continue;
    const points = track.filter((point) =>
      point.sourceRawPointId >= range.startRawPointId
        && point.sourceRawPointId <= range.endRawPointId);
    for (const point of points) {
      slices.push({
        point,
        ownerType: ownership.type || 'base_kernel',
        proposalId: ownership.proposalId ?? null,
        parentProposalId: ownership.parentProposalId ?? null,
        scenario: ownership.scenario ?? null,
        rawRange: range,
        countsElevation: !Array.isArray(ownership.affectedMetricGates)
          || !ownership.affectedMetricGates.includes('elevation')
      });
    }
  }
  return slices;
}

function normalizedBaseTrack(baseTrack) {
  return (baseTrack || [])
    .map((point) => ({
      ...point,
      sourceRawPointId: finiteNumber(point?.sourceRawPointId ?? point?.rawPointId),
      trackPointId: finiteNumber(point?.trackPointId),
      altitude: finiteNumber(point?.altitude ?? point?.altitudeMeters),
      verticalAccuracy: finiteNumber(point?.verticalAccuracy ?? point?.verticalAccuracyMeters),
      elapsedRealtimeNanos: finiteNumber(point?.elapsedRealtimeNanos)
    }))
    .filter((point) => Number.isFinite(point.sourceRawPointId))
    .sort((a, b) => a.sourceRawPointId - b.sourceRawPointId);
}

function addGnssSampleRawPointId(state, rawPointId) {
  if (!Number.isFinite(rawPointId)) return;
  if (!state.committedGnssAltitudeSampleRawPointIds.includes(rawPointId)) {
    state.committedGnssAltitudeSampleRawPointIds.push(rawPointId);
  }
}

function addGnssRejectedRawPointId(state, rawPointId) {
  if (!Number.isFinite(rawPointId)) return;
  if (!state.committedGnssAltitudeRejectedRawPointIds.includes(rawPointId)) {
    state.committedGnssAltitudeRejectedRawPointIds.push(rawPointId);
  }
}

function altitudeResetReason(horizontalReason) {
  if (horizontalReason === 'gap_recovery') return 'gap_recovery_reset';
  if (horizontalReason === 'stationary_anchor') return 'stationary_suspended';
  if (horizontalReason === 'first_fix_good' || horizontalReason === 'first_fix_relaxed') {
    return 'gnss_altitude_anchor';
  }
  return 'boundary_reset';
}

function pruneBarometerWindowDecisions(state, settlementState, rawPointTimeline) {
  const cursor = finiteNumber(settlementState?.committedCursorRawPointId);
  if (!Number.isFinite(cursor)) return;
  const timeline = normalizedRawPointTimeline(rawPointTimeline);
  const cursorPoint = timeline.find((point) => point.rawPointId === cursor);
  if (!cursorPoint) return;
  const cutoff = cursorPoint.elapsedRealtimeNanos;
  state.barometerWindowDecisions = state.barometerWindowDecisions.filter((decision) => {
    const end = finiteNumber(decision.endElapsedRealtimeNanos)
      ?? finiteNumber(decision.startElapsedRealtimeNanos);
    return !Number.isFinite(end) || end > cutoff;
  });
  state.barometerWindowDecisionsPrunedBeforeElapsedRealtimeNanos = cutoff;
}

function committedMetricTimeRanges(ownershipRanges, rawPointTimeline) {
  const timeline = normalizedRawPointTimeline(rawPointTimeline);
  return (ownershipRanges || [])
    .map((ownership) => ownershipTimeRange(ownership, timeline))
    .filter(Boolean);
}

function ownershipTimeRange(ownership, timeline) {
  const range = normalizeRange(ownership?.range);
  if (!range) return null;
  const endPoint = timeline.find((point) => point.rawPointId === range.endRawPointId);
  if (!endPoint) return null;
  const startPoint = timeline.find((point) => point.rawPointId === range.startRawPointId);
  const previousPoint = previousRawPointBefore(timeline, range.startRawPointId);
  const startElapsedRealtimeNanos = previousPoint?.elapsedRealtimeNanos
    ?? startPoint?.elapsedRealtimeNanos;
  if (!Number.isFinite(startElapsedRealtimeNanos)
      || !Number.isFinite(endPoint.elapsedRealtimeNanos)
      || startElapsedRealtimeNanos > endPoint.elapsedRealtimeNanos) {
    return null;
  }
  return {
    type: ownership.type || 'base_kernel',
    proposalId: ownership.proposalId ?? null,
    parentProposalId: ownership.parentProposalId ?? null,
    scenario: ownership.scenario ?? null,
    rawRange: range,
    startElapsedRealtimeNanos,
    endElapsedRealtimeNanos: endPoint.elapsedRealtimeNanos,
    startExclusive: Boolean(previousPoint),
    hardBoundary: ownership.hardBoundary === true,
    affectedMetricGates: Array.isArray(ownership.affectedMetricGates)
      ? [...ownership.affectedMetricGates]
      : []
  };
}

function barometerWindowSlices(decisions, timeRanges) {
  const slices = [];
  for (const decision of decisions || []) {
    if (decision?.result === 'rejected') continue;
    const windowStart = finiteNumber(decision.startElapsedRealtimeNanos)
      ?? finiteNumber(decision.endElapsedRealtimeNanos);
    const windowEnd = finiteNumber(decision.endElapsedRealtimeNanos)
      ?? finiteNumber(decision.startElapsedRealtimeNanos);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) continue;
    const normalizedWindow = {
      startElapsedRealtimeNanos: Math.min(windowStart, windowEnd),
      endElapsedRealtimeNanos: Math.max(windowStart, windowEnd)
    };
    for (const range of timeRanges) {
      const ratio = overlapRatio(normalizedWindow, range);
      if (ratio <= 0) continue;
      const countsElevation = !range.affectedMetricGates.includes('elevation');
      slices.push({
        windowId: decision.windowId,
        ownerType: range.type,
        proposalId: range.proposalId,
        parentProposalId: range.parentProposalId,
        scenario: range.scenario,
        rawRange: range.rawRange,
        startElapsedRealtimeNanos: Math.max(
          normalizedWindow.startElapsedRealtimeNanos,
          range.startElapsedRealtimeNanos
        ),
        endElapsedRealtimeNanos: Math.min(
          normalizedWindow.endElapsedRealtimeNanos,
          range.endElapsedRealtimeNanos
        ),
        overlapRatio: ratio,
        countsElevation,
        ascentDeltaMeters: countsElevation
          ? (finiteNumber(decision.ascentDeltaMeters) ?? 0) * ratio
          : 0,
        descentDeltaMeters: countsElevation
          ? (finiteNumber(decision.descentDeltaMeters) ?? 0) * ratio
          : 0
      });
    }
  }
  return slices;
}

function overlapRatio(window, range) {
  const windowDuration = window.endElapsedRealtimeNanos - window.startElapsedRealtimeNanos;
  if (windowDuration === 0) {
    const afterStart = range.startExclusive
      ? window.startElapsedRealtimeNanos > range.startElapsedRealtimeNanos
      : window.startElapsedRealtimeNanos >= range.startElapsedRealtimeNanos;
    return afterStart
        && window.endElapsedRealtimeNanos <= range.endElapsedRealtimeNanos
      ? 1
      : 0;
  }
  const overlapStart = Math.max(window.startElapsedRealtimeNanos, range.startElapsedRealtimeNanos);
  const overlapEnd = Math.min(window.endElapsedRealtimeNanos, range.endElapsedRealtimeNanos);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  return overlap / windowDuration;
}

function finalizeMetricStats(state) {
  const accepted = state.stats.barometerAscentSampleCount;
  const rejected = state.stats.barometerAscentRejectedSampleCount;
  const gnssAccepted = state.committedGnssAltitudeSampleRawPointIds.length;
  const gnssRejected = state.committedGnssAltitudeRejectedRawPointIds.length;
  state.stats.barometerTotalAscentMeters = accepted >= 2
    ? state.totalBarometerAscentMeters
    : -1;
  state.stats.barometerTotalDescentMeters = accepted >= 2
    ? state.hasBarometerDescentEvidence ? state.totalBarometerDescentMeters : 0
    : -1;
  state.stats.barometerAscentConfidence = accepted >= 2 && rejected === 0
    ? 'high'
    : accepted >= 2
      ? 'medium'
      : 'none';
  state.stats.locationAltitudeTotalAscentMeters = gnssAccepted >= 2
    ? state.committedGnssAltitudeAscentMeters
    : -1;
  state.stats.locationAltitudeTotalDescentMeters = gnssAccepted >= 2
    ? state.committedGnssAltitudeDescentMeters
    : -1;
  state.stats.locationAltitudeAscentSampleCount = gnssAccepted;
  state.stats.locationAltitudeAscentRejectedSampleCount = gnssRejected;
  state.stats.locationAltitudeAscentConfidence = gnssAccepted >= 2 && gnssRejected === 0
    ? 'high'
    : gnssAccepted >= 2
      ? 'medium'
      : 'none';
  const selected = selectedAscentFromStats(state.stats);
  state.stats.selectedAscentSource = selected.source;
  state.stats.selectedTotalAscentMeters = selected.totalAscentMeters;
  state.stats.selectedTotalDescentMeters = selected.totalDescentMeters;
  state.barometerAscentResult = barometerResultFromStats(state.stats);
  state.gnssAltitudeResult = gnssAltitudeResultFromStats(state.stats);
  state.selectedAscentResult = selected;
}

function normalizeBarometerWindow(event) {
  return {
    ...event,
    windowId: numberField(event, 'barometerWindowId') ?? numberField(event, 'windowId') ?? null,
    startElapsedRealtimeNanos: numberField(event, 'startElapsedRealtimeNanos')
      ?? numberField(event, 'firstElapsedRealtimeNanos')
      ?? numberField(event, 'endElapsedRealtimeNanos')
      ?? numberField(event, 'lastElapsedRealtimeNanos'),
    endElapsedRealtimeNanos: numberField(event, 'endElapsedRealtimeNanos')
      ?? numberField(event, 'lastElapsedRealtimeNanos')
      ?? numberField(event, 'startElapsedRealtimeNanos')
      ?? numberField(event, 'firstElapsedRealtimeNanos'),
    avgPressureHpa: numberField(event, 'avgPressureHpa'),
    avgRawBarometerAltitudeMeters: numberField(event, 'avgRawBarometerAltitudeMeters')
      ?? numberField(event, 'avgBarometerAltitudeMeters'),
    deltaRawBarometerAltitudeMeters: numberField(event, 'deltaRawAltitudeMeters')
      ?? numberField(event, 'deltaRawBarometerAltitudeMeters')
      ?? numberField(event, 'deltaBarometerAltitudeMeters'),
    windowAscentMeters: numberField(event, 'windowAscentMeters'),
    windowDescentMeters: numberField(event, 'windowDescentMeters')
  };
}

function createStats(overrides = {}) {
  return {
    barometerTotalAscentMeters: finiteNumber(overrides.barometerTotalAscentMeters) ?? -1,
    barometerTotalDescentMeters: finiteNumber(overrides.barometerTotalDescentMeters) ?? -1,
    barometerAscentSampleCount: finiteNumber(overrides.barometerAscentSampleCount) ?? 0,
    barometerAscentRejectedSampleCount:
      finiteNumber(overrides.barometerAscentRejectedSampleCount) ?? 0,
    barometerAscentConfidence: typeof overrides.barometerAscentConfidence === 'string'
      ? overrides.barometerAscentConfidence
      : 'none',
    locationAltitudeTotalAscentMeters:
      finiteNumber(overrides.locationAltitudeTotalAscentMeters) ?? -1,
    locationAltitudeTotalDescentMeters:
      finiteNumber(overrides.locationAltitudeTotalDescentMeters) ?? -1,
    locationAltitudeAscentSampleCount:
      finiteNumber(overrides.locationAltitudeAscentSampleCount) ?? 0,
    locationAltitudeAscentRejectedSampleCount:
      finiteNumber(overrides.locationAltitudeAscentRejectedSampleCount) ?? 0,
    locationAltitudeAscentConfidence:
      typeof overrides.locationAltitudeAscentConfidence === 'string'
        ? overrides.locationAltitudeAscentConfidence
        : 'none',
    selectedTotalAscentMeters: finiteNumber(overrides.selectedTotalAscentMeters),
    selectedTotalDescentMeters: finiteNumber(overrides.selectedTotalDescentMeters),
    selectedAscentSource: typeof overrides.selectedAscentSource === 'string'
      ? overrides.selectedAscentSource
      : 'NONE'
  };
}

function barometerResultFromStats(stats) {
  return {
    totalAscentMeters: stats.barometerTotalAscentMeters,
    totalDescentMeters: stats.barometerTotalDescentMeters,
    sampleCount: stats.barometerAscentSampleCount,
    rejectedSampleCount: stats.barometerAscentRejectedSampleCount,
    confidence: stats.barometerAscentConfidence
  };
}

function gnssAltitudeResultFromStats(stats) {
  return {
    totalAscentMeters: stats.locationAltitudeTotalAscentMeters,
    totalDescentMeters: stats.locationAltitudeTotalDescentMeters,
    sampleCount: stats.locationAltitudeAscentSampleCount,
    rejectedSampleCount: stats.locationAltitudeAscentRejectedSampleCount,
    confidence: stats.locationAltitudeAscentConfidence
  };
}

function committedGnssAltitudeResultFromState(metricState) {
  const sampleCount = metricState.committedGnssAltitudeSampleRawPointIds.length;
  const rejectedSampleCount = metricState.committedGnssAltitudeRejectedRawPointIds.length;
  const confidence = sampleCount >= 2 && rejectedSampleCount === 0
    ? 'high'
    : sampleCount >= 2
      ? 'medium'
      : 'none';
  return {
    totalAscentMeters: sampleCount >= 2
      ? metricState.committedGnssAltitudeAscentMeters
      : null,
    totalDescentMeters: sampleCount >= 2
      ? metricState.committedGnssAltitudeDescentMeters
      : null,
    sampleCount,
    rejectedSampleCount,
    confidence
  };
}

function committedSelectedAscentResult(
  barometerAscentResult,
  gnssAltitudeResult,
  unavailableReason
) {
  if (Number.isFinite(barometerAscentResult?.totalAscentMeters)
      && barometerAscentResult.confidence !== 'none') {
    return {
      source: 'BAROMETER',
      totalAscentMeters: barometerAscentResult.totalAscentMeters,
      totalDescentMeters: Number.isFinite(barometerAscentResult.totalDescentMeters)
        ? barometerAscentResult.totalDescentMeters
        : null,
      confidence: barometerAscentResult.confidence,
      reason: 'committed_barometer_primary'
    };
  }
  if (Number.isFinite(gnssAltitudeResult?.totalAscentMeters)
      && gnssAltitudeResult.confidence !== 'none') {
    return {
      source: 'GNSS',
      totalAscentMeters: gnssAltitudeResult.totalAscentMeters,
      totalDescentMeters: Number.isFinite(gnssAltitudeResult.totalDescentMeters)
        ? gnssAltitudeResult.totalDescentMeters
        : null,
      confidence: gnssAltitudeResult.confidence,
      reason: 'committed_gnss_altitude_fallback'
    };
  }
  return {
    source: 'NONE',
    totalAscentMeters: null,
    totalDescentMeters: null,
    confidence: 'none',
    reason: unavailableReason
  };
}

function selectedAscentFromStats(stats) {
  if (stats.barometerTotalAscentMeters >= 0 && stats.barometerAscentConfidence !== 'none') {
    return {
      source: 'BAROMETER',
      totalAscentMeters: stats.barometerTotalAscentMeters,
      totalDescentMeters: stats.barometerTotalDescentMeters >= 0
        ? stats.barometerTotalDescentMeters
        : null,
      confidence: stats.barometerAscentConfidence,
      reason: 'barometer_primary'
    };
  }
  if (stats.locationAltitudeTotalAscentMeters >= 0
      && stats.locationAltitudeAscentConfidence !== 'none') {
    return {
      source: 'GNSS',
      totalAscentMeters: stats.locationAltitudeTotalAscentMeters,
      totalDescentMeters: stats.locationAltitudeTotalDescentMeters >= 0
        ? stats.locationAltitudeTotalDescentMeters
        : null,
      confidence: stats.locationAltitudeAscentConfidence,
      reason: 'gnss_altitude_fallback'
    };
  }
  return {
    source: 'NONE',
    totalAscentMeters: null,
    totalDescentMeters: null,
    confidence: 'none',
    reason: 'ascent_evidence_unavailable'
  };
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizedRawPointTimeline(rawPointTimeline) {
  return (rawPointTimeline || [])
    .map((point) => ({
      rawPointId: finiteNumber(point?.rawPointId),
      elapsedRealtimeNanos: finiteNumber(point?.elapsedRealtimeNanos)
    }))
    .filter((point) =>
      Number.isFinite(point.rawPointId) && Number.isFinite(point.elapsedRealtimeNanos))
    .sort((a, b) => a.rawPointId - b.rawPointId);
}

function previousRawPointBefore(timeline, rawPointId) {
  let previous = null;
  for (const point of timeline) {
    if (point.rawPointId < rawPointId) {
      previous = point;
    } else {
      break;
    }
  }
  return previous;
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

// L1a: share element references instead of per-advance deep cloning; see
// streamingBaseTrackKernel.mjs for the immutability rationale.
function structuredCloneFallback(value) {
  return value;
}
