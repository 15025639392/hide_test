package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TrackTrustDecision {
    public final String result;
    public final String reason;
    public final String trustGrade;
    public final String cloudType;
    public final long cloudId;
    public final int cloudSampleCount;
    public final double cloudWeightSum;
    public final double cloudWeightedRadiusMeters;
    public final double cloudCenterLatitude;
    public final double cloudCenterLongitude;
    public final long representativeRawPointId;
    public final List<Long> contributingRawPointIds;
    public final boolean virtualTrackPointCoordinate;
    public final TrackTrustScore score;
    public final long samplingEpochId;
    public final boolean startsNewSegment;
    public final double distanceDeltaMeters;
    public final double movingTimeDeltaSeconds;
    public final RawPoint sourceRawPoint;

    TrackTrustDecision(String result, String reason, String trustGrade, String cloudType,
                       long cloudId, int cloudSampleCount, double cloudWeightSum,
                       double cloudWeightedRadiusMeters, double cloudCenterLatitude,
                       double cloudCenterLongitude, long representativeRawPointId,
                       List<Long> contributingRawPointIds, boolean virtualTrackPointCoordinate,
                       TrackTrustScore score, long samplingEpochId, boolean startsNewSegment,
                       double distanceDeltaMeters, double movingTimeDeltaSeconds,
                       RawPoint sourceRawPoint) {
        this.result = result;
        this.reason = reason;
        this.trustGrade = trustGrade;
        this.cloudType = cloudType;
        this.cloudId = cloudId;
        this.cloudSampleCount = cloudSampleCount;
        this.cloudWeightSum = cloudWeightSum;
        this.cloudWeightedRadiusMeters = cloudWeightedRadiusMeters;
        this.cloudCenterLatitude = cloudCenterLatitude;
        this.cloudCenterLongitude = cloudCenterLongitude;
        this.representativeRawPointId = representativeRawPointId;
        this.contributingRawPointIds = Collections.unmodifiableList(
                new ArrayList<>(contributingRawPointIds));
        this.virtualTrackPointCoordinate = virtualTrackPointCoordinate;
        this.score = score;
        this.samplingEpochId = samplingEpochId;
        this.startsNewSegment = startsNewSegment;
        this.distanceDeltaMeters = distanceDeltaMeters;
        this.movingTimeDeltaSeconds = movingTimeDeltaSeconds;
        this.sourceRawPoint = sourceRawPoint;
    }

    public boolean createsTrustedTrackPoint() {
        return "anchor".equals(result) || "accept".equals(result);
    }
}
