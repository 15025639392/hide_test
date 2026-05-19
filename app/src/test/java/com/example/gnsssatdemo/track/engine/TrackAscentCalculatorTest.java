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

        assertEquals(0.0, ascent, 0.0001);
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
}
