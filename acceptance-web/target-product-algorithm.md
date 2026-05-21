# evidence.jsonl 到目标成品轨迹算法

本文定义 Web 端从 Android 纯证据 `evidence.jsonl` 离线生成目标成品轨迹的算法口径；`diagnostic.jsonl` 仅作为旧日志兼容输入。

Android 在这一阶段只作为数据产出端：负责真实设备采集、生成
`evidence.jsonl`、`session.json` 等证据文件。

Web 工具的定位不是替代 Android 采集链路，也不是反向参与 Android 实时轨迹计算，
而是把 Android 已导出的纯证据复算成一份可核验、可对齐、可解释的目标成品：

```text
evidence.jsonl
  -> evidence stream
  -> intake rebuild
  -> sampling timeline rebuild
  -> track trust rebuild
  -> target track product
```

当前对应 Android 策略版本：

```text
stage2-track-trust-v3-sampling-cloud
```

## 目标

输入一个或多个 `evidence.jsonl`，Web 端应能生成：

- 目标可信轨迹：只包含 `anchor` 和 `accept`。
- 目标统计：距离、运动时间、segment、GAP、交通工具混入、点数。
- 排除证据：`weak`、`reject`、`intake_rejected` 及原因。
- 复算解释：每个 raw 点为什么进入或没有进入目标成品。
- 可选对齐结果：Web 复算 decision 与 Android 已记录 decision 的差异。

本文只定义算法和数据边界，不要求立即落 UI 或代码。

## 非目标

- 不在 Web 中调用 Android `LocationManager`、`GnssStatus`、传感器或权限 API。
- 不把本文算法接入 Android 实时记录、实时地图或前台服务判点链路。
- 不要求 Android 为了 Web 目标成品算法调整实时 TrackPoint、GPX 或 session 生成逻辑。
- 不修改、不修复、不回写 Android 原始证据日志。
- 不把 `NETWORK_PROVIDER`、`FUSED_PROVIDER` 或 mock 点纳入可信轨迹。
- 不用 `timeMillis` 替代 `elapsedRealtimeNanos` 做连续性、GAP 或速度判断。
- 不把弱信号修复结果直接写入可信轨迹。

## Android 与 Web 分工

当前阶段分工如下：

```text
Android:
  真实采集端和证据产出端
  产出 raw_location、sampling_policy、gnss_snapshot、motion_summary 等纯证据事件

Web:
  离线分析端和目标成品复算端
  读取 evidence.jsonl；兼容读取旧 diagnostic.jsonl
  生成 TargetTrackProduct
  可选地与 Android recorded decision 做对齐 diff
```

因此，本文算法只服务 Web 离线分析和目标成品预览。即使 Web 复算结果与 Android
实时 decision 存在差异，也应先作为样本分析和策略讨论依据，不直接改变 Android
实时轨迹计算。

Web 清洗算法不能依赖 Android 已记录的 `decision` 或 `location_intake_rejected`
作为输入真相。它们只能是兼容旧诊断日志时的对照材料。长期口径应让
`evidence.jsonl` 保持纯证据属性：采样请求、原始定位、卫星质量、
运动摘要和运行时事件由 Android 产出；最终判点、清洗轨迹和目标统计由 Web
算法自己承担。

## 输入事件

Web 端以 `evidence.jsonl` 为推荐输入，并兼容旧 `diagnostic.jsonl`。需要识别这些事件：

```text
session_metadata
config_snapshot
runtime_snapshot
sampling_policy
gnss_snapshot
raw_location
location_intake_rejected
decision
motion_summary
session_event
pressure_sample
```

其中，生成平面目标轨迹的最小必要事件为：

```text
session_metadata
sampling_policy
gnss_snapshot
raw_location
motion_summary
```

`decision` 和 `location_intake_rejected` 不是 Web 清洗算法的必要输入。
如果旧日志里存在这些 Android 已记录结果，Web 只能把它们用于对齐 diff 和解释展示；
纯证据版 `evidence.jsonl` 不写入这些事件，Web 清洗算法仍应能生成
`TargetTrackProduct`。

## 输出对象

推荐输出对象名：

```text
TargetTrackProduct
```

建议结构：

