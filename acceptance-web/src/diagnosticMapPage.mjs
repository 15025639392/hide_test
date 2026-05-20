import {
  formatDuration,
  isDiagnosticJsonlPath,
  parseDiagnosticJsonl
} from './diagnosticMap.mjs';
import { formatMeters } from './evaluator.mjs';

const state = {
  model: null,
  selectedRawPointId: null,
  timelineFilter: 'all',
  map: null,
  mapLoaded: false,
  popup: null,
  reasonChart: null
};

const elements = {
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  importText: document.querySelector('#importText'),
  rawDecisionText: document.querySelector('#rawDecisionText'),
  rawDecisionHint: document.querySelector('#rawDecisionHint'),
  decisionMixText: document.querySelector('#decisionMixText'),
  decisionMixHint: document.querySelector('#decisionMixHint'),
  distanceTimeText: document.querySelector('#distanceTimeText'),
  distanceTimeHint: document.querySelector('#distanceTimeHint'),
  evidenceText: document.querySelector('#evidenceText'),
  evidenceHint: document.querySelector('#evidenceHint'),
  mapView: document.querySelector('#mapView'),
  pointDetails: document.querySelector('#pointDetails'),
  timelineDrawer: document.querySelector('#timelineDrawer'),
  toggleTimeline: document.querySelector('#toggleTimeline'),
  timelineFilters: Array.from(document.querySelectorAll('.timeline-filter')),
  showRaw: document.querySelector('#showRaw'),
  showReject: document.querySelector('#showReject'),
  showWeak: document.querySelector('#showWeak'),
  showLabels: document.querySelector('#showLabels'),
  sessionMetaText: document.querySelector('#sessionMetaText'),
  filePathText: document.querySelector('#filePathText'),
  deviceText: document.querySelector('#deviceText'),
  strategyText: document.querySelector('#strategyText'),
  parseErrorText: document.querySelector('#parseErrorText'),
  reasonCountText: document.querySelector('#reasonCountText'),
  reasonList: document.querySelector('#reasonList'),
  reasonChart: document.querySelector('#reasonChart'),
  evidenceStatusText: document.querySelector('#evidenceStatusText'),
  evidenceMetricText: document.querySelector('#evidenceMetricText'),
  evidenceMetricList: document.querySelector('#evidenceMetricList'),
  findingList: document.querySelector('#findingList'),
  timelineText: document.querySelector('#timelineText'),
  timelineRows: document.querySelector('#timelineRows')
};

elements.folderInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  const diagnosticFile = preferredDiagnosticFile(files);
  if (!diagnosticFile) {
    elements.importText.textContent = '目录内没有可读取文件';
    return;
  }
  await importDiagnosticFile(diagnosticFile);
});

elements.fileInput.addEventListener('change', async (event) => {
  const [file] = Array.from(event.target.files || []);
  if (file) {
    await importDiagnosticFile(file);
  }
});

for (const input of [elements.showRaw, elements.showReject, elements.showWeak, elements.showLabels]) {
  input.addEventListener('change', () => renderMap(false));
}

elements.toggleTimeline.addEventListener('click', () => {
  const isOpen = elements.timelineDrawer.classList.toggle('open');
  elements.toggleTimeline.textContent = isOpen ? '收起' : '展开';
  elements.toggleTimeline.setAttribute('aria-expanded', String(isOpen));
  setTimeout(() => state.map?.resize(), 180);
});

for (const button of elements.timelineFilters) {
  button.addEventListener('click', () => {
    state.timelineFilter = button.dataset.filter || 'all';
    renderTimeline();
  });
}

initMap();

async function importDiagnosticFile(file) {
  const path = file.webkitRelativePath || file.name;
  const text = await file.text();
  state.model = parseDiagnosticJsonl(text, path);
  state.selectedRawPointId = null;
  elements.importText.textContent = `已导入 ${path}`;
  render();
}

function preferredDiagnosticFile(files) {
  return files.find((file) => isDiagnosticJsonlPath(file.webkitRelativePath || file.name))
    || files.find((file) => file.size > 0)
    || files[0];
}

