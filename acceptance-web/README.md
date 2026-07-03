# Diagnostic 目标函数预览 Web

这是一个本地 PC 人工核验工具，用于导入 Android 产出的 `evidence.jsonl`，
在全屏地图上叠加预览：

```text
采样样本数据 -> 合理的轨迹 / 累计爬升 / 里程 / 配速 / 运动耗时
```

Web 只做离线预览、情景修复复算和人工核验，不编辑、不回写 Android 原始日志。
“情景修复”指六层算法内的局部重建 / 标注模块，会影响 Web 当前清洗轨迹、统计和线样式；
它不会改写 `evidence.jsonl`、Android session、Android v3 replay 期望或设备端可信 GPX。

## 运行

```bash
cd acceptance-web
npm run dev
```

默认地址：

```text
http://localhost:4173
```

## 输入

- 可以选择多个 `evidence.jsonl`。
- 可以上传 session 目录，页面会自动收集目录内所有路径末尾为
  `evidence.jsonl` 的文件。
- `evidence.jsonl` 只包含 Android 采集证据，不包含 Android 实时判点结果；
  Web 清洗算法负责重新判点和生成目标成品轨迹。

## 页面能力

- MapLibre GL 全屏地图。
- Google 卫星瓦片源：

```text
https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}
```

- 地形使用 MapLibre 官方示例同款 DEM tilejson：

```text
https://tiles.mapterhorn.com/tilejson.json
```

- 地形默认关闭，可在地图图层面板切换；俯视时显示 hillshade，倾斜地图时显示 3D
  terrain。
- 等高线默认开启，使用同一组 DEM 瓦片在浏览器端生成 contour vector tile；可在地图图层
  面板独立切换；等高线高度会像方向箭头一样沿线重复标注，地图数据面板也会展示当前
  等高距，点击等高线可查看海拔、级别和经纬度。
- 多 evidence 叠加显示，每个文件分配稳定颜色。
- raw 轨迹使用细虚线，清洗轨迹使用红色实线。
- 点和清洗点图层默认关闭，需要人工复核具体位置时再手动打开。
- Web UI 不提供任意阈值编辑；导入 evidence 后默认使用六层算法默认配置复算。
  地图图层面板的“情景修复”只允许切换稳定的局部修复 / 混合修复 / 标注模块，用于人工复核改线影响，
  不改变采样、accuracy、GAP、交通和爬升等基础安全内核阈值。
- 点类型区分 `weak / reject / intake_rejected / raw` 等诊断状态。
- 文件列表展示：文件名、设备、轨迹点数、里程、运动耗时、配速、气压累计爬升和
  Location 海拔累计爬升。
- 选中文件后展示 Web 清洗结果、raw、pressure、motion 摘要。
- 点击地图点后展示 raw 证据或 Web 清洗点详情。
- 当前 Web 清洗入口只使用 `src/sixLayerTrackProduct.mjs` 六层算法。
- 六层算法输出 `scenarios[]`，用于解释弱恢复端点、同路往返、整段静止、停留漂移、
  GAP 恢复边界和交通混入等局部重建；文档见
  `../docs/outdoor-track-scenario-recognizers.md`。
- 六层算法同步输出 `scenarioCoverage[]`，把每个情景投影到清洗点区间和 raw 区间，
  方便核对“某段清洗点到底进入了哪些情景”。
- 地图默认叠加“情景区域”多边形：连续情景按 raw 覆盖范围标记触发区域，GAP
  恢复边界、交通混入等离散情景按显式触发点拆分成独立区域，点击多边形可查看情景、
  清洗点范围、raw 范围、置信度和动作解释。
- 地图图层面板的“情景修复”可以勾选哪些局部修复、混合修复和诊断标注模块参与六层算法重算；
  勾选变化后，页面会在后台刷新当前清洗轨迹、统计、点解释和清洗线样式，并在策略面板显示
  本次是否真的改线、清洗点和里程变化。
- “同路往返中心线”和“往返线形抽稀”是两个可独立复核的修复项；前者只处理窄同路中心线，
  后者处理普通往返折线抽稀。
- 情景区域多边形始终来自全量情景识别产物，用于展示所有触发范围；它不随“情景修复”
  勾选过滤或消失。
