# Platform Adapter Field Mapping Contract

本文定义 Android、watchOS / iOS、鸿蒙采集 adapter 到平台中立
`outdoor-track-evidence-v1` 的字段映射。它补的是“端侧怎么产出同一种 evidence”，不是
新算法，也不是 Web 复核格式。

配套机器可读版本：

```text
docs/platform-adapter-field-mapping.v1.json
```

## 核心结论

- 各端 adapter 的输出必须是同一份 `outdoor-track-evidence-v1`，目标 engine 不长期识别
  平台私有字段。
- watchOS 的持久化轨迹证据输出就是 `outdoor-track-evidence-v1`。Swift / watchOS
  可以在 adapter 内部使用 `CLLocation`、CoreMotion 和 `CMAltimeter` 原生字段名，但落盘、
  review queue、replay fixture 和 Rust Core 输入不能再定义另一套 watchOS 私有 evidence
  schema。
- `fixElapsedRealtimeNanos` 是位置连续性主时钟；GAP、速度、segment、运动时间、GNSS
  elevation 连续性和情景窗口排序都用它。
- `eventElapsedRealtimeNanos` 是事件写入时间，只能用于 JSONL 顺序、事件对齐和诊断。
- Android 的 `elapsedRealtimeNanos` 与 watchOS / iOS 的
  `estimatedFixElapsedRealtimeNanos` 不是同一个原生字段；它们在 adapter 映射后都落到
  neutral `fixElapsedRealtimeNanos`，因此具有同一算法语义。
- `receivedElapsedRealtimeNanos` / `callbackDelayNanos` 只解释回调延迟，不能替代 fix
  时间，也不能作为硬拒绝门槛。
- `windowAscentMeters` 与 `windowDescentMeters` 都是一等证据，不能只保留净高度差。
- GNSS 质量、授权状态、provider 状态、adapter clock quality 等只能作为诊断扩展，不能
  直接变成 route truth。

## 时间字段

| Neutral field | 语义 | Android legacy | watchOS / iOS | Harmony |
| --- | --- | --- | --- | --- |
| `wallTimeMillis` | 人类复盘墙钟时间 | `Location.getTime()` / legacy time | `CLLocation.timestamp` | 平台 location wall time |
| `fixElapsedRealtimeNanos` | location fix 发生时的单调时间 | `Location.getElapsedRealtimeNanos()` / legacy `elapsedRealtimeNanos` | adapter 估算的 `estimatedFixElapsedRealtimeNanos` | 原生 monotonic fix time；缺失时由 adapter 估算 |
| `eventElapsedRealtimeNanos` | JSONL 事件写入时间 | 写入 raw evidence 时的 monotonic time | adapter 写入事件时的 monotonic time | adapter 写入事件时的 monotonic time |
| `receivedElapsedRealtimeNanos` | 回调到达时间 | callback received monotonic time | adapter callback monotonic time | adapter callback monotonic time |
| `callbackDelayNanos` | 回调延迟诊断 | `received - fix` | `received - fix` | `received - fix` |

`estimatedFixElapsedRealtimeNanos` 的推荐生成方式：

```text
estimatedFixElapsedRealtimeNanos =
  sessionMonotonicStartNanos
  + (locationWallTimeMillis - sessionWallStartMillis) * 1_000_000
```

如果平台能提供原生 monotonic fix time，应优先使用原生值。估算值必须保留在 adapter
内部或 diagnostic extension 中；标准 evidence 只暴露 `fixElapsedRealtimeNanos`。

## Location Sample 映射

| Neutral field | Android legacy | watchOS / iOS | Harmony | 规则 |
| --- | --- | --- | --- | --- |
| `provider` | `gps -> gnss` | adapter source | adapter source | 可信轨迹优先 `gnss`；非 GNSS 来源不能伪装成 GNSS。 |
| `sampleId` | `rawPointId` | adapter sequence | adapter sequence | session 内稳定递增。 |
| `lat` / `lng` | latitude / longitude | coordinate | coordinate | 必须是有限 WGS84 合法坐标。 |
| `horizontalAccuracyMeters` | `accuracy` | `horizontalAccuracy` | horizontal accuracy | 必须非负；缺失或负数为无效 sample。 |
| `altitudeMeters` | `altitude` | `altitude` | altitude | GNSS elevation line，可缺失。 |
| `verticalAccuracyMeters` | `verticalAccuracy` | `verticalAccuracy` | vertical accuracy | 负数或不可用写 `null`。 |
| `speedMetersPerSecond` | `speed` | `speed` | reported speed | 负数或不可用写 `null`。 |
| `bearingDegrees` | `bearing` | `course` | bearing / course | 归一到 `[0, 360)`；不可用写 `null`。 |
| `samplingEpochId` | `SamplingEpoch.id` | adapter sampling epoch | adapter sampling epoch | 采样请求归因必须来自请求侧，不从点反推。 |
| `isMock` | Android mock flag | adapter test/mock flag | adapter test/mock flag | mock/test 点必须显式保留证据。 |

