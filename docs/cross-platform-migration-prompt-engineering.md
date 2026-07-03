# 跨平台迁移提示词工程

本文用于把当前 Android 策略原型沉淀为可集成的轨迹策略 SDK，并迁移到鸿蒙 /
iOS。它不是一次性聊天提示词，
而是一套稳定提示词工程：让 AI 按固定顺序抽取策略、定义平台中立契约、
实现平台适配、跑回放样本对齐，并输出可审查结果。

## 使用前提

迁移前必须先读：

1. `AGENTS.md`
2. `README.md`
3. `docs/technical-debt-governance-plan.md`
4. `docs/system-gnss-track-recording-plan.md`
5. `docs/diagnostic-jsonl-schema.md`
6. `docs/platform-neutral-evidence-jsonl-contract.md`
7. `docs/platform-adapter-field-mapping.md`
8. `docs/platform-neutral-track-engine-contract.md`
9. `docs/track-sdk-public-api-contract.md`
10. `docs/streaming-scenario-window-settlement-plan.md`
11. `docs/review-queue-ai-alignment-prompt.md`

迁移的对象是“轨迹策略 SDK”，不是 Android UI，也不是当前 App 的完整产品形态。
最终产物应是可被鸿蒙 / iOS App 集成的 SDK，而不是另一个完整 App。

## SDK 产物口径

目标 SDK 至少包含三层：

- SDK 核心层：平台中立模型、策略配置、位置校验、判点引擎、距离 / 时间累计、
  segment 规则、休息 / GAP / 弱 GPS 处理。
- SDK 平台适配层：鸿蒙 / iOS 的定位、卫星、气压计、运动传感器、单调时钟、
  后台采样和文件导出适配。
- SDK 工具层：diagnostic JSONL 输出、报告生成、回放样本 runner、Android 与目标平台
  结果对齐报告。

SDK 不负责：

- UI 体验。
- 路线展示交互。
- 与策略无关的账号、云同步、社交、产品功能。

## 固定迁移顺序

1. 抽取平台中立 SDK 契约。
2. 抽取诊断 schema 和报告字段契约。
3. 整理回放样本（replay fixtures）输入输出预期。
4. 按 `docs/track-sdk-public-api-contract.md` 设计 SDK 模块边界和公共 API。
5. 按 `docs/platform-adapter-field-mapping.md` 冻结目标平台字段映射。
6. 为目标平台设计采集适配层。
7. 实现策略 SDK 核心或移植策略核心。
8. 实现目标平台 SDK replay / 离线对齐工具。
9. 生成 Web `review-queue-v1` / `review-queue-batch-v1` 审核包。
10. 用同一批回放样本和 review queue 对齐 Android / Web 目标函数输出。
11. 用同路线真实设备采样对比 Android / 鸿蒙 / iOS 输出。
12. 只在有真实样本、回放样本、测试和文档闭环时调整策略。

## 不可让 AI 越界的事项

- 不要把 UI 体验作为迁移目标。
- 不要把 SDK 做成完整 App。
- 不要为了适配目标平台而静默修改策略阈值。
- 不要改名 `decisionResult`、`decisionReason`、`segmentId` 等核心语义。
- 不要让弱 GPS 诊断指标变成硬判规则，除非任务明确要求策略变更。
- 不要丢弃被拒绝点和弱信号点的诊断证据。
- 不要只做真机黑盒测试，必须保留离线回放对齐。

## Prompt 0：迁移任务总控

适用场景：启动鸿蒙 / iOS 迁移任务前，让 AI 先建立正确上下文。

```text
你正在协助把一个 Android Java GNSS 徒步轨迹策略原型项目沉淀为可集成 SDK，
并迁移到目标平台。

请先阅读以下文件：
- AGENTS.md
- README.md
- docs/technical-debt-governance-plan.md
- docs/system-gnss-track-recording-plan.md
- docs/diagnostic-jsonl-schema.md
- docs/platform-neutral-evidence-jsonl-contract.md
- docs/platform-adapter-field-mapping.md
- docs/platform-neutral-track-engine-contract.md
- docs/track-sdk-public-api-contract.md
- docs/streaming-scenario-window-settlement-plan.md
- docs/cross-platform-migration-prompt-engineering.md
- docs/review-queue-ai-alignment-prompt.md

项目定位：
- 这是策略原型项目，不追求 UI 体验。
- 迁移目标不是复制 Android App，而是输出可复用的轨迹策略 SDK。
- 目标平台是：{HarmonyOS 或 iOS}

请输出：
1. 当前 Android 策略链路摘要。
2. 哪些模块属于 SDK 核心层。
3. 哪些模块属于 SDK 平台适配层。
4. 哪些模块属于 SDK 工具层。
5. 迁移到目标平台前必须冻结的契约。
6. 本次 SDK 化迁移的风险清单。

不要改代码。不要提出 UI 优化。不要改变策略阈值。
```

