package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.engine.SamplingEpoch;
import com.example.gnsssatdemo.track.engine.SamplingIntake;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.engine.TrackTrustDecision;
import com.example.gnsssatdemo.track.engine.TrackTrustEngine;
import com.example.gnsssatdemo.track.model.DeviceMotionWindow;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.GnssSnapshotDiagnosticFields;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class EvidenceTrackProductBuilder {
    private static final long WEAK_TRACK_POINT_ID_OFFSET = 1_000_000_000L;

    public Result build(File evidenceJsonl) throws IOException, JSONException {
        long recordStartElapsedRealtimeNanos = -1L;
        long nowElapsedRealtimeNanos = -1L;
        long samplingEpochSeq = 0L;
        long decisionSeq = 0L;
        long trackPointSeq = 0L;
        long weakTrackPointSeq = 0L;
        long segmentId = 1L;
        SamplingEpoch activeEpoch = null;
        SamplingIntake samplingIntake = new SamplingIntake();
        TrackTrustEngine trustEngine = new TrackTrustEngine();
        Map<Long, SamplingEpoch> samplingEpochs = new HashMap<>();
        Map<Long, GnssQualitySnapshot> gnssSnapshots = new HashMap<>();
        List<DeviceMotionWindow> motionWindows = new ArrayList<>();
        List<TrackPoint> trackPoints = new ArrayList<>();
        List<DecisionRecord> decisions = new ArrayList<>();
        List<TrackAscentCalculator.BarometerSample> barometerSamples = new ArrayList<>();
        Stats stats = new Stats();
        TrackPoint previousTrustedTrackPoint = null;

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(evidenceJsonl), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                JSONObject event = new JSONObject(trimmed);
                String eventName = event.optString("event", "");
                if ("session_metadata".equals(eventName)) {
                    recordStartElapsedRealtimeNanos =
                            event.optLong("createdElapsedRealtimeNanos", -1L);
                    nowElapsedRealtimeNanos = Math.max(nowElapsedRealtimeNanos,
                            recordStartElapsedRealtimeNanos);
                    activeEpoch = new SamplingEpoch(++samplingEpochSeq, "STARTING",
                            1000L, 0f, recordStartElapsedRealtimeNanos);
                    samplingEpochs.put(activeEpoch.samplingEpochId, activeEpoch);
                } else if ("sampling_policy".equals(eventName)) {
                    long eventTime = event.optLong("eventElapsedRealtimeNanos",
                            nowElapsedRealtimeNanos);
                    long epochId = event.has("samplingEpochId")
                            ? event.optLong("samplingEpochId") : ++samplingEpochSeq;
                    samplingEpochSeq = Math.max(samplingEpochSeq, epochId);
                    activeEpoch = new SamplingEpoch(epochId, event.optString("state", ""),
                            event.optLong("locationRequestMinTimeMs", 1000L),
                            (float) event.optDouble("locationRequestMinDistanceMeters", 0.0),
                            eventTime);
                    samplingEpochs.put(activeEpoch.samplingEpochId, activeEpoch);
                } else if (GnssSnapshotDiagnosticFields.EVENT.equals(eventName)) {
                    GnssQualitySnapshot snapshot = gnssSnapshotFromEvent(event);
                    gnssSnapshots.put(snapshot.snapshotId, snapshot);
                } else if ("device_motion_window".equals(eventName)) {
                    motionWindows.add(deviceMotionWindowFromEvent(event));
                } else if ("barometer_window".equals(eventName)) {
                    barometerSamples.add(barometerSampleFromWindow(event));
                } else if ("raw_location".equals(eventName)) {
                    RawPoint rawPoint = rawPointFromEvent(event);
                    stats.rawLocationCount++;
                    if (recordStartElapsedRealtimeNanos <= 0L) {
                        recordStartElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
                    }
                    long receivedElapsedRealtimeNanos = event.optLong(
                            "callbackReceivedElapsedRealtimeNanos",
                            event.optLong("eventElapsedRealtimeNanos",
                                    rawPoint.elapsedRealtimeNanos + 1_000_000L));
                    nowElapsedRealtimeNanos = Math.max(nowElapsedRealtimeNanos,
                            receivedElapsedRealtimeNanos);
                    SamplingEpoch rawEpoch = samplingEpochForRawEvent(event, activeEpoch,
                            samplingEpochs, recordStartElapsedRealtimeNanos);
                    SamplingIntake.Result intake = samplingIntake.accept(rawPoint, rawEpoch,
                            recordStartElapsedRealtimeNanos, nowElapsedRealtimeNanos);
                    if (!intake.accepted) {
                        stats.intakeRejectedCount++;
                        stats.increment("intake_rejected:" + intake.reason);
                        decisions.add(new DecisionRecord(rawPoint.rawPointId,
                                rawPoint.elapsedRealtimeNanos, "intake_rejected",
                                intake.reason, rawPoint.sourceGnssSnapshotId));
                        continue;
                    }
                    TrackTrustDecision decision = trustEngine.decide(rawPoint, rawEpoch,
                            snapshotById(gnssSnapshots, rawPoint.sourceGnssSnapshotId),
                            motionWindows, previousTrustedTrackPoint);
                    decisionSeq++;
                    stats.decisionCount++;
                    stats.increment(decision.result + ":" + decision.reason);
                    decisions.add(new DecisionRecord(rawPoint.rawPointId,
                            rawPoint.elapsedRealtimeNanos, decision.result, decision.reason,
                            rawPoint.sourceGnssSnapshotId));
                    if (decision.createsTrustedTrackPoint()) {
                        if (decision.startsNewSegment && previousTrustedTrackPoint != null) {
                            segmentId++;
                        }
                        TrackPoint trackPoint = trackPointFromDecision(++trackPointSeq,
                                decisionSeq, segmentId, decision);
                        trackPoints.add(trackPoint);
                        previousTrustedTrackPoint = trackPoint;
                        stats.trustedDecisionCount++;
                        if (isGapRecoveryReason(decision.reason)) {
                            stats.gapRecoveryCount++;
                            if (decision.distanceDeltaMeters == 0.0) {
                                stats.gapRecoveryZeroDeltaCount++;
                            }
                        }
                    } else if ("weak".equals(decision.result)) {
                        trackPoints.add(trackPointFromDecision(
                                WEAK_TRACK_POINT_ID_OFFSET + ++weakTrackPointSeq,
                                decisionSeq, segmentId, decision));
                        stats.weakDecisionCount++;
                    } else {
                        stats.rejectDecisionCount++;
                    }
                }
            }
        }
        return new Result(trackPoints, decisions, barometerSamples, stats);
    }

    private TrackPoint trackPointFromDecision(long trackPointId, long decisionId, long segmentId,
                                              TrackTrustDecision decision) {
        RawPoint rawPoint = decision.sourceRawPoint;
        return new TrackPoint(trackPointId, rawPoint.rawPointId, decisionId, segmentId,
                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                rawPoint.hasAltitude, rawPoint.altitude,
                rawPoint.hasVerticalAccuracy, rawPoint.verticalAccuracyMeters,
                rawPoint.accuracyMeters, rawPoint.hasSpeed, rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing, rawPoint.bearingDegrees,
                rawPoint.timeMillis, rawPoint.elapsedRealtimeNanos,
                decision.result, decision.reason,
                decision.distanceDeltaMeters, decision.movingTimeDeltaSeconds,
                rawPoint.sourceGnssSnapshotId, decision.trustGrade, decision.cloudId,
                decision.representativeRawPointId,
                decision.contributingRawPointIds.toString(),
                decision.virtualTrackPointCoordinate,
                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                decision.cloudWeightedRadiusMeters,
                false, 0L, 0.0, 0.0);
    }

    private SamplingEpoch samplingEpochForRawEvent(JSONObject event, SamplingEpoch activeEpoch,
                                                   Map<Long, SamplingEpoch> samplingEpochs,
                                                   long recordStartElapsedRealtimeNanos) {
        if (event.has("samplingEpochId")) {
            long epochId = event.optLong("samplingEpochId");
            SamplingEpoch existing = samplingEpochs.get(epochId);
            if (existing != null) {
                return existing;
            }
            SamplingEpoch fromRaw = new SamplingEpoch(epochId,
                    event.optString("samplingState", ""),
                    event.optLong("requestedMinTimeMs", 1000L),
                    (float) event.optDouble("requestedMinDistanceMeters", 0.0),
                    event.optLong("samplingEpochStartedElapsedRealtimeNanos",
                            recordStartElapsedRealtimeNanos));
            samplingEpochs.put(epochId, fromRaw);
            return fromRaw;
        }
        if (activeEpoch != null) {
            return activeEpoch;
        }
        return new SamplingEpoch(1L, "STARTING", 1000L, 0f,
                recordStartElapsedRealtimeNanos);
    }

    private GnssQualitySnapshot snapshotById(Map<Long, GnssQualitySnapshot> snapshots,
                                             Long snapshotId) {
        if (snapshotId == null) {
            return null;
        }
        return snapshots.get(snapshotId);
    }

    private boolean isGapRecoveryReason(String reason) {
        return "gap_recovery".equals(reason)
                || "continuity_rescue_gap_recovery".equals(reason)
                || "recovery_transport_suspected_kept".equals(reason);
    }

    private GnssQualitySnapshot gnssSnapshotFromEvent(JSONObject event) {
        return new GnssQualitySnapshot(event.optLong("snapshotId"),
                event.optLong("receivedElapsedRealtimeNanos"),
                event.optInt("visibleTotal"), event.optInt("usedInFixTotal"),
                (float) event.optDouble("usedAvgCn0", 0.0),
                (float) event.optDouble("allAvgCn0", 0.0),
                (float) event.optDouble("top4AvgCn0", 0.0),
                event.optInt("lowCn0VisibleCount"),
                event.optInt("weakUsedCount"),
                event.optInt("gpsUsed"), event.optInt("beidouUsed"),
                event.optInt("galileoUsed"), event.optInt("glonassUsed"),
                event.optInt("qzssUsed"),
                event.optInt("gpsVisible"), event.optInt("beidouVisible"),
                event.optInt("galileoVisible"), event.optInt("glonassVisible"),
                event.optInt("qzssVisible"), event.optInt("sbasVisible"),
                event.optInt("irnssVisible"), event.optInt("unknownVisible"),
                event.optInt("otherVisible"), event.optBoolean("hasDualFrequency"));
    }

    private DeviceMotionWindow deviceMotionWindowFromEvent(JSONObject event) {
        return new DeviceMotionWindow(event.optLong("deviceMotionWindowId"),
                event.optLong("startElapsedRealtimeNanos"),
                event.optLong("endElapsedRealtimeNanos"),
                event.optInt("linearAccelerationSampleCount"),
                event.optInt("accelerometerSampleCount"),
                event.optInt("gyroscopeSampleCount"),
                event.optInt("rotationVectorSampleCount"),
                event.optDouble("linearAccelerationRmsMps2", 0.0),
                event.optDouble("linearAccelerationMaxMps2", 0.0),
                event.optDouble("accelerometerDynamicRmsMps2", 0.0),
                event.optDouble("accelerometerDynamicMaxMps2", 0.0),
                event.optDouble("gyroscopeRmsRadps", 0.0),
                event.optDouble("gyroscopeMaxRadps", 0.0),
                event.optDouble("yawDeltaDegrees", 0.0),
                event.optDouble("pitchDeltaDegrees", 0.0),
                event.optDouble("rollDeltaDegrees", 0.0),
                event.optInt("stepDetectorCount"),
                event.optInt("stepCounterDelta"),
                event.optBoolean("stepCounterAvailable"));
    }

    private TrackAscentCalculator.BarometerSample barometerSampleFromWindow(JSONObject event) {
        return new TrackAscentCalculator.BarometerSample(
                event.optLong("barometerWindowId", 0L),
                event.optLong("endElapsedRealtimeNanos",
                        event.optLong("eventElapsedRealtimeNanos", 0L)),
                (float) event.optDouble("avgPressureHpa", 0.0),
                event.optInt("lastSensorAccuracy", 3),
                event.optDouble("avgRawAltitudeMeters", 0.0));
    }

    private RawPoint rawPointFromEvent(JSONObject event) {
        Object accuracy = event.opt("accuracy");
        boolean hasAccuracy = accuracy != null && accuracy != JSONObject.NULL;
        boolean hasAltitude = event.has("altitude") && event.opt("altitude") != JSONObject.NULL;
        boolean hasVerticalAccuracy = event.has("verticalAccuracy")
                && event.opt("verticalAccuracy") != JSONObject.NULL;
        boolean hasSpeed = event.has("speed") && event.opt("speed") != JSONObject.NULL;
        boolean hasBearing = event.has("bearing") && event.opt("bearing") != JSONObject.NULL;
        return new RawPoint(event.optLong("rawPointId"),
                event.optString("provider", ""),
                event.optDouble("lat"), event.optDouble("lng"),
                hasAltitude, event.optDouble("altitude", 0.0),
                hasVerticalAccuracy, (float) event.optDouble("verticalAccuracy", 0.0),
                hasAccuracy, (float) event.optDouble("accuracy", 0.0),
                hasSpeed, (float) event.optDouble("speed", 0.0),
                hasBearing, (float) event.optDouble("bearing", 0.0),
                event.optLong("timeMillis", 0L),
                event.optBoolean("hasElapsedRealtimeNanos", event.has("elapsedRealtimeNanos")),
                event.optLong("elapsedRealtimeNanos", 0L),
                event.optBoolean("mock", false),
                event.has("sourceGnssSnapshotId")
                        ? event.optLong("sourceGnssSnapshotId") : null);
    }

    public static class Result {
        public final List<TrackPoint> trackPoints;
        public final List<DecisionRecord> decisions;
        public final List<TrackAscentCalculator.BarometerSample> barometerSamples;
        public final Stats stats;

        Result(List<TrackPoint> trackPoints,
               List<DecisionRecord> decisions,
               List<TrackAscentCalculator.BarometerSample> barometerSamples,
               Stats stats) {
            this.trackPoints = trackPoints;
            this.decisions = decisions;
            this.barometerSamples = barometerSamples;
            this.stats = stats;
        }
    }

    public static class DecisionRecord {
        public final long rawPointId;
        public final long elapsedRealtimeNanos;
        public final String result;
        public final String reason;
        public final Long sourceGnssSnapshotId;

        DecisionRecord(long rawPointId, long elapsedRealtimeNanos, String result,
                       String reason, Long sourceGnssSnapshotId) {
            this.rawPointId = rawPointId;
            this.elapsedRealtimeNanos = elapsedRealtimeNanos;
            this.result = result;
            this.reason = reason;
            this.sourceGnssSnapshotId = sourceGnssSnapshotId;
        }
    }

    public static class Stats {
        public int rawLocationCount;
        public int decisionCount;
        public int trustedDecisionCount;
        public int weakDecisionCount;
        public int rejectDecisionCount;
        public int intakeRejectedCount;
        public int gapRecoveryCount;
        public int gapRecoveryZeroDeltaCount;
        public final Map<String, Integer> decisionReasonCounts = new LinkedHashMap<>();

        void increment(String key) {
            Integer count = decisionReasonCounts.get(key);
            decisionReasonCounts.put(key, count == null ? 1 : count + 1);
        }
    }
}
