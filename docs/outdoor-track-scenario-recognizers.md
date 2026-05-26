# Outdoor Track Scenario Recognizers

本文记录六层 Web 目标算法中的“场景识别器 + 局部重建器 + 可解释诊断”设计。
它是 `docs/outdoor-track-six-layer-model.md` 的场景层落地版本，当前只约束
`acceptance-web/src/sixLayerTrackProduct.mjs`，不改变 Android Java 策略、
`evidence.jsonl` schema 或 replay fixture 期望。

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
| `dense_area_intent` | 所有定位点密集窗口先统一判断主意图。 | `dense_area_intent_classifier` | 只做上层调度诊断；输出 `forward_motion`、`stationary`、`round_trip`、`gap_cluster` 或 `mixed`。 |
| `dense_main_route_settlement` | 定位点密集且存在明确前进方向时，局部噪声会让路线出现锯齿或小折返。 | `dense_main_route_skeleton` | 先保主前进骨架，再允许停留、跳变、遮挡等情景继续修复；骨架外点作为贡献 raw。 |
| `enclosed_gap_cluster` | 小范围内多次 GAP recovery 和 stationary anchor 聚集，符合山洞/室内类遮挡表现。 | `gap_stationary_cluster_diagnostic` | 当前只做诊断；不跨 GAP 计距或计爬升。 |
| `enclosed_loop_cluster_settlement` | 遮挡聚集叠加闭合往返时，低速碎点和漂移锚点会形成额外折返距离。 | `enclosed_loop_anchor_settlement` | 只保留贴近进出口走廊的少量锚点；内部碎点并入贡献 raw，不累计距离、运动时间或爬升。 |
| `position_snap_recovery` | GNSS 短时跳到新位置，但 reported speed 不支持交通判断，随后恢复稳定低速点。 | `position_snap_recovery_anchor` | 跳变恢复点作为零距离锚点；跳变弱点写入贡献 raw；后续低速点继续正常计距。 |
| `stationary_session_collapse` | 整个 session 基本静止，raw 点云只是定位漂移。 | `stationary_session_anchor` | 全段压成一个代表点；距离、运动时间、爬升均不累计。 |
| `stationary_drift_collapse` | 局部停留期间产生长串漂移点，容易膨胀里程。 | `stationary_drift_anchor` | 漂移云压成一个停留锚点；贡献 raw 全部被解释，不进入距离。 |
| `rest_photo_micro_move` | 休息、拍照、找路时在小范围内来回挪动。 | `rest_photo_micro_move_diagnostic` / `rest_photo_micro_move_simplifier` / `rest_photo_micro_move_anchor` | 短促片段只做诊断；有少量真实挪动时保留少数微移动锚点；几乎静止时压成休息锚点。 |
| `moving_spike_cleanup` | 连续移动中的单个低速侧向回跳点。 | `moving_spike_line_bridge` | 删除单点尖刺，用前后可信移动点直连；raw 仍作为贡献证据保留。 |
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

### `dense_area_intent`

识别证据：

- 连续可信 TrackPoint 数量足够密集。
- 统计路径长度、首尾净距离、bbox、GAP 恢复数、静止锚点数、计距点比例。
- 先输出上层意图：`forward_motion`、`stationary`、`round_trip`、`gap_cluster`
  或 `mixed`。

调度规则：

- `forward_motion`：优先进入 `dense_main_route_settlement`。
- `stationary`：交给 `stationary_drift_collapse` / `stationary_session_collapse`。
- `round_trip`：交给 `same_road_round_trip` / `round_trip_line` /
  `closed_loop_round_trip`。
- `gap_cluster`：交给 `enclosed_gap_cluster` 和相关遮挡 settlement。
- `mixed`：保守保留现有情景组合，只标注复盘证据。

V16.1 行为：

- `dense_main_route_settlement` 必须位于 `forward_motion` 意图窗口内。
- `stationary_drift_collapse` 会记录重叠的 dense intent 和是否有
  `stationary` 意图支持；暂不强制要求，避免漏掉非密集停留漂移。
- `same_road_round_trip`、`round_trip_line`、`closed_loop_round_trip` 会记录
  重叠的 dense intent 和是否有 `round_trip` 意图支持；暂不作为硬门槛，避免漏掉
  稀疏或被 GAP 切开的真实往返。
- `enclosed_gap_cluster` 和 `enclosed_loop_cluster_settlement` 会记录重叠的
  dense intent，以及是否有 `gap_cluster` / `mixed` 意图支持；暂不作为硬门槛，
  避免漏掉被往返、GAP 或停留拆开的复合遮挡聚集。
- 输出 `denseAreaSettlementPlan[]`，把每个密集窗口的 intent、计划 settlement、
  调度优先级和实际命中的具体场景列出来；V16.1 先作为可复盘的排序计划，不直接
  改变未覆盖场景的判点结果。

