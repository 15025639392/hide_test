#![forbid(unsafe_code)]

mod metrics;

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use track_model::{
    CleanedTrackDebugResult, CleanedTrackPoint, CleanedTrackResult, CleanedTrackSegment,
    NormalizedBarometerWindow, NormalizedLocationSample, NormalizedMotionWindow, OutdoorTrackInput,
    RawPointDecision, SamplingEpoch, TrackConfig, TrackSummary,
};

use crate::metrics::{
    distance_to_segment_meters, haversine_distance_meters, initial_bearing_degrees,
};

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
const STATIONARY_SESSION_MIN_RAW_POINTS: usize = 20;
const STATIONARY_SESSION_MIN_DURATION_SECONDS: f64 = 60.0;
const STATIONARY_SESSION_MAX_BBOX_METERS: f64 = 80.0;
const STATIONARY_SESSION_MAX_NET_DISTANCE_METERS: f64 = 80.0;
const STATIONARY_SESSION_MAX_PATH_RATE_METERS_PER_SECOND: f64 = 0.05;
const STATIONARY_SESSION_MIN_SPEED_SAMPLE_RATIO: f64 = 0.8;
const STATIONARY_SESSION_MIN_ZERO_SPEED_RATIO: f64 = 0.95;
const STATIONARY_SESSION_MAX_AVERAGE_REPORTED_SPEED_METERS_PER_SECOND: f64 = 0.3;
const STATIONARY_CLOUD_MIN_SAMPLES: usize = 2;
const SLOW_MOVEMENT_MIN_DISTANCE_METERS: f64 = 2.5;
const LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS: f64 = 35.0;
const LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS: f64 = 2.5;
const CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND: f64 = 6.0;
const MOTION_LOOKBACK_NANOS: i64 = 10_000_000_000;
const ACTIVE_MOTION_DYNAMIC_ACCEL_RMS_MPS2: f64 = 0.35;
const ACTIVE_MOTION_GYROSCOPE_RMS_RADPS: f64 = 0.12;
const MOVING_SPIKE_MAX_REPORTED_SPEED_METERS_PER_SECOND: f64 = 0.2;
const MOVING_SPIKE_MAX_COMPETING_REPORTED_SPEED_METERS_PER_SECOND: f64 = 1.0;
const MOVING_SPIKE_GEOMETRY_OVERRIDE_MAX_REPORTED_SPEED_METERS_PER_SECOND: f64 = 3.0;
const MOVING_SPIKE_GEOMETRY_OVERRIDE_MIN_DETOUR_METERS: f64 = 5.0;
const MOVING_SPIKE_GEOMETRY_OVERRIDE_MIN_LATERAL_METERS: f64 = 5.0;
const MOVING_SPIKE_GEOMETRY_OVERRIDE_MAX_FORWARD_ANGLE_DELTA_DEGREES: f64 = 30.0;
const MOVING_SPIKE_MIN_DETOUR_METERS: f64 = 1.5;
const MOVING_SPIKE_MIN_LATERAL_METERS: f64 = 2.5;
const MOVING_SPIKE_MIN_NEIGHBOR_DISTANCE_METERS: f64 = 5.0;
const MOVING_SPIKE_MAX_BRIDGE_DISTANCE_METERS: f64 = 15.0;
const POSITION_SNAP_RECOVERY_MIN_WEAK_POINTS: usize = 1;
const POSITION_SNAP_RECOVERY_MIN_BRIDGE_DISTANCE_METERS: f64 = 20.0;
const POSITION_SNAP_RECOVERY_MAX_REPORTED_SPEED_METERS_PER_SECOND: f64 = 2.0;
const WEAK_RECOVERY_SHAPE_MIN_SAMPLES: usize = 3;
const WEAK_RECOVERY_SHAPE_MAX_RADIUS_METERS: f64 = 25.0;
const WEAK_RECOVERY_SHAPE_MIN_DISTANCE_FROM_TRUSTED_METERS: f64 = 50.0;
const WEAK_RECOVERY_SHAPE_MAX_BEST_ACCURACY_METERS: f64 = 35.0;
const WEAK_RECOVERY_SHAPE_EXTENSION_GAP_SECONDS: f64 = 500.0;
const WEAK_RECOVERY_SHAPE_EXTENSION_DISTANCE_METERS: f64 = 130.0;
const WEAK_RECOVERY_SHAPE_MAX_EXTENSION_SAMPLES: usize = 5;
const REST_PHOTO_MICRO_MOVE_MIN_TRACK_POINTS: usize = 8;
const REST_PHOTO_MICRO_MOVE_MAX_TRACK_POINTS: usize = 25;
const REST_PHOTO_MICRO_MOVE_MIN_PATH_METERS: f64 = 20.0;
const REST_PHOTO_MICRO_MOVE_MAX_PATH_METERS: f64 = 120.0;
const REST_PHOTO_MICRO_MOVE_MAX_BBOX_METERS: f64 = 25.0;
const REST_PHOTO_MICRO_MOVE_MAX_ENDPOINT_DISTANCE_METERS: f64 = 12.0;
const REST_PHOTO_MICRO_MOVE_MIN_PATH_NET_RATIO: f64 = 4.0;
const REST_PHOTO_MICRO_MOVE_MAX_DURATION_SECONDS: f64 = 300.0;
const REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_BBOX_METERS: f64 = 25.0;
const REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_NET_DISTANCE_METERS: f64 = 12.0;
const REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_PATH_METERS: f64 = 70.0;
const REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MIN_DURATION_SECONDS: f64 = 180.0;
const REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_BBOX_METERS: f64 = 28.0;
const REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_NET_DISTANCE_METERS: f64 = 10.0;
const REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_PATH_METERS: f64 = 120.0;
const REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_PATH_METERS: f64 = 32.0;
const REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_TRACK_POINTS: usize = 10;
const REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_DURATION_SECONDS: f64 = 150.0;
const REST_PHOTO_MICRO_MOVE_SIMPLIFY_TOLERANCE_METERS: f64 = 6.0;
const REST_PHOTO_MICRO_MOVE_SIMPLIFY_MAX_OUTPUT_TRACK_POINTS: usize = 6;
const DENSE_MAIN_ROUTE_MIN_TRACK_POINTS: usize = 12;
const DENSE_MAIN_ROUTE_MIN_NET_DISTANCE_METERS: f64 = 25.0;
const DENSE_MAIN_ROUTE_MAX_BBOX_METERS: f64 = 120.0;
const DENSE_MAIN_ROUTE_MAX_PATH_NET_RATIO: f64 = 3.0;
const DENSE_MAIN_ROUTE_SIMPLIFY_TOLERANCE_METERS: f64 = 4.0;
const DENSE_MAIN_ROUTE_MIN_PATH_REDUCTION_RATIO: f64 = 0.15;
const ROUND_TRIP_LINE_MIN_TRACK_POINTS: usize = 20;
const ROUND_TRIP_LINE_MAX_ENDPOINT_DISTANCE_METERS: f64 = 6.0;
const ROUND_TRIP_LINE_MIN_TURN_DISTANCE_METERS: f64 = 80.0;
const ROUND_TRIP_LINE_MAX_CROSS_TRACK_METERS: f64 = 35.0;
const ROUND_TRIP_LINE_MAX_RAW_POINT_ID_SPAN_BEFORE: i64 = 240;
const ROUND_TRIP_LINE_MAX_RAW_POINT_ID_SPAN_AFTER: i64 = 300;
const ROUND_TRIP_LINE_SIMPLIFY_TOLERANCE_METERS: f64 = 3.0;
const ROUND_TRIP_LINE_NO_INTENT_MAX_DURATION_SECONDS: f64 = 1200.0;
const ROUND_TRIP_LINE_NO_INTENT_MAX_SAMPLE_GAP_SECONDS: f64 = 600.0;
const ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_BBOX_METERS: f64 = 40.0;
const ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_APPROACH_PAIR_DISTANCE_METERS: f64 = 20.0;
const ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_DURATION_SECONDS: f64 = 1200.0;
const ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_SAMPLE_GAP_SECONDS: f64 = 600.0;
const ENCLOSED_GAP_CLUSTER_MIN_GAP_RECOVERIES: usize = 3;
const ENCLOSED_GAP_CLUSTER_MIN_STATIONARY_ANCHORS: usize = 3;
const ENCLOSED_GAP_CLUSTER_MAX_BBOX_METERS: f64 = 90.0;
const ENCLOSED_GAP_CLUSTER_MIN_DURATION_SECONDS: f64 = 300.0;
const ENCLOSED_GAP_CLUSTER_MIN_RAW_POINT_ID_SPAN: i64 = 200;
const ENCLOSED_LOOP_SETTLEMENT_MAX_BBOX_METERS: f64 = 90.0;
const ENCLOSED_LOOP_SETTLEMENT_MAX_CORRIDOR_DISTANCE_METERS: f64 = 16.0;
const ENCLOSED_LOOP_SETTLEMENT_MIN_REMOVED_TRACK_POINTS: usize = 6;
const CLOSED_LOOP_ROUND_TRIP_MIN_PATH_METERS: f64 = 120.0;
const CLOSED_LOOP_ROUND_TRIP_MAX_ENDPOINT_DISTANCE_METERS: f64 = 8.0;
const CLOSED_LOOP_ROUND_TRIP_MAX_NET_PATH_RATIO: f64 = 0.08;
const DWELL_DRIFT_CORE_ACCURACY_METERS: f64 = 30.0;
const DWELL_DRIFT_MIN_CORE_SAMPLES: usize = 10;
const DWELL_DRIFT_MIN_RAW_POINTS: usize = 20;
const DWELL_DRIFT_MIN_DURATION_SECONDS: f64 = 60.0;
const DWELL_DRIFT_MAX_CORE_GAP_SECONDS: f64 = 60.0;
const DWELL_DRIFT_MAX_EXTENSION_GAP_SECONDS: f64 = 10.0;
const DWELL_DRIFT_MAX_EXTENSION_PATH_METERS: f64 = 40.0;
const DWELL_DRIFT_MAX_REPORTED_SPEED_METERS_PER_SECOND: f64 = 1.6;
const DWELL_DRIFT_MAX_AVERAGE_SPEED_METERS_PER_SECOND: f64 = 1.5;
const DWELL_DRIFT_MIN_ZERO_SPEED_RATIO: f64 = 0.3;
const DWELL_DRIFT_MAX_BBOX_METERS: f64 = 100.0;
const DWELL_DRIFT_MAX_NET_DISTANCE_METERS: f64 = 80.0;
const START_TOLERANCE_NANOS: i64 = 1_000_000_000;
const LOCATION_ALTITUDE_MAX_VERTICAL_ACCURACY_METERS: f64 = 20.0;
const LOCATION_ALTITUDE_MIN_GAIN_METERS: f64 = 1.0;
const LOCATION_ALTITUDE_MAX_STEP_GAIN_METERS: f64 = 30.0;
const BAROMETER_ASCENT_MIN_GAIN_METERS: f64 = 1.0;
const BAROMETER_ASCENT_MAX_SAMPLE_GAP_NANOS: i64 = 30_000_000_000;
const BAROMETER_ASCENT_MAX_VERTICAL_SPEED_METERS_PER_SECOND: f64 = 2.0;
const BAROMETER_PRESSURE_JUMP_METERS: f64 = 20.0;

pub fn process(input: OutdoorTrackInput, config: TrackConfig) -> CleanedTrackResult {
    process_debug(input, config).cleaned_track
}

pub fn process_debug(input: OutdoorTrackInput, _config: TrackConfig) -> CleanedTrackDebugResult {
    let session_context = input.session_context;
    let sampling_epochs = input.sampling_epochs;
    let barometer_windows = input.barometer_windows;
    let motion_windows = input.motion_windows;
    let mut samples = input.location_samples;
    samples.sort_by_key(|sample| (sample.fix_elapsed_realtime_nanos, sample.sample_id));

    let (accepted_samples, mut raw_point_decisions) = decide_location_samples(
        &samples,
        &sampling_epochs,
        &motion_windows,
        session_context.created_elapsed_realtime_nanos,
    );
    let stationary_session = collapse_stationary_session(&accepted_samples, &samples);
    if let Some((stationary_session_samples, stationary_session_suppression_reasons)) =
        stationary_session
    {
        reconcile_cleaned_sample_decisions(
            &stationary_session_samples,
            &mut raw_point_decisions,
            &stationary_session_suppression_reasons,
        );
        let cleaned_track = build_cleaned_track(&stationary_session_samples, &barometer_windows);
        return CleanedTrackDebugResult::new(cleaned_track, raw_point_decisions);
    }
    let cleaned_samples = clean_moving_spikes(&accepted_samples);
    let position_snap_samples =
        settle_position_snap_recoveries(&cleaned_samples, &raw_point_decisions);
    let (dense_route_samples, dense_route_suppression_reasons) =
        settle_dense_main_routes(&position_snap_samples);
    let (drift_collapsed_samples, suppression_reasons) =
        collapse_stationary_drift(&dense_route_samples, &samples);
    let (weak_recovery_samples, weak_recovery_suppression_reasons) =
        preserve_weak_recovery_endpoints(&drift_collapsed_samples, &samples, &raw_point_decisions);
    let (round_trip_samples, round_trip_suppression_reasons) =
        simplify_round_trip_lines(&weak_recovery_samples);
    let (rest_photo_samples, rest_photo_suppression_reasons) =
        settle_rest_photo_micro_moves(&round_trip_samples);
    let (enclosed_loop_samples, enclosed_loop_suppression_reasons) =
        settle_enclosed_loop_clusters(&rest_photo_samples);
    let mut suppression_reasons = suppression_reasons;
    suppression_reasons.extend(dense_route_suppression_reasons);
    suppression_reasons.extend(weak_recovery_suppression_reasons);
    suppression_reasons.extend(round_trip_suppression_reasons);
    suppression_reasons.extend(rest_photo_suppression_reasons);
    suppression_reasons.extend(enclosed_loop_suppression_reasons);
    reconcile_cleaned_sample_decisions(
        &enclosed_loop_samples,
        &mut raw_point_decisions,
        &suppression_reasons,
    );
    let cleaned_track = build_cleaned_track(&enclosed_loop_samples, &barometer_windows);

    CleanedTrackDebugResult::new(cleaned_track, raw_point_decisions)
}

fn build_cleaned_track(
    accepted_samples: &[AcceptedTrackSample<'_>],
    barometer_windows: &[NormalizedBarometerWindow],
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
        let (distance_delta_meters, moving_time_delta_seconds, track_direction_degrees) = if index
            == 0
        {
            (0.0, 0.0, None)
        } else {
            let previous = accepted_samples[index - 1];
            let sample = *sample;
            let distance = haversine_distance_meters(
                previous.lat(),
                previous.lng(),
                sample.lat(),
                sample.lng(),
            );
            let direction = if distance > 0.0 {
                initial_bearing_degrees(previous.lat(), previous.lng(), sample.lat(), sample.lng())
            } else {
                None
            };
            let dt_seconds = elapsed_delta_seconds(previous.sample, sample.sample);
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
            source_sample_id: sample.sample.sample_id,
            lat: sample.lat(),
            lng: sample.lng(),
            track_direction_degrees,
            fix_elapsed_realtime_nanos: sample.sample.fix_elapsed_realtime_nanos,
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

    let gnss_elevation = compute_gnss_altitude_result(accepted_samples);
    let barometer_elevation = compute_barometer_result(barometer_windows);
    let selected_elevation = select_elevation_result(&barometer_elevation, &gnss_elevation);

    CleanedTrackResult {
        gpx_track_points: track_points.clone(),
        track_points,
        segments,
        summary: TrackSummary {
            total_distance_meters,
            moving_time_seconds,
            pace_seconds_per_km,
            total_ascent_meters: selected_elevation.total_ascent_meters.unwrap_or(0.0),
            total_descent_meters: selected_elevation.total_descent_meters.unwrap_or(0.0),
            selected_elevation_source: selected_elevation.source.to_string(),
        },
    }
}

fn decide_location_samples<'a>(
    samples: &'a [NormalizedLocationSample],
    sampling_epochs: &[SamplingEpoch],
    motion_windows: &[NormalizedMotionWindow],
    record_start_elapsed_realtime_nanos: i64,
) -> (Vec<AcceptedTrackSample<'a>>, Vec<RawPointDecision>) {
    let mut accepted = Vec::new();
    let mut decisions = Vec::with_capacity(samples.len());
    let mut state = IntakeState::default();
    let motion_index = MotionWindowIndex::new(motion_windows);

    for sample in samples {
        let epoch = find_sampling_epoch(sample, sampling_epochs);
        if let Some(reason) =
            intake_reject_reason(sample, epoch, record_start_elapsed_realtime_nanos, &state)
        {
            decisions.push(RawPointDecision::reject(sample.sample_id, reason));
            continue;
        }

        state.last_legal_elapsed_realtime_nanos = Some(sample.fix_elapsed_realtime_nanos);
        state.legal_fix_keys.insert(fix_key(sample));
        if accepted.is_empty() {
            match decide_first_fix(sample) {
                FirstFixDecision::Track(reason) => {
                    decisions.push(RawPointDecision::accept(sample.sample_id, reason, 1));
                    accepted.push(AcceptedTrackSample::normal(sample, reason));
                    state.previous_accepted_reason = Some(reason);
                }
                FirstFixDecision::Weak(reason) => {
                    decisions.push(RawPointDecision::weak(sample.sample_id, reason));
                }
            }
            continue;
        }

        let previous = accepted
            .last()
            .map(|accepted| accepted.sample)
            .expect("accepted is known non-empty before moving decision");
        let motion = motion_index.classify(sample.fix_elapsed_realtime_nanos);
        match decide_moving_point(sample, previous, motion, &mut state) {
            MovingPointDecision::Track(track_decision) => {
                decisions.push(RawPointDecision::accept(
                    sample.sample_id,
                    track_decision.reason,
                    (accepted.len() + 1) as i64,
                ));
                accepted.push(AcceptedTrackSample {
                    sample,
                    reason: track_decision.reason,
                    distance_delta_meters: track_decision.distance_delta_meters,
                    moving_time_delta_seconds: track_decision.moving_time_delta_seconds,
                    starts_new_segment: track_decision.starts_new_segment,
                    lat_override: None,
                    lng_override: None,
                    suppression_reason: None,
                });
                state.previous_accepted_reason = Some(track_decision.reason);
            }
            MovingPointDecision::Weak(reason) => {
                decisions.push(RawPointDecision::weak(sample.sample_id, reason));
            }
            MovingPointDecision::Reject(reason) => {
                decisions.push(RawPointDecision::reject(sample.sample_id, reason));
            }
        }
    }

    (accepted, decisions)
}

#[derive(Clone, Copy)]
struct AcceptedTrackSample<'a> {
    sample: &'a NormalizedLocationSample,
    reason: &'static str,
    distance_delta_meters: Option<f64>,
    moving_time_delta_seconds: Option<f64>,
    starts_new_segment: bool,
    lat_override: Option<f64>,
    lng_override: Option<f64>,
    suppression_reason: Option<&'static str>,
}

