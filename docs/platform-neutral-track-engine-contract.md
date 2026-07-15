# Platform-Neutral Track Engine Contract

本文定义平台中立轨迹函数的输入输出契约。它是六层因果模型的工程接口版本，
不改变当前 Android v3 实现、阈值、replay 期望或诊断 schema。

平台中立落盘证据格式见
`docs/platform-neutral-evidence-jsonl-contract.md`。本文描述 engine 的内存输入输出；
落盘 JSONL 应先按 evidence contract 统一，再进入本文的函数契约。

目标函数：

```text
OutdoorTrackEvidenceEngine.process(input) -> OutdoorTrackResult
```

## 设计边界

输入必须是标准化证据，而不是 Android、iOS 或鸿蒙的原生对象。

目标算法不接收：

```text
gnss_snapshot
satellite count
C/N0
constellation
used-in-fix
```

平台可以在自己的诊断报告中保留卫星质量信息，但目标产品算法不依赖这些字段。

## 输入

```text
OutdoorTrackInput:
  sessionContext
  samplingEpochs[]
  locationSamples[]
  motionWindows[]
  barometerWindows[]
  barometerCalibrations[] optional
```

### SessionContext

```text
SessionContext:
  sessionId
  strategyVersion
  createdElapsedRealtimeNanos
  createdWallTimeMillis
  deviceModel optional
  completionState optional
```

### SamplingEpoch

```text
SamplingEpoch:
  epochId
  state
  startedElapsedRealtimeNanos
  requestedMinTimeMs
  requestedMinDistanceMeters
```

`SamplingEpoch` 用于解释采样请求归因和连续性。它不能替代 fix 测量时间。

### NormalizedLocationSample

```text
NormalizedLocationSample:
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
  isMock
  samplingEpochId
  receivedElapsedRealtimeNanos optional
  callbackDelayNanos optional
```

字段归属：

```text
sampleId                                        -> session 内稳定样本 ID
lat / lng / horizontalAccuracyMeters            -> 水平轨迹线
altitudeMeters / verticalAccuracyMeters         -> GNSS altitude line
fixElapsedRealtimeNanos                         -> 轨迹和 Location 海拔连续性时间
receivedElapsedRealtimeNanos                    -> 诊断展示，不是判点硬门槛
callbackDelayNanos                              -> 诊断展示，不是判点硬门槛
```

### NormalizedMotionWindow

```text
NormalizedMotionWindow:
  windowId
  startElapsedRealtimeNanos
  endElapsedRealtimeNanos
  linearAccelerationRmsMps2 optional
  accelerometerDynamicRmsMps2 optional
  gyroscopeRmsRadps optional
  yawDeltaDegrees optional
  pitchDeltaDegrees optional
  rollDeltaDegrees optional
  stepDetectorCount optional
  stepCounterDelta optional
```

运动窗口只提供活动语义和门控证据，不生成经纬度。

### NormalizedBarometerWindow

```text
NormalizedBarometerWindow:
  windowId
  startElapsedRealtimeNanos
  endElapsedRealtimeNanos
  sampleCount
  minPressureHpa
  maxPressureHpa
  avgPressureHpa
  deltaPressureHpa
  minRawBarometerAltitudeMeters
  maxRawBarometerAltitudeMeters
  avgRawBarometerAltitudeMeters
  deltaRawBarometerAltitudeMeters
  windowAscentMeters
  windowDescentMeters
  lastSensorAccuracy optional
```

pressure altitude 是独立的 BAROMETER altitude line，按传感器时间运行，不绑定到单个 TrackPoint。
`windowAscentMeters` / `windowDescentMeters` 存在时优先作为窗口内累计 gain/loss；
legacy 数据缺失时，engine 可退回窗口间平均高度差估算，并降低解释信心。

### BarometerCalibration

```text
BarometerCalibration:
  calibrationId
  source
  rawBarometerAltitudeMeters
  referenceAltitudeMeters
  calibrationOffsetMeters
  pressureSampleElapsedRealtimeNanos
```

校准只影响绝对高度展示，不重写气压计累计爬升历史。

## 输出

```text
OutdoorTrackResult:
  trackPoints[]
  rawPointDecisions[]
  barometerWindowDecisions[]
  gnssAltitudeResult
  barometerAscentResult
  selectedAscentResult
  scenarios[]
  scenarioCoverage[]
  streamingDiagnosticContexts
  sessionSummary
```

### TrackPoint

```text
TrackPoint:
  trackPointId
  sourceSampleId
  lat
  lng
  fixElapsedRealtimeNanos
  wallTimeMillis
  horizontalAccuracyMeters
  altitudeMeters optional
  verticalAccuracyMeters optional
  decisionResult
  decisionReason
  segmentId
  distanceDeltaMeters
  movingTimeDeltaSeconds
  startsNewSegment
  routeLineVertex optional
  routeLineStrategy optional
  primaryExplanation
  scenarioContexts[]
  primitiveFacts[]
```

可信 GPX 只能来自可信 TrackPoint。weak/reject 不进入 trusted GPX。
`routeLineVertex=false` 表示该 TrackPoint 是解释锚点而非真实路线折线顶点；
路线渲染和路线导出应按 `routeLineStrategy=bridge_previous_next` 直接连接前后有效路线点。
点级解释、raw 贡献归属和 scenario coverage 仍保留在该 TrackPoint 上。