不能做：

- 不能直接改写轨迹；它只是调度诊断层。
- 不能绕过后续情景自己的安全门控。
- 不能把 raw 证据从解释链中删除。

### `dense_main_route_settlement`

识别证据：

- 连续可信移动点数量足够密集。
- span 有明确首尾净前进距离，而不是单纯原地抖动。
- bbox 可控，路径相对净距离没有夸张绕行。
- 使用 RDP 类距离容忍抽出主前进骨架。

重建动作：

- 输出 `dense_main_route_skeleton`。
- 保留入口、主方向形状点、出口。
- 骨架外密集点并入相邻保留点的 `contributingRawPointIds`。
- 后续停留漂移、拍照微移动、定位跳变恢复、遮挡聚集等情景在骨架周围继续修复。

不能做：

- 不能用于没有明确净前进方向的纯停留点云。
- 不能把真实往返折返点提前抹掉；往返仍由 round-trip 情景负责。
- 不能删除 raw 证据。

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

### `enclosed_loop_cluster_settlement`

识别证据：

- `enclosed_gap_cluster` 被 `closed_loop_round_trip` 包住。
- 聚集区 bbox 仍在小范围内，但内部含多个 GAP、静止锚点、休息微移动锚点。
- 内部低速点累计路径明显大于应保留的轻微移动，会把休息/遮挡段画成碎折返。

重建动作：

- 输出 `enclosed_loop_anchor_settlement`。
- 只保留贴近进出口走廊的少量边界/锚点。
- 被移除的低速点、GAP 点和漂移锚点写入保留锚点的 `contributingRawPointIds`。
- settlement 内部距离、运动时间和爬升 delta 置零，由外层往返段保留真实进出语义。

不能做：

- 不能把该规则用于普通开阔地连续运动。
- 不能删除 raw 证据或绕过 `RawPointDecision` 解释链。
- 不能跨 GAP 补距离。

### `position_snap_recovery`

识别证据：

- 前序存在一个或多个 `implied_speed_unconfirmed_by_reported_speed` 弱点。
- 这些点表现为短 dt 大位移，但系统 `reported speed` 低于交通阈值。
- 后续第一个可信点与跳变前可信点距离较大，如果直接桥接会产生不合理距离。

重建动作：

- 输出 `position_snap_recovery_anchor`。
- 将恢复可信点的距离、运动时间和爬升 delta 置零。
- 将前序跳变弱点写入恢复锚点的 `contributingRawPointIds`。
- 恢复锚点之后的低速移动继续按基础内核正常计距。

不能做：

- 不能把该情景解释为交通工具混入。
- 不能删除跳变 raw 证据。
- 不能把恢复锚点前后的空间缺口补成徒步距离。

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

- 较短片段只输出 `rest_photo_micro_move_diagnostic`。
- 不压缩短促真实微移动，先让人工复盘可以看到“这里更像拍照/休息/找路”。
- 当片段持续时间足够、bbox 很小、路径长度明显大于首尾净距离，并且人工复盘确认
  “有少量真实挪动但没有这么乱”时，可以输出 `rest_photo_micro_move_simplifier`：
  保留首尾和少数形状锚点，合并中间来回抖动点，距离按简化后的微移动形状结算。
- 当 bbox 和首尾净距离都很小，且片段更接近“几乎静止不动”时，可以输出
  `rest_photo_micro_move_anchor`：压成一个休息锚点，距离、运动时间和爬升窗口均不累计。
- 对 2 分钟以上、bbox/path 都很小的拍照休息片段，首尾净距在约 12 米内仍可视作
  近静止微移动塌缩；这覆盖“有少量真实挪动但线路不该这么乱”的休息拍照区间。
- 场景 evidence 会记录重叠的 dense intent，并显式标出
  `localMicroMoveOverridesDenseForward`：当上层密集窗口粗判为 `forward_motion`，
  但局部 path/net、bbox、低速比例更符合休息/拍照微移动时，局部情景可以覆盖粗粒度
  主前进意图；这用于复盘“情景是候选解释，不能盲信单层分类”。
- 当出现这类覆盖时，`findings[]` 会输出 `dense intent conflict` 汇总，列出前几个
  Raw 区间，方便优先复盘“主意图和局部情景不一致”的位置。
- 同时输出机器可读的 `denseIntentConflicts[]`，当前稳定类型为
  `local_micro_move_overrides_dense_forward`，记录冲突 Raw 区间、局部场景、动作、
  dense intents、path/net/bbox/低速比例和 resolution；后续 settlement 调度器应优先
  消费这个结构化列表，而不是解析 findings 文案。`buildTargetOutput` 和 Web worker
  compact output 也会透出该列表，方便 UI、导入流程和外部复盘工具直接消费。
