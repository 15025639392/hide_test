import {
  buildTargetOutput,
  formatDuration,
  isEvidenceCandidatePath,
  isEvidenceJsonlPath,
  parseEvidenceJsonl
} from './diagnosticMap.mjs';
import {
  DEFAULT_TARGET_PRODUCT_CONFIG,
  buildTargetTrackProduct,
  normalizeTargetProductConfig
} from './targetProduct.mjs';

const COLORS = ['#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#c084fc', '#34d399', '#f97316', '#e879f9'];
const MAP_LINE_POINT_LIMIT = 6000;
const MAP_RAW_POINT_LIMIT = 7000;
const MAP_TRACK_POINT_LIMIT = 5000;
const CLEANING_ALGORITHM_SECTIONS = [
  {
    title: '数据入口',
    rows: [
	      '输入 evidence.jsonl',
	      'Android 只作为纯证据产出端，Web 负责重新 intake、判点和生成清洗轨迹',
	      '先复原 raw_location、sampling_policy、device_motion_window、barometer_window',
	      '同步生成 sessionProfile，用于观察采样节奏、accuracy 分布、速度分布和静止噪声；当前不参与判点',
      '所有连续性、GAP、速度计算使用 elapsedRealtimeNanos，不用 timeMillis 代替'
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
    title: '点云与权重',
    rows: (config) => [
	      '静止 anchor 使用点云 weighted center；真实移动、GAP 恢复、交通风险和连续性救援使用 raw 坐标',
	      'weight = accuracy 反向权重 * motion * temporal * spatial',
	      `temporal 使用 ${formatPlainNumber(config.cloudTemporalDecaySeconds)}s 衰减`
    ]
  },
  {
    title: '关键阈值',
    rows: (config) => [
      `GAP > ${formatPlainNumber(config.gapSeconds)}s 进入 RECOVERY_CLOUD，恢复点 delta=0`,
      `accuracy > ${formatPlainNumber(config.weakCloudAccuracyMeters)}m 默认进入 WEAK_CLOUD，除非满足连续性或低精度救援规则`,
      `静止阈值 = max(${formatPlainNumber(config.stationaryDistanceMeters)}m, accuracy * ${formatPlainNumber(config.stationaryAccuracyMultiplier)})`,
      `速度 > ${formatPlainNumber(config.impossibleSpeedMetersPerSecond)}m/s 视为异常弱点`,
      `速度 >= ${formatPlainNumber(config.transportSpeedMetersPerSecond)}m/s 且位移 >= ${formatPlainNumber(config.transportMinDistanceMeters)}m 标记为交通工具风险并保留`
    ]
  },
  {
    title: '统计口径',
    rows: [
      '里程 = 清洗后的同 segment 运动线路连线总长度，只累计当前点 distanceDeltaMeters > 0 的边',
      '运动里程 = 成品轨迹中 anchor / accept 点的 distanceDeltaMeters 求和',
      '疑似交通里程 = 成品轨迹中交通工具风险点的 distanceDeltaMeters 求和',
      '运动耗时 = 记录终止 elapsedRealtimeNanos - 记录起始 elapsedRealtimeNanos',
      '如果证据缺少记录终止时间，Web 退回使用最后一个 raw_location 的 elapsedRealtimeNanos',
      '单点 movingTimeDelta 只保留为轨迹连续性解释，不再作为聚合运动耗时来源'
    ]
  },
  {
    title: '低质量运动段',
    rows: (config) => [
      '孤立 moving_good_fix 如果被低质量定位静止抖动包围，不直接按普通好点解释',
      `候选区间只允许已通过 intake 且 accuracy <= ${formatPlainNumber(config.weakCloudAccuracyMeters)}m 的定位 raw 点参与`,
      '持续时间 >= 60s、active-motion 覆盖 >= 0.7、合理采样步距 >= 25m、移动步数 >= 8、bbox 展开 >= 25m 时，默认只标记为复核候选',
      '只有显式开启 lowQualityMotionRebuildEnabled 时，才抽稀为 motion_supported_low_quality 进入成品轨迹',
      '该规则不跨 raw 采样 GAP，不接受交通工具风险，不凭单点 motion 恢复'
    ]
  },
  {
    title: '气压边界',
    rows: (config) => [
      `气压阻止静止整段压缩当前${config.barometerCleaningEnabled ? '开启' : '关闭'}`,
      `开启后，仅当有效气压窗口 >= ${formatPlainNumber(config.barometerVerticalMotionMinWindowCount)} 且高度范围 >= ${formatPlainNumber(config.barometerVerticalMotionMinRangeMeters)}m 时，阻止 stationary_session_anchor 压缩`,
      '气压不直接删点，不改变 intake、GAP、交通工具识别或点云稳定性',
      '累计爬升仍不是由这个清洗开关直接计算'
    ]
  },
  {
    title: '为什么这样配',
    rows: (config) => [
      `${formatPlainNumber(config.maxIntakeAccuracyMeters)}m 是 raw 进入复算的宽门槛，用于保留弱 GPS 诊断证据`,
      `${formatPlainNumber(config.weakCloudAccuracyMeters)}m 是可信点云分界，避免弱信号直接污染目标轨迹`,
      `${formatPlainNumber(config.gapSeconds)}s GAP 避免把长时间无定位两端直线计入成品距离`,
      '交通工具风险只做解释标签，不作为删除条件，成品轨迹保留真实移动但标记风险',
      '低速点必须有近期运动证据才能进入轨迹，低精度点必须满足连续性、accuracy 和位移下限才能被救援',
      '整段 motion 几乎全静止且 stationary_anchor 占主导时，Web 成品轨迹压缩为一个稳定中心点'
    ]
  }
];

const state = {
  datasets: [],
  selectedDatasetId: null,
  selectedPoint: null,
  map: null,
  mapLoaded: false,
  popup: null,
  algorithmSourceText: '正在读取 acceptance-web/src/targetProduct.mjs...',
  cleaningConfig: normalizeTargetProductConfig()
};

const elements = {
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  fitBoundsButton: document.querySelector('#fitBoundsButton'),
  clearButton: document.querySelector('#clearButton'),
  showRaw: document.querySelector('#showRaw'),
  showTrusted: document.querySelector('#showTrusted'),
  showCleaned: document.querySelector('#showCleaned'),
  showShadow: document.querySelector('#showShadow'),
  showDirection: document.querySelector('#showDirection'),
  showLowQualityCandidates: document.querySelector('#showLowQualityCandidates'),
  showShadowDiffs: document.querySelector('#showShadowDiffs'),
  showCleanedPoints: document.querySelector('#showCleanedPoints'),
  showPoints: document.querySelector('#showPoints'),
  configStateText: document.querySelector('#configStateText'),
  applyConfigButton: document.querySelector('#applyConfigButton'),
  resetConfigButton: document.querySelector('#resetConfigButton'),
  cleaningAlgorithm: document.querySelector('#cleaningAlgorithm'),
  algorithmDialog: document.querySelector('#algorithmDialog'),
  algorithmDialogContent: document.querySelector('#algorithmDialogContent'),
  closeAlgorithmDialogButton: document.querySelector('#closeAlgorithmDialogButton'),
  configInputs: {
    maxIntakeAccuracyMeters: document.querySelector('#maxIntakeAccuracyMeters'),
    weakCloudAccuracyMeters: document.querySelector('#weakCloudAccuracyMeters'),
    gapSeconds: document.querySelector('#gapSeconds'),
    stationaryDistanceMeters: document.querySelector('#stationaryDistanceMeters'),
    barometerCleaningEnabled: document.querySelector('#barometerCleaningEnabled'),
    lowQualityMotionRebuildEnabled: document.querySelector('#lowQualityMotionRebuildEnabled')
  },
  importStatus: document.querySelector('#importStatus'),
  importSpinner: document.querySelector('#importSpinner'),
  importText: document.querySelector('#importText'),
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
elements.applyConfigButton.addEventListener('click', () => {
  void applyCleaningConfig();
});
elements.resetConfigButton.addEventListener('click', () => {
  void resetCleaningConfig();
});
elements.cleaningAlgorithm.addEventListener('click', handleCleaningAlgorithmClick);
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
renderConfigInputs();
render();
loadAlgorithmSource();

async function loadAlgorithmSource() {
  try {
    const response = await fetch('./src/targetProduct.mjs', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.algorithmSourceText = await response.text();
  } catch (error) {
    state.algorithmSourceText = `无法读取 targetProduct.mjs: ${error.message}`;
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
  const result = await readEvidenceFileInWorker(file, filePath, state.cleaningConfig);
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
  const targetProduct = buildTargetTrackProduct(model, { config });
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
    findings: output?.findings || []
  };
}

function attachDatasetIndexes(dataset) {
  dataset.rawPointById = new Map((dataset.model?.points || [])
    .map((point) => [point.rawPointId, point]));
  dataset.targetTrackPointById = new Map((dataset.targetProduct?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.shadowTrackPointById = new Map((dataset.targetProduct?.adaptiveShadow?.track || [])
    .map((point) => [point.trackPointId, point]));
  dataset.shadowDifferenceByRawId = new Map((dataset.targetProduct?.adaptiveShadow?.differences || [])
    .map((difference) => [difference.rawPointId, difference]));
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
  const shadowTrack = dataset.targetProduct?.adaptiveShadow?.track || [];
  const shadowDifferenceIds = new Set((dataset.targetProduct?.adaptiveShadow?.differences || [])
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
  elements.folderInput.value = '';
  elements.fileInput.value = '';
  setImportText('等待导入 evidence.jsonl');
  if (state.popup) state.popup.remove();
  render();
  renderMap();
}

async function applyCleaningConfig() {
  state.cleaningConfig = normalizeTargetProductConfig(readConfigInputs());
  renderConfigInputs();
  if (state.datasets.length === 0) {
    setImportText('已应用自定义清洗参数，等待导入 evidence.jsonl');
    render();
    return;
  }
  setLoading(true, `已应用自定义清洗参数，准备重算 ${state.datasets.length} 个文件`);
  try {
    await recomputeTargetProducts();
    setImportText(`已应用自定义清洗参数，重新计算 ${state.datasets.length} 个文件`);
    render();
  } finally {
    setLoading(false);
  }
}

async function resetCleaningConfig() {
  state.cleaningConfig = normalizeTargetProductConfig(DEFAULT_TARGET_PRODUCT_CONFIG);
  renderConfigInputs();
  if (state.datasets.length === 0) {
    setImportText('已恢复默认清洗参数，等待导入 evidence.jsonl');
    render();
    return;
  }
  setLoading(true, `已恢复默认清洗参数，准备重算 ${state.datasets.length} 个文件`);
  try {
    await recomputeTargetProducts();
    setImportText(`已恢复默认清洗参数，重新计算 ${state.datasets.length} 个文件`);
    render();
  } finally {
    setLoading(false);
  }
}

function readConfigInputs() {
  return Object.fromEntries(Object.entries(elements.configInputs)
    .map(([key, input]) => [key, input.type === 'checkbox' ? input.checked : Number(input.value)]));
}

function renderConfigInputs() {
  for (const [key, input] of Object.entries(elements.configInputs)) {
    if (input.type === 'checkbox') {
      input.checked = state.cleaningConfig[key] === true;
    } else {
      input.value = state.cleaningConfig[key];
    }
  }
  elements.configStateText.textContent = isDefaultCleaningConfig() ? '默认' : '自定义';
  renderCleaningAlgorithm();
}

function isDefaultCleaningConfig() {
  return Object.entries(DEFAULT_TARGET_PRODUCT_CONFIG)
    .every(([key, value]) => state.cleaningConfig[key] === value);
}

async function recomputeTargetProducts() {
  for (let index = 0; index < state.datasets.length; index++) {
    const dataset = state.datasets[index];
    setLoading(true, `正在重算 ${index + 1}/${state.datasets.length}: ${dataset.filePath}`);
    await nextFrame();
    if (dataset.sourceFile) {
      const result = await readEvidenceFileInWorker(dataset.sourceFile, dataset.filePath,
        state.cleaningConfig);
      Object.assign(dataset, {
        model: result.model,
        targetProduct: result.targetProduct,
        targetOutput: result.targetOutput
      });
    } else {
      dataset.targetProduct = buildTargetTrackProduct(dataset.model, { config: state.cleaningConfig });
      dataset.targetOutput = compactTargetOutput(buildTargetOutput(dataset.model,
        dataset.targetProduct));
    }
    attachDatasetIndexes(dataset);
  }
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
    elements.applyConfigButton,
    elements.resetConfigButton
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
  renderPointDetails();
  renderCleaningAlgorithm();
  renderAlgorithmDialog();
  renderMap();
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
  const config = state.cleaningConfig;
  const dataset = selectedDataset();
  return `
    <section class="summary-block algorithm-block">
      <h3>清洗规则</h3>
      <div class="algorithm-section">
        <b>批量影子复核</b>
        ${adaptiveShadowBatchSummaryRows(state.datasets).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>清洗结果</b>
        ${targetProductSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>场景画像</b>
        ${sessionProfileSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>自适应影子</b>
        ${adaptiveShadowSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
        ${adaptiveShadowNavigatorMarkup(dataset)}
      </div>
      <div class="algorithm-section">
        <b>当前参数</b>
        <span>弱点云 ${formatPlainNumber(config.weakCloudAccuracyMeters)}m；GAP ${formatPlainNumber(config.gapSeconds)}s；静止基础距离 ${formatPlainNumber(config.stationaryDistanceMeters)}m</span>
        <span>accuracy 上限 ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m；气压阻止静止整段压缩 ${config.barometerCleaningEnabled ? '开启' : '关闭'}</span>
        <span>低质量运动重建进入轨迹 ${config.lowQualityMotionRebuildEnabled ? '开启' : '关闭'}</span>
      </div>
      <button id="openAlgorithmDialogButton" class="secondary-button" type="button">查看完整规则说明</button>
    </section>
  `;
}

function targetProductSummaryRows(dataset) {
  if (!dataset) return ['导入 evidence.jsonl 后显示里程、运动里程、疑似交通里程和运动耗时'];
  const stats = dataset.targetProduct.stats;
  const ascent = displayAscent(dataset);
  const rows = [
    `文件 ${dataset.fileName}`,
    `里程 ${formatMeters(stats.routeDistanceMeters)}`,
    `运动里程 ${formatMeters(stats.totalDistanceMeters)}`,
    `疑似交通里程 ${formatMeters(stats.suspectedDistanceMeters)}`,
    `累计爬升 ${formatAscent(ascent.totalMeters)}（${formatAscentSource(ascent.source)}）`,
    `运动耗时 ${formatDuration(stats.movingTimeSeconds)}`,
    ...lowQualityMotionSummaryRows(dataset)
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
    rows.push(`广义 raw 区间示例：raw#${candidateRawRange(rawCandidate)}；时长 ${formatDuration(rawCandidate.summary?.durationSeconds)}；active ${formatPercent(rawCandidate.summary?.activeRatio)}；弱/拒绝/未解释 ${rawCandidate.decisionMix?.weakCount || 0}/${rawCandidate.decisionMix?.rejectedCount || 0}/${rawCandidate.decisionMix?.unexplainedCount || 0}`);
    rows.push('广义 raw 区间只用于发现真实连续运动线索，当前不会被“进入轨迹”开关直接写入成品轨迹');
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

function adaptiveShadowSummaryRows(dataset) {
  const shadow = dataset?.targetProduct?.adaptiveShadow;
  if (!shadow) return ['导入 evidence.jsonl 后显示固定阈值和自适应阈值的旁路对比'];
  const rows = [
    '读法：影子结果只做旁路对比，不改变当前成品轨迹',
    ...adaptiveShadowAssessmentRows(shadow.assessment),
    ...adaptiveShadowImpactRows(shadow.impact),
    `阈值变化：弱点云 ${formatThresholdMeters(shadow.thresholds.fixed.weakCloudAccuracyMeters)} -> ${formatThresholdMeters(shadow.thresholds.adaptive.weakCloudAccuracyMeters)}；GAP ${formatThresholdDuration(shadow.thresholds.fixed.gapSeconds)} -> ${formatThresholdDuration(shadow.thresholds.adaptive.gapSeconds)}`,
    `阈值变化：静止基础距离 ${formatThresholdMeters(shadow.thresholds.fixed.stationaryDistanceMeters)} -> ${formatThresholdMeters(shadow.thresholds.adaptive.stationaryDistanceMeters)}；交通速度 ${formatThresholdSpeed(shadow.thresholds.fixed.transportSpeedMetersPerSecond)} -> ${formatThresholdSpeed(shadow.thresholds.adaptive.transportSpeedMetersPerSecond)}`,
    `判点分歧：${shadow.summary.changedCount} / ${shadow.summary.rawPointCount}；可能救回 ${shadow.summary.promotedToTrustedCount}，可能降级 ${shadow.summary.demotedFromTrustedCount}，原因变化 ${shadow.summary.reasonChangedCount}`
  ];
  for (const difference of (shadow.differences || []).slice(0, 3)) {
    rows.push(`例：raw#${difference.rawPointId} ${shadowDecisionLabel(difference.fixed)} -> ${shadowDecisionLabel(difference.adaptive)}`);
  }
  if (shadow.summary.truncated) {
    rows.push(`仅显示前 ${shadow.summary.reportedDifferenceCount} 个分歧`);
  }
  return rows;
}

function adaptiveShadowNavigatorMarkup(dataset) {
  if (!dataset) return '';
  const differences = dataset.targetProduct.adaptiveShadow?.differences || [];
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
  for (const reason of (assessment.reasons || []).slice(0, 3)) {
    rows.push(`复核原因：${reason.message}`);
  }
  if ((assessment.reasons || []).length > 3) {
    rows.push(`还有 ${assessment.reasons.length - 3} 个复核原因未展开`);
  }
  return rows;
}

function adaptiveShadowBatchSummaryRows(datasets) {
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return ['导入多个 evidence.jsonl 后显示影子一致、继续观察、需要复核和暂不适合启用的文件分布'];
  }
  const batch = adaptiveShadowBatchSummary(datasets);
  const rows = [
    `文件分布：影子一致 ${batch.levelCounts.same}；继续观察 ${batch.levelCounts.observe}；需要复核 ${batch.levelCounts.review}；暂不适合 ${batch.levelCounts.blocked}`,
    `总分歧：${batch.changedCount} / ${batch.rawPointCount}；可能救回 ${batch.promotedToTrustedCount}，可能降级 ${batch.demotedFromTrustedCount}，原因变化 ${batch.reasonChangedCount}`,
    `累计影响：可信点 ${formatSignedCount(batch.delta.trustedPointCount)}；地图连线 ${formatSignedMeters(batch.delta.routeDistanceMeters)}；运动里程 ${formatSignedMeters(batch.delta.totalDistanceMeters)}；断点 ${formatSignedCount(batch.delta.gapCount)}；疑似交通点 ${formatSignedCount(batch.delta.transportCount)}`
  ];
  const reviewTargets = batch.files
    .filter((file) => file.level !== 'same' && file.level !== 'unknown')
    .sort((left, right) =>
      adaptiveShadowLevelPriority(right.level) - adaptiveShadowLevelPriority(left.level)
      || right.changedCount - left.changedCount);
  if (reviewTargets.length === 0) {
    rows.push('当前批量没有发现需要复核的自适应差异');
    return rows;
  }
  for (const file of reviewTargets.slice(0, 3)) {
    rows.push(`复核文件：${file.fileName}；${file.label}；分歧 ${file.changedCount}；运动里程 ${formatSignedMeters(file.delta.totalDistanceMeters)}；断点 ${formatSignedCount(file.delta.gapCount)}`);
  }
  if (reviewTargets.length > 3) {
    rows.push(`还有 ${reviewTargets.length - 3} 个有差异文件未展开`);
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
  const files = [];
  let rawPointCount = 0;
  let changedCount = 0;
  let promotedToTrustedCount = 0;
  let demotedFromTrustedCount = 0;
  let reasonChangedCount = 0;

  for (const dataset of datasets) {
    const shadow = dataset?.targetProduct?.adaptiveShadow;
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
    files.push({
      fileName: dataset?.fileName || dataset?.filePath || '-',
      level,
      label: shadow?.assessment?.label || '无影子判断',
      changedCount: numberOrZero(shadow?.summary?.changedCount),
      delta: {
        totalDistanceMeters: numberOrZero(shadow?.impact?.delta?.totalDistanceMeters),
        gapCount: numberOrZero(shadow?.impact?.delta?.gapCount)
      }
    });
  }

  return {
    levelCounts,
    rawPointCount,
    changedCount,
    promotedToTrustedCount,
    demotedFromTrustedCount,
    reasonChangedCount,
    delta,
    files
  };
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

function shadowDecisionLabel(decision) {
  if (!decision) return 'missing';
  return `${decision.result}/${decision.reason}`;
}

function adaptiveShadowRowsForRawPoint(dataset, rawPointId) {
  const difference = adaptiveShadowDifference(dataset, rawPointId);
  if (!difference) {
    return ['该 raw 点固定阈值和自适应影子判断一致，或未进入影子对比样本'];
  }
  return [
    `变化 ${adaptiveShadowChangeLabel(difference.changeType)}`,
    `固定阈值 ${shadowDecisionLabel(difference.fixed)}`,
    `自适应影子 ${shadowDecisionLabel(difference.adaptive)}`,
    '说明 影子结果只做旁路对比，不改变当前成品轨迹'
  ];
}

function adaptiveShadowRowsForCleanedPoint(dataset, point) {
  const rawPointIds = [
    point.sourceRawPointId,
    ...(point.contributingRawPointIds || [])
  ].filter((value, index, values) => Number.isFinite(value) && values.indexOf(value) === index);
  const differences = rawPointIds
    .map((rawPointId) => adaptiveShadowDifference(dataset, rawPointId))
    .filter(Boolean);
  if (differences.length === 0) {
    return ['该清洗点覆盖的 raw 点固定阈值和自适应影子判断一致，或未进入影子对比样本'];
  }
  return [
    `相关分歧 ${differences.length} 个 raw 点`,
    ...differences.slice(0, 4).map((difference) =>
      `raw#${difference.rawPointId} ${adaptiveShadowChangeLabel(difference.changeType)}：${shadowDecisionLabel(difference.fixed)} -> ${shadowDecisionLabel(difference.adaptive)}`),
    differences.length > 4 ? '仅显示前 4 个相关分歧' : null,
    '说明 影子结果只做旁路对比，不改变当前成品轨迹'
  ].filter(Boolean);
}

function adaptiveShadowDifference(dataset, rawPointId) {
  if (!Number.isFinite(rawPointId)) return null;
  return dataset?.shadowDifferenceByRawId?.get(rawPointId) || null;
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

function displayAscent(dataset) {
  return {
    totalMeters: dataset.targetOutput?.selectedTotalAscentMeters
      ?? dataset.targetProduct.stats.selectedTotalAscentMeters,
    source: dataset.targetOutput?.selectedAscentSource
      || dataset.targetProduct.stats.selectedAscentSource
      || 'NONE'
  };
}

function renderAlgorithmDialog() {
  elements.algorithmDialogContent.innerHTML = fullAlgorithmMarkup();
  const button = document.querySelector('#openAlgorithmDialogButton');
  if (button) button.addEventListener('click', openAlgorithmDialog);
}

function fullAlgorithmMarkup() {
  const config = state.cleaningConfig;
  return `
    <section class="summary-block algorithm-block">
      <div class="algorithm-section">
        <b>当前参数</b>
        <span>弱点云 ${formatPlainNumber(config.weakCloudAccuracyMeters)}m；GAP ${formatPlainNumber(config.gapSeconds)}s；静止基础距离 ${formatPlainNumber(config.stationaryDistanceMeters)}m</span>
        <span>accuracy 上限 ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m；气压阻止静止整段压缩 ${config.barometerCleaningEnabled ? '开启' : '关闭'}</span>
        <span>低质量运动重建进入轨迹 ${config.lowQualityMotionRebuildEnabled ? '开启' : '关闭'}</span>
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
        <summary>可直接运行的清洗算法模块：acceptance-web/src/targetProduct.mjs</summary>
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
  const ascent = displayAscent(dataset);
  const shadowRows = adaptiveShadowRowsForCleanedPoint(dataset, point);
  const lowQualityRows = lowQualityRowsForCleanedPoint(dataset, point);
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
      `累计爬升 ${formatAscent(ascent.totalMeters)}（${formatAscentSource(ascent.source)}）`
	    ])}
	    ${lowQualityRows.length > 0 ? detailBlock('低质量重建反馈', lowQualityRows) : ''}
	    ${shadowRows.length > 0 ? detailBlock('自适应影子对比', shadowRows) : ''}
	  `;
}

function pointDetailsMarkup(dataset, point) {
  const recomputedDecision = rawPointDecision(dataset, point);
  const decision = recomputedDecision || point.decision || {};
  const context = point.diagnosticContext || {};
  const shadowRows = adaptiveShadowRowsForRawPoint(dataset, point.rawPointId);
  const lowQualityRows = lowQualityRowsForRawPoint(dataset, point.rawPointId);
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
	    ${lowQualityRows.length > 0 ? detailBlock('低质量重建反馈', lowQualityRows) : ''}
	    ${shadowRows.length > 0 ? detailBlock('自适应影子对比', shadowRows) : ''}
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
      ? `区间状态：可信 ${candidate.decisionMix.trustedCount}；weak ${candidate.decisionMix.weakCount}；reject ${candidate.decisionMix.rejectedCount}；未解释 ${candidate.decisionMix.unexplainedCount}`
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
    style: {
      version: 8,
      sources: {
        googleSatellite: {
          type: 'raster',
          tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
          tileSize: 256,
          attribution: 'Imagery © Google'
        }
      },
      layers: [{ id: 'google-satellite', type: 'raster', source: 'googleSatellite' }]
    }
  });
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  state.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '320px' });
  state.map.on('load', () => {
    state.mapLoaded = true;
    addMapLayers();
    bindMapEvents();
    renderMap();
  });
}

function addMapLayers() {
  ensureDirectionArrowImage();
  state.map.addSource('raw-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('trusted-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('shadow-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('low-quality-candidate-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('direction-arrows', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-points', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('shadow-diff-points', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('points', { type: 'geojson', data: emptyFeatureCollection() });
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
      'line-color': '#38bdf8',
      'line-width': 4,
      'line-opacity': 0.92,
      'line-dasharray': [1.2, 1.2]
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
}

function renderMap() {
  if (!state.mapLoaded) return;
  const visible = state.datasets.filter((dataset) => dataset.visible);
  state.map.getSource('raw-lines').setData(elements.showRaw.checked ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(elements.showTrusted.checked ? trustedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('cleaned-lines').setData(elements.showCleaned.checked ? cleanedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('shadow-lines').setData(elements.showShadow.checked ? shadowFeatureCollection(visible) : emptyFeatureCollection());
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
      .map((dataset) => lineFeature(dataset,
        pointsFromIds(dataset.shadowTrackPointById,
          dataset.mapRender?.shadowLineTrackPointIds), 'shadow'))
      .filter((feature) => feature.geometry.coordinates.length > 1)
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
    lines.push({
      kind: 'shadow',
      points: pointsFromIds(dataset.shadowTrackPointById,
        dataset.mapRender?.shadowLineTrackPointIds)
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

function shadowDiffPointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => (dataset.targetProduct.adaptiveShadow?.differences || [])
      .map((difference) => {
        const point = dataset.rawPointById?.get(difference.rawPointId);
        if (!point) return null;
        return {
          type: 'Feature',
          properties: {
            datasetId: dataset.id,
            rawPointId: point.rawPointId,
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

function lineFeature(dataset, points, kind, segmentId = null) {
  const linePoints = points.length > MAP_LINE_POINT_LIMIT
    ? samplePointsForLine(points, MAP_LINE_POINT_LIMIT)
    : points;
  return {
    type: 'Feature',
    properties: { datasetId: dataset.id, kind, color: dataset.color, segmentId },
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
