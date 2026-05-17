# 系统 GNSS 定位与轨迹记录测试方案

## 目标

当前项目用于验证 Android 系统定位能力、GNSS 卫星观测数据，以及徒步场景下的轨迹记录策略。

本项目明确不使用高德、百度、腾讯、Google Fused Location 等第三方定位 SDK。定位数据来源限定为 Android 系统能力：

- `LocationManager.GPS_PROVIDER`
- `GnssStatus`
- `GnssMeasurementsEvent`
- 可选：系统传感器，仅用于辅助诊断，不作为轨迹经纬度来源

核心目标不是“尽快拿到一个位置”，而是验证：

- 系统 GNSS 什么时候能 fix
- 当前定位用了哪些星座
- 每颗卫星的信号质量如何
- 系统输出的 `Location` 是否适合进入正式轨迹
- 徒步轨迹如何过滤漂移、跳点和弱信号
- 记录结束后如何导出标准 GPX

## 基本原则

### 原始定位点不等于轨迹点

系统回调的每个 `Location` 都应先作为 `RawPoint` 保存或展示，用于诊断。

只有通过质量、运动状态、连续性判断的点，才能成为正式轨迹点 `TrackPoint`。

```text
Raw Location
  -> RawPoint
  -> 基础合法性检查
     -> 硬拒绝: RawPoint / DisplayPoint / reject decision
  -> 质量评估 + 运动/静止判断
     -> 合格: TrackPoint -> 统计与 GPX
     -> 弱定位: RawPoint / DisplayPoint / reject decision(reason=weak_signal_stage1)
     -> 第二阶段可选: 候选缓冲 -> 趋势确认 -> 回填 TrackPoint
```

第一阶段不实现候选回填。一个点要么在当前回调被接受为 `TrackPoint`，要么只保留为 `RawPoint` / `DisplayPoint` / 诊断记录。

第二阶段的候选缓冲只能用于“延迟证明合理”的弱定位点，不能让第一阶段的 GPX 结果依赖事后重写。

注意：`WAITING_FIRST_FIX` 中 `20m < accuracy <= 30m` 的 `first_fix_relaxed` 是首点等待窗口的特例。它不是普通移动过程中的弱定位点，不使用 `weak_signal_stage1` 拒绝规则；但进入 GPX 时必须明确标记 `quality = RELAXED` 和 `decisionReason = first_fix_relaxed`。

### 轨迹记录优先真实 GNSS

本阶段正式轨迹只接受来自系统卫星定位的点：

```text
provider == LocationManager.GPS_PROVIDER
```

不使用网络定位点参与正式轨迹。

如果未来需要兜底粗定位，也只能用于地图当前位置展示，不能直接进入正式轨迹。

注意：Android 12/API 31 以后存在 `LocationManager.FUSED_PROVIDER`，部分设备也可能通过系统融合 provider 输出定位。本项目当前目标是测试纯系统 GNSS 轨迹质量，因此第一阶段只接受 `GPS_PROVIDER`。即使 `FUSED_PROVIDER` 来自系统，也不进入正式轨迹；后续若要扩展“系统融合定位测试”，应作为独立数据源单独标记和评估。

### GPX 导出基于正式轨迹点

GPX 不应导出全部原始点，而应导出过滤后的正式轨迹点。

长时间无定位、暂停恢复、严重跳点后恢复时，应导出为多个 `<trkseg>`。

### 时间基准必须统一

定位判断应优先使用 `elapsedRealtimeNanos` 作为单调时间基准。

`Location.getTime()` 适合写入 GPX 和展示，但它受系统时间调整影响，不适合作为内部连续性判断的唯一依据。

开始监听 `GPS_PROVIDER` 时应保存：

```text
gnssRequestStartElapsedRealtimeNanos
```

记录开始时应保存：

```text
recordStartWallTimeMillis
recordStartElapsedRealtimeNanos
```

后续定位点必须检查：

```text
location.elapsedRealtimeNanos >= recordStartElapsedRealtimeNanos - toleranceNanos
toleranceNanos = 1_000_000_000L
maxLocationAgeNanos = 30_000_000_000L
```

避免把开始记录前的旧定位点当成首点。

`toleranceNanos` 只用于补偿系统回调、线程调度或记录开始瞬间的微小时间误差。明显早于开始记录的缓存位置不能进入首点候选、`TrackPoint` 或 GPX。

`maxLocationAgeNanos` 用于过滤明显过旧的定位结果。第一阶段建议设为 30 秒，超过该阈值的点只记录为 `RawPoint`，不进入 `TrackPoint`：

```text
SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos > maxLocationAgeNanos
rejectReason = location_too_old
```

实现时必须先检查：

```text
hasValidElapsedRealtime(location)
```

如果定位点没有有效的 `elapsedRealtimeNanos`：

```text
只记录为 RawPoint
不进入 TrackPoint
rejectReason = missing_elapsed_realtime
```

Android `Location` 不应直接写成 `location.hasElapsedRealtimeNanos()`。第一阶段应在项目内实现 helper：

```text
hasValidElapsedRealtime(location):
  elapsedRealtimeNanos = location.getElapsedRealtimeNanos()
  nowElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
  elapsedRealtimeNanos > 0
  elapsedRealtimeNanos <= nowElapsedRealtimeNanos + toleranceNanos
  nowElapsedRealtimeNanos - elapsedRealtimeNanos <= maxLocationAgeNanos
```

`getElapsedRealtimeNanos()` 是正式取值来源；helper 只负责判断这个值是否足以参与本项目的时间连续性计算。

## 数据来源

### 1. 系统 Location

通过 `LocationManager.GPS_PROVIDER` 获取：

- `latitude`
- `longitude`
- `altitude`
- `accuracy`
- `speed`
- `bearing`
- `time`
- `elapsedRealtimeNanos`
- `provider`

定位请求建议：

```text
provider: LocationManager.GPS_PROVIDER
minTimeMs: 1000
minDistanceMeters: 0
```

距离过滤不要交给系统做。App 层需要拿到尽可能完整的原始点，然后自行判断。

第一阶段请求策略：

```text
实验室模式:
  requestLocationUpdates(GPS_PROVIDER, minTimeMs=1000, minDistanceMeters=0)
  App 保持前台可见
  不承诺熄屏和后台连续性

真实徒步模式(M5):
  仍使用 GPS_PROVIDER
  由 location 前台服务持有请求
  允许根据功耗调整 minTimeMs，但必须写入 ConfigSnapshot
```

不要把 `minDistanceMeters` 设置成 5m、10m 之类的系统距离过滤。系统过滤会让 App 看不到静止漂移、弱信号跳点和 gap 恢复过程，后续就无法解释“为什么距离没有增长”或“为什么某个跳点被拒绝”。

采集层必须记录请求参数：

```text
locationRequestProvider = gps
locationRequestMinTimeMs
locationRequestMinDistanceMeters
locationRequestRegisteredElapsedRealtimeNanos
locationRequestThread
```

这些字段属于采集配置，不直接决定某个点是否进入 GPX，但会影响回放解释。例如同一条路线，`minTimeMs=1000` 和 `minTimeMs=5000` 得到的点密度、速度判断、静止判断都会不同。

Provider 状态变化处理：

```text
GPS Provider 开启:
  写 session_event(gps_provider_enabled)
  UI 更新 gpsProviderEnabled = true
  如果当前正在记录但没有 fix，继续等待

GPS Provider 关闭:
  写 session_event(gps_provider_disabled)
  UI 更新 gpsProviderEnabled = false
  正在记录时不得生成新的 TrackPoint
  如果已有正式轨迹，后续恢复时按 GAP_RECOVERY 或新 segment 处理

Provider 关闭期间到达的非 gps Location:
  只允许写 ignored_input 或 reject(provider_not_gps)
  不进入 TrackPoint
```

长时间无 Location 回调不是同一种问题，不能和弱定位混在一起：

```text
有 Location 但质量差:
  raw_location + reject decision
  可解释为 accuracy / speed / state 不合格

没有 Location 回调:
  没有 raw_location
  只能通过 session_event(no_location_timeout) 或 UI 计时解释
  不得伪造 RawPoint 或 TrackPoint
```

第一阶段可以记录 `session_event(no_location_timeout)` 并在 UI 展示“距上次 Location 已过去 X 秒”，但只把它作为诊断信息。M5 真实徒步模式再把它作为 gap、前台服务存活性和中断恢复分析的正式依据。

### 2. GNSS 卫星状态

通过 `GnssStatus.Callback` 获取：

- 可见卫星数
- `usedInFix`
- 星座类型：GPS / BeiDou / Galileo / GLONASS / QZSS
- `CN0`
- 高度角
- 方位角
- 载波频率

用于生成每个时间窗口的 GNSS 质量摘要。

`GnssStatus` 和 `Location` 不是同一个回调流，不能简单把“最新卫星状态”直接绑定到当前定位点。

实现时应缓存带时间戳的卫星状态快照：

```text
GnssStatusSnapshot {
  receivedElapsedRealtimeNanos
  visible/used/cn0 摘要
}
```

`GnssStatus.Callback.onSatelliteStatusChanged()` 不直接提供卫星状态产生时间。实现时只能在回调收到时使用：

```text
SystemClock.elapsedRealtimeNanos()
```

记录为 `receivedElapsedRealtimeNanos`。这表示 App 收到该状态的本地时间，不是 GNSS 芯片产生该状态的精确时间。

当 `Location` 到来时，选择最近的快照：

```text
优先选择 snapshotTime <= locationTime 且时间差 <= 3s 的最近快照
```

如果没有前序快照，可以选择 `snapshotTime > locationTime` 且时间差 <= 3s 的最近快照，但必须标记：

```text
matchedFromFuture = true
```

这种快照只能用于诊断展示，不应参与质量评分。

如果没有任何可匹配快照：

```text
gnssQualityStale = true
```

此时 GNSS 质量字段只能作为缺失诊断，不能参与轨迹硬拒绝。

快照缓存建议：

```text
只保留最近 2~5 分钟的 GnssStatusSnapshot
或最多保留最近 120~300 条
```

避免长时间记录时内存无限增长。导出诊断日志时可以流式写入，不要求全部常驻内存。

### 3. 原始 GNSS 测量

通过 `GnssMeasurementsEvent.Callback` 获取：

- 伪距相关数据
- 多普勒
- ADR
- 卫星时间
- 接收机时钟

这部分优先用于诊断，不直接参与普通轨迹生成。

必须避免一个误解：原始 GNSS 测量不是“每颗卫星给出一个定位点”。卫星广播的是轨道、时间等信号，手机接收机根据多颗卫星的观测量一起解算位置。Android `Location` 中的经纬度是系统定位栈综合解算后的结果，不是某一颗 GPS / 北斗 / Galileo 卫星单独给出的经纬度。

因此第一阶段 UI 应这样表达：

```text
系统定位结果:
  Android LocationManager.GPS_PROVIDER 输出的经纬度、精度、速度、bearing

卫星状态:
  当前可见/参与 fix 的卫星数量、星座、CN0、方位角、高度角

原始测量:
  每颗卫星的观测量和接收机时钟信息
  用于诊断，不直接等价于定位点
```

第一阶段不实现原始测量自主定位解算：

```text
不从 GnssMeasurementsEvent 自己计算 lat/lng
不把单颗卫星显示成“给出的定位点”
不把北斗/GPS/Galileo 分别导出为多条轨迹
只记录 constellationType、svid、cn0、usedInFix、carrierFrequency 等诊断字段
```

## Android 运行约束

真实徒步记录不能只依赖 `Activity` 存活。屏幕熄灭、切后台、省电策略、系统回收都会影响回调连续性。第一阶段如果只是桌面调试，可以先限制“App 前台可见、屏幕不熄灭”；但只要要做真实户外徒步测试，就应使用前台服务。

建议运行模式：

```text
实验室/短时测试:
  MainActivity 持有 RecordingSession
  App 保持前台可见
  UI 明确标记“非后台可靠记录模式”

真实徒步测试:
  RecordingForegroundService 持有 RecordingSession
  使用持续通知
  service type = location
  由用户在 App 前台点击开始记录后启动
```

权限与清单要求：

```text
必须:
  ACCESS_FINE_LOCATION
  FOREGROUND_SERVICE

面向 Android 14/API 34+ 且使用 location 前台服务:
  FOREGROUND_SERVICE_LOCATION
  android:foregroundServiceType="location"

如果需要从后台直接启动 location 前台服务:
  需要满足系统后台启动限制
  通常还需要 ACCESS_BACKGROUND_LOCATION
  第一阶段不做后台自动启动，要求用户从前台开始记录
```

如果用户只授予近似位置，当前项目不应把它当作可信 GNSS 轨迹输入：

```text
preciseLocationGranted = false:
  不开始可信轨迹记录
  UI 提示需要精确位置权限
  可允许查看权限/系统状态诊断
```

前台服务不是“定位更准”的来源，它只提高长时间记录的存活性和回调连续性。定位质量仍由系统 GNSS、设备天线、遮挡、星历状态和环境决定。服务运行中如果出现长 gap，不应靠直线补齐，应按本方案的 `GAP_RECOVERY` 和多 `<trkseg>` 处理。

必须记录运行环境快照，否则 Android 设备间差异无法复盘：

```text
runtime_snapshot:
  Android 版本、设备型号、权限精度、GPS Provider 状态
  前台服务是否运行
  是否处于省电模式
  是否忽略电池优化
```

## 核心数据模型

### SessionMetadata

一次点击“开始记录”对应一个 `SessionMetadata`。后续所有原始点、决策、分段、GPX 和诊断日志都必须归属到这个 `sessionId`。

建议字段：

```text
sessionId
createdWallTimeMillis
createdElapsedRealtimeNanos
diagnosticLogFileName
gpxFileName
state
completionState
schemaVersion
strategyVersion
```

规则：

```text
sessionId:
  每次 startRecording 新建
  建议使用 UUID 或 ULID
  不复用，不依赖递增整数

rawPointId / decisionId / trackPointId / segmentId / eventId / batchId:
  都是 session 内局部递增 ID
  对外引用时必须和 sessionId 一起使用

GPX 文件名和诊断日志文件名:
  应包含 sessionId 或 recordStartWallTimeMillis
  避免多次记录互相覆盖
```

`completionState` 建议：

```text
ACTIVE:
  正在记录或暂停中

FINISHED:
  已写入 finish_recording，且 session 正常结束

INTERRUPTED:
  App 进程被杀、前台服务异常停止、设备重启，未看到 finish_recording

ABORTED:
  startRecording 启动事务失败，没有形成可信记录
```

如果一个 JSONL 文件中出现多个 `sessionId`，ReplayRunner 必须先要求用户选择或显式传入目标 `sessionId`，不能默认把不同 session 的事件串起来。

### DiagnosticEventEnvelope

诊断日志每一行都应有统一 envelope，业务字段放在同一 JSON 对象中即可，第一阶段不必额外嵌套 `payload`。

必填字段：

```text
event
sessionId
eventSeq
schemaVersion
eventElapsedRealtimeNanos
writtenWallTimeMillis
```

规则：

```text
eventSeq:
  从 1 开始，按 JSONL 实际写入顺序递增
  是 replay 的权威排序字段
  同一个 session 内不能重复、不能倒退

eventElapsedRealtimeNanos:
  表示事件所描述对象的业务时间
  raw_location 使用 Location.elapsedRealtimeNanos
  session_event 使用生命周期事件发生时间
  decision 使用 decision 创建时间
  gnss_snapshot 使用快照接收时间

writtenWallTimeMillis:
  只用于诊断写入时间
  不参与轨迹判断
  不参与 batch checksum
```

`elapsedRealtimeNanos` 仍是轨迹连续性计算的时间基准；`eventSeq` 只是日志顺序基准。两者不能互相替代。

### SessionFileStore

`SessionFileStore` 是文件系统边界。它只处理目录、文件、临时文件和恢复扫描，不理解轨迹策略。

建议目录：

```text
files/track_sessions/{sessionId}/
  session.json
  diagnostic.jsonl
  diagnostic.jsonl.tmp
  track.gpx
  track.gpx.tmp
  export/
    track_{sessionId}_trusted.gpx
    track_{sessionId}_partial.gpx
    diagnostic_{sessionId}.jsonl
    replay_report_{sessionId}.json
    manifest.json
```

规则：

```text
session.json:
  保存 SessionMetadata 的最新快照
  可被启动恢复扫描快速读取

diagnostic.jsonl:
  append-only
  每行一个完整 JSON 对象
  不做原地修改

*.tmp:
  只用于创建或导出中的临时文件
  启动恢复时可以清理

export/:
  放用户主动导出的副本或分享文件
  不作为 replay 的权威来源
  可以删除后重新生成
```

`session.json` 建议不仅保存 `SessionMetadata`，还保存面向恢复扫描的轻量 manifest：

```text
sessionId
createdWallTimeMillis
createdElapsedRealtimeNanos
completionState
integrityState
schemaVersion
strategyVersion
diagnosticLogFileName
trustedGpxFileName
partialGpxFileName
lastEventSeq
lastUpdatedWallTimeMillis
trackPointCount
segmentCount
rawPointCount
lastKnownErrorCode
```

`session.json` 只是索引和 UI 快速展示缓存，不是 replay 的权威事实来源。Replay 的权威来源始终是 `diagnostic.jsonl` 中的完整行。

写入要求：

```text
创建新 session:
  先创建 session 目录
  写 session.json.tmp
  rename session.json.tmp -> session.json
  再打开 diagnostic.jsonl 追加写

追加 JSONL:
  单条事件必须一次序列化为一行
  行尾必须写入 \n
  写入失败时该事件视为未提交

结束 session:
  写 finish_recording session_event 成功后
  更新 session.json 中 completionState = FINISHED

导出 GPX:
  写 track.gpx.tmp
  close 成功后 rename track.gpx.tmp -> track.gpx
```

导出文件命名规则：

```text
可信 GPX:
  export/track_{sessionId}_trusted.gpx
  GPX extension: partial=false

中断 partial GPX:
  export/track_{sessionId}_partial.gpx
  GPX extension: partial=true
  文件名和 UI 文案必须包含 partial / 中断 字样

诊断日志导出:
  export/diagnostic_{sessionId}.jsonl
  可以直接复制 diagnostic.jsonl 的完整行
  不应为了“好看”重排 eventSeq

ReplayReport:
  export/replay_report_{sessionId}.json
  记录 replayStatus、strategyVersionMatched、diff 摘要
```

不要让 `track.gpx` 同时代表可信导出和 partial 导出。内部工作文件可以叫 `track.gpx`，但用户可见导出文件必须在文件名和 extension 中区分 trusted / partial。

