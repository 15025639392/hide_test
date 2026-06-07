#![forbid(unsafe_code)]

mod metrics;

use std::collections::HashSet;

use track_model::{
    BarometerCalibration, BarometerCalibrationDecision, BarometerWindowDecision,
    CleanedTrackDebugResult, CleanedTrackPoint, CleanedTrackResult, CleanedTrackSegment,
    NormalizedBarometerWindow, NormalizedLocationSample, OutdoorTrackInput, RawPointDecision,
    SamplingEpoch, TrackConfig, TrackSummary,
};

use crate::metrics::{haversine_distance_meters, initial_bearing_degrees};

const MAX_HORIZONTAL_ACCURACY_METERS: f64 = 80.0;
const FIRST_FIX_GOOD_ACCURACY_METERS: f64 = 20.0;
const FIRST_FIX_RELAXED_ACCURACY_METERS: f64 = 30.0;
const WEAK_CLOUD_ACCURACY_METERS: f64 = 30.0;
const IMPOSSIBLE_SPEED_METERS_PER_SECOND: f64 = 12.0;
const TRANSPORT_SPEED_METERS_PER_SECOND: f64 = 3.5;
const TRANSPORT_MIN_DISTANCE_METERS: f64 = 20.0;
const GAP_SECONDS: f64 = 120.0;
const RECOVERY_FAST_PATH_ACCURACY_METERS: f64 = 10.0;
const RECOVERY_FAST_PATH_MAX_SPEED_METERS_PER_SECOND: f64 = 2.5;
const RECOVERY_CLOUD_MIN_SAMPLES: usize = 2;
const STATIONARY_DISTANCE_METERS: f64 = 5.0;
const STATIONARY_ACCURACY_MULTIPLIER: f64 = 1.5;
const START_TOLERANCE_NANOS: i64 = 1_000_000_000;
const BAROMETER_ALPHA: f64 = 0.35;
const BAROMETER_CLIMB_THRESHOLD_METERS: f64 = 3.0;
const BAROMETER_DROP_THRESHOLD_METERS: f64 = 1.5;
const MAX_BAROMETER_SAMPLE_GAP_NANOS: i64 = 30_000_000_000;
const MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND: f64 = 2.0;
const BAROMETER_PRESSURE_JUMP_RESET_REJECT_COUNT: usize = 2;
const GNSS_ALPHA: f64 = 0.15;
const MAX_GNSS_VERTICAL_ACCURACY_METERS: f64 = 12.0;
const MAX_GNSS_ASCENT_HORIZONTAL_ACCURACY_METERS: f64 = 30.0;
const MIN_GNSS_ASCENT_HORIZONTAL_DISTANCE_METERS: f64 = 5.0;

pub fn process(input: OutdoorTrackInput, config: TrackConfig) -> CleanedTrackResult {
    process_debug(input, config).cleaned_track
}

pub fn process_debug(input: OutdoorTrackInput, _config: TrackConfig) -> CleanedTrackDebugResult {
    let session_context = input.session_context;
    let sampling_epochs = input.sampling_epochs;
    let barometer_windows = input.barometer_windows;
    let barometer_calibrations = input.barometer_calibrations;
    let mut samples = input.location_samples;
    samples.sort_by_key(|sample| (sample.elapsed_realtime_nanos, sample.raw_point_id));

    let (accepted_samples, raw_point_decisions) = decide_location_samples(
        &samples,
        &sampling_epochs,
        session_context.created_elapsed_realtime_nanos,
    );
    let barometer_ascent = calculate_barometer_ascent(&barometer_windows);
    let gnss_ascent_meters = calculate_gnss_ascent(&accepted_samples);
    let selected_ascent = select_ascent(barometer_ascent.ascent_meters, gnss_ascent_meters);
    let cleaned_track = build_cleaned_track(&accepted_samples, selected_ascent);
    let barometer_calibration_decisions = decide_barometer_calibrations(&barometer_calibrations);

    CleanedTrackDebugResult::from_parts(
        cleaned_track,
        raw_point_decisions,
        barometer_ascent.decisions,
        barometer_calibration_decisions,
    )
}

