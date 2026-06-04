use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use track_model::{ProcessRequest, ProcessResponse};

#[no_mangle]
pub extern "C" fn track_process_json(input: *const c_char) -> *mut c_char {
    let response = process_json_pointer(input);
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

fn error_json(code: &str, message: &str) -> String {
    response_json(ProcessResponse::error(code, message))
}

fn response_json(response: ProcessResponse) -> String {
    serde_json::to_string(&response).unwrap_or_else(|_| fatal_error_json())
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
}
