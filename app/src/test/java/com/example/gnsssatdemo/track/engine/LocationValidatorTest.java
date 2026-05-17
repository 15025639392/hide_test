package com.example.gnsssatdemo.track.engine;

import android.location.LocationManager;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.ValidationResult;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class LocationValidatorTest {
    private static final long START_NANOS = 1_000_000_000L;
    private static final long NOW_NANOS = START_NANOS + 60_000_000_000L;

    private final LocationValidator validator = new LocationValidator();

    @Test
    public void validate_acceptsGoodGpsPoint() {
        ValidationResult result = validator.validate(goodPoint(), START_NANOS, NOW_NANOS);

        assertTrue(result.valid);
        assertEquals("", result.rejectReason);
        assertEquals(1_000_000_000L, result.locationAgeNanos);
    }

    @Test
    public void validate_rejectsNonGpsProvider() {
        assertRejected(pointWithProvider(LocationManager.NETWORK_PROVIDER), "provider_not_gps");
    }

    @Test
    public void validate_rejectsMissingElapsedRealtime() {
        RawPoint point = new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, false, 0L, false, null);

        assertRejected(point, "missing_elapsed_realtime");
    }

    @Test
    public void validate_rejectsPointBeforeRecordStartTolerance() {
        RawPoint point = pointWithElapsedRealtime(START_NANOS
                - LocationValidator.START_TOLERANCE_NANOS - 1L);

        assertRejected(point, "before_record_start");
    }

    @Test
    public void validate_rejectsTooOldPoint() {
        RawPoint point = pointWithElapsedRealtime(NOW_NANOS
                - LocationValidator.MAX_LOCATION_AGE_NANOS - 1L);

        assertRejected(point, "location_too_old");
    }

    @Test
    public void validate_rejectsPointFromFuture() {
        RawPoint point = pointWithElapsedRealtime(NOW_NANOS
                + LocationValidator.START_TOLERANCE_NANOS + 1L);

        assertRejected(point, "location_from_future");
    }

    @Test
    public void validate_rejectsZeroCoordinate() {
        assertRejected(pointWithCoordinate(0.0, 0.0), "zero_coordinate");
    }

    @Test
    public void validate_rejectsInvalidCoordinateRange() {
        assertRejected(pointWithCoordinate(91.0, 106.0), "zero_coordinate");
        assertRejected(pointWithCoordinate(29.0, 181.0), "zero_coordinate");
    }

    @Test
    public void validate_rejectsMissingAccuracy() {
        RawPoint point = new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, false, 0f, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, false, null);

        assertRejected(point, "invalid_accuracy");
    }

    @Test
    public void validate_rejectsTooLargeAccuracy() {
        assertRejected(pointWithAccuracy(LocationValidator.MAX_ACCURACY_METERS + 0.1f),
                "accuracy_too_large");
    }

    @Test
    public void validate_rejectsMockLocation() {
        RawPoint point = new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, true, null);

        assertRejected(point, "mock_location");
    }

    private void assertRejected(RawPoint point, String expectedReason) {
        ValidationResult result = validator.validate(point, START_NANOS, NOW_NANOS);
        assertTrue(!result.valid);
        assertEquals(expectedReason, result.rejectReason);
    }

    private RawPoint goodPoint() {
        return new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, false, null);
    }

    private RawPoint pointWithProvider(String provider) {
        return new RawPoint(1L, provider, 29.0, 106.0,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, false, null);
    }

    private RawPoint pointWithElapsedRealtime(long elapsedRealtimeNanos) {
        return new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, true, elapsedRealtimeNanos, false, null);
    }

    private RawPoint pointWithCoordinate(double latitude, double longitude) {
        return new RawPoint(1L, LocationManager.GPS_PROVIDER, latitude, longitude,
                false, 0.0, true, 10f, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, false, null);
    }

    private RawPoint pointWithAccuracy(float accuracyMeters) {
        return new RawPoint(1L, LocationManager.GPS_PROVIDER, 29.0, 106.0,
                false, 0.0, true, accuracyMeters, false, 0f, false, 0f,
                1L, true, NOW_NANOS - 1_000_000_000L, false, null);
    }
}
