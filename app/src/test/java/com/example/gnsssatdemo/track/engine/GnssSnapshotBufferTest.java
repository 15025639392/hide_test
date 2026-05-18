package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class GnssSnapshotBufferTest {
    private final GnssSnapshotBuffer buffer = new GnssSnapshotBuffer();

    @Test
    public void match_prefersNearestPastSnapshot() {
        buffer.remember(snapshot(1L, 1_000_000_000L));
        buffer.remember(snapshot(2L, 2_000_000_000L));
        buffer.remember(snapshot(3L, 5_000_000_000L));

        GnssSnapshotBuffer.Match match = buffer.match(2_500_000_000L);

        assertEquals(Long.valueOf(2L), match.snapshotId);
        assertFalse(match.matchedFromFuture);
        assertFalse(match.stale);
        assertEquals(500_000_000L, match.snapshotAgeNanos);
    }

    @Test
    public void match_usesFutureSnapshotWhenPastIsUnavailable() {
        buffer.remember(snapshot(1L, 4_000_000_000L));

        GnssSnapshotBuffer.Match match = buffer.match(2_000_000_000L);

        assertEquals(Long.valueOf(1L), match.snapshotId);
        assertTrue(match.matchedFromFuture);
        assertFalse(match.stale);
        assertEquals(2_000_000_000L, match.snapshotAgeNanos);
    }

    @Test
    public void match_returnsStaleWhenOutsideWindow() {
        buffer.remember(snapshot(1L, 1_000_000_000L));

        GnssSnapshotBuffer.Match match = buffer.match(5_000_000_001L);

        assertNull(match.snapshotId);
        assertFalse(match.matchedFromFuture);
        assertTrue(match.stale);
        assertEquals(-1L, match.snapshotAgeNanos);
    }

    @Test
    public void remember_trimsOldSnapshotsByRetentionWindow() {
        buffer.remember(snapshot(1L, 1_000_000_000L));
        buffer.remember(snapshot(2L, 302_000_000_001L));

        GnssSnapshotBuffer.Match match = buffer.match(1_000_000_000L);

        assertTrue(match.stale);
        assertNull(match.snapshotId);
    }

    private GnssQualitySnapshot snapshot(long id, long elapsedRealtimeNanos) {
        return new GnssQualitySnapshot(id, elapsedRealtimeNanos,
                10, 5, 30f, 1, 2, 1, 1, 0);
    }
}
