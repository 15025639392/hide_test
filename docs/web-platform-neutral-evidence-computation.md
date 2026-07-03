# Web Platform-Neutral Evidence Computation

本文说明当前 `acceptance-web/` 如何消费 `outdoor-track-evidence-v1`，以及如何从
平台中立 evidence 计算轨迹、里程、运动时间、配速、累计爬升和累计下降。

它描述的是 **Web 当前实现**，不是新的平台契约。平台契约见：

- `docs/platform-neutral-evidence-jsonl-contract.md`
- `docs/platform-neutral-track-engine-contract.md`
- `docs/track-sdk-public-api-contract.md`
- `docs/platform-neutral-continuity-terms.md`

## 结论

Web 已经可以读取新的平台中立 evidence：

```text
outdoor-track-evidence-v1 JSONL
  -> parseEvidenceJsonl
  -> buildSixLayerTrackProduct
  -> buildTargetOutput
```

但 Web 内部仍保留过渡命名，例如 `rawPointId`、`rawRange`、
`elapsedRealtimeNanos` 和 `sourceRawPointId`。这些是 Web 内部模型，不是新平台应输出
的 evidence 字段。

Web 的清洗对齐应同时遵循平台中立连续性定义：

- 时间连续
- 空间连续
- 局部方向稳定
- 速度不突变

其中 `gap_recovery`、`transport_contamination`、`stationary_drift`、`continuity_rescue_*`
等内部规则，是连续性边界的实现分类，不是连续性本身的定义。Web 不应把“点很多”、
“点有位移”或“单点精度勉强可用”直接等同为连续性成立。

watchOS / iOS / 鸿蒙 / Rust SDK 对齐时，应以 `outdoor-track-evidence-v1` 为输入输出
边界，不要为了 Web 内部命名输出 `raw_location`、`rawPointId` 或
`elapsedRealtimeNanos`。

## 当前代码入口

Web 导入入口：

```text
acceptance-web/src/importWorker.mjs
```

核心调用链：

```text
parseEvidenceJsonl(await file.text(), filePath)
  -> buildSixLayerTrackProduct(inputModel, { config })
  -> buildTargetOutput(inputModel, targetProduct)
```

主要实现文件：

| Area | File |
| --- | --- |
| JSONL 解析、诊断模型和最终输出 | `acceptance-web/src/diagnosticMap.mjs` |
| 六层轨迹产品、基础安全内核、距离/时间/高度累计 | `acceptance-web/src/sixLayerTrackProduct.mjs` |
| 流式 evidence 分片 intake | `acceptance-web/src/streamingEvidenceIntake.mjs` |
| 流式基础安全内核 | `acceptance-web/src/streamingBaseTrackKernel.mjs` |
| 流式指标累计 | `acceptance-web/src/streamingMetricAccumulator.mjs` |
| 流式情景识别 | `acceptance-web/src/streamingScenarioRecognizer.mjs` |
| 流式引擎串联 | `acceptance-web/src/streamingTrackEngine.mjs` |

## 输入事件

Web 当前识别的新平台中立事件包括：

| Event | Purpose |
| --- | --- |
| `session_metadata` | session、策略、设备和起止时间上下文。 |
| `sampling_policy` | 采样请求归因和采样状态。 |
| `location_sample` | 平台中立定位 fix。 |
| `motion_window` | motion / step 摘要，用于 walking / still 判断和情景门控。 |
| `barometer_window` | 气压计窗口，提供累计爬升/累计下降证据。 |
| `session_event` | pause、resume、finish、timeout 等生命周期事件。 |

Web 仍兼容 legacy Android 事件，例如 `raw_location` 和 `device_motion_window`。这只是
为了历史样本、回归测试和 Android v3 诊断兼容。

## 字段归一化

平台中立字段进入 Web 后，会先归一化成当前内部模型。

| Platform-neutral field | Web internal field | Notes |
| --- | --- | --- |
| `sampleId` | `rawPointId` | session 内稳定样本 ID。 |
| `provider` / `source` / `sourceKind` / `trustClass` | `provider` | 定位来源归一化。 |
| `horizontalAccuracyMeters` | `accuracy` | 水平精度。 |
| `altitudeMeters` | `altitude` | GNSS altitude line。 |
| `verticalAccuracyMeters` | `verticalAccuracy` | GNSS altitude 门控。 |
| `speedMetersPerSecond` | `speed` | 系统 reported speed。 |
| `bearingDegrees` | `bearing` | 系统 bearing。 |
| `fixElapsedRealtimeNanos` | `elapsedRealtimeNanos` | 轨迹连续性主时钟。 |
| `wallTimeMillis` | `timeMillis` | 人类复盘和粗排序。 |
| `receivedElapsedRealtimeNanos` | `callbackReceivedElapsedRealtimeNanos` | 诊断展示。 |
| `callbackDelayNanos` | `callbackDelayNanos` | 诊断展示，不是判点硬门槛。 |

重要原则：

```text
fixElapsedRealtimeNanos 才是位置连续性主时钟。
receivedElapsedRealtimeNanos / callbackDelayNanos 只用于诊断。
```

## 计算总览

当前 Web 计算可以分成四层：

```text
1. JSONL parse
2. Evidence normalize
3. 基础安全内核和情景策略
4. 指标汇总和 selected ascent/descent 选源
```

其中第 3 层应先判断连续性链路是否成立，再决定是否进入距离、运动时间、爬升、下降与场景结算。

更具体地说：

```text
location_sample
  -> RawPoint
  -> intake 合法性校验
  -> horizontal decision
  -> anchor / accept / weak / reject / intake_rejected
  -> track point
  -> distance / moving time / GNSS ascent / GNSS descent

barometer_window
  -> barometer windows
  -> pressure altitude gain/loss gate
  -> barometer ascent / barometer descent

motion_window
  -> recent motion index
  -> walking / still / unknown
  -> stationary、low speed、recovery、scenario gate
```

## 默认策略参数快照

当前 Web 默认策略版本：

```text
six-layer-evidence-v17.9
```

以下参数来自 `acceptance-web/src/sixLayerTrackProduct.mjs` 的
`DEFAULT_SIX_LAYER_TRACK_CONFIG`。它们是 Web 当前实现快照；跨端迁移时应通过契约或
SDK 配置统一下发，避免各端硬编码出不同策略。

### 基础定位和速度门控

| Parameter | Default | Meaning |
| --- | ---: | --- |
| `maxIntakeAccuracyMeters` | `80` | 入口允许的最大水平精度。超过则 `accuracy_too_large`。 |
| `weakCloudAccuracyMeters` | `30` | 超过该精度时进入弱点云，除非满足低精度连续性救援。 |
| `firstFixGoodAccuracyMeters` | `20` | 首点好点阈值，满足则 `first_fix_good` anchor。 |
| `firstFixRelaxedAccuracyMeters` | `30` | 首点放宽阈值，满足则 `first_fix_relaxed` anchor。 |
| `gapSeconds` | `120` | 与上一可信点间隔超过该值进入 GAP 恢复逻辑。 |
| `impossibleSpeedMetersPerSecond` | `12` | 推算速度超过该值标记为弱证据。 |
| `transportSpeedMetersPerSecond` | `3.5` | 交通风险速度阈值。 |
| `transportMinDistanceMeters` | `20` | 交通风险最小位移阈值。 |

