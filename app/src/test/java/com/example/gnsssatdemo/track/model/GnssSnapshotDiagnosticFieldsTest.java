package com.example.gnsssatdemo.track.model;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class GnssSnapshotDiagnosticFieldsTest {
    @Test
    public void toEvent_writesLegacyAndWeakSignalDiagnosticFields() throws Exception {
        GnssQualitySnapshot snapshot = new GnssQualitySnapshot(9L, 123L,
                8, 3, 25.666f, 22.875f, 32.25f,
                4, 2, 1, 1, 0, 1, 0,
                1, 1, 1, 1, 1, 1, 1, 1, 0, true);

        JSONObject event = new GnssSnapshotDiagnosticFields().toEvent(snapshot);

        assertEquals("gnss_snapshot", event.getString("event"));
        assertEquals(9L, event.getLong("snapshotId"));
        assertEquals(123L, event.getLong("receivedElapsedRealtimeNanos"));
        assertEquals(8, event.getInt("visibleTotal"));
        assertEquals(3, event.getInt("usedInFixTotal"));
        assertEquals(25.666, event.getDouble("usedAvgCn0"), 0.001);
        assertEquals(22.875, event.getDouble("allAvgCn0"), 0.001);
        assertEquals(32.25, event.getDouble("top4AvgCn0"), 0.001);
        assertEquals(4, event.getInt("lowCn0VisibleCount"));
        assertEquals(2, event.getInt("weakUsedCount"));
        assertEquals(1, event.getInt("gpsUsed"));
        assertEquals(1, event.getInt("beidouUsed"));
        assertEquals(0, event.getInt("galileoUsed"));
        assertEquals(1, event.getInt("glonassUsed"));
        assertEquals(0, event.getInt("qzssUsed"));
        assertEquals(1, event.getInt("gpsVisible"));
        assertEquals(1, event.getInt("beidouVisible"));
        assertEquals(1, event.getInt("galileoVisible"));
        assertEquals(1, event.getInt("glonassVisible"));
        assertEquals(1, event.getInt("qzssVisible"));
        assertEquals(1, event.getInt("sbasVisible"));
        assertEquals(1, event.getInt("irnssVisible"));
        assertEquals(1, event.getInt("unknownVisible"));
        assertEquals(0, event.getInt("otherVisible"));
        assertTrue(event.getBoolean("hasDualFrequency"));
    }
}