impl<'a> AcceptedTrackSample<'a> {
    fn normal(sample: &'a NormalizedLocationSample, reason: &'static str) -> Self {
        Self {
            sample,
            reason,
            distance_delta_meters: None,
            moving_time_delta_seconds: None,
            starts_new_segment: false,
            lat_override: None,
            lng_override: None,
            suppression_reason: None,
        }
    }

    fn lat(self) -> f64 {
        self.lat_override.unwrap_or(self.sample.lat)
    }

    fn lng(self) -> f64 {
        self.lng_override.unwrap_or(self.sample.lng)
    }
}

fn sample_distance_delta_override(sample: AcceptedTrackSample<'_>, fallback: f64) -> f64 {
    sample.distance_delta_meters.unwrap_or(fallback)
}

fn sample_moving_time_delta_override(sample: AcceptedTrackSample<'_>, fallback: f64) -> f64 {
    sample.moving_time_delta_seconds.unwrap_or(fallback)
}

fn clean_moving_spikes<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
) -> Vec<AcceptedTrackSample<'a>> {
    let candidates = non_overlapping_moving_spike_candidates(accepted_samples);
    if candidates.is_empty() {
        return accepted_samples.to_vec();
    }

    let suppressed_indexes = candidates
        .iter()
        .map(|candidate| candidate.index)
        .collect::<HashSet<_>>();
    let bridge_by_next_index = candidates
        .iter()
        .map(|candidate| (candidate.index + 1, *candidate))
        .collect::<HashMap<_, _>>();
    let mut cleaned = Vec::with_capacity(accepted_samples.len() - candidates.len());

    for (index, accepted) in accepted_samples.iter().copied().enumerate() {
        if suppressed_indexes.contains(&index) {
            continue;
        }
        if let Some(candidate) = bridge_by_next_index.get(&index) {
            let previous = accepted_samples[candidate.index - 1];
            let spike = accepted_samples[candidate.index];
            let next = accepted;
            let bridge_distance = haversine_distance_meters(
                previous.sample.lat,
                previous.sample.lng,
                next.sample.lat,
                next.sample.lng,
            );
            cleaned.push(AcceptedTrackSample {
                sample: next.sample,
                reason: "moving_spike_line_bridge",
                distance_delta_meters: Some(bridge_distance),
                moving_time_delta_seconds: None,
                starts_new_segment: next.starts_new_segment,
                lat_override: None,
                lng_override: None,
                suppression_reason: None,
            });
        } else {
            cleaned.push(accepted);
        }
    }
    cleaned
}

fn reconcile_cleaned_sample_decisions(
    cleaned_samples: &[AcceptedTrackSample<'_>],
    decisions: &mut [RawPointDecision],
    suppression_reasons: &HashMap<i64, &'static str>,
) {
    let cleaned_by_sample_id = cleaned_samples
        .iter()
        .enumerate()
        .map(|(index, accepted)| {
            (
                accepted.sample.sample_id,
                ((index + 1) as i64, accepted.reason),
            )
        })
        .collect::<HashMap<_, _>>();

    for decision in decisions {
        if let Some((track_point_id, reason)) = cleaned_by_sample_id.get(&decision.sample_id) {
            decision.result = "accept".to_string();
            decision.track_point_id = Some(*track_point_id);
            decision.reason = (*reason).to_string();
            decision.metric_owner = true;
            decision.affected_metric_gates = route_distance_time_gates_for_core();
        } else if decision.result == "accept" {
            decision.result = "weak".to_string();
            decision.reason = suppression_reasons
                .get(&decision.sample_id)
                .copied()
                .unwrap_or("moving_spike_line_bridge_suppressed")
                .to_string();
            decision.track_point_id = None;
            decision.metric_owner = false;
            decision.affected_metric_gates.clear();
        }
    }
}

fn route_distance_time_gates_for_core() -> Vec<String> {
    vec![
        "route".to_string(),
        "distance".to_string(),
        "moving_time".to_string(),
    ]
}

fn settle_position_snap_recoveries<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    decisions: &[RawPointDecision],
) -> Vec<AcceptedTrackSample<'a>> {
    if accepted_samples.len() < 2 {
        return accepted_samples.to_vec();
    }
    let weak_by_sample_id = decisions
        .iter()
        .filter(|decision| {
            decision.result == "weak"
                && decision.reason == "implied_speed_unconfirmed_by_reported_speed"
        })
        .map(|decision| (decision.sample_id, decision))
        .collect::<HashMap<_, _>>();
    if weak_by_sample_id.is_empty() {
        return accepted_samples.to_vec();
    }

    let mut settled = accepted_samples.to_vec();
    for index in 1..settled.len() {
        let previous = settled[index - 1];
        let point = settled[index];
        if !is_position_snap_recovery_candidate(previous, point, &weak_by_sample_id) {
            continue;
        }
        settled[index] = AcceptedTrackSample {
            sample: point.sample,
            reason: "position_snap_recovery_anchor",
            distance_delta_meters: Some(0.0),
            moving_time_delta_seconds: Some(0.0),
            starts_new_segment: point.starts_new_segment,
            lat_override: None,
            lng_override: None,
            suppression_reason: None,
        };
    }
    settled
}

fn is_position_snap_recovery_candidate(
    previous: AcceptedTrackSample<'_>,
    point: AcceptedTrackSample<'_>,
    weak_by_sample_id: &HashMap<i64, &RawPointDecision>,
) -> bool {
    if point.reason == "gap_recovery" {
        return false;
    }
    if point.reason != "moving_good_fix"
        && point.reason != "motion_supported_low_speed"
        && point.reason != "continuity_rescue_low_accuracy"
    {
        return false;
    }
    if point
        .sample
        .speed_meters_per_second
        .filter(|speed| speed.is_finite())
        .map_or(false, |speed| {
            speed > POSITION_SNAP_RECOVERY_MAX_REPORTED_SPEED_METERS_PER_SECOND
        })
    {
        return false;
    }
    let bridge_distance = haversine_distance_meters(
        previous.sample.lat,
        previous.sample.lng,
        point.sample.lat,
        point.sample.lng,
    );
    if bridge_distance < POSITION_SNAP_RECOVERY_MIN_BRIDGE_DISTANCE_METERS {
        return false;
    }
    let start_sample_id = previous.sample.sample_id.min(point.sample.sample_id) + 1;
    let end_sample_id = previous.sample.sample_id.max(point.sample.sample_id);
    let weak_count = (start_sample_id..end_sample_id)
        .filter(|sample_id| weak_by_sample_id.contains_key(sample_id))
        .count();
    weak_count >= POSITION_SNAP_RECOVERY_MIN_WEAK_POINTS
}

fn collapse_stationary_drift<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    all_samples: &'a [NormalizedLocationSample],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let intervals = find_dwell_drift_intervals(all_samples);
    if intervals.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }

    let mut interval_by_sample_id = HashMap::new();
    for (interval_index, interval) in intervals.iter().enumerate() {
        for sample in &interval.samples {
            interval_by_sample_id.insert(sample.sample_id, interval_index);
        }
    }
    let mut accepted_samples_by_interval: HashMap<usize, Vec<&NormalizedLocationSample>> =
        HashMap::new();
    for accepted in accepted_samples {
        if let Some(interval_index) = interval_by_sample_id.get(&accepted.sample.sample_id) {
            accepted_samples_by_interval
                .entry(*interval_index)
                .or_default()
                .push(accepted.sample);
        }
    }

    let mut emitted_intervals = HashSet::new();
    let mut suppression_reasons = HashMap::new();
    let mut collapsed = Vec::with_capacity(accepted_samples.len());
    for accepted in accepted_samples.iter().copied() {
        let Some(interval_index) = interval_by_sample_id
            .get(&accepted.sample.sample_id)
            .copied()
        else {
            collapsed.push(accepted);
            continue;
        };
        if emitted_intervals.insert(interval_index) {
            let interval = &intervals[interval_index];
            let center = weighted_sample_center(&interval.samples);
            let representative_candidates = accepted_samples_by_interval
                .get(&interval_index)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            let representative = nearest_sample(center.lat, center.lng, representative_candidates)
                .unwrap_or(accepted.sample);
            collapsed.push(AcceptedTrackSample {
                sample: representative,
                reason: "stationary_drift_anchor",
                distance_delta_meters: Some(0.0),
                moving_time_delta_seconds: Some(0.0),
                starts_new_segment: accepted.starts_new_segment,
                lat_override: Some(center.lat),
                lng_override: Some(center.lng),
                suppression_reason: None,
            });
        } else {
            suppression_reasons.insert(
                accepted.sample.sample_id,
                "stationary_drift_anchor_suppressed",
            );
            collapsed.push(AcceptedTrackSample {
                suppression_reason: Some("stationary_drift_anchor_suppressed"),
                ..accepted
            });
        }
    }

    (
        collapsed
            .into_iter()
            .filter(|accepted| accepted.suppression_reason.is_none())
            .collect(),
        suppression_reasons,
    )
}

fn preserve_weak_recovery_endpoints<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    all_samples: &'a [NormalizedLocationSample],
    decisions: &[RawPointDecision],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let candidates = weak_recovery_endpoint_candidates(accepted_samples, all_samples, decisions);
    if candidates.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }

    let mut anchors = candidates
        .into_iter()
        .map(|candidate| {
            let center = weighted_sample_center(&candidate.raw_points);
            let representative =
                weak_recovery_representative(center.lat, center.lng, &candidate.raw_points)
                    .unwrap_or(candidate.raw_points[0]);
            (
                representative.fix_elapsed_realtime_nanos,
                AcceptedTrackSample {
                    sample: representative,
                    reason: "weak_recovery_shape_anchor",
                    distance_delta_meters: Some(0.0),
                    moving_time_delta_seconds: Some(0.0),
                    starts_new_segment: true,
                    lat_override: Some(center.lat),
                    lng_override: Some(center.lng),
                    suppression_reason: None,
                },
                candidate
                    .raw_points
                    .iter()
                    .map(|sample| sample.sample_id)
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<Vec<_>>();
    anchors.sort_by_key(|(elapsed, _, _)| *elapsed);

    let mut output = Vec::with_capacity(accepted_samples.len() + anchors.len());
    let mut suppression_reasons = HashMap::new();
    let mut anchor_index = 0;
    for accepted in accepted_samples.iter().copied() {
        while anchor_index < anchors.len()
            && anchors[anchor_index].0 < accepted.sample.fix_elapsed_realtime_nanos
        {
            for sample_id in &anchors[anchor_index].2 {
                if *sample_id != anchors[anchor_index].1.sample.sample_id {
                    suppression_reasons.insert(*sample_id, "weak_recovery_shape_anchor_suppressed");
                }
            }
            output.push(anchors[anchor_index].1);
            anchor_index += 1;
        }
        output.push(accepted);
    }
    while anchor_index < anchors.len() {
        for sample_id in &anchors[anchor_index].2 {
            if *sample_id != anchors[anchor_index].1.sample.sample_id {
                suppression_reasons.insert(*sample_id, "weak_recovery_shape_anchor_suppressed");
            }
        }
        output.push(anchors[anchor_index].1);
        anchor_index += 1;
    }
    (output, suppression_reasons)
}

struct WeakRecoveryCandidate<'a> {
    raw_points: Vec<&'a NormalizedLocationSample>,
}

fn weak_recovery_endpoint_candidates<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    all_samples: &'a [NormalizedLocationSample],
    decisions: &[RawPointDecision],
) -> Vec<WeakRecoveryCandidate<'a>> {
    let sample_by_id = all_samples
        .iter()
        .map(|sample| (sample.sample_id, sample))
        .collect::<HashMap<_, _>>();
    let mut weak_points = decisions
        .iter()
        .filter(|decision| decision.result == "weak" && decision.reason == "gap_recovery_pending")
        .filter_map(|decision| sample_by_id.get(&decision.sample_id).copied())
        .filter(|sample| {
            is_valid_coordinate(sample.lat, sample.lng)
                && sample.horizontal_accuracy_meters.is_finite()
        })
        .collect::<Vec<_>>();
    weak_points.sort_by_key(|sample| sample.sample_id);

    let groups = consecutive_weak_recovery_groups(&weak_points);
    let mut candidates = Vec::new();
    for group in groups {
        if group.len() < WEAK_RECOVERY_SHAPE_MIN_SAMPLES {
            continue;
        }
        let previous_trusted =
            previous_accepted_before(accepted_samples, group[0].fix_elapsed_realtime_nanos);
        let Some(previous_trusted) = previous_trusted else {
            continue;
        };
        if elapsed_delta_seconds(previous_trusted.sample, group[0]) <= GAP_SECONDS {
            continue;
        }
        let core_points = group
            .iter()
            .take(WEAK_RECOVERY_SHAPE_MIN_SAMPLES)
            .copied()
            .collect::<Vec<_>>();
        let core_center = weighted_sample_center(&core_points);
        if weighted_sample_radius(core_center, &core_points) > WEAK_RECOVERY_SHAPE_MAX_RADIUS_METERS
        {
            continue;
        }
        let best_accuracy = core_points
            .iter()
            .map(|sample| sample.horizontal_accuracy_meters)
            .fold(f64::INFINITY, f64::min);
        if !best_accuracy.is_finite()
            || best_accuracy > WEAK_RECOVERY_SHAPE_MAX_BEST_ACCURACY_METERS
        {
            continue;
        }
        let raw_points = group
            .iter()
            .take(WEAK_RECOVERY_SHAPE_MIN_SAMPLES + WEAK_RECOVERY_SHAPE_MAX_EXTENSION_SAMPLES)
            .copied()
            .collect::<Vec<_>>();
        let center = weighted_sample_center(&raw_points);
        let distance_from_trusted = haversine_distance_meters(
            previous_trusted.lat(),
            previous_trusted.lng(),
            center.lat,
            center.lng,
        );
        if distance_from_trusted < WEAK_RECOVERY_SHAPE_MIN_DISTANCE_FROM_TRUSTED_METERS {
            continue;
        }
        candidates.push(WeakRecoveryCandidate { raw_points });
    }
    candidates
}

fn consecutive_weak_recovery_groups<'a>(
    weak_points: &[&'a NormalizedLocationSample],
) -> Vec<Vec<&'a NormalizedLocationSample>> {
    let mut groups = Vec::new();
    let mut current: Vec<&'a NormalizedLocationSample> = Vec::new();
    for point in weak_points.iter().copied() {
        if let Some(previous) = current.last().copied() {
            let same_group = point.sample_id == previous.sample_id + 1
                && sample_gap_seconds(previous, point) <= WEAK_RECOVERY_SHAPE_EXTENSION_GAP_SECONDS
                && haversine_distance_meters(previous.lat, previous.lng, point.lat, point.lng)
                    <= WEAK_RECOVERY_SHAPE_EXTENSION_DISTANCE_METERS;
            if !same_group {
                groups.push(current);
                current = Vec::new();
            }
        }
        current.push(point);
    }
    if !current.is_empty() {
        groups.push(current);
    }
    groups
}

fn previous_accepted_before<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    elapsed_realtime_nanos: i64,
) -> Option<AcceptedTrackSample<'a>> {
    accepted_samples
        .iter()
        .copied()
        .take_while(|accepted| accepted.sample.fix_elapsed_realtime_nanos < elapsed_realtime_nanos)
        .last()
}

fn weak_recovery_representative<'a>(
    lat: f64,
    lng: f64,
    samples: &[&'a NormalizedLocationSample],
) -> Option<&'a NormalizedLocationSample> {
    samples.iter().copied().min_by(|left, right| {
        compare_f64(
            left.horizontal_accuracy_meters,
            right.horizontal_accuracy_meters,
        )
        .then_with(|| {
            compare_f64(
                haversine_distance_meters(lat, lng, left.lat, left.lng),
                haversine_distance_meters(lat, lng, right.lat, right.lng),
            )
        })
        .then_with(|| left.sample_id.cmp(&right.sample_id))
    })
}

fn settle_rest_photo_micro_moves<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let candidates = non_overlapping_rest_photo_candidates(accepted_samples);
    if candidates.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }
    let mut candidate_by_start = HashMap::new();
    for candidate in &candidates {
        candidate_by_start.insert(candidate.start_index, *candidate);
    }

    let mut output = Vec::with_capacity(accepted_samples.len());
    let mut suppression_reasons = HashMap::new();
    let mut index = 0;
    while index < accepted_samples.len() {
        if let Some(candidate) = candidate_by_start.get(&index) {
            let span = &accepted_samples[candidate.start_index..=candidate.end_index];
            match candidate.rebuild {
                RestPhotoRebuild::Anchor => {
                    let representative = rest_photo_representative(span);
                    output.push(AcceptedTrackSample {
                        sample: representative.sample,
                        reason: "rest_photo_micro_move_anchor",
                        distance_delta_meters: Some(0.0),
                        moving_time_delta_seconds: Some(0.0),
                        starts_new_segment: representative.starts_new_segment,
                        lat_override: representative.lat_override,
                        lng_override: representative.lng_override,
                        suppression_reason: None,
                    });
                    for suppressed in span {
                        if suppressed.sample.sample_id != representative.sample.sample_id {
                            suppression_reasons.insert(
                                suppressed.sample.sample_id,
                                "rest_photo_micro_move_anchor_suppressed",
                            );
                        }
                    }
                }
                RestPhotoRebuild::ShapeFilter => {
                    append_rest_photo_shape_filtered_samples(
                        span,
                        &mut output,
                        &mut suppression_reasons,
                    );
                }
                RestPhotoRebuild::Simplifier => {
                    append_rest_photo_simplified_samples(
                        span,
                        &mut output,
                        &mut suppression_reasons,
                    );
                }
            }
            index = candidate.end_index + 1;
        } else {
            output.push(accepted_samples[index]);
            index += 1;
        }
    }
    (output, suppression_reasons)
}

