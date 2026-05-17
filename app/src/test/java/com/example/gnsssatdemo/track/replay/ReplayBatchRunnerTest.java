package com.example.gnsssatdemo.track.replay;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class ReplayBatchRunnerTest {
    @Test
    public void run_scansJsonlFilesAndWritesReports() throws Exception {
        File inputDir = Files.createTempDirectory("replay-batch-input").toFile();
        File outputDir = Files.createTempDirectory("replay-batch-output").toFile();
        write(new File(inputDir, "a_good.jsonl"),
                "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                        + "{\"event\":\"config_snapshot\",\"forcedWeakFirstFixEnabled\":false}\n"
                        + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                        + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":10.0,\"timeMillis\":1,"
                        + "\"elapsedRealtimeNanos\":2000000000,"
                        + "\"expectedResult\":\"anchor\","
                        + "\"expectedReason\":\"first_fix_good\"}\n");
        write(new File(inputDir, "b_invalid.jsonl"),
                "{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n");
        write(new File(inputDir, "ignored.txt"), "not a fixture\n");

        ReplayBatchResult result = new ReplayBatchRunner().run(inputDir, outputDir);

        assertEquals(2, result.items.size());
        assertEquals(1, result.exactCount);
        assertEquals(0, result.bestEffortCount);
        assertEquals(1, result.invalidLogCount);
        assertEquals("a_good.jsonl", result.items.get(0).inputFile.getName());
        assertEquals("b_invalid.jsonl", result.items.get(1).inputFile.getName());

        File goodReport = new File(outputDir, "a_good/" + ReplayReportWriter.REPORT_FILE_NAME);
        File invalidReport = new File(outputDir, "b_invalid/" + ReplayReportWriter.REPORT_FILE_NAME);
        File batchReport = new File(outputDir, ReplayBatchReportWriter.REPORT_FILE_NAME);
        assertTrue(goodReport.exists());
        assertTrue(invalidReport.exists());
        assertTrue(batchReport.exists());
        JSONObject invalidJson = new JSONObject(new String(Files.readAllBytes(invalidReport.toPath()),
                StandardCharsets.UTF_8));
        assertEquals(ReplayReport.INVALID_LOG, invalidJson.getString("status"));
        assertEquals("no_raw_location_events", invalidJson.getString("invalidReason"));

        JSONObject batchJson = new JSONObject(new String(Files.readAllBytes(batchReport.toPath()),
                StandardCharsets.UTF_8));
        assertEquals(2, batchJson.getInt("totalCount"));
        assertEquals(1, batchJson.getInt("exactCount"));
        assertEquals(1, batchJson.getInt("invalidLogCount"));
        assertEquals("a_good.jsonl",
                batchJson.getJSONArray("items").getJSONObject(0).getString("inputFileName"));
    }

    private void write(File file, String text) throws Exception {
        Files.write(file.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }
}
