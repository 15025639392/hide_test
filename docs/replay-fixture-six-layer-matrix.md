# Replay Fixture Six-Layer Matrix

本文定义六层因果模型下的 replay fixture 规划。目标是把真实户外问题变成可复测样本，
验证水平轨迹、运动时间、距离、GNSS 海拔线、气压计高度线和最终爬升选择。

本文是测试设计文档，不改变当前 fixtures 或 replay 期望。

## 输入范围

目标 replay fixtures 不使用 `gnss_snapshot`。允许的证据事件：

```text
session_metadata
config_snapshot optional
sampling_policy
raw_location
device_motion_window
barometer_window
barometer_calibration optional
```

`raw_location` 同时承载：

```text
水平轨迹证据:
  lat / lng / accuracy / speed / elapsedRealtimeNanos

GNSS altitude line:
  altitude / verticalAccuracy / elapsedRealtimeNanos
```

`barometer_window` 单独承载：

```text
BAROMETER altitude line:
  pressureHpa
  rawBarometerAltitudeMeters
  startElapsedRealtimeNanos
  endElapsedRealtimeNanos
```

## 每个 Fixture 的期望维度

每个 fixture 应至少声明或验证：

```text
horizontal decision:
  anchor / accept / weak / reject / intake_rejected

distance:
  distanceDeltaMeters / totalDistanceMeters

moving time:
  movingTimeDeltaSeconds / movingTimeSeconds

GNSS altitude:
  accepted / rejected / reset / suspended / unavailable

BAROMETER altitude:
  accumulating / suspended / reset / rejected / unavailable

settlement:
  selectedAscentSource
  selectedTotalAscentMeters
  trustedGpxPointCount
  segmentCount
  gapCount

scenario recognizer:
  scenarios[]
  scenarioCoverage[]
  action / localRebuild
  anchorRawPointIds
  explained raw range

explanation model:
  primaryExplanation.source = scenario / primitive
  scenarioContexts[]
  primitiveFacts[]
```

## 优先 Fixture 矩阵

| Fixture | 覆盖问题 | 关键期望 |
| --- | --- | --- |
| `open_sky_normal_walk.jsonl` | 开阔地正常徒步 | 水平点 accept；距离、运动时间、GNSS altitude 和 BAROMETER 均正常累计；BAROMETER 优先 |
| `weak_accuracy_no_gnss_snapshot.jsonl` | 不依赖卫星诊断的弱定位 | accuracy 弱导致 weak/reject；不进 trusted GPX；不计距 |
| `stationary_jitter_with_still_motion.jsonl` | 原地静止漂移 | still motion 支持 stationary anchor；距离和运动时间不膨胀 |
| `slow_walk_near_stationary.jsonl` | 慢走、拍照挪步、找路 | 不能仅因小位移吞成静止；walking evidence 可保护慢速移动 |
| `gap_recovery_after_tunnel.jsonl` | 隧道或室内无定位后恢复 | recovery pending 不计距；稳定后 gap_recovery 进 GPX，但 distance/moving/ascent delta 为 0 |
| `pause_then_resume_walk.jsonl` | 休息后继续走 | pause 不计运动时间；恢复后重建连续性，再累计 |
| `transport_then_walk_recovery.jsonl` | 景区车、缆车、电梯或骑行混入 | transport 风险段不计徒步距离、运动时间、徒步爬升；恢复点 reset |
| `weak_recovery_endpoint_cave.jsonl` | 洞内或遮挡端点出现在弱恢复点云中 | `weak_recovery_endpoint` 保留端点锚点；不计距，不清掉端点 |
| `same_road_round_trip_interwoven.jsonl` | 同一路往返误差交织 | `same_road_round_trip` 压成中心线；折返点/洞内端点保留 |
| `stationary_session_collapse.jsonl` | 整段记录基本静止 | `stationary_session_collapse` 输出单代表点；全 raw 被解释 |
| `stationary_drift_cloud.jsonl` | 局部停留漂移云 | `stationary_drift_collapse` 压成停留锚点；不贡献距离 |
| `gnss_altitude_noisy_baro_clean.jsonl` | `Location.altitude` 噪声大，气压计稳定 | GNSS altitude 降置信或拒绝；selected ascent 使用 BAROMETER |
| `baro_pressure_jump_indoor_outdoor.jsonl` | 室内外压力突变 | pressure jump rejected/reset；不把突变算累计爬升 |
| `baro_unavailable_gnss_altitude_ok.jsonl` | 无气压计但 `Location.altitude` 可用 | selected ascent 使用 GNSS |
| `gnss_altitude_missing_baro_ok.jsonl` | `Location.altitude` 缺失，气压计可用 | selected ascent 使用 BAROMETER |
| `both_altitude_unreliable.jsonl` | 两条高度线都不可信 | selected ascent = NONE |

