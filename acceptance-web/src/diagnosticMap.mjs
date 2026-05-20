const TRUSTED_RESULTS = new Set(['anchor', 'accept']);
const WEAK_RESULTS = new Set(['weak']);
const REJECT_RESULTS = new Set(['reject']);
const LOW_USED_AVG_CN0_DBHZ = 25;
const LOW_USED_IN_FIX_TOTAL = 5;
const STALE_RAW_RATIO_REVIEW = 0.2;
const DECISION_REASON_EXPLANATIONS = {
  first_fix_good: {
    title: '首点质量好',
    meaning: '第一颗可信定位点精度达到首点好点阈值，可作为轨迹起始 anchor。',
    evidence: '重点看 accuracy、provider 是否为 gps、是否有新鲜 GNSS snapshot。'
  },
  first_fix_relaxed: {
    title: '首点放宽接受',
    meaning: '第一颗定位点未达到最优首点阈值，但仍在放宽阈值内，可作为起始 anchor。',
    evidence: '重点看 accuracy 是否处于放宽区间，以及后续点是否稳定延续。'
  },
  forced_weak_first_fix: {
    title: '强制弱首点 anchor',
    meaning: '测试或特殊模式下，弱精度首点被强制作为 anchor，方便验证后续链路。',
    evidence: '重点确认 forcedWeakFirstFixEnabled、accuracy 和 strategyVersion。'
  },
  weak_first_fix: {
    title: '首点偏弱',
    meaning: '第一颗定位点精度不足以作为可信起点，但仍保留为 weak 诊断证据。',
    evidence: '重点看 accuracy、usedInFixTotal、usedAvgCn0、top4AvgCn0 和 snapshot 是否过期。'
  },
  first_fix_accuracy_too_large: {
    title: '首点精度过差',
    meaning: '第一颗定位点精度超过首点可接受范围，不能作为可信轨迹起点。',
    evidence: '重点看 accuracy 是否明显过大，以及是否伴随低 C/N0 或少 used 卫星。'
  },
  moving_good_fix: {
    title: '移动好点',
    meaning: '该点通过移动距离、时间和精度检查，进入可信轨迹并累计距离/运动时间。',
    evidence: '重点看 accuracy、距上一可信点距离、时间间隔、推算速度和距离增量。'
  },
  weak_signal_stage1: {
    title: '移动中弱信号',
    meaning: '移动过程中精度超过普通好点阈值，因此保留为 weak 诊断点，不累计可信距离。',
    evidence: '重点看 accuracy、usedAvgCn0、top4AvgCn0、usedInFixTotal、weakUsedCount 和 stale 状态。'
  },
  gap_recovery: {
    title: '长 GAP 后恢复',
    meaning: '距上一可信点间隔过长，恢复点开启或延续 segment，但当前恢复 delta 不回填距离。',
    evidence: '重点看间隔秒数、no_location_timeout、sampling_policy、GAP 前后 GNSS snapshot。'
  },
  impossible_speed: {
    title: '不可能速度跳点',
    meaning: '从上一可信点推算速度超过徒步策略允许范围，通常是跳点或漂移。',
    evidence: '重点看直线距离、时间差、推算速度、accuracy 和该点 GNSS 质量。'
  },
  transport_suspected: {
    title: '疑似交通工具',
    meaning: '速度和位移更像交通工具移动，当前点不进入徒步可信距离。',
    evidence: '重点看推算速度、系统 reported speed、持续时间，以及 GNSS 质量是否并不差。'
  },
  transport_confirmed: {
    title: '交通工具确认中',
    meaning: '策略仍处于交通工具移动段，继续阻止这些点污染徒步距离。',
    evidence: '重点看连续速度、距离变化、decision state 和 transport 恢复条件。'
  },
  transport_recovery: {
    title: '交通工具后恢复徒步',
    meaning: '速度回到徒步范围，策略从交通工具段恢复，并从新 segment 继续记录。',
    evidence: '重点看恢复前后速度、稳定时长、startsNewSegment 和 GNSS 质量。'
  },
  stationary_keepalive: {
    title: '静止保活点',
    meaning: '点位接近上一可信点，被认为是静止保活，不累计距离。',
    evidence: '重点看距休息 anchor 的距离、accuracy、motion_summary 和 keepalive 间隔。'
  },
  stationary_jitter: {
    title: '静止漂移',
    meaning: '点位变化小且落在静止漂移范围内，被拒绝以避免累计虚假距离。',
    evidence: '重点看距离是否小于静止阈值、accuracy 倍数、motion_summary 和 C/N0。'
  },
  stationary_anchor_refined: {
    title: '静止锚点优化',
    meaning: '静止或休息中出现更好的定位点，替换原 anchor 但不新增距离。',
    evidence: '重点看新旧 anchor accuracy、GNSS 质量和附近 motion_summary stillScore。'
  },
  stationary_accel_supported_jitter: {
    title: '加速度支持的静止漂移',
    meaning: '传感器显示设备接近静止，附近 GPS 小位移被视为漂移并拒绝。',
    evidence: '重点看 motion_summary 的 isDeviceStill、stillScore、dynamicAccelRmsMps2 和点位距离。'
  },
  rest_candidate: {
    title: '休息候选',
    meaning: 'REST 状态机正在收集休息证据，该点暂不累计距离。',
    evidence: '重点看连续低移动、motion_summary、与 rest anchor 的距离和时间窗口。'
  },
  rest_paused_keepalive: {
    title: '休息暂停保活',
    meaning: '已进入 REST_PAUSED，附近 GPS 保活点不累计距离，只作为诊断或锚点优化证据。',
    evidence: '重点看点到 rest anchor 距离、accuracy、motion_summary 和保活间隔。'
  },
  rest_probing_stationary: {
    title: '休息探测仍静止',
    meaning: 'REST_PROBING 检查后仍判断为静止，返回休息暂停状态。',
    evidence: '重点看 probing 点位移、motion_summary still 状态和连续确认次数。'
  },
  stationary_motion_blocked_recovery: {
    title: '静止证据阻止恢复移动',
    meaning: 'GPS 看似移动，但近期 motion_summary 显示设备仍静止，因此阻止恢复为可信移动。',
    evidence: '重点看 GPS 位移、推算速度、recent motion_summary stillScore 和动态加速度。'
  },
  rest_probing_confirming_moving: {
    title: '休息后确认移动中',
    meaning: 'REST_PROBING 正在等待连续移动证据；探测点不回填距离。',
    evidence: '重点看连续 probing 点、位移方向、速度和 motion_summary 是否不再静止。'
  },
  rest_moving_recovery: {
    title: '休息后恢复移动',
    meaning: '连续证据确认离开休息状态，写入新 segment anchor，当前点通常不回填距离。',
    evidence: '重点看 startsNewSegment、连续移动点、motion_summary 和恢复点 distanceDelta。'
  },
  non_positive_delta_time: {
    title: '时间未前进',
    meaning: '该点与上一可信点相比 elapsedRealtime 没有前进，无法计算有效速度和距离。',
    evidence: '重点看 elapsedRealtimeNanos 是否乱序、重复或缺失。'
  },
  provider_not_gps: {
    title: '非 GPS Provider',
    meaning: '可信轨迹只允许 LocationManager.GPS_PROVIDER，其他 provider 必须拒绝。',
    evidence: '重点看 raw_location.provider，不能用 network/fused 点进入可信轨迹。'
  },
  missing_elapsed_realtime: {
    title: '缺少 elapsedRealtime',
    meaning: '缺少连续时间基准，无法可靠计算点序、速度、GAP 和回放一致性。',
    evidence: '重点看 hasElapsedRealtimeNanos 和 elapsedRealtimeNanos 字段。'
  },
  before_record_start: {
    title: '早于记录开始',
    meaning: 'Location 时间早于本次记录起点，不应进入当前 session 的可信轨迹。',
    evidence: '重点看 createdElapsedRealtimeNanos 与 raw elapsedRealtimeNanos 的关系。'
  },
  location_too_old: {
    title: '系统回调位置过旧',
    meaning: 'Location 年龄超过策略允许范围，可能是系统缓存点，不适合作为当前轨迹证据。',
    evidence: '重点看 eventElapsedRealtimeNanos、elapsedRealtimeNanos 和 maxLocationAgeNanos。'
  }
};

