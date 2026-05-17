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

    public TrackPoint(long trackPointId, long sourceDecisionId, long segmentId, RawPoint rawPoint,
                      String decisionResult, String decisionReason,
                      double distanceDeltaMeters, double movingTimeDeltaSeconds) {
        this(trackPointId, rawPoint.rawPointId, sourceDecisionId, segmentId,
                rawPoint.latitude, rawPoint.longitude, rawPoint.hasAltitude, rawPoint.altitude,
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
        this.trackPointId = trackPointId;
        this.sourceRawPointId = sourceRawPointId;
        this.sourceDecisionId = sourceDecisionId;
        this.segmentId = segmentId;
        this.latitude = latitude;
        this.longitude = longitude;
        this.hasAltitude = hasAltitude;
        this.altitude = altitude;
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
    }
}
