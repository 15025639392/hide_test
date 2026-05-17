package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class TrackExportValidatorTest {
    private final TrackExportValidator validator = new TrackExportValidator();

    @Test
    public void trustedGpxReferenceError_acceptsOrderedAcceptedPoints() {
        assertNull(validator.trustedGpxReferenceError(Arrays.asList(
                point(1L, 1L, 2L, "anchor", "first_fix_good"),
                point(2L, 3L, 4L, "accept", "moving_good_fix")
        ), 3L, 4L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsNonContinuousTrackPointId() {
        assertEquals("trackPointId 不连续: 3",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 1L, 1L, "anchor", "first_fix_good"),
                        point(3L, 2L, 2L, "accept", "moving_good_fix")
                ), 2L, 2L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsRawPointOutOfRange() {
        assertEquals("sourceRawPointId 越界: 3",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 3L, 1L, "anchor", "first_fix_good")
                ), 2L, 1L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsDecisionOutOfRange() {
        assertEquals("sourceDecisionId 越界: 3",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 1L, 3L, "anchor", "first_fix_good")
                ), 1L, 2L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsNonIncreasingDecisionId() {
        assertEquals("sourceDecisionId 未递增: 2",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 1L, 2L, "anchor", "first_fix_good"),
                        point(2L, 2L, 2L, "accept", "moving_good_fix")
                ), 2L, 2L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsRejectedDecisionResult() {
        assertEquals("TrackPoint 指向非接受决策: reject",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 1L, 1L, "reject", "weak_signal_stage1")
                ), 1L, 1L));
    }

    @Test
    public void trustedGpxReferenceError_rejectsEmptyReason() {
        assertEquals("decisionReason 为空",
                validator.trustedGpxReferenceError(Arrays.asList(
                        point(1L, 1L, 1L, "anchor", "")
                ), 1L, 1L));
    }

    private TrackPoint point(long trackPointId, long sourceRawPointId, long sourceDecisionId,
                             String decisionResult, String decisionReason) {
        return new TrackPoint(
                trackPointId,
                sourceRawPointId,
                sourceDecisionId,
                1L,
                29.0,
                106.0,
                false,
                0.0,
                10.0f,
                false,
                0f,
                false,
                0f,
                1_778_934_000_000L,
                100L + trackPointId,
                decisionResult,
                decisionReason,
                0.0,
                0.0,
                null);
    }
}
