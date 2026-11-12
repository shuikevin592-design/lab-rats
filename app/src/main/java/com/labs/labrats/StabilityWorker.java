package com.labs.labrats;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class StabilityWorker extends Worker {

    public StabilityWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        // Check if server is running
        if (!WorkManager_Sync.isRunning) {
            android.util.Log.d("StabilityWorker", "Persistence Trigger: Server found offline. Reviving...");
            // Foreground keep-alive core first (heartbeat + tunnel watchdog)
            try {
                Intent coreIntent = new Intent(context, ForegroundCoreService.class);
                androidx.core.content.ContextCompat.startForegroundService(context, coreIntent);
            } catch (Exception ignored) {}

            Intent serviceIntent = new Intent(context, WorkManager_Sync.class);
            serviceIntent.setAction(Constants.ACTION_START_CORE);

            try {
                androidx.core.content.ContextCompat.startForegroundService(context, serviceIntent);
            } catch (Exception ignored) {}
        }

        return Result.success();
    }
}
