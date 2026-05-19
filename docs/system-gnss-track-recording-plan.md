# 系统 GNSS 徒步轨迹记录方案

本文是当前实现的权威短版，后续日常开发以本文为准。

当前策略版本：

```text
stage1-gnss-track-v2-rest-state
```

技术债治理、AI 执行顺序、策略不变量和 replay fixture 分类见
`docs/technical-debt-governance-plan.md`。治理时应优先遵守该文档中的
Non-Negotiable Invariants、Change Checklist 和 Governance Phases。

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

弱 GPS 诊断的外部参考与后续增强方向见
`docs/weak-gps-github-research.md`。当前阶段优先补充卫星质量证据，
不把弱信号修复结果写入可信轨迹。

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
| REST_PROBING | 1000 | 0 |
| REST_PAUSED | 10000 | 0 |
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
- 非 GAP 下明显超过徒步范围但未达到跳点速度的持续移动 -> `transport_suspected`。
- 距离 < `max(5m, accuracy * 1.5)` -> 静止抖动或静止保活。
- delta time > 120s -> `gap_recovery`，但若恢复点仍在精度可解释的静止范围内，优先按静止/锚点优化处理。
- 其他可信移动 -> `moving_good_fix`。

静止噪声点级过滤：

- 静止点默认不累计距离。
- 每 30 秒允许一次 `stationary_keepalive` 诊断。
- 更频繁的小范围漂移记为 `stationary_jitter`。
- 该规则优先防止静止漂移累计距离；在弱信号、低速移动、拍照挪步或短距离折返场景下，可能保守少算短距离位移。

### 静止锚点优化

`stationary_anchor_refinement` 指在静止或近静止小范围内，把多个可信点聚成一个
stationary cluster，并选择其中最可信的点作为代表锚点。候选评分可参考 accuracy、
GNSS snapshot 新鲜度、used satellite count、C/N0 和前后连接是否产生异常速度。

当前版本已经把静止锚点优化接入主链路，但只允许在保守条件下影响零距离锚点，
不回补距离、不新增真实移动段：

```text
候选条件:
  当前点低速或无明显移动速度
  与上一可信 TrackPoint 的距离处在 15m 或 accuracy 可解释范围内
  对 moving_good_fix 候选，必须有最近加速度静止证据

可替换条件:
  上一可信 TrackPoint 的 distanceDeltaMeters = 0
  上一可信 TrackPoint 的 movingTimeDeltaSeconds = 0
  当前点 accuracy 明显更好，或 accuracy 接近但 GNSS snapshot 更好

结果:
  更好的静止点 -> result = anchor, reason = stationary_anchor_refined
  未改善的近距离静止漂移 -> result = reject, reason = stationary_accel_supported_jitter
```

实际收益：

- 静止或休息时地图点位更稳定。
- 静止簇能有一个更可解释的代表点。
- GAP 后仍在原地的恢复点不会新建一段虚假线路。
- REST_PAUSED / REST_PROBING 周期内的小范围漂移不污染可信距离。

主要风险：

- 真实徒步中的慢速移动、拍照挪步、折返、窄路绕行可能被误吞成静止。
- 弱信号环境下 accuracy 不一定可靠，所谓“最可信点”仍可能是漂移点。
- 需要依赖 replay fixture 和真实样本持续校验，不应继续扩大到非零距离移动点替换。

边界：

- 不替换已经产生非零距离或非零 moving time 的 TrackPoint。
- 不把 GNSS snapshot 单独作为 accept/reject 输入，只用于同等 accuracy 附近的锚点择优。
- 不修改已经累计的 `totalDistanceMeters` 和 `movingTimeSeconds`。

## REST 状态机策略

休息状态恢复移动时，产品口径优先防止静止漂移贡献距离。允许少算休息后
起步的短距离，不允许把室内、休息点附近或弱 GPS 恢复过程中的漂移累计为
徒步距离。

