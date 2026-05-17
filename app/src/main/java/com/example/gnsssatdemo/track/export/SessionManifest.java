package com.example.gnsssatdemo.track.export;

import java.io.File;

public class SessionManifest {
    public static final String READ_OK = "OK";
    public static final String READ_MISSING_SESSION_JSON = "MISSING_SESSION_JSON";
    public static final String READ_INVALID_SESSION_JSON = "INVALID_SESSION_JSON";

    public static final String RECOVERY_FINISHED = "FINISHED";
    public static final String RECOVERY_INTERRUPTED = "INTERRUPTED";
    public static final String RECOVERY_ERROR = "ERROR";
    public static final String RECOVERY_ABORTED = "ABORTED";
    public static final String RECOVERY_INVALID_MANIFEST = "INVALID_MANIFEST";
    public static final String RECOVERY_MISSING_MANIFEST = "MISSING_MANIFEST";
    public static final String RECOVERY_UNKNOWN = "UNKNOWN";

    public final String readStatus;
    public final File sessionDir;
    public final String sessionId;
    public final long createdWallTimeMillis;
    public final long createdElapsedRealtimeNanos;
    public final String completionState;
    public final String integrityState;
    public final int schemaVersion;
    public final String strategyVersion;
    public final String diagnosticLogFileName;
    public final String trustedGpxFileName;
    public final String partialGpxFileName;
    public final long lastEventSeq;
    public final long lastUpdatedWallTimeMillis;
    public final int trackPointCount;
    public final int weakTrackPointCount;
    public final int rawPointCount;
    public final int segmentCount;
    public final double totalDistanceMeters;
    public final double movingTimeSeconds;
    public final int stationaryKeepaliveCount;
    public final int stationaryJitterCount;
    public final int gapCount;
    public final String lastKnownErrorCode;
    public final boolean diagnosticLogExists;
    public final boolean trustedGpxExists;
    public final boolean partialGpxExists;
    public final long diagnosticLogBytes;
    public final long trustedGpxBytes;
    public final long partialGpxBytes;
    public final String diagnosticLogReadStatus;
    public final long diagnosticLastCompleteEventSeq;
    public final int diagnosticCompleteEventCount;
    public final boolean diagnosticEventSeqMatchesManifest;
    public final String recoveryState;

    public SessionManifest(String readStatus, File sessionDir, String sessionId,
                           long createdWallTimeMillis, long createdElapsedRealtimeNanos,
                           String completionState, String integrityState,
                           int schemaVersion, String strategyVersion,
                           String diagnosticLogFileName, String trustedGpxFileName,
                           String partialGpxFileName,
                           long lastEventSeq, long lastUpdatedWallTimeMillis,
                           int trackPointCount, int weakTrackPointCount,
                           int rawPointCount, int segmentCount,
                           double totalDistanceMeters, double movingTimeSeconds,
                           int stationaryKeepaliveCount, int stationaryJitterCount,
                           int gapCount, String lastKnownErrorCode,
                           boolean diagnosticLogExists, boolean trustedGpxExists,
                           boolean partialGpxExists,
                           long diagnosticLogBytes, long trustedGpxBytes,
                           long partialGpxBytes,
                           String diagnosticLogReadStatus,
                           long diagnosticLastCompleteEventSeq,
                           int diagnosticCompleteEventCount) {
        this.readStatus = readStatus;
        this.sessionDir = sessionDir;
        this.sessionId = sessionId;
        this.createdWallTimeMillis = createdWallTimeMillis;
        this.createdElapsedRealtimeNanos = createdElapsedRealtimeNanos;
        this.completionState = completionState;
        this.integrityState = integrityState;
        this.schemaVersion = schemaVersion;
        this.strategyVersion = strategyVersion;
        this.diagnosticLogFileName = diagnosticLogFileName;
        this.trustedGpxFileName = trustedGpxFileName;
        this.partialGpxFileName = partialGpxFileName;
        this.lastEventSeq = lastEventSeq;
        this.lastUpdatedWallTimeMillis = lastUpdatedWallTimeMillis;
        this.trackPointCount = trackPointCount;
        this.weakTrackPointCount = weakTrackPointCount;
        this.rawPointCount = rawPointCount;
        this.segmentCount = segmentCount;
        this.totalDistanceMeters = totalDistanceMeters;
        this.movingTimeSeconds = movingTimeSeconds;
        this.stationaryKeepaliveCount = stationaryKeepaliveCount;
        this.stationaryJitterCount = stationaryJitterCount;
        this.gapCount = gapCount;
        this.lastKnownErrorCode = lastKnownErrorCode;
        this.diagnosticLogExists = diagnosticLogExists;
        this.trustedGpxExists = trustedGpxExists;
        this.partialGpxExists = partialGpxExists;
        this.diagnosticLogBytes = diagnosticLogBytes;
        this.trustedGpxBytes = trustedGpxBytes;
        this.partialGpxBytes = partialGpxBytes;
        this.diagnosticLogReadStatus = diagnosticLogReadStatus;
        this.diagnosticLastCompleteEventSeq = diagnosticLastCompleteEventSeq;
        this.diagnosticCompleteEventCount = diagnosticCompleteEventCount;
        this.diagnosticEventSeqMatchesManifest = diagnosticLogExists
                && DiagnosticLogSummary.STATUS_OK.equals(diagnosticLogReadStatus)
                && lastEventSeq == diagnosticLastCompleteEventSeq;
        this.recoveryState = classifyRecoveryState();
    }

    private String classifyRecoveryState() {
        if (READ_MISSING_SESSION_JSON.equals(readStatus)) {
            return RECOVERY_MISSING_MANIFEST;
        }
        if (READ_INVALID_SESSION_JSON.equals(readStatus)) {
            return RECOVERY_INVALID_MANIFEST;
        }
        if (!diagnosticLogExists) {
            return RECOVERY_ABORTED;
        }
        if ("ERROR".equals(integrityState) || "ERROR".equals(completionState)) {
            return RECOVERY_ERROR;
        }
        if ("FINISHED".equals(completionState)) {
            return RECOVERY_FINISHED;
        }
        if ("ACTIVE".equals(completionState) || "INTERRUPTED".equals(completionState)) {
            return RECOVERY_INTERRUPTED;
        }
        return RECOVERY_UNKNOWN;
    }
}