#[derive(Clone, Copy)]
enum RestPhotoRebuild {
    Anchor,
    ShapeFilter,
    Simplifier,
}

#[derive(Clone, Copy)]
struct RestPhotoCandidate {
    start_index: usize,
    end_index: usize,
    path_meters: f64,
    net_distance_meters: f64,
    bbox_meters: f64,
    duration_seconds: f64,
    rebuild: RestPhotoRebuild,
    score: f64,
}

fn non_overlapping_rest_photo_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<RestPhotoCandidate> {
    let mut candidates = Vec::new();
    for start_index in 0..accepted_samples.len() {
        let max_end = (start_index + REST_PHOTO_MICRO_MOVE_MAX_TRACK_POINTS - 1)
            .min(accepted_samples.len().saturating_sub(1));
        for end_index in (start_index + REST_PHOTO_MICRO_MOVE_MIN_TRACK_POINTS - 1)..=max_end {
            if let Some(candidate) = rest_photo_candidate(accepted_samples, start_index, end_index)
            {
                candidates.push(candidate);
            }
        }
    }
    candidates.sort_by(|a, b| {
        compare_f64(b.score, a.score)
            .then_with(|| a.start_index.cmp(&b.start_index))
            .then_with(|| b.end_index.cmp(&a.end_index))
    });
    let mut accepted = Vec::new();
    for candidate in candidates {
        if accepted.iter().any(|existing: &RestPhotoCandidate| {
            ranges_overlap(
                candidate.start_index,
                candidate.end_index,
                existing.start_index,
                existing.end_index,
            )
        }) {
            continue;
        }
        accepted.push(candidate);
    }
    accepted.sort_by_key(|candidate| candidate.start_index);
    accepted
}

fn rest_photo_candidate(
    accepted_samples: &[AcceptedTrackSample<'_>],
    start_index: usize,
    end_index: usize,
) -> Option<RestPhotoCandidate> {
    let span = &accepted_samples[start_index..=end_index];
    if span
        .iter()
        .any(|sample| protected_local_settlement_reason(sample.reason))
    {
        return None;
    }
    if !span.iter().all(|sample| {
        is_valid_coordinate(sample.lat(), sample.lng()) && !is_transport_track_reason(sample.reason)
    }) {
        return None;
    }
    let path_meters = accepted_path_meters(span);
    if !(REST_PHOTO_MICRO_MOVE_MIN_PATH_METERS..=REST_PHOTO_MICRO_MOVE_MAX_PATH_METERS)
        .contains(&path_meters)
    {
        return None;
    }
    let net_distance_meters = haversine_distance_meters(
        span[0].lat(),
        span[0].lng(),
        span[span.len() - 1].lat(),
        span[span.len() - 1].lng(),
    );
    if net_distance_meters > REST_PHOTO_MICRO_MOVE_MAX_ENDPOINT_DISTANCE_METERS {
        return None;
    }
    if path_meters / net_distance_meters.max(1.0) < REST_PHOTO_MICRO_MOVE_MIN_PATH_NET_RATIO {
        return None;
    }
    let bbox_meters = accepted_bbox_diagonal_meters(span);
    if bbox_meters > REST_PHOTO_MICRO_MOVE_MAX_BBOX_METERS {
        return None;
    }
    let duration_seconds = elapsed_delta_seconds(span[0].sample, span[span.len() - 1].sample);
    if duration_seconds > REST_PHOTO_MICRO_MOVE_MAX_DURATION_SECONDS {
        return None;
    }
    let low_speed_count = span
        .iter()
        .filter(|sample| {
            sample.reason == "motion_supported_low_speed"
                || sample.reason == "moving_good_fix"
                || sample.reason == "stationary_anchor"
        })
        .count();
    if low_speed_count as f64 / (span.len() as f64) < 0.8 {
        return None;
    }
    let rebuild = if rest_photo_shape_filter_may_apply(span, path_meters, duration_seconds) {
        RestPhotoRebuild::ShapeFilter
    } else if rest_photo_should_collapse(
        path_meters,
        net_distance_meters,
        bbox_meters,
        duration_seconds,
    ) {
        RestPhotoRebuild::Anchor
    } else {
        RestPhotoRebuild::Simplifier
    };
    Some(RestPhotoCandidate {
        start_index,
        end_index,
        path_meters,
        net_distance_meters,
        bbox_meters,
        duration_seconds,
        rebuild,
        score: path_meters + span.len() as f64 * 2.0,
    })
}

fn rest_photo_should_collapse(
    path_meters: f64,
    net_distance_meters: f64,
    bbox_meters: f64,
    duration_seconds: f64,
) -> bool {
    let short_foldback = bbox_meters <= REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_BBOX_METERS
        && net_distance_meters <= REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_NET_DISTANCE_METERS
        && path_meters <= REST_PHOTO_MICRO_MOVE_COLLAPSE_MAX_PATH_METERS;
    let long_rest_drift = duration_seconds
        >= REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MIN_DURATION_SECONDS
        && bbox_meters <= REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_BBOX_METERS
        && net_distance_meters <= REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_NET_DISTANCE_METERS
        && path_meters <= REST_PHOTO_MICRO_MOVE_LONG_COLLAPSE_MAX_PATH_METERS;
    short_foldback || long_rest_drift
}

fn rest_photo_shape_filter_may_apply(
    span: &[AcceptedTrackSample<'_>],
    path_meters: f64,
    duration_seconds: f64,
) -> bool {
    span.len() <= REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_TRACK_POINTS
        && path_meters <= REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_PATH_METERS
        && duration_seconds <= REST_PHOTO_MICRO_MOVE_SHAPE_FILTER_MAX_DURATION_SECONDS
        && span.iter().enumerate().any(|(index, sample)| {
            index > 0
                && index + 1 < span.len()
                && (sample.reason == "stationary_anchor"
                    || sample
                        .sample
                        .speed_meters_per_second
                        .filter(|speed| speed.is_finite())
                        .map_or(false, |speed| speed <= 0.1))
        })
}

fn append_rest_photo_shape_filtered_samples<'a>(
    span: &[AcceptedTrackSample<'a>],
    output: &mut Vec<AcceptedTrackSample<'a>>,
    suppression_reasons: &mut HashMap<i64, &'static str>,
) {
    let mut pending_suppressed = Vec::new();
    let mut kept_in_span = 0usize;
    for (span_index, original) in span.iter().copied().enumerate() {
        if rest_photo_shape_filter_suppresses_sample(span, span_index) {
            pending_suppressed.push(original.sample.sample_id);
            continue;
        }
        let is_start = kept_in_span == 0;
        let is_end = span_index == span.len() - 1;
        let reason = rest_photo_micro_move_reason(is_start, is_end);
        let distance_delta = output
            .last()
            .filter(|previous| !pending_suppressed.is_empty())
            .map(|previous| {
                haversine_distance_meters(
                    previous.lat(),
                    previous.lng(),
                    original.lat(),
                    original.lng(),
                )
            })
            .or(original.distance_delta_meters);
        let moving_time_delta = if pending_suppressed.is_empty() {
            original.moving_time_delta_seconds
        } else {
            Some(0.0)
        };
        for sample_id in pending_suppressed.drain(..) {
            suppression_reasons.insert(sample_id, "rest_photo_micro_move_shape_filter_suppressed");
        }
        output.push(AcceptedTrackSample {
            sample: original.sample,
            reason,
            distance_delta_meters: distance_delta,
            moving_time_delta_seconds: moving_time_delta,
            starts_new_segment: original.starts_new_segment,
            lat_override: original.lat_override,
            lng_override: original.lng_override,
            suppression_reason: None,
        });
        kept_in_span += 1;
    }
    if let Some(last) = output.last() {
        for sample_id in pending_suppressed {
            if sample_id != last.sample.sample_id {
                suppression_reasons
                    .insert(sample_id, "rest_photo_micro_move_shape_filter_suppressed");
            }
        }
    }
}

fn append_rest_photo_simplified_samples<'a>(
    span: &[AcceptedTrackSample<'a>],
    output: &mut Vec<AcceptedTrackSample<'a>>,
    suppression_reasons: &mut HashMap<i64, &'static str>,
) {
    let keep_indexes = rest_photo_simplify_keep_indexes(span);
    for (keep_order, span_index) in keep_indexes.iter().copied().enumerate() {
        let previous_keep_span_index = if keep_order == 0 {
            None
        } else {
            Some(keep_indexes[keep_order - 1])
        };
        let group_start = previous_keep_span_index.map_or(0, |value| value + 1);
        let group = &span[group_start..=span_index];
        let fallback = span[span_index];
        let original = rest_photo_group_representative(group, fallback);
        let is_start = keep_order == 0;
        let is_end = keep_order + 1 == keep_indexes.len();
        let distance_delta = previous_keep_span_index
            .map(|_| {
                output.last().map_or(0.0, |previous| {
                    haversine_distance_meters(
                        previous.lat(),
                        previous.lng(),
                        original.lat(),
                        original.lng(),
                    )
                })
            })
            .or(original.distance_delta_meters);
        let moving_time_delta = Some(
            group
                .iter()
                .filter_map(|sample| sample.moving_time_delta_seconds)
                .sum::<f64>(),
        );
        output.push(AcceptedTrackSample {
            sample: original.sample,
            reason: rest_photo_micro_move_reason(is_start, is_end),
            distance_delta_meters: distance_delta,
            moving_time_delta_seconds: moving_time_delta,
            starts_new_segment: original.starts_new_segment,
            lat_override: original.lat_override,
            lng_override: original.lng_override,
            suppression_reason: None,
        });
        for suppressed in group {
            if suppressed.sample.sample_id != original.sample.sample_id {
                suppression_reasons.insert(
                    suppressed.sample.sample_id,
                    "rest_photo_micro_move_simplifier_suppressed",
                );
            }
        }
    }
}

fn rest_photo_shape_filter_suppresses_sample(
    span: &[AcceptedTrackSample<'_>],
    span_index: usize,
) -> bool {
    span_index > 0
        && span_index + 1 < span.len()
        && (span[span_index].reason == "stationary_anchor"
            || span[span_index]
                .sample
                .speed_meters_per_second
                .filter(|speed| speed.is_finite())
                .map_or(false, |speed| speed <= 0.1))
}

fn rest_photo_simplify_keep_indexes(span: &[AcceptedTrackSample<'_>]) -> Vec<usize> {
    let mut keep = HashSet::new();
    keep.insert(0);
    keep.insert(span.len() - 1);
    simplify_accepted_span_by_distance(
        span,
        0,
        span.len() - 1,
        REST_PHOTO_MICRO_MOVE_SIMPLIFY_TOLERANCE_METERS,
        &mut keep,
    );
    let mut sorted = keep.into_iter().collect::<Vec<_>>();
    sorted.sort_unstable();
    while sorted.len() > REST_PHOTO_MICRO_MOVE_SIMPLIFY_MAX_OUTPUT_TRACK_POINTS {
        let removable = sorted
            .iter()
            .copied()
            .filter(|index| *index != 0 && *index + 1 != span.len())
            .min_by(|left, right| {
                compare_f64(
                    rest_photo_keep_priority(span, &sorted, *left),
                    rest_photo_keep_priority(span, &sorted, *right),
                )
                .then_with(|| left.cmp(right))
            });
        let Some(removable) = removable else {
            break;
        };
        sorted.retain(|index| *index != removable);
    }
    sorted
}

fn rest_photo_keep_priority(
    span: &[AcceptedTrackSample<'_>],
    keep_indexes: &[usize],
    span_index: usize,
) -> f64 {
    let Some(position) = keep_indexes.iter().position(|index| *index == span_index) else {
        return f64::INFINITY;
    };
    if position == 0 || position + 1 >= keep_indexes.len() {
        return f64::INFINITY;
    }
    let previous = span[keep_indexes[position - 1]];
    let current = span[span_index];
    let next = span[keep_indexes[position + 1]];
    haversine_distance_meters(previous.lat(), previous.lng(), current.lat(), current.lng())
        + haversine_distance_meters(current.lat(), current.lng(), next.lat(), next.lng())
        - haversine_distance_meters(previous.lat(), previous.lng(), next.lat(), next.lng())
}

fn rest_photo_group_representative<'a>(
    group: &[AcceptedTrackSample<'a>],
    fallback: AcceptedTrackSample<'a>,
) -> AcceptedTrackSample<'a> {
    group
        .iter()
        .copied()
        .min_by(|left, right| {
            let left_distance =
                haversine_distance_meters(left.lat(), left.lng(), fallback.lat(), fallback.lng());
            let right_distance =
                haversine_distance_meters(right.lat(), right.lng(), fallback.lat(), fallback.lng());
            compare_f64(left_distance, right_distance)
                .then_with(|| left.sample.sample_id.cmp(&right.sample.sample_id))
        })
        .unwrap_or(fallback)
}

fn rest_photo_micro_move_reason(is_start: bool, is_end: bool) -> &'static str {
    if is_start {
        "rest_photo_micro_move_start"
    } else if is_end {
        "rest_photo_micro_move_end"
    } else {
        "rest_photo_micro_move_shape"
    }
}

fn rest_photo_representative<'a>(span: &[AcceptedTrackSample<'a>]) -> AcceptedTrackSample<'a> {
    if let Some(stationary) = span
        .iter()
        .copied()
        .find(|sample| sample.reason == "stationary_anchor")
    {
        return stationary;
    }
    span.iter()
        .copied()
        .min_by(|left, right| {
            let left_speed = left.sample.speed_meters_per_second.unwrap_or(0.0);
            let right_speed = right.sample.speed_meters_per_second.unwrap_or(0.0);
            compare_f64(left_speed, right_speed)
                .then_with(|| left.sample.sample_id.cmp(&right.sample.sample_id))
        })
        .unwrap_or(span[0])
}

fn settle_dense_main_routes<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let candidates = non_overlapping_dense_main_route_candidates(accepted_samples);
    if candidates.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }
    let mut candidate_by_start = HashMap::new();
    for candidate in &candidates {
        candidate_by_start.insert(candidate.start_index, candidate.clone());
    }

    let mut output = Vec::with_capacity(accepted_samples.len());
    let mut suppression_reasons = HashMap::new();
    let mut index = 0;
    while index < accepted_samples.len() {
        if let Some(candidate) = candidate_by_start.get(&index) {
            let span = &accepted_samples[candidate.start_index..=candidate.end_index];
            for (keep_order, span_index) in candidate.keep_indexes.iter().copied().enumerate() {
                let original = span[span_index];
                let previous_keep_span_index = if keep_order == 0 {
                    None
                } else {
                    Some(candidate.keep_indexes[keep_order - 1])
                };
                let reason = if keep_order == 0 {
                    "dense_main_route_start"
                } else if keep_order + 1 == candidate.keep_indexes.len() {
                    "dense_main_route_end"
                } else {
                    "dense_main_route_shape"
                };
                let distance_delta = previous_keep_span_index.map(|previous_index| {
                    haversine_distance_meters(
                        span[previous_index].lat(),
                        span[previous_index].lng(),
                        original.lat(),
                        original.lng(),
                    )
                });
                output.push(AcceptedTrackSample {
                    sample: original.sample,
                    reason,
                    distance_delta_meters: distance_delta,
                    moving_time_delta_seconds: None,
                    starts_new_segment: original.starts_new_segment,
                    lat_override: original.lat_override,
                    lng_override: original.lng_override,
                    suppression_reason: None,
                });
                let group_start = previous_keep_span_index.map_or(0, |value| value + 1);
                for suppressed in &span[group_start..span_index] {
                    suppression_reasons.insert(
                        suppressed.sample.sample_id,
                        "dense_main_route_skeleton_suppressed",
                    );
                }
            }
            index = candidate.end_index + 1;
        } else {
            output.push(accepted_samples[index]);
            index += 1;
        }
    }
    (output, suppression_reasons)
}

#[derive(Clone)]
struct DenseMainRouteCandidate {
    start_index: usize,
    end_index: usize,
    keep_indexes: Vec<usize>,
    path_meters: f64,
    score: f64,
}

fn non_overlapping_dense_main_route_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<DenseMainRouteCandidate> {
    let mut candidates = Vec::new();
    let mut start = 0;
    while start < accepted_samples.len() {
        while start < accepted_samples.len()
            && !can_be_dense_main_route_point(accepted_samples[start])
        {
            start += 1;
        }
        let mut end = start;
        while end < accepted_samples.len() && can_be_dense_main_route_point(accepted_samples[end]) {
            end += 1;
        }
        if end - start >= DENSE_MAIN_ROUTE_MIN_TRACK_POINTS {
            if let Some(candidate) = dense_main_route_candidate(accepted_samples, start, end - 1) {
                candidates.push(candidate);
            }
        }
        start = (end + 1).max(start + 1);
    }
    candidates.sort_by(|a, b| {
        compare_f64(b.score, a.score)
            .then_with(|| a.start_index.cmp(&b.start_index))
            .then_with(|| b.end_index.cmp(&a.end_index))
    });
    let mut accepted = Vec::new();
    for candidate in candidates {
        if accepted.iter().any(|existing: &DenseMainRouteCandidate| {
            ranges_overlap(
                candidate.start_index,
                candidate.end_index,
                existing.start_index,
                existing.end_index,
            )
        }) {
            continue;
        }
        accepted.push(candidate);
    }
    accepted.sort_by_key(|candidate| candidate.start_index);
    accepted
}

