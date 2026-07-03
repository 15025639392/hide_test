import { scenarioRepairOption } from './scenarioRepairConfig.mjs';

const SETTLED_REVIEW_SCENARIOS = new Set([
  'rest_photo_micro_move',
  'moving_spike_cleanup'
]);
export const REVIEW_QUEUE_FILTERS = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'metric', label: '指标' },
  { key: 'diagnostic', label: '诊断' },
  { key: 'highRisk', label: '高风险' },
  { key: 'pending', label: '待看' }
]);

export function buildReviewTasks(dataset) {
  if (!dataset) return [];
  const tasks = [];
  const coverage = sortScenarioCoverageForReview(
    dataset.scenarioProduct?.scenarioCoverage || [], dataset);
  coverage.forEach((item, index) => {
    const task = reviewTaskForScenario(item.scenario);
    tasks.push({
      ...task,
      key: `${task.key}-${index}`,
      reviewKey: reviewTaskKeyForScenarioItem(item, index),
      item,
      items: [item],
      startRawPointId: item.rawRange?.startRawPointId ?? Infinity,
      endRawPointId: item.rawRange?.endRawPointId
        ?? item.rawRange?.startRawPointId
        ?? Infinity,
      startTrackPointId: item.trackPointRange?.startTrackPointId
        ?? item.matchedTrackPointRange?.startTrackPointId
        ?? Infinity
    });
  });
  const conflictItems = [
    ...(dataset.targetOutput?.forwardSpineConflicts || [])
  ];
  conflictItems.forEach((item, index) => {
    tasks.push({
      key: 'local_conflict',
      title: '候选冲突',
      note: '地图上有多种可能路线，需要人工优先看',
      rank: 0,
      item,
      items: [item],
      startRawPointId: item.rawRange?.startRawPointId ?? Infinity,
      endRawPointId: item.rawRange?.endRawPointId
        ?? item.rawRange?.startRawPointId
        ?? Infinity,
      startTrackPointId: Infinity,
      conflict: true,
      reviewKey: reviewTaskKeyForConflict(item, index)
    });
  });
  diagnosticContextReviewTasks(dataset).forEach((task) => tasks.push(task));
  return tasks.sort((left, right) =>
    left.startRawPointId - right.startRawPointId
    || left.startTrackPointId - right.startTrackPointId
    || left.rank - right.rank
    || left.title.localeCompare(right.title, 'zh-Hans-CN'));
}

export function reviewQueueStats(dataset, options = {}) {
  const tasks = buildReviewTasks(dataset);
  const statusForTask = typeof options.statusForTask === 'function'
    ? options.statusForTask
    : () => 'pending';
  const stats = {
    total: tasks.length,
    pending: 0,
    approved: 0,
    question: 0,
    skipped: 0,
    done: 0,
    highRisk: 0,
    gap: 0,
    transport: 0,
    diagnosticContext: 0,
    metricOwner: 0
  };
  for (const task of tasks) {
    const status = statusForTask(task) || 'pending';
    stats[status] = (stats[status] || 0) + 1;
    if (status !== 'pending') stats.done++;
    if (reviewTaskIsHighRisk(task, dataset)) stats.highRisk++;
    if (task.diagnosticContext) {
      stats.diagnosticContext++;
    }
    if (reviewTaskOwnsMetrics(task, dataset)) {
      stats.metricOwner++;
    }
    if (!task.diagnosticContext && task.item?.scenario === 'gap_recovery_boundary') {
      stats.gap++;
    }
    if (!task.diagnosticContext && task.item?.scenario === 'transport_contamination') {
      stats.transport++;
    }
  }
  return stats;
}

export function filterReviewTasks(tasks, filter = 'all', options = {}) {
  const normalizedFilter = normalizeReviewQueueFilter(filter);
  const dataset = options.dataset || null;
  const statusForTask = typeof options.statusForTask === 'function'
    ? options.statusForTask
    : () => 'pending';
  return (tasks || []).filter((task) => {
    if (normalizedFilter === 'metric') return reviewTaskOwnsMetrics(task, dataset);
    if (normalizedFilter === 'diagnostic') return task.diagnosticContext;
    if (normalizedFilter === 'highRisk') return reviewTaskIsHighRisk(task, dataset);
    if (normalizedFilter === 'pending') return statusForTask(task) === 'pending';
    return true;
  });
}

