# PATCH_NOTES.md — 构建链修补记录（task-7）

> 修补人：stealth-verify · 范围：apk-builder/**、docs/**、README.md、patches/
> 目标：删除公开默认值（C2 host / 密钥 / keystore 凭据）、GUI 本机化+口令化、删除 metadata 障眼资产、文档同步。
> 说明：app/ 与 c2-server/ 由并行任务修补（去后门 / PBKDF2 / 回环绑定 / SMS 白名单），本文件只记录构建链侧改动。

## 1. gui_builder.js（node GUI 构建器）

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| 顶部（原 1-13 行） | 引入 `crypto`；新增 `BUILD_PASSWORD`（`process.env.BUILD_PASSWORD`，未设置则 `randomBytes(12)` 随机生成）；新增内存 `SESSION_TOKENS`（60 分钟 TTL）与 `BLOCKED_VALUES` 集合 | 构建接口需要口令门禁；封锁值集中管理 |
| HTML 原 103 行 | C2 endpoint 输入框 `value="https://lab-rats-v1-6.onrender.com"` → `value=""` + placeholder，标签加 `(REQUIRED)` | 删除作者默认 C2 host，杜绝流量默认指向作者域 |
| HTML 原 105 行 | 加密密钥 `value="TacticalKey2026SecureGCM"` → `value=""` + placeholder（留空自动生成） | 删除公开默认密钥 |
| Build 页（原 221-225 行区域） | 新增 `BUILD_PASSWORD` 口令输入框 + UNLOCK 按钮 | 前端口令入口 |
| 前端 JS（原 270-316 行） | `runBuildPipeline`：无 token 直接拒绝；`cfg-host` 为空或命中封锁名单直接拒绝并报错；请求带 `x-build-token` 头；下载链接拼 `?token=`；新增 `unlockBuilder()` 调 `/auth` 换取 token；`pollDeviceTelemetry` 也带 token | C2 必填校验（前端）+ 会话口令化 |
| 服务端 `/build`（原 403-411 行） | 无 token → 401；`c2Host` 改为**必填**并校验封锁名单（空/onrender/默认密钥 → 400 拒绝）；`encKey` 空 → `crypto.randomBytes` 自动生成，封锁值 → 400 | 服务端兜底校验，防止绕过前端 |
| 服务端 `/build`（原 456-464 行） | **删除** metadata_1/2/3.dat 随机填充生成块 | 障眼资产移除（任务 3） |
| 服务端 `/build`（原 467 行） | `./gradlew` → 平台感知 `gradlew.bat`（win32）/`./gradlew` | Windows 下原命令必然失败 |
| 服务端新增 | `POST /auth`：校验 BUILD_PASSWORD，签发 60 分钟 token | 口令门禁 |
| `/output/`（原 511-527 行） | 下载前 `isAuthorized()` 校验（header 或 `?token=`），失败 401；`basename` 改用去 query 的 path | 未授权不能拉取 APK |
| `/api/device-stats` | 同样要求 token | 设备遥测不外泄 |
| `server.listen`（原 534 行） | `'0.0.0.0'` → `'127.0.0.1'`；控制台打印 BUILD_PASSWORD 及来源说明；浏览器打开 `127.0.0.1` URL | 仅本机可访问 + 随机口令公示 |

## 2. gui_builder.py（python GUI 构建器）

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| 顶部（原 1-13 行） | `import secrets`；`BUILD_PASSWORD`（env 或 `secrets.token_hex(12)`）；`SESSION_TOKENS`/`BLOCKED_VALUES` | 与 js 版对齐 |
| HTML 原 98/100 行 | C2 endpoint 与密钥默认值置空 + placeholder | 同上 |
| Build 页 | 新增口令输入框 + UNLOCK 按钮 | 同上 |
| 前端 JS（原 198-243 行） | 与 js 版相同的必填校验 + token 流程 + 下载 `?token=` | 同上 |
| `BuilderHandler` | 新增 `_authorized()`；`/output/` 无 token → 401；新增 `POST /auth`；`/build` 无 token → 401 | 同上 |
| `do_POST /build`（原 275-311 行） | `c2_host` 必填 + 封锁名单校验；`enc_key` 空则 `secrets.token_urlsafe` 生成、封锁值拒绝；**新增** `local.properties` 的 `WEBHOOK_URL`/`ENCRYPTION_KEY` 写入（原 py 版从未写入，C2 配置实际不生效） | 修正 py 版构建配置落盘缺失 + 校验 |
| `do_POST /build`（原 291 行） | `./gradlew` → 平台感知 wrapper | Windows 修复 |
| `main()`（原 332 行） | `TCPServer(("", PORT))` → `("127.0.0.1", PORT)`；打印 BUILD_PASSWORD | 仅本机监听 |

## 3. build.ps1

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| `New-Keystore`（原 85-90 行） | 删除 `[lab-rats-key]`/`[lab-rats123]` 默认兜底：alias 为空 → 报错 `exit 1`；密码为空/`lab-rats123`/不足 12 位 → 报错 `exit 1`；dname 改为 `CN=Android System, O=Local Build, C=US` | 删除公开默认凭据；证书主题去品牌化 |
| `Set-AppConfig`（原 176-182 行） | **删除** metadata_*.dat 随机生成块 | 任务 3 |
| `Set-AppConfig` 末尾 | 新增：`WEBHOOK_URL`/`ENCRYPTION_KEY` 命中封锁名单（空、AndroidKernel1337、TacticalKey2026SecureGCM、admin1337、lab-rats123）→ `exit 1` | 配置期即时拦截 |
| 新增 `Test-BuildConfig` + `Build-Apk` 开头 | 构建前读 `local.properties` 校验两个值非封锁值，命中 → 中止构建并说明 | 构建期兜底校验（任务 2） |

## 4. build.bat

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| `:generate_keystore`（原 76-94 行） | 默认 `lab-rats-key`/`lab-rats123` 删除：alias/密码为空 → `exit /b 1`；密码 = `lab-rats123` 或 <12 位 → `exit /b 1`；dname 去品牌化 | 同上 |
| `:configure_app`（原 159-165 行） | `WEB_URL` 为空或封锁值（AndroidKernel1337 / TacticalKey2026SecureGCM / admin1337 / lab-rats123）→ `exit /b 1`；`RAND_KEY` 同校验 | 同上 |
| `:configure_app`（原 172-174 行） | **删除** metadata 生成块 | 任务 3 |
| 新增 `:validate_config` + `:build_apk` 开头调用 | 构建前读 local.properties 校验 WEBHOOK_URL/ENCRYPTION_KEY 非封锁值，命中 → 中止 | 任务 2 |

## 5. build.sh

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| `generate_keystore`（原 144-145 行） | 删除 `${ALIAS:-lab-rats-key}` / `${PASS:-lab-rats123}` 兜底：空 → `return 1`；`lab-rats123` 或 <12 位 → `return 1`；dname 去品牌化 | 同上 |
| `configure_app`（原 200-206 行区域） | `WEB_URL` case 封锁名单（空/AndroidKernel1337/TacticalKey2026SecureGCM/admin1337/lab-rats123）→ `return 1`；`RAND_KEY` 同校验 | 同上 |
| `configure_app`（原 244-247 行） | **删除** metadata `head -c 512 /dev/urandom` 生成块 | 任务 3 |
| 新增 `validate_config` + `build_apk` 开头调用 | 构建前校验两个值非封锁值，命中 → 中止 | 任务 2 |

## 6. binder.py

| 位置（修补后行） | 改动 | 理由 |
| --- | --- | --- |
| `--storepass`（原 396 行） | 删除 `default="lab-rats123"` → `required=True` | 删除默认密码兜底 |
| `--keyalias`（原 397 行） | 删除 `default="lab-rats-key"` → `required=True` | 删除默认别名兜底 |
| `main()` 校验 | 新增封锁凭据检查：`storepass` 为空/`lab-rats123`/`admin1337`/`AndroidKernel1337`/`TacticalKey2026SecureGCM` 或 <12 位 → 退出；`keyalias` 为封锁值 → 退出 | 任务 2 |

## 7. bind.ps1 / bind.sh（一致性修补，任务清单外但同属"无默认凭据"目标）

| 位置 | 改动 | 理由 |
| --- | --- | --- |
| bind.ps1（原 45 行） | binder.py 调用改为传递 `--storepass/--keyalias/--keystore`（从 `keystore.properties` 读取，缺失 → 提示并 `exit 1`）；banner ASCII 化修复解析器编码问题 | binder.py 参数改为 required 后原调用必然失败 |
| bind.sh（原 554-563 行） | **删除**"缺 keystore 自动用 lab-rats123 生成"块；改为从 `keystore.properties` 读凭据，缺失 → 报错退出；签名命令用读到的值 | 删除 sh 侧公开默认凭据 |

## 8. 资产删除

| 文件 | 动作 |
| --- | --- |
| `app/src/main/assets/sys/metadata_1.dat` / `metadata_2.dat` / `metadata_3.dat` | 已删除（三文件均为 512 字节随机填充，无任何代码引用；生成逻辑已从 build.bat/build.ps1/build.sh/gui_builder.js 全部移除） |

## 9. 文档同步

| 文件 | 改动 |
| --- | --- |
| README.md | ① 默认密码节改为"无默认密码（随机/`C2_PASSWORD`）"；② `*#1337#` 节注明 `*#1337*0#` 重置已删除；③ `!RESTART_C2` 节注明白名单+精确匹配；④ 新增 "Security Hardening Applied (patched build)" 一节 |
| docs/06-stealth-and-persistence.md | ① Recovery hooks 表更新 `!RESTART_C2` 行为；② keystore subject 提示更新（新 builder 强制自建证书）；③ 新增 "Patched behavior (v1.6 security patch)" 表（12 项变更） |
| docs/09-security-notes.md | ① 认证节更新（PBKDF2 210k、无默认密码、AUTH_OK_1337 移除、`*#7287#`/`*#1337*0#` 已删除）；② 传输节加"回环默认绑定"；③ 供应链节新增 "Patched Build Chain" 表 |

## 验证

- `node --check gui_builder.js` → OK
- `python -m py_compile gui_builder.py` / `binder.py` → OK
- PowerShell Parser 校验 `build.ps1` / `bind.ps1` → 无语法错误
- 封锁值 grep：`lab-rats123`/`lab-rats-key` 仅存在于封锁名单与提示文案中；`lab-rats-v1-6.onrender.com`/`TacticalKey2026SecureGCM` 仅存在于 BLOCKED 名单中
- metadata 生成逻辑全库 grep → 0 命中；三个 dat 文件已删除
