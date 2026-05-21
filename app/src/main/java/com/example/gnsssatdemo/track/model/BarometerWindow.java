package com.example.gnsssatdemo.track.model;

public class BarometerWindow {
    public final long barometerWindowId;
    public final long startElapsedRealtimeNanos;
    public final long endElapsedRealtimeNanos;
    public final int sampleCount;
    public final double minPressureHpa;
    public final double maxPressureHpa;
    public final double avgPressureHpa;
    public final double deltaPressureHpa;
    public final double minRawAltitudeMeters;
    public final double maxRawAltitudeMeters;
    public final double avgRawAltitudeMeters;
    public final double deltaRawAltitudeMeters;
    public final int lastSensorAccuracy;

    public BarometerWindow(long barometerWindowId,
                           long startElapsedRealtimeNanos,
                           long endElapsedRealtimeNanos,
                           int sampleCount,
                           double minPressureHpa,
                           double maxPressureHpa,
                           double avgPressureHpa,
                           double deltaPressureHpa,
                           double minRawAltitudeMeters,
                           double maxRawAltitudeMeters,
                           double avgRawAltitudeMeters,
                           double deltaRawAltitudeMeters,
                           int lastSensorAccuracy) {
        this.barometerWindowId = barometerWindowId;
        this.startElapsedRealtimeNanos = startElapsedRealtimeNanos;
        this.endElapsedRealtimeNanos = endElapsedRealtimeNanos;
        this.sampleCount = sampleCount;
        this.minPressureHpa = minPressureHpa;
        this.maxPressureHpa = maxPressureHpa;
        this.avgPressureHpa = avgPressureHpa;
        this.deltaPressureHpa = deltaPressureHpa;
        this.minRawAltitudeMeters = minRawAltitudeMeters;
        this.maxRawAltitudeMeters = maxRawAltitudeMeters;
        this.avgRawAltitudeMeters = avgRawAltitudeMeters;
        this.deltaRawAltitudeMeters = deltaRawAltitudeMeters;
        this.lastSensorAccuracy = lastSensorAccuracy;
    }
}
