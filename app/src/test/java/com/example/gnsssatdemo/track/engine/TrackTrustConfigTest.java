package com.example.gnsssatdemo.track.engine;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class TrackTrustConfigTest {
    @Test
    public void defaultV3_matchesPublishedSamplingCloudConstants() {
        TrackTrustConfig config = TrackTrustConfig.defaultV3();

        assertEquals(1_000_000_000L, config.startToleranceNanos);
        assertEquals(80f, config.maxIntakeAccuracyMeters, 0f);
        assertEquals(20f, config.firstFixGoodAccuracyMeters, 0f);
        assertEquals(30f, config.firstFixRelaxedAccuracyMeters, 0f);
        assertEquals(30f, config.weakCloudAccuracyMeters, 0f);
        assertEquals(12.0, config.impossibleSpeedMetersPerSecond, 0.0);
        assertEquals(3.5, config.transportSuspectedSpeedMetersPerSecond, 0.0);
        assertEquals(20.0, config.transportSuspectedMinDistanceMeters, 0.0);
        assertEquals(120_000_000_000L, config.gapLineBreakNanos);
        assertEquals(2, config.stationaryCloudMinSamples);
        assertEquals(1, config.movingCloudMinSamples);
        assertEquals(2, config.recoveryCloudMinSamples);
        assertEquals(8.0, config.stationaryCloudMinRadiusMeters, 0.0);
        assertEquals(15.0, config.movingCloudMinRadiusMeters, 0.0);
        assertEquals(12.0, config.recoveryCloudMinRadiusMeters, 0.0);
        assertEquals(0.03, config.startCloudMinWeight, 0.0);
        assertEquals(0.08, config.stationaryCloudMinWeight, 0.0);
        assertEquals(0.03, config.movingCloudMinWeight, 0.0);
        assertEquals(0.08, config.recoveryCloudMinWeight, 0.0);
        assertEquals(20.0, config.cloudTemporalDecaySeconds, 0.0);
    }
}