export function isDiagnosticJsonlPath(path) {
  return /(^|\/)diagnostic\.jsonl$/i.test(String(path || ''));
}

export function parseDiagnosticJsonl(text, filePath = 'diagnostic.jsonl') {
  const events = [];
  const parseErrors = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const event = JSON.parse(trimmed);
      events.push({ ...event, lineNumber: index + 1 });
    } catch (error) {
      parseErrors.push({
        lineNumber: index + 1,
        message: error.message,
        text: trimmed.slice(0, 160)
      });
    }
  });

  return buildDiagnosticModel(events, parseErrors, filePath);
}

export function explainDecisionReason(result, reason) {
  const key = String(reason || '');
  const explanation = DECISION_REASON_EXPLANATIONS[key];
  if (explanation) {
    return { result: String(result || ''), reason: key, ...explanation };
  }
  return {
    result: String(result || ''),
    reason: key,
    title: key || '未记录原因',
    meaning: '当前页面还没有这个 decision reason 的专门中文解释，请结合 result、上下文和原始字段复核。',
    evidence: '重点看 raw_location、decision、GNSS snapshot、时间间隔、速度和 session_event。'
  };
}

function buildDiagnosticModel(events, parseErrors, filePath) {
  const metadata = events.find((event) => event.event === 'session_metadata') || {};
  const rawById = new Map();
  const decisions = [];
  const gnssById = new Map();
  const pressureSamples = [];
  const motionSummaries = [];
  const sessionEvents = [];
  const samplingPolicies = [];

  for (const event of events) {
    if (event.event === 'raw_location' && isFiniteNumber(event.lat) && isFiniteNumber(event.lng)) {
      rawById.set(Number(event.rawPointId), normalizeRawPoint(event));
    } else if (event.event === 'decision') {
      decisions.push(event);
    } else if (event.event === 'gnss_snapshot') {
      gnssById.set(Number(event.snapshotId), event);
    } else if (event.event === 'pressure_sample') {
      pressureSamples.push(event);
    } else if (event.event === 'motion_summary') {
      motionSummaries.push(event);
    } else if (event.event === 'session_event') {
      sessionEvents.push(event);
    } else if (event.event === 'sampling_policy') {
      samplingPolicies.push(event);
    }
  }

  const points = Array.from(rawById.values()).sort(comparePointTime);
  for (const decision of decisions) {
    const point = rawById.get(Number(decision.rawPointId));
    if (!point) {
      continue;
    }
    point.decision = normalizeDecision(decision);
    point.kind = classifyDecision(point.decision.result);
    const snapshotId = Number(decision.sourceGnssSnapshotId || point.sourceGnssSnapshotId);
    if (gnssById.has(snapshotId)) {
      point.gnss = gnssById.get(snapshotId);
    }
  }
  enrichPoints(points, motionSummaries);

  const trustedPoints = points.filter((point) => TRUSTED_RESULTS.has(point.kind));
  const rejectedPoints = points.filter((point) => point.kind === 'reject');
  const weakPoints = points.filter((point) => point.kind === 'weak');
  const undecidedPoints = points.filter((point) => point.kind === 'raw');
  const bounds = pointBounds(points);
  const segments = buildTrustedSegments(trustedPoints);
  const reasonCounts = countReasons(points);
  const evidence = buildEvidenceModel({
    points,
    decisions,
    parseErrors,
    gnssSnapshots: Array.from(gnssById.values()),
    sessionEvents,
    samplingPolicies,
    motionSummaries
  });
  const timelineItems = buildTimelineItems(points, sessionEvents, samplingPolicies);

  return {
    filePath,
    sessionId: metadata.sessionId || firstValue(events, 'sessionId') || '',
    strategyVersion: metadata.strategyVersion || '',
    deviceLabel: deviceLabel(metadata),
    events,
    parseErrors,
    points,
    trustedPoints,
    rejectedPoints,
    weakPoints,
    undecidedPoints,
    segments,
    bounds,
    reasonCounts,
    evidence,
    timelineItems,
    summary: {
      rawCount: points.length,
      decisionCount: decisions.length,
      trustedCount: trustedPoints.length,
      rejectedCount: rejectedPoints.length,
      weakCount: weakPoints.length,
      undecidedCount: undecidedPoints.length,
      linkedGnssPointCount: evidence.metrics.linkedGnssPointCount,
      staleRawCount: evidence.metrics.staleRawCount,
      gnssSnapshotCount: gnssById.size,
      pressureSampleCount: pressureSamples.length,
      motionSummaryCount: motionSummaries.length,
      sessionEventCount: sessionEvents.length,
      samplingPolicyCount: samplingPolicies.length,
      noLocationTimeoutCount: evidence.metrics.noLocationTimeoutCount,
      gapRecoveryCount: evidence.metrics.gapRecoveryCount,
      parseErrorCount: parseErrors.length,
      totalDistanceMeters: sumNumeric(decisions, 'distanceDeltaMeters'),
      movingTimeSeconds: sumNumeric(decisions, 'movingTimeDeltaSeconds'),
      durationSeconds: durationSeconds(points)
    }
  };
}

