package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

public class TrackDecisionEngine {
    public static final double IMPOSSIBLE_SPEED_METERS_PER_SECOND = 12.0;
    public static final long STATIONARY_KEEPALIVE_INTERVAL_NANOS = 30_000_000_000L;

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
        if (requiredSpeed > IMPOSSIBLE_SPEED_METERS_PER_SECOND) {
            return result("reject", "impossible_speed", 0.0, 0.0,
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

    private TrackDecisionResult result(String result, String reason,
                                       double distanceDeltaMeters, double movingTimeDeltaSeconds,
                                       long nextStationaryKeepaliveElapsedRealtimeNanos,
                                       int stationaryKeepaliveIncrement,
                                       int stationaryJitterIncrement) {
        return new TrackDecisionResult(result, reason, distanceDeltaMeters, movingTimeDeltaSeconds,
                nextStationaryKeepaliveElapsedRealtimeNanos,
                stationaryKeepaliveIncrement, stationaryJitterIncrement);
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
