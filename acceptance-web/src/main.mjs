import {
  buildTargetOutput,
  formatDuration,
  isEvidenceCandidatePath,
  parseEvidenceJsonl
} from './diagnosticMap.mjs';
import { buildCleanedLineFeatures } from './cleanedLineStyles.mjs';
import {
  buildSixLayerTrackProduct,
  reviewTrackPointScenarioCoverage
} from './sixLayerTrackProduct.mjs';
import {
  buildScenarioPolygonFeatures
} from './scenarioPolygons.mjs';
import {
  DEFAULT_SCENARIO_REPAIR_IDS,
  SCENARIO_REPAIR_OPTIONS,
  enabledScenarioRepairIds,
  fullScenarioRepairConfig,
  scenarioRepairConfigFromIds,
  scenarioRepairSummary
} from './scenarioRepairConfig.mjs';

const COLORS = ['#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#c084fc', '#34d399', '#f97316', '#e879f9'];
const MAP_LINE_POINT_LIMIT = 6000;
const MAP_RAW_POINT_LIMIT = 7000;
const MAP_TRACK_POINT_LIMIT = 5000;
const TERRAIN_EXAGGERATION = 1.15;
const TERRAIN_TILEJSON_URL = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_TILE_TEMPLATE = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const TERRAIN_DEM_MAX_ZOOM = 13;
const TERRAIN_TILE_SIZE = 512;
const CONTOUR_LAYER_IDS = [
  'terrain-contours-minor',
  'terrain-contours-major',
  'terrain-contour-minor-labels',
  'terrain-contour-major-labels'
];
const CONTOUR_LINE_LAYER_IDS = ['terrain-contours-minor', 'terrain-contours-major'];
const CONTOUR_THRESHOLDS_METERS = {
  10: [100, 500],
  11: [50, 250],
  12: [50, 250],
  13: [20, 100],
  14: [10, 50],
  15: [10, 50]
};
const state = {
  datasets: [],
  selectedDatasetId: null,
  selectedPoint: null,
  scenarioReviewRangeText: '',
  enabledScenarioRepairIds: [...DEFAULT_SCENARIO_REPAIR_IDS],
  lastScenarioRepairImpact: null,
  scenarioRepairApplyGeneration: 0,
  selectedContour: null,
  map: null,
  mapLoaded: false,
  contoursAvailable: false,
  contourDemSource: null,
  popup: null
};

const elements = {
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  fitBoundsButton: document.querySelector('#fitBoundsButton'),
  clearButton: document.querySelector('#clearButton'),
  showRaw: document.querySelector('#showRaw'),
  showTrusted: document.querySelector('#showTrusted'),
  showCleaned: document.querySelector('#showCleaned'),
  showScenarios: document.querySelector('#showScenarios'),
  showTerrain: document.querySelector('#showTerrain'),
  showContours: document.querySelector('#showContours'),
  contourDataPanel: document.querySelector('#contourDataPanel'),
  contourDataStatus: document.querySelector('#contourDataStatus'),
  contourDataSelected: document.querySelector('#contourDataSelected'),
  scenarioRepairSummary: document.querySelector('#scenarioRepairSummary'),
  scenarioRepairOptions: document.querySelector('#scenarioRepairOptions'),
  showDirection: document.querySelector('#showDirection'),
  showCleanedPoints: document.querySelector('#showCleanedPoints'),
  showPoints: document.querySelector('#showPoints'),
  cleaningAlgorithm: document.querySelector('#cleaningAlgorithm'),
  cleaningConfigState: document.querySelector('#cleaningConfigState'),
  importStatus: document.querySelector('#importStatus'),
  importSpinner: document.querySelector('#importSpinner'),
  importText: document.querySelector('#importText'),
  scenarioRangeInput: document.querySelector('#scenarioRangeInput'),
  scenarioRangeReviewButton: document.querySelector('#scenarioRangeReviewButton'),
  scenarioRangeState: document.querySelector('#scenarioRangeState'),
  scenarioRangeReview: document.querySelector('#scenarioRangeReview'),
  selectedPointText: document.querySelector('#selectedPointText'),
  pointDetails: document.querySelector('#pointDetails'),
  mapView: document.querySelector('#mapView')
};

elements.folderInput.addEventListener('change', async (event) => {
  await importFiles(Array.from(event.target.files || []), true);
});
elements.fileInput.addEventListener('change', async (event) => {
  await importFiles(Array.from(event.target.files || []), false);
});
elements.clearButton.addEventListener('click', clearAll);
elements.fitBoundsButton.addEventListener('click', fitAllBounds);
elements.scenarioRangeReviewButton.addEventListener('click', applyScenarioRangeReview);
elements.scenarioRangeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyScenarioRangeReview();
});
elements.scenarioRangeReview.addEventListener('click', handleScenarioRangeReviewClick);
elements.cleaningAlgorithm.addEventListener('click', handleScenarioRangeReviewClick);
elements.showTerrain.addEventListener('change', renderTerrain);
elements.showContours.addEventListener('change', renderContours);
elements.scenarioRepairOptions.addEventListener('change', handleScenarioRepairChange);
for (const input of [
  elements.showRaw,
  elements.showTrusted,
  elements.showCleaned,
  elements.showScenarios,
  elements.showDirection,
  elements.showCleanedPoints,
  elements.showPoints
]) {
  input.addEventListener('change', renderMap);
}

initMap();
render();

async function importFiles(files, fromDirectory) {
  setLoading(true, '正在识别 evidence.jsonl...');
  await nextFrame();
  const evidenceFiles = files
    .filter((file) => {
      const path = file.webkitRelativePath || file.name;
      return isEvidenceCandidatePath(path);
    })
    .sort((left, right) =>
      (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name));
  const datasets = [];
  const errors = [];
  try {
    for (const file of evidenceFiles) {
      const filePath = file.webkitRelativePath || file.name;
      setLoading(true, `正在解析 ${datasets.length + 1}/${evidenceFiles.length}: ${filePath}`);
      await nextFrame();
      try {
        datasets.push(await readEvidenceFile(file, datasets.length));
      } catch (error) {
        errors.push(`${filePath}: ${error.message}`);
      }
    }
    state.datasets = datasets;
    state.selectedDatasetId = datasets[0]?.id || null;
    state.selectedPoint = null;
    setImportText(errors.length
      ? `找到 ${evidenceFiles.length} 个 evidence 文件，已导入 ${datasets.length} 个，失败 ${errors.length} 个：${errors[0]}`
      : `找到 ${evidenceFiles.length} 个 evidence 文件，已导入 ${datasets.length} 个`);
    render();
    fitAllBounds();
  } finally {
    setLoading(false);
  }
}

async function readEvidenceFile(file, index) {
  const filePath = file.webkitRelativePath || file.name;
  const result = await readEvidenceFileInWorker(file, filePath, currentCleaningConfig(),
    fullScenarioConfig());
  return finalizeDataset({
    ...result,
    sourceFile: file
  }, index);
}

async function readEvidenceFileInWorker(file, filePath, config, scenarioConfig) {
  if (!window.Worker) {
    return readEvidenceFileOnMainThread(file, filePath, config, scenarioConfig);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./importWorker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker.terminate();
      const message = event.data || {};
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message.error?.message || '后台解析失败'));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || '后台解析失败'));
    };
    worker.postMessage({
      file,
      fileName: file.name,
      filePath,
      config,
      scenarioConfig
    });
  });
}

async function readEvidenceFileOnMainThread(file, filePath, config, scenarioConfig) {
  const text = await file.text();
  const model = parseEvidenceJsonl(text, filePath);
  const targetProduct = buildSixLayerTrackProduct(model, { config });
  const scenarioProduct = sameCleaningConfig(config, scenarioConfig)
    ? targetProduct
    : buildSixLayerTrackProduct(model, { config: scenarioConfig });
  return {
    fileName: file.name,
    filePath,
    model,
    scenarioProduct,
    targetProduct,
    targetOutput: compactTargetOutput(buildTargetOutput(model, targetProduct))
  };
}

function finalizeDataset(result, index) {
  const dataset = {
    id: `dataset-${index + 1}`,
    fileName: result.fileName,
    filePath: result.filePath,
    sourceFile: result.sourceFile || null,
    color: COLORS[index % COLORS.length],
    model: result.model,
    scenarioProduct: result.scenarioProduct || result.targetProduct,
    targetProduct: result.targetProduct,
    targetOutput: result.targetOutput,
    visible: true
  };
  attachDatasetIndexes(dataset);
  return dataset;
}

function compactTargetOutput(output) {
  return {
    selectedTotalAscentMeters: output?.selectedTotalAscentMeters ?? null,
    selectedAscentSource: output?.selectedAscentSource || 'NONE',
    barometerTotalAscentMeters: output?.summaries?.pressure?.barometerTotalAscentMeters ?? null,
    locationAltitudeTotalAscentMeters:
      output?.summaries?.pressure?.locationAltitudeTotalAscentMeters ?? null,
    denseAreaSettlementPlan: output?.denseAreaSettlementPlan || [],
    denseIntentConflicts: output?.denseIntentConflicts || [],
    forwardSpineCandidates: output?.forwardSpineCandidates || [],
    forwardSpineOverlaps: output?.forwardSpineOverlaps || [],
    forwardSpineConflicts: output?.forwardSpineConflicts || [],
    forwardSpineDecisions: output?.forwardSpineDecisions || [],
    findings: output?.findings || []
  };
}

