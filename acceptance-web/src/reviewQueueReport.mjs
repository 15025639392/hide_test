const REPORT_SCHEMA_VERSION = 'review-queue-alignment-report-v1';
const ALL_METRIC_GATES = Object.freeze(['route', 'distance', 'moving_time', 'elevation']);

export function buildReviewQueueMarkdownReport(payload, options = {}) {
  const model = buildReviewQueueReportModel(payload, options);
  const lines = [
    '# Review Queue Alignment Report',
    '',
    `- reportSchemaVersion: \`${REPORT_SCHEMA_VERSION}\``,
    `- sourceSchemaVersion: \`${model.sourceSchemaVersion}\``,
    `- generatedAt: \`${model.generatedAt}\``,
    ''
  ];

  lines.push('## 数据集摘要', '');
  lines.push(markdownTable(
    ['fileName', 'filter', 'taskCount', 'highRisk', 'metricOwner', 'diagnosticContext'],
    model.datasets.map((dataset) => [
      dataset.fileName,
      dataset.filter,
      dataset.taskCount,
      dataset.highRisk,
      dataset.metricOwner,
      dataset.diagnosticContext
    ])
  ));

  lines.push('', '## 必须对齐的指标任务', '');
  lines.push(markdownTable(
    [
      'dataset',
      'reviewKey',
      'scenario',
      'rawRange',
      'trackRange',
      'highRisk',
      'expected owner/gate',
      'action / localRebuild'
    ],
    model.metricTasks.map((task) => [
      task.datasetFileName,
      task.reviewKey,
      task.scenario,
      formatRange(task.rawRange),
      formatRange(task.trackRange, 'track'),
      task.highRisk ? 'yes' : 'no',
      expectedOwnership(task),
      formatAction(task)
    ])
  ));

  lines.push('', '## 必须保持诊断态的任务', '');
  lines.push(markdownTable(
    [
      'dataset',
      'reviewKey',
      'scenario',
      'rawRange',
      'anchorRawPointIds',
      'key evidence',
      'metricOwner'
    ],
    model.diagnosticTasks.map((task) => [
      task.datasetFileName,
      task.reviewKey,
      task.scenario,
      formatRange(task.rawRange),
      formatList(task.anchorRawPointIds),
      formatDiagnosticEvidence(task.evidence),
      task.metricOwner === false ? 'false' : String(task.metricOwner)
    ])
  ));

  lines.push('', '## 高风险/冲突任务', '');
  lines.push(markdownTable(
    ['dataset', 'reviewKey', 'type', 'scenario', 'rawRange', 'reason'],
    model.highRiskTasks.map((task) => [
      task.datasetFileName,
      task.reviewKey,
      task.type,
      task.scenario,
      formatRange(task.rawRange),
      task.type === 'conflict' ? 'candidate conflict' : expectedOwnership(task)
    ])
  ));

  lines.push('', '## 自动发现风险', '');
  if (model.issues.length === 0) {
    lines.push('- 未发现 review queue 包内契约违规。');
  } else {
    lines.push(markdownTable(
      ['severity', 'dataset', 'reviewKey', 'rawRange', '问题', '建议动作'],
      model.issues.map((issue) => [
        issue.severity,
        issue.datasetFileName,
        issue.reviewKey,
        issue.rawRange,
        issue.message,
        issue.action
      ])
    ));
  }

  lines.push('', '## AI 审查清单', '');
  lines.push(
    '- P0：确认 review queue 顶层 streamingSettlementState 存在，且只使用 sampleId / sampleRange。',
    '- P0：确认目标平台没有跨 hard boundary 累计 route、distance、moving_time 或 elevation。',
    '- P0：确认 metricOwner=true 的 rawRange 与目标平台 ownership/hard boundary 一致，且同一 affectedMetricGate 不重叠。',
    '- P1：确认 type=diagnostic_context 始终 metricOwner=false，affectedMetricGates 为空。',
    '- P1：确认 diagnostic_context 可重叠存在，但不会阻塞安全封段或提交 cursor。',
    '- P1：确认 weak/reject/intake_rejected 原始诊断证据没有被目标平台丢失。',
    '- P2：确认中文标签、摘要和非关键 evidence 展示一致；此类差异不应触发策略阈值修改。'
  );

  if (model.batchErrors.length > 0) {
    lines.push('', '## 导出错误', '');
    lines.push(markdownTable(
      ['filePath', 'message'],
      model.batchErrors.map((error) => [error.filePath, error.message])
    ));
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function buildReviewQueueReportModel(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('review queue payload must be an object');
  }
  const generatedAt = options.generatedAt || new Date().toISOString();
  const exports = normalizeReviewQueueExports(payload);
  const datasets = exports.map((item, index) => datasetSummary(item, index));
  const tasks = exports.flatMap((item, index) =>
    (item.tasks || []).map((task) => ({
      ...task,
      datasetFileName: datasetName(item, index),
      datasetIndex: index
    })));
  const metricTasks = tasks.filter((task) =>
    task.metricOwner === true && task.type !== 'diagnostic_context');
  const diagnosticTasks = tasks.filter((task) => task.type === 'diagnostic_context');
  const highRiskTasks = tasks.filter((task) => task.highRisk || task.type === 'conflict');
  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    sourceSchemaVersion: payload.schemaVersion || 'unknown',
    generatedAt,
    datasets,
    metricTasks,
    diagnosticTasks,
    highRiskTasks,
    issues: detectReviewQueueContractIssues(exports).sort(compareIssueSeverity),
    batchErrors: Array.isArray(payload.errors) ? payload.errors : []
  };
}