- Web 区间复核会按清洗点范围反查 rawRange，列出命中的 `denseIntentConflicts[]`，
  用于定位某一段清洗线为什么由局部情景覆盖了粗粒度主意图。
- Web 地图会把 `denseIntentConflicts[]` 对应的 raw 区间画成橙色粗线；点击冲突线会
  弹出 conflict/resolution 摘要、自动填入对应清洗点复核范围，并把地图视野移动到
  该 raw 区间。
- 这类静止锚点也覆盖短时小范围折返线：例如约 1 分钟、bbox 十几米、净距十米内、
  路径几十米的休息/拍照抖动，不应保留折返线进入产品轨迹。
- 对持续更久的休息漂移，允许 bbox 略大但要求首尾净距仍很小；例如 3 分钟以上、
  净距十米内、路径主要来自来回抖动的片段，也应塌成休息锚点。
- 简化器不能只按几何拐点保留点；如果某个显著拐点同时是 reported speed 异常尖刺，
  应优先用同一合并组内更稳定的微移动点作为代表锚点。
- 作为局部子情景时可以叠加在 `closed_loop_round_trip`、`enclosed_gap_cluster`
  等大范围诊断上，不抢占它们的区间证据。

不能做：

- 不能把该场景直接等同于静止漂移；如果未来要压缩，需要另行校准距离和形状损失。
- 不能删除 raw evidence；被合并的 raw point 必须继续通过 `contributingRawPointIds`
  保留解释归属。

### `moving_spike_cleanup`

识别证据：

- 前后点构成连续移动方向，桥接距离仍合理。
- 中间单点 reported speed 为 0 或极低，但相对前后连线有明显横向偏离。
- 通过中间点的折线距离明显大于前后直连距离。

重建动作：

- 输出 `moving_spike_line_bridge`。
- 尖刺 raw point 不进入可信 GPX，不计距离和运动时间。
- 后一个可信移动点吸收尖刺 raw id 到 `contributingRawPointIds`，距离按前一点到后一点直连重算。

不能做：

- 不能用于连续多点漂移云；多点停留或拍照抖动应走 `rest_photo_micro_move`。
- 不能跨 GAP、segment 边界或交通污染片段桥接。

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
- 可观测证据来自距离、dt、reported speed 和恢复边界。
- 当系统已给出低于交通阈值的 `reported speed` 时，不只凭短 dt 的隐含速度标记交通；
  这类点回落为 `implied_speed_unconfirmed_by_reported_speed`、弱精度或隐含速度异常诊断，
  避免把 GNSS 修正跳点误解释成交通工具。

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
| `low_quality_movement_rebuild` | 大量 weak/reject 中夹着真实慢速移动；六层算法应先做 review-only 诊断，再决定是否入轨。 |
| `valley_or_urban_canyon_bias` | 山谷/城市峡谷表现为单侧偏移或长条点云；算法只能输出可观测的 bias/scatter 形态，不能直接声称外界原因。 |
| `indoor_outdoor_pressure_jump` | 室内外或天气压力突变影响 BAROMETER altitude；属于垂直高度层，不能反推水平轨迹。 |
| `water_or_metal_reflection_scatter` | 水面/金属反射造成局部散点或跳点；应先输出散点/跳点形态诊断，等待真实样本校准。 |

## 测试要求

- 每个稳定 `scenario` 至少有一个 `acceptance-web/tests/sixLayerTrackProduct.test.mjs`
  断言覆盖 `action`、`localRebuild`、关键 raw id 和是否计入距离/运动时间。
- 真实样本校准时，先把人工判断写成 raw id 区间，再新增或调整识别器。
- V16.1 已为本机真实 evidence 增加可选回归：
  `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 的 `Raw#1944-2014`、
  `Raw#2461-2483`、`Raw#2795-2834`、`Raw#4562-4610`、`Raw#5050-5094`
  必须塌成 `rest_photo_micro_move_anchor`，
  `Raw#3192-3946` 必须保持 bounded distance 并由
  `enclosed_loop_cluster_settlement` 压缩内部聚集；
  `0ddf2d35-02e2-454c-9057-667265fe8a71` 的 `Raw#256-312` 必须塌成一个
  `stationary_drift_anchor`。这些测试只在本机原始 evidence 文件存在时运行。
- V17 启动计划见 `docs/outdoor-track-v17-conflict-aware-settlement-plan.md`。
  V17.0 已把多个 `dense_main_route_settlement` / 保方向候选整理为 review-only
  `forwardSpineCandidates[]`、`forwardSpineConflicts[]` 和 `forwardSpineDecisions[]`，
  普通候选 overlap 只留在 `forwardSpineOverlaps[]` 调试，不直接扩大 active 改线范围。
- 策略版本、文档和测试必须同改；不能只改阈值或只改报告文案。
