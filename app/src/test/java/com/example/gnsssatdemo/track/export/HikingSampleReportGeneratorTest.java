package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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

    @Test
    public void generate_summarizesPhase6GnssQualityMetricsWhenPresent() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-gnss-quality").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0")
                + event(3, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + gnss(4, 1, 1_500_000_000L, 30.0, 25.0, 35.0, 2, 1, true)
                + raw(5, 1, 2_000_000_000L, false)
                + decision(6, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + event(7, "sampling_policy", 10_000_000_000L,
                "\"state\":\"MOVING\",\"locationRequestMinDistanceMeters\":0")
                + gnss(8, 2, 11_000_000_000L, 28.0, 24.0, 34.0, 4, 2, false)
                + raw(9, 2, 12_000_000_000L, false)
                + decision(10, 2, 2, 2, 1, 12_000_000_000L,
                "accept", "moving_good_fix", 10.0, 10.0)
                + event(11, "session_event", 1_812_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 11, 2, 2, 0, 0, 10.0, 10.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(2, report.gnssSnapshotCount);
        assertEquals(2, report.gnssQualityMetricSnapshotCount);
        assertEquals(29.0, report.averageUsedAvgCn0, 0.0);
        assertEquals(24.5, report.averageAllAvgCn0, 0.0);
        assertEquals(34.5, report.averageTop4AvgCn0, 0.0);
        assertEquals(3.0, report.averageLowCn0VisibleCount, 0.0);
        assertEquals(1.5, report.averageWeakUsedCount, 0.0);
        assertEquals(1, report.dualFrequencySnapshotCount);
        assertTrue(report.toText().contains("GNSS 质量解释"));
        assertEquals(2, report.toJson().getInt("gnssQualityMetricSnapshotCount"));
    }

    @Test
    public void generate_correlatesWeakAndRejectDecisionsWithGnssSnapshots() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-decision-gnss").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0")
                + event(3, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + gnss(4, 1, 1_500_000_000L, 32.0, 28.0, 38.0, 1, 0, true)
                + raw(5, 1, 2_000_000_000L, false)
                + decisionWithSnapshot(6, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0, 1)
                + gnss(7, 2, 11_000_000_000L, 18.0, 16.0, 22.0, 5, 3, false)
                + raw(8, 2, 12_000_000_000L, false)
                + decisionWithSnapshot(9, 2, 2, 2, 1, 12_000_000_000L,
                "weak", "weak_signal_stage1", 0.0, 0.0, 2)
                + gnss(10, 3, 21_000_000_000L, 12.0, 10.0, 14.0, 7, 4, false)
                + raw(11, 3, 22_000_000_000L, false)
                + decisionWithSnapshot(12, 3, 3, 0, 1, 22_000_000_000L,
                "reject", "impossible_speed", 0.0, 0.0, 3)
                + event(13, "session_event", 1_822_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 13, 3, 1, 1, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.weakGnssExplainableDecisionCount);
        assertEquals(18.0, report.averageWeakDecisionUsedAvgCn0, 0.0);
        assertEquals(16.0, report.averageWeakDecisionAllAvgCn0, 0.0);
        assertEquals(22.0, report.averageWeakDecisionTop4AvgCn0, 0.0);
        assertEquals(5.0, report.averageWeakDecisionLowCn0VisibleCount, 0.0);
        assertEquals(3.0, report.averageWeakDecisionWeakUsedCount, 0.0);
        assertEquals(1, report.rejectGnssExplainableDecisionCount);
        assertEquals(12.0, report.averageRejectDecisionUsedAvgCn0, 0.0);
        assertEquals(7.0, report.averageRejectDecisionLowCn0VisibleCount, 0.0);
        assertTrue(report.toText().contains("weak 决策关联 Snapshot=1"));
        assertEquals(1, report.toJson().getInt("rejectGnssExplainableDecisionCount"));
    }

    @Test
    public void generate_toleratesLegacyGnssSnapshotsWithoutPhase6Metrics() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-legacy-gnss").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + event(2, "config_snapshot", 1_000_000_000L,
                "\"locationRequestMinDistanceMeters\":0")
                + event(3, "sampling_policy", 1_000_000_000L,
                "\"state\":\"STARTING\",\"locationRequestMinDistanceMeters\":0")
                + event(4, "gnss_snapshot", 1_500_000_000L,
                "\"snapshotId\":1,\"visibleTotal\":8,\"usedInFixTotal\":4,\"usedAvgCn0\":30.0")
                + raw(5, 1, 2_000_000_000L, false)
                + decision(6, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + event(7, "session_event", 1_802_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 7, 1, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.gnssSnapshotCount);
        assertEquals(0, report.gnssQualityMetricSnapshotCount);
        assertEquals(0.0, report.averageAllAvgCn0, 0.0);
        assertTrue(!report.toText().contains("GNSS 质量解释"));
    }

    @Test
    public void generate_summarizesStationaryDecisionsSupportedByAccelerometer() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-motion").toFile();
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
                + motionWindow(6, 1, 2_000_000_000L, 3_000_000_000L, true)
                + raw(7, 2, 3_000_000_000L, false)
                + decision(8, 2, 2, 0, 1, 3_000_000_000L,
                "reject", "stationary_keepalive", 0.0, 0.0)
                + motionWindow(9, 2, 3_500_000_000L, 4_500_000_000L, false)
                + raw(10, 3, 4_000_000_000L, false)
                + decision(11, 3, 3, 0, 1, 4_000_000_000L,
                "reject", "stationary_jitter", 0.0, 0.0)
                + raw(12, 4, 10_000_000_000L, false)
                + decision(13, 4, 4, 0, 1, 10_000_000_000L,
                "reject", "stationary_jitter", 0.0, 0.0)
                + event(14, "session_event", 1_802_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 14, 4, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(2, report.motionSummaryCount);
        assertEquals(3, report.stationaryDecisionCount);
        assertEquals(1, report.stationarySupportedByAccelCount);
        assertEquals(1, report.stationaryMissingMotionSummaryCount);
        assertEquals(1.0 / 3.0,
                report.toJson().getDouble("stationarySupportedByAccelRatio"), 0.0001);
        assertTrue(report.toText().contains("加速度计静止证据"));
    }

    @Test
    public void generate_matchesMotionSummaryWrittenAfterStationaryDecision() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-motion-order").toFile();
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
                + raw(6, 2, 3_000_000_000L, false)
                + decision(7, 2, 2, 0, 1, 3_000_000_000L,
                "reject", "stationary_keepalive", 0.0, 0.0)
                + motion(8, 1, 2_900_000_000L, true)
                + event(9, "session_event", 1_802_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 9, 2, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.stationaryDecisionCount);
        assertEquals(1, report.stationarySupportedByAccelCount);
        assertEquals(0, report.stationaryMissingMotionSummaryCount);
    }

    @Test
    public void generate_matchesMotionSummaryWindowContainingStationaryDecision() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-motion-window").toFile();
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
                + raw(6, 2, 3_000_000_000L, false)
                + decision(7, 2, 2, 0, 1, 3_000_000_000L,
                "reject", "stationary_keepalive", 0.0, 0.0)
                + motionWindow(8, 1, 2_500_000_000L, 3_500_000_000L, true)
                + event(9, "session_event", 1_802_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 9, 2, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.stationaryDecisionCount);
        assertEquals(1, report.stationarySupportedByAccelCount);
        assertEquals(0, report.stationaryMissingMotionSummaryCount);
    }

    @Test
    public void generate_countsRestAnchorRefinementAsStationaryMotionEvidence() throws Exception {
        File dir = Files.createTempDirectory("hiking-sample-report-rest-anchor-motion").toFile();
        String diagnostic = ""
                + event(1, "session_metadata", 1_000_000_000L,
                "\"createdElapsedRealtimeNanos\":1000000000")
                + raw(2, 1, 2_000_000_000L, false)
                + decision(3, 1, 1, 1, 1, 2_000_000_000L,
                "anchor", "first_fix_good", 0.0, 0.0)
                + motionWindow(4, 1, 2_000_000_000L, 3_000_000_000L, true)
                + raw(5, 2, 3_000_000_000L, false)
                + decision(6, 2, 2, 1, 1, 3_000_000_000L,
                "anchor", "stationary_anchor_refined", 0.0, 0.0)
                + raw(7, 3, 4_000_000_000L, false)
                + decision(8, 3, 3, 1, 1, 4_000_000_000L,
                "reject", "stationary_accel_supported_jitter", 0.0, 0.0)
                + event(9, "session_event", 6_000_000_000L,
                "\"eventType\":\"finish_recording\"");
        Files.write(new File(dir, "diagnostic.jsonl").toPath(),
                diagnostic.getBytes(StandardCharsets.UTF_8));
        Files.write(new File(dir, "track.gpx").toPath(),
                "<gpx/>".getBytes(StandardCharsets.UTF_8));
        writeSessionJson(dir, 9, 3, 1, 0, 0, 0.0, 0.0);

        SessionManifest manifest = new SessionManifestReader(new SessionFileStore(dir.getParentFile()))
                .read(dir);
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);

        assertEquals(1, report.trustedDecisionCount);
        assertFalse(report.blockingFindings.toString().contains("TrackPoint"));
        assertEquals(2, report.stationaryDecisionCount);
        assertEquals(2, report.stationarySupportedByAccelCount);
        assertEquals(0, report.stationaryMissingMotionSummaryCount);
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

    private String decisionWithSnapshot(int seq, int decisionId, int rawPointId, int trackPointId,
                                        int segmentId, long elapsedRealtimeNanos, String result,
                                        String reason, double distanceDelta, double movingDelta,
                                        long sourceGnssSnapshotId) {
        return event(seq, "decision", elapsedRealtimeNanos,
                "\"decisionId\":" + decisionId
                        + ",\"rawPointId\":" + rawPointId
                        + ",\"trackPointId\":" + trackPointId
                        + ",\"segmentId\":" + segmentId
                        + ",\"result\":\"" + result + "\""
                        + ",\"reason\":\"" + reason + "\""
                        + ",\"distanceDeltaMeters\":" + distanceDelta
                        + ",\"movingTimeDeltaSeconds\":" + movingDelta
                        + ",\"sourceGnssSnapshotId\":" + sourceGnssSnapshotId);
    }

    private String gnss(int seq, int snapshotId, long elapsedRealtimeNanos,
                        double usedAvgCn0, double allAvgCn0, double top4AvgCn0,
                        int lowCn0VisibleCount, int weakUsedCount, boolean hasDualFrequency) {
        return event(seq, "gnss_snapshot", elapsedRealtimeNanos,
                "\"snapshotId\":" + snapshotId
                        + ",\"receivedElapsedRealtimeNanos\":" + elapsedRealtimeNanos
                        + ",\"visibleTotal\":8"
                        + ",\"usedInFixTotal\":4"
                        + ",\"usedAvgCn0\":" + usedAvgCn0
                        + ",\"allAvgCn0\":" + allAvgCn0
                        + ",\"top4AvgCn0\":" + top4AvgCn0
                        + ",\"lowCn0VisibleCount\":" + lowCn0VisibleCount
                        + ",\"weakUsedCount\":" + weakUsedCount
                        + ",\"hasDualFrequency\":" + hasDualFrequency);
    }

    private String motion(int seq, int motionSummaryId, long elapsedRealtimeNanos,
                          boolean isDeviceStill) {
        return motionWindow(seq, motionSummaryId, elapsedRealtimeNanos - 1_000_000_000L,
                elapsedRealtimeNanos, isDeviceStill);
    }

    private String motionWindow(int seq, int motionSummaryId, long firstElapsedRealtimeNanos,
                                long lastElapsedRealtimeNanos, boolean isDeviceStill) {
        long eventElapsedRealtimeNanos = lastElapsedRealtimeNanos;
        return event(seq, "motion_summary", eventElapsedRealtimeNanos,
                "\"motionSummaryId\":" + motionSummaryId
                        + ",\"firstElapsedRealtimeNanos\":" + firstElapsedRealtimeNanos
                        + ",\"lastElapsedRealtimeNanos\":" + lastElapsedRealtimeNanos
                        + ",\"sampleCount\":10"
                        + ",\"dynamicAccelRmsMps2\":0.08"
                        + ",\"stillScore\":" + (isDeviceStill ? 0.8 : 0.1)
                        + ",\"isDeviceStill\":" + isDeviceStill
                        + ",\"sourceSensorType\":\"TYPE_LINEAR_ACCELERATION\"");
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