### RawPointDecision

```text
RawPointDecision:
  sampleId
  intakeResult
  intakeReason optional
  samplingResult
  horizontalResult
  horizontalReason
  activityState
  boundaryState
  segmentId optional
  distanceDeltaMeters
  movingTimeDeltaSeconds
  gnssAltitudeResult
  gnssAltitudeReason optional
  entersTrustedGpx
  countsDistance
  countsMovingTime
  primaryExplanation
  scenarioContexts[]
  primitiveFacts[]
```

### BarometerWindowDecision

```text
BarometerWindowDecision:
  windowId
  result
  reason
  ascentDeltaMeters
  activityGate
  boundaryGate
  confidence
```

推荐 result：

```text
accumulating
suspended
reset
rejected
unavailable
```

### Altitude Results

```text
GnssAltitudeResult:
  totalAscentMeters
  totalDescentMeters
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

BarometerAscentResult:
  totalAscentMeters
  totalDescentMeters
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

SelectedAscentResult:
  source = BAROMETER / GNSS / NONE
  totalAscentMeters optional
  totalDescentMeters optional
  confidence
  reason
```

两条原始高度结果必须保留。`SelectedAscentResult` 只是产品主展示选择。产品可以
只显示累计爬升，但 engine result 必须保留累计下降。

### Scenario

`Scenario` 是基础判点后的可解释局部重建记录。它不能替代 `RawPointDecision`，
也不能绕过 settlement 门控。

```text
Scenario:
  scenarioId
  scenario
  confidence
  rawRange
  anchorRawPointIds[]
  action
  localRebuild
  evidence
```

当前稳定场景集合由 `docs/outdoor-track-scenario-recognizers.md` 定义。新增稳定场景时，
必须同步更新 Web 测试、文档和 replay fixture 规划。

### Explanation Model

平台中立输出应把“主解释”和“基础事实”拆开：

```text
primaryExplanation:
  source = scenario / primitive
  scenario optional
  scenarioLabel optional
  action optional
  actionLabel optional
  localRebuild optional
  localRebuildLabel optional
  result optional
  reason optional
  summary

scenarioContexts[]:
  scenarioId
  scenario
  scenarioLabel
  confidence
  action
  actionLabel
  localRebuild
  localRebuildLabel
  rawRange
  summary

primitiveFacts[]:
  sample_valid / sample_invalid
  horizontal_trusted / horizontal_weak / horizontal_rejected
  activity_*
  boundary_*
  trusted_gpx_included / trusted_gpx_excluded
  distance_counted / distance_suspended
  moving_time_counted / moving_time_suspended
  gnss_altitude_*
```

`decisionReason` 仍保留为机器可复测的低层 reason；面向人工复盘时优先展示
`primaryExplanation`，需要解释复合场景时再展开 `scenarioContexts[]`。

### ScenarioCoverage

`scenarioCoverage[]` 是 `scenarios[]` 的区间索引，不参与判点、计距、计时或 GPX
导出。

```text
ScenarioCoverage:
  scenarioId
  scenario
  scenarioLabel
  rawRange
  continuousCoverage
  trackPointRange
  trackPointIds
  action
  actionLabel
  localRebuild
  localRebuildLabel
  contextTrackPointCount
  primaryTrackPointCount
  rawDecisionContextCount
  rawDecisionPrimaryCount
```

它用于真实样本校准：人工指出“清洗点 #A-#B 应该触发某些情景”时，先用
`scenarioCoverage[]` 对齐清洗点区间，再决定是否需要新增 fixture 或调整识别器。
连续情景使用 `trackPointRange`；离散边界情景使用 `trackPointIds`，避免把边界点之间的
整段轨迹误解释为连续场景。
平台中立实现可以提供 `reviewTrackPointScenarioCoverage(startTrackPointId, endTrackPointId)`
这类只读查询函数，供复盘 UI 或自动验收脚本复用。

### StreamingDiagnosticContextReport

`streamingDiagnosticContexts` 是 settlement `contextProposals[]` 中
`metricOwner=false` proposal 的最终复盘汇总。它只用于 review/report 和跨端对齐，
不参与判点、计距、计时、爬升/下降或 GPX 导出。

```text
StreamingDiagnosticContextReport:
  totalCount
  scenarioCounts[]
  contexts[]
  findings[]

StreamingDiagnosticContext:
  id
  scenario
  rawRange
  metricOwner = false
  affectedMetricGates = []
  coordinatorState optional
  action
  localRebuild
  confidence optional
  compatibilityTags[]
  anchorRawPointIds[]
  evidence
```

`contexts[]` 必须保留 `dense_area_intent`、`closed_loop_round_trip`、
`enclosed_gap_cluster`、`composite_gap_local_settlement` 等 diagnostic-only context 的
关键 evidence，例如 intent、GAP/stationary counts、turn/endpoint raw id、重叠 dense
intent 和 guard rejection reason。metric-owning proposal 不能进入该 report。

### ReviewQueueExport

