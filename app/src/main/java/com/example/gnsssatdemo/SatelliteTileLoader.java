package com.example.gnsssatdemo;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.LruCache;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

class SatelliteTileLoader {
    private static final int MEMORY_CACHE_KB = 128 * 1024;
    private static final long FAILED_TILE_RETRY_DELAY_MILLIS = 30_000L;
    private static final String SATELLITE_TILE_URL =
            "https://webst%02d.is.autonavi.com/appmaptile?style=6&x=%d&y=%d&z=%d";

    private final LruCache<String, Bitmap> memoryCache =
            new LruCache<String, Bitmap>(MEMORY_CACHE_KB) {
                @Override
                protected int sizeOf(String key, Bitmap value) {
                    return Math.max(1, value.getByteCount() / 1024);
                }
            };
    private final Set<String> loadingKeys = new HashSet<>();
    private final Map<String, Long> retryAfterMillisByKey = new HashMap<>();
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final File diskCacheDir;
    private final Runnable invalidateCallback;

    SatelliteTileLoader(Context context, Runnable invalidateCallback) {
        this.diskCacheDir = new File(context.getFilesDir(), "satellite_tile_cache");
        this.invalidateCallback = invalidateCallback;
    }

    Bitmap get(String key) {
        return memoryCache.get(key);
    }

    void clearFailures() {
        synchronized (retryAfterMillisByKey) {
            retryAfterMillisByKey.clear();
        }
    }

    void requestVisibleTiles(List<SatelliteTileRequest> requests, int maxPerDraw, int maxActive) {
        if (requests.isEmpty()) {
            return;
        }
        int activeCount;
        synchronized (loadingKeys) {
            activeCount = loadingKeys.size();
        }
        int remainingCapacity = maxActive - activeCount;
        if (remainingCapacity <= 0) {
            return;
        }
        int count = Math.min(Math.min(maxPerDraw, remainingCapacity), requests.size());
        for (int i = 0; i < count; i++) {
            SatelliteTileRequest request = requests.get(i);
            requestTile(request.zoom, request.tileX, request.tileY, request.key);
        }
    }

    void shutdownNow() {
        executor.shutdownNow();
    }

    private void requestTile(int zoom, int tileX, int tileY, String key) {
        long now = SystemClock.elapsedRealtime();
        synchronized (retryAfterMillisByKey) {
            Long retryAfter = retryAfterMillisByKey.get(key);
            if (retryAfter != null && retryAfter > now) {
                return;
            }
            if (retryAfter != null) {
                retryAfterMillisByKey.remove(key);
            }
        }
        synchronized (loadingKeys) {
            if (loadingKeys.contains(key)) {
                return;
            }
            loadingKeys.add(key);
        }
        try {
            executor.execute(() -> loadTile(zoom, tileX, tileY, key));
        } catch (RejectedExecutionException ignored) {
            synchronized (loadingKeys) {
                loadingKeys.remove(key);
            }
        }
    }

    private void loadTile(int zoom, int tileX, int tileY, String key) {
        Bitmap bitmap = null;
        try {
            bitmap = readFromDisk(key);
            if (bitmap == null) {
                bitmap = downloadTile(zoom, tileX, tileY);
                if (bitmap != null) {
                    writeToDisk(key, bitmap);
                }
            }
        } finally {
            synchronized (loadingKeys) {
                loadingKeys.remove(key);
            }
        }
        if (bitmap != null) {
            synchronized (retryAfterMillisByKey) {
                retryAfterMillisByKey.remove(key);
            }
            memoryCache.put(key, bitmap);
            invalidateCallback.run();
        } else {
            synchronized (retryAfterMillisByKey) {
                retryAfterMillisByKey.put(key,
                        SystemClock.elapsedRealtime() + FAILED_TILE_RETRY_DELAY_MILLIS);
            }
        }
    }

    private Bitmap readFromDisk(String key) {
        File tileFile = tileFile(key);
        if (!tileFile.isFile()) {
            return null;
        }
        Bitmap bitmap = BitmapFactory.decodeFile(tileFile.getAbsolutePath());
        if (bitmap == null) {
            // Drop corrupted partial files so a later online attempt can repair the cache.
            //noinspection ResultOfMethodCallIgnored
            tileFile.delete();
        }
        return bitmap;
    }

    private void writeToDisk(String key, Bitmap bitmap) {
        File tileFile = tileFile(key);
        File parent = tileFile.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            return;
        }
        File tempFile = new File(parent, tileFile.getName() + "."
                + SystemClock.elapsedRealtimeNanos() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(tempFile)) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                //noinspection ResultOfMethodCallIgnored
                tempFile.delete();
                return;
            }
        } catch (IOException ignored) {
            //noinspection ResultOfMethodCallIgnored
            tempFile.delete();
            return;
        }
        if (!tempFile.renameTo(tileFile)) {
            //noinspection ResultOfMethodCallIgnored
            tempFile.delete();
        }
    }

    private File tileFile(String key) {
        return new File(diskCacheDir, key + ".png");
    }

    private Bitmap downloadTile(int zoom, int tileX, int tileY) {
        HttpURLConnection connection = null;
        try {
            int server = Math.abs(tileX + tileY) % 4 + 1;
            URL url = new URL(String.format(Locale.US, SATELLITE_TILE_URL,
                    server, tileX, tileY, zoom));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent",
                    "Mozilla/5.0 Android GNSS Satellite Demo");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                return null;
            }
            return BitmapFactory.decodeStream(connection.getInputStream());
        } catch (IOException ignored) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}
