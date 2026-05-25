import {
  buildTargetOutput,
  formatDuration,
  isEvidenceCandidatePath,
  isEvidenceJsonlPath,
  parseEvidenceJsonl
} from './diagnosticMap.mjs';
import {
  buildSixLayerTrackProduct,
  normalizeSixLayerTrackConfig,
  reviewTrackPointScenarioCoverage
} from './sixLayerTrackProduct.mjs';
import {
  buildScenarioPolygonFeatureCollection
} from './scenarioPolygons.mjs';

const COLORS = ['#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#c084fc', '#34d399', '#f97316', '#e879f9'];
const MAP_LINE_POINT_LIMIT = 6000;
const MAP_RAW_POINT_LIMIT = 7000;
const MAP_TRACK_POINT_LIMIT = 5000;
const FIXED_CLEANING_CONFIG = normalizeSixLayerTrackConfig();
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
const CLEANING_ALGORITHM_SECTIONS = [
  {
    title: '六层模型',
    rows: [
      '输入 evidence.jsonl，Web 使用六层因果模型离线生成清洗轨迹',
      '天空/大气层和场景传播层只落为 accuracy、GAP、raw 点发散、气压趋势等可观测证据',
      '设备采样层解释 SamplingEpoch、sampling_policy、callbackDelayNanos 和传感器可用性',
      '水平轨迹层决定 anchor / accept / weak / reject 和 segment',
      '垂直高度层将 Location.altitude 与 BAROMETER altitude 拆成两条独立线',
      '活动与结算层统一决定 GPX、距离、运动时间、配速和 selected ascent'
    ]
  },
  {
    title: 'Intake 硬门槛',
    rows: (config) => [
      'raw_location 必须是已归一化的定位证据；provider/source 只作为来源解释，不再绑定 Android GPS_PROVIDER',
      'provider / source / sourceKind / trustClass 至少要有一个非空，用于证明定位来源可解释',
      `accuracy 必须有效且 <= ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m`,
      '拒绝 duplicate、out-of-order、早于记录开始、采样 epoch 不匹配的点',
      'intake_rejected 只保留为诊断证据，不进入点云、decision 或成品轨迹'
    ]
  },
  {
    title: '水平轨迹',
    rows: (config) => [
      `GAP > ${formatPlainNumber(config.gapSeconds)}s 进入恢复边界，gap_recovery 进可信轨迹但 delta=0`,
      `accuracy > ${formatPlainNumber(config.weakCloudAccuracyMeters)}m 进入 weak_horizontal_accuracy 或 recovery pending，不进可信 GPX`,
      `静止阈值 = max(${formatPlainNumber(config.stationaryDistanceMeters)}m, accuracy * ${formatPlainNumber(config.stationaryAccuracyMultiplier)})`,
      '静止 anchor 必须有近期 still motion 支持；慢走有 walking motion 时可保留为 motion_supported_low_speed',
      'transport_risk 只保留为诊断，不计入徒步距离、运动时间或爬升'
    ]
  },
  {
    title: '垂直高度双线',
    rows: (config) => [
      `Location.altitude 只在水平点可信且 verticalAccuracy <= ${formatPlainNumber(config.locationAltitudeAscentMaxVerticalAccuracyMeters)}m 时进入 GNSS altitude line`,
      'GAP recovery、stationary_anchor、transport_risk 会 reset 或 suspend 高度累计，不跨边界计爬升',
      'BAROMETER altitude 来自 pressure window，按传感器时间独立累计，不绑定单个 TrackPoint',
      `barometer 样本间隔超过 ${formatPlainNumber(config.barometerAscentMaxSampleGapNanos / 1_000_000_000)}s 或出现压力突变时 reset/reject`,
      'selected ascent 优先选择可信 BAROMETER，气压不可用时才使用 GNSS altitude 兜底'
    ]
  },
  {
    title: '统计口径',
    rows: [
      '里程 = 清洗轨迹中 countsDistance=true 的 distanceDeltaMeters 求和',
      '运动耗时 = countsMovingTime=true 的 movingTimeDeltaSeconds 求和',
      'GAP recovery 可以进入可信线，但不计距、不计运动时间、不跨边界计爬升',
      'weak / reject / intake_rejected 都只作为诊断证据，不进入 trusted GPX',
      'Location 海拔累计和气压累计都会保留，selected ascent 只是展示主结果'
    ]
  },
  {
    title: '不使用 gnss_snapshot',
    rows: (config) => [
      `${formatPlainNumber(config.maxIntakeAccuracyMeters)}m 是 raw 进入复算的宽门槛，用于保留弱 GPS 诊断证据`,
      `${formatPlainNumber(config.weakCloudAccuracyMeters)}m 是水平观测弱分界，避免弱定位污染目标轨迹`,
      '算法不读取卫星数、C/N0、星座分布或 used-in-fix',
      '弱定位原因只写可观测现象，例如 weak_horizontal_accuracy、local scatter、GAP、pressure jump',
      '场景原因如山谷、密林、城市峡谷只进入人工复盘，不进入自动判点标签'
    ]
  }
];

const state = {
  datasets: [],
  selectedDatasetId: null,
  selectedPoint: null,
  scenarioReviewRangeText: '',
  selectedShadowIds: [],
  selectedContour: null,
  map: null,
  mapLoaded: false,
  contoursAvailable: false,
  contourDemSource: null,
  popup: null,
  algorithmSourceText: '正在读取 acceptance-web/src/sixLayerTrackProduct.mjs...'
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
  showShadow: document.querySelector('#showShadow'),
  showTerrain: document.querySelector('#showTerrain'),
  showContours: document.querySelector('#showContours'),
  contourDataPanel: document.querySelector('#contourDataPanel'),
  contourDataStatus: document.querySelector('#contourDataStatus'),
  contourDataSelected: document.querySelector('#contourDataSelected'),
  shadowFilterSummary: document.querySelector('#shadowFilterSummary'),
  shadowFilterOptions: document.querySelector('#shadowFilterOptions'),
  showDirection: document.querySelector('#showDirection'),
  showLowQualityCandidates: document.querySelector('#showLowQualityCandidates'),
  showShadowDiffs: document.querySelector('#showShadowDiffs'),
  showCleanedPoints: document.querySelector('#showCleanedPoints'),
  showPoints: document.querySelector('#showPoints'),
  cleaningAlgorithm: document.querySelector('#cleaningAlgorithm'),
  algorithmDialog: document.querySelector('#algorithmDialog'),
  algorithmDialogContent: document.querySelector('#algorithmDialogContent'),
  closeAlgorithmDialogButton: document.querySelector('#closeAlgorithmDialogButton'),
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
elements.cleaningAlgorithm.addEventListener('click', handleCleaningAlgorithmClick);
elements.scenarioRangeReviewButton.addEventListener('click', applyScenarioRangeReview);
elements.scenarioRangeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyScenarioRangeReview();
});
elements.showTerrain.addEventListener('change', renderTerrain);
elements.showContours.addEventListener('change', renderContours);
elements.shadowFilterOptions.addEventListener('change', handleShadowFilterChange);
elements.closeAlgorithmDialogButton.addEventListener('click', closeAlgorithmDialog);
elements.algorithmDialog.addEventListener('click', (event) => {
  if (event.target === elements.algorithmDialog) closeAlgorithmDialog();
});
elements.algorithmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeAlgorithmDialog();
});
for (const input of [
  elements.showRaw,
  elements.showTrusted,
  elements.showCleaned,
  elements.showScenarios,
  elements.showShadow,
  elements.showDirection,
  elements.showLowQualityCandidates,
  elements.showShadowDiffs,
  elements.showCleanedPoints,
  elements.showPoints
]) {
  input.addEventListener('change', renderMap);
}

