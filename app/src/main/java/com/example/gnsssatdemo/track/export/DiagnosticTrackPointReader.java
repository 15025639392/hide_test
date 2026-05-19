package com.example.gnsssatdemo.track.export;

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
import java.util.List;
import java.util.Map;

public class DiagnosticTrackPointReader {
    private static final long TRANSPORT_DISPLAY_POINT_ID_OFFSET = 2_000_000_000L;

    public List<TrackPoint> readTrackPoints(File diagnosticJsonl) throws IOException, JSONException {
        return readTrackPoints(diagnosticJsonl, false);
    }

    public List<TrackPoint> readDisplayTrackPoints(File diagnosticJsonl)
            throws IOException, JSONException {
        return readTrackPoints(diagnosticJsonl, true);
    }

    private List<TrackPoint> readTrackPoints(File diagnosticJsonl, boolean includeTransportDisplay)
            throws IOException, JSONException {
        Map<Long, RawPoint> rawPoints = new HashMap<>();
        List<TrackPoint> trackPoints = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(diagnosticJsonl), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                JSONObject event = new JSONObject(trimmed);
                String eventName = event.optString("event", "");
                if ("raw_location".equals(eventName)) {
                    RawPoint rawPoint = rawPointFromEvent(event);
                    rawPoints.put(rawPoint.rawPointId, rawPoint);
                } else if ("decision".equals(eventName) && isRecordedTrackPointDecision(event)) {
                    RawPoint rawPoint = rawPoints.get(event.optLong("rawPointId", -1L));
                    if (rawPoint != null) {
                        TrackPoint trackPoint = trackPointFromEvent(event, rawPoint);
                        if (isAnchorRefinementDecision(event)) {
                            upsertRefinedTrackPoint(trackPoints, trackPoint);
                        } else {
                            trackPoints.add(trackPoint);
                        }
                    }
                } else if (includeTransportDisplay && "decision".equals(eventName)
                        && isTransportDisplayDecision(event)) {
                    RawPoint rawPoint = rawPoints.get(event.optLong("rawPointId", -1L));
                    if (rawPoint != null) {
                        trackPoints.add(transportDisplayPointFromEvent(event, rawPoint));
                    }
                }
            }
        }
        return trackPoints;
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
                event.has("elapsedRealtimeNanos"),
                event.optLong("elapsedRealtimeNanos", 0L),
                event.optBoolean("mock", false),
                event.has("sourceGnssSnapshotId")
                        ? event.optLong("sourceGnssSnapshotId") : null);
    }

    private TrackPoint trackPointFromEvent(JSONObject event, RawPoint rawPoint) {
        return trackPointFromEvent(event, rawPoint, event.optLong("trackPointId"),
                event.optString("result"), event.optString("reason"),
                event.optDouble("distanceDeltaMeters", 0.0),
                event.optDouble("movingTimeDeltaSeconds", 0.0));
    }

    private TrackPoint transportDisplayPointFromEvent(JSONObject event, RawPoint rawPoint) {
        long decisionId = event.optLong("decisionId");
        return trackPointFromEvent(event, rawPoint, TRANSPORT_DISPLAY_POINT_ID_OFFSET + decisionId,
                "transport", event.optString("reason", "transport_display"), 0.0, 0.0);
    }

    private TrackPoint trackPointFromEvent(JSONObject event, RawPoint rawPoint, long trackPointId,
                                           String result, String reason,
                                           double distanceDeltaMeters,
                                           double movingTimeDeltaSeconds) {
        boolean hasPressureSample = event.has("pressureSampleElapsedRealtimeNanos")
                && event.optLong("pressureSampleElapsedRealtimeNanos", 0L) > 0L
                && event.has("pressureHpa")
                && event.opt("pressureHpa") != JSONObject.NULL
                && event.has("rawBarometerAltitudeMeters")
                && event.opt("rawBarometerAltitudeMeters") != JSONObject.NULL;
        return new TrackPoint(trackPointId,
                rawPoint.rawPointId,
                event.optLong("decisionId"),
                event.optLong("segmentId", 1L),
                rawPoint.latitude,
                rawPoint.longitude,
                rawPoint.hasAltitude,
                rawPoint.altitude,
                rawPoint.hasVerticalAccuracy,
                rawPoint.verticalAccuracyMeters,
                rawPoint.accuracyMeters,
                rawPoint.hasSpeed,
                rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing,
                rawPoint.bearingDegrees,
                rawPoint.timeMillis,
                rawPoint.elapsedRealtimeNanos,
                result,
                reason,
                distanceDeltaMeters,
                movingTimeDeltaSeconds,
                rawPoint.sourceGnssSnapshotId,
                hasPressureSample, event.optLong("pressureSampleElapsedRealtimeNanos", 0L),
                hasPressureSample ? event.optDouble("pressureHpa", 0.0) : 0.0,
                hasPressureSample
                        ? event.optDouble("rawBarometerAltitudeMeters", 0.0) : 0.0);
    }

    private boolean isTransportDisplayDecision(JSONObject event) {
        String reason = event.optString("reason", "");
        return "transport_suspected".equals(reason)
                || "transport_confirmed".equals(reason);
    }

    private boolean isRecordedTrackPointDecision(JSONObject event) {
        if (!event.has("trackPointId")) {
            return false;
        }
        String result = event.optString("result", "");
        return "anchor".equals(result) || "accept".equals(result) || "weak".equals(result);
    }

    private boolean isAnchorRefinementDecision(JSONObject event) {
        return "stationary_anchor_refined".equals(event.optString("reason", ""));
    }

    private void upsertRefinedTrackPoint(List<TrackPoint> trackPoints, TrackPoint refinedPoint) {
        for (int i = trackPoints.size() - 1; i >= 0; i--) {
            if (trackPoints.get(i).trackPointId == refinedPoint.trackPointId) {
                trackPoints.set(i, refinedPoint);
                return;
            }
        }
        trackPoints.add(refinedPoint);
    }
}
