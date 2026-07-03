import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('track sdk public api json locks stable process and replay contract', async () => {
  const contract = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-public-api.v1.json'), 'utf8'));

  assert.equal(contract.schemaVersion, 'track-sdk-public-api-v1');
  assert.equal(contract.evidenceSchemaVersion, 'outdoor-track-evidence-v1');
  assert.equal(contract.adapterMappingSchemaVersion, 'platform-adapter-field-mapping-v1');
  assert.deepEqual(contract.publicApis.map((api) => api.name), [
    'process',
    'process_debug',
    'verify_fixtures'
  ]);

  assert.ok(
    contract.models.LocationSample.required.includes('fixElapsedRealtimeNanos'));
  assert.equal(contract.models.LocationSample.continuityClock, 'fixElapsedRealtimeNanos');
  assert.ok(
    contract.models.LocationSample.diagnosticOnlyFields.includes('callbackDelayNanos'));
  assert.ok(
    contract.models.BarometerWindow.required.includes('windowAscentMeters'));
  assert.ok(
    contract.models.BarometerWindow.required.includes('windowDescentMeters'));
  assert.ok(
    contract.models.TrackSummary.required.includes('totalAscentMeters'));
  assert.ok(
    contract.models.TrackSummary.required.includes('totalDescentMeters'));
  assert.ok(
    contract.models.TrackReplayFixture.expectedRequired.includes('totalDescentMeters'));
  for (const optionalField of [
    'acceptedSampleIds',
    'weakSampleIds',
    'rejectedSampleIds',
    'decisionReasons'
  ]) {
    assert.ok(
      contract.models.TrackReplayFixture.expectedOptional.includes(optionalField),
      `missing replay fixture optional field ${optionalField}`);
  }
  assert.equal(contract.models.TrackReplayFixture.decisionReasonsKeyField, 'sampleId');
  assert.equal(
    contract.models.TrackReplayFixture.decisionReasonsKeyEncoding,
    'json_object_property_name');
  assert.equal(
    contract.models.TrackProcessRequest.schemaPath,
    'track-rs/schemas/process-request.schema.json');
  assert.equal(
    contract.models.TrackProcessResponse.schemaPath,
    'track-rs/schemas/process-response.schema.json');
  assert.equal(
    contract.models.TrackProcessDebugResponse.schemaPath,
    'track-rs/schemas/process-debug-response.schema.json');
  assert.ok(
    contract.models.CleanedTrackPoint.required.includes('sourceSampleId'));
  assert.ok(
    contract.models.CleanedTrackPoint.required.includes('fixElapsedRealtimeNanos'));
  assert.equal(
    contract.models.TrackReplayFixture.schemaPath,
    'track-rs/schemas/fixture.schema.json');
  assert.equal(
    contract.models.TrackReplayReport.schemaPath,
    'track-rs/schemas/replay-report.schema.json');
  assert.equal(
    contract.models.StreamingSettlementState.schemaPath,
    'track-rs/schemas/streaming-settlement-state.schema.json');
  assert.ok(
    contract.models.StreamingSettlementState.required.includes('lastCommitWatermark'));
  assert.equal(contract.models.StreamingSettlementState.rangeField, 'sampleRange');
  assert.equal(
    contract.models.ReviewQueueExport.schemaPath,
    'track-rs/schemas/review-queue.schema.json');
  assert.ok(
    contract.models.ReviewQueueExport.required.includes('streamingSettlementState'));
  assert.equal(
    contract.models.ReviewQueueBatchExport.schemaPath,
    'track-rs/schemas/review-queue-batch.schema.json');
  assert.equal(
    contract.models.ReviewQueueAiPackageManifest.schemaPath,
    'track-rs/schemas/review-queue-ai-package.schema.json');
  assert.equal(
    contract.models.ReviewQueueAiPackageManifest.schemaVersionValue,
    'review-queue-ai-package-v1');
  assert.ok(
    contract.models.ReviewQueueAiPackageManifest.required.includes('safeToSend'));
  assert.ok(
    contract.models.ReviewQueueAiPackageManifest.packageFiles.includes('packageManifest'));
  assert.equal(
    contract.models.ReviewQueueAiAlignmentResult.schemaPath,
    'track-rs/schemas/review-queue-ai-alignment-result.schema.json');
  assert.equal(
    contract.models.ReviewQueueAiAlignmentResult.schemaVersionValue,
    'review-queue-ai-alignment-result-v1');
  assert.ok(
    contract.models.ReviewQueueAiAlignmentResult.required.includes('differences'));
  assert.ok(
    contract.models.CleaningOperation.required.includes('inputSampleRange'));
  assert.ok(
    contract.models.MetricOwnershipRange.required.includes('sampleRange'));
  assert.equal(contract.models.MetricOwnershipRange.rangeField, 'sampleRange');
  assert.equal(
    contract.models.TrackReplayReport.failureLocatorContract.primaryRangeField,
    'sampleRange');
  assert.equal(
    contract.models.TrackReplayReport.failureLocatorContract.legacyRangeAliases[0].legacyField,
    'rawRange');
});

