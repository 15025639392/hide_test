#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$#" -ne 2 ]]; then
  echo "usage: apply-watchos-integration-package.sh <integration-package-dir> <watch-hiking-app-root>" >&2
  exit 2
fi

PACKAGE_DIR="$(cd "$1" && pwd)"
APP_ROOT="$(cd "$2" && pwd)"
MANIFEST_PATH="${PACKAGE_DIR}/integration-manifest.json"

if [[ ! -s "${MANIFEST_PATH}" ]]; then
  echo "missing integration manifest: ${MANIFEST_PATH}" >&2
  exit 1
fi

python3 "${ROOT_DIR}/apple/validate-watchos-integration-package.py" "${PACKAGE_DIR}" >/dev/null

SWIFT_DIR="${APP_ROOT}/Sources/HikingCore"
VENDOR_DIR="${APP_ROOT}/Vendor"
MANIFEST_DIR="${APP_ROOT}/TrackCoreIntegration"

mkdir -p "${SWIFT_DIR}" "${VENDOR_DIR}" "${MANIFEST_DIR}"

cp "${PACKAGE_DIR}/swift/TrackCoreBridge.swift" "${SWIFT_DIR}/TrackCoreBridge.swift"
cp "${PACKAGE_DIR}/swift/TrackCoreModels.swift" "${SWIFT_DIR}/TrackCoreModels.swift"
cp "${PACKAGE_DIR}/swift/TrackCoreStreamingEngine.swift" "${SWIFT_DIR}/TrackCoreStreamingEngine.swift"
cp "${MANIFEST_PATH}" "${MANIFEST_DIR}/integration-manifest.json"

if [[ -d "${PACKAGE_DIR}/Vendor/TrackCore.xcframework" ]]; then
  rm -rf "${VENDOR_DIR}/TrackCore.xcframework"
  cp -R "${PACKAGE_DIR}/Vendor/TrackCore.xcframework" "${VENDOR_DIR}/TrackCore.xcframework"
fi

python3 "${ROOT_DIR}/apple/validate-watchos-integration-package.py" "${APP_ROOT}" >/dev/null

echo "Applied TrackCore watchOS integration package to ${APP_ROOT}"
