#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

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
    pub raw_point_id: i64,
    pub positioning_source: String,
    pub latitude: f64,
    pub longitude: f64,
    pub horizontal_accuracy_meters: f64,
    pub altitude_meters: Option<f64>,
    pub vertical_accuracy_meters: Option<f64>,
    pub speed_meters_per_second: Option<f64>,
    pub bearing_degrees: Option<f64>,
    pub wall_time_millis: i64,
    pub elapsed_realtime_nanos: i64,
    pub is_mock: bool,
    pub sampling_epoch_id: Option<String>,
    pub callback_received_elapsed_realtime_nanos: Option<i64>,
    pub callback_delay_nanos: Option<i64>,
}

impl NormalizedLocationSample {
    #[must_use]
    pub fn new(
        raw_point_id: i64,
        positioning_source: impl Into<String>,
        latitude: f64,
        longitude: f64,
        wall_time_millis: i64,
        elapsed_realtime_nanos: i64,
    ) -> Self {
        Self {
            raw_point_id,
            positioning_source: positioning_source.into(),
            latitude,
            longitude,
            wall_time_millis,
            elapsed_realtime_nanos,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedMotionWindow {
    pub window_id: String,
    pub start_elapsed_realtime_nanos: i64,
    pub end_elapsed_realtime_nanos: i64,
    pub linear_acceleration_rms_mps2: Option<f64>,
    pub accelerometer_dynamic_rms_mps2: Option<f64>,
    pub gyroscope_rms_radps: Option<f64>,
    pub yaw_delta_degrees: Option<f64>,
    pub pitch_delta_degrees: Option<f64>,
    pub roll_delta_degrees: Option<f64>,
    pub step_detector_count: Option<i64>,
    pub step_counter_delta: Option<i64>,
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
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanedTrackPoint {
    pub track_point_id: i64,
    pub source_raw_point_id: i64,
    pub latitude: f64,
    pub longitude: f64,
    pub track_direction_degrees: Option<f64>,
    pub elapsed_realtime_nanos: i64,
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
        source_raw_point_id: i64,
        latitude: f64,
        longitude: f64,
        elapsed_realtime_nanos: i64,
        wall_time_millis: i64,
    ) -> Self {
        Self {
            track_point_id,
            source_raw_point_id,
            latitude,
            longitude,
            elapsed_realtime_nanos,
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

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    pub total_distance_meters: f64,
    pub moving_time_seconds: f64,
    pub pace_seconds_per_km: Option<f64>,
    pub ascent_meters: f64,
    pub ascent_source: String,
    pub barometer_ascent_meters: Option<f64>,
    pub gnss_ascent_meters: Option<f64>,
}

impl TrackSummary {
    #[must_use]
    pub fn from_metrics(
        total_distance_meters: f64,
        moving_time_seconds: f64,
        ascent_meters: f64,
    ) -> Self {
        Self {
            total_distance_meters,
            moving_time_seconds,
            pace_seconds_per_km: pace_seconds_per_km(total_distance_meters, moving_time_seconds),
            ascent_meters,
            ascent_source: "NONE".to_string(),
            barometer_ascent_meters: None,
            gnss_ascent_meters: None,
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
    pub raw_point_id: i64,
    pub result: String,
    pub reason: String,
    pub track_point_id: Option<i64>,
}

impl RawPointDecision {
    #[must_use]
    pub fn accept(raw_point_id: i64, reason: impl Into<String>, track_point_id: i64) -> Self {
        Self {
            raw_point_id,
            result: "accept".to_string(),
            reason: reason.into(),
            track_point_id: Some(track_point_id),
        }
    }

    #[must_use]
    pub fn reject(raw_point_id: i64, reason: impl Into<String>) -> Self {
        Self {
            raw_point_id,
            result: "reject".to_string(),
            reason: reason.into(),
            track_point_id: None,
        }
    }

    #[must_use]
    pub fn weak(raw_point_id: i64, reason: impl Into<String>) -> Self {
        Self {
            raw_point_id,
            result: "weak".to_string(),
            reason: reason.into(),
            track_point_id: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BarometerWindowDecision {
    pub window_id: String,
    pub result: String,
    pub reason: String,
    pub ascent_sample_index: Option<i64>,
}

impl BarometerWindowDecision {
    #[must_use]
    pub fn accept(
        window_id: impl Into<String>,
        reason: impl Into<String>,
        ascent_sample_index: i64,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            result: "accept".to_string(),
            reason: reason.into(),
            ascent_sample_index: Some(ascent_sample_index),
        }
    }

    #[must_use]
    pub fn reject(window_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
            result: "reject".to_string(),
            reason: reason.into(),
            ascent_sample_index: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BarometerCalibrationDecision {
    pub calibration_id: String,
    pub result: String,
    pub reason: String,
    pub displayed_barometer_altitude_meters: Option<f64>,
}

impl BarometerCalibrationDecision {
    #[must_use]
    pub fn accept(
        calibration_id: impl Into<String>,
        reason: impl Into<String>,
        displayed_barometer_altitude_meters: f64,
    ) -> Self {
        Self {
            calibration_id: calibration_id.into(),
            result: "accept".to_string(),
            reason: reason.into(),
            displayed_barometer_altitude_meters: Some(displayed_barometer_altitude_meters),
        }
    }

    #[must_use]
    pub fn reject(calibration_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            calibration_id: calibration_id.into(),
            result: "reject".to_string(),
            reason: reason.into(),
            displayed_barometer_altitude_meters: None,
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
    pub barometer_window_decisions: Vec<BarometerWindowDecision>,
    #[serde(default)]
    pub barometer_calibration_decisions: Vec<BarometerCalibrationDecision>,
}

impl CleanedTrackDebugResult {
    #[must_use]
    pub fn new(
        cleaned_track: CleanedTrackResult,
        raw_point_decisions: Vec<RawPointDecision>,
    ) -> Self {
        Self::from_parts(cleaned_track, raw_point_decisions, Vec::new(), Vec::new())
    }

    #[must_use]
    pub fn from_parts(
        cleaned_track: CleanedTrackResult,
        raw_point_decisions: Vec<RawPointDecision>,
        barometer_window_decisions: Vec<BarometerWindowDecision>,
        barometer_calibration_decisions: Vec<BarometerCalibrationDecision>,
    ) -> Self {
        Self {
            cleaned_track,
            raw_point_decisions,
            barometer_window_decisions,
            barometer_calibration_decisions,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRequest {
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
        assert_eq!(json["locationSamples"][0]["rawPointId"], 1);
        assert_eq!(json["locationSamples"][0]["positioningSource"], "gnss");
        assert_eq!(json["locationSamples"][0]["horizontalAccuracyMeters"], 8.0);
        assert_eq!(json["locationSamples"][0]["callbackDelayNanos"], 12);
        assert!(json["locationSamples"][0].get("raw_point_id").is_none());
        assert!(json["motionWindows"][0]
            .get("startElapsedRealtimeNanos")
            .is_some());
        assert!(json["barometerWindows"][0].get("avgPressureHpa").is_some());
        assert!(json["barometerCalibrations"][0]
            .get("referenceAltitudeMeters")
            .is_some());
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
        assert_eq!(result_json["trackPoints"][0]["sourceRawPointId"], 1);
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
        assert_eq!(debug_json["rawPointDecisions"][0]["result"], "accept");
        assert_eq!(
            debug_json["rawPointDecisions"][0]["reason"],
            "intake_accepted"
        );
        assert_eq!(result_json["segments"][0]["startTrackPointId"], 1);
        assert_eq!(result_json["summary"]["totalDistanceMeters"], 10.0);
        assert_eq!(result_json["summary"]["movingTimeSeconds"], 5.0);
        assert!(result_json["summary"].get("paceSecondsPerKm").is_some());
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
