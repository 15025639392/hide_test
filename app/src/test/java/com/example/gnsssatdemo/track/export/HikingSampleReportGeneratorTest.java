package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class HikingSampleReportGeneratorTest {
    @Test
    public void generate_buildsAutomatedReportForFinishedHikingSample() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report").toFile();
        String diagnostic = denseDiagnostic();
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 367, 181, 181, 0, 0, 1800.0, 1800.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(HikingSampleReport.VERDICT_PASS, report.verdict);
        assertEquals(181, report.rawLocationCount);
        assertEquals(181, report.decisionCount);
        assertEquals(0, report.gapRecoveryCount);
        assertEquals(0, report.gapRecoveryZeroDeltaCount);
        assertEquals(0, report.longRawIntervalCount);
        assertEquals(10.0, report.maxRawIntervalSeconds, 0.0);
        assertEquals(10.0, report.averageRawIntervalSeconds, 0.0);
        assertEquals(2, report.samplingRequestCounts.size());
        assertTrue(report.excludedMetrics.get(0).contains("电量"));
        assertTrue(report.toText().contains("多地图 GPX 兼容性自动回归不纳入当前统计"));
    }

    @Test
    public void generate_marksSparseRawSamplingForReview() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-sparse").toFile();
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                sparseDiagnostic().getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 11, 3, 3, 0, 1, 100.0, 590.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(HikingSampleReport.VERDICT_REVIEW, report.verdict);
        assertEquals(2, report.longRawIntervalCount);
        assertTrue(report.maxRawIntervalSeconds > 60.0);
        assertTrue(report.averageRawIntervalSeconds > 15.0);
        assertTrue(report.reviewFindings.toString().contains("RawPoint 最大间隔"));
        assertTrue(report.toText().contains("RawPoint 最大间隔"));
    }

    @Test
    public void generate_failsWhenSamplingDistanceFilterIsNonZero() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-fail").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "sampling_policy", 1_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":5")
                + raw(3, 1, 2_000_000_000L, false)
                + decision(4, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + event(5, "session_event", 3_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 5, 1, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(HikingSampleReport.VERDICT_FAIL, report.verdict);
        assertTrue(report.blockingFindings.toString().contains("minDistanceMeters"));
    }

    @Test
    public void generate_returnsFailReportWhenDiagnosticJsonlIsInvalid() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-invalid-jsonl").toFile();
        String diagnostic = ""
                + raw(1, 1, 2_000_000_000L, false)
                + "{bad-json}\n";
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 2, 1, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(DiagnosticLogSummary.STATUS_INVALID_JSONL, manifest.diagnosticLogReadStatus);
        assertEquals(HikingSampleReport.VERDICT_FAIL, report.verdict);
        assertTrue(report.blockingFindings.toString().contains("INVALID_JSONL"));
        assertTrue(report.blockingFindings.toString().contains("解析失败"));
    }

    @Test
    public void generate_failsWhenManifestCountsDoNotMatchDiagnosticCounts() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-count-mismatch").toFile();
        String diagnostic = denseDiagnostic();
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 367, 182, 182, 1, 1, 1800.0, 1800.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(HikingSampleReport.VERDICT_FAIL, report.verdict);
        assertTrue(report.blockingFindings.toString().contains("RawPoint"));
        assertTrue(report.blockingFindings.toString().contains("TrackPoint"));
        assertTrue(report.blockingFindings.toString().contains("WeakPoint"));
        assertTrue(report.blockingFindings.toString().contains("GAP"));
        assertTrue(report.blockingFindings.toString().contains("diagnostic"));
    }

    @Test
    public void generate_failsWhenRawLocationHasNoDecision() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-missing-decision").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0")
                + event(3, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + raw(4, 1, 2_000_000_000L, false)
                + decision(5, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + raw(6, 2, 12_000_000_000L, false)
                + event(7, "session_event", 13_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 7, 2, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(HikingSampleReport.VERDICT_FAIL, report.verdict);
        assertEquals(2, report.rawLocationCount);
        assertEquals(1, report.decisionCount);
        assertTrue(report.blockingFindings.toString().contains("每个 RawPoint"));
    }

    private String event(int seq, String eventName, long elapsedRealtimeNanos, String fields) {
        return "{\"event\":\"" + eventName + "\",\"sessionId\":\"S1\",\"eventSeq\":" + seq
                + ",\"schemaVersion\":1,\"eventElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + (fields.isEmpty() ? "" : "," + fields)
                + "}\n";
    }

    private String denseDiagnostic() {
        StringBuilder sb = new StringBuilder();
        int seq = 1;
        int rawPointId = 1;
        int decisionId = 1;
        long firstRawNanos = 2_000_000_000L;
        sb.append(event(seq++, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000"));
        sb.append(event(seq++, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0"));
        sb.append(event(seq++, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0"));
        sb.append(raw(seq++, rawPointId, firstRawNanos, false));
        sb.append(decision(seq++, decisionId, rawPointId, rawPointId, 1, firstRawNanos,
                "anchor", "first_fix_good", 0.0, 0.0));
        sb.append(event(seq++, "sampling_policy", 10_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":0"));
        for (int i = 1; i <= 180; i++) {
            rawPointId++;
            decisionId++;
            long elapsedRealtimeNanos = firstRawNanos + i * 10_000_000_000L;
            sb.append(raw(seq++, rawPointId, elapsedRealtimeNanos, false));
            sb.append(decision(seq++, decisionId, rawPointId, rawPointId, 1,
                    elapsedRealtimeNanos, "accept", "moving_good_fix", 10.0, 10.0));
        }
        sb.append(event(seq, "session_event", firstRawNanos + 1_810_000_000_000L,
                "\"eventType\":\"finish_recording\""));
        return sb.toString();
    }

    private String sparseDiagnostic() {
        return ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0")
                + event(3, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + raw(4, 1, 2_000_000_000L, false)
                + decision(5, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + event(6, "sampling_policy", 10_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":0")
                + raw(7, 2, 600_000_000_000L, false)
                + decision(8, 2, 2, 2, 1, 600_000_000_000L,
                "accept", "moving_good_fix", 100.0, 590.0)
                + raw(9, 3, 2_000_000_000_000L, false)
                + decision(10, 3, 3, 3, 2, 2_000_000_000_000L,
                "accept", "gap_recovery", 0.0, 0.0)
                + event(11, "session_event", 2_100_000_000_000L,
                "\"eventType\":\"finish_recording\"");
    }

    private String raw(int seq, int rawPointId, long elapsedRealtimeNanos, boolean stale) {
        return event(seq, "raw_location", elapsedRealtimeNanos,
                "\"rawPointId\":" + rawPointId
                        + ",\"provider\":\"gps\",\"lat\":29.0,\"lng\":106.0"
                        + ",\"accuracy\":10.0,\"timeMillis\":1"
                        + ",\"hasElapsedRealtimeNanos\":true"
                        + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"gnssQualityStale\":" + stale);
    }

    private String decision(int seq, int decisionId, int rawPointId, int trackPointId,
                            int segmentId, long elapsedRealtimeNanos, String result,
                            String reason, double distanceDelta, double movingDelta) {
        return event(seq, "decision", elapsedRealtimeNanos,
                "\"decisionId\":" + decisionId
                        + ",\"rawPointId\":" + rawPointId
                        + ",\"trackPointId\":" + trackPointId
                        + ",\"segmentId\":" + segmentId
                        + ",\"result\":\"" + result + "\""
                        + ",\"reason\":\"" + reason + "\""
                        + ",\"distanceDeltaMeters\":" + distanceDelta
                        + ",\"movingTimeDeltaSeconds\":" + movingDelta);
    }

    private void writeSessionJson(File dir, long lastEventSeq, int rawPointCount,
                                  int trackPointCount, int weakTrackPointCount, int gapCount,
                                  double totalDistanceMeters, double movingTimeSeconds)
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
        json.put("totalDistanceMeters", totalDistanceMeters);
        json.put("movingTimeSeconds", movingTimeSeconds);
        Files.write(new File(dir, "session.json").toPath(),
                json.toString(2).getBytes(StandardCharsets.UTF_8));
    }
}
