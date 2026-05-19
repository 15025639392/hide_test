# 徒步轨迹记录策略设计

当前实现的权威短版见 `docs/system-gnss-track-recording-plan.md`。本文保留
策略设计背景，但涉及当前落地行为时，以 `stage1-gnss-track-v2-rest-state`
为准。

## 1. 核心定义

轨迹记录的本质不是把 GPS 点按时间存下来，而是：

```text
把人在户外场景中的连续移动，转化为可回放、可解释、可统计、可信任的时空过程。
```

因此，轨迹系统不应该只回答“多久采一次点”，而应该持续回答：

- 当前点是否可信
- 当前用户是在移动、停留、信号弱，还是恢复中
- 当前点能否进入主轨迹
- 当前点能否参与距离、速度、爬升等统计
- 当前轨迹段应该如何展示给用户
- 这条轨迹最终有多完整、多可信

## 2. 设计原则

### 2.1 原始点不等于轨迹点

系统采集到的位置点应先作为原始观测保存，不能直接进入正式轨迹。

```text
RawPoint      原始定位点，全部保存，用于诊断、回放、复算
TrackPoint    清洗后的正式轨迹点，用于画线、统计、导出
TrackEvent    异常、暂停、弱信号、中断、恢复等事件
Segment       一段具有明确语义的轨迹片段
```

原则：

```text
采到点 != 画到轨迹上
采到点 != 累计距离
采到点 != 证明用户真实经过
```

### 2.2 动态采样，而不是固定频率

轨迹系统应根据以下因素动态调整采集策略：

- `accuracy`：定位精度
- `speed`：速度
- `timeGap`：与上一个点的时间间隔
- `movement`：短时间窗口内的位移趋势
- `battery`：电量与系统限制
- `terrain`：地形、坡度、开阔程度、山地遮挡

核心思路：

```text
定位采集 -> 点质量评估 -> 运动状态判断 -> 动态采样策略 -> 轨迹写入策略 -> 统计与可信度输出
```

### 2.3 信号异常要显式表达

山地、峡谷、密林、隧道、岩壁附近经常出现定位异常。系统不能把异常“修成正常”，而应该识别、隔离、标记。

常见异常：

- 精度很差
- 长时间没有定位点
- 位置突然跳远
- 速度不符合徒步场景
- 海拔剧烈抖动
- 后台或低电量导致采样间隔变长

展示上应区分：

```text
实线：可信轨迹
虚线：中断后的连接或估算
浅色线：低可信轨迹
异常点：疑似漂移
灰色区间：无定位或弱信号
```

当前测试 App 的地图显示约定：

```text
底图:
  使用原生 Canvas 地图视图，不再通过 WebView 传输轨迹数据。
  卫星瓦片使用高德 style=6，地图视图 zoom 根据当前比例动态计算，范围 2~22。
  瓦片数据源最大只请求 z18；视图 zoom 超过 18 时继续放大 z18 瓦片，不请求 z19~z22 瓦片。
  轨迹记录、诊断日志和 GPX 导出坐标保持 WGS-84。
  仅在绘制到国内卫星瓦片时，把显示坐标临时转换为 GCJ-02。

可信主轨迹:
  蓝色实线。
  只连接 decisionResult = anchor / accept 的可信 TrackPoint。
  只累计可信距离和 movingTime。
  当前真实徒步版本中，GAP 恢复点也连接到最终蓝色实线中，但该点的 distanceDelta/movingTimeDelta 为 0。

弱信号轨迹:
  黄色点。
  来源为 decisionResult = weak 的 TrackPoint。
  不参与可信距离，不画成蓝色实线。
  进入 partial GPX / diagnostic 用于排查弱信号环境。

断点:
  地图视觉上不留空白断口。
  所有可信 TrackPoint 按时间顺序用蓝色实线连续连接。
  长时间 GAP 后若确认为移动恢复，用 decisionReason = gap_recovery、gapCount 和 segmentId 表达；若仍是静止锚点优化，则替换原零距离 anchor，不用断线破坏最终轨迹连续性。
  弱信号点只显示为黄色诊断点，不打断可信实线，也不参与可信距离。

当前位置:
  蓝色圆点表示系统最新 Location。
  浅蓝圆表示系统水平精度半径。
  橙色箭头表示系统 bearing。
```

