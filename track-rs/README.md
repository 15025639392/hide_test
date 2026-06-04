# Rust Track SDK POC

这是 Track SDK Core 的 Rust POC workspace。它验证的是：

```text
标准化 evidence JSON -> Rust Core -> 清洗轨迹结果 JSON
```

Rust Core 是 Web 端已验证清洗规则的三端执行层，不是策略研究和调参试验场。新的清洗
逻辑应从 Web 已经确定的轨迹生成算法翻译到这里。

当前 POC 只实现最小位置样本处理：

- `NormalizedLocationSample` -> `CleanedTrackPoint`
- Web intake 翻译切片：positioningSource 存在性、mock、经纬度、accuracy、时间连续性和 SamplingEpoch 匹配
- haversine 距离累计
- 轨迹方向角 `trackDirectionDegrees`，正北为 `0` 度
- elapsed realtime 运动时间累计
- JSON FFI 入口
- CLI `process` 命令
- CLI `process-debug` 命令
- CLI `verify-fixtures` 命令

它还没有迁移 Android 当前完整策略：

- SamplingIntake 完整语义
- TrackTrustEngine 完整语义
- TrackCloudWindow 完整语义
- weak / reject / anchor / accept 决策解释
- 气压计爬升
- 情景清洗 / settlement
- replay fixture 对齐

## 运行

本机如使用 rustup，需要显式指定 stable：

```bash
cd track-rs
RUSTUP_TOOLCHAIN=stable cargo fmt --all --check
RUSTUP_TOOLCHAIN=stable cargo test --workspace
RUSTUP_TOOLCHAIN=stable cargo run -p track-ffi --example smoke
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-debug examples/minimal-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- verify-fixtures fixtures
```

## Crates

| crate | 作用 |
| --- | --- |
| `track-model` | 平台中立输入/输出模型。 |
| `track-core` | 批处理核心 POC。 |
| `track-ffi` | JSON C ABI POC。 |
| `track-cli` | 命令行处理入口。 |

## Fixtures

`fixtures/` 是 Rust Core 自己的最小回归样例，不是 Android replay fixtures。
每个 fixture 必须声明规则来源：

- `ruleId`
- `ruleVersion`
- `source`

`source` 只能是：

- `web_algorithm`：从 Web 已确定轨迹生成算法翻译而来的样例。
- `rust_infrastructure`：Rust Core 自己的基础设施样例，不代表新清洗策略。

当前 fixtures 会校验 metadata、成品摘要，也可以校验 raw point 决策：

- `acceptedRawPointIds`
- `rejectedRawPointIds`
- `decisionReasons`

当前覆盖：

- `normal-3-points`
- `invalid-positioning-source`
- `mock-point`
- `invalid-lat-lon`
- `bad-accuracy`
- `duplicate-elapsed-time`
- `empty-after-filter`

对应 schema：

- `schemas/fixture.schema.json`

## 边界

Rust Core 不采集数据，也不调用 Android / iOS / 鸿蒙 / 高德定位 API。
平台采集器必须先把定位、运动和气压计数据转成标准化 evidence，再交给 Rust Core。