fn simplify_round_trip_lines<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let candidates = non_overlapping_round_trip_line_candidates(accepted_samples);
    if candidates.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }
    let mut candidate_by_start = HashMap::new();
    for candidate in &candidates {
        candidate_by_start.insert(candidate.start_index, candidate.clone());
    }
    let mut output = Vec::with_capacity(accepted_samples.len());
    let mut suppression_reasons = HashMap::new();
    let mut index = 0;
    while index < accepted_samples.len() {
        if let Some(candidate) = candidate_by_start.get(&index) {
            let span = &accepted_samples[candidate.start_index..=candidate.end_index];
            for (keep_order, span_index) in candidate.keep_indexes.iter().copied().enumerate() {
                let original = span[span_index];
                let previous_keep_span_index = if keep_order == 0 {
                    None
                } else {
                    Some(candidate.keep_indexes[keep_order - 1])
                };
                let is_turn = span_index == candidate.turn_span_index;
                let reason = if is_turn {
                    "weak_recovery_shape_anchor"
                } else if keep_order == 0 {
                    "round_trip_interwoven_start"
                } else if keep_order + 1 == candidate.keep_indexes.len() {
                    "round_trip_interwoven_end"
                } else {
                    "round_trip_interwoven_shape"
                };
                let group_start = previous_keep_span_index.map_or(0, |value| value + 1);
                let distance_delta = if keep_order == 0 {
                    original.distance_delta_meters
                } else {
                    Some(accepted_path_meters(&span[group_start..=span_index]))
                };
                let centerline = if candidate.same_road && !is_turn {
                    same_road_centerline_coordinate(span, candidate.turn_span_index, span_index)
                } else {
                    None
                };
                output.push(AcceptedTrackSample {
                    sample: original.sample,
                    reason,
                    distance_delta_meters: distance_delta,
                    moving_time_delta_seconds: None,
                    starts_new_segment: original.starts_new_segment,
                    lat_override: centerline
                        .map(|coordinate| coordinate.0)
                        .or(original.lat_override),
                    lng_override: centerline
                        .map(|coordinate| coordinate.1)
                        .or(original.lng_override),
                    suppression_reason: None,
                });
                for suppressed in &span[group_start..span_index] {
                    suppression_reasons
                        .insert(suppressed.sample.sample_id, "round_trip_line_suppressed");
                }
            }
            index = candidate.end_index + 1;
        } else {
            output.push(accepted_samples[index]);
            index += 1;
        }
    }
    (output, suppression_reasons)
}

#[derive(Clone)]
struct RoundTripLineCandidate {
    start_index: usize,
    turn_index: usize,
    end_index: usize,
    turn_span_index: usize,
    keep_indexes: Vec<usize>,
    endpoint_distance_meters: f64,
    same_road: bool,
    score: f64,
}

