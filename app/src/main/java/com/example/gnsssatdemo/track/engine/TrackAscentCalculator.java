package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.List;

public class TrackAscentCalculator {
    private static final double MAX_GNSS_VERTICAL_ACCURACY_METERS = 12.0;
    private static final double MAX_GNSS_HORIZONTAL_ACCURACY_METERS = 30.0;
    private static final double MIN_GNSS_HORIZONTAL_DISTANCE_METERS = 5.0;
    private static final double MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND = 2.0;

    private double totalAscentMeters;
    private ElevationSource activeSource;
    private Double filteredAltitude;
    private Double baseAltitude;
    private Double peakAltitude;
    private Double lastAltitude;
    private long lastElapsedRealtimeNanos;
    private Double lastVerticalAccuracyMeters;
    private boolean hasReliableSample;

    public static double totalAscentMeters(List<TrackPoint> points) {
        TrackAscentCalculator calculator = new TrackAscentCalculator();
        for (TrackPoint point : points) {
            calculator.onTrackPoint(point);
        }
        return calculator.finish();
    }

    public void onTrackPoint(TrackPoint point) {
        if (isAnchorReason(point.decisionReason)) {
            resetAltitudeAnchor(sampleFrom(point, false));
            return;
        }
        if (!"moving_good_fix".equals(point.decisionReason)) {
            return;
        }
        ElevationSample sample = sampleFrom(point, true);
        if (sample == null) {
            return;
        }
        if (isSourceChange(sample)) {
            flushPendingGain();
            resetSourceState();
        }
        if (!passesPhysicalGate(sample)) {
            return;
        }
        double altitude = filter(sample);
        updateTrend(altitude, sample);
    }

    public double finish() {
        return hasReliableSample ? totalAscentMeters + acceptedPendingGain() : -1.0;
    }

    private ElevationSample sampleFrom(TrackPoint point, boolean requireGnssDistance) {
        if (usesBarometerAltitude(point)) {
            return new ElevationSample(point.elapsedRealtimeNanos,
                    point.rawBarometerAltitudeMeters, ElevationSource.BAROMETER,
                    0.0, point.accuracyMeters, point.distanceDeltaMeters);
        }
        if (isGoodGnssAltitude(point)
                && (!requireGnssDistance || hasEnoughGnssDistance(point))) {
            return new ElevationSample(point.elapsedRealtimeNanos, point.altitude,
                    ElevationSource.GNSS, point.verticalAccuracyMeters,
                    point.accuracyMeters, point.distanceDeltaMeters);
        }
        return null;
    }

    private static boolean isGoodGnssAltitude(TrackPoint point) {
        return point.hasAltitude
                && point.hasVerticalAccuracy
                && point.verticalAccuracyMeters > 0f
                && point.verticalAccuracyMeters <= MAX_GNSS_VERTICAL_ACCURACY_METERS
                && point.accuracyMeters > 0f
                && point.accuracyMeters <= MAX_GNSS_HORIZONTAL_ACCURACY_METERS;
    }

    public static boolean usesBarometerAltitude(TrackPoint point) {
        return point != null && point.hasPressureSample;
    }

    public static boolean usesGnssAltitude(TrackPoint point) {
        return point != null && isGoodGnssAltitude(point) && hasEnoughGnssDistance(point);
    }

    private static boolean hasEnoughGnssDistance(TrackPoint point) {
        return point.distanceDeltaMeters >= MIN_GNSS_HORIZONTAL_DISTANCE_METERS;
    }

    private boolean passesPhysicalGate(ElevationSample sample) {
        if (lastAltitude == null || lastElapsedRealtimeNanos <= 0L
                || sample.elapsedRealtimeNanos <= lastElapsedRealtimeNanos) {
            return true;
        }
        double elapsedSeconds =
                (sample.elapsedRealtimeNanos - lastElapsedRealtimeNanos) / 1_000_000_000.0;
        if (elapsedSeconds <= 0.0) {
            return true;
        }
        double verticalSpeed = Math.abs(sample.altitudeMeters - lastAltitude) / elapsedSeconds;
        return verticalSpeed <= MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND;
    }

    private double filter(ElevationSample sample) {
        if (isSourceChange(sample)) {
            resetSourceState();
        }
        if (filteredAltitude == null) {
            activeSource = sample.source;
            filteredAltitude = sample.altitudeMeters;
            return filteredAltitude;
        }
        double alpha = alpha(sample.source);
        filteredAltitude = alpha * sample.altitudeMeters + (1.0 - alpha) * filteredAltitude;
        return filteredAltitude;
    }

