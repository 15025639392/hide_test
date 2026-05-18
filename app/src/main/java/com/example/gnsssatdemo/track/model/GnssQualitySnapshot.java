package com.example.gnsssatdemo.track.model;

public class GnssQualitySnapshot {
    public final long snapshotId;
    public final long receivedElapsedRealtimeNanos;
    public final int visibleTotal;
    public final int usedInFixTotal;
    public final float usedAvgCn0;
    public final float allAvgCn0;
    public final float top4AvgCn0;
    public final int lowCn0VisibleCount;
    public final int weakUsedCount;
    public final int gpsUsed;
    public final int beidouUsed;
    public final int galileoUsed;
    public final int glonassUsed;
    public final int qzssUsed;
    public final int gpsVisible;
    public final int beidouVisible;
    public final int galileoVisible;
    public final int glonassVisible;
    public final int qzssVisible;
    public final int sbasVisible;
    public final int irnssVisible;
    public final int unknownVisible;
    public final int otherVisible;
    public final boolean hasDualFrequency;

    public GnssQualitySnapshot(long snapshotId, long receivedElapsedRealtimeNanos,
                               int visibleTotal, int usedInFixTotal, float usedAvgCn0,
                               int gpsUsed, int beidouUsed, int galileoUsed,
                               int glonassUsed, int qzssUsed) {
        this(snapshotId, receivedElapsedRealtimeNanos, visibleTotal, usedInFixTotal, usedAvgCn0,
                usedAvgCn0, usedAvgCn0, 0, 0, gpsUsed, beidouUsed, galileoUsed, glonassUsed,
                qzssUsed, 0, 0, 0, 0, 0, 0, 0, 0, 0, false);
    }

    public GnssQualitySnapshot(long snapshotId, long receivedElapsedRealtimeNanos,
                               int visibleTotal, int usedInFixTotal, float usedAvgCn0,
                               float allAvgCn0, float top4AvgCn0,
                               int lowCn0VisibleCount, int weakUsedCount,
                               int gpsUsed, int beidouUsed, int galileoUsed,
                               int glonassUsed, int qzssUsed,
                               int gpsVisible, int beidouVisible, int galileoVisible,
                               int glonassVisible, int qzssVisible,
                               int sbasVisible, int irnssVisible, int unknownVisible,
                               int otherVisible,
                               boolean hasDualFrequency) {
        this.snapshotId = snapshotId;
        this.receivedElapsedRealtimeNanos = receivedElapsedRealtimeNanos;
        this.visibleTotal = visibleTotal;
        this.usedInFixTotal = usedInFixTotal;
        this.usedAvgCn0 = usedAvgCn0;
        this.allAvgCn0 = allAvgCn0;
        this.top4AvgCn0 = top4AvgCn0;
        this.lowCn0VisibleCount = lowCn0VisibleCount;
        this.weakUsedCount = weakUsedCount;
        this.gpsUsed = gpsUsed;
        this.beidouUsed = beidouUsed;
        this.galileoUsed = galileoUsed;
        this.glonassUsed = glonassUsed;
        this.qzssUsed = qzssUsed;
        this.gpsVisible = gpsVisible;
        this.beidouVisible = beidouVisible;
        this.galileoVisible = galileoVisible;
        this.glonassVisible = glonassVisible;
        this.qzssVisible = qzssVisible;
        this.sbasVisible = sbasVisible;
        this.irnssVisible = irnssVisible;
        this.unknownVisible = unknownVisible;
        this.otherVisible = otherVisible;
        this.hasDualFrequency = hasDualFrequency;
    }
}
