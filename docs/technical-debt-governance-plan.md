# Technical Debt Governance Plan

This document is written as an execution guide for AI agents working on this
project. Follow it in order. Do not skip validation, and do not mix strategy
changes with structural cleanup unless a task explicitly says so.

## Current Architecture Baseline

The current project is an Android Java app for system GNSS hiking track
recording.

Authoritative recording chain:

```text
RecordingForegroundService
  -> LocationManager.GPS_PROVIDER
  -> RawPoint / raw_location / optional GNSS diagnostics / evidence.jsonl
  -> SamplingEpoch / SamplingIntake
  -> TrackTrustEngine / TrackCloudWindow
  -> TrackPoint / session.json
  -> track.gpx / partial.gpx
  -> replay fixtures（回放样本） / reports
```

Key files:

| Area | File |
| --- | --- |
| UI and map shell | `app/src/main/java/com/example/gnsssatdemo/MainActivity.java` |
| Foreground recording | `app/src/main/java/com/example/gnsssatdemo/RecordingForegroundService.java` |
| Sampling state | `app/src/main/java/com/example/gnsssatdemo/RecordingSamplingState.java` |
| Session orchestration | `app/src/main/java/com/example/gnsssatdemo/track/engine/BasicTrackSession.java` |
| Sampling intake | `app/src/main/java/com/example/gnsssatdemo/track/engine/SamplingIntake.java` |
| Cloud window | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackCloudWindow.java` |
| Trust engine | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustEngine.java` |
| Strategy thresholds | `app/src/main/java/com/example/gnsssatdemo/track/engine/TrackTrustConfig.java` |
| Replay policy runner | `app/src/main/java/com/example/gnsssatdemo/track/replay/ReplayRunner.java` |
| Session files | `app/src/main/java/com/example/gnsssatdemo/track/export/SessionFileStore.java` |
| GPX export | `app/src/main/java/com/example/gnsssatdemo/track/export/GpxExporter.java` |

## Non-Negotiable Invariants

Preserve these unless the user explicitly asks for a strategy change:

- Trusted tracks only use `LocationManager.GPS_PROVIDER`.
- Every system `Location` is first represented as a `RawPoint`.
- Rejected and weak points remain diagnostic evidence.
- Trusted `TrackPoint` entries are only created from accepted or anchor
  decisions.
- Weak points do not contribute to trusted distance or moving time.
- `gap_recovery` is emitted only after `RECOVERY_CLOUD` is stable; it starts a
  new internal segment and has zero distance and moving-time delta.
- Transport mode does not contribute to hiking distance.
- Paused, recovery-pending, and transport-cloud points do not contribute to hiking distance, and recovery points are not backfilled after stability is confirmed.
- Trusted GPX contains only `anchor` and `accept` TrackPoints.
- `elapsedRealtimeNanos` remains the internal continuity clock.
- Sampling continuity must be attributable to the active sampling request or
  policy epoch; callback receive time is diagnostic evidence, not the continuity
  clock for trusted trajectory decisions.
- Replay must reproduce the same policy semantics as real recording.

## Strategy Version Baseline

Current strategy version:

```text
stage2-track-trust-v3-sampling-cloud
```

Baseline behavior:

