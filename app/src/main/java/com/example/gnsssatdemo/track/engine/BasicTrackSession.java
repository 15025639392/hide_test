package com.example.gnsssatdemo.track.engine;

import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.os.SystemClock;

import com.example.gnsssatdemo.track.export.GpxExporter;
import com.example.gnsssatdemo.track.export.SessionFileStore;
import com.example.gnsssatdemo.track.export.TrackExportValidator;
import com.example.gnsssatdemo.track.model.GnssSnapshotDiagnosticFields;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;
import com.example.gnsssatdemo.track.model.ValidationResult;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class BasicTrackSession implements Closeable {
    private static final String STRATEGY_VERSION = "stage1-gnss-track-v2-rest-state";
    private static final int RECENT_SUMMARY_LIMIT = 8;
    private static final long WEAK_TRACK_POINT_ID_OFFSET = 1_000_000_000L;
    private static final long TRANSPORT_DISPLAY_POINT_ID_OFFSET = 2_000_000_000L;

    private final Context appContext;
    private final SessionFileStore fileStore;
    private final TrackStrategyConfig strategyConfig = TrackStrategyConfig.defaultStage1();
    private final LocationValidator validator = new LocationValidator(strategyConfig);
    private final TrackDecisionCoordinator decisionCoordinator =
            new TrackDecisionCoordinator(strategyConfig);
    private final GnssSnapshotBuffer gnssSnapshotBuffer = new GnssSnapshotBuffer();
    private final TrackStatsAccumulator stats = new TrackStatsAccumulator();
    private final RestAnchorRefiner restAnchorRefiner = new RestAnchorRefiner();
    private final RestStateMachine restStateMachine = new RestStateMachine();
    private final SessionJournalWriter journalWriter;
    private final SessionLifecycleState lifecycle = new SessionLifecycleState();
    private final GnssSnapshotDiagnosticFields gnssSnapshotDiagnosticFields =
            new GnssSnapshotDiagnosticFields();
    private final GpxExporter gpxExporter = new GpxExporter();
    private final TrackExportValidator exportValidator = new TrackExportValidator();

    private File sessionDir;
    private String sessionId;
    private long createdWallTimeMillis;
    private long recordStartElapsedRealtimeNanos;
    private long rawPointSeq;
    private long decisionSeq;
    private long eventIdSeq;
    private long trackPointSeq;
    private long weakTrackPointSeq;
    private long transportDisplayPointSeq;
    private long gnssSnapshotSeq;
    private long samplingPolicySeq;
    private long segmentId = 1L;
    private boolean forcedWeakFirstFixEnabled;
    private String lastDecisionResult = "";
    private String lastDecisionReason = "";
    private float lastRawAccuracyMeters = -1f;
    private long lastStationaryKeepaliveElapsedRealtimeNanos;
    private GnssQualitySnapshot lastGnssSnapshot;
    private final List<TrackPoint> trackPoints = new ArrayList<>();
    private final List<TrackPoint> weakTrackPoints = new ArrayList<>();
    private final List<TrackPoint> transportTrackPoints = new ArrayList<>();
    private final List<MotionSummary> recentMotionSummaries = new ArrayList<>();
    private final Set<Long> acceptedDecisionIds = new HashSet<>();
    private final List<String> recentSummaries = new ArrayList<>();

    public BasicTrackSession(Context context) {
        this.appContext = context.getApplicationContext();
        this.fileStore = new SessionFileStore(appContext);
        this.journalWriter = new SessionJournalWriter(fileStore);
    }

    public void start(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                      boolean forcedWeakFirstFixEnabled)
            throws IOException, JSONException {
        start(gpsProviderEnabled, preciseLocationGranted, forcedWeakFirstFixEnabled, false);
    }

    public void start(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                      boolean forcedWeakFirstFixEnabled, boolean foregroundServiceActive)
            throws IOException, JSONException {
        closeLoggerQuietly();
        sessionId = UUID.randomUUID().toString();
        createdWallTimeMillis = System.currentTimeMillis();
        recordStartElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos();
        rawPointSeq = 0L;
        decisionSeq = 0L;
        eventIdSeq = 0L;
        trackPointSeq = 0L;
        weakTrackPointSeq = 0L;
        transportDisplayPointSeq = 0L;
        gnssSnapshotSeq = 0L;
        samplingPolicySeq = 0L;
        segmentId = 1L;
        this.forcedWeakFirstFixEnabled = forcedWeakFirstFixEnabled;
        lifecycle.resetForStart();
        lastDecisionResult = "";
        lastDecisionReason = "";
        lastRawAccuracyMeters = -1f;
        lastStationaryKeepaliveElapsedRealtimeNanos = 0L;
        stats.reset();
        lastGnssSnapshot = null;
        decisionCoordinator.reset();
        restStateMachine.reset();
        gnssSnapshotBuffer.clear();
        trackPoints.clear();
        weakTrackPoints.clear();
        transportTrackPoints.clear();
        recentMotionSummaries.clear();
        acceptedDecisionIds.clear();
        recentSummaries.clear();

        sessionDir = fileStore.createSessionDir(sessionId);
        journalWriter.reset(sessionDir, createdWallTimeMillis);
        writeSessionJson();
        journalWriter.openDiagnosticLogger();

        appendSessionMetadata();
        appendConfigSnapshot();
        appendRuntimeSnapshot(gpsProviderEnabled, preciseLocationGranted, foregroundServiceActive);
        appendSessionEvent("start_recording", "IDLE", "RECORDING", "WAITING_FIRST_FIX");
        addRecentSummary("开始记录，等待首个可信 GNSS 点");
        lifecycle.markActive();
        writeSessionJson();
    }

    public void finish() throws IOException, JSONException {
        if (!lifecycle.isActive() || lifecycle.isFinished()) {
            return;
        }
        appendSessionEvent("finish_recording", "RECORDING", "FINISHED", "FIX_READY");
        addRecentSummary("结束记录，TrackPoint=" + trackPoints.size());
        lifecycle.markFinished();
        writeSessionJson();
        closeLoggerQuietly();
        try {
            writeInternalGpx();
            writePartialGpx();
        } catch (IOException e) {
            markIntegrityError("trusted_gpx_write_failed", e);
            throw e;
        }
    }

    public void onGnssSnapshot(GnssQualitySnapshot snapshot) {
        lastGnssSnapshot = snapshot;
        gnssSnapshotBuffer.remember(snapshot);
        if (!lifecycle.isActive() || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        try {
            JSONObject event = gnssSnapshotDiagnosticFields.toEvent(snapshot);
            appendDiagnostic(event, snapshot.receivedElapsedRealtimeNanos);
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onMotionSummary(MotionSummary summary) {
        if (!lifecycle.isActive() || !journalWriter.isDiagnosticLoggerOpen()
                || summary == null) {
            return;
        }
        rememberMotionSummary(summary);
        boolean restStateChanged = restStateMachine.onMotionSummary(summary);
        try {
            JSONObject event = new JSONObject();
            event.put("event", "motion_summary");
            event.put("motionSummaryId", summary.motionSummaryId);
            event.put("firstElapsedRealtimeNanos", summary.firstElapsedRealtimeNanos);
            event.put("lastElapsedRealtimeNanos", summary.lastElapsedRealtimeNanos);
            event.put("sampleCount", summary.sampleCount);
            event.put("dynamicAccelRmsMps2", summary.dynamicAccelRmsMps2);
            event.put("stillScore", summary.stillScore);
            event.put("isDeviceStill", summary.deviceStill);
            event.put("sourceSensorType", summary.sourceSensorType);
            event.put("restStateAfter", restStateMachine.stateName());
            appendDiagnostic(event, summary.lastElapsedRealtimeNanos);
            if (restStateChanged) {
                addRecentSummary("加速度变化，进入 REST_PROBING");
            }
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onLocation(Location location) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen() || location == null) {
            return;
        }

        GnssSnapshotBuffer.Match snapshotMatch =
                gnssSnapshotBuffer.match(location.getElapsedRealtimeNanos());
        RawPoint rawPoint = new RawPoint(++rawPointSeq, location, snapshotMatch.snapshotId);
        lastRawAccuracyMeters = rawPoint.hasAccuracy ? rawPoint.accuracyMeters : -1f;
        try {
            appendRawLocation(rawPoint, snapshotMatch);
            ValidationResult validationResult = validator.validate(rawPoint, recordStartElapsedRealtimeNanos);
            if (!validationResult.valid) {
                appendDecision(rawPoint, null, "reject", validationResult.rejectReason, 0.0, 0.0);
                writeSessionJson();
                return;
            }

            TrackPoint exportedPreviousTrackPoint = trackPoints.isEmpty()
                    ? null : trackPoints.get(trackPoints.size() - 1);
            TrackDecisionCoordinator.Decision decision = decisionCoordinator.decide(rawPoint,
                    exportedPreviousTrackPoint, lastStationaryKeepaliveElapsedRealtimeNanos,
                    forcedWeakFirstFixEnabled);
            TrackDecisionResult outcome = decision.outcome;
            RestAnchorRefiner.Decision restAnchorDecision = restAnchorRefiner.refine(outcome,
                    rawPoint, exportedPreviousTrackPoint,
                    gnssSnapshotBuffer.findById(rawPoint.sourceGnssSnapshotId),
                    exportedPreviousTrackPoint == null ? null
                            : gnssSnapshotBuffer.findById(
                                    exportedPreviousTrackPoint.sourceGnssSnapshotId),
                    recentMotionSummaries);
            TrackPoint trackPoint = null;
            TrackPoint decisionTrackPoint = null;
            if (restAnchorDecision.handled) {
                outcome = new TrackDecisionResult("reject", restAnchorDecision.reason,
                        0.0, 0.0, lastStationaryKeepaliveElapsedRealtimeNanos,
                        0, 1);
                if (restAnchorDecision.refineAnchor && exportedPreviousTrackPoint != null) {
                    addRecentSummary("休息锚点优化 Raw#" + rawPoint.rawPointId
                            + " acc=" + String.format(Locale.US, "%.1fm", rawPoint.accuracyMeters));
                }
            }
            RestStateMachine.Decision restDecision = restStateMachine.apply(outcome, rawPoint,
                    exportedPreviousTrackPoint, recentMotionSummaries);
            outcome = restDecision.outcome;
            String decisionState = decision.wasTransportMode ? "TRANSPORT"
                    : restDecision.state;
            if (shouldRecordTrustedTrackPoint(outcome)) {
                if (shouldStartNewSegment(outcome) && exportedPreviousTrackPoint != null) {
                    segmentId++;
                    if (shouldIncrementGapCount(outcome)) {
                        stats.incrementGapCount();
                        addRecentSummary("定位恢复，新开 Segment#" + segmentId);
                    } else if ("transport_recovery".equals(outcome.reason)) {
                        addRecentSummary("交通工具移动后恢复徒步，新开 Segment#" + segmentId);
                    } else if (RestStateMachine.REASON_REST_MOVING_RECOVERY.equals(outcome.reason)) {
                        addRecentSummary("REST 探测确认移动，新开 Segment#" + segmentId);
                    }
                }
                long decisionId = decisionSeq + 1L;
                trackPoint = new TrackPoint(++trackPointSeq, decisionId, segmentId, rawPoint,
                        outcome.result, outcome.reason,
                        outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds);
                trackPoints.add(trackPoint);
                decisionTrackPoint = trackPoint;
                acceptedDecisionIds.add(decisionId);
                stats.addAcceptedMovement(outcome);
            } else if ("weak".equals(outcome.result)) {
                long decisionId = decisionSeq + 1L;
                trackPoint = new TrackPoint(WEAK_TRACK_POINT_ID_OFFSET + ++weakTrackPointSeq,
                        decisionId, segmentId, rawPoint,
                        outcome.result, outcome.reason, 0.0, 0.0);
                weakTrackPoints.add(trackPoint);
                decisionTrackPoint = trackPoint;
            }
            if (decision.shouldAddTransportDisplayPoint) {
                addTransportDisplayPoint(rawPoint, outcome.reason);
            }
            if (decision.enteredTransportMode) {
                stats.incrementTransportCount();
                addRecentSummary("检测到疑似交通工具移动，暂停累计徒步距离");
            }
            lastStationaryKeepaliveElapsedRealtimeNanos =
                    outcome.nextStationaryKeepaliveElapsedRealtimeNanos;
            stats.addStationaryDecision(outcome);
            appendDecision(rawPoint, decisionTrackPoint, outcome.result, outcome.reason,
                    outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds, decisionState);
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    static boolean shouldRecordTrustedTrackPoint(TrackDecisionResult outcome) {
        return outcome != null
                && ("accept".equals(outcome.result) || "anchor".equals(outcome.result));
    }

    static boolean shouldStartNewSegment(TrackDecisionResult outcome) {
        return shouldRecordTrustedTrackPoint(outcome) && outcome.startsNewSegment;
    }

    static boolean shouldIncrementGapCount(TrackDecisionResult outcome) {
        return shouldStartNewSegment(outcome) && "gap_recovery".equals(outcome.reason);
    }

    static boolean isGapRecovery(TrackDecisionResult outcome) {
        return outcome != null
                && "accept".equals(outcome.result)
                && "gap_recovery".equals(outcome.reason);
    }

    private void rememberMotionSummary(MotionSummary summary) {
        recentMotionSummaries.add(summary);
        while (recentMotionSummaries.size() > RECENT_SUMMARY_LIMIT) {
            recentMotionSummaries.remove(0);
        }
    }

    public void onNoLocationTimeout(long elapsedSinceLastLocationMillis) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        try {
            appendSessionEvent("no_location_timeout", "RECORDING", "RECORDING",
                    trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "FIX_READY",
                    elapsedSinceLastLocationMillis);
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    private void addTransportDisplayPoint(RawPoint rawPoint, String reason) {
        long decisionId = decisionSeq + 1L;
        TrackPoint point = new TrackPoint(
                TRANSPORT_DISPLAY_POINT_ID_OFFSET + ++transportDisplayPointSeq,
                decisionId,
                segmentId,
                rawPoint,
                "transport",
                reason,
                0.0,
                0.0);
        transportTrackPoints.add(point);
    }

    public void onSamplingPolicyChanged(String state, long intervalMillis, float distanceMeters) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        try {
            JSONObject event = new JSONObject();
            event.put("event", "sampling_policy");
            event.put("samplingPolicyId", ++samplingPolicySeq);
            event.put("state", state);
            event.put("locationRequestProvider", "gps");
            event.put("locationRequestMinTimeMs", intervalMillis);
            event.put("locationRequestMinDistanceMeters", distanceMeters);
            event.put("locationRequestRegisteredElapsedRealtimeNanos",
                    SystemClock.elapsedRealtimeNanos());
            event.put("locationRequestThread", "main");
            appendDiagnostic(event, SystemClock.elapsedRealtimeNanos());
            addRecentSummary("采样 " + state + " " + (intervalMillis / 1000L)
                    + "s/" + String.format(Locale.US, "%.1fm", distanceMeters));
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onInterrupted(String eventType) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        try {
            appendSessionEvent(eventType, "RECORDING", "INTERRUPTED",
                    trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "FIX_READY");
            addRecentSummary("记录被中断: " + eventType);
            lifecycle.markInterrupted();
            writeSessionJson();
            writePartialGpxQuietly();
            closeLoggerQuietly();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    private void appendSessionMetadata() throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "session_metadata");
        event.put("createdWallTimeMillis", createdWallTimeMillis);
        event.put("createdElapsedRealtimeNanos", recordStartElapsedRealtimeNanos);
        event.put("diagnosticLogFileName", "diagnostic.jsonl");
        event.put("gpxFileName", "track.gpx");
        event.put("completionState", lifecycle.getCompletionState());
        event.put("strategyVersion", STRATEGY_VERSION);
        appendDiagnostic(event, recordStartElapsedRealtimeNanos);
    }

    private void appendConfigSnapshot() throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "config_snapshot");
        event.put("configId", 1);
        event.put("strategyVersion", STRATEGY_VERSION);
        event.put("locationRequestProvider", "gps");
        event.put("locationRequestMinTimeMs", 1000);
        event.put("locationRequestMinDistanceMeters", 0);
        event.put("maxLocationAgeNanos", strategyConfig.maxLocationAgeNanos);
        event.put("firstFixGoodAccuracyMeters", strategyConfig.firstFixGoodAccuracyMeters);
        event.put("firstFixRelaxedAccuracyMeters", strategyConfig.firstFixRelaxedAccuracyMeters);
        event.put("forcedWeakFirstFixEnabled", forcedWeakFirstFixEnabled);
        event.put("ordinaryGoodAccuracyMeters", strategyConfig.ordinaryGoodAccuracyMeters);
        event.put("weakAccuracyMaxMeters", strategyConfig.maxAccuracyMeters);
        event.put("dynamicSamplingEnabled", true);
        event.put("dynamicSamplingKeepsDistanceFilterZero", true);
        event.put("gapLineBreakNanos", strategyConfig.gapLineBreakNanos);
        event.put("impossibleSpeedMetersPerSecond",
                strategyConfig.impossibleSpeedMetersPerSecond);
        event.put("transportSuspectedSpeedMetersPerSecond",
                strategyConfig.transportSuspectedSpeedMetersPerSecond);
        event.put("transportSuspectedMaxReasonableSpeedMetersPerSecond",
                strategyConfig.transportSuspectedMaxReasonableSpeedMetersPerSecond);
        event.put("transportRecoveryMaxSpeedMetersPerSecond",
                strategyConfig.transportRecoveryMaxSpeedMetersPerSecond);
        event.put("transportRecoveryStableNanos",
                strategyConfig.transportRecoveryStableNanos);
        event.put("restStateMachineEnabled", true);
        event.put("restPausedDoesNotAccumulateDistance", true);
        event.put("restProbingDoesNotBackfillDistance", true);
        appendDiagnostic(event, recordStartElapsedRealtimeNanos);
    }

    private void appendRuntimeSnapshot(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                                       boolean foregroundServiceActive)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "runtime_snapshot");
        event.put("runtimeSnapshotId", 1);
        event.put("androidSdkInt", Build.VERSION.SDK_INT);
        event.put("deviceManufacturer", Build.MANUFACTURER);
        event.put("deviceModel", Build.MODEL);
        event.put("locationProviderGpsEnabled", gpsProviderEnabled);
        event.put("preciseLocationGranted", preciseLocationGranted);
        event.put("foregroundServiceActive", foregroundServiceActive);
        appendDiagnostic(event, recordStartElapsedRealtimeNanos);
    }

    private void appendSessionEvent(String eventType, String before, String after, String fixStateAfter)
            throws IOException, JSONException {
        appendSessionEvent(eventType, before, after, fixStateAfter, -1L);
    }

    private void appendSessionEvent(String eventType, String before, String after, String fixStateAfter,
                                    long elapsedSinceLastLocationMillis)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "session_event");
        event.put("eventId", ++eventIdSeq);
        event.put("eventType", eventType);
        event.put("recordingStateBefore", before);
        event.put("recordingStateAfter", after);
        event.put("fixStateAfter", fixStateAfter);
        if (elapsedSinceLastLocationMillis >= 0L) {
            event.put("elapsedSinceLastLocationMillis", elapsedSinceLastLocationMillis);
        }
        appendDiagnostic(event, SystemClock.elapsedRealtimeNanos());
        if ("no_location_timeout".equals(eventType)) {
            addRecentSummary("超过 " + (elapsedSinceLastLocationMillis / 1000L)
                    + " 秒没有 Location 回调");
        }
    }

    private void appendRawLocation(RawPoint rawPoint, GnssSnapshotBuffer.Match snapshotMatch)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "raw_location");
        event.put("rawPointId", rawPoint.rawPointId);
        event.put("provider", rawPoint.provider);
        event.put("lat", rawPoint.latitude);
        event.put("lng", rawPoint.longitude);
        event.put("accuracy", rawPoint.hasAccuracy ? rawPoint.accuracyMeters : JSONObject.NULL);
        event.put("altitude", rawPoint.hasAltitude ? rawPoint.altitude : JSONObject.NULL);
        event.put("speed", rawPoint.hasSpeed ? rawPoint.speedMetersPerSecond : JSONObject.NULL);
        event.put("bearing", rawPoint.hasBearing ? rawPoint.bearingDegrees : JSONObject.NULL);
        event.put("timeMillis", rawPoint.timeMillis);
        event.put("hasElapsedRealtimeNanos", rawPoint.hasElapsedRealtimeNanos);
        event.put("elapsedRealtimeNanos", rawPoint.elapsedRealtimeNanos);
        event.put("mock", rawPoint.mock);
        if (rawPoint.sourceGnssSnapshotId != null) {
            event.put("sourceGnssSnapshotId", rawPoint.sourceGnssSnapshotId);
        }
        event.put("gnssQualityStale", snapshotMatch.stale);
        if (snapshotMatch.snapshotAgeNanos >= 0L) {
            event.put("sourceGnssSnapshotAgeNanos", snapshotMatch.snapshotAgeNanos);
            event.put("sourceGnssSnapshotMatchedFromFuture", snapshotMatch.matchedFromFuture);
        }
        appendDiagnostic(event, rawPoint.elapsedRealtimeNanos);
        addRecentSummary("Raw#" + rawPoint.rawPointId + " " + rawPoint.provider
                + " acc=" + (rawPoint.hasAccuracy
                ? String.format(Locale.US, "%.1fm", rawPoint.accuracyMeters)
                : "-"));
    }

    private void appendDecision(RawPoint rawPoint, TrackPoint trackPoint, String result, String reason,
                                double distanceDeltaMeters, double movingTimeDeltaSeconds)
            throws IOException, JSONException {
        appendDecision(rawPoint, trackPoint, result, reason, distanceDeltaMeters,
                movingTimeDeltaSeconds, trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "TRACKING");
    }

    private void appendDecision(RawPoint rawPoint, TrackPoint trackPoint, String result, String reason,
                                double distanceDeltaMeters, double movingTimeDeltaSeconds,
                                String decisionState)
            throws IOException, JSONException {
        long decisionId = ++decisionSeq;
        lastDecisionResult = result;
        lastDecisionReason = reason;
        JSONObject event = new JSONObject();
        event.put("event", "decision");
        event.put("decisionId", decisionId);
        event.put("rawPointId", rawPoint.rawPointId);
        event.put("result", result);
        event.put("reason", reason);
        event.put("state", decisionState);
        if (trackPoint != null) {
            event.put("trackPointId", trackPoint.trackPointId);
            event.put("segmentId", trackPoint.segmentId);
            event.put("distanceDeltaMeters", distanceDeltaMeters);
            event.put("movingTimeDeltaSeconds", movingTimeDeltaSeconds);
            if ("gap_recovery".equals(reason) || "transport_recovery".equals(reason)) {
                event.put("startsNewSegment", true);
            }
        }
        if (rawPoint.sourceGnssSnapshotId != null) {
            event.put("sourceGnssSnapshotId", rawPoint.sourceGnssSnapshotId);
        }
        appendDiagnostic(event, rawPoint.elapsedRealtimeNanos);
        addRecentSummary("Decision#" + decisionId + " " + result + " " + reason);
    }

    private void writeSessionJson() throws IOException, JSONException {
        if (sessionDir == null) {
            return;
        }
        JSONObject json = new JSONObject();
        json.put("sessionId", sessionId);
        json.put("createdWallTimeMillis", createdWallTimeMillis);
        json.put("createdElapsedRealtimeNanos", recordStartElapsedRealtimeNanos);
        json.put("completionState", lifecycle.getCompletionState());
        json.put("integrityState", lifecycle.getIntegrityState());
        json.put("schemaVersion", 1);
        json.put("strategyVersion", STRATEGY_VERSION);
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", journalWriter.getLastEventSeq());
        json.put("lastUpdatedWallTimeMillis", journalWriter.getLastUpdatedWallTimeMillis());
        json.put("trackPointCount", trackPoints.size());
        json.put("weakTrackPointCount", weakTrackPoints.size());
        json.put("rawPointCount", rawPointSeq);
        json.put("stationaryKeepaliveCount", stats.getStationaryKeepaliveCount());
        json.put("stationaryJitterCount", stats.getStationaryJitterCount());
        json.put("gapCount", stats.getGapCount());
        json.put("transportCount", stats.getTransportCount());
        json.put("totalDistanceMeters", stats.getTotalDistanceMeters());
        json.put("movingTimeSeconds", stats.getMovingTimeSeconds());
        json.put("segmentCount", trackPoints.isEmpty() ? 0 : segmentId);
        json.put("lastKnownErrorCode", lifecycle.getLastErrorCode());
        journalWriter.writeSessionJson(json);
    }

    private void writeInternalGpx() throws IOException {
        if (sessionDir == null || trackPoints.isEmpty()) {
            return;
        }
        String referenceError = trustedGpxReferenceError();
        if (referenceError != null) {
            throw new IOException("GPX 引用校验失败: " + referenceError);
        }
        File tmpFile = fileStore.trackGpxTmp(sessionDir);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(tmpFile), StandardCharsets.UTF_8))) {
            writer.write(buildGpx());
        }
        File finalFile = fileStore.trackGpx(sessionDir);
        if (!tmpFile.renameTo(finalFile)) {
            throw new IOException("track.gpx rename 失败");
        }
    }

    private void writePartialGpx() throws IOException {
        if (sessionDir == null || (trackPoints.isEmpty() && weakTrackPoints.isEmpty())) {
            return;
        }
        File tmpFile = fileStore.partialGpxTmp(sessionDir);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(tmpFile), StandardCharsets.UTF_8))) {
            writer.write(gpxExporter.buildPartialGpx(sessionId, combinedTrackPoints(),
                    stats.getTotalDistanceMeters(), stats.getMovingTimeSeconds()));
        }
        File finalFile = fileStore.partialGpx(sessionDir);
        if (!tmpFile.renameTo(finalFile)) {
            throw new IOException("partial.gpx rename 失败");
        }
    }

    private void writePartialGpxQuietly() {
        try {
            writePartialGpx();
        } catch (IOException ignored) {
            // Diagnostic JSONL remains the source of truth for interrupted sessions.
        }
    }

    public String buildGpx() {
        if (!canExportTrustedGpx()) {
            throw new IllegalStateException(trustedGpxUnavailableReason());
        }
        return gpxExporter.buildTrustedGpx(sessionId, trackPoints,
                stats.getTotalDistanceMeters(), stats.getMovingTimeSeconds());
    }

    public String buildPartialGpx() {
        if (sessionId == null || (trackPoints.isEmpty() && weakTrackPoints.isEmpty())) {
            throw new IllegalStateException("没有可导出的 partial TrackPoint");
        }
        return gpxExporter.buildPartialGpx(sessionId, combinedTrackPoints(),
                stats.getTotalDistanceMeters(), stats.getMovingTimeSeconds());
    }

    private List<TrackPoint> combinedTrackPoints() {
        List<TrackPoint> combined = new ArrayList<>(trackPoints.size() + weakTrackPoints.size());
        combined.addAll(trackPoints);
        combined.addAll(weakTrackPoints);
        Collections.sort(combined, new Comparator<TrackPoint>() {
            @Override
            public int compare(TrackPoint left, TrackPoint right) {
                int byTime = Long.compare(left.elapsedRealtimeNanos, right.elapsedRealtimeNanos);
                if (byTime != 0) {
                    return byTime;
                }
                return Long.compare(left.sourceRawPointId, right.sourceRawPointId);
            }
        });
        return combined;
    }

    public String getDiagnosticText() throws IOException {
        if (sessionDir == null) {
            return "";
        }
        File file = fileStore.diagnosticJsonl(sessionDir);
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream inputStream = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = inputStream.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return new String(bytes, 0, offset, StandardCharsets.UTF_8);
        }
    }

    public long nextGnssSnapshotId() {
        return ++gnssSnapshotSeq;
    }

    public boolean isActive() {
        return lifecycle.isActive();
    }

    public boolean isFinished() {
        return lifecycle.isFinished();
    }

    public boolean canExportTrustedGpx() {
        return sessionId != null
                && !lifecycle.isActive()
                && lifecycle.isFinished()
                && "FINISHED".equals(lifecycle.getCompletionState())
                && "OK".equals(lifecycle.getIntegrityState())
                && !trackPoints.isEmpty()
                && trustedGpxReferenceError() == null;
    }

    public String trustedGpxUnavailableReason() {
        if (sessionId == null) {
            return "还没有记录 session";
        }
        if (lifecycle.isActive()) {
            return "记录仍在进行中";
        }
        if (!lifecycle.isFinished()
                || !"FINISHED".equals(lifecycle.getCompletionState())) {
            return "session 尚未正常结束";
        }
        if (!"OK".equals(lifecycle.getIntegrityState())) {
            return "session 完整性异常: " + lifecycle.getLastErrorCode();
        }
        if (trackPoints.isEmpty()) {
            return "没有正式 TrackPoint";
        }
        String referenceError = trustedGpxReferenceError();
        if (referenceError != null) {
            return "GPX 引用校验失败: " + referenceError;
        }
        return "";
    }

    public String getIntegrityState() {
        return lifecycle.getIntegrityState();
    }

    public String getCompletionState() {
        return lifecycle.getCompletionState();
    }

    public String getSessionId() {
        return sessionId;
    }

    public int getTrackPointCount() {
        return trackPoints.size();
    }

    public List<TrackPoint> getTrackPoints() {
        return new ArrayList<>(trackPoints);
    }

    public List<TrackPoint> getWeakTrackPoints() {
        return new ArrayList<>(weakTrackPoints);
    }

    public List<TrackPoint> getTransportTrackPoints() {
        return new ArrayList<>(transportTrackPoints);
    }

    public long getRawPointCount() {
        return rawPointSeq;
    }

    public long getLastEventSeq() {
        return journalWriter.getLastEventSeq();
    }

    public long getLastUpdatedWallTimeMillis() {
        return journalWriter.getLastUpdatedWallTimeMillis();
    }

    public String getLastDecisionReason() {
        return lastDecisionReason;
    }

    public String getLastDecisionResult() {
        return lastDecisionResult;
    }

    public String getRestStateName() {
        return restStateMachine.stateName();
    }

    public boolean isRestPaused() {
        return restStateMachine.isPaused();
    }

    public boolean isRestProbing() {
        return restStateMachine.isProbing();
    }

    public float getLastRawAccuracyMeters() {
        return lastRawAccuracyMeters;
    }

    public boolean isForcedWeakFirstFixEnabled() {
        return forcedWeakFirstFixEnabled;
    }

    public int getStationaryKeepaliveCount() {
        return stats.getStationaryKeepaliveCount();
    }

    public int getStationaryJitterCount() {
        return stats.getStationaryJitterCount();
    }

    public double getTotalDistanceMeters() {
        return stats.getTotalDistanceMeters();
    }

    public double getMovingTimeSeconds() {
        return stats.getMovingTimeSeconds();
    }

    public List<String> getRecentSummaries() {
        return new ArrayList<>(recentSummaries);
    }

    public String getSessionDirPath() {
        return sessionDir == null ? "" : sessionDir.getAbsolutePath();
    }

    public String suggestedGpxFileName() {
        return "track_" + safeSessionName() + "_trusted.gpx";
    }

    public String suggestedPartialGpxFileName() {
        return "track_" + safeSessionName() + "_partial.gpx";
    }

    public String suggestedDiagnosticFileName() {
        return "diagnostic_" + safeSessionName() + ".jsonl";
    }

    private String safeSessionName() {
        return sessionId == null ? "no_session" : sessionId;
    }

    private void appendDiagnostic(JSONObject event, long eventElapsedRealtimeNanos)
            throws IOException, JSONException {
        journalWriter.appendDiagnostic(event, sessionId, eventElapsedRealtimeNanos);
    }

    private String trustedGpxReferenceError() {
        return exportValidator.trustedGpxReferenceError(trackPoints, rawPointSeq, decisionSeq,
                acceptedDecisionIds);
    }

    private void markIntegrityError(String errorCode, Exception e) {
        lifecycle.markIntegrityError(errorCode);
        addRecentSummary("记录完整性异常: " + errorCode);
        try {
            writeSessionJson();
        } catch (IOException | JSONException ignored) {
            // Best effort after integrity failure.
        }
    }

    private void closeLoggerQuietly() {
        journalWriter.closeQuietly();
    }

    private void addRecentSummary(String line) {
        recentSummaries.add(line);
        while (recentSummaries.size() > RECENT_SUMMARY_LIMIT) {
            recentSummaries.remove(0);
        }
    }

    @Override
    public void close() {
        closeLoggerQuietly();
    }

}
