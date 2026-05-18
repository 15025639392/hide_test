package com.example.gnsssatdemo;

import android.hardware.SensorManager;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class CompassHeadingReliabilityTest {
    @Test
    public void headingReliable_whenAllSignalsMeetRule() {
        CompassHeadingReliability reliability = reliableState();

        assertTrue(reliability.headingReliable(3_100_000_000L));
        assertEquals("", reliability.unreliableReason(3_100_000_000L));
    }

    @Test
    public void headingReliable_rejectsLowSensorAccuracy() {
        CompassHeadingReliability reliability = reliableState();
        reliability.recordSensorAccuracy(SensorManager.SENSOR_STATUS_ACCURACY_LOW);

        assertFalse(reliability.headingReliable(3_100_000_000L));
        assertEquals("sensor_accuracy_low", reliability.unreliableReason(3_100_000_000L));
    }

    @Test
    public void headingReliable_rejectsMagneticOutlier() {
        CompassHeadingReliability reliability = reliableState();
        reliability.recordMagneticField(100f, 0f, 0f);

        assertFalse(reliability.headingReliable(3_100_000_000L));
        assertEquals("magnetic_norm_outlier", reliability.unreliableReason(3_100_000_000L));
    }

    @Test
    public void headingReliable_rejectsHeadingJitterAcrossWraparound() {
        CompassHeadingReliability reliability = reliableState();
        reliability.recordHeading(90f, 3_000_000_000L);

        assertFalse(reliability.headingReliable(3_100_000_000L));
        assertEquals("heading_jitter", reliability.unreliableReason(3_100_000_000L));
    }

    @Test
    public void headingReliable_acceptsStableWraparoundHeadings() {
        CompassHeadingReliability reliability = baseState();
        reliability.recordHeading(358f, 1_000_000_000L);
        reliability.recordHeading(0f, 2_000_000_000L);
        reliability.recordHeading(2f, 3_000_000_000L);

        assertTrue(reliability.headingCircularStdDevDegrees() < 3f);
        assertTrue(reliability.headingReliable(3_100_000_000L));
    }

    @Test
    public void headingReliable_rejectsDeviceRotating() {
        CompassHeadingReliability reliability = reliableState();
        reliability.recordGyroscope(0.6f, 0f, 0f, 3_000_000_000L);

        assertFalse(reliability.headingReliable(3_100_000_000L));
        assertEquals("device_rotating", reliability.unreliableReason(3_100_000_000L));
    }

    @Test
    public void headingReliable_rejectsMissingRecentGyroscopeSample() {
        CompassHeadingReliability reliability = new CompassHeadingReliability();
        reliability.setSensorAvailability(true, true);
        reliability.recordSensorAccuracy(SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM);
        reliability.recordMagneticField(40f, 0f, 0f);
        reliability.recordGyroscope(0.1f, 0f, 0f, 1_000_000_000L);
        reliability.recordHeading(10f, 4_000_000_000L);
        reliability.recordHeading(11f, 4_100_000_000L);
        reliability.recordHeading(12f, 4_200_000_000L);

        assertFalse(reliability.headingReliable(4_300_000_000L));
        assertEquals("device_rotating", reliability.unreliableReason(4_300_000_000L));
    }

    @Test
    public void headingReliable_rejectsStaleHeading() {
        CompassHeadingReliability reliability = reliableState();

        assertFalse(reliability.headingReliable(3_600_000_001L));
        assertEquals("heading_stale", reliability.unreliableReason(3_600_000_001L));
    }

    private CompassHeadingReliability reliableState() {
        CompassHeadingReliability reliability = baseState();
        reliability.recordHeading(10f, 1_000_000_000L);
        reliability.recordHeading(11f, 2_000_000_000L);
        reliability.recordHeading(12f, 3_000_000_000L);
        return reliability;
    }

    private CompassHeadingReliability baseState() {
        CompassHeadingReliability reliability = new CompassHeadingReliability();
        reliability.setSensorAvailability(true, true);
        reliability.recordSensorAccuracy(SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM);
        reliability.recordMagneticField(40f, 0f, 0f);
        reliability.recordGyroscope(0.1f, 0f, 0f, 3_000_000_000L);
        return reliability;
    }
}