## Prompt 1：抽取平台中立 SDK 契约

适用场景：迁移前，把 Android 代码中的策略沉淀成目标平台可实现的 SDK 契约。

```text
请从当前 Android 项目中抽取平台中立轨迹策略 SDK 契约。

重点阅读：
- app/src/main/java/com/example/gnsssatdemo/track/model/
- app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustConfig.java
- app/src/main/java/com/example/gnsssatdemo/track/engine/SamplingIntake.java
- app/src/main/java/com/example/gnsssatdemo/track/engine/TrackCloudWindow.java
- app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustEngine.java

请输出一份平台中立 SDK 契约草案，至少包含：
1. 输入模型：RawPoint、采样归因、运动摘要、气压计样本；GNSS 质量摘要仅作为可选诊断附录。
2. 输出模型：TrackPoint、decisionResult、decisionReason、segmentId、距离增量、运动时间增量。
3. 策略阈值：所有默认值、单位和来源文件。
4. 判点规则：首点、弱信号、静止漂移、GAP、疑似交通工具、休息恢复。
5. 不变量：哪些行为跨平台必须保持一致。
6. 历史数据口径：历史 session 仅用历史版本工具读取，新 v3 SDK 不继承旧判点结果。
7. Adapter 字段映射入口：必须引用 `docs/platform-adapter-field-mapping.md` 和
   `docs/platform-adapter-field-mapping.v1.json`。
8. SDK 公共 API：初始化、输入采样、结束 session、导出诊断、运行回放样本。
9. SDK 不负责的边界：UI、地图展示、账号、云同步等非策略功能。

要求：
- 用中文说明。
- 保留代码中的英文标识符。
- 不要改代码。
- 不要发明当前代码不存在的策略。
```

## Prompt 2：抽取诊断与报告契约

适用场景：确保鸿蒙 / iOS 能产出可比较的诊断数据。

```text
请抽取跨平台诊断与报告契约。

重点阅读：
- docs/diagnostic-jsonl-schema.md
- app/src/main/java/com/example/gnsssatdemo/track/export/
- Android 可选 GNSS 诊断字段（若当前分支仍保留相关实现）

请输出：
1. evidence.jsonl 必须保留的事件类型和字段。
2. 可选字段、历史兼容字段和新增字段规则。
3. 可选弱 GPS 诊断报告的统计字段，以及目标算法不依赖这些字段的边界。
4. 样本报告必须保留的统计字段。
5. 鸿蒙 / iOS 无法提供某些传感器字段时的占位和兼容策略。
6. 跨平台对齐时必须比较的字段清单。

要求：
- 诊断字段可以扩展，但不能破坏旧读取逻辑。
- 缺失可选字段必须能被解释，不能导致报告生成失败。
- 不要把诊断字段直接变成策略硬判。
```

## Prompt 3：整理回放样本对齐要求

适用场景：迁移前明确目标平台必须通过哪些固定样本。

```text
请整理当前项目的回放样本（replay fixtures）对齐要求。

重点阅读：
- app/src/test/resources/replay-fixtures/
- app/src/test/java/com/example/gnsssatdemo/track/replay/
- docs/technical-debt-governance-plan.md 的 Replay Fixture Catalog

请输出：
1. 每个回放样本覆盖的场景。
2. 每个样本的关键预期：decisionResult、decisionReason、TrackPoint 数量、segment 行为、距离和运动时间。
3. 哪些样本是迁移到鸿蒙 / iOS 的最低必过集合。
4. 目标平台 SDK replay runner 应接收什么输入、输出什么报告。
5. 与 Android 输出不一致时的排查顺序。

要求：
- 用“回放样本”作为中文名，并在首次出现时标注 replay fixtures。
- 不要修改样本。
- 不要因为目标平台限制而降低预期。
```

## Prompt 4：目标平台采集适配层设计

适用场景：让 AI 设计鸿蒙 / iOS SDK 的平台采集层，但不改策略核心。

