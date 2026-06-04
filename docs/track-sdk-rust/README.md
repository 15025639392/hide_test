# Rust Track SDK 文档总览

本文档目录用于沉淀一个可嵌入 Android / iOS / 鸿蒙 App 的 Rust 轨迹处理
SDK 设计。它不是新 App 设计，也不是 Web 复核工具设计，更不是策略研究场。

核心目标：

```text
标准化证据 -> 清洗后的成品轨迹 / 里程 / 运动时间 / 配速 / 累计爬升
```

## 关键口径

- Web 端负责策略研究、样本复核、算法试错和可视化解释。
- Rust Core 负责把 Web 已经确定的轨迹生成算法翻译成三端一致的确定性执行层。
- Rust Core 不负责发明清洗算法、不负责调参试验、不负责替代 Web 复核判断。
- Track SDK Core 只处理数据，不采集数据。
- Android / iOS / 鸿蒙 / 高德等定位能力都属于外层采集器或 Adapter。
- 情景识别是内部清洗手段，不是 SDK 的主要产品输出。
- 普通 App 默认消费成品轨迹和运动指标。
- replay、验收和 Web 复核可以使用 debug 输出查看清洗过程。

## 推荐阅读顺序

1. `01-core-boundary.md` - SDK Core 的目标、非目标和产品输出边界。
2. `02-rust-architecture.md` - Rust crates、模块和三端嵌入架构。
3. `03-api-contract.md` - 批处理 API、debug API、FFI 和 JSON 边界。
4. `04-migration-plan.md` - POC、迁移阶段、验证与风险控制。
5. `05-poc-status.md` - 当前 Rust POC 已落地内容和验证方式。
6. `06-web-algorithm-translation.md` - Web 轨迹生成算法翻译到 Rust Core 的实施口径。

## 和现有项目的关系

现有 Android 原型继续作为采样、验证和 replay 基准。Web 端继续作为清洗算法研究、
复核和规则收敛场。Rust SDK 化的第一目标不是立刻替换 Android 实时链路，也不是在
Rust 里继续探索策略，而是把 Web 已验证的目标函数沉淀成平台中立、可回放、可对齐的
纯数据处理执行核心。

迁移过程中不得静默改变：

- decision result / decision reason 语义
- segment 规则
- 距离和运动时间口径
- GPX 可信点口径
- 诊断 evidence schema
- replay fixture 期望
