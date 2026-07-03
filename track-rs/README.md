# Rust Track SDK Core

这是 Track SDK Core 的 Rust workspace。它验证的是：

```text
标准化 evidence JSON -> Rust Core -> 清洗轨迹结果 JSON
```

Rust Core 是 Web 端已验证清洗规则的三端执行层，不是策略研究和调参试验场。新的清洗
逻辑应从 Web 已经确定的轨迹生成算法翻译到这里。

当前迁移范围聚焦在轨迹清洗和三个指标：

- 总里程 `totalDistanceMeters`
- 累计爬升 `totalAscentMeters`
- 累计下降 `totalDescentMeters`

已落地的核心能力：

- `NormalizedLocationSample` -> `CleanedTrackPoint`
- Web intake 翻译切片：provider 存在性、mock、经纬度、accuracy、时间连续性和 SamplingEpoch 匹配
- haversine 距离累计
- 轨迹方向角 `trackDirectionDegrees`，正北为 `0` 度
- elapsed realtime 运动时间累计
- motion window walking / still 门控：
  - `motion_supported_low_speed`
  - `stationary_anchor`
  - `stationary_cloud_jitter`
- 低精度连续性救援：`continuity_rescue_low_accuracy`
- 移动单点尖刺清理：`moving_spike_line_bridge`，删除单个侧向回跳点并用前后可信点桥接计距
- 定位跳变恢复：`position_snap_recovery_anchor`，弱速度矛盾点后的低速恢复点置零
- 静止整段压缩：`stationary_session_anchor`，整段静止 session 压成单个零距离锚点
- 停留漂移压缩：`stationary_drift_anchor`，将局部停留漂移云压成零距离云中心锚点
- 弱恢复端点保留：`weak_recovery_shape_anchor`，长 GAP 后弱恢复点云压成零距离新段锚点
- 休息/拍照微移动：`rest_photo_micro_move_anchor/start/shape/end`，按 Web anchor、shape filter、simplifier 三种方式清洗
- 密集区主路线骨架：`dense_main_route_start/shape/end`，用 RDP 距离容忍保留前进主骨架
- 往返线形抽稀：`round_trip_interwoven_start/shape/end`，保留弱恢复折返点并抽稀往返线形
- 同路往返中心线核心：强同路证据下将折返点两侧轨迹压到中心线，弱恢复折返点仍保留
- 遮挡回环聚集压缩：`enclosed_loop_cluster_start/anchor/end`，小范围 GAP/静止聚集仅保留走廊锚点
- 多场景重叠保护：局部锚点优先，后续大范围路线重建不吞掉已确定的局部 settlement
- GNSS altitude 累计爬升 / 累计下降基础门控
- `barometer_window.windowAscentMeters/windowDescentMeters` 累计爬升 / 累计下降
- BAROMETER 优先、GNSS fallback 的 `selectedElevationSource`
- JSON FFI 入口
- CLI `process` 命令
- CLI `process-debug` 命令
- CLI `process-product-snapshot` 命令，只输出当前产品迁移范围的轻量 snapshot
- CLI `process-evidence-jsonl-product-snapshot` 命令，从 neutral evidence JSONL 直接输出轻量 snapshot
- CLI `verify-fixtures` 命令
- CLI `verify-fixtures-json` 命令，输出 `track-sdk-replay-report-v1`

它还没有做到 Android / Web 当前完整诊断面逐字段等价：

- SamplingIntake 完整语义
- TrackTrustEngine 完整语义
- TrackCloudWindow 完整语义
- weak / reject / anchor / accept 完整解释上下文字段
- 流式 metric settlement 的 committed ownership 切片
- Web review queue / AI 对齐报告的全部诊断 schema
- 真实 Android replay fixture 批量对齐

## 运行

本机如使用 rustup，需要显式指定 stable：

```bash
cd track-rs
./scripts/verify-track-core.sh
VERIFY_APPLE_XCFRAMEWORK=1 ./scripts/verify-track-core.sh
```

`rust-toolchain.toml` 固定使用 stable、`rustfmt`，并列出 iOS/watchOS device/simulator
targets。有 rustup 的机器进入 `track-rs` 后会自动使用该 toolchain 配置。
如机器已有 rustup 但 targets/components 未装齐，可执行：

```bash
./scripts/bootstrap-rust-toolchain.sh
```

