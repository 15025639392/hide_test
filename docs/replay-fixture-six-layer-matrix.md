# Replay Fixture Six-Layer Matrix

本文定义六层因果模型下的 replay fixture 规划。目标是把真实户外问题变成可复测样本，
验证清洗轨迹、总里程、累计爬升、累计下降、GNSS 海拔线、气压计高度线和最终高度源选择。

本文是测试设计文档，不改变当前 fixtures 或 replay 期望。Rust core 当前迁移范围只要求
轨迹清洗、累计爬升、累计下降和总里程；运动时间可以作为既有字段参与回归校验，但不是
本轮产品指标迁移目标。

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
| `same_road_round_trip_interwoven.jsonl` | 同一路往返误差交织 | 强同路证据下 `same_road_round_trip` 压成中心线；折返点/洞内端点保留 |
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

## 当前真实样本覆盖

Web regression 已把本机可用的真实 session 纳入六层验收：

| Session | 测试文件 | 覆盖问题 | 已固化期望 |
| --- | --- | --- | --- |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `acceptance-web/tests/realEvidenceRegression.test.mjs` | dense rest、小移动、moving spike、composite round-trip guard、closed-loop diagnostic、mixed loop cluster | `rest_photo_micro_move` 休息段不计距；`moving_spike_cleanup` 删除尖刺；`composite_gap_local_settlement` 只进入 context report 且保留 rejection reason / same-road evidence；`closed_loop_round_trip` 只作为 diagnostic context；mixed loop cluster 距离有界 |
| `0ddf2d35-02e2-454c-9057-667265fe8a71` | `acceptance-web/tests/realEvidenceRegression.test.mjs` | stationary drift cloud | 本机存在该 session 时，验证局部漂移云压成单个 `stationary_drift_anchor` |

## 当前 Rust Core Fixture 覆盖

`track-rs/fixtures/` 是 Rust core 的最小回归样例，当前已覆盖：

| Fixture | 覆盖问题 | 当前校验重点 |
| --- | --- | --- |
| `normal-3-points.json` | 正常 GNSS 徒步 | 可信点、总里程、segment |
| `invalid-positioning-source.json` | 非法 provider | intake reject，不进可信轨迹 |
| `mock-point.json` | mock 样本 | intake reject |
| `invalid-lat-lon.json` | 非法经纬度 | intake reject |
| `bad-accuracy.json` | accuracy 过差 | reject / weak 解释 |
| `duplicate-elapsed-time.json` | 时间不连续 | reject |
| `empty-after-filter.json` | 全部被过滤 | 空轨迹稳定返回 |
| `gap-recovery-fast-path.json` | GAP 后稳定恢复 | 新段锚点归零，不跨 GAP 计距 |
| `gap-recovery-pending-low-accuracy.json` | GAP 后低精度恢复等待 | weak pending，不计距 |
| `gap-recovery-stable-cloud.json` | GAP 恢复点云稳定 | 恢复锚点 |
| `transport-risk-reported-speed.json` | 交通工具风险 | reject，不进入徒步总里程 |
| `moving-spike-line-bridge.json` | 移动单点尖刺 | 桥接清洗，总里程按桥接线计算 |
| `position-snap-recovery-anchor.json` | 定位跳变恢复 | 恢复点归零 |
| `stationary-session-collapse.json` | 整段静止 | 单代表点，总里程为 0 |
| `stationary-drift-collapse.json` | 停留漂移云 | 局部锚点压缩 |
| `weak-recovery-shape-anchor.json` | 弱恢复端点 | 弱点云代表锚点，保持新段边界 |
| `rest-photo-micro-move-anchor.json` | 休息/拍照微移动 | 微移动压缩，不污染总里程 |
| `dense-main-route-settlement.json` | 密集区主路线 | 主路线骨架抽稀，总里程按骨架计算 |
| `round-trip-line-settlement.json` | 往返线形 | 折返点保留，往返线形抽稀 |
| `gnss-ascent-descent.json` | GNSS 高度可用 | 累计爬升/累计下降 |
| `barometer-ascent-descent-priority.json` | 气压计高度可用 | BAROMETER 优先于 GNSS |

已在 Rust core 实现、但还缺独立端到端 fixture 的清洗点：

| 清洗点 | 当前证据 | 需要补的 fixture |
| --- | --- | --- |
| `same_road_round_trip` 中心线压缩 | Rust 单元测试校验 `round_trip_interwoven_*` 清洗点被压到中心线；fixture verifier 已支持 `expected.trackPoints[]` 坐标校验 | 同路往返端到端 ProcessRequest，校验中心线坐标和折返点保留 |
| `enclosed_loop_cluster_settlement` 遮挡回环压缩 | Rust 单元测试覆盖 settlement helper 行为 | 端到端 evidence / ProcessRequest，校验 start/anchor/end 和总里程归零/有界 |

## 当前 Android legacy fixture 覆盖

`acceptance-web/tests/androidReplayFixtures.test.mjs` 会读取
`app/src/test/resources/replay-fixtures/*.jsonl`，验证这些 Android legacy fixture 可以被
平台中立 Web 目标函数消费。测试不把旧 `expectedResult` / `expectedReason` 当成 Web
目标策略真相，而是验证跨端必须一致的指标不变量：

| Fixture | 覆盖问题 | Web 平台中立期望 |
| --- | --- | --- |
| `good_walk.jsonl` | 正常徒步 | 两个可信点；第二点计距和计运动时间 |
| `weak_start_cloud.jsonl` | 起点弱定位 | 不进入可信轨迹；不计距、不计运动时间 |
| `gap_recovery_after_stationary_gap.jsonl` | 长 GAP 后恢复 | `gap_recovery` 开新 segment；distance / moving time delta 为 0 |
| `stationary_recovery_after_gap.jsonl` | 静止 GAP 后恢复等待 | 恢复点保持 weak pending；不产生成品距离或运动时间 |
| `transport_mode.jsonl` | 疑似交通工具混入后恢复 | transport raw 被 reject；徒步距离/运动时间不累计；恢复点作为 GAP boundary 归零 |
| `stationary_recovery_with_motion.jsonl` | 有运动证据的慢恢复 | 保留移动点并正常计距、计运动时间 |

这些真实样本不是 replay 的全部覆盖。下一批仍需补齐：

```text
weak GPS / weak recovery
long GAP after tunnel or indoor
rest recovery with resume
same-road round trip with stronger true route labels
transport contamination with explicit walk recovery
```

真实样本进入 regression 时，除了最终 track / distance / moving time 外，还必须检查
`streamingDiagnosticContexts`，确保 diagnostic-only context 保留证据但不拥有指标。

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
