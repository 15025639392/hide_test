package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TrackStatsAccumulatorTest {
    private final TrackStatsAccumulator stats = new TrackStatsAccumulator();

    @Test
    public void addAcceptedMovement_accumulatesDistanceAndMovingTime() {
        stats.addAcceptedMovement(12.5, 8.0);
        stats.addAcceptedMovement(2.5, 2.0);

        assertEquals(15.0, stats.getTotalDistanceMeters(), 0.0);
        assertEquals(10.0, stats.getMovingTimeSeconds(), 0.0);
    }

    @Test
    public void reset_clearsAllCounters() {
        stats.addAcceptedMovement(12.5, 8.0);
        stats.incrementGapCount();
        stats.incrementTransportCount();
        stats.incrementStationaryKeepaliveCount();
        stats.incrementStationaryJitterCount();

        stats.reset();

        assertEquals(0.0, stats.getTotalDistanceMeters(), 0.0);
        assertEquals(0.0, stats.getMovingTimeSeconds(), 0.0);
        assertEquals(0, stats.getGapCount());
        assertEquals(0, stats.getTransportCount());
        assertEquals(0, stats.getStationaryKeepaliveCount());
        assertEquals(0, stats.getStationaryJitterCount());
    }

    @Test
    public void stationaryCounters_trackV3StationaryReasons() {
        stats.incrementStationaryKeepaliveCount();
        stats.incrementStationaryJitterCount();
        stats.incrementStationaryJitterCount();

        assertEquals(1, stats.getStationaryKeepaliveCount());
        assertEquals(2, stats.getStationaryJitterCount());
    }
}
