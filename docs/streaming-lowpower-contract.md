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

已实现并验证(续,commit e9a22f1 / 29238fd / fac8987 / a29c19b):

- [x] **L3 存储裁剪**:baseKernel.track/decisions/excluded 裁到 `[cursor-128, head]`(gnss 8000 行 track 396→134)。
- [x] **增量 stats**:localRebuild 指标随点累加,去掉每 advance 全量 reduce。
- [x] **device 记录器模式(DEVICE_FLUSH)**:committedTrack flush 即弃 + intake.events 处理即弃 + 4 个去重键有界窗(N=1024)+ 超窗计数。三大内存主项(events/track/输出)在游标正常推进段与长度解耦。
- [x] **committedRanges 有界化(DEVICE_FLUSH)**:引擎 state 自身画像(排除 harness 源文件/GC)显示 6h 录制约 **544KB**,唯一单调增长向量是 `committedRanges`(提交区段账本,~1.3KB/1000 事件,48KB@6h)。它**仅供导出契约 + reviewQueue 诊断消费**,引擎前向 advance 不读全账本,故 device flush 下保留最近 N=512 段(超出计入 `committedRangesEvicted`)。offline 保持全量(reviewQueue 需要)。`committedMetricOwnershipRanges`/`hardBoundaryCheckpoints` 是运行时必需(metric accumulator 每 advance 读)不裁,前者自带相邻合并本就增长慢。默认 512 下 6h(161 段)不触发,仅多日连续录制封顶。

## 8. C 类深挖发现 —— 冲突死锁会丢数据(pre-existing 正确性 bug)

追查"完整轨迹某段游标 stall"时,定位到根因**不是**超长场景,而是**冲突死锁**:

- 两个重叠 `moving_spike_cleanup` 提案(如 `417-422-425` vs `390-417-422`)在同一指标 gate 上 `conservative_fallback`,**已选定 activeProposalId 却按住不提交**,committedCursor 冻结(gnss fixture 卡在 raw 416),直到 finish。
- **验证是引擎原始行为**(关闭 recognizer 窗口化同样复现),与本次性能改造无关。
- **更严重的是**:streaming 引擎**在 finish 时也没解开、直接丢弃该段**——批处理 `buildSixLayerTrackProduct`(算法 ground truth)对同一 fixture 提交了完整 1..598(含 417 accept),streaming 只提交到 ~416。**即冲突死锁导致 streaming 丢输出数据**,device 录制长轨迹会丢失此类冲突附近的区段。
- 试过"超时强制提交 activeProposalId":能解死锁、找回该段(357 点),但**既不等于批处理 330、也不等于 finish 326**,无法对齐任何 ground truth → 未验证正确,已撤销(不 ship 未验证的输出改动)。

**已修复(off `perf/streaming-lowpower-l1` 的 `fix/streaming-conflict-deadlock`)**:根因是**流式识别器发射了两个重叠的 moving_spike 提案,而批处理在生成场景前就用 `nonOverlappingMovingSpikeCandidates` 按几何分数(`detour*2+lateral`)贪心去重叠**。识别器 `emittedProposalIds` 累积、无法回撤已发射的低分提案,故在**协调器**(`coordinateScenarioProposals`,此处两个竞争提案必同时在 `pendingProposals` 中)复刻批处理同一去重叠规则:保留高分者 `417-422-425`(score 31.4)、丢弃低分者 `390-417-422`(score 28.3,标记 `moving_spike_overlap_superseded`),partial→`conservative_fallback` 冲突不再产生,watermark 不再冻结。修复后 gnss[:4200] 游标从 416 推进到 597,committedTrack 326→357,尖刺局部决策与批处理逐点同构(417 保留、422 桥接删除、415/416/418–426 删除)。回归验证:两条干净轨迹 committedTrack 不变(outdoor_v1 669、v1(3) 614),`npm test` 基线不变。

**残差(357 vs 批处理 330):独立的 pre-existing 分歧,不属本 bug**。死锁解开后 417–522 区段提交出来,暴露出**流式的 `rest_photo_micro_move`/`dense_area_intent` 场景不像批处理那样折叠**:批处理把 417–522 折成 2 点(439 一个 rest_photo 锚),流式保留 19 点(16 motion + 3 stationary_anchor)。这与 outdoor 干净轨迹上 stream 669≠batch 967 是同一类"流式非逐点等于批处理"的实现差异(流式 committedTrack **本就不逐点等于批处理**,已实测确认),与 moving_spike 死锁无关。故 357 不再作为"未对齐 ground truth"的否决依据——尖刺决策已对齐,残差归属下面的独立待办。

