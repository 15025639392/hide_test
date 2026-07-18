import {
  coordinateScenarioProposals,
  normalizeScenarioProposal
} from './scenarioWindowCoordinator.mjs';
import {
  applyCommitPlanToStreamingState,
  createStreamingSettlementState
} from './streamingSettlementState.mjs';

export function createStreamingScenarioSettlementSession(overrides = {}) {
  return {
    settlementState: createStreamingSettlementState(
      overrides.settlementState || overrides.streamingSettlementState || overrides
    ),
    pendingProposals: cloneArray(overrides.pendingProposals || overrides.proposalBuffer),
    openWindows: cloneArray(overrides.openWindows),
    lastSettlementPlan: cloneObject(overrides.lastSettlementPlan),
    lastInputSummary: cloneObject(overrides.lastInputSummary)
  };
}

export function advanceStreamingScenarioSettlementSession(previousSession = {}, input = {}) {
  const session = createStreamingScenarioSettlementSession(previousSession);
  const retiredProposalIds = new Set((input.retiredProposalIds || []).map(String));
  const incomingProposals = input.closedProposals || input.proposals || [];
  const pendingProposals = mergeProposalBuffers(
    session.pendingProposals.filter((proposal) =>
      !retiredProposalIds.has(proposalKey(proposal))),
    incomingProposals
  );
  const openWindows = input.openWindows === undefined
    ? session.openWindows
    : cloneArray(input.openWindows);
  const currentRawPointId = finiteNumber(input.currentRawPointId
    ?? input.rawRange?.endRawPointId
    ?? input.rawRange?.end);
  const lookaheadRawPoints = finiteNumber(input.lookaheadRawPoints) ?? 0;
  const firstRawPointId = firstCommittableRawPointId({
    input,
    settlementState: session.settlementState,
    pendingProposals,
    openWindows,
    currentRawPointId
  });
  const plan = coordinateScenarioProposals(pendingProposals, {
    firstRawPointId,
    currentRawPointId,
    lookaheadRawPoints,
    openWindows,
    committedCursorRawPointId: session.settlementState.committedCursorRawPointId,
    // finish 时协调器强制结算被冻结的冲突/未闭合窗口，避免尾巴被丢弃。
    finish: input.finish === true
  });
  const settlementState = applyCommitPlanToStreamingState(
    session.settlementState,
    plan.commitPlan
  );
  const prunedPendingProposals = pruneCommittedProposals(
    pendingProposals,
    settlementState.committedCursorRawPointId
  );

  return {
    settlementState,
    pendingProposals: prunedPendingProposals,
    openWindows,
    lastSettlementPlan: plan,
    lastInputSummary: {
      incomingProposalCount: Array.isArray(incomingProposals)
        ? incomingProposals.length
        : 0,
      pendingProposalCount: prunedPendingProposals.length,
      openWindowCount: openWindows.length,
      retiredProposalCount: retiredProposalIds.size,
      firstRawPointId,
      currentRawPointId,
      lookaheadRawPoints
    }
  };
}

export function streamingScenarioSettlementSessionSnapshot(previousSession, input = {}) {
  return advanceStreamingScenarioSettlementSession(previousSession, input).settlementState;
}

function mergeProposalBuffers(existingProposals, incomingProposals) {
  const byId = new Map();
  for (const proposal of [...cloneArray(existingProposals), ...cloneArray(incomingProposals)]) {
    const key = proposalKey(proposal);
    if (!key) continue;
    byId.set(key, proposal);
  }
  return [...byId.values()].sort(compareProposalBufferItems);
}

function pruneCommittedProposals(proposals, committedCursorRawPointId) {
  const cursor = finiteNumber(committedCursorRawPointId);
  if (!Number.isFinite(cursor)) return cloneArray(proposals);
  return cloneArray(proposals).filter((proposal) => {
    const normalized = normalizeScenarioProposal(proposal);
    if (!normalized) return false;
    const ownershipRange = normalized.metricOwner
      ? normalized.metricRange
      : normalized.rawRange;
    return ownershipRange.endRawPointId > cursor;
  });
}

function firstCommittableRawPointId({
  input,
  settlementState,
  pendingProposals,
  openWindows,
  currentRawPointId
}) {
  const explicit = finiteNumber(input.firstRawPointId
    ?? input.rawRange?.startRawPointId
    ?? input.rawRange?.start);
  if (Number.isFinite(explicit)) return explicit;

  const cursor = finiteNumber(settlementState?.committedCursorRawPointId);
  if (Number.isFinite(cursor)) return cursor + 1;

  const starts = [
    ...pendingProposals.map((proposal) =>
      normalizeScenarioProposal(proposal)?.rawRange?.startRawPointId),
    ...openWindows.map((window) =>
      finiteNumber(window?.influenceRange?.startRawPointId
        ?? window?.influenceRange?.start
        ?? window?.rawRange?.startRawPointId
        ?? window?.rawRange?.start)),
    currentRawPointId
  ].filter(Number.isFinite);
  return starts.length > 0 ? Math.min(...starts) : null;
}

function compareProposalBufferItems(left, right) {
  const leftProposal = normalizeScenarioProposal(left);
  const rightProposal = normalizeScenarioProposal(right);
  if (!leftProposal && !rightProposal) return 0;
  if (!leftProposal) return 1;
  if (!rightProposal) return -1;
  return leftProposal.rawRange.startRawPointId - rightProposal.rawRange.startRawPointId
    || leftProposal.rawRange.endRawPointId - rightProposal.rawRange.endRawPointId
    || String(leftProposal.id).localeCompare(String(rightProposal.id));
}

function proposalKey(proposal) {
  return normalizeScenarioProposal(proposal)?.id ?? null;
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
