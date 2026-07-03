# Review Queue AI 对齐提示词

本文是把 `review-queue-v1` / `review-queue-batch-v1` 发给 AI 或端侧实现方复盘时使用的
固定提示词。它服务一个目标：让不同平台按同一份平台中立证据和同一套审核任务契约对齐，
而不是各端自行解释情景窗口。

## 使用前准备

先生成审核包：

```bash
cd acceptance-web
npm run package-review-queue -- ../path/to/evidence.jsonl --filter all --out-dir /tmp/track-review
```

该命令会写出审核 JSON、Markdown 对齐报告、本文这份固定提示词副本和 manifest。
manifest 的 `safeToSend=true` 才表示这包通过了基础契约自检。

可选但推荐：发送前校验 manifest、四个包文件是否完整，以及 JSON / 报告 / 提示词内容类型是否匹配：

```bash
npm run validate-review-queue-package -- /tmp/track-review/evidence-review-queue-manifest.json
```

需要拆分步骤时：

```bash
npm run export-review-queue -- ../path/to/evidence.jsonl --filter all --out /tmp/review-queue.json
npm run report-review-queue -- /tmp/review-queue.json --out /tmp/review-queue-report.md
```

批量 replay fixtures 或真实 session 目录：

```bash
npm run package-review-queue -- ../path/to/sessions-or-fixtures --filter all --out-dir /tmp/track-review-batch
```

批量目录需要拆分步骤时：

```bash
npm run export-review-queue -- ../path/to/sessions-or-fixtures --filter all --out /tmp/review-queue-batch.json
npm run report-review-queue -- /tmp/review-queue-batch.json --out /tmp/review-queue-batch-report.md
```

常用筛选：

```text
all         全部审核任务
metric      会拥有或影响指标的任务
diagnostic  只用于复盘和跨端对齐的 diagnostic_context
highRisk    高风险边界和冲突
pending     尚未标记状态的任务
```

建议第一次对齐先用 `all`。定位某类问题时再用 `diagnostic` 或 `highRisk`。

机器契约：

```text
track-rs/schemas/review-queue.schema.json
track-rs/schemas/review-queue-batch.schema.json
track-rs/schemas/review-queue-ai-package.schema.json
track-rs/schemas/review-queue-ai-alignment-result.schema.json
track-rs/schemas/streaming-settlement-state.schema.json
```

发给 AI 前必须先跑 `npm run report-review-queue`。报告会把缺失
`streamingSettlementState`、公共状态泄露 `rawPointId` / `range`、或
`blockingRanges[]` 缺少 `affectedMetricGates[]` 标为 P0。
推荐在发包流水线里使用：

```bash
npm run report-review-queue -- /tmp/review-queue.json --fail-on-issues
```

## 必须随包发送的材料

给 AI 或端侧实现方时，至少附上：

1. `review-queue-v1` 或 `review-queue-batch-v1` JSON。
2. `review-queue-alignment-report-v1` Markdown 报告。
3. `review-queue-ai-package-v1` manifest。
4. 本文这份固定提示词，或 `package-review-queue` 输出的 `*-prompt.md` 副本。
5. `docs/platform-neutral-evidence-jsonl-contract.md`。
6. `docs/platform-neutral-track-engine-contract.md`。
7. `docs/streaming-scenario-window-settlement-plan.md`。
8. 目标平台当前 replay / engine 输出，若已有。

如果是 SDK 迁移，还要附上 `docs/cross-platform-migration-prompt-engineering.md`。

## 可直接复制的提示词

