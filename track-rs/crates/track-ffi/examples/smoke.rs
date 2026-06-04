use std::ffi::{CStr, CString};

fn main() {
    let input = CString::new(
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

    let output_ptr = track_ffi::track_process_json(input.as_ptr());
    if output_ptr.is_null() {
        eprintln!("track_process_json returned a null pointer");
        std::process::exit(1);
    }

    let output = unsafe { CStr::from_ptr(output_ptr) }
        .to_string_lossy()
        .into_owned();
    track_ffi::track_free_string(output_ptr);

    println!("{output}");
}
