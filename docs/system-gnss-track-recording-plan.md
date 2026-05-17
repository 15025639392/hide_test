# 系统 GNSS 徒步轨迹记录方案

本文是当前实现的权威短版。旧版长文已归档到 `docs/system-gnss-track-recording-plan-archive.md`，后续日常开发以本文为准。

## 当前目标

把 Android 系统 GNSS 能力做成一条真实徒步可用的记录链路：

- 不接入高德、百度、腾讯、Google Fused Location 等第三方定位 SDK。
- 正式轨迹只接受 `LocationManager.GPS_PROVIDER`。
- 每个系统 `Location` 先进入 RawPoint 诊断层，再由 App 层决定是否进入 TrackPoint。
- 最终用户看到一条连续徒步轨迹线。
- 长时间无定位后的连接保持可解释：显示连续，但不把 GAP 两端直线计入可信距离。

最小闭环是：

```text
前台服务采集 GPS_PROVIDER
  -> RawPoint / GNSS Snapshot / diagnostic.jsonl
  -> LocationValidator
  -> TrackDecisionEngine
  -> TrackPoint / session.json
  -> track.gpx / partial.gpx
  -> 历史记录与地图展示
```

## 瘦身口径

保留：

- 系统 GNSS 数据源、前台服务、动态采样。
- RawPoint 与 TrackPoint 分层。
- 可信距离、运动时间、静止抖动、GAP 统计。
- GPX 导出和历史 session 恢复。
- 离线 replay、单元测试、真机烟测。

延后：

- 复杂候选点回填。
- 多策略路线评分器。
- 传感器融合导航。
- 针对不同运动类型的策略配置。
- 更复杂的 UI 可视化分层。

删除出主文档：

- 大段未来架构接口契约。
- 过细的数据模型草案。
- 重复测试矩阵和历史测试流水。
- 与当前真实徒步闭环无关的长期设想。

## 数据来源

正式轨迹数据：

```text
LocationManager.GPS_PROVIDER
```

辅助诊断数据：

- `GnssStatus`
- `GnssMeasurementsEvent`
- Android 设备、权限、Provider 状态
- 前台服务与采样策略事件

不进入正式轨迹：

- `NETWORK_PROVIDER`
- `FUSED_PROVIDER`
- mock location
- 缺失或异常 `elapsedRealtimeNanos` 的点
- 明显过旧或来自未来的点

如果未来要测试系统融合定位，应作为独立数据源标记，不混入当前纯 GNSS 可信轨迹。

## 采样策略

前台服务负责真实徒步记录，服务启动返回：

```text
START_NOT_STICKY
```

当前没有跨进程恢复并续写 active session 的机制，因此不依赖系统重投递 start intent。若前台服务或进程被系统杀掉，当前 session 会标记为 `INTERRUPTED`，完整性以 `session.json`、`diagnostic.jsonl`、`completionState`、`integrityState`、`recoveryState` 为准。

当前真实徒步采样参数：

| 状态 | minTimeMs | minDistanceMeters |
| --- | ---: | ---: |
| STARTING | 1000 | 0 |
| MOVING | 3000 | 0 |
| SIGNAL_WEAK | 2000 | 0 |
| PAUSED | 10000 | 0 |

关键原则：

- `minDistanceMeters` 固定为 0。
- 不把 5m、10m 等距离过滤交给 Android 系统。
- App 必须拿到漂移、弱信号、静止抖动和 GAP 恢复过程，才能解释为何不累计距离。
- PAUSED 采样只由连续静止证据触发；一旦出现可信移动或其他非静止决策，采样状态回到 MOVING/SIGNAL_WEAK 等对应状态。
- 每次采样切换写入 `sampling_policy` 诊断事件。

## 时间基准

内部连续性判断使用 `elapsedRealtimeNanos`。

`Location.getTime()` 只用于 GPX 时间和展示，不作为轨迹连续性主依据。

当前阈值：

| 项 | 值 |
| --- | ---: |
| `START_TOLERANCE_NANOS` | 1s |
| `MAX_LOCATION_AGE_NANOS` | 30s |
| `GAP_LINE_BREAK_NANOS` | 120s |

硬拒绝时间异常：

- `missing_elapsed_realtime`
- `before_record_start`
- `location_from_future`
- `location_too_old`

## 数据分层

RawPoint：

- 保存系统 Location 的原始字段。
- 包含经纬度、精度、海拔、速度、方向、wall time、elapsed realtime、mock 标记。
- 关联最近 3 秒窗口内的 GNSS snapshot。
- 即使被拒绝，也应进入诊断日志。

