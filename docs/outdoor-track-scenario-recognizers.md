# Outdoor Track Scenario Recognizers

本文记录六层 Web 目标算法中的“场景识别器 + 局部重建器 + 可解释诊断”设计。
它是 `docs/outdoor-track-six-layer-model.md` 的场景层落地版本，当前只约束
`acceptance-web/src/sixLayerTrackProduct.mjs`，不改变 Android Java 策略、
`evidence.jsonl` schema、replay fixture 期望或旧 `targetProduct.mjs`。

## 边界

- 场景识别器只读取标准证据：`raw_location`、`sampling_policy`、
  `device_motion_window`、`barometer_window` 和 session 上下文。
- 目标算法不读取 `gnss_snapshot`、卫星数量、C/N0、used-in-fix 或星座信息。
- `Location.altitude` 属于 GNSS altitude line；`barometer_window` 属于 BAROMETER
  altitude line。两条线可以参与诊断和门控，但不能互相覆盖，也不能修正经纬度。
- 场景名描述可观测形态，不直接声称“山谷”“密林”“城市峡谷”等不可复现原因。
- 每个 raw point 仍必须有可解释归属：进入 TrackPoint、进入 weak/reject 诊断，
  或被局部重建锚点通过 `contributingRawPointIds` 覆盖。

## 输出结构

`buildSixLayerTrackProduct` 输出 `scenarios[]`。每个场景记录至少包含：

```text
scenarioId
scenario
confidence
rawRange
anchorRawPointIds
action
localRebuild
evidence
```

字段语义：

| 字段 | 语义 |
| --- | --- |
| `scenario` | 稳定场景标识，供测试、报告和人工复盘使用。 |
| `confidence` | 0-1 的形态置信度，用于排序和诊断，不作为唯一硬门槛。 |
| `rawRange` | 场景覆盖的 raw id 起止范围。 |
| `anchorRawPointIds` | 局部重建时最重要的 raw id，通常是代表点、端点或恢复点。 |
| `action` | 策略动作，例如压缩、保留端点、置零边界、排除交通污染。 |
| `localRebuild` | 局部重建器名称，解释轨迹形状如何被改写或标注。 |
| `evidence` | 可复核的触发证据，必须来自输入样本或已结算 TrackPoint。 |

同时输出 `scenarioCoverage[]`。它不是新的识别器，也不改变轨迹，而是把
`scenarios[]` 投影到清洗点和 raw point：

```text
scenarioCoverage:
  scenarioId / scenario
  scenarioLabel
  rawRange
  continuousCoverage
  trackPointRange
  trackPointIds
  action / actionLabel
  localRebuild / localRebuildLabel
  contextTrackPointCount
  primaryTrackPointCount
  rawDecisionContextCount
  rawDecisionPrimaryCount
```

用途：

- 快速回答“清洗点 #A-#B 这段到底命中了哪些情景”。
- 连续情景用 `trackPointRange` 表达；GAP 边界、交通污染这类离散情景用
  `trackPointIds` 表达，避免把两个边界点之间的整段误标成同一情景。
- 区分主解释点数和关联点数，避免复合场景被单个 `primaryExplanation` 遮住。
- 帮真实样本校准沉淀成 replay fixture 前，先稳定记录人工判断区间。

Web UI 里的“区间复核”调用同一套 `reviewTrackPointScenarioCoverage()` 逻辑；
它只读取已有 `scenarioCoverage[]` 和 TrackPoint 解释，不新增判点规则。

同时，Web 六层结果会给 TrackPoint、excluded point 和 `rawPointDecisions[]`
附加解释分层：

