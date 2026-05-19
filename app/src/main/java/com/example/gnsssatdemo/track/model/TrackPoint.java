package com.example.gnsssatdemo.track.model;

public class TrackPoint {
    public final long trackPointId;
    public final long sourceRawPointId;
    public final long sourceDecisionId;
    public final long segmentId;
    public final double latitude;
    public final double longitude;
    public final boolean hasAltitude;
    public final double altitude;
    public final boolean hasVerticalAccuracy;
    public final float verticalAccuracyMeters;
    public final float accuracyMeters;
    public final boolean hasSpeed;
    public final float speedMetersPerSecond;
    public final boolean hasBearing;
    public final float bearingDegrees;
    public final long timeMillis;
    public final long elapsedRealtimeNanos;
    public final String decisionResult;
    public final String decisionReason;
    public final double distanceDeltaMeters;
    public final double movingTimeDeltaSeconds;
    public final Long sourceGnssSnapshotId;
    public final boolean hasPressureSample;
    public final long pressureSampleElapsedRealtimeNanos;
    public final double pressureHpa;
    public final double rawBarometerAltitudeMeters;

    public TrackPoint(long trackPointId, long sourceDecisionId, long segmentId, RawPoint rawPoint,
                      String decisionResult, String decisionReason,
                      double distanceDeltaMeters, double movingTimeDeltaSeconds) {
        this(trackPointId, rawPoint.rawPointId, sourceDecisionId, segmentId,
                rawPoint.latitude, rawPoint.longitude, rawPoint.hasAltitude, rawPoint.altitude,
                rawPoint.hasVerticalAccuracy, rawPoint.verticalAccuracyMeters,
                rawPoint.accuracyMeters, rawPoint.hasSpeed, rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing, rawPoint.bearingDegrees, rawPoint.timeMillis,
                rawPoint.elapsedRealtimeNanos, decisionResult, decisionReason,
                distanceDeltaMeters, movingTimeDeltaSeconds, rawPoint.sourceGnssSnapshotId);
    }

    public TrackPoint(long trackPointId, long sourceRawPointId, long sourceDecisionId,
                      long segmentId, double latitude, double longitude,
                      boolean hasAltitude, double altitude, float accuracyMeters,
                      boolean hasSpeed, float speedMetersPerSecond,
                      boolean hasBearing, float bearingDegrees,
                      long timeMillis, long elapsedRealtimeNanos,
                      String decisionResult, String decisionReason,
                      double distanceDeltaMeters, double movingTimeDeltaSeconds,
                      Long sourceGnssSnapshotId) {
        this(trackPointId, sourceRawPointId, sourceDecisionId, segmentId, latitude, longitude,
                hasAltitude, altitude, false, 0f, accuracyMeters,
                hasSpeed, speedMetersPerSecond, hasBearing, bearingDegrees, timeMillis,
                elapsedRealtimeNanos, decisionResult, decisionReason, distanceDeltaMeters,
                movingTimeDeltaSeconds, sourceGnssSnapshotId, false, 0L, 0.0, 0.0);
    }

    public TrackPoint(long trackPointId, long sourceRawPointId, long sourceDecisionId,
                      long segmentId, double latitude, double longitude,
                      boolean hasAltitude, double altitude,
                      boolean hasVerticalAccuracy, float verticalAccuracyMeters,
                      float accuracyMeters,
                      boolean hasSpeed, float speedMetersPerSecond,
                      boolean hasBearing, float bearingDegrees,
                      long timeMillis, long elapsedRealtimeNanos,
                      String decisionResult, String decisionReason,
                      double distanceDeltaMeters, double movingTimeDeltaSeconds,
                      Long sourceGnssSnapshotId) {
        this(trackPointId, sourceRawPointId, sourceDecisionId, segmentId, latitude, longitude,
                hasAltitude, altitude, hasVerticalAccuracy, verticalAccuracyMeters,
                accuracyMeters, hasSpeed, speedMetersPerSecond, hasBearing, bearingDegrees,
                timeMillis, elapsedRealtimeNanos, decisionResult, decisionReason,
                distanceDeltaMeters, movingTimeDeltaSeconds, sourceGnssSnapshotId,
                false, 0L, 0.0, 0.0);
    }

    public TrackPoint(long trackPointId, long sourceRawPointId, long sourceDecisionId,
                      long segmentId, double latitude, double longitude,
                      boolean hasAltitude, double altitude,
                      boolean hasVerticalAccuracy, float verticalAccuracyMeters,
                      float accuracyMeters,
                      boolean hasSpeed, float speedMetersPerSecond,
                      boolean hasBearing, float bearingDegrees,
                      long timeMillis, long elapsedRealtimeNanos,
                      String decisionResult, String decisionReason,
                      double distanceDeltaMeters, double movingTimeDeltaSeconds,
                      Long sourceGnssSnapshotId,
                      boolean hasPressureSample, long pressureSampleElapsedRealtimeNanos,
                      double pressureHpa, double rawBarometerAltitudeMeters) {
        this.trackPointId = trackPointId;
        this.sourceRawPointId = sourceRawPointId;
        this.sourceDecisionId = sourceDecisionId;
        this.segmentId = segmentId;
        this.latitude = latitude;
        this.longitude = longitude;
        this.hasAltitude = hasAltitude;
        this.altitude = altitude;
        this.hasVerticalAccuracy = hasVerticalAccuracy;
        this.verticalAccuracyMeters = verticalAccuracyMeters;
        this.accuracyMeters = accuracyMeters;
        this.hasSpeed = hasSpeed;
        this.speedMetersPerSecond = speedMetersPerSecond;
        this.hasBearing = hasBearing;
        this.bearingDegrees = bearingDegrees;
        this.timeMillis = timeMillis;
        this.elapsedRealtimeNanos = elapsedRealtimeNanos;
        this.decisionResult = decisionResult;
        this.decisionReason = decisionReason;
        this.distanceDeltaMeters = distanceDeltaMeters;
        this.movingTimeDeltaSeconds = movingTimeDeltaSeconds;
        this.sourceGnssSnapshotId = sourceGnssSnapshotId;
        this.hasPressureSample = hasPressureSample;
        this.pressureSampleElapsedRealtimeNanos = pressureSampleElapsedRealtimeNanos;
        this.pressureHpa = pressureHpa;
        this.rawBarometerAltitudeMeters = rawBarometerAltitudeMeters;
    }
}
