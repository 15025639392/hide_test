package com.example.gnsssatdemo;

import com.example.gnsssatdemo.track.export.SessionManifest;

import java.util.ArrayList;
import java.util.List;

class HistorySessionState {
    final List<SessionManifest> manifests;
    final SessionManifest latestManifest;
    final String selectedSessionId;
    final int cleanedTmpFileCount;
    final String error;

    HistorySessionState(List<SessionManifest> manifests, SessionManifest latestManifest,
                        String selectedSessionId, int cleanedTmpFileCount, String error) {
        this.manifests = new ArrayList<>(manifests);
        this.latestManifest = latestManifest;
        this.selectedSessionId = selectedSessionId;
        this.cleanedTmpFileCount = cleanedTmpFileCount;
        this.error = error;
    }

    int sessionCount() {
        return manifests.size();
    }
}
