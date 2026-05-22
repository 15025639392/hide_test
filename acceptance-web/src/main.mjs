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
const CLEANING_ALGORITHM_SECTIONS = [
  {
    title: '数据入口',
    rows: [
      '输入 evidence.jsonl',
      'Android 只作为纯证据产出端，Web 负责重新 intake、判点和生成清洗轨迹',
      '先复原 raw_location、sampling_policy、gnss_snapshot、device_motion_window、barometer_window',
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
      'weight = accuracy 反向权重 * GNSS * motion * temporal * spatial',
      `temporal 使用 ${formatPlainNumber(config.cloudTemporalDecaySeconds)}s 衰减；GNSS 由 usedInFixTotal 和 top4AvgCn0 评分`
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
      '孤立 moving_good_fix 如果被低质量 GNSS 静止抖动包围，不直接按普通好点解释',
      `候选区间只允许已通过 intake 且 accuracy <= ${formatPlainNumber(config.weakCloudAccuracyMeters)}m 的定位 raw 点参与`,
      '持续时间 >= 60s、active-motion 覆盖 >= 0.7、合理采样步距 >= 25m、移动步数 >= 8、bbox 展开 >= 25m 时，抽稀为 motion_supported_low_quality',
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
      '低速点必须有近期运动证据才能进入轨迹，低精度点必须有 GNSS usedInFix 和位移下限才能被救援',
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
    barometerCleaningEnabled: document.querySelector('#barometerCleaningEnabled')
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
elements.applyConfigButton.addEventListener('click', applyCleaningConfig);
elements.resetConfigButton.addEventListener('click', resetCleaningConfig);
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
  const text = await file.text();
  const model = parseEvidenceJsonl(text, filePath);
  const targetProduct = buildTargetTrackProduct(model, { config: state.cleaningConfig });
  return {
    id: `dataset-${index + 1}`,
    fileName: file.name,
    filePath,
    color: COLORS[index % COLORS.length],
    model,
    targetProduct,
    targetOutput: buildTargetOutput(model, targetProduct),
    visible: true
  };
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

function applyCleaningConfig() {
  state.cleaningConfig = normalizeTargetProductConfig(readConfigInputs());
  recomputeTargetProducts();
  renderConfigInputs();
  setImportText(state.datasets.length
    ? `已应用自定义清洗参数，重新计算 ${state.datasets.length} 个文件`
    : '已应用自定义清洗参数，等待导入 evidence.jsonl');
  render();
}

function resetCleaningConfig() {
  state.cleaningConfig = normalizeTargetProductConfig(DEFAULT_TARGET_PRODUCT_CONFIG);
  recomputeTargetProducts();
  renderConfigInputs();
  setImportText(state.datasets.length
    ? `已恢复默认清洗参数，重新计算 ${state.datasets.length} 个文件`
    : '已恢复默认清洗参数，等待导入 evidence.jsonl');
  render();
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

function recomputeTargetProducts() {
  for (const dataset of state.datasets) {
    dataset.targetProduct = buildTargetTrackProduct(dataset.model, { config: state.cleaningConfig });
    dataset.targetOutput = buildTargetOutput(dataset.model, dataset.targetProduct);
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
        <b>清洗结果</b>
        ${targetProductSummaryRows(dataset).map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
      </div>
      <div class="algorithm-section">
        <b>当前参数</b>
        <span>弱点云 ${formatPlainNumber(config.weakCloudAccuracyMeters)}m；GAP ${formatPlainNumber(config.gapSeconds)}s；静止基础距离 ${formatPlainNumber(config.stationaryDistanceMeters)}m</span>
        <span>accuracy 上限 ${formatPlainNumber(config.maxIntakeAccuracyMeters)}m；气压阻止静止整段压缩 ${config.barometerCleaningEnabled ? '开启' : '关闭'}</span>
      </div>
      <button id="openAlgorithmDialogButton" class="secondary-button" type="button">查看完整规则说明</button>
    </section>
  `;
}

function targetProductSummaryRows(dataset) {
  if (!dataset) return ['导入 evidence.jsonl 后显示里程、运动里程、疑似交通里程和运动耗时'];
  const stats = dataset.targetProduct.stats;
  return [
    `文件 ${dataset.fileName}`,
    `里程 ${formatMeters(stats.routeDistanceMeters)}`,
    `运动里程 ${formatMeters(stats.totalDistanceMeters)}`,
    `疑似交通里程 ${formatMeters(stats.suspectedDistanceMeters)}`,
    `运动耗时 ${formatDuration(stats.movingTimeSeconds)}`
  ];
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
      `疑似交通里程 ${formatMeters(dataset.targetProduct.stats.suspectedDistanceMeters)}`
    ])}
  `;
}

function pointDetailsMarkup(dataset, point) {
  const recomputedDecision = rawPointDecision(dataset, point);
  const decision = recomputedDecision || point.decision || {};
  const context = point.diagnosticContext || {};
  const snapshot = point.gnss;
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
    ${detailBlock('GNSS 证据', [
      `snapshotId ${valueOrDash(decision.sourceGnssSnapshotId ?? point.sourceGnssSnapshotId)}`,
      `used/visible ${valueOrDash(snapshot?.usedInFixTotal)} / ${valueOrDash(snapshot?.visibleTotal)}`,
      `usedAvgCn0 ${formatCn0(snapshot?.usedAvgCn0)}`,
      `top4AvgCn0 ${formatCn0(snapshot?.top4AvgCn0)}`,
      `snapshot age ${formatNanos(point.sourceGnssSnapshotAgeNanos)}`,
      `stale ${point.gnssQualityStale ? 'yes' : 'no'}`
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
  state.map.addSource('raw-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('trusted-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('cleaned-points', { type: 'geojson', data: emptyFeatureCollection() });
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
  state.map.on('mouseenter', 'points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseenter', 'cleaned-points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'points', () => {
    state.map.getCanvas().style.cursor = '';
  });
  state.map.on('mouseleave', 'cleaned-points', () => {
    state.map.getCanvas().style.cursor = '';
  });
}

function renderMap() {
  if (!state.mapLoaded) return;
  const visible = state.datasets.filter((dataset) => dataset.visible);
  state.map.getSource('raw-lines').setData(elements.showRaw.checked ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(elements.showTrusted.checked ? trustedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('cleaned-lines').setData(elements.showCleaned.checked ? cleanedFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('cleaned-points').setData(
    elements.showCleaned.checked && elements.showCleanedPoints.checked
      ? cleanedPointFeatureCollection(visible)
      : emptyFeatureCollection());
  state.map.getSource('points').setData(elements.showPoints.checked ? pointFeatureCollection(visible) : emptyFeatureCollection());
}

function rawFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets
      .filter((dataset) => dataset.model.points.length > 1)
      .map((dataset) => lineFeature(dataset, dataset.model.points, 'raw'))
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
      .filter((dataset) => dataset.targetProduct.track.length > 1)
      .map((dataset) => lineFeature(dataset, dataset.targetProduct.track, 'cleaned'))
  };
}

function pointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => dataset.model.points.map((point) => {
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
    features: datasets.flatMap((dataset) => dataset.targetProduct.track.map((point) => ({
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

function lineFeature(dataset, points, kind, segmentId = null) {
  return {
    type: 'Feature',
    properties: { datasetId: dataset.id, kind, color: dataset.color, segmentId },
    geometry: { type: 'LineString', coordinates: points.map(lngLat) }
  };
}

function selectPoint(datasetId, rawPointId, showPopup = false) {
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.model.points.find((item) => item.rawPointId === rawPointId);
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

function rawPointDecision(dataset, point) {
  if (!dataset?.targetProduct || !point) return null;
  const rawPointId = point.rawPointId;
  const trusted = dataset.targetProduct.track
    .find((item) => item.sourceRawPointId === rawPointId);
  if (trusted) {
    return {
      ...trusted,
      kind: trusted.result,
      source: 'targetProduct.track'
    };
  }
  const contributingTrusted = dataset.targetProduct.track
    .find((item) => (item.contributingRawPointIds || []).includes(rawPointId));
  const weak = dataset.targetProduct.excluded.weak
    .find((item) => item.rawPointId === rawPointId);
  if (weak) {
    return {
      ...weak,
      kind: 'weak',
      source: 'targetProduct.excluded.weak'
    };
  }
  const rejected = dataset.targetProduct.excluded.rejected
    .find((item) => item.rawPointId === rawPointId);
  if (rejected) {
    return {
      ...rejected,
      kind: 'reject',
      source: 'targetProduct.excluded.rejected'
    };
  }
  const intakeRejected = dataset.targetProduct.excluded.intakeRejected
    .find((item) => item.rawPointId === rawPointId);
  if (intakeRejected) {
    return {
      ...intakeRejected,
      kind: 'intake_rejected',
      source: 'targetProduct.excluded.intakeRejected'
    };
  }
  if (contributingTrusted) {
    return {
      ...contributingTrusted,
      kind: contributingTrusted.result,
      source: 'targetProduct.track.contributingRawPointIds'
    };
  }
  return null;
}

function selectCleanedPoint(datasetId, trackPointId, showPopup = false) {
  const dataset = state.datasets.find((item) => item.id === datasetId);
  const point = dataset?.targetProduct.track.find((item) => item.trackPointId === trackPointId);
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

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function formatMeters(value) {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${value.toFixed(1)} m`;
}

function formatAscent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}m` : '证据不足';
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

function formatCn0(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} dB-Hz` : '-';
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
