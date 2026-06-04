# Web 算法翻译到 Rust Core

Rust Core 不需要额外中间层。它的任务很直接：

```text
把 Web 已经确定的轨迹生成算法翻译成 Rust Core
```

## 边界

- Web 负责研究真实轨迹问题、地图复核、调参和确定算法。
- Rust Core 不研究策略，不另起一套判断逻辑。
- Rust Core 只实现 Web 已经确定的轨迹生成算法。
- 三端 App 只嵌入 Rust Core，外层负责采集和适配输入数据。

## 翻译对象

当前主要翻译对象是：

```text
acceptance-web/src/sixLayerTrackProduct.mjs
```

优先按函数和责任拆解，而不是按“规则文件”拆解：

- evidence normalize。
- intake / hard validity。
- sampling attribution。
- horizontal decision。
- cloud window。
- gap / speed / stationary。
- scenario cleaning。
- settlement。
- metrics。
- debug decisions。

## 实施方式

每次迁移一个可验证的算法切片：

1. 找到 Web 中对应函数和测试。
2. 在 Rust Core 中实现同等数据结构和确定性逻辑。
3. 用 fixtures 固定输入与期望输出。
4. 对齐 Web 输出的轨迹点、距离、运动时间、segment、GPX 点和 debug reason。

fixtures 只是测试样本。它只回答一个问题：

```text
Rust 翻译后的算法输出是否和 Web 已确定算法一致？
```

## 下一步

下一步不做导出工具，不做规则 JSON。

继续从 Web 算法中迁移下一个稳定切片：

```text
decideHorizontal: GAP recovery / transport risk / stationary cloud
```

已完成的早期切片包括 `normalizeRawPoint` 相关入口字段口径、`SamplingEpoch` 匹配、
`intakeRawPoint` 的硬过滤、首点 accuracy 决策、普通移动点 accuracy 决策、
`transport_risk`、低精度 `gap_recovery_pending`、GAP fast path `gap_recovery`、stable
recovery cloud、新 segment 和两个速度诊断 reason。后续优先选择确定性强、fixture 容易
对齐的子分支，避免在 Rust 中先实现 Web 尚未定稿的策略探索。
