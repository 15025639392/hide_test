package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.MotionSummary;
import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import java.util.List;

public class RestStateMachine {
    public static final String STATE_MOVING = "MOVING";
    public static final String STATE_REST_CANDIDATE = "REST_CANDIDATE";
    public static final String STATE_REST_PAUSED = "REST_PAUSED";
    public static final String STATE_REST_PROBING = "REST_PROBING";

    public static final String REASON_REST_CANDIDATE = "rest_candidate";
    public static final String REASON_REST_PAUSED_KEEPALIVE = "rest_paused_keepalive";
    public static final String REASON_REST_PROBING_STATIONARY = "rest_probing_stationary";
    public static final String REASON_REST_PROBING_CONFIRMING_MOVING =
            "rest_probing_confirming_moving";
    public static final String REASON_REST_MOVING_RECOVERY = "rest_moving_recovery";

    private static final long REST_CONFIRMATION_NANOS = 20_000_000_000L;
    private static final int REST_CONFIRMATION_MIN_POINTS = 2;
    private static final int MOVING_CONFIRMATION_POINTS = 2;
    private static final double MAX_REST_SPEED_METERS_PER_SECOND = 0.5;
    private static final double MAX_ANCHOR_DISTANCE_METERS = 15.0;
    private static final double FAR_FROM_ANCHOR_METERS = 20.0;
    private static final double MOVING_CONFIRMATION_MIN_DISTANCE_METERS = 8.0;
    private static final double ACCURACY_EXPLAIN_MULTIPLIER = 1.5;

    private String state = STATE_MOVING;
    private Anchor anchor;
    private Anchor candidateAnchor;
    private long candidateStartElapsedRealtimeNanos;
    private int candidatePointCount;
    private int probingMovingPointCount;
    private boolean recentMotionMoving;

    public void reset() {
        state = STATE_MOVING;
        anchor = null;
        candidateAnchor = null;
        candidateStartElapsedRealtimeNanos = 0L;
        candidatePointCount = 0;
        probingMovingPointCount = 0;
        recentMotionMoving = false;
    }

    public String stateName() {
        return state;
    }

    public boolean isPaused() {
        return STATE_REST_PAUSED.equals(state);
    }

    public boolean isProbing() {
        return STATE_REST_PROBING.equals(state);
    }

    public boolean onMotionSummary(MotionSummary summary) {
        if (summary == null) {
            return false;
        }
        recentMotionMoving = !summary.deviceStill;
        if (STATE_REST_PAUSED.equals(state) && recentMotionMoving) {
            state = STATE_REST_PROBING;
            probingMovingPointCount = 0;
            return true;
        }
        return false;
    }

    public Decision apply(TrackDecisionResult outcome, RawPoint rawPoint,
                          TrackPoint previousTrackPoint,
                          List<MotionSummary> recentMotionSummaries) {
        if (outcome == null || rawPoint == null || previousTrackPoint == null) {
            reset();
            return Decision.keep(outcome, state);
        }
        if (isTransportReason(outcome.reason)) {
            reset();
            return Decision.keep(outcome, state);
        }
        if (!canUseRestState(outcome)) {
            if (isPaused() || isProbing()) {
                state = STATE_REST_PROBING;
                probingMovingPointCount = 0;
            } else if (!"weak".equals(outcome.result)) {
                reset();
            }
            return Decision.keep(outcome, state);
        }

        if (STATE_REST_PAUSED.equals(state)) {
            return applyPaused(outcome, rawPoint);
        }
        if (STATE_REST_PROBING.equals(state)) {
            return applyProbing(outcome, rawPoint);
        }

        boolean restEvidence = hasRestEntryEvidence(rawPoint, previousTrackPoint,
                recentMotionSummaries);
        if (STATE_REST_CANDIDATE.equals(state)) {
            return applyCandidate(outcome, rawPoint, previousTrackPoint, restEvidence);
        }
        if (restEvidence) {
            startCandidate(rawPoint);
            return Decision.override(reject(REASON_REST_CANDIDATE), state);
        }
        return Decision.keep(outcome, state);
    }

