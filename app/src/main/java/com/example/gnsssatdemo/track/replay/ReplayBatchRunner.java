package com.example.gnsssatdemo.track.replay;

import org.json.JSONException;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

public class ReplayBatchRunner {
    private final ReplayRunner runner;
    private final ReplayReportWriter reportWriter;
    private final ReplayBatchReportWriter batchReportWriter;

    public ReplayBatchRunner() {
        this(new ReplayRunner(), new ReplayReportWriter(), new ReplayBatchReportWriter());
    }

    public ReplayBatchRunner(ReplayRunner runner, ReplayReportWriter reportWriter,
                             ReplayBatchReportWriter batchReportWriter) {
        this.runner = runner;
        this.reportWriter = reportWriter;
        this.batchReportWriter = batchReportWriter;
    }

    public ReplayBatchResult run(File inputDirectory, File outputDirectory)
            throws IOException, JSONException {
        File[] jsonlFiles = inputDirectory.listFiles((dir, name) -> name.endsWith(".jsonl"));
        if (jsonlFiles == null) {
            throw new IOException("replay input directory is not readable");
        }
        Arrays.sort(jsonlFiles, Comparator.comparing(File::getName));

        List<ReplayBatchItem> items = new ArrayList<>();
        for (File inputFile : jsonlFiles) {
            ReplayReport report;
            try (FileInputStream inputStream = new FileInputStream(inputFile)) {
                report = runner.run(inputStream);
            }
            File reportDir = new File(outputDirectory, stripJsonlSuffix(inputFile.getName()));
            File reportFile = reportWriter.write(reportDir, report);
            items.add(new ReplayBatchItem(inputFile, reportFile, report));
        }
        ReplayBatchResult result = new ReplayBatchResult(items);
        batchReportWriter.write(outputDirectory, result);
        return result;
    }

    private String stripJsonlSuffix(String name) {
        return name.endsWith(".jsonl") ? name.substring(0, name.length() - ".jsonl".length()) : name;
    }
}
