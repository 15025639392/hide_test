package com.example.gnsssatdemo;

import com.example.gnsssatdemo.track.export.SessionFileStore;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class HistorySessionControllerTest {
    @Test
    public void scan_keepsSelectedSessionWhenItStillExists() throws Exception {
        SessionFileStore fileStore = newFileStore();
        File older = writeSession(fileStore, "older", 1_000L, 12.0);
        File newer = writeSession(fileStore, "newer", 2_000L, 24.0);
        older.setLastModified(1_000L);
        newer.setLastModified(2_000L);

        HistorySessionState state = new HistorySessionController(fileStore).scan("older");

        assertEquals(2, state.sessionCount());
        assertEquals("older", state.selectedSessionId);
        assertEquals("older", state.latestManifest.sessionId);
        assertEquals("", state.error);
    }

    @Test
    public void scan_selectsNewestSessionWhenSelectionIsMissing() throws Exception {
        SessionFileStore fileStore = newFileStore();
        File older = writeSession(fileStore, "older", 1_000L, 12.0);
        File newer = writeSession(fileStore, "newer", 2_000L, 24.0);
        older.setLastModified(1_000L);
        newer.setLastModified(2_000L);

        HistorySessionState state = new HistorySessionController(fileStore).scan("missing");

        assertEquals("newer", state.selectedSessionId);
        assertEquals("newer", state.latestManifest.sessionId);
    }

    @Test
    public void scan_returnsEmptyStateWhenRootIsUnreadableFile() throws Exception {
        File rootFile = Files.createTempFile("track-sessions", ".txt").toFile();
        SessionFileStore fileStore = new SessionFileStore(rootFile);

        HistorySessionState state = new HistorySessionController(fileStore).scan("anything");

        assertEquals(0, state.sessionCount());
        assertEquals("", state.selectedSessionId);
        assertNull(state.latestManifest);
    }

    private SessionFileStore newFileStore() throws Exception {
        return new SessionFileStore(Files.createTempDirectory("track-sessions").toFile());
    }

    private File writeSession(SessionFileStore fileStore, String sessionId,
                              long updatedMillis, double distanceMeters) throws Exception {
        File dir = fileStore.createSessionDir(sessionId);
        JSONObject json = new JSONObject();
        json.put("sessionId", sessionId);
        json.put("createdWallTimeMillis", updatedMillis - 100L);
        json.put("createdElapsedRealtimeNanos", 1L);
        json.put("completionState", "FINISHED");
        json.put("integrityState", "OK");
        json.put("schemaVersion", 1);
        json.put("strategyVersion", "stage2-track-trust-v3-sampling-cloud");
        json.put("diagnosticLogFileName", "evidence.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", 0L);
        json.put("lastUpdatedWallTimeMillis", updatedMillis);
        json.put("trackPointCount", 1);
        json.put("weakTrackPointCount", 0);
        json.put("rawPointCount", 1);
        json.put("segmentCount", 1);
        json.put("totalDistanceMeters", distanceMeters);
        json.put("movingTimeSeconds", 10.0);
        Files.write(fileStore.sessionJson(dir).toPath(),
                json.toString(2).getBytes(StandardCharsets.UTF_8));
        return dir;
    }
}