    private void updateTrend(double altitude, ElevationSample sample) {
        hasReliableSample = true;
        lastVerticalAccuracyMeters = sample.verticalAccuracyMeters;
        if (baseAltitude == null) {
            baseAltitude = altitude;
            peakAltitude = altitude;
            lastAltitude = altitude;
            lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
            return;
        }
        if (altitude >= peakAltitude) {
            peakAltitude = altitude;
            lastAltitude = altitude;
            lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
            return;
        }

        double drop = peakAltitude - altitude;
        double pendingGain = peakAltitude - baseAltitude;
        if (drop >= dropThreshold(sample.source, sample.verticalAccuracyMeters)) {
            if (pendingGain >= climbThreshold(sample.source, sample.verticalAccuracyMeters)) {
                totalAscentMeters += pendingGain;
            }
            baseAltitude = altitude;
            peakAltitude = altitude;
        }
        lastAltitude = altitude;
        lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
    }

    private boolean isSourceChange(ElevationSample sample) {
        return activeSource != null && activeSource != sample.source;
    }

    private void resetSourceState() {
        activeSource = null;
        filteredAltitude = null;
        resetTrend();
    }

    private void flushPendingGain() {
        totalAscentMeters += acceptedPendingGain();
    }

    private double acceptedPendingGain() {
        if (activeSource == null || baseAltitude == null || peakAltitude == null
                || lastVerticalAccuracyMeters == null) {
            return 0.0;
        }
        double pendingGain = peakAltitude - baseAltitude;
        if (pendingGain >= climbThreshold(activeSource, lastVerticalAccuracyMeters)) {
            return pendingGain;
        }
        return 0.0;
    }

    private void resetAltitudeAnchor(ElevationSample sample) {
        flushPendingGain();
        resetSourceState();
        if (sample != null) {
            double altitude = filter(sample);
            baseAltitude = altitude;
            peakAltitude = altitude;
            lastAltitude = altitude;
            lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
            lastVerticalAccuracyMeters = sample.verticalAccuracyMeters;
            hasReliableSample = true;
        }
    }

    private void resetTrend() {
        baseAltitude = null;
        peakAltitude = null;
        lastAltitude = null;
        lastElapsedRealtimeNanos = 0L;
        lastVerticalAccuracyMeters = null;
    }

    private static boolean isAnchorReason(String reason) {
        return "first_fix_good".equals(reason)
                || "first_fix_relaxed".equals(reason)
                || "forced_weak_first_fix".equals(reason)
                || "gap_recovery".equals(reason)
                || "transport_recovery".equals(reason)
                || "rest_moving_recovery".equals(reason)
                || "stationary_anchor_refined".equals(reason);
    }

    private static double alpha(ElevationSource source) {
        if (source == ElevationSource.BAROMETER) {
            return 0.35;
        }
        if (source == ElevationSource.DEM) {
            return 0.25;
        }
        return 0.15;
    }

    private static double climbThreshold(ElevationSource source, double verticalAccuracyMeters) {
        if (source == ElevationSource.BAROMETER) {
            return 3.0;
        }
        if (source == ElevationSource.DEM) {
            return 5.0;
        }
        return Math.max(5.0, verticalAccuracyMeters * 0.8);
    }

    private static double dropThreshold(ElevationSource source, double verticalAccuracyMeters) {
        if (source == ElevationSource.BAROMETER) {
            return 1.5;
        }
        if (source == ElevationSource.DEM) {
            return 3.0;
        }
        return Math.max(3.0, verticalAccuracyMeters * 0.4);
    }

    enum ElevationSource {
        BAROMETER,
        GNSS,
        DEM
    }

    private static class ElevationSample {
        final long elapsedRealtimeNanos;
        final double altitudeMeters;
        final ElevationSource source;
        final double verticalAccuracyMeters;
        final double horizontalAccuracyMeters;
        final double distanceDeltaMeters;

        ElevationSample(long elapsedRealtimeNanos, double altitudeMeters,
                        ElevationSource source, double verticalAccuracyMeters,
                        double horizontalAccuracyMeters, double distanceDeltaMeters) {
            this.elapsedRealtimeNanos = elapsedRealtimeNanos;
            this.altitudeMeters = altitudeMeters;
            this.source = source;
            this.verticalAccuracyMeters = verticalAccuracyMeters;
            this.horizontalAccuracyMeters = horizontalAccuracyMeters;
            this.distanceDeltaMeters = distanceDeltaMeters;
        }
    }
}
