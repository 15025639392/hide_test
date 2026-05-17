package com.example.gnsssatdemo.track.model;

public class ValidationResult {
    public final boolean valid;
    public final String rejectReason;
    public final long locationAgeNanos;

    public ValidationResult(boolean valid, String rejectReason, long locationAgeNanos) {
        this.valid = valid;
        this.rejectReason = rejectReason;
        this.locationAgeNanos = locationAgeNanos;
    }

    public static ValidationResult ok(long locationAgeNanos) {
        return new ValidationResult(true, "", locationAgeNanos);
    }

    public static ValidationResult reject(String reason, long locationAgeNanos) {
        return new ValidationResult(false, reason, locationAgeNanos);
    }
}