`review-queue-v1` 是 Web 审核 UI 给人工或 AI 复盘使用的导出包，不是 engine 输入，也不能
反向影响判点或指标。它可以按当前 UI 筛选导出 `all / metric / diagnostic / highRisk /
pending` 任务，但必须保留全量 `streamingDiagnosticContexts` 汇总，方便验证 diagnostic
context 与 metric owner 是否在重叠窗口中保持分离；同时携带平台中立
`streamingSettlementState`，方便 AI / 端侧实现方核对安全封段水位和阻塞窗口。

```text
ReviewQueueExport:
  schemaVersion = review-queue-v1
  dataset
    id
    fileName
    filePath
  filter
  stats
    total
    pending
    done
    highRisk
    metricOwner
    diagnosticContext
  taskCount
  tasks[]
    order
    reviewKey
    type = scenario | conflict | diagnostic_context
    status
    highRisk
    scenario
    title
    rawRange
    trackRange optional
    metricOwner optional
    affectedMetricGates optional
    action optional
    localRebuild optional
    anchorRawPointIds[]
    evidence optional
  streamingSettlementState
  streamingDiagnosticContexts
  exportedAt
```

`type=diagnostic_context` 的任务必须满足 `metricOwner=false`，且 `affectedMetricGates=[]`。
它只能用于审核和跨端对齐，不能在任何端转换成 route、distance、moving_time 或 elevation
ownership。

Web 侧提供 headless 导出入口，用于把真实 session 或 replay fixture 直接转成可发送给 AI
的对齐包：

```bash
cd acceptance-web
npm run export-review-queue -- ../path/to/evidence.jsonl --filter diagnostic --out /tmp/review-queue.json
```

该命令和 UI 导出共享同一套 `ReviewQueueExport` 结构；差异只在于 UI 可以附带人工标记的
status，而 headless 导出的任务默认 `status=pending`，除非调用方显式传入状态覆盖。
当输入是目录时，命令会递归读取目录下所有 `.jsonl`，输出批量包：

```text
ReviewQueueBatchExport:
  schemaVersion = review-queue-batch-v1
  sourcePath
  filter
  exportedAt
  fileCount
  successCount
  errorCount
  exports[] = ReviewQueueExport
  errors[]
    filePath
    message
```

批量包用于 replay fixtures 或真实 session 集合的审核沉淀；单个 `exports[]` 仍必须满足
`review-queue-v1` 的全部约束。

机器契约：

```text
track-rs/schemas/review-queue.schema.json
track-rs/schemas/review-queue-batch.schema.json
```

`npm run report-review-queue` 会对 `streamingSettlementState` 做 P0 级结构校验：
缺失状态、泄露内部 `rawPointId` / `range` 字段、缺少 `sampleRange`、或
`blockingRanges[]` 未显式声明 `affectedMetricGates[]`，都必须先修正再交给 AI 或目标端。
发包或 CI 可使用 `npm run report-review-queue -- <review-queue.json> --fail-on-issues`
把任何 report issue 变成非零退出码。

### SessionSummary

```text
SessionSummary:
  rawPointCount
  trackPointCount
  weakPointCount
  rejectedPointCount
  segmentCount
  gapCount
  totalDistanceMeters
  movingTimeSeconds
  paceSecondsPerKm optional
  suspectedTransportPointCount optional
  suspectedTransportSegmentCount optional
  suspectedTransportDistanceMeters optional
  suspectedTransportDurationSeconds optional
  suspectedTransportAverageSpeedMetersPerSecond optional
  selectedTotalAscentMeters optional
  selectedTotalDescentMeters optional
  selectedAscentSource
```

`suspectedTransport*` 只表示高速交通污染诊断。当前证据不能可靠区分私家车、公交、
火车或其他交通方式；这些字段不能并入徒步 `totalDistanceMeters`、
`movingTimeSeconds`、`paceSecondsPerKm` 或 elevation 真值。

## 处理顺序

逻辑顺序：

```text
1. 写入 raw evidence
2. Intake 硬合法性校验
3. Sampling 归因与连续性检查
4. 水平点云和边界状态判断
5. 活动语义门控
6. GNSS altitude line 解算
7. BAROMETER altitude line 解算
8. Settlement 统一结算产品输出
```

实现可以并行维护多个 engine，但产品输出必须由 settlement 统一生成。

## Streaming Engine Contract

实时记录不应依赖“先出弱预览、结束后离线重跑出真结果”。平台中立 engine 应把
streaming 作为主执行路径；replay 只是把同一 evidence 顺序重新喂给同一套 streaming
engine。

```text
OutdoorTrackStreamingEngine.advance(previousState, evidenceBatch) -> OutdoorTrackStreamingState
OutdoorTrackStreamingEngine.finish(previousState) -> OutdoorTrackResult
```

`evidenceBatch` 可以只包含当前批次新增的 location、motion、barometer 和 session event。
engine 必须在内部维护 bounded state，而不是要求调用方保留完整 session。

### Evidence Stream Intake

平台中立 JSONL 可以按任意网络/文件 chunk 输入。intake 层只负责把 JSONL 分片还原为
event batch，并做轻量顺序诊断；它不能做判点、计距、情景识别或 settlement。

