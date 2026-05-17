package com.example.gnsssatdemo.track.replay;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ReplayBatchResult {
    public final List<ReplayBatchItem> items;
    public final int exactCount;
    public final int bestEffortCount;
    public final int invalidLogCount;

    public ReplayBatchResult(List<ReplayBatchItem> items) {
        this.items = new ArrayList<>(items);
        int exact = 0;
        int bestEffort = 0;
        int invalidLog = 0;
        for (ReplayBatchItem item : items) {
            if (ReplayReport.EXACT.equals(item.report.status)) {
                exact++;
            } else if (ReplayReport.BEST_EFFORT.equals(item.report.status)) {
                bestEffort++;
            } else if (ReplayReport.INVALID_LOG.equals(item.report.status)) {
                invalidLog++;
            }
        }
        this.exactCount = exact;
        this.bestEffortCount = bestEffort;
        this.invalidLogCount = invalidLog;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("totalCount", items.size());
        json.put("exactCount", exactCount);
        json.put("bestEffortCount", bestEffortCount);
        json.put("invalidLogCount", invalidLogCount);

        JSONArray itemArray = new JSONArray();
        for (ReplayBatchItem item : items) {
            JSONObject itemJson = new JSONObject();
            itemJson.put("inputFileName", item.inputFile.getName());
            itemJson.put("inputFilePath", item.inputFile.getAbsolutePath());
            itemJson.put("reportFilePath", item.reportFile.getAbsolutePath());
            itemJson.put("status", item.report.status);
            itemJson.put("invalidReason", item.report.invalidReason);
            itemJson.put("decisionCount", item.report.decisions.size());
            itemJson.put("mismatchCount", item.report.mismatchCount());
            itemArray.put(itemJson);
        }
        json.put("items", itemArray);
        return json;
    }
}
