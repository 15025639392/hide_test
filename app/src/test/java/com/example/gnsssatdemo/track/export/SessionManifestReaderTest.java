package com.example.gnsssatdemo.track.export;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class SessionManifestReaderTest {
    @Test
    public void read_parsesSessionJsonAndFileExistence() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-1");

        JSONObject json = new JSONObject();
        json.put("sessionId", "session-1");
        json.put("createdWallTimeMillis", 100L);
        json.put("createdElapsedRealtimeNanos", 200L);
        json.put("completionState", "FINISHED");
        json.put("integrityState", "OK");
        json.put("schemaVersion", 1);
        json.put("strategyVersion", "stage1-gnss-track-v1");
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("partialGpxFileName", "partial.gpx");
        json.put("lastEventSeq", 22L);
        json.put("lastUpdatedWallTimeMillis", 300L);
        json.put("trackPointCount", 2);
        json.put("weakTrackPointCount", 1);
        json.put("rawPointCount", 5);
        json.put("segmentCount", 1);
        json.put("totalDistanceMeters", 12.5);
        json.put("movingTimeSeconds", 6.25);
        json.put("stationaryKeepaliveCount", 3);
        json.put("stationaryJitterCount", 4);
        json.put("lastKnownErrorCode", "");
        Files.write(store.sessionJson(dir).toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        Files.write(store.diagnosticJsonl(dir).toPath(),
                "{\"eventSeq\":21}\n{\"eventSeq\":22}\n".getBytes(StandardCharsets.UTF_8));
        Files.write(store.trackGpx(dir).toPath(), "<gpx />\n".getBytes(StandardCharsets.UTF_8));
        Files.write(store.partialGpx(dir).toPath(), "<gpx partial=\"true\" />\n".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(SessionManifest.READ_OK, manifest.readStatus);
        assertEquals("session-1", manifest.sessionId);
        assertEquals(100L, manifest.createdWallTimeMillis);
        assertEquals(200L, manifest.createdElapsedRealtimeNanos);
        assertEquals("FINISHED", manifest.completionState);
        assertEquals("OK", manifest.integrityState);
        assertEquals(1, manifest.schemaVersion);
        assertEquals("stage1-gnss-track-v1", manifest.strategyVersion);
        assertEquals(22L, manifest.lastEventSeq);
        assertEquals(300L, manifest.lastUpdatedWallTimeMillis);
        assertEquals(2, manifest.trackPointCount);
        assertEquals(1, manifest.weakTrackPointCount);
        assertEquals(5, manifest.rawPointCount);
        assertEquals(1, manifest.segmentCount);
        assertEquals(12.5, manifest.totalDistanceMeters, 0.0);
        assertEquals(6.25, manifest.movingTimeSeconds, 0.0);
        assertEquals(3, manifest.stationaryKeepaliveCount);
        assertEquals(4, manifest.stationaryJitterCount);
        assertTrue(manifest.diagnosticLogExists);
        assertTrue(manifest.trustedGpxExists);
        assertTrue(manifest.partialGpxExists);
        assertTrue(manifest.diagnosticLogBytes > 0L);
        assertTrue(manifest.trustedGpxBytes > 0L);
        assertTrue(manifest.partialGpxBytes > 0L);
        assertEquals(DiagnosticLogSummary.STATUS_OK, manifest.diagnosticLogReadStatus);
        assertEquals(22L, manifest.diagnosticLastCompleteEventSeq);
        assertEquals(2, manifest.diagnosticCompleteEventCount);
        assertTrue(manifest.diagnosticEventSeqMatchesManifest);
    }

    @Test
    public void read_returnsMissingWhenSessionJsonDoesNotExist() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-2");
        Files.write(store.diagnosticJsonl(dir).toPath(), "{}\n".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(SessionManifest.READ_MISSING_SESSION_JSON, manifest.readStatus);
        assertEquals("session-2", manifest.sessionId);
        assertTrue(manifest.diagnosticLogExists);
        assertTrue(!manifest.trustedGpxExists);
        assertTrue(!manifest.partialGpxExists);
        assertTrue(manifest.diagnosticLogBytes > 0L);
        assertEquals(0L, manifest.trustedGpxBytes);
        assertEquals(0L, manifest.partialGpxBytes);
        assertEquals(DiagnosticLogSummary.STATUS_OK, manifest.diagnosticLogReadStatus);
        assertEquals(0L, manifest.diagnosticLastCompleteEventSeq);
    }

    @Test
    public void read_returnsInvalidWhenSessionJsonIsMalformed() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-3");
        Files.write(store.sessionJson(dir).toPath(), "{bad json".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(SessionManifest.READ_INVALID_SESSION_JSON, manifest.readStatus);
        assertEquals("session-3", manifest.sessionId);
    }

    @Test
    public void read_marksMismatchWhenDiagnosticLastEventSeqDiffersFromManifest() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-4");

        JSONObject json = new JSONObject();
        json.put("sessionId", "session-4");
        json.put("completionState", "FINISHED");
        json.put("integrityState", "OK");
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("lastEventSeq", 10L);
        Files.write(store.sessionJson(dir).toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        Files.write(store.diagnosticJsonl(dir).toPath(),
                "{\"eventSeq\":8}\n{\"eventSeq\":9}\n".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(DiagnosticLogSummary.STATUS_OK, manifest.diagnosticLogReadStatus);
        assertEquals(9L, manifest.diagnosticLastCompleteEventSeq);
        assertTrue(!manifest.diagnosticEventSeqMatchesManifest);
    }

    @Test
    public void read_keepsLastCompleteEventSeqWhenDiagnosticHasInvalidLine() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-5");

        JSONObject json = new JSONObject();
        json.put("sessionId", "session-5");
        json.put("completionState", "ACTIVE");
        json.put("integrityState", "OK");
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("lastEventSeq", 2L);
        Files.write(store.sessionJson(dir).toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        Files.write(store.diagnosticJsonl(dir).toPath(),
                "{\"eventSeq\":1}\n{bad json\n".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(DiagnosticLogSummary.STATUS_INVALID_JSONL, manifest.diagnosticLogReadStatus);
        assertEquals(1L, manifest.diagnosticLastCompleteEventSeq);
        assertEquals(1, manifest.diagnosticCompleteEventCount);
        assertTrue(!manifest.diagnosticEventSeqMatchesManifest);
    }

    @Test
    public void read_marksActiveSessionAsInterrupted() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-active");

        JSONObject json = new JSONObject();
        json.put("sessionId", "session-active");
        json.put("completionState", "ACTIVE");
        json.put("integrityState", "OK");
        json.put("diagnosticLogFileName", "diagnostic.jsonl");
        json.put("trustedGpxFileName", "track.gpx");
        json.put("lastEventSeq", 1L);
        Files.write(store.sessionJson(dir).toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        Files.write(store.diagnosticJsonl(dir).toPath(),
                "{\"eventSeq\":1}\n".getBytes(StandardCharsets.UTF_8));

        SessionManifest manifest = new SessionManifestReader(store).read(dir);

        assertEquals(SessionManifest.RECOVERY_INTERRUPTED, manifest.recoveryState);
    }
}