```text
请为 {HarmonyOS 或 iOS} 设计 GNSS 轨迹策略采集适配层。

必须遵守：
- docs/platform-neutral-evidence-jsonl-contract.md
- docs/platform-adapter-field-mapping.md
- docs/platform-adapter-field-mapping.v1.json
- docs/track-sdk-public-api-contract.md
- docs/track-sdk-public-api.v1.json

已知平台中立策略需要输入：
- RawPoint
- 采样归因和等价单调时钟
- 运动摘要
- 气压计样本
- 可选 GNSS 质量摘要（仅诊断，不作为目标算法判点输入）

请输出：
1. 目标平台可用的定位、卫星、气压计、运动传感器 API 映射。
2. 目标平台原生字段到 `outdoor-track-evidence-v1` 的映射表。
3. `fixElapsedRealtimeNanos`、`eventElapsedRealtimeNanos`、
   `receivedElapsedRealtimeNanos`、`callbackDelayNanos` 的时间语义验证方式。
4. `windowAscentMeters` 和 `windowDescentMeters` 的生成方式。
5. 无法一一映射字段的降级策略。
6. 后台采样限制和风险。
7. 如何生成平台中立 `outdoor_track_evidence_v1.jsonl`。
8. 如何保证策略核心只接收平台中立输入。
9. SDK 适配层应该暴露哪些接口给宿主 App。

要求：
- watchOS / iOS 的持久化轨迹证据输出必须直接是 `outdoor-track-evidence-v1`，不要另建
  watchOS 私有 evidence schema 再交给策略核心二次转换。
- 不要改策略阈值。
- 不要用平台融合定位静默替代纯 GNSS，除非明确标记数据源。
- 无法提供的字段必须进入诊断报告，而不是静默丢失。
- `callbackDelayNanos` 只能用于诊断展示，不能作为判点硬门槛。
- GNSS 质量字段只能作为诊断扩展，不能直接变成 route truth。
```

## Prompt 5：SDK 迁移实现提示词

适用场景：已经有契约后，让 AI 实现目标平台 SDK。

```text
请在 {HarmonyOS 或 iOS} 项目中实现当前 GNSS 轨迹策略 SDK 的第一版迁移。

输入资料：
- 平台中立 SDK 契约
- 平台 adapter 字段映射契约
- SDK 公共 API 和 replay 契约
- 诊断与报告契约
- 回放样本对齐要求
- 当前目标平台 SDK 项目结构

实现范围：
1. SDK 核心模型。
2. 策略配置。
3. 位置校验。
4. 判点引擎。
5. segment、距离、运动时间累计。
6. SDK 公共 API。
7. evidence.jsonl 输出。
8. replay runner 或等价离线回放工具。

公共 API 要求：
- `process` / `process_debug` / `verify_fixtures` 必须按
  `docs/track-sdk-public-api-contract.md` 实现或标注暂缺。
- replay fixture 必须保留 `totalAscentMeters` 和 `totalDescentMeters`。
- 当前 POC 字段别名不能扩散为目标平台长期公共 API。

暂不实现：
- UI 体验优化。
- 与策略无关的产品功能。
- 未经验证的新策略。

完成后输出：
1. 修改文件清单。
2. 与 Android 原型的对应关系。
3. 已通过和未通过的回放样本。
4. 与 Android 输出不一致的字段。
5. 下一步修复建议。
6. SDK 集成方式草案。
```

## Prompt 6：跨平台结果对齐审查

适用场景：目标平台 SDK 已能跑回放样本后，用于找差异。

```text
请审查 {HarmonyOS 或 iOS} SDK 迁移版与 Android 原型的回放结果差异。

输入：
- Android replay 报告
- 目标平台 SDK replay 报告
- 对应回放样本
- 平台中立 SDK 契约
- Web 目标函数导出的 `review-queue-v1` 或 `review-queue-batch-v1`
- 可选：由 `npm run report-review-queue` 生成的 `review-queue-alignment-report-v1`

请逐项比较：
1. decisionResult
2. decisionReason
3. TrackPoint 数量
4. segmentId
5. totalDistanceMeters
6. movingTimeSeconds
7. GAP 处理
8. 弱 GPS 解释字段
9. evidence.jsonl 事件和关键字段
10. review queue 中每个 task 的 rawRange、scenario、metricOwner、affectedMetricGates
11. diagnostic_context 是否保持 metricOwner=false，且没有产生 route/distance/moving_time/elevation ownership

请输出：
1. 完全一致项。
2. 不一致项。
3. 差异可能来自策略实现、平台字段映射、时钟语义、精度单位、传感器缺失还是样本解析。
4. 每个差异的修复建议。
5. 按 `P0/P1/P2` 标注严重程度，并引用 `reviewKey` 和 `rawRange`。

禁止：
- 为了通过测试直接改预期。
- 在没有真实样本支撑时改策略阈值。
- 把 review queue 当成算法输入。
- 把 `diagnostic_context` 升级成 metric owner。
```

