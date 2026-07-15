export function buildStreamingDiagnosticContextReport(source = {}) {
  const scenarioById = sourceScenarioById(source);
  const contexts = diagnosticContextProposals(source)
    .filter((proposal) => proposal?.metricOwner === false)
    .map((proposal) => normalizeDiagnosticContext(proposal, scenarioById))
    .filter(Boolean)
    .sort((a, b) =>
      nullableNumberSort(a.rawRange?.startRawPointId, b.rawRange?.startRawPointId)
      || nullableNumberSort(a.rawRange?.endRawPointId, b.rawRange?.endRawPointId)
      || a.scenario.localeCompare(b.scenario)
      || a.id.localeCompare(b.id));
  return {
    totalCount: contexts.length,
    scenarioCounts: scenarioCounts(contexts),
    contexts,
    findings: diagnosticContextFindings(contexts)
  };
}

function diagnosticContextProposals(source) {
  if (Array.isArray(source)) return source;
  return source?.scenarioSettlementPlan?.contextProposals
    || source?.scenarioSettlementSession?.lastSettlementPlan?.contextProposals
    || source?.lastSettlementPlan?.contextProposals
    || source?.contextProposals
    || [];
}

function normalizeDiagnosticContext(proposal, scenarioById = new Map()) {
  const scenario = stringValue(proposal?.scenario);
  if (!scenario) return null;
  const rawRange = normalizeRawRange(proposal.rawRange);
  const sourceScenario = scenarioById.get(finiteNumber(proposal.evidence?.sourceScenarioId));
  const mergedEvidence = {
    ...(sourceScenario?.evidence || {}),
    ...(proposal.evidence || {})
  };
  return {
    id: stringValue(proposal.id),
    scenario,
    rawRange,
    metricOwner: false,
    affectedMetricGates: stringArray(proposal.affectedMetricGates),
    coordinatorState: stringValue(proposal.coordinatorState) || null,
    action: stringValue(proposal.action),
    localRebuild: stringValue(proposal.localRebuild),
    confidence: finiteNumber(proposal.confidence),
    compatibilityTags: stringArray(proposal.compatibilityTags),
    anchorRawPointIds: uniqueNumbers([
      ...(Array.isArray(proposal.anchorRawPointIds) ? proposal.anchorRawPointIds : []),
      ...(Array.isArray(proposal.evidence?.anchorRawPointIds)
        ? proposal.evidence.anchorRawPointIds
        : []),
      ...(Array.isArray(sourceScenario?.anchorRawPointIds) ? sourceScenario.anchorRawPointIds : [])
    ]),
    evidence: diagnosticEvidenceSummary(mergedEvidence)
  };
}

function sourceScenarioById(source) {
  const scenarios = Array.isArray(source?.scenarios) ? source.scenarios : [];
  return new Map(scenarios
    .map((scenario) => [finiteNumber(scenario?.scenarioId), scenario])
    .filter(([scenarioId]) => Number.isFinite(scenarioId)));
}

function diagnosticEvidenceSummary(evidence) {
  const keys = [
    'intent',
    'plannedSettlement',
    'observedMetricScenarios',
    'conflictReview',
    'gapRecoveryCount',
    'stationaryAnchorCount',
    'trackPointCount',
    'inputTrackPointCount',
    'segmentIds',
    'bboxDiagonalMeters',
    'durationSeconds',
    'denseAreaIntents',
    'gapClusterIntentSupported',
    'mixedIntentSupported',
    'rejectedCandidate',
    'rejectionReason',
    'sameRoadCollapseReason',
    'sameRoadBboxMeters',
    'sameRoadApproachPairDistanceMeters',
    'turnRawPointId',
    'endpointRawPointId',
    'roundTripIntentSupported',
    'maxSampleGapSeconds',
    'endpointDistanceMeters',
    'turnDistanceMeters',
    'crossTrackMeters'
  ];
  const summary = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(evidence, key)) continue;
    summary[key] = cloneJsonValue(evidence[key]);
  }
  return summary;
}

function scenarioCounts(contexts) {
  const counts = new Map();
  for (const context of contexts) {
    counts.set(context.scenario, (counts.get(context.scenario) || 0) + 1);
  }
  return Array.from(counts, ([scenario, count]) => ({ scenario, count }))
    .sort((a, b) => b.count - a.count || a.scenario.localeCompare(b.scenario));
}

function diagnosticContextFindings(contexts) {
  if (contexts.length === 0) return [];
  return scenarioCounts(contexts).map((item) =>
    `streaming diagnostic context ${item.scenario} ${item.count} 段`);
}

function normalizeRawRange(rawRange) {
  const startRawPointId = finiteNumber(rawRange?.startRawPointId);
  const endRawPointId = finiteNumber(rawRange?.endRawPointId);
  return Number.isFinite(startRawPointId) && Number.isFinite(endRawPointId)
    ? { startRawPointId, endRawPointId }
    : null;
}

function stringArray(values) {
  return Array.isArray(values)
    ? [...new Set(values.map(stringValue).filter(Boolean))].sort()
    : [];
}

function uniqueNumbers(values) {
  return [...new Set(values.map(finiteNumber).filter(Number.isFinite))]
    .sort((a, b) => a - b);
}

function nullableNumberSort(left, right) {
  const leftFinite = Number.isFinite(left);
  const rightFinite = Number.isFinite(right);
  if (!leftFinite && !rightFinite) return 0;
  if (!leftFinite) return 1;
  if (!rightFinite) return -1;
  return left - right;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function cloneJsonValue(value) {
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value;
}
