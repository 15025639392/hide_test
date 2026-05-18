# 手机朝向可靠性规则

本文定义定位点方向箭头使用 `compass heading` 时的可靠性规则。这里的
`compass heading` 指手机传感器融合得到的设备朝向，不等同于 GNSS 行进方向。

## 目标

定位点上的方向箭头会被用户理解为“手机当前指向地图上的哪个方向”。当用户静止观察地图时，这个箭头会影响用户判断接下来往哪里走，因此只有在 heading 可靠时才显示强方向箭头。

## UI 语义

方向箭头分三类语义：

| 状态 | 方向来源 | UI 表达 | 含义 |
| --- | --- | --- | --- |
| 移动可靠 | GNSS course / 可信轨迹方向 | 强箭头 | 实际移动方向 |
| 静止且 heading 可靠 | compass heading | 强箭头或明确手机朝向箭头 | 手机指向地图方向 |
| heading 降级 | compass heading，但质量不足 | 半透明、灰色、扇形弱提示 | 仅供参考 |
| heading 不可靠 | 无 | 隐藏箭头 | 不给方向依据 |

如果没有目标路线或 waypoint，静止时箭头只表示手机朝向地图方向，不表示系统建议用户往哪里走。

## headingReliable 判定

静止时显示强方向箭头，必须满足 `headingReliable = true`。

推荐规则：

```text
headingReliable =
    sensorAccuracy >= SENSOR_STATUS_ACCURACY_MEDIUM
    && magneticNormMicroTesla in [20, 80]
    && headingCircularStdDev3s <= 15°
    && maxGyroNorm3s <= 0.5 rad/s
    && headingAgeMs <= 500
```

更保守的高可信状态：

```text
headingHighConfidence =
    sensorAccuracy == SENSOR_STATUS_ACCURACY_HIGH
    && magneticNormMicroTesla in [25, 65]
    && headingCircularStdDev3s <= 10°
    && maxGyroNorm3s <= 0.3 rad/s
    && headingAgeMs <= 500
```

任一关键条件失败时，不显示强箭头。

## 不可靠原因

建议诊断中记录 `headingReliability` 和 `headingUnreliableReason`。

可选 reason：

| reason | 含义 | 建议 UI |
| --- | --- | --- |
| `sensor_accuracy_low` | rotation vector / magnetic sensor 精度低 | 隐藏或弱化箭头 |
| `magnetic_norm_outlier` | 磁场强度异常，疑似磁干扰 | 隐藏箭头 |
| `heading_jitter` | 静止时 heading 抖动过大 | 弱化或隐藏箭头 |
| `device_rotating` | 手机正在快速旋转 | 暂停强箭头 |
| `heading_stale` | heading 数据过旧 | 隐藏箭头 |
| `sensor_unavailable` | 设备无可用 heading 传感器 | 隐藏箭头 |

## 角度稳定性计算

heading 抖动必须使用环形角度统计，不能直接对角度做普通标准差。

错误示例：

```text
359° 和 1° 被普通差值认为相差 358°
```

正确处理：

```text
delta = ((b - a + 540) % 360) - 180
```

`headingCircularStdDev3s` 使用最近 2-3 秒的 heading 样本计算。样本不足时应降级，不应显示强箭头。

## 地图方向转换

如果地图固定北向：

```text
arrowOnMapDegrees = compassHeadingDegrees
```

如果地图自身可旋转：

```text
arrowOnScreenDegrees = normalizeDegrees(compassHeadingDegrees - mapBearingDegrees)
```

地图旋转模式下，如果 heading 不可靠，应停止使用 heading 驱动地图或箭头旋转，避免整张地图和箭头一起误导用户。

## 与 GNSS course 的关系

移动可靠时优先使用 GNSS course 或轨迹方向：

```text
movingReliable =
    gnssSpeed >= 0.8-1.0 m/s
    && recentTrustedDistance >= 5m
    && recentAccuracyGood
```

推荐方向选择：

```text
if movingReliable:
    arrow = gnssCourseOrTrackHeading
    arrowState = strong
else if headingReliable:
    arrow = compassHeading - mapBearing
    arrowState = strong
else if headingDegraded:
    arrow = compassHeading - mapBearing
    arrowState = weak
else:
    hide arrow
```

静止时不要用 GPS 抖动产生的点间 bearing 作为强箭头。静止时如需显示方向，必须走 compass heading 的可靠性门控。

## 推荐诊断字段

后续落代码时可记录：

```text
headingDegrees
headingSource
headingReliability
headingUnreliableReason
sensorAccuracy
magneticNormMicroTesla
headingCircularStdDev3s
maxGyroNorm3s
headingAgeMs
mapBearingDegrees
arrowDisplayState
```

`arrowDisplayState` 建议取值：

```text
strong
weak
hidden
```

## 产品原则

1. 强箭头必须代表一个可被用户信任的方向依据。
2. 静止时没有目标方向，箭头只表示手机朝向地图方向，不表示路线建议。
3. heading 不可靠时宁可隐藏箭头，不显示看起来确定但可能偏差几十度的方向。
4. 定位点本身也要稳定；静止时应尽量使用稳定锚点，避免定位点漂移和 heading 误差叠加误导用户。
