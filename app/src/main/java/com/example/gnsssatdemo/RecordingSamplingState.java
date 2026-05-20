package com.example.gnsssatdemo;

final class RecordingSamplingState {
    private static final int PAUSED_KEEPALIVE_THRESHOLD = 2;
    private int consecutiveStationaryKeepaliveCount;
    private int consecutiveStationaryJitterCount;

    void reset() {
        consecutiveStationaryKeepaliveCount = 0;
        consecutiveStationaryJitterCount = 0;
    }

    void onDecisionReason(String reason) {
        if ("stationary_cloud_jitter".equals(reason)) {
            consecutiveStationaryJitterCount++;
            return;
        }
        if ("stationary_anchor".equals(reason)) {
            consecutiveStationaryKeepaliveCount++;
            return;
        }
        reset();
    }

    boolean shouldUsePausedPolicy() {
        return consecutiveStationaryKeepaliveCount >= PAUSED_KEEPALIVE_THRESHOLD;
    }

    int consecutiveStationaryKeepaliveCount() {
        return consecutiveStationaryKeepaliveCount;
    }

    int consecutiveStationaryJitterCount() {
        return consecutiveStationaryJitterCount;
    }
}
