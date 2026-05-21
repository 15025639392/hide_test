package com.example.gnsssatdemo.track.engine;

import android.content.Context;
import android.hardware.SensorManager;
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

import org.json.JSONException;
import org.json.JSONArray;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class BasicTrackSession implements Closeable {
    private static final String STRATEGY_VERSION = TrackTrustEngine.VERSION;
    private static final int RECENT_SUMMARY_LIMIT = 8;
    private static final long PRESSURE_SAMPLE_MAX_AGE_NANOS = 3_000_000_000L;
    private static final double BAROMETER_CALIBRATION_MAX_GNSS_VERTICAL_ACCURACY_METERS = 8.0;
    private static final double BAROMETER_CALIBRATION_MAX_GNSS_HORIZONTAL_ACCURACY_METERS = 30.0;
    private static final long WEAK_TRACK_POINT_ID_OFFSET = 1_000_000_000L;
    private static final long TRANSPORT_DISPLAY_POINT_ID_OFFSET = 2_000_000_000L;

    private final Context appContext;
    private final SessionFileStore fileStore;
    private final TrackTrustConfig trustConfig = TrackTrustConfig.defaultV3();
    private final GnssSnapshotBuffer gnssSnapshotBuffer = new GnssSnapshotBuffer();
    private final TrackStatsAccumulator stats = new TrackStatsAccumulator();
    private final SamplingIntake samplingIntake = new SamplingIntake();
    private final TrackTrustEngine trustEngine = new TrackTrustEngine();
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
    private SamplingEpoch activeSamplingEpoch;
    private long pressureSampleSeq;
    private long barometerCalibrationSeq;
    private long segmentId = 1L;
    private String lastDecisionResult = "";
    private String lastDecisionReason = "";
    private float lastRawAccuracyMeters = -1f;
    private long lastStationaryKeepaliveElapsedRealtimeNanos;
    private int intakeRejectedCount;
    private int samplingContractViolationCount;
    private int samplingEpochMismatchCount;
    private int duplicateFixCount;
    private int outOfOrderFixCount;
    private int recoveryCloudCount;
    private int virtualTrackPointCount;
    private GnssQualitySnapshot lastGnssSnapshot;
    private boolean pressureSensorAvailable;
    private boolean pressureSummaryWritten;
    private long firstPressureSampleElapsedRealtimeNanos;
    private long lastPressureSampleElapsedRealtimeNanos;
    private double minPressureHpa;
    private double maxPressureHpa;
    private double lastPressureHpa;
    private double lastRawBarometerAltitudeMeters;
    private boolean barometerCalibrated;
    private double barometerCalibrationOffsetMeters;
    private double lastDisplayedBarometerAltitudeMeters;
    private final List<TrackPoint> trackPoints = new ArrayList<>();
    private final List<TrackPoint> weakTrackPoints = new ArrayList<>();
    private final List<TrackPoint> transportTrackPoints = new ArrayList<>();
    private final List<TrackAscentCalculator.BarometerSample> barometerAscentSamples =
            new ArrayList<>();
    private TrackAscentCalculator.Result cachedAscentResult;
    private boolean ascentResultDirty = true;
    private final List<MotionSummary> recentMotionSummaries = new ArrayList<>();
    private final Set<Long> acceptedDecisionIds = new HashSet<>();
    private final Set<Long> countedCloudIds = new HashSet<>();
    private final Map<String, Integer> cloudWindowCounts = new HashMap<>();
    private final List<String> recentSummaries = new ArrayList<>();

    public BasicTrackSession(Context context) {
        this.appContext = context.getApplicationContext();
        this.fileStore = new SessionFileStore(appContext);
        this.journalWriter = new SessionJournalWriter(fileStore);
    }

    public void start(boolean gpsProviderEnabled, boolean preciseLocationGranted)
            throws IOException, JSONException {
        start(gpsProviderEnabled, preciseLocationGranted, false);
    }

    public void start(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                      boolean foregroundServiceActive)
            throws IOException, JSONException {
        start(gpsProviderEnabled, preciseLocationGranted, foregroundServiceActive, false);
    }

    public void start(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                      boolean foregroundServiceActive,
                      boolean pressureSensorAvailable)
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
        pressureSampleSeq = 0L;
        barometerCalibrationSeq = 0L;
        segmentId = 1L;
        this.pressureSensorAvailable = pressureSensorAvailable;
        lifecycle.resetForStart();
        lastDecisionResult = "";
        lastDecisionReason = "";
        lastRawAccuracyMeters = -1f;
        lastStationaryKeepaliveElapsedRealtimeNanos = 0L;
        intakeRejectedCount = 0;
        samplingContractViolationCount = 0;
        samplingEpochMismatchCount = 0;
        duplicateFixCount = 0;
        outOfOrderFixCount = 0;
        recoveryCloudCount = 0;
        virtualTrackPointCount = 0;
        stats.reset();
        lastGnssSnapshot = null;
        samplingIntake.reset();
        trustEngine.reset();
        activeSamplingEpoch = new SamplingEpoch(1L, "STARTING",
                1000L, 0f, recordStartElapsedRealtimeNanos);
        samplingPolicySeq = 1L;
        gnssSnapshotBuffer.clear();
        trackPoints.clear();
        weakTrackPoints.clear();
        transportTrackPoints.clear();
        barometerAscentSamples.clear();
        invalidateAscentResult();
        recentMotionSummaries.clear();
        acceptedDecisionIds.clear();
        countedCloudIds.clear();
        cloudWindowCounts.clear();
        recentSummaries.clear();
        resetPressureDiagnostics();

        sessionDir = fileStore.createSessionDir(sessionId);
        journalWriter.reset(sessionDir, createdWallTimeMillis);
        writeSessionJson();
        journalWriter.openDiagnosticLogger();

        appendSessionMetadata();
        appendConfigSnapshot();
        appendRuntimeSnapshot(gpsProviderEnabled, preciseLocationGranted, foregroundServiceActive,
                pressureSensorAvailable);
        appendSessionEvent("start_recording", "IDLE", "RECORDING", "WAITING_FIRST_FIX");
        addRecentSummary("开始记录，等待首个可信 GNSS 点");
        lifecycle.markActive();
        writeSessionJson();
    }

    public void finish() throws IOException, JSONException {
        if (!lifecycle.isActive() || lifecycle.isFinished()) {
            return;
        }
        appendPressureSummaryIfNeeded();
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
            event.put("restStateAfter", "TRACK_TRUST_V3");
            appendDiagnostic(event, summary.lastElapsedRealtimeNanos);
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onPressureSample(float pressureHpa, int sensorAccuracy,
                                 long elapsedRealtimeNanos) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        if (!isValidPressure(pressureHpa)) {
            long barometerSampleId = addBarometerAscentSample(pressureHpa, sensorAccuracy,
                    elapsedRealtimeNanos, Double.NaN);
            appendRejectedPressureSample(barometerSampleId, pressureHpa, sensorAccuracy,
                    elapsedRealtimeNanos);
            return;
        }
        double rawAltitudeMeters = SensorManager.getAltitude(
                SensorManager.PRESSURE_STANDARD_ATMOSPHERE, pressureHpa);
        pressureSampleSeq++;
        if (firstPressureSampleElapsedRealtimeNanos == 0L) {
            firstPressureSampleElapsedRealtimeNanos = elapsedRealtimeNanos;
            minPressureHpa = pressureHpa;
            maxPressureHpa = pressureHpa;
        } else {
            minPressureHpa = Math.min(minPressureHpa, pressureHpa);
            maxPressureHpa = Math.max(maxPressureHpa, pressureHpa);
        }
        lastPressureSampleElapsedRealtimeNanos = elapsedRealtimeNanos;
        lastPressureHpa = pressureHpa;
        lastRawBarometerAltitudeMeters = rawAltitudeMeters;
        addBarometerAscentSample(pressureHpa, sensorAccuracy,
                elapsedRealtimeNanos, rawAltitudeMeters);
        if (barometerCalibrated) {
            lastDisplayedBarometerAltitudeMeters =
                    rawAltitudeMeters + barometerCalibrationOffsetMeters;
        }
        try {
            JSONObject event = new JSONObject();
            event.put("event", "pressure_sample");
            event.put("pressureSampleId", pressureSampleSeq);
            event.put("pressureHpa", pressureHpa);
            event.put("sensorAccuracy", sensorAccuracy);
            event.put("rawBarometerAltitudeMeters", rawAltitudeMeters);
            appendDiagnostic(event, elapsedRealtimeNanos);
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    public void onLocation(Location location) {
        onLocation(location, null);
    }

    public void onLocation(Location location, SamplingEpoch samplingEpoch) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen() || location == null) {
            return;
        }

        long callbackReceivedElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos();
        GnssSnapshotBuffer.Match snapshotMatch =
                gnssSnapshotBuffer.match(location.getElapsedRealtimeNanos());
        RawPoint rawPoint = new RawPoint(++rawPointSeq, location, snapshotMatch.snapshotId);
        lastRawAccuracyMeters = rawPoint.hasAccuracy ? rawPoint.accuracyMeters : -1f;
        try {
            appendRawLocation(rawPoint, snapshotMatch, samplingEpoch,
                    callbackReceivedElapsedRealtimeNanos);
            SamplingIntake.Result intakeResult = samplingIntake.accept(rawPoint,
                    samplingEpoch, recordStartElapsedRealtimeNanos,
                    callbackReceivedElapsedRealtimeNanos);
            if (!intakeResult.accepted) {
                rememberIntakeRejected(intakeResult.reason);
                if (intakeResult.contractViolation) {
                    samplingContractViolationCount++;
                    appendSessionIntegrityError("sampling_contract_violation", rawPoint);
                    markIntegrityError("sampling_contract_violation", null);
                } else {
                    incrementIntakeRejectCount(intakeResult.reason);
                    appendLocationIntakeRejected(rawPoint, intakeResult.reason, samplingEpoch);
                }
                writeSessionJson();
                return;
            }
            TrackPoint exportedPreviousTrackPoint = trackPoints.isEmpty()
                    ? null : trackPoints.get(trackPoints.size() - 1);
            TrackTrustDecision decision = trustEngine.decide(rawPoint, samplingEpoch,
                    gnssSnapshotBuffer.findById(rawPoint.sourceGnssSnapshotId),
                    recentMotionSummaries, exportedPreviousTrackPoint);
            TrackPoint decisionTrackPoint = null;
            if (decision.createsTrustedTrackPoint()) {
                if (decision.startsNewSegment && exportedPreviousTrackPoint != null) {
                    segmentId++;
                    stats.incrementGapCount();
                    recoveryCloudCount++;
                    addRecentSummary("恢复点云稳定，新开 Segment#" + segmentId);
                }
                long decisionId = decisionSeq + 1L;
                TrackPoint trackPoint = trackPointFromTrustDecision(++trackPointSeq,
                        decisionId, segmentId, decision);
                maybeCalibrateBarometer(trackPoint, rawPoint);
                trackPoints.add(trackPoint);
                invalidateAscentResult();
                decisionTrackPoint = trackPoint;
                acceptedDecisionIds.add(decisionId);
                stats.addAcceptedMovement(decision.distanceDeltaMeters,
                        decision.movingTimeDeltaSeconds);
                if (trackPoint.virtualTrackPointCoordinate) {
                    virtualTrackPointCount++;
                }
            } else if ("weak".equals(decision.result)) {
                long decisionId = decisionSeq + 1L;
                TrackPoint trackPoint = trackPointFromTrustDecision(
                        WEAK_TRACK_POINT_ID_OFFSET + ++weakTrackPointSeq,
                        decisionId, segmentId, decision);
                maybeCalibrateBarometer(trackPoint, rawPoint);
                weakTrackPoints.add(trackPoint);
                invalidateAscentResult();
                decisionTrackPoint = trackPoint;
            }
            if ("transport_suspected".equals(decision.reason)) {
                addTransportDisplayPoint(rawPoint, decision.reason);
                stats.incrementTransportCount();
                addRecentSummary("检测到疑似交通工具移动，暂停累计徒步距离");
            }
            if ("stationary_anchor".equals(decision.reason)) {
                stats.incrementStationaryKeepaliveCount();
            } else if ("stationary_cloud_jitter".equals(decision.reason)) {
                stats.incrementStationaryJitterCount();
                lastStationaryKeepaliveElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
            }
            rememberCloudWindow(decision);
            appendDecision(rawPoint, decisionTrackPoint, decision,
                    trackPoints.isEmpty() ? "WAITING_FIRST_FIX" : "TRACKING");
            writeSessionJson();
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    private TrackPoint trackPointFromRaw(long trackPointId, long decisionId, long segmentId,
                                         RawPoint rawPoint, String result, String reason,
                                         double distanceDeltaMeters,
                                         double movingTimeDeltaSeconds) {
        if (hasRecentPressureSample(rawPoint)) {
            return new TrackPoint(trackPointId, rawPoint.rawPointId, decisionId, segmentId,
                    rawPoint.latitude, rawPoint.longitude,
                    rawPoint.hasAltitude, rawPoint.altitude,
                    rawPoint.hasVerticalAccuracy, rawPoint.verticalAccuracyMeters,
                    rawPoint.accuracyMeters,
                    rawPoint.hasSpeed, rawPoint.speedMetersPerSecond,
                    rawPoint.hasBearing, rawPoint.bearingDegrees,
                    rawPoint.timeMillis, rawPoint.elapsedRealtimeNanos,
                    result, reason, distanceDeltaMeters, movingTimeDeltaSeconds,
                    rawPoint.sourceGnssSnapshotId,
                    true, lastPressureSampleElapsedRealtimeNanos,
                    lastPressureHpa, lastRawBarometerAltitudeMeters);
        }
        return new TrackPoint(trackPointId, decisionId, segmentId, rawPoint,
                result, reason, distanceDeltaMeters, movingTimeDeltaSeconds);
    }

    private TrackPoint trackPointFromTrustDecision(long trackPointId, long decisionId,
                                                   long segmentId,
                                                   TrackTrustDecision decision) {
        RawPoint rawPoint = decision.sourceRawPoint;
        boolean hasPressure = hasRecentPressureSample(rawPoint);
        return new TrackPoint(trackPointId, rawPoint.rawPointId, decisionId, segmentId,
                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                rawPoint.hasAltitude, rawPoint.altitude,
                rawPoint.hasVerticalAccuracy, rawPoint.verticalAccuracyMeters,
                rawPoint.accuracyMeters,
                rawPoint.hasSpeed, rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing, rawPoint.bearingDegrees,
                rawPoint.timeMillis, rawPoint.elapsedRealtimeNanos,
                decision.result, decision.reason,
                decision.distanceDeltaMeters, decision.movingTimeDeltaSeconds,
                rawPoint.sourceGnssSnapshotId,
                decision.trustGrade, decision.cloudId, decision.representativeRawPointId,
                rawIdsToString(decision.contributingRawPointIds),
                decision.virtualTrackPointCoordinate,
                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                decision.cloudWeightedRadiusMeters,
                hasPressure, hasPressure ? lastPressureSampleElapsedRealtimeNanos : 0L,
                hasPressure ? lastPressureHpa : 0.0,
                hasPressure ? lastRawBarometerAltitudeMeters : 0.0);
    }

    private String rawIdsToString(List<Long> rawPointIds) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < rawPointIds.size(); i++) {
            if (i > 0) {
                builder.append(',');
            }
            builder.append(rawPointIds.get(i));
        }
        return builder.toString();
    }

    private boolean hasRecentPressureSample(RawPoint rawPoint) {
        if (!rawPoint.hasElapsedRealtimeNanos || lastPressureSampleElapsedRealtimeNanos <= 0L) {
            return false;
        }
        long ageNanos = Math.abs(rawPoint.elapsedRealtimeNanos
                - lastPressureSampleElapsedRealtimeNanos);
        return ageNanos <= PRESSURE_SAMPLE_MAX_AGE_NANOS;
    }

    private void maybeCalibrateBarometer(TrackPoint trackPoint, RawPoint rawPoint) {
        if (barometerCalibrated
                || trackPoint == null
                || rawPoint == null
                || !trackPoint.hasPressureSample
                || !isReliableGnssBarometerCalibrationReference(rawPoint)) {
            return;
        }
        barometerCalibrationOffsetMeters =
                rawPoint.altitude - trackPoint.rawBarometerAltitudeMeters;
        lastDisplayedBarometerAltitudeMeters =
                trackPoint.rawBarometerAltitudeMeters + barometerCalibrationOffsetMeters;
        barometerCalibrated = true;
        try {
            JSONObject event = new JSONObject();
            event.put("event", "barometer_calibration");
            event.put("barometerCalibrationId", ++barometerCalibrationSeq);
            event.put("source", "GNSS");
            event.put("trackPointId", trackPoint.trackPointId);
            event.put("rawPointId", rawPoint.rawPointId);
            event.put("pressureSampleElapsedRealtimeNanos",
                    trackPoint.pressureSampleElapsedRealtimeNanos);
            event.put("pressureHpa", trackPoint.pressureHpa);
            event.put("rawBarometerAltitudeMeters",
                    trackPoint.rawBarometerAltitudeMeters);
            event.put("referenceAltitudeMeters", rawPoint.altitude);
            event.put("calibrationOffsetMeters", barometerCalibrationOffsetMeters);
            event.put("displayedBarometerAltitudeMeters",
                    lastDisplayedBarometerAltitudeMeters);
            event.put("verticalAccuracyMeters", rawPoint.verticalAccuracyMeters);
            event.put("horizontalAccuracyMeters", rawPoint.accuracyMeters);
            appendDiagnostic(event, rawPoint.elapsedRealtimeNanos);
            addRecentSummary("气压计海拔已用 GNSS 校准");
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    private boolean isReliableGnssBarometerCalibrationReference(RawPoint rawPoint) {
        return rawPoint.hasAltitude
                && rawPoint.hasVerticalAccuracy
                && rawPoint.verticalAccuracyMeters > 0f
                && rawPoint.verticalAccuracyMeters
                <= BAROMETER_CALIBRATION_MAX_GNSS_VERTICAL_ACCURACY_METERS
                && rawPoint.hasAccuracy
                && rawPoint.accuracyMeters > 0f
                && rawPoint.accuracyMeters
                <= BAROMETER_CALIBRATION_MAX_GNSS_HORIZONTAL_ACCURACY_METERS;
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
        TrackPoint point = trackPointFromRaw(
                TRANSPORT_DISPLAY_POINT_ID_OFFSET + ++transportDisplayPointSeq,
                decisionId, segmentId, rawPoint, "transport", reason, 0.0, 0.0);
        transportTrackPoints.add(point);
    }

    public SamplingEpoch onSamplingPolicyChanged(String state, long intervalMillis,
                                                 float distanceMeters)
            throws IOException, JSONException {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return null;
        }
        long epochStartedNanos = SystemClock.elapsedRealtimeNanos();
        activeSamplingEpoch = new SamplingEpoch(++samplingPolicySeq, state,
                intervalMillis, distanceMeters, epochStartedNanos);
        JSONObject event = new JSONObject();
        event.put("event", "sampling_policy");
        event.put("samplingPolicyId", activeSamplingEpoch.samplingEpochId);
        event.put("samplingEpochId", activeSamplingEpoch.samplingEpochId);
        event.put("state", state);
        event.put("locationRequestProvider", "gps");
        event.put("locationRequestMinTimeMs", intervalMillis);
        event.put("locationRequestMinDistanceMeters", distanceMeters);
        event.put("locationRequestRegisteredElapsedRealtimeNanos", epochStartedNanos);
        event.put("locationRequestThread", "main");
        appendDiagnostic(event, epochStartedNanos);
        addRecentSummary("采样 " + state + " " + (intervalMillis / 1000L)
                + "s/" + String.format(Locale.US, "%.1fm", distanceMeters));
        writeSessionJson();
        return activeSamplingEpoch;
    }

    public void onInterrupted(String eventType) {
        if (!lifecycle.isActive() || lifecycle.isFinished()
                || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        try {
            appendPressureSummaryIfNeeded();
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
        appendDeviceMetadata(event);
        appendDiagnostic(event, recordStartElapsedRealtimeNanos);
    }

    private void appendDeviceMetadata(JSONObject json) throws JSONException {
        json.put("deviceManufacturer", safeBuildValue(Build.MANUFACTURER));
        json.put("deviceBrand", safeBuildValue(Build.BRAND));
        json.put("deviceModel", safeBuildValue(Build.MODEL));
        json.put("deviceName", safeBuildValue(Build.DEVICE));
        json.put("androidSdkInt", Build.VERSION.SDK_INT);
    }

    private String safeBuildValue(String value) {
        return value == null ? "" : value;
    }

    private void appendConfigSnapshot() throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "config_snapshot");
        event.put("configId", 1);
        event.put("strategyVersion", STRATEGY_VERSION);
        event.put("locationRequestProvider", "gps");
        event.put("locationRequestMinTimeMs", 1000);
        event.put("locationRequestMinDistanceMeters", 0);
        event.put("samplingEpochRequired", true);
        event.put("maxIntakeAccuracyMeters", trustConfig.maxIntakeAccuracyMeters);
        event.put("firstFixGoodAccuracyMeters", trustConfig.firstFixGoodAccuracyMeters);
        event.put("firstFixRelaxedAccuracyMeters", trustConfig.firstFixRelaxedAccuracyMeters);
        event.put("weakCloudAccuracyMeters", trustConfig.weakCloudAccuracyMeters);
        event.put("dynamicSamplingEnabled", true);
        event.put("dynamicSamplingKeepsDistanceFilterZero", true);
        event.put("gapLineBreakNanos", trustConfig.gapLineBreakNanos);
        event.put("impossibleSpeedMetersPerSecond",
                trustConfig.impossibleSpeedMetersPerSecond);
        event.put("transportSuspectedSpeedMetersPerSecond",
                trustConfig.transportSuspectedSpeedMetersPerSecond);
        event.put("transportSuspectedMinDistanceMeters",
                trustConfig.transportSuspectedMinDistanceMeters);
        event.put("stationaryCloudMinSamples", trustConfig.stationaryCloudMinSamples);
        event.put("movingCloudMinSamples", trustConfig.movingCloudMinSamples);
        event.put("recoveryCloudMinSamples", trustConfig.recoveryCloudMinSamples);
        event.put("stationaryCloudMinRadiusMeters", trustConfig.stationaryCloudMinRadiusMeters);
        event.put("movingCloudMinRadiusMeters", trustConfig.movingCloudMinRadiusMeters);
        event.put("recoveryCloudMinRadiusMeters", trustConfig.recoveryCloudMinRadiusMeters);
        event.put("startCloudMinWeight", trustConfig.startCloudMinWeight);
        event.put("stationaryCloudMinWeight", trustConfig.stationaryCloudMinWeight);
        event.put("movingCloudMinWeight", trustConfig.movingCloudMinWeight);
        event.put("recoveryCloudMinWeight", trustConfig.recoveryCloudMinWeight);
        event.put("cloudTemporalDecaySeconds", trustConfig.cloudTemporalDecaySeconds);
        event.put("trackTrustEngineEnabled", true);
        event.put("virtualTrackPointCoordinatesEnabled", true);
        event.put("samplingIntakeEnabled", true);
        appendDiagnostic(event, recordStartElapsedRealtimeNanos);
    }

    private void appendRuntimeSnapshot(boolean gpsProviderEnabled, boolean preciseLocationGranted,
                                       boolean foregroundServiceActive,
                                       boolean pressureSensorAvailable)
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
        event.put("pressureSensorAvailable", pressureSensorAvailable);
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

    private void appendRawLocation(RawPoint rawPoint, GnssSnapshotBuffer.Match snapshotMatch,
                                   SamplingEpoch samplingEpoch,
                                   long callbackReceivedElapsedRealtimeNanos)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "raw_location");
        event.put("rawPointId", rawPoint.rawPointId);
        if (samplingEpoch != null) {
            event.put("samplingEpochId", samplingEpoch.samplingEpochId);
            event.put("samplingState", samplingEpoch.state);
            event.put("requestedMinTimeMs", samplingEpoch.requestedMinTimeMillis);
            event.put("requestedMinDistanceMeters",
                    samplingEpoch.requestedMinDistanceMeters);
            event.put("samplingEpochStartedElapsedRealtimeNanos",
                    samplingEpoch.startedElapsedRealtimeNanos);
        }
        event.put("callbackReceivedElapsedRealtimeNanos", callbackReceivedElapsedRealtimeNanos);
        if (rawPoint.hasElapsedRealtimeNanos) {
            event.put("callbackDelayNanos",
                    Math.max(0L, callbackReceivedElapsedRealtimeNanos
                            - rawPoint.elapsedRealtimeNanos));
        }
        event.put("provider", rawPoint.provider);
        event.put("lat", rawPoint.latitude);
        event.put("lng", rawPoint.longitude);
        event.put("accuracy", rawPoint.hasAccuracy ? rawPoint.accuracyMeters : JSONObject.NULL);
        event.put("altitude", rawPoint.hasAltitude ? rawPoint.altitude : JSONObject.NULL);
        event.put("verticalAccuracy", rawPoint.hasVerticalAccuracy
                ? rawPoint.verticalAccuracyMeters : JSONObject.NULL);
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
        appendDiagnostic(event, rawPoint.hasElapsedRealtimeNanos
                && rawPoint.elapsedRealtimeNanos > 0L
                ? rawPoint.elapsedRealtimeNanos : callbackReceivedElapsedRealtimeNanos);
        addRecentSummary("Raw#" + rawPoint.rawPointId + " " + rawPoint.provider
                + " acc=" + (rawPoint.hasAccuracy
                ? String.format(Locale.US, "%.1fm", rawPoint.accuracyMeters)
                : "-"));
    }

    private void appendDecision(RawPoint rawPoint, TrackPoint trackPoint,
                                TrackTrustDecision decision, String decisionState)
            throws IOException, JSONException {
        long decisionId = ++decisionSeq;
        lastDecisionResult = decision.result;
        lastDecisionReason = decision.reason;
        JSONObject event = new JSONObject();
        event.put("event", "decision");
        event.put("decisionId", decisionId);
        event.put("rawPointId", rawPoint.rawPointId);
        event.put("result", decision.result);
        event.put("reason", decision.reason);
        event.put("state", decisionState);
        event.put("trustGrade", decision.trustGrade);
        event.put("cloudType", decision.cloudType);
        event.put("cloudId", decision.cloudId);
        event.put("cloudSampleCount", decision.cloudSampleCount);
        event.put("cloudWeightSum", decision.cloudWeightSum);
        event.put("cloudWeightedRadiusMeters", decision.cloudWeightedRadiusMeters);
        event.put("cloudCenterLatitude", decision.cloudCenterLatitude);
        event.put("cloudCenterLongitude", decision.cloudCenterLongitude);
        event.put("representativeRawPointId", decision.representativeRawPointId);
        event.put("contributingRawPointIds", rawIdsToJson(decision.contributingRawPointIds));
        event.put("isVirtualTrackPointCoordinate", decision.virtualTrackPointCoordinate);
        event.put("accuracyScore", decision.score.accuracyScore);
        event.put("samplingContinuityScore", decision.score.samplingContinuityScore);
        event.put("timeContinuityScore", decision.score.timeContinuityScore);
        event.put("spatialCohesionScore", decision.score.spatialCohesionScore);
        event.put("motionConsistencyScore", decision.score.motionConsistencyScore);
        event.put("gnssQualityScore", decision.score.gnssQualityScore);
        event.put("speedPlausibilityScore", decision.score.speedPlausibilityScore);
        event.put("samplingEpochId", decision.samplingEpochId);
        if (trackPoint != null) {
            event.put("trackPointId", trackPoint.trackPointId);
            event.put("segmentId", trackPoint.segmentId);
            event.put("distanceDeltaMeters", decision.distanceDeltaMeters);
            event.put("movingTimeDeltaSeconds", decision.movingTimeDeltaSeconds);
            if (decision.startsNewSegment) {
                event.put("startsNewSegment", true);
            }
            if (trackPoint.hasPressureSample) {
                event.put("pressureSampleElapsedRealtimeNanos",
                        trackPoint.pressureSampleElapsedRealtimeNanos);
                event.put("pressureHpa", trackPoint.pressureHpa);
                event.put("rawBarometerAltitudeMeters",
                        trackPoint.rawBarometerAltitudeMeters);
            }
        }
        if (rawPoint.sourceGnssSnapshotId != null) {
            event.put("sourceGnssSnapshotId", rawPoint.sourceGnssSnapshotId);
        }
        appendDiagnostic(event, rawPoint.elapsedRealtimeNanos);
        addRecentSummary("Decision#" + decisionId + " "
                + decision.trustGrade + " " + decision.reason);
    }

    private void rememberIntakeRejected(String reason) {
        lastDecisionResult = "intake_rejected";
        lastDecisionReason = reason == null ? "" : reason;
    }

    private JSONArray rawIdsToJson(List<Long> rawPointIds) {
        JSONArray array = new JSONArray();
        for (Long rawPointId : rawPointIds) {
            array.put(rawPointId);
        }
        return array;
    }

    private void appendLocationIntakeRejected(RawPoint rawPoint, String reason,
                                              SamplingEpoch samplingEpoch)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "location_intake_rejected");
        event.put("rawPointId", rawPoint.rawPointId);
        event.put("rejectReason", reason);
        if (samplingEpoch != null) {
            event.put("samplingEpochId", samplingEpoch.samplingEpochId);
            event.put("samplingState", samplingEpoch.state);
            event.put("samplingEpochStartedElapsedRealtimeNanos",
                    samplingEpoch.startedElapsedRealtimeNanos);
        }
        event.put("provider", rawPoint.provider);
        event.put("hasElapsedRealtimeNanos", rawPoint.hasElapsedRealtimeNanos);
        event.put("elapsedRealtimeNanos", rawPoint.elapsedRealtimeNanos);
        appendDiagnostic(event, rawPoint.hasElapsedRealtimeNanos
                && rawPoint.elapsedRealtimeNanos > 0L
                ? rawPoint.elapsedRealtimeNanos : SystemClock.elapsedRealtimeNanos());
        addRecentSummary("Intake reject Raw#" + rawPoint.rawPointId + " " + reason);
    }

    private void appendSessionIntegrityError(String reason, RawPoint rawPoint)
            throws IOException, JSONException {
        JSONObject event = new JSONObject();
        event.put("event", "session_integrity_error");
        event.put("reason", reason);
        event.put("rawPointId", rawPoint == null ? JSONObject.NULL : rawPoint.rawPointId);
        appendDiagnostic(event, rawPoint != null && rawPoint.hasElapsedRealtimeNanos
                && rawPoint.elapsedRealtimeNanos > 0L
                ? rawPoint.elapsedRealtimeNanos : SystemClock.elapsedRealtimeNanos());
    }

    private void incrementIntakeRejectCount(String reason) {
        intakeRejectedCount++;
        if ("sampling_epoch_mismatch".equals(reason)) {
            samplingEpochMismatchCount++;
        } else if ("duplicate_fix".equals(reason)) {
            duplicateFixCount++;
        } else if ("out_of_order_fix".equals(reason)) {
            outOfOrderFixCount++;
        }
    }

    private int countTrustGrade(List<TrackPoint> points, String trustGrade) {
        int count = 0;
        for (TrackPoint point : points) {
            if (trustGrade.equals(point.trustGrade)) {
                count++;
            }
        }
        return count;
    }

    private void rememberCloudWindow(TrackTrustDecision decision) {
        if (decision == null || countedCloudIds.contains(decision.cloudId)) {
            return;
        }
        countedCloudIds.add(decision.cloudId);
        Integer count = cloudWindowCounts.get(decision.cloudType);
        cloudWindowCounts.put(decision.cloudType, count == null ? 1 : count + 1);
    }

    private JSONObject cloudWindowCountsJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("START_CLOUD", countCloudWindow("START_CLOUD"));
        json.put("MOVING_CLOUD", countCloudWindow("MOVING_CLOUD"));
        json.put("STATIONARY_CLOUD", countCloudWindow("STATIONARY_CLOUD"));
        json.put("RECOVERY_CLOUD", countCloudWindow("RECOVERY_CLOUD"));
        json.put("WEAK_CLOUD", countCloudWindow("WEAK_CLOUD"));
        json.put("TRANSPORT_CLOUD", countCloudWindow("TRANSPORT_CLOUD"));
        return json;
    }

    private int countCloudWindow(String cloudType) {
        Integer count = cloudWindowCounts.get(cloudType);
        return count == null ? 0 : count;
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
        appendDeviceMetadata(json);
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", journalWriter.getLastEventSeq());
        json.put("lastUpdatedWallTimeMillis", journalWriter.getLastUpdatedWallTimeMillis());
        json.put("trackPointCount", trackPoints.size());
        json.put("weakTrackPointCount", weakTrackPoints.size());
        json.put("rawPointCount", rawPointSeq);
        json.put("intakeRejectedCount", intakeRejectedCount);
        json.put("samplingContractViolationCount", samplingContractViolationCount);
        json.put("samplingEpochMismatchCount", samplingEpochMismatchCount);
        json.put("duplicateFixCount", duplicateFixCount);
        json.put("outOfOrderFixCount", outOfOrderFixCount);
        json.put("recoveryCloudCount", recoveryCloudCount);
        json.put("virtualTrackPointCount", virtualTrackPointCount);
        JSONObject trustGradeCounts = new JSONObject();
        trustGradeCounts.put("ANCHOR", countTrustGrade(trackPoints, "ANCHOR"));
        trustGradeCounts.put("TRUSTED", countTrustGrade(trackPoints, "TRUSTED"));
        trustGradeCounts.put("RECOVERY", countTrustGrade(trackPoints, "RECOVERY"));
        trustGradeCounts.put("WEAK", weakTrackPoints.size());
        json.put("trustGradeCounts", trustGradeCounts);
        json.put("cloudWindowCounts", cloudWindowCountsJson());
        json.put("stationaryKeepaliveCount", stats.getStationaryKeepaliveCount());
        json.put("stationaryJitterCount", stats.getStationaryJitterCount());
        json.put("gapCount", stats.getGapCount());
        json.put("transportCount", stats.getTransportCount());
        json.put("pressureSensorAvailable", pressureSensorAvailable);
        json.put("pressureSampleCount", pressureSampleSeq);
        json.put("barometerCalibrated", barometerCalibrated);
        json.put("barometerCalibrationCount", barometerCalibrationSeq);
        if (barometerCalibrated) {
            json.put("barometerCalibrationOffsetMeters", barometerCalibrationOffsetMeters);
            json.put("lastDisplayedBarometerAltitudeMeters",
                    lastDisplayedBarometerAltitudeMeters);
        }
        TrackAscentCalculator.Result ascentResult = getAscentResult();
        json.put("selectedTotalAscentMeters", ascentResult.totalAscentMeters);
        json.put("selectedAscentSource", ascentResult.source);
        json.put("barometerTotalAscentMeters", ascentResult.barometerTotalAscentMeters);
        json.put("barometerAscentSampleCount", ascentResult.barometerSampleCount);
        json.put("barometerAscentRejectedSampleCount",
                ascentResult.barometerRejectedSampleCount);
        json.put("gnssTotalAscentMeters", ascentResult.gnssTotalAscentMeters);
        json.put("gnssAscentSampleCount", ascentResult.gnssSampleCount);
        json.put("gnssAscentRejectedSampleCount", ascentResult.gnssRejectedSampleCount);
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

    public List<TrackAscentCalculator.BarometerSample> getBarometerAscentSamples() {
        return new ArrayList<>(barometerAscentSamples);
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

    public String getTrackTrustStateName() {
        return "TRACK_TRUST_V3";
    }

    public float getLastRawAccuracyMeters() {
        return lastRawAccuracyMeters;
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

    public boolean isPressureSensorAvailable() {
        return pressureSensorAvailable;
    }

    public long getPressureSampleCount() {
        return pressureSampleSeq;
    }

    public boolean isBarometerCalibrated() {
        return barometerCalibrated;
    }

    public double getBarometerCalibrationOffsetMeters() {
        return barometerCalibrationOffsetMeters;
    }

    public double getLastDisplayedBarometerAltitudeMeters() {
        return barometerCalibrated ? lastDisplayedBarometerAltitudeMeters : Double.NaN;
    }

    public double getLastRawBarometerAltitudeMeters() {
        return pressureSampleSeq > 0L ? lastRawBarometerAltitudeMeters : Double.NaN;
    }

    public String getCurrentAscentSource() {
        return getAscentResult().source;
    }

    public double getTotalAscentMeters() {
        return getAscentResult().totalAscentMeters;
    }

    public TrackAscentCalculator.Result getAscentResult() {
        if (cachedAscentResult == null || ascentResultDirty) {
            cachedAscentResult = TrackAscentCalculator.ascentResult(
                    ascentTrackPoints(), new ArrayList<>(barometerAscentSamples));
            ascentResultDirty = false;
        }
        return cachedAscentResult;
    }

    private void invalidateAscentResult() {
        ascentResultDirty = true;
    }

    private long addBarometerAscentSample(float pressureHpa, int sensorAccuracy,
                                          long elapsedRealtimeNanos,
                                          double rawAltitudeMeters) {
        long barometerSampleId = barometerAscentSamples.size() + 1L;
        barometerAscentSamples.add(new TrackAscentCalculator.BarometerSample(
                barometerSampleId, elapsedRealtimeNanos, pressureHpa,
                sensorAccuracy, rawAltitudeMeters));
        invalidateAscentResult();
        return barometerSampleId;
    }

    private void appendRejectedPressureSample(long barometerSampleId, float pressureHpa,
                                              int sensorAccuracy,
                                              long elapsedRealtimeNanos) {
        try {
            JSONObject event = new JSONObject();
            event.put("event", "pressure_sample_rejected");
            event.put("barometerSampleId", barometerSampleId);
            event.put("sensorAccuracy", sensorAccuracy);
            event.put("rejectReason", "invalid_pressure");
            if (Float.isNaN(pressureHpa) || Float.isInfinite(pressureHpa)) {
                event.put("pressureHpaText", String.valueOf(pressureHpa));
            } else {
                event.put("pressureHpa", pressureHpa);
            }
            appendDiagnostic(event, elapsedRealtimeNanos);
        } catch (IOException | JSONException e) {
            markIntegrityError("diagnostic_log_append_failed", e);
        }
    }

    private boolean isValidPressure(float pressureHpa) {
        return pressureHpa > 0f && !Float.isNaN(pressureHpa) && !Float.isInfinite(pressureHpa);
    }

    private List<TrackPoint> ascentTrackPoints() {
        List<TrackPoint> points = new ArrayList<>(trackPoints.size() + weakTrackPoints.size());
        points.addAll(trackPoints);
        points.addAll(weakTrackPoints);
        Collections.sort(points, Comparator.comparingLong(point -> point.elapsedRealtimeNanos));
        return points;
    }

    public List<String> getRecentSummaries() {
        return new ArrayList<>(recentSummaries);
    }

    public String getSessionDirPath() {
        return sessionDir == null ? "" : sessionDir.getAbsolutePath();
    }

    public String suggestedGpxFileName() {
        return "gnss_track_trusted_" + safeSessionName() + ".gpx";
    }

    public String suggestedPartialGpxFileName() {
        return "gnss_track_partial_" + safeSessionName() + ".gpx";
    }

    public String suggestedDiagnosticFileName() {
        return "gnss_diagnostic_" + safeSessionName() + ".jsonl";
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

    private void resetPressureDiagnostics() {
        pressureSummaryWritten = false;
        firstPressureSampleElapsedRealtimeNanos = 0L;
        lastPressureSampleElapsedRealtimeNanos = 0L;
        minPressureHpa = 0.0;
        maxPressureHpa = 0.0;
        lastPressureHpa = 0.0;
        lastRawBarometerAltitudeMeters = 0.0;
        barometerCalibrated = false;
        barometerCalibrationOffsetMeters = 0.0;
        lastDisplayedBarometerAltitudeMeters = 0.0;
    }

    private void appendPressureSummaryIfNeeded() throws IOException, JSONException {
        if (pressureSummaryWritten || !journalWriter.isDiagnosticLoggerOpen()) {
            return;
        }
        pressureSummaryWritten = true;
        JSONObject event = new JSONObject();
        event.put("event", "pressure_summary");
        event.put("pressureSensorAvailable", pressureSensorAvailable);
        event.put("pressureSampleCount", pressureSampleSeq);
        event.put("barometerCalibrated", barometerCalibrated);
        event.put("barometerCalibrationCount", barometerCalibrationSeq);
        if (barometerCalibrated) {
            event.put("calibrationOffsetMeters", barometerCalibrationOffsetMeters);
            event.put("lastDisplayedBarometerAltitudeMeters",
                    lastDisplayedBarometerAltitudeMeters);
        }
        if (!barometerAscentSamples.isEmpty()) {
            TrackAscentCalculator.Result ascentResult = getAscentResult();
            event.put("selectedTotalAscentMeters", ascentResult.totalAscentMeters);
            event.put("selectedAscentSource", ascentResult.source);
            event.put("barometerTotalAscentMeters", ascentResult.barometerTotalAscentMeters);
            event.put("barometerAscentSampleCount", ascentResult.barometerSampleCount);
            event.put("barometerAscentRejectedSampleCount",
                    ascentResult.barometerRejectedSampleCount);
            event.put("gnssTotalAscentMeters", ascentResult.gnssTotalAscentMeters);
            event.put("gnssAscentSampleCount", ascentResult.gnssSampleCount);
            event.put("gnssAscentRejectedSampleCount", ascentResult.gnssRejectedSampleCount);
        }
        if (pressureSampleSeq > 0L) {
            event.put("firstPressureSampleElapsedRealtimeNanos",
                    firstPressureSampleElapsedRealtimeNanos);
            event.put("lastPressureSampleElapsedRealtimeNanos",
                    lastPressureSampleElapsedRealtimeNanos);
            event.put("minPressureHpa", minPressureHpa);
            event.put("maxPressureHpa", maxPressureHpa);
            event.put("lastPressureHpa", lastPressureHpa);
            event.put("lastRawBarometerAltitudeMeters", lastRawBarometerAltitudeMeters);
            addRecentSummary("气压计样本 " + pressureSampleSeq + " 条");
        }
        long eventElapsedRealtimeNanos = lastPressureSampleElapsedRealtimeNanos > 0L
                ? lastPressureSampleElapsedRealtimeNanos
                : SystemClock.elapsedRealtimeNanos();
        appendDiagnostic(event, eventElapsedRealtimeNanos);
    }

    @Override
    public void close() {
        closeLoggerQuietly();
    }

}