## 3. 数据模型建议

### 3.1 原始位置点

```kotlin
data class RawLocationPoint(
    val latitude: Double,
    val longitude: Double,
    val altitude: Double?,
    val accuracy: Float,
    val altitudeAccuracy: Float?,
    val speed: Float?,
    val bearing: Float?,
    val wallTimeMillis: Long,
    val elapsedRealtimeNanos: Long,
    val provider: String,
    val batteryLevel: Float?,
    val isMocked: Boolean
)
```

### 3.2 点质量

```kotlin
enum class PointQuality {
    EXCELLENT,
    GOOD,
    WEAK,
    BAD,
    DRIFT,
    GAP
}
```

建议初始阈值：

```text
EXCELLENT:
  accuracy <= 10m

GOOD:
  accuracy <= 25m

WEAK:
  25m < accuracy <= 80m

BAD:
  accuracy > 80m

DRIFT:
  与上一个可信点推算速度明显不合理

GAP:
  与上一个点时间间隔过长，例如 > 2-5 分钟

TRANSPORT:
  有连续定位证据，但移动明显超过徒步范围，疑似坐车、骑行或景区摆渡车
```

徒步场景中，普通平路速度通常远低于骑行和驾车。第一版可先把异常速度阈值设得保守一些，例如：

```text
impliedSpeed > 12m/s
```

这约等于 43.2km/h，在真实徒步中基本可以视为跳点或异常；如果系统上报速度和两点速度都落在合理车辆速度范围内，则归入交通工具混入诊断，而不是普通跳点。

但坐车混入不能只靠 `impliedSpeed > 12m/s` 判断。当前实现额外引入 `transport_suspected`：

```text
明显超过徒步范围，或系统上报速度显示为合理车辆速度:
  reject transport_suspected
  进入 transport mode

transport mode:
  reject transport_confirmed
  RawPoint 继续进入诊断
  ReplayRunner 必须重放 transport mode 状态
  不生成可信徒步 TrackPoint
  不累计徒步距离
  地图使用红色轨迹线显示交通工具混入段

恢复稳定徒步速度:
  accept transport_recovery
  distanceDeltaMeters = 0
  movingTimeDeltaSeconds = 0
  新内部 segment
```

`transport_recovery` 不是 GAP；它表示系统看到了移动证据，但这段移动不属于可信徒步。

### 3.3 轨迹状态

```kotlin
enum class TrackingState {
    STARTING,
    MOVING,
    SIGNAL_WEAK,
    PAUSED,
    REST_CANDIDATE,
    REST_PAUSED,
    REST_PROBING,
    TRANSPORT,
    ENDED
}
```

状态含义：

```text
STARTING:
  刚开始记录，等待稳定首点和初始方向

MOVING:
  用户正在持续移动

PAUSED:
  连续静止决策后的低频采样状态

SIGNAL_WEAK:
  连续弱定位、坏点、漂移点，或长时间没有定位

REST_CANDIDATE:
  有低速、小位移和加速度静止证据，正在收集休息确认

REST_PAUSED:
  已确认休息锚点，GPS keepalive 不累计距离

REST_PROBING:
  从休息恢复时提频探测，确认前不回补距离

TRANSPORT:
  疑似交通工具混入，继续记录 RawPoint 但不进入可信徒步距离

ENDED:
  用户结束记录
```

### 3.4 轨迹片段

```kotlin
enum class SegmentType {
    MOVING,
    PAUSED,
    WEAK_SIGNAL,
    GAP,
    ESTIMATED,
    CLIMB,
    DESCENT
}
```

第一版不需要一次性实现所有类型。建议优先支持：

```text
MOVING
PAUSED
WEAK_SIGNAL
GAP
```

## 4. 点质量评估

每个位置点进入系统后，先执行质量评估。

```text
onLocation(point)
  -> 保存 RawPoint
  -> 检查 provider / timestamp / elapsedRealtime
  -> 计算与上一个可信点的 timeGap / distance / impliedSpeed
  -> 根据 accuracy 和连续性生成 PointQuality
```