```json
{
  "strategyVersion": "stage2-track-trust-v3-sampling-cloud",
  "sourceFilePath": "evidence.jsonl",
  "track": [],
  "excluded": {
    "weak": [],
    "rejected": [],
    "intakeRejected": []
  },
  "stats": {
    "totalDistanceMeters": 0,
    "movingTimeSeconds": 0,
    "segmentCount": 0,
    "gapCount": 0,
    "transportCount": 0,
    "rawPointCount": 0,
    "trustedPointCount": 0,
    "weakPointCount": 0,
    "rejectedPointCount": 0,
    "intakeRejectedPointCount": 0
  },
  "alignment": {
    "comparedDecisionCount": 0,
    "matchedDecisionCount": 0,
    "mismatches": []
  },
  "findings": []
}
```

目标可信轨迹点建议结构：

```json
{
  "trackPointId": 1,
  "sourceRawPointId": 10,
  "recomputedDecisionId": 3,
  "segmentId": 1,
  "lat": 30.0,
  "lng": 120.0,
  "elapsedRealtimeNanos": 123456789,
  "timeMillis": 1710000000000,
  "result": "accept",
  "reason": "moving_good_fix",
  "distanceDeltaMeters": 8.4,
  "movingTimeDeltaSeconds": 3.0,
  "cloudType": "MOVING_CLOUD",
  "cloudId": 2,
  "cloudSampleCount": 1,
  "cloudWeightSum": 0.11,
  "cloudWeightedRadiusMeters": 0.0,
  "representativeRawPointId": 10,
  "contributingRawPointIds": [10],
  "virtualCoordinate": true
}
```

## 总流水线

```text
1. parseDiagnosticJsonl
2. buildEvidenceStream
3. rebuildSamplingTimeline
4. rebuildIntakeResults
5. rebuildGnssMatches
6. runTrackTrustStrategy
7. buildTargetTrackProduct
8. compareWithRecordedDecision
```

### 1. 解析 JSONL

逐行解析 `evidence.jsonl` 或兼容旧 `diagnostic.jsonl`：

- 空行忽略。
- JSON 解析失败保留为 `parseErrors`。
- 每个事件保留 `lineNumber`。
- 事件排序优先使用 `elapsedRealtimeNanos`，缺失时保留文件顺序作为诊断线索。

解析失败不应阻止可用事件继续生成目标成品，但必须进入 `findings`。

### 2. 重建证据流

把事件归类为：

```text
rawPoints
gnssSnapshots
samplingPolicies
motionSummaries
recordedDecisions
recordedIntakeRejections
sessionEvents
pressureSamples
```

`raw_location` 是主时间轴。每个 raw 点至少需要：

```text
rawPointId
provider
lat
lng
accuracy
elapsedRealtimeNanos
timeMillis
mock
sourceGnssSnapshotId
```

如果字段缺失，不能自行补造成可信值，只能记录 finding 或进入 intake 拒绝。

### 3. 重建采样时间线

Web 端需要根据 `sampling_policy` 重建 `SamplingEpoch`：

```text
samplingEpochId
state
minTimeMs
minDistanceMeters
startedElapsedRealtimeNanos
```

每个 raw 点必须绑定一个采样 epoch。

优先级：

1. `raw_location` 中若已有 `samplingEpochId`，直接使用并校验。
2. 否则按 `sampling_policy.startedElapsedRealtimeNanos` 或事件时间向前匹配最近 epoch。
3. 若无法绑定，复算结果为 `sampling_contract_violation`，并标记为低置信复算。

采样 epoch 用于解释定位归因和 PAUSED / MOVING 等采样状态，不能用 callback 接收时间替代 fix 测量时间。

### 4. Intake 复算

每个 raw 点先通过 intake。通过后才允许进入点云。

拒绝规则：

```text
sampling_contract_violation
provider_not_gps
mock_location
missing_fix_elapsed_realtime
before_record_start
sampling_epoch_mismatch
location_from_future
invalid_coordinate
invalid_accuracy
accuracy_too_large
duplicate_fix
out_of_order_fix
```

关键阈值：

```text
START_TOLERANCE_NANOS = 1_000_000_000
MAX_ACCURACY_METERS = 80
```

duplicate key：

