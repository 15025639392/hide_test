package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.List;

public class RestAnchorRefiner {
    public static final String REASON_ANCHOR_REFINED = "stationary_anchor_refined";
    public static final String REASON_ACCEL_SUPPORTED_JITTER =
            "stationary_accel_supported_jitter";
    public static final String REASON_STATIONARY_GAP_RECOVERY =
            "stationary_gap_recovery";

    private static final double REST_ANCHOR_RADIUS_METERS = 15.0;
    private static final double MAX_REST_SPEED_METERS_PER_SECOND = 0.5;
    private static final long MOTION_EVIDENCE_WINDOW_NANOS = 5_000_000_000L;
    private static final int MIN_STILL_SUMMARY_COUNT = 2;
    private static final int MIN_MOTION_SAMPLE_COUNT = 12;
    private static final double MIN_STILL_SUMMARY_RATIO = 0.75;
    private static final float MIN_ACCURACY_IMPROVEMENT_METERS = 1.0f;
    private static final float STRONG_ACCURACY_IMPROVEMENT_RATIO = 0.85f;
    private static final int MIN_USED_SATELLITE_IMPROVEMENT = 2;
    private static final float MIN_TOP4_CN0_IMPROVEMENT = 2.0f;

    public Decision refine(TrackDecisionResult outcome, RawPoint rawPoint,
                           TrackPoint previousTrackPoint,
                           GnssQualitySnapshot currentSnapshot,
                           GnssQualitySnapshot previousSnapshot,
                           List<MotionSummary> recentMotionSummaries) {
        return refine(outcome, rawPoint, previousTrackPoint, null, currentSnapshot,
                previousSnapshot, recentMotionSummaries);
    }