待办:

- [x] **修 C 类冲突死锁丢数据 bug**(§8)——已在协调器复刻批处理去重叠,以批处理为 oracle 验证局部同构。
- [x] **修 C 类第二例:跨类型 partial 冲突 finish 时冻结丢尾巴**(§9)——finish 强制结算,5ccf 长文件流式 792→2459 点对齐批 2411,新增回归测试。
- [ ] **对齐流式 rest_photo_micro_move/dense_area_intent 的折叠到批处理**(§8 残差)——独立的输出稀密差异 bug,需各自以批处理为 oracle 排查(gnss[:4200] 417–522 区段:批 2 点 vs 流 19 点;outdoor 全程亦有同类差异)。
- [ ] **L4 输出 flush 已做**;剩 intake.events 的诊断回放旁路(落盘 sink)。
- [ ] 验证上下文型(#15–18)的独立有界窗方案(§3 注)。
- [ ] 迟到/乱序容忍窗口定义:裁剪后迟到到已释放窗口的点如何处理,及其对旧"全量保留"行为的输出差异是否接受。

## 9. C 类第二例 —— 跨类型 partial 冲突在 finish 时仍冻结丢尾巴(pre-existing)

用真实长文件 `gnss_evidence_5ccf…`(38857 事件)对比批流,发现流式只提交 **792 点 / 2777m**,批处理 **2411 点 / 8517m**——流式丢了后半段。逐层定位:

- 死锁点:`lastCommitPlanStatus: blocked_at_watermark`、`lastCommitWatermark: 1578`,阻塞源是**跨类型** partial 冲突 `moving-spike:1578-1585-1586 × rest-photo:1558-1578`(仅 sampleId 1578 单点重叠)。§8 的 `deoverlapMovingSpikeProposals` 只解 moving_spike **同类**重叠,跨类型的这条没覆盖。
- **关键架构差异**:批处理里 moving_spike/rest_photo 的清洗在**标记阶段**(`sixLayerTrackProduct` L416/L430)就地改 `product.track`,而 `scenarioSettlementPlan`/协调器是**事后独立诊断层、不驱动 track**;所以批处理即便产出同样 21 个冲突,`commitPlan.status` 仍是 `committable`(那些冲突被一个跨度 `gap_recovery_boundary:53-3858` 硬边界吸收成 `blocked_by_hard_boundary`,非 `conservative_fallback`,不阻塞)。**流式相反**:`localRebuild` 靠 settlement 的 active 提案构建 committedTrack,settlement 卡住=输出卡住。两者是"标记阶段顺序叠加清洗" vs "互斥 metric ownership 仲裁"的根本不同。
- 设计上 `conservative_fallback` 阻塞是**有意的**(真歧义就等 lookahead,保"已提交不回改";见 `tests: rejects unresolved partial metric-owner conflicts`)。真正的 bug 是:**数据流终结(finish)后仍无限阻塞并丢弃冲突点之后的尾巴**——此时两提案都终态、不会再有 lookahead 改变它们。

**已修复(finish 强制结算,3 文件手术式改动)**:把 `finish` 信号从引擎 `advanceScenarioSettlement` → 结算会话 → 协调器透传;协调器 `computeCommitWatermark`/`commitBlockingRanges` 在 `finish===true` 时不再让 `conservative_fallback` 冲突与未闭合 open window 钉住水位线(blocker 已 active、被挡提案已 reject,决策已定,watermark 安全推进到 `currentRawPointId`)。非 finish 路径完全不变(现有阻塞语义/测试不受影响)。

以**批处理为 oracle** 验证:5ccf 流式 792→**2459 点 / 8667m**(批 2411 / 8517,丢失点 1635→14);gnss[:4200] 357→358(批 330,原本就未死锁,几乎无影响)。`npm test` 236 pass / 1 pre-existing fail(rust fixture,无关),新增 `force-settles blocked conflicts on finish` 回归测试锁定行为。

**残差(2459 vs 2411 ≈ +2%):同 §8 残差同类**——流式 committedTrack 本就不逐点等于批处理(scenario 折叠/composition 差异),属下面独立待办,与本死锁无关。

**已知未解(pre-existing,非本 fix 引入)**:`golden.mjs chunkinvariance` 显示流式最终输出**随 chunk 大小变化**(gnss[:4200] chunked 358 vs 单发 335)——根因是 RDP 简约的非前方单调性 + 有界识别窗在不同 chunk 边界看到的上下文不同(契约 §3 注已记)。修改前后同样不稳定(已 stash 对照确认),本 fix 未使其变差。web 端 `buildStreamingTrackProduct` 走单发路径(335,最接近批 330),不受此影响。

## 10. 流式缺失静止塌缩场景 —— 静止录制记出假距离(pre-existing 覆盖缺口)

8 个真实文件批流普扫(sweep)发现:**纯静止录制流式记出假距离**。批处理把整段静止塌成 1 锚点(0m),流式保留多个锚点 + 假距离:

| 文件 | 特征 | 批处理 | 流式(修前) | 批处理场景 |
|---|---|---|---|---|
| `gnss_7da81318` | 设备静止 **5.9 小时**(bbox 34m) | 1 点 / 0m | 23 点 / **25m** | `stationary_session_collapse` |
| `outdoor_v1` | 城市多径**双簇漂移**(bbox 96m) | 1 点 / 0m | 20 点 / **55m** | `stationary_dual_cluster_gnss_drift` |

**根因**:流式识别器只实现了 `stationary_drift_collapse`(塌缩 **rejected** 漂移点),缺失批处理的 `stationary_session_collapse`(整轨若全静止→塌成 1 锚,作用于**保留**的 stationary_anchor 点)和 `stationary_dual_cluster_gnss_drift`。直接命中"5 小时起步"徒步场景——扎营/长休会显示假移动。

**架构冲突**:批处理 `collapseStationarySession` 是"整轨全静止→`product.track=[anchor]`"的早退门,在全部 raw 点上判。流式 device 模式**逐次 flush、无法回撤已吐锚点**,整轨塌缩不可行。

**已修复 `stationary_session_collapse`(device 增量,3 文件 +255 行)**:做成"进行中的静止会话用 open window 挂住游标、只在会话结束或 finish 时闭合出 1 个代表锚"的**增量 span 场景**(比批处理"仅整轨"更通用,嵌入式扎营也覆盖)。
- **recognizer**:`stationarySessionGroups`(running bbox O(1)/点贪心分组)+ 门校验(对齐 `isStationarySession`:最小 raw 点数用 `cloudSampleCount` 还原、时长、bbox、净距离、平均上报速度、路径速率)→ closed 出 proposal / ongoing 出 open window。
- **gap_recovery 吸收**:抑制落在会话跨度内的 gap_recovery 硬边界发射(静止中信号 blip 非真移动),否则会话被切成多段各塌一锚。会话 open window 已钉住游标,故未提交前可安全抑制。
- **localRebuild**:`stationary_session_anchor` 把跨度内 base track 点塌成 1 锚(`countsDistance/countsMovingTime=false`)。
- **coordinator**:优先级 15(高于 moving_spike 20,低于 gap_recovery 10)。

以**批处理为 oracle** 验证:`gnss_7da81318` 23 点 / 25m → **1 点 / 0m**(逐字段对齐批处理);其余 6 文件(运动轨迹)committedTrack **零回归**;5ccf 实徒歩 2459 点**不变**(嵌入式短 dwell 不被误塌,归现有 drift collapse 管辖)。`npm test` 238 pass / 1 pre-existing fail,新增 `collapses a stationary session` + `keeps a moving track uncollapsed` 回归测试。

待办:

- [x] **修 `stationary_session_collapse` 缺失**(§10)——device 增量塌缩,`gnss_7da81318` 对齐批处理 1 点 / 0m。
- [~] **`stationary_dual_cluster_gnss_drift` —— 流式有意暂不处理(2026-07-19 决定)**。城市高楼多径导致 GPS 在两个相距 30-150m 的簇之间反复横跳,被当成真实往返记出假距离(`outdoor_v1` 55m)。批处理认定需双簇几何(两中心 30-150m)+ 簇间高速迁移检测(≥6 次、≥25% 达 ≥12 m/s)+ `motionWindows`,依赖 device 模式已 flush 的逐 raw 点数据,和"有界内存"有张力,是更重的独立场景。属**城市多径边缘场景**(纯山野徒步少见)——若 app 覆盖城市/峡谷记录场景再补。已修的 `stationary_session_collapse`(§10)覆盖单簇长时间静止(扎营/长休),不受此影响。
