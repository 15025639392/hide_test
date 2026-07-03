# Streaming Scenario Window Settlement Plan

本文定义实时轨迹引擎如何用有限内存处理情景窗口、窗口重叠和确定性结算。
目标是让实时记录和离线 replay 使用同一套 streaming engine：同一份
platform-neutral evidence 输入，应得到同一份最终结果。

本文是设计和落地计划，不改变当前 Android v3 策略阈值、Web V17.9 输出、
replay fixture 期望或诊断 schema。第一步落地在 acceptance-web 的纯函数
coordinator，用于固化 overlap / conflict 规则，再逐步接入现有 recognizer。

## 目标

```text
Platform-neutral evidence stream
  -> base safety kernel
  -> scenario window recognizers
  -> settlement proposals
  -> SettlementCoordinator
  -> committed final result
```

关键目标：

- 正常段按流式基础内核即时结算，内存近似 O(1)。
- 只有进入情景窗口期的局部片段持有 bounded context，内存 O(k)。
- 情景窗口可以重叠，但只能产出 proposal，不能直接 commit。
- 指标结算必须按 gate 有唯一 owner：同一 raw point 的同一个 metric gate 不能被多个
  active settlement 重复结算。
- 解释可以重叠；不同 metric gate 可以重叠；同一 metric gate 不能重叠。
- replay 不是另一个离线真策略，而是同一 streaming engine 的重放验证。

## 非目标

- 不要求把当前 Web 全量数组实现一次性改成 streaming engine。
- 不把完整 Web settlement 挪到 Android 实时链路。
- 不用情景窗口覆盖 intake、GAP、pause、transport 等基础硬边界。
- 不让资源 cap 退化成“结束后再算”；cap 必须有确定性 conservative settlement。

## 核心不变量

1. Base safety kernel 先于所有情景运行，输出 immutable base decision。
2. Scenario recognizer 只读取 base decision 和 bounded evidence window。
3. Scenario window 只输出 `ScenarioProposal`。
4. `SettlementCoordinator` 是唯一能决定 active metric owner 的模块。
5. Hard boundary 优先于所有 rewrite：intake reject、GAP reset、pause、transport
   contamination、pressure jump reset 不能被大范围几何 settlement 跨过去。
6. 所有输出必须可由同一 evidence 顺序确定性重放。

## 实时状态模型

```text
StreamingTrackEngineState:
  baseState
  committedCursor
  committedRanges[]
  hardBoundaryCheckpoints[]
  blockingRanges[]
  openWindows[]
  proposalBuffer[]
  settlementCoordinator
  recentEvidenceBuffer
  metricAccumulator
```

正常样本流：

```text
sample -> baseDecision
if no scenario window:
  commit baseDecision
else:
  update open windows
  maybe emit proposals
  coordinator decides commit watermark
```

情景样本流：

```text
open window
  -> update with base decisions
  -> close / timeout / cap
  -> emit proposal
  -> coordinator arbitrates overlaps
  -> commit deterministic settlement
```

## ScenarioWindow 协议

每类情景只实现五个动作：

```text
shouldOpen(sample, baseDecision, state) -> boolean
update(window, sample, baseDecision) -> window
canClose(window, state) -> boolean
settle(window) -> ScenarioProposal
defer(window, reason) -> ScenarioProposal
```

窗口必须有上限：

```text
ScenarioWindow:
  id
  type
  state = open / settling / closed / deferred
  rawRange
  timeRange
  influenceRange
  triggerFacts[]
  closeEvidence[]
  riskFlags[]
  maxRawPoints
  maxDurationSeconds
  maxDistanceMeters
```

`rawRange` 表示窗口直接观察到的 raw 覆盖范围。`influenceRange` 表示该 proposal
可能改写指标的 raw 范围。commit watermark 必须按 `influenceRange` 判断。

## ScenarioProposal

```text
ScenarioProposal:
  id
  scenario
  rawRange
  influenceRange
  metricRange optional
  hardBoundary = true / false
  metricOwner = true / false
  priority
  confidence
  action
  localRebuild
  affectedMetricGates[]
  compatibilityTags[]
  parentProposalId optional
  conservativeFallback optional
  evidence
```

字段说明：

