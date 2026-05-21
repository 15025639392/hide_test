package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.export.DiagnosticLogger;
import com.example.gnsssatdemo.track.export.SessionFileStore;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

public class SessionJournalWriter {
    private final SessionFileStore fileStore;
    private DiagnosticLogger logger;
    private File sessionDir;
    private long lastEventSeq;
    private long lastUpdatedWallTimeMillis;

    public SessionJournalWriter(SessionFileStore fileStore) {
        this.fileStore = fileStore;
    }

    public void reset(File sessionDir, long initialUpdatedWallTimeMillis) {
        closeQuietly();
        this.sessionDir = sessionDir;
        lastEventSeq = 0L;
        lastUpdatedWallTimeMillis = initialUpdatedWallTimeMillis;
    }

    public void openDiagnosticLogger() throws IOException {
        if (sessionDir == null) {
            throw new IOException("sessionDir is not initialized");
        }
        closeQuietly();
        logger = new DiagnosticLogger(fileStore.evidenceJsonl(sessionDir));
    }

    public boolean isDiagnosticLoggerOpen() {
        return logger != null;
    }

    public void appendDiagnostic(JSONObject event, String sessionId, long eventElapsedRealtimeNanos)
            throws IOException, JSONException {
        if (logger == null) {
            throw new IOException("diagnostic logger is not open");
        }
        if (!isEvidenceEvent(event.optString("event", ""))) {
            return;
        }
        lastEventSeq = logger.append(event, sessionId, eventElapsedRealtimeNanos);
        lastUpdatedWallTimeMillis = System.currentTimeMillis();
    }

    public void writeSessionJson(JSONObject json) throws IOException, JSONException {
        if (sessionDir == null) {
            return;
        }
        File finalFile = fileStore.sessionJson(sessionDir);
        File tmpFile = fileStore.sessionJsonTmp(sessionDir);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(tmpFile), StandardCharsets.UTF_8))) {
            writer.write(json.toString(2));
            writer.write('\n');
        }
        if (!tmpFile.renameTo(finalFile)) {
            throw new IOException("session.json rename 失败");
        }
    }

    public long getLastEventSeq() {
        return lastEventSeq;
    }

    public long getLastUpdatedWallTimeMillis() {
        return lastUpdatedWallTimeMillis;
    }

    public void closeQuietly() {
        closeLoggerQuietly(logger);
        logger = null;
    }

    private boolean isEvidenceEvent(String eventName) {
        return "session_metadata".equals(eventName)
                || "config_snapshot".equals(eventName)
                || "runtime_snapshot".equals(eventName)
                || "session_event".equals(eventName)
                || "sampling_policy".equals(eventName)
                || "gnss_snapshot".equals(eventName)
                || "raw_location".equals(eventName)
                || "device_motion_window".equals(eventName)
                || "barometer_window".equals(eventName)
                || "barometer_calibration".equals(eventName)
                || "pressure_summary".equals(eventName)
                || "session_integrity_error".equals(eventName);
    }

    private void closeLoggerQuietly(DiagnosticLogger target) {
        if (target == null) {
            return;
        }
        try {
            target.close();
        } catch (IOException ignored) {
            // Best effort.
        }
    }
}