如果当前 shell 没有 rustup，脚本会自动把 `~/.cargo/bin` 加入 PATH，并尝试通过
`https://sh.rustup.rs` 安装 minimal stable + rustfmt。若机器网络无法解析 rustup
域名，也可以先在浏览器或另一台机器下载适合 macOS arm64 的 `rustup-init`，然后执行：

```bash
chmod +x /path/to/rustup-init
RUSTUP_INIT=/path/to/rustup-init ./scripts/bootstrap-rust-toolchain.sh
```

`verification-manifest.json` 是机器可读的完成门槛清单，列出 always-run gate、Rust
toolchain gate、可选 Apple XCFramework gate 和最终完成条件。`verify-track-core.sh`
必须和该 manifest 保持一致。
`.github/workflows/track-rs.yml` 在 macOS runner 上运行同一个验证脚本；手动触发时可选择
构建 `TrackCore.xcframework`。
当前机器无法跑完整验证时，可先执行：

```bash
python3 scripts/audit-verification-status.py
```

它会输出 `track-rs-verification-status-v1` JSON，列出产品输出范围、缺失工具、
阻塞原因和下一步必须运行的验证命令。`productScope` 应保持为清洗轨迹、
总里程、累计爬升和累计下降；`movingTimeSeconds` / `paceSecondsPerKm` 在 watchOS
实时产品快照中必须为 `false`。如果 `completionReady=false`，先看 `blockedReason`，
再补齐工具链后重跑 `./scripts/verify-track-core.sh`。

如果需要单独拆开执行：

```bash
RUSTUP_TOOLCHAIN=stable cargo fmt --all --check
RUSTUP_TOOLCHAIN=stable cargo test --workspace
RUSTUP_TOOLCHAIN=stable cargo run -p track-ffi --example smoke
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-debug examples/minimal-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process examples/minimal-stable-v1-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-product-snapshot examples/minimal-stable-v1-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-evidence-jsonl-product-snapshot examples/minimal-evidence-v1.jsonl
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- verify-fixtures fixtures
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- verify-fixtures-json fixtures
```

`track-ffi --example smoke` 会同时检查 `track_process_json` 和
`track_process_evidence_jsonl`，并确认 summary 输出包含总里程、累计爬升、累计下降和高度源。

## Crates

| crate | 作用 |
| --- | --- |
| `track-model` | 平台中立输入/输出模型。 |
| `track-core` | 批处理核心。 |
| `track-ffi` | JSON C ABI。 |
| `track-cli` | 命令行处理入口。 |

Apple 侧接入文件：

- `apple/TrackCoreBridge.swift`
- `apple/TrackCoreModels.swift`
- `apple/TrackCoreStreamingEngine.swift`
- `apple/TrackCoreDecodeSmoke.swift`，仅用于本地验证 Swift Codable 解码
- `apple/build-track-core-xcframework.sh`
- `apple/package-watchos-integration.sh`，打包 watchOS 需要复制的 Swift、header、manifest 和已构建 xcframework
- `apple/apply-watchos-integration-package.sh`，把打包目录应用到 `watch-hiking-app` 并自检
- `apple/validate-watchos-integration-package.py`，校验打包目录或已复制到 watchOS 工程的接入文件
- `apple/integration-manifest.json`，watchOS 工程复制文件、FFI 符号和产品字段边界清单

## Fixtures

`fixtures/` 是 Rust Core 自己的最小回归样例，不是 Android replay fixtures。
每个 fixture 必须声明规则来源：

- `schemaVersion = track-sdk-replay-fixture-v1`
- `ruleId`
- `ruleVersion`
- `source`

`source` 只能是：

- `web_algorithm`：从 Web 已确定轨迹生成算法翻译而来的样例。
- `rust_infrastructure`：Rust Core 自己的基础设施样例，不代表新清洗策略。
- `android_replay`：从 Android replay fixture 或报告沉淀来的样例。
- `real_session_slice`：从真实 session 切片沉淀来的样例。

Fixture request 必须使用稳定字段：`sampleId`、`provider`、`lat`、`lng`、
`fixElapsedRealtimeNanos`。`rawPointId`、`positioningSource`、`latitude`、`longitude`、
`elapsedRealtimeNanos` 只作为 Rust 反序列化 legacy alias 保留，不再写入新 fixture。

当前 fixtures 会校验 metadata、成品摘要，也可以校验 sample 决策：

