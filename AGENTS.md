# AI 项目速读

本文件是 AI Agent 和飞书机器人的首读入口。开始编辑项目前，先读本文件；
需要细节时，再按下方顺序阅读权威文档。

## 项目快照

这是一个 Android Java 项目，用于纯系统 GNSS 徒步轨迹记录和诊断。App 从
`LocationManager.GPS_PROVIDER` 采集位置，把原始证据写入 `diagnostic.jsonl`，
经过 App 侧校验和判点策略后，把可信 `TrackPoint` 写入 `session.json`，
并导出 GPX、弱 GPS 报告和爬升一致性验收数据。

## 项目定位与终极目标

本项目是策略原型项目，不追求 UI 体验或普通用户完整产品形态。当前 Android
工程是策略验证底座，不是最终唯一承载平台。

终极目标是先做成一套真实徒步场景下可解释、可复测、可迭代的 Android GNSS
轨迹策略验证系统；当策略被真实样本验证稳定后，再沉淀为可集成的轨迹策略 SDK，
供鸿蒙 / iOS 等平台接入：

- 户外徒步时，即使遇到弱 GPS、静止漂移、长时间 GAP、休息、城市峡谷、
  山谷或疑似交通工具移动，也能判断哪些点应进入可信轨迹、哪些点只能作为诊断证据。
- 能导出策略验证所需的 `track.gpx`、`session.json`、`diagnostic.jsonl`、
  弱 GPS 报告和样本报告。
- 开发者和 AI 能通过 `diagnostic.jsonl`、session 报告、回放样本
  （replay fixtures）和
  多设备验收工具复现问题、比较策略、验证改动。
- 多台 Android 设备在同一路线下的距离、运动时间和气压计累计爬升具有可接受
  的一致性。
- 后续策略演进必须有真实样本、replay、测试和文档支撑，而不是靠主观调参。
- 策略最终应沉淀为 SDK：平台中立规则、输入输出契约、诊断 schema、
  回放样本集、平台适配接口和对齐工具都应作为 SDK 交付物的一部分。

## 策略迁移口径

迁移目标不是把当前 Android App 原样复制到鸿蒙 / iOS，而是输出可复用的轨迹
策略 SDK：

- SDK 核心层：`RawPoint`、GNSS 质量摘要、判点规则、距离 / 时间累计规则、
  segment 规则、诊断事件、报告字段、回放样本预期。
- SDK 平台适配层：定位权限、系统定位 Provider、卫星 / 气压计 / 运动传感器 API、
  后台采样限制、文件导出方式。
- SDK 工具层：diagnostic JSONL 输出、报告生成、回放样本 runner、Android 与目标平台
  结果对齐报告。
- 迁移前必须先冻结策略版本、核心诊断 schema 和回放样本预期。
- 鸿蒙 / iOS SDK 必须跑同一批回放样本，并用同路线真实设备采样对比 Android
  原型输出。
- 跨平台通过标准应关注判点结果、decision reason、距离、运动时间、segment、
  GAP 处理、弱 GPS 解释和爬升统计，而不是 UI 一致性。
- 稳定提示词工程见 `docs/cross-platform-migration-prompt-engineering.md`；
  迁移任务应优先使用该文档中的固定 prompt 顺序。

## 距离终极目标评分

综合终极目标评分：`6.8 / 10`

补充口径：

- Android 策略原型成熟度：`7.5 / 10`
- 跨平台迁移准备度：`4.0 / 10`

评分标准：

| 维度 | 权重 | 说明 | 当前判断 |
| --- | ---: | --- | --- |
| 核心策略链路完整度 | 20% | 是否打通系统 GNSS -> RawPoint -> 判点 -> TrackPoint -> GPX / session 的闭环。 | 基本完成 |
| 诊断可解释性 | 18% | 是否能解释弱 GPS、拒绝点、GAP、静止漂移、疑似交通工具等决策。 | 较完整 |
| 可复测能力 | 18% | 是否有回放样本（replay fixtures）、单元测试、报告和稳定验证命令。 | 有基础，但真实样本不足 |
| 多设备外场验证 | 18% | 是否用多台真实 Android 设备验证距离、运动时间、爬升一致性。 | 明显不足 |
| 策略演进治理 | 14% | 是否有不变量、变更规则、文档游标和策略版本约束。 | 较完整 |
| SDK 化与跨平台迁移准备度 | 12% | 是否已形成平台中立策略 SDK 契约，并能迁移到鸿蒙 / iOS。 | 早期 |

