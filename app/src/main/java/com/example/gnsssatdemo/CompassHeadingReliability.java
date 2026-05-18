package com.example.gnsssatdemo;

import android.hardware.SensorManager;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

class CompassHeadingReliability {
    static final long HEADING_WINDOW_NANOS = 3_000_000_000L;
    static final long HEADING_MAX_AGE_NANOS = 500_000_000L;
    static final float MIN_MAGNETIC_NORM_MICRO_TESLA = 20f;
    static final float MAX_MAGNETIC_NORM_MICRO_TESLA = 80f;
    static final float MAX_HEADING_STDDEV_DEGREES = 15f;
    static final float MAX_GYRO_NORM_RAD_PER_SECOND = 0.5f;
    static final int MIN_HEADING_SAMPLE_COUNT = 3;

    private final List<HeadingSample> headingSamples = new ArrayList<>();
    private final List<ScalarSample> gyroSamples = new ArrayList<>();
    private int sensorAccuracy = SensorManager.SENSOR_STATUS_UNRELIABLE;
    private float headingDegrees = Float.NaN;
    private long headingTimestampNanos;
    private float magneticNormMicroTesla = Float.NaN;
    private boolean magneticSensorAvailable;
    private boolean gyroSensorAvailable;

    void setSensorAvailability(boolean magneticSensorAvailable, boolean gyroSensorAvailable) {
        this.magneticSensorAvailable = magneticSensorAvailable;
        this.gyroSensorAvailable = gyroSensorAvailable;
    }

    void recordSensorAccuracy(int accuracy) {
        sensorAccuracy = accuracy;
    }

    void recordHeading(float degrees, long timestampNanos) {
        headingDegrees = normalizeDegrees(degrees);
        headingTimestampNanos = timestampNanos;
        headingSamples.add(new HeadingSample(headingDegrees, timestampNanos));
        trimHeadingSamples(timestampNanos);
    }

    void recordMagneticField(float x, float y, float z) {
        magneticNormMicroTesla = (float) Math.sqrt(x * x + y * y + z * z);
    }

    void recordGyroscope(float x, float y, float z, long timestampNanos) {
        float norm = (float) Math.sqrt(x * x + y * y + z * z);
        gyroSamples.add(new ScalarSample(norm, timestampNanos));
        trimGyroSamples(timestampNanos);
    }

    float headingDegrees() {
        return headingDegrees;
    }

    boolean headingReliable(long nowNanos) {
        return unreliableReason(nowNanos).isEmpty();
    }

    String unreliableReason(long nowNanos) {
        trimHeadingSamples(nowNanos);
        trimGyroSamples(nowNanos);
        if (Float.isNaN(headingDegrees)) {
            return "sensor_unavailable";
        }
        if (nowNanos - headingTimestampNanos > HEADING_MAX_AGE_NANOS) {
            return "heading_stale";
        }
        if (sensorAccuracy < SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM) {
            return "sensor_accuracy_low";
        }
        if (!magneticSensorAvailable || Float.isNaN(magneticNormMicroTesla)
                || magneticNormMicroTesla < MIN_MAGNETIC_NORM_MICRO_TESLA
                || magneticNormMicroTesla > MAX_MAGNETIC_NORM_MICRO_TESLA) {
            return "magnetic_norm_outlier";
        }
        if (headingSamples.size() < MIN_HEADING_SAMPLE_COUNT
                || headingCircularStdDevDegrees() > MAX_HEADING_STDDEV_DEGREES) {
            return "heading_jitter";
        }
        if (!gyroSensorAvailable || gyroSamples.isEmpty()
                || maxGyroNorm() > MAX_GYRO_NORM_RAD_PER_SECOND) {
            return "device_rotating";
        }
        return "";
    }

    float magneticNormMicroTesla() {
        return magneticNormMicroTesla;
    }

    float headingCircularStdDevDegrees() {
        if (headingSamples.isEmpty()) {
            return Float.NaN;
        }
        double sinSum = 0.0;
        double cosSum = 0.0;
        for (HeadingSample sample : headingSamples) {
            double radians = Math.toRadians(sample.degrees);
            sinSum += Math.sin(radians);
            cosSum += Math.cos(radians);
        }
        double meanSin = sinSum / headingSamples.size();
        double meanCos = cosSum / headingSamples.size();
        double r = Math.sqrt(meanSin * meanSin + meanCos * meanCos);
        if (r <= 0.0) {
            return 180f;
        }
        double circularStdRadians = Math.sqrt(Math.max(0.0, -2.0 * Math.log(r)));
        return (float) Math.toDegrees(circularStdRadians);
    }

    float maxGyroNorm() {
        float max = 0f;
        for (ScalarSample sample : gyroSamples) {
            max = Math.max(max, sample.value);
        }
        return max;
    }

    private void trimHeadingSamples(long nowNanos) {
        long cutoff = nowNanos - HEADING_WINDOW_NANOS;
        Iterator<HeadingSample> iterator = headingSamples.iterator();
        while (iterator.hasNext()) {
            if (iterator.next().timestampNanos < cutoff) {
                iterator.remove();
            }
        }
    }

    private void trimGyroSamples(long nowNanos) {
        long cutoff = nowNanos - HEADING_WINDOW_NANOS;
        Iterator<ScalarSample> iterator = gyroSamples.iterator();
        while (iterator.hasNext()) {
            if (iterator.next().timestampNanos < cutoff) {
                iterator.remove();
            }
        }
    }

    private float normalizeDegrees(float degrees) {
        float normalized = degrees % 360f;
        return normalized < 0f ? normalized + 360f : normalized;
    }

    private static class HeadingSample {
        final float degrees;
        final long timestampNanos;

        HeadingSample(float degrees, long timestampNanos) {
            this.degrees = degrees;
            this.timestampNanos = timestampNanos;
        }
    }

    private static class ScalarSample {
        final float value;
        final long timestampNanos;

        ScalarSample(float value, long timestampNanos) {
            this.value = value;
            this.timestampNanos = timestampNanos;
        }
    }
}
