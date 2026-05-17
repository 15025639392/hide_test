package com.example.gnsssatdemo.track.export;

public class DiagnosticLogSummary {
    public static final String STATUS_MISSING = "MISSING";
    public static final String STATUS_OK = "OK";
    public static final String STATUS_INVALID_JSONL = "INVALID_JSONL";
    public static final String STATUS_READ_ERROR = "READ_ERROR";

    public final String readStatus;
    public final long lastCompleteEventSeq;
    public final int completeEventCount;

    public DiagnosticLogSummary(String readStatus, long lastCompleteEventSeq,
                                int completeEventCount) {
        this.readStatus = readStatus;
        this.lastCompleteEventSeq = lastCompleteEventSeq;
        this.completeEventCount = completeEventCount;
    }
}
