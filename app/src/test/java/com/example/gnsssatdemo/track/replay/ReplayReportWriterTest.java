package com.example.gnsssatdemo.track.replay;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class ReplayReportWriterTest {
    @Test
    public void write_persistsReplayReportJson() throws Exception {
        File dir = Files.createTempDirectory("replay-report-writer-test").toFile();
        ReplayReport report = new ReplayRunner().run(
                "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                        + "{\"event\":\"config_snapshot\",\"forcedWeakFirstFixEnabled\":false}\n"
                        + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                        + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":10.0,\"timeMillis\":1,"
                        + "\"elapsedRealtimeNanos\":2000000000,"
                        + "\"expectedResult\":\"anchor\","
                        + "\"expectedReason\":\"first_fix_good\"}\n");

        File reportFile = new ReplayReportWriter().write(dir, report);

        assertEquals(ReplayReportWriter.REPORT_FILE_NAME, reportFile.getName());
        assertTrue(reportFile.exists());
        String text = new String(Files.readAllBytes(reportFile.toPath()), StandardCharsets.UTF_8);
        JSONObject json = new JSONObject(text);
        assertEquals(ReplayReport.EXACT, json.getString("status"));
        assertEquals(1, json.getInt("decisionCount"));
        assertEquals("first_fix_good",
                json.getJSONArray("decisions").getJSONObject(0).getString("actualReason"));
    }

    @Test
    public void write_createsMissingDirectory() throws Exception {
        File root = Files.createTempDirectory("replay-report-writer-test").toFile();
        File dir = new File(root, "nested/report");
        ReplayReport report = ReplayReport.invalid("no_raw_location_events");

        File reportFile = new ReplayReportWriter().write(dir, report);

        assertTrue(reportFile.exists());
        JSONObject json = new JSONObject(new String(Files.readAllBytes(reportFile.toPath()),
                StandardCharsets.UTF_8));
        assertEquals(ReplayReport.INVALID_LOG, json.getString("status"));
        assertEquals("no_raw_location_events", json.getString("invalidReason"));
    }
}