function normalizeReviewQueueExports(payload) {
  if (payload.schemaVersion === 'review-queue-v1') return [payload];
  if (payload.schemaVersion === 'review-queue-batch-v1') {
    return Array.isArray(payload.exports) ? payload.exports : [];
  }
  throw new Error(`unsupported review queue schemaVersion: ${payload.schemaVersion || 'unknown'}`);
}

function datasetSummary(item, index) {
  return {
    fileName: datasetName(item, index),
    filter: item.filter || '-',
    taskCount: item.taskCount ?? (item.tasks || []).length,
    highRisk: item.stats?.highRisk ?? countTasks(item, (task) => task.highRisk),
    metricOwner: item.stats?.metricOwner ?? countTasks(item, (task) => task.metricOwner === true),
    diagnosticContext:
      item.stats?.diagnosticContext
      ?? countTasks(item, (task) => task.type === 'diagnostic_context')
  };
}

function countTasks(item, predicate) {
  return (item.tasks || []).filter(predicate).length;
}

function datasetName(item, index) {
  return item.dataset?.fileName || item.dataset?.filePath || `dataset-${index + 1}`;
}

function detectReviewQueueContractIssues(exports) {
  const issues = [];
  for (const [datasetIndex, item] of exports.entries()) {
    const datasetFileName = datasetName(item, datasetIndex);
    issues.push(...detectStreamingSettlementStateIssues(item, datasetFileName));
    const tasks = item.tasks || [];
    tasks.forEach((task) => {
      if (task.type === 'diagnostic_context' && task.metricOwner !== false) {
        issues.push({
          severity: 'P1',
          datasetFileName,
          reviewKey: task.reviewKey || '-',
          rawRange: formatRange(task.rawRange),
          message: 'diagnostic_context 不能拥有指标',
          action: '修正导出或端侧映射，保持 metricOwner=false'
        });
      }
      if (task.type === 'diagnostic_context'
          && Array.isArray(task.affectedMetricGates)
          && task.affectedMetricGates.length > 0) {
        issues.push({
          severity: 'P1',
          datasetFileName,
          reviewKey: task.reviewKey || '-',
          rawRange: formatRange(task.rawRange),
          message: 'diagnostic_context 的 affectedMetricGates 必须为空',
          action: '移除诊断上下文的指标 gate ownership'
        });
      }
      if (task.type === 'diagnostic_context' && task.highRisk === true) {
        issues.push({
          severity: 'P1',
          datasetFileName,
          reviewKey: task.reviewKey || '-',
          rawRange: formatRange(task.rawRange),
          message: 'diagnostic_context 不应进入 highRisk metric 审核队列',
          action: '保持诊断上下文为复盘任务，不参与指标风险排序'
        });
      }
    });

    const metricTasks = tasks.filter((task) =>
      task.metricOwner === true && task.type !== 'diagnostic_context');
    for (let leftIndex = 0; leftIndex < metricTasks.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < metricTasks.length; rightIndex++) {
        const left = metricTasks[leftIndex];
        const right = metricTasks[rightIndex];
        if (!rawRangesOverlap(left.rawRange, right.rawRange)) continue;
        const overlappingGates = overlappingMetricGates(left, right);
        if (overlappingGates.length === 0) continue;
        issues.push({
          severity: 'P0',
          datasetFileName,
          reviewKey: `${left.reviewKey || '-'} / ${right.reviewKey || '-'}`,
          rawRange: `${formatRange(left.rawRange)} overlaps ${formatRange(right.rawRange)}`,
          message: `metric owner rawRange 在同一 gate 重叠: ${overlappingGates.join(',')}`,
          action: '先做窗口仲裁，只保留一个同 gate 指标 ownership 或切分边界'
        });
      }
    }
  }
  return issues;
}

