import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildReviewQueueMarkdownReport,
  buildReviewQueueReportModel
} from '../src/reviewQueueReport.mjs';

const execFileAsync = promisify(execFile);
const ACCEPTANCE_WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..');

test('buildReviewQueueMarkdownReport summarizes metric and diagnostic tasks', () => {
  const report = buildReviewQueueMarkdownReport(reviewQueueBatchFixture(), {
    generatedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.match(report, /# Review Queue Alignment Report/);
  assert.match(report, /review-queue-alignment-report-v1/);
  assert.match(report, /\| gap\.jsonl \| all \| 2 \| 1 \| 1 \| 1 \|/);
  assert.match(report, /\| gap\.jsonl \| scenario:gap_recovery_boundary:2:2:4:5:101 \| gap_recovery_boundary \| 2-2 \| 4-5 \| yes \| hard_boundary\(distance,moving_time,elevation\)/);
  assert.match(report, /\| gap\.jsonl \| diagnostic-context:dense_area_intent:1:30:ctx-dense \| dense_area_intent \| 1-30 \| 1,30 \| intent=round_trip \| false \|/);
  assert.match(report, /未发现 review queue 包内契约违规/);
  assert.match(report, /确认 review queue 顶层 streamingSettlementState 存在/);
});

test('buildReviewQueueReportModel detects diagnostic metric leaks and same-gate owner overlap', () => {
  const payload = reviewQueueSingleFixture({
    tasks: [
      metricTask('metric-a', 10, 20),
      metricTask('metric-b', 18, 30),
      diagnosticTask({
        reviewKey: 'diagnostic-context:leak:12:14:ctx-leak',
        scenario: 'dense_area_intent',
        rawRange: { startRawPointId: 12, endRawPointId: 14 },
        metricOwner: true,
        affectedMetricGates: ['distance']
      })
    ]
  });

  const model = buildReviewQueueReportModel(payload, {
    generatedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.deepEqual(model.issues.map((issue) => issue.severity), ['P0', 'P1', 'P1']);
  assert.equal(model.issues[0].message,
    'metric owner rawRange 在同一 gate 重叠: route,distance');
  assert.equal(model.issues[1].message, 'diagnostic_context 不能拥有指标');
  assert.equal(model.issues[2].message, 'diagnostic_context 的 affectedMetricGates 必须为空');
});

test('buildReviewQueueReportModel allows metric-owner overlap across disjoint gates', () => {
  const payload = reviewQueueSingleFixture({
    tasks: [
      metricTask('metric-route', 10, 20, {
        affectedMetricGates: ['route', 'distance', 'moving_time']
      }),
      metricTask('metric-elevation', 10, 20, {
        scenario: 'pressure_jump',
        affectedMetricGates: ['elevation'],
        action: 'reset_elevation_boundary',
        localRebuild: 'known_boundary_passthrough'
      })
    ]
  });

  const model = buildReviewQueueReportModel(payload, {
    generatedAt: '2026-01-01T00:00:00.000Z'
  });

  assert.deepEqual(model.issues, []);
});

test('buildReviewQueueReportModel detects invalid streaming settlement state', () => {
  const missing = buildReviewQueueReportModel(reviewQueueSingleFixture({
    streamingSettlementState: null
  }));
  assert.equal(missing.issues[0].message,
    'review-queue-v1 缺少 streamingSettlementState');

  const malformed = buildReviewQueueReportModel(reviewQueueSingleFixture({
    streamingSettlementState: {
      schemaVersion: 'legacy-settlement-state',
      committedCursorRawPointId: 1,
      committedCursorSampleId: 1,
      commitSequence: 1,
      committedRanges: [
        {
          type: 'normal',
          range: { startRawPointId: 1, endRawPointId: 1 },
          affectedMetricGates: [],
          commitSequence: 1
        }
      ],
      committedMetricOwnershipRanges: [
        {
          ownerId: 'base_kernel',
          sampleRange: { startSampleId: 1, endSampleId: 1 },
          affectedMetricGates: [],
          hardBoundary: false,
          commitSequence: 1
        }
      ],
      hardBoundaryCheckpoints: [],
      blockingRanges: [
        {
          type: 'open_window',
          id: 'open-window',
          sampleRange: { startSampleId: 2, endSampleId: 3 },
          affectedMetricGates: []
        }
      ],
      lastCommitPlanStatus: 'blocked_at_watermark',
      lastCommitWatermark: 2
    }
  }));

  assert.ok(malformed.issues.some((issue) =>
    issue.message === 'streamingSettlementState schemaVersion 不正确'));
  assert.ok(malformed.issues.some((issue) =>
    issue.message === 'streamingSettlementState 泄露内部字段 committedCursorRawPointId'));
  assert.ok(malformed.issues.some((issue) =>
    issue.message === 'committedRanges[0] 泄露内部字段 range'));
  assert.ok(malformed.issues.some((issue) =>
    issue.message === 'committedRanges[0] 缺少有效 sampleRange'));
  assert.ok(malformed.issues.some((issue) =>
    issue.message === 'blockingRanges[0] 的 affectedMetricGates 不能为空'));
});

test('report-review-queue script writes markdown report', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-report-'));
  try {
    const inputPath = path.join(tempDir, 'review-queue.json');
    const outputPath = path.join(tempDir, 'review-queue-report.md');
    await writeFile(inputPath, JSON.stringify(reviewQueueBatchFixture(), null, 2), 'utf8');

    await execFileAsync(process.execPath, [
      'scripts/report-review-queue.mjs',
      inputPath,
      '--out',
      outputPath
    ], {
      cwd: ACCEPTANCE_WEB_ROOT
    });

    const report = await readFile(outputPath, 'utf8');
    assert.match(report, /## 数据集摘要/);
    assert.match(report, /## 必须保持诊断态的任务/);
    assert.match(report, /diagnostic-context:dense_area_intent:1:30:ctx-dense/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('report-review-queue script can fail when contract issues exist', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'review-queue-report-fail-'));
  try {
    const inputPath = path.join(tempDir, 'review-queue.json');
    await writeFile(inputPath, JSON.stringify(reviewQueueSingleFixture({
      streamingSettlementState: null
    }), null, 2), 'utf8');

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/report-review-queue.mjs',
        inputPath,
        '--fail-on-issues'
      ], {
        cwd: ACCEPTANCE_WEB_ROOT
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /review queue report found 1 issue/);
        return true;
      }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function reviewQueueBatchFixture() {
  return {
    schemaVersion: 'review-queue-batch-v1',
    sourcePath: '/fixtures',
    filter: 'all',
    exportedAt: '2026-01-01T00:00:00.000Z',
    fileCount: 2,
    successCount: 2,
    errorCount: 0,
    exports: [
      reviewQueueSingleFixture({
        fileName: 'gap.jsonl',
        tasks: [
          {
            order: 1,
            reviewKey: 'scenario:gap_recovery_boundary:2:2:4:5:101',
            type: 'scenario',
            status: 'pending',
            highRisk: true,
            scenario: 'gap_recovery_boundary',
            title: '中断后恢复',
            rawRange: { startRawPointId: 2, endRawPointId: 2 },
            trackRange: { startTrackPointId: 4, endTrackPointId: 5 },
            metricOwner: true,
            affectedMetricGates: null,
            action: 'cut_gap_boundary',
            localRebuild: 'gap_boundary_guard',
            anchorRawPointIds: [2],
            evidence: null
          },
          diagnosticTask({
            reviewKey: 'diagnostic-context:dense_area_intent:1:30:ctx-dense',
            scenario: 'dense_area_intent',
            rawRange: { startRawPointId: 1, endRawPointId: 30 },
            anchorRawPointIds: [1, 30],
            evidence: { intent: 'round_trip' }
          })
        ]
      }),
      reviewQueueSingleFixture({
        fileName: 'normal.jsonl',
        tasks: []
      })
    ],
    errors: []
  };
}

function reviewQueueSingleFixture(overrides = {}) {
  const tasks = overrides.tasks || [];
  return {
    schemaVersion: 'review-queue-v1',
    dataset: {
      id: 'dataset-1',
      fileName: overrides.fileName || 'fixture.jsonl',
      filePath: `/fixtures/${overrides.fileName || 'fixture.jsonl'}`
    },
    filter: 'all',
    stats: {
      total: tasks.length,
      pending: tasks.length,
      approved: 0,
      question: 0,
      skipped: 0,
      done: 0,
      highRisk: tasks.filter((task) => task.highRisk).length,
      gap: tasks.filter((task) => task.scenario === 'gap_recovery_boundary').length,
      transport: 0,
      diagnosticContext: tasks.filter((task) => task.type === 'diagnostic_context').length,
      metricOwner: tasks.filter((task) => task.metricOwner === true).length
    },
    taskCount: tasks.length,
    tasks,
    streamingSettlementState: Object.prototype.hasOwnProperty.call(
      overrides, 'streamingSettlementState'
    )
      ? overrides.streamingSettlementState
      : validStreamingSettlementState(),
    streamingDiagnosticContexts: null,
    exportedAt: '2026-01-01T00:00:00.000Z'
  };
}

function validStreamingSettlementState() {
  return {
    schemaVersion: 'track-sdk-streaming-settlement-state-v1',
    committedCursorSampleId: 30,
    commitSequence: 1,
    committedRanges: [
      {
        type: 'normal',
        sampleRange: { startSampleId: 1, endSampleId: 30 },
        affectedMetricGates: [],
        commitSequence: 1
      }
    ],
    committedMetricOwnershipRanges: [
      {
        ownerId: 'base_kernel',
        sampleRange: { startSampleId: 1, endSampleId: 30 },
        affectedMetricGates: [],
        hardBoundary: false,
        commitSequence: 1
      }
    ],
    hardBoundaryCheckpoints: [],
    blockingRanges: [],
    lastCommitPlanStatus: 'committable',
    lastCommitWatermark: 30
  };
}

function metricTask(reviewKey, startRawPointId, endRawPointId, overrides = {}) {
  return {
    order: 1,
    reviewKey,
    type: 'scenario',
    status: 'pending',
    highRisk: false,
    scenario: overrides.scenario || 'same_road_round_trip',
    title: '同路来回',
    rawRange: { startRawPointId, endRawPointId },
    trackRange: { startTrackPointId: startRawPointId, endTrackPointId: endRawPointId },
    metricOwner: true,
    affectedMetricGates: overrides.affectedMetricGates || ['route', 'distance'],
    action: overrides.action || 'collapse_same_road_round_trip',
    localRebuild: overrides.localRebuild || 'same_road_centerline',
    anchorRawPointIds: [startRawPointId, endRawPointId],
    evidence: null
  };
}

function diagnosticTask(overrides = {}) {
  return {
    order: 2,
    reviewKey: overrides.reviewKey || 'diagnostic-context:enclosed_gap_cluster:12:18:ctx-gap',
    type: 'diagnostic_context',
    status: 'pending',
    highRisk: false,
    scenario: overrides.scenario || 'enclosed_gap_cluster',
    title: '遮挡绕线压缩',
    rawRange: overrides.rawRange || { startRawPointId: 12, endRawPointId: 18 },
    trackRange: null,
    metricOwner: overrides.metricOwner ?? false,
    affectedMetricGates: overrides.affectedMetricGates || [],
    action: 'classify_diagnostic_context',
    localRebuild: 'diagnostic_context_report',
    anchorRawPointIds: overrides.anchorRawPointIds || [12, 15, 18],
    evidence: overrides.evidence || { gapClusterIntentSupported: true }
  };
}
