package com.example.gnsssatdemo.track.export;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class WeakGnssReport {
    public final String sessionId;
    public final int rawLocationCount;
    public final int staleRawLocationCount;
    public final double staleRawLocationRatio;
    public final int gnssSnapshotCount;
    public final int explainableGnssSnapshotCount;
    public final int weakDecisionCount;
    public final int weakDecisionWithGnssCount;
    public final double averageWeakAccuracyMeters;
    public final double averageWeakUsedInFixTotal;
    public final double averageWeakUsedAvgCn0;
    public final double averageWeakTop4AvgCn0;
    public final int rejectDecisionCount;
    public final int rejectDecisionWithGnssCount;
    public final double averageRejectAccuracyMeters;
    public final double averageRejectUsedInFixTotal;
    public final double averageRejectUsedAvgCn0;
    public final double averageRejectTop4AvgCn0;
    public final int transportDecisionCount;
    public final int transportDecisionWithGnssCount;
    public final double averageTransportUsedAvgCn0;
    public final double averageTransportTop4AvgCn0;
    public final int gapRecoveryCount;
    public final int gapRecoveryWithBeforeWindowCount;
    public final int gapRecoveryWithAfterWindowCount;
    public final double averageGapBeforeTop4AvgCn0;
    public final double averageGapAfterTop4AvgCn0;
    public final int noLocationTimeoutCount;
    public final double maxNoLocationTimeoutSeconds;
    public final List<String> findings;

    public WeakGnssReport(String sessionId,
                          int rawLocationCount, int staleRawLocationCount,
                          double staleRawLocationRatio,
                          int gnssSnapshotCount, int explainableGnssSnapshotCount,
                          int weakDecisionCount, int weakDecisionWithGnssCount,
                          double averageWeakAccuracyMeters,
                          double averageWeakUsedInFixTotal,
                          double averageWeakUsedAvgCn0,
                          double averageWeakTop4AvgCn0,
                          int rejectDecisionCount, int rejectDecisionWithGnssCount,
                          double averageRejectAccuracyMeters,
                          double averageRejectUsedInFixTotal,
                          double averageRejectUsedAvgCn0,
                          double averageRejectTop4AvgCn0,
                          int transportDecisionCount, int transportDecisionWithGnssCount,
                          double averageTransportUsedAvgCn0,
                          double averageTransportTop4AvgCn0,
                          int gapRecoveryCount,
                          int gapRecoveryWithBeforeWindowCount,
                          int gapRecoveryWithAfterWindowCount,
                          double averageGapBeforeTop4AvgCn0,
                          double averageGapAfterTop4AvgCn0,
                          int noLocationTimeoutCount,
                          double maxNoLocationTimeoutSeconds,
                          List<String> findings) {
        this.sessionId = sessionId;
        this.rawLocationCount = rawLocationCount;
        this.staleRawLocationCount = staleRawLocationCount;
        this.staleRawLocationRatio = staleRawLocationRatio;
        this.gnssSnapshotCount = gnssSnapshotCount;
        this.explainableGnssSnapshotCount = explainableGnssSnapshotCount;
        this.weakDecisionCount = weakDecisionCount;
        this.weakDecisionWithGnssCount = weakDecisionWithGnssCount;
        this.averageWeakAccuracyMeters = averageWeakAccuracyMeters;
        this.averageWeakUsedInFixTotal = averageWeakUsedInFixTotal;
        this.averageWeakUsedAvgCn0 = averageWeakUsedAvgCn0;
        this.averageWeakTop4AvgCn0 = averageWeakTop4AvgCn0;
        this.rejectDecisionCount = rejectDecisionCount;
        this.rejectDecisionWithGnssCount = rejectDecisionWithGnssCount;
        this.averageRejectAccuracyMeters = averageRejectAccuracyMeters;
        this.averageRejectUsedInFixTotal = averageRejectUsedInFixTotal;
        this.averageRejectUsedAvgCn0 = averageRejectUsedAvgCn0;
        this.averageRejectTop4AvgCn0 = averageRejectTop4AvgCn0;
        this.transportDecisionCount = transportDecisionCount;
        this.transportDecisionWithGnssCount = transportDecisionWithGnssCount;
        this.averageTransportUsedAvgCn0 = averageTransportUsedAvgCn0;
        this.averageTransportTop4AvgCn0 = averageTransportTop4AvgCn0;
        this.gapRecoveryCount = gapRecoveryCount;
        this.gapRecoveryWithBeforeWindowCount = gapRecoveryWithBeforeWindowCount;
        this.gapRecoveryWithAfterWindowCount = gapRecoveryWithAfterWindowCount;
        this.averageGapBeforeTop4AvgCn0 = averageGapBeforeTop4AvgCn0;
        this.averageGapAfterTop4AvgCn0 = averageGapAfterTop4AvgCn0;
        this.noLocationTimeoutCount = noLocationTimeoutCount;
        this.maxNoLocationTimeoutSeconds = maxNoLocationTimeoutSeconds;
        this.findings = Collections.unmodifiableList(new ArrayList<>(findings));
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("sessionId", sessionId);
        json.put("rawLocationCount", rawLocationCount);
        json.put("staleRawLocationCount", staleRawLocationCount);
        json.put("staleRawLocationRatio", staleRawLocationRatio);
        json.put("gnssSnapshotCount", gnssSnapshotCount);
        json.put("explainableGnssSnapshotCount", explainableGnssSnapshotCount);
        json.put("weakDecisionCount", weakDecisionCount);
        json.put("weakDecisionWithGnssCount", weakDecisionWithGnssCount);
        json.put("averageWeakAccuracyMeters", averageWeakAccuracyMeters);
        json.put("averageWeakUsedInFixTotal", averageWeakUsedInFixTotal);
        json.put("averageWeakUsedAvgCn0", averageWeakUsedAvgCn0);
        json.put("averageWeakTop4AvgCn0", averageWeakTop4AvgCn0);
        json.put("rejectDecisionCount", rejectDecisionCount);
        json.put("rejectDecisionWithGnssCount", rejectDecisionWithGnssCount);
        json.put("averageRejectAccuracyMeters", averageRejectAccuracyMeters);
        json.put("averageRejectUsedInFixTotal", averageRejectUsedInFixTotal);
        json.put("averageRejectUsedAvgCn0", averageRejectUsedAvgCn0);
        json.put("averageRejectTop4AvgCn0", averageRejectTop4AvgCn0);
        json.put("transportDecisionCount", transportDecisionCount);
        json.put("transportDecisionWithGnssCount", transportDecisionWithGnssCount);
        json.put("averageTransportUsedAvgCn0", averageTransportUsedAvgCn0);
        json.put("averageTransportTop4AvgCn0", averageTransportTop4AvgCn0);
        json.put("gapRecoveryCount", gapRecoveryCount);
        json.put("gapRecoveryWithBeforeWindowCount", gapRecoveryWithBeforeWindowCount);
        json.put("gapRecoveryWithAfterWindowCount", gapRecoveryWithAfterWindowCount);
        json.put("averageGapBeforeTop4AvgCn0", averageGapBeforeTop4AvgCn0);
        json.put("averageGapAfterTop4AvgCn0", averageGapAfterTop4AvgCn0);
        json.put("noLocationTimeoutCount", noLocationTimeoutCount);
        json.put("maxNoLocationTimeoutSeconds", maxNoLocationTimeoutSeconds);
        json.put("findings", stringListToJson(findings));
        return json;
    }

    public String toText() {
        StringBuilder sb = new StringBuilder();
        sb.append("# 弱 GPS 诊断报告\n\n");
        sb.append("sessionId=").append(sessionId).append('\n');
        sb.append("- RawLocation=").append(rawLocationCount)
                .append(" stale=").append(staleRawLocationCount)
                .append(" staleRatio=").append(oneDecimal(staleRawLocationRatio * 100.0))
                .append("%\n");
        sb.append("- GNSS Snapshot=").append(gnssSnapshotCount)
                .append(" 可解释 Snapshot=").append(explainableGnssSnapshotCount).append("\n\n");

        sb.append("## weak/reject 解释\n");
        appendDecisionLine(sb, "weak", weakDecisionCount, weakDecisionWithGnssCount,
                averageWeakAccuracyMeters, averageWeakUsedInFixTotal,
                averageWeakUsedAvgCn0, averageWeakTop4AvgCn0);
        appendDecisionLine(sb, "reject", rejectDecisionCount, rejectDecisionWithGnssCount,
                averageRejectAccuracyMeters, averageRejectUsedInFixTotal,
                averageRejectUsedAvgCn0, averageRejectTop4AvgCn0);
        sb.append("- transport=").append(transportDecisionCount)
                .append(" linkedGnss=").append(transportDecisionWithGnssCount)
                .append(" usedAvg=").append(oneDecimal(averageTransportUsedAvgCn0))
                .append(" top4Avg=").append(oneDecimal(averageTransportTop4AvgCn0))
                .append(" dB-Hz\n\n");

        sb.append("## GAP 与无回调\n");
        sb.append("- gapRecovery=").append(gapRecoveryCount)
                .append(" before30s=").append(gapRecoveryWithBeforeWindowCount)
                .append(" after30s=").append(gapRecoveryWithAfterWindowCount)
                .append(" beforeTop4=").append(oneDecimal(averageGapBeforeTop4AvgCn0))
                .append(" afterTop4=").append(oneDecimal(averageGapAfterTop4AvgCn0))
                .append(" dB-Hz\n");
        sb.append("- noLocationTimeout=").append(noLocationTimeoutCount)
                .append(" max=").append(secondsText(maxNoLocationTimeoutSeconds)).append("\n\n");

        appendFindings(sb);
        return sb.toString();
    }

    private void appendDecisionLine(StringBuilder sb, String label, int count, int linkedCount,
                                    double accuracy, double usedInFix,
                                    double usedAvgCn0, double top4AvgCn0) {
        sb.append("- ").append(label).append('=').append(count)
                .append(" linkedGnss=").append(linkedCount)
                .append(" accuracy=").append(oneDecimal(accuracy)).append("m")
                .append(" usedInFix=").append(oneDecimal(usedInFix))
                .append(" usedAvg=").append(oneDecimal(usedAvgCn0))
                .append(" top4Avg=").append(oneDecimal(top4AvgCn0))
                .append(" dB-Hz\n");
    }

    private void appendFindings(StringBuilder sb) {
        sb.append("## 解释结论\n");
        if (findings.isEmpty()) {
            sb.append("- 无明显弱 GPS 诊断结论\n");
            return;
        }
        for (String finding : findings) {
            sb.append("- ").append(finding).append('\n');
        }
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

    private String oneDecimal(double value) {
        return String.format(Locale.US, "%.1f", value);
    }
}