第一阶段不强制每行都 `fsync`，否则会显著影响户外记录性能。但必须明确耐久性口径：

```text
写入成功:
  表示 Java/Kotlin 层 append/flush 没有报错
  可用于当前进程内提交 TrackRecorder

崩溃恢复:
  只能相信启动后实际能从 diagnostic.jsonl 读到的完整行
  半行或损坏 JSON 行必须忽略，并标记 replayStatus = INVALID_LOG 或 INTERRUPTED

高可靠测试开关:
  可提供 flushEveryEvent / fsyncEveryEvent
  用于短时间实验，不建议默认开启长途徒步
```

存储异常处理：

```text
磁盘空间不足 / Permission denied / rename 失败:
  当前提交失败
  sessionIntegrityState = ERROR
  UI 提示“存储写入失败，停止可信记录”
  允许导出已存在的诊断日志

启动时发现 .tmp 文件:
  如果对应正式文件存在，删除 .tmp
  如果正式文件不存在，按文件类型决定是否删除或标记 interrupted
```

### RawPoint

原始定位点，系统回调即记录。

`RawPoint` 的“记录”可以是内存环形缓冲、诊断日志文件，或两者结合。第一阶段建议：

```text
内存:
  保留最近 N 个 RawPoint，用于界面显示和即时决策追溯

诊断日志:
  记录完整 raw_location / decision 事件，用于结束后分析
```

这样既能避免长时间记录导致内存膨胀，又能保证 GPX 中每个 `TrackPoint` 都能追溯到原始定位和接受原因。

建议字段：

```text
id
timeMillis
elapsedRealtimeNanos
provider
latitude
longitude
altitude
hasAltitude
accuracy
speed
hasSpeed
bearing
hasBearing
isMock
gnssQualitySnapshot
rawRejectReason
isStaleBeforeRecordStart
gnssQualityStale
missingElapsedRealtime
```

### GnssQualitySnapshot

定位点附近一小段时间的卫星质量摘要。

建议字段：

```text
snapshotId
visibleTotal
usedInFixTotal
gpsVisible
gpsUsed
beidouVisible
beidouUsed
galileoVisible
galileoUsed
glonassVisible
glonassUsed
qzssVisible
qzssUsed
bestCn0
avgCn0
usedAvgCn0
snapshotElapsedRealtimeNanos
ageFromLocationMillis
stale
matchedFromFuture
```

### TrackPoint

正式轨迹点。

建议字段：

```text
id
segmentId
timeMillis
latitude
longitude
altitude
accuracy
speed
bearing
distanceFromStartMeters
quality
acceptReason
decisionResult
decisionReason
distanceDeltaMeters
movingTimeDeltaSeconds
sourceRawPointId
sourceDecisionId
elapsedRealtimeNanos
```

说明：

```text
acceptReason:
  仅兼容第一阶段 UI/GPX 展示
  decisionResult = accept 时，必须等于 decisionReason
  decisionResult = anchor 时，应为空或不写

decisionResult:
  accept / anchor

decisionReason:
  统一记录 accepted 或 anchor trackpoint 的原因

sourceDecisionId:
  指向最终 accept / anchor decision
  不指向 pending decision
  用于在存在 pending + final 多条 decision 时精确追溯

distanceDeltaMeters / movingTimeDeltaSeconds:
  当前点相对上一个可累计点贡献的距离和运动时间
  anchor-only 点必须为 0
```

### TrackSegment

轨迹分段。

建议字段：

```text
segmentId
startTimeMillis
endTimeMillis
reason
points
```

常见分段原因：

```text
start
pause_resume
long_gnss_gap
jump_recovery
manual_split
```

### SessionEvent

记录会话生命周期事件。它不是定位点，也不生成 `TrackPoint`，但会影响状态轴、首点候选窗口、分段和回放。

建议字段：

```text
eventId
batchId
eventType
elapsedRealtimeNanos
wallTimeMillis
recordingStateBefore
recordingStateAfter
fixStateBefore
fixStateAfter
motionStateBefore
motionStateAfter
reason
```

`batchId` 可为空。普通生命周期事件，如 `start_recording` 且不触发 pending 收敛时，可以作为独立 `session_event` 写入。会触发 pending 收敛或分段批量变更的生命周期事件，必须写在 `DecisionBatchCommit` 内，并带同一个 `batchId`。

`eventType` 建议：

```text
start_recording
pause_recording
resume_recording
finish_recording
first_fix_window_expired
gps_provider_enabled
gps_provider_disabled
no_location_timeout
command_ignored
```

`command_ignored` 只表示用户或 UI 发来了当前状态不允许的命令。它不应伪装成正常 pause/resume/finish，也不应触发 pending 收敛。

`no_location_timeout` 表示监听已开启但超过阈值仍没有收到新的 `GPS_PROVIDER` Location。它不是 RawPoint，也不表示定位点被拒绝；它只说明采集流中断或系统没有产出 fix。

### ConfigSnapshot

每次开始记录时写入一条配置快照，保证诊断日志可以离线回放。不要只依赖当前 App 代码里的默认值，因为后续阈值变化会让旧日志无法复现。

建议字段：

```text
configId
schemaVersion
strategyVersion
createdElapsedRealtimeNanos
toleranceNanos
maxLocationAgeNanos
locationRequestProvider
locationRequestMinTimeMs
locationRequestMinDistanceMeters
noLocationTimeoutMillis
gnssSnapshotMatchWindowMillis
firstFixWindowMillis
firstFixGoodAccuracyMeters
firstFixRelaxedAccuracyMeters
forcedWeakFirstFixEnabled
flushEveryEventForTest
fsyncEveryEventForTest
ordinaryGoodAccuracyMeters
weakAccuracyMaxMeters
suspiciousSpeedMetersPerSecond
impossibleSpeedMetersPerSecond
gapRecoveryMillis
longGapMillis
```

`schemaVersion` 表示诊断日志字段结构版本，`strategyVersion` 表示轨迹决策算法版本。阈值相同但策略代码变化时，必须更新 `strategyVersion`，否则旧日志 replay 出现差异时无法判断是 bug 还是版本差异。

第一阶段建议默认阈值：

```text
schemaVersion = 1
strategyVersion = stage1-gnss-track-v1
toleranceNanos = 1_000_000_000               // 1 秒，用于容忍记录开始边界附近的回调排序
maxLocationAgeNanos = 30_000_000_000         // 30 秒，过滤系统缓存旧点
locationRequestProvider = gps
locationRequestMinTimeMs = 1000
locationRequestMinDistanceMeters = 0
noLocationTimeoutMillis = 30_000             // 监听开启但长时间没有 Location
gnssSnapshotMatchWindowMillis = 3_000
firstFixWindowMillis = 10_000                // 首点候选窗口
firstFixGoodAccuracyMeters = 20
firstFixRelaxedAccuracyMeters = 30
ordinaryGoodAccuracyMeters = 30
weakAccuracyMaxMeters = 50
suspiciousSpeedMetersPerSecond = 8
impossibleSpeedMetersPerSecond = 12
stationaryRadiusMeters = max(5, accuracy * 1.5)
stationaryMinDurationMillis = 30_000
gapRecoveryMillis = 30_000
longGapMillis = 120_000
forcedWeakFirstFixEnabled = false
flushEveryEventForTest = false
fsyncEveryEventForTest = false
```

阈值修改规则：

```text
调试 UI 可以展示 ConfigSnapshot，但默认不提供随手改阈值入口
如果为了测试打开 forcedWeakFirstFixEnabled，必须写入 config_snapshot
如果修改任一影响决策的阈值，必须生成新的 configId
如果修改策略代码，即使阈值不变，也必须更新 strategyVersion
如果只修改 UI 文案、颜色或展示顺序，不需要更新 strategyVersion
```

这些阈值不是“真理”，而是第一阶段的可复现起点。后续真机测试要调整阈值时，必须通过 replay fixtures 证明不会引入明显回归。

### RuntimeSnapshot

每次开始记录时写入一条运行环境快照。它不参与轨迹策略计算，但用于解释 Android 设备差异、权限状态和长时间无 fix。

建议字段：

```text
runtimeSnapshotId
createdElapsedRealtimeNanos
appVersion
androidSdkInt
deviceManufacturer
deviceModel
locationProviderGpsEnabled
preciseLocationGranted
backgroundLocationGranted
foregroundServiceActive
foregroundServiceTypeLocationDeclared
powerSaveMode
ignoringBatteryOptimizations
networkAvailable
```

字段边界：

```text
ConfigSnapshot:
  记录算法阈值和策略版本
  replay 时参与 expected/actual 判断

RuntimeSnapshot:
  记录系统运行环境
  replay 时只作为解释上下文
  不参与 TrackDecisionEngine 计算
```

如果缺少 `RuntimeSnapshot`，replay 仍可继续，但只能解释为“策略可复现，运行环境不可复盘”。如果缺少 `ConfigSnapshot`，replay 不能作为策略正确性的证明。

`SessionMetadata`、`ConfigSnapshot`、`RuntimeSnapshot` 的关系：

```text
SessionMetadata:
  说明这是哪一次记录
  提供 sessionId 和文件命名锚点

ConfigSnapshot:
  说明这次记录使用哪套轨迹策略
  影响 replay 策略判断

RuntimeSnapshot:
  说明这次记录运行在什么 Android 环境
  只解释输入质量和系统行为
```

## 架构模块边界

第一阶段不要把采集、决策、统计、导出全部写进 `MainActivity`。`MainActivity` 只负责权限、生命周期、按钮和界面渲染；轨迹策略应放在可测试的普通 Java 类中。

推荐按“输入采集、数据归一、决策、提交、导出”拆模块。第一阶段即使先用 Java 普通类实现，也应保持这些边界，避免后续轨迹策略只能在 `MainActivity` 里堆条件。

建议模块与职责：

```text
MainActivity:
  负责权限、按钮、生命周期、UI 渲染
  实验室模式可直接调用 RecordingSession.start/pause/resume/finish/export
  真实徒步模式应启动/绑定 RecordingForegroundService，再由 service 持有 RecordingSession
  不计算距离
  不生成 reject reason
  不直接拼 GPX

RecordingForegroundService:
  负责长时间记录时的 Android 前台服务生命周期和通知
  持有 RecordingSession
  负责在 service 停止前调用 finish 或 pause
  将 start/pause/resume/finish/export 命令投递给 RecordingEventDispatcher
  不计算距离
  不生成 reject reason
  不直接拼 GPX

SystemLocationSource:
  负责 LocationManager.GPS_PROVIDER 的注册、注销和原始 Location 回调
  负责 GnssStatus / GnssMeasurementsEvent 注册、注销
  将 Location / GnssStatus / GnssMeasurementsEvent 回调投递给 RecordingEventDispatcher
  不做轨迹判断
  输出系统 Location / GnssStatus / GnssMeasurementsEvent

RecordingEventDispatcher:
  负责把按钮命令、Location 回调、GnssStatus 回调、首点窗口超时事件串行化
  真实徒步模式下建议使用 HandlerThread 或 single-thread Executor
  只有 dispatcher 所在线程可以调用 RecordingSession 的可变方法
  负责调度 first_fix_window_expired timer，并把 timer 结果作为普通输入事件入队
  不做轨迹判断
  不分配 rawPointId / decisionId / trackPointId / segmentId

SessionFileStore:
  负责 track_sessions/{sessionId} 目录创建、临时文件、rename、恢复扫描
  负责检查可写性和可用空间
  不解析轨迹策略
  不决定 TrackPoint 是否接受
  不修改 TrackRecorder

GnssSnapshotStore:
  负责 GnssStatusSnapshot 缓存、裁剪和按 Location 时间匹配
  输出匹配到的 GnssQualitySnapshot
  只说明卫星质量和快照新鲜度
  不决定 TrackPoint 是否接受

RawPointFactory:
  将系统 Location + GnssQualitySnapshot 转成 RawPoint
  分配 rawPointId
  保留 provider/time/accuracy/speed/bearing/mock/elapsedRealtimeNanos 原始证据
  不决定是否进入 GPX

LocationValidator:
  执行 provider/time/accuracy/mock/坐标等基础合法性检查
  输出 ValidationResult
  只做与状态机无关的硬合法性判断
  不判断静止、移动、gap recovery

FirstFixCoordinator:
  管理 WAITING_FIRST_FIX 候选窗口
  负责 pending candidate 的登记、排序、超时和收敛
  由 RecordingEventDispatcher 投递的时钟事件驱动窗口超时，不依赖下一次 Location 才收敛
  输出首点候选选择结果和 pending/final 建议
  不分配最终 decisionId
  不直接写 GPX

TrackDecisionEngine:
  组合 ValidationResult、状态轴、RawPoint、上一轨迹上下文和 FirstFixCoordinator 输出
  输出 TrackDecisionDraft
  最终 TrackDecision 由 RecordingSession 在提交阶段补齐 decisionId / trackPointId / segmentId 后生成
  不修改 TrackRecorder
  不直接写文件
  不调用 GpxExporter

TrackRecorder:
  根据 TrackDecision 准备并应用 TrackPoint / TrackSegment mutation
  维护当前 segment、movingAnchor、lastAcceptedPoint
  维护距离、recordingTime、movingTime
  不重新判断 RawPoint 是否合格
  prepare 阶段只预生成对象和校验统计增量，不修改统计
  apply 阶段只应用已准备 mutation，不再分配 ID 或重新判断

RecordingSession:
  第一阶段的编排层和提交边界
  持有 SessionMetadata / sessionId
  持有 RecordingState / FixState / MotionState
  持有 ConfigSnapshot
  持有 RuntimeSnapshot
  按固定顺序调用 RawPointFactory、LocationValidator、TrackDecisionEngine、DiagnosticLogger、TrackRecorder
  负责原子提交 TrackDecision + TrackPoint + segment event
  负责提交 session_metadata / config_snapshot / runtime_snapshot / session_event
  负责把触发 pending 收敛的 session_event 放入 DecisionBatchCommit
  负责处理 start/pause/resume/finish/first_fix_window_expired 等非 Location 事件
  不直接暴露给 Android 回调线程调用
  负责把日志失败、提交失败标记为 session integrity error

DiagnosticLogger:
  以 JSON Lines 追加写入 session_metadata / config_snapshot / runtime_snapshot / session_event / raw_location / segment / decision / decision_batch_begin / decision_batch_commit / gnss_snapshot / gnss_measurement_summary / ignored_input
  通过 SessionFileStore 打开和追加 diagnostic.jsonl
  只做 append-only 持久化
  负责为每条日志分配 eventSeq
  不参与决策计算
  不分配 rawPointId / decisionId / trackPointId / segmentId
  不改变 TrackRecorder 状态

GpxExporter:
  接收由 RecordingSession 冻结的只读 ExportSnapshot
  通过 SessionFileStore 写入临时 GPX 并原子替换最终 GPX
  只读取 ExportSnapshot 中的正式 TrackPoint / TrackSegment
  不重新过滤 RawPoint
  不从诊断日志反推轨迹
  导出前校验 sourceDecisionId 完整性
  当 sessionIntegrityState = ERROR 时拒绝导出可信 GPX

ReplayRunner:
  第一阶段可先预留接口，第二阶段再做完整 UI
  用诊断日志中的 session_metadata / config_snapshot / runtime_snapshot / session_event / raw_location / gnss_snapshot 离线重跑 TrackDecisionEngine
  通过 RecordingSession 的 replay mode 推进状态，不依赖 Android LocationManager
  按 sessionId 过滤日志
  按 eventSeq 还原日志顺序
  用于验证相同输入顺序下 decision 是否稳定
```

模块依赖方向：

```text
实验室临时模式: MainActivity -> RecordingSession
推荐统一模式: MainActivity / RecordingForegroundService / SystemLocationSource -> RecordingEventDispatcher -> RecordingSession
RecordingSession -> SystemLocationSource
RecordingSession -> GnssSnapshotStore
RecordingSession -> RawPointFactory
RecordingSession -> LocationValidator
RecordingSession -> FirstFixCoordinator
RecordingSession -> TrackDecisionEngine
RecordingSession -> DiagnosticLogger
RecordingSession -> TrackRecorder
RecordingEventDispatcher -> RecordingSession(create ExportSnapshot)
DiagnosticLogger -> SessionFileStore
GpxExporter -> SessionFileStore
GpxExporter -> ExportSnapshot 只读快照
ReplayRunner -> RecordingSession(replay mode)
ReplayRunner -> RawPointFactory / LocationValidator / FirstFixCoordinator / TrackDecisionEngine / TrackRecorder
```

禁止反向依赖：

```text
GpxExporter 不应读取 RawPoint 并重新做决策
GpxExporter 不应直接读取 DiagnosticLogger 或 FirstFixCoordinator
DiagnosticLogger 不应改变 TrackRecorder 状态
SessionFileStore 不应解析 decision reason 或修改 session 状态
MainActivity 不应直接计算距离、分段或 reject reason
真实徒步模式下，MainActivity / RecordingForegroundService / SystemLocationSource 不应从回调线程直接修改 RecordingSession
RecordingEventDispatcher 不应在记录线程执行 GPX 文件写入
GpxExporter 不应访问 RecordingSession / TrackRecorder 的可变状态
GnssSnapshotStore 不应决定 TrackPoint 是否接受
TrackDecisionEngine 不应直接创建 TrackPoint
TrackRecorder 不应读取 GnssStatus 重新评分
GpxExporter 不应修改 TrackRecorder 状态
RawPointFactory 不应读取 RecordingState 决定是否丢点
ReplayRunner 不应依赖 Android 回调线程或实时 SystemClock
ReplayRunner 不应注册 LocationManager 或 GnssStatus callback
```

状态归属必须明确：

```text
RecordingSession:
  RecordingState
  FixState
  MotionState
  sessionMetadata
  sessionId
  completionState
  recordStartElapsedRealtimeNanos
  gnssRequestStartElapsedRealtimeNanos
  configSnapshot
  runtimeSnapshot
  sessionIntegrityState
  lastIntegrityError

RecordingEventDispatcher:
  单线程输入队列
  first-fix window timer
  已投递但未处理的 command/input 数量

GnssSnapshotStore:
  最近一段 GnssStatusSnapshot 环形缓存

FirstFixCoordinator:
  pending first-fix candidate 池
  first-fix window start/end

TrackRecorder:
  TrackSegment 列表
  TrackPoint 列表
  lastAcceptedPoint
  movingAnchor
  distance / recordingTime / movingTime

DiagnosticLogger:
  append-only 文件句柄和写入结果
  nextEventSeq

SessionFileStore:
  track_sessions 根目录
  当前 session 目录
  diagnostic 临时/正式文件状态
  gpx 临时/正式文件状态
```

当前项目包名是 `com.example.gnsssatdemo`，第一阶段建议包结构：

