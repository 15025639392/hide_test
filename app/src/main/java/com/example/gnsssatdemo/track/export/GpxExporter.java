package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class GpxExporter {
    private static final long GAP_LINE_BREAK_NANOS = 120_000_000_000L;

    private final SimpleDateFormat gpxTimeFormat =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);

    public GpxExporter() {
        gpxTimeFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    public String buildTrustedGpx(String sessionId, List<TrackPoint> trackPoints,
                                  double totalDistanceMeters, double movingTimeSeconds) {
        return buildGpx(sessionId, trackPoints, totalDistanceMeters, movingTimeSeconds, false);
    }

    public String buildPartialGpx(String sessionId, List<TrackPoint> trackPoints,
                                  double totalDistanceMeters, double movingTimeSeconds) {
        return buildGpx(sessionId, trackPoints, totalDistanceMeters, movingTimeSeconds, true);
    }

    private String buildGpx(String sessionId, List<TrackPoint> trackPoints,
                            double totalDistanceMeters, double movingTimeSeconds,
                            boolean partial) {
        StringBuilder sb = new StringBuilder();
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<gpx version=\"1.1\" creator=\"System GNSS Track Demo\" ");
        sb.append("xmlns=\"http://www.topografix.com/GPX/1/1\" ");
        sb.append("xmlns:hike=\"https://codex.local/system-gnss-demo\" ");
        sb.append("xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" ");
        sb.append("xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 ");
        sb.append("http://www.topografix.com/GPX/1/1/gpx.xsd\">\n");
        sb.append("  <metadata>\n");
        sb.append("    <name>System GNSS Track ").append(escapeXml(sessionId)).append("</name>\n");
        if (!trackPoints.isEmpty()) {
            sb.append("    <time>").append(gpxTime(trackPoints.get(0).timeMillis)).append("</time>\n");
        }
        sb.append("    <extensions>\n");
        sb.append("      <hike:totalDistanceMeters>").append(totalDistanceMeters).append("</hike:totalDistanceMeters>\n");
        sb.append("      <hike:movingTimeSeconds>").append(movingTimeSeconds).append("</hike:movingTimeSeconds>\n");
        sb.append("      <hike:trackPointCount>").append(trackPoints.size()).append("</hike:trackPointCount>\n");
        sb.append("      <hike:partial>").append(partial).append("</hike:partial>\n");
        sb.append("    </extensions>\n");
        sb.append("  </metadata>\n");
        sb.append("  <trk>\n");
        sb.append("    <name>System GNSS Track</name>\n");
        boolean segmentOpen = false;
        TrackPoint previousTrustedPoint = null;
        for (TrackPoint point : trackPoints) {
            if (isWeakPoint(point)) {
                if (segmentOpen) {
                    sb.append("    </trkseg>\n");
                    segmentOpen = false;
                }
                sb.append("    <trkseg>\n");
                appendTrackPoint(sb, sessionId, point, partial);
                sb.append("    </trkseg>\n");
                previousTrustedPoint = null;
                continue;
            }
            if (!segmentOpen || isGap(previousTrustedPoint, point)) {
                if (segmentOpen) {
                    sb.append("    </trkseg>\n");
                }
                sb.append("    <trkseg>\n");
                segmentOpen = true;
            }
            appendTrackPoint(sb, sessionId, point, partial);
            previousTrustedPoint = point;
        }
        if (segmentOpen) {
            sb.append("    </trkseg>\n");
        }
        sb.append("  </trk>\n");
        sb.append("</gpx>\n");
        return sb.toString();
    }

    private boolean isWeakPoint(TrackPoint point) {
        return "weak".equals(point.decisionResult);
    }

    private boolean isGap(TrackPoint previous, TrackPoint next) {
        return previous != null
                && previous.elapsedRealtimeNanos > 0L
                && next.elapsedRealtimeNanos > 0L
                && next.elapsedRealtimeNanos - previous.elapsedRealtimeNanos > GAP_LINE_BREAK_NANOS;
    }

    private void appendTrackPoint(StringBuilder sb, String sessionId, TrackPoint point,
                                  boolean partial) {
        sb.append("      <trkpt lat=\"").append(point.latitude)
                .append("\" lon=\"").append(point.longitude).append("\">\n");
        if (point.hasAltitude) {
            sb.append("        <ele>").append(point.altitude).append("</ele>\n");
        }
        sb.append("        <time>").append(gpxTime(point.timeMillis)).append("</time>\n");
        sb.append("        <extensions>\n");
        sb.append("          <hike:sessionId>").append(escapeXml(sessionId)).append("</hike:sessionId>\n");
        sb.append("          <hike:partial>").append(partial).append("</hike:partial>\n");
        sb.append("          <hike:trackPointId>").append(point.trackPointId).append("</hike:trackPointId>\n");
        sb.append("          <hike:segmentId>").append(point.segmentId).append("</hike:segmentId>\n");
        sb.append("          <hike:sourceRawPointId>").append(point.sourceRawPointId).append("</hike:sourceRawPointId>\n");
        sb.append("          <hike:sourceDecisionId>").append(point.sourceDecisionId).append("</hike:sourceDecisionId>\n");
        sb.append("          <hike:elapsedRealtimeNanos>").append(point.elapsedRealtimeNanos).append("</hike:elapsedRealtimeNanos>\n");
        sb.append("          <hike:accuracy>").append(point.accuracyMeters).append("</hike:accuracy>\n");
        sb.append("          <hike:decisionResult>").append(point.decisionResult).append("</hike:decisionResult>\n");
        sb.append("          <hike:decisionReason>").append(point.decisionReason).append("</hike:decisionReason>\n");
        sb.append("          <hike:distanceDeltaMeters>").append(point.distanceDeltaMeters).append("</hike:distanceDeltaMeters>\n");
        sb.append("          <hike:movingTimeDeltaSeconds>").append(point.movingTimeDeltaSeconds).append("</hike:movingTimeDeltaSeconds>\n");
        if (point.sourceGnssSnapshotId != null) {
            sb.append("          <hike:sourceGnssSnapshotId>").append(point.sourceGnssSnapshotId).append("</hike:sourceGnssSnapshotId>\n");
        }
        sb.append("        </extensions>\n");
        sb.append("      </trkpt>\n");
    }

    private String gpxTime(long timeMillis) {
        return gpxTimeFormat.format(new Date(timeMillis));
    }

    private String escapeXml(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
