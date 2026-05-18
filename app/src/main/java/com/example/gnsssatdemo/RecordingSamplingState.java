package com.example.gnsssatdemo;

final class RecordingSamplingState {
    private static final int PAUSED_KEEPALIVE_THRESHOLD = 2;
    private static final int PAUSED_JITTER_THRESHOLD = 10;

    private int consecutiveStationaryKeepaliveCount;
    private int consecutiveStationaryJitterCount;

    void reset() {
        consecutiveStationaryKeepaliveCount = 0;
        consecutiveStationaryJitterCount = 0;
    }

    void onDecisionReason(String reason) {
        if ("stationary_keepalive".equals(reason)) {
            consecutiveStationaryKeepaliveCount++;
            return;
        }
        if ("stationary_jitter".equals(reason)
                || "stationary_anchor_refined".equals(reason)
                || "stationary_accel_supported_jitter".equals(reason)
                || "stationary_gap_recovery".equals(reason)) {
            consecutiveStationaryJitterCount++;
            return;
        }
        reset();
    }

    boolean shouldUsePausedPolicy() {
        return consecutiveStationaryKeepaliveCount >= PAUSED_KEEPALIVE_THRESHOLD
                || consecutiveStationaryJitterCount >= PAUSED_JITTER_THRESHOLD;
    }

    int consecutiveStationaryKeepaliveCount() {
        return consecutiveStationaryKeepaliveCount;
    }

    int consecutiveStationaryJitterCount() {
        return consecutiveStationaryJitterCount;
    }
}
