# evidence.jsonl 到目标成品轨迹算法

本文定义 Web 端从 Android 纯证据 `evidence.jsonl` 离线生成目标成品轨迹的算法口径。

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
  产出 raw_location、sampling_policy、gnss_snapshot、device_motion_window、barometer_window 等纯证据事件

Web:
  离线分析端和目标成品复算端
  读取 evidence.jsonl
  生成 TargetTrackProduct
```

因此，本文算法只服务 Web 离线分析和目标成品预览。即使 Web 复算结果与 Android
实时 decision 存在差异，也应先作为样本分析和策略讨论依据，不直接改变 Android
实时轨迹计算。

Web 清洗算法不能依赖 Android 已记录的 `decision` 或 `location_intake_rejected`
作为输入真相。长期口径应让
`evidence.jsonl` 保持纯证据属性：采样请求、原始定位、卫星质量、
设备运动窗口、气压窗口和运行时事件由 Android 产出；最终判点、清洗轨迹和目标统计由 Web
算法自己承担。

## 输入事件

Web 端以 `evidence.jsonl` 为输入。需要识别这些事件：

```text
session_metadata
config_snapshot
runtime_snapshot
sampling_policy
gnss_snapshot
raw_location
device_motion_window
barometer_window
session_event
```

其中，生成平面目标轨迹的最小必要事件为：

```text
session_metadata
sampling_policy
gnss_snapshot
raw_location
device_motion_window
barometer_window
```

`decision` 和 `location_intake_rejected` 不是 Web 清洗算法的输入真相；
纯证据版 `evidence.jsonl` 不写入这些事件，Web 清洗算法负责生成
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
1. parseEvidenceJsonl
2. buildEvidenceStream
3. rebuildSamplingTimeline
4. rebuildIntakeResults
5. rebuildGnssMatches
6. runTrackTrustStrategy
7. buildTargetTrackProduct
```

### 1. 解析 JSONL

逐行解析 `evidence.jsonl`：

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
barometerWindows
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
TRANSPORT_RISK_CLOUD
STATIONARY_CLOUD
RECOVERY_CLOUD
WEAK_CLOUD
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
  -> TRANSPORT_RISK_CLOUD

distance < max(5m, accuracy * 1.5):
  -> STATIONARY_CLOUD

否则:
  -> MOVING_CLOUD
```

### 7. 点云加权中心

TrackPoint 坐标按状态选择来源：

```text
stationary_anchor:
  使用 cloud weighted center，压住静止漂移

moving_good_fix / transport_suspected_kept / continuity_rescue_* / gap_recovery:
  使用 raw 坐标，避免移动轨迹被历史点云中心拉回
```

cloud weighted center 仍然会被计算，用于点云稳定性、半径、代表点和解释字段。

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

TRANSPORT_RISK_CLOUD:
  accept / transport_suspected_kept

STATIONARY_CLOUD:
  stable 且近期 still-motion 支持 -> anchor / stationary_anchor
  连续性合理但无近期静止 motion 支持 -> reject / stationary_continuity_jitter
  否则 -> reject / stationary_cloud_jitter

RECOVERY_CLOUD:
  连续高速/疑似交通工具恢复 -> accept / recovery_transport_suspected_kept
  stable -> accept / gap_recovery
  连续性合理 -> accept / continuity_rescue_gap_recovery
  否则 -> weak / recovery_cloud_pending

WEAK_CLOUD:
  连续性合理 -> accept / continuity_rescue_low_accuracy
  weak / weak_signal_stage2

```

交通工具风险只作为解释标签，不作为剔除条件。

近期 still-motion 支持：

```text
最近 5 秒窗口内 device_motion_window 存在
且加速度 RMS、陀螺仪 RMS、步数增量都处于低运动区间
```

### 9. 气压证据参与清洗

气压证据默认不参与清洗，Web 页面提供 `气压参与清洗` 开关。开启后，气压仍然不作为
剔除 raw 点的硬规则，只作为静止整段压缩的反证。

