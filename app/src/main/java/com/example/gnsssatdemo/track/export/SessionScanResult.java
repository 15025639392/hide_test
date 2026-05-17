package com.example.gnsssatdemo.track.export;

import java.util.List;

public class SessionScanResult {
    public final List<SessionManifest> manifests;
    public final int cleanedTmpFileCount;

    public SessionScanResult(List<SessionManifest> manifests, int cleanedTmpFileCount) {
        this.manifests = manifests;
        this.cleanedTmpFileCount = cleanedTmpFileCount;
    }
}
