package com.example.gnsssatdemo.track.engine;

public class TrackDecisionResult {
    public final String result;
    public final String reason;
    public final double distanceDeltaMeters;
    public final double movingTimeDeltaSeconds;
    public final long nextStationaryKeepaliveElapsedRealtimeNanos;
    public final int stationaryKeepaliveIncrement;
    public final int stationaryJitterIncrement;

    public TrackDecisionResult(String result, String reason,
                               double distanceDeltaMeters, double movingTimeDeltaSeconds,
                               long nextStationaryKeepaliveElapsedRealtimeNanos,
                               int stationaryKeepaliveIncrement,
                               int stationaryJitterIncrement) {
        this.result = result;
        this.reason = reason;
        this.distanceDeltaMeters = distanceDeltaMeters;
        this.movingTimeDeltaSeconds = movingTimeDeltaSeconds;
        this.nextStationaryKeepaliveElapsedRealtimeNanos = nextStationaryKeepaliveElapsedRealtimeNanos;
        this.stationaryKeepaliveIncrement = stationaryKeepaliveIncrement;
        this.stationaryJitterIncrement = stationaryJitterIncrement;
    }
}