显式 REST 状态机是休息/恢复场景的主策略，运行时对应
`RestStateMachine`。它应遵守：

```text
MOVING:
  连续 20-30s:
    speed <= 0.5m/s
    位移未超过精度可解释范围
    加速度静止占比高
  -> REST_CANDIDATE

REST_CANDIDATE:
  收集 2-3 个低频/正常频率点
  选出可信休息锚点 anchor
  -> REST_PAUSED

REST_PAUSED:
  GPS 降频 keepalive，不完全暂停
  不累计距离
  加速度变化 -> REST_PROBING

REST_PROBING:
  GPS 立即提频
  前 1-2 个点只用于确认，不累计距离
  仍在 anchor 附近 -> 更新/择优 anchor，回 REST_PAUSED
  连续可信 moving/gap recovery 点离开 anchor，或 speed > 0.5m/s 且方向/位移合理
    -> MOVING
```

距离口径：

```text
进入 REST：保守，需要连续时间、低速、位移小、加速度静止等组合证据
退出 REST：响应快，但先进入 REST_PROBING
REST_PAUSED / REST_PROBING 期间：一律不累计距离
REST_PROBING 点：只用于确认移动或更新休息锚点，默认不回补距离
确认 MOVING：需要连续可信定位证据，从确认点开始累计，不回补 probing 点
GPS：降频 keepalive，不完全暂停
```

这意味着从休息点起步时可能少算几米，但该误差比休息漂移多算几十米更可
接受，也更容易向用户解释。诊断应记录 `REST_PROBING`、未累计原因和
恢复 `MOVING` 的确认原因，便于复盘。

## GAP 与连续轨迹

GAP 的产品口径：

```text
最终轨迹线保持连续
GAP 两端直线不计入可信距离
恢复点进入 TrackPoint；若仍属于静止锚点优化，则替换原零距离 anchor
移动恢复点标记 decisionReason = gap_recovery
恢复点 distanceDeltaMeters = 0
恢复点 movingTimeDeltaSeconds = 0
移动恢复时内部 segmentId 增加
移动恢复时 session gapCount 增加
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
- `weak_gnss_report_{sessionId}.txt`

样本报告由 `diagnostic.jsonl` 和 `session.json` 自动生成，覆盖采样策略分布、记录时长、距离、GAP、no-location timeout、reject/weak/accept 原因分布和阻塞问题。当前报告明确不统计电量/省电证据，也不做多地图 GPX 兼容性自动回归。

弱 GPS 诊断报告由 `diagnostic.jsonl` 和 `session.json` 自动生成，覆盖 weak/reject 决策关联的卫星 C/N0、参与定位卫星数、raw location stale GNSS 占比、GAP 前后 30 秒 GNSS 质量和 no-location timeout。该报告只解释弱信号证据，不改变可信轨迹、距离、GPX 或 replay 判点结果。

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

## 海拔与累计爬升目标策略

多设备同时间同路线的气压计累计爬升一致性验收目标，见
`docs/barometer-ascent-consistency-targets.md`。

累计爬升不再按“相邻可信点海拔正差求和”作为长期口径。后续实现应抽出
独立的 `TrackAscentCalculator`，由前台实时状态、地图回放和样本报告共用，
避免多处重复计算出现不同结果。

当前已落地共享 `TrackAscentCalculator`、GNSS 保守爬升路径、气压计采集诊断，
但现有实现仍把 BAROMETER 样本挂到 TrackPoint 上，并间接受 `moving_good_fix`
等平面轨迹判定影响。后续方案需要将 GNSS altitude 与 pressure altitude
拆成两条独立累计爬升解算链路：GNSS 只处理定位点海拔，BAROMETER 只处理手机
压力传感器在采样时刻的相对高度变化，最后在展示/报告层选择主结果。

海拔语义边界：

```text
GNSS altitude:
  来源 = Android Location.getAltitude()
  对象 = 当前 Location fix 的定位点海拔
  参考 = WGS84 椭球高度
  可信条件 = Location fix 本身可信 + verticalAccuracy 可信
  用途 = 无气压计时的保守累计爬升兜底、气压计绝对显示校准参考

