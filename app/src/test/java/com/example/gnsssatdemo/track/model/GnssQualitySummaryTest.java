package com.example.gnsssatdemo.track.model;

import android.location.GnssStatus;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class GnssQualitySummaryTest {
    @Test
    public void toSnapshot_summarizesCn0ConstellationsAndCarrierBands() {
        GnssQualitySummary summary = new GnssQualitySummary();

        summary.addSatellite(GnssStatus.CONSTELLATION_GPS, true, 35f,
                true, 1_575_420_000f);
        summary.addSatellite(GnssStatus.CONSTELLATION_BEIDOU, true, 18f,
                true, 1_561_098_000f);
        summary.addSatellite(GnssStatus.CONSTELLATION_GALILEO, false, 30f,
                false, 0f);
        summary.addSatellite(GnssStatus.CONSTELLATION_GLONASS, true, 24f,
                false, 0f);
        summary.addSatellite(GnssStatus.CONSTELLATION_QZSS, false, 40f,
                false, 0f);
        summary.addSatellite(GnssStatus.CONSTELLATION_SBAS, false, 10f,
                false, 0f);
        summary.addSatellite(GnssStatus.CONSTELLATION_IRNSS, false, 12f,
                false, 0f);
        summary.addSatellite(GnssStatus.CONSTELLATION_UNKNOWN, false, 14f,
                false, 0f);

        GnssQualitySnapshot snapshot = summary.toSnapshot(7L, 123L);

        assertEquals(7L, snapshot.snapshotId);
        assertEquals(123L, snapshot.receivedElapsedRealtimeNanos);
        assertEquals(8, snapshot.visibleTotal);
        assertEquals(3, snapshot.usedInFixTotal);
        assertEquals((35f + 18f + 24f) / 3f, snapshot.usedAvgCn0, 0.001f);
        assertEquals((35f + 18f + 30f + 24f + 40f + 10f + 12f + 14f) / 8f,
                snapshot.allAvgCn0, 0.001f);
        assertEquals((40f + 35f + 30f + 24f) / 4f, snapshot.top4AvgCn0, 0.001f);
        assertEquals(4, snapshot.lowCn0VisibleCount);
        assertEquals(2, snapshot.weakUsedCount);
        assertEquals(1, snapshot.gpsUsed);
        assertEquals(1, snapshot.beidouUsed);
        assertEquals(0, snapshot.galileoUsed);
        assertEquals(1, snapshot.glonassUsed);
        assertEquals(0, snapshot.qzssUsed);
        assertEquals(1, snapshot.gpsVisible);
        assertEquals(1, snapshot.beidouVisible);
        assertEquals(1, snapshot.galileoVisible);
        assertEquals(1, snapshot.glonassVisible);
        assertEquals(1, snapshot.qzssVisible);
        assertEquals(1, snapshot.sbasVisible);
        assertEquals(1, snapshot.irnssVisible);
        assertEquals(1, snapshot.unknownVisible);
        assertEquals(0, snapshot.otherVisible);
        assertTrue(snapshot.hasDualFrequency);
    }
}