fn build_cleaned_track(
    accepted_samples: &[AcceptedTrackSample<'_>],
    selected_ascent: SelectedAscent,
) -> CleanedTrackResult {
    let mut track_points = Vec::with_capacity(accepted_samples.len());
    let mut segments = Vec::new();
    let mut total_distance_meters = 0.0;
    let mut moving_time_seconds = 0.0;
    let mut segment_id = 1;
    let mut segment_start_track_point_id = 1;
    let mut segment_distance_meters = 0.0;
    let mut segment_moving_time_seconds = 0.0;

    for (index, sample) in accepted_samples.iter().enumerate() {
        let track_point_id = (index + 1) as i64;
        let (distance_delta_meters, moving_time_delta_seconds, track_direction_degrees) =
            if index == 0 {
                (0.0, 0.0, None)
            } else {
                let previous = accepted_samples[index - 1].sample;
                let sample = sample.sample;
                let distance = haversine_distance_meters(
                    previous.latitude,
                    previous.longitude,
                    sample.latitude,
                    sample.longitude,
                );
                let direction = if distance > 0.0 {
                    initial_bearing_degrees(
                        previous.latitude,
                        previous.longitude,
                        sample.latitude,
                        sample.longitude,
                    )
                } else {
                    None
                };
                let dt_seconds = elapsed_delta_seconds(previous, sample);
                (
                    sample_distance_delta_override(accepted_samples[index], distance),
                    sample_moving_time_delta_override(accepted_samples[index], dt_seconds),
                    direction,
                )
            };
        if index > 0 && sample.starts_new_segment {
            segments.push(CleanedTrackSegment {
                segment_id,
                start_track_point_id: segment_start_track_point_id,
                end_track_point_id: track_point_id - 1,
                distance_meters: segment_distance_meters,
                moving_time_seconds: segment_moving_time_seconds,
            });
            segment_id += 1;
            segment_start_track_point_id = track_point_id;
            segment_distance_meters = 0.0;
            segment_moving_time_seconds = 0.0;
        }

        total_distance_meters += distance_delta_meters;
        moving_time_seconds += moving_time_delta_seconds;
        segment_distance_meters += distance_delta_meters;
        segment_moving_time_seconds += moving_time_delta_seconds;
        track_points.push(CleanedTrackPoint {
            track_point_id,
            source_raw_point_id: sample.sample.raw_point_id,
            latitude: sample.sample.latitude,
            longitude: sample.sample.longitude,
            track_direction_degrees,
            elapsed_realtime_nanos: sample.sample.elapsed_realtime_nanos,
            wall_time_millis: sample.sample.wall_time_millis,
            horizontal_accuracy_meters: sample.sample.horizontal_accuracy_meters,
            distance_delta_meters,
            moving_time_delta_seconds,
            segment_id,
        });
    }

    if !track_points.is_empty() {
        segments.push(CleanedTrackSegment {
            segment_id,
            start_track_point_id: segment_start_track_point_id,
            end_track_point_id: track_points.last().unwrap().track_point_id,
            distance_meters: segment_distance_meters,
            moving_time_seconds: segment_moving_time_seconds,
        });
    }
    let pace_seconds_per_km = if total_distance_meters > 0.0 && moving_time_seconds > 0.0 {
        Some(moving_time_seconds / (total_distance_meters / 1000.0))
    } else {
        None
    };

    CleanedTrackResult {
        gpx_track_points: track_points.clone(),
        track_points,
        segments,
        summary: TrackSummary {
            total_distance_meters,
            moving_time_seconds,
            pace_seconds_per_km,
            ascent_meters: selected_ascent.ascent_meters,
            ascent_source: selected_ascent.source.to_string(),
            barometer_ascent_meters: selected_ascent.barometer_ascent_meters,
            gnss_ascent_meters: selected_ascent.gnss_ascent_meters,
        },
    }
}

#[derive(Clone, Copy)]
struct SelectedAscent {
    ascent_meters: f64,
    source: &'static str,
    barometer_ascent_meters: Option<f64>,
    gnss_ascent_meters: Option<f64>,
}

fn select_ascent(
    barometer_ascent_meters: Option<f64>,
    gnss_ascent_meters: Option<f64>,
) -> SelectedAscent {
    if let Some(ascent_meters) = barometer_ascent_meters {
        SelectedAscent {
            ascent_meters,
            source: "BAROMETER",
            barometer_ascent_meters,
            gnss_ascent_meters,
        }
    } else if let Some(ascent_meters) = gnss_ascent_meters {
        SelectedAscent {
            ascent_meters,
            source: "GNSS",
            barometer_ascent_meters,
            gnss_ascent_meters,
        }
    } else {
        SelectedAscent {
            ascent_meters: 0.0,
            source: "NONE",
            barometer_ascent_meters,
            gnss_ascent_meters,
        }
    }
}

struct BarometerAscentResult {
    ascent_meters: Option<f64>,
    decisions: Vec<BarometerWindowDecision>,
}

fn calculate_barometer_ascent(windows: &[NormalizedBarometerWindow]) -> BarometerAscentResult {
    let mut windows = windows.iter().collect::<Vec<_>>();
    windows.sort_by_key(|window| (window.end_elapsed_realtime_nanos, &window.window_id));

    let mut engine = BarometerAscentEngine::default();
    let mut decisions = Vec::with_capacity(windows.len());
    for window in windows {
        if let Some(reason) = barometer_window_reject_reason(window) {
            decisions.push(BarometerWindowDecision::reject(&window.window_id, reason));
            continue;
        }
        let decision = engine.on_sample(BarometerAltitudeSample {
            elapsed_realtime_nanos: window.end_elapsed_realtime_nanos,
            altitude_meters: window.avg_raw_barometer_altitude_meters,
        });
        decisions.push(match decision {
            BarometerAscentDecision::Accepted {
                reason,
                sample_index,
            } => BarometerWindowDecision::accept(&window.window_id, reason, sample_index as i64),
            BarometerAscentDecision::Rejected(reason) => {
                BarometerWindowDecision::reject(&window.window_id, reason)
            }
        });
    }
    BarometerAscentResult {
        ascent_meters: engine.finish(),
        decisions,
    }
}

fn barometer_window_reject_reason(window: &NormalizedBarometerWindow) -> Option<&'static str> {
    if window.sample_count <= 0 {
        Some("barometer_empty_window")
    } else if window.start_elapsed_realtime_nanos < 0
        || window.end_elapsed_realtime_nanos < window.start_elapsed_realtime_nanos
    {
        Some("barometer_invalid_time_window")
    } else if !window.avg_pressure_hpa.is_finite() || window.avg_pressure_hpa <= 0.0 {
        Some("barometer_invalid_pressure")
    } else if !window.avg_raw_barometer_altitude_meters.is_finite() {
        Some("barometer_invalid_altitude")
    } else {
        None
    }
}

fn decide_barometer_calibrations(
    calibrations: &[BarometerCalibration],
) -> Vec<BarometerCalibrationDecision> {
    let mut calibrations = calibrations.iter().collect::<Vec<_>>();
    calibrations.sort_by_key(|calibration| {
        (
            calibration.pressure_sample_elapsed_realtime_nanos,
            &calibration.calibration_id,
        )
    });

    calibrations
        .into_iter()
        .map(|calibration| {
            if let Some(reason) = barometer_calibration_reject_reason(calibration) {
                BarometerCalibrationDecision::reject(&calibration.calibration_id, reason)
            } else {
                BarometerCalibrationDecision::accept(
                    &calibration.calibration_id,
                    "barometer_calibration_accepted",
                    calibration.raw_barometer_altitude_meters
                        + calibration.calibration_offset_meters,
                )
            }
        })
        .collect()
}

fn barometer_calibration_reject_reason(calibration: &BarometerCalibration) -> Option<&'static str> {
    if calibration.calibration_id.trim().is_empty() {
        Some("barometer_calibration_missing_id")
    } else if calibration.source.trim().is_empty() {
        Some("barometer_calibration_missing_source")
    } else if calibration.pressure_sample_elapsed_realtime_nanos < 0 {
        Some("barometer_calibration_invalid_time")
    } else if !calibration.raw_barometer_altitude_meters.is_finite() {
        Some("barometer_calibration_invalid_raw_altitude")
    } else if !calibration.reference_altitude_meters.is_finite() {
        Some("barometer_calibration_invalid_reference_altitude")
    } else if !calibration.calibration_offset_meters.is_finite() {
        Some("barometer_calibration_invalid_offset")
    } else {
        None
    }
}

