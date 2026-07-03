use std::env;
use std::fs;
use std::path::Path;
use std::process;

use serde_json::json;
use track_model::{
    CleanedTrackDebugResult, CleanedTrackResult, ProcessRequest, ProcessResponse, ProductSnapshot,
    TrackError,
};

fn main() {
    let args: Vec<String> = env::args().collect();
    let result = match args.as_slice() {
        [_, command, path] if command == "process" => {
            process_file(path).map(CommandResult::Process)
        }
        [_, command, path] if command == "process-debug" => {
            process_debug_file(path).map(CommandResult::ProcessDebug)
        }
        [_, command, path] if command == "process-product-snapshot" => {
            process_product_snapshot_file(path).map(CommandResult::ProductSnapshot)
        }
        [_, command, path] if command == "process-evidence-jsonl-product-snapshot" => {
            process_evidence_jsonl_product_snapshot_file(path).map(CommandResult::ProductSnapshot)
        }
        [_, command, path] if command == "verify-fixtures" => {
            verify_fixtures(path).map(CommandResult::VerifyFixtures)
        }
        [_, command, path] if command == "verify-fixtures-json" => {
            verify_fixtures_json(path).map(CommandResult::VerifyFixturesJson)
        }
        _ => Err(TrackError::new(
            "usage",
            "usage: track-cli process <input.json> | track-cli process-debug <input.json> | track-cli process-product-snapshot <input.json> | track-cli process-evidence-jsonl-product-snapshot <evidence.jsonl> | track-cli verify-fixtures <fixtures-dir> | track-cli verify-fixtures-json <fixtures-dir>",
        )),
    };

    match result {
        Ok(CommandResult::Process(result)) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&ProcessResponse::ok(result)).unwrap()
            );
        }
        Ok(CommandResult::ProcessDebug(result)) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "ok": true,
                    "result": result,
                }))
                .unwrap()
            );
        }
        Ok(CommandResult::ProductSnapshot(snapshot)) => {
            println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
        }
        Ok(CommandResult::VerifyFixtures(report)) => println!("{report}"),
        Ok(CommandResult::VerifyFixturesJson(report)) => {
            let failed = report
                .get("failedCount")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                > 0;
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
            if failed {
                process::exit(1);
            }
        }
        Err(error) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&ProcessResponse::error(error.code, error.message))
                    .unwrap()
            );
            process::exit(1);
        }
    }
}

enum CommandResult {
    Process(CleanedTrackResult),
    ProcessDebug(CleanedTrackDebugResult),
    ProductSnapshot(ProductSnapshot),
    VerifyFixtures(String),
    VerifyFixturesJson(serde_json::Value),
}

fn process_file(path: &str) -> Result<CleanedTrackResult, TrackError> {
    let content = fs::read_to_string(path)
        .map_err(|error| TrackError::new("read_failed", error.to_string()))?;
    process_request_json(&content)
}

fn process_request_json(content: &str) -> Result<CleanedTrackResult, TrackError> {
    let request: ProcessRequest = serde_json::from_str(content)
        .map_err(|error| TrackError::new("invalid_json", error.to_string()))?;
    let result = std::panic::catch_unwind(|| track_core::process(request.input, request.config))
        .map_err(|_| TrackError::new("panic", "track processing panicked"))?;
    Ok(result)
}

fn process_debug_file(path: &str) -> Result<CleanedTrackDebugResult, TrackError> {
    let content = fs::read_to_string(path)
        .map_err(|error| TrackError::new("read_failed", error.to_string()))?;
    process_debug_request_json(&content)
}

fn process_debug_request_json(content: &str) -> Result<CleanedTrackDebugResult, TrackError> {
    let request: ProcessRequest = serde_json::from_str(content)
        .map_err(|error| TrackError::new("invalid_json", error.to_string()))?;
    let result =
        std::panic::catch_unwind(|| track_core::process_debug(request.input, request.config))
            .map_err(|_| TrackError::new("panic", "track debug processing panicked"))?;
    Ok(result)
}

fn process_product_snapshot_file(path: &str) -> Result<ProductSnapshot, TrackError> {
    let result = process_file(path)?;
    Ok(ProductSnapshot::from(&result))
}

fn process_evidence_jsonl_product_snapshot_file(path: &str) -> Result<ProductSnapshot, TrackError> {
    let content = fs::read_to_string(path)
        .map_err(|error| TrackError::new("read_failed", error.to_string()))?;
    let request = track_model::evidence_jsonl_to_process_request(&content)
        .map_err(|error| TrackError::new(error.code, error.message))?;
    let result = std::panic::catch_unwind(|| track_core::process(request.input, request.config))
        .map_err(|_| TrackError::new("panic", "track evidence processing panicked"))?;
    Ok(ProductSnapshot::from(&result))
}

