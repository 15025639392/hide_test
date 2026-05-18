package com.example.gnsssatdemo;

import android.content.Context;

import com.example.gnsssatdemo.track.export.SessionFileStore;
import com.example.gnsssatdemo.track.export.SessionManifest;
import com.example.gnsssatdemo.track.export.SessionScanResult;
import com.example.gnsssatdemo.track.export.SessionScanner;

import java.io.IOException;
import java.util.ArrayList;

class HistorySessionController {
    private final SessionFileStore fileStore;

    HistorySessionController(Context context) {
        this(new SessionFileStore(context));
    }

    HistorySessionController(SessionFileStore fileStore) {
        this.fileStore = fileStore;
    }

    HistorySessionState scan(String selectedSessionId) {
        try {
            SessionScanResult result = new SessionScanner(fileStore).scan();
            return stateFromScanResult(result, selectedSessionId);
        } catch (IOException e) {
            return new HistorySessionState(new ArrayList<>(), null, "",
                    0, e.getMessage());
        }
    }

    private HistorySessionState stateFromScanResult(SessionScanResult result,
                                                   String selectedSessionId) {
        SessionManifest latest = null;
        String selected = selectedSessionId == null ? "" : selectedSessionId;
        if (!selected.isEmpty()) {
            for (SessionManifest manifest : result.manifests) {
                if (selected.equals(manifest.sessionId)) {
                    latest = manifest;
                    return new HistorySessionState(result.manifests, latest, selected,
                            result.cleanedTmpFileCount, "");
                }
            }
        }
        if (result.manifests.isEmpty()) {
            selected = "";
        } else {
            latest = result.manifests.get(0);
            selected = latest.sessionId;
        }
        return new HistorySessionState(result.manifests, latest, selected,
                result.cleanedTmpFileCount, "");
    }
}