initMap();
render();
loadAlgorithmSource();

async function loadAlgorithmSource() {
  try {
    const response = await fetch('./src/sixLayerTrackProduct.mjs', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.algorithmSourceText = await response.text();
  } catch (error) {
    state.algorithmSourceText = `无法读取 sixLayerTrackProduct.mjs: ${error.message}`;
  }
  renderCleaningAlgorithm();
  renderAlgorithmDialog();
}

async function importFiles(files, fromDirectory) {
  setLoading(true, '正在识别 evidence.jsonl...');
  await nextFrame();
  const evidenceFiles = files
    .filter((file) => {
      const path = file.webkitRelativePath || file.name;
      return fromDirectory ? isEvidenceJsonlPath(path) : isEvidenceCandidatePath(path);
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
  const result = await readEvidenceFileInWorker(file, filePath, FIXED_CLEANING_CONFIG);
  return finalizeDataset({
    ...result,
    sourceFile: file
  }, index);
}

async function readEvidenceFileInWorker(file, filePath, config) {
  if (!window.Worker) {
    return readEvidenceFileOnMainThread(file, filePath, config);
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
      config
    });
  });
}

async function readEvidenceFileOnMainThread(file, filePath, config) {
  const text = await file.text();
  const model = parseEvidenceJsonl(text, filePath);
  const targetProduct = buildSixLayerTrackProduct(model, { config });
  return {
    fileName: file.name,
    filePath,
    model,
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
    findings: output?.findings || []
  };
}

