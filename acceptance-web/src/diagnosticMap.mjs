const TRUSTED_RESULTS = new Set(['anchor', 'accept']);
const WEAK_RESULTS = new Set(['weak']);
const REJECT_RESULTS = new Set(['reject']);
const LOW_USED_AVG_CN0_DBHZ = 25;
const LOW_USED_IN_FIX_TOTAL = 5;
const STALE_RAW_RATIO_REVIEW = 0.2;
const CALLBACK_DELAY_REVIEW_NANOS = 10_000_000_000;
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
  moving_good_fix: {
    title: '移动好点',
    meaning: '该点通过移动距离、时间和精度检查，进入可信轨迹并累计距离/运动时间。',
    evidence: '重点看 accuracy、距上一可信点距离、时间间隔、推算速度和距离增量。'
  },
  weak_signal_stage2: {
    title: '弱点云',
    meaning: '当前合法样本进入 WEAK_CLOUD，只保留为 weak 诊断点，不进入 GPX，也不累计距离。',
    evidence: '重点看 cloudSampleCount、cloudWeightedRadiusMeters、accuracy、GNSS 质量和 contributingRawPointIds。'
  },
  gap_recovery: {
    title: '长 GAP 后恢复',
    meaning: '距上一可信点间隔过长，恢复点开启或延续 segment，但当前恢复 delta 不回填距离。',
    evidence: '重点看间隔秒数、no_location_timeout、sampling_policy、GAP 前后 GNSS snapshot。'
  },
  transport_suspected_kept: {
    title: '交通工具风险保留',
    meaning: '速度和位移触发交通工具风险，但该风险只作为解释标签，仍保留进目标轨迹，避免误删正常轨迹。',
    evidence: '重点看该段是否可能是快走、跑动、下坡、乘车或其他非徒步移动。'
  },
  recovery_cloud_pending: {
    title: '恢复点云等待稳定',
    meaning: 'GAP、transport 或静止边界后第一个恢复样本还不足以建立新连续性。',
    evidence: '重点看 RECOVERY_CLOUD 的样本数、半径、GNSS 质量和 samplingEpochId。'
  },
  stationary_anchor: {
    title: '静止点云 anchor',
    meaning: '静止点云稳定且有近期 device_motion_window 低运动证据后，输出零 delta anchor，用作可信静止位置。',
    evidence: '重点看 cloudWeightedRadiusMeters、cloudSampleCount、device_motion_window 和 representativeRawPointId。'
  },
  stationary_cloud_jitter: {
    title: '静止点云漂移',
    meaning: '点位接近静止区域，但没有足够 still-motion 支持成为 anchor；不累计距离，也不单独触发 PAUSED。',
    evidence: '重点看点云半径、accuracy、device_motion_window 和距上一可信 TrackPoint 的距离，慢速移动也可能落在这里。'
  },
  moving_cloud_unstable: {
    title: '移动点云未稳定',
    meaning: '移动点云已有证据但尚未满足稳定条件，因此只输出 weak 诊断点。',
    evidence: '重点看 weightedRadius、minCloudWeight、speedPlausibilityScore 和 contributingRawPointIds。'
  },
  provider_not_gps: {
    title: '非 GPS Provider',
    meaning: '可信轨迹只允许 LocationManager.GPS_PROVIDER，其他 provider 必须拒绝。',
    evidence: '重点看 raw_location.provider，不能用 network/fused 点进入可信轨迹。'
  },
  missing_fix_elapsed_realtime: {
    title: '缺少 elapsedRealtime',
    meaning: '缺少连续时间基准，无法可靠计算点序、速度、GAP 和回放一致性。',
    evidence: '重点看 hasElapsedRealtimeNanos 和 elapsedRealtimeNanos 字段。'
  },
  before_record_start: {
    title: '早于记录开始',
    meaning: 'Location 时间早于本次记录起点，不应进入当前 session 的可信轨迹。',
    evidence: '重点看 createdElapsedRealtimeNanos 与 raw elapsedRealtimeNanos 的关系。'
  },
  sampling_contract_violation: {
    title: '采样契约破坏',
    meaning: 'Location callback 没有绑定 SamplingEpoch，属于 session 完整性错误。',
    evidence: '重点看 callback 发起方是否随请求保存并回传 samplingEpochId。'
  },
  sampling_epoch_mismatch: {
    title: '采样归因不匹配',
    meaning: '定位点时间落在当前 SamplingEpoch 之前，不能归给当前采样发起者。',
    evidence: '重点看 samplingEpochId、epoch startedElapsedRealtimeNanos 和 fix elapsedRealtimeNanos。'
  },
  duplicate_fix: {
    title: '重复定位点',
    meaning: '同一个 SamplingEpoch 下已接收过相同 fix，不能重复进入点云。',
    evidence: '重点看 provider、elapsedRealtimeNanos、lat/lng 和 accuracy 是否完全重复。'
  },
  out_of_order_fix: {
    title: '定位时间倒退',
    meaning: 'fix 测量时间没有严格向前，无法建立连续轨迹。',
    evidence: '重点看 elapsedRealtimeNanos 是否小于或等于上一合法 fix。'
  },
  accuracy_too_large: {
    title: '精度过大',
    meaning: 'Location accuracy 超过 intake 上限，只能作为拒绝诊断，不能进入点云。',
    evidence: '重点看 accuracy 是否超过 maxIntakeAccuracyMeters。'
  }
};

