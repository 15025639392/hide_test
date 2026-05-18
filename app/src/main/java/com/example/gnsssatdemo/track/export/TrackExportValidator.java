package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class TrackExportValidator {
    public String trustedGpxReferenceError(List<TrackPoint> trackPoints,
                                           long rawPointCount,
                                           long decisionCount) {
        return trustedGpxReferenceError(trackPoints, rawPointCount, decisionCount, null);
    }

    public String trustedGpxReferenceError(List<TrackPoint> trackPoints,
                                           long rawPointCount,
                                           long decisionCount,
                                           Set<Long> acceptedDecisionIds) {
        Set<Long> sourceDecisionIds = new HashSet<>();
        long previousDecisionId = 0L;
        long expectedTrackPointId = 1L;
        for (TrackPoint point : trackPoints) {
            if (point.trackPointId != expectedTrackPointId) {
                return "trackPointId 不连续: " + point.trackPointId;
            }
            if (point.sourceRawPointId <= 0L || point.sourceRawPointId > rawPointCount) {
                return "sourceRawPointId 越界: " + point.sourceRawPointId;
            }
            if (point.sourceDecisionId <= 0L || point.sourceDecisionId > decisionCount) {
                return "sourceDecisionId 越界: " + point.sourceDecisionId;
            }
            if (point.sourceDecisionId <= previousDecisionId) {
                return "sourceDecisionId 未递增: " + point.sourceDecisionId;
            }
            if (!sourceDecisionIds.add(point.sourceDecisionId)) {
                return "sourceDecisionId 重复: " + point.sourceDecisionId;
            }
            if (!"anchor".equals(point.decisionResult) && !"accept".equals(point.decisionResult)) {
                return "TrackPoint 指向非接受决策: " + point.decisionResult;
            }
            if (acceptedDecisionIds != null
                    && !acceptedDecisionIds.contains(point.sourceDecisionId)) {
                return "sourceDecisionId 未指向接受决策: " + point.sourceDecisionId;
            }
            if (point.decisionReason == null || point.decisionReason.isEmpty()) {
                return "decisionReason 为空";
            }
            previousDecisionId = point.sourceDecisionId;
            expectedTrackPointId++;
        }
        return null;
    }
}
