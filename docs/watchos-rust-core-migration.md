# watchOS Rust Core Migration

本文说明如何把 `track-rs` 的 Rust core 接入
`/Users/ldy/Desktop/work/watch_md/watch-hiking-app`。

当前执行环境不能直接写入 `watch_md`，因此本次先在 `hide_test` 落地 Rust FFI、
Apple 构建脚本和 Swift bridge。迁移到 watchOS 工程时，按本文把对应产物放入
`watch-hiking-app`。

## 迁移边界

watchOS 已经直接输出平台中立 evidence：

```text
outdoor_track_evidence_v1.jsonl
```

Rust core 不应该要求 watchOS 再产出私有格式，也不应该依赖 Web 内部字段。

目标边界：

```text
watchOS CoreLocation / CoreMotion / CMAltimeter
  -> outdoor-track-evidence-v1 JSONL
  -> track_process_evidence_jsonl(...)
  -> ProcessResponse JSON
  -> Swift decode / UI / upload / replay
```

## 本次已落地的 Rust 入口

新增 FFI 函数：

```c
char *track_process_evidence_jsonl(const char *input);
char *track_process_evidence_jsonl_product_snapshot(const char *input);
void track_free_string(char *ptr);
```

位置：

```text
track-rs/crates/track-ffi/src/lib.rs
track-rs/crates/track-ffi/include/track_ffi.h
```

`track_process_evidence_jsonl` 会把 JSONL 中的事件转换为 `ProcessRequest`：

| Evidence event | Rust input |
| --- | --- |
| `session_metadata` | `SessionContext` |
| `sampling_policy` | `SamplingEpoch` |
| `location_sample` | `NormalizedLocationSample` |
| `motion_window` | `NormalizedMotionWindow` |
| `barometer_window` | `NormalizedBarometerWindow` |

当前 Rust core 的迁移边界限定为：

- 轨迹清洗后的可信 `trackPoints`
- 总里程 `totalDistanceMeters`
- 累计爬升 `totalAscentMeters`
- 累计下降 `totalDescentMeters`

`motion_window` 用于辅助清洗门控，`barometer_window` 用于优先累计爬升/下降；
配速和产品运动耗时不是本轮 watchOS 迁移目标。

## Apple 侧产物

新增 Apple 侧文件：

```text
track-rs/apple/build-track-core-xcframework.sh
track-rs/apple/package-watchos-integration.sh
track-rs/apple/apply-watchos-integration-package.sh
track-rs/apple/validate-watchos-integration-package.py
track-rs/apple/integration-manifest.json
track-rs/apple/TrackCoreBridge.swift
track-rs/apple/TrackCoreModels.swift
track-rs/apple/TrackCoreStreamingEngine.swift
```

`integration-manifest.json` 是给 `watch_md` 迁移用的机器可读清单，声明需要复制的
Swift 文件、`TrackCore.xcframework` 放置位置、必须存在的 FFI 符号和本轮产品字段边界。
`package-watchos-integration.sh` 会把 Swift 文件、FFI header、manifest、README 和已构建的
`TrackCore.xcframework` 整理到一个可复制目录。
`apply-watchos-integration-package.sh` 会把该目录复制到 `watch-hiking-app` 的推荐位置，并在
复制前后执行自检。
`validate-watchos-integration-package.py` 可以校验该打包目录，也可以在文件复制到
`watch-hiking-app` 后校验目标工程目录；如果目标目录存在 `Package.swift`，还会检查
`TrackCore` binary target、`Vendor/TrackCore.xcframework` path 和 `HikingCore` 对
`TrackCore` 的依赖声明。

`build-track-core-xcframework.sh` 目标产物：

```text
track-rs/target/apple/TrackCore.xcframework
```

包含平台：

```text
iOS device
iOS simulator
watchOS device
watchOS simulator
```

## 构建 XCFramework

在有 Rust toolchain 的机器上执行：

```sh
cd /Users/ldy/Desktop/work/hide_test/track-rs
./apple/build-track-core-xcframework.sh
```

需要：

- `cargo`
- `rustup`
- Xcode command line tools
- Apple targets:
  - `aarch64-apple-ios`
  - `aarch64-apple-ios-sim`
  - `aarch64-apple-watchos`
  - `aarch64-apple-watchos-sim`

脚本会自动执行 `rustup target add`。
每个 slice 生成后会校验：

