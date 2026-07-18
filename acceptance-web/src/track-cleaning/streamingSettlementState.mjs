export function createStreamingSettlementState(overrides = {}) {
  return {
    committedCursorRawPointId: finiteNumber(overrides.committedCursorRawPointId),
    commitSequence: finiteNumber(overrides.commitSequence) ?? 0,
    committedRanges: cloneArray(overrides.committedRanges),
    committedMetricOwnershipRanges: cloneArray(overrides.committedMetricOwnershipRanges),
    hardBoundaryCheckpoints: cloneArray(overrides.hardBoundaryCheckpoints),
    blockingRanges: cloneArray(overrides.blockingRanges),
    lastCommitPlanStatus: overrides.lastCommitPlanStatus || 'none',
    lastCommitWatermark: finiteNumber(overrides.lastCommitWatermark)
  };
}

export function applyCommitPlanToStreamingState(state, commitPlan) {
  const previous = createStreamingSettlementState(state);
  const appliedRanges = [];
  const appliedMetricOwnershipRanges = [];
  const hardBoundaryCheckpoints = [...previous.hardBoundaryCheckpoints];
  const committedRanges = [...previous.committedRanges];
  const committedMetricOwnershipRanges = [...previous.committedMetricOwnershipRanges];
  let cursor = previous.committedCursorRawPointId;
  let sequence = previous.commitSequence;
  const previousCursor = previous.committedCursorRawPointId;

  for (const item of commitPlan?.committableRanges || []) {
    const normalized = normalizeCommitRange(item);
    if (!normalized) continue;
    const start = Number.isFinite(cursor)
      ? Math.max(normalized.range.startRawPointId, cursor + 1)
      : normalized.range.startRawPointId;
    const end = normalized.range.endRawPointId;
    if (start > end) continue;
    const applied = {
      ...normalized,
      range: {
        startRawPointId: start,
        endRawPointId: end
      },
      commitSequence: ++sequence
    };
    appliedRanges.push(applied);
    committedRanges.push(applied);
    if (applied.type === 'hard_boundary') {
      hardBoundaryCheckpoints.push({
        proposalId: applied.proposalId,
        scenario: applied.scenario,
        range: applied.range,
        affectedMetricGates: applied.affectedMetricGates || [],
        commitSequence: applied.commitSequence
      });
    }
    cursor = end;
  }

  if (Number.isFinite(cursor)) {
    for (const item of commitPlan?.metricOwnershipRanges || []) {
      const normalized = normalizeMetricOwnershipRange(item);
      if (!normalized) continue;
      const start = Number.isFinite(previousCursor)
        ? Math.max(normalized.range.startRawPointId, previousCursor + 1)
        : normalized.range.startRawPointId;
      const end = Math.min(normalized.range.endRawPointId, cursor);
      if (start > end) continue;
      const applied = {
        ...normalized,
        range: {
          startRawPointId: start,
          endRawPointId: end
        },
        commitSequence: sequence
      };
      appliedMetricOwnershipRanges.push(applied);
      appendMetricOwnershipRange(committedMetricOwnershipRanges, applied);
    }
  }

  return {
    ...previous,
    committedCursorRawPointId: Number.isFinite(cursor) ? cursor : null,
    commitSequence: sequence,
    committedRanges,
    committedMetricOwnershipRanges,
    hardBoundaryCheckpoints,
    blockingRanges: cloneArray(commitPlan?.blockingRanges),
    lastCommitPlanStatus: commitPlan?.status || 'none',
    lastCommitWatermark: finiteNumber(commitPlan?.commitWatermark),
    lastAppliedRangeCount: appliedRanges.length,
    lastAppliedRanges: appliedRanges,
    lastAppliedMetricOwnershipRanges: appliedMetricOwnershipRanges
  };
}

export function streamingSettlementSnapshot(commitPlan, previousState = null) {
  return applyCommitPlanToStreamingState(
    createStreamingSettlementState(previousState || {}),
    commitPlan
  );
}

export function exportStreamingSettlementStateContract(state = {}) {
  const normalized = createStreamingSettlementState(state);
  return {
    schemaVersion: 'track-sdk-streaming-settlement-state-v1',
    committedCursorSampleId: normalized.committedCursorRawPointId,
    commitSequence: normalized.commitSequence,
    committedRanges: normalized.committedRanges
      .map(publicCommittedRange)
      .filter(Boolean),
    committedMetricOwnershipRanges: normalized.committedMetricOwnershipRanges
      .map(publicMetricOwnershipRange)
      .filter(Boolean),
    hardBoundaryCheckpoints: normalized.hardBoundaryCheckpoints
      .map(publicHardBoundaryCheckpoint)
      .filter(Boolean),
    blockingRanges: normalized.blockingRanges
      .map(publicBlockingRange)
      .filter(Boolean),
    lastCommitPlanStatus: normalized.lastCommitPlanStatus,
    lastCommitWatermark: normalized.lastCommitWatermark
  };
}