function normalizeRawPoint(event) {
  return {
    ...event,
    rawPointId: Number(event.rawPointId),
    lat: Number(event.lat),
    lng: Number(event.lng),
    accuracy: nullableNumber(event.accuracy),
    altitude: nullableNumber(event.altitude),
    verticalAccuracy: nullableNumber(event.verticalAccuracy),
    speed: nullableNumber(event.speed),
    bearing: nullableNumber(event.bearing),
    elapsedRealtimeNanos: nullableNumber(event.elapsedRealtimeNanos),
    timeMillis: nullableNumber(event.timeMillis),
    sourceGnssSnapshotId: nullableNumber(event.sourceGnssSnapshotId),
    sourceGnssSnapshotAgeNanos: nullableNumber(event.sourceGnssSnapshotAgeNanos),
    sourceGnssSnapshotMatchedFromFuture: event.sourceGnssSnapshotMatchedFromFuture === true,
    gnssQualityStale: event.gnssQualityStale === true,
    kind: 'raw'
  };
}

function normalizeDecision(event) {
  const result = String(event.result || '');
  const reason = String(event.reason || '');
  return {
    decisionId: Number(event.decisionId),
    result,
    reason,
    reasonExplanation: explainDecisionReason(result, reason),
    state: String(event.state || ''),
    segmentId: nullableNumber(event.segmentId),
    trackPointId: nullableNumber(event.trackPointId),
    distanceDeltaMeters: nullableNumber(event.distanceDeltaMeters),
    movingTimeDeltaSeconds: nullableNumber(event.movingTimeDeltaSeconds),
    sourceGnssSnapshotId: nullableNumber(event.sourceGnssSnapshotId),
    eventElapsedRealtimeNanos: nullableNumber(event.eventElapsedRealtimeNanos),
    startsNewSegment: event.startsNewSegment === true
  };
}

