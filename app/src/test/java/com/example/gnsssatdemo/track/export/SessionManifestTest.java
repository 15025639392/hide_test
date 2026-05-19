package com.example.gnsssatdemo.track.export;

import org.junit.Test;

import java.io.File;

import static org.junit.Assert.assertEquals;

public class SessionManifestTest {
    @Test
    public void recoveryState_finishedWhenManifestOkAndCompletionFinished() {
        assertEquals(SessionManifest.RECOVERY_FINISHED,
                manifest(SessionManifest.READ_OK, "FINISHED", "OK", true).recoveryState);
    }

    @Test
    public void recoveryState_interruptedWhenManifestStillActive() {
        assertEquals(SessionManifest.RECOVERY_INTERRUPTED,
                manifest(SessionManifest.READ_OK, "ACTIVE", "OK", true).recoveryState);
    }

    @Test
    public void recoveryState_interruptedWhenManifestMarkedInterrupted() {
        assertEquals(SessionManifest.RECOVERY_INTERRUPTED,
                manifest(SessionManifest.READ_OK, "INTERRUPTED", "OK", true).recoveryState);
    }

    @Test
    public void recoveryState_errorWhenCompletionOrIntegrityError() {
        assertEquals(SessionManifest.RECOVERY_ERROR,
                manifest(SessionManifest.READ_OK, "ERROR", "OK", true).recoveryState);
        assertEquals(SessionManifest.RECOVERY_ERROR,
                manifest(SessionManifest.READ_OK, "FINISHED", "ERROR", true).recoveryState);
    }

    @Test
    public void recoveryState_abortedWhenDiagnosticLogMissing() {
        assertEquals(SessionManifest.RECOVERY_ABORTED,
                manifest(SessionManifest.READ_OK, "FINISHED", "OK", false).recoveryState);
    }

    @Test
    public void recoveryState_manifestReadProblemsAreExplicit() {
        assertEquals(SessionManifest.RECOVERY_MISSING_MANIFEST,
                manifest(SessionManifest.READ_MISSING_SESSION_JSON, "", "", true).recoveryState);
        assertEquals(SessionManifest.RECOVERY_INVALID_MANIFEST,
                manifest(SessionManifest.READ_INVALID_SESSION_JSON, "", "", true).recoveryState);
    }

    private SessionManifest manifest(String readStatus, String completionState,
                                     String integrityState, boolean diagnosticExists) {
        return new SessionManifest(readStatus, new File("/tmp/session"), "session",
                0L, 0L, completionState, integrityState, 1,
                "stage1-gnss-track-v1", "diagnostic.jsonl", "track.gpx", "partial.gpx",
                1L, 1L, 0, 0, 0, 1, 0.0, 0.0,
                -1.0, "NONE", -1.0, 0, 0, -1.0, 0, 0, 0, 0, 0, "",
                diagnosticExists, false, false, diagnosticExists ? 10L : 0L, 0L, 0L,
                diagnosticExists ? DiagnosticLogSummary.STATUS_OK : DiagnosticLogSummary.STATUS_MISSING,
                diagnosticExists ? 1L : 0L,
                diagnosticExists ? 1 : 0);
    }
}