### 静止、低速和恢复门控

| Parameter | Default | Meaning |
| --- | ---: | --- |
| `stationaryDistanceMeters` | `5` | 静止基础距离阈值。 |
| `stationaryAccuracyMultiplier` | `1.5` | 静止阈值会结合当前 accuracy 放大。 |
| `stationaryCloudMinSamples` | `2` | 静止点云最少样本数。 |
| `slowMovementMinDistanceMeters` | `2.5` | 有 motion 支撑时，可接受的低速移动最小距离。 |
| `lowAccuracyRescueMaxAccuracyMeters` | `35` | 低精度连续性救援最大水平精度。 |
| `lowAccuracyRescueMinDistanceMeters` | `2.5` | 低精度连续性救援最小位移。 |
| `continuityRescueMaxSpeedMetersPerSecond` | `6` | 低精度连续性救援最大推算速度。 |
| `recoveryCloudMinSamples` | `2` | GAP 恢复点云稳定所需最少样本。 |
| `recoveryFastPathAccuracyMeters` | `10` | GAP 恢复 fast path 最大精度。 |
| `recoveryFastPathMaxSpeedMetersPerSecond` | `2.5` | GAP 恢复 fast path 最大 reported speed。 |

### 高度门控

| Parameter | Default | Meaning |
| --- | ---: | --- |
| `locationAltitudeAscentMaxVerticalAccuracyMeters` | `20` | GNSS 高度累计允许的最大垂直精度。 |
| `locationAltitudeAscentMinGainMeters` | `1` | GNSS 高度累计上升/下降的最小有效增量。 |
| `locationAltitudeAscentMaxStepGainMeters` | `30` | GNSS 单步高度跳变上限。 |
| `barometerAscentMinGainMeters` | `1` | 无窗口 gain/loss 时，气压高度差最小有效增量。 |
| `barometerAscentMaxSampleGapNanos` | `30_000_000_000` | 气压窗口最大连续间隔。 |
| `barometerAscentMaxVerticalSpeedMetersPerSecond` | `2` | 气压高度最大垂直速度。 |
| `barometerPressureJumpMeters` | `20` | 气压高度跳变阈值。 |

## 基础安全内核

每个 `location_sample` 先进入 intake。当前 Web 会检查：

- 定位来源存在。
- 非 mock location。
- 坐标合法。
- `fixElapsedRealtimeNanos` 存在。
- `horizontalAccuracyMeters` 合法且不超过 intake 上限。
- 同一 session 内 fix 时间不能倒退。
- 同一采样 epoch 内不能重复 fix。
- 如果存在 `samplingEpochId`，必须能匹配采样 epoch。
- fix 时间不能早于对应 sampling epoch 的启动时间。

被 intake 拒绝的点不会进入可信轨迹，但仍保留为诊断证据。

### Intake 具体策略

入口校验按以下顺序执行。任一失败都会生成 `intake_rejected` 诊断点，不进入水平判点。

| Check | Failure reason | Strategy |
| --- | --- | --- |
| 定位来源为空 | `missing_position_source` | `provider/source/sourceKind/trustClass` 至少有一个可解释来源。 |
| mock location | `mock_location` | `isMock/mock/isFromMockProvider` 为 true 时拒绝。 |
| 坐标非法 | `invalid_coordinate` | lat/lng 必须是有效经纬度。 |
| 缺少连续性时间 | `missing_fix_elapsed_realtime` | 必须有 `fixElapsedRealtimeNanos`。 |
| 早于记录开始 | `before_record_start` | 允许 1 秒容差；更早则拒绝。 |
| accuracy 缺失或非法 | `invalid_accuracy` | 水平精度必须是非负数。 |
| accuracy 过大 | `accuracy_too_large` | `horizontalAccuracyMeters > 80m` 拒绝。 |
| 重复 fix | `duplicate_fix` | 同一 fix key 不重复入点云。 |
| 时间倒退 | `out_of_order_fix` | fix 时间必须严格递增。 |
| epoch 不匹配 | `sampling_epoch_mismatch` | 有 `samplingEpochId` 时必须能匹配采样 epoch。 |
| fix 早于 epoch | `sampling_epoch_mismatch` | 允许 1 秒容差；更早则拒绝。 |

## 水平轨迹判断

通过 intake 后，Web 使用相邻可信点做水平轨迹判断。

核心输入：

```text
previous trusted point
current location sample
distanceMeters(previous, current)
dtSeconds from fixElapsedRealtimeNanos
impliedSpeed = distance / dtSeconds
reportedSpeed = speedMetersPerSecond
horizontalAccuracyMeters
recent motion state
```

当前主要结果：

| Result | Meaning |
| --- | --- |
| `anchor` | 可信轨迹锚点。 |
| `accept` | 可信轨迹点。 |
| `weak` | 弱证据，只用于诊断和情景窗口。 |
| `reject` | 不入轨证据，只用于诊断。 |
| `intake_rejected` | 入口契约或硬合法性失败。 |

可信 GPX 和基础距离/运动时间只来自 `anchor` / `accept` 中满足计量门控的点。

### 首点策略

当还没有上一可信点时：

| Condition | Result | Reason | Metric |
| --- | --- | --- | --- |
| `accuracy <= 20m` | `anchor` | `first_fix_good` | 不累计距离和运动时间。 |
| `accuracy <= 30m` | `anchor` | `first_fix_relaxed` | 不累计距离和运动时间。 |
| 其他 | `weak` | `weak_horizontal_accuracy` | 只保留诊断。 |

### 常规移动点策略

有上一可信点时先计算：

```text
distance = distanceMeters(previousTrusted, current)
dtSeconds = (current.fixElapsedRealtimeNanos - previousTrusted.fixElapsedRealtimeNanos) / 1e9
impliedSpeed = distance / dtSeconds
reportedSpeed = current.speedMetersPerSecond
stationaryThreshold = max(stationaryDistanceMeters, accuracy * stationaryAccuracyMultiplier)
```

然后按以下优先级判定：

