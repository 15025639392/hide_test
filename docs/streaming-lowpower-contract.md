# 流式低功耗改造 · 逐场景状态契约

> 目标:把 `acceptance-web` 的清洗算法整改成**流式、有界内存、低功耗**,且清洗效果**不打折扣**(golden 逐字节可证)。
> 本表是内存上界证明 + 强制结算兜底依据 + 三端(Rust/Swift/Kotlin)缓冲翻译契约。
> 关联源码:`acceptance-web/src/track-cleaning/`。默认常量在 `sixLayerTrackProduct.mjs` 顶部 `DEFAULT_SIX_LAYER_TRACK_CONFIG`。

## 0. 核心结论

- **决策逻辑本身已是流式 + 有界窗口**:提交游标只被"激活的 metric-owner 情景区"钉住,平流区随流头前进(`scenarioWindowCoordinator.mjs:497` `computeCommitWatermark`)。
- 高功耗 **100% 来自状态表示契约**(per-advance JSON 深克隆、持久数组 spread、数组 `.includes()` 去重),非算法。
- 因此常驻内存上界 = **并发激活 metric-owner 窗口的并集跨度 + 前看余量 + 回看余量**,与轨迹总长解耦。
- 兑现这个上界要补三个缺口(见 §4)。

## 1. 通用状态载体(替换点缓冲)

| 记号 | 含义 | 大小 |
|---|---|---|
| **FOLD** | O(1) 折叠累加器:`n`, `first{id,ts,lat,lng}`, `last{…}`, `sumW, sumWLat, sumWLng`(w=1/max(acc,5)), bbox`{minLat,maxLat,minLng,maxLng}`, `sumSpeed, nSpeedFinite, nZeroSpeed(≤0.1)`, `coreN, coreFirstId, coreLastId` | 固定 ~20 标量 |
| **FOLD+D2** | FOLD 外加两个 running-argmax/argmin 近似:`runRepId`(对 running center 最近点)、`runRadius`(对 running center 最大距) | +2 标量 |
| **SIMP[cap]** | 有界点数组(仅 id,lat,lng,ts + kept 相关字段),撞 cap 或闭窗时跑**精确 RDP** | ≤cap 点 |
| **SNAP-k** | 窗口 open 瞬间把窗口起点前 k 个可信点拷进窗口状态,之后不再依赖已提交 track | k 点 |
| **TAIL-k** | 维护最近 k 个可信 track 点的滑动窗(供单点判断的前后看) | k 点 |

**D2 决策**(已采纳):`runRadius`/`runRepId` 是对*最终*质心的 argmax/argmin,严格 O(1) 折叠无法逐字节复现。它们**不改锚点坐标、不改任何指标**(纯溯源/诊断)。→ 走 running 近似,golden 对这两个 provenance 字段放宽为容差;清洗效果零影响。

## 2. 场景分类总览

| 型 | 判据 | A 方案形态 | 无损性 | 内存 |
|---|---|---|---|---|
| **单点(A)** | `influenceRange = range(id,id)` | 即判即吐,无缓冲 | 无损 | O(1) |
| **折叠(fold)** | 塌缩成单锚点,锚点=组内归约 | FOLD(+D2) | 真无损(除 2 个 provenance 字段) | **O(1),窗口可永久开** |
| **抽稀(simplify)** | RDP/中心线,输出多点 | SIMP[cap] + 闭窗精确 RDP | 真实数据无损;病态输入用 1 接缝换有界 | O(段长)≤cap |
| **上下文(context)** | `metricOwner:false`,不钉游标 | 见 §3 注意事项 | — | 需独立有界窗 |

**为何抽稀型不能 O(1) 无损**:RDP(`streamingLocalRebuild.mjs:892` `simplifySpanByDistance`)锚定整段首尾算最大垂距,窗口延长→终点变→基准线变→保留点集可被追溯性改写→**前缀在闭窗前不稳定**。必须缓冲整段。但几何 gate(bbox 上限 + 前向净移动)已把真实段长压到上百点量级;防御性 cap 设在其上,真实数据永不触顶→零接缝损失。

