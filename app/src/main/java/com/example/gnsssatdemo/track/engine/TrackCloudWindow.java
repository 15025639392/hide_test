package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class TrackCloudWindow {
    private static final double EARTH_RADIUS_METERS = 6_371_000.0;
    public static final int STATIONARY_MIN_SAMPLES = 2;
    public static final int MOVING_MIN_SAMPLES = 1;
    public static final int RECOVERY_MIN_SAMPLES = 2;
    public static final double STATIONARY_MIN_RADIUS_METERS = 8.0;
    public static final double MOVING_MIN_RADIUS_METERS = 15.0;
    public static final double RECOVERY_MIN_RADIUS_METERS = 12.0;
    public static final double START_MIN_WEIGHT = 0.03;
    public static final double STATIONARY_MIN_WEIGHT = 0.08;
    public static final double MOVING_MIN_WEIGHT = 0.03;
    public static final double RECOVERY_MIN_WEIGHT = 0.08;
    public static final double TEMPORAL_DECAY_SECONDS = 20.0;
    private static final long MOTION_WINDOW_NANOS = 5_000_000_000L;
    public final long cloudId;
    public final String cloudType;
    public final long samplingEpochId;
    private final List<Sample> samples = new ArrayList<>();
    private RawPoint origin;

    public TrackCloudWindow(long cloudId, String cloudType, long samplingEpochId) {
        this.cloudId = cloudId;
        this.cloudType = cloudType;
        this.samplingEpochId = samplingEpochId;
    }

    public Snapshot add(RawPoint rawPoint, GnssQualitySnapshot snapshot,
                        List<MotionSummary> motionSummaries) {
        if (origin == null) {
            origin = rawPoint;
        }
        samples.add(new Sample(rawPoint, snapshot, motionSummaries));
        return snapshot();
    }

    public Snapshot snapshot() {
        if (samples.isEmpty() || origin == null) {
            return Snapshot.empty(cloudId, cloudType, samplingEpochId);
        }
        long latestElapsed = latestElapsedRealtimeNanos();
        double originLatRad = Math.toRadians(origin.latitude);
        List<ProjectedSample> projected = new ArrayList<>();
        double initialTotalWeight = 0.0;
        double initialWeightedX = 0.0;
        double initialWeightedY = 0.0;
        for (Sample sample : samples) {
            double x = EARTH_RADIUS_METERS * Math.cos(originLatRad)
                    * Math.toRadians(sample.rawPoint.longitude - origin.longitude);
            double y = EARTH_RADIUS_METERS * Math.toRadians(sample.rawPoint.latitude - origin.latitude);
            double weight = baseWeight(sample, latestElapsed);
            projected.add(new ProjectedSample(sample, x, y, weight));
            initialTotalWeight += weight;
            initialWeightedX += weight * x;
            initialWeightedY += weight * y;
        }
        if (initialTotalWeight <= 0.0) {
            initialTotalWeight = 1.0;
        }
        double initialCenterX = initialWeightedX / initialTotalWeight;
        double initialCenterY = initialWeightedY / initialTotalWeight;

        List<WeightedSample> weighted = new ArrayList<>();
        double totalWeight = 0.0;
        double weightedX = 0.0;
        double weightedY = 0.0;
        for (ProjectedSample sample : projected) {
            double initialDistance = Math.hypot(sample.x - initialCenterX,
                    sample.y - initialCenterY);
            double weight = sample.baseWeight * spatialWeight(initialDistance,
                    sample.sample.rawPoint.accuracyMeters);
            weighted.add(new WeightedSample(sample.sample, sample.x, sample.y, weight));
            totalWeight += weight;
            weightedX += weight * sample.x;
            weightedY += weight * sample.y;
        }
        if (totalWeight <= 0.0) {
            totalWeight = 1.0;
        }
        weightedX /= totalWeight;
        weightedY /= totalWeight;
        double centerLat = origin.latitude + Math.toDegrees(weightedY / EARTH_RADIUS_METERS);
        double centerLon = origin.longitude
                + Math.toDegrees(weightedX / (EARTH_RADIUS_METERS * Math.cos(originLatRad)));

        double radiusTotal = 0.0;
        long representativeRawPointId = samples.get(samples.size() - 1).rawPoint.rawPointId;
        double closestDistance = Double.MAX_VALUE;
        List<Long> rawIds = new ArrayList<>();
        int latestAccuracyScore = 0;
        int latestGnssScore = 0;
        int latestMotionScore = 0;
        int latestSpatialScore = 0;
        for (WeightedSample sample : weighted) {
            double distance = distanceMeters(sample.sample.rawPoint.latitude,
                    sample.sample.rawPoint.longitude, centerLat, centerLon);
            radiusTotal += sample.weight * distance * distance;
            rawIds.add(sample.sample.rawPoint.rawPointId);
            if (distance < closestDistance) {
                closestDistance = distance;
                representativeRawPointId = sample.sample.rawPoint.rawPointId;
            }
            latestAccuracyScore = scoreFromAccuracy(sample.sample.rawPoint.accuracyMeters);
            latestGnssScore = scoreFromGnss(sample.sample.snapshot);
            latestMotionScore = scoreFromMotion(sample.sample.rawPoint,
                    sample.sample.motionSummaries);
            latestSpatialScore = scoreFromSpatial(distance, sample.sample.rawPoint.accuracyMeters);
        }
        double weightedRadius = Math.sqrt(radiusTotal / totalWeight);
        int timeScore = scoreFromTimeSpan();
        int speedScore = 100;
        TrackTrustScore score = new TrackTrustScore(latestAccuracyScore, 100, timeScore,
                latestSpatialScore, latestMotionScore, latestGnssScore, speedScore);
        return new Snapshot(cloudId, cloudType, samplingEpochId, samples.size(), totalWeight,
                weightedRadius, centerLat, centerLon, representativeRawPointId, rawIds, score);
    }

    public boolean isStable() {
        Snapshot snapshot = snapshot();
        if ("MOVING_CLOUD".equals(cloudType)) {
            return snapshot.sampleCount >= MOVING_MIN_SAMPLES
                    && snapshot.weightSum >= MOVING_MIN_WEIGHT
                    && snapshot.weightedRadiusMeters <= movingRadiusThreshold();
        }
        if ("RECOVERY_CLOUD".equals(cloudType)) {
            return snapshot.sampleCount >= RECOVERY_MIN_SAMPLES
                    && snapshot.weightSum >= RECOVERY_MIN_WEIGHT
                    && snapshot.weightedRadiusMeters <= recoveryRadiusThreshold();
        }
        if ("START_CLOUD".equals(cloudType)) {
            return snapshot.sampleCount >= 1 && snapshot.weightSum >= START_MIN_WEIGHT;
        }
        return snapshot.sampleCount >= STATIONARY_MIN_SAMPLES
                && snapshot.weightSum >= STATIONARY_MIN_WEIGHT
                && snapshot.weightedRadiusMeters <= stationaryRadiusThreshold();
    }

    public boolean recoveryFastPath() {
        if (!"RECOVERY_CLOUD".equals(cloudType) || samples.size() != 1) {
            return false;
        }
        Sample sample = samples.get(0);
        return sample.rawPoint.accuracyMeters <= 10f
                && scoreFromGnss(sample.snapshot) >= 80
                && (!sample.rawPoint.hasSpeed || sample.rawPoint.speedMetersPerSecond <= 2.5f);
    }

    private double baseWeight(Sample sample, long latestElapsed) {
        double accuracyWeight = clamp(1.0 / Math.max(sample.rawPoint.accuracyMeters, 3.0),
                0.01, 0.33);
        double gnssWeight = gnssWeight(sample.snapshot);
        double motionWeight = motionWeight(sample.rawPoint, sample.motionSummaries);
        double sampleAgeSeconds = Math.max(0.0,
                (latestElapsed - sample.rawPoint.elapsedRealtimeNanos) / 1_000_000_000.0);
        double temporalWeight = Math.exp(-sampleAgeSeconds / TEMPORAL_DECAY_SECONDS);
        return accuracyWeight * gnssWeight * motionWeight * temporalWeight;
    }

    private double spatialWeight(double distanceMeters, float accuracyMeters) {
        double cloudRadius = cloudRadiusThreshold();
        if (distanceMeters <= cloudRadius) {
            return 1.0;
        }
        if (distanceMeters <= Math.max(cloudRadius, accuracyMeters * 1.5)) {
            return 0.5;
        }
        return 0.1;
    }

    private double cloudRadiusThreshold() {
        if ("MOVING_CLOUD".equals(cloudType)) {
            return movingRadiusThreshold();
        }
        if ("RECOVERY_CLOUD".equals(cloudType)) {
            return recoveryRadiusThreshold();
        }
        return stationaryRadiusThreshold();
    }

    private long latestElapsedRealtimeNanos() {
        long latest = 0L;
        for (Sample sample : samples) {
            latest = Math.max(latest, sample.rawPoint.elapsedRealtimeNanos);
        }
        return latest;
    }

    private double stationaryRadiusThreshold() {
        return Math.max(STATIONARY_MIN_RADIUS_METERS, medianAccuracy() * 1.2);
    }

    private double movingRadiusThreshold() {
        return Math.max(MOVING_MIN_RADIUS_METERS, medianAccuracy() * 1.5);
    }

    private double recoveryRadiusThreshold() {
        return Math.max(RECOVERY_MIN_RADIUS_METERS, medianAccuracy() * 1.5);
    }

    private double medianAccuracy() {
        List<Float> values = new ArrayList<>();
        for (Sample sample : samples) {
            values.add(sample.rawPoint.accuracyMeters);
        }
        Collections.sort(values);
        if (values.isEmpty()) {
            return 30.0;
        }
        return values.get(values.size() / 2);
    }

    private double gnssWeight(GnssQualitySnapshot snapshot) {
        int score = scoreFromGnss(snapshot);
        if (score >= 80) return 1.0;
        if (score >= 60) return 0.7;
        if (score >= 35) return 0.4;
        return 0.25;
    }

    private int scoreFromGnss(GnssQualitySnapshot snapshot) {
        if (snapshot == null) {
            return 25;
        }
        if (snapshot.usedInFixTotal >= 8 && snapshot.top4AvgCn0 >= 28f) {
            return 100;
        }
        if (snapshot.usedInFixTotal >= 5 && snapshot.top4AvgCn0 >= 22f) {
            return 70;
        }
        if (snapshot.usedInFixTotal >= 3) {
            return 40;
        }
        return 25;
    }

    private double motionWeight(RawPoint rawPoint, List<MotionSummary> motionSummaries) {
        int score = scoreFromMotion(rawPoint, motionSummaries);
        return Math.max(0.25, score / 100.0);
    }

    private int scoreFromMotion(RawPoint rawPoint, List<MotionSummary> motionSummaries) {
        boolean still = hasStillMotion(rawPoint.elapsedRealtimeNanos, motionSummaries);
        if ("STATIONARY_CLOUD".equals(cloudType)) {
            return still ? 100 : 50;
        }
        if ("MOVING_CLOUD".equals(cloudType)) {
            return rawPoint.hasSpeed && rawPoint.speedMetersPerSecond > 0.5f ? 100 : 70;
        }
        if ("RECOVERY_CLOUD".equals(cloudType)) {
            return still && (!rawPoint.hasSpeed || rawPoint.speedMetersPerSecond <= 0.5f) ? 80 : 70;
        }
        return 50;
    }

    private boolean hasStillMotion(long elapsedRealtimeNanos,
                                   List<MotionSummary> motionSummaries) {
        if (motionSummaries == null) {
            return false;
        }
        long cutoff = elapsedRealtimeNanos - MOTION_WINDOW_NANOS;
        int total = 0;
        int still = 0;
        for (MotionSummary summary : motionSummaries) {
            if (summary.lastElapsedRealtimeNanos < cutoff
                    || summary.firstElapsedRealtimeNanos > elapsedRealtimeNanos) {
                continue;
            }
            total++;
            if (summary.deviceStill) {
                still++;
            }
        }
        return total > 0 && still / (double) total >= 0.75;
    }

    private int scoreFromAccuracy(float accuracyMeters) {
        if (accuracyMeters <= 10f) return 100;
        if (accuracyMeters <= 30f) {
            return (int) Math.round(100.0 - (accuracyMeters - 10.0) * 30.0 / 20.0);
        }
        if (accuracyMeters <= 80f) {
            return (int) Math.round(70.0 - (accuracyMeters - 30.0) * 50.0 / 50.0);
        }
        return 0;
    }

    private int scoreFromSpatial(double distanceMeters, float accuracyMeters) {
        double explainable = Math.max(8.0, accuracyMeters * 1.5);
        if (distanceMeters <= explainable) return 100;
        if (distanceMeters <= explainable * 2.0) return 50;
        return 10;
    }

    private int scoreFromTimeSpan() {
        if (samples.size() <= 1) {
            return 100;
        }
        long first = samples.get(0).rawPoint.elapsedRealtimeNanos;
        long last = samples.get(samples.size() - 1).rawPoint.elapsedRealtimeNanos;
        double seconds = Math.max(0.0, (last - first) / 1_000_000_000.0);
        if (seconds <= 10.0) return 100;
        if (seconds <= 30.0) return 85;
        if (seconds <= 120.0) return 60;
        return 20;
    }

    public static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double lat1Rad = Math.toRadians(lat1);
        double lat2Rad = Math.toRadians(lat2);
        double deltaLat = Math.toRadians(lat2 - lat1);
        double deltaLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(deltaLat / 2.0) * Math.sin(deltaLat / 2.0)
                + Math.cos(lat1Rad) * Math.cos(lat2Rad)
                * Math.sin(deltaLon / 2.0) * Math.sin(deltaLon / 2.0);
        return EARTH_RADIUS_METERS * 2.0
                * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static class Sample {
        final RawPoint rawPoint;
        final GnssQualitySnapshot snapshot;
        final List<MotionSummary> motionSummaries;

        Sample(RawPoint rawPoint, GnssQualitySnapshot snapshot,
               List<MotionSummary> motionSummaries) {
            this.rawPoint = rawPoint;
            this.snapshot = snapshot;
            this.motionSummaries = motionSummaries == null
                    ? Collections.<MotionSummary>emptyList()
                    : new ArrayList<>(motionSummaries);
        }
    }

    private static class WeightedSample {
        final Sample sample;
        final double x;
        final double y;
        final double weight;

        WeightedSample(Sample sample, double x, double y, double weight) {
            this.sample = sample;
            this.x = x;
            this.y = y;
            this.weight = weight;
        }
    }

    private static class ProjectedSample {
        final Sample sample;
        final double x;
        final double y;
        final double baseWeight;

        ProjectedSample(Sample sample, double x, double y, double baseWeight) {
            this.sample = sample;
            this.x = x;
            this.y = y;
            this.baseWeight = baseWeight;
        }
    }

    public static class Snapshot {
        public final long cloudId;
        public final String cloudType;
        public final long samplingEpochId;
        public final int sampleCount;
        public final double weightSum;
        public final double weightedRadiusMeters;
        public final double centerLatitude;
        public final double centerLongitude;
        public final long representativeRawPointId;
        public final List<Long> contributingRawPointIds;
        public final TrackTrustScore score;

        Snapshot(long cloudId, String cloudType, long samplingEpochId, int sampleCount,
                 double weightSum, double weightedRadiusMeters, double centerLatitude,
                 double centerLongitude, long representativeRawPointId,
                 List<Long> contributingRawPointIds, TrackTrustScore score) {
            this.cloudId = cloudId;
            this.cloudType = cloudType;
            this.samplingEpochId = samplingEpochId;
            this.sampleCount = sampleCount;
            this.weightSum = weightSum;
            this.weightedRadiusMeters = weightedRadiusMeters;
            this.centerLatitude = centerLatitude;
            this.centerLongitude = centerLongitude;
            this.representativeRawPointId = representativeRawPointId;
            this.contributingRawPointIds = Collections.unmodifiableList(
                    new ArrayList<>(contributingRawPointIds));
            this.score = score;
        }

        static Snapshot empty(long cloudId, String cloudType, long samplingEpochId) {
            return new Snapshot(cloudId, cloudType, samplingEpochId, 0, 0.0,
                    0.0, 0.0, 0.0, 0L, new ArrayList<Long>(),
                    new TrackTrustScore(0, 0, 0, 0, 0, 0, 0));
        }
    }
}
