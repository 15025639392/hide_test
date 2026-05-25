# Outdoor Track Six-Layer Evidence Model

本文定义真实户外徒步轨迹清洗的六层因果模型。它服务平台中立的目标函数：

```text
采样样本数据 -> 可信轨迹 / 累计爬升 / 里程 / 配速 / 运动耗时 / 诊断解释
```

本文是策略设计文档，不改变当前 Android v3 行为、阈值、replay 期望或
`evidence.jsonl` schema。

场景识别器、局部重建器和诊断输出的落地规则见
`docs/outdoor-track-scenario-recognizers.md`。

## 目标

- 用跨平台可观测证据解释真实户外轨迹表现。
- 将水平轨迹、`Location` 海拔和气压计高度拆成清晰的独立证据线。
- 为后续平台中立函数、replay fixtures 和样本报告提供统一语言。
- 在不依赖 `gnss_snapshot` 的前提下解释弱定位、GAP、静止漂移、交通工具混入和累计爬升。

## 非目标

- 不使用 `gnss_snapshot` 作为目标算法输入。
- 不使用卫星数量、C/N0、星座分布或 used-in-fix 信息做判点。
- 不把气压计高度当作地形模型。
- 不用气压计修正经纬度。
- 不用运动传感器生成或补全经纬度。
- 不把 `callbackDelayNanos` 作为轨迹判点硬门槛。

## 六层模型

| 层 | 关注点 | 可观测证据 | 输出解释 |
| --- | --- | --- | --- |
| 1. 天空/大气层 | GNSS 观测变差、`Location` 海拔噪声、气压基线漂移、天气压力变化 | `accuracy`、fix 缺失、GAP、`altitude`、`verticalAccuracy`、pressure trend | 水平观测弱、高度观测弱、气压趋势异常 |
| 2. 场景传播层 | 密林、山谷、城市峡谷、隧道、室内外、水面或金属反射造成的观测后果 | raw 点发散、跳点、弱点集中、GAP 集中、恢复跳变 | 点云发散、局部漂移、恢复不稳定 |
| 3. 设备采样层 | 设备、系统、采样请求、回调、传感器可用性 | `SamplingEpoch`、`sampling_policy`、`callbackDelayNanos`、session 完整性、motion/barometer 可用性 | 采样连续、采样中断、回调延迟、传感器缺失 |
| 4. 水平轨迹层 | 经纬度轨迹是否可信、是否连续、是否符合徒步移动 | lat/lng、accuracy、dt、距离、隐含速度、点云半径、segment | anchor、accept、weak、reject、gap recovery、transport risk |
| 5. 垂直高度层 | 高度变化如何解算，GNSS 海拔线和气压计高度线分别是否可信 | `Location.altitude` + `verticalAccuracy`；`barometer_window` + pressure altitude | GNSS ascent、BAROMETER ascent、reset、suspended、confidence |
| 6. 活动与产品结算层 | 徒步、静止、休息、恢复、交通工具，以及最终产品值 | `device_motion_window`、水平 decision、边界状态、高度线结果 | GPX、距离、运动时间、配速、selected ascent、每点解释 |

前两层描述外界原因在数据中的表现，但目标算法只直接读取可观测证据。没有地图、DEM 或人工标签时，算法不应直接输出“山谷”“密林”“城市峡谷”等场景标签。

## 双高度线

垂直高度层必须拆成两条独立证据线：

```text
GNSS altitude line:
  来源 = Location.getAltitude()
  时间 = raw_location.elapsedRealtimeNanos
  可信条件 = 水平 fix 可信 + verticalAccuracy 可接受 + 垂直变化物理合理
  用途 = 无气压计时的保守累计爬升兜底、气压计绝对高度校准参考、异常对照

BAROMETER altitude line:
  来源 = Sensor.TYPE_PRESSURE + pressure altitude
  时间 = SensorEvent.timestamp / barometer_window start/end
  可信条件 = 压力样本连续 + 变化速率合理 + 非压力突变 + 活动门控打开
  用途 = 有气压计设备上的主累计爬升来源
```

关键边界：

```text
Location altitude 不修正气压计累计爬升历史。
气压计高度不反推水平经纬度。
selected ascent 只是展示主结果，不覆盖 GNSS 和 BAROMETER 两条原始高度结果。
```

## 证据权限

| 证据线 | 能做 | 不能做 |
| --- | --- | --- |
| 水平轨迹 | 决定可信 TrackPoint、segment、距离和运动时间候选 | 不能累计爬升 |
| GNSS altitude | 计算 GNSS 高度线爬升、做气压计校准参考和异常对照 | 不能替代气压计主爬升，不能修正经纬度 |
| BAROMETER altitude | 计算压力高度线相对爬升 | 不能证明地形，不能生成 TrackPoint |
| Motion | 解释 walking、still、pause、transport risk，控制活动门 | 不能凭空补轨迹点 |
| SamplingEpoch | 解释采样归因和连续性 | 不能用 callback 接收时间替代 fix 测量时间 |

## 门控模型

结算层使用门控统一出产品结果：

```text
horizontalGate       -> 是否进入可信轨迹
gpxGate              -> 是否进入 trusted GPX
distanceGate         -> 是否累计水平距离
movementGate         -> 是否累计运动时间
gnssAscentGate       -> 是否累计 Location altitude 爬升
barometerAscentGate  -> 是否累计 pressure altitude 爬升
```