function attachDatasetIndexes(dataset) {
  dataset.rawPointById = new Map((dataset.model?.points || [])
    .map((point) => [point.rawPointId, point]));
  dataset.targetTrackPointById = new Map((dataset.targetProduct?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.shadowTrackPointById = new Map((primaryAdaptiveShadow(dataset)?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.shadowDifferencesByRawId = buildShadowDifferencesByRawId(dataset);
  dataset.shadowDifferenceByRawId = new Map(Array.from(dataset.shadowDifferencesByRawId.entries())
    .map(([rawPointId, differences]) => [rawPointId, differences[0]]));
  dataset.rawDecisionById = buildRawDecisionIndex(dataset.targetProduct);
  dataset.mapRender = buildMapRenderIndexes(dataset);
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
  const shadowTrack = primaryAdaptiveShadow(dataset)?.track || [];
  const shadowDifferenceIds = new Set(adaptiveShadowDifferencesForDataset(dataset)
    .map((difference) => difference.rawPointId)
    .filter(Number.isFinite));
  return {
    rawLinePointIds: sampleIds(rawPoints, MAP_LINE_POINT_LIMIT, 'rawPointId'),
    rawPointIds: sampleIds(rawPoints, MAP_RAW_POINT_LIMIT, 'rawPointId', shadowDifferenceIds),
    cleanedLineTrackPointIds: sampleIds(track, MAP_LINE_POINT_LIMIT, 'trackPointId'),
    cleanedPointTrackPointIds: sampleIds(track, MAP_TRACK_POINT_LIMIT, 'trackPointId'),
    shadowLineTrackPointIds: sampleIds(shadowTrack, MAP_LINE_POINT_LIMIT, 'trackPointId')
  };
}

function adaptiveShadowsForDataset(dataset) {
  const shadows = dataset?.targetProduct?.adaptiveShadows;
  if (Array.isArray(shadows) && shadows.length > 0) return shadows;
  return dataset?.targetProduct?.adaptiveShadow ? [dataset.targetProduct.adaptiveShadow] : [];
}

function selectedAdaptiveShadowsForDataset(dataset) {
  const shadows = adaptiveShadowsForDataset(dataset);
  if (state.selectedShadowIds.length === 0) return shadows;
  const selectedIds = new Set(state.selectedShadowIds);
  return shadows.filter((shadow) => selectedIds.has(shadow.id || 'adaptive-shadow'));
}

function primaryAdaptiveShadow(dataset) {
  return adaptiveShadowsForDataset(dataset)[0] || null;
}

function adaptiveShadowDifferencesForDataset(dataset) {
  return adaptiveShadowDifferencesFromShadows(selectedAdaptiveShadowsForDataset(dataset));
}

function allAdaptiveShadowDifferencesForDataset(dataset) {
  return adaptiveShadowDifferencesFromShadows(adaptiveShadowsForDataset(dataset));
}

function adaptiveShadowDifferencesFromShadows(shadows) {
  return shadows.flatMap((shadow) =>
    (shadow.differences || []).map((difference) => ({
      ...difference,
      shadowId: shadow.id || 'adaptive-shadow',
      shadowLabel: shadow.label || '自适应影子'
    })));
}

function buildShadowDifferencesByRawId(dataset) {
  const differencesByRawId = new Map();
  for (const difference of allAdaptiveShadowDifferencesForDataset(dataset)) {
    if (!Number.isFinite(difference.rawPointId)) continue;
    const current = differencesByRawId.get(difference.rawPointId) || [];
    current.push(difference);
    differencesByRawId.set(difference.rawPointId, current);
  }
  return differencesByRawId;
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
  state.selectedShadowIds = [];
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
    elements.clearButton
  ]) {
    element.disabled = loading;
  }
  for (const label of document.querySelectorAll('.file-button')) {
    label.classList.toggle('disabled', loading);
  }
  if (text !== null) {
    setImportText(text);
  }
}

function handleCleaningAlgorithmClick(event) {
  const button = event.target.closest('[data-shadow-raw-point-id]');
  if (!button) return;
  focusRawPoint(button.dataset.shadowDatasetId, Number(button.dataset.shadowRawPointId));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function render() {
  renderShadowFilterOptions();
  renderScenarioRangeReview();
  renderPointDetails();
  renderCleaningAlgorithm();
  renderAlgorithmDialog();
  renderMap();
}

function renderShadowFilterOptions() {
  const options = shadowFilterOptions();
  const candidateIds = new Set(options.map((option) => option.id));
  state.selectedShadowIds = state.selectedShadowIds.filter((id) => candidateIds.has(id));
  elements.shadowFilterSummary.textContent = shadowFilterSummaryText(options);
  elements.shadowFilterOptions.innerHTML = [
    shadowFilterOptionMarkup('all', '全部候选', state.selectedShadowIds.length === 0),
    ...options.map((option) =>
      shadowFilterOptionMarkup(option.id, option.label, state.selectedShadowIds.includes(option.id)))
  ].join('');
}

function shadowFilterOptionMarkup(id, label, checked) {
  return `
    <label class="shadow-filter-option">
      <input
        type="checkbox"
        value="${escapeHtml(id)}"
        ${checked ? 'checked' : ''}
      />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function handleShadowFilterChange(event) {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  if (input.value === 'all') {
    state.selectedShadowIds = [];
    render();
    return;
  }
  state.selectedShadowIds = Array.from(elements.shadowFilterOptions
    .querySelectorAll('input[type="checkbox"]:checked'))
    .map((checkbox) => checkbox.value)
    .filter((value) => value !== 'all');
  render();
}

function shadowFilterStatusText() {
  if (state.selectedShadowIds.length === 0) return '全部候选';
  const labelsById = new Map(shadowFilterOptions().map((option) => [option.id, option.label]));
  return state.selectedShadowIds
    .map((id) => labelsById.get(id) || id)
    .join('、');
}

function shadowFilterSummaryText(options) {
  if (state.selectedShadowIds.length === 0) return '影子 全部';
  if (state.selectedShadowIds.length === 1) return `影子 ${shadowFilterStatusText()}`;
  return `影子 ${state.selectedShadowIds.length}/${options.length}`;
}

function shadowFilterOptions() {
  const byId = new Map();
  for (const dataset of state.datasets) {
    for (const shadow of adaptiveShadowsForDataset(dataset)) {
      const id = shadow.id || 'adaptive-shadow';
      if (!byId.has(id)) {
        byId.set(id, { id, label: shadow.label || id });
      }
    }
  }
  return Array.from(byId.values());
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
  return [
    summaryBlock('区间概览', overviewRows),
    `<section class="summary-block scenario-hit-block">
      <h3>命中情景</h3>
      ${hitMarkup}
    </section>`
  ].join('');
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
        <span>${escapeHtml(formatScenarioRawRange(item.rawRange))}</span>
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
  const config = FIXED_CLEANING_CONFIG;
  const dataset = selectedDataset();
  return `
    <section class="summary-block algorithm-block">
      <h3>清洗规则</h3>
      <div class="algorithm-section">
        <b>清洗结果</b>
        ${targetProductSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>场景画像</b>
        ${sessionProfileSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>情景覆盖</b>
        ${scenarioCoverageSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>固定策略口径</b>
        <span>Web UI 不提供手动参数覆盖；导入后始终使用六层算法默认配置复算</span>
        <span>弱点云 ${formatPlainNumber(config.weakCloudAccuracyMeters)}m；GAP ${formatPlainNumber(config.gapSeconds)}s；静止基础距离 ${formatPlainNumber(config.stationaryDistanceMeters)}m</span>
        <span>accuracy 上限 ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m；低精度连续救回 <= ${formatPlainNumber(config.lowAccuracyRescueMaxAccuracyMeters)}m</span>
        <span>交通风险 ${formatPlainNumber(config.transportSpeedMetersPerSecond)}m/s + ${formatPlainNumber(config.transportMinDistanceMeters)}m；只做诊断，不进徒步真值</span>
      </div>
      <button id="openAlgorithmDialogButton" class="secondary-button" type="button">查看完整规则说明</button>
    </section>
  `;
}

function targetProductSummaryRows(dataset) {
  if (!dataset) return ['导入 evidence.jsonl 后显示里程、运动里程、疑似交通里程和运动耗时'];
  const stats = dataset.targetProduct.stats;
  const rows = [
    `文件 ${dataset.fileName}`,
    `里程 ${formatMeters(stats.routeDistanceMeters)}`,
    `运动里程 ${formatMeters(stats.totalDistanceMeters)}`,
    `疑似交通里程 ${formatMeters(stats.suspectedDistanceMeters)}`,
    ...ascentSummaryRows(dataset),
    `运动耗时 ${formatDuration(stats.movingTimeSeconds)}`
  ];
  if ((dataset.model.points?.length || 0) > MAP_RAW_POINT_LIMIT) {
    rows.push(`地图 raw 点抽样显示 ${dataset.mapRender?.rawPointIds?.length || 0} / ${dataset.model.points.length}；清洗算法仍使用全量 evidence`);
  }
  return rows;
}

function lowQualityMotionSummaryRows(dataset) {
  const rebuild = dataset?.targetProduct?.lowQualityMotionRebuild;
  if (!rebuild) return ['低质量重建：未运行'];
  const enabled = dataset.targetProduct?.config?.lowQualityMotionRebuildEnabled === true;
  const candidateCount = rebuild.candidateCount || 0;
  const rawIntervalCount = rebuild.rawIntervalCandidateCount || 0;
  const rows = [
    `低质量重建：${enabled ? '进入轨迹' : '仅复核'}；可入轨候选 ${candidateCount} 段；广义 raw 区间 ${rawIntervalCount} 段；已扫描 moving_good_fix ${rebuild.scannedMovingGoodFixCount || 0} 个`
  ];
  if (candidateCount === 0) {
    rows.push(lowQualityNoCandidateReason(rebuild));
  } else {
    const first = rebuild.candidates?.[0];
    if (first) {
      rows.push(`可入轨候选示例：raw#${candidateRawRange(first)}；时长 ${formatDuration(first.summary?.durationSeconds)}；active ${formatPercent(first.summary?.activeRatio)}；bbox ${formatMeters(first.summary?.bboxDiagonalMeters)}`);
    }
    if (!enabled) {
      rows.push('当前未改写成品轨迹；开启高级开关后，可入轨候选才会抽稀为 motion_supported_low_quality');
    } else {
      rows.push('当前已允许可入轨候选改写成品轨迹；请在地图上核对生成的 motion_supported_low_quality 点');
    }
    if (candidateCount > 1) {
      rows.push(`还有 ${candidateCount - 1} 段可入轨候选未展开，可点 raw 区间内任意点查看详情`);
    }
  }
  if (rawIntervalCount > 0) {
    const rawCandidate = rebuild.rawIntervalCandidates?.[0];
    rows.push(`广义 raw 区间示例：raw#${candidateRawRange(rawCandidate)}；时长 ${formatDuration(rawCandidate.summary?.durationSeconds)}；active ${formatPercent(rawCandidate.summary?.activeRatio)}；weak/reject 占比 ${formatPercent(rawCandidate.decisionMix?.lowQualityRatio)}；弱/拒绝/未解释 ${rawCandidate.decisionMix?.weakCount || 0}/${rawCandidate.decisionMix?.rejectedCount || 0}/${rawCandidate.decisionMix?.unexplainedCount || 0}`);
    rows.push('广义 raw 区间只用于复核可入轨候选周边的连续运动线索，当前不会被“进入轨迹”开关直接写入成品轨迹');
  }
  return rows;
}

function lowQualityNoCandidateReason(rebuild) {
  const skipped = rebuild?.skipped || {};
  const parts = [
    ['缺少后置静止/GAP边界', skipped.missingLowQualityBoundary],
    ['交通风险边界阻断', skipped.transportBoundary],
    ['raw 区间不包含源点', skipped.sourceOutsideInterval],
    ['组合条件不足', skipped.criteriaRejected],
    ['weak/reject 连续占比不足', skipped.lowQualityMixRejected],
    ['清洗轨迹已表达', skipped.trackAlreadyExpressed],
    ['抽稀结构点不足', skipped.structureTooShort]
  ].filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`);
  const examples = (rebuild?.rejectedExamples || [])
    .slice(0, 2)
    .map((item) => `raw#${item.sourceRawPointId}：${item.message}`);
  const suffix = examples.length > 0 ? `；例：${examples.join('；')}` : '';
  if (parts.length === 0) {
    return '低质量重建：没有发现可扫描的 moving_good_fix，因此开关不会改变这条轨迹';
  }
  return `低质量重建：没有候选，开关不会改变这条轨迹；原因统计：${parts.join('，')}${suffix}`;
}

function candidateRawRange(candidate) {
  const ids = candidate?.rawPointIds || [];
  if (ids.length === 0) return '-';
  if (ids.length === 1) return String(ids[0]);
  return `${ids[0]}-${ids.at(-1)}`;
}

function sessionProfileSummaryRows(dataset) {
  const profile = dataset?.targetProduct?.sessionProfile;
  const guide = '读法：常见表示中位水平；大多数不超过/偏差端表示约九成样本范围；当前只观察，不参与判点';
  if (!profile) return [
    '导入 evidence.jsonl 后显示采样节奏、定位精度、相邻速度和静止噪声',
    guide
  ];
  return [
    guide,
    `采样节奏：常见间隔 ${formatProfileDuration(profile.sampleInterval.p50Seconds)}，大多数不超过 ${formatProfileDuration(profile.sampleInterval.p90Seconds)}；长时间断点 ${profile.sampleInterval.longGapCount}`,
    `定位精度：常见 ${formatProfileMeters(profile.accuracy.p50Meters)}，偏差端约 ${formatProfileMeters(profile.accuracy.p90Meters)}；弱精度点 ${formatPercent(profile.accuracy.weakRatio)}`,
    `相邻速度：常见 ${formatProfileSpeed(profile.movement.adjacentSpeedP50MetersPerSecond)}，偏快端约 ${formatProfileSpeed(profile.movement.adjacentSpeedP90MetersPerSecond)}；徒步可行上沿 ${formatProfileSpeed(profile.movement.plausibleWalkingSpeedP90MetersPerSecond)}`,
    `静止噪声：多数半径 ${formatProfileMeters(profile.stationary.radiusP75Meters)}，偏差端约 ${formatProfileMeters(profile.stationary.radiusP90Meters)}；运动/静止窗口 ${formatPercent(profile.motion.activeRatio)} / ${formatPercent(profile.motion.stillRatio)}`
  ];
}

function scenarioCoverageSummaryRows(dataset) {
  const coverage = dataset?.targetProduct?.scenarioCoverage || [];
  if (coverage.length === 0) {
    return ['导入 evidence.jsonl 后显示每个情景覆盖的清洗点区间和 raw 区间'];
  }
  const scenarioNames = [...new Set(coverage.map((item) => item.scenario))];
  const rows = [
    `情景覆盖 ${coverage.length} 段；类型 ${formatScenarioNames(scenarioNames)}`
  ];
  for (const item of coverage.slice(0, 8)) {
    rows.push(`${item.scenarioLabel || scenarioLabel(item)}：${formatScenarioTrackCoverage(item)} / ${formatScenarioRawRange(item.rawRange)}；主解释点 ${item.primaryTrackPointCount}，关联点 ${item.contextTrackPointCount}；${item.summary || '-'}`);
  }
  if (coverage.length > 8) {
    rows.push(`还有 ${coverage.length - 8} 段情景覆盖未展开，可点击对应清洗点查看关联情景`);
  }
  return rows;
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

function adaptiveShadowSummaryRows(dataset) {
  const shadows = selectedAdaptiveShadowsForDataset(dataset);
  if (shadows.length === 0) return ['导入 evidence.jsonl 后显示固定阈值和多套自适应阈值的旁路对比'];
  const rows = ['读法：每套影子只做旁路对比，不改变当前成品轨迹'];
  for (const shadow of shadows) {
    rows.push(`${shadow.label || shadow.id || '自适应影子'}：${shadow.assessment?.label || '-'}；${shadow.assessment?.summary || '-'}`);
    if (shadow.mode === 'diagnostic_only') {
      rows.push(...weakSignalDirectionHoldRows(shadow));
      rows.push(`阈值变化：${adaptiveShadowThresholdChangeText(shadow)}`);
      rows.push(...adaptiveShadowAssessmentReasonRows(shadow.assessment));
      continue;
    }
    rows.push(...adaptiveShadowImpactRows(shadow.impact));
    rows.push(`阈值变化：${adaptiveShadowThresholdChangeText(shadow)}`);
    rows.push(...weakSignalDirectionHoldRows(shadow));
    rows.push(`判点分歧：${shadow.summary.changedCount} / ${shadow.summary.rawPointCount}；可能救回 ${shadow.summary.promotedToTrustedCount}，可能降级 ${shadow.summary.demotedFromTrustedCount}，原因变化 ${shadow.summary.reasonChangedCount}`);
    for (const difference of (shadow.differences || []).slice(0, 2)) {
      rows.push(`例：${shadow.label || shadow.id} raw#${difference.rawPointId} ${shadowDecisionLabel(difference.fixed)} -> ${shadowDecisionLabel(difference.adaptive)}`);
    }
    if (shadow.summary.truncated) {
      rows.push(`${shadow.label || shadow.id} 仅显示前 ${shadow.summary.reportedDifferenceCount} 个分歧`);
    }
    rows.push(...adaptiveShadowAssessmentReasonRows(shadow.assessment));
  }
  return rows;
}

function weakSignalDirectionHoldRows(shadow) {
  const hold = shadow?.weakSignalDirectionHold;
  if (!hold) return [];
  if ((hold.hintCount || 0) === 0) {
    return [
      `方向保持：未生成方向提示；候选段 ${hold.candidateRunCount || 0}，缺少稳定历史 ${hold.skippedNoHistoryCount || 0}`
    ];
  }
  const rows = [
    `方向保持：${hold.hintCount} 段；只给下一步主方向线索，不改轨迹、里程或判点`
  ];
  for (const hint of (hold.hints || []).slice(0, 2)) {
    rows.push(`方向提示：raw#${hint.startRawPointId}-${hint.endRawPointId}；航向 ${formatHeading(hint.headingDegrees)}；置信 ${directionHoldConfidenceLabel(hint.confidence)}；状态 ${directionHoldStatusLabel(hint.status)}`);
  }
  if ((hold.hints || []).length > 2) {
    rows.push(`还有 ${hold.hints.length - 2} 段方向提示未展开`);
  }
  return rows;
}

function adaptiveShadowNavigatorMarkup(dataset) {
  if (!dataset) return '';
  const differences = adaptiveShadowDifferencesForDataset(dataset);
  if (differences.length === 0) {
    return '<span>当前选中文件没有影子分歧点</span>';
  }
  const buttons = differences.slice(0, 8).map((difference) => `
    <button
      class="shadow-diff-button"
      type="button"
      data-shadow-dataset-id="${escapeHtml(dataset.id)}"
      data-shadow-raw-point-id="${escapeHtml(String(difference.rawPointId))}"
      data-shadow-change-type="${escapeHtml(difference.changeType)}"
    >
      raw#${escapeHtml(String(difference.rawPointId))}
      ${escapeHtml(difference.shadowLabel || '')}
      ${escapeHtml(adaptiveShadowChangeLabel(difference.changeType))}
      ${escapeHtml(shadowDecisionLabel(difference.fixed))} -> ${escapeHtml(shadowDecisionLabel(difference.adaptive))}
    </button>
  `).join('');
  const truncated = differences.length > 8
    ? `<span>还有 ${differences.length - 8} 个分歧点未列出，可在地图上继续点分歧标记</span>`
    : '';
  return `<div class="shadow-diff-list">${buttons}</div>${truncated}`;
}

function adaptiveShadowAssessmentRows(assessment) {
  if (!assessment) return [];
  const rows = [`启用前判断：${assessment.label}；${assessment.summary}`];
  rows.push(...adaptiveShadowAssessmentReasonRows(assessment));
  return rows;
}

function adaptiveShadowAssessmentReasonRows(assessment) {
  const rows = [];
  for (const reason of (assessment?.reasons || []).slice(0, 3)) {
    rows.push(`复核原因：${reason.message}`);
  }
  if ((assessment?.reasons || []).length > 3) {
    rows.push(`还有 ${assessment.reasons.length - 3} 个复核原因未展开`);
  }
  return rows;
}

function adaptiveShadowBatchSummaryRows(datasets) {
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return ['导入多个 evidence.jsonl 后显示多套影子候选的一致、继续观察、需要复核和暂不适合启用分布'];
  }
  const batch = adaptiveShadowBatchSummary(datasets);
  const rows = [
    `候选分布：影子一致 ${batch.levelCounts.same}；继续观察 ${batch.levelCounts.observe}；需要复核 ${batch.levelCounts.review}；暂不适合 ${batch.levelCounts.blocked}`,
    `总分歧：${batch.changedCount} / ${batch.rawPointCount}；可能救回 ${batch.promotedToTrustedCount}，可能降级 ${batch.demotedFromTrustedCount}，原因变化 ${batch.reasonChangedCount}`,
    `累计影响：可信点 ${formatSignedCount(batch.delta.trustedPointCount)}；地图连线 ${formatSignedMeters(batch.delta.routeDistanceMeters)}；运动里程 ${formatSignedMeters(batch.delta.totalDistanceMeters)}；断点 ${formatSignedCount(batch.delta.gapCount)}；疑似交通点 ${formatSignedCount(batch.delta.transportCount)}`
  ];
  for (const candidate of batch.candidates) {
    rows.push(`候选方向：${candidate.label}；文件 ${candidate.fileCount}；一致/观察/复核/暂缓 ${candidate.levelCounts.same}/${candidate.levelCounts.observe}/${candidate.levelCounts.review}/${candidate.levelCounts.blocked}；分歧 ${candidate.changedCount}/${candidate.rawPointCount}；降级 ${candidate.demotedFromTrustedCount}；运动里程 ${formatSignedMeters(candidate.delta.totalDistanceMeters)}；断点 ${formatSignedCount(candidate.delta.gapCount)}`);
  }
  const reviewTargets = batch.items
    .filter((item) => item.level !== 'same' && item.level !== 'unknown')
    .sort((left, right) =>
      adaptiveShadowLevelPriority(right.level) - adaptiveShadowLevelPriority(left.level)
      || right.changedCount - left.changedCount);
  if (reviewTargets.length === 0) {
    rows.push('当前批量没有发现需要复核的自适应差异');
    return rows;
  }
  for (const item of reviewTargets.slice(0, 3)) {
    rows.push(`复核候选：${item.fileName} / ${item.shadowLabel}；${item.label}；分歧 ${item.changedCount}；运动里程 ${formatSignedMeters(item.delta.totalDistanceMeters)}；断点 ${formatSignedCount(item.delta.gapCount)}`);
  }
  if (reviewTargets.length > 3) {
    rows.push(`还有 ${reviewTargets.length - 3} 个有差异候选未展开`);
  }
  return rows;
}

function adaptiveShadowBatchSummary(datasets) {
  const levelCounts = { same: 0, observe: 0, review: 0, blocked: 0, unknown: 0 };
  const delta = {
    routeDistanceMeters: 0,
    totalDistanceMeters: 0,
    trustedPointCount: 0,
    gapCount: 0,
    transportCount: 0
  };
  const items = [];
  const candidatesById = new Map();
  let rawPointCount = 0;
  let changedCount = 0;
  let promotedToTrustedCount = 0;
  let demotedFromTrustedCount = 0;
  let reasonChangedCount = 0;

  for (const dataset of datasets) {
    const shadows = selectedAdaptiveShadowsForDataset(dataset);
    if (shadows.length === 0) {
      levelCounts.unknown++;
      continue;
    }
    for (const shadow of shadows) {
      const level = knownAdaptiveShadowLevel(shadow?.assessment?.level);
      levelCounts[level]++;
      rawPointCount += numberOrZero(shadow?.summary?.rawPointCount);
      changedCount += numberOrZero(shadow?.summary?.changedCount);
      promotedToTrustedCount += numberOrZero(shadow?.summary?.promotedToTrustedCount);
      demotedFromTrustedCount += numberOrZero(shadow?.summary?.demotedFromTrustedCount);
      reasonChangedCount += numberOrZero(shadow?.summary?.reasonChangedCount);
      for (const key of Object.keys(delta)) {
        delta[key] += numberOrZero(shadow?.impact?.delta?.[key]);
      }
      accumulateAdaptiveShadowCandidateSummary(candidatesById, shadow, level);
      items.push({
        fileName: dataset?.fileName || dataset?.filePath || '-',
        shadowLabel: shadow?.label || shadow?.id || '自适应影子',
        level,
        label: shadow?.assessment?.label || '无影子判断',
        changedCount: numberOrZero(shadow?.summary?.changedCount),
        delta: {
          totalDistanceMeters: numberOrZero(shadow?.impact?.delta?.totalDistanceMeters),
          gapCount: numberOrZero(shadow?.impact?.delta?.gapCount)
        }
      });
    }
  }

  return {
    levelCounts,
    rawPointCount,
    changedCount,
    promotedToTrustedCount,
    demotedFromTrustedCount,
    reasonChangedCount,
    delta,
    candidates: Array.from(candidatesById.values()),
    items
  };
}

function accumulateAdaptiveShadowCandidateSummary(candidatesById, shadow, level) {
  const id = shadow?.id || 'adaptive-shadow';
  if (!candidatesById.has(id)) {
    candidatesById.set(id, {
      id,
      label: shadow?.label || id,
      fileCount: 0,
      levelCounts: { same: 0, observe: 0, review: 0, blocked: 0, unknown: 0 },
      delta: {
        routeDistanceMeters: 0,
        totalDistanceMeters: 0,
        trustedPointCount: 0,
        gapCount: 0,
        transportCount: 0
      },
      rawPointCount: 0,
      changedCount: 0,
      promotedToTrustedCount: 0,
      demotedFromTrustedCount: 0,
      reasonChangedCount: 0
    });
  }
  const summary = candidatesById.get(id);
  summary.fileCount++;
  summary.levelCounts[level]++;
  summary.rawPointCount += numberOrZero(shadow?.summary?.rawPointCount);
  summary.changedCount += numberOrZero(shadow?.summary?.changedCount);
  summary.promotedToTrustedCount += numberOrZero(shadow?.summary?.promotedToTrustedCount);
  summary.demotedFromTrustedCount += numberOrZero(shadow?.summary?.demotedFromTrustedCount);
  summary.reasonChangedCount += numberOrZero(shadow?.summary?.reasonChangedCount);
  for (const key of Object.keys(summary.delta)) {
    summary.delta[key] += numberOrZero(shadow?.impact?.delta?.[key]);
  }
}

function knownAdaptiveShadowLevel(level) {
  return ['same', 'observe', 'review', 'blocked'].includes(level) ? level : 'unknown';
}

function adaptiveShadowLevelPriority(level) {
  if (level === 'blocked') return 4;
  if (level === 'review') return 3;
  if (level === 'observe') return 2;
  if (level === 'same') return 1;
  return 0;
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function adaptiveShadowImpactRows(impact) {
  const delta = impact?.delta;
  if (!delta) return [];
  return [
    `整体影响：可信点 ${formatSignedCount(delta.trustedPointCount)}；地图连线 ${formatSignedMeters(delta.routeDistanceMeters)}；运动里程 ${formatSignedMeters(delta.totalDistanceMeters)}；断点 ${formatSignedCount(delta.gapCount)}`,
    `排除变化：弱信号 ${formatSignedCount(delta.weakPointCount)}；硬拒绝 ${formatSignedCount(delta.rejectedPointCount)}；入口拒绝 ${formatSignedCount(delta.intakeRejectedPointCount)}；疑似交通点 ${formatSignedCount(delta.transportCount)}`
  ];
}

function adaptiveShadowThresholdChangeText(shadow) {
  const fixed = shadow?.thresholds?.fixed || {};
  const adaptive = shadow?.thresholds?.adaptive || {};
  const fields = shadow?.changedFields || [];
  const labels = {
    weakCloudAccuracyMeters: '弱点云',
    gapSeconds: 'GAP',
    stationaryDistanceMeters: '静止基础距离',
    transportSpeedMetersPerSecond: '交通速度',
    transportMinDistanceMeters: '交通最小距离',
    continuityRescueMaxSpeedMetersPerSecond: '连续救回速度',
    lowAccuracyRescueMaxAccuracyMeters: '低精度救回 accuracy',
    lowAccuracyRescueMinDistanceMeters: '低精度救回最小距离',
    weakSignalDirectionHoldEnabled: '弱信号方向保持'
  };
  const formatters = {
    weakCloudAccuracyMeters: formatThresholdMeters,
    gapSeconds: formatThresholdDuration,
    stationaryDistanceMeters: formatThresholdMeters,
    transportSpeedMetersPerSecond: formatThresholdSpeed,
    transportMinDistanceMeters: formatThresholdMeters,
    continuityRescueMaxSpeedMetersPerSecond: formatThresholdSpeed,
    lowAccuracyRescueMaxAccuracyMeters: formatThresholdMeters,
    lowAccuracyRescueMinDistanceMeters: formatThresholdMeters,
    weakSignalDirectionHoldEnabled: formatThresholdToggle
  };
  return fields.map((field) => {
    const formatter = formatters[field] || formatPlainNumber;
    return `${labels[field] || field} ${formatter(fixed[field])} -> ${formatter(adaptive[field])}`;
  }).join('；') || '无阈值变化';
}

function formatThresholdToggle(value) {
  return value ? '开启' : '关闭';
}

function shadowDecisionLabel(decision) {
  if (!decision) return 'missing';
  return `${decision.result}/${decision.reason}`;
}

function adaptiveShadowRowsForRawPoint(dataset, rawPointId) {
  const differences = adaptiveShadowDifferences(dataset, rawPointId);
  if (differences.length === 0) {
    return ['该 raw 点固定阈值和自适应影子判断一致，或未进入影子对比样本'];
  }
  return [
    ...differences.slice(0, 5).map((difference) =>
      `${difference.shadowLabel || '自适应影子'} ${adaptiveShadowChangeLabel(difference.changeType)}：固定 ${shadowDecisionLabel(difference.fixed)} -> 影子 ${shadowDecisionLabel(difference.adaptive)}`),
    differences.length > 5 ? `还有 ${differences.length - 5} 套候选分歧未展开` : null,
    '说明 影子结果只做旁路对比，不改变当前成品轨迹'
  ].filter(Boolean);
}

function adaptiveShadowRowsForCleanedPoint(dataset, point) {
  const rawPointIds = [
    point.sourceRawPointId,
    ...(point.contributingRawPointIds || [])
  ].filter((value, index, values) => Number.isFinite(value) && values.indexOf(value) === index);
  const differences = rawPointIds
    .flatMap((rawPointId) => adaptiveShadowDifferences(dataset, rawPointId));
  if (differences.length === 0) {
    return ['该清洗点覆盖的 raw 点固定阈值和自适应影子判断一致，或未进入影子对比样本'];
  }
  return [
    `相关候选分歧 ${differences.length} 条`,
    ...differences.slice(0, 4).map((difference) =>
      `${difference.shadowLabel || '自适应影子'} raw#${difference.rawPointId} ${adaptiveShadowChangeLabel(difference.changeType)}：${shadowDecisionLabel(difference.fixed)} -> ${shadowDecisionLabel(difference.adaptive)}`),
    differences.length > 4 ? '仅显示前 4 个相关分歧' : null,
    '说明 影子结果只做旁路对比，不改变当前成品轨迹'
  ].filter(Boolean);
}

function adaptiveShadowDifference(dataset, rawPointId) {
  if (!Number.isFinite(rawPointId)) return null;
  return adaptiveShadowDifferences(dataset, rawPointId)[0] || null;
}

function adaptiveShadowDifferences(dataset, rawPointId) {
  if (!Number.isFinite(rawPointId)) return [];
  const differences = dataset?.shadowDifferencesByRawId?.get(rawPointId) || [];
  if (state.selectedShadowIds.length === 0) return differences;
  const selectedIds = new Set(state.selectedShadowIds);
  return differences.filter((difference) => selectedIds.has(difference.shadowId));
}

function adaptiveShadowChangeLabel(changeType) {
  if (changeType === 'promoted_to_trusted') return '可能救回';
  if (changeType === 'demoted_from_trusted') return '可能降级';
  return '原因变化';
}

function formatThresholdMeters(value) {
  return Number.isFinite(value) ? formatMeters(value) : '-';
}

function formatThresholdDuration(value) {
  return Number.isFinite(value) ? formatDuration(value) : '-';
}

function formatThresholdSpeed(value) {
  return Number.isFinite(value) ? formatSpeed(value) : '-';
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

function formatHeading(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)}deg` : '-';
}

function directionHoldConfidenceLabel(confidence) {
  if (confidence === 'high') return '高';
  if (confidence === 'medium') return '中';
  return '低';
}

function directionHoldStatusLabel(status) {
  if (status === 'confirmed_by_exit') return '出口确认';
  if (status === 'exit_deviates_from_held_direction') return '出口偏离';
  if (status === 'weak_region_has_little_forward_progress') return '前进不足';
  if (status === 'weak_region_lateral_noise_high') return '横向噪声高';
  return '仅历史方向';
}

function adaptiveShadowColor(index) {
  return ['#38bdf8', '#a78bfa', '#22c55e', '#f97316', '#eab308'][index % 5];
}

function adaptiveShadowColorById(id, fallbackIndex = 0) {
  const order = shadowFilterOptions()
    .filter((option) => option.id !== 'all')
    .map((option) => option.id);
  const index = order.indexOf(id);
  return adaptiveShadowColor(index >= 0 ? index : fallbackIndex);
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

function renderAlgorithmDialog() {
  elements.algorithmDialogContent.innerHTML = fullAlgorithmMarkup();
  const button = document.querySelector('#openAlgorithmDialogButton');
  if (button) button.addEventListener('click', openAlgorithmDialog);
}

function fullAlgorithmMarkup() {
  const config = FIXED_CLEANING_CONFIG;
  return `
    <section class="summary-block algorithm-block">
      <div class="algorithm-section">
        <b>固定策略口径</b>
        <span>Web UI 不提供手动参数覆盖；导入后始终使用六层算法默认配置复算</span>
        <span>弱点云 ${formatPlainNumber(config.weakCloudAccuracyMeters)}m；GAP ${formatPlainNumber(config.gapSeconds)}s；静止基础距离 ${formatPlainNumber(config.stationaryDistanceMeters)}m</span>
        <span>accuracy 上限 ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m；低精度连续救回 <= ${formatPlainNumber(config.lowAccuracyRescueMaxAccuracyMeters)}m</span>
        <span>交通风险 ${formatPlainNumber(config.transportSpeedMetersPerSecond)}m/s + ${formatPlainNumber(config.transportMinDistanceMeters)}m；只做诊断，不进徒步真值</span>
      </div>
      ${CLEANING_ALGORITHM_SECTIONS.map((section) => {
    const rows = typeof section.rows === 'function' ? section.rows(config) : section.rows;
    return `
          <div class="algorithm-section">
            <b>${escapeHtml(section.title)}</b>
            ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
          </div>
        `;
  }).join('')}
      <details class="algorithm-source">
        <summary>可直接运行的清洗算法模块：acceptance-web/src/sixLayerTrackProduct.mjs</summary>
        <pre><code>${escapeHtml(state.algorithmSourceText)}</code></pre>
      </details>
    </section>
  `;
}

function openAlgorithmDialog() {
  renderAlgorithmDialog();
  if (!elements.algorithmDialog.open) elements.algorithmDialog.showModal();
}

function closeAlgorithmDialog() {
  if (elements.algorithmDialog.open) elements.algorithmDialog.close();
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

function lowQualityRowsForCleanedPoint(dataset, point) {
  if (point.reason !== 'motion_supported_low_quality') return [];
  const candidate = lowQualityCandidateForRawPoint(dataset, point.sourceRawPointId);
  const rows = [
    '该清洗点由显式开启的低质量重建产生，已进入成品轨迹和里程统计。'
  ];
  if (candidate) {
    rows.push(...lowQualityCandidateDetailRows(candidate, dataset));
  }
  return rows;
}

function lowQualityRowsForRawPoint(dataset, rawPointId) {
  const candidate = lowQualityCandidateForRawPoint(dataset, rawPointId);
  if (!candidate) return [];
  const enabled = dataset.targetProduct?.config?.lowQualityMotionRebuildEnabled === true;
  return [
    enabled
      ? '该 raw 点落在低质量重建候选区间内；当前开关已开启，候选会尝试进入成品轨迹。'
      : '该 raw 点落在低质量重建候选区间内；当前默认仅复核，不进入成品轨迹。',
    ...lowQualityCandidateDetailRows(candidate, dataset)
  ];
}

function lowQualityCandidateForRawPoint(dataset, rawPointId) {
  const candidates = dataset?.targetProduct?.lowQualityMotionRebuild?.candidates || [];
  const boundaryCandidate = candidates.find((candidate) =>
    (candidate.rawPointIds || []).includes(rawPointId));
  if (boundaryCandidate) return boundaryCandidate;
  const rawIntervalCandidates = dataset?.targetProduct?.lowQualityMotionRebuild
    ?.rawIntervalCandidates || [];
  return rawIntervalCandidates.find((candidate) =>
    (candidate.rawPointIds || []).includes(rawPointId)) || null;
}

function lowQualityCandidateDetailRows(candidate, dataset) {
  const enabled = dataset.targetProduct?.config?.lowQualityMotionRebuildEnabled === true;
  const structureIds = candidate.structureRawPointIds || [];
  const isRawInterval = candidate.kind === 'raw_interval_review';
  return [
    `${isRawInterval ? '广义 raw 区间' : '可入轨候选'} raw#${candidateRawRange(candidate)}；结构点 ${structureIds.length > 0 ? structureIds.join(', ') : '-'}`,
    `证据：时长 ${formatDuration(candidate.summary?.durationSeconds)}；active ${formatPercent(candidate.summary?.activeRatio)}；合理步距 ${formatMeters(candidate.summary?.plausibleDistanceMeters)}；移动步数 ${valueOrDash(candidate.summary?.movingStepCount)}；bbox ${formatMeters(candidate.summary?.bboxDiagonalMeters)}`,
    candidate.decisionMix
      ? `区间状态：可信 ${candidate.decisionMix.trustedCount}；weak ${candidate.decisionMix.weakCount}；reject ${candidate.decisionMix.rejectedCount}；weak/reject 占比 ${formatPercent(candidate.decisionMix.lowQualityRatio)}；未解释 ${candidate.decisionMix.unexplainedCount}`
      : '',
    isRawInterval
      ? '当前模式：广义 raw 区间只做复核提示，不会直接进入成品轨迹。'
      : enabled
      ? '当前模式：进入轨迹。需要核对这些结构点是否贴合真实路线。'
      : '当前模式：仅复核。它不会改变里程、运动时间或清洗轨迹。'
  ].filter(Boolean);
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
      layout: { visibility: 'visible' },
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
    layers,
    terrain: {
      source: 'terrainElevation',
      exaggeration: TERRAIN_EXAGGERATION
    }
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
  state.map.addSource('shadow-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('weak-direction-hints', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('low-quality-candidate-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('direction-arrows', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-points', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('shadow-diff-points', { type: 'geojson', data: emptyFeatureCollection() });
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
      'line-color': '#ef4444',
      'line-width': 4,
      'line-opacity': 0.95
    }
  });
  state.map.addLayer({
    id: 'shadow-lines',
    type: 'line',
    source: 'shadow-lines',
    paint: {
      'line-color': ['coalesce', ['get', 'shadowColor'], '#38bdf8'],
      'line-width': 4,
      'line-opacity': 0.92,
      'line-dasharray': [1.2, 1.2]
    }
  });
  state.map.addLayer({
    id: 'weak-direction-hints',
    type: 'line',
    source: 'weak-direction-hints',
    paint: {
      'line-color': ['coalesce', ['get', 'shadowColor'], '#22c55e'],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 4,
        16, 6,
        20, 8
      ],
      'line-opacity': 0.94,
      'line-dasharray': [0.4, 1.2]
    }
  });
  state.map.addLayer({
    id: 'low-quality-candidate-lines',
    type: 'line',
    source: 'low-quality-candidate-lines',
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'kind'], 'raw_interval_review'], '#f97316',
        '#c084fc'
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 3,
        16, 5,
        20, 7
      ],
      'line-opacity': 0.94,
      'line-dasharray': [1.1, 1.1]
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
    id: 'shadow-diff-points',
    type: 'circle',
    source: 'shadow-diff-points',
    paint: {
      'circle-color': [
        'case',
        ['==', ['get', 'changeType'], 'promoted_to_trusted'], '#22c55e',
        ['==', ['get', 'changeType'], 'demoted_from_trusted'], '#fb7185',
        '#38bdf8'
      ],
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], true], 9,
        7
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 3, 2],
      'circle-opacity': 0.98
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
  state.map.on('click', 'shadow-diff-points', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectPoint(String(feature.properties.datasetId), Number(feature.properties.rawPointId), true);
  });
  state.map.on('click', 'low-quality-candidate-lines', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectLowQualityCandidate(feature);
  });
  state.map.on('click', 'scenario-polygons-fill', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectScenarioPolygon(feature, event.lngLat);
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
  state.map.on('mouseenter', 'shadow-diff-points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'low-quality-candidate-lines', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'scenario-polygons-fill', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'cleaned-points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'shadow-diff-points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'low-quality-candidate-lines', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'scenario-polygons-fill', () => {
    state.map.getCanvas().style.cursor = '';
  });
}

