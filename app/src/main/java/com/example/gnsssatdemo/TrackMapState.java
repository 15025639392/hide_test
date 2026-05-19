package com.example.gnsssatdemo;

import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.ArrayList;
import java.util.List;

class TrackMapState {
    static final float MIN_GNSS_BEARING_SPEED_METERS_PER_SECOND = 0.8f;
    static final double MIN_TRACK_HEADING_DISTANCE_METERS = 5.0d;

    final List<TrackPoint> points;
    final MapPoint currentPoint;
    final float accuracyMeters;
    final float headingDegrees;
    final double totalDistanceMeters;
    final double totalAscentMeters;

    TrackMapState(List<TrackPoint> points, MapPoint currentPoint, float accuracyMeters,
                  float headingDegrees, double totalDistanceMeters, double totalAscentMeters) {
        this.points = new ArrayList<>(points);
        this.currentPoint = currentPoint;
        this.accuracyMeters = accuracyMeters;
        this.headingDegrees = headingDegrees;
        this.totalDistanceMeters = totalDistanceMeters;
        this.totalAscentMeters = totalAscentMeters;
    }

    static TrackMapState build(List<TrackPoint> points, Fallback fallback) {
        TrackPoint trustedPoint = lastTrustedMapTrackPoint(points);
        MapPoint currentPoint = currentMapPoint(trustedPoint, fallback);
        float accuracyMeters = currentAccuracyMeters(trustedPoint, fallback);
        float heading = effectiveHeadingDegrees(points, trustedPoint, fallback);
        double distanceMeters = totalDistanceMeters(points, fallback);
        double ascentMeters = totalAscentMeters(points, fallback);
        return new TrackMapState(points, currentPoint, accuracyMeters, heading,
                distanceMeters, ascentMeters);
    }

    static boolean isWeakMapPoint(TrackPoint point) {
        return "weak".equals(point.decisionResult);
    }

    static boolean isTransportMapPoint(TrackPoint point) {
        return "transport".equals(point.decisionResult)
                || "transport_suspected".equals(point.decisionReason)
                || "transport_confirmed".equals(point.decisionReason);
    }

    private static TrackPoint lastTrustedMapTrackPoint(List<TrackPoint> points) {
        for (int i = points.size() - 1; i >= 0; i--) {
            TrackPoint point = points.get(i);
            if (!isWeakMapPoint(point) && !isTransportMapPoint(point)) {
                return point;
            }
        }
        return null;
    }

    private static MapPoint currentMapPoint(TrackPoint trustedPoint, Fallback fallback) {
        if (trustedPoint != null) {
            return new MapPoint(trustedPoint.latitude, trustedPoint.longitude);
        }
        if (fallback.foregroundRecording && fallback.foregroundHasLocation) {
            return new MapPoint(fallback.foregroundLatitude, fallback.foregroundLongitude);
        }
        if (fallback.hasLastLocation) {
            return new MapPoint(fallback.lastLatitude, fallback.lastLongitude);
        }
        return null;
    }

    private static float currentAccuracyMeters(TrackPoint trustedPoint, Fallback fallback) {
        if (trustedPoint != null) {
            return Math.max(0f, trustedPoint.accuracyMeters);
        }
        if (fallback.foregroundRecording && fallback.foregroundHasLocation) {
            return Math.max(0f, fallback.foregroundAccuracyMeters);
        }
        if (fallback.hasLastLocation) {
            return fallback.lastAccuracyMeters;
        }
        return 0f;
    }

    private static float effectiveHeadingDegrees(List<TrackPoint> points, TrackPoint trustedPoint,
                                                 Fallback fallback) {
        if (trustedPoint != null
                && (!shouldGateTrustedHeadingByLiveMovement(fallback)
                || currentMovementReliable(fallback))) {
            if (hasReliableGnssBearing(trustedPoint.hasBearing, trustedPoint.hasSpeed,
                    trustedPoint.speedMetersPerSecond)) {
                return trustedPoint.bearingDegrees;
            }
            float trackHeading = trustedTrackHeadingDegrees(points, trustedPoint);
            if (!Float.isNaN(trackHeading)) {
                return trackHeading;
            }
        }
        if (fallback.foregroundRecording
                && hasReliableGnssBearing(fallback.foregroundHasBearing,
                fallback.foregroundHasSpeed, fallback.foregroundSpeedMetersPerSecond)) {
            return fallback.foregroundBearingDegrees;
        }
        if (!hasCurrentForegroundLocation(fallback)
                && hasReliableGnssBearing(fallback.lastHasBearing, fallback.lastHasSpeed,
                fallback.lastSpeedMetersPerSecond)) {
            return fallback.lastBearingDegrees;
        }
        if (fallback.compassHeadingReliable && !Float.isNaN(fallback.compassHeadingDegrees)) {
            return fallback.compassHeadingDegrees;
        }
        return Float.NaN;
    }