    private Decision applyCandidate(TrackDecisionResult outcome, RawPoint rawPoint,
                                    TrackPoint previousTrackPoint, boolean restEvidence) {
        if (!restEvidence) {
            reset();
            return Decision.keep(outcome, state);
        }
        rememberCandidate(rawPoint);
        long candidateDuration = rawPoint.elapsedRealtimeNanos - candidateStartElapsedRealtimeNanos;
        if (candidatePointCount >= REST_CONFIRMATION_MIN_POINTS
                && candidateDuration >= REST_CONFIRMATION_NANOS) {
            anchor = candidateAnchor;
            state = STATE_REST_PAUSED;
            probingMovingPointCount = 0;
            return Decision.override(reject(REASON_REST_PAUSED_KEEPALIVE), state);
        }
        return Decision.override(reject(REASON_REST_CANDIDATE), state);
    }

    private Decision applyPaused(TrackDecisionResult outcome, RawPoint rawPoint) {
        if (anchor == null) {
            reset();
            return Decision.keep(outcome, state);
        }
        if (isNearAnchor(rawPoint) && isLowSpeed(rawPoint) && !recentMotionMoving) {
            anchor = anchor.betterOf(rawPoint);
            return Decision.override(reject(REASON_REST_PAUSED_KEEPALIVE), state);
        }
        state = STATE_REST_PROBING;
        probingMovingPointCount = 0;
        return applyProbing(outcome, rawPoint);
    }

    private Decision applyProbing(TrackDecisionResult outcome, RawPoint rawPoint) {
        if (anchor == null) {
            reset();
            return Decision.keep(outcome, state);
        }
        if (isNearAnchor(rawPoint) && isLowSpeed(rawPoint)) {
            anchor = anchor.betterOf(rawPoint);
            state = STATE_REST_PAUSED;
            probingMovingPointCount = 0;
            recentMotionMoving = false;
            return Decision.override(reject(REASON_REST_PROBING_STATIONARY), state);
        }
        if (isMovingConfirmation(outcome, rawPoint)) {
            probingMovingPointCount++;
            if (probingMovingPointCount >= MOVING_CONFIRMATION_POINTS) {
                state = STATE_MOVING;
                anchor = null;
                candidateAnchor = null;
                candidatePointCount = 0;
                candidateStartElapsedRealtimeNanos = 0L;
                probingMovingPointCount = 0;
                recentMotionMoving = false;
                return Decision.override(new TrackDecisionResult("accept",
                        REASON_REST_MOVING_RECOVERY, 0.0, 0.0,
                        outcome.nextStationaryKeepaliveElapsedRealtimeNanos, 0, 0, true), state);
            }
            return Decision.override(reject(REASON_REST_PROBING_CONFIRMING_MOVING), state);
        }
        probingMovingPointCount = 0;
        return Decision.override(reject(REASON_REST_PROBING_CONFIRMING_MOVING), state);
    }

    private boolean hasRestEntryEvidence(RawPoint rawPoint, TrackPoint previousTrackPoint,
                                         List<MotionSummary> recentMotionSummaries) {
        return isLowSpeed(rawPoint)
                && isWithinAccuracyExplainableRange(rawPoint, previousTrackPoint)
                && hasStillMotionEvidence(rawPoint.elapsedRealtimeNanos, recentMotionSummaries);
    }

    private boolean hasStillMotionEvidence(long elapsedRealtimeNanos,
                                           List<MotionSummary> recentMotionSummaries) {
        if (recentMotionSummaries == null || recentMotionSummaries.isEmpty()) {
            return false;
        }
        for (int i = recentMotionSummaries.size() - 1; i >= 0; i--) {
            MotionSummary summary = recentMotionSummaries.get(i);
            if (summary.firstElapsedRealtimeNanos <= elapsedRealtimeNanos
                    && summary.lastElapsedRealtimeNanos >= elapsedRealtimeNanos) {
                return summary.deviceStill;
            }
            if (summary.lastElapsedRealtimeNanos <= elapsedRealtimeNanos
                    && elapsedRealtimeNanos - summary.lastElapsedRealtimeNanos
                    <= 5_000_000_000L) {
                return summary.deviceStill;
            }
        }
        return false;
    }

    private boolean canUseRestState(TrackDecisionResult outcome) {
        return "accept".equals(outcome.result)
                || "anchor".equals(outcome.result)
                || isStationaryRejectReason(outcome.reason);
    }