当前保守规则：

```text
barometerCleaningEnabled = true
barometer_window 有效窗口数 >= 5
max(rawAltitude) - min(rawAltitude) >= 3m
```

满足以上条件时，如果 GNSS 平面轨迹和设备运动证据看起来像“整段静止”，Web 也不会把
整段结果压缩成 1 个 `stationary_session_anchor`。原因是：气压出现连续垂直变化时，
它更像是在提示真实上下行或楼层/山路高度变化，不能让低运动窗口单独决定整段静止。

边界：

- 气压不直接把点从目标轨迹中删除。
- 气压不改变 `raw_location`、`sampling_policy`、`gnss_snapshot`、`device_motion_window`
  等纯证据。
- 气压只影响“是否执行静止整段压缩”，不改变交通工具识别、GAP、intake 或点云稳定性。
- 关闭开关时，Web 清洗结果保持不受 `barometer_window` 影响。

### 10. 目标成品轨迹

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
  coordinateSource = raw
  distanceDeltaMeters = distance(previousTrustedTrackPoint, raw)
  movingTimeDeltaSeconds = elapsed(currentRaw, previousTrustedTrackPoint)

transport_suspected_kept:
  coordinateSource = raw
  distanceDeltaMeters = distance(previousTrustedTrackPoint, raw)
  movingTimeDeltaSeconds = elapsed(currentRaw, previousTrustedTrackPoint)
  进入目标成品，但保留疑似交通工具风险 reason

recovery_transport_suspected_kept:
  coordinateSource = raw
  startsNewSegment = true
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0
  说明：长 GAP 后恢复段出现连续高速移动时，作为新的成品轨迹 segment 保留，不累计 GAP 两端直线

stationary_anchor:
  coordinateSource = cloud_center
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

stationary_continuity_jitter:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：静止点云附近即使位置连续性合理，只要缺少近期 still-motion 支持，也不能把它串进成品轨迹线

stationary_anchor_redundant:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：同一静止簇只保留一个 anchor，后续静止 anchor 作为重复静止证据排除

stationary_gap_recovery_jitter:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：长时间静止排除点造成的时间 GAP，如果恢复点仍在同一静止 anchor 附近，不开启新的成品 segment

isolated_stationary_movement:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：孤立 moving_good_fix 随后立即落入同一静止簇时，视为静止区域误动点

motion_supported_low_speed:
  coordinateSource = raw
  进入目标成品轨迹
  说明：静止阈值附近如果有近期 active motion，且低速位移连续合理，保留为真实低速移动

stationary_low_speed_tail:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：低速移动点如果紧贴后续静止 anchor，视为进入静止簇前的尾部抖动，不串进成品线

continuity_rescue_low_accuracy:
  coordinateSource = raw
  进入目标成品轨迹
  说明：只救回轻微弱精度、仍有参与定位卫星且位移达到最小门槛的连续点；精度过弱或 used-in-fix 过低时保持 weak

stationary_low_accuracy_tail:
  不进入目标成品轨迹
  保留在 excluded.rejected
  说明：低精度救回点如果紧贴后续静止 anchor，视为进入静止簇前的弱精度尾巴，不串进成品线

gap_recovery:
  coordinateSource = raw
  startsNewSegment = true
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

continuity_rescue_gap_recovery:
  coordinateSource = raw
  startsNewSegment = true
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

transport_suspected_kept:
  进入目标成品
  transportCount + 1
```

GAP 的视觉和统计语义必须分开：

```text
地图线可以连续
segmentId 可以递增
GAP 两端直线不能计入 totalDistanceMeters
```

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
- 疑似交通工具只标记为 `transport_suspected_kept` 并保留，不作为轨迹剔除条件。
- Web 复算统计稳定可解释。
- 无法复原的字段进入 `findings`，不静默吞掉。

第二阶段通过标准：

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
```

实现前不要调整 Android 实时策略阈值、decision reason、segment 逻辑、距离累计或既有诊断 schema。
