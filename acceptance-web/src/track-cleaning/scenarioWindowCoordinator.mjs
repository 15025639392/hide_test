export const DEFAULT_SCENARIO_PROPOSAL_PRIORITIES = Object.freeze({
  gap_recovery_boundary: 10,
  pause_resume_boundary: 10,
  transport_contamination: 10,
  pressure_jump: 10,
  weak_recovery_endpoint: 10,
  moving_spike_cleanup: 20,
  position_snap_recovery: 20,
  enclosed_loop_cluster_settlement: 25,
  stationary_drift_collapse: 30,
  rest_photo_micro_move: 30,
  dense_main_route_settlement: 40,
  same_road_round_trip: 40,
  round_trip_line: 40,
  dense_area_intent: 90,
  closed_loop_round_trip: 90,
  enclosed_gap_cluster: 90,
  composite_gap_local_settlement: 90
});

const ALL_METRIC_GATES = Object.freeze(['route', 'distance', 'moving_time', 'elevation']);
const PRODUCT_TRACK_METRIC_GATES = Object.freeze(['route', 'distance', 'moving_time']);
const DEFAULT_PRIORITY = 50;

export function coordinateScenarioProposals(proposals, options = {}) {
  const normalizedAll = (proposals || [])
    .map((proposal, index) => normalizeScenarioProposal(proposal, index))
    .filter(Boolean)
    .sort(compareScenarioProposals);

  // 与批处理对齐：批处理在生成 moving_spike 场景前先用 nonOverlappingMovingSpikeCandidates
  // 按几何分数贪心去重叠（保留 score 高者、丢弃重叠者）。流式识别器逐 advance 发射、
  // 无法回撤已发射的低分提案，因此在这里（协调器持有全部竞争提案）复刻同一去重叠规则。
  // 否则两个重叠的单点 moving_spike 提案会落到 partial→conservative_fallback，冻结
  // 提交游标并在 finish 时丢弃该段（丢数据的正确性 bug）。
  const { kept: normalized, superseded: supersededMovingSpikes } =
    deoverlapMovingSpikeProposals(normalizedAll);

  const activeProposals = [];
  const contextProposals = [];
  const rejectedProposals = supersededMovingSpikes.map((proposal) =>
    withCoordinatorState(proposal, 'moving_spike_overlap_superseded',
      proposal.supersededByProposal));
  const conflicts = [];
  const ownership = [];

  for (const proposal of normalized) {
    if (!proposal.metricOwner) {
      contextProposals.push(withCoordinatorState(proposal, 'context_only'));
      continue;
    }

    const blockers = overlappingMetricOwners(proposal, activeProposals);
    if (blockers.length === 0) {
      activeProposals.push(withCoordinatorState(proposal, 'active'));
      ownership.push(ownershipRecord(proposal));
      continue;
    }

    const hardBoundary = blockers.find((blocker) => blocker.hardBoundary);
    if (hardBoundary) {
      const hardBoundarySplit = splitParentProposal(proposal, blockers, (blocker) =>
        blocker.hardBoundary ? 'split_at_hard_boundary' : 'split_parent_remaining');
      if (hardBoundarySplit) {
        conflicts.push(...hardBoundarySplit.conflicts);
        activeProposals.push(...hardBoundarySplit.activeSlices);
        ownership.push(...hardBoundarySplit.activeSlices.map((slice) => ownershipRecord(slice)));
        contextProposals.push(withCoordinatorState(proposal, 'hard_boundary_parent_split',
          hardBoundarySplit.blockers[0], hardBoundarySplit.conflicts[0]));
        continue;
      }

      const relation = classifyRangeRelation(proposal.metricRange, hardBoundary.metricRange);
      const conflict = buildConflict(proposal, hardBoundary, relation);
      conflicts.push(conflict);
      rejectedProposals.push(withCoordinatorState(proposal, 'blocked_by_hard_boundary',
        hardBoundary, conflict));
      continue;
    }

    const splitDecision = splitNestedParentProposal(proposal, blockers);
    if (splitDecision) {
      conflicts.push(...splitDecision.conflicts);
      activeProposals.push(...splitDecision.activeSlices);
      ownership.push(...splitDecision.activeSlices.map((slice) => ownershipRecord(slice)));
      contextProposals.push(withCoordinatorState(proposal, 'nested_parent_split',
        splitDecision.blockers[0], splitDecision.conflicts[0]));
      continue;
    }

    const blocker = blockers[0];
    const relation = classifyRangeRelation(proposal.metricRange, blocker.metricRange);
    const conflict = buildConflict(proposal, blocker, relation);
    conflicts.push(conflict);

    if (relation === 'nested' || relation === 'equal') {
      contextProposals.push(withCoordinatorState(proposal, `${relation}_context`,
        blocker, conflict));
      continue;
    }

    rejectedProposals.push(withCoordinatorState(proposal, 'metric_owner_conflict',
      blocker, conflict));
  }

  const commitWatermark = computeCommitWatermark(options, conflicts);
  const commitPlan = buildCommitPlan({
    activeProposals,
    conflicts,
    commitWatermark
  }, options);

  return {
    activeProposals,
    contextProposals,
    rejectedProposals,
    conflicts,
    ownership,
    commitWatermark,
    commitPlan,
    unresolvedMetricOwnerCount: unresolvedMetricOwnerCount(options)
  };
}

