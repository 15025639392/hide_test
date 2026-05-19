package com.example.gnsssatdemo.track.export;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class HikingSampleReport {
    public static final String VERDICT_PASS = "PASS";
    public static final String VERDICT_REVIEW = "REVIEW";
    public static final String VERDICT_FAIL = "FAIL";

    public final String sessionId;
    public final String verdict;
    public final double diagnosticDurationSeconds;
    public final double rawDurationSeconds;
    public final double maxRawIntervalSeconds;
    public final double averageRawIntervalSeconds;
    public final int longRawIntervalCount;
    public final double totalDistanceMeters;
    public final double selectedTotalAscentMeters;
    public final String selectedAscentSource;
    public final double barometerTotalAscentMeters;
    public final double gnssTotalAscentMeters;
    public final int barometerAscentSampleCount;
    public final int gnssAscentSampleCount;
    public final int barometerAscentRejectedSampleCount;
    public final int gnssAscentRejectedSampleCount;
    public final double movingTimeSeconds;
    public final int manifestRawPointCount;
    public final int manifestTrackPointCount;
    public final int manifestWeakTrackPointCount;
    public final int manifestGapCount;
    public final int rawLocationCount;
    public final int decisionCount;
    public final int trustedDecisionCount;
    public final int weakDecisionCount;
    public final int rejectDecisionCount;
    public final int gapRecoveryCount;
    public final int gapRecoveryZeroDeltaCount;
    public final int noLocationTimeoutCount;
    public final double maxNoLocationTimeoutSeconds;
    public final int gnssSnapshotCount;
    public final int staleGnssRawCount;
    public final int gnssQualityMetricSnapshotCount;
    public final double averageUsedAvgCn0;
    public final double averageAllAvgCn0;
    public final double averageTop4AvgCn0;
    public final double averageLowCn0VisibleCount;
    public final double averageWeakUsedCount;
    public final int dualFrequencySnapshotCount;
    public final int weakGnssExplainableDecisionCount;
    public final double averageWeakDecisionUsedAvgCn0;
    public final double averageWeakDecisionAllAvgCn0;
    public final double averageWeakDecisionTop4AvgCn0;
    public final double averageWeakDecisionLowCn0VisibleCount;
    public final double averageWeakDecisionWeakUsedCount;
    public final int rejectGnssExplainableDecisionCount;
    public final double averageRejectDecisionUsedAvgCn0;
    public final double averageRejectDecisionAllAvgCn0;
    public final double averageRejectDecisionTop4AvgCn0;
    public final double averageRejectDecisionLowCn0VisibleCount;
    public final double averageRejectDecisionWeakUsedCount;
    public final int motionSummaryCount;
    public final int stationaryDecisionCount;
    public final int stationarySupportedByAccelCount;
    public final int stationaryMissingMotionSummaryCount;
    public final Map<String, Integer> samplingRequestCounts;
    public final Map<String, Double> samplingDurationSeconds;
    public final Map<String, Integer> decisionReasonCounts;
    public final List<String> gapSummaries;
    public final List<String> blockingFindings;
    public final List<String> reviewFindings;
    public final List<String> excludedMetrics;

    public HikingSampleReport(String sessionId, String verdict,
                              double diagnosticDurationSeconds, double rawDurationSeconds,
                              double maxRawIntervalSeconds, double averageRawIntervalSeconds,
                              int longRawIntervalCount,
                              double totalDistanceMeters,
                              double selectedTotalAscentMeters, String selectedAscentSource,
                              double barometerTotalAscentMeters, double gnssTotalAscentMeters,
                              int barometerAscentSampleCount, int gnssAscentSampleCount,
                              int barometerAscentRejectedSampleCount,
                              int gnssAscentRejectedSampleCount,
                              double movingTimeSeconds,
                              int manifestRawPointCount, int manifestTrackPointCount,
                              int manifestWeakTrackPointCount, int manifestGapCount,
                              int rawLocationCount, int decisionCount, int trustedDecisionCount,
                              int weakDecisionCount, int rejectDecisionCount,
                              int gapRecoveryCount, int gapRecoveryZeroDeltaCount,
                              int noLocationTimeoutCount, double maxNoLocationTimeoutSeconds,
                              int gnssSnapshotCount, int staleGnssRawCount,
                              int gnssQualityMetricSnapshotCount,
                              double averageUsedAvgCn0, double averageAllAvgCn0,
                              double averageTop4AvgCn0, double averageLowCn0VisibleCount,
                              double averageWeakUsedCount, int dualFrequencySnapshotCount,
                              int weakGnssExplainableDecisionCount,
                              double averageWeakDecisionUsedAvgCn0,
                              double averageWeakDecisionAllAvgCn0,
                              double averageWeakDecisionTop4AvgCn0,
                              double averageWeakDecisionLowCn0VisibleCount,
                              double averageWeakDecisionWeakUsedCount,
                              int rejectGnssExplainableDecisionCount,
                              double averageRejectDecisionUsedAvgCn0,
                              double averageRejectDecisionAllAvgCn0,
                              double averageRejectDecisionTop4AvgCn0,
                              double averageRejectDecisionLowCn0VisibleCount,
                              double averageRejectDecisionWeakUsedCount,
                              int motionSummaryCount, int stationaryDecisionCount,
                              int stationarySupportedByAccelCount,
                              int stationaryMissingMotionSummaryCount,
                              Map<String, Integer> samplingRequestCounts,
                              Map<String, Double> samplingDurationSeconds,
                              Map<String, Integer> decisionReasonCounts,
                              List<String> gapSummaries,
                              List<String> blockingFindings,
                              List<String> reviewFindings,
                              List<String> excludedMetrics) {
        this.sessionId = sessionId;
        this.verdict = verdict;
        this.diagnosticDurationSeconds = diagnosticDurationSeconds;
        this.rawDurationSeconds = rawDurationSeconds;
        this.maxRawIntervalSeconds = maxRawIntervalSeconds;
        this.averageRawIntervalSeconds = averageRawIntervalSeconds;
        this.longRawIntervalCount = longRawIntervalCount;
        this.totalDistanceMeters = totalDistanceMeters;
        this.selectedTotalAscentMeters = selectedTotalAscentMeters;
        this.selectedAscentSource = selectedAscentSource;
        this.barometerTotalAscentMeters = barometerTotalAscentMeters;
        this.gnssTotalAscentMeters = gnssTotalAscentMeters;
        this.barometerAscentSampleCount = barometerAscentSampleCount;
        this.gnssAscentSampleCount = gnssAscentSampleCount;
        this.barometerAscentRejectedSampleCount = barometerAscentRejectedSampleCount;
        this.gnssAscentRejectedSampleCount = gnssAscentRejectedSampleCount;
        this.movingTimeSeconds = movingTimeSeconds;
        this.manifestRawPointCount = manifestRawPointCount;
        this.manifestTrackPointCount = manifestTrackPointCount;
        this.manifestWeakTrackPointCount = manifestWeakTrackPointCount;
        this.manifestGapCount = manifestGapCount;
        this.rawLocationCount = rawLocationCount;
        this.decisionCount = decisionCount;
        this.trustedDecisionCount = trustedDecisionCount;
        this.weakDecisionCount = weakDecisionCount;
        this.rejectDecisionCount = rejectDecisionCount;
        this.gapRecoveryCount = gapRecoveryCount;
        this.gapRecoveryZeroDeltaCount = gapRecoveryZeroDeltaCount;
        this.noLocationTimeoutCount = noLocationTimeoutCount;
        this.maxNoLocationTimeoutSeconds = maxNoLocationTimeoutSeconds;
        this.gnssSnapshotCount = gnssSnapshotCount;
        this.staleGnssRawCount = staleGnssRawCount;
        this.gnssQualityMetricSnapshotCount = gnssQualityMetricSnapshotCount;
        this.averageUsedAvgCn0 = averageUsedAvgCn0;
        this.averageAllAvgCn0 = averageAllAvgCn0;
        this.averageTop4AvgCn0 = averageTop4AvgCn0;
        this.averageLowCn0VisibleCount = averageLowCn0VisibleCount;
        this.averageWeakUsedCount = averageWeakUsedCount;
        this.dualFrequencySnapshotCount = dualFrequencySnapshotCount;
        this.weakGnssExplainableDecisionCount = weakGnssExplainableDecisionCount;
        this.averageWeakDecisionUsedAvgCn0 = averageWeakDecisionUsedAvgCn0;
        this.averageWeakDecisionAllAvgCn0 = averageWeakDecisionAllAvgCn0;
        this.averageWeakDecisionTop4AvgCn0 = averageWeakDecisionTop4AvgCn0;
        this.averageWeakDecisionLowCn0VisibleCount = averageWeakDecisionLowCn0VisibleCount;
        this.averageWeakDecisionWeakUsedCount = averageWeakDecisionWeakUsedCount;
        this.rejectGnssExplainableDecisionCount = rejectGnssExplainableDecisionCount;
        this.averageRejectDecisionUsedAvgCn0 = averageRejectDecisionUsedAvgCn0;
        this.averageRejectDecisionAllAvgCn0 = averageRejectDecisionAllAvgCn0;
        this.averageRejectDecisionTop4AvgCn0 = averageRejectDecisionTop4AvgCn0;
        this.averageRejectDecisionLowCn0VisibleCount = averageRejectDecisionLowCn0VisibleCount;
        this.averageRejectDecisionWeakUsedCount = averageRejectDecisionWeakUsedCount;
        this.motionSummaryCount = motionSummaryCount;
        this.stationaryDecisionCount = stationaryDecisionCount;
        this.stationarySupportedByAccelCount = stationarySupportedByAccelCount;
        this.stationaryMissingMotionSummaryCount = stationaryMissingMotionSummaryCount;
        this.samplingRequestCounts = Collections.unmodifiableMap(samplingRequestCounts);
        this.samplingDurationSeconds = Collections.unmodifiableMap(samplingDurationSeconds);
        this.decisionReasonCounts = Collections.unmodifiableMap(decisionReasonCounts);
        this.gapSummaries = Collections.unmodifiableList(new ArrayList<>(gapSummaries));
        this.blockingFindings = Collections.unmodifiableList(new ArrayList<>(blockingFindings));
        this.reviewFindings = Collections.unmodifiableList(new ArrayList<>(reviewFindings));
        this.excludedMetrics = Collections.unmodifiableList(new ArrayList<>(excludedMetrics));
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("sessionId", sessionId);
        json.put("verdict", verdict);
        json.put("diagnosticDurationSeconds", diagnosticDurationSeconds);
        json.put("rawDurationSeconds", rawDurationSeconds);
        json.put("maxRawIntervalSeconds", maxRawIntervalSeconds);
        json.put("averageRawIntervalSeconds", averageRawIntervalSeconds);
        json.put("longRawIntervalCount", longRawIntervalCount);
        json.put("totalDistanceMeters", totalDistanceMeters);
        json.put("selectedTotalAscentMeters", selectedTotalAscentMeters);
        json.put("selectedAscentSource", selectedAscentSource);
        json.put("barometerTotalAscentMeters", barometerTotalAscentMeters);
        json.put("barometerAscentSampleCount", barometerAscentSampleCount);
        json.put("barometerAscentRejectedSampleCount", barometerAscentRejectedSampleCount);
        json.put("gnssTotalAscentMeters", gnssTotalAscentMeters);
        json.put("gnssAscentSampleCount", gnssAscentSampleCount);
        json.put("gnssAscentRejectedSampleCount", gnssAscentRejectedSampleCount);
        json.put("movingTimeSeconds", movingTimeSeconds);
        json.put("manifestRawPointCount", manifestRawPointCount);
        json.put("manifestTrackPointCount", manifestTrackPointCount);
        json.put("manifestWeakTrackPointCount", manifestWeakTrackPointCount);
        json.put("manifestGapCount", manifestGapCount);
        json.put("rawLocationCount", rawLocationCount);
        json.put("decisionCount", decisionCount);
        json.put("trustedDecisionCount", trustedDecisionCount);
        json.put("weakDecisionCount", weakDecisionCount);
        json.put("rejectDecisionCount", rejectDecisionCount);
        json.put("gapRecoveryCount", gapRecoveryCount);
        json.put("gapRecoveryZeroDeltaCount", gapRecoveryZeroDeltaCount);
        json.put("noLocationTimeoutCount", noLocationTimeoutCount);
        json.put("maxNoLocationTimeoutSeconds", maxNoLocationTimeoutSeconds);
        json.put("gnssSnapshotCount", gnssSnapshotCount);
        json.put("staleGnssRawCount", staleGnssRawCount);
        json.put("gnssQualityMetricSnapshotCount", gnssQualityMetricSnapshotCount);
        json.put("averageUsedAvgCn0", averageUsedAvgCn0);
        json.put("averageAllAvgCn0", averageAllAvgCn0);
        json.put("averageTop4AvgCn0", averageTop4AvgCn0);
        json.put("averageLowCn0VisibleCount", averageLowCn0VisibleCount);
        json.put("averageWeakUsedCount", averageWeakUsedCount);
        json.put("dualFrequencySnapshotCount", dualFrequencySnapshotCount);
        json.put("weakGnssExplainableDecisionCount", weakGnssExplainableDecisionCount);
        json.put("averageWeakDecisionUsedAvgCn0", averageWeakDecisionUsedAvgCn0);
        json.put("averageWeakDecisionAllAvgCn0", averageWeakDecisionAllAvgCn0);
        json.put("averageWeakDecisionTop4AvgCn0", averageWeakDecisionTop4AvgCn0);
        json.put("averageWeakDecisionLowCn0VisibleCount", averageWeakDecisionLowCn0VisibleCount);
        json.put("averageWeakDecisionWeakUsedCount", averageWeakDecisionWeakUsedCount);
        json.put("rejectGnssExplainableDecisionCount", rejectGnssExplainableDecisionCount);
        json.put("averageRejectDecisionUsedAvgCn0", averageRejectDecisionUsedAvgCn0);
        json.put("averageRejectDecisionAllAvgCn0", averageRejectDecisionAllAvgCn0);
        json.put("averageRejectDecisionTop4AvgCn0", averageRejectDecisionTop4AvgCn0);
        json.put("averageRejectDecisionLowCn0VisibleCount", averageRejectDecisionLowCn0VisibleCount);
        json.put("averageRejectDecisionWeakUsedCount", averageRejectDecisionWeakUsedCount);
        json.put("motionSummaryCount", motionSummaryCount);
        json.put("stationaryDecisionCount", stationaryDecisionCount);
        json.put("stationarySupportedByAccelCount", stationarySupportedByAccelCount);
        json.put("stationaryMissingMotionSummaryCount", stationaryMissingMotionSummaryCount);
        json.put("stationarySupportedByAccelRatio", stationarySupportedByAccelRatio());
        json.put("samplingRequestCounts", integerMapToJson(samplingRequestCounts));
        json.put("samplingDurationSeconds", doubleMapToJson(samplingDurationSeconds));
        json.put("decisionReasonCounts", integerMapToJson(decisionReasonCounts));
        json.put("gapSummaries", stringListToJson(gapSummaries));
        json.put("blockingFindings", stringListToJson(blockingFindings));
        json.put("reviewFindings", stringListToJson(reviewFindings));
        json.put("excludedMetrics", stringListToJson(excludedMetrics));
        return json;
    }

    public String toText() {
        StringBuilder sb = new StringBuilder();
        sb.append("# 真实徒步样本报告\n\n");
        sb.append("sessionId=").append(sessionId).append('\n');
        sb.append("结论=").append(verdictText()).append('\n');
        sb.append("说明=本报告只统计真实样本验证所需的采样、距离、GAP、reject/weak 解释；")
                .append("电量/省电证据和多地图 GPX 兼容性自动回归不纳入当前统计。\n\n");

        sb.append("## 核心指标\n");
        sb.append("- 诊断时长=").append(secondsText(diagnosticDurationSeconds))
                .append(" RawPoint 时长=").append(secondsText(rawDurationSeconds)).append('\n');
        sb.append("- RawPoint 最大间隔=").append(secondsText(maxRawIntervalSeconds))
                .append(" 平均间隔=").append(secondsText(averageRawIntervalSeconds))
                .append(" 长间隔次数=").append(longRawIntervalCount).append('\n');
        sb.append("- 距离=").append(oneDecimal(totalDistanceMeters)).append("m")
                .append(" 爬升=").append(ascentText(selectedTotalAscentMeters))
                .append(" 来源=").append(selectedAscentSource)
                .append(" 运动时间=").append(secondsText(movingTimeSeconds)).append('\n');
        sb.append("- 爬升分解 BARO=").append(ascentText(barometerTotalAscentMeters))
                .append(" 样本=").append(barometerAscentSampleCount)
                .append(" 拒绝=").append(barometerAscentRejectedSampleCount)
                .append(" GNSS=").append(ascentText(gnssTotalAscentMeters))
                .append(" 样本=").append(gnssAscentSampleCount)
                .append(" 拒绝=").append(gnssAscentRejectedSampleCount).append('\n');
        sb.append("- Manifest RawPoint=").append(manifestRawPointCount)
                .append(" TrackPoint=").append(manifestTrackPointCount)
                .append(" WeakPoint=").append(manifestWeakTrackPointCount)
                .append(" GAP=").append(manifestGapCount).append('\n');
        sb.append("- 诊断 RawLocation=").append(rawLocationCount)
                .append(" Decision=").append(decisionCount)
                .append(" 可信决策=").append(trustedDecisionCount)
                .append(" weak=").append(weakDecisionCount)
                .append(" reject=").append(rejectDecisionCount).append('\n');
        sb.append("- GAP 恢复=").append(gapRecoveryCount)
                .append(" zero-delta=").append(gapRecoveryZeroDeltaCount)
                .append(" no-location-timeout=").append(noLocationTimeoutCount)
                .append(" 最大无回调=").append(secondsText(maxNoLocationTimeoutSeconds)).append('\n');
        sb.append("- GNSS Snapshot=").append(gnssSnapshotCount)
                .append(" staleRaw=").append(staleGnssRawCount).append("\n\n");
        if (gnssQualityMetricSnapshotCount > 0) {
            sb.append("## GNSS 质量解释\n");
            sb.append("- 可解释 Snapshot=").append(gnssQualityMetricSnapshotCount)
                    .append(" 双频 Snapshot=").append(dualFrequencySnapshotCount).append('\n');
            sb.append("- C/N0 usedAvg=").append(oneDecimal(averageUsedAvgCn0))
                    .append(" allAvg=").append(oneDecimal(averageAllAvgCn0))
                    .append(" top4Avg=").append(oneDecimal(averageTop4AvgCn0))
                    .append(" dB-Hz\n");
            sb.append("- 平均低 C/N0 可见星=").append(oneDecimal(averageLowCn0VisibleCount))
                    .append(" 平均弱 used 星=").append(oneDecimal(averageWeakUsedCount))
                    .append('\n');
            if (weakGnssExplainableDecisionCount > 0) {
                sb.append("- weak 决策关联 Snapshot=").append(weakGnssExplainableDecisionCount)
                        .append(" usedAvg=").append(oneDecimal(averageWeakDecisionUsedAvgCn0))
                        .append(" allAvg=").append(oneDecimal(averageWeakDecisionAllAvgCn0))
                        .append(" top4Avg=").append(oneDecimal(averageWeakDecisionTop4AvgCn0))
                        .append(" lowVisible=")
                        .append(oneDecimal(averageWeakDecisionLowCn0VisibleCount))
                        .append(" weakUsed=")
                        .append(oneDecimal(averageWeakDecisionWeakUsedCount)).append('\n');
            }
            if (rejectGnssExplainableDecisionCount > 0) {
                sb.append("- reject 决策关联 Snapshot=").append(rejectGnssExplainableDecisionCount)
                        .append(" usedAvg=").append(oneDecimal(averageRejectDecisionUsedAvgCn0))
                        .append(" allAvg=").append(oneDecimal(averageRejectDecisionAllAvgCn0))
                        .append(" top4Avg=").append(oneDecimal(averageRejectDecisionTop4AvgCn0))
                        .append(" lowVisible=")
                        .append(oneDecimal(averageRejectDecisionLowCn0VisibleCount))
                        .append(" weakUsed=")
                        .append(oneDecimal(averageRejectDecisionWeakUsedCount)).append('\n');
            }
            sb.append('\n');
        }
        if (stationaryDecisionCount > 0 || motionSummaryCount > 0) {
            sb.append("## 加速度计静止证据\n");
            sb.append("- Motion Summary=").append(motionSummaryCount)
                    .append(" stationary 决策=").append(stationaryDecisionCount)
                    .append(" supported=").append(stationarySupportedByAccelCount)
                    .append(" missing=").append(stationaryMissingMotionSummaryCount)
                    .append(" supportedRatio=")
                    .append(oneDecimal(stationarySupportedByAccelRatio() * 100.0))
                    .append("%\n");
            if (stationarySupportedByAccelCount > 0) {
                sb.append("- 解释=部分静止/休息锚点决策同时具备设备静止证据，")
                        .append("更像休息或静止时的定位漂移。\n");
            }
            sb.append('\n');
        }

        appendIntegerMap(sb, "## 采样策略请求", samplingRequestCounts);
        appendDoubleMap(sb, "## 采样策略估算时长", samplingDurationSeconds);
        appendIntegerMap(sb, "## 决策原因分布", decisionReasonCounts);
        appendList(sb, "## GAP 明细", gapSummaries);
        appendList(sb, "## 阻塞问题", blockingFindings);
        appendList(sb, "## 需要复核", reviewFindings);
        appendList(sb, "## 本轮排除项", excludedMetrics);
        return sb.toString();
    }

    private String verdictText() {
        if (VERDICT_PASS.equals(verdict)) {
            return "PASS（可作为阈值复核样本）";
        }
        if (VERDICT_REVIEW.equals(verdict)) {
            return "REVIEW（可看，但调整阈值前需要人工复核）";
        }
        return "FAIL（不建议作为阈值调整依据）";
    }

    private double stationarySupportedByAccelRatio() {
        return stationaryDecisionCount == 0 ? 0.0
                : stationarySupportedByAccelCount / (double) stationaryDecisionCount;
    }

    private void appendIntegerMap(StringBuilder sb, String title, Map<String, Integer> values) {
        sb.append(title).append('\n');
        if (values.isEmpty()) {
            sb.append("- 无\n\n");
            return;
        }
        for (Map.Entry<String, Integer> entry : values.entrySet()) {
            sb.append("- ").append(entry.getKey()).append("=").append(entry.getValue()).append('\n');
        }
        sb.append('\n');
    }

    private void appendDoubleMap(StringBuilder sb, String title, Map<String, Double> values) {
        sb.append(title).append('\n');
        if (values.isEmpty()) {
            sb.append("- 无\n\n");
            return;
        }
        for (Map.Entry<String, Double> entry : values.entrySet()) {
            sb.append("- ").append(entry.getKey()).append("=")
                    .append(secondsText(entry.getValue())).append('\n');
        }
        sb.append('\n');
    }

    private void appendList(StringBuilder sb, String title, List<String> values) {
        sb.append(title).append('\n');
        if (values.isEmpty()) {
            sb.append("- 无\n\n");
            return;
        }
        for (String value : values) {
            sb.append("- ").append(value).append('\n');
        }
        sb.append('\n');
    }

    private JSONObject integerMapToJson(Map<String, Integer> values) throws JSONException {
        JSONObject json = new JSONObject();
        for (Map.Entry<String, Integer> entry : values.entrySet()) {
            json.put(entry.getKey(), entry.getValue());
        }
        return json;
    }

    private JSONObject doubleMapToJson(Map<String, Double> values) throws JSONException {
        JSONObject json = new JSONObject();
        for (Map.Entry<String, Double> entry : values.entrySet()) {
            json.put(entry.getKey(), entry.getValue());
        }
        return json;
    }

    private JSONArray stringListToJson(List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) {
            array.put(value);
        }
        return array;
    }

    private String secondsText(double seconds) {
        if (seconds <= 0.0) {
            return "0.0s";
        }
        if (seconds >= 60.0) {
            return String.format(Locale.US, "%.1fmin", seconds / 60.0);
        }
        return oneDecimal(seconds) + "s";
    }

    private String ascentText(double meters) {
        if (meters < 0.0 || Double.isNaN(meters)) {
            return "-";
        }
        return oneDecimal(meters) + "m";
    }

    private String oneDecimal(double value) {
        return String.format(Locale.US, "%.1f", value);
    }
}