test('track sdk public api contract records legacy aliases as temporary', async () => {
  const contract = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-public-api.v1.json'), 'utf8'));
  const aliases = new Map(contract.transitionalAliases.map((alias) => [
    alias.legacyField,
    alias
  ]));
  for (const alias of contract.transitionalAliases) {
    assert.equal(
      Object.hasOwn(alias, 'currentRustPocField'),
      false,
      `${alias.legacyField} must not be described as current Rust output`);
  }

  assert.equal(
    aliases.get('locationSamples[].elapsedRealtimeNanos').targetField,
    'locationSamples[].fixElapsedRealtimeNanos');
  assert.equal(
    aliases.get('summary.ascentMeters').targetField,
    'summary.totalAscentMeters');
  assert.equal(
    aliases.get('cleaningOperations[].inputRawRange').targetField,
    'cleaningOperations[].inputSampleRange');
  assert.equal(
    aliases.get('metricOwnershipRanges[].rawRange').targetField,
    'metricOwnershipRanges[].sampleRange');
  assert.equal(
    aliases.get('failures[].rawRange').targetField,
    'failures[].sampleRange');
  assert.equal(
    aliases.get('expected.acceptedRawPointIds').targetField,
    'expected.acceptedSampleIds');
  assert.equal(
    aliases.get('expected.weakRawPointIds').targetField,
    'expected.weakSampleIds');
  assert.equal(
    aliases.get('expected.rejectedRawPointIds').targetField,
    'expected.rejectedSampleIds');
  assert.equal(
    aliases.get('rawPointDecisions[].rawPointId').targetField,
    'rawPointDecisions[].sampleId');
  assert.equal(
    aliases.get('trackPoints[].sourceRawPointId').targetField,
    'trackPoints[].sourceSampleId');
  assert.equal(
    aliases.get('trackPoints[].latitude').targetField,
    'trackPoints[].lat');
  assert.equal(
    aliases.get('trackPoints[].longitude').targetField,
    'trackPoints[].lng');
  assert.equal(
    aliases.get('trackPoints[].elapsedRealtimeNanos').targetField,
    'trackPoints[].fixElapsedRealtimeNanos');
  assert.equal(
    aliases.get('summary.ascentMeters').status,
    'resolved_in_rust_output_kept_as_deserialization_alias');
  for (const resolvedInputAlias of [
    'locationSamples[].rawPointId',
    'locationSamples[].positioningSource',
    'locationSamples[].latitude',
    'locationSamples[].longitude',
    'locationSamples[].elapsedRealtimeNanos'
  ]) {
    assert.equal(
      aliases.get(resolvedInputAlias).status,
      'resolved_in_rust_output_kept_as_deserialization_alias',
      `${resolvedInputAlias} should be output-resolved`);
  }
  assert.equal(
    aliases.get('rawPointDecisions[].rawPointId').status,
    'resolved_in_rust_output_kept_as_deserialization_alias');
  assert.equal(
    aliases.get('cleaningOperations[].inputRawRange').status,
    'resolved_in_rust_output_kept_as_deserialization_alias');
  assert.equal(
    aliases.get('metricOwnershipRanges[].rawRange').status,
    'resolved_in_rust_output_kept_as_deserialization_alias');
  assert.equal(
    aliases.get('failures[].rawRange').status,
    'temporary_alias_until_sdk_v1_freeze');
  assert.equal(
    aliases.get('expected.acceptedRawPointIds').status,
    'temporary_alias_until_sdk_v1_freeze');
  assert.equal(
    aliases.get('expected.weakRawPointIds').status,
    'temporary_alias_until_sdk_v1_freeze');
  assert.equal(
    aliases.get('expected.rejectedRawPointIds').status,
    'temporary_alias_until_sdk_v1_freeze');
  for (const alias of aliases.values()) {
    if (alias.status === 'resolved_in_rust_output_kept_as_deserialization_alias') continue;
    assert.equal(alias.status, 'temporary_alias_until_sdk_v1_freeze');
  }
});