function detectStreamingSettlementStateIssues(item, datasetFileName) {
  const issues = [];
  const state = item?.streamingSettlementState;
  if (!state || typeof state !== 'object') {
    return [{
      severity: 'P0',
      datasetFileName,
      reviewKey: '-',
      rawRange: '-',
      message: 'review-queue-v1 缺少 streamingSettlementState',
      action: '重新导出 review queue，确保携带平台中立安全封段状态'
    }];
  }

  if (state.schemaVersion !== 'track-sdk-streaming-settlement-state-v1') {
    issues.push(streamingStateIssue(datasetFileName,
      'streamingSettlementState schemaVersion 不正确',
      '使用 track-sdk-streaming-settlement-state-v1 导出安全封段状态'));
  }

  for (const field of [
    'committedCursorRawPointId',
    'lastCommitWatermarkRawPointId',
    'rawRange',
    'range'
  ]) {
    if (Object.prototype.hasOwnProperty.call(state, field)) {
      issues.push(streamingStateIssue(datasetFileName,
        `streamingSettlementState 泄露内部字段 ${field}`,
        '公共 review queue 只能使用 sampleId / sampleRange 字段'));
    }
  }

  if (!nullableFiniteNumber(state.committedCursorSampleId)) {
    issues.push(streamingStateIssue(datasetFileName,
      'committedCursorSampleId 必须是 number 或 null',
      '用 sampleId 表达已安全提交 cursor，不要使用 rawPointId'));
  }
  if (!Number.isInteger(state.commitSequence) || state.commitSequence < 0) {
    issues.push(streamingStateIssue(datasetFileName,
      'commitSequence 必须是非负整数',
      '保持 streaming settlement state 可幂等恢复'));
  }
  if (!['none', 'committable', 'blocked_at_watermark']
    .includes(state.lastCommitPlanStatus)) {
    issues.push(streamingStateIssue(datasetFileName,
      'lastCommitPlanStatus 不在允许集合内',
      '只允许 none / committable / blocked_at_watermark'));
  }
  if (!nullableFiniteNumber(state.lastCommitWatermark)) {
    issues.push(streamingStateIssue(datasetFileName,
      'lastCommitWatermark 必须是 number 或 null',
      '保留最近一次安全封段水位，供 AI 和端侧对齐'));
  }

  for (const field of [
    'committedRanges',
    'committedMetricOwnershipRanges',
    'hardBoundaryCheckpoints',
    'blockingRanges'
  ]) {
    if (!Array.isArray(state[field])) {
      issues.push(streamingStateIssue(datasetFileName,
        `streamingSettlementState.${field} 必须是数组`,
        '按 streaming settlement state schema 重新导出'));
    }
  }

  for (const [index, range] of (state.committedRanges || []).entries()) {
    issues.push(...detectPublicSampleRangeIssues({
      datasetFileName,
      owner: `committedRanges[${index}]`,
      item: range,
      requireAffectedMetricGates: true,
      requireCommitSequence: true
    }));
  }
  for (const [index, range] of (state.committedMetricOwnershipRanges || []).entries()) {
    issues.push(...detectPublicSampleRangeIssues({
      datasetFileName,
      owner: `committedMetricOwnershipRanges[${index}]`,
      item: range,
      requireAffectedMetricGates: true,
      requireCommitSequence: true
    }));
    if (!range?.ownerId) {
      issues.push(streamingStateIssue(datasetFileName,
        `committedMetricOwnershipRanges[${index}] 缺少 ownerId`,
        '每个已提交 metric ownership 必须能追溯 owner'));
    }
  }
  for (const [index, range] of (state.hardBoundaryCheckpoints || []).entries()) {
    issues.push(...detectPublicSampleRangeIssues({
      datasetFileName,
      owner: `hardBoundaryCheckpoints[${index}]`,
      item: range,
      requireAffectedMetricGates: true,
      requireCommitSequence: true
    }));
  }
  for (const [index, range] of (state.blockingRanges || []).entries()) {
    issues.push(...detectPublicSampleRangeIssues({
      datasetFileName,
      owner: `blockingRanges[${index}]`,
      item: range,
      requireAffectedMetricGates: true,
      requireNonEmptyAffectedMetricGates: true
    }));
    if (!range?.id) {
      issues.push(streamingStateIssue(datasetFileName,
        `blockingRanges[${index}] 缺少 id`,
        '每个 blocker 必须能定位 open window 或 unresolved conflict'));
    }
  }
  return issues;
}

