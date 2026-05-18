package com.example.gnsssatdemo.track.model;

import android.location.GnssStatus;

public class GnssQualitySummary {
    static final float LOW_CN0_THRESHOLD_DB_HZ = 20f;
    static final float WEAK_USED_CN0_THRESHOLD_DB_HZ = 25f;
    private static final float DISTINCT_CARRIER_FREQUENCY_THRESHOLD_HZ = 1_000_000f;

    private int visibleTotal;
    private int usedInFixTotal;
    private float allCn0Sum;
    private float usedCn0Sum;
    private int lowCn0VisibleCount;
    private int weakUsedCount;
    private int gpsVisible;
    private int beidouVisible;
    private int galileoVisible;
    private int glonassVisible;
    private int qzssVisible;
    private int sbasVisible;
    private int irnssVisible;
    private int unknownVisible;
    private int otherVisible;
    private int gpsUsed;
    private int beidouUsed;
    private int galileoUsed;
    private int glonassUsed;
    private int qzssUsed;
    private final float[] topCn0 = new float[] {Float.NaN, Float.NaN, Float.NaN, Float.NaN};
    private Float firstCarrierFrequencyHz;
    private boolean hasDualFrequency;

    public void addSatellite(int constellationType, boolean usedInFix, float cn0DbHz,
                             boolean hasCarrierFrequencyHz, float carrierFrequencyHz) {
        visibleTotal++;
        allCn0Sum += cn0DbHz;
        rememberTopCn0(cn0DbHz);
        if (cn0DbHz < LOW_CN0_THRESHOLD_DB_HZ) {
            lowCn0VisibleCount++;
        }
        if (hasCarrierFrequencyHz) {
            rememberCarrierFrequency(carrierFrequencyHz);
        }
        switch (constellationType) {
            case GnssStatus.CONSTELLATION_GPS:
                gpsVisible++;
                break;
            case GnssStatus.CONSTELLATION_BEIDOU:
                beidouVisible++;
                break;
            case GnssStatus.CONSTELLATION_GALILEO:
                galileoVisible++;
                break;
            case GnssStatus.CONSTELLATION_GLONASS:
                glonassVisible++;
                break;
            case GnssStatus.CONSTELLATION_QZSS:
                qzssVisible++;
                break;
            case GnssStatus.CONSTELLATION_SBAS:
                sbasVisible++;
                break;
            case GnssStatus.CONSTELLATION_IRNSS:
                irnssVisible++;
                break;
            case GnssStatus.CONSTELLATION_UNKNOWN:
                unknownVisible++;
                break;
            default:
                otherVisible++;
                break;
        }
        if (!usedInFix) {
            return;
        }
        usedInFixTotal++;
        usedCn0Sum += cn0DbHz;
        if (cn0DbHz < WEAK_USED_CN0_THRESHOLD_DB_HZ) {
            weakUsedCount++;
        }
        switch (constellationType) {
            case GnssStatus.CONSTELLATION_GPS:
                gpsUsed++;
                break;
            case GnssStatus.CONSTELLATION_BEIDOU:
                beidouUsed++;
                break;
            case GnssStatus.CONSTELLATION_GALILEO:
                galileoUsed++;
                break;
            case GnssStatus.CONSTELLATION_GLONASS:
                glonassUsed++;
                break;
            case GnssStatus.CONSTELLATION_QZSS:
                qzssUsed++;
                break;
            default:
                break;
        }
    }

    public GnssQualitySnapshot toSnapshot(long snapshotId, long receivedElapsedRealtimeNanos) {
        return new GnssQualitySnapshot(snapshotId, receivedElapsedRealtimeNanos,
                visibleTotal, usedInFixTotal, average(usedCn0Sum, usedInFixTotal),
                average(allCn0Sum, visibleTotal), top4AvgCn0(), lowCn0VisibleCount,
                weakUsedCount, gpsUsed, beidouUsed, galileoUsed, glonassUsed, qzssUsed,
                gpsVisible, beidouVisible, galileoVisible, glonassVisible, qzssVisible,
                sbasVisible, irnssVisible, unknownVisible, otherVisible, hasDualFrequency);
    }

    private void rememberTopCn0(float cn0DbHz) {
        for (int i = 0; i < topCn0.length; i++) {
            if (Float.isNaN(topCn0[i]) || cn0DbHz > topCn0[i]) {
                for (int j = topCn0.length - 1; j > i; j--) {
                    topCn0[j] = topCn0[j - 1];
                }
                topCn0[i] = cn0DbHz;
                return;
            }
        }
    }

    private void rememberCarrierFrequency(float carrierFrequencyHz) {
        if (firstCarrierFrequencyHz == null) {
            firstCarrierFrequencyHz = carrierFrequencyHz;
            return;
        }
        if (Math.abs(carrierFrequencyHz - firstCarrierFrequencyHz)
                >= DISTINCT_CARRIER_FREQUENCY_THRESHOLD_HZ) {
            hasDualFrequency = true;
        }
    }

    private float top4AvgCn0() {
        float sum = 0f;
        int count = 0;
        for (float value : topCn0) {
            if (Float.isNaN(value)) {
                continue;
            }
            sum += value;
            count++;
        }
        return average(sum, count);
    }

    private static float average(float sum, int count) {
        return count == 0 ? 0f : sum / count;
    }
}
