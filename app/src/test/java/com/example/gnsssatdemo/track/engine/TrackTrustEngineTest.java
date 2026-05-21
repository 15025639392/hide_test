package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.DeviceMotionWindow;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TrackTrustEngineTest {
    private final SamplingEpoch epoch = new SamplingEpoch(1L, "MOVING",
            1000L, 0f, 1_000_000_000L);
    private final GnssQualitySnapshot snapshot = new GnssQualitySnapshot(1L, 1_000_000_000L,
            12, 9, 30f, 7, 1, 1, 0, 0);

    @Test
    public void recoveryCloudNeedsStabilityBeforeNewSegmentAnchor() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision pending = engine.decide(
                raw(2L, 29.001, 106.0, 200_000_000_000L, 15f),
                epoch, snapshot, Collections.emptyList(), previous);

        assertEquals("weak", pending.result);
        assertEquals("recovery_cloud_pending", pending.reason);
        assertFalse(pending.startsNewSegment);

        TrackTrustDecision recovered = engine.decide(
                raw(3L, 29.00101, 106.0, 201_000_000_000L, 15f),
                epoch, snapshot, Collections.emptyList(), previous);

        assertEquals("accept", recovered.result);
        assertEquals("gap_recovery", recovered.reason);
        assertEquals("RECOVERY", recovered.trustGrade);
        assertTrue(recovered.startsNewSegment);
        assertFalse(recovered.virtualTrackPointCoordinate);
    }

    @Test
    public void pausedEpochUsesRecoveryCloudBeforeResumingMovement() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();
        SamplingEpoch pausedEpoch = new SamplingEpoch(2L, "PAUSED",
                10_000L, 0f, 10_000_000_000L);

        TrackTrustDecision pending = engine.decide(
                raw(2L, 29.001, 106.0, 12_000_000_000L, 15f),
                pausedEpoch, snapshot, Collections.emptyList(), previous);

        assertEquals("RECOVERY_CLOUD", pending.cloudType);
        assertEquals("weak", pending.result);
        assertEquals("recovery_cloud_pending", pending.reason);

        TrackTrustDecision recovered = engine.decide(
                raw(3L, 29.00101, 106.0, 13_000_000_000L, 15f),
                pausedEpoch, snapshot, Collections.emptyList(), previous);

        assertEquals("RECOVERY_CLOUD", recovered.cloudType);
        assertEquals("accept", recovered.result);
        assertEquals("RECOVERY", recovered.trustGrade);
        assertEquals(0.0, recovered.distanceDeltaMeters, 0.0);
    }

    @Test
    public void stableStationaryCloudWithoutStillMotionStaysReject() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision first = engine.decide(
                raw(2L, 29.00001, 106.0, 3_000_000_000L, 5f),
                epoch, snapshot, Collections.emptyList(), previous);
        TrackTrustDecision second = engine.decide(
                raw(3L, 29.000012, 106.0, 4_000_000_000L, 5f),
                epoch, snapshot, Collections.emptyList(), previous);

        assertEquals("STATIONARY_CLOUD", first.cloudType);
        assertEquals("reject", first.result);
        assertEquals("stationary_continuity_jitter", first.reason);
        assertEquals("STATIONARY_CLOUD", second.cloudType);
        assertEquals("reject", second.result);
        assertEquals("stationary_continuity_jitter", second.reason);
    }

    @Test
    public void stationaryCloudWithActiveMotionCanOutputLowSpeedMovement() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision decision = engine.decide(
                raw(2L, 29.00003, 106.0, 5_000_000_000L, 5f),
                epoch, snapshot, Collections.singletonList(activeSummary()), previous);

        assertEquals("STATIONARY_CLOUD", decision.cloudType);
        assertEquals("accept", decision.result);
        assertEquals("motion_supported_low_speed", decision.reason);
        assertTrue(decision.distanceDeltaMeters >= TrackTrustEngine.MOTION_SUPPORTED_MIN_DISTANCE_METERS);
        assertFalse(decision.virtualTrackPointCoordinate);
    }

    @Test
    public void recoveryCloudKeepsTransportRiskWithoutCountingGapLine() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision pending = engine.decide(
                raw(2L, 29.010, 106.0, 200_000_000_000L, 10f),
                epoch, snapshot, Collections.emptyList(), previous);
        TrackTrustDecision transport = engine.decide(
                raw(3L, 29.0107, 106.0, 202_000_000_000L, 10f),
                epoch, snapshot, Collections.emptyList(), previous);

        assertEquals("accept", pending.result);
        assertEquals("gap_recovery", pending.reason);
        assertEquals("accept", transport.result);
        assertEquals("recovery_transport_suspected_kept", transport.reason);
        assertTrue(transport.startsNewSegment);
        assertEquals(0.0, transport.distanceDeltaMeters, 0.0);
    }

    @Test
    public void stableStationaryCloudWithStillMotionCanOutputZeroDeltaAnchor() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision first = engine.decide(
                raw(2L, 29.00001, 106.0, 3_000_000_000L, 5f),
                epoch, snapshot, Collections.singletonList(stillSummary()),
                previous);
        TrackTrustDecision second = engine.decide(
                raw(3L, 29.000012, 106.0, 4_000_000_000L, 5f),
                epoch, snapshot, Collections.singletonList(stillSummary()),
                previous);

        assertEquals("STATIONARY_CLOUD", first.cloudType);
        assertEquals("reject", first.result);
        assertEquals("stationary_cloud_jitter", first.reason);
        assertEquals("STATIONARY_CLOUD", second.cloudType);
        assertEquals("anchor", second.result);
        assertEquals("stationary_anchor", second.reason);
        assertEquals(0.0, second.distanceDeltaMeters, 0.0);
    }

    @Test
    public void movingCloudResetsAfterAcceptToAvoidLongRunCenterLag() {
        TrackTrustEngine engine = new TrackTrustEngine();
        TrackPoint previous = previousTrustedPoint();

        TrackTrustDecision first = engine.decide(
                raw(2L, 29.0002, 106.0, 20_000_000_000L, 5f),
                epoch, snapshot, Collections.emptyList(), previous);
        assertEquals("accept", first.result);
        assertEquals("MOVING_CLOUD", first.cloudType);
        assertEquals(1, first.cloudSampleCount);

        TrackPoint firstTrackPoint = trackPointFromDecision(2L, 2L, first);
        TrackTrustDecision second = engine.decide(
                raw(3L, 29.0004, 106.0, 40_000_000_000L, 5f),
                epoch, snapshot, Collections.emptyList(), firstTrackPoint);

        assertEquals("accept", second.result);
        assertEquals("MOVING_CLOUD", second.cloudType);
        assertEquals(1, second.cloudSampleCount);
        assertTrue(second.distanceDeltaMeters > 15.0);
    }

    private TrackPoint previousTrustedPoint() {
        RawPoint rawPoint = raw(1L, 29.0, 106.0, 2_000_000_000L, 5f);
        return new TrackPoint(1L, 1L, 1L, rawPoint,
                "anchor", "first_fix_good", 0.0, 0.0);
    }

    private TrackPoint trackPointFromDecision(long trackPointId, long decisionId,
                                              TrackTrustDecision decision) {
        RawPoint rawPoint = decision.sourceRawPoint;
        return new TrackPoint(trackPointId, rawPoint.rawPointId, decisionId, 1L,
                decision.cloudCenterLatitude, decision.cloudCenterLongitude,
                rawPoint.hasAltitude, rawPoint.altitude,
                rawPoint.hasVerticalAccuracy, rawPoint.verticalAccuracyMeters,
                rawPoint.accuracyMeters, rawPoint.hasSpeed, rawPoint.speedMetersPerSecond,
                rawPoint.hasBearing, rawPoint.bearingDegrees,
                rawPoint.timeMillis, rawPoint.elapsedRealtimeNanos,
                decision.result, decision.reason,
                decision.distanceDeltaMeters, decision.movingTimeDeltaSeconds,
                rawPoint.sourceGnssSnapshotId);
    }

    private RawPoint raw(long id, double latitude, double longitude,
                         long elapsedRealtimeNanos, float accuracyMeters) {
        return new RawPoint(id, "gps", latitude, longitude,
                false, 0.0, true, accuracyMeters,
                true, 1.0f, false, 0f, 1L,
                true, elapsedRealtimeNanos, false, null);
    }

    private DeviceMotionWindow stillSummary() {
        return new DeviceMotionWindow(1L, 2_500_000_000L, 4_500_000_000L,
                20, 0, 20, 0,
                0.02, 0.03, 0.0, 0.0,
                0.01, 0.02, 0.0, 0.0, 0.0,
                0, 0, false);
    }

    private DeviceMotionWindow activeSummary() {
        return new DeviceMotionWindow(1L, 2_500_000_000L, 4_500_000_000L,
                20, 1, 20, 0,
                0.42, 0.50, 0.0, 0.0,
                0.14, 0.20, 0.0, 0.0, 0.0,
                2, 0, false);
    }
}
