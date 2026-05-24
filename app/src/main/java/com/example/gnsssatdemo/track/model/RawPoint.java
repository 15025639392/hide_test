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
    public final boolean hasVerticalAccuracy;
    public final float verticalAccuracyMeters;
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

    public RawPoint(long rawPointId, Location location) {
        this(rawPointId, location.getProvider(), location.getLatitude(), location.getLongitude(),
                location.hasAltitude(), location.hasAltitude() ? location.getAltitude() : 0.0,
                hasVerticalAccuracy(location), verticalAccuracyMeters(location),
                location.hasAccuracy(), location.hasAccuracy() ? location.getAccuracy() : 0f,
                location.hasSpeed(), location.hasSpeed() ? location.getSpeed() : 0f,
                location.hasBearing(), location.hasBearing() ? location.getBearing() : 0f,
                location.getTime(), location.getElapsedRealtimeNanos() > 0L,
                location.getElapsedRealtimeNanos(), isMock(location));
    }

    public RawPoint(long rawPointId, String provider, double latitude, double longitude,
                    boolean hasAltitude, double altitude,
                    boolean hasAccuracy, float accuracyMeters,
                    boolean hasSpeed, float speedMetersPerSecond,
                    boolean hasBearing, float bearingDegrees,
                    long timeMillis, boolean hasElapsedRealtimeNanos, long elapsedRealtimeNanos,
                    boolean mock) {
        this(rawPointId, provider, latitude, longitude,
                hasAltitude, altitude, false, 0f,
                hasAccuracy, accuracyMeters, hasSpeed, speedMetersPerSecond,
                hasBearing, bearingDegrees, timeMillis, hasElapsedRealtimeNanos,
                elapsedRealtimeNanos, mock);
    }

    public RawPoint(long rawPointId, String provider, double latitude, double longitude,
                    boolean hasAltitude, double altitude,
                    boolean hasVerticalAccuracy, float verticalAccuracyMeters,
                    boolean hasAccuracy, float accuracyMeters,
                    boolean hasSpeed, float speedMetersPerSecond,
                    boolean hasBearing, float bearingDegrees,
                    long timeMillis, boolean hasElapsedRealtimeNanos, long elapsedRealtimeNanos,
                    boolean mock) {
        this.rawPointId = rawPointId;
        this.provider = provider;
        this.latitude = latitude;
        this.longitude = longitude;
        this.hasAltitude = hasAltitude;
        this.altitude = altitude;
        this.hasVerticalAccuracy = hasVerticalAccuracy;
        this.verticalAccuracyMeters = verticalAccuracyMeters;
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
    }

    private static boolean isMock(Location location) {
        if (Build.VERSION.SDK_INT >= 31) {
            return location.isMock();
        }
        return location.isFromMockProvider();
    }

    private static boolean hasVerticalAccuracy(Location location) {
        return Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy();
    }

    private static float verticalAccuracyMeters(Location location) {
        return hasVerticalAccuracy(location) ? location.getVerticalAccuracyMeters() : 0f;
    }
}