export function buildReviewQueueExport(dataset, options = {}) {
  const filter = normalizeReviewQueueFilter(options.filter);
  const statusForTask = typeof options.statusForTask === 'function'
    ? options.statusForTask
    : () => 'pending';
  const tasks = buildReviewTasks(dataset);
  const filteredTasks = filterReviewTasks(tasks, filter, {
    dataset,
    statusForTask
  });
  return {
    schemaVersion: 'review-queue-v1',
    dataset: {
      id: dataset?.id || null,
      fileName: dataset?.fileName || null,
      filePath: dataset?.filePath || null
    },
    filter,
    stats: reviewQueueStats(dataset, { statusForTask }),
    taskCount: filteredTasks.length,
    tasks: filteredTasks.map((task, index) =>
      reviewTaskExportRecord(task, index, { dataset, statusForTask })),
    streamingSettlementState:
      dataset?.targetOutput?.streamingSettlementStateContract || null,
    streamingDiagnosticContexts:
      dataset?.targetOutput?.streamingDiagnosticContexts || null
  };
}

export function sortScenarioCoverageForReview(coverage, dataset) {
  return (coverage || [])
    .filter((item) => reviewerVisibleScenario(item?.scenario))
    .filter((item) => !SETTLED_REVIEW_SCENARIOS.has(item?.scenario))
    .map((item, index) => ({ item, index, level: scenarioReviewLevel(item, dataset) }))
    .sort((left, right) =>
      (left.item.rawRange?.startRawPointId ?? Infinity)
        - (right.item.rawRange?.startRawPointId ?? Infinity)
      || (left.item.trackPointRange?.startTrackPointId
        ?? left.item.matchedTrackPointRange?.startTrackPointId
        ?? Infinity)
        - (right.item.trackPointRange?.startTrackPointId
          ?? right.item.matchedTrackPointRange?.startTrackPointId
          ?? Infinity)
      || left.level.rank - right.level.rank
      || left.index - right.index)
    .map((entry) => entry.item);
}

export function scenarioReviewLevel(item, dataset = null) {
  if (item?.metricOwner === false || item?.diagnosticContext === true) {
    return { rank: 3, kind: 'diagnostic', label: '诊断上下文' };
  }
  if (scenarioCoverageHasConflict(item, dataset)) {
    return { rank: 0, kind: 'conflict', label: '先看冲突' };
  }
  const optionKind = scenarioRepairOption(item?.scenario)?.kind || '';
  if (optionKind === 'rewrite') {
    return { rank: 1, kind: 'rewrite', label: '会改线' };
  }
  if (optionKind === 'hybrid') {
    return { rank: 2, kind: 'hybrid', label: '标注/改线' };
  }
  if (isBoundaryOrRiskScenario(item?.scenario)) {
    return { rank: 2, kind: 'risk', label: '风险边界' };
  }
  if (optionKind === 'diagnostic') {
    return { rank: 3, kind: 'diagnostic', label: '解释标注' };
  }
  return { rank: 4, kind: 'context', label: '复合上下文' };
}

export function reviewTaskIsHighRisk(task, dataset) {
  if (task.diagnosticContext) return false;
  if (task.conflict) return true;
  const level = scenarioReviewLevel(task.item, dataset);
  return level.kind === 'conflict'
    || level.kind === 'risk'
    || task.item?.scenario === 'transport_contamination'
    || task.item?.scenario === 'gap_recovery_boundary';
}

export function reviewTaskOwnsMetrics(task, dataset) {
  if (!task || task.conflict || task.diagnosticContext) return false;
  if (task.item?.metricOwner === false) return false;
  const level = scenarioReviewLevel(task.item, dataset);
  return level.kind === 'rewrite'
    || level.kind === 'hybrid'
    || level.kind === 'risk';
}

export function reviewerVisibleScenario(scenario) {
  return scenario !== 'dense_area_intent'
    && scenario !== 'dense_main_route_settlement';
}