| Scenario | Expected result |
| --- | --- |
| First fix accuracy <= 20m | `anchor / first_fix_good` |
| First fix 20m < accuracy <= 30m | `anchor / first_fix_relaxed` |
| First fix accuracy > 30m and <= 80m | `weak / weak_signal_stage2` |
| Accuracy > 80m | intake reject `accuracy_too_large` |
| Implied speed > 12m/s | `weak / weak_signal_stage2` |
| Gap > 120s | `weak / recovery_cloud_pending` until RECOVERY_CLOUD is stable |
| Sustained vehicle-like movement | `accept / transport_suspected_kept`, keep continuity and mark risk |
| Stable walking after transport | `accept / gap_recovery`, zero delta, new segment |
| Stable stationary cloud with recent still-motion evidence | `anchor / stationary_anchor` |
| Stationary cloud without still-motion evidence, before stability, or paused keepalive near the anchor | `reject / stationary_cloud_jitter` |
| Paused or boundary recovery pending | `weak / recovery_cloud_pending` until cloud stability |
| Paused keepalive near anchor | `reject / stationary_cloud_jitter` |
| Recovery cloud still near anchor | `reject / recovery_cloud_pending` |
| Recovery cloud before stability confirmation | `reject / recovery_cloud_pending` |
| Confirmed movement after recovery cloud | `accept / gap_recovery`, zero delta, new segment |
| Small movement below noise floor without still-motion evidence | `reject / stationary_cloud_jitter` |
| Normal movement | `accept / moving_good_fix` |

## Replay Fixture Catalog

Replay fixture 指“回放样本”：一组固定 JSONL 输入，用来离线重放轨迹策略，
确认策略改动前后的判点结果是否符合预期。

Fixtures live in:

```text
app/src/test/resources/replay-fixtures
```

| Category | Fixture | Purpose |
| --- | --- | --- |
| Normal | `good_walk.jsonl` | Nominal accepted hiking movement |
| Weak signal | `weak_signal_stage2.jsonl` | Moving weak accuracy points |
| Weak start | `weak_start_cloud.jsonl` | Weak first cloud remains diagnostic |
| Validation reject | `validation_rejects.jsonl` | Hard validator rejects |
| Speed reject | `weak_signal_stage2.jsonl` | Implausible jump filtering |
| Stationary | `stationary_filter.jsonl` | Nearby stationary fixes remain non-trusted jitter after stationary-cloud checks |
| Stationary | `stationary_recovery_after_gap.jsonl` | Static long-gap recovery stays in recovery/stationary cloud semantics |
| Stationary | `stationary_recovery_with_motion.jsonl` | Still motion evidence keeps nearby drift in the stationary or recovery cloud |
| Gap | `gap_recovery_after_stationary_gap.jsonl` | Long-gap recovery outside stationary noise remains `gap_recovery` |
| Transport | `transport_mode.jsonl` | Vehicle-like movement isolation and recovery |
| Invalid input | `malformed_line.jsonl` | Malformed JSON handling |
| Invalid input | `truncated_json_line.jsonl` | Truncated JSON handling |
| Invalid input | `missing_session_metadata.jsonl` | Missing metadata handling |
| Invalid input | `no_raw_location_events.jsonl` | Empty replay behavior |

When a policy change alters expected replay output, update the fixture
（回放样本） and the corresponding test in the same change.

## Required Validation

Before and after non-documentation changes, run the available test command.

Preferred:

```bash
source scripts/use-jdk17.sh
./gradlew testDebugUnitTest
```

If the local shell already has Java 17 available, the `source` line can be
omitted. If `./gradlew` is not present, generate the wrapper from an available
Gradle installation before continuing.

For replay-specific changes, also run:

```bash
source scripts/use-jdk17.sh
./gradlew :app:runReplay
```

If neither command can run in the local environment, report the reason clearly.

## Change Checklist

For every governance step, answer these before editing:

- Does this change alter `decisionResult`?
- Does this change alter `decisionReason`?
- Does this change alter `TrackPoint` count?
- Does this change alter `segmentId`?
- Does this change alter `totalDistanceMeters`?
- Does this change alter `movingTimeSeconds`?
- Does this change alter trusted GPX output?
- Does this change alter `partial.gpx` output?
- Does this change alter `evidence.jsonl` schema?
- Does this change affect old session reading?
- Does replay need a fixture（回放样本） update?

If the intended task is structural cleanup, all answers should usually be "no".

## Governance Phases

### Phase 1: Documentation Safety Net

Goal: make current strategy and replay expectations explicit before code
cleanup.