fn calculate_gnss_ascent(accepted_samples: &[AcceptedTrackSample<'_>]) -> Option<f64> {
    let mut engine = GnssAscentEngine::default();
    for (index, accepted) in accepted_samples.iter().enumerate() {
        if is_anchor_reason(accepted.decision_reason) {
            if let Some(sample) = gnss_altitude_sample(accepted.sample) {
                engine.reset_altitude_anchor(sample);
            }
            continue;
        }
        if accepted.decision_reason != "moving_good_fix" {
            continue;
        }

        let distance_delta_meters = if index == 0 {
            0.0
        } else {
            let previous = accepted_samples[index - 1].sample;
            let distance = haversine_distance_meters(
                previous.latitude,
                previous.longitude,
                accepted.sample.latitude,
                accepted.sample.longitude,
            );
            sample_distance_delta_override(*accepted, distance)
        };
        if distance_delta_meters < MIN_GNSS_ASCENT_HORIZONTAL_DISTANCE_METERS {
            continue;
        }
        if let Some(sample) = gnss_altitude_sample(accepted.sample) {
            engine.on_sample(sample);
        }
    }
    engine.finish()
}

fn gnss_altitude_sample(sample: &NormalizedLocationSample) -> Option<GnssAltitudeSample> {
    let altitude_meters = sample.altitude_meters?;
    let vertical_accuracy_meters = sample.vertical_accuracy_meters?;
    if altitude_meters.is_finite()
        && vertical_accuracy_meters.is_finite()
        && vertical_accuracy_meters > 0.0
        && vertical_accuracy_meters <= MAX_GNSS_VERTICAL_ACCURACY_METERS
        && sample.horizontal_accuracy_meters > 0.0
        && sample.horizontal_accuracy_meters <= MAX_GNSS_ASCENT_HORIZONTAL_ACCURACY_METERS
    {
        Some(GnssAltitudeSample {
            elapsed_realtime_nanos: sample.elapsed_realtime_nanos,
            altitude_meters,
            vertical_accuracy_meters,
        })
    } else {
        None
    }
}

#[derive(Clone, Copy)]
struct BarometerAltitudeSample {
    elapsed_realtime_nanos: i64,
    altitude_meters: f64,
}

enum BarometerAscentDecision {
    Accepted {
        reason: &'static str,
        sample_index: usize,
    },
    Rejected(&'static str),
}

#[derive(Clone, Copy)]
struct GnssAltitudeSample {
    elapsed_realtime_nanos: i64,
    altitude_meters: f64,
    vertical_accuracy_meters: f64,
}

#[derive(Default)]
struct BarometerAscentEngine {
    total_ascent_meters: f64,
    filtered_altitude: Option<f64>,
    base_altitude: Option<f64>,
    peak_altitude: Option<f64>,
    last_altitude: Option<f64>,
    last_elapsed_realtime_nanos: Option<i64>,
    sample_count: usize,
    consecutive_physical_reject_count: usize,
}

impl BarometerAscentEngine {
    fn on_sample(&mut self, sample: BarometerAltitudeSample) -> BarometerAscentDecision {
        if self.last_elapsed_realtime_nanos.is_some_and(|last| {
            sample.elapsed_realtime_nanos - last > MAX_BAROMETER_SAMPLE_GAP_NANOS
        }) {
            let sample_index = self.reset_altitude_anchor(sample);
            return BarometerAscentDecision::Accepted {
                reason: "barometer_gap_reset",
                sample_index,
            };
        }
        if !self.passes_physical_gate(sample) {
            self.consecutive_physical_reject_count += 1;
            if self.consecutive_physical_reject_count >= BAROMETER_PRESSURE_JUMP_RESET_REJECT_COUNT
            {
                let sample_index = self.reset_altitude_anchor(sample);
                return BarometerAscentDecision::Accepted {
                    reason: "barometer_pressure_jump_reset",
                    sample_index,
                };
            }
            return BarometerAscentDecision::Rejected("barometer_vertical_speed_too_high");
        }

        self.consecutive_physical_reject_count = 0;
        self.sample_count += 1;
        let altitude = self.filter(sample.altitude_meters);
        self.update_trend(altitude, sample.elapsed_realtime_nanos);
        BarometerAscentDecision::Accepted {
            reason: "barometer_sample_accepted",
            sample_index: self.sample_count,
        }
    }

    fn finish(&self) -> Option<f64> {
        if self.sample_count >= 2 {
            Some(self.total_ascent_meters + self.accepted_pending_gain())
        } else {
            None
        }
    }

    fn reset_altitude_anchor(&mut self, sample: BarometerAltitudeSample) -> usize {
        self.total_ascent_meters += self.accepted_pending_gain();
        self.filtered_altitude = None;
        self.base_altitude = None;
        self.peak_altitude = None;
        self.last_altitude = None;
        self.last_elapsed_realtime_nanos = None;
        self.consecutive_physical_reject_count = 0;
        self.sample_count += 1;
        let altitude = self.filter(sample.altitude_meters);
        self.base_altitude = Some(altitude);
        self.peak_altitude = Some(altitude);
        self.last_altitude = Some(altitude);
        self.last_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
        self.sample_count
    }

    fn passes_physical_gate(&self, sample: BarometerAltitudeSample) -> bool {
        let (Some(last_altitude), Some(last_elapsed)) =
            (self.last_altitude, self.last_elapsed_realtime_nanos)
        else {
            return true;
        };
        if sample.elapsed_realtime_nanos <= last_elapsed {
            return false;
        }
        let elapsed_seconds =
            (sample.elapsed_realtime_nanos - last_elapsed) as f64 / 1_000_000_000.0;
        if elapsed_seconds <= 0.0 {
            return true;
        }
        let vertical_speed = (sample.altitude_meters - last_altitude).abs() / elapsed_seconds;
        vertical_speed <= MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND
    }

    fn filter(&mut self, altitude_meters: f64) -> f64 {
        let filtered = self.filtered_altitude.map_or(altitude_meters, |previous| {
            BAROMETER_ALPHA * altitude_meters + (1.0 - BAROMETER_ALPHA) * previous
        });
        self.filtered_altitude = Some(filtered);
        filtered
    }

    fn update_trend(&mut self, altitude: f64, elapsed_realtime_nanos: i64) {
        let (Some(base), Some(peak)) = (self.base_altitude, self.peak_altitude) else {
            self.base_altitude = Some(altitude);
            self.peak_altitude = Some(altitude);
            self.last_altitude = Some(altitude);
            self.last_elapsed_realtime_nanos = Some(elapsed_realtime_nanos);
            return;
        };

        if altitude >= peak {
            self.peak_altitude = Some(altitude);
            self.last_altitude = Some(altitude);
            self.last_elapsed_realtime_nanos = Some(elapsed_realtime_nanos);
            return;
        }

        let drop = peak - altitude;
        let pending_gain = peak - base;
        if drop >= BAROMETER_DROP_THRESHOLD_METERS {
            if pending_gain >= BAROMETER_CLIMB_THRESHOLD_METERS {
                self.total_ascent_meters += pending_gain;
            }
            self.base_altitude = Some(altitude);
            self.peak_altitude = Some(altitude);
        }
        self.last_altitude = Some(altitude);
        self.last_elapsed_realtime_nanos = Some(elapsed_realtime_nanos);
    }

    fn accepted_pending_gain(&self) -> f64 {
        let (Some(base), Some(peak)) = (self.base_altitude, self.peak_altitude) else {
            return 0.0;
        };
        let pending_gain = peak - base;
        if pending_gain >= BAROMETER_CLIMB_THRESHOLD_METERS {
            pending_gain
        } else {
            0.0
        }
    }
}

#[derive(Default)]
struct GnssAscentEngine {
    total_ascent_meters: f64,
    filtered_altitude: Option<f64>,
    base_altitude: Option<f64>,
    peak_altitude: Option<f64>,
    last_altitude: Option<f64>,
    last_elapsed_realtime_nanos: Option<i64>,
    last_vertical_accuracy_meters: Option<f64>,
    sample_count: usize,
}

impl GnssAscentEngine {
    fn on_sample(&mut self, sample: GnssAltitudeSample) {
        if !self.passes_physical_gate(sample) {
            return;
        }
        self.sample_count += 1;
        let altitude = self.filter(sample.altitude_meters);
        self.update_trend(altitude, sample);
    }

    fn reset_altitude_anchor(&mut self, sample: GnssAltitudeSample) {
        self.total_ascent_meters += self.accepted_pending_gain();
        self.filtered_altitude = None;
        self.base_altitude = None;
        self.peak_altitude = None;
        self.last_altitude = None;
        self.last_elapsed_realtime_nanos = None;
        self.last_vertical_accuracy_meters = None;
        self.sample_count += 1;
        let altitude = self.filter(sample.altitude_meters);
        self.base_altitude = Some(altitude);
        self.peak_altitude = Some(altitude);
        self.last_altitude = Some(altitude);
        self.last_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
        self.last_vertical_accuracy_meters = Some(sample.vertical_accuracy_meters);
    }

    fn finish(&self) -> Option<f64> {
        if self.sample_count >= 2 {
            Some(self.total_ascent_meters + self.accepted_pending_gain())
        } else {
            None
        }
    }

    fn passes_physical_gate(&self, sample: GnssAltitudeSample) -> bool {
        let (Some(last_altitude), Some(last_elapsed)) =
            (self.last_altitude, self.last_elapsed_realtime_nanos)
        else {
            return true;
        };
        if sample.elapsed_realtime_nanos <= last_elapsed {
            return false;
        }
        let elapsed_seconds =
            (sample.elapsed_realtime_nanos - last_elapsed) as f64 / 1_000_000_000.0;
        if elapsed_seconds <= 0.0 {
            return true;
        }
        let vertical_speed = (sample.altitude_meters - last_altitude).abs() / elapsed_seconds;
        vertical_speed <= MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND
    }

    fn filter(&mut self, altitude_meters: f64) -> f64 {
        let filtered = self.filtered_altitude.map_or(altitude_meters, |previous| {
            GNSS_ALPHA * altitude_meters + (1.0 - GNSS_ALPHA) * previous
        });
        self.filtered_altitude = Some(filtered);
        filtered
    }

    fn update_trend(&mut self, altitude: f64, sample: GnssAltitudeSample) {
        let (Some(base), Some(peak)) = (self.base_altitude, self.peak_altitude) else {
            self.base_altitude = Some(altitude);
            self.peak_altitude = Some(altitude);
            self.last_altitude = Some(altitude);
            self.last_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
            self.last_vertical_accuracy_meters = Some(sample.vertical_accuracy_meters);
            return;
        };

        if altitude >= peak {
            self.peak_altitude = Some(altitude);
            self.last_altitude = Some(altitude);
            self.last_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
            self.last_vertical_accuracy_meters = Some(sample.vertical_accuracy_meters);
            return;
        }

        let drop = peak - altitude;
        let pending_gain = peak - base;
        if drop >= gnss_drop_threshold(sample.vertical_accuracy_meters) {
            if pending_gain >= gnss_climb_threshold(sample.vertical_accuracy_meters) {
                self.total_ascent_meters += pending_gain;
            }
            self.base_altitude = Some(altitude);
            self.peak_altitude = Some(altitude);
        }
        self.last_altitude = Some(altitude);
        self.last_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
        self.last_vertical_accuracy_meters = Some(sample.vertical_accuracy_meters);
    }

    fn accepted_pending_gain(&self) -> f64 {
        let (Some(base), Some(peak), Some(vertical_accuracy)) = (
            self.base_altitude,
            self.peak_altitude,
            self.last_vertical_accuracy_meters,
        ) else {
            return 0.0;
        };
        let pending_gain = peak - base;
        if pending_gain >= gnss_climb_threshold(vertical_accuracy) {
            pending_gain
        } else {
            0.0
        }
    }
}

fn gnss_climb_threshold(vertical_accuracy_meters: f64) -> f64 {
    5.0_f64.max(vertical_accuracy_meters * 0.8)
}

fn gnss_drop_threshold(vertical_accuracy_meters: f64) -> f64 {
    3.0_f64.max(vertical_accuracy_meters * 0.4)
}

fn decide_location_samples<'a>(
    samples: &'a [NormalizedLocationSample],
    sampling_epochs: &[SamplingEpoch],
    record_start_elapsed_realtime_nanos: i64,
) -> (Vec<AcceptedTrackSample<'a>>, Vec<RawPointDecision>) {
    let mut accepted = Vec::new();
    let mut decisions = Vec::with_capacity(samples.len());
    let mut state = IntakeState::default();

    for sample in samples {
        let epoch = find_sampling_epoch(sample, sampling_epochs);
        if let Some(reason) =
            intake_reject_reason(sample, epoch, record_start_elapsed_realtime_nanos, &state)
        {
            decisions.push(RawPointDecision::reject(sample.raw_point_id, reason));
            continue;
        }

        state.last_legal_elapsed_realtime_nanos = Some(sample.elapsed_realtime_nanos);
        state.legal_fix_keys.insert(fix_key(sample));
        if accepted.is_empty() {
            match decide_first_fix(sample) {
                FirstFixDecision::Track(reason) => {
                    decisions.push(RawPointDecision::accept(sample.raw_point_id, reason, 1));
                    accepted.push(AcceptedTrackSample::new(sample, reason));
                }
                FirstFixDecision::Weak(reason) => {
                    decisions.push(RawPointDecision::weak(sample.raw_point_id, reason));
                }
            }
            continue;
        }

        let previous = accepted
            .last()
            .map(|accepted| accepted.sample)
            .expect("accepted is known non-empty before moving decision");
        match decide_moving_point(sample, previous, &mut state) {
            MovingPointDecision::Track(track_decision) => {
                decisions.push(RawPointDecision::accept(
                    sample.raw_point_id,
                    track_decision.reason,
                    (accepted.len() + 1) as i64,
                ));
                accepted.push(AcceptedTrackSample {
                    sample,
                    decision_reason: track_decision.reason,
                    distance_delta_meters: track_decision.distance_delta_meters,
                    moving_time_delta_seconds: track_decision.moving_time_delta_seconds,
                    starts_new_segment: track_decision.starts_new_segment,
                });
            }
            MovingPointDecision::Weak(reason) => {
                decisions.push(RawPointDecision::weak(sample.raw_point_id, reason));
            }
            MovingPointDecision::Reject(reason) => {
                decisions.push(RawPointDecision::reject(sample.raw_point_id, reason));
            }
        }
    }

    (accepted, decisions)
}

#[derive(Clone, Copy)]
struct AcceptedTrackSample<'a> {
    sample: &'a NormalizedLocationSample,
    decision_reason: &'static str,
    distance_delta_meters: Option<f64>,
    moving_time_delta_seconds: Option<f64>,
    starts_new_segment: bool,
}