伪代码：

```kotlin
fun evaluatePoint(
    point: RawLocationPoint,
    previousTrustedPoint: RawLocationPoint?
): PointQuality {
    if (previousTrustedPoint == null) {
        return when {
            point.accuracy <= 10f -> PointQuality.EXCELLENT
            point.accuracy <= 25f -> PointQuality.GOOD
            point.accuracy <= 80f -> PointQuality.WEAK
            else -> PointQuality.BAD
        }
    }

    val timeGapMillis = elapsedGapMillis(previousTrustedPoint, point)
    if (timeGapMillis > 5 * 60 * 1000) {
        return PointQuality.GAP
    }

    val distanceMeters = distanceMeters(previousTrustedPoint, point)
    val impliedSpeed = distanceMeters / (timeGapMillis / 1000.0)
    if (impliedSpeed > 12.0) {
        return PointQuality.DRIFT
    }

    return when {
        point.accuracy <= 10f -> PointQuality.EXCELLENT
        point.accuracy <= 25f -> PointQuality.GOOD
        point.accuracy <= 80f -> PointQuality.WEAK
        else -> PointQuality.BAD
    }
}
```

质量评估只回答“这个点有多可信”，不要在这里混入太多业务行为。状态转换和采样策略应在后续模块处理。

## 5. 运动状态机

### 5.1 基础转换

```text
STARTING
  -> MOVING
     连续拿到若干 GOOD/EXCELLENT 点，并发生有效位移

MOVING
  -> REST_CANDIDATE
     连续 20s 以上低速、小位移，且有加速度静止证据

REST_CANDIDATE
  -> REST_PAUSED
     收集到至少 2 个静止确认点，并选出休息锚点

REST_PAUSED
  -> REST_PROBING
     加速度变化，或位置/速度显示可能离开锚点

REST_PROBING
  -> MOVING
     连续可信移动证据确认离开休息锚点，写入零距离 recovery 点

REST_PROBING
  -> REST_PAUSED
     探测点仍在锚点附近，继续休息 keepalive

MOVING / REST_CANDIDATE / REST_PAUSED / REST_PROBING
  -> SIGNAL_WEAK
     连续多个 WEAK/BAD/DRIFT 点，或长时间无定位

SIGNAL_WEAK
  -> MOVING
     重新拿到可信移动点；若 GAP 超过 120s，恢复点以 gap_recovery 零距离入轨

MOVING
  -> TRANSPORT
     明显超过徒步速度范围或有合理车辆速度证据

TRANSPORT
  -> MOVING
     稳定恢复到徒步速度，写入 transport_recovery 零距离点
```

### 5.2 徒步场景的特殊判断

徒步不能简单用低速判断暂停：

```text
上坡慢 != 停止
原地漂移 != 移动
信号断了 != 用户没走
```

因此当前实现使用 `REST_CANDIDATE` 和 `REST_PROBING` 作为缓冲状态，避免把慢速爬坡、短暂停顿、拍照等场景过早判定为暂停，也避免休息后起步把锚点附近漂移回补为距离。

当前暂停/休息判断：

```text
REST_CANDIDATE:
  连续低速、小位移，并有最近加速度静止证据

REST_PAUSED:
  保留 GPS keepalive
  小范围漂移不累计距离

REST_PROBING:
  提频确认恢复移动
  探测点默认不回补距离
```

山地或陡坡场景可延长暂停确认时间：

```text
陡坡/爬升中:
  pauseDetectionMinDuration = 5 分钟

开阔平地:
  pauseDetectionMinDuration = 3 分钟
```

## 6. 动态采样策略

### 6.1 采样策略结构

```kotlin
data class SamplingPolicy(
    val intervalMillis: Long,
    val distanceFilterMeters: Float,
    val desiredAccuracy: DesiredAccuracy
)

enum class DesiredAccuracy {
    HIGH,
    BALANCED,
    LOW_POWER
}
```

### 6.2 状态对应策略

