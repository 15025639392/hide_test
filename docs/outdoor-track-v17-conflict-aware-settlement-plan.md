# Outdoor Track V17 Conflict-Aware Settlement Plan

本文是 V17 启动文档。V17 的目标不是继续扩散更多单点规则，而是把 V16.1 已经暴露出来的
`denseAreaSettlementPlan[]` 和 `denseIntentConflicts[]` 收敛成统一的 settlement 仲裁层。

V17 初期先做 review-only 计划和真实样本验收清单；只有当某类冲突在真实 evidence 上稳定后，
才允许升级为默认改线行为。

## 版本定位

当前稳定基线：

```text
six-layer-evidence-v16.1
```

V17 目标方向：

```text
six-layer-evidence-v17
```

V17 工作名：

```text
conflict-aware settlement orchestrator
```

一句话目标：

```text
密集区先保主意图和主路线候选，但所有局部情景都必须经过统一仲裁，再决定塌缩、抽稀、
保留端点、隔离交通，或只输出复盘冲突。
```

## 为什么需要 V17

V16.1 已证明一个关键问题：情景重建本身不一定稳定，密集区主意图也不一定总是局部正确。

典型例子：

- 大窗口粗看像 `forward_motion`，局部却是拍照、休息、小范围挪动。
- 同一段 raw 内可能同时叠加往返、遮挡恢复、停留漂移和交通污染。
- 只靠单个情景识别器改线，容易出现有的折返线没清掉、有的真实小移动被误清掉。
- UI 已经能看到冲突，但算法层还缺少一个统一的冲突裁决产物。

因此 V17 不应简单加阈值，而应把“候选解释”和“最终结算动作”分开。

## V17 核心产物

新增或稳定以下概念：

| 产物 | 作用 |
| --- | --- |
| `settlementCandidates[]` | 所有情景识别器只提交候选，不直接代表最终真值。 |
| `settlementConflicts[]` | 记录候选之间的冲突，例如主前进 vs 局部休息、往返 vs 交通污染。 |
| `settlementDecisions[]` | 统一仲裁后的决定：塌缩、抽稀、保留、隔离、只诊断。 |
| `settlementReviewFindings[]` | 给 UI 和人工验收看的中文复盘摘要。 |

V17 可以先把这些结构映射到现有 `scenarios[]`、`denseAreaSettlementPlan[]`、
`denseIntentConflicts[]` 上，不要求第一步重写全部识别器。

## 仲裁顺序

V17 settlement 仲裁建议采用固定顺序：

1. **Hard safety boundary**
   保留 intake、GAP、weak/reject、transport、altitude gate、GPX gate 等基础安全内核。

2. **Transport contamination isolation**
   交通污染优先隔离。疑似交通点不能因为主路线连续性被重新混入徒步距离。

3. **Dense intent and main spine**
   密集窗口先产出主意图和主路线候选，但只能作为候选骨架，不是最终答案。

4. **Local evidence override**
   小范围 bbox、低净距、高低速/静止支持、休息拍照微移动等局部证据，可以覆盖粗粒度
   `forward_motion`。

5. **Round-trip and endpoint preservation**
   往返、洞内/遮挡端点、进出口锚点不能被静止塌缩误删。

6. **Final settlement**
   同一 raw 区间只能有一个最终结算动作，其他命中情景保留为 explanation context。

## 冲突类型优先级

第一批 V17 只稳定这些冲突类型：

| 冲突类型 | 默认处理 |
| --- | --- |
| `local_micro_move_overrides_dense_forward` | 已在 V16.1 验证；局部休息/拍照微移动可覆盖粗粒度前进意图。 |
| `transport_overrides_forward_or_round_trip` | 先 review-only；交通污染不得进入徒步真值。 |
| `endpoint_preservation_overrides_collapse` | 先 review-only；弱恢复端点、洞内端点、往返折返点不能被局部塌缩吞掉。 |
| `stationary_overrides_dense_forward` | 先 review-only；整段净距、bbox 和运动证据都支持静止时，允许压成静止锚点。 |
| `round_trip_overrides_forward_spine` | 先 review-only；主方向看似前进但闭合/同路往返信号更强时，不应强保前进骨架。 |

