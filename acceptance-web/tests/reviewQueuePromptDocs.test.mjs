import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('review queue AI alignment prompt keeps core invariants and commands', async () => {
  const text = await readFile(
    path.join(REPO_ROOT, 'docs/review-queue-ai-alignment-prompt.md'), 'utf8');

  for (const required of [
    'npm run package-review-queue',
    'npm run validate-review-queue-package',
    'npm run export-review-queue',
    'npm run report-review-queue',
    'review-queue-v1',
    'review-queue-batch-v1',
    'review-queue-alignment-report-v1',
    'review-queue-ai-package-v1',
    'review-queue-ai-alignment-result-v1',
    'track-rs/schemas/review-queue-ai-package.schema.json',
    'track-rs/schemas/review-queue-ai-alignment-result.schema.json',
    'safeToSend=true',
    '*-prompt.md',
    'streamingSettlementState',
    'committedCursorSampleId',
    'track-rs/schemas/review-queue.schema.json',
    'track-rs/schemas/review-queue-batch.schema.json',
    'track-rs/schemas/streaming-settlement-state.schema.json',
    '标为 P0',
    '--fail-on-issues',
    'type=diagnostic_context',
    'metricOwner=false',
    '不能转换成 route、distance、moving_time 或 elevation ownership',
    '每条结论必须引用 reviewKey 和 rawRange'
  ]) {
    assert.ok(text.includes(required), `missing required prompt text: ${required}`);
  }
});

test('cross-platform migration prompt references review queue alignment', async () => {
  const text = await readFile(
    path.join(REPO_ROOT, 'docs/cross-platform-migration-prompt-engineering.md'), 'utf8');

  assert.ok(text.includes('docs/review-queue-ai-alignment-prompt.md'));
  assert.ok(text.includes('Prompt 6A：Review Queue AI 对齐审查'));
  assert.ok(text.includes('review-queue-v1'));
  assert.ok(text.includes('review-queue-batch-v1'));
  assert.ok(text.includes('review-queue-alignment-report-v1'));
  assert.ok(text.includes('review-queue-ai-package-v1'));
  assert.ok(text.includes('review-queue-ai-alignment-result-v1'));
  assert.ok(text.includes('track-rs/schemas/review-queue-ai-package.schema.json'));
  assert.ok(text.includes('track-rs/schemas/review-queue-ai-alignment-result.schema.json'));
  assert.ok(text.includes('safeToSend'));
  assert.ok(text.includes('*-prompt.md'));
  assert.ok(text.includes('package-review-queue'));
  assert.ok(text.includes('validate-review-queue-package'));
  assert.ok(text.includes('diagnostic_context'));
});