function detectPublicSampleRangeIssues({
  datasetFileName,
  owner,
  item,
  requireAffectedMetricGates = false,
  requireNonEmptyAffectedMetricGates = false,
  requireCommitSequence = false
}) {
  const issues = [];
  if (!item || typeof item !== 'object') {
    return [streamingStateIssue(datasetFileName,
      `${owner} 必须是对象`,
      '按 streaming settlement state schema 重新导出')];
  }
  for (const field of ['range', 'rawRange']) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      issues.push(streamingStateIssue(datasetFileName,
        `${owner} 泄露内部字段 ${field}`,
        '公共 review queue 的 streamingSettlementState 只能使用 sampleRange'));
    }
  }
  if (!validSampleRange(item.sampleRange)) {
    issues.push(streamingStateIssue(datasetFileName,
      `${owner} 缺少有效 sampleRange`,
      '用 startSampleId / endSampleId 表达平台中立范围'));
  }
  if (requireAffectedMetricGates && !Array.isArray(item.affectedMetricGates)) {
    issues.push(streamingStateIssue(datasetFileName,
      `${owner} 缺少 affectedMetricGates[]`,
      '显式写出该状态项影响的指标门'));
  }
  if (Array.isArray(item.affectedMetricGates)) {
    const invalidGates = item.affectedMetricGates
      .filter((gate) => !ALL_METRIC_GATES.includes(String(gate)));
    if (invalidGates.length > 0) {
      issues.push(streamingStateIssue(datasetFileName,
        `${owner} 包含未知 affectedMetricGates: ${invalidGates.join(',')}`,
        '只允许 route / distance / moving_time / elevation'));
    }
    if (requireNonEmptyAffectedMetricGates && item.affectedMetricGates.length === 0) {
      issues.push(streamingStateIssue(datasetFileName,
        `${owner} 的 affectedMetricGates 不能为空`,
        'blockingRanges 必须显式说明阻塞了哪些指标门'));
    }
  }
  if (requireCommitSequence
      && (!Number.isInteger(item.commitSequence) || item.commitSequence < 1)) {
    issues.push(streamingStateIssue(datasetFileName,
      `${owner} 缺少有效 commitSequence`,
      '已提交状态项必须记录提交序号，保证恢复幂等'));
  }
  return issues;
}