Tasks:

1. Create this governance document.
2. Ensure `docs/system-gnss-track-recording-plan.md` names the current strategy
   version and points to this governance plan.
3. Ensure replay fixture（回放样本） categories are documented here.

Allowed changes:

- Documentation only.

Not allowed:

- Java source changes.
- Fixture changes.
- Strategy threshold changes.

Validation:

- No unit test run is required for documentation-only edits.
- Run `git diff -- docs` to verify only intended docs changed.

Completion criteria:

- This document exists.
- The system GNSS plan links to this document.
- Replay fixtures（回放样本） are cataloged.

### Phase 2: Shared Track Decision State

Goal: remove duplicated transport-mode decision semantics from real recording
and replay.

Problem:

```text
BasicTrackSession.decideWhileInTransportMode
ReplayRunner.decideWhileInTransportMode
```

These implementations must not drift.

Target shape:

```text
TrackTrustEngine
  - owns transport-mode state
  - calls TrackTrustEngine
  - returns TrackTrustDecision
  - exposes state changes needed by BasicTrackSession
  - can be reused by ReplayRunner
```

Allowed changes:

- Add a new engine-layer coordinator.
- Update `BasicTrackSession` and `ReplayRunner` to use it.
- Add focused unit tests if needed.

Not allowed:

- Changing thresholds.
- Renaming decision reasons.
- Changing fixture（回放样本） expectations.
- Changing GPX schema.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

Completion criteria:

- Transport-mode logic exists in one shared implementation.
- Existing replay fixtures（回放样本） pass unchanged.

### Phase 3: Split BasicTrackSession Responsibilities

Goal: turn `BasicTrackSession` into a thinner orchestrator.

Suggested extraction order:

1. `GnssSnapshotBuffer`
2. `TrackStatsAccumulator`
3. `SessionJournalWriter`
4. `SessionLifecycleState`

Rules:

- Extract one responsibility per change.
- Preserve public behavior.
- Preserve diagnostic event fields.
- Preserve trusted and partial GPX output.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

Completion criteria:

- `BasicTrackSession` delegates the extracted responsibility.
- Tests and replay pass.

### Phase 4: Split MainActivity Responsibilities

Goal: reduce UI coupling without changing track policy.

Suggested extraction order:

1. `RecordingServiceController`
2. `RecordingStatusMapper`
3. `HistorySessionController`
4. `TrackMapState`
5. `SatelliteTileLoader`

Rules:

- Do not modify decision policy.
- Do not modify GPX export.
- Keep UI behavior equivalent.

Validation:

```bash
gradle testDebugUnitTest
```

Manual smoke checks on device/emulator are recommended for this phase.

### Phase 5: Strategy Configuration Object

Goal: give thresholds a single source of truth while preserving default
behavior.

Target shape:

```text
TrackTrustConfig.defaultV3()
```

Use the config from:

- `SamplingIntake`
- `TrackTrustEngine`
- `BasicTrackSession.appendConfigSnapshot`
- `ReplayRunner`

Rules:

- Default values must match the published compatibility thresholds used by
  `stage2-track-trust-v3-sampling-cloud`.
- Do not add runtime settings in this phase.
- Do not change fixture（回放样本） expectations.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 6: Optional Weak GNSS Diagnostics

Goal: improve Android-side explainability, when enabled, without changing
trusted track policy or Web target-product decisions.

Candidate fields:

- `allAvgCn0`
- `top4AvgCn0`
- `lowCn0VisibleCount`
- `weakUsedCount`
- constellation visible counts
- `hasDualFrequency`

Rules:

- GNSS quality remains optional diagnostic only.
- GNSS quality is not a Web target-product cleaning input.
- Do not make C/N0 or satellite count a hard reject rule in this phase.
- Keep old session reading backward compatible.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 7: Diagnostic Schema Hardening

