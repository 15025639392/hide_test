# 轨迹验收与诊断 Web

本项目是一个本地 PC 分析工具，包含：

- 气压计爬升验收页：导入多台设备导出的 session 目录，自动计算同一路线、
  同一时间下的 BAROMETER 累计爬升一致性。
- 诊断日志地图页：导入 `diagnostic.jsonl`，可视化 raw 点、可信轨迹、
  reject / weak 点、decision reason 分布和时间线明细。

## 运行

```bash
cd acceptance-web
npm run dev
```

默认地址：

```text
http://localhost:4173
```

诊断地图页：

```text
http://localhost:4173/diagnostic-map.html
```

## 爬升验收输入

第一版读取目录内所有路径末尾为 `session.json` 的文件；也可以手动选择多个
`session.json`。文件要求至少包含：

```text
sessionId
strategyVersion
deviceManufacturer
deviceBrand
deviceModel
deviceName
androidSdkInt
selectedAscentSource
barometerTotalAscentMeters
barometerAscentSampleCount
barometerAscentRejectedSampleCount
completionState
integrityState
```

每次验收默认就是同一批次、同一路线、同一算法；页面不再要求补录这些信息。
设备组合会根据 `deviceBrand`、`deviceManufacturer`、`deviceModel`、`deviceName`
自动识别。

## 判定

- 同型号：PASS `<= 8%`，REVIEW `<= 12%`
- 同品牌不同型号：PASS `<= 12%`，REVIEW `<= 15%`
- 不同品牌同算法：PASS `<= 12%`，REVIEW `<= 18%`
- 未知设备：参考 PASS `<= 12%` / REVIEW `<= 18%`，但批次最高只给 REVIEW

低爬升路线优先使用绝对差：

- `< 50m`: `<= 15m`
- `50m - 100m`: `<= 20m`
- `100m - 300m`: `<= 25m`

## 诊断地图输入

诊断地图页支持两种导入方式：

- 上传 session 目录：优先使用路径末尾为 `diagnostic.jsonl` 的文件，找不到时尝试目录内第一个文件。
- 选择单个诊断文件：不限制扩展名，先按 JSONL 尝试解析。

地图使用 MapLibre GL 加载 Google 卫星瓦片，页面会把 `decision.rawPointId`
回连到 `raw_location.rawPointId`，并展示：

- 原始 raw 轨迹虚线。
- 可信 `anchor` / `accept` 轨迹实线。
- `reject`、`weak`、未决 raw 点。
- Session、设备、策略版本、解析错误。
- decision reason 计数和逐点时间线。
- 逐点 GNSS 证据：关联 snapshot、stale 状态、snapshot age、used / visible、
  `usedAvgCn0`、`top4AvgCn0`、`lowCn0VisibleCount`、`weakUsedCount`。
- 诊断结论：weak / reject 是否缺少 GNSS 证据、stale 比例、GAP /
  no-location、采样策略事件和 motion summary 覆盖情况。
- 上下文解释：距上一个可信点的间隔、直线距离、推算速度、新 segment 和
  weak / GAP / transport / stationary 相关提示。

## 测试

```bash
npm test
```
