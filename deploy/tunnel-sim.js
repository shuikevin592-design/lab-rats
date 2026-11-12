// tunnel-sim.js — Lab-RATS 设备端长轮询模拟器（仅用于本地 E2E 验证）
// 用法: node tunnel-sim.js <C2_BASE_URL> <deviceId>
// 行为: 模拟 App 内 C2_Tunnel.java —— GET /tunnel-poll 长轮询，
//       收到 {type:'request'} 后向 /tunnel-response 回传 base64 响应。
const http = require('http');

const base = (process.argv[2] || 'http://127.0.0.1:10000').replace(/\/+$/, '');
const deviceId = process.argv[3] || 'SIM-DEV-01';
const secret = process.argv[4] || process.env.DEVICE_SECRET || 'sim-device-secret';

function poll() {
  const req = http.get(`${base}/tunnel-poll?deviceId=${encodeURIComponent(deviceId)}`, {
    headers: { 'X-Device-Secret': secret },
  }, (res) => {
    let buf = '';
    res.on('data', (c) => (buf += c));
    res.on('end', () => {
      buf = buf.trim();
      if (!buf || buf === '{}') return setTimeout(poll, 50);
      let cmd;
      try { cmd = JSON.parse(buf); } catch (e) { return setTimeout(poll, 50); }
      if (cmd && cmd.type === 'request') {
        console.log(`[SIM] got command: ${cmd.method} ${cmd.path}`);
        const payload = Buffer.from(`SIM_OK ${cmd.method} ${cmd.path}`, 'utf8').toString('base64');
        const body = JSON.stringify({
          id: cmd.id, status: 200, contentType: 'text/plain', payload,
        });
        const post = http.request(`${base}/tunnel-response`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'X-Device-Secret': secret,
          },
        }, (r2) => { r2.resume(); r2.on('end', () => setTimeout(poll, 50)); });
        post.on('error', () => setTimeout(poll, 1000));
        post.write(body);
        post.end();
      } else {
        setTimeout(poll, 50);
      }
    });
  });
  req.on('error', () => setTimeout(poll, 1000));
}
poll();
console.log(`[SIM] polling ${base}/tunnel-poll?deviceId=${deviceId}`);
