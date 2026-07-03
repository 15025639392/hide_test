# API 契约草案

稳定 v1 公共 API 以仓库根文档为准：

```text
docs/track-sdk-public-api-contract.md
docs/track-sdk-public-api.v1.json
track-rs/schemas/process-request.schema.json
track-rs/schemas/process-response.schema.json
track-rs/schemas/process-debug-response.schema.json
track-rs/schemas/streaming-settlement-state.schema.json
track-rs/schemas/review-queue.schema.json
track-rs/schemas/review-queue-batch.schema.json
track-rs/schemas/review-queue-ai-package.schema.json
track-rs/schemas/review-queue-ai-alignment-result.schema.json
track-rs/schemas/fixture.schema.json
track-rs/schemas/replay-report.schema.json
```

本文件描述 Rust POC 当前落地形态和向稳定 v1 API 收敛的执行口径。Rust POC 中位置样本
输出已使用 `sampleId`、`provider`、`lat`、`lng`、`fixElapsedRealtimeNanos`；
旧 `rawPointId`、`positioningSource`、`latitude`、`longitude`、`elapsedRealtimeNanos`
仅作为反序列化 alias。`summary.ascentMeters` 已从 Rust 输出收敛到 `summary.totalAscentMeters`，
只保留为反序列化 alias。稳定 summary 还必须包含 `totalDescentMeters`。
`RawPointDecision` 输出已使用 `sampleId`，并继续接受 `rawPointId` 作为反序列化 alias。
`NormalizedLocationSample` 输出使用 `receivedElapsedRealtimeNanos`，并继续接受
`callbackReceivedElapsedRealtimeNanos` 作为 Android legacy alias。
`CleanedTrackPoint` 输出已使用 `sourceSampleId`、`lat`、`lng` 和
`fixElapsedRealtimeNanos`，并继续接受 `sourceRawPointId`、`latitude`、`longitude`
和 `elapsedRealtimeNanos` 作为反序列化 alias。

第一阶段先冻结批处理 API。流式 API 等批处理 replay 对齐稳定后再做。

## 批处理 API

```rust
pub fn process(input: OutdoorTrackInput, config: TrackConfig) -> CleanedTrackResult;
```

输入完整 session，输出成品结果。

```text
OutdoorTrackInput:
  sessionContext
  samplingEpochs[]
  locationSamples[]
  motionWindows[]
  barometerWindows[]
  barometerCalibrations[] optional
```

普通输出：

```text
CleanedTrackResult:
  trackPoints[]
  segments[]
  gpxTrackPoints[]
  summary:
    totalDistanceMeters
    movingTimeSeconds
    paceSecondsPerKm optional
    totalAscentMeters
    totalDescentMeters
    selectedElevationSource
```

`trackDirectionDegrees` 输出在 `CleanedTrackPoint` 上，表示当前点相对前一个清洗轨迹点
的方向角：正北为 `0` 度，顺时针递增，东为 `90`，南为 `180`，西为 `270`。首点或
零距离移动没有稳定方向，输出 `null`。

## Debug API

```rust
pub fn process_debug(
  input: OutdoorTrackInput,
  config: TrackConfig
) -> CleanedTrackDebugResult;
```

debug 输出用于 replay、验收和 Web 复核：

```text
CleanedTrackDebugResult:
  result
  rawPointDecisions[]
  cleaningOperations[]
  barometerWindowDecisions[]
  rejectedRawPoints[]
  debugFindings[]
```

当前 POC 的 debug result 已先落最小字段：

```text
CleanedTrackDebugResult:
  cleanedTrack
  rawPointDecisions[]
  cleaningOperations[]
  metricOwnershipRanges[]
  replayDiagnostics

RawPointDecision:
  sampleId
  result: accept | weak | reject
  reason
  trackPointId optional
  metricOwner
  affectedMetricGates[]
```

`cleaningOperations[]` 当前先输出空数组；`metricOwnershipRanges[]` 由 accepted
`RawPointDecision` 生成最小单点 ownership range，ownerId 使用
`sample-decision:<sampleId>`，range 字段输出为 `sampleRange`。`replayDiagnostics.engine=rust-poc` 且
`settlementScope=base_kernel_only`，明确当前 Rust POC 只覆盖基础内核，还没有输出局部
settlement 操作。

`reason` 当前先对齐 Web intake 命名：

```text
intake_accepted
missing_position_source
mock_location
invalid_coordinate
missing_fix_elapsed_realtime
before_record_start
invalid_accuracy
accuracy_too_large
duplicate_fix
out_of_order_fix
sampling_epoch_mismatch
```

## CleaningOperation

建议用清洗动作表达内部情景结果：

```text
CleaningOperation:
  operationId
  kind
  inputSampleRange
  outputTrackRange optional
  affectedTrackPointIds[]
  distancePolicy
  movingTimePolicy
  gpxPolicy
  reasonCode
  debugSummary optional
```

`kind` 示例：