```text
samplingEpochId | provider | elapsedRealtimeNanos | lat | lng | accuracy
```

Intake 拒绝点进入 `excluded.intakeRejected`。这个拒绝结果由 Web intake 复算产生，
不依赖 Android 写入的 `location_intake_rejected`。

### 5. GNSS 证据匹配

Web 端优先使用 raw 点里已有的 `sourceGnssSnapshotId`。

若缺失，可按 Android 口径做近似匹配：

```text
优先匹配过去 3 秒内最近的 gnss_snapshot
必要时可标记 future match
超过窗口标记 gnssQualityStale
```

GNSS 质量只参与点云权重和解释，不应作为额外硬拒绝。

### 6. TrackTrust 复算

合法 RawPoint 进入 TrackTrust 策略。

Cloud 类型：

```text
START_CLOUD
MOVING_CLOUD
STATIONARY_CLOUD
RECOVERY_CLOUD
WEAK_CLOUD
TRANSPORT_CLOUD
```

选择规则：

```text
无上一可信点:
  accuracy > 30m -> WEAK_CLOUD
  否则 -> START_CLOUD

距上一可信点 elapsed gap > 120s:
  -> RECOVERY_CLOUD

accuracy > 30m:
  -> WEAK_CLOUD

PAUSED epoch:
  distance < max(5m, accuracy * 1.5) -> STATIONARY_CLOUD
  否则 -> RECOVERY_CLOUD

speed > 12 m/s:
  -> WEAK_CLOUD

speed >= 3.5 m/s 且 distance >= 20m:
  -> TRANSPORT_CLOUD

处于 transport mode:
  -> RECOVERY_CLOUD

distance < max(5m, accuracy * 1.5):
  -> STATIONARY_CLOUD

否则:
  -> MOVING_CLOUD
```

### 7. 点云加权中心

TrackPoint 坐标来自 cloud weighted center，而不是直接取 raw 点坐标。

权重公式：

```text
weight = accuracyWeight * gnssWeight * motionWeight * temporalWeight * spatialWeight
```

权重细节：

```text
accuracyWeight = clamp(1 / max(accuracy, 3), 0.01, 0.33)

gnssWeight:
  score >= 80 -> 1.0
  score >= 60 -> 0.7
  score >= 35 -> 0.4
  else        -> 0.25

temporalWeight = exp(-sampleAgeInCloudSeconds / 20)

spatialWeight:
  distance <= cloudRadius -> 1.0
  distance <= max(cloudRadius, accuracy * 1.5) -> 0.5
  else -> 0.1
```

GNSS score：

```text
usedInFixTotal >= 8 且 top4AvgCn0 >= 28 -> 100
usedInFixTotal >= 5 且 top4AvgCn0 >= 22 -> 70
usedInFixTotal >= 3 -> 40
否则 -> 25
```

Cloud 稳定条件：

```text
START_CLOUD:
  sampleCount >= 1
  weightSum >= 0.03

MOVING_CLOUD:
  sampleCount >= 1
  weightSum >= 0.03
  weightedRadius <= max(15m, medianAccuracy * 1.5)

STATIONARY_CLOUD:
  sampleCount >= 2
  weightSum >= 0.08
  weightedRadius <= max(8m, medianAccuracy * 1.2)

RECOVERY_CLOUD:
  sampleCount >= 2
  weightSum >= 0.08
  weightedRadius <= max(12m, medianAccuracy * 1.5)
```

RECOVERY 快速通道：

```text
RECOVERY_CLOUD 只有 1 个样本
accuracy <= 10m
GNSS score >= 80
无速度或速度 <= 2.5m/s
且距上一可信点不属于静止阈值内
```

### 8. Decision 输出

Web 复算 decision 口径：

```text
START_CLOUD:
  anchor / first_fix_good      accuracy <= 20m
  anchor / first_fix_relaxed   accuracy > 20m

MOVING_CLOUD:
  stable   -> accept / moving_good_fix
  unstable -> weak / moving_cloud_unstable

STATIONARY_CLOUD:
  stable 且近期 still-motion 支持 -> anchor / stationary_anchor
  否则 -> reject / stationary_cloud_jitter

RECOVERY_CLOUD:
  stable   -> accept / gap_recovery
  unstable -> weak / recovery_cloud_pending

WEAK_CLOUD:
  weak / weak_signal_stage2

TRANSPORT_CLOUD:
  reject / transport_suspected
```