function sameCleaningConfig(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function attachDatasetIndexes(dataset) {
  dataset.scenarioProduct = dataset.scenarioProduct || dataset.targetProduct;
  dataset.rawPointById = new Map((dataset.model?.points || [])
    .map((point) => [point.rawPointId, point]));
  dataset.targetTrackPointById = new Map((dataset.targetProduct?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.scenarioTrackPointById = new Map((dataset.scenarioProduct?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.rawDecisionById = buildRawDecisionIndex(dataset.targetProduct);
  if (dataset.scenarioPolygonProduct !== dataset.scenarioProduct) {
    dataset.scenarioPolygonFeatures = buildScenarioPolygonFeatures(dataset);
    dataset.scenarioPolygonProduct = dataset.scenarioProduct;
  }
  dataset.mapRender = buildMapRenderIndexes(dataset);
}

function currentCleaningConfig() {
  return scenarioRepairConfigFromIds(state.enabledScenarioRepairIds);
}

function fullScenarioConfig() {
  return fullScenarioRepairConfig();
}

function rebuildDatasetWithCleaningConfig(dataset, config) {
  const targetProduct = buildSixLayerTrackProduct(dataset.model, { config });
  dataset.targetProduct = targetProduct;
  dataset.targetOutput = compactTargetOutput(buildTargetOutput(dataset.model, targetProduct));
  attachDatasetIndexes(dataset);
  return dataset;
}

async function rebuildDatasetWithCleaningConfigInWorker(dataset, config) {
  if (!window.Worker) {
    return rebuildDatasetWithCleaningConfig(dataset, config);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./importWorker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker.terminate();
      const message = event.data || {};
      if (!message.ok) {
        reject(new Error(message.error?.message || '后台重算失败'));
        return;
      }
      resolve(finalizeRebuiltDataset(dataset, message.result));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || '后台重算失败'));
    };
    worker.postMessage({
      mode: 'rebuild',
      fileName: dataset.fileName,
      filePath: dataset.filePath,
      model: dataset.model,
      config
    });
  });
}

function finalizeRebuiltDataset(dataset, result) {
  const nextDataset = {
    ...dataset,
    model: result.model || dataset.model,
    scenarioProduct: dataset.scenarioProduct || result.scenarioProduct || result.targetProduct,
    targetProduct: result.targetProduct,
    targetOutput: result.targetOutput
  };
  attachDatasetIndexes(nextDataset);
  return nextDataset;
}

function snapshotDatasetProduct(dataset) {
  return {
    id: dataset.id,
    fileName: dataset.fileName,
    targetProduct: dataset.targetProduct
  };
}

function buildRawDecisionIndex(targetProduct) {
  const decisions = new Map();
  for (const point of targetProduct?.track || []) {
    if (Number.isFinite(point.sourceRawPointId)) {
      decisions.set(point.sourceRawPointId, {
        ...point,
        kind: point.result,
        source: 'targetProduct.track'
      });
    }
  }
  for (const point of targetProduct?.track || []) {
    for (const rawPointId of point.contributingRawPointIds || []) {
      if (!Number.isFinite(rawPointId) || decisions.has(rawPointId)) continue;
      decisions.set(rawPointId, {
        ...point,
        kind: point.result,
        source: 'targetProduct.track.contributingRawPointIds'
      });
    }
  }
  for (const point of targetProduct?.excluded?.weak || []) {
    decisions.set(point.rawPointId, {
      ...point,
      kind: 'weak',
      source: 'targetProduct.excluded.weak'
    });
  }
  for (const point of targetProduct?.excluded?.rejected || []) {
    decisions.set(point.rawPointId, {
      ...point,
      kind: 'reject',
      source: 'targetProduct.excluded.rejected'
    });
  }
  for (const point of targetProduct?.excluded?.intakeRejected || []) {
    decisions.set(point.rawPointId, {
      ...point,
      kind: 'intake_rejected',
      source: 'targetProduct.excluded.intakeRejected'
    });
  }
  return decisions;
}

function buildMapRenderIndexes(dataset) {
  const rawPoints = dataset.model?.points || [];
  const track = dataset.targetProduct?.track || [];
  return {
    rawLinePointIds: sampleIds(rawPoints, MAP_LINE_POINT_LIMIT, 'rawPointId'),
    rawPointIds: sampleIds(rawPoints, MAP_RAW_POINT_LIMIT, 'rawPointId'),
    cleanedLineTrackPointIds: sampleIds(track, MAP_LINE_POINT_LIMIT, 'trackPointId'),
    cleanedPointTrackPointIds: sampleIds(track, MAP_TRACK_POINT_LIMIT, 'trackPointId')
  };
}

function sampleIds(points, limit, idField, extraIds = new Set()) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length <= limit) {
    return points.map((point) => point[idField]).filter(Number.isFinite);
  }
  const ids = [];
  const seen = new Set();
  for (const id of extraIds) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
  }
  const sampleLimit = Math.max(2, limit - ids.length);
  const lastIndex = points.length - 1;
  for (let sampleIndex = 0; sampleIndex < sampleLimit; sampleIndex++) {
    const pointIndex = Math.round((sampleIndex / Math.max(sampleLimit - 1, 1)) * lastIndex);
    const id = points[pointIndex]?.[idField];
    if (!Number.isFinite(id) || seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

function clearAll() {
  state.datasets = [];
  state.selectedDatasetId = null;
  state.selectedPoint = null;
  state.scenarioReviewRangeText = '';
  state.lastScenarioRepairImpact = null;
  elements.folderInput.value = '';
  elements.fileInput.value = '';
  elements.scenarioRangeInput.value = '';
  setImportText('等待导入 evidence.jsonl');
  if (state.popup) state.popup.remove();
  render();
  renderMap();
}

function applyScenarioRangeReview() {
  state.scenarioReviewRangeText = elements.scenarioRangeInput.value.trim();
  renderScenarioRangeReview();
}

function setImportText(text) {
  elements.importText.textContent = text;
}

function setLoading(loading, text = null) {
  elements.importStatus.classList.toggle('loading', loading);
  elements.importStatus.setAttribute('aria-busy', loading ? 'true' : 'false');
  for (const element of [
    elements.folderInput,
    elements.fileInput,
    elements.fitBoundsButton,
    elements.clearButton,
    elements.scenarioRepairSummary
  ]) {
    element.disabled = loading;
  }
  for (const label of document.querySelectorAll('.file-button')) {
    label.classList.toggle('disabled', loading);
  }
  for (const input of elements.scenarioRepairOptions
    .querySelectorAll('input[type="checkbox"]')) {
    input.disabled = loading;
  }
  if (text !== null) {
    setImportText(text);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function render() {
  renderScenarioRepairOptions();
  renderScenarioRangeReview();
  renderPointDetails();
  renderCleaningAlgorithm();
  renderMap();
}

function renderScenarioRepairOptions() {
  state.enabledScenarioRepairIds = enabledScenarioRepairIds(state.enabledScenarioRepairIds);
  const selectedIds = new Set(state.enabledScenarioRepairIds);
  const summary = scenarioRepairSummary(state.enabledScenarioRepairIds);
  elements.scenarioRepairSummary.textContent = `修复 ${summary}`;
  if (elements.cleaningConfigState) {
    elements.cleaningConfigState.textContent = summary;
  }
  elements.scenarioRepairOptions.innerHTML = SCENARIO_REPAIR_OPTIONS
    .map((option) =>
      scenarioRepairOptionMarkup(option.id, option.label, selectedIds.has(option.id), option.kind))
    .join('');
}

function scenarioRepairOptionMarkup(id, label, checked, kind) {
  const kindLabel = kind === 'diagnostic' ? '标注' : '改线';
  return `
    <label class="scenario-repair-option option-menu-option" data-repair-kind="${escapeHtml(kind)}">
      <input
        type="checkbox"
        value="${escapeHtml(id)}"
        ${checked ? 'checked' : ''}
      />
      <span>${escapeHtml(label)}<small>${escapeHtml(kindLabel)}</small></span>
    </label>
  `;
}

async function handleScenarioRepairChange(event) {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  state.enabledScenarioRepairIds = Array.from(elements.scenarioRepairOptions
    .querySelectorAll('input[type="checkbox"]:checked'))
    .map((checkbox) => checkbox.value);
  await applyScenarioRepairConfig();
}

async function applyScenarioRepairConfig() {
  state.enabledScenarioRepairIds = enabledScenarioRepairIds(state.enabledScenarioRepairIds);
  if (state.datasets.length === 0) {
    state.lastScenarioRepairImpact = null;
    render();
    return;
  }
  const generation = ++state.scenarioRepairApplyGeneration;
  const config = currentCleaningConfig();
  const summary = scenarioRepairSummary(state.enabledScenarioRepairIds);
  setLoading(true, `正在应用情景修复：${summary}`);
  await nextFrame();
  try {
    const beforeDatasets = state.datasets.map(snapshotDatasetProduct);
    const nextDatasets = [];
    for (let index = 0; index < state.datasets.length; index++) {
      if (generation !== state.scenarioRepairApplyGeneration) return;
      const dataset = state.datasets[index];
      setLoading(true,
        `正在应用情景修复：${summary} (${index + 1}/${state.datasets.length})`);
      nextDatasets.push(await rebuildDatasetWithCleaningConfigInWorker(dataset, config));
      await nextFrame();
    }
    if (generation !== state.scenarioRepairApplyGeneration) return;
    state.datasets = nextDatasets;
    state.lastScenarioRepairImpact = summarizeScenarioRepairImpact(beforeDatasets,
      state.datasets, summary);
    state.selectedPoint = null;
    setImportText(scenarioRepairImpactMessage(state.lastScenarioRepairImpact));
    render();
  } finally {
    if (generation === state.scenarioRepairApplyGeneration) {
      setLoading(false);
    }
  }
}

function renderScenarioRangeReview() {
  const dataset = selectedDataset();
  const rangeText = state.scenarioReviewRangeText;
  elements.scenarioRangeState.textContent = rangeText || '-';
  if (!dataset) {
    elements.scenarioRangeReview.innerHTML =
      '<p class="empty-note">导入 evidence.jsonl 后复核清洗点区间</p>';
    return;
  }
  if (!rangeText) {
    elements.scenarioRangeReview.innerHTML =
      '<p class="empty-note">清洗点范围格式示例：1836-1919</p>';
    return;
  }
  const parsed = parseScenarioRangeText(rangeText);
  if (!parsed) {
    elements.scenarioRangeReview.innerHTML =
      '<p class="empty-note">无法识别清洗点范围</p>';
    return;
  }
  const review = reviewTrackPointScenarioCoverage(dataset.targetProduct,
    parsed.startTrackPointId, parsed.endTrackPointId);
  review.denseIntentConflicts = denseIntentConflictsForRawRange(dataset, review.rawRange);
  elements.scenarioRangeState.textContent =
    `#${review.requestedTrackPointRange.startTrackPointId}-${review.requestedTrackPointRange.endTrackPointId}`;
  elements.scenarioRangeReview.innerHTML = scenarioRangeReviewMarkup(review);
}

function parseScenarioRangeText(text) {
  const normalized = String(text || '').replace(/#/g, '').trim();
  if (!normalized) return null;
  const rangeMatch = normalized.match(/^(\d+)\s*(?:-|~|,|，|至|到|\s+)\s*(\d+)$/);
  if (rangeMatch) {
    return {
      startTrackPointId: Number(rangeMatch[1]),
      endTrackPointId: Number(rangeMatch[2])
    };
  }
  const singleMatch = normalized.match(/^(\d+)$/);
  if (singleMatch) {
    const trackPointId = Number(singleMatch[1]);
    return { startTrackPointId: trackPointId, endTrackPointId: trackPointId };
  }
  return null;
}

function scenarioRangeReviewMarkup(review) {
  if (!review.valid) {
    return '<p class="empty-note">清洗点范围无效</p>';
  }
  const overviewRows = [
    `清洗点 ${review.requestedTrackPointRange.startTrackPointId}-${review.requestedTrackPointRange.endTrackPointId}`,
    `点数 ${review.trackPointCount}`,
    formatScenarioRawRange(review.rawRange),
    `主解释 ${formatScenarioNames(review.primaryScenarios)}`,
    `关联情景 ${formatScenarioNames(review.contextScenarios)}`
  ];
  const hitMarkup = review.scenarioCoverage.length > 0
    ? scenarioHitListMarkup(review.scenarioCoverage, true)
    : '<p class="empty-note">该清洗点区间没有命中稳定情景</p>';
  const conflictMarkup = review.denseIntentConflicts?.length > 0
    ? denseIntentConflictListMarkup(review.denseIntentConflicts)
    : '<p class="empty-note">该清洗点区间没有 dense intent conflict</p>';
  return [
    summaryBlock('区间概览', overviewRows),
    `<section class="summary-block scenario-hit-block">
      <h3>命中情景</h3>
      ${hitMarkup}
    </section>`,
    `<section class="summary-block scenario-hit-block">
      <h3>密集区冲突</h3>
      ${conflictMarkup}
    </section>`
  ].join('');
}

function denseIntentConflictsForRawRange(dataset, rawRange) {
  const start = rawRange?.startRawPointId;
  const end = rawRange?.endRawPointId;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return (dataset?.targetOutput?.denseIntentConflicts || [])
    .filter((conflict) => rawRangesOverlap(conflict.rawRange, rawRange));
}

function rawRangesOverlap(left, right) {
  return Number.isFinite(left?.startRawPointId)
    && Number.isFinite(left?.endRawPointId)
    && Number.isFinite(right?.startRawPointId)
    && Number.isFinite(right?.endRawPointId)
    && left.startRawPointId <= right.endRawPointId
    && right.startRawPointId <= left.endRawPointId;
}

function denseIntentConflictListMarkup(conflicts) {
  return `
    <div class="scenario-hit-list">
      ${conflicts.map((conflict) => denseIntentConflictMarkup(conflict)).join('')}
    </div>
  `;
}

function denseIntentConflictOverviewMarkup(dataset) {
  const conflicts = dataset?.targetOutput?.denseIntentConflicts || [];
  const forwardSpineConflicts = dataset?.targetOutput?.forwardSpineConflicts || [];
  const blocks = [];
  if (conflicts.length > 0) {
    blocks.push(denseIntentConflictListMarkup(conflicts.slice(0, 12)));
  }
  if (forwardSpineConflicts.length > 0) {
    blocks.push(forwardSpineConflictListMarkup(forwardSpineConflicts.slice(0, 12)));
  }
  return blocks.length > 0
    ? blocks.join('')
    : '<span>当前没有密集区主意图冲突</span>';
}

function denseIntentConflictMarkup(conflict) {
  const intentText = humanDenseIntentList(conflict.denseAreaIntents);
  const scenarioText = scenarioNameLabel(conflict.scenario);
  const handlingText = humanConflictResolution(conflict.resolution);
  return `
    <button
      class="scenario-hit conflict-hit"
      type="button"
      data-conflict-start-raw="${escapeHtml(String(conflict.rawRange?.startRawPointId ?? ''))}"
      data-conflict-end-raw="${escapeHtml(String(conflict.rawRange?.endRawPointId ?? ''))}"
    >
      <div class="scenario-hit-title">
        <strong>${escapeHtml(formatScenarioRawRange(conflict.rawRange))}</strong>
        <span>${escapeHtml(handlingText)}</span>
      </div>
      <div class="scenario-hit-meta">
        <span>粗判 ${escapeHtml(intentText)}</span>
        <span>局部 ${escapeHtml(scenarioText)}</span>
        <span>点击定位地图</span>
      </div>
      <p>${escapeHtml(`这段密集点云整体像在前进，但局部轨迹更像拍照/休息时的小范围挪动，所以按局部休息微移动处理。`)}</p>
      <div class="conflict-evidence">
        <span>路径 ${escapeHtml(formatMeters(conflict.pathMeters))}</span>
        <span>首尾净距 ${escapeHtml(formatMeters(conflict.netDistanceMeters))}</span>
        <span>范围 ${escapeHtml(formatMeters(conflict.bboxDiagonalMeters))}</span>
        <span>低速比例 ${escapeHtml(formatRatio(conflict.lowSpeedRatio))}</span>
      </div>
      <p class="scenario-hit-action">${escapeHtml(humanConflictAction(conflict))}</p>
    </button>
  `;
}

function humanDenseIntentList(intents) {
  if (!Array.isArray(intents) || intents.length === 0) return '-';
  return intents.map((intent) => ({
    forward_motion: '主前进',
    stationary: '停留',
    round_trip: '往返',
    gap_cluster: '遮挡/GAP 聚集',
    mixed: '混合'
  })[intent] || intent).join('、');
}

function humanConflictResolution(resolution) {
  if (resolution === 'prefer_local_rest_photo_micro_move') return '按局部休息处理';
  return resolution || '已处理';
}

function humanConflictAction(conflict) {
  if (conflict.action === 'collapse_micro_move_to_rest_anchor') {
    return '处理结果：塌成一个休息锚点，不累计这段抖动距离。';
  }
  if (conflict.action === 'simplify_micro_move_shape') {
    return '处理结果：保留少量微移动锚点，删除多余折返。';
  }
  return `处理结果：${conflict.action || '-'}；${conflict.localRebuild || '-'}`;
}

function forwardSpineConflictListMarkup(conflicts) {
  return `
    <div class="scenario-hit-list">
      ${conflicts.map((conflict) => forwardSpineConflictMarkup(conflict)).join('')}
    </div>
  `;
}

function forwardSpineConflictMarkup(conflict) {
  return `
    <button
      class="scenario-hit conflict-hit"
      type="button"
      data-conflict-start-raw="${escapeHtml(String(conflict.rawRange?.startRawPointId ?? ''))}"
      data-conflict-end-raw="${escapeHtml(String(conflict.rawRange?.endRawPointId ?? ''))}"
    >
      <div class="scenario-hit-title">
        <strong>${escapeHtml(formatScenarioRawRange(conflict.rawRange))}</strong>
        <span>${escapeHtml(humanForwardSpineResolution(conflict.resolution))}</span>
      </div>
      <div class="scenario-hit-meta">
        <span>V17 保方向仲裁</span>
        <span>${escapeHtml(humanForwardSpineConflict(conflict.conflict))}</span>
        <span>点击定位地图</span>
      </div>
      <p>${escapeHtml(humanForwardSpineConflictSummary(conflict))}</p>
      ${forwardSpineEvidenceMarkup(conflict)}
      <p class="scenario-hit-action">${escapeHtml('处理结果：先复盘，不改变当前清洗轨迹。')}</p>
    </button>
  `;
}

function forwardSpineEvidenceMarkup(conflict) {
  const evidence = conflict.evidence || {};
  const cells = [
    ['路径', formatMeters(Number(evidence.pathMeters))],
    ['首尾净距', formatMeters(Number(evidence.netDistanceMeters))],
    ['范围', formatMeters(Number(evidence.bboxDiagonalMeters))],
    ['候选', (conflict.candidateIds || []).join('、') || '-']
  ];
  return `
    <div class="conflict-evidence">
      ${cells.map(([label, value]) =>
    `<span>${escapeHtml(label)} ${escapeHtml(value)}</span>`).join('')}
    </div>
  `;
}

function humanForwardSpineConflict(conflict) {
  return ({
    overlapping_forward_spine_candidates: '同向保方向重叠',
    nested_forward_spine_candidate: '保方向包含',
    crossing_forward_spine_candidates: '保方向交叉',
    endpoint_touch_forward_spine_candidates: '端点相接',
    local_micro_move_overrides_forward_spine: '局部微移动 vs 主前进'
  })[conflict] || conflict || '-';
}

function humanForwardSpineResolution(resolution) {
  return ({
    review_merge_or_select_same_direction: '复盘合并/择优',
    review_downgrade_nested_candidate: '复盘降级短候选',
    review_split_before_active: '复盘切段',
    review_keep_endpoint: '保留端点复盘',
    review_forward_spine_preferred: '倾向主前进复盘'
  })[resolution] || resolution || '复盘';
}

function humanForwardSpineConflictSummary(conflict) {
  if (conflict.conflict === 'local_micro_move_overrides_forward_spine') {
    return '这段局部形态像休息/拍照微移动，但它夹在主前进/回环骨架内；V17 先按保方向候选冲突复盘，不再直接当作休息覆盖 forward。';
  }
  if (conflict.conflict === 'endpoint_touch_forward_spine_candidates') {
    return '两个保方向候选只在端点附近相接；端点应保留，两侧是否合并需要看前后方向和真实语义。';
  }
  if (conflict.conflict === 'nested_forward_spine_candidate') {
    return '一个短保方向候选落在长候选内部；默认短候选降级为解释，除非它能避开局部漂移。';
  }
  if (conflict.conflict === 'crossing_forward_spine_candidates') {
    return '保方向候选在空间上交叉，但交点不等于真实路线点；需要按 raw 时间轴切段后仲裁。';
  }
  return '多个保方向候选覆盖同一 raw 子区间；V17 会先复盘候选关系，再决定合并、择优或降级。';
}

function handleScenarioRangeReviewClick(event) {
  const button = event.target.closest('[data-conflict-start-raw][data-conflict-end-raw]');
  if (!button) return;
  const startRawPointId = Number(button.dataset.conflictStartRaw);
  const endRawPointId = Number(button.dataset.conflictEndRaw);
  focusDenseIntentConflict(startRawPointId, endRawPointId);
}

function focusDenseIntentConflict(startRawPointId, endRawPointId, datasetId = null) {
  const dataset = datasetId
    ? state.datasets.find((item) => item.id === datasetId)
    : selectedDataset();
  if (!dataset || !Number.isFinite(startRawPointId) || !Number.isFinite(endRawPointId)) {
    return;
  }
  state.selectedDatasetId = dataset.id;
  const rawRange = {
    startRawPointId: Math.min(startRawPointId, endRawPointId),
    endRawPointId: Math.max(startRawPointId, endRawPointId)
  };
  const trackRange = trackPointRangeTouchingRawRange(dataset, rawRange);
  if (trackRange) {
    state.scenarioReviewRangeText =
      `${trackRange.startTrackPointId}-${trackRange.endTrackPointId}`;
    elements.scenarioRangeInput.value = state.scenarioReviewRangeText;
    renderScenarioRangeReview();
  }
  const bounds = rawRangeBounds(dataset, rawRange);
  if (bounds) fitBounds(bounds);
}

function trackPointRangeTouchingRawRange(dataset, rawRange) {
  const points = (dataset.targetProduct?.track || [])
    .filter((point) => trackPointTouchesRawRange(point, rawRange));
  if (points.length === 0) return null;
  return {
    startTrackPointId: Math.min(...points.map((point) => point.trackPointId)),
    endTrackPointId: Math.max(...points.map((point) => point.trackPointId))
  };
}

function trackPointTouchesRawRange(point, rawRange) {
  if (point.sourceRawPointId >= rawRange.startRawPointId
      && point.sourceRawPointId <= rawRange.endRawPointId) {
    return true;
  }
  return (point.contributingRawPointIds || []).some((rawPointId) =>
    rawPointId >= rawRange.startRawPointId && rawPointId <= rawRange.endRawPointId);
}

function rawRangeBounds(dataset, rawRange) {
  const points = (dataset.model?.points || [])
    .filter((point) =>
      point.rawPointId >= rawRange.startRawPointId
      && point.rawPointId <= rawRange.endRawPointId
      && hasValidLngLat(point));
  return boundsForPoints(points);
}

function boundsForPoints(points) {
  if (!points.length) return null;
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

function scenarioHitListMarkup(items, useMatchedRange = false, limit = Infinity) {
  return `
    <div class="scenario-hit-list">
      ${items.slice(0, limit).map((item) => scenarioHitMarkup(item, useMatchedRange)).join('')}
    </div>
  `;
}

function scenarioHitMarkup(item, useMatchedRange) {
  const trackRange = useMatchedRange
    ? formatMatchedScenarioTrackCoverage(item)
    : formatScenarioTrackCoverage(item);
  const action = item.actionLabel || item.action || '-';
  const rebuild = item.localRebuildLabel || item.localRebuild || '-';
  return `
    <article class="scenario-hit">
      <div class="scenario-hit-title">
        <strong>${escapeHtml(item.scenarioLabel || item.scenario || '-')}</strong>
        <span>${escapeHtml(`#${item.scenarioId} ${item.scenario || ''}`)}</span>
      </div>
      <div class="scenario-hit-meta">
        <span>${escapeHtml(trackRange)}</span>
        <span>${escapeHtml(formatScenarioRawCoverage(item))}</span>
        <span>主解释点 ${escapeHtml(String(item.primaryTrackPointCount || 0))}</span>
        <span>关联点 ${escapeHtml(String(item.contextTrackPointCount || 0))}</span>
      </div>
      <p>${escapeHtml(item.summary || '-')}</p>
      <p class="scenario-hit-action">${escapeHtml(action)}；${escapeHtml(rebuild)}</p>
    </article>
  `;
}

function formatScenarioNames(names) {
  if (!Array.isArray(names) || names.length === 0) return '-';
  return names.map(scenarioNameLabel).join('、');
}

function scenarioNameLabel(name) {
  const labels = {
    weak_recovery_endpoint: '弱信号端点保留',
    same_road_round_trip: '同路往返交织',
    closed_loop_round_trip: '闭合往返/回环',
    round_trip_line: '往返线形',
    enclosed_gap_cluster: '山洞/室内类遮挡聚集',
    stationary_session_collapse: '整段静止压缩',
    stationary_drift_collapse: '停留漂移压缩',
    rest_photo_micro_move: '拍照/休息微移动',
    gap_recovery_boundary: 'GAP 恢复边界',
    transport_contamination: '交通工具混入'
  };
  return labels[name] || name || '-';
}

function formatMatchedScenarioTrackCoverage(item) {
  if (item?.continuousCoverage === true
      && Number.isFinite(item.matchedTrackPointRange?.startTrackPointId)
      && Number.isFinite(item.matchedTrackPointRange?.endTrackPointId)) {
    return `清洗#${item.matchedTrackPointRange.startTrackPointId}-${item.matchedTrackPointRange.endTrackPointId}`;
  }
  const ids = item?.matchedTrackPointIds || [];
  if (ids.length > 0) {
    return `清洗点 ${formatIdPreview(ids)}`;
  }
  return '清洗#-';
}

function formatIdPreview(ids, limit = 6) {
  const visible = ids.slice(0, limit).join(', ');
  return ids.length > limit ? `${visible} ... +${ids.length - limit}` : visible;
}

function summaryBlock(title, rows) {
  return `
    <section class="summary-block">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
    </section>
  `;
}

function renderCleaningAlgorithm() {
  elements.cleaningAlgorithm.innerHTML = algorithmBlock();
}

function algorithmBlock() {
  const dataset = selectedDataset();
  return `
    <section class="summary-block algorithm-block">
      <h3>情景覆盖总览</h3>
      <div class="algorithm-section">
        <b>情景覆盖</b>
        ${scenarioCoverageSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>密集区调度</b>
        ${denseIntentSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>冲突详情</b>
        ${denseIntentConflictOverviewMarkup(dataset)}
      </div>
    </section>
  `;
}

function scenarioRepairImpactRows(impact) {
  if (!impact) {
    return ['本次影响 导入样本或勾选修复后显示清洗线、点数和统计变化'];
  }
  const changedText = impact.changedDatasetCount > 0
    ? `改线 ${impact.changedDatasetCount}/${impact.datasetCount} 个文件`
    : `未改线 ${impact.datasetCount} 个文件`;
  return [
    `本次影响 ${changedText}；清洗点 ${formatSignedCount(impact.delta.trustedPointCount)}；运动里程 ${formatSignedMeters(impact.delta.totalDistanceMeters)}；地图连线 ${formatSignedMeters(impact.delta.routeDistanceMeters)}；运动耗时 ${formatSignedDuration(impact.delta.movingTimeSeconds)}`,
    impact.examples.length > 0
      ? `变化示例 ${impact.examples.join('；')}`
      : '说明 当前样本未命中被切换的改线修复，或只切换了诊断标注项；地图线不会发生肉眼变化'
  ];
}

function summarizeScenarioRepairImpact(beforeDatasets, afterDatasets, summary) {
  const beforeById = new Map(beforeDatasets.map((dataset) => [dataset.id, dataset]));
  const delta = {
    trustedPointCount: 0,
    routeDistanceMeters: 0,
    totalDistanceMeters: 0,
    movingTimeSeconds: 0,
    scenarioCount: 0
  };
  const examples = [];
  let changedDatasetCount = 0;
  for (const after of afterDatasets) {
    const before = beforeById.get(after.id);
    const beforeProduct = before?.targetProduct || {};
    const afterProduct = after.targetProduct || {};
    const itemDelta = productDelta(beforeProduct, afterProduct);
    for (const key of Object.keys(delta)) {
      delta[key] += itemDelta[key] || 0;
    }
    const trackChanged = trackSignature(beforeProduct.track)
      !== trackSignature(afterProduct.track);
    if (trackChanged) {
      changedDatasetCount++;
      if (examples.length < 3) {
        examples.push(`${after.fileName} 清洗点 ${formatSignedCount(itemDelta.trustedPointCount)} / 运动里程 ${formatSignedMeters(itemDelta.totalDistanceMeters)}`);
      }
    }
  }
  return {
    summary,
    datasetCount: afterDatasets.length,
    changedDatasetCount,
    delta: Object.fromEntries(Object.entries(delta)
      .map(([key, value]) => [key, normalizeTinyDelta(value)])),
    examples
  };
}

function normalizeTinyDelta(value) {
  return Math.abs(value) < 0.000001 ? 0 : value;
}

function productDelta(beforeProduct, afterProduct) {
  const beforeStats = beforeProduct?.stats || {};
  const afterStats = afterProduct?.stats || {};
  return {
    trustedPointCount: numberOrZero(afterStats.trustedPointCount)
      - numberOrZero(beforeStats.trustedPointCount),
    routeDistanceMeters: numberOrZero(afterStats.routeDistanceMeters)
      - numberOrZero(beforeStats.routeDistanceMeters),
    totalDistanceMeters: numberOrZero(afterStats.totalDistanceMeters)
      - numberOrZero(beforeStats.totalDistanceMeters),
    movingTimeSeconds: numberOrZero(afterStats.movingTimeSeconds)
      - numberOrZero(beforeStats.movingTimeSeconds),
    scenarioCount: numberOrZero(afterProduct?.scenarios?.length)
      - numberOrZero(beforeProduct?.scenarios?.length)
  };
}

function trackSignature(track = []) {
  return (track || []).map((point) => [
    point.trackPointId,
    point.sourceRawPointId,
    point.result,
    point.reason,
    point.segmentId,
    roundSignatureNumber(point.lat, 7),
    roundSignatureNumber(point.lng, 7),
    roundSignatureNumber(point.distanceDeltaMeters, 2),
    roundSignatureNumber(point.movingTimeDeltaSeconds, 2)
  ].join(':')).join('|');
}

function roundSignatureNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}

function scenarioRepairImpactMessage(impact) {
  if (!impact) return '已重算情景修复';
  const changedText = impact.changedDatasetCount > 0
    ? `改线 ${impact.changedDatasetCount}/${impact.datasetCount}`
    : `未改线 ${impact.datasetCount}/${impact.datasetCount}`;
  return `已按“${impact.summary}”重算：${changedText}，运动里程 ${formatSignedMeters(impact.delta.totalDistanceMeters)}，清洗点 ${formatSignedCount(impact.delta.trustedPointCount)}`;
}

function scenarioCoverageSummaryRows(dataset) {
  const coverage = dataset?.scenarioProduct?.scenarioCoverage || [];
  if (coverage.length === 0) {
    return ['导入 evidence.jsonl 后显示全量情景覆盖的清洗点区间和 raw 区间'];
  }
  const scenarioNames = [...new Set(coverage.map((item) => item.scenario))];
  const rows = [
    `情景覆盖 ${coverage.length} 段；类型 ${formatScenarioNames(scenarioNames)}`
  ];
  for (const item of coverage.slice(0, 8)) {
    rows.push(`${item.scenarioLabel || scenarioLabel(item)}：${formatScenarioTrackCoverage(item)} / ${formatScenarioRawCoverage(item)}；主解释点 ${item.primaryTrackPointCount}，关联点 ${item.contextTrackPointCount}；${item.summary || '-'}`);
  }
  if (coverage.length > 8) {
    rows.push(`还有 ${coverage.length - 8} 段情景覆盖未展开，可点击对应清洗点查看关联情景`);
  }
  return rows;
}

function denseIntentSummaryRows(dataset) {
  if (!dataset) {
    return ['导入 evidence.jsonl 后显示密集区主意图、处理计划和冲突区间'];
  }
  const conflicts = dataset.targetOutput?.denseIntentConflicts || [];
  const forwardSpineConflicts = dataset.targetOutput?.forwardSpineConflicts || [];
  const forwardSpineOverlaps = dataset.targetOutput?.forwardSpineOverlaps || [];
  const plan = dataset.targetOutput?.denseAreaSettlementPlan || [];
  const rows = [];
  if (conflicts.length > 0) {
    rows.push(`冲突 ${conflicts.length} 段：橙色粗线已标在地图上，可点击定位`);
  } else {
    rows.push('冲突 0 段');
  }
  rows.push(`V17 保方向上图冲突 ${forwardSpineConflicts.length} 段；候选关系 ${forwardSpineOverlaps.length} 段仅作内部证据`);
  if (plan.length > 0) {
    rows.push(`处理计划 ${plan.length} 段`);
    for (const item of plan.slice(0, 5)) {
      rows.push(`${formatScenarioRawRange(item.rawRange)} ${humanDenseIntentList([item.intent])} -> ${humanDenseSettlement(item.plannedSettlement)}；命中 ${humanScenarioList(item.observedScenarios)}`);
    }
    if (plan.length > 5) {
      rows.push(`还有 ${plan.length - 5} 段处理计划未展开`);
    }
  } else {
    rows.push('处理计划 0 段');
  }
  return rows;
}

function humanDenseSettlement(settlement) {
  return ({
    keep_forward_spine: '保主前进线',
    collapse_stationary_drift: '塌缩静止漂移',
    collapse_rest_photo_micro_move: '塌缩休息微移动',
    simplify_round_trip: '简化往返线',
    isolate_gap_cluster: '隔离遮挡聚集',
    mixed_local_rebuild: '局部混合重建'
  })[settlement] || settlement || '-';
}

function humanScenarioList(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return '-';
  return scenarios.map((scenario) => scenarioNameLabel(scenario)).join('、');
}

function scenarioLabel(item) {
  return `#${item.scenarioId} ${item.scenario}`;
}

function formatScenarioTrackCoverage(item) {
  if (item?.continuousCoverage === true
      && Number.isFinite(item.trackPointRange?.startTrackPointId)
      && Number.isFinite(item.trackPointRange?.endTrackPointId)) {
    return `清洗#${item.trackPointRange.startTrackPointId}-${item.trackPointRange.endTrackPointId}`;
  }
  const ids = item?.trackPointIds || [];
  if (ids.length > 0) {
    const visible = ids.slice(0, 6).join(', ');
    const suffix = ids.length > 6 ? ` ... +${ids.length - 6}` : '';
    return `清洗点 ${visible}${suffix}`;
  }
  return '清洗#-';
}

function formatScenarioRawRange(range) {
  if (Number.isFinite(range?.startRawPointId) && Number.isFinite(range?.endRawPointId)) {
    return `Raw#${range.startRawPointId}-${range.endRawPointId}`;
  }
  return 'Raw#-';
}

function formatScenarioRawCoverage(item) {
  if (item?.continuousCoverage === false) {
    const ids = uniqueNumbers([
      ...(item.rawPointIds || []),
      ...(item.anchorRawPointIds || []),
      ...(item.evidence?.rawPointIds || []),
      ...(item.evidence?.keptRawPointIds || []),
      ...(item.evidence?.weakRawPointIds || []),
      ...(item.evidence?.rejectedRawPointIds || [])
    ]);
    if (ids.length > 0) return `Raw点 ${formatIdPreview(ids)}`;
  }
  return formatScenarioRawRange(item?.rawRange);
}

function uniqueNumbers(values) {
  return [...new Set((values || []).filter(Number.isFinite))]
    .sort((left, right) => left - right);
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function formatSignedMeters(value) {
  if (!Number.isFinite(value)) return '-';
  if (Object.is(value, -0) || value === 0) return formatMeters(0);
  return `${value > 0 ? '+' : '-'}${formatMeters(Math.abs(value))}`;
}

function formatSignedCount(value) {
  if (!Number.isFinite(value)) return '-';
  if (Object.is(value, -0) || value === 0) return '0';
  return `${value > 0 ? '+' : ''}${formatPlainNumber(value)}`;
}

function formatSignedDuration(value) {
  if (!Number.isFinite(value)) return '-';
  if (Object.is(value, -0) || value === 0) return formatDuration(0);
  return `${value > 0 ? '+' : '-'}${formatDuration(Math.abs(value))}`;
}

function ascentBreakdown(dataset) {
  const stats = dataset?.targetProduct?.stats || {};
  return {
    barometer: {
      totalMeters: stats.barometerTotalAscentMeters,
      sampleCount: stats.barometerAscentSampleCount,
      rejectedSampleCount: stats.barometerAscentRejectedSampleCount
    },
    locationAltitude: {
      totalMeters: stats.locationAltitudeTotalAscentMeters,
      sampleCount: stats.locationAltitudeAscentSampleCount,
      rejectedSampleCount: stats.locationAltitudeAscentRejectedSampleCount
    }
  };
}

function ascentSummaryRows(dataset) {
  const ascent = ascentBreakdown(dataset);
  return [
    `气压累计爬升 ${formatAscent(ascent.barometer.totalMeters)}（样本 ${formatPlainNumber(ascent.barometer.sampleCount || 0)}，拒绝 ${formatPlainNumber(ascent.barometer.rejectedSampleCount || 0)}）`,
    `Location海拔累计爬升 ${formatAscent(ascent.locationAltitude.totalMeters)}（样本 ${formatPlainNumber(ascent.locationAltitude.sampleCount || 0)}，拒绝 ${formatPlainNumber(ascent.locationAltitude.rejectedSampleCount || 0)}）`
  ];
}

function renderPointDetails() {
  const selection = state.selectedPoint;
  elements.selectedPointText.textContent = selection
    ? `${selection.dataset.fileName} #${selection.cleaned ? selection.point.trackPointId : selection.point.rawPointId}`
    : '-';
  if (!selection) {
    elements.pointDetails.innerHTML = '<p class="empty-note">点击地图点查看 raw 证据或 Web 清洗点详情</p>';
    return;
  }
  elements.pointDetails.innerHTML = selection.cleaned
    ? cleanedPointDetailsMarkup(selection.dataset, selection.point)
    : pointDetailsMarkup(selection.dataset, selection.point);
}

function cleanedPointDetailsMarkup(dataset, point) {
  const explanationRows = explanationDetailRows(point.primaryExplanation, point.primitiveFacts);
  const scenarioRows = scenarioContextDetailRows(point.scenarioContexts,
    point.primaryExplanation);
  return `
    ${detailBlock('清洗点', [
      `trackPointId ${point.trackPointId}`,
      `sourceRawPointId ${point.sourceRawPointId}`,
      `recomputedDecisionId ${point.recomputedDecisionId}`,
      `result ${point.result}`,
      `reason ${point.reason}`,
      `coordinateSource ${point.coordinateSource || '-'}`,
      `lat/lng ${formatLatLng(point)}`,
      `segmentId ${point.segmentId}`,
      `distanceDelta ${formatMeters(point.distanceDeltaMeters)}`,
      `movingTimeDelta ${formatDuration(point.movingTimeDeltaSeconds)}`
    ])}
    ${explanationRows.length > 0 ? detailBlock('主解释', explanationRows) : ''}
    ${scenarioRows.length > 0 ? detailBlock('关联情景', scenarioRows) : ''}
    ${detailBlock('点云证据', [
      `cloudType ${point.cloudType || '-'}`,
      `cloudId ${valueOrDash(point.cloudId)}`,
      `cloudSampleCount ${valueOrDash(point.cloudSampleCount)}`,
      `cloudWeightSum ${formatOneDecimal(point.cloudWeightSum)}`,
      `cloudWeightedRadius ${formatMeters(point.cloudWeightedRadiusMeters)}`,
      `representativeRawPointId ${valueOrDash(point.representativeRawPointId)}`
    ])}
	    ${detailBlock('清洗轨迹状态', [
      `参数 ${dataset.targetProduct.usesDefaultConfig ? '默认' : '自定义'}`,
      `静止压缩 ${dataset.targetProduct.stationarySessionCollapsed ? '已触发' : '未触发'}`,
      `目标总点数 ${dataset.targetProduct.stats.trustedPointCount}`,
      `里程 ${formatMeters(dataset.targetProduct.stats.routeDistanceMeters)}`,
      `运动里程 ${formatMeters(dataset.targetProduct.stats.totalDistanceMeters)}`,
      `疑似交通里程 ${formatMeters(dataset.targetProduct.stats.suspectedDistanceMeters)}`,
      ...ascentSummaryRows(dataset)
	    ])}
	  `;
}

function pointDetailsMarkup(dataset, point) {
  const recomputedDecision = rawPointDecision(dataset, point);
  const decision = recomputedDecision || point.decision || {};
  const context = point.diagnosticContext || {};
  const explanationRows = explanationDetailRows(decision.primaryExplanation,
    decision.primitiveFacts);
  const scenarioRows = scenarioContextDetailRows(decision.scenarioContexts,
    decision.primaryExplanation);
  return `
    ${detailBlock('raw 字段', [
      `rawPointId ${point.rawPointId}`,
      `provider ${point.provider || '-'}`,
      `lat/lng ${formatLatLng(point)}`,
      `accuracy ${formatMeters(point.accuracy)}`,
      `altitude ${formatMeters(point.altitude)}`,
      `speed ${formatSpeed(point.speed)}`,
      `elapsedRealtime ${formatNanos(point.elapsedRealtimeNanos)}`
    ])}
    ${detailBlock('上一可信点关系', [
      `上一可信 Raw#${valueOrDash(context.previousTrustedRawPointId)}`,
      `距离 ${formatMeters(context.distanceFromPreviousTrustedMeters)}`,
      `时间差 ${formatDuration(context.deltaSecondsFromPreviousTrusted)}`,
      `推算速度 ${formatSpeed(context.requiredSpeedMetersPerSecond)}`,
      `distanceDelta ${formatMeters(decision.distanceDeltaMeters)}`,
      `movingTimeDelta ${formatDuration(decision.movingTimeDeltaSeconds)}`
    ])}
    ${!recomputedDecision && point.insights?.length
      ? detailBlock('解释', point.insights.map((item) => item.text))
      : ''}
	    ${decision.result ? detailBlock('Web 复算解释', [
      `result ${decision.result}`,
      `reason ${decision.reason || '-'}`,
      `source ${decision.source || 'targetProduct'}`,
      `segmentId ${valueOrDash(decision.segmentId)}`,
      `cloudType ${decision.cloudType || '-'}`,
      `distanceDelta ${formatMeters(decision.distanceDeltaMeters)}`,
      `movingTimeDelta ${formatDuration(decision.movingTimeDeltaSeconds)}`
		    ]) : ''}
		    ${explanationRows.length > 0 ? detailBlock('主解释', explanationRows) : ''}
		    ${scenarioRows.length > 0 ? detailBlock('关联情景', scenarioRows) : ''}
		  `;
}

function detailBlock(title, rows) {
  return `
    <section class="detail-block">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
    </section>
  `;
}

function explanationDetailRows(explanation, primitiveFacts = []) {
  if (!explanation) return [];
  const rows = [];
  if (explanation.source === 'scenario') {
    rows.push(`场景 ${explanation.scenarioLabel || scenarioNameLabel(explanation.scenario)}`);
    rows.push(`动作 ${explanation.actionLabel || explanation.action || '-'} / ${explanation.localRebuildLabel || explanation.localRebuild || '-'}`);
    rows.push(`说明 ${explanation.summary || '-'}`);
    const range = explanation.rawRange;
    if (Number.isFinite(range?.startRawPointId) && Number.isFinite(range?.endRawPointId)) {
      rows.push(`覆盖 Raw#${range.startRawPointId}-${range.endRawPointId}`);
    }
  } else {
    rows.push(`基础事实 ${explanation.reason || '-'}`);
    rows.push(`说明 ${explanation.summary || '-'}`);
  }
  if (primitiveFacts.length > 0) {
    rows.push(`primitive ${primitiveFacts.slice(0, 8).join(', ')}`);
  }
  return rows;
}

