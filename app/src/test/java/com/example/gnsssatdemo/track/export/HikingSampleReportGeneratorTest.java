package com.example.gnsssatdemo.track.export;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class HikingSampleReportGeneratorTest {
    @Test
    public void generate_recomputesAlgorithmStatsFromPureEvidence() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report").toFile();
        String evidence = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + raw(3, 1, 2_000_000_000L, 10.0, 29.0)
                + event(4, "sampling_policy", 10_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":0")
                + raw(5, 2, 12_000_000_000L, 8.0, 29.0002)
                + event(6, "barometer_window", 13_000_000_000L,
                "\"barometerWindowId\":1,\"endElapsedRealtimeNanos\":13000000000,"
                        + "\"avgPressureHpa\":1000.0,\"lastSensorAccuracy\":3,"
                        + "\"avgRawAltitudeMeters\":100.0")
                + event(7, "session_event", 1_900_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "evidence.jsonl").toPath(),
                evidence.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 7, 2, 2, 0, 0, 22.0, 10.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(2, report.rawLocationCount);
        assertEquals(2, report.decisionCount);
        assertEquals(2, report.trustedDecisionCount);
        assertEquals(0, report.weakDecisionCount);
        assertTrue(report.decisionReasonCounts.containsKey("accept:moving_good_fix"));
    }

    @Test
    public void generate_countsRecoveryTransportAsGapRecovery() throws Exception {
        File dir = Files.createTempDirectory("hiking-recovery-transport").toFile();
        String evidence = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "sampling_policy", 1_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":0")
                + raw(3, 1, 2_000_000_000L, 8.0, 29.0)
                + raw(4, 2, 200_000_000_000L, 8.0, 29.00001)
                + raw(5, 3, 202_000_000_000L, 8.0, 29.0107);
        Files.write(new File(dir, "evidence.jsonl").toPath(),
                evidence.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 5, 3, 2, 1, 1, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.gapRecoveryCount);
        assertEquals(1, report.gapRecoveryZeroDeltaCount);
        assertTrue(report.blockingFindings.isEmpty());
        assertTrue(report.decisionReasonCounts
                .containsKey("accept:recovery_transport_suspected_kept"));
        assertTrue(report.reviewFindings.toString()
                .contains("检测到疑似交通工具移动: kept=0 recovery=1"));
    }

    private String event(int seq, String eventName, long elapsedRealtimeNanos, String fields) {
        return "{\"event\":\"" + eventName + "\",\"sessionId\":\"S1\",\"eventSeq\":" + seq
                + ",\"schemaVersion\":1,\"eventElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + (fields.isEmpty() ? "" : "," + fields)
                + "}\n";
    }

    private String raw(int seq, int rawPointId, long elapsedRealtimeNanos, double accuracy,
                       double latitude) {
        return event(seq, "raw_location", elapsedRealtimeNanos,
                "\"rawPointId\":" + rawPointId
                        + ",\"provider\":\"gps\",\"lat\":" + latitude
                        + ",\"lng\":106.0"
                        + ",\"accuracy\":" + accuracy
                        + ",\"timeMillis\":1"
                        + ",\"hasElapsedRealtimeNanos\":true"
                        + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos);
    }

    private void writeSessionJson(File dir, int eventSeq, int rawCount, int trackCount,
                                  int weakCount, int gapCount, double distance,
                                  double movingTime) throws Exception {
        String json = "{\"sessionId\":\"S1\",\"schemaVersion\":1,"
                + "\"startedAtWallTimeMillis\":1,\"endedAtWallTimeMillis\":2,"
                + "\"completionState\":\"FINISHED\",\"integrityState\":\"OK\","
                + "\"diagnosticLogFileName\":\"evidence.jsonl\","
                + "\"diagnosticLogReadStatus\":\"OK\","
                + "\"diagnosticEventCount\":" + eventSeq + ","
                + "\"diagnosticLastEventSeq\":" + eventSeq + ","
                + "\"rawPointCount\":" + rawCount + ","
                + "\"trackPointCount\":" + trackCount + ","
                + "\"weakTrackPointCount\":" + weakCount + ","
                + "\"gapCount\":" + gapCount + ","
                + "\"totalDistanceMeters\":" + distance + ","
                + "\"movingTimeSeconds\":" + movingTime + "}";
        Files.write(new File(dir, "session.json").toPath(),
                json.getBytes(StandardCharsets.UTF_8));
    }
}
