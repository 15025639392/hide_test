import {
  buildTargetOutput,
  parseEvidenceJsonl
} from './diagnosticMap.mjs';
import { buildSixLayerTrackProduct } from './sixLayerTrackProduct.mjs';

self.onmessage = async (event) => {
  const { file, fileName, filePath, config } = event.data || {};
  try {
    const text = await file.text();
    const model = parseEvidenceJsonl(text, filePath);
    const targetProduct = buildSixLayerTrackProduct(model, { config });
    const targetOutput = compactTargetOutput(buildTargetOutput(model, targetProduct));
    self.postMessage({
      ok: true,
      result: {
        fileName,
        filePath,
        model,
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
