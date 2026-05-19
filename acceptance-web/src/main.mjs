import {
  deviceLabel,
  evaluateBatch,
  formatMeters,
  formatPercent,
  isSessionJsonPath,
  normalizeSession,
  reportToMarkdown
} from './evaluator.mjs';

const state = {
  sessions: [],
  report: null
};

const elements = {
  folderInput: document.querySelector('#folderInput'),
  fileInput: document.querySelector('#fileInput'),
  importText: document.querySelector('#importText'),
  verdictText: document.querySelector('#verdictText'),
  medianText: document.querySelector('#medianText'),
  maxDeviationText: document.querySelector('#maxDeviationText'),
  countText: document.querySelector('#countText'),
  ruleText: document.querySelector('#ruleText'),
  sessionRows: document.querySelector('#sessionRows'),
  downloadJson: document.querySelector('#downloadJson'),
  downloadMarkdown: document.querySelector('#downloadMarkdown'),
  clearData: document.querySelector('#clearData')
};

elements.folderInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  await importFiles(files, 'folder');
});

elements.fileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  await importFiles(files, 'files');
});

elements.clearData.addEventListener('click', () => {
  state.sessions = [];
  elements.folderInput.value = '';
  elements.fileInput.value = '';
  render();
});

elements.downloadJson.addEventListener('click', () => {
  if (state.report) {
    downloadText('ascent_consistency_report.json', JSON.stringify(state.report, null, 2));
  }
});

elements.downloadMarkdown.addEventListener('click', () => {
  if (state.report) {
    downloadText('ascent_consistency_report.md', reportToMarkdown(state.report));
  }
});

async function readSessionFile(file) {
  const path = file.webkitRelativePath || file.name;
  try {
    const text = await file.text();
    return normalizeSession(JSON.parse(text), path);
  } catch (error) {
    return {
      fileName: file.name,
      filePath: path,
      sessionId: path,
      strategyVersion: '',
      completionState: '',
      integrityState: '',
      selectedAscentSource: 'INVALID',
      barometerTotalAscentMeters: null,
      barometerAscentSampleCount: 0,
      barometerAscentRejectedSampleCount: 0,
      deviceManufacturer: '',
      deviceBrand: '',
      deviceModel: '',
      deviceName: '',
      androidSdkInt: 0,
      parseError: error.message
    };
  }
}

async function importFiles(files, source) {
  const sessionFiles = files.filter((file) => isSessionJsonPath(file.webkitRelativePath || file.name));
  const loaded = await Promise.all(sessionFiles.map(readSessionFile));
  state.sessions = loaded.filter(Boolean);
  render();
  if (source === 'folder') {
    elements.importText.textContent = `目录内找到 ${sessionFiles.length} 个 session.json，已导入 ${state.sessions.length} 个`;
  } else {
    elements.importText.textContent = `已导入 ${state.sessions.length} 个 session.json`;
  }
}

function render() {
  const report = evaluateBatch(state.sessions);
  state.report = report;
  renderSummary(report);
  renderRows(report);
  elements.downloadJson.disabled = state.sessions.length === 0;
  elements.downloadMarkdown.disabled = state.sessions.length === 0;
}

function renderSummary(report) {
  elements.verdictText.textContent = state.sessions.length ? report.verdict : '等待数据';
  elements.verdictText.className = `verdict ${report.verdict.toLowerCase()}`;
  elements.medianText.textContent = formatMeters(report.medianAscentMeters);
  elements.maxDeviationText.textContent =
    `${formatPercent(report.maxRelativeDeviation)} / ${formatMeters(report.maxAbsoluteDeviationMeters)}`;
  elements.countText.textContent = `${report.validDeviceCount} / ${report.excludedDeviceCount}`;
  const rule = report.rule;
  elements.ruleText.textContent =
    `自动识别：${report.deviceGroupLabel}，PASS <= ${formatPercent(rule.pass)}，REVIEW <= ${formatPercent(rule.review)}`;
}

function renderRows(report) {
  if (state.sessions.length === 0) {
    elements.sessionRows.innerHTML =
      '<tr><td colspan="9" class="empty">上传本批目录或多个 session.json 开始验收</td></tr>';
    return;
  }
  elements.sessionRows.innerHTML = report.devices.map((device) => {
    const detail = device.parseError
      ? `JSON 解析失败: ${device.parseError}`
      : (device.findings.join('; ') || '-');
    return `
      <tr>
        <td><span class="pill ${device.verdict.toLowerCase()}">${device.verdict}</span></td>
        <td>${escapeHtml(deviceLabel(device))}<small>${escapeHtml(device.deviceName || '-')}</small></td>
        <td>${escapeHtml(device.sessionId)}<small>${escapeHtml(device.filePath || device.fileName || '-')}</small></td>
        <td>${escapeHtml(device.selectedAscentSource)}</td>
        <td>${formatMeters(device.barometerTotalAscentMeters)}</td>
        <td>${formatMeters(device.absoluteDeviationMeters)}</td>
        <td>${formatPercent(device.relativeDeviation)}</td>
        <td>${device.barometerAscentSampleCount} / ${device.barometerAscentRejectedSampleCount}</td>
        <td>${escapeHtml(detail)}</td>
      </tr>
    `;
  }).join('');
}

function downloadText(fileName, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

render();
