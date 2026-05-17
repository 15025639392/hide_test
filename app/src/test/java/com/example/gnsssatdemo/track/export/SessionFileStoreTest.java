package com.example.gnsssatdemo.track.export;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
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

    @Test
    public void deleteSessionDir_deletesSessionDirectoryRecursively() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        SessionFileStore store = new SessionFileStore(root);
        File dir = store.createSessionDir("session-delete");
        File exportDir = store.exportDir(dir);
        assertTrue(exportDir.mkdirs());
        File diagnostic = store.diagnosticJsonl(dir);
        File exported = new File(exportDir, "report.txt");

        Files.write(diagnostic.toPath(), "{}\n".getBytes());
        Files.write(exported.toPath(), "report".getBytes());

        store.deleteSessionDir(dir);

        assertTrue(!dir.exists());
        assertTrue(root.exists());
    }

    @Test
    public void deleteSessionDir_rejectsDirectoryOutsideRoot() throws Exception {
        File parent = Files.createTempDirectory("track-sessions-parent").toFile();
        File root = new File(parent, "root");
        File outside = new File(parent, "outside-session");
        assertTrue(root.mkdirs());
        assertTrue(outside.mkdirs());
        File outsideFile = new File(outside, "diagnostic.jsonl");
        Files.write(outsideFile.toPath(), "{}\n".getBytes());
        SessionFileStore store = new SessionFileStore(root);

        try {
            store.deleteSessionDir(outside);
            throw new AssertionError("Expected deletion outside root to fail");
        } catch (IOException expected) {
            // Expected.
        }

        assertTrue(outside.exists());
        assertTrue(outsideFile.exists());
    }

    @Test
    public void deleteSessionDir_rejectsInvalidSessionDirectoryName() throws Exception {
        File root = Files.createTempDirectory("track-sessions").toFile();
        File invalidDir = new File(root, "bad..session");
        assertTrue(invalidDir.mkdirs());
        File diagnostic = new File(invalidDir, "diagnostic.jsonl");
        Files.write(diagnostic.toPath(), "{}\n".getBytes());
        SessionFileStore store = new SessionFileStore(root);

        try {
            store.deleteSessionDir(invalidDir);
            throw new AssertionError("Expected invalid session directory name to fail");
        } catch (IOException expected) {
            // Expected.
        }

        assertTrue(invalidDir.exists());
        assertTrue(diagnostic.exists());
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
