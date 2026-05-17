package com.example.gnsssatdemo.track.model;

public class ReferenceTrackPoint {
    public final double latitude;
    public final double longitude;
    public final int segmentIndex;

    public ReferenceTrackPoint(double latitude, double longitude, int segmentIndex) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.segmentIndex = segmentIndex;
    }
}
