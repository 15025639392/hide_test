use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use track_model::{ProcessRequest, ProcessResponse, ProductSnapshot};

#[no_mangle]
pub extern "C" fn track_process_json(input: *const c_char) -> *mut c_char {
    let response = process_json_pointer(input);
    string_to_c_pointer(response)
}

#[no_mangle]
pub extern "C" fn track_process_evidence_jsonl(input: *const c_char) -> *mut c_char {
    let response = process_evidence_jsonl_pointer(input);
    string_to_c_pointer(response)
}

#[no_mangle]
pub extern "C" fn track_process_evidence_jsonl_product_snapshot(
    input: *const c_char,
) -> *mut c_char {
    let response = process_evidence_jsonl_product_snapshot_pointer(input);
    string_to_c_pointer(response)
}

#[no_mangle]
pub extern "C" fn track_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(ptr));
    }
}

fn process_json_pointer(input: *const c_char) -> String {
    if input.is_null() {
        return error_json("null_input", "input JSON pointer is null");
    }
    let input = unsafe { CStr::from_ptr(input) };
    let Ok(input) = input.to_str() else {
        return error_json("invalid_utf8", "input JSON is not valid UTF-8");
    };
    process_json(input)
}

fn process_evidence_jsonl_pointer(input: *const c_char) -> String {
    if input.is_null() {
        return error_json("null_input", "evidence JSONL pointer is null");
    }
    let input = unsafe { CStr::from_ptr(input) };
    let Ok(input) = input.to_str() else {
        return error_json("invalid_utf8", "evidence JSONL is not valid UTF-8");
    };
    process_evidence_jsonl(input)
}

fn process_evidence_jsonl_product_snapshot_pointer(input: *const c_char) -> String {
    if input.is_null() {
        return error_json("null_input", "evidence JSONL pointer is null");
    }
    let input = unsafe { CStr::from_ptr(input) };
    let Ok(input) = input.to_str() else {
        return error_json("invalid_utf8", "evidence JSONL is not valid UTF-8");
    };
    process_evidence_jsonl_product_snapshot(input)
}

fn process_json(input: &str) -> String {
    match std::panic::catch_unwind(|| process_json_inner(input)) {
        Ok(response) => response,
        Err(_) => error_json("panic", "track processing panicked"),
    }
}

fn process_json_inner(input: &str) -> String {
    let request: ProcessRequest = match serde_json::from_str(input) {
        Ok(request) => request,
        Err(error) => return error_json("invalid_json", &error.to_string()),
    };
    let result = track_core::process(request.input, request.config);
    response_json(ProcessResponse::ok(result))
}

fn process_evidence_jsonl(input: &str) -> String {
    match std::panic::catch_unwind(|| process_evidence_jsonl_inner(input)) {
        Ok(response) => response,
        Err(_) => error_json("panic", "track evidence processing panicked"),
    }
}

fn process_evidence_jsonl_inner(input: &str) -> String {
    let request = match evidence_jsonl_to_request(input) {
        Ok(request) => request,
        Err(error) => return error_json(error.code, &error.message),
    };
    let result = track_core::process(request.input, request.config);
    response_json(ProcessResponse::ok(result))
}

fn process_evidence_jsonl_product_snapshot(input: &str) -> String {
    match std::panic::catch_unwind(|| process_evidence_jsonl_product_snapshot_inner(input)) {
        Ok(response) => response,
        Err(_) => error_json("panic", "track evidence processing panicked"),
    }
}

fn process_evidence_jsonl_product_snapshot_inner(input: &str) -> String {
    let request = match evidence_jsonl_to_request(input) {
        Ok(request) => request,
        Err(error) => return error_json(error.code, &error.message),
    };
    let result = track_core::process(request.input, request.config);
    product_snapshot_json(ProductSnapshot::from(&result))
}

fn evidence_jsonl_to_request(input: &str) -> Result<ProcessRequest, JsonlError> {
    track_model::evidence_jsonl_to_process_request(input).map_err(|error| JsonlError {
        code: error.code,
        message: error.message,
    })
}

#[derive(Debug)]
struct JsonlError {
    code: &'static str,
    message: String,
}

fn error_json(code: &str, message: &str) -> String {
    response_json(ProcessResponse::error(code, message))
}

fn response_json(response: ProcessResponse) -> String {
    serde_json::to_string(&response).unwrap_or_else(|_| fatal_error_json())
}

fn product_snapshot_json(snapshot: ProductSnapshot) -> String {
    serde_json::to_string(&snapshot).unwrap_or_else(|_| fatal_error_json())
}

fn fatal_error_json() -> String {
    "{\"ok\":false,\"error\":{\"code\":\"fatal\",\"message\":\"serialization failed\"}}".to_string()
}

fn string_to_c_pointer(value: String) -> *mut c_char {
    match CString::new(value) {
        Ok(value) => value.into_raw(),
        Err(_) => CString::new(error_json(
            "nul_byte",
            "output contains an unexpected NUL byte",
        ))
        .expect("static error JSON must not contain NUL")
        .into_raw(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_json_returns_error_response() {
        let response = process_json("{");
        assert!(response.contains("invalid_json"));

        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["ok"], false);
    }

    #[test]
    fn neutral_evidence_jsonl_can_be_processed_directly() {
        let response = process_evidence_jsonl(
            r#"{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000,"createdWallTimeMillis":1000}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":1,"provider":"gnss","lat":30,"lng":120,"horizontalAccuracyMeters":5,"wallTimeMillis":1000,"fixElapsedRealtimeNanos":1000000000,"isMock":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":2,"provider":"gnss","lat":30.0001,"lng":120,"horizontalAccuracyMeters":5,"wallTimeMillis":31000,"fixElapsedRealtimeNanos":31000000000,"isMock":false}
"#,
        );

        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["result"]["trackPoints"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn neutral_evidence_jsonl_product_snapshot_is_lightweight() {
        let response = process_evidence_jsonl_product_snapshot(
            r#"{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000,"createdWallTimeMillis":1000}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":1,"provider":"gnss","lat":30,"lng":120,"horizontalAccuracyMeters":5,"wallTimeMillis":1000,"fixElapsedRealtimeNanos":1000000000,"isMock":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sessionId":"S1","sampleId":2,"provider":"gnss","lat":30.0001,"lng":120,"horizontalAccuracyMeters":5,"wallTimeMillis":31000,"fixElapsedRealtimeNanos":31000000000,"isMock":false}
"#,
        );

        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["trackPoints"].as_array().unwrap().len(), 2);
        assert!(value.get("totalDistanceMeters").is_some());
        assert!(value.get("totalAscentMeters").is_some());
        assert!(value.get("totalDescentMeters").is_some());
        assert!(value["trackPoints"][0]
            .get("movingTimeDeltaSeconds")
            .is_none());
    }

    #[test]
    fn neutral_evidence_jsonl_uses_stable_process_request_schema_version() {
        let request = evidence_jsonl_to_request(
            r#"{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"S1","createdElapsedRealtimeNanos":1000000000,"createdWallTimeMillis":1000}
"#,
        )
        .unwrap();

        assert_eq!(
            request.schema_version.as_deref(),
            Some("track-sdk-process-request-v1")
        );
    }
}
