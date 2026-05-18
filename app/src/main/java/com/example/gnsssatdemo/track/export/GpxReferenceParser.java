package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.ReferenceTrackPoint;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

import java.io.IOException;
import java.io.InputStream;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

public class GpxReferenceParser {
    private final SimpleDateFormat gpxTimeFormat =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
    private final SimpleDateFormat gpxTimeMillisFormat =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    private final SimpleDateFormat gpxOffsetTimeFormat =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
    private final SimpleDateFormat gpxOffsetTimeMillisFormat =
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);

    public GpxReferenceParser() {
        TimeZone utc = TimeZone.getTimeZone("UTC");
        gpxTimeFormat.setTimeZone(utc);
        gpxTimeMillisFormat.setTimeZone(utc);
    }

    public List<ReferenceTrackPoint> parse(InputStream inputStream)
            throws IOException, ParserConfigurationException, SAXException {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        try {
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        } catch (ParserConfigurationException ignored) {
            // Some Android/JVM parsers do not expose all hardening flags.
        }
        Document document = factory.newDocumentBuilder().parse(inputStream);
        List<ReferenceTrackPoint> points = new ArrayList<>();
        int segmentIndex = 1;

        NodeList trackSegments = document.getElementsByTagNameNS("*", "trkseg");
        for (int i = 0; i < trackSegments.getLength(); i++) {
            Element segment = (Element) trackSegments.item(i);
            NodeList trackPoints = segment.getElementsByTagNameNS("*", "trkpt");
            if (appendPoints(points, trackPoints, segmentIndex)) {
                segmentIndex++;
            }
        }

        NodeList routes = document.getElementsByTagNameNS("*", "rte");
        for (int i = 0; i < routes.getLength(); i++) {
            Element route = (Element) routes.item(i);
            NodeList routePoints = route.getElementsByTagNameNS("*", "rtept");
            if (appendPoints(points, routePoints, segmentIndex)) {
                segmentIndex++;
            }
        }

        if (points.isEmpty()) {
            appendPoints(points, document.getElementsByTagNameNS("*", "wpt"), segmentIndex);
        }
        return points;
    }

    private boolean appendPoints(List<ReferenceTrackPoint> output, NodeList nodes,
                                 int segmentIndex) {
        boolean appended = false;
        for (int i = 0; i < nodes.getLength(); i++) {
            if (!(nodes.item(i) instanceof Element)) {
                continue;
            }
            Element element = (Element) nodes.item(i);
            String latText = element.getAttribute("lat");
            String lonText = element.getAttribute("lon");
            try {
                double latitude = Double.parseDouble(latText);
                double longitude = Double.parseDouble(lonText);
                if (isValidCoordinate(latitude, longitude)) {
                    output.add(new ReferenceTrackPoint(latitude, longitude, segmentIndex,
                            parseTimeMillis(element)));
                    appended = true;
                }
            } catch (NumberFormatException ignored) {
                // Skip malformed GPX points while preserving the rest of the reference route.
            }
        }
        return appended;
    }

    private boolean isValidCoordinate(double latitude, double longitude) {
        return latitude >= -90.0 && latitude <= 90.0
                && longitude >= -180.0 && longitude <= 180.0
                && !(latitude == 0.0 && longitude == 0.0);
    }

    private long parseTimeMillis(Element pointElement) {
        NodeList timeNodes = pointElement.getElementsByTagNameNS("*", "time");
        if (timeNodes.getLength() == 0) {
            return 0L;
        }
        String text = timeNodes.item(0).getTextContent();
        if (text == null) {
            return 0L;
        }
        String trimmed = text.trim();
        if (trimmed.isEmpty()) {
            return 0L;
        }
        Date parsed = parseDate(gpxTimeMillisFormat, trimmed);
        if (parsed == null) {
            parsed = parseDate(gpxTimeFormat, trimmed);
        }
        if (parsed == null) {
            parsed = parseDate(gpxOffsetTimeMillisFormat, trimmed);
        }
        if (parsed == null) {
            parsed = parseDate(gpxOffsetTimeFormat, trimmed);
        }
        return parsed == null ? 0L : parsed.getTime();
    }

    private Date parseDate(SimpleDateFormat format, String text) {
        try {
            return format.parse(text);
        } catch (ParseException ignored) {
            return null;
        }
    }
}
