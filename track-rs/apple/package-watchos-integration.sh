#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUT_DIR="${ROOT_DIR}/target/apple/watchos-integration-package"
OUT_DIR="${1:-${DEFAULT_OUT_DIR}}"
APPLE_DIR="${ROOT_DIR}/apple"
HEADER_DIR="${ROOT_DIR}/crates/track-ffi/include"
XCFRAMEWORK_PATH="${ROOT_DIR}/target/apple/TrackCore.xcframework"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/swift" "${OUT_DIR}/include"

cp "${APPLE_DIR}/TrackCoreBridge.swift" "${OUT_DIR}/swift/"
cp "${APPLE_DIR}/TrackCoreModels.swift" "${OUT_DIR}/swift/"
cp "${APPLE_DIR}/TrackCoreStreamingEngine.swift" "${OUT_DIR}/swift/"
cp "${APPLE_DIR}/integration-manifest.json" "${OUT_DIR}/"
cp "${HEADER_DIR}/track_ffi.h" "${OUT_DIR}/include/"

if [[ -d "${XCFRAMEWORK_PATH}" ]]; then
  mkdir -p "${OUT_DIR}/Vendor"
  cp -R "${XCFRAMEWORK_PATH}" "${OUT_DIR}/Vendor/TrackCore.xcframework"
fi

cat > "${OUT_DIR}/README.md" <<'README'
# TrackCore watchOS integration package

Copy these files into `watch-hiking-app`:

```text
swift/TrackCoreBridge.swift -> Sources/HikingCore/TrackCoreBridge.swift
swift/TrackCoreModels.swift -> Sources/HikingCore/TrackCoreModels.swift
swift/TrackCoreStreamingEngine.swift -> Sources/HikingCore/TrackCoreStreamingEngine.swift
Vendor/TrackCore.xcframework -> Vendor/TrackCore.xcframework
```

`Vendor/TrackCore.xcframework` is included only when it has already been built by
`apple/build-track-core-xcframework.sh`.

The integration manifest records the required FFI symbols and the product snapshot
field boundary. The product scope is limited to cleaned track points, total distance,
total ascent, total descent, and selected elevation source.

From the `track-rs` directory, apply and validate this package with:

```sh
./apple/apply-watchos-integration-package.sh /path/to/this/package /path/to/watch-hiking-app
./apple/validate-watchos-integration-package.py /path/to/watch-hiking-app
```
README

for path in \
  "${OUT_DIR}/swift/TrackCoreBridge.swift" \
  "${OUT_DIR}/swift/TrackCoreModels.swift" \
  "${OUT_DIR}/swift/TrackCoreStreamingEngine.swift" \
  "${OUT_DIR}/integration-manifest.json" \
  "${OUT_DIR}/include/track_ffi.h" \
  "${OUT_DIR}/README.md"; do
  if [[ ! -s "${path}" ]]; then
    echo "invalid integration package: missing or empty ${path}" >&2
    exit 1
  fi
done

grep -q "track_process_evidence_jsonl_product_snapshot" "${OUT_DIR}/include/track_ffi.h" || {
  echo "invalid integration package: header missing product snapshot FFI" >&2
  exit 1
}

grep -q "processEvidenceJsonlProductSnapshotValue" "${OUT_DIR}/swift/TrackCoreBridge.swift" || {
  echo "invalid integration package: Swift bridge missing typed product snapshot API" >&2
  exit 1
}

python3 "${APPLE_DIR}/validate-watchos-integration-package.py" "${OUT_DIR}" >/dev/null

echo "Packaged watchOS integration files at ${OUT_DIR}"
