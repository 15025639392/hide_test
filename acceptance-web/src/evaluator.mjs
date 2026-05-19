export const DEVICE_GROUP_RULES = {
  'same-model': {
    label: '同型号',
    excellent: 0.05,
    pass: 0.08,
    review: 0.12
  },
  'same-brand': {
    label: '同品牌不同型号/传感器',
    excellent: 0.08,
    pass: 0.12,
    review: 0.15
  },
  'cross-brand-same-algorithm': {
    label: '不同品牌',
    excellent: 0.08,
    pass: 0.12,
    review: 0.18
  },
  'unknown-device': {
    label: '未知设备',
    excellent: 0.08,
    pass: 0.12,
    review: 0.18,
    allowPass: false
  }
};

const LOW_ASCENT_ABSOLUTE_LIMITS = [
  { maxMedian: 50, limit: 15 },
  { maxMedian: 100, limit: 20 },
  { maxMedian: 300, limit: 25 }
];

const MIN_REFERENCE_ASCENT_METERS = 100;

export function normalizeSession(input, fileName = '') {
  const ascent = numberOrNull(input.barometerTotalAscentMeters);
  return {
    fileName,
    filePath: fileName,
    sessionId: String(input.sessionId || fileName || 'unknown-session'),
    strategyVersion: String(input.strategyVersion || ''),
    completionState: String(input.completionState || ''),
    integrityState: String(input.integrityState || ''),
    selectedAscentSource: String(input.selectedAscentSource || 'NONE'),
    barometerTotalAscentMeters: ascent,
    barometerAscentSampleCount: numberOrNull(input.barometerAscentSampleCount) ?? 0,
    barometerAscentRejectedSampleCount: numberOrNull(input.barometerAscentRejectedSampleCount) ?? 0,
    deviceManufacturer: String(input.deviceManufacturer || ''),
    deviceBrand: String(input.deviceBrand || ''),
    deviceModel: String(input.deviceModel || ''),
    deviceName: String(input.deviceName || ''),
    androidSdkInt: numberOrNull(input.androidSdkInt) ?? 0
  };
}

export function isSessionJsonPath(path) {
  return /(^|\/)session\.json$/i.test(String(path || ''));
}

export function evaluateBatch(sessions, options = {}) {
  const normalized = sessions.map((session) =>
    session.barometerTotalAscentMeters === undefined ? normalizeSession(session) : session
  );
  const deviceResults = normalized.map((session) => ({
    ...session,
    exclusionReasons: exclusionReasons(session)
  }));
  const valid = deviceResults.filter((session) => session.exclusionReasons.length === 0);
  const deviceGroup = options.deviceGroup || inferDeviceGroup(valid);
  const rule = DEVICE_GROUP_RULES[deviceGroup] || DEVICE_GROUP_RULES['same-model'];
  const ascents = valid.map((session) => session.barometerTotalAscentMeters).sort((a, b) => a - b);
  const medianAscentMeters = median(ascents);

  let maxRelativeDeviation = 0;
  let maxAbsoluteDeviationMeters = 0;
  const lowAscentLimit = lowAscentAbsoluteLimit(medianAscentMeters);

  const devices = deviceResults.map((session) => {
    if (session.exclusionReasons.length > 0 || medianAscentMeters === null) {
      return {
        ...session,
        verdict: 'EXCLUDED',
        absoluteDeviationMeters: null,
        relativeDeviation: null,
        findings: session.exclusionReasons
      };
    }
    const absoluteDeviationMeters =
      Math.abs(session.barometerTotalAscentMeters - medianAscentMeters);
    const relativeDeviation =
      absoluteDeviationMeters / Math.max(medianAscentMeters, MIN_REFERENCE_ASCENT_METERS);
    maxRelativeDeviation = Math.max(maxRelativeDeviation, relativeDeviation);
    maxAbsoluteDeviationMeters = Math.max(maxAbsoluteDeviationMeters, absoluteDeviationMeters);
    return {
      ...session,
      verdict: deviceVerdict(relativeDeviation, absoluteDeviationMeters, lowAscentLimit, rule),
      absoluteDeviationMeters,
      relativeDeviation,
      findings: deviceFindings(session, deviceGroup)
    };
  });

  const validDeviceCount = valid.length;
  const excludedDeviceCount = deviceResults.length - validDeviceCount;
  const groupVerdict = batchVerdict({
    validDeviceCount,
    excludedDeviceCount,
    maxRelativeDeviation,
    maxAbsoluteDeviationMeters,
    lowAscentLimit,
    rule
  });

  return {
    deviceGroup,
    deviceGroupLabel: rule.label,
    verdict: groupVerdict,
    medianAscentMeters,
    maxRelativeDeviation: validDeviceCount ? maxRelativeDeviation : null,
    maxAbsoluteDeviationMeters: validDeviceCount ? maxAbsoluteDeviationMeters : null,
    validDeviceCount,
    excludedDeviceCount,
    rule,
    lowAscentLimit,
    devices
  };
}