Goal: make diagnostic events easier for tools and AI agents to consume without
breaking old sessions.

Suggested extraction order:

1. Document stable diagnostic JSONL fields.
2. Centralize `gnss_snapshot` field names and event construction.
3. Add focused compatibility tests for new and old diagnostic shapes.

Rules:

- Readers must tolerate missing optional diagnostic fields.
- Readers must tolerate extra diagnostic fields.
- Do not change replay expectations.
- Do not make diagnostic GNSS quality fields part of policy decisions.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 8: Optional Sample Report GNSS Explainability

Goal: make Phase 6 GNSS diagnostic metrics visible in generated sample reports,
when present, without changing trusted track policy or Web target-product
decisions.

Suggested extraction order:

1. Accumulate optional Phase 6 `gnss_snapshot` metrics in
   `HikingSampleReportGenerator`.
2. Add report JSON and text output for GNSS quality explainability.
3. Add compatibility tests for old `gnss_snapshot` events that do not contain
   Phase 6 fields.

Rules:

- Missing Phase 6 fields must not fail report generation.
- GNSS quality metrics remain optional and explanatory only.
- Target algorithms must not depend on these fields.
- Do not alter decision, distance, moving-time, segment, GPX, or replay
  expectations.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 9: Optional Weak/Reject GNSS Correlation In Reports

Goal: make generated sample reports explain weak and rejected decisions with
their linked GNSS snapshot metrics when those optional diagnostics exist,
without changing trusted track policy or Web target-product decisions.

Suggested extraction order:

1. If legacy or optional `decision.sourceGnssSnapshotId` exists, correlate it
   with Phase 6 `gnss_snapshot` metrics inside `HikingSampleReportGenerator`.
2. Add report JSON and text output for weak/reject decision GNSS averages.
3. Add compatibility tests for decisions without `sourceGnssSnapshotId` and old
   `gnss_snapshot` events that do not contain Phase 6 fields.

Rules:

- Missing `sourceGnssSnapshotId` is normal when optional GNSS diagnostics are
  disabled and must not fail report generation.
- Missing Phase 6 fields must not fail report generation.
- GNSS quality metrics remain optional and explanatory only.
- Do not alter decision, distance, moving-time, segment, GPX, or replay
  expectations.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 10: Optional Standalone Weak GNSS Report

Goal: create an offline weak GNSS report, when optional diagnostics are present,
that can help explain weak, rejected, GAP, or stale-GNSS evidence without
changing trusted track policy or Web target-product decisions.

Suggested extraction order:

1. Add `WeakGnssReportGenerator` that reads `session.json` and
   `evidence.jsonl` through `SessionManifest`.
2. Add `WeakGnssReport` JSON and text output for weak/reject/GAP/no-location
   evidence.
3. Add compatibility tests for old `gnss_snapshot` events that do not contain
   Phase 6 fields.

Rules:

- Missing Phase 6 fields must not fail report generation.
- Missing `sourceGnssSnapshotId` is normal when optional GNSS diagnostics are
  disabled; reports may mention it as an explainability gap, not a policy
  failure.
- The standalone report remains diagnostic/export only.
- Do not alter decision, distance, moving-time, segment, GPX, or replay
  expectations.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

### Phase 11: Export UI and Device Report Usability

Goal: make history export operations usable on narrow real-device screens and
make the weak GNSS report easy to retrieve during device validation.

Suggested extraction order:

1. Split per-session export actions into stable track/diagnostic and report rows.
2. Rename weak GNSS report actions so they are self-explanatory in the UI.
3. Persist weak GNSS report text and JSON into each session `export/` directory
   before launching the system document export flow.

Rules:

- Keep report generation diagnostic/export only.
- Do not alter decision, distance, moving-time, segment, GPX, or replay
  expectations.
- The system document export flow should remain available for user-selected
  destinations.

Validation:

```bash
gradle testDebugUnitTest
gradle :app:runReplay
```

