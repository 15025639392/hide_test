#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

export PATH="${HOME}/.cargo/bin:${PATH}"

if ! command -v rustup >/dev/null 2>&1; then
  if [[ -n "${RUSTUP_INIT:-}" ]]; then
    if [[ ! -x "${RUSTUP_INIT}" ]]; then
      echo "RUSTUP_INIT points to a missing or non-executable file: ${RUSTUP_INIT}" >&2
      exit 127
    fi
    echo "rustup is missing; installing from ${RUSTUP_INIT}" >&2
    "${RUSTUP_INIT}" -y --profile minimal --default-toolchain stable --component rustfmt
  elif ! command -v curl >/dev/null 2>&1; then
    echo "missing required tool: rustup" >&2
    echo "curl is also unavailable, so this script cannot install rustup automatically." >&2
    echo "Install rustup, then rerun: ./scripts/bootstrap-rust-toolchain.sh" >&2
    exit 127
  else
    echo "rustup is missing; installing Rust toolchain manager into ${HOME}/.cargo" >&2
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable --component rustfmt
  fi
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

rustup toolchain install stable --component rustfmt

python3 - <<'PY' | while IFS= read -r target; do
import json
from pathlib import Path

manifest = json.loads(Path("verification-manifest.json").read_text())
for target in manifest["appleTargets"]:
    print(target)
PY
  rustup target add "${target}" --toolchain stable
done

python3 scripts/audit-verification-status.py