```text
STARTING:
  intervalMillis = 1 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH

MOVING:
  intervalMillis = 3 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH

SIGNAL_WEAK:
  intervalMillis = 2 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH
  注意：提高采集尝试，不等于提高点的信任度

REST_PROBING:
  intervalMillis = 1 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH

REST_PAUSED:
  intervalMillis = 10 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH

TRANSPORT:
  intervalMillis = 3 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH

PAUSED:
  intervalMillis = 10 秒
  distanceFilterMeters = 0 米
  desiredAccuracy = HIGH
```

真实徒步记录优先保留路线形状，因此第一阶段不把距离过滤交给 Android 系统。功耗主要通过时间间隔调节；距离、静止、弱信号和 GAP 由 App 层解释。

### 6.3 决策伪代码

```kotlin
fun chooseSamplingPolicy(context: TrackingContext): SamplingPolicy {
    if (context.batteryLevel != null && context.batteryLevel < 0.15f) {
        return SamplingPolicy(
            intervalMillis = 60_000,
            distanceFilterMeters = 0f,
            desiredAccuracy = DesiredAccuracy.LOW_POWER
        )
    }

    return when (context.state) {
        TrackingState.STARTING -> SamplingPolicy(1_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.MOVING -> SamplingPolicy(3_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.SIGNAL_WEAK -> SamplingPolicy(2_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.REST_PROBING -> SamplingPolicy(1_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.REST_PAUSED -> SamplingPolicy(10_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.TRANSPORT -> SamplingPolicy(3_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.PAUSED -> SamplingPolicy(10_000, 0f, DesiredAccuracy.HIGH)
        TrackingState.ENDED -> SamplingPolicy(60_000, 0f, DesiredAccuracy.LOW_POWER)
    }
}
```

## 7. 轨迹写入策略

不同质量的点应采用不同写入策略。

```text
EXCELLENT / GOOD:
  进入 TrackPoint
  参与距离、速度、爬升统计
  可作为可信段的基础

WEAK:
  保存 RawPoint
  可作为辅助显示和弱信号诊断
  进入 weakTrackPoints / partial GPX
  不进入可信主轨迹，不参与可信距离和 movingTime

BAD:
  只保存 RawPoint
  不进入主轨迹
  不参与距离统计

DRIFT:
  只保存 RawPoint
  记录 drift event
  不进入主轨迹

GAP:
  标记内部 Segment / gapCount
  创建 GAP 或 WEAK_SIGNAL 事件
  后续移动恢复点使用 gap_recovery；静止恢复点使用 stationary_anchor_refined 替换原零距离 anchor
  最终轨迹线保持连续展示
  GAP 两端直线不计入可信距离

TRANSPORT:
  记录 RawPoint 和 decision
  不进入可信徒步距离
  后续恢复点使用 transport_recovery
  最终轨迹线可连续展示，其中交通工具混入段用红色线表达，extension 必须保留 transport 语义
```

距离统计规则：

```text
只累计可信点之间的移动距离
停留状态下的小范围漂移不累计
异常速度不累计
长时间断点不按直线累计为真实距离
弱点、REST 探测点、交通工具点不进入可信距离
```

## 8. 轨迹分段

分段的目的不是为了存储方便，而是为了把一次徒步解释成多个有意义的过程。

真实徒步可能包含：

```text
移动
休息
拍照
补给
爬升
下降
走错路
折返
弱信号
轨迹中断
恢复定位
```

第一版建议分段：

```text
MOVING:
  正常移动段

PAUSED:
  停留段

WEAK_SIGNAL:
  连续低质量定位段

GAP:
  长时间无有效定位段
```

第二阶段可增强：

```text
CLIMB:
  持续爬升段

DESCENT:
  持续下降段

ESTIMATED:
  中断后基于路线或前后点估算的段
```

第三阶段再考虑：

```text
BACKTRACK:
  折返或疑似走错路

OFF_ROUTE:
  偏离预设路线
```

## 9. 信号异常处理

### 9.1 有差点和没点是两类问题

```text
有 Location 但质量差:
  保存 RawPoint
  拒绝进入主轨迹
  记录 reject reason

没有 Location 回调:
  没有 RawPoint
  记录 no_location_timeout event
  不伪造点
```

