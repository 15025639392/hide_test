package com.example.gnsssatdemo.track.engine;

public class SamplingEpoch {
    public final long samplingEpochId;
    public final String state;
    public final long requestedMinTimeMillis;
    public final float requestedMinDistanceMeters;
    public final long startedElapsedRealtimeNanos;

    public SamplingEpoch(long samplingEpochId, String state, long requestedMinTimeMillis,
                         float requestedMinDistanceMeters,
                         long startedElapsedRealtimeNanos) {
        this.samplingEpochId = samplingEpochId;
        this.state = state == null ? "" : state;
        this.requestedMinTimeMillis = requestedMinTimeMillis;
        this.requestedMinDistanceMeters = requestedMinDistanceMeters;
        this.startedElapsedRealtimeNanos = startedElapsedRealtimeNanos;
    }
}