## 最关键的边界样本

优先补齐这些样本，因为它们最容易造成产品指标污染：

```text
gap_recovery_after_tunnel
baro_pressure_jump_indoor_outdoor
transport_then_walk_recovery
slow_walk_near_stationary
gnss_altitude_noisy_baro_clean
```

对应保护目标：

```text
不能跨 GAP 计距。
不能把压力突变算成爬升。
不能把交通工具算进徒步距离、时间或爬升。
不能把真实慢走吞成静止漂移。
不能把 Location altitude 和 barometer altitude 混成一条高度线。
```

## Fixture 事件期望示例

`raw_location` 可以携带逐点期望：

```json
{
  "event": "raw_location",
  "rawPointId": 12,
  "provider": "gps",
  "lat": 29.001,
  "lng": 106.001,
  "accuracy": 8,
  "altitude": 520.4,
  "verticalAccuracy": 6,
  "elapsedRealtimeNanos": 42000000000,
  "expectedHorizontalResult": "accept",
  "expectedHorizontalReason": "moving_good_fix",
  "expectedDistanceDeltaMeters": 4.2,
  "expectedMovingTimeDeltaSeconds": 3.0,
  "expectedGnssAltitudeResult": "accepted"
}
```

`barometer_window` 可以携带窗口期望：

```json
{
  "event": "barometer_window",
  "barometerWindowId": 7,
  "startElapsedRealtimeNanos": 41000000000,
  "endElapsedRealtimeNanos": 42000000000,
  "sampleCount": 10,
  "avgRawBarometerAltitudeMeters": 521.0,
  "deltaRawBarometerAltitudeMeters": 0.7,
  "expectedBarometerResult": "accumulating"
}
```

Session 级期望可以放在 fixture metadata 或 replay report expectation 中：

```json
{
  "expectedTotalDistanceMeters": 1200.0,
  "expectedMovingTimeSeconds": 900,
  "expectedGnssTotalAscentMeters": 85.0,
  "expectedBarometerTotalAscentMeters": 92.0,
  "expectedSelectedAscentSource": "BAROMETER",
  "expectedTrustedGpxPointCount": 320,
  "expectedSegmentCount": 2,
  "expectedGapCount": 1
}
```

## Replay 报告分块

未来 replay 报告应按六层输出：

```text
Sampling:
  epoch count
  callback delay distribution
  integrity errors

Horizontal:
  anchor / accept / weak / reject
  segment changes
  GAP recovery
  stationary jitter
  transport risk

Activity:
  walking / still / pause / recovery / transport-risk coverage

GNSS Altitude:
  accepted / rejected / reset / suspended
  total ascent
  confidence

BAROMETER Altitude:
  accumulating / rejected / reset / suspended
  pressure jump count
  total ascent
  confidence

Settlement:
  scenarios
  trusted GPX point count
  total distance
  moving time
  selected ascent source
  selected ascent
```

## Fixture 更新纪律

- 新增 fixture 应说明覆盖的真实户外问题和六层期望。
- 政策变更导致 replay 输出变化时，必须同步更新文档、fixture、测试和 strategy version。
- 纯文档规划不得修改现有 fixture 期望。