## 3. 逐场景契约

| # | scenario | 型 | 状态载体 | 闭窗条件 | 防御 cap 常量(默认) | 回看 |
|---|---|---|---|---|---|---|
| 1 | `gap_recovery_boundary` | 单点 | — | 即时 | — | — |
| 2 | `transport_contamination` | 单点 | — | 即时 | — | — |
| 3 | `pressure_jump` | 单点 | — | 即时 | — | — |
| 4 | `moving_spike_cleanup` | 单点* | TAIL-4 | next 点到达 | — (O(1)) | 前看 2 可信点(afterNext) |
| 5 | `stationary_drift_collapse` | 折叠 | FOLD+D2 | 组停止延伸/bbox 超限 | 无需(fold 吸收无界) | — |
| 6 | `dwell_drift` | 折叠 | FOLD+D2 | 同上(同一代码路径) | 无需 | — |
| 7 | `enclosed_loop_cluster_settlement` | 折叠 | FOLD+D2 + SNAP-1 | 簇停止到达游标 | 间接受 closed-loop 900 跨度约束 | 走廊锚 `track[start-1]`,`track[end+1]` → SNAP-1 |
| 8 | `weak_recovery_endpoint`(closed) | 折叠 | FOLD+D2 + SNAP | eligible 组停止延伸 | 硬:`weakRecoveryShapeMinSamples`(3)+`MaxExtensionSamples`(5)=8 | **pre-gap 锚**(任意深)→ SNAP at open |
| 9 | `weak_recovery_shape`(open pending) | 折叠 | FOLD + SNAP | 弱链停止到达 latest | **需加防御 cap**(pending 组无上限) | 同上 SNAP |
| 10 | `position_snap_recovery` | 折叠* | FOLD + SNAP-1 | recovery+continuation 到位/transport 尾超限 | 硬:`…UnstablePrefixMaxTransportPoints`(4),`MaxRawPointSpan`(8) | previous 稳定点 → SNAP-1 |
| 11 | `dense_main_route_settlement` | 抽稀 | SIMP[cap] | 非 dense 点打断/bbox>120 | **需加防御 cap**;gate `denseMainRouteMaxBboxMeters`(120) | — |
| 12 | `rest_photo_micro_move` | 抽稀 | SIMP[25] | span 达 max/dur>300/bbox>25 | 硬:`restPhotoMicroMoveMaxTrackPoints`(25),`MaxDurationSeconds`(300) | — |
| 13 | `round_trip_line` | 抽稀 | SIMP[540] | 往返完成于游标下/id 跨度超限 | 硬:`roundTripLineMaxRawPointIdSpanBefore`(240)+`After`(300)=540 | — |
| 14 | `same_road_round_trip` | 抽稀 | SIMP[540] | 同 #13 | 硬:同 540 | — |
| 15 | `dense_area_intent` | 上下文 | 见 §3 注 | 无窗;gap 打断 20s | — (不钉游标) | — |
| 16 | `closed_loop_round_trip` | 上下文 | 见 §3 注 | 无窗 | 硬:`…MaxTrackPoints`(180)/`MaxRawPointIdSpan`(900) | — |
| 17 | `enclosed_gap_cluster` | 上下文 | 见 §3 注 | 无窗 | min `…MinRawPointIdSpan`(200),无 max | — |
| 18 | `composite_gap_local_settlement` | 上下文 | 见 §3 注 | 无窗 | 硬:540 | — |

\* `moving_spike`/`position_snap` 实为小 O(1) 窗,归入折叠列表便于统一处理。

**§3 注 · 上下文型(context-only)的独立难点**:#15–18 是 `metricOwner:false`,**不钉提交游标→不阻塞释放**,但它们每 advance 从 `baseKernel.track` 重算,读取跨度较宽(如 `enclosed_gap_cluster` 最小 200 id 跨度)。若按游标裁剪 track,它们会丢失输入。→ 必须给上下文型一个**独立的有界诊断窗**(按各自最大 influence 跨度设),或改成增量计算。**这是尚未验证的开放项**,不能靠"它不钉游标"就以为免费。