function renderMap() {
  if (!state.mapLoaded) return;
  const visible = state.datasets.filter((dataset) => dataset.visible);
  state.map.getSource('scenario-polygons').setData(
    elements.showScenarios.checked
      ? buildScenarioPolygonFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('raw-lines').setData(elements.showRaw.checked ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(elements.showTrusted.checked ? trustedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('cleaned-lines').setData(elements.showCleaned.checked ? cleanedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('shadow-lines').setData(elements.showShadow.checked ? shadowFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('weak-direction-hints').setData(
    elements.showShadow.checked ? weakDirectionHintFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('low-quality-candidate-lines').setData(
    elements.showLowQualityCandidates.checked
      ? lowQualityCandidateFeatureCollection(visible)
      : emptyFeatureCollection());
  renderDirectionArrows(visible);
  state.map.getSource('cleaned-points').setData(
    elements.showCleaned.checked && elements.showCleanedPoints.checked
      ? cleanedPointFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('shadow-diff-points').setData(
    elements.showShadowDiffs.checked ? shadowDiffPointFeatureCollection(visible) : emptyFeatureCollection());
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
    features: datasets
      .map((dataset) => lineFeature(dataset,
        pointsFromIds(dataset.targetTrackPointById,
          dataset.mapRender?.cleanedLineTrackPointIds), 'cleaned'))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function shadowFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets
      .flatMap((dataset) => selectedAdaptiveShadowsForDataset(dataset).map((shadow, shadowIndex) =>
        lineFeature(dataset, shadow.track || [], 'shadow', shadow.id || null, {
          shadowId: shadow.id || '',
          shadowLabel: shadow.label || '自适应影子',
          shadowColor: adaptiveShadowColorById(shadow.id, shadowIndex)
        })))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function weakDirectionHintFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets
      .flatMap((dataset) => selectedAdaptiveShadowsForDataset(dataset)
        .flatMap((shadow, shadowIndex) =>
          (shadow.weakSignalDirectionHold?.hints || []).map((hint) =>
            weakDirectionHintFeature(dataset, shadow, shadowIndex, hint))))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function weakDirectionHintFeature(dataset, shadow, shadowIndex, hint) {
  return {
    type: 'Feature',
    properties: {
      datasetId: dataset.id,
      shadowId: shadow.id || '',
      shadowLabel: shadow.label || '自适应影子',
      shadowColor: adaptiveShadowColorById(shadow.id, shadowIndex),
      kind: hint.kind || 'weak_signal_direction_hold',
      startRawPointId: hint.startRawPointId ?? null,
      endRawPointId: hint.endRawPointId ?? null,
      confidence: hint.confidence || 'low',
      status: hint.status || ''
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [hint.startLng, hint.startLat],
        [hint.endLng, hint.endLat]
      ].filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    }
  };
}

function lowQualityCandidateFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) =>
      lowQualityCandidatesForDataset(dataset).map((candidate, candidateIndex) =>
        lowQualityCandidateLineFeature(dataset, candidate, candidateIndex)))
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
}

function lowQualityCandidatesForDataset(dataset) {
  const rebuild = dataset?.targetProduct?.lowQualityMotionRebuild;
  if (!rebuild) return [];
  return [
    ...(rebuild.candidates || []),
    ...(rebuild.rawIntervalCandidates || [])
  ];
}

function lowQualityCandidateLineFeature(dataset, candidate, candidateIndex) {
  const points = pointsFromIds(dataset.rawPointById, candidate.rawPointIds || [])
    .filter(hasValidLngLat);
  const linePoints = points.length > MAP_LINE_POINT_LIMIT
    ? samplePointsForLine(points, MAP_LINE_POINT_LIMIT)
    : points;
  const rawPointIds = candidate.rawPointIds || [];
  return {
    type: 'Feature',
    properties: {
      datasetId: dataset.id,
      candidateIndex,
      kind: candidate.kind || 'boundary_rebuild',
      startRawPointId: rawPointIds[0] ?? null,
      endRawPointId: rawPointIds[rawPointIds.length - 1] ?? null,
      rawCount: rawPointIds.length
    },
    geometry: { type: 'LineString', coordinates: linePoints.map(lngLat) }
  };
}

function directionArrowFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap(directionArrowFeaturesForDataset)
      .filter((feature) => feature.geometry.coordinates.length > 1)
  };
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
  if (elements.showShadow.checked) {
    for (const shadow of selectedAdaptiveShadowsForDataset(dataset)) {
      lines.push({
        kind: 'shadow',
        points: shadow.track || [],
        segmentId: shadow.id || null
      });
    }
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

function shadowDiffPointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => adaptiveShadowDifferencesForDataset(dataset)
      .map((difference) => {
        const point = dataset.rawPointById?.get(difference.rawPointId);
        if (!point) return null;
        return {
          type: 'Feature',
          properties: {
            datasetId: dataset.id,
            rawPointId: point.rawPointId,
            shadowId: difference.shadowId || '',
            shadowLabel: difference.shadowLabel || '自适应影子',
            changeType: difference.changeType,
            fixed: shadowDecisionLabel(difference.fixed),
            adaptive: shadowDecisionLabel(difference.adaptive),
            selected: state.selectedPoint?.dataset.id === dataset.id
              && state.selectedPoint?.cleaned !== true
              && state.selectedPoint?.point.rawPointId === point.rawPointId
          },
          geometry: { type: 'Point', coordinates: lngLat(point) }
        };
      })
      .filter(Boolean))
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

function selectLowQualityCandidate(feature) {
  const datasetId = String(feature.properties.datasetId);
  const rawPointId = Number(feature.properties.startRawPointId);
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.rawPointById?.get(rawPointId);
  if (!dataset || !point) return;
  selectPoint(datasetId, rawPointId, false);
  if (!state.popup) return;
  const startRawPointId = Number(feature.properties.startRawPointId);
  const endRawPointId = Number(feature.properties.endRawPointId);
  const rawCount = Number(feature.properties.rawCount);
  const kind = feature.properties.kind === 'raw_interval_review'
    ? '广义 raw 区间'
    : '可入轨候选';
  state.popup
    .setLngLat(lngLat(point))
    .setHTML(`<strong>${escapeHtml(dataset.fileName)}</strong><br/>${kind} raw#${startRawPointId}-${endRawPointId}<br/>${rawCount} 个 raw 点，点击起点查看详情`)
    .addTo(state.map);
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

function formatAreaMeters2(value) {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} km2`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)} ha`;
  return `${value.toFixed(0)} m2`;
}

function formatProfileMeters(value) {
  return Number.isFinite(value) ? formatMeters(value) : '暂无数据';
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

function formatProfileSpeed(value) {
  return Number.isFinite(value) ? formatSpeed(value) : '暂无数据';
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

function formatProfileDuration(value) {
  return Number.isFinite(value) && value > 0 ? formatDuration(value) : '暂无数据';
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
