# 陀螺仪 + GNSS 调研

调研日期：2026-05-18

本文只服务当前 Android 系统 GNSS 徒步记录项目。核心问题不是“能不能融合”，而是“融合结果是否可以进入可信轨迹、可信距离和 GPX”。当前结论：短期只做诊断采集和离线研究，不把陀螺仪/IMU 输出写入正式 `TrackPoint` 决策。

## 一页结论

- 不建议现在把陀螺仪/IMU 融合结果写入 `track.gpx`、`totalDistanceMeters` 或正式 `TrackPoint`。当前项目的纯 `GPS_PROVIDER` 可信口径应保持不变。
- 陀螺仪只能测设备角速度，适合解释“手机是否转动、方向是否快速变化、GNSS 航向是否可疑”，不能单独补位置。真正的 GNSS/INS 需要 IMU、GNSS、时间同步、误差模型和滤波器共同工作。
- 手机徒步场景比车载更难：手机可能拿在手上、放包里、揣口袋、拍照时乱转。设备朝向不等于人的行走方向，陀螺仪证据很容易被误用。
- 推荐第一阶段落地为 `imu_summary` 诊断事件：前台记录服务低频采集 `TYPE_ROTATION_VECTOR` 或 `TYPE_GAME_ROTATION_VECTOR`，必要时采 `TYPE_GYROSCOPE` 聚合指标，并按 `elapsedRealtimeNanos` 与 RawPoint / GNSS snapshot 对齐。
- 可用收益主要在报告和解释：弱信号/GAP 期间设备是否仍在运动、GNSS bearing 是否和设备转向矛盾、静止抖动是否伴随明显手持扰动、交通工具混入是否和 GNSS 质量无关。
- 如果未来要做“补轨迹”，应先作为离线 replay 实验，输出单独的 experimental track，不进入可信 GPX。只有有真实样本、参考轨迹和误差指标后，再讨论策略升级。

## 基础判断

GNSS 和 IMU 的互补关系成立，但前提很硬：

- GNSS 提供绝对位置、速度和时间，低频且受遮挡、多路径、天线和芯片影响。
- 陀螺仪提供高频角速度，短时间响应快，但积分后会受噪声和 bias 漂移影响。
- 加速度计可提供线性运动线索，但手机上需要处理重力分离、手持姿态、步态、口袋摆动和设备坐标系转换。
- 典型 GNSS/INS 会用扩展卡尔曼滤波等方式估计位置、速度、姿态、陀螺仪 bias、加速度计 bias。GNSS 负责约束 IMU 漂移，IMU 负责填补 GNSS 更新间隙。

对当前项目来说，最大风险不是技术不可行，而是把“看起来更平滑”的轨迹误当成“更真实”的轨迹。徒步记录要优先保证可解释和可回放。

## Android 可用数据源

当前仓库已经具备：

- `LocationManager.GPS_PROVIDER`：正式轨迹唯一定位源。
- `GnssStatus`：可见卫星、参与 fix 卫星、C/N0、星座分布。
- `GnssMeasurementsEvent`：UI 层已监听，可作为后续 raw GNSS 离线研究入口。
- `TYPE_ROTATION_VECTOR`：`MainActivity` 已用于 UI heading 展示。

Android 侧可补的 IMU 数据：

| 数据源 | 价值 | 风险 | 建议 |
| --- | --- | --- | --- |
| `TYPE_ROTATION_VECTOR` | 可直接转成 azimuth/pitch/roll，适合 UI heading 和诊断 | 依赖磁场/系统融合，受磁干扰和设备姿态影响 | 第一选择，先低频诊断 |
| `TYPE_GAME_ROTATION_VECTOR` | 不用地磁，短期相对转向更稳 | 不指北，会随陀螺仪漂移 | 适合记录转向变化，不适合绝对航向 |
| `TYPE_GYROSCOPE` | 原始角速度，适合计算转动强度和 yaw rate | 高频耗电、噪声、bias、日志量大 | 开发/诊断模式聚合，不长期逐样本落盘 |
| `TYPE_GYROSCOPE_UNCALIBRATED` | 可拿 bias 估计，便于研究校准 | 厂商差异大，算法复杂 | 暂缓 |
| 加速度计/线性加速度/计步 | PDR 或静止/运动辅助判断 | 手机携带方式影响极大 | 只有进入离线 PDR 实验时再加 |

