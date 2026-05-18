package com.example.gnsssatdemo.track.engine;

public class TrackStatsAccumulator {
    private int stationaryKeepaliveCount;
    private int stationaryJitterCount;
    private int gapCount;
    private int transportCount;
    private double totalDistanceMeters;
    private double movingTimeSeconds;

    public void reset() {
        stationaryKeepaliveCount = 0;
        stationaryJitterCount = 0;
        gapCount = 0;
        transportCount = 0;
        totalDistanceMeters = 0.0;
        movingTimeSeconds = 0.0;
    }

    public void addAcceptedMovement(TrackDecisionResult outcome) {
        totalDistanceMeters += outcome.distanceDeltaMeters;
        movingTimeSeconds += outcome.movingTimeDeltaSeconds;
    }

    public void addStationaryDecision(TrackDecisionResult outcome) {
        stationaryKeepaliveCount += outcome.stationaryKeepaliveIncrement;
        stationaryJitterCount += outcome.stationaryJitterIncrement;
    }

    public void incrementGapCount() {
        gapCount++;
    }

    public void incrementTransportCount() {
        transportCount++;
    }

    public int getStationaryKeepaliveCount() {
        return stationaryKeepaliveCount;
    }

    public int getStationaryJitterCount() {
        return stationaryJitterCount;
    }

    public int getGapCount() {
        return gapCount;
    }

    public int getTransportCount() {
        return transportCount;
    }

    public double getTotalDistanceMeters() {
        return totalDistanceMeters;
    }

    public double getMovingTimeSeconds() {
        return movingTimeSeconds;
    }
}
