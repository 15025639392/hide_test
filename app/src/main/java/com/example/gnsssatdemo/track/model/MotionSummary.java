package com.example.gnsssatdemo.track.model;

public class MotionSummary {
    public final long motionSummaryId;
    public final long firstElapsedRealtimeNanos;
    public final long lastElapsedRealtimeNanos;
    public final int sampleCount;
    public final double dynamicAccelRmsMps2;
    public final double stillScore;
    public final boolean deviceStill;
    public final String sourceSensorType;

    public MotionSummary(long motionSummaryId, long firstElapsedRealtimeNanos,
                         long lastElapsedRealtimeNanos, int sampleCount,
                         double dynamicAccelRmsMps2, double stillScore,
                         boolean deviceStill, String sourceSensorType) {
        this.motionSummaryId = motionSummaryId;
        this.firstElapsedRealtimeNanos = firstElapsedRealtimeNanos;
        this.lastElapsedRealtimeNanos = lastElapsedRealtimeNanos;
        this.sampleCount = sampleCount;
        this.dynamicAccelRmsMps2 = dynamicAccelRmsMps2;
        this.stillScore = stillScore;
        this.deviceStill = deviceStill;
        this.sourceSensorType = sourceSensorType;
    }
}
