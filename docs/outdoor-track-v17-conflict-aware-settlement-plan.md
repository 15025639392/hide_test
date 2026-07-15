# Outdoor Track V17 Dense Forward Spine Arbitration Plan

本文是 V17 启动文档。V17 专注解决一个具体问题：

```text
同一个定位点密集区里，多个“保方向 / 主前进骨架”候选互相重叠、包含或相交时，
如何选出唯一、稳定、可解释的最终主脊线。
```

V17 不是交通工具专题，也不是泛化的全局 settlement 重写。交通污染、GAP、weak/reject、
GPX 和高度门控仍属于基础安全边界；本阶段只处理 dense forward spine candidate 之间的
叠加仲裁。

## 版本定位

当前稳定基线：

```text
six-layer-evidence-v16.1
```

当前 V17.10.2 清洗版本：

```text
six-layer-evidence-v17.10.2
```

V17 工作名：

```text
dense forward spine arbitration
```

一句话目标：

```text
密集区可以产生多个保方向候选，但同一 raw 子区间最终只能有一个 active 主脊线；
一致候选合并，冲突候选仲裁，落选候选转为解释上下文。
```

## 为什么需要 V17

V16.1 已经完成：

- 对密集窗口输出 `dense_area_intent`。
- 在 `forward_motion` 内输出 `dense_main_route_settlement`。
- 允许局部 `rest_photo_micro_move` 覆盖粗粒度 forward intent。
- 用 `denseAreaSettlementPlan[]` 和 `denseIntentConflicts[]` 把冲突暴露到 UI。

现在发现的新问题是：同一密集区域里可能出现多个保方向候选互相叠加。它们可能来自不同
窗口尺度、不同局部片段或不同情景叠加。如果简单叠加或简单取交集，会出现：

- 主路线被压得过短，只剩中间交集。
- 入口、出口、折返点被误删。
- 两条方向不同的候选被误合成一条线。
- 局部休息/拍照微移动被主方向候选吞掉。
- 多个候选同时 active，造成距离、运动时间和解释重复结算。

因此 V17 的核心不是再加一个密集区阈值，而是建立保方向候选之间的仲裁。

## 核心原则

- **不把几何交集当最终轨迹。** 交集只能作为重叠证据，不能直接作为清洗线。
- **时间顺序优先于空间相交。** GNSS 漂移中空间线段交叉很常见，不代表人真的走过交点。
- **raw 时间轴先切片。** 所有候选按 rawRange 做 sweep-line 分段，每个子区间单独仲裁。
- **同向一致才合并。** 方向角、入口出口、path/net、前后轨迹连续性都一致时，才能合并。
- **方向冲突就显式冲突。** 不强行合并，不取交点，不把落选候选静默删除。
- **同一 raw 子区间唯一 active。** 最终只能有一个主脊线候选负责改线，其余进入
  `scenarioContexts` / `contributingRawPointIds` / review finding。

## V17 核心产物

| 产物 | 作用 |
| --- | --- |
| `forwardSpineCandidates[]` | 所有保方向候选，包含 rawRange、trackPointRange、入口出口、方向角、path/net、bbox、来源场景。 |
| `forwardSpineOverlaps[]` | 候选之间的重叠、包含、端点相接、空间相交关系；V17.0 只作调试证据，不直接上图。 |
| `forwardSpineConflicts[]` | 高置信、人工可复盘的候选冲突；V17.0 不把普通 overlap / endpoint-touch 自动升级为冲突。 |
| `forwardSpineDecisions[]` | 每个 raw 子区间的仲裁结果：merge、select、split、downgrade、review_only。 |

这些结构可以先从现有 `dense_main_route_settlement`、`denseAreaSettlementPlan[]` 和
`denseIntentConflicts[]` 派生，不要求第一步重写所有情景识别器。

## 候选相交处理

### 同向相交

表现：

- 候选方向角接近。
- rawRange 大量重叠。
- 入口、出口位置和前后可信轨迹方向一致。

处理：

- 不取交集。
- 合并为一个更长候选，或选择覆盖更完整、path/net 更优的候选作为主脊线。
- 被合并候选的 raw id 进入主候选贡献解释。

### 包含相交

表现：

- 短候选完全落在长候选 rawRange 内。
- 两者方向基本一致，或短候选只是局部窗口重复识别。

处理：

