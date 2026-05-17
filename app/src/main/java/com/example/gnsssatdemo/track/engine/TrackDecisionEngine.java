package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

public class TrackDecisionEngine {
    public static final double IMPOSSIBLE_SPEED_METERS_PER_SECOND = 12.0;
    public static final double TRANSPORT_SUSPECTED_SPEED_METERS_PER_SECOND = 3.5;
    public static final double TRANSPORT_SUSPECTED_MAX_REASONABLE_SPEED_METERS_PER_SECOND = 45.0;
    public static final double TRANSPORT_SUSPECTED_MIN_DISTANCE_METERS = 60.0;
    public static final double TRANSPORT_SUSPECTED_WITH_SPEED_MIN_DISTANCE_METERS = 20.0;
    public static final double TRANSPORT_SUSPECTED_MIN_DELTA_SECONDS = 10.0;
    public static final long STATIONARY_KEEPALIVE_INTERVAL_NANOS = 30_000_000_000L;
    public static final long GAP_LINE_BREAK_NANOS = 120_000_000_000L;
    public static final long TRANSPORT_RECOVERY_STABLE_NANOS = 15_000_000_000L;
    public static final double TRANSPORT_RECOVERY_MAX_SPEED_METERS_PER_SECOND = 2.5;
    public static final double TRANSPORT_RECOVERY_MIN_DISTANCE_METERS = 12.0;

