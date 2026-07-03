# Platform-Neutral Evidence JSONL Contract

本文定义跨 Android、watchOS、iOS、鸿蒙和后续 SDK 统一使用的轨迹证据
JSONL 契约。它描述的是**落盘证据格式**，不是某个平台的原生对象，也不是
Web 内部临时 normalize 结构。

本文不改变当前 Android v3 `evidence.jsonl`、replay 期望或策略阈值。现有
Android schema 是 legacy platform schema；新采集端和跨平台转换工具应逐步输出
本文定义的 platform-neutral schema。

## 目标

目标是让所有端最终产出同一种证据数据：

```text
Android Location / SensorEvent
watchOS CLLocation / CoreMotion / CMAltimeter
iOS CLLocation / CoreMotion / CMAltimeter
Harmony location / sensors
  -> outdoor_track_evidence_v1.jsonl
  -> Web / replay / SDK / 离线验收 / 多设备对齐
```

平台差异只能存在于采集 adapter 内：

```text
Platform native object
  -> Platform Adapter
  -> Platform-Neutral Evidence JSONL
  -> OutdoorTrackEvidenceEngine
```

Web、replay fixture、Rust SDK 和验收工具不应长期识别每个平台自己的字段别名。
watchOS / iOS 的持久化证据产物也应直接是 `outdoor-track-evidence-v1` JSONL；
`CLLocation`、CoreMotion 和 `CMAltimeter` 字段名只存在于 adapter 内部或诊断扩展，
不形成另一套长期 watchOS evidence schema。

## 非目标

- 不把卫星数量、C/N0、星座、used-in-fix 纳入目标产品算法输入。
- 不用气压计修正经纬度。
- 不用 motion 生成或补全经纬度。
- 不把平台实时判点结果写回原始证据。
- 不要求旧 Android session 迁移为新 schema；旧 session 可通过 adapter 读取。

## 文件与版本

推荐文件名：

```text
outdoor_track_evidence_v1.jsonl
```

每行是一个 JSON object。所有事件共享字段：

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schemaVersion` | string | yes | 固定为 `outdoor-track-evidence-v1`。 |
| `event` | string | yes | 事件类型。 |
| `sessionId` | string | yes | 记录会话 id。 |
| `eventSeq` | long | yes | session 内单调递增事件序号。 |
| `eventWallTimeMillis` | long | yes | 写入事件时的墙钟时间。 |
| `eventElapsedRealtimeNanos` | long | yes | 写入事件时的单调时间。 |

`eventElapsedRealtimeNanos` 只表示事件写入/生成时间。Location 连续性必须使用
`fixElapsedRealtimeNanos`。

## 事件总览

| Event | Purpose |
| --- | --- |
| `session_metadata` | 会话、设备、策略、平台和测试分组上下文。 |
| `sampling_policy` | 请求侧采样状态、功耗模式、暂停/恢复和传感器窗口配置。 |
| `location_sample` | 系统定位 fix 的平台中立证据。 |
| `motion_window` | 低频 motion/step 摘要，用于活动门控和诊断。 |
| `barometer_window` | 气压/压力高度窗口，包含累计上升和累计下降。 |
| `barometer_calibration` | 气压高度绝对显示校准，不改写历史累计。 |
| `session_event` | pause、resume、finish、power change、app recovery 等生命周期事件。 |
| `evidence_manifest` | evidence 文件完整性和传输校验。 |

事件不得写入最终策略标签，例如 `walking`、`vehicle`、`should_accept`、
`should_reject`、`trusted_gpx`。这些是目标算法输出，不是采集证据。

## 时间语义

平台中立契约使用三类时间：

| Field | Scope | Notes |
| --- | --- | --- |
| `wallTimeMillis` | sample/event | 系统墙钟时间，用于人类复盘和跨文件粗排序。 |
| `fixElapsedRealtimeNanos` | location only | 定位 fix 发生的单调时间，是 GAP、速度、segment、运动时间和 GNSS altitude 连续性的唯一时间。 |
| `eventElapsedRealtimeNanos` | all events | 事件写入或窗口结束附近的单调时间，用于 JSONL 顺序和事件对齐。 |

Android adapter:

```text
fixElapsedRealtimeNanos = Location.getElapsedRealtimeNanos()
```

watchOS / iOS adapter:

```text
fixElapsedRealtimeNanos = estimatedFixElapsedRealtimeNanos
estimatedFixElapsedRealtimeNanos =
  (sessionUptimeStartSeconds + location.timestamp - sessionWallStart) * 1_000_000_000
