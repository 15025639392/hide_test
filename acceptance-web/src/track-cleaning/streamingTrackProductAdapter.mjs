// Adapter: drive the streaming track engine over a parsed evidence model and
// assemble a product object shaped like buildSixLayerTrackProduct's output, so
// the web UI (diagnosticMap.buildTargetOutput + map layers) can render the
// STREAMING engine's cleaning result in place of the batch engine.
//
// The cleaned output line is the streaming committedTrack (localRebuild) — the
// final flushed product, equivalent to the batch product.track. Other product
// fields map directly from the shared streaming state; batch-only diagnostic
// fields (forward-spine / dense-area internals) default empty so the diagnostic
// helpers degrade gracefully rather than throw.
import {
  advanceStreamingTrackEngine,
  createStreamingTrackEngineState,
  finishStreamingTrackEngine
} from './streamingTrackEngine.mjs';

export const STREAMING_TRACK_PRODUCT_ADAPTER_VERSION = 'streaming-track-product-adapter-v0';

export function buildStreamingTrackProduct(model = {}, options = {}) {
  const config = options.config;
  let state = createStreamingTrackEngineState({ config });
  state = advanceStreamingTrackEngine(state, {
    events: Array.isArray(model.events) ? model.events : [],
    enableScenarioRecognizers: true,
    finish: true
  });
  state = finishStreamingTrackEngine(state);

  const summary = state.lastAdvanceSummary || {};
  const baseKernel = state.baseKernel || {};
  const localRebuild = state.localRebuild || {};
  const metricAccumulator = state.metricAccumulator || {};

  const committedTrack = Array.isArray(localRebuild.committedTrack)
    ? localRebuild.committedTrack
    : [];

  return {
    algorithmVersion: STREAMING_TRACK_PRODUCT_ADAPTER_VERSION,
    strategyVersion: model.strategyVersion,
    sourceFilePath: model.filePath,
    engine: 'streaming',
    track: committedTrack,
    excluded: baseKernel.excluded || { weak: [], rejected: [], intakeRejected: [] },
    rawPointDecisions: baseKernel.rawPointDecisions || [],
    barometerWindowDecisions: metricAccumulator.barometerWindowDecisions || [],
    stats: buildStreamingStats(baseKernel, localRebuild, summary),
    scenarios: [],
    streamingSettlementState: summary.streamingSettlementState || null,
    // Batch-only diagnostic internals — empty defaults for graceful degradation.
    forwardSpineCandidates: [],
    forwardSpineConflicts: [],
    forwardSpineDecisions: [],
    forwardSpineOverlaps: [],
    denseIntentConflicts: [],
    denseAreaSettlementPlan: null,
    scenarioSettlementPlan: summary.diagnosticContexts || null
  };
}

function buildStreamingStats(baseKernel, localRebuild, summary) {
  const baseStats = baseKernel.stats || {};
  const rebuildStats = localRebuild.stats || {};
  const metrics = summary.metrics || {};
  return {
    ...baseStats,
    totalDistanceMeters: finite(rebuildStats.totalDistanceMeters)
      ?? finite(metrics.totalDistanceMeters)
      ?? finite(baseStats.totalDistanceMeters)
      ?? 0,
    movingTimeSeconds: finite(rebuildStats.movingTimeSeconds)
      ?? finite(metrics.movingTimeSeconds)
      ?? finite(baseStats.movingTimeSeconds)
      ?? 0,
    trustedPointCount: (localRebuild.committedTrack || []).length
  };
}

function finite(value) {
  return Number.isFinite(value) ? value : undefined;
}
