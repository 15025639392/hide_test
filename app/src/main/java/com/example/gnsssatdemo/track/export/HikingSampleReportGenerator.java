package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class HikingSampleReportGenerator {
    private static final double MIN_TARGET_DURATION_SECONDS = 30.0 * 60.0;
    private static final double MAX_TARGET_DURATION_SECONDS = 60.0 * 60.0;
    private static final double MAX_REVIEW_DURATION_SECONDS = 65.0 * 60.0;
    private static final double MAX_RAW_INTERVAL_REVIEW_SECONDS = 60.0;
    private static final double MAX_AVERAGE_RAW_INTERVAL_REVIEW_SECONDS = 15.0;

    public HikingSampleReport generate(SessionManifest manifest) throws IOException, JSONException {
        File diagnosticFile = new File(manifest.sessionDir, manifest.diagnosticLogFileName);
        Accumulator accumulator = new Accumulator();
        String diagnosticReadError = null;
        try {
            accumulator = readDiagnostic(diagnosticFile);
        } catch (IOException | JSONException e) {
            diagnosticReadError = e.getMessage();
        }
        TrackAscentCalculator.Result ascentResult =
                TrackAscentCalculator.ascentResult(new ArrayList<>(), new ArrayList<>());
        try {
            DiagnosticTrackPointReader.AscentInputs ascentInputs =
                    new DiagnosticTrackPointReader().readAscentInputs(diagnosticFile);
            ascentResult = TrackAscentCalculator.ascentResult(
                    ascentInputs.trackPoints, ascentInputs.barometerSamples);
        } catch (IOException | JSONException ignored) {
            // The main diagnostic read error path above already reports parse failures.
        }

        List<String> blocking = new ArrayList<>();
        List<String> review = new ArrayList<>();
        List<String> excluded = new ArrayList<>();
        excluded.add("电量/省电证据：当前不纳入真实样本统计");
        excluded.add("多地图 GPX 兼容性自动回归：当前不纳入真实样本统计");

        if (!SessionManifest.READ_OK.equals(manifest.readStatus)) {
            blocking.add("session.json 读取状态异常: " + manifest.readStatus);
        }
        if (!diagnosticFile.exists()) {
            blocking.add("evidence.jsonl 缺失，无法自动解释 reject/weak/GAP");
        }
        if (!DiagnosticLogSummary.STATUS_OK.equals(manifest.diagnosticLogReadStatus)) {
            blocking.add("evidence.jsonl 读取状态异常: " + manifest.diagnosticLogReadStatus);
        }
        if (diagnosticReadError != null) {
            blocking.add("evidence.jsonl 解析失败: " + diagnosticReadError);
        }
        if (!"FINISHED".equals(manifest.completionState)) {
            blocking.add("session 未正常完成: " + manifest.completionState);
        }
        if (!"OK".equals(manifest.integrityState)) {
            blocking.add("session 完整性异常: " + manifest.integrityState);
        }
        if (accumulator.rawLocationCount == 0) {
            blocking.add("没有 raw_location，不能作为真实徒步样本");
        }
        if (accumulator.decisionCount == 0) {
            blocking.add("没有 decision，不能解释轨迹筛选过程");
        }
        if (manifest.trackPointCount <= 0) {
            blocking.add("没有可信 TrackPoint，不能验证距离和连续轨迹口径");
        }
        addCountMismatch(blocking, "RawPoint", manifest.rawPointCount,
                accumulator.rawLocationCount, "raw_location");
        addCountMismatch(blocking, "TrackPoint", manifest.trackPointCount,
                accumulator.trustedDecisionCount, "accept/anchor decision");
        addCountMismatch(blocking, "WeakPoint", manifest.weakTrackPointCount,
                accumulator.weakDecisionCount, "weak decision");
        addCountMismatch(blocking, "GAP", manifest.gapCount,
                accumulator.gapRecoveryCount, "gap_recovery decision");
        if (accumulator.rawLocationCount != accumulator.explainedRawPointIds.size()) {
            blocking.add("diagnostic raw_location=" + accumulator.rawLocationCount
                    + " 与 decision/intake/integrity 解释数="
                    + accumulator.explainedRawPointIds.size()
                    + " 不一致，不能保证每个 RawPoint 都有 accept/reject/weak 或 intake 解释");
        }
        if (accumulator.nonZeroDistanceSamplingCount > 0) {
            blocking.add("发现 minDistanceMeters 非 0 的采样请求: "
                    + accumulator.nonZeroDistanceSamplingCount);
        }
        if (accumulator.gapRecoveryCount != accumulator.gapRecoveryZeroDeltaCount) {
            blocking.add("存在 gap_recovery 但 delta 不为 0，GAP 距离口径不可信");
        }
        if (!manifest.diagnosticEventSeqMatchesManifest) {
            review.add("diagnostic 最后一条完整事件序号与 session.json 不一致");
        }
        if (accumulator.rawDurationSeconds() < MIN_TARGET_DURATION_SECONDS) {
            review.add("RawPoint 时长不足 30 分钟，当前为 "
                    + oneDecimal(accumulator.rawDurationSeconds() / 60.0) + " 分钟");
        } else if (accumulator.rawDurationSeconds() > MAX_REVIEW_DURATION_SECONDS) {
            review.add("RawPoint 时长超过 60 分钟目标窗口，当前为 "
                    + oneDecimal(accumulator.rawDurationSeconds() / 60.0) + " 分钟");
        } else if (accumulator.rawDurationSeconds() > MAX_TARGET_DURATION_SECONDS) {
            review.add("RawPoint 时长略高于 60 分钟，可继续使用但需注明样本长度");
        }
        if (accumulator.longRawIntervalCount > 0) {
            review.add("RawPoint 最大间隔偏大: "
                    + oneDecimal(accumulator.maxRawIntervalSeconds) + " 秒，超过 "
                    + oneDecimal(MAX_RAW_INTERVAL_REVIEW_SECONDS) + " 秒的间隔="
                    + accumulator.longRawIntervalCount);
        }
        if (accumulator.averageRawIntervalSeconds() > MAX_AVERAGE_RAW_INTERVAL_REVIEW_SECONDS) {
            review.add("RawPoint 平均间隔偏大: "
                    + oneDecimal(accumulator.averageRawIntervalSeconds()) + " 秒");
        }
        if (accumulator.samplingRequestCounts.isEmpty()) {
            review.add("没有 sampling_policy 事件，不能自动确认采样策略切换");
        }
        if (accumulator.noLocationTimeoutCount > 0) {
            review.add("存在 no_location_timeout: " + accumulator.noLocationTimeoutCount
                    + " 次，最大 " + oneDecimal(accumulator.maxNoLocationTimeoutSeconds) + " 秒");
        }
        int transportSuspectedCount = accumulator.reasonCount("accept:transport_suspected_kept");
        int transportRecoveryCount =
                accumulator.reasonCount("accept:recovery_transport_suspected_kept");
        if (transportSuspectedCount > 0 || transportRecoveryCount > 0) {
            review.add("检测到疑似交通工具移动: kept=" + transportSuspectedCount
                    + " recovery=" + transportRecoveryCount
                    + "，按目标算法保留连续轨迹并标注风险");
        }
        if (accumulator.decisionCount > 0) {
            double weakRatio = accumulator.weakDecisionCount / (double) accumulator.decisionCount;
            double rejectRatio = accumulator.rejectDecisionCount / (double) accumulator.decisionCount;
            if (weakRatio > 0.30) {
                review.add("weak 决策占比偏高: " + oneDecimal(weakRatio * 100.0) + "%");
            }
            if (rejectRatio > 0.50) {
                review.add("reject 决策占比偏高: " + oneDecimal(rejectRatio * 100.0) + "%");
            }
        }

        String verdict = blocking.isEmpty()
                ? (review.isEmpty() ? HikingSampleReport.VERDICT_PASS
                : HikingSampleReport.VERDICT_REVIEW)
                : HikingSampleReport.VERDICT_FAIL;

        return new HikingSampleReport(manifest.sessionId, verdict,
                accumulator.diagnosticDurationSeconds(),
                accumulator.rawDurationSeconds(),
                accumulator.maxRawIntervalSeconds,
                accumulator.averageRawIntervalSeconds(),
                accumulator.longRawIntervalCount,
                manifest.totalDistanceMeters,
                ascentResult.totalAscentMeters,
                ascentResult.source,
                ascentResult.barometerTotalAscentMeters,
                ascentResult.gnssTotalAscentMeters,
                ascentResult.barometerSampleCount,
                ascentResult.gnssSampleCount,
                ascentResult.barometerRejectedSampleCount,
                ascentResult.gnssRejectedSampleCount,
                manifest.movingTimeSeconds,
                manifest.rawPointCount,
                manifest.trackPointCount,
                manifest.weakTrackPointCount,
                manifest.gapCount,
                accumulator.rawLocationCount,
                accumulator.decisionCount,
                accumulator.trustedDecisionCount,
                accumulator.weakDecisionCount,
                accumulator.rejectDecisionCount,
                accumulator.gapRecoveryCount,
                accumulator.gapRecoveryZeroDeltaCount,
                accumulator.noLocationTimeoutCount,
                accumulator.maxNoLocationTimeoutSeconds,
                accumulator.gnssSnapshotCount,
                accumulator.staleGnssRawCount,
                accumulator.gnssQualityMetricSnapshotCount,
                accumulator.averageUsedAvgCn0(),
                accumulator.averageAllAvgCn0(),
                accumulator.averageTop4AvgCn0(),
                accumulator.averageLowCn0VisibleCount(),
                accumulator.averageWeakUsedCount(),
                accumulator.dualFrequencySnapshotCount,
                accumulator.weakDecisionGnssMetrics.count,
                accumulator.weakDecisionGnssMetrics.averageUsedAvgCn0(),
                accumulator.weakDecisionGnssMetrics.averageAllAvgCn0(),
                accumulator.weakDecisionGnssMetrics.averageTop4AvgCn0(),
                accumulator.weakDecisionGnssMetrics.averageLowCn0VisibleCount(),
                accumulator.weakDecisionGnssMetrics.averageWeakUsedCount(),
                accumulator.rejectDecisionGnssMetrics.count,
                accumulator.rejectDecisionGnssMetrics.averageUsedAvgCn0(),
                accumulator.rejectDecisionGnssMetrics.averageAllAvgCn0(),
                accumulator.rejectDecisionGnssMetrics.averageTop4AvgCn0(),
                accumulator.rejectDecisionGnssMetrics.averageLowCn0VisibleCount(),
                accumulator.rejectDecisionGnssMetrics.averageWeakUsedCount(),
                accumulator.deviceMotionWindowCount,
                accumulator.samplingRequestCounts,
                accumulator.samplingDurationSeconds,
                accumulator.decisionReasonCounts,
                accumulator.gapSummaries,
                blocking,
                review,
                excluded);
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
                JSONObject event = new JSONObject(trimmed);
                accumulator.onEvent(event);
            }
        }
        accumulator.closeSamplingDuration();
        try {
            accumulator.applyTrackProduct(new EvidenceTrackProductBuilder().build(diagnosticFile));
        } catch (IOException | JSONException ignored) {
            // The caller reports evidence parse failures through the main read path.
        }
        return accumulator;
    }

    private void increment(Map<String, Integer> counts, String key) {
        Integer count = counts.get(key);
        counts.put(key, count == null ? 1 : count + 1);
    }

    private void addDuration(Map<String, Double> durations, String key, double deltaSeconds) {
        if (deltaSeconds <= 0.0) {
            return;
        }
        Double current = durations.get(key);
        durations.put(key, current == null ? deltaSeconds : current + deltaSeconds);
    }

    private void addCountMismatch(List<String> blocking, String label, int manifestCount,
                                  int diagnosticCount, String diagnosticLabel) {
        if (manifestCount == diagnosticCount) {
            return;
        }
        blocking.add("session.json " + label + "=" + manifestCount
                + " 与 diagnostic " + diagnosticLabel + "=" + diagnosticCount
                + " 不一致，不能保证诊断日志解释每个轨迹点");
    }

    private double secondsBetween(long startNanos, long endNanos) {
        if (startNanos <= 0L || endNanos <= startNanos) {
            return 0.0;
        }
        return (endNanos - startNanos) / 1_000_000_000.0;
    }

    private String oneDecimal(double value) {
        return String.format(java.util.Locale.US, "%.1f", value);
    }

    private class Accumulator {
        long firstEventNanos = -1L;
        long lastEventNanos = -1L;
        long firstRawNanos = -1L;
        long lastRawNanos = -1L;
        long previousRawNanos = -1L;
        String activeSamplingState = "";
        long activeSamplingStartNanos = -1L;
        int rawLocationCount;
        int rawIntervalCount;
        int decisionCount;
        int trustedDecisionCount;
        int weakDecisionCount;
        int rejectDecisionCount;
        int intakeRejectedCount;
        int sessionIntegrityErrorCount;
        final Set<Long> trustedTrackPointIds = new HashSet<>();
        final Set<Long> explainedRawPointIds = new HashSet<>();
        int gapRecoveryCount;
        int gapRecoveryZeroDeltaCount;
        int noLocationTimeoutCount;
        int nonZeroDistanceSamplingCount;
        int longRawIntervalCount;
        int gnssSnapshotCount;
        int staleGnssRawCount;
        int gnssQualityMetricSnapshotCount;
        int dualFrequencySnapshotCount;
        int deviceMotionWindowCount;
        double usedAvgCn0Total;
        double allAvgCn0Total;
        double top4AvgCn0Total;
        double lowCn0VisibleCountTotal;
        double weakUsedCountTotal;
        double totalRawIntervalSeconds;
        double maxRawIntervalSeconds;
        double maxNoLocationTimeoutSeconds;
        final Map<Long, GnssMetricSnapshot> gnssMetricsBySnapshotId = new LinkedHashMap<>();
        final GnssMetricTotals weakDecisionGnssMetrics = new GnssMetricTotals();
        final GnssMetricTotals rejectDecisionGnssMetrics = new GnssMetricTotals();
        final Map<String, Integer> samplingRequestCounts = new LinkedHashMap<>();
        final Map<String, Double> samplingDurationSeconds = new LinkedHashMap<>();
        final Map<String, Integer> decisionReasonCounts = new LinkedHashMap<>();
        final List<String> gapSummaries = new ArrayList<>();

        void onEvent(JSONObject event) {
            long eventTime = event.optLong("eventElapsedRealtimeNanos", -1L);
            if (eventTime > 0L) {
                if (firstEventNanos <= 0L) {
                    firstEventNanos = eventTime;
                }
                if (eventTime > lastEventNanos) {
                    lastEventNanos = eventTime;
                }
            }

            String eventName = event.optString("event", "");
            if ("raw_location".equals(eventName)) {
                onRawLocation(event);
            } else if ("session_integrity_error".equals(eventName)) {
                onSessionIntegrityError(event);
            } else if ("sampling_policy".equals(eventName)) {
                onSamplingPolicy(event, eventTime);
            } else if ("session_event".equals(eventName)) {
                onSessionEvent(event);
            } else if ("gnss_snapshot".equals(eventName)) {
                onGnssSnapshot(event);
            } else if ("device_motion_window".equals(eventName)) {
                onDeviceMotionWindow(event);
            }
        }

        void onDeviceMotionWindow(JSONObject event) {
            deviceMotionWindowCount++;
        }

        void onGnssSnapshot(JSONObject event) {
            gnssSnapshotCount++;
            if (!event.has(GnssSnapshotDiagnosticFields.ALL_AVG_CN0)
                    || !event.has(GnssSnapshotDiagnosticFields.TOP4_AVG_CN0)) {
                return;
            }
            GnssMetricSnapshot snapshot = GnssMetricSnapshot.fromEvent(event);
            gnssMetricsBySnapshotId.put(event.optLong(GnssSnapshotDiagnosticFields.SNAPSHOT_ID),
                    snapshot);
            gnssQualityMetricSnapshotCount++;
            usedAvgCn0Total += snapshot.usedAvgCn0;
            allAvgCn0Total += snapshot.allAvgCn0;
            top4AvgCn0Total += snapshot.top4AvgCn0;
            lowCn0VisibleCountTotal += snapshot.lowCn0VisibleCount;
            weakUsedCountTotal += snapshot.weakUsedCount;
            if (event.optBoolean(GnssSnapshotDiagnosticFields.HAS_DUAL_FREQUENCY, false)) {
                dualFrequencySnapshotCount++;
            }
        }

        void onRawLocation(JSONObject event) {
            rawLocationCount++;
            long rawTime = event.optLong("elapsedRealtimeNanos", -1L);
            if (rawTime > 0L) {
                if (previousRawNanos > 0L && rawTime > previousRawNanos) {
                    double intervalSeconds = secondsBetween(previousRawNanos, rawTime);
                    rawIntervalCount++;
                    totalRawIntervalSeconds += intervalSeconds;
                    if (intervalSeconds > maxRawIntervalSeconds) {
                        maxRawIntervalSeconds = intervalSeconds;
                    }
                    if (intervalSeconds > MAX_RAW_INTERVAL_REVIEW_SECONDS) {
                        longRawIntervalCount++;
                    }
                }
                if (rawTime > previousRawNanos) {
                    previousRawNanos = rawTime;
                }
                if (firstRawNanos <= 0L) {
                    firstRawNanos = rawTime;
                }
                if (rawTime > lastRawNanos) {
                    lastRawNanos = rawTime;
                }
            }
            if (event.optBoolean("gnssQualityStale", false)) {
                staleGnssRawCount++;
            }
        }

        void onSessionIntegrityError(JSONObject event) {
            sessionIntegrityErrorCount++;
            rememberExplainedRawPoint(event);
        }

        void rememberExplainedRawPoint(JSONObject event) {
            long rawPointId = event.optLong("rawPointId", -1L);
            if (rawPointId > 0L) {
                explainedRawPointIds.add(rawPointId);
            }
        }

        void addDecisionGnssMetrics(JSONObject event, GnssMetricTotals totals) {
            if (!event.has("sourceGnssSnapshotId")) {
                return;
            }
            addDecisionGnssMetrics(event.optLong("sourceGnssSnapshotId"), totals);
        }

        void addDecisionGnssMetrics(Long sourceGnssSnapshotId, GnssMetricTotals totals) {
            if (sourceGnssSnapshotId == null) {
                return;
            }
            GnssMetricSnapshot snapshot = gnssMetricsBySnapshotId.get(
                    sourceGnssSnapshotId);
            if (snapshot != null) {
                totals.add(snapshot);
            }
        }

        void onSamplingPolicy(JSONObject event, long eventTime) {
            String state = event.optString("state", "UNKNOWN");
            increment(samplingRequestCounts, state);
            if (event.optDouble("locationRequestMinDistanceMeters", 0.0) != 0.0) {
                nonZeroDistanceSamplingCount++;
            }
            if (eventTime > 0L) {
                closeSamplingDuration(eventTime);
                activeSamplingState = state;
                activeSamplingStartNanos = eventTime;
            }
        }

        void onSessionEvent(JSONObject event) {
            if ("no_location_timeout".equals(event.optString("eventType", ""))) {
                noLocationTimeoutCount++;
                double seconds = event.optLong("elapsedSinceLastLocationMillis", 0L) / 1000.0;
                if (seconds > maxNoLocationTimeoutSeconds) {
                    maxNoLocationTimeoutSeconds = seconds;
                }
            }
        }

        void closeSamplingDuration() {
            closeSamplingDuration(lastEventNanos);
        }

        void closeSamplingDuration(long endNanos) {
            if (activeSamplingState.isEmpty() || activeSamplingStartNanos <= 0L
                    || endNanos <= activeSamplingStartNanos) {
                return;
            }
            addDuration(samplingDurationSeconds, activeSamplingState,
                    secondsBetween(activeSamplingStartNanos, endNanos));
            activeSamplingStartNanos = endNanos;
        }

        void applyTrackProduct(EvidenceTrackProductBuilder.Result product) {
            decisionCount = product.stats.decisionCount;
            trustedDecisionCount = product.stats.trustedDecisionCount;
            weakDecisionCount = product.stats.weakDecisionCount;
            rejectDecisionCount = product.stats.rejectDecisionCount;
            intakeRejectedCount = product.stats.intakeRejectedCount;
            gapRecoveryCount = product.stats.gapRecoveryCount;
            gapRecoveryZeroDeltaCount = product.stats.gapRecoveryZeroDeltaCount;
            explainedRawPointIds.clear();
            decisionReasonCounts.clear();
            decisionReasonCounts.putAll(product.stats.decisionReasonCounts);
            weakDecisionGnssMetrics.clear();
            rejectDecisionGnssMetrics.clear();
            for (EvidenceTrackProductBuilder.DecisionRecord decision : product.decisions) {
                if (decision.rawPointId > 0L) {
                    explainedRawPointIds.add(decision.rawPointId);
                }
                if ("weak".equals(decision.result)) {
                    addDecisionGnssMetrics(decision.sourceGnssSnapshotId, weakDecisionGnssMetrics);
                } else if ("reject".equals(decision.result)
                        || "intake_rejected".equals(decision.result)) {
                    addDecisionGnssMetrics(decision.sourceGnssSnapshotId, rejectDecisionGnssMetrics);
                }
            }
        }

        double diagnosticDurationSeconds() {
            return secondsBetween(firstEventNanos, lastEventNanos);
        }

        double rawDurationSeconds() {
            return secondsBetween(firstRawNanos, lastRawNanos);
        }

        double averageRawIntervalSeconds() {
            return rawIntervalCount == 0 ? 0.0 : totalRawIntervalSeconds / rawIntervalCount;
        }

        int reasonCount(String key) {
            Integer count = decisionReasonCounts.get(key);
            return count == null ? 0 : count;
        }

        double averageUsedAvgCn0() {
            return averageGnssMetric(usedAvgCn0Total);
        }

        double averageAllAvgCn0() {
            return averageGnssMetric(allAvgCn0Total);
        }

        double averageTop4AvgCn0() {
            return averageGnssMetric(top4AvgCn0Total);
        }

        double averageLowCn0VisibleCount() {
            return averageGnssMetric(lowCn0VisibleCountTotal);
        }

        double averageWeakUsedCount() {
            return averageGnssMetric(weakUsedCountTotal);
        }

        double averageGnssMetric(double total) {
            return gnssQualityMetricSnapshotCount == 0
                    ? 0.0 : total / gnssQualityMetricSnapshotCount;
        }
    }

    private static class GnssMetricSnapshot {
        final double usedAvgCn0;
        final double allAvgCn0;
        final double top4AvgCn0;
        final double lowCn0VisibleCount;
        final double weakUsedCount;

        GnssMetricSnapshot(double usedAvgCn0, double allAvgCn0, double top4AvgCn0,
                           double lowCn0VisibleCount, double weakUsedCount) {
            this.usedAvgCn0 = usedAvgCn0;
            this.allAvgCn0 = allAvgCn0;
            this.top4AvgCn0 = top4AvgCn0;
            this.lowCn0VisibleCount = lowCn0VisibleCount;
            this.weakUsedCount = weakUsedCount;
        }

        static GnssMetricSnapshot fromEvent(JSONObject event) {
            return new GnssMetricSnapshot(
                    event.optDouble(GnssSnapshotDiagnosticFields.USED_AVG_CN0, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.ALL_AVG_CN0, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.TOP4_AVG_CN0, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.LOW_CN0_VISIBLE_COUNT, 0.0),
                    event.optDouble(GnssSnapshotDiagnosticFields.WEAK_USED_COUNT, 0.0));
        }
    }

    private static class GnssMetricTotals {
        int count;
        double usedAvgCn0Total;
        double allAvgCn0Total;
        double top4AvgCn0Total;
        double lowCn0VisibleCountTotal;
        double weakUsedCountTotal;

        void clear() {
            count = 0;
            usedAvgCn0Total = 0.0;
            allAvgCn0Total = 0.0;
            top4AvgCn0Total = 0.0;
            lowCn0VisibleCountTotal = 0.0;
            weakUsedCountTotal = 0.0;
        }

        void add(GnssMetricSnapshot snapshot) {
            count++;
            usedAvgCn0Total += snapshot.usedAvgCn0;
            allAvgCn0Total += snapshot.allAvgCn0;
            top4AvgCn0Total += snapshot.top4AvgCn0;
            lowCn0VisibleCountTotal += snapshot.lowCn0VisibleCount;
            weakUsedCountTotal += snapshot.weakUsedCount;
        }

        double averageUsedAvgCn0() {
            return average(usedAvgCn0Total);
        }

        double averageAllAvgCn0() {
            return average(allAvgCn0Total);
        }

        double averageTop4AvgCn0() {
            return average(top4AvgCn0Total);
        }

        double averageLowCn0VisibleCount() {
            return average(lowCn0VisibleCountTotal);
        }

        double averageWeakUsedCount() {
            return average(weakUsedCountTotal);
        }

        double average(double total) {
            return count == 0 ? 0.0 : total / count;
        }
    }
}
