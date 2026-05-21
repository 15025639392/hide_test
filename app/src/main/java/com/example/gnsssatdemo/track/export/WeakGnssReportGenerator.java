package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.GnssSnapshotDiagnosticFields;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class WeakGnssReportGenerator {
    private static final long GAP_WINDOW_NANOS = 30_000_000_000L;

    public WeakGnssReport generate(SessionManifest manifest) throws IOException, JSONException {
        Accumulator accumulator = readDiagnostic(
                new File(manifest.sessionDir, manifest.diagnosticLogFileName));
        return accumulator.toReport(manifest.sessionId);
    }

    private Accumulator readDiagnostic(File diagnosticFile) throws IOException, JSONException {
        Accumulator accumulator = new Accumulator();
        if (!diagnosticFile.exists()) {
            return accumulator;
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(diagnosticFile), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                accumulator.onEvent(new JSONObject(trimmed));
            }
        }
        try {
            accumulator.applyTrackProduct(new EvidenceTrackProductBuilder().build(diagnosticFile));
        } catch (IOException | JSONException ignored) {
            // The report can still describe raw GNSS evidence when product rebuild fails.
        }
        accumulator.finish();
        return accumulator;
    }

    private static class Accumulator {
        int rawLocationCount;
        int staleRawLocationCount;
        int gnssSnapshotCount;
        int explainableGnssSnapshotCount;
        int weakDecisionCount;
        int rejectDecisionCount;
        int gapRecoveryCount;
        int noLocationTimeoutCount;
        double maxNoLocationTimeoutSeconds;
        final Map<Long, RawSummary> rawById = new LinkedHashMap<>();
        final Map<Long, GnssMetricSnapshot> gnssById = new LinkedHashMap<>();
        final GnssDecisionMetrics weakMetrics = new GnssDecisionMetrics();
        final GnssDecisionMetrics rejectMetrics = new GnssDecisionMetrics();
        final GnssDecisionMetrics transportMetrics = new GnssDecisionMetrics();
        final GnssWindowMetrics gapBeforeMetrics = new GnssWindowMetrics();
        final GnssWindowMetrics gapAfterMetrics = new GnssWindowMetrics();
        final List<Long> gapRecoveryElapsedTimes = new ArrayList<>();

        void onEvent(JSONObject event) {
            String eventName = event.optString("event", "");
            if ("raw_location".equals(eventName)) {
                onRawLocation(event);
            } else if ("gnss_snapshot".equals(eventName)) {
                onGnssSnapshot(event);
            } else if ("session_event".equals(eventName)) {
                onSessionEvent(event);
            }
        }

        void onRawLocation(JSONObject event) {
            rawLocationCount++;
            if (event.optBoolean("gnssQualityStale", false)) {
                staleRawLocationCount++;
            }
            Long sourceGnssSnapshotId = event.has("sourceGnssSnapshotId")
                    ? event.optLong("sourceGnssSnapshotId") : null;
            rawById.put(event.optLong("rawPointId"),
                    new RawSummary(event.optDouble("accuracy", 0.0), sourceGnssSnapshotId));
        }

        void onGnssSnapshot(JSONObject event) {
            gnssSnapshotCount++;
            if (!event.has(GnssSnapshotDiagnosticFields.ALL_AVG_CN0)
                    || !event.has(GnssSnapshotDiagnosticFields.TOP4_AVG_CN0)) {
                return;
            }
            explainableGnssSnapshotCount++;
            GnssMetricSnapshot snapshot = GnssMetricSnapshot.fromEvent(event);
            gnssById.put(event.optLong(GnssSnapshotDiagnosticFields.SNAPSHOT_ID), snapshot);
        }

        void applyTrackProduct(EvidenceTrackProductBuilder.Result product) {
            weakDecisionCount = 0;
            rejectDecisionCount = 0;
            gapRecoveryCount = 0;
            weakMetrics.clear();
            rejectMetrics.clear();
            transportMetrics.clear();
            gapRecoveryElapsedTimes.clear();
            for (EvidenceTrackProductBuilder.DecisionRecord decision : product.decisions) {
                onDecisionRecord(decision);
            }
        }

        void onDecisionRecord(EvidenceTrackProductBuilder.DecisionRecord decision) {
            RawSummary raw = rawById.get(decision.rawPointId);
            GnssMetricSnapshot snapshot = snapshotFor(decision.sourceGnssSnapshotId, raw);
            if ("weak".equals(decision.result)) {
                weakDecisionCount++;
                weakMetrics.add(raw, snapshot);
            } else if ("reject".equals(decision.result)
                    || "intake_rejected".equals(decision.result)) {
                rejectDecisionCount++;
                rejectMetrics.add(raw, snapshot);
            }
            if ("transport_suspected_kept".equals(decision.reason)) {
                transportMetrics.add(raw, snapshot);
            }
            if ("gap_recovery".equals(decision.reason)
                    || "continuity_rescue_gap_recovery".equals(decision.reason)) {
                gapRecoveryCount++;
                gapRecoveryElapsedTimes.add(decision.elapsedRealtimeNanos);
            }
        }

        void onSessionEvent(JSONObject event) {
            if (!"no_location_timeout".equals(event.optString("eventType", ""))) {
                return;
            }
            noLocationTimeoutCount++;
            double seconds = event.optLong("elapsedSinceLastLocationMillis", 0L) / 1000.0;
            if (seconds > maxNoLocationTimeoutSeconds) {
                maxNoLocationTimeoutSeconds = seconds;
            }
        }

        GnssMetricSnapshot snapshotFor(Long sourceGnssSnapshotId, RawSummary raw) {
            if (sourceGnssSnapshotId != null) {
                return gnssById.get(sourceGnssSnapshotId);
            }
            if (raw != null && raw.sourceGnssSnapshotId != null) {
                return gnssById.get(raw.sourceGnssSnapshotId);
            }
            return null;
        }

        void addGapWindowMetrics(long gapElapsedRealtimeNanos) {
            if (gapElapsedRealtimeNanos <= 0L) {
                return;
            }
            GnssMetricSnapshot before = null;
            GnssMetricSnapshot after = null;
            long bestBeforeAge = Long.MAX_VALUE;
            long bestAfterAge = Long.MAX_VALUE;
            for (GnssMetricSnapshot snapshot : gnssById.values()) {
                long delta = gapElapsedRealtimeNanos - snapshot.elapsedRealtimeNanos;
                if (delta >= 0L && delta <= GAP_WINDOW_NANOS && delta < bestBeforeAge) {
                    before = snapshot;
                    bestBeforeAge = delta;
                } else if (delta < 0L && -delta <= GAP_WINDOW_NANOS && -delta < bestAfterAge) {
                    after = snapshot;
                    bestAfterAge = -delta;
                }
            }
            gapBeforeMetrics.add(before);
            gapAfterMetrics.add(after);
        }

        void finish() {
            for (Long gapElapsedRealtimeNanos : gapRecoveryElapsedTimes) {
                addGapWindowMetrics(gapElapsedRealtimeNanos);
            }
        }

        WeakGnssReport toReport(String sessionId) {
            return new WeakGnssReport(sessionId,
                    rawLocationCount,
                    staleRawLocationCount,
                    rawLocationCount == 0 ? 0.0 : staleRawLocationCount / (double) rawLocationCount,
                    gnssSnapshotCount,
                    explainableGnssSnapshotCount,
                    weakDecisionCount,
                    weakMetrics.linkedGnssCount,
                    weakMetrics.averageAccuracyMeters(),
                    weakMetrics.averageUsedInFixTotal(),
                    weakMetrics.averageUsedAvgCn0(),
                    weakMetrics.averageTop4AvgCn0(),
                    rejectDecisionCount,
                    rejectMetrics.linkedGnssCount,
                    rejectMetrics.averageAccuracyMeters(),
                    rejectMetrics.averageUsedInFixTotal(),
                    rejectMetrics.averageUsedAvgCn0(),
                    rejectMetrics.averageTop4AvgCn0(),
                    transportMetrics.decisionCount,
                    transportMetrics.linkedGnssCount,
                    transportMetrics.averageUsedAvgCn0(),
                    transportMetrics.averageTop4AvgCn0(),
                    gapRecoveryCount,
                    gapBeforeMetrics.count,
                    gapAfterMetrics.count,
                    gapBeforeMetrics.averageTop4AvgCn0(),
                    gapAfterMetrics.averageTop4AvgCn0(),
                    noLocationTimeoutCount,
                    maxNoLocationTimeoutSeconds,
                    findings());
        }

        List<String> findings() {
            List<String> findings = new ArrayList<>();
            if (weakDecisionCount > 0 && weakMetrics.averageUsedAvgCn0() > 0.0
                    && weakMetrics.averageUsedAvgCn0() < 25.0) {
                findings.add("weak 点伴随较低 usedAvgCn0，弱信号可能来自卫星信噪比不足");
            }
            if (weakDecisionCount > 0 && weakMetrics.averageUsedInFixTotal() > 0.0
                    && weakMetrics.averageUsedInFixTotal() < 5.0) {
                findings.add("weak 点参与定位卫星数偏少，可能存在遮挡或星座几何不足");
            }
            if (rawLocationCount > 0 && staleRawLocationCount / (double) rawLocationCount > 0.20) {
                findings.add("较多 RawLocation 缺少新鲜 GNSS snapshot，存在诊断解释缺口");
            }
            if (weakDecisionCount > weakMetrics.linkedGnssCount) {
                findings.add("部分 weak 决策缺少可关联 GNSS snapshot，弱信号原因存在解释缺口");
            }
            if (rejectDecisionCount > rejectMetrics.linkedGnssCount) {
                findings.add("部分 reject 决策缺少可关联 GNSS snapshot，拒绝原因缺少卫星质量佐证");
            }
            if (transportMetrics.decisionCount > transportMetrics.linkedGnssCount) {
                findings.add("部分交通工具混入决策缺少可关联 GNSS snapshot，运动模式解释不完整");
            }
            if (gapRecoveryCount > 0 || noLocationTimeoutCount > 0) {
                findings.add("存在 GAP 或无定位回调，需结合系统后台/省电行为复核");
            }
            if (transportMetrics.decisionCount > 0 && transportMetrics.averageUsedAvgCn0() >= 25.0) {
                findings.add("交通工具混入段 GNSS 质量不低，更像运动模式问题而非弱信号问题");
            }
            if (findings.isEmpty() && weakDecisionCount == 0 && rejectDecisionCount == 0
                    && gapRecoveryCount == 0 && noLocationTimeoutCount == 0) {
                findings.add("未发现明显 weak/reject/GAP 弱 GPS 证据");
            }
            return findings;
        }
    }

    private static class RawSummary {
        final double accuracyMeters;
        final Long sourceGnssSnapshotId;

        RawSummary(double accuracyMeters, Long sourceGnssSnapshotId) {
            this.accuracyMeters = accuracyMeters;
            this.sourceGnssSnapshotId = sourceGnssSnapshotId;
        }
    }

    private static class GnssMetricSnapshot {
        final long elapsedRealtimeNanos;
        final double usedInFixTotal;
        final double usedAvgCn0;
        final double top4AvgCn0;

        GnssMetricSnapshot(long elapsedRealtimeNanos, double usedInFixTotal,
                           double usedAvgCn0, double top4AvgCn0) {
            this.elapsedRealtimeNanos = elapsedRealtimeNanos;
            this.usedInFixTotal = usedInFixTotal;
            this.usedAvgCn0 = usedAvgCn0;
            this.top4AvgCn0 = top4AvgCn0;
        }

        static GnssMetricSnapshot fromEvent(JSONObject event) {
            return new GnssMetricSnapshot(
                    event.optLong(GnssSnapshotDiagnosticFields.RECEIVED_ELAPSED_REALTIME_NANOS,
                            event.optLong("eventElapsedRealtimeNanos", -1L)),
                    event.optDouble(GnssSnapshotDiagnosticFields.USED_IN_FIX_TOTAL, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.USED_AVG_CN0, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.TOP4_AVG_CN0, 0.0));
        }
    }

    private static class GnssDecisionMetrics {
        int decisionCount;
        int linkedGnssCount;
        double accuracyTotal;
        int accuracyCount;
        double usedInFixTotal;
        double usedAvgCn0Total;
        double top4AvgCn0Total;

        void clear() {
            decisionCount = 0;
            linkedGnssCount = 0;
            accuracyTotal = 0.0;
            accuracyCount = 0;
            usedInFixTotal = 0.0;
            usedAvgCn0Total = 0.0;
            top4AvgCn0Total = 0.0;
        }

        void add(RawSummary raw, GnssMetricSnapshot snapshot) {
            decisionCount++;
            if (raw != null && raw.accuracyMeters > 0.0) {
                accuracyTotal += raw.accuracyMeters;
                accuracyCount++;
            }
            if (snapshot == null) {
                return;
            }
            linkedGnssCount++;
            usedInFixTotal += snapshot.usedInFixTotal;
            usedAvgCn0Total += snapshot.usedAvgCn0;
            top4AvgCn0Total += snapshot.top4AvgCn0;
        }

        double averageAccuracyMeters() {
            return accuracyCount == 0 ? 0.0 : accuracyTotal / accuracyCount;
        }

        double averageUsedInFixTotal() {
            return linkedGnssCount == 0 ? 0.0 : usedInFixTotal / linkedGnssCount;
        }

        double averageUsedAvgCn0() {
            return linkedGnssCount == 0 ? 0.0 : usedAvgCn0Total / linkedGnssCount;
        }

        double averageTop4AvgCn0() {
            return linkedGnssCount == 0 ? 0.0 : top4AvgCn0Total / linkedGnssCount;
        }
    }

    private static class GnssWindowMetrics {
        int count;
        double top4AvgCn0Total;

        void add(GnssMetricSnapshot snapshot) {
            if (snapshot == null) {
                return;
            }
            count++;
            top4AvgCn0Total += snapshot.top4AvgCn0;
        }

        double averageTop4AvgCn0() {
            return count == 0 ? 0.0 : top4AvgCn0Total / count;
        }
    }
}
