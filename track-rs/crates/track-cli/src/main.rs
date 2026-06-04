use std::env;
use std::fs;
use std::path::Path;
use std::process;

use serde_json::json;
use track_model::{
    CleanedTrackDebugResult, CleanedTrackResult, ProcessRequest, ProcessResponse, TrackError,
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
        [_, command, path] if command == "verify-fixtures" => {
            verify_fixtures(path).map(CommandResult::VerifyFixtures)
        }
        _ => Err(TrackError::new(
            "usage",
            "usage: track-cli process <input.json> | track-cli process-debug <input.json> | track-cli verify-fixtures <fixtures-dir>",
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
        Ok(CommandResult::VerifyFixtures(report)) => println!("{report}"),
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
    VerifyFixtures(String),
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

fn verify_fixtures(path: &str) -> Result<String, TrackError> {
    let fixture_paths = json_files_in_dir(Path::new(path), "read_fixtures_failed")?;

    if fixture_paths.is_empty() {
        return Err(TrackError::new("no_fixtures", "no JSON fixtures found"));
    }

    let mut passed = 0;
    let mut failures = Vec::new();
    for fixture_path in &fixture_paths {
        match verify_fixture(fixture_path) {
            Ok(()) => passed += 1,
            Err(message) => failures.push(format!("{}: {message}", fixture_path.display())),
        }
    }

    if failures.is_empty() {
        Ok(format!("ok: {passed} fixtures passed"))
    } else {
        Err(TrackError::new(
            "fixture_verification_failed",
            format!(
                "{} passed, {} failed\n{}",
                passed,
                failures.len(),
                failures.join("\n")
            ),
        ))
    }
}

fn json_files_in_dir(path: &Path, error_code: &str) -> Result<Vec<std::path::PathBuf>, TrackError> {
    let mut paths = fs::read_dir(path)
        .map_err(|error| TrackError::new(error_code, error.to_string()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn verify_fixture(path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let fixture: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;
    validate_fixture_metadata(&fixture)?;
    let request = fixture
        .get("request")
        .ok_or_else(|| "missing request".to_string())?;
    let expected = fixture
        .get("expected")
        .ok_or_else(|| "missing expected".to_string())?;
    let debug_result =
        process_debug_request_json(&request.to_string()).map_err(|error| error.message)?;
    let result = &debug_result.cleaned_track;

    assert_expected_usize(expected, "trackPointCount", result.track_points.len())?;
    assert_expected_usize(
        expected,
        "gpxTrackPointCount",
        result.gpx_track_points.len(),
    )?;
    assert_expected_usize(expected, "segmentCount", result.segments.len())?;
    assert_expected_f64(
        expected,
        "totalDistanceMeters",
        result.summary.total_distance_meters,
    )?;
    assert_expected_f64(
        expected,
        "movingTimeSeconds",
        result.summary.moving_time_seconds,
    )?;
    assert_optional_raw_point_ids(expected, "acceptedRawPointIds", &debug_result, "accept")?;
    assert_optional_raw_point_ids(expected, "rejectedRawPointIds", &debug_result, "reject")?;
    assert_optional_decision_reasons(expected, &debug_result)?;

    Ok(())
}

fn validate_fixture_metadata(fixture: &serde_json::Value) -> Result<&str, String> {
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
    if source != "web_algorithm" && source != "rust_infrastructure" {
        return Err(format!(
            "source must be web_algorithm or rust_infrastructure, got {source}"
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

fn assert_optional_raw_point_ids(
    expected: &serde_json::Value,
    key: &str,
    debug_result: &CleanedTrackDebugResult,
    result: &str,
) -> Result<(), String> {
    let Some(expected_ids) = expected.get(key) else {
        return Ok(());
    };
    let expected_ids = json_i64_array(expected_ids, key)?;
    let actual_ids = debug_result
        .raw_point_decisions
        .iter()
        .filter(|decision| decision.result == result)
        .map(|decision| decision.raw_point_id)
        .collect::<Vec<_>>();
    if expected_ids == actual_ids {
        Ok(())
    } else {
        Err(format!(
            "expected {key}={expected_ids:?}, got {actual_ids:?}"
        ))
    }
}

fn assert_optional_decision_reasons(
    expected: &serde_json::Value,
    debug_result: &CleanedTrackDebugResult,
) -> Result<(), String> {
    let Some(expected_reasons) = expected.get("decisionReasons") else {
        return Ok(());
    };
    let expected_reasons = expected_reasons
        .as_object()
        .ok_or_else(|| "expected.decisionReasons must be an object".to_string())?;

    for (raw_point_id, expected_reason) in expected_reasons {
        let raw_point_id = raw_point_id
            .parse::<i64>()
            .map_err(|_| format!("decisionReasons key must be raw point id: {raw_point_id}"))?;
        let expected_reason = expected_reason
            .as_str()
            .ok_or_else(|| format!("decisionReasons.{raw_point_id} must be a string"))?;
        let actual_reason = debug_result
            .raw_point_decisions
            .iter()
            .find(|decision| decision.raw_point_id == raw_point_id)
            .map(|decision| decision.reason.as_str())
            .ok_or_else(|| format!("missing decision for raw point {raw_point_id}"))?;
        if expected_reason != actual_reason {
            return Err(format!(
                "expected decisionReasons.{raw_point_id}={expected_reason}, got {actual_reason}"
            ));
        }
    }

    Ok(())
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
