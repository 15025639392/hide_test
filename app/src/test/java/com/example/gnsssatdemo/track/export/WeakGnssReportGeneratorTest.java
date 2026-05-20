package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class WeakGnssReportGeneratorTest {
    @Test
    public void generate_summarizesWeakRejectGapAndStaleGnssEvidence() throws Exception {
        File dir = Files.createTempDirectory("weak-gnss-report").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + gnss(2, 1, 1_500_000_000L, 4, 18.0, 23.0)
                + raw(3, 1, 2_000_000_000L, 35.0, false, 1)
                + decision(4, 1, 1, 2_000_000_000L,
                "weak", "weak_signal_stage2", 1)
                + gnss(5, 2, 10_000_000_000L, 7, 30.0, 36.0)
                + raw(6, 2, 12_000_000_000L, 8.0, false, 2)
                + decision(7, 2, 2, 12_000_000_000L,
                "reject", "transport_suspected", 2)
                + gnss(8, 5, 20_000_000_000L, 6, 26.0, 32.0)
                + raw(9, 5, 22_000_000_000L, 9.0, false, 5)
                + decision(10, 5, 5, 22_000_000_000L,
                "accept", "moving_good_fix", 5)
                + raw(11, 3, 40_000_000_000L, 12.0, true, null)
                + decision(12, 3, 3, 40_000_000_000L,
                "reject", "weak_signal_stage2", null)
                + gnss(13, 3, 90_000_000_000L, 3, 16.0, 21.0)
                + raw(14, 4, 100_000_000_000L, 10.0, false, 3)
                + decision(15, 4, 4, 100_000_000_000L,
                "accept", "gap_recovery", 3)
                + gnss(16, 4, 110_000_000_000L, 6, 28.0, 34.0)
                + event(17, "session_event", 120_000_000_000L,
                "\"eventType\":\"no_location_timeout\","
                        + "\"elapsedSinceLastLocationMillis\":75000");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 17, 5, 2, 1, 1);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);

        assertEquals(5, report.rawLocationCount);
        assertEquals(1, report.staleRawLocationCount);
        assertEquals(0.20, report.staleRawLocationRatio, 0.0);
        assertEquals(5, report.gnssSnapshotCount);
        assertEquals(5, report.explainableGnssSnapshotCount);
        assertEquals(1, report.weakDecisionCount);
        assertEquals(1, report.weakDecisionWithGnssCount);
        assertEquals(35.0, report.averageWeakAccuracyMeters, 0.0);
        assertEquals(4.0, report.averageWeakUsedInFixTotal, 0.0);
        assertEquals(18.0, report.averageWeakUsedAvgCn0, 0.0);
        assertEquals(2, report.rejectDecisionCount);
        assertEquals(1, report.rejectDecisionWithGnssCount);
        assertEquals(1, report.transportDecisionCount);
        assertEquals(1, report.transportDecisionWithGnssCount);
        assertEquals(30.0, report.averageTransportUsedAvgCn0, 0.0);
        assertEquals(1, report.gapRecoveryCount);
        assertEquals(1, report.gapRecoveryWithBeforeWindowCount);
        assertEquals(1, report.gapRecoveryWithAfterWindowCount);
        assertEquals(21.0, report.averageGapBeforeTop4AvgCn0, 0.0);
        assertEquals(34.0, report.averageGapAfterTop4AvgCn0, 0.0);
        assertEquals(1, report.noLocationTimeoutCount);
        assertEquals(75.0, report.maxNoLocationTimeoutSeconds, 0.0);
        assertTrue(report.findings.toString().contains("usedAvgCn0"));
        assertTrue(report.findings.toString().contains("reject 决策缺少可关联 GNSS snapshot"));
        assertTrue(report.toText().contains("弱 GPS 诊断报告"));
        assertEquals(1, report.toJson().getInt("weakDecisionWithGnssCount"));
    }

    @Test
    public void generate_toleratesLegacyGnssSnapshotsWithoutPhase6Metrics() throws Exception {
        File dir = Files.createTempDirectory("weak-gnss-report-legacy").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "gnss_snapshot", 1_500_000_000L,
                "\"snapshotId\":1,\"receivedElapsedRealtimeNanos\":1500000000,"
                        + "\"visibleTotal\":8,\"usedInFixTotal\":4,\"usedAvgCn0\":18.0")
                + raw(3, 1, 2_000_000_000L, 35.0, false, 1)
                + decision(4, 1, 1, 2_000_000_000L,
                "weak", "weak_signal_stage2", 1);
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 4, 1, 0, 1, 0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);

        assertEquals(1, report.gnssSnapshotCount);
        assertEquals(0, report.explainableGnssSnapshotCount);
        assertEquals(1, report.weakDecisionCount);
        assertEquals(0, report.weakDecisionWithGnssCount);
        assertEquals(35.0, report.averageWeakAccuracyMeters, 0.0);
        assertEquals(0.0, report.averageWeakUsedAvgCn0, 0.0);
        assertTrue(report.findings.toString().contains("weak 决策缺少可关联 GNSS snapshot"));
    }

    @Test
    public void generate_countsLocationIntakeRejectedAsRejectEvidence() throws Exception {
        File dir = Files.createTempDirectory("weak-gnss-report-intake-reject").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + gnss(2, 1, 1_500_000_000L, 4, 18.0, 23.0)
                + raw(3, 1, 2_000_000_000L, 90.0, false, 1)
                + intakeReject(4, 1, 2_000_000_000L, "accuracy_too_large");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 4, 1, 0, 0, 0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);

        assertEquals(1, report.rejectDecisionCount);
        assertEquals(1, report.rejectDecisionWithGnssCount);
        assertEquals(90.0, report.averageRejectAccuracyMeters, 0.0);
        assertEquals(4.0, report.averageRejectUsedInFixTotal, 0.0);
        assertEquals(18.0, report.averageRejectUsedAvgCn0, 0.0);
    }

    private String event(int seq, String eventName, long elapsedRealtimeNanos, String fields) {
        return "{\"event\":\"" + eventName + "\",\"sessionId\":\"S1\",\"eventSeq\":" + seq
                + ",\"schemaVersion\":1,\"eventElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + (fields.isEmpty() ? "" : "," + fields)
                + "}\n";
    }

    private String raw(int seq, int rawPointId, long elapsedRealtimeNanos, double accuracy,
                       boolean stale, Integer sourceGnssSnapshotId) {
        return event(seq, "raw_location", elapsedRealtimeNanos,
                "\"rawPointId\":" + rawPointId
                        + ",\"provider\":\"gps\",\"lat\":29.0,\"lng\":106.0"
                        + ",\"accuracy\":" + accuracy
                        + ",\"timeMillis\":1"
                        + ",\"hasElapsedRealtimeNanos\":true"
                        + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"gnssQualityStale\":" + stale
                        + (sourceGnssSnapshotId == null
                        ? "" : ",\"sourceGnssSnapshotId\":" + sourceGnssSnapshotId));
    }

    private String intakeReject(int seq, int rawPointId, long elapsedRealtimeNanos,
                                String reason) {
        return event(seq, "location_intake_rejected", elapsedRealtimeNanos,
                "\"rawPointId\":" + rawPointId
                        + ",\"rejectReason\":\"" + reason + "\"");
    }

    private String decision(int seq, int decisionId, int rawPointId, long elapsedRealtimeNanos,
                            String result, String reason, Integer sourceGnssSnapshotId) {
        return event(seq, "decision", elapsedRealtimeNanos,
                "\"decisionId\":" + decisionId
                        + ",\"rawPointId\":" + rawPointId
                        + ",\"result\":\"" + result + "\""
                        + ",\"reason\":\"" + reason + "\""
                        + (sourceGnssSnapshotId == null
                        ? "" : ",\"sourceGnssSnapshotId\":" + sourceGnssSnapshotId));
    }

    private String gnss(int seq, int snapshotId, long elapsedRealtimeNanos,
                        int usedInFixTotal, double usedAvgCn0, double top4AvgCn0) {
        return event(seq, "gnss_snapshot", elapsedRealtimeNanos,
                "\"snapshotId\":" + snapshotId
                        + ",\"receivedElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"visibleTotal\":8"
                        + ",\"usedInFixTotal\":" + usedInFixTotal
                        + ",\"usedAvgCn0\":" + usedAvgCn0
                        + ",\"allAvgCn0\":" + (usedAvgCn0 - 2.0)
                        + ",\"top4AvgCn0\":" + top4AvgCn0
                        + ",\"lowCn0VisibleCount\":2"
                        + ",\"weakUsedCount\":1");
    }

    private void writeSessionJson(File dir, long lastEventSeq, int rawPointCount,
                                  int trackPointCount, int weakTrackPointCount, int gapCount)
            throws Exception {
        JSONObject json = new JSONObject();
        json.put("sessionId", dir.getName());
        json.put("createdWallTimeMillis", 1L);
        json.put("createdElapsedRealtimeNanos", 1_000_000_000L);
        json.put("completionState", "FINISHED");
        json.put("integrityState", "OK");
        json.put("schemaVersion", 1);
        json.put("strategyVersion", "test");
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", lastEventSeq);
        json.put("lastUpdatedWallTimeMillis", 2L);
        json.put("rawPointCount", rawPointCount);
        json.put("trackPointCount", trackPointCount);
        json.put("weakTrackPointCount", weakTrackPointCount);
        json.put("segmentCount", gapCount + 1);
        json.put("gapCount", gapCount);
        json.put("totalDistanceMeters", 0.0);
        json.put("movingTimeSeconds", 0.0);
        Files.write(new File(dir, "session.json").toPath(),
                json.toString(2).getBytes(StandardCharsets.UTF_8));
    }
}