export function scenarioNameLabel(name) {
  const labels = {
    dense_area_intent: '密集区意图',
    dense_main_route_settlement: '密集区主路线',
    weak_recovery_endpoint: '弱信号恢复点',
    same_road_round_trip: '同路来回',
    closed_loop_round_trip: '闭合来回标记',
    round_trip_line: '来回路线太密',
    composite_gap_local_settlement: '长 GAP 复合段',
    enclosed_gap_cluster: '遮挡聚集标记',
    enclosed_loop_cluster_settlement: '遮挡后绕线',
    position_snap_recovery: '定位跳远后接回',
    moving_spike_cleanup: '单点跳远',
    stationary_session_collapse: '整段基本没动',
    stationary_drift_collapse: '原地漂移',
    rest_photo_micro_move: '休息/拍照小移动',
    gap_recovery_boundary: '中断后恢复',
    transport_contamination: '交通工具混入'
  };
  return labels[name] || name || '-';
}

function normalizeReviewQueueFilter(filter) {
  return REVIEW_QUEUE_FILTERS.some((item) => item.key === filter)
    ? filter
    : 'all';
}

function reviewTaskExportRecord(task, index, { dataset, statusForTask }) {
  const item = task.item || {};
  const rawRange = item.rawRange || null;
  const trackRange = item.trackPointRange || item.matchedTrackPointRange || null;
  return {
    order: index + 1,
    reviewKey: task.reviewKey,
    type: task.conflict
      ? 'conflict'
      : task.diagnosticContext
        ? 'diagnostic_context'
        : 'scenario',
    status: statusForTask(task) || 'pending',
    highRisk: reviewTaskIsHighRisk(task, dataset),
    scenario: item.scenario || null,
    title: task.title,
    rawRange,
    trackRange,
    metricOwner: reviewTaskOwnsMetrics(task, dataset),
    affectedMetricGates: Array.isArray(item.affectedMetricGates)
      ? item.affectedMetricGates
      : null,
    action: item.actionLabel || item.action || null,
    localRebuild: item.localRebuildLabel || item.localRebuild || null,
    anchorRawPointIds: Array.isArray(item.anchorRawPointIds)
      ? item.anchorRawPointIds
      : [],
    evidence: item.evidence || null
  };
}

function diagnosticContextReviewTasks(dataset) {
  const contexts = dataset?.targetOutput?.streamingDiagnosticContexts?.contexts || [];
  return contexts
    .filter((context) => context?.metricOwner === false)
    .map((context, index) => {
      const task = reviewTaskForScenario(context.scenario);
      return {
        ...task,
        key: `${task.key}-diagnostic-${index}`,
        reviewKey: reviewTaskKeyForDiagnosticContext(context, index),
        title: task.title,
        note: diagnosticContextNote(context, task.note),
        rank: task.rank + 100,
        item: {
          ...context,
          diagnosticContext: true
        },
        items: [context],
        startRawPointId: context.rawRange?.startRawPointId ?? Infinity,
        endRawPointId: context.rawRange?.endRawPointId
          ?? context.rawRange?.startRawPointId
          ?? Infinity,
        startTrackPointId: Infinity,
        diagnosticContext: true
      };
    });
}

function diagnosticContextNote(context, fallback) {
  const parts = [];
  if (context.evidence?.intent) parts.push(`intent=${context.evidence.intent}`);
  if (context.evidence?.rejectionReason) {
    parts.push(`guard=${context.evidence.rejectionReason}`);
  }
  if (context.evidence?.plannedSettlement) {
    parts.push(`planned=${context.evidence.plannedSettlement}`);
  }
  return parts.length > 0
    ? `只作为复盘上下文，不拥有指标；${parts.join('；')}`
    : `只作为复盘上下文，不拥有指标；${fallback || '-'}`;
}

function reviewTaskKeyForScenarioItem(item, index) {
  const rawRange = item?.rawRange || {};
  const trackRange = item?.trackPointRange || item?.matchedTrackPointRange || {};
  return [
    'scenario',
    item?.scenario || 'unknown',
    rawRange.startRawPointId ?? 'raw',
    rawRange.endRawPointId ?? 'raw',
    trackRange.startTrackPointId ?? 'track',
    trackRange.endTrackPointId ?? 'track',
    item?.scenarioId ?? index
  ].join(':');
}

function reviewTaskKeyForConflict(item, index) {
  const rawRange = item?.rawRange || {};
  return [
    'conflict',
    item?.conflict || item?.resolution || 'local',
    rawRange.startRawPointId ?? 'raw',
    rawRange.endRawPointId ?? 'raw',
    (item?.candidateIds || []).join(',') || index
  ].join(':');
}