GNSS Snapshot：

- 来自 `GnssStatus`。
- 记录可见卫星数、参与 fix 卫星数、平均 C/N0 和星座分布。
- 与 Location 按 `elapsedRealtimeNanos` 匹配。
- 优先匹配过去 3 秒内 snapshot；必要时记录 future match 诊断。
- 超过窗口则标记 `gnssQualityStale`。

TrackPoint：

- 只由通过判定的 RawPoint 生成。
- 保存 `decisionResult`、`decisionReason`、`segmentId`、`distanceDeltaMeters`、`movingTimeDeltaSeconds`。
- 可信轨迹和 GPX 以 TrackPoint 为准，不直接导出全部 RawPoint。

## 判点规则

硬拒绝：

- provider 不是 `GPS_PROVIDER`。
- 缺失有效 `elapsedRealtimeNanos`。
- 点早于记录开始容差之外。
- 点来自未来。
- 点过旧。
- 经纬度非法或为 0,0。
- 缺失精度或精度小于等于 0。
- 精度大于 80m。
- mock location。

首点：

| 条件 | 结果 | reason |
| --- | --- | --- |
| accuracy <= 20m | anchor | `first_fix_good` |
| 20m < accuracy <= 30m | anchor | `first_fix_relaxed` |
| 测试开关开启且 accuracy <= 50m | anchor | `forced_weak_first_fix` |
| 30m 或 50m < accuracy <= 80m | weak | `weak_first_fix` |
| accuracy > 80m | reject | `first_fix_accuracy_too_large` |

移动中：

- accuracy > 30m -> `weak_signal_stage1`。
- delta time <= 0 -> `non_positive_delta_time`。
- 两点所需速度 > 12m/s 且没有合理车辆速度证据 -> `impossible_speed`。
- delta time > 120s -> `gap_recovery`。
- 明显超过徒步范围但未达到跳点速度的持续移动 -> `transport_suspected`。
- 距离 < `max(5m, accuracy * 1.5)` -> 静止抖动或静止保活。
- 其他可信移动 -> `moving_good_fix`。

静止：

- 静止点默认不累计距离。
- 每 30 秒允许一次 `stationary_keepalive` 诊断。
- 更频繁的小范围漂移记为 `stationary_jitter`。

## GAP 与连续轨迹

GAP 的产品口径：

```text
最终轨迹线保持连续
GAP 两端直线不计入可信距离
恢复点进入 TrackPoint
恢复点标记 decisionReason = gap_recovery
恢复点 distanceDeltaMeters = 0
恢复点 movingTimeDeltaSeconds = 0
内部 segmentId 增加
session gapCount 增加
```

也就是说，`segmentId` 是诊断和统计语义，不等同于地图视觉断开。

这么做是为了适配真实徒步：用户通常期望导出的路线是一条完整线路，而不是被隧道、密林、锁屏、省电策略或系统杀进程拆成多条碎线。系统仍然通过 `gap_recovery`、`gapCount`、`segmentId` 和 0 delta 保留证据，避免把无定位期间的直线误算成可信行走距离。

## 交通工具混入

坐车、骑行、景区摆渡车等属于“有定位证据，但不是徒步”的移动，不应和 GAP 混在一起。

当前第一阶段口径：

```text
明显超过徒步范围，或系统上报速度显示为合理车辆速度:
  decisionResult = reject
  decisionReason = transport_suspected
  进入内部 transport mode

transport mode 中:
  RawPoint 继续记录
  decisionReason = transport_confirmed
  不生成可信 TrackPoint
  不累计 totalDistanceMeters
  地图使用红色轨迹线连接交通工具混入段

恢复到稳定徒步速度后:
  decisionResult = accept
  decisionReason = transport_recovery
  当前点需满足普通可信点精度门槛
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0
  内部 segmentId 增加
  最终 GPX 仍保持连续线
```

`transport_recovery` 和 `gap_recovery` 的区别：

- `gap_recovery` 表示中间没有足够定位证据。
- `transport_recovery` 表示中间有移动证据，但判断不是徒步。

当前交通工具判断仍是第一阶段启发式：速度明显超过徒步范围时才拦截。非常慢的车、拥堵路段或和徒步速度接近的移动，仍可能需要通过真实样本报告人工复核。

## GPX 导出

`track.gpx`：

- 只导出可信 TrackPoint。
- 默认保持连续 `<trkseg>`。
- 不用多个 `<trkseg>` 表达 GAP。
- 每个 `<trkpt>` 的 extension 写入诊断字段。