    public Decision refine(TrackDecisionResult outcome, RawPoint rawPoint,
                           TrackPoint previousTrackPoint,
                           TrackPoint exportedRestAnchorTrackPoint,
                           GnssQualitySnapshot currentSnapshot,
                           GnssQualitySnapshot previousSnapshot,
                           List<MotionSummary> recentMotionSummaries) {
        if (outcome == null || rawPoint == null || previousTrackPoint == null) {
            return Decision.noop();
        }
        if (outcome.distanceDeltaMeters > REST_ANCHOR_RADIUS_METERS) {
            return Decision.noop();
        }
        if (rawPoint.hasSpeed && rawPoint.speedMetersPerSecond > MAX_REST_SPEED_METERS_PER_SECOND) {
            return Decision.noop();
        }
        if (!hasStationaryEvidence(rawPoint.elapsedRealtimeNanos, recentMotionSummaries)) {
            return Decision.noop();
        }
        if (isGapRecovery(outcome)) {
            double distanceMeters = distanceMeters(previousTrackPoint.latitude,
                    previousTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
            if (distanceMeters <= REST_ANCHOR_RADIUS_METERS) {
                if (exportedRestAnchorTrackPoint == null
                        || distanceMeters(exportedRestAnchorTrackPoint.latitude,
                        exportedRestAnchorTrackPoint.longitude,
                        rawPoint.latitude, rawPoint.longitude) <= REST_ANCHOR_RADIUS_METERS) {
                    return Decision.rejectStationaryGap();
                }
            }
            return Decision.noop();
        }
        if (!isMovingGoodFix(outcome)) {
            return Decision.noop();
        }
        if (canReplaceTrackPoint(previousTrackPoint)
                && isBetterRestAnchor(rawPoint, currentSnapshot,
                previousTrackPoint, previousSnapshot)) {
            return Decision.refine();
        }
        return Decision.rejectJitter();
    }

    private boolean isMovingGoodFix(TrackDecisionResult outcome) {
        return outcome != null
                && "accept".equals(outcome.result)
                && "moving_good_fix".equals(outcome.reason);
    }

    private boolean isGapRecovery(TrackDecisionResult outcome) {
        return "accept".equals(outcome.result)
                && "gap_recovery".equals(outcome.reason);
    }

    private boolean hasStationaryEvidence(long elapsedRealtimeNanos,
                                          List<MotionSummary> recentMotionSummaries) {
        if (recentMotionSummaries == null || recentMotionSummaries.isEmpty()) {
            return false;
        }
        int summaryCount = 0;
        int stillCount = 0;
        int sampleCount = 0;
        long cutoff = elapsedRealtimeNanos - MOTION_EVIDENCE_WINDOW_NANOS;
        for (MotionSummary summary : recentMotionSummaries) {
            if (summary == null || summary.lastElapsedRealtimeNanos < cutoff
                    || summary.firstElapsedRealtimeNanos > elapsedRealtimeNanos) {
                continue;
            }
            summaryCount++;
            sampleCount += summary.sampleCount;
            if (summary.deviceStill) {
                stillCount++;
            }
        }
        if (summaryCount < MIN_STILL_SUMMARY_COUNT || sampleCount < MIN_MOTION_SAMPLE_COUNT) {
            return false;
        }
        return stillCount / (double) summaryCount >= MIN_STILL_SUMMARY_RATIO;
    }

    private boolean canReplaceTrackPoint(TrackPoint previousTrackPoint) {
        return previousTrackPoint.distanceDeltaMeters == 0.0
                && previousTrackPoint.movingTimeDeltaSeconds == 0.0;
    }

    private boolean isBetterRestAnchor(RawPoint rawPoint, GnssQualitySnapshot currentSnapshot,
                                       TrackPoint previousTrackPoint,
                                       GnssQualitySnapshot previousSnapshot) {
        if (rawPoint.accuracyMeters + MIN_ACCURACY_IMPROVEMENT_METERS
                < previousTrackPoint.accuracyMeters) {
            return true;
        }
        if (rawPoint.accuracyMeters
                <= previousTrackPoint.accuracyMeters * STRONG_ACCURACY_IMPROVEMENT_RATIO) {
            return true;
        }
        if (Math.abs(rawPoint.accuracyMeters - previousTrackPoint.accuracyMeters)
                > MIN_ACCURACY_IMPROVEMENT_METERS) {
            return false;
        }
        if (currentSnapshot == null || previousSnapshot == null) {
            return false;
        }
        if (currentSnapshot.usedInFixTotal
                >= previousSnapshot.usedInFixTotal + MIN_USED_SATELLITE_IMPROVEMENT) {
            return true;
        }
        return currentSnapshot.top4AvgCn0
                >= previousSnapshot.top4AvgCn0 + MIN_TOP4_CN0_IMPROVEMENT;
    }

    private double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double earthRadiusMeters = 6_371_000.0;
        double lat1Rad = Math.toRadians(lat1);
        double lat2Rad = Math.toRadians(lat2);
        double deltaLat = Math.toRadians(lat2 - lat1);
        double deltaLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(deltaLat / 2.0) * Math.sin(deltaLat / 2.0)
                + Math.cos(lat1Rad) * Math.cos(lat2Rad)
                * Math.sin(deltaLon / 2.0) * Math.sin(deltaLon / 2.0);
        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return earthRadiusMeters * c;
    }

    public static class Decision {
        public final boolean handled;
        public final boolean refineAnchor;
        public final String reason;

        private Decision(boolean handled, boolean refineAnchor, String reason) {
            this.handled = handled;
            this.refineAnchor = refineAnchor;
            this.reason = reason;
        }

        static Decision noop() {
            return new Decision(false, false, "");
        }

        static Decision refine() {
            return new Decision(true, true, REASON_ANCHOR_REFINED);
        }

        static Decision rejectJitter() {
            return new Decision(true, false, REASON_ACCEL_SUPPORTED_JITTER);
        }

        static Decision rejectStationaryGap() {
            return new Decision(true, false, REASON_STATIONARY_GAP_RECOVERY);
        }
    }
}