```text
com.example.gnsssatdemo.location:
  SystemLocationSource
  GnssSnapshotStore
  GnssQualitySnapshot

com.example.gnsssatdemo.track.model:
  SessionMetadata
  DiagnosticEventEnvelope
  RecordingInputEvent
  RecordingCommand
  RawPoint
  TrackPoint
  TrackSegment
  SessionEvent
  ConfigSnapshot
  RuntimeSnapshot
  SessionCompletionState
  SessionIntegrityState
  SessionIntegrityError
  ExportSnapshot
  ValidationResult
  TrackDecisionDraft
  TrackDecision
  DecisionCommit
  DecisionBatchCommit
  PreparedRecorderMutation

com.example.gnsssatdemo.track.engine:
  RecordingEventDispatcher
  LocationValidator
  FirstFixCoordinator
  TrackDecisionEngine
  TrackRecorder
  RecordingSession

com.example.gnsssatdemo.service:
  RecordingForegroundService

com.example.gnsssatdemo.export:
  SessionFileStore
  GpxExporter
  DiagnosticLogger

com.example.gnsssatdemo.replay:
  ReplayRunner
  ReplayReport
  ReplayStatus
```

第一阶段可以先不做复杂 DI。短时实验室模式下，`MainActivity` 可以手动创建 `RecordingSession`；真实户外徒步模式下，应改为 `RecordingForegroundService` 持有 `RecordingSession`。无论哪种模式，`MainActivity` 都不要直接持有 `TrackRecorder`、`TrackDecisionEngine` 或 `DiagnosticLogger` 的细节。若要把实验室模式也纳入验收，建议同样走 `RecordingEventDispatcher`。

### 模块接口契约

第一阶段不需要复杂框架，但需要把输入输出边界固定下来。接口可以是 Java interface，也可以先是普通 class 的公开方法；关键是调用方向和返回对象不能乱。

建议接口形态：

```text
SystemLocationSource:
  start(requestConfig)
  stop()
  setListener(LocationInputListener)
  输出:
    onLocation(Location, receivedElapsedRealtimeNanos)
    onGnssStatus(GnssStatus, receivedElapsedRealtimeNanos)
    onProviderChanged(provider, enabled, receivedElapsedRealtimeNanos)

RecordingEventDispatcher:
  dispatch(command)
  dispatch(locationInput)
  dispatch(gnssStatusInput)
  dispatch(timerInput)
  shutdown()
  保证:
    所有输入按入队顺序调用 RecordingSession
    timer 事件也走同一队列
    不在调用方线程直接修改 RecordingSession

RecordingSession:
  start(StartRecordingCommand): SessionStartResult
  pause(PauseRecordingCommand): SessionCommandResult
  resume(ResumeRecordingCommand): SessionCommandResult
  finish(FinishRecordingCommand): SessionFinishResult
  onLocation(LocationInput): DecisionCommitResult
  onGnssStatus(GnssStatusInput): SnapshotCommitResult
  onTimer(TimerInput): SessionCommandResult
  createExportSnapshot(): ExportSnapshotResult
  保证:
    只有 RecordingEventDispatcher 所在线程调用可变方法
    所有状态变化都能在 diagnostic.jsonl 中解释
    返回结果只用于 UI 展示，不让 UI 反向修改内部状态

LocationValidator:
  validate(rawPoint, config, sessionTimeBounds, nowElapsedRealtimeNanos): ValidationResult
  保证:
    只做全局硬合法性检查
    不读取 TrackRecorder
    不判断运动状态

FirstFixCoordinator:
  onValidRawPoint(rawPoint, validationResult, config, currentWindow): FirstFixAction
  onWindowExpired(config): FirstFixSettlement
  onPauseOrFinish(config): FirstFixSettlement
  保证:
    pending candidate 必须最终收敛
    不分配 final decisionId
    不创建 TrackPoint

TrackDecisionEngine:
  decide(rawPoint, validationResult, context, firstFixAction, config): TrackDecisionDraft
  settlePending(settlement, context, config): List<TrackDecisionDraft>
  保证:
    只输出 draft
    不写日志
    不修改 TrackRecorder
    不访问 Android LocationManager

TrackRecorder:
  prepare(decision, rawPoint, context): PreparedRecorderMutation
  apply(preparedRecorderMutation): TrackRecorderSnapshot
  createExportSnapshot(sessionMetadata, configSnapshot, runtimeSnapshot): ExportSnapshot
  保证:
    prepare 不修改内部状态
    apply 不重新计算决策
    ExportSnapshot 是不可变快照

DiagnosticLogger:
  append(event): AppendResult
  appendBatch(events): AppendBatchResult
  flush(): FlushResult
  close(): CloseResult
  保证:
    eventSeq 只在 logger 内单调分配
    不修改轨迹状态
    append 失败必须返回错误，不吞掉异常

GpxExporter:
  export(exportSnapshot, exportOptions): GpxExportResult
  保证:
    不访问 RecordingSession 可变状态
    不重新筛点
    写入 track.gpx.tmp 成功后再 rename

ReplayRunner:
  run(diagnosticLog, expectedReport, options): ReplayReport
  保证:
    不注册 Android LocationManager
    按 eventSeq 重放
    对 batch 完整性做校验
```

统一返回结果建议：

```text
Result {
  ok
  errorCode
  userMessage
  diagnosticMessage
  sessionIntegrityStateAfter
  snapshotForUi
}
```

`userMessage` 可以给 UI 展示，`diagnosticMessage` 只写日志或调试界面。业务代码不应通过解析中文 `userMessage` 做分支判断，必须使用 `errorCode` / enum。

建议第一阶段固定错误码，避免 UI、日志和 replay 各自发明失败原因：

```text
permission_precise_location_missing:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 否，记录不能开始
  UI: 提示需要精确位置权限

gps_provider_disabled:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 否，或只进入诊断等待态
  UI: 提示打开系统定位/GPS Provider

session_directory_create_failed:
  是否改变 sessionIntegrityState: ERROR
  是否允许继续记录: 否
  UI: 提示无法创建记录目录

diagnostic_log_open_failed:
  是否改变 sessionIntegrityState: ERROR
  是否允许继续记录: 否
  UI: 提示无法创建诊断日志

diagnostic_log_append_failed:
  是否改变 sessionIntegrityState: ERROR
  是否允许继续记录: 否，停止可信记录
  UI: 提示记录已进入错误状态，可导出已有诊断信息

track_recorder_apply_failed:
  是否改变 sessionIntegrityState: ERROR
  是否允许继续记录: 否，停止可信记录
  UI: 提示轨迹提交失败

export_snapshot_invalid:
  是否改变 sessionIntegrityState: 不一定，取决于 invalid 原因
  是否允许继续记录: 不影响当前记录
  UI: 提示当前轨迹无法导出可信 GPX

gpx_temp_write_failed:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 是
  UI: 提示 GPX 导出失败，可重试

gpx_rename_failed:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 是
  UI: 提示 GPX 保存失败，可重试

replay_invalid_log:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 不适用
  UI: 提示日志损坏或不完整

command_not_allowed:
  是否改变 sessionIntegrityState: 否
  是否允许继续记录: 取决于当前合法状态，不因该错误改变
  UI: 提示当前状态下不能执行该操作
```

`sessionIntegrityState` 只描述“当前 session 的诊断日志、内存轨迹和可导出结果是否仍一致”。权限缺失、GPS 关闭、无 fix 不是完整性错误；日志写失败、commit 后 apply 失败才是完整性错误。

### 输入串行化与线程模型

Android 的输入来自多路回调：定位、卫星状态、按钮、前台服务生命周期、首点窗口超时。第一阶段不要让这些回调直接改 `RecordingSession`，否则 `pause_recording` 和 `onLocationChanged` 的先后关系会变成线程调度随机数。

建议统一输入模型：

```text
RecordingInputEvent:
  inputType
  receivedElapsedRealtimeNanos
  payload

inputType:
  command_start
  command_pause
  command_resume
  command_finish
  command_export_gpx
  location_changed
  gnss_status_changed
  gnss_measurements_changed
  first_fix_window_timer
  no_location_timer
  provider_enabled
  provider_disabled
```

线程规则：

```text
1. SystemLocationSource 只把 Android callback 包装成 RecordingInputEvent 并投递
2. MainActivity / RecordingForegroundService 只投递 command，不直接改轨迹状态
3. RecordingEventDispatcher 使用单线程队列按 FIFO 处理 input
4. 只有 dispatcher 线程可以调用 RecordingSession.start/pause/resume/finish/onLocation/onGnssStatus
5. DiagnosticLogger 的 eventSeq 按实际诊断事件写入顺序分配
6. ReplayRunner 不重放 Android 线程，只重放 JSONL 中的 eventSeq 顺序
```

关键边界：

```text
如果 location_changed 先于 pause command 被 dispatcher 处理:
  该点按 RECORDING 状态判断
  如果被接受，这是合法结果
  诊断日志中的 eventSeq 会说明它发生在 pause 前

如果 pause command 先于 location_changed 被 dispatcher 处理:
  后续 location_changed 只能生成 RawPoint / DisplayPoint / reject
  不得生成 accept / anchor TrackPoint

如果 finish command 已处理:
  后续 location_changed / timer 事件不得生成 TrackPoint
  可以丢弃，或只写 ignored input 诊断

如果 first_fix_window_timer 入队后，pause/finish 先被处理:
  timer 事件处理时必须重新检查 RecordingState
  PAUSED / FINISHED 下不得生成 accept / anchor TrackPoint

如果 no_location_timer 触发:
  只检查距 lastLocationReceivedElapsedRealtimeNanos 的间隔
  可以写 session_event(no_location_timeout)
  不生成 RawPoint
  不生成 TrackPoint
  不直接累计距离或 movingTime
```

定时器规则：

```text
首点窗口开始:
  RecordingEventDispatcher 安排 first_fix_window_timer

Location 到达:
  更新 lastLocationReceivedElapsedRealtimeNanos
  如仍在记录，重新安排 no_location_timer

pause / finish:
  取消未触发 timer，或允许 timer 入队但处理时成为 no-op

resume:
  如果需要重新等待首点，安排新的 timer
  如果进入 GAP_RECOVERY，不复用旧 timer
```

队列背压：

```text
Location 回调积压时:
  不应丢弃已经进入队列且属于当前 session 的 location_changed
  可以在 SystemLocationSource 层降低请求频率
  可以限制 UI 展示用 RawPoint 缓冲
  不得为了追上 UI 而跳过 decision 日志

GnssStatus 回调积压时:
  可以合并过旧的未处理快照
  但一旦快照已经写入 gnss_snapshot，就必须保持 eventSeq 顺序
```

导出命令边界：

```text
command_export_gpx:
  在 RecordingEventDispatcher 线程上执行导出前置校验
  生成不可变 ExportSnapshot
  将 ExportSnapshot 交给 IO 线程执行 GpxExporter
  GpxExporter 不再访问 RecordingSession / TrackRecorder / DiagnosticLogger

导出过程中继续记录:
  如果 session 仍在 RECORDING，默认不导出可信 GPX
  如果产品需要“导出当前片段”，必须标记 partial=true
  partial 导出使用当时冻结的 ExportSnapshot，不跟随后续点变化
```

这个串行化规则是 `eventSeq` 可信的前提。没有单线程输入边界，`eventSeq` 只能说明写日志顺序，不能可靠解释暂停、恢复、首点超时和定位回调之间的因果关系。

### 状态轴

不要把所有状态塞进一个单一 enum。第一阶段可以在代码中拆成多轴状态，再由 `TrackDecisionEngine` 组合判断：

```text
RecordingState:
  IDLE / RECORDING / PAUSED / FINISHED

FixState:
  WAITING_FIRST_FIX / FIX_READY / GAP_RECOVERY

MotionState:
  UNKNOWN / STATIONARY / MOVING

QualityState:
  GOOD / RELAXED / WEAK / STALE_GNSS_QUALITY

SessionIntegrityState:
  OK / ERROR

SessionCompletionState:
  ACTIVE / FINISHED / INTERRUPTED / ABORTED
```

组合规则示例：

```text
RecordingState = PAUSED:
  不生成 accept TrackPoint
  不生成 anchor TrackPoint
  不写入 GPX

FixState = WAITING_FIRST_FIX:
  走 FirstFixCoordinator

FixState = GAP_RECOVERY:
  恢复后的首个正式点走 anchor decision

MotionState = STATIONARY:
  不累计距离

QualityState = WEAK:
  第一阶段只记录 RawPoint / DisplayPoint / reject decision
  forced_weak_first_fix 测试开关是唯一例外，必须显式标记 quality = WEAK

SessionIntegrityState = ERROR:
  禁止导出可信 GPX
  仍允许导出诊断 JSONL
  UI 必须提示当前记录存在完整性错误

SessionCompletionState = INTERRUPTED:
  表示记录没有正常 finish
  不等于策略错误或日志损坏
  UI 应提示这是中断记录
```

文档中的 `WAITING_FIRST_FIX`、`TRACKING_MOVING`、`GAP_RECOVERY` 等可以继续作为 UI 展示状态，但实现上建议由这些状态轴组合生成。UI 展示状态不能反向驱动轨迹判断。

命名边界必须清楚：

```text
QualityState:
  状态轴，只表达当前定位质量状态
  参与 TrackDecisionEngine 的判断

TrackDecision.quality / TrackPoint.quality:
  导出和诊断标签
  可取 GOOD / RELAXED / WEAK / REJECTED / STALE_GNSS_QUALITY / ANCHOR_ONLY
  其中 ANCHOR_ONLY 不是定位质量，而是“进入 GPX 但不累计距离/时间”的轨迹角色标签
```

实现时建议 Java enum 分开命名：

```text
QualityState
DecisionQuality
```

`SessionIntegrityState` 不是轨迹质量，也不参与 `TrackDecisionEngine` 判断。它只表达“诊断日志、内存轨迹、可导出 GPX 是否仍然一致”。第一阶段只保留 `OK / ERROR` 两个状态，不再额外设计 `EXPORT_BLOCKED`，因为能否导出可信 GPX 可以由 `sessionIntegrityState` 推导。

`SessionCompletionState` 只表达记录是否正常结束，不表达日志和轨迹是否一致。一个 session 可以是：

```text
completionState = FINISHED, integrityState = OK:
  可导出可信 GPX

completionState = INTERRUPTED, integrityState = OK:
  日志未必损坏，但不是用户正常结束的完整记录
  可导出诊断 JSONL
  GPX 只能作为 partial GPX，必须明确标记

completionState = FINISHED, integrityState = ERROR:
  记录已结束，但轨迹和诊断日志不一致
  禁止导出可信 GPX
```

建议错误模型：

```text
SessionIntegrityError {
  errorCode
  failedStage
  rawPointId
  decisionId
  batchId
  eventId
  elapsedRealtimeNanos
  message
}
```

一旦进入 `ERROR`：

```text
1. 当前 session 不再允许导出可信 GPX
2. 已写出的诊断 JSONL 仍可导出，用于问题排查
3. UI 显示完整性错误和 failedStage
4. 后续是否继续采集 RawPoint 由产品决定，但不能把该 session 恢复成 OK
```

### 会话生命周期边界

生命周期事件必须由 `RecordingSession` 统一处理，不能让按钮回调直接改 `TrackRecorder` 或 `FirstFixCoordinator`。每个生命周期入口都应先判断当前状态是否合法，再写入 `session_event` 或 `DecisionBatchCommit`。

建议规则：

```text
startRecording:
  合法前置状态: IDLE / FINISHED
  创建 SessionMetadata 和 sessionId
  SessionFileStore 创建 session 目录并写 session.json
  prepare 新 session: TrackRecorder、FirstFixCoordinator、计数器和 lastIntegrityError
  创建 ConfigSnapshot
  创建 RuntimeSnapshot
  保存 recordStartElapsedRealtimeNanos / recordStartWallTimeMillis
  预生成 start_recording SessionEvent
  预设 RecordingStateAfter = RECORDING
  预设 completionState = ACTIVE
  预设 FixStateAfter = WAITING_FIRST_FIX
  预设 MotionStateAfter = UNKNOWN
  写 session_metadata
  写 config_snapshot
  写 runtime_snapshot
  写 session_event(eventType = start_recording)
  全部写入成功后才应用初始状态
  开启首点等待窗口

pauseRecording:
  合法前置状态: RECORDING
  如果存在 pending first-fix candidate，必须通过 DecisionBatchCommit 收敛为 reject
  写 session_event(eventType = pause_recording)
  设置 RecordingState = PAUSED
  停止累计 recordingTime / movingTime / distance
  不生成 accept / anchor TrackPoint
  标记下次恢复需要新 segment anchor

resumeRecording:
  合法前置状态: PAUSED
  写 session_event(eventType = resume_recording)
  设置 RecordingState = RECORDING
  设置 MotionState = UNKNOWN
  如果没有任何正式 TrackPoint，设置 FixState = WAITING_FIRST_FIX
  如果已有正式 TrackPoint，设置 FixState = GAP_RECOVERY
  开启新的首点候选窗口或 gap recovery 窗口

finishRecording:
  合法前置状态: RECORDING / PAUSED
  如果存在 pending first-fix candidate，必须通过 DecisionBatchCommit 收敛为 reject
  写 session_event(eventType = finish_recording)
  设置 RecordingState = FINISHED
  设置 completionState = FINISHED
  冻结 ExportSnapshot 输入
  不再接受新的 TrackPoint
```

非法状态转换应记录诊断，不应静默改状态：

```text
pauseRecording when IDLE:
  不改变状态
  可写 ui_event 或 ignored_session_event 诊断

resumeRecording when RECORDING:
  不改变状态
  不新建 segment

finishRecording when IDLE:
  不生成空 GPX
```

`pause_recording` 和 `finish_recording` 只要会触发 pending 收敛，就必须使用 `DecisionBatchCommit`。如果没有 pending candidate，也可以写独立 `session_event`；但第一阶段实现上可以统一走 batch 提交流程，降低分支复杂度。

`resume_recording` 默认不在恢复瞬间生成 segment event。新 segment 应在恢复后的第一个正式 anchor 点创建，这样 segment 起点仍然有真实 `TrackPoint` 和 `sourceDecisionId` 可追溯。

`startRecording` 的 `session_metadata / config_snapshot / runtime_snapshot / session_event(start_recording)` 必须是一个启动事务。任意一条写入失败时：

```text
不进入 RECORDING
不启动首点等待窗口
不允许导出空 GPX
UI 显示开始记录失败
保留错误日志用于排查
```

崩溃或进程被杀后的恢复规则：

