package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class SessionLifecycleStateTest {
    private final SessionLifecycleState lifecycle = new SessionLifecycleState();

    @Test
    public void markActive_setsActiveCompletionState() {
        lifecycle.resetForStart();
        lifecycle.markActive();

        assertTrue(lifecycle.isActive());
        assertFalse(lifecycle.isFinished());
        assertEquals("ACTIVE", lifecycle.getCompletionState());
        assertEquals("OK", lifecycle.getIntegrityState());
    }

    @Test
    public void markFinished_finishesCleanly() {
        lifecycle.resetForStart();
        lifecycle.markActive();
        lifecycle.markFinished();

        assertFalse(lifecycle.isActive());
        assertTrue(lifecycle.isFinished());
        assertEquals("FINISHED", lifecycle.getCompletionState());
        assertEquals("OK", lifecycle.getIntegrityState());
    }

    @Test
    public void markIntegrityError_recordsErrorAndStopsActiveSession() {
        lifecycle.resetForStart();
        lifecycle.markActive();
        lifecycle.markIntegrityError("write_failed");

        assertFalse(lifecycle.isActive());
        assertFalse(lifecycle.isFinished());
        assertEquals("ERROR", lifecycle.getCompletionState());
        assertEquals("ERROR", lifecycle.getIntegrityState());
        assertEquals("write_failed", lifecycle.getLastErrorCode());
    }
}