- `totalAscentMeters`
- `totalDescentMeters`
- `selectedElevationSource`
- `acceptedSampleIds`
- `weakSampleIds`
- `rejectedSampleIds`
- `decisionReasons`，key 为 `sampleId` 的十进制字符串
- `decisionReasonCounts`，用于校验某类清洗解释出现次数而不绑定代表点 sampleId
- `trackPoints[]`，可选校验清洗后轨迹点的 `sourceSampleId`、`lat`、`lng`，用于锁定
  同路往返中心线等轨迹重建结果
- `verify-fixtures-json` 会输出 `schemaVersion=track-sdk-replay-report-v1`、
  `fixtureCount`、`passedCount`、`failedCount` 和 `failures[]`，用于跨端 CI 或 AI 对齐；
  常见算法差异会附带 `sampleRange` 或 `sampleId` 级 locator，`rawRange` 暂时作为
  legacy mirror 保留。CLI 内部 failure locator 已使用 `FixtureSampleRange` /
  `sample_range` 命名，避免新实现继续扩散 rawPoint 口径。
- `process-debug` 的 metric ownership 和 cleaning operation 区间使用
  `sampleRange` / `inputSampleRange`；旧 `rawRange` / `inputRawRange` 只保留为
  反序列化 alias。

当前覆盖：

- `normal-3-points`
- `invalid-positioning-source`
- `mock-point`
- `invalid-lat-lon`
- `bad-accuracy`
- `duplicate-elapsed-time`
- `empty-after-filter`
- `stationary-session-collapse`
- `stationary-drift-collapse`
- `weak-recovery-shape-anchor`
- `rest-photo-micro-move-anchor`
- `moving-spike-line-bridge`
- `position-snap-recovery-anchor`
- `dense-main-route-settlement`
- `round-trip-line-settlement`
- `gnss-ascent-descent`
- `barometer-ascent-descent-priority`

对应 schema：

- `schemas/process-request.schema.json`
- `schemas/process-response.schema.json`
- `schemas/process-debug-response.schema.json`
- `schemas/apple-integration-manifest.schema.json`
- `schemas/product-snapshot.schema.json`
- `schemas/product-snapshot-comparison.schema.json`
- `schemas/verification-manifest.schema.json`
- `schemas/verification-status.schema.json`
- `schemas/streaming-settlement-state.schema.json`
- `schemas/review-queue.schema.json`
- `schemas/review-queue-batch.schema.json`
- `schemas/review-queue-ai-package.schema.json`
- `schemas/review-queue-ai-alignment-result.schema.json`
- `schemas/fixture.schema.json`
- `schemas/replay-report.schema.json`

`examples/minimal-stable-v1-input.json` 使用 `sampleId`、`provider`、`lat`、`lng` 和
`fixElapsedRealtimeNanos`，用于验证目标平台 adapter 按 SDK v1 字段输出后，Rust core
仍能通过 temporary aliases 读取。

`examples/product-snapshot.example.json` 是 `rust-product-snapshot.json` 的最小示例，
用于 watchOS / iPhone / Web acceptance 对齐轻量结果文件。它只包含清洗轨迹、总里程、
累计爬升、累计下降和高度源，不包含运动时间、配速或完整 debug 解释。
本地生成 Rust product snapshot：

```bash
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-product-snapshot examples/minimal-stable-v1-input.json > /tmp/rust-product-snapshot.json
python3 scripts/check-static-contracts.py --product-snapshot /tmp/rust-product-snapshot.json
```

从 watchOS / iPhone 保存的 neutral evidence JSONL 直接生成 product snapshot：

```bash
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-evidence-jsonl-product-snapshot /path/to/outdoor_track_evidence_v1.jsonl > /tmp/rust-product-snapshot.json
python3 scripts/check-static-contracts.py --product-snapshot /tmp/rust-product-snapshot.json
```

拿到端侧产出的 snapshot 后，可以单独校验：

```bash
python3 scripts/check-static-contracts.py --product-snapshot /path/to/rust-product-snapshot.json
python3 scripts/check-static-contracts.py --compare-product-snapshot expected.json actual.json
python3 scripts/check-static-contracts.py --compare-product-snapshot expected.json actual.json --meters-tolerance 0.5
python3 scripts/check-static-contracts.py --compare-product-snapshot-json expected.json actual.json
```

## 边界

Rust Core 不采集数据，也不调用 Android / iOS / 鸿蒙 / 高德定位 API。
平台采集器必须先把定位、运动和气压计数据转成标准化 evidence，再交给 Rust Core。
