# Device Fix

这是一个轨迹策略原型项目。当前 Android App 不是最终产品形态，而是用来采集真实
徒步样本、生成诊断证据、回放验证策略的工程底座。

## 终极目标

项目最终要沉淀的是一个可复用的轨迹计算函数：

```text
采样样本数据 -> 合理的轨迹 / 累计爬升 / 里程 / 配速 / 运动耗时
```

也就是说，核心价值不是 UI，也不是 Android App 本身，而是：给定一批来自真实设备的
采样样本，函数能判断哪些点可信、哪些点只能作为诊断证据，并输出符合真实徒步直觉的
运动结果。

## 输入

采样样本数据包括：

- 系统 `Location`：位置、精度、速度、海拔、fix 时间等。
- 采样请求归因：`SamplingEpoch`、采样状态、请求间隔和请求距离。
- 气压计样本：用于计算或校验累计爬升。
- 运动传感器摘要：用于解释静止、慢速移动、休息和恢复。
- 诊断上下文：session 起点、GAP、回调延迟、采样策略切换和异常事件。
- Android 可选诊断附录：GNSS snapshot、卫星数量、C/N0、used-in-fix 状态和快照新鲜度。

每个系统 `Location` 必须先写成 `RawPoint` 和 `raw_location` 诊断证据，然后才进入
策略链路。GNSS 质量附录不作为 Web 目标算法的判点输入，不改变目标轨迹、距离、
GAP、segment 或 GPX。

## 输出

目标函数应输出：

- `轨迹`：可信 TrackPoint 序列，可导出为可信 GPX。
- `累计爬升`：优先使用气压计，必要时结合 GNSS 海拔作为对照。
- `里程`：只累计可信徒步移动距离。
- `配速`：由里程和运动耗时推导，不要求当前持久化为独立字段。
- `运动耗时`：只统计可信徒步移动时间，不把休息、漂移或交通工具移动混入。
- `诊断解释`：每个 raw point 都能解释为 accepted、weak、reject 或 intake rejected。

## 当前实现

当前策略版本：

```text
stage2-track-trust-v3-sampling-cloud
```

当前 Android 验证链路：

```text
RecordingForegroundService
  -> LocationManager.GPS_PROVIDER
  -> RawPoint / raw_location / optional GNSS diagnostics
  -> SamplingEpoch / SamplingIntake
  -> TrackTrustEngine / TrackCloudWindow
  -> TrackPoint / session.json
  -> track.gpx / partial.gpx
  -> 弱 GPS 报告 / 样本报告 / replay 报告
```

关键口径：

- `SamplingIntake` 只做入口契约和硬性样本合法性校验。
- 被 `SamplingIntake` 拒绝的点只保留 raw_location 纯证据，由目标算法重放时解释，不写旧拒绝事件
  或 TrackPoint。
- 合法 `RawPoint` 才进入 `TrackTrustEngine` 和 `TrackCloudWindow`。
- 可信 GPX 只能包含可信的 `anchor` 和 `accept` TrackPoint。
- `weak` 和 `reject` 只保留诊断解释，不进入可信 GPX。
- v3 使用 `SamplingEpoch` 做采样归因，不再使用旧的 location age 硬拒绝。
- `callbackDelayNanos` 只用于诊断展示，不作为判点硬门槛。

## 当前成熟度

综合函数目标成熟度：`6.8 / 10`

- Android 验证实现成熟度：`7.5 / 10`
- 平台中立函数 / SDK 准备度：`4.0 / 10`

已经具备：

- 系统 GNSS 采样、前台记录服务和 session 文件输出。
- RawPoint、SamplingEpoch、SamplingIntake、TrackTrustEngine、TrackCloudWindow。
- 可信 GPX、partial GPX、`session.json`、`evidence.jsonl`。
- 弱 GPS 报告、徒步样本报告、replay runner。
- 多设备气压计累计爬升验收 Web 工具。
- 单元测试、replay fixtures 和基础治理文档。