- 默认长候选 active，短候选降级为 context。
- 如果短候选明显避开局部漂移，允许把长候选该子区间替换为短候选。
- 替换必须只发生在切片后的 raw 子区间，不能整段覆盖长候选。

### 交叉相交

表现：

- 两条候选在空间上交叉。
- 时间顺序、方向角或入口出口语义不一致。

处理：

- 不合并，不取交点。
- 按 raw 时间轴切片，每片评分选主候选。
- 输出 `forward_spine_conflict`，落选候选进入 explanation context。

### 端点相交

表现：

- 候选只在入口、出口、折返点、GAP recovery 或弱恢复端点附近相接。

处理：

- 端点优先保留。
- 端点两侧分别结算。
- 不能用交集算法吞掉端点。

### 往返相交

表现：

- 前进候选和返程候选在同一路径附近重叠或相交。
- path/net、闭合度或折返点证据更像往返。

处理：

- 不作为单条 forward spine 处理。
- 降级或转交 `same_road_round_trip` / `round_trip_line` / `closed_loop_round_trip`。
- 输出 `round_trip_overrides_forward_spine` review conflict。

## 仲裁评分

每个 raw 子区间对候选评分，而不是对整段一次性评分。

建议评分因素：

| 因素 | 目标 |
| --- | --- |
| raw 时间覆盖 | 候选能解释该子区间多少 raw 点。 |
| 方向连续性 | 与子区间前后可信轨迹方向夹角是否小。 |
| path/net 比例 | 主脊线是否减少多余折返，而不是制造更长路线。 |
| bbox 控制 | 候选是否落在合理密集区范围内。 |
| 入口出口稳定性 | 是否保留真实进入和离开位置。 |
| 情景冲突 | 是否覆盖了休息、拍照、弱恢复端点或往返信号。 |
| 距离影响 | 是否避免距离和运动时间重复结算。 |

评分结果只决定 forward spine 候选之间的主次。它不能绕过基础安全内核，也不能把 weak/reject
直接变成可信 GPX 点。

## 冲突类型

第一批 V17 只稳定这些 forward spine 冲突：

| 冲突类型 | 默认处理 |
| --- | --- |
| `overlapping_forward_spine_candidates` | 暂只保留在 `forwardSpineOverlaps[]`，不上图，不进入冲突详情。 |
| `crossing_forward_spine_candidates` | 暂只保留在 `forwardSpineOverlaps[]`，等待人工确认，不进入冲突详情。 |
| `nested_forward_spine_candidate` | 暂只保留在 `forwardSpineOverlaps[]`，不上图，不进入冲突详情。 |
| `round_trip_overrides_forward_spine` | 往返信号强于主前进；转交往返情景。 |
| `local_micro_move_overrides_forward_spine` | 休息/拍照微移动覆盖局部主方向；沿用 V16.1 稳定行为。 |

## 真实样本验收清单

V17 第一轮继续使用真实 evidence 做锚点。

| Session | Raw 区间 | V17 验收目标 |
| --- | --- | --- |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#1944-2014` | 不被 forward spine 吞掉；保持休息/拍照微移动塌缩。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#2461-2483` | 不出现短折返线。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#2795-2834` | 不出现短折返线。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#3192-3946` | 往返 + 轻微移动保持 bounded distance；多个局部方向不能叠加放大距离。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#417-900` | 同路往返证据不足且属于长 GAP 复合段时，不产生 active 往返清洗；记录 rejected candidate 和 `composite_gap_local_settlement`，让局部策略结算。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#3862-3929` | 不应归类为局部休息覆盖 forward；更适合进入主前进 / forward spine 仲裁。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#4562-4610` | 静止/休息微移动保持塌缩。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#5050-5094` | 局部休息微移动继续覆盖粗粒度 forward。 |
| `0ddf2d35-02e2-454c-9057-667265fe8a71` | `Raw#256-312` | 静止漂移保持单锚点。 |

## 不做范围

V17 启动阶段不做这些事：

- 不修改 Android 实时链路。
- 不改 `evidence.jsonl` schema。
- 不改 trusted GPX 输出口径。
- 不把 `gnss_snapshot` 升级为硬判点输入。
- 不把交通工具污染作为 V17 主线。
- 不在 UI 中展示不稳定规则说明。
- 不把多个候选取几何交集作为最终路线。
- 不允许多个 forward spine 在同一 raw 子区间同时 active。

