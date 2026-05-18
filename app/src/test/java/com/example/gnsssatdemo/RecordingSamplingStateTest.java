package com.example.gnsssatdemo;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RecordingSamplingStateTest {
    @Test
    public void shouldUsePausedPolicy_requiresConsecutiveStationaryReasons() {
        RecordingSamplingState state = new RecordingSamplingState();

        state.onDecisionReason("stationary_keepalive");
        state.onDecisionReason("stationary_keepalive");
        assertTrue(state.shouldUsePausedPolicy());

        state.onDecisionReason("moving_good_fix");

        assertFalse(state.shouldUsePausedPolicy());
        assertEquals(0, state.consecutiveStationaryKeepaliveCount());
        assertEquals(0, state.consecutiveStationaryJitterCount());
    }

    @Test
    public void shouldUsePausedPolicy_usesConsecutiveJitterThreshold() {
        RecordingSamplingState state = new RecordingSamplingState();

        for (int i = 0; i < 9; i++) {
            state.onDecisionReason("stationary_jitter");
        }
        assertFalse(state.shouldUsePausedPolicy());

        state.onDecisionReason("stationary_jitter");

        assertTrue(state.shouldUsePausedPolicy());
    }

    @Test
    public void shouldUsePausedPolicy_treatsRestAnchorRefinementAsStationary() {
        RecordingSamplingState state = new RecordingSamplingState();

        state.onDecisionReason("stationary_anchor_refined");
        state.onDecisionReason("stationary_accel_supported_jitter");
        state.onDecisionReason("rest_candidate");
        state.onDecisionReason("rest_paused_keepalive");
        state.onDecisionReason("rest_probing_stationary");
        state.onDecisionReason("rest_probing_confirming_moving");

        assertEquals(6, state.consecutiveStationaryJitterCount());
    }
}
