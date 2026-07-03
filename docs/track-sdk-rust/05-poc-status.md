# Rust Track SDK POC 状态

当前 POC 已落在 `track-rs/`，只用于验证平台中立 Track SDK Core 的最小闭环。它是 Web
已验证规则的三端执行层雏形，不是策略研究入口。

## 已实现

- `track-model`：平台中立输入、输出、错误和 JSON 响应模型。
- `track-core`：批处理 `process(input, config)`。
- `track-core`：debug 批处理 `process_debug(input, config)`。
- `track-ffi`：`track_process_json` / `track_free_string` C ABI。
- `track-cli`：`track-cli process <input.json>`、`track-cli process-debug <input.json>` 和
  `track-cli verify-fixtures <fixtures-dir>`。
- `track-cli`：`track-cli verify-fixtures-json <fixtures-dir>`，输出
  `track-sdk-replay-report-v1` JSON 报告。
- `examples/minimal-input.json`：最小 location samples 输入样例。
- `examples/minimal-stable-v1-input.json`：使用 SDK v1 location 字段名的最小输入样例。
- `fixtures/`：Rust Core 最小回归样例。

## 当前算法范围

当前核心只做执行层最小 POC：

- 按内部 `fix_elapsed_realtime_nanos` 和 `sample_id` 排序 location samples；旧
  `elapsedRealtimeNanos` / `rawPointId` 仅作为输入反序列化 alias。
- `TrackProcessRequest` 稳定输入由 `schemas/process-request.schema.json` 约束；
  `examples/minimal-stable-v1-input.json` 是正向样例。
- `TrackProcessResponse` 与 `TrackProcessDebugResponse` 输出由
  `schemas/process-response.schema.json` 和 `schemas/process-debug-response.schema.json`
  约束。
- `RawPointDecision` debug 输出序列化为 `sampleId`，同时保留 `rawPointId`
  反序列化 alias，避免旧 POC 数据一次性断裂。
- `RawPointDecision` 已输出 `metricOwner` 和 `affectedMetricGates`；accept 决策先标记
  `route/distance/moving_time`，weak/reject 为 `metricOwner=false`。
- `CleanedTrackDebugResult` 已固定输出 `cleaningOperations=[]`、
  `metricOwnershipRanges[]` 和 `replayDiagnostics`。其中 `metricOwnershipRanges[]`
  由 accepted decisions 生成最小单点 ownership；`settlementScope=base_kernel_only`
  表示 Rust POC 还未产出局部 settlement 操作。
- Web intake 翻译切片：只让入口合法的位置样本进入后续成品轨迹 POC。
  - `provider` 必须存在；Rust 不再擅自按 `gps/network` 类型拒绝，旧
    `positioningSource` 仅作为输入 alias。
  - mock 点不进入成品轨迹。
  - 经纬度必须有限且落在合法范围。
  - `fixElapsedRealtimeNanos` 必须存在且不早于记录开始容差。
  - `horizontalAccuracyMeters` 必须有限且 `>= 0`。
  - `horizontalAccuracyMeters > 80` 时按 `accuracy_too_large` 拒绝。
  - 成品轨迹点的 `fixElapsedRealtimeNanos` 必须严格递增。
  - 显式 `samplingEpochId` 必须能匹配到对应 `SamplingEpoch`。
- Web 首点决策切片：
  - accuracy <= 20m 输出 `first_fix_good`。
  - 20m < accuracy <= 30m 输出 `first_fix_relaxed`。
  - 30m < accuracy <= 80m 输出 `weak_horizontal_accuracy`，不进入成品轨迹。
- Web 普通移动点切片：
  - 首点之后 accuracy <= 30m 的合法点输出 `moving_good_fix`。
  - 首点之后 30m < accuracy <= 80m 的合法点输出 `weak_horizontal_accuracy`，不进入成品轨迹。
  - 首点之后移动距离 >= 20m，且上报速度 >= 3.5m/s 的点输出 `transport_risk`，
    不进入成品轨迹。
  - 首点之后 `dt > 120s` 且 accuracy > 30m 的点输出 `gap_recovery_pending`，
    不进入成品轨迹。
  - 首点之后 `dt > 120s`，满足 recovery fast path 的点输出 `gap_recovery`，
    进入成品轨迹，开启新 segment，但距离和运动时间增量为 0。
  - 首点之后 `dt > 120s`，不满足 fast path 但 recovery cloud 达到 2 个样本且云半径稳定时，
    输出 `gap_recovery`，进入成品轨迹，开启新 segment，但距离和运动时间增量为 0。
  - 首点之后隐含速度 > 12m/s 且尚未进入交通风险分支的点输出 `implied_speed_too_high`，
    不进入成品轨迹。
  - 首点之后隐含速度达到交通速度、移动距离 >= 20m、但设备上报速度低于交通速度的点输出
    `implied_speed_unconfirmed_by_reported_speed`，不进入成品轨迹。