## 实施分期

### V17.0 Review-Only

状态：已落盘为 `six-layer-evidence-v17.0`。

- 从现有 dense main route settlement 生成 `forwardSpineCandidates[]`。
- 识别候选之间的 overlap、nested、crossing、endpoint-touch。
- 普通 overlap / endpoint-touch 只保留在 `forwardSpineOverlaps[]`，不直接生成 UI 冲突。
- 只把人工已确认方向的高置信问题生成 `forwardSpineConflicts[]` 和中文 review finding。
- UI 和地图只展示 `forwardSpineConflicts[]`；`forwardSpineOverlaps[]` 是内部候选关系证据，
  不等于冲突，也不应直接上图。
- 不改变当前清洗轨迹。

### V17.1 Rest/Photo Micro-Move Settlement

状态：已落盘为 `six-layer-evidence-v17.1`。

- `rest_photo_micro_move` 默认应用到轨迹清洗：强休息/近静止折返塌成休息锚点，
  其余小移动按几何风险选择轻桥接或少量形状锚点。
- Web 复核任务不再单独列出已沉淀的休息/拍照小移动；`scenarioCoverage[]` 和点级解释仍保留证据。

### V17.2 Moving Spike Cleanup Settlement

状态：已落盘为 `six-layer-evidence-v17.2`。

- `moving_spike_cleanup` 默认应用到轨迹清洗：删除侧向尖刺点，用前后可信移动点桥接。
- `moving_spike_cleanup` 执行优先于 `rest_photo_micro_move`，先消除点级伪迹，再让
  休息/拍照小移动处理剩余区间。
- Web 复核任务不再单独列出已沉淀的移动单点尖刺清理；`scenarioCoverage[]` 和点级解释仍保留证据。

### V17.3 Pipeline Settlement Ordering

状态：已落盘为 `six-layer-evidence-v17.3`。

- 情景 settlement 按管道执行：每个会改线的阶段先更新 `product.track` 和
  `rawPointDecisions`，后续情景只能基于更新后的清洗轨迹继续识别和改线。
- `moving_spike_cleanup` 提升为前置点级清理，先于 `dense_area_intent`、
  `dense_main_route_settlement`、`rest_photo_micro_move` 等 span 级情景执行。
- 被移除的尖刺 raw point 进入 `suppressedRawPointIds` 诊断链；它仍有 raw 决策和
  `scenarioContexts`，但不再作为后续情景的 active `contributingRawPointIds`。
- 尖刺候选不再限定为 reported speed 为 0；低速 `accept` 点只要 detour / lateral
  几何证据更强，也会优先于相邻的弱候选被删除。

### V17.4 Stationary Drift Route-Line Bridge

状态：已落盘为 `six-layer-evidence-v17.4`。

- `stationary_drift_anchor` 继续保留为停留漂移解释锚点，承载 raw 贡献归属、
  点级解释和场景覆盖。
- 该锚点不再作为清洗路线顶点：输出 `routeLineVertex=false`、
  `routeLineStrategy=bridge_previous_next`，清洗线直接连接前后有效路线点。
- 这样保持轨迹连续，同时避免路线为了连续而折到漂移云中心，误表达“人真实经过该点”。

### V17.5 Same-Road Round-Trip Guard

状态：已落盘为 `six-layer-evidence-v17.5`。

- `same_road_round_trip` 中心线塌缩只在强同路证据下执行。
- 若缺少 `round_trip` dense intent，则必须同时满足更窄的 bbox、更近的 approach pair、
  较短 duration 和较小 sample gap；否则降级为 `round_trip_line`。
- 降级后的 `round_trip_line` 继续保留 `sameRoadBboxMeters`、
  `sameRoadApproachPairDistanceMeters`、`sameRoadCollapseEligible=false` 和
  `sameRoadCollapseReason`，方便复核为什么没有压成中心线。
- 如果候选缺少 `round_trip` dense intent，且 duration / sample gap 已经说明它是
  长 GAP 复合段，则不再降级成 active `round_trip_line`，只记录
  `roundTripLineRejectedCandidates[]`，让后续局部 settlement 继续处理。
- 真实样本 `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 的 `Raw#417-900` 默认记录为
  rejected round-trip candidate，不再产生 active `same_road_round_trip` 或
  `round_trip_line`；轨迹由休息/小移动、弱恢复端点、GAP recovery 和静止锚点等局部
  策略接管。

