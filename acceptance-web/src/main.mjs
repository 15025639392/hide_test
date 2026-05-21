import {
  buildTargetOutput,
  formatDuration,
  isDiagnosticCandidatePath,
  isDiagnosticJsonlPath,
  parseDiagnosticJsonl
} from './diagnosticMap.mjs';

const COLORS = ['#2dd4bf', '#fb7185', '#facc15', '#60a5fa', '#c084fc', '#34d399', '#f97316', '#e879f9'];

const state = {
  datasets: [],
  selectedDatasetId: null,
  selectedPoint: null,
  map: null,
  mapLoaded: false,
  popup: null
};

const elements = {
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  fitBoundsButton: document.querySelector('#fitBoundsButton'),
  clearButton: document.querySelector('#clearButton'),
  showRaw: document.querySelector('#showRaw'),
  showTrusted: document.querySelector('#showTrusted'),
  showPoints: document.querySelector('#showPoints'),
  importText: document.querySelector('#importText'),
  datasetCountText: document.querySelector('#datasetCountText'),
  datasetRows: document.querySelector('#datasetRows'),
  selectedFileText: document.querySelector('#selectedFileText'),
  sampleSummary: document.querySelector('#sampleSummary'),
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
for (const input of [elements.showRaw, elements.showTrusted, elements.showPoints]) {
  input.addEventListener('change', renderMap);
}

initMap();
render();

async function importFiles(files, fromDirectory) {
  const diagnosticFiles = files
    .filter((file) => {
      const path = file.webkitRelativePath || file.name;
      return fromDirectory ? isDiagnosticJsonlPath(path) : isDiagnosticCandidatePath(path);
    })
    .sort((left, right) =>
      (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name));
  const datasets = [];
  for (const file of diagnosticFiles) {
    datasets.push(await readDiagnosticFile(file, datasets.length));
  }
  state.datasets = datasets;
  state.selectedDatasetId = datasets[0]?.id || null;
  state.selectedPoint = null;
  elements.importText.textContent = `找到 ${diagnosticFiles.length} 个 diagnostic.jsonl，已导入 ${datasets.length} 个`;
  render();
  fitAllBounds();
}

async function readDiagnosticFile(file, index) {
  const filePath = file.webkitRelativePath || file.name;
  const text = await file.text();
  const model = parseDiagnosticJsonl(text, filePath);
  return {
    id: `dataset-${index + 1}`,
    fileName: file.name,
    filePath,
    color: COLORS[index % COLORS.length],
    model,
    targetOutput: buildTargetOutput(model),
    visible: true
  };
}

function clearAll() {
  state.datasets = [];
  state.selectedDatasetId = null;
  state.selectedPoint = null;
  elements.folderInput.value = '';
  elements.fileInput.value = '';
  elements.importText.textContent = '等待导入 diagnostic.jsonl';
  if (state.popup) state.popup.remove();
  render();
  renderMap();
}

function render() {
  renderDatasets();
  renderSelectedSummary();
  renderPointDetails();
  renderMap();
}

function renderDatasets() {
  elements.datasetCountText.textContent = `${state.datasets.length} 个`;
  if (state.datasets.length === 0) {
    elements.datasetRows.innerHTML = '<p class="empty-note">导入一个或多个 diagnostic.jsonl</p>';
    return;
  }
  elements.datasetRows.innerHTML = state.datasets.map((dataset) => datasetRowMarkup(dataset)).join('');
  for (const row of elements.datasetRows.querySelectorAll('[data-dataset-id]')) {
    row.addEventListener('click', () => {
      state.selectedDatasetId = row.dataset.datasetId;
      state.selectedPoint = null;
      if (state.popup) state.popup.remove();
      render();
      focusDataset(selectedDataset());
    });
  }
  for (const checkbox of elements.datasetRows.querySelectorAll('[data-visible-id]')) {
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      const dataset = state.datasets.find((item) => item.id === checkbox.dataset.visibleId);
      if (dataset) dataset.visible = checkbox.checked;
      renderMap();
    });
  }
}

function datasetRowMarkup(dataset) {
  const output = dataset.targetOutput;
  return `
    <button class="dataset-row ${dataset.id === state.selectedDatasetId ? 'selected' : ''}" type="button" data-dataset-id="${dataset.id}">
      <span class="file-cell"><i style="background:${dataset.color}"></i><b>${escapeHtml(dataset.fileName)}</b></span>
      <span>${escapeHtml(dataset.model.deviceLabel || '-')}</span>
      <span>${output.trackPointCount}</span>
      <span>${formatMeters(output.totalDistanceMeters)}</span>
      <span>${formatDuration(output.movingTimeSeconds)}</span>
      <span>${formatPace(output.paceSecondsPerKm)}</span>
      <span>${formatAscent(output.selectedTotalAscentMeters)}</span>
      <input data-visible-id="${dataset.id}" type="checkbox" ${dataset.visible ? 'checked' : ''} aria-label="显示 ${escapeHtml(dataset.fileName)}" />
    </button>
  `;
}

