package com.example.gnsssatdemo.track.engine;

import android.content.Context;
import android.location.Location;
import android.os.Build;
import android.os.SystemClock;

import com.example.gnsssatdemo.track.export.DiagnosticLogger;
import com.example.gnsssatdemo.track.export.GpxExporter;
import com.example.gnsssatdemo.track.export.SessionFileStore;
import com.example.gnsssatdemo.track.export.TrackExportValidator;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
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
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public class BasicTrackSession implements Closeable {
    private static final String STRATEGY_VERSION = "stage1-gnss-track-v1";
    private static final int RECENT_SUMMARY_LIMIT = 8;
    private static final long WEAK_TRACK_POINT_ID_OFFSET = 1_000_000_000L;

    private final Context appContext;
    private final SessionFileStore fileStore;
    private final LocationValidator validator = new LocationValidator();
    private final TrackDecisionEngine decisionEngine = new TrackDecisionEngine();
    private final GpxExporter gpxExporter = new GpxExporter();
    private final TrackExportValidator exportValidator = new TrackExportValidator();

    private DiagnosticLogger logger;
    private File sessionDir;
    private String sessionId;
    private long createdWallTimeMillis;
    private long recordStartElapsedRealtimeNanos;
    private long rawPointSeq;
    private long decisionSeq;
    private long eventIdSeq;
    private long lastEventSeq;
    private long lastUpdatedWallTimeMillis;
    private long trackPointSeq;
    private long weakTrackPointSeq;
    private long gnssSnapshotSeq;
    private long segmentId = 1L;
    private boolean active;
    private boolean finished;
    private boolean forcedWeakFirstFixEnabled;
    private String integrityState = "OK";
    private String completionState = "ACTIVE";
    private String lastDecisionResult = "";
    private String lastDecisionReason = "";
    private String lastErrorCode = "";
    private float lastRawAccuracyMeters = -1f;
    private long lastStationaryKeepaliveElapsedRealtimeNanos;
    private int stationaryKeepaliveCount;
    private int stationaryJitterCount;
    private double totalDistanceMeters;
    private double movingTimeSeconds;
    private GnssQualitySnapshot lastGnssSnapshot;
    private final List<TrackPoint> trackPoints = new ArrayList<>();
    private final List<TrackPoint> weakTrackPoints = new ArrayList<>();
    private final List<String> recentSummaries = new ArrayList<>();

    public BasicTrackSession(Context context) {
        this.appContext = context.getApplicationContext();
        this.fileStore = new SessionFileStore(appContext);
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
        lastEventSeq = 0L;
        lastUpdatedWallTimeMillis = createdWallTimeMillis;
        trackPointSeq = 0L;
        weakTrackPointSeq = 0L;
        gnssSnapshotSeq = 0L;
        segmentId = 1L;
        active = false;
        finished = false;
        this.forcedWeakFirstFixEnabled = forcedWeakFirstFixEnabled;
        integrityState = "OK";
        completionState = "ACTIVE";
        lastDecisionResult = "";
        lastDecisionReason = "";
        lastErrorCode = "";
        lastRawAccuracyMeters = -1f;
        lastStationaryKeepaliveElapsedRealtimeNanos = 0L;
        stationaryKeepaliveCount = 0;
        stationaryJitterCount = 0;
        totalDistanceMeters = 0.0;
        movingTimeSeconds = 0.0;
        lastGnssSnapshot = null;
        trackPoints.clear();
        weakTrackPoints.clear();
        recentSummaries.clear();

        sessionDir = fileStore.createSessionDir(sessionId);
        writeSessionJson();
        logger = new DiagnosticLogger(fileStore.diagnosticJsonl(sessionDir));

        appendSessionMetadata();
        appendConfigSnapshot();
        appendRuntimeSnapshot(gpsProviderEnabled, preciseLocationGranted, foregroundServiceActive);
        appendSessionEvent("start_recording", "IDLE", "RECORDING", "WAITING_FIRST_FIX");
        addRecentSummary("开始记录，等待首个可信 GNSS 点");
        active = true;
        writeSessionJson();
    }

    public void finish() throws IOException, JSONException {
        if (!active || finished) {
            return;
        }
        appendSessionEvent("finish_recording", "RECORDING", "FINISHED", "FIX_READY");
        addRecentSummary("结束记录，TrackPoint=" + trackPoints.size());
        completionState = "FINISHED";
        active = false;
        finished = true;
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
        if (!active || logger == null) {
            return;
        }
        try {
            JSONObject event = new JSONObject();
            event.put("event", "gnss_snapshot");
            event.put("snapshotId", snapshot.snapshotId);
            event.put("receivedElapsedRealtimeNanos", snapshot.receivedElapsedRealtimeNanos);
            event.put("visibleTotal", snapshot.visibleTotal);
            event.put("usedInFixTotal", snapshot.usedInFixTotal);
            event.put("usedAvgCn0", snapshot.usedAvgCn0);
            event.put("gpsUsed", snapshot.gpsUsed);
            event.put("beidouUsed", snapshot.beidouUsed);
            event.put("galileoUsed", snapshot.galileoUsed);
            event.put("glonassUsed", snapshot.glonassUsed);
            event.put("qzssUsed", snapshot.qzssUsed);
            appendDiagnostic(event, snapshot.receivedElapsedRealtimeNanos);
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onLocation(Location location) {
        if (!active || finished || logger == null || location == null) {
            return;
        }

        RawPoint rawPoint = new RawPoint(++rawPointSeq, location,
                lastGnssSnapshot == null ? null : lastGnssSnapshot.snapshotId);
        lastRawAccuracyMeters = rawPoint.hasAccuracy ? rawPoint.accuracyMeters : -1f;
        try {
            appendRawLocation(rawPoint);
            ValidationResult validationResult = validator.validate(rawPoint, recordStartElapsedRealtimeNanos);
            if (!validationResult.valid) {
                appendDecision(rawPoint, null, "reject", validationResult.rejectReason, 0.0, 0.0);
                writeSessionJson();
                return;
            }

            TrackPoint previousTrackPoint = trackPoints.isEmpty()
                    ? null : trackPoints.get(trackPoints.size() - 1);
            TrackDecisionResult outcome = decisionEngine.decide(rawPoint, previousTrackPoint,
                    lastStationaryKeepaliveElapsedRealtimeNanos, forcedWeakFirstFixEnabled);
            TrackPoint trackPoint = null;
            String decisionState = trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "TRACKING";
            if ("accept".equals(outcome.result) || "anchor".equals(outcome.result)) {
                long decisionId = decisionSeq + 1L;
                trackPoint = new TrackPoint(++trackPointSeq, decisionId, segmentId, rawPoint,
                        outcome.result, outcome.reason,
                        outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds);
                trackPoints.add(trackPoint);
                totalDistanceMeters += outcome.distanceDeltaMeters;
                movingTimeSeconds += outcome.movingTimeDeltaSeconds;
            } else if ("weak".equals(outcome.result)) {
                long decisionId = decisionSeq + 1L;
                trackPoint = new TrackPoint(WEAK_TRACK_POINT_ID_OFFSET + ++weakTrackPointSeq,
                        decisionId, segmentId, rawPoint,
                        outcome.result, outcome.reason, 0.0, 0.0);
                weakTrackPoints.add(trackPoint);
            }
            lastStationaryKeepaliveElapsedRealtimeNanos =
                    outcome.nextStationaryKeepaliveElapsedRealtimeNanos;
            stationaryKeepaliveCount += outcome.stationaryKeepaliveIncrement;
            stationaryJitterCount += outcome.stationaryJitterIncrement;
            appendDecision(rawPoint, trackPoint, outcome.result, outcome.reason,
                    outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds, decisionState);
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onNoLocationTimeout(long elapsedSinceLastLocationMillis) {
        if (!active || finished || logger == null) {
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

    public void onInterrupted(String eventType) {
        if (!active || finished || logger == null) {
            return;
        }
        try {
            appendSessionEvent(eventType, "RECORDING", "INTERRUPTED",
                    trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "FIX_READY");
            addRecentSummary("记录被中断: " + eventType);
            completionState = "INTERRUPTED";
            active = false;
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
        event.put("completionState", completionState);
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
        event.put("maxLocationAgeNanos", LocationValidator.MAX_LOCATION_AGE_NANOS);
        event.put("firstFixGoodAccuracyMeters", 20);
        event.put("firstFixRelaxedAccuracyMeters", 30);
        event.put("forcedWeakFirstFixEnabled", forcedWeakFirstFixEnabled);
        event.put("ordinaryGoodAccuracyMeters", 30);
        event.put("weakAccuracyMaxMeters", LocationValidator.MAX_ACCURACY_METERS);
        event.put("impossibleSpeedMetersPerSecond",
                TrackDecisionEngine.IMPOSSIBLE_SPEED_METERS_PER_SECOND);
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

    private void appendRawLocation(RawPoint rawPoint) throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "raw_location");
        event.put("rawPointId", rawPoint.rawPointId);
        event.put("provider", rawPoint.provider);
        event.put("lat", rawPoint.latitude);
        event.put("lng", rawPoint.longitude);
        event.put("accuracy", rawPoint.hasAccuracy ? rawPoint.accuracyMeters : JSONObject.NULL);
        event.put("timeMillis", rawPoint.timeMillis);
        event.put("elapsedRealtimeNanos", rawPoint.elapsedRealtimeNanos);
        if (rawPoint.sourceGnssSnapshotId != null) {
            event.put("sourceGnssSnapshotId", rawPoint.sourceGnssSnapshotId);
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
        json.put("completionState", completionState);
        json.put("integrityState", integrityState);
        json.put("schemaVersion", 1);
        json.put("strategyVersion", STRATEGY_VERSION);
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", lastEventSeq);
        json.put("lastUpdatedWallTimeMillis", lastUpdatedWallTimeMillis);
        json.put("trackPointCount", trackPoints.size());
        json.put("weakTrackPointCount", weakTrackPoints.size());
        json.put("rawPointCount", rawPointSeq);
        json.put("stationaryKeepaliveCount", stationaryKeepaliveCount);
        json.put("stationaryJitterCount", stationaryJitterCount);
        json.put("totalDistanceMeters", totalDistanceMeters);
        json.put("movingTimeSeconds", movingTimeSeconds);
        json.put("segmentCount", 1);
        json.put("lastKnownErrorCode", lastErrorCode);
        File finalFile = fileStore.sessionJson(sessionDir);
        File tmpFile = fileStore.sessionJsonTmp(sessionDir);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(tmpFile), StandardCharsets.UTF_8))) {
            writer.write(json.toString(2));
            writer.write('\n');
        }
        if (!tmpFile.renameTo(finalFile)) {
            throw new IOException("session.json rename 失败");
        }
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
                    totalDistanceMeters, movingTimeSeconds));
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
                totalDistanceMeters, movingTimeSeconds);
    }

    public String buildPartialGpx() {
        if (sessionId == null || (trackPoints.isEmpty() && weakTrackPoints.isEmpty())) {
            throw new IllegalStateException("没有可导出的 partial TrackPoint");
        }
        return gpxExporter.buildPartialGpx(sessionId, combinedTrackPoints(),
                totalDistanceMeters, movingTimeSeconds);
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

    public GnssQualitySnapshot nextGnssSnapshot(long receivedElapsedRealtimeNanos, int visibleTotal,
                                                int usedInFixTotal, float usedAvgCn0,
                                                int gpsUsed, int beidouUsed, int galileoUsed,
                                                int glonassUsed, int qzssUsed) {
        return new GnssQualitySnapshot(++gnssSnapshotSeq, receivedElapsedRealtimeNanos, visibleTotal,
                usedInFixTotal, usedAvgCn0, gpsUsed, beidouUsed, galileoUsed, glonassUsed, qzssUsed);
    }

    public boolean isActive() {
        return active;
    }

    public boolean isFinished() {
        return finished;
    }

    public boolean canExportTrustedGpx() {
        return sessionId != null
                && !active
                && finished
                && "FINISHED".equals(completionState)
                && "OK".equals(integrityState)
                && !trackPoints.isEmpty()
                && trustedGpxReferenceError() == null;
    }

    public String trustedGpxUnavailableReason() {
        if (sessionId == null) {
            return "还没有记录 session";
        }
        if (active) {
            return "记录仍在进行中";
        }
        if (!finished || !"FINISHED".equals(completionState)) {
            return "session 尚未正常结束";
        }
        if (!"OK".equals(integrityState)) {
            return "session 完整性异常: " + lastErrorCode;
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
        return integrityState;
    }

    public String getCompletionState() {
        return completionState;
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

    public long getRawPointCount() {
        return rawPointSeq;
    }

    public long getLastEventSeq() {
        return lastEventSeq;
    }

    public long getLastUpdatedWallTimeMillis() {
        return lastUpdatedWallTimeMillis;
    }

    public String getLastDecisionReason() {
        return lastDecisionReason;
    }

    public String getLastDecisionResult() {
        return lastDecisionResult;
    }

    public float getLastRawAccuracyMeters() {
        return lastRawAccuracyMeters;
    }

    public boolean isForcedWeakFirstFixEnabled() {
        return forcedWeakFirstFixEnabled;
    }

    public int getStationaryKeepaliveCount() {
        return stationaryKeepaliveCount;
    }

    public int getStationaryJitterCount() {
        return stationaryJitterCount;
    }

    public double getTotalDistanceMeters() {
        return totalDistanceMeters;
    }

    public double getMovingTimeSeconds() {
        return movingTimeSeconds;
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
        lastEventSeq = logger.append(event, sessionId, eventElapsedRealtimeNanos);
        lastUpdatedWallTimeMillis = System.currentTimeMillis();
    }

    private String trustedGpxReferenceError() {
        return exportValidator.trustedGpxReferenceError(trackPoints, rawPointSeq, decisionSeq);
    }

    private void markIntegrityError(String errorCode, Exception e) {
        lastErrorCode = errorCode;
        integrityState = "ERROR";
        completionState = "ERROR";
        active = false;
        addRecentSummary("记录完整性异常: " + errorCode);
        try {
            writeSessionJson();
        } catch (IOException | JSONException ignored) {
            // Best effort after integrity failure.
        }
    }

    private void closeLoggerQuietly() {
        if (logger == null) {
            return;
        }
        try {
            logger.close();
        } catch (IOException ignored) {
            // Best effort.
        }
        logger = null;
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
