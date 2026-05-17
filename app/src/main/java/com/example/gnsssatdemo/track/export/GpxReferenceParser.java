package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.ReferenceTrackPoint;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;

public class GpxReferenceParser {
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
                    output.add(new ReferenceTrackPoint(latitude, longitude, segmentIndex));
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
}