主要缺口：

- 真实多设备徒步样本仍不足。
- 弱 GPS、长 GAP、休息恢复、城市峡谷、山谷、隧道/室内出口等场景还需要更多真实样本。
- 还需要把真实问题沉淀成 replay fixtures，形成稳定复测闭环。
- 平台中立函数契约和 SDK 封装还没有冻结。
- 鸿蒙 / iOS 尚未跑同一批 replay 样本做对齐。

## 不可破坏规则

- 可信轨迹只能使用 `LocationManager.GPS_PROVIDER`。
- 每个系统 `Location` 必须先成为 `RawPoint` 并写入 `raw_location`。
- 被拒绝点和弱信号点仍然要保留为诊断证据。
- Replay 行为必须和真实记录行为一致。
- 做清理或结构调整时，不要顺手改阈值、decision result、decision reason、
  segment 逻辑、距离、运动时间、GPX 输出或诊断 schema。
- 如果要改策略阈值，必须同一变更内更新文档、回放样本、测试和 strategy version。

## 关键路径

| 区域 | 路径 |
| --- | --- |
| Android 入口 | `app/src/main/java/com/example/gnsssatdemo/MainActivity.java` |
| 前台记录服务 | `app/src/main/java/com/example/gnsssatdemo/RecordingForegroundService.java` |
| Session 编排 | `app/src/main/java/com/example/gnsssatdemo/track/engine/BasicTrackSession.java` |
| 采样入口校验 | `app/src/main/java/com/example/gnsssatdemo/track/engine/SamplingIntake.java` |
| 点云窗口 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackCloudWindow.java` |
| 轨迹可信引擎 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustEngine.java` |
| 策略阈值 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustConfig.java` |
| GPX 和 session 导出 | `app/src/main/java/com/example/gnsssatdemo/track/export/` |
| Replay 运行器 | `app/src/main/java/com/example/gnsssatdemo/track/replay/` |
| 回放样本 | `app/src/test/resources/replay-fixtures/` |
| 爬升验收 Web | `acceptance-web/` |

## 重要文档

| 目的 | 文档 |
| --- | --- |
| AI 首读入口 | `AGENTS.md` |
| 架构、不变量、治理阶段 | `docs/technical-debt-governance-plan.md` |
| 当前 GNSS 记录策略 | `docs/system-gnss-track-recording-plan.md` |
| 诊断 JSONL schema | `docs/diagnostic-jsonl-schema.md` |
| 跨平台迁移提示词工程 | `docs/cross-platform-migration-prompt-engineering.md` |
| 弱 GPS 研究笔记 | `docs/weak-gps-github-research.md` |
| 气压计爬升验收目标 | `docs/barometer-ascent-consistency-targets.md` |
| 爬升验收 Web 说明 | `acceptance-web/README.md` |

## 验证命令

Android 代码或策略变更：

```bash
source scripts/use-jdk17.sh
./gradlew testDebugUnitTest
./gradlew :app:runReplay
```

爬升验收 Web：

```bash
cd acceptance-web
npm test
```

纯文档改动不要求跑完整测试，但完成前要检查 diff。

## 下一步

当前重点不是继续大范围重构，也不是打磨 UI，而是证明这个轨迹计算函数可靠：

- 用多台 Android 真机采集同路线徒步样本。
- 对比 `session.json`、`evidence.jsonl`、`track.gpx`、弱 GPS 报告和样本报告。
- 使用 `acceptance-web/` 验证多设备气压计累计爬升一致性。
- 从真实 session 中补充 replay fixtures，覆盖弱 GPS、长 GAP、休息恢复、
  城市峡谷、山谷、隧道/室内出口和疑似交通工具移动。
- 把已验证规则整理成平台中立函数契约，再考虑 SDK 封装和鸿蒙 / iOS 适配。