BAROMETER altitude:
  来源 = Sensor.TYPE_PRESSURE + SensorManager.getAltitude(...)
  对象 = 手机压力传感器采样时刻的设备当前位置气压高度估计
  参考 = 标准大气压换算时绝对值不可靠
  可信条件 = 压力样本连续、传感器状态可用、垂直变化物理合理
  用途 = 有气压计设备上的主累计爬升来源
```

累计爬升目标架构：

```text
AscentResult:
  totalAscentMeters
  source = BAROMETER / GNSS / NONE
  confidence = HIGH / MEDIUM / LOW / NONE
  sampleCount
  rejectedSampleCount
  lastSampleElapsedRealtimeNanos

BarometerAscentEngine:
  输入 pressure_sample stream
  输出 barometerAscentResult

GnssAscentEngine:
  输入 Location/TrackPoint 中的 GNSS altitude stream
  输出 gnssAscentResult

AscentSelector:
  if barometerAscentResult reliable:
    displayedTotalAscent = barometerAscentResult.totalAscentMeters
    ascentSource = BAROMETER
  else if gnssAscentResult reliable:
    displayedTotalAscent = gnssAscentResult.totalAscentMeters
    ascentSource = GNSS
  else:
    displayedTotalAscent = -1
    ascentSource = NONE
```

气压计优势落地方案：

```text
阶段 1: 相对爬升
  pressure_sample 独立进入 BarometerAscentEngine
  使用 rawBarometerAltitudeMeters 的短时间相对变化累计设备上升
  不要求 GNSS altitude 可信
  不要求当前 GNSS 点为 moving_good_fix
  当前不判断这段上升是否属于徒步活动

阶段 2: 绝对海拔校准
  遇到可信 GNSS altitude:
    hasAltitude
    hasVerticalAccuracy
    verticalAccuracy <= 8m
    horizontal accuracy <= 30m
  且同一 TrackPoint 有 BAROMETER sample:
    calibrationOffset = gnssAltitude - rawBarometerAltitudeMeters
    displayedBarometerAltitude = rawBarometerAltitudeMeters + calibrationOffset
    记录 barometer_calibration 诊断事件
  calibrationOffset 只用于显示/诊断，不反向改写累计爬升趋势

阶段 3: 展示与报告
  信息栏显示气压计海拔、校准状态、主爬升来源 BAROMETER/GNSS/NONE
  报告同时输出 barometerAscent / gnssAscent / selectedAscentSource
```

海拔源优先级：

```text
1. 气压计海拔：设备存在 Sensor.TYPE_PRESSURE 时启用
2. GNSS 海拔：仅在有 verticalAccuracy 且精度足够时作为保守兜底
3. DEM 地形高程：后续作为结束后补算/校准增强，不阻塞当前实现
```

气压计策略：

```text
启动记录时检测 Sensor.TYPE_PRESSURE
有气压计:
  记录 pressure_sample / pressure_summary 诊断
  用首个可靠 GNSS verticalAccuracy 或后续 DEM 作为绝对海拔校准
  短时间相对高度变化由 BarometerAscentEngine 独立累计为设备上升
  信息栏显示“气压计海拔”，并标明爬升来源为 BAROMETER
无气压计:
  不显示气压计海拔
  进入保守 GNSS 爬升策略
```

GNSS 保守策略：

```text
必须满足:
  Location.hasAltitude()
  Android O+ 且 Location.hasVerticalAccuracy()
  verticalAccuracy <= 12m
  horizontal accuracy <= 30m
  decisionReason == moving_good_fix
  GNSS horizontalDistance >= 5m

不满足时:
  可显示参考海拔
  不参与累计爬升