## Prompt 6A：Review Queue AI 对齐审查

适用场景：已经导出 `review-queue-v1` 或 `review-queue-batch-v1`，需要交给 AI 或端侧实现方
逐项复盘。

推荐先生成带失败门的对齐包：

```bash
cd acceptance-web
npm run package-review-queue -- ../path/to/evidence-or-fixture-dir --filter all --out-dir /tmp/track-review
npm run validate-review-queue-package -- /tmp/track-review/{base-name}-manifest.json
```

```text
请使用 docs/review-queue-ai-alignment-prompt.md 中的固定提示词，审查以下审核包：

- review queue 包：{review-queue-v1 或 review-queue-batch-v1 JSON}
- review queue 对齐报告：{review-queue-alignment-report-v1 Markdown}
- review queue manifest：{review-queue-ai-package-v1 JSON，符合 track-rs/schemas/review-queue-ai-package.schema.json，safeToSend 应为 true}
- 固定 AI 提示词副本：{package-review-queue 输出的 *-prompt.md}
- 目标平台输出：{若已有，附 replay/engine 输出；若没有，说明暂无}

请严格按提示词输出：
1. Markdown 摘要。
2. `review-queue-ai-alignment-result-v1` JSON，符合
   `track-rs/schemas/review-queue-ai-alignment-result.schema.json`。
3. 数据集摘要。
4. 必须对齐的指标任务。
5. 必须保持诊断态的任务。
6. P0/P1/P2 差异清单。
7. 不应改策略项。
8. 需要补充的 replay fixtures。

特别注意：
- `review-queue-v1` / `review-queue-batch-v1` 不是 engine 输入。
- `type=diagnostic_context` 必须保持 `metricOwner=false`。
- 每条结论必须引用 `reviewKey` 和 `rawRange`。
```

## Prompt 7：真实设备迁移验收

适用场景：鸿蒙 / iOS SDK 能跑通后，用真实设备对比 Android 原型。

```text
请设计并执行一次跨平台真实设备策略验收。

设备：
- Android 原型设备：{设备信息}
- 目标平台设备：{鸿蒙或 iOS 设备信息}

路线：
- {路线描述}
- 是否有弱 GPS / 山谷 / 城市峡谷 / 休息 / 长 GAP：{说明}

请输出验收方案：
1. 同路线采样方法。
2. 必须导出的文件。
3. 必须比较的指标。
4. 可接受误差范围。
5. 弱 GPS、GAP、休息恢复的人工复核方法。
6. 如何把发现的问题转成回放样本。

验收后输出：
1. Android 与目标平台指标对比。
2. 差异解释。
3. 是否允许进入下一轮迁移。
4. 必须补充的回放样本和文档。
5. SDK API 或适配层是否需要调整。
```

## SDK 迁移产物清单

一次合格的鸿蒙 / iOS SDK 迁移准备，至少应产出：

- 平台中立 SDK 契约。
- SDK 公共 API 和 replay 契约。
- 诊断与报告契约。
- 回放样本对齐清单。
- 目标平台字段映射表。
- 目标平台 SDK replay runner 或等价离线回放工具。
- Android 与目标平台 SDK replay 对齐报告。
- Web `review-queue-v1` / `review-queue-batch-v1` 对齐报告。
- 同路线真实设备采样对比报告。
- 差异修复记录。
- SDK 集成说明。

## 当前成熟度

稳定提示词工程成熟度：`7.1 / 10`

原因：

- 已有清晰 Android 策略原型、治理文档、诊断 schema 和回放样本目录。
- 本文已经给出固定迁移 prompt 顺序和输出要求。
- 平台中立 evidence / engine 契约、adapter 字段映射契约、SDK 公共 API 契约和
  review queue 对齐提示词已经成文。
- Rust POC 仍使用部分 temporary aliases，尚未完全收敛到 SDK v1 公共 API。
- 鸿蒙 / iOS 具体项目字段映射实现尚未建立。
- 目标平台 SDK replay runner 尚未实现。
- 还没有跨平台回放对齐报告和真实设备对比报告。