```text
StreamingEvidenceIntakeState:
  events[]
  parseErrors[]
  pendingText
  lastEventSeqBySession
  seenEventKeys
  duplicateEventCount
  outOfOrderEventCount
  finished
```

规则：

1. 只有完整 JSONL 行才解析；未闭合的尾行保存在 `pendingText`。
2. `finish()` 必须解析最后一行，即使文件没有 trailing newline。
3. 同一 `sessionId + eventSeq` 只能进入一次；重复事件计入 `duplicateEventCount`。
4. `eventSeq` 倒退计入 `outOfOrderEventCount`，供采集端诊断。
5. legacy evidence 缺少 `eventSeq` 时不得伪造顺序诊断，只按文件顺序进入后续 adapter。

当前 Web 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingEvidenceIntake.mjs
```

### Streaming State

```text
OutdoorTrackStreamingState:
  evidenceIntake
  baseState
  metricAccumulator
  scenarioRecognizer
  scenarioSettlementSession
  localRebuild
  recentEvidenceBuffer
  openScenarioWindows[]
  outputCursor
```

`scenarioSettlementSession` 使用实时情景窗口结算协议：

```text
StreamingScenarioSettlementSession:
  settlementState
  pendingProposals[]
  openWindows[]
  lastSettlementPlan
  lastInputSummary

StreamingSettlementState:
  committedCursorRawPointId
  commitSequence
  committedRanges[]
  committedMetricOwnershipRanges[]
  hardBoundaryCheckpoints[]
  blockingRanges[]
  lastCommitPlanStatus
  lastCommitWatermark
```

可持久化的最小字段是：

```text
committedCursorRawPointId
commitSequence
committedMetricOwnershipRanges[]
hardBoundaryCheckpoints[]
blockingRanges[]
pendingProposals[]
openWindows[]
recentEvidenceBuffer bounded by max window cap
metricAccumulator
scenarioRecognizer
localRebuild
```

`lastSettlementPlan` 和 `lastInputSummary` 是诊断字段，可以落盘用于复盘，但不应作为
恢复运行所需的唯一真相。

### Streaming Scenario Recognizer

实时情景识别层只生成 proposal，不直接改写 track、distance、moving time 或 elevation。
当前 Web v0 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingScenarioRecognizer.mjs
```

```text
StreamingScenarioRecognizerState:
  enabled
  emittedProposalIds[]
  openWindows[]
  lastInputTrackPointId
  lastProposalCount
```

v0 覆盖：

- `gap_recovery_boundary` proposal：来自 base kernel 的 `gap_recovery` 可信恢复点，
  作为零 distance / 零 moving time / elevation reset 的硬边界。
- `transport_contamination` proposal：主要来自 base kernel 保留的
  `recovery_transport_suspected_kept` / `transport_suspected_kept` kept 诊断点；
  同时兼容历史 `transport_risk` rejected 点和 `transport_recovery_pending` weak 点；
  实时流式原型按单 raw point 生成稳定边界，避免后续连续污染点扩容导致已提交前缀改写。
  proposal evidence 必须区分 `rejectedRawPointIds`、`pendingRawPointIds` 和
  `keptRawPointIds`。
- `pressure_jump` proposal：来自 metric accumulator 的 `pressure_jump_detected`
  barometer window，并映射到最近的 raw timeline 边界点；只影响 elevation gate。
- `moving_spike_cleanup` 的低速单点尖刺 proposal。
- `position_snap_recovery` proposal：依赖前序
  `implied_speed_unconfirmed_by_reported_speed` 弱点和后续低速可信恢复点。
- `weak_recovery_endpoint` proposal：来自 GAP 后连续
  `gap_recovery_pending` 弱点云；满足样本数、点云半径、最佳精度和离前可信点距离后，
  作为 `hardBoundary=true` 的零 distance / 零 moving time / elevation reset 形状锚点，
  保留洞内或遮挡端点，不允许后续大窗口跨它累计指标。
- `stationary_drift_collapse` proposal：来自 base kernel 的连续
  `stationary_cloud_jitter` rejected 云；当前 raw 仍在云内时只输出 open window，退出云或
  finish 后才关闭。
- `rest_photo_micro_move` proposal：来自可信 track 上的小 bbox、低速、高 path/net
  折返窗口；实时默认等窗口达到 `restPhotoMicroMoveMaxTrackPoints` 或 finish 后关闭，
  未闭合时只输出 open window。
- `enclosed_loop_cluster_settlement` proposal：来自闭合回环中被 GAP recovery /
  stationary anchor 包围的小 bbox 聚集窗口；窗口未退出且未 finish 时只输出 open
  window。关闭后生成 `enclosed_loop_anchor_settlement`，把内部低速碎点并入少量锚点，
  route / distance / moving time 全部按零增量结算。
- `dense_main_route_settlement` proposal：来自连续可信移动 TrackPoint；窗口未退出且
  未 finish 时只输出 open window，窗口关闭后用 RDP 距离简化生成
  `dense_main_route_skeleton` proposal。