```text
App / service 启动时扫描 track_sessions 目录
如果 diagnostic.jsonl 存在 start_recording 但没有 finish_recording:
  标记 completionState = INTERRUPTED
  不自动继续写入同一个 session
  UI 显示“上次记录异常中断”
  允许导出诊断 JSONL
  partial GPX 需要用户显式确认，且必须标记 partial=true

如果存在 decision_batch_begin 但没有 decision_batch_commit:
  replay 忽略该 batch
  sessionIntegrityState 可保持 OK，除非同时发现 checksum/id/count 损坏

如果 eventSeq 重复、倒退或同一文件混入多个 sessionId:
  replayStatus = INVALID_LOG
  sessionIntegrityState = ERROR
```

生命周期事件对时间统计的影响：

```text
recordingTime:
  只累计 RecordingState = RECORDING 的时间
  PAUSED 到 resume 之间不计入

movingTime:
  只在同一 moving segment 内两个 accepted TrackPoint 之间累计
  pause/resume 边界两侧绝不跨边界累计

elapsedTime:
  可以展示开始到结束的墙钟跨度
  但不能作为距离或运动速度分母
```

### ExportSnapshot

`ExportSnapshot` 是 `RecordingSession` 在导出前生成的只读快照，用来隔离导出器和运行时状态机。

建议模型：

```text
ExportSnapshot {
  sessionMetadata
  sessionId
  sessionIntegrityState
  sessionCompletionState
  exportKind
  partial
  exportFileName
  exportCreatedWallTimeMillis
  configSnapshot
  runtimeSnapshot
  trackSegments
  trackPoints
  decisionIndexById
  segmentIndexById
  generatedElapsedRealtimeNanos
}
```

规则：

```text
ExportSnapshot 只包含正式 TrackPoint / TrackSegment
不包含 pending candidate 池
不包含可变的 TrackRecorder 引用
decisionIndexById 只用于校验 sourceDecisionId
GpxExporter 只能消费 ExportSnapshot，不能反向查询 RecordingSession 内部状态
```

可信 GPX 只能来自：

```text
sessionIntegrityState = OK
sessionCompletionState = FINISHED
```

如果 `sessionCompletionState = INTERRUPTED`，导出器最多生成 partial GPX，文件名和 GPX extension 必须明确标记 `partial=true`，不能和正常完成的 GPX 混淆。

`exportKind` 建议取值：

```text
TRUSTED_GPX:
  partial = false
  exportFileName = track_{sessionId}_trusted.gpx
  要求 sessionIntegrityState = OK 且 sessionCompletionState = FINISHED

PARTIAL_GPX:
  partial = true
  exportFileName = track_{sessionId}_partial.gpx
  只用于 INTERRUPTED 或用户明确请求当前片段导出

DIAGNOSTIC_JSONL:
  exportFileName = diagnostic_{sessionId}.jsonl
  不要求 sessionIntegrityState = OK
  只复制完整 JSONL 行
```

`ExportSnapshot` 生成后必须冻结。导出过程中如果继续收到 Location，新点不应进入本次导出文件；下一次导出再重新生成新的快照。

## 决策结果模型

### ValidationResult

基础合法性检查不要只返回 boolean，否则会丢失 reject reason。建议模型：

```text
ValidationResult {
  valid
  rejectReason
  rejectStage
  elapsedRealtimeNanos
  nowElapsedRealtimeNanos
  locationAgeNanos
  beforeRecordStart
  providerAccepted
  accuracyAccepted
  mockRejected
}
```

规则：

```text
valid = false:
  TrackDecisionEngine 不再做运动状态判断
  直接生成 reject draft
  final decision.reason = ValidationResult.rejectReason

valid = true:
  才允许进入 FirstFixCoordinator / TrackDecisionEngine 的状态判断
```

`ValidationResult` 的边界是“这个 Location 有没有资格进入轨迹状态机”。它不负责判断：

```text
是否首点候选
是否静止漂移
是否开启新 segment
是否累计距离
是否写入 GPX
```

`LocationValidator` 只能做全局基础合法性检查：

```text
provider == gps
hasValidElapsedRealtime(location) == true
不早于 recordStartElapsedRealtimeNanos - toleranceNanos
locationAgeNanos <= maxLocationAgeNanos
latitude/longitude 有效且不是 0,0
accuracy > 0
accuracy <= 50m
不是 mock location
```

以下规则不属于 `LocationValidator`：

```text
首点 accuracy <= 20m / <= 30m / forced_weak_first_fix
普通移动点 accuracy <= 30m
静止漂移
gap recovery anchor
requiredSpeed 连续性判断
```

也就是说，`30m < accuracy <= 50m` 的点可以通过基础合法性检查，但第一阶段通常会在 `FirstFixCoordinator` / `TrackDecisionEngine` 中被拒绝为 `weak_signal_stage1`，只有显式测试开关允许时才可能成为 `forced_weak_first_fix`。

### TrackDecisionDraft

`TrackDecisionDraft` 是 `TrackDecisionEngine` 的内部输出，只表示策略判断结果，不写入诊断日志，也不被 GPX 引用。

建议字段：

```text
TrackDecisionDraft {
  result
  reason
  quality
  recordingStateBefore
  recordingStateAfter
  fixStateBefore
  fixStateAfter
  motionStateBefore
  motionStateAfter
  qualityState
  pendingDecisionId
  distanceDeltaMeters
  movingTimeDeltaSeconds
  distanceFromPreviousMeters
  requiredSpeedMetersPerSecond
  segmentAction
}
```

`TrackDecisionDraft.quality` 同样表示 `DecisionQuality`。它可以被最终 `TrackDecision.quality` 继承，但不能反向修改 `QualityState`。

`TrackDecisionDraft` 不包含：

```text
decisionId
trackPointId
sourceDecisionId
createdElapsedRealtimeNanos
```

这些字段必须在 `RecordingSession` 提交阶段统一分配，避免 `TrackDecisionEngine` 越界创建轨迹对象或持久化对象。

### TrackDecision

最终 `TrackDecision` 是轨迹系统的唯一决策事实来源。`TrackPoint`、统计和 GPX 都必须从最终 `TrackDecision` 派生。

建议字段：

```text
TrackDecision {
  decisionId
  rawPointId
  result
  reason
  quality
  recordingStateBefore
  recordingStateAfter
  fixStateBefore
  fixStateAfter
  motionStateBefore
  motionStateAfter
  qualityState
  segmentId
  trackPointId
  pendingDecisionId
  distanceDeltaMeters
  movingTimeDeltaSeconds
  distanceFromPreviousMeters
  requiredSpeedMetersPerSecond
  segmentAction
  sourceGnssSnapshotId
  gnssSnapshotStale
  createdElapsedRealtimeNanos
  eventWallTimeMillis
}
```

这里的 `quality` 是 `DecisionQuality`，不是状态轴 `QualityState`。为了兼容 GPX extension 和日志字段名，序列化时可以继续叫 `quality`，但代码里不应和 `QualityState` 共用同一个 enum。

`result` 取值：

```text
pending:
  只用于 WAITING_FIRST_FIX 候选窗口
  不生成 TrackPoint
  不进入 GPX

reject:
  不生成 TrackPoint
  可更新 DisplayPoint / 诊断状态

anchor:
  生成 TrackPoint
  进入 GPX
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

accept:
  生成 TrackPoint
  进入 GPX
  可按规则累计 distance / movingTime
```

`segmentAction` 取值建议：

```text
none:
  不创建、不切换 segment

continue_current:
  继续当前 segment

start_new:
  创建新 segment
  当前点如果进入 GPX，必须优先是 anchor
```

暂停、结束记录导致的 segment 关闭，不属于某个 `RawPoint` 的 `TrackDecision`，应由 `RecordingSession` 作为生命周期事件单独提交 segment event。

不可变规则：

```text
TrackDecision 一旦写入诊断日志，不原地修改
pending 收敛时追加新的 final decision
final decision 通过 pendingDecisionId 指回 pending decision
TrackPoint.sourceDecisionId 只能指向 final accept/anchor decision
同一个 TrackPoint 只能来自一个 final TrackDecision
同一个 final accept/anchor TrackDecision 最多创建一个 TrackPoint
reject/pending TrackDecision 的 trackPointId 必须为空
```

### DecisionCommit

`TrackDecision` 只描述“应该如何处理这个 RawPoint”，真正落库或落内存应通过 `DecisionCommit` 完成。这样可以把“策略判断”和“写日志、写轨迹”的失败边界分开。

建议模型：

```text
DecisionCommit {
  rawPoint
  validationResult
  decision
  trackPoint
  segmentEvent
  preparedRecorderMutation
  diagnosticEvents
  commitStatus
  integrityError
}
```

字段可空规则：

```text
普通 Location 回调:
  rawPoint = 当前新建 RawPoint
  validationResult = 当前 RawPoint 的基础检查结果

非 Location 事件触发 pending 收敛:
  rawPoint = 原 pending decision 对应的既有 RawPoint
  validationResult = 可复用原 RawPoint 的基础检查结果或为空
  不新建 raw_location 事件
```

`DecisionCommit` 不持有 `SessionEvent`。不产生决策的生命周期事件可以由 `RecordingSession` 独立提交；会触发 pending 收敛或分段批量变更的生命周期事件，必须由 `DecisionBatchCommit.sessionEvent` 持有，避免每个子 commit 复制同一个状态事件。

字段关系：

```text
decision.result = pending:
  trackPoint = null
  segmentEvent = null

decision.result = reject:
  trackPoint = null
  segmentEvent = null

decision.result = anchor:
  trackPoint != null
  trackPoint.sourceDecisionId = decision.decisionId
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

decision.result = accept:
  trackPoint != null
  trackPoint.sourceDecisionId = decision.decisionId
  distanceDeltaMeters / movingTimeDeltaSeconds 按规则赋值
```

`preparedRecorderMutation` 是提交前准备好的轨迹变更。`accept / anchor` 或新 segment 必须有非空 mutation；`reject / pending` 可以是 no-op mutation。`DecisionCommit` 写入诊断日志之后，只允许应用这个已准备 mutation，不能再临时重新计算轨迹点、距离或分段。

### DecisionBatchCommit

首点窗口超时、暂停前收敛、结束记录前收敛，都可能一次性产生多条 final decision。不要用多次互不关联的 `DecisionCommit` 模拟批量提交，否则 JSONL 写到一半失败时，会出现部分 pending 已收敛、部分仍 pending 的不一致状态。

建议模型：

```text
DecisionBatchCommit {
  batchId
  sessionEvent
  commits
  preparedRecorderMutation
  decisionCount
  segmentEventCount
  decisionIds
  segmentIds
  eventChecksum
  batchStatus
  integrityError
}
```

字段规则：

```text
sessionEvent:
  触发该批次的生命周期事件
  例如 first_fix_window_expired / pause_recording / finish_recording

commits:
  多个 DecisionCommit
  每个 commit 指向一个既有 pending candidate 对应的 RawPoint

preparedRecorderMutation:
  batch 内所有 TrackPoint / TrackSegment 变更的合并结果
  必须在写 decision_batch_commit 前完成校验

batchStatus:
  pending / committed / aborted

decisionCount / segmentEventCount:
  batch 内实际写入的 decision / segment 数量

decisionIds / segmentIds:
  batch 内所有 decisionId / segmentId

eventChecksum:
  对 decision_batch_begin、session_event、segment、decision 的稳定序列化内容计算
  第一阶段可用简单 SHA-256 字符串
```

checksum 的第一阶段约定：

```text
1. 按诊断日志中的事件顺序串联 batch 内事件
2. 只包含 decision_batch_begin、session_event、segment、decision
3. 不包含 decision_batch_commit 自身
4. 包含 sessionId / eventSeq / schemaVersion 等 envelope 字段
5. JSON key 使用稳定排序
6. 数值使用日志中的原始单位和原始精度，不做二次格式化
7. 字符串使用 UTF-8
8. volatile UI 字段、writtenWallTimeMillis、写入耗时、文件 offset 不参与 checksum
```

完整性规则：

```text
decision_batch_commit.decisionCount 必须等于 decision_batch_begin.candidateCount
decisionIds 必须覆盖 batch 内全部 decision.decisionId
每个 pending candidate 必须正好对应一条 final decision
eventChecksum 必须能覆盖 batch 内除 decision_batch_commit 自身以外的所有事件
batch 内所有事件必须属于同一个 sessionId
batch 内 eventSeq 必须连续递增，中间不能插入其他 batch 的事件
```

诊断日志中必须使用 `batchId` 关联批次：

```text
decision_batch_begin
session_event
segment / decision ...
decision_batch_commit
```

回放和导出只能认可已经出现 `decision_batch_commit` 且计数/ID/checksum 校验通过的 batch。只有 `decision_batch_begin` 但没有 `decision_batch_commit` 的决策行，应被视为未完成提交，不能用于生成 TrackPoint 或判断 pending 已收敛。

未 committed batch 内的 `session_event` 也不能生效。也就是说，如果 `first_fix_window_expired` 写在某个 batch 内，但该 batch 没有完整 commit，replay 时不能把会话状态推进到窗口已过期。

### 原子提交

生成 `TrackDecision`、`TrackPoint` 和诊断日志时，应通过 `RecordingSession.commitDecision(...)` 之类的同一个提交函数完成，避免三者不一致。

建议提交顺序：

```text
1. 匹配 GnssQualitySnapshot
2. 创建 RawPoint
3. 构造 raw_location 诊断事件
4. 执行 ValidationResult
5. TrackDecisionEngine 生成 TrackDecisionDraft
6. 如果 draft.result = accept / anchor:
   - 预生成 TrackPoint
   - 预分配 trackPointId
   - 不立即修改 TrackRecorder
7. 如果 draft.result = accept / anchor 且 draft.segmentAction = start_new，预生成 segment event 并分配 segmentId
8. RecordingSession 分配 decisionId，生成最终 TrackDecision
9. 如果 trackPoint != null，设置 TrackPoint.sourceDecisionId = decision.decisionId
10. 组装 DecisionCommit
11. prepare TrackRecorder mutation，并验证 apply 前置条件
12. 由 DiagnosticLogger 为 raw_location / segment / decision 分配 eventSeq 并追加写入
13. 诊断事件写入成功后，再把 prepared mutation 提交给 TrackRecorder
```

普通单点提交和批量提交遵守同一个原则：所有可能导致 `TrackRecorder.apply` 失败的对象创建、ID 分配、segment 关系校验和统计增量校验，都必须发生在诊断日志写入前。诊断日志写入成功后，`apply` 只做确定性的内存追加和状态指针切换。

非 Location 事件触发的 pending 收敛提交顺序：

```text
1. FirstFixCoordinator 输出需要收敛的 pending candidate
2. 创建 DecisionBatchCommit，并分配 batchId
3. 创建 SessionEvent，并设置 sessionEvent.batchId = batchId
4. RecordingSession 为每个 final decision 分配 decisionId
5. 如 final decision = accept / anchor，预生成 TrackPoint / segment mutation
6. prepare TrackRecorder mutation，必须在写 commit 前验证 apply 不会失败
7. 由 DiagnosticLogger 分配 eventSeq 并追加写入 decision_batch_begin
8. 追加写入 session_event，带 batchId
9. 再按每个 candidate 追加写入 segment(如有) / decision，所有事件都带 batchId
10. 计算 decisionCount / segmentEventCount / decisionIds / segmentIds / eventChecksum
11. 追加写入 decision_batch_commit
12. decision_batch_commit 写入成功后，再提交 TrackRecorder 变更
```

失败处理：

```text
如果 session_metadata / config_snapshot / runtime_snapshot / start_recording session_event 任意写入失败:
  不进入 RECORDING
  不创建可信 RecordingSession
  不启动首点候选窗口
  completionState = ABORTED
  UI 提示“开始记录失败，诊断初始化未完成”

如果 SessionFileStore 创建 session 目录或 session.json 失败:
  不打开 GNSS 记录
  不进入 RECORDING
  completionState = ABORTED
  UI 提示“无法创建记录文件”

如果 decision_batch_begin 写入失败:
  不写 batch 内 decision
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR

如果 batch 内 session_event 写入失败:
  不写 decision_batch_commit
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR

如果 batch 内任意 segment / decision 写入失败:
  不写 decision_batch_commit
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR

如果 decision_batch_commit 写入失败:
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR
  replay 必须忽略该 batch 中已写出的 decision

如果 decision_batch_commit 已写入但 TrackRecorder apply 失败:
  sessionIntegrityState = ERROR
  禁止导出可信 GPX
  UI 提示“轨迹内存状态与诊断日志不一致”

如果普通 DecisionCommit 的 prepare 失败:
  不写 final decision
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR

如果普通 DecisionCommit 的 raw_location / segment / decision 已写入但 TrackRecorder apply 失败:
  sessionIntegrityState = ERROR
  禁止导出可信 GPX
  replay 可以把诊断日志作为 expected，但当前内存 TrackRecorder 不可信

如果 raw_location 日志写入失败:
  停止本次 DecisionCommit
  不提交 accept/anchor TrackPoint
  sessionIntegrityState = ERROR

如果 diagnostic.jsonl 出现半行、JSON 损坏或 eventSeq 不连续:
  当前进程内立即标记 sessionIntegrityState = ERROR
  replayStatus = INVALID_LOG
  禁止导出可信 GPX

如果 TrackPoint 创建失败:
  不生成最终 accept/anchor TrackDecision
  不写 decision 诊断事件
  sessionIntegrityState = ERROR

如果 segment 日志写入失败:
  停止本次 DecisionCommit
  不提交对应新 segment 和 TrackPoint
  sessionIntegrityState = ERROR

如果 decision 日志写入失败:
  停止本次 DecisionCommit
  不提交 TrackPoint 到 TrackRecorder
  sessionIntegrityState = ERROR
  UI 提示“诊断日志写入失败，当前记录不应作为可信 GPX”

如果 GPX 导出时找不到 sourceDecisionId:
  该 TrackPoint 应被视为数据损坏，导出失败并提示诊断日志不一致
```

原则上 `TrackRecorder` 的 single apply 和 batch apply 都不应失败。实现时应在写入最终诊断事件前完成所有对象创建、ID 分配、segment 关系校验和统计增量校验；commit 后的 apply 只做内存列表追加和状态指针切换。如果这个阶段仍失败，应按程序错误处理并将 session 标为 `ERROR`。

注意：`DiagnosticLogger` 不参与“是否接受点”的决策计算；但 `RecordingSession` 可以因为日志提交失败而拒绝把已经算出的 accept/anchor decision 应用到正式轨迹。前者是策略边界，后者是数据完整性边界。

### 回放能力

第一阶段建议支持最小离线回放：

