package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class BasicTrackSessionDecisionEffectsTest {
    @Test
    public void gapRecoveryRecordsPointStartsSegmentAndCountsGap() {
        TrackDecisionResult gapRecovery = new TrackDecisionResult("accept", "gap_recovery",
                0.0, 0.0, 0L, 0, 0, true);

        assertTrue(BasicTrackSession.shouldRecordTrustedTrackPoint(gapRecovery));
        assertTrue(BasicTrackSession.shouldStartNewSegment(gapRecovery));
        assertTrue(BasicTrackSession.shouldIncrementGapCount(gapRecovery));
    }

    @Test
    public void movingPointRecordsWithoutCountingGap() {
        TrackDecisionResult moving = new TrackDecisionResult("accept", "moving_good_fix",
                12.0, 8.0, 0L, 0, 0, false);

        assertTrue(BasicTrackSession.shouldRecordTrustedTrackPoint(moving));
        assertFalse(BasicTrackSession.shouldStartNewSegment(moving));
        assertFalse(BasicTrackSession.shouldIncrementGapCount(moving));
    }
}