### V17.6 Active Merge/Select

状态：已落盘为 `six-layer-evidence-v17.6`。

- 只启用同向重叠和包含候选的 merge/select。
- `forwardSpineDecisions[]` 对同向 `overlap` 输出 active `merge`，对同源/同计划
  `nested` 输出 active `select`；落选候选进入 `contextCandidateIds`。
- winner 选择优先考虑已落盘的 `dense_main_route_settlement`、raw 覆盖、置信度和
  path/net 比例，避免粗 intent 与已清洗骨架重复 active。
- 不处理 crossing 为 active 改线。
- 必须证明不会破坏 V16.1 已锁定的真实 evidence 回归。

### V17.7 Composite GAP Local Settlement Diagnostic

状态：已落盘为 `six-layer-evidence-v17.7`。

- 将 `roundTripLineRejectedCandidates[]` 中的长 GAP 复合候选同步沉淀为
  `composite_gap_local_settlement` 情景。
- 该情景只做诊断和复核入口，不改写轨迹；`primaryEligible=false`，不会抢走
  休息/小移动、弱恢复端点、GAP recovery、静止锚点等局部策略的点级主解释。
- `scenarioCoverage[]` 和 Web 右侧问题清单会按 Raw 时间序列列出该复合段，审核人员
  可以看到“为什么没有把整段压成同路往返或往返折线”。
- 真实样本 `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 的 `Raw#417-900` 覆盖：
  无 active `same_road_round_trip` / `round_trip_line`，保留 rejected candidate，
  同时输出 `composite_gap_local_settlement` 作为上下文。

### V17.8 Moving Spike High-Speed Geometry Override

状态：已落盘为 `six-layer-evidence-v17.8`。

- `moving_spike_cleanup` 保留原有低速候选口径：普通 competing 点仍需要 reported speed
  不超过低速竞争阈值，或与 strict 低速候选重叠并且几何得分更强。
- 对 reported speed 高于低速竞争阈值、但仍低于交通速度的单点，不直接信任 reported
  speed；只有同时满足更强 detour、更强 lateral、短 bridge，且 bridge 后方向能接上
  后续前进路线时，才触发 `high_reported_speed_geometry_override`。
- scenario evidence 写入 `speedPolicy` 和 `forwardAngleDeltaDegrees`，便于复核为什么
  高 reported speed 点仍被当作尖刺删除。
- 覆盖 `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 中 `Raw#1585`：reported speed
  为 `2.57m/s`，但 detour / lateral 强且 Raw#1578 -> Raw#1586 bridge 与后续前进方向
  对齐，因此删除 Raw#1585，用 Raw#1578 -> Raw#1586 直连。
- 同步加入合成反例：高 reported speed 的真实拐点如果 bridge 与后续方向不对齐，不触发
  override，防止把真实转弯误删。

### V17.9 Rest/Photo Weak Micro-Move Shape Filter

状态：已落盘为 `six-layer-evidence-v17.9`。

- 对短路径、点数少、入口/出口都能自然接回主路线的 `rest_photo_micro_move`，如果单个
  休息锚点会制造明显额外绕行，则不再塌成 `rest_photo_micro_move_anchor`。
- 该类弱微移动输出 `rest_photo_micro_move_shape_filter`：保留低速移动形状点，只移除
  中间停留锚点并暂停休息耗时；代表锚点作为 evidence / suppressed raw 保留，不进入
  可信 GPX 路线顶点。
- scenario evidence 写入 `entryDistanceMeters`、`exitDistanceMeters`、
  `bridgeDistanceMeters` 和 `anchorDetourMeters`，解释为何采用轻桥接而不是休息锚点。
- 覆盖真实样本 `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 的 `Raw#5015-5042`：
  Raw#5015-5018 和 Raw#5039-5042 继续进入清洗线；Raw#5023 仍是代表证据，
  但只作为 suppressed raw，不再作为清洗线顶点。

### V17.10 Transport Route Preservation

状态：已落盘为 `six-layer-evidence-v17.10`。

- `transport_suspected_kept` 和 `recovery_transport_suspected_kept` 进入可信路线与 GPX
  形状，不再被 batch 或 streaming local rebuild 删除。
