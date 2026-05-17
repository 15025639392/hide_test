package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.ReferenceTrackPoint;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class GpxReferenceParserTest {
    @Test
    public void parse_readsTrackSegmentsAndPreservesSegmentBreaks() throws Exception {
        String gpx = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<gpx><trk><trkseg>"
                + "<trkpt lat=\"29.0\" lon=\"106.0\"/>"
                + "<trkpt lat=\"29.1\" lon=\"106.1\"/>"
                + "</trkseg><trkseg>"
                + "<trkpt lat=\"30.0\" lon=\"107.0\"/>"
                + "</trkseg></trk></gpx>";

        List<ReferenceTrackPoint> points = parse(gpx);

        assertEquals(3, points.size());
        assertEquals(1, points.get(0).segmentIndex);
        assertEquals(1, points.get(1).segmentIndex);
        assertEquals(2, points.get(2).segmentIndex);
        assertEquals(29.1, points.get(1).latitude, 0.0);
        assertEquals(106.1, points.get(1).longitude, 0.0);
    }

    @Test
    public void parse_readsRoutePointsWhenTrackPointsAreAbsent() throws Exception {
        String gpx = "<gpx><rte>"
                + "<rtept lat=\"29.0\" lon=\"106.0\"/>"
                + "<rtept lat=\"29.2\" lon=\"106.2\"/>"
                + "</rte></gpx>";

        List<ReferenceTrackPoint> points = parse(gpx);

        assertEquals(2, points.size());
        assertEquals(1, points.get(0).segmentIndex);
        assertEquals(29.2, points.get(1).latitude, 0.0);
        assertEquals(106.2, points.get(1).longitude, 0.0);
    }

    @Test
    public void parse_readsNamespacedGpx() throws Exception {
        String gpx = "<gpx:gpx xmlns:gpx=\"http://www.topografix.com/GPX/1/1\">"
                + "<gpx:trk><gpx:trkseg>"
                + "<gpx:trkpt lat=\"29.3\" lon=\"106.3\"/>"
                + "</gpx:trkseg></gpx:trk></gpx:gpx>";

        List<ReferenceTrackPoint> points = parse(gpx);

        assertEquals(1, points.size());
        assertEquals(29.3, points.get(0).latitude, 0.0);
        assertEquals(106.3, points.get(0).longitude, 0.0);
    }

    private List<ReferenceTrackPoint> parse(String gpx) throws Exception {
        return new GpxReferenceParser().parse(new ByteArrayInputStream(
                gpx.getBytes(StandardCharsets.UTF_8)));
    }
}