test('track sdk public api docs are linked from migration and rust docs', async () => {
  const contractDoc = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-public-api-contract.md'), 'utf8');
  const migrationPrompt = await readFile(
    path.join(REPO_ROOT, 'docs/cross-platform-migration-prompt-engineering.md'), 'utf8');
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const agents = await readFile(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  const rustApi = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-rust/03-api-contract.md'), 'utf8');
  const rustReadme = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-rust/README.md'), 'utf8');
  const rustCli = await readFile(
    path.join(REPO_ROOT, 'track-rs/crates/track-cli/src/main.rs'), 'utf8');

  for (const required of [
    'docs/track-sdk-public-api.v1.json',
    'track-rs/schemas/process-request.schema.json',
    'track-rs/schemas/process-response.schema.json',
    'track-rs/schemas/process-debug-response.schema.json',
    'track-rs/schemas/streaming-settlement-state.schema.json',
    'track-rs/schemas/review-queue.schema.json',
    'track-rs/schemas/review-queue-batch.schema.json',
    'track-rs/schemas/review-queue-ai-package.schema.json',
    'track-rs/schemas/review-queue-ai-alignment-result.schema.json',
    'track-rs/schemas/replay-report.schema.json',
    'review-queue-ai-package-v1',
    'review-queue-ai-alignment-result-v1',
    'validate-review-queue-package',
    'fixElapsedRealtimeNanos',
    'totalDescentMeters',
    'inputSampleRange',
    'sampleRange',
    'acceptedSampleIds',
    'rejectedSampleIds',
    'verify_fixtures',
    'review queue',
    'temporary'
  ]) {
    assert.ok(contractDoc.includes(required), `missing SDK API doc text: ${required}`);
  }

  for (const text of [migrationPrompt, readme, agents, rustApi, rustReadme]) {
    assert.ok(
      text.includes('track-sdk-public-api-contract.md'),
      'missing public API contract doc link');
  }
  assert.ok(rustApi.includes('verify-fixtures-json'));
  assert.ok(rustReadme.includes('verify-fixtures-json'));
  assert.ok(rustCli.includes('verify-fixtures-json'));
  assert.ok(rustCli.includes('track-sdk-replay-report-v1'));
  assert.ok(rustCli.includes('track-sdk-replay-fixture-v1'));
  assert.ok(rustCli.includes('failedCount'));
  assert.ok(rustCli.includes('sample_id: Option<i64>'));
  assert.ok(rustCli.includes('sample_range: Option<FixtureSampleRange>'));
  assert.ok(rustCli.includes('request_location_sample_range'));
  assert.ok(rustCli.includes('with_sample_id'));
  assert.ok(rustCli.includes('with_sample_range'));
  assert.ok(rustCli.includes('"acceptedSampleIds"'));
  assert.ok(rustCli.includes('"acceptedRawPointIds"'));
  assert.ok(rustCli.includes('"weakSampleIds"'));
  assert.ok(rustCli.includes('"weakRawPointIds"'));
  assert.ok(rustCli.includes('"rejectedSampleIds"'));
  assert.ok(rustCli.includes('"rejectedRawPointIds"'));
  assert.ok(rustCli.includes('value["sampleRange"]'));
  assert.ok(rustCli.includes('value["rawRange"]'));
  assert.ok(rustCli.includes('"startSampleId"'));
  assert.ok(rustCli.includes('"endSampleId"'));
  assert.equal(rustCli.includes('FixtureRawRange'), false);
  assert.equal(rustCli.includes('raw_range: Option'), false);
  assert.equal(rustCli.includes('with_raw_range'), false);
  assert.equal(rustCli.includes('request_location_sample_raw_range'), false);
});

test('rust replay report schema locks deterministic report shape and failure locators', async () => {
  const schema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/replay-report.schema.json'), 'utf8'));

  assert.equal(schema.properties.schemaVersion.const, 'track-sdk-replay-report-v1');
  for (const required of [
    'strategyVersion',
    'fixtureCount',
    'passedCount',
    'failedCount',
    'failures'
  ]) {
    assert.ok(schema.required.includes(required), `missing report required field ${required}`);
  }

  const failureSchema = schema.properties.failures.items;
  assert.ok(failureSchema.required.includes('message'));
  assert.equal(failureSchema.properties.rawRange.deprecated, true);
  assert.match(failureSchema.properties.rawRange.description, /Legacy locator alias/);
  assert.match(failureSchema.properties.sampleRange.description, /Stable range locator/);
  const locatorFields = failureSchema.anyOf.flatMap((branch) => branch.required || []);
  for (const requiredLocator of ['ruleId', 'sampleRange', 'rawRange', 'sampleId', 'fixturePath']) {
    assert.ok(
      locatorFields.includes(requiredLocator),
      `missing failure locator ${requiredLocator}`);
  }

  assertReplayReportShape({
    schemaVersion: 'track-sdk-replay-report-v1',
    strategyVersion: 'rust-poc',
    fixtureCount: 18,
    passedCount: 18,
    failedCount: 0,
    failures: []
  });
  assertReplayReportShape({
    schemaVersion: 'track-sdk-replay-report-v1',
    strategyVersion: 'rust-poc',
    fixtureCount: 18,
    passedCount: 17,
    failedCount: 1,
    failures: [{
      fixturePath: 'fixtures/normal-3-points.json',
      ruleId: 'safety_kernel_v0',
      message: 'expected.trackPointCount mismatch'
    }]
  });
  assertReplayReportShape({
    schemaVersion: 'track-sdk-replay-report-v1',
    strategyVersion: 'rust-poc',
    fixtureCount: 18,
    passedCount: 17,
    failedCount: 1,
    failures: [{
      fixturePath: 'fixtures/normal-3-points.json',
      ruleId: 'safety_kernel_v0',
      sampleRange: {
        startSampleId: 1,
        endSampleId: 3
      },
      rawRange: {
        startRawPointId: 1,
        endRawPointId: 3
      },
      message: 'expected trackPointCount=999, got 3'
    }]
  });
  assertReplayReportShape({
    schemaVersion: 'track-sdk-replay-report-v1',
    strategyVersion: 'rust-poc',
    fixtureCount: 18,
    passedCount: 17,
    failedCount: 1,
    failures: [{
      fixturePath: 'fixtures/normal-3-points.json',
      ruleId: 'safety_kernel_v0',
      sampleId: 2,
      message: 'expected decisionReasons.2=wrong_reason, got moving_good_fix'
    }]
  });
  assert.throws(
    () => assertReplayReportShape({
      schemaVersion: 'track-sdk-replay-report-v1',
      strategyVersion: 'rust-poc',
      fixtureCount: 1,
      passedCount: 0,
      failedCount: 1,
      failures: [{ message: 'missing locator' }]
    }),
    /failure locator/);
  assert.throws(
    () => assertReplayReportShape({
      schemaVersion: 'track-sdk-replay-report-v1',
      strategyVersion: 'rust-poc',
      fixtureCount: 1,
      passedCount: 0,
      failedCount: 1,
      failures: [{
        rawRange: {
          startRawPointId: 1,
          endRawPointId: 3
        },
        message: 'legacy rawRange without sampleRange'
      }]
    }),
    /sampleRange/);
});

test('rust summary output has moved to stable gain and loss field names', async () => {
  const modelSource = await readFile(
    path.join(REPO_ROOT, 'track-rs/crates/track-model/src/lib.rs'), 'utf8');
  const coreSource = await readFile(
    path.join(REPO_ROOT, 'track-rs/crates/track-core/src/lib.rs'), 'utf8');
  const rustApi = await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-rust/03-api-contract.md'), 'utf8');

  assert.ok(modelSource.includes('#[serde(rename = "totalAscentMeters", alias = "ascentMeters")]'));
  assert.ok(modelSource.includes('pub total_ascent_meters: f64'));
  assert.equal(modelSource.includes('pub ascent_meters: f64'), false);
  assert.ok(modelSource.includes('pub total_descent_meters: f64'));
  assert.ok(modelSource.includes('pub selected_elevation_source: String'));
  assert.ok(modelSource.includes('#[serde(rename = "sampleId", alias = "rawPointId")]'));
  assert.ok(modelSource.includes('#[serde(rename = "provider", alias = "positioningSource")]'));
  assert.ok(modelSource.includes('#[serde(rename = "lat", alias = "latitude")]'));
  assert.ok(modelSource.includes('#[serde(rename = "lng", alias = "longitude")]'));
  assert.ok(modelSource.includes('#[serde(rename = "fixElapsedRealtimeNanos", alias = "elapsedRealtimeNanos")]'));
  assert.ok(modelSource.includes('pub provider: String'));
  assert.equal(modelSource.includes('pub positioning_source: String'), false);
  assert.ok(modelSource.includes('pub lat: f64'));
  assert.ok(modelSource.includes('pub lng: f64'));
  assert.ok(modelSource.includes('pub fix_elapsed_realtime_nanos: i64'));
  assert.ok(modelSource.includes('pub received_elapsed_realtime_nanos: Option<i64>'));
  assert.equal(
    modelSource.includes('pub callback_received_elapsed_realtime_nanos: Option<i64>'),
    false);
  assert.ok(modelSource.includes('json["locationSamples"][0]["sampleId"]'));
  assert.ok(modelSource.includes('json["locationSamples"][0].get("rawPointId").is_none()'));
  assert.ok(modelSource.includes('json["locationSamples"][0]["provider"]'));
  assert.ok(modelSource.includes('.get("positioningSource")'));
  assert.ok(modelSource.includes('json["locationSamples"][0]["lat"]'));
  assert.ok(modelSource.includes('json["locationSamples"][0].get("latitude").is_none()'));
  assert.ok(modelSource.includes('json["locationSamples"][0]["lng"]'));
  assert.ok(modelSource.includes('json["locationSamples"][0].get("longitude").is_none()'));
  assert.ok(modelSource.includes('json["locationSamples"][0]["fixElapsedRealtimeNanos"]'));
  assert.ok(modelSource.includes('json["locationSamples"][0]\n            .get("elapsedRealtimeNanos")'));
  assert.ok(modelSource.includes('assert_eq!(sample.provider, "gnss")'));
  assert.ok(modelSource.includes('assert_eq!(sample.lat, 30.0)'));
  assert.ok(modelSource.includes('assert_eq!(sample.lng, 120.0)'));
  assert.ok(modelSource.includes('assert_eq!(sample.fix_elapsed_realtime_nanos, 2_000)'));
  assert.ok(modelSource.includes('#[serde(rename = "sourceSampleId", alias = "sourceRawPointId")]'));
  assert.ok(modelSource.includes('pub sample_id: i64'));
  assert.equal(modelSource.includes('pub raw_point_id: i64'), false);
  assert.ok(modelSource.includes('pub source_sample_id: i64'));
  assert.equal(modelSource.includes('pub source_raw_point_id: i64'), false);
  assert.ok(modelSource.includes('pub lat: f64'));
  assert.ok(modelSource.includes('pub lng: f64'));
  assert.ok(modelSource.includes('pub fix_elapsed_realtime_nanos: i64'));
  assert.equal(modelSource.includes('pub latitude: f64'), false);
  assert.equal(modelSource.includes('pub longitude: f64'), false);
  assert.equal(modelSource.includes('pub elapsed_realtime_nanos: i64'), false);
  assert.ok(coreSource.includes('lat: sample.lat()'));
  assert.ok(coreSource.includes('lng: sample.lng()'));
  assert.ok(coreSource.includes('fix_elapsed_realtime_nanos: sample.sample.fix_elapsed_realtime_nanos'));
  assert.equal(coreSource.includes('latitude: sample.sample.lat'), false);
  assert.equal(coreSource.includes('longitude: sample.sample.lng'), false);
  assert.equal(
    /\belapsed_realtime_nanos:\s*sample\.sample\.fix_elapsed_realtime_nanos/.test(coreSource),
    false);
  assert.ok(modelSource.includes('json["locationSamples"][0]["sampleId"]'));
  assert.ok(modelSource.includes('json["locationSamples"][0].get("rawPointId").is_none()'));
  assert.ok(modelSource.includes('result_json["trackPoints"][0]["sourceSampleId"]'));
  assert.ok(/result_json\["trackPoints"\]\[0\]\s*\.get\("sourceRawPointId"\)\s*\.is_none\(\)/.test(modelSource));
  assert.ok(modelSource.includes('result_json["trackPoints"][0]["lat"]'));
  assert.ok(modelSource.includes('result_json["trackPoints"][0].get("latitude").is_none()'));
  assert.ok(modelSource.includes('result_json["trackPoints"][0]["fixElapsedRealtimeNanos"]'));
  assert.ok(modelSource.includes('result_json["trackPoints"][0]\n            .get("elapsedRealtimeNanos")'));
  assert.ok(modelSource.includes('debug_json["rawPointDecisions"][0]["sampleId"]'));
  assert.ok(/debug_json\["rawPointDecisions"\]\[0\]\s*\.get\("rawPointId"\)\s*\.is_none\(\)/.test(modelSource));
  assert.ok(modelSource.includes('pub metric_owner: bool'));
  assert.ok(modelSource.includes('pub affected_metric_gates: Vec<String>'));
  assert.ok(modelSource.includes('debug_json["rawPointDecisions"][0]["metricOwner"]'));
  assert.ok(modelSource.includes('debug_json["rawPointDecisions"][0]["affectedMetricGates"]'));
  assert.ok(modelSource.includes('pub cleaning_operations: Vec<CleaningOperation>'));
  assert.ok(modelSource.includes('pub metric_ownership_ranges: Vec<MetricOwnershipRange>'));
  assert.ok(modelSource.includes('pub replay_diagnostics: ReplayDiagnostics'));
  assert.ok(modelSource.includes('pub fn from_metric_owner_decision(decision: &RawPointDecision)'));
  assert.ok(modelSource.includes('owner_id: format!("sample-decision:{}", decision.sample_id)'));
  assert.equal(modelSource.includes('decision.raw_point_id'), false);
  assert.ok(modelSource.includes('#[serde(rename = "inputSampleRange", alias = "inputRawRange")]'));
  assert.ok(modelSource.includes('pub input_sample_range: SampleRange'));
  assert.ok(modelSource.includes('#[serde(rename = "sampleRange", alias = "rawRange")]'));
  assert.ok(modelSource.includes('pub sample_range: SampleRange'));
  assert.ok(modelSource.includes('filter_map(MetricOwnershipRange::from_metric_owner_decision)'));
  assert.ok(modelSource.includes('debug_json["cleaningOperations"]'));
  assert.ok(modelSource.includes('debug_json["metricOwnershipRanges"]'));
  assert.ok(modelSource.includes('"ownerId": "sample-decision:1"'));
  assert.equal(modelSource.includes('"ownerId": "raw-decision:1"'), false);
  assert.ok(modelSource.includes('"sampleRange": {'));
  assert.ok(modelSource.includes('"startSampleId": 1'));
  assert.ok(modelSource.includes('.get("rawRange")'));
  assert.ok(modelSource.includes('debug_json["replayDiagnostics"]["settlementScope"]'));
  assert.ok(modelSource.includes('result_json["summary"]["totalAscentMeters"]'));
  assert.ok(modelSource.includes('result_json["summary"]["totalDescentMeters"]'));
  assert.ok(modelSource.includes('result_json["summary"].get("ascentMeters").is_none()'));
  assert.ok(rustApi.includes('summary.ascentMeters` 已从 Rust 输出收敛到 `summary.totalAscentMeters`'));
  assert.ok(rustApi.includes('RawPointDecision:\n  sampleId'));
  assert.equal(rustApi.includes('RawPointDecision:\n  rawPointId'), false);
  assert.ok(rustApi.includes('sample-decision:<sampleId>'));
  assert.equal(rustApi.includes('raw-decision:<sampleId>'), false);
});

test('track sdk public api invariants keep replay deterministic and diagnostic-only boundaries', async () => {
  const contract = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-public-api.v1.json'), 'utf8'));
  const invariantIds = new Set(contract.invariants.map((item) => item.id));

  for (const required of [
    'raw-evidence-only',
    'fix-time-continuity',
    'diagnostic-delay-only',
    'descent-preserved',
    'debug-keeps-rejected',
    'metric-owner-non-overlap',
    'deterministic-replay'
  ]) {
    assert.ok(invariantIds.has(required), `missing invariant ${required}`);
  }
});

test('platform neutral engine doc uses evidence v1 location and decision field names', async () => {
  const engineDoc = await readFile(
    path.join(REPO_ROOT, 'docs/platform-neutral-track-engine-contract.md'), 'utf8');

  assert.ok(engineDoc.includes('NormalizedLocationSample:\n  sampleId'));
  assert.ok(engineDoc.includes('  lat\n  lng'));
  assert.ok(engineDoc.includes('  fixElapsedRealtimeNanos'));
  assert.ok(engineDoc.includes('  receivedElapsedRealtimeNanos optional'));
  assert.ok(engineDoc.includes('RawPointDecision:\n  sampleId'));
  assert.equal(engineDoc.includes('NormalizedLocationSample:\n  rawPointId'), false);
  assert.equal(engineDoc.includes('RawPointDecision:\n  rawPointId'), false);
});

test('process request schema locks stable v1 input field names', async () => {
  const schema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/process-request.schema.json'), 'utf8'));
  const stableExample = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/examples/minimal-stable-v1-input.json'), 'utf8'));
  const publicApi = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'docs/track-sdk-public-api.v1.json'), 'utf8'));

  assert.equal(schema.properties.schemaVersion.const, 'track-sdk-process-request-v1');
  assert.equal(
    publicApi.models.TrackProcessRequest.schemaPath,
    'track-rs/schemas/process-request.schema.json');
  for (const required of ['schemaVersion', 'config', 'input']) {
    assert.ok(schema.required.includes(required), `missing process request field ${required}`);
  }

  const locationSampleSchema = schema.properties.input.properties.locationSamples.items;
  for (const required of [
    'sampleId',
    'provider',
    'lat',
    'lng',
    'horizontalAccuracyMeters',
    'wallTimeMillis',
    'fixElapsedRealtimeNanos',
    'isMock'
  ]) {
    assert.ok(
      locationSampleSchema.required.includes(required),
      `missing location sample field ${required}`);
  }

  const bannedLegacyFields = locationSampleSchema.not.anyOf
    .flatMap((branch) => branch.required || []);
  for (const legacyField of [
    'rawPointId',
    'positioningSource',
    'latitude',
    'longitude',
    'elapsedRealtimeNanos',
    'callbackReceivedElapsedRealtimeNanos'
  ]) {
    assert.ok(
      bannedLegacyFields.includes(legacyField),
      `process request schema must reject ${legacyField}`);
  }

  assert.equal(stableExample.schemaVersion, 'track-sdk-process-request-v1');
  assertProcessRequestShape(stableExample);
});

