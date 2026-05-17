package com.example.gnsssatdemo.track.engine;

import android.location.LocationManager;
import android.os.SystemClock;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.ValidationResult;

public class LocationValidator {
    public static final long MAX_LOCATION_AGE_NANOS = 30_000_000_000L;
    public static final long START_TOLERANCE_NANOS = 1_000_000_000L;
    public static final float MAX_ACCURACY_METERS = 80f;

    public ValidationResult validate(RawPoint rawPoint, long recordStartElapsedRealtimeNanos) {
        return validate(rawPoint, recordStartElapsedRealtimeNanos, SystemClock.elapsedRealtimeNanos());
    }

    public ValidationResult validate(RawPoint rawPoint, long recordStartElapsedRealtimeNanos,
                                     long nowElapsedRealtimeNanos) {
        long now = nowElapsedRealtimeNanos;
        long age = rawPoint.hasElapsedRealtimeNanos ? Math.max(0L, now - rawPoint.elapsedRealtimeNanos) : -1L;

        if (!LocationManager.GPS_PROVIDER.equals(rawPoint.provider)) {
            return ValidationResult.reject("provider_not_gps", age);
        }
        if (!rawPoint.hasElapsedRealtimeNanos) {
            return ValidationResult.reject("missing_elapsed_realtime", age);
        }
        if (rawPoint.elapsedRealtimeNanos < recordStartElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
            return ValidationResult.reject("before_record_start", age);
        }
        if (rawPoint.elapsedRealtimeNanos > now + START_TOLERANCE_NANOS) {
            return ValidationResult.reject("location_from_future", age);
        }
        if (age > MAX_LOCATION_AGE_NANOS) {
            return ValidationResult.reject("location_too_old", age);
        }
        if ((rawPoint.latitude == 0.0 && rawPoint.longitude == 0.0)
                || rawPoint.latitude < -90.0 || rawPoint.latitude > 90.0
                || rawPoint.longitude < -180.0 || rawPoint.longitude > 180.0) {
            return ValidationResult.reject("zero_coordinate", age);
        }
        if (!rawPoint.hasAccuracy || rawPoint.accuracyMeters <= 0f) {
            return ValidationResult.reject("invalid_accuracy", age);
        }
        if (rawPoint.accuracyMeters > MAX_ACCURACY_METERS) {
            return ValidationResult.reject("accuracy_too_large", age);
        }
        if (rawPoint.mock) {
            return ValidationResult.reject("mock_location", age);
        }
        return ValidationResult.ok(age);
    }
}
