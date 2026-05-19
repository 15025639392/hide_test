package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.TrackPoint;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class TrackAscentCalculatorTest {
    @Test
    public void totalAscentMeters_usesFilteredGnssTrend() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                point(1L, 100.0, "anchor", "first_fix_good", 0.0),
                point(2L, 140.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(6.0, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_prefersBarometerWhenPressureSampleExists() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "anchor", "first_fix_good"),
                barometerPoint(2L, 110.0, "accept", "moving_good_fix")));

        assertEquals(3.5, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_resetsTrendWhenSourceChanges() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "accept", "moving_good_fix"),
                point(2L, 160.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(-1.0, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_usesBarometerOutsideMovingGoodFix() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "weak", "weak_signal_stage1"),
                barometerPoint(2L, 110.0, "reject", "stationary_jitter")));

        assertEquals(3.5, ascent, 0.0001);
    }

    @Test
    public void ascentResult_prefersBarometerWhenBothEnginesAreReliable() {
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(Arrays.asList(
                barometerPoint(1L, 100.0, "weak", "weak_signal_stage1"),
                barometerPoint(2L, 110.0, "reject", "stationary_jitter"),
                point(3L, 160.0, "accept", "moving_good_fix", 10.0),
                point(4L, 200.0, "accept", "moving_good_fix", 10.0)));

        assertEquals("BAROMETER", result.source);
        assertEquals(3.5, result.totalAscentMeters, 0.0001);
    }

    @Test
    public void ascentResult_usesIndependentBarometerSamples() {
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(
                Arrays.asList(
                        point(1L, 100.0, "accept", "moving_good_fix", 10.0),
                        point(2L, 140.0, "accept", "moving_good_fix", 10.0)),
                Arrays.asList(
                        barometerSample(1L, 1L, 100.0),
                        barometerSample(2L, 2L, 110.0)));

        assertEquals("BAROMETER", result.source);
        assertEquals(3.5, result.totalAscentMeters, 0.0001);
        assertEquals(3.5, result.barometerTotalAscentMeters, 0.0001);
        assertEquals(6.0, result.gnssTotalAscentMeters, 0.0001);
    }

    @Test
    public void ascentResult_rejectsBadIndependentBarometerSamples() {
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(
                Arrays.asList(
                        point(1L, 100.0, "accept", "moving_good_fix", 10.0),
                        point(2L, 140.0, "accept", "moving_good_fix", 10.0)),
                Arrays.asList(
                        barometerSample(1L, 1L, 100.0),
                        new TrackAscentCalculator.BarometerSample(
                                2L, 2L * 30_000_000_000L, 0.0f, 3, 110.0),
                        barometerSample(3L, 1L, 120.0)));

        assertEquals("GNSS", result.source);
        assertEquals(6.0, result.totalAscentMeters, 0.0001);
        assertEquals(-1.0, result.barometerTotalAscentMeters, 0.0001);
        assertEquals(1, result.barometerSampleCount);
        assertEquals(2, result.barometerRejectedSampleCount);
    }

    @Test
    public void ascentResult_keepsUnreliableSensorAccuracyObservable() {
        TrackAscentCalculator.Result result = TrackAscentCalculator.ascentResult(
                Arrays.asList(
                        point(1L, 100.0, "accept", "moving_good_fix", 10.0),
                        point(2L, 140.0, "accept", "moving_good_fix", 10.0)),
                Arrays.asList(
                        barometerSample(1L, 1L, 100.0),
                        new TrackAscentCalculator.BarometerSample(
                                2L, 2L * 30_000_000_000L, 1000.0f, 0, 110.0)));

        assertEquals("BAROMETER", result.source);
        assertEquals(3.5, result.barometerTotalAscentMeters, 0.0001);
        assertEquals(2, result.barometerSampleCount);
        assertEquals(0, result.barometerRejectedSampleCount);
    }

    @Test
    public void totalAscentMeters_resetsFilterWhenSourceChanges() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "accept", "moving_good_fix"),
                point(2L, 160.0, "accept", "moving_good_fix", 10.0),
                point(3L, 200.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(6.0, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_allowsPhysicalGateAfterSourceChanges() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "accept", "moving_good_fix"),
                point(2L, 200.0, "accept", "moving_good_fix", 10.0),
                point(3L, 240.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(6.0, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_flushesPendingGainWhenSourceChanges() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "accept", "moving_good_fix"),
                barometerPoint(2L, 110.0, "accept", "moving_good_fix"),
                point(3L, 200.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(3.5, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_flushesPendingGainBeforeRecoveryAnchor() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                barometerPoint(1L, 100.0, "accept", "moving_good_fix"),
                barometerPoint(2L, 110.0, "accept", "moving_good_fix"),
                barometerPoint(3L, 200.0, "anchor", "gap_recovery")));

        assertEquals(3.5, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_rejectsGnssAltitudeWithoutVerticalAccuracy() {
        TrackPoint point = new TrackPoint(1L, 1L, 1L, 1L,
                29.0, 106.0, true, 120.0, 5f,
                false, 0f, false, 0f,
                1L, 30_000_000_000L, "accept", "moving_good_fix",
                10.0, 1.0, null);

        assertEquals(-1.0, TrackAscentCalculator.totalAscentMeters(Arrays.asList(point)), 0.0);
    }

    @Test
    public void totalAscentMeters_doesNotAccumulateAcrossRecoveryAnchor() {
        double ascent = TrackAscentCalculator.totalAscentMeters(Arrays.asList(
                point(1L, 100.0, "anchor", "first_fix_good", 0.0),
                point(2L, 160.0, "anchor", "gap_recovery", 0.0),
                point(3L, 200.0, "accept", "moving_good_fix", 10.0)));

        assertEquals(6.0, ascent, 0.0001);
    }

    @Test
    public void totalAscentMeters_ignoresGnssAltitudeWhenHorizontalAccuracyIsWeak() {
        TrackPoint point = new TrackPoint(1L, 1L, 1L, 1L,
                29.0, 106.0, true, 120.0, true, 5f, 40f,
                false, 0f, false, 0f,
                1L, 30_000_000_000L, "accept", "moving_good_fix",
                10.0, 1.0, null);

        assertEquals(-1.0, TrackAscentCalculator.totalAscentMeters(Arrays.asList(point)), 0.0);
    }

    @Test
    public void usesGnssAltitude_requiresEnoughHorizontalDistance() {
        TrackPoint point = point(1L, 120.0, "accept", "moving_good_fix", 4.0);

        assertFalse(TrackAscentCalculator.usesGnssAltitude(point));
    }

    private TrackPoint point(long id, double altitude, String result, String reason,
                             double distanceDeltaMeters) {
        return new TrackPoint(id, id, id, 1L,
                29.0 + id * 0.0001, 106.0,
                true, altitude, true, 5f, 5f,
                false, 0f, false, 0f,
                1L, id * 30_000_000_000L, result, reason,
                distanceDeltaMeters, 30.0, null);
    }

    private TrackPoint barometerPoint(long id, double rawBarometerAltitudeMeters,
                                      String result, String reason) {
        return new TrackPoint(id, id, id, 1L,
                29.0 + id * 0.0001, 106.0,
                false, 0.0, false, 0f, 50f,
                false, 0f, false, 0f,
                1L, id * 30_000_000_000L, result, reason,
                0.0, 30.0, null,
                true, id * 30_000_000_000L, 1000.0, rawBarometerAltitudeMeters);
    }

    private TrackAscentCalculator.BarometerSample barometerSample(long id,
                                                                  long elapsedStep,
                                                                  double altitude) {
        return new TrackAscentCalculator.BarometerSample(
                id, elapsedStep * 30_000_000_000L, 1000.0f, 3, altitude);
    }
}