test('process response schemas lock stable v1 output field names', async () => {
  const processSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/process-response.schema.json'), 'utf8'));
  const debugSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/process-debug-response.schema.json'), 'utf8'));

  const pointSchema = processSchema.$defs.CleanedTrackPoint;
  for (const required of [
    'trackPointId',
    'sourceSampleId',
    'lat',
    'lng',
    'fixElapsedRealtimeNanos',
    'wallTimeMillis',
    'horizontalAccuracyMeters',
    'distanceDeltaMeters',
    'movingTimeDeltaSeconds',
    'segmentId'
  ]) {
    assert.ok(pointSchema.required.includes(required), `missing output point field ${required}`);
  }

  const bannedLegacyFields = pointSchema.not.anyOf.flatMap((branch) => branch.required || []);
  for (const legacyField of [
    'sourceRawPointId',
    'latitude',
    'longitude',
    'elapsedRealtimeNanos'
  ]) {
    assert.ok(
      bannedLegacyFields.includes(legacyField),
      `process response schema must reject ${legacyField}`);
  }

  const summarySchema = processSchema.$defs.TrackSummary;
  assert.ok(summarySchema.required.includes('totalAscentMeters'));
  assert.ok(summarySchema.required.includes('totalDescentMeters'));
  assert.deepEqual(summarySchema.properties.selectedElevationSource.enum, [
    'BAROMETER',
    'GNSS',
    'NONE'
  ]);

  const decisionSchema = debugSchema.$defs.RawPointDecision;
  assert.ok(decisionSchema.required.includes('sampleId'));
  assert.ok(decisionSchema.required.includes('metricOwner'));
  assert.ok(decisionSchema.required.includes('affectedMetricGates'));
  assert.ok(decisionSchema.not.required.includes('rawPointId'));
  for (const requiredDebugField of [
    'cleaningOperations',
    'metricOwnershipRanges',
    'replayDiagnostics'
  ]) {
    assert.ok(
      debugSchema.$defs.TrackProcessDebugResult.required.includes(requiredDebugField),
      `missing debug result field ${requiredDebugField}`);
  }
  const cleaningOperationSchema = debugSchema.$defs.CleaningOperation;
  assert.ok(cleaningOperationSchema.required.includes('inputSampleRange'));
  assert.ok(cleaningOperationSchema.not.required.includes('inputRawRange'));
  assert.equal(
    cleaningOperationSchema.properties.inputSampleRange.$ref,
    '#/$defs/SampleRange');
  const metricOwnershipRangeSchema = debugSchema.$defs.MetricOwnershipRange;
  assert.ok(metricOwnershipRangeSchema.required.includes('sampleRange'));
  assert.ok(metricOwnershipRangeSchema.not.required.includes('rawRange'));
  assert.equal(
    metricOwnershipRangeSchema.properties.sampleRange.$ref,
    '#/$defs/SampleRange');
  assert.deepEqual(
    debugSchema.$defs.MetricOwnershipRange.properties.affectedMetricGates.items.enum,
    ['route', 'distance', 'moving_time', 'elevation']);
  assert.deepEqual(debugSchema.$defs.SampleRange.required, [
    'startSampleId',
    'endSampleId'
  ]);
  assert.deepEqual(debugSchema.$defs.ReplayDiagnostics.required, [
    'engine',
    'settlementScope',
    'notes'
  ]);

  assertProcessResponseShape({
    ok: true,
    result: {
      trackPoints: [stableTrackPoint()],
      segments: [{
        segmentId: 1,
        startTrackPointId: 1,
        endTrackPointId: 1,
        distanceMeters: 0,
        movingTimeSeconds: 0
      }],
      gpxTrackPoints: [stableTrackPoint()],
      summary: {
        totalDistanceMeters: 0,
        movingTimeSeconds: 0,
        paceSecondsPerKm: null,
        totalAscentMeters: 0,
        totalDescentMeters: 0,
        selectedElevationSource: 'NONE'
      }
    }
  });
});

