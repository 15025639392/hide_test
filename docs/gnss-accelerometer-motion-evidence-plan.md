# GNSS + 加速度计静止证据 MVP

设计日期：2026-05-18

本文是收敛后的第一版方案。目标很小：**当系统已经判出 `stationary_jitter` / `stationary_keepalive` 时，用加速度计补充“设备接近静止”的证据，帮助解释休息点附近 GPS 漂移。**

第一版只做诊断和报告，不改变 `TrackDecisionEngine` 的 `result` / `reason`，不改变 `track.gpx`，不改变可信距离。

## 当前最小目标

```text
GPS 位置小范围变化
+ 现有规则已判为 stationary_jitter / stationary_keepalive
+ 加速度计显示设备接近静止
=> 报告中标记 stationary_supported_by_accel
```

这版不解决“GPS 跳出休息点 20m/30m 是否要 reject”。那是后续策略升级，不进入 MVP。

## 保留

- 在 `RecordingForegroundService` 记录期间采集加速度计。
- 新增 `AccelerometerMotionSampler`，把最近 1 秒传感器样本聚合成 `motion_summary`。
- 只计算最少指标：
  - `sampleCount`
  - `dynamicAccelRmsMps2`
  - `stillScore`
  - `isDeviceStill`
- `BasicTrackSession` 写入 `motion_summary` 诊断事件。
- 报告统计 `stationary_jitter` / `stationary_keepalive` 是否有最近静止证据。

## 延后

- `RestPointDetector`
- `rest_candidate` / `rest_confirmed` / `rest_exit_candidate`
- `restAnchor`
- `rest_event`
- `restRadiusMeters`
- `restDriftSuspectRadiusMeters`
- `restConsistency`
- `motionClass`
- `motionScore`
- `jerkP95`
- 新增 `reject / rest_gnss_drift_suspected`

## 删除出第一版

第一版不做这些事：

- 不识别完整休息点状态机。
- 不判断用户是否离开休息点。
- 不用加速度计接受或拒绝任何 GNSS 点。
- 不在非 stationary 决策中使用加速度计。
- 不用加速度计补点、补距离或修 GPX。

## 数据流

```text
SensorEvent
  -> AccelerometerMotionSampler
  -> motion_summary diagnostic event
  -> report 关联 stationary decision
```

主判点链路保持不变：

```text
LocationManager.GPS_PROVIDER
  -> RawPoint
  -> LocationValidator
  -> TrackDecisionEngine
  -> TrackPoint / GPX / distance
```

## 传感器选择

| 优先级 | Sensor | 用法 |
| --- | --- | --- |
| 1 | `TYPE_LINEAR_ACCELERATION` | 直接计算动态加速度强度 |
| 2 | `TYPE_ACCELEROMETER` | 用 `abs(norm(x,y,z) - 9.80665)` 近似动态加速度 |

第一版不接 `TYPE_STEP_DETECTOR`。

## 指标计算

动态加速度：

```text
TYPE_LINEAR_ACCELERATION:
  dynamicAccel = norm(x, y, z)

TYPE_ACCELEROMETER:
  dynamicAccel = abs(norm(x, y, z) - GRAVITY_EARTH)
```

1 秒窗口内计算：

```text
dynamicAccelRmsMps2 = sqrt(mean(dynamicAccel^2))
stillScore = clamp01(1 - dynamicAccelRmsMps2 / 0.30)
isDeviceStill = sampleCount >= 5 && stillScore >= 0.7
```

这些阈值只用于诊断，不作为判点硬规则。

## 诊断事件

新增 `motion_summary`：

```json
{
  "event": "motion_summary",
  "motionSummaryId": 1,
  "firstElapsedRealtimeNanos": 1000000000,
  "lastElapsedRealtimeNanos": 2000000000,
  "sampleCount": 10,
  "dynamicAccelRmsMps2": 0.08,
  "stillScore": 0.73,
  "isDeviceStill": true,
  "sourceSensorType": "TYPE_LINEAR_ACCELERATION"
}
```

第一版不要求 `raw_location` 新增 motion 字段。报告生成器可以按时间查找最近 3 秒内的 `motion_summary`。

## 报告解释

报告只新增一类解释：

```text
stationary_supported_by_accel
```

触发条件：

```text
decision.reason in [stationary_jitter, stationary_keepalive]
+ 最近 3 秒内存在 motion_summary
+ isDeviceStill = true
```

报告建议输出：

```text
- stationary 决策总数
- 有加速度计静止证据的 stationary 决策数
- stationarySupportedByAccelRatio
- 缺少 motion_summary 的 stationary 决策数
```

解释文案：

```text
部分 stationary_jitter / stationary_keepalive 同时具备设备静止证据，
说明这些 GNSS 小范围变化更像休息或静止时的定位漂移，不应累计距离。
```

## 实施顺序

1. 新增 `AccelerometerMotionSampler`，只负责 1 秒窗口聚合。
2. 在 `RecordingForegroundService` 注册/注销加速度计 listener。
3. 在 `BasicTrackSession` 增加 `onMotionSummary`，写 `motion_summary`。
4. 更新 `docs/diagnostic-jsonl-schema.md`，记录 `motion_summary` 字段。
5. 在样本报告里统计 `stationary_supported_by_accel`。

## 验收标准

- 没有加速度计时 App 不崩溃。
- 旧 replay fixture 的 `result` / `reason` 全部不变。
- `stationary_filter.jsonl` 判点结果不变。
- 手机静放 5-10 分钟时，报告能看到较高 `stationarySupportedByAccelRatio`。
- 正常步行时，不因为加速度计逻辑改变任何 GPX 或距离。

## 测试计划

单元测试：

- `AccelerometerMotionSamplerTest`
  - 静止样本输出 `isDeviceStill=true`。
  - 明显振动样本输出 `isDeviceStill=false`。
  - 样本不足输出 `isDeviceStill=false`。
  - `TYPE_ACCELEROMETER` fallback 正确扣除重力幅值。
- 报告测试
  - `stationary_jitter` + 最近 still summary 统计为 supported。
  - `stationary_keepalive` + 最近 still summary 统计为 supported。
  - 缺少 motion summary 时报告正常且计入缺失数。
- Replay 测试
  - 所有旧 fixture 判点不变。

真机样本：

| 样本 | 预期 |
| --- | --- |
| 手机静放 5-10 分钟 | stationary 决策多数有静止证据 |
| 原地拿手机轻微操作 | stillRatio 下降，但不改变判点 |
| 正常步行 | 不影响 GPX 和距离 |

## 后续升级条件

只有 MVP 证明加速度计静止证据稳定后，才考虑下一阶段：

- 自动识别休息点。
- 建立 `restAnchor`。
- 标记休息点外跳点候选。
- 评估是否新增 `rest_gnss_drift_suspected`。

这些都不是第一版内容。
