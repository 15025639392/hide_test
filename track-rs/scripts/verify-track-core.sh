#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

export PATH="${HOME}/.cargo/bin:${PATH}"

python3 scripts/check-static-contracts.py
python3 scripts/audit-verification-status.py >/tmp/track-rs-verification-status.json
(cd ../acceptance-web && npm test)
bash -n apple/package-watchos-integration.sh
bash -n apple/apply-watchos-integration-package.sh
PYTHONPYCACHEPREFIX=/tmp/track-rs-pycache python3 -m py_compile apple/validate-watchos-integration-package.py
if command -v swiftc >/dev/null 2>&1; then
  mkdir -p /tmp/track-rs-swift-module-cache
  swiftc -module-cache-path /tmp/track-rs-swift-module-cache -typecheck \
    apple/TrackCoreModels.swift \
    apple/TrackCoreBridge.swift \
    apple/TrackCoreStreamingEngine.swift
  swiftc -module-cache-path /tmp/track-rs-swift-module-cache \
    apple/TrackCoreModels.swift \
    apple/TrackCoreDecodeSmoke.swift \
    -o /tmp/track-core-decode-smoke
  /tmp/track-core-decode-smoke
fi

./apple/package-watchos-integration.sh >/dev/null
WATCH_APP_SMOKE_DIR="$(mktemp -d /tmp/track-rs-watch-app-smoke.XXXXXX)"
./apple/apply-watchos-integration-package.sh \
  target/apple/watchos-integration-package \
  "${WATCH_APP_SMOKE_DIR}" >/dev/null

missing=0
for tool in cargo rustc rustfmt; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "missing required tool: ${tool}" >&2
    missing=1
  fi
done
if [[ "${missing}" -ne 0 ]]; then
  exit 127
fi

cargo fmt --all --check
cargo test --workspace
cargo run -p track-ffi --example smoke
cargo run -p track-cli -- process examples/minimal-stable-v1-input.json >/dev/null
cargo run -p track-cli -- process-debug examples/minimal-input.json >/dev/null
cargo run -p track-cli -- process-product-snapshot examples/minimal-stable-v1-input.json >/dev/null
cargo run -p track-cli -- process-evidence-jsonl-product-snapshot examples/minimal-evidence-v1.jsonl >/dev/null
cargo run -p track-cli -- verify-fixtures fixtures
cargo run -p track-cli -- verify-fixtures-json fixtures >/dev/null

if [[ "${VERIFY_APPLE_XCFRAMEWORK:-0}" == "1" ]]; then
  if ! command -v rustup >/dev/null 2>&1; then
    echo "missing required tool for Apple build: rustup" >&2
    exit 127
  fi
  if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "missing required tool for Apple build: xcodebuild" >&2
    exit 127
  fi
  ./apple/build-track-core-xcframework.sh
fi

echo "track-rs verification passed"
