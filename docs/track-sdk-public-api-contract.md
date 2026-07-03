# Track SDK Public API And Replay Contract

本文冻结平台中立 Track SDK 的公共 API、debug API 和 replay fixture 契约。它服务三件事：

1. 让 Android / Web / Rust / iOS / 鸿蒙使用同一个输入输出口径。
2. 让端侧 SDK runner 能跑同一批 replay fixture。
3. 防止当前 Rust POC 的过渡字段名变成长期公共 API。

机器可读版本：

```text
docs/track-sdk-public-api.v1.json
track-rs/schemas/process-request.schema.json
track-rs/schemas/process-response.schema.json
track-rs/schemas/process-debug-response.schema.json
track-rs/schemas/apple-integration-manifest.schema.json
track-rs/schemas/product-snapshot.schema.json
track-rs/schemas/product-snapshot-comparison.schema.json
track-rs/schemas/verification-manifest.schema.json
track-rs/schemas/verification-status.schema.json
track-rs/schemas/streaming-settlement-state.schema.json
track-rs/schemas/review-queue.schema.json
track-rs/schemas/review-queue-batch.schema.json
track-rs/schemas/review-queue-ai-package.schema.json
track-rs/schemas/review-queue-ai-alignment-result.schema.json
track-rs/schemas/fixture.schema.json
track-rs/schemas/replay-report.schema.json
track-rs/verification-manifest.json
```

## API 分层

| API | 输入 | 输出 | 用途 |
| --- | --- | --- | --- |
| `process` | `TrackProcessRequest` | `TrackProcessResponse` | 普通产品结果。 |
| `process_debug` | `TrackProcessRequest` | `TrackProcessDebugResponse` | replay、验收、Web 复核和差异定位。 |
| `verify_fixtures` | `TrackReplayFixture[]` | `TrackReplayReport` | 三端确定性回放对齐。 |

SDK Core 只消费平台中立 evidence 派生输入。`review-queue-v1` /
`review-queue-batch-v1` 和 `review-queue-ai-package-v1` 是 review queue 审核/发包产物，
不是 engine 输入。

当前 Rust POC 的命令行入口包括：

```text
track-cli process-product-snapshot <input.json>
track-cli process-evidence-jsonl-product-snapshot <evidence.jsonl>
track-cli verify-fixtures-json <fixtures-dir>
```

`process-product-snapshot` 输出 `track-rs/schemas/product-snapshot.schema.json` 约束的轻量
产品结果，用于 Watch live、iPhone final、Web acceptance 和 Rust replay 对齐。
`process-evidence-jsonl-product-snapshot` 从 `outdoor-track-evidence-v1` JSONL 直接生成同一
轻量产品结果，推荐用于复核 watchOS / iPhone 已落盘 evidence。
`check-static-contracts.py --compare-product-snapshot-json` 输出
`track-product-snapshot-comparison-v1`，契约为
`track-rs/schemas/product-snapshot-comparison.schema.json`。
`verify-fixtures-json` 输出 `track-sdk-replay-report-v1`。原有 `verify-fixtures` 文本输出
暂时保留给人工快速检查。

## TrackProcessRequest

```text
TrackProcessRequest:
  schemaVersion = track-sdk-process-request-v1
  config: TrackConfig
  input: OutdoorTrackInput
```

`OutdoorTrackInput` 来自 `outdoor-track-evidence-v1`：

```text
OutdoorTrackInput:
  sessionContext
  samplingEpochs[]
  locationSamples[]
  motionWindows[]
  barometerWindows[]
  barometerCalibrations[]
  sessionEvents[]
```

位置样本稳定字段使用 evidence 契约命名：

```text
LocationSample:
  sampleId
  provider
  lat
  lng
  horizontalAccuracyMeters
  altitudeMeters optional
  verticalAccuracyMeters optional
  speedMetersPerSecond optional
  bearingDegrees optional
  wallTimeMillis
  fixElapsedRealtimeNanos
  receivedElapsedRealtimeNanos optional
  callbackDelayNanos optional
  samplingEpochId optional
  isMock
```

`fixElapsedRealtimeNanos` 是连续性主时钟。`eventElapsedRealtimeNanos` 只属于 evidence
事件写入时间，不进入 `LocationSample` 连续性字段。

## TrackSummary

`TrackProcessResponse.result.summary` 是完整兼容响应的一部分，当前仍保留运动时间和配速字段，
用于既有 replay、debug 和历史 Web/Android 对齐。它不是本轮 watchOS 产品迁移的边界。

```text
TrackSummary:
  totalDistanceMeters
  movingTimeSeconds
  paceSecondsPerKm optional
  totalAscentMeters
  totalDescentMeters
  selectedElevationSource = BAROMETER | GNSS | NONE
```

本轮产品迁移只要求轨迹清洗、总里程、累计爬升和累计下降。产品 UI 和端侧跨平台对齐应读取
`TrackCoreProductSnapshot`，不要把 `movingTimeSeconds` / `paceSecondsPerKm` 作为本轮必须
实现或展示的产品指标。

