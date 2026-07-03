#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/target/apple"
HEADER_DIR="${ROOT_DIR}/crates/track-ffi/include"
XCFRAMEWORK_PATH="${OUT_DIR}/TrackCore.xcframework"
FRAMEWORK_NAME="TrackCore"

cd "${ROOT_DIR}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

build_target() {
  local target="$1"
  local platform_dir="$2"
  local sdk="$3"

  rustup target add "${target}"
  cargo build -p track-ffi --release --target "${target}"

  local lib_path="${ROOT_DIR}/target/${target}/release/libtrack_ffi.a"
  local framework_dir="${OUT_DIR}/${platform_dir}/${FRAMEWORK_NAME}.framework"
  mkdir -p "${framework_dir}/Headers" "${framework_dir}/Modules"

  if [[ ! -f "${lib_path}" ]]; then
    echo "missing Rust static library: ${lib_path}" >&2
    exit 1
  fi

  cp "${lib_path}" "${framework_dir}/${FRAMEWORK_NAME}"
  cp "${HEADER_DIR}/track_ffi.h" "${framework_dir}/Headers/track_ffi.h"
  cat > "${framework_dir}/Modules/module.modulemap" <<MODULEMAP
framework module ${FRAMEWORK_NAME} {
  umbrella header "track_ffi.h"
  export *
}
MODULEMAP

  cat > "${framework_dir}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.watchmd.trackcore.${platform_dir}</string>
  <key>CFBundleExecutable</key>
  <string>${FRAMEWORK_NAME}</string>
  <key>CFBundleName</key>
  <string>${FRAMEWORK_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>FMWK</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>DTSDKName</key>
  <string>${sdk}</string>
</dict>
</plist>
PLIST

  validate_framework "${framework_dir}"
}

validate_framework() {
  local framework_dir="$1"
  local binary_path="${framework_dir}/${FRAMEWORK_NAME}"
  local header_path="${framework_dir}/Headers/track_ffi.h"
  local modulemap_path="${framework_dir}/Modules/module.modulemap"
  local plist_path="${framework_dir}/Info.plist"

  for path in "${binary_path}" "${header_path}" "${modulemap_path}" "${plist_path}"; do
    if [[ ! -s "${path}" ]]; then
      echo "invalid framework: missing or empty ${path}" >&2
      exit 1
    fi
  done
  grep -q "track_process_evidence_jsonl_product_snapshot" "${header_path}" || {
    echo "invalid framework header: missing product snapshot FFI" >&2
    exit 1
  }
  grep -q "framework module ${FRAMEWORK_NAME}" "${modulemap_path}" || {
    echo "invalid module map for ${FRAMEWORK_NAME}" >&2
    exit 1
  }
  grep -q "<key>CFBundleExecutable</key>" "${plist_path}" || {
    echo "invalid Info.plist: missing CFBundleExecutable" >&2
    exit 1
  }
}

build_target "aarch64-apple-ios" "ios" "iphoneos"
build_target "aarch64-apple-ios-sim" "ios-simulator" "iphonesimulator"
build_target "aarch64-apple-watchos" "watchos" "watchos"
build_target "aarch64-apple-watchos-sim" "watchos-simulator" "watchsimulator"

xcodebuild -create-xcframework \
  -framework "${OUT_DIR}/ios/TrackCore.framework" \
  -framework "${OUT_DIR}/ios-simulator/TrackCore.framework" \
  -framework "${OUT_DIR}/watchos/TrackCore.framework" \
  -framework "${OUT_DIR}/watchos-simulator/TrackCore.framework" \
  -output "${XCFRAMEWORK_PATH}"

echo "Built ${XCFRAMEWORK_PATH}"
