# evidence.jsonl 到目标成品轨迹算法

> 当前 Web 清洗入口已切换到 `src/sixLayerTrackProduct.mjs` 六层因果算法。
> 本文保留旧 `src/targetProduct.mjs` 目标成品算法的历史口径，避免和新算法混写。
> 六层策略的权威设计见 `../docs/outdoor-track-six-layer-model.md`、
> `../docs/outdoor-track-scenario-recognizers.md`、
> `../docs/platform-neutral-track-engine-contract.md` 和
> `../docs/replay-fixture-six-layer-matrix.md`。

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

当前六层 Web 输出采用分层解释：`primaryExplanation` 面向人工复盘，优先展示场景识别器
和局部重建器；底层 `reason` 保留为可复测的安全内核，并通过 `primitiveFacts`
解释样本合法性、水平可信度、活动门控、GAP/交通边界、GPX/距离/运动时间和高度门控。

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
- 场景画像：采样间隔、accuracy 分布、相邻速度、静止噪声和 motion 比例。
- 自适应影子：旁路对比固定阈值和场景自适应阈值的判点差异。
- 可选对齐结果：Web 复算 decision 与 Android 已记录 decision 的差异。

本文只定义算法和数据边界，不要求立即落 UI 或代码。

## 非目标

- 不在 Web 中调用 Android 系统定位、传感器或权限 API。
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
  产出 raw_location、sampling_policy、device_motion_window、barometer_window 等纯证据事件

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
`evidence.jsonl` 保持纯证据属性：采样请求、原始定位、
设备运动窗口、气压窗口和运行时事件由 Android 产出；最终判点、清洗轨迹和目标统计由 Web
算法自己承担。

Web 会同时生成 `sessionProfile`，但当前只用于观测和解释，不参与 decision。它的作用是先暴露
本次 session 的采样节奏、定位精度常态、相邻速度分布、静止噪声半径和 motion active/still
比例，为后续自适应阈值提供依据。

Web 还会生成 `adaptiveShadows`。它使用 `sessionProfile` 派生多套旁路候选阈值并分别重算，
记录每套候选的整条轨迹统计差值、影子轨迹预览，以及与当前固定阈值结果不同的 raw 点。
第一套候选保留为 `adaptiveShadow` 兼容字段，当前含义是 `adaptive-balanced` 综合自适应。
这些影子不替换 `target track`，不改变里程、GAP、segment、decision reason 或 GPX 输出，
只用于发现“不同自适应方向会改变整条轨迹多少、会改变哪些点、地图上会改在哪里”。
页面应能从分歧列表直接定位到地图 raw 点，避免多文件、多候选、多分歧场景下只靠肉眼扫图。
少数候选可以是 `diagnostic_only`：它们不输出影子轨迹，也不参与“清洗轨迹是否变化”的比较，
只输出额外诊断对象。弱信号方向保持就属于这一类。

`adaptiveShadows[].assessment` 只做启用前诊断：如果影子会降级当前可信点、明显改变里程、
改变 GAP / 疑似交通数量或分歧比例过高，则标记为需要复核或暂不适合启用。这个判断不自动启用
自适应阈值，也不改变当前固定阈值成品。

当前候选分为 `adaptive-balanced`、`adaptive-gap-sensitive`、`adaptive-stationary-noise`、
`adaptive-weak-signal-rescue`、`adaptive-weak-signal-direction-hold` 和 `adaptive-transport-guard`。
它们共享同一套评估器，只改变各自声明的 `changedFields`，用于区分问题主要来自 GAP、静止噪声、
弱信号救回、弱信号主方向还是交通守卫。`adaptive-weak-signal-direction-hold` 不补弱信号乱线，
也不把弱信号点投影成影子轨迹；它只在弱信号低速/逗留区冻结进入弱区前的稳定前进方向，
输出 `weakSignalDirectionHold.hints` 作为“接下来可能往哪里走”的诊断线索。弱区内横向漂移、
回退和局部乱绕仍只作为 raw 诊断证据，不改变固定成品轨迹、影子轨迹、里程或判点。
该候选的 `mode = diagnostic_only`，`track = []`，页面应画独立方向提示线，而不是画一条与清洗轨迹
重合的影子线。

当一次导入多个 evidence 文件时，Web 页面可以按“文件 x 候选”聚合
`adaptiveShadows[].assessment`，展示 `same / observe / review / blocked` 分布、累计影响和优先复核候选，
用于判断某个自适应方向是否具备进入正式策略提案的样本基础。
页面还应按候选方向聚合所有文件的分布、分歧数量、降级数量、里程差和 GAP 差，让批量复核先判断
“哪一类自适应值得继续”，再进入具体 raw 点。

大文件导入和参数重算应在 Web Worker 中执行，避免 parse、复算和影子重算阻塞页面主线程。
地图渲染可以对 raw 点、轨迹线和清洗点做抽样显示；抽样只影响地图展示，不影响
`TargetTrackProduct`、统计、影子评估或点详情使用的全量证据。

## 输入事件