```text
输入:
  session_metadata
  config_snapshot
  runtime_snapshot
  session_event
  raw_location
  gnss_snapshot
  decision_batch_begin / decision_batch_commit
  expected decision / segment

输出:
  actual decision
  actual TrackPoint
  actual TrackSegment
  distance / movingTime
  replay diff
  ReplayReport
```

回放不要求还原 Android 回调线程，只要求在相同输入顺序和相同配置下得到相同 decision。这样户外真机问题可以用日志复现，而不是只能靠重新徒步。

回放必须按诊断日志中的 `elapsedRealtimeNanos` 和事件顺序推进，不直接读取当前设备的 `SystemClock`。如果缺少非关键诊断字段，回放结果只能标记为 `BEST_EFFORT`；如果缺少 `config_snapshot`、`start_recording` 这类关键输入，应标记为 `INVALID_LOG`。

回放不是只“重新算一遍”。诊断日志中原始记录的 `decision` / `segment` 是 `expected`，ReplayRunner 重跑得到的是 `actual`。验收时应比较：

```text
expectedDecision.result == actualDecision.result
expectedDecision.reason == actualDecision.reason
expectedDecision.segmentAction == actualDecision.segmentAction
expectedDecision.distanceDeltaMeters 与 actual 误差在浮点容忍范围内
expectedDecision.movingTimeDeltaSeconds 与 actual 一致
expectedBatch.decisionCount == actualBatch.decisionCount
expectedBatch.segmentEventCount == actualBatch.segmentEventCount
expectedBatch.decisionIds 覆盖同一组 pending candidate
expectedBatch.eventChecksum 校验通过
不存在未 committed batch 被应用
```

如果 `schemaVersion` 或 `strategyVersion` 不一致，replay diff 只能用于参考，不能直接判定当前策略回归。

ReplayRunner 应输出结构化报告，而不是只打印日志：

```text
ReplayReport {
  replayStatus
  sessionId
  schemaVersionMatched
  strategyVersionMatched
  eventSeqContinuous
  incompleteBatchCount
  ignoredBatchIds
  checksumMismatchBatchIds
  missingExpectedDecisionIds
  unexpectedActualDecisionIds
  missingExpectedSegmentIds
  unexpectedActualSegmentIds
}
```

`replayStatus` 建议：

```text
EXACT:
  session_metadata、config_snapshot、runtime_snapshot、关键 session_event、expected decision/segment 都完整
  sessionId 单一且 eventSeq 连续
  schemaVersion 和 strategyVersion 一致
  没有 checksum mismatch

BEST_EFFORT:
  缺少 runtime_snapshot 或其他非关键诊断信息，或版本不一致
  可用于排查，不可用于证明策略回归

INVALID_LOG:
  缺少 session_metadata、config_snapshot、关键 session_event
  或 sessionId 混杂
  或 eventSeq 重复、倒退、缺失
  或存在 committed batch checksum/count/id 校验失败
```

不完整 batch 的处理必须显式报告：

```text
只有 decision_batch_begin，没有 decision_batch_commit:
  ignoredBatchIds += batchId
  incompleteBatchCount += 1
  batch 内 session_event / decision / segment 不参与 actual 状态推进

有 decision_batch_commit 但 checksum/count/id 不通过:
  replayStatus = INVALID_LOG
  checksumMismatchBatchIds += batchId
  batch 内事件不参与可信导出
```

### 回放测试矩阵

第一阶段必须准备一组小型 JSONL fixtures，用 `ReplayRunner` 离线验证策略，不要只依赖真机走路测试。每个 fixture 都应包含 `session_metadata / config_snapshot / runtime_snapshot / session_event(start_recording)`，并包含 expected decision。

建议最小用例：

```text
first_fix_good:
  首点窗口内出现 accuracy <= 20m
  期望 final accept，reason = first_fix_good

first_fix_relaxed:
  首点窗口内最佳点 20m < accuracy <= 30m
  期望 final accept，quality = RELAXED

first_fix_reject_all:
  首点窗口内所有候选 accuracy > 30m，且未开启 forced weak
  期望所有 pending candidate 收敛为 reject

forced_weak_first_fix:
  开启 forcedWeakFirstFixEnabled
  30m < accuracy <= 50m 的首点可进入 TrackPoint
  期望 quality = WEAK 且 reason = forced_weak_first_fix

cached_location_before_start:
  Location.elapsedRealtimeNanos 明显早于 recordStartElapsedRealtimeNanos
  期望 reject = before_record_start

ordinary_weak_signal:
  RECORDING 中 accuracy 在 30m~50m
  期望第一阶段 reject = weak_signal_stage1

stationary_drift:
  静止 2 分钟，小范围漂移
  期望距离不明显增长，不生成密集 TrackPoint

moving_good_track:
  连续合理移动点
  期望 accept，distance/movingTime 单调增加

impossible_jump:
  两点间 requiredSpeed 超过不可能阈值
  期望 reject 或进入 gap/jump recovery，不直接累计距离

long_gap_recovery:
  超过 longGapMillis 后恢复良好点
  期望新 TrackSegment，第一个点为 anchor，distanceDelta = 0

pause_before_first_fix:
  WAITING_FIRST_FIX 中 pause
  期望所有 pending candidate reject，不生成 TrackPoint

pause_then_location:
  pause command 的 eventSeq 早于 location_changed
  期望后续 Location 不生成 accept/anchor

finish_then_timer:
  finish_recording 早于 first_fix_window_timer
  期望 timer no-op，不生成 TrackPoint

incomplete_batch:
  有 decision_batch_begin，无 decision_batch_commit
  期望 ignoredBatchIds 包含该 batch，batch 内事件不推进 replay 状态

checksum_mismatch:
  committed batch 的 count/id/checksum 不匹配
  期望 replayStatus = INVALID_LOG

mixed_session_id:
  一个 JSONL 混入多个 sessionId
  期望 replayStatus = INVALID_LOG

broken_last_line:
  diagnostic.jsonl 最后一行半截
  期望忽略半行或标记 interrupted；不得把半行当有效事件

missing_runtime_snapshot:
  缺少 runtime_snapshot
  期望 replayStatus = BEST_EFFORT
```

每个 replay fixture 的验收输出至少包含：

```text
replayStatus
actual decision 列表
actual TrackPoint 列表
actual TrackSegment 列表
distance / movingTime
ReplayReport diff
```

测试命名建议：

```text
test_artifacts/replay_fixtures/{caseName}/diagnostic.jsonl
test_artifacts/replay_fixtures/{caseName}/expected_report.json
```

只要策略阈值或 `strategyVersion` 变化，就必须重新跑全部 replay fixtures。

## 定位质量判断

### 硬拒绝

以下点不能进入正式轨迹：

```text
provider 不是 gps
经纬度为 0,0
accuracy <= 0
全局 accuracy > 50m
时间倒退
点时间太旧
点早于记录开始
缺少有效 elapsedRealtimeNanos
mock location
瞬时速度明显不可能
```

首点 `accuracy > 30m` 不进入正式轨迹是状态策略，不是 `LocationValidator` 的全局基础合法性。`30m < accuracy <= 50m` 的首点默认只进入诊断；只有测试开关开启或用户确认时，才允许以 `forced_weak_first_fix` 明确标记进入 `TrackPoint`。

徒步速度阈值建议：

```text
requiredSpeed > 8 m/s: 可疑
requiredSpeed > 12 m/s: 拒绝
```

`requiredSpeed` 根据相邻点距离和时间差计算：

```text
requiredSpeed = distanceMeters / deltaSeconds
```

如果 `deltaElapsedSeconds <= 0`：

```text
直接拒绝
rejectReason = non_positive_delta_time
```

### 弱定位

以下点不应立即进入正式轨迹：

```text
30m < accuracy <= 50m
usedInFix 太少
CN0 偏低
短时间孤立跳动
和上一正式点距离处于精度半径内
```

`20m < accuracy <= 30m` 不再统一归为弱定位。它是否可进入正式轨迹取决于状态机和场景：

```text
WAITING_FIRST_FIX:
  可作为 first_fix_relaxed 进入 GPX

TRACKING_MOVING:
  可作为普通移动正式点的候选，但仍需通过连续性、速度、距离和状态边界判断

GAP_RECOVERY / PAUSED / stationary 边界后:
  只能在通过正式点质量检查后作为 anchor-only TrackPoint
```

阶段边界：

```text
第一阶段:
  弱定位只记录为 RawPoint / 诊断状态
  不进入 TrackPoint
  不做候选回填

第二阶段:
  弱定位可以进入候选缓冲
  后续趋势证明合理后，才允许回填为 TrackPoint
```

阈值建议：

```text
首点优先: accuracy <= 20m
首点放宽: accuracy <= 30m
移动正式点: accuracy <= 30m 优先
移动弱候选: 30m < accuracy <= 50m
硬拒绝: accuracy > 50m
```

建议 GNSS 质量参考：

```text
usedInFixTotal >= 4: 基本可解算
usedInFixTotal >= 6: 较好
usedAvgCn0 >= 25: 可用
usedAvgCn0 >= 30: 较好
```

这些不是硬规则，应和 `Location.accuracy`、运动连续性一起判断。

注意：`usedInFix`、`CN0`、星座数量只作为质量解释和辅助评分，不应作为第一阶段的硬拒绝条件。

原因：

- 不同厂商对 `usedInFix` 的上报完整性不一致
- `GnssStatus` 与 `Location` 可能存在时间错位
- 系统已经输出 `Location` 时，`Location.accuracy` 和连续性更直接反映定位结果质量

第一阶段必须避免把 GNSS 质量指标变成隐形硬拒绝：

```text
如果 accuracy <= 30m
且时间/provider/mock/速度/连续性都合理
不能仅因为 usedInFix 偏少、CN0 偏低、星座数量少而 reject
```

如果 GNSS 快照是 `stale` 或 `matchedFromFuture = true`，该快照只能用于界面解释和诊断日志，不能参与 `weak_signal_stage1` 判定。

推荐优先级：

```text
硬过滤:
  provider / time / accuracy / mock / requiredSpeed

辅助评分:
  usedInFix / CN0 / 星座数量 / 卫星高度角
```

## 状态机

### WAITING_FIRST_FIX

刚开始记录时进入该状态。

策略：

- 不立即接受第一个点
- 等待 `5~15s` 内精度最好的点
- 优先接受 `accuracy <= 20m` 的点
- 超时后可放宽到 `20m < accuracy <= 30m`，标记为 relaxed 起点
- 拒绝早于记录开始的缓存点

首点接受语义必须明确：

```text
accuracy <= 20m:
  decisionResult = accept
  decisionReason = first_fix_good
  quality = GOOD

20m < accuracy <= 30m:
  decisionResult = accept
  decisionReason = first_fix_relaxed
  quality = RELAXED
  允许进入 GPX，但必须明确标记 relaxed

accuracy > 30m:
  默认只作为 DisplayPoint 和诊断状态，不进入 GPX
  reject reason = first_fix_accuracy_too_large

30m < accuracy <= 50m 且测试开关开启或用户确认:
  可将弱起点写入 TrackPoint
  decisionResult = accept
  decisionReason = forced_weak_first_fix
  acceptReason = forced_weak_first_fix
  quality = WEAK

accuracy > 50m:
  永远不进入 TrackPoint
  reject reason = accuracy_too_large
```

这样既允许 `20~30m` 的 relaxed 首点被明确记录，又避免把更弱的起点伪装成可靠 GPX。

首点候选池应记录多个点，并在等待窗口结束时选择最优点。

候选排序建议：

```text
1. accuracy 更小
2. 时间更接近记录开始之后
3. GNSS 质量快照更新鲜
4. usedInFix/CN0 更好
```

排序中的 GNSS 质量只能作为 tie-breaker，且只有在快照满足以下条件时才能使用：

```text
stale = false
matchedFromFuture = false
```

如果快照过期或来自 future match，只能记录为诊断解释，不能提升候选排序，也不能让原本不合格的首点进入 `TrackPoint`。

首点候选的 decision 生命周期：

```text
进入候选池时:
  记录 pending decision
  result = pending
  reason = pending_first_fix_candidate

等待窗口内选中为正式首点:
  追加 final accept decision
  reason = first_fix_good / first_fix_relaxed / forced_weak_first_fix
  pendingDecisionId = 原 pending decisionId

等待窗口结束后未选中:
  追加 final reject decision
  reason = first_fix_candidate_not_selected
  pendingDecisionId = 原 pending decisionId
```

每个进入首点候选池的 `RawPoint`，最终都必须落到 `accept` 或 `reject`，不能长期停留在 `pending`。

诊断日志使用 JSON Lines 时不能依赖“原地更新”旧行。第一阶段固定只使用 `pendingDecisionId` 关联原 pending 记录，不再引入 `supersedesDecisionId`，避免日志解析出现两套路径。

首点候选收敛不能依赖“下一次 Location 到来”。`RecordingEventDispatcher` 必须投递 `first_fix_window_timer`，`RecordingSession` 必须支持非 Location 触发的提交：

```text
onFirstFixWindowExpired:
  通过 DecisionBatchCommit 写 session_event(eventType = first_fix_window_expired)
  要求 FirstFixCoordinator 选择当前窗口最佳候选
  如果 RecordingState = RECORDING 且有可接受候选，追加 final accept decision
  其他 pending candidate 追加 final reject decision
  如果 RecordingState = PAUSED，所有 pending candidate 追加 final reject decision
  如果没有可接受候选，所有 pending candidate 追加 final reject decision
  清空候选池或开启下一轮窗口

onFinishRecording:
  通过 DecisionBatchCommit 写 session_event(eventType = finish_recording)
  如果仍处于 WAITING_FIRST_FIX，所有 pending candidate 追加 final reject decision
  reason = recording_finished_before_first_fix

onPauseRecording:
  通过 DecisionBatchCommit 写 session_event(eventType = pause_recording)
  如果仍处于 WAITING_FIRST_FIX，立即收敛当前候选池
  所有 pending candidate 追加 final reject decision
  reason = pause_before_first_fix
  不生成 accept / anchor TrackPoint
  恢复时重新开启首点候选窗口
```

这些 final decision 没有新的 `RawPoint` 回调，但必须通过同一个 `RecordingSession` 提交流程写入诊断日志，保证记录结束后不存在未收敛的 `pending_first_fix_candidate`。

如果窗口超时后选中旧候选生成 `TrackPoint`：

```text
TrackPoint.timeMillis = 原 RawPoint.timeMillis
TrackPoint.elapsedRealtimeNanos = 原 RawPoint.elapsedRealtimeNanos
TrackDecision.createdElapsedRealtimeNanos = final decision 创建时间
SessionEvent.elapsedRealtimeNanos = 窗口超时或生命周期事件时间
```

不要用 `session_event` 的时间改写 `TrackPoint` 时间，否则 GPX 时间线和轨迹连续性会被窗口延迟污染。

如果等待窗口结束时没有任何可接受首点：

```text
1. 将当前候选池中所有 pending candidate 追加 final reject decision
   reason = first_fix_candidate_not_selected
2. 清空首点候选池
3. 保持状态为 WAITING_FIRST_FIX
4. 开启下一轮 5~15s 候选窗口
5. UI 继续显示“等待首个可信 GNSS 点”，同时展示最近拒绝原因和当前最佳候选精度
```

不能因为首轮没有合格点就进入 `TRACKING_MOVING`，也不能生成空 GPX 起点。

### TRACKING_STATIONARY

用户静止或低速移动。

判断依据：

```text
speed < 0.3~0.5 m/s
连续点距离小于精度半径
位置围绕锚点抖动
```

策略：

- 不累计距离
- 不频繁写正式点
- 只更新当前定位展示
- 可每隔较长时间记录 keepalive 诊断点，但默认不进入 GPX

如果未来需要在地图上显示静止期间的定位变化，应区分三类点：

```text
RawPoint: 原始诊断点
DisplayPoint: 当前定位展示点
TrackPoint: 正式轨迹与 GPX 点
```

静止 keepalive 只能是 `RawPoint` 或 `DisplayPoint`，不能作为 `TrackPoint` 参与导出和距离统计。

### TRACKING_MOVING

用户稳定移动。

判断依据：

```text
连续 2~3 个点呈现合理移动趋势
点间距离 > max(3~5m, accuracy 修正阈值)
速度在徒步合理范围内
```

第一阶段最小可执行判定：

```text
distanceFromMovingAnchor > max(5m, currentAccuracy * 0.8)
requiredSpeed > 0.3m/s
requiredSpeed <= 8m/s
currentAccuracy <= 30m
```

满足后进入 `TRACKING_MOVING`。

移动转入点的处理必须区分两种角色：

```text
movingAnchor:
  用于后续判断是否真的开始移动
  不一定写入 GPX
  不一定累计 distance/movingTime

accepted TrackPoint:
  写入正式轨迹
  可参与 GPX、距离和 movingTime
```

从 `TRACKING_STATIONARY`、`GAP_RECOVERY`、`PAUSED` 进入移动时，第一个满足条件的点默认作为新的 `movingAnchor`。

边界后的第一个点可以在满足正式点质量要求时写入 `TrackPoint`，但必须按 anchor-only 处理：

```text
distanceDelta = 0
movingTimeDelta = 0
quality = ANCHOR_ONLY
decision.result = anchor
decision.reason = anchor_only_no_delta
```

从该 anchor 之后的第二个同段 accepted point 开始，才允许累计距离和 `movingTime`。

第一阶段中，`decision.result = anchor` 的含义必须固定：

```text
anchor:
  一定生成 TrackPoint
  一定进入 GPX
  distanceDelta = 0
  movingTimeDelta = 0

只更新内部 movingAnchor、不进入 GPX 的点:
  不使用 decision.result = anchor
  使用 reject decision
  reason = state_anchor_only
```

这样可以避免同一个 `anchor` 在日志里有时代表 GPX 点、有时只是内存状态。

策略：

- 接受高质量点
- 累计正式轨迹距离
- 用最近正式点计算稳定 bearing

### WEAK_SIGNAL

GNSS 信号变差。

第一阶段策略：

- 原始点继续记录
- 弱点只作为 RawPoint / 诊断状态
- 不立即累计距离
- 不进入 TrackPoint
- 不做候选回填

第二阶段策略：

- 弱点进入候选缓冲
- 后续如果趋势一致，可回填部分候选点
- 后续如果证明是漂移，则丢弃候选点

### GAP_RECOVERY

长时间没有可用 GNSS 点后恢复。

触发条件示例：

```text
超过 30~60s 没有正式轨迹点
或 GPS_PROVIDER 长时间无 Location 回调
```

策略：