- `TrackCore.framework/TrackCore` 静态库存在且非空。
- `Headers/track_ffi.h` 存在，并包含 product snapshot FFI。
- `Modules/module.modulemap` 暴露 `framework module TrackCore`。
- `Info.plist` 包含 `CFBundleExecutable=TrackCore`。

如果只想生成可复制的 watchOS 接入包：

```sh
cd /Users/ldy/Desktop/work/hide_test/track-rs
./apple/package-watchos-integration.sh /tmp/trackcore-watchos-package
./apple/validate-watchos-integration-package.py /tmp/trackcore-watchos-package
./apple/apply-watchos-integration-package.sh /tmp/trackcore-watchos-package /Users/ldy/Desktop/work/watch_md/watch-hiking-app
```

当 `target/apple/TrackCore.xcframework` 已存在时，打包目录会同时包含
`Vendor/TrackCore.xcframework`；否则只包含 Swift、header、manifest 和接入 README。

## 放入 watchOS 工程

推荐目录：

```text
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Vendor/TrackCore.xcframework
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreBridge.swift
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreModels.swift
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreStreamingEngine.swift
```

其中：

- `TrackCore.xcframework` 来自 `track-rs/target/apple/TrackCore.xcframework`。
- `TrackCoreBridge.swift`、`TrackCoreModels.swift`、`TrackCoreStreamingEngine.swift`
  来自 `track-rs/apple/`。
- `track-rs/apple/integration-manifest.json` 可作为复制清单和端侧接入自检依据。

## Package.swift 接入

在 `watch-hiking-app/Package.swift` 中增加 binary target，并让 `HikingCore`
依赖它：

```swift
// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "WatchHikingApp",
    platforms: [
        .iOS(.v18),
        .watchOS(.v11),
        .macOS(.v15)
    ],
    products: [
        .library(name: "HikingCore", targets: ["HikingCore"])
    ],
    targets: [
        .binaryTarget(
            name: "TrackCore",
            path: "Vendor/TrackCore.xcframework"
        ),
        .target(
            name: "HikingCore",
            dependencies: ["TrackCore"],
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "HikingCoreTests",
            dependencies: ["HikingCore"],
            resources: [
                .process("Fixtures")
            ]
        )
    ]
)
```

如果 Xcode app target 不通过 SwiftPM binary target 链接，需要同时在
`WatchHikingApp.xcodeproj` 中把 `TrackCore.xcframework` 加到 iPhone 和 Watch app
target 的 Frameworks / Link Binary With Libraries。

## Swift 调用方式

`TrackCoreBridge.swift` 暴露：

```swift
public struct TrackCoreBridge {
    public init()
    public func processRequestJson(_ requestJson: String) throws -> String
    public func processRequestJsonResponse(_ requestJson: String) throws -> TrackCoreProcessResponse
    public func processEvidenceJsonl(_ evidenceJsonl: String) throws -> String
    public func processEvidenceJsonlResponse(_ evidenceJsonl: String) throws -> TrackCoreProcessResponse
    public func processEvidenceJsonlProductSnapshot(_ evidenceJsonl: String) throws -> String
    public func processEvidenceJsonlProductSnapshotValue(_ evidenceJsonl: String) throws -> TrackCoreProductSnapshot
    public func processEvidenceJsonl(at url: URL) throws -> String
    public func processEvidenceJsonlResponse(at url: URL) throws -> TrackCoreProcessResponse
    public func processEvidenceJsonlProductSnapshot(at url: URL) throws -> String
    public func processEvidenceJsonlProductSnapshotValue(at url: URL) throws -> TrackCoreProductSnapshot
}
```

watchOS 结束 session 后，产品链路优先直接处理本地 evidence 为轻量 snapshot：

```swift
let bridge = TrackCoreBridge()
let product = try bridge.processEvidenceJsonlProductSnapshotValue(at: evidenceURL)
let distance = product.totalDistanceMeters
let ascent = product.totalAscentMeters
let descent = product.totalDescentMeters
let track = product.trackPoints
try product.writeJson(to: sessionDebugDirectory.appendingPathComponent("rust-product-snapshot.json"))
```

完整 `processEvidenceJsonlResponse(at:)` 仍可用于 debug/replay，但产品 UI 不应依赖完整响应里的
运动时间、配速或其他兼容字段。

可用 `track-rs` 的静态契约脚本单独检查该文件：

