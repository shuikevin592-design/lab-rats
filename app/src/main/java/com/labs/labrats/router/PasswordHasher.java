package com.labs.labrats.router;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;

import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * PBKDF2 Password Hashing with Salt & Constant-Time Verification.
 * Provides backwards-compatible migration for legacy plain-text C2 access passwords.
 */
public class PasswordHasher {

    private static final String TAG = "PasswordHasher";
    // [SECURITY] Iterations raised 10000 -> 210000 per OWASP PBKDF2-HMAC-SHA256 guidance
    private static final int ITERATIONS = 210000;
    private static final int KEY_LENGTH = 256;
    private static final String PREFS = "StabilityConfig";

    public static String sanitizePassword(String rawInput) {
        if (rawInput == null) return "";
        String s = rawInput.trim();
        if (s.startsWith("0x_")) {
            try {
                byte[] decoded = Base64.decode(s.substring(3), Base64.NO_WRAP | Base64.DEFAULT);
                s = new StringBuilder(new String(decoded, "UTF-8")).reverse().toString().trim();
            } catch (Exception e) {
                try {
                    byte[] decoded = Base64.decode(s.substring(3), Base64.URL_SAFE);
                    s = new StringBuilder(new String(decoded, "UTF-8")).reverse().toString().trim();
                } catch (Exception ignored) {}
            }
        }
        return s;
    }

    public static boolean verifyPassword(Context context, String inputPassword) {
        if (inputPassword == null) return false;
        String cleanInput = sanitizePassword(inputPassword);
        if (cleanInput.isEmpty()) return false;

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        String storedHash = prefs.getString("c2_password_hash", null);
        String storedSalt = prefs.getString("c2_password_salt", null);

        // Legacy migration: only an explicitly stored legacy plain-text password is honored.
        // There is NO built-in default password fallback anymore.
        if (storedHash == null || storedSalt == null) {
            String legacyPass = prefs.getString("c2_password", null);
            if (legacyPass != null && !legacyPass.isEmpty() && legacyPass.equals(cleanInput)) {
                // Automatically upgrade legacy plain-text password to salted PBKDF2 hash
                savePassword(context, cleanInput);
                return true;
            }
            return false;
        }

        try {
            String inputHash = hashPassword(cleanInput, storedSalt);
            return slowEquals(storedHash, inputHash);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Stores a PBKDF2 hash. Never falls back to plain-text storage.
     */
    public static boolean savePassword(Context context, String newPassword) {
        if (newPassword == null) return false;
        String cleanPass = sanitizePassword(newPassword);
        if (cleanPass.isEmpty()) return false;

        try {
            String salt = generateSalt();
            String hash = hashPassword(cleanPass, salt);

            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString("c2_password_hash", hash)
                    .putString("c2_password_salt", salt)
                    .remove("c2_password") // Remove plain text password after upgrading
                    .apply();
            return true;
        } catch (Exception e) {
            // No plain-text fallback: fail closed rather than weaken storage.
            Log.e(TAG, "PBKDF2 hashing failed; password not stored", e);
            return false;
        }
    }

    /**
     * First-run initial password bootstrap.
     * - Existing PBKDF2 hash: no-op.
     * - Legacy stored plain-text password: migrates it to PBKDF2 (no default).
     * - No password at all: generates a random initial password, stores its hash,
     *   and shows it to the deployer exactly once via a system notification.
     */
    public static synchronized void ensureInitialPassword(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

            if (prefs.getString("c2_password_hash", null) != null) {
                return; // Password already configured
            }

            String legacyPass = prefs.getString("c2_password", null);
            String initial;
            if (legacyPass != null && !legacyPass.isEmpty()) {
                initial = legacyPass;
            } else {
                initial = generateRandomPassword();
            }

            if (!savePassword(context, initial)) {
                Log.e(TAG, "Initial password bootstrap failed");
                return;
            }

            if (!prefs.getBoolean("initial_password_notified", false)) {
                prefs.edit().putBoolean("initial_password_notified", true).apply();
                showInitialPasswordNotification(context, initial);
            }
        } catch (Exception e) {
            Log.e(TAG, "ensureInitialPassword error", e);
        }
    }

    private static String generateRandomPassword() {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(16);
        for (int i = 0; i < 16; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    private static void showInitialPasswordNotification(Context context, String initialPassword) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String channelId = "c2_admin";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(channelId, "C2 Admin", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("C2 panel credentials and security events");
                nm.createNotificationChannel(channel);
            }
            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(context, channelId);
            } else {
                builder = new Notification.Builder(context);
            }
            builder.setSmallIcon(android.R.drawable.ic_lock_lock)
                    .setContentTitle("C2 初始访问口令")
                    .setContentText(initialPassword)
                    .setStyle(new Notification.BigTextStyle().bigText("首次部署初始口令: " + initialPassword + "\n登录后请在面板中修改。"))
                    .setAutoCancel(true);
            try {
                nm.notify(13370, builder.build());
            } catch (SecurityException ignored) {
                // POST_NOTIFICATIONS not granted: fall back to log only
                Log.w(TAG, "Notification permission missing; initial password logged locally");
            }
            Log.i(TAG, "Initial C2 password generated and shown once");
        } catch (Exception e) {
            Log.e(TAG, "Notification failed", e);
        }
    }

    public static String hashPassword(String password, String saltHex) throws Exception {
        byte[] salt = hexToBytes(saltHex);
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LENGTH);
        SecretKeyFactory skf = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] hash = skf.generateSecret(spec).getEncoded();
        return bytesToHex(hash);
    }

    private static String generateSalt() {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return bytesToHex(salt);
    }

    private static boolean slowEquals(String a, String b) {
        if (a == null || b == null) return false;
        int diff = a.length() ^ b.length();
        for (int i = 0; i < a.length() && i < b.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return data;
    }
}
