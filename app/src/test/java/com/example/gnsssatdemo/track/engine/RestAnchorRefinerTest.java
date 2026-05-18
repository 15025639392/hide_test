package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RestAnchorRefinerTest {
    private final RestAnchorRefiner refiner = new RestAnchorRefiner();

    @Test
    public void refine_replacesRestAnchorWhenStillPointHasBetterAccuracy() {
        RestAnchorRefiner.Decision decision = refiner.refine(movingGoodFix(8.0),
                raw(2L, 5f, 29.00007, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(17f, 1L),
                snapshot(2L, 16, 27f),
                snapshot(1L, 10, 22f),
                stillSummaries());

        assertTrue(decision.handled);
        assertTrue(decision.refineAnchor);
        assertEquals(RestAnchorRefiner.REASON_ANCHOR_REFINED, decision.reason);
    }

    @Test
    public void refine_doesNotHandlePointWhenDeviceStillEvidenceIsMissing() {
        RestAnchorRefiner.Decision decision = refiner.refine(movingGoodFix(8.0),
                raw(2L, 5f, 29.00007, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(17f, 1L),
                snapshot(2L, 16, 27f),
                snapshot(1L, 10, 22f),
                Collections.<MotionSummary>emptyList());

        assertFalse(decision.handled);
    }

    @Test
    public void refine_rejectsStillNearbyPointWhenQualityDoesNotImprove() {
        RestAnchorRefiner.Decision decision = refiner.refine(movingGoodFix(8.0),
                raw(2L, 11f, 29.00007, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(10f, 1L),
                snapshot(2L, 15, 25f),
                snapshot(1L, 15, 25f),
                stillSummaries());

        assertTrue(decision.handled);
        assertFalse(decision.refineAnchor);
        assertEquals(RestAnchorRefiner.REASON_ACCEL_SUPPORTED_JITTER, decision.reason);
    }

    @Test
    public void refine_doesNotReplacePreviousPointThatAlreadyContributedDistance() {
        RestAnchorRefiner.Decision decision = refiner.refine(movingGoodFix(8.0),
                raw(2L, 5f, 29.00007, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousMovingTrackPoint(17f, 1L),
                snapshot(2L, 16, 27f),
                snapshot(1L, 10, 22f),
                stillSummaries());

        assertTrue(decision.handled);
        assertFalse(decision.refineAnchor);
        assertEquals(RestAnchorRefiner.REASON_ACCEL_SUPPORTED_JITTER, decision.reason);
    }


    @Test
    public void refine_doesNotHandleLargeMovementEvenWhenDeviceLooksStill() {
        RestAnchorRefiner.Decision decision = refiner.refine(movingGoodFix(20.0),
                raw(2L, 5f, 29.00018, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(17f, 1L),
                snapshot(2L, 16, 27f),
                snapshot(1L, 10, 22f),
                stillSummaries());

        assertFalse(decision.handled);
    }

    @Test
    public void refine_rejectsNearbyGapRecoveryWhenDeviceIsStill() {
        RestAnchorRefiner.Decision decision = refiner.refine(gapRecovery(),
                raw(2L, 10f, 29.00005, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(12f, 1L),
                snapshot(2L, 14, 24f),
                snapshot(1L, 14, 24f),
                stillSummaries());

        assertTrue(decision.handled);
        assertFalse(decision.refineAnchor);
        assertEquals(RestAnchorRefiner.REASON_STATIONARY_GAP_RECOVERY, decision.reason);
    }

    @Test
    public void refine_keepsFarGapRecoveryAsNewSegmentCandidate() {
        RestAnchorRefiner.Decision decision = refiner.refine(gapRecovery(),
                raw(2L, 10f, 29.001, 106.0, 6_000_000_000L, true, 0f, 2L),
                previousTrackPoint(12f, 1L),
                snapshot(2L, 14, 24f),
                snapshot(1L, 14, 24f),
                stillSummaries());

        assertFalse(decision.handled);
    }

    @Test
    public void refine_keepsGapRecoveryWhenHiddenReferenceDriftsFromExportedAnchor() {
        RestAnchorRefiner.Decision decision = refiner.refine(gapRecovery(),
                raw(2L, 10f, 29.00027, 106.0, 6_000_000_000L, true, 0f, 2L),
                trackPoint(1L, 29.00014, 106.0, 12f, 1L),
                trackPoint(1L, 29.0, 106.0, 12f, 1L),
                snapshot(2L, 14, 24f),
                snapshot(1L, 14, 24f),
                stillSummaries());

        assertFalse(decision.handled);
    }

    private TrackDecisionResult movingGoodFix(double distanceMeters) {
        return new TrackDecisionResult("accept", "moving_good_fix",
                distanceMeters, 5.0, 0L, 0, 0);
    }

    private TrackDecisionResult gapRecovery() {
        return new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);
    }

    private TrackPoint previousTrackPoint(float accuracyMeters, Long snapshotId) {
        return trackPoint(1L, 29.0, 106.0, accuracyMeters, snapshotId);
    }

    private TrackPoint trackPoint(long trackPointId, double latitude, double longitude,
                                  float accuracyMeters, Long snapshotId) {
        return new TrackPoint(1L, 1L, 1L, 1L,
                latitude, longitude, false, 0.0, accuracyMeters,
                false, 0f, false, 0f,
                1L, 1_000_000_000L, "anchor", "first_fix_good",
                0.0, 0.0, snapshotId);
    }

    private TrackPoint previousMovingTrackPoint(float accuracyMeters, Long snapshotId) {
        return new TrackPoint(1L, 1L, 1L, 1L,
                29.0, 106.0, false, 0.0, accuracyMeters,
                false, 0f, false, 0f,
                1L, 1_000_000_000L, "accept", "moving_good_fix",
                12.0, 10.0, snapshotId);
    }

    private RawPoint raw(long rawPointId, float accuracyMeters, double latitude, double longitude,
                         long elapsedRealtimeNanos, boolean hasSpeed, float speedMetersPerSecond,
                         Long snapshotId) {
        return new RawPoint(rawPointId, "gps", latitude, longitude,
                false, 0.0, true, accuracyMeters,
                hasSpeed, speedMetersPerSecond, false, 0f,
                1L, true, elapsedRealtimeNanos, false, snapshotId);
    }

    private GnssQualitySnapshot snapshot(long snapshotId, int usedInFixTotal, float top4AvgCn0) {
        return new GnssQualitySnapshot(snapshotId, 1_000_000_000L,
                20, usedInFixTotal, 20f, 20f, top4AvgCn0,
                0, 0, 4, 4, 4, 4, 0,
                5, 5, 5, 5, 0, 0, 0, 0, 0, true);
    }

    private java.util.List<MotionSummary> stillSummaries() {
        return Arrays.asList(
                new MotionSummary(1L, 1_000_000_000L, 2_000_000_000L,
                        12, 0.006, 0.98, true, "TYPE_LINEAR_ACCELERATION"),
                new MotionSummary(2L, 3_000_000_000L, 4_000_000_000L,
                        12, 0.007, 0.97, true, "TYPE_LINEAR_ACCELERATION"),
                new MotionSummary(3L, 5_000_000_000L, 6_000_000_000L,
                        12, 0.006, 0.98, true, "TYPE_LINEAR_ACCELERATION"));
    }
}
