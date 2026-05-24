# 弱 GPS 相关 GitHub 调研

调研日期：2026-05-18

本文只服务当前 Android 系统 GNSS 徒步记录项目。重点不是把弱 GPS 轨迹“修成正常”，而是把弱信号证据采全、解释清楚，并避免弱信号点污染可信距离。

## 当前判断

当前项目已经有第一阶段弱信号口径：

- `accuracy > 30m` 的移动中点进入 `weak_signal_stage2`。
- `accuracy > 80m` 硬拒绝。
- weak 点进入诊断和 `partial.gpx`，不参与可信距离。
- 长时间无定位通过 `gap_recovery` 表达，恢复点 delta 为 0。
- Android 可选 `gnss_snapshot` 诊断可保留卫星质量 summary。

后续弱 GPS 能力只作为 Android 可选诊断附录维护，而不是目标算法输入或“自动修复轨迹”。

## 优先参考项目

| 项目 | 类型 | 许可证 | 主要价值 | 接入判断 |
| --- | --- | --- | --- | --- |
| [GPSTest](https://github.com/barbeau/gpstest) | Android GNSS 测试 App | Apache-2.0 | 卫星状态、星座、频点、信号强度、日志格式、弱信号 UI | 高优先级参考，不直接引入 |
| [Google GPS Measurement Tools](https://github.com/google/gps-measurement-tools) | Android GNSS Logger + 分析工具 | Apache-2.0 | Raw GNSS 采集、CN0 可视化、伪距、WLS、residual 分析 | 高优先级参考，不进入主记录链路 |
| [Android Network Survey](https://github.com/christianrowlands/android-network-survey) | Android 网络/GNSS survey | Apache-2.0 | 野外 survey 记录、GNSS 状态导出、设备环境数据 | 参考采集与导出工作流 |
| [google-gnss-logger](https://github.com/gscatto/google-gnss-logger) | Google GNSS Logger 格式解析 | MIT | 解析 Google GNSS Logger 文本、按星座和频段统计平均 CN0 | 适合离线兼容工具 |
| [GNSS Compare](https://github.com/TheGalfins/GNSS_Compare) | Android raw GNSS 处理框架 | Apache-2.0 | raw GNSS 到定位解算的实验框架 | 研究参考，项目较旧 |
| [gnss_lib_py](https://github.com/Stanford-NavLab/gnss_lib_py) | Python GNSS 分析 | MIT | GNSS 数据解析、WLS/EKF、residual、可视化 | 离线分析参考 |
| [GNSS Multipath Analysis Software](https://github.com/paarnes/GNSS_Multipath_Analysis_Software) | RINEX 多路径分析 | MIT | 多路径、SNR、周跳、遮挡研究 | 专业离线研究，不进 App |
| [android_rinex](https://github.com/rokubun/android_rinex) | Android GNSS Logger 转 RINEX | Apache-2.0 | 把 Android raw GNSS 日志转标准 RINEX | 未来 raw GNSS 研究辅助 |
| [androidGnss](https://github.com/AILocAR/androidGnss) | Android raw GNSS 后处理 | Apache-2.0 | 噪声抑制、MHE/EKF/RTS smoother | 后处理研究，不进入可信轨迹 |
| [GNSS-SDR](https://github.com/gnss-sdr/gnss-sdr) | 软件定义 GNSS 接收机 | GPL-3.0 | 理解 acquisition/tracking 与弱信号底层机制 | 理论参考，不接入 |

## 对本项目最有用的信号字段

如果保留 Android 可选 GNSS 诊断附录，优先补充到 `gnss_snapshot`
或 `evidence.jsonl` summary：

- `visibleTotal`: 可见卫星数。
- `usedInFixTotal`: 参与定位卫星数。
- `usedAvgCn0`: 参与 fix 卫星平均 C/N0。
- `allAvgCn0`: 全部可见卫星平均 C/N0。
- `top4AvgCn0`: C/N0 最高四颗卫星平均值。
- `lowCn0VisibleCount`: C/N0 低于阈值的可见卫星数。
- `weakUsedCount`: 参与 fix 但 C/N0 偏低的卫星数。
- `constellationUsed`: GPS / BeiDou / Galileo / GLONASS / QZSS 参与 fix 数。
- `constellationVisible`: 各星座可见数。
- `hasDualFrequency`: 是否观测到 L5/E5/B2 等双频信号。
- `gnssQualityStale`: Location 匹配到的 GNSS snapshot 是否过旧。

若后续读取 `GnssMeasurementsEvent`，可作为高级诊断字段：

- `cn0DbHz`
- `carrierFrequencyHz`
- `multipathIndicator`
- `pseudorangeRateMetersPerSecond`
- `receivedSvTimeNanos`
- `state`
- `accumulatedDeltaRangeState`
- `automaticGainControlLevelDb`

第一阶段不要把这些 raw measurement 字段放进判点硬规则。先采样、导出、对照真实弱信号样本，再决定阈值。

## 推荐落地路径

### 第一阶段：增强 snapshot summary

保持当前纯系统 GNSS 主链路，只增强诊断：

```text
GnssStatus
  -> optional gnss_snapshot diagnostic event
  -> weak_gnss_report / sample_report 可选汇总
```

建议新增报告维度：

- weak 点发生时的 `usedInFixTotal`、`usedAvgCn0`、`top4AvgCn0`。
- GAP 前 30 秒与恢复后 30 秒的卫星质量变化。
- `weak_signal_stage2` 与 `accuracy`、C/N0、used satellite count 的对应分布。
- `gnssQualityStale` 占比。
- 各星座参与 fix 情况。

### 第二阶段：弱信号报告

新增离线报告，不改变 App 判点：

```text
session.json + evidence.jsonl
  -> weak_gnss_report.txt
```

报告回答：

- 这段轨迹弱 GPS 是由低 C/N0、低 used satellite count、长 GAP，还是系统后台采样造成。
- weak 点是否集中在某段路线。
- rejected 点是否有明显卫星质量解释。
- 交通工具混入是否和卫星质量无关。
- 是否存在 GNSS snapshot 过旧导致的解释缺口。

### 第三阶段：可选 raw GNSS 实验

只有在 summary 不够解释真实样本时，再考虑 `GnssMeasurementsEvent`：

```text
GnssMeasurementsEvent
  -> raw_gnss_measurement diagnostic event
  -> 离线 Python 分析
  -> RINEX / Google GNSS Logger 兼容导出
```

这一阶段可以参考 Google GPS Measurement Tools、android_rinex、gnss_lib_py。它不应成为第一阶段真机记录的阻塞项。

## 不建议做的事

- 不要用弱 GPS 工具自动生成“可信补点”。
- 不要把 raw GNSS 后处理结果混入 `track.gpx` 的可信距离。
- 不要为了接入 Google Fused Location 而破坏当前纯 `GPS_PROVIDER` 口径。
- 不要在没有真实样本校准前，把 C/N0 或 satellite count 写成硬拒绝规则。
- 不要把 SDR、RINEX、多路径分析工具放进 Android App。

## 与当前判点口径的关系

弱 GPS 诊断只能解释决策，不能替代决策：

| 当前 reason | 弱 GPS 诊断应补充什么 |
| --- | --- |
| `weak_signal_stage2` | 首点 accuracy 偏弱时的 used satellite count、top4 CN0、星座分布 |
| `weak_signal_stage2` | weak 点附近的 CN0 下降、used 卫星变化、snapshot 是否 stale |
| `gap_recovery` | GAP 前后是否存在无卫星、低 CN0、后台无回调或 snapshot 中断 |
| `weak_signal_stage2` | 是否同时伴随低 C/N0 或 used satellite count 下降，辅助区分漂移和真实高速 |
| `transport_suspected` | 证明其主要由速度证据触发，而不是弱 GPS 误判 |
| `stationary_cloud_jitter` | 静止小漂移是否伴随弱 C/N0 或低 used satellite count |

## 建议优先级

1. 参考 GPSTest，增强当前卫星质量展示和 diagnostic 字段。
2. 参考 Google GPS Measurement Tools，保留未来 raw GNSS 日志兼容方向。
3. 在 `HikingSampleReportGenerator` 增加弱 GPS 统计块。
4. 只在真实样本显示 summary 不够时，再做 raw GNSS/RINEX 离线实验。

## 核心结论

弱 GPS 能力不是修轨迹，而是在需要真机复盘时让 weak、reject、GAP 有卫星质量解释。

当前项目应继续坚持：

```text
RawPoint 全量保存
TrackPoint 只接受可信点
weak 点可诊断但不累计距离
GAP 恢复点保持连续显示但 delta 为 0
GNSS 质量仅用于可选解释和报告，不进入 Web 目标算法判点，也不改写可信轨迹
```
