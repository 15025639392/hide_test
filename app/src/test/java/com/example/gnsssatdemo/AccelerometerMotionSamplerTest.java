package com.example.gnsssatdemo;

import android.hardware.Sensor;

import com.example.gnsssatdemo.track.model.MotionSummary;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AccelerometerMotionSamplerTest {
    @Test
    public void addSample_emitsStillSummaryForQuietLinearAcceleration() {
        List<MotionSummary> summaries = new ArrayList<>();
        AccelerometerMotionSampler sampler = new AccelerometerMotionSampler(summaries::add);

        for (int i = 0; i <= 10; i++) {
            sampler.addSample(Sensor.TYPE_LINEAR_ACCELERATION, (i + 1) * 100_000_000L,
                    0.02f, 0.01f, 0.0f);
        }

        assertEquals(1, summaries.size());
        MotionSummary summary = summaries.get(0);
        assertTrue(summary.deviceStill);
        assertTrue(summary.stillScore >= 0.7);
        assertEquals("TYPE_LINEAR_ACCELERATION", summary.sourceSensorType);
    }

    @Test
    public void addSample_emitsMovingSummaryForStrongLinearAcceleration() {
        List<MotionSummary> summaries = new ArrayList<>();
        AccelerometerMotionSampler sampler = new AccelerometerMotionSampler(summaries::add);

        for (int i = 0; i <= 10; i++) {
            sampler.addSample(Sensor.TYPE_LINEAR_ACCELERATION, (i + 1) * 100_000_000L,
                    1.0f, 0.0f, 0.0f);
        }

        assertEquals(1, summaries.size());
        assertFalse(summaries.get(0).deviceStill);
    }

    @Test
    public void flush_marksTooFewSamplesAsNotStill() {
        List<MotionSummary> summaries = new ArrayList<>();
        AccelerometerMotionSampler sampler = new AccelerometerMotionSampler(summaries::add);

        sampler.addSample(Sensor.TYPE_LINEAR_ACCELERATION, 100_000_000L,
                0.0f, 0.0f, 0.0f);
        sampler.flush();

        assertEquals(1, summaries.size());
        assertFalse(summaries.get(0).deviceStill);
    }

    @Test
    public void addSample_usesGravityMagnitudeForAccelerometerFallback() {
        List<MotionSummary> summaries = new ArrayList<>();
        AccelerometerMotionSampler sampler = new AccelerometerMotionSampler(summaries::add);

        for (int i = 0; i <= 10; i++) {
            sampler.addSample(Sensor.TYPE_ACCELEROMETER, (i + 1) * 100_000_000L,
                    0.0f, 0.0f, 9.80665f);
        }

        assertEquals(1, summaries.size());
        assertTrue(summaries.get(0).deviceStill);
        assertEquals("TYPE_ACCELEROMETER", summaries.get(0).sourceSensorType);
    }
}