| Priority | Condition | Result | Reason | Metric |
| ---: | --- | --- | --- | --- |
| 1 | 当前处于 transport recovery 状态 | 进入 transport recovery 子策略 | 见下文 | 见下文 |
| 2 | `dtSeconds > 120` | 进入 GAP recovery 子策略 | 见下文 | GAP 首个恢复点不回填距离/时间 |
| 3 | `distance >= 20m` 且 reported speed `>= 3.5m/s` | `reject` | `transport_risk` | 不入可信指标 |
| 4 | `distance >= 20m` 且无 reported speed 且 `impliedSpeed >= 3.5m/s` | `reject` | `transport_risk` | 不入可信指标 |
| 5 | `distance >= 20m` 且 `impliedSpeed >= 3.5m/s` 但 reported speed `< 3.5m/s` | `weak` | `implied_speed_unconfirmed_by_reported_speed` | 只诊断 |
| 6 | `impliedSpeed > 12m/s` | `weak` | `implied_speed_too_high` | 只诊断 |
| 7 | `accuracy > 30m` 且不满足低精度救援 | `weak` | `weak_horizontal_accuracy` | 只诊断 |
| 8 | `accuracy > 30m` 且满足低精度救援 | `accept` | `continuity_rescue_low_accuracy` | 累计距离/时间 |
| 9 | `distance <= stationaryThreshold` 且 motion 为 walking 且 `distance >= 2.5m` | `accept` | `motion_supported_low_speed` | 累计距离/时间 |
| 10 | `distance <= stationaryThreshold` 且 motion 非 walking | 进入 stationary cloud 子策略 | 见下文 | 见下文 |
| 11 | 其他正常位移 | `accept` | `moving_good_fix` | 累计距离/时间 |

低精度连续性救援要求：

```text
accuracy <= 35m
distance >= 2.5m
impliedSpeed <= 6m/s
```

### GAP Recovery 策略

当与上一可信点间隔超过 `gapSeconds = 120` 秒时，Web 不直接把 GAP 两端距离回填到
里程，而是进入恢复点云。

| Condition | Result | Reason | Metric |
| --- | --- | --- | --- |
| 与恢复点云上一 raw 点形成交通风险 | `accept` | `recovery_transport_suspected_kept` | 新 segment，距离/时间为 0。 |
| `accuracy > 30m` | `weak` | `gap_recovery_pending` | 等待更多恢复证据。 |
| 距上一可信点仍在静止阈值内且 motion 非 walking | `weak` | `gap_recovery_pending` | 不开启新段。 |
| 不满足 fast path 且恢复点云未稳定 | `weak` | `gap_recovery_pending` | 等待点云稳定。 |
| 满足 fast path 或恢复点云稳定 | `accept` | `gap_recovery` | 开启新 segment，距离/时间为 0。 |

GAP fast path 要求：

```text
distance >= stationaryThreshold
accuracy <= 10m
reportedSpeed is null or reportedSpeed <= 2.5m/s
```

恢复点云稳定要求：

```text
sampleCount >= 2
cloudRadiusMeters <= stationaryThreshold
```

### Stationary Cloud 策略

当当前点与上一可信点距离小于静止阈值：

| Condition | Result | Reason | Metric |
| --- | --- | --- | --- |
| 上一可信点已经是 `stationary_anchor` | `reject` | `stationary_anchor_redundant` | 避免重复表达同一停留点。 |
| motion 为 still 且静止点云稳定 | `anchor` | `stationary_anchor` | 距离/时间为 0。 |
| 其他 | `reject` | `stationary_cloud_jitter` | 视为静止漂移。 |

静止阈值：

```text
stationaryThreshold = max(5m, horizontalAccuracyMeters * 1.5)
```

静止点云稳定要求：

```text
sampleCount >= 2
cloudRadiusMeters <= stationaryThreshold
```

### Transport Recovery 策略

如果上一段已经进入交通风险恢复状态：

| Condition | Result | Reason | Metric |
| --- | --- | --- | --- |
| 相对参考点仍满足交通风险 | `reject` | `transport_risk` | 继续拒绝。 |
| `accuracy > 30m` | `weak` | `transport_recovery_pending` | 等待恢复。 |
| 其他 | `accept` | `gap_recovery` | 开启新 segment，距离/时间为 0。 |

## 距离

距离使用 Haversine 球面距离：

```text
distanceDeltaMeters =
  distanceMeters(previousTrusted.lat, previousTrusted.lng, current.lat, current.lng)
```

最终总距离：

```text
totalDistanceMeters =
  sum(trackPoint.distanceDeltaMeters where trackPoint.countsDistance)
```

以下场景通常不累计距离：

- `gap_recovery` 首个恢复点不回填 GAP 距离。
- `stationary_anchor` 不累计距离。
- 交通风险点不进入可信运动指标。
- `weak` / `reject` / `intake_rejected` 不累计距离。

具体计量条件：

```text
trusted = result is anchor or accept
transport = reason is recovery_transport_suspected_kept or transport_suspected_kept

countsDistance =
  trusted
  and distanceDeltaMeters > 0
  and reason != gap_recovery
  and reason != stationary_anchor
  and reason != stationary_drift_anchor
  and not transport
```

可信 GPX 条件略宽于计距条件：

```text
entersTrustedGpx = trusted and not transport
```

因此 `anchor` 可以进入可信 GPX，但通常不贡献距离；`gap_recovery` 可以作为新段起点进入
GPX，但不回填 GAP 两端距离。

## 运动时间

运动时间使用 `fixElapsedRealtimeNanos` 差值：

```text
movingTimeDeltaSeconds =
  max(0, current.fixElapsedRealtimeNanos - previous.fixElapsedRealtimeNanos) / 1_000_000_000
```

最终运动时间：

```text
movingTimeSeconds =
  sum(trackPoint.movingTimeDeltaSeconds where trackPoint.countsMovingTime)
```

`callbackDelayNanos` 不参与运动时间计算。

具体计量条件：

```text
countsMovingTime =
  countsDistance
  and movingTimeDeltaSeconds > 0
```

也就是说，运动时间跟随有效位移计量。静止 anchor、GAP 恢复起点、交通风险、弱点和拒绝点
都不贡献运动时间。

## 配速

配速不是独立采样证据，而是从距离和运动时间推导：

```text
paceSecondsPerKm =
  movingTimeSeconds / (totalDistanceMeters / 1000)
```

如果距离或运动时间不足，则配速不可计算。

## GNSS 累计爬升和累计下降

GNSS altitude 使用 `location_sample.altitudeMeters` 和
`location_sample.verticalAccuracyMeters`。

当前 Web 只对水平可信且正在移动的点累计 GNSS 高度：

```text
trusted horizontal point
  + moving decision
  + verticalAccuracyMeters <= threshold
  + altitudeMeters available
  -> GNSS altitude candidate
```

累计逻辑：

```text
delta = current.altitudeMeters - altitudeAnchorMeters

if delta >= minGain:
  locationAltitudeTotalAscentMeters += delta

if -delta >= minGain:
  locationAltitudeTotalDescentMeters += -delta
```

边界行为：

- 首个可信高度点建立 altitude anchor。
- GAP 恢复、静止 anchor、边界重置会重置 altitude anchor。
- 单步高度跳变过大时拒绝该高度样本，并重置 anchor。
- 水平不可信点不参与 GNSS 高度累计。