| Field | Notes |
| --- | --- |
| `hardBoundary` | GAP、pause、transport、pressure jump 等硬边界。硬边界切分其他 proposal。 |
| `metricOwner` | 是否申请拥有该范围内的距离、运动时间、elevation 指标结算权。 |
| `metricRange` | 实际申请指标 ownership 的 raw 范围；默认等于 `influenceRange`。 |
| `compatibilityTags` | 用于 nested / adjacent / context-only 兼容判断。 |
| `conservativeFallback` | 冲突无法安全解决时的确定性保守方案。 |

Diagnostic-only proposal 必须 `metricOwner=false`，可以和任何 active metric owner
重叠，只进入解释上下文。

## 窗口类型和默认优先级

| Type | Examples | Priority | Metric owner |
| --- | --- | ---: | --- |
| hard boundary | `gap_recovery_boundary`, `pause_resume_boundary`, `transport_contamination`, `pressure_jump` | 10 | yes |
| recovery / point cleanup | `weak_recovery_endpoint`, `moving_spike_cleanup`, `position_snap_recovery` | 10 / 20 | yes |
| stationary / micro move | `stationary_drift_collapse`, `rest_photo_micro_move` | 30 | yes |
| occlusion loop settlement | `enclosed_loop_cluster_settlement` | 25 | yes |
| dense / route settlement | `dense_main_route_settlement`, `same_road_round_trip`, `round_trip_line` | 40 | yes |
| diagnostic context | `dense_area_intent`, `closed_loop_round_trip`, `enclosed_gap_cluster`, `composite_gap_local_settlement` | 90 | no |

priority 越小越强。priority 只能作为排序输入，不能绕过 hard boundary。

## Overlap 分类

两个 proposal 的 `metricRange` 关系必须被分类：

```text
disjoint       无重叠
adjacent       只共享边界
nested         一个完全包含另一个
partial        部分交叠
equal          完全相同
crossing       overlap 后无法通过硬边界或父子关系解释
```

处理规则：

| Relation | Rule |
| --- | --- |
| `disjoint` | 两者都可 active。 |
| `adjacent` | 两者都可 active，但不能跨边界累计。 |
| `nested` | 子 proposal 可先执行；父 proposal 的指标 ownership 必须切成剩余范围，原父 proposal 保留为 context 解释。 |
| `equal` | 按 priority、confidence、id deterministic 选择一个 active，另一个降为 context。 |
| `partial` | 尝试按 hard boundary 或稳定 anchor 切分；切不开则 conflict fallback。 |
| `crossing` | 不做激进 rewrite，使用 conservative fallback。 |

metric-owning proposal 的重叠按 `affectedMetricGates` 仲裁：缺省或空 gates 视为全指标，
保持旧 proposal 的保守行为；只有双方都显式声明 gates 且交集为空时，才允许同一
`metricRange` 同时 active。典型例子是 `pressure_jump(elevation)` 可以与
`dense_main_route_settlement(route,distance,moving_time)` 重叠；但两个都影响
`distance` 的窗口仍必须切分、降级或阻塞。

Hard boundary 是特殊 nested blocker：如果一个大范围 proposal 完全包含 GAP、pause、
transport 或 pressure reset 这类硬边界，父 proposal 必须在边界两侧切成剩余 ownership；
不能跨边界继续累计，也不能因为边界存在就丢掉边界外已经安全的范围。

## SettlementCoordinator 职责

`SettlementCoordinator` 输入一批 closed proposals，输出：

```text
SettlementPlan:
  activeProposals[]
  contextProposals[]
  rejectedProposals[]
  conflicts[]
  ownership[]
  commitWatermark
  commitPlan
```

职责：

1. normalize proposal range。
2. hard boundary 切分其他 proposal 的 metric range。
3. 按 deterministic order 排序。
4. 解决 nested / equal / partial / crossing。
5. 保证同一 metric gate 的 metric ownership 不重叠。
6. 计算 commit watermark。
7. 按 active hard boundary 和 unresolved blocker 生成 `commitPlan`，供实时封段器消费。

deterministic order：

```text
hardBoundary desc
priority asc
confidence desc
range length asc for cleanup, desc for broad route settlement
startRawPointId asc
proposal id asc
```

## Commit Watermark

实时引擎只能 commit 早于 watermark 且不在任何 unresolved metric-owning window
`influenceRange` 内的结果。

```text
if open metric-owning windows exist:
  watermark = min(window.influenceRange.startRawPointId)
else if unresolved conflicts exist:
  watermark = min(conflict.range.startRawPointId)
else:
  watermark = latest closed proposal end or current raw id - realtime lookahead
```

