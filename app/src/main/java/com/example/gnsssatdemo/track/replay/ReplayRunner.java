package com.example.gnsssatdemo.track.replay;

import android.location.LocationManager;

import com.example.gnsssatdemo.track.engine.LocationValidator;
import com.example.gnsssatdemo.track.engine.TrackDecisionEngine;
import com.example.gnsssatdemo.track.engine.TrackDecisionResult;
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
import java.util.List;

public class ReplayRunner {
    private final LocationValidator validator = new LocationValidator();
    private final TrackDecisionEngine decisionEngine = new TrackDecisionEngine();

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
        long lastStationaryKeepaliveElapsedRealtimeNanos = 0L;
        TrackPoint previousTrackPoint = null;
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
                if (!validationResult.valid) {
                    actualResult = "reject";
                    actualReason = validationResult.rejectReason;
                } else {
                    outcome = decisionEngine.decide(rawPoint, previousTrackPoint,
                            lastStationaryKeepaliveElapsedRealtimeNanos,
                            forcedWeakFirstFixEnabled);
                    actualResult = outcome.result;
                    actualReason = outcome.reason;
                }

                decisionSeq++;
                if (outcome != null) {
                    lastStationaryKeepaliveElapsedRealtimeNanos =
                            outcome.nextStationaryKeepaliveElapsedRealtimeNanos;
                    if ("accept".equals(outcome.result) || "anchor".equals(outcome.result)) {
                        previousTrackPoint = new TrackPoint(++trackPointSeq, decisionSeq, 1L,
                                rawPoint, outcome.result, outcome.reason,
                                outcome.distanceDeltaMeters, outcome.movingTimeDeltaSeconds);
                    }
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

    private String optionalString(JSONObject event, String key) {
        return event.has(key) ? event.optString(key, null) : null;
    }
}