```

GNSS 爬升计算口径：

```text
只在可信 moving_good_fix 段内累计 GNSS 爬升
first_fix_good / first_fix_relaxed / forced_weak_first_fix 只设海拔 anchor
gap_recovery / transport_recovery / rest_moving_recovery / stationary_anchor_refined 只重置海拔 anchor
weak / transport / stationary / REST_PAUSED / REST_PROBING / reject 不参与爬升

使用滤波后的 altitude，不直接累计原始 altitude
使用趋势确认，不按单点正差直接累计
GNSS 阈值随 verticalAccuracy 放大
```

BAROMETER 爬升计算口径：

```text
当前口径:
  BAROMETER 表示记录期间手机实际位置的气压海拔累计上升
  暂不判断上升是否属于徒步活动
  交通工具、电梯、缆车等造成的手机海拔上升也可能进入该统计

不以 moving_good_fix 作为入口条件
不把 pressure altitude 视为某个 GNSS 定位点的附属海拔
按 pressure_sample elapsedRealtimeNanos 独立排序累计

允许:
  recording lifecycle active
  pressureHpa > 0
  elapsedRealtimeNanos 单调递增
  sensorAccuracy 记录用于诊断；当前不因单点 unreliable 直接拒绝
  与上一压力样本时间间隔在合理范围内
  垂直速度通过物理门限

重置 anchor:
  记录开始
  压力样本长时间断层

拒绝累计:
  pressure altitude 单点跳变超过物理门限
  时间倒退或重复样本

仍可使用:
  weak GNSS 场景下的 pressure_sample
  stationary_keepalive / stationary_jitter 附近的 pressure_sample
  低速、短水平距离但垂直变化稳定的 pressure_sample

后续活动归因版本:
  在 BAROMETER 设备上升之外新增或派生 hikingAscent
  transport_suspected / transport_confirmed 期间暂停徒步爬升累计
  GNSS 决策进入/离开 transport mode 时重置徒步爬升 anchor
  gap_recovery / transport_recovery / rest_moving_recovery 时重置徒步爬升 anchor
  设备静止锚点被重估时，只重置徒步爬升趋势，不把跨锚点高度差计入徒步爬升
```

BAROMETER 气压抖动处理：

```text
目标:
  保留徒步过程中的真实相对高度变化
  抑制手持扰动、气流、短周期压力噪声造成的虚假累计爬升

处理顺序:
  raw pressure sample
    -> pressure quality gate
    -> physical vertical-speed gate
    -> low-pass filter
    -> trend confirmation

原则:
  异常样本先拒绝，再进入滤波
  不允许坏样本污染 filteredAltitude
  不按相邻正差直接求和
  小幅上下抖动必须被 climbThreshold/dropThreshold 吞掉
```

BAROMETER 样本质量门控：

```text
接受条件:
  pressureHpa > 0
  elapsedRealtimeNanos > lastElapsedRealtimeNanos
  pressureSampleId 单调递增
  sample interval 在合理范围内
  sensorAccuracy 进入诊断统计，不作为当前单点硬拒绝条件

拒绝但不重置:
  单个 pressureHpa 非法
  时间重复或倒退

重置 anchor:
  pressure sample gap 超过阈值
  记录生命周期暂停/恢复

后续活动归因版本:
  transport mode 开始或结束
  recovery anchor 出现
  连续 unreliable 样本后恢复
```

BAROMETER 低通滤波：

```text
filteredAltitude =
  alpha * rawBarometerAltitudeMeters
  + (1 - alpha) * previousFilteredAltitude

初始值:
  第一个通过门控的样本直接作为 filteredAltitude/baseAltitude/peakAltitude

默认 alpha:
  0.35

原因:
  alpha 太高会把 0.x-1m 的压力抖动直接送入趋势判断
  alpha 太低会滞后真实短陡坡/楼梯爬升，导致低估 peak
  0.35 作为第一版固定值，便于复盘和测试

后续可选动态 alpha:
  压力稳定且采样频率高时降到 0.25-0.30
  连续稳定上升时升到 0.40-0.50
  噪声变大或传感器精度下降时降低 alpha
