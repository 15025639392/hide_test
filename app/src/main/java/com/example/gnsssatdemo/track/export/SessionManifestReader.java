package com.example.gnsssatdemo.track.export;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class SessionManifestReader {
    private final SessionFileStore fileStore;

    public SessionManifestReader(SessionFileStore fileStore) {
        this.fileStore = fileStore;
    }

    public SessionManifest read(File sessionDir) {
        File sessionJson = fileStore.sessionJson(sessionDir);
        if (!sessionJson.exists()) {
            return missing(sessionDir);
        }
        try {
            JSONObject json = new JSONObject(readText(sessionJson));
            String diagnosticFileName = json.optString("diagnosticLogFileName", "diagnostic.jsonl");
            String trustedGpxFileName = json.optString("trustedGpxFileName", "track.gpx");
            String partialGpxFileName = json.optString("partialGpxFileName", "partial.gpx");
            File diagnosticFile = new File(sessionDir, diagnosticFileName);
            File trustedGpxFile = new File(sessionDir, trustedGpxFileName);
            File partialGpxFile = new File(sessionDir, partialGpxFileName);
            DiagnosticLogSummary diagnosticSummary = readDiagnosticLogSummary(diagnosticFile);
            return new SessionManifest(
                    SessionManifest.READ_OK,
                    sessionDir,
                    json.optString("sessionId", sessionDir.getName()),
                    json.optLong("createdWallTimeMillis", 0L),
                    json.optLong("createdElapsedRealtimeNanos", 0L),
                    json.optString("completionState", ""),
                    json.optString("integrityState", ""),
                    json.optInt("schemaVersion", 0),
                    json.optString("strategyVersion", ""),
                    diagnosticFileName,
                    trustedGpxFileName,
                    partialGpxFileName,
                    json.optLong("lastEventSeq", 0L),
                    json.optLong("lastUpdatedWallTimeMillis", 0L),
                    json.optInt("trackPointCount", 0),
                    json.optInt("weakTrackPointCount", 0),
                    json.optInt("rawPointCount", 0),
                    json.optInt("segmentCount", 0),
                    json.optDouble("totalDistanceMeters", 0.0),
                    json.optDouble("movingTimeSeconds", 0.0),
                    json.optInt("stationaryKeepaliveCount", 0),
                    json.optInt("stationaryJitterCount", 0),
                    json.optString("lastKnownErrorCode", ""),
                    diagnosticFile.exists(),
                    trustedGpxFile.exists(),
                    partialGpxFile.exists(),
                    fileLengthIfExists(diagnosticFile),
                    fileLengthIfExists(trustedGpxFile),
                    fileLengthIfExists(partialGpxFile),
                    diagnosticSummary.readStatus,
                    diagnosticSummary.lastCompleteEventSeq,
                    diagnosticSummary.completeEventCount);
        } catch (IOException | JSONException e) {
            return invalid(sessionDir);
        }
    }

    private SessionManifest missing(File sessionDir) {
        File diagnosticFile = fileStore.diagnosticJsonl(sessionDir);
        File trustedGpxFile = fileStore.trackGpx(sessionDir);
        File partialGpxFile = fileStore.partialGpx(sessionDir);
        DiagnosticLogSummary diagnosticSummary = readDiagnosticLogSummary(diagnosticFile);
        return new SessionManifest(SessionManifest.READ_MISSING_SESSION_JSON, sessionDir, sessionDir.getName(),
                0L, 0L, "", "", 0, "", "diagnostic.jsonl", "track.gpx", "partial.gpx",
                0L, 0L, 0, 0, 0, 0, 0.0, 0.0, 0, 0, "", diagnosticFile.exists(),
                trustedGpxFile.exists(), partialGpxFile.exists(), fileLengthIfExists(diagnosticFile),
                fileLengthIfExists(trustedGpxFile), fileLengthIfExists(partialGpxFile), diagnosticSummary.readStatus,
                diagnosticSummary.lastCompleteEventSeq, diagnosticSummary.completeEventCount);
    }

    private SessionManifest invalid(File sessionDir) {
        File diagnosticFile = fileStore.diagnosticJsonl(sessionDir);
        File trustedGpxFile = fileStore.trackGpx(sessionDir);
        File partialGpxFile = fileStore.partialGpx(sessionDir);
        DiagnosticLogSummary diagnosticSummary = readDiagnosticLogSummary(diagnosticFile);
        return new SessionManifest(SessionManifest.READ_INVALID_SESSION_JSON, sessionDir, sessionDir.getName(),
                0L, 0L, "", "", 0, "", "diagnostic.jsonl", "track.gpx", "partial.gpx",
                0L, 0L, 0, 0, 0, 0, 0.0, 0.0, 0, 0, "", diagnosticFile.exists(),
                trustedGpxFile.exists(), partialGpxFile.exists(), fileLengthIfExists(diagnosticFile),
                fileLengthIfExists(trustedGpxFile), fileLengthIfExists(partialGpxFile), diagnosticSummary.readStatus,
                diagnosticSummary.lastCompleteEventSeq, diagnosticSummary.completeEventCount);
    }

    private long fileLengthIfExists(File file) {
        return file.exists() ? file.length() : 0L;
    }

    private DiagnosticLogSummary readDiagnosticLogSummary(File diagnosticFile) {
        if (!diagnosticFile.exists()) {
            return new DiagnosticLogSummary(DiagnosticLogSummary.STATUS_MISSING, 0L, 0);
        }
        long lastCompleteEventSeq = 0L;
        int completeEventCount = 0;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(diagnosticFile), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                JSONObject event = new JSONObject(trimmed);
                if (!event.has("eventSeq")) {
                    continue;
                }
                lastCompleteEventSeq = event.optLong("eventSeq", 0L);
                completeEventCount++;
            }
            return new DiagnosticLogSummary(DiagnosticLogSummary.STATUS_OK,
                    lastCompleteEventSeq, completeEventCount);
        } catch (JSONException e) {
            return new DiagnosticLogSummary(DiagnosticLogSummary.STATUS_INVALID_JSONL,
                    lastCompleteEventSeq, completeEventCount);
        } catch (IOException e) {
            return new DiagnosticLogSummary(DiagnosticLogSummary.STATUS_READ_ERROR,
                    lastCompleteEventSeq, completeEventCount);
        }
    }

    private String readText(File file) throws IOException {
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream inputStream = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = inputStream.read(bytes, offset, bytes.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
            return new String(bytes, 0, offset, StandardCharsets.UTF_8);
        }
    }
}
