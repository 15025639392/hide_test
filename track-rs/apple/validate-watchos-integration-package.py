#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"watchOS integration validation failed: {message}", file=sys.stderr)
    sys.exit(1)


def read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        fail(f"{path}: invalid JSON: {exc}")


def require_file(path: Path) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        fail(f"missing or empty file: {path}")


def find_layout(root: Path):
    packaged_manifest = root / "integration-manifest.json"
    if packaged_manifest.is_file():
        return {
            "manifest": packaged_manifest,
            "swift_dir": root / "swift",
            "header": root / "include/track_ffi.h",
            "xcframework": root / "Vendor/TrackCore.xcframework",
            "requires_header": True,
            "kind": "package",
        }

    app_manifest = root / "TrackCoreIntegration" / "integration-manifest.json"
    if app_manifest.is_file():
        manifest = read_json(app_manifest)
        paths = manifest.get("watchHikingAppRecommendedPaths", {})
        swift_path = strip_app_prefix(paths.get("swiftFilesDirectory", "Sources/HikingCore"))
        xcframework_path = strip_app_prefix(paths.get("xcframework", "Vendor/TrackCore.xcframework"))
        return {
            "manifest": app_manifest,
            "swift_dir": root / swift_path,
            "header": root / "Vendor/TrackCore.xcframework/Headers/track_ffi.h",
            "xcframework": root / xcframework_path,
            "requires_header": False,
            "kind": "app",
        }

    fail(f"{root}: cannot find integration-manifest.json")


def strip_app_prefix(path: str) -> str:
    prefix = "watch-hiking-app/"
    if path.startswith(prefix):
        return path[len(prefix):]
    return path


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate-watchos-integration-package.py <package-or-watch-app-root>")

    root = Path(sys.argv[1]).resolve()
    layout = find_layout(root)
    manifest_path = layout["manifest"]
    manifest = read_json(manifest_path)

    if manifest.get("schemaVersion") != "track-apple-integration-manifest-v1":
        fail(f"{manifest_path}: invalid schemaVersion")
    if manifest.get("binaryTargetName") != "TrackCore":
        fail(f"{manifest_path}: binaryTargetName must be TrackCore")

    swift_dir = layout["swift_dir"]
    for filename in manifest.get("swiftFiles", []):
        path = swift_dir / filename
        require_file(path)

    bridge = (swift_dir / "TrackCoreBridge.swift").read_text()
    models = (swift_dir / "TrackCoreModels.swift").read_text()
    streaming = (swift_dir / "TrackCoreStreamingEngine.swift").read_text()

    for symbol in manifest.get("requiredFfiSymbols", []):
        if symbol not in bridge and symbol != "track_free_string":
            fail(f"Swift bridge missing FFI symbol binding: {symbol}")
    if "processEvidenceJsonlProductSnapshotValue" not in bridge:
        fail("Swift bridge missing typed product snapshot API")
    if "TrackCoreProductSnapshot" not in models:
        fail("Swift models missing TrackCoreProductSnapshot")
    if "decodeProductSnapshot()" not in streaming:
        fail("Streaming engine missing decodeProductSnapshot()")
    if "processEvidenceJsonlProductSnapshot(" not in streaming:
        fail("Streaming engine must emit lightweight product snapshots")

    for field in manifest.get("forbiddenProductSnapshotFields", []):
        product_point_start = models.find("struct TrackCoreProductTrackPoint")
        product_point_end = models.find("public enum TrackCoreJson", product_point_start)
        if product_point_start < 0 or product_point_end <= product_point_start:
            fail("Swift models missing TrackCoreProductTrackPoint block")
        product_point_block = models[product_point_start:product_point_end]
        if field in product_point_block:
            fail(f"Product track point exposes forbidden field: {field}")

    header = layout["header"]
    if header.is_file():
        header_text = header.read_text()
        for symbol in manifest.get("requiredFfiSymbols", []):
            if symbol not in header_text:
                fail(f"FFI header missing symbol: {symbol}")
    else:
        xcframework = layout["xcframework"]
        if layout["requires_header"]:
            fail(f"missing FFI header or xcframework: {header}")

    if layout["kind"] == "app":
        validate_package_swift_if_present(root, manifest)

    print(f"watchOS integration validation passed: {root}")


def validate_package_swift_if_present(root: Path, manifest: dict) -> None:
    package_swift = root / "Package.swift"
    if not package_swift.is_file():
        return

    content = package_swift.read_text()
    binary_target_name = manifest["binaryTargetName"]
    xcframework_path = manifest["xcframeworkRelativePath"]
    swift_target_name = manifest.get("swiftTargetName", "HikingCore")

    required_snippets = [
        ".binaryTarget(",
        f'name: "{binary_target_name}"',
        f'path: "{xcframework_path}"',
        f'name: "{swift_target_name}"',
        f'dependencies: ["{binary_target_name}"]',
    ]
    for snippet in required_snippets:
        if snippet not in content:
            fail(f"{package_swift}: missing SwiftPM TrackCore snippet: {snippet}")


if __name__ == "__main__":
    main()
