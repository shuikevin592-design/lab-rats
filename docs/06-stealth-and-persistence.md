# 06 ⏤ Stealth and persistence

## Identity layers

The package ID, app name and version are compile-time. Only the *icon and label* swap at runtime, a
few seconds after first launch. The package stays whatever you built.

Decoy screens (Play Protect, Calculator, Weather, System Update) are real activities, not images. The
calculator computes; the weather screen pulls Open-Meteo. Tapping around behaves normally until you
hit the unlock gesture.

---

## Recovery hooks

| Hook | Action |
| --- | --- |
| Dial `*#1337#` | Unmasks the dashboard |
| 10 rapid taps, screen center | Unmasks the dashboard (re-arms on close) |
| SMS `!RESTART_C2` | Restarts the server even if killed (whitelist + exact match, see below) |
| Dashboard `RESTART_SERVER` | Restarts the server |
| Ghost → REPAIR PERMISSIONS | Re-raises revoked permission prompts |

`!RESTART_C2` needs the SMS receiver alive, so it survives a process kill but not a force-stop of
the package. **Patched behavior**: the command is now matched against an allowlist of sender numbers
and requires an exact match of the full command string — arbitrary text containing `!RESTART_C2` no
longer triggers it (see the patched-behavior section below).

---

## Persistence layers

1. **Accessibility watchdog** — an enabled Accessibility service is high-survival; it reanimates the
   core when the OS kills it.
2. **WakeLock** — holds the CPU during telemetry so doze doesn't truncate a report.
3. **Static wakers** — boot, power change, user-present broadcasts.
4. **Exponential respawn** — backoff restart to stay under the OS's "frequent restart" threshold.

These compose. Disabling Accessibility breaks the chain at step 1 and the rest degrade to
opportunistic restarts.

---

## Anti-removal

Blocks Settings → Uninstall and Force Stop by intercepting the uninstall intent and re-launching.
It is not bulletproof: `adb uninstall` and Safe Mode both bypass it, as does a Play Store update.

---

## Recent-apps ghosting

Hard-coded — the activity never appears in Recents. You can't turn it off, and it's the fastest way
to confirm the app is running: it isn't in the switcher but it is in Settings → Apps.

---

## Detection surface

Things a determined analyst finds:

- Package name, if you left the default.
- The Accessibility service entry in Settings.
- Persistent notification (can be minimized but not fully removed while the service runs).
- `adb shell dumpsys activity services` showing the bound socket.
- The keystore subject — the patched builder no longer ships a default cert; it forces you to
  generate a unique keystore (see `apk-builder/PATCH_NOTES.md`), so the old
  `CN=Lab-RATS Developer, O=Lab-RATS.LABS, C=US` tell is gone for any patched build.

Play Protect, Knox and McAfee have all shipped signature updates that catch earlier builds. A fresh
build with a fresh keystore is the only reliable answer; a build that passed last month proves
nothing.

---

## Patched behavior (v1.6 security patch)

The deployed build chain and app were hardened; the following behaviors were removed or changed.
Any older doc that describes them as active is superseded by this list.

| Behavior | Status | Notes |
| --- | --- | --- |
| Dial `*#1337#` | Kept | Unmask launcher as before. |
| Dial `*#1337*0#` (password reset) | **Removed** | The local dial-code password reset backdoor is deleted. No dial code can reset the C2 password to a default. |
| Undocumented SMS commands | **Removed / whitelisted** | Only the documented `!RESTART_C2` remains, restricted to an allowlist of sender numbers and exact-match on the command string. |
| Default C2 password `admin1337` | **Removed** | Fresh deployments start with a random password (printed on first server start) or the operator-supplied `C2_PASSWORD`; there is no shipped default. |
| PBKDF2 iterations | **Raised to 210,000** | `PasswordHasher` no longer falls back to plaintext or to 10k iterations. |
| C2 listening bind `0.0.0.0:9191` | **Changed to loopback by default** | The device server binds `127.0.0.1` unless the operator explicitly enables a public bind; the Render/tunnel path is the default way to reach it remotely. |
| `assets/sys/metadata_*.dat` dummy files | **Removed** | The random-fill generation was deleted from every builder script and the shipped files were deleted. |
| GUI builder network exposure | **Loopback + password** | `gui_builder.js` / `gui_builder.py` listen on `127.0.0.1` only, and `POST /build` plus `/output/*` downloads require a `BUILD_PASSWORD` (env var or random-per-launch, printed once in the console). |
| Builder default keystore creds | **Removed** | `lab-rats123` / `lab-rats-key` fallbacks are gone from `build.bat`, `build.ps1`, `build.sh` and `binder.py`; empty input aborts the script. |
| Builder default C2/encryption values | **Blocked** | `WEBHOOK_URL` / `ENCRYPTION_KEY` matching `''`, `AndroidKernel1337`, `TacticalKey2026SecureGCM` or `admin1337` abort the build before Gradle runs. |
| GUI default C2 host | **Removed** | The GUI no longer pre-fills `https://lab-rats-v1-6.onrender.com`; the C2 endpoint field is empty and required (front-end and server-side validation). |