impl<'a> AcceptedTrackSample<'a> {
    fn new(sample: &'a NormalizedLocationSample, decision_reason: &'static str) -> Self {
        Self {
            sample,
            decision_reason,
            distance_delta_meters: None,
            moving_time_delta_seconds: None,
            starts_new_segment: false,
        }
    }
}

fn sample_distance_delta_override(sample: AcceptedTrackSample<'_>, fallback: f64) -> f64 {
    sample.distance_delta_meters.unwrap_or(fallback)
}

fn sample_moving_time_delta_override(sample: AcceptedTrackSample<'_>, fallback: f64) -> f64 {
    sample.moving_time_delta_seconds.unwrap_or(fallback)
}

enum FirstFixDecision {
    Track(&'static str),
    Weak(&'static str),
}

enum MovingPointDecision {
    Track(TrackDecision),
    Weak(&'static str),
    Reject(&'static str),
}

struct TrackDecision {
    reason: &'static str,
    distance_delta_meters: Option<f64>,
    moving_time_delta_seconds: Option<f64>,
    starts_new_segment: bool,
}

impl TrackDecision {
    fn normal(reason: &'static str) -> Self {
        Self {
            reason,
            distance_delta_meters: None,
            moving_time_delta_seconds: None,
            starts_new_segment: false,
        }
    }

    fn zero_delta(reason: &'static str) -> Self {
        Self {
            reason,
            distance_delta_meters: Some(0.0),
            moving_time_delta_seconds: Some(0.0),
            starts_new_segment: true,
        }
    }
}

fn decide_first_fix(sample: &NormalizedLocationSample) -> FirstFixDecision {
    if sample.horizontal_accuracy_meters <= FIRST_FIX_GOOD_ACCURACY_METERS {
        FirstFixDecision::Track("first_fix_good")
    } else if sample.horizontal_accuracy_meters <= FIRST_FIX_RELAXED_ACCURACY_METERS {
        FirstFixDecision::Track("first_fix_relaxed")
    } else {
        FirstFixDecision::Weak("weak_horizontal_accuracy")
    }
}

fn decide_moving_point(
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
    state: &mut IntakeState,
) -> MovingPointDecision {
    let distance = haversine_distance_meters(
        previous.latitude,
        previous.longitude,
        sample.latitude,
        sample.longitude,
    );
    let dt_seconds = elapsed_delta_seconds(previous, sample);
    let implied_speed = if dt_seconds > 0.0 {
        distance / dt_seconds
    } else {
        f64::INFINITY
    };
    let reported_speed = sample
        .speed_meters_per_second
        .filter(|speed| speed.is_finite());
    let is_gap = dt_seconds > GAP_SECONDS;

    if is_gap {
        decide_gap_recovery(sample, previous, distance, reported_speed, state)
    } else if is_transport_risk_distance(distance, implied_speed, reported_speed) {
        MovingPointDecision::Reject("transport_risk")
    } else if is_implied_transport_unconfirmed_by_reported_speed(
        distance,
        implied_speed,
        reported_speed,
    ) {
        MovingPointDecision::Weak("implied_speed_unconfirmed_by_reported_speed")
    } else if implied_speed > IMPOSSIBLE_SPEED_METERS_PER_SECOND {
        MovingPointDecision::Weak("implied_speed_too_high")
    } else if sample.horizontal_accuracy_meters > WEAK_CLOUD_ACCURACY_METERS {
        MovingPointDecision::Weak("weak_horizontal_accuracy")
    } else {
        MovingPointDecision::Track(TrackDecision::normal("moving_good_fix"))
    }
}

fn decide_gap_recovery(
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
    distance: f64,
    reported_speed: Option<f64>,
    state: &mut IntakeState,
) -> MovingPointDecision {
    record_recovery_cloud_sample(state, sample, previous);
    let threshold_meters = stationary_threshold(sample);
    if sample.horizontal_accuracy_meters > WEAK_CLOUD_ACCURACY_METERS {
        return MovingPointDecision::Weak("gap_recovery_pending");
    }
    if !is_recovery_fast_path(sample, distance, threshold_meters, reported_speed)
        && !is_recovery_cloud_stable(state, threshold_meters)
    {
        return MovingPointDecision::Weak("gap_recovery_pending");
    }
    MovingPointDecision::Track(TrackDecision::zero_delta("gap_recovery"))
}

fn is_recovery_fast_path(
    sample: &NormalizedLocationSample,
    distance: f64,
    threshold_meters: f64,
    reported_speed: Option<f64>,
) -> bool {
    distance >= threshold_meters
        && sample.horizontal_accuracy_meters <= RECOVERY_FAST_PATH_ACCURACY_METERS
        && reported_speed
            .is_none_or(|speed| speed <= RECOVERY_FAST_PATH_MAX_SPEED_METERS_PER_SECOND)
}

fn stationary_threshold(sample: &NormalizedLocationSample) -> f64 {
    STATIONARY_DISTANCE_METERS
        .max(sample.horizontal_accuracy_meters * STATIONARY_ACCURACY_MULTIPLIER)
}

fn record_recovery_cloud_sample(
    state: &mut IntakeState,
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
) {
    let reset = state.recovery_cloud.as_ref().is_none_or(|cloud| {
        cloud.reference_raw_point_id != previous.raw_point_id
            || sample.elapsed_realtime_nanos - cloud.last_elapsed_realtime_nanos
                > (GAP_SECONDS * 1_000_000_000.0) as i64
    });
    if reset {
        state.recovery_cloud = Some(RecoveryCloud {
            reference_raw_point_id: previous.raw_point_id,
            last_elapsed_realtime_nanos: sample.elapsed_realtime_nanos,
            samples: Vec::new(),
        });
    }

    if let Some(cloud) = &mut state.recovery_cloud {
        cloud.samples.push(CloudSample {
            latitude: sample.latitude,
            longitude: sample.longitude,
        });
        cloud.last_elapsed_realtime_nanos = sample.elapsed_realtime_nanos;
    }
}

fn is_recovery_cloud_stable(state: &IntakeState, threshold_meters: f64) -> bool {
    state.recovery_cloud.as_ref().is_some_and(|cloud| {
        cloud.samples.len() >= RECOVERY_CLOUD_MIN_SAMPLES
            && cloud_radius_meters(&cloud.samples) <= threshold_meters
    })
}

fn cloud_radius_meters(samples: &[CloudSample]) -> f64 {
    if samples.len() <= 1 {
        return 0.0;
    }
    let (latitude_sum, longitude_sum) = samples.iter().fold((0.0, 0.0), |sum, sample| {
        (sum.0 + sample.latitude, sum.1 + sample.longitude)
    });
    let center_latitude = latitude_sum / samples.len() as f64;
    let center_longitude = longitude_sum / samples.len() as f64;
    let squared_sum = samples
        .iter()
        .map(|sample| {
            let distance = haversine_distance_meters(
                center_latitude,
                center_longitude,
                sample.latitude,
                sample.longitude,
            );
            distance * distance
        })
        .sum::<f64>();
    (squared_sum / samples.len() as f64).sqrt()
}

fn is_transport_risk_distance(
    distance: f64,
    implied_speed: f64,
    reported_speed: Option<f64>,
) -> bool {
    if distance < TRANSPORT_MIN_DISTANCE_METERS {
        return false;
    }
    if let Some(reported_speed) = reported_speed {
        return reported_speed >= TRANSPORT_SPEED_METERS_PER_SECOND;
    }
    implied_speed >= TRANSPORT_SPEED_METERS_PER_SECOND
}

fn is_implied_transport_unconfirmed_by_reported_speed(
    distance: f64,
    implied_speed: f64,
    reported_speed: Option<f64>,
) -> bool {
    distance >= TRANSPORT_MIN_DISTANCE_METERS
        && implied_speed >= TRANSPORT_SPEED_METERS_PER_SECOND
        && reported_speed.is_some_and(|speed| speed < TRANSPORT_SPEED_METERS_PER_SECOND)
}

#[derive(Default)]
struct IntakeState {
    last_legal_elapsed_realtime_nanos: Option<i64>,
    legal_fix_keys: HashSet<String>,
    recovery_cloud: Option<RecoveryCloud>,
}

struct RecoveryCloud {
    reference_raw_point_id: i64,
    last_elapsed_realtime_nanos: i64,
    samples: Vec<CloudSample>,
}

struct CloudSample {
    latitude: f64,
    longitude: f64,
}

fn intake_reject_reason(
    sample: &NormalizedLocationSample,
    epoch: Option<&SamplingEpoch>,
    record_start_elapsed_realtime_nanos: i64,
    state: &IntakeState,
) -> Option<&'static str> {
    if sample.positioning_source.trim().is_empty() {
        Some("missing_position_source")
    } else if sample.is_mock {
        Some("mock_location")
    } else if !is_valid_coordinate(sample.latitude, sample.longitude) {
        Some("invalid_coordinate")
    } else if sample.elapsed_realtime_nanos < 0 {
        Some("missing_fix_elapsed_realtime")
    } else if sample.elapsed_realtime_nanos
        < record_start_elapsed_realtime_nanos - START_TOLERANCE_NANOS
    {
        Some("before_record_start")
    } else if !sample.horizontal_accuracy_meters.is_finite()
        || sample.horizontal_accuracy_meters < 0.0
    {
        Some("invalid_accuracy")
    } else if sample.horizontal_accuracy_meters > MAX_HORIZONTAL_ACCURACY_METERS {
        Some("accuracy_too_large")
    } else if state.legal_fix_keys.contains(&fix_key(sample)) {
        Some("duplicate_fix")
    } else if state
        .last_legal_elapsed_realtime_nanos
        .is_some_and(|last| sample.elapsed_realtime_nanos <= last)
    {
        Some("out_of_order_fix")
    } else if sample.sampling_epoch_id.is_some() && epoch.is_none() {
        Some("sampling_epoch_mismatch")
    } else if epoch.is_some_and(|epoch| {
        sample.elapsed_realtime_nanos < epoch.started_elapsed_realtime_nanos - START_TOLERANCE_NANOS
    }) {
        Some("sampling_epoch_mismatch")
    } else if sample.elapsed_realtime_nanos < 0 {
        Some("missing_fix_elapsed_realtime")
    } else {
        None
    }
}

fn find_sampling_epoch<'a>(
    sample: &NormalizedLocationSample,
    sampling_epochs: &'a [SamplingEpoch],
) -> Option<&'a SamplingEpoch> {
    if let Some(sampling_epoch_id) = &sample.sampling_epoch_id {
        return sampling_epochs
            .iter()
            .find(|epoch| &epoch.epoch_id == sampling_epoch_id);
    }

    let mut active = None;
    for epoch in sampling_epochs {
        if epoch.started_elapsed_realtime_nanos <= sample.elapsed_realtime_nanos {
            active = Some(epoch);
        } else {
            break;
        }
    }
    active
}

fn fix_key(sample: &NormalizedLocationSample) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        sample.positioning_source,
        sample.elapsed_realtime_nanos,
        sample.latitude,
        sample.longitude,
        sample.horizontal_accuracy_meters
    )
}

