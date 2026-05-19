package com.example.gnsssatdemo;

import android.content.Intent;

class RecordingStatusMapper {
    boolean isStatusIntent(Intent intent) {
        return intent != null
                && RecordingForegroundService.ACTION_STATUS.equals(intent.getAction());
    }

    RecordingServiceStatus fromIntent(Intent intent) {
        String sessionId = nonNull(intent.getStringExtra(
                RecordingForegroundService.EXTRA_SESSION_ID));
        String statusText = nonNull(intent.getStringExtra(
                RecordingForegroundService.EXTRA_STATUS_TEXT));
        String trackPolyline = nonNull(intent.getStringExtra(
                RecordingForegroundService.EXTRA_TRACK_POLYLINE));
        boolean hasLocation = intent.getBooleanExtra(
                RecordingForegroundService.EXTRA_HAS_LOCATION, false);
        return new RecordingServiceStatus(
                intent.getBooleanExtra(RecordingForegroundService.EXTRA_ACTIVE, false),
                sessionId,
                intent.getLongExtra(RecordingForegroundService.EXTRA_RAW_POINT_COUNT, 0L),
                intent.getIntExtra(RecordingForegroundService.EXTRA_TRACK_POINT_COUNT, 0),
                intent.getDoubleExtra(RecordingForegroundService.EXTRA_TOTAL_DISTANCE_METERS, 0.0),
                intent.getDoubleExtra(RecordingForegroundService.EXTRA_TOTAL_ASCENT_METERS, -1.0),
                intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_BAROMETER_TOTAL_ASCENT_METERS, -1.0),
                intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_GNSS_TOTAL_ASCENT_METERS, -1.0),
                intent.getIntExtra(
                        RecordingForegroundService.EXTRA_BAROMETER_ASCENT_SAMPLE_COUNT, 0),
                intent.getIntExtra(
                        RecordingForegroundService.EXTRA_GNSS_ASCENT_SAMPLE_COUNT, 0),
                intent.getIntExtra(
                        RecordingForegroundService.EXTRA_BAROMETER_ASCENT_REJECTED_SAMPLE_COUNT,
                        0),
                intent.getIntExtra(
                        RecordingForegroundService.EXTRA_GNSS_ASCENT_REJECTED_SAMPLE_COUNT, 0),
                statusText,
                hasLocation,
                hasLocation ? intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_LATITUDE, 0.0) : 0.0,
                hasLocation ? intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_LONGITUDE, 0.0) : 0.0,
                hasLocation ? intent.getFloatExtra(
                        RecordingForegroundService.EXTRA_ACCURACY_METERS, -1f) : -1f,
                hasLocation && intent.getBooleanExtra(
                        RecordingForegroundService.EXTRA_HAS_SPEED, false),
                hasLocation ? intent.getFloatExtra(
                        RecordingForegroundService.EXTRA_SPEED_METERS_PER_SECOND, -1f) : -1f,
                hasLocation && intent.getBooleanExtra(
                        RecordingForegroundService.EXTRA_HAS_BEARING, false),
                hasLocation ? intent.getFloatExtra(
                        RecordingForegroundService.EXTRA_BEARING_DEGREES, -1f) : -1f,
                trackPolyline,
                nonNull(intent.getStringExtra(
                        RecordingForegroundService.EXTRA_ASCENT_SOURCE)),
                intent.getBooleanExtra(
                        RecordingForegroundService.EXTRA_PRESSURE_SENSOR_AVAILABLE, false),
                intent.getLongExtra(
                        RecordingForegroundService.EXTRA_PRESSURE_SAMPLE_COUNT, 0L),
                intent.getBooleanExtra(
                        RecordingForegroundService.EXTRA_BAROMETER_CALIBRATED, false),
                intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_BAROMETER_ALTITUDE_METERS,
                        Double.NaN),
                intent.getDoubleExtra(
                        RecordingForegroundService.EXTRA_RAW_BAROMETER_ALTITUDE_METERS,
                        Double.NaN));
    }

    private String nonNull(String value) {
        return value == null ? "" : value;
    }
}
