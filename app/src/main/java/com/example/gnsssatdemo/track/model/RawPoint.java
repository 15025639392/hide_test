package com.example.gnsssatdemo.track.model;

import android.location.Location;
import android.os.Build;

public class RawPoint {
    public final long rawPointId;
    public final String provider;
    public final double latitude;
    public final double longitude;
    public final boolean hasAltitude;
    public final double altitude;
    public final boolean hasAccuracy;
    public final float accuracyMeters;
    public final boolean hasSpeed;
    public final float speedMetersPerSecond;
    public final boolean hasBearing;
    public final float bearingDegrees;
    public final long timeMillis;
    public final boolean hasElapsedRealtimeNanos;
    public final long elapsedRealtimeNanos;
    public final boolean mock;
    public final Long sourceGnssSnapshotId;

    public RawPoint(long rawPointId, Location location, Long sourceGnssSnapshotId) {
        this(rawPointId, location.getProvider(), location.getLatitude(), location.getLongitude(),
                location.hasAltitude(), location.hasAltitude() ? location.getAltitude() : 0.0,
                location.hasAccuracy(), location.hasAccuracy() ? location.getAccuracy() : 0f,
                location.hasSpeed(), location.hasSpeed() ? location.getSpeed() : 0f,
                location.hasBearing(), location.hasBearing() ? location.getBearing() : 0f,
                location.getTime(), location.getElapsedRealtimeNanos() > 0L,
                location.getElapsedRealtimeNanos(), isMock(location), sourceGnssSnapshotId);
    }

    public RawPoint(long rawPointId, String provider, double latitude, double longitude,
                    boolean hasAltitude, double altitude,
                    boolean hasAccuracy, float accuracyMeters,
                    boolean hasSpeed, float speedMetersPerSecond,
                    boolean hasBearing, float bearingDegrees,
                    long timeMillis, boolean hasElapsedRealtimeNanos, long elapsedRealtimeNanos,
                    boolean mock, Long sourceGnssSnapshotId) {
        this.rawPointId = rawPointId;
        this.provider = provider;
        this.latitude = latitude;
        this.longitude = longitude;
        this.hasAltitude = hasAltitude;
        this.altitude = altitude;
        this.hasAccuracy = hasAccuracy;
        this.accuracyMeters = accuracyMeters;
        this.hasSpeed = hasSpeed;
        this.speedMetersPerSecond = speedMetersPerSecond;
        this.hasBearing = hasBearing;
        this.bearingDegrees = bearingDegrees;
        this.timeMillis = timeMillis;
        this.hasElapsedRealtimeNanos = hasElapsedRealtimeNanos;
        this.elapsedRealtimeNanos = elapsedRealtimeNanos;
        this.mock = mock;
        this.sourceGnssSnapshotId = sourceGnssSnapshotId;
    }

    private static boolean isMock(Location location) {
        if (Build.VERSION.SDK_INT >= 31) {
            return location.isMock();
        }
        return location.isFromMockProvider();
    }
}
