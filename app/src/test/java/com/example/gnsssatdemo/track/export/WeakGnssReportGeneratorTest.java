package com.example.gnsssatdemo.track.export;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class WeakGnssReportGeneratorTest {
    @Test
    public void generate_recomputesWeakAndTransportEvidenceFromPureEvidence() throws Exception {
        File dir = Files.createTempDirectory("weak-gnss-report").toFile();
        String evidence = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + gnss(2, 1, 1_500_000_000L, 4, 18.0, 23.0)
                + raw(3, 1, 2_000_000_000L, 8.0, false, 1, null)
                + gnss(4, 2, 10_000_000_000L, 7, 30.0, 36.0)
                + raw(5, 2, 12_000_000_000L, 35.0, false, 2, null)
                + gnss(6, 3, 20_000_000_000L, 8, 31.0, 37.0)
                + raw(7, 3, 22_000_000_000L, 8.0, false, 3, 5.0)
                + event(8, "session_event", 120_000_000_000L,
                "\"eventType\":\"no_location_timeout\","
                        + "\"elapsedSinceLastLocationMillis\":75000");
        Files.write(new File(dir, "evidence.jsonl").toPath(),
                evidence.getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 8, 3, 2, 1, 0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);

        assertEquals(3, report.rawLocationCount);
        assertEquals(3, report.gnssSnapshotCount);
        assertEquals(1, report.weakDecisionCount);
        assertEquals(1, report.weakDecisionWithGnssCount);
        assertEquals(35.0, report.averageWeakAccuracyMeters, 0.0);
        assertEquals(30.0, report.averageWeakUsedAvgCn0, 0.0);
        assertEquals(1, report.transportDecisionCount);
        assertEquals(1, report.transportDecisionWithGnssCount);
        assertEquals(31.0, report.averageTransportUsedAvgCn0, 0.0);
        assertEquals(1, report.noLocationTimeoutCount);
        assertTrue(report.toText().contains("弱 GPS 诊断报告"));
    }

    @Test
    public void generate_countsRecoveryTransportAsTransportAndGapRecovery() throws Exception {
        File dir = Files.createTempDirectory("weak-gnss-recovery-transport").toFile();
        String evidence = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + gnss(2, 1, 1_500_000_000L, 8, 31.0, 37.0)
                + raw(3, 1, 2_000_000_000L, 8.0, false, 1, null)
                + raw(4, 2, 200_000_000_000L, 8.0, false, 1, null, 29.00001)
                + raw(5, 3, 202_000_000_000L, 8.0, false, 1, null);
        Files.write(new File(dir, "evidence.jsonl").toPath(),
                evidence.getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 5, 3, 2, 1, 1);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);

        assertEquals(1, report.transportDecisionCount);
        assertEquals(1, report.transportDecisionWithGnssCount);
        assertEquals(1, report.gapRecoveryCount);
    }

    private String event(int seq, String eventName, long elapsedRealtimeNanos, String fields) {
        return "{\"event\":\"" + eventName + "\",\"sessionId\":\"S1\",\"eventSeq\":" + seq
                + ",\"schemaVersion\":1,\"eventElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + (fields.isEmpty() ? "" : "," + fields)
                + "}\n";
    }

    private String raw(int seq, int rawPointId, long elapsedRealtimeNanos, double accuracy,
                       boolean stale, Integer snapshotId, Double speed) {
        return raw(seq, rawPointId, elapsedRealtimeNanos, accuracy, stale, snapshotId, speed,
                29.0 + rawPointId * 0.01);
    }

    private String raw(int seq, int rawPointId, long elapsedRealtimeNanos, double accuracy,
                       boolean stale, Integer snapshotId, Double speed, double latitude) {
        return event(seq, "raw_location", elapsedRealtimeNanos,
                "\"rawPointId\":" + rawPointId
                        + ",\"provider\":\"gps\",\"lat\":" + latitude
                        + ",\"lng\":106.0"
                        + ",\"accuracy\":" + accuracy
                        + ",\"timeMillis\":1"
                        + ",\"hasElapsedRealtimeNanos\":true"
                        + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"speed\":" + (speed == null ? "null" : speed)
                        + ",\"gnssQualityStale\":" + stale
                        + (snapshotId == null ? "" : ",\"sourceGnssSnapshotId\":" + snapshotId));
    }

    private String gnss(int seq, int snapshotId, long elapsedRealtimeNanos,
                        int usedInFix, double usedAvgCn0, double top4AvgCn0) {
        return event(seq, "gnss_snapshot", elapsedRealtimeNanos,
                "\"snapshotId\":" + snapshotId
                        + ",\"receivedElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"visibleTotal\":10"
                        + ",\"usedInFixTotal\":" + usedInFix
                        + ",\"usedAvgCn0\":" + usedAvgCn0
                        + ",\"allAvgCn0\":" + usedAvgCn0
                        + ",\"top4AvgCn0\":" + top4AvgCn0);
    }

    private void writeSessionJson(File dir, int eventSeq, int rawCount, int trackCount,
                                  int weakCount, int gapCount) throws Exception {
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
                + "\"gapCount\":" + gapCount + "}";
        Files.write(new File(dir, "session.json").toPath(),
                json.getBytes(StandardCharsets.UTF_8));
    }
}
