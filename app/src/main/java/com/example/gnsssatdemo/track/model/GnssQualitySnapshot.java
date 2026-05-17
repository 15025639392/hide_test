package com.example.gnsssatdemo.track.model;

public class GnssQualitySnapshot {
    public final long snapshotId;
    public final long receivedElapsedRealtimeNanos;
    public final int visibleTotal;
    public final int usedInFixTotal;
    public final float usedAvgCn0;
    public final int gpsUsed;
    public final int beidouUsed;
    public final int galileoUsed;
    public final int glonassUsed;
    public final int qzssUsed;

    public GnssQualitySnapshot(long snapshotId, long receivedElapsedRealtimeNanos,
                               int visibleTotal, int usedInFixTotal, float usedAvgCn0,
                               int gpsUsed, int beidouUsed, int galileoUsed,
                               int glonassUsed, int qzssUsed) {
        this.snapshotId = snapshotId;
        this.receivedElapsedRealtimeNanos = receivedElapsedRealtimeNanos;
        this.visibleTotal = visibleTotal;
        this.usedInFixTotal = usedInFixTotal;
        this.usedAvgCn0 = usedAvgCn0;
        this.gpsUsed = gpsUsed;
        this.beidouUsed = beidouUsed;
        this.galileoUsed = galileoUsed;
        this.glonassUsed = glonassUsed;
        this.qzssUsed = qzssUsed;
    }
}