function renderSelectedSummary() {
  const dataset = selectedDataset();
  elements.selectedFileText.textContent = dataset ? dataset.fileName : '-';
  if (!dataset) {
    elements.sampleSummary.innerHTML = '<p class="empty-note">选择文件后查看 raw、decision、GNSS、pressure、motion 摘要</p>';
    return;
  }
  const { summaries, findings } = dataset.targetOutput;
  elements.sampleSummary.innerHTML = `
    ${summaryBlock('raw_location', [
      `数量 ${summaries.raw.count}`,
      `时间范围 ${formatNanoRange(summaries.raw.timeStartNanos, summaries.raw.timeEndNanos)}`,
      `精度 ${formatMeters(summaries.raw.minAccuracyMeters)} - ${formatMeters(summaries.raw.maxAccuracyMeters)}`,
      `未解释 ${summaries.raw.unexplainedCount}`
    ])}
    ${summaryBlock('decision', [
      `数量 ${summaries.decision.decisionCount}`,
      `anchor ${summaries.decision.anchorCount} / accept ${summaries.decision.acceptCount}`,
      `weak ${summaries.decision.weakCount} / reject ${summaries.decision.rejectCount}`,
      `intake ${summaries.decision.intakeRejectedCount}`,
      `主要 reason ${summaries.decision.topReasons.map((item) => item.reason).join(', ') || '-'}`
    ])}
    ${summaryBlock('GNSS', [
      `snapshot ${summaries.gnss.snapshotCount}`,
      `used-in-fix 平均 ${formatOneDecimal(summaries.gnss.averageUsedInFixTotal)}`,
      `usedAvgCn0 ${formatCn0(summaries.gnss.averageUsedAvgCn0)} / top4 ${formatCn0(summaries.gnss.averageTop4AvgCn0)}`,
      `stale ${summaries.gnss.staleRawCount} (${formatPercent(summaries.gnss.staleRawRatio)})`
    ])}
    ${summaryBlock('pressure', [
      `样本 ${summaries.pressure.pressureSampleCount}`,
      `拒绝 ${summaries.pressure.pressureRejectedCount}`,
      `selected ${formatAscent(summaries.pressure.selectedTotalAscentMeters)}`,
      `barometer ${formatAscent(summaries.pressure.barometerTotalAscentMeters)} / GNSS ${formatAscent(summaries.pressure.gnssTotalAscentMeters)}`
    ])}
    ${summaryBlock('motion', [
      `motion_summary ${summaries.motion.motionSummaryCount}`,
      `still ${summaries.motion.stillCount} (${formatPercent(summaries.motion.stillRatio)})`,
      `stationary/recovery 相关 ${summaries.motion.stationaryEvidenceCount}`
    ])}
    ${findings.length ? summaryBlock('findings', findings) : ''}
  `;
}

function summaryBlock(title, rows) {
  return `
    <section class="summary-block">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => `<span>${escapeHtml(row)}</span>`).join('')}
    </section>
  `;
}

function renderPointDetails() {
  const selection = state.selectedPoint;
  elements.selectedPointText.textContent = selection ? `${selection.dataset.fileName} #${selection.point.rawPointId}` : '-';
  if (!selection) {
    elements.pointDetails.innerHTML = '<p class="empty-note">点击地图上的点查看 raw、decision/intake、GNSS 和上一可信点关系</p>';
    return;
  }
  elements.pointDetails.innerHTML = pointDetailsMarkup(selection.dataset, selection.point);
}

function pointDetailsMarkup(dataset, point) {
  const decision = point.decision || {};
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
    ${detailBlock('decision / intake', [
      `result ${decision.result || 'raw'}`,
      `reason ${decision.reason || '-'}`,
      `trustGrade ${decision.trustGrade || '-'}`,
      `cloudType ${decision.cloudType || '-'}`,
      `cloudId ${valueOrDash(decision.cloudId)}`,
      `trackPointId ${valueOrDash(decision.trackPointId)}`,
      `segmentId ${valueOrDash(decision.segmentId)}`,
      decision.intakeRejected ? '不进入点云 / decision / TrackPoint' : ''
    ].filter(Boolean))}
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
    ${point.insights?.length ? detailBlock('解释', point.insights.map((item) => item.text)) : ''}
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
}

function bindMapEvents() {
  state.map.on('click', 'points', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    selectPoint(String(feature.properties.datasetId), Number(feature.properties.rawPointId), true);
  });
  state.map.on('mouseenter', 'points', () => {
    state.map.getCanvas().style.cursor = 'pointer';
  });
  state.map.on('mouseleave', 'points', () => {
    state.map.getCanvas().style.cursor = '';
  });
}

function renderMap() {
  if (!state.mapLoaded) return;
  const visible = state.datasets.filter((dataset) => dataset.visible);
  state.map.getSource('raw-lines').setData(elements.showRaw.checked ? rawFeatureCollection(visible) : emptyFeatureCollection());
  state.map.getSource('trusted-lines').setData(elements.showTrusted.checked ? trustedFeatureCollection(visible) : emptyFeatureCollection());
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

function pointFeatureCollection(datasets) {
  return {
    type: 'FeatureCollection',
    features: datasets.flatMap((dataset) => dataset.model.points.map((point) => ({
      type: 'Feature',
      properties: {
        datasetId: dataset.id,
        rawPointId: point.rawPointId,
        kind: point.kind,
        color: dataset.color,
        selected: state.selectedPoint?.dataset.id === dataset.id
          && state.selectedPoint?.point.rawPointId === point.rawPointId
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
  state.selectedPoint = { dataset, point };
  if (showPopup && state.popup) {
    state.popup
      .setLngLat(lngLat(point))
      .setHTML(`<strong>${escapeHtml(dataset.fileName)}</strong><br/>Raw#${point.rawPointId} ${escapeHtml(point.decision?.result || 'raw')}<br/>${escapeHtml(point.decision?.reason || '-')}`)
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
  return Number.isFinite(value) ? `${value.toFixed(1)}m` : '-';
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

function formatSpeed(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} m/s` : '-';
}

function formatCn0(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} dB-Hz` : '-';
}

function formatOneDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '-';
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
