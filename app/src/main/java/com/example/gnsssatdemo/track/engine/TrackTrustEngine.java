package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.DeviceMotionWindow;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.List;

public class TrackTrustEngine {
    public static final String VERSION = "stage2-track-trust-v3-sampling-cloud";
    public static final long GAP_NANOS = 120_000_000_000L;
    public static final float FIRST_FIX_GOOD_ACCURACY_METERS = 20f;
    public static final float FIRST_FIX_RELAXED_ACCURACY_METERS = 30f;
    public static final float WEAK_CLOUD_ACCURACY_METERS = 30f;
    public static final double STATIONARY_DISTANCE_METERS = 5.0;
    public static final double STATIONARY_ACCURACY_MULTIPLIER = 1.5;
    public static final double IMPOSSIBLE_SPEED_METERS_PER_SECOND = 12.0;
    public static final double TRANSPORT_SPEED_METERS_PER_SECOND = 3.5;
    public static final double TRANSPORT_MIN_DISTANCE_METERS = 20.0;
    public static final float CONTINUITY_RESCUE_MAX_ACCURACY_METERS = 650f;
    public static final double CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND = 6.0;
    public static final double MOTION_SUPPORTED_MIN_SPEED_METERS_PER_SECOND = 0.8;
    public static final double MOTION_SUPPORTED_MAX_SPEED_METERS_PER_SECOND = 3.5;
    public static final double MOTION_SUPPORTED_MIN_DISTANCE_METERS = 2.5;
    public static final float LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS = 35f;
    public static final int LOW_ACCURACY_RESCUE_MIN_USED_IN_FIX = 5;
    public static final double LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS = 2.5;
    private static final long MOTION_WINDOW_NANOS = 5_000_000_000L;
    private long nextCloudId = 1L;
    private TrackCloudWindow currentCloud;
    private String currentCloudType = "";
    private boolean resetMovingCloudAfterAccept;
    private RawPoint recoveryPreviousRawPoint;

    public void reset() {
        nextCloudId = 1L;
        currentCloud = null;
        currentCloudType = "";
        resetMovingCloudAfterAccept = false;
        recoveryPreviousRawPoint = null;
    }

