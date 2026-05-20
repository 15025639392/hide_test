package com.example.gnsssatdemo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

class RecordingServiceController {
    private final Context context;

    RecordingServiceController(Context context) {
        this.context = context;
    }

    void registerStatusReceiver(BroadcastReceiver receiver) {
        IntentFilter filter = new IntentFilter(RecordingForegroundService.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(receiver, filter);
        }
    }

    void unregisterStatusReceiver(BroadcastReceiver receiver) {
        context.unregisterReceiver(receiver);
    }

    void queryStatus() {
        Intent intent = new Intent(RecordingForegroundService.ACTION_QUERY_STATUS);
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);
    }

    void startRecording() {
        Intent intent = new Intent(context, RecordingForegroundService.class);
        intent.setAction(RecordingForegroundService.ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    void stopRecording() {
        Intent intent = new Intent(context, RecordingForegroundService.class);
        intent.setAction(RecordingForegroundService.ACTION_STOP);
        context.startService(intent);
    }
}
