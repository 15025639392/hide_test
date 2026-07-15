import {
  appendEvidenceEvents,
  appendEvidenceJsonlChunk,
  createStreamingEvidenceIntakeState,
  evidenceIntakeSummary,
  finishEvidenceIntake
} from './streamingEvidenceIntake.mjs';
import {
  advanceStreamingBaseTrackKernel,
  createStreamingBaseTrackKernelState,
  pruneStreamingBaseTrackKernelForSettlement
} from './streamingBaseTrackKernel.mjs';
import {
  applyStreamingMetricSettlement,
  advanceStreamingMetricAccumulator,
  createStreamingMetricAccumulatorState,
  streamingMetricSnapshot
} from './streamingMetricAccumulator.mjs';
import {
  advanceStreamingScenarioSettlementSession,
  createStreamingScenarioSettlementSession
} from './streamingScenarioSettlementSession.mjs';
import { exportStreamingSettlementStateContract } from './streamingSettlementState.mjs';
import {
  advanceStreamingScenarioRecognizer,
  createStreamingScenarioRecognizerState
} from './streamingScenarioRecognizer.mjs';
import {
  applyStreamingLocalRebuild,
  createStreamingLocalRebuildState,
  streamingLocalRebuildSnapshot
} from './streamingLocalRebuild.mjs';
import { buildStreamingDiagnosticContextReport } from './streamingDiagnosticContextReport.mjs';

export const STREAMING_TRACK_ENGINE_VERSION = 'streaming-track-engine-v0';

export function createStreamingTrackEngineState(overrides = {}) {
  return {
    version: STREAMING_TRACK_ENGINE_VERSION,
    evidenceIntake: createStreamingEvidenceIntakeState(overrides.evidenceIntake),
    baseKernel: createStreamingBaseTrackKernelState(overrides.baseKernel || {
      config: overrides.config
    }),
    metricAccumulator: createStreamingMetricAccumulatorState(overrides.metricAccumulator || {
      config: overrides.config
    }),
    scenarioRecognizer: createStreamingScenarioRecognizerState(overrides.scenarioRecognizer),
    scenarioSettlementSession: createStreamingScenarioSettlementSession(
      overrides.scenarioSettlementSession
    ),
    localRebuild: createStreamingLocalRebuildState(overrides.localRebuild),
    processedEvidenceEventCount: finiteNumber(overrides.processedEvidenceEventCount) ?? 0,
    lastAdvanceSummary: cloneObject(overrides.lastAdvanceSummary) || null
  };
}

export function advanceStreamingTrackEngine(previousState = {}, input = {}) {
  const state = createStreamingTrackEngineState(previousState);
  const evidenceIntake = advanceEvidenceIntake(state.evidenceIntake, input);
  const newEvents = evidenceIntake.events.slice(state.processedEvidenceEventCount);
  let baseKernel = advanceStreamingBaseTrackKernel(state.baseKernel, newEvents);
  let metricAccumulator = advanceStreamingMetricAccumulator(
    state.metricAccumulator,
    newEvents
  );
  const scenarioRecognizer = advanceStreamingScenarioRecognizer(
    state.scenarioRecognizer,
    baseKernel,
    {
      enabled: input.enableScenarioRecognizers === true,
      emitOpenWindows: input.emitScenarioRecognizerOpenWindows !== false,
      metricAccumulator,
      finish: input.finish === true,
      config: baseKernel.config
    }
  );
  const scenarioSettlementSession = advanceScenarioSettlement(
    state.scenarioSettlementSession,
    baseKernel,
    input,
    scenarioRecognizer
  );
  metricAccumulator = applyStreamingMetricSettlement(
    metricAccumulator,
    scenarioSettlementSession.settlementState,
    baseKernel.rawPointTimeline,
    baseKernel.track
  );
  const localRebuild = applyStreamingLocalRebuild(
    state.localRebuild,
    baseKernel,
    scenarioSettlementSession
  );
  baseKernel = pruneStreamingBaseTrackKernelForSettlement(
    baseKernel,
    scenarioSettlementSession.settlementState
  );

  return {
    ...state,
    evidenceIntake,
    baseKernel,
    metricAccumulator,
    scenarioRecognizer,
    scenarioSettlementSession,
    localRebuild,
    processedEvidenceEventCount: evidenceIntake.events.length,
    lastAdvanceSummary: {
      newEvidenceEventCount: newEvents.length,
      processedEvidenceEventCount: evidenceIntake.events.length,
      currentRawPointId: baseKernel.lastProcessedRawPointId,
      committedCursorRawPointId:
        scenarioSettlementSession.settlementState.committedCursorRawPointId,
      streamingSettlementState: exportStreamingSettlementStateContract(
        scenarioSettlementSession.settlementState
      ),
      baseTrackPointCount: baseKernel.track.length,
      baseRawDecisionCount: baseKernel.rawPointDecisions.length,
      recognizer: {
        enabled: scenarioRecognizer.enabled,
        proposalCount: scenarioRecognizer.proposals?.length || 0,
        openWindowCount: scenarioRecognizer.openWindows?.length || 0
      },
      suspectedTransport: suspectedTransportSnapshot(baseKernel.stats),
      metrics: streamingMetricSnapshot(
        metricAccumulator,
        scenarioSettlementSession.settlementState,
        baseKernel.rawPointTimeline,
        baseKernel.track
      ),
      product: streamingLocalRebuildSnapshot(localRebuild),
      diagnosticContexts: buildStreamingDiagnosticContextReport(scenarioSettlementSession),
      intake: evidenceIntakeSummary(evidenceIntake)
    }
  };
}

