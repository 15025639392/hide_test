package com.example.gnsssatdemo.track.replay;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.io.InputStream;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

public class ReplayRunnerTest {
    private final ReplayRunner runner = new ReplayRunner();

    @Test
    public void run_returnsExactForGoodWalkFixture() throws IOException {
        ReplayReport report = fixture("good_walk.jsonl");

        assertEquals(ReplayReport.EXACT, report.status);
        assertEquals(0, report.mismatchCount());
        assertEquals(2, report.decisions.size());
    }

    @Test
    public void run_reportsBestEffortWhenExpectationDiffers() {
        ReplayReport report = runner.run(baseHeader(false)
                + raw(1, 45, 29.0, 106.0, 2_000_000_000L,
                "anchor", "forced_weak_first_fix"));

        assertEquals(ReplayReport.BEST_EFFORT, report.status);
        assertEquals(1, report.mismatchCount());
        assertEquals("weak_first_fix", report.decisions.get(0).actualReason);
    }

    @Test
    public void toJson_exportsReplayReportFields() throws IOException, JSONException {
        ReplayReport report = fixture("good_walk.jsonl");
        JSONObject json = report.toJson();
        JSONArray decisions = json.getJSONArray("decisions");

        assertEquals(ReplayReport.EXACT, json.getString("status"));
        assertEquals("", json.getString("invalidReason"));
        assertEquals(2, json.getInt("decisionCount"));
        assertEquals(0, json.getInt("mismatchCount"));
        assertEquals(2, decisions.length());
        assertEquals(1L, decisions.getJSONObject(0).getLong("rawPointId"));
        assertEquals("anchor", decisions.getJSONObject(0).getString("actualResult"));
        assertEquals("first_fix_good", decisions.getJSONObject(0).getString("actualReason"));
        assertEquals(true, decisions.getJSONObject(0).getBoolean("matchesExpectation"));
    }

    @Test
    public void toJson_exportsInvalidReportReason() throws IOException, JSONException {
        ReplayReport report = fixture("missing_session_metadata.jsonl");
        JSONObject json = report.toJson();

        assertEquals(ReplayReport.INVALID_LOG, json.getString("status"));
        assertEquals("missing_session_metadata_before_raw_location",
                json.getString("invalidReason"));
        assertEquals(0, json.getInt("decisionCount"));
        assertEquals(0, json.getJSONArray("decisions").length());
    }

    @Test
    public void run_replaysForcedWeakFirstFixFixture() throws IOException {
        ReplayReport report = fixture("forced_weak_first_fix.jsonl");

        assertEquals(ReplayReport.EXACT, report.status);
        assertEquals(0, report.mismatchCount());
    }

    @Test
    public void run_returnsExactForStrategyRejectFixtures() throws IOException {
        assertExactFixture("weak_signal_stage1.jsonl", 2);
        assertExactFixture("impossible_speed.jsonl", 2);
        assertExactFixture("stationary_filter.jsonl", 3);
        assertExactFixture("transport_mode.jsonl", 4);
        assertExactFixture("gap_recovery_after_stationary_gap.jsonl", 2);
        assertExactFixture("stationary_anchor_refinement_after_gap.jsonl", 2);
        assertExactFixture("stationary_anchor_refinement_with_motion.jsonl", 2);
    }

    @Test
    public void run_returnsExactForValidationRejectFixtures() throws IOException {
        assertExactFixture("validation_rejects.jsonl", 4);
    }

    @Test
    public void run_rejectsMalformedJsonLineAsInvalidLog() throws IOException {
        ReplayReport report = fixture("malformed_line.jsonl");

        assertEquals(ReplayReport.INVALID_LOG, report.status);
        assertEquals("malformed_json_line_3", report.invalidReason);
    }

    @Test
    public void run_rejectsIncompleteLogFixturesAsInvalidLog() throws IOException {
        assertInvalidFixture("missing_session_metadata.jsonl",
                "missing_session_metadata_before_raw_location");
        assertInvalidFixture("no_raw_location_events.jsonl", "no_raw_location_events");
        assertInvalidFixture("truncated_json_line.jsonl", "malformed_json_line_3");
    }

    private void assertInvalidFixture(String name, String expectedReason) throws IOException {
        ReplayReport report = fixture(name);
        assertEquals(name, ReplayReport.INVALID_LOG, report.status);
        assertEquals(name, expectedReason, report.invalidReason);
    }

    private void assertExactFixture(String name, int expectedDecisionCount) throws IOException {
        ReplayReport report = fixture(name);
        assertEquals(name, ReplayReport.EXACT, report.status);
        assertEquals(name, 0, report.mismatchCount());
        assertEquals(name, expectedDecisionCount, report.decisions.size());
    }

    private ReplayReport fixture(String name) throws IOException {
        InputStream inputStream = getClass().getClassLoader()
                .getResourceAsStream("replay-fixtures/" + name);
        assertNotNull("missing replay fixture " + name, inputStream);
        try {
            return runner.run(inputStream);
        } finally {
            inputStream.close();
        }
    }

    private String baseHeader(boolean forcedWeakFirstFixEnabled) {
        return "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                + "{\"event\":\"config_snapshot\",\"forcedWeakFirstFixEnabled\":"
                + forcedWeakFirstFixEnabled + "}\n";
    }

    private String raw(long rawPointId, float accuracyMeters, double lat, double lng,
                       long elapsedRealtimeNanos, String expectedResult, String expectedReason) {
        return "{\"event\":\"raw_location\""
                + ",\"rawPointId\":" + rawPointId
                + ",\"provider\":\"gps\""
                + ",\"lat\":" + lat
                + ",\"lng\":" + lng
                + ",\"accuracy\":" + accuracyMeters
                + ",\"timeMillis\":1"
                + ",\"elapsedRealtimeNanos\":" + elapsedRealtimeNanos
                + ",\"expectedResult\":\"" + expectedResult + "\""
                + ",\"expectedReason\":\"" + expectedReason + "\""
                + "}\n";
    }
}
