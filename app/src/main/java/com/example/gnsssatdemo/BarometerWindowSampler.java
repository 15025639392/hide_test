package com.example.gnsssatdemo;

import android.hardware.SensorManager;

import com.example.gnsssatdemo.track.model.BarometerWindow;

public class BarometerWindowSampler {
    public interface Listener {
        void onBarometerWindow(BarometerWindow window);
    }

    private static final long WINDOW_NANOS = 1_000_000_000L;

    private final Listener listener;
    private long nextWindowId;
    private long startElapsedRealtimeNanos;
    private long endElapsedRealtimeNanos;
    private int sampleCount;
    private double minPressureHpa;
    private double maxPressureHpa;
    private double pressureTotalHpa;
    private double firstPressureHpa;
    private double lastPressureHpa;
    private double minRawAltitudeMeters;
    private double maxRawAltitudeMeters;
    private double rawAltitudeTotalMeters;
    private double firstRawAltitudeMeters;
    private double lastRawAltitudeMeters;
    private int lastSensorAccuracy;

    public BarometerWindowSampler(Listener listener) {
        this.listener = listener;
    }

    public void reset() {
        nextWindowId = 0L;
        clearWindow();
    }

    public void addSample(float pressureHpa, int sensorAccuracy, long elapsedRealtimeNanos) {
        if (elapsedRealtimeNanos <= 0L || pressureHpa <= 0f
                || Float.isNaN(pressureHpa) || Float.isInfinite(pressureHpa)) {
            return;
        }
        double rawAltitudeMeters = SensorManager.getAltitude(
                SensorManager.PRESSURE_STANDARD_ATMOSPHERE, pressureHpa);
        if (sampleCount == 0) {
            startElapsedRealtimeNanos = elapsedRealtimeNanos;
            firstPressureHpa = pressureHpa;
            minPressureHpa = pressureHpa;
            maxPressureHpa = pressureHpa;
            firstRawAltitudeMeters = rawAltitudeMeters;
            minRawAltitudeMeters = rawAltitudeMeters;
            maxRawAltitudeMeters = rawAltitudeMeters;
        } else {
            minPressureHpa = Math.min(minPressureHpa, pressureHpa);
            maxPressureHpa = Math.max(maxPressureHpa, pressureHpa);
            minRawAltitudeMeters = Math.min(minRawAltitudeMeters, rawAltitudeMeters);
            maxRawAltitudeMeters = Math.max(maxRawAltitudeMeters, rawAltitudeMeters);
        }
        endElapsedRealtimeNanos = elapsedRealtimeNanos;
        sampleCount++;
        pressureTotalHpa += pressureHpa;
        rawAltitudeTotalMeters += rawAltitudeMeters;
        lastPressureHpa = pressureHpa;
        lastRawAltitudeMeters = rawAltitudeMeters;
        lastSensorAccuracy = sensorAccuracy;
        if (endElapsedRealtimeNanos - startElapsedRealtimeNanos >= WINDOW_NANOS) {
            emitWindow();
        }
    }

    public void flush() {
        if (sampleCount > 0) {
            emitWindow();
        }
    }

    private void emitWindow() {
        BarometerWindow window = new BarometerWindow(++nextWindowId,
                startElapsedRealtimeNanos, endElapsedRealtimeNanos, sampleCount,
                minPressureHpa, maxPressureHpa, pressureTotalHpa / sampleCount,
                lastPressureHpa - firstPressureHpa,
                minRawAltitudeMeters, maxRawAltitudeMeters,
                rawAltitudeTotalMeters / sampleCount,
                lastRawAltitudeMeters - firstRawAltitudeMeters,
                lastSensorAccuracy);
        clearWindow();
        listener.onBarometerWindow(window);
    }

    private void clearWindow() {
        startElapsedRealtimeNanos = 0L;
        endElapsedRealtimeNanos = 0L;
        sampleCount = 0;
        minPressureHpa = 0.0;
        maxPressureHpa = 0.0;
        pressureTotalHpa = 0.0;
        firstPressureHpa = 0.0;
        lastPressureHpa = 0.0;
        minRawAltitudeMeters = 0.0;
        maxRawAltitudeMeters = 0.0;
        rawAltitudeTotalMeters = 0.0;
        firstRawAltitudeMeters = 0.0;
        lastRawAltitudeMeters = 0.0;
        lastSensorAccuracy = 0;
    }
}