    private static boolean currentMovementReliable(Fallback fallback) {
        if (hasCurrentForegroundLocation(fallback)) {
            return !fallback.foregroundHasSpeed
                    || fallback.foregroundSpeedMetersPerSecond
                    >= MIN_GNSS_BEARING_SPEED_METERS_PER_SECOND;
        }
        if (fallback.hasLastLocation) {
            return !fallback.lastHasSpeed
                    || fallback.lastSpeedMetersPerSecond
                    >= MIN_GNSS_BEARING_SPEED_METERS_PER_SECOND;
        }
        return true;
    }

    private static boolean shouldGateTrustedHeadingByLiveMovement(Fallback fallback) {
        return fallback.foregroundRecording || fallback.hasSessionTotalDistance;
    }

    private static boolean hasCurrentForegroundLocation(Fallback fallback) {
        return fallback.foregroundRecording && fallback.foregroundHasLocation;
    }

    private static double totalDistanceMeters(List<TrackPoint> points, Fallback fallback) {
        if (fallback.foregroundRecording) {
            return fallback.foregroundTotalDistanceMeters;
        }
        if (fallback.hasSessionTotalDistance) {
            return fallback.sessionTotalDistanceMeters;
        }
        if (fallback.hasManifestTotalDistance) {
            return fallback.manifestTotalDistanceMeters;
        }
        double total = 0.0;
        for (TrackPoint point : points) {
            if (!isWeakMapPoint(point) && !isTransportMapPoint(point)) {
                total += point.distanceDeltaMeters;
            }
        }
        return total;
    }

    private static double totalAscentMeters(List<TrackPoint> points, Fallback fallback) {
        if (fallback.foregroundRecording && fallback.foregroundTotalAscentMeters >= 0.0) {
            return fallback.foregroundTotalAscentMeters;
        }
        return TrackAscentCalculator.totalAscentMeters(points);
    }

    private static float trustedTrackHeadingDegrees(List<TrackPoint> points,
                                                   TrackPoint currentPoint) {
        if (points == null || currentPoint == null) {
            return Float.NaN;
        }
        TrackPoint previousTrustedPoint = null;
        for (int i = points.size() - 1; i >= 0; i--) {
            TrackPoint point = points.get(i);
            if (point == currentPoint) {
                continue;
            }
            if (isWeakMapPoint(point) || isTransportMapPoint(point)) {
                continue;
            }
            if (point.elapsedRealtimeNanos > currentPoint.elapsedRealtimeNanos) {
                continue;
            }
            previousTrustedPoint = point;
            break;
        }
        if (previousTrustedPoint == null
                || mapDistanceMeters(previousTrustedPoint, currentPoint)
                < MIN_TRACK_HEADING_DISTANCE_METERS) {
            return Float.NaN;
        }
        return bearingBetweenDegrees(previousTrustedPoint.latitude, previousTrustedPoint.longitude,
                currentPoint.latitude, currentPoint.longitude);
    }

    private static boolean hasReliableGnssBearing(boolean hasBearing, boolean hasSpeed,
                                                  float speedMetersPerSecond) {
        return hasBearing && hasSpeed
                && speedMetersPerSecond >= MIN_GNSS_BEARING_SPEED_METERS_PER_SECOND;
    }

    private static double mapDistanceMeters(TrackPoint from, TrackPoint to) {
        double lat1 = Math.toRadians(from.latitude);
        double lat2 = Math.toRadians(to.latitude);
        double dLat = lat2 - lat1;
        double dLng = Math.toRadians(to.longitude - from.longitude);
        double sinLat = Math.sin(dLat / 2d);
        double sinLng = Math.sin(dLng / 2d);
        double a = sinLat * sinLat
                + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
        return 6_371_000d * 2d * Math.atan2(Math.sqrt(a), Math.sqrt(1d - a));
    }

    private static float bearingBetweenDegrees(double fromLatitude, double fromLongitude,
                                               double toLatitude, double toLongitude) {
        double lat1 = Math.toRadians(fromLatitude);
        double lat2 = Math.toRadians(toLatitude);
        double dLng = Math.toRadians(toLongitude - fromLongitude);
        double y = Math.sin(dLng) * Math.cos(lat2);
        double x = Math.cos(lat1) * Math.sin(lat2)
                - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        double bearing = Math.toDegrees(Math.atan2(y, x));
        return (float) ((bearing + 360d) % 360d);
    }

    static class Fallback {
        boolean foregroundRecording;
        double foregroundTotalDistanceMeters;
        double foregroundTotalAscentMeters = -1.0;
        boolean foregroundHasLocation;
        double foregroundLatitude;
        double foregroundLongitude;
        float foregroundAccuracyMeters = -1f;
        boolean foregroundHasBearing;
        float foregroundBearingDegrees = -1f;
        boolean foregroundHasSpeed;
        float foregroundSpeedMetersPerSecond;
        boolean hasLastLocation;
        double lastLatitude;
        double lastLongitude;
        float lastAccuracyMeters;
        boolean lastHasBearing;
        float lastBearingDegrees;
        boolean lastHasSpeed;
        float lastSpeedMetersPerSecond;
        float compassHeadingDegrees = Float.NaN;
        boolean compassHeadingReliable;
        boolean hasSessionTotalDistance;
        double sessionTotalDistanceMeters;
        boolean hasManifestTotalDistance;
        double manifestTotalDistanceMeters;
    }
}