## Product Snapshot

watchOS / iOS 可以把完整 `TrackProcessResponse.result` 投影成轻量
`TrackCoreProductSnapshot`，也可以通过 Rust FFI 的
`track_process_evidence_jsonl_product_snapshot(...)` 直接生成轻量 snapshot JSON，并落盘为
`rust-product-snapshot.json`。该文件只承载当前迁移范围：

```text
TrackCoreProductSnapshot:
  trackPoints[]
  totalDistanceMeters
  totalAscentMeters
  totalDescentMeters
  selectedElevationSource = BAROMETER | GNSS | NONE
```

`trackPoints[]` 使用轻量产品点结构，只表达清洗后的轨迹形状、来源样本、时间戳、精度、
分段和距离增量；它不包含 `movingTimeDeltaSeconds`。完整 `ProcessResponse.result.trackPoints[]`
可继续保留兼容字段，但 watchOS / iOS 产品对齐文件不得依赖它们。

机器契约是 `track-rs/schemas/product-snapshot.schema.json`。它不是 engine 输入，只用于
Watch live、iPhone final、Web acceptance 和 Rust replay 的轻量对齐。
示例文件是 `track-rs/examples/product-snapshot.example.json`。

## Debug Result

`process_debug` 输出普通结果之外，还必须保留可复测解释：

```text
TrackProcessDebugResponse:
  ok
  result:
    cleanedTrack
    rawPointDecisions[]
    cleaningOperations[]
    metricOwnershipRanges[]
    replayDiagnostics
```

`RawPointDecision`：

```text
sampleId
result = accept | weak | reject | intake_rejected
reason
trackPointId optional
metricOwner
affectedMetricGates[]
```

`CleaningOperation`：

```text
operationId
kind
inputSampleRange
distancePolicy
movingTimePolicy
elevationPolicy
```

`MetricOwnershipRange`：

```text
ownerId
sampleRange
affectedMetricGates[]
hardBoundary
```

被拒绝点、弱信号点、mock 点和 intake rejected 点仍然必须出现在 debug/replay 输出中。
`diagnostic_context` 可以重叠，但必须 `metricOwner=false` 且
`affectedMetricGates=[]`。
当某个 target 还没有实现局部 settlement 时，仍必须输出 `cleaningOperations[]`、
`metricOwnershipRanges[]` 和 `replayDiagnostics`。如果基础内核已经声明 metric owner，
`metricOwnershipRanges[]` 至少要表达这些基础 ownership；`replayDiagnostics` 需要说明
当前 settlement 覆盖范围，避免把缺省字段误读成“无需复核”。
旧 `cleaningOperations[].inputRawRange` 与 `metricOwnershipRanges[].rawRange` 只作为
反序列化 alias 保留；稳定输出必须使用 `inputSampleRange` / `sampleRange`。

## Streaming Settlement State

实时记录不要求完整 session 结束后离线重跑才能得到产品指标。平台中立 SDK 需要把已经
安全封段的前缀持久化为 streaming settlement state：

```text
StreamingSettlementState:
  schemaVersion = track-sdk-streaming-settlement-state-v1
  committedCursorSampleId
  commitSequence
  committedRanges[]
  committedMetricOwnershipRanges[]
  hardBoundaryCheckpoints[]
  blockingRanges[]
  lastCommitPlanStatus = none | committable | blocked_at_watermark
  lastCommitWatermark
```

`track-rs/schemas/streaming-settlement-state.schema.json` 是该状态的机器契约。公共状态必须
使用 `sampleId` / `sampleRange` 命名；Web 原型内部的 `rawPointId` / `range` 不允许泄露
为跨端契约。`blockingRanges[]` 必须携带 `affectedMetricGates[]`，用于说明情景窗口或
未解决冲突阻塞了哪些指标门。缺省或空 gates 的 metric owner 在仲裁中应保守视为全指标，
但导出的阻塞诊断必须显式写出实际使用的 gates。

## Review Queue AI Package

`review-queue-ai-package-v1` 是发给 AI 或端侧实现方的包 manifest，不是 SDK engine 输入。
它引用 `review-queue-v1` / `review-queue-batch-v1` JSON、Markdown 对齐报告、固定 AI 提示词
和 manifest 自身：

```text
ReviewQueueAiPackageManifest:
  schemaVersion = review-queue-ai-package-v1
  safeToSend
  issueCount
  files.reviewQueueJson
  files.reviewQueueReport
  files.aiPrompt
  files.packageManifest
  contracts[]
```

`safeToSend` 必须等价于 `issueCount == 0`。`files` 中的值只能是包目录内的文件名，不能包含
路径分隔符。Web 的 `validate-review-queue-package` 命令会校验 manifest、四个包文件和
必需契约引用。

