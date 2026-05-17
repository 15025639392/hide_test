package com.example.gnsssatdemo.track.export;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class SessionScanner {
    private final SessionFileStore fileStore;
    private final SessionManifestReader manifestReader;

    public SessionScanner(SessionFileStore fileStore) {
        this.fileStore = fileStore;
        this.manifestReader = new SessionManifestReader(fileStore);
    }

    public SessionScanResult scan() throws IOException {
        List<SessionManifest> manifests = new ArrayList<>();
        int cleanedTmpFileCount = 0;
        for (File sessionDir : fileStore.listSessionDirsNewestFirst()) {
            cleanedTmpFileCount += fileStore.cleanupKnownTmpFiles(sessionDir);
            manifests.add(manifestReader.read(sessionDir));
        }
        return new SessionScanResult(manifests, cleanedTmpFileCount);
    }
}