function render() {
  renderSummary();
  renderSession();
  renderMap();
  renderReasons();
  renderEvidence();
  renderTimeline();
}

function renderSummary() {
  const summary = state.model?.summary;
  if (!summary) {
    return;
  }
  elements.rawDecisionText.textContent = `${summary.rawCount} / ${summary.decisionCount}`;
  elements.decisionMixText.textContent = `${summary.trustedCount} / ${summary.rejectedCount} / ${summary.weakCount}`;
  elements.distanceTimeText.textContent = `${formatMeters(summary.totalDistanceMeters)} / ${formatDuration(summary.movingTimeSeconds)}`;
  elements.evidenceText.textContent = `${summary.linkedGnssPointCount} / ${summary.staleRawCount}`;
  elements.rawDecisionHint.textContent = `未判定 ${summary.undecidedCount} · 解析错误 ${summary.parseErrorCount}`;
  elements.decisionMixHint.textContent = `可信率 ${formatPercent(ratio(summary.trustedCount, summary.decisionCount))} · 原因 ${state.model.reasonCounts.length} 类`;
  elements.distanceTimeHint.textContent = `诊断时长 ${formatDuration(summary.durationSeconds)} · GAP ${summary.gapRecoveryCount}`;
  elements.evidenceHint.textContent = `Snapshot ${summary.gnssSnapshotCount} · no-location ${summary.noLocationTimeoutCount}`;
}

function renderSession() {
  const model = state.model;
  if (!model) {
    return;
  }
  elements.sessionMetaText.textContent = model.sessionId || '-';
  elements.filePathText.textContent = model.filePath || '-';
  elements.deviceText.textContent = model.deviceLabel || '-';
  elements.strategyText.textContent = model.strategyVersion || '-';
  elements.parseErrorText.textContent = String(model.summary.parseErrorCount);
}

function renderMap(shouldFitBounds = true) {
  const model = state.model;
  if (!state.map || !state.mapLoaded) {
    return;
  }

  if (!model || model.points.length === 0) {
    elements.pointDetails.textContent = '等待 diagnostic.jsonl';
    updateMapData(emptyFeatureCollection(), emptyFeatureCollection(), emptyFeatureCollection());
    state.map.jumpTo({ center: [104.06, 30.65], zoom: 12 });
    return;
  }

  updateMapData(
    rawLineFeatureCollection(model),
    trustedLineFeatureCollection(model),
    pointFeatureCollection(model)
  );
  updateLayerVisibility();
  if (shouldFitBounds) {
    fitModelBounds(model);
  }
}

function renderReasons() {
  const reasons = state.model?.reasonCounts || [];
  elements.reasonCountText.textContent = `${reasons.length} 类`;
  if (reasons.length === 0) {
    elements.reasonList.innerHTML = '<p class="empty-note">没有判定原因</p>';
    renderReasonChart([]);
    return;
  }
  const visibleReasons = reasons.slice(0, 8);
  renderReasonChart(visibleReasons);
  elements.reasonList.innerHTML = visibleReasons.map((item) => {
    const [result, reason] = splitReasonKey(item.reason);
    const explanation = item.explanation || { title: reason, meaning: '', evidence: '' };
    return `
      <article class="reason-row compact ${escapeHtml(result)}">
        <div class="reason-row-main">
          <span class="reason-result">${resultLabel(result)}</span>
          <strong>${escapeHtml(explanation.title)}</strong>
          <span class="reason-code">${escapeHtml(reason)}</span>
          <p>${escapeHtml(explanation.meaning)}</p>
        </div>
        <span class="reason-count">${item.count}</span>
      </article>
    `;
  }).join('');
}

