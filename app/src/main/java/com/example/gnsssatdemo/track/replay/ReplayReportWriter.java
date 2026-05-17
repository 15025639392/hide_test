package com.example.gnsssatdemo.track.replay;

import org.json.JSONException;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

public class ReplayReportWriter {
    public static final String REPORT_FILE_NAME = "replay_report.json";

    public File write(File directory, ReplayReport report) throws IOException, JSONException {
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("replay report directory create failed");
        }
        File reportFile = new File(directory, REPORT_FILE_NAME);
        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(reportFile), StandardCharsets.UTF_8))) {
            writer.write(report.toJson().toString(2));
            writer.write('\n');
        }
        return reportFile;
    }
}
