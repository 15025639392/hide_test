use std::ffi::{CStr, CString};

fn main() {
    let request_input = CString::new(
        r#"{
  "config": {},
  "input": {
    "sessionContext": {
      "sessionId": "ffi-smoke",
      "strategyVersion": "rust-poc",
      "createdElapsedRealtimeNanos": 0,
      "createdWallTimeMillis": 0,
      "deviceModel": null,
      "completionState": null
    },
    "samplingEpochs": [],
    "locationSamples": [
      {
        "rawPointId": 1,
        "positioningSource": "gnss",
        "latitude": 30.0,
        "longitude": 120.0,
        "horizontalAccuracyMeters": 8.0,
        "altitudeMeters": null,
        "verticalAccuracyMeters": null,
        "speedMetersPerSecond": null,
        "bearingDegrees": null,
        "wallTimeMillis": 1000,
        "elapsedRealtimeNanos": 1000000000,
        "isMock": false,
        "samplingEpochId": null,
        "callbackReceivedElapsedRealtimeNanos": null,
        "callbackDelayNanos": null
      }
    ],
    "motionWindows": [],
    "barometerWindows": []
  }
}"#,
    )
    .expect("example input should not contain NUL");

    let request_output = call_track_core(track_ffi::track_process_json, &request_input);
    assert_success_response(&request_output);
    println!("{request_output}");

    let evidence_input = CString::new(
        r#"{"schemaVersion":"outdoor-track-evidence-v1","event":"session_metadata","sessionId":"ffi-evidence-smoke","createdElapsedRealtimeNanos":1000000000,"createdWallTimeMillis":1000}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sampleId":1,"provider":"gnss","lat":30,"lng":120,"horizontalAccuracyMeters":8,"altitudeMeters":100,"verticalAccuracyMeters":5,"wallTimeMillis":1000,"fixElapsedRealtimeNanos":1000000000,"isMock":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"location_sample","sampleId":2,"provider":"gnss","lat":30.0001,"lng":120,"horizontalAccuracyMeters":8,"altitudeMeters":104,"verticalAccuracyMeters":5,"wallTimeMillis":31000,"fixElapsedRealtimeNanos":31000000000,"isMock":false}
{"schemaVersion":"outdoor-track-evidence-v1","event":"barometer_window","windowId":"baro-1","startElapsedRealtimeNanos":1000000000,"endElapsedRealtimeNanos":31000000000,"sampleCount":30,"avgRawBarometerAltitudeMeters":102,"deltaRawBarometerAltitudeMeters":4,"windowAscentMeters":4,"windowDescentMeters":0}
"#,
    )
    .expect("example evidence should not contain NUL");
    let evidence_output = call_track_core(track_ffi::track_process_evidence_jsonl, &evidence_input);
    assert_success_response(&evidence_output);
    println!("{evidence_output}");

    let snapshot_output = call_track_core(
        track_ffi::track_process_evidence_jsonl_product_snapshot,
        &evidence_input,
    );
    assert_product_snapshot(&snapshot_output);
    println!("{snapshot_output}");
}

fn call_track_core(
    function: extern "C" fn(*const std::os::raw::c_char) -> *mut std::os::raw::c_char,
    input: &CString,
) -> String {
    let output_ptr = function(input.as_ptr());
    if output_ptr.is_null() {
        eprintln!("track FFI returned a null pointer");
        std::process::exit(1);
    }
    let output = unsafe { CStr::from_ptr(output_ptr) }
        .to_string_lossy()
        .into_owned();
    track_ffi::track_free_string(output_ptr);
    output
}

fn assert_success_response(output: &str) {
    let value: serde_json::Value =
        serde_json::from_str(output).expect("track FFI output must be JSON");
    assert_eq!(value["ok"], true);
    let summary = &value["result"]["summary"];
    assert!(summary["totalDistanceMeters"].is_number());
    assert!(summary["totalAscentMeters"].is_number());
    assert!(summary["totalDescentMeters"].is_number());
    assert!(summary["selectedElevationSource"].is_string());
}

fn assert_product_snapshot(output: &str) {
    let value: serde_json::Value =
        serde_json::from_str(output).expect("track FFI product snapshot output must be JSON");
    assert!(value["trackPoints"].is_array());
    assert!(value["totalDistanceMeters"].is_number());
    assert!(value["totalAscentMeters"].is_number());
    assert!(value["totalDescentMeters"].is_number());
    assert!(value["selectedElevationSource"].is_string());
    assert!(value.get("movingTimeSeconds").is_none());
    assert!(value.get("paceSecondsPerKm").is_none());
    assert!(value["trackPoints"][0]
        .get("movingTimeDeltaSeconds")
        .is_none());
}