### 9.2 异常段不要伪装成真实轨迹

两个点之间如果间隔过长，不应直接画成真实路线。

```text
10:01 A 点
10:20 B 点
```

中间 19 分钟没有定位时，最终轨迹可以连续显示；如果恢复点已经离开静止噪声范围，系统必须把恢复点标记为 `gap_recovery`，并且这段连接不计入可信距离。若恢复点仍属于静止锚点优化，则应使用 `stationary_anchor_refined` 替换原零距离 anchor，不生成新的线路段。UI/诊断应能显示它是 GAP 连接或锚点优化，而不是用户被连续定位证明走过的真实路径。

### 9.3 网络与定位解耦

徒步场景中网络差很常见。轨迹记录不能依赖实时上传成功。

```text
本地持续记录
本地队列持久化
网络恢复后批量上传
上传成功后标记 synced
失败则重试
```

定位采集失败和上传失败要分开表达：

```text
定位失败:
  没有可靠位置

上传失败:
  有本地记录，但暂时没有同步到服务端
```

## 10. 可信度输出

轨迹结束后不应只输出距离和耗时，还应输出可信度指标。

建议 summary：

```text
总距离
可信距离
估算距离
总耗时
移动耗时
停留耗时
累计爬升
累计下降
轨迹完整度
低精度区间数量
中断区间数量
漂移点数量
```

示例：

```text
总距离：12.8 km
可信距离：12.1 km
估算距离：0.7 km
总耗时：5h 20m
移动耗时：4h 35m
停留耗时：45m
轨迹完整度：94%
低精度区间：3 段
中断区间：1 段
```

## 11. 分阶段落地路线

### MVP：可靠记录

目标：

```text
采得到
存得住
传得上
后台不轻易断
```

范围：

- 原始点本地保存
- 前台服务或后台保活
- 网络失败后补传
- 基础采样策略
- 开始、暂停、结束
- 标准 GPX 或内部格式导出

### V1：点质量与主轨迹分离

目标：

```text
不要让坏点污染正式轨迹
```

范围：

- `RawPoint` / `TrackPoint` 分离
- `accuracy` 分级
- 异常速度过滤
- 长时间断点识别
- 低精度点弱化
- 停留漂移不累计距离

### V2：状态机与动态采样

目标：

```text
根据用户状态平衡连续性、精度和功耗
```

范围：

- `STARTING`
- `MOVING`
- `REST_CANDIDATE`
- `REST_PAUSED`
- `REST_PROBING`
- `PAUSED`
- `SIGNAL_WEAK`
- `TRANSPORT`
- 不同状态对应不同采样策略

### V3：分段与可信度

目标：

```text
让轨迹从一条线变成可解释的徒步过程
```

范围：

- 移动段
- 停留段
- 弱信号段
- 中断段
- 可信距离
- 估算距离
- 移动耗时
- 停留耗时
- 轨迹完整度

### V4：专业徒步增强

目标：

```text
让系统更理解山地与路线场景
```

范围：

- 地形识别
- 陡坡慢速容忍
- 海拔平滑
- 累计爬升修正
- 路线吸附
- 偏航提醒
- 折返识别
- 离线地图
- 弱网补偿

## 12. 第一版建议边界

第一版不要追求把所有智能能力做完。建议优先落地：

```text
1. 原始点全部保存
2. 点质量分级
3. RawPoint / TrackPoint 分离
4. MOVING / REST_CANDIDATE / REST_PAUSED / REST_PROBING / SIGNAL_WEAK 状态机
5. 坏点不进入主轨迹
6. 停留漂移不累计距离
7. 长时间无点标记 GAP
8. 轨迹结束输出基础可信度
```

暂缓：

```text
路线吸附
折返识别
复杂地形模型
自动补线
机器学习判断停留
高精度海拔融合
```

## 13. 总结

精密的徒步轨迹记录，不是更频繁地采点，而是根据定位质量和用户状态动态决定：

```text
采不采
信不信
存不存
算不算
怎么展示
如何证明
```

最终系统形态应该是：

```text
一个持续解释位置质量和用户状态的自适应轨迹引擎。
```