export function buildCommitPlan(plan, options = {}) {
  const activeProposals = plan?.activeProposals || [];
  const conflicts = plan?.conflicts || [];
  const commitWatermark = finiteNumber(plan?.commitWatermark);
  const blockingRanges = commitBlockingRanges(conflicts, options);
  const firstRawPointId = finiteNumber(options.firstRawPointId)
    ?? minRangeStart(activeProposals.map((proposal) => proposal.metricRange));
  const committedCursorRawPointId = finiteNumber(options.committedCursorRawPointId);
  const startRawPointId = committedCursorRawPointId !== null
    ? committedCursorRawPointId + 1
    : firstRawPointId;
  const blocked = blockingRanges.length > 0;
  const endRawPointId = Number.isFinite(commitWatermark)
    ? blocked ? commitWatermark - 1 : commitWatermark
    : null;
  const hardBoundaries = activeProposals
    .filter((proposal) => proposal.hardBoundary)
    .map((proposal) => ({
      proposalId: proposal.id,
      scenario: proposal.scenario,
      range: proposal.metricRange,
      affectedMetricGates: proposal.affectedMetricGates || []
    }))
    .sort((a, b) => a.range.startRawPointId - b.range.startRawPointId
      || a.range.endRawPointId - b.range.endRawPointId
      || String(a.proposalId).localeCompare(String(b.proposalId)));
  const committableRanges = Number.isFinite(startRawPointId)
      && Number.isFinite(endRawPointId)
      && startRawPointId <= endRawPointId
    ? splitCommittableRanges({
      startRawPointId,
      endRawPointId
    }, hardBoundaries)
    : [];
  const metricOwnershipRanges = Number.isFinite(startRawPointId)
      && Number.isFinite(endRawPointId)
      && startRawPointId <= endRawPointId
    ? buildMetricOwnershipRanges({
      startRawPointId,
      endRawPointId
    }, activeProposals)
    : [];

  return {
    status: blocked ? 'blocked_at_watermark' : 'committable',
    startRawPointId: Number.isFinite(startRawPointId) ? startRawPointId : null,
    endRawPointId: Number.isFinite(endRawPointId) ? endRawPointId : null,
    commitWatermark: Number.isFinite(commitWatermark) ? commitWatermark : null,
    hardBoundaries,
    blockingRanges,
    committableRanges,
    metricOwnershipRanges
  };
}

export function normalizeScenarioProposal(proposal, inputIndex = 0) {
  if (!proposal || typeof proposal !== 'object') return null;
  const rawRange = normalizeRange(proposal.rawRange);
  const influenceRange = normalizeRange(proposal.influenceRange) || rawRange;
  const metricRange = normalizeRange(proposal.metricRange) || influenceRange;
  if (!rawRange || !influenceRange || !metricRange) return null;

  const scenario = String(proposal.scenario || proposal.type || 'unknown');
  const metricOwner = proposal.metricOwner !== false;
  const hardBoundary = proposal.hardBoundary === true;
  return {
    ...proposal,
    id: String(proposal.id || `${scenario}:${rawRange.startRawPointId}-${rawRange.endRawPointId}:${inputIndex}`),
    scenario,
    rawRange,
    influenceRange,
    metricRange,
    hardBoundary,
    metricOwner,
    priority: finiteNumber(proposal.priority)
      ?? DEFAULT_SCENARIO_PROPOSAL_PRIORITIES[scenario]
      ?? DEFAULT_PRIORITY,
    confidence: finiteNumber(proposal.confidence) ?? 0,
    compatibilityTags: Array.isArray(proposal.compatibilityTags)
      ? [...proposal.compatibilityTags]
      : [],
    inputIndex
  };
}

