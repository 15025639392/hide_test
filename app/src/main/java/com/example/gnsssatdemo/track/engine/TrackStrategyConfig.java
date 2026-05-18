package com.example.gnsssatdemo.track.engine;

public class TrackStrategyConfig {
    public final long startToleranceNanos;
    public final long maxLocationAgeNanos;
    public final float maxAccuracyMeters;
    public final float firstFixGoodAccuracyMeters;
    public final float firstFixRelaxedAccuracyMeters;
    public final float forcedWeakFirstFixAccuracyMeters;
    public final float firstFixWeakMaxAccuracyMeters;
    public final float ordinaryGoodAccuracyMeters;
    public final double stationaryMinDistanceMeters;
    public final double stationaryAccuracyMultiplier;
    public final double impossibleSpeedMetersPerSecond;
    public final double transportSuspectedSpeedMetersPerSecond;
    public final double transportSuspectedMaxReasonableSpeedMetersPerSecond;
    public final double transportSuspectedMinDistanceMeters;
    public final double transportSuspectedWithSpeedMinDistanceMeters;
    public final double transportSuspectedMinDeltaSeconds;
    public final long stationaryKeepaliveIntervalNanos;
    public final long gapLineBreakNanos;
    public final long transportRecoveryStableNanos;
    public final double transportRecoveryMaxSpeedMetersPerSecond;
    public final double transportRecoveryMinDistanceMeters;

    private TrackStrategyConfig(long startToleranceNanos,
                                long maxLocationAgeNanos,
                                float maxAccuracyMeters,
                                float firstFixGoodAccuracyMeters,
                                float firstFixRelaxedAccuracyMeters,
                                float forcedWeakFirstFixAccuracyMeters,
                                float firstFixWeakMaxAccuracyMeters,
                                float ordinaryGoodAccuracyMeters,
                                double stationaryMinDistanceMeters,
                                double stationaryAccuracyMultiplier,
                                double impossibleSpeedMetersPerSecond,
                                double transportSuspectedSpeedMetersPerSecond,
                                double transportSuspectedMaxReasonableSpeedMetersPerSecond,
                                double transportSuspectedMinDistanceMeters,
                                double transportSuspectedWithSpeedMinDistanceMeters,
                                double transportSuspectedMinDeltaSeconds,
                                long stationaryKeepaliveIntervalNanos,
                                long gapLineBreakNanos,
                                long transportRecoveryStableNanos,
                                double transportRecoveryMaxSpeedMetersPerSecond,
                                double transportRecoveryMinDistanceMeters) {
        this.startToleranceNanos = startToleranceNanos;
        this.maxLocationAgeNanos = maxLocationAgeNanos;
        this.maxAccuracyMeters = maxAccuracyMeters;
        this.firstFixGoodAccuracyMeters = firstFixGoodAccuracyMeters;
        this.firstFixRelaxedAccuracyMeters = firstFixRelaxedAccuracyMeters;
        this.forcedWeakFirstFixAccuracyMeters = forcedWeakFirstFixAccuracyMeters;
        this.firstFixWeakMaxAccuracyMeters = firstFixWeakMaxAccuracyMeters;
        this.ordinaryGoodAccuracyMeters = ordinaryGoodAccuracyMeters;
        this.stationaryMinDistanceMeters = stationaryMinDistanceMeters;
        this.stationaryAccuracyMultiplier = stationaryAccuracyMultiplier;
        this.impossibleSpeedMetersPerSecond = impossibleSpeedMetersPerSecond;
        this.transportSuspectedSpeedMetersPerSecond = transportSuspectedSpeedMetersPerSecond;
        this.transportSuspectedMaxReasonableSpeedMetersPerSecond =
                transportSuspectedMaxReasonableSpeedMetersPerSecond;
        this.transportSuspectedMinDistanceMeters = transportSuspectedMinDistanceMeters;
        this.transportSuspectedWithSpeedMinDistanceMeters =
                transportSuspectedWithSpeedMinDistanceMeters;
        this.transportSuspectedMinDeltaSeconds = transportSuspectedMinDeltaSeconds;
        this.stationaryKeepaliveIntervalNanos = stationaryKeepaliveIntervalNanos;
        this.gapLineBreakNanos = gapLineBreakNanos;
        this.transportRecoveryStableNanos = transportRecoveryStableNanos;
        this.transportRecoveryMaxSpeedMetersPerSecond = transportRecoveryMaxSpeedMetersPerSecond;
        this.transportRecoveryMinDistanceMeters = transportRecoveryMinDistanceMeters;
    }

    public static TrackStrategyConfig defaultStage1() {
        return new TrackStrategyConfig(
                1_000_000_000L,
                30_000_000_000L,
                80f,
                20f,
                30f,
                50f,
                80f,
                30f,
                5.0,
                1.5,
                12.0,
                3.5,
                45.0,
                60.0,
                20.0,
                10.0,
                30_000_000_000L,
                120_000_000_000L,
                15_000_000_000L,
                2.5,
                12.0);
    }
}