function scenarioContextDetailRows(contexts = [], primaryExplanation = null) {
  if (!Array.isArray(contexts) || contexts.length === 0) return [];
  const primaryScenarioId = primaryExplanation?.source === 'scenario'
    ? primaryExplanation.scenarioId
    : null;
  return contexts.map((context) => {
    const marker = context.scenarioId === primaryScenarioId ? '主' : '关联';
    const range = context.rawRange;
    const rawRange = Number.isFinite(range?.startRawPointId)
      && Number.isFinite(range?.endRawPointId)
      ? `Raw#${range.startRawPointId}-${range.endRawPointId}`
      : 'Raw#-';
    return `${marker} ${context.scenarioLabel || scenarioNameLabel(context.scenario)} ${rawRange}；${context.summary || context.localRebuildLabel || context.localRebuild || '-'}`;
  });
}

function buildMapStyle() {
  setupContourDemSource();
  const sources = {
    googleSatellite: {
      type: 'raster',
      tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
      tileSize: 256,
      attribution: 'Imagery © Google'
    },
    terrainElevation: terrainDemRasterSource(),
    terrainHillshade: terrainDemRasterSource()
  };
  const layers = [
    { id: 'google-satellite', type: 'raster', source: 'googleSatellite' },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrainHillshade',
      layout: { visibility: 'none' },
      paint: {
        'hillshade-exaggeration': 0.72,
        'hillshade-shadow-color': 'rgba(0, 0, 0, 0.56)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.22)',
        'hillshade-accent-color': 'rgba(45, 212, 191, 0.12)'
      }
    }
  ];
  if (state.contoursAvailable) {
    sources.terrainContours = terrainContourSource();
    layers.push(...terrainContourLayers());
  }
  return {
    version: 8,
    sources,
    layers
  };
}