分数口径：

- `0 - 3`：只有想法或零散代码，不能形成可复测策略链路。
- `3 - 5`：核心采集或判点部分可运行，但诊断、导出、replay 不完整。
- `5 - 7`：端到端链路基本打通，有测试和文档，但外场验证不足。
- `7 - 8.5`：策略原型成熟，诊断和 replay 可用，但真实多设备样本还不够。
- `8.5 - 9.5`：多轮外场验证通过，真实回放样本充分，策略改动闭环稳定，
  并已形成平台中立 SDK 契约。
- `9.5 - 10`：接近研究/工程基准项目，可长期用真实数据驱动策略演进，
  并能通过鸿蒙 / iOS SDK 复现核心策略行为。

评分依据：

- `+` 核心记录链路已经打通：前台服务、系统 GNSS、RawPoint、TrackPoint、
  GPX、历史 session、诊断日志、弱 GPS 报告都已具备。
- `+` 技术债治理计划已推进到 `Phase 11 complete`，主要架构清理和报告能力
  已完成。
- `+` 已有回放样本（replay fixtures）和单元测试，策略不是完全靠真机黑盒试错。
- `+` 已有 `acceptance-web/`，可以做多设备气压计爬升一致性验收。
- `-` 还缺足够多的真实多设备徒步样本，尤其是复杂弱 GPS 和长 GAP 场景。
- `-` 还需要系统性真机采样验证，确认核心记录、导出和诊断产物稳定生成。
- `-` 回放样本还需要从真实 session 中继续补充，覆盖更多地形和设备。
- `-` 策略泛化能力还需要连续多轮外场验证来证明。
- `-` 还没有把策略抽成平台中立 SDK 契约，也没有鸿蒙 / iOS SDK 适配实现和对齐验证。

为什么综合是 `6.8 / 10`：

项目已经超过“能跑通 demo”的阶段：记录、诊断、导出、报告、replay、治理文档都
存在，并且治理游标已经到 `Phase 11 complete`。但它还没有足够真实外场数据来
证明策略在多设备、多地形、长 GAP、弱 GPS 和休息恢复场景下稳定泛化；同时跨平台
迁移还停留在 SDK 目标和契约准备阶段。因此 Android 原型可给 `7.5 / 10`，但把
鸿蒙 / iOS SDK 纳入终极目标后，综合评分应下调到 `6.8 / 10`。

到 `8.5 / 10` 的关键条件：

- 至少完成多台 Android 设备的同路线徒步验收。
- 将真实 session 中的典型弱 GPS / GAP / 休息恢复场景沉淀为回放样本。
- 验证所有核心导出物：`session.json`、`diagnostic.jsonl`、`track.gpx`、
  弱 GPS 报告、样本报告。
- 修掉真机验证中暴露的主要记录、导出和诊断数据问题。
- 输出平台中立 SDK 契约草案，明确鸿蒙 / iOS 需要实现哪些输入、输出和诊断字段。

到 `9.5 / 10` 的关键条件：

- 多轮外场测试稳定通过，跨设备距离、运动时间和爬升误差进入目标范围。
- 策略变更都有真实样本、replay、单元测试和文档闭环。
- 研发人员能稳定完成采样、导出、报告分析和问题复现。
- 鸿蒙 / iOS 至少完成一个平台的策略 SDK 原型，并能跑同一批回放样本做结果对齐。
- AI / 飞书机器人能根据项目文档和诊断产物快速定位下一步工作。

当前策略版本：

