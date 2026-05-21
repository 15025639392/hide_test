package com.example.gnsssatdemo;

import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorManager;

import com.example.gnsssatdemo.track.model.DeviceMotionWindow;

public class DeviceMotionWindowSampler {
    public interface Listener {
        void onDeviceMotionWindow(DeviceMotionWindow window);
    }

    private static final long WINDOW_NANOS = 1_000_000_000L;
    private static final double GRAVITY_EARTH = 9.80665;

    private final Listener listener;
    private final float[] orientation = new float[3];
    private long nextWindowId;
    private long startElapsedRealtimeNanos;
    private long endElapsedRealtimeNanos;
    private int linearAccelerationSampleCount;
    private int accelerometerSampleCount;
    private int gyroscopeSampleCount;
    private int rotationVectorSampleCount;
    private double linearAccelerationSquaredTotal;
    private double linearAccelerationMax;
    private double accelerometerDynamicSquaredTotal;
    private double accelerometerDynamicMax;
    private double gyroscopeSquaredTotal;
    private double gyroscopeMax;
    private boolean hasFirstOrientation;
    private double firstYawDegrees;
    private double firstPitchDegrees;
    private double firstRollDegrees;
    private double lastYawDegrees;
    private double lastPitchDegrees;
    private double lastRollDegrees;
    private int stepDetectorCount;
    private boolean hasStepCounterBaseline;
    private int stepCounterBaseline;
    private int lastStepCounter;
    private boolean stepCounterAvailable;

    public DeviceMotionWindowSampler(Listener listener) {
        this.listener = listener;
    }

    public void reset() {
        nextWindowId = 0L;
        hasStepCounterBaseline = false;
        stepCounterBaseline = 0;
        lastStepCounter = 0;
        clearWindow();
    }

    public void onSensorChanged(SensorEvent event) {
        if (event == null || event.sensor == null || event.values == null) {
            return;
        }
        long timestamp = event.timestamp;
        if (timestamp <= 0L) {
            return;
        }
        if (startElapsedRealtimeNanos == 0L) {
            startElapsedRealtimeNanos = timestamp;
        }
        endElapsedRealtimeNanos = timestamp;
        int sensorType = event.sensor.getType();
        if (sensorType == Sensor.TYPE_LINEAR_ACCELERATION && event.values.length >= 3) {
            double norm = norm(event.values[0], event.values[1], event.values[2]);
            linearAccelerationSampleCount++;
            linearAccelerationSquaredTotal += norm * norm;
            linearAccelerationMax = Math.max(linearAccelerationMax, norm);
        } else if (sensorType == Sensor.TYPE_ACCELEROMETER && event.values.length >= 3) {
            double dynamic = Math.abs(norm(event.values[0], event.values[1], event.values[2])
                    - GRAVITY_EARTH);
            accelerometerSampleCount++;
            accelerometerDynamicSquaredTotal += dynamic * dynamic;
            accelerometerDynamicMax = Math.max(accelerometerDynamicMax, dynamic);
        } else if (sensorType == Sensor.TYPE_GYROSCOPE && event.values.length >= 3) {
            double norm = norm(event.values[0], event.values[1], event.values[2]);
            gyroscopeSampleCount++;
            gyroscopeSquaredTotal += norm * norm;
            gyroscopeMax = Math.max(gyroscopeMax, norm);
        } else if (sensorType == Sensor.TYPE_ROTATION_VECTOR) {
            addRotationVector(event.values);
        } else if (sensorType == Sensor.TYPE_STEP_DETECTOR) {
            stepDetectorCount++;
        } else if (sensorType == Sensor.TYPE_STEP_COUNTER && event.values.length > 0) {
            int steps = Math.round(event.values[0]);
            if (!hasStepCounterBaseline) {
                hasStepCounterBaseline = true;
                stepCounterBaseline = steps;
            }
            lastStepCounter = steps;
            stepCounterAvailable = true;
        }
        if (endElapsedRealtimeNanos - startElapsedRealtimeNanos >= WINDOW_NANOS) {
            emitWindow();
        }
    }

