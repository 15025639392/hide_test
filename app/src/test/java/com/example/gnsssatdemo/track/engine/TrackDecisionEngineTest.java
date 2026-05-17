package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class TrackDecisionEngineTest {
    private final TrackDecisionEngine engine = new TrackDecisionEngine();

    @Test
    public void decide_acceptsGoodFirstFixAsAnchor() {
        TrackDecisionResult result = engine.decide(raw(1L, 20f, 29.0, 106.0, 1_000L),
                null, 0L, false);

        assertDecision(result, "anchor", "first_fix_good");
    }

    @Test
    public void decide_acceptsRelaxedFirstFixAsAnchor() {
        TrackDecisionResult result = engine.decide(raw(1L, 30f, 29.0, 106.0, 1_000L),
                null, 0L, false);

        assertDecision(result, "anchor", "first_fix_relaxed");
    }

    @Test
    public void decide_acceptsForcedWeakFirstFixOnlyInTestMode() {
        TrackDecisionResult normal = engine.decide(raw(1L, 45f, 29.0, 106.0, 1_000L),
                null, 0L, false);
        TrackDecisionResult forced = engine.decide(raw(1L, 45f, 29.0, 106.0, 1_000L),
                null, 0L, true);

        assertDecision(normal, "weak", "weak_first_fix");
        assertDecision(forced, "anchor", "forced_weak_first_fix");
    }

    @Test
    public void decide_marksWeakSignalAfterFirstTrackPoint() {
        TrackDecisionResult result = engine.decide(raw(2L, 31f, 29.0001, 106.0, 2_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "weak", "weak_signal_stage1");
    }

    @Test
    public void decide_rejectsNonPositiveDeltaTime() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.0001, 106.0, 1_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "reject", "non_positive_delta_time");
    }

    @Test
    public void decide_rejectsImpossibleSpeedJump() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.01, 106.0, 2_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "reject", "impossible_speed");
    }

    @Test
    public void decide_marksFirstSmallMoveAsStationaryKeepalive() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.000001, 106.0, 2_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "reject", "stationary_keepalive");
        assertEquals(2_000_000_000L, result.nextStationaryKeepaliveElapsedRealtimeNanos);
        assertEquals(1, result.stationaryKeepaliveIncrement);
        assertEquals(0, result.stationaryJitterIncrement);
    }

    @Test
    public void decide_marksRepeatedSmallMoveAsStationaryJitter() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.000001, 106.0, 2_000_000_000L),
                previous(), 1_500_000_000L, false);

        assertDecision(result, "reject", "stationary_jitter");
        assertEquals(1_500_000_000L, result.nextStationaryKeepaliveElapsedRealtimeNanos);
        assertEquals(0, result.stationaryKeepaliveIncrement);
        assertEquals(1, result.stationaryJitterIncrement);
    }

    @Test
    public void decide_acceptsPlausibleMovingPoint() {
        TrackDecisionResult result = engine.decide(raw(2L, 3f, 29.00018, 106.0, 11_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "accept", "moving_good_fix");
        assertTrue(result.distanceDeltaMeters > 15.0);
        assertTrue(result.distanceDeltaMeters < 25.0);
        assertEquals(10.0, result.movingTimeDeltaSeconds, 0.0001);
    }

    private void assertDecision(TrackDecisionResult result, String expectedResult, String expectedReason) {
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
