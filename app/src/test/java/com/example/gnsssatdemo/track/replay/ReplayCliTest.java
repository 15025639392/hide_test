package com.example.gnsssatdemo.track.replay;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class ReplayCliTest {
    @Test
    public void run_writesBatchReportsAndPrintsSummary() throws Exception {
        File inputDir = Files.createTempDirectory("replay-cli-input").toFile();
        File outputDir = Files.createTempDirectory("replay-cli-output").toFile();
        Files.write(new File(inputDir, "good.jsonl").toPath(),
                ("{\"event\":\"session_metadata\",\"createdElapsedRealtimeNanos\":1000000000}\n"
                        + "{\"event\":\"config_snapshot\",\"strategyVersion\":"
                        + "\"stage2-track-trust-v3-sampling-cloud\"}\n"
                        + "{\"event\":\"raw_location\",\"rawPointId\":1,\"provider\":\"gps\","
                        + "\"lat\":29.0,\"lng\":106.0,\"accuracy\":10.0,\"timeMillis\":1,"
                        + "\"elapsedRealtimeNanos\":2000000000,"
                        + "\"expectedResult\":\"anchor\","
                        + "\"expectedReason\":\"first_fix_good\"}\n")
                        .getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream outBytes = new ByteArrayOutputStream();
        ByteArrayOutputStream errBytes = new ByteArrayOutputStream();

        int exitCode = ReplayCli.run(new String[]{inputDir.getAbsolutePath(),
                        outputDir.getAbsolutePath()},
                new PrintStream(outBytes), new PrintStream(errBytes));

        String output = outBytes.toString(StandardCharsets.UTF_8.name());
        assertEquals(0, exitCode);
        assertEquals("", errBytes.toString(StandardCharsets.UTF_8.name()));
        assertTrue(output.contains("Replay batch complete"));
        assertTrue(output.contains("total=1"));
        assertTrue(output.contains("exact=1"));
        assertTrue(new File(outputDir, "good/" + ReplayReportWriter.REPORT_FILE_NAME).exists());
    }

    @Test
    public void run_returnsUsageErrorForWrongArgCount() throws Exception {
        ByteArrayOutputStream errBytes = new ByteArrayOutputStream();

        int exitCode = ReplayCli.run(new String[0], new PrintStream(new ByteArrayOutputStream()),
                new PrintStream(errBytes));

        assertEquals(2, exitCode);
        assertTrue(errBytes.toString(StandardCharsets.UTF_8.name()).contains("Usage: ReplayCli"));
    }
}