```

BAROMETER 趋势确认：

```text
baseAltitude:
  当前候选上升段的可信低点

peakAltitude:
  当前候选上升段的滤波后最高点

上升:
  altitude >= peakAltitude
  只更新 peakAltitude
  不立即增加 totalAscentMeters

回落:
  drop = peakAltitude - altitude
  pendingGain = peakAltitude - baseAltitude

  if drop >= 1.5m:
    if pendingGain >= 3.0m:
      totalAscentMeters += pendingGain
    baseAltitude = altitude
    peakAltitude = altitude

结束:
  记录结束时，如果 pendingGain >= 3.0m，再结算最后一段
```

BAROMETER 物理门限：

```text
verticalSpeed =
  abs(rawBarometerAltitudeMeters - lastAcceptedRawOrFilteredAltitude)
  / elapsedSeconds

if verticalSpeed > 2.0m/s:
  reject sample

说明:
  2.0m/s 是徒步累计爬升的保守上限
  电梯、车辆、压力突跳、传感器异常更容易超过该门限
  被拒绝的单点不进入滤波；若连续出现则重置 anchor
```

长期输入模型：

```text
GnssElevationSample:
  elapsedRealtimeNanos
  trackPointId / rawPointId
  altitudeMeters
  verticalAccuracyMeters
  horizontalAccuracyMeters
  distanceDeltaMeters
  decisionReason
  segmentId

BarometerElevationSample:
  pressureSampleId
  elapsedRealtimeNanos
  pressureHpa
  rawBarometerAltitudeMeters
  sensorAccuracy
  motion/transport/rest state snapshot  // 仅用于门控与 anchor，不作为定位点海拔
```

每条 ascent engine 独立状态：

```text
totalAscentMeters
filteredAltitude
baseAltitude       // 当前可信低点
peakAltitude       // 当前上升趋势高点
lastAltitude
lastElapsedRealtimeNanos
hasReliableAscent
sampleCount
rejectedSampleCount
```

气压计海拔换算：

```text
rawBarometerAltitude =
  SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, pressureHpa)

如果拿到可靠参考海拔:
  calibrationOffset = referenceAltitude - rawBarometerAltitude
  displayedBarometerAltitude = rawBarometerAltitude + calibrationOffset

如果暂时没有可靠参考海拔:
  可用 rawBarometerAltitude 做相对爬升
  信息栏绝对“气压计海拔”应标记为未校准或暂不显示
```

参考海拔来源优先级：

```text
1. GNSS altitude 且 verticalAccuracy <= 8m
2. DEM elevation
3. GNSS altitude 且 verticalAccuracy <= 12m
```

主结果选择：

```text
if barometer engine has reliable result:
  source = BAROMETER
else if gnss engine has reliable result:
  source = GNSS
else:
  source = NONE
```

采样时效：

```text
BAROMETER pressure sample 不要求关联到 TrackPoint 才可累计相对爬升
GNSS altitude 只随当前 Location/TrackPoint 使用
DEM 可在结束后按 TrackPoint 经纬度补算
```

滤波策略：

```text
source == BAROMETER:
  alpha = 0.35

source == GNSS:
  alpha = 0.15

source == DEM:
  alpha = 0.25

filteredAltitude =
  alpha * currentAltitude + (1 - alpha) * previousFilteredAltitude

GNSS source 发生切换、REST/GAP/transport recovery 重置时:
  重置 filteredAltitude/baseAltitude/peakAltitude
  不跨源或跨恢复点延续爬升趋势

BAROMETER:
  不与 GNSS source 切换共享状态
  当前只在自身断层和生命周期边界重置设备上升趋势
  交通模式、恢复锚点用于后续 hikingAscent 活动归因版本