```sh
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-evidence-jsonl-product-snapshot /path/to/outdoor_track_evidence_v1.jsonl > /tmp/rust-product-snapshot.json
python3 scripts/check-static-contracts.py --product-snapshot /path/to/rust-product-snapshot.json
python3 scripts/check-static-contracts.py --compare-product-snapshot expected.json actual.json
python3 scripts/check-static-contracts.py --compare-product-snapshot expected.json actual.json --meters-tolerance 0.5
python3 scripts/check-static-contracts.py --compare-product-snapshot-json expected.json actual.json
```

记录过程中需要实时刷新轨迹时，使用 streaming adapter：

```swift
let engine = TrackCoreStreamingEngine()

if let snapshot = try await engine.appendEvidenceLine(jsonLine) {
    let response = try snapshot.decodeResponse()
    let product = response.result?.productSnapshot
    let track = product?.trackPoints ?? []
}

let finalSnapshot = try await engine.finish()
```

如果要避免 Watch 端 CPU 峰值，也可以只在 iPhone 端处理：

```text
Watch records evidence
  -> WatchConnectivity evidenceChunk
  -> iPhone ReceivedSessions/session-id/outdoor_track_evidence_v1.jsonl
  -> TrackCoreBridge.processEvidenceJsonl(at:)
```

推荐先接 iPhone 端 replay / review，再决定是否在 Watch 实时处理。

## 返回结果

`track_process_evidence_jsonl(...)` 返回完整 `ProcessResponse` JSON。该响应保留兼容字段；
watchOS 产品迁移优先使用 `track_process_evidence_jsonl_product_snapshot(...)` 或 Swift 的
`processEvidenceJsonlProductSnapshotValue(...)`，即清洗轨迹、总里程、累计爬升、累计下降和
高度源解释。

```json
{
  "ok": true,
  "result": {
    "trackPoints": [],
    "segments": [],
    "gpxTrackPoints": [],
    "summary": {
      "totalDistanceMeters": 0,
      "movingTimeSeconds": 0,
      "paceSecondsPerKm": null,
      "totalAscentMeters": 0,
      "totalDescentMeters": 0,
      "selectedElevationSource": "NONE"
    }
  }
}
```

错误时：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_jsonl",
    "message": "invalid JSONL at line 3: ..."
  }
}
```

Swift 侧可以保存原始 `responseJson` 作为 debug 文件，也可以直接使用
`TrackCoreProcessResponse`。业务 UI 建议优先读取 `TrackCoreProductSnapshot`，它只包含当前
迁移范围内的轨迹、总里程、累计爬升、累计下降和高度源。`productSnapshot.trackPoints[]`
是轻量产品轨迹点，不包含 `movingTimeDeltaSeconds`。

## 当前成熟度和限制

已具备：

- Rust FFI 可处理 `ProcessRequest` JSON。
- Rust FFI 可直接处理 `outdoor-track-evidence-v1` JSONL。
- Swift bridge 可调用 Rust FFI，并负责释放 Rust 返回字符串。
- Swift `Codable` 模型可解码轨迹、总里程、累计爬升、累计下降和错误响应。
- 构建脚本可生成 Apple `TrackCore.xcframework`。

仍未完成：

- 当前本机没有 `cargo` / `rustfmt`，本轮未能实际编译验证。
- Rust core 还没有做到 Android / Web 诊断面逐字段等价。
- 真正 incremental streaming state 尚未实现；当前 Watch 接入仍是 snapshot adapter。
- `watch_md` 目录当前不在本会话可写范围内，本轮未直接修改 watchOS 工程。

## 推荐落地顺序

1. 在有 Rust toolchain 的环境构建 `TrackCore.xcframework`。
2. 把 `TrackCore.xcframework` 和 `TrackCoreBridge.swift` 放入 `watch-hiking-app`。
3. 先在 iPhone 端对 `ReceivedSessions/.../outdoor_track_evidence_v1.jsonl` 调用
   `processEvidenceJsonl(at:)`，生成 Rust product snapshot。
4. 在 Watch 端 evidence writer 旁路接入 `TrackCoreStreamingEngine`，生成实时 Rust
   snapshot，但先作为 debug / candidate result。
5. 用同一份 evidence 对比 Watch live snapshot、iPhone final snapshot、Web acceptance
   输出和 Rust 输出。
6. 差异稳定后，再把 Watch UI 的轨迹、距离、累计爬升和累计下降切到 Rust result。
7. 后续如需真流式性能，再把 snapshot adapter 内部替换为 incremental streaming state。
