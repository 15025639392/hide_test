package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class DiagnosticTrackPointReaderTest {
    @Test
    public void readTrackPoints_reconstructsAcceptedDecisionPoints() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":10.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000,\"sourceGnssSnapshotId\":7}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"anchor\",\"reason\":\"first_fix_good\",\"trackPointId\":1,"
                + "\"segmentId\":1,\"distanceDeltaMeters\":0.0,"
                + "\"movingTimeDeltaSeconds\":0.0}\n"
                + "{\"event\":\"raw_location\",\"rawPointId\":2,\"provider\":\"gps\","
                + "\"lat\":29.00018,\"lng\":106.0,\"accuracy\":3.0,\"timeMillis\":2000,"
                + "\"elapsedRealtimeNanos\":12000}\n"
                + "{\"event\":\"decision\",\"decisionId\":2,\"rawPointId\":2,"
                + "\"result\":\"accept\",\"reason\":\"moving_good_fix\",\"trackPointId\":2,"
                + "\"segmentId\":1,\"distanceDeltaMeters\":20.0,"
                + "\"movingTimeDeltaSeconds\":10.0}\n"
                + "{\"event\":\"decision\",\"decisionId\":3,\"rawPointId\":3,"
                + "\"result\":\"reject\",\"reason\":\"weak_signal_stage1\"}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(diagnostic);

        assertEquals(2, points.size());
        assertEquals(1L, points.get(0).trackPointId);
        assertEquals(1L, points.get(0).sourceRawPointId);
        assertEquals(1L, points.get(0).sourceDecisionId);
        assertEquals(29.0, points.get(0).latitude, 0.0);
        assertEquals(7L, points.get(0).sourceGnssSnapshotId.longValue());
        assertEquals("accept", points.get(1).decisionResult);
        assertEquals("moving_good_fix", points.get(1).decisionReason);
        assertEquals(20.0, points.get(1).distanceDeltaMeters, 0.0);
    }

    @Test
    public void readTrackPoints_reconstructsWeakDecisionPoints() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader-weak").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":55.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"weak\",\"reason\":\"weak_first_fix\","
                + "\"trackPointId\":1000000001,\"segmentId\":1,"
                + "\"distanceDeltaMeters\":0.0,\"movingTimeDeltaSeconds\":0.0}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(diagnostic);

        assertEquals(1, points.size());
        assertEquals(1_000_000_001L, points.get(0).trackPointId);
        assertEquals("weak", points.get(0).decisionResult);
        assertEquals("weak_first_fix", points.get(0).decisionReason);
    }

    @Test
    public void readTrackPoints_ignoresRejectDecisionEvenWhenItHasTrackPointId() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader-reject-trackpoint").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":8.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"anchor\",\"reason\":\"first_fix_good\",\"trackPointId\":1,"
                + "\"segmentId\":1,\"distanceDeltaMeters\":0.0,"
                + "\"movingTimeDeltaSeconds\":0.0}\n"
                + "{\"event\":\"raw_location\",\"rawPointId\":2,\"provider\":\"gps\","
                + "\"lat\":29.00005,\"lng\":106.0,\"accuracy\":5.0,\"timeMillis\":2000,"
                + "\"elapsedRealtimeNanos\":12000}\n"
                + "{\"event\":\"decision\",\"decisionId\":2,\"rawPointId\":2,"
                + "\"result\":\"reject\",\"reason\":\"stationary_anchor_refined\","
                + "\"trackPointId\":1,\"segmentId\":1,"
                + "\"distanceDeltaMeters\":0.0,\"movingTimeDeltaSeconds\":0.0}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(diagnostic);

        assertEquals(1, points.size());
        assertEquals(1L, points.get(0).trackPointId);
        assertEquals("anchor", points.get(0).decisionResult);
    }

    @Test
    public void readTrackPoints_replacesAnchorRefinementDecisionWithSameTrackPointId()
            throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader-refine-anchor").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":20.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"anchor\",\"reason\":\"first_fix_relaxed\",\"trackPointId\":1,"
                + "\"segmentId\":1,\"distanceDeltaMeters\":0.0,"
                + "\"movingTimeDeltaSeconds\":0.0}\n"
                + "{\"event\":\"raw_location\",\"rawPointId\":2,\"provider\":\"gps\","
                + "\"lat\":29.00002,\"lng\":106.0,\"accuracy\":8.0,\"timeMillis\":2000,"
                + "\"elapsedRealtimeNanos\":12000}\n"
                + "{\"event\":\"decision\",\"decisionId\":2,\"rawPointId\":2,"
                + "\"result\":\"anchor\",\"reason\":\"stationary_anchor_refined\","
                + "\"trackPointId\":1,\"segmentId\":1,"
                + "\"distanceDeltaMeters\":0.0,\"movingTimeDeltaSeconds\":0.0}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(diagnostic);

        assertEquals(1, points.size());
        assertEquals(1L, points.get(0).trackPointId);
        assertEquals(2L, points.get(0).sourceRawPointId);
        assertEquals(2L, points.get(0).sourceDecisionId);
        assertEquals("stationary_anchor_refined", points.get(0).decisionReason);
        assertEquals(8.0, points.get(0).accuracyMeters, 0.0);
    }

    @Test
    public void readDisplayTrackPoints_includesTransportRejectPointsForMapOnly() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader-transport").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":8.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"anchor\",\"reason\":\"first_fix_good\",\"trackPointId\":1,"
                + "\"segmentId\":1,\"distanceDeltaMeters\":0.0,"
                + "\"movingTimeDeltaSeconds\":0.0}\n"
                + "{\"event\":\"raw_location\",\"rawPointId\":2,\"provider\":\"gps\","
                + "\"lat\":29.01,\"lng\":106.0,\"accuracy\":8.0,\"timeMillis\":2000,"
                + "\"elapsedRealtimeNanos\":22000}\n"
                + "{\"event\":\"decision\",\"decisionId\":2,\"rawPointId\":2,"
                + "\"result\":\"reject\",\"reason\":\"transport_suspected\"}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        List<TrackPoint> trustedPoints = new DiagnosticTrackPointReader().readTrackPoints(diagnostic);
        List<TrackPoint> displayPoints = new DiagnosticTrackPointReader().readDisplayTrackPoints(diagnostic);

        assertEquals(1, trustedPoints.size());
        assertEquals(2, displayPoints.size());
        assertEquals("transport", displayPoints.get(1).decisionResult);
        assertEquals("transport_suspected", displayPoints.get(1).decisionReason);
        assertEquals(2L, displayPoints.get(1).sourceRawPointId);
    }

    @Test
    public void readAscentInputs_reconstructsPressureSamples() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-track-reader-pressure").toFile();
        File diagnostic = new File(dir, "diagnostic.jsonl");
        String jsonl = ""
                + "{\"event\":\"pressure_sample\",\"eventElapsedRealtimeNanos\":1000,"
                + "\"pressureSampleId\":1,\"pressureHpa\":1000.0,"
                + "\"sensorAccuracy\":3,\"rawBarometerAltitudeMeters\":100.0}\n"
                + "{\"event\":\"pressure_sample_rejected\","
                + "\"eventElapsedRealtimeNanos\":10000001000,"
                + "\"barometerSampleId\":2,\"pressureHpa\":0.0,"
                + "\"sensorAccuracy\":3,\"rejectReason\":\"invalid_pressure\"}\n"
                + "{\"event\":\"pressure_sample\",\"eventElapsedRealtimeNanos\":30000001000,"
                + "\"pressureSampleId\":2,\"pressureHpa\":999.0,"
                + "\"sensorAccuracy\":3,\"rawBarometerAltitudeMeters\":110.0}\n"
                + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":8.0,\"timeMillis\":1000,"
                + "\"elapsedRealtimeNanos\":2000}\n"
                + "{\"event\":\"decision\",\"decisionId\":1,\"rawPointId\":1,"
                + "\"result\":\"weak\",\"reason\":\"weak_signal_stage1\","
                + "\"trackPointId\":1000000001,\"segmentId\":1,"
                + "\"distanceDeltaMeters\":0.0,\"movingTimeDeltaSeconds\":0.0}\n";
        Files.write(diagnostic.toPath(), jsonl.getBytes(StandardCharsets.UTF_8));

        DiagnosticTrackPointReader.AscentInputs inputs =
                new DiagnosticTrackPointReader().readAscentInputs(diagnostic);
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(
                inputs.trackPoints, inputs.barometerSamples);

        assertEquals(1, inputs.trackPoints.size());
        assertEquals(3, inputs.barometerSamples.size());
        assertEquals("BAROMETER", result.source);
        assertEquals(3.5, result.totalAscentMeters, 0.0001);
        assertEquals(2, result.barometerSampleCount);
        assertEquals(1, result.barometerRejectedSampleCount);
    }
}