```

GNSS 移动点处理流程：

```text
onTrackPoint(point):
  if point.reason in anchorReasons:
    resetAltitudeAnchor(sampleFrom(point))
    return

  if point.reason != moving_good_fix:
    return

  sample = chooseElevationSample(point)
  if sample == NONE:
    return

  if !passesPhysicalGate(sample, point):
    return

  altitude = filter(sample.altitudeMeters)
  updateTrend(altitude, sample)
```

BAROMETER 压力样本处理流程（当前设备上升口径）：

```text
onPressureSample(sample):
  if !recordingActive:
    return

  if sampleGapTooLong:
    resetAltitudeAnchor(sample)
    return

  if !passesPressureQualityGate(sample):
    return

  if !passesPhysicalGate(sample):
    return

  altitude = filter(sample.rawBarometerAltitudeMeters)
  updateTrend(altitude, sample)
```

BAROMETER 后续 hikingAscent 活动归因流程会额外读取 stateSnapshot，
在 transport mode、recovery anchor、静止锚点重估等边界暂停或重置徒步爬升趋势。

锚点 reason：

```text
first_fix_good
first_fix_relaxed
forced_weak_first_fix
gap_recovery
transport_recovery
rest_moving_recovery
```

趋势确认算法：

```text
if no baseAltitude:
  baseAltitude = altitude
  peakAltitude = altitude
  lastAltitude = altitude
  return

if altitude >= peakAltitude:
  更新 peakAltitude
  lastAltitude = altitude
  return

drop = peakAltitude - altitude
pendingGain = peakAltitude - baseAltitude

if drop >= dropThreshold:
  if pendingGain >= climbThreshold:
    totalAscent += pendingGain
    hasReliableAscent = true
  baseAltitude = altitude
  peakAltitude = altitude
  lastAltitude = altitude
  return

lastAltitude = altitude
```

阈值：

```text
BAROMETER:
  climbThreshold = 3m
  dropThreshold = 1.5m

GNSS:
  climbThreshold = max(5m, verticalAccuracy * 0.8)
  dropThreshold = max(3m, verticalAccuracy * 0.4)

DEM:
  climbThreshold = 5m
  dropThreshold = 3m
```

记录结束时：

```text
pendingGain = peakAltitude - baseAltitude
if pendingGain >= climbThreshold:
  totalAscent += pendingGain
```

异常约束：

```text
abs(verticalSpeed) > 2.0m/s 的高度变化不计入徒步爬升
GNSS horizontalDistance < 5m 时不累计 GNSS 海拔变化
GNSS verticalAccuracy > 12m 时不累计爬升
GNSS horizontal accuracy > 30m 时不累计爬升
不跨 REST / GAP / transport recovery 累计爬升
```

信息栏展示：

```text
有气压计:
  显示 气压计海拔 xxx m
  显示 爬升 xxx m
  可补充 来源 BAROMETER

无气压计但 GNSS 高度可信:
  显示 GNSS 海拔 xxx m
  显示 爬升 xxx m
  可补充 来源 GNSS

无气压计且 GNSS verticalAccuracy 不足:
  显示 参考海拔 xxx m（如有）
  爬升显示 -
  不把参考海拔用于累计爬升
```

## 已知限制

- 当前仍是第一阶段判点，不做候选点延迟回填。
- GAP 后的连续线是产品展示线，不代表系统证明用户沿直线行走。
- 海拔、坡度、累计爬升需按上述海拔源策略继续落代码并用真实路线校准。
- 不同 Android 厂商的后台和省电策略仍可能影响连续采样。
- 当前不做 active session 自动续写；进程级中断后的 session 需要按 `INTERRUPTED` 处理。

## 下一步

优先做小步验证，不扩展新架构：

1. 用 30 到 60 分钟真实徒步样本验证采样、GAP 和距离口径。
2. 导出样本报告，检查采样、GAP、距离、reject/weak 是否能自动解释。
3. 对比 `track.gpx` 在常见地图工具中的连续显示效果。
4. 只在真实样本暴露问题后，再调整阈值或补充候选点机制。
