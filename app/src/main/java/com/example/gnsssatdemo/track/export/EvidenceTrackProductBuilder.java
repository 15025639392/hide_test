package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.engine.SamplingEpoch;
import com.example.gnsssatdemo.track.engine.SamplingIntake;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.engine.TrackTrustDecision;
import com.example.gnsssatdemo.track.engine.TrackTrustEngine;
import com.example.gnsssatdemo.track.model.DeviceMotionWindow;
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
import java.util.Collections;
import java.util.Comparator;

public class EvidenceTrackProductBuilder {
    private static final long WEAK_TRACK_POINT_ID_OFFSET = 1_000_000_000L;
    private static final double STATIONARY_DISTANCE_METERS = 5.0;
    private static final double STATIONARY_ACCURACY_MULTIPLIER = 1.5;
    private static final double STATIONARY_SESSION_STILL_RATIO = 0.95;
    private static final double STATIONARY_SESSION_ANCHOR_RATIO = 0.8;

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
                                intake.reason));
                        continue;
                    }
                    TrackTrustDecision decision = trustEngine.decide(rawPoint, rawEpoch,
                            motionWindows, previousTrustedTrackPoint);
                    decisionSeq++;
                    stats.decisionCount++;
                    stats.increment(decision.result + ":" + decision.reason);
                    decisions.add(new DecisionRecord(rawPoint.rawPointId,
                            rawPoint.elapsedRealtimeNanos, decision.result, decision.reason));
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
        List<TrackPoint> displayTrackPoints = cleanDisplayTrackPoints(trackPoints, motionWindows);
        return new Result(trackPoints, displayTrackPoints, decisions, barometerSamples, stats);
    }

    public static List<TrackPoint> cleanDisplayTrackPoints(List<TrackPoint> points,
                                                           List<DeviceMotionWindow> motionWindows) {
        List<TrackPoint> trustedPoints = new ArrayList<>();
        List<TrackPoint> weakPoints = new ArrayList<>();
        for (TrackPoint point : points) {
            if ("weak".equals(point.decisionResult)) {
                weakPoints.add(point);
            } else {
                trustedPoints.add(point);
            }
        }
        List<TrackPoint> cleaned = pruneRedundantStationaryAnchors(trustedPoints);
        cleaned = pruneStationaryGapRecoveryJitter(cleaned);
        cleaned = pruneIsolatedStationaryMovement(cleaned);
        cleaned = pruneStationaryLowSpeedTail(cleaned);
        cleaned = collapseStationarySessionIfNeeded(cleaned, motionWindows);
        if (weakPoints.isEmpty()) {
            return cleaned;
        }
        List<TrackPoint> display = new ArrayList<>(cleaned.size() + weakPoints.size());
        display.addAll(cleaned);
        display.addAll(weakPoints);
        sortTrackPoints(display);
        return display;
    }

    private static void sortTrackPoints(List<TrackPoint> points) {
        Collections.sort(points, new Comparator<TrackPoint>() {
            @Override
            public int compare(TrackPoint left, TrackPoint right) {
                int byTime = Long.compare(left.elapsedRealtimeNanos, right.elapsedRealtimeNanos);
                if (byTime != 0) {
                    return byTime;
                }
                return Long.compare(left.sourceRawPointId, right.sourceRawPointId);
            }
        });
    }

    private static List<TrackPoint> pruneRedundantStationaryAnchors(List<TrackPoint> points) {
        List<TrackPoint> cleaned = new ArrayList<>();
        TrackPoint activeStationaryAnchor = null;
        for (TrackPoint point : points) {
            if ("stationary_anchor".equals(point.decisionReason)
                    && activeStationaryAnchor != null
                    && distanceMeters(activeStationaryAnchor, point) <= stationaryThreshold(point)) {
                continue;
            }
            cleaned.add(point);
            activeStationaryAnchor = "stationary_anchor".equals(point.decisionReason)
                    ? point : null;
        }
        return cleaned;
    }

    private static List<TrackPoint> pruneStationaryGapRecoveryJitter(List<TrackPoint> points) {
        List<TrackPoint> cleaned = new ArrayList<>();
        TrackPoint activeStationaryAnchor = null;
        for (TrackPoint point : points) {
            if ("gap_recovery".equals(point.decisionReason)
                    && activeStationaryAnchor != null
                    && distanceMeters(activeStationaryAnchor, point) <= stationaryThreshold(point)) {
                continue;
            }
            cleaned.add(point);
            activeStationaryAnchor = "stationary_anchor".equals(point.decisionReason)
                    ? point : null;
        }
        return cleaned;
    }

    private static List<TrackPoint> pruneIsolatedStationaryMovement(List<TrackPoint> points) {
        List<TrackPoint> cleaned = new ArrayList<>();
        for (int i = 0; i < points.size(); i++) {
            TrackPoint point = points.get(i);
            TrackPoint next = i + 1 < points.size() ? points.get(i + 1) : null;
            if ("moving_good_fix".equals(point.decisionReason)
                    && next != null
                    && "stationary_anchor".equals(next.decisionReason)
                    && distanceMeters(point, next) <= Math.max(STATIONARY_DISTANCE_METERS, 10.0)) {
                continue;
            }
            cleaned.add(point);
        }
        return cleaned;
    }

    private static List<TrackPoint> pruneStationaryLowSpeedTail(List<TrackPoint> points) {
        boolean[] remove = new boolean[points.size()];
        double tailDistanceMeters = Math.max(STATIONARY_DISTANCE_METERS, 10.0);
        for (int i = 0; i < points.size(); i++) {
            TrackPoint anchor = points.get(i);
            if (!"stationary_anchor".equals(anchor.decisionReason)) {
                continue;
            }
            for (int cursor = i - 1; cursor >= 0; cursor--) {
                TrackPoint point = points.get(cursor);
                if (!isStationaryTailCandidate(point)) {
                    break;
                }
                if (distanceMeters(point, anchor) > tailDistanceMeters) {
                    break;
                }
                remove[cursor] = true;
            }
        }
        List<TrackPoint> cleaned = new ArrayList<>();
        for (int i = 0; i < points.size(); i++) {
            if (!remove[i]) {
                cleaned.add(points.get(i));
            }
        }
        return cleaned;
    }

    private static boolean isStationaryTailCandidate(TrackPoint point) {
        return "motion_supported_low_speed".equals(point.decisionReason)
                || "continuity_rescue_low_accuracy".equals(point.decisionReason);
    }

    private static List<TrackPoint> collapseStationarySessionIfNeeded(List<TrackPoint> points,
                                                                      List<DeviceMotionWindow> motionWindows) {
        List<TrackPoint> trustedPoints = trustedDisplayPoints(points);
        if (trustedPoints.size() <= 1) {
            return points;
        }
        double stillRatio = stillMotionRatio(motionWindows);
        double stationaryAnchorRatio = stationaryAnchorRatio(trustedPoints);
        if (stillRatio < STATIONARY_SESSION_STILL_RATIO
                || stationaryAnchorRatio < STATIONARY_SESSION_ANCHOR_RATIO) {
            return points;
        }
        TrackPoint collapsed = stationarySessionAnchor(trustedPoints);
        List<TrackPoint> cleaned = new ArrayList<>();
        cleaned.add(collapsed);
        for (TrackPoint point : points) {
            if ("weak".equals(point.decisionResult)) {
                cleaned.add(point);
            }
        }
        return cleaned;
    }

    private static List<TrackPoint> trustedDisplayPoints(List<TrackPoint> points) {
        List<TrackPoint> trusted = new ArrayList<>();
        for (TrackPoint point : points) {
            if (!"weak".equals(point.decisionResult)) {
                trusted.add(point);
            }
        }
        return trusted;
    }

    private static double stationaryAnchorRatio(List<TrackPoint> points) {
        if (points.isEmpty()) {
            return 0.0;
        }
        int anchorCount = 0;
        for (TrackPoint point : points) {
            if ("stationary_anchor".equals(point.decisionReason)
                    || "first_fix_good".equals(point.decisionReason)
                    || "first_fix_relaxed".equals(point.decisionReason)) {
                anchorCount++;
            }
        }
        return anchorCount / (double) points.size();
    }

    private static double stillMotionRatio(List<DeviceMotionWindow> motionWindows) {
        if (motionWindows == null || motionWindows.isEmpty()) {
            return 0.0;
        }
        int still = 0;
        for (DeviceMotionWindow window : motionWindows) {
            if (isLowMotionWindow(window)) {
                still++;
            }
        }
        return still / (double) motionWindows.size();
    }

    private static boolean isLowMotionWindow(DeviceMotionWindow window) {
        double accelRms = window.linearAccelerationSampleCount > 0
                ? window.linearAccelerationRmsMps2 : window.accelerometerDynamicRmsMps2;
        return accelRms < 0.12
                && window.gyroscopeRmsRadps < 0.04
                && window.stepCounterDelta <= 0
                && window.stepDetectorCount <= 0;
    }

    private static TrackPoint stationarySessionAnchor(List<TrackPoint> points) {
        double latSum = 0.0;
        double lngSum = 0.0;
        double weightSum = 0.0;
        TrackPoint representative = points.get(0);
        for (TrackPoint point : points) {
            double accuracy = Math.max(1.0, point.accuracyMeters);
            double weight = 1.0 / (accuracy * accuracy);
            latSum += point.latitude * weight;
            lngSum += point.longitude * weight;
            weightSum += weight;
            if (point.accuracyMeters < representative.accuracyMeters) {
                representative = point;
            }
        }
        double latitude = latSum / weightSum;
        double longitude = lngSum / weightSum;
        double radiusMeters = 0.0;
        for (TrackPoint point : points) {
            radiusMeters = Math.max(radiusMeters,
                    distanceMeters(latitude, longitude, point.latitude, point.longitude));
        }
        return new TrackPoint(representative.trackPointId, representative.sourceRawPointId,
                representative.sourceDecisionId, 1L, latitude, longitude,
                representative.hasAltitude, representative.altitude,
                representative.hasVerticalAccuracy, representative.verticalAccuracyMeters,
                representative.accuracyMeters, representative.hasSpeed,
                representative.speedMetersPerSecond, representative.hasBearing,
                representative.bearingDegrees, representative.timeMillis,
                representative.elapsedRealtimeNanos, "anchor", "stationary_session_anchor",
                0.0, 0.0, "ANCHOR",
                representative.sourceCloudId, representative.representativeRawPointId,
                representative.contributingRawPointIds, true,
                latitude, longitude, radiusMeters, representative.hasPressureSample,
                representative.pressureSampleElapsedRealtimeNanos, representative.pressureHpa,
                representative.rawBarometerAltitudeMeters);
    }

    private static double stationaryThreshold(TrackPoint point) {
        return Math.max(STATIONARY_DISTANCE_METERS,
                point.accuracyMeters * STATIONARY_ACCURACY_MULTIPLIER);
    }

    private static double distanceMeters(TrackPoint from, TrackPoint to) {
        return distanceMeters(from.latitude, from.longitude, to.latitude, to.longitude);
    }

    private static double distanceMeters(double fromLatitude, double fromLongitude,
                                         double toLatitude, double toLongitude) {
        double lat1 = Math.toRadians(fromLatitude);
        double lat2 = Math.toRadians(toLatitude);
        double dLat = lat2 - lat1;
        double dLng = Math.toRadians(toLongitude - fromLongitude);
        double sinLat = Math.sin(dLat / 2d);
        double sinLng = Math.sin(dLng / 2d);
        double a = sinLat * sinLat
                + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
        return 6_371_000d * 2d * Math.atan2(Math.sqrt(a), Math.sqrt(1d - a));
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
                decision.trustGrade, decision.cloudId,
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

    private boolean isGapRecoveryReason(String reason) {
        return "gap_recovery".equals(reason)
                || "continuity_rescue_gap_recovery".equals(reason)
                || "recovery_transport_suspected_kept".equals(reason);
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
                event.optBoolean("mock", false));
    }

    public static class Result {
        public final List<TrackPoint> trackPoints;
        public final List<TrackPoint> displayTrackPoints;
        public final List<DecisionRecord> decisions;
        public final List<TrackAscentCalculator.BarometerSample> barometerSamples;
        public final Stats stats;

        Result(List<TrackPoint> trackPoints,
               List<TrackPoint> displayTrackPoints,
               List<DecisionRecord> decisions,
               List<TrackAscentCalculator.BarometerSample> barometerSamples,
               Stats stats) {
            this.trackPoints = trackPoints;
            this.displayTrackPoints = displayTrackPoints;
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

        DecisionRecord(long rawPointId, long elapsedRealtimeNanos, String result,
                       String reason) {
            this.rawPointId = rawPointId;
            this.elapsedRealtimeNanos = elapsedRealtimeNanos;
            this.result = result;
            this.reason = reason;
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