test('streaming settlement state schema locks sample-based realtime contract', async () => {
  const schema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/streaming-settlement-state.schema.json'), 'utf8'));

  assert.deepEqual(schema.required, [
    'schemaVersion',
    'committedCursorSampleId',
    'commitSequence',
    'committedRanges',
    'committedMetricOwnershipRanges',
    'hardBoundaryCheckpoints',
    'blockingRanges',
    'lastCommitPlanStatus',
    'lastCommitWatermark'
  ]);
  assert.equal(schema.properties.schemaVersion.const,
    'track-sdk-streaming-settlement-state-v1');
  assert.deepEqual(schema.properties.lastCommitPlanStatus.enum, [
    'none',
    'committable',
    'blocked_at_watermark'
  ]);
  assert.equal(schema.properties.lastCommitWatermark.minimum, 0);
  assert.equal(
    schema.$defs.CommittedRange.properties.sampleRange.$ref,
    '#/$defs/SampleRange');
  assert.equal(
    schema.$defs.CommittedMetricOwnershipRange.properties.sampleRange.$ref,
    '#/$defs/SampleRange');
  assert.equal(
    schema.$defs.HardBoundaryCheckpoint.properties.sampleRange.$ref,
    '#/$defs/SampleRange');
  assert.equal(
    schema.$defs.BlockingRange.properties.sampleRange.$ref,
    '#/$defs/SampleRange');
  assert.deepEqual(schema.$defs.SampleRange.required, [
    'startSampleId',
    'endSampleId'
  ]);
  assert.deepEqual(schema.$defs.MetricGate.enum, [
    'route',
    'distance',
    'moving_time',
    'elevation'
  ]);
  const topLevelBannedFields = schema.not.anyOf.flatMap((branch) => branch.required || []);
  for (const bannedField of [
    'committedCursorRawPointId',
    'lastCommitWatermarkRawPointId',
    'rawRange',
    'range'
  ]) {
    assert.ok(topLevelBannedFields.includes(bannedField),
      `streaming settlement schema must reject top-level ${bannedField}`);
  }
  for (const defName of [
    'CommittedRange',
    'CommittedMetricOwnershipRange',
    'HardBoundaryCheckpoint',
    'BlockingRange'
  ]) {
    const bannedFields = schema.$defs[defName].not.anyOf
      .flatMap((branch) => branch.required || []);
    assert.ok(bannedFields.includes('rawRange'), `${defName} must reject rawRange`);
    assert.ok(bannedFields.includes('range'), `${defName} must reject range`);
  }
});

