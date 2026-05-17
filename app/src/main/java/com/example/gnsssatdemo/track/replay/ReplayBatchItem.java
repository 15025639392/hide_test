package com.example.gnsssatdemo.track.replay;

import java.io.File;

public class ReplayBatchItem {
    public final File inputFile;
    public final File reportFile;
    public final ReplayReport report;

    public ReplayBatchItem(File inputFile, File reportFile, ReplayReport report) {
        this.inputFile = inputFile;
        this.reportFile = reportFile;
        this.report = report;
    }
}
