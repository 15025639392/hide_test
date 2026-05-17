package com.example.gnsssatdemo.track.replay;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ReplayReport {
    public static final String EXACT = "EXACT";
    public static final String BEST_EFFORT = "BEST_EFFORT";
    public static final String INVALID_LOG = "INVALID_LOG";

    public final String status;
    public final String invalidReason;
    public final List<ReplayDecision> decisions;

    private ReplayReport(String status, String invalidReason, List<ReplayDecision> decisions) {
        this.status = status;
        this.invalidReason = invalidReason;
        this.decisions = decisions;
    }

    public static ReplayReport invalid(String reason) {
        return new ReplayReport(INVALID_LOG, reason, new ArrayList<>());
    }

    public static ReplayReport valid(List<ReplayDecision> decisions) {
        boolean hasExpectation = false;
        boolean allMatched = true;
        for (ReplayDecision decision : decisions) {
            hasExpectation = hasExpectation || decision.hasExpectation();
            allMatched = allMatched && decision.matchesExpectation();
        }
        String status = hasExpectation && allMatched ? EXACT : BEST_EFFORT;
        return new ReplayReport(status, "", new ArrayList<>(decisions));
    }

    public int mismatchCount() {
        int count = 0;
        for (ReplayDecision decision : decisions) {
            if (!decision.matchesExpectation()) {
                count++;
            }
        }
        return count;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("status", status);
        json.put("invalidReason", invalidReason);
        json.put("decisionCount", decisions.size());
        json.put("mismatchCount", mismatchCount());

        JSONArray decisionArray = new JSONArray();
        for (ReplayDecision decision : decisions) {
            JSONObject decisionJson = new JSONObject();
            decisionJson.put("lineNumber", decision.lineNumber);
            decisionJson.put("rawPointId", decision.rawPointId);
            decisionJson.put("actualResult", decision.actualResult);
            decisionJson.put("actualReason", decision.actualReason);
            decisionJson.put("expectedResult",
                    decision.expectedResult == null ? JSONObject.NULL : decision.expectedResult);
            decisionJson.put("expectedReason",
                    decision.expectedReason == null ? JSONObject.NULL : decision.expectedReason);
            decisionJson.put("matchesExpectation", decision.matchesExpectation());
            decisionArray.put(decisionJson);
        }
        json.put("decisions", decisionArray);
        return json;
    }
}