    public TrackDecisionResult decide(RawPoint rawPoint, TrackPoint previousTrackPoint,
                                      long lastStationaryKeepaliveElapsedRealtimeNanos,
                                      boolean forcedWeakFirstFixEnabled) {
        if (previousTrackPoint == null) {
            if (rawPoint.accuracyMeters <= 20f) {
                return result("anchor", "first_fix_good", 0.0, 0.0,
                        lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
            }
            if (rawPoint.accuracyMeters <= 30f) {
                return result("anchor", "first_fix_relaxed", 0.0, 0.0,
                        lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
            }
            if (forcedWeakFirstFixEnabled && rawPoint.accuracyMeters <= 50f) {
                return result("anchor", "forced_weak_first_fix", 0.0, 0.0,
                        lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
            }
            if (rawPoint.accuracyMeters <= 80f) {
                return result("weak", "weak_first_fix", 0.0, 0.0,
                        lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
            }
            return result("reject", "first_fix_accuracy_too_large", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
        }

        if (rawPoint.accuracyMeters > 30f) {
            return result("weak", "weak_signal_stage1", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
        }

        double distanceMeters = distanceMeters(previousTrackPoint.latitude, previousTrackPoint.longitude,
                rawPoint.latitude, rawPoint.longitude);
        double deltaSeconds = (rawPoint.elapsedRealtimeNanos
                - previousTrackPoint.elapsedRealtimeNanos) / 1_000_000_000.0;
        if (deltaSeconds <= 0.0) {
            return result("reject", "non_positive_delta_time", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
        }
        double requiredSpeed = distanceMeters / deltaSeconds;
        boolean reportedSpeedTransportSuspected =
                isReportedSpeedTransportSuspected(rawPoint, distanceMeters, requiredSpeed);
        if (requiredSpeed > IMPOSSIBLE_SPEED_METERS_PER_SECOND
                && !reportedSpeedTransportSuspected) {
            return result("reject", "impossible_speed", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
        }
        if (rawPoint.elapsedRealtimeNanos - previousTrackPoint.elapsedRealtimeNanos
                > GAP_LINE_BREAK_NANOS) {
            return result("accept", "gap_recovery", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0, true);
        }
        if (reportedSpeedTransportSuspected
                || isSustainedTransportSuspected(distanceMeters, deltaSeconds, requiredSpeed)) {
            return result("reject", "transport_suspected", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
        }
        if (distanceMeters < Math.max(5.0, rawPoint.accuracyMeters * 1.5)) {
            if (lastStationaryKeepaliveElapsedRealtimeNanos == 0L
                    || rawPoint.elapsedRealtimeNanos - lastStationaryKeepaliveElapsedRealtimeNanos
                    >= STATIONARY_KEEPALIVE_INTERVAL_NANOS) {
                return result("reject", "stationary_keepalive", 0.0, 0.0,
                        rawPoint.elapsedRealtimeNanos, 1, 0);
            }
            return result("reject", "stationary_jitter", 0.0, 0.0,
                    lastStationaryKeepaliveElapsedRealtimeNanos, 0, 1);
        }
        return result("accept", "moving_good_fix", distanceMeters, deltaSeconds,
                lastStationaryKeepaliveElapsedRealtimeNanos, 0, 0);
    }

    public boolean isTransportRecoveryCandidate(RawPoint previousRawPoint, RawPoint rawPoint) {
        if (previousRawPoint == null || rawPoint == null) {
            return false;
        }
        double deltaSeconds = (rawPoint.elapsedRealtimeNanos
                - previousRawPoint.elapsedRealtimeNanos) / 1_000_000_000.0;
        if (deltaSeconds <= 0.0) {
            return false;
        }
        if (rawPoint.accuracyMeters > 30f) {
            return false;
        }
        if (rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond > TRANSPORT_RECOVERY_MAX_SPEED_METERS_PER_SECOND) {
            return false;
        }
        double distanceMeters = distanceMeters(previousRawPoint.latitude, previousRawPoint.longitude,
                rawPoint.latitude, rawPoint.longitude);
        return distanceMeters / deltaSeconds <= TRANSPORT_RECOVERY_MAX_SPEED_METERS_PER_SECOND;
    }

    public double rawDistanceMeters(RawPoint from, RawPoint to) {
        return distanceMeters(from.latitude, from.longitude, to.latitude, to.longitude);
    }

    private boolean isReportedSpeedTransportSuspected(RawPoint rawPoint, double distanceMeters,
                                                      double requiredSpeed) {
        double reportedSpeed = rawPoint.speedMetersPerSecond;
        boolean reportedSpeedReasonable = reportedSpeed >= TRANSPORT_SUSPECTED_SPEED_METERS_PER_SECOND
                && reportedSpeed <= TRANSPORT_SUSPECTED_MAX_REASONABLE_SPEED_METERS_PER_SECOND;
        return rawPoint.hasSpeed
                && reportedSpeedReasonable
                && requiredSpeed >= TRANSPORT_SUSPECTED_SPEED_METERS_PER_SECOND
                && requiredSpeed <= TRANSPORT_SUSPECTED_MAX_REASONABLE_SPEED_METERS_PER_SECOND
                && distanceMeters >= TRANSPORT_SUSPECTED_WITH_SPEED_MIN_DISTANCE_METERS;
    }

    private boolean isSustainedTransportSuspected(double distanceMeters,
                                                  double deltaSeconds,
                                                  double requiredSpeed) {
        return requiredSpeed >= TRANSPORT_SUSPECTED_SPEED_METERS_PER_SECOND
                && requiredSpeed <= IMPOSSIBLE_SPEED_METERS_PER_SECOND
                && distanceMeters >= TRANSPORT_SUSPECTED_MIN_DISTANCE_METERS
                && deltaSeconds >= TRANSPORT_SUSPECTED_MIN_DELTA_SECONDS;
    }

    private TrackDecisionResult result(String result, String reason,
                                       double distanceDeltaMeters, double movingTimeDeltaSeconds,
                                       long nextStationaryKeepaliveElapsedRealtimeNanos,
                                       int stationaryKeepaliveIncrement,
                                       int stationaryJitterIncrement) {
        return result(result, reason, distanceDeltaMeters, movingTimeDeltaSeconds,
                nextStationaryKeepaliveElapsedRealtimeNanos,
                stationaryKeepaliveIncrement, stationaryJitterIncrement, false);
    }

    private TrackDecisionResult result(String result, String reason,
                                       double distanceDeltaMeters, double movingTimeDeltaSeconds,
                                       long nextStationaryKeepaliveElapsedRealtimeNanos,
                                       int stationaryKeepaliveIncrement,
                                       int stationaryJitterIncrement,
                                       boolean startsNewSegment) {
        return new TrackDecisionResult(result, reason, distanceDeltaMeters, movingTimeDeltaSeconds,
                nextStationaryKeepaliveElapsedRealtimeNanos,
                stationaryKeepaliveIncrement, stationaryJitterIncrement, startsNewSegment);
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
}