Diagnostic-only 窗口不阻塞 watermark。

`commitPlan` 是给实时封段器的稳定结构：

```text
CommitPlan:
  status = committable / blocked_at_watermark
  startRawPointId
  endRawPointId
  commitWatermark
  hardBoundaries[]
  blockingRanges[]
  committableRanges[]
```

`blockingRanges[]` 必须带 `affectedMetricGates[]`：open window blocker 使用该 window
声明的 gates，缺省按全指标处理；unresolved conflict blocker 使用双方实际相交的
gates。这样低内存实时链路和 review queue 可以区分“同 gate 阻塞”和“异 gate 可重叠”。

`committableRanges[]` 会被 hard boundary 切分：

```text
normal range
hard_boundary range
normal range
```

当存在 open metric window 或 unresolved partial/crossing conflict 时，
`status=blocked_at_watermark`，`blockingRanges[]` 记录阻塞原因，`committableRanges[]`
只到 blocker 起点之前。这样实时链路不会为了节省内存而跨未关闭情景窗口提交指标。

`StreamingSettlementState` 消费 `commitPlan` 后产出可持久化状态：

```text
StreamingSettlementState:
  committedCursorRawPointId
  commitSequence
  committedRanges[]
  committedMetricOwnershipRanges[]
  hardBoundaryCheckpoints[]
  blockingRanges[]
  lastCommitPlanStatus
  lastCommitWatermark
```

状态更新必须幂等：同一个 `commitPlan` 重复应用时，已经提交的 raw range 不能重复写入。
当 blocker 关闭后，新 plan 从 `committedCursorRawPointId + 1` 继续提交。

## Incremental Session API

实时引擎不能只在完整 session 结束后生成一次 `commitPlan`。平台中立实现需要暴露
一个可持续推进的 session 状态：

```text
StreamingScenarioSettlementSession:
  settlementState: StreamingSettlementState
  pendingProposals[]
  openWindows[]
  lastSettlementPlan
  lastInputSummary
```

每个采样批次或 recognizer tick 调用：

```text
advanceStreamingScenarioSettlementSession(previousSession, input)
  input:
    firstRawPointId optional
    currentRawPointId
    lookaheadRawPoints default 0
    openWindows[]
    closedProposals[]
    retiredProposalIds[]

  output:
    nextSession
```

处理规则：

1. `pendingProposals[]` 保存已经关闭但尚未完全提交的 proposal。
2. `openWindows[]` 中 `metricOwner=true` 的窗口阻塞 commit watermark；
   diagnostic-only 窗口不阻塞。
3. `closedProposals[]` 按 id 合并进 pending buffer，同 id proposal 以后来的为准。
4. `retiredProposalIds[]` 用于移除已被更高层保守 fallback 或人工规则废弃的 proposal。
5. `SettlementCoordinator` 每批重新仲裁 pending proposals + open windows。
6. `StreamingSettlementState` 只提交 `committedCursorRawPointId + 1` 之后的新范围。
7. cursor 之后仍未提交的 proposal 留在 pending buffer；已经完全提交的 proposal 被裁剪。

这让实时链路满足两个条件：

- 没有情景窗口时，基础内核可以持续提交，内存近似 O(1)。
- 有情景窗口或 overlap conflict 时，只保留 cursor 附近的 bounded proposal/window
  状态，不需要保存完整 session 才能得到最终结果。

当前 Web 原型落地文件：

```text
acceptance-web/src/scenarioWindowCoordinator.mjs
acceptance-web/src/streamingSettlementState.mjs
acceptance-web/src/streamingScenarioSettlementSession.mjs
```

## Resource Cap 和 Conservative Settlement

每个窗口必须定义 cap。达到 cap 时不能无限 pending，也不能只说离线再算。

推荐 fallback：

| Window | Cap fallback |
| --- | --- |
| weak recovery | 保留恢复边界锚点，距离/运动时间/elevation delta 为 0。 |
| stationary drift | 压成 stationary anchor 或保守暂停计距。 |
| transport | 交通风险段不计徒步距离、运动时间和 elevation。 |
| pressure jump | reset barometer elevation anchor，不跨 jump 累计。 |
| same-road / dense | 保留基础安全内核结果，标记 `deferred_context_only`，不做大范围 rewrite。 |