## Motion Window 映射

`motion_window` 是低频摘要，不输出高频 IMU 原始流，不生成或修正经纬度。

| Neutral field | Android legacy | watchOS / iOS | Harmony |
| --- | --- | --- | --- |
| `windowId` | `deviceMotionWindowId` | adapter window sequence | adapter window sequence |
| `startElapsedRealtimeNanos` | window start monotonic | adapter monotonic start | adapter monotonic start |
| `endElapsedRealtimeNanos` | window end monotonic | adapter monotonic end | adapter monotonic end |
| `accelerometerDynamicRmsMps2` | motion summary | CoreMotion summary | motion sensor summary |
| `gyroscopeRmsRadps` | motion summary | CoreMotion summary | motion sensor summary |
| `stepCounterDelta` | step counter delta | pedometer / motion summary | step counter delta |

缺失的 motion 字段写 `null`，不得用 `0` 伪装。`0` 表示真实测得为零。

## Barometer Window 映射

| Neutral field | Android legacy | watchOS / iOS | Harmony | 规则 |
| --- | --- | --- | --- | --- |
| `altitudeReference` | `standard_atmosphere` 或 adapter 声明 | `relative_session` | `relative_session` 或 `standard_atmosphere` | 说明高度参考系。 |
| `startBarometerAltitudeMeters` | raw altitude stats | CMAltimeter relative altitude | pressure altitude stats | 窗口统计。 |
| `endBarometerAltitudeMeters` | raw altitude stats | CMAltimeter relative altitude | pressure altitude stats | 窗口统计。 |
| `deltaBarometerAltitudeMeters` | `end - start` | `end - start` | `end - start` | 只代表净变化。 |
| `windowAscentMeters` | 正向相邻高度差累计 | 正向相邻高度差累计 | 正向相邻高度差累计 | 必须输出。 |
| `windowDescentMeters` | 负向相邻高度差绝对值累计 | 负向相邻高度差绝对值累计 | 负向相邻高度差绝对值累计 | 必须输出。 |
| `sessionBarometerAscentMeters` | session 累计上升 | session 累计上升 | session 累计上升 | 可用于诊断。 |
| `sessionBarometerDescentMeters` | session 累计下降 | session 累计下降 | session 累计下降 | 可用于诊断。 |

示例：

```text
100m -> 105m -> 100m
deltaBarometerAltitudeMeters = 0
windowAscentMeters = 5
windowDescentMeters = 5
```

## Diagnostic Extension 边界

各平台可以额外输出诊断字段，但不能让目标 engine 依赖平台私有字段：

| 类别 | 例子 | 口径 |
| --- | --- | --- |
| GNSS quality | satellite count、used-in-fix、C/N0、constellation stats | 解释弱信号，不能直接变成 route truth。 |
| 权限/状态 | authorization、provider status、sensor availability | 解释缺样和 GAP。 |
| adapter clock | clock quality、estimated fix drift | 解释时间估算质量。 |
| 平台测试 | mock/test source、simulator flag | 证据保留，但不进入可信轨迹。 |

如果未来要把某类诊断升级为策略输入，必须同时更新 evidence contract、engine contract、
replay fixture、测试和 strategy version。

## Adapter 输出验收

每个平台 adapter 的最小验收清单：

1. 能输出 `session_metadata`、`sampling_policy`、`location_sample`。
2. 有气压计时必须输出 `barometer_window.windowAscentMeters` 和
   `barometer_window.windowDescentMeters`。
3. `fixElapsedRealtimeNanos` 对同一 session 中有效 location sample 单调不倒退。
4. `eventElapsedRealtimeNanos` 不参与 GAP、速度、运动时间或 elevation 连续性。
5. 负数 speed / course / vertical accuracy 等平台无效值写 `null`。
6. 被拒绝点、弱信号点、mock/test 点仍保留 raw evidence。
7. 不写平台账号、设备序列号、广告 ID、Android ID、Apple ID、手机号或不可重置硬件 id。

## 给端侧 AI 的最低要求

端侧实现 adapter 时，应先实现并测试机器可读映射：

```text
docs/platform-adapter-field-mapping.v1.json
```

目标平台可以保留自己的临时调试日志，但 watchOS / iOS / 鸿蒙的持久化证据产物、目标
engine、review queue、replay fixture 和 SDK 验收只能依赖 `outdoor-track-evidence-v1`。
