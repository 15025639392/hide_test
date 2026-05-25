# AI 项目速读

本文件是 AI Agent 和飞书机器人的首读入口。开始编辑项目前先读本文件；需要细节时，
再按“推荐阅读顺序”打开权威文档。

## 项目一句话

这是一个轨迹策略原型项目。Android App 只是采样、验证和诊断底座；真正要沉淀的是
一个平台中立的轨迹计算函数：

```text
采样样本数据 -> 合理的轨迹 / 累计爬升 / 里程 / 配速 / 运动耗时
```

长期目标函数按三层收敛：

```text
Raw evidence
  -> 基础安全内核：合法性、采样归因、时间连续性、accuracy、GAP、速度、计距/计时/爬升门控
  -> 情景识别：停留漂移、同路往返、弱恢复端点、遮挡聚集、交通污染等
  -> 局部重建 / Settlement：改线、压缩、标注、解释、最终指标
```

基础安全内核必须长期保留；情景识别和局部重建不能绕过 RawPoint、RawPointDecision、
距离、运动时间、GPX 和高度门控。复杂产品语义应逐步收敛到六层情景策略和
Settlement，而不是继续扩散到 Android 实时链路或历史 Web 算法里。

## 目标函数

输入是来自真实设备的采样样本数据：

- 系统 `Location`
- 采样请求归因 `SamplingEpoch`
- 气压计样本
- 运动传感器摘要
- session、GAP、回调延迟和采样策略诊断上下文
- Android 可选 GNSS 质量诊断快照

输出是可解释、可复测的运动结果：

- 可信轨迹 TrackPoint 序列
- 累计爬升
- 里程
- 运动耗时
- 由里程和运动耗时推导出的配速
- 每个 raw point 的诊断解释

当前 Android 策略版本：

```text
stage2-track-trust-v3-sampling-cloud
```

当前治理游标：

```text
Phase 11 complete
```

## 当前策略链路

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

## 策略口径

- 每个系统 `Location` 必须先成为 `RawPoint`，并写入 `raw_location` 诊断证据。
- `SamplingIntake` 只做入口契约和硬性样本合法性校验。
- 被 `SamplingIntake` 拒绝的点只保留 raw_location 纯证据，由目标算法重放时解释，不写旧拒绝事件
  或 TrackPoint。
- 合法 `RawPoint` 才进入 `TrackTrustEngine / TrackCloudWindow`。
- 可信 GPX 只能包含可信的 `anchor` 和 `accept` TrackPoint。
- `weak` 和 `reject` 只作为诊断解释，不进入可信 GPX。
- v3 使用 `SamplingEpoch` 做采样归因，不再使用旧 location age 硬拒绝。
- `callbackDelayNanos` 只用于诊断展示，不作为判点硬门槛。
- 配速是目标输出指标，但当前实现可由 `totalDistanceMeters` 和 `movingTimeSeconds`
  推导，不要求已有独立持久化字段。

## 不可破坏规则

- 可信轨迹只能使用 `LocationManager.GPS_PROVIDER`。
- 被拒绝点和弱信号点仍然要保留为诊断证据。
- Replay 行为必须和真实记录行为一致。
- 当前 v3 是破坏式策略升级；历史 session 只作为历史产物，不作为新策略兼容目标。
- 弱 GPS 指标默认只用于解释，不参与策略硬判，除非任务明确要求改策略。
- 做清理或结构调整时，不要顺手改阈值、decision result、decision reason、
  segment 逻辑、距离、运动时间、GPX 输出或诊断 schema。
- 如果要改策略阈值，必须同一变更内更新文档、回放样本、测试和 strategy version。

## 当前成熟度

综合函数目标成熟度：`6.8 / 10`

- Android 验证实现成熟度：`7.5 / 10`
- 平台中立函数 / SDK 准备度：`4.0 / 10`

已具备：

- 系统 GNSS 采样、前台记录服务、session 输出。
- RawPoint、SamplingEpoch、SamplingIntake、TrackTrustEngine、TrackCloudWindow。
- 可信 GPX、partial GPX、`session.json`、`evidence.jsonl`。
- 弱 GPS 报告、徒步样本报告、replay runner。
- replay fixtures、单元测试和多设备爬升验收 Web 工具。

主要缺口：

- 真实多设备徒步样本不足。
- 弱 GPS、长 GAP、休息恢复、城市峡谷、山谷、隧道/室内出口等真实场景覆盖不足。
- 真实问题还需要继续沉淀成 replay fixtures。
- 平台中立函数契约和 SDK 封装尚未冻结。
- 鸿蒙 / iOS 还没有跑同一批 replay 样本做对齐。

## 推荐阅读顺序

1. `README.md` - 给人和机器人看的快速概览。
2. `docs/technical-debt-governance-plan.md` - 架构、不变量、已完成阶段和验证规则。
3. `docs/system-gnss-track-recording-plan.md` - 当前 GNSS 记录策略。
4. `docs/diagnostic-jsonl-schema.md` - 诊断 JSONL schema。
5. `docs/outdoor-track-six-layer-model.md` - 六层目标函数模型。
6. `docs/outdoor-track-scenario-recognizers.md` - 情景识别和局部重建规则。
7. `docs/outdoor-track-v17-conflict-aware-settlement-plan.md` - V17 密集区保方向候选仲裁计划。
8. `docs/platform-neutral-track-engine-contract.md` - 平台中立函数契约。
9. `docs/cross-platform-migration-prompt-engineering.md` - 跨平台迁移提示词工程。
10. `docs/` 下的专题文档 - 只在任务涉及对应主题时阅读。

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

下一步重点不是继续大范围重构，也不是打磨 UI，而是证明目标函数可靠：

- 多台 Android 真机同路线采样。
- 对比 `session.json`、`evidence.jsonl`、`track.gpx`、弱 GPS 报告和样本报告。
- 使用 `acceptance-web/` 验证多设备气压计累计爬升一致性。
- 从真实 session 中补充 replay fixtures，覆盖弱 GPS、长 GAP、休息恢复、
  城市峡谷、山谷、隧道/室内出口和疑似交通工具移动。
- 将已验证规则整理为平台中立函数契约，再考虑 SDK 封装和鸿蒙 / iOS 适配。