## Stop Conditions

Stop and report instead of continuing if:

- A user change conflicts with the target files.
- A structural cleanup changes replay output unexpectedly.
- Tests fail and the failure is not directly understood.
- A task requires changing the trusted track policy.
- Old session compatibility would be broken.

## Current Execution Cursor

Completed:

- Phase 1 / Task 1: create this governance document.
- Phase 1 / Task 2: link this governance plan from the system GNSS plan.
- Phase 1 / Task 3: catalog replay fixture（回放样本） categories.
- Phase 2 implementation has introduced a shared `TrackTrustEngine`.
- Phase 2 validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 3 / Task 1: extracted `GnssSnapshotBuffer`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 3 / Task 2: extracted `TrackStatsAccumulator`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 3 / Task 3: extracted `SessionJournalWriter`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 3 / Task 4: extracted `SessionLifecycleState`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 4 / Task 1: extracted `RecordingServiceController`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 4 / Task 2: extracted `RecordingStatusMapper`; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 4 / Task 3: extracted `HistorySessionController` for scan and
  selection reconciliation; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 4 / Task 4: extracted `TrackMapState` for current map point, accuracy,
  heading, distance, and ascent calculation; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 4 / Task 5: extracted `SatelliteTileLoader` for satellite tile memory
  cache, disk cache, downloads, failure retry, and concurrency; validation
  passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 5 / Task 1: extracted `TrackTrustConfig.defaultV3()` as the
  shared source of strategy thresholds for validation, decision policy, session
  config snapshots, and replay; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 6 / Task 1: added diagnostic-only weak GNSS metrics to
  `gnss_snapshot` events, shared by Activity recording and foreground service
  recording through one summary path; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 7 / Task 1: documented diagnostic JSONL schema in
  `docs/diagnostic-jsonl-schema.md`.
- Phase 7 / Task 2: centralized legacy optional `gnss_snapshot` field names and
  event construction.
- Phase 7 / Task 3: added a focused contract test for legacy and Phase 6
  `gnss_snapshot` fields; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 8 / Task 1: accumulated optional Phase 6 GNSS metrics in
  `HikingSampleReportGenerator`.
- Phase 8 / Task 2: exposed GNSS quality summary fields in report JSON and text.
- Phase 8 / Task 3: added sample-report tests for Phase 6 metrics and legacy
  `gnss_snapshot` compatibility; validation passed:
  - `source scripts/use-jdk17.sh && ./gradlew testDebugUnitTest`
  - `source scripts/use-jdk17.sh && ./gradlew :app:runReplay`
- Phase 9 / Task 1: correlated weak/reject decisions with linked Phase 6
  `gnss_snapshot` metrics in `HikingSampleReportGenerator`.
- Phase 9 / Task 2: exposed weak/reject GNSS explanation fields in report JSON
  and text.
- Phase 9 / Task 3: added sample-report coverage for weak/reject decision GNSS
  correlation while preserving legacy compatibility.
- Phase 10 / Task 1: added `WeakGnssReportGenerator` for standalone weak GNSS
  diagnostics from `SessionManifest` and `evidence.jsonl`.
- Phase 10 / Task 2: added `WeakGnssReport` JSON and text output for
  weak/reject/GAP/no-location evidence.
- Phase 10 / Task 3: added weak GNSS report tests for Phase 6 metrics and
  legacy `gnss_snapshot` compatibility.
- Phase 11 / Task 1: split current and historical export actions into separate
  track/diagnostic and report rows for narrow device screens.
- Phase 11 / Task 2: renamed weak GNSS export actions to `弱GPS报告`.
- Phase 11 / Task 3: weak GNSS report export now saves text and JSON copies
  under the session `export/` directory before opening the system export picker.

The current governance cursor is:

```text
Phase 11 complete
```

Move the cursor only after completing a task and validating it according to the
phase rules.
