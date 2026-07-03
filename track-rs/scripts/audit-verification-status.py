#!/usr/bin/env python3
import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "verification-manifest.json"

os.environ["PATH"] = f"{Path.home() / '.cargo' / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"


def tool_status(tools):
    return {
        tool: {
            "available": shutil.which(tool) is not None,
            "path": shutil.which(tool),
        }
        for tool in tools
    }


def main() -> None:
    manifest = json.loads(MANIFEST.read_text())
    required_tools = tool_status(manifest["requiredTools"])
    optional_apple_tools = tool_status(manifest["optionalAppleTools"])
    missing_required = [
        tool for tool, status in required_tools.items() if not status["available"]
    ]
    missing_optional_apple = [
        tool for tool, status in optional_apple_tools.items() if not status["available"]
    ]
    rust_gates_runnable = not missing_required
    apple_gate_runnable = rust_gates_runnable and not missing_optional_apple
    completion_ready = rust_gates_runnable
    blocked_reason = None
    if missing_required:
        blocked_reason = (
            "Rust toolchain gates cannot run until required tools are available: "
            + ", ".join(missing_required)
        )

    report = {
        "schemaVersion": "track-rs-verification-status-v1",
        "verificationManifest": str(MANIFEST),
        "completionReady": completion_ready,
        "productScope": {
            "trackPoints": True,
            "totalDistanceMeters": True,
            "totalAscentMeters": True,
            "totalDescentMeters": True,
            "movingTimeSeconds": False,
            "paceSecondsPerKm": False,
        },
        "requiredTools": required_tools,
        "optionalAppleTools": optional_apple_tools,
        "missingRequiredTools": missing_required,
        "missingOptionalAppleTools": missing_optional_apple,
        "blockedReason": blocked_reason,
        "alwaysRunGates": manifest["alwaysRunGates"],
        "alwaysRunGateCount": len(manifest["alwaysRunGates"]),
        "rustToolchainGates": manifest["rustToolchainGates"],
        "rustToolchainGateCount": len(manifest["rustToolchainGates"]),
        "rustToolchainGatesRunnable": rust_gates_runnable,
        "optionalAppleXcframeworkGateRunnable": apple_gate_runnable,
        "nextRequiredCommand": "./scripts/verify-track-core.sh",
        "nextOptionalAppleCommand": "VERIFY_APPLE_XCFRAMEWORK=1 ./scripts/verify-track-core.sh",
        "bootstrapCommand": manifest["bootstrapCommand"],
        "completionCriteria": manifest["completionCriteria"],
    }
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
