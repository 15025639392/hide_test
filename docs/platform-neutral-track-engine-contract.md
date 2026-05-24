# Platform-Neutral Track Engine Contract

本文定义平台中立轨迹函数的输入输出契约。它是六层因果模型的工程接口版本，
不改变当前 Android v3 实现、阈值、replay 期望或诊断 schema。

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
  rawPointId
  provider
  latitude
  longitude
  horizontalAccuracyMeters
  altitudeMeters optional
  verticalAccuracyMeters optional
  speedMetersPerSecond optional
  bearingDegrees optional
  wallTimeMillis
  elapsedRealtimeNanos
  isMock
  samplingEpochId
  callbackReceivedElapsedRealtimeNanos optional
  callbackDelayNanos optional
```

字段归属：

```text
latitude / longitude / horizontalAccuracyMeters -> 水平轨迹线
altitudeMeters / verticalAccuracyMeters         -> GNSS altitude line
elapsedRealtimeNanos                            -> 轨迹和 Location 海拔连续性时间
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
  lastSensorAccuracy optional
```

pressure altitude 是独立的 BAROMETER altitude line，按传感器时间运行，不绑定到单个 TrackPoint。

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
  sessionSummary
```

### TrackPoint

```text
TrackPoint:
  trackPointId
  sourceRawPointId
  latitude
  longitude
  elapsedRealtimeNanos
  wallTimeMillis
  horizontalAccuracyMeters
  decisionResult
  decisionReason
  segmentId
  distanceDeltaMeters
  movingTimeDeltaSeconds
  startsNewSegment
  primaryExplanation
  scenarioContexts[]
  primitiveFacts[]
```

可信 GPX 只能来自可信 TrackPoint。weak/reject 不进入 trusted GPX。

### RawPointDecision

```text
RawPointDecision:
  rawPointId
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
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

BarometerAscentResult:
  totalAscentMeters
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

SelectedAscentResult:
  source = BAROMETER / GNSS / NONE
  totalAscentMeters optional
  confidence
  reason
```

两条原始高度结果必须保留。`SelectedAscentResult` 只是产品主展示选择。

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
  selectedTotalAscentMeters optional
  selectedAscentSource
```

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