- 交通场景只关闭 distance、moving time 和 elevation，不关闭 route。
- reported speed 达到交通阈值且位移走出 stationary threshold 时，即使单步不足 20m
  也保留为交通点；低 reported speed 的大跳点仍交给 position snap 恢复。
- 真实 watchOS 样本 Raw#661-688 全部连续保留，并新增
  `transport_high_frequency.jsonl` 回归 fixture。

### V17.10.1 Competing Low-Speed Spike Geometry Override

状态：已落盘为 `six-layer-evidence-v17.10.1`。

- `moving_spike_cleanup` 补齐 strict 与 competing reported speed 阈值之间的资格空档。
- 只有中间点形成单点速度塌陷，即前后相邻点速度都高于 competing 阈值，并同时满足
  强 detour、强 lateral、短 bridge 和后续前进方向连续，才触发
  `competing_low_speed_geometry_override`。
- 覆盖真实样本 `outdoor_track_evidence_v1(3).jsonl` 的 Raw#698：Raw#697 -> Raw#698
  -> Raw#699 绕行约 `19.60m`，Raw#697 -> Raw#699 直连约 `7.36m`，横向偏离约
  `6.28m`，后续方向差约 `2.13°`。
- Raw#698 不进入可信 GPX、不计距离和运动时间；Raw#699 按 Raw#697 -> Raw#699
  直连重算。Raw#661-688 的连续交通路线保留口径不变。

### V17.10.2 Unstable Transport Prefix Recovery

状态：已落盘为 `six-layer-evidence-v17.10.2`。

- `position_snap_recovery` 增加 `unstable_transport_prefix`，处理弱点与
  `transport_suspected_kept` 交错、短窗口内先跳远再明显回摆、随后重新接回前进方向的
  恢复前缀。
- 资格要求同时成立：至少 2 个 transport kept、至少 2 个允许 weak 点、raw span
  不超过 8、detour 至少 `20m`、最大回摆至少 `120°`、恢复方向与后续方向差不超过
  `30°`，且后续可信点距离不超过 `60m`。
- 覆盖真实样本 `outdoor_track_evidence_v1.jsonl`：Raw#372 -> Raw#379 直连约
  `182.44m`，经 Raw#375 / Raw#377 的路线多绕约 `65.72m`，最大回摆约 `159.25°`，
  Raw#379 恢复方向与 Raw#381 后续方向只差约 `5.91°`。
- Raw#373-378 作为 suppressed / contributing 证据保留，Raw#375-378 不进入可信
  GPX；Raw#379 成为零距离恢复锚点，Raw#381 的连续交通移动仍保留。
- 流式 recognizer 使用 open window 延迟提交该短前缀；候选关闭后以 priority `5`
  覆盖窗口内逐点 transport passthrough。直线连续交通合成反例保持不清洗。

### V17.11 Crossing And Round-Trip Arbitration

- 对 crossing 候选和往返覆盖主方向做 review-only 到 active 的升级评估。
- 只有真实样本和 targeted synthetic case 都稳定后，才允许 active。

## 验收标准

V17 任一 active 改线必须满足：

- 对应 raw 区间有明确人工预期。
- 同一 raw 子区间只有一个 active forward spine decision。
- 落选候选保留为 context，不静默丢失。
- 被合并或删除的 raw point 必须进入 `contributingRawPointIds` 或诊断解释链。
- 入口、出口、折返点不能被交集算法吞掉。
- 距离、运动时间、爬升、GPX gate 的变化可解释。
- `npm test` 通过。
- 本机真实 evidence 回归通过。

## 下一步执行建议

V17.0 已完成：

1. 为 dense forward intent 和 `dense_main_route_settlement` 产出
   `forwardSpineCandidates[]`。
2. 输出 `forwardSpineOverlaps[]`、高置信 `forwardSpineConflicts[]` 和
   `forwardSpineDecisions[]`。
3. UI 冲突详情展示 forward spine conflict，并可点击定位地图。

V17.1 已完成：

1. 将 `rest_photo_micro_move` 从 diagnostic-first 调整为默认清洗策略。
2. Web 复核任务过滤已沉淀的休息/拍照小移动，避免审核清单重复列出稳定策略。

V17.2 已完成：

1. 将 `moving_spike_cleanup` 标记为已沉淀默认清洗策略。
2. 调整执行顺序，让移动单点尖刺清理优先于休息/拍照小移动 settlement。
3. Web 复核任务过滤已沉淀的移动单点尖刺清理，避免审核清单重复列出稳定策略。

