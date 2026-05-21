package com.example.gnsssatdemo;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

import com.example.gnsssatdemo.track.engine.BasicTrackSession;
import com.example.gnsssatdemo.track.engine.SamplingEpoch;
import com.example.gnsssatdemo.track.engine.TrackAscentCalculator;
import com.example.gnsssatdemo.track.model.GnssQualitySnapshot;
import com.example.gnsssatdemo.track.model.BarometerWindow;
import com.example.gnsssatdemo.track.model.DeviceMotionWindow;
import com.example.gnsssatdemo.track.model.TrackPoint;

import org.json.JSONException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class RecordingForegroundService extends Service {
    public static final String ACTION_START =
            "com.example.gnsssatdemo.action.START_FOREGROUND_RECORDING";
    public static final String ACTION_STOP =
            "com.example.gnsssatdemo.action.STOP_FOREGROUND_RECORDING";
    public static final String ACTION_STATUS =
            "com.example.gnsssatdemo.action.FOREGROUND_RECORDING_STATUS";
    public static final String ACTION_QUERY_STATUS =
            "com.example.gnsssatdemo.action.QUERY_FOREGROUND_RECORDING_STATUS";
    public static final String EXTRA_ACTIVE = "active";
    public static final String EXTRA_FINISHED = "finished";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_RAW_POINT_COUNT = "rawPointCount";
    public static final String EXTRA_TRACK_POINT_COUNT = "trackPointCount";
    public static final String EXTRA_TOTAL_DISTANCE_METERS = "totalDistanceMeters";
    public static final String EXTRA_TOTAL_ASCENT_METERS = "totalAscentMeters";
    public static final String EXTRA_BAROMETER_TOTAL_ASCENT_METERS =
            "barometerTotalAscentMeters";
    public static final String EXTRA_GNSS_TOTAL_ASCENT_METERS = "gnssTotalAscentMeters";
    public static final String EXTRA_BAROMETER_ASCENT_SAMPLE_COUNT =
            "barometerAscentSampleCount";
    public static final String EXTRA_GNSS_ASCENT_SAMPLE_COUNT = "gnssAscentSampleCount";
    public static final String EXTRA_BAROMETER_ASCENT_REJECTED_SAMPLE_COUNT =
            "barometerAscentRejectedSampleCount";
    public static final String EXTRA_GNSS_ASCENT_REJECTED_SAMPLE_COUNT =
            "gnssAscentRejectedSampleCount";
    public static final String EXTRA_STATUS_TEXT = "statusText";
    public static final String EXTRA_HAS_LOCATION = "hasLocation";
    public static final String EXTRA_LATITUDE = "latitude";
    public static final String EXTRA_LONGITUDE = "longitude";
    public static final String EXTRA_ACCURACY_METERS = "accuracyMeters";
    public static final String EXTRA_HAS_SPEED = "hasSpeed";
    public static final String EXTRA_SPEED_METERS_PER_SECOND = "speedMetersPerSecond";
    public static final String EXTRA_HAS_BEARING = "hasBearing";
    public static final String EXTRA_BEARING_DEGREES = "bearingDegrees";
    public static final String EXTRA_TRACK_POLYLINE = "trackPolyline";
    public static final String EXTRA_ASCENT_SOURCE = "ascentSource";
    public static final String EXTRA_PRESSURE_SENSOR_AVAILABLE = "pressureSensorAvailable";
    public static final String EXTRA_PRESSURE_SAMPLE_COUNT = "pressureSampleCount";
    public static final String EXTRA_BAROMETER_CALIBRATED = "barometerCalibrated";
    public static final String EXTRA_BAROMETER_ALTITUDE_METERS = "barometerAltitudeMeters";
    public static final String EXTRA_RAW_BAROMETER_ALTITUDE_METERS =
            "rawBarometerAltitudeMeters";

    private static final String CHANNEL_ID = "gnss_recording_visible_v3";
    private static final int NOTIFICATION_ID = 42;
    private static final long NO_LOCATION_TIMEOUT_MILLIS = 30_000L;
    private static final long STARTING_INTERVAL_MILLIS = 1_000L;
    private static final float STARTING_DISTANCE_METERS = 0f;
    private static final long MOVING_INTERVAL_MILLIS = 3_000L;
    private static final float MOVING_DISTANCE_METERS = 0f;
    private static final long PAUSED_INTERVAL_MILLIS = 10_000L;
    private static final float PAUSED_DISTANCE_METERS = 0f;
    private static final long SIGNAL_WEAK_INTERVAL_MILLIS = 2_000L;
    private static final float SIGNAL_WEAK_DISTANCE_METERS = 0f;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final GnssQualitySnapshotFactory gnssQualitySnapshotFactory =
            new GnssQualitySnapshotFactory();
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private final List<Sensor> deviceMotionSensors = new ArrayList<>();
    private Sensor pressureSensor;
    private BasicTrackSession trackSession;
    private Location lastLocation;
    private long lastLocationReceivedElapsedRealtimeMillis;
    private boolean noLocationTimeoutLogged;
    private boolean listening;
    private boolean gnssStatusRegistered;
    private boolean motionSensorRegistered;
    private boolean pressureSensorRegistered;
    private boolean stopRequested;
    private SamplingPolicy currentSamplingPolicy;
    private LocationListener activeLocationListener;
    private long lastPressureSampleElapsedRealtimeNanos;
    private static final long PRESSURE_SAMPLE_MIN_INTERVAL_NANOS = 1_000_000_000L;
    private final RecordingSamplingState samplingState = new RecordingSamplingState();
    private final DeviceMotionWindowSampler deviceMotionWindowSampler =
            new DeviceMotionWindowSampler(new DeviceMotionWindowSampler.Listener() {
                @Override
                public void onDeviceMotionWindow(DeviceMotionWindow window) {
                    if (trackSession != null && trackSession.isActive()) {
                        trackSession.onDeviceMotionWindow(window);
                        updateLocationRequestForCurrentPolicy(false);
                    }
                }
            });
    private final BarometerWindowSampler barometerWindowSampler =
            new BarometerWindowSampler(new BarometerWindowSampler.Listener() {
                @Override
                public void onBarometerWindow(BarometerWindow window) {
                    if (trackSession != null && trackSession.isActive()) {
                        trackSession.onBarometerWindow(window);
                    }
                }
            });

    private final SensorEventListener motionSensorListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            deviceMotionWindowSampler.onSensorChanged(event);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            // Motion evidence is diagnostic-only; no action needed on accuracy changes.
        }
    };

    private final SensorEventListener pressureSensorListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event == null || event.values == null || event.values.length == 0) {
                return;
            }
            long elapsedRealtimeNanos = event.timestamp;
            barometerWindowSampler.addSample(event.values[0], event.accuracy,
                    elapsedRealtimeNanos);
            if (lastPressureSampleElapsedRealtimeNanos > 0L
                    && elapsedRealtimeNanos - lastPressureSampleElapsedRealtimeNanos
                    < PRESSURE_SAMPLE_MIN_INTERVAL_NANOS) {
                return;
            }
            lastPressureSampleElapsedRealtimeNanos = elapsedRealtimeNanos;
            if (trackSession != null && trackSession.isActive()) {
                trackSession.onPressureSample(event.values[0], event.accuracy,
                        elapsedRealtimeNanos);
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            // Pressure accuracy is captured on each sample for diagnostics.
        }
    };

    private final BroadcastReceiver statusQueryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (ACTION_QUERY_STATUS.equals(intent.getAction())) {
                sendStatus("真实徒步服务状态已刷新");
            }
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
                updateLocationRequestForCurrentPolicy(false);
                updateNotification("超过 " + (elapsed / 1000L) + " 秒没有 GPS 回调");
                sendStatus("超过 " + (elapsed / 1000L) + " 秒没有 GPS 回调");
            } else {
                scheduleNoLocationTimeout();
            }
        }
    };

    private final GnssStatus.Callback gnssStatusCallback = new GnssStatus.Callback() {
        @Override
        public void onSatelliteStatusChanged(GnssStatus status) {
            if (trackSession == null || !trackSession.isActive()) {
                return;
            }
            trackSession.onGnssSnapshot(snapshotFromStatus(status));
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            addDeviceMotionSensor(Sensor.TYPE_LINEAR_ACCELERATION);
            addDeviceMotionSensor(Sensor.TYPE_ACCELEROMETER);
            addDeviceMotionSensor(Sensor.TYPE_GYROSCOPE);
            addDeviceMotionSensor(Sensor.TYPE_ROTATION_VECTOR);
            addDeviceMotionSensor(Sensor.TYPE_STEP_DETECTOR);
            addDeviceMotionSensor(Sensor.TYPE_STEP_COUNTER);
            pressureSensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE);
        }
        trackSession = new BasicTrackSession(this);
        createNotificationChannel();
        registerStatusQueryReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            sendStatus("服务被系统重启但没有记录命令，保持中断状态");
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopRecordingAndSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification("正在启动真实徒步记录"));
        startRecording();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopMotionCallbacks();
        stopPressureCallbacks();
        stopLocationCallbacks();
        mainHandler.removeCallbacks(noLocationTimeoutRunnable);
        if (!stopRequested && trackSession != null && trackSession.isActive()) {
            trackSession.onInterrupted("foreground_service_destroyed");
            sendStatus("前台服务被销毁，session 保留为 INTERRUPTED");
        }
        if (trackSession != null) {
            trackSession.close();
        }
        unregisterReceiver(statusQueryReceiver);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startRecording() {
        stopRequested = false;
        if (trackSession != null && trackSession.isActive()) {
            updateNotification("真实徒步记录中");
            sendStatus("真实徒步记录中");
            return;
        }
        if (!hasFineLocation()) {
            updateNotification("缺少精确定位权限，无法记录");
            sendStatus("缺少精确定位权限，无法记录");
            stopSelf();
            return;
        }
        try {
            samplingState.reset();
            deviceMotionWindowSampler.reset();
            barometerWindowSampler.reset();
            trackSession.start(isGpsProviderEnabled(), true, true, pressureSensor != null);
            startMotionCallbacks();
            startPressureCallbacks();
            startLocationCallbacks();
            lastLocationReceivedElapsedRealtimeMillis = SystemClock.elapsedRealtime();
            noLocationTimeoutLogged = false;
            scheduleNoLocationTimeout();
            String statusText = "记录中，等待首个可信 GNSS 点云";
            updateNotification(statusText);
            sendStatus(statusText);
        } catch (IOException | JSONException e) {
            updateNotification("开始记录失败: " + e.getMessage());
            sendStatus("开始记录失败: " + e.getMessage());
            stopSelf();
        }
    }

    private void addDeviceMotionSensor(int sensorType) {
        Sensor sensor = sensorManager.getDefaultSensor(sensorType);
        if (sensor != null) {
            deviceMotionSensors.add(sensor);
        }
    }

    private void stopRecordingAndSelf() {
        stopRequested = true;
        mainHandler.removeCallbacks(noLocationTimeoutRunnable);
        stopMotionCallbacks();
        stopPressureCallbacks();
        stopLocationCallbacks();
        if (trackSession != null && trackSession.isActive()) {
            try {
                trackSession.finish();
                updateNotification("记录已结束，session 已保存");
                sendStatus("记录已结束，session 已保存");
            } catch (IOException | JSONException e) {
                updateNotification("结束记录失败: " + e.getMessage());
                sendStatus("结束记录失败: " + e.getMessage());
            }
        }
        stopForeground(true);
        stopSelf();
    }

    private void startLocationCallbacks() {
        if (listening || locationManager == null || !hasFineLocation()) {
            return;
        }
        try {
            currentSamplingPolicy = null;
            updateLocationRequestForCurrentPolicy(true);
            if (!gnssStatusRegistered) {
                locationManager.registerGnssStatusCallback(gnssStatusCallback, mainHandler);
                gnssStatusRegistered = true;
            }
        } catch (RuntimeException e) {
            updateNotification("GPS 监听失败: " + e.getMessage());
            sendStatus("GPS 监听失败: " + e.getMessage());
        }
    }

    private void stopLocationCallbacks() {
        if (!listening || locationManager == null) {
            return;
        }
        try {
            if (listening && activeLocationListener != null) {
                locationManager.removeUpdates(activeLocationListener);
            }
            if (gnssStatusRegistered) {
                locationManager.unregisterGnssStatusCallback(gnssStatusCallback);
            }
        } catch (RuntimeException ignored) {
            // Some vendor builds throw if a callback was not fully registered.
        }
        listening = false;
        gnssStatusRegistered = false;
        currentSamplingPolicy = null;
        activeLocationListener = null;
    }

    private void startMotionCallbacks() {
        if (motionSensorRegistered || sensorManager == null) {
            return;
        }
        deviceMotionWindowSampler.reset();
        boolean registered = false;
        for (Sensor sensor : deviceMotionSensors) {
            registered |= sensorManager.registerListener(motionSensorListener, sensor,
                    100_000, mainHandler);
        }
        motionSensorRegistered = registered;
    }

    private void stopMotionCallbacks() {
        if (sensorManager == null || !motionSensorRegistered) {
            return;
        }
        deviceMotionWindowSampler.flush();
        sensorManager.unregisterListener(motionSensorListener);
        motionSensorRegistered = false;
    }

    private void startPressureCallbacks() {
        if (pressureSensorRegistered || sensorManager == null || pressureSensor == null) {
            return;
        }
        lastPressureSampleElapsedRealtimeNanos = 0L;
        barometerWindowSampler.reset();
        pressureSensorRegistered = sensorManager.registerListener(pressureSensorListener,
                pressureSensor, SensorManager.SENSOR_DELAY_NORMAL, mainHandler);
    }

    private void stopPressureCallbacks() {
        if (sensorManager == null || !pressureSensorRegistered) {
            return;
        }
        sensorManager.unregisterListener(pressureSensorListener);
        barometerWindowSampler.flush();
        pressureSensorRegistered = false;
        lastPressureSampleElapsedRealtimeNanos = 0L;
    }

    private void updateLocationRequestForCurrentPolicy(boolean force) {
        if (locationManager == null || !hasFineLocation()) {
            return;
        }
        SamplingPolicy nextPolicy = chooseSamplingPolicy();
        if (!force && nextPolicy.sameRequestAs(currentSamplingPolicy)) {
            return;
        }
        try {
            if (listening && activeLocationListener != null) {
                locationManager.removeUpdates(activeLocationListener);
            }
            if (trackSession == null) {
                return;
            }
            SamplingEpoch epoch = trackSession.onSamplingPolicyChanged(nextPolicy.state,
                            nextPolicy.intervalMillis, nextPolicy.distanceMeters);
            LocationListener listener = locationListenerForEpoch(epoch);
            requestGpsLocationUpdates(nextPolicy.intervalMillis, nextPolicy.distanceMeters,
                    listener);
            listening = true;
            currentSamplingPolicy = nextPolicy;
            activeLocationListener = listener;
        } catch (IOException | JSONException | RuntimeException e) {
            updateNotification("GPS 采样策略切换失败: " + e.getMessage());
            sendStatus("GPS 采样策略切换失败: " + e.getMessage());
        }
    }

    private LocationListener locationListenerForEpoch(
            final SamplingEpoch epoch) {
        return new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                lastLocation = location;
                lastLocationReceivedElapsedRealtimeMillis = SystemClock.elapsedRealtime();
                noLocationTimeoutLogged = false;
                if (trackSession != null) {
                    trackSession.onLocation(location, epoch);
                    samplingState.onDecisionReason(trackSession.getLastDecisionReason());
                    String statusText = "TrackPoint " + trackSession.getTrackPointCount()
                            + " / RawPoint " + trackSession.getRawPointCount()
                            + " / " + oneDecimal(trackSession.getTotalDistanceMeters()) + "m"
                            + " / " + samplingPolicyLabel();
                    updateNotification(statusText);
                    sendStatus(statusText);
                }
                scheduleNoLocationTimeout();
                updateLocationRequestForCurrentPolicy(false);
            }
        };
    }

    private void requestGpsLocationUpdates(long intervalMillis, float distanceMeters,
                                           LocationListener listener) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            LocationRequest request = new LocationRequest.Builder(intervalMillis)
                    .setMinUpdateIntervalMillis(intervalMillis)
                    .setMinUpdateDistanceMeters(distanceMeters)
                    .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                    .build();
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, request,
                    getMainExecutor(), listener);
            return;
        }
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMillis,
                distanceMeters, listener, Looper.getMainLooper());
    }

    private SamplingPolicy chooseSamplingPolicy() {
        if (trackSession == null || !trackSession.isActive()) {
            return new SamplingPolicy("STARTING", STARTING_INTERVAL_MILLIS,
                    STARTING_DISTANCE_METERS);
        }
        if (noLocationTimeoutLogged || isWeakSignalReason(trackSession.getLastDecisionReason())) {
            return new SamplingPolicy("SIGNAL_WEAK", SIGNAL_WEAK_INTERVAL_MILLIS,
                    SIGNAL_WEAK_DISTANCE_METERS);
        }
        if (trackSession.getTrackPointCount() <= 0) {
            return new SamplingPolicy("STARTING", STARTING_INTERVAL_MILLIS,
                    STARTING_DISTANCE_METERS);
        }
        if (samplingState.shouldUsePausedPolicy()) {
            return new SamplingPolicy("PAUSED", PAUSED_INTERVAL_MILLIS,
                    PAUSED_DISTANCE_METERS);
        }
        return new SamplingPolicy("MOVING", MOVING_INTERVAL_MILLIS,
                MOVING_DISTANCE_METERS);
    }

    private boolean isWeakSignalReason(String reason) {
        return "accuracy_too_large".equals(reason)
                || "weak_signal_stage2".equals(reason)
                || "moving_cloud_unstable".equals(reason)
                || "recovery_cloud_pending".equals(reason)
                || "invalid_accuracy".equals(reason)
                || "sampling_epoch_mismatch".equals(reason);
    }

    private String samplingPolicyLabel() {
        if (currentSamplingPolicy == null) {
            return "采样 STARTING";
        }
        return "采样 " + currentSamplingPolicy.state + " "
                + (currentSamplingPolicy.intervalMillis / 1000L) + "s/"
                + trimMeters(currentSamplingPolicy.distanceMeters) + "m";
    }

    private String trimMeters(float meters) {
        return meters == (long) meters ? String.valueOf((long) meters) : String.valueOf(meters);
    }

    private static class SamplingPolicy {
        final String state;
        final long intervalMillis;
        final float distanceMeters;

        SamplingPolicy(String state, long intervalMillis, float distanceMeters) {
            this.state = state;
            this.intervalMillis = intervalMillis;
            this.distanceMeters = distanceMeters;
        }

        boolean sameRequestAs(SamplingPolicy other) {
            return other != null
                    && intervalMillis == other.intervalMillis
                    && Float.compare(distanceMeters, other.distanceMeters) == 0;
        }
    }

    private void scheduleNoLocationTimeout() {
        mainHandler.removeCallbacks(noLocationTimeoutRunnable);
        if (trackSession != null && trackSession.isActive()) {
            mainHandler.postDelayed(noLocationTimeoutRunnable, NO_LOCATION_TIMEOUT_MILLIS);
        }
    }

    private GnssQualitySnapshot snapshotFromStatus(GnssStatus status) {
        long receivedElapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos();
        return gnssQualitySnapshotFactory.fromStatus(trackSession.nextGnssSnapshotId(),
                receivedElapsedRealtimeNanos, status);
    }

    private Notification buildNotification(String text) {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent openPendingIntent = PendingIntent.getActivity(this, 0, openIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stopIntent = new Intent(this, RecordingForegroundService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 1, stopIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setContentTitle("GNSS 真实徒步记录")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(openPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                        "结束记录", stopPendingIntent)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setPriority(Notification.PRIORITY_DEFAULT)
                .setShowWhen(true)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(text));
        }
    }

    private void sendStatus(String text) {
        Intent intent = new Intent(ACTION_STATUS);
        intent.setPackage(getPackageName());
        boolean active = trackSession != null && trackSession.isActive();
        intent.putExtra(EXTRA_ACTIVE, active);
        intent.putExtra(EXTRA_FINISHED, trackSession != null && trackSession.isFinished());
        intent.putExtra(EXTRA_SESSION_ID, trackSession == null ? "" : trackSession.getSessionId());
        intent.putExtra(EXTRA_RAW_POINT_COUNT, trackSession == null ? 0L : trackSession.getRawPointCount());
        intent.putExtra(EXTRA_TRACK_POINT_COUNT,
                trackSession == null ? 0 : trackSession.getTrackPointCount());
        intent.putExtra(EXTRA_TOTAL_DISTANCE_METERS,
                trackSession == null ? 0.0 : trackSession.getTotalDistanceMeters());
        TrackAscentCalculator.Result ascentResult = trackSession == null
                ? null : trackSession.getAscentResult();
        intent.putExtra(EXTRA_TOTAL_ASCENT_METERS,
                ascentResult == null ? -1.0 : ascentResult.totalAscentMeters);
        intent.putExtra(EXTRA_BAROMETER_TOTAL_ASCENT_METERS,
                ascentResult == null ? -1.0 : ascentResult.barometerTotalAscentMeters);
        intent.putExtra(EXTRA_GNSS_TOTAL_ASCENT_METERS,
                ascentResult == null ? -1.0 : ascentResult.gnssTotalAscentMeters);
        intent.putExtra(EXTRA_BAROMETER_ASCENT_SAMPLE_COUNT,
                ascentResult == null ? 0 : ascentResult.barometerSampleCount);
        intent.putExtra(EXTRA_GNSS_ASCENT_SAMPLE_COUNT,
                ascentResult == null ? 0 : ascentResult.gnssSampleCount);
        intent.putExtra(EXTRA_BAROMETER_ASCENT_REJECTED_SAMPLE_COUNT,
                ascentResult == null ? 0 : ascentResult.barometerRejectedSampleCount);
        intent.putExtra(EXTRA_GNSS_ASCENT_REJECTED_SAMPLE_COUNT,
                ascentResult == null ? 0 : ascentResult.gnssRejectedSampleCount);
        intent.putExtra(EXTRA_ASCENT_SOURCE,
                ascentResult == null ? "NONE" : ascentResult.source);
        intent.putExtra(EXTRA_PRESSURE_SENSOR_AVAILABLE,
                trackSession != null && trackSession.isPressureSensorAvailable());
        intent.putExtra(EXTRA_PRESSURE_SAMPLE_COUNT,
                trackSession == null ? 0L : trackSession.getPressureSampleCount());
        intent.putExtra(EXTRA_BAROMETER_CALIBRATED,
                trackSession != null && trackSession.isBarometerCalibrated());
        intent.putExtra(EXTRA_BAROMETER_ALTITUDE_METERS,
                trackSession == null ? Double.NaN
                        : trackSession.getLastDisplayedBarometerAltitudeMeters());
        intent.putExtra(EXTRA_RAW_BAROMETER_ALTITUDE_METERS,
                trackSession == null ? Double.NaN
                        : trackSession.getLastRawBarometerAltitudeMeters());
        intent.putExtra(EXTRA_STATUS_TEXT, text);
        if (lastLocation != null) {
            intent.putExtra(EXTRA_HAS_LOCATION, true);
            intent.putExtra(EXTRA_LATITUDE, lastLocation.getLatitude());
            intent.putExtra(EXTRA_LONGITUDE, lastLocation.getLongitude());
            intent.putExtra(EXTRA_ACCURACY_METERS,
                    lastLocation.hasAccuracy() ? lastLocation.getAccuracy() : -1f);
            intent.putExtra(EXTRA_HAS_SPEED, lastLocation.hasSpeed());
            intent.putExtra(EXTRA_SPEED_METERS_PER_SECOND,
                    lastLocation.hasSpeed() ? lastLocation.getSpeed() : -1f);
            intent.putExtra(EXTRA_HAS_BEARING, lastLocation.hasBearing());
            intent.putExtra(EXTRA_BEARING_DEGREES,
                    lastLocation.hasBearing() ? lastLocation.getBearing() : -1f);
        } else {
            intent.putExtra(EXTRA_HAS_LOCATION, false);
        }
        intent.putExtra(EXTRA_TRACK_POLYLINE, trackPolylineText());
        sendBroadcast(intent);
    }

    private String trackPolylineText() {
        if (trackSession == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (TrackPoint point : trackSession.getDisplayTrackPoints()) {
            appendPolylinePoint(sb, point);
        }
        return sortedPolyline(sb.toString());
    }

    private void appendPolylinePoint(StringBuilder sb, TrackPoint point) {
        if (sb.length() > 0) {
            sb.append(';');
        }
        sb.append(point.latitude).append(',').append(point.longitude).append(',')
                .append(point.accuracyMeters).append(',')
                .append(point.hasBearing ? point.bearingDegrees : -1f).append(',')
                .append(point.timeMillis).append(',')
                .append(point.elapsedRealtimeNanos).append(',')
                .append(point.decisionResult).append(',')
                .append(point.hasAltitude ? point.altitude : Double.NaN).append(',')
                .append(point.decisionReason).append(',')
                .append(point.hasVerticalAccuracy ? point.verticalAccuracyMeters : Double.NaN)
                .append(',')
                .append(point.hasPressureSample
                        ? point.pressureSampleElapsedRealtimeNanos : 0L)
                .append(',')
                .append(point.hasPressureSample ? point.pressureHpa : Double.NaN)
                .append(',')
                .append(point.hasPressureSample
                        ? point.rawBarometerAltitudeMeters : Double.NaN);
    }

    private String oneDecimal(double value) {
        return String.format(java.util.Locale.US, "%.1f", value);
    }

    private String sortedPolyline(String polyline) {
        if (polyline.isEmpty()) {
            return "";
        }
        String[] rows = polyline.split(";");
        List<String> sorted = new ArrayList<>();
        Collections.addAll(sorted, rows);
        Collections.sort(sorted, new Comparator<String>() {
            @Override
            public int compare(String left, String right) {
                return Long.compare(elapsedFromPolyline(left), elapsedFromPolyline(right));
            }
        });
        StringBuilder sb = new StringBuilder();
        for (String row : sorted) {
            if (sb.length() > 0) {
                sb.append(';');
            }
            sb.append(row);
        }
        return sb.toString();
    }

    private long elapsedFromPolyline(String row) {
        String[] parts = row.split(",");
        if (parts.length < 6) {
            return 0L;
        }
        try {
            return Long.parseLong(parts[5]);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    private void registerStatusQueryReceiver() {
        IntentFilter filter = new IntentFilter(ACTION_QUERY_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(statusQueryReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(statusQueryReceiver, filter);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                "GNSS 真实徒步记录", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("真实徒步 GNSS 前台记录持续通知");
        channel.setShowBadge(false);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private boolean hasFineLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isGpsProviderEnabled() {
        try {
            return locationManager != null
                    && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (RuntimeException e) {
            return false;
        }
    }
}