```text
primaryExplanation:
  source = scenario / primitive
  scenario / scenarioLabel optional
  action / actionLabel optional
  localRebuild / localRebuildLabel optional
  rawRange optional
  result/reason/facts optional
  summary

scenarioContexts[]:
  scenarioId / scenario / scenarioLabel / confidence
  action / actionLabel
  localRebuild / localRebuildLabel
  rawRange
  summary

primitiveFacts:
  sample_valid / sample_invalid
  horizontal_trusted / horizontal_weak / horizontal_rejected
  activity_*
  boundary_*
  trusted_gpx_included / trusted_gpx_excluded
  distance_counted / distance_suspended
  moving_time_counted / moving_time_suspended
  gnss_altitude_*
```

设计目的：

- 用户主解释优先看 `primaryExplanation`，也就是“这里是停留漂移压缩 / 同路往返 /
  GAP 边界 / 交通污染”等场景语言。
- 一个点可以同时落在大范围情景和局部子情景内，例如“闭合往返 + 山洞遮挡聚集 +
  拍照微移动”；`primaryExplanation` 只选最适合当前点的主解释，`scenarioContexts[]`
  保留全部关联情景用于复盘。
- 基础判点 `reason` 不删除，但降级为 `primitiveFacts` 的来源，用来保护合法性、
  连续性、计距门控和高度门控。
- 若某个点没有命中稳定场景，`primaryExplanation.source = primitive`，仍然可以用
  基础事实解释。

## 当前已扩散场景

| 场景 | 解决的问题 | 局部重建器 | 产品约束 |
| --- | --- | --- | --- |
| `weak_recovery_endpoint` | 长 GAP 后弱定位点云其实保留了真实端点形状，例如洞内或遮挡出口附近。 | `weak_recovery_shape_anchor` | 生成形状锚点进入可信 GPX；距离、运动时间和跨边界爬升为 0。 |
| `same_road_round_trip` | 同一路往返点云交织，被误识别成两条分离线路或复杂折线。 | `same_road_centerline` | 同路部分压到中心线；保留弱恢复端点；不能把洞内端点清掉。 |
| `closed_loop_round_trip` | 普通可信点构成首尾接近的往返或回环，但没有弱恢复折返点。 | `round_trip_diagnostic` | 当前只做诊断，不改写轨迹；用于标注真实往返/回环语义。 |
| `round_trip_line` | 往返形态存在，但不是极窄同路走廊。 | `round_trip_polyline` | 做线形抽稀，保留起点、折返点、终点语义。 |
| `enclosed_gap_cluster` | 小范围内多次 GAP recovery 和 stationary anchor 聚集，符合山洞/室内类遮挡表现。 | `gap_stationary_cluster_diagnostic` | 当前只做诊断；不跨 GAP 计距或计爬升。 |
| `stationary_session_collapse` | 整个 session 基本静止，raw 点云只是定位漂移。 | `stationary_session_anchor` | 全段压成一个代表点；距离、运动时间、爬升均不累计。 |
| `stationary_drift_collapse` | 局部停留期间产生长串漂移点，容易膨胀里程。 | `stationary_drift_anchor` | 漂移云压成一个停留锚点；贡献 raw 全部被解释，不进入距离。 |
| `rest_photo_micro_move` | 休息、拍照、找路时在小范围内来回挪动。 | `rest_photo_micro_move_diagnostic` | 当前只做诊断；保留真实微移动点，不主动压缩。 |
| `gap_recovery_boundary` | GAP 后恢复点可能进入 GPX，但不能跨 GAP 计距。 | `gap_recovery_anchor` | 恢复点开启/重置 segment；距离、运动时间、GNSS/气压爬升 delta 为 0。 |
| `transport_contamination` | 景区车、缆车、电梯、骑行或高速移动混入徒步记录。 | `transport_diagnostic_continuity` | 可以保留诊断连续性；不进入徒步距离、运动时间、可信 GPX 或徒步爬升。 |

## 场景细则

### `weak_recovery_endpoint`

识别证据：