- 短暂回调延迟如果不进入 `GAP_RECOVERY`，可以继续同一 TrackSegment，但必须按普通移动点规则累计距离和 movingTime
- 一旦进入 `GAP_RECOVERY`，第一阶段默认开启新 TrackSegment
- 新 TrackSegment 的第一个通过正式点质量检查的可用点作为 anchor-only TrackPoint，不累计 gap 期间距离和 movingTime
- 如果距离很远且无法证明真实移动，必须开启新 TrackSegment
- 不把断点简单连成一条直线

这里的“可用点”不是弱定位兜底，必须满足：

```text
provider == gps
hasValidElapsedRealtime(location) == true
不早于记录开始
不是 mock location
accuracy > 0
accuracy <= 30m
如果新 segment 内已有 anchor:
  requiredSpeed 基于新 segment 内 anchor 计算，且不能超过不可能阈值

如果这是新 segment 第一个 anchor-only TrackPoint:
  不使用上一旧 segment 末点计算 requiredSpeed
  旧 segment 末点只能作为诊断参考
```

如果恢复后的第一个点只满足 `30m < accuracy <= 50m`，它只能作为 `RawPoint` / `DisplayPoint` / 诊断状态，不能作为新 segment 的 anchor-only TrackPoint。

gap 建议分级：

```text
short_gap:
  5~30s 没有正式轨迹点
  如果已经进入 GAP_RECOVERY，第一阶段默认新建 TrackSegment
  只有未进入 GAP_RECOVERY 的短暂回调延迟，才允许继续同一 TrackSegment

long_gap:
  超过 30~60s 没有正式轨迹点
  默认新建 TrackSegment
  不跨 gap 连线
```

GPX 语义优先于界面连续性：只要会让常见 GPX 工具把断点画成一条误导性的直线，就应该新建 `<trkseg>`。

### PAUSED

用户暂停记录。

策略：

- 停止正式轨迹写入
- 恢复后开启新 segment

## 距离与速度统计

距离只能基于正式轨迹点计算。

不要基于原始点累计距离。

静止状态下：

```text
不累计距离
不更新平均速度
```

移动状态下：

```text
segmentDistance = distance(previousAcceptedPoint, currentAcceptedPoint)
```

但仍需检查：

```text
segmentDistance 是否超过精度合理范围
requiredSpeed 是否合理
是否处于 gap recovery
```

距离累计必须和 `movingTime` 使用同一组 accepted TrackPoint。

以下情况中，当前 accepted 点只能作为新的 segment/moving anchor，不能与上一个 accepted 点累计距离：

```text
跨 TrackSegment
pause 后恢复的第一个点
gap recovery 后的第一个点
stationary -> moving 后的第一个锚点
previous/current 之间发生状态切换
```

平均速度建议基于：

```text
正式轨迹距离 / 运动时间
```

而不是总记录时间。

需要同时定义三类时间：

```text
elapsedTime:
  从开始到结束的总时长，包含暂停和静止。展示可使用 wall time，计算必须使用 elapsedRealtime。

recordingTime:
  用户未暂停、系统处于记录状态的时长，包含静止

movingTime:
  状态机处于 TRACKING_MOVING 且接受正式轨迹点的时长
```

`movingTime` 的累计方式：

```text
当 currentAcceptedPoint 被接受并累计距离时:
  movingTime += current.elapsedRealtime - previousAccepted.elapsedRealtime

当 currentRawPoint 被拒绝、只是 DisplayPoint、或处于 gap/weak/stationary:
  当前回调不立即累计 movingTime
```

只有 `previousAcceptedPoint` 和 `currentAcceptedPoint` 属于同一个 moving segment，且两点之间没有发生 pause、gap、stationary 状态切换时，才能累计这段 `deltaElapsed`。

低频 accepted point 的口径：

```text
如果两端都是 accepted TrackPoint
且中间没有进入 pause/gap/stationary/weak_signal 状态
即使中间存在被拒绝的普通 RawPoint
也可以累计两端之间的 distance 和 movingTime
```

被拒绝的 RawPoint 本身不参与距离计算，但它不一定打断移动段。只有当状态机明确进入 `WEAK_SIGNAL`、`GAP_RECOVERY`、`TRACKING_STATIONARY` 或 `PAUSED` 时，才打断 moving segment。

因此实现时应按两步理解：

```text
reject 回调当下:
  不累计 distance
  不累计 movingTime

下一次 accepted TrackPoint 到来时:
  如果期间状态仍保持 TRACKING_MOVING
  且没有 pause/gap/stationary/weak_signal 边界
  可以从 previousAcceptedPoint 累计到 currentAcceptedPoint
```

如果中间发生状态切换：

```text
不累计 previous -> current 的 movingTime
将 currentAcceptedPoint 作为新的 moving anchor
```

这样可以保证运动时间和正式距离使用同一组 accepted TrackPoint，避免分子分母口径不一致。

无 fix 或 `GAP_RECOVERY` 期间，如果用户未暂停：

```text
计入 recordingTime
不计入 movingTime
不累计距离
```

统计建议：

```text
总耗时 = elapsedTime
记录时长 = recordingTime
运动时长 = movingTime
运动平均速度 = 总距离 / movingTime
整体平均速度 = 总距离 / recordingTime
```

如果 `movingTime` 太小，应避免显示异常大的运动平均速度。

界面和日志中不要只写“平均速度”，应明确区分：

```text
movingAverageSpeed
overallAverageSpeed
```

## 第一阶段决策流程

第一阶段建议按固定顺序处理每个 `Location`：

```text
1. 收到 Location
2. 从 GnssSnapshotStore 匹配最近的 GnssQualitySnapshot
3. 生成 RawPoint
4. 构造 raw_location 诊断事件
5. 执行基础合法性检查，生成 ValidationResult
6. 根据当前状态轴和轨迹上下文生成 TrackDecisionDraft
   - WAITING_FIRST_FIX 候选期可写 pending
   - 其他最终结果只能是 accept / anchor / reject
7. 根据 draft 预生成轨迹 mutation
   - draft.result = accept / anchor 时预生成 TrackPoint
   - 需要分段时预生成 segment event
8. 生成最终 TrackDecision 并组装 DecisionCommit
9. prepare TrackRecorder mutation，并验证 apply 前置条件
10. 追加写入 raw_location / segment / decision 诊断事件
11. 诊断事件写入成功后应用 prepared mutation
12. 如果 result = accept:
   - 更新 TrackSegment
   - 更新 distance/movingTime
   - 更新 lastStableBearing
13. 如果 result = anchor:
   - 更新 TrackSegment
   - distanceDelta = 0
   - movingTimeDelta = 0
   - 不跨边界连线
14. 如果 result = reject:
   - 只更新 DisplayPoint / 诊断状态
```

基础合法性检查失败时，不进入状态机运动判断，直接拒绝。

状态机判断失败时，不代表这个点“没用”，它仍然可以用于：

```text
当前定位展示
弱信号提示
首点候选池
下一次移动趋势判断的参考
诊断日志分析
```

### 决策原因枚举

建议第一阶段先固定 reason 字符串，避免 UI、日志、GPX extension 各自发明名字。

最终 decision result 固定为三类：

```text
accept:
  进入正式 TrackPoint，并允许按规则参与距离/时间统计

anchor:
  进入正式 TrackPoint 和 GPX，但 distanceDelta/movingTimeDelta 必须为 0

reject:
  不进入正式 TrackPoint，只保留 RawPoint / DisplayPoint / 诊断
```

`WAITING_FIRST_FIX` 期间允许临时记录：

```text
pending:
  只用于首点候选等待窗口内
  不进入 TrackPoint
  不进入 GPX
  等待窗口结束后必须转为 accept 或 reject
```

拒绝原因：

```text
provider_not_gps
zero_coordinate
invalid_accuracy
accuracy_too_large
first_fix_accuracy_too_large
missing_elapsed_realtime
location_too_old
before_record_start
time_regression
non_positive_delta_time
mock_location
impossible_speed
stationary_jitter
weak_signal_stage1
state_anchor_only
first_fix_candidate_not_selected
recording_finished_before_first_fix
pause_before_first_fix
pause_state
waiting_first_fix
```

接受原因：

```text
first_fix_good
first_fix_relaxed
forced_weak_first_fix
moving_good_fix
moving_continuity_good
manual_accept_for_test
```

新 TrackSegment 的第一个 GPX 点如果不累计距离和 movingTime，应使用 `decisionResult = anchor` 以及 `new_segment_anchor` / `gap_recovery_anchor` 等 anchor 原因，不使用 accept reason。

anchor 原因：

```text
anchor_only_no_delta
gap_recovery_anchor
pause_resume_anchor
stationary_to_moving_anchor
new_segment_anchor
```

质量标签建议：

```text
GOOD
RELAXED
WEAK
REJECTED
STALE_GNSS_QUALITY
ANCHOR_ONLY
```

`ANCHOR_ONLY` 只用于已经进入 `TrackPoint` / GPX 的 anchor 点，表示该点不贡献距离和 `movingTime`。

第一阶段中必须区分：

```text
decisionResult = anchor + quality = ANCHOR_ONLY:
  一定进入 TrackPoint
  一定进入 GPX
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0

只更新内部 movingAnchor、不进入 GPX:
  不使用 quality = ANCHOR_ONLY
  不使用 decisionResult = anchor
  使用 reject decision
  reason = state_anchor_only
```

## Bearing 策略

不要直接依赖单个 `Location.bearing` 作为轨迹方向。

移动时优先使用最近正式轨迹点计算：

```text
bearing = bearingBetween(previousAcceptedPoint, currentAcceptedPoint)
```

如果点距太短或处于静止状态：

```text
保持 lastStableBearing
```

`Location.bearing` 可作为辅助字段保存到 GPX extension。

## 海拔策略

GNSS 海拔容易抖动，爬升统计不能直接累加每个点的高度差。

建议：

- GPX 可以导出 TrackPoint 保留的 `Location.altitude` 原值
- 统计爬升时做平滑
- 小于 `3~5m` 的高度变化不累计
- 连续趋势确认后再累计上升/下降
- 如果设备有气压计，后续可加入气压海拔

## GPX 导出策略

### 导出前置条件

可信 GPX 导出必须先由 `RecordingSession` 通过完整性检查，再把只读 `ExportSnapshot` 交给 `GpxExporter`：

```text
sessionIntegrityState = OK
sessionCompletionState = FINISHED
所有 TrackPoint.sourceDecisionId 可回查到 final accept/anchor decision
所有 TrackPoint.segmentId 可回查到 TrackSegment
不存在未收敛的 pending_first_fix_candidate
不存在未通过校验的 committed batch
```

如果 `sessionIntegrityState = ERROR`，UI 应禁用“导出 GPX”或导出时明确失败；但仍应允许导出诊断 JSONL，因为诊断日志正是定位问题的证据。

如果 `sessionCompletionState = INTERRUPTED`，UI 不应把它显示成正常完成的轨迹。可提供“导出 partial GPX”入口，但文件名、GPX extension 和分享文案都必须明确说明记录异常中断。

导出线程边界：

```text
RecordingEventDispatcher:
  校验 sessionIntegrityState / sessionCompletionState
  冻结 ExportSnapshot

GpxExporter:
  在 IO 线程消费 ExportSnapshot
  不读取实时 TrackRecorder
  不阻塞 Location / GnssStatus 输入队列
```

### 基础结构

```xml
<gpx version="1.1" creator="System GNSS Track Demo"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xmlns:hike="https://codex.local/system-gnss-demo"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <trk>
    <name>Track</name>
    <trkseg>
      <trkpt lat="..." lon="...">
        <ele>...</ele>
        <time>...</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
```

### 多段轨迹

每个 `TrackSegment` 导出为一个 `<trkseg>`：

```xml
<trkseg>
  ...
</trkseg>
<trkseg>
  ...
</trkseg>
```

### 扩展字段

建议在 `<extensions>` 中写入关键追溯字段和基础质量字段：

```xml
<extensions>
  <hike:accuracy>8.5</hike:accuracy>
  <hike:speed>1.2</hike:speed>
  <hike:bearing>35.0</hike:bearing>
  <hike:provider>gps</hike:provider>
  <hike:sessionId>S1</hike:sessionId>
  <hike:partial>false</hike:partial>
  <hike:trackPointId>19</hike:trackPointId>
  <hike:segmentId>2</hike:segmentId>
  <hike:sourceRawPointId>44</hike:sourceRawPointId>
  <hike:sourceDecisionId>1004</hike:sourceDecisionId>
  <hike:elapsedRealtimeNanos>123456789000</hike:elapsedRealtimeNanos>
  <hike:quality>GOOD</hike:quality>
  <hike:decisionResult>accept</hike:decisionResult>
  <hike:decisionReason>moving_good_fix</hike:decisionReason>
  <hike:acceptReason>moving_good_fix</hike:acceptReason>
  <hike:distanceDeltaMeters>6.4</hike:distanceDeltaMeters>
  <hike:movingTimeDeltaSeconds>4.0</hike:movingTimeDeltaSeconds>
  <hike:usedInFixTotal>8</hike:usedInFixTotal>
  <hike:beidouUsed>3</hike:beidouUsed>
  <hike:gpsUsed>4</hike:gpsUsed>
  <hike:usedAvgCn0>31.2</hike:usedAvgCn0>
  <hike:gnssQualityStale>false</hike:gnssQualityStale>
</extensions>
```

字段口径：

```text
decisionReason:
  GPX 中的权威原因字段

acceptReason:
  仅用于兼容第一阶段已有 UI / 旧导出字段
  decisionResult = accept 时，必须等于 decisionReason
  decisionResult = anchor 时，应为空或不写
```

完整 GNSS 快照不建议全部写入每个 GPX 点，避免文件过大。完整卫星状态、原始测量、决策过程应写入诊断日志，再通过 `sourceRawPointId` 与 GPX 点关联。

## UI 建议

当前测试 App 可以分为三块：

### 1. 当前 GNSS 状态

显示：

- 精确位置权限是否已授予
- GPS Provider 是否开启
- 前台服务是否运行
- 是否处于省电模式
- 是否有 fix
- provider
- accuracy
- speed
- bearing
- usedInFixTotal
- 各星座 visible / used
- CN0 摘要

### 2. 轨迹记录状态

显示：

- 当前状态机状态
- 原始点数量
- 正式点数量
- anchor-only 点数量 `anchorPointCount`
- 弱定位原始点数量 `weakRawPointCount`
- 候选点数量 `candidatePointCount`（第二阶段）
- segment 数量
- 总距离
- 总耗时
- 记录时长
- 运动时长
- WAITING_FIRST_FIX 等待时长
- 当前最佳首点候选精度
- 首点候选 pending 数量 `pendingFirstFixCandidateCount`
- 最近拒绝原因
- 最近接受原因
- 最近 anchor 原因
- 拒绝原因计数 `rejectReasonCounts`
- 接受原因计数 `acceptReasonCounts`
- anchor 原因计数 `anchorReasonCounts`
- sessionId
- sessionCompletionState
- sessionIntegrityState
- diagnosticLogWritable
- storageFreeBytes
- 最近完整性错误 `lastIntegrityError`

### 3. 操作

按钮：

- 开始记录
- 暂停
- 继续
- 结束
- 导出 GPX
- 导出诊断日志

### 4. UI 快照模型

UI 不应直接读取 `TrackRecorder`、`FirstFixCoordinator` 或 `DiagnosticLogger` 的内部对象。`RecordingSession` 每次处理输入后返回一个只读 `RecordingUiSnapshot`，界面只渲染这个快照。

建议字段：

```text
RecordingUiSnapshot {
  sessionId
  displayMode
  recordingState
  fixState
  motionState
  qualityState
  sessionCompletionState
  sessionIntegrityState
  currentProvider
  gpsProviderEnabled
  preciseLocationGranted
  foregroundServiceActive
  powerSaveMode
  hasFix
  latestDisplayPoint
  latestAcceptedTrackPoint
  latestRawPoint
  latestGnssQualitySnapshot
  rawPointCount
  acceptedTrackPointCount
  anchorPointCount
  rejectedRawPointCount
  weakRawPointCount
  pendingFirstFixCandidateCount
  segmentCount
  totalDistanceMeters
  recordingTimeSeconds
  movingTimeSeconds
  waitingFirstFixSeconds
  currentBestFirstFixAccuracyMeters
  lastStableBearingDegrees
  lastDecisionResult
  lastDecisionReason
  lastRejectReason
  rejectReasonCounts
  acceptReasonCounts
  anchorReasonCounts
  diagnosticLogWritable
  storageFreeBytes
  lastErrorCode
  lastUserMessage
  canStart
  canPause
  canResume
  canFinish
  canExportTrustedGpx
  canExportPartialGpx
  canExportDiagnosticLog
}
```

`displayMode` 建议取值：

```text
LAB_FOREGROUND_ONLY:
  第一阶段实验室模式
  UI 明确提示不保证熄屏和后台长期记录

HIKING_FOREGROUND_SERVICE:
  M5 真实徒步模式
  由 location 前台服务承载
```

`latestDisplayPoint` 可以来自最近 RawPoint，即使该点被拒绝；它只用于“当前我大概在哪里”的界面展示，不能进入 GPX，也不能参与距离统计。`latestAcceptedTrackPoint` 才是正式轨迹点。

### 5. 命令可用性

按钮是否可点应由 `RecordingUiSnapshot.canXxx` 决定，不由 UI 自己判断。建议规则：

```text
canStart:
  RecordingState = IDLE / FINISHED
  preciseLocationGranted = true
  gpsProviderEnabled = true
  sessionIntegrityState != ERROR
  当前没有未关闭的 active session

canPause:
  RecordingState = RECORDING
  sessionIntegrityState = OK

canResume:
  RecordingState = PAUSED
  sessionIntegrityState = OK
  gpsProviderEnabled = true

canFinish:
  RecordingState = RECORDING / PAUSED
  即使 sessionIntegrityState = ERROR 也允许 finish，用于关闭会话和释放资源

canExportTrustedGpx:
  RecordingState = FINISHED
  sessionCompletionState = FINISHED
  sessionIntegrityState = OK
  TrackPoint 数量 > 0
  不存在未收敛 pending candidate

canExportPartialGpx:
  sessionCompletionState = INTERRUPTED
  sessionIntegrityState = OK
  TrackPoint 数量 > 0
  UI 和文件名必须明确 partial

canExportDiagnosticLog:
  sessionId != null
  diagnostic.jsonl 已创建或存在可恢复片段
```

非法命令处理：

```text
非法 start/pause/resume/finish/export:
  不改变状态
  写 session_event(command_ignored) 或 ignored_input 诊断事件
  返回 errorCode = command_not_allowed
  UI 显示可理解原因
```

不要让 UI 通过隐藏按钮来代替后端状态校验。按钮隐藏只能改善体验，真正的合法性必须在 `RecordingSession` 再判断一次。

## 诊断日志

