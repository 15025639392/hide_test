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
    public List<TrackPoint> readTrackPoints(File diagnosticJsonl) throws IOException, JSONException {
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
                } else if ("decision".equals(eventName) && event.has("trackPointId")) {
                    RawPoint rawPoint = rawPoints.get(event.optLong("rawPointId", -1L));
                    if (rawPoint != null) {
                        trackPoints.add(trackPointFromEvent(event, rawPoint));
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
        boolean hasSpeed = event.has("speed") && event.opt("speed") != JSONObject.NULL;
        boolean hasBearing = event.has("bearing") && event.opt("bearing") != JSONObject.NULL;
        return new RawPoint(event.optLong("rawPointId"),
                event.optString("provider", ""),
                event.optDouble("lat"), event.optDouble("lng"),
                hasAltitude, event.optDouble("altitude", 0.0),
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
        return new TrackPoint(event.optLong("trackPointId"),
                event.optLong("decisionId"),
                event.optLong("segmentId", 1L),
                rawPoint,
                event.optString("result"),
                event.optString("reason"),
                event.optDouble("distanceDeltaMeters", 0.0),
                event.optDouble("movingTimeDeltaSeconds", 0.0));
    }
}