export function classifyRangeRelation(left, right) {
  const a = normalizeRange(left);
  const b = normalizeRange(right);
  if (!a || !b) return 'invalid';

  if (a.endRawPointId < b.startRawPointId) {
    return b.startRawPointId - a.endRawPointId <= 1 ? 'adjacent' : 'disjoint';
  }
  if (b.endRawPointId < a.startRawPointId) {
    return a.startRawPointId - b.endRawPointId <= 1 ? 'adjacent' : 'disjoint';
  }
  if (a.startRawPointId === b.startRawPointId && a.endRawPointId === b.endRawPointId) {
    return 'equal';
  }
  const aContainsB = a.startRawPointId <= b.startRawPointId
    && a.endRawPointId >= b.endRawPointId;
  const bContainsA = b.startRawPointId <= a.startRawPointId
    && b.endRawPointId >= a.endRawPointId;
  if (aContainsB || bContainsA) return 'nested';
  return 'partial';
}

export function rangesOverlap(left, right) {
  const relation = classifyRangeRelation(left, right);
  return relation === 'nested' || relation === 'partial' || relation === 'equal';
}

export function compareScenarioProposals(left, right) {
  if (left.hardBoundary !== right.hardBoundary) {
    return left.hardBoundary ? -1 : 1;
  }
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  const lengthOrder = rangeLengthSort(left, right);
  if (lengthOrder !== 0) return lengthOrder;
  if (left.metricRange.startRawPointId !== right.metricRange.startRawPointId) {
    return left.metricRange.startRawPointId - right.metricRange.startRawPointId;
  }
  return String(left.id).localeCompare(String(right.id));
}

function overlappingMetricOwners(proposal, activeProposals) {
  return activeProposals.filter((active) =>
    active.metricOwner
      && rangesOverlap(proposal.metricRange, active.metricRange)
      && metricGatesOverlap(proposal, active));
}

