package com.example.gnsssatdemo.track.export;

import android.content.Context;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class SessionFileStore {
    private final File rootDir;

    public SessionFileStore(Context context) {
        this(new File(context.getFilesDir(), "track_sessions"));
    }

    public SessionFileStore(File rootDir) {
        this.rootDir = rootDir;
    }

    public File createSessionDir(String sessionId) throws IOException {
        File dir = sessionDir(sessionId);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("无法创建 session 目录: " + dir);
        }
        return dir;
    }

    public File rootDir() {
        return rootDir;
    }

    public File sessionDir(String sessionId) {
        requireValidSessionId(sessionId);
        return new File(rootDir, sessionId);
    }

    public File sessionJson(File sessionDir) {
        return new File(sessionDir, "session.json");
    }

    public File sessionJsonTmp(File sessionDir) {
        return new File(sessionDir, "session.json.tmp");
    }

    public File diagnosticJsonl(File sessionDir) {
        return new File(sessionDir, "diagnostic.jsonl");
    }

    public File trackGpx(File sessionDir) {
        return new File(sessionDir, "track.gpx");
    }

    public File trackGpxTmp(File sessionDir) {
        return new File(sessionDir, "track.gpx.tmp");
    }

    public File partialGpx(File sessionDir) {
        return new File(sessionDir, "partial.gpx");
    }

    public File partialGpxTmp(File sessionDir) {
        return new File(sessionDir, "partial.gpx.tmp");
    }

    public File exportDir(File sessionDir) {
        return new File(sessionDir, "export");
    }

    public List<File> listSessionDirsNewestFirst() {
        File[] children = rootDir.listFiles();
        List<File> sessionDirs = new ArrayList<>();
        if (children == null) {
            return sessionDirs;
        }
        for (File child : children) {
            if (child.isDirectory() && isValidSessionId(child.getName())) {
                sessionDirs.add(child);
            }
        }
        Collections.sort(sessionDirs, new Comparator<File>() {
            @Override
            public int compare(File left, File right) {
                int byModified = Long.compare(right.lastModified(), left.lastModified());
                if (byModified != 0) {
                    return byModified;
                }
                return left.getName().compareTo(right.getName());
            }
        });
        return sessionDirs;
    }

    public int cleanupKnownTmpFiles(File sessionDir) throws IOException {
        int deleted = 0;
        if (deleteIfExists(sessionJsonTmp(sessionDir))) {
            deleted++;
        }
        if (deleteIfExists(trackGpxTmp(sessionDir))) {
            deleted++;
        }
        if (deleteIfExists(partialGpxTmp(sessionDir))) {
            deleted++;
        }
        return deleted;
    }

    public void deleteSessionDir(String sessionId) throws IOException {
        File dir = sessionDir(sessionId);
        deleteSessionDir(dir);
    }

    public void deleteSessionDir(File sessionDir) throws IOException {
        if (sessionDir == null || !sessionDir.exists()) {
            return;
        }
        File rootCanonical = rootDir.getCanonicalFile();
        File sessionCanonical = sessionDir.getCanonicalFile();
        if (!rootCanonical.equals(sessionCanonical.getParentFile())
                || !isValidSessionId(sessionCanonical.getName())) {
            throw new IOException("拒绝删除非法 session 目录: " + sessionDir);
        }
        deleteRecursively(sessionCanonical);
    }

    private boolean deleteIfExists(File file) throws IOException {
        if (!file.exists()) {
            return false;
        }
        if (!file.delete()) {
            throw new IOException("无法删除临时文件: " + file);
        }
        return true;
    }

    private void deleteRecursively(File file) throws IOException {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) {
                throw new IOException("无法读取待删除目录: " + file);
            }
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        if (!file.delete()) {
            throw new IOException("无法删除文件: " + file);
        }
    }

    private void requireValidSessionId(String sessionId) {
        if (!isValidSessionId(sessionId)) {
            throw new IllegalArgumentException("非法 sessionId: " + sessionId);
        }
    }

    private boolean isValidSessionId(String sessionId) {
        return sessionId != null && !sessionId.isEmpty()
                && !sessionId.contains("/") && !sessionId.contains("\\")
                && !sessionId.contains("..");
    }
}