function setupContourDemSource() {
  state.contoursAvailable = false;
  state.contourDemSource = null;
  if (!window.mlcontour?.DemSource) return;
  try {
    state.contourDemSource = new window.mlcontour.DemSource({
      url: TERRAIN_TILE_TEMPLATE,
      encoding: 'terrarium',
      maxzoom: TERRAIN_DEM_MAX_ZOOM,
      cacheSize: 80,
      worker: true,
      timeoutMs: 12_000
    });
    state.contourDemSource.setupMaplibre(maplibregl);
    state.contoursAvailable = true;
  } catch (error) {
    console.warn('等高线 DEM 协议初始化失败', error);
  }
}

function terrainDemRasterSource() {
  if (!state.contourDemSource) {
    return { type: 'raster-dem', url: TERRAIN_TILEJSON_URL };
  }
  return {
    type: 'raster-dem',
    tiles: [state.contourDemSource.sharedDemProtocolUrl],
    encoding: 'terrarium',
    tileSize: TERRAIN_TILE_SIZE,
    maxzoom: TERRAIN_DEM_MAX_ZOOM,
    attribution: "<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>"
  };
}

function terrainContourSource() {
  return {
    type: 'vector',
    tiles: [state.contourDemSource.contourProtocolUrl({
      thresholds: CONTOUR_THRESHOLDS_METERS,
      elevationKey: 'ele',
      levelKey: 'level',
      contourLayer: 'contours',
      overzoom: 1,
      subsampleBelow: 512
    })],
    maxzoom: 15,
    attribution: "<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>"
  };
}

