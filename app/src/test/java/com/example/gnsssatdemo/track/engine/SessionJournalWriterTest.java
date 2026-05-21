package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.export.SessionFileStore;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class SessionJournalWriterTest {
    @Test
    public void writeSessionJson_writesAtomicallyToSessionFile() throws Exception {
        SessionFileStore fileStore = newFileStore();
        File sessionDir = fileStore.createSessionDir("session-json");
        SessionJournalWriter writer = new SessionJournalWriter(fileStore);
        writer.reset(sessionDir, 123L);

        JSONObject json = new JSONObject();
        json.put("sessionId", "session-json");
        json.put("lastUpdatedWallTimeMillis", writer.getLastUpdatedWallTimeMillis());

        writer.writeSessionJson(json);

        assertTrue(fileStore.sessionJson(sessionDir).exists());
        assertTrue(!fileStore.sessionJsonTmp(sessionDir).exists());
        JSONObject written = new JSONObject(new String(Files.readAllBytes(
                fileStore.sessionJson(sessionDir).toPath()), StandardCharsets.UTF_8));
        assertEquals("session-json", written.getString("sessionId"));
        assertEquals(123L, written.getLong("lastUpdatedWallTimeMillis"));
    }

    @Test
    public void appendDiagnostic_updatesEventSeqAndWritesJsonl() throws Exception {
        SessionFileStore fileStore = newFileStore();
        File sessionDir = fileStore.createSessionDir("session-diagnostic");
        SessionJournalWriter writer = new SessionJournalWriter(fileStore);
        writer.reset(sessionDir, 123L);
        writer.openDiagnosticLogger();

        JSONObject event = new JSONObject();
        event.put("event", "test_event");

        writer.appendDiagnostic(event, "session-diagnostic", 456L);
        writer.closeQuietly();

        assertEquals(1L, writer.getLastEventSeq());
        assertTrue(writer.getLastUpdatedWallTimeMillis() >= 123L);
        String jsonl = new String(Files.readAllBytes(
                fileStore.diagnosticJsonl(sessionDir).toPath()), StandardCharsets.UTF_8);
        JSONObject written = new JSONObject(jsonl.trim());
        assertEquals("test_event", written.getString("event"));
        assertEquals("session-diagnostic", written.getString("sessionId"));
        assertEquals(1L, written.getLong("eventSeq"));
        assertEquals(456L, written.getLong("eventElapsedRealtimeNanos"));
    }

    @Test
    public void appendDiagnostic_writesOnlyPureEvidenceEventsToEvidenceJsonl()
            throws Exception {
        SessionFileStore fileStore = newFileStore();
        File sessionDir = fileStore.createSessionDir("session-evidence");
        SessionJournalWriter writer = new SessionJournalWriter(fileStore);
        writer.reset(sessionDir, 123L);
        writer.openDiagnosticLogger();

        JSONObject rawLocation = new JSONObject();
        rawLocation.put("event", "raw_location");
        rawLocation.put("rawPointId", 1);
        JSONObject decision = new JSONObject();
        decision.put("event", "decision");
        decision.put("rawPointId", 1);
        JSONObject intakeRejected = new JSONObject();
        intakeRejected.put("event", "location_intake_rejected");
        intakeRejected.put("rawPointId", 2);

        writer.appendDiagnostic(rawLocation, "session-evidence", 456L);
        writer.appendDiagnostic(decision, "session-evidence", 457L);
        writer.appendDiagnostic(intakeRejected, "session-evidence", 458L);
        writer.closeQuietly();

        String diagnosticJsonl = new String(Files.readAllBytes(
                fileStore.diagnosticJsonl(sessionDir).toPath()), StandardCharsets.UTF_8);
        String evidenceJsonl = new String(Files.readAllBytes(
                fileStore.evidenceJsonl(sessionDir).toPath()), StandardCharsets.UTF_8);

        assertTrue(diagnosticJsonl.contains("\"event\":\"raw_location\""));
        assertTrue(diagnosticJsonl.contains("\"event\":\"decision\""));
        assertTrue(diagnosticJsonl.contains("\"event\":\"location_intake_rejected\""));
        assertTrue(evidenceJsonl.contains("\"event\":\"raw_location\""));
        assertTrue(!evidenceJsonl.contains("\"event\":\"decision\""));
        assertTrue(!evidenceJsonl.contains("\"event\":\"location_intake_rejected\""));
    }

    private SessionFileStore newFileStore() throws Exception {
        return new SessionFileStore(Files.createTempDirectory("track-sessions").toFile());
    }
}
