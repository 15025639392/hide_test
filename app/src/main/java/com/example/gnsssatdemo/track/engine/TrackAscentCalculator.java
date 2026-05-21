package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.List;

public class TrackAscentCalculator {
    private static final double MAX_GNSS_VERTICAL_ACCURACY_METERS = 12.0;
    private static final double MAX_GNSS_HORIZONTAL_ACCURACY_METERS = 30.0;
    private static final double MIN_GNSS_HORIZONTAL_DISTANCE_METERS = 5.0;
    private static final double MAX_HIKING_VERTICAL_SPEED_METERS_PER_SECOND = 2.0;
    private static final long MAX_BAROMETER_SAMPLE_GAP_NANOS = 30_000_000_000L;
    private final AscentEngine barometerEngine = new AscentEngine(ElevationSource.BAROMETER);
    private final AscentEngine gnssEngine = new AscentEngine(ElevationSource.GNSS);

    public static double totalAscentMeters(List<TrackPoint> points) {
        return result(points).totalAscentMeters;
    }

    public static Result result(List<TrackPoint> points) {
        return result(points, null);
    }

    public static Result result(List<TrackPoint> points, List<BarometerSample> barometerSamples) {
        TrackAscentCalculator calculator = new TrackAscentCalculator();
        boolean useIndependentBarometerSamples =
                barometerSamples != null && !barometerSamples.isEmpty();
        if (useIndependentBarometerSamples) {
            for (BarometerSample sample : barometerSamples) {
                calculator.onBarometerSample(sample);
            }
        }
        if (points != null) {
            for (TrackPoint point : points) {
                calculator.onTrackPoint(point, !useIndependentBarometerSamples);
            }
        }
        return calculator.finish();
    }

    public void onTrackPoint(TrackPoint point) {
        onTrackPoint(point, true);
    }

    private void onTrackPoint(TrackPoint point, boolean allowTrackPointBarometer) {
        if (point == null) {
            return;
        }
        if (isAnchorReason(point.decisionReason)) {
            ElevationSample barometerSample = allowTrackPointBarometer
                    ? barometerSampleFrom(point) : null;
            if (barometerSample != null) {
                barometerEngine.resetAltitudeAnchor(barometerSample);
            }
            ElevationSample gnssSample = gnssSampleFrom(point, false);
            if (gnssSample != null) {
                gnssEngine.resetAltitudeAnchor(gnssSample);
            }
            return;
        }

        ElevationSample barometerSample = allowTrackPointBarometer
                ? barometerSampleFrom(point) : null;
        if (barometerSample != null && isBarometerEligible(point)) {
            barometerEngine.onSample(barometerSample);
        }

        if ("moving_good_fix".equals(point.decisionReason)) {
            ElevationSample gnssSample = gnssSampleFrom(point, true);
            if (gnssSample != null) {
                gnssEngine.onSample(gnssSample);
            }
        }
    }

    public void onBarometerSample(BarometerSample sample) {
        if (sample == null || !isValidPressure(sample.pressureHpa)
                || !isValidAltitude(sample.rawBarometerAltitudeMeters)) {
            barometerEngine.rejectSample();
            return;
        }
        barometerEngine.onBarometerSample(new ElevationSample(sample.elapsedRealtimeNanos,
                sample.rawBarometerAltitudeMeters, ElevationSource.BAROMETER,
                0.0, 0.0, 0.0));
    }

    public Result finish() {
        double barometerTotal = barometerEngine.finish();
        double gnssTotal = gnssEngine.finish();
        if (barometerTotal >= 0.0) {
            return new Result(barometerTotal, "BAROMETER", barometerTotal, gnssTotal,
                    barometerEngine.sampleCount(), gnssEngine.sampleCount(),
                    barometerEngine.rejectedSampleCount(), gnssEngine.rejectedSampleCount());
        }
        if (gnssTotal >= 0.0) {
            return new Result(gnssTotal, "GNSS", barometerTotal, gnssTotal,
                    barometerEngine.sampleCount(), gnssEngine.sampleCount(),
                    barometerEngine.rejectedSampleCount(), gnssEngine.rejectedSampleCount());
        }
        return new Result(-1.0, "NONE", barometerTotal, gnssTotal,
                barometerEngine.sampleCount(), gnssEngine.sampleCount(),
                barometerEngine.rejectedSampleCount(), gnssEngine.rejectedSampleCount());
    }

    private ElevationSample barometerSampleFrom(TrackPoint point) {
        if (!usesBarometerAltitude(point)) {
            return null;
        }
        return new ElevationSample(point.elapsedRealtimeNanos,
                point.rawBarometerAltitudeMeters, ElevationSource.BAROMETER,
                0.0, point.accuracyMeters, point.distanceDeltaMeters);
    }