建议记录 JSON Lines。事件顺序必须稳定，方便流式解析和离线回放：

```text
记录开始:
  session_metadata -> config_snapshot -> runtime_snapshot -> session_event(start_recording)

每个 Location:
  raw_location -> segment(如有新 segment) -> decision

非 Location 生命周期事件:
  decision_batch_begin -> session_event -> segment/decision... -> decision_batch_commit

非法命令或结束后输入:
  ignored_input 或 session_event(command_ignored)
```

每条 JSONL 必须带统一 envelope：

```text
event
sessionId
eventSeq
schemaVersion
eventElapsedRealtimeNanos
writtenWallTimeMillis
```

诊断事件类型第一阶段建议固定为：

```text
session_metadata
config_snapshot
runtime_snapshot
session_event
raw_location
gnss_snapshot
gnss_measurement_summary
segment
decision
decision_batch_begin
decision_batch_commit
ignored_input
```

`ignored_input` 用于记录已经到达 dispatcher、但因 session 状态不允许而没有推进状态机的输入，例如 `FINISHED` 后到达的 `location_changed`、过期的 `first_fix_window_timer`、非法导出命令等。`ignored_input` 不参与 TrackDecisionEngine，不创建 RawPoint，不创建 TrackPoint。

`gnss_measurement_summary` 是可选诊断事件，用于记录 `GnssMeasurementsEvent` 的摘要，不参与第一阶段轨迹决策，也不参与 GPX 导出。ReplayRunner 可以读取它作为解释上下文，但不能因为它缺失而改变 expected/actual decision。

建议文件布局：

```text
files/track_sessions/{sessionId}/diagnostic.jsonl
files/track_sessions/{sessionId}/session.json
files/track_sessions/{sessionId}/track.gpx
files/track_sessions/{sessionId}/export/
```

写入规则：

```text
eventSeq 按文件写入顺序递增
同一个 diagnostic.jsonl 只写一个 sessionId
如果为了调试合并多个 session，replay 前必须先按 sessionId 拆分或过滤
诊断 JSONL 写入成功是 TrackRecorder apply 的前置条件
GPX 导出使用临时文件写入，成功后再 rename 为最终文件
```

文件写入原子性：

```text
session.json:
  使用 session.json.tmp 写入后 rename

diagnostic.jsonl:
  append-only
  不用 rename 替换整文件
  replay 只读取完整 JSON 行

track.gpx:
  使用 track.gpx.tmp 写入后 rename
  rename 失败则最终 GPX 不存在或保持旧版本
```

异常恢复规则：

```text
没有 finish_recording 的 session:
  completionState = INTERRUPTED
  replay 可做 BEST_EFFORT
  不作为正常完成轨迹验收

eventSeq 不连续:
  如果只是缺少尾部 finish_recording，按 INTERRUPTED
  如果中间断号、重复或倒退，按 INVALID_LOG

diagnostic.jsonl 可读但 GPX 不存在:
  可以重新从 ExportSnapshot 生成 GPX，前提是 sessionCompletionState = FINISHED 且 sessionIntegrityState = OK

GPX 临时文件存在但最终文件不存在:
  删除临时文件，允许重新导出

diagnostic.jsonl 最后一行不完整:
  截断到最后一个完整换行前，或 replay 时忽略最后半行
  sessionCompletionState = INTERRUPTED
  如果半行位于已 committed batch 中，replayStatus = INVALID_LOG

session.json 存在但 diagnostic.jsonl 不存在:
  completionState = ABORTED
  不显示为可用轨迹
```

首点候选收敛示例：

```json
{"event":"session_metadata","sessionId":"S1","eventSeq":1,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"createdWallTimeMillis":...,"createdElapsedRealtimeNanos":...,"diagnosticLogFileName":"diagnostic.jsonl","gpxFileName":"track.gpx","completionState":"ACTIVE","strategyVersion":"stage1-gnss-track-v1"}
{"event":"config_snapshot","sessionId":"S1","eventSeq":2,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"configId":1,"strategyVersion":"stage1-gnss-track-v1","firstFixWindowMillis":10000,"firstFixGoodAccuracyMeters":20,"firstFixRelaxedAccuracyMeters":30,"forcedWeakFirstFixEnabled":false,"flushEveryEventForTest":false,"fsyncEveryEventForTest":false}
{"event":"runtime_snapshot","sessionId":"S1","eventSeq":3,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"runtimeSnapshotId":1,"androidSdkInt":...,"deviceManufacturer":"...","deviceModel":"...","locationProviderGpsEnabled":true,"preciseLocationGranted":true,"foregroundServiceActive":true,"powerSaveMode":false}
{"event":"session_event","sessionId":"S1","eventSeq":4,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"eventId":1,"eventType":"start_recording","recordingStateBefore":"IDLE","recordingStateAfter":"RECORDING","fixStateAfter":"WAITING_FIRST_FIX"}
{"event":"raw_location","sessionId":"S1","eventSeq":5,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"rawPointId":41,"timeMillis":...,"provider":"gps","lat":...,"lng":...,"accuracy":...}
{"event":"decision","sessionId":"S1","eventSeq":6,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"decisionId":1000,"rawPointId":41,"result":"pending","reason":"pending_first_fix_candidate","state":"WAITING_FIRST_FIX"}
{"event":"decision_batch_begin","sessionId":"S1","eventSeq":7,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"batchId":1,"eventId":2,"candidateCount":1,"batchStatus":"pending"}
{"event":"session_event","sessionId":"S1","eventSeq":8,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"batchId":1,"eventId":2,"eventType":"first_fix_window_expired","fixStateBefore":"WAITING_FIRST_FIX","fixStateAfter":"WAITING_FIRST_FIX"}
{"event":"decision","sessionId":"S1","eventSeq":9,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"batchId":1,"decisionId":1001,"rawPointId":41,"result":"reject","reason":"first_fix_candidate_not_selected","pendingDecisionId":1000,"state":"WAITING_FIRST_FIX"}
{"event":"decision_batch_commit","sessionId":"S1","eventSeq":10,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"batchId":1,"decisionCount":1,"segmentEventCount":0,"decisionIds":[1001],"segmentIds":[],"eventChecksum":"...","batchStatus":"committed"}
```

gap recovery 示例：

```json
{"event":"raw_location","sessionId":"S1","eventSeq":20,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"rawPointId":42,"provider":"gps","accuracy":80.0}
{"event":"decision","sessionId":"S1","eventSeq":21,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"decisionId":1002,"rawPointId":42,"result":"reject","reason":"accuracy_too_large","state":"WEAK_SIGNAL"}
{"event":"raw_location","sessionId":"S1","eventSeq":22,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"rawPointId":43,"provider":"gps","accuracy":9.0}
{"event":"segment","sessionId":"S1","eventSeq":23,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"segmentId":2,"reason":"long_gnss_gap","previousSegmentId":1}
{"event":"decision","sessionId":"S1","eventSeq":24,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"decisionId":1003,"rawPointId":43,"trackPointId":18,"segmentId":2,"result":"anchor","reason":"gap_recovery_anchor","distanceDelta":0,"movingTimeDelta":0}
{"event":"raw_location","sessionId":"S1","eventSeq":25,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"rawPointId":44,"provider":"gps","accuracy":8.0}
{"event":"decision","sessionId":"S1","eventSeq":26,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"decisionId":1004,"rawPointId":44,"trackPointId":19,"segmentId":2,"result":"accept","reason":"moving_good_fix"}
```

GNSS 快照示例：

```json
{"event":"gnss_snapshot","sessionId":"S1","eventSeq":27,"schemaVersion":1,"eventElapsedRealtimeNanos":...,"writtenWallTimeMillis":...,"snapshotId":77,"receivedElapsedRealtimeNanos":...,"usedInFixTotal":8,"usedAvgCn0":31.2}
```

诊断日志用于解释：

- 为什么某个点没有进入轨迹
- 为什么距离没有增加
- 为什么开了新 segment
- 为什么 GPX 里没有某些原始点

诊断日志必须保持可关联：

```text
TrackPoint.sourceRawPointId -> raw_location.rawPointId
TrackPoint.sourceDecisionId -> decision.decisionId
TrackPoint.decisionReason -> decision.reason
TrackPoint.segmentId -> segment.segmentId
TrackDecision.sourceGnssSnapshotId -> gnss_snapshot.snapshotId
GnssQualitySnapshot.snapshotElapsedRealtimeNanos -> gnss_snapshot.receivedElapsedRealtimeNanos
所有关联都必须在同一个 sessionId 内解析
```

每个进入 GPX 的 `TrackPoint` 必须正好对应一个最终 decision：

```text
TrackPoint.sourceDecisionId 必须存在
sourceDecisionId 指向的 decision.result 只能是 accept 或 anchor
sourceDecisionId 不能指向 pending 或 reject
同一个 TrackPoint 不能对应多条最终 decision
```

如果某个 `RawPoint` 被拒绝，必须至少记录一个 reject decision。如果某个点作为 anchor-only TrackPoint 使用，必须记录 anchor decision。首点候选允许先记录 pending decision，但记录结束或等待窗口结束后必须有最终 accept/reject。否则 GPX 缺点或距离不增长时，无法判断是被过滤、作为锚点、还没实现记录，还是日志丢失。

## 测试数据管理

测试产物应按 session 或 fixture 保存，不要只在 UI 上看一眼轨迹。

建议目录：

```text
test_artifacts/
  replay_fixtures/
    first_fix_good/
      diagnostic.jsonl
      expected_report.json
    long_gap_recovery/
      diagnostic.jsonl
      expected_report.json
  device_runs/
    {date}_{device}_{scenario}/
      diagnostic.jsonl
      track.gpx
      track_partial.gpx
      replay_report.json
      manifest.json
      notes.md
```

`notes.md` 至少记录：

```text
设备型号
Android 版本
App 版本
测试场景
天气/遮挡/是否开阔地
开始和结束时间
是否熄屏
是否省电模式
观察到的问题
```

`manifest.json` 建议记录机器可读摘要，便于后续横向比较：

```text
sessionId
appVersion
schemaVersion
strategyVersion
deviceManufacturer
deviceModel
androidSdkInt
scenario
startedWallTime
endedWallTime
completionState
integrityState
replayStatus
trackPointCount
rawPointCount
segmentCount
totalDistanceMeters
recordingTimeSeconds
movingTimeSeconds
firstFixTtffSeconds
rejectReasonCounts
acceptReasonCounts
anchorReasonCounts
files:
  diagnosticJsonl
  trustedGpx
  partialGpx
  replayReport
  notes
```

`notes.md` 建议使用固定小模板：

```text
# 测试记录

## 环境
- 设备:
- Android:
- App:
- 电量/省电模式:
- 是否忽略电池优化:
- 天气:
- 场景:

## 操作
- 开始时间:
- 结束时间:
- 是否熄屏:
- 是否切后台:
- 是否暂停/恢复:

## 观察
- UI 是否长时间无 fix:
- 是否出现明显跳点:
- GPX 是否断段:
- 距离是否异常增长:
- 和肉眼路线是否一致:

## 结论
- 可复现问题:
- 需要固化为 replay fixture:
```

测试产物命名必须避免覆盖。真机问题只看截图不够，必须保留 `diagnostic.jsonl`，否则无法解释某个点为什么没有进入 GPX。

## 开发里程碑

方案实现应按可验证闭环推进，不要一次性把所有模块写完。每个里程碑结束时都应能运行、能导出诊断证据、能说明哪些能力还没做。

### M0：项目骨架与权限诊断

目标：先确认系统 GNSS 输入和 UI 基础状态可靠。

范围：

```text
MainActivity 权限请求
GPS Provider 状态展示
GnssStatus 展示
LocationManager.GPS_PROVIDER 回调展示
RuntimeSnapshot 初版
不记录正式轨迹
不导出 GPX
```

验收：

```text
能看到 provider / accuracy / usedInFix / 星座统计
精确位置权限未授予时有明确提示
GPS Provider 关闭时有明确提示
不使用高德/百度/腾讯/Google Fused SDK
```

### M1：最小记录闭环

目标：先跑通“一次记录 -> 诊断日志 -> 正式 TrackPoint -> GPX”的主链路。

范围：

```text
SessionMetadata
ConfigSnapshot
RuntimeSnapshot
SessionFileStore
DiagnosticEventEnvelope
RawPoint / TrackPoint / TrackSegment
LocationValidator
TrackDecisionDraft / TrackDecision / DecisionCommit
RecordingSession
DiagnosticLogger
GpxExporter
基础 GPX 导出
```

暂不做：

```text
前台服务
复杂 replay UI
候选回填
原始 GnssMeasurements 详细解析
```

验收：

```text
能开始/结束一次记录
diagnostic.jsonl 包含 session_metadata / config_snapshot / runtime_snapshot / raw_location / decision
GPX 中每个 trkpt 都有 sourceDecisionId
被拒绝 RawPoint 不进入 GPX
```

### M2：首点窗口与批量提交

目标：解决首点不可信和 pending candidate 收敛问题。

范围：

```text
FirstFixCoordinator
WAITING_FIRST_FIX
RecordingEventDispatcher 的 first_fix_window_timer
pending decision
DecisionBatchCommit
decision_batch_begin / decision_batch_commit
first_fix_good / first_fix_relaxed / first_fix_candidate_not_selected
pause_before_first_fix / recording_finished_before_first_fix
```

验收：

```text
首点窗口内不立即接受第一个点
窗口结束后所有 pending candidate 都收敛为 accept/reject
没有新 Location 时 timer 也能触发收敛
pause/finish 时 pending 不遗留
```

### M3：运动状态、分段与统计

目标：让 GPX 更接近真实徒步轨迹，而不是 Location 流水账。

范围：

```text
TRACKING_STATIONARY
TRACKING_MOVING
WEAK_SIGNAL
GAP_RECOVERY
静止漂移抑制
速度不可能过滤
长 gap 分段
anchor-only TrackPoint
distance / movingTime / recordingTime
```

验收：

```text
静止 2 分钟距离不明显增长
长 gap 后恢复开启新 TrackSegment
新 segment 第一个正式点为 anchor
pause/resume 不跨边界累计距离和 movingTime
```

### M4：离线 Replay 与 fixtures

目标：把户外问题变成可复现的离线输入。

范围：

```text
ReplayRunner
ReplayReport
EXACT / BEST_EFFORT / INVALID_LOG
expected vs actual decision diff
replay fixtures
expected_report.json
```

验收：

```text
能跑完最小 replay fixture 集
策略版本一致时 expected/actual 稳定
incomplete batch 被忽略
checksum mismatch 标记 INVALID_LOG
半行 JSON 不被当作有效事件
```

### M5：真实徒步运行模式

目标：让记录能承受熄屏、切后台和较长时间户外测试。

范围：

```text
RecordingForegroundService
location foreground service type
持续通知
RecordingEventDispatcher 统一承载真实输入
进程中断恢复扫描
INTERRUPTED session 展示
partial GPX 显式导出
```

验收：

```text
真实徒步模式不依赖 Activity 存活
熄屏 5~10 分钟后仍能记录或明确产生 gap
杀进程后重新打开显示 interrupted
不把 interrupted 伪装成正常完成轨迹
```

### M6：真机测试与问题归档

目标：建立可比较、可复盘的 Android 设备测试资料。

范围：

```text
test_artifacts/device_runs
open_sky_walk
stationary_test
urban_canyon_or_tree_cover
pause_resume_walk
gap_recovery_walk
notes.md
ReplayReport 归档
```

验收：

```text
每次真机测试都保存 GPX / partial GPX 如有 / diagnostic.jsonl / replay_report.json / manifest.json / notes.md
能够用日志解释 GPX 缺点、分段、距离不增长
能够比较不同 Android 设备的 GNSS 表现
```

第一阶段完成标准建议定义为 M0~M4。M5 是真实徒步可靠性的关键，但可以在 M1~M4 策略闭环稳定后再接入，避免前台服务和轨迹策略同时调试。

## 最小可实现版本

第一阶段完成标准建议定义为 M0~M4，也就是“系统 GNSS 输入可观测、记录策略可解释、GPX 可导出、离线 replay 可复现”。真实徒步前台服务模式属于 M5，必须设计好边界，但不应阻塞 M0~M4 的策略闭环。

第一阶段必须实现：

```text
RawPoint / TrackPoint 分离
RecordingSession 编排边界
RecordingEventDispatcher 单线程输入串行化
SessionMetadata / DiagnosticEventEnvelope 会话日志模型
TrackDecisionDraft / TrackDecision / DecisionCommit / DecisionBatchCommit 决策提交模型
PreparedRecorderMutation 提交前校验模型
SessionIntegrityState / SessionIntegrityError 完整性模型
ExportSnapshot 只读导出快照
SessionFileStore 文件持久化边界
session_metadata / config_snapshot / runtime_snapshot / session_event 诊断事件
elapsedRealtimeNanos 时间基准
记录开始前旧点过滤
GnssStatus 快照缓存与诊断展示
Location 与 GnssStatus 接收时间匹配
Location / GnssStatus / timer / lifecycle command 串行处理
首点等待
accuracy 硬过滤
时间倒退过滤
速度不可能过滤
静止漂移抑制
长 gap 分段
GPX 多 trkseg 导出
基础诊断 reason
JSONL 诊断日志导出
最小离线 replay 输入完整性校验
最小 replay fixture 测试集
```

第一阶段只要求前台可见的实验室记录模式能跑通。代码边界上要为 `RecordingForegroundService` 预留接入点，但不要求真实熄屏徒步长期记录通过验收。

M5 再加入：

```text
RecordingForegroundService
location 类型前台服务
持续通知
SessionCompletionState 中断恢复展示
进程中断恢复扫描
partial GPX 显式导出
```

更后续阶段再加入：

```text
候选点缓冲和回填
海拔平滑
更完整的运动状态机
更完整的原始 GNSS 测量日志
诊断日志压缩、筛选和分享
```

## 暂不做范围

为了让当前项目保持“系统定位与轨迹记录测试”的定位，以下内容不进入第一阶段：

```text
地图渲染、路线规划、导航箭头、偏航重算
高德/百度/腾讯/Google Fused Location SDK
Android FUSED_PROVIDER 正式轨迹输入
候选点事后回填 TrackPoint
原始 GNSS 测量自主解算经纬度
RTK / PPP / 差分定位
气压计或 DEM 海拔融合
复杂卡尔曼滤波和地图匹配
后台自动启动记录
云同步、账号体系、轨迹分享社区
```

这些能力不是永远不能做，而是必须等“系统 GNSS 原始输入 -> 决策 -> 诊断日志 -> GPX -> replay”的闭环稳定后，再作为独立实验项接入。尤其是导航箭头和地图匹配会掩盖系统 GNSS 本身的问题，不适合放在当前测试 app 的第一阶段。