function renderEvidence() {
  const evidence = state.model?.evidence;
  if (!evidence) {
    return;
  }
  const findings = evidence.findings || [];
  const worstLevel = worstFindingLevel(findings);
  elements.evidenceStatusText.textContent = findingLevelLabel(worstLevel);
  elements.evidenceStatusText.className = `finding-status ${worstLevel}`;
  elements.findingList.innerHTML = findings.map((finding) => `
    <article class="finding-row ${escapeHtml(finding.level)}">
      <strong>${escapeHtml(finding.title)}</strong>
      <span>${escapeHtml(finding.detail)}</span>
    </article>
  `).join('');

  const metrics = evidence.metrics;
  const rows = [
    {
      label: '原始点 / 判定',
      value: `${metrics.rawCount} / ${metrics.decisionCount}`,
      note: '每个 raw_location 都应有对应 decision；数量不一致时，不能保证每个系统定位点都有进入、拒绝或弱化解释。'
    },
    {
      label: '可解释 GNSS Snapshot',
      value: `${metrics.explainableGnssSnapshotCount} / ${metrics.gnssSnapshotCount}`,
      note: '前一个数字表示含 C/N0、top4、弱信号等 Phase 6 指标的 snapshot；它越高，弱 GPS 解释越有证据。'
    },
    {
      label: 'weak 关联 GNSS',
      value: `${metrics.weakGnssLinkedCount} / ${state.model.summary.weakCount}`,
      note: 'weak 点能回连到卫星质量快照时，才能判断弱化是否伴随低 C/N0、低 used 卫星数或 snapshot 过期。'
    },
    {
      label: 'reject 关联 GNSS',
      value: `${metrics.rejectGnssLinkedCount} / ${state.model.summary.rejectedCount}`,
      note: 'reject 点有 GNSS 证据时，可以辅助区分弱信号漂移、静止抖动、跳点和疑似交通工具移动。'
    },
    {
      label: '过期 raw',
      value: `${metrics.staleRawCount} (${formatPercent(metrics.staleRawRatio)})`,
      note: '表示 raw_location 关联到过期 GNSS snapshot 的比例；比例高时，卫星质量解释存在缺口。'
    },
    {
      label: 'GAP / 无定位',
      value: `${metrics.gapRecoveryCount} / ${metrics.noLocationTimeoutCount}`,
      note: '分别表示 gap_recovery 决策和 no_location_timeout 事件；用于判断长时间断点是否来自系统无回调或后台采样。'
    },
    {
      label: '采样策略事件',
      value: String(metrics.samplingPolicyCount),
      note: '记录系统定位请求状态变化；排查 GAP、后台限制或采样间隔异常时需要它。'
    },
    {
      label: '运动摘要',
      value: String(metrics.motionSummaryCount),
      note: 'motion_summary 用于解释静止、休息和 stationary/rest 相关拒绝点，帮助区分真实静止和 GPS 漂移。'
    }
  ];
  elements.evidenceMetricText.textContent = `${rows.length} 项`;
  elements.evidenceMetricList.innerHTML = rows.map(({ label, value, note }) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>
        <strong>${escapeHtml(value)}</strong>
        <span class="metric-note">${escapeHtml(note)}</span>
      </dd>
    </div>
  `).join('');
}

function renderReasonChart(reasons) {
  if (!window.Chart || !elements.reasonChart) {
    return;
  }
  const labels = reasons.map((item) => resultLabel(splitReasonKey(item.reason)[0]));
  const values = reasons.map((item) => item.count);
  const colors = reasons.map((item) => resultColor(splitReasonKey(item.reason)[0]));

  if (!state.reasonChart) {
    state.reasonChart = new Chart(elements.reasonChart, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${context.parsed}`
            }
          }
        }
      }
    });
    return;
  }
  state.reasonChart.data.labels = labels;
  state.reasonChart.data.datasets[0].data = values;
  state.reasonChart.data.datasets[0].backgroundColor = colors;
  state.reasonChart.update();
}