test('review queue schemas carry streaming settlement state contract', async () => {
  const reviewQueueSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/review-queue.schema.json'), 'utf8'));
  const batchSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/review-queue-batch.schema.json'), 'utf8'));
  const packageSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/review-queue-ai-package.schema.json'), 'utf8'));
  const alignmentResultSchema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/review-queue-ai-alignment-result.schema.json'),
    'utf8'));

  assert.equal(reviewQueueSchema.properties.schemaVersion.const, 'review-queue-v1');
  assert.ok(reviewQueueSchema.required.includes('streamingSettlementState'));
  assert.equal(
    reviewQueueSchema.properties.streamingSettlementState.$ref,
    'streaming-settlement-state.schema.json');
  assert.deepEqual(reviewQueueSchema.properties.filter.enum, [
    'all',
    'metric',
    'diagnostic',
    'highRisk',
    'pending'
  ]);
  assert.deepEqual(reviewQueueSchema.$defs.ReviewTask.properties.type.enum, [
    'scenario',
    'conflict',
    'diagnostic_context'
  ]);
  assert.deepEqual(reviewQueueSchema.$defs.MetricGate.enum, [
    'route',
    'distance',
    'moving_time',
    'elevation'
  ]);

  assert.equal(batchSchema.properties.schemaVersion.const, 'review-queue-batch-v1');
  assert.equal(
    batchSchema.properties.exports.items.$ref,
    'review-queue.schema.json');

  assert.equal(
    packageSchema.properties.schemaVersion.const,
    'review-queue-ai-package-v1');
  assert.deepEqual(packageSchema.properties.filter.enum, [
    'all',
    'metric',
    'diagnostic',
    'highRisk',
    'pending'
  ]);
  assert.deepEqual(packageSchema.properties.files.required, [
    'reviewQueueJson',
    'reviewQueueReport',
    'aiPrompt',
    'packageManifest'
  ]);
  assert.deepEqual(
    packageSchema.properties.contracts.contains.const,
    'track-rs/schemas/review-queue-ai-package.schema.json');

  assert.equal(
    alignmentResultSchema.properties.schemaVersion.const,
    'review-queue-ai-alignment-result-v1');
  for (const required of [
    'alignable',
    'hasP0',
    'hasP1',
    'differences',
    'nextActions'
  ]) {
    assert.ok(alignmentResultSchema.required.includes(required),
      `alignment result schema must require ${required}`);
  }
  assert.deepEqual(alignmentResultSchema.$defs.Severity.enum, ['P0', 'P1', 'P2']);
  assert.deepEqual(alignmentResultSchema.$defs.RawRange.required, [
    'startRawPointId',
    'endRawPointId'
  ]);
  assert.ok(alignmentResultSchema.$defs.Difference.required.includes('reviewKey'));
  assert.ok(alignmentResultSchema.$defs.Difference.required.includes('rawRange'));
});