具体门控：

| Condition | Result | Reason | Effect |
| --- | --- | --- | --- |
| 缺少 `altitudeMeters` | `unavailable` | `gnss_altitude_missing` | 不参与高度累计。 |
| 水平点不是 `anchor` / `accept` | `rejected` | `horizontal_point_not_trusted` | 不参与高度累计。 |
| 缺少 `verticalAccuracyMeters` | `rejected` | `vertical_accuracy_missing` | 不参与高度累计。 |
| `verticalAccuracyMeters > 20m` | `rejected` | `vertical_accuracy_too_large` | 不参与高度累计。 |
| 当前水平决策不是 moving | `reset` | `gap_recovery_reset` / `stationary_suspended` / `boundary_reset` | 更新高度 anchor，不累计 gain/loss。 |
| 首个 moving 高度点 | `accepted` | `gnss_altitude_anchor` | 建立高度 anchor。 |
| `abs(delta) > 30m` | `rejected` | `gnss_altitude_jump` | 拒绝跳变，重置高度 anchor。 |
| `delta >= 1m` | `accepted` | `gnss_altitude_accepted` | 累计 GNSS ascent。 |
| `-delta >= 1m` | `accepted` | `gnss_altitude_accepted` | 累计 GNSS descent。 |

GNSS 高度置信度：

```text
if acceptedAltitudeSampleCount < 2:
  confidence = none
else if rejectedAltitudeSampleCount == 0:
  confidence = high
else:
  confidence = medium
```

## Barometer 累计爬升和累计下降

`barometer_window` 是独立高度证据。Web 当前优先使用窗口内已计算好的：

```text
windowAscentMeters
windowDescentMeters
```

累计逻辑：

```text
barometerTotalAscentMeters += windowAscentMeters
barometerTotalDescentMeters += windowDescentMeters
```

如果窗口没有提供 `windowAscentMeters` / `windowDescentMeters`，Web 才使用相邻
`avgBarometerAltitudeMeters` 的差值推导上升/下降。

气压计也有基础门控：

- pressure / altitude 必须可用。
- 采样窗口时间不能出现过大的 gap。
- 单步 pressure altitude 跳变不能过大。
- 垂直速度不能超过阈值。

具体门控：

| Condition | Result | Reason | Effect |
| --- | --- | --- | --- |
| 缺少 pressure altitude 或 pressure 非法 | `rejected` | `barometer_unavailable` | 不累计该窗口。 |
| 首个窗口且没有 `windowAscentMeters/windowDescentMeters` | `reset` | `boundary_reset` | 建立气压高度 anchor。 |
| 首个窗口已有 window gain/loss | `accumulating` | `barometer_accumulating` | 直接累计窗口 gain/loss。 |
| 与上一 accepted 窗口间隔 `> 30s` | `reset` | `pressure_sample_gap` | 重置 anchor，不用跨 gap 差值。 |
| `abs(rawDelta) >= 20m` | `rejected` | `pressure_jump_detected` | 拒绝跳变并重置 anchor。 |
| 垂直速度 `> 2m/s` | `rejected` | `pressure_jump_detected` | 拒绝异常窗口。 |
| 存在 `windowAscentMeters/windowDescentMeters` | `accumulating` | `barometer_accumulating` | 优先累计窗口内 gain/loss。 |
| 无窗口 gain/loss 且 `rawDelta >= 1m` | `accumulating` | `barometer_accumulating` | 用相邻 pressure altitude 差值累计上升。 |
| 无窗口 gain/loss 且 `-rawDelta >= 1m` | `accumulating` | `barometer_accumulating` | 用相邻 pressure altitude 差值累计下降。 |

气压计有效输出要求：

```text
acceptedBarometerWindowCount >= 2
```

否则：

```text
barometerTotalAscentMeters = -1
barometerTotalDescentMeters = -1
barometerAscentConfidence = none
```

气压计置信度：

```text
if acceptedBarometerWindowCount < 2:
  confidence = none
else if rejectedBarometerWindowCount == 0:
  confidence = high
else:
  confidence = medium
```

## Selected Ascent / Descent

Web 会分别算出：

```text
locationAltitudeTotalAscentMeters
locationAltitudeTotalDescentMeters
barometerTotalAscentMeters
barometerTotalDescentMeters
```

然后选择最终输出源：

```text
if barometer available and confidence != none:
  selectedAscentSource = BAROMETER
  selectedTotalAscentMeters = barometerTotalAscentMeters
  selectedTotalDescentMeters = barometerTotalDescentMeters
else if GNSS altitude available:
  selectedAscentSource = GNSS
  selectedTotalAscentMeters = locationAltitudeTotalAscentMeters
  selectedTotalDescentMeters = locationAltitudeTotalDescentMeters
else:
  selectedAscentSource = NONE
```

因此累计下降是一等输出，不是由累计爬升或净高度差反推。

## Motion Window 的作用

`motion_window` 不生成经纬度，也不修正经纬度。

它只用于活动语义和门控：

```text
recent motion windows near location sample
  -> walking / still / unknown
```

典型影响：

- 静止点云是否可以成为 `stationary_anchor`。
- 低速位移是否有 motion 支撑。
- 停留漂移是否应剔除。
- GAP 恢复、密集区、同路往返等情景窗口是否有足够上下文。

## 不同情景的集中处理方式

情景层的职责不是替代基础安全内核，而是在基础判点结果上处理局部复杂片段。统一口径：

```text
base decision first
  -> scenario recognizer
  -> local rebuild / diagnostic context
  -> metric ownership settlement
```

也就是说，情景可以压缩、改写、标注或延迟结算局部片段，但不能绕过：

- intake 合法性。
- `fixElapsedRealtimeNanos` 连续性。
- 距离和运动时间门控。
- GNSS altitude 门控。
- barometer gain/loss 门控。
- GAP、pause、transport、pressure jump 等硬边界。

### 情景分组总览

