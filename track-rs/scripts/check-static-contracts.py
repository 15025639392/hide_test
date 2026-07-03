#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]

PROCESS_REQUEST_SCHEMA_VERSION = "track-sdk-process-request-v1"
FIXTURE_SCHEMA_VERSION = "track-sdk-replay-fixture-v1"
REQUIRED_FIXTURE_SUMMARY_FIELDS = {
    "totalDistanceMeters",
    "movingTimeSeconds",
    "totalAscentMeters",
    "totalDescentMeters",
}
ALLOWED_ELEVATION_SOURCES = {"BAROMETER", "GNSS", "NONE"}
PRODUCT_SNAPSHOT_SCHEMA = ROOT / "schemas/product-snapshot.schema.json"
PRODUCT_SNAPSHOT_COMPARISON_SCHEMA = ROOT / "schemas/product-snapshot-comparison.schema.json"
APPLE_INTEGRATION_MANIFEST_SCHEMA = ROOT / "schemas/apple-integration-manifest.schema.json"
VERIFICATION_MANIFEST_SCHEMA = ROOT / "schemas/verification-manifest.schema.json"
VERIFICATION_STATUS_SCHEMA = ROOT / "schemas/verification-status.schema.json"
PRODUCT_SNAPSHOT_EXAMPLE = ROOT / "examples/product-snapshot.example.json"
MINIMAL_EVIDENCE_JSONL = ROOT / "examples/minimal-evidence-v1.jsonl"
FFI_HEADER = ROOT / "crates/track-ffi/include/track_ffi.h"
FFI_SMOKE = ROOT / "crates/track-ffi/examples/smoke.rs"
SWIFT_BRIDGE = ROOT / "apple/TrackCoreBridge.swift"
SWIFT_MODELS = ROOT / "apple/TrackCoreModels.swift"
SWIFT_STREAMING = ROOT / "apple/TrackCoreStreamingEngine.swift"
APPLE_BUILD_SCRIPT = ROOT / "apple/build-track-core-xcframework.sh"
APPLE_PACKAGE_SCRIPT = ROOT / "apple/package-watchos-integration.sh"
APPLE_APPLY_SCRIPT = ROOT / "apple/apply-watchos-integration-package.sh"
APPLE_VALIDATE_SCRIPT = ROOT / "apple/validate-watchos-integration-package.py"
APPLE_INTEGRATION_MANIFEST = ROOT / "apple/integration-manifest.json"
VERIFICATION_MANIFEST = ROOT / "verification-manifest.json"
RUST_TOOLCHAIN = ROOT / "rust-toolchain.toml"
RUST_MODEL = ROOT / "crates/track-model/src/lib.rs"
RUST_CLI = ROOT / "crates/track-cli/src/main.rs"
VERIFY_SCRIPT = ROOT / "scripts/verify-track-core.sh"
AUDIT_SCRIPT = ROOT / "scripts/audit-verification-status.py"
BOOTSTRAP_SCRIPT = ROOT / "scripts/bootstrap-rust-toolchain.sh"
GITHUB_WORKFLOW = ROOT.parent / ".github/workflows/track-rs.yml"
WATCH_STREAMING_DOC = ROOT.parent / "docs/watchos-rust-streaming-track-core.md"
DEFAULT_METERS_TOLERANCE = 0.01