function renderTimeline() {
  const items = state.model?.timelineItems || [];
  const filteredItems = items.filter(matchesTimelineFilter);
  elements.timelineText.textContent = `${filteredItems.length} / ${items.length} 条记录`;
  renderTimelineFilters();
  if (items.length === 0) {
    elements.timelineRows.innerHTML = '<p class="empty-note">上传 diagnostic.jsonl 开始分析</p>';
    return;
  }
  if (filteredItems.length === 0) {
    elements.timelineRows.innerHTML = '<p class="empty-note">当前筛选没有匹配点</p>';
    return;
  }
  elements.timelineRows.innerHTML = filteredItems.map(timelineItemMarkup).join('');
  for (const item of elements.timelineRows.querySelectorAll('[data-raw-point-id]')) {
    item.addEventListener('click', () => selectPoint(Number(item.dataset.rawPointId)));
  }
}

function renderTimelineFilters() {
  for (const button of elements.timelineFilters) {
    button.classList.toggle('active', button.dataset.filter === state.timelineFilter);
  }
}

function matchesTimelineFilter(item) {
  if (state.timelineFilter === 'all') {
    return true;
  }
  if (state.timelineFilter === 'event') {
    return item.type === 'event';
  }
  if (item.type !== 'point') {
    return false;
  }
  const point = item.point;
  if (state.timelineFilter === 'trusted') {
    return point.kind === 'anchor' || point.kind === 'accept';
  }
  return point.kind === state.timelineFilter;
}

function selectPoint(rawPointId, options = {}) {
  state.selectedRawPointId = rawPointId;
  const point = state.model.points.find((item) => item.rawPointId === rawPointId);
  elements.pointDetails.innerHTML = point ? pointDetailsMarkup(point) : '没有选中点';
  if (point && state.map) {
    state.map.easeTo({ center: pointLngLat(point), duration: 300 });
    if (options.showPopup) {
      showPointPopup(point);
    }
  }
  renderMap(false);
  renderTimeline();
}

function pointDetailsMarkup(point) {
  const decision = point.decision || {};
  const explanation = decision.reasonExplanation || {};
  const context = point.diagnosticContext || {};
  return `
    <div class="point-detail-grid">
      <section class="point-detail-block main">
        <strong>#${point.rawPointId} ${escapeHtml(decision.result || 'raw')} ${escapeHtml(explanation.title || decision.reason || '')}</strong>
        <span>${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}</span>
        <span>reason ${escapeHtml(decision.reason || '-')}</span>
        <span>精度 ${formatMeters(point.accuracy)} · 海拔 ${formatAltitude(point)} · 速度 ${formatSpeed(point.speed)}</span>
        <span>判定 ${valueOrDash(decision.decisionId)} · 分段 ${valueOrDash(decision.segmentId)} · 距离 +${formatMeters(decision.distanceDeltaMeters)}</span>
      </section>
      <section class="point-detail-block">
        <b>上下文</b>
        <span>上一可信 Raw#${valueOrDash(context.previousTrustedRawPointId)} · 间隔 ${formatDuration(context.deltaSecondsFromPreviousTrusted)} · 直线 ${formatMeters(context.distanceFromPreviousTrustedMeters)}</span>
        <span>推算速度 ${formatSpeed(context.requiredSpeedMetersPerSecond)} · 新分段 ${decision.startsNewSegment ? '是' : '否'}</span>
      </section>
      <section class="point-detail-block">
        <b>GNSS 证据</b>
        ${gnssEvidenceMarkup(point)}
      </section>
      <section class="point-detail-block insights">
        <b>解释</b>
        ${reasonExplanationMarkup(explanation)}
        ${pointInsightsMarkup(point)}
      </section>
    </div>
  `;
}