| Group | Scenarios | Main action | Metric impact |
| --- | --- | --- | --- |
| 硬边界和恢复 | `gap_recovery_boundary`, `transport_contamination`, pressure jump | 切断跨边界累计，开启新 segment 或拒绝污染。 | 不跨边界计距离、运动时间、爬升/下降。 |
| 弱恢复和位置跳变 | `weak_recovery_endpoint`, `position_snap_recovery` | 保留真实端点或恢复锚点，弱点作为贡献证据。 | 锚点通常零距离；后续稳定点继续正常计量。 |
| 静止和停留漂移 | `stationary_session_collapse`, `stationary_drift_collapse`, `stationary_anchor` | 压成代表停留点或停留锚点。 | 停留漂移不计距离、运动时间和爬升。 |
| 休息/拍照微移动 | `rest_photo_micro_move` | 小范围低速来回挪动按局部形态压缩或保留少量形状点。 | 避免把休息找路抖动膨胀成里程。 |
| 移动尖刺清理 | `moving_spike_cleanup` | 删除单个侧向回跳点，用前后可信移动点直连。 | 尖刺 raw 保留诊断，不贡献路线指标。 |
| 同路往返/回环 | `same_road_round_trip`, `round_trip_line`, `closed_loop_round_trip` | 同路段中心线化或线形抽稀；纯诊断回环只标注。 | 只保留可解释主形状，避免往返交织制造额外折线。 |
| 密集区主路线 | `dense_area_intent`, `dense_main_route_settlement` | 先判断密集窗口主意图，再保留前进主骨架。 | 主骨架拥有路线/距离/时间，骨架外点作为贡献 raw。 |
| 遮挡聚集 | `enclosed_gap_cluster`, `enclosed_loop_cluster_settlement` | 标注 GAP/stationary 聚集；必要时压缩内部低速碎点。 | 不跨 GAP 计距；内部碎点不重复贡献指标。 |
| 复合候选复核 | `composite_gap_local_settlement` | 候选像往返但证据不足时降级为复核上下文。 | 不抢占指标 owner，不激进改线。 |

### 硬边界和恢复

硬边界情景包括 GAP 恢复、pause/resume、transport contamination 和 pressure jump。
它们的优先级高于大范围几何重建。

处理原则：

- GAP 恢复点可以进入可信 GPX，作为新 segment 的起点。
- GAP 两端距离不回填到里程。
- GAP 两端时间不回填到运动时间。
- GAP 两端 GNSS altitude delta 不累计到爬升/下降。
- transport contamination 不进入徒步距离、运动时间、可信 GPX 或徒步爬升。
- pressure jump 会重置气压高度 anchor，不跨跳变累计 gain/loss。

实现方可以把这类情景理解成“切分器”：它们先把指标连续性切开，再允许边界两侧各自
继续正常计算。

### 弱恢复端点

`weak_recovery_endpoint` 处理的是长 GAP 后的弱信号点云。典型场景是遮挡出口、
洞口、室内外切换或山谷弱恢复：单个点精度不够好，但一小团弱点仍然保留了真实端点
形状。

触发形态：

- 前面存在 GAP 或恢复边界。
- 弱点云样本数足够。
- 点云半径较小。
- 点云距离上一可信点足够远，不像原地漂移。
- 点云中有相对更好的 accuracy。

处理方式：

- 选代表 raw point 或点云中心作为形状锚点。
- 锚点可以进入可信 GPX，解释端点形状。
- 该锚点距离、运动时间和跨边界爬升/下降通常为 0。
- 弱点仍作为 `contributingRawPointIds` 保留，方便复盘。

不能做：

- 不能把弱点云逐点累计成距离。
- 不能跨 GAP 把上一可信点到弱端点的直线距离补进里程。

### 位置跳变恢复

`position_snap_recovery` 处理 GNSS 短时跳到新位置、reported speed 又不足以确认交通的
恢复片段。

触发形态：

- 先出现弱跳变点或位置 snap。
- reported speed 不支持交通污染硬拒绝。
- 后续位置恢复到稳定低速连续性。

处理方式：

- 跳变弱点保留为贡献 raw 或诊断点。
- 恢复锚点可以作为零距离锚点。
- 后续稳定低速点继续按基础内核计距。

指标影响：

- 跳变本身不贡献距离和运动时间。
- 恢复后重新建立可信连续性。

### 整段静止

`stationary_session_collapse` 处理整段 session 基本没动的情况。

触发形态：

- raw 点数量和持续时间足够。
- bbox、net distance 和路径速率都很小。
- reported speed 大多为 0 或很低。
- motion 也支持静止。

处理方式：

- 全段压成一个代表点。
- 原始 raw 全部作为贡献证据或诊断上下文。

指标影响：

- 距离为 0。
- 运动时间为 0。
- GNSS altitude 和 barometer 不用于制造“爬升运动”。

### 局部停留漂移

`stationary_drift_collapse` 处理局部停留期间的一团漂移点。

触发形态：

- 局部 raw 点较多，持续时间足够。
- 核心点云半径小。
- bbox 和 net distance 小。
- reported speed / motion 不支持真实移动。

处理方式：

- 漂移云压成一个停留解释锚点。
- 贡献 raw 被完整记录，避免出现“未解释 raw”。
- 漂移点不作为清洗路线顶点。

指标影响：

- 漂移云不累计距离。
- 漂移云不累计运动时间。
- 漂移云不累计 GNSS 爬升/下降。

### 休息/拍照微移动

`rest_photo_micro_move` 处理小范围内真实低速挪动和定位抖动混在一起的片段，比如休息、
拍照、找路、整理装备。

触发形态：

- track point 数量有限。
- path 有一定长度，但 bbox 和 endpoint distance 较小。
- path/net ratio 较高，说明来回绕。
- duration 不长，或长时间仍限制在小范围内。

处理方式：

- 强休息折返可压成休息锚点。
- 弱微移动优先保留少量形状点。
- 其余小移动通过简化器保留局部形态，而不是逐点累加噪声。

指标影响：

- 明显休息漂移不膨胀里程。
- 被保留的少量形状点才按其重建后的距离/时间计量。
- 与 dense intent 冲突时，局部休息/拍照微移动优先解释自己的小范围片段。

### 移动尖刺清理

`moving_spike_cleanup` 处理连续移动中的单点侧向回跳。

触发形态：

- 前后点构成稳定移动方向。
- 中间点形成明显侧向 detour。
- 中间点 reported speed 不支持真实绕行，或几何上强烈支持尖刺。

处理方式：

- 删除尖刺点作为路线顶点。
- 用前后可信移动点直连。
- 尖刺 raw 作为 suppressed / diagnostic evidence 保留。

指标影响：

- 尖刺不贡献距离和运动时间。
- 桥接后的距离和运动时间由前后可信点重新结算。

### 同路往返

`same_road_round_trip` 处理强同路证据的往返点云交织。

触发形态：

- 有明确往返折返点。
- 起终点接近。
- 往返两侧 cross-track 偏差小。
- approach pair 距离小，说明确实走在同一条窄路上。
- 若缺少 `dense_area_intent(round_trip)`，需要更严格的 bbox、duration 和 sample gap。

处理方式：

- 同路部分压到中心线。
- 保留起点、折返点、终点语义。
- 如果折返点来自弱恢复端点，必须保护端点 raw 坐标，不能被中心线吞掉。

指标影响：

- 避免 3 米内左右交织被算成两条平行路线。
- 不跨长 GAP 复合段直接中心线化。

### 普通往返线形

`round_trip_line` 处理往返形态存在、但不是极窄同路走廊的片段。

触发形态：

- 起点、折返点、终点构成线形往返。
- 起终点接近。
- 折返点距离足够远。
- cross-track 在容忍范围内。

处理方式：

- 做线形抽稀。
- 保留主要形状点，而不是强行压成同一中心线。

指标影响：

- 减少往返锯齿。
- 保留真实往返路径语义。