export function isEvidenceJsonlPath(path) {
  return /(^|\/)evidence\.jsonl(?:\.json)?$/i.test(String(path || ''));
}

export function isEvidenceCandidatePath(path) {
  return /(^|\/)(evidence|gnss_evidence_[^/]+)\.jsonl(?:\.json)?$/i
    .test(String(path || ''));
}

export function parseEvidenceJsonl(text, filePath = 'evidence.jsonl') {
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

export function buildTargetOutput(model, targetProduct = null) {
  const trustedTrack = targetProduct?.track || model.trustedPoints;
  const rawTrack = model.points;
  const totalDistanceMeters = targetProduct?.stats?.totalDistanceMeters
    ?? sumPoints(trustedTrack, 'distanceDeltaMeters');
  const movingTimeSeconds = targetProduct?.stats?.movingTimeSeconds
    ?? sumPoints(trustedTrack, 'movingTimeDeltaSeconds');
  const paceSecondsPerKm = totalDistanceMeters > 0 && movingTimeSeconds > 0
    ? movingTimeSeconds / (totalDistanceMeters / 1000)
    : null;
  const ascent = ascentEvidence(model.events);
  const explainedRawCount = targetProduct
    ? targetProduct.stats.trustedPointCount
      + targetProduct.stats.weakPointCount
      + targetProduct.stats.rejectedPointCount
      + targetProduct.stats.intakeRejectedPointCount
    : model.points.filter((point) => point.decision).length;
  const unexplainedRawCount = Math.max(0, model.points.length - explainedRawCount);
  const findings = [];
  if (model.parseErrors.length > 0) {
    findings.push(`解析错误 ${model.parseErrors.length} 行`);
  }
  if (unexplainedRawCount > 0) {
    findings.push(`未解释 raw_location ${unexplainedRawCount} 个`);
  }
  if (ascent.selectedTotalAscentMeters === null) {
    findings.push('累计爬升证据不足');
  }
  if (paceSecondsPerKm === null) {
    findings.push('配速不可计算');
  }

  return {
    trackPointCount: trustedTrack.length,
    trustedTrack,
    rawTrack,
    totalDistanceMeters,
    movingTimeSeconds,
    paceSecondsPerKm,
    selectedTotalAscentMeters: ascent.selectedTotalAscentMeters,
    summaries: {
      raw: rawSummary(model.points, targetProduct),
      decision: decisionSummary(model, targetProduct),
      gnss: gnssSummary(model),
      pressure: pressureSummary(model, ascent),
      motion: motionSummary(model)
    },
    findings
  };
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
    meaning: '当前页面还没有这个算法原因的专门中文解释，请结合 result、上下文和原始字段复核。',
    evidence: '重点看 raw_location、GNSS snapshot、时间间隔、速度和 session_event。'
  };
}

