package com.example.gnsssatdemo.track.engine;

public class TrackTrustScore {
    public final int accuracyScore;
    public final int samplingContinuityScore;
    public final int timeContinuityScore;
    public final int spatialCohesionScore;
    public final int motionConsistencyScore;
    public final int gnssQualityScore;
    public final int speedPlausibilityScore;

    public TrackTrustScore(int accuracyScore, int samplingContinuityScore,
                           int timeContinuityScore, int spatialCohesionScore,
                           int motionConsistencyScore, int gnssQualityScore,
                           int speedPlausibilityScore) {
        this.accuracyScore = accuracyScore;
        this.samplingContinuityScore = samplingContinuityScore;
        this.timeContinuityScore = timeContinuityScore;
        this.spatialCohesionScore = spatialCohesionScore;
        this.motionConsistencyScore = motionConsistencyScore;
        this.gnssQualityScore = gnssQualityScore;
        this.speedPlausibilityScore = speedPlausibilityScore;
    }
}
