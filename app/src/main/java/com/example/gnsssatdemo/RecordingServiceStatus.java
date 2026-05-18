package com.example.gnsssatdemo;

class RecordingServiceStatus {
    final boolean active;
    final String sessionId;
    final long rawPointCount;
    final int trackPointCount;
    final double totalDistanceMeters;
    final double totalAscentMeters;
    final String statusText;
    final boolean hasLocation;
    final double latitude;
    final double longitude;
    final float accuracyMeters;
    final boolean hasBearing;
    final float bearingDegrees;
    final String trackPolyline;

    RecordingServiceStatus(boolean active, String sessionId,
                           long rawPointCount, int trackPointCount,
                           double totalDistanceMeters, double totalAscentMeters,
                           String statusText, boolean hasLocation,
                           double latitude, double longitude, float accuracyMeters,
                           boolean hasBearing, float bearingDegrees,
                           String trackPolyline) {
        this.active = active;
        this.sessionId = sessionId;
        this.rawPointCount = rawPointCount;
        this.trackPointCount = trackPointCount;
        this.totalDistanceMeters = totalDistanceMeters;
        this.totalAscentMeters = totalAscentMeters;
        this.statusText = statusText;
        this.hasLocation = hasLocation;
        this.latitude = latitude;
        this.longitude = longitude;
        this.accuracyMeters = accuracyMeters;
        this.hasBearing = hasBearing;
        this.bearingDegrees = bearingDegrees;
        this.trackPolyline = trackPolyline;
    }
}