function normalizeCommitRange(item) {
  const range = normalizeRange(item?.range);
  if (!range) return null;
  return {
    type: item.type || 'normal',
    proposalId: item.proposalId ?? null,
    scenario: item.scenario ?? null,
    range,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : []
  };
}

function normalizeMetricOwnershipRange(item) {
  const range = normalizeRange(item?.range);
  if (!range) return null;
  return {
    type: item.type || 'base_kernel',
    proposalId: item.proposalId ?? null,
    parentProposalId: item.parentProposalId ?? null,
    scenario: item.scenario ?? null,
    range,
    hardBoundary: item.hardBoundary === true,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : []
  };
}

function publicCommittedRange(item) {
  const sampleRange = sampleRangeFromInternalRange(item?.range);
  const commitSequence = finiteNumber(item?.commitSequence);
  if (!sampleRange || !Number.isFinite(commitSequence) || commitSequence < 1) return null;
  return {
    type: item.type || 'normal',
    proposalId: item.proposalId ?? null,
    scenario: item.scenario ?? null,
    sampleRange,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : [],
    commitSequence
  };
}

function publicMetricOwnershipRange(item) {
  const sampleRange = sampleRangeFromInternalRange(item?.range);
  const commitSequence = finiteNumber(item?.commitSequence);
  if (!sampleRange || !Number.isFinite(commitSequence) || commitSequence < 1) return null;
  return {
    ownerId: metricOwnerId(item),
    sampleRange,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : [],
    hardBoundary: item?.hardBoundary === true,
    commitSequence
  };
}

function publicHardBoundaryCheckpoint(item) {
  const sampleRange = sampleRangeFromInternalRange(item?.range);
  const commitSequence = finiteNumber(item?.commitSequence);
  const proposalId = item?.proposalId == null ? '' : String(item.proposalId);
  const scenario = item?.scenario == null ? '' : String(item.scenario);
  if (!sampleRange || !proposalId || !scenario
      || !Number.isFinite(commitSequence) || commitSequence < 1) {
    return null;
  }
  return {
    proposalId,
    scenario,
    sampleRange,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : [],
    commitSequence
  };
}

function publicBlockingRange(item) {
  const sampleRange = sampleRangeFromInternalRange(item?.range);
  const id = item?.id == null ? '' : String(item.id);
  if (!sampleRange || !id) return null;
  const blockingRange = {
    type: item.type || 'open_window',
    id,
    sampleRange,
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? [...item.affectedMetricGates]
      : []
  };
  if (item.relation) {
    blockingRange.relation = item.relation;
  }
  if (Array.isArray(item.proposalIds)) {
    blockingRange.proposalIds = item.proposalIds.map(String);
  }
  return blockingRange;
}

function sampleRangeFromInternalRange(range) {
  const normalized = normalizeRange(range);
  if (!normalized) return null;
  return {
    startSampleId: normalized.startRawPointId,
    endSampleId: normalized.endRawPointId
  };
}

function metricOwnerId(item) {
  if (item?.ownerId) return String(item.ownerId);
  if (item?.proposalId) return String(item.proposalId);
  return String(item?.type || 'base_kernel');
}

function appendMetricOwnershipRange(ranges, next) {
  const previous = ranges.at(-1);
  if (canMergeMetricOwnershipRange(previous, next)) {
    previous.range = {
      startRawPointId: previous.range.startRawPointId,
      endRawPointId: next.range.endRawPointId
    };
    previous.commitSequence = next.commitSequence;
  } else {
    ranges.push(next);
  }
}

function canMergeMetricOwnershipRange(left, right) {
  return left
    && right
    && left.type === right.type
    && left.proposalId === right.proposalId
    && left.parentProposalId === right.parentProposalId
    && left.scenario === right.scenario
    && left.hardBoundary === right.hardBoundary
    && arraysEqual(left.affectedMetricGates, right.affectedMetricGates)
    && left.range.endRawPointId + 1 === right.range.startRawPointId;
}

function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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
