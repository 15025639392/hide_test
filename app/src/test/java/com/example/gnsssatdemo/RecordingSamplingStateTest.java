package com.example.gnsssatdemo;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RecordingSamplingStateTest {
    @Test
    public void shouldUsePausedPolicy_requiresConsecutiveStationaryReasons() {
        RecordingSamplingState state = new RecordingSamplingState();

        state.onDecisionReason("stationary_anchor");
        state.onDecisionReason("stationary_anchor");
        assertTrue(state.shouldUsePausedPolicy());

        state.onDecisionReason("moving_good_fix");

        assertFalse(state.shouldUsePausedPolicy());
        assertEquals(0, state.consecutiveStationaryKeepaliveCount());
        assertEquals(0, state.consecutiveStationaryJitterCount());
    }

    @Test
    public void shouldUsePausedPolicy_doesNotUseJitterAlone() {
        RecordingSamplingState state = new RecordingSamplingState();

        for (int i = 0; i < 20; i++) {
            state.onDecisionReason("stationary_cloud_jitter");
        }

        assertFalse(state.shouldUsePausedPolicy());
    }

    @Test
    public void shouldUsePausedPolicy_treatsV3StationaryCloudAsStationary() {
        RecordingSamplingState state = new RecordingSamplingState();

        state.onDecisionReason("stationary_cloud_jitter");
        state.onDecisionReason("stationary_cloud_jitter");
        state.onDecisionReason("stationary_cloud_jitter");

        assertEquals(3, state.consecutiveStationaryJitterCount());
    }
}
