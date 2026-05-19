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
        fallback.foregroundHasSpeed = true;
        fallback.foregroundSpeedMetersPerSecond = 1.2f;
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

    @Test
    public void build_treatsStationaryAnchorRefinementAsAscentAnchor() {
        TrackMapState state = TrackMapState.build(Arrays.asList(
                altitudePoint(1L, 29.0, 100.0, "accept", "moving_good_fix"),
                altitudePoint(2L, 29.0001, 150.0, "anchor", "stationary_anchor_refined"),
                altitudePoint(3L, 29.0002, 151.0, "accept", "moving_good_fix")),
                new TrackMapState.Fallback());

        assertEquals(0.0, state.totalAscentMeters, 0.0);
    }

    @Test
    public void build_usesCompassFallbackOnlyWhenReliable() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.5;
        fallback.lastLongitude = 106.5;
        fallback.lastAccuracyMeters = 8f;
        fallback.compassHeadingDegrees = 45f;

        TrackMapState unreliable = TrackMapState.build(Arrays.asList(), fallback);
        assertTrue(Float.isNaN(unreliable.headingDegrees));

        fallback.compassHeadingReliable = true;
        TrackMapState reliable = TrackMapState.build(Arrays.asList(), fallback);
        assertEquals(45f, reliable.headingDegrees, 0f);
    }

    @Test
    public void build_ignoresLowSpeedGnssBearingForStrongArrow() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.5;
        fallback.lastLongitude = 106.5;
        fallback.lastAccuracyMeters = 8f;
        fallback.lastHasBearing = true;
        fallback.lastBearingDegrees = 88f;
        fallback.lastHasSpeed = true;
        fallback.lastSpeedMetersPerSecond = 0.3f;
        fallback.compassHeadingDegrees = 45f;
        fallback.compassHeadingReliable = true;

        TrackMapState state = TrackMapState.build(Arrays.asList(), fallback);

        assertEquals(45f, state.headingDegrees, 0f);
    }

    @Test
    public void build_doesNotReuseLastBearingWhenForegroundLocationIsStopped() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.foregroundRecording = true;
        fallback.foregroundHasLocation = true;
        fallback.foregroundLatitude = 29.5;
        fallback.foregroundLongitude = 106.5;
        fallback.foregroundAccuracyMeters = 8f;
        fallback.foregroundHasBearing = true;
        fallback.foregroundBearingDegrees = 30f;
        fallback.foregroundHasSpeed = true;
        fallback.foregroundSpeedMetersPerSecond = 0.1f;
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.5;
        fallback.lastLongitude = 106.5;
        fallback.lastAccuracyMeters = 8f;
        fallback.lastHasBearing = true;
        fallback.lastBearingDegrees = 88f;
        fallback.lastHasSpeed = true;
        fallback.lastSpeedMetersPerSecond = 1.5f;
        fallback.compassHeadingDegrees = 45f;
        fallback.compassHeadingReliable = true;

        TrackMapState state = TrackMapState.build(Arrays.asList(), fallback);

        assertEquals(45f, state.headingDegrees, 0f);
    }

    @Test
    public void build_ignoresStaleTrackHeadingWhenCurrentLocationIsStopped() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.0002;
        fallback.lastLongitude = 106.0;
        fallback.lastAccuracyMeters = 8f;
        fallback.lastHasSpeed = true;
        fallback.lastSpeedMetersPerSecond = 0.1f;
        fallback.hasSessionTotalDistance = true;
        fallback.sessionTotalDistanceMeters = 10.0;
        fallback.compassHeadingDegrees = 45f;
        fallback.compassHeadingReliable = true;

        TrackMapState state = TrackMapState.build(Arrays.asList(
                point(1L, 29.0, 106.0, "anchor", "first_fix_good", false, 0f, 0.0),
                point(2L, 29.0002, 106.0, "accept", "moving_good_fix", true, 0f, 10.0)),
                fallback);

        assertEquals(45f, state.headingDegrees, 0f);
    }

    @Test
    public void build_allowsTrackHeadingWhenCurrentLocationHasNoSpeed() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.0002;
        fallback.lastLongitude = 106.0;
        fallback.lastAccuracyMeters = 8f;
        fallback.lastHasSpeed = false;
        fallback.compassHeadingDegrees = 45f;
        fallback.compassHeadingReliable = true;

        TrackMapState state = TrackMapState.build(Arrays.asList(
                point(1L, 29.0, 106.0, "anchor", "first_fix_good", false, 0f, 0.0),
                point(2L, 29.0002, 106.0, "accept", "moving_good_fix", false, 0f, 10.0)),
                fallback);

        assertEquals(0f, state.headingDegrees, 0.1f);
    }

    @Test
    public void build_doesNotGateHistoricalTrackHeadingByCurrentDeviceSpeed() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.hasLastLocation = true;
        fallback.lastLatitude = 29.0002;
        fallback.lastLongitude = 106.0;
        fallback.lastAccuracyMeters = 8f;
        fallback.lastHasSpeed = true;
        fallback.lastSpeedMetersPerSecond = 0.1f;
        fallback.hasManifestTotalDistance = true;
        fallback.manifestTotalDistanceMeters = 10.0;
        fallback.compassHeadingDegrees = 45f;
        fallback.compassHeadingReliable = true;

        TrackMapState state = TrackMapState.build(Arrays.asList(
                point(1L, 29.0, 106.0, "anchor", "first_fix_good", false, 0f, 0.0),
                point(2L, 29.0002, 106.0, "accept", "moving_good_fix", false, 0f, 10.0)),
                fallback);

        assertEquals(0f, state.headingDegrees, 0.1f);
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

    private TrackPoint altitudePoint(long id, double latitude, double altitude, String result,
                                     String reason) {
        return new TrackPoint(id, id, id, 1L, latitude, 106.0,
                true, altitude, true, 5f, 5f, false, 0f, false, 0f,
                1L, id * 30_000_000_000L, result, reason, 10.0, 0.0, null);
    }
}
