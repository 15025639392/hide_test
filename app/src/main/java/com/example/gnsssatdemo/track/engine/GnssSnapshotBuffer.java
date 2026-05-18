package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;

import java.util.ArrayList;
import java.util.List;

public class GnssSnapshotBuffer {
    private static final long MATCH_WINDOW_NANOS = 3_000_000_000L;
    private static final long RETENTION_NANOS = 300_000_000_000L;
    private static final int RETENTION_COUNT = 300;

    private final List<GnssQualitySnapshot> snapshots = new ArrayList<>();

    public void clear() {
        snapshots.clear();
    }

    public void remember(GnssQualitySnapshot snapshot) {
        if (snapshot == null) {
            return;
        }
        snapshots.add(snapshot);
        long cutoff = snapshot.receivedElapsedRealtimeNanos - RETENTION_NANOS;
        while (!snapshots.isEmpty()
                && (snapshots.size() > RETENTION_COUNT
                || snapshots.get(0).receivedElapsedRealtimeNanos < cutoff)) {
            snapshots.remove(0);
        }
    }

    public Match match(long locationElapsedRealtimeNanos) {
        if (locationElapsedRealtimeNanos <= 0L || snapshots.isEmpty()) {
            return Match.stale();
        }
        GnssQualitySnapshot bestPast = null;
        long bestPastAge = Long.MAX_VALUE;
        GnssQualitySnapshot bestFuture = null;
        long bestFutureAge = Long.MAX_VALUE;
        for (GnssQualitySnapshot snapshot : snapshots) {
            long delta = locationElapsedRealtimeNanos - snapshot.receivedElapsedRealtimeNanos;
            if (delta >= 0L && delta <= MATCH_WINDOW_NANOS && delta < bestPastAge) {
                bestPast = snapshot;
                bestPastAge = delta;
            } else if (delta < 0L && -delta <= MATCH_WINDOW_NANOS && -delta < bestFutureAge) {
                bestFuture = snapshot;
                bestFutureAge = -delta;
            }
        }
        if (bestPast != null) {
            return new Match(bestPast.snapshotId, false, false, bestPastAge);
        }
        if (bestFuture != null) {
            return new Match(bestFuture.snapshotId, true, false, bestFutureAge);
        }
        return Match.stale();
    }

    public static class Match {
        public final Long snapshotId;
        public final boolean matchedFromFuture;
        public final boolean stale;
        public final long snapshotAgeNanos;

        Match(Long snapshotId, boolean matchedFromFuture, boolean stale, long snapshotAgeNanos) {
            this.snapshotId = snapshotId;
            this.matchedFromFuture = matchedFromFuture;
            this.stale = stale;
            this.snapshotAgeNanos = snapshotAgeNanos;
        }

        static Match stale() {
            return new Match(null, false, true, -1L);
        }
    }
}
