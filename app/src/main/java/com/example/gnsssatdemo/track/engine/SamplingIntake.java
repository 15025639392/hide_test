package com.example.gnsssatdemo.track.engine;

import android.location.LocationManager;

import com.example.gnsssatdemo.track.model.RawPoint;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class SamplingIntake {
    public static final float MAX_ACCURACY_METERS = 80f;
    public static final long START_TOLERANCE_NANOS = 1_000_000_000L;
    private final Set<String> acceptedFixKeys = new HashSet<>();
    private long lastAcceptedFixElapsedRealtimeNanos;

    public void reset() {
        acceptedFixKeys.clear();
        lastAcceptedFixElapsedRealtimeNanos = 0L;
    }

    public Result accept(RawPoint rawPoint, SamplingEpoch epoch,
                         long recordStartElapsedRealtimeNanos,
                         long nowElapsedRealtimeNanos) {
        if (epoch == null) {
            return Result.contractViolation("sampling_contract_violation");
        }
        if (rawPoint == null) {
            return Result.rejected("invalid_location");
        }
        if (!LocationManager.GPS_PROVIDER.equals(rawPoint.provider)) {
            return Result.rejected("provider_not_gps");
        }
        if (rawPoint.mock) {
            return Result.rejected("mock_location");
        }
        if (!rawPoint.hasElapsedRealtimeNanos || rawPoint.elapsedRealtimeNanos <= 0L) {
            return Result.rejected("missing_fix_elapsed_realtime");
        }
        if (rawPoint.elapsedRealtimeNanos
                < recordStartElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
            return Result.rejected("before_record_start");
        }
        if (rawPoint.elapsedRealtimeNanos
                < epoch.startedElapsedRealtimeNanos - START_TOLERANCE_NANOS) {
            return Result.rejected("sampling_epoch_mismatch");
        }
        if (rawPoint.elapsedRealtimeNanos > nowElapsedRealtimeNanos + START_TOLERANCE_NANOS) {
            return Result.rejected("location_from_future");
        }
        if (!isValidCoordinate(rawPoint.latitude, rawPoint.longitude)) {
            return Result.rejected("invalid_coordinate");
        }
        if (!rawPoint.hasAccuracy || !isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters <= 0f) {
            return Result.rejected("invalid_accuracy");
        }
        if (rawPoint.accuracyMeters > MAX_ACCURACY_METERS) {
            return Result.rejected("accuracy_too_large");
        }
        String fixKey = fixKey(rawPoint, epoch);
        if (acceptedFixKeys.contains(fixKey)) {
            return Result.rejected("duplicate_fix");
        }
        if (lastAcceptedFixElapsedRealtimeNanos > 0L
                && rawPoint.elapsedRealtimeNanos <= lastAcceptedFixElapsedRealtimeNanos) {
            return Result.rejected("out_of_order_fix");
        }
        acceptedFixKeys.add(fixKey);
        lastAcceptedFixElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
        return Result.accepted();
    }

    private static boolean isValidCoordinate(double latitude, double longitude) {
        return isFinite(latitude) && isFinite(longitude)
                && !(latitude == 0.0 && longitude == 0.0)
                && latitude >= -90.0 && latitude <= 90.0
                && longitude >= -180.0 && longitude <= 180.0;
    }

    private static boolean isFinite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }

    private static String fixKey(RawPoint rawPoint, SamplingEpoch epoch) {
        return String.format(Locale.US, "%d|%s|%d|%.7f|%.7f|%.2f",
                epoch.samplingEpochId, rawPoint.provider, rawPoint.elapsedRealtimeNanos,
                rawPoint.latitude, rawPoint.longitude, rawPoint.accuracyMeters);
    }

    public static class Result {
        public final boolean accepted;
        public final boolean contractViolation;
        public final String reason;

        private Result(boolean accepted, boolean contractViolation, String reason) {
            this.accepted = accepted;
            this.contractViolation = contractViolation;
            this.reason = reason;
        }

        static Result accepted() {
            return new Result(true, false, "");
        }

        static Result rejected(String reason) {
            return new Result(false, false, reason);
        }

        static Result contractViolation(String reason) {
            return new Result(false, true, reason);
        }
    }
}
