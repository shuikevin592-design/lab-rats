# PATCH_NOTES — C2 服务端安全修补（task-5）

- 范围: c2-server/server.js、render.yaml（根）、deploy/（文档/脚本）
- 验证环境: Windows + Node v26.13.1，端口 10002
- 修补前基线问题见 VERIFY_LOG.md 前 7 节；本文件为修复前后对比。

---

## 1. 鉴权（高危 → 已修复）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 操作员路由鉴权 | 中间件 `return next()` 整体旁路；`/`、`/api/*`、`/proxy/*`、`/c2/downloads` 全部匿名可访问 | 真鉴权中间件：无 session 时 `GET /` → 302 `/login`；`/api/*`、`/proxy/*` → 401 JSON；下载 → 401 |
| 会话 token | 常量 `c2_auth_token=AUTH_OK_1337`，人人可伪造 | `crypto.randomBytes(32).toString('hex')`，存内存 Map，30 分钟过期（Max-Age=1800，定时清理，访问时校验） |
| 登录页 | GET /login 落入 /proxy catch-all，25s 后 504 | 新增 `app.get('/login')`，匿名可达 200 |
| 匿名面 | `/`、`/c2/*.css|js`、`/login`、`/healthz` 保持匿名；面板无 session 时不渲染任何设备数据（302 走人） | 同左（按要求保留） |
| 下载 | 静态目录无鉴权，文件名可预测 | 须有效 session（cookie 或 `?token=`），否则 401 |

## 2. 口令策略（高危 → 已修复）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 默认口令 | `C2_PASSWORD \|\| 'admin1337'` 兜底，明文比较 | 删除兜底：未设置或等于 `admin1337` → 启动 `process.exit(1)` + FATAL 日志；<12 字符打印警告 |
| 比较方式 | `password === validPass` | `crypto.timingSafeEqual`（长度先行比对） |
| 暴力破解 | 无限制 | 按 IP 计 5 次失败锁 10 分钟（内存 Map），第 6 次即使口令正确也 LOCKED |

## 3. 设备凭据（高危 → 已修复）

| 项 | 修复前 | 修复后 |
|---|---|---|
| /checkin、/tunnel-poll、/tunnel-response、/upload | 完全匿名，deviceId 可冒用劫持命令队列 | 统一要求 `X-Device-Secret` 头，与 `DEVICE_SECRET` 环境变量 timingSafeEqual；未配置 DEVICE_SECRET 时启动打警告、端点全 401 |
| GET /?ip= 根路径 check-in | 匿名 | 带合法 device secret 时放行（guard 分支），否则按面板处理（302） |
| 对齐 | — | 与 App 侧约定：build-env 经 local.properties 把同一 secret 注入 BuildConfig，App 端由并行任务改造发送该头 |

## 4. 存储型 XSS（高危 → 已修复）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 面板渲染 checkin 字段 | model/brand/alias/ip/deviceId 原样拼接 HTML（`<script>alert(1)</script>` 原样回显，已实测） | 新增 `escapeHtml()` 统一转义显示字段（deviceId/brand/model/alias/ip/port/os/battery、exfil 文件名/设备标签/download 属性）；内联 onclick 参数走 `jsStr()`（反斜杠/引号/<> 转义）；登录错误回显同样转义 |

## 5. /upload 加固（中危 → 已修复）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 大小 | 无上限（express 50mb 限制不作用于手工 multipart 解析） | 50MB：Content-Length 预检 413 + 流式累计超限 413 并断开连接 |
| 类型 | 任意扩展名落盘 | 扩展名白名单 jpg/jpeg/png/gif/webp/bmp/mp4/m4a/aac/3gp/amr/wav/mp3/txt/log/json/zip/pdf；其余 400 `File extension not allowed` |

## 6. 部署配置

- render.yaml（根，已改）：新增 envVars `C2_PASSWORD`（sync:false，占位 CHANGE_ME_STRONG_PASSPHRASE）、`DEVICE_SECRET`（sync:false，占位 CHANGE_ME_DEVICE_SECRET）、`NODE_ENV=production`；healthCheckPath 由 `/` 改为 `/healthz`（匿名 200，避免 302 影响健康检查）；buildCommand 保持 `npm install --omit=dev`。
- deploy/.env.example 同步 DEVICE_SECRET 与强约束说明；deploy/render.yaml.fixed 与根 render.yaml 保持一致。

## 7. 修补后验证结果（详录于 VERIFY_LOG.md §8）

- 启动策略: 无 C2_PASSWORD / `admin1337` → exit 1 + FATAL ✓
- 匿名面: /healthz 200、/login 200、/c2/style.css 200 ✓
- 无 session: GET / → 302 /login ✓；/api/rename-device → 401 ✓；/proxy → 401 ✓；下载 → 401 ✓
- 登录: 正确口令 → 302 + 64hex 随机 token ✓；5 次失败 → 第 6 次 LOCKED ✓；`?token=` 有效 token 200 / 伪造 401 ✓
- 设备端点: 无 secret 全 401 ✓；带 secret check-in/上传/长轮询 ✓
- XSS: `<script>` check-in 面板显示为 `&lt;script&gt;` ✓
- 上传: txt 200、.exe 400、声明 51MB 413、真实 51MB 413 ✓
- E2E: 带 cookie /proxy 下发 → 模拟器 SIM_OK 回传 ✓（2 连发稳定）；GET /?ip= 带 secret check-in ✓ / 无 secret 302 ✓

## 8. 遗留说明（未在本任务范围）

- session 为内存存储：进程重启后所有会话失效（可接受，后续可换 Redis）。
- 登录锁定亦为内存存储，重启即清零。
- cookie 未加 Secure：Render 全链路 HTTPS 下建议后续补上（改 Set-Cookie 处）。
- formatTime 仍硬编码 America/Toronto（TZ env 无效），面板显示问题非安全项。
- 设备端 App 改造（发送 X-Device-Secret、口令哈希升级）由并行任务负责；两端 secret 必须一致，见 .env.example 与 render.yaml 注释。