fn verify_fixtures(path: &str) -> Result<String, TrackError> {
    let fixture_paths = json_files_in_dir(Path::new(path), "read_fixtures_failed")?;

    if fixture_paths.is_empty() {
        return Err(TrackError::new("no_fixtures", "no JSON fixtures found"));
    }

    let report = build_fixture_report(&fixture_paths);

    if report.failures.is_empty() {
        Ok(format!("ok: {} fixtures passed", report.passed_count))
    } else {
        Err(TrackError::new(
            "fixture_verification_failed",
            format!(
                "{} passed, {} failed\n{}",
                report.passed_count,
                report.failures.len(),
                report
                    .failures
                    .iter()
                    .map(|failure| format!("{}: {}", failure.fixture_path, failure.message))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        ))
    }
}

fn verify_fixtures_json(path: &str) -> Result<serde_json::Value, TrackError> {
    let fixture_paths = json_files_in_dir(Path::new(path), "read_fixtures_failed")?;

    if fixture_paths.is_empty() {
        return Err(TrackError::new("no_fixtures", "no JSON fixtures found"));
    }

    Ok(build_fixture_report(&fixture_paths).to_json())
}

#[derive(Debug, PartialEq)]
struct FixtureVerificationReport {
    fixture_count: usize,
    passed_count: usize,
    failures: Vec<FixtureFailure>,
}

#[derive(Debug, PartialEq)]
struct FixtureFailure {
    fixture_path: String,
    rule_id: Option<String>,
    message: String,
    sample_id: Option<i64>,
    sample_range: Option<FixtureSampleRange>,
}

#[derive(Debug, Clone, PartialEq)]
struct FixtureSampleRange {
    start_sample_id: i64,
    end_sample_id: i64,
}

#[derive(Debug, PartialEq)]
struct FixtureVerificationError {
    message: String,
    sample_id: Option<i64>,
    sample_range: Option<FixtureSampleRange>,
}

impl FixtureVerificationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            sample_id: None,
            sample_range: None,
        }
    }

    fn with_sample_id(message: impl Into<String>, sample_id: i64) -> Self {
        Self {
            message: message.into(),
            sample_id: Some(sample_id),
            sample_range: None,
        }
    }

    fn with_sample_range(
        message: impl Into<String>,
        sample_range: Option<FixtureSampleRange>,
    ) -> Self {
        Self {
            message: message.into(),
            sample_id: None,
            sample_range,
        }
    }
}

impl FixtureVerificationReport {
    fn to_json(&self) -> serde_json::Value {
        json!({
            "schemaVersion": "track-sdk-replay-report-v1",
            "strategyVersion": "rust-poc",
            "fixtureCount": self.fixture_count,
            "passedCount": self.passed_count,
            "failedCount": self.failures.len(),
            "failures": self.failures.iter().map(|failure| {
                let mut value = json!({
                    "fixturePath": failure.fixture_path,
                    "ruleId": failure.rule_id,
                    "message": failure.message,
                });
                if let Some(sample_id) = failure.sample_id {
                    value["sampleId"] = json!(sample_id);
                }
                if let Some(sample_range) = &failure.sample_range {
                    value["sampleRange"] = json!({
                        "startSampleId": sample_range.start_sample_id,
                        "endSampleId": sample_range.end_sample_id,
                    });
                    value["rawRange"] = json!({
                        "startRawPointId": sample_range.start_sample_id,
                        "endRawPointId": sample_range.end_sample_id,
                    });
                }
                value
            }).collect::<Vec<_>>(),
        })
    }
}

fn build_fixture_report(paths: &[std::path::PathBuf]) -> FixtureVerificationReport {
    let mut passed_count = 0;
    let mut failures = Vec::new();
    for fixture_path in paths {
        match verify_fixture(fixture_path) {
            Ok(()) => passed_count += 1,
            Err(error) => failures.push(FixtureFailure {
                fixture_path: fixture_path.display().to_string(),
                rule_id: fixture_rule_id(fixture_path).ok(),
                message: error.message,
                sample_id: error.sample_id,
                sample_range: error.sample_range,
            }),
        }
    }
    FixtureVerificationReport {
        fixture_count: paths.len(),
        passed_count,
        failures,
    }
}

