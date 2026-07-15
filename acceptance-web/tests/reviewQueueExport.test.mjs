import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildReviewQueueBatchExportFromEvidenceTexts,
  buildReviewQueueExportFromEvidenceText
} from '../src/reviewQueueExport.mjs';

const execFileAsync = promisify(execFile);
const ACCEPTANCE_WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_REPLAY_FIXTURE_ROOT = path.resolve(
  ACCEPTANCE_WEB_ROOT, '../app/src/test/resources/replay-fixtures');

test('buildReviewQueueExportFromEvidenceText creates review-queue-v1 from evidence text', () => {
  const exported = buildReviewQueueExportFromEvidenceText(gapRecoveryEvidenceText(), {
    filePath: 'fixture/gap-evidence.jsonl',
    filter: 'highRisk',
    exportedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(exported.schemaVersion, 'review-queue-v1');
  assert.equal(exported.dataset.fileName, 'gap-evidence.jsonl');
  assert.equal(exported.filter, 'highRisk');
  assert.equal(exported.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(exported.taskCount, 1);
  assert.equal(exported.stats.metricOwner, 1);
  assert.equal(exported.stats.highRisk, 1);
  assert.equal(exported.streamingSettlementState.schemaVersion,
    'track-sdk-streaming-settlement-state-v1');
  assert.equal(exported.streamingSettlementState.committedCursorSampleId, 2);
  assert.equal(JSON.stringify(exported.streamingSettlementState).includes('RawPointId'), false);
  assert.equal(JSON.stringify(exported.streamingSettlementState).includes('"range"'), false);
  assert.deepEqual(exported.tasks.map((task) => ({
    type: task.type,
    highRisk: task.highRisk,
    scenario: task.scenario,
    rawRange: task.rawRange,
    metricOwner: task.metricOwner
  })), [
    {
      type: 'scenario',
      highRisk: true,
      scenario: 'gap_recovery_boundary',
      rawRange: { startRawPointId: 2, endRawPointId: 2 },
      metricOwner: true
    }
  ]);
});

test('export-review-queue script writes review-queue-v1 json', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-export-'));
  try {
    const inputPath = path.join(tempDir, 'evidence.jsonl');
    const outputPath = path.join(tempDir, 'review', 'queue.json');
    await writeFile(inputPath, gapRecoveryEvidenceText(), 'utf8');

    await execFileAsync(process.execPath, [
      'scripts/export-review-queue.mjs',
      inputPath,
      '--filter',
      'highRisk',
      '--out',
      outputPath
    ], {
      cwd: ACCEPTANCE_WEB_ROOT
    });

    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(exported.schemaVersion, 'review-queue-v1');
    assert.equal(exported.filter, 'highRisk');
    assert.equal(exported.taskCount, 1);
    assert.equal(exported.tasks[0].scenario, 'gap_recovery_boundary');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('package-review-queue script writes AI review package', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-package-'));
  try {
    const inputPath = path.join(tempDir, 'evidence.jsonl');
    const outputDir = path.join(tempDir, 'package');
    await writeFile(inputPath, gapRecoveryEvidenceText(), 'utf8');

    const result = await execFileAsync(process.execPath, [
      'scripts/package-review-queue.mjs',
      inputPath,
      '--filter',
      'highRisk',
      '--out-dir',
      outputDir,
      '--basename',
      'ai-review'
    ], {
      cwd: ACCEPTANCE_WEB_ROOT
    });

    assert.match(result.stdout, /reviewQueueJson=.*ai-review\.json/);
    assert.match(result.stdout, /reviewQueueReport=.*ai-review\.md/);
    assert.match(result.stdout, /aiPrompt=.*ai-review-prompt\.md/);
    assert.match(result.stdout, /packageManifest=.*ai-review-manifest\.json/);
    assert.match(result.stdout, /issueCount=0/);

    const exported = JSON.parse(await readFile(path.join(outputDir, 'ai-review.json'), 'utf8'));
    const report = await readFile(path.join(outputDir, 'ai-review.md'), 'utf8');
    const prompt = await readFile(path.join(outputDir, 'ai-review-prompt.md'), 'utf8');
    const manifest = JSON.parse(
      await readFile(path.join(outputDir, 'ai-review-manifest.json'), 'utf8'));
    assert.equal(exported.schemaVersion, 'review-queue-v1');
    assert.equal(exported.filter, 'highRisk');
    assert.match(report, /review-queue-alignment-report-v1/);
    assert.match(report, /未发现 review queue 包内契约违规/);
    assert.match(prompt, /Review Queue AI 对齐提示词/);
    assert.match(prompt, /streamingSettlementState/);
    assert.equal(manifest.schemaVersion, 'review-queue-ai-package-v1');
    assert.equal(manifest.safeToSend, true);
    assert.equal(manifest.issueCount, 0);
    assert.deepEqual(manifest.files, {
      reviewQueueJson: 'ai-review.json',
      reviewQueueReport: 'ai-review.md',
      aiPrompt: 'ai-review-prompt.md',
      packageManifest: 'ai-review-manifest.json'
    });
    assert.ok(manifest.contracts.includes(
      'track-rs/schemas/review-queue-ai-package.schema.json'));
    assert.ok(manifest.contracts.includes('track-rs/schemas/review-queue.schema.json'));
    assert.ok(manifest.contracts.includes(
      'track-rs/schemas/streaming-settlement-state.schema.json'));

    const validation = await execFileAsync(process.execPath, [
      'scripts/validate-review-queue-package.mjs',
      path.join(outputDir, 'ai-review-manifest.json')
    ], {
      cwd: ACCEPTANCE_WEB_ROOT
    });
    assert.match(validation.stdout, /reviewQueuePackageValid=true/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('validate-review-queue-package script rejects incomplete package', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-invalid-package-'));
  try {
    const manifestPath = path.join(tempDir, 'bad-manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 'review-queue-ai-package-v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputPath: '/tmp/evidence.jsonl',
      filter: 'all',
      baseName: 'bad',
      safeToSend: true,
      issueCount: 1,
      files: {
        reviewQueueJson: 'missing.json',
        reviewQueueReport: 'missing.md',
        aiPrompt: 'missing-prompt.md',
        packageManifest: 'bad-manifest.json'
      },
      contracts: [
        'track-rs/schemas/review-queue-ai-package.schema.json'
      ],
      notes: []
    }, null, 2), 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-review-queue-package.mjs',
        manifestPath
      ], {
        cwd: ACCEPTANCE_WEB_ROOT
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /safeToSend must equal issueCount === 0/);
        assert.match(error.stderr, /files.reviewQueueJson does not exist/);
        return true;
      });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('validate-review-queue-package script rejects wrong package contents', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-wrong-package-'));
  try {
    const manifestPath = path.join(tempDir, 'bad-manifest.json');
    await writeFile(path.join(tempDir, 'wrong.json'), JSON.stringify({
      schemaVersion: 'not-review-queue'
    }), 'utf8');
    await writeFile(path.join(tempDir, 'wrong.md'), '# Wrong Report\n', 'utf8');
    await writeFile(path.join(tempDir, 'wrong-prompt.md'), '# Wrong Prompt\n', 'utf8');
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 'review-queue-ai-package-v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputPath: '/tmp/evidence.jsonl',
      filter: 'all',
      baseName: 'bad',
      safeToSend: true,
      issueCount: 0,
      files: {
        reviewQueueJson: 'wrong.json',
        reviewQueueReport: 'wrong.md',
        aiPrompt: 'wrong-prompt.md',
        packageManifest: 'bad-manifest.json'
      },
      contracts: [
        'track-rs/schemas/review-queue-ai-package.schema.json'
      ],
      notes: []
    }, null, 2), 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-review-queue-package.mjs',
        manifestPath
      ], {
        cwd: ACCEPTANCE_WEB_ROOT
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr,
          /files.reviewQueueJson must be review-queue-v1 or review-queue-batch-v1/);
        assert.match(error.stderr,
          /files.reviewQueueReport must contain review-queue-alignment-report-v1/);
        assert.match(error.stderr,
          /files.aiPrompt must contain the fixed review queue AI prompt/);
        return true;
      });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('buildReviewQueueBatchExportFromEvidenceTexts creates review-queue-batch-v1', () => {
  const exported = buildReviewQueueBatchExportFromEvidenceTexts([
    {
      fileName: 'gap.jsonl',
      filePath: '/fixtures/gap.jsonl',
      text: gapRecoveryEvidenceText()
    },
    {
      fileName: 'walk.jsonl',
      filePath: '/fixtures/walk.jsonl',
      text: normalWalkEvidenceText()
    }
  ], {
    sourcePath: '/fixtures',
    filter: 'all',
    exportedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(exported.schemaVersion, 'review-queue-batch-v1');
  assert.equal(exported.sourcePath, '/fixtures');
  assert.equal(exported.fileCount, 2);
  assert.equal(exported.successCount, 2);
  assert.equal(exported.errorCount, 0);
  assert.deepEqual(exported.exports.map((item) => item.schemaVersion), [
    'review-queue-v1',
    'review-queue-v1'
  ]);
  assert.equal(exported.exports[0].tasks[0].scenario, 'gap_recovery_boundary');
  assert.equal(exported.exports[1].taskCount, 0);
});

test('export-review-queue script writes review-queue-batch-v1 for a directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-batch-'));
  try {
    const inputDir = path.join(tempDir, 'fixtures');
    const outputPath = path.join(tempDir, 'review', 'batch.json');
    await mkdir(inputDir, { recursive: true });
    await writeFile(path.join(inputDir, 'gap.jsonl'), gapRecoveryEvidenceText(), 'utf8');
    await writeFile(path.join(inputDir, 'normal.jsonl'), normalWalkEvidenceText(), 'utf8');

    await execFileAsync(process.execPath, [
      'scripts/export-review-queue.mjs',
      inputDir,
      '--filter',
      'all',
      '--out',
      outputPath
    ], {
      cwd: ACCEPTANCE_WEB_ROOT
    });

    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(exported.schemaVersion, 'review-queue-batch-v1');
    assert.equal(exported.fileCount, 2);
    assert.equal(exported.successCount, 2);
    assert.equal(exported.errorCount, 0);
    assert.deepEqual(
      exported.exports.map((item) => item.dataset.fileName),
      ['gap.jsonl', 'normal.jsonl']);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('android replay fixture directory exports high-risk review batch', async () => {
  const fileNames = (await readdir(ANDROID_REPLAY_FIXTURE_ROOT))
    .filter((fileName) => fileName.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right));
  const items = await Promise.all(fileNames.map(async (fileName, index) => {
    const filePath = path.join(ANDROID_REPLAY_FIXTURE_ROOT, fileName);
    return {
      datasetId: `dataset-${index + 1}`,
      fileName,
      filePath,
      text: await readFile(filePath, 'utf8')
    };
  }));
  const exported = buildReviewQueueBatchExportFromEvidenceTexts(items, {
    sourcePath: ANDROID_REPLAY_FIXTURE_ROOT,
    filter: 'highRisk',
    exportedAt: '2026-01-01T00:00:00.000Z'
  });
  const byName = new Map(exported.exports.map((item) => [item.dataset.fileName, item]));

  assert.equal(exported.schemaVersion, 'review-queue-batch-v1');
  assert.equal(exported.fileCount, fileNames.length);
  assert.equal(exported.successCount, fileNames.length);
  assert.equal(exported.errorCount, 0);
  assert.deepEqual(
    byName.get('gap_recovery_after_stationary_gap.jsonl').tasks.map((task) => task.scenario),
    ['gap_recovery_boundary']);
  assert.deepEqual(
    byName.get('transport_mode.jsonl').tasks.map((task) => task.scenario),
    ['transport_contamination']);
  assert.equal(byName.get('good_walk.jsonl').taskCount, 0);
});

function gapRecoveryEvidenceText() {
  return [
    neutralEvent(1, 'session_metadata', {
      createdElapsedRealtimeNanos: 1_000_000_000
    }),
    neutralEvent(2, 'sampling_policy', {
      eventElapsedRealtimeNanos: 1_000_000_000,
      samplingEpochId: 1,
      state: 'MOVING_STANDARD',
      startedElapsedRealtimeNanos: 1_000_000_000
    }),
    locationSample(11, 1, 30, 120, 1_000_000_000),
    locationSample(12, 2, 30.0001, 120, 150_000_000_000)
  ].map((event) => JSON.stringify(event)).join('\n');
}

function normalWalkEvidenceText() {
  return [
    neutralEvent(1, 'session_metadata', {
      createdElapsedRealtimeNanos: 1_000_000_000
    }),
    neutralEvent(2, 'sampling_policy', {
      eventElapsedRealtimeNanos: 1_000_000_000,
      samplingEpochId: 1,
      state: 'MOVING_STANDARD',
      startedElapsedRealtimeNanos: 1_000_000_000
    }),
    locationSample(11, 1, 30, 120, 1_000_000_000),
    locationSample(12, 2, 30.0001, 120, 31_000_000_000)
  ].map((event) => JSON.stringify(event)).join('\n');
}

function neutralEvent(eventSeq, event, overrides = {}) {
  return {
    schemaVersion: 'outdoor-track-evidence-v1',
    event,
    sessionId: 'S1',
    eventSeq,
    eventWallTimeMillis: 1_760_000_000_000 + eventSeq,
    eventElapsedRealtimeNanos: overrides.eventElapsedRealtimeNanos || 1_000_000_000,
    ...overrides
  };
}

function locationSample(eventSeq, sampleId, lat, lng, fixElapsedRealtimeNanos) {
  return neutralEvent(eventSeq, 'location_sample', {
    sampleId,
    provider: 'gnss',
    lat,
    lng,
    horizontalAccuracyMeters: 5,
    speedMetersPerSecond: 1.2,
    wallTimeMillis: 1_760_000_000_000 + fixElapsedRealtimeNanos / 1_000_000,
    fixElapsedRealtimeNanos,
    receivedElapsedRealtimeNanos: fixElapsedRealtimeNanos + 10_000_000,
    callbackDelayNanos: 10_000_000,
    samplingEpochId: 1,
    isMock: false
  });
}