fn non_overlapping_round_trip_line_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<RoundTripLineCandidate> {
    let mut candidates = Vec::new();
    for turn_index in 0..accepted_samples.len() {
        if accepted_samples[turn_index].reason != "weak_recovery_shape_anchor" {
            continue;
        }
        if let Some(candidate) = round_trip_line_candidate(accepted_samples, turn_index) {
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|a, b| {
        compare_f64(b.score, a.score)
            .then_with(|| compare_f64(a.endpoint_distance_meters, b.endpoint_distance_meters))
    });
    let mut accepted = Vec::new();
    for candidate in candidates {
        if accepted.iter().any(|existing: &RoundTripLineCandidate| {
            ranges_overlap(
                candidate.start_index,
                candidate.end_index,
                existing.start_index,
                existing.end_index,
            )
        }) {
            continue;
        }
        accepted.push(candidate);
    }
    accepted.sort_by_key(|candidate| candidate.start_index);
    accepted
}

fn round_trip_line_candidate(
    accepted_samples: &[AcceptedTrackSample<'_>],
    turn_index: usize,
) -> Option<RoundTripLineCandidate> {
    let turn = accepted_samples[turn_index];
    let start_lower_sample_id =
        turn.sample.sample_id - ROUND_TRIP_LINE_MAX_RAW_POINT_ID_SPAN_BEFORE;
    let end_upper_sample_id = turn.sample.sample_id + ROUND_TRIP_LINE_MAX_RAW_POINT_ID_SPAN_AFTER;
    let mut best: Option<RoundTripLineCandidate> = None;

    for start_index in (0..turn_index).rev() {
        let start = accepted_samples[start_index];
        if start.sample.sample_id < start_lower_sample_id {
            break;
        }
        if !can_be_round_trip_endpoint(start) {
            continue;
        }
        let Some(end_index) =
            latest_round_trip_end_index(accepted_samples, turn_index, start, end_upper_sample_id)
        else {
            continue;
        };
        let end = accepted_samples[end_index];
        let span = &accepted_samples[start_index..=end_index];
        if span.iter().enumerate().any(|(index, sample)| {
            index != turn_index - start_index && protected_local_settlement_reason(sample.reason)
        }) {
            continue;
        }
        if span.len() < ROUND_TRIP_LINE_MIN_TRACK_POINTS {
            continue;
        }
        let endpoint_distance =
            haversine_distance_meters(start.lat(), start.lng(), end.lat(), end.lng());
        let turn_distance =
            haversine_distance_meters(start.lat(), start.lng(), turn.lat(), turn.lng()).min(
                haversine_distance_meters(end.lat(), end.lng(), turn.lat(), turn.lng()),
            );
        if turn_distance < ROUND_TRIP_LINE_MIN_TURN_DISTANCE_METERS {
            continue;
        }
        let cross_track = round_trip_line_max_cross_track_meters(
            span,
            0,
            turn_index - start_index,
            span.len() - 1,
        );
        if cross_track > ROUND_TRIP_LINE_MAX_CROSS_TRACK_METERS {
            continue;
        }
        if elapsed_delta_seconds(span[0].sample, span[span.len() - 1].sample)
            > ROUND_TRIP_LINE_NO_INTENT_MAX_DURATION_SECONDS
        {
            continue;
        }
        if accepted_span_max_gap_seconds(span) > ROUND_TRIP_LINE_NO_INTENT_MAX_SAMPLE_GAP_SECONDS {
            continue;
        }
        let same_road = same_road_round_trip_allowed(span, turn_index - start_index);
        let keep_indexes = round_trip_line_keep_indexes(span, turn_index - start_index);
        if keep_indexes.len() >= span.len() {
            continue;
        }
        let candidate = RoundTripLineCandidate {
            start_index,
            turn_index,
            end_index,
            turn_span_index: turn_index - start_index,
            keep_indexes,
            endpoint_distance_meters: endpoint_distance,
            same_road,
            score: span.len() as f64 * 10.0 + turn_distance - endpoint_distance
                + if same_road { 30.0 } else { 0.0 },
        };
        let replace = best.as_ref().map_or(true, |current| {
            end.sample.sample_id > accepted_samples[current.end_index].sample.sample_id
                || (end.sample.sample_id == accepted_samples[current.end_index].sample.sample_id
                    && start.sample.sample_id
                        < accepted_samples[current.start_index].sample.sample_id)
                || (end.sample.sample_id == accepted_samples[current.end_index].sample.sample_id
                    && start.sample.sample_id
                        == accepted_samples[current.start_index].sample.sample_id
                    && endpoint_distance < current.endpoint_distance_meters)
        });
        if replace {
            best = Some(candidate);
        }
    }
    best
}

fn latest_round_trip_end_index(
    accepted_samples: &[AcceptedTrackSample<'_>],
    turn_index: usize,
    start: AcceptedTrackSample<'_>,
    end_upper_sample_id: i64,
) -> Option<usize> {
    let mut end_index = None;
    for index in turn_index + 1..accepted_samples.len() {
        let point = accepted_samples[index];
        if point.sample.sample_id > end_upper_sample_id {
            break;
        }
        if !can_be_round_trip_endpoint(point) {
            continue;
        }
        let endpoint_distance =
            haversine_distance_meters(start.lat(), start.lng(), point.lat(), point.lng());
        if endpoint_distance <= ROUND_TRIP_LINE_MAX_ENDPOINT_DISTANCE_METERS {
            end_index = Some(index);
        }
    }
    end_index
}

fn can_be_round_trip_endpoint(sample: AcceptedTrackSample<'_>) -> bool {
    is_valid_coordinate(sample.lat(), sample.lng())
        && !is_transport_track_reason(sample.reason)
        && sample.reason != "weak_recovery_shape_anchor"
}

fn round_trip_line_max_cross_track_meters(
    span: &[AcceptedTrackSample<'_>],
    start_index: usize,
    turn_index: usize,
    end_index: usize,
) -> f64 {
    span.iter()
        .map(|point| {
            distance_to_segment_meters(
                point.lat(),
                point.lng(),
                span[start_index].lat(),
                span[start_index].lng(),
                span[turn_index].lat(),
                span[turn_index].lng(),
            )
            .min(distance_to_segment_meters(
                point.lat(),
                point.lng(),
                span[turn_index].lat(),
                span[turn_index].lng(),
                span[end_index].lat(),
                span[end_index].lng(),
            ))
        })
        .fold(0.0, f64::max)
}

fn round_trip_line_keep_indexes(
    span: &[AcceptedTrackSample<'_>],
    turn_span_index: usize,
) -> Vec<usize> {
    let mut keep = HashSet::new();
    keep.insert(0);
    keep.insert(turn_span_index);
    keep.insert(span.len() - 1);
    simplify_accepted_span_by_distance(
        span,
        0,
        turn_span_index,
        ROUND_TRIP_LINE_SIMPLIFY_TOLERANCE_METERS,
        &mut keep,
    );
    simplify_accepted_span_by_distance(
        span,
        turn_span_index,
        span.len() - 1,
        ROUND_TRIP_LINE_SIMPLIFY_TOLERANCE_METERS,
        &mut keep,
    );
    let mut keep = keep.into_iter().collect::<Vec<_>>();
    keep.sort_unstable();
    keep
}

fn same_road_round_trip_allowed(span: &[AcceptedTrackSample<'_>], turn_span_index: usize) -> bool {
    if turn_span_index <= 1 || turn_span_index >= span.len().saturating_sub(2) {
        return false;
    }
    if elapsed_delta_seconds(span[0].sample, span[span.len() - 1].sample)
        > ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_DURATION_SECONDS
    {
        return false;
    }
    if accepted_span_max_gap_seconds(span) > ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_SAMPLE_GAP_SECONDS {
        return false;
    }
    let before_approach = span[turn_span_index - 1];
    let after_approach = span[turn_span_index + 1];
    let approach_pair_distance = haversine_distance_meters(
        before_approach.lat(),
        before_approach.lng(),
        after_approach.lat(),
        after_approach.lng(),
    );
    if approach_pair_distance > ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_APPROACH_PAIR_DISTANCE_METERS {
        return false;
    }
    let same_road_points = span
        .iter()
        .enumerate()
        .filter(|(index, sample)| {
            *index != turn_span_index && is_valid_coordinate(sample.lat(), sample.lng())
        })
        .map(|(_, sample)| *sample)
        .collect::<Vec<_>>();
    same_road_points.len() >= 4
        && accepted_bbox_diagonal_meters(&same_road_points)
            <= ROUND_TRIP_SAME_ROAD_NO_INTENT_MAX_BBOX_METERS
}

fn same_road_centerline_coordinate(
    span: &[AcceptedTrackSample<'_>],
    turn_span_index: usize,
    span_index: usize,
) -> Option<(f64, f64)> {
    let mirror_index = if span_index < turn_span_index {
        turn_span_index + (turn_span_index - span_index)
    } else if span_index > turn_span_index {
        turn_span_index.checked_sub(span_index - turn_span_index)?
    } else {
        return None;
    };
    let mirror = span.get(mirror_index)?;
    Some((
        (span[span_index].lat() + mirror.lat()) / 2.0,
        (span[span_index].lng() + mirror.lng()) / 2.0,
    ))
}

fn settle_enclosed_loop_clusters<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
) -> (Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>) {
    let candidates = non_overlapping_enclosed_loop_candidates(accepted_samples);
    if candidates.is_empty() {
        return (accepted_samples.to_vec(), HashMap::new());
    }
    let mut candidate_by_start = HashMap::new();
    for candidate in &candidates {
        candidate_by_start.insert(candidate.start_index, candidate.clone());
    }
    let mut output = Vec::with_capacity(accepted_samples.len());
    let mut suppression_reasons = HashMap::new();
    let mut index = 0;
    while index < accepted_samples.len() {
        if let Some(candidate) = candidate_by_start.get(&index) {
            let span = &accepted_samples[candidate.start_index..=candidate.end_index];
            for (keep_order, span_index) in candidate.keep_indexes.iter().copied().enumerate() {
                let original = span[span_index];
                let is_start = keep_order == 0;
                let is_end = keep_order + 1 == candidate.keep_indexes.len();
                let reason = if is_start {
                    "enclosed_loop_cluster_start"
                } else if is_end {
                    "enclosed_loop_cluster_end"
                } else if original.reason == "rest_photo_micro_move_anchor" {
                    "rest_photo_micro_move_anchor"
                } else {
                    "enclosed_loop_cluster_anchor"
                };
                let previous_keep = if keep_order == 0 {
                    0
                } else {
                    candidate.keep_indexes[keep_order - 1] + 1
                };
                for suppressed in &span[previous_keep..span_index] {
                    suppression_reasons.insert(
                        suppressed.sample.sample_id,
                        "enclosed_loop_cluster_suppressed",
                    );
                }
                output.push(AcceptedTrackSample {
                    sample: original.sample,
                    reason,
                    distance_delta_meters: Some(0.0),
                    moving_time_delta_seconds: Some(0.0),
                    starts_new_segment: original.starts_new_segment,
                    lat_override: original.lat_override,
                    lng_override: original.lng_override,
                    suppression_reason: None,
                });
            }
            let last_keep = candidate.keep_indexes.last().copied().unwrap_or(0);
            for suppressed in &span[last_keep + 1..] {
                suppression_reasons.insert(
                    suppressed.sample.sample_id,
                    "enclosed_loop_cluster_suppressed",
                );
            }
            index = candidate.end_index + 1;
        } else {
            output.push(accepted_samples[index]);
            index += 1;
        }
    }
    (output, suppression_reasons)
}

#[derive(Clone)]
struct EnclosedLoopCandidate {
    start_index: usize,
    end_index: usize,
    keep_indexes: Vec<usize>,
    score: f64,
}

fn non_overlapping_enclosed_loop_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<EnclosedLoopCandidate> {
    let mut candidates = Vec::new();
    for start_index in 0..accepted_samples.len() {
        for end_index in
            start_index + ENCLOSED_GAP_CLUSTER_MIN_GAP_RECOVERIES..accepted_samples.len()
        {
            if let Some(candidate) =
                enclosed_loop_candidate(accepted_samples, start_index, end_index)
            {
                candidates.push(candidate);
            }
        }
    }
    candidates.sort_by(|a, b| {
        compare_f64(b.score, a.score)
            .then_with(|| a.start_index.cmp(&b.start_index))
            .then_with(|| b.end_index.cmp(&a.end_index))
    });
    let mut accepted = Vec::new();
    for candidate in candidates {
        if accepted.iter().any(|existing: &EnclosedLoopCandidate| {
            ranges_overlap(
                candidate.start_index,
                candidate.end_index,
                existing.start_index,
                existing.end_index,
            )
        }) {
            continue;
        }
        accepted.push(candidate);
    }
    accepted.sort_by_key(|candidate| candidate.start_index);
    accepted
}

fn enclosed_loop_candidate(
    accepted_samples: &[AcceptedTrackSample<'_>],
    start_index: usize,
    end_index: usize,
) -> Option<EnclosedLoopCandidate> {
    let span = &accepted_samples[start_index..=end_index];
    if span.iter().any(|sample| {
        protected_local_settlement_reason(sample.reason)
            && sample.reason != "stationary_drift_anchor"
            && sample.reason != "rest_photo_micro_move_anchor"
    }) {
        return None;
    }
    let raw_span = span[span.len() - 1].sample.sample_id - span[0].sample.sample_id;
    if raw_span < ENCLOSED_GAP_CLUSTER_MIN_RAW_POINT_ID_SPAN {
        return None;
    }
    let gap_recovery_count = span
        .iter()
        .filter(|sample| sample.reason == "gap_recovery")
        .count();
    if gap_recovery_count < ENCLOSED_GAP_CLUSTER_MIN_GAP_RECOVERIES {
        return None;
    }
    let stationary_count = span
        .iter()
        .filter(|sample| {
            sample.reason == "stationary_anchor" || sample.reason == "stationary_drift_anchor"
        })
        .count();
    if stationary_count < ENCLOSED_GAP_CLUSTER_MIN_STATIONARY_ANCHORS {
        return None;
    }
    let bbox = accepted_bbox_diagonal_meters(span);
    if bbox > ENCLOSED_GAP_CLUSTER_MAX_BBOX_METERS
        || bbox > ENCLOSED_LOOP_SETTLEMENT_MAX_BBOX_METERS
    {
        return None;
    }
    let duration = elapsed_delta_seconds(span[0].sample, span[span.len() - 1].sample);
    if duration < ENCLOSED_GAP_CLUSTER_MIN_DURATION_SECONDS {
        return None;
    }
    let path = accepted_path_meters(span);
    if path < CLOSED_LOOP_ROUND_TRIP_MIN_PATH_METERS {
        return None;
    }
    let net = haversine_distance_meters(
        span[0].lat(),
        span[0].lng(),
        span[span.len() - 1].lat(),
        span[span.len() - 1].lng(),
    );
    if net > CLOSED_LOOP_ROUND_TRIP_MAX_ENDPOINT_DISTANCE_METERS
        || net / path.max(1.0) > CLOSED_LOOP_ROUND_TRIP_MAX_NET_PATH_RATIO
    {
        return None;
    }
    let keep_indexes = enclosed_loop_keep_indexes(span);
    if keep_indexes.len() >= span.len()
        || span.len() - keep_indexes.len() < ENCLOSED_LOOP_SETTLEMENT_MIN_REMOVED_TRACK_POINTS
    {
        return None;
    }
    Some(EnclosedLoopCandidate {
        start_index,
        end_index,
        keep_indexes,
        score: span.len() as f64 * 10.0 + path,
    })
}

fn enclosed_loop_keep_indexes(span: &[AcceptedTrackSample<'_>]) -> Vec<usize> {
    let mut keep = HashSet::new();
    let corridor_start = span[0];
    let corridor_end = span[span.len() - 1];
    for (index, sample) in span.iter().copied().enumerate() {
        if sample.reason == "gap_recovery"
            || sample.reason == "stationary_anchor"
            || sample.reason == "stationary_drift_anchor"
            || sample.reason == "rest_photo_micro_move_anchor"
        {
            let corridor_distance = distance_to_segment_meters(
                sample.lat(),
                sample.lng(),
                corridor_start.lat(),
                corridor_start.lng(),
                corridor_end.lat(),
                corridor_end.lng(),
            );
            if corridor_distance <= ENCLOSED_LOOP_SETTLEMENT_MAX_CORRIDOR_DISTANCE_METERS {
                keep.insert(index);
            }
        }
    }
    if keep.is_empty() {
        keep.insert(enclosed_loop_representative_index(
            span,
            corridor_start,
            corridor_end,
        ));
    }
    let last_keep = keep.iter().copied().max().unwrap_or(0);
    if last_keep < span.len() - 1 {
        keep.insert(span.len() - 1);
    }
    let mut keep = keep.into_iter().collect::<Vec<_>>();
    keep.sort_unstable();
    keep
}

fn enclosed_loop_representative_index(
    span: &[AcceptedTrackSample<'_>],
    corridor_start: AcceptedTrackSample<'_>,
    corridor_end: AcceptedTrackSample<'_>,
) -> usize {
    span.iter()
        .enumerate()
        .map(|(index, sample)| {
            let distance = distance_to_segment_meters(
                sample.lat(),
                sample.lng(),
                corridor_start.lat(),
                corridor_start.lng(),
                corridor_end.lat(),
                corridor_end.lng(),
            );
            (index, distance)
        })
        .min_by(|left, right| compare_f64(left.1, right.1).then_with(|| left.0.cmp(&right.0)))
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn accepted_span_max_gap_seconds(span: &[AcceptedTrackSample<'_>]) -> f64 {
    span.windows(2)
        .map(|pair| sample_gap_seconds(pair[0].sample, pair[1].sample))
        .fold(0.0, f64::max)
}

fn protected_local_settlement_reason(reason: &str) -> bool {
    matches!(
        reason,
        "weak_recovery_shape_anchor"
            | "position_snap_recovery_anchor"
            | "stationary_drift_anchor"
            | "rest_photo_micro_move_anchor"
            | "enclosed_loop_cluster_start"
            | "enclosed_loop_cluster_anchor"
            | "enclosed_loop_cluster_end"
    )
}

fn can_be_dense_main_route_point(sample: AcceptedTrackSample<'_>) -> bool {
    is_valid_coordinate(sample.lat(), sample.lng())
        && !is_transport_track_reason(sample.reason)
        && (sample.reason == "moving_good_fix"
            || sample.reason == "motion_supported_low_speed"
            || sample.reason == "continuity_rescue_low_accuracy")
}

fn dense_main_route_candidate(
    accepted_samples: &[AcceptedTrackSample<'_>],
    start_index: usize,
    end_index: usize,
) -> Option<DenseMainRouteCandidate> {
    let span = &accepted_samples[start_index..=end_index];
    let path_meters = accepted_path_meters(span);
    let net_distance = haversine_distance_meters(
        span[0].lat(),
        span[0].lng(),
        span[span.len() - 1].lat(),
        span[span.len() - 1].lng(),
    );
    if net_distance < DENSE_MAIN_ROUTE_MIN_NET_DISTANCE_METERS {
        return None;
    }
    if path_meters / net_distance.max(1.0) > DENSE_MAIN_ROUTE_MAX_PATH_NET_RATIO {
        return None;
    }
    if accepted_bbox_diagonal_meters(span) > DENSE_MAIN_ROUTE_MAX_BBOX_METERS {
        return None;
    }
    let keep_indexes = dense_main_route_keep_indexes(span);
    if keep_indexes.len() >= span.len() {
        return None;
    }
    let simplified = keep_indexes
        .windows(2)
        .map(|pair| {
            haversine_distance_meters(
                span[pair[0]].lat(),
                span[pair[0]].lng(),
                span[pair[1]].lat(),
                span[pair[1]].lng(),
            )
        })
        .sum::<f64>();
    if simplified / path_meters.max(1.0) > 1.0 - DENSE_MAIN_ROUTE_MIN_PATH_REDUCTION_RATIO {
        return None;
    }
    Some(DenseMainRouteCandidate {
        start_index,
        end_index,
        keep_indexes,
        path_meters,
        score: span.len() as f64 * 10.0 + path_meters,
    })
}

fn dense_main_route_keep_indexes(span: &[AcceptedTrackSample<'_>]) -> Vec<usize> {
    let mut keep = HashSet::new();
    keep.insert(0);
    keep.insert(span.len() - 1);
    simplify_accepted_span_by_distance(
        span,
        0,
        span.len() - 1,
        DENSE_MAIN_ROUTE_SIMPLIFY_TOLERANCE_METERS,
        &mut keep,
    );
    let mut keep = keep.into_iter().collect::<Vec<_>>();
    keep.sort_unstable();
    keep
}

fn simplify_accepted_span_by_distance(
    span: &[AcceptedTrackSample<'_>],
    start_index: usize,
    end_index: usize,
    tolerance_meters: f64,
    keep: &mut HashSet<usize>,
) {
    if end_index - start_index <= 1 {
        return;
    }
    let mut max_distance = -1.0;
    let mut max_index = start_index + 1;
    for index in start_index + 1..end_index {
        let distance = distance_to_segment_meters(
            span[index].lat(),
            span[index].lng(),
            span[start_index].lat(),
            span[start_index].lng(),
            span[end_index].lat(),
            span[end_index].lng(),
        );
        if distance > max_distance {
            max_distance = distance;
            max_index = index;
        }
    }
    if max_distance > tolerance_meters {
        keep.insert(max_index);
        simplify_accepted_span_by_distance(span, start_index, max_index, tolerance_meters, keep);
        simplify_accepted_span_by_distance(span, max_index, end_index, tolerance_meters, keep);
    }
}

fn accepted_path_meters(span: &[AcceptedTrackSample<'_>]) -> f64 {
    span.windows(2)
        .map(|pair| {
            haversine_distance_meters(pair[0].lat(), pair[0].lng(), pair[1].lat(), pair[1].lng())
        })
        .sum()
}

fn accepted_bbox_diagonal_meters(span: &[AcceptedTrackSample<'_>]) -> f64 {
    let mut min_lat = f64::INFINITY;
    let mut max_lat = f64::NEG_INFINITY;
    let mut min_lng = f64::INFINITY;
    let mut max_lng = f64::NEG_INFINITY;
    for sample in span {
        min_lat = min_lat.min(sample.lat());
        max_lat = max_lat.max(sample.lat());
        min_lng = min_lng.min(sample.lng());
        max_lng = max_lng.max(sample.lng());
    }
    haversine_distance_meters(min_lat, min_lng, max_lat, max_lng)
}

fn collapse_stationary_session<'a>(
    accepted_samples: &[AcceptedTrackSample<'a>],
    raw_samples: &'a [NormalizedLocationSample],
) -> Option<(Vec<AcceptedTrackSample<'a>>, HashMap<i64, &'static str>)> {
    if accepted_samples.is_empty() || !is_stationary_session(raw_samples) {
        return None;
    }
    let valid_raw_samples = raw_samples
        .iter()
        .filter(|sample| {
            is_valid_coordinate(sample.lat, sample.lng)
                && sample.horizontal_accuracy_meters.is_finite()
                && sample.horizontal_accuracy_meters <= MAX_HORIZONTAL_ACCURACY_METERS
        })
        .collect::<Vec<_>>();
    let center = weighted_sample_center(&valid_raw_samples);
    let representative_raw = nearest_sample(center.lat, center.lng, &valid_raw_samples)?;
    let representative = accepted_samples
        .iter()
        .copied()
        .find(|sample| sample.sample.sample_id == representative_raw.sample_id)
        .or_else(|| {
            accepted_samples.iter().copied().min_by(|left, right| {
                compare_f64(
                    haversine_distance_meters(left.lat(), left.lng(), center.lat, center.lng),
                    haversine_distance_meters(right.lat(), right.lng(), center.lat, center.lng),
                )
                .then_with(|| left.sample.sample_id.cmp(&right.sample.sample_id))
            })
        })?;

    let anchor = AcceptedTrackSample {
        sample: representative.sample,
        reason: "stationary_session_anchor",
        distance_delta_meters: Some(0.0),
        moving_time_delta_seconds: Some(0.0),
        starts_new_segment: true,
        lat_override: Some(center.lat),
        lng_override: Some(center.lng),
        suppression_reason: None,
    };
    let mut suppression_reasons = HashMap::new();
    for accepted in accepted_samples {
        if accepted.sample.sample_id != anchor.sample.sample_id {
            suppression_reasons.insert(
                accepted.sample.sample_id,
                "stationary_session_anchor_suppressed",
            );
        }
    }
    Some((vec![anchor], suppression_reasons))
}

fn is_stationary_session(samples: &[NormalizedLocationSample]) -> bool {
    let valid_samples = samples
        .iter()
        .filter(|sample| {
            is_valid_coordinate(sample.lat, sample.lng)
                && sample.fix_elapsed_realtime_nanos >= 0
                && sample.horizontal_accuracy_meters.is_finite()
                && sample.horizontal_accuracy_meters <= MAX_HORIZONTAL_ACCURACY_METERS
        })
        .collect::<Vec<_>>();
    if valid_samples.len() < STATIONARY_SESSION_MIN_RAW_POINTS {
        return false;
    }
    let duration_seconds =
        elapsed_delta_seconds(valid_samples[0], valid_samples[valid_samples.len() - 1]);
    if duration_seconds < STATIONARY_SESSION_MIN_DURATION_SECONDS {
        return false;
    }
    if bbox_diagonal_meters(&valid_samples) > STATIONARY_SESSION_MAX_BBOX_METERS {
        return false;
    }
    let net_distance = haversine_distance_meters(
        valid_samples[0].lat,
        valid_samples[0].lng,
        valid_samples[valid_samples.len() - 1].lat,
        valid_samples[valid_samples.len() - 1].lng,
    );
    if net_distance > STATIONARY_SESSION_MAX_NET_DISTANCE_METERS {
        return false;
    }
    let path_meters = raw_sample_path_meters(&valid_samples);
    if path_meters / duration_seconds.max(1.0) > STATIONARY_SESSION_MAX_PATH_RATE_METERS_PER_SECOND
    {
        return false;
    }
    let speeds = valid_samples
        .iter()
        .filter_map(|sample| {
            sample
                .speed_meters_per_second
                .filter(|speed| speed.is_finite())
        })
        .collect::<Vec<_>>();
    if speeds.len() as f64 / (valid_samples.len() as f64)
        < STATIONARY_SESSION_MIN_SPEED_SAMPLE_RATIO
    {
        return false;
    }
    let average_speed = speeds.iter().sum::<f64>() / speeds.len() as f64;
    if average_speed > STATIONARY_SESSION_MAX_AVERAGE_REPORTED_SPEED_METERS_PER_SECOND {
        return false;
    }
    let zero_speed_ratio =
        speeds.iter().filter(|speed| **speed <= 0.1).count() as f64 / speeds.len() as f64;
    zero_speed_ratio >= STATIONARY_SESSION_MIN_ZERO_SPEED_RATIO
}

fn raw_sample_path_meters(samples: &[&NormalizedLocationSample]) -> f64 {
    samples
        .windows(2)
        .map(|pair| haversine_distance_meters(pair[0].lat, pair[0].lng, pair[1].lat, pair[1].lng))
        .sum()
}

struct DwellDriftInterval<'a> {
    samples: Vec<&'a NormalizedLocationSample>,
    core_samples: Vec<&'a NormalizedLocationSample>,
}

#[derive(Clone, Copy)]
struct WeightedCenter {
    lat: f64,
    lng: f64,
}

fn find_dwell_drift_intervals<'a>(
    samples: &'a [NormalizedLocationSample],
) -> Vec<DwellDriftInterval<'a>> {
    let valid_samples = samples
        .iter()
        .filter(|sample| {
            is_valid_coordinate(sample.lat, sample.lng)
                && sample.horizontal_accuracy_meters.is_finite()
                && sample.horizontal_accuracy_meters <= MAX_HORIZONTAL_ACCURACY_METERS
                && sample.fix_elapsed_realtime_nanos >= 0
        })
        .collect::<Vec<_>>();
    let mut intervals = Vec::new();
    let mut index = 0;
    while index < valid_samples.len() {
        if !is_dwell_drift_core_sample(valid_samples[index]) {
            index += 1;
            continue;
        }
        let core_start = index;
        let mut core_end = index;
        while core_end + 1 < valid_samples.len()
            && is_dwell_drift_core_sample(valid_samples[core_end + 1])
            && sample_gap_seconds(valid_samples[core_end], valid_samples[core_end + 1])
                <= DWELL_DRIFT_MAX_CORE_GAP_SECONDS
        {
            core_end += 1;
        }

        let core_samples = valid_samples[core_start..=core_end].to_vec();
        if core_samples.len() >= DWELL_DRIFT_MIN_CORE_SAMPLES {
            let start = extend_dwell_drift_backward(&valid_samples, core_start);
            let end = extend_dwell_drift_forward(&valid_samples, core_end);
            let interval_samples = valid_samples[start..=end].to_vec();
            if is_dwell_drift_interval(&interval_samples, &core_samples) {
                intervals.push(DwellDriftInterval {
                    samples: interval_samples,
                    core_samples,
                });
                index = end + 1;
                continue;
            }
        }
        index = core_end + 1;
    }
    intervals
}

fn is_dwell_drift_core_sample(sample: &NormalizedLocationSample) -> bool {
    sample.horizontal_accuracy_meters.is_finite()
        && sample.horizontal_accuracy_meters >= DWELL_DRIFT_CORE_ACCURACY_METERS
}

fn extend_dwell_drift_backward(
    samples: &[&NormalizedLocationSample],
    core_start_index: usize,
) -> usize {
    let mut start = core_start_index;
    let mut extension_path_meters = 0.0;
    while start > 0 {
        let candidate = samples[start - 1];
        let current = samples[start];
        if !can_extend_dwell_drift(candidate, current) {
            break;
        }
        let step_distance =
            haversine_distance_meters(candidate.lat, candidate.lng, current.lat, current.lng);
        if extension_path_meters + step_distance > DWELL_DRIFT_MAX_EXTENSION_PATH_METERS {
            break;
        }
        extension_path_meters += step_distance;
        start -= 1;
    }
    start
}

fn extend_dwell_drift_forward(
    samples: &[&NormalizedLocationSample],
    core_end_index: usize,
) -> usize {
    let mut end = core_end_index;
    let mut extension_path_meters = 0.0;
    while end + 1 < samples.len() {
        let current = samples[end];
        let candidate = samples[end + 1];
        if !can_extend_dwell_drift(candidate, current) {
            break;
        }
        let step_distance =
            haversine_distance_meters(current.lat, current.lng, candidate.lat, candidate.lng);
        if extension_path_meters + step_distance > DWELL_DRIFT_MAX_EXTENSION_PATH_METERS {
            break;
        }
        extension_path_meters += step_distance;
        end += 1;
    }
    end
}

fn can_extend_dwell_drift(
    candidate: &NormalizedLocationSample,
    adjacent: &NormalizedLocationSample,
) -> bool {
    sample_gap_seconds(candidate, adjacent) <= DWELL_DRIFT_MAX_EXTENSION_GAP_SECONDS
        && candidate
            .speed_meters_per_second
            .filter(|speed| speed.is_finite())
            .map_or(true, |speed| {
                speed <= DWELL_DRIFT_MAX_REPORTED_SPEED_METERS_PER_SECOND
            })
        && candidate.horizontal_accuracy_meters.is_finite()
        && candidate.horizontal_accuracy_meters <= MAX_HORIZONTAL_ACCURACY_METERS
}

fn is_dwell_drift_interval(
    samples: &[&NormalizedLocationSample],
    core_samples: &[&NormalizedLocationSample],
) -> bool {
    if samples.len() < DWELL_DRIFT_MIN_RAW_POINTS {
        return false;
    }
    let duration = elapsed_delta_seconds(samples[0], samples[samples.len() - 1]);
    if duration < DWELL_DRIFT_MIN_DURATION_SECONDS {
        return false;
    }
    let finite_speeds = samples
        .iter()
        .filter_map(|sample| {
            sample
                .speed_meters_per_second
                .filter(|speed| speed.is_finite())
        })
        .collect::<Vec<_>>();
    if finite_speeds.is_empty() {
        return false;
    }
    let average_speed = finite_speeds.iter().sum::<f64>() / finite_speeds.len() as f64;
    if average_speed > DWELL_DRIFT_MAX_AVERAGE_SPEED_METERS_PER_SECOND {
        return false;
    }
    let zero_speed_ratio = finite_speeds.iter().filter(|speed| **speed <= 0.1).count() as f64
        / finite_speeds.len() as f64;
    if zero_speed_ratio < DWELL_DRIFT_MIN_ZERO_SPEED_RATIO {
        return false;
    }
    if bbox_diagonal_meters(samples) > DWELL_DRIFT_MAX_BBOX_METERS {
        return false;
    }
    let net_distance = haversine_distance_meters(
        samples[0].lat,
        samples[0].lng,
        samples[samples.len() - 1].lat,
        samples[samples.len() - 1].lng,
    );
    if net_distance > DWELL_DRIFT_MAX_NET_DISTANCE_METERS {
        return false;
    }
    core_samples.len() as f64 / samples.len() as f64 >= 0.25
}

fn weighted_sample_center(samples: &[&NormalizedLocationSample]) -> WeightedCenter {
    let mut weight_sum = 0.0;
    let mut lat_sum = 0.0;
    let mut lng_sum = 0.0;
    for sample in samples {
        let weight = 1.0 / sample.horizontal_accuracy_meters.max(5.0);
        weight_sum += weight;
        lat_sum += sample.lat * weight;
        lng_sum += sample.lng * weight;
    }
    let denominator = weight_sum.max(1e-9);
    WeightedCenter {
        lat: lat_sum / denominator,
        lng: lng_sum / denominator,
    }
}

fn weighted_sample_radius(center: WeightedCenter, samples: &[&NormalizedLocationSample]) -> f64 {
    let mut weight_sum = 0.0;
    let mut radius_sum = 0.0;
    for sample in samples {
        let weight = 1.0 / sample.horizontal_accuracy_meters.max(5.0);
        let distance = haversine_distance_meters(center.lat, center.lng, sample.lat, sample.lng);
        weight_sum += weight;
        radius_sum += weight * distance * distance;
    }
    (radius_sum / weight_sum.max(1e-9)).sqrt()
}

fn nearest_sample<'a>(
    lat: f64,
    lng: f64,
    samples: &[&'a NormalizedLocationSample],
) -> Option<&'a NormalizedLocationSample> {
    samples.iter().copied().min_by(|left, right| {
        let left_distance = haversine_distance_meters(lat, lng, left.lat, left.lng);
        let right_distance = haversine_distance_meters(lat, lng, right.lat, right.lng);
        compare_f64(left_distance, right_distance)
    })
}

fn bbox_diagonal_meters(samples: &[&NormalizedLocationSample]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut min_lat = f64::INFINITY;
    let mut max_lat = f64::NEG_INFINITY;
    let mut min_lng = f64::INFINITY;
    let mut max_lng = f64::NEG_INFINITY;
    for sample in samples {
        min_lat = min_lat.min(sample.lat);
        max_lat = max_lat.max(sample.lat);
        min_lng = min_lng.min(sample.lng);
        max_lng = max_lng.max(sample.lng);
    }
    haversine_distance_meters(min_lat, min_lng, max_lat, max_lng)
}

fn sample_gap_seconds(left: &NormalizedLocationSample, right: &NormalizedLocationSample) -> f64 {
    ((right.fix_elapsed_realtime_nanos - left.fix_elapsed_realtime_nanos).abs() as f64)
        / 1_000_000_000.0
}

#[derive(Clone, Copy)]
struct MovingSpikeCandidate {
    index: usize,
    detour_meters: f64,
    reported_speed_meters_per_second: f64,
    strict_speed: bool,
    geometry_override: bool,
    score: f64,
}

fn non_overlapping_moving_spike_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<MovingSpikeCandidate> {
    let raw_candidates = moving_spike_candidates(accepted_samples);
    let eligible = raw_candidates
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.strict_speed
                || candidate.geometry_override
                || raw_candidates.iter().any(|strict_candidate| {
                    strict_candidate.strict_speed
                        && ranges_overlap(
                            candidate.index - 1,
                            candidate.index + 1,
                            strict_candidate.index - 1,
                            strict_candidate.index + 1,
                        )
                        && candidate.score > strict_candidate.score
                })
        })
        .collect::<Vec<_>>();

    let mut sorted = eligible;
    sorted.sort_by(|a, b| {
        compare_f64(b.score, a.score)
            .then_with(|| compare_f64(b.detour_meters, a.detour_meters))
            .then_with(|| {
                compare_f64(
                    a.reported_speed_meters_per_second,
                    b.reported_speed_meters_per_second,
                )
            })
            .then_with(|| a.index.cmp(&b.index))
    });

    let mut accepted = Vec::new();
    for candidate in sorted {
        if accepted.iter().any(|existing: &MovingSpikeCandidate| {
            ranges_overlap(
                candidate.index - 1,
                candidate.index + 1,
                existing.index - 1,
                existing.index + 1,
            )
        }) {
            continue;
        }
        accepted.push(candidate);
    }
    accepted.sort_by_key(|candidate| candidate.index);
    accepted
}

fn moving_spike_candidates(
    accepted_samples: &[AcceptedTrackSample<'_>],
) -> Vec<MovingSpikeCandidate> {
    let mut candidates = Vec::new();
    for index in 1..accepted_samples.len().saturating_sub(1) {
        if let Some(candidate) = moving_spike_candidate(accepted_samples, index) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn moving_spike_candidate(
    accepted_samples: &[AcceptedTrackSample<'_>],
    index: usize,
) -> Option<MovingSpikeCandidate> {
    let previous = accepted_samples[index - 1];
    let point = accepted_samples[index];
    let next = accepted_samples[index + 1];
    let after_next = accepted_samples.get(index + 2).copied();
    if point.reason != "motion_supported_low_speed" && point.reason != "moving_good_fix" {
        return None;
    }
    let reported_speed = point
        .sample
        .speed_meters_per_second
        .filter(|speed| speed.is_finite())?;
    let previous_distance = haversine_distance_meters(
        previous.sample.lat,
        previous.sample.lng,
        point.sample.lat,
        point.sample.lng,
    );
    let next_distance = haversine_distance_meters(
        point.sample.lat,
        point.sample.lng,
        next.sample.lat,
        next.sample.lng,
    );
    let bridge_distance = haversine_distance_meters(
        previous.sample.lat,
        previous.sample.lng,
        next.sample.lat,
        next.sample.lng,
    );
    if previous_distance < MOVING_SPIKE_MIN_NEIGHBOR_DISTANCE_METERS
        || next_distance < MOVING_SPIKE_MIN_NEIGHBOR_DISTANCE_METERS
        || bridge_distance > MOVING_SPIKE_MAX_BRIDGE_DISTANCE_METERS
    {
        return None;
    }
    let detour = previous_distance + next_distance - bridge_distance;
    let lateral = distance_to_segment_meters(
        point.sample.lat,
        point.sample.lng,
        previous.sample.lat,
        previous.sample.lng,
        next.sample.lat,
        next.sample.lng,
    );
    if detour < MOVING_SPIKE_MIN_DETOUR_METERS || lateral < MOVING_SPIKE_MIN_LATERAL_METERS {
        return None;
    }
    let strict_speed = reported_speed <= MOVING_SPIKE_MAX_REPORTED_SPEED_METERS_PER_SECOND;
    let competing_speed =
        reported_speed <= MOVING_SPIKE_MAX_COMPETING_REPORTED_SPEED_METERS_PER_SECOND;
    let geometry_override = !competing_speed
        && moving_spike_geometry_override(previous, point, next, after_next, detour, lateral);
    if !competing_speed && !geometry_override {
        return None;
    }
    Some(MovingSpikeCandidate {
        index,
        detour_meters: detour,
        reported_speed_meters_per_second: reported_speed,
        strict_speed,
        geometry_override,
        score: detour * 2.0 + lateral - reported_speed * 0.25,
    })
}

fn moving_spike_geometry_override(
    previous: AcceptedTrackSample<'_>,
    point: AcceptedTrackSample<'_>,
    next: AcceptedTrackSample<'_>,
    after_next: Option<AcceptedTrackSample<'_>>,
    detour: f64,
    lateral: f64,
) -> bool {
    point.sample.speed_meters_per_second.map_or(false, |speed| {
        speed <= MOVING_SPIKE_GEOMETRY_OVERRIDE_MAX_REPORTED_SPEED_METERS_PER_SECOND
    }) && detour >= MOVING_SPIKE_GEOMETRY_OVERRIDE_MIN_DETOUR_METERS
        && lateral >= MOVING_SPIKE_GEOMETRY_OVERRIDE_MIN_LATERAL_METERS
        && moving_spike_forward_aligned(previous, next, after_next)
}

fn moving_spike_forward_aligned(
    previous: AcceptedTrackSample<'_>,
    next: AcceptedTrackSample<'_>,
    after_next: Option<AcceptedTrackSample<'_>>,
) -> bool {
    moving_spike_forward_angle_delta_degrees(previous, next, after_next).map_or(false, |delta| {
        delta <= MOVING_SPIKE_GEOMETRY_OVERRIDE_MAX_FORWARD_ANGLE_DELTA_DEGREES
    })
}

fn moving_spike_forward_angle_delta_degrees(
    previous: AcceptedTrackSample<'_>,
    next: AcceptedTrackSample<'_>,
    after_next: Option<AcceptedTrackSample<'_>>,
) -> Option<f64> {
    let after_next = after_next?;
    let first = initial_bearing_degrees(
        previous.sample.lat,
        previous.sample.lng,
        next.sample.lat,
        next.sample.lng,
    )?;
    let second = initial_bearing_degrees(
        next.sample.lat,
        next.sample.lng,
        after_next.sample.lat,
        after_next.sample.lng,
    )?;
    Some(angle_delta_degrees(first, second))
}

fn angle_delta_degrees(a: f64, b: f64) -> f64 {
    let delta = (a - b).abs().rem_euclid(360.0);
    delta.min(360.0 - delta)
}

fn is_transport_track_reason(reason: &str) -> bool {
    reason == "recovery_transport_suspected_kept" || reason == "transport_suspected_kept"
}

fn ranges_overlap(a_start: usize, a_end: usize, b_start: usize, b_end: usize) -> bool {
    a_start <= b_end && b_start <= a_end
}

#[derive(Clone, Copy)]
struct ElevationResult {
    source: &'static str,
    total_ascent_meters: Option<f64>,
    total_descent_meters: Option<f64>,
    sample_count: usize,
    rejected_sample_count: usize,
}

impl ElevationResult {
    fn none() -> Self {
        Self {
            source: "NONE",
            total_ascent_meters: None,
            total_descent_meters: None,
            sample_count: 0,
            rejected_sample_count: 0,
        }
    }

    fn confidence_available(self) -> bool {
        self.sample_count >= 2
    }
}

fn compute_gnss_altitude_result(accepted_samples: &[AcceptedTrackSample<'_>]) -> ElevationResult {
    let mut anchor_altitude_meters: Option<f64> = None;
    let mut total_ascent_meters = 0.0;
    let mut total_descent_meters = 0.0;
    let mut sample_count = 0;
    let mut rejected_sample_count = 0;

    for accepted in accepted_samples {
        let Some(altitude_meters) = accepted
            .sample
            .altitude_meters
            .filter(|value| value.is_finite())
        else {
            continue;
        };
        let Some(vertical_accuracy_meters) = accepted
            .sample
            .vertical_accuracy_meters
            .filter(|value| value.is_finite())
        else {
            rejected_sample_count += 1;
            continue;
        };
        if vertical_accuracy_meters > LOCATION_ALTITUDE_MAX_VERTICAL_ACCURACY_METERS {
            rejected_sample_count += 1;
            continue;
        }

        let moving = accepted.reason != "first_fix_good"
            && accepted.reason != "first_fix_relaxed"
            && accepted.reason != "gap_recovery";
        if !moving {
            anchor_altitude_meters = Some(altitude_meters);
            sample_count += 1;
            continue;
        }

        sample_count += 1;
        let Some(anchor) = anchor_altitude_meters else {
            anchor_altitude_meters = Some(altitude_meters);
            continue;
        };
        let delta = altitude_meters - anchor;
        if delta.abs() > LOCATION_ALTITUDE_MAX_STEP_GAIN_METERS {
            rejected_sample_count += 1;
            anchor_altitude_meters = Some(altitude_meters);
            continue;
        }
        if delta >= LOCATION_ALTITUDE_MIN_GAIN_METERS {
            total_ascent_meters += delta;
        } else if -delta >= LOCATION_ALTITUDE_MIN_GAIN_METERS {
            total_descent_meters += -delta;
        }
        anchor_altitude_meters = Some(altitude_meters);
    }

    if sample_count >= 2 {
        ElevationResult {
            source: "GNSS",
            total_ascent_meters: Some(total_ascent_meters),
            total_descent_meters: Some(total_descent_meters),
            sample_count,
            rejected_sample_count,
        }
    } else {
        ElevationResult {
            source: "GNSS",
            total_ascent_meters: None,
            total_descent_meters: None,
            sample_count,
            rejected_sample_count,
        }
    }
}

fn compute_barometer_result(windows: &[NormalizedBarometerWindow]) -> ElevationResult {
    let mut sorted = windows
        .iter()
        .filter(|window| window.end_elapsed_realtime_nanos > 0)
        .collect::<Vec<_>>();
    sorted.sort_by_key(|window| window.end_elapsed_realtime_nanos);

    let mut anchor_altitude_meters: Option<f64> = None;
    let mut anchor_time_nanos: Option<i64> = None;
    let mut total_ascent_meters = 0.0;
    let mut total_descent_meters = 0.0;
    let mut has_descent_evidence = false;
    let mut sample_count = 0;
    let mut rejected_sample_count = 0;

    for window in sorted {
        let altitude = window.avg_raw_barometer_altitude_meters;
        let time = window.end_elapsed_realtime_nanos;
        let window_ascent = non_negative(window.window_ascent_meters);
        let window_descent = non_negative(window.window_descent_meters);
        let has_window_gain_loss = window_ascent.is_some() || window_descent.is_some();

        if !altitude.is_finite() || window.avg_pressure_hpa <= 0.0 {
            rejected_sample_count += 1;
            continue;
        }

        let Some(anchor_altitude) = anchor_altitude_meters else {
            if has_window_gain_loss {
                total_ascent_meters += window_ascent.unwrap_or(0.0);
                let descent = window_descent.unwrap_or(0.0);
                total_descent_meters += descent;
                has_descent_evidence |= descent > 0.0 || window_descent.is_some();
            }
            anchor_altitude_meters = Some(altitude);
            anchor_time_nanos = Some(time);
            sample_count += 1;
            continue;
        };
        let anchor_time = anchor_time_nanos.unwrap_or(time);
        let dt_nanos = (time - anchor_time).max(0);
        let raw_delta = altitude - anchor_altitude;
        let vertical_speed = if dt_nanos > 0 {
            raw_delta.abs() / (dt_nanos as f64 / 1_000_000_000.0)
        } else {
            0.0
        };

        if dt_nanos > BAROMETER_ASCENT_MAX_SAMPLE_GAP_NANOS {
            anchor_altitude_meters = Some(altitude);
            anchor_time_nanos = Some(time);
            sample_count += 1;
            continue;
        }
        if raw_delta.abs() >= BAROMETER_PRESSURE_JUMP_METERS
            || vertical_speed > BAROMETER_ASCENT_MAX_VERTICAL_SPEED_METERS_PER_SECOND
        {
            rejected_sample_count += 1;
            anchor_altitude_meters = Some(altitude);
            anchor_time_nanos = Some(time);
            continue;
        }

        if has_window_gain_loss {
            total_ascent_meters += window_ascent.unwrap_or(0.0);
            let descent = window_descent.unwrap_or(0.0);
            total_descent_meters += descent;
            has_descent_evidence |= descent > 0.0 || window_descent.is_some();
        } else if raw_delta >= BAROMETER_ASCENT_MIN_GAIN_METERS {
            total_ascent_meters += raw_delta;
        } else if -raw_delta >= BAROMETER_ASCENT_MIN_GAIN_METERS {
            total_descent_meters += -raw_delta;
            has_descent_evidence = true;
        }
        anchor_altitude_meters = Some(altitude);
        anchor_time_nanos = Some(time);
        sample_count += 1;
    }

    if sample_count >= 2 {
        ElevationResult {
            source: "BAROMETER",
            total_ascent_meters: Some(total_ascent_meters),
            total_descent_meters: Some(if has_descent_evidence {
                total_descent_meters
            } else {
                0.0
            }),
            sample_count,
            rejected_sample_count,
        }
    } else {
        ElevationResult {
            source: "BAROMETER",
            total_ascent_meters: None,
            total_descent_meters: None,
            sample_count,
            rejected_sample_count,
        }
    }
}

fn select_elevation_result(barometer: &ElevationResult, gnss: &ElevationResult) -> ElevationResult {
    if barometer.confidence_available() && barometer.total_ascent_meters.is_some() {
        *barometer
    } else if gnss.confidence_available() && gnss.total_ascent_meters.is_some() {
        *gnss
    } else {
        ElevationResult::none()
    }
}

fn non_negative(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite() && *value >= 0.0)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MotionState {
    Walking,
    Still,
    Unknown,
}

#[derive(Clone, Copy, Debug)]
struct MotionClassification {
    state: MotionState,
}

struct MotionWindowIndex<'a> {
    windows: Vec<&'a NormalizedMotionWindow>,
}

impl<'a> MotionWindowIndex<'a> {
    fn new(windows: &'a [NormalizedMotionWindow]) -> Self {
        let mut windows = windows
            .iter()
            .filter(|window| {
                window.start_elapsed_realtime_nanos <= window.end_elapsed_realtime_nanos
            })
            .collect::<Vec<_>>();
        windows.sort_by_key(|window| {
            (
                window.start_elapsed_realtime_nanos,
                window.end_elapsed_realtime_nanos,
            )
        });
        Self { windows }
    }

    fn classify(&self, elapsed_realtime_nanos: i64) -> MotionClassification {
        let cutoff = elapsed_realtime_nanos - MOTION_LOOKBACK_NANOS;
        let mut total = 0;
        let mut still = 0;
        let mut active = 0;

        for window in &self.windows {
            if window.end_elapsed_realtime_nanos < cutoff {
                continue;
            }
            if window.start_elapsed_realtime_nanos > elapsed_realtime_nanos {
                break;
            }
            total += 1;
            if window.device_still == Some(true) {
                still += 1;
            }
            if is_active_motion_window(window) {
                active += 1;
            }
        }

        let state = if total == 0 {
            MotionState::Unknown
        } else if active > 0 && active >= still {
            MotionState::Walking
        } else if still > 0 {
            MotionState::Still
        } else {
            MotionState::Unknown
        };
        MotionClassification { state }
    }
}

fn is_active_motion_window(window: &NormalizedMotionWindow) -> bool {
    let dynamic_accel = window
        .linear_acceleration_rms_mps2
        .or(window.accelerometer_dynamic_rms_mps2)
        .filter(|value| value.is_finite())
        .unwrap_or(0.0);
    let gyro = window
        .gyroscope_rms_radps
        .filter(|value| value.is_finite())
        .unwrap_or(0.0);
    let step_delta = window.step_counter_delta.unwrap_or(0);
    let step_detector_count = window.step_detector_count.unwrap_or(0);
    dynamic_accel >= ACTIVE_MOTION_DYNAMIC_ACCEL_RMS_MPS2
        || gyro >= ACTIVE_MOTION_GYROSCOPE_RMS_RADPS
        || step_delta > 0
        || step_detector_count > 0
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

    fn zero_metric(reason: &'static str) -> Self {
        Self {
            reason,
            distance_delta_meters: Some(0.0),
            moving_time_delta_seconds: Some(0.0),
            starts_new_segment: false,
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
    motion: MotionClassification,
    state: &mut IntakeState,
) -> MovingPointDecision {
    let distance = haversine_distance_meters(previous.lat, previous.lng, sample.lat, sample.lng);
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
        decide_gap_recovery(sample, previous, motion, distance, reported_speed, state)
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
        if is_low_accuracy_rescue_point(sample, distance, implied_speed) {
            MovingPointDecision::Track(TrackDecision::normal("continuity_rescue_low_accuracy"))
        } else {
            MovingPointDecision::Weak("weak_horizontal_accuracy")
        }
    } else if distance <= stationary_threshold(sample) {
        if motion.state == MotionState::Walking && distance >= SLOW_MOVEMENT_MIN_DISTANCE_METERS {
            MovingPointDecision::Track(TrackDecision::normal("motion_supported_low_speed"))
        } else {
            decide_stationary_cloud(sample, previous, motion, state)
        }
    } else {
        MovingPointDecision::Track(TrackDecision::normal("moving_good_fix"))
    }
}

fn decide_gap_recovery(
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
    motion: MotionClassification,
    distance: f64,
    reported_speed: Option<f64>,
    state: &mut IntakeState,
) -> MovingPointDecision {
    record_recovery_cloud_sample(state, sample, previous);
    let threshold_meters = stationary_threshold(sample);
    if sample.horizontal_accuracy_meters > WEAK_CLOUD_ACCURACY_METERS {
        return MovingPointDecision::Weak("gap_recovery_pending");
    }
    if distance <= threshold_meters && motion.state != MotionState::Walking {
        return MovingPointDecision::Weak("gap_recovery_pending");
    }
    if !is_recovery_fast_path(sample, distance, threshold_meters, reported_speed)
        && !is_recovery_cloud_stable(state, threshold_meters)
    {
        return MovingPointDecision::Weak("gap_recovery_pending");
    }
    MovingPointDecision::Track(TrackDecision::zero_delta("gap_recovery"))
}

fn decide_stationary_cloud(
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
    motion: MotionClassification,
    state: &mut IntakeState,
) -> MovingPointDecision {
    record_stationary_cloud_sample(state, sample, previous);
    if state.previous_accepted_reason == Some("stationary_anchor") {
        return MovingPointDecision::Reject("stationary_anchor_redundant");
    }
    if motion.state == MotionState::Still
        && is_stationary_cloud_stable(state, stationary_threshold(sample))
    {
        return MovingPointDecision::Track(TrackDecision::zero_metric("stationary_anchor"));
    }
    MovingPointDecision::Reject("stationary_cloud_jitter")
}

fn is_low_accuracy_rescue_point(
    sample: &NormalizedLocationSample,
    distance: f64,
    implied_speed: f64,
) -> bool {
    sample.horizontal_accuracy_meters <= LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS
        && distance >= LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS
        && implied_speed <= CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND
}

fn is_recovery_fast_path(
    sample: &NormalizedLocationSample,
    distance: f64,
    threshold_meters: f64,
    reported_speed: Option<f64>,
) -> bool {
    distance >= threshold_meters
        && sample.horizontal_accuracy_meters <= RECOVERY_FAST_PATH_ACCURACY_METERS
        && reported_speed.map_or(true, |speed| {
            speed <= RECOVERY_FAST_PATH_MAX_SPEED_METERS_PER_SECOND
        })
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
    let reset = state.recovery_cloud.as_ref().map_or(true, |cloud| {
        cloud.reference_sample_id != previous.sample_id
            || sample.fix_elapsed_realtime_nanos - cloud.last_elapsed_realtime_nanos
                > (GAP_SECONDS * 1_000_000_000.0) as i64
    });
    if reset {
        state.recovery_cloud = Some(RecoveryCloud {
            reference_sample_id: previous.sample_id,
            last_elapsed_realtime_nanos: sample.fix_elapsed_realtime_nanos,
            samples: Vec::new(),
        });
    }

    if let Some(cloud) = &mut state.recovery_cloud {
        cloud.samples.push(CloudSample {
            lat: sample.lat,
            lng: sample.lng,
        });
        cloud.last_elapsed_realtime_nanos = sample.fix_elapsed_realtime_nanos;
    }
}

fn is_recovery_cloud_stable(state: &IntakeState, threshold_meters: f64) -> bool {
    state.recovery_cloud.as_ref().map_or(false, |cloud| {
        cloud.samples.len() >= RECOVERY_CLOUD_MIN_SAMPLES
            && cloud_radius_meters(&cloud.samples) <= threshold_meters
    })
}

fn record_stationary_cloud_sample(
    state: &mut IntakeState,
    sample: &NormalizedLocationSample,
    previous: &NormalizedLocationSample,
) {
    let reset = state.stationary_cloud.as_ref().map_or(true, |cloud| {
        cloud.reference_sample_id != previous.sample_id
            || sample.fix_elapsed_realtime_nanos - cloud.last_elapsed_realtime_nanos
                > (GAP_SECONDS * 1_000_000_000.0) as i64
    });
    if reset {
        state.stationary_cloud = Some(RecoveryCloud {
            reference_sample_id: previous.sample_id,
            last_elapsed_realtime_nanos: sample.fix_elapsed_realtime_nanos,
            samples: Vec::new(),
        });
    }

    if let Some(cloud) = &mut state.stationary_cloud {
        cloud.samples.push(CloudSample {
            lat: sample.lat,
            lng: sample.lng,
        });
        cloud.last_elapsed_realtime_nanos = sample.fix_elapsed_realtime_nanos;
    }
}

fn is_stationary_cloud_stable(state: &IntakeState, threshold_meters: f64) -> bool {
    state.stationary_cloud.as_ref().map_or(false, |cloud| {
        cloud.samples.len() >= STATIONARY_CLOUD_MIN_SAMPLES
            && cloud_radius_meters(&cloud.samples) <= threshold_meters
    })
}

fn cloud_radius_meters(samples: &[CloudSample]) -> f64 {
    if samples.len() <= 1 {
        return 0.0;
    }
    let (latitude_sum, longitude_sum) = samples.iter().fold((0.0, 0.0), |sum, sample| {
        (sum.0 + sample.lat, sum.1 + sample.lng)
    });
    let center_latitude = latitude_sum / samples.len() as f64;
    let center_longitude = longitude_sum / samples.len() as f64;
    let squared_sum = samples
        .iter()
        .map(|sample| {
            let distance = haversine_distance_meters(
                center_latitude,
                center_longitude,
                sample.lat,
                sample.lng,
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
        && reported_speed.map_or(false, |speed| speed < TRANSPORT_SPEED_METERS_PER_SECOND)
}

#[derive(Default)]
struct IntakeState {
    last_legal_elapsed_realtime_nanos: Option<i64>,
    legal_fix_keys: HashSet<String>,
    recovery_cloud: Option<RecoveryCloud>,
    stationary_cloud: Option<RecoveryCloud>,
    previous_accepted_reason: Option<&'static str>,
}

struct RecoveryCloud {
    reference_sample_id: i64,
    last_elapsed_realtime_nanos: i64,
    samples: Vec<CloudSample>,
}

struct CloudSample {
    lat: f64,
    lng: f64,
}

fn intake_reject_reason(
    sample: &NormalizedLocationSample,
    epoch: Option<&SamplingEpoch>,
    record_start_elapsed_realtime_nanos: i64,
    state: &IntakeState,
) -> Option<&'static str> {
    if sample.provider.trim().is_empty() {
        Some("missing_position_source")
    } else if sample.is_mock {
        Some("mock_location")
    } else if !is_valid_coordinate(sample.lat, sample.lng) {
        Some("invalid_coordinate")
    } else if sample.fix_elapsed_realtime_nanos < 0 {
        Some("missing_fix_elapsed_realtime")
    } else if sample.fix_elapsed_realtime_nanos
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
        .map_or(false, |last| sample.fix_elapsed_realtime_nanos <= last)
    {
        Some("out_of_order_fix")
    } else if sample.sampling_epoch_id.is_some() && epoch.is_none() {
        Some("sampling_epoch_mismatch")
    } else if epoch.map_or(false, |epoch| {
        sample.fix_elapsed_realtime_nanos
            < epoch.started_elapsed_realtime_nanos - START_TOLERANCE_NANOS
    }) {
        Some("sampling_epoch_mismatch")
    } else if sample.fix_elapsed_realtime_nanos < 0 {
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
        if epoch.started_elapsed_realtime_nanos <= sample.fix_elapsed_realtime_nanos {
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
        sample.provider,
        sample.fix_elapsed_realtime_nanos,
        sample.lat,
        sample.lng,
        sample.horizontal_accuracy_meters
    )
}

fn is_valid_coordinate(latitude: f64, longitude: f64) -> bool {
    latitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && longitude.is_finite()
        && (-180.0..=180.0).contains(&longitude)
}

fn compare_f64(left: f64, right: f64) -> Ordering {
    match (left.is_nan(), right.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => left.partial_cmp(&right).unwrap_or(Ordering::Equal),
    }
}

fn elapsed_delta_seconds(
    previous: &NormalizedLocationSample,
    current: &NormalizedLocationSample,
) -> f64 {
    let delta_nanos = current.fix_elapsed_realtime_nanos - previous.fix_elapsed_realtime_nanos;
    if delta_nanos <= 0 {
        0.0
    } else {
        delta_nanos as f64 / 1_000_000_000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use track_model::{NormalizedMotionWindow, OutdoorTrackInput, SessionContext};

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn process_debug_returns_raw_point_decisions() {
        let mut non_gnss = sample(2, 30.0001, 120.0, 2_000_000_000);
        non_gnss.provider = "network".to_string();
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
        assert_eq!(result.raw_point_decisions[0].sample_id, 1);
        assert_eq!(result.raw_point_decisions[0].result, "accept");
        assert_eq!(result.raw_point_decisions[0].reason, "first_fix_good");
        assert_eq!(result.raw_point_decisions[0].track_point_id, Some(1));
        assert_eq!(result.raw_point_decisions[1].sample_id, 2);
        assert_eq!(result.raw_point_decisions[1].result, "accept");
        assert_eq!(result.raw_point_decisions[1].reason, "moving_good_fix");
        assert_eq!(result.raw_point_decisions[1].track_point_id, Some(2));
        assert_eq!(result.raw_point_decisions[2].track_point_id, Some(3));
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn web_intake_filter_removes_invalid_samples() {
        let mut mock = sample(3, 30.0002, 120.0, 3_000_000_000);
        mock.is_mock = true;
        let mut invalid_latitude = sample(4, 91.0, 120.0, 4_000_000_000);
        invalid_latitude.horizontal_accuracy_meters = 8.0;
        let mut weak_accuracy = sample(5, 30.0003, 120.0, 5_000_000_000);
        weak_accuracy.horizontal_accuracy_meters = 81.0;
        let mut duplicate_time = sample(6, 30.0004, 120.0, 1_000_000_000);
        duplicate_time.sample_id = 6;
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
        assert_eq!(result.track_points[0].source_sample_id, 1);
        assert_eq!(result.track_points[1].source_sample_id, 7);
        assert_eq!(result.segments.len(), 1);
    }

    #[test]
    fn intake_keeps_non_empty_positioning_source_like_web() {
        let mut network = sample(1, 30.0, 120.0, 1_000_000_000);
        network.provider = "network".to_string();
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
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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
        assert_eq!(result.cleaned_track.track_points[0].source_sample_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "weak_horizontal_accuracy"
        );
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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
        assert_eq!(result.cleaned_track.track_points[0].source_sample_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "implied_speed_too_high"
        );
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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
        assert_eq!(result.cleaned_track.track_points[0].source_sample_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "implied_speed_unconfirmed_by_reported_speed"
        );
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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
        assert_eq!(result.cleaned_track.track_points[0].source_sample_id, 1);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(result.raw_point_decisions[1].result, "reject");
        assert_eq!(result.raw_point_decisions[1].reason, "transport_risk");
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
    }

    #[test]
    fn moving_point_rescues_low_accuracy_continuity_like_web() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-low-accuracy-rescue", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample_with_accuracy_at(2, 30.00003, 120.0, 35.0, 2_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.raw_point_decisions[1].result, "accept");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "continuity_rescue_low_accuracy"
        );
        assert!(result.cleaned_track.summary.total_distance_meters > 2.5);
    }

    #[test]
    fn walking_motion_supports_low_speed_cleaning_like_web() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-motion-low-speed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.00003, 120.0, 2_000_000_000),
            ],
            motion_windows: vec![walking_motion_window(
                "walk-1",
                1_500_000_000,
                2_000_000_000,
            )],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.raw_point_decisions[1].result, "accept");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "motion_supported_low_speed"
        );
        assert!(result.cleaned_track.summary.total_distance_meters > 2.5);
    }

    #[test]
    fn still_motion_stable_cloud_creates_zero_metric_stationary_anchor() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-stationary-anchor", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.000005, 120.0, 2_000_000_000),
                sample(3, 30.000006, 120.0, 3_000_000_000),
            ],
            motion_windows: vec![
                still_motion_window("still-1", 1_500_000_000, 2_000_000_000),
                still_motion_window("still-2", 2_500_000_000, 3_000_000_000),
            ],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            0.0
        );
        assert_eq!(result.cleaned_track.segments.len(), 1);
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        assert_eq!(result.raw_point_decisions[1].result, "reject");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "stationary_cloud_jitter"
        );
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(result.raw_point_decisions[2].reason, "stationary_anchor");
    }

    #[test]
    fn unknown_motion_rejects_stationary_cloud_jitter_like_web() {
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-stationary-jitter", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                sample(2, 30.000005, 120.0, 2_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(result.raw_point_decisions[1].result, "reject");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "stationary_cloud_jitter"
        );
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn moving_spike_cleanup_bridges_single_low_speed_lateral_spike() {
        let mut spike = sample(2, 30.00006, 120.00005, 2_000_000_000);
        spike.speed_meters_per_second = Some(0.1);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-moving-spike", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                spike,
                sample(3, 30.0, 120.0001, 3_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "moving_spike_line_bridge_suppressed"
        );
        assert_eq!(result.raw_point_decisions[1].track_point_id, None);
        assert!(!result.raw_point_decisions[1].metric_owner);
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(
            result.raw_point_decisions[2].reason,
            "moving_spike_line_bridge"
        );
        assert_eq!(result.raw_point_decisions[2].track_point_id, Some(2));
        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            result.cleaned_track.summary.total_distance_meters
        );
        assert!(
            result.cleaned_track.summary.total_distance_meters > 9.0
                && result.cleaned_track.summary.total_distance_meters < 10.5
        );
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn moving_spike_cleanup_keeps_high_speed_spike_without_geometry_override() {
        let mut spike = sample(2, 30.00006, 120.00005, 2_000_000_000);
        spike.speed_meters_per_second = Some(4.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-moving-spike-high-speed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                spike,
                sample(3, 30.0, 120.0001, 3_000_000_000),
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 3);
        assert!(result.cleaned_track.summary.total_distance_meters > 15.0);
    }

    #[test]
    fn position_snap_recovery_zeroes_recovery_point_after_speed_contradiction_weak_point() {
        let mut weak_jump = sample(2, 30.0004, 120.0, 11_000_000_000);
        weak_jump.speed_meters_per_second = Some(1.0);
        let mut recovery = sample(3, 30.0002, 120.0, 12_000_000_000);
        recovery.speed_meters_per_second = Some(1.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-position-snap", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![sample(1, 30.0, 120.0, 1_000_000_000), weak_jump, recovery],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.raw_point_decisions[1].result, "weak");
        assert_eq!(
            result.raw_point_decisions[1].reason,
            "implied_speed_unconfirmed_by_reported_speed"
        );
        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(
            result.raw_point_decisions[2].reason,
            "position_snap_recovery_anchor"
        );
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            0.0
        );
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
    }

    #[test]
    fn position_snap_recovery_keeps_distance_when_recovery_reported_speed_is_high() {
        let mut weak_jump = sample(2, 30.0004, 120.0, 11_000_000_000);
        weak_jump.speed_meters_per_second = Some(1.0);
        let mut recovery = sample(3, 30.0002, 120.0, 12_000_000_000);
        recovery.speed_meters_per_second = Some(2.5);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-position-snap-speed", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![sample(1, 30.0, 120.0, 1_000_000_000), weak_jump, recovery],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.raw_point_decisions[2].result, "accept");
        assert_eq!(result.raw_point_decisions[2].reason, "moving_good_fix");
        assert!(result.cleaned_track.summary.total_distance_meters > 20.0);
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn stationary_drift_collapse_compresses_local_drift_cloud_to_zero_distance_anchor() {
        let mut location_samples = Vec::new();
        for index in 0..20 {
            let offset = match index % 4 {
                0 => (0.0, 0.0),
                1 => (0.00003, 0.0),
                2 => (0.00003, 0.00003),
                _ => (0.0, 0.00003),
            };
            let mut point = sample_with_accuracy_at(
                (index + 1) as i64,
                30.0 + offset.0,
                120.0 + offset.1,
                30.0,
                1_000_000_000 + index as i64 * 4_000_000_000,
            );
            point.speed_meters_per_second = Some(0.0);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-stationary-drift", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![walking_motion_window("walk-drift", 0, 80_000_000_000)],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(
            result.cleaned_track.track_points[0].source_sample_id,
            result
                .raw_point_decisions
                .iter()
                .find(|decision| decision.reason == "stationary_drift_anchor")
                .expect("stationary drift anchor decision exists")
                .sample_id
        );
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        let anchor_decisions = result
            .raw_point_decisions
            .iter()
            .filter(|decision| decision.reason == "stationary_drift_anchor")
            .collect::<Vec<_>>();
        assert_eq!(anchor_decisions.len(), 1);
        assert_eq!(anchor_decisions[0].result, "accept");
        assert!(anchor_decisions[0].metric_owner);
        assert_eq!(anchor_decisions[0].track_point_id, Some(1));
        assert_eq!(
            result
                .raw_point_decisions
                .iter()
                .filter(|decision| decision.reason == "stationary_drift_anchor_suppressed")
                .count(),
            19
        );
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn weak_recovery_endpoint_preserves_gap_shape_as_zero_distance_anchor() {
        let mut weak_1 = sample_with_accuracy_at(2, 30.00055, 120.0, 34.0, 122_000_000_000);
        weak_1.speed_meters_per_second = Some(0.0);
        let mut weak_2 = sample_with_accuracy_at(3, 30.00056, 120.00001, 34.0, 123_000_000_000);
        weak_2.speed_meters_per_second = Some(0.0);
        let mut weak_3 = sample_with_accuracy_at(4, 30.00054, 119.99999, 34.0, 124_000_000_000);
        weak_3.speed_meters_per_second = Some(0.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-weak-recovery", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![
                sample(1, 30.0, 120.0, 1_000_000_000),
                weak_1,
                weak_2,
                weak_3,
            ],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(
            result.cleaned_track.track_points[1].distance_delta_meters,
            0.0
        );
        assert_eq!(result.cleaned_track.track_points[1].segment_id, 2);
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        let anchor_decisions = result
            .raw_point_decisions
            .iter()
            .filter(|decision| decision.reason == "weak_recovery_shape_anchor")
            .collect::<Vec<_>>();
        assert_eq!(anchor_decisions.len(), 1);
        assert_eq!(anchor_decisions[0].result, "accept");
        assert_eq!(anchor_decisions[0].track_point_id, Some(2));
        assert_eq!(
            result
                .raw_point_decisions
                .iter()
                .filter(|decision| decision.reason == "weak_recovery_shape_anchor_suppressed")
                .count(),
            2
        );
    }

    #[test]
    fn rest_photo_micro_move_anchor_collapses_small_foldback_span() {
        let offsets = [
            (0.0, 0.0),
            (0.000045, 0.0),
            (0.000045, 0.000045),
            (0.0, 0.000045),
            (0.000045, 0.0),
            (0.0, 0.0),
            (0.000045, 0.000045),
            (0.0, 0.000045),
        ];
        let mut location_samples = Vec::new();
        for (index, (lat_offset, lng_offset)) in offsets.iter().copied().enumerate() {
            let mut point = sample(
                (index + 1) as i64,
                30.0 + lat_offset,
                120.0 + lng_offset,
                1_000_000_000 + index as i64 * 5_000_000_000,
            );
            point.speed_meters_per_second = Some(0.5);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-rest-photo", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![walking_motion_window("walk-rest", 0, 40_000_000_000)],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        let anchor_decisions = result
            .raw_point_decisions
            .iter()
            .filter(|decision| decision.reason == "rest_photo_micro_move_anchor")
            .collect::<Vec<_>>();
        assert_eq!(anchor_decisions.len(), 1);
        assert_eq!(anchor_decisions[0].result, "accept");
        assert_eq!(anchor_decisions[0].track_point_id, Some(1));
        assert_eq!(
            result
                .raw_point_decisions
                .iter()
                .filter(|decision| decision.reason == "rest_photo_micro_move_anchor_suppressed")
                .count(),
            7
        );
    }

    #[test]
    fn dense_main_route_settlement_keeps_forward_skeleton_and_reduces_distance() {
        let mut location_samples = Vec::new();
        for index in 0..14 {
            let lat = 30.0 + index as f64 * 0.00002;
            let lng = 120.0 + if index % 2 == 0 { 0.0 } else { 0.00004 };
            let mut point = sample(
                (index + 1) as i64,
                lat,
                lng,
                1_000_000_000 + index as i64 * 3_000_000_000,
            );
            point.speed_meters_per_second = Some(1.2);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-dense-main-route", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![walking_motion_window("walk-dense", 0, 45_000_000_000)],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert!(result.cleaned_track.track_points.len() < 14);
        assert_eq!(
            result
                .cleaned_track
                .track_points
                .first()
                .unwrap()
                .source_sample_id,
            1
        );
        assert_eq!(
            result
                .cleaned_track
                .track_points
                .last()
                .unwrap()
                .source_sample_id,
            14
        );
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "dense_main_route_start"));
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "dense_main_route_end"));
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "dense_main_route_skeleton_suppressed"));
        assert!(result.cleaned_track.summary.total_distance_meters < 80.0);
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn round_trip_line_preserves_weak_recovery_turn_and_simplifies_return_line() {
        let mut location_samples = vec![sample(1, 30.0, 120.0, 1_000_000_000)];
        for index in 0..3 {
            let mut weak = sample_with_accuracy_at(
                (index + 2) as i64,
                30.00085 + index as f64 * 0.000005,
                120.0,
                34.0,
                122_000_000_000 + index as i64 * 1_000_000_000,
            );
            weak.speed_meters_per_second = Some(0.0);
            location_samples.push(weak);
        }
        for index in 0..18 {
            let fraction = index as f64 / 17.0;
            let latitude = 30.00085 * (1.0 - fraction);
            let mut point = sample(
                (index + 5) as i64,
                30.0 + latitude,
                120.0,
                126_000_000_000 + index as i64 * 2_000_000_000,
            );
            point.speed_meters_per_second = Some(1.2);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-round-trip-line", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![walking_motion_window(
                "walk-round-trip",
                125_000_000_000,
                170_000_000_000,
            )],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "round_trip_interwoven_start"));
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "weak_recovery_shape_anchor"));
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "round_trip_interwoven_end"));
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "round_trip_line_suppressed"));
        assert!(result.cleaned_track.track_points.len() < 20);
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn same_road_round_trip_centers_interwoven_corridor_without_removing_turn() {
        let mut location_samples = vec![sample(1, 30.0, 120.00002, 1_000_000_000)];
        for index in 0..3 {
            let mut weak = sample_with_accuracy_at(
                (index + 2) as i64,
                30.00085,
                120.0,
                34.0,
                122_000_000_000 + index as i64 * 1_000_000_000,
            );
            weak.speed_meters_per_second = Some(0.0);
            location_samples.push(weak);
        }
        for index in 0..18 {
            let fraction = index as f64 / 17.0;
            let latitude = 30.00085 * (1.0 - fraction);
            let mut point = sample(
                (index + 5) as i64,
                30.0 + latitude,
                119.99998,
                126_000_000_000 + index as i64 * 2_000_000_000,
            );
            point.speed_meters_per_second = Some(1.2);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-same-road", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![walking_motion_window(
                "walk-same-road",
                125_000_000_000,
                170_000_000_000,
            )],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "weak_recovery_shape_anchor"));
        let centered_interwoven_points = result
            .raw_point_decisions
            .iter()
            .filter(|decision| {
                decision.reason == "round_trip_interwoven_start"
                    || decision.reason == "round_trip_interwoven_end"
                    || decision.reason == "round_trip_interwoven_shape"
            })
            .filter_map(|decision| decision.track_point_id)
            .filter_map(|track_point_id| {
                result
                    .cleaned_track
                    .track_points
                    .iter()
                    .find(|point| point.track_point_id == track_point_id)
            })
            .filter(|point| point.lng > 119.99999 && point.lng < 120.00001)
            .count();
        assert!(centered_interwoven_points > 0);
    }

    #[test]
    fn enclosed_loop_cluster_settlement_keeps_corridor_anchors_and_suppresses_inner_points() {
        let mut samples = Vec::new();
        for index in 0..14 {
            let (lat_offset, lng_offset) = match index % 4 {
                0 => (0.0, 0.0),
                1 => (0.00045, 0.0),
                2 => (0.00045, 0.00045),
                _ => (0.0, 0.00045),
            };
            let mut point = sample(
                (index * 20 + 1) as i64,
                30.0 + lat_offset,
                120.0 + lng_offset,
                1_000_000_000 + index as i64 * 30_000_000_000,
            );
            point.speed_meters_per_second = Some(0.0);
            samples.push(point);
        }
        samples.last_mut().unwrap().lat = samples[0].lat;
        samples.last_mut().unwrap().lng = samples[0].lng;
        let reasons = [
            "moving_good_fix",
            "gap_recovery",
            "moving_good_fix",
            "stationary_anchor",
            "moving_good_fix",
            "gap_recovery",
            "moving_good_fix",
            "stationary_anchor",
            "moving_good_fix",
            "gap_recovery",
            "moving_good_fix",
            "stationary_drift_anchor",
            "moving_good_fix",
            "moving_good_fix",
        ];
        let accepted = samples
            .iter()
            .zip(reasons.iter().copied())
            .map(|(sample, reason)| AcceptedTrackSample {
                sample,
                reason,
                distance_delta_meters: None,
                moving_time_delta_seconds: None,
                starts_new_segment: reason == "gap_recovery",
                lat_override: None,
                lng_override: None,
                suppression_reason: None,
            })
            .collect::<Vec<_>>();

        let (settled, suppressed) = settle_enclosed_loop_clusters(&accepted);

        assert!(settled.len() < accepted.len());
        assert!(
            accepted.len() - settled.len() >= ENCLOSED_LOOP_SETTLEMENT_MIN_REMOVED_TRACK_POINTS
        );
        assert!(suppressed
            .values()
            .all(|reason| *reason == "enclosed_loop_cluster_suppressed"));
        assert!(settled
            .iter()
            .any(|sample| sample.reason == "enclosed_loop_cluster_start"));
        assert!(settled
            .iter()
            .any(|sample| sample.reason == "enclosed_loop_cluster_end"));
        assert!(settled
            .iter()
            .all(|sample| sample.distance_delta_meters == Some(0.0)));
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
        assert_eq!(result.cleaned_track.track_points[0].source_sample_id, 1);
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
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 2);
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
            motion_windows: vec![
                walking_motion_window("walk-gap-1", 121_500_000_000, 122_000_000_000),
                walking_motion_window("walk-gap-2", 122_500_000_000, 123_000_000_000),
            ],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 2);
        assert_eq!(result.cleaned_track.track_points[1].source_sample_id, 3);
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
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
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

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn gnss_altitude_accumulates_ascent_and_descent() {
        let mut first = sample(1, 30.0, 120.0, 1_000_000_000);
        first.altitude_meters = Some(100.0);
        first.vertical_accuracy_meters = Some(4.0);
        let mut second = sample(2, 30.0001, 120.0, 31_000_000_000);
        second.altitude_meters = Some(110.0);
        second.vertical_accuracy_meters = Some(4.0);
        let mut third = sample(3, 30.0002, 120.0, 61_000_000_000);
        third.altitude_meters = Some(104.0);
        third.vertical_accuracy_meters = Some(4.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-gnss-elevation", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![first, second, third],
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert_eq!(result.summary.total_ascent_meters, 10.0);
        assert_eq!(result.summary.total_descent_meters, 6.0);
        assert_eq!(result.summary.selected_elevation_source, "GNSS");
    }

    #[test]
    fn barometer_window_gain_loss_is_selected_over_gnss_altitude() {
        let mut first = sample(1, 30.0, 120.0, 1_000_000_000);
        first.altitude_meters = Some(100.0);
        first.vertical_accuracy_meters = Some(4.0);
        let mut second = sample(2, 30.0001, 120.0, 31_000_000_000);
        second.altitude_meters = Some(110.0);
        second.vertical_accuracy_meters = Some(4.0);
        let mut third = sample(3, 30.0002, 120.0, 61_000_000_000);
        third.altitude_meters = Some(104.0);
        third.vertical_accuracy_meters = Some(4.0);
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-barometer-elevation", "rust-poc"),
            sampling_epochs: vec![],
            location_samples: vec![first, second, third],
            motion_windows: vec![],
            barometer_windows: vec![
                barometer_window("1", 1_000_000_000, 100.0, Some(0.0), Some(0.0)),
                barometer_window("2", 31_000_000_000, 112.0, Some(12.0), Some(0.0)),
                barometer_window("3", 61_000_000_000, 105.0, Some(0.0), Some(7.0)),
            ],
            barometer_calibrations: vec![],
        };

        let result = process(input, TrackConfig::default());

        assert_eq!(result.summary.total_ascent_meters, 12.0);
        assert_eq!(result.summary.total_descent_meters, 7.0);
        assert_eq!(result.summary.selected_elevation_source, "BAROMETER");
    }

    #[test]
    #[ignore = "legacy expectation replaced by replay fixture baseline"]
    fn stationary_session_collapses_to_single_zero_distance_anchor() {
        let mut location_samples = Vec::new();
        for index in 0..25 {
            let offset = if index % 2 == 0 { 0.0 } else { 0.0000005 };
            let mut point = sample(
                (index + 1) as i64,
                30.0 + offset,
                120.0 - offset,
                1_000_000_000 + index as i64 * 3_000_000_000,
            );
            point.speed_meters_per_second = Some(0.0);
            location_samples.push(point);
        }
        let input = OutdoorTrackInput {
            session_context: SessionContext::new("session-stationary-collapse", "rust-poc"),
            sampling_epochs: vec![],
            location_samples,
            motion_windows: vec![],
            barometer_windows: vec![],
            barometer_calibrations: vec![],
        };

        let result = process_debug(input, TrackConfig::default());

        assert_eq!(result.cleaned_track.track_points.len(), 1);
        assert_eq!(result.cleaned_track.summary.total_distance_meters, 0.0);
        assert!(result
            .raw_point_decisions
            .iter()
            .any(|decision| decision.reason == "stationary_session_anchor"));
        assert_eq!(
            result
                .raw_point_decisions
                .iter()
                .filter(|decision| decision.reason == "stationary_session_anchor_suppressed")
                .count(),
            24
        );
    }

    fn sample(
        sample_id: i64,
        latitude: f64,
        longitude: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        sample_with_accuracy_at(sample_id, latitude, longitude, 8.0, elapsed_realtime_nanos)
    }

    fn sample_with_accuracy(
        sample_id: i64,
        accuracy: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        sample_with_accuracy_at(sample_id, 30.0, 120.0, accuracy, elapsed_realtime_nanos)
    }

    fn sample_with_accuracy_at(
        sample_id: i64,
        latitude: f64,
        longitude: f64,
        accuracy: f64,
        elapsed_realtime_nanos: i64,
    ) -> NormalizedLocationSample {
        NormalizedLocationSample {
            sample_id,
            provider: "gnss".to_string(),
            lat: latitude,
            lng: longitude,
            horizontal_accuracy_meters: accuracy,
            altitude_meters: None,
            vertical_accuracy_meters: None,
            speed_meters_per_second: None,
            bearing_degrees: None,
            wall_time_millis: elapsed_realtime_nanos / 1_000_000,
            fix_elapsed_realtime_nanos: elapsed_realtime_nanos,
            is_mock: false,
            sampling_epoch_id: None,
            received_elapsed_realtime_nanos: None,
            callback_delay_nanos: None,
        }
    }

    fn walking_motion_window(
        window_id: &str,
        start_elapsed_realtime_nanos: i64,
        end_elapsed_realtime_nanos: i64,
    ) -> NormalizedMotionWindow {
        NormalizedMotionWindow {
            window_id: window_id.to_string(),
            start_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            linear_acceleration_rms_mps2: Some(0.4),
            accelerometer_dynamic_rms_mps2: None,
            gyroscope_rms_radps: None,
            yaw_delta_degrees: None,
            pitch_delta_degrees: None,
            roll_delta_degrees: None,
            step_detector_count: Some(1),
            step_counter_delta: None,
            device_still: Some(false),
        }
    }

    fn still_motion_window(
        window_id: &str,
        start_elapsed_realtime_nanos: i64,
        end_elapsed_realtime_nanos: i64,
    ) -> NormalizedMotionWindow {
        NormalizedMotionWindow {
            window_id: window_id.to_string(),
            start_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            linear_acceleration_rms_mps2: Some(0.0),
            accelerometer_dynamic_rms_mps2: None,
            gyroscope_rms_radps: Some(0.0),
            yaw_delta_degrees: None,
            pitch_delta_degrees: None,
            roll_delta_degrees: None,
            step_detector_count: Some(0),
            step_counter_delta: Some(0),
            device_still: Some(true),
        }
    }

    fn barometer_window(
        window_id: &str,
        end_elapsed_realtime_nanos: i64,
        altitude_meters: f64,
        window_ascent_meters: Option<f64>,
        window_descent_meters: Option<f64>,
    ) -> NormalizedBarometerWindow {
        NormalizedBarometerWindow {
            window_id: window_id.to_string(),
            start_elapsed_realtime_nanos: end_elapsed_realtime_nanos,
            end_elapsed_realtime_nanos,
            sample_count: 1,
            min_pressure_hpa: 1000.0,
            max_pressure_hpa: 1000.0,
            avg_pressure_hpa: 1000.0,
            delta_pressure_hpa: 0.0,
            min_raw_barometer_altitude_meters: altitude_meters,
            max_raw_barometer_altitude_meters: altitude_meters,
            avg_raw_barometer_altitude_meters: altitude_meters,
            delta_raw_barometer_altitude_meters: 0.0,
            window_ascent_meters,
            window_descent_meters,
            last_sensor_accuracy: None,
        }
    }
}