cap fallback 也是最终结算结果，replay 必须一致。

## 第一阶段落地

1. 新增 acceptance-web 纯函数 `scenarioWindowCoordinator.mjs`。
2. 覆盖 hard boundary、nested cleanup、equal conflict、diagnostic overlap、
   partial conflict fallback。
3. 从现有 `scenarios[]` 旁路生成 `scenarioSettlementPlan`，输出 proposal 仲裁、
   metric ownership 和 `commitPlan`，但不改变 V17.9 轨迹、距离、运动时间和场景解释。
4. 新增 `streamingSettlementState.mjs`，把 `commitPlan` 应用为
   `committedCursorRawPointId`、`committedRanges[]`、`hardBoundaryCheckpoints[]`
   和 `blockingRanges[]`。
5. 后续把现有 `forwardSpineDecisions[]`、`denseIntentConflicts[]` 和场景 settlement
   逐步迁移为 proposal 输入。

## 第二阶段落地

1. 新增 `streamingScenarioSettlementSession.mjs`。
2. 支持多批次输入：正常批次直接推进 cursor；open metric window 只提交安全前缀；
   window 关闭后从 cursor 后继续提交。
3. 支持 hard boundary checkpoint 跨批次持久化。
4. 支持 unresolved partial overlap 留在 pending buffer，直到 proposal 被替换、
   退休或进入 conservative fallback。
5. 支持 nested parent splitting：小范围清洗/局部 settlement 先拥有指标，父窗口保留
   context 解释，并在未被子窗口占用的剩余 raw range 上继续拥有指标。
6. 支持 hard boundary parent splitting：父窗口不能跨 GAP / transport / pressure
   reset 等硬边界，但可以在边界两侧的剩余 raw range 继续拥有指标。
7. 修正 coordinator 的数值归一化：`null`、`undefined` 和空字符串不能被误当成
   raw point `0`。

## 第三阶段落地

1. 新增 `streamingEvidenceIntake.mjs`，支持平台中立 JSONL 分片、尾行缓存、
   `sessionId + eventSeq` 去重和乱序计数。
2. 新增 `streamingBaseTrackKernel.mjs`，覆盖基础 intake、首点 anchor、普通移动、
   GAP fast-path 恢复和 raw decision 诊断保留。
3. base kernel 接入有界最近 `motion_window` / `device_motion_window` 活动摘要，
   支持 `motion_supported_low_speed` 这类不需要长情景窗口的活动门控。
4. 新增 `streamingMetricAccumulator.mjs`，把 `barometer_window` 作为流式 metric
   evidence 累计，优先使用 `windowAscentMeters` / `windowDescentMeters`，并保留累计下降。
5. commit plan 新增 `metricOwnershipRanges[]`，把安全前缀内的指标 range 分配给
   `base_kernel`、具体 scenario owner 或 hard boundary；相邻同 owner range 合并。
6. `streamingMetricSnapshot()` 暴露 settlement 视图，让实时产品区分 evidence 累计值
   和已经安全提交的产品指标范围。
7. base kernel 新增 `rawPointTimeline[]` 轻量时间索引；barometer window 按
   committed raw ownership range 的时间重叠比例切片，open window 后的爬升/下降只作为
   evidence 累计值，不能成为 committed product metric。
8. committed barometer metric 改为增量状态：每批只消费
   `lastAppliedMetricOwnershipRanges[]`，随后裁剪已安全提交之前的 `rawPointTimeline`
   和 barometer diagnostic buffer。
9. 新增 `streamingScenarioRecognizer.mjs`，先接入 `gap_recovery_boundary`、
   `transport_contamination`、`pressure_jump`、`moving_spike_cleanup`、
   `position_snap_recovery`、`stationary_drift_collapse` 和
   `rest_photo_micro_move` 的 proposal 生成；随后接入
   `dense_main_route_settlement`、`round_trip_line` 和 `same_road_round_trip` 的有界窗口
   proposal。recognizer 只生成 proposal / open window，不直接改写 track。
10. 新增 `streamingTrackEngine.mjs`，把 evidence intake、base kernel、
   metric accumulator 和 scenario settlement session 串成同一流式状态推进。