时间对齐是可行的：`SensorEvent.timestamp` 使用与 `SystemClock.elapsedRealtimeNanos()` 相同的时间基准；`Location.getElapsedRealtimeNanos()` 也可可靠比较定位点的相对顺序。这个条件对把 IMU summary 挂到 RawPoint 诊断上很关键。

## 对当前项目的推荐边界

### 可以做

1. 在 `RecordingForegroundService` 内增加 IMU 诊断采集，只在记录中启用。
2. 用固定窗口聚合传感器事件，不逐条写高频 IMU 原始流。
3. 生成 `imu_summary` 诊断事件，并把最近窗口摘要关联到 RawPoint 或报告生成器。
4. 在弱 GPS 报告里增加 IMU 解释块，回答：
   - GAP 前后手机是否有明显转动或运动扰动。
   - weak/reject 点附近设备方向是否频繁变化。
   - GNSS bearing 与设备 heading / heading delta 是否明显矛盾。
   - transport_suspected 是否主要由速度证据触发，而不是弱信号。
5. 离线 replay 增加 IMU 回放样本（fixture），用真实样本验证解释价值。

### 暂时不要做

- 不要用陀螺仪在 GAP 期间自动补轨迹点。
- 不要用设备 heading 覆盖 GNSS bearing。
- 不要把 IMU stationary 判断做成硬拒绝或硬通过规则。
- 不要把系统 Fused Location、第三方定位 SDK 或自制融合位置混入当前纯 GNSS 可信轨迹。
- 不要在没有参考轨迹前调 Kalman filter 阈值并宣称轨迹更准。

## 诊断事件建议

第一阶段只落聚合字段，控制日志量：

```text
imu_summary
  seq
  sensorTypes
  firstElapsedRealtimeNanos
  lastElapsedRealtimeNanos
  sampleCount
  headingStartDegrees
  headingEndDegrees
  headingDeltaDegrees
  maxAbsHeadingRateDps
  avgAbsGyroNormDps
  maxAbsGyroNormDps
  pitchMinDegrees
  pitchMaxDegrees
  rollMinDegrees
  rollMaxDegrees
  sensorAccuracy
  deviceOrientationStable
```

RawPoint 关联方式：

```text
raw_location.elapsedRealtimeNanos
  -> 最近 3 秒内 GNSS snapshot
  -> 最近 3 秒内 imu_summary
```

这里的 IMU 只做解释字段，命名上应避免 `trusted`、`corrected`、`fused` 等暗示它已经能改写正式轨迹的词。

## 采样建议

初始参数保守一点：

| 场景 | 传感器 | 采样 | 落盘 |
| --- | --- | ---: | --- |
| 正式记录默认 | `TYPE_ROTATION_VECTOR` 或 `TYPE_GAME_ROTATION_VECTOR` | 5-10 Hz | 1 秒聚合一次 |
| 弱信号/GAP 诊断 | 同上，可临时提高 | 10 Hz | 1 秒聚合一次 |
| 开发实验 | `TYPE_GYROSCOPE` | 10-20 Hz | 只落聚合，必要时短时 raw |
| 离线算法研究 | rotation vector + gyro + accel/step | 10-50 Hz | 单独 experimental log |

注意事项：

- `samplingPeriodUs` 只是 hint，实际事件可能更快或更慢。
- 可用 `maxReportLatencyUs` 让硬件 FIFO 批量上报，减少功耗，但要记录真实 `SensorEvent.timestamp`，不能用收到事件的时间替代。
- Android 12+ 对部分传感器存在速率限制，当前项目 `targetSdk 36`，应按系统实际能力做降级。
- IMU 采集跟随前台记录服务生命周期，停止记录后必须注销 listener。

## 可能收益

对当前徒步项目，陀螺仪+GNSS 的收益更像“诊断显微镜”，不是“轨迹修复器”：

