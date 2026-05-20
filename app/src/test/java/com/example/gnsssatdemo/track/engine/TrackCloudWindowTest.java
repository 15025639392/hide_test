package com.example.gnsssatdemo.track.engine;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.RawPoint;

import org.junit.Test;

import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public class TrackCloudWindowTest {
    @Test
    public void weightedCenterCanBeVirtualCoordinateBetweenRawSamples() {
        TrackCloudWindow cloud = new TrackCloudWindow(1L, "MOVING_CLOUD", 1L);
        GnssQualitySnapshot snapshot = strongSnapshot();

        cloud.add(raw(1L, 29.0, 106.0, 2_000_000_000L, 5f), snapshot,
                Collections.emptyList());
        TrackCloudWindow.Snapshot result = cloud.add(
                raw(2L, 29.0001, 106.0, 3_000_000_000L, 5f), snapshot,
                Collections.emptyList());

        assertTrue(result.centerLatitude > 29.0);
        assertTrue(result.centerLatitude < 29.0001);
        assertEquals(106.0, result.centerLongitude, 0.0000001);
        assertNotEquals(29.0, result.centerLatitude, 0.000000001);
        assertNotEquals(29.0001, result.centerLatitude, 0.000000001);
        assertEquals(2, result.contributingRawPointIds.size());
    }

    @Test
    public void temporalWeightUsesFixMeasurementTimeInsideCloud() {
        TrackCloudWindow cloud = new TrackCloudWindow(1L, "MOVING_CLOUD", 1L);
        GnssQualitySnapshot snapshot = strongSnapshot();

        cloud.add(raw(1L, 29.0, 106.0, 2_000_000_000L, 5f), snapshot,
                Collections.emptyList());
        TrackCloudWindow.Snapshot closeInTime = cloud.add(
                raw(2L, 29.0001, 106.0, 3_000_000_000L, 5f), snapshot,
                Collections.emptyList());

        TrackCloudWindow delayedCloud = new TrackCloudWindow(2L, "MOVING_CLOUD", 1L);
        delayedCloud.add(raw(1L, 29.0, 106.0, 2_000_000_000L, 5f), snapshot,
                Collections.emptyList());
        TrackCloudWindow.Snapshot sameFixTimes = delayedCloud.add(
                raw(2L, 29.0001, 106.0, 3_000_000_000L, 5f), snapshot,
                Collections.emptyList());

        assertEquals(closeInTime.weightSum, sameFixTimes.weightSum, 0.0);
        assertEquals(closeInTime.centerLatitude, sameFixTimes.centerLatitude, 0.0);
    }

    private GnssQualitySnapshot strongSnapshot() {
        return new GnssQualitySnapshot(1L, 1_000_000_000L,
                12, 9, 30f, 7, 1, 1, 0, 0);
    }

    private RawPoint raw(long id, double latitude, double longitude,
                         long elapsedRealtimeNanos, float accuracyMeters) {
        return new RawPoint(id, "gps", latitude, longitude,
                false, 0.0, true, accuracyMeters,
                true, 1.0f, false, 0f, 1L,
                true, elapsedRealtimeNanos, false, null);
    }
}