function terrainContourLayers() {
  return [
    {
      id: 'terrain-contours-minor',
      type: 'line',
      source: 'terrainContours',
      'source-layer': 'contours',
      minzoom: 10,
      filter: ['==', ['get', 'level'], 0],
      layout: { visibility: 'visible' },
      paint: {
        'line-color': 'rgba(255, 244, 194, 0.68)',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.45,
          14, 0.85,
          18, 1.35
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.36,
          13, 0.56,
          18, 0.72
        ]
      }
    },
    {
      id: 'terrain-contours-major',
      type: 'line',
      source: 'terrainContours',
      'source-layer': 'contours',
      minzoom: 10,
      filter: ['>', ['get', 'level'], 0],
      layout: { visibility: 'visible' },
      paint: {
        'line-color': 'rgba(255, 255, 224, 0.88)',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.95,
          14, 1.55,
          18, 2.2
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          10, 0.52,
          13, 0.74,
          18, 0.9
        ]
      }
    },
    contourLabelLayer({
      id: 'terrain-contour-major-labels',
      minzoom: 10,
      filter: ['>', ['get', 'level'], 0],
      textColor: '#fff7c2',
      haloWidth: 1.6,
      textSizeStops: [10, 11.5, 14, 13, 18, 15],
      allowOverlap: true
    }),
    contourLabelLayer({
      id: 'terrain-contour-minor-labels',
      minzoom: 14,
      filter: ['==', ['get', 'level'], 0],
      textColor: 'rgba(255, 244, 194, 0.76)',
      haloWidth: 1.2,
      textSizeStops: [14, 10, 17, 11.5, 20, 13],
      allowOverlap: false
    })
  ];
}