## 4. 三个必补缺口

1. **C 类补强制结算兜底**(#9 weak_recovery pending、#11 dense_main_route):加"最大点数/时长/id 跨度"防御 cap,触顶强制结算。折叠型(#5/#6)因 FOLD 吸收无界,**无需 cap**。
2. **回看锚快照化**(#7/#8/#9/#10):窗口 open 瞬间把 pre-gap 锚 / 前一可信点拷进窗口状态(SNAP)。回看从"读全局历史"变"读窗口内快照"→ 可安全释放已提交 track。**#8/#9 的 pre-gap 锚深度任意,是"提交即释放"的头号威胁,必须 SNAP。**
3. **track 按 `min(committedCursor, 所有开窗起点 − 回看余量)` 裁剪**,兑现释放(今天 `pruneStreamingBaseTrackKernelForSettlement` 只裁 `rawPointTimeline`,`track` 从不释放,`streamingBaseTrackKernel.mjs:81`)。

## 5. 全局余量

- **前看**:默认 `lookaheadRawPoints=0`;算法级最深 = `moving_spike` 读 `track[index+2]` = **2 可信点**。
- **回看**:`position_snap`/`enclosed_loop` = 1 点(SNAP-1);`weak_recovery` pre-gap 锚 = 任意深(SNAP at open)。
- **深克隆**:9 个模块 `create*State` 全用 `JSON.parse(JSON.stringify)`,每 advance 递归重建全状态 → 改可变就地更新 + 只读视图,是与本表并行的纯性能项(零算法风险)。

## 6. 验收(目标驱动)

- **无损门**:现有 acceptance-web 全绿 + golden 逐字节 diff=0(除 D2 放宽的 `cloudWeightedRadiusMeters`/`representativeRawPointId` 走容差)。**分区验证**:平流区点须在"流头−lookahead"处已提交;情景区点在闭窗后提交。
- **有界门**:注入"单个超长情景区"极端轨迹(原地高频抖动几小时 / <120m 密集踱步几小时),峰值常驻内存不超 `maxScenarioSpan + lookahead + backMargin` 理论上界;强制结算兜底触发时输出符合预定义降级契约。
- **边界集**:5 万点长轨迹、乱序注入、极密采样、长时间静止、交织往返。

## 7. 落地进度

已实现并验证(golden 逐字节 diff=0 + 234 单测零回归):

- [x] **L1a** 去 per-advance JSON 深克隆(元素恒等共享)——峰值 heap 显著下降。
- [x] **recognizer 扫描窗口化**——只扫 `[committedCursor-margin, head]`,不再全量重扫。
- [x] **SNAP(缺口二)** weak_recovery pre-gap 锚快照进 recognizer 状态(`carriedTrustedTrackPoints`,bounded ring N=128),使其回看有界、扫描可 bound;margin 因此收到 64。
- 实测(gnss 38857 行 fixture 前 8000 行):总耗时 **378s → 4.8s(~79x)**,per-chunk slope **497x → 2.1x**(O(n²)→O(n),每 advance 工作量恒定),峰值 heap 310MB → 104MB。

待办:

- [ ] **L3 存储裁剪 + L4 输出 flush**:兑现常驻内存有界(当前仅*扫描/回看*有界,baseKernel 仍存全量 track/events/decisions)。这是"低功耗"从"计算有界"走到"内存也有界"的最后一段。
- [ ] 验证上下文型(#15–18)的独立有界窗方案(§3 注)。
- [ ] 定 #9/#11 防御 cap 的具体数值 + C 类 forced-settlement,防病态永不闭窗撑大未提交区(margin 有界依赖游标正常推进)。
- [ ] 迟到/乱序容忍窗口定义:裁剪后迟到到已释放窗口的点如何处理,及其对旧"全量保留"行为的输出差异是否接受。
