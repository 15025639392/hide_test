package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TrackStrategyConfigTest {
    @Test
    public void defaultStage1_matchesPublishedCompatibilityConstants() {
        TrackStrategyConfig config = TrackStrategyConfig.defaultStage1();

        assertEquals(LocationValidator.START_TOLERANCE_NANOS, config.startToleranceNanos);
        assertEquals(LocationValidator.MAX_LOCATION_AGE_NANOS, config.maxLocationAgeNanos);
        assertEquals(LocationValidator.MAX_ACCURACY_METERS, config.maxAccuracyMeters, 0f);
        assertEquals(TrackDecisionEngine.IMPOSSIBLE_SPEED_METERS_PER_SECOND,
                config.impossibleSpeedMetersPerSecond, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_SUSPECTED_SPEED_METERS_PER_SECOND,
                config.transportSuspectedSpeedMetersPerSecond, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_SUSPECTED_MAX_REASONABLE_SPEED_METERS_PER_SECOND,
                config.transportSuspectedMaxReasonableSpeedMetersPerSecond, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_SUSPECTED_MIN_DISTANCE_METERS,
                config.transportSuspectedMinDistanceMeters, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_SUSPECTED_WITH_SPEED_MIN_DISTANCE_METERS,
                config.transportSuspectedWithSpeedMinDistanceMeters, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_SUSPECTED_MIN_DELTA_SECONDS,
                config.transportSuspectedMinDeltaSeconds, 0.0);
        assertEquals(TrackDecisionEngine.STATIONARY_KEEPALIVE_INTERVAL_NANOS,
                config.stationaryKeepaliveIntervalNanos);
        assertEquals(TrackDecisionEngine.GAP_LINE_BREAK_NANOS, config.gapLineBreakNanos);
        assertEquals(TrackDecisionEngine.TRANSPORT_RECOVERY_STABLE_NANOS,
                config.transportRecoveryStableNanos);
        assertEquals(TrackDecisionEngine.TRANSPORT_RECOVERY_MAX_SPEED_METERS_PER_SECOND,
                config.transportRecoveryMaxSpeedMetersPerSecond, 0.0);
        assertEquals(TrackDecisionEngine.TRANSPORT_RECOVERY_MIN_DISTANCE_METERS,
                config.transportRecoveryMinDistanceMeters, 0.0);
    }
}