function contourLabelLayer({
  id,
  minzoom,
  filter,
  textColor,
  haloWidth,
  textSizeStops,
  allowOverlap
}) {
  return {
    id,
    type: 'symbol',
    source: 'terrainContours',
    'source-layer': 'contours',
    minzoom,
    filter,
    layout: {
      visibility: 'visible',
      'symbol-placement': 'line',
      'symbol-spacing': [
        'interpolate', ['linear'], ['zoom'],
        10, 240,
        12, 190,
        14, 150,
        16, 112,
        18, 82,
        20, 60
      ],
      'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
      'text-font': [
        'Arial',
        'Helvetica Neue',
        'PingFang SC',
        'Microsoft YaHei',
        'Noto Sans CJK SC',
        'sans-serif'
      ],
      'text-size': ['interpolate', ['linear'], ['zoom'], ...textSizeStops],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map',
      'text-keep-upright': true,
      'text-max-angle': 180,
      'text-padding': 0,
      'text-allow-overlap': allowOverlap,
      'text-ignore-placement': allowOverlap
    },
    paint: {
      'text-color': textColor,
      'text-halo-color': 'rgba(2, 8, 10, 0.88)',
      'text-halo-width': haloWidth,
      'text-opacity': [
        'interpolate', ['linear'], ['zoom'],
        minzoom, 0.72,
        minzoom + 2, 0.94
      ]
    }
  };
}

function initMap() {
  if (!window.maplibregl) {
    elements.mapView.innerHTML = '<div class="map-fallback">MapLibre 加载失败，请检查网络</div>';
    return;
  }
  state.map = new maplibregl.Map({
    container: elements.mapView,
    center: [104.06, 30.65],
    zoom: 12,
    maxZoom: 21,
    maxPitch: 85,
    style: buildMapStyle()
  });
  renderContourControlState();
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  state.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '320px' });
  state.map.on('load', () => {
    state.mapLoaded = true;
    renderTerrain();
    renderContours();
    renderContourDataPanel();
    addMapLayers();
    bindMapEvents();
    renderMap();
  });
  state.map.on('zoomend', () => {
    renderContourDataPanel();
  });
}

function renderTerrain() {
  if (!state.mapLoaded) return;
  const enabled = elements.showTerrain.checked;
  if (state.map.getLayer('terrain-hillshade')) {
    state.map.setLayoutProperty('terrain-hillshade', 'visibility', enabled ? 'visible' : 'none');
  }
  state.map.setTerrain(enabled
    ? { source: 'terrainElevation', exaggeration: TERRAIN_EXAGGERATION }
    : null);
}

function renderContourControlState() {
  elements.showContours.disabled = !state.contoursAvailable;
  const toggle = elements.showContours.closest('.toggle');
  if (toggle) {
    toggle.classList.toggle('disabled', !state.contoursAvailable);
    toggle.title = state.contoursAvailable
      ? '叠加由地形 DEM 生成的等高线'
      : '等高线插件未加载，当前只显示地形阴影';
  }
  renderContourDataPanel();
}

function renderContours() {
  if (!state.mapLoaded) return;
  const visibility = state.contoursAvailable && elements.showContours.checked ? 'visible' : 'none';
  for (const layerId of CONTOUR_LAYER_IDS) {
    if (state.map.getLayer(layerId)) {
      state.map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
  renderContourDataPanel();
}

function renderContourDataPanel() {
  if (!elements.contourDataPanel) return;
  const checked = elements.showContours.checked;
  elements.contourDataPanel.classList.toggle('disabled', !state.contoursAvailable || !checked);
  if (!state.contoursAvailable) {
    elements.contourDataStatus.textContent = '等高线插件未加载';
    elements.contourDataSelected.textContent = '当前只能显示地形阴影';
    return;
  }
  const zoom = state.mapLoaded ? state.map.getZoom() : 12;
  const threshold = contourThresholdForZoom(zoom);
  const statusPrefix = checked ? '已显示' : '已隐藏';
  elements.contourDataStatus.textContent =
    `${statusPrefix} | DEM Mapterhorn | zoom ${zoom.toFixed(1)} | 次曲线 ${threshold.minor}m / 主曲线 ${threshold.major}m`;
  if (!state.selectedContour) {
    elements.contourDataSelected.textContent = '点击等高线查看该线海拔、级别和经纬度';
    return;
  }
  const contour = state.selectedContour;
  elements.contourDataSelected.textContent =
    `${contour.lineType} ${formatPlainNumber(contour.elevationMeters)}m | 间距 ${contour.intervalMeters}m | ${formatLngLatText(contour.lng, contour.lat)}`;
}

function contourThresholdForZoom(zoom) {
  const zoomLevel = Math.floor(Number.isFinite(zoom) ? zoom : 12);
  let selected = null;
  for (const [key, value] of Object.entries(CONTOUR_THRESHOLDS_METERS)
    .map(([key, value]) => [Number(key), value])
    .sort((left, right) => left[0] - right[0])) {
    if (key <= zoomLevel) selected = value;
  }
  const fallback = selected || Object.values(CONTOUR_THRESHOLDS_METERS)[0];
  return {
    minor: Array.isArray(fallback) ? fallback[0] : fallback,
    major: Array.isArray(fallback) ? fallback[fallback.length - 1] : fallback
  };
}

function contourIntervalForLevel(level, zoom) {
  const threshold = contourThresholdForZoom(zoom);
  return level > 0 ? threshold.major : threshold.minor;
}

function addMapLayers() {
  ensureDirectionArrowImage();
  state.map.addSource('scenario-polygons', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('raw-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('trusted-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('dense-intent-conflicts', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('forward-spine-conflicts', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('direction-arrows', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-points', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('points', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addLayer({
    id: 'scenario-polygons-fill',
    type: 'fill',
    source: 'scenario-polygons',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.18,
        15, 0.25,
        20, 0.32
      ]
    }
  });
  state.map.addLayer({
    id: 'scenario-polygons-outline',
    type: 'line',
    source: 'scenario-polygons',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 1.1,
        15, 1.9,
        20, 3
      ],
      'line-opacity': 0.88,
      'line-dasharray': [2, 1]
    }
  });
  state.map.addLayer({
    id: 'raw-lines',
    type: 'line',
    source: 'raw-lines',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2,
      'line-opacity': 0.62,
      'line-dasharray': [1.4, 2.2]
    }
  });
  state.map.addLayer({
    id: 'trusted-lines',
    type: 'line',
    source: 'trusted-lines',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 5,
      'line-opacity': 0.95
    }
  });
  state.map.addLayer({
    id: 'cleaned-lines',
    type: 'line',
    source: 'cleaned-lines',
    paint: {
      'line-color': ['coalesce', ['get', 'lineColor'], '#ef4444'],
      'line-width': ['coalesce', ['get', 'lineWidth'], 4],
      'line-opacity': ['coalesce', ['get', 'lineOpacity'], 0.95]
    }
  });
  state.map.addLayer({
    id: 'dense-intent-conflicts',
    type: 'line',
    source: 'dense-intent-conflicts',
    paint: {
      'line-color': '#f97316',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 4,
        15, 7,
        20, 11
      ],
      'line-opacity': 0.96,
      'line-blur': 0.4
    }
  });
  state.map.addLayer({
    id: 'forward-spine-conflicts',
    type: 'line',
    source: 'forward-spine-conflicts',
    paint: {
      'line-color': '#a855f7',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 3,
        15, 6,
        20, 10
      ],
      'line-opacity': 0.92,
      'line-blur': 0.25,
      'line-dasharray': [1.4, 0.8]
    }
  });
  state.map.addLayer({
    id: 'scenario-polygons-labels',
    type: 'symbol',
    source: 'scenario-polygons',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [
        'Arial',
        'Helvetica Neue',
        'PingFang SC',
        'Microsoft YaHei',
        'Noto Sans CJK SC',
        'sans-serif'
      ],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        10, 10,
        15, 12,
        20, 14
      ],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 3
    },
    paint: {
      'text-color': '#f8fafc',
      'text-halo-color': 'rgba(2, 8, 10, 0.9)',
      'text-halo-width': 1.5,
      'text-opacity': 0.96
    }
  });
  state.map.addLayer({
    id: 'direction-arrows',
    type: 'symbol',
    source: 'direction-arrows',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': [
        'interpolate', ['linear'], ['zoom'],
        10, 150,
        12, 120,
        14, 92,
        16, 66,
        18, 42,
        20, 28,
        22, 20
      ],
      'icon-image': 'direction-arrow-icon',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-keep-upright': false,
      'icon-rotation-alignment': 'map',
      'icon-size': ['case', ['==', ['get', 'kind'], 'raw'], 0.46, 0.56],
      'icon-rotate': 0
    },
    paint: {
      'icon-opacity': 0.98
    }
  });
  state.map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-color': [
        'case',
        ['==', ['get', 'kind'], 'weak'], '#facc15',
        ['==', ['get', 'kind'], 'reject'], '#fb7185',
        ['==', ['get', 'kind'], 'intake_rejected'], '#fb7185',
        ['==', ['get', 'kind'], 'raw'], '#94a3b8',
        ['get', 'color']
      ],
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], true], 7,
        ['==', ['get', 'kind'], 'raw'], 3,
        4.5
      ],
      'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#ffffff', '#111827'],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 3, 1],
      'circle-opacity': 0.96
    }
  });
  state.map.addLayer({
    id: 'cleaned-points',
    type: 'circle',
    source: 'cleaned-points',
    paint: {
      'circle-color': '#ef4444',
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], true], 8,
        5.5
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 3, 1.5],
      'circle-opacity': 0.98
    }
  });
}

