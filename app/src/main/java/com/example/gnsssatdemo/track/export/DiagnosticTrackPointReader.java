package com.example.gnsssatdemo.track.export;

import com.example.gnsssatdemo.track.model.TrackPoint;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;

import org.json.JSONException;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class DiagnosticTrackPointReader {
    public List<TrackPoint> readTrackPoints(File evidenceJsonl) throws IOException, JSONException {
        return readTrackPoints(evidenceJsonl, false);
    }

    public List<TrackPoint> readDisplayTrackPoints(File evidenceJsonl)
            throws IOException, JSONException {
        return readTrackPoints(evidenceJsonl, true);
    }

    public AscentInputs readAscentInputs(File evidenceJsonl)
            throws IOException, JSONException {
        return readAscentInputs(evidenceJsonl, false);
    }

    public AscentInputs readDisplayAscentInputs(File evidenceJsonl)
            throws IOException, JSONException {
        return readAscentInputs(evidenceJsonl, true);
    }

    private List<TrackPoint> readTrackPoints(File evidenceJsonl, boolean display)
            throws IOException, JSONException {
        return readAscentInputs(evidenceJsonl, display).trackPoints;
    }

    private AscentInputs readAscentInputs(File evidenceJsonl, boolean display)
            throws IOException, JSONException {
        EvidenceTrackProductBuilder.Result result =
                new EvidenceTrackProductBuilder().build(evidenceJsonl);
        return new AscentInputs(display ? result.displayTrackPoints : result.trackPoints,
                result.barometerSamples);
    }

    public static class AscentInputs {
        public final List<TrackPoint> trackPoints;
        public final List<TrackAscentCalculator.BarometerSample> barometerSamples;

        public AscentInputs(List<TrackPoint> trackPoints,
                            List<TrackAscentCalculator.BarometerSample> barometerSamples) {
            this.trackPoints = trackPoints;
            this.barometerSamples = barometerSamples;
        }
    }
}