function showPointPopup(point) {
  const decision = point.decision || {};
  state.popup
    .setLngLat(pointLngLat(point))
    .setHTML(`
      <div class="map-popup">
        <strong>#${point.rawPointId} ${escapeHtml(decision.result || 'raw')}</strong>
        <span>${escapeHtml(decision.reasonExplanation?.title || decision.reason || '-')}</span>
        <dl>
          <div><dt>坐标</dt><dd>${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}</dd></div>
          <div><dt>精度</dt><dd>${formatMeters(point.accuracy)}</dd></div>
          <div><dt>海拔</dt><dd>${formatAltitude(point)}</dd></div>
          <div><dt>速度</dt><dd>${formatSpeed(point.speed)}</dd></div>
          <div><dt>状态</dt><dd>${escapeHtml(decision.state || '-')}</dd></div>
          <div><dt>分段</dt><dd>${valueOrDash(decision.segmentId)}</dd></div>
          <div><dt>距离增量</dt><dd>${formatMeters(decision.distanceDeltaMeters)}</dd></div>
          <div><dt>Reason</dt><dd>${escapeHtml(decision.reason || '-')}</dd></div>
          <div><dt>GNSS</dt><dd>${popupGnssText(point)}</dd></div>
        </dl>
      </div>
    `)
    .addTo(state.map);
}

function initMap() {
  if (!window.maplibregl) {
    elements.mapView.innerHTML = '<div class="map-fallback">地图组件加载失败，请检查网络后刷新页面</div>';
    return;
  }
  state.map = new maplibregl.Map({
    container: elements.mapView,
    center: [104.06, 30.65],
    zoom: 12,
    maxZoom: 21,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        googleSatellite: {
          type: 'raster',
          tiles: ['https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
          tileSize: 256,
          attribution: 'Imagery © Google'
        }
      },
      layers: [
        {
          id: 'google-satellite',
          type: 'raster',
          source: 'googleSatellite'
        }
      ]
    }
  });
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  state.popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: '360px',
    offset: 12
  });
  state.map.on('load', () => {
    state.mapLoaded = true;
    addDiagnosticSourcesAndLayers();
    bindMapInteractions();
    renderMap();
  });
}

function addDiagnosticSourcesAndLayers() {
  state.map.addSource('raw-line', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('trusted-lines', { type: 'geojson', data: emptyFeatureCollection() });
  state.map.addSource('diagnostic-points', { type: 'geojson', data: emptyFeatureCollection() });

  state.map.addLayer({
    id: 'raw-line',
    type: 'line',
    source: 'raw-line',
    paint: {
      'line-color': '#d7e1e3',
      'line-width': 2,
      'line-opacity': 0.82,
      'line-dasharray': [2, 2.4]
    }
  });
  state.map.addLayer({
    id: 'trusted-lines',
    type: 'line',
    source: 'trusted-lines',
    paint: {
      'line-color': '#33c36b',
      'line-width': 5,
      'line-opacity': 0.95
    }
  });
  state.map.addLayer({
    id: 'diagnostic-points',
    type: 'circle',
    source: 'diagnostic-points',
    paint: {
      'circle-color': [
        'match',
        ['get', 'kind'],
        'anchor', '#33c36b',
        'accept', '#33c36b',
        'reject', '#e23b30',
        'weak', '#e1a72b',
        '#9aa8ac'
      ],
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], true], 5,
        ['==', ['get', 'kind'], 'raw'], 2.5,
        3.5
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], true], '#111827',
        '#ffffff'
      ],
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'selected'], true], 2,
        1
      ],
      'circle-opacity': 0.96
    }
  });
  state.map.addLayer({
    id: 'point-labels',
    type: 'symbol',
    source: 'diagnostic-points',
    layout: {
      'text-field': ['to-string', ['get', 'rawPointId']],
      'text-size': 11,
      'text-font': ['Open Sans Bold'],
      'text-offset': [0, -1.25],
      'text-allow-overlap': true
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#111827',
      'text-halo-width': 1.4
    }
  });
}

function bindMapInteractions() {
  state.map.on('click', (event) => {
    const features = state.map.queryRenderedFeatures(event.point, {
      layers: ['diagnostic-points']
    });
    if (features.length === 0) {
      clearPointSelection();
    }
  });
  state.map.on('click', 'diagnostic-points', (event) => {
    const feature = event.features?.[0];
    if (feature) {
      selectPoint(Number(feature.properties.rawPointId), { showPopup: true });
    }
  });
  state.map.on('mouseenter', 'diagnostic-points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'diagnostic-points', () => {
    state.map.getCanvas().style.cursor = '';
  });
}