function ensureDirectionArrowImage() {
  if (state.map.hasImage('direction-arrow-icon')) return;
  const size = 44;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.lineJoin = 'round';
  context.lineCap = 'round';

  context.beginPath();
  context.moveTo(39, 22);
  context.lineTo(9, 36);
  context.lineTo(16, 22);
  context.lineTo(9, 8);
  context.closePath();
  context.fillStyle = '#02080a';
  context.strokeStyle = '#02080a';
  context.lineWidth = 6;
  context.stroke();
  context.fill();

  context.beginPath();
  context.moveTo(37, 22);
  context.lineTo(11, 34);
  context.lineTo(17, 22);
  context.lineTo(11, 10);
  context.closePath();
  context.fillStyle = '#f8fafc';
  context.strokeStyle = '#f8fafc';
  context.lineWidth = 2;
  context.stroke();
  context.fill();

  state.map.addImage('direction-arrow-icon', context.getImageData(0, 0, size, size), {
    pixelRatio: 2
  });
}

function bindMapEvents() {
  state.map.on('click', 'points', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectPoint(String(feature.properties.datasetId), Number(feature.properties.rawPointId), true);
  });
  state.map.on('click', 'cleaned-points', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectCleanedPoint(String(feature.properties.datasetId),
      Number(feature.properties.trackPointId), true);
  });
  state.map.on('click', 'scenario-polygons-fill', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectScenarioPolygon(feature, event.lngLat);
  });
  state.map.on('click', 'dense-intent-conflicts', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectDenseIntentConflict(feature, event.lngLat);
  });
  state.map.on('click', 'forward-spine-conflicts', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectForwardSpineConflict(feature, event.lngLat);
  });
  for (const layerId of CONTOUR_LINE_LAYER_IDS) {
    if (!state.map.getLayer(layerId)) continue;
    state.map.on('click', layerId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      selectContourLine(feature, event.lngLat);
    });
    state.map.on('mouseenter', layerId, () => {
      state.map.getCanvas().style.cursor = 'pointer';
    });
    state.map.on('mouseleave', layerId, () => {
      state.map.getCanvas().style.cursor = '';
    });
  }
  state.map.on('mouseenter', 'points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'cleaned-points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'scenario-polygons-fill', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'dense-intent-conflicts', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'forward-spine-conflicts', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'cleaned-points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'scenario-polygons-fill', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'dense-intent-conflicts', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'forward-spine-conflicts', () => {
    state.map.getCanvas().style.cursor = '';
  });
}

function renderMap() {
  if (!state.mapLoaded) return;
  const visible = state.datasets.filter((dataset) => dataset.visible);
  state.map.getSource('scenario-polygons').setData(scenarioPolygonFeatureCollection(visible));
  state.map.getSource('raw-lines').setData(elements.showRaw.checked ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(elements.showTrusted.checked ? trustedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('cleaned-lines').setData(elements.showCleaned.checked ? cleanedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('dense-intent-conflicts').setData(denseIntentConflictFeatureCollection(visible));
  state.map.getSource('forward-spine-conflicts').setData(forwardSpineConflictFeatureCollection(visible));
  renderDirectionArrows(visible);
  state.map.getSource('cleaned-points').setData(
    elements.showCleaned.checked && elements.showCleanedPoints.checked
      ? cleanedPointFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('points').setData(elements.showPoints.checked ? pointFeatureCollection(visible) : emptyFeatureCollection());
}

function renderDirectionArrows(visibleDatasets = null) {
  if (!state.mapLoaded) return;
  const source = state.map.getSource('direction-arrows');
  if (!source) return;
  const visible = visibleDatasets || state.datasets.filter((dataset) => dataset.visible);
  source.setData(elements.showDirection.checked
    ? directionArrowFeatureCollection(visible)
    : emptyFeatureCollection());
}

function rawFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets
      .map((dataset) => lineFeature(dataset,
        pointsFromIds(dataset.rawPointById, dataset.mapRender?.rawLinePointIds), 'raw'))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function trustedFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) =>
      dataset.model.segments
        .filter((segment) => segment.points.length > 1)
        .map((segment) => lineFeature(dataset, segment.points, 'trusted', segment.segmentId)))
  };
}

function cleanedFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => buildCleanedLineFeatures(dataset,
      pointsFromIds(dataset.targetTrackPointById,
        dataset.mapRender?.cleanedLineTrackPointIds), {
        enabledScenarioRepairIds: state.enabledScenarioRepairIds
      }))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function scenarioPolygonFeatureCollection(datasets) {
  const features = datasets
    .flatMap((dataset) => dataset.scenarioPolygonFeatures || buildScenarioPolygonFeatures(dataset))
    .sort((left, right) =>
      (right.properties?.areaMeters2 || 0) - (left.properties?.areaMeters2 || 0));
  return { type: 'FeatureCollection', features };
}

function denseIntentConflictFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) =>
      (dataset.targetOutput?.denseIntentConflicts || [])
        .map((conflict, index) => denseIntentConflictFeature(dataset, conflict, index))
        .filter(Boolean))
  };
}

function denseIntentConflictFeature(dataset, conflict, index) {
  const points = rawPointsInRange(dataset, conflict.rawRange).filter(hasValidLngLat);
  if (points.length < 2) return null;
  return lineFeature(dataset, points, 'dense_intent_conflict', null, {
    conflictIndex: index,
    conflict: conflict.conflict,
    resolution: conflict.resolution,
    scenario: conflict.scenario,
    action: conflict.action,
    localRebuild: conflict.localRebuild,
    rawRange: formatScenarioRawRange(conflict.rawRange),
    startRawPointId: conflict.rawRange?.startRawPointId,
    endRawPointId: conflict.rawRange?.endRawPointId,
    pathMeters: conflict.pathMeters,
    netDistanceMeters: conflict.netDistanceMeters,
    bboxDiagonalMeters: conflict.bboxDiagonalMeters,
    lowSpeedRatio: conflict.lowSpeedRatio,
    denseAreaIntents: (conflict.denseAreaIntents || []).join('、')
  });
}

function forwardSpineConflictFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) =>
      (dataset.targetOutput?.forwardSpineConflicts || [])
        .map((conflict, index) => forwardSpineConflictFeature(dataset, conflict, index))
        .filter(Boolean))
  };
}

function forwardSpineConflictFeature(dataset, conflict, index) {
  const points = rawPointsInRange(dataset, conflict.rawRange).filter(hasValidLngLat);
  if (points.length < 2) return null;
  return lineFeature(dataset, points, 'forward_spine_conflict', null, {
    conflictIndex: index,
    conflict: conflict.conflict,
    resolution: conflict.resolution,
    relationship: conflict.relationship,
    rawRange: formatScenarioRawRange(conflict.rawRange),
    startRawPointId: conflict.rawRange?.startRawPointId,
    endRawPointId: conflict.rawRange?.endRawPointId,
    candidateIds: (conflict.candidateIds || []).join('、'),
    directionDeltaDegrees: conflict.directionDeltaDegrees,
    pathMeters: conflict.evidence?.pathMeters,
    netDistanceMeters: conflict.evidence?.netDistanceMeters,
    bboxDiagonalMeters: conflict.evidence?.bboxDiagonalMeters
  });
}

function directionArrowFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap(directionArrowFeaturesForDataset)
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function rawPointsInRange(dataset, rawRange) {
  const start = rawRange?.startRawPointId;
  const end = rawRange?.endRawPointId;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return (dataset.model?.points || []).filter((point) =>
    point.rawPointId >= start && point.rawPointId <= end);
}

function directionArrowFeaturesForDataset(dataset) {
  const lines = [];
  if (elements.showRaw.checked) {
    lines.push({
      kind: 'raw',
      points: pointsFromIds(dataset.rawPointById, dataset.mapRender?.rawLinePointIds)
    });
  }
  if (elements.showTrusted.checked) {
    for (const segment of dataset.model?.segments || []) {
      lines.push({
        kind: 'trusted',
        points: segment.points,
        segmentId: segment.segmentId
      });
    }
  }
  if (elements.showCleaned.checked) {
    lines.push({
      kind: 'cleaned',
      points: pointsFromIds(dataset.targetTrackPointById,
        dataset.mapRender?.cleanedLineTrackPointIds)
    });
  }

  const visibleLines = lines.filter((line) => (line.points || []).length > 1);
  if (visibleLines.length === 0) return [];
  return visibleLines.map((line) =>
    directionArrowLineFeature(dataset, line.points, line.kind, line.segmentId ?? null));
}

function directionArrowLineFeature(dataset, points, kind, segmentId) {
  const linePoints = points.length > MAP_LINE_POINT_LIMIT
    ? samplePointsForLine(points, MAP_LINE_POINT_LIMIT)
    : points;
  return {
    type: 'Feature',
    properties: { datasetId: dataset.id, kind, color: dataset.color, segmentId },
    geometry: { type: 'LineString', coordinates: linePoints.filter(hasValidLngLat).map(lngLat) }
  };
}

function pointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => mapRawPointsForDataset(dataset).map((point) => {
      const decision = rawPointDecision(dataset, point);
      return {
        type: 'Feature',
        properties: {
          datasetId: dataset.id,
          rawPointId: point.rawPointId,
          kind: decision?.kind || point.kind,
          result: decision?.result || point.decision?.result || '',
          reason: decision?.reason || point.decision?.reason || '',
          color: dataset.color,
          selected: state.selectedPoint?.dataset.id === dataset.id
            && state.selectedPoint?.point.rawPointId === point.rawPointId
        },
        geometry: { type: 'Point', coordinates: lngLat(point) }
      };
    }))
  };
}

function cleanedPointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => mapCleanedPointsForDataset(dataset).map((point) => ({
      type: 'Feature',
      properties: {
        datasetId: dataset.id,
        trackPointId: point.trackPointId,
        kind: 'cleaned',
        selected: state.selectedPoint?.dataset.id === dataset.id
          && state.selectedPoint?.cleaned === true
          && state.selectedPoint?.point.trackPointId === point.trackPointId
      },
      geometry: { type: 'Point', coordinates: lngLat(point) }
    })))
  };
}

function pointsFromIds(index, ids = []) {
  return ids.map((id) => index?.get(id)).filter(Boolean);
}

function mapRawPointsForDataset(dataset) {
  const ids = [...(dataset.mapRender?.rawPointIds || [])];
  const selectedRawPointId = state.selectedPoint?.dataset.id === dataset.id
    && state.selectedPoint?.cleaned !== true
    ? state.selectedPoint.point.rawPointId
    : null;
  if (Number.isFinite(selectedRawPointId) && !ids.includes(selectedRawPointId)) {
    ids.push(selectedRawPointId);
  }
  return pointsFromIds(dataset.rawPointById, ids);
}

