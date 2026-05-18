package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class BasicTrackSessionDecisionEffectsTest {
    @Test
    public void stationaryGapRecoveryDoesNotRecordPointOrCountGap() {
        TrackDecisionResult stationaryGap = new TrackDecisionResult("reject",
                RestAnchorRefiner.REASON_STATIONARY_GAP_RECOVERY,
                0.0, 0.0, 0L, 0, 1, false);

        assertFalse(BasicTrackSession.shouldRecordTrustedTrackPoint(stationaryGap));
        assertFalse(BasicTrackSession.shouldStartNewSegment(stationaryGap));
        assertFalse(BasicTrackSession.shouldIncrementGapCount(stationaryGap));
        assertTrue(BasicTrackSession.shouldAdvanceDecisionReference(stationaryGap));
    }

    @Test
    public void gapRecoveryRecordsPointStartsSegmentAndCountsGap() {
        TrackDecisionResult gapRecovery = new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);

        assertTrue(BasicTrackSession.shouldRecordTrustedTrackPoint(gapRecovery));
        assertTrue(BasicTrackSession.shouldStartNewSegment(gapRecovery));
        assertTrue(BasicTrackSession.shouldIncrementGapCount(gapRecovery));
        assertFalse(BasicTrackSession.shouldAdvanceDecisionReference(gapRecovery));
    }

    @Test
    public void movingPointRecordsWithoutCountingGap() {
        TrackDecisionResult moving = new TrackDecisionResult("accept", "moving_good_fix",
                12.0, 8.0, 0L, 0, 0, false);

        assertTrue(BasicTrackSession.shouldRecordTrustedTrackPoint(moving));
        assertFalse(BasicTrackSession.shouldStartNewSegment(moving));
        assertFalse(BasicTrackSession.shouldIncrementGapCount(moving));
    }

    @Test
    public void restAnchorReferenceUsesHiddenReferenceOnlyForGapRecovery() {
        TrackPoint exported = point(1L, 1_000_000_000L);
        TrackPoint hidden = point(2L, 2_000_000_000L);
        TrackDecisionResult gapRecovery = new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);

        assertSame(hidden, BasicTrackSession.restAnchorReferenceTrackPoint(
                gapRecovery, exported, hidden));
    }

    @Test
    public void restAnchorReferenceIgnoresHiddenReferenceForMovingDecision() {
        TrackPoint exported = point(1L, 1_000_000_000L);
        TrackPoint hidden = point(2L, 2_000_000_000L);
        TrackDecisionResult moving = new TrackDecisionResult("accept", "moving_good_fix",
                12.0, 8.0, 0L, 0, 0, false);

        assertSame(exported, BasicTrackSession.restAnchorReferenceTrackPoint(
                moving, exported, hidden));
    }

    @Test
    public void restAnchorReferenceFallsBackToExportedPointWhenHiddenReferenceMissing() {
        TrackPoint exported = point(1L, 1_000_000_000L);
        TrackDecisionResult gapRecovery = new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);

        assertSame(exported, BasicTrackSession.restAnchorReferenceTrackPoint(
                gapRecovery, exported, null));
    }

    @Test
    public void restAnchorExportedReferenceIsProvidedOnlyForHiddenGapRecovery() {
        TrackPoint exported = point(1L, 1_000_000_000L);
        TrackPoint hidden = point(2L, 2_000_000_000L);
        TrackDecisionResult gapRecovery = new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);
        TrackDecisionResult moving = new TrackDecisionResult("accept", "moving_good_fix",
                12.0, 8.0, 0L, 0, 0, false);

        assertSame(exported, BasicTrackSession.restAnchorExportedTrackPoint(
                gapRecovery, exported, hidden));
        assertNull(BasicTrackSession.restAnchorExportedTrackPoint(
                gapRecovery, exported, null));
        assertNull(BasicTrackSession.restAnchorExportedTrackPoint(
                moving, exported, hidden));
    }

    private TrackPoint point(long trackPointId, long elapsedRealtimeNanos) {
        return new TrackPoint(trackPointId, 1L, trackPointId, 1L,
                29.0, 106.0, false, 0.0, 10f,
                false, 0f, false, 0f,
                1L, elapsedRealtimeNanos, "anchor", "first_fix_good",
                0.0, 0.0, null);
    }

}
