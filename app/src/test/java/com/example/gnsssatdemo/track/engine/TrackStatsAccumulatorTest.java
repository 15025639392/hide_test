package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TrackStatsAccumulatorTest {
    private final TrackStatsAccumulator stats = new TrackStatsAccumulator();

    @Test
    public void addAcceptedMovement_accumulatesDistanceAndMovingTime() {
        stats.addAcceptedMovement(new TrackDecisionResult("accept", "moving_good_fix",
                12.5, 8.0, 0L, 0, 0, false));
        stats.addAcceptedMovement(new TrackDecisionResult("accept", "moving_good_fix",
                2.5, 2.0, 0L, 0, 0, false));

        assertEquals(15.0, stats.getTotalDistanceMeters(), 0.0);
        assertEquals(10.0, stats.getMovingTimeSeconds(), 0.0);
    }

    @Test
    public void addStationaryDecision_accumulatesKeepaliveAndJitter() {
        stats.addStationaryDecision(new TrackDecisionResult("reject", "stationary_keepalive",
                0.0, 0.0, 1L, 1, 0, false));
        stats.addStationaryDecision(new TrackDecisionResult("reject", "stationary_jitter",
                0.0, 0.0, 1L, 0, 2, false));

        assertEquals(1, stats.getStationaryKeepaliveCount());
        assertEquals(2, stats.getStationaryJitterCount());
    }

    @Test
    public void reset_clearsAllCounters() {
        stats.addAcceptedMovement(new TrackDecisionResult("accept", "moving_good_fix",
                12.5, 8.0, 0L, 0, 0, false));
        stats.incrementGapCount();
        stats.incrementTransportCount();

        stats.reset();

        assertEquals(0.0, stats.getTotalDistanceMeters(), 0.0);
        assertEquals(0.0, stats.getMovingTimeSeconds(), 0.0);
        assertEquals(0, stats.getGapCount());
        assertEquals(0, stats.getTransportCount());
    }
}
