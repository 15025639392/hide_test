import {
  buildTargetOutput,
  parseEvidenceJsonl
} from './diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from './sixLayerTrackProduct.mjs';

self.onmessage = async (event) => {
  const { file, fileName, filePath, config, scenarioConfig, mode, model } = event.data || {};
  try {
    const inputModel = mode === 'rebuild'
      ? model
      : parseEvidenceJsonl(await file.text(), filePath);
    const targetProduct = buildSixLayerTrackProduct(inputModel, { config });
    const scenarioProduct = scenarioConfig
      ? sameCleaningConfig(config, scenarioConfig)
        ? targetProduct
        : buildSixLayerTrackProduct(inputModel, { config: scenarioConfig })
      : null;
    const targetOutput = compactTargetOutput(buildTargetOutput(inputModel, targetProduct));
    self.postMessage({
      ok: true,
      result: {
        fileName,
        filePath,
        model: inputModel,
        scenarioProduct,
        targetProduct,
        targetOutput
      }
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: {
        message: error?.message || String(error),
        stack: error?.stack || ''
      }
    });
  }
};

function sameCleaningConfig(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
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
