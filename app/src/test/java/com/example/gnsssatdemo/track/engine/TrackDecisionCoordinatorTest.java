package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TrackDecisionCoordinatorTest {
    private final TrackDecisionCoordinator coordinator = new TrackDecisionCoordinator();

    @Test
    public void decide_tracksTransportModeAndRecovery() {
        TrackDecisionCoordinator.Decision suspected = coordinator.decide(
                raw(2L, 5f, 29.0007, 106.0, 21_000_000_000L),
                previous(), 0L, false);

        assertDecision(suspected.outcome, "reject", "transport_suspected");
        assertFalse(suspected.wasTransportMode);
        assertTrue(suspected.isTransportMode);
        assertTrue(suspected.enteredTransportMode);
        assertTrue(suspected.shouldAddTransportDisplayPoint);

        TrackDecisionCoordinator.Decision confirmed = coordinator.decide(
                raw(3L, 5f, 29.0008, 106.0, 26_000_000_000L),
                previous(), 0L, false);

        assertDecision(confirmed.outcome, "reject", "transport_confirmed");
        assertTrue(confirmed.wasTransportMode);
        assertTrue(confirmed.isTransportMode);
        assertFalse(confirmed.enteredTransportMode);
        assertTrue(confirmed.shouldAddTransportDisplayPoint);

        TrackDecisionCoordinator.Decision recovery = coordinator.decide(
                raw(4L, 5f, 29.0009, 106.0, 37_000_000_000L),
                previous(), 0L, false);

        assertDecision(recovery.outcome, "accept", "transport_recovery");
        assertTrue(recovery.wasTransportMode);
        assertFalse(recovery.isTransportMode);
        assertTrue(recovery.leftTransportMode);
        assertFalse(recovery.shouldAddTransportDisplayPoint);
        assertTrue(recovery.outcome.startsNewSegment);
        assertEquals(0.0, recovery.outcome.distanceDeltaMeters, 0.0);
    }

    private void assertDecision(TrackDecisionResult result, String expectedResult,
                                String expectedReason) {
        assertEquals(expectedResult, result.result);
        assertEquals(expectedReason, result.reason);
    }

    private TrackPoint previous() {
        return new TrackPoint(1L, 1L, 1L, 1L,
                29.0, 106.0, false, 0.0, 5f,
                false, 0f, false, 0f,
                1L, 1_000_000_000L, "anchor", "first_fix_good",
                0.0, 0.0, null);
    }

    private RawPoint raw(long rawPointId, float accuracyMeters,
                         double latitude, double longitude,
                         long elapsedRealtimeNanos) {
        return new RawPoint(rawPointId, "gps", latitude, longitude,
                false, 0.0, true, accuracyMeters,
                false, 0f, false, 0f,
                1L, true, elapsedRealtimeNanos, false, null);
    }
}
