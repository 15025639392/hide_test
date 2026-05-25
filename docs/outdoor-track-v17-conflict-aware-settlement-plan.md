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

V17 目标方向：

```text
six-layer-evidence-v17
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
| `forwardSpineOverlaps[]` | 候选之间的重叠、包含、端点相接、空间相交关系。 |
| `forwardSpineConflicts[]` | 无法直接合并的候选冲突，记录冲突类型和证据。 |
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
| `overlapping_forward_spine_candidates` | 同向或包含重叠；优先 merge/select。 |
| `crossing_forward_spine_candidates` | 空间相交但时间/方向不一致；review-only，切片后选主候选。 |
| `nested_forward_spine_candidate` | 短候选落在长候选内；默认短候选降级为 context。 |
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

- 从现有 dense main route settlement 生成 `forwardSpineCandidates[]`。
- 识别候选之间的 overlap、nested、crossing、endpoint-touch。
- 生成 `forwardSpineConflicts[]` 和中文 review finding。
- 不改变当前清洗轨迹。

### V17.1 Active Merge/Select

- 只启用同向重叠和包含候选的 merge/select。
- 不处理 crossing 为 active 改线。
- 必须证明不会破坏 V16.1 已锁定的真实 evidence 回归。

### V17.2 Crossing And Round-Trip Arbitration

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

下一步先实现 V17.0 review-only：

1. 为 `dense_main_route_settlement` 产出 `forwardSpineCandidates[]`。
2. 按 rawRange sweep-line 切出候选重叠子区间。
3. 识别同向、包含、交叉、端点相交、往返相交。
4. UI 冲突详情展示 forward spine conflict，并可点击定位地图。
5. 不改变当前清洗轨迹，先验证冲突列表是否准确反映“多个保方向互相叠加”的位置。