function buildDiagnosticModel(events, parseErrors, filePath) {
  const metadata = events.find((event) => event.event === 'session_metadata') || {};
  const rawById = new Map();
  const gnssById = new Map();
  const barometerWindows = [];
  const deviceMotionWindows = [];
  const sessionEvents = [];
  const samplingPolicies = [];

  for (const event of events) {
    if (event.event === 'raw_location' && isFiniteNumber(event.lat) && isFiniteNumber(event.lng)) {
      rawById.set(Number(event.rawPointId), normalizeRawPoint(event));
    } else if (event.event === 'gnss_snapshot') {
      gnssById.set(Number(event.snapshotId), event);
    } else if (event.event === 'barometer_window') {
      barometerWindows.push(event);
    } else if (event.event === 'device_motion_window') {
      deviceMotionWindows.push(event);
    } else if (event.event === 'session_event') {
      sessionEvents.push(event);
    } else if (event.event === 'sampling_policy') {
      samplingPolicies.push(event);
    }
  }

  const points = Array.from(rawById.values()).sort(comparePointTime);
  for (const point of points) {
    const snapshotId = Number(point.sourceGnssSnapshotId);
    if (gnssById.has(snapshotId)) {
      point.gnss = gnssById.get(snapshotId);
    }
  }
  enrichPoints(points, deviceMotionWindows, barometerWindows);

  const trustedPoints = points.filter((point) => TRUSTED_RESULTS.has(point.kind));
  const rejectedPoints = points.filter((point) => point.kind === 'reject' || point.kind === 'intake_rejected');
  const weakPoints = points.filter((point) => point.kind === 'weak');
  const undecidedPoints = points.filter((point) => point.kind === 'raw');
  const bounds = pointBounds(points);
  const segments = buildTrustedSegments(trustedPoints);
  const reasonCounts = countReasons(points);
  const evidence = buildEvidenceModel({
    points,
    decisions: [],
    parseErrors,
    gnssSnapshots: Array.from(gnssById.values()),
    sessionEvents,
    samplingPolicies,
    deviceMotionWindows,
    barometerWindows
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
      decisionCount: 0,
      intakeRejectedCount: 0,
      trustedCount: trustedPoints.length,
      rejectedCount: rejectedPoints.length,
      weakCount: weakPoints.length,
      undecidedCount: undecidedPoints.length,
      linkedGnssPointCount: evidence.metrics.linkedGnssPointCount,
      staleRawCount: evidence.metrics.staleRawCount,
      gnssSnapshotCount: gnssById.size,
      barometerWindowCount: barometerWindows.length,
      deviceMotionWindowCount: deviceMotionWindows.length,
      sessionEventCount: sessionEvents.length,
      samplingPolicyCount: samplingPolicies.length,
      noLocationTimeoutCount: evidence.metrics.noLocationTimeoutCount,
      gapRecoveryCount: evidence.metrics.gapRecoveryCount,
      parseErrorCount: parseErrors.length,
      totalDistanceMeters: 0,
      movingTimeSeconds: 0,
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
    callbackReceivedElapsedRealtimeNanos: nullableNumber(event.callbackReceivedElapsedRealtimeNanos),
    callbackDelayNanos: nullableNumber(event.callbackDelayNanos),
    sourceGnssSnapshotId: nullableNumber(event.sourceGnssSnapshotId),
    sourceGnssSnapshotAgeNanos: nullableNumber(event.sourceGnssSnapshotAgeNanos),
    sourceGnssSnapshotMatchedFromFuture: event.sourceGnssSnapshotMatchedFromFuture === true,
    gnssQualityStale: event.gnssQualityStale === true,
    kind: 'raw'
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

function enrichPoints(points, deviceMotionWindows, barometerWindows) {
  let previousTrustedPoint = null;
  const sortedDeviceMotionWindows = [...deviceMotionWindows].sort(compareEventTime);
  const sortedBarometerWindows = [...barometerWindows].sort(compareEventTime);
  for (const point of points) {
    point.nearestDeviceMotionWindow = nearestWindow(point, sortedDeviceMotionWindows);
    point.nearestBarometerWindow = nearestWindow(point, sortedBarometerWindows);
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

  if (decision.intakeRejected) {
    insights.push({
      level: 'review',
      text: `该点在 SamplingIntake 被拒绝，原因=${decision.reason}；不会进入点云、decision 或 TrackPoint。`
    });
  }

  if (point.gnssQualityStale) {
    insights.push({
      level: 'review',
      text: '该点关联的 GNSS snapshot 已过期，卫星质量解释存在缺口。'
    });
  }

  if (point.callbackDelayNanos !== null) {
    const callbackDelaySeconds = point.callbackDelayNanos / 1_000_000_000;
    if (point.callbackDelayNanos >= CALLBACK_DELAY_REVIEW_NANOS) {
      insights.push({
        level: 'review',
        text: `Location callback 延迟约 ${formatOneDecimal(callbackDelaySeconds)} 秒；v3 仅用于诊断展示，不作为 callback age 硬拒绝。`
      });
    } else if (point.callbackDelayNanos > 0) {
      insights.push({
        level: 'info',
        text: `Location callback 延迟约 ${formatOneDecimal(callbackDelaySeconds)} 秒，仅用于诊断展示。`
      });
    }
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

  if (decision.reason === 'weak_signal_stage2' || decision.reason.startsWith('transport_')) {
    const speed = point.diagnosticContext.requiredSpeedMetersPerSecond;
    if (speed !== null) {
      insights.push({
        level: 'review',
        text: `从上一个可信点推算速度约 ${formatOneDecimal(speed)} m/s，用于区分漂移、跳点或疑似交通工具。`
      });
    }
  }

  if (decision.reason.startsWith('stationary_')) {
    const motion = point.nearestDeviceMotionWindow;
    if (motion) {
      insights.push({
        level: 'info',
        text: `附近 device_motion_window accelRms=${formatOneDecimal(deviceMotionAccelRms(motion))}，gyroRms=${formatOneDecimal(numericField(motion, 'gyroscopeRmsRadps'))}。`
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
  deviceMotionWindows,
  barometerWindows
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
      deviceMotionWindowCount: deviceMotionWindows.length,
      barometerWindowCount: barometerWindows.length,
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
  const explainedPointCount = points.filter((point) => point.decision).length;
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
  if (explainedPointCount === 0) {
    findings.push({
      level: 'fail',
      title: '缺少解释事件',
      detail: '没有目标轨迹重算结果，不能解释原始点是否进入可信轨迹。'
    });
  }
  if (points.length > 0 && explainedPointCount > 0 && points.length !== explainedPointCount) {
    findings.push({
      level: 'review',
      title: 'raw 与解释事件数量不一致',
      detail: `raw_location=${points.length}，解释事件=${explainedPointCount}，需要确认是否有未决或丢失事件。`
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

function nearestWindow(point, windows) {
  if (!Number.isFinite(point.elapsedRealtimeNanos) || windows.length === 0) {
    return null;
  }
  let best = null;
  let bestDistance = Infinity;
  for (const window of windows) {
    const start = numericField(window, 'startElapsedRealtimeNanos');
    const end = numericField(window, 'endElapsedRealtimeNanos');
    if (start === null || end === null) {
      continue;
    }
    const distance = point.elapsedRealtimeNanos >= start && point.elapsedRealtimeNanos <= end
      ? 0
      : Math.min(Math.abs(point.elapsedRealtimeNanos - start),
        Math.abs(point.elapsedRealtimeNanos - end));
    if (distance < bestDistance) {
      best = window;
      bestDistance = distance;
    }
  }
  return best;
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

function sumPoints(points, field) {
  return points.reduce((sum, point) => {
    const value = Number(point.decision?.[field]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function rawSummary(points, targetProduct = null) {
  const accuracies = points
    .map((point) => point.accuracy)
    .filter((value) => Number.isFinite(value));
  const elapsedValues = points
    .map((point) => point.elapsedRealtimeNanos)
    .filter((value) => Number.isFinite(value));
  return {
    count: points.length,
    timeStartNanos: elapsedValues.length ? Math.min(...elapsedValues) : null,
    timeEndNanos: elapsedValues.length ? Math.max(...elapsedValues) : null,
    minAccuracyMeters: accuracies.length ? Math.min(...accuracies) : null,
    maxAccuracyMeters: accuracies.length ? Math.max(...accuracies) : null,
    unexplainedCount: targetProduct
      ? Math.max(0, points.length - targetProduct.stats.trustedPointCount
        - targetProduct.stats.weakPointCount
        - targetProduct.stats.rejectedPointCount
        - targetProduct.stats.intakeRejectedPointCount)
      : points.filter((point) => !point.decision).length
  };
}

function decisionSummary(model, targetProduct = null) {
  if (targetProduct) {
    const reasonCounts = new Map();
    for (const point of targetProduct.track) {
      incrementReason(reasonCounts, point.result, point.reason);
    }
    for (const point of targetProduct.excluded.weak) {
      incrementReason(reasonCounts, point.result, point.reason);
    }
    for (const point of targetProduct.excluded.rejected) {
      incrementReason(reasonCounts, point.result, point.reason);
    }
    for (const point of targetProduct.excluded.intakeRejected) {
      incrementReason(reasonCounts, point.result, point.reason);
    }
    return {
      decisionCount: targetProduct.stats.trustedPointCount
        + targetProduct.stats.weakPointCount
        + targetProduct.stats.rejectedPointCount
        + targetProduct.stats.intakeRejectedPointCount,
      anchorCount: targetProduct.track.filter((point) => point.result === 'anchor').length,
      acceptCount: targetProduct.track.filter((point) => point.result === 'accept').length,
      weakCount: targetProduct.stats.weakPointCount,
      rejectCount: targetProduct.stats.rejectedPointCount,
      intakeRejectedCount: targetProduct.stats.intakeRejectedPointCount,
      topReasons: Array.from(reasonCounts, ([reason, count]) => {
        const [result, reasonText] = splitReasonKey(reason);
        return {
          reason,
          count,
          explanation: explainDecisionReason(result, reasonText)
        };
      }).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, 5)
    };
  }
  const counts = {
    decisionCount: model.summary.decisionCount,
    anchorCount: model.points.filter((point) => point.decision?.result === 'anchor').length,
    acceptCount: model.points.filter((point) => point.decision?.result === 'accept').length,
    weakCount: model.summary.weakCount,
    rejectCount: model.points.filter((point) => point.decision?.result === 'reject').length,
    intakeRejectedCount: model.summary.intakeRejectedCount
  };
  return {
    ...counts,
    topReasons: model.reasonCounts.slice(0, 5)
  };
}

function incrementReason(counts, result, reason) {
  const key = `${result || ''}:${reason || '-'}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}

function gnssSummary(model) {
  const snapshots = model.events.filter((event) => event.event === 'gnss_snapshot');
  return {
    snapshotCount: snapshots.length,
    linkedPointCount: model.summary.linkedGnssPointCount,
    staleRawCount: model.summary.staleRawCount,
    staleRawRatio: model.summary.rawCount === 0 ? 0 : model.summary.staleRawCount / model.summary.rawCount,
    averageUsedInFixTotal: averageMetric(snapshots, 'usedInFixTotal'),
    averageUsedAvgCn0: averageMetric(snapshots, 'usedAvgCn0'),
    averageTop4AvgCn0: averageMetric(snapshots, 'top4AvgCn0')
  };
}

function pressureSummary(model, ascent) {
  const barometerWindows = model.events.filter((event) => event.event === 'barometer_window');
  return {
    barometerWindowCount: barometerWindows.length,
    selectedTotalAscentMeters: ascent.selectedTotalAscentMeters,
    selectedAscentSource: ascent.selectedAscentSource,
    barometerTotalAscentMeters: ascent.barometerTotalAscentMeters,
    gnssTotalAscentMeters: ascent.gnssTotalAscentMeters
  };
}

function motionSummary(model) {
  const deviceMotionWindows = model.events.filter((event) => event.event === 'device_motion_window');
  const stationaryEvidenceCount = model.points.filter((point) =>
    String(point.decision?.reason || '').startsWith('stationary_')
      || String(point.decision?.reason || '').includes('recovery')
  ).length;
  return {
    deviceMotionWindowCount: deviceMotionWindows.length,
    stationaryEvidenceCount
  };
}

function ascentEvidence(events) {
  let selectedTotalAscentMeters = null;
  let selectedAscentSource = '';
  let barometerTotalAscentMeters = null;
  let gnssTotalAscentMeters = null;
  for (const event of events) {
    const selected = numericField(event, 'selectedTotalAscentMeters');
    if (selected !== null && selected >= 0) {
      selectedTotalAscentMeters = selected;
      selectedAscentSource = String(event.selectedAscentSource || selectedAscentSource || '');
    }
    const barometer = numericField(event, 'barometerTotalAscentMeters');
    if (barometer !== null && barometer >= 0) {
      barometerTotalAscentMeters = barometer;
    }
    const gnss = numericField(event, 'gnssTotalAscentMeters');
    if (gnss !== null && gnss >= 0) {
      gnssTotalAscentMeters = gnss;
    }
  }
  return {
    selectedTotalAscentMeters,
    selectedAscentSource,
    barometerTotalAscentMeters,
    gnssTotalAscentMeters
  };
}

function averageMetric(events, field) {
  let total = 0;
  let count = 0;
  for (const event of events) {
    const value = numericField(event, field);
    if (value !== null) {
      total += value;
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

function numericField(object, field) {
  if (!object || object[field] === null || object[field] === undefined) {
    return null;
  }
  const value = Number(object[field]);
  return Number.isFinite(value) ? value : null;
}

function deviceMotionAccelRms(motion) {
  const linearSampleCount = numericField(motion, 'linearAccelerationSampleCount') ?? 0;
  return linearSampleCount > 0
    ? numericField(motion, 'linearAccelerationRmsMps2')
    : numericField(motion, 'accelerometerDynamicRmsMps2');
}

function eventSortTime(event) {
  return numericField(event, 'eventElapsedRealtimeNanos')
    ?? numericField(event, 'endElapsedRealtimeNanos')
    ?? numericField(event, 'lastElapsedRealtimeNanos')
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
