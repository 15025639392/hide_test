package com.example.gnsssatdemo.track.engine;

public class TrackTrustConfig {
    public final long startToleranceNanos;
    public final float maxIntakeAccuracyMeters;
    public final float firstFixGoodAccuracyMeters;
    public final float firstFixRelaxedAccuracyMeters;
    public final float weakCloudAccuracyMeters;
    public final double stationaryDistanceMeters;
    public final double stationaryAccuracyMultiplier;
    public final double impossibleSpeedMetersPerSecond;
    public final double transportSuspectedSpeedMetersPerSecond;
    public final double transportSuspectedMinDistanceMeters;
    public final long gapLineBreakNanos;
    public final int stationaryCloudMinSamples;
    public final int movingCloudMinSamples;
    public final int recoveryCloudMinSamples;
    public final double stationaryCloudMinRadiusMeters;
    public final double movingCloudMinRadiusMeters;
    public final double recoveryCloudMinRadiusMeters;
    public final double startCloudMinWeight;
    public final double stationaryCloudMinWeight;
    public final double movingCloudMinWeight;
    public final double recoveryCloudMinWeight;
    public final double cloudTemporalDecaySeconds;

    private TrackTrustConfig(long startToleranceNanos,
                             float maxIntakeAccuracyMeters,
                             float firstFixGoodAccuracyMeters,
                             float firstFixRelaxedAccuracyMeters,
                             float weakCloudAccuracyMeters,
                             double stationaryDistanceMeters,
                             double stationaryAccuracyMultiplier,
                             double impossibleSpeedMetersPerSecond,
                             double transportSuspectedSpeedMetersPerSecond,
                             double transportSuspectedMinDistanceMeters,
                             long gapLineBreakNanos,
                             int stationaryCloudMinSamples,
                             int movingCloudMinSamples,
                             int recoveryCloudMinSamples,
                             double stationaryCloudMinRadiusMeters,
                             double movingCloudMinRadiusMeters,
                             double recoveryCloudMinRadiusMeters,
                             double startCloudMinWeight,
                             double stationaryCloudMinWeight,
                             double movingCloudMinWeight,
                             double recoveryCloudMinWeight,
                             double cloudTemporalDecaySeconds) {
        this.startToleranceNanos = startToleranceNanos;
        this.maxIntakeAccuracyMeters = maxIntakeAccuracyMeters;
        this.firstFixGoodAccuracyMeters = firstFixGoodAccuracyMeters;
        this.firstFixRelaxedAccuracyMeters = firstFixRelaxedAccuracyMeters;
        this.weakCloudAccuracyMeters = weakCloudAccuracyMeters;
        this.stationaryDistanceMeters = stationaryDistanceMeters;
        this.stationaryAccuracyMultiplier = stationaryAccuracyMultiplier;
        this.impossibleSpeedMetersPerSecond = impossibleSpeedMetersPerSecond;
        this.transportSuspectedSpeedMetersPerSecond = transportSuspectedSpeedMetersPerSecond;
        this.transportSuspectedMinDistanceMeters = transportSuspectedMinDistanceMeters;
        this.gapLineBreakNanos = gapLineBreakNanos;
        this.stationaryCloudMinSamples = stationaryCloudMinSamples;
        this.movingCloudMinSamples = movingCloudMinSamples;
        this.recoveryCloudMinSamples = recoveryCloudMinSamples;
        this.stationaryCloudMinRadiusMeters = stationaryCloudMinRadiusMeters;
        this.movingCloudMinRadiusMeters = movingCloudMinRadiusMeters;
        this.recoveryCloudMinRadiusMeters = recoveryCloudMinRadiusMeters;
        this.startCloudMinWeight = startCloudMinWeight;
        this.stationaryCloudMinWeight = stationaryCloudMinWeight;
        this.movingCloudMinWeight = movingCloudMinWeight;
        this.recoveryCloudMinWeight = recoveryCloudMinWeight;
        this.cloudTemporalDecaySeconds = cloudTemporalDecaySeconds;
    }

    public static TrackTrustConfig defaultV3() {
        return new TrackTrustConfig(
                SamplingIntake.START_TOLERANCE_NANOS,
                SamplingIntake.MAX_ACCURACY_METERS,
                TrackTrustEngine.FIRST_FIX_GOOD_ACCURACY_METERS,
                TrackTrustEngine.FIRST_FIX_RELAXED_ACCURACY_METERS,
                TrackTrustEngine.WEAK_CLOUD_ACCURACY_METERS,
                TrackTrustEngine.STATIONARY_DISTANCE_METERS,
                TrackTrustEngine.STATIONARY_ACCURACY_MULTIPLIER,
                TrackTrustEngine.IMPOSSIBLE_SPEED_METERS_PER_SECOND,
                TrackTrustEngine.TRANSPORT_SPEED_METERS_PER_SECOND,
                TrackTrustEngine.TRANSPORT_MIN_DISTANCE_METERS,
                TrackTrustEngine.GAP_NANOS,
                TrackCloudWindow.STATIONARY_MIN_SAMPLES,
                TrackCloudWindow.MOVING_MIN_SAMPLES,
                TrackCloudWindow.RECOVERY_MIN_SAMPLES,
                TrackCloudWindow.STATIONARY_MIN_RADIUS_METERS,
                TrackCloudWindow.MOVING_MIN_RADIUS_METERS,
                TrackCloudWindow.RECOVERY_MIN_RADIUS_METERS,
                TrackCloudWindow.START_MIN_WEIGHT,
                TrackCloudWindow.STATIONARY_MIN_WEIGHT,
                TrackCloudWindow.MOVING_MIN_WEIGHT,
                TrackCloudWindow.RECOVERY_MIN_WEIGHT,
                TrackCloudWindow.TEMPORAL_DECAY_SECONDS);
    }
}