    public TrackTrustDecision decide(RawPoint rawPoint, SamplingEpoch epoch,
                                     GnssQualitySnapshot snapshot,
                                     List<DeviceMotionWindow> motionWindows,
                                     TrackPoint previousTrustedTrackPoint) {
        String cloudType = chooseCloudType(rawPoint, epoch, previousTrustedTrackPoint);
        if (!cloudType.equals(currentCloudType)
                || currentCloud == null
                || currentCloud.samplingEpochId != epoch.samplingEpochId
                || shouldResetMovingCloud(cloudType)) {
            currentCloud = new TrackCloudWindow(nextCloudId++, cloudType, epoch.samplingEpochId);
            currentCloudType = cloudType;
            if ("MOVING_CLOUD".equals(cloudType) || "TRANSPORT_RISK_CLOUD".equals(cloudType)) {
                resetMovingCloudAfterAccept = false;
            }
            recoveryPreviousRawPoint = null;
        }
        TrackCloudWindow.Snapshot cloud = currentCloud.add(rawPoint, snapshot, motionWindows);
        boolean stable = currentCloud.isStable()
                || ("RECOVERY_CLOUD".equals(cloudType)
                && currentCloud.recoveryFastPath()
                && recoveryFastPathAllowed(rawPoint, previousTrustedTrackPoint));
        String result;
        String reason;
        String grade;
        boolean startsNewSegment = false;
        double distanceDelta = 0.0;
        double movingTimeDelta = 0.0;

        if ("START_CLOUD".equals(cloudType)) {
            result = "anchor";
            reason = rawPoint.accuracyMeters <= FIRST_FIX_GOOD_ACCURACY_METERS
                    ? "first_fix_good" : "first_fix_relaxed";
            grade = "ANCHOR";
        } else if ("RECOVERY_CLOUD".equals(cloudType)) {
            if (isRecoveryTransportRescuePoint(rawPoint, recoveryPreviousRawPoint)) {
                result = "accept";
                reason = "recovery_transport_suspected_kept";
                grade = "RECOVERY";
                startsNewSegment = previousTrustedTrackPoint != null
                        && recoveryPreviousRawPoint != null
                        && previousTrustedTrackPoint.elapsedRealtimeNanos
                        < recoveryPreviousRawPoint.elapsedRealtimeNanos;
            } else if (stable) {
                result = "accept";
                reason = "gap_recovery";
                grade = "RECOVERY";
                startsNewSegment = previousTrustedTrackPoint != null;
            } else if (isRecoveryContinuityRescuePoint(rawPoint, recoveryPreviousRawPoint)) {
                result = "accept";
                reason = "continuity_rescue_gap_recovery";
                grade = "RECOVERY";
                startsNewSegment = previousTrustedTrackPoint != null;
            } else {
                result = "weak";
                reason = "recovery_cloud_pending";
                grade = "WEAK";
            }
        } else if ("WEAK_CLOUD".equals(cloudType)) {
            if (isLowAccuracyRescuePoint(rawPoint, previousTrustedTrackPoint, snapshot)) {
                result = "accept";
                reason = "continuity_rescue_low_accuracy";
                grade = "TRUSTED";
                resetMovingCloudAfterAccept = true;
            } else {
                result = "weak";
                reason = "weak_signal_stage2";
                grade = "WEAK";
            }
        } else if ("STATIONARY_CLOUD".equals(cloudType)) {
            if (stable && hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionWindows)) {
                result = "anchor";
                reason = "stationary_anchor";
                grade = "ANCHOR";
            } else if (hasRecentActiveMotion(rawPoint.elapsedRealtimeNanos, motionWindows)
                    && isMotionSupportedLowSpeedPoint(rawPoint, previousTrustedTrackPoint)) {
                result = "accept";
                reason = "motion_supported_low_speed";
                grade = "TRUSTED";
                resetMovingCloudAfterAccept = true;
            } else if (!hasRecentStillMotion(rawPoint.elapsedRealtimeNanos, motionWindows)
                    && isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint)) {
                result = "reject";
                reason = "stationary_continuity_jitter";
                grade = "REJECT";
                resetMovingCloudAfterAccept = true;
            } else {
                result = "reject";
                reason = "stationary_cloud_jitter";
                grade = "REJECT";
            }
        } else if ("TRANSPORT_RISK_CLOUD".equals(cloudType)) {
            result = "accept";
            reason = "transport_suspected_kept";
            grade = "TRUSTED";
            resetMovingCloudAfterAccept = true;
        } else {
            if (stable) {
                result = "accept";
                reason = "moving_good_fix";
                grade = "TRUSTED";
                resetMovingCloudAfterAccept = true;
            } else {
                result = "weak";
                reason = "moving_cloud_unstable";
                grade = "WEAK";
            }
        }
        if ("RECOVERY_CLOUD".equals(cloudType)) {
            recoveryPreviousRawPoint = rawPoint;
        }
        double targetLatitude = usesRawCoordinate(reason) ? rawPoint.latitude : cloud.centerLatitude;
        double targetLongitude = usesRawCoordinate(reason) ? rawPoint.longitude : cloud.centerLongitude;
        boolean virtualTrackPointCoordinate = !usesRawCoordinate(reason);
        if (("accept".equals(result) || "anchor".equals(result))
                && previousTrustedTrackPoint != null
                && !startsNewSegment
                && shouldAccumulateMovement(reason)) {
            distanceDelta = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                    previousTrustedTrackPoint.longitude, targetLatitude, targetLongitude);
            movingTimeDelta = Math.max(0.0,
                    (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos)
                            / 1_000_000_000.0);
        }
        TrackTrustScore score = scoreWithSpeedPlausibility(cloud.score, rawPoint,
                previousTrustedTrackPoint);
        return new TrackTrustDecision(result, reason, grade, cloud.cloudType, cloud.cloudId,
                cloud.sampleCount, cloud.weightSum, cloud.weightedRadiusMeters,
                targetLatitude, targetLongitude, cloud.representativeRawPointId,
                cloud.contributingRawPointIds, virtualTrackPointCoordinate, score, epoch.samplingEpochId,
                startsNewSegment, distanceDelta, movingTimeDelta, rawPoint);
    }

    private boolean shouldResetMovingCloud(String cloudType) {
        return ("MOVING_CLOUD".equals(cloudType) || "TRANSPORT_RISK_CLOUD".equals(cloudType))
                && resetMovingCloudAfterAccept;
    }

    private String chooseCloudType(RawPoint rawPoint, SamplingEpoch epoch,
                                   TrackPoint previousTrustedTrackPoint) {
        if (previousTrustedTrackPoint == null) {
            return rawPoint.accuracyMeters > WEAK_CLOUD_ACCURACY_METERS
                    ? "WEAK_CLOUD" : "START_CLOUD";
        }
        double deltaSeconds = (rawPoint.elapsedRealtimeNanos
                - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000.0;
        if (rawPoint.elapsedRealtimeNanos - previousTrustedTrackPoint.elapsedRealtimeNanos
                > GAP_NANOS) {
            return "RECOVERY_CLOUD";
        }
        if (rawPoint.accuracyMeters > WEAK_CLOUD_ACCURACY_METERS) {
            return "WEAK_CLOUD";
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        if (isPausedEpoch(epoch)) {
            if (distance < stationaryThreshold(rawPoint)) {
                return "STATIONARY_CLOUD";
            }
            return "RECOVERY_CLOUD";
        }
        if (deltaSeconds > 0.0) {
            double speed = distance / deltaSeconds;
            if (isTransportRisk(rawPoint, speed, distance)) {
                return "TRANSPORT_RISK_CLOUD";
            }
            if (speed > IMPOSSIBLE_SPEED_METERS_PER_SECOND) {
                return "WEAK_CLOUD";
            }
        }
        if (distance < stationaryThreshold(rawPoint)) {
            return "STATIONARY_CLOUD";
        }
        return "MOVING_CLOUD";
    }

    private boolean isTransportRisk(RawPoint rawPoint, double derivedSpeedMetersPerSecond,
                                    double distanceMeters) {
        if (derivedSpeedMetersPerSecond < TRANSPORT_SPEED_METERS_PER_SECOND
                && (!rawPoint.hasSpeed
                || rawPoint.speedMetersPerSecond < TRANSPORT_SPEED_METERS_PER_SECOND)) {
            return false;
        }
        if (distanceMeters >= TRANSPORT_MIN_DISTANCE_METERS) {
            return true;
        }
        return rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond >= TRANSPORT_SPEED_METERS_PER_SECOND
                && distanceMeters >= stationaryThreshold(rawPoint);
    }

    private boolean isContinuityRescuePoint(RawPoint rawPoint,
                                            TrackPoint previousTrustedTrackPoint) {
        if (previousTrustedTrackPoint == null || rawPoint == null) {
            return false;
        }
        if (!Double.isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters > CONTINUITY_RESCUE_MAX_ACCURACY_METERS) {
            return false;
        }
        long elapsedDelta = rawPoint.elapsedRealtimeNanos
                - previousTrustedTrackPoint.elapsedRealtimeNanos;
        if (elapsedDelta <= 0L || elapsedDelta > GAP_NANOS) {
            return false;
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double speed = distance / (elapsedDelta / 1_000_000_000.0);
        return speed <= CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND
                || (rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond <= CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND);
    }

    private boolean isLowAccuracyRescuePoint(RawPoint rawPoint,
                                             TrackPoint previousTrustedTrackPoint,
                                             GnssQualitySnapshot snapshot) {
        if (!isContinuityRescuePoint(rawPoint, previousTrustedTrackPoint)) {
            return false;
        }
        if (!Double.isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters > LOW_ACCURACY_RESCUE_MAX_ACCURACY_METERS) {
            return false;
        }
        if (snapshot == null || snapshot.usedInFixTotal < LOW_ACCURACY_RESCUE_MIN_USED_IN_FIX) {
            return false;
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        return distance >= LOW_ACCURACY_RESCUE_MIN_DISTANCE_METERS;
    }

    private boolean isRecoveryContinuityRescuePoint(RawPoint rawPoint, RawPoint previousRawPoint) {
        if (previousRawPoint == null || rawPoint == null) {
            return false;
        }
        if (!Double.isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters > CONTINUITY_RESCUE_MAX_ACCURACY_METERS) {
            return false;
        }
        long elapsedDelta = rawPoint.elapsedRealtimeNanos - previousRawPoint.elapsedRealtimeNanos;
        if (elapsedDelta <= 0L || elapsedDelta > GAP_NANOS) {
            return false;
        }
        double distance = TrackCloudWindow.distanceMeters(previousRawPoint.latitude,
                previousRawPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double speed = distance / (elapsedDelta / 1_000_000_000.0);
        return speed <= CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND
                || (rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond <= CONTINUITY_RESCUE_MAX_SPEED_METERS_PER_SECOND);
    }

    private boolean isRecoveryTransportRescuePoint(RawPoint rawPoint, RawPoint previousRawPoint) {
        if (previousRawPoint == null || rawPoint == null) {
            return false;
        }
        if (!Double.isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters > SamplingIntake.MAX_ACCURACY_METERS) {
            return false;
        }
        long elapsedDelta = rawPoint.elapsedRealtimeNanos - previousRawPoint.elapsedRealtimeNanos;
        if (elapsedDelta <= 0L || elapsedDelta > GAP_NANOS) {
            return false;
        }
        double distance = TrackCloudWindow.distanceMeters(previousRawPoint.latitude,
                previousRawPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double speed = distance / (elapsedDelta / 1_000_000_000.0);
        return isTransportRisk(rawPoint, speed, distance);
    }

    private boolean usesRawCoordinate(String reason) {
        return "moving_good_fix".equals(reason)
                || "transport_suspected_kept".equals(reason)
                || "recovery_transport_suspected_kept".equals(reason)
                || "motion_supported_low_speed".equals(reason)
                || "gap_recovery".equals(reason)
                || (reason != null && reason.startsWith("continuity_rescue_"));
    }

    private boolean shouldAccumulateMovement(String reason) {
        return "moving_good_fix".equals(reason)
                || "transport_suspected_kept".equals(reason)
                || "recovery_transport_suspected_kept".equals(reason)
                || "continuity_rescue_low_accuracy".equals(reason)
                || "motion_supported_low_speed".equals(reason);
    }

    private boolean recoveryFastPathAllowed(RawPoint rawPoint,
                                            TrackPoint previousTrustedTrackPoint) {
        if (previousTrustedTrackPoint == null) {
            return true;
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        return distance >= stationaryThreshold(rawPoint);
    }

    private double stationaryThreshold(RawPoint rawPoint) {
        return Math.max(STATIONARY_DISTANCE_METERS,
                rawPoint.accuracyMeters * STATIONARY_ACCURACY_MULTIPLIER);
    }

    private boolean isPausedEpoch(SamplingEpoch epoch) {
        return epoch != null && "PAUSED".equals(epoch.state);
    }

    private boolean hasRecentStillMotion(long elapsedRealtimeNanos,
                                         List<DeviceMotionWindow> motionWindows) {
        if (motionWindows == null) {
            return false;
        }
        long cutoff = elapsedRealtimeNanos - MOTION_WINDOW_NANOS;
        int total = 0;
        int still = 0;
        for (DeviceMotionWindow window : motionWindows) {
            if (window.endElapsedRealtimeNanos < cutoff
                    || window.startElapsedRealtimeNanos > elapsedRealtimeNanos) {
                continue;
            }
            total++;
            if (isLowMotionWindow(window)) {
                still++;
            }
        }
        return total > 0 && still / (double) total >= 0.75;
    }

    private boolean hasRecentActiveMotion(long elapsedRealtimeNanos,
                                          List<DeviceMotionWindow> motionWindows) {
        if (motionWindows == null) {
            return false;
        }
        long cutoff = elapsedRealtimeNanos - MOTION_WINDOW_NANOS;
        int total = 0;
        int active = 0;
        for (DeviceMotionWindow window : motionWindows) {
            if (window.endElapsedRealtimeNanos < cutoff
                    || window.startElapsedRealtimeNanos > elapsedRealtimeNanos) {
                continue;
            }
            total++;
            double accelRms = window.linearAccelerationSampleCount > 0
                    ? window.linearAccelerationRmsMps2 : window.accelerometerDynamicRmsMps2;
            if (accelRms >= 0.35
                    || window.gyroscopeRmsRadps >= 0.12
                    || window.stepCounterDelta > 0
                    || window.stepDetectorCount > 0) {
                active++;
            }
        }
        return total > 0 && active / (double) total >= 0.5;
    }

    private boolean isMotionSupportedLowSpeedPoint(RawPoint rawPoint,
                                                   TrackPoint previousTrustedTrackPoint) {
        if (previousTrustedTrackPoint == null || rawPoint == null) {
            return false;
        }
        if (!Double.isFinite(rawPoint.accuracyMeters)
                || rawPoint.accuracyMeters > WEAK_CLOUD_ACCURACY_METERS) {
            return false;
        }
        long elapsedDelta = rawPoint.elapsedRealtimeNanos
                - previousTrustedTrackPoint.elapsedRealtimeNanos;
        if (elapsedDelta <= 0L || elapsedDelta > GAP_NANOS) {
            return false;
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double speed = distance / (elapsedDelta / 1_000_000_000.0);
        return distance >= MOTION_SUPPORTED_MIN_DISTANCE_METERS
                && speed >= MOTION_SUPPORTED_MIN_SPEED_METERS_PER_SECOND
                && speed <= MOTION_SUPPORTED_MAX_SPEED_METERS_PER_SECOND;
    }

    private boolean isLowMotionWindow(DeviceMotionWindow window) {
        double accelRms = window.linearAccelerationSampleCount > 0
                ? window.linearAccelerationRmsMps2 : window.accelerometerDynamicRmsMps2;
        return accelRms <= 0.18
                && window.gyroscopeRmsRadps <= 0.08
                && window.stepDetectorCount == 0
                && window.stepCounterDelta == 0;
    }

    private TrackTrustScore scoreWithSpeedPlausibility(TrackTrustScore score, RawPoint rawPoint,
                                                       TrackPoint previousTrustedTrackPoint) {
        return new TrackTrustScore(score.accuracyScore, score.samplingContinuityScore,
                score.timeContinuityScore, score.spatialCohesionScore,
                score.motionConsistencyScore, score.gnssQualityScore,
                speedPlausibilityScore(rawPoint, previousTrustedTrackPoint));
    }

    private int speedPlausibilityScore(RawPoint rawPoint, TrackPoint previousTrustedTrackPoint) {
        if (previousTrustedTrackPoint == null) {
            return 100;
        }
        double deltaSeconds = (rawPoint.elapsedRealtimeNanos
                - previousTrustedTrackPoint.elapsedRealtimeNanos) / 1_000_000_000.0;
        if (deltaSeconds <= 0.0) {
            return 0;
        }
        double distance = TrackCloudWindow.distanceMeters(previousTrustedTrackPoint.latitude,
                previousTrustedTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double speed = distance / deltaSeconds;
        if (speed > IMPOSSIBLE_SPEED_METERS_PER_SECOND) {
            return 0;
        }
        if (speed >= TRANSPORT_SPEED_METERS_PER_SECOND
                && distance >= TRANSPORT_MIN_DISTANCE_METERS) {
            return 40;
        }
        if (speed > 2.5) {
            return 70;
        }
        return 100;
    }
}
