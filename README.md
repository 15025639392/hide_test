# Device Fix

纯系统 GNSS 徒步轨迹记录 Android Java 项目，包含弱 GPS 诊断、GPX 导出、
离线 replay 验证和多设备爬升一致性验收工具。

## 项目定位与终极目标

本项目是策略原型项目，不追求 UI 体验或普通用户完整产品形态。当前 Android
工程是策略验证底座，不是最终唯一承载平台。

终极目标是做成一套真实徒步场景下可解释、可复测、可迭代的 Android GNSS
轨迹策略验证系统；当策略被真实样本验证稳定后，再沉淀为可集成的轨迹策略 SDK，
供鸿蒙 / iOS 等平台接入。

它最终应该做到：

- 户外徒步时，在弱 GPS、静止漂移、长时间 GAP、休息、城市峡谷、山谷或
  疑似交通工具移动等复杂场景下，仍能判断哪些点应进入可信轨迹。
- 可信轨迹连续、不过度累计距离，GPX 可用于策略查看、归档和对比。
- 每个被接受、弱化或拒绝的位置点都有诊断证据，方便解释和复盘。
- 真实设备问题可以通过 `diagnostic.jsonl`、session 报告、回放样本
  （replay fixtures）
  和验收工具复现。
- 多台 Android 设备在同一路线下的距离、运动时间和气压计累计爬升保持可接受
  的一致性。
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

项目已经完成核心链路和主要治理清理，但还缺真实外场样本、多设备验证和策略
复测闭环。

加分项：

- 前台服务、系统 GNSS、RawPoint、TrackPoint、GPX、历史 session、诊断日志、
  弱 GPS 报告已经具备。
- 技术债治理计划已完成到 `Phase 11 complete`。
- 已有回放样本（replay fixtures）、单元测试和 replay 验证命令。
- 已有 `acceptance-web/` 用于多设备气压计爬升一致性验收。

主要差距：

- 真实多设备徒步样本还不够，复杂弱 GPS、长 GAP、休息恢复、城市峡谷等场景
  需要继续沉淀。
- 需要系统性真机采样验证，确认核心记录、导出和诊断产物稳定生成。
- 需要把真实问题转成回放样本，形成策略迭代闭环。
- 策略泛化能力还需要多轮外场验证证明。
- 还没有把策略抽成平台中立 SDK 契约，也没有鸿蒙 / iOS SDK 适配实现和对齐验证。

为什么综合是 `6.8 / 10`：

项目已经超过“能跑通 demo”的阶段：记录、诊断、导出、报告、replay、治理文档都
存在，并且治理游标已经到 `Phase 11 complete`。但它还没有足够真实外场数据来
证明策略在多设备、多地形、长 GAP、弱 GPS 和休息恢复场景下稳定泛化；同时跨平台
迁移还停留在 SDK 目标和契约准备阶段。因此 Android 原型可给 `7.5 / 10`，但把
鸿蒙 / iOS SDK 纳入终极目标后，综合评分应下调到 `6.8 / 10`。

到 `8.5 / 10`，需要完成多设备同路线徒步验收、补真实回放样本、
验证所有核心导出物，修掉主要记录、导出和诊断数据问题，并输出平台中立 SDK
契约草案。

到 `9.5 / 10`，需要多轮外场测试稳定通过，策略变更都有真实样本、replay、
测试和文档闭环，研发人员能稳定完成采样、导出、报告分析和问题复现；鸿蒙 /
iOS 至少完成一个平台的策略 SDK 原型，并能跑同一批回放样本做结果对齐。

## 当前状态

- 策略版本：`stage2-track-trust-v3-sampling-cloud`
- 治理游标：`Phase 11 complete`
- 主 App：`app/`
- 本地爬升验收工具：`acceptance-web/`
- AI / 飞书机器人入口：`AGENTS.md`

当前项目已经具备完整记录链路：

```text
RecordingForegroundService
  -> LocationManager.GPS_PROVIDER
  -> RawPoint / GNSS Snapshot / diagnostic.jsonl
  -> SamplingEpoch / SamplingIntake
  -> TrackTrustEngine / TrackCloudWindow
  -> virtual-coordinate TrackPoint / session.json
  -> track.gpx / partial.gpx
  -> 弱 GPS 报告 / 样本报告 / replay 报告
```

## App 做什么

- 使用 Android 系统 `GPS_PROVIDER` 记录真实徒步轨迹。
- 即使位置点被拒绝或判为弱信号，也保留原始 GNSS / Location 证据。
- 区分诊断层 `RawPoint` 和可信轨迹层 `TrackPoint`。
- 过滤弱 GPS、静止漂移、不可能跳点、疑似交通工具移动和长时间 GAP，同时保留解释证据。
- 导出可信 GPX 和部分诊断 GPX。
- 生成弱 GPS 报告和徒步样本报告。
- 通过 JSONL 回放样本（fixtures）做离线 replay，方便检查策略改动。
- 提供本地 Web 工具，对比多设备气压计累计爬升一致性。

## 重要文档

| 目的 | 文档 |
| --- | --- |
| AI 执行规则和项目状态 | `AGENTS.md` |
| 架构、不变量、已完成阶段 | `docs/technical-debt-governance-plan.md` |
| 当前 GNSS 记录策略 | `docs/system-gnss-track-recording-plan.md` |
| 诊断 JSONL schema | `docs/diagnostic-jsonl-schema.md` |
| 鸿蒙 / iOS 迁移提示词工程 | `docs/cross-platform-migration-prompt-engineering.md` |
| 弱 GPS 研究笔记 | `docs/weak-gps-github-research.md` |
| 气压计爬升验收目标 | `docs/barometer-ascent-consistency-targets.md` |
| 爬升验收 Web 使用说明 | `acceptance-web/README.md` |

## 构建和测试

Android 单元测试：

```bash
source scripts/use-jdk17.sh
./gradlew testDebugUnitTest
```

Replay 验证：

```bash
source scripts/use-jdk17.sh
./gradlew :app:runReplay
```

爬升验收 Web 测试：

```bash
cd acceptance-web
npm test
```

运行爬升验收 Web：

```bash
cd acceptance-web
npm run dev
```

默认本地地址：

```text
http://localhost:4173
```

## 当前还需要做什么

计划内治理清理已经完成到 Phase 11。后续应重点补验证证据和策略复测闭环：

- 真机采样验证：记录、休息/暂停、结束、历史记录、GPX 导出、诊断导出、
  弱 GPS 报告导出、样本报告导出。
- 多设备徒步，使用 `acceptance-web/` 验证气压计累计爬升一致性。
- 从真实导出 session 中补充更多回放样本，尤其是弱 GPS、长 GAP、
  休息恢复、城市峡谷、隧道/室内出口、疑似交通工具移动。
- 把已验证策略整理成平台中立 SDK 契约，为后续鸿蒙 / iOS SDK 做准备。
- 使用 `docs/cross-platform-migration-prompt-engineering.md` 输出鸿蒙 / iOS 迁移任务提示词。
- 根据真机验证中暴露的问题改进诊断报告字段、报告文案和导出数据完整性。
- 阅读真实弱 GPS 报告和爬升报告后，补充可复现回放样本。
- 策略阈值变更必须同时具备回放样本、测试、文档和新的 strategy version。