```text
CollapseToAnchor
RemoveSpike
BridgeGap
SimplifyPolyline
ExcludeTransport
PreserveEndpoint
ResetBoundary
```

普通 App 不需要展示这些；Web 复核和 replay 报告可以使用。
旧 `inputRawRange` 和 `metricOwnershipRanges[].rawRange` 只作为反序列化 alias 保留；
Rust CLI 稳定输出使用 `inputSampleRange` / `sampleRange`。

## FFI JSON API

第一版跨端 API 保持简单：

```c
char* track_process_json(const char* input_json);
void track_free_string(char* ptr);
```

`track_process_debug_json` 属于后续 debug API，不是当前 POC 的必需入口。

CLI 当前已提供 debug 输出：

```bash
track-cli process-debug input.json
track-cli verify-fixtures fixtures
track-cli verify-fixtures-json fixtures
```

输入 JSON：

```json
{
  "config": {},
  "input": {
    "sessionContext": {},
    "samplingEpochs": [],
    "locationSamples": [],
    "motionWindows": [],
    "barometerWindows": []
  }
}
```

稳定 v1 `process` 输出口径示例：

```json
{
  "ok": true,
  "result": {
    "trackPoints": [
      {
        "trackPointId": 1,
        "sourceSampleId": 1,
        "lat": 30,
        "lng": 120,
        "fixElapsedRealtimeNanos": 1000000000,
        "trackDirectionDegrees": null
      }
    ],
    "segments": [],
    "gpxTrackPoints": [
      {
        "trackPointId": 1,
        "sourceSampleId": 1,
        "lat": 30,
        "lng": 120,
        "fixElapsedRealtimeNanos": 1000000000,
        "trackDirectionDegrees": null
      }
    ],
    "summary": {
      "totalDistanceMeters": 0,
      "movingTimeSeconds": 0,
      "paceSecondsPerKm": null,
      "totalAscentMeters": 0,
      "totalDescentMeters": 0,
      "selectedElevationSource": "NONE"
    }
  }
}
```

当前 Rust POC 的 CLI 输出 summary 已使用 `totalAscentMeters`、`totalDescentMeters` 和
`selectedElevationSource`；仍保留输入侧 temporary aliases 以兼容 POC fixture。
位置样本 serde 输出和输入侧均使用 `sampleId`、`provider`、`lat`、`lng`、
`fixElapsedRealtimeNanos`；旧字段仅作为读取 alias。示例见
`track-rs/examples/minimal-stable-v1-input.json`。
Rust POC 内部 `NormalizedLocationSample` 和 `CleanedTrackPoint` 字段也已收敛到
`sample_id`、`provider`、`lat`、`lng`、`fix_elapsed_realtime_nanos` /
`source_sample_id`，避免公共契约稳定后继续在实现层扩散旧 raw/location 命名。
当前 POC fixtures 已使用 `schemaVersion=track-sdk-replay-fixture-v1`，并要求
`expected.totalAscentMeters` 与 `expected.totalDescentMeters`；其中 descent 先显式为
`0.0`，直到 Rust Core 真正实现下降累计。
fixture expected 的点级期望使用 `acceptedSampleIds`、`weakSampleIds`、
`rejectedSampleIds`；旧 `acceptedRawPointIds`、`weakRawPointIds`、
`rejectedRawPointIds` 只作为读取 alias 保留。
`decisionReasons` 是可选的点级 reason 期望表，key 必须是 `sampleId` 的十进制
字符串形式，value 是对应 `RawPointDecision.reason`。

`verify-fixtures-json` 已输出 `track-sdk-replay-report-v1`：

```json
{
  "schemaVersion": "track-sdk-replay-report-v1",
  "strategyVersion": "rust-poc",
  "fixtureCount": 18,
  "passedCount": 18,
  "failedCount": 0,
  "failures": []
}
```

range-level failure 使用 `sampleRange` 作为稳定 locator。`rawRange` 在过渡期可以作为
legacy mirror 输出给旧 review/report 工具，但新 target 不能只输出 `rawRange`。
Rust CLI 内部 failure locator 使用 `FixtureSampleRange` / `sample_range` 命名；
`rawRange` 只出现在 JSON legacy mirror 层。

错误输出：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_input",
    "message": "locationSamples is required"
  }
}
```

## 流式 API

流式 API 不是第一阶段目标。等批处理结果稳定后，再提供：

```rust
pub struct SessionEngine;

impl SessionEngine {
    pub fn start(context: SessionContext, config: TrackConfig) -> Self;
    pub fn append_location(&mut self, sample: NormalizedLocationSample);
    pub fn append_motion(&mut self, window: NormalizedMotionWindow);
    pub fn append_barometer(&mut self, window: NormalizedBarometerWindow);
    pub fn snapshot(&self) -> CleanedTrackResult;
    pub fn finish(self) -> CleanedTrackResult;
}
```

早期 `snapshot()` 和 `finish()` 可以复用批处理 `process()`。只有在性能瓶颈明确后，
才逐步增量化热点模块。