    private ElevationSample gnssSampleFrom(TrackPoint point, boolean requireGnssDistance) {
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

    public static Result ascentResult(List<TrackPoint> points) {
        return result(points);
    }

    public static Result ascentResult(List<TrackPoint> points,
                                      List<BarometerSample> barometerSamples) {
        return result(points, barometerSamples);
    }

    private static boolean hasEnoughGnssDistance(TrackPoint point) {
        return point.distanceDeltaMeters >= MIN_GNSS_HORIZONTAL_DISTANCE_METERS;
    }

    private static boolean isValidPressure(float pressureHpa) {
        return pressureHpa > 0f && !Float.isNaN(pressureHpa) && !Float.isInfinite(pressureHpa);
    }

    private static boolean isValidAltitude(double altitudeMeters) {
        return !Double.isNaN(altitudeMeters) && !Double.isInfinite(altitudeMeters);
    }

    private static boolean isBarometerEligible(TrackPoint point) {
        return true;
    }

    private static boolean isAnchorReason(String reason) {
        return "first_fix_good".equals(reason)
                || "first_fix_relaxed".equals(reason)
                || "gap_recovery".equals(reason)
                || "stationary_anchor".equals(reason);
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

    public static class Result {
        public final double totalAscentMeters;
        public final String source;
        public final double barometerTotalAscentMeters;
        public final double gnssTotalAscentMeters;
        public final int barometerSampleCount;
        public final int gnssSampleCount;
        public final int barometerRejectedSampleCount;
        public final int gnssRejectedSampleCount;

        Result(double totalAscentMeters, String source,
               double barometerTotalAscentMeters, double gnssTotalAscentMeters,
               int barometerSampleCount, int gnssSampleCount,
               int barometerRejectedSampleCount, int gnssRejectedSampleCount) {
            this.totalAscentMeters = totalAscentMeters;
            this.source = source;
            this.barometerTotalAscentMeters = barometerTotalAscentMeters;
            this.gnssTotalAscentMeters = gnssTotalAscentMeters;
            this.barometerSampleCount = barometerSampleCount;
            this.gnssSampleCount = gnssSampleCount;
            this.barometerRejectedSampleCount = barometerRejectedSampleCount;
            this.gnssRejectedSampleCount = gnssRejectedSampleCount;
        }
    }

    public static class BarometerSample {
        public final long pressureSampleId;
        public final long elapsedRealtimeNanos;
        public final float pressureHpa;
        public final int sensorAccuracy;
        public final double rawBarometerAltitudeMeters;

        public BarometerSample(long pressureSampleId, long elapsedRealtimeNanos,
                               float pressureHpa, int sensorAccuracy,
                               double rawBarometerAltitudeMeters) {
            this.pressureSampleId = pressureSampleId;
            this.elapsedRealtimeNanos = elapsedRealtimeNanos;
            this.pressureHpa = pressureHpa;
            this.sensorAccuracy = sensorAccuracy;
            this.rawBarometerAltitudeMeters = rawBarometerAltitudeMeters;
        }
    }

    private static class AscentEngine {
        final ElevationSource source;
        double totalAscentMeters;
        Double filteredAltitude;
        Double baseAltitude;
        Double peakAltitude;
        Double lastAltitude;
        long lastElapsedRealtimeNanos;
        Double lastVerticalAccuracyMeters;
        boolean hasReliableSample;
        int sampleCount;
        int rejectedSampleCount;

        AscentEngine(ElevationSource source) {
            this.source = source;
        }

        void onSample(ElevationSample sample) {
            if (sample == null || sample.source != source || !passesPhysicalGate(sample)) {
                rejectedSampleCount++;
                return;
            }
            sampleCount++;
            double altitude = filter(sample);
            updateTrend(altitude, sample);
        }

        void onBarometerSample(ElevationSample sample) {
            if (source != ElevationSource.BAROMETER || sample == null) {
                return;
            }
            if (lastElapsedRealtimeNanos > 0L
                    && sample.elapsedRealtimeNanos - lastElapsedRealtimeNanos
                    > MAX_BAROMETER_SAMPLE_GAP_NANOS) {
                resetAltitudeAnchor(sample);
                return;
            }
            onSample(sample);
        }

        double finish() {
            return hasReliableSample && sampleCount >= 2
                    ? totalAscentMeters + acceptedPendingGain() : -1.0;
        }

        int sampleCount() {
            return sampleCount;
        }

        int rejectedSampleCount() {
            return rejectedSampleCount;
        }

        void rejectSample() {
            rejectedSampleCount++;
        }

        void resetAltitudeAnchor(ElevationSample sample) {
            flushPendingGain();
            resetState();
            if (sample != null && sample.source == source) {
                sampleCount++;
                double altitude = filter(sample);
                baseAltitude = altitude;
                peakAltitude = altitude;
                lastAltitude = altitude;
                lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
                lastVerticalAccuracyMeters = sample.verticalAccuracyMeters;
                hasReliableSample = true;
            }
        }

        private boolean passesPhysicalGate(ElevationSample sample) {
            if (lastAltitude == null || lastElapsedRealtimeNanos <= 0L) {
                return true;
            }
            if (sample.elapsedRealtimeNanos <= lastElapsedRealtimeNanos) {
                return false;
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
            if (filteredAltitude == null) {
                filteredAltitude = sample.altitudeMeters;
                return filteredAltitude;
            }
            double alpha = alpha(source);
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
            if (drop >= dropThreshold(source, sample.verticalAccuracyMeters)) {
                if (pendingGain >= climbThreshold(source, sample.verticalAccuracyMeters)) {
                    totalAscentMeters += pendingGain;
                }
                baseAltitude = altitude;
                peakAltitude = altitude;
            }
            lastAltitude = altitude;
            lastElapsedRealtimeNanos = sample.elapsedRealtimeNanos;
        }

        private void flushPendingGain() {
            totalAscentMeters += acceptedPendingGain();
        }

        private double acceptedPendingGain() {
            if (baseAltitude == null || peakAltitude == null || lastVerticalAccuracyMeters == null) {
                return 0.0;
            }
            double pendingGain = peakAltitude - baseAltitude;
            if (pendingGain >= climbThreshold(source, lastVerticalAccuracyMeters)) {
                return pendingGain;
            }
            return 0.0;
        }

        private void resetState() {
            filteredAltitude = null;
            baseAltitude = null;
            peakAltitude = null;
            lastAltitude = null;
            lastElapsedRealtimeNanos = 0L;
            lastVerticalAccuracyMeters = null;
        }
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