11. `transport_contamination` 在实时流式原型中按单个 transport raw point 生成稳定
    硬边界，来源包括 `transport_risk` rejected、`transport_recovery_pending` weak，
    以及为诊断连续性保留的 `recovery_transport_suspected_kept` /
    `transport_suspected_kept` kept TrackPoint；proposal evidence 区分 rejected /
    pending / kept raw ids，避免后续连续污染点扩容同一 proposal 导致已提交前缀被改写。
12. `pressure_jump` 从 `pressure_jump_detected` barometer window 映射到最近 raw
    timeline 边界点，只关闭 elevation gate，不影响水平 route / distance /
    moving time 的基础提交。
13. `stationary_drift_collapse` 在实时流式原型中来自连续
    `stationary_cloud_jitter` rejected 云；当前 raw 仍在云内时只保留 open window，
    退出云或 finish 后才关闭 proposal。
14. `rest_photo_micro_move` 在实时流式原型中来自可信 track 的小范围折返窗口；
    为了避免窗口继续扩容后改写已提交前缀，默认等达到
    `restPhotoMicroMoveMaxTrackPoints` 或 finish 后才关闭，未闭合时只阻塞安全前缀。
15. 新增 `streamingLocalRebuild.mjs`，消费
    `lastAppliedMetricOwnershipRanges[]` 生成只追加的 committed product track view；
    当前覆盖 `stationary_drift_anchor`、`rest_photo_micro_move_anchor` 和
    `rest_photo_micro_move_simplifier`，未覆盖场景走 base passthrough fallback 并计入
    `unsupportedScenarioCount`。
16. `streamingLocalRebuild.mjs` 继续接入 `moving_spike_line_bridge` 和
    `position_snap_recovery_anchor`：前者把尖刺 raw 放入 `suppressedRawPointIds` 并桥接
    next 点距离/时间；后者把恢复点置零并吸收前序弱点 raw。`transport_contamination`
    不产出徒步产品点，GAP / pressure 已知边界不计入 unsupported。
17. base kernel / recognizer / local rebuild 已覆盖 GAP 后 recovery transport continuity：
    `gap_recovery_pending` 后的连续疑似交通工具点可作为 kept 诊断点保留，
    recognizer 为每个 kept transport raw point 生成硬边界，local rebuild 只保留
    徒步产品点，不把该段计入 trusted GPX、distance 或 moving time。
18. `dense_main_route_settlement` 已接入实时流式原型：连续可信移动点在窗口退出或
    finish 后生成 `dense_main_route_skeleton` proposal；local rebuild 只消费已提交
    ownership，把 kept raw point 输出为主路线骨架，并按骨架重算 distance、按压缩组累加
    moving time。窗口仍在最新点上时只输出 open window 阻塞安全前缀。
19. `round_trip_line` / `same_road_round_trip` 的 local rebuild 应用层已接入：
    streaming settlement 收到外部或后续 recognizer 生成的 route proposal 后，
    `round_trip_polyline` 会按折返点两侧 RDP 简化折线，`same_road_centerline` 会用去程 /
    返程路径比例采样生成中心线。两者都只消费已提交 ownership，不直接改写 base kernel。
20. `round_trip_line` / `same_road_round_trip` 的基础几何自动 recognizer 已接入：
    可信 TrackPoint 满足 start/end 接近、turn 距离足够、cross-track 有界时生成 route
    proposal；same-road 几何更强时优先生成 `same_road_round_trip`。候选仍贴着最新点时只
    输出 open window，退出或 finish 后才关闭 proposal。
21. GNSS altitude fallback 和 elevation ownership 已接入 streaming metric settlement：
    base kernel 在可信 TrackPoint 保留 `altitude` / `verticalAccuracy`，metric
    accumulator 只消费 `lastAppliedMetricOwnershipRanges[]` 中已提交的点；barometer
    committed evidence 不足时选择 GNSS，elevation hard boundary 会关闭对应点的
    elevation gate 并重置 GNSS altitude anchor，禁止跨边界累计爬升/下降。
22. `dense_area_intent` / `closed_loop_round_trip` diagnostic context 已接入 streaming
    recognizer：`dense_area_intent` 对可信密集窗口输出
    `forward_motion / stationary / round_trip / gap_cluster / mixed` intent；
    `closed_loop_round_trip` 标注不需要 route rewrite 的闭合回环。两者都
    `metricOwner=false`、`affectedMetricGates=[]`，进入 settlement `contextProposals`，
    不阻塞 commit、不占 metric ownership、不改写 product track。