- `round_trip_line` / `same_road_round_trip` proposal：来自可信 TrackPoint 的闭合来回
  几何；满足 start/end 接近、turn 距离足够、cross-track 有界时生成。same-road 几何更强时
  优先生成 `same_road_round_trip`，否则生成 `round_trip_line`。候选贴着最新点时只输出
  open window，退出或 finish 后才关闭 proposal。proposal evidence 会记录重叠
  `dense_area_intent`、`roundTripIntentSupported` 和 `sameRoadCollapseReason`；当 dense
  intent 支持 `round_trip` 时，same-road 审核 reason 为 `round_trip_intent_supported`。
- `composite_gap_local_settlement` diagnostic proposal：当 `round_trip_line` 几何候选因
  no-intent composite guard 被拒绝时，保留拒绝原因、duration、max sample gap、
  same-road evidence、`turnRawPointId`、`endpointRawPointId`、`anchorRawPointIds[]`
  和 dense intent 支持状态。该 proposal `metricOwner=false`，只作为 guard 审核上下文，
  不触发 route rewrite。
- `dense_area_intent` diagnostic proposal：来自可信 TrackPoint 的密集窗口，按
  path/net/bbox、GAP recovery、stationary anchor 和 moving ratio 分类为
  `forward_motion`、`stationary`、`round_trip`、`gap_cluster` 或 `mixed`。该 proposal
  `metricOwner=false`，只用于调度和复盘，不阻塞 commit。evidence 会记录
  `observedMetricScenarios[]` 和 `conflictReview[]`，用于后续 dense intent conflict
  复盘。
- `enclosed_gap_cluster` diagnostic proposal：来自可信 TrackPoint 上被 GAP recovery
  与 stationary anchor 围住的小 bbox 聚集窗口。它记录
  `gapRecoveryCount`、`stationaryAnchorCount`、`segmentIds[]`、`bboxDiagonalMeters`、
  `durationSeconds`、重叠 `dense_area_intent`、`gapClusterIntentSupported`、
  `mixedIntentSupported` 和 `anchorRawPointIds[]`。该 proposal
  `metricOwner=false`、`affectedMetricGates=[]`，只能解释遮挡 / 停留 / GAP 聚集上下文，
  不能改写 route、distance、moving time 或 elevation。
- `closed_loop_round_trip` diagnostic proposal：来自可信 TrackPoint 的闭合回环窗口，
  在不与 `same_road_round_trip` / `round_trip_line` metric proposal 重叠时标注
  `round_trip_diagnostic`。该 proposal `metricOwner=false`，只记录 loop 语义和重叠的
  dense-area intent，不改写 route、distance、moving time 或 elevation。
- 最近点 pending open window，用于让 settlement cursor 在下一点到来前保留小窗口。
- proposal 去重，避免同一小窗口重复进入 settlement。

v0 只输出 proposal：`moving_spike_cleanup` 使用
`affectedMetricGates=['route','distance','moving_time']`；`pressure_jump` 使用
`affectedMetricGates=['elevation']`；`gap_recovery_boundary`、
`transport_contamination`、`position_snap_recovery` 和 `weak_recovery_endpoint` 使用
`hardBoundary=true` 和
`affectedMetricGates=['route','distance','moving_time','elevation']`；
`stationary_drift_collapse`、`rest_photo_micro_move`、
`enclosed_loop_cluster_settlement`、
`dense_main_route_settlement`、`round_trip_line` 和 `same_road_round_trip` 使用
`affectedMetricGates=['route','distance','moving_time']`。`dense_area_intent` 和
`closed_loop_round_trip`、`enclosed_gap_cluster`、
`composite_gap_local_settlement` 使用 `metricOwner=false`、`affectedMetricGates=[]`，
进入 settlement 的 `contextProposals`，不能产生 metric ownership。recognizer 不直接删除或改写点；
产品重建必须由 settlement / local rebuild 层统一应用。

### Streaming Metric Accumulator

指标累计层只处理不需要长情景窗口的基础 metric evidence。当前 Web v0 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingMetricAccumulator.mjs
```

```text
StreamingMetricAccumulatorState:
  anchorBarometerAltitudeMeters
  anchorBarometerElapsedRealtimeNanos
  totalBarometerAscentMeters
  totalBarometerDescentMeters
  hasBarometerDescentEvidence
  lastBarometerWindowEndElapsedRealtimeNanos
  barometerWindowDecisions[]
  committedBarometerAscentMeters
  committedBarometerDescentMeters
  committedBarometerWindowIds[]
  lastAppliedBarometerWindowSlices[]
  barometerWindowDecisionsPrunedBeforeElapsedRealtimeNanos
  gnssAltitudeAnchorMeters
  committedGnssAltitudeAscentMeters
  committedGnssAltitudeDescentMeters
  committedGnssAltitudeSampleRawPointIds[]
  committedGnssAltitudeRejectedRawPointIds[]
  lastAppliedGnssAltitudePointDecisions[]
  stats
  barometerAscentResult
  gnssAltitudeResult
  selectedAscentResult
