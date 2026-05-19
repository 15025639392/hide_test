package com.example.gnsssatdemo;

class RecordingServiceStatus {
    final boolean active;
    final String sessionId;
    final long rawPointCount;
    final int trackPointCount;
    final double totalDistanceMeters;
    final double totalAscentMeters;
    final double barometerTotalAscentMeters;
    final double gnssTotalAscentMeters;
    final int barometerAscentSampleCount;
    final int gnssAscentSampleCount;
    final int barometerAscentRejectedSampleCount;
    final int gnssAscentRejectedSampleCount;
    final String statusText;
    final boolean hasLocation;
    final double latitude;
    final double longitude;
    final float accuracyMeters;
    final boolean hasSpeed;
    final float speedMetersPerSecond;
    final boolean hasBearing;
    final float bearingDegrees;
    final String trackPolyline;
    final String ascentSource;
    final boolean pressureSensorAvailable;
    final long pressureSampleCount;
    final boolean barometerCalibrated;
    final double barometerAltitudeMeters;
    final double rawBarometerAltitudeMeters;

    RecordingServiceStatus(boolean active, String sessionId,
                           long rawPointCount, int trackPointCount,
                           double totalDistanceMeters, double totalAscentMeters,
                           double barometerTotalAscentMeters, double gnssTotalAscentMeters,
                           int barometerAscentSampleCount, int gnssAscentSampleCount,
                           int barometerAscentRejectedSampleCount,
                           int gnssAscentRejectedSampleCount,
                           String statusText, boolean hasLocation,
                           double latitude, double longitude, float accuracyMeters,
                           boolean hasSpeed, float speedMetersPerSecond,
                           boolean hasBearing, float bearingDegrees,
                           String trackPolyline, String ascentSource,
                           boolean pressureSensorAvailable, long pressureSampleCount,
                           boolean barometerCalibrated, double barometerAltitudeMeters,
                           double rawBarometerAltitudeMeters) {
        this.active = active;
        this.sessionId = sessionId;
        this.rawPointCount = rawPointCount;
        this.trackPointCount = trackPointCount;
        this.totalDistanceMeters = totalDistanceMeters;
        this.totalAscentMeters = totalAscentMeters;
        this.barometerTotalAscentMeters = barometerTotalAscentMeters;
        this.gnssTotalAscentMeters = gnssTotalAscentMeters;
        this.barometerAscentSampleCount = barometerAscentSampleCount;
        this.gnssAscentSampleCount = gnssAscentSampleCount;
        this.barometerAscentRejectedSampleCount = barometerAscentRejectedSampleCount;
        this.gnssAscentRejectedSampleCount = gnssAscentRejectedSampleCount;
        this.statusText = statusText;
        this.hasLocation = hasLocation;
        this.latitude = latitude;
        this.longitude = longitude;
        this.accuracyMeters = accuracyMeters;
        this.hasSpeed = hasSpeed;
        this.speedMetersPerSecond = speedMetersPerSecond;
        this.hasBearing = hasBearing;
        this.bearingDegrees = bearingDegrees;
        this.trackPolyline = trackPolyline;
        this.ascentSource = ascentSource;
        this.pressureSensorAvailable = pressureSensorAvailable;
        this.pressureSampleCount = pressureSampleCount;
        this.barometerCalibrated = barometerCalibrated;
        this.barometerAltitudeMeters = barometerAltitudeMeters;
        this.rawBarometerAltitudeMeters = rawBarometerAltitudeMeters;
    }
}
