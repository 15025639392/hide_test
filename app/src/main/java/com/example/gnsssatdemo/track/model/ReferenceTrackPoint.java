package com.example.gnsssatdemo.track.model;

public class ReferenceTrackPoint {
    public final double latitude;
    public final double longitude;
    public final int segmentIndex;
    public final long timeMillis;

    public ReferenceTrackPoint(double latitude, double longitude, int segmentIndex) {
        this(latitude, longitude, segmentIndex, 0L);
    }

    public ReferenceTrackPoint(double latitude, double longitude, int segmentIndex,
                               long timeMillis) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.segmentIndex = segmentIndex;
        this.timeMillis = timeMillis;
    }
}