- 弱信号解释更完整：同样是 bad point，可以区分遮挡、多路径、系统采样断档、用户拿手机剧烈转动。
- GAP 恢复更可解释：恢复点前后若 IMU 显示大量扰动，可提示这段不应计入可信距离。
- 交通工具混入更好解释：GNSS 质量很好但速度/距离明显超过徒步范围时，报告可说明这不是弱 GPS 问题。
- UI heading 可以更稳定：当前 UI 已有 rotation vector heading，可继续保留为展示辅助。
- 为后续离线 PDR/INS 实验攒真实样本，不影响主链路稳定性。

## 主要风险

- 漂移：陀螺仪积分误差会随时间积累，GNSS 中断越久，单靠 IMU 推算越不可信。
- 姿态不等于行走方向：手机被横拿、放包里、拍照、挥手，都会让设备 heading 偏离路线方向。
- 地磁干扰：`TYPE_ROTATION_VECTOR` 的绝对方位可能受周边金属、车辆、建筑、电器影响。
- 功耗和日志量：高频传感器会增加 CPU 唤醒、日志写入和电池消耗。
- 厂商差异：不同手机的传感器精度、融合实现、原始 GNSS 字段支持差异很大。
- 误导用户：平滑或连续的实验轨迹容易给人“更准”的错觉，必须和可信 GPX 分开。

## 推荐落地路线

### 第一阶段：IMU 诊断采集

目标：只采证据，不改判点。

```text
SensorManager
  -> ImuDiagnosticBuffer
  -> imu_summary diagnostic event
  -> raw_location nearest imu summary
  -> weak GNSS report / sample report
```

验收：

- 记录 30-60 分钟徒步时日志量可控。
- `imu_summary` 能按 `elapsedRealtimeNanos` 和 RawPoint 对齐。
- replay 兼容没有 IMU 字段的历史回放样本（fixture）。
- 可信距离、GPX、判点 reason 不变。

### 第二阶段：报告解释

目标：把 IMU 变成可读结论。

- GAP 前后 30 秒的 heading delta / gyro norm。
- weak/reject 点附近的设备扰动统计。
- GNSS bearing 与 IMU heading delta 的一致/矛盾提示。
- 静止抖动是否伴随设备运动。

### 第三阶段：离线实验

目标：验证是否值得做融合，不进入主链路。

- 输入：`evidence.jsonl` + `imu_summary` + 可选 raw GNSS + 参考 GPX。
- 输出：`experimental_imu_gnss_report.txt` 和单独实验轨迹。
- 指标：相对参考轨迹的横向误差、GAP 后恢复误差、静止段误累计、弱信号段误判率、电量和日志体积。

### 第四阶段：再决定是否升级策略

只有满足这些条件才考虑让 IMU 影响主链路：

- 至少覆盖户外开阔、林下、峡谷/楼群、静止休息、交通工具混入等真实样本。
- 有参考轨迹或人工标注，能证明误差下降且 false positive 不上升。
- replay 回放样本（fixture）覆盖无 IMU、低质量 IMU、手机乱转、GAP、弱 GNSS 等情况。
- UI 和导出清楚区分“可信 GNSS 轨迹”和“实验融合轨迹”。

## 资料来源

- Android Motion Sensors: https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion
- Android Position Sensors: https://developer.android.com/develop/sensors-and-location/sensors/sensors_position
- Android `SensorEvent`: https://developer.android.com/reference/android/hardware/SensorEvent
- Android `SensorManager`: https://developer.android.com/reference/android/hardware/SensorManager
- Android `Location`: https://developer.android.com/reference/android/location/Location
- Android `GnssStatus`: https://developer.android.com/reference/android/location/GnssStatus
- Android `GnssMeasurement`: https://developer.android.com/reference/android/location/GnssMeasurement
- Android Raw GNSS Measurements: https://developer.android.com/develop/sensors-and-location/sensors/gnss
- Google GPS Measurement Tools: https://github.com/google/gps-measurement-tools
- VectorNav GNSS/INS Primer: https://www.vectornav.com/resources/inertial-navigation-primer/theory-of-operation/theory-gpsins
- NovAtel GNSS Inertial Navigation Systems: https://novatel.com/products/gnss-inertial-navigation-systems