23. round-trip intent / composite gap guard / dense intent conflict review 已接入 streaming
    diagnostic context：`same_road_round_trip` / `round_trip_line` evidence 会记录重叠
    dense intent 与 `roundTripIntentSupported`；no-intent composite guard 拒绝的
    round-trip 候选会生成 `composite_gap_local_settlement` context；`dense_area_intent`
    evidence 会记录 `observedMetricScenarios[]` 和 `conflictReview[]`，只用于复盘，不
    拥有指标。
24. `enclosed_gap_cluster` / composite guard 复盘证据已接入 streaming diagnostic
    context：GAP recovery 与 stationary anchor 围住的小 bbox 窗口会生成
    `enclosed_gap_cluster` context，并记录 `anchorRawPointIds[]`、segment、bbox、
    duration、重叠 dense intent 和 `gapClusterIntentSupported`；被 composite guard
    拒绝的 round-trip candidate 会额外记录 turn / endpoint raw id。两类 context 都
    `metricOwner=false`、`affectedMetricGates=[]`，允许与 dense intent 重叠，但不能
    阻塞 commit 或产生 metric ownership。
25. streaming diagnostic context report 已接入最终输出：`buildTargetOutput()` 和
    `advanceStreamingTrackEngine().lastAdvanceSummary` 都会输出
    `streamingDiagnosticContexts`，从 settlement `contextProposals[]` 中只汇总
    `metricOwner=false` context，保留 scenario counts、raw range、anchor raw ids、
    action/localRebuild 和 compact evidence。该 report 只用于 review/report 和跨端对齐，
    不参与判点、指标 ownership 或 GPX 导出。
26. 真实 regression 已开始覆盖 streaming diagnostic context report：
    `5ccf3a9f-1d85-4c2b-8b24-61839d459845` 会验证
    `composite_gap_local_settlement` 在最终 report 中保留 rejection reason、
    same-road evidence、anchor raw ids 且 `metricOwner=false`；
    `closed_loop_round_trip` 会验证闭合回环只作为 diagnostic context，不抢指标。
27. Android legacy replay fixtures 已接入 Web 平台中立 regression：
    `androidReplayFixtures.test.mjs` 会读取 `app/src/test/resources/replay-fixtures/`
    中的正常徒步、弱起点、GAP 恢复、静止恢复、交通混入和有运动证据的慢恢复样本，
    验证 Web 目标函数不跨 GAP 计距、不把弱点或交通点计入徒步指标，并能正常消费
    legacy `raw_location` / `device_motion_window` evidence。
28. `weak_recovery_endpoint` 已接入 streaming recognizer / local rebuild：
    GAP 后连续 `gap_recovery_pending` 弱点云在满足样本数、半径、最佳精度和离前可信点距离
    后，会生成 `hardBoundary=true` 的 `weak_recovery_shape_anchor`。该锚点进入产品轨迹，
    但 distance、moving time 和 elevation delta 全部为 0；窗口仍贴着最新 raw 时只输出
    open window，等待闭合后再提交，避免低性能设备为了省内存跨弱恢复端点提前封段。
29. `enclosed_loop_cluster_settlement` 已接入 streaming recognizer / local rebuild：
    闭合回环内被 GAP recovery 与 stationary anchor 包围的小 bbox 聚集窗口，会在
    finish 或窗口退出后生成 `enclosed_loop_anchor_settlement` metric proposal；窗口仍贴着
    最新 raw 时只输出 metric-owning open window 阻塞 cursor。local rebuild 只保留 proposal
    指定的少量锚点，把内部碎点并入贡献 raw，distance、moving time 和 ascent window 均为
    0，用于实时压住遮挡聚集产生的虚假折返距离。
30. `streamingDiagnosticContexts` 已接入 Web 审核队列和导出入口：`reviewQueue.mjs`
    会把 `metricOwner=false` 的 contexts 转成 `diagnostic_context` 任务，保留 raw range、
    anchor raw ids、action/localRebuild 和 compact evidence；UI 提供全部 / 指标 / 诊断 /
    高风险 / 待看筛选，并可导出当前筛选结果。diagnostic context 不计入高风险 metric-owner
    任务，不阻塞 commit、不产生 route / distance / moving_time / elevation ownership。
    `review-queue-v1` 同时携带平台中立 `streamingSettlementState`，使用
    `sampleId` / `sampleRange` 暴露安全封段水位、已提交 ownership、hard boundary checkpoint
    和带 `affectedMetricGates[]` 的 blocking ranges。
