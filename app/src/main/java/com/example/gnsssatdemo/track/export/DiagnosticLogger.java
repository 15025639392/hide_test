package com.example.gnsssatdemo.track.export;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

public class DiagnosticLogger implements Closeable {
    private final BufferedWriter writer;
    private long nextEventSeq = 1L;

    public DiagnosticLogger(File file) throws IOException {
        this.writer = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(file, true), StandardCharsets.UTF_8));
    }

    public synchronized long append(JSONObject event, String sessionId, long eventElapsedRealtimeNanos)
            throws IOException, JSONException {
        long eventSeq = nextEventSeq++;
        event.put("sessionId", sessionId);
        event.put("eventSeq", eventSeq);
        event.put("schemaVersion", 1);
        event.put("eventElapsedRealtimeNanos", eventElapsedRealtimeNanos);
        event.put("writtenWallTimeMillis", System.currentTimeMillis());
        writer.write(event.toString());
        writer.write('\n');
        writer.flush();
        return eventSeq;
    }

    @Override
    public synchronized void close() throws IOException {
        writer.close();
    }
}
