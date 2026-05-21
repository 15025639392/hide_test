package com.example.gnsssatdemo;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.location.GnssClock;
import android.location.GnssMeasurement;
import android.location.GnssMeasurementsEvent;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.OverScroller;
import android.widget.ScrollView;
import android.widget.TextView;

import com.example.gnsssatdemo.track.engine.BasicTrackSession;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.export.DiagnosticLogSummary;
import com.example.gnsssatdemo.track.export.DiagnosticTrackPointReader;
import com.example.gnsssatdemo.track.export.GpxReferenceParser;
import com.example.gnsssatdemo.track.export.GpxExporter;
import com.example.gnsssatdemo.track.export.HikingSampleReport;
import com.example.gnsssatdemo.track.export.HikingSampleReportGenerator;
import com.example.gnsssatdemo.track.export.SessionFileStore;
import com.example.gnsssatdemo.track.export.SessionManifest;
import com.example.gnsssatdemo.track.export.SessionManifestReader;
import com.example.gnsssatdemo.track.export.WeakGnssReport;
import com.example.gnsssatdemo.track.export.WeakGnssReportGenerator;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.ReferenceTrackPoint;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.json.JSONException;
import org.xml.sax.SAXException;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

import javax.xml.parsers.ParserConfigurationException;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 1001;
    private static final int REQ_NOTIFICATIONS = 1004;
    private static final int REQ_IMPORT_REFERENCE_GPX = 1005;
    private static final long NO_LOCATION_TIMEOUT_MILLIS = 30_000L;
    private static final float MIN_HEADING_RENDER_DELTA_DEGREES = 3f;
    private static final long HEADING_STALE_RENDER_DELAY_MILLIS = 550L;
    private static final double DEFAULT_MAP_CENTER_LATITUDE = 29.53903137d;
    private static final double DEFAULT_MAP_CENTER_LONGITUDE = 106.49655175d;
    private static final long UI_RENDER_MIN_INTERVAL_MILLIS = 250L;
    private static final long SATELLITE_TILE_INVALIDATE_COALESCE_MILLIS = 250L;
    private static final long TRACK_TIME_MARKER_INTERVAL_NANOS = 10L * 60L * 1_000_000_000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final DecimalFormat one = new DecimalFormat("0.0");
    private final DecimalFormat three = new DecimalFormat("0.000");
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm:ss", Locale.US);
    private final SimpleDateFormat dateTimeFormat = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.CHINA);
    private final GnssQualitySnapshotFactory gnssQualitySnapshotFactory =
            new GnssQualitySnapshotFactory();
    private boolean satelliteMapInvalidateScheduled;

    private LocationManager locationManager;
    private SensorManager sensorManager;
    private Sensor rotationVectorSensor;
    private Sensor magneticFieldSensor;
    private Sensor gyroscopeSensor;
    private Sensor pressureSensor;
    private RecordingServiceController recordingServiceController;
    private HistorySessionController historySessionController;
    private SatelliteTileLoader satelliteTileLoader;
    private final RecordingStatusMapper recordingStatusMapper = new RecordingStatusMapper();
    private TextView status;
    private LinearLayout noticeCard;
    private TextView noticeText;
    private Button recordButton;
    private Button importReferenceButton;
    private Button locateButton;
    private LinearLayout controlsOverlay;
    private View recordOverlay;
    private LinearLayout historyActionsContainer;
    private NativeTrackMapView mapView;
    private Dialog historyDialog;

    private Location lastLocation;
    private GnssStatus lastGnssStatus;
    private GnssMeasurementsEvent lastMeasurements;
    private boolean listening;
    private BasicTrackSession trackSession;
    private long lastLocationReceivedElapsedRealtimeMillis;
    private boolean noLocationTimeoutLogged;
    private boolean foregroundServiceRecording;
    private String foregroundServiceSessionId = "";
    private String foregroundServiceStatusText = "";
    private long foregroundServiceRawPointCount;
    private int foregroundServiceTrackPointCount;
    private double foregroundServiceTotalDistanceMeters;
    private double foregroundServiceTotalAscentMeters = -1.0;
    private double foregroundServiceBarometerTotalAscentMeters = -1.0;
    private double foregroundServiceGnssTotalAscentMeters = -1.0;
    private int foregroundServiceBarometerAscentSampleCount;
    private int foregroundServiceGnssAscentSampleCount;
    private int foregroundServiceBarometerAscentRejectedSampleCount;
    private int foregroundServiceGnssAscentRejectedSampleCount;
    private String foregroundServiceAscentSource = "NONE";
    private boolean foregroundServicePressureSensorAvailable;
    private long foregroundServicePressureSampleCount;
    private boolean foregroundServiceBarometerCalibrated;
    private double foregroundServiceBarometerAltitudeMeters = Double.NaN;
    private double foregroundServiceRawBarometerAltitudeMeters = Double.NaN;
    private boolean foregroundServiceHasLocation;
    private double foregroundServiceLatitude;
    private double foregroundServiceLongitude;
    private float foregroundServiceAccuracyMeters = -1f;
    private boolean foregroundServiceHasSpeed;
    private float foregroundServiceSpeedMetersPerSecond = -1f;
    private boolean foregroundServiceHasBearing;
    private float foregroundServiceBearingDegrees = -1f;
    private final List<TrackPoint> foregroundServiceTrackPoints = new ArrayList<>();
    private final List<TrackPoint> foregroundServiceLiveRawPoints = new ArrayList<>();
    private SessionManifest latestManifest;
    private final List<SessionManifest> recentManifests = new ArrayList<>();
    private String selectedHistoricalSessionId = "";
    private int lastScanSessionCount;
    private int lastScanCleanedTmpFileCount;
    private String lastScanError = "";
    private float headingDegrees = Float.NaN;
    private String headingUnreliableReason = "sensor_unavailable";
    private boolean pressureSensorAvailable;
    private long pressureSampleCount;
    private float currentPressureHpa = Float.NaN;
    private double currentRawBarometerAltitudeMeters = Double.NaN;
    private final CompassHeadingReliability headingReliability =
            new CompassHeadingReliability();
    private final Runnable headingStaleRunnable = new Runnable() {
        @Override
        public void run() {
            if (updateHeadingReliability(SystemClock.elapsedRealtimeNanos())) {
                render();
            }
        }
    };
    private final List<ReferenceTrackPoint> referenceTrackPoints = new ArrayList<>();
    private String referenceTrackName = "";
    private boolean renderScheduled;
    private long lastRenderElapsedRealtimeMillis;
    private String cachedHistoricalMapSessionId = "";
    private long cachedHistoricalMapLastEventSeq = -1L;
    private long cachedHistoricalMapDiagnosticBytes = -1L;
    private final List<TrackPoint> cachedHistoricalMapPoints = new ArrayList<>();
    private final List<TrackAscentCalculator.BarometerSample> cachedHistoricalBarometerSamples =
            new ArrayList<>();
    private final Map<String, TrackAscentCalculator.Result> cachedHistoricalAscentResults =
            new HashMap<>();
    private final Set<String> pendingHistoricalAscentCacheKeys = new HashSet<>();
    private final Set<String> failedHistoricalAscentCacheKeys = new HashSet<>();
    private final ExecutorService historicalAscentExecutor = Executors.newSingleThreadExecutor();
    private long historicalAscentCacheGeneration;
    private boolean historicalAscentRefreshScheduled;
    private boolean historicalAscentDestroyed;
    private boolean controlsVisible = true;

    private final SensorEventListener headingListener = new SensorEventListener() {
        private final float[] rotationMatrix = new float[9];
        private final float[] orientation = new float[3];

        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
                headingReliability.recordMagneticField(event.values[0], event.values[1],
                        event.values[2]);
                if (updateHeadingReliability(SystemClock.elapsedRealtimeNanos())) {
                    render();
                }
                return;
            }
            if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE) {
                headingReliability.recordGyroscope(event.values[0], event.values[1],
                        event.values[2], event.timestamp);
                if (updateHeadingReliability(SystemClock.elapsedRealtimeNanos())) {
                    render();
                }
                return;
            }
            if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) {
                return;
            }
            headingReliability.recordSensorAccuracy(event.accuracy);
            SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
            SensorManager.getOrientation(rotationMatrix, orientation);
            float nextHeading = (float) Math.toDegrees(orientation[0]);
            if (nextHeading < 0f) {
                nextHeading += 360f;
            }
            headingReliability.recordHeading(nextHeading, event.timestamp);
            scheduleHeadingStaleCheck();
            boolean reliableChanged = updateHeadingReliability(
                    SystemClock.elapsedRealtimeNanos());
            if (Float.isNaN(headingDegrees)
                    || headingDeltaDegrees(headingDegrees, nextHeading)
                    >= MIN_HEADING_RENDER_DELTA_DEGREES
                    || reliableChanged) {
                headingDegrees = nextHeading;
                render();
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            if (sensor != null && sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
                headingReliability.recordSensorAccuracy(accuracy);
                if (updateHeadingReliability(SystemClock.elapsedRealtimeNanos())) {
                    render();
                }
            }
        }
    };

    private final SensorEventListener pressureListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event == null || event.values == null || event.values.length == 0
                    || event.values[0] <= 0f) {
                return;
            }
            currentPressureHpa = event.values[0];
            currentRawBarometerAltitudeMeters = SensorManager.getAltitude(
                    SensorManager.PRESSURE_STANDARD_ATMOSPHERE, currentPressureHpa);
            pressureSampleCount++;
            render();
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            // Pressure accuracy is not used for the always-visible HUD summary.
        }
    };

    private final Runnable noLocationTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (trackSession == null || !trackSession.isActive() || noLocationTimeoutLogged) {
                return;
            }
            long now = SystemClock.elapsedRealtime();
            long elapsed = lastLocationReceivedElapsedRealtimeMillis > 0L
                    ? now - lastLocationReceivedElapsedRealtimeMillis
                    : now;
            if (elapsed >= NO_LOCATION_TIMEOUT_MILLIS) {
                noLocationTimeoutLogged = true;
                trackSession.onNoLocationTimeout(elapsed);
                setStatus("超过 " + (elapsed / 1000) + " 秒没有收到 GPS Location 回调");
                render();
            } else {
                scheduleNoLocationTimeout();
            }
        }
    };

    private final Runnable renderRunnable = new Runnable() {
        @Override
        public void run() {
            renderScheduled = false;
            renderNow();
        }
    };

    private final LocationListener locationListener = location -> {
        lastLocation = location;
        lastLocationReceivedElapsedRealtimeMillis = SystemClock.elapsedRealtime();
        noLocationTimeoutLogged = false;
        appendTrackPointIfRecording(location);
        scheduleNoLocationTimeout();
        render();
    };

    private final GnssStatus.Callback gnssStatusCallback = new GnssStatus.Callback() {
        @Override
        public void onStarted() {
            setStatus("GNSS 已启动");
        }

        @Override
        public void onStopped() {
            setStatus("GNSS 已停止");
        }

        @Override
        public void onFirstFix(int ttffMillis) {
            setStatus("首次定位耗时: " + ttffMillis + " ms");
        }

        @Override
        public void onSatelliteStatusChanged(GnssStatus gnssStatus) {
            lastGnssStatus = gnssStatus;
            appendGnssSnapshotIfRecording(gnssStatus);
            render();
        }
    };

    private final GnssMeasurementsEvent.Callback measurementsCallback =
            new GnssMeasurementsEvent.Callback() {
                @Override
                public void onGnssMeasurementsReceived(GnssMeasurementsEvent eventArgs) {
                    lastMeasurements = eventArgs;
                    render();
                }

                @Override
                public void onStatusChanged(int status) {
                    setStatus("原始测量状态: " + measurementStatusName(status));
                }
            };

    private final BroadcastReceiver foregroundServiceStatusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!recordingStatusMapper.isStatusIntent(intent)) {
                return;
            }
            RecordingServiceStatus serviceStatus = recordingStatusMapper.fromIntent(intent);
            foregroundServiceRecording = serviceStatus.active;
            foregroundServiceSessionId = serviceStatus.sessionId;
            foregroundServiceRawPointCount = serviceStatus.rawPointCount;
            foregroundServiceTrackPointCount = serviceStatus.trackPointCount;
            foregroundServiceTotalDistanceMeters = serviceStatus.totalDistanceMeters;
            foregroundServiceTotalAscentMeters = serviceStatus.totalAscentMeters;
            foregroundServiceBarometerTotalAscentMeters =
                    serviceStatus.barometerTotalAscentMeters;
            foregroundServiceGnssTotalAscentMeters = serviceStatus.gnssTotalAscentMeters;
            foregroundServiceBarometerAscentSampleCount =
                    serviceStatus.barometerAscentSampleCount;
            foregroundServiceGnssAscentSampleCount = serviceStatus.gnssAscentSampleCount;
            foregroundServiceBarometerAscentRejectedSampleCount =
                    serviceStatus.barometerAscentRejectedSampleCount;
            foregroundServiceGnssAscentRejectedSampleCount =
                    serviceStatus.gnssAscentRejectedSampleCount;
            foregroundServiceAscentSource = serviceStatus.ascentSource;
            foregroundServicePressureSensorAvailable = serviceStatus.pressureSensorAvailable;
            foregroundServicePressureSampleCount = serviceStatus.pressureSampleCount;
            foregroundServiceBarometerCalibrated = serviceStatus.barometerCalibrated;
            foregroundServiceBarometerAltitudeMeters = serviceStatus.barometerAltitudeMeters;
            foregroundServiceRawBarometerAltitudeMeters =
                    serviceStatus.rawBarometerAltitudeMeters;
            foregroundServiceStatusText = serviceStatus.statusText;
            foregroundServiceHasLocation = serviceStatus.hasLocation;
            if (foregroundServiceHasLocation) {
                foregroundServiceLatitude = serviceStatus.latitude;
                foregroundServiceLongitude = serviceStatus.longitude;
                foregroundServiceAccuracyMeters = serviceStatus.accuracyMeters;
                foregroundServiceHasSpeed = serviceStatus.hasSpeed;
                foregroundServiceSpeedMetersPerSecond = serviceStatus.speedMetersPerSecond;
                foregroundServiceHasBearing = serviceStatus.hasBearing;
                foregroundServiceBearingDegrees = serviceStatus.bearingDegrees;
                appendForegroundServiceLiveRawPoint();
            } else {
                foregroundServiceAccuracyMeters = -1f;
                foregroundServiceHasSpeed = false;
                foregroundServiceSpeedMetersPerSecond = -1f;
                foregroundServiceHasBearing = false;
                foregroundServiceBearingDegrees = -1f;
            }
            updateForegroundServiceTrackPoints(serviceStatus.trackPolyline);
            updateRecordButtonState();
            if (!foregroundServiceRecording) {
                scanExistingSessions();
                foregroundServiceTrackPoints.clear();
                foregroundServiceLiveRawPoints.clear();
            }
            render();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        recordingServiceController = new RecordingServiceController(this);
        historySessionController = new HistorySessionController(this);
        satelliteTileLoader = new SatelliteTileLoader(this,
                () -> mainHandler.post(this::scheduleSatelliteMapViewsInvalidate));
        if (sensorManager != null) {
            rotationVectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            magneticFieldSensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
            gyroscopeSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            pressureSensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE);
            pressureSensorAvailable = pressureSensor != null;
            headingReliability.setSensorAvailability(magneticFieldSensor != null,
                    gyroscopeSensor != null);
        }
        trackSession = new BasicTrackSession(this);
        buildUi();
        registerForegroundServiceStatusReceiver();
        scanExistingSessions();

        if (hasFineLocation()) {
            startListening();
        } else {
            requestFineLocationPermission();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        startHeadingUpdates();
        startPressureUpdates();
        queryForegroundServiceStatus();
    }

    @Override
    protected void onPause() {
        stopPressureUpdates();
        stopHeadingUpdates();
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT_REFERENCE_GPX) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                importReferenceGpx(data.getData());
            } else {
                setStatus("已取消导入参考 GPX");
            }
        }
    }

    @Override
    protected void onDestroy() {
        historicalAscentDestroyed = true;
        invalidateHistoricalAscentCache();
        mainHandler.removeCallbacks(renderRunnable);
        stopPressureUpdates();
        stopHeadingUpdates();
        stopListening();
        if (trackSession != null) {
            trackSession.close();
        }
        recordingServiceController.unregisterStatusReceiver(foregroundServiceStatusReceiver);
        satelliteTileLoader.shutdownNow();
        historicalAscentExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION) {
            if (hasFineLocation()) {
                startListening();
            } else if (hasCoarseLocation()) {
                setStatus("只授予了大致位置，请在系统权限中打开“精确位置”。");
                showNotice("当前只有大致位置权限。请进入系统设置 > 应用 > GNSS Satellite Demo > 权限 > 位置信息，打开“精确位置”。");
            } else {
                setStatus("定位权限被拒绝");
                showNotice("请授予精确定位权限，否则 Android 不会输出 GNSS 卫星数据。");
            }
            return;
        }
        if (requestCode == REQ_NOTIFICATIONS && grantResults.length > 0
                && grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            setStatus("通知权限未授予；前台服务仍会尝试记录，但系统可能隐藏通知。");
        }
    }

    private void requestNotificationPermissionIfUseful() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    private void registerForegroundServiceStatusReceiver() {
        recordingServiceController.registerStatusReceiver(foregroundServiceStatusReceiver);
    }

    private void queryForegroundServiceStatus() {
        recordingServiceController.queryStatus();
    }

    private void updateForegroundServiceTrackPoints(String polyline) {
        foregroundServiceTrackPoints.clear();
        if (polyline == null || polyline.isEmpty()) {
            return;
        }
        String[] rows = polyline.split(";");
        long id = 1L;
        for (String row : rows) {
            String[] parts = row.split(",");
            if (parts.length < 5) {
                continue;
            }
            try {
                double lat = Double.parseDouble(parts[0]);
                double lng = Double.parseDouble(parts[1]);
                float accuracy = Float.parseFloat(parts[2]);
                float bearing = Float.parseFloat(parts[3]);
                long timeMillis = Long.parseLong(parts[4]);
                long elapsedRealtimeNanos = parts.length >= 6 ? Long.parseLong(parts[5]) : 0L;
                String decisionResult = parts.length >= 7 ? parts[6] : "accept";
                double altitude = parts.length >= 8 ? Double.parseDouble(parts[7]) : Double.NaN;
                String decisionReason = parts.length >= 9 ? parts[8] : "foreground_live";
                float verticalAccuracy = parts.length >= 10
                        ? Float.parseFloat(parts[9]) : Float.NaN;
                long pressureElapsedRealtimeNanos = parts.length >= 11
                        ? Long.parseLong(parts[10]) : 0L;
                double pressureHpa = parts.length >= 12
                        ? Double.parseDouble(parts[11]) : Double.NaN;
                double rawBarometerAltitude = parts.length >= 13
                        ? Double.parseDouble(parts[12]) : Double.NaN;
                boolean hasAltitude = !Double.isNaN(altitude);
                boolean hasVerticalAccuracy = !Float.isNaN(verticalAccuracy);
                boolean hasPressureSample = pressureElapsedRealtimeNanos > 0L
                        && !Double.isNaN(pressureHpa)
                        && !Double.isNaN(rawBarometerAltitude);
                foregroundServiceTrackPoints.add(new TrackPoint(id, id, id, 1L,
                        lat, lng, hasAltitude, hasAltitude ? altitude : 0.0,
                        hasVerticalAccuracy, hasVerticalAccuracy ? verticalAccuracy : 0f,
                        accuracy,
                        false, 0f, bearing >= 0f, bearing,
                        timeMillis, elapsedRealtimeNanos, decisionResult, decisionReason,
                        0.0, 0.0, null,
                        hasPressureSample, pressureElapsedRealtimeNanos,
                        hasPressureSample ? pressureHpa : 0.0,
                        hasPressureSample ? rawBarometerAltitude : 0.0));
                id++;
            } catch (NumberFormatException ignored) {
                // Ignore one malformed live point without dropping the whole update.
            }
        }
    }

    private void appendForegroundServiceLiveRawPoint() {
        if (!foregroundServiceHasLocation) {
            return;
        }
        if (!foregroundServiceLiveRawPoints.isEmpty()) {
            TrackPoint last = foregroundServiceLiveRawPoints.get(
                    foregroundServiceLiveRawPoints.size() - 1);
            if (Math.abs(last.latitude - foregroundServiceLatitude) < 0.0000001
                    && Math.abs(last.longitude - foregroundServiceLongitude) < 0.0000001) {
                return;
            }
        }
        long id = foregroundServiceLiveRawPoints.size() + 1L;
        foregroundServiceLiveRawPoints.add(new TrackPoint(id, id, id, 1L,
                foregroundServiceLatitude, foregroundServiceLongitude,
                false, 0.0, foregroundServiceAccuracyMeters,
                foregroundServiceHasSpeed, foregroundServiceSpeedMetersPerSecond,
                foregroundServiceHasBearing, foregroundServiceBearingDegrees,
                System.currentTimeMillis(), 0L, "raw_live", "foreground_live_raw",
                0.0, 0.0, null));
        while (foregroundServiceLiveRawPoints.size() > 1000) {
            foregroundServiceLiveRawPoints.remove(0);
        }
    }

    private void startHeadingUpdates() {
        if (sensorManager == null || rotationVectorSensor == null) {
            return;
        }
        sensorManager.registerListener(headingListener, rotationVectorSensor,
                SensorManager.SENSOR_DELAY_UI, mainHandler);
        if (magneticFieldSensor != null) {
            sensorManager.registerListener(headingListener, magneticFieldSensor,
                    SensorManager.SENSOR_DELAY_UI, mainHandler);
        }
        if (gyroscopeSensor != null) {
            sensorManager.registerListener(headingListener, gyroscopeSensor,
                    SensorManager.SENSOR_DELAY_UI, mainHandler);
        }
    }

    private void stopHeadingUpdates() {
        mainHandler.removeCallbacks(headingStaleRunnable);
        if (sensorManager != null) {
            sensorManager.unregisterListener(headingListener);
        }
    }

    private void startPressureUpdates() {
        if (sensorManager == null || pressureSensor == null) {
            return;
        }
        sensorManager.registerListener(pressureListener, pressureSensor,
                SensorManager.SENSOR_DELAY_NORMAL, mainHandler);
    }

    private void stopPressureUpdates() {
        if (sensorManager != null) {
            sensorManager.unregisterListener(pressureListener);
        }
    }

    private void scheduleHeadingStaleCheck() {
        mainHandler.removeCallbacks(headingStaleRunnable);
        mainHandler.postDelayed(headingStaleRunnable, HEADING_STALE_RENDER_DELAY_MILLIS);
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 24, 33));

        mapView = createNativeMapView(true);
        mapView.setOnMapTapListener(this::toggleControlsVisibility);
        root.addView(mapView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        status = new TextView(this);
        status.setText("等待定位权限...");
        status.setVisibility(View.GONE);
        root.addView(status, new FrameLayout.LayoutParams(1, 1));

        controlsOverlay = new LinearLayout(this);
        controlsOverlay.setOrientation(LinearLayout.HORIZONTAL);
        controlsOverlay.setGravity(Gravity.CENTER_VERTICAL);
        controlsOverlay.setPadding(dp(5), dp(5), dp(5), dp(5));
        controlsOverlay.setBackground(roundedRect(Color.argb(165, 15, 23, 42), 20));

        importReferenceButton = new Button(this);
        importReferenceButton.setText("导入GPX");
        importReferenceButton.setContentDescription("导入 GPX");
        styleFloatingSecondaryButton(importReferenceButton);
        importReferenceButton.setOnClickListener(v -> requestReferenceGpxDocument());
        LinearLayout.LayoutParams importParams = new LinearLayout.LayoutParams(dp(76), dp(38));
        controlsOverlay.addView(importReferenceButton, importParams);

        Button historyButton = new Button(this);
        historyButton.setText("历史");
        historyButton.setContentDescription("历史记录");
        styleFloatingSecondaryButton(historyButton);
        historyButton.setOnClickListener(v -> showHistoryPage());
        LinearLayout.LayoutParams historyParams = new LinearLayout.LayoutParams(dp(52), dp(38));
        historyParams.setMargins(dp(6), 0, 0, 0);
        controlsOverlay.addView(historyButton, historyParams);
        updateRecordButtonState();

        FrameLayout.LayoutParams controlsParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.END);
        controlsParams.setMargins(dp(12), pageTopPadding(), dp(12), 0);
        root.addView(controlsOverlay, controlsParams);

        locateButton = new Button(this);
        locateButton.setText("定位");
        locateButton.setContentDescription("定位到当前位置");
        styleFloatingSecondaryButton(locateButton);
        locateButton.setOnClickListener(v -> centerMapOnCurrentLocation());
        FrameLayout.LayoutParams locateParams = new FrameLayout.LayoutParams(
                dp(58),
                dp(42),
                Gravity.BOTTOM | Gravity.END);
        locateParams.setMargins(0, 0, dp(14), pageBottomPadding() + dp(104));
        root.addView(locateButton, locateParams);

        recordButton = new Button(this);
        recordButton.setOnClickListener(v -> toggleTrackRecording());
        updateRecordButtonState();
        recordOverlay = recordButton;
        FrameLayout.LayoutParams recordOverlayParams = new FrameLayout.LayoutParams(
                dp(260),
                dp(46),
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        recordOverlayParams.setMargins(0, 0, 0, pageBottomPadding() + dp(44));
        root.addView(recordOverlay, recordOverlayParams);

        /* ---------- Permission notice ---------- */
        noticeCard = new LinearLayout(this);
        noticeCard.setOrientation(LinearLayout.VERTICAL);
        noticeCard.setPadding(dp(12), dp(10), dp(12), dp(10));
        styleCard(noticeCard, Color.rgb(254, 252, 232), 8, 1, Color.rgb(253, 224, 71));
        noticeText = new TextView(this);
        noticeText.setTextColor(Color.rgb(146, 64, 14));
        noticeText.setTextSize(13);
        noticeText.setLineSpacing(dp(3), 1.0f);
        noticeCard.addView(noticeText);
        noticeCard.setVisibility(View.GONE);
        FrameLayout.LayoutParams noticeParams = new FrameLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM);
        noticeParams.setMargins(dp(14), 0, dp(14), pageBottomPadding() + dp(98));
        root.addView(noticeCard, noticeParams);

        setContentView(root);
    }

    private NativeTrackMapView createNativeMapView(boolean interactive) {
        NativeTrackMapView view = new NativeTrackMapView(this);
        view.setInteractive(interactive);
        view.setBackgroundColor(Color.rgb(18, 24, 33));
        return view;
    }

    private void toggleControlsVisibility() {
        controlsVisible = !controlsVisible;
        if (controlsOverlay != null) {
            controlsOverlay.setVisibility(controlsVisible ? View.VISIBLE : View.GONE);
        }
        if (locateButton != null) {
            locateButton.setVisibility(controlsVisible ? View.VISIBLE : View.GONE);
        }
        if (recordOverlay != null) {
            recordOverlay.setVisibility(controlsVisible ? View.VISIBLE : View.GONE);
        }
    }

    private void centerMapOnCurrentLocation() {
        if (mapView == null || !mapView.centerOnCurrentLocation()) {
            setStatus("还没有可定位的当前位置");
        }
    }

    private void updateRecordButtonState() {
        if (recordButton == null) {
            return;
        }
        if (foregroundServiceRecording) {
            recordButton.setText("结束记录");
            recordButton.setContentDescription("结束记录");
            styleRecordActionDangerButton(recordButton);
        } else {
            recordButton.setText("开始记录");
            recordButton.setContentDescription("开始记录");
            styleRecordActionPrimaryButton(recordButton);
        }
    }

    private void showHistoryPage() {
        if (historyDialog != null && historyDialog.isShowing()) {
            return;
        }
        scanExistingSessions();
        Dialog dialog = new Dialog(this, android.R.style.Theme_Material_Light_NoActionBar);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(247, 249, 252));
        layout.setPadding(dp(16), pageTopPadding(), dp(16), dp(14));

        /* ---------- Header ---------- */
        TextView header = new TextView(this);
        header.setText("历史记录");
        header.setTextColor(Color.rgb(17, 24, 39));
        header.setTextSize(20);
        header.setIncludeFontPadding(false);
        layout.addView(header, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        /* ---------- Top actions ---------- */
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setPadding(0, dp(10), 0, 0);

        Button closeButton = new Button(this);
        closeButton.setText("返回");
        styleSecondaryButton(closeButton);
        closeButton.setOnClickListener(v -> dialog.dismiss());
        topBar.addView(closeButton, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        Button refreshButton = new Button(this);
        refreshButton.setText("刷新");
        styleSecondaryButton(refreshButton);
        refreshButton.setOnClickListener(v -> {
            scanExistingSessions();
            updateHistoryActionRows();
        });
        LinearLayout.LayoutParams refreshParams = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        refreshParams.setMargins(dp(10), 0, 0, 0);
        topBar.addView(refreshButton, refreshParams);

        layout.addView(topBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        /* ---------- List ---------- */
        historyActionsContainer = new LinearLayout(this);
        historyActionsContainer.setOrientation(LinearLayout.VERTICAL);
        historyActionsContainer.setPadding(0, dp(10), 0, 0);

        ScrollView scrollView = new ScrollView(this);
        scrollView.addView(historyActionsContainer);
        layout.addView(scrollView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f));

        dialog.setContentView(layout);
        dialog.setOnDismissListener(d -> {
            historyActionsContainer = null;
            historyDialog = null;
        });
        historyDialog = dialog;
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT);
        }
        updateHistoryActionRows();
    }

    private void startListening() {
        if (!hasFineLocation()) return;

        try {
            requestGpsLocationUpdates(1000L, 0f);

            locationManager.registerGnssStatusCallback(gnssStatusCallback, mainHandler);
            locationManager.registerGnssMeasurementsCallback(measurementsCallback, mainHandler);

            listening = true;
            setStatus("正在监听 GPS_PROVIDER，高精度请求已启用。请到户外或窗边等待卫星数据。");
            render();
        } catch (SecurityException e) {
            setStatus("缺少权限: " + e.getMessage());
        } catch (RuntimeException e) {
            setStatus("GNSS 不可用: " + e.getMessage());
        }
    }

    private void requestGpsLocationUpdates(long intervalMillis, float distanceMeters) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            LocationRequest request = new LocationRequest.Builder(intervalMillis)
                    .setMinUpdateIntervalMillis(intervalMillis)
                    .setMinUpdateDistanceMeters(distanceMeters)
                    .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                    .build();
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, request,
                    getMainExecutor(), locationListener);
            return;
        }
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMillis,
                distanceMeters, locationListener, Looper.getMainLooper());
    }

    private void stopListening() {
        if (!listening || locationManager == null) return;
        try {
            locationManager.removeUpdates(locationListener);
            locationManager.unregisterGnssStatusCallback(gnssStatusCallback);
            locationManager.unregisterGnssMeasurementsCallback(measurementsCallback);
        } catch (RuntimeException ignored) {
            // Some vendor builds throw if a callback was not fully registered.
        }
        listening = false;
    }

    private void render() {
        long now = SystemClock.elapsedRealtime();
        long elapsed = now - lastRenderElapsedRealtimeMillis;
        if (lastRenderElapsedRealtimeMillis == 0L
                || elapsed >= UI_RENDER_MIN_INTERVAL_MILLIS) {
            mainHandler.removeCallbacks(renderRunnable);
            renderScheduled = false;
            renderNow();
            return;
        }
        if (!renderScheduled) {
            renderScheduled = true;
            mainHandler.postDelayed(renderRunnable,
                    UI_RENDER_MIN_INTERVAL_MILLIS - elapsed);
        }
    }

    private void renderNow() {
        lastRenderElapsedRealtimeMillis = SystemClock.elapsedRealtime();
        updateNoticeCard();
        updateMapPreview();
    }

    private void updateNoticeCard() {
        if (noticeCard == null) return;
        if (hasFineLocation()) {
            noticeCard.setVisibility(View.GONE);
        }
    }

    private void showNotice(String text) {
        if (noticeText != null) {
            noticeText.setText(text);
            noticeCard.setVisibility(View.VISIBLE);
        }
    }

    private String sampleCountText(long rawPointCount, int trackPointCount) {
        return "原始 " + rawPointCount + "  轨迹 " + trackPointCount;
    }

    private String ascentSourceText(String source) {
        if ("BAROMETER".equals(source)) {
            return "BAROMETER";
        }
        if ("GNSS".equals(source)) {
            return "GNSS";
        }
        return "-";
    }

    private String foregroundBarometerText() {
        if (!foregroundServicePressureSensorAvailable) {
            return "无气压计";
        }
        StringBuilder text = new StringBuilder();
        if (foregroundServiceBarometerCalibrated) {
            text.append("海拔 ")
                    .append(formatAltitude(foregroundServiceBarometerAltitudeMeters))
                    .append("  已校准");
        } else if (!Double.isNaN(foregroundServiceRawBarometerAltitudeMeters)) {
            text.append("原始 ")
                    .append(formatAltitude(foregroundServiceRawBarometerAltitudeMeters))
                    .append("  未校准");
        } else {
            text.append("等待样本");
        }
        text.append("  样本 ").append(foregroundServicePressureSampleCount);
        return text.toString();
    }

    private String sessionBarometerText(BasicTrackSession session) {
        if (session == null || !session.isPressureSensorAvailable()) {
            return "无气压计";
        }
        StringBuilder text = new StringBuilder();
        double displayedAltitude = session.getLastDisplayedBarometerAltitudeMeters();
        double rawAltitude = session.getLastRawBarometerAltitudeMeters();
        if (session.isBarometerCalibrated() && !Double.isNaN(displayedAltitude)) {
            text.append("海拔 ")
                    .append(formatAltitude(displayedAltitude))
                    .append("  已校准");
        } else if (!Double.isNaN(rawAltitude)) {
            text.append("原始 ")
                    .append(formatAltitude(rawAltitude))
                    .append("  未校准");
        } else {
            text.append("等待样本");
        }
        text.append("  样本 ").append(session.getPressureSampleCount());
        return text.toString();
    }

    private String ascentOverviewText(double totalDistanceMeters,
                                      TrackAscentCalculator.Result ascentResult) {
        double totalAscentMeters = ascentResult == null ? -1.0
                : ascentResult.totalAscentMeters;
        String ascentSource = ascentResult == null ? "NONE" : ascentResult.source;
        return ascentOverviewText(totalDistanceMeters, totalAscentMeters, ascentSource);
    }

    private String ascentOverviewText(double totalDistanceMeters, double totalAscentMeters,
                                      String ascentSource) {
        return formatDistance(totalDistanceMeters)
                + "  爬升 " + formatAscent(totalAscentMeters)
                + "  来源 " + ascentSourceText(ascentSource);
    }

    private String ascentBreakdownText(TrackAscentCalculator.Result ascentResult) {
        if (ascentResult == null) {
            return ascentBreakdownText(-1.0, 0, 0, -1.0, 0, 0);
        }
        return ascentBreakdownText(ascentResult.barometerTotalAscentMeters,
                ascentResult.barometerSampleCount,
                ascentResult.barometerRejectedSampleCount,
                ascentResult.gnssTotalAscentMeters,
                ascentResult.gnssSampleCount,
                ascentResult.gnssRejectedSampleCount);
    }

    private String ascentBreakdownText(double barometerTotalAscentMeters,
                                       int barometerSampleCount,
                                       int barometerRejectedSampleCount,
                                       double gnssTotalAscentMeters,
                                       int gnssSampleCount,
                                       int gnssRejectedSampleCount) {
        return "BARO "
                + formatAscent(barometerTotalAscentMeters)
                + " (" + barometerSampleCount + "/"
                + barometerRejectedSampleCount + ")"
                + "  GNSS "
                + formatAscent(gnssTotalAscentMeters)
                + " (" + gnssSampleCount + "/"
                + gnssRejectedSampleCount + ")";
    }

    private String manifestAscentOverviewText(SessionManifest manifest,
                                              TrackAscentCalculator.Result fallbackResult) {
        if (hasManifestAscentSummary(manifest)) {
            return ascentOverviewText(manifest.totalDistanceMeters,
                    manifest.selectedTotalAscentMeters, manifest.selectedAscentSource);
        }
        return ascentOverviewText(manifest.totalDistanceMeters, fallbackResult);
    }

    private String manifestAscentBreakdownText(SessionManifest manifest,
                                               TrackAscentCalculator.Result fallbackResult) {
        if (hasManifestAscentSummary(manifest)) {
            return ascentBreakdownText(manifest.barometerTotalAscentMeters,
                    manifest.barometerAscentSampleCount,
                    manifest.barometerAscentRejectedSampleCount,
                    manifest.gnssTotalAscentMeters,
                    manifest.gnssAscentSampleCount,
                    manifest.gnssAscentRejectedSampleCount);
        }
        return ascentBreakdownText(fallbackResult);
    }

    private boolean hasManifestAscentSummary(SessionManifest manifest) {
        return manifest != null
                && (isValidAscentValue(manifest.selectedTotalAscentMeters)
                || isValidAscentValue(manifest.barometerTotalAscentMeters)
                || isValidAscentValue(manifest.gnssTotalAscentMeters)
                || manifest.barometerAscentSampleCount > 0
                || manifest.barometerAscentRejectedSampleCount > 0
                || manifest.gnssAscentSampleCount > 0
                || manifest.gnssAscentRejectedSampleCount > 0);
    }

    private boolean isValidAscentValue(double meters) {
        return meters >= 0.0 && !Double.isNaN(meters) && !Double.isInfinite(meters);
    }

    private void appendLocationBrief(StringBuilder sb) {
        appendInfoSectionTitle(sb, "定位");
        appendInfoRow(sb, "开关", isLocationEnabled() ? "已开启" : "未开启");
        appendInfoRow(sb, "朝向", headingText());
        if (lastLocation == null) {
            if (foregroundServiceRecording && foregroundServiceHasLocation) {
                appendInfoRow(sb, "位置", String.format(Locale.US, "%.6f, %.6f",
                        foregroundServiceLatitude, foregroundServiceLongitude));
                if (foregroundServiceAccuracyMeters >= 0f) {
                    appendInfoRow(sb, "精度", one.format(foregroundServiceAccuracyMeters) + " m");
                }
            } else {
                appendInfoRow(sb, "位置", "等待 GPS");
            }
            return;
        }
        appendInfoRow(sb, "位置", String.format(Locale.US, "%.6f, %.6f",
                lastLocation.getLatitude(), lastLocation.getLongitude()));
        StringBuilder fix = new StringBuilder(one.format(lastLocation.getAccuracy())).append(" m");
        if (lastLocation.hasSpeed()) {
            fix.append("  速度 ").append(one.format(lastLocation.getSpeed())).append(" m/s");
        }
        appendInfoRow(sb, "精度", fix.toString());
        String bearing;
        if (lastLocation.hasBearing()) {
            bearing = one.format(lastLocation.getBearing()) + "°";
        } else {
            bearing = "-";
        }
        appendInfoRow(sb, "行进", bearing + "  时间 " + timeFormat.format(lastLocation.getTime()));
    }

    private void appendSatelliteBrief(StringBuilder sb) {
        appendInfoSectionTitle(sb, "卫星");
        if (lastGnssStatus == null) {
            appendInfoRow(sb, "状态", "等待卫星数据");
            return;
        }
        int visible = lastGnssStatus.getSatelliteCount();
        int used = 0;
        float maxCn0 = 0f;
        for (int i = 0; i < lastGnssStatus.getSatelliteCount(); i++) {
            if (lastGnssStatus.usedInFix(i)) {
                used++;
            }
            maxCn0 = Math.max(maxCn0, lastGnssStatus.getCn0DbHz(i));
        }
        appendInfoRow(sb, "概况", "可见 " + visible
                + "  参与 " + used
                + "  最强 " + one.format(maxCn0) + " dB-Hz");
    }

    private void appendInfoSectionTitle(StringBuilder sb, String title) {
        if (sb.length() > 0) {
            sb.append('\n');
        }
        sb.append(title).append('\n');
    }

    private void appendInfoRow(StringBuilder sb, String label, String value) {
        sb.append(label).append("  ").append(value).append('\n');
    }

    private void appendTrackStatus(StringBuilder sb) {
        sb.append("== 轨迹记录 ==\n");
        if (foregroundServiceRecording) {
            sb.append("真实徒步模式=前台服务记录中\n");
            if (!foregroundServiceSessionId.isEmpty()) {
                sb.append("服务 sessionId=").append(foregroundServiceSessionId).append('\n');
            }
            sb.append("服务 RawPoint 数=").append(foregroundServiceRawPointCount).append('\n');
            sb.append("服务 TrackPoint 数=").append(foregroundServiceTrackPointCount).append('\n');
            if (!foregroundServiceStatusText.isEmpty()) {
                sb.append("服务状态=").append(foregroundServiceStatusText).append('\n');
            }
            sb.append("提示=当前 session 由服务持有，结束后会出现在历史 session 中。\n");
        } else {
            sb.append("真实徒步模式=默认开启，开始后由 location 前台服务承载。\n");
        }
        if (trackSession == null || trackSession.getSessionId() == null) {
            sb.append("状态=未记录\n");
            appendLatestManifestSummary(sb);
        } else {
            sb.append("状态=").append(trackSession.isActive() ? "记录中" :
                    (trackSession.isFinished() ? "已结束" : "未记录")).append('\n');
            sb.append("完成状态=").append(trackSession.getCompletionState())
                    .append(" 完整性=").append(trackSession.getIntegrityState()).append('\n');
            sb.append("最近事件序号=").append(trackSession.getLastEventSeq()).append('\n');
            sb.append("sessionId=").append(trackSession.getSessionId()).append('\n');
            sb.append("RawPoint 数=").append(trackSession.getRawPointCount()).append('\n');
            sb.append("正式 TrackPoint 数=").append(trackSession.getTrackPointCount()).append('\n');
            sb.append("总距离=").append(one.format(trackSession.getTotalDistanceMeters()))
                    .append("m 运动时间=")
                    .append(one.format(trackSession.getMovingTimeSeconds()))
                    .append("s\n");
            sb.append("静止保活点=").append(trackSession.getStationaryKeepaliveCount())
                    .append(" 静止抖动点=").append(trackSession.getStationaryJitterCount()).append('\n');
            sb.append("轨迹可信状态=").append(trackSession.getTrackTrustStateName()).append('\n');
            if (trackSession.getLastRawAccuracyMeters() > 0f) {
                sb.append("最近 RawPoint 精度=")
                        .append(one.format(trackSession.getLastRawAccuracyMeters()))
                        .append("m\n");
            }
            if (!trackSession.getLastDecisionResult().isEmpty()) {
                sb.append("最近决策结果=").append(trackSession.getLastDecisionResult()).append('\n');
            }
            if (!trackSession.getLastDecisionReason().isEmpty()) {
                sb.append("最近决策原因=").append(trackSession.getLastDecisionReason()).append('\n');
                sb.append("最近决策说明=")
                        .append(decisionReasonText(trackSession.getLastDecisionReason()))
                        .append('\n');
            }
            if (trackSession.getRawPointCount() > 0 && trackSession.getTrackPointCount() == 0) {
                sb.append("提示=已经收到系统定位 RawPoint，但还没有可信 TrackPoint，GPX 暂不可导出。\n");
            }
            if (!trackSession.isActive() && trackSession.getSessionId() != null
                    && !trackSession.canExportTrustedGpx()) {
                sb.append("可信 GPX 暂不可导出=")
                        .append(trackSession.trustedGpxUnavailableReason()).append('\n');
            }
            if ("stationary_anchor".equals(trackSession.getLastDecisionReason())
                    || "stationary_cloud_jitter".equals(trackSession.getLastDecisionReason())) {
                sb.append("提示=当前判断为静止，RawPoint 仍记录诊断，但不增加 GPX 距离。\n");
            }
            List<String> recentSummaries = trackSession.getRecentSummaries();
            if (!recentSummaries.isEmpty()) {
                sb.append("最近日志摘要\n");
                for (String line : recentSummaries) {
                    sb.append("- ").append(line).append('\n');
                }
            }
            sb.append("文件目录=").append(trackSession.getSessionDirPath()).append('\n');
        }
        sb.append("说明: 原始点用于诊断，可信轨迹用于导出 GPX。\n");
        appendMapDisplayExplanation(sb);
        sb.append('\n');
    }

    private void appendMapDisplayExplanation(StringBuilder sb) {
        sb.append("地图说明: 蓝线是可导出的可信轨迹；黄点是弱信号采样，仅用于诊断；")
                .append("红线是已排除的疑似交通工具片段，不计入徒步距离；")
                .append("紫线是导入的参考 GPX；蓝点是当前位置，浅蓝圈是定位精度范围。")
                .append("导出结果以记录到的真实定位轨迹为准。\n");
        if (!referenceTrackPoints.isEmpty()) {
            sb.append("参考 GPX=").append(referenceTrackPoints.size()).append(" 点");
            if (!referenceTrackName.isEmpty()) {
                sb.append(" ").append(referenceTrackName);
            }
            sb.append('\n');
        }
    }

    private void appendLatestManifestSummary(StringBuilder sb) {
        if (!lastScanError.isEmpty()) {
            sb.append("历史 session 扫描失败=").append(lastScanError).append('\n');
            return;
        }
        sb.append("历史 session 数=").append(lastScanSessionCount)
                .append(" 已清理临时文件=").append(lastScanCleanedTmpFileCount).append('\n');
        if (recentManifests.isEmpty()) {
            return;
        }
        sb.append("历史 session 摘要\n");
        for (int i = 0; i < recentManifests.size(); i++) {
            appendHistoricalManifestSummary(sb, recentManifests.get(i), i + 1);
        }
    }

    private void appendHistoricalManifestSummary(StringBuilder sb, SessionManifest manifest,
                                                 int displayIndex) {
        sb.append("#").append(displayIndex)
                .append(" session=").append(shortSessionId(manifest.sessionId)).append('\n');
        if (isSelectedHistoricalManifest(manifest)) {
            sb.append("当前显示=是\n");
        }
        sb.append("读取状态=").append(readStatusText(manifest.readStatus)).append('\n');
        sb.append("恢复判断=").append(recoveryStateText(manifest.recoveryState)).append('\n');
        if (SessionManifest.READ_OK.equals(manifest.readStatus)) {
            sb.append("创建=").append(formatWallTime(manifest.createdWallTimeMillis))
                    .append(" 更新=").append(formatWallTime(manifest.lastUpdatedWallTimeMillis))
                    .append('\n');
            sb.append("Schema=").append(manifest.schemaVersion)
                    .append(" 策略=").append(manifest.strategyVersion.isEmpty()
                            ? "-"
                            : manifest.strategyVersion)
                    .append('\n');
            sb.append("完成状态=").append(completionStateText(manifest.completionState))
                    .append(" 完整性=").append(integrityStateText(manifest.integrityState))
                    .append('\n');
            if (!manifest.lastKnownErrorCode.isEmpty()) {
                sb.append("最后错误码=").append(manifest.lastKnownErrorCode).append('\n');
            }
            sb.append("最近事件序号=").append(manifest.lastEventSeq)
                    .append(" RawPoint=").append(manifest.rawPointCount)
                    .append(" TrackPoint=").append(manifest.trackPointCount)
                    .append(" WeakPoint=").append(manifest.weakTrackPointCount).append('\n');
            sb.append("轨迹结论=").append(trackOutcomeText(manifest)).append('\n');
            sb.append("距离=").append(one.format(manifest.totalDistanceMeters))
                    .append("m 运动时间=").append(one.format(manifest.movingTimeSeconds))
                    .append("s\n");
            sb.append("静止保活=").append(manifest.stationaryKeepaliveCount)
                    .append(" 静止抖动=").append(manifest.stationaryJitterCount)
                    .append(" GAP=").append(manifest.gapCount)
                    .append('\n');
            sb.append("诊断日志=").append(manifest.diagnosticLogExists ? "存在" : "缺失")
                    .append("(").append(manifest.diagnosticLogBytes).append("B)")
                    .append(" 内部GPX=").append(manifest.trustedGpxExists ? "存在" : "缺失")
                    .append("(").append(manifest.trustedGpxBytes).append("B)")
                    .append(" partialGPX=").append(manifest.partialGpxExists ? "存在" : "缺失")
                    .append("(").append(manifest.partialGpxBytes).append("B)")
                    .append('\n');
            sb.append("导出能力=可信GPX:")
                    .append(canExportHistoricalGpx(manifest)
                            ? "可导出"
                            : "不可导出(" + historicalGpxUnavailableReason(manifest) + ")")
                    .append(" 诊断:")
                    .append(canExportHistoricalDiagnostic(manifest) ? "可导出" : "不可导出")
                    .append('\n');
            sb.append("诊断读数=").append(diagnosticLogStatusText(manifest.diagnosticLogReadStatus))
                    .append(" 完整事件=").append(manifest.diagnosticCompleteEventCount)
                    .append(" 最后一条完整事件序号=")
                    .append(manifest.diagnosticLastCompleteEventSeq).append('\n');
            sb.append("事件序号一致=")
                    .append(manifest.diagnosticEventSeqMatchesManifest ? "是" : "否")
                    .append('\n');
        }
    }

    private String trackOutcomeText(SessionManifest manifest) {
        if (!SessionManifest.READ_OK.equals(manifest.readStatus)) {
            return "无法判断，session.json 不可读";
        }
        if (!"FINISHED".equals(manifest.completionState)) {
            if (canExportHistoricalPartialGpx(manifest)) {
                return "中断轨迹，可导出 partial GPX 和诊断日志";
            }
            return "未正常结束，只能看诊断日志";
        }
        if (!"OK".equals(manifest.integrityState)) {
            return "完整性异常，只能看诊断日志";
        }
        if (manifest.trackPointCount <= 0) {
            return manifest.weakTrackPointCount > 0
                    ? "只有弱信号轨迹，可导出 partial GPX"
                    : manifest.rawPointCount > 0
                    ? "无可信轨迹，RawPoint 都未进入可信 GPX"
                    : "没有收到定位点";
        }
        if (manifest.trackPointCount == 1 && manifest.totalDistanceMeters <= 0.0) {
            return "只有一个可信锚点，还没有形成移动轨迹";
        }
        if (manifest.trustedGpxExists) {
            return "已有可信轨迹，可导出 GPX";
        }
        return "有 TrackPoint，但内部 GPX 缺失";
    }

    private String trackOutcomeShortText(SessionManifest manifest) {
        if (!SessionManifest.READ_OK.equals(manifest.readStatus)) {
            return "历史记录异常";
        }
        if (!"FINISHED".equals(manifest.completionState)) {
            return canExportHistoricalPartialGpx(manifest) ? "轨迹已中断" : "记录未完成";
        }
        if (!"OK".equals(manifest.integrityState)) {
            return "轨迹需检查";
        }
        if (manifest.trustedGpxExists && manifest.trackPointCount > 0) {
            return "可导出 GPX";
        }
        if (manifest.weakTrackPointCount > 0) {
            return "弱信号轨迹";
        }
        return "无可信轨迹";
    }

    private String shortSessionId(String sessionId) {
        if (sessionId == null || sessionId.length() <= 16) {
            return sessionId == null ? "" : sessionId;
        }
        return sessionId.substring(0, 8) + "..." + sessionId.substring(sessionId.length() - 4);
    }

    private String formatWallTime(long wallTimeMillis) {
        if (wallTimeMillis <= 0L) {
            return "-";
        }
        return dateTimeFormat.format(new Date(wallTimeMillis));
    }

    private String formatDistance(double meters) {
        if (meters >= 1000.0) {
            return one.format(meters / 1000.0) + " km";
        }
        return one.format(Math.max(0.0, meters)) + " m";
    }

    private String formatAscent(double meters) {
        if (meters < 0.0 || Double.isNaN(meters) || Double.isInfinite(meters)) {
            return "-";
        }
        return one.format(meters) + " m";
    }

    private String formatAltitude(double meters) {
        if (Double.isNaN(meters) || Double.isInfinite(meters)) {
            return "-";
        }
        return one.format(meters) + " m";
    }

    private int gpsSignalLevel() {
        if (!isGpsProviderEnabled()) {
            return 0;
        }
        float accuracyMeters = currentGpsAccuracyForHud();
        int accuracyLevel = 0;
        if (accuracyMeters >= 0f) {
            if (accuracyMeters <= 8f) {
                accuracyLevel = 4;
            } else if (accuracyMeters <= 18f) {
                accuracyLevel = 3;
            } else if (accuracyMeters <= 40f) {
                accuracyLevel = 2;
            } else {
                accuracyLevel = 1;
            }
        }

        int satelliteLevel = 0;
        if (lastGnssStatus != null) {
            int visible = lastGnssStatus.getSatelliteCount();
            int used = 0;
            float maxCn0 = 0f;
            for (int i = 0; i < visible; i++) {
                if (lastGnssStatus.usedInFix(i)) {
                    used++;
                }
                maxCn0 = Math.max(maxCn0, lastGnssStatus.getCn0DbHz(i));
            }
            if (used >= 8 && maxCn0 >= 35f) {
                satelliteLevel = 4;
            } else if (used >= 5 && maxCn0 >= 28f) {
                satelliteLevel = 3;
            } else if (used >= 3 && maxCn0 >= 22f) {
                satelliteLevel = 2;
            } else if (visible > 0 || maxCn0 > 0f) {
                satelliteLevel = 1;
            }
        }

        return Math.max(accuracyLevel, satelliteLevel);
    }

    private String gpsSignalText() {
        if (!isGpsProviderEnabled()) {
            return "未开启";
        }
        int level = gpsSignalLevel();
        if (level <= 0) {
            return "等待定位";
        }
        String signalText;
        if (level >= 4) {
            signalText = "强";
        } else if (level == 3) {
            signalText = "良好";
        } else if (level == 2) {
            signalText = "一般";
        } else {
            signalText = "弱";
        }
        float accuracyMeters = currentGpsAccuracyForHud();
        if (accuracyMeters < 0f) {
            return signalText + "  搜星中";
        }
        StringBuilder text = new StringBuilder(signalText)
                .append("  精度")
                .append(one.format(accuracyMeters))
                .append("m");
        long ageSeconds = Math.max(0L,
                (System.currentTimeMillis() - currentGpsTimeForHud()) / 1000L);
        if (ageSeconds >= 5L) {
            text.append("  ").append(ageSeconds).append("s前");
        }
        return text.toString();
    }

    private float currentGpsAccuracyForHud() {
        if (foregroundServiceRecording && foregroundServiceHasLocation
                && foregroundServiceAccuracyMeters >= 0f) {
            return foregroundServiceAccuracyMeters;
        }
        if (lastLocation != null && lastLocation.hasAccuracy()) {
            return lastLocation.getAccuracy();
        }
        return -1f;
    }

    private long currentGpsTimeForHud() {
        if (lastLocation != null) {
            return lastLocation.getTime();
        }
        return System.currentTimeMillis();
    }

    private String satelliteHudText() {
        if (lastGnssStatus == null) {
            return "卫星：等待数据";
        }
        int visible = lastGnssStatus.getSatelliteCount();
        int used = 0;
        for (int i = 0; i < visible; i++) {
            if (lastGnssStatus.usedInFix(i)) {
                used++;
            }
        }
        return "卫星：定位 " + used + " 颗 / 可见 " + visible + " 颗";
    }

    private String barometerHudText() {
        if (!pressureSensorAvailable) {
            return "气压：不可用";
        }
        if (Float.isNaN(currentPressureHpa)
                || Double.isNaN(currentRawBarometerAltitudeMeters)) {
            return "气压：可用，等待样本";
        }
        return "气压：" + one.format(currentPressureHpa) + "hPa 原海拔"
                + formatAltitude(currentRawBarometerAltitudeMeters);
    }

    private String formatDuration(double seconds) {
        if (seconds <= 0.0 || Double.isNaN(seconds) || Double.isInfinite(seconds)) {
            return "0秒";
        }
        long totalSeconds = Math.round(seconds);
        long minutes = totalSeconds / 60L;
        long remainingSeconds = totalSeconds % 60L;
        if (minutes <= 0L) {
            return remainingSeconds + "秒";
        }
        if (minutes < 60L) {
            return remainingSeconds == 0L
                    ? minutes + "分钟"
                    : minutes + "分" + remainingSeconds + "秒";
        }
        long hours = minutes / 60L;
        long remainingMinutes = minutes % 60L;
        return remainingMinutes == 0L
                ? hours + "小时"
                : hours + "小时" + remainingMinutes + "分钟";
    }

    private String readStatusText(String status) {
        switch (status) {
            case SessionManifest.READ_OK:
                return "OK（session.json 可读取）";
            case SessionManifest.READ_MISSING_SESSION_JSON:
                return "MISSING_SESSION_JSON（缺少 session.json）";
            case SessionManifest.READ_INVALID_SESSION_JSON:
                return "INVALID_SESSION_JSON（session.json 损坏或格式不对）";
            default:
                return status + "（未知读取状态）";
        }
    }

    private String recoveryStateText(String state) {
        switch (state) {
            case SessionManifest.RECOVERY_FINISHED:
                return "FINISHED（已正常结束）";
            case SessionManifest.RECOVERY_INTERRUPTED:
                return "INTERRUPTED（记录中被中断，可导出诊断，不能当作正常 GPX）";
            case SessionManifest.RECOVERY_ERROR:
                return "ERROR（记录完整性异常）";
            case SessionManifest.RECOVERY_ABORTED:
                return "ABORTED（缺少诊断日志，不能信任该 session）";
            case SessionManifest.RECOVERY_INVALID_MANIFEST:
                return "INVALID_MANIFEST（manifest 损坏）";
            case SessionManifest.RECOVERY_MISSING_MANIFEST:
                return "MISSING_MANIFEST（manifest 缺失）";
            case SessionManifest.RECOVERY_UNKNOWN:
                return "UNKNOWN（状态不足，无法判断）";
            default:
                return state + "（未知恢复状态）";
        }
    }

    private String completionStateText(String state) {
        switch (state) {
            case "ACTIVE":
                return "ACTIVE（仍显示为记录中）";
            case "FINISHED":
                return "FINISHED（已结束）";
            case "ERROR":
                return "ERROR（异常结束）";
            default:
                return state.isEmpty() ? "空（旧数据或损坏）" : state + "（未知完成状态）";
        }
    }

    private String integrityStateText(String state) {
        switch (state) {
            case "OK":
                return "OK（完整）";
            case "ERROR":
                return "ERROR（完整性异常）";
            default:
                return state.isEmpty() ? "空（旧数据或损坏）" : state + "（未知完整性状态）";
        }
    }

    private String diagnosticLogStatusText(String status) {
        switch (status) {
            case DiagnosticLogSummary.STATUS_OK:
                return "OK（诊断日志可读取）";
            case DiagnosticLogSummary.STATUS_MISSING:
                return "MISSING（诊断日志缺失）";
            case DiagnosticLogSummary.STATUS_INVALID_JSONL:
                return "INVALID_JSONL（诊断日志有损坏行）";
            case DiagnosticLogSummary.STATUS_READ_ERROR:
                return "READ_ERROR（诊断日志读取失败）";
            default:
                return status + "（未知诊断状态）";
        }
    }

    private void toggleTrackRecording() {
        if (foregroundServiceRecording) {
            confirmStopForegroundTrackRecording();
            return;
        }
        startForegroundTrackRecording();
    }

    private void confirmStopForegroundTrackRecording() {
        new AlertDialog.Builder(this)
                .setTitle("结束本次记录？")
                .setMessage("结束后会停止当前位置采集，并把本次轨迹保存到历史记录。")
                .setNegativeButton("继续记录", null)
                .setPositiveButton("结束", (dialog, which) -> stopForegroundTrackRecording())
                .show();
    }

    private void startForegroundTrackRecording() {
        if (!hasFineLocation()) {
            requestFineLocationPermission();
            return;
        }
        requestNotificationPermissionIfUseful();
        recordingServiceController.startRecording();
        foregroundServiceRecording = true;
        updateRecordButtonState();
        updateHistoryActionRows();
        setStatus("记录已开始，通知栏会持续显示记录状态。");
        render();
    }

    private void stopForegroundTrackRecording() {
        recordingServiceController.stopRecording();
        foregroundServiceRecording = false;
        updateRecordButtonState();
        setStatus("已请求结束记录；如刚结束，请稍后刷新或重新打开查看最新 session。");
        render();
        mainHandler.postDelayed(() -> {
            scanExistingSessions();
            render();
        }, 800L);
    }

    private void scanExistingSessions() {
        HistorySessionState state = historySessionController.scan(selectedHistoricalSessionId);
        latestManifest = state.latestManifest;
        selectedHistoricalSessionId = state.selectedSessionId;
        lastScanSessionCount = state.sessionCount();
        lastScanCleanedTmpFileCount = state.cleanedTmpFileCount;
        lastScanError = state.error;
        invalidateHistoricalMapCache();
        invalidateHistoricalAscentCache();
        recentManifests.clear();
        recentManifests.addAll(state.manifests);
        updateHistoricalActionButtons();
        updateHistoryActionRows();
    }

    private void updateHistoricalActionButtons() {
        // Historical export actions are rendered per session in updateHistoryActionRows().
    }

    private void updateHistoryActionRows() {
        if (historyActionsContainer == null) {
            return;
        }
        historyActionsContainer.removeAllViews();
        if (trackSession != null && trackSession.getSessionId() != null
                && !trackSession.isActive()) {
            historyActionsContainer.setVisibility(View.VISIBLE);
            addHistorySectionTitle("当前记录");
            addCurrentSessionActionRow();
        }
        historyActionsContainer.setVisibility(View.VISIBLE);
        if (recentManifests.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("暂无历史记录");
            empty.setTextColor(Color.rgb(75, 85, 99));
            empty.setTextSize(14);
            historyActionsContainer.addView(empty, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT));
            return;
        }
        addHistorySectionTitle("历史记录");
        for (int i = 0; i < recentManifests.size(); i++) {
            addHistoryActionRow(recentManifests.get(i), i + 1);
        }
    }

    private void addHistorySectionTitle(String text) {
        TextView title = new TextView(this);
        title.setText(text);
        title.setTextColor(Color.rgb(107, 114, 128));
        title.setTextSize(12);
        title.setPadding(0, dp(8), 0, dp(6));
        historyActionsContainer.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
    }

    private void addHistoryDetailText(LinearLayout card, String text) {
        TextView detail = new TextView(this);
        detail.setText(text);
        detail.setTextColor(Color.rgb(75, 85, 99));
        detail.setTextSize(12);
        detail.setLineSpacing(dp(3), 1.0f);
        detail.setPadding(0, dp(6), 0, 0);
        card.addView(detail, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
    }

    private void addCurrentSessionActionRow() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        styleCard(card, Color.WHITE, 8);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, 0, 0, dp(10));

        TextView header = new TextView(this);
        header.setText("当前 session");
        header.setTextColor(Color.rgb(17, 24, 39));
        header.setTextSize(14);
        card.addView(header, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        TrackAscentCalculator.Result ascentResult = trackSession.getAscentResult();
        addHistoryDetailText(card, "里程 "
                + ascentOverviewText(trackSession.getTotalDistanceMeters(), ascentResult)
                + "  运动 " + one.format(trackSession.getMovingTimeSeconds()) + " s\n"
                + "爬升分解 " + ascentBreakdownText(ascentResult) + "\n"
                + "气压计 " + sessionBarometerText(trackSession) + "\n"
                + "采样 " + sampleCountText(trackSession.getRawPointCount(),
                trackSession.getTrackPointCount()));

        LinearLayout trackExportRow = newExportButtonRow(dp(8));
        if (trackSession.canExportTrustedGpx()) {
            addSmallExportButton(trackExportRow, "GPX", v -> exportCurrentTrackAsGpx());
        }
        addSmallExportButton(trackExportRow, "证据", v -> exportCurrentEvidenceLog());
        addExportRowIfNotEmpty(card, trackExportRow);

        if (canExportCurrentSampleReport()) {
            LinearLayout reportExportRow = newExportButtonRow(dp(6));
            addSmallExportButton(reportExportRow, "样本报告", v -> exportCurrentSampleReport());
            addSmallExportButton(reportExportRow, "弱GPS报告", v -> exportCurrentWeakGnssReport());
            addExportRowIfNotEmpty(card, reportExportRow);
        }
        historyActionsContainer.addView(card, cardLp);
    }

    private void addHistoryActionRow(SessionManifest manifest, int displayIndex) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        styleCard(card, Color.WHITE, 8);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        cardLp.setMargins(0, 0, 0, dp(10));

        /* Header label */
        boolean selected = isSelectedHistoricalManifest(manifest);
        boolean currentRecordingSession = isCurrentForegroundSession(manifest);
        TextView label = new TextView(this);
        label.setText(historyActionLabel(manifest, displayIndex));
        label.setTextColor(Color.rgb(17, 24, 39));
        label.setTextSize(14);
        card.addView(label, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        TrackAscentCalculator.Result fallbackAscentResult =
                !hasManifestAscentSummary(manifest) ? cachedHistoricalAscentResult(manifest) : null;
        addHistoryDetailText(card, "里程 "
                + manifestAscentOverviewText(manifest, fallbackAscentResult)
                + "  运动 " + one.format(manifest.movingTimeSeconds) + " s\n"
                + "爬升分解 "
                + manifestAscentBreakdownText(manifest, fallbackAscentResult) + "\n"
                + "采样 " + sampleCountText(manifest.rawPointCount,
                manifest.trackPointCount));

        /* Manage row (display + delete) */
        LinearLayout manageRow = new LinearLayout(this);
        manageRow.setOrientation(LinearLayout.HORIZONTAL);
        manageRow.setPadding(0, dp(10), 0, 0);

        Button displayButton = new Button(this);
        displayButton.setText(currentRecordingSession
                ? "记录中"
                : (selected ? "正在显示" : "显示"));
        if (selected || currentRecordingSession) {
            styleSmallPrimaryButton(displayButton);
        } else {
            styleSmallSecondaryButton(displayButton);
        }
        displayButton.setEnabled(!selected && !foregroundServiceRecording
                && !currentRecordingSession);
        displayButton.setOnClickListener(v -> selectHistoricalSession(manifest));
        manageRow.addView(displayButton, weightedButtonParams(false));

        Button deleteButton = new Button(this);
        deleteButton.setText("删除");
        styleSmallDangerButton(deleteButton);
        deleteButton.setEnabled(!currentRecordingSession);
        deleteButton.setOnClickListener(v -> confirmDeleteHistoricalSession(manifest));
        manageRow.addView(deleteButton, weightedButtonParams(true));
        card.addView(manageRow, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        /* Export row */
        LinearLayout trackExportRow = newExportButtonRow(dp(6));
        if (canExportHistoricalGpx(manifest)) {
            addSmallExportButton(trackExportRow, "GPX",
                    v -> exportHistoricalTrustedGpx(manifest));
        }
        if (canExportHistoricalEvidence(manifest)) {
            addSmallExportButton(trackExportRow, "证据",
                    v -> exportHistoricalEvidenceLog(manifest));
        }
        addExportRowIfNotEmpty(card, trackExportRow);

        if (canExportHistoricalSampleReport(manifest)) {
            LinearLayout reportExportRow = newExportButtonRow(dp(6));
            addSmallExportButton(reportExportRow, "样本报告",
                    v -> exportHistoricalSampleReport(manifest));
            addSmallExportButton(reportExportRow, "弱GPS报告",
                    v -> exportHistoricalWeakGnssReport(manifest));
            addExportRowIfNotEmpty(card, reportExportRow);
        }
        historyActionsContainer.addView(card, cardLp);
    }

    private LinearLayout newExportButtonRow(int topPadding) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, topPadding, 0, 0);
        return row;
    }

    private void addSmallExportButton(LinearLayout row, String text,
                                      View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        styleSmallSecondaryButton(button);
        button.setOnClickListener(listener);
        row.addView(button, weightedButtonParams(row.getChildCount() > 0));
    }

    private void addExportRowIfNotEmpty(LinearLayout card, LinearLayout row) {
        if (row.getChildCount() == 0) {
            return;
        }
        card.addView(row, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
    }

    private LinearLayout.LayoutParams weightedButtonParams(boolean hasLeftSibling) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        if (hasLeftSibling) {
            params.setMargins(dp(8), 0, 0, 0);
        }
        return params;
    }

    private String historyActionLabel(SessionManifest manifest, int displayIndex) {
        String time = SessionManifest.READ_OK.equals(manifest.readStatus)
                ? formatWallTime(manifest.lastUpdatedWallTimeMillis)
                : readStatusText(manifest.readStatus);
        String prefix = isSelectedHistoricalManifest(manifest)
                ? "正在显示 历史 "
                : "历史 ";
        return prefix + displayIndex + "  " + time + "  "
                + one.format(manifest.totalDistanceMeters) + "m  "
                + trackOutcomeText(manifest);
    }

    private boolean isSelectedHistoricalManifest(SessionManifest manifest) {
        return !foregroundServiceRecording
                && manifest != null
                && manifest.sessionId != null
                && manifest.sessionId.equals(selectedHistoricalSessionId);
    }

    private boolean isCurrentForegroundSession(SessionManifest manifest) {
        return manifest != null
                && manifest.sessionId != null
                && manifest.sessionId.equals(foregroundServiceSessionId)
                && (foregroundServiceRecording || "ACTIVE".equals(manifest.completionState));
    }

    private void selectHistoricalSession(SessionManifest manifest) {
        if (manifest == null || manifest.sessionId == null) {
            setStatus("无法显示这条历史记录：session 信息缺失");
            return;
        }
        if (foregroundServiceRecording) {
            setStatus("记录中先显示实时轨迹，结束后可切换历史记录。");
            return;
        }
        if (isCurrentForegroundSession(manifest)) {
            setStatus("当前 session 正在记录中，结束记录后再查看历史轨迹。");
            return;
        }
        selectedHistoricalSessionId = manifest.sessionId;
        latestManifest = manifest;
        requestMapFrameNextUpdate();
        updateHistoryActionRows();
        setStatus("正在显示历史记录: " + shortSessionId(manifest.sessionId));
        render();
    }

    private void confirmDeleteHistoricalSession(SessionManifest manifest) {
        if (manifest == null || manifest.sessionId == null) {
            setStatus("无法删除这条历史记录：session 信息缺失");
            return;
        }
        if (isCurrentForegroundSession(manifest)) {
            setStatus("当前 session 正在记录中，结束记录后才能删除。");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("删除历史记录？")
                .setMessage("将删除 " + shortSessionId(manifest.sessionId)
                        + " 的 GPX、诊断日志和报告源文件，删除后不能恢复。")
                .setNegativeButton("取消", null)
                .setPositiveButton("删除", (dialog, which) -> deleteHistoricalSession(manifest))
                .show();
    }

    private void deleteHistoricalSession(SessionManifest manifest) {
        if (manifest == null || manifest.sessionId == null) {
            setStatus("无法删除这条历史记录：session 信息缺失");
            return;
        }
        if (isCurrentForegroundSession(manifest)) {
            setStatus("当前 session 正在记录中，结束记录后才能删除。");
            return;
        }
        String deletedSessionId = manifest.sessionId;
        try {
            new SessionFileStore(this).deleteSessionDir(manifest.sessionDir);
            if (deletedSessionId.equals(selectedHistoricalSessionId)) {
                selectedHistoricalSessionId = "";
                latestManifest = null;
            }
            scanExistingSessions();
            requestMapFrameNextUpdate();
            setStatus("已删除历史记录: " + shortSessionId(deletedSessionId));
            render();
        } catch (IOException | IllegalArgumentException e) {
            setStatus("删除历史记录失败: " + e.getMessage());
        }
    }

    private void requestMapFrameNextUpdate() {
        if (mapView != null) {
            mapView.requestFrameNextUpdate();
        }
    }

    private void appendTrackPointIfRecording(Location location) {
        if (trackSession == null || !trackSession.isActive() || location == null) {
            return;
        }
        trackSession.onLocation(location);
    }

    private void scheduleNoLocationTimeout() {
        mainHandler.removeCallbacks(noLocationTimeoutRunnable);
        if (trackSession != null && trackSession.isActive()) {
            mainHandler.postDelayed(noLocationTimeoutRunnable, NO_LOCATION_TIMEOUT_MILLIS);
        }
    }

    private void exportCurrentTrackAsGpx() {
        try {
            if (!trackSession.canExportTrustedGpx()) {
                setStatus("这次记录没有可信 GPX 可导出：" + trackSession.trustedGpxUnavailableReason());
                return;
            }
            String gpxText = trackSession.buildGpx();
            shareTextFile(gpxText, trackSession.suggestedGpxFileName(),
                    "application/gpx+xml", "分享 GPX");
        } catch (IllegalStateException e) {
            setStatus("不能导出 GPX：" + e.getMessage());
        } catch (IOException e) {
            setStatus("GPX 分享失败：" + e.getMessage());
        }
    }

    private void exportLatestHistoricalTrackAsGpx() {
        SessionManifest exportableManifest = latestExportableHistoricalTrackManifest();
        if (exportableManifest == null) {
            setStatus("最近历史 session 没有可导出的 GPX 或 partial GPX");
            return;
        }
        try {
            String fileName;
            String gpxText;
            if (canExportHistoricalGpx(exportableManifest)) {
                gpxText = readText(new File(exportableManifest.sessionDir,
                        exportableManifest.trustedGpxFileName));
                if (gpxText.isEmpty()) {
                    setStatus("历史 GPX 文件为空");
                    return;
                }
                fileName = trustedGpxShareFileName(exportableManifest);
                setStatus("准备分享最近历史可信 GPX: "
                        + exportableManifest.sessionId);
            } else {
                File partialFile = new File(exportableManifest.sessionDir,
                        exportableManifest.partialGpxFileName);
                if (exportableManifest.partialGpxExists) {
                    gpxText = readText(partialFile);
                } else {
                    List<TrackPoint> points = new DiagnosticTrackPointReader().readTrackPoints(
                            new File(exportableManifest.sessionDir,
                                    exportableManifest.diagnosticLogFileName));
                    if (points.isEmpty()) {
                        setStatus("历史 session 没有可导出的 partial TrackPoint");
                        return;
                    }
                    gpxText = new GpxExporter().buildPartialGpx(exportableManifest.sessionId,
                            points, exportableManifest.totalDistanceMeters,
                            exportableManifest.movingTimeSeconds);
                }
                if (gpxText.isEmpty()) {
                    setStatus("历史 partial GPX 文件为空");
                    return;
                }
                fileName = partialGpxShareFileName(exportableManifest);
                setStatus("准备分享最近历史 partial GPX: "
                        + exportableManifest.sessionId);
            }
            shareTextFile(gpxText, fileName, "application/gpx+xml", "分享 GPX");
        } catch (IOException | JSONException e) {
            setStatus("读取历史 GPX 失败: " + e.getMessage());
        }
    }

    private void exportHistoricalTrustedGpx(SessionManifest manifest) {
        if (!canExportHistoricalGpx(manifest)) {
            setStatus("这条历史记录没有可信 GPX 可导出");
            return;
        }
        try {
            String gpxText = readText(new File(manifest.sessionDir, manifest.trustedGpxFileName));
            if (gpxText.isEmpty()) {
                setStatus("历史 GPX 文件为空");
                return;
            }
            setStatus("准备分享历史可信 GPX: " + manifest.sessionId);
            shareTextFile(gpxText, trustedGpxShareFileName(manifest),
                    "application/gpx+xml", "分享 GPX");
        } catch (IOException e) {
            setStatus("读取历史 GPX 失败: " + e.getMessage());
        }
    }

    private SessionManifest latestExportableHistoricalTrackManifest() {
        for (SessionManifest manifest : recentManifests) {
            if (canExportHistoricalGpx(manifest) || canExportHistoricalPartialGpx(manifest)) {
                return manifest;
            }
        }
        return null;
    }

    private int historicalGpxExportIndex() {
        for (int i = 0; i < recentManifests.size(); i++) {
            SessionManifest manifest = recentManifests.get(i);
            if (canExportHistoricalGpx(manifest) || canExportHistoricalPartialGpx(manifest)) {
                return i + 1;
            }
        }
        return -1;
    }

    private boolean canExportHistoricalGpx(SessionManifest manifest) {
        return manifest != null
                && SessionManifest.READ_OK.equals(manifest.readStatus)
                && "FINISHED".equals(manifest.completionState)
                && "OK".equals(manifest.integrityState)
                && manifest.trackPointCount > 0
                && manifest.trustedGpxExists;
    }

    private boolean canExportHistoricalPartialGpx(SessionManifest manifest) {
        return manifest != null
                && SessionManifest.READ_OK.equals(manifest.readStatus)
                && (manifest.partialGpxExists
                || ((manifest.trackPointCount > 0 || manifest.weakTrackPointCount > 0)
                && manifest.diagnosticLogExists));
    }

    private String historicalGpxUnavailableReason(SessionManifest manifest) {
        if (manifest == null) {
            return "没有历史 session";
        }
        if (!SessionManifest.READ_OK.equals(manifest.readStatus)) {
            return "session.json 不可读";
        }
        if (!"FINISHED".equals(manifest.completionState)) {
            if (canExportHistoricalPartialGpx(manifest)) {
                return "可导出 partial GPX";
            }
            return "session 未正常结束";
        }
        if (!"OK".equals(manifest.integrityState)) {
            return "完整性异常";
        }
        if (manifest.trackPointCount <= 0) {
            return canExportHistoricalPartialGpx(manifest)
                    ? "没有正式 TrackPoint，可导出 partial GPX"
                    : "没有正式 TrackPoint";
        }
        if (!manifest.trustedGpxExists) {
            return "内部 GPX 缺失";
        }
        return "未知原因";
    }

    private SessionManifest latestExportableHistoricalDiagnosticManifest() {
        for (SessionManifest manifest : recentManifests) {
            if (canExportHistoricalDiagnostic(manifest)) {
                return manifest;
            }
        }
        return null;
    }

    private int historicalDiagnosticExportIndex() {
        for (int i = 0; i < recentManifests.size(); i++) {
            if (canExportHistoricalDiagnostic(recentManifests.get(i))) {
                return i + 1;
            }
        }
        return -1;
    }

    private boolean canExportHistoricalDiagnostic(SessionManifest manifest) {
        return manifest != null && manifest.diagnosticLogExists;
    }

    private boolean canExportHistoricalEvidence(SessionManifest manifest) {
        return manifest != null && evidenceFile(manifest).exists();
    }

    private boolean canExportCurrentSampleReport() {
        return trackSession != null
                && trackSession.getSessionDirPath() != null
                && !trackSession.getSessionDirPath().isEmpty();
    }

    private boolean canExportHistoricalSampleReport(SessionManifest manifest) {
        return manifest != null && manifest.diagnosticLogExists;
    }

    private void requestReferenceGpxDocument() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/gpx+xml",
                "application/xml",
                "text/xml",
                "application/octet-stream"
        });
        startActivityForResult(intent, REQ_IMPORT_REFERENCE_GPX);
    }

    private void importReferenceGpx(Uri uri) {
        try (InputStream inputStream = getContentResolver().openInputStream(uri)) {
            if (inputStream == null) {
                setStatus("无法打开参考 GPX");
                return;
            }
            List<ReferenceTrackPoint> points = new GpxReferenceParser().parse(inputStream);
            if (points.isEmpty()) {
                setStatus("参考 GPX 没有可用轨迹点");
                return;
            }
            referenceTrackPoints.clear();
            referenceTrackPoints.addAll(points);
            referenceTrackName = uri.getLastPathSegment() == null ? "reference.gpx" : uri.getLastPathSegment();
            if (mapView != null) {
                mapView.requestFrameNextUpdate();
            }
            setStatus("已导入参考 GPX: " + points.size() + " 点，用紫色线显示");
            render();
        } catch (IOException | ParserConfigurationException | SAXException e) {
            setStatus("导入参考 GPX 失败: " + e.getMessage());
        }
    }

    private void exportCurrentDiagnosticLog() {
        try {
            String diagnosticText = trackSession.getDiagnosticText();
            if (diagnosticText.isEmpty()) {
                setStatus("诊断日志为空");
                return;
            }
            shareTextFile(diagnosticText, trackSession.suggestedDiagnosticFileName(),
                    "application/json", "分享诊断日志");
        } catch (IOException e) {
            setStatus("读取诊断日志失败: " + e.getMessage());
        }
    }

    private void exportCurrentEvidenceLog() {
        try {
            String evidenceText = trackSession.getEvidenceText();
            if (evidenceText.isEmpty()) {
                setStatus("证据日志为空");
                return;
            }
            shareTextFile(evidenceText, trackSession.suggestedEvidenceFileName(),
                    "application/json", "分享证据日志");
        } catch (IOException e) {
            setStatus("读取证据日志失败: " + e.getMessage());
        }
    }

    private void exportLatestHistoricalDiagnosticLog() {
        SessionManifest exportableManifest = latestExportableHistoricalDiagnosticManifest();
        if (exportableManifest == null) {
            setStatus("还没有可导出的诊断日志");
            return;
        }
        try {
            String diagnosticText = readText(new File(exportableManifest.sessionDir,
                    exportableManifest.diagnosticLogFileName));
            if (diagnosticText.isEmpty()) {
                setStatus("诊断日志为空");
                return;
            }
            setStatus("准备分享最近历史诊断: " + exportableManifest.sessionId);
            shareTextFile(diagnosticText, diagnosticShareFileName(exportableManifest),
                    "application/json", "分享诊断日志");
        } catch (IOException e) {
            setStatus("读取历史诊断日志失败: " + e.getMessage());
        }
    }

    private void exportHistoricalDiagnosticLog(SessionManifest manifest) {
        if (!canExportHistoricalDiagnostic(manifest)) {
            setStatus("这条历史记录没有诊断日志可导出");
            return;
        }
        try {
            String diagnosticText = readText(new File(manifest.sessionDir,
                    manifest.diagnosticLogFileName));
            if (diagnosticText.isEmpty()) {
                setStatus("诊断日志为空");
                return;
            }
            setStatus("准备分享历史诊断: " + manifest.sessionId);
            shareTextFile(diagnosticText, diagnosticShareFileName(manifest),
                    "application/json", "分享诊断日志");
        } catch (IOException e) {
            setStatus("读取历史诊断日志失败: " + e.getMessage());
        }
    }

    private void exportHistoricalEvidenceLog(SessionManifest manifest) {
        if (!canExportHistoricalEvidence(manifest)) {
            setStatus("这条历史记录没有证据日志可导出");
            return;
        }
        try {
            String evidenceText = readText(evidenceFile(manifest));
            if (evidenceText.isEmpty()) {
                setStatus("证据日志为空");
                return;
            }
            setStatus("准备分享历史证据: " + manifest.sessionId);
            shareTextFile(evidenceText, evidenceShareFileName(manifest),
                    "application/json", "分享证据日志");
        } catch (IOException e) {
            setStatus("读取历史证据日志失败: " + e.getMessage());
        }
    }

    private void exportCurrentSampleReport() {
        if (!canExportCurrentSampleReport()) {
            setStatus("当前记录还没有可分析的 session 目录");
            return;
        }
        try {
            SessionFileStore fileStore = new SessionFileStore(this);
            SessionManifest manifest = new SessionManifestReader(fileStore).read(
                    new File(trackSession.getSessionDirPath()));
            exportSampleReport(manifest);
        } catch (IOException | JSONException e) {
            setStatus("生成当前样本报告失败: " + e.getMessage());
        }
    }

    private void exportHistoricalSampleReport(SessionManifest manifest) {
        if (!canExportHistoricalSampleReport(manifest)) {
            setStatus("这条历史记录没有诊断日志，无法生成样本报告");
            return;
        }
        try {
            exportSampleReport(manifest);
        } catch (IOException | JSONException e) {
            setStatus("生成历史样本报告失败: " + e.getMessage());
        }
    }

    private void exportSampleReport(SessionManifest manifest) throws IOException, JSONException {
        HikingSampleReport report = new HikingSampleReportGenerator().generate(manifest);
        String reportText = report.toText();
        setStatus("准备分享样本报告: " + manifest.sessionId + " / " + report.verdict);
        shareTextFile(reportText, sampleReportShareFileName(manifest),
                "text/plain", "分享样本报告");
    }

    private void exportCurrentWeakGnssReport() {
        if (!canExportCurrentSampleReport()) {
            setStatus("当前记录还没有可分析的 session 目录");
            return;
        }
        try {
            SessionFileStore fileStore = new SessionFileStore(this);
            SessionManifest manifest = new SessionManifestReader(fileStore).read(
                    new File(trackSession.getSessionDirPath()));
            exportWeakGnssReport(manifest);
        } catch (IOException | JSONException e) {
            setStatus("生成当前弱 GPS 报告失败: " + e.getMessage());
        }
    }

    private void exportHistoricalWeakGnssReport(SessionManifest manifest) {
        if (!canExportHistoricalSampleReport(manifest)) {
            setStatus("这条历史记录没有诊断日志，无法生成弱 GPS 报告");
            return;
        }
        try {
            exportWeakGnssReport(manifest);
        } catch (IOException | JSONException e) {
            setStatus("生成历史弱 GPS 报告失败: " + e.getMessage());
        }
    }

    private void exportWeakGnssReport(SessionManifest manifest) throws IOException, JSONException {
        WeakGnssReport report = new WeakGnssReportGenerator().generate(manifest);
        String reportText = report.toText();
        String internalSaveStatus = tryWriteInternalWeakGnssReportFiles(
                manifest, report, reportText);
        setStatus("准备分享弱 GPS 报告: " + manifest.sessionId + internalSaveStatus);
        shareTextFile(reportText, weakGnssReportShareFileName(manifest),
                "text/plain", "分享弱 GPS 报告");
    }

    private String tryWriteInternalWeakGnssReportFiles(SessionManifest manifest,
                                                       WeakGnssReport report,
                                                       String reportText) {
        try {
            SessionFileStore fileStore = new SessionFileStore(this);
            File exportDir = fileStore.exportDir(manifest.sessionDir);
            if (!exportDir.exists() && !exportDir.mkdirs()) {
                throw new IOException("无法创建报告目录: " + exportDir);
            }
            writeText(fileStore.weakGnssReportText(manifest.sessionDir), reportText);
            writeText(fileStore.weakGnssReportJson(manifest.sessionDir),
                    report.toJson().toString(2));
            return "，已同步保存到 session/export";
        } catch (IOException | JSONException e) {
            return "，内部副本保存失败: " + e.getMessage();
        }
    }

    private void shareTextFile(String text, String fileName, String mimeType, String title)
            throws IOException {
        File shareDir = new File(getCacheDir(), "shared_exports");
        if (!shareDir.exists() && !shareDir.mkdirs()) {
            throw new IOException("无法创建分享目录: " + shareDir);
        }
        File shareFile = new File(shareDir, sanitizeShareFileName(fileName));
        writeText(shareFile, text);
        Uri uri = new Uri.Builder()
                .scheme("content")
                .authority(getPackageName() + ".exportshare")
                .appendPath("export")
                .appendPath(shareFile.getName())
                .build();
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.putExtra(Intent.EXTRA_SUBJECT, shareFile.getName());
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(intent, title));
        setStatus(title + ": " + shareFile.getName());
    }

    private String trustedGpxShareFileName(SessionManifest manifest) {
        return "gnss_track_trusted_" + manifest.sessionId + ".gpx";
    }

    private String partialGpxShareFileName(SessionManifest manifest) {
        return "gnss_track_partial_" + manifest.sessionId + ".gpx";
    }

    private String diagnosticShareFileName(SessionManifest manifest) {
        return "gnss_diagnostic_" + manifest.sessionId + ".jsonl";
    }

    private String evidenceShareFileName(SessionManifest manifest) {
        return "gnss_evidence_" + manifest.sessionId + ".jsonl";
    }

    private File evidenceFile(SessionManifest manifest) {
        if (manifest == null || manifest.sessionDir == null) {
            return new File("");
        }
        return new SessionFileStore(this).evidenceJsonl(manifest.sessionDir);
    }

    private String sampleReportShareFileName(SessionManifest manifest) {
        return "hiking_sample_report_" + manifest.sessionId + ".txt";
    }

    private String weakGnssReportShareFileName(SessionManifest manifest) {
        return "weak_gps_report_" + manifest.sessionId + ".txt";
    }

    private String sanitizeShareFileName(String fileName) {
        String cleaned = fileName == null ? "" : fileName.trim()
                .replaceAll("[\\\\/:*?\"<>|\\s]+", "_");
        return cleaned.isEmpty() ? "gnss_export.txt" : cleaned;
    }

    private String readText(File file) throws IOException {
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream inputStream = new FileInputStream(file)) {
            int offset = 0;
            while (offset < bytes.length) {
                int read = inputStream.read(bytes, offset, bytes.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
            return new String(bytes, 0, offset, StandardCharsets.UTF_8);
        }
    }

    private void writeText(File file, String text) throws IOException {
        try (FileOutputStream outputStream = new FileOutputStream(file)) {
            outputStream.write(text.getBytes(StandardCharsets.UTF_8));
            outputStream.flush();
        }
    }

    private void appendGnssSnapshotIfRecording(GnssStatus gnssStatus) {
        if (trackSession == null || !trackSession.isActive() || gnssStatus == null) {
            return;
        }
        GnssQualitySnapshot snapshot = gnssQualitySnapshotFactory.fromStatus(
                trackSession.nextGnssSnapshotId(), SystemClock.elapsedRealtimeNanos(),
                gnssStatus);
        trackSession.onGnssSnapshot(snapshot);
    }

    private void appendLocation(StringBuilder sb) {
        sb.append("== 当前定位结果 ==\n");
        if (lastLocation == null) {
            sb.append("还没有定位成功\n\n");
            return;
        }

        sb.append("定位来源=").append(lastLocation.getProvider()).append('\n');
        sb.append("纬度=").append(lastLocation.getLatitude())
                .append(" 经度=").append(lastLocation.getLongitude()).append('\n');
        sb.append("水平精度=").append(one.format(lastLocation.getAccuracy())).append("m");
        if (lastLocation.hasAltitude()) {
            sb.append(" 海拔=").append(one.format(lastLocation.getAltitude())).append("m");
        }
        sb.append('\n');
        if (lastLocation.hasSpeed()) {
            sb.append("速度=").append(one.format(lastLocation.getSpeed())).append("m/s ");
        }
        if (lastLocation.hasBearing()) {
            sb.append("行进方向=").append(one.format(lastLocation.getBearing())).append("度 ");
        }
        sb.append("时间=").append(timeFormat.format(lastLocation.getTime())).append("\n\n");
    }

    private void updateMapPreview() {
        DiagnosticTrackPointReader.AscentInputs mapInputs = mapTrackInputs();
        TrackMapState mapState = TrackMapState.build(
                mapInputs.trackPoints, mapFallbackState(), mapInputs.barometerSamples);
        if (mapView != null) {
            mapView.setMapState(mapState.points, referenceTrackPoints, mapState.currentPoint,
                    mapState.accuracyMeters, mapState.headingDegrees,
                    mapState.totalDistanceMeters, mapState.totalAscentMeters);
        }
    }

    private TrackMapState.Fallback mapFallbackState() {
        TrackMapState.Fallback fallback = new TrackMapState.Fallback();
        fallback.foregroundRecording = foregroundServiceRecording;
        fallback.foregroundTotalDistanceMeters = foregroundServiceTotalDistanceMeters;
        fallback.foregroundTotalAscentMeters = foregroundServiceTotalAscentMeters;
        fallback.foregroundHasLocation = foregroundServiceHasLocation;
        fallback.foregroundLatitude = foregroundServiceLatitude;
        fallback.foregroundLongitude = foregroundServiceLongitude;
        fallback.foregroundAccuracyMeters = foregroundServiceAccuracyMeters;
        fallback.foregroundHasBearing = foregroundServiceHasBearing;
        fallback.foregroundBearingDegrees = foregroundServiceBearingDegrees;
        fallback.foregroundHasSpeed = foregroundServiceHasSpeed;
        fallback.foregroundSpeedMetersPerSecond = foregroundServiceSpeedMetersPerSecond;
        fallback.compassHeadingDegrees = headingDegrees;
        fallback.compassHeadingReliable = headingReliability.headingReliable(
                SystemClock.elapsedRealtimeNanos());
        if (lastLocation != null) {
            fallback.hasLastLocation = true;
            fallback.lastLatitude = lastLocation.getLatitude();
            fallback.lastLongitude = lastLocation.getLongitude();
            fallback.lastAccuracyMeters = lastLocation.getAccuracy();
            fallback.lastHasBearing = lastLocation.hasBearing();
            fallback.lastBearingDegrees = lastLocation.hasBearing() ? lastLocation.getBearing() : -1f;
            fallback.lastHasSpeed = lastLocation.hasSpeed();
            fallback.lastSpeedMetersPerSecond = lastLocation.hasSpeed() ? lastLocation.getSpeed() : -1f;
        }
        if (trackSession != null && trackSession.getSessionId() != null) {
            fallback.hasSessionTotalDistance = true;
            fallback.sessionTotalDistanceMeters = trackSession.getTotalDistanceMeters();
        }
        if (latestManifest != null) {
            fallback.hasManifestTotalDistance = true;
            fallback.manifestTotalDistanceMeters = latestManifest.totalDistanceMeters;
        }
        return fallback;
    }

    private void scheduleSatelliteMapViewsInvalidate() {
        if (satelliteMapInvalidateScheduled) {
            return;
        }
        satelliteMapInvalidateScheduled = true;
        mainHandler.postDelayed(() -> {
            satelliteMapInvalidateScheduled = false;
            invalidateVisibleSatelliteMapView();
        }, SATELLITE_TILE_INVALIDATE_COALESCE_MILLIS);
    }

    private void invalidateVisibleSatelliteMapView() {
        if (mapView != null) {
            mapView.postInvalidateOnAnimation();
        }
    }

    private List<TrackPoint> mapTrackPoints() {
        return mapTrackInputs().trackPoints;
    }

    private DiagnosticTrackPointReader.AscentInputs mapTrackInputs() {
        if (foregroundServiceRecording) {
            if (!foregroundServiceTrackPoints.isEmpty()) {
                return new DiagnosticTrackPointReader.AscentInputs(
                        new ArrayList<>(foregroundServiceTrackPoints), new ArrayList<>());
            }
            return new DiagnosticTrackPointReader.AscentInputs(new ArrayList<>(), new ArrayList<>());
        }
        if (trackSession != null && trackSession.getSessionId() != null) {
            List<TrackPoint> points = trackSession.getTrackPoints();
            points.addAll(trackSession.getWeakTrackPoints());
            points.addAll(trackSession.getTransportTrackPoints());
            sortMapTrackPoints(points);
            return new DiagnosticTrackPointReader.AscentInputs(
                    points, trackSession.getBarometerAscentSamples());
        }
        if (latestManifest != null && latestManifest.diagnosticLogExists
                && (latestManifest.trackPointCount > 0 || latestManifest.weakTrackPointCount > 0)) {
            return historicalMapTrackInputs(latestManifest);
        }
        return new DiagnosticTrackPointReader.AscentInputs(new ArrayList<>(), new ArrayList<>());
    }

    private List<TrackPoint> historicalMapTrackPoints(SessionManifest manifest) {
        return historicalMapTrackInputs(manifest).trackPoints;
    }

    private TrackAscentCalculator.Result cachedHistoricalAscentResult(SessionManifest manifest) {
        if (historicalAscentDestroyed || manifest == null || !manifest.diagnosticLogExists) {
            return null;
        }
        String cacheKey = historicalAscentCacheKey(manifest);
        TrackAscentCalculator.Result cachedResult = cachedHistoricalAscentResults.get(cacheKey);
        if (cachedResult != null) {
            return cachedResult;
        }
        if (failedHistoricalAscentCacheKeys.contains(cacheKey)) {
            return null;
        }
        scheduleHistoricalAscentResult(manifest, cacheKey);
        return null;
    }

    private void scheduleHistoricalAscentResult(SessionManifest manifest, String cacheKey) {
        if (historicalAscentDestroyed || historicalAscentExecutor.isShutdown()) {
            return;
        }
        if (!pendingHistoricalAscentCacheKeys.add(cacheKey)) {
            return;
        }
        final long generation = historicalAscentCacheGeneration;
        try {
            historicalAscentExecutor.execute(() -> {
                final TrackAscentCalculator.Result result = readHistoricalAscentResult(manifest);
                mainHandler.post(() -> {
                    if (historicalAscentDestroyed
                            || generation != historicalAscentCacheGeneration) {
                        return;
                    }
                    pendingHistoricalAscentCacheKeys.remove(cacheKey);
                    if (result != null) {
                        cachedHistoricalAscentResults.put(cacheKey, result);
                    } else {
                        failedHistoricalAscentCacheKeys.add(cacheKey);
                    }
                    scheduleHistoricalAscentRowsRefresh();
                });
            });
        } catch (RejectedExecutionException ignored) {
            pendingHistoricalAscentCacheKeys.remove(cacheKey);
        }
    }

    private TrackAscentCalculator.Result readHistoricalAscentResult(SessionManifest manifest) {
        if (manifest == null || !manifest.diagnosticLogExists) {
            return null;
        }
        try {
            DiagnosticTrackPointReader.AscentInputs inputs =
                    new DiagnosticTrackPointReader().readDisplayAscentInputs(
                            new File(manifest.sessionDir, manifest.diagnosticLogFileName));
            sortMapTrackPoints(inputs.trackPoints);
            return TrackAscentCalculator.ascentResult(inputs.trackPoints, inputs.barometerSamples);
        } catch (IOException | JSONException ignored) {
            return null;
        }
    }

    private void scheduleHistoricalAscentRowsRefresh() {
        if (historicalAscentDestroyed) {
            return;
        }
        if (historicalAscentRefreshScheduled) {
            return;
        }
        historicalAscentRefreshScheduled = true;
        mainHandler.post(() -> {
            if (historicalAscentDestroyed) {
                return;
            }
            historicalAscentRefreshScheduled = false;
            updateHistoryActionRows();
        });
    }

    private String historicalAscentCacheKey(SessionManifest manifest) {
        String sessionId = manifest.sessionId == null ? "" : manifest.sessionId;
        return sessionId + "|" + manifest.lastEventSeq + "|" + manifest.diagnosticLogBytes;
    }

    private DiagnosticTrackPointReader.AscentInputs historicalMapTrackInputs(
            SessionManifest manifest) {
        if (isHistoricalMapCacheValid(manifest)) {
            return new DiagnosticTrackPointReader.AscentInputs(
                    new ArrayList<>(cachedHistoricalMapPoints),
                    new ArrayList<>(cachedHistoricalBarometerSamples));
        }
        cachedHistoricalMapSessionId = manifest.sessionId == null ? "" : manifest.sessionId;
        cachedHistoricalMapLastEventSeq = manifest.lastEventSeq;
        cachedHistoricalMapDiagnosticBytes = manifest.diagnosticLogBytes;
        cachedHistoricalMapPoints.clear();
        cachedHistoricalBarometerSamples.clear();
        try {
            DiagnosticTrackPointReader.AscentInputs inputs =
                    new DiagnosticTrackPointReader().readDisplayAscentInputs(
                    new File(manifest.sessionDir, manifest.diagnosticLogFileName));
            List<TrackPoint> points = inputs.trackPoints;
            sortMapTrackPoints(points);
            cachedHistoricalMapPoints.addAll(points);
            cachedHistoricalBarometerSamples.addAll(inputs.barometerSamples);
        } catch (IOException | JSONException ignored) {
            cachedHistoricalMapPoints.clear();
            cachedHistoricalBarometerSamples.clear();
        }
        return new DiagnosticTrackPointReader.AscentInputs(
                new ArrayList<>(cachedHistoricalMapPoints),
                new ArrayList<>(cachedHistoricalBarometerSamples));
    }

    private boolean isHistoricalMapCacheValid(SessionManifest manifest) {
        return manifest != null
                && manifest.sessionId != null
                && manifest.sessionId.equals(cachedHistoricalMapSessionId)
                && manifest.lastEventSeq == cachedHistoricalMapLastEventSeq
                && manifest.diagnosticLogBytes == cachedHistoricalMapDiagnosticBytes;
    }

    private void invalidateHistoricalMapCache() {
        cachedHistoricalMapSessionId = "";
        cachedHistoricalMapLastEventSeq = -1L;
        cachedHistoricalMapDiagnosticBytes = -1L;
        cachedHistoricalMapPoints.clear();
        cachedHistoricalBarometerSamples.clear();
    }

    private void invalidateHistoricalAscentCache() {
        historicalAscentCacheGeneration++;
        cachedHistoricalAscentResults.clear();
        pendingHistoricalAscentCacheKeys.clear();
        failedHistoricalAscentCacheKeys.clear();
        historicalAscentRefreshScheduled = false;
    }

    private void sortMapTrackPoints(List<TrackPoint> points) {
        Collections.sort(points, new Comparator<TrackPoint>() {
            @Override
            public int compare(TrackPoint left, TrackPoint right) {
                int byTime = Long.compare(left.elapsedRealtimeNanos, right.elapsedRealtimeNanos);
                if (byTime != 0) {
                    return byTime;
                }
                return Long.compare(left.sourceRawPointId, right.sourceRawPointId);
            }
        });
    }

    private class NativeTrackMapView extends View {
        private static final double MAX_MERCATOR_LATITUDE = 85.05112878d;
        private static final double EARTH_CIRCUMFERENCE_METERS = 40_075_016.686d;
        private static final int TILE_SIZE_PIXELS = 256;
        private static final int MIN_SATELLITE_ZOOM = 2;
        private static final int MAX_SATELLITE_TILE_ZOOM = 18;
        private static final int MAX_SATELLITE_VIEW_ZOOM = 22;
        private static final int MAX_TILE_REQUESTS_PER_DRAW = 6;
        private static final int MAX_ACTIVE_SATELLITE_TILE_REQUESTS = 18;
        private static final int FLING_SCROLL_RANGE_PIXELS = 100_000;
        private static final int MIN_FLING_VELOCITY_PIXELS_PER_SECOND = 150;
        private static final int MAX_FLING_VELOCITY_PIXELS_PER_SECOND = 6_000;
        private static final int TAP_SLOP_DP = 8;
        private static final double MIN_FRAME_WORLD_RANGE = 0.000006d;
        private static final int FRAME_PADDING_DP = 2;

        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path trackPath = new Path();
        private final Path mapClipPath = new Path();
        private final RectF viewBounds = new RectF();
        private final PointF lastTouchPoint = new PointF();
        private final List<TrackPoint> points = new ArrayList<>();
        private final List<ReferenceTrackPoint> referencePoints = new ArrayList<>();
        private final OverScroller mapScroller;

        private boolean interactive;
        private boolean frameNextUpdate = true;
        private boolean hasFrame;
        private MapPoint currentPoint;
        private float accuracyMeters;
        private float heading;
        private double totalDistanceMeters;
        private double totalAscentMeters = -1.0;
        private double centerX;
        private double centerY;
        private double scale = 1d;
        private float panX;
        private float panY;
        private float lastPinchDistance;
        private float touchStartX;
        private float touchStartY;
        private float flingStartPanX;
        private float flingStartPanY;
        private boolean tapCandidate;
        private VelocityTracker velocityTracker;
        private Runnable mapTapListener;

        NativeTrackMapView(Context context) {
            super(context);
            mapScroller = new OverScroller(context);
            setFocusable(false);
        }

        void setInteractive(boolean interactive) {
            this.interactive = interactive;
        }

        void setOnMapTapListener(Runnable listener) {
            mapTapListener = listener;
        }

        void requestFrameNextUpdate() {
            frameNextUpdate = true;
            hasFrame = false;
            panX = 0f;
            panY = 0f;
            stopMapFling();
            satelliteTileLoader.clearFailures();
            invalidate();
        }

        boolean centerOnCurrentLocation() {
            if (currentPoint == null) {
                return false;
            }
            MapPoint displayPoint = toDisplayMapPoint(currentPoint.latitude, currentPoint.longitude);
            centerX = mercatorX(displayPoint.longitude);
            centerY = mercatorY(displayPoint.latitude);
            panX = 0f;
            panY = 0f;
            hasFrame = true;
            frameNextUpdate = false;
            stopMapFling();
            invalidate();
            return true;
        }

        void setMapState(List<TrackPoint> nextPoints,
                         List<ReferenceTrackPoint> nextReferencePoints,
                         MapPoint nextCurrentPoint, float nextAccuracyMeters,
                         float nextHeading, double nextTotalDistanceMeters,
                         double nextTotalAscentMeters) {
            points.clear();
            if (nextPoints != null) {
                points.addAll(nextPoints);
            }
            referencePoints.clear();
            if (nextReferencePoints != null) {
                referencePoints.addAll(nextReferencePoints);
            }
            currentPoint = nextCurrentPoint;
            accuracyMeters = Math.max(0f, nextAccuracyMeters);
            heading = nextHeading;
            totalDistanceMeters = Math.max(0.0, nextTotalDistanceMeters);
            totalAscentMeters = nextTotalAscentMeters;
            if (!interactive || frameNextUpdate || !hasFrame) {
                frameToData();
            }
            invalidate();
        }

        @Override
        protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            requestFrameNextUpdate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            viewBounds.set(0f, 0f, getWidth(), getHeight());
            drawBase(canvas);
            drawReferenceTrack(canvas);
            drawTrack(canvas);
            drawCurrentLocation(canvas);
            drawHud(canvas);
        }

        @Override
        public void computeScroll() {
            if (mapScroller.computeScrollOffset()) {
                panX = flingStartPanX + mapScroller.getCurrX();
                panY = flingStartPanY + mapScroller.getCurrY();
                hasFrame = true;
                frameNextUpdate = false;
                postInvalidateOnAnimation();
            }
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            if (!interactive) {
                return false;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                stopMapFling();
                recycleVelocityTracker();
                velocityTracker = VelocityTracker.obtain();
            }
            if (velocityTracker != null && event.getPointerCount() == 1) {
                velocityTracker.addMovement(event);
            }
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    touchStartX = event.getX();
                    touchStartY = event.getY();
                    tapCandidate = true;
                    lastTouchPoint.set(event.getX(), event.getY());
                    lastPinchDistance = 0f;
                    return true;
                case MotionEvent.ACTION_POINTER_DOWN:
                    tapCandidate = false;
                    stopMapFling();
                    recycleVelocityTracker();
                    lastPinchDistance = pinchDistance(event);
                    pinchCenter(event, lastTouchPoint);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (event.getPointerCount() >= 2) {
                        tapCandidate = false;
                        float nextDistance = pinchDistance(event);
                        if (lastPinchDistance > 0f && nextDistance > 0f) {
                            float factor = nextDistance / lastPinchDistance;
                            double nextScale = clampSatelliteScale(scale * factor);
                            float appliedFactor = scale > 0d ? (float) (nextScale / scale) : factor;
                            PointF nextCenter = new PointF();
                            pinchCenter(event, nextCenter);
                            panX = nextCenter.x - getWidth() / 2f
                                    - (lastTouchPoint.x - getWidth() / 2f - panX) * appliedFactor;
                            panY = nextCenter.y - getHeight() / 2f
                                    - (lastTouchPoint.y - getHeight() / 2f - panY) * appliedFactor;
                            scale = nextScale;
                            lastPinchDistance = nextDistance;
                            lastTouchPoint.set(nextCenter);
                            hasFrame = true;
                            frameNextUpdate = false;
                            invalidate();
                        }
                    } else {
                        if (tapCandidate && movedBeyondTapSlop(event.getX(), event.getY())) {
                            tapCandidate = false;
                        }
                        panX += event.getX() - lastTouchPoint.x;
                        panY += event.getY() - lastTouchPoint.y;
                        lastTouchPoint.set(event.getX(), event.getY());
                        hasFrame = true;
                        frameNextUpdate = false;
                        invalidate();
                    }
                    return true;
                case MotionEvent.ACTION_POINTER_UP:
                    tapCandidate = false;
                    updateTouchAnchorAfterPointerUp(event);
                    if (event.getPointerCount() - 1 != 1) {
                        recycleVelocityTracker();
                    } else {
                        velocityTracker = VelocityTracker.obtain();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (tapCandidate && mapTapListener != null) {
                        recycleVelocityTracker();
                        performClick();
                        lastPinchDistance = 0f;
                        mapTapListener.run();
                        tapCandidate = false;
                        return true;
                    }
                    startMapFlingIfNeeded();
                    recycleVelocityTracker();
                    performClick();
                    lastPinchDistance = 0f;
                    tapCandidate = false;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    stopMapFling();
                    recycleVelocityTracker();
                    performClick();
                    lastPinchDistance = 0f;
                    tapCandidate = false;
                    return true;
                default:
                    return true;
            }
        }

        @Override
        public boolean performClick() {
            super.performClick();
            return true;
        }

        @Override
        protected void onDetachedFromWindow() {
            super.onDetachedFromWindow();
        }

        private void drawBase(Canvas canvas) {
            canvas.drawColor(Color.rgb(18, 24, 33));
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(23, 33, 45));
            canvas.drawRoundRect(viewBounds, dp(8), dp(8), paint);
            mapClipPath.reset();
            mapClipPath.addRoundRect(viewBounds, dp(8), dp(8), Path.Direction.CW);
            int saveCount = canvas.save();
            canvas.clipPath(mapClipPath);
            drawSatelliteTiles(canvas);
            canvas.restoreToCount(saveCount);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setColor(Color.argb(150, 148, 163, 184));
            canvas.drawRoundRect(viewBounds, dp(8), dp(8), paint);
        }

        private void drawSatelliteTiles(Canvas canvas) {
            if (getWidth() <= 0 || getHeight() <= 0 || scale <= 0d) {
                return;
            }
            int viewZoom = satelliteZoom();
            int tileZoom = satelliteTileZoom(viewZoom);
            int tileCount = 1 << tileZoom;
            double left = centerX + (0d - getWidth() / 2d - panX) / scale;
            double top = centerY + (0d - getHeight() / 2d - panY) / scale;
            double right = centerX + (getWidth() - getWidth() / 2d - panX) / scale;
            double bottom = centerY + (getHeight() - getHeight() / 2d - panY) / scale;
            int minX = (int) Math.floor(left * tileCount) - 1;
            int maxX = (int) Math.floor(right * tileCount) + 1;
            int minY = Math.max(0, (int) Math.floor(top * tileCount) - 1);
            int maxY = Math.min(tileCount - 1, (int) Math.floor(bottom * tileCount) + 1);

            paint.setFilterBitmap(true);
            List<SatelliteTileRequest> missingTiles = new ArrayList<>();
            float screenCenterX = getWidth() / 2f;
            float screenCenterY = getHeight() / 2f;
            for (int tileY = minY; tileY <= maxY; tileY++) {
                for (int tileX = minX; tileX <= maxX; tileX++) {
                    int wrappedX = wrapTileX(tileX, tileCount);
                    RectF tileRect = tileToScreenRect(tileX, tileY, tileCount);
                    String key = tileZoom + "/" + wrappedX + "/" + tileY;
                    Bitmap bitmap = satelliteTileLoader.get(key);
                    if (bitmap != null && !bitmap.isRecycled()) {
                        canvas.drawBitmap(bitmap, null, tileRect, paint);
                    } else {
                        drawParentSatelliteTileFallback(canvas, tileZoom, wrappedX, tileY, tileRect);
                        float tileCenterX = tileRect.centerX();
                        float tileCenterY = tileRect.centerY();
                        double priority = Math.pow(tileCenterX - screenCenterX, 2d)
                                + Math.pow(tileCenterY - screenCenterY, 2d);
                        SatelliteTileRequest parentRequest = parentSatelliteTileRequest(
                                tileZoom, wrappedX, tileY, priority - 0.5d);
                        if (parentRequest != null) {
                            missingTiles.add(parentRequest);
                        }
                        missingTiles.add(new SatelliteTileRequest(
                                tileZoom, wrappedX, tileY, key, priority));
                    }
                }
            }
            paint.setFilterBitmap(false);
            requestVisibleSatelliteTiles(missingTiles);
        }

        private void requestVisibleSatelliteTiles(List<SatelliteTileRequest> missingTiles) {
            if (missingTiles.isEmpty()) {
                return;
            }
            Collections.sort(missingTiles, Comparator.comparingDouble(tile -> tile.priority));
            satelliteTileLoader.requestVisibleTiles(missingTiles, MAX_TILE_REQUESTS_PER_DRAW,
                    MAX_ACTIVE_SATELLITE_TILE_REQUESTS);
        }

        private boolean drawParentSatelliteTileFallback(Canvas canvas, int zoom, int tileX,
                                                        int tileY, RectF tileRect) {
            if (zoom <= MIN_SATELLITE_ZOOM || tileY < 0) {
                return false;
            }
            for (int parentZoom = zoom - 1; parentZoom >= MIN_SATELLITE_ZOOM; parentZoom--) {
                int zoomDelta = zoom - parentZoom;
                int divisor = 1 << zoomDelta;
                int parentTileCount = 1 << parentZoom;
                int parentX = wrapTileX(tileX / divisor, parentTileCount);
                int parentY = tileY / divisor;
                if (parentY < 0 || parentY >= parentTileCount) {
                    continue;
                }
                String parentKey = parentZoom + "/" + parentX + "/" + parentY;
                Bitmap parentBitmap = satelliteTileLoader.get(parentKey);
                if (parentBitmap == null || parentBitmap.isRecycled()) {
                    continue;
                }
                int segmentWidth = Math.max(1, parentBitmap.getWidth() / divisor);
                int segmentHeight = Math.max(1, parentBitmap.getHeight() / divisor);
                int sourceLeft = (tileX & (divisor - 1)) * segmentWidth;
                int sourceTop = (tileY & (divisor - 1)) * segmentHeight;
                Rect source = new Rect(sourceLeft, sourceTop,
                        Math.min(parentBitmap.getWidth(), sourceLeft + segmentWidth),
                        Math.min(parentBitmap.getHeight(), sourceTop + segmentHeight));
                canvas.drawBitmap(parentBitmap, source, tileRect, paint);
                return true;
            }
            return false;
        }

        private SatelliteTileRequest parentSatelliteTileRequest(int zoom, int tileX, int tileY,
                                                                double priority) {
            if (zoom <= MIN_SATELLITE_ZOOM || tileY < 0) {
                return null;
            }
            int parentZoom = zoom - 1;
            int parentTileCount = 1 << parentZoom;
            int parentX = wrapTileX(tileX / 2, parentTileCount);
            int parentY = tileY / 2;
            if (parentY < 0 || parentY >= parentTileCount) {
                return null;
            }
            String parentKey = parentZoom + "/" + parentX + "/" + parentY;
            Bitmap parentBitmap = satelliteTileLoader.get(parentKey);
            if (parentBitmap != null && !parentBitmap.isRecycled()) {
                return null;
            }
            return new SatelliteTileRequest(parentZoom, parentX, parentY, parentKey, priority);
        }

        private int satelliteZoom() {
            if (scale <= 0d || Double.isNaN(scale) || Double.isInfinite(scale)) {
                return MIN_SATELLITE_ZOOM;
            }
            double rawZoom = Math.log(scale / TILE_SIZE_PIXELS) / Math.log(2d);
            int zoom = (int) Math.round(rawZoom);
            return Math.max(MIN_SATELLITE_ZOOM, Math.min(MAX_SATELLITE_VIEW_ZOOM, zoom));
        }

        private int satelliteTileZoom(int viewZoom) {
            return Math.max(MIN_SATELLITE_ZOOM,
                    Math.min(MAX_SATELLITE_TILE_ZOOM, viewZoom));
        }

        private double clampSatelliteScale(double value) {
            if (Double.isNaN(value) || Double.isInfinite(value)) {
                return TILE_SIZE_PIXELS * Math.pow(2d, MIN_SATELLITE_ZOOM);
            }
            double minScale = TILE_SIZE_PIXELS * Math.pow(2d, MIN_SATELLITE_ZOOM);
            double maxScale = TILE_SIZE_PIXELS * Math.pow(2d, MAX_SATELLITE_VIEW_ZOOM);
            return Math.max(minScale, Math.min(maxScale, value));
        }

        private RectF tileToScreenRect(int tileX, int tileY, int tileCount) {
            double tileWorldSize = 1d / tileCount;
            float left = (float) ((tileX * tileWorldSize - centerX) * scale
                    + getWidth() / 2f + panX);
            float top = (float) ((tileY * tileWorldSize - centerY) * scale
                    + getHeight() / 2f + panY);
            float size = (float) (tileWorldSize * scale);
            return new RectF(left, top, left + size, top + size);
        }

        private void drawTilePlaceholder(Canvas canvas, RectF tileRect) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(22, 31, 44));
            canvas.drawRect(tileRect, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setColor(Color.rgb(37, 50, 67));
            canvas.drawRect(tileRect, paint);
        }

        private int wrapTileX(int tileX, int tileCount) {
            int wrapped = tileX % tileCount;
            return wrapped < 0 ? wrapped + tileCount : wrapped;
        }

        private void drawReferenceTrack(Canvas canvas) {
            if (referencePoints.size() < 2) {
                return;
            }
            trackPath.reset();
            int previousSegment = Integer.MIN_VALUE;
            for (ReferenceTrackPoint point : referencePoints) {
                PointF screen = toScreen(point.latitude, point.longitude);
                if (point.segmentIndex != previousSegment) {
                    trackPath.moveTo(screen.x, screen.y);
                    previousSegment = point.segmentIndex;
                } else {
                    trackPath.lineTo(screen.x, screen.y);
                }
            }
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeWidth(dp(7));
            paint.setColor(Color.argb(115, 168, 85, 247));
            canvas.drawPath(trackPath, paint);
            paint.setStrokeWidth(dp(3));
            paint.setColor(Color.rgb(216, 180, 254));
            canvas.drawPath(trackPath, paint);
            paint.setStrokeCap(Paint.Cap.BUTT);
            drawReferenceTimeMarkers(canvas);
        }

        private void drawReferenceTimeMarkers(Canvas canvas) {
            ReferenceTrackPoint previous = null;
            long nextMarkerTimeMillis = 0L;
            for (ReferenceTrackPoint point : referencePoints) {
                if (point.timeMillis <= 0L) {
                    continue;
                }
                if (previous == null || point.segmentIndex != previous.segmentIndex) {
                    previous = point;
                    nextMarkerTimeMillis = point.timeMillis
                            + TRACK_TIME_MARKER_INTERVAL_NANOS / 1_000_000L;
                    continue;
                }
                if (point.timeMillis <= previous.timeMillis) {
                    previous = point;
                    continue;
                }
                while (nextMarkerTimeMillis <= point.timeMillis) {
                    if (nextMarkerTimeMillis >= previous.timeMillis) {
                        drawReferenceTimeMarker(canvas, previous, point, nextMarkerTimeMillis);
                    }
                    nextMarkerTimeMillis += TRACK_TIME_MARKER_INTERVAL_NANOS / 1_000_000L;
                }
                previous = point;
            }
        }

        private void drawReferenceTimeMarker(Canvas canvas, ReferenceTrackPoint from,
                                             ReferenceTrackPoint to, long markerTimeMillis) {
            double fraction = (double) (markerTimeMillis - from.timeMillis)
                    / (double) (to.timeMillis - from.timeMillis);
            fraction = Math.max(0d, Math.min(1d, fraction));
            double latitude = from.latitude + (to.latitude - from.latitude) * fraction;
            double longitude = from.longitude + (to.longitude - from.longitude) * fraction;
            PointF screen = toScreen(latitude, longitude);
            drawTimeMarkerLabel(canvas, screen.x, screen.y,
                    timeFormat.format(new Date(markerTimeMillis)),
                    Color.rgb(168, 85, 247));
        }

        private void drawTrack(Canvas canvas) {
            if (drawableTrackPointCount() < 2) {
                drawWeakTrackPoints(canvas);
                drawTransportTrackPoints(canvas);
                return;
            }
            drawTrackSegments(canvas, false);
            drawTrackSegments(canvas, true);
            drawWeakTrackPoints(canvas);
            drawTransportTrackPoints(canvas);
            drawTrackTimeMarkers(canvas);
        }

        private void drawTrackSegments(Canvas canvas, boolean transport) {
            trackPath.reset();
            boolean hasSegment = false;
            TrackPoint previous = null;
            for (int i = 0; i < points.size(); i++) {
                TrackPoint point = points.get(i);
                if (isWeakTrackPoint(point)) {
                    continue;
                }
                if (previous != null && isTransportSegment(previous, point) == transport) {
                    PointF from = toScreen(previous.latitude, previous.longitude);
                    PointF to = toScreen(point.latitude, point.longitude);
                    trackPath.moveTo(from.x, from.y);
                    trackPath.lineTo(to.x, to.y);
                    hasSegment = true;
                }
                previous = point;
            }
            if (!hasSegment) {
                return;
            }
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeWidth(dp(transport ? 9 : 8));
            paint.setColor(transport
                    ? Color.argb(115, 127, 29, 29)
                    : Color.argb(95, 14, 165, 233));
            canvas.drawPath(trackPath, paint);
            paint.setStrokeWidth(dp(transport ? 5 : 4));
            paint.setColor(transport
                    ? Color.rgb(239, 68, 68)
                    : Color.rgb(56, 189, 248));
            canvas.drawPath(trackPath, paint);
            paint.setStrokeCap(Paint.Cap.BUTT);
        }

        private void drawWeakTrackPoints(Canvas canvas) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(170, 250, 204, 21));
            for (TrackPoint point : points) {
                if (!isWeakTrackPoint(point)) {
                    continue;
                }
                PointF screen = toScreen(point.latitude, point.longitude);
                canvas.drawCircle(screen.x, screen.y, dp(4), paint);
            }
        }

        private void drawTransportTrackPoints(Canvas canvas) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.rgb(239, 68, 68));
            for (TrackPoint point : points) {
                if (!isTransportTravelPoint(point)) {
                    continue;
                }
                PointF screen = toScreen(point.latitude, point.longitude);
                canvas.drawCircle(screen.x, screen.y, dp(3), paint);
            }
        }

        private void drawTrackTimeMarkers(Canvas canvas) {
            TrackPoint previousTrustedPoint = null;
            long firstTrackTimeNanos = 0L;
            long nextMarkerTimeNanos = 0L;
            for (TrackPoint point : points) {
                if (!isTrustedTimeMarkerPoint(point)) {
                    continue;
                }
                long pointTimeNanos = markerTimelineNanos(point);
                if (pointTimeNanos <= 0L) {
                    continue;
                }
                if (previousTrustedPoint == null) {
                    firstTrackTimeNanos = pointTimeNanos;
                    nextMarkerTimeNanos = firstTrackTimeNanos + TRACK_TIME_MARKER_INTERVAL_NANOS;
                    previousTrustedPoint = point;
                    continue;
                }
                long previousTimeNanos = markerTimelineNanos(previousTrustedPoint);
                if (previousTimeNanos <= 0L || pointTimeNanos <= previousTimeNanos) {
                    previousTrustedPoint = point;
                    continue;
                }
                while (nextMarkerTimeNanos <= pointTimeNanos) {
                    if (nextMarkerTimeNanos >= previousTimeNanos) {
                        drawTrackTimeMarker(canvas, previousTrustedPoint, point,
                                previousTimeNanos, pointTimeNanos, nextMarkerTimeNanos);
                    }
                    nextMarkerTimeNanos += TRACK_TIME_MARKER_INTERVAL_NANOS;
                }
                previousTrustedPoint = point;
            }
        }

        private boolean isTrustedTimeMarkerPoint(TrackPoint point) {
            return !isWeakTrackPoint(point) && !isTransportTravelPoint(point);
        }

        private long markerTimelineNanos(TrackPoint point) {
            if (point.elapsedRealtimeNanos > 0L) {
                return point.elapsedRealtimeNanos;
            }
            return point.timeMillis > 0L ? point.timeMillis * 1_000_000L : 0L;
        }

        private void drawTrackTimeMarker(Canvas canvas, TrackPoint from, TrackPoint to,
                                         long fromTimeNanos, long toTimeNanos,
                                         long markerTimeNanos) {
            double fraction = (double) (markerTimeNanos - fromTimeNanos)
                    / (double) (toTimeNanos - fromTimeNanos);
            fraction = Math.max(0d, Math.min(1d, fraction));
            double latitude = from.latitude + (to.latitude - from.latitude) * fraction;
            double longitude = from.longitude + (to.longitude - from.longitude) * fraction;
            PointF screen = toScreen(latitude, longitude);
            long markerWallTimeMillis = from.timeMillis
                    + Math.round((to.timeMillis - from.timeMillis) * fraction);
            String label = timeFormat.format(new Date(markerWallTimeMillis));
            drawTimeMarkerLabel(canvas, screen.x, screen.y, label, Color.rgb(14, 165, 233));
        }

        private void drawTimeMarkerLabel(Canvas canvas, float x, float y, String label,
                                         int markerColor) {
            float radius = dp(5);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(235, 255, 255, 255));
            canvas.drawCircle(x, y, radius, paint);
            paint.setColor(markerColor);
            canvas.drawCircle(x, y, dp(3), paint);

            paint.setTextSize(dp(10));
            float textWidth = paint.measureText(label);
            float paddingX = dp(5);
            float paddingY = dp(3);
            float labelHeight = dp(16);
            float labelLeft = clamp(x - textWidth / 2f - paddingX, dp(4),
                    Math.max(dp(4), getWidth() - textWidth - paddingX * 2f - dp(4)));
            float labelTop = y - radius - dp(5) - labelHeight;
            if (labelTop < pageTopPadding() + dp(4)) {
                labelTop = y + radius + dp(5);
            }
            viewBounds.set(labelLeft, labelTop,
                    labelLeft + textWidth + paddingX * 2f, labelTop + labelHeight);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(205, 15, 23, 42));
            canvas.drawRoundRect(viewBounds, dp(4), dp(4), paint);
            paint.setColor(Color.rgb(226, 232, 240));
            canvas.drawText(label, labelLeft + paddingX, labelTop + labelHeight - paddingY - dp(2),
                    paint);
        }

        private int trustedPointCount() {
            int count = 0;
            for (TrackPoint point : points) {
                if (!isWeakTrackPoint(point) && !isTransportTravelPoint(point)) {
                    count++;
                }
            }
            return count;
        }

        private int drawableTrackPointCount() {
            int count = 0;
            for (TrackPoint point : points) {
                if (!isWeakTrackPoint(point)) {
                    count++;
                }
            }
            return count;
        }

        private boolean isWeakTrackPoint(TrackPoint point) {
            return "weak".equals(point.decisionResult);
        }

        private boolean isTransportSegment(TrackPoint from, TrackPoint to) {
            return isTransportTravelPoint(from)
                    || isTransportTravelPoint(to)
                    || isTransportRecoveryPoint(to);
        }

        private boolean isTransportTravelPoint(TrackPoint point) {
            return "transport".equals(point.decisionResult)
                    || "transport_suspected".equals(point.decisionReason);
        }

        private boolean isTransportRecoveryPoint(TrackPoint point) {
            return "gap_recovery".equals(point.decisionReason);
        }

        private void drawCurrentLocation(Canvas canvas) {
            MapPoint point = currentPoint;
            boolean hasCurrentLocation = point != null;
            if (point == null) {
                return;
            }
            PointF screen = toScreen(point.latitude, point.longitude);
            float accuracyRadius = hasCurrentLocation ? accuracyRadiusPixels(point.latitude) : 0f;
            if (accuracyRadius > 1f) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(Color.argb(55, 96, 165, 250));
                canvas.drawCircle(screen.x, screen.y, Math.min(accuracyRadius, getWidth()), paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(1.5f);
                paint.setColor(Color.argb(145, 147, 197, 253));
                canvas.drawCircle(screen.x, screen.y, Math.min(accuracyRadius, getWidth()), paint);
            }
            if (hasCurrentLocation && !Float.isNaN(heading)) {
                drawHeading(canvas, screen.x, screen.y, heading);
            }
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(screen.x, screen.y, dp(7), paint);
            paint.setColor(Color.rgb(37, 99, 235));
            canvas.drawCircle(screen.x, screen.y, dp(4), paint);
        }

        private void drawHeading(Canvas canvas, float x, float y, float degrees) {
            float tipRadius = dp(23);
            float baseRadius = dp(4);
            float halfBaseWidth = dp(5);
            double radians = Math.toRadians(degrees - 90f);
            float directionX = (float) Math.cos(radians);
            float directionY = (float) Math.sin(radians);
            float normalX = -directionY;
            float normalY = directionX;
            float tipX = x + directionX * tipRadius;
            float tipY = y + directionY * tipRadius;
            float baseCenterX = x + directionX * baseRadius;
            float baseCenterY = y + directionY * baseRadius;
            float leftX = baseCenterX + normalX * halfBaseWidth;
            float leftY = baseCenterY + normalY * halfBaseWidth;
            float rightX = baseCenterX - normalX * halfBaseWidth;
            float rightY = baseCenterY - normalY * halfBaseWidth;
            Path arrow = new Path();
            arrow.moveTo(tipX, tipY);
            arrow.lineTo(leftX, leftY);
            arrow.quadTo(x, y, rightX, rightY);
            arrow.close();
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeWidth(dp(2));
            paint.setColor(Color.argb(235, 255, 255, 255));
            canvas.drawPath(arrow, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(225, 37, 99, 235));
            canvas.drawPath(arrow, paint);
            paint.setStrokeJoin(Paint.Join.MITER);
            paint.setStrokeCap(Paint.Cap.BUTT);
        }

        private void drawHud(Canvas canvas) {
            float left = dp(10);
            float top = pageTopPadding() + dp(4);
            float width = Math.min(getWidth() - dp(22), dp(184));
            float lineHeight = dp(15);
            float paddingX = dp(8);
            float paddingY = dp(7);
            float hudHeight = paddingY * 2 + lineHeight * 5;
            viewBounds.set(left, top, left + width, top + hudHeight);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(165, 17, 24, 39));
            canvas.drawRoundRect(viewBounds, dp(6), dp(6), paint);

            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(dp(11));
            paint.setColor(Color.argb(220, 229, 231, 235));
            String distanceLine = "里程：" + formatDistance(totalDistanceMeters)
                    + "  爬升：" + formatAscent(totalAscentMeters);
            String trackLine = points.isEmpty()
                    ? "轨迹：等待可信点"
                    : "轨迹：可信 " + trustedPointCount() + " 点 / 弱信号 " + weakPointCount() + " 点";
            if (!referencePoints.isEmpty()) {
                trackLine += " / 参考路线";
            }
            float textX = left + paddingX;
            float baseline = top + paddingY + dp(11);
            float textWidth = width - paddingX * 2;
            canvas.drawText(fitHudText(distanceLine, textWidth), textX, baseline, paint);
            baseline += lineHeight;
            drawGpsHudLine(canvas, textX, baseline, textWidth);
            baseline += lineHeight;
            canvas.drawText(fitHudText(satelliteHudText(), textWidth), textX, baseline, paint);
            baseline += lineHeight;
            canvas.drawText(fitHudText(trackLine, textWidth), textX, baseline, paint);
            baseline += lineHeight;
            canvas.drawText(fitHudText(barometerHudText(), textWidth), textX, baseline, paint);
        }

        private void drawGpsHudLine(Canvas canvas, float textX, float baseline, float textWidth) {
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(dp(11));
            paint.setColor(Color.argb(220, 229, 231, 235));
            String prefix = "GPS：";
            canvas.drawText(prefix, textX, baseline, paint);
            float barsX = textX + paint.measureText(prefix);
            drawGpsSignalBars(canvas, barsX, baseline, gpsSignalLevel());
            float signalX = barsX + dp(27);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(dp(11));
            paint.setColor(Color.argb(220, 229, 231, 235));
            canvas.drawText(fitHudText(gpsSignalText(), textWidth - (signalX - textX)),
                    signalX, baseline, paint);
        }

        private void drawGpsSignalBars(Canvas canvas, float left, float baseline, int level) {
            float barWidth = dp(3);
            float gap = dp(2);
            float bottom = baseline - dp(2);
            int activeColor = level >= 3
                    ? Color.rgb(74, 222, 128)
                    : (level == 2 ? Color.rgb(250, 204, 21) : Color.rgb(251, 146, 60));
            for (int i = 0; i < 4; i++) {
                float height = dp(4 + i * 3);
                float x = left + i * (barWidth + gap);
                viewBounds.set(x, bottom - height, x + barWidth, bottom);
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(i < level ? activeColor : Color.argb(90, 148, 163, 184));
                canvas.drawRoundRect(viewBounds, dp(1), dp(1), paint);
            }
        }

        private int weakPointCount() {
            int count = 0;
            for (TrackPoint point : points) {
                if (isWeakTrackPoint(point)) {
                    count++;
                }
            }
            return count;
        }

        private int transportPointCount() {
            int count = 0;
            for (TrackPoint point : points) {
                if (isTransportTravelPoint(point)) {
                    count++;
                }
            }
            return count;
        }

        private String fitHudText(String text, float maxWidth) {
            if (paint.measureText(text) <= maxWidth) {
                return text;
            }
            String suffix = "...";
            int end = text.length();
            while (end > 0 && paint.measureText(text, 0, end) + paint.measureText(suffix) > maxWidth) {
                end--;
            }
            return end <= 0 ? suffix : text.substring(0, end) + suffix;
        }

        private void frameToData() {
            if (getWidth() <= 0 || getHeight() <= 0) {
                return;
            }
            double minX = Double.MAX_VALUE;
            double minY = Double.MAX_VALUE;
            double maxX = -Double.MAX_VALUE;
            double maxY = -Double.MAX_VALUE;
            for (TrackPoint point : points) {
                MapPoint displayPoint = toDisplayMapPoint(point.latitude, point.longitude);
                double x = mercatorX(displayPoint.longitude);
                double y = mercatorY(displayPoint.latitude);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            for (ReferenceTrackPoint point : referencePoints) {
                MapPoint displayPoint = toDisplayMapPoint(point.latitude, point.longitude);
                double x = mercatorX(displayPoint.longitude);
                double y = mercatorY(displayPoint.latitude);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            MapPoint point = currentPoint;
            if (point == null && points.isEmpty() && referencePoints.isEmpty()) {
                point = new MapPoint(DEFAULT_MAP_CENTER_LATITUDE, DEFAULT_MAP_CENTER_LONGITUDE);
            }
            if (point != null) {
                MapPoint displayPoint = toDisplayMapPoint(point.latitude, point.longitude);
                double x = mercatorX(displayPoint.longitude);
                double y = mercatorY(displayPoint.latitude);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            if (minX == Double.MAX_VALUE) {
                return;
            }
            double minRange = MIN_FRAME_WORLD_RANGE;
            double rangeX = Math.max(maxX - minX, minRange);
            double rangeY = Math.max(maxY - minY, minRange);
            centerX = (minX + maxX) / 2d;
            centerY = (minY + maxY) / 2d;
            int padding = dp(FRAME_PADDING_DP);
            double availableWidth = Math.max(1, getWidth() - padding * 2d);
            double availableHeight = Math.max(1, getHeight() - padding * 2d);
            scale = clampSatelliteScale(Math.min(availableWidth / rangeX, availableHeight / rangeY));
            panX = 0f;
            panY = 0f;
            hasFrame = true;
            frameNextUpdate = false;
        }

        private PointF toScreen(double latitude, double longitude) {
            MapPoint displayPoint = toDisplayMapPoint(latitude, longitude);
            float x = (float) ((mercatorX(displayPoint.longitude) - centerX) * scale
                    + getWidth() / 2f + panX);
            float y = (float) ((mercatorY(displayPoint.latitude) - centerY) * scale
                    + getHeight() / 2f + panY);
            return new PointF(x, y);
        }

        private float accuracyRadiusPixels(double latitude) {
            if (accuracyMeters <= 0f || scale <= 0d) {
                return 0f;
            }
            double metersPerWorldUnit = EARTH_CIRCUMFERENCE_METERS
                    * Math.max(0.15d, Math.cos(Math.toRadians(latitude)));
            return (float) (accuracyMeters / metersPerWorldUnit * scale);
        }

        private double mercatorX(double longitude) {
            return (longitude + 180d) / 360d;
        }

        private double mercatorY(double latitude) {
            double clamped = Math.max(-MAX_MERCATOR_LATITUDE,
                    Math.min(MAX_MERCATOR_LATITUDE, latitude));
            double radians = Math.toRadians(clamped);
            return (1d - Math.log(Math.tan(radians) + 1d / Math.cos(radians)) / Math.PI) / 2d;
        }

        private MapPoint toDisplayMapPoint(double latitude, double longitude) {
            if (!isInMainlandChina(latitude, longitude)) {
                return new MapPoint(latitude, longitude);
            }
            double dLat = transformLatitude(longitude - 105.0d, latitude - 35.0d);
            double dLng = transformLongitude(longitude - 105.0d, latitude - 35.0d);
            double radLat = latitude / 180.0d * Math.PI;
            double magic = Math.sin(radLat);
            magic = 1d - 0.006693421622965943d * magic * magic;
            double sqrtMagic = Math.sqrt(magic);
            dLat = (dLat * 180.0d)
                    / ((6378245.0d * (1d - 0.006693421622965943d))
                    / (magic * sqrtMagic) * Math.PI);
            dLng = (dLng * 180.0d)
                    / (6378245.0d / sqrtMagic * Math.cos(radLat) * Math.PI);
            return new MapPoint(latitude + dLat, longitude + dLng);
        }

        private boolean isInMainlandChina(double latitude, double longitude) {
            return longitude >= 72.004d && longitude <= 137.8347d
                    && latitude >= 0.8293d && latitude <= 55.8271d;
        }

        private double transformLatitude(double x, double y) {
            double result = -100.0d + 2.0d * x + 3.0d * y + 0.2d * y * y
                    + 0.1d * x * y + 0.2d * Math.sqrt(Math.abs(x));
            result += (20.0d * Math.sin(6.0d * x * Math.PI)
                    + 20.0d * Math.sin(2.0d * x * Math.PI)) * 2.0d / 3.0d;
            result += (20.0d * Math.sin(y * Math.PI)
                    + 40.0d * Math.sin(y / 3.0d * Math.PI)) * 2.0d / 3.0d;
            result += (160.0d * Math.sin(y / 12.0d * Math.PI)
                    + 320.0d * Math.sin(y * Math.PI / 30.0d)) * 2.0d / 3.0d;
            return result;
        }

        private double transformLongitude(double x, double y) {
            double result = 300.0d + x + 2.0d * y + 0.1d * x * x
                    + 0.1d * x * y + 0.1d * Math.sqrt(Math.abs(x));
            result += (20.0d * Math.sin(6.0d * x * Math.PI)
                    + 20.0d * Math.sin(2.0d * x * Math.PI)) * 2.0d / 3.0d;
            result += (20.0d * Math.sin(x * Math.PI)
                    + 40.0d * Math.sin(x / 3.0d * Math.PI)) * 2.0d / 3.0d;
            result += (150.0d * Math.sin(x / 12.0d * Math.PI)
                    + 300.0d * Math.sin(x / 30.0d * Math.PI)) * 2.0d / 3.0d;
            return result;
        }

        private void startMapFlingIfNeeded() {
            if (velocityTracker == null || lastPinchDistance > 0f) {
                return;
            }
            velocityTracker.computeCurrentVelocity(1000, MAX_FLING_VELOCITY_PIXELS_PER_SECOND);
            float velocityX = velocityTracker.getXVelocity();
            float velocityY = velocityTracker.getYVelocity();
            if (Math.hypot(velocityX, velocityY) < MIN_FLING_VELOCITY_PIXELS_PER_SECOND) {
                return;
            }
            flingStartPanX = panX;
            flingStartPanY = panY;
            mapScroller.fling(0, 0,
                    Math.round(velocityX), Math.round(velocityY),
                    -FLING_SCROLL_RANGE_PIXELS, FLING_SCROLL_RANGE_PIXELS,
                    -FLING_SCROLL_RANGE_PIXELS, FLING_SCROLL_RANGE_PIXELS);
            postInvalidateOnAnimation();
        }

        private void stopMapFling() {
            if (!mapScroller.isFinished()) {
                mapScroller.forceFinished(true);
            }
        }

        private void recycleVelocityTracker() {
            if (velocityTracker != null) {
                velocityTracker.recycle();
                velocityTracker = null;
            }
        }

        private boolean movedBeyondTapSlop(float x, float y) {
            float dx = x - touchStartX;
            float dy = y - touchStartY;
            float slop = dp(TAP_SLOP_DP);
            return dx * dx + dy * dy > slop * slop;
        }

        private float pinchDistance(MotionEvent event) {
            if (event.getPointerCount() < 2) {
                return 0f;
            }
            float dx = event.getX(0) - event.getX(1);
            float dy = event.getY(0) - event.getY(1);
            return (float) Math.sqrt(dx * dx + dy * dy);
        }

        private void pinchCenter(MotionEvent event, PointF out) {
            if (event.getPointerCount() < 2) {
                out.set(event.getX(), event.getY());
                return;
            }
            out.set((event.getX(0) + event.getX(1)) / 2f,
                    (event.getY(0) + event.getY(1)) / 2f);
        }

        private void updateTouchAnchorAfterPointerUp(MotionEvent event) {
            int liftedIndex = event.getActionIndex();
            int remainingCount = event.getPointerCount() - 1;
            if (remainingCount >= 2) {
                float firstX = 0f;
                float firstY = 0f;
                float secondX = 0f;
                float secondY = 0f;
                int found = 0;
                for (int i = 0; i < event.getPointerCount() && found < 2; i++) {
                    if (i == liftedIndex) {
                        continue;
                    }
                    if (found == 0) {
                        firstX = event.getX(i);
                        firstY = event.getY(i);
                    } else {
                        secondX = event.getX(i);
                        secondY = event.getY(i);
                    }
                    found++;
                }
                float dx = firstX - secondX;
                float dy = firstY - secondY;
                lastPinchDistance = (float) Math.sqrt(dx * dx + dy * dy);
                lastTouchPoint.set((firstX + secondX) / 2f, (firstY + secondY) / 2f);
                return;
            }
            for (int i = 0; i < event.getPointerCount(); i++) {
                if (i != liftedIndex) {
                    lastTouchPoint.set(event.getX(i), event.getY(i));
                    break;
                }
            }
            lastPinchDistance = 0f;
        }

        private float clamp(float value, float min, float max) {
            return Math.max(min, Math.min(max, value));
        }
    }

    private String headingText() {
        if (Float.isNaN(headingDegrees)) {
            return rotationVectorSensor == null ? "无罗盘" : "校准中";
        }
        String reason = headingReliability.unreliableReason(SystemClock.elapsedRealtimeNanos());
        headingUnreliableReason = reason;
        String reliability = reason.isEmpty() ? "可靠" : "不可靠:" + reason;
        return one.format(headingDegrees) + "° " + cardinalDirection(headingDegrees)
                + " " + reliability;
    }

    private boolean updateHeadingReliability(long nowNanos) {
        String nextReason = headingReliability.unreliableReason(nowNanos);
        boolean changed = !nextReason.equals(headingUnreliableReason);
        headingUnreliableReason = nextReason;
        return changed;
    }

    private String cardinalDirection(float degrees) {
        String[] names = {"北", "东北", "东", "东南", "南", "西南", "西", "西北"};
        int index = Math.round(degrees / 45f) % names.length;
        return names[index];
    }

    private float headingDeltaDegrees(float a, float b) {
        float delta = Math.abs(a - b) % 360f;
        return delta > 180f ? 360f - delta : delta;
    }

    private String decisionReasonShortText(String reason) {
        switch (reason) {
            case "first_fix_good":
            case "first_fix_relaxed":
                return "已取得轨迹起点";
            case "moving_good_fix":
                return "有效移动点";
            case "stationary_anchor":
            case "stationary_cloud_jitter":
                return "静止，不累计距离";
            case "accuracy_too_large":
            case "weak_signal_stage2":
            case "moving_cloud_unstable":
            case "recovery_cloud_pending":
                return "精度不足，暂不进 GPX";
            case "transport_suspected":
                return "疑似交通工具，不累计";
            case "gap_recovery":
                return "恢复徒步，重新锚定";
            default:
                return reason;
        }
    }

    private String recoveryStateShortText(String state) {
        switch (state) {
            case SessionManifest.RECOVERY_FINISHED:
                return "已结束";
            case SessionManifest.RECOVERY_INTERRUPTED:
                return "已中断";
            case SessionManifest.RECOVERY_ERROR:
                return "异常";
            default:
                return state;
        }
    }

    private String decisionReasonText(String reason) {
        switch (reason) {
            case "first_fix_good":
                return "首个可信定位点，精度很好，作为 GPX 起点。";
            case "first_fix_relaxed":
                return "首个定位点精度可接受，作为 GPX 起点。";
            case "accuracy_too_large":
                return "系统给出的定位精度太差，拒绝进入正式轨迹。";
            case "weak_signal_stage2":
                return "弱信号点云，v3 只记录诊断，不进入 GPX。";
            case "moving_cloud_unstable":
                return "移动点云暂不稳定，继续收集证据。";
            case "recovery_cloud_pending":
                return "恢复点云仍在确认中，暂不建立新轨迹段。";
            case "stationary_anchor":
                return "静止点云代表锚点，不累计距离。";
            case "stationary_cloud_jitter":
                return "静止点云中的定位漂移，不累计距离。";
            case "transport_suspected":
                return "检测到明显超过徒步范围的移动，疑似坐车或骑行，暂不进入可信徒步距离。";
            case "provider_not_gps":
                return "不是 GPS_PROVIDER 输出，当前系统 GNSS 测试不接受。";
            case "missing_fix_elapsed_realtime":
                return "缺少 elapsedRealtimeNanos，无法可靠计算连续性。";
            case "before_record_start":
                return "这是记录开始前的系统缓存旧点。";
            case "location_from_future":
                return "定位时间来自未来，采样时间线异常。";
            case "duplicate_fix":
                return "重复定位 fix，已在采样入口丢弃。";
            case "out_of_order_fix":
                return "定位 fix 时间乱序，已在采样入口丢弃。";
            case "sampling_epoch_mismatch":
                return "定位 fix 与采样周期不匹配。";
            case "invalid_coordinate":
                return "经纬度无效。";
            case "invalid_accuracy":
                return "缺少有效精度。";
            case "mock_location":
                return "模拟定位点，不进入可信轨迹。";
            case "moving_good_fix":
                return "移动中的可信定位点，进入 GPX 并累计距离。";
            default:
                return "未分类原因，请查看 diagnostic.jsonl。";
        }
    }

    private void appendSatelliteStatus(StringBuilder sb) {
        sb.append("== 卫星状态 ==\n");
        if (lastGnssStatus == null) {
            sb.append("还没有收到卫星状态\n\n");
            return;
        }

        Map<String, SatSummary> summaries = new HashMap<>();
        List<SatRow> rows = new ArrayList<>();

        for (int i = 0; i < lastGnssStatus.getSatelliteCount(); i++) {
            String name = constellationName(lastGnssStatus.getConstellationType(i));
            SatSummary summary = summaries.get(name);
            if (summary == null) {
                summary = new SatSummary(name);
                summaries.put(name, summary);
            }
            summary.add(lastGnssStatus.getCn0DbHz(i), lastGnssStatus.usedInFix(i));
            rows.add(new SatRow(
                    name,
                    lastGnssStatus.getSvid(i),
                    lastGnssStatus.usedInFix(i),
                    lastGnssStatus.getCn0DbHz(i),
                    lastGnssStatus.getElevationDegrees(i),
                    lastGnssStatus.getAzimuthDegrees(i),
                    lastGnssStatus.hasCarrierFrequencyHz(i)
                            ? lastGnssStatus.getCarrierFrequencyHz(i) : Float.NaN));
        }

        appendSummary(sb, summaries);
        sb.append("星座     编号  参与 信号  高度角 方位角 载波MHz\n");

        Collections.sort(rows, Comparator
                .comparing((SatRow r) -> r.constellation)
                .thenComparingInt(r -> r.svid));

        for (SatRow row : rows) {
            sb.append(pad(row.constellation, 7)).append(' ')
                    .append(pad(String.valueOf(row.svid), 4)).append(' ')
                    .append(row.used ? "是   " : "否   ")
                    .append(pad(one.format(row.cn0), 5)).append(' ')
                    .append(pad(one.format(row.elevation), 5)).append(' ')
                    .append(pad(one.format(row.azimuth), 5)).append(' ');
            if (Float.isNaN(row.carrierHz)) {
                sb.append("-");
            } else {
                sb.append(three.format(row.carrierHz / 1_000_000.0f));
            }
            sb.append('\n');
        }
        sb.append('\n');
    }

    private void appendSummary(StringBuilder sb, Map<String, SatSummary> summaries) {
        SatSummary beidou = summaries.get("BeiDou");
        if (beidou == null) {
            sb.append("结论: 当前没有看到北斗卫星。\n\n");
        } else if (beidou.used > 0) {
            sb.append("结论: 北斗正在参与定位，参与数量 ")
                    .append(beidou.used).append(" 颗。\n\n");
        } else if (beidou.maxCn0 >= 20f) {
            sb.append("结论: 已收到北斗信号，但暂未参与最终定位。\n\n");
        } else {
            sb.append("结论: 能看到北斗列表，但北斗信号还很弱或尚未锁定。\n\n");
        }

        sb.append("星座汇总\n");
        sb.append("星座     可见数 参与数 最强CN0  平均CN0\n");
        List<SatSummary> ordered = new ArrayList<>(summaries.values());
        Collections.sort(ordered, Comparator.comparing(s -> s.name));
        for (SatSummary summary : ordered) {
            sb.append(pad(summary.name, 8)).append(' ')
                    .append(pad(String.valueOf(summary.visible), 7)).append(' ')
                    .append(pad(String.valueOf(summary.used), 4)).append(' ')
                    .append(pad(one.format(summary.maxCn0), 8)).append(' ')
                    .append(one.format(summary.averageCn0())).append('\n');
        }
        sb.append("\n怎么看:\n");
        sb.append("参与数 > 0 表示参与定位；CN0 > 20 通常表示有可用信号。\n\n");
        sb.append("详细卫星列表\n");
    }

    private void appendMeasurements(StringBuilder sb) {
        sb.append("== 原始 GNSS 测量 ==\n");
        if (lastMeasurements == null) {
            sb.append("还没有原始测量数据。部分设备或系统会限制这个 API。\n");
            return;
        }

        GnssClock clock = lastMeasurements.getClock();
        sb.append("接收机时间ns=").append(clock.getTimeNanos());
        if (clock.hasFullBiasNanos()) {
            sb.append(" fullBiasNanos=").append(clock.getFullBiasNanos());
        }
        sb.append('\n');
        sb.append("星座     编号  信号  状态       伪距m           ADRm    多普勒Hz\n");

        List<GnssMeasurement> measurements = new ArrayList<>();
        for (GnssMeasurement measurement : lastMeasurements.getMeasurements()) {
            measurements.add(measurement);
        }
        Collections.sort(measurements, Comparator
                .comparing((GnssMeasurement m) -> constellationName(m.getConstellationType()))
                .thenComparingInt(GnssMeasurement::getSvid));

        for (GnssMeasurement m : measurements) {
            String pseudorange = computePseudorangeMeters(clock, m);
            sb.append(pad(constellationName(m.getConstellationType()), 7)).append(' ')
                    .append(pad(String.valueOf(m.getSvid()), 4)).append(' ')
                    .append(pad(one.format(m.getCn0DbHz()), 5)).append(' ')
                    .append(pad(measurementState(m.getState()), 10)).append(' ')
                    .append(pad(pseudorange, 15)).append(' ');

            if ((m.getAccumulatedDeltaRangeState()
                    & GnssMeasurement.ADR_STATE_VALID) != 0) {
                sb.append(pad(one.format(m.getAccumulatedDeltaRangeMeters()), 7)).append(' ');
            } else {
                sb.append(pad("-", 7)).append(' ');
            }
            sb.append(one.format(m.getPseudorangeRateMetersPerSecond())).append('\n');
        }
    }

    private String computePseudorangeMeters(GnssClock clock, GnssMeasurement m) {
        if (!clock.hasFullBiasNanos()) {
            return "-";
        }

        double weekNanos = 604_800.0e9;
        double c = 299_792_458.0;
        double gpsTimeNanos = clock.getTimeNanos() - (clock.getFullBiasNanos()
                + (clock.hasBiasNanos() ? clock.getBiasNanos() : 0.0));
        double tRxNanos = gpsTimeNanos % weekNanos;
        if (tRxNanos < 0) {
            tRxNanos += weekNanos;
        }
        double tTxNanos = m.getReceivedSvTimeNanos();
        double prSeconds = (tRxNanos - tTxNanos) * 1.0e-9;
        if (prSeconds < 0) {
            prSeconds += 604_800.0;
        }
        double meters = prSeconds * c;
        if (meters <= 0 || meters > 100_000_000) {
            return "-";
        }
        return one.format(meters);
    }

    private boolean hasFineLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasCoarseLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestFineLocationPermission() {
        setStatus("请授予位置信息权限，并选择“精确位置”。");
        requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
        }, REQ_LOCATION);
    }

    private boolean isLocationEnabled() {
        try {
            return locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private boolean isGpsProviderEnabled() {
        try {
            return locationManager != null
                    && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void setStatus(String message) {
        status.setText(message);
    }

    private String constellationName(int constellationType) {
        switch (constellationType) {
            case GnssStatus.CONSTELLATION_GPS:
                return "GPS";
            case GnssStatus.CONSTELLATION_SBAS:
                return "SBAS";
            case GnssStatus.CONSTELLATION_GLONASS:
                return "GLONASS";
            case GnssStatus.CONSTELLATION_QZSS:
                return "QZSS";
            case GnssStatus.CONSTELLATION_BEIDOU:
                return "BeiDou";
            case GnssStatus.CONSTELLATION_GALILEO:
                return "Galileo";
            case GnssStatus.CONSTELLATION_IRNSS:
                return "IRNSS";
            default:
                return "UNK";
        }
    }

    private String measurementState(int state) {
        if ((state & GnssMeasurement.STATE_CODE_LOCK) != 0) return "CODE_LOCK";
        if ((state & GnssMeasurement.STATE_BIT_SYNC) != 0) return "BIT_SYNC";
        if ((state & GnssMeasurement.STATE_SUBFRAME_SYNC) != 0) return "SUBFRAME";
        if ((state & GnssMeasurement.STATE_TOW_DECODED) != 0) return "TOW";
        return "UNKNOWN";
    }

    private String measurementStatusName(int status) {
        switch (status) {
            case GnssMeasurementsEvent.Callback.STATUS_READY:
                return "就绪";
            case GnssMeasurementsEvent.Callback.STATUS_NOT_SUPPORTED:
                return "不支持";
            case GnssMeasurementsEvent.Callback.STATUS_LOCATION_DISABLED:
                return "定位关闭";
            default:
                return String.valueOf(status);
        }
    }

    private String pad(String value, int width) {
        if (value.length() >= width) return value;
        StringBuilder sb = new StringBuilder(value);
        while (sb.length() < width) sb.append(' ');
        return sb.toString();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private int pageTopPadding() {
        int statusBarHeight = 0;
        int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            statusBarHeight = getResources().getDimensionPixelSize(resourceId);
        }
        return statusBarHeight + dp(12);
    }

    private int pageBottomPadding() {
        int navigationBarHeight = 0;
        int resourceId = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
        if (resourceId > 0) {
            navigationBarHeight = getResources().getDimensionPixelSize(resourceId);
        }
        return navigationBarHeight + dp(12);
    }

    /* ======================================================================== */
    /*  Visual helpers — rounded rects, buttons, cards                         */
    /* ======================================================================== */

    private GradientDrawable roundedRect(int fillColor, float radiusDp,
                                          int strokeWidthDp, int strokeColor) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fillColor);
        d.setCornerRadius(dp((int) radiusDp));
        if (strokeWidthDp > 0) {
            d.setStroke(dp(strokeWidthDp), strokeColor);
        }
        return d;
    }

    private GradientDrawable roundedRect(int fillColor, float radiusDp) {
        return roundedRect(fillColor, radiusDp, 0, 0);
    }

    private void prepareButton(Button button, int minHeightDp) {
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setIncludeFontPadding(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(dp(minHeightDp));
        button.setMinimumHeight(dp(minHeightDp));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            button.setStateListAnimator(null);
        }
    }

    private void stylePrimaryButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(37, 99, 235), 8));
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setPadding(dp(10), 0, dp(10), 0);
        prepareButton(button, 44);
    }

    private void styleFloatingPrimaryButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(37, 99, 235), 26));
        button.setTextColor(Color.WHITE);
        button.setTextSize(22);
        button.setPadding(0, 0, 0, dp(2));
        prepareButton(button, 52);
    }

    private void styleFloatingDangerButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(239, 68, 68), 26));
        button.setTextColor(Color.WHITE);
        button.setTextSize(20);
        button.setPadding(0, 0, 0, dp(2));
        prepareButton(button, 52);
    }

    private void styleRecordActionPrimaryButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(37, 99, 235), 10));
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setPadding(dp(12), 0, dp(12), 0);
        prepareButton(button, 46);
    }

    private void styleRecordActionDangerButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(239, 68, 68), 10));
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setPadding(dp(12), 0, dp(12), 0);
        prepareButton(button, 46);
    }

    private void styleFloatingSecondaryButton(Button button) {
        button.setBackground(roundedRect(Color.argb(230, 255, 255, 255), 16,
                1, Color.argb(210, 226, 232, 240)));
        button.setTextColor(Color.rgb(31, 41, 55));
        button.setTextSize(12);
        button.setPadding(dp(6), 0, dp(6), 0);
        prepareButton(button, 38);
    }

    private void styleDangerButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(239, 68, 68), 8));
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setPadding(dp(10), 0, dp(10), 0);
        prepareButton(button, 44);
    }

    private void styleSecondaryButton(Button button) {
        button.setBackground(roundedRect(Color.WHITE, 8, 1, Color.rgb(229, 231, 235)));
        button.setTextColor(Color.rgb(55, 65, 81));
        button.setTextSize(13);
        button.setPadding(dp(10), 0, dp(10), 0);
        prepareButton(button, 44);
    }

    private void styleSmallSecondaryButton(Button button) {
        button.setBackground(roundedRect(Color.WHITE, 6, 1, Color.rgb(229, 231, 235)));
        button.setTextColor(Color.rgb(75, 85, 99));
        button.setTextSize(12);
        button.setPadding(dp(8), 0, dp(8), 0);
        prepareButton(button, 36);
    }

    private void styleSmallPrimaryButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(37, 99, 235), 6));
        button.setTextColor(Color.WHITE);
        button.setTextSize(12);
        button.setPadding(dp(8), 0, dp(8), 0);
        prepareButton(button, 36);
    }

    private void styleSmallDangerButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(239, 68, 68), 6));
        button.setTextColor(Color.WHITE);
        button.setTextSize(12);
        button.setPadding(dp(8), 0, dp(8), 0);
        prepareButton(button, 36);
    }

    private void styleCard(View view, int fillColor, float radiusDp,
                           int strokeWidthDp, int strokeColor) {
        view.setBackground(roundedRect(fillColor, radiusDp, strokeWidthDp, strokeColor));
    }

    private void styleCard(View view, int fillColor, float radiusDp) {
        styleCard(view, fillColor, radiusDp, 1, Color.rgb(226, 232, 240));
    }

    private GradientDrawable infoPanelBackground() {
        return roundedRect(Color.rgb(248, 250, 252), 8, 1, Color.rgb(226, 232, 240));
    }

    private void styleDarkButton(Button button) {
        button.setBackground(roundedRect(Color.rgb(31, 41, 55), 8, 1, Color.rgb(55, 65, 81)));
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setPadding(dp(10), 0, dp(10), 0);
        prepareButton(button, 44);
    }

    private static class SatRow {
        final String constellation;
        final int svid;
        final boolean used;
        final float cn0;
        final float elevation;
        final float azimuth;
        final float carrierHz;

        SatRow(String constellation, int svid, boolean used, float cn0,
               float elevation, float azimuth, float carrierHz) {
            this.constellation = constellation;
            this.svid = svid;
            this.used = used;
            this.cn0 = cn0;
            this.elevation = elevation;
            this.azimuth = azimuth;
            this.carrierHz = carrierHz;
        }
    }

    private static class SatSummary {
        final String name;
        int visible;
        int used;
        float maxCn0;
        float totalCn0;

        SatSummary(String name) {
            this.name = name;
        }

        void add(float cn0, boolean usedInFix) {
            visible++;
            if (usedInFix) used++;
            if (cn0 > maxCn0) maxCn0 = cn0;
            totalCn0 += cn0;
        }

        float averageCn0() {
            if (visible == 0) return 0f;
            return totalCn0 / visible;
        }
    }
}
