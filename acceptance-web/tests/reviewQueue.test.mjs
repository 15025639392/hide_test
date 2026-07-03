import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReviewQueueExport,
  buildReviewTasks,
  filterReviewTasks,
  reviewQueueStats,
  reviewTaskIsHighRisk,
  scenarioReviewLevel,
  sortScenarioCoverageForReview
} from '../src/reviewQueue.mjs';

test('review queue includes streaming diagnostic contexts as non metric tasks', () => {
  const dataset = reviewDatasetFixture();

  const tasks = buildReviewTasks(dataset);
  const diagnosticTasks = tasks.filter((task) => task.diagnosticContext);

  assert.equal(tasks.length, 3);
  assert.deepEqual(diagnosticTasks.map((task) => task.item.scenario), [
    'dense_area_intent',
    'enclosed_gap_cluster'
  ]);
  assert.deepEqual(diagnosticTasks.map((task) => task.item.metricOwner), [false, false]);
  assert.deepEqual(diagnosticTasks.map((task) => task.item.affectedMetricGates), [[], []]);
  assert.equal(
    diagnosticTasks[0].reviewKey,
    'diagnostic-context:dense_area_intent:1:30:ctx-dense');
  assert.equal(
    diagnosticTasks[1].reviewKey,
    'diagnostic-context:enclosed_gap_cluster:12:18:ctx-gap');
  assert.equal(reviewTaskIsHighRisk(diagnosticTasks[0], dataset), false);
  assert.equal(scenarioReviewLevel(diagnosticTasks[0].item, dataset).kind, 'diagnostic');
});

test('review queue stats separates diagnostic contexts from metric-owner tasks', () => {
  const dataset = reviewDatasetFixture();
  const stats = reviewQueueStats(dataset, {
    statusForTask: (task) =>
      task.reviewKey === 'diagnostic-context:enclosed_gap_cluster:12:18:ctx-gap'
        ? 'approved'
        : 'pending'
  });

  assert.equal(stats.total, 3);
  assert.equal(stats.metricOwner, 1);
  assert.equal(stats.diagnosticContext, 2);
  assert.equal(stats.highRisk, 1);
  assert.equal(stats.gap, 1);
  assert.equal(stats.transport, 0);
  assert.equal(stats.pending, 2);
  assert.equal(stats.approved, 1);
  assert.equal(stats.done, 1);
});

test('scenario coverage review keeps dense intent hidden but context report visible', () => {
  const dataset = reviewDatasetFixture();

  assert.deepEqual(
    sortScenarioCoverageForReview(dataset.scenarioProduct.scenarioCoverage, dataset)
      .map((item) => item.scenario),
    ['gap_recovery_boundary']);
  assert.deepEqual(
    buildReviewTasks(dataset)
      .filter((task) => task.diagnosticContext)
      .map((task) => task.item.scenario),
    ['dense_area_intent', 'enclosed_gap_cluster']);
});

test('review queue filter and export preserve diagnostic-only evidence', () => {
  const dataset = reviewDatasetFixture();
  const tasks = buildReviewTasks(dataset);

  assert.deepEqual(
    filterReviewTasks(tasks, 'diagnostic', { dataset }).map((task) => task.item.scenario),
    ['dense_area_intent', 'enclosed_gap_cluster']);
  assert.deepEqual(
    filterReviewTasks(tasks, 'metric', { dataset }).map((task) => task.item.scenario),
    ['gap_recovery_boundary']);

  const exported = buildReviewQueueExport(dataset, {
    filter: 'diagnostic',
    statusForTask: (task) =>
      task.reviewKey === 'diagnostic-context:dense_area_intent:1:30:ctx-dense'
        ? 'question'
        : 'pending'
  });

  assert.equal(exported.schemaVersion, 'review-queue-v1');
  assert.equal(exported.filter, 'diagnostic');
  assert.equal(exported.taskCount, 2);
  assert.equal(exported.stats.diagnosticContext, 2);
  assert.deepEqual(exported.tasks.map((task) => ({
    type: task.type,
    scenario: task.scenario,
    status: task.status,
    metricOwner: task.metricOwner,
    gates: task.affectedMetricGates
  })), [
    {
      type: 'diagnostic_context',
      scenario: 'dense_area_intent',
      status: 'question',
      metricOwner: false,
      gates: []
    },
    {
      type: 'diagnostic_context',
      scenario: 'enclosed_gap_cluster',
      status: 'pending',
      metricOwner: false,
      gates: []
    }
  ]);
  assert.equal(exported.streamingSettlementState.schemaVersion,
    'track-sdk-streaming-settlement-state-v1');
  assert.equal(exported.streamingSettlementState.committedCursorSampleId, 30);
  assert.deepEqual(exported.streamingSettlementState.blockingRanges, []);
  assert.equal(exported.streamingDiagnosticContexts.totalCount, 3);
});

function reviewDatasetFixture() {
  return {
    scenarioProduct: {
      scenarioCoverage: [
        {
          scenarioId: 101,
          scenario: 'dense_area_intent',
          rawRange: { startRawPointId: 1, endRawPointId: 30 },
          trackPointRange: { startTrackPointId: 1, endTrackPointId: 8 }
        },
        {
          scenarioId: 102,
          scenario: 'gap_recovery_boundary',
          rawRange: { startRawPointId: 10, endRawPointId: 11 },
          trackPointRange: { startTrackPointId: 4, endTrackPointId: 5 }
        },
        {
          scenarioId: 103,
          scenario: 'moving_spike_cleanup',
          rawRange: { startRawPointId: 20, endRawPointId: 22 },
          trackPointRange: { startTrackPointId: 6, endTrackPointId: 8 }
        }
      ]
    },
    targetOutput: {
      forwardSpineConflicts: [],
      streamingSettlementStateContract: {
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
      },
      streamingDiagnosticContexts: {
        totalCount: 3,
        contexts: [
          {
            id: 'ctx-dense',
            scenario: 'dense_area_intent',
            rawRange: { startRawPointId: 1, endRawPointId: 30 },
            metricOwner: false,
            affectedMetricGates: [],
            action: 'classify_dense_area_intent',
            localRebuild: 'dense_area_intent_classifier',
            anchorRawPointIds: [1, 30],
            evidence: {
              intent: 'round_trip'
            }
          },
          {
            id: 'ctx-gap',
            scenario: 'enclosed_gap_cluster',
            rawRange: { startRawPointId: 12, endRawPointId: 18 },
            metricOwner: false,
            affectedMetricGates: [],
            action: 'classify_enclosed_gap_cluster',
            localRebuild: 'gap_stationary_cluster_diagnostic',
            anchorRawPointIds: [12, 15, 18],
            evidence: {
              gapClusterIntentSupported: true
            }
          },
          {
            id: 'metric-leak',
            scenario: 'transport_contamination',
            rawRange: { startRawPointId: 40, endRawPointId: 42 },
            metricOwner: true,
            affectedMetricGates: ['distance', 'moving_time']
          }
        ]
      }
    }
  };
}