fn is_valid_coordinate(latitude: f64, longitude: f64) -> bool {
    latitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && longitude.is_finite()
        && (-180.0..=180.0).contains(&longitude)
}

fn elapsed_delta_seconds(
    previous: &NormalizedLocationSample,
    current: &NormalizedLocationSample,
) -> f64 {
    let delta_nanos = current.elapsed_realtime_nanos - previous.elapsed_realtime_nanos;
    if delta_nanos <= 0 {
        0.0
    } else {
        delta_nanos as f64 / 1_000_000_000.0
    }
}

fn is_anchor_reason(reason: &str) -> bool {
    matches!(
        reason,
        "first_fix_good" | "first_fix_relaxed" | "gap_recovery" | "stationary_anchor"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use track_model::{OutdoorTrackInput, SessionContext};

    #[test]
    fn process_three_points_accumulates_distance_and_time() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.0001, 120.0, 2_000_000_000),
                sample(3, 30.0002, 120.0, 3_500_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };
        let result = process(input, TrackConfig::default());
        let positive_distance_delta_count = result
            .track_points
            .iter()
            .filter(|point| point.distance_delta_meters > 0.0)
            .count();
        assert_eq!(result.track_points.len(), 3);
        assert_eq!(positive_distance_delta_count, 2);
        assert!(result.track_points[1].distance_delta_meters > 0.0);
        assert_eq!(result.track_points[0].track_direction_degrees, None);
        assert_eq!(result.track_points[1].track_direction_degrees, Some(0.0));
        assert_eq!(result.track_points[2].track_direction_degrees, Some(0.0));
        assert!(result.summary.total_distance_meters > 0.0);
        assert_eq!(result.summary.moving_time_seconds, 2.5);
    }

    #[test]
    fn process_debug_returns_raw_point_decisions() {
        let mut non_gnss = sample(2, 30.0001, 120.0, 2_000_000_000);
        non_gnss.positioning_source = "network".to_string();
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                non_gnss,
                sample(3, 30.0002, 120.0, 3_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 3);
        assert_eq!(result.raw_point_decisions.len(), 3);
        assert_eq!(result.raw_point_decisions[0].raw_point_id, 1);
        assert_eq!(result.raw_point_decisions[0].result, "accept");
        assert_eq!(result.raw_point_decisions[0].reason, "first_fix_good");
        assert_eq!(result.raw_point_decisions[0].track_point_id, Some(1));
        assert_eq!(result.raw_point_decisions[1].raw_point_id, 2);
        assert_eq!(result.raw_point_decisions[1].result, "accept");
        assert_eq!(result.raw_point_decisions[1].reason, "moving_good_fix");
        assert_eq!(result.raw_point_decisions[1].track_point_id, Some(2));
        assert_eq!(result.raw_point_decisions[2].track_point_id, Some(3));
    }

    #[test]
    fn web_intake_filter_removes_invalid_samples() {
        let mut mock = sample(3, 30.0002, 120.0, 3_000_000_000);
        mock.is_mock = true;
        let mut invalid_latitude = sample(4, 91.0, 120.0, 4_000_000_000);
        invalid_latitude.horizontal_accuracy_meters = 8.0;
        let mut weak_accuracy = sample(5, 30.0003, 120.0, 5_000_000_000);
        weak_accuracy.horizontal_accuracy_meters = 81.0;
        let mut duplicate_time = sample(6, 30.0004, 120.0, 1_000_000_000);
        duplicate_time.raw_point_id = 6;
        let valid_later = sample(7, 30.0001, 120.0, 6_000_000_000);

        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                mock,
                invalid_latitude,
                weak_accuracy,
                duplicate_time,
                valid_later,
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert_eq!(result.track_points.len(), 2);
        assert_eq!(result.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.track_points[1].source_raw_point_id, 7);
        assert_eq!(result.segments.len(), 1);
    }

    #[test]
    fn intake_keeps_non_empty_positioning_source_like_web() {
        let mut network = sample(1, 30.0, 120.0, 1_000_000_000);
        network.positioning_source = "network".to_string();
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![network],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(result.raw_point_decisions[0].result, "accept");
        assert_eq!(result.raw_point_decisions[0].reason, "first_fix_good");
    }

    #[test]
    fn first_fix_uses_web_accuracy_thresholds() {
        let relaxed_input = OutdoorTrackInput {
            session_context: SessionContext::new("session-relaxed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![sample_with_accuracy(1, 25.0, 1_000_000_000)],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };
        let weak_input = OutdoorTrackInput {
            session_context: SessionContext::new("session-weak", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![sample_with_accuracy(1, 35.0, 1_000_000_000)],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let relaxed = process_debug(relaxed_input, TrackConfig::default());
        let weak = process_debug(weak_input, TrackConfig::default());

        assert_eq!(relaxed.cleaned_track.track_points.len(), 1);
        assert_eq!(relaxed.raw_point_decisions[0].result, "accept");
        assert_eq!(relaxed.raw_point_decisions[0].reason, "first_fix_relaxed");
        assert!(weak.cleaned_track.track_points.is_empty());
        assert_eq!(weak.raw_point_decisions[0].result, "weak");
        assert_eq!(
            weak.raw_point_decisions[0].reason,
            "weak_horizontal_accuracy"
        );
    }

    #[test]
    fn moving_point_uses_web_accuracy_thresholds() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-moving-weak", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample_with_accuracy_at(2, 30.0001, 120.0, 35.0, 2_000_000_000),
                sample(3, 30.0001, 120.0, 3_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "weak_horizontal_accuracy"
        );
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    fn moving_point_uses_web_impossible_speed_threshold() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-impossible-speed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.000135, 120.0, 2_000_000_000),
                sample(3, 30.0001, 120.0, 3_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "implied_speed_too_high"
        );
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    fn moving_point_uses_web_reported_speed_contradiction_reason() {
        let mut contradiction = sample(2, 30.0004, 120.0, 11_000_000_000);
        contradiction.speed_meters_per_second = Some(1.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-reported-speed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                contradiction,
                sample(3, 30.0001, 120.0, 12_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "implied_speed_unconfirmed_by_reported_speed"
        );
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    fn moving_point_uses_web_transport_risk_before_speed_diagnostics() {
        let mut transport = sample(2, 30.0004, 120.0, 11_000_000_000);
        transport.speed_meters_per_second = Some(4.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-transport-risk", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                transport,
                sample(3, 30.0001, 120.0, 12_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "reject");
        assert_eq!(result.raw_point_decisions[1].reason, "transport_risk");
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    fn moving_point_uses_web_gap_pending_for_low_accuracy_after_gap() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-gap-low-accuracy", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample_with_accuracy_at(2, 30.0001, 120.0, 35.0, 122_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(result.cleaned_track.track_points[0].source_raw_point_id, 1);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(result.raw_point_decisions[1].reason, "gap_recovery_pending");
    }

    #[test]
    fn moving_point_uses_web_gap_recovery_fast_path_zero_delta() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-gap-fast-path", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.000135, 120.0, 122_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 2);
        assert_eq!(result.cleaned_track.track_points[0].segment_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].segment_id, 2);
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            0.0
        );
        assert_eq!(
            result.cleaned_track.track_points[1].moving_time_delta_seconds,
            0.0
        );
        assert_eq!(result.cleaned_track.segments.len(), 2);
        assert_eq!(result.cleaned_track.segments[0].start_track_point_id, 1);
        assert_eq!(result.cleaned_track.segments[0].end_track_point_id, 1);
        assert_eq!(result.cleaned_track.segments[1].start_track_point_id, 2);
        assert_eq!(result.cleaned_track.segments[1].end_track_point_id, 2);
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        assert_eq!(result.cleaned_track.summary.moving_time_seconds, 0.0);
        assert_eq!(result.raw_point_decisions[1].result, "accept");
        assert_eq!(result.raw_point_decisions[1].reason, "gap_recovery");
    }

    #[test]
    fn moving_point_uses_web_stable_recovery_cloud_after_gap() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-gap-stable-cloud", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample_with_accuracy_at(2, 30.00005, 120.0, 12.0, 122_000_000_000),
                sample_with_accuracy_at(3, 30.000051, 120.0, 12.0, 123_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[1].source_raw_point_id, 3);
        assert_eq!(result.cleaned_track.track_points[1].segment_id, 2);
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            0.0
        );
        assert_eq!(
            result.cleaned_track.track_points[1].moving_time_delta_seconds,
            0.0
        );
        assert_eq!(result.cleaned_track.segments.len(), 2);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(result.raw_point_decisions[1].reason, "gap_recovery_pending");
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(result.raw_point_decisions[2].reason, "gap_recovery");
    }

    #[test]
    fn intake_rejects_sampling_epoch_mismatch_like_web() {
        let mut point = sample(1, 30.0, 120.0, 1_000_000_000);
        point.sampling_epoch_id = Some("missing".to_string());
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![SamplingEpoch::new("active", "MOVING", 0)],
            location_samples: vec![point],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert!(result.cleaned_track.track_points.is_empty());
        assert_eq!(result.raw_point_decisions[0].result, "reject");
        assert_eq!(
            result.raw_point_decisions[0].reason,
            "sampling_epoch_mismatch"
        );
    }

    #[test]
    fn empty_result_when_all_samples_are_invalid() {
        let mut invalid = sample(1, 30.0, 120.0, 1_000_000_000);
        invalid.horizontal_accuracy_meters = f64::NAN;
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-1", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![invalid],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert!(result.track_points.is_empty());
        assert!(result.segments.is_empty());
        assert!(result.gpx_track_points.is_empty());
        assert_eq!(result.summary.total_distance_meters, 0.0);
        assert_eq!(result.summary.moving_time_seconds, 0.0);
        assert_eq!(result.summary.pace_seconds_per_km, None);
    }

    #[test]
    fn barometer_windows_accumulate_thresholded_ascent() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-ascent", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![],
            motion_windows: vec![],
            barometer_windows: vec![
                barometer_window("barometer-1", 0, 1_000_000_000, 100.0),
                barometer_window("barometer-2", 1_000_000_000, 11_000_000_000, 120.0),
                barometer_window("barometer-3", 11_000_000_000, 21_000_000_000, 90.0),
            ],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert!(result.cleaned_track.track_points.is_empty());
        assert!((result.cleaned_track.summary.ascent_meters - 7.0).abs() < 0.000001);
        assert_eq!(result.cleaned_track.summary.ascent_source, "BAROMETER");
        assert_eq!(
            result.cleaned_track.summary.barometer_ascent_meters,
            Some(7.0)
        );
        assert_eq!(result.cleaned_track.summary.gnss_ascent_meters, None);
        assert_eq!(result.barometer_window_decisions.len(), 3);
        assert_eq!(
            result.barometer_window_decisions[0].window_id,
            "barometer-1"
        );
        assert_eq!(
            result.barometer_window_decisions[0].reason,
            "barometer_sample_accepted"
        );
        assert_eq!(
            result.barometer_window_decisions[0].ascent_sample_index,
            Some(1)
        );
    }

    #[test]
    fn barometer_calibration_is_debug_only() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-calibration", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![BarometerCalibration {
                calibration_id: "calibration-1".to_string(),
                source: "GNSS".to_string(),
                raw_barometer_altitude_meters: 100.0,
                reference_altitude_meters: 112.5,
                calibration_offset_meters: 12.5,
                pressure_sample_elapsed_realtime_nanos: 1_000_000_000,
            }],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.summary.ascent_source, "NONE");
        assert_eq!(result.cleaned_track.summary.ascent_meters, 0.0);
        assert_eq!(result.barometer_calibration_decisions.len(), 1);
        assert_eq!(
            result.barometer_calibration_decisions[0].reason,
            "barometer_calibration_accepted"
        );
        assert_eq!(
            result.barometer_calibration_decisions[0].displayed_barometer_altitude_meters,
            Some(112.5)
        );
    }

    #[test]
    fn consecutive_barometer_pressure_jumps_reset_anchor() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-pressure-jump", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![],
            motion_windows: vec![],
            barometer_windows: vec![
                barometer_window("barometer-1", 0, 1_000_000_000, 100.0),
                barometer_window("barometer-2", 1_000_000_000, 2_000_000_000, 150.0),
                barometer_window("barometer-3", 2_000_000_000, 3_000_000_000, 155.0),
                barometer_window("barometer-4", 3_000_000_000, 13_000_000_000, 165.0),
            ],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(
            result.barometer_window_decisions[1].reason,
            "barometer_vertical_speed_too_high"
        );
        assert_eq!(
            result.barometer_window_decisions[2].reason,
            "barometer_pressure_jump_reset"
        );
        assert!((result.cleaned_track.summary.ascent_meters - 3.5).abs() < 0.000001);
        assert_eq!(result.cleaned_track.summary.ascent_source, "BAROMETER");
    }

    #[test]
    fn gnss_altitude_line_is_fallback_when_barometer_is_unavailable() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-gnss-ascent", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample_with_altitude(1, 30.0, 120.0, 100.0, 1_000_000_000),
                sample_with_altitude(2, 30.0001, 120.0, 140.0, 31_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert!((result.summary.ascent_meters - 6.0).abs() < 0.000001);
        assert_eq!(result.summary.ascent_source, "GNSS");
        assert_eq!(result.summary.barometer_ascent_meters, None);
        assert_eq!(result.summary.gnss_ascent_meters, Some(6.0));
    }

    #[test]
    fn reliable_barometer_ascent_is_preferred_over_gnss_ascent() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-selected-ascent", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample_with_altitude(1, 30.0, 120.0, 100.0, 1_000_000_000),
                sample_with_altitude(2, 30.0001, 120.0, 140.0, 31_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![
                barometer_window("barometer-1", 0, 1_000_000_000, 100.0),
                barometer_window("barometer-2", 1_000_000_000, 11_000_000_000, 110.0),
            ],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert!((result.summary.ascent_meters - 3.5).abs() < 0.000001);
        assert_eq!(result.summary.ascent_source, "BAROMETER");
        assert_eq!(result.summary.barometer_ascent_meters, Some(3.5));
        assert_eq!(result.summary.gnss_ascent_meters, Some(6.0));
    }

    #[test]
    fn track_direction_uses_north_as_zero_degrees() {
        let cases = [
            ((30.0, 120.0), (30.0001, 120.0), 0.0),
            ((30.0, 120.0), (30.0, 120.0001), 90.0),
            ((30.0, 120.0), (29.9999, 120.0), 180.0),
            ((30.0, 120.0), (30.0, 119.9999), 270.0),
        ];

        for (index, ((from_lat, from_lon), (to_lat, to_lon), expected)) in
            cases.into_iter().enumerate()
        {
            let input = OutdoorTrackInput {
                session_context: SessionContext::new(format!("session-{index}"), "rust-poc"),
                sampling_epochs: vec![],
                location_samples: vec![
                    sample(1, from_lat, from_lon, 1_000_000_000),
                    sample(2, to_lat, to_lon, 2_000_000_000),
                ],
                motion_windows: vec![],
                barometer_windows: vec![],
                barometer_calibrations: vec![],
            };

            let result = process(input, TrackConfig::default());
            let direction = result.track_points[1]
                .track_direction_degrees
                .expect("moving point should have track direction");

            assert!(
                (direction - expected).abs() < 0.001,
                "expected {expected}, got {direction}"
            );
        }
    }

    fn sample(
        raw_point_id: i64,
        latitude: f64,
        longitude: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        sample_with_accuracy_at(
            raw_point_id,
            latitude,
            longitude,
            8.0,
            elapsed_realtime_nanos,
        )
    }

    fn sample_with_accuracy(
        raw_point_id: i64,
        accuracy: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        sample_with_accuracy_at(raw_point_id, 30.0, 120.0, accuracy, elapsed_realtime_nanos)
    }

    fn sample_with_accuracy_at(
        raw_point_id: i64,
        latitude: f64,
        longitude: f64,
        accuracy: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        NormalizedLocationSample {
            raw_point_id,
            positioning_source: "gnss".to_string(),
            latitude,
            longitude,
            horizontal_accuracy_meters: accuracy,
            altitude_meters: None,
            vertical_accuracy_meters: None,
            speed_meters_per_second: None,
            bearing_degrees: None,
            wall_time_millis: elapsed_realtime_nanos / 1_000_000,
            elapsed_realtime_nanos,
            is_mock: false,
            sampling_epoch_id: None,
            callback_received_elapsed_realtime_nanos: None,
            callback_delay_nanos: None,
        }
    }

    fn sample_with_altitude(
        raw_point_id: i64,
        latitude: f64,
        longitude: f64,
        altitude_meters: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        NormalizedLocationSample {
            altitude_meters: Some(altitude_meters),
            vertical_accuracy_meters: Some(5.0),
            ..sample_with_accuracy_at(
                raw_point_id,
                latitude,
                longitude,
                8.0,
                elapsed_realtime_nanos,
            )
        }
    }

    fn barometer_window(
        window_id: &str,
        start_elapsed_realtime_nanos: i64,
        end_elapsed_realtime_nanos: i64,
        avg_raw_barometer_altitude_meters: f64,
    ) -> NormalizedBarometerWindow {
        NormalizedBarometerWindow {
            window_id: window_id.to_string(),
            start_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            sample_count: 4,
            min_pressure_hpa: 1_000.0,
            max_pressure_hpa: 1_001.0,
            avg_pressure_hpa: 1_000.5,
            delta_pressure_hpa: 1.0,
            min_raw_barometer_altitude_meters: avg_raw_barometer_altitude_meters - 0.5,
            max_raw_barometer_altitude_meters: avg_raw_barometer_altitude_meters + 0.5,
            avg_raw_barometer_altitude_meters,
            delta_raw_barometer_altitude_meters: 1.0,
            last_sensor_accuracy: Some(3),
        }
    }
}
