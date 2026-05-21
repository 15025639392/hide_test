# Diagnostic 目标函数预览 Web

这是一个本地 PC 人工核验工具，用于导入 Android 产出的 `evidence.jsonl`
或兼容旧格式的 `diagnostic.jsonl`，在全屏地图上叠加预览：

```text
采样样本数据 -> 合理的轨迹 / 累计爬升 / 里程 / 配速 / 运动耗时
```

第一版只做预览和人工核验，不修复、不编辑、不回写 Android 原始日志。

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

- 可以选择多个 `diagnostic.jsonl` 或 `evidence.jsonl`。
- 可以上传 session 目录，页面会自动收集目录内所有路径末尾为
  `diagnostic.jsonl` 或 `evidence.jsonl` 的文件。
- `evidence.jsonl` 是推荐的新输入：它只包含 Android 采集证据，不包含 Android
  实时判点结果；Web 清洗算法负责重新判点和生成目标成品轨迹。

## 页面能力

- MapLibre GL 全屏地图。
- Google 卫星瓦片源：

```text
https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}
```

- 多 diagnostic 叠加显示，每个文件分配稳定颜色。
- raw 轨迹使用细虚线，可信轨迹使用粗实线。
- 点类型区分 `anchor / accept / weak / reject / intake_rejected / raw`。
- 文件列表展示：文件名、设备、轨迹点数、里程、运动耗时、配速、累计爬升。
- 选中文件后展示 Web 清洗结果、raw、GNSS、pressure、motion 摘要。
- 兼容旧 `diagnostic.jsonl` 时，可额外展示 Android recorded decision 作为对照。
- 点击地图点后展示 raw 证据或 Web 清洗点详情。
- 疑似交通工具只标记为 `transport_suspected_kept`，不作为清洗剔除条件。

## 测试

```bash
npm test
```