```

v0 覆盖：

- 平台中立 `barometer_window` 的流式累计。
- `windowAscentMeters` / `windowDescentMeters` 优先作为窗口内 gain/loss。
- legacy 窗口缺少 gain/loss 时，退回相邻 accepted barometer altitude delta。
- pressure gap / pressure jump / invalid pressure 的 reset 或 reject 诊断。
- 累计下降 `totalDescentMeters` 与累计爬升同等保留，并进入
  `selectedAscentResult.totalDescentMeters`。
- 倒序 barometer window 不回写既有累计，诊断为 `barometer_window_out_of_order`。
- 已提交 ownership 范围内的 GNSS altitude fallback：可信 TrackPoint 保留
  `altitudeMeters` / `verticalAccuracyMeters`，metric settlement 按同一套
  `locationAltitudeAscent*` 阈值累计 GNSS ascent/descent。
- GNSS altitude 只在 barometer committed evidence 不足时进入
  `selectedAscentResult`；barometer 仍是主源。
- hard boundary 或 scenario ownership 若声明 `affectedMetricGates` 包含
  `elevation`，对应 GNSS 点只生成 `elevation_gate_closed` 诊断，并清空 GNSS
  altitude anchor，禁止跨边界累计高度差。

`streamingMetricSnapshot()` 会同时暴露 evidence 累计结果和 settlement 视图：

```text
MetricSettlementSnapshot:
  committedCursorRawPointId
  lastCommitPlanStatus
  lastCommitWatermark
  committedMetricOwnershipRanges[]
  committedBarometerAscentResult
  committedGnssAltitudeResult
  committedSelectedAscentResult
  committedBarometerWindowSlices[]
  committedGnssAltitudePointDecisions[]
  blockingRanges[]
  hardBoundaryCheckpoints[]
```

可持久化的实时封段状态以
`track-rs/schemas/streaming-settlement-state.schema.json` 为机器契约；公共字段使用
`sampleId` / `sampleRange` 命名，Web 原型内部的 raw point 命名只是实现细节。

`blockingRanges[]` 必须保留 `affectedMetricGates[]`。open window blocker 使用窗口声明的
gates，缺省按全指标处理；unresolved overlap conflict blocker 使用实际相交的 gates。
该字段只用于封段诊断、review queue 和跨端对齐，不允许被目标端拿来绕过
`commitWatermark`。

`committedMetricOwnershipRanges[]` 来自 scenario settlement 的安全前缀，只记录已经
可提交的 raw range。相邻且 owner 完全一致的 range 会合并，避免长记录中无限增长
碎片。open window 或 unresolved conflict 后的 metric 只能作为 evidence 累计值存在，
不能宣称为最终产品指标。

barometer window 会按 `committedMetricOwnershipRanges[]` 映射出的 raw 时间范围切片：
每个 committed raw range 使用 `rawPointTimeline` 的 fix elapsed time 作为边界，
窗口内 `ascentDeltaMeters` / `descentDeltaMeters` 按时间重叠比例分配。hard boundary
若声明 `affectedMetricGates` 包含 `elevation`，对应切片只保留诊断，不计入 committed
barometer product metric。

committed barometer metric 是增量状态：每次只消费 settlement state 的
`lastAppliedMetricOwnershipRanges[]`，把新提交切片累加到 committed totals。随后
engine 可以裁剪已经安全提交之前的 `rawPointTimeline` 和 `barometerWindowDecisions[]`；
裁剪后仍保留 committed totals、sample ids 和最近一次 applied slices 作为产品值和诊断。

committed GNSS altitude 也是增量状态：每次只消费
`lastAppliedMetricOwnershipRanges[]` 中已经安全提交的 base TrackPoint，保留
`committedGnssAltitude*` totals、sample raw ids、rejected raw ids 和最近一次
`lastAppliedGnssAltitudePointDecisions[]`。因此 engine 不需要为累计爬升/下降保留完整
历史 evidence；只需保留尚未 settlement 的情景窗口期和少量高度 anchor。

### Streaming Diagnostic Context Report

实时 engine 的 `lastAdvanceSummary` 应暴露同一份
`StreamingDiagnosticContextReport`，来源于当前 settlement session 的
`lastSettlementPlan.contextProposals[]`。这让低性能设备可以边录边产出有界复盘摘要，
而不是等完整 session 结束后从全量 evidence 扫描 diagnostic context。

当前 Web v0 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingDiagnosticContextReport.mjs
```

输出约束：

- 只汇总 `metricOwner=false` context。
- `affectedMetricGates` 必须为空数组，或在 report 中保留为空数组语义。
- 按 raw range 和 scenario 稳定排序。
- report 可以保留 compact evidence，但不能成为后续算法的唯一真相；算法真相仍是
  Raw evidence、base decision、scenario proposal 和 settlement ownership。

### Streaming Local Rebuild

local rebuild 层消费 settlement 刚提交的
`lastAppliedMetricOwnershipRanges[]`，生成只追加的 committed product track view。当前 Web
v0 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingLocalRebuild.mjs
```

```text
StreamingLocalRebuildState:
  committedTrack[]
  emittedRawPointIds[]
  trackPointId
  lastAppliedProductTrackPoints[]
  lastAppliedOwnershipRangeCount
  unsupportedScenarioCount
  stats
