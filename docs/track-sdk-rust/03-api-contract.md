# API 契约草案

第一阶段先冻结批处理 API。流式 API 等批处理 replay 对齐稳定后再做。

## 批处理 API

```rust
pub fn process(input: OutdoorTrackInput, config: TrackConfig) -> CleanedTrackResult;
```

输入完整 session，输出成品结果。

```text
OutdoorTrackInput:
  sessionContext
  samplingEpochs[]
  locationSamples[]
  motionWindows[]
  barometerWindows[]
  barometerCalibrations[] optional
```

普通输出：

```text
CleanedTrackResult:
  trackPoints[]
  segments[]
  gpxTrackPoints[]
  summary:
    totalDistanceMeters
    movingTimeSeconds
    paceSecondsPerKm optional
    ascentMeters
```

`trackDirectionDegrees` 输出在 `CleanedTrackPoint` 上，表示当前点相对前一个清洗轨迹点
的方向角：正北为 `0` 度，顺时针递增，东为 `90`，南为 `180`，西为 `270`。首点或
零距离移动没有稳定方向，输出 `null`。

## Debug API

```rust
pub fn process_debug(
  input: OutdoorTrackInput,
  config: TrackConfig
) -> CleanedTrackDebugResult;
```

debug 输出用于 replay、验收和 Web 复核：

```text
CleanedTrackDebugResult:
  result
  rawPointDecisions[]
  cleaningOperations[]
  barometerWindowDecisions[]
  rejectedRawPoints[]
  debugFindings[]
```

当前 POC 的 debug result 已先落最小字段：

```text
CleanedTrackDebugResult:
  cleanedTrack
  rawPointDecisions[]

RawPointDecision:
  rawPointId
  result: accept | reject
  reason
  trackPointId optional
```

`reason` 当前先对齐 Web intake 命名：

```text
intake_accepted
missing_position_source
mock_location
invalid_coordinate
missing_fix_elapsed_realtime
before_record_start
invalid_accuracy
accuracy_too_large
duplicate_fix
out_of_order_fix
sampling_epoch_mismatch
```

## CleaningOperation

建议用清洗动作表达内部情景结果：

```text
CleaningOperation:
  operationId
  kind
  inputRawRange
  outputTrackRange optional
  affectedTrackPointIds[]
  distancePolicy
  movingTimePolicy
  gpxPolicy
  reasonCode
  debugSummary optional
```

`kind` 示例：

```text
CollapseToAnchor
RemoveSpike
BridgeGap
SimplifyPolyline
ExcludeTransport
PreserveEndpoint
ResetBoundary
```

普通 App 不需要展示这些；Web 复核和 replay 报告可以使用。

## FFI JSON API

第一版跨端 API 保持简单：

```c
char* track_process_json(const char* input_json);
void track_free_string(char* ptr);
```

`track_process_debug_json` 属于后续 debug API，不是当前 POC 的必需入口。

CLI 当前已提供 debug 输出：

```bash
track-cli process-debug input.json
```

输入 JSON：

```json
{
  "config": {},
  "input": {
    "sessionContext": {},
    "samplingEpochs": [],
    "locationSamples": [],
    "motionWindows": [],
    "barometerWindows": []
  }
}
```

输出 JSON：

```json
{
  "ok": true,
  "result": {
    "trackPoints": [
      {
        "trackPointId": 1,
        "sourceRawPointId": 1,
        "latitude": 30,
        "longitude": 120,
        "trackDirectionDegrees": null
      }
    ],
    "segments": [],
    "gpxTrackPoints": [
      {
        "trackPointId": 1,
        "sourceRawPointId": 1,
        "latitude": 30,
        "longitude": 120,
        "trackDirectionDegrees": null
      }
    ],
    "summary": {
      "totalDistanceMeters": 0,
      "movingTimeSeconds": 0,
      "paceSecondsPerKm": null,
      "ascentMeters": 0
    }
  }
}
```

错误输出：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_input",
    "message": "locationSamples is required"
  }
}
```

## 流式 API

流式 API 不是第一阶段目标。等批处理结果稳定后，再提供：

```rust
pub struct SessionEngine;

impl SessionEngine {
    pub fn start(context: SessionContext, config: TrackConfig) -> Self;
    pub fn append_location(&mut self, sample: NormalizedLocationSample);
    pub fn append_motion(&mut self, window: NormalizedMotionWindow);
    pub fn append_barometer(&mut self, window: NormalizedBarometerWindow);
    pub fn snapshot(&self) -> CleanedTrackResult;
    pub fn finish(self) -> CleanedTrackResult;
}
```

早期 `snapshot()` 和 `finish()` 可以复用批处理 `process()`。只有在性能瓶颈明确后，
才逐步增量化热点模块。
