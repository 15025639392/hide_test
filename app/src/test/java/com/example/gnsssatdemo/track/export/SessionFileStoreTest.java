package com.example.gnsssatdemo.track.export;

import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class SessionFileStoreTest {
    @Test
    public void createSessionDir_createsExpectedDirectoryUnderRoot() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);

        File dir = store.createSessionDir("session-1");

        assertTrue(dir.exists());
        assertTrue(dir.isDirectory());
        assertEquals(new File(root, "session-1").getAbsolutePath(), dir.getAbsolutePath());
        assertEquals(root.getAbsolutePath(), store.rootDir().getAbsolutePath());
    }

    @Test
    public void fileAccessors_returnStableSessionFileNames() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-2");

        assertEquals(new File(dir, "session.json"), store.sessionJson(dir));
        assertEquals(new File(dir, "session.json.tmp"), store.sessionJsonTmp(dir));
        assertEquals(new File(dir, "diagnostic.jsonl"), store.diagnosticJsonl(dir));
        assertEquals(new File(dir, "track.gpx"), store.trackGpx(dir));
        assertEquals(new File(dir, "track.gpx.tmp"), store.trackGpxTmp(dir));
        assertEquals(new File(dir, "export"), store.exportDir(dir));
    }

    @Test
    public void cleanupKnownTmpFiles_deletesOnlyKnownTmpFiles() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-3");
        File sessionTmp = store.sessionJsonTmp(dir);
        File gpxTmp = store.trackGpxTmp(dir);
        File diagnostic = store.diagnosticJsonl(dir);
        File unrelatedTmp = new File(dir, "other.tmp");

        Files.write(sessionTmp.toPath(), "partial".getBytes());
        Files.write(gpxTmp.toPath(), "partial".getBytes());
        Files.write(diagnostic.toPath(), "{}\n".getBytes());
        Files.write(unrelatedTmp.toPath(), "keep".getBytes());

        assertEquals(2, store.cleanupKnownTmpFiles(dir));

        assertTrue(!sessionTmp.exists());
        assertTrue(!gpxTmp.exists());
        assertTrue(diagnostic.exists());
        assertTrue(unrelatedTmp.exists());
    }

    @Test
    public void cleanupKnownTmpFiles_isNoopWhenNoTmpFilesExist() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-4");

        assertEquals(0, store.cleanupKnownTmpFiles(dir));
    }

    @Test
    public void listSessionDirsNewestFirst_returnsOnlyValidDirectories() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File oldDir = store.createSessionDir("old-session");
        File newDir = store.createSessionDir("new-session");
        File invalidDir = new File(root, "bad..session");
        File plainFile = new File(root, "file-session");

        assertTrue(invalidDir.mkdirs());
        Files.write(plainFile.toPath(), "not a dir".getBytes());
        oldDir.setLastModified(1_000L);
        newDir.setLastModified(2_000L);
        invalidDir.setLastModified(3_000L);

        List<File> sessions = store.listSessionDirsNewestFirst();

        assertEquals(2, sessions.size());
        assertEquals("new-session", sessions.get(0).getName());
        assertEquals("old-session", sessions.get(1).getName());
    }

    @Test
    public void listSessionDirsNewestFirst_returnsEmptyListWhenRootMissing() throws Exception {
        File root = new File(Files.createTempDirectory("track-sessions").toFile(), "missing");
        SessionFileStore store = new SessionFileStore(root);

        assertTrue(store.listSessionDirsNewestFirst().isEmpty());
    }

    @Test
    public void sessionDir_rejectsPathTraversal() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);

        assertInvalidSessionId(store, "");
        assertInvalidSessionId(store, "../escape");
        assertInvalidSessionId(store, "a/b");
        assertInvalidSessionId(store, "a\\b");
        assertInvalidSessionId(store, "abc..def");
    }

    private void assertInvalidSessionId(SessionFileStore store, String sessionId) {
        try {
            store.sessionDir(sessionId);
            throw new AssertionError("Expected invalid sessionId: " + sessionId);
        } catch (IllegalArgumentException expected) {
            // Expected.
        }
    }
}
