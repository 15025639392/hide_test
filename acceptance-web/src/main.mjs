import {
  buildTargetOutput,
  formatDuration,
  isEvidenceCandidatePath,
  parseEvidenceJsonl,
  rawDecisionDisplayState
} from './diagnosticMap.mjs';
import { buildCleanedLineFeatures, cleanedRouteLinePoints } from './cleanedLineStyles.mjs';
import {
  buildSixLayerTrackProduct,
  buildStreamingTrackProduct,
  DEFAULT_SCENARIO_REPAIR_IDS,
  fullScenarioRepairConfig,
  reviewTrackPointScenarioCoverage
} from './track-cleaning/index.mjs';
import {
  buildScenarioPolygonFeatures
} from './scenarioPolygons.mjs';
import {
  buildReviewTasks,
  reviewerVisibleScenario,
  scenarioNameLabel,
  scenarioReviewLevel,
  sortScenarioCoverageForReview
} from './reviewQueue.mjs';

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
  rawReviewContext: null,
  focusedMapRange: null,
  currentProblemDrag: null,
  map: null,
  mapLoaded: false,
  contoursAvailable: false,
  contourDemSource: null,
  popup: null
};

const elements = {
  workspace: document.querySelector('.workspace'),
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  fitBoundsButton: document.querySelector('#fitBoundsButton'),
  clearButton: document.querySelector('#clearButton'),
  showRaw: document.querySelector('#showRaw'),
  showTrusted: document.querySelector('#showTrusted'),
  showCleaned: document.querySelector('#showCleaned'),
  showStreaming: document.querySelector('#showStreaming'),
  showDart: document.querySelector('#showDart'),
  showCpp: document.querySelector('#showCpp'),
  showScenarios: document.querySelector('#showScenarios'),
  showTerrain: document.querySelector('#showTerrain'),
  showContours: document.querySelector('#showContours'),
  showDirection: document.querySelector('#showDirection'),
  showCleanedPoints: document.querySelector('#showCleanedPoints'),
  showPoints: document.querySelector('#showPoints'),
  reviewDatasetState: document.querySelector('#reviewDatasetState'),
  reviewDatasetOverview: document.querySelector('#reviewDatasetOverview'),
  cleaningAlgorithm: document.querySelector('#cleaningAlgorithm'),
  cleaningConfigState: document.querySelector('#cleaningConfigState'),
  currentProblemPanel: document.querySelector('#currentProblemPanel'),
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
elements.currentProblemPanel.querySelector('.panel-title')
  .addEventListener('pointerdown', startCurrentProblemDrag);
elements.scenarioRangeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyScenarioRangeReview();
});
elements.reviewDatasetOverview.addEventListener('click', handleReviewDatasetClick);
// 两条原生引擎清洗线 —— 都由本地服务(packages/track_cleaning/bin/serve.dart)现算的对比图层。
// Dart/C++ 都没法在浏览器原生跑,故走 HTTP:fetch 是异步的,而图层渲染是同步的,所以用
// 「懒取 + 取回后重绘」:首次需要时发一次 fetch(用 'pending' 哨兵防重复),拿到点后写回
// dataset 并重新触发高亮层渲染。与 JS 流式线共用 lineFeature 渲染。
//
// **形态不同,别误读**:JS 流式线与 Dart 线走单发形态,C++ 线只能走分块形态(C ABI 唯一
// 形态)。契约 §9 chunk-invariance 不稳定——48 条金样本里 4 条两形态产物不同。所以
// C++ 线与另两条不重合时,先看是不是这 4 类轨迹,再怀疑移植。同形态下二者逐点一致
// (track_cleaning 仓 tool/dart_vs_cpp_diff.dart 全字段对拍 48/48)。
const NATIVE_ENGINE_ENDPOINT = 'http://localhost:8787/clean';

const NATIVE_ENGINE_LINES = [
  {
    key: 'dart',
    toggle: 'showDart',
    title: 'Dart 引擎线',
    shortLabel: 'Dart',
    form: '单发',
    query: '',
    sourceId: 'dart-lines',
    color: '#d946ef',
    rowClass: 'dart-stats-row',
    titleClass: 'dart-stats-title',
    lineField: 'dartLine',
    statsField: 'dartStats',
    derivedField: 'dartDerived',
    unavailableNote: '未获取(本地 Dart 服务未启动?)'
  },
  {
    key: 'cpp',
    toggle: 'showCpp',
    title: 'C++ core 线',
    shortLabel: 'C++',
    form: '分块',
    query: '?engine=cpp',
    sourceId: 'cpp-lines',
    color: '#22c55e',
    rowClass: 'cpp-stats-row',
    titleClass: 'cpp-stats-title',
    lineField: 'cppLine',
    statsField: 'cppStats',
    derivedField: 'cppDerived',
    unavailableNote: '未获取(服务未启动,或 core 未构建:bash core/build.sh)'
  }
];

