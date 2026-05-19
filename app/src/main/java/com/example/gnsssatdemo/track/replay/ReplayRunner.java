package com.example.gnsssatdemo.track.replay;

import android.location.LocationManager;

import com.example.gnsssatdemo.track.engine.LocationValidator;
import com.example.gnsssatdemo.track.engine.RestAnchorRefiner;
import com.example.gnsssatdemo.track.engine.RestStateMachine;
import com.example.gnsssatdemo.track.engine.TrackDecisionCoordinator;
import com.example.gnsssatdemo.track.engine.TrackDecisionResult;
import com.example.gnsssatdemo.track.engine.TrackStrategyConfig;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.GnssSnapshotDiagnosticFields;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;
import com.example.gnsssatdemo.track.model.ValidationResult;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ReplayRunner {
    private static final int RECENT_SUMMARY_LIMIT = 8;

    private final TrackStrategyConfig strategyConfig = TrackStrategyConfig.defaultStage1();
    private final LocationValidator validator = new LocationValidator(strategyConfig);

    public ReplayReport run(InputStream inputStream) throws IOException {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = inputStream.read(buffer)) >= 0) {
            outputStream.write(buffer, 0, read);
        }
        return run(outputStream.toString(StandardCharsets.UTF_8.name()));
    }

    public ReplayReport run(String jsonl) {
        long recordStartElapsedRealtimeNanos = -1L;
        long nowElapsedRealtimeNanos = -1L;
        boolean forcedWeakFirstFixEnabled = false;
        long decisionSeq = 0L;
        long trackPointSeq = 0L;
        long segmentId = 1L;
        long lastStationaryKeepaliveElapsedRealtimeNanos = 0L;
        TrackDecisionCoordinator decisionCoordinator = new TrackDecisionCoordinator(strategyConfig);
        RestAnchorRefiner restAnchorRefiner = new RestAnchorRefiner();
        RestStateMachine restStateMachine = new RestStateMachine();
        Map<Long, GnssQualitySnapshot> gnssSnapshots = new HashMap<>();
        List<TrackPoint> trackPoints = new ArrayList<>();
        List<MotionSummary> recentMotionSummaries = new ArrayList<>();
        List<ReplayDecision> decisions = new ArrayList<>();

        String[] lines = jsonl.split("\\r?\\n");
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index].trim();
            long lineNumber = index + 1L;
            if (line.isEmpty()) {
                continue;
            }

            JSONObject event;
            try {
                event = new JSONObject(line);
            } catch (JSONException e) {
                return ReplayReport.invalid("malformed_json_line_" + lineNumber);
            }

            String eventName = event.optString("event", "");
            if ("session_metadata".equals(eventName)) {
                recordStartElapsedRealtimeNanos = event.optLong("createdElapsedRealtimeNanos", -1L);
                nowElapsedRealtimeNanos = Math.max(nowElapsedRealtimeNanos,
                        recordStartElapsedRealtimeNanos);
            } else if ("config_snapshot".equals(eventName)) {
                forcedWeakFirstFixEnabled = event.optBoolean("forcedWeakFirstFixEnabled", false);
            } else if (GnssSnapshotDiagnosticFields.EVENT.equals(eventName)) {
                GnssQualitySnapshot snapshot = gnssSnapshotFromEvent(event);
                gnssSnapshots.put(snapshot.snapshotId, snapshot);
            } else if ("motion_summary".equals(eventName)) {
                MotionSummary summary = motionSummaryFromEvent(event);
                rememberMotionSummary(recentMotionSummaries, summary);
                restStateMachine.onMotionSummary(summary);
            } else if ("raw_location".equals(eventName)) {
                if (recordStartElapsedRealtimeNanos <= 0L) {
                    return ReplayReport.invalid("missing_session_metadata_before_raw_location");
                }
                RawPoint rawPoint = rawPointFromEvent(event);
                long receivedElapsedRealtimeNanos = event.optLong("eventElapsedRealtimeNanos",
                        rawPoint.elapsedRealtimeNanos + 1_000_000L);
                nowElapsedRealtimeNanos = Math.max(nowElapsedRealtimeNanos,
                        receivedElapsedRealtimeNanos);
                ValidationResult validationResult = validator.validate(rawPoint,
                        recordStartElapsedRealtimeNanos, nowElapsedRealtimeNanos);
                String actualResult;
                String actualReason;
                TrackDecisionResult outcome = null;
                long decisionId = decisionSeq + 1L;
                if (!validationResult.valid) {
                    actualResult = "reject";
                    actualReason = validationResult.rejectReason;
                } else {
                    TrackPoint previousTrackPoint = lastTrackPoint(trackPoints);
                    TrackDecisionCoordinator.Decision decision = decisionCoordinator.decide(rawPoint,
                            previousTrackPoint,
                            lastStationaryKeepaliveElapsedRealtimeNanos,
                            forcedWeakFirstFixEnabled);
                    outcome = decision.outcome;
                    boolean replacedPreviousTrackPoint = false;
                    RestAnchorRefiner.Decision restAnchorDecision = restAnchorRefiner.refine(outcome,
                            rawPoint, previousTrackPoint,
                            snapshotById(gnssSnapshots, rawPoint.sourceGnssSnapshotId),
                            previousTrackPoint == null ? null
                                    : snapshotById(gnssSnapshots,
                                    previousTrackPoint.sourceGnssSnapshotId),
                            recentMotionSummaries);
                    if (restAnchorDecision.handled) {
                        long nextStationaryKeepaliveElapsedRealtimeNanos =
                                outcome.nextStationaryKeepaliveElapsedRealtimeNanos;
                        if (restAnchorDecision.refineAnchor && previousTrackPoint != null) {
                            TrackPoint trackPoint = refinedTrackPoint(previousTrackPoint,
                                    decisionId, rawPoint, restAnchorDecision.reason);
                            trackPoints.set(trackPoints.size() - 1, trackPoint);
                            replacedPreviousTrackPoint = true;
                            outcome = new TrackDecisionResult("anchor", restAnchorDecision.reason,
                                    0.0, 0.0, nextStationaryKeepaliveElapsedRealtimeNanos,
                                    0, 0);
                        } else {
                            outcome = new TrackDecisionResult("reject", restAnchorDecision.reason,
                                    0.0, 0.0, nextStationaryKeepaliveElapsedRealtimeNanos,
                                    0, 1);
                        }
                    }
                    RestStateMachine.Decision restDecision = restStateMachine.apply(outcome,
                            rawPoint, previousTrackPoint, recentMotionSummaries);
                    outcome = restDecision.outcome;
                    actualResult = outcome.result;
                    actualReason = outcome.reason;
                    if (!replacedPreviousTrackPoint && shouldRecordTrustedTrackPoint(outcome)) {
                        if (outcome.startsNewSegment && previousTrackPoint != null) {
                            segmentId++;
                        }
                        TrackPoint trackPoint = new TrackPoint(++trackPointSeq, decisionId,
                                segmentId, rawPoint, outcome.result, outcome.reason,
                                outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds);
                        trackPoints.add(trackPoint);
                    }
                }

                decisionSeq = decisionId;
                if (outcome != null) {
                    lastStationaryKeepaliveElapsedRealtimeNanos =
                            outcome.nextStationaryKeepaliveElapsedRealtimeNanos;
                }

                decisions.add(new ReplayDecision(lineNumber, rawPoint.rawPointId,
                        actualResult, actualReason,
                        optionalString(event, "expectedResult"),
                        optionalString(event, "expectedReason")));
            }
        }

        if (decisions.isEmpty()) {
            return ReplayReport.invalid("no_raw_location_events");
        }
        return ReplayReport.valid(decisions);
    }

    private RawPoint rawPointFromEvent(JSONObject event) {
        boolean hasElapsedRealtimeNanos = event.optBoolean("hasElapsedRealtimeNanos", true);
        boolean hasAccuracy = event.optBoolean("hasAccuracy", true);
        return new RawPoint(event.optLong("rawPointId"),
                event.optString("provider", LocationManager.GPS_PROVIDER),
                event.optDouble("lat"), event.optDouble("lng"),
                event.has("altitude"), event.optDouble("altitude", 0.0),
                hasAccuracy, (float) event.optDouble("accuracy", 0.0),
                event.has("speed"), (float) event.optDouble("speed", 0.0),
                event.has("bearing"), (float) event.optDouble("bearing", 0.0),
                event.optLong("timeMillis", 0L),
                hasElapsedRealtimeNanos, event.optLong("elapsedRealtimeNanos", 0L),
                event.optBoolean("mock", false),
                event.has("sourceGnssSnapshotId") ? event.optLong("sourceGnssSnapshotId") : null);
    }

    private MotionSummary motionSummaryFromEvent(JSONObject event) {
        return new MotionSummary(event.optLong("motionSummaryId"),
                event.optLong("firstElapsedRealtimeNanos"),
                event.optLong("lastElapsedRealtimeNanos"),
                event.optInt("sampleCount", 0),
                event.optDouble("dynamicAccelRmsMps2", 0.0),
                event.optDouble("stillScore", 0.0),
                event.optBoolean("isDeviceStill", event.optBoolean("deviceStill", false)),
                event.optString("sourceSensorType", ""));
    }

    private GnssQualitySnapshot gnssSnapshotFromEvent(JSONObject event) {
        float usedAvgCn0 = (float) event.optDouble(GnssSnapshotDiagnosticFields.USED_AVG_CN0, 0.0);
        return new GnssQualitySnapshot(
                event.optLong(GnssSnapshotDiagnosticFields.SNAPSHOT_ID),
                event.optLong(GnssSnapshotDiagnosticFields.RECEIVED_ELAPSED_REALTIME_NANOS,
                        event.optLong("eventElapsedRealtimeNanos", 0L)),
                event.optInt(GnssSnapshotDiagnosticFields.VISIBLE_TOTAL, 0),
                event.optInt(GnssSnapshotDiagnosticFields.USED_IN_FIX_TOTAL, 0),
                usedAvgCn0,
                (float) event.optDouble(GnssSnapshotDiagnosticFields.ALL_AVG_CN0, usedAvgCn0),
                (float) event.optDouble(GnssSnapshotDiagnosticFields.TOP4_AVG_CN0, usedAvgCn0),
                event.optInt(GnssSnapshotDiagnosticFields.LOW_CN0_VISIBLE_COUNT, 0),
                event.optInt(GnssSnapshotDiagnosticFields.WEAK_USED_COUNT, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GPS_USED, 0),
                event.optInt(GnssSnapshotDiagnosticFields.BEIDOU_USED, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GALILEO_USED, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GLONASS_USED, 0),
                event.optInt(GnssSnapshotDiagnosticFields.QZSS_USED, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GPS_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.BEIDOU_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GALILEO_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.GLONASS_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.QZSS_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.SBAS_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.IRNSS_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.UNKNOWN_VISIBLE, 0),
                event.optInt(GnssSnapshotDiagnosticFields.OTHER_VISIBLE, 0),
                event.optBoolean(GnssSnapshotDiagnosticFields.HAS_DUAL_FREQUENCY, false));
    }

    private GnssQualitySnapshot snapshotById(Map<Long, GnssQualitySnapshot> gnssSnapshots,
                                             Long snapshotId) {
        return snapshotId == null ? null : gnssSnapshots.get(snapshotId);
    }

    private TrackPoint lastTrackPoint(List<TrackPoint> trackPoints) {
        return trackPoints.isEmpty() ? null : trackPoints.get(trackPoints.size() - 1);
    }

    private void rememberMotionSummary(List<MotionSummary> recentMotionSummaries,
                                       MotionSummary summary) {
        recentMotionSummaries.add(summary);
        while (recentMotionSummaries.size() > RECENT_SUMMARY_LIMIT) {
            recentMotionSummaries.remove(0);
        }
    }

    private boolean shouldRecordTrustedTrackPoint(TrackDecisionResult outcome) {
        return outcome != null
                && ("accept".equals(outcome.result) || "anchor".equals(outcome.result));
    }

    private TrackPoint refinedTrackPoint(TrackPoint previousTrackPoint, long decisionId,
                                         RawPoint rawPoint, String reason) {
        return new TrackPoint(previousTrackPoint.trackPointId,
                rawPoint.rawPointId,
                decisionId,
                previousTrackPoint.segmentId,
                rawPoint.latitude,
                rawPoint.longitude,
                rawPoint.hasAltitude,
                rawPoint.altitude,
                rawPoint.accuracyMeters,
                rawPoint.hasSpeed,
                rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing,
                rawPoint.bearingDegrees,
                rawPoint.timeMillis,
                rawPoint.elapsedRealtimeNanos,
                "anchor",
                reason,
                0.0,
                0.0,
                rawPoint.sourceGnssSnapshotId);
    }

    private String optionalString(JSONObject event, String key) {
        return event.has(key) ? event.optString(key, null) : null;
    }
}