典型规则：

| 水平结果 | 活动状态 | GPX | 距离 | 运动时间 | GNSS ascent | BAROMETER ascent |
| --- | --- | --- | --- | --- | --- | --- |
| `anchor` | any | yes | no | no | reset/hold | hold |
| `accept / moving` | walking | yes | yes | yes | maybe | maybe |
| `stationary_anchor` | still | yes | no | no | no/reset | no/hold |
| `gap_recovery` | recovery | yes | no | no | reset | reset |
| `weak` | any | no | no | no | no | no/hold |
| `reject` | any | no | no | no | no | no/hold |
| `transport_risk` | transport | risk/diagnostic | no | no | suspended | suspended |

GAP recovery 可以保持产品轨迹视觉连续，但它的 `distanceDeltaMeters`、`movingTimeDeltaSeconds` 和跨边界 ascent delta 必须为 0。
transport risk 是否保留在展示连续线或导出诊断线中，由产品/export 策略决定；
它不能进入徒步距离、运动时间或徒步爬升真值。

## Reason 命名原则

在没有 `gnss_snapshot` 的目标算法中，reason 只能描述可观测现象：

```text
可以使用:
  weak_horizontal_accuracy
  local_scatter_high
  gap_detected
  recovery_cloud_unstable
  implied_speed_too_high
  vertical_accuracy_too_large
  pressure_jump_detected
  activity_gate_closed

不应使用:
  low_cn0
  few_satellites
  bad_satellite_geometry
  multipath_confirmed
```

真实场景原因可以在人工复盘中讨论，但算法和 replay 期望应保持可观测、可复现。

## 场景识别器

六层模型允许在基础判点之后输出稳定的 `scenarios[]`，用于解释局部重建为什么发生。
场景识别器不能替代逐点 decision，也不能绕过距离、运动时间、GPX 和高度门控。
Web 六层算法会将主场景解释写入 `primaryExplanation`，把同一点命中的复合场景写入
`scenarioContexts[]`，并用 `scenarioCoverage[]` 把情景投影到清洗点区间和 raw 区间。
底层判点拆成 `primitiveFacts`，这样用户优先看到场景语言，基础 reason 只作为安全内核和
复测证据保留。

当前 Web 六层算法已落地的稳定场景：

| 场景 | 作用 |
| --- | --- |
| `weak_recovery_endpoint` | 保留长 GAP 后弱点云中的真实端点或洞内端点。 |
| `same_road_round_trip` | 将同一路往返交织误差压成中心线，同时保留端点。 |
| `closed_loop_round_trip` | 标注首尾接近、路径明显展开的普通闭合往返或回环。 |
| `round_trip_line` | 对非极窄同路的往返线形做保守抽稀。 |
| `dense_area_intent` | 对定位点密集窗口先判断 `forward_motion / stationary / round_trip / gap_cluster / mixed`，作为后续 settlement 调度依据。 |
| `dense_main_route_settlement` | 对定位点密集且存在明确前进方向的区域，先保主路线骨架，再交给局部情景修复。 |
| `enclosed_gap_cluster` | 标注小范围内多次 GAP recovery 和静止锚点聚集的遮挡片段。 |
| `stationary_session_collapse` | 将整段静止 session 压成单个代表锚点。 |
| `stationary_drift_collapse` | 将局部停留漂移点云压成一个停留锚点。 |
| `rest_photo_micro_move` | 标注拍照、休息、找路时的小范围来回挪动。 |
| `gap_recovery_boundary` | 解释 GAP 恢复点是零距离、零运动时间的边界重置。 |
| `transport_contamination` | 标注交通工具或高速移动混入，不计入徒步真值。 |

V16.1 中 `dense_area_intent` 是上层调度诊断：`forward_motion` 已用于约束
`dense_main_route_settlement`；`stationary` 和 `round_trip` 会写入对应停留/往返
场景 evidence 作为支撑信号。目标输出同时包含 `denseAreaSettlementPlan[]`，
用于复盘每个密集窗口的计划 settlement、调度优先级和实际命中的具体场景，但暂不
强制阻断原有场景识别。`rest_photo_micro_move` 对 2 分钟以上、bbox/path 都很小的
拍照休息片段，允许把约 12m 内首尾净距视作近静止微移动并塌成休息锚点。

V17 准备方向是冲突感知 settlement 仲裁：情景识别器先提交候选解释，再由统一
settlement 层决定塌缩、抽稀、保留端点、隔离交通或只输出复盘冲突。V17.0 先做
review-only 结构和真实样本验收清单，不默认扩大改线范围。计划见
`docs/outdoor-track-v17-conflict-aware-settlement-plan.md`。

详细触发证据、局部重建动作和测试要求见
`docs/outdoor-track-scenario-recognizers.md`。

## 不变量

- 每个系统 `Location` 必须先成为 `RawPoint` 并写入 `raw_location` 证据。
- intake rejected 只保留 raw evidence，不生成 TrackPoint。
- weak/reject 不进入 trusted GPX，不计距离，不计运动时间。
- GAP recovery 进入 trusted GPX 时，距离、运动时间和跨边界爬升 delta 为 0。
- `Location.altitude` 只属于 GNSS altitude line。
- pressure altitude 只属于 BAROMETER altitude line。
- 气压计不是地形模型，只是设备压力高度变化证据。
- 目标算法不使用 `gnss_snapshot` 判点。
