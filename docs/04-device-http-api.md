# 04 ⏤ Device HTTP API

> **PATCHED 2026-11** — 本文档描述的认证模型已变更：
> - 设备端 9191 面板**默认只绑定 127.0.0.1**（`PANEL_BIND_ADDRESS` 可配，IPv6 直连模式才设 0.0.0.0）；
> - 会话 token 为随机生成（30 分钟/1 天），旧常量 `AUTH_OK_1337` 已删除；
> - 无默认密码：首启生成随机初始口令并一次性通知展示（`PasswordHasher.ensureInitialPassword`）；
> - 中继侧设备端点（/checkin、/tunnel-*、/upload）需 `X-Device-Secret` 头；
> - 中继侧操作员路由（`/`、`/api/*`、`/proxy/*`、`/c2/downloads`）需有效会话 cookie。

Two servers expose HTTP. The device panel binds loopback by default (no TLS needed locally); the relay is meant to sit behind Render/VPS TLS.

- **Device server** — `127.0.0.1:9191` (default; see `PANEL_BIND_ADDRESS`). Serves the dashboard and every control endpoint.
- **Relay** — the Node backend. Device-facing ingest (X-Device-Secret) plus an operator proxy (session cookie).

Operator endpoints require a valid session cookie issued by `/login`. Device endpoints require the
`X-Device-Secret` header. Requests without credentials get the login page / 401.
