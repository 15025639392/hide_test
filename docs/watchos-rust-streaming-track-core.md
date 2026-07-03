# watchOS Rust Streaming Track Core

本文说明如何把 Rust core 接到 watchOS 记录链路中，做到记录过程中持续刷新轨迹结果。

当前落地方式是 **streaming snapshot adapter**：

```text
watchOS writes outdoor-track-evidence-v1 events
  -> TrackCoreStreamingEngine buffers JSONL lines
  -> throttled track_process_evidence_jsonl(...)
  -> current ProcessResponse snapshot
```

这一步先打通 Watch 实时调用 Rust core 的产品链路。当前指标范围只包含清洗轨迹、
总里程、累计爬升和累计下降；后续 Rust core 内部应演进为真正 incremental streaming
state，届时 Swift 调用层可以保持基本不变。

## 已新增文件

```text
track-rs/apple/TrackCoreBridge.swift
track-rs/apple/TrackCoreModels.swift
track-rs/apple/TrackCoreStreamingEngine.swift
track-rs/apple/build-track-core-xcframework.sh
track-rs/crates/track-ffi/include/track_ffi.h
track-rs/crates/track-ffi/src/lib.rs
```

`TrackCoreStreamingEngine.swift` 是 watchOS 可直接使用的 Swift actor。

## 目标放置位置

由于当前会话不能写 `/Users/ldy/Desktop/work/watch_md`，需要把文件放入：

```text
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreBridge.swift
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreModels.swift
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Sources/HikingCore/TrackCoreStreamingEngine.swift
/Users/ldy/Desktop/work/watch_md/watch-hiking-app/Vendor/TrackCore.xcframework
```

`TrackCore.xcframework` 由：

```sh
cd /Users/ldy/Desktop/work/hide_test/track-rs
./apple/build-track-core-xcframework.sh
```

生成。

## Package.swift

`watch-hiking-app/Package.swift` 需要让 `HikingCore` 依赖 Rust binary target：

```swift
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
)
```

## Watch 记录中如何调用

推荐在 Watch 记录器或 evidence writer 旁路持有一个 actor：

```swift
private let rustTrackEngine = TrackCoreStreamingEngine(
    configuration: TrackCoreStreamingConfiguration(
        minimumLocationSamplesBetweenSnapshots: 5,
        minimumSecondsBetweenSnapshots: 5
    )
)
```

每当写入一行 neutral evidence JSONL 后，把同一行喂给 Rust streaming adapter：

```swift
if let snapshot = try await rustTrackEngine.appendEvidenceLine(jsonLine) {
    // snapshot.responseJson 可作为 debug 文件保存。
    // UI 只读取轻量 product snapshot：轨迹、总里程、累计爬升、累计下降。
    let product = try snapshot.decodeProductSnapshot()
    try product.writeJson(to: sessionDebugDirectory.appendingPathComponent("rust-product-snapshot.json"))
}
```

结束 session 时强制输出最终快照：

```swift
let finalSnapshot = try await rustTrackEngine.finish()
```

暂停 / 继续时仍然 append evidence：

```text
session_event
sampling_policy
```

这样 Rust core 可以看到完整上下文。

## 为什么当前先用 snapshot adapter

当前 `track-rs` core：

- 已支持 `track_process_evidence_jsonl(...)`。
- 已能从 neutral evidence 生成清洗轨迹、总里程、累计爬升和累计下降。
- 已迁入主要 Web 情景清洗规则，但还不是逐字段等价的完整诊断面，也还不是真正
  incremental streaming state。

因此本阶段不要在 Watch 端直接替换所有既有 session summary 逻辑，而是新增 Rust 结果作为：

```text
live computed candidate
debug/replay comparable result
future source of truth
```

等 Rust core 与 Web acceptance 对齐后，再把轨迹预览、`SessionSummary.distanceMeters`、
`ascentMeters`、`descentMeters` 等切到 Rust 输出。

## 性能策略

当前 snapshot adapter 会保留本 session 已写入的 JSONL 行，并按节流条件调用 Rust：

```text
minimumLocationSamplesBetweenSnapshots = 5
minimumSecondsBetweenSnapshots = 5
```

也就是：

- 每 5 个 location sample 至多刷新一次。
- 两次刷新至少间隔 5 秒。
- session 结束时一定刷新。

这对 MVP 足够简单可靠，但还不是最终低内存算法。

最终 Rust streaming core 应替换为：

```text
track_stream_create()
track_stream_ingest_event_json()
track_stream_snapshot_json()
track_stream_finish_json()
track_stream_free()
```

并在 Rust 内部维护：

```text
base safety kernel state
metric accumulator state
open scenario windows
pending proposals
settlement state
committed cursor
```

届时 Swift 的 `TrackCoreStreamingEngine` 可以改成持有 Rust stream handle，而不是持有
完整 JSONL lines。

## 当前不要做的事

- 不要让 watchOS 输出 `raw_location` 私有格式。
- 不要让 Watch 使用 Web 内部 `rawPointId/rawRange` 作为长期契约。
- 不要在 Swift 里重新实现 Web V17.9 情景策略。
- 不要把 Rust snapshot 结果立即覆盖现有 UI 指标，先并行展示或写 debug。

## 推荐接入顺序

1. 把 `TrackCore.xcframework`、`TrackCoreBridge.swift`、`TrackCoreModels.swift`、
   `TrackCoreStreamingEngine.swift` 加入 `watch-hiking-app`。
2. 在 Watch evidence writer 旁路调用 `appendEvidenceLine`。
3. 把 `TrackCoreStreamingSnapshot.responseJson` 落到 session debug 文件；同时用
   `snapshot.decodeProductSnapshot()` 写成 `rust-product-snapshot.json`，便于只对比轨迹、
   距离、累计爬升和累计下降。
   拿到该文件后，可在 `track-rs` 目录执行：
   `python3 scripts/check-static-contracts.py --product-snapshot /path/to/rust-product-snapshot.json`。
   对比 Watch live 和 iPhone final 时，可执行：
   `python3 scripts/check-static-contracts.py --compare-product-snapshot watch.json iphone.json`。
   若比较不同设备或不同提交时机，可加 `--meters-tolerance 0.5`。
   CI 或 AI 对齐可使用
   `python3 scripts/check-static-contracts.py --compare-product-snapshot-json watch.json iphone.json`
   输出机器可读报告。
4. iPhone 收到 evidence 后，也调用同一 Rust core 生成最终 snapshot。
5. 对比 Watch live snapshot、iPhone final snapshot、Web acceptance 输出。
6. 差异稳定后，再把 Watch UI 的轨迹、距离、累计爬升和累计下降切到 Rust result。
7. 后续实现真正 Rust incremental streaming state，替换 snapshot adapter 内部实现。
