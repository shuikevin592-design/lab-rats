# 09 ⏤ Security Notes & Considerations  

> **Audience**: Operators, security researchers, and analysts evaluating threat models, transport security, forensic footprints, and attack surface mitigations on target deployments.

---

## 🔑 Authentication & Session Security

- **PBKDF2/SHA-256 On-Device Verification**: Passwords are authenticated on-device using PBKDF2 with SHA-256 hashing (`PasswordHasher.java`). **Patched**: iteration count raised to 210,000 and the plaintext / low-iteration fallback was removed.
- **Configurable Master Key**: There is **no shipped default password**. **Patched**: fresh deployments start with a random password (printed once on first server start) or the operator-supplied `C2_PASSWORD`; the old `admin1337` default is revoked and rejected everywhere.
- **Session Tokens**: **Patched**: the constant `AUTH_OK_1337` cookie is gone; sessions use a randomly generated token with a 1-day expiry and failed logins are rate-limited / delayed.
- **Emergency Password Reset**: **Removed**. The dial-code reset (`*#1337*0#` in the original source, documented as `*#7287#` in older revisions of this file) has been deleted — no dial code can reset the C2 password to a default value. `*#1337#` (launcher unmask only) remains.
- **Cache-Busting Resources**: CSS and JS dashboard assets append dynamic timestamp queries (`style.css?v=${Date.now()}`) to prevent stale browser session state exploits.

> **Security Mitigation**: Set a strong custom C2 password on first access; with the patched build there is no default to revoke, but treat any fresh install as unconfigured until you set it.

---

## 👑 Device Administration & Recent Apps Persistence

- **DeviceAdminReceiver Policy (`StabilityPolicy.java`)**: Implements an active `DeviceAdminReceiver` registered via `res/xml/device_admin.xml`.
- **Admin Elevation Trigger (`elevateAdmin`)**: Operators can remotely trigger Device Admin elevation via the Ghost tab.
- **Prevention of Force-Stop / Task Killing**:
  - **Recent Apps & Task Manager Shield**: Elevating privileges to Device Admin level prevents the application from being stopped or killed when swiped away in the **Recent Apps screen** or cleared by task-killer managers.
  - **Settings Force-Stop Lock**: Disables the OS-level "Force Stop" and "Uninstall" controls inside **Settings → Apps**.
  - **Remote Instant Screen Lock**: Allows instant hardware screen locking via `DevicePolicyManager`.
  - **Emergency Remote Wipe**: Grants permission for remote factory wipe/purge if deployed.

---

## 🌐 Transport Security & Relay Tunnels

- **Direct Mode Exposure**: In direct IPv6/IPv4 mode without a relay, traffic runs unencrypted on port `9191`. Basic authentication headers use reverse-base64 client-side obfuscation.
- **Patched — Loopback by Default**: The device C2 server now binds `127.0.0.1` by default instead of `0.0.0.0`; a public bind is opt-in. Remote reachability comes from the Render/tunnel relay path, not from an exposed local socket.
- **C2 Relay TLS Termination**: When connected via Webhook or Render C2 Relay tunnels (`server.js`), all operator-to-relay traffic is encrypted over HTTPS / TLS.
- **Base64 Frame Polling**: Video feeds (`/camera/frame` & `/ghost/screenshot`) poll JPEG buffers as Base64 Data URIs over HTTP/200 OK responses, avoiding unauthenticated WebSocket or proxy stream injection attacks.

> **Security Mitigation**: Do not expose direct port `9191` to untrusted networks without fronting the device with a TLS reverse proxy or using the Render C2 relay. With the patched build the port is loopback-bound unless you deliberately change it.

---

## 💾 Forensic Footprint & Data at Rest

- **Device Configuration Encryption**: Local properties (`WEBHOOK_URL`, `DECOY_CHOICE`) are encrypted with build-time `ENCRYPTION_KEY`. Because the key ships within the APK binary, it protects against casual device inspection, but not static binary reversing.
- **Exfiltrated Data Vaults**: Captured audio (`/audio`), photos (`/camera`), and keylogs (`/ghost`) are stored in app-private storage (`context.getFilesDir()`) or public storage if local backup is enabled.
- **Relay Server Disk**: Cloud relay storage (e.g. Render.com) is ephemeral; exfiltrated files stored in `/c2/downloads/` should be retrieved immediately.