    private boolean isStationaryRejectReason(String reason) {
        return "stationary_keepalive".equals(reason)
                || "stationary_jitter".equals(reason)
                || RestAnchorRefiner.REASON_ANCHOR_REFINED.equals(reason)
                || RestAnchorRefiner.REASON_ACCEL_SUPPORTED_JITTER.equals(reason)
                || REASON_REST_CANDIDATE.equals(reason)
                || REASON_REST_PAUSED_KEEPALIVE.equals(reason)
                || REASON_REST_PROBING_STATIONARY.equals(reason)
                || REASON_REST_PROBING_CONFIRMING_MOVING.equals(reason);
    }

    private boolean isTransportReason(String reason) {
        return "transport_suspected".equals(reason)
                || "transport_confirmed".equals(reason)
                || "transport_recovery".equals(reason);
    }

    private boolean isMovingConfirmation(TrackDecisionResult outcome, RawPoint rawPoint) {
        double anchorDistance = distanceMeters(anchor.latitude, anchor.longitude,
                rawPoint.latitude, rawPoint.longitude);
        boolean awayFromAnchor = anchorDistance >= FAR_FROM_ANCHOR_METERS;
        boolean speedMoving = rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond > MAX_REST_SPEED_METERS_PER_SECOND
                && anchorDistance >= MOVING_CONFIRMATION_MIN_DISTANCE_METERS;
        boolean acceptedMoving = "accept".equals(outcome.result)
                && ("moving_good_fix".equals(outcome.reason)
                || "gap_recovery".equals(outcome.reason)
                || "transport_recovery".equals(outcome.reason));
        return acceptedMoving && (awayFromAnchor || speedMoving || recentMotionMoving);
    }

    private boolean isLowSpeed(RawPoint rawPoint) {
        return rawPoint.hasSpeed
                && rawPoint.speedMetersPerSecond <= MAX_REST_SPEED_METERS_PER_SECOND;
    }

    private boolean isNearAnchor(RawPoint rawPoint) {
        return distanceMeters(anchor.latitude, anchor.longitude,
                rawPoint.latitude, rawPoint.longitude) <= MAX_ANCHOR_DISTANCE_METERS;
    }

    private boolean isWithinAccuracyExplainableRange(RawPoint rawPoint,
                                                     TrackPoint previousTrackPoint) {
        double distanceMeters = distanceMeters(previousTrackPoint.latitude,
                previousTrackPoint.longitude, rawPoint.latitude, rawPoint.longitude);
        double accuracyRange = Math.max(MAX_ANCHOR_DISTANCE_METERS,
                (rawPoint.accuracyMeters + previousTrackPoint.accuracyMeters)
                        * ACCURACY_EXPLAIN_MULTIPLIER);
        return distanceMeters <= accuracyRange;
    }

    private void startCandidate(RawPoint rawPoint) {
        state = STATE_REST_CANDIDATE;
        candidateAnchor = Anchor.from(rawPoint);
        candidateStartElapsedRealtimeNanos = rawPoint.elapsedRealtimeNanos;
        candidatePointCount = 1;
        probingMovingPointCount = 0;
    }

    private void rememberCandidate(RawPoint rawPoint) {
        if (candidateAnchor == null) {
            startCandidate(rawPoint);
            return;
        }
        candidateAnchor = candidateAnchor.betterOf(rawPoint);
        candidatePointCount++;
    }

    private TrackDecisionResult reject(String reason) {
        return new TrackDecisionResult("reject", reason, 0.0, 0.0,
                0L, 0, 1, false);
    }

    private static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double earthRadiusMeters = 6_371_000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return earthRadiusMeters * c;
    }

    public static class Decision {
        public final TrackDecisionResult outcome;
        public final String state;

        private Decision(TrackDecisionResult outcome, String state) {
            this.outcome = outcome;
            this.state = state;
        }

        static Decision keep(TrackDecisionResult outcome, String state) {
            return new Decision(outcome, state);
        }

        static Decision override(TrackDecisionResult outcome, String state) {
            return new Decision(outcome, state);
        }
    }

    private static class Anchor {
        final double latitude;
        final double longitude;
        final float accuracyMeters;

        Anchor(double latitude, double longitude, float accuracyMeters) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.accuracyMeters = accuracyMeters;
        }

        static Anchor from(RawPoint rawPoint) {
            return new Anchor(rawPoint.latitude, rawPoint.longitude, rawPoint.accuracyMeters);
        }

        Anchor betterOf(RawPoint rawPoint) {
            if (rawPoint.accuracyMeters < accuracyMeters) {
                return from(rawPoint);
            }
            return this;
        }
    }
}