elements.scenarioRangeReview.addEventListener('click', handleScenarioRangeReviewClick);
elements.cleaningAlgorithm.addEventListener('click', handleScenarioRangeReviewClick);
elements.showTerrain.addEventListener('change', renderTerrain);
elements.showContours.addEventListener('change', renderContours);
for (const input of [
  elements.showRaw,
  elements.showTrusted,
  elements.showCleaned,
  elements.showStreaming,
  elements.showDart,
  elements.showCpp,
  elements.showScenarios,
  elements.showDirection,
  elements.showCleanedPoints,
  elements.showPoints
]) {
  input.addEventListener('change', renderMap);
}
// 原生引擎线的成品指标显示在概览面板,勾选/取消时同步刷新那一行(renderMap 只重绘地图层)。
for (const spec of NATIVE_ENGINE_LINES) {
  elements[spec.toggle].addEventListener('change', renderReviewDatasetOverview);
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
    state.rawReviewContext = null;
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
  const result = await readEvidenceFileInWorker(file, filePath, fullScenarioConfig(),
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

// Streaming (device-reference) cleaning line for the WIP comparison overlay.
// Computed lazily (only when the 流式线 layer is enabled) and memoized on the
// dataset, so a normal import never pays the streaming-engine cost.
function buildStreamingLine(model, config) {
  try {
    const product = buildStreamingTrackProduct(model, { config });
    return (product.track || [])
      .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
      .map((point) => ({
        lat: point.lat,
        lng: point.lng,
        trackPointId: point.trackPointId,
        sourceRawPointId: point.sourceRawPointId
      }));
  } catch (error) {
    return [];
  }
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
    streamingLine: null, // lazily computed on first 流式线 render (see streamingFeatureCollection)
    // 两条原生引擎线(Dart / C++ core)均由本地服务现算,懒取——见 NATIVE_ENGINE_LINES。
    dartLine: null, // lazily fetched from local engine server on first Dart 引擎线 render
    dartStats: null, // Dart 引擎自算的成品指标(里程/耗时/爬升),与 dartLine 同一次 fetch 取回
    dartDerived: null, // Dart 派生展示指标(配速/平均速度/最高最低海拔),同一次 fetch 取回
    cppLine: null, // 同上,C++ core 线(?engine=cpp)
    cppStats: null,
    cppDerived: null,
    visible: true
  };
  attachDatasetIndexes(dataset);
  return dataset;
}

function compactTargetOutput(output) {
  return {
    selectedTotalAscentMeters: output?.selectedTotalAscentMeters ?? null,
    selectedTotalDescentMeters: output?.selectedTotalDescentMeters ?? null,
    selectedAscentSource: output?.selectedAscentSource || 'NONE',
    barometerTotalAscentMeters: output?.summaries?.pressure?.barometerTotalAscentMeters ?? null,
    barometerTotalDescentMeters:
      output?.summaries?.pressure?.barometerTotalDescentMeters ?? null,
    locationAltitudeTotalAscentMeters:
      output?.summaries?.pressure?.locationAltitudeTotalAscentMeters ?? null,
    locationAltitudeTotalDescentMeters:
      output?.summaries?.pressure?.locationAltitudeTotalDescentMeters ?? null,
    suspectedTransport: output?.summaries?.suspectedTransport || null,
    scenarioSettlementPlan: output?.scenarioSettlementPlan || null,
    streamingSettlementState: output?.streamingSettlementState || null,
    streamingDiagnosticContexts: output?.streamingDiagnosticContexts || null,
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

function fullScenarioConfig() {
  return fullScenarioRepairConfig();
}

function buildRawDecisionIndex(targetProduct) {
  const decisions = new Map();
  for (const decision of targetProduct?.rawPointDecisions || []) {
    if (!Number.isFinite(decision.rawPointId)) continue;
    const display = rawDecisionDisplayState(decision);
    decisions.set(decision.rawPointId, {
      ...decision,
      kind: display.result,
      result: display.result,
      reason: display.reason,
      source: 'targetProduct.rawPointDecisions'
    });
  }
  for (const point of targetProduct?.track || []) {
    if (decisions.has(point.sourceRawPointId)) continue;
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
  state.rawReviewContext = null;
  state.focusedMapRange = null;
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
  state.rawReviewContext = null;
  const parsed = parseScenarioRangeText(state.scenarioReviewRangeText);
  state.focusedMapRange = parsed
    ? focusedMapRangeFromTrackRange(selectedDataset(), parsed.startTrackPointId,
      parsed.endTrackPointId)
    : null;
  renderScenarioRangeReview();
  renderFocusedMap();
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
  ].filter(Boolean)) {
    element.disabled = loading;
  }
  for (const label of document.querySelectorAll('.file-button')) {
    label.classList.toggle('disabled', loading);
  }
  if (text !== null) {
    setImportText(text);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function render() {
  renderReviewDatasetOverview();
  renderScenarioRangeReview();
  renderPointDetails();
  renderCleaningAlgorithm();
  renderFocusedMap();
  renderMap();
}

function renderReviewDatasetOverview() {
  const dataset = selectedDataset();
  if (!state.datasets.length) {
    elements.reviewDatasetState.textContent = '等待导入';
    elements.reviewDatasetOverview.innerHTML = '<p class="empty-note">等待 evidence.jsonl</p>';
    return;
  }
  const selectedIndex = Math.max(0, state.datasets.findIndex((item) =>
    item.id === dataset?.id));
  elements.reviewDatasetState.textContent =
    `${selectedIndex + 1}/${state.datasets.length}`;
  elements.reviewDatasetOverview.innerHTML = [
    datasetSummaryMarkup(dataset),
    state.datasets.length > 1 ? datasetSwitchMarkup() : ''
  ].join('');
}

function datasetSummaryMarkup(dataset) {
  const stats = dataset?.targetProduct?.stats || {};
  const reviewIssueCount = buildReviewTasks(dataset).length;
  return `
    <section class="summary-block review-current-dataset">
      <h3>${escapeHtml(dataset?.fileName || '未选择样本')}</h3>
      <div class="metric-grid">
        ${metricCellMarkup('raw', formatPlainNumber(dataset?.model?.summary?.rawCount || 0))}
        ${metricCellMarkup('清洗点', formatPlainNumber(stats.trustedPointCount || 0))}
        ${metricCellMarkup('待复核', formatPlainNumber(reviewIssueCount))}
        ${metricCellMarkup('运动里程', formatMeters(stats.totalDistanceMeters))}
        ${metricCellMarkup('运动耗时', formatDuration(stats.movingTimeSeconds))}
        ${metricCellMarkup('累计爬升', formatAscent(stats.selectedTotalAscentMeters))}
        ${metricCellMarkup('疑似交通', suspectedTransportCountLabel(stats))}
        ${metricCellMarkup('疑似交通里程',
          formatMeters(stats.suspectedTransportDistanceMeters))}
        ${metricCellMarkup('疑似交通耗时',
          formatDuration(stats.suspectedTransportDurationSeconds))}
        ${metricCellMarkup('疑似交通均速',
          formatTransportSpeed(stats.suspectedTransportAverageSpeedMetersPerSecond))}
      </div>
      ${nativeStatsRowsMarkup(dataset)}
      <span>${escapeHtml(dataset?.filePath || '-')}</span>
    </section>
  `;
}

// 原生引擎线的成品指标行 —— 仅在勾选对应图层时显示,与上方 JS 成品指标同屏对拍。
// 数据随该线懒取:未取(null)、获取中('pending')、失败('error')、取回后为 stats 对象。
function nativeStatsRowMarkup(dataset, spec) {
  if (!mapElementVisible(elements[spec.toggle])) return '';
  const line = dataset?.[spec.lineField];
  const stats = dataset?.[spec.statsField];
  let body;
  if (line === 'pending') {
    body = '<span class="metric-note">获取中…</span>';
  } else if (stats === 'error' || (line !== null && stats == null)) {
    body = `<span class="metric-note">${escapeHtml(spec.unavailableNote)}</span>`;
  } else if (stats) {
    const derived = dataset[spec.derivedField] || {};
    const n = spec.shortLabel;
    body = `
      <div class="metric-grid">
        ${metricCellMarkup(`${n} 里程`, formatMeters(stats.totalDistanceMeters))}
        ${metricCellMarkup(`${n} 耗时`, formatDuration(stats.movingTimeSeconds))}
        ${metricCellMarkup(`${n} 活动时长`, formatDuration(derived.activeDurationSeconds))}
        ${metricCellMarkup(`${n} 爬升`, formatAscent(stats.selectedTotalAscentMeters))}
        ${metricCellMarkup(`${n} 配速`, formatPace(derived.paceSecondsPerKilometer))}
        ${metricCellMarkup(`${n} 均速`, formatTransportSpeed(derived.averageSpeedMetersPerSecond))}
        ${metricCellMarkup(`${n} 最高海拔`, formatAltitude(derived.maxAltitudeMeters))}
        ${metricCellMarkup(`${n} 最低海拔`, formatAltitude(derived.minAltitudeMeters))}
      </div>
    `;
  } else {
    body = '<span class="metric-note">获取中…</span>';
  }
  // 标题带形态:三条线形态并不相同(JS/Dart 单发、C++ 分块),指标对不上时先看这里。
  return `<div class="${spec.rowClass}"><small class="${spec.titleClass}">`
    + `${escapeHtml(spec.title)}<span class="engine-form-badge">${escapeHtml(spec.form)}</span>`
    + `</small>${body}</div>`;
}

function nativeStatsRowsMarkup(dataset) {
  return NATIVE_ENGINE_LINES.map((spec) => nativeStatsRowMarkup(dataset, spec)).join('');
}

function metricCellMarkup(label, value) {
  return `
    <span class="metric-cell">
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(label)}</small>
    </span>
  `;
}

function datasetSwitchMarkup() {
  return `
    <section class="summary-block dataset-switcher">
      <h3>样本列表</h3>
      <div class="dataset-switcher-list">
        ${state.datasets.map((dataset, index) => datasetSwitchButtonMarkup(dataset, index)).join('')}
      </div>
    </section>
  `;
}

function datasetSwitchButtonMarkup(dataset, index) {
  const selected = dataset.id === state.selectedDatasetId;
  const stats = dataset.targetProduct?.stats || {};
  const reviewIssueCount = buildReviewTasks(dataset).length;
  return `
    <button
      class="dataset-switch-button ${selected ? 'selected' : ''}"
      type="button"
      data-dataset-id="${escapeHtml(dataset.id)}"
    >
      <span class="dataset-switch-title">
        <b>${escapeHtml(`${index + 1}. ${dataset.fileName}`)}</b>
        <small>${escapeHtml(`${formatPlainNumber(reviewIssueCount)} 个待复核问题`)}</small>
      </span>
      <span class="dataset-switch-metrics">
        ${escapeHtml(formatMeters(stats.totalDistanceMeters))}
        · ${escapeHtml(formatDuration(stats.movingTimeSeconds))}
      </span>
    </button>
  `;
}

function handleReviewDatasetClick(event) {
  const button = event.target.closest('[data-dataset-id]');
  if (!button) return;
  const dataset = state.datasets.find((item) => item.id === button.dataset.datasetId);
  if (!dataset) return;
  state.selectedDatasetId = dataset.id;
  state.selectedPoint = null;
  state.scenarioReviewRangeText = '';
  state.rawReviewContext = null;
  state.focusedMapRange = null;
  elements.scenarioRangeInput.value = '';
  if (state.popup) state.popup.remove();
  render();
  focusDataset(dataset);
}

function renderScenarioRangeReview() {
  const dataset = selectedDataset();
  const rangeText = state.scenarioReviewRangeText;
  const rawContext = state.rawReviewContext;
  elements.workspace.classList.toggle('problem-active', Boolean(rangeText || rawContext));
  elements.scenarioRangeState.textContent = rawContext
    ? formatScenarioRawRange(rawContext.rawRange)
    : rangeText || '-';
  if (!dataset) {
    elements.scenarioRangeReview.innerHTML =
      '<p class="empty-note">等待 evidence.jsonl</p>';
    return;
  }
  if (rawContext) {
    elements.scenarioRangeReview.innerHTML = diagnosticContextReviewMarkup(rawContext);
    return;
  }
  if (!rangeText) {
    elements.scenarioRangeReview.innerHTML =
      '<p class="empty-note">从复核任务中选择一个区间</p>';
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
  elements.scenarioRangeState.textContent =
    `#${review.requestedTrackPointRange.startTrackPointId}-${review.requestedTrackPointRange.endTrackPointId}`;
  elements.scenarioRangeReview.innerHTML = scenarioRangeReviewMarkup(review, dataset);
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

function scenarioRangeReviewMarkup(review, dataset = null) {
  if (!review.valid) {
    return '<p class="empty-note">清洗点范围无效</p>';
  }
  const rangeRows = [
    `清洗点 ${review.requestedTrackPointRange.startTrackPointId}-${review.requestedTrackPointRange.endTrackPointId}`,
    `点数 ${review.trackPointCount}`,
    formatScenarioRawRange(review.rawRange),
    `情景 ${formatReviewerScenarioNames(review.primaryScenarios)}`
  ];
  const visibleCoverage = reviewerVisibleScenarioCoverage(review.scenarioCoverage);
  const hitMarkup = visibleCoverage.length > 0
    ? scenarioReasonListMarkup(visibleCoverage, true)
    : '<p class="empty-note">这个区间没有稳定依据</p>';
  return [
    scenarioLineTreatmentMarkup(review, dataset, visibleCoverage),
    `<section class="summary-block scenario-hit-block">
      <h3>为什么这么处理</h3>
      ${hitMarkup}
    </section>`,
    summaryBlock('范围', rangeRows)
  ].join('');
}

function diagnosticContextReviewMarkup(context) {
  const gateText = (context.affectedMetricGates || []).join('、') || '无';
  const anchorText = (context.anchorRawPointIds || []).length
    ? `Raw ${formatIdPreview(context.anchorRawPointIds)}`
    : '-';
  const confidence = Number.isFinite(context.confidence)
    ? formatPercent(context.confidence)
    : '-';
  const rows = [
    `情景 ${context.scenarioLabel || scenarioNameLabel(context.scenario)}`,
    formatScenarioRawRange(context.rawRange),
    `metricOwner ${context.metricOwner === false ? 'false' : valueOrDash(context.metricOwner)}`,
    `affectedMetricGates ${gateText}`,
    `锚点 ${anchorText}`,
    `coordinatorState ${context.coordinatorState || '-'}`,
    `confidence ${confidence}`
  ];
  const evidenceRows = diagnosticContextEvidenceRows(context.evidence);
  return [
    summaryBlock('诊断上下文', rows),
    evidenceRows.length > 0 ? summaryBlock('compact evidence', evidenceRows) : '',
    summaryBlock('处理口径', [
      `action ${context.action || '-'}`,
      `localRebuild ${context.localRebuild || '-'}`,
      '只进入审核和跨端对齐，不拥有 route / distance / moving_time / elevation 指标'
    ])
  ].join('');
}

function diagnosticContextEvidenceRows(evidence = {}) {
  return Object.entries(evidence || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key} ${formatDiagnosticEvidenceValue(value)}`);
}

function formatDiagnosticEvidenceValue(value) {
  if (Array.isArray(value)) {
    return value.map(formatDiagnosticEvidenceValue).join('、') || '-';
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : formatOneDecimal(value);
  }
  return String(value);
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
  const forwardSpineConflicts = dataset?.targetOutput?.forwardSpineConflicts || [];
  const blocks = [];
  if (forwardSpineConflicts.length > 0) {
    blocks.push(forwardSpineConflictListMarkup(forwardSpineConflicts.slice(0, 12)));
  }
  return blocks.length > 0
    ? blocks.join('')
    : '<span>当前没有候选冲突</span>';
}

function denseIntentConflictMarkup(conflict) {
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
        <span>局部 ${escapeHtml(scenarioText)}</span>
        <span>点击定位地图</span>
      </div>
      <p>${escapeHtml('这段是地图上需要优先复核的局部冲突，点击后对照原始轨迹线、清洗线和情景范围面。')}</p>
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

function humanConflictResolution(resolution) {
  if (resolution === 'prefer_local_rest_photo_micro_move') return '按局部休息处理';
  return resolution || '已处理';
}

function humanConflictAction(conflict) {
  if (conflict.action === 'collapse_micro_move_to_rest_anchor') {
    return '处理结果：塌成一个休息锚点，不累计这段抖动距离。';
  }
  if (conflict.action === 'filter_weak_micro_move_shape') {
    return '处理结果：保留低速移动形状，只移除中间停留锚点并暂停休息耗时。';
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
    return '普通休息/拍照小移动已按沉淀策略清洗；这段夹在主前进/回环骨架内，只有在保方向候选明显更合适时才作为候选冲突复盘。';
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
  const scenarioButton = event.target.closest('[data-scenario-start-track][data-scenario-end-track]');
  if (scenarioButton) {
    const startTrackPointId = Number(scenarioButton.dataset.scenarioStartTrack);
    const endTrackPointId = Number(scenarioButton.dataset.scenarioEndTrack);
    const startRawPointId = Number(scenarioButton.dataset.scenarioStartRaw);
    const endRawPointId = Number(scenarioButton.dataset.scenarioEndRaw);
    focusScenarioCoverage(startTrackPointId, endTrackPointId, startRawPointId,
      endRawPointId);
    return;
  }
  const diagnosticButton = event.target.closest(
    '[data-diagnostic-context-start-raw][data-diagnostic-context-end-raw]');
  if (diagnosticButton) {
    const startRawPointId = Number(diagnosticButton.dataset.diagnosticContextStartRaw);
    const endRawPointId = Number(diagnosticButton.dataset.diagnosticContextEndRaw);
    focusDiagnosticContext(startRawPointId, endRawPointId,
      diagnosticButton.dataset.diagnosticContextKey);
    return;
  }
  const button = event.target.closest('[data-conflict-start-raw][data-conflict-end-raw]');
  if (!button) return;
  const startRawPointId = Number(button.dataset.conflictStartRaw);
  const endRawPointId = Number(button.dataset.conflictEndRaw);
  focusDenseIntentConflict(startRawPointId, endRawPointId);
}

function focusScenarioCoverage(startTrackPointId, endTrackPointId, startRawPointId,
  endRawPointId) {
  const dataset = selectedDataset();
  if (!dataset || !Number.isFinite(startTrackPointId) || !Number.isFinite(endTrackPointId)) {
    return;
  }
  const trackStart = Math.min(startTrackPointId, endTrackPointId);
  const trackEnd = Math.max(startTrackPointId, endTrackPointId);
  state.scenarioReviewRangeText = `${trackStart}-${trackEnd}`;
  state.rawReviewContext = null;
  state.focusedMapRange = focusedMapRangeFromRanges(dataset, trackStart, trackEnd,
    startRawPointId, endRawPointId);
  elements.scenarioRangeInput.value = state.scenarioReviewRangeText;
  renderScenarioRangeReview();
  renderFocusedMap();
  const rawRange = Number.isFinite(startRawPointId) && Number.isFinite(endRawPointId)
    ? {
      startRawPointId: Math.min(startRawPointId, endRawPointId),
      endRawPointId: Math.max(startRawPointId, endRawPointId)
    }
    : null;
  const bounds = rawRange
    ? rawRangeBounds(dataset, rawRange)
    : trackPointRangeBounds(dataset, trackStart, trackEnd);
  if (bounds) fitBounds(bounds);
}

function focusDenseIntentConflict(startRawPointId, endRawPointId, datasetId = null) {
  const dataset = datasetId
    ? state.datasets.find((item) => item.id === datasetId)
    : selectedDataset();
  if (!dataset || !Number.isFinite(startRawPointId) || !Number.isFinite(endRawPointId)) {
    return;
  }
  state.selectedDatasetId = dataset.id;
  state.rawReviewContext = null;
  const rawRange = {
    startRawPointId: Math.min(startRawPointId, endRawPointId),
    endRawPointId: Math.max(startRawPointId, endRawPointId)
  };
  const trackRange = trackPointRangeTouchingRawRange(dataset, rawRange);
  state.focusedMapRange = {
    datasetId: dataset.id,
    trackRange,
    rawRange
  };
  if (trackRange) {
    state.scenarioReviewRangeText =
      `${trackRange.startTrackPointId}-${trackRange.endTrackPointId}`;
    elements.scenarioRangeInput.value = state.scenarioReviewRangeText;
    renderScenarioRangeReview();
  }
  renderFocusedMap();
  const bounds = rawRangeBounds(dataset, rawRange);
  if (bounds) fitBounds(bounds);
}

function focusDiagnosticContext(startRawPointId, endRawPointId, reviewKey = null) {
  const dataset = selectedDataset();
  if (!dataset || !Number.isFinite(startRawPointId) || !Number.isFinite(endRawPointId)) {
    return;
  }
  const rawRange = {
    startRawPointId: Math.min(startRawPointId, endRawPointId),
    endRawPointId: Math.max(startRawPointId, endRawPointId)
  };
  const task = buildReviewTasks(dataset).find((item) =>
    item.diagnosticContext
    && item.reviewKey === reviewKey);
  const trackRange = trackPointRangeTouchingRawRange(dataset, rawRange);
  state.rawReviewContext = task?.item || {
    rawRange,
    scenario: 'diagnostic_context',
    metricOwner: false,
    affectedMetricGates: []
  };
  state.scenarioReviewRangeText = '';
  state.focusedMapRange = {
    datasetId: dataset.id,
    trackRange,
    rawRange
  };
  elements.scenarioRangeInput.value = '';
  renderScenarioRangeReview();
  renderFocusedMap();
  const bounds = rawRangeBounds(dataset, rawRange);
  if (bounds) fitBounds(bounds);
}

function renderFocusedMap() {
  renderTerrain();
  renderContours();
  renderMap();
}

function startCurrentProblemDrag(event) {
  if (event.button !== 0 || event.target.closest('button')) return;
  const panel = elements.currentProblemPanel;
  const mapArea = panel.closest('.map-area');
  const panelRect = panel.getBoundingClientRect();
  const areaRect = mapArea.getBoundingClientRect();
  state.currentProblemDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - panelRect.left,
    offsetY: event.clientY - panelRect.top,
    areaLeft: areaRect.left,
    areaTop: areaRect.top,
    areaWidth: areaRect.width,
    areaHeight: areaRect.height
  };
  panel.classList.add('dragging');
  panel.setPointerCapture(event.pointerId);
  panel.addEventListener('pointermove', dragCurrentProblemPanel);
  panel.addEventListener('pointerup', stopCurrentProblemDrag);
  panel.addEventListener('pointercancel', stopCurrentProblemDrag);
  event.preventDefault();
}

function dragCurrentProblemPanel(event) {
  const drag = state.currentProblemDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const panel = elements.currentProblemPanel;
  const maxLeft = Math.max(16, drag.areaWidth - panel.offsetWidth - 16);
  const maxTop = Math.max(16, drag.areaHeight - panel.offsetHeight - 16);
  const left = clamp(event.clientX - drag.areaLeft - drag.offsetX, 16, maxLeft);
  const top = clamp(event.clientY - drag.areaTop - drag.offsetY, 16, maxTop);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function stopCurrentProblemDrag(event) {
  const drag = state.currentProblemDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const panel = elements.currentProblemPanel;
  state.currentProblemDrag = null;
  panel.classList.remove('dragging');
  panel.releasePointerCapture(event.pointerId);
  panel.removeEventListener('pointermove', dragCurrentProblemPanel);
  panel.removeEventListener('pointerup', stopCurrentProblemDrag);
  panel.removeEventListener('pointercancel', stopCurrentProblemDrag);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mapElementVisible(input) {
  return Boolean(input?.checked);
}

function rawLineVisible() {
  return mapElementVisible(elements.showRaw);
}

function focusedMapRangeFromRanges(dataset, startTrackPointId, endTrackPointId,
  startRawPointId, endRawPointId) {
  if (!dataset) return null;
  const trackRange = Number.isFinite(startTrackPointId) && Number.isFinite(endTrackPointId)
    ? {
      startTrackPointId: Math.min(startTrackPointId, endTrackPointId),
      endTrackPointId: Math.max(startTrackPointId, endTrackPointId)
    }
    : null;
  const rawRange = Number.isFinite(startRawPointId) && Number.isFinite(endRawPointId)
    ? {
      startRawPointId: Math.min(startRawPointId, endRawPointId),
      endRawPointId: Math.max(startRawPointId, endRawPointId)
    }
    : rawRangeForTrackRange(dataset, trackRange);
  return { datasetId: dataset.id, trackRange, rawRange };
}

function focusedMapRangeFromTrackRange(dataset, startTrackPointId, endTrackPointId) {
  return focusedMapRangeFromRanges(dataset, startTrackPointId, endTrackPointId, NaN, NaN);
}

function rawRangeForTrackRange(dataset, trackRange) {
  if (!dataset || !trackRange) return null;
  const rawIds = [];
  for (const point of dataset.targetProduct?.track || []) {
    if (point.trackPointId < trackRange.startTrackPointId
        || point.trackPointId > trackRange.endTrackPointId) {
      continue;
    }
    if (Number.isFinite(point.sourceRawPointId)) rawIds.push(point.sourceRawPointId);
    rawIds.push(...(point.contributingRawPointIds || []).filter(Number.isFinite));
  }
  if (rawIds.length === 0) return null;
  return {
    startRawPointId: Math.min(...rawIds),
    endRawPointId: Math.max(...rawIds)
  };
}

function focusedMapDatasets(datasets) {
  const focus = state.focusedMapRange;
  if (!focus?.datasetId) return datasets;
  return datasets.filter((dataset) => dataset.id === focus.datasetId);
}

function inFocusedTrackRange(dataset, point) {
  const focus = state.focusedMapRange;
  if (!focus?.trackRange || dataset.id !== focus.datasetId) return true;
  return point.trackPointId >= focus.trackRange.startTrackPointId
    && point.trackPointId <= focus.trackRange.endTrackPointId;
}

function inFocusedRawRange(dataset, point) {
  const focus = state.focusedMapRange;
  if (!focus?.rawRange || dataset.id !== focus.datasetId) return true;
  return point.rawPointId >= focus.rawRange.startRawPointId
    && point.rawPointId <= focus.rawRange.endRawPointId;
}

function rawRangeOverlapsFocus(dataset, rawRange) {
  const focus = state.focusedMapRange;
  if (!focus?.rawRange || dataset.id !== focus.datasetId) return true;
  return rawRangesOverlap(rawRange, focus.rawRange);
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

function trackPointRangeBounds(dataset, startTrackPointId, endTrackPointId) {
  const points = (dataset.targetProduct?.track || [])
    .filter((point) =>
      point.trackPointId >= startTrackPointId
      && point.trackPointId <= endTrackPointId
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

function scenarioHitListMarkup(items, useMatchedRange = false, limit = Infinity,
  actionable = false, dataset = null) {
  return `
    <div class="scenario-hit-list">
      ${items.slice(0, limit).map((item) =>
    scenarioHitMarkup(item, useMatchedRange, actionable, dataset)).join('')}
    </div>
  `;
}

function scenarioReasonListMarkup(items, useMatchedRange = false, limit = Infinity) {
  return `
    <div class="scenario-hit-list">
      ${items.slice(0, limit).map((item) => scenarioReasonMarkup(item, useMatchedRange)).join('')}
    </div>
  `;
}

function scenarioReasonMarkup(item, useMatchedRange) {
  const trackRange = useMatchedRange
    ? formatMatchedScenarioTrackCoverage(item)
    : formatScenarioTrackCoverage(item);
  return `
    <article class="scenario-hit scenario-coverage-hit" data-review-kind="context">
      <div class="scenario-hit-title">
        <strong>${escapeHtml(item.scenarioLabel || scenarioNameLabel(item.scenario))}</strong>
      </div>
      <div class="scenario-hit-meta">
        <span>${escapeHtml(trackRange)}</span>
        <span>${escapeHtml(formatScenarioRawCoverage(item))}</span>
      </div>
      <p>${escapeHtml(item.summary || lineReasonForScenario(item.scenario))}</p>
    </article>
  `;
}

function scenarioHitMarkup(item, useMatchedRange, actionable = false, dataset = null) {
  const trackRange = useMatchedRange
    ? formatMatchedScenarioTrackCoverage(item)
    : formatScenarioTrackCoverage(item);
  const action = item.actionLabel || item.action || '-';
  const rebuild = item.localRebuildLabel || item.localRebuild || '-';
  const reviewLevel = scenarioReviewLevel(item, dataset);
  const actionAttributes = actionable
    ? scenarioCoverageActionAttributes(item, useMatchedRange)
    : '';
  const tagName = actionAttributes ? 'button' : 'article';
  return `
    <${tagName} class="scenario-hit scenario-coverage-hit" data-review-kind="${escapeHtml(reviewLevel.kind)}" ${actionAttributes}>
      <div class="scenario-hit-title">
        <strong>${escapeHtml(item.scenarioLabel || scenarioNameLabel(item.scenario))}</strong>
        <span class="review-badge">${escapeHtml(reviewLevel.label)}</span>
      </div>
      <div class="scenario-hit-meta">
        <span>${escapeHtml(trackRange)}</span>
        <span>${escapeHtml(formatScenarioRawCoverage(item))}</span>
        <span>主解释点 ${escapeHtml(String(item.primaryTrackPointCount || 0))}</span>
        <span>关联点 ${escapeHtml(String(item.contextTrackPointCount || 0))}</span>
      </div>
      <p>${escapeHtml(item.summary || '-')}</p>
      <p class="scenario-hit-action">${escapeHtml(action)}；${escapeHtml(rebuild)}</p>
    </${tagName}>
  `;
}

function scenarioLineTreatmentMarkup(review, dataset, coverage) {
  const rawRange = review.rawRange;
  const rawPoints = rawRange && dataset
    ? rawPointsInRange(dataset, rawRange).filter(hasValidLngLat)
    : [];
  const trackRange = review.requestedTrackPointRange;
  const cleanedPoints = dataset
    ? (dataset.targetProduct?.track || []).filter((point) =>
      point.trackPointId >= trackRange.startTrackPointId
      && point.trackPointId <= trackRange.endTrackPointId
      && hasValidLngLat(point))
    : [];
  const rawPathMeters = pathMetersForPoints(rawPoints);
  const cleanedPathMeters = pathMetersForPoints(cleanedPoints);
  const pointChangeText = rawPoints.length > 0 && cleanedPoints.length > 0
    ? `原始 ${formatPlainNumber(rawPoints.length)} 点 -> 清洗 ${formatPlainNumber(cleanedPoints.length)} 点`
    : '原始线 -> 清洗线';
  const scenarios = new Set((coverage || []).map((item) => item.scenario));
  const treatment = lineTreatmentForScenarios(scenarios);
  const rows = [
    treatment.result,
    treatment.review,
    pointChangeText,
    `原始段约 ${formatMeters(rawPathMeters)}；清洗段约 ${formatMeters(cleanedPathMeters)}`
  ];
  return summaryBlock('线处理结果', rows);
}

function lineTreatmentForScenarios(scenarios) {
  if (scenarios.has('stationary_session_collapse')) {
    return {
      result: '把整段原地记录压成一个代表位置，避免原地抖动变成里程。',
      review: '因为原始点长时间集中在同一区域，真实移动很少，散点更像定位抖动。'
    };
  }
  if (scenarios.has('stationary_drift_collapse')) {
    return {
      result: '把停留时散开的漂移线压回停留点附近。',
      review: '因为人基本停留在原地，但定位点向外发散，外圈折线不应算作真实行进。'
    };
  }
  if (scenarios.has('enclosed_loop_cluster_settlement')
      || scenarios.has('enclosed_gap_cluster')) {
    return {
      result: '原始轨迹线保留完整绕线；清洗成品线把遮挡后的低速回环压成锚点或短连接。',
      review: '因为遮挡后原始线在小范围低速绕圈，重点是入口和出口能否接回真实路线。'
    };
  }
  if (scenarios.has('position_snap_recovery')) {
    return {
      result: '把突然跳远再接回的线段重置为接回点，避免跳远距离进入清洗线。',
      review: '因为中间点距离异常大，随后又回到路线附近，跳远段更像定位错误。'
    };
  }
  if (scenarios.has('moving_spike_cleanup')) {
    return {
      result: '删除移动中的单点尖刺，用前后正常点连成短桥。',
      review: '因为只有一个点偏离正常走向，前后点仍能形成连续路线。'
    };
  }
  if (scenarios.has('same_road_round_trip')) {
    return {
      result: '把同一条路的来回两条线收成更稳定的中心线。',
      review: '因为原始线表示同一路径的往返，保留两条抖动线会放大道路宽度和误差。'
    };
  }
  if (scenarios.has('round_trip_line')) {
    return {
      result: '把过密的往返折线简化，减少重复抖动和细碎折返。',
      review: '因为这段折线重复交织，但整体路线形状可以用更少点表达。'
    };
  }
  if (scenarios.has('composite_gap_local_settlement')) {
    return {
      result: '没有把长 GAP 复合段压成同路来回或往返折线，保留给局部策略逐段结算。',
      review: '因为这段缺少来回意图且中间采样中断明显，跨整段改线会掩盖休息、弱恢复和 GAP 边界。'
    };
  }
  if (scenarios.has('rest_photo_micro_move')) {
    return {
      result: '把休息或拍照时的小范围移动标成局部处理，必要时压成休息锚点。',
      review: '因为原始线范围小、速度低，更像停留时拿手机移动或拍照。'
    };
  }
  if (scenarios.has('weak_recovery_endpoint')) {
    return {
      result: '弱信号恢复处保留形状端点，让清洗线从合理位置接回。',
      review: '因为弱信号结束后需要一个稳定端点承接前后路线，避免直接抹掉形状。'
    };
  }
  if (scenarios.has('gap_recovery_boundary')) {
    return {
      result: '采样中断后重新接线，边界处不强行补不存在的运动。',
      review: '因为中断期间缺少连续证据，不能把两个端点之间的距离直接当作真实走过。'
    };
  }
  if (scenarios.has('transport_contamination')) {
    return {
      result: '把疑似交通工具移动排除在徒步清洗线之外。',
      review: '因为速度或距离形态不符合徒步，纳入会污染徒步里程和配速。'
    };
  }
  return {
    result: '展示这段原始线经过情景处理后的清洗线形。',
    review: '因为该区间触发了局部情景，需要用原始线和清洗线对照确认。'
  };
}

function lineReasonForScenario(scenario) {
  return lineTreatmentForScenarios(new Set([scenario])).review;
}

function pathMetersForPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let meters = 0;
  for (let index = 1; index < points.length; index++) {
    meters += haversineMeters(points[index - 1], points[index]);
  }
  return meters;
}

function haversineMeters(left, right) {
  if (!hasValidLngLat(left) || !hasValidLngLat(right)) return 0;
  const radiusMeters = 6371000;
  const lat1 = degreesToRadians(left.lat);
  const lat2 = degreesToRadians(right.lat);
  const deltaLat = degreesToRadians(right.lat - left.lat);
  const deltaLng = degreesToRadians(right.lng - left.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function scenarioCoverageActionAttributes(item, useMatchedRange) {
  const trackRange = useMatchedRange && item?.matchedTrackPointRange
    ? item.matchedTrackPointRange
    : item?.trackPointRange;
  const rawRange = item?.rawRange;
  const startTrack = trackRange?.startTrackPointId;
  const endTrack = trackRange?.endTrackPointId;
  const startRaw = rawRange?.startRawPointId;
  const endRaw = rawRange?.endRawPointId;
  if (!Number.isFinite(startTrack) || !Number.isFinite(endTrack)) return '';
  return [
    'type="button"',
    `data-scenario-start-track="${escapeHtml(String(startTrack))}"`,
    `data-scenario-end-track="${escapeHtml(String(endTrack))}"`,
    `data-scenario-start-raw="${escapeHtml(String(Number.isFinite(startRaw) ? startRaw : ''))}"`,
    `data-scenario-end-raw="${escapeHtml(String(Number.isFinite(endRaw) ? endRaw : ''))}"`
  ].join(' ');
}

function formatScenarioNames(names) {
  if (!Array.isArray(names) || names.length === 0) return '-';
  return names.map(scenarioNameLabel).join('、');
}

function formatReviewerScenarioNames(names) {
  return formatScenarioNames((names || []).filter(reviewerVisibleScenario));
}

function reviewerVisibleScenarioCoverage(coverage) {
  return (coverage || []).filter((item) => reviewerVisibleScenario(item?.scenario));
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
  const totalTaskCount = reviewTaskCount(dataset);
  if (elements.cleaningConfigState) {
    elements.cleaningConfigState.textContent = dataset
      ? `${formatPlainNumber(totalTaskCount)} 个问题`
      : '等待导入';
  }
  return `
    <h3>问题清单</h3>
    ${currentReviewSummaryMarkup(dataset)}
    ${reviewTaskListMarkup(dataset)}
  `;
}

function reviewTaskCount(dataset) {
  return buildReviewTasks(dataset).length;
}

function reviewTaskListMarkup(dataset) {
  if (!dataset) {
    return '<span>导入 evidence.jsonl 后按 Raw 时间序列显示问题清单</span>';
  }
  const tasks = buildReviewTasks(dataset);
  if (tasks.length === 0) {
    return '<span>当前样本没有需要优先复核的问题</span>';
  }
  return tasks.map((task, index) => reviewTaskMarkup(task, dataset, index)).join('');
}

function currentReviewSummaryMarkup(dataset) {
  if (!dataset || !state.scenarioReviewRangeText) return '';
  const parsed = parseScenarioRangeText(state.scenarioReviewRangeText);
  if (!parsed) return '';
  const review = reviewTrackPointScenarioCoverage(dataset.targetProduct,
    parsed.startTrackPointId, parsed.endTrackPointId);
  if (!review.valid) return '';
  const visibleCoverage = reviewerVisibleScenarioCoverage(review.scenarioCoverage);
  const scenarios = visibleCoverage.length > 0
    ? visibleCoverage.map((item) => item.scenario)
    : review.primaryScenarios;
  const treatment = lineTreatmentForScenarios(new Set(scenarios));
  return `
    <section class="current-review-summary">
      <b>当前复核</b>
      <span class="current-review-range">${escapeHtml(`清洗#${review.requestedTrackPointRange.startTrackPointId}-${review.requestedTrackPointRange.endTrackPointId}`)}</span>
      <span class="current-review-meta">${escapeHtml([
        formatScenarioRawRange(review.rawRange),
        `${formatPlainNumber(review.trackPointCount)} 个清洗点`,
        formatReviewerScenarioNames(scenarios)
      ].join(' · '))}</span>
      <p>${escapeHtml(treatment.result)}</p>
      <p>${escapeHtml(treatment.review)}</p>
    </section>
  `;
}

function reviewTaskMarkup(task, dataset, index = null) {
  const reviewLevel = task.conflict
    ? { kind: 'conflict', label: '先看冲突' }
    : scenarioReviewLevel(task.item, dataset);
  const metaText = reviewTaskTimelineMetaText(task);
  const orderMarkup = Number.isFinite(index)
    ? `<span class="review-task-order">${escapeHtml(formatPlainNumber(index + 1))}</span>`
    : '';
  return `
    <section
      class="review-task"
      data-review-kind="${escapeHtml(reviewLevel.kind)}"
      ${reviewTaskActionAttributes(task)}
    >
      ${orderMarkup}
      <b class="review-task-title">${escapeHtml(task.title)}</b>
      <span class="review-badge">${escapeHtml(reviewLevel.label)}</span>
      ${metaText ? `<span class="review-task-meta">${escapeHtml(metaText)}</span>` : ''}
      <p class="review-task-summary">${escapeHtml(reviewTaskSummary(task))}</p>
      <p class="review-task-action">${escapeHtml(reviewTaskActionText(task))}</p>
    </section>
  `;
}

function reviewTaskActionAttributes(task) {
  if (task.conflict) {
    return [
      `data-conflict-start-raw="${escapeHtml(String(task.item?.rawRange?.startRawPointId ?? ''))}"`,
      `data-conflict-end-raw="${escapeHtml(String(task.item?.rawRange?.endRawPointId ?? ''))}"`
    ].join(' ');
  }
  if (task.diagnosticContext) {
    return [
      `data-diagnostic-context-key="${escapeHtml(task.reviewKey || '')}"`,
      `data-diagnostic-context-start-raw="${escapeHtml(String(task.item?.rawRange?.startRawPointId ?? ''))}"`,
      `data-diagnostic-context-end-raw="${escapeHtml(String(task.item?.rawRange?.endRawPointId ?? ''))}"`
    ].join(' ');
  }
  const item = task.item || {};
  const trackRange = item.trackPointRange;
  const rawRange = item.rawRange;
  const startTrack = trackRange?.startTrackPointId;
  const endTrack = trackRange?.endTrackPointId;
  if (!Number.isFinite(startTrack) || !Number.isFinite(endTrack)) return '';
  return [
    `data-scenario-start-track="${escapeHtml(String(startTrack))}"`,
    `data-scenario-end-track="${escapeHtml(String(endTrack))}"`,
    `data-scenario-start-raw="${escapeHtml(String(Number.isFinite(rawRange?.startRawPointId) ? rawRange.startRawPointId : ''))}"`,
    `data-scenario-end-raw="${escapeHtml(String(Number.isFinite(rawRange?.endRawPointId) ? rawRange.endRawPointId : ''))}"`
  ].join(' ');
}

function reviewTaskTimelineMetaText(task) {
  const parts = [
    reviewTaskRawRangeLabel(task),
    reviewTaskTrackRangeLabel(task),
    reviewTaskPointCountLabel(task)
  ].filter(Boolean);
  return parts.join(' · ');
}

function reviewTaskSummary(task) {
  if (task.conflict) return humanForwardSpineConflictSummary(task.item);
  return task.item?.summary || task.note || '-';
}

function reviewTaskActionText(task) {
  if (task.conflict) return '点击定位地图；处理结果：先复盘，不改变当前清洗轨迹。';
  const action = task.item?.actionLabel || task.item?.action || '-';
  const rebuild = task.item?.localRebuildLabel || task.item?.localRebuild || '-';
  if (task.diagnosticContext) {
    return `点击定位 Raw 区间；只作复盘上下文，不拥有指标；${action}；${rebuild}`;
  }
  return `点击查看区间；${action}；${rebuild}`;
}

function reviewTaskRawRangeLabel(task) {
  const start = task?.startRawPointId;
  const end = task?.endRawPointId;
  if (!Number.isFinite(start)) return '';
  return Number.isFinite(end) && end !== start
    ? `Raw#${formatPlainNumber(start)}-${formatPlainNumber(end)}`
    : `Raw#${formatPlainNumber(start)}`;
}

function reviewTaskTrackRangeLabel(task) {
  if (task?.conflict) return '';
  const item = task?.item || {};
  const range = item.trackPointRange || item.matchedTrackPointRange;
  const start = range?.startTrackPointId;
  const end = range?.endTrackPointId;
  if (!Number.isFinite(start)) return '';
  return Number.isFinite(end) && end !== start
    ? `清洗#${formatPlainNumber(start)}-${formatPlainNumber(end)}`
    : `清洗#${formatPlainNumber(start)}`;
}

function reviewTaskPointCountLabel(task) {
  if (task?.conflict) return '';
  if (task?.diagnosticContext) {
    const anchorCount = task?.item?.anchorRawPointIds?.length || 0;
    return anchorCount ? `锚点 ${formatPlainNumber(anchorCount)}` : '';
  }
  const primary = task?.item?.primaryTrackPointCount || 0;
  const context = task?.item?.contextTrackPointCount || 0;
  if (!primary && !context) return '';
  return `主解释 ${formatPlainNumber(primary)} / 关联 ${formatPlainNumber(context)}`;
}

function scenarioCoverageOverviewMarkup(dataset) {
  const coverage = dataset?.scenarioProduct?.scenarioCoverage || [];
  if (coverage.length === 0) {
    return '<span>导入 evidence.jsonl 后显示全量情景覆盖的清洗点区间和 raw 区间</span>';
  }
  const sortedCoverage = sortScenarioCoverageForReview(coverage, dataset);
  const visible = scenarioHitListMarkup(sortedCoverage, false, 10, true, dataset);
  const overflow = coverage.length > 10
    ? `<span>还有 ${escapeHtml(String(coverage.length - 10))} 段复合情景未展开</span>`
    : '';
  return `${visible}${overflow}`;
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
    elements.pointDetails.innerHTML = '<p class="empty-note">选择地图上的点后显示</p>';
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
  const phoneMotion = phoneMotionLabel(point.activityState);
  return `
    ${detailBlock('清洗点摘要', [
      `trackPointId ${point.trackPointId}`,
      `sourceRawPointId ${point.sourceRawPointId}`,
      `lat/lng ${formatLatLng(point)}`,
      `segmentId ${point.segmentId}`,
      `手机状态 ${phoneMotion}`,
      `distanceDelta ${formatMeters(point.distanceDeltaMeters)}`,
      `movingTimeDelta ${formatDuration(point.movingTimeDeltaSeconds)}`
    ])}
    ${explanationRows.length > 0 ? detailBlock('主解释', explanationRows) : ''}
    ${scenarioRows.length > 0 ? detailBlock('复合情景', scenarioRows) : ''}
    ${collapsibleDetailBlock('底层判点字段', [
      `recomputedDecisionId ${point.recomputedDecisionId}`,
      `result ${point.result}`,
      `reason ${point.reason}`,
      `coordinateSource ${point.coordinateSource || '-'}`
    ])}
    ${collapsibleDetailBlock('点云证据', [
      `cloudType ${point.cloudType || '-'}`,
      `cloudId ${valueOrDash(point.cloudId)}`,
      `cloudSampleCount ${valueOrDash(point.cloudSampleCount)}`,
      `cloudWeightSum ${formatOneDecimal(point.cloudWeightSum)}`,
      `cloudWeightedRadius ${formatMeters(point.cloudWeightedRadiusMeters)}`,
      `representativeRawPointId ${valueOrDash(point.representativeRawPointId)}`,
      ...(point.routeLineVertex === false
        ? [`routeLine ${point.routeLineStrategy || 'not_route_vertex'}`]
        : []),
      ...(point.suppressedRawPointIds?.length
        ? [`suppressedRawPointIds ${formatIdPreview(point.suppressedRawPointIds)}`]
        : [])
    ])}
	    ${collapsibleDetailBlock('清洗轨迹状态', [
      `参数 ${dataset.targetProduct.usesDefaultConfig ? '默认' : '自定义'}`,
      `整段静止 ${dataset.targetProduct.stationarySessionCollapsed ? '已处理' : '未触发'}`,
      `目标总点数 ${dataset.targetProduct.stats.trustedPointCount}`,
      `里程 ${formatMeters(dataset.targetProduct.stats.routeDistanceMeters)}`,
      `运动里程 ${formatMeters(dataset.targetProduct.stats.totalDistanceMeters)}`,
      `疑似交通 ${suspectedTransportCountLabel(dataset.targetProduct.stats)}`,
      `疑似交通里程 ${formatMeters(dataset.targetProduct.stats.suspectedTransportDistanceMeters)}`,
      `疑似交通耗时 ${formatDuration(dataset.targetProduct.stats.suspectedTransportDurationSeconds)}`,
      `疑似交通均速 ${formatTransportSpeed(dataset.targetProduct.stats.suspectedTransportAverageSpeedMetersPerSecond)}`,
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
  const phoneMotion = phoneMotionLabel(decision.activityState);
  return `
    ${decision.result ? detailBlock('Web 复算摘要', [
      `result ${decision.result}`,
      `reason ${decision.reason || '-'}`,
      `手机状态 ${phoneMotion}`,
      `distanceDelta ${formatMeters(decision.distanceDeltaMeters)}`,
      `movingTimeDelta ${formatDuration(decision.movingTimeDeltaSeconds)}`
		    ]) : ''}
		    ${explanationRows.length > 0 ? detailBlock('主解释', explanationRows) : ''}
		    ${scenarioRows.length > 0 ? detailBlock('复合情景', scenarioRows) : ''}
    ${collapsibleDetailBlock('raw 字段', [
      `rawPointId ${point.rawPointId}`,
      `provider ${point.provider || '-'}`,
      `lat/lng ${formatLatLng(point)}`,
      `accuracy ${formatMeters(point.accuracy)}`,
      `altitude ${formatMeters(point.altitude)}`,
      `speed ${formatSpeed(point.speed)}`,
      `elapsedRealtime ${formatNanos(point.elapsedRealtimeNanos)}`
    ])}
    ${collapsibleDetailBlock('上一可信点关系', [
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
    ${decision.result ? collapsibleDetailBlock('底层判点字段', [
      `source ${decision.source || 'targetProduct'}`,
      `horizontalResult ${decision.horizontalResult || '-'}`,
      `horizontalReason ${decision.horizontalReason || '-'}`,
      `segmentId ${valueOrDash(decision.segmentId)}`,
      `cloudType ${decision.cloudType || '-'}`
    ]) : ''}
		  `;
}

function phoneMotionLabel(activityState) {
  return ({
    walking: '手机在动',
    moving: '手机在动',
    still: '手机基本没动',
    stationary_session: '整段基本没动',
    stationary_drift: '停留附近漂移',
    dense_main_route: '密集区行进',
    weak_recovery_shape: '弱信号恢复',
    round_trip_interwoven: '同路来回',
    interwoven_corridor: '来回路线密集',
    enclosed_loop_settlement: '遮挡后绕线',
    position_snap_recovery: '定位跳远后接回',
    rest_photo_micro_move: '休息/拍照小移动',
    unknown: '未知'
  })[activityState] || activityState || '未知';
}

function detailBlock(title, rows) {
  return `
    <section class="detail-block">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
    </section>
  `;
}

function collapsibleDetailBlock(title, rows, open = false) {
  return `
    <details class="detail-block collapsible-detail" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)}</summary>
      ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
    </details>
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
    const visibleFacts = primitiveFacts
      .filter((fact) => !String(fact).startsWith('activity_')
        && fact !== 'motion_supported')
      .slice(0, 8);
    if (visibleFacts.length > 0) {
      rows.push(`判断线索 ${visibleFacts.map(humanPrimitiveFact).join('、')}`);
    }
  }
  return rows;
}

function humanPrimitiveFact(fact) {
  return ({
    low_speed_movement: '低速移动',
    distance_counted: '计入距离',
    moving_time_counted: '计入运动时间',
    stationary_cloud: '停留点云',
    weak_accuracy: '定位精度弱',
    transport_risk: '速度偏快',
    gap_recovery: '中断后恢复'
  })[fact] || fact;
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
    addMapLayers();
    bindMapEvents();
    renderMap();
  });
}

function renderTerrain() {
  if (!state.mapLoaded) return;
  const enabled = mapElementVisible(elements.showTerrain);
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
}

function renderContours() {
  if (!state.mapLoaded) return;
  const visibility = state.contoursAvailable
      && mapElementVisible(elements.showContours)
    ? 'visible'
    : 'none';
  for (const layerId of CONTOUR_LAYER_IDS) {
    if (state.map.getLayer(layerId)) {
      state.map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }
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
  state.map.addSource('streaming-lines', { type: 'geojson', data: emptyFeatureCollection() });
  for (const spec of NATIVE_ENGINE_LINES) {
    state.map.addSource(spec.sourceId, { type: 'geojson', data: emptyFeatureCollection() });
  }
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
        10, 0.10,
        15, 0.16,
        20, 0.22
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
      'line-opacity': 0.68,
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
  // 流式引擎(设备参考)清洗线 —— WIP 对比图层。青色虚线,与批处理红线区分。
  // 注意:流式输出目前与批处理有分歧(距离偏低),此层仅用于诊断对比。
  state.map.addLayer({
    id: 'streaming-lines',
    type: 'line',
    source: 'streaming-lines',
    paint: {
      'line-color': '#06b6d4',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 4, 20, 6],
      'line-opacity': 0.9,
      'line-dasharray': [2, 1.4]
    }
  });
  // 两条原生引擎清洗线 —— 由本地服务(bin/serve.dart)现算的对比图层,均为实线,与 JS
  // 流式线(青虚线)区分。Dart 品红、C++ core 绿。三线重合即证明两级移植都逐点保真;
  // 只有 C++ 线偏开时先看形态(见 NATIVE_ENGINE_LINES 上方注释),不要直接判为移植错。
  for (const spec of NATIVE_ENGINE_LINES) {
    state.map.addLayer({
      id: spec.sourceId,
      type: 'line',
      source: spec.sourceId,
      paint: {
        'line-color': spec.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3.2, 20, 5],
        'line-opacity': 0.85
      }
    });
  }
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
        ['==', ['get', 'kind'], 'cleaned'], '#f97316',
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
  state.map.on('click', 'cleaned-lines', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectCleanedLineSegment(feature, event.lngLat);
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
  state.map.on('mouseenter', 'cleaned-lines', () => {
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
  state.map.on('mouseleave', 'cleaned-lines', () => {
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
  const visible = focusedMapDatasets(state.datasets.filter((dataset) => dataset.visible));
  state.map.getSource('scenario-polygons').setData(
    mapElementVisible(elements.showScenarios)
      ? scenarioPolygonFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('raw-lines').setData(rawLineVisible() ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(mapElementVisible(elements.showTrusted) ? trustedFeatureCollection(visible) : emptyFeatureCollection());
  renderMapHighlightLayers(visible);
  state.map.getSource('dense-intent-conflicts').setData(emptyFeatureCollection());
  state.map.getSource('forward-spine-conflicts').setData(forwardSpineConflictFeatureCollection(visible));
  renderDirectionArrows(visible);
  state.map.getSource('cleaned-points').setData(
    mapElementVisible(elements.showCleaned) && mapElementVisible(elements.showCleanedPoints)
      ? cleanedPointFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('points').setData(mapElementVisible(elements.showPoints) ? pointFeatureCollection(visible) : emptyFeatureCollection());
}

function renderMapHighlightLayers(visibleDatasets = null) {
  if (!state.mapLoaded) return;
  const visible = visibleDatasets || focusedMapDatasets(state.datasets.filter((dataset) => dataset.visible));
  state.map.getSource('cleaned-lines').setData(mapElementVisible(elements.showCleaned)
    ? cleanedFeatureCollection(visible)
    : emptyFeatureCollection());
  state.map.getSource('streaming-lines').setData(mapElementVisible(elements.showStreaming)
    ? streamingFeatureCollection(visible)
    : emptyFeatureCollection());
  for (const spec of NATIVE_ENGINE_LINES) {
    state.map.getSource(spec.sourceId).setData(mapElementVisible(elements[spec.toggle])
      ? nativeFeatureCollection(visible, spec)
      : emptyFeatureCollection());
  }
}

function renderDirectionArrows(visibleDatasets = null) {
  if (!state.mapLoaded) return;
  const source = state.map.getSource('direction-arrows');
  if (!source) return;
  const visible = visibleDatasets || focusedMapDatasets(state.datasets.filter((dataset) => dataset.visible));
  source.setData(mapElementVisible(elements.showDirection)
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
      focusTrackPoints(dataset, pointsFromIds(dataset.targetTrackPointById,
        dataset.mapRender?.cleanedLineTrackPointIds)), {
        enabledScenarioRepairIds: DEFAULT_SCENARIO_REPAIR_IDS
      }))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

// Streaming (device-reference) cleaned line — WIP comparison overlay.
// A plain LineString from the streaming committedTrack; not the repair-encoded
// batch line. Lets you see where the streaming engine diverges from batch.
function streamingFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets
      .map((dataset) => {
        if (dataset.streamingLine === null) {
          dataset.streamingLine = buildStreamingLine(dataset.model, fullScenarioConfig());
        }
        const points = dataset.streamingLine || [];
        return points.length > 1
          ? lineFeature(dataset, points, 'streaming', null, { engine: 'streaming' })
          : null;
      })
      .filter(Boolean)
  };
}

function nativeFeatureCollection(datasets, spec) {
  const features = [];
  for (const dataset of datasets) {
    if (dataset[spec.lineField] === null) {
      dataset[spec.lineField] = 'pending';
      fetchNativeLine(spec, dataset.model)
        .then(({ points, stats, derived }) => {
          dataset[spec.lineField] = points;
          dataset[spec.statsField] = stats;
          dataset[spec.derivedField] = derived;
          renderMapHighlightLayers();
          renderReviewDatasetOverview(); // 成品指标随线一同刷进概览面板
        })
        .catch((error) => {
          dataset[spec.lineField] = [];
          dataset[spec.statsField] = 'error';
          console.warn(`${spec.title}获取失败:`, error);
          renderReviewDatasetOverview(); // 让概览面板从「获取中…」切到失败提示
        });
    }
    const points = Array.isArray(dataset[spec.lineField]) ? dataset[spec.lineField] : [];
    if (points.length > 1) {
      features.push(lineFeature(dataset, points, spec.key, null, { engine: spec.key }));
    }
  }
  return { type: 'FeatureCollection', features };
}

async function fetchNativeLine(spec, model) {
  const response = await fetch(`${NATIVE_ENGINE_ENDPOINT}${spec.query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: model.events || [] })
  });
  if (!response.ok) {
    // 503 = core 动态库没构建(dart 线不受影响);服务端会附 hint,带出来省一次排查。
    let hint = '';
    try {
      const body = await response.json();
      hint = body?.hint ? ` — ${body.hint}` : (body?.error ? ` — ${body.error}` : '');
    } catch (_) { /* 非 JSON 响应,忽略 */ }
    throw new Error(`${spec.title}服务返回 HTTP ${response.status}${hint}`);
  }
  const data = await response.json();
  const points = (data.track || [])
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
    .map((point) => ({
      lat: point.lat,
      lng: point.lng,
      trackPointId: point.trackPointId,
      sourceRawPointId: point.sourceRawPointId
    }));
  // 服务返回的成品 stats 与 JS 成品同字段(同一套算法),原样透传给概览面板对拍。
  // derivedMetrics 是展示层派生指标(配速/平均速度/最高最低海拔),独立命名空间一并带回。
  return { points, stats: data.stats || null, derived: data.derivedMetrics || null };
}

function scenarioPolygonFeatureCollection(datasets) {
  const features = datasets
    .flatMap((dataset) => dataset.scenarioPolygonFeatures || buildScenarioPolygonFeatures(dataset))
    .filter((feature) => scenarioPolygonOverlapsFocus(feature))
    .sort((left, right) =>
      (right.properties?.areaMeters2 || 0) - (left.properties?.areaMeters2 || 0));
  return { type: 'FeatureCollection', features };
}

function denseIntentConflictFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) =>
      (dataset.targetOutput?.denseIntentConflicts || [])
        .filter((conflict) => rawRangeOverlapsFocus(dataset, conflict.rawRange))
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
        .filter((conflict) => rawRangeOverlapsFocus(dataset, conflict.rawRange))
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
  if (rawLineVisible()) {
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
      points: cleanedRouteLinePoints(focusTrackPoints(dataset,
        pointsFromIds(dataset.targetTrackPointById, dataset.mapRender?.cleanedLineTrackPointIds)))
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
  return focusRawPoints(dataset, pointsFromIds(dataset.rawPointById, ids));
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
  return focusTrackPoints(dataset, pointsFromIds(dataset.targetTrackPointById, ids));
}

function focusRawPoints(dataset, points) {
  const focus = state.focusedMapRange;
  if (focus?.rawRange && dataset.id === focus.datasetId) {
    return rawPointsInRange(dataset, focus.rawRange).filter(hasValidLngLat);
  }
  return (points || []).filter((point) => inFocusedRawRange(dataset, point));
}

function focusTrackPoints(dataset, points) {
  const focus = state.focusedMapRange;
  if (focus?.trackRange && dataset.id === focus.datasetId) {
    return (dataset.targetProduct?.track || [])
      .filter((point) => inFocusedTrackRange(dataset, point));
  }
  return (points || []).filter((point) => inFocusedTrackRange(dataset, point));
}

function scenarioPolygonOverlapsFocus(feature) {
  const focus = state.focusedMapRange;
  if (!focus?.rawRange) return true;
  if (feature.properties?.datasetId !== focus.datasetId) return false;
  const rawRange = rawRangeFromText(feature.properties?.rawRange);
  return rawRange ? rawRangesOverlap(rawRange, focus.rawRange) : true;
}

function rawRangeFromText(text) {
  const normalized = String(text || '');
  const rangeMatch = normalized.match(/Raw#(\d+)-(\d+)/);
  if (rangeMatch) {
    return {
      startRawPointId: Number(rangeMatch[1]),
      endRawPointId: Number(rangeMatch[2])
    };
  }
  const ids = [...normalized.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (ids.length > 0) {
    return {
      startRawPointId: Math.min(...ids),
      endRawPointId: Math.max(...ids)
    };
  }
  return null;
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
  const intervalMeters = contourIntervalForLevel(level, zoom);
  if (!state.popup) return;
  state.popup
    .setLngLat([lng, lat])
    .setHTML([
      '<strong>等高线数据</strong>',
      `${escapeHtml(lineType)} ${escapeHtml(formatPlainNumber(elevationMeters))} m`,
      `级别 ${escapeHtml(String(Number.isFinite(level) ? level : '-'))}；当前间距 ${escapeHtml(String(intervalMeters))} m`,
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
        `<strong>${escapeHtml('候选冲突')}</strong>`,
        escapeHtml(properties.rawRange || 'Raw#-'),
        `处理 ${escapeHtml(humanConflictResolution(properties.resolution))}`,
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

function selectCleanedLineSegment(feature, lngLat) {
  const properties = feature.properties || {};
  const dataset = state.datasets.find((item) => item.id === String(properties.datasetId || ''));
  if (!dataset) return;
  state.selectedDatasetId = dataset.id;
  const startTrackPointId = Number(properties.startTrackPointId);
  const endTrackPointId = Number(properties.endTrackPointId);
  if (Number.isFinite(startTrackPointId) && Number.isFinite(endTrackPointId)) {
    const trackStart = Math.min(startTrackPointId, endTrackPointId);
    const trackEnd = Math.max(startTrackPointId, endTrackPointId);
    state.scenarioReviewRangeText = `${trackStart}-${trackEnd}`;
    state.rawReviewContext = null;
    state.focusedMapRange = focusedMapRangeFromTrackRange(dataset, trackStart, trackEnd);
    elements.scenarioRangeInput.value = state.scenarioReviewRangeText;
    renderScenarioRangeReview();
    renderFocusedMap();
  }
  if (!state.popup || !lngLat) return;
  state.popup
    .setLngLat(lngLat)
    .setHTML(cleanedLineSegmentPopupHtml(properties))
    .addTo(state.map);
}

function cleanedLineSegmentPopupHtml(properties) {
  const repairEnabled = properties.repairEnabled === true || properties.repairEnabled === 'true';
  const title = repairEnabled
    ? '情景高亮段'
    : '清洗成品线';
  const rows = [
    `<strong>${escapeHtml(title)}</strong>`,
    `清洗点 ${escapeHtml(formatTrackRangeFromProperties(properties))}`
  ];
  if (repairEnabled) {
    rows.push(`情景 ${escapeHtml(properties.scenarioLabel || properties.scenario || '-')}`);
    rows.push(`处理 ${escapeHtml(properties.repairLabel || cleanedLineRepairKindLabel(properties.repairKind))}`);
    rows.push(`原因 ${escapeHtml(cleanedLineReasonText(properties))}`);
  } else {
    rows.push('原因 默认清洗结果连接；未命中上图情景修复段。');
  }
  return rows.join('<br/>');
}

function formatTrackRangeFromProperties(properties) {
  const start = Number(properties.startTrackPointId);
  const end = Number(properties.endTrackPointId);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '#-';
  return `#${Math.min(start, end)}-${Math.max(start, end)}`;
}

function cleanedLineRepairKindLabel(kind) {
  if (kind === 'rewrite') return '改线';
  if (kind === 'hybrid') return '标注/改线';
  if (kind === 'diagnostic') return '解释标注';
  return '默认清洗';
}

function cleanedLineReasonText(properties) {
  if (properties.repairKind === 'rewrite') {
    return '该段清洗线受情景重建影响，地图用高亮颜色标出实际改线范围。';
  }
  if (properties.repairKind === 'hybrid') {
    return '该段同时包含情景解释和局部处理影响，建议对照原始轨迹线复核。';
  }
  if (properties.repairKind === 'diagnostic') {
    return '该段主要用于解释标注，不一定改变清洗线形状。';
  }
  return '该段来自默认清洗轨迹。';
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

// 海拔单位始终用米(不像 formatMeters 那样 >1000 转 km),可为负(低于海平面);无样本 → '证据不足'。
function formatAltitude(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : '证据不足';
}

function formatTransportSpeed(value) {
  return Number.isFinite(value) ? `${(value * 3.6).toFixed(1)} km/h` : '-';
}

function suspectedTransportCountLabel(stats = {}) {
  const segmentCount = Number.isFinite(stats.suspectedTransportSegmentCount)
    ? stats.suspectedTransportSegmentCount
    : 0;
  const pointCount = Number.isFinite(stats.suspectedTransportPointCount)
    ? stats.suspectedTransportPointCount
    : Number.isFinite(stats.transportCount) ? stats.transportCount : 0;
  return `${segmentCount}段 / ${pointCount}点`;
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