近期 still-motion 支持：

```text
最近 5 秒窗口内 motion_summary 存在
且 deviceStill 占比 >= 75%
```

### 9. 目标成品轨迹

进入目标成品轨迹的 result：

```text
anchor
accept
```

不进入目标成品轨迹的 result：

```text
weak
reject
intake_rejected
raw
```

`weak`、`reject`、`intake_rejected` 必须保留在 `excluded` 中，作为最终成品的解释证据。

距离和运动时间：

```text
first_fix_good / first_fix_relaxed:
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

moving_good_fix:
  distanceDeltaMeters = distance(previousTrustedTrackPoint, cloudCenter)
  movingTimeDeltaSeconds = elapsed(currentRaw, previousTrustedTrackPoint)

stationary_anchor:
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

gap_recovery:
  startsNewSegment = true
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

transport_suspected:
  不进入目标成品
  transportCount + 1
```

GAP 的视觉和统计语义必须分开：

```text
地图线可以连续
segmentId 可以递增
GAP 两端直线不能计入 totalDistanceMeters
```

## Android 对齐 diff

Web 复算完成后，如果兼容旧 `diagnostic.jsonl` 时存在 Android recorded decision，
可以做可选对齐 diff。这个 diff 只用于比较 Android 实时策略和 Web 离线清洗结果，
不能反向成为 Web 清洗依据。

对齐 key 优先级：

```text
rawPointId
decisionId
trackPointId
```

可比较：

```text
result
reason
segmentId
distanceDeltaMeters
movingTimeDeltaSeconds
cloudType
cloudId
cloudSampleCount
cloudWeightedRadiusMeters
```

距离和浮点字段允许小误差：

```text
distance epsilon <= 0.01m
time epsilon <= 0.001s
coordinate epsilon <= 1e-7 degree
```

如果 Web 无法完全复原 `SamplingEpoch` 或 GNSS 匹配，diff 应标记为：

```text
low_confidence_rebuild
```

不能把低置信复算差异直接视为 Android 策略错误。

## 页面呈现建议

Web 页面最终可分为三层：

```text
Raw Evidence
  全部 raw_location、GNSS、motion、sampling evidence

Target Product
  Web 复算出的目标可信轨迹、统计和 segment

Excluded Evidence
  weak / reject / intake_rejected，以及每个排除原因
```

地图图层建议：

```text
raw track                细虚线
target trusted track     粗实线
weak points              弱点样式
reject points            拒绝样式
intake rejected points   intake 拒绝样式
transport evidence       红色线或点
cloud center             可选中心点
cloud radius             可选半径圈
```

## 验收口径

第一阶段通过标准：

- 同一个 `evidence.jsonl` 能稳定生成 `TargetTrackProduct`。
- 目标轨迹只包含 `anchor` 和 `accept`。
- `gap_recovery` 进入目标轨迹，但 delta 为 0。
- `transport_suspected` 不进入目标轨迹，不累计徒步距离。
- Web 复算统计稳定可解释，旧 diagnostic 对照差异只作为参考。
- 无法复原的字段进入 `findings`，不静默吞掉。

第二阶段通过标准：

- 兼容旧 diagnostic 时，Web 复算 decision 可与 Android recorded decision 做可选 diff。
- replay fixture 的 Web 复算结果与 Android replay 结果一致。
- 真实多设备样本能用同一目标成品结构做对比。
- 目标成品结构可作为后续 SDK 契约草案的一部分。

## 后续实现建议

建议按以下顺序落代码：

```text
1. 新增纯算法模块 targetProduct.mjs
2. 新增 TrackCloudWindow JS 复刻及单元测试
3. 新增 SamplingIntake JS 复刻及单元测试
4. 新增 evidence -> TargetTrackProduct 集成测试
5. 接入现有地图，默认显示 Web 清洗目标结果
6. 兼容旧日志时增加 Android recorded 对照视图
7. 增加 diff 面板
```

实现前不要调整 Android 实时策略阈值、decision reason、segment 逻辑、距离累计或既有诊断 schema。