export function finishStreamingTrackEngine(previousState = {}) {
  return advanceStreamingTrackEngine(previousState, { finish: true });
}

function advanceEvidenceIntake(evidenceIntake, input) {
  let next = evidenceIntake;
  if (Object.prototype.hasOwnProperty.call(input, 'jsonlChunk')) {
    next = appendEvidenceJsonlChunk(next, input.jsonlChunk, {
      finish: input.finish === true
    });
  }
  if (Array.isArray(input.events)) {
    next = appendEvidenceEvents(next, input.events);
  }
  if (input.finish === true
      && !Object.prototype.hasOwnProperty.call(input, 'jsonlChunk')) {
    next = finishEvidenceIntake(next);
  }
  return next;
}

function advanceScenarioSettlement(previousSession, baseKernel, input, recognizer = {}) {
  const currentRawPointId = finiteNumber(input.currentRawPointId)
    ?? baseKernel.lastProcessedRawPointId;
  const firstRawPointId = firstUncommittedRawPointId(
    previousSession,
    baseKernel.rawPointDecisions
  );
  const settlementInput = {
    firstRawPointId,
    currentRawPointId,
    lookaheadRawPoints: finiteNumber(input.lookaheadRawPoints) ?? 0
  };
  const openWindows = mergeArrays(input.openWindows, recognizer.openWindows);
  if (openWindows.length > 0 || Object.prototype.hasOwnProperty.call(input, 'openWindows')) {
    settlementInput.openWindows = openWindows;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'closedProposals')) {
    settlementInput.closedProposals = mergeArrays(
      input.closedProposals,
      recognizer.proposals
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'proposals')) {
    settlementInput.proposals = mergeArrays(input.proposals, recognizer.proposals);
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'closedProposals')
      && !Object.prototype.hasOwnProperty.call(input, 'proposals')
      && recognizer.proposals?.length > 0) {
    settlementInput.closedProposals = recognizer.proposals;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'retiredProposalIds')) {
    settlementInput.retiredProposalIds = input.retiredProposalIds;
  }
  return advanceStreamingScenarioSettlementSession(previousSession, settlementInput);
}

function mergeArrays(left, right) {
  return [
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : [])
  ];
}

function firstUncommittedRawPointId(scenarioSettlementSession, rawPointDecisions) {
  const cursor = finiteNumber(
    scenarioSettlementSession?.settlementState?.committedCursorRawPointId
  );
  if (Number.isFinite(cursor)) return cursor + 1;
  const rawPointIds = (rawPointDecisions || [])
    .map((decision) => finiteNumber(decision.rawPointId))
    .filter(Number.isFinite);
  return rawPointIds.length > 0 ? Math.min(...rawPointIds) : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneObject(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : null;
}

function suspectedTransportSnapshot(stats = {}) {
  return {
    pointCount: finiteNumber(stats.suspectedTransportPointCount)
      ?? finiteNumber(stats.transportCount)
      ?? 0,
    segmentCount: finiteNumber(stats.suspectedTransportSegmentCount) ?? 0,
    distanceMeters: finiteNumber(stats.suspectedTransportDistanceMeters) ?? 0,
    durationSeconds: finiteNumber(stats.suspectedTransportDurationSeconds) ?? 0,
    averageSpeedMetersPerSecond:
      finiteNumber(stats.suspectedTransportAverageSpeedMetersPerSecond),
    diagnosticOnly: true
  };
}