31. `review-queue-v1` 已有 headless 导出入口：`npm run export-review-queue -- <evidence.jsonl>`
    会在无浏览器环境下完成 evidence 解析、六层 product 重算和审核队列导出。该入口用于把
    真实 session 或 replay fixture 沉淀成可发给 AI / 端侧实现方的对齐包；默认 status 为
    `pending`，不写回 evidence，不改变算法输出。
32. headless 导出入口已支持目录批量模式：传入 replay fixture 或真实 session 目录时，
    会递归读取 `.jsonl` 并输出 `review-queue-batch-v1`，其中每个 `exports[]` 元素仍是
    独立的 `review-queue-v1`。Android legacy replay fixture 目录已纳入 Web 回归，验证
    `gap_recovery_boundary`、`transport_contamination` 等高风险任务可批量沉淀。
33. `ScenarioWindowCoordinator` 已按 `affectedMetricGates` 做 overlap 仲裁：缺省 gates
    仍按全指标保守处理；显式 disjoint gates 可以重叠 active，例如
    `pressure_jump(elevation)` 与
    `dense_main_route_settlement(route,distance,moving_time)`。共享 gate 的 partial
    overlap 仍会进入 deterministic conflict / blocked watermark。

## 后续接入顺序

1. 用真实 replay fixtures 继续覆盖弱恢复端点、遮挡聚集、休息恢复和同路往返混合场景。
2. 用 UI 或 headless 导出的 `review-queue-v1` / `review-queue-batch-v1` 结果沉淀跨端
   审核样本，验证 diagnostic context 与 metric owner 在真实重叠窗口中仍保持分离。

## 验收

- 同一 metric gate 的同一 raw range 不能出现两个 active metric owner；不同 gate
  可以重叠，但必须显式声明 `affectedMetricGates` 且交集为空。
- hard boundary 必须切断跨边界 proposal。
- diagnostic-only proposal 可以重叠，但不能拥有指标。
- `dense_area_intent` / `closed_loop_round_trip` 必须保持 `metricOwner=false`，只能作为
  `contextProposals`，不能阻塞安全前缀提交。
- `enclosed_gap_cluster` 必须保持 `metricOwner=false`；它可以与
  `dense_area_intent(gap_cluster)` 重叠，但只能作为 GAP / stationary 聚集复盘证据，
  不能产生 route、distance、moving time 或 elevation ownership。
- `composite_gap_local_settlement` 必须保持 `metricOwner=false`；它只能解释
  round-trip rewrite 为什么被 guard 拒绝，不能生成 route ownership。
- round-trip proposal 的 `roundTripIntentSupported` 必须来自重叠的
  `dense_area_intent(round_trip)`，不能由端侧私有字段直接注入。
- partial/crossing conflict 必须有 deterministic fallback。
- nested parent proposal 必须被切成互不重叠的剩余 ownership，不能整体丢成
  context-only。
- hard boundary parent proposal 必须在边界两侧切分，不能跨边界累计，也不能整体
  reject 掉边界外范围。
- commit plan 的 `metricOwnershipRanges[]` 对同一 metric gate 必须不重叠；不同 gate
  的 ownership range 可以重叠。相邻同 owner / 同 gates range 应合并，保持实时状态有界。
- committed barometer metric 必须按 raw ownership 时间范围切片；open window 或
  unresolved conflict 后的 elevation 不能提前进入 committed product metric。
- committed GNSS altitude metric 必须只消费已提交 ownership 内的可信 TrackPoint；
  barometer evidence 不足时才能成为 selected source，且 elevation gate 关闭的 hard
  boundary 不能产生跨边界高度 delta。
- committed metric 必须可增量推进；裁剪旧 `rawPointTimeline` / barometer buffer 后，
  已提交 ascent/descent 仍保持不变。
- committed product track 必须只消费 newly applied ownership；空推进不能重复追加已经
  提交的产品点。
- proposal 输入顺序打乱后，输出 plan 一致。
- 纯函数测试通过后，才能逐步接入 Web 六层算法。
- 增量 session 必须覆盖：正常批次提交、open window 阻塞、window 关闭恢复提交、
  hard boundary checkpoint 持久化、unresolved overlap pending 后再解除。
