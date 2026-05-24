package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertTrue;

public class GpxExporterTest {
    @Test
    public void buildTrustedGpx_containsTraceableTrackPointFields() {
        TrackPoint point = new TrackPoint(
                1L,
                3L,
                4L,
                1L,
                29.123456,
                106.654321,
                true,
                320.5,
                8.5f,
                false,
                0f,
                false,
                0f,
                1_778_934_000_000L,
                123_456_789L,
                "anchor",
                "first_fix_good",
                0.0,
                0.0);

        String gpx = new GpxExporter().buildTrustedGpx(
                "session<&\"'>",
                Arrays.asList(point),
                12.3,
                4.5);

        assertTrue(gpx.contains("<hike:sessionId>session&lt;&amp;&quot;&apos;&gt;</hike:sessionId>"));
        assertTrue(gpx.contains("<hike:partial>false</hike:partial>"));
        assertTrue(gpx.contains("<hike:sourceRawPointId>3</hike:sourceRawPointId>"));
        assertTrue(gpx.contains("<hike:sourceDecisionId>4</hike:sourceDecisionId>"));
        assertTrue(gpx.contains("<hike:elapsedRealtimeNanos>123456789</hike:elapsedRealtimeNanos>"));
        assertTrue(gpx.contains("<hike:decisionResult>anchor</hike:decisionResult>"));
        assertTrue(gpx.contains("<hike:decisionReason>first_fix_good</hike:decisionReason>"));
        assertTrue(gpx.contains("<hike:trackPointCount>1</hike:trackPointCount>"));
    }

    @Test
    public void buildTrustedGpx_omitsOptionalFieldsWhenUnavailable() {
        TrackPoint point = new TrackPoint(
                1L,
                1L,
                1L,
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
                100L,
                "accept",
                "moving_good_fix",
                6.7,
                3.0);

        String gpx = new GpxExporter().buildTrustedGpx("session", Arrays.asList(point), 6.7, 3.0);

        assertTrue(!gpx.contains("<ele>"));
        assertTrue(gpx.contains("<hike:decisionResult>accept</hike:decisionResult>"));
        assertTrue(gpx.contains("<hike:distanceDeltaMeters>6.7</hike:distanceDeltaMeters>"));
        assertTrue(gpx.contains("<hike:movingTimeDeltaSeconds>3.0</hike:movingTimeDeltaSeconds>"));
    }

    @Test
    public void buildPartialGpx_marksMetadataAndTrackPointsAsPartial() {
        TrackPoint point = new TrackPoint(
                1L,
                1L,
                1L,
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
                100L,
                "anchor",
                "first_fix_good",
                0.0,
                0.0);

        String gpx = new GpxExporter().buildPartialGpx("session", Arrays.asList(point), 0.0, 0.0);

        assertTrue(gpx.contains("<hike:partial>true</hike:partial>"));
        assertTrue(!gpx.contains("<hike:partial>false</hike:partial>"));
    }

    @Test
    public void buildPartialGpx_splitsTrustedSegmentsAroundWeakPoints() {
        TrackPoint trustedBefore = point(1L, 1L, 1L, 100L,
                "anchor", "first_fix_good");
        TrackPoint weak = point(1_000_000_001L, 2L, 2L, 200L,
                "weak", "weak_signal_stage2");
        TrackPoint trustedAfter = point(2L, 3L, 3L, 300L,
                "accept", "moving_good_fix");

        String gpx = new GpxExporter().buildPartialGpx("session",
                Arrays.asList(trustedBefore, weak, trustedAfter), 10.0, 5.0);

        assertTrue(countOccurrences(gpx, "<trkseg>") == 3);
        assertTrue(gpx.contains("<hike:trackPointId>1000000001</hike:trackPointId>"));
        assertTrue(gpx.contains("<hike:decisionResult>weak</hike:decisionResult>"));
    }

    @Test
    public void buildTrustedGpx_keepsContinuousSegmentAcrossGapRecovery() {
        TrackPoint trustedBefore = point(1L, 1L, 1L, 100L,
                "anchor", "first_fix_good");
        TrackPoint gapRecovery = point(2L, 2L, 2L, 130_000_000_000L,
                "accept", "gap_recovery");

        String gpx = new GpxExporter().buildTrustedGpx("session",
                Arrays.asList(trustedBefore, gapRecovery), 0.0, 0.0);

        assertTrue(countOccurrences(gpx, "<trkseg>") == 1);
        assertTrue(gpx.contains("<hike:decisionReason>gap_recovery</hike:decisionReason>"));
        assertTrue(gpx.contains("<hike:distanceDeltaMeters>0.0</hike:distanceDeltaMeters>"));
    }

    private TrackPoint point(long trackPointId, long sourceRawPointId, long sourceDecisionId,
                             long elapsedRealtimeNanos, String result, String reason) {
        return new TrackPoint(trackPointId,
                sourceRawPointId,
                sourceDecisionId,
                1L,
                29.0 + sourceRawPointId * 0.0001,
                106.0,
                false,
                0.0,
                "weak".equals(result) ? 50.0f : 10.0f,
                false,
                0f,
                false,
                0f,
                1_778_934_000_000L + sourceRawPointId * 1000L,
                elapsedRealtimeNanos,
                result,
                reason,
                "accept".equals(result) ? 10.0 : 0.0,
                "accept".equals(result) ? 5.0 : 0.0);
    }

    private int countOccurrences(String text, String needle) {
        int count = 0;
        int index = 0;
        while ((index = text.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
    }
}