    public void flush() {
        if (hasWindowSamples()) {
            emitWindow();
        }
    }

    private void addRotationVector(float[] values) {
        float[] matrix = new float[9];
        SensorManager.getRotationMatrixFromVector(matrix, values);
        SensorManager.getOrientation(matrix, orientation);
        double yaw = Math.toDegrees(orientation[0]);
        double pitch = Math.toDegrees(orientation[1]);
        double roll = Math.toDegrees(orientation[2]);
        if (!hasFirstOrientation) {
            hasFirstOrientation = true;
            firstYawDegrees = yaw;
            firstPitchDegrees = pitch;
            firstRollDegrees = roll;
        }
        lastYawDegrees = yaw;
        lastPitchDegrees = pitch;
        lastRollDegrees = roll;
        rotationVectorSampleCount++;
    }

    private void emitWindow() {
        int stepCounterDelta = stepCounterAvailable
                ? Math.max(0, lastStepCounter - stepCounterBaseline) : 0;
        DeviceMotionWindow window = new DeviceMotionWindow(++nextWindowId,
                startElapsedRealtimeNanos, endElapsedRealtimeNanos,
                linearAccelerationSampleCount, accelerometerSampleCount,
                gyroscopeSampleCount, rotationVectorSampleCount,
                rms(linearAccelerationSquaredTotal, linearAccelerationSampleCount),
                linearAccelerationMax,
                rms(accelerometerDynamicSquaredTotal, accelerometerSampleCount),
                accelerometerDynamicMax,
                rms(gyroscopeSquaredTotal, gyroscopeSampleCount),
                gyroscopeMax,
                hasFirstOrientation ? angleDelta(firstYawDegrees, lastYawDegrees) : 0.0,
                hasFirstOrientation ? lastPitchDegrees - firstPitchDegrees : 0.0,
                hasFirstOrientation ? lastRollDegrees - firstRollDegrees : 0.0,
                stepDetectorCount, stepCounterDelta, stepCounterAvailable);
        clearWindow();
        if (stepCounterAvailable) {
            stepCounterBaseline = lastStepCounter;
            hasStepCounterBaseline = true;
        }
        listener.onDeviceMotionWindow(window);
    }

    private boolean hasWindowSamples() {
        return linearAccelerationSampleCount > 0 || accelerometerSampleCount > 0
                || gyroscopeSampleCount > 0 || rotationVectorSampleCount > 0
                || stepDetectorCount > 0 || stepCounterAvailable;
    }

    private void clearWindow() {
        startElapsedRealtimeNanos = 0L;
        endElapsedRealtimeNanos = 0L;
        linearAccelerationSampleCount = 0;
        accelerometerSampleCount = 0;
        gyroscopeSampleCount = 0;
        rotationVectorSampleCount = 0;
        linearAccelerationSquaredTotal = 0.0;
        linearAccelerationMax = 0.0;
        accelerometerDynamicSquaredTotal = 0.0;
        accelerometerDynamicMax = 0.0;
        gyroscopeSquaredTotal = 0.0;
        gyroscopeMax = 0.0;
        hasFirstOrientation = false;
        firstYawDegrees = 0.0;
        firstPitchDegrees = 0.0;
        firstRollDegrees = 0.0;
        lastYawDegrees = 0.0;
        lastPitchDegrees = 0.0;
        lastRollDegrees = 0.0;
        stepDetectorCount = 0;
        stepCounterAvailable = false;
    }

    private double norm(float x, float y, float z) {
        return Math.sqrt(x * x + y * y + z * z);
    }

    private double rms(double squaredTotal, int sampleCount) {
        return sampleCount <= 0 ? 0.0 : Math.sqrt(squaredTotal / sampleCount);
    }

    private double angleDelta(double from, double to) {
        double delta = to - from;
        while (delta > 180.0) {
            delta -= 360.0;
        }
        while (delta < -180.0) {
            delta += 360.0;
        }
        return delta;
    }
}
