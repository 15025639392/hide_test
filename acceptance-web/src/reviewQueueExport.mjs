import { buildTargetOutput, parseEvidenceJsonl } from './diagnosticMap.mjs';
import { buildReviewQueueExport } from './reviewQueue.mjs';
import { fullScenarioRepairConfig } from './scenarioRepairConfig.mjs';
import { buildSixLayerTrackProduct } from './sixLayerTrackProduct.mjs';

export function buildReviewQueueExportFromEvidenceText(text, options = {}) {
  const filePath = options.filePath || 'evidence.jsonl';
  const fileName = options.fileName || fileNameFromPath(filePath);
  const config = options.config || fullScenarioRepairConfig();
  const scenarioConfig = options.scenarioConfig || config;
  const model = parseEvidenceJsonl(text, filePath);
  const targetProduct = buildSixLayerTrackProduct(model, { config });
  const scenarioProduct = sameCleaningConfig(config, scenarioConfig)
    ? targetProduct
    : buildSixLayerTrackProduct(model, { config: scenarioConfig });
  const targetOutput = buildTargetOutput(model, targetProduct);
  const statusByReviewKey = options.statusByReviewKey || {};
  const dataset = {
    id: options.datasetId || 'dataset-1',
    fileName,
    filePath,
    model,
    scenarioProduct,
    targetProduct,
    targetOutput
  };
  const exportedAt = options.exportedAt || new Date().toISOString();
  return {
    ...buildReviewQueueExport(dataset, {
      filter: options.filter || 'all',
      statusForTask: (task) => statusByReviewKey[task.reviewKey] || 'pending'
    }),
    exportedAt
  };
}

export function buildReviewQueueBatchExportFromEvidenceTexts(items = [], options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const exports = [];
  const errors = [];
  for (const [index, item] of items.entries()) {
    try {
      exports.push(buildReviewQueueExportFromEvidenceText(item.text, {
        ...options,
        datasetId: item.datasetId || `dataset-${index + 1}`,
        fileName: item.fileName,
        filePath: item.filePath,
        exportedAt
      }));
    } catch (error) {
      errors.push({
        filePath: item.filePath || item.fileName || `item-${index + 1}`,
        message: error?.message || String(error)
      });
    }
  }
  return {
    schemaVersion: 'review-queue-batch-v1',
    sourcePath: options.sourcePath || null,
    filter: options.filter || 'all',
    exportedAt,
    fileCount: items.length,
    successCount: exports.length,
    errorCount: errors.length,
    exports,
    errors
  };
}

function sameCleaningConfig(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function fileNameFromPath(filePath) {
  return String(filePath || 'evidence.jsonl').split(/[\\/]/).pop() || 'evidence.jsonl';
}
