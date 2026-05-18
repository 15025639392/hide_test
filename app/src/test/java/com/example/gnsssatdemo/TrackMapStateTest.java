package com.example.gnsssatdemo;

import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TrackMapStateTest {
    @Test
    public void build_usesLastTrustedPointForCurrentPointAndHeading() {
        List<TrackPoint> points = Arrays.asList(
                point(1L, 29.0, 106.0, "anchor", "first_fix_good", false, 0f),
                point(2L, 29.0002, 106.0, "accept", "moving_good_fix", false, 0f),
                point(3L, 29.0004, 106.0, "weak", "weak_signal_stage1", false, 0f));

        TrackMapState state = TrackMapState.build(points, new TrackMapState.Fallback());

        assertEquals(29.0002, state.currentPoint.latitude, 0.0);
        assertEquals(106.0, state.currentPoint.longitude, 0.0);
        assertTrue(state.headingDegrees >= 0f);
        assertFalse(Float.isNaN(state.headingDegrees));
    }

    @Test
    public void build_usesForegroundFallbackWhenNoTrustedPointExists() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.foregroundRecording = true;
        fallback.foregroundHasLocation = true;
        fallback.foregroundLatitude = 29.5;
        fallback.foregroundLongitude = 106.5;
        fallback.foregroundAccuracyMeters = 12f;
        fallback.foregroundHasBearing = true;
        fallback.foregroundBearingDegrees = 88f;
        fallback.foregroundTotalDistanceMeters = 123.0;
        fallback.foregroundTotalAscentMeters = 9.0;

        TrackMapState state = TrackMapState.build(Arrays.asList(
                point(1L, 29.0, 106.0, "weak", "weak_signal_stage1", false, 0f)), fallback);

        assertEquals(29.5, state.currentPoint.latitude, 0.0);
        assertEquals(106.5, state.currentPoint.longitude, 0.0);
        assertEquals(12f, state.accuracyMeters, 0f);
        assertEquals(88f, state.headingDegrees, 0f);
        assertEquals(123.0, state.totalDistanceMeters, 0.0);
        assertEquals(9.0, state.totalAscentMeters, 0.0);
    }

    @Test
    public void build_sumsTrustedDistanceWhenNoAuthoritativeTotalExists() {
        TrackMapState state = TrackMapState.build(Arrays.asList(
                point(1L, 29.0, 106.0, "anchor", "first_fix_good", false, 0f, 0.0),
                point(2L, 29.0002, 106.0, "accept", "moving_good_fix", false, 0f, 10.0),
                point(3L, 29.0004, 106.0, "transport", "transport_confirmed", false, 0f, 99.0),
                point(4L, 29.0005, 106.0, "weak", "weak_signal_stage1", false, 0f, 99.0)),
                new TrackMapState.Fallback());

        assertEquals(10.0, state.totalDistanceMeters, 0.0);
    }

    private TrackPoint point(long id, double latitude, double longitude, String result,
                             String reason, boolean hasBearing, float bearingDegrees) {
        return point(id, latitude, longitude, result, reason, hasBearing, bearingDegrees, 0.0);
    }

    private TrackPoint point(long id, double latitude, double longitude, String result,
                             String reason, boolean hasBearing, float bearingDegrees,
                             double distanceDeltaMeters) {
        return new TrackPoint(id, id, id, 1L, latitude, longitude,
                false, 0.0, 5f, false, 0f, hasBearing, bearingDegrees,
                1L, id * 1_000_000_000L, result, reason, distanceDeltaMeters, 1.0, null);
    }
}