```

`receivedElapsedRealtimeNanos` 和 `callbackDelayNanos` 只用于诊断展示，不能替代
`fixElapsedRealtimeNanos` 做连续性判断。

## `session_metadata`

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "session_metadata",
  "sessionId": "session-uuid",
  "eventSeq": 1,
  "eventWallTimeMillis": 1760000000000,
  "eventElapsedRealtimeNanos": 123000000000,
  "createdWallTimeMillis": 1760000000000,
  "createdElapsedRealtimeNanos": 123000000000,
  "strategyVersion": "outdoor-track-evidence-v1",
  "platform": "watchOS",
  "platformVersion": "11.0",
  "appVersion": "0.1",
  "deviceManufacturer": "Apple",
  "deviceModel": "Apple Watch",
  "deviceClass": "watch",
  "routeId": "route-uuid",
  "routeVersion": 1,
  "testBatchId": "optional-batch",
  "completionState": "ACTIVE"
}
```

隐私规则：不得写硬件序列号、Apple ID、Android ID、广告 ID、手机号、账号、
系统唯一设备标识。需要多设备验收时，使用 App 内生成且可重置的匿名设备 id。

## `sampling_policy`

`sampling_policy` 是请求侧证据，不能从定位点反推。它应在 start、pause、resume、
finish、功耗模式变化、定位请求重配和传感器窗口重配时写入。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "sampling_policy",
  "sessionId": "session-uuid",
  "eventSeq": 2,
  "eventWallTimeMillis": 1760000000000,
  "eventElapsedRealtimeNanos": 123000000000,
  "samplingEpochId": 1,
  "state": "MOVING_STANDARD",
  "locationProvider": "gnss",
  "desiredAccuracyMeters": 10,
  "requestedMinTimeMs": 1000,
  "requestedMinDistanceMeters": 5,
  "allowsBackgroundLocationUpdates": true,
  "motionWindowSeconds": 10,
  "barometerWindowSeconds": 10,
  "powerMode": "standard"
}
```

推荐 `state`：

```text
MOVING_STANDARD
MOVING_POWER_SAVE
MOVING_LOW_POWER
MOVING_CRITICAL_POWER
PAUSED
RECOVERY
FINISHED
```

采样变稀可能是主动功耗策略，不一定是定位异常。目标算法可以使用这些字段解释
GAP、低频点和传感器窗口缺失，但不能用 callback 接收时间替代 fix 时间。

## `location_sample`

每个系统定位 fix 写一条 `location_sample`。平台 adapter 应把平台原生无效值转为
`null`，而不是保留平台哨兵值。例如 `CLLocation.speed < 0` 应写 `null`。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "location_sample",
  "sessionId": "session-uuid",
  "eventSeq": 12,
  "eventWallTimeMillis": 1760000005000,
  "eventElapsedRealtimeNanos": 128000000000,
  "sampleId": 7,
  "provider": "gnss",
  "lat": 29.123456,
  "lng": 106.123456,
  "horizontalAccuracyMeters": 8.5,
  "altitudeMeters": 520.3,
  "verticalAccuracyMeters": 12.0,
  "speedMetersPerSecond": 1.2,
  "bearingDegrees": 35.0,
  "wallTimeMillis": 1760000004980,
  "fixElapsedRealtimeNanos": 127980000000,
  "receivedElapsedRealtimeNanos": 128000000000,
  "callbackDelayNanos": 20000000,
  "samplingEpochId": 1,
  "isMock": false
}
```

字段归属：

| Field | Line | Notes |
| --- | --- | --- |
| `lat` / `lng` | horizontal | 水平轨迹证据。 |
| `horizontalAccuracyMeters` | horizontal | 水平定位精度，缺失或负数应视为无效 sample。 |
| `altitudeMeters` | GNSS elevation | 系统定位海拔线，不属于气压计。 |
| `verticalAccuracyMeters` | GNSS elevation | 判断 GNSS elevation 是否可用。 |
| `speedMetersPerSecond` | horizontal/activity | 系统 reported speed；缺失时由点间速度估计。 |
| `bearingDegrees` | horizontal | 系统 course/bearing；缺失时不强行推断。 |
| `fixElapsedRealtimeNanos` | continuity | 连续性主时钟。 |

## `motion_window`

