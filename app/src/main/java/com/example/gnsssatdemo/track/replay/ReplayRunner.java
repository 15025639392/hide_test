package com.example.gnsssatdemo.track.replay;

import android.location.LocationManager;

import com.example.gnsssatdemo.track.engine.SamplingEpoch;
import com.example.gnsssatdemo.track.engine.SamplingIntake;
import com.example.gnsssatdemo.track.engine.TrackTrustDecision;
import com.example.gnsssatdemo.track.engine.TrackTrustEngine;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.GnssSnapshotDiagnosticFields;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

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
        long decisionSeq = 0L;
        long trackPointSeq = 0L;
        long segmentId = 1L;
        long samplingEpochSeq = 0L;
        SamplingEpoch activeEpoch = null;
        SamplingIntake samplingIntake = new SamplingIntake();
        TrackTrustEngine trustEngine = new TrackTrustEngine();
        Map<Long, GnssQualitySnapshot> gnssSnapshots = new HashMap<>();
        Map<Long, SamplingEpoch> samplingEpochs = new HashMap<>();
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
                activeEpoch = new SamplingEpoch(++samplingEpochSeq, "STARTING",
                        1000L, 0f, recordStartElapsedRealtimeNanos);
                samplingEpochs.put(activeEpoch.samplingEpochId, activeEpoch);
            } else if ("config_snapshot".equals(eventName)) {
                // Strategy parameters are owned by TrackTrustEngine v3.
            } else if ("sampling_policy".equals(eventName)) {
                long eventTime = event.optLong("eventElapsedRealtimeNanos",
                        nowElapsedRealtimeNanos);
                long epochId = event.has("samplingEpochId")
                        ? event.optLong("samplingEpochId") : ++samplingEpochSeq;
                samplingEpochSeq = Math.max(samplingEpochSeq, epochId);
                activeEpoch = new SamplingEpoch(epochId,
                        event.optString("state", ""),
                        event.optLong("locationRequestMinTimeMs", 1000L),
                        (float) event.optDouble("locationRequestMinDistanceMeters", 0.0),
                        eventTime);
                samplingEpochs.put(activeEpoch.samplingEpochId, activeEpoch);
            } else if (GnssSnapshotDiagnosticFields.EVENT.equals(eventName)) {
                GnssQualitySnapshot snapshot = gnssSnapshotFromEvent(event);
                gnssSnapshots.put(snapshot.snapshotId, snapshot);
            } else if ("motion_summary".equals(eventName)) {
                MotionSummary summary = motionSummaryFromEvent(event);
                rememberMotionSummary(recentMotionSummaries, summary);
            } else if ("raw_location".equals(eventName)) {
                if (recordStartElapsedRealtimeNanos <= 0L) {
                    return ReplayReport.invalid("missing_session_metadata_before_raw_location");
                }
                RawPoint rawPoint = rawPointFromEvent(event);
                long receivedElapsedRealtimeNanos = event.optLong(
                        "callbackReceivedElapsedRealtimeNanos",
                        event.optLong("eventElapsedRealtimeNanos",
                                rawPoint.elapsedRealtimeNanos + 1_000_000L));
                nowElapsedRealtimeNanos = Math.max(nowElapsedRealtimeNanos,
                        receivedElapsedRealtimeNanos);
                String actualResult;
                String actualReason;
                SamplingEpoch rawEpoch = samplingEpochForRawEvent(event, activeEpoch,
                        samplingEpochs, recordStartElapsedRealtimeNanos);
                SamplingIntake.Result intakeResult = samplingIntake.accept(rawPoint, rawEpoch,
                        recordStartElapsedRealtimeNanos, nowElapsedRealtimeNanos);
                long decisionId = decisionSeq + 1L;
                if (!intakeResult.accepted) {
                    actualResult = "intake_rejected";
                    actualReason = intakeResult.reason;
                } else {
                    TrackPoint previousTrackPoint = lastTrackPoint(trackPoints);
                    TrackTrustDecision decision = trustEngine.decide(rawPoint, rawEpoch,
                            snapshotById(gnssSnapshots, rawPoint.sourceGnssSnapshotId),
                            recentMotionSummaries, previousTrackPoint);
                    actualResult = decision.result;
                    actualReason = decision.reason;
                    if (decision.createsTrustedTrackPoint()) {
                        if (decision.startsNewSegment && previousTrackPoint != null) {
                            segmentId++;
                        }
                        TrackPoint trackPoint = new TrackPoint(++trackPointSeq,
                                rawPoint.rawPointId, decisionId, segmentId,
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
                                decision.trustGrade, decision.cloudId,
                                decision.representativeRawPointId, "", true,
                                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                                decision.cloudWeightedRadiusMeters,
                                false, 0L, 0.0, 0.0);
                        trackPoints.add(trackPoint);
                    }
                }

                decisionSeq = decisionId;
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
        boolean hasVerticalAccuracy = event.has("verticalAccuracy")
                && event.opt("verticalAccuracy") != JSONObject.NULL;
        return new RawPoint(event.optLong("rawPointId"),
                event.optString("provider", LocationManager.GPS_PROVIDER),
                event.optDouble("lat"), event.optDouble("lng"),
                event.has("altitude"), event.optDouble("altitude", 0.0),
                hasVerticalAccuracy, (float) event.optDouble("verticalAccuracy", 0.0),
                hasAccuracy, (float) event.optDouble("accuracy", 0.0),
                event.has("speed"), (float) event.optDouble("speed", 0.0),
                event.has("bearing"), (float) event.optDouble("bearing", 0.0),
                event.optLong("timeMillis", 0L),
                hasElapsedRealtimeNanos, event.optLong("elapsedRealtimeNanos", 0L),
                event.optBoolean("mock", false),
                event.has("sourceGnssSnapshotId") ? event.optLong("sourceGnssSnapshotId") : null);
    }

    private SamplingEpoch samplingEpochForRawEvent(JSONObject event, SamplingEpoch activeEpoch,
                                                   Map<Long, SamplingEpoch> samplingEpochs,
                                                   long recordStartElapsedRealtimeNanos) {
        if (!event.has("samplingEpochId")) {
            return activeEpoch;
        }
        long epochId = event.optLong("samplingEpochId");
        SamplingEpoch epoch = samplingEpochs.get(epochId);
        if (epoch != null) {
            return epoch;
        }
        long startedNanos = event.optLong("samplingEpochStartedElapsedRealtimeNanos",
                recordStartElapsedRealtimeNanos);
        epoch = new SamplingEpoch(epochId, event.optString("samplingState", ""),
                event.optLong("requestedMinTimeMs", 1000L),
                (float) event.optDouble("requestedMinDistanceMeters", 0.0),
                startedNanos);
        samplingEpochs.put(epochId, epoch);
        return epoch;
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

    private String optionalString(JSONObject event, String key) {
        return event.has(key) ? event.optString(key, null) : null;
    }
}
