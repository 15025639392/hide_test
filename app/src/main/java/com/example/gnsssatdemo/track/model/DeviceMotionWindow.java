package com.example.gnsssatdemo.track.model;

public class DeviceMotionWindow {
    public final long deviceMotionWindowId;
    public final long startElapsedRealtimeNanos;
    public final long endElapsedRealtimeNanos;
    public final int linearAccelerationSampleCount;
    public final int accelerometerSampleCount;
    public final int gyroscopeSampleCount;
    public final int rotationVectorSampleCount;
    public final double linearAccelerationRmsMps2;
    public final double linearAccelerationMaxMps2;
    public final double accelerometerDynamicRmsMps2;
    public final double accelerometerDynamicMaxMps2;
    public final double gyroscopeRmsRadps;
    public final double gyroscopeMaxRadps;
    public final double yawDeltaDegrees;
    public final double pitchDeltaDegrees;
    public final double rollDeltaDegrees;
    public final int stepDetectorCount;
    public final int stepCounterDelta;
    public final boolean stepCounterAvailable;

    public DeviceMotionWindow(long deviceMotionWindowId,
                              long startElapsedRealtimeNanos,
                              long endElapsedRealtimeNanos,
                              int linearAccelerationSampleCount,
                              int accelerometerSampleCount,
                              int gyroscopeSampleCount,
                              int rotationVectorSampleCount,
                              double linearAccelerationRmsMps2,
                              double linearAccelerationMaxMps2,
                              double accelerometerDynamicRmsMps2,
                              double accelerometerDynamicMaxMps2,
                              double gyroscopeRmsRadps,
                              double gyroscopeMaxRadps,
                              double yawDeltaDegrees,
                              double pitchDeltaDegrees,
                              double rollDeltaDegrees,
                              int stepDetectorCount,
                              int stepCounterDelta,
                              boolean stepCounterAvailable) {
        this.deviceMotionWindowId = deviceMotionWindowId;
        this.startElapsedRealtimeNanos = startElapsedRealtimeNanos;
        this.endElapsedRealtimeNanos = endElapsedRealtimeNanos;
        this.linearAccelerationSampleCount = linearAccelerationSampleCount;
        this.accelerometerSampleCount = accelerometerSampleCount;
        this.gyroscopeSampleCount = gyroscopeSampleCount;
        this.rotationVectorSampleCount = rotationVectorSampleCount;
        this.linearAccelerationRmsMps2 = linearAccelerationRmsMps2;
        this.linearAccelerationMaxMps2 = linearAccelerationMaxMps2;
        this.accelerometerDynamicRmsMps2 = accelerometerDynamicRmsMps2;
        this.accelerometerDynamicMaxMps2 = accelerometerDynamicMaxMps2;
        this.gyroscopeRmsRadps = gyroscopeRmsRadps;
        this.gyroscopeMaxRadps = gyroscopeMaxRadps;
        this.yawDeltaDegrees = yawDeltaDegrees;
        this.pitchDeltaDegrees = pitchDeltaDegrees;
        this.rollDeltaDegrees = rollDeltaDegrees;
        this.stepDetectorCount = stepDetectorCount;
        this.stepCounterDelta = stepCounterDelta;
        this.stepCounterAvailable = stepCounterAvailable;
    }
}