- 右侧“区间复核”可以输入清洗点范围，例如 `1836-1919`，直接查看该区间命中的
  复合情景、raw 范围、主解释点数和关联点数。
- 点详情优先展示 `primaryExplanation`，并通过 `scenarioContexts[]` 展示同一点所在的
  复合情景；底层 `reason` 会拆成 `primitiveFacts` 作为安全内核证据，避免把所有低层规则
  直接暴露成主解释。
- `primaryExplanation`、`scenarioContexts[]` 和 `scenarioCoverage[]` 都包含中文
  `scenarioLabel`、`actionLabel`、`localRebuildLabel`，UI 优先展示中文解释，英文标识只作
  复测索引。
- 疑似交通工具标记为 `transport_risk` 诊断证据，不计入徒步距离、运动时间或爬升真值。
- `Location.altitude` 和气压计高度是两条独立高度线，最终只在 selected ascent 选择层汇合。

## 导出 AI 对齐包

审核队列可以导出为 `review-queue-v1` JSON，用于发给 AI 或端侧实现方对齐产品行为。
它不是算法输入，不会反向影响 Web 判点或指标。
机器契约在 `track-rs/schemas/review-queue.schema.json` 和
`track-rs/schemas/review-queue-batch.schema.json`；导出包内的
`streamingSettlementState` 必须符合 `track-rs/schemas/streaming-settlement-state.schema.json`。
一键包 manifest 必须符合 `track-rs/schemas/review-queue-ai-package.schema.json`。

在 UI 中，导入 evidence 后可在“复核任务”面板选择 `全部 / 指标 / 诊断 / 高风险 / 待看`
筛选，再点击“导出”。

无浏览器环境可以直接运行：

```bash
npm run export-review-queue -- ../path/to/evidence.jsonl --filter diagnostic --out /tmp/review-queue.json
```

推荐发给 AI 前使用一键打包命令，它会同时生成 JSON 审核包、Markdown 报告、固定 AI 提示词
和 manifest，并在发现 report issue 时返回非零退出码：

```bash
npm run package-review-queue -- ../path/to/evidence.jsonl --filter all --out-dir /tmp/track-review
```

默认输出形如 `*-review-queue.json`、`*-review-queue.md`、`*-review-queue-prompt.md`
和 `*-review-queue-manifest.json`；带 `--basename ai-review` 时会输出
`ai-review.json`、`ai-review.md`、`ai-review-prompt.md` 和 `ai-review-manifest.json`。
发给 AI 或端侧实现方时，四个文件应作为同一个包发送；manifest 的 `files` 会列出这四个
文件，`contracts` 会列出本包依赖的机器契约。

发包前也可以直接校验 manifest、四个包文件是否完整，以及 JSON / 报告 / 提示词内容类型是否匹配：

```bash
npm run validate-review-queue-package -- /tmp/track-review/evidence-review-queue-manifest.json
```

导出后可生成一份 Markdown 对齐报告，直接贴给 AI 或端侧实现方：

```bash
npm run report-review-queue -- /tmp/review-queue.json --out /tmp/review-queue-report.md
```

报告会把缺失 `streamingSettlementState`、公共状态泄露内部 `rawPointId` / `range`、
或 `blockingRanges[]` 缺少 `affectedMetricGates[]` 标为 P0，需先修正再发包。
发包前可加失败门：

```bash
npm run report-review-queue -- /tmp/review-queue.json --fail-on-issues
```

也可以传入目录，递归导出目录下所有 `.jsonl` 为一个 `review-queue-batch-v1` 批量包：

```bash
npm run export-review-queue -- ../app/src/test/resources/replay-fixtures --filter highRisk --out /tmp/replay-review-queues.json
```

批量包也可以生成同样格式的对齐报告：

```bash
npm run report-review-queue -- /tmp/replay-review-queues.json --out /tmp/replay-review-queues.md
```

常用筛选：

```text
all         全部审核任务
metric      会拥有或影响指标的任务
diagnostic  只用于复盘和跨端对齐的 diagnostic_context
highRisk    高风险边界和冲突
pending     尚未标记状态的任务
```

`type=diagnostic_context` 的任务必须保持 `metricOwner=false`，不能在任何端转换成
route、distance、moving_time 或 elevation ownership。

## 测试

```bash
npm test
```