test('rust replay fixtures declare track-sdk v1 gain and loss expectations', async () => {
  const fixtureDir = path.join(REPO_ROOT, 'track-rs/fixtures');
  const fileNames = (await readdir(fixtureDir))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  assert.ok(fileNames.length > 0, 'expected Rust replay fixtures');
  for (const fileName of fileNames) {
    const fixture = JSON.parse(await readFile(path.join(fixtureDir, fileName), 'utf8'));
    assert.equal(
      fixture.schemaVersion,
      'track-sdk-replay-fixture-v1',
      `${fileName} schemaVersion`);
    assert.equal(
      typeof fixture.expected.totalAscentMeters,
      'number',
      `${fileName} expected.totalAscentMeters`);
    assert.equal(
      typeof fixture.expected.totalDescentMeters,
      'number',
      `${fileName} expected.totalDescentMeters`);
    assert.equal(
      Array.isArray(fixture.expected.acceptedSampleIds),
      true,
      `${fileName} expected.acceptedSampleIds`);
    assert.equal(
      Array.isArray(fixture.expected.rejectedSampleIds),
      true,
      `${fileName} expected.rejectedSampleIds`);
    if (fixture.expected.decisionReasons) {
      for (const sampleId of Object.keys(fixture.expected.decisionReasons)) {
        assert.match(
          sampleId,
          /^[0-9]+$/,
          `${fileName} expected.decisionReasons key must be sampleId`);
      }
    }
    for (const legacyField of [
      'acceptedRawPointIds',
      'weakRawPointIds',
      'rejectedRawPointIds'
    ]) {
      assert.equal(
        Object.hasOwn(fixture.expected, legacyField),
        false,
        `${fileName} must not use expected.${legacyField}`);
    }
  }

  const schema = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/schemas/fixture.schema.json'), 'utf8'));
  assert.ok(schema.required.includes('schemaVersion'));
  assert.ok(schema.properties.expected.required.includes('totalAscentMeters'));
  assert.ok(schema.properties.expected.required.includes('totalDescentMeters'));
  assert.equal(
    schema.properties.expected.properties.decisionReasons.propertyNames.pattern,
    '^[0-9]+$');
  for (const stableField of ['acceptedSampleIds', 'weakSampleIds', 'rejectedSampleIds']) {
    assert.equal(
      schema.properties.expected.properties[stableField].type,
      'array',
      `missing stable fixture field ${stableField}`);
  }
  for (const legacyField of ['acceptedRawPointIds', 'weakRawPointIds', 'rejectedRawPointIds']) {
    assert.equal(
      schema.properties.expected.properties[legacyField].deprecated,
      true,
      `legacy fixture field ${legacyField} must be deprecated`);
  }
  assert.ok(schema.properties.source.enum.includes('android_replay'));
  assert.ok(schema.properties.source.enum.includes('real_session_slice'));
});

test('rust poc accepts stable v1 location input aliases at the serde boundary', async () => {
  const modelSource = await readFile(
    path.join(REPO_ROOT, 'track-rs/crates/track-model/src/lib.rs'), 'utf8');
  const stableExample = JSON.parse(await readFile(
    path.join(REPO_ROOT, 'track-rs/examples/minimal-stable-v1-input.json'), 'utf8'));

  for (const alias of [
    '#[serde(rename = "sampleId", alias = "rawPointId")]',
    '#[serde(rename = "provider", alias = "positioningSource")]',
    '#[serde(rename = "lat", alias = "latitude")]',
    '#[serde(rename = "lng", alias = "longitude")]',
    '#[serde(rename = "fixElapsedRealtimeNanos", alias = "elapsedRealtimeNanos")]',
    'rename = "receivedElapsedRealtimeNanos"',
    'alias = "callbackReceivedElapsedRealtimeNanos"'
  ]) {
    assert.ok(modelSource.includes(alias), `missing Rust serde alias ${alias}`);
  }
  assert.ok(modelSource.includes('pub schema_version: Option<String>'));
  assert.ok(modelSource.includes('skip_serializing_if = "Option::is_none"'));

  assert.equal(stableExample.schemaVersion, 'track-sdk-process-request-v1');
  const firstSample = stableExample.input.locationSamples[0];
  assert.equal(firstSample.sampleId, 1);
  assert.equal(firstSample.provider, 'gnss');
  assert.equal(firstSample.lat, 30);
  assert.equal(firstSample.lng, 120);
  assert.equal(firstSample.fixElapsedRealtimeNanos, 1_000_000_000);
  assert.ok(Object.hasOwn(firstSample, 'receivedElapsedRealtimeNanos'));
  for (const temporaryField of [
    'rawPointId',
    'positioningSource',
    'latitude',
    'longitude',
    'elapsedRealtimeNanos',
    'callbackReceivedElapsedRealtimeNanos'
  ]) {
    assert.equal(
      Object.hasOwn(firstSample, temporaryField),
      false,
      `stable example must not use ${temporaryField}`);
  }
});