### 闭合回环诊断

`closed_loop_round_trip` 当前主要是诊断上下文。

触发形态：

- 可信点构成首尾接近的小回环或往返。
- 没有足够强的弱恢复端点或同路证据支撑主动重建。

处理方式：

- 标注回环语义。
- 不直接改写轨迹。

指标影响：

- `metricOwner=false`，只作为解释上下文。
- 可辅助后续 `enclosed_loop_cluster_settlement` 或人工复核。

### 密集区意图判断

`dense_area_intent` 是上层调度情景，不直接改线。

它把密集窗口先分类为：

```text
forward_motion
stationary
round_trip
gap_cluster
mixed
```

处理方式：

- `forward_motion` 支持进入 `dense_main_route_settlement`。
- `stationary` 支持停留漂移或休息微移动策略。
- `round_trip` 支持同路往返/普通往返候选。
- `gap_cluster` 支持遮挡聚集诊断。
- `mixed` 保守处理，更多作为上下文。

指标影响：

- `dense_area_intent` 本身 `metricOwner=false`。
- 它只影响后续 settlement 调度和冲突解释。

### 密集区主路线

`dense_main_route_settlement` 处理密集区域里有明确前进方向，但局部噪声导致路线出现
锯齿、小折返或左右摆动的片段。

触发形态：

- 连续可信移动点数量足够。
- net distance 足够。
- bbox 不过大。
- path/net ratio 表明存在冗余锯齿。
- dense intent 支持 `forward_motion`。

处理方式：

- 提取主前进骨架。
- 骨架外 raw 作为贡献证据保留。
- 允许更小粒度的停留、跳变、遮挡策略继续处理自己的局部范围。

指标影响：

- 主骨架拥有 route / distance / moving_time。
- 不让密集点云逐点膨胀里程。

### 遮挡 GAP 聚集

`enclosed_gap_cluster` 处理小范围内多次 GAP recovery 和 stationary anchor 聚集的片段。

触发形态：

- 多个 GAP recovery。
- 多个 stationary anchor。
- bbox 较小。
- 持续时间和 raw span 足够。
- 常见于山洞/室内/峡谷出口一类遮挡形态，但场景名只描述可观测形态。

处理方式：

- 当前主要作为诊断上下文。
- 标注 anchor、segment、bbox、duration 和重叠 dense intent。

指标影响：

- `metricOwner=false`。
- 不跨 GAP 计距。
- 不跨 GAP 计爬升/下降。

### 遮挡回环聚集压缩

`enclosed_loop_cluster_settlement` 处理遮挡聚集叠加闭合往返时，内部低速碎点和漂移锚点
制造额外折返距离的问题。

触发形态：

- 存在 `enclosed_gap_cluster`。
- 同一范围内又被闭合回环或往返形态包住。
- bbox 小，内部碎点多。
- 进出口走廊相对稳定。

处理方式：

- 只保留贴近进出口走廊的少量锚点。
- 内部碎点并入贡献 raw。
- 输出 `enclosed_loop_anchor_settlement`。

指标影响：

- 内部碎点不累计距离。
- 内部碎点不累计运动时间。
- 内部碎点不累计爬升/下降。

### 交通污染

`transport_contamination` 处理景区车、缆车、电梯、骑行或高速移动混入徒步记录。

触发形态：

- 位移超过交通最小距离。
- reported speed 或 implied speed 超过交通阈值。
- 或恢复期持续表现为交通风险。

处理方式：

- 作为 reject / diagnostic continuity 保留。
- 必要时进入 transport recovery，直到重新稳定。

指标影响：

- 不进入徒步距离。
- 不进入徒步运动时间。
- 不进入可信 GPX。
- 不进入徒步爬升/下降。

### 复合 GAP 局部结算

`composite_gap_local_settlement` 处理“几何上像往返，但语义上可能是长 GAP、多情景拼接”
的候选。

触发形态：

- 形成 `round_trip_line` 或 `same_road_round_trip` 候选几何。
- 缺少 `dense_area_intent(round_trip)`。
- duration 或 sample gap 显示它可能跨越多个局部场景。

处理方式：

- 降级为诊断和复核入口。
- 不主动改线。
- 不抢占弱恢复、GAP、静止、休息微移动等局部策略主解释。

指标影响：

- `metricOwner=false`。
- 不产生大范围 rewrite。

### 情景重叠时的处理

情景窗口可以重叠，但指标 owner 不能冲突。

当前原则：

- 解释可以重叠。
- 不同 metric gate 可以重叠。
- 同一 raw range 的同一个 metric gate 只能有一个 owner。
- 硬边界优先于所有大范围 rewrite。
- 小范围局部清理优先保护自己的点，再让大范围路线 settlement 处理剩余范围。
- `dense_area_intent`、`closed_loop_round_trip`、`enclosed_gap_cluster`、
  `composite_gap_local_settlement` 默认是 context-only，不直接拥有指标。

metric gates 包括：

```text
route
distance
moving_time
elevation
```

典型例子：

- `pressure_jump(elevation)` 可以和 `dense_main_route_settlement(route,distance,moving_time)`
  重叠，因为它们影响不同 gate。
- `rest_photo_micro_move(distance)` 和 `dense_main_route_settlement(distance)` 重叠时，
  需要由 settlement coordinator 切分、降级或选择 owner，不能双算。
- `gap_recovery_boundary` 被大范围 round trip 包住时，大范围候选必须在 GAP 两侧切开，
  不能跨 GAP 补距离。

## 多场景叠加区域的轨迹重建计算

多场景叠加区域是当前策略最需要小心的部分。这里的“重建”分成两件事：

```text
1. 当前 Web 全量算法直接改写 product.track。
2. scenarioSettlementPlan / streaming coordinator 复盘和约束 metric ownership。
```

当前 `acceptance-web` 仍是数组式全量算法，局部重建会直接 mutate `product.track`。
每次发生轨迹改写后，Web 会：

```text
renumberTrackPoints(product)
rebuildRawPointDecisions(product)
```

如果任一 settlement stage 改过轨迹，还会重新计算 GNSS altitude：

```text
recomputeLocationAltitudeAscent(product, evidence, config)
```

因此当前 Web 的实际轨迹结果主要由固定 stage 顺序决定；`scenarioSettlementPlan` 主要用于
把已产生的 `scenarios[]` 转成 proposal，验证和展示 overlap / ownership / commit 规则，
也是 streaming / Rust Core 后续对齐的目标形态。

### 当前全量 Web 的改写顺序

`runSixLayerSettlementPipeline()` 的顺序是：

```text
stationary_session_collapse
  -> moving_spike_cleanup
  -> dense_area_intent
  -> dense_main_route_settlement
  -> stationary_drift_collapse
  -> weak_recovery_shape_preserve
  -> round_trip_line_simplify
  -> interwoven_corridor_simplify
  -> rest_photo_micro_move_simplify
  -> enclosed_loop_cluster_settlement
  -> position_snap_recovery
```

