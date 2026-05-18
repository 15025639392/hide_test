package com.example.gnsssatdemo.track.model;

import org.json.JSONException;
import org.json.JSONObject;

public class GnssSnapshotDiagnosticFields {
    public static final String EVENT = "gnss_snapshot";
    public static final String SNAPSHOT_ID = "snapshotId";
    public static final String RECEIVED_ELAPSED_REALTIME_NANOS = "receivedElapsedRealtimeNanos";
    public static final String VISIBLE_TOTAL = "visibleTotal";
    public static final String USED_IN_FIX_TOTAL = "usedInFixTotal";
    public static final String USED_AVG_CN0 = "usedAvgCn0";
    public static final String ALL_AVG_CN0 = "allAvgCn0";
    public static final String TOP4_AVG_CN0 = "top4AvgCn0";
    public static final String LOW_CN0_VISIBLE_COUNT = "lowCn0VisibleCount";
    public static final String WEAK_USED_COUNT = "weakUsedCount";
    public static final String GPS_USED = "gpsUsed";
    public static final String BEIDOU_USED = "beidouUsed";
    public static final String GALILEO_USED = "galileoUsed";
    public static final String GLONASS_USED = "glonassUsed";
    public static final String QZSS_USED = "qzssUsed";
    public static final String GPS_VISIBLE = "gpsVisible";
    public static final String BEIDOU_VISIBLE = "beidouVisible";
    public static final String GALILEO_VISIBLE = "galileoVisible";
    public static final String GLONASS_VISIBLE = "glonassVisible";
    public static final String QZSS_VISIBLE = "qzssVisible";
    public static final String SBAS_VISIBLE = "sbasVisible";
    public static final String IRNSS_VISIBLE = "irnssVisible";
    public static final String UNKNOWN_VISIBLE = "unknownVisible";
    public static final String OTHER_VISIBLE = "otherVisible";
    public static final String HAS_DUAL_FREQUENCY = "hasDualFrequency";

    public JSONObject toEvent(GnssQualitySnapshot snapshot) throws JSONException {
        JSONObject event = new JSONObject();
        event.put("event", EVENT);
        event.put(SNAPSHOT_ID, snapshot.snapshotId);
        event.put(RECEIVED_ELAPSED_REALTIME_NANOS, snapshot.receivedElapsedRealtimeNanos);
        event.put(VISIBLE_TOTAL, snapshot.visibleTotal);
        event.put(USED_IN_FIX_TOTAL, snapshot.usedInFixTotal);
        event.put(USED_AVG_CN0, snapshot.usedAvgCn0);
        event.put(ALL_AVG_CN0, snapshot.allAvgCn0);
        event.put(TOP4_AVG_CN0, snapshot.top4AvgCn0);
        event.put(LOW_CN0_VISIBLE_COUNT, snapshot.lowCn0VisibleCount);
        event.put(WEAK_USED_COUNT, snapshot.weakUsedCount);
        event.put(GPS_USED, snapshot.gpsUsed);
        event.put(BEIDOU_USED, snapshot.beidouUsed);
        event.put(GALILEO_USED, snapshot.galileoUsed);
        event.put(GLONASS_USED, snapshot.glonassUsed);
        event.put(QZSS_USED, snapshot.qzssUsed);
        event.put(GPS_VISIBLE, snapshot.gpsVisible);
        event.put(BEIDOU_VISIBLE, snapshot.beidouVisible);
        event.put(GALILEO_VISIBLE, snapshot.galileoVisible);
        event.put(GLONASS_VISIBLE, snapshot.glonassVisible);
        event.put(QZSS_VISIBLE, snapshot.qzssVisible);
        event.put(SBAS_VISIBLE, snapshot.sbasVisible);
        event.put(IRNSS_VISIBLE, snapshot.irnssVisible);
        event.put(UNKNOWN_VISIBLE, snapshot.unknownVisible);
        event.put(OTHER_VISIBLE, snapshot.otherVisible);
        event.put(HAS_DUAL_FREQUENCY, snapshot.hasDualFrequency);
        return event;
    }
}
