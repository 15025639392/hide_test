# Rust SDK 迁移计划

迁移目标是沉淀可嵌入 App 的 Track SDK Core，而不是复制 Android App，也不是把 Rust
变成新的策略研究入口。清洗算法研究、复核和调参先在 Web 端完成；Rust 只负责把 Web
已经确定的轨迹生成算法翻译成三端一致的实现。

## Phase 0: 三端 POC

目标：验证 Rust native core 可以被 Android / iOS / 鸿蒙调用。

最小能力：

```text
输入 3 个 location samples JSON
Rust 计算总距离
输出 result JSON
```

三端分别跑通：

```text
Android Kotlin -> JNI -> Rust
iOS Swift -> C ABI / xcframework -> Rust
Harmony ArkTS -> N-API / C ABI -> Rust
```

通过标准：

- 三端都能调用同一个 Rust 函数。
- JSON 输入输出正确。
- native 库打包可用。
- 字符串内存释放正确。
- crash 能定位到 Rust 符号。

## Phase 1: Model + Schema

目标：冻结平台中立输入输出。

产物：

- `OutdoorTrackInput`。
- `CleanedTrackResult`。
- `CleanedTrackDebugResult`。
- JSON Schema。
- 示例 input / result。

要求：

- 字段单位清晰。
- 不出现 Android / iOS / 鸿蒙原生类型。
- 高德等第三方定位结果只能在 Adapter 层转换。

## Phase 2: Batch Core

目标：先实现批处理执行框架。

```text
process(input) -> result
```

第一版只覆盖：

- location samples。
- 基础合法性。
- track points。
- total distance。
- moving time。

当前 POC 已进入这一阶段的最小版：Rust Core 已具备 positioningSource、mock、经纬度、
accuracy、elapsed realtime、SamplingEpoch 匹配、首点 accuracy、普通移动点 accuracy、
transport risk、低精度 GAP pending、GAP fast path 零增量恢复、stable recovery cloud、
新 segment 和普通移动点速度诊断的 Web 翻译切片，但还没有迁移 recovery transport、
transport mode、stationary cloud 或 settlement 语义。Rust 侧已增加最小 fixtures 和
`track-cli verify-fixtures`，用于固定 Batch Core 的早期回归基线。Debug 输出已具备
`rawPointDecisions[]` 雏形，后续可逐步对齐 Android replay 的 decision result /
reason。fixture metadata 已强制包含 `ruleId`、`ruleVersion` 和 `source`，用于区分
Web 算法翻译样例与 Rust 基础设施样例。

后续不要在 Rust 中继续发明新的判点策略。每一段新增 Rust 逻辑都应能对应到 Web 端
已有的算法函数、输入条件、清洗动作、计距/计时/GPX 口径和 debug reason。

不要一开始做流式状态机。

## Phase 3: Safety Kernel 对齐

承接 Web 已定稿的基础安全内核：

- positioningSource / mock / 时间字段合法性。
- SamplingEpoch 归因。
- accuracy。
- GAP。
- implied speed。
- anchor / accept / weak / reject。
- segment。
- distance gate。
- moving time gate。

通过标准：

- replay fixtures 中基础判点结果对齐。
- 距离和运动时间误差在约定阈值内。
- 不静默改变 strategy version 和阈值。

## Phase 4: Ascent

承接 Web 已验证的高度处理：

- GNSS altitude line。
- BAROMETER altitude line。
- selected ascent。
- barometer calibration。
- pressure jump / reset / suspended。

通过标准：

- 多设备气压计累计爬升验收一致。
- GNSS 和 BAROMETER 两条高度线不互相覆盖。

## Phase 5: Cleaning Operations

把 Web 已验证的情景 settlement 规则落为内部清洗动作：

- `CollapseToAnchor`
- `RemoveSpike`
- `BridgeGap`
- `SimplifyPolyline`
- `ExcludeTransport`
- `PreserveEndpoint`
- `ResetBoundary`

通过标准：

- 普通输出只暴露成品轨迹。
- debug 输出能解释每段线为什么被改。
- Web 复核可以继续按清洗动作查看前后线形。
- 每个 Rust cleaning operation 都能追溯到 Web 侧规则规格和 fixture。

## Phase 6: FFI SDK

封装三端可用的 SDK：

- Android AAR。
- iOS xcframework。
- Harmony native package。

三端 Adapter 只做采集归一化：

```text
平台定位 / 传感器 -> Normalized evidence -> Rust Core
```

## Phase 7: 流式 SessionEngine

在批处理对齐稳定后，提供 App 体验层 API：

```text
start
append_location
append_motion
append_barometer
snapshot
finish
```

早期内部可复用批处理核心；之后再针对性能热点增量化。

## 风险清单

- 鸿蒙 native bridge 兼容性要最早验证。
- 三端单调时间语义可能不一致。
- 高德 / 系统 GPS / CoreLocation / 鸿蒙定位来源语义不一致。
- 坐标系必须在 Adapter 层统一。
- JSON schema 版本必须稳定。
- FFI 字符串和内存释放必须统一。
- replay 对齐不能被真机主观测试替代。
- 未经 Web 复核定稿的策略不要直接进入 Rust Core。