AI 或端侧实现方返回的机器可读审查结果使用 `review-queue-ai-alignment-result-v1`。它必须
引用 `reviewKey` 和 `rawRange`，并把差异按 `P0/P1/P2` 分级；该结果仍然只是复核输出，
不能作为 SDK engine 输入。

## Replay Fixture

稳定 replay fixture 使用：

```text
TrackReplayFixture:
  schemaVersion = track-sdk-replay-fixture-v1
  ruleId
  ruleVersion
  source = web_algorithm | rust_infrastructure | android_replay | real_session_slice
  request: TrackProcessRequest
  expected:
    trackPointCount
    gpxTrackPointCount
    segmentCount
    totalDistanceMeters
    movingTimeSeconds
    totalAscentMeters
    totalDescentMeters
    acceptedSampleIds[] optional
    weakSampleIds[] optional
    rejectedSampleIds[] optional
    decisionReasons{sampleId: reason} optional
```

`decisionReasons` 的 JSON object key 必须是 `sampleId` 的十进制字符串形式，因为 JSON
object property name 只能是 string。它不能使用 `rawPointId`、`trackPointId` 或数组下标。

`verify_fixtures` 输出：

```text
TrackReplayReport:
  schemaVersion = track-sdk-replay-report-v1
  strategyVersion
  fixtureCount
  passedCount
  failedCount
  failures[]
```

每条 failure 必须能定位到 `ruleId`、`sampleRange` 或 `sampleId`，避免只报最终里程差。
fixture 读取、解析或元数据错误可以先用 `fixturePath` 定位到文件；算法差异类 failure
仍必须落到 `ruleId`、`sampleRange` 或 `sampleId`。Rust POC 当前对 summary / count 类差异
输出 session `sampleRange`，对单点 decision reason 差异输出 `sampleId`。`rawRange`
暂时作为 legacy mirror 保留给既有 review/report 工具，不能单独作为新 target 的
range-level failure locator。

## Legacy 过渡别名

当前 `track-rs` POC 已能跑最小批处理和 fixture，但字段命名仍有历史痕迹。它们是
temporary 过渡别名，不是长期 API：

| Legacy alias | 稳定 v1 字段 |
| --- | --- |
| `locationSamples[].rawPointId` | `locationSamples[].sampleId`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `locationSamples[].positioningSource` | `locationSamples[].provider`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `locationSamples[].latitude` | `locationSamples[].lat`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `locationSamples[].longitude` | `locationSamples[].lng`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `locationSamples[].elapsedRealtimeNanos` | `locationSamples[].fixElapsedRealtimeNanos`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `trackPoints[].sourceRawPointId` | `trackPoints[].sourceSampleId`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `trackPoints[].latitude` | `trackPoints[].lat`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `trackPoints[].longitude` | `trackPoints[].lng`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `trackPoints[].elapsedRealtimeNanos` | `trackPoints[].fixElapsedRealtimeNanos`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `rawPointDecisions[].rawPointId` | `rawPointDecisions[].sampleId`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `summary.ascentMeters` | `summary.totalAscentMeters`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `cleaningOperations[].inputRawRange` | `cleaningOperations[].inputSampleRange`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `metricOwnershipRanges[].rawRange` | `metricOwnershipRanges[].sampleRange`，Rust 输出已收敛，仅保留为反序列化 alias。 |
| `failures[].rawRange` | `failures[].sampleRange`，过渡期可作为 legacy mirror，SDK v1 freeze 前收敛。 |
| `expected.acceptedRawPointIds` | `expected.acceptedSampleIds`，fixture 读取侧保留 temporary alias。 |
| `expected.weakRawPointIds` | `expected.weakSampleIds`，fixture 读取侧保留 temporary alias。 |
| `expected.rejectedRawPointIds` | `expected.rejectedSampleIds`，fixture 读取侧保留 temporary alias。 |

这些别名可以继续支撑 POC fixture，但在 SDK v1 freeze 前必须收敛到本契约。

## 不变量

- SDK 输入只能来自 platform-neutral evidence；不能消费 review queue、UI 状态或平台私有字段。
- GAP、速度、segment、运动时间、elevation 连续性和情景窗口排序必须使用
  `fixElapsedRealtimeNanos`。
- `receivedElapsedRealtimeNanos` / `callbackDelayNanos` 只用于诊断，不能成为硬判点门槛。
- 本轮 watchOS 产品迁移只对齐 `TrackCoreProductSnapshot`：清洗轨迹、总里程、累计爬升、
  累计下降和高度来源解释。
- `TrackCoreProductSnapshot.trackPoints[]` 不能包含 `movingTimeDeltaSeconds`、
  `paceSecondsPerKm` 或其他非本轮产品指标。
- replay fixture 必须包含 `totalDescentMeters`。
- 被拒绝、弱信号、mock、intake rejected 样本必须保留在 debug/replay 输出。
- metric-owning `sampleRange` 对同一 metric gate 不能重叠；diagnostic context 可以重叠但不能拥有指标。
- 同一 fixture request 和 strategy version 在所有 SDK target 上必须产生确定性 replay report。