- 前一个可信点到弱点云之间存在长 GAP。
- `gap_recovery_pending` 弱点云样本数足够，核心半径较小。
- 核心点里存在相对更好的 accuracy。
- 点云中心距离前一个可信点足够远，说明不是原地恢复噪声。

重建动作：

- 选一个代表 raw point，并把弱点云压成 `weak_recovery_shape_anchor`。
- 默认坐标使用点云中心；如果后续被同路往返重写，需要把端点坐标恢复到
  `shapeEndpointRawPointId` 对应的 raw 坐标。

不能做：

- 不能把弱点云累计成距离或运动时间。
- 不能用 `gnss_snapshot` 解释端点可靠性。

### `same_road_round_trip`

识别证据：

- 局部 span 包含往返折返点，往返起终点接近。
- span 的 cross-track 偏差可控。
- 同路证据满足窄 bbox 和折返点前后 approach pair 距离较小。
- 如果折返点来自 `weak_recovery_endpoint`，端点 raw id 必须保留。

重建动作：

- 同路往返段改写为中心线坐标，避免把 3 米内交织误差画成两条分离路线。
- 弱恢复端点使用 endpoint raw 坐标，保护洞内、遮挡端点或真实折返点形状。

不能做：

- 不能把真实同一路交织展开成左右两条路线。
- 不能为了平滑中心线删除弱恢复端点。

### `round_trip_line`

识别证据：

- 起点、折返点、终点构成往返线形。
- 起终点距离小于阈值，折返点距离足够远。
- span cross-track 小于线形容忍阈值。
- 不满足 `same_road_round_trip` 的极窄同路条件。

重建动作：

- 使用线形抽稀保留主要形状点。
- 输出 `round_trip_polyline`，用于解释“简化了复杂折线，但不是同路中心线塌缩”。

不能做：

- 不能把非同路的大回环强行压成同一条中心线。

### `closed_loop_round_trip`

识别证据：

- span 内 TrackPoint 数足够，路径长度明显大于首尾净距离。
- 起终点距离很近，路径形成闭合往返或回环。
- bbox 有足够展开，排除单纯原地抖动。
- 不依赖 `weak_recovery_endpoint`，也不要求已有弱恢复折返点。

重建动作：

- 当前只输出 `round_trip_diagnostic`，不改写 TrackPoint。
- 让 `primaryExplanation` 能把这类普通往返标成场景，而不是只显示底层
  `motion_supported_low_speed`。

不能做：

- 不能把所有小范围来回挪动都升级为大往返；短小片段应交给
  `rest_photo_micro_move`。

### `enclosed_gap_cluster`

识别证据：

- 小 bbox 内出现多次 `gap_recovery`。
- 同一区间出现多个 `stationary_anchor` 或 `stationary_drift_anchor`。
- raw id span 和持续时间较长，说明不是一次普通暂停。
- 这是“山洞/室内类遮挡”的可观测表现，但自动标签只承诺 GAP 和静止聚集。

重建动作：

- 当前只输出 `gap_stationary_cluster_diagnostic`。
- 仍由基础门控保证 GAP recovery 不跨边界计距、不跨边界计爬升。

不能做：

- 不能直接声称有地图意义上的山洞入口或洞内地形。
- 不能用该场景修正经纬度。

### `stationary_session_collapse`

识别证据：

- raw 点数和 session 时长达到整段判断门槛。
- bbox、首尾净距离、路径速率都很小。
- 大多数 raw speed 样本接近 0，平均 reported speed 低。

重建动作：

- 选择代表 raw point，输出一个 `stationary_session_anchor`。
- 所有 raw id 进入该锚点的 `contributingRawPointIds`。

不能做：

- 不能把整段静止漂移当作真实徒步里程。
- 不能因为整段压缩丢失 raw 解释覆盖。

### `stationary_drift_collapse`

识别证据：

- 局部区间有足够多的漂移 raw point。
- 核心弱/大漂移点连续，区间 bbox 和首尾净距离仍在停留容忍范围内。
- reported speed 和零速比例支持停留漂移，而不是持续徒步。