function stableTrackPoint() {
  return {
    trackPointId: 1,
    sourceSampleId: 1,
    lat: 30,
    lng: 120,
    trackDirectionDegrees: null,
    fixElapsedRealtimeNanos: 1_000_000_000,
    wallTimeMillis: 1_000,
    horizontalAccuracyMeters: 8,
    distanceDeltaMeters: 0,
    movingTimeDeltaSeconds: 0,
    segmentId: 1
  };
}

function assertProcessResponseShape(response) {
  assert.equal(response.ok, true);
  assert.equal(typeof response.result, 'object');
  assert.equal(Array.isArray(response.result.trackPoints), true);
  assert.equal(Array.isArray(response.result.gpxTrackPoints), true);
  for (const collection of [response.result.trackPoints, response.result.gpxTrackPoints]) {
    for (const point of collection) {
      for (const required of [
        'trackPointId',
        'sourceSampleId',
        'lat',
        'lng',
        'fixElapsedRealtimeNanos',
        'wallTimeMillis',
        'horizontalAccuracyMeters',
        'distanceDeltaMeters',
        'movingTimeDeltaSeconds',
        'segmentId'
      ]) {
        assert.ok(Object.hasOwn(point, required), `track point missing ${required}`);
      }
      for (const legacyField of [
        'sourceRawPointId',
        'latitude',
        'longitude',
        'elapsedRealtimeNanos'
      ]) {
        assert.equal(
          Object.hasOwn(point, legacyField),
          false,
          `stable process response must not use ${legacyField}`);
      }
    }
  }
}

function assertProcessRequestShape(request) {
  assert.equal(request.schemaVersion, 'track-sdk-process-request-v1');
  assert.equal(typeof request.config, 'object');
  assert.equal(typeof request.input, 'object');
  assert.equal(Array.isArray(request.input.locationSamples), true);
  for (const sample of request.input.locationSamples) {
    for (const required of [
      'sampleId',
      'provider',
      'lat',
      'lng',
      'horizontalAccuracyMeters',
      'wallTimeMillis',
      'fixElapsedRealtimeNanos',
      'isMock'
    ]) {
      assert.ok(Object.hasOwn(sample, required), `sample missing ${required}`);
    }
    for (const legacyField of [
      'rawPointId',
      'positioningSource',
      'latitude',
      'longitude',
      'elapsedRealtimeNanos',
      'callbackReceivedElapsedRealtimeNanos'
    ]) {
      assert.equal(
        Object.hasOwn(sample, legacyField),
        false,
        `stable process request must not use ${legacyField}`);
    }
  }
}

function assertReplayReportShape(report) {
  assert.equal(report.schemaVersion, 'track-sdk-replay-report-v1');
  assert.equal(typeof report.strategyVersion, 'string');
  assert.ok(report.strategyVersion.length > 0);
  for (const field of ['fixtureCount', 'passedCount', 'failedCount']) {
    assert.equal(Number.isInteger(report[field]), true, `${field} must be an integer`);
    assert.ok(report[field] >= 0, `${field} must be non-negative`);
  }
  assert.equal(Array.isArray(report.failures), true, 'failures must be an array');
  assert.equal(
    report.failures.length,
    report.failedCount,
    'failedCount must match failures.length');
  assert.equal(
    report.passedCount + report.failedCount,
    report.fixtureCount,
    'fixtureCount must match passedCount + failedCount');
  for (const failure of report.failures) {
    assert.equal(typeof failure.message, 'string');
    assert.ok(failure.message.length > 0);
    const hasLocator = typeof failure.fixturePath === 'string'
      || typeof failure.ruleId === 'string'
      || typeof failure.sampleId === 'number'
      || failure.sampleRange !== undefined
      || failure.rawRange !== undefined;
    assert.equal(hasLocator, true, 'failure locator is required');
    if (failure.sampleId !== undefined) {
      assert.equal(Number.isInteger(failure.sampleId), true, 'sampleId must be an integer');
      assert.ok(failure.sampleId > 0, 'sampleId must be positive');
    }
    if (failure.rawRange !== undefined) {
      assert.notEqual(
        failure.sampleRange,
        undefined,
        'rawRange is legacy-only and must mirror sampleRange in stable reports');
      assert.equal(
        Number.isInteger(failure.rawRange.startRawPointId),
        true,
        'rawRange.startRawPointId must be an integer');
      assert.equal(
        Number.isInteger(failure.rawRange.endRawPointId),
        true,
        'rawRange.endRawPointId must be an integer');
      assert.ok(failure.rawRange.startRawPointId > 0);
      assert.ok(failure.rawRange.endRawPointId >= failure.rawRange.startRawPointId);
    }
    if (failure.sampleRange !== undefined) {
      assert.equal(
        Number.isInteger(failure.sampleRange.startSampleId),
        true,
        'sampleRange.startSampleId must be an integer');
      assert.equal(
        Number.isInteger(failure.sampleRange.endSampleId),
        true,
        'sampleRange.endSampleId must be an integer');
      assert.ok(failure.sampleRange.startSampleId > 0);
      assert.ok(failure.sampleRange.endSampleId >= failure.sampleRange.startSampleId);
    }
  }
}
