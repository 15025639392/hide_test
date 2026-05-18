package com.example.gnsssatdemo;

import android.hardware.Sensor;
import android.hardware.SensorEvent;

import com.example.gnsssatdemo.track.model.MotionSummary;

public class AccelerometerMotionSampler {
    public interface Listener {
        void onMotionSummary(MotionSummary summary);
    }

    private static final long WINDOW_NANOS = 1_000_000_000L;
    private static final double GRAVITY_EARTH = 9.80665;
    private static final int MIN_STILL_SAMPLE_COUNT = 5;
    private static final double STILL_RMS_REFERENCE_MPS2 = 0.30;
    private static final double STILL_SCORE_THRESHOLD = 0.70;

    private final Listener listener;
    private long nextMotionSummaryId;
    private long firstElapsedRealtimeNanos;
    private long lastElapsedRealtimeNanos;
    private int sampleCount;
    private double dynamicAccelSquaredTotal;
    private String sourceSensorType = "";

    public AccelerometerMotionSampler(Listener listener) {
        this.listener = listener;
    }

    public void reset() {
        nextMotionSummaryId = 0L;
        clearWindow();
    }

    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.values == null || event.values.length < 3) {
            return;
        }
        addSample(event.sensor.getType(), event.timestamp,
                event.values[0], event.values[1], event.values[2]);
    }

    public void addSample(int sensorType, long elapsedRealtimeNanos,
                          float x, float y, float z) {
        if (elapsedRealtimeNanos <= 0L) {
            return;
        }
        double dynamicAccel = dynamicAccel(sensorType, x, y, z);
        if (sampleCount == 0) {
            firstElapsedRealtimeNanos = elapsedRealtimeNanos;
            sourceSensorType = sensorTypeName(sensorType);
        }
        lastElapsedRealtimeNanos = elapsedRealtimeNanos;
        sampleCount++;
        dynamicAccelSquaredTotal += dynamicAccel * dynamicAccel;
        if (lastElapsedRealtimeNanos - firstElapsedRealtimeNanos >= WINDOW_NANOS) {
            emitWindow();
        }
    }

    public void flush() {
        if (sampleCount > 0) {
            emitWindow();
        }
    }

    private double dynamicAccel(int sensorType, float x, float y, float z) {
        double norm = Math.sqrt(x * x + y * y + z * z);
        if (sensorType == Sensor.TYPE_ACCELEROMETER) {
            return Math.abs(norm - GRAVITY_EARTH);
        }
        return norm;
    }

    private void emitWindow() {
        double rms = Math.sqrt(dynamicAccelSquaredTotal / sampleCount);
        double stillScore = clamp01(1.0 - rms / STILL_RMS_REFERENCE_MPS2);
        boolean deviceStill = sampleCount >= MIN_STILL_SAMPLE_COUNT
                && stillScore >= STILL_SCORE_THRESHOLD;
        MotionSummary summary = new MotionSummary(++nextMotionSummaryId,
                firstElapsedRealtimeNanos, lastElapsedRealtimeNanos, sampleCount,
                rms, stillScore, deviceStill, sourceSensorType);
        clearWindow();
        listener.onMotionSummary(summary);
    }

    private void clearWindow() {
        firstElapsedRealtimeNanos = 0L;
        lastElapsedRealtimeNanos = 0L;
        sampleCount = 0;
        dynamicAccelSquaredTotal = 0.0;
        sourceSensorType = "";
    }

    private double clamp01(double value) {
        if (value < 0.0) {
            return 0.0;
        }
        if (value > 1.0) {
            return 1.0;
        }
        return value;
    }

    private String sensorTypeName(int sensorType) {
        if (sensorType == Sensor.TYPE_LINEAR_ACCELERATION) {
            return "TYPE_LINEAR_ACCELERATION";
        }
        if (sensorType == Sensor.TYPE_ACCELEROMETER) {
            return "TYPE_ACCELEROMETER";
        }
        return "TYPE_" + sensorType;
    }
}