export function reportToMarkdown(report) {
  const lines = [
    `# 气压计累计爬升一致性验收`,
    '',
    `- 设备组合: ${report.deviceGroupLabel}`,
    `- 结论: ${report.verdict}`,
    `- 中位爬升: ${formatMeters(report.medianAscentMeters)}`,
    `- 最大相对偏差: ${formatPercent(report.maxRelativeDeviation)}`,
    `- 最大绝对偏差: ${formatMeters(report.maxAbsoluteDeviationMeters)}`,
    '',
    `| 结论 | 设备 | Session | 来源 | 爬升 | 绝对差 | 相对差 | 样本/拒绝 | 说明 |`,
    `| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |`
  ];
  for (const device of report.devices) {
    lines.push(
      `| ${device.verdict} | ${deviceLabel(device)} | ${device.sessionId} | `
      + `${device.selectedAscentSource} | ${formatMeters(device.barometerTotalAscentMeters)} | `
      + `${formatMeters(device.absoluteDeviationMeters)} | ${formatPercent(device.relativeDeviation)} | `
      + `${device.barometerAscentSampleCount}/${device.barometerAscentRejectedSampleCount} | `
      + `${device.findings.join('; ') || '-'} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function deviceLabel(device) {
  const model = [device.deviceBrand, device.deviceModel].filter(Boolean).join(' ');
  return model || device.deviceName || device.deviceManufacturer || 'unknown-device';
}

export function formatMeters(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(1)}m`;
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function exclusionReasons(session) {
  const reasons = [];
  if (!session.completionState) {
    reasons.push('缺少 session 完成状态');
  } else if (session.completionState !== 'FINISHED') {
    reasons.push(`session 未完成: ${session.completionState}`);
  }
  if (!session.integrityState) {
    reasons.push('缺少完整性状态');
  } else if (session.integrityState !== 'OK') {
    reasons.push(`完整性异常: ${session.integrityState}`);
  }
  if (session.selectedAscentSource !== 'BAROMETER') {
    reasons.push(`爬升来源不是 BAROMETER: ${session.selectedAscentSource}`);
  }
  if (session.barometerTotalAscentMeters === null || session.barometerTotalAscentMeters < 0) {
    reasons.push('缺少有效 BAROMETER 爬升');
  }
  if (!Number.isFinite(session.barometerAscentSampleCount)
    || session.barometerAscentSampleCount <= 0) {
    reasons.push('气压计样本数为 0');
  }
  return reasons;
}

function batchVerdict(params) {
  if (params.validDeviceCount < 2) {
    return 'FAIL';
  }
  const absolutePass = params.lowAscentLimit !== null
    && params.maxAbsoluteDeviationMeters <= params.lowAscentLimit;
  if (params.maxRelativeDeviation <= params.rule.pass || absolutePass) {
    return params.excludedDeviceCount > 0 || params.rule.allowPass === false ? 'REVIEW' : 'PASS';
  }
  if (params.maxRelativeDeviation <= params.rule.review) {
    return 'REVIEW';
  }
  return 'FAIL';
}

function deviceVerdict(relativeDeviation, absoluteDeviationMeters, lowAscentLimit, rule) {
  if (lowAscentLimit !== null && absoluteDeviationMeters <= lowAscentLimit) {
    return 'PASS';
  }
  if (relativeDeviation <= rule.pass) {
    return 'PASS';
  }
  if (relativeDeviation <= rule.review) {
    return 'REVIEW';
  }
  return 'FAIL';
}

function inferDeviceGroup(validSessions) {
  if (validSessions.length < 2) {
    return validSessions.length === 1 && hasDeviceIdentity(validSessions[0])
      ? 'same-model' : 'unknown-device';
  }
  const brandKeys = new Set();
  const modelKeys = new Set();
  for (const session of validSessions) {
    if (!hasDeviceIdentity(session)) {
      return 'unknown-device';
    }
    const brand = normalizeKey(session.deviceBrand || session.deviceManufacturer);
    const model = normalizeKey(session.deviceModel || session.deviceName);
    if (brand) {
      brandKeys.add(brand);
    }
    if (brand || model) {
      modelKeys.add(`${brand}|${model}`);
    }
  }
  if (modelKeys.size <= 1) {
    return 'same-model';
  }
  if (brandKeys.size <= 1) {
    return 'same-brand';
  }
  return 'cross-brand-same-algorithm';
}

function hasDeviceIdentity(session) {
  const brand = normalizeKey(session.deviceBrand || session.deviceManufacturer);
  const model = normalizeKey(session.deviceModel || session.deviceName);
  return Boolean(brand && model);
}

function deviceFindings(session, deviceGroup) {
  if (deviceGroup !== 'unknown-device' || hasDeviceIdentity(session)) {
    return [];
  }
  return ['设备信息缺失，设备组合需人工确认'];
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[mid];
  }
  return (values[mid - 1] + values[mid]) / 2;
}

function lowAscentAbsoluteLimit(medianAscentMeters) {
  if (medianAscentMeters === null) {
    return null;
  }
  const matched = LOW_ASCENT_ABSOLUTE_LIMITS.find((item) => medianAscentMeters < item.maxMedian);
  return matched ? matched.limit : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