V17.3 已完成：

1. 将默认 settlement 收敛为管道式执行，后续情景基于前序情景改写后的
   `product.track` 继续处理。
2. 将 `moving_spike_cleanup` 放到 dense / rest / loop 等 span 级情景之前执行。
3. 将被删除尖刺 raw 从 active `contributingRawPointIds` 拆到 `suppressedRawPointIds`，
   保留诊断解释但不污染后续情景贡献输入。
4. 对相邻尖刺候选做非重叠仲裁，选择 detour / lateral 更强的候选，覆盖
   `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 中 `Raw#1666` 低速 accept 尖刺。

V17.4 已完成：

1. 将 `stationary_drift_anchor` 标记为解释锚点而非路线顶点。
2. Web 清洗线和方向箭头按 `routeLineVertex=false` 跳过该点并桥接前后路线点。
3. 点级解释、`scenarioCoverage[]` 和 raw 贡献归属继续保留在锚点上。

V17.5 已完成：

1. 将 `same_road_round_trip` 从宽松几何升级改为强证据中心线塌缩。
2. 缺少 `round_trip` dense intent 且 span 过长、sample gap 过大或同路几何偏宽时，
   不允许 active same-road centerline；若同时是长 GAP 复合段，也不允许 active
   `round_trip_line`。
3. 覆盖 `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 中 `Raw#417-900`：默认保留往返候选
   拒绝证据，不再压成 same-road centerline，也不再横跨整段做 round-trip polyline；
   后续局部策略继续结算该复合段。

V17.6 已完成：

1. 将保方向仲裁从 review-only 沉淀为可执行 decision：同向 `overlap` / `nested`
   候选会产出 `reviewOnly=false` 的 `merge` / `select`。
2. 同一 raw 子区间只选一个 `selectedCandidateId`；落选候选保留在
   `contextCandidateIds`，不静默丢失。
3. 合成 dense main route 回归已覆盖 active nested select；`npm test` 已通过。

V17.7 已完成：

1. 将长 GAP 复合段 rejected round-trip candidate 转成
   `composite_gap_local_settlement` 诊断情景。
2. 该情景进入 `scenarioCoverage[]` 和右侧问题清单，但不改写轨迹、不抢点级主解释。
3. 合成长 GAP 无 intent case 与真实 `Raw#417-900` 回归已覆盖该诊断化路径。

V17.8 已完成：

1. 给 `moving_spike_cleanup` 增加高 reported speed 的强几何 override。
2. override 只对超过低速竞争阈值的点生效，不改变原有低速候选仲裁。
3. 覆盖真实 `Raw#1585` 删除，并用合成真实拐点验证不会误删缺少 forward alignment 的
   高 reported speed 点。

V17.9 已完成：

1. 给 `rest_photo_micro_move` 增加弱微移动形状过滤分支。
2. 短路径、入口/出口自然、但单锚点绕行代价高的片段不再强行塌成休息锚点。
3. 覆盖真实 `Raw#5015-5042`，保留 Raw#5015-5018 和 Raw#5039-5042，
   Raw#5023 只作为代表证据和 suppressed raw。

V17.10 已完成：

1. 交通移动进入可信路线与 GPX 形状，批处理和流式局部重建不再删除。
2. 交通段继续独立诊断，不计入徒步距离、运动时间和爬升。
3. 覆盖真实 watchOS Raw#661-688 和高频交通 replay fixture。

V17.10.1 已完成：

1. 补齐 competing 低速单点尖刺的强几何覆盖。
2. 覆盖真实 watchOS Raw#698，保留 Raw#697 -> Raw#699 前向路线。
3. 加入 batch、streaming recognizer 和真实 evidence 回归。

V17.10.2 已完成：

1. 给 `position_snap_recovery` 增加短窗口多点交通恢复回摆清理。
2. 覆盖真实 watchOS Raw#375-378，保留 Raw#379 恢复锚点和 Raw#381 后续交通路线。
3. 加入 batch、streaming open window / local rebuild、真实 evidence 和直线交通反例。

下一步进入 V17.11 前，应继续人工复盘 crossing 和往返覆盖主方向样本；只有真实样本和
targeted synthetic case 都稳定后，才允许 crossing active 仲裁。