function mapCleanedPointsForDataset(dataset) {
  const ids = [...(dataset.mapRender?.cleanedPointTrackPointIds || [])];
  const selectedTrackPointId = state.selectedPoint?.dataset.id === dataset.id
    && state.selectedPoint?.cleaned === true
    ? state.selectedPoint.point.trackPointId
    : null;
  if (Number.isFinite(selectedTrackPointId) && !ids.includes(selectedTrackPointId)) {
    ids.push(selectedTrackPointId);
  }
  return pointsFromIds(dataset.targetTrackPointById, ids);
}

function lineFeature(dataset, points, kind, segmentId = null, extraProperties = {}) {
  const linePoints = points.length > MAP_LINE_POINT_LIMIT
    ? samplePointsForLine(points, MAP_LINE_POINT_LIMIT)
    : points;
  return {
    type: 'Feature',
    properties: { datasetId: dataset.id, kind, color: dataset.color, segmentId, ...extraProperties },
    geometry: { type: 'LineString', coordinates: linePoints.map(lngLat) }
  };
}

function samplePointsForLine(points, limit) {
  if (!Array.isArray(points) || points.length <= limit) return points || [];
  const sampled = [];
  const lastIndex = points.length - 1;
  for (let sampleIndex = 0; sampleIndex < limit; sampleIndex++) {
    sampled.push(points[Math.round((sampleIndex / Math.max(limit - 1, 1)) * lastIndex)]);
  }
  return sampled;
}

function selectContourLine(feature, lngLat) {
  const elevationMeters = Number(feature.properties?.ele);
  const level = Number(feature.properties?.level);
  const zoom = state.mapLoaded ? state.map.getZoom() : 12;
  const lineType = level > 0 ? '主等高线' : '次等高线';
  const lng = Number(lngLat?.lng);
  const lat = Number(lngLat?.lat);
  state.selectedContour = {
    elevationMeters,
    level: Number.isFinite(level) ? level : 0,
    lineType,
    intervalMeters: contourIntervalForLevel(level, zoom),
    lng,
    lat
  };
  renderContourDataPanel();
  if (!state.popup) return;
  state.popup
    .setLngLat([lng, lat])
    .setHTML([
      '<strong>等高线数据</strong>',
      `${escapeHtml(lineType)} ${escapeHtml(formatPlainNumber(elevationMeters))} m`,
      `级别 ${escapeHtml(String(Number.isFinite(level) ? level : '-'))}；当前间距 ${escapeHtml(String(state.selectedContour.intervalMeters))} m`,
      escapeHtml(formatLngLatText(lng, lat)),
      '数据源 Mapterhorn DEM / 浏览器端 contour tile'
    ].join('<br/>'))
    .addTo(state.map);
}

function selectPoint(datasetId, rawPointId, showPopup = false) {
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.rawPointById?.get(rawPointId);
  if (!dataset || !point) return;
  state.selectedDatasetId = dataset.id;
  state.selectedPoint = { dataset, point, cleaned: false };
  if (showPopup && state.popup) {
    const decision = rawPointDecision(dataset, point) || point.decision || {};
    state.popup
      .setLngLat(lngLat(point))
      .setHTML(`<strong>${escapeHtml(dataset.fileName)}</strong><br/>Raw#${point.rawPointId} ${escapeHtml(decision.result || 'raw')}<br/>${escapeHtml(decision.reason || '-')}`)
      .addTo(state.map);
  }
  render();
}

function selectScenarioPolygon(feature, lngLat) {
  if (!state.popup) return;
  const properties = feature.properties || {};
  const regionIndex = Number(properties.regionIndex);
  const regionCount = Number(properties.regionCount);
  const regionText = Number.isFinite(regionIndex) && Number.isFinite(regionCount)
    && regionCount > 1
    ? `区域 ${regionIndex + 1}/${regionCount}`
    : '触发区域';
  const confidence = Number(properties.confidence);
  const areaMeters2 = Number(properties.areaMeters2);
  state.popup
    .setLngLat([lngLat.lng, lngLat.lat])
    .setHTML([
      `<strong>${escapeHtml(properties.fileName || '-')}</strong>`,
      `${escapeHtml(properties.label || properties.scenario || '-')} ${escapeHtml(regionText)}`,
      `情景 #${escapeHtml(String(properties.scenarioId || '-'))} ${escapeHtml(properties.scenario || '')}`,
      `清洗 ${escapeHtml(properties.trackCoverage || '-')} / ${escapeHtml(properties.rawRange || 'Raw#-')}`,
      `点数 ${escapeHtml(String(properties.pointCount || 0))}；面积 ${escapeHtml(formatAreaMeters2(areaMeters2))}`,
      Number.isFinite(confidence) ? `置信 ${escapeHtml(formatPercent(confidence))}` : null,
      properties.actionLabel || properties.localRebuildLabel
        ? `${escapeHtml(properties.actionLabel || '-')}；${escapeHtml(properties.localRebuildLabel || '-')}`
        : null,
      properties.summary ? escapeHtml(properties.summary) : null
    ].filter(Boolean).join('<br/>'))
    .addTo(state.map);
}

function focusRawPoint(datasetId, rawPointId) {
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.rawPointById?.get(rawPointId);
  if (!dataset || !point) return;
  selectPoint(dataset.id, rawPointId, true);
  if (state.mapLoaded) {
    state.map.easeTo({
      center: lngLat(point),
      zoom: Math.max(state.map.getZoom(), 18),
      duration: 320
    });
  }
}

function selectDenseIntentConflict(feature, lngLat) {
  const properties = feature.properties || {};
  const datasetId = String(properties.datasetId || '');
  const startRawPointId = Number(properties.startRawPointId);
  const endRawPointId = Number(properties.endRawPointId);
  focusDenseIntentConflict(startRawPointId, endRawPointId, datasetId);
  if (state.popup && lngLat) {
    state.popup
      .setLngLat(lngLat)
      .setHTML([
        `<strong>${escapeHtml(properties.conflict || 'dense_intent_conflict')}</strong>`,
        escapeHtml(properties.rawRange || 'Raw#-'),
        `intent ${escapeHtml(properties.denseAreaIntents || '-')}`,
        `resolution ${escapeHtml(properties.resolution || '-')}`,
        `path ${escapeHtml(formatMeters(Number(properties.pathMeters)))} / net ${escapeHtml(formatMeters(Number(properties.netDistanceMeters)))} / bbox ${escapeHtml(formatMeters(Number(properties.bboxDiagonalMeters)))}`
      ].join('<br/>'))
      .addTo(state.map);
  }
}

function selectForwardSpineConflict(feature, lngLat) {
  const properties = feature.properties || {};
  const datasetId = String(properties.datasetId || '');
  const startRawPointId = Number(properties.startRawPointId);
  const endRawPointId = Number(properties.endRawPointId);
  focusDenseIntentConflict(startRawPointId, endRawPointId, datasetId);
  if (state.popup && lngLat) {
    state.popup
      .setLngLat(lngLat)
      .setHTML([
        '<strong>V17 保方向仲裁</strong>',
        escapeHtml(properties.rawRange || 'Raw#-'),
        escapeHtml(humanForwardSpineConflict(properties.conflict)),
        `resolution ${escapeHtml(humanForwardSpineResolution(properties.resolution))}`,
        `candidates ${escapeHtml(properties.candidateIds || '-')}`,
        `path ${escapeHtml(formatMeters(Number(properties.pathMeters)))} / net ${escapeHtml(formatMeters(Number(properties.netDistanceMeters)))} / bbox ${escapeHtml(formatMeters(Number(properties.bboxDiagonalMeters)))}`
      ].join('<br/>'))
      .addTo(state.map);
  }
}

function rawPointDecision(dataset, point) {
  if (!dataset?.targetProduct || !point) return null;
  return dataset.rawDecisionById?.get(point.rawPointId) || null;
}

function selectCleanedPoint(datasetId, trackPointId, showPopup = false) {
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.targetTrackPointById?.get(trackPointId);
  if (!dataset || !point) return;
  state.selectedDatasetId = dataset.id;
  state.selectedPoint = { dataset, point, cleaned: true };
  if (showPopup && state.popup) {
    state.popup
      .setLngLat(lngLat(point))
      .setHTML(`<strong>${escapeHtml(dataset.fileName)}</strong><br/>清洗点#${point.trackPointId} ${escapeHtml(point.result)}<br/>${escapeHtml(point.reason)}`)
      .addTo(state.map);
  }
  render();
}

function focusDataset(dataset) {
  if (!dataset?.model.bounds || !state.mapLoaded) return;
  fitBounds(dataset.model.bounds);
}

function fitAllBounds() {
  if (!state.mapLoaded) return;
  const bounds = combinedBounds(state.datasets.filter((dataset) => dataset.visible));
  if (bounds) fitBounds(bounds);
}

function fitBounds(bounds) {
  state.map.fitBounds([[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]], {
    padding: 64,
    maxZoom: 20,
    duration: 280
  });
}

function combinedBounds(datasets) {
  const all = datasets.map((dataset) => dataset.model.bounds).filter(Boolean);
  if (all.length === 0) return null;
  return all.reduce((acc, bounds) => ({
    minLat: Math.min(acc.minLat, bounds.minLat),
    maxLat: Math.max(acc.maxLat, bounds.maxLat),
    minLng: Math.min(acc.minLng, bounds.minLng),
    maxLng: Math.max(acc.maxLng, bounds.maxLng)
  }), { ...all[0] });
}

function selectedDataset() {
  return state.datasets.find((dataset) => dataset.id === state.selectedDatasetId) || null;
}

function lngLat(point) {
  return [point.lng, point.lat];
}

function hasValidLngLat(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function formatMeters(value) {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${value.toFixed(1)} m`;
}

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function formatAreaMeters2(value) {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} km2`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)} ha`;
  return `${value.toFixed(0)} m2`;
}

function formatAscent(value) {
  return Number.isFinite(value) && value >= 0 ? `${value.toFixed(1)}m` : '证据不足';
}

function formatAscentSource(source) {
  if (source === 'LOCATION_ALTITUDE') return 'Location altitude';
  if (source === 'BAROMETER') return '气压计';
  if (source === 'NONE' || !source) return '无';
  return String(source);
}

function formatPace(value) {
  if (!Number.isFinite(value) || value <= 0) return '不可计算';
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, '0');
  return `${minutes}'${seconds}"/km`;
}

function paceSecondsPerKm(distanceMeters, movingTimeSeconds) {
  return distanceMeters > 0 && movingTimeSeconds > 0
    ? movingTimeSeconds / (distanceMeters / 1000)
    : null;
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : '-';
}

function formatOneDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
}

function formatPlainNumber(value) {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function formatBoolean(value) {
  return value === true ? '开启' : '关闭';
}

function formatNanos(value) {
  return Number.isFinite(value) ? `${(value / 1_000_000_000).toFixed(1)}s` : '-';
}

function formatNanoRange(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '-';
  return `${formatNanos(start)} - ${formatNanos(end)}`;
}

function formatLatLng(point) {
  return `${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`;
}

function formatLngLatText(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '经纬度 -';
  return `lat ${lat.toFixed(6)}, lng ${lng.toFixed(6)}`;
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