function classifyDecision(result) {
  if (TRUSTED_RESULTS.has(result)) {
    return result;
  }
  if (WEAK_RESULTS.has(result)) {
    return 'weak';
  }
  if (REJECT_RESULTS.has(result)) {
    return 'reject';
  }
  return 'raw';
}

function buildTrustedSegments(trustedPoints) {
  const groups = new Map();
  for (const point of trustedPoints) {
    const segmentId = point.decision?.segmentId ?? 0;
    if (!groups.has(segmentId)) {
      groups.set(segmentId, []);
    }
    groups.get(segmentId).push(point);
  }
  return Array.from(groups, ([segmentId, points]) => ({ segmentId, points }));
}

function countReasons(points) {
  const counts = new Map();
  for (const point of points) {
    const decision = point.decision;
    if (!decision) {
      continue;
    }
    const key = `${decision.result}:${decision.reason}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts, ([reasonKey, count]) => {
    const [result, reason] = splitReasonKey(reasonKey);
    return {
      reason: reasonKey,
      count,
      explanation: explainDecisionReason(result, reason)
    };
  })
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function splitReasonKey(value) {
  const text = String(value || '');
  const index = text.indexOf(':');
  if (index < 0) {
    return ['', text || '-'];
  }
  return [text.slice(0, index), text.slice(index + 1) || '-'];
}

function enrichPoints(points, motionSummaries) {
  let previousTrustedPoint = null;
  const sortedMotionSummaries = [...motionSummaries].sort(compareEventTime);
  for (const point of points) {
    point.nearestMotionSummary = nearestMotionSummary(point, sortedMotionSummaries);
    point.diagnosticContext = buildPointContext(point, previousTrustedPoint);
    point.insights = buildPointInsights(point);
    if (TRUSTED_RESULTS.has(point.kind)) {
      previousTrustedPoint = point;
    }
  }
}

function buildPointContext(point, previousTrustedPoint) {
  if (!previousTrustedPoint) {
    return {
      previousTrustedRawPointId: null,
      deltaSecondsFromPreviousTrusted: null,
      distanceFromPreviousTrustedMeters: null,
      requiredSpeedMetersPerSecond: null
    };
  }
  const deltaSeconds = elapsedSecondsBetween(previousTrustedPoint, point);
  const distanceMeters = distanceMetersBetween(previousTrustedPoint, point);
  return {
    previousTrustedRawPointId: previousTrustedPoint.rawPointId,
    deltaSecondsFromPreviousTrusted: deltaSeconds,
    distanceFromPreviousTrustedMeters: distanceMeters,
    requiredSpeedMetersPerSecond: deltaSeconds > 0 ? distanceMeters / deltaSeconds : null
  };
}

function buildPointInsights(point) {
  const insights = [];
  const decision = point.decision;
  if (!decision) {
    insights.push({
      level: 'review',
      text: '这个 raw_location 没有对应 decision，不能解释它是否进入可信轨迹。'
    });
    return insights;
  }

  if (point.gnssQualityStale) {
    insights.push({
      level: 'review',
      text: '该点关联的 GNSS snapshot 已过期，卫星质量解释存在缺口。'
    });
  }

  if (!point.gnss && (point.kind === 'weak' || point.kind === 'reject')) {
    insights.push({
      level: 'review',
      text: `${decision.result} 点缺少可关联 GNSS snapshot，只能用 Location 精度和策略 reason 解释。`
    });
  }

  if (point.gnss) {
    const usedAvgCn0 = numericField(point.gnss, 'usedAvgCn0');
    const usedInFixTotal = numericField(point.gnss, 'usedInFixTotal');
    const top4AvgCn0 = numericField(point.gnss, 'top4AvgCn0');
    if (usedAvgCn0 !== null && usedAvgCn0 > 0 && usedAvgCn0 < LOW_USED_AVG_CN0_DBHZ) {
      insights.push({
        level: 'review',
        text: `usedAvgCn0=${usedAvgCn0.toFixed(1)} dB-Hz 偏低，弱信号可能来自参与定位卫星信噪比不足。`
      });
    }
    if (usedInFixTotal !== null && usedInFixTotal > 0 && usedInFixTotal < LOW_USED_IN_FIX_TOTAL) {
      insights.push({
        level: 'review',
        text: `usedInFixTotal=${usedInFixTotal.toFixed(0)} 偏少，可能存在遮挡或星座几何不足。`
      });
    }
    if (top4AvgCn0 !== null && top4AvgCn0 > 0 && point.kind === 'weak') {
      insights.push({
        level: 'info',
        text: `weak 点关联 top4AvgCn0=${top4AvgCn0.toFixed(1)} dB-Hz，可和 accuracy 一起判断弱信号来源。`
      });
    }
  }

  if (point.kind === 'weak') {
    insights.push({
      level: 'review',
      text: `该点被标记为 weak，不进入可信距离；当前 accuracy=${formatOneDecimal(point.accuracy)}m。`
    });
  }

  if (decision.reason === 'gap_recovery') {
    const deltaSeconds = point.diagnosticContext.deltaSecondsFromPreviousTrusted;
    insights.push({
      level: 'review',
      text: `GAP 恢复点，新 segment 开始且距离增量为 ${formatOneDecimal(decision.distanceDeltaMeters)}m；需结合 no-location 和采样事件复核。`
    });
    if (deltaSeconds !== null) {
      insights.push({
        level: 'info',
        text: `距上一个可信点间隔约 ${formatOneDecimal(deltaSeconds)} 秒。`
      });
    }
  }

  if (decision.reason === 'impossible_speed' || decision.reason.startsWith('transport_')) {
    const speed = point.diagnosticContext.requiredSpeedMetersPerSecond;
    if (speed !== null) {
      insights.push({
        level: 'review',
        text: `从上一个可信点推算速度约 ${formatOneDecimal(speed)} m/s，用于区分漂移、跳点或疑似交通工具。`
      });
    }
  }

  if (decision.reason.startsWith('stationary_') || decision.reason.startsWith('rest_')) {
    const motion = point.nearestMotionSummary;
    if (motion) {
      insights.push({
        level: motion.isDeviceStill === true ? 'info' : 'review',
        text: `附近 motion_summary still=${motion.isDeviceStill === true ? 'true' : 'false'}，stillScore=${formatOneDecimal(motion.stillScore)}。`
      });
    }
  }

  if (decision.startsNewSegment) {
    insights.push({
      level: 'info',
      text: '该 decision 开启新 segment，地图上的可信线会从这里继续。'
    });
  }

  if (insights.length === 0) {
    insights.push({
      level: 'pass',
      text: '该点已有 raw_location 与 decision，可按当前策略 reason 解释。'
    });
  }
  return insights;
}

function buildEvidenceModel({
  points,
  decisions,
  parseErrors,
  gnssSnapshots,
  sessionEvents,
  samplingPolicies,
  motionSummaries
}) {
  const weakPoints = points.filter((point) => point.kind === 'weak');
  const rejectedPoints = points.filter((point) => point.kind === 'reject');
  const transportPoints = points.filter((point) => point.decision?.reason?.startsWith('transport_'));
  const gapRecoveryPoints = points.filter((point) => point.decision?.reason === 'gap_recovery');
  const staleRawCount = points.filter((point) => point.gnssQualityStale).length;
  const linkedGnssPointCount = points.filter((point) => point.gnss).length;
  const noLocationEvents = sessionEvents.filter((event) => event.eventType === 'no_location_timeout');
  const explainableGnssSnapshotCount = gnssSnapshots.filter((snapshot) => (
    numericField(snapshot, 'allAvgCn0') !== null && numericField(snapshot, 'top4AvgCn0') !== null
  )).length;
  const weakMetrics = metricTotals(weakPoints);
  const rejectMetrics = metricTotals(rejectedPoints);
  const transportMetrics = metricTotals(transportPoints);
  const maxNoLocationTimeoutSeconds = noLocationEvents.reduce((max, event) => {
    const seconds = numericField(event, 'elapsedSinceLastLocationMillis');
    return seconds === null ? max : Math.max(max, seconds / 1000);
  }, 0);
  const findings = buildFindings({
    points,
    decisions,
    parseErrors,
    weakPoints,
    rejectedPoints,
    transportPoints,
    gapRecoveryPoints,
    staleRawCount,
    noLocationEvents,
    weakMetrics,
    rejectMetrics,
    transportMetrics
  });

  return {
    metrics: {
      rawCount: points.length,
      decisionCount: decisions.length,
      linkedGnssPointCount,
      staleRawCount,
      staleRawRatio: points.length === 0 ? 0 : staleRawCount / points.length,
      gnssSnapshotCount: gnssSnapshots.length,
      explainableGnssSnapshotCount,
      weakGnssLinkedCount: weakMetrics.linkedGnssCount,
      rejectGnssLinkedCount: rejectMetrics.linkedGnssCount,
      transportGnssLinkedCount: transportMetrics.linkedGnssCount,
      gapRecoveryCount: gapRecoveryPoints.length,
      noLocationTimeoutCount: noLocationEvents.length,
      maxNoLocationTimeoutSeconds,
      samplingPolicyCount: samplingPolicies.length,
      motionSummaryCount: motionSummaries.length,
      weakMetrics,
      rejectMetrics,
      transportMetrics
    },
    findings
  };
}

function buildFindings({
  points,
  decisions,
  parseErrors,
  weakPoints,
  rejectedPoints,
  transportPoints,
  gapRecoveryPoints,
  staleRawCount,
  noLocationEvents,
  weakMetrics,
  rejectMetrics,
  transportMetrics
}) {
  const findings = [];
  if (parseErrors.length > 0) {
    findings.push({
      level: 'fail',
      title: 'JSONL 存在解析错误',
      detail: `${parseErrors.length} 行无法解析，诊断链路可能不完整。`
    });
  }
  if (points.length === 0) {
    findings.push({
      level: 'fail',
      title: '缺少 raw_location',
      detail: '没有原始定位点，无法复盘采集和判点过程。'
    });
  }
  if (decisions.length === 0) {
    findings.push({
      level: 'fail',
      title: '缺少 decision',
      detail: '没有判点结果，不能解释哪些点进入可信轨迹。'
    });
  }
  if (points.length > 0 && decisions.length > 0 && points.length !== decisions.length) {
    findings.push({
      level: 'review',
      title: 'raw 与 decision 数量不一致',
      detail: `raw_location=${points.length}，decision=${decisions.length}，需要确认是否有未决或丢失事件。`
    });
  }
  if (weakPoints.length > weakMetrics.linkedGnssCount) {
    findings.push({
      level: 'review',
      title: 'weak 点缺少卫星质量证据',
      detail: `${weakPoints.length - weakMetrics.linkedGnssCount} 个 weak decision 没有关联 GNSS snapshot。`
    });
  }
  if (rejectedPoints.length > rejectMetrics.linkedGnssCount) {
    findings.push({
      level: 'review',
      title: 'reject 点缺少卫星质量证据',
      detail: `${rejectedPoints.length - rejectMetrics.linkedGnssCount} 个 reject decision 没有关联 GNSS snapshot。`
    });
  }
  if (points.length > 0 && staleRawCount / points.length > STALE_RAW_RATIO_REVIEW) {
    findings.push({
      level: 'review',
      title: 'GNSS snapshot 过期比例偏高',
      detail: `${staleRawCount}/${points.length} 个 raw_location 使用 stale GNSS 证据。`
    });
  }
  if (weakPoints.length > 0 && weakMetrics.averageUsedAvgCn0 > 0
      && weakMetrics.averageUsedAvgCn0 < LOW_USED_AVG_CN0_DBHZ) {
    findings.push({
      level: 'review',
      title: 'weak 点伴随低 C/N0',
      detail: `weak usedAvgCn0 平均 ${formatOneDecimal(weakMetrics.averageUsedAvgCn0)} dB-Hz，弱信号可能来自信噪比不足。`
    });
  }
  if (weakPoints.length > 0 && weakMetrics.averageUsedInFixTotal > 0
      && weakMetrics.averageUsedInFixTotal < LOW_USED_IN_FIX_TOTAL) {
    findings.push({
      level: 'review',
      title: 'weak 点参与定位卫星偏少',
      detail: `weak usedInFixTotal 平均 ${formatOneDecimal(weakMetrics.averageUsedInFixTotal)}，可能存在遮挡或星座几何不足。`
    });
  }
  if (gapRecoveryPoints.length > 0 || noLocationEvents.length > 0) {
    findings.push({
      level: 'review',
      title: '存在 GAP 或无定位回调',
      detail: `gap_recovery=${gapRecoveryPoints.length}，no_location_timeout=${noLocationEvents.length}，需要结合采样和系统后台行为复核。`
    });
  }
  if (transportPoints.length > 0 && transportMetrics.averageUsedAvgCn0 >= LOW_USED_AVG_CN0_DBHZ) {
    findings.push({
      level: 'info',
      title: '交通工具段不像弱信号问题',
      detail: `transport usedAvgCn0 平均 ${formatOneDecimal(transportMetrics.averageUsedAvgCn0)} dB-Hz，更可能由速度证据触发。`
    });
  }
  if (findings.length === 0) {
    findings.push({
      level: 'pass',
      title: '诊断证据链完整',
      detail: '未发现明显 weak/reject/GAP/no-location 解释缺口。'
    });
  }
  return findings;
}

function metricTotals(points) {
  const totals = {
    decisionCount: points.length,
    linkedGnssCount: 0,
    accuracyCount: 0,
    accuracyTotal: 0,
    usedInFixTotalSum: 0,
    usedAvgCn0Sum: 0,
    top4AvgCn0Sum: 0,
    allAvgCn0Sum: 0,
    lowCn0VisibleCountSum: 0,
    weakUsedCountSum: 0
  };

  for (const point of points) {
    if (point.accuracy !== null) {
      totals.accuracyCount++;
      totals.accuracyTotal += point.accuracy;
    }
    if (!point.gnss) {
      continue;
    }
    totals.linkedGnssCount++;
    addMetric(totals, point.gnss, 'usedInFixTotal', 'usedInFixTotalSum');
    addMetric(totals, point.gnss, 'usedAvgCn0', 'usedAvgCn0Sum');
    addMetric(totals, point.gnss, 'top4AvgCn0', 'top4AvgCn0Sum');
    addMetric(totals, point.gnss, 'allAvgCn0', 'allAvgCn0Sum');
    addMetric(totals, point.gnss, 'lowCn0VisibleCount', 'lowCn0VisibleCountSum');
    addMetric(totals, point.gnss, 'weakUsedCount', 'weakUsedCountSum');
  }

  return {
    decisionCount: totals.decisionCount,
    linkedGnssCount: totals.linkedGnssCount,
    averageAccuracyMeters: average(totals.accuracyTotal, totals.accuracyCount),
    averageUsedInFixTotal: average(totals.usedInFixTotalSum, totals.linkedGnssCount),
    averageUsedAvgCn0: average(totals.usedAvgCn0Sum, totals.linkedGnssCount),
    averageTop4AvgCn0: average(totals.top4AvgCn0Sum, totals.linkedGnssCount),
    averageAllAvgCn0: average(totals.allAvgCn0Sum, totals.linkedGnssCount),
    averageLowCn0VisibleCount: average(totals.lowCn0VisibleCountSum, totals.linkedGnssCount),
    averageWeakUsedCount: average(totals.weakUsedCountSum, totals.linkedGnssCount)
  };
}

function buildTimelineItems(points, sessionEvents, samplingPolicies) {
  const items = points.map((point) => ({
    type: 'point',
    kind: point.kind,
    sortTime: point.elapsedRealtimeNanos ?? point.timeMillis ?? 0,
    point
  }));
  for (const event of sessionEvents) {
    items.push({
      type: 'event',
      kind: 'session_event',
      sortTime: eventSortTime(event),
      event,
      title: `session_event:${event.eventType || '-'}`,
      detail: event.eventType === 'no_location_timeout'
        ? `无定位回调 ${formatOneDecimal((numericField(event, 'elapsedSinceLastLocationMillis') || 0) / 1000)} 秒`
        : `状态 ${event.recordingStateBefore || '-'} -> ${event.recordingStateAfter || '-'}`
    });
  }
  for (const event of samplingPolicies) {
    items.push({
      type: 'event',
      kind: 'sampling_policy',
      sortTime: eventSortTime(event),
      event,
      title: `sampling_policy:${event.state || '-'}`,
      detail: `${event.locationRequestProvider || '-'} ${event.locationRequestMinTimeMs || '-'}ms / ${event.locationRequestMinDistanceMeters ?? '-'}m`
    });
  }
  return items.sort((a, b) => a.sortTime - b.sortTime);
}

function nearestMotionSummary(point, motionSummaries) {
  if (!Number.isFinite(point.elapsedRealtimeNanos) || motionSummaries.length === 0) {
    return null;
  }
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const summary of motionSummaries) {
    const first = numericField(summary, 'firstElapsedRealtimeNanos');
    const last = numericField(summary, 'lastElapsedRealtimeNanos');
    if (first === null || last === null) {
      continue;
    }
    const distance = point.elapsedRealtimeNanos < first
      ? first - point.elapsedRealtimeNanos
      : point.elapsedRealtimeNanos > last
        ? point.elapsedRealtimeNanos - last
        : 0;
    if (distance < bestDistance) {
      best = summary;
      bestDistance = distance;
    }
  }
  return bestDistance <= 5_000_000_000 ? best : null;
}

function pointBounds(points) {
  if (points.length === 0) {
    return null;
  }
  return points.reduce((bounds, point) => ({
    minLat: Math.min(bounds.minLat, point.lat),
    maxLat: Math.max(bounds.maxLat, point.lat),
    minLng: Math.min(bounds.minLng, point.lng),
    maxLng: Math.max(bounds.maxLng, point.lng)
  }), {
    minLat: points[0].lat,
    maxLat: points[0].lat,
    minLng: points[0].lng,
    maxLng: points[0].lng
  });
}

function addMetric(totals, object, field, totalField) {
  const value = numericField(object, field);
  if (value !== null) {
    totals[totalField] += value;
  }
}

function average(total, count) {
  return count === 0 ? 0 : total / count;
}

function numericField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) {
    return null;
  }
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function eventSortTime(event) {
  return numericField(event, 'eventElapsedRealtimeNanos')
    ?? numericField(event, 'receivedElapsedRealtimeNanos')
    ?? numericField(event, 'locationRequestRegisteredElapsedRealtimeNanos')
    ?? numericField(event, 'eventWallTimeMillis')
    ?? numericField(event, 'writtenWallTimeMillis')
    ?? 0;
}

function compareEventTime(a, b) {
  return eventSortTime(a) - eventSortTime(b);
}

function elapsedSecondsBetween(fromPoint, toPoint) {
  if (!Number.isFinite(fromPoint.elapsedRealtimeNanos)
      || !Number.isFinite(toPoint.elapsedRealtimeNanos)
      || toPoint.elapsedRealtimeNanos <= fromPoint.elapsedRealtimeNanos) {
    return null;
  }
  return (toPoint.elapsedRealtimeNanos - fromPoint.elapsedRealtimeNanos) / 1_000_000_000;
}

function distanceMetersBetween(fromPoint, toPoint) {
  return distanceMeters(fromPoint.lat, fromPoint.lng, toPoint.lat, toPoint.lng);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6_371_000;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
    + Math.cos(lat1Rad) * Math.cos(lat2Rad)
    * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function formatOneDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

export function projectPoint(point, bounds, width, height, padding = 32) {
  if (!bounds) {
    return { x: width / 2, y: height / 2 };
  }
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.00001);
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.00001);
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  return {
    x: padding + ((point.lng - bounds.minLng) / lngSpan) * usableWidth,
    y: padding + ((bounds.maxLat - point.lat) / latSpan) * usableHeight
  };
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-';
  }
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function comparePointTime(a, b) {
  return (a.elapsedRealtimeNanos ?? a.timeMillis ?? 0) - (b.elapsedRealtimeNanos ?? b.timeMillis ?? 0);
}

function durationSeconds(points) {
  if (points.length < 2) {
    return 0;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (Number.isFinite(first.elapsedRealtimeNanos) && Number.isFinite(last.elapsedRealtimeNanos)) {
    return (last.elapsedRealtimeNanos - first.elapsedRealtimeNanos) / 1_000_000_000;
  }
  if (Number.isFinite(first.timeMillis) && Number.isFinite(last.timeMillis)) {
    return (last.timeMillis - first.timeMillis) / 1000;
  }
  return 0;
}

function sumNumeric(events, field) {
  return events.reduce((sum, event) => {
    const value = Number(event[field]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function firstValue(events, field) {
  const event = events.find((item) => item[field]);
  return event ? event[field] : '';
}

function deviceLabel(metadata) {
  const parts = [
    metadata.deviceBrand || metadata.deviceManufacturer,
    metadata.deviceModel,
    metadata.deviceName
  ].filter(Boolean);
  return parts.join(' / ');
}