## 实施顺序清单

建议实际编码按下面顺序推进，每一步都应能独立验证：

```text
1. 建立数据模型:
   SessionMetadata / ConfigSnapshot / RuntimeSnapshot
   RawPoint / GnssQualitySnapshot / TrackPoint / TrackSegment
   TrackDecisionDraft / TrackDecision / DecisionCommit / DecisionBatchCommit

2. 建立文件边界:
   SessionFileStore
   session.json
   diagnostic.jsonl append
   track.gpx.tmp -> track.gpx 原子替换

3. 建立诊断日志:
   DiagnosticEventEnvelope
   eventSeq 单调递增
   session_metadata / config_snapshot / runtime_snapshot / session_event
   raw_location / gnss_snapshot / decision

4. 建立最小 RecordingSession:
   start / pause / resume / finish
   RawPoint 接收
   LocationValidator
   accept / reject 决策
   TrackRecorder apply

5. 建立 GPX 导出:
   ExportSnapshot
   GpxExporter
   sourceDecisionId / sourceRawPointId / elapsedRealtimeNanos extension

6. 接入首点策略:
   FirstFixCoordinator
   WAITING_FIRST_FIX
   pending_first_fix_candidate
   first_fix_window_timer

7. 接入批量提交:
   DecisionBatchCommit
   pause/finish/window_expired 触发 pending 收敛
   incomplete batch replay 忽略

8. 接入运动与分段:
   TRACKING_STATIONARY
   TRACKING_MOVING
   WEAK_SIGNAL
   GAP_RECOVERY
   distance / movingTime / recordingTime

9. 接入 replay:
   ReplayRunner
   ReplayReport
   expected_report.json
   fixtures 回归测试

10. 接入真实徒步模式:
    RecordingForegroundService
    中断恢复
    partial GPX
    真机长时间测试归档
```

如果实现过程中发现某一步必须依赖后面的能力，优先回头收窄前一步，而不是提前引入大模块。例如 M1 的 GPX 导出不应依赖 M5 前台服务；M4 的 replay 不应依赖 Android `LocationManager`。

## 代码级测试映射

第一阶段测试应以普通 JVM 单元测试为主，Android 真机测试为辅。轨迹策略、replay、GPX 导出都不应只能在手机上验证。

建议最小测试覆盖：

```text
LocationValidatorTest:
  provider 不是 gps -> reject provider_not_gps
  缺少 elapsedRealtimeNanos -> reject missing_elapsed_realtime
  点早于记录开始 -> reject before_record_start
  locationAgeNanos 超过 maxLocationAgeNanos -> reject stale_location
  accuracy <= 0 -> reject invalid_accuracy
  accuracy > 50m -> reject accuracy_too_large
  mock location -> reject mock_location
  30m < accuracy <= 50m -> ValidationResult.valid = true

SystemLocationSourceTest:
  只注册 LocationManager.GPS_PROVIDER
  request 参数写入 ConfigSnapshot
  provider_disabled 事件不生成 TrackPoint
  no_location_timer 只生成 session_event(no_location_timeout)
  非 gps provider 输入只能 ignored/reject，不能进入正式轨迹
  GnssMeasurementsEvent 只生成可选诊断摘要，不参与 TrackDecision

FirstFixCoordinatorTest:
  accuracy <= 20m -> first_fix_good
  20m < accuracy <= 30m -> first_fix_relaxed
  30m < accuracy <= 50m -> 默认不选为正式首点
  窗口超时后所有 pending candidate 都有 final decision
  pause/finish 触发 pending 收敛
  没有新 Location 时 timer 也能收敛

TrackDecisionEngineTest:
  PAUSED 下 Location 不生成 accept/anchor
  WAITING_FIRST_FIX 不立即接受第一个弱点
  TRACKING_STATIONARY 内漂移不累计距离
  TRACKING_MOVING 正常点生成 accept
  requiredSpeed > impossibleSpeedMetersPerSecond -> reject
  长 gap 后恢复生成 gap_recovery_anchor

TrackRecorderTest:
  prepare 不修改内部状态
  apply 后 TrackPoint / TrackSegment / distance / movingTime 一致
  anchor point 的 distanceDelta 和 movingTimeDelta 为 0
  accept point 的 sourceDecisionId 指向 final decision
  reject/pending 不创建 TrackPoint

DecisionBatchCommitTest:
  committed batch 计数、ID、checksum 全部匹配 -> replay 可接受
  缺少 decision_batch_commit -> batch 内事件不生效
  checksum mismatch -> ReplayStatus.INVALID_LOG
  batch 内 eventSeq 不连续 -> ReplayStatus.INVALID_LOG
  每个 pending candidate 必须正好对应一条 final decision

DiagnosticLoggerTest:
  eventSeq 单调递增且不重复
  append 失败返回 diagnostic_log_append_failed
  半行 JSON 在 replay 中被忽略或标记 INVALID_LOG
  同一文件混入多个 sessionId 时必须要求选择 session

SessionFileStoreTest:
  创建 session 时先写 session.json.tmp 再 rename
  diagnostic.jsonl append-only，不做原地修改
  启动扫描清理无效 tmp 文件
  session.json 缺失 diagnostic.jsonl -> ABORTED
  diagnostic.jsonl 有 start 无 finish -> INTERRUPTED
  session.json 只作为索引，replay 以 diagnostic.jsonl 为准

GpxExporterTest:
  sessionIntegrityState = ERROR -> 禁止可信 GPX
  ExportSnapshot 为空 -> 导出失败或生成明确空轨迹，不伪装成功
  多 TrackSegment -> 输出多个 trkseg
  每个 trkpt 包含 sourceDecisionId / sourceRawPointId / elapsedRealtimeNanos
  track.gpx.tmp 写入成功后才 rename

ExportNamingTest:
  trusted 导出文件名包含 trusted，且 partial=false
  interrupted 导出文件名包含 partial，且 partial=true
  diagnostic 导出不重排 eventSeq
  export/manifest.json 能列出 GPX、diagnostic、replay_report、notes

ReplayRunnerTest:
  schemaVersion / strategyVersion 一致 -> expected/actual 可严格比较
  strategyVersion 不一致 -> 只能 BEST_EFFORT
  first_fix_good fixture -> EXACT
  weak_first_fix fixture -> reject weak_signal_stage1
  long_gap_recovery fixture -> 新 segment + anchor
  pause_resume fixture -> pause 期间无 accept/anchor

RecordingUiSnapshotTest:
  IDLE 且权限/GPS 正常 -> canStart = true
  RECORDING -> canPause/canFinish = true
  PAUSED -> canResume/canFinish = true
  FINISHED + integrity OK + 有 TrackPoint -> canExportTrustedGpx = true
  integrity ERROR -> canExportTrustedGpx = false, canExportDiagnosticLog = true
  非法命令 -> 返回 command_not_allowed 且状态不变
```

测试分层建议：

```text
JVM unit test:
  LocationValidator
  FirstFixCoordinator
  TrackDecisionEngine
  TrackRecorder
  GpxExporter XML 字符串/文件输出
  ReplayRunner fixture 回放

Android instrumentation test:
  权限状态读取
  LocationManager.GPS_PROVIDER 注册/注销
  GnssStatus callback 接入
  SessionFileStore 在 app 私有目录写入

真机手工测试:
  开阔地
  静止
  遮挡/树荫
  pause/resume
  长 gap
  M5 阶段再测熄屏、切后台、进程中断恢复
```

如果某个策略只能通过真机手工测试发现问题，应该尽快把对应 `diagnostic.jsonl` 固化成 replay fixture。真机测试负责发现问题，replay fixture 负责防止问题反复出现。

## 架构风险清单

后续写代码时需要重点避免这些问题：

```text
MainActivity 变成业务核心:
  风险：权限、UI、定位回调、距离计算、GPX 导出全部堆在一起，策略无法 replay。
  要求：MainActivity 只发 command 和展示 snapshot。

DiagnosticLogger 修改轨迹状态:
  风险：日志失败和轨迹决策互相污染，无法判断真实状态。
  要求：logger 只写事件，不产生决策，不 apply TrackRecorder mutation。

GpxExporter 重新筛点:
  风险：GPX 和诊断日志里的 decision 不一致。
  要求：exporter 只消费 ExportSnapshot，不重新判断 accuracy、速度或状态。

用 wallTimeMillis 判断轨迹连续性:
  风险：系统时间变化导致速度、gap、TTFF 计算错误。
  要求：轨迹计算只使用 elapsedRealtimeNanos，wall time 只用于展示和 GPX 时间戳。

把 Android accuracy 当成绝对真值:
  风险：accuracy 漂亮但点位跳变时污染轨迹。
  要求：accuracy 是必要但不充分条件，还要结合时间、速度、状态和 gap。

pending candidate 不收敛:
  风险：replay 和导出无法解释首点到底接受还是拒绝。
  要求：窗口超时、pause、finish 都必须产生最终 accept/reject。

暂停期间接受定位:
  风险：用户暂停休息时轨迹继续增长。
  要求：PAUSED 下只能记录 RawPoint/诊断，不得生成 accept/anchor TrackPoint。

把 GNSS 状态作为硬拒绝:
  风险：不同设备 usedInFix/CN0 上报差异导致误杀有效点。
  要求：第一阶段 GNSS 状态只做解释和辅助评分，不作为全局硬拒绝。

ReplayRunner 容忍日志损坏:
  风险：损坏日志生成看似可信的 GPX。
  要求：半行、batch checksum mismatch、eventSeq 断裂都必须显式标记。
```

## 验收标准

### 离线回放

- 必须提供覆盖首点、弱信号、静止漂移、长 gap、暂停、结束、batch 损坏、日志损坏的 replay fixtures
- 每个 fixture 必须有 `diagnostic.jsonl` 和 `expected_report.json`
- ReplayRunner 输出必须能区分 `EXACT / BEST_EFFORT / INVALID_LOG`
- 策略代码或 `strategyVersion` 变化后必须重新跑全部 replay fixtures
- replay 不应依赖 Android 设备、LocationManager 或实时 SystemClock

### 第一阶段真机功能测试

- 权限拒绝：拒绝精确位置权限时，不应开始可信轨迹记录
- GPS 关闭：GPS Provider 关闭时，UI 明确提示，不生成正式轨迹点
- 暂停恢复：暂停期间不得生成 accept/anchor，恢复后新 segment 第一个正式点为 anchor
- 结束记录：结束后新的 Location 回调不得生成 TrackPoint
- 导出 GPX：结束后导出的 GPX 可被常见地图工具打开
- 导出诊断日志：诊断 JSONL 包含 session_metadata、config_snapshot、runtime_snapshot 和完整 decision 链
- 存储失败模拟：无法创建 session 目录或写入 diagnostic.jsonl 时，不进入可信记录
- 前台可见记录：第一阶段允许要求 App 前台可见和屏幕不熄灭，但 UI 必须明确这是实验室记录模式，不是完整徒步模式

### M5 真实徒步功能测试

- 前台服务：真实徒步模式下开始记录后必须出现持续通知
- 熄屏记录：熄屏 5~10 分钟后仍能继续记录 raw_location 或明确记录 gap
- 切后台记录：切后台后记录不中断，或在诊断日志中明确产生 gap / interruption
- 进程中断恢复：杀进程后重新打开 App，应显示 interrupted session，不伪装成正常完成
- partial GPX：异常中断 session 只允许导出显式标记的 partial GPX
- 前台服务权限：Android 14/API 34+ 需要满足 location foreground service type 和相关权限声明

### 真机路线测试

建议至少覆盖：

```text
open_sky_walk:
  开阔地步行 10~20 分钟
  验证距离、movingTime、GPX 连续性

stationary_test:
  开阔地静止 2~5 分钟
  验证静止漂移不明显累计距离

urban_canyon_or_tree_cover:
  楼间、树荫、山谷边缘
  验证弱信号点不污染正式轨迹

pause_resume_walk:
  记录中暂停 1~2 分钟再恢复移动
  验证多 trkseg 和 pause_resume_anchor

gap_recovery_walk:
  进入遮挡区域造成长 gap 后回到开阔地
  验证新 segment 和 gap_recovery_anchor
```

真机测试结束后必须保存：

```text
GPX
diagnostic.jsonl
ReplayReport
设备型号 / Android 版本 / 测试环境说明
```

### 室外开阔地

- 记录 TTFF，不把固定 30 秒作为所有环境的硬门槛
- 热启动且无遮挡时，期望 30 秒内获得稳定 fix
- 冷启动、遮挡、AGPS 状态未知时，应记录实际 TTFF 和测试环境
- TTFF 起点：开始监听 `GPS_PROVIDER` 的 `elapsedRealtime`
- TTFF 终点：首个满足基础 fix 条件的 `Location` 到达时间
- 同时记录该 fix 是否成为首个正式 TrackPoint
- 同一 TrackSegment 内正式轨迹点连续
- 不同 TrackSegment 之间不要求连续，且不应在 GPX 中被连成一条线
- GPX 可被常见地图工具打开
- 静止 2 分钟距离不应明显增长
- 记录开始前缓存点不会进入 GPX
- 处于 `WAITING_FIRST_FIX` 时，UI 应明确显示正在等待首个可信 GNSS 点，而不是表现为记录失败

TTFF 的“基础 fix 条件”定义为：

```text
provider == gps
hasValidElapsedRealtime(location) == true
elapsedRealtimeNanos >= gnssRequestStartElapsedRealtimeNanos - toleranceNanos
latitude/longitude 有效，且不是 0,0
accuracy > 0
accuracy <= 50m
不是 mock location
```

注意：基础 fix 只表示“系统已经给出一个可用 GNSS 位置”，不等于它一定能成为首个正式 `TrackPoint`。首个正式轨迹点仍需满足 `WAITING_FIRST_FIX` 的首点策略。

### 室内或窗边

- 能看到卫星状态
- 如果无 fix，不应生成正式轨迹点
- 不应把弱定位伪装成可用轨迹

### 弱信号环境

- 原始点可以记录诊断
- 正式轨迹不应被单个跳点污染
- 长时间中断后恢复应开新 segment 或明确标记
- GNSS 状态过期时，不应把过期 `usedInFix/CN0` 当成当前点质量

### 运行约束

- 第一阶段实验室模式可以只依赖 Activity 前台可见，但 UI 必须明确该模式不保证熄屏和后台长期记录
- 真实户外徒步模式下，记录必须由 location 类型前台服务承载，不能只依赖 Activity 存活
- 无论实验室模式还是真实徒步模式，Location / GnssStatus / lifecycle command / timer 都必须经由单线程 `RecordingEventDispatcher` 串行处理
- 如果精确位置权限未授予，不应开始可信轨迹记录
- 如果 GPS Provider 关闭，UI 应明确提示，不应生成正式轨迹点
- 如果 session 目录、session.json 或 diagnostic.jsonl 无法创建，不应开始可信轨迹记录

### 导出一致性

- GPX 中每个 `<trkpt>` 都应包含 `segmentId`、`sourceRawPointId`、`elapsedRealtimeNanos`
- GPX 中每个 `<trkpt>` 都应包含 `sourceDecisionId`，并能在诊断日志中定位到最终 accept/anchor decision
- GPX 中每个 `<trkpt>` 都应包含 `decisionResult`、`decisionReason`，anchor-only 点的 `distanceDeltaMeters` 和 `movingTimeDeltaSeconds` 必须为 0
- 诊断日志开始处必须包含 `session_metadata`、`config_snapshot`、`runtime_snapshot` 和 `session_event(start_recording)`
- 诊断日志每行必须包含 `sessionId`、`eventSeq`、`schemaVersion` 和 `eventElapsedRealtimeNanos`
- 同一诊断日志文件内 `eventSeq` 必须单调递增且不重复
- 同一诊断日志文件内不得混入多个 `sessionId`
- `session.json`、`diagnostic.jsonl`、`track.gpx.tmp -> track.gpx` 的写入/rename 失败必须有明确错误提示
- `diagnostic.jsonl` 最后一行半截时，replay 必须忽略半行或标记 INVALID_LOG，不能把半行当作有效事件
- pause/finish 之后的 Location 是否进入轨迹，必须能由 dispatcher 处理顺序和诊断日志 eventSeq 解释
- `config_snapshot` 必须包含 `schemaVersion` 和 `strategyVersion`
- `runtime_snapshot` 必须记录精确位置权限、GPS Provider 状态、前台服务状态和省电模式
- 诊断日志中的 `sourceGnssSnapshotId` 必须能回查到对应 `gnss_snapshot.snapshotId`，除非该点没有可匹配快照
- 诊断日志中可以通过 `sourceRawPointId` 回查该轨迹点对应的 RawPoint 和 accept/anchor decision
- 每个进入 GPX 的 TrackPoint 必须正好对应一条最终 accept/anchor decision，不允许指向 pending/reject decision
- `sessionIntegrityState = ERROR` 时必须禁止导出可信 GPX，但允许导出诊断 JSONL
- `sessionCompletionState = INTERRUPTED` 时不得伪装成正常完成轨迹；partial GPX 必须显式标记
- 当 `sessionIntegrityState != ERROR` 时，记录结束后诊断日志中不应存在未收敛的 `pending_first_fix_candidate`
- 即使首点窗口到期后没有新的 Location 回调，也必须通过 `session_event(first_fix_window_expired)` 和完整 `decision_batch_commit` 收敛 pending candidate
- 只有存在 `decision_batch_commit` 且计数/ID/checksum 校验通过的 batch 才能被 replay 和导出逻辑认可
- 未 committed batch 内的 `session_event` 不得推进 replay 状态
- batch 内每个 pending candidate 必须正好对应一条 final decision
- `decision_batch_commit` 后如果 TrackRecorder apply 失败，必须标记 `sessionIntegrityState = ERROR` 并禁止导出可信 GPX
- 普通 `DecisionCommit` 日志写入成功后如果 TrackRecorder apply 失败，也必须标记 `sessionIntegrityState = ERROR` 并禁止导出可信 GPX
- 暂停状态下不得生成 accept 或 anchor TrackPoint
- ReplayRunner 必须输出 expected/actual decision diff、incompleteBatchCount、ignoredBatchIds 和 checksumMismatchBatchIds
- 被拒绝的 RawPoint 不应出现在 GPX 中

## 结论

当前项目的正确方向是：

```text
系统 GNSS 负责真实定位输入
GnssStatus 负责质量解释
轨迹状态机负责筛选正式轨迹
GPX 只导出正式轨迹
诊断日志保留原始数据和决策过程
```

这套策略比“收到 Location 就写入 GPX”更接近真实徒步轨迹记录，也更适合对比 Android 系统 GNSS 在不同设备上的表现。