Web 端以 `evidence.jsonl` 为输入。需要识别这些事件：

```text
session_metadata
config_snapshot
runtime_snapshot
sampling_policy
raw_location
device_motion_window
barometer_window
session_event
```

其中，生成平面目标轨迹的最小必要事件为：

```text
session_metadata
sampling_policy
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
    "routeDistanceMeters": 0,
    "totalDistanceMeters": 0,
    "suspectedDistanceMeters": 0,
    "movingTimeSeconds": 0,
    "recordStartElapsedRealtimeNanos": 0,
    "recordEndElapsedRealtimeNanos": 0,
    "segmentCount": 0,
    "gapCount": 0,
    "transportCount": 0,
    "rawPointCount": 0,
    "trustedPointCount": 0,
    "weakPointCount": 0,
    "rejectedPointCount": 0,
    "intakeRejectedPointCount": 0,
    "barometerTotalAscentMeters": -1,
    "barometerAscentSampleCount": 0,
    "barometerAscentRejectedSampleCount": 0,
    "locationAltitudeTotalAscentMeters": -1,
    "locationAltitudeAscentSampleCount": 0,
    "locationAltitudeAscentRejectedSampleCount": 0
  },
  "adaptiveShadow": null,
  "adaptiveShadows": [],
  "findings": []
}
```

统计口径：

```text
routeDistanceMeters = 里程，清洗后的同 segment 运动线路连线总长度；只累计当前点
distanceDeltaMeters > 0 的边，不包含静止 anchor、GAP 恢复或跨 segment/GAP 拉直线
totalDistanceMeters = 运动里程，成品轨迹中 anchor / accept 的 distanceDeltaMeters 求和
suspectedDistanceMeters = 疑似交通里程，成品轨迹中交通工具风险点的 distanceDeltaMeters 求和
movingTimeSeconds = recordEndElapsedRealtimeNanos - recordStartElapsedRealtimeNanos
barometerTotalAscentMeters = 气压窗口独立计算的累计爬升，不依赖 GNSS TrackPoint 接受结果
locationAltitudeTotalAscentMeters = raw_location 海拔在可信轨迹上的兜底累计爬升
```

整段静止压缩：

```text
当成品轨迹没有任何正 distanceDeltaMeters、没有交通工具风险、包含 stationary_anchor，
且可信点原因全部属于首点、静止 anchor 或零 delta GAP 恢复类原因时，可压缩为单个
stationary_session_anchor。该规则用于处理长时间静止采样中多次 GPS 恢复/漂移造成的
多 segment 诊断点。
```

静止边界保护：

```text
后处理回收 stationary_low_speed_tail 时，不能删除已经形成连续低速移动链的尾部；
只有孤立或很短的低速点才可被后续 stationary_anchor 回收。对于 stationary_anchor
之后、下一个可信移动点之前的 stationary_continuity_jitter，如果点位从 anchor
连续外扩、Location accuracy 仍在 weakCloudAccuracyMeters 内且近期 motion 为 active，
可恢复为 motion_supported_low_speed，用于表达离开静止区的起步段。
```

`recordStartElapsedRealtimeNanos` 优先来自 `session_metadata.recordStartElapsedRealtimeNanos`，
否则可使用 Android 证据中的 `createdElapsedRealtimeNanos`，再缺失时退回第一个
`raw_location.elapsedRealtimeNanos`。

`recordEndElapsedRealtimeNanos` 优先来自 `session_metadata.recordEndElapsedRealtimeNanos`，
也兼容 `completedElapsedRealtimeNanos`、`endedElapsedRealtimeNanos`、
`stoppedElapsedRealtimeNanos`；若证据缺少显式终止时间，则退回最后一个
`raw_location.elapsedRealtimeNanos`。

单点上的 `movingTimeDeltaSeconds` 仍保留为连续性、GAP 和 segment 的解释字段，
但聚合 `stats.movingTimeSeconds` 不再由这些单点 delta 累加得到。

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
5. runTrackTrustStrategy
6. buildTargetTrackProduct
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
missing_position_source
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

`provider` / `source` / `sourceKind` / `trustClass` 只作为归一化定位证据的来源解释，不作为
Android `LocationManager.GPS_PROVIDER` 硬门槛。四者至少要有一个非空，证明该
`raw_location` 已经来自可解释定位源。手表、外接定位设备、iOS / 鸿蒙等定位点应先归一化为
`raw_location`，再由同一套 intake、点云和后处理规则判断。

### 5. TrackTrust 复算

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
weight = accuracyWeight * motionWeight * temporalWeight * spatialWeight
```

权重细节：

```text
accuracyWeight = clamp(1 / max(accuracy, 3), 0.01, 0.33)

temporalWeight = exp(-sampleAgeInCloudSeconds / 20)

spatialWeight:
  distance <= cloudRadius -> 1.0
  distance <= max(cloudRadius, accuracy * 1.5) -> 0.5
  else -> 0.1
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

### 9. 低质量运动段后处理