重要含义：

- `stationary_session_collapse` 一旦命中，整段直接压成一个代表点，后续 stage 不再运行。
- 后面的 recognizer 读取的是前面 stage 已经改写后的 `product.track`。
- `dense_area_intent` 本身不改轨迹，但会约束后续 `dense_main_route_settlement`、
  round-trip、遮挡聚集等判断。
- `dense_main_route_settlement` 会先保前进主骨架；之后的停留、弱恢复、往返、微移动、
  遮挡聚集继续在更新后的轨迹上处理局部片段。
- 每个 stage 内部通常会用 non-overlap 选择，避免同一 stage 内多个候选互相覆盖。

这意味着：当前全量 Web 不是“所有场景先同时 proposal，再统一改写轨迹”，而是
“基础内核先产物化，然后按固定 stage 顺序逐步局部重建”。统一 proposal 仲裁是已经落地
在 `scenarioWindowCoordinator` 的目标约束层，但还没有完全替代所有数组式改写。

### 叠加区域的候选选择

同一类场景内部，候选会按分数排序并去重：

```text
candidate sort:
  score desc
  rawRange.start asc

accept candidate if:
  not overlap existing accepted candidate index range
  not overlap blocked existing scenario rawRange
```

作用：

- 同一 stage 里不允许两个 active rebuild 抢同一段 track index。
- 已经被某些连续场景占用的 raw range 可以阻止后续同类候选继续重建。
- 被拒绝的候选通常保留为诊断或 review 证据，而不是直接改线。

局限：

- 这是 stage-local 的保护，不等于全局最优仲裁。
- 真正跨 stage 的指标 ownership 需要 `scenarioSettlementPlan` / streaming coordinator
  继续约束。

### Metric Gates

当前 coordinator 用 metric gate 判断是否冲突：

```text
route
distance
moving_time
elevation
```

如果两个 proposal 的 raw range 重叠，但 affected metric gates 没有交集，它们可以同时
存在。否则必须 active / context / split / reject 之一。

当前 Web 从 `scenario` 映射 gates：

| Scenario | Affected gates |
| --- | --- |
| `gap_recovery_boundary` | `route`, `distance`, `moving_time`, `elevation` |
| `transport_contamination` | `route`, `distance`, `moving_time`, `elevation` |
| `position_snap_recovery` | `route`, `distance`, `moving_time`, `elevation` |
| `moving_spike_cleanup` | `route`, `distance`, `moving_time` |
| `stationary_session_collapse` | `route`, `distance`, `moving_time` |
| `stationary_drift_collapse` | `route`, `distance`, `moving_time` |
| `rest_photo_micro_move` | `route`, `distance`, `moving_time` |
| `enclosed_loop_cluster_settlement` | `route`, `distance`, `moving_time` |
| `weak_recovery_endpoint` | `route` |
| `dense_main_route_settlement` | `route` |
| `same_road_round_trip` | `route` |
| `round_trip_line` | `route` |
| `dense_area_intent` | context-only |
| `closed_loop_round_trip` | context-only |
| `enclosed_gap_cluster` | context-only |
| `composite_gap_local_settlement` | context-only |

注意一个关键细节：当前 Web 的 settlement proposal 层把 `dense_main_route_settlement`、
`same_road_round_trip`、`round_trip_line` 标为 `route` owner，而不是
`distance/moving_time` owner。因为这些路线重建在数组式全量算法里已经改写了
`product.track` 的距离和时间；proposal 层主要用于表达 route ownership 和 streaming
对齐。后续 Rust streaming core 如果让 proposal 成为唯一执行者，需要把这些 local
rebuild 的距离/时间结算一起纳入 proposal 执行。

### Proposal 优先级

当前 coordinator 的默认优先级：

| Priority | Scenarios |
| ---: | --- |
| `10` | `gap_recovery_boundary`, `pause_resume_boundary`, `transport_contamination`, `pressure_jump`, `weak_recovery_endpoint` |
| `20` | `moving_spike_cleanup`, `position_snap_recovery` |
| `25` | `enclosed_loop_cluster_settlement` |
| `30` | `stationary_drift_collapse`, `rest_photo_micro_move` |
| `40` | `dense_main_route_settlement`, `same_road_round_trip`, `round_trip_line` |
| `90` | `dense_area_intent`, `closed_loop_round_trip`, `enclosed_gap_cluster`, `composite_gap_local_settlement` |

排序规则：

```text
hardBoundary first
priority asc
confidence desc
range length asc for cleanup priority <= 20
range length desc for broader route settlement
startRawPointId asc
proposal id asc
```

解释：

- 硬边界最强。
- 点级清理和恢复优先保护小片段。
- 遮挡回环压缩强于普通停留/微移动和大范围路线骨架。
- 大范围路线类 settlement 后置，避免吞掉局部边界或局部清理。
- context-only 情景只作为解释，不抢指标 owner。

### Overlap 关系和计算规则

两个 metric-owning proposal 的 `metricRange` 会被分类：

| Relation | 当前处理 |
| --- | --- |
| `disjoint` | 都可 active。 |
| `adjacent` | 都可 active，但不能跨边界累计。 |
| `nested` | 如果新 proposal 包含已 active blocker，则把新 proposal 切成剩余范围；原 proposal 降为 context。否则新 proposal 降为 context。 |
| `equal` | 后来的 proposal 降为 context。 |
| `partial` | 若不能按 hard boundary 或 nested split 解释，则生成 conflict，使用 conservative fallback。 |
| `crossing` | 不做激进 rewrite，走 conservative fallback / review。 |

嵌套切分的计算方式：

```text
parent.metricRange - containedBlocker.metricRange = remaining active slices
```

例如：

```text
dense_main_route_settlement Raw#100-200
  contains gap_recovery_boundary Raw#145-146

=> active slices:
   Raw#100-144
   Raw#147-200
=> parent proposal becomes context:
   hard_boundary_parent_split
```

这样大范围路线 settlement 可以保留边界两侧安全部分，但不能跨 GAP / transport /
position snap 边界直接重建。

### 当前局部重建如何改轨迹

#### Dense Main Route

`dense_main_route_settlement` 从连续可信移动点中提取主前进骨架。

计算方式：

```text
candidate span
  -> RDP-like simplify by distance tolerance
  -> keep first / last / necessary shape points
  -> replace original span with kept points
```

每个保留点会吸收一组原始 track points：

```text
contributingRawPointIds = raw ids in group
distanceDeltaMeters = distance(previousKept, currentKept)
movingTimeDeltaSeconds = sum(group movingTimeDeltaSeconds)
```

结果：

- route 变成主骨架。
- 距离按骨架点之间距离重新计算。
- 运动时间聚合原 group 的有效运动时间。
- GNSS ascent 会在 pipeline 改线后重新计算。

#### Rest / Photo Micro Move