function clearPointSelection() {
  state.selectedRawPointId = null;
  state.popup.remove();
  elements.pointDetails.textContent = '点击地图上的点查看诊断字段';
  renderMap(false);
  renderTimeline();
}

function updateMapData(rawLines, trustedLines, points) {
  state.map.getSource('raw-line').setData(rawLines);
  state.map.getSource('trusted-lines').setData(trustedLines);
  state.map.getSource('diagnostic-points').setData(points);
}

function updateLayerVisibility() {
  setLayerVisibility('raw-line', elements.showRaw.checked);
  setPointFilter();
  setLayerVisibility('point-labels', elements.showLabels.checked);
}

function setLayerVisibility(layerId, visible) {
  state.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function setPointFilter() {
  const hiddenKinds = [];
  if (!elements.showRaw.checked) hiddenKinds.push('raw');
  if (!elements.showReject.checked) hiddenKinds.push('reject');
  if (!elements.showWeak.checked) hiddenKinds.push('weak');
  const filter = hiddenKinds.length === 0
    ? null
    : ['!', ['in', ['get', 'kind'], ['literal', hiddenKinds]]];
  state.map.setFilter('diagnostic-points', filter);
  state.map.setFilter('point-labels', filter);
}

function fitModelBounds(model) {
  const bounds = model.bounds;
  if (!bounds) {
    return;
  }
  state.map.fitBounds(
    [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
    { padding: 52, maxZoom: 20, duration: 0 }
  );
}

function rawLineFeatureCollection(model) {
  if (model.points.length < 2) {
    return emptyFeatureCollection();
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: model.points.map(pointLngLat)
      }
    }]
  };
}

function trustedLineFeatureCollection(model) {
  return {
    type: 'FeatureCollection',
    features: model.segments
      .filter((segment) => segment.points.length > 1)
      .map((segment) => ({
        type: 'Feature',
        properties: { segmentId: segment.segmentId },
        geometry: {
          type: 'LineString',
          coordinates: segment.points.map(pointLngLat)
        }
      }))
  };
}

function pointFeatureCollection(model) {
  return {
    type: 'FeatureCollection',
    features: model.points.map((point) => ({
      type: 'Feature',
      properties: {
        rawPointId: point.rawPointId,
        kind: point.kind,
        selected: point.rawPointId === state.selectedRawPointId
      },
      geometry: {
        type: 'Point',
        coordinates: pointLngLat(point)
      }
    }))
  };
}

