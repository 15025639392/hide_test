package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.RawPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

public class TrackDecisionCoordinator {
    private static final TrackStrategyConfig DEFAULT_CONFIG = TrackStrategyConfig.defaultStage1();
    private final TrackDecisionEngine decisionEngine;
    private final TrackStrategyConfig config;
    private boolean transportMode;
    private RawPoint lastTransportRawPoint;
    private RawPoint transportRecoveryCandidateRawPoint;
    private long transportRecoveryCandidateStartElapsedRealtimeNanos;

    public TrackDecisionCoordinator() {
        this(DEFAULT_CONFIG);
    }

    public TrackDecisionCoordinator(TrackStrategyConfig config) {
        this(new TrackDecisionEngine(config), config);
    }

    public TrackDecisionCoordinator(TrackDecisionEngine decisionEngine) {
        this(decisionEngine, DEFAULT_CONFIG);
    }

    public TrackDecisionCoordinator(TrackDecisionEngine decisionEngine,
                                    TrackStrategyConfig config) {
        this.decisionEngine = decisionEngine;
        this.config = config;
    }

    public void reset() {
        transportMode = false;
        lastTransportRawPoint = null;
        resetTransportRecoveryCandidate();
    }

    public Decision decide(RawPoint rawPoint, TrackPoint previousTrackPoint,
                           long lastStationaryKeepaliveElapsedRealtimeNanos,
                           boolean forcedWeakFirstFixEnabled) {
        boolean wasTransportMode = transportMode;
        TrackDecisionResult outcome = transportMode
                ? decideWhileInTransportMode(rawPoint, lastStationaryKeepaliveElapsedRealtimeNanos)
                : decisionEngine.decide(rawPoint, previousTrackPoint,
                lastStationaryKeepaliveElapsedRealtimeNanos, forcedWeakFirstFixEnabled);

        boolean enteredTransportMode = false;
        boolean leftTransportMode = false;
        boolean shouldAddTransportDisplayPoint = false;
        if ("transport_suspected".equals(outcome.reason)) {
            shouldAddTransportDisplayPoint = true;
            enteredTransportMode = !transportMode;
            enterTransportMode(rawPoint);
        } else if ("transport_recovery".equals(outcome.reason)) {
            leftTransportMode = transportMode;
            leaveTransportMode();
        } else if (transportMode && "transport_confirmed".equals(outcome.reason)) {
            shouldAddTransportDisplayPoint = true;
            lastTransportRawPoint = rawPoint;
        }

        return new Decision(outcome, wasTransportMode, transportMode,
                enteredTransportMode, leftTransportMode, shouldAddTransportDisplayPoint);
    }

    private TrackDecisionResult decideWhileInTransportMode(
            RawPoint rawPoint, long lastStationaryKeepaliveElapsedRealtimeNanos) {
        if (lastTransportRawPoint == null) {
            lastTransportRawPoint = rawPoint;
            resetTransportRecoveryCandidate();
            return transportConfirmed(lastStationaryKeepaliveElapsedRealtimeNanos);
        }
        if (!decisionEngine.isTransportRecoveryCandidate(lastTransportRawPoint, rawPoint)) {
            resetTransportRecoveryCandidate();
            return transportConfirmed(lastStationaryKeepaliveElapsedRealtimeNanos);
        }
        if (transportRecoveryCandidateRawPoint == null) {
            transportRecoveryCandidateRawPoint = lastTransportRawPoint;
            transportRecoveryCandidateStartElapsedRealtimeNanos =
                    lastTransportRawPoint.elapsedRealtimeNanos;
        }
        long stableNanos = rawPoint.elapsedRealtimeNanos
                - transportRecoveryCandidateStartElapsedRealtimeNanos;
        double stableDistanceMeters = decisionEngine.rawDistanceMeters(
                transportRecoveryCandidateRawPoint, rawPoint);
        if (stableNanos >= config.transportRecoveryStableNanos
                && stableDistanceMeters >= config.transportRecoveryMinDistanceMeters) {
            return new TrackDecisionResult("accept", "transport_recovery",
                    0.0, 0.0, lastStationaryKeepaliveElapsedRealtimeNanos,
                    0, 0, true);
        }
        return transportConfirmed(lastStationaryKeepaliveElapsedRealtimeNanos);
    }

    private TrackDecisionResult transportConfirmed(long lastStationaryKeepaliveElapsedRealtimeNanos) {
        return new TrackDecisionResult("reject", "transport_confirmed",
                0.0, 0.0, lastStationaryKeepaliveElapsedRealtimeNanos,
                0, 0, false);
    }

    private void enterTransportMode(RawPoint rawPoint) {
        transportMode = true;
        lastTransportRawPoint = rawPoint;
        resetTransportRecoveryCandidate();
    }

    private void leaveTransportMode() {
        transportMode = false;
        lastTransportRawPoint = null;
        resetTransportRecoveryCandidate();
    }

    private void resetTransportRecoveryCandidate() {
        transportRecoveryCandidateRawPoint = null;
        transportRecoveryCandidateStartElapsedRealtimeNanos = 0L;
    }

    public static class Decision {
        public final TrackDecisionResult outcome;
        public final boolean wasTransportMode;
        public final boolean isTransportMode;
        public final boolean enteredTransportMode;
        public final boolean leftTransportMode;
        public final boolean shouldAddTransportDisplayPoint;

        Decision(TrackDecisionResult outcome, boolean wasTransportMode, boolean isTransportMode,
                 boolean enteredTransportMode, boolean leftTransportMode,
                 boolean shouldAddTransportDisplayPoint) {
            this.outcome = outcome;
            this.wasTransportMode = wasTransportMode;
            this.isTransportMode = isTransportMode;
            this.enteredTransportMode = enteredTransportMode;
            this.leftTransportMode = leftTransportMode;
            this.shouldAddTransportDisplayPoint = shouldAddTransportDisplayPoint;
        }
    }
}