function normalizeRange(range) {
  if (!range || typeof range !== 'object') return null;
  const start = finiteNumber(range.startRawPointId ?? range.start);
  const end = finiteNumber(range.endRawPointId ?? range.end);
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

function rangeLength(range) {
  return Math.max(0, range.endRawPointId - range.startRawPointId + 1);
}

function rangeLengthSort(left, right) {
  const leftLength = rangeLength(left.metricRange);
  const rightLength = rangeLength(right.metricRange);
  const leftCleanup = left.priority <= 20;
  const rightCleanup = right.priority <= 20;
  if (leftCleanup || rightCleanup) {
    return leftLength - rightLength;
  }
  return rightLength - leftLength;
}

function withCoordinatorState(proposal, state, blocker = null, conflict = null) {
  return {
    ...proposal,
    coordinatorState: state,
    blockedByProposalId: blocker?.id ?? null,
    conflictId: conflict?.conflictId ?? null
  };
}

function buildConflict(proposal, blocker, relation, resolutionOverride = null) {
  const range = intersectRanges(proposal.metricRange, blocker.metricRange);
  const resolution = resolutionOverride
    ?? defaultConflictResolution(blocker, relation);
  return {
    conflictId: `conflict:${blocker.id}:${proposal.id}`,
    proposalIds: [blocker.id, proposal.id],
    relation,
    range,
    overlappingMetricGates: overlappingMetricGates(proposal, blocker),
    resolution,
    activeProposalId: blocker.id,
    blockedProposalId: proposal.id
  };
}

function defaultConflictResolution(blocker, relation) {
  if (blocker.hardBoundary) return 'blocked_by_hard_boundary';
  if (relation === 'nested' || relation === 'equal') return 'context_only';
  return 'conservative_fallback';
}

// 复刻批处理 sixLayerTrackProduct.nonOverlappingMovingSpikeCandidates：对互相重叠的
// 单点 moving_spike 清理提案做贪心去重叠——按几何分数(detour*2+lateral)降序，保留最高分、
// 丢弃与已保留者 metricRange 重叠的其余提案。tie-break 与批处理逐项对齐(detour 降序、
// reportedSpeed 升序、起点升序)。非 moving_spike 提案原样保留、顺序不变。
function deoverlapMovingSpikeProposals(normalized) {
  const spikes = normalized.filter((proposal) =>
    proposal.scenario === 'moving_spike_cleanup' && proposal.metricOwner);
  if (spikes.length < 2) {
    return { kept: normalized, superseded: [] };
  }

  const accepted = [];
  const supersededById = new Map();
  for (const candidate of [...spikes].sort(compareMovingSpikeForDeoverlap)) {
    const winner = accepted.find((existing) =>
      rangesOverlap(candidate.metricRange, existing.metricRange));
    if (winner) {
      supersededById.set(candidate.id, {
        ...candidate,
        supersededByProposal: winner
      });
      continue;
    }
    accepted.push(candidate);
  }

  if (supersededById.size === 0) {
    return { kept: normalized, superseded: [] };
  }
  return {
    kept: normalized.filter((proposal) => !supersededById.has(proposal.id)),
    superseded: [...supersededById.values()]
  };
}

function compareMovingSpikeForDeoverlap(left, right) {
  const scoreOrder = movingSpikeGeometryScore(right) - movingSpikeGeometryScore(left);
  if (scoreOrder !== 0) return scoreOrder;
  const detourOrder = movingSpikeDetour(right) - movingSpikeDetour(left);
  if (detourOrder !== 0) return detourOrder;
  const speedOrder = movingSpikeReportedSpeed(left) - movingSpikeReportedSpeed(right);
  if (speedOrder !== 0) return speedOrder;
  const startOrder = left.metricRange.startRawPointId - right.metricRange.startRawPointId;
  if (startOrder !== 0) return startOrder;
  return String(left.id).localeCompare(String(right.id));
}

function movingSpikeGeometryScore(proposal) {
  return movingSpikeDetour(proposal) * 2 + (finiteNumber(proposal?.evidence?.lateralMeters) ?? 0);
}

function movingSpikeDetour(proposal) {
  return finiteNumber(proposal?.evidence?.detourMeters) ?? 0;
}

function movingSpikeReportedSpeed(proposal) {
  return finiteNumber(proposal?.evidence?.reportedSpeedMetersPerSecond) ?? 0;
}

function splitNestedParentProposal(proposal, blockers) {
  return splitParentProposal(proposal, blockers, () => 'split_parent_remaining');
}

function splitParentProposal(proposal, blockers, resolutionForBlocker) {
  const containedBlockers = blockers.filter((blocker) =>
    rangeContains(proposal.metricRange, blocker.metricRange)
      && !sameRange(proposal.metricRange, blocker.metricRange));
  if (containedBlockers.length !== blockers.length || containedBlockers.length === 0) {
    return null;
  }

  const remainingRanges = subtractRanges(proposal.metricRange,
    containedBlockers.map((blocker) => blocker.metricRange));
  if (remainingRanges.length === 0) return null;

  const conflicts = containedBlockers.map((blocker) =>
    buildConflict(proposal, blocker, 'nested', resolutionForBlocker(blocker)));
  const activeSlices = remainingRanges.map((range) => withCoordinatorState({
    ...proposal,
    id: `${proposal.id}:remaining:${range.startRawPointId}-${range.endRawPointId}`,
    parentProposalId: proposal.id,
    splitFromProposalId: proposal.id,
    splitByProposalIds: containedBlockers.map((blocker) => blocker.id),
    sourceMetricRange: proposal.metricRange,
    sourceRawRange: proposal.rawRange,
    rawRange: range,
    influenceRange: range,
    metricRange: range
  }, 'active_split'));

  return {
    blockers: containedBlockers,
    conflicts,
    activeSlices
  };
}

function subtractRanges(range, blockers) {
  const normalizedBlockers = blockers
    .map((blocker) => intersectRanges(range, blocker))
    .filter((blocker) => blocker.startRawPointId <= blocker.endRawPointId)
    .sort((a, b) => a.startRawPointId - b.startRawPointId
      || a.endRawPointId - b.endRawPointId);
  const remaining = [];
  let cursor = range.startRawPointId;
  for (const blocker of normalizedBlockers) {
    if (cursor < blocker.startRawPointId) {
      remaining.push({
        startRawPointId: cursor,
        endRawPointId: blocker.startRawPointId - 1
      });
    }
    cursor = Math.max(cursor, blocker.endRawPointId + 1);
  }
  if (cursor <= range.endRawPointId) {
    remaining.push({
      startRawPointId: cursor,
      endRawPointId: range.endRawPointId
    });
  }
  return remaining;
}

function rangeContains(parent, child) {
  return parent.startRawPointId <= child.startRawPointId
    && parent.endRawPointId >= child.endRawPointId;
}

function sameRange(left, right) {
  return left.startRawPointId === right.startRawPointId
    && left.endRawPointId === right.endRawPointId;
}

function intersectRanges(left, right) {
  return {
    startRawPointId: Math.max(left.startRawPointId, right.startRawPointId),
    endRawPointId: Math.min(left.endRawPointId, right.endRawPointId)
  };
}

function ownershipRecord(proposal) {
  return {
    proposalId: proposal.id,
    scenario: proposal.scenario,
    metricRange: proposal.metricRange,
    hardBoundary: proposal.hardBoundary,
    affectedMetricGates: Array.isArray(proposal.affectedMetricGates)
      ? [...proposal.affectedMetricGates]
      : []
  };
}

function buildMetricOwnershipRanges(totalRange, activeProposals) {
  const owners = (activeProposals || [])
    .map((proposal) => {
      const range = intersectRanges(totalRange, proposal.metricRange);
      if (range.endRawPointId < range.startRawPointId) return null;
      return { proposal, range };
    })
    .filter(Boolean)
    .sort((a, b) => a.range.startRawPointId - b.range.startRawPointId
      || ownershipProductSortWeight(a.proposal) - ownershipProductSortWeight(b.proposal)
      || a.range.endRawPointId - b.range.endRawPointId
      || String(a.proposal.id).localeCompare(String(b.proposal.id)));
  const ranges = [];
  let cursor = totalRange.startRawPointId;
  for (const owner of owners) {
    if (cursor < owner.range.startRawPointId) {
      ranges.push(baseMetricOwnershipRange({
        startRawPointId: cursor,
        endRawPointId: owner.range.startRawPointId - 1
      }));
    }
    ranges.push(proposalMetricOwnershipRange(owner.proposal, owner.range));
    cursor = Math.max(cursor, owner.range.endRawPointId + 1);
  }
  if (cursor <= totalRange.endRawPointId) {
    ranges.push(baseMetricOwnershipRange({
      startRawPointId: cursor,
      endRawPointId: totalRange.endRawPointId
    }));
  }
  return ranges;
}

function metricGatesOverlap(left, right) {
  const rightGates = metricGateSetForConflict(right);
  for (const gate of metricGateSetForConflict(left)) {
    if (rightGates.has(gate)) return true;
  }
  return false;
}

function overlappingMetricGates(left, right) {
  const rightGates = metricGateSetForConflict(right);
  return [...metricGateSetForConflict(left)].filter((gate) => rightGates.has(gate));
}

function metricGateSetForConflict(proposal) {
  const gates = Array.isArray(proposal?.affectedMetricGates)
    ? proposal.affectedMetricGates
      .map((gate) => String(gate))
      .filter((gate) => ALL_METRIC_GATES.includes(gate))
    : [];
  return new Set(gates.length > 0 ? gates : ALL_METRIC_GATES);
}

function metricGateListForConflict(proposal) {
  return [...metricGateSetForConflict(proposal)];
}

function ownershipProductSortWeight(proposal) {
  const gates = Array.isArray(proposal?.affectedMetricGates)
    ? proposal.affectedMetricGates.map((gate) => String(gate))
    : [];
  if (gates.length === 0) return 0;
  return gates.some((gate) => PRODUCT_TRACK_METRIC_GATES.includes(gate)) ? 0 : 1;
}

function proposalMetricOwnershipRange(proposal, range) {
  return {
    type: proposal.hardBoundary ? 'hard_boundary' : 'scenario_owner',
    proposalId: proposal.id,
    parentProposalId: proposal.parentProposalId ?? null,
    scenario: proposal.scenario,
    range,
    hardBoundary: proposal.hardBoundary,
    affectedMetricGates: Array.isArray(proposal.affectedMetricGates)
      ? [...proposal.affectedMetricGates]
      : []
  };
}

function baseMetricOwnershipRange(range) {
  return {
    type: 'base_kernel',
    proposalId: null,
    parentProposalId: null,
    scenario: null,
    range,
    hardBoundary: false,
    affectedMetricGates: []
  };
}

function computeCommitWatermark(options, conflicts) {
  const openWindowStarts = (options.openWindows || [])
    .filter((window) => window?.metricOwner !== false)
    .map((window) => normalizeRange(window.influenceRange || window.rawRange))
    .filter(Boolean)
    .map((range) => range.startRawPointId);

  const unresolvedConflictStarts = (conflicts || [])
    .filter((conflict) => conflict.resolution === 'conservative_fallback')
    .map((conflict) => normalizeRange(conflict.range))
    .filter(Boolean)
    .map((range) => range.startRawPointId);

  // watermark 必须被“最早的”阻塞点拉住：不能只看 open window，否则一个起点更早的
  // 未解决冲突会被跳过、其区间被误提交，破坏“已提交不回改”不变量。
  const blockingStarts = [...openWindowStarts, ...unresolvedConflictStarts]
    .filter(Number.isFinite);
  if (blockingStarts.length > 0) {
    return Math.min(...blockingStarts);
  }

  const currentRawPointId = finiteNumber(options.currentRawPointId);
  const lookaheadRawPoints = finiteNumber(options.lookaheadRawPoints) ?? 0;
  if (Number.isFinite(currentRawPointId)) {
    return Math.max(0, currentRawPointId - lookaheadRawPoints);
  }
  return null;
}

function unresolvedMetricOwnerCount(options) {
  return (options.openWindows || [])
    .filter((window) => window?.metricOwner !== false).length;
}

function commitBlockingRanges(conflicts, options) {
  const openWindowRanges = (options.openWindows || [])
    .flatMap((window, index) => {
      if (window?.metricOwner === false) return [];
      const range = normalizeRange(window.influenceRange || window.rawRange);
      if (!range) return [];
      return [{
        type: 'open_window',
        id: String(window?.id ?? `open_window:${index}`),
        range,
        affectedMetricGates: metricGateListForConflict(window)
      }];
    });
  const conflictRanges = (conflicts || [])
    .filter((conflict) => conflict.resolution === 'conservative_fallback')
    .map((conflict) => ({
      type: 'unresolved_conflict',
      id: conflict.conflictId,
      relation: conflict.relation,
      proposalIds: conflict.proposalIds,
      range: conflict.range,
      affectedMetricGates: Array.isArray(conflict.overlappingMetricGates)
        ? [...conflict.overlappingMetricGates]
        : []
    }));
  return [...openWindowRanges, ...conflictRanges]
    .filter((item) => normalizeRange(item.range))
    .sort((a, b) => a.range.startRawPointId - b.range.startRawPointId
      || a.range.endRawPointId - b.range.endRawPointId
      || String(a.id).localeCompare(String(b.id)));
}

function splitCommittableRanges(totalRange, hardBoundaries) {
  const ranges = [];
  let cursor = totalRange.startRawPointId;
  for (const boundary of hardBoundaries) {
    const clipped = intersectRanges(totalRange, boundary.range);
    if (clipped.endRawPointId < clipped.startRawPointId) continue;
    if (cursor < clipped.startRawPointId) {
      ranges.push({
        type: 'normal',
        range: {
          startRawPointId: cursor,
          endRawPointId: clipped.startRawPointId - 1
        }
      });
    }
    ranges.push({
      type: 'hard_boundary',
      proposalId: boundary.proposalId,
      scenario: boundary.scenario,
      range: clipped,
      affectedMetricGates: boundary.affectedMetricGates
    });
    cursor = Math.max(cursor, clipped.endRawPointId + 1);
  }
  if (cursor <= totalRange.endRawPointId) {
    ranges.push({
      type: 'normal',
      range: {
        startRawPointId: cursor,
        endRawPointId: totalRange.endRawPointId
      }
    });
  }
  return ranges;
}

function minRangeStart(ranges) {
  const starts = ranges
    .filter(Boolean)
    .map((range) => range.startRawPointId)
    .filter(Number.isFinite);
  return starts.length > 0 ? Math.min(...starts) : null;
}