重建动作：

- 区间压成一个 `stationary_drift_anchor`。
- 从 weak/reject/intakeRejected 中移除已被锚点解释的 raw id，避免同一 raw
  同时被“清掉”和“保留”。

不能做：

- 不能把停留漂移贡献到距离、运动时间或爬升窗口。

### `rest_photo_micro_move`

识别证据：

- 短时间、少量 TrackPoint、小 bbox。
- 路径长度明显大于首尾净距离，说明人在小范围内来回挪动。
- 主要由低速移动或静止锚点构成。

重建动作：

- 当前只输出 `rest_photo_micro_move_diagnostic`。
- 不压缩真实微移动，先让人工复盘可以看到“这里更像拍照/休息/找路”。
- 作为局部子情景时可以叠加在 `closed_loop_round_trip`、`enclosed_gap_cluster`
  等大范围诊断上，不抢占它们的区间证据。

不能做：

- 不能把该场景直接等同于静止漂移；如果未来要压缩，需要另行校准距离和形状损失。

### `gap_recovery_boundary`

识别证据：

- 结算后的 TrackPoint 中存在 `gap_recovery`。
- 这些恢复点的 `distanceDeltaMeters` 和 `movingTimeDeltaSeconds` 为 0。

重建动作：

- 输出 `gap_recovery_anchor` 诊断，说明这里是边界重置点，不是普通移动点。

不能做：

- 不能跨 GAP 直接累计距离。
- 不能把 GAP 前后的 GNSS altitude 或 BAROMETER altitude 差值算作爬升。

### `transport_contamination`

识别证据：

- 存在 `transport_risk` rejected 点，或被保留为诊断连续性的
  `recovery_transport_suspected_kept` / `transport_suspected_kept` TrackPoint。
- 可观测证据来自距离、dt、隐含速度、reported speed 和恢复边界。

重建动作：

- 输出 `transport_diagnostic_continuity`。
- 被保留的疑似交通点可以帮助展示“这里发生了污染”，但 `entersTrustedGpx`
  必须为 false。

不能做：

- 不能把交通污染计入徒步距离、运动时间或徒步爬升。
- 不能为了让路线连续而把交通点混进 trusted GPX。

## 待扩散场景

这些场景已有设计方向，但当前六层 Web 默认算法尚未把它们作为稳定 `scenario`
输出。新增时必须同步更新本文、测试和必要的 replay fixture 规划。

| 候选场景 | 设计方向 |
| --- | --- |
| `interwoven_corridor` | 多次来回走同一窄路，但不一定有清晰弱恢复折返点；当前代码有默认关闭的抽稀开关，尚未输出 `scenarios[]`。 |
| `low_quality_movement_rebuild` | 大量 weak/reject 中夹着真实慢速移动；当前旧算法有复核候选，六层算法应先做 review-only 诊断，再决定是否入轨。 |
| `valley_or_urban_canyon_bias` | 山谷/城市峡谷表现为单侧偏移或长条点云；算法只能输出可观测的 bias/scatter 形态，不能直接声称外界原因。 |
| `indoor_outdoor_pressure_jump` | 室内外或天气压力突变影响 BAROMETER altitude；属于垂直高度层，不能反推水平轨迹。 |
| `water_or_metal_reflection_scatter` | 水面/金属反射造成局部散点或跳点；应先输出散点/跳点形态诊断，等待真实样本校准。 |

## 测试要求

- 每个稳定 `scenario` 至少有一个 `acceptance-web/tests/sixLayerTrackProduct.test.mjs`
  断言覆盖 `action`、`localRebuild`、关键 raw id 和是否计入距离/运动时间。
- 真实样本校准时，先把人工判断写成 raw id 区间，再新增或调整识别器。
- 策略版本、文档和测试必须同改；不能只改阈值或只改报告文案。