```

规则：

1. 只消费本批 newly applied ownership range；空推进不能重复追加产品点。
2. `base_kernel` ownership 直接追加对应可信 base TrackPoint。
3. `stationary_drift_collapse` 生成 `stationary_drift_anchor`，贡献 raw 为整个漂移云，
   distance / moving time 为 0。
4. `rest_photo_micro_move` 当前支持 `rest_photo_micro_move_anchor` 和
   `rest_photo_micro_move_simplifier` 产品视图；强折返窗口压成不计距休息锚点。
5. `moving_spike_cleanup` 生成 `moving_spike_line_bridge` 产品视图：尖刺 raw 进入
   `suppressedRawPointIds`，后一个可信点按前后桥接距离和运动时间重算。
6. `position_snap_recovery` 生成 `position_snap_recovery_anchor` 产品视图：恢复点吸收
   前序弱点 raw，distance / moving time 为 0。
7. `enclosed_loop_cluster_settlement` 生成 `enclosed_loop_anchor_settlement` 产品视图：
   只保留 proposal 指定的少量锚点，内部 raw 全部进入贡献集合；输出点 distance /
   moving time / ascent window 均为 0，用于压缩遮挡回环聚集中的虚假折返距离。
8. `dense_main_route_settlement` 生成 `dense_main_route_skeleton` 产品视图：
   kept raw point 保留为 `dense_main_route_start` / `dense_main_route_shape` /
   `dense_main_route_end`，中间 raw 进入贡献集合，距离按相邻骨架点重算，运动时间按
   被压缩组累加。
9. `round_trip_line` 生成 `round_trip_polyline` 产品视图：根据 proposal 的
   `startRawPointId` / `turnRawPointId` / `endRawPointId` 和
   `simplifyToleranceMeters` 分别简化去程与返程折线，保留折返点，距离和运动时间按
   被压缩组累计。
10. `same_road_round_trip` 生成 `same_road_centerline` 产品视图：沿去程和返程按路径比例
   采样中心线，非折返点使用 `same_road_corridor_center` 虚拟坐标，折返点保留原始或弱恢复
   endpoint 坐标。
11. `transport_contamination` 使用 `transport_route_passthrough` 原样产出
   `recovery_transport_suspected_kept` / `transport_suspected_kept` TrackPoint；
   它们进入 product track 和可信 GPX 形状，但不进入 hiking distance、moving time
   或 elevation。`gap_recovery_boundary` 和 `pressure_jump` 作为已知边界 passthrough，
   不计入 unsupported。
12. 尚未实现 local rebuild 的 scenario 走 base passthrough fallback，并增加
   `unsupportedScenarioCount`，不能静默丢点。

local rebuild 不回写 `baseKernel.track`、`rawPointDecisions` 或原始 evidence；它只是
已提交前缀的产品视图。same-road / round-trip 自动 proposal 识别和 GNSS altitude
fallback 已接在 settlement / metric / local rebuild 层级，不回到采样入口或基础内核里。

### Streaming Track Engine v0

当前 Web 串联原型：

```text
acceptance-web/src/track-cleaning/streamingTrackEngine.mjs
```

职责：

1. 接收 JSONL chunk 或 event batch。
2. 用 `StreamingEvidenceIntakeState` 解析、去重和记录顺序诊断。
3. 只把本次新增 event 交给 `StreamingBaseTrackKernelState`，避免重复计距。
4. 只把本次新增 event 交给 `StreamingMetricAccumulatorState`，避免重复累计爬升/下降。
5. 用 base kernel 的 `lastProcessedRawPointId` 推进 `StreamingScenarioSettlementSession`。
6. 当存在 open metric-owning window 时，只提交安全前缀；窗口关闭后继续从 cursor 后提交。
7. 用 `StreamingLocalRebuildState` 消费本批新提交 ownership，追加 committed product
   track view。

v0 仍不包含完整六层 local rebuild。它已证明：

- platform-neutral evidence 可以分片进入同一状态。
- base kernel 可以分批推进且不重复处理 event。
- barometer ascent/descent 可以分批累计且不重复处理 event。
- scenario settlement cursor 可以跟随 base raw cursor 前进，并被 open window 稳定阻塞。
- committed product track 可以按 newly applied ownership 增量追加，且对
  `stationary_drift_collapse` / `rest_photo_micro_move` /
  `enclosed_loop_cluster_settlement` / `dense_main_route_settlement` /
  `round_trip_line` / `same_road_round_trip` 应用最小 local rebuild。
- same-road / round-trip 基础几何可以在 finish 或窗口退出时自动生成 route proposal；
  候选仍贴着最新点时只作为 open window 阻塞安全前缀。
- GAP 后疑似交通工具连续移动进入 trusted GPX 和 hiking product track 的路线形状，
  但不进入 distance、moving time 或 elevation。

### Streaming Base Kernel

基础安全内核可以先于情景窗口独立流式推进。它只处理不需要长情景窗口的硬约束：

```text
StreamingBaseTrackKernelState:
  sessionContext
  samplingEpochs[]
  motionWindows[] bounded by recent activity lookback
  rawPointTimeline[] for committed metric time slicing
  lastLegalElapsedRealtimeNanos
  legalFixKeys bounded/dedupe index
  previousTrustedTrackPoint
  inTransportMode
  lastTransportRawPoint optional
  lastGapRecoveryPendingRawPoint optional
  segmentId
  trackPointId
  decisionId
  track[]
  rawPointDecisions[]
  excluded.weak[]
  excluded.rejected[]
  excluded.intakeRejected[]
  stats
