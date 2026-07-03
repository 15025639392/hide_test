#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackConfig {
    pub strategy_version: Option<String>,
}

impl TrackConfig {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub session_id: String,
    pub strategy_version: String,
    pub created_elapsed_realtime_nanos: i64,
    pub created_wall_time_millis: i64,
    pub device_model: Option<String>,
    pub completion_state: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SamplingEpoch {
    pub epoch_id: String,
    pub state: String,
    pub started_elapsed_realtime_nanos: i64,
    pub requested_min_time_ms: i64,
    pub requested_min_distance_meters: f64,
}

impl SamplingEpoch {
    #[must_use]
    pub fn new(
        epoch_id: impl Into<String>,
        state: impl Into<String>,
        started_elapsed_realtime_nanos: i64,
    ) -> Self {
        Self {
            epoch_id: epoch_id.into(),
            state: state.into(),
            started_elapsed_realtime_nanos,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedLocationSample {
    #[serde(rename = "sampleId", alias = "rawPointId")]
    pub sample_id: i64,
    #[serde(rename = "provider", alias = "positioningSource")]
    pub provider: String,
    #[serde(rename = "lat", alias = "latitude")]
    pub lat: f64,
    #[serde(rename = "lng", alias = "longitude")]
    pub lng: f64,
    pub horizontal_accuracy_meters: f64,
    pub altitude_meters: Option<f64>,
    pub vertical_accuracy_meters: Option<f64>,
    pub speed_meters_per_second: Option<f64>,
    pub bearing_degrees: Option<f64>,
    pub wall_time_millis: i64,
    #[serde(rename = "fixElapsedRealtimeNanos", alias = "elapsedRealtimeNanos")]
    pub fix_elapsed_realtime_nanos: i64,
    pub is_mock: bool,
    pub sampling_epoch_id: Option<String>,
    #[serde(
        rename = "receivedElapsedRealtimeNanos",
        alias = "callbackReceivedElapsedRealtimeNanos"
    )]
    pub received_elapsed_realtime_nanos: Option<i64>,
    pub callback_delay_nanos: Option<i64>,
}

impl NormalizedLocationSample {
    #[must_use]
    pub fn new(
        sample_id: i64,
        provider: impl Into<String>,
        lat: f64,
        lng: f64,
        wall_time_millis: i64,
        fix_elapsed_realtime_nanos: i64,
    ) -> Self {
        Self {
            sample_id,
            provider: provider.into(),
            lat,
            lng,
            wall_time_millis,
            fix_elapsed_realtime_nanos,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedMotionWindow {
    pub window_id: String,
    #[serde(alias = "firstElapsedRealtimeNanos")]
    pub start_elapsed_realtime_nanos: i64,
    #[serde(alias = "lastElapsedRealtimeNanos")]
    pub end_elapsed_realtime_nanos: i64,
    pub linear_acceleration_rms_mps2: Option<f64>,
    #[serde(alias = "dynamicAccelRmsMps2")]
    pub accelerometer_dynamic_rms_mps2: Option<f64>,
    pub gyroscope_rms_radps: Option<f64>,
    pub yaw_delta_degrees: Option<f64>,
    pub pitch_delta_degrees: Option<f64>,
    pub roll_delta_degrees: Option<f64>,
    pub step_detector_count: Option<i64>,
    #[serde(alias = "stepDelta")]
    pub step_counter_delta: Option<i64>,
    #[serde(alias = "isDeviceStill")]
    pub device_still: Option<bool>,
}

impl NormalizedMotionWindow {
    #[must_use]
    pub fn new(
        window_id: impl Into<String>,
        start_elapsed_realtime_nanos: i64,
        end_elapsed_realtime_nanos: i64,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            start_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct NormalizedBarometerWindow {
    pub window_id: String,
    pub start_elapsed_realtime_nanos: i64,
    pub end_elapsed_realtime_nanos: i64,
    pub sample_count: i64,
    pub min_pressure_hpa: f64,
    pub max_pressure_hpa: f64,
    pub avg_pressure_hpa: f64,
    pub delta_pressure_hpa: f64,
    pub min_raw_barometer_altitude_meters: f64,
    pub max_raw_barometer_altitude_meters: f64,
    pub avg_raw_barometer_altitude_meters: f64,
    pub delta_raw_barometer_altitude_meters: f64,
    pub window_ascent_meters: Option<f64>,
    pub window_descent_meters: Option<f64>,
    pub last_sensor_accuracy: Option<i64>,
}

impl NormalizedBarometerWindow {
    #[must_use]
    pub fn new(
        window_id: impl Into<String>,
        start_elapsed_realtime_nanos: i64,
        end_elapsed_realtime_nanos: i64,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            start_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BarometerCalibration {
    pub calibration_id: String,
    pub source: String,
    pub raw_barometer_altitude_meters: f64,
    pub reference_altitude_meters: f64,
    pub calibration_offset_meters: f64,
    pub pressure_sample_elapsed_realtime_nanos: i64,
}

impl BarometerCalibration {
    #[must_use]
    pub fn new(calibration_id: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            calibration_id: calibration_id.into(),
            source: source.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutdoorTrackInput {
    pub session_context: SessionContext,
    #[serde(default)]
    pub sampling_epochs: Vec<SamplingEpoch>,
    #[serde(default)]
    pub location_samples: Vec<NormalizedLocationSample>,
    #[serde(default)]
    pub motion_windows: Vec<NormalizedMotionWindow>,
    #[serde(default)]
    pub barometer_windows: Vec<NormalizedBarometerWindow>,
    #[serde(default)]
    pub barometer_calibrations: Vec<BarometerCalibration>,
}

impl OutdoorTrackInput {
    #[must_use]
    pub fn new(session_context: SessionContext) -> Self {
        Self {
            session_context,
            ..Self::default()
        }
    }

    #[must_use]
    pub fn with_location_samples(
        session_context: SessionContext,
        location_samples: Vec<NormalizedLocationSample>,
    ) -> Self {
        Self {
            session_context,
            location_samples,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EvidenceJsonlError {
    pub code: &'static str,
    pub message: String,
}

impl EvidenceJsonlError {
    #[must_use]
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn evidence_jsonl_to_process_request(
    input: &str,
) -> Result<ProcessRequest, EvidenceJsonlError> {
    let mut context: Option<SessionContext> = None;
    let mut sampling_epochs = Vec::new();
    let mut location_samples = Vec::new();
    let mut motion_windows = Vec::new();
    let mut barometer_windows = Vec::new();

    for (line_index, line) in input.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(trimmed).map_err(|error| {
            EvidenceJsonlError::new(
                "invalid_jsonl",
                format!("invalid JSONL at line {}: {error}", line_index + 1),
            )
        })?;
        match string_field(&event, "event").as_deref() {
            Some("session_metadata") => {
                context = Some(session_context_from_event(&event));
            }
            Some("sampling_policy") => {
                sampling_epochs.push(sampling_epoch_from_event(&event));
            }
            Some("location_sample") | Some("raw_location") => {
                if let Some(sample) = location_sample_from_event(&event) {
                    location_samples.push(sample);
                }
            }
            Some("motion_window") | Some("device_motion_window") => {
                motion_windows.push(motion_window_from_event(&event));
            }
            Some("barometer_window") => {
                barometer_windows.push(barometer_window_from_event(&event));
            }
            _ => {}
        }
    }

    let context = context.unwrap_or_else(|| fallback_session_context(&location_samples));
    Ok(ProcessRequest {
        schema_version: Some("track-sdk-process-request-v1".to_string()),
        config: TrackConfig::default(),
        input: OutdoorTrackInput {
            session_context: context,
            sampling_epochs,
            location_samples,
            motion_windows,
            barometer_windows,
            barometer_calibrations: Vec::new(),
        },
    })
}

fn session_context_from_event(event: &Value) -> SessionContext {
    SessionContext {
        session_id: string_field(event, "sessionId").unwrap_or_default(),
        strategy_version: string_field(event, "strategyVersion")
            .unwrap_or_else(|| "outdoor-track-evidence-v1".to_string()),
        created_elapsed_realtime_nanos: i64_field(event, "createdElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "recordStartElapsedRealtimeNanos"))
            .or_else(|| i64_field(event, "eventElapsedRealtimeNanos"))
            .unwrap_or_default(),
        created_wall_time_millis: i64_field(event, "createdWallTimeMillis")
            .or_else(|| i64_field(event, "eventWallTimeMillis"))
            .unwrap_or_default(),
        device_model: string_field(event, "deviceModel"),
        completion_state: string_field(event, "completionState"),
    }
}

fn sampling_epoch_from_event(event: &Value) -> SamplingEpoch {
    SamplingEpoch {
        epoch_id: string_field(event, "samplingEpochId")
            .or_else(|| string_field(event, "epochId"))
            .unwrap_or_default(),
        state: string_field(event, "state")
            .or_else(|| string_field(event, "samplingState"))
            .unwrap_or_default(),
        started_elapsed_realtime_nanos: i64_field(event, "startedElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "samplingEpochStartedElapsedRealtimeNanos"))
            .or_else(|| i64_field(event, "locationRequestRegisteredElapsedRealtimeNanos"))
            .or_else(|| i64_field(event, "eventElapsedRealtimeNanos"))
            .unwrap_or_default(),
        requested_min_time_ms: i64_field(event, "requestedMinTimeMs")
            .or_else(|| i64_field(event, "locationRequestMinTimeMs"))
            .unwrap_or_default(),
        requested_min_distance_meters: f64_field(event, "requestedMinDistanceMeters")
            .or_else(|| f64_field(event, "locationRequestMinDistanceMeters"))
            .unwrap_or_default(),
    }
}

fn location_sample_from_event(event: &Value) -> Option<NormalizedLocationSample> {
    let lat = f64_field(event, "lat").or_else(|| f64_field(event, "latitude"))?;
    let lng = f64_field(event, "lng").or_else(|| f64_field(event, "longitude"))?;
    let sample_id = i64_field(event, "sampleId").or_else(|| i64_field(event, "rawPointId"))?;
    Some(NormalizedLocationSample {
        sample_id,
        provider: string_field(event, "provider")
            .or_else(|| string_field(event, "source"))
            .or_else(|| string_field(event, "sourceKind"))
            .or_else(|| string_field(event, "trustClass"))
            .unwrap_or_default(),
        lat,
        lng,
        horizontal_accuracy_meters: f64_field(event, "horizontalAccuracyMeters")
            .or_else(|| f64_field(event, "accuracy"))
            .unwrap_or_default(),
        altitude_meters: f64_field(event, "altitudeMeters")
            .or_else(|| f64_field(event, "altitude")),
        vertical_accuracy_meters: f64_field(event, "verticalAccuracyMeters")
            .or_else(|| f64_field(event, "verticalAccuracy")),
        speed_meters_per_second: f64_field(event, "speedMetersPerSecond")
            .or_else(|| f64_field(event, "speed")),
        bearing_degrees: f64_field(event, "bearingDegrees").or_else(|| f64_field(event, "bearing")),
        wall_time_millis: i64_field(event, "wallTimeMillis")
            .or_else(|| i64_field(event, "timeMillis"))
            .or_else(|| i64_field(event, "eventWallTimeMillis"))
            .unwrap_or_default(),
        fix_elapsed_realtime_nanos: i64_field(event, "fixElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "elapsedRealtimeNanos"))
            .unwrap_or_default(),
        is_mock: bool_field(event, "isMock")
            || bool_field(event, "mock")
            || bool_field(event, "isFromMockProvider"),
        sampling_epoch_id: string_field(event, "samplingEpochId"),
        received_elapsed_realtime_nanos: i64_field(event, "receivedElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "callbackReceivedElapsedRealtimeNanos")),
        callback_delay_nanos: i64_field(event, "callbackDelayNanos"),
    })
}

fn motion_window_from_event(event: &Value) -> NormalizedMotionWindow {
    NormalizedMotionWindow {
        window_id: string_field(event, "windowId").unwrap_or_default(),
        start_elapsed_realtime_nanos: i64_field(event, "startElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "firstElapsedRealtimeNanos"))
            .unwrap_or_default(),
        end_elapsed_realtime_nanos: i64_field(event, "endElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "lastElapsedRealtimeNanos"))
            .unwrap_or_default(),
        linear_acceleration_rms_mps2: f64_field(event, "linearAccelerationRmsMps2"),
        accelerometer_dynamic_rms_mps2: f64_field(event, "accelerometerDynamicRmsMps2")
            .or_else(|| f64_field(event, "dynamicAccelRmsMps2")),
        gyroscope_rms_radps: f64_field(event, "gyroscopeRmsRadps"),
        yaw_delta_degrees: f64_field(event, "yawDeltaDegrees"),
        pitch_delta_degrees: f64_field(event, "pitchDeltaDegrees"),
        roll_delta_degrees: f64_field(event, "rollDeltaDegrees"),
        step_detector_count: i64_field(event, "stepDetectorCount"),
        step_counter_delta: i64_field(event, "stepCounterDelta")
            .or_else(|| i64_field(event, "stepDelta")),
        device_still: optional_bool_field(event, "deviceStill")
            .or_else(|| optional_bool_field(event, "isDeviceStill")),
    }
}

fn barometer_window_from_event(event: &Value) -> NormalizedBarometerWindow {
    NormalizedBarometerWindow {
        window_id: string_field(event, "windowId")
            .or_else(|| string_field(event, "barometerWindowId"))
            .unwrap_or_default(),
        start_elapsed_realtime_nanos: i64_field(event, "startElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "firstElapsedRealtimeNanos"))
            .unwrap_or_default(),
        end_elapsed_realtime_nanos: i64_field(event, "endElapsedRealtimeNanos")
            .or_else(|| i64_field(event, "lastElapsedRealtimeNanos"))
            .unwrap_or_default(),
        sample_count: i64_field(event, "sampleCount").unwrap_or_default(),
        min_pressure_hpa: f64_field(event, "minPressureHpa").unwrap_or_default(),
        max_pressure_hpa: f64_field(event, "maxPressureHpa").unwrap_or_default(),
        avg_pressure_hpa: f64_field(event, "avgPressureHpa").unwrap_or_default(),
        delta_pressure_hpa: f64_field(event, "deltaPressureHpa").unwrap_or_default(),
        min_raw_barometer_altitude_meters: f64_field(event, "minRawBarometerAltitudeMeters")
            .unwrap_or_default(),
        max_raw_barometer_altitude_meters: f64_field(event, "maxRawBarometerAltitudeMeters")
            .unwrap_or_default(),
        avg_raw_barometer_altitude_meters: f64_field(event, "avgRawBarometerAltitudeMeters")
            .or_else(|| f64_field(event, "avgBarometerAltitudeMeters"))
            .unwrap_or_default(),
        delta_raw_barometer_altitude_meters: f64_field(event, "deltaRawBarometerAltitudeMeters")
            .or_else(|| f64_field(event, "deltaRawAltitudeMeters"))
            .unwrap_or_default(),
        window_ascent_meters: f64_field(event, "windowAscentMeters"),
        window_descent_meters: f64_field(event, "windowDescentMeters"),
        last_sensor_accuracy: i64_field(event, "lastSensorAccuracy"),
    }
}

fn fallback_session_context(samples: &[NormalizedLocationSample]) -> SessionContext {
    SessionContext {
        session_id: "unknown-session".to_string(),
        strategy_version: "outdoor-track-evidence-v1".to_string(),
        created_elapsed_realtime_nanos: samples
            .first()
            .map(|sample| sample.fix_elapsed_realtime_nanos)
            .unwrap_or_default(),
        created_wall_time_millis: samples
            .first()
            .map(|sample| sample.wall_time_millis)
            .unwrap_or_default(),
        device_model: None,
        completion_state: None,
    }
}

fn string_field(event: &Value, field: &str) -> Option<String> {
    match event.get(field)? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn i64_field(event: &Value, field: &str) -> Option<i64> {
    match event.get(field)? {
        Value::Number(value) => value.as_i64().or_else(|| value.as_u64()?.try_into().ok()),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn f64_field(event: &Value, field: &str) -> Option<f64> {
    match event.get(field)? {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn bool_field(event: &Value, field: &str) -> bool {
    match event.get(field) {
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => value == "true",
        _ => false,
    }
}

fn optional_bool_field(event: &Value, field: &str) -> Option<bool> {
    match event.get(field)? {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanedTrackPoint {
    pub track_point_id: i64,
    #[serde(rename = "sourceSampleId", alias = "sourceRawPointId")]
    pub source_sample_id: i64,
    #[serde(rename = "lat", alias = "latitude")]
    pub lat: f64,
    #[serde(rename = "lng", alias = "longitude")]
    pub lng: f64,
    pub track_direction_degrees: Option<f64>,
    #[serde(rename = "fixElapsedRealtimeNanos", alias = "elapsedRealtimeNanos")]
    pub fix_elapsed_realtime_nanos: i64,
    pub wall_time_millis: i64,
    pub horizontal_accuracy_meters: f64,
    pub distance_delta_meters: f64,
    pub moving_time_delta_seconds: f64,
    pub segment_id: i64,
}

impl CleanedTrackPoint {
    #[must_use]
    pub fn new(
        track_point_id: i64,
        source_sample_id: i64,
        lat: f64,
        lng: f64,
        fix_elapsed_realtime_nanos: i64,
        wall_time_millis: i64,
    ) -> Self {
        Self {
            track_point_id,
            source_sample_id,
            lat,
            lng,
            fix_elapsed_realtime_nanos,
            wall_time_millis,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanedTrackSegment {
    pub segment_id: i64,
    pub start_track_point_id: i64,
    pub end_track_point_id: i64,
    pub distance_meters: f64,
    pub moving_time_seconds: f64,
}

impl CleanedTrackSegment {
    #[must_use]
    pub fn new(segment_id: i64, start_track_point_id: i64, end_track_point_id: i64) -> Self {
        Self {
            segment_id,
            start_track_point_id,
            end_track_point_id,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    pub total_distance_meters: f64,
    pub moving_time_seconds: f64,
    pub pace_seconds_per_km: Option<f64>,
    #[serde(rename = "totalAscentMeters", alias = "ascentMeters")]
    pub total_ascent_meters: f64,
    pub total_descent_meters: f64,
    pub selected_elevation_source: String,
}

impl Default for TrackSummary {
    fn default() -> Self {
        Self {
            total_distance_meters: 0.0,
            moving_time_seconds: 0.0,
            pace_seconds_per_km: None,
            total_ascent_meters: 0.0,
            total_descent_meters: 0.0,
            selected_elevation_source: "NONE".to_string(),
        }
    }
}

impl TrackSummary {
    #[must_use]
    pub fn from_metrics(
        total_distance_meters: f64,
        moving_time_seconds: f64,
        total_ascent_meters: f64,
    ) -> Self {
        Self {
            total_distance_meters,
            moving_time_seconds,
            pace_seconds_per_km: pace_seconds_per_km(total_distance_meters, moving_time_seconds),
            total_ascent_meters,
            total_descent_meters: 0.0,
            selected_elevation_source: "NONE".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanedTrackResult {
    #[serde(default)]
    pub track_points: Vec<CleanedTrackPoint>,
    #[serde(default)]
    pub segments: Vec<CleanedTrackSegment>,
    #[serde(default)]
    pub gpx_track_points: Vec<CleanedTrackPoint>,
    pub summary: TrackSummary,
}

impl CleanedTrackResult {
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn from_parts(
        track_points: Vec<CleanedTrackPoint>,
        segments: Vec<CleanedTrackSegment>,
        gpx_track_points: Vec<CleanedTrackPoint>,
        summary: TrackSummary,
    ) -> Self {
        Self {
            track_points,
            segments,
            gpx_track_points,
            summary,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawPointDecision {
    #[serde(rename = "sampleId", alias = "rawPointId")]
    pub sample_id: i64,
    pub result: String,
    pub reason: String,
    pub track_point_id: Option<i64>,
    #[serde(default)]
    pub metric_owner: bool,
    #[serde(default)]
    pub affected_metric_gates: Vec<String>,
}

impl RawPointDecision {
    #[must_use]
    pub fn accept(sample_id: i64, reason: impl Into<String>, track_point_id: i64) -> Self {
        Self {
            sample_id,
            result: "accept".to_string(),
            reason: reason.into(),
            track_point_id: Some(track_point_id),
            metric_owner: true,
            affected_metric_gates: route_distance_time_gates(),
        }
    }

    #[must_use]
    pub fn reject(sample_id: i64, reason: impl Into<String>) -> Self {
        Self {
            sample_id,
            result: "reject".to_string(),
            reason: reason.into(),
            track_point_id: None,
            metric_owner: false,
            affected_metric_gates: Vec::new(),
        }
    }

    #[must_use]
    pub fn weak(sample_id: i64, reason: impl Into<String>) -> Self {
        Self {
            sample_id,
            result: "weak".to_string(),
            reason: reason.into(),
            track_point_id: None,
            metric_owner: false,
            affected_metric_gates: Vec::new(),
        }
    }
}

fn route_distance_time_gates() -> Vec<String> {
    ["route", "distance", "moving_time"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SampleRange {
    pub start_sample_id: i64,
    pub end_sample_id: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleaningOperation {
    pub operation_id: String,
    pub kind: String,
    #[serde(rename = "inputSampleRange", alias = "inputRawRange")]
    pub input_sample_range: SampleRange,
    pub distance_policy: String,
    pub moving_time_policy: String,
    pub elevation_policy: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MetricOwnershipRange {
    pub owner_id: String,
    #[serde(rename = "sampleRange", alias = "rawRange")]
    pub sample_range: SampleRange,
    pub affected_metric_gates: Vec<String>,
    pub hard_boundary: bool,
}

impl MetricOwnershipRange {
    #[must_use]
    pub fn from_metric_owner_decision(decision: &RawPointDecision) -> Option<Self> {
        if !decision.metric_owner || decision.affected_metric_gates.is_empty() {
            return None;
        }
        Some(Self {
            owner_id: format!("sample-decision:{}", decision.sample_id),
            sample_range: SampleRange {
                start_sample_id: decision.sample_id,
                end_sample_id: decision.sample_id,
            },
            affected_metric_gates: decision.affected_metric_gates.clone(),
            hard_boundary: false,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDiagnostics {
    pub engine: String,
    pub settlement_scope: String,
    pub notes: Vec<String>,
}

impl Default for ReplayDiagnostics {
    fn default() -> Self {
        Self {
            engine: "rust-poc".to_string(),
            settlement_scope: "base_kernel_only".to_string(),
            notes: vec![
                "No local settlement operations are emitted by the Rust POC yet.".to_string(),
            ],
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanedTrackDebugResult {
    pub cleaned_track: CleanedTrackResult,
    #[serde(default)]
    pub raw_point_decisions: Vec<RawPointDecision>,
    #[serde(default)]
    pub cleaning_operations: Vec<CleaningOperation>,
    #[serde(default)]
    pub metric_ownership_ranges: Vec<MetricOwnershipRange>,
    #[serde(default)]
    pub replay_diagnostics: ReplayDiagnostics,
}

impl CleanedTrackDebugResult {
    #[must_use]
    pub fn new(
        cleaned_track: CleanedTrackResult,
        raw_point_decisions: Vec<RawPointDecision>,
    ) -> Self {
        let metric_ownership_ranges = raw_point_decisions
            .iter()
            .filter_map(MetricOwnershipRange::from_metric_owner_decision)
            .collect();
        Self {
            cleaned_track,
            raw_point_decisions,
            cleaning_operations: Vec::new(),
            metric_ownership_ranges,
            replay_diagnostics: ReplayDiagnostics::default(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<String>,
    #[serde(default)]
    pub config: TrackConfig,
    pub input: OutdoorTrackInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackError {
    pub code: String,
    pub message: String,
}

impl TrackError {
    #[must_use]
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductTrackPoint {
    pub track_point_id: i64,
    pub source_sample_id: i64,
    pub lat: f64,
    pub lng: f64,
    pub track_direction_degrees: Option<f64>,
    pub fix_elapsed_realtime_nanos: i64,
    pub wall_time_millis: i64,
    pub horizontal_accuracy_meters: f64,
    pub distance_delta_meters: f64,
    pub segment_id: i64,
}

impl From<&CleanedTrackPoint> for ProductTrackPoint {
    fn from(point: &CleanedTrackPoint) -> Self {
        Self {
            track_point_id: point.track_point_id,
            source_sample_id: point.source_sample_id,
            lat: point.lat,
            lng: point.lng,
            track_direction_degrees: point.track_direction_degrees,
            fix_elapsed_realtime_nanos: point.fix_elapsed_realtime_nanos,
            wall_time_millis: point.wall_time_millis,
            horizontal_accuracy_meters: point.horizontal_accuracy_meters,
            distance_delta_meters: point.distance_delta_meters,
            segment_id: point.segment_id,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductSnapshot {
    #[serde(default)]
    pub track_points: Vec<ProductTrackPoint>,
    pub total_distance_meters: f64,
    pub total_ascent_meters: f64,
    pub total_descent_meters: f64,
    pub selected_elevation_source: String,
}

impl From<&CleanedTrackResult> for ProductSnapshot {
    fn from(result: &CleanedTrackResult) -> Self {
        Self {
            track_points: result
                .track_points
                .iter()
                .map(ProductTrackPoint::from)
                .collect(),
            total_distance_meters: result.summary.total_distance_meters,
            total_ascent_meters: result.summary.total_ascent_meters,
            total_descent_meters: result.summary.total_descent_meters,
            selected_elevation_source: result.summary.selected_elevation_source.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<CleanedTrackResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TrackError>,
}

impl ProcessResponse {
    #[must_use]
    pub fn ok(result: CleanedTrackResult) -> Self {
        Self {
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    #[must_use]
    pub fn error(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(TrackError::new(code, message)),
        }
    }
}

impl SessionContext {
    pub fn new(session_id: impl Into<String>, strategy_version: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            strategy_version: strategy_version.into(),
            ..Self::default()
        }
    }
}

fn pace_seconds_per_km(total_distance_meters: f64, moving_time_seconds: f64) -> Option<f64> {
    if total_distance_meters > 0.0 && moving_time_seconds > 0.0 {
        Some(moving_time_seconds / (total_distance_meters / 1_000.0))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_input_field_names_as_camel_case() {
        let mut location = NormalizedLocationSample::new(1, "gnss", 30.0, 120.0, 1_000, 2_000);
        location.horizontal_accuracy_meters = 8.0;
        location.sampling_epoch_id = Some("epoch-1".to_string());
        location.callback_delay_nanos = Some(12);

        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![SamplingEpoch::new("epoch-1", "active", 2_000)],
            location_samples: vec![location],
            motion_windows: vec![NormalizedMotionWindow::new("motion-1", 2_000, 3_000)],
            barometer_windows: vec![NormalizedBarometerWindow {
                avg_pressure_hpa: 1_013.25,
                ..NormalizedBarometerWindow::new("barometer-1", 2_000, 3_000)
            }],
            barometer_calibrations: vec![BarometerCalibration {
                reference_altitude_meters: 42.0,
                ..BarometerCalibration::new("calibration-1", "gps_reference")
            }],
        };

        let json = serde_json::to_value(input).unwrap();

        assert!(json.get("sessionContext").is_some());
        assert!(json.get("samplingEpochs").is_some());
        assert!(json.get("locationSamples").is_some());
        assert!(json.get("motionWindows").is_some());
        assert!(json.get("barometerWindows").is_some());
        assert!(json.get("barometerCalibrations").is_some());
        assert!(json.get("session_context").is_none());
        assert_eq!(json["sessionContext"]["sessionId"], "session-1");
        assert_eq!(
            json["samplingEpochs"][0]["startedElapsedRealtimeNanos"],
            2_000
        );
        assert_eq!(json["locationSamples"][0]["sampleId"], 1);
        assert!(json["locationSamples"][0].get("rawPointId").is_none());
        assert_eq!(json["locationSamples"][0]["provider"], "gnss");
        assert!(json["locationSamples"][0]
            .get("positioningSource")
            .is_none());
        assert_eq!(json["locationSamples"][0]["lat"], 30.0);
        assert!(json["locationSamples"][0].get("latitude").is_none());
        assert_eq!(json["locationSamples"][0]["lng"], 120.0);
        assert!(json["locationSamples"][0].get("longitude").is_none());
        assert_eq!(json["locationSamples"][0]["fixElapsedRealtimeNanos"], 2_000);
        assert!(json["locationSamples"][0]
            .get("elapsedRealtimeNanos")
            .is_none());
        assert_eq!(json["locationSamples"][0]["horizontalAccuracyMeters"], 8.0);
        assert_eq!(json["locationSamples"][0]["callbackDelayNanos"], 12);
        assert!(json["locationSamples"][0].get("sample_id").is_none());
        assert!(json["motionWindows"][0]
            .get("startElapsedRealtimeNanos")
            .is_some());
        assert!(json["barometerWindows"][0].get("avgPressureHpa").is_some());
        assert!(json["barometerCalibrations"][0]
            .get("referenceAltitudeMeters")
            .is_some());
    }

    #[test]
    fn deserializes_stable_v1_location_sample_aliases() {
        let json = serde_json::json!({
            "sampleId": 7,
            "provider": "gnss",
            "lat": 30.0,
            "lng": 120.0,
            "horizontalAccuracyMeters": 8.0,
            "wallTimeMillis": 1_000,
            "fixElapsedRealtimeNanos": 2_000,
            "isMock": false
        });

        let sample: NormalizedLocationSample = serde_json::from_value(json).unwrap();

        assert_eq!(sample.sample_id, 7);
        assert_eq!(sample.provider, "gnss");
        assert_eq!(sample.lat, 30.0);
        assert_eq!(sample.lng, 120.0);
        assert_eq!(sample.fix_elapsed_realtime_nanos, 2_000);
    }

    #[test]
    fn parses_neutral_evidence_jsonl_to_stable_process_request() {
        let request = evidence_jsonl_to_process_request(
            r#"{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"model-jsonl","strategyVersion":"watch-neutral","createdElapsedRealtimeNanos":1000000000,"createdWallTimeMillis":1000,"deviceModel":"Watch"}
{"schemaVersion":"outdoor-track-evidence-v1","event":"sampling_policy","samplingEpochId":"epoch-1","state":"active","startedElapsedRealtimeNanos":1000000000,"requestedMinTimeMs":1000,"requestedMinDistanceMeters":2}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"model-jsonl","sampleId":1,"provider":"gnss","lat":30,"lng":120,"horizontalAccuracyMeters":8,"altitudeMeters":100,"verticalAccuracyMeters":5,"speedMetersPerSecond":1.2,"bearingDegrees":10,"wallTimeMillis":1000,"fixElapsedRealtimeNanos":1000000000,"receivedElapsedRealtimeNanos":1000000012,"callbackDelayNanos":12,"samplingEpochId":"epoch-1","isMock":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"motion_window","windowId":"motion-1","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"linearAccelerationRmsMps2":0.1,"stepCounterDelta":2,"deviceStill":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"barometer_window","windowId":"baro-1","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":2000000000,"sampleCount":10,"avgRawBarometerAltitudeMeters":101,"deltaRawBarometerAltitudeMeters":1,"windowAscentMeters":1,"windowDescentMeters":0}
"#,
        )
        .unwrap();

        assert_eq!(
            request.schema_version.as_deref(),
            Some("track-sdk-process-request-v1")
        );
        assert_eq!(request.input.session_context.session_id, "model-jsonl");
        assert_eq!(
            request.input.session_context.strategy_version,
            "watch-neutral"
        );
        assert_eq!(
            request.input.session_context.device_model.as_deref(),
            Some("Watch")
        );
        assert_eq!(request.input.sampling_epochs[0].epoch_id, "epoch-1");
        assert_eq!(request.input.location_samples[0].sample_id, 1);
        assert_eq!(request.input.location_samples[0].provider, "gnss");
        assert_eq!(request.input.location_samples[0].lat, 30.0);
        assert_eq!(request.input.location_samples[0].lng, 120.0);
        assert_eq!(
            request.input.location_samples[0].fix_elapsed_realtime_nanos,
            1_000_000_000
        );
        assert_eq!(request.input.motion_windows[0].window_id, "motion-1");
        assert_eq!(request.input.barometer_windows[0].window_id, "baro-1");
        assert_eq!(
            request.input.barometer_windows[0].window_ascent_meters,
            Some(1.0)
        );
        assert_eq!(
            request.input.barometer_windows[0].window_descent_meters,
            Some(0.0)
        );
    }

    #[test]
    fn product_snapshot_serializes_only_lightweight_product_fields() {
        let point = CleanedTrackPoint {
            horizontal_accuracy_meters: 8.0,
            distance_delta_meters: 10.0,
            moving_time_delta_seconds: 5.0,
            segment_id: 1,
            ..CleanedTrackPoint::new(1, 7, 30.0, 120.0, 2_000, 1_000)
        };
        let result = CleanedTrackResult::from_parts(
            vec![point],
            Vec::new(),
            Vec::new(),
            TrackSummary {
                total_distance_meters: 10.0,
                moving_time_seconds: 5.0,
                pace_seconds_per_km: Some(500.0),
                total_ascent_meters: 2.0,
                total_descent_meters: 1.0,
                selected_elevation_source: "BAROMETER".to_string(),
            },
        );

        let snapshot = ProductSnapshot::from(&result);
        let json = serde_json::to_value(snapshot).unwrap();

        assert_eq!(json["totalDistanceMeters"], 10.0);
        assert_eq!(json["totalAscentMeters"], 2.0);
        assert_eq!(json["totalDescentMeters"], 1.0);
        assert_eq!(json["selectedElevationSource"], "BAROMETER");
        assert!(json.get("movingTimeSeconds").is_none());
        assert!(json.get("paceSecondsPerKm").is_none());
        assert_eq!(json["trackPoints"][0]["sourceSampleId"], 7);
        assert!(json["trackPoints"][0]
            .get("movingTimeDeltaSeconds")
            .is_none());
    }

    #[test]
    fn serializes_result_and_config_field_names_as_camel_case() {
        let point = CleanedTrackPoint {
            horizontal_accuracy_meters: 8.0,
            distance_delta_meters: 10.0,
            moving_time_delta_seconds: 5.0,
            segment_id: 1,
            ..CleanedTrackPoint::new(1, 1, 30.0, 120.0, 2_000, 1_000)
        };
        let segment = CleanedTrackSegment {
            distance_meters: 10.0,
            moving_time_seconds: 5.0,
            ..CleanedTrackSegment::new(1, 1, 1)
        };
        let result = CleanedTrackResult::from_parts(
            vec![point.clone()],
            vec![segment],
            vec![point],
            TrackSummary::from_metrics(10.0, 5.0, 1.0),
        );
        let config = TrackConfig {
            strategy_version: Some("stage2-track-trust-v3-sampling-cloud".to_string()),
        };

        let response = ProcessResponse::ok(result.clone());
        let result_json = serde_json::to_value(&result).unwrap();
        let response_json = serde_json::to_value(response).unwrap();
        let config_json = serde_json::to_value(config).unwrap();

        assert!(result_json.get("trackPoints").is_some());
        assert!(result_json.get("gpxTrackPoints").is_some());
        assert!(result_json.get("track_points").is_none());
        assert_eq!(result_json["trackPoints"][0]["sourceSampleId"], 1);
        assert!(result_json["trackPoints"][0]
            .get("sourceRawPointId")
            .is_none());
        assert_eq!(result_json["trackPoints"][0]["lat"], 30.0);
        assert!(result_json["trackPoints"][0].get("latitude").is_none());
        assert_eq!(result_json["trackPoints"][0]["lng"], 120.0);
        assert!(result_json["trackPoints"][0].get("longitude").is_none());
        assert_eq!(
            result_json["trackPoints"][0]["fixElapsedRealtimeNanos"],
            2_000
        );
        assert!(result_json["trackPoints"][0]
            .get("elapsedRealtimeNanos")
            .is_none());
        assert!(result_json["trackPoints"][0]
            .get("trackDirectionDegrees")
            .is_some());
        let debug_json = serde_json::to_value(CleanedTrackDebugResult::new(
            result.clone(),
            vec![RawPointDecision::accept(1, "intake_accepted", 1)],
        ))
        .unwrap();
        assert!(debug_json.get("cleanedTrack").is_some());
        assert!(debug_json.get("rawPointDecisions").is_some());
        assert_eq!(debug_json["rawPointDecisions"][0]["sampleId"], 1);
        assert!(debug_json["rawPointDecisions"][0]
            .get("rawPointId")
            .is_none());
        assert_eq!(debug_json["rawPointDecisions"][0]["metricOwner"], true);
        assert_eq!(
            debug_json["rawPointDecisions"][0]["affectedMetricGates"],
            serde_json::json!(["route", "distance", "moving_time"])
        );
        assert_eq!(debug_json["rawPointDecisions"][0]["result"], "accept");
        assert_eq!(
            debug_json["rawPointDecisions"][0]["reason"],
            "intake_accepted"
        );
        assert_eq!(debug_json["cleaningOperations"], serde_json::json!([]));
        assert_eq!(
            debug_json["metricOwnershipRanges"],
            serde_json::json!([{
                "ownerId": "sample-decision:1",
                "sampleRange": {
                    "startSampleId": 1,
                    "endSampleId": 1
                },
                "affectedMetricGates": ["route", "distance", "moving_time"],
                "hardBoundary": false
            }])
        );
        assert!(debug_json["metricOwnershipRanges"][0]
            .get("rawRange")
            .is_none());
        assert_eq!(debug_json["replayDiagnostics"]["engine"], "rust-poc");
        assert_eq!(
            debug_json["replayDiagnostics"]["settlementScope"],
            "base_kernel_only"
        );
        assert_eq!(result_json["segments"][0]["startTrackPointId"], 1);
        assert_eq!(result_json["summary"]["totalDistanceMeters"], 10.0);
        assert_eq!(result_json["summary"]["movingTimeSeconds"], 5.0);
        assert!(result_json["summary"].get("paceSecondsPerKm").is_some());
        assert_eq!(result_json["summary"]["totalAscentMeters"], 1.0);
        assert_eq!(result_json["summary"]["totalDescentMeters"], 0.0);
        assert_eq!(result_json["summary"]["selectedElevationSource"], "NONE");
        assert!(result_json["summary"].get("ascentMeters").is_none());
        assert_eq!(
            config_json["strategyVersion"],
            "stage2-track-trust-v3-sampling-cloud"
        );
        assert!(config_json.get("strategy_version").is_none());
        assert_eq!(response_json["ok"], true);
        assert!(response_json.get("result").is_some());
        assert!(response_json.get("error").is_none());
    }
}
