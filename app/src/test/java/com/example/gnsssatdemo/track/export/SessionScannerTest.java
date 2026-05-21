package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class SessionScannerTest {
    @Test
    public void scan_cleansKnownTmpFilesAndReadsManifestsNewestFirst() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File oldDir = store.createSessionDir("old-session");
        File newDir = store.createSessionDir("new-session");

        writeSessionJson(store, oldDir, "old-session", 1L);
        writeSessionJson(store, newDir, "new-session", 2L);
        Files.write(store.sessionJsonTmp(newDir).toPath(), "tmp".getBytes(StandardCharsets.UTF_8));
        Files.write(store.trackGpxTmp(oldDir).toPath(), "tmp".getBytes(StandardCharsets.UTF_8));
        oldDir.setLastModified(1_000L);
        newDir.setLastModified(2_000L);

        SessionScanResult result = new SessionScanner(store).scan();

        assertEquals(2, result.cleanedTmpFileCount);
        assertEquals(2, result.manifests.size());
        assertEquals("new-session", result.manifests.get(0).sessionId);
        assertEquals("old-session", result.manifests.get(1).sessionId);
        assertEquals(SessionManifest.READ_OK, result.manifests.get(0).readStatus);
        assertEquals(SessionManifest.READ_OK, result.manifests.get(1).readStatus);
        assertTrue(!store.sessionJsonTmp(newDir).exists());
        assertTrue(!store.trackGpxTmp(oldDir).exists());
    }

    @Test
    public void scan_includesSessionsWithMissingManifest() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        store.createSessionDir("missing-manifest");

        SessionScanResult result = new SessionScanner(store).scan();

        assertEquals(1, result.manifests.size());
        assertEquals("missing-manifest", result.manifests.get(0).sessionId);
        assertEquals(SessionManifest.READ_MISSING_SESSION_JSON, result.manifests.get(0).readStatus);
    }

    private void writeSessionJson(SessionFileStore store, File dir, String sessionId,
                                  long lastEventSeq) throws Exception {
        JSONObject json = new JSONObject();
        json.put("sessionId", sessionId);
        json.put("completionState", "FINISHED");
        json.put("integrityState", "OK");
        json.put("schemaVersion", 1);
        json.put("strategyVersion", "stage2-track-trust-v3-sampling-cloud");
        json.put("diagnosticLogFileName", "evidence.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("lastEventSeq", lastEventSeq);
        Files.write(store.sessionJson(dir).toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
    }
}