```

当前 Web v0 原型落地在：

```text
acceptance-web/src/track-cleaning/streamingBaseTrackKernel.mjs
```

v0 覆盖：

- intake 合法性：provider、mock、坐标、fix time、accuracy、重复 fix、倒序 fix、
  sampling epoch mismatch。
- 首点 anchor：`first_fix_good` / `first_fix_relaxed`。
- 普通移动点：`moving_good_fix`。
- 平台中立 `motion_window` / Android `device_motion_window` 最近窗口活动门控：
  低速小位移在 active motion 支撑下可输出 `motion_supported_low_speed`。
- 长 GAP fast-path 恢复：`gap_recovery`，零 distance / 零 moving time，并开启新 segment。
- GAP 后若先出现 `gap_recovery_pending`，随后出现连续疑似交通工具移动，base kernel
  为路线连续性保留 `recovery_transport_suspected_kept` 和
  `transport_suspected_kept` TrackPoint，这些点 `entersTrustedGpx=true`、
  `countsDistance=false`、`countsMovingTime=false`。
- 直接交通风险点输出 `accept / transport_suspected_kept`；上报速度达到交通阈值时，
  单步位移只需走出 accuracy 派生的 stationary threshold，不再强制达到 20m。
- 系统明确上报低于交通阈值的跳点仍输出
  `implied_speed_unconfirmed_by_reported_speed`，供 position snap 恢复处理。
- intake rejected / weak / reject raw point decision 的诊断保留。

v0 暂不覆盖完整六层 settlement、dense intent / closed-loop context 等复杂情景识别，也不替代
`buildSixLayerTrackProduct()`。验收方式是：在基础样本上，分批推进的 base kernel 与
完整 product 的 raw decisions、track point、distance、moving time 和 GAP 计数一致。
transport continuity 还必须验证 kept 点进入 trusted GPX 路线，但不进入徒步指标。

### Safe Commit Rule

实时封段只看三件事：

```text
1. 是否存在 metric-owning open window
2. 是否存在 unresolved metric-owner overlap conflict
3. 当前 raw id 是否已经超过 realtime lookahead
```

满足安全条件的前缀可以立即提交；不满足时，只提交 blocker 起点之前的范围。
一旦提交，后续情景窗口不能回写 `committedCursorRawPointId` 之前的指标。解释可以
追加 context，但同一 raw range / 同一 `affectedMetricGate` 的 metric ownership
不能重叠或重复；不同 gate 可以重叠，例如 route settlement 与 elevation boundary。
commit plan 必须输出 `metricOwnershipRanges[]`，把已经可提交的 raw range / metric gate
分配给唯一 owner：`base_kernel`、具体 scenario owner，或 hard boundary。父窗口被子窗口
或 hard boundary 切分时，受影响 gate 的 ownership range 必须同步切分；父窗口只保留
context 解释。

当一个父情景窗口完全包含一个或多个子窗口时，子窗口先拥有自己的 metric range；
父窗口不能整体降级为无指标 context，也不能覆盖子窗口。父窗口应被切成左右或多段
剩余 range，每段作为独立 active ownership 参与后续提交；原父 proposal 只保留为
context 解释。

GAP、pause、transport contamination、pressure jump 这类 hard boundary 同样按
blocker 处理，但语义更严格：父窗口不能跨硬边界合并指标；边界自身形成 checkpoint，
父窗口只允许在边界两侧剩余 range 上继续拥有指标。

### Finish Rule

`finish()` 不是换成另一套离线算法，而是执行：

```text
1. 关闭或 cap 所有 openScenarioWindows。
2. 为仍无法确定的窗口生成 conservative fallback proposal。
3. 用 SettlementCoordinator 消化 pending proposals。
4. 从 streaming state 中导出最终 OutdoorTrackResult。
```

如果某个窗口达到 cap，fallback 本身就是最终结果；replay 必须复现同一 fallback，
不能在 replay 中偷偷使用完整后视野修正实时结果。

## 核心不变量

```text
lat/lng 决定水平轨迹。
Location.altitude 决定 GNSS altitude line。
pressure altitude 决定 BAROMETER altitude line。
motion 只决定活动语义和门控。
SamplingEpoch 只解释采样归因。
Settlement 统一决定 GPX、距离、运动时间、配速和 selected ascent。
```

禁止行为：

```text
barometer ascent 修正水平轨迹
GNSS altitude 覆盖 barometer ascent
motion 补经纬度
callback delay 替代 fix time
让 GAP recovery 跨 GAP 计距或计爬升
```

## Confidence 用途

confidence 主要用于报告和 selected ascent 选择，不应替代硬边界规则。

推荐选择逻辑：

```text
BAROMETER high:
  selected = BAROMETER

BAROMETER medium and GNSS low:
  selected = BAROMETER

BAROMETER low and GNSS medium/high:
  selected = GNSS

both low/unavailable:
  selected = NONE
```

confidence 来源：

```text
barometer confidence:
  pressure continuity
  rejected window ratio
  pressure jump count
  boundary reset count
  activity gate coverage

gnss altitude confidence:
  verticalAccuracy coverage
  accepted altitude sample count
  rejected altitude ratio
  vertical jump count
  horizontal trusted coverage
```