function streamingStateIssue(datasetFileName, message, action) {
  return {
    severity: 'P0',
    datasetFileName,
    reviewKey: 'streamingSettlementState',
    rawRange: '-',
    message,
    action
  };
}

function compareIssueSeverity(left, right) {
  const ranks = { P0: 0, P1: 1, P2: 2 };
  return (ranks[left.severity] ?? 99) - (ranks[right.severity] ?? 99)
    || left.datasetFileName.localeCompare(right.datasetFileName)
    || left.reviewKey.localeCompare(right.reviewKey);
}

function nullableFiniteNumber(value) {
  return value === null || Number.isFinite(value);
}

function validSampleRange(range) {
  return Number.isInteger(range?.startSampleId)
    && Number.isInteger(range?.endSampleId)
    && range.startSampleId >= 1
    && range.endSampleId >= range.startSampleId;
}

function rawRangesOverlap(left, right) {
  return Number.isFinite(left?.startRawPointId)
    && Number.isFinite(left?.endRawPointId)
    && Number.isFinite(right?.startRawPointId)
    && Number.isFinite(right?.endRawPointId)
    && left.startRawPointId <= right.endRawPointId
    && right.startRawPointId <= left.endRawPointId;
}

function overlappingMetricGates(left, right) {
  const rightGates = metricGateSet(right);
  return [...metricGateSet(left)].filter((gate) => rightGates.has(gate));
}

function metricGateSet(task) {
  const gates = Array.isArray(task?.affectedMetricGates)
    ? task.affectedMetricGates
      .map((gate) => String(gate))
      .filter((gate) => ALL_METRIC_GATES.includes(gate))
    : [];
  return new Set(gates.length > 0 ? gates : ALL_METRIC_GATES);
}

function expectedOwnership(task) {
  if (task.type === 'conflict') return 'candidate_conflict(manual)';
  const gates = Array.isArray(task.affectedMetricGates)
    ? task.affectedMetricGates.filter(Boolean)
    : [];
  if (gates.length > 0) return `owns ${gates.join(',')}`;
  if (task.scenario === 'gap_recovery_boundary') {
    return 'hard_boundary(distance,moving_time,elevation)';
  }
  if (task.scenario === 'transport_contamination') {
    return 'exclude(distance,moving_time,elevation)';
  }
  if (task.metricOwner === true) return 'metric_owner';
  return 'none';
}

function formatAction(task) {
  return [task.action, task.localRebuild].filter(Boolean).join(' / ') || '-';
}

function formatRange(range, prefix = 'raw') {
  if (!range || typeof range !== 'object') return '-';
  const startKey = prefix === 'track' ? 'startTrackPointId' : 'startRawPointId';
  const endKey = prefix === 'track' ? 'endTrackPointId' : 'endRawPointId';
  const start = range[startKey];
  const end = range[endKey];
  if (Number.isFinite(start) && Number.isFinite(end)) return `${start}-${end}`;
  if (Number.isFinite(start)) return String(start);
  return '-';
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(',') : '-';
}

function formatDiagnosticEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return '-';
  const keys = [
    'intent',
    'rejectionReason',
    'gapClusterIntentSupported',
    'plannedSettlement',
    'reason'
  ];
  const parts = keys
    .filter((key) => evidence[key] !== undefined)
    .map((key) => `${key}=${formatEvidenceValue(evidence[key])}`);
  return parts.length > 0 ? parts.join('; ') : '-';
}

function formatEvidenceValue(value) {
  if (Array.isArray(value)) return value.join(',');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function markdownTable(headers, rows) {
  if (!rows || rows.length === 0) return '_无_';
  const headerLine = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) =>
    `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`);
  return [headerLine, separatorLine, ...rowLines].join('\n');
}

function escapeMarkdownTableCell(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}
