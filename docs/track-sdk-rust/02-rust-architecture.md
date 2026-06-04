# Rust Track SDK 架构

如果最高优先级是 Android / iOS / 鸿蒙三端一致，建议使用 Rust 作为 Track SDK
Core，三端只做薄 Adapter。Rust Core 的架构目标是稳定执行 Web 已验证规则，而不是
承载策略探索。

## 仓库结构建议

```text
track-rs/
  crates/
    track-model/
    track-core/
    track-debug/
    track-replay/
    track-ffi/
    track-cli/
  bindings/
    android/
    ios/
    harmony/
  schemas/
  fixtures/
```

## crates 职责

### track-model

平台中立数据模型。

```text
SessionContext
SamplingEpoch
NormalizedLocationSample
NormalizedMotionWindow
NormalizedBarometerWindow
BarometerCalibration
OutdoorTrackInput
CleanedTrackResult
CleanedTrackDebugResult
```

要求：

- 使用 `serde` 序列化。
- 字段单位明确。
- 不依赖平台 API。
- 可生成 JSON Schema。

### track-core

纯轨迹处理核心。这里的模块是执行层模块；Rust Core 不重新设计策略，只把 Web 端
已经确定的轨迹生成算法按模块翻译到 Rust。

```text
safety_kernel/
  intake
  sampling
  horizontal
  gap
  speed

cleaning/
  drift
  spike
  gap_recovery
  round_trip
  rest_micro_move
  transport

settlement/
  anchor
  bridge
  collapse
  simplify
  exclude

metrics/
  distance
  moving_time
  pace
  ascent

engine.rs
```

核心批处理 API：

```rust
pub fn process(input: OutdoorTrackInput, config: TrackConfig) -> CleanedTrackResult;
```

debug API：

```rust
pub fn process_debug(
    input: OutdoorTrackInput,
    config: TrackConfig,
) -> CleanedTrackDebugResult;
```

### track-debug

只放复核、回放和诊断需要的结构：

```text
RawPointDecision
CleaningOperation
CleaningSpan
ReplayDiff
DebugFinding
```

建议把 `scenario` 逐步收敛为更面向清洗目的的概念：

```text
CleaningOperation:
  CollapseToAnchor
  RemoveSpike
  BridgeGap
  SimplifyPolyline
  ExcludeTransport
  PreserveEndpoint
```

### track-replay

离线对齐工具。

```text
load_fixture()
run_fixture()
compare_result()
generate_report()
```

它是三端一致性的根。所有策略迁移都必须先有 Web 侧定稿规则和 fixture，再通过 replay
对齐。

### track-cli

命令行工具。

```bash
track-cli process input.json > result.json
track-cli process-debug input.json > debug-result.json
track-cli replay fixtures/
track-cli schema > outdoor-track-input.schema.json
```

### track-ffi

三端绑定边界。第一阶段建议用 JSON C ABI，降低跨语言结构体绑定成本。

```rust
#[no_mangle]
pub extern "C" fn track_process_json(input: *const c_char) -> *mut c_char;

#[no_mangle]
pub extern "C" fn track_process_debug_json(input: *const c_char) -> *mut c_char;

#[no_mangle]
pub extern "C" fn track_free_string(ptr: *mut c_char);
```

稳定后再考虑 UniFFI、typed FFI 或更高性能的二进制协议。

当前 POC 先落 `track_process_json` 和 `track_free_string`。`track_process_debug_json`
等 debug 边界应在 replay 对齐和 debug result 模型稳定后再实现。

## 三端集成

Android:

```text
高德 / 系统 GPS
  -> Kotlin Adapter
  -> OutdoorTrackInput JSON
  -> JNI / C ABI
  -> Rust Core
```

iOS:

```text
CoreLocation / CoreMotion / CMAltimeter
  -> Swift Adapter
  -> JSON
  -> Rust static lib / xcframework
```

Harmony:

```text
鸿蒙定位 / 传感器
  -> ArkTS Adapter
  -> JSON
  -> N-API / C ABI
  -> Rust native lib
```

## Rust Core 约束

为了降低三端兼容风险，Rust Core 应保持：

- no strategy experiment in core。
- no threshold tuning in core。
- no platform API。
- no network。
- no file system in core。
- no async runtime in core。
- 不主动开线程。
- 不跨 FFI panic。
- 使用 Rust stable。
- FFI 边界返回错误 JSON 或错误码。
