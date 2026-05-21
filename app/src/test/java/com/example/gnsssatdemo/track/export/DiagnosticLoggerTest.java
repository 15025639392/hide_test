package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class DiagnosticLoggerTest {
    @Test
    public void append_writesEnvelopeFieldsAndMonotonicEventSeq() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-logger-test").toFile();
        File log = new File(dir, "evidence.jsonl");

        try (DiagnosticLogger logger = new DiagnosticLogger(log)) {
            JSONObject first = new JSONObject();
            first.put("event", "session_metadata");
            JSONObject second = new JSONObject();
            second.put("event", "raw_location");

            assertEquals(1L, logger.append(first, "session-1", 100L));
            assertEquals(2L, logger.append(second, "session-1", 200L));
        }

        List<String> lines = Files.readAllLines(log.toPath(), StandardCharsets.UTF_8);
        assertEquals(2, lines.size());

        JSONObject firstLine = new JSONObject(lines.get(0));
        assertEquals("session_metadata", firstLine.getString("event"));
        assertEquals("session-1", firstLine.getString("sessionId"));
        assertEquals(1L, firstLine.getLong("eventSeq"));
        assertEquals(1, firstLine.getInt("schemaVersion"));
        assertEquals(100L, firstLine.getLong("eventElapsedRealtimeNanos"));
        assertTrue(firstLine.has("writtenWallTimeMillis"));

        JSONObject secondLine = new JSONObject(lines.get(1));
        assertEquals("raw_location", secondLine.getString("event"));
        assertEquals(2L, secondLine.getLong("eventSeq"));
        assertEquals(200L, secondLine.getLong("eventElapsedRealtimeNanos"));
    }

    @Test
    public void append_preservesExistingEvidenceFields() throws Exception {
        File dir = Files.createTempDirectory("diagnostic-logger-test").toFile();
        File log = new File(dir, "evidence.jsonl");

        try (DiagnosticLogger logger = new DiagnosticLogger(log)) {
            JSONObject event = new JSONObject();
            event.put("event", "raw_location");
            event.put("rawPointId", 7L);
            event.put("provider", "gps");

            logger.append(event, "session-2", 300L);
        }

        JSONObject line = new JSONObject(Files.readAllLines(log.toPath(), StandardCharsets.UTF_8).get(0));
        assertEquals("raw_location", line.getString("event"));
        assertEquals(7L, line.getLong("rawPointId"));
        assertEquals("gps", line.getString("provider"));
        assertEquals("session-2", line.getString("sessionId"));
    }
}
