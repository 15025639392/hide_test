package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RestStateMachineTest {
    @Test
    public void apply_entersPausedAfterConservativeStillEvidence() {
        RestStateMachine machine = new RestStateMachine();
        TrackPoint previous = previousTrackPoint();

        RestStateMachine.Decision first = machine.apply(stationaryOutcome(),
                raw(2L, 29.000005, 10_000_000_000L, true, 0.0f),
                previous, stillSummaries());
        RestStateMachine.Decision second = machine.apply(stationaryOutcome(),
                raw(3L, 29.000006, 31_000_000_000L, true, 0.0f),
                previous, stillSummaries());

        assertEquals("reject", first.outcome.result);
        assertEquals(RestStateMachine.REASON_REST_CANDIDATE, first.outcome.reason);
        assertEquals(RestStateMachine.REASON_REST_PAUSED_KEEPALIVE, second.outcome.reason);
        assertTrue(machine.isPaused());
    }

    @Test
    public void onMotionSummary_movesPausedToProbingAndNearPointReturnsPaused() {
        RestStateMachine machine = pausedMachine();

        boolean changed = machine.onMotionSummary(motion(4L, 32_000_000_000L,
                33_000_000_000L, false));
        RestStateMachine.Decision decision = machine.apply(stationaryOutcome(),
                raw(4L, 29.000006, 34_000_000_000L, true, 0.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());

        assertTrue(changed);
        assertEquals(RestStateMachine.REASON_REST_PROBING_STATIONARY, decision.outcome.reason);
        assertTrue(machine.isPaused());
    }

    @Test
    public void apply_confirmsMovingAfterTwoProbingMovementPointsWithoutBackfill() {
        RestStateMachine machine = pausedMachine();
        machine.onMotionSummary(motion(4L, 32_000_000_000L, 33_000_000_000L, false));

        RestStateMachine.Decision first = machine.apply(movingOutcome(),
                raw(4L, 29.00025, 34_000_000_000L, true, 1.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());
        RestStateMachine.Decision second = machine.apply(movingOutcome(),
                raw(5L, 29.00035, 37_000_000_000L, true, 1.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());

        assertEquals("reject", first.outcome.result);
        assertEquals(RestStateMachine.REASON_REST_PROBING_CONFIRMING_MOVING,
                first.outcome.reason);
        assertEquals("accept", second.outcome.result);
        assertEquals(RestStateMachine.REASON_REST_MOVING_RECOVERY, second.outcome.reason);
        assertEquals(0.0, second.outcome.distanceDeltaMeters, 0.0);
        assertTrue(second.outcome.startsNewSegment);
        assertFalse(machine.isPaused());
        assertFalse(machine.isProbing());
    }

    @Test
    public void apply_doesNotConfirmMovingFromRejectedFarJump() {
        RestStateMachine machine = pausedMachine();
        machine.onMotionSummary(motion(4L, 32_000_000_000L, 33_000_000_000L, false));

        RestStateMachine.Decision first = machine.apply(impossibleJumpOutcome(),
                raw(4L, 29.00100, 34_000_000_000L, true, 0.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());
        RestStateMachine.Decision second = machine.apply(impossibleJumpOutcome(),
                raw(5L, 29.00110, 37_000_000_000L, true, 0.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());

        assertEquals("reject", first.outcome.result);
        assertEquals("impossible_speed", first.outcome.reason);
        assertEquals("reject", second.outcome.result);
        assertEquals("impossible_speed", second.outcome.reason);
        assertTrue(machine.isProbing());
    }

    @Test
    public void apply_doesNotEnterRestCandidateFromNonStationaryReject() {
        RestStateMachine machine = new RestStateMachine();

        RestStateMachine.Decision decision = machine.apply(nonPositiveDeltaOutcome(),
                raw(2L, 29.000005, 10_000_000_000L, true, 0.0f),
                previousTrackPoint(), stillSummaries());

        assertEquals("reject", decision.outcome.result);
        assertEquals("non_positive_delta_time", decision.outcome.reason);
        assertEquals(RestStateMachine.STATE_MOVING, machine.stateName());
    }

    @Test
    public void apply_keepsAnchorAfterRejectedJumpWhileResting() {
        RestStateMachine machine = pausedMachine();

        RestStateMachine.Decision jump = machine.apply(impossibleJumpOutcome(),
                raw(4L, 29.00100, 34_000_000_000L, true, 0.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());
        RestStateMachine.Decision next = machine.apply(movingOutcome(),
                raw(5L, 29.00110, 37_000_000_000L, true, 1.0f),
                previousTrackPoint(), Collections.<MotionSummary>emptyList());

        assertEquals("impossible_speed", jump.outcome.reason);
        assertTrue(machine.isProbing());
        assertEquals("reject", next.outcome.result);
        assertEquals(RestStateMachine.REASON_REST_PROBING_CONFIRMING_MOVING,
                next.outcome.reason);
    }

    private RestStateMachine pausedMachine() {
        RestStateMachine machine = new RestStateMachine();
        TrackPoint previous = previousTrackPoint();
        machine.apply(stationaryOutcome(), raw(2L, 29.000005, 10_000_000_000L,
                true, 0.0f), previous, stillSummaries());
        machine.apply(stationaryOutcome(), raw(3L, 29.000006, 31_000_000_000L,
                true, 0.0f), previous, stillSummaries());
        return machine;
    }

    private TrackDecisionResult stationaryOutcome() {
        return new TrackDecisionResult("reject", "stationary_keepalive",
                0.0, 0.0, 0L, 1, 0, false);
    }

    private TrackDecisionResult movingOutcome() {
        return new TrackDecisionResult("accept", "moving_good_fix",
                30.0, 3.0, 0L, 0, 0, false);
    }

    private TrackDecisionResult impossibleJumpOutcome() {
        return new TrackDecisionResult("reject", "impossible_speed",
                0.0, 0.0, 0L, 0, 0, false);
    }

    private TrackDecisionResult nonPositiveDeltaOutcome() {
        return new TrackDecisionResult("reject", "non_positive_delta_time",
                0.0, 0.0, 0L, 0, 0, false);
    }

    private TrackPoint previousTrackPoint() {
        return new TrackPoint(1L, 1L, 1L, 1L,
                29.0, 106.0, false, 0.0, 5f,
                false, 0f, false, 0f,
                1L, 1_000_000_000L, "anchor", "first_fix_good",
                0.0, 0.0, null);
    }

    private RawPoint raw(long rawPointId, double latitude, long elapsedRealtimeNanos,
                         boolean hasSpeed, float speedMetersPerSecond) {
        return new RawPoint(rawPointId, "gps", latitude, 106.0,
                false, 0.0, true, 5f,
                hasSpeed, speedMetersPerSecond, false, 0f,
                1L, true, elapsedRealtimeNanos, false, null);
    }

    private java.util.List<MotionSummary> stillSummaries() {
        return Arrays.asList(
                motion(1L, 9_000_000_000L, 11_000_000_000L, true),
                motion(2L, 30_000_000_000L, 32_000_000_000L, true));
    }

    private MotionSummary motion(long id, long firstNanos, long lastNanos, boolean still) {
        return new MotionSummary(id, firstNanos, lastNanos, 20,
                still ? 0.01 : 0.5, still ? 0.95 : 0.1, still,
                "TYPE_LINEAR_ACCELERATION");
    }
}
