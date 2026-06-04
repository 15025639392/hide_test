# Track SDK Core 边界

Track SDK Core 的目标是输出清洗后的成品轨迹，而不是输出一个面向用户解释的
情景报告。Rust Core 是 Web 策略研究成果的跨端执行层，不是策略研究层。

```text
OutdoorTrackInput -> CleanedTrackResult
```

## SDK Core 负责什么

SDK Core 负责消费标准化证据并产出运动结果：

- 可信 TrackPoint 序列。
- TrackPoint 方向角，正北为 `0` 度，顺时针递增。
- 成品轨迹 segments。
- 总里程。
- 运动时间。
- 配速。
- 累计爬升。
- GPX 导出所需的可信点。
- 必要的内部清洗记录和 debug 诊断。
- 执行已经由 Web 端验证并固化的清洗规则。

## SDK Core 不负责什么

SDK Core 不直接负责：

- 清洗算法研究。
- 情景规则试错。
- 阈值调参。
- 样本复核判断。
- 地图可视化解释。
- Android / iOS / 鸿蒙定位 API。
- 高德 SDK 或其他第三方定位 SDK。
- 权限申请。
- 后台服务、前台通知、保活。
- 传感器注册。
- 地图展示。
- UI 交互。
- 账号、云同步、社交分享。

这些由 App 或平台 Adapter 负责。

算法研究和规则收敛由 Web 端负责；Rust Core 只承接明确的规则规格、fixture 和验收
口径。

## 数据流边界

外层采集器负责把平台数据转成标准化 evidence：

```text
高德 / 系统 GPS / CoreLocation / 鸿蒙定位
  -> Platform Adapter
  -> NormalizedLocationSample
  -> Track SDK Core
```

运动传感器和气压计同理：

```text
平台传感器
  -> Platform Adapter
  -> NormalizedMotionWindow / NormalizedBarometerWindow
  -> Track SDK Core
```

## 情景的角色

情景不是普通 App 的主输出。它是内部清洗算子或 settlement 依据。
情景的识别、拆分、合并和阈值研究应先在 Web 端完成；Rust Core 只实现已经定稿的
清洗动作。

例如：

| 内部情景 | 对成品轨迹的作用 |
| --- | --- |
| `stationary_drift_collapse` | 把停留漂移压成锚点。 |
| `moving_spike_cleanup` | 删除单点尖刺，用前后正常点短接。 |
| `gap_recovery_boundary` | GAP 后接回，但距离和运动时间置 0。 |
| `same_road_round_trip` | 同路往返收成稳定中心线。 |
| `enclosed_loop_cluster_settlement` | 遮挡回环压成锚点或短连接。 |
| `transport_contamination` | 排除非徒步移动。 |

普通 App 默认只关心：

```text
CleanedTrackResult
```

验收、回放和 Web 复核才关心：

```text
CleanedTrackDebugResult
```

## Public Result 和 Debug Result

建议将普通输出和调试输出分开：

```text
CleanedTrackResult:
  trackPoints[]
  segments[]
  gpxTrackPoints[]
  summary:
    totalDistanceMeters
    movingTimeSeconds
    paceSecondsPerKm optional
    ascentMeters

CleanedTrackPoint:
  trackPointId
  sourceRawPointId
  latitude
  longitude
  trackDirectionDegrees optional
  distanceDeltaMeters
  movingTimeDeltaSeconds
  segmentId

CleanedTrackDebugResult:
  cleanedTrack
  rawPointDecisions[]
  cleaningOperations[]
  rejectedRawPoints[]
  scenarioCoverage[] optional
  replayDiagnostics
```

`scenarioCoverage` 可以保留在 debug 层，用于复核和 replay 对齐，但不应成为普通 App
理解轨迹结果的前置概念。