除 `local_micro_move_overrides_dense_forward` 外，其余类型在 V17 初期不直接改线，只输出
结构化冲突和 UI 复盘。

## 真实样本验收清单

V17 第一轮必须继续使用真实 evidence 作为验收锚点。

| Session | Raw 区间 | V17 验收目标 |
| --- | --- | --- |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#1944-2014` | 保持休息/拍照微移动塌缩，不出现折返线。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#2461-2483` | 保持塌缩，不出现短折返。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#2795-2834` | 保持塌缩，不出现短折返。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#3192-3946` | 保持往返 + 轻微移动的 bounded distance；不可出现大距离波动。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#4562-4610` | 保持静止/休息微移动塌缩。 |
| `5ccf3a9f-1d85-4c2b-8b24-61839d459845` | `Raw#5050-5094` | 保持局部休息微移动覆盖 dense forward 冲突。 |
| `0ddf2d35-02e2-454c-9057-667265fe8a71` | `Raw#256-312` | 保持静止漂移塌缩为单锚点。 |
| `ddf59bff-9fe0-4527-96b2-94dd5016a8c4` | `Raw#32-42` | 用于交通工具混入/早期启动情景复盘；先 review-only，不急于改线。 |

## 不做范围

V17 启动阶段不做这些事：

- 不修改 Android 实时链路。
- 不改 `evidence.jsonl` schema。
- 不改 trusted GPX 输出口径。
- 不把 `gnss_snapshot` 升级为硬判点输入。
- 不在 UI 中展示不稳定规则说明。
- 不把所有密集区都强行塌缩或强行抽稀。
- 不让单个情景识别器直接绕过 settlement 仲裁。

## 实施分期

### V17.0 Review-Only

- 新增 `settlementCandidates[]` / `settlementConflicts[]` / `settlementDecisions[]` 的最小结构。
- 先从现有 dense intent、rest photo micro move、round trip、transport 场景中生成候选。
- UI 继续以冲突区间和中文解释为主，不展示完整规则说明。
- 所有新增冲突默认不改线，除 V16.1 已稳定的休息微移动覆盖 dense forward。

### V17.1 First Active Arbitration

- 只选择一个真实样本中稳定的冲突类型升级为 active settlement。
- 同步更新 strategy version、文档和测试。
- 必须证明不会破坏 V16.1 已锁定的真实 evidence 回归。

### V17.2 Fixture Hardening

- 将真实 Raw 区间沉淀成更小的 replay-like fixture 或 targeted synthetic case。
- 补齐交通污染、端点保留、往返覆盖主前进的固定测试。

## 验收标准

V17 任一 active 改线必须满足：

- 对应 raw 区间有明确人工预期。
- `scenarios[]` 仍保留所有候选解释。
- 最终只有一个 `settlementDecision` 负责改线。
- 被合并或删除的 raw point 必须进入 `contributingRawPointIds` 或诊断解释链。
- 距离、运动时间、爬升、GPX gate 的变化可解释。
- `npm test` 通过。
- 本机真实 evidence 回归通过。

## 下一步执行建议

下一步先实现 V17.0 review-only：

1. 在 `sixLayerTrackProduct.mjs` 中从现有 `scenarios[]` 生成 settlement candidate。
2. 把 V16.1 的 `denseIntentConflicts[]` 映射为第一批 `settlementConflicts[]`。
3. UI 右侧冲突详情优先展示 `settlementConflicts[]`，没有时回退 dense conflict。
4. 不改变当前清洗轨迹，先验证冲突列表是否比 V16.1 更完整、更稳定。