function pointLngLat(point) {
  return [point.lng, point.lat];
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function formatAltitude(point) {
  if (!Number.isFinite(point.altitude)) {
    return '-';
  }
  return `${point.altitude.toFixed(1)}m`;
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : '-';
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

function timelineItemMarkup(item) {
  if (item.type === 'event') {
    return `
      <article class="timeline-item event ${escapeHtml(item.kind)}">
        <span class="timeline-marker event"></span>
        <span class="timeline-main">
          <span class="timeline-title">
            <strong>${escapeHtml(item.title)}</strong>
            <i class="pill small event">event</i>
          </span>
          <span class="timeline-reason">${escapeHtml(item.detail || '-')}</span>
          <span class="timeline-meta">${formatTimelineTime(item.sortTime)}</span>
        </span>
      </article>
    `;
  }
  const point = item.point;
  const decision = point.decision || {};
  const explanation = decision.reasonExplanation || {};
  const linkedGnss = point.gnss ? 'GNSS yes' : 'GNSS no';
  return `
    <button class="timeline-item ${point.rawPointId === state.selectedRawPointId ? 'selected' : ''}" type="button" data-raw-point-id="${point.rawPointId}">
      <span class="timeline-marker ${point.kind}"></span>
      <span class="timeline-main">
        <span class="timeline-title">
          <strong>#${point.rawPointId}</strong>
          <i class="pill small ${point.kind}">${decision.result || 'raw'}</i>
        </span>
        <span class="timeline-reason">${escapeHtml(explanation.title || decision.reason || '-')}</span>
        <span class="timeline-meta">
          ${escapeHtml(decision.reason || 'raw')} · 精度 ${formatMeters(point.accuracy)} · ${linkedGnss} · stale ${point.gnssQualityStale ? 'yes' : 'no'}
        </span>
      </span>
    </button>
  `;
}

function reasonExplanationMarkup(explanation) {
  if (!explanation || (!explanation.meaning && !explanation.evidence)) {
    return '';
  }
  return `
    <span class="insight info">含义：${escapeHtml(explanation.meaning || '-')}</span>
    <span class="insight info">证据：${escapeHtml(explanation.evidence || '-')}</span>
  `;
}

function gnssEvidenceMarkup(point) {
  const snapshot = point.gnss;
  const rawBits = [
    `snapshot #${valueOrDash(point.decision?.sourceGnssSnapshotId ?? point.sourceGnssSnapshotId)}`,
    `stale ${point.gnssQualityStale ? 'yes' : 'no'}`,
    `age ${formatNanoseconds(point.sourceGnssSnapshotAgeNanos)}`
  ];
  if (!snapshot) {
    return `<span>${escapeHtml(rawBits.join(' · '))}</span><span class="warning-text">无可关联 GNSS snapshot</span>`;
  }
  const rows = [
    `used ${valueOrDash(snapshot.usedInFixTotal)} / visible ${valueOrDash(snapshot.visibleTotal)}`,
    `usedAvg ${formatCn0(snapshot.usedAvgCn0)} · top4 ${formatCn0(snapshot.top4AvgCn0)} · all ${formatCn0(snapshot.allAvgCn0)}`,
    `lowVisible ${valueOrDash(snapshot.lowCn0VisibleCount)} · weakUsed ${valueOrDash(snapshot.weakUsedCount)} · dualFreq ${snapshot.hasDualFrequency === true ? 'yes' : 'no'}`
  ];
  return `
    <span>${escapeHtml(rawBits.join(' · '))}</span>
    ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
  `;
}

function pointInsightsMarkup(point) {
  const insights = point.insights || [];
  return insights.map((insight) => `
    <span class="insight ${escapeHtml(insight.level)}">${escapeHtml(insight.text)}</span>
  `).join('');
}

function popupGnssText(point) {
  if (!point.gnss) {
    return '无关联 snapshot';
  }
  return `used=${valueOrDash(point.gnss.usedInFixTotal)}, usedAvg=${formatCn0(point.gnss.usedAvgCn0)}`;
}

function worstFindingLevel(findings) {
  const levels = findings.map((finding) => finding.level);
  if (levels.includes('fail')) return 'fail';
  if (levels.includes('review')) return 'review';
  if (levels.includes('info')) return 'info';
  return 'pass';
}

function findingLevelLabel(level) {
  if (level === 'fail') return '阻塞';
  if (level === 'review') return '需复核';
  if (level === 'info') return '提示';
  return '完整';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : Number.NaN;
}

function formatCn0(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} dB-Hz` : '-';
}

function formatNanoseconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number / 1_000_000_000).toFixed(1)}s` : '-';
}

function formatTimelineTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return '-';
  }
  return `t+${(number / 1_000_000_000).toFixed(1)}s`;
}

function splitReasonKey(value) {
  const text = String(value || '');
  const index = text.indexOf(':');
  if (index < 0) {
    return ['', text || '-'];
  }
  return [text.slice(0, index), text.slice(index + 1) || '-'];
}

function resultLabel(result) {
  if (result === 'anchor') return '锚点';
  if (result === 'accept') return '可信';
  if (result === 'reject') return '拒绝';
  if (result === 'weak') return '弱信号';
  return result || '未判定';
}

function resultColor(result) {
  if (result === 'anchor' || result === 'accept') return '#157347';
  if (result === 'reject') return '#b42318';
  if (result === 'weak') return '#a16207';
  return '#607075';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

renderMap();
