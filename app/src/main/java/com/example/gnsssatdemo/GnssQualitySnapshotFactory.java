package com.example.gnsssatdemo;

import android.location.GnssStatus;
import android.os.Build;

import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.GnssQualitySummary;

public class GnssQualitySnapshotFactory {
    public GnssQualitySnapshot fromStatus(long snapshotId, long receivedElapsedRealtimeNanos,
                                          GnssStatus status) {
        GnssQualitySummary summary = new GnssQualitySummary();
        int satelliteCount = status.getSatelliteCount();
        for (int i = 0; i < satelliteCount; i++) {
            boolean hasCarrierFrequency = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && status.hasCarrierFrequencyHz(i);
            float carrierFrequency = hasCarrierFrequency ? status.getCarrierFrequencyHz(i) : 0f;
            summary.addSatellite(status.getConstellationType(i), status.usedInFix(i),
                    status.getCn0DbHz(i), hasCarrierFrequency, carrierFrequency);
        }
        return summary.toSnapshot(snapshotId, receivedElapsedRealtimeNanos);
    }
}