`rest_photo_micro_move` 对小范围挪动使用三种 rebuild：

```text
rest_photo_micro_move_anchor
rest_photo_micro_move_shape_filter
rest_photo_micro_move_simplifier
```

计算方式：

- anchor：压成一个代表点，距离和运动时间为 0。
- shape filter：保留少量可信形状点，其他 raw 作为 suppressed/contributing evidence。
- simplifier：对小范围形状做抽稀，保留局部形态。

保留点的距离和时间：

```text
simplifiedDistance = distance(previousSimplifiedPoint, currentRepresentative)
aggregateMovingTime = sum(group movingTimeDeltaSeconds)
```

如果该片段和 dense forward intent 冲突，当前会生成：

```text
denseIntentConflicts[]
resolution = prefer_local_rest_photo_micro_move
```

但如果同一范围又被 `enclosed_loop_cluster_settlement` 覆盖，冲突可转为
`review_forward_spine_preferred`，进入 forward spine 复核。

#### Enclosed Loop Cluster

`enclosed_loop_cluster_settlement` 处理遮挡聚集叠加闭合回环。

计算方式：

```text
closed_loop_round_trip candidate contains enclosed_gap_cluster
  -> find kept indexes near entry/exit corridor
  -> keep gap_recovery / stationary_anchor / rest_photo anchor if close to corridor
  -> otherwise choose representative point
  -> replace cluster span with kept anchors
```

每个保留点：

```text
distanceDeltaMeters = 0
movingTimeDeltaSeconds = 0
countsDistance = false
countsMovingTime = false
countsAscentWindow = false
entersTrustedGpx = true
```

结果：

- 内部低速碎点、漂移锚点不再制造额外里程。
- 保留进出口附近少量锚点作为形状解释。
- 原始 raw 通过 `contributingRawPointIds` / `suppressedRawPointIds` 保留。

#### Round Trip / Same Road

`same_road_round_trip` 和 `round_trip_line` 处理往返叠加。

计算方式：

- same-road：同路部分中心线化，保护弱恢复端点 raw 坐标。
- round-trip-line：做线形抽稀，保留起点、折返点、终点和必要形状点。

如果缺少 `dense_area_intent(round_trip)`，并且 duration / sample gap 显示是长 GAP
复合片段，则不主动改线，降级为：

```text
composite_gap_local_settlement
metricOwner = false
```

### Forward Spine Arbitration

密集区 forward intent 和 dense main route settlement 会生成 forward spine candidates。
当前这里更多是 review/arbitration 结果，不一定直接改轨迹。

候选来源：

```text
dense_area_intent(forward_motion)
dense_main_route_settlement
```

重叠关系：

- raw range nested。
- raw range overlap。
- endpoint touch。
- direction delta 大于 45 度时视为 crossing。

同方向可仲裁条件：

```text
directionDeltaDegrees <= 20
```

赢家评分：

```text
score =
  rawCoverageCount
  + denseMainRouteSettlementBonus(40)
  + confidence * 10
  - max(0, pathNetRatio - 1) * 5
```

输出：

- `select`：嵌套候选中选择更强者。
- `merge`：同方向 overlap 可合并理解。
- `review_only`：局部微移动覆盖 forward spine 等冲突，等待复核。

这部分的意义是：在多个 forward-ish 场景叠加时，不让每个 forward window 都独立声称自己
是主路线，而是用覆盖范围、方向一致性、path/net ratio 和是否已有 dense main route
settlement 来选主干。

### 当前策略的核心约束

多场景叠加区域最终要满足：

```text
每个 raw point 可以有多个解释上下文；
每个 raw point 的同一个 metric gate 只能有一个 owner；
硬边界不能被大范围几何重建跨过去；
局部清理优先保护小范围真实问题；
大范围 route settlement 只能处理剩余安全范围；
所有被压缩或删除的点必须保留为 contributing/suppressed raw evidence。
```

这就是当前 Web 对多场景叠加区域的实际计算策略。

## 情景窗口和 Settlement

基础安全内核先给每个 raw point 一个可解释决策。情景识别在其上工作，不能绕过：

- RawPoint / location sample。
- horizontal decision。
- distance / moving time gate。
- GNSS altitude gate。
- barometer gain/loss gate。

情景窗口关注的是局部复杂场景，例如：

- 停留漂移。
- 弱恢复端点。
- 同路往返。
- 遮挡聚集。
- 密集区域方向保持。
- 疑似交通污染。

实时策略不需要把完整 session 全量放进内存才计算。基础处理可以流式进行；只有情景窗口
需要保留有限上下文。真正难点是安全封段和重叠仲裁，相关设计见：

```text
docs/streaming-scenario-window-settlement-plan.md
docs/outdoor-track-v17-conflict-aware-settlement-plan.md
```

## 当前验证覆盖

关键测试：

```text
acceptance-web/tests/diagnosticMap.test.mjs
```

其中 `parseEvidenceJsonl and target product consume platform-neutral evidence v1` 已验证：

- Web 能解析 `outdoor-track-evidence-v1`。
- `location_sample.sampleId` 会进入内部点模型。
- `fixElapsedRealtimeNanos` 会作为连续性时间。
- `motion_window` 会进入 motion summary。
- `barometer_window.windowAscentMeters` 可累计上升。
- `barometer_window.windowDescentMeters` 可累计下降。
- 目标产物能输出：
  - `totalDistanceMeters`
  - `movingTimeSeconds`
  - `locationAltitudeTotalAscentMeters`
  - `locationAltitudeTotalDescentMeters`
  - `barometerTotalAscentMeters`
  - `barometerTotalDescentMeters`
  - `selectedTotalAscentMeters`
  - `selectedTotalDescentMeters`

## 对 watchOS / Rust Core 的要求

watchOS 应直接输出：

```text
outdoor_track_evidence_v1.jsonl
```

必须使用平台中立字段：

```text
location_sample.sampleId
location_sample.fixElapsedRealtimeNanos
location_sample.horizontalAccuracyMeters
location_sample.altitudeMeters
location_sample.verticalAccuracyMeters
location_sample.speedMetersPerSecond
motion_window.*
barometer_window.windowAscentMeters
barometer_window.windowDescentMeters
```

不要输出 Web 内部字段作为长期契约：

```text
raw_location
rawPointId
rawRange
elapsedRealtimeNanos
sourceRawPointId
```

Rust Core 应消费平台中立 input 或由薄 adapter 从 JSONL 转成
`TrackProcessRequest`。核心算法不应识别 watchOS 私有字段，也不应依赖 Android legacy
schema。

## 一句话口径

```text
平台中立 evidence 是跨端契约；
Web 内部 raw 命名只是过渡实现；
计算以 fixElapsedRealtimeNanos 为连续性主时钟；
可信点累计距离和运动时间；
GNSS 与气压计分别累计爬升/下降；
最终优先选择 BAROMETER，缺失时 fallback 到 GNSS。
```