必须写入的扩展字段：

- `sessionId`
- `trackPointId`
- `segmentId`
- `sourceRawPointId`
- `sourceDecisionId`
- `elapsedRealtimeNanos`
- `accuracy`
- `decisionResult`
- `decisionReason`
- `distanceDeltaMeters`
- `movingTimeDeltaSeconds`
- 可选 `sourceGnssSnapshotId`

`partial.gpx`：

- 用于诊断弱点和中断记录。
- 可包含 weak 点的独立诊断段。
- 不是最终可信徒步轨迹的展示口径。

## 会话文件

每次记录生成一个 session 目录。

核心文件：

- `session.json`
- `diagnostic.jsonl`
- `track.gpx`
- `partial.gpx`

真实样本验证额外支持导出：

- `sample_report_{sessionId}.txt`

样本报告由 `diagnostic.jsonl` 和 `session.json` 自动生成，覆盖采样策略分布、记录时长、距离、GAP、no-location timeout、reject/weak/accept 原因分布和阻塞问题。当前报告明确不统计电量/省电证据，也不做多地图 GPX 兼容性自动回归。

`session.json` 至少表达：

- session id
- schema version
- strategy version
- completion state
- integrity state
- raw point count
- track point count
- weak point count
- segment count
- `gapCount`
- total distance
- moving time
- stationary keepalive / jitter count
- 文件存在性与最后事件序号

恢复判断：

- `FINISHED`: 正常完成。
- `INTERRUPTED`: 前台服务或进程异常中断。
- `ERROR`: 写文件或一致性校验失败。
- `ABORTED`: 关键诊断文件缺失。
- `INVALID_MANIFEST`: session manifest 无法解析。

## 诊断日志

`diagnostic.jsonl` 采用追加写。

当前关键事件：

- `session_metadata`
- `config_snapshot`
- `runtime_snapshot`
- `session_event`
- `sampling_policy`
- `gnss_snapshot`
- `raw_location`
- `decision`

诊断日志必须能回答：

- 为什么这个点没有进入 GPX。
- 当时请求参数是什么。
- 当时 GNSS 卫星质量如何。
- GAP 是什么时候发生和恢复的。
- 可信距离为什么没有增长。
- session 是否完整结束。

## UI 口径

当前 UI 以真实徒步记录为优先：

- 地图展示连续可信轨迹线。
- 疑似交通工具混入段使用红色轨迹线展示。
- 状态显示 TrackPoint、RawPoint、距离、采样策略。
- 历史记录显示完成状态、完整性、恢复状态、GAP 数。
- GAP 不强制断开地图线。
- 诊断导出用于复盘，不要求普通用户理解所有内部字段。

## 验收标准

离线测试：

- `gradle testDebugUnitTest` 通过。
- `gradle runReplay` 通过。
- GAP fixture 产生 `gap_recovery`。
- GAP 恢复点 delta 为 0。
- 交通工具 fixture 产生 `transport_suspected` / `transport_confirmed` / `transport_recovery`。
- GPX 保持连续可信轨迹。

构建与真机：

- `gradle assembleDebug` 成功。
- APK 可安装。
- App 可启动到前台。
- 前台服务可开始和结束记录。
- 记录过程中通知常驻。
- 结束后能看到 session、可信 GPX 和诊断日志。

真实徒步：

- 开阔地能形成稳定连续轨迹。
- 静止时距离不明显膨胀。
- 弱信号和跳点不会污染可信距离。
- 长时间无定位后恢复时最终线连续。
- `gapCount`、`gap_recovery`、`segmentId` 可在诊断中复盘。
- 历史记录可以导出样本报告，用于减少手工翻看 `diagnostic.jsonl`。

## 已知限制

- 当前仍是第一阶段判点，不做候选点延迟回填。
- GAP 后的连续线是产品展示线，不代表系统证明用户沿直线行走。
- 海拔、坡度、累计爬升仍需更多真实路线校准。
- 不同 Android 厂商的后台和省电策略仍可能影响连续采样。
- 当前不做 active session 自动续写；进程级中断后的 session 需要按 `INTERRUPTED` 处理。

## 下一步

优先做小步验证，不扩展新架构：

1. 用 30 到 60 分钟真实徒步样本验证采样、GAP 和距离口径。
2. 导出样本报告，检查采样、GAP、距离、reject/weak 是否能自动解释。
3. 对比 `track.gpx` 在常见地图工具中的连续显示效果。
4. 只在真实样本暴露问题后，再调整阈值或补充候选点机制。