---

## 👻 Ghost Control, Blackout & Package Visibility

- **Covert Screen Capture**: Screenshots taken during Blackout Mode (`screenBrightness = 0.001f`) capture the un-dimmed native screen buffer in 720p HD resolution without lighting distortion.
- **Package Visibility (`<queries>`)**: Implements strict Android 11+ (API 30–36) package visibility declarations in `AndroidManifest.xml` for `TTS_SERVICE` and system intents, preventing OS-level background service blocks.
- **Keylogger Encryption**: Keylogs are encrypted at rest and dynamically decrypted for display, highlighting sensitive patterns (credit cards, PINs, passwords) in red.

---

## 🛠️ Supply Chain & Build Automation

- **Dependency Cleanliness**: Carrier files and assets are generated locally during compilation without third-party remote code execution risks.
- **Android SDK Isolation**: `apk-builder/build.sh` auto-configures the local Android SDK path (`sdk.dir`), enforcing isolated local compilation.
- **Gradle Network Timeout**: Configured with a 120-second timeout (`networkTimeout=120000`) to prevent MITM/timeout interruptions during wrapper downloads.

### Patched Build Chain (v1.6 security patch)

| Change | Detail |
| :--- | :--- |
| GUI builder loopback | `gui_builder.js` / `gui_builder.py` bind `127.0.0.1` only (previously `0.0.0.0`). |
| GUI builder password | `POST /auth` exchanges `BUILD_PASSWORD` for a 60-minute in-memory token; `POST /build`, `/output/*` downloads and `/api/device-stats` reject requests without it. `BUILD_PASSWORD` comes from the environment or is randomly generated per launch and printed once in the console. |
| GUI default C2 removed | The pre-filled `https://lab-rats-v1-6.onrender.com` and `TacticalKey2026SecureGCM` values are gone. The C2 endpoint field is empty and **required**; empty or blocked values are rejected both client-side and server-side. |
| No default signing credentials | `build.bat` / `build.ps1` / `build.sh` / `binder.py` / `bind.sh` no longer fall back to `lab-rats123` / `lab-rats-key`; empty or blocked credentials abort the script. |
| Pre-build config validation | `WEBHOOK_URL` / `ENCRYPTION_KEY` equal to `''`, `AndroidKernel1337`, `TacticalKey2026SecureGCM` or `admin1337` abort the build before Gradle runs. |
| Dummy metadata assets removed | The random `metadata_1/2/3.dat` generation was deleted from the builders and the shipped files were deleted from `app/src/main/assets/sys/`. |
| SMS restart hardening | `!RESTART_C2` is whitelisted by sender and matched exactly; substring triggers are gone. |

See `apk-builder/PATCH_NOTES.md` for the per-file change log.

---

## 🕵️ Detection Indicators & Forensic Reduction

| Tell / Indicator | Risk Level | Mitigation Strategy |
| :--- | :--- | :--- |
| Default Package (`com.android.system.stability`) | Medium | Change `PKG_NAME` in `build_config.txt` / `build.sh` |
| Default Developer Signer (`CN=Lab-RATS`) | High | Generate a unique custom keystore per campaign |
| Device Admin & Accessibility Entry | Medium | Unavoidable — required for anti-kill & remote UI control |
| Persistent Service Notification | Low | Minimized to `IMPORTANCE_MIN` (silent / no sound) |
| Listening Port (`9191`) | Medium | Customize `PORT` constant in `Constants.java` |

---

## 🚫 Operational Limits & Threat Model Boundaries

- **Factory Reset**: Wiped if the target device undergoes a factory reset.
- **Non-Root Execution**: Runs within standard Android app process boundaries. Privileged operations (priv-app installation, system binary execution) require AOSP integration or `PrivilegedInstaller`.
- **Manual User Discovery**: Users navigating manually to **Settings → Apps → Special App Access** can view active Device Admin and Accessibility permissions.
