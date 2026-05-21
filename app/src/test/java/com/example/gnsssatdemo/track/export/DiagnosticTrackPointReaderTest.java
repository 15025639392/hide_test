package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class DiagnosticTrackPointReaderTest {
    @Test
    public void readTrackPoints_rebuildsTargetProductFromPureEvidence() throws Exception {
        File dir = Files.createTempDirectory("evidence-track-reader").toFile();
        File evidence = new File(dir, "evidence.jsonl");
        String jsonl = ""
                + "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + raw(1, 29.0, 106.0, 10.0, 2_000_000_000L, null)
                + raw(2, 29.00018, 106.0, 3.0, 12_000_000_000L, null);
        Files.write(evidence.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(evidence);

        assertEquals(2, points.size());
        assertEquals(1L, points.get(0).trackPointId);
        assertEquals(1L, points.get(0).sourceRawPointId);
        assertEquals(1L, points.get(0).sourceDecisionId);
        assertEquals("anchor", points.get(0).decisionResult);
        assertEquals("first_fix_good", points.get(0).decisionReason);
        assertEquals("accept", points.get(1).decisionResult);
        assertEquals("moving_good_fix", points.get(1).decisionReason);
    }

    @Test
    public void readTrackPoints_rebuildsWeakPointsFromRawEvidence() throws Exception {
        File dir = Files.createTempDirectory("evidence-track-reader-weak").toFile();
        File evidence = new File(dir, "evidence.jsonl");
        String jsonl = ""
                + "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + raw(1, 29.0, 106.0, 55.0, 2_000_000_000L, null);
        Files.write(evidence.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(evidence);

        assertEquals(1, points.size());
        assertEquals(1_000_000_001L, points.get(0).trackPointId);
        assertEquals("weak", points.get(0).decisionResult);
        assertEquals("weak_signal_stage2", points.get(0).decisionReason);
    }

    @Test
    public void readTrackPoints_doesNotUseWeakPointAsPreviousTrustedPoint() throws Exception {
        File dir = Files.createTempDirectory("evidence-track-reader-weak-gap").toFile();
        File evidence = new File(dir, "evidence.jsonl");
        String jsonl = ""
                + "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + raw(1, 29.0, 106.0, 8.0, 2_000_000_000L, null)
                + raw(2, 29.001, 106.0, 55.0, 12_000_000_000L, null)
                + raw(3, 29.0002, 106.0, 8.0, 200_000_000_000L, null)
                + raw(4, 29.00021, 106.0, 8.0, 201_000_000_000L, null);
        Files.write(evidence.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(evidence);

        assertEquals(4, points.size());
        assertEquals("weak", points.get(1).decisionResult);
        assertEquals("recovery_cloud_pending", points.get(2).decisionReason);
        assertEquals("continuity_rescue_gap_recovery", points.get(3).decisionReason);
        assertEquals(2L, points.get(3).segmentId);
    }

    @Test
    public void readTrackPoints_keepsTransportRiskAsTrustedTrack() throws Exception {
        File dir = Files.createTempDirectory("evidence-track-reader-transport").toFile();
        File evidence = new File(dir, "evidence.jsonl");
        String jsonl = ""
                + "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + raw(1, 29.0, 106.0, 8.0, 2_000_000_000L, null)
                + raw(2, 29.01, 106.0, 8.0, 22_000_000_000L, 5.0);
        Files.write(evidence.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readDisplayTrackPoints(evidence);

        assertEquals(2, points.size());
        assertEquals("accept", points.get(1).decisionResult);
        assertEquals("transport_suspected_kept", points.get(1).decisionReason);
        assertEquals(2L, points.get(1).sourceRawPointId);
    }

    @Test
    public void readAscentInputs_reconstructsBarometerWindows() throws Exception {
        File dir = Files.createTempDirectory("evidence-track-reader-pressure").toFile();
        File evidence = new File(dir, "evidence.jsonl");
        String jsonl = ""
                + "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + "{\"event\":\"barometer_window\",\"barometerWindowId\":1,"
                + "\"endElapsedRealtimeNanos\":1000,\"avgPressureHpa\":1000.0,"
                + "\"lastSensorAccuracy\":3,\"avgRawAltitudeMeters\":100.0}\n"
                + "{\"event\":\"barometer_window\",\"barometerWindowId\":2,"
                + "\"endElapsedRealtimeNanos\":30000001000,\"avgPressureHpa\":999.0,"
                + "\"lastSensorAccuracy\":3,\"avgRawAltitudeMeters\":110.0}\n"
                + raw(1, 29.0, 106.0, 55.0, 2_000_000_000L, null);
        Files.write(evidence.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        DiagnosticTrackPointReader.AscentInputs inputs =
                new DiagnosticTrackPointReader().readAscentInputs(evidence);
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(
                inputs.trackPoints, inputs.barometerSamples);

        assertEquals(1, inputs.trackPoints.size());
        assertEquals(2, inputs.barometerSamples.size());
        assertEquals("BAROMETER", result.source);
        assertEquals(3.5, result.totalAscentMeters, 0.0001);
        assertEquals(2, result.barometerSampleCount);
        assertEquals(0, result.barometerRejectedSampleCount);
    }

    private String raw(long id, double lat, double lng, double accuracy,
                       long elapsedRealtimeNanos, Double speed) {
        return "{\"event\":\"raw_location\",\"rawPointId\":" + id
                + ",\"provider\":\"gps\",\"lat\":" + lat
                + ",\"lng\":" + lng
                + ",\"accuracy\":" + accuracy
                + ",\"timeMillis\":" + elapsedRealtimeNanos / 1_000_000L
                + ",\"hasElapsedRealtimeNanos\":true"
                + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + ",\"speed\":" + (speed == null ? "null" : speed)
                + "}\n";
    }
}