fn fixture_rule_id(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let fixture: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(required_string(&fixture, "ruleId")?.to_string())
}

fn json_files_in_dir(path: &Path, error_code: &str) -> Result<Vec<std::path::PathBuf>, TrackError> {
    let mut paths = fs::read_dir(path)
        .map_err(|error| TrackError::new(error_code, error.to_string()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .map_or(false, |extension| extension == "json")
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn verify_fixture(path: &Path) -> Result<(), FixtureVerificationError> {
    let content = fs::read_to_string(path)
        .map_err(|error| FixtureVerificationError::new(error.to_string()))?;
    let fixture: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| FixtureVerificationError::new(error.to_string()))?;
    validate_fixture_metadata(&fixture).map_err(FixtureVerificationError::new)?;
    let request = fixture
        .get("request")
        .ok_or_else(|| FixtureVerificationError::new("missing request"))?;
    let expected = fixture
        .get("expected")
        .ok_or_else(|| FixtureVerificationError::new("missing expected"))?;
    let request_sample_range = request_location_sample_range(request);
    let debug_result = process_debug_request_json(&request.to_string()).map_err(|error| {
        FixtureVerificationError::with_sample_range(error.message, request_sample_range.clone())
    })?;
    let result = &debug_result.cleaned_track;

    assert_expected_usize(expected, "trackPointCount", result.track_points.len()).map_err(
        |message| {
            FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
        },
    )?;
    assert_expected_usize(
        expected,
        "gpxTrackPointCount",
        result.gpx_track_points.len(),
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_expected_usize(expected, "segmentCount", result.segments.len()).map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_expected_f64(
        expected,
        "totalDistanceMeters",
        result.summary.total_distance_meters,
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_expected_f64(
        expected,
        "movingTimeSeconds",
        result.summary.moving_time_seconds,
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_expected_f64(
        expected,
        "totalAscentMeters",
        result.summary.total_ascent_meters,
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_expected_f64(
        expected,
        "totalDescentMeters",
        result.summary.total_descent_meters,
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_optional_string(
        expected,
        "selectedElevationSource",
        &result.summary.selected_elevation_source,
    )
    .map_err(|message| {
        FixtureVerificationError::with_sample_range(message, request_sample_range.clone())
    })?;
    assert_optional_sample_ids(
        expected,
        "acceptedSampleIds",
        "acceptedRawPointIds",
        &debug_result,
        "accept",
    )?;
    assert_optional_sample_ids(
        expected,
        "weakSampleIds",
        "weakRawPointIds",
        &debug_result,
        "weak",
    )?;
    assert_optional_sample_ids(
        expected,
        "rejectedSampleIds",
        "rejectedRawPointIds",
        &debug_result,
        "reject",
    )?;
    assert_optional_decision_reasons(expected, &debug_result)?;
    assert_optional_decision_reason_counts(expected, &debug_result)?;
    assert_optional_track_points(expected, &debug_result)?;

    Ok(())
}

fn request_location_sample_range(request: &serde_json::Value) -> Option<FixtureSampleRange> {
    let ids = request
        .get("input")?
        .get("locationSamples")?
        .as_array()?
        .iter()
        .filter_map(location_sample_id)
        .collect::<Vec<_>>();
    FixtureSampleRange::from_ids(&ids)
}

fn location_sample_id(sample: &serde_json::Value) -> Option<i64> {
    sample
        .get("sampleId")
        .or_else(|| sample.get("rawPointId"))
        .and_then(serde_json::Value::as_i64)
}

impl FixtureSampleRange {
    fn from_ids(ids: &[i64]) -> Option<Self> {
        let start_sample_id = ids.iter().copied().min()?;
        let end_sample_id = ids.iter().copied().max()?;
        Some(Self {
            start_sample_id,
            end_sample_id,
        })
    }
}

fn validate_fixture_metadata(fixture: &serde_json::Value) -> Result<&str, String> {
    let schema_version = required_string(fixture, "schemaVersion")?;
    if schema_version != "track-sdk-replay-fixture-v1" {
        return Err(format!(
            "schemaVersion must be track-sdk-replay-fixture-v1, got {schema_version}"
        ));
    }

    let rule_id = required_string(fixture, "ruleId")?;
    if !is_stable_identifier(rule_id) {
        return Err(format!(
            "ruleId must use lowercase letters, numbers, dot, dash, or underscore: {rule_id}"
        ));
    }

    let rule_version = required_string(fixture, "ruleVersion")?;
    if rule_version.trim().is_empty() {
        return Err("ruleVersion must not be empty".to_string());
    }

    let source = required_string(fixture, "source")?;
    if !matches!(
        source,
        "web_algorithm" | "rust_infrastructure" | "android_replay" | "real_session_slice"
    ) {
        return Err(format!(
            "source must be web_algorithm, rust_infrastructure, android_replay, or real_session_slice, got {source}"
        ));
    }

    Ok(rule_id)
}

fn required_string<'a>(value: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing non-empty string {key}"))
}

fn is_stable_identifier(value: &str) -> bool {
    value.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
    })
}

fn assert_expected_usize(
    expected: &serde_json::Value,
    key: &str,
    actual: usize,
) -> Result<(), String> {
    let expected = expected
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| format!("missing numeric expected.{key}"))? as usize;
    if expected == actual {
        Ok(())
    } else {
        Err(format!("expected {key}={expected}, got {actual}"))
    }
}

fn assert_expected_f64(expected: &serde_json::Value, key: &str, actual: f64) -> Result<(), String> {
    let expected_value = expected
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| format!("missing numeric expected.{key}"))?;
    let tolerance = expected
        .get(format!("{key}Tolerance"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.000001);
    if (actual - expected_value).abs() <= tolerance {
        Ok(())
    } else {
        Err(format!("expected {key}={expected_value}, got {actual}"))
    }
}

fn assert_optional_string(
    expected: &serde_json::Value,
    key: &str,
    actual: &str,
) -> Result<(), String> {
    let Some(expected_value) = expected.get(key) else {
        return Ok(());
    };
    let expected_value = expected_value
        .as_str()
        .ok_or_else(|| format!("expected.{key} must be a string"))?;
    if expected_value == actual {
        Ok(())
    } else {
        Err(format!("expected {key}={expected_value}, got {actual}"))
    }
}

fn assert_optional_sample_ids(
    expected: &serde_json::Value,
    stable_key: &str,
    legacy_key: &str,
    debug_result: &CleanedTrackDebugResult,
    result: &str,
) -> Result<(), FixtureVerificationError> {
    let Some((key, expected_ids)) = expected
        .get(stable_key)
        .map(|value| (stable_key, value))
        .or_else(|| expected.get(legacy_key).map(|value| (legacy_key, value)))
    else {
        return Ok(());
    };
    let expected_ids = json_i64_array(expected_ids, key).map_err(FixtureVerificationError::new)?;
    let actual_ids = debug_result
        .raw_point_decisions
        .iter()
        .filter(|decision| decision.result == result)
        .map(|decision| decision.sample_id)
        .collect::<Vec<_>>();
    if expected_ids == actual_ids {
        Ok(())
    } else {
        let locator_ids = expected_ids
            .iter()
            .chain(actual_ids.iter())
            .copied()
            .collect::<Vec<_>>();
        Err(FixtureVerificationError::with_sample_range(
            format!("expected {key}={expected_ids:?}, got {actual_ids:?}"),
            FixtureSampleRange::from_ids(&locator_ids),
        ))
    }
}

fn assert_optional_decision_reasons(
    expected: &serde_json::Value,
    debug_result: &CleanedTrackDebugResult,
) -> Result<(), FixtureVerificationError> {
    let Some(expected_reasons) = expected.get("decisionReasons") else {
        return Ok(());
    };
    let expected_reasons = expected_reasons.as_object().ok_or_else(|| {
        FixtureVerificationError::new("expected.decisionReasons must be an object")
    })?;

    for (sample_id, expected_reason) in expected_reasons {
        let sample_id = sample_id.parse::<i64>().map_err(|_| {
            FixtureVerificationError::new(format!(
                "decisionReasons key must be sample id: {sample_id}"
            ))
        })?;
        let expected_reason = expected_reason.as_str().ok_or_else(|| {
            FixtureVerificationError::with_sample_id(
                format!("decisionReasons.{sample_id} must be a string"),
                sample_id,
            )
        })?;
        let actual_reason = debug_result
            .raw_point_decisions
            .iter()
            .find(|decision| decision.sample_id == sample_id)
            .map(|decision| decision.reason.as_str())
            .ok_or_else(|| {
                FixtureVerificationError::with_sample_id(
                    format!("missing decision for sample {sample_id}"),
                    sample_id,
                )
            })?;
        if expected_reason != actual_reason {
            return Err(FixtureVerificationError::with_sample_id(
                format!(
                    "expected decisionReasons.{sample_id}={expected_reason}, got {actual_reason}"
                ),
                sample_id,
            ));
        }
    }

    Ok(())
}

fn assert_optional_decision_reason_counts(
    expected: &serde_json::Value,
    debug_result: &CleanedTrackDebugResult,
) -> Result<(), FixtureVerificationError> {
    let Some(expected_counts) = expected.get("decisionReasonCounts") else {
        return Ok(());
    };
    let expected_counts = expected_counts.as_object().ok_or_else(|| {
        FixtureVerificationError::new("expected.decisionReasonCounts must be an object")
    })?;
    let mut actual_counts = std::collections::HashMap::new();
    for decision in &debug_result.raw_point_decisions {
        *actual_counts
            .entry(decision.reason.as_str())
            .or_insert(0usize) += 1;
    }

    for (reason, expected_count) in expected_counts {
        let expected_count = expected_count.as_u64().ok_or_else(|| {
            FixtureVerificationError::new(format!(
                "decisionReasonCounts.{reason} must be an integer"
            ))
        })? as usize;
        let actual_count = actual_counts.get(reason.as_str()).copied().unwrap_or(0);
        if expected_count != actual_count {
            return Err(FixtureVerificationError::new(format!(
                "expected decisionReasonCounts.{reason}={expected_count}, got {actual_count}"
            )));
        }
    }

    Ok(())
}

fn assert_optional_track_points(
    expected: &serde_json::Value,
    debug_result: &CleanedTrackDebugResult,
) -> Result<(), FixtureVerificationError> {
    let Some(expected_points) = expected.get("trackPoints") else {
        return Ok(());
    };
    let expected_points = expected_points
        .as_array()
        .ok_or_else(|| FixtureVerificationError::new("expected.trackPoints must be an array"))?;
    let actual_points = &debug_result.cleaned_track.track_points;
    if expected_points.len() != actual_points.len() {
        return Err(FixtureVerificationError::new(format!(
            "expected trackPoints length={}, got {}",
            expected_points.len(),
            actual_points.len()
        )));
    }

    for (index, (expected_point, actual_point)) in
        expected_points.iter().zip(actual_points.iter()).enumerate()
    {
        let point_label = format!("trackPoints[{index}]");
        if let Some(expected_source_sample_id) = expected_point
            .get("sourceSampleId")
            .and_then(serde_json::Value::as_i64)
        {
            if expected_source_sample_id != actual_point.source_sample_id {
                return Err(FixtureVerificationError::with_sample_id(
                    format!(
                        "expected {point_label}.sourceSampleId={expected_source_sample_id}, got {}",
                        actual_point.source_sample_id
                    ),
                    expected_source_sample_id,
                ));
            }
        }
        assert_optional_point_f64(
            expected_point,
            &point_label,
            "lat",
            actual_point.lat,
            "latTolerance",
            0.0000001,
        )?;
        assert_optional_point_f64(
            expected_point,
            &point_label,
            "lng",
            actual_point.lng,
            "lngTolerance",
            0.0000001,
        )?;
    }

    Ok(())
}

fn assert_optional_point_f64(
    expected_point: &serde_json::Value,
    point_label: &str,
    key: &str,
    actual: f64,
    tolerance_key: &str,
    default_tolerance: f64,
) -> Result<(), FixtureVerificationError> {
    let Some(expected_value) = expected_point.get(key) else {
        return Ok(());
    };
    let expected_value = expected_value.as_f64().ok_or_else(|| {
        FixtureVerificationError::new(format!("{point_label}.{key} must be a number"))
    })?;
    let tolerance = expected_point
        .get(tolerance_key)
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(default_tolerance);
    if (actual - expected_value).abs() <= tolerance {
        Ok(())
    } else {
        Err(FixtureVerificationError::new(format!(
            "expected {point_label}.{key}={expected_value}, got {actual}"
        )))
    }
}

fn json_i64_array(value: &serde_json::Value, key: &str) -> Result<Vec<i64>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("expected.{key} must be an array"))?
        .iter()
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("expected.{key} entries must be integers"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn fixture_report_json_matches_track_sdk_replay_report_contract() {
        let root = workspace_root();
        let passing_fixture = root.join("fixtures/normal-3-points.json");
        let failing_fixture = write_failing_fixture(&root);
        let failing_reason_fixture = write_failing_decision_reason_fixture(&root);
        let failing_reason_count_fixture = write_failing_decision_reason_count_fixture(&root);
        let failing_track_point_fixture = write_failing_track_point_fixture(&root);

        let report = build_fixture_report(&[
            passing_fixture,
            failing_fixture.clone(),
            failing_reason_fixture.clone(),
            failing_reason_count_fixture.clone(),
            failing_track_point_fixture.clone(),
        ]);
        let json = report.to_json();

        assert_eq!(json["schemaVersion"], "track-sdk-replay-report-v1");
        assert_eq!(json["strategyVersion"], "rust-poc");
        assert_eq!(json["fixtureCount"], 5);
        assert_eq!(json["passedCount"], 1);
        assert_eq!(json["failedCount"], 4);
        assert_eq!(json["failures"][0]["ruleId"], "safety_kernel_v0");
        assert!(json["failures"][0]["message"]
            .as_str()
            .unwrap()
            .contains("trackPointCount"));
        assert_eq!(json["failures"][0]["sampleRange"]["startSampleId"], 1);
        assert_eq!(json["failures"][0]["sampleRange"]["endSampleId"], 3);
        assert_eq!(json["failures"][0]["rawRange"]["startRawPointId"], 1);
        assert_eq!(json["failures"][0]["rawRange"]["endRawPointId"], 3);
        assert_eq!(json["failures"][1]["sampleId"], 2);
        assert!(json["failures"][1]["message"]
            .as_str()
            .unwrap()
            .contains("decisionReasons.2"));
        assert!(json["failures"][2]["message"]
            .as_str()
            .unwrap()
            .contains("decisionReasonCounts.moving_good_fix"));
        assert!(json["failures"][3]["message"]
            .as_str()
            .unwrap()
            .contains("trackPoints[0].lat"));

        let _ = fs::remove_file(failing_fixture);
        let _ = fs::remove_file(failing_reason_fixture);
        let _ = fs::remove_file(failing_reason_count_fixture);
        let _ = fs::remove_file(failing_track_point_fixture);
    }

    #[test]
    fn verify_fixtures_json_reports_existing_fixture_directory() {
        let root = workspace_root();
        let report = verify_fixtures_json(root.join("fixtures").to_str().unwrap()).unwrap();

        assert_eq!(report["schemaVersion"], "track-sdk-replay-report-v1");
        assert!(report["fixtureCount"].as_u64().unwrap() > 0);
        assert_eq!(report["failedCount"], 0);
    }

    fn workspace_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn write_failing_fixture(root: &Path) -> std::path::PathBuf {
        let source_path = root.join("fixtures/normal-3-points.json");
        let mut fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(source_path).unwrap()).unwrap();
        fixture["expected"]["trackPointCount"] = json!(999);
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("track-cli-failing-fixture-{unique_id}.json"));
        fs::write(
            path.as_path(),
            serde_json::to_string_pretty(&fixture).unwrap(),
        )
        .unwrap();
        path
    }

    fn write_failing_decision_reason_fixture(root: &Path) -> std::path::PathBuf {
        let source_path = root.join("fixtures/normal-3-points.json");
        let mut fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(source_path).unwrap()).unwrap();
        fixture["expected"]["decisionReasons"]["2"] = json!("wrong_reason");
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "track-cli-failing-decision-fixture-{unique_id}.json"
        ));
        fs::write(
            path.as_path(),
            serde_json::to_string_pretty(&fixture).unwrap(),
        )
        .unwrap();
        path
    }

    fn write_failing_decision_reason_count_fixture(root: &Path) -> std::path::PathBuf {
        let source_path = root.join("fixtures/normal-3-points.json");
        let mut fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(source_path).unwrap()).unwrap();
        fixture["expected"]["decisionReasonCounts"] = json!({
            "moving_good_fix": 999
        });
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "track-cli-failing-decision-count-fixture-{unique_id}.json"
        ));
        fs::write(
            path.as_path(),
            serde_json::to_string_pretty(&fixture).unwrap(),
        )
        .unwrap();
        path
    }

    fn write_failing_track_point_fixture(root: &Path) -> std::path::PathBuf {
        let source_path = root.join("fixtures/normal-3-points.json");
        let mut fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(source_path).unwrap()).unwrap();
        fixture["expected"]["trackPoints"] = json!([
            {
                "sourceSampleId": 1,
                "lat": 99.0,
                "lng": 120.0
            }
        ]);
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "track-cli-failing-track-point-fixture-{unique_id}.json"
        ));
        fs::write(
            path.as_path(),
            serde_json::to_string_pretty(&fixture).unwrap(),
        )
        .unwrap();
        path
    }
}
