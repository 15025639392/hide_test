package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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
    public void decide_rejectsSustainedNonHikingMovementAsTransportSuspected() {
        TrackDecisionResult result = engine.decide(raw(2L, 5f, 29.0007, 106.0, 21_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "reject", "transport_suspected");
    }

    @Test
    public void decide_rejectsHighReportedSpeedAsTransportSuspected() {
        TrackDecisionResult result = engine.decide(raw(2L, 5f, 29.00035, 106.0,
                        11_000_000_000L, true, 4.0f),
                previous(), 0L, false);

        assertDecision(result, "reject", "transport_suspected");
    }

    @Test
    public void decide_rejectsReportedTransportEvenInsideAccuracyNoiseFloor() {
        TrackDecisionResult result = engine.decide(raw(2L, 30f, 29.000225, 106.0,
                        6_000_000_000L, true, 5.0f),
                previous(), 0L, false);

        assertDecision(result, "reject", "transport_suspected");
    }

    @Test
    public void decide_rejectsReasonableVehicleSpeedAsTransportSuspected() {
        TrackDecisionResult result = engine.decide(raw(2L, 5f, 29.002, 106.0,
                        11_000_000_000L, true, 20.0f),
                previous(), 0L, false);

        assertDecision(result, "reject", "transport_suspected");
    }

    @Test
    public void decide_ignoresHighReportedSpeedWhenImpliedPaceIsWalking() {
        TrackDecisionResult result = engine.decide(raw(2L, 5f, 29.00025, 106.0,
                        11_000_000_000L, true, 4.0f),
                previous(), 0L, false);

        assertDecision(result, "accept", "moving_good_fix");
    }

    @Test
    public void decide_rejectsImpossibleJumpBeforeReportedSpeedTransport() {
        TrackDecisionResult result = engine.decide(raw(2L, 5f, 29.01, 106.0,
                        2_000_000_000L, true, 4.0f),
                previous(), 0L, false);

        assertDecision(result, "reject", "impossible_speed");
    }

    @Test
    public void decide_acceptsGapRecoveryWithoutDistanceDelta() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.001, 106.0,
                        1_000_000_000L + TrackDecisionEngine.GAP_LINE_BREAK_NANOS + 1L),
                previous(), 0L, false);

        assertDecision(result, "accept", "gap_recovery");
        assertEquals(0.0, result.distanceDeltaMeters, 0.0);
        assertEquals(0.0, result.movingTimeDeltaSeconds, 0.0);
        assertTrue(result.startsNewSegment);
    }

    @Test
    public void decide_treatsAccuracyExplainableLongGapAsStationary() {
        TrackDecisionResult result = engine.decide(raw(2L, 20f, 29.0002, 106.0,
                        1_000_000_000L + TrackDecisionEngine.GAP_LINE_BREAK_NANOS + 1L),
                previous(), 0L, false);

        assertDecision(result, "reject", "stationary_keepalive");
        assertFalse(result.startsNewSegment);
    }

    @Test
    public void decide_acceptsGapRecoveryBeforeTransportSuspected() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 29.014, 106.0,
                        1_000_000_000L + 300_000_000_000L),
                previous(), 0L, false);

        assertDecision(result, "accept", "gap_recovery");
        assertEquals(0.0, result.distanceDeltaMeters, 0.0);
        assertEquals(0.0, result.movingTimeDeltaSeconds, 0.0);
        assertTrue(result.startsNewSegment);
    }

    @Test
    public void decide_rejectsImpossibleJumpEvenAcrossGap() {
        TrackDecisionResult result = engine.decide(raw(2L, 10f, 30.0, 106.0,
                        1_000_000_000L + TrackDecisionEngine.GAP_LINE_BREAK_NANOS + 1L),
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

    @Test
    public void isTransportRecoveryCandidate_acceptsStableWalkingPace() {
        assertTrue(engine.isTransportRecoveryCandidate(
                raw(1L, 5f, 29.0, 106.0, 1_000_000_000L),
                raw(2L, 5f, 29.0002, 106.0, 16_000_000_000L)));
    }

    @Test
    public void isTransportRecoveryCandidate_rejectsFastReportedSpeed() {
        assertFalse(engine.isTransportRecoveryCandidate(
                raw(1L, 5f, 29.0, 106.0, 1_000_000_000L),
                raw(2L, 5f, 29.0002, 106.0, 16_000_000_000L, true, 4.0f)));
    }

    @Test
    public void isTransportRecoveryCandidate_rejectsWeakAccuracy() {
        assertFalse(engine.isTransportRecoveryCandidate(
                raw(1L, 5f, 29.0, 106.0, 1_000_000_000L),
                raw(2L, 50f, 29.0002, 106.0, 16_000_000_000L)));
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
        return raw(rawPointId, accuracyMeters, latitude, longitude, elapsedRealtimeNanos,
                false, 0f);
    }

    private RawPoint raw(long rawPointId, float accuracyMeters,
                         double latitude, double longitude,
                         long elapsedRealtimeNanos, boolean hasSpeed, float speedMetersPerSecond) {
        return new RawPoint(rawPointId, "gps", latitude, longitude,
                false, 0.0, true, accuracyMeters,
                hasSpeed, speedMetersPerSecond, false, 0f,
                1L, true, elapsedRealtimeNanos, false, null);
    }
}