```text
stage1-gnss-track-v2-rest-state
```

当前治理游标：

```text
Phase 11 complete
```

## 推荐阅读顺序

1. `README.md` - 给人和机器人看的快速概览。
2. `docs/technical-debt-governance-plan.md` - 权威执行顺序、不变量、
   已完成阶段和验证规则。
3. `docs/system-gnss-track-recording-plan.md` - 当前 GNSS 记录策略。
4. `docs/diagnostic-jsonl-schema.md` - 给工具读取的诊断 JSONL schema。
5. `docs/cross-platform-migration-prompt-engineering.md` - 鸿蒙 / iOS 迁移提示词工程。
6. `docs/` 下的专题文档 - 只在任务涉及对应主题时阅读。

## 不可破坏规则

- 可信轨迹只能使用 `LocationManager.GPS_PROVIDER`。
- 每个系统 `Location` 必须先成为 `RawPoint`，再进入策略判定。
- 被拒绝点和弱信号点仍然要保留为诊断证据。
- 可信 GPX 只能包含可信的 `anchor` 和 `accept` TrackPoint。
- 弱 GPS 指标默认只用于解释，不参与策略硬判，除非任务明确要求改策略。
- 必须兼容旧 session 和旧 `diagnostic.jsonl`。
- Replay 行为必须和真实记录行为一致。
- 做清理或结构调整时，不要顺手改阈值、decision result、decision reason、
  segment 逻辑、距离、运动时间、GPX 输出或诊断 schema。

## 关键路径

| 区域 | 路径 |
| --- | --- |
| Android 原型入口 | `app/src/main/java/com/example/gnsssatdemo/MainActivity.java` |
| 前台记录服务 | `app/src/main/java/com/example/gnsssatdemo/RecordingForegroundService.java` |
| Session 编排 | `app/src/main/java/com/example/gnsssatdemo/track/engine/BasicTrackSession.java` |
| 策略阈值 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackStrategyConfig.java` |
| 位置校验策略 | `app/src/main/java/com/example/gnsssatdemo/track/engine/LocationValidator.java` |
| 判点策略 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackDecisionEngine.java` |
| 共享判点协调器 | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackDecisionCoordinator.java` |
| GPX 和 session 导出 | `app/src/main/java/com/example/gnsssatdemo/track/export/` |
| Replay 运行器 | `app/src/main/java/com/example/gnsssatdemo/track/replay/` |
| 回放样本（replay fixtures） | `app/src/test/resources/replay-fixtures/` |
| 爬升验收 Web 工具 | `acceptance-web/` |

## 验证命令

Android 代码或策略变更：

```bash
source scripts/use-jdk17.sh
./gradlew testDebugUnitTest
./gradlew :app:runReplay
```

爬升验收 Web 工具：

```bash
cd acceptance-web
npm test
```

纯文档改动不要求跑完整测试，但完成前要检查 diff。

## 当前还需要做什么

原治理计划已完成到 Phase 11。下一步重点不是继续大范围重构，也不是打磨 UI
体验，而是策略验证和诊断闭环：

- 在多台 Android 真机上跑真实徒步记录，比较导出的 `session.json`、
  `diagnostic.jsonl`、`track.gpx`、报告文本和报告 JSON。
- 使用 `acceptance-web/` 对比多设备气压计累计爬升一致性。
- 从真实弱 GPS、山谷、城市峡谷、休息、隧道、疑似交通工具等 session 中补充
  回放样本。
- 把已验证策略整理成平台中立 SDK 契约，为后续鸿蒙 / iOS SDK 做准备。
- 使用 `docs/cross-platform-migration-prompt-engineering.md` 输出鸿蒙 / iOS 迁移任务提示词。
- 只有策略验证或诊断链路需要时才继续瘦身 `MainActivity`，避免为了重构而重构。
- 根据真机验证反馈改进诊断报告字段、报告文案和导出数据完整性。
- 如果要改策略阈值，必须同一变更内更新文档、回放样本、测试和
  strategy version。