- 输出 `CleanedTrackPoint`。
- 使用 haversine 计算距离增量和总距离。
- 计算 `trackDirectionDegrees`，正北为 `0` 度，顺时针递增。
- 使用 `fixElapsedRealtimeNanos` 计算运动时间。
- 根据距离和运动时间计算配速。
- `totalAscentMeters` / `totalDescentMeters` 暂为 `0.0`，`selectedElevationSource=NONE`。
- `process_debug` 输出 `rawPointDecisions[]`，用于解释每个位置样本为什么进入或没有进入成品轨迹。

还没有迁移 GAP recovery 的 recovery transport、transport mode、stationary cloud、
`TrackCloudWindow`、
气压计爬升、情景清洗、settlement 或 Android replay 对齐逻辑。

当前 Rust POC 只覆盖 Web 算法的早期切片；debug 决策已有 `accept`、`weak`、`reject`
雏形，但不等价于 Android 当前完整策略。

后续不要在 Rust 中直接发明 GAP、速度门控、情景清洗或 settlement。新增策略只从
Web 已经确定的轨迹生成算法翻译过来。

## Fixtures

当前 fixture 只校验关键输出摘要：

- `schemaVersion = track-sdk-replay-fixture-v1`
- `ruleId`
- `ruleVersion`
- `source`
- `trackPoints.length`
- `gpxTrackPoints.length`
- `segments.length`
- `summary.totalDistanceMeters`
- `summary.movingTimeSeconds`
- `summary.totalAscentMeters`
- `summary.totalDescentMeters`
- `acceptedSampleIds`
- `weakSampleIds`
- `rejectedSampleIds`
- `decisionReasons`，key 为 `sampleId` 的十进制字符串
- `verify-fixtures-json` 输出 `track-sdk-replay-report-v1`，包含 fixture 总数、通过数、
  失败数和 failures 明细。summary / count 类失败会带 session `sampleRange`，单点
  decision reason 失败会带 `sampleId`；`rawRange` 暂时作为 legacy alias 保留。
- `schemas/replay-report.schema.json` 固定 replay report 的机器可校验形状，后续
  Android / Web / iOS / 鸿蒙 runner 应输出同一 report schema。

已覆盖：

- 正常 3 点。
- 缺失 `provider`。
- 非空 `network` provider 保留，旧 `positioningSource` 只作为输入 alias。
- mock 点。
- 非法经纬度。
- 非法 accuracy。
- 重复 `fixElapsedRealtimeNanos`。
- SamplingEpoch 不匹配。
- 首点 relaxed。
- 首点 weak horizontal accuracy。
- 普通移动点 `moving_good_fix`。
- 普通移动点 weak horizontal accuracy。
- 普通移动点 `transport_risk`。
- 长 GAP 后低精度点 `gap_recovery_pending`。
- 长 GAP 后 fast path `gap_recovery` 和新 segment。
- 长 GAP 后 stable recovery cloud `gap_recovery`。
- 普通移动点 `implied_speed_too_high`。
- 普通移动点 `implied_speed_unconfirmed_by_reported_speed`。
- 过滤后空结果。

当前大部分 fixtures 的 `source` 是 `rust_infrastructure`，表示它们是 Rust 基础设施
样例；已经从 Web intake 口径翻译来的样例使用 `web_algorithm`。

## 验证

本机使用 rustup 时建议显式指定 stable：

```bash
cd track-rs
RUSTUP_TOOLCHAIN=stable cargo fmt --all --check
RUSTUP_TOOLCHAIN=stable cargo test --workspace
RUSTUP_TOOLCHAIN=stable cargo run -p track-ffi --example smoke
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process examples/minimal-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- process-debug examples/minimal-input.json
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- verify-fixtures fixtures
RUSTUP_TOOLCHAIN=stable cargo run -p track-cli -- verify-fixtures-json fixtures
```

## 边界确认

这次 POC 没有改 Android 策略、阈值、decision result、decision reason、segment 规则、
距离/运动时间口径、GPX 输出、诊断 schema 或 replay fixtures。
