package com.labs.labrats;

import android.content.Context;

import com.labs.labrats.router.PasswordHasher;

import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public class SecurityTest {

    private Context context;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
    }

    @Test
    public void testPasswordHasherNoShippedDefault() {
        // Patched behavior: the published default password must NEVER authenticate.
        boolean validDefault = PasswordHasher.verifyPassword(context, "admin1337");
        Assert.assertFalse(validDefault);
    }

    @Test
    public void testPasswordHasherBootstrapAndVerification() {
        // First-run bootstrap generates a random password and stores its PBKDF2 hash.
        PasswordHasher.ensureInitialPassword(context);

        // A wrong password must fail against the bootstrapped hash.
        boolean invalidPass = PasswordHasher.verifyPassword(context, "wrongpass123");
        Assert.assertFalse(invalidPass);

        // An operator-set password must verify after savePassword.
        boolean saved = PasswordHasher.savePassword(context, "NewTacticalKey2026");
        Assert.assertTrue(saved);
        boolean validNew = PasswordHasher.verifyPassword(context, "NewTacticalKey2026");
        Assert.assertTrue(validNew);
    }

    @Test
    public void testPasswordHasherSaveNewPassword() {
        PasswordHasher.savePassword(context, "NewTacticalKey2026");

        boolean validNew = PasswordHasher.verifyPassword(context, "NewTacticalKey2026");
        Assert.assertTrue(validNew);

        boolean invalidOld = PasswordHasher.verifyPassword(context, "OldPassword123");
        Assert.assertFalse(invalidOld);
    }

    @Test
    public void testSystemAnalyticsEncryptionDecryption() {
        String testData = "CONFIDENTIAL_TELEMETRY_LOG_ENTRY_1337";
        byte[] encrypted = SystemAnalytics.encrypt(testData);

        Assert.assertNotNull(encrypted);
        Assert.assertTrue(encrypted.length > 0);

        String decrypted = SystemAnalytics.decrypt(encrypted);
        Assert.assertEquals(testData, decrypted);
    }
}