function reviewTaskKeyForDiagnosticContext(context, index) {
  const rawRange = context?.rawRange || {};
  return [
    'diagnostic-context',
    context?.scenario || 'unknown',
    rawRange.startRawPointId ?? 'raw',
    rawRange.endRawPointId ?? 'raw',
    context?.id || index
  ].join(':');
}

function reviewTaskForScenario(scenario) {
  const tasks = {
    stationary_session_collapse: {
      key: 'stationary',
      title: '整段基本没动',
      note: '线会压成代表位置，检查是否压在原始点云中心',
      rank: 10
    },
    stationary_drift_collapse: {
      key: 'dwell_drift',
      title: '原地漂移',
      note: '线会压回停留点附近，检查是否没有沿漂移绕路',
      rank: 11
    },
    enclosed_loop_cluster_settlement: {
      key: 'occlusion_loop',
      title: '遮挡绕线压缩',
      note: '线会压成锚点或短连接，检查入口/出口是否接对',
      rank: 21
    },
    enclosed_gap_cluster: {
      key: 'occlusion_loop',
      title: '遮挡绕线压缩',
      note: '线会压成锚点或短连接，检查入口/出口是否接对',
      rank: 21
    },
    position_snap_recovery: {
      key: 'snap_recovery',
      title: '定位跳远后接回',
      note: '线会跳过远点并从恢复点接回，检查接回位置',
      rank: 30
    },
    moving_spike_cleanup: {
      key: 'moving_spike',
      title: '单点跳远',
      note: '线会删除尖刺并用前后点短接，检查是否顺路',
      rank: 31
    },
    weak_recovery_endpoint: {
      key: 'weak_endpoint',
      title: '弱信号恢复点',
      note: '线会保留恢复端点，检查是否从稳定位置接回',
      rank: 32
    },
    same_road_round_trip: {
      key: 'same_road_round_trip',
      title: '同路来回',
      note: '线会收成中心线，检查是否仍贴着真实道路',
      rank: 40
    },
    round_trip_line: {
      key: 'round_trip_line',
      title: '来回路线太密',
      note: '线会简化重复折返，检查是否保留真实转折',
      rank: 41
    },
    composite_gap_local_settlement: {
      key: 'composite_gap',
      title: '长 GAP 复合段',
      note: '没有跨整段做往返改线，检查局部接线是否更像真实路线',
      rank: 43
    },
    closed_loop_round_trip: {
      key: 'closed_loop',
      title: '闭合来回标记',
      note: '线主要保留为标记，检查它是否解释了闭合绕行',
      rank: 42
    },
    rest_photo_micro_move: {
      key: 'rest_photo',
      title: '休息/拍照小移动',
      note: '线会标注或压缩小移动，检查是否不该算作行进',
      rank: 50
    },
    gap_recovery_boundary: {
      key: 'gap_boundary',
      title: '中断后恢复',
      note: '线会在中断边界重新接，检查是否被拉成长直线',
      rank: 60
    },
    transport_contamination: {
      key: 'transport',
      title: '疑似交通混入',
      note: '线会排除非徒步移动，检查是否确实不该算徒步',
      rank: 70
    }
  };
  return tasks[scenario] || {
    key: scenario || 'other',
    title: scenarioNameLabel(scenario),
    note: '查看这段原始线被处理成什么清洗线',
    rank: 90
  };
}

function scenarioCoverageHasConflict(item, dataset = null) {
  const rawRange = item?.rawRange;
  if (!dataset || !Number.isFinite(rawRange?.startRawPointId)
      || !Number.isFinite(rawRange?.endRawPointId)) {
    return false;
  }
  return [
    ...(dataset.targetOutput?.forwardSpineConflicts || [])
  ].some((conflict) => rawRangesOverlap(conflict.rawRange, rawRange));
}

function isBoundaryOrRiskScenario(scenario) {
  return scenario === 'transport_contamination'
    || scenario === 'gap_recovery_boundary'
    || scenario === 'position_snap_recovery'
    || scenario === 'moving_spike_cleanup'
    || scenario === 'composite_gap_local_settlement';
}

function rawRangesOverlap(left, right) {
  return Number.isFinite(left?.startRawPointId)
    && Number.isFinite(left?.endRawPointId)
    && Number.isFinite(right?.startRawPointId)
    && Number.isFinite(right?.endRawPointId)
    && left.startRawPointId <= right.endRawPointId
    && right.startRawPointId <= left.endRawPointId;
}