低质量定位场景下，真实移动可能被大量 `stationary_continuity_jitter`
包围，只剩一个孤立 `moving_good_fix`。Web 不应把这种点解释成普通 GPS 好点，也不应在有持续运动证据时直接删掉。

保守后处理：

```text
候选点:
  reason = moving_good_fix
  前一个目标点不是交通工具风险
  后一个目标点是 stationary_anchor / gap_recovery / continuity_rescue_gap_recovery

候选 raw 区间:
  从前一目标点之后到后一目标点之前
  已通过 Web intake 并进入 engine
  已归一化定位证据
  accuracy <= weakCloudAccuracyMeters

触发条件:
  duration >= 60s
  近期 active-motion 覆盖比例 >= 0.7
  区间 weak/reject 占比 >= 0.7
  连续 weak/reject run 占比 >= 0.7
  合理相邻采样步距累计 >= 25m
  合理移动步数 >= 8
  相邻 raw 采样间隔 <= 10s
  区间 bbox 对角线 >= 25m
  现有清洗轨迹没有充分表达这段运动
  显式开启 lowQualityMotionRebuildEnabled 后可能改变轨迹 / 里程 / 运动时间
```

满足条件时，Web 默认只把该区间写入 `lowQualityMotionRebuild.candidates` 作为复核候选，
不改变成品轨迹、里程或运动时间。只有显式开启 `lowQualityMotionRebuildEnabled` 时，Web
才不再保留单个 `moving_good_fix`，而是对候选 raw 区间做几何抽稀，生成少量
`motion_supported_low_quality` 结构点，并把每个结构点覆盖的 raw 区间写入
`contributingRawPointIds`。这表示：这些点不是普通好点，而是低质量定位下由采样间距、
空间展开和运动证据共同支持、且已经人工确认可启用的成品轨迹结构。

同时，Web 会额外执行广义 raw 区间扫描，产出
`lowQualityMotionRebuild.rawIntervalCandidates`。这个扫描不再把“区间里有任意 reject”视为低质候选；
只有当连续 weak/reject 占比足够高、区间本身满足持续运动形状、现有清洗轨迹没有充分表达这段运动，
且该区间与一个可由 `lowQualityMotionRebuildEnabled` 改变结果的可入轨候选重叠时，才写入广义
raw 区间。它用于辅助复核同一段低质量运动证据，不作为独立入轨入口。

### 10. 气压阻止静止整段压缩

气压证据不参与平面轨迹清洗判点，但会作为独立累计爬升路径输出
`barometerTotalAscentMeters`。Web 页面另提供 `气压阻止静止整段压缩` 开关；开启后，
气压仍然不作为剔除 raw 点的硬规则，只作为静止整段压缩的反证。

当前保守规则：

```text
barometerCleaningEnabled = true
barometer_window 有效窗口数 >= 5
max(rawAltitude) - min(rawAltitude) >= 3m
```

满足以上条件时，如果定位平面轨迹和设备运动证据看起来像“整段静止”，Web 也不会把
整段结果压缩成 1 个 `stationary_session_anchor`。原因是：气压出现连续垂直变化时，
它更像是在提示真实上下行或楼层/山路高度变化，不能让低运动窗口单独决定整段静止。

边界：

- 气压不直接把点从目标轨迹中删除。
- 气压不改变 `raw_location`、`sampling_policy`、`device_motion_window`
  等纯证据。
- 气压累计爬升与 raw_location 海拔累计爬升分开展示，不互相覆盖。
- 气压清洗开关只影响“是否执行静止整段压缩”，不改变交通工具识别、GAP、intake 或点云稳定性。
- 关闭开关时，Web 平面清洗结果保持不受 `barometer_window` 影响；气压累计爬升仍会单独计算。

### 11. 目标成品轨迹

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

距离和点级时间增量：

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

motion_supported_low_quality:
  coordinateSource = raw
  显式开启 lowQualityMotionRebuildEnabled 后才进入目标成品轨迹
  说明：原始 decision 是孤立 moving_good_fix，但它前后 raw 区间存在持续 active motion、足够采样步距和足够空间展开时，Web 将该区间抽稀为低质量定位下的运动结构点；默认只作为复核候选
  保护：不跨 GAP，不接受疑似交通速度，不凭单点 active motion 恢复；短促晃动或整段空间展开不足时仍走 stationary / isolated 规则

adaptive-weak-signal-direction-hold:
  不生成 TrackPoint
  输出 weakSignalDirectionHold.hints
  说明：弱信号低速/逗留区不再补一条“看起来规整”的影子路线；算法只使用进入弱区前最后一段稳定可信移动方向，画出诊断方向提示
  保护：不改变固定成品轨迹，不改变影子轨迹、里程、GAP、segment 或 Android GPX；弱区 raw 点仍保留在 excluded/诊断证据中
  置信：如果弱区后稳定出口仍沿历史方向前进，标记 confirmed_by_exit/high；如果出口偏离，标记 exit_deviates_from_held_direction/low；如果没有出口，只保留 history_direction_only 或前进不足/横向噪声高提示

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
  全部 raw_location、motion、sampling、pressure evidence

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
