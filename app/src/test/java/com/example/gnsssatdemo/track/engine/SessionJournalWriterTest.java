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
        event.put("event", "raw_location");

        writer.appendDiagnostic(event, "session-diagnostic", 456L);
        writer.closeQuietly();

        assertEquals(1L, writer.getLastEventSeq());
        assertTrue(writer.getLastUpdatedWallTimeMillis() >= 123L);
        String jsonl = new String(Files.readAllBytes(
                fileStore.evidenceJsonl(sessionDir).toPath()), StandardCharsets.UTF_8);
        JSONObject written = new JSONObject(jsonl.trim());
        assertEquals("raw_location", written.getString("event"));
        assertEquals("session-diagnostic", written.getString("sessionId"));
        assertEquals(1L, written.getLong("eventSeq"));
        assertEquals(456L, written.getLong("eventElapsedRealtimeNanos"));
    }

    @Test
    public void appendDiagnostic_writesPureEvidenceEventsToEvidenceJsonl()
            throws Exception {
        SessionFileStore fileStore = newFileStore();
        File sessionDir = fileStore.createSessionDir("session-evidence");
        SessionJournalWriter writer = new SessionJournalWriter(fileStore);
        writer.reset(sessionDir, 123L);
        writer.openDiagnosticLogger();

        JSONObject rawLocation = new JSONObject();
        rawLocation.put("event", "raw_location");
        rawLocation.put("rawPointId", 1);

        writer.appendDiagnostic(rawLocation, "session-evidence", 456L);
        writer.closeQuietly();

        String evidenceJsonl = new String(Files.readAllBytes(
                fileStore.evidenceJsonl(sessionDir).toPath()), StandardCharsets.UTF_8);

        assertTrue(evidenceJsonl.contains("\"event\":\"raw_location\""));
    }

    private SessionFileStore newFileStore() throws Exception {
        return new SessionFileStore(Files.createTempDirectory("track-sessions").toFile());
    }
}