```text
你正在协助做户外轨迹策略的跨平台对齐。输入中包含 Web 目标函数导出的
review-queue-v1 或 review-queue-batch-v1 审核包，以及平台中立 evidence/engine 契约。

请先阅读：
- docs/platform-neutral-evidence-jsonl-contract.md
- docs/platform-neutral-track-engine-contract.md
- docs/streaming-scenario-window-settlement-plan.md

本次任务不是重新设计算法，也不是优化 UI。请只做契约对齐审查。

核心不变量：
1. Raw evidence 是唯一事实来源；review queue 是审核/对齐包，不是 engine 输入。
2. type=diagnostic_context 的任务必须保持 metricOwner=false。
3. diagnostic_context 不能转换成 route、distance、moving_time 或 elevation ownership。
4. metric owner 的同一 raw range / 同一 affectedMetricGate 不能重叠；不同 gate 可重叠但必须显式声明。
5. hard boundary 必须切断跨边界 distance、moving_time 和 elevation。
6. round-trip intent 必须来自重叠 dense_area_intent(round_trip)，不能由端侧私有字段注入。
7. 被拒绝点和弱信号点仍必须保留诊断证据。

请基于 review queue 包逐项输出：
1. 包类型：review-queue-v1 或 review-queue-batch-v1。
2. 数据集列表：fileName、filter、taskCount、highRisk、metricOwner、diagnosticContext。
3. 每个 metric task 的对齐要求：
   - reviewKey
   - scenario
   - rawRange
   - trackRange
   - highRisk
   - action / localRebuild
   - 目标平台必须产生的 ownership 或 hard boundary 语义
4. 每个 diagnostic_context 的对齐要求：
   - reviewKey
   - scenario
   - rawRange
   - anchorRawPointIds
   - evidence 中的 intent / rejectionReason / gapClusterIntentSupported 等关键字段
   - 明确说明它不能拥有任何指标
5. 若提供了目标平台输出，请比较：
   - rawRange 是否一致
   - scenario 是否一致
   - metricOwner 是否一致
   - affectedMetricGates 是否一致
   - distance / moving_time / elevation 是否被错误累计
   - rejected / weak 诊断证据是否丢失
6. 不一致项按严重程度排序：
   - P0：会污染 route、distance、moving_time、elevation 或跨 hard boundary 累计
   - P1：diagnostic_context 丢失、metricOwner 标记错误或重叠窗口仲裁错误
   - P2：中文标签、摘要、非关键 evidence 展示不一致
7. 给出下一步动作：
   - 应补 replay fixture
   - 应修平台适配字段映射
   - 应修 engine settlement / local rebuild
   - 仅需人工复核，不应改策略

禁止：
- 不要修改策略阈值。
- 不要把 review queue 当作算法输入。
- 不要为了目标平台通过而改 Web 期望。
- 不要把 diagnostic_context 升级为 metric owner。
- 不要只给泛泛建议；每条结论必须引用 reviewKey 和 rawRange。
```

## AI 输出格式要求

要求 AI 同时输出 Markdown 摘要和一个 `review-queue-ai-alignment-result-v1` JSON。JSON
必须符合 `track-rs/schemas/review-queue-ai-alignment-result.schema.json`，用于后续 agent
或端侧团队复核。Markdown 摘要可使用：

```text
## 结论
- 是否可对齐：
- 是否发现 P0：
- 是否发现 P1：

## 数据集摘要
| fileName | filter | taskCount | highRisk | metricOwner | diagnosticContext |

## 必须对齐的指标任务
| reviewKey | scenario | rawRange | trackRange | expected owner/gate | 检查结果 |

## 必须保持诊断态的任务
| reviewKey | scenario | rawRange | anchorRawPointIds | key evidence | 检查结果 |

## 差异清单
| severity | reviewKey | rawRange | 问题 | 可能原因 | 建议动作 |

## 不应改策略项
- ...

## 需要补充的 replay fixtures
- ...
```

JSON 输出至少包含：

```json
{
  "schemaVersion": "review-queue-ai-alignment-result-v1",
  "packageSchemaVersion": "review-queue-ai-package-v1",
  "sourceSchemaVersion": "review-queue-v1",
  "alignable": true,
  "hasP0": false,
  "hasP1": false,
  "datasets": [],
  "metricTaskResults": [],
  "diagnosticTaskResults": [],
  "differences": [],
  "noStrategyChangeItems": [],
  "replayFixtureRequests": [],
  "nextActions": []
}
```

## 解读口径

- `review-queue-v1` 表示单个 evidence/session 的审核包。
- `review-queue-batch-v1` 表示多个 `review-queue-v1` 的批量容器，常用于 replay fixtures
  或一批真实 session。
- `review-queue-alignment-report-v1` 是由审核包派生的人类可读 Markdown 摘要，只用于
  沟通和审查，不是 engine 输入。
- `stats.metricOwner` 只统计会拥有或影响指标的任务，不包含 `diagnostic_context`。
- `stats.diagnosticContext` 只统计 `metricOwner=false` 的复盘上下文。
- `streamingSettlementState` 是平台中立安全封段状态，使用 `sampleId` / `sampleRange`；
  重点核对 `committedCursorSampleId`、`lastCommitWatermark`、`blockingRanges[]` 和
  `affectedMetricGates[]`。
- `streamingDiagnosticContexts` 是全量 diagnostic context report，即使当前筛选不是
  `diagnostic` 也必须保留。
- `status` 是人工审核状态；headless 导出默认 `pending`。

## 常见错误

- 把 `dense_area_intent` 当成改线规则。正确口径：它是调度 / 复盘上下文，
  `metricOwner=false`。
- 把 `enclosed_gap_cluster` 当成路线压缩结果。正确口径：它只是遮挡 / 停留 /
  GAP 聚集证据；真正改写必须由 metric-owning settlement proposal 承担。
- 跨 `gap_recovery_boundary` 继续累计距离或爬升。正确口径：hard boundary 必须切断。
- 只比较最终里程，不比较 rawRange / metricOwner / affectedMetricGates。正确口径：
  先验证 ownership，再看指标。
- 把所有 metricOwner rawRange 重叠都当成错误。正确口径：只有同一
  `affectedMetricGate` 重叠才是 ownership 冲突；不同 gate 可重叠，但必须显式声明。