`motion_window` 是活动门控证据。它只提供窗口统计，不写高频 IMU 原始流，不生成经纬度。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "motion_window",
  "sessionId": "session-uuid",
  "eventSeq": 30,
  "eventWallTimeMillis": 1760000010000,
  "eventElapsedRealtimeNanos": 133000000000,
  "windowId": 3,
  "startElapsedRealtimeNanos": 128000000000,
  "endElapsedRealtimeNanos": 133000000000,
  "accelerometerDynamicRmsMps2": 0.18,
  "accelerometerDynamicMaxMps2": 0.72,
  "linearAccelerationRmsMps2": null,
  "linearAccelerationMaxMps2": null,
  "gyroscopeRmsRadps": 0.04,
  "gyroscopeMaxRadps": 0.21,
  "yawDeltaDegrees": null,
  "pitchDeltaDegrees": null,
  "rollDeltaDegrees": null,
  "stepCounterDelta": 7,
  "stepDetectorCount": null,
  "sampleCount": 120,
  "powerMode": "standard"
}
```

采集端可以缺少部分字段。读取端必须容忍 `null`，并基于已有字段给出 activity
confidence。

## `barometer_window`

`barometer_window` 是独立的 BAROMETER elevation line。它不绑定单个
`location_sample`，不修正经纬度，也不替代 GNSS altitude。

平台中立字段统一使用 `barometerAltitudeMeters` 语义。Android 的标准大气压高度、
watchOS/iOS 的相对高度都必须在 adapter 内归一化为同一组字段，并通过
`altitudeReference` 表明参考系。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "barometer_window",
  "sessionId": "session-uuid",
  "eventSeq": 31,
  "eventWallTimeMillis": 1760000010000,
  "eventElapsedRealtimeNanos": 133000000000,
  "windowId": 3,
  "startElapsedRealtimeNanos": 128000000000,
  "endElapsedRealtimeNanos": 133000000000,
  "sampleCount": 5,
  "altitudeReference": "relative_session",
  "startBarometerAltitudeMeters": 0.2,
  "endBarometerAltitudeMeters": 1.6,
  "minBarometerAltitudeMeters": 0.2,
  "maxBarometerAltitudeMeters": 1.6,
  "avgBarometerAltitudeMeters": 0.9,
  "deltaBarometerAltitudeMeters": 1.4,
  "windowAscentMeters": 1.4,
  "windowDescentMeters": 0.0,
  "sessionBarometerAscentMeters": 18.6,
  "sessionBarometerDescentMeters": 7.4,
  "startPressureHpa": 954.4,
  "endPressureHpa": 954.2,
  "minPressureHpa": 954.2,
  "maxPressureHpa": 954.4,
  "avgPressureHpa": 954.3,
  "lastSensorAccuracy": null,
  "powerMode": "standard"
}
```

`altitudeReference` 推荐值：

| Value | Meaning |
| --- | --- |
| `relative_session` | 相对会话起点高度，例如 `CMAltimeter.relativeAltitude`。 |
| `standard_atmosphere` | 由气压按标准大气模型换算的 raw altitude。 |
| `calibrated_display` | 已加显示校准 offset 的高度；只能用于展示，不应用于改写历史累计。 |

`windowAscentMeters` 和 `windowDescentMeters` 是必需的一等证据。它们表示窗口内
按有效相邻样本累计的上升和下降，不等同于窗口首尾差。

```text
窗口样本: 100m -> 105m -> 100m
deltaBarometerAltitudeMeters = 0m
windowAscentMeters = 5m
windowDescentMeters = 5m
```

读取端在 `windowAscentMeters` / `windowDescentMeters` 存在时应优先使用它们；
只有 legacy 数据缺失这两个字段时，才可退回窗口间高度差估算，并在结果中降低
confidence。

## `barometer_calibration`

校准只影响绝对高度展示，不重写相对累计上升/下降历史。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "barometer_calibration",
  "sessionId": "session-uuid",
  "eventSeq": 40,
  "eventWallTimeMillis": 1760000020000,
  "eventElapsedRealtimeNanos": 143000000000,
  "calibrationId": 1,
  "source": "gnss",
  "rawBarometerAltitudeMeters": 10.2,
  "referenceAltitudeMeters": 520.3,
  "calibrationOffsetMeters": 510.1,
  "pressureSampleElapsedRealtimeNanos": 142900000000,
  "referenceLocationSampleId": 18
}
```

## `session_event`

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "session_event",
  "sessionId": "session-uuid",
  "eventSeq": 50,
  "eventWallTimeMillis": 1760000030000,
  "eventElapsedRealtimeNanos": 153000000000,
  "type": "pause",
  "reason": "user",
  "samplingEpochId": 2,
  "powerMode": "standard"
}
```

推荐 `type`：

```text
start
pause
resume
finish
power_mode_changed
app_recovered
location_reconfigured
sensor_unavailable
evidence_upload_started
evidence_upload_completed
```