def fail(message: str) -> None:
    print(f"static contract check failed: {message}", file=sys.stderr)
    sys.exit(1)


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        fail(f"{path}: invalid JSON: {exc}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def check_process_request(path: Path, value) -> None:
    require(
        value.get("schemaVersion") in (None, PROCESS_REQUEST_SCHEMA_VERSION),
        f"{path}: schemaVersion must be {PROCESS_REQUEST_SCHEMA_VERSION}",
    )
    request_input = value.get("input")
    require(isinstance(request_input, dict), f"{path}: missing input object")
    require(
        isinstance(request_input.get("sessionContext"), dict),
        f"{path}: missing input.sessionContext",
    )
    for key in ["locationSamples", "samplingEpochs"]:
        require(isinstance(request_input.get(key), list), f"{path}: input.{key} must be an array")
    for sample in request_input.get("locationSamples", []):
        for key in [
            "sampleId",
            "provider",
            "lat",
            "lng",
            "horizontalAccuracyMeters",
            "wallTimeMillis",
            "fixElapsedRealtimeNanos",
            "isMock",
        ]:
            require(key in sample, f"{path}: location sample missing {key}")
        for legacy_key in [
            "rawPointId",
            "positioningSource",
            "latitude",
            "longitude",
            "elapsedRealtimeNanos",
        ]:
            require(legacy_key not in sample, f"{path}: stable request uses legacy {legacy_key}")
    for window in request_input.get("barometerWindows", []):
        for key in ["windowAscentMeters", "windowDescentMeters"]:
            require(key in window, f"{path}: barometer window missing {key}")


def check_fixture(path: Path) -> None:
    fixture = load_json(path)
    require(
        fixture.get("schemaVersion") == FIXTURE_SCHEMA_VERSION,
        f"{path}: schemaVersion must be {FIXTURE_SCHEMA_VERSION}",
    )
    for key in ["ruleId", "ruleVersion", "source", "request", "expected"]:
        require(key in fixture, f"{path}: missing {key}")
    expected = fixture["expected"]
    for key in [
        "trackPointCount",
        "gpxTrackPointCount",
        "segmentCount",
        *REQUIRED_FIXTURE_SUMMARY_FIELDS,
    ]:
        require(key in expected, f"{path}: expected missing {key}")
    source = expected.get("selectedElevationSource")
    if source is not None:
        require(source in ALLOWED_ELEVATION_SOURCES, f"{path}: invalid selectedElevationSource")
    track_points = expected.get("trackPoints")
    if track_points is not None:
        require(isinstance(track_points, list), f"{path}: expected.trackPoints must be an array")
        for index, point in enumerate(track_points):
            require(isinstance(point, dict), f"{path}: expected.trackPoints[{index}] must be object")
            for key in point:
                require(
                    key in {"sourceSampleId", "lat", "lng", "latTolerance", "lngTolerance"},
                    f"{path}: unsupported expected.trackPoints[{index}].{key}",
                )
    check_process_request(path, fixture["request"])


def check_product_snapshot_schema() -> None:
    schema = load_json(PRODUCT_SNAPSHOT_SCHEMA)
    require(
        schema.get("title") == "Track Core Product Snapshot",
        f"{PRODUCT_SNAPSHOT_SCHEMA}: unexpected title",
    )
    required = set(schema.get("required", []))
    for key in [
        "trackPoints",
        "totalDistanceMeters",
        "totalAscentMeters",
        "totalDescentMeters",
        "selectedElevationSource",
    ]:
        require(key in required, f"{PRODUCT_SNAPSHOT_SCHEMA}: required missing {key}")
    properties = schema.get("properties", {})
    require(
        set(properties.keys()) == required,
        f"{PRODUCT_SNAPSHOT_SCHEMA}: properties must match required fields",
    )
    point_ref = properties["trackPoints"]["items"].get("$ref")
    require(
        point_ref == "#/$defs/ProductTrackPoint",
        f"{PRODUCT_SNAPSHOT_SCHEMA}: trackPoints must use ProductTrackPoint",
    )
    point = schema.get("$defs", {}).get("ProductTrackPoint", {})
    point_required = set(point.get("required", []))
    require(
        "movingTimeDeltaSeconds" not in point_required,
        f"{PRODUCT_SNAPSHOT_SCHEMA}: ProductTrackPoint must not require movingTimeDeltaSeconds",
    )
    point_properties = set(point.get("properties", {}).keys())
    require(
        "movingTimeDeltaSeconds" not in point_properties,
        f"{PRODUCT_SNAPSHOT_SCHEMA}: ProductTrackPoint must not expose movingTimeDeltaSeconds",
    )


def check_product_snapshot_comparison_schema() -> None:
    schema = load_json(PRODUCT_SNAPSHOT_COMPARISON_SCHEMA)
    require(
        schema.get("title") == "Track Product Snapshot Comparison Report",
        f"{PRODUCT_SNAPSHOT_COMPARISON_SCHEMA}: unexpected title",
    )
    required = set(schema.get("required", []))
    for key in [
        "schemaVersion",
        "ok",
        "expectedPath",
        "actualPath",
        "metersTolerance",
        "issueCount",
        "issues",
    ]:
        require(key in required, f"{PRODUCT_SNAPSHOT_COMPARISON_SCHEMA}: required missing {key}")
    properties = set(schema.get("properties", {}).keys())
    require(
        required == properties,
        f"{PRODUCT_SNAPSHOT_COMPARISON_SCHEMA}: properties must match required fields",
    )
    issue = schema.get("$defs", {}).get("ComparisonIssue", {})
    require(
        set(issue.get("required", [])) == {"field", "message"},
        f"{PRODUCT_SNAPSHOT_COMPARISON_SCHEMA}: ComparisonIssue required fields changed",
    )


def check_manifest_schemas() -> None:
    apple_schema = load_json(APPLE_INTEGRATION_MANIFEST_SCHEMA)
    require(
        apple_schema.get("title") == "Track Apple Integration Manifest",
        f"{APPLE_INTEGRATION_MANIFEST_SCHEMA}: unexpected title",
    )
    for key in [
        "schemaVersion",
        "binaryTargetName",
        "xcframeworkRelativePath",
        "swiftTargetName",
        "swiftFiles",
        "requiredFfiSymbols",
        "requiredProductSnapshotFields",
        "forbiddenProductSnapshotFields",
        "watchHikingAppRecommendedPaths",
    ]:
        require(
            key in set(apple_schema.get("required", [])),
            f"{APPLE_INTEGRATION_MANIFEST_SCHEMA}: required missing {key}",
        )

    status_schema = load_json(VERIFICATION_STATUS_SCHEMA)
    require(
        status_schema.get("title") == "Track Rust Verification Status",
        f"{VERIFICATION_STATUS_SCHEMA}: unexpected title",
    )
    for key in [
        "schemaVersion",
        "verificationManifest",
        "completionReady",
        "productScope",
        "requiredTools",
        "optionalAppleTools",
        "missingRequiredTools",
        "missingOptionalAppleTools",
        "blockedReason",
        "alwaysRunGates",
        "alwaysRunGateCount",
        "rustToolchainGates",
        "rustToolchainGateCount",
        "rustToolchainGatesRunnable",
        "optionalAppleXcframeworkGateRunnable",
        "nextRequiredCommand",
        "nextOptionalAppleCommand",
        "completionCriteria",
    ]:
        require(
            key in set(status_schema.get("required", [])),
            f"{VERIFICATION_STATUS_SCHEMA}: required missing {key}",
        )

    verification_schema = load_json(VERIFICATION_MANIFEST_SCHEMA)
    require(
        verification_schema.get("title") == "Track Rust Verification Manifest",
        f"{VERIFICATION_MANIFEST_SCHEMA}: unexpected title",
    )
    for key in [
        "schemaVersion",
        "rustToolchainFile",
        "requiredTools",
        "optionalAppleTools",
        "appleTargets",
        "bootstrapCommand",
        "alwaysRunGates",
        "rustToolchainGates",
        "optionalAppleXcframeworkGate",
        "completionCriteria",
    ]:
        require(
            key in set(verification_schema.get("required", [])),
            f"{VERIFICATION_MANIFEST_SCHEMA}: required missing {key}",
        )


def check_ffi_and_apple_product_snapshot_contract() -> None:
    manifest = load_json(APPLE_INTEGRATION_MANIFEST)
    header = FFI_HEADER.read_text()
    ffi_smoke = FFI_SMOKE.read_text()
    bridge = SWIFT_BRIDGE.read_text()
    models = SWIFT_MODELS.read_text()
    streaming = SWIFT_STREAMING.read_text()
    apple_build_script = APPLE_BUILD_SCRIPT.read_text()
    apple_package_script = APPLE_PACKAGE_SCRIPT.read_text()
    apple_apply_script = APPLE_APPLY_SCRIPT.read_text()
    apple_validate_script = APPLE_VALIDATE_SCRIPT.read_text()
    rust_model = RUST_MODEL.read_text()
    rust_cli = RUST_CLI.read_text()
    require(
        manifest.get("schemaVersion") == "track-apple-integration-manifest-v1",
        f"{APPLE_INTEGRATION_MANIFEST}: invalid schemaVersion",
    )
    require(
        manifest.get("binaryTargetName") == "TrackCore",
        f"{APPLE_INTEGRATION_MANIFEST}: binaryTargetName must be TrackCore",
    )
    require(
        manifest.get("xcframeworkRelativePath") == "Vendor/TrackCore.xcframework",
        f"{APPLE_INTEGRATION_MANIFEST}: unexpected xcframeworkRelativePath",
    )
    require(
        set(manifest.get("swiftFiles", [])) == {
            "TrackCoreBridge.swift",
            "TrackCoreModels.swift",
            "TrackCoreStreamingEngine.swift",
        },
        f"{APPLE_INTEGRATION_MANIFEST}: swiftFiles must list bridge/model/streaming files",
    )
    required_symbols = set(manifest.get("requiredFfiSymbols", []))
    for symbol in [
        "track_process_json",
        "track_process_evidence_jsonl",
        "track_process_evidence_jsonl_product_snapshot",
        "track_free_string",
    ]:
        require(symbol in required_symbols, f"{APPLE_INTEGRATION_MANIFEST}: missing {symbol}")
        require(symbol in header, f"{FFI_HEADER}: missing {symbol}")
    require(
        set(manifest.get("requiredProductSnapshotFields", [])) == {
            "trackPoints",
            "totalDistanceMeters",
            "totalAscentMeters",
            "totalDescentMeters",
            "selectedElevationSource",
        },
        f"{APPLE_INTEGRATION_MANIFEST}: requiredProductSnapshotFields mismatch",
    )
    for field in ["movingTimeSeconds", "paceSecondsPerKm", "movingTimeDeltaSeconds"]:
        require(
            field in set(manifest.get("forbiddenProductSnapshotFields", [])),
            f"{APPLE_INTEGRATION_MANIFEST}: forbiddenProductSnapshotFields missing {field}",
        )
    require(
        "track_process_evidence_jsonl_product_snapshot" in header,
        f"{FFI_HEADER}: missing product snapshot FFI declaration",
    )
    require(
        "track_process_evidence_jsonl_product_snapshot" in ffi_smoke,
        f"{FFI_SMOKE}: missing product snapshot FFI smoke coverage",
    )
    require(
        "assert_product_snapshot" in ffi_smoke,
        f"{FFI_SMOKE}: missing product snapshot assertions",
    )
    require(
        "track_process_evidence_jsonl_product_snapshot" in bridge,
        f"{SWIFT_BRIDGE}: missing product snapshot FFI binding",
    )
    require(
        "processEvidenceJsonlProductSnapshotValue" in bridge,
        f"{SWIFT_BRIDGE}: missing typed product snapshot bridge method",
    )
    require(
        "processEvidenceJsonlProductSnapshot(" in streaming,
        f"{SWIFT_STREAMING}: streaming engine must emit lightweight product snapshots",
    )
    require(
        "TrackCoreProductSnapshot.decodeJson(responseJson)" in streaming,
        f"{SWIFT_STREAMING}: streaming snapshot must decode product snapshot JSON directly",
    )
    require(
        "CFBundleExecutable" in apple_build_script,
        f"{APPLE_BUILD_SCRIPT}: generated framework Info.plist must include CFBundleExecutable",
    )
    require(
        "validate_framework" in apple_build_script,
        f"{APPLE_BUILD_SCRIPT}: missing generated framework validation",
    )
    require(
        "track_process_evidence_jsonl_product_snapshot" in apple_build_script,
        f"{APPLE_BUILD_SCRIPT}: generated framework validation must check product snapshot FFI header",
    )
    require(
        "TrackCoreBridge.swift" in apple_package_script
        and "TrackCoreModels.swift" in apple_package_script
        and "TrackCoreStreamingEngine.swift" in apple_package_script,
        f"{APPLE_PACKAGE_SCRIPT}: integration package must include all Swift bridge files",
    )
    require(
        "integration-manifest.json" in apple_package_script,
        f"{APPLE_PACKAGE_SCRIPT}: integration package must include manifest",
    )
    require(
        "track_ffi.h" in apple_package_script,
        f"{APPLE_PACKAGE_SCRIPT}: integration package must include FFI header",
    )
    require(
        "TrackCore.xcframework" in apple_package_script,
        f"{APPLE_PACKAGE_SCRIPT}: integration package must include built xcframework when available",
    )
    require(
        "validate-watchos-integration-package.py" in apple_package_script,
        f"{APPLE_PACKAGE_SCRIPT}: integration package must run validator",
    )
    require(
        "validate-watchos-integration-package.py" in apple_apply_script,
        f"{APPLE_APPLY_SCRIPT}: apply script must run validator",
    )
    require(
        "TrackCoreIntegration" in apple_apply_script,
        f"{APPLE_APPLY_SCRIPT}: apply script must copy manifest into TrackCoreIntegration",
    )
    require(
        "Sources/HikingCore" in apple_apply_script,
        f"{APPLE_APPLY_SCRIPT}: apply script must copy Swift files into HikingCore",
    )
    require(
        "Vendor/TrackCore.xcframework" in apple_apply_script,
        f"{APPLE_APPLY_SCRIPT}: apply script must copy xcframework when packaged",
    )
    require(
        "track-apple-integration-manifest-v1" in apple_validate_script,
        f"{APPLE_VALIDATE_SCRIPT}: validator must check manifest schemaVersion",
    )
    require(
        "processEvidenceJsonlProductSnapshotValue" in apple_validate_script,
        f"{APPLE_VALIDATE_SCRIPT}: validator must check typed product snapshot API",
    )
    require(
        "forbiddenProductSnapshotFields" in apple_validate_script,
        f"{APPLE_VALIDATE_SCRIPT}: validator must check forbidden product fields",
    )
    require(
        "strip_app_prefix" in apple_validate_script,
        f"{APPLE_VALIDATE_SCRIPT}: validator must support watch-hiking-app path prefix",
    )
    require(
        "validate_package_swift_if_present" in apple_validate_script
        and "Package.swift" in apple_validate_script
        and ".binaryTarget(" in apple_validate_script,
        f"{APPLE_VALIDATE_SCRIPT}: validator must check Package.swift when present",
    )
    require(
        "struct TrackCoreProductTrackPoint" in models,
        f"{SWIFT_MODELS}: missing lightweight product track point",
    )
    require(
        "pub struct ProductSnapshot" in rust_model,
        f"{RUST_MODEL}: missing Rust product snapshot model",
    )
    require(
        "pub fn evidence_jsonl_to_process_request" in rust_model,
        f"{RUST_MODEL}: missing shared evidence JSONL parser",
    )
    require(
        "parses_neutral_evidence_jsonl_to_stable_process_request" in rust_model,
        f"{RUST_MODEL}: missing shared evidence JSONL parser unit test",
    )
    require(
        "track_model::evidence_jsonl_to_process_request(input)" in (ROOT / "crates/track-ffi/src/lib.rs").read_text(),
        f"{ROOT / 'crates/track-ffi/src/lib.rs'}: FFI must use shared evidence JSONL parser",
    )
    require(
        "pub struct ProductTrackPoint" in rust_model,
        f"{RUST_MODEL}: missing Rust lightweight product track point",
    )
    require(
        "product_snapshot_serializes_only_lightweight_product_fields" in rust_model,
        f"{RUST_MODEL}: missing lightweight product snapshot unit test",
    )
    product_point_start = models.find("struct TrackCoreProductTrackPoint")
    product_point_end = models.find("public enum TrackCoreJson", product_point_start)
    require(
        product_point_start >= 0 and product_point_end > product_point_start,
        f"{SWIFT_MODELS}: cannot locate product track point block",
    )
    product_point_block = models[product_point_start:product_point_end]
    require(
        "movingTimeDeltaSeconds" not in product_point_block,
        f"{SWIFT_MODELS}: product track point must not expose movingTimeDeltaSeconds",
    )
    rust_product_point_start = rust_model.find("pub struct ProductTrackPoint")
    rust_product_point_end = rust_model.find("impl From<&CleanedTrackPoint>", rust_product_point_start)
    require(
        rust_product_point_start >= 0 and rust_product_point_end > rust_product_point_start,
        f"{RUST_MODEL}: cannot locate product track point block",
    )
    rust_product_point_block = rust_model[rust_product_point_start:rust_product_point_end]
    require(
        "moving_time_delta_seconds" not in rust_product_point_block,
        f"{RUST_MODEL}: product track point must not expose moving_time_delta_seconds",
    )
    require(
        "process-product-snapshot" in rust_cli,
        f"{RUST_CLI}: missing process-product-snapshot CLI command",
    )
    require(
        "process-evidence-jsonl-product-snapshot" in rust_cli,
        f"{RUST_CLI}: missing evidence JSONL product snapshot CLI command",
    )
    require(
        "track_model::evidence_jsonl_to_process_request(&content)" in rust_cli,
        f"{RUST_CLI}: evidence JSONL CLI command must use shared parser",
    )
    require(
        "ProductSnapshot::from(&result)" in rust_cli,
        f"{RUST_CLI}: CLI product snapshot must use Rust product snapshot model",
    )


def check_watchos_product_snapshot_docs() -> None:
    doc = WATCH_STREAMING_DOC.read_text()
    require(
        "snapshot.decodeProductSnapshot()" in doc,
        f"{WATCH_STREAMING_DOC}: streaming guide must decode lightweight product snapshot",
    )
    require(
        "response.result?.productSnapshot" not in doc,
        f"{WATCH_STREAMING_DOC}: streaming guide must not require full response projection",
    )


def check_verification_manifest() -> None:
    manifest = load_json(VERIFICATION_MANIFEST)
    verify_script = VERIFY_SCRIPT.read_text()
    audit_script = AUDIT_SCRIPT.read_text()
    bootstrap_script = BOOTSTRAP_SCRIPT.read_text()
    apple_build_script = APPLE_BUILD_SCRIPT.read_text()
    workflow = GITHUB_WORKFLOW.read_text()
    toolchain = RUST_TOOLCHAIN.read_text()
    require(
        manifest.get("schemaVersion") == "track-rs-verification-manifest-v1",
        f"{VERIFICATION_MANIFEST}: invalid schemaVersion",
    )
    require(
        manifest.get("rustToolchainFile") == "rust-toolchain.toml",
        f"{VERIFICATION_MANIFEST}: rustToolchainFile must be rust-toolchain.toml",
    )
    require(
        manifest.get("bootstrapCommand") == "./scripts/bootstrap-rust-toolchain.sh",
        f"{VERIFICATION_MANIFEST}: unexpected bootstrapCommand",
    )
    require("rustup toolchain install stable" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must install stable")
    require("rustup target add" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must install Apple targets")
    require("verification-manifest.json" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must read verification manifest")
    require("${HOME}/.cargo/bin" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must add cargo bin to PATH")
    require("https://sh.rustup.rs" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must install rustup when missing")
    require("RUSTUP_INIT" in bootstrap_script, f"{BOOTSTRAP_SCRIPT}: must support offline rustup-init")
    require("${HOME}/.cargo/bin" in verify_script, f"{VERIFY_SCRIPT}: must add cargo bin to PATH")
    require(".cargo" in audit_script and "os.environ" in audit_script, f"{AUDIT_SCRIPT}: must inspect cargo bin PATH")
    require('channel = "stable"' in toolchain, f"{RUST_TOOLCHAIN}: channel must be stable")
    require('"rustfmt"' in toolchain, f"{RUST_TOOLCHAIN}: rustfmt component required")
    for source, content in [
        (RUST_TOOLCHAIN, toolchain),
        (VERIFICATION_MANIFEST, json.dumps(manifest)),
        (GITHUB_WORKFLOW, workflow),
        (APPLE_BUILD_SCRIPT, apple_build_script),
    ]:
        require(
            "arm64_32-apple-watchos" not in content,
            f"{source}: arm64_32 watchOS std is unavailable for this std-based Rust core",
        )
    for target in [
        "aarch64-apple-ios",
        "aarch64-apple-ios-sim",
        "aarch64-apple-watchos",
        "aarch64-apple-watchos-sim",
    ]:
        require(target in manifest.get("appleTargets", []), f"{VERIFICATION_MANIFEST}: missing target {target}")
        require(target in toolchain, f"{RUST_TOOLCHAIN}: missing target {target}")
        require(target in workflow, f"{GITHUB_WORKFLOW}: missing target {target}")
    for tool in ["cargo", "rustc", "rustfmt"]:
        require(tool in manifest.get("requiredTools", []), f"{VERIFICATION_MANIFEST}: missing required tool {tool}")
        require(f"command -v \"${{tool}}\"" in verify_script, f"{VERIFY_SCRIPT}: missing required tool loop")
    for gate in [
        "python3 scripts/check-static-contracts.py",
        "python3 scripts/audit-verification-status.py",
        "cd ../acceptance-web && npm test",
        "apple/package-watchos-integration.sh",
        "cargo fmt --all --check",
        "cargo test --workspace",
        "cargo run -p track-ffi --example smoke",
        "cargo run -p track-cli -- process-product-snapshot examples/minimal-stable-v1-input.json",
        "cargo run -p track-cli -- process-evidence-jsonl-product-snapshot examples/minimal-evidence-v1.jsonl",
        "cargo run -p track-cli -- verify-fixtures-json fixtures",
    ]:
        require(
            gate in manifest.get("alwaysRunGates", [])
            or gate in manifest.get("rustToolchainGates", [])
            or gate in verify_script,
            f"{VERIFICATION_MANIFEST}: missing gate {gate}",
        )
        require(gate in verify_script, f"{VERIFY_SCRIPT}: missing gate {gate}")
    require(
        "track-rs-verification-status-v1" in audit_script,
        f"{AUDIT_SCRIPT}: missing verification status schemaVersion",
    )
    require(
        "missingRequiredTools" in audit_script and "completionReady" in audit_script,
        f"{AUDIT_SCRIPT}: missing required status fields",
    )
    report = json.loads(__import__("subprocess").check_output(
        [sys.executable, str(AUDIT_SCRIPT)],
        cwd=str(ROOT),
        text=True,
    ))
    check_verification_status_report(report, "audit verification status")
    apple_gate = manifest.get("optionalAppleXcframeworkGate", {})
    require(
        apple_gate.get("env") == "VERIFY_APPLE_XCFRAMEWORK=1",
        f"{VERIFICATION_MANIFEST}: unexpected Apple xcframework env",
    )
    require(
        apple_gate.get("command") == "apple/build-track-core-xcframework.sh",
        f"{VERIFICATION_MANIFEST}: unexpected Apple xcframework command",
    )
    require(
        "VERIFY_APPLE_XCFRAMEWORK" in verify_script
        and "./apple/build-track-core-xcframework.sh" in verify_script,
        f"{VERIFY_SCRIPT}: missing optional Apple XCFramework gate",
    )
    require(
        "dtolnay/rust-toolchain@stable" in workflow,
        f"{GITHUB_WORKFLOW}: missing stable Rust toolchain setup",
    )
    require(
        "./scripts/verify-track-core.sh" in workflow,
        f"{GITHUB_WORKFLOW}: missing verify-track-core gate",
    )
    require(
        "acceptance-web/**" in workflow,
        f"{GITHUB_WORKFLOW}: workflow must run when acceptance-web strategy changes",
    )
    require(
        "VERIFY_APPLE_XCFRAMEWORK" in workflow,
        f"{GITHUB_WORKFLOW}: missing optional Apple XCFramework env",
    )
    require(
        len(manifest.get("completionCriteria", [])) >= 3,
        f"{VERIFICATION_MANIFEST}: completionCriteria too small",
    )


def check_verification_status_report(report: dict, source: str) -> None:
    allowed = {
        "schemaVersion",
        "verificationManifest",
        "completionReady",
        "productScope",
        "requiredTools",
        "optionalAppleTools",
        "missingRequiredTools",
        "missingOptionalAppleTools",
        "blockedReason",
        "alwaysRunGates",
        "alwaysRunGateCount",
        "rustToolchainGates",
        "rustToolchainGateCount",
        "rustToolchainGatesRunnable",
        "optionalAppleXcframeworkGateRunnable",
        "nextRequiredCommand",
        "nextOptionalAppleCommand",
        "bootstrapCommand",
        "completionCriteria",
    }
    require(set(report.keys()) == allowed, f"{source}: unexpected fields")
    require(
        report["schemaVersion"] == "track-rs-verification-status-v1",
        f"{source}: invalid schemaVersion",
    )
    require(
        report["productScope"] == {
            "trackPoints": True,
            "totalDistanceMeters": True,
            "totalAscentMeters": True,
            "totalDescentMeters": True,
            "movingTimeSeconds": False,
            "paceSecondsPerKm": False,
        },
        f"{source}: productScope mismatch",
    )
    for key in ["requiredTools", "optionalAppleTools"]:
        require(isinstance(report[key], dict), f"{source}: {key} must be object")
        for tool, status in report[key].items():
            require(isinstance(tool, str) and tool, f"{source}: invalid tool key")
            require(isinstance(status, dict), f"{source}: tool status must be object")
            require(isinstance(status.get("available"), bool), f"{source}: tool available must be boolean")
            require(
                status.get("path") is None or isinstance(status.get("path"), str),
                f"{source}: tool path must be string or null",
            )
    missing_required = [
        tool for tool, status in report["requiredTools"].items() if not status["available"]
    ]
    require(
        report["missingRequiredTools"] == missing_required,
        f"{source}: missingRequiredTools mismatch",
    )
    if missing_required:
        require(
            isinstance(report["blockedReason"], str)
            and all(tool in report["blockedReason"] for tool in missing_required),
            f"{source}: blockedReason must name missing required tools",
        )
    else:
        require(report["blockedReason"] is None, f"{source}: blockedReason must be null")
    require(
        report["alwaysRunGateCount"] == len(report["alwaysRunGates"]),
        f"{source}: alwaysRunGateCount mismatch",
    )
    require(
        report["rustToolchainGateCount"] == len(report["rustToolchainGates"]),
        f"{source}: rustToolchainGateCount mismatch",
    )
    require(
        report["rustToolchainGatesRunnable"] == (len(missing_required) == 0),
        f"{source}: rustToolchainGatesRunnable mismatch",
    )
    require(
        report["completionReady"] == report["rustToolchainGatesRunnable"],
        f"{source}: completionReady mismatch",
    )
    require(
        report["bootstrapCommand"] == "./scripts/bootstrap-rust-toolchain.sh",
        f"{source}: bootstrapCommand mismatch",
    )


def check_jsonl(path: Path) -> None:
    event_count = 0
    for line_index, line in enumerate(path.read_text().splitlines(), start=1):
        trimmed = line.strip()
        if not trimmed:
            continue
        try:
            event = json.loads(trimmed)
        except Exception as exc:
            fail(f"{path}: invalid JSONL at line {line_index}: {exc}")
        require(isinstance(event, dict), f"{path}: line {line_index} must be object")
        require(
            event.get("schemaVersion") == "outdoor-track-evidence-v1",
            f"{path}: line {line_index} must use outdoor-track-evidence-v1",
        )
        require(isinstance(event.get("event"), str), f"{path}: line {line_index} missing event")
        event_count += 1
    require(event_count > 0, f"{path}: must contain at least one event")


def check_product_snapshot(path: Path) -> None:
    snapshot = load_json(path)
    allowed = {
        "trackPoints",
        "totalDistanceMeters",
        "totalAscentMeters",
        "totalDescentMeters",
        "selectedElevationSource",
    }
    require(set(snapshot.keys()) == allowed, f"{path}: unexpected product snapshot fields")
    require(isinstance(snapshot["trackPoints"], list), f"{path}: trackPoints must be an array")
    for key in ["totalDistanceMeters", "totalAscentMeters", "totalDescentMeters"]:
        require(isinstance(snapshot[key], (int, float)), f"{path}: {key} must be numeric")
        require(snapshot[key] >= 0, f"{path}: {key} must be non-negative")
    require(
        snapshot["selectedElevationSource"] in ALLOWED_ELEVATION_SOURCES,
        f"{path}: invalid selectedElevationSource",
    )
    for index, point in enumerate(snapshot["trackPoints"]):
        require(isinstance(point, dict), f"{path}: trackPoints[{index}] must be object")
        allowed_point_keys = {
            "trackPointId",
            "sourceSampleId",
            "lat",
            "lng",
            "trackDirectionDegrees",
            "fixElapsedRealtimeNanos",
            "wallTimeMillis",
            "horizontalAccuracyMeters",
            "distanceDeltaMeters",
            "segmentId",
        }
        for key in point:
            require(
                key in allowed_point_keys,
                f"{path}: product snapshot trackPoints[{index}] has unsupported {key}",
            )
        for key in [
            "trackPointId",
            "sourceSampleId",
            "lat",
            "lng",
            "fixElapsedRealtimeNanos",
            "wallTimeMillis",
            "horizontalAccuracyMeters",
            "distanceDeltaMeters",
            "segmentId",
        ]:
            require(key in point, f"{path}: trackPoints[{index}] missing {key}")
        require(
            "movingTimeDeltaSeconds" not in point,
            f"{path}: product snapshot trackPoints[{index}] must not include movingTimeDeltaSeconds",
        )
        for legacy_key in ["sourceRawPointId", "latitude", "longitude", "elapsedRealtimeNanos"]:
            require(legacy_key not in point, f"{path}: trackPoints[{index}] uses {legacy_key}")


def compare_number(
    expected,
    actual,
    key: str,
    tolerance: float = DEFAULT_METERS_TOLERANCE,
) -> Optional[dict]:
    diff = abs(float(expected[key]) - float(actual[key]))
    if diff <= tolerance:
        return None
    return {
        "field": key,
        "expected": expected[key],
        "actual": actual[key],
        "diff": diff,
        "tolerance": tolerance,
        "message": f"{key} differs by {diff:.6f}, tolerance={tolerance}",
    }


def product_snapshot_comparison_report(
    expected_path: Path,
    actual_path: Path,
    meters_tolerance: float = DEFAULT_METERS_TOLERANCE,
) -> dict:
    check_product_snapshot(expected_path)
    check_product_snapshot(actual_path)
    expected = load_json(expected_path)
    actual = load_json(actual_path)
    issues = []
    for key in ["totalDistanceMeters", "totalAscentMeters", "totalDescentMeters"]:
        issue = compare_number(expected, actual, key, meters_tolerance)
        if issue is not None:
            issues.append(issue)
    if expected["selectedElevationSource"] != actual["selectedElevationSource"]:
        issues.append({
            "field": "selectedElevationSource",
            "expected": expected["selectedElevationSource"],
            "actual": actual["selectedElevationSource"],
            "message": "selectedElevationSource differs: "
            f"expected={expected['selectedElevationSource']} "
            f"actual={actual['selectedElevationSource']}",
        })
    if len(expected["trackPoints"]) != len(actual["trackPoints"]):
        issues.append({
            "field": "trackPoints.length",
            "expected": len(expected["trackPoints"]),
            "actual": len(actual["trackPoints"]),
            "message": "track point count differs: "
            f"expected={len(expected['trackPoints'])} actual={len(actual['trackPoints'])}",
        })
    expected_ids = [point["sourceSampleId"] for point in expected["trackPoints"]]
    actual_ids = [point["sourceSampleId"] for point in actual["trackPoints"]]
    if expected_ids != actual_ids:
        issues.append({
            "field": "trackPoints.sourceSampleId",
            "expected": expected_ids,
            "actual": actual_ids,
            "message": f"sourceSampleId sequence differs: expected={expected_ids} actual={actual_ids}",
        })
    return {
        "schemaVersion": "track-product-snapshot-comparison-v1",
        "ok": len(issues) == 0,
        "expectedPath": str(expected_path),
        "actualPath": str(actual_path),
        "metersTolerance": meters_tolerance,
        "issueCount": len(issues),
        "issues": issues,
    }


def check_product_snapshot_comparison_report(report: dict, source: str) -> None:
    allowed = {
        "schemaVersion",
        "ok",
        "expectedPath",
        "actualPath",
        "metersTolerance",
        "issueCount",
        "issues",
    }
    require(set(report.keys()) == allowed, f"{source}: unexpected comparison report fields")
    require(
        report["schemaVersion"] == "track-product-snapshot-comparison-v1",
        f"{source}: invalid comparison schemaVersion",
    )
    require(isinstance(report["ok"], bool), f"{source}: ok must be boolean")
    require(isinstance(report["expectedPath"], str) and report["expectedPath"], f"{source}: expectedPath required")
    require(isinstance(report["actualPath"], str) and report["actualPath"], f"{source}: actualPath required")
    require(isinstance(report["metersTolerance"], (int, float)), f"{source}: metersTolerance must be numeric")
    require(report["metersTolerance"] >= 0, f"{source}: metersTolerance must be non-negative")
    require(isinstance(report["issueCount"], int), f"{source}: issueCount must be integer")
    require(isinstance(report["issues"], list), f"{source}: issues must be array")
    require(report["issueCount"] == len(report["issues"]), f"{source}: issueCount mismatch")
    require(report["ok"] == (report["issueCount"] == 0), f"{source}: ok must match issueCount")
    for index, issue in enumerate(report["issues"]):
        require(isinstance(issue, dict), f"{source}: issues[{index}] must be object")
        require("field" in issue and isinstance(issue["field"], str), f"{source}: issues[{index}] missing field")
        require("message" in issue and isinstance(issue["message"], str), f"{source}: issues[{index}] missing message")
        allowed_issue = {"field", "expected", "actual", "diff", "tolerance", "message"}
        for key in issue:
            require(key in allowed_issue, f"{source}: issues[{index}] unsupported {key}")


def compare_product_snapshots(
    expected_path: Path,
    actual_path: Path,
    meters_tolerance: float = DEFAULT_METERS_TOLERANCE,
) -> None:
    report = product_snapshot_comparison_report(expected_path, actual_path, meters_tolerance)
    if report["ok"]:
        return
    fail("; ".join(issue["message"] for issue in report["issues"]))


def check_all() -> None:
    check_product_snapshot_schema()
    check_product_snapshot_comparison_schema()
    check_manifest_schemas()
    check_product_snapshot(PRODUCT_SNAPSHOT_EXAMPLE)
    check_product_snapshot_comparison_report(
        product_snapshot_comparison_report(PRODUCT_SNAPSHOT_EXAMPLE, PRODUCT_SNAPSHOT_EXAMPLE),
        "product snapshot self comparison",
    )
    check_jsonl(MINIMAL_EVIDENCE_JSONL)
    check_ffi_and_apple_product_snapshot_contract()
    check_watchos_product_snapshot_docs()
    check_verification_manifest()
    for path in sorted((ROOT / "fixtures").glob("*.json")):
        check_fixture(path)
    check_process_request(
        ROOT / "examples/minimal-stable-v1-input.json",
        load_json(ROOT / "examples/minimal-stable-v1-input.json"),
    )
    print("static contract checks passed")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        check_all()
        return
    if len(args) == 2 and args[0] == "--product-snapshot":
        check_product_snapshot(Path(args[1]))
        print("product snapshot contract checks passed")
        return
    if len(args) == 3 and args[0] == "--compare-product-snapshot":
        compare_product_snapshots(Path(args[1]), Path(args[2]))
        print("product snapshot comparison passed")
        return
    if (
        len(args) == 5
        and args[0] == "--compare-product-snapshot"
        and args[3] == "--meters-tolerance"
    ):
        try:
            meters_tolerance = float(args[4])
        except ValueError:
            fail(f"invalid --meters-tolerance value: {args[4]}")
        require(meters_tolerance >= 0, "--meters-tolerance must be non-negative")
        compare_product_snapshots(Path(args[1]), Path(args[2]), meters_tolerance)
        print("product snapshot comparison passed")
        return
    if len(args) == 3 and args[0] == "--compare-product-snapshot-json":
        report = product_snapshot_comparison_report(Path(args[1]), Path(args[2]))
        check_product_snapshot_comparison_report(report, "product snapshot comparison")
        print(json.dumps(report, indent=2, sort_keys=True))
        sys.exit(0 if report["ok"] else 1)
    if (
        len(args) == 5
        and args[0] == "--compare-product-snapshot-json"
        and args[3] == "--meters-tolerance"
    ):
        try:
            meters_tolerance = float(args[4])
        except ValueError:
            fail(f"invalid --meters-tolerance value: {args[4]}")
        require(meters_tolerance >= 0, "--meters-tolerance must be non-negative")
        report = product_snapshot_comparison_report(
            Path(args[1]),
            Path(args[2]),
            meters_tolerance,
        )
        check_product_snapshot_comparison_report(report, "product snapshot comparison")
        print(json.dumps(report, indent=2, sort_keys=True))
        sys.exit(0 if report["ok"] else 1)
    fail(
        "usage: check-static-contracts.py "
        "[--product-snapshot <path> | "
        "--compare-product-snapshot <expected> <actual> [--meters-tolerance <meters>] | "
        "--compare-product-snapshot-json <expected> <actual> [--meters-tolerance <meters>]]"
    )


if __name__ == "__main__":
    main()