## `evidence_manifest`

`evidence_manifest` 用于传输和完整性检查，不参与轨迹判点。

```json
{
  "schemaVersion": "outdoor-track-evidence-v1",
  "event": "evidence_manifest",
  "sessionId": "session-uuid",
  "eventSeq": 99,
  "eventWallTimeMillis": 1760000100000,
  "eventElapsedRealtimeNanos": 223000000000,
  "fileName": "outdoor_track_evidence_v1.jsonl",
  "eventCount": 98,
  "byteSize": 123456,
  "sha256": "hex-encoded-sha256",
  "completionState": "FINISHED"
}
```

## 输出结果命名

目标算法输出应从 ascent-only 扩展为 elevation gain/loss 双向结果：

```text
GnssElevationResult:
  totalAscentMeters
  totalDescentMeters
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

BarometerElevationResult:
  totalAscentMeters
  totalDescentMeters
  sampleCount
  rejectedSampleCount
  confidence
  primaryRejectedReasons[]

SelectedElevationResult:
  source = BAROMETER / GNSS / NONE
  totalAscentMeters optional
  totalDescentMeters optional
  confidence
  reason
```

产品可以只展示累计爬升，但底层证据和算法结果必须保留累计下降。下降用于路线复盘、
交通/电梯/缆车污染诊断、闭合路线合理性检查和压力突变排查。

当前 Web 原型已在 `acceptance-web/src/sixLayerTrackProduct.mjs` 接入：

- `location_sample` -> 内部 RawPoint，使用 `fixElapsedRealtimeNanos` 做连续性时间。
- `motion_window` -> 内部 motion summary，参与活动门控。
- `barometer_window.windowAscentMeters/windowDescentMeters` -> BAROMETER gain/loss。
- `GnssAltitudeResult`、`BarometerAscentResult`、`SelectedAscentResult` 均保留
  `totalDescentMeters`。

## Legacy 字段映射

完整三端 adapter 映射规则见：

```text
docs/platform-adapter-field-mapping.md
docs/platform-adapter-field-mapping.v1.json
```

Android v3 legacy `evidence.jsonl` 到 platform-neutral schema 的最小映射：

| Legacy event/field | Neutral event/field |
| --- | --- |
| `raw_location` | `location_sample` |
| `rawPointId` | `sampleId` |
| `provider=gps` | `provider=gnss` |
| `accuracy` | `horizontalAccuracyMeters` |
| `altitude` | `altitudeMeters` |
| `verticalAccuracy` | `verticalAccuracyMeters` |
| `speed` | `speedMetersPerSecond` |
| `bearing` | `bearingDegrees` |
| `elapsedRealtimeNanos` | `fixElapsedRealtimeNanos` |
| `callbackReceivedElapsedRealtimeNanos` | `receivedElapsedRealtimeNanos` |
| `device_motion_window` | `motion_window` |
| `deviceMotionWindowId` | `windowId` |
| `barometerWindowId` | `windowId` |
| `avgRawBarometerAltitudeMeters` | `avgBarometerAltitudeMeters` |
| `deltaRawAltitudeMeters` | `deltaBarometerAltitudeMeters` |

watchOS/iOS adapter 最小映射：

| Platform field | Neutral event/field |
| --- | --- |
| `CLLocation.timestamp` | `wallTimeMillis` |
| `estimatedFixElapsedRealtimeNanos` | `fixElapsedRealtimeNanos` |
| `CLLocation.horizontalAccuracy` | `horizontalAccuracyMeters` |
| `CLLocation.altitude` | `altitudeMeters` |
| `CLLocation.verticalAccuracy` | `verticalAccuracyMeters` |
| `CLLocation.speed >= 0` | `speedMetersPerSecond` |
| `CLLocation.course >= 0` | `bearingDegrees` |
| `CMAltimeter.relativeAltitude` window stats | `*BarometerAltitudeMeters`, `altitudeReference=relative_session` |
| `CMAltimeter.pressure` in kPa | `*PressureHpa = kPa * 10` |

## Versioning Rules

- 新字段必须 backward compatible；读取端必须忽略未知字段。
- 删除或重命名字段需要升到 `outdoor-track-evidence-v2`。
- 策略阈值变化不自动改变 evidence schema version。
- 如果 evidence schema 变化导致 replay 期望变化，必须同一变更更新文档、fixture、
  测试和 strategy version。
- 平台 adapter 可以保留原始平台诊断文件，但目标算法和标准 replay fixture 只能读取
  platform-neutral evidence。
