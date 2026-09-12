#!/usr/bin/env python3
"""朝夕 · 云端同步服务器（开发/自建版）

纯标准库实现（http.server + sqlite3），单文件可直接部署到任意机器：
    python tools/cloud-server.py --port 8787

接口契约（与客户端 src/cloud.ts 对应）：
    GET  /api/health                    → { ok, name, version }
    POST /api/register {email,password} → { token, userId, email }
    POST /api/login    {email,password} → { token, userId, email }
    POST /api/logout                    → { ok }             (Bearer)
    GET  /api/sync?since=<seq>          → { seq, changes }   (Bearer)
    POST /api/sync   {changes}          → { seq }            (Bearer)
    GET  /api/app/latest               → { ok, latest, date, urls }（应用版本检测）

同步模型：每条记录一个版本（LWW，updatedAt/deletedAt 大者胜），
服务器为每个用户维护自增 seq，客户端按 cursor 增量拉取。

微信扫码登录（需微信开放平台「网站应用」AppID/AppSecret）：
    POST /api/wechat/qr               → { state, qrUrl, mode }   (创建扫码会话)
    GET  /api/wechat/poll?state=<s>   → { status, token?... }    (客户端轮询)
    GET  /api/wechat/callback?code=.. (微信回调，由微信服务器/手机浏览器访问)
未配置 AppID 时为开发模拟模式：qrUrl 指向本服务 /dev/wechat-scan，
在浏览器打开即等价于“已用微信扫码确认”（仅用于联调/测试）。

配置（优先级：命令行 --config > 同名目录 cloud-config.json）：
    { "public_url": "https://todo.example.com", "wx_appid": "...", "wx_secret": "..." }

安全说明（v1）：密码 PBKDF2-SHA256 加盐哈希；令牌随机 32 字节；
认证类接口按 IP 限流（60 次/分钟）。生产部署建议：置于 HTTPS 反向
代理（Nginx/Caddy）之后，详见 deploy/README.md。
"""
import argparse
import hashlib
import json
import os
import secrets
import smtplib
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

VERSION = "1.0.0"
LOCK = threading.Lock()
DB_PATH = "zhaoxi-cloud.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pw TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  openid TEXT,
  provider TEXT NOT NULL DEFAULT 'password',
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS changes (
  user_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, table_name, record_id)
);
CREATE TABLE IF NOT EXISTS seqs (user_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wx_sessions (
  state TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT,
  token TEXT,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_regs (
  email TEXT PRIMARY KEY,
  pw TEXT NOT NULL,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires INTEGER NOT NULL,
  sent_at INTEGER NOT NULL
);
"""

CONFIG = {
    "public_url": "",
    "wx_appid": "",
    "wx_secret": "",
    "smtp_host": "",
    "smtp_port": 465,
    "smtp_tls": "ssl",
    "smtp_user": "",
    "smtp_pass": "",
    "smtp_from": "",
    "dev_echo_code": False,
}

# 应用版本信息文件（与 cloud-config.json 同目录；发版时更新 app-release.json）
APP_RELEASE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app-release.json")

# 简易按 IP 限流：{ip: [ts, ...]}，认证类接口 60 次/分钟
RATE: dict = {}
RATE_LIMIT = 60
RATE_WINDOW = 60.0


def rate_ok(ip: str) -> bool:
    now = time.time()
    with LOCK:
        stamps = [t for t in RATE.get(ip, []) if now - t < RATE_WINDOW]
        if len(stamps) >= RATE_LIMIT:
            RATE[ip] = stamps
            return False
        stamps.append(now)
        RATE[ip] = stamps
    return True


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def hash_pw(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()


def gen_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def code_hash(code: str, email: str) -> str:
    return hashlib.sha256((code + "|" + email).encode()).hexdigest()


FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
MONO = "'SF Mono','Cascadia Mono',Consolas,Menlo,monospace"
BRAND_GRADIENT = "linear-gradient(150deg,#7d6efb 0%,#635be8 55%,#4f45d0 100%)"


def render_code_email(code: str) -> str:
    """注册验证码 HTML 邮件：品牌化卡片、表格布局 + 内联样式（兼容 QQ / 阿里 / Outlook 降级）。"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>朝夕 · 邮箱验证码</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">你的验证码是 {code}，10 分钟内有效。</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;">
<tr><td align="center" style="padding:46px 16px 42px;">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">
    <tr><td align="center" style="padding-bottom:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;border-radius:10px;background-color:#635be8;background-image:{BRAND_GRADIENT};color:#ffffff;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;line-height:34px;">&#10003;</td>
        <td style="padding-left:11px;font-family:{FONT};font-size:17px;font-weight:600;color:#1d1d1f;letter-spacing:3px;">朝夕</td>
      </tr></table>
    </td></tr>
    <tr><td style="background-color:#ffffff;border-radius:18px;border:1px solid #ececf1;overflow:hidden;box-shadow:0 12px 32px rgba(24,24,60,0.08);">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="4" style="height:4px;line-height:4px;font-size:0;border-radius:18px 18px 0 0;background-color:#635be8;background-image:{BRAND_GRADIENT};">&nbsp;</td></tr>
        <tr><td style="padding:36px 38px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-family:{FONT};font-size:19px;font-weight:600;color:#1d1d1f;padding:0 0 10px;">验证你的邮箱</td></tr>
            <tr><td style="font-family:{FONT};font-size:14px;line-height:1.75;color:#6e6e73;padding:0 0 24px;">你正在注册「朝夕」，请在应用内输入以下验证码完成邮箱验证：</td></tr>
            <tr><td align="center" style="padding:0 0 22px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" style="background-color:#f3f1ff;border:1px solid #ded7fe;border-radius:14px;padding:21px 12px;">
                  <div style="font-family:{MONO};font-size:42px;font-weight:700;color:#5348d6;letter-spacing:10px;padding-left:10px;">{code}</div>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="font-family:{FONT};font-size:12.5px;line-height:1.8;color:#7a7a80;padding:0 0 22px;">验证码 <b style="color:#5c5c62;">10 分钟</b>内有效。为保障账号安全，请勿将验证码转发或告知他人。</td></tr>
            <tr><td style="border-top:1px solid #e9e9f0;padding:18px 0 0;font-family:{FONT};font-size:12px;line-height:1.8;color:#8b8b92;">如果这不是你本人的操作，忽略本邮件即可 —— 你的邮箱不会被注册。</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:24px 8px 0;font-family:{FONT};font-size:11.5px;line-height:1.9;color:#8b8b92;">朝夕 · 朝有所为，夕有所成<br>本邮件由系统自动发送，请勿直接回复</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


def send_mail(to: str, subject: str, text_body: str, html_body: str = ""):
    """返回 (ok, err)。smtp_tls: ssl / starttls / none（none 仅本机联调用）
    注意：中文显示名/主题必须按 RFC2047 编码，否则 QQ 等严格收件方会 550 拒收。
    html_body 非空时发 multipart/alternative（HTML + 纯文本兜底）。"""
    host = CONFIG["smtp_host"]
    if not host:
        return False, "未配置 SMTP"
    from_addr = CONFIG["smtp_from"] or CONFIG["smtp_user"] or f"no-reply@{host}"
    if html_body:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
        msg = MIMEText(text_body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = f"{Header('朝夕', 'utf-8').encode()} <{from_addr}>"
    msg["To"] = to
    try:
        mode = CONFIG["smtp_tls"]
        if mode == "ssl":
            srv = smtplib.SMTP_SSL(host, CONFIG["smtp_port"], timeout=12)
        else:
            srv = smtplib.SMTP(host, CONFIG["smtp_port"], timeout=12)
        with srv:
            if mode == "starttls":
                srv.starttls()
            if CONFIG["smtp_user"]:
                srv.login(CONFIG["smtp_user"], CONFIG["smtp_pass"])
            srv.sendmail(from_addr, [to], msg.as_string())
        return True, ""
    except Exception as exc:
        return False, str(exc)


def json_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0 or length > 8 * 1024 * 1024:
        return None
    try:
        return json.loads(handler.rfile.read(length).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def bearer_user(conn, handler):
    auth = handler.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    row = conn.execute("SELECT user_id FROM tokens WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    return row["user_id"]


def next_seq(conn, user_id: str) -> int:
    row = conn.execute("SELECT seq FROM seqs WHERE user_id = ?", (user_id,)).fetchone()
    seq = (row["seq"] if row else 0) + 1
    conn.execute(
        "INSERT INTO seqs (user_id, seq) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seq = ?",
        (user_id, seq, seq),
    )
    return seq


def upsert_record(conn, user_id: str, table: str, record_id: str, payload, updated_at: int, deleted: int) -> bool:
    if not isinstance(record_id, str) or not record_id or not isinstance(updated_at, (int, float)):
        return False
    updated_at = int(updated_at)
    row = conn.execute(
        "SELECT updated_at FROM changes WHERE user_id=? AND table_name=? AND record_id=?",
        (user_id, table, record_id),
    ).fetchone()
    if row and row["updated_at"] >= updated_at:
        return False
    seq = next_seq(conn, user_id)
    conn.execute(
        "INSERT INTO changes (user_id, table_name, record_id, payload, updated_at, deleted, seq) "
        "VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, table_name, record_id) "
        "DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at, deleted=excluded.deleted, seq=excluded.seq",
        (user_id, table, record_id, json.dumps(payload, ensure_ascii=False) if payload is not None else None, updated_at, deleted, seq),
    )
    return True


# ── 微信扫码登录 ───────────────────────────────────────

def base_url(handler) -> str:
    if CONFIG["public_url"]:
        return CONFIG["public_url"].rstrip("/")
    host = handler.headers.get("Host") or f"127.0.0.1:{handler.server.server_port}"
    return f"http://{host}"


def complete_wx_session(conn, state: str, openid: str):
    """扫码确认：找到/创建微信用户并签发令牌，会话置为 done。"""
    row = conn.execute("SELECT id FROM users WHERE openid = ?", (openid,)).fetchone()
    if row:
        user_id = row["id"]
        email = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()["email"]
    else:
        user_id = secrets.token_hex(12)
        email = f"wx_{openid}@wechat.local"
        conn.execute(
            "INSERT INTO users (id, email, openid, provider, created) VALUES (?,?,?,?,?)",
            (user_id, email, openid, "wechat", int(time.time())),
        )
    token = secrets.token_hex(32)
    conn.execute("INSERT INTO tokens (token, user_id, created) VALUES (?,?,?)", (token, user_id, int(time.time())))
    conn.execute("UPDATE wx_sessions SET status='done', user_id=?, token=? WHERE state=?", (user_id, token, state))
    return token, user_id, email


def wx_html(title: str, desc: str) -> bytes:
    return (
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"/>"
        f"<title>{title}</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/></head>"
        "<body style=\"font-family:-apple-system,'Segoe UI',sans-serif;display:grid;place-items:center;"
        "min-height:100vh;margin:0;background:#f6f6f9;color:#2a2a33\">"
        "<div style=\"text-align:center;padding:40px 30px;background:#fff;border-radius:20px;"
        "box-shadow:0 10px 40px rgba(20,20,40,.08)\">"
        f"<h1 style=\"font-size:20px;margin:6px 0 10px\">{title}</h1>"
        f"<p style=\"color:#8a8a96;font-size:14px;margin:0;line-height:1.7\">{desc}</p>"
        "</div></body></html>"
    ).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "ZhaoxiCloud/" + VERSION

    def log_message(self, fmt, *args):  # 静音逐请求日志，保留错误
        sys.stderr.write("[cloud] " + fmt % args + "\n")

    def _send(self, code: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def _html(self, code: int, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            return self._send(200, {"ok": True, "name": "zhaoxi-cloud", "version": VERSION})
        if parsed.path == "/api/app/latest":
            # 应用版本检测：优先本地 app-release.json（国内直连）；兜底 GitHub；均不可用则 503
            info = load_app_release()
            if info:
                merged = dict(info)
                merged["source"] = "server"
                return self._send(200, {"ok": True, **merged})
            gh = fetch_github_latest()
            if gh:
                return self._send(200, {"ok": True, **gh})
            return self._send(503, {"error": "版本信息暂不可用"})
        if parsed.path == "/api/sync":
            conn = db()
            try:
                user_id = bearer_user(conn, self)
                if not user_id:
                    return self._send(401, {"error": "未登录或令牌无效"})
                since = int((parse_qs(parsed.query).get("since") or ["0"])[0] or 0)
                seq_row = conn.execute("SELECT seq FROM seqs WHERE user_id = ?", (user_id,)).fetchone()
                seq = seq_row["seq"] if seq_row else 0
                todos, notes, tombstones = [], [], []
                rows = conn.execute(
                    "SELECT table_name, record_id, payload, updated_at, deleted FROM changes "
                    "WHERE user_id = ? AND seq > ? ORDER BY seq",
                    (user_id, since),
                ).fetchall()
                for r in rows:
                    if r["deleted"]:
                        tombstones.append({"table": r["table_name"], "id": r["record_id"], "deletedAt": r["updated_at"]})
                        continue
                    item = json.loads(r["payload"])
                    (todos if r["table_name"] == "todos" else notes).append(item)
                return self._send(200, {"seq": seq, "changes": {"todos": todos, "notes": notes, "tombstones": tombstones}})
            finally:
                conn.close()
        if parsed.path == "/api/wechat/poll":
            conn = db()
            try:
                state = (parse_qs(parsed.query).get("state") or [""])[0]
                row = conn.execute("SELECT status, user_id, token, created FROM wx_sessions WHERE state = ?", (state,)).fetchone()
                if not row:
                    return self._send(404, {"status": "unknown"})
                if row["status"] == "pending" and time.time() - row["created"] > 600:
                    conn.execute("UPDATE wx_sessions SET status='expired' WHERE state=?", (state,))
                    conn.commit()
                    return self._send(200, {"status": "expired"})
                if row["status"] == "done":
                    email_row = conn.execute("SELECT email FROM users WHERE id = ?", (row["user_id"],)).fetchone()
                    return self._send(200, {"status": "done", "token": row["token"], "userId": row["user_id"], "email": email_row["email"] if email_row else ""})
                return self._send(200, {"status": "pending"})
            finally:
                conn.close()
        if parsed.path == "/api/wechat/callback":
            qs = parse_qs(parsed.query)
            state = (qs.get("state") or [""])[0]
            code = (qs.get("code") or [""])[0]
            if not state or not code:
                return self._html(400, wx_html("参数缺失", "缺少 code / state 参数"))
            try:
                url = (
                    "https://api.weixin.qq.com/sns/oauth2/access_token?appid=" + CONFIG["wx_appid"]
                    + "&secret=" + CONFIG["wx_secret"]
                    + "&code=" + urllib.parse.quote(code)
                    + "&grant_type=authorization_code"
                )
                with urllib.request.urlopen(url, timeout=10) as resp:
                    data = json.loads(resp.read().decode())
                openid = data.get("openid")
                if not openid:
                    return self._html(400, wx_html("登录失败", "微信未返回 openid：" + str(data.get("errmsg") or data)))
            except Exception as exc:
                return self._html(500, wx_html("登录失败", f"微信接口不可达：{exc}"))
            conn = db()
            try:
                with LOCK:
                    complete_wx_session(conn, state, openid)
                    conn.commit()
            finally:
                conn.close()
            return self._html(200, wx_html("登录成功", "请回到「朝夕」应用继续"))
        if parsed.path == "/dev/wechat-scan":
            if CONFIG["wx_appid"] and CONFIG["wx_secret"]:
                return self._html(403, wx_html("开发接口已停用", "已配置微信开放平台，模拟扫码不再启用"))
            state = (parse_qs(parsed.query).get("state") or [""])[0]
            conn = db()
            try:
                row = conn.execute("SELECT status FROM wx_sessions WHERE state = ?", (state,)).fetchone()
                if not row:
                    return self._html(404, wx_html("会话不存在", "state 无效或已过期"))
                if row["status"] == "pending":
                    with LOCK:
                        complete_wx_session(conn, state, f"dev_{state[:12]}")
                        conn.commit()
                return self._html(200, wx_html("模拟扫码成功", "开发联调已完成登录（相当于微信扫码确认）"))
            finally:
                conn.close()
        return self._send(404, {"error": "未知接口"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/register":
            # 注册已改为邮箱验证两步式，保证"不能随便注册"
            return self._send(410, {"error": "注册需要邮箱验证，请升级客户端后重试"})

        if path == "/api/register/start":
            if not rate_ok(self.client_address[0]):
                return self._send(429, {"error": "请求过于频繁，请稍后再试"})
            body = json_body(self)
            if not body:
                return self._send(400, {"error": "请求体无效"})
            email = str(body.get("email", "")).strip().lower()
            password = str(body.get("password", ""))
            if "@" not in email or len(email) > 200 or " " in email:
                return self._send(400, {"error": "邮箱格式不正确"})
            if len(password) < 6 or len(password) > 200:
                return self._send(400, {"error": "密码至少 6 位"})
            if not CONFIG["smtp_host"] and not CONFIG["dev_echo_code"]:
                return self._send(503, {"error": "服务器未配置邮件服务，暂无法注册"})
            conn = db()
            try:
                exists = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if exists:
                    return self._send(409, {"error": "该邮箱已注册，请直接登录"})
                now = int(time.time())
                pending = conn.execute("SELECT sent_at FROM pending_regs WHERE email = ?", (email,)).fetchone()
                if pending and now - pending["sent_at"] < 60:
                    return self._send(429, {"error": f"发送太频繁，请 {60 - (now - pending['sent_at'])} 秒后再试"})
                code = gen_code()
                salt = secrets.token_hex(16)
                with LOCK:
                    conn.execute(
                        "INSERT INTO pending_regs (email, pw, salt, code_hash, attempts, expires, sent_at) VALUES (?,?,?,?,0,?,?) "
                        "ON CONFLICT(email) DO UPDATE SET pw=excluded.pw, salt=excluded.salt, code_hash=excluded.code_hash, "
                        "attempts=0, expires=excluded.expires, sent_at=excluded.sent_at",
                        (email, hash_pw(password, salt), salt, code_hash(code, email), now + 600, now),
                    )
                    conn.commit()
                if CONFIG["smtp_host"]:
                    ok, err = send_mail(
                        email,
                        "【朝夕】注册验证码",
                        f"你的注册验证码是：{code}\n\n验证码 10 分钟内有效，请勿泄露给他人。\n如非本人操作，请忽略本邮件。",
                        render_code_email(code),
                    )
                    if not ok:
                        return self._send(502, {"error": f"邮件发送失败：{err}"})
                    return self._send(200, {"ok": True, "needCode": True})
                # dev_echo_code：未配 SMTP 的联调模式，验证码回显（仅测试用，生产务必自行配置 SMTP）
                return self._send(200, {"ok": True, "needCode": True, "devCode": code})
            finally:
                conn.close()

        if path == "/api/register/verify":
            if not rate_ok(self.client_address[0]):
                return self._send(429, {"error": "请求过于频繁，请稍后再试"})
            body = json_body(self)
            if not body:
                return self._send(400, {"error": "请求体无效"})
            email = str(body.get("email", "")).strip().lower()
            code = str(body.get("code", "")).strip()
            conn = db()
            try:
                row = conn.execute("SELECT * FROM pending_regs WHERE email = ?", (email,)).fetchone()
                if not row:
                    return self._send(404, {"error": "请先获取邮箱验证码"})
                if time.time() > row["expires"]:
                    conn.execute("DELETE FROM pending_regs WHERE email = ?", (email,))
                    conn.commit()
                    return self._send(410, {"error": "验证码已过期，请重新获取"})
                if row["attempts"] >= 5:
                    conn.execute("DELETE FROM pending_regs WHERE email = ?", (email,))
                    conn.commit()
                    return self._send(429, {"error": "尝试次数过多，请重新获取验证码"})
                if code_hash(code, email) != row["code_hash"]:
                    conn.execute("UPDATE pending_regs SET attempts = attempts + 1 WHERE email = ?", (email,))
                    conn.commit()
                    left = 5 - int(row["attempts"]) - 1
                    return self._send(401, {"error": f"验证码不正确，还可尝试 {left} 次"})
                with LOCK:
                    user_id = secrets.token_hex(12)
                    token = secrets.token_hex(32)
                    conn.execute(
                        "INSERT INTO users (id, email, pw, salt, created) VALUES (?,?,?,?,?)",
                        (user_id, email, row["pw"], row["salt"], int(time.time())),
                    )
                    conn.execute("INSERT INTO tokens (token, user_id, created) VALUES (?,?,?)", (token, user_id, int(time.time())))
                    conn.execute("DELETE FROM pending_regs WHERE email = ?", (email,))
                    conn.commit()
                return self._send(201, {"token": token, "userId": user_id, "email": email})
            finally:
                conn.close()

        if path == "/api/login":
            if not rate_ok(self.client_address[0]):
                return self._send(429, {"error": "请求过于频繁，请稍后再试"})
            body = json_body(self)
            if not body:
                return self._send(400, {"error": "请求体无效"})
            email = str(body.get("email", "")).strip().lower()
            password = str(body.get("password", ""))
            conn = db()
            try:
                row = conn.execute("SELECT id, pw, salt FROM users WHERE email = ?", (email,)).fetchone()
                if not row or hash_pw(password, row["salt"]) != row["pw"]:
                    return self._send(401, {"error": "邮箱或密码不正确"})
                token = secrets.token_hex(32)
                conn.execute("INSERT INTO tokens (token, user_id, created) VALUES (?,?,?)", (token, row["id"], int(time.time())))
                conn.commit()
                return self._send(200, {"token": token, "userId": row["id"], "email": email})
            finally:
                conn.close()

        if path == "/api/logout":
            conn = db()
            try:
                auth = self.headers.get("Authorization") or ""
                if auth.startswith("Bearer "):
                    conn.execute("DELETE FROM tokens WHERE token = ?", (auth[7:].strip(),))
                    conn.commit()
                return self._send(200, {"ok": True})
            finally:
                conn.close()

        if path == "/api/sync":
            body = json_body(self)
            conn = db()
            try:
                user_id = bearer_user(conn, self)
                if not user_id:
                    return self._send(401, {"error": "未登录或令牌无效"})
                changes = (body or {}).get("changes") or {}
                applied = 0
                with LOCK:
                    for item in changes.get("todos") or []:
                        if isinstance(item, dict) and upsert_record(conn, user_id, "todos", item.get("id"), item, item.get("updatedAt"), 0):
                            applied += 1
                    for item in changes.get("notes") or []:
                        if isinstance(item, dict) and upsert_record(conn, user_id, "notes", item.get("id"), item, item.get("updatedAt"), 0):
                            applied += 1
                    for ts in changes.get("tombstones") or []:
                        if isinstance(ts, dict) and upsert_record(conn, user_id, str(ts.get("table", "todos")), ts.get("id"), None, ts.get("deletedAt"), 1):
                            applied += 1
                    conn.commit()
                seq_row = conn.execute("SELECT seq FROM seqs WHERE user_id = ?", (user_id,)).fetchone()
                return self._send(200, {"seq": seq_row["seq"] if seq_row else 0, "applied": applied})
            finally:
                conn.close()

        if path == "/api/wechat/qr":
            if not rate_ok(self.client_address[0]):
                return self._send(429, {"error": "请求过于频繁，请稍后再试"})
            conn = db()
            try:
                state = secrets.token_hex(16)
                conn.execute(
                    "INSERT INTO wx_sessions (state, status, created) VALUES (?, 'pending', ?)",
                    (state, int(time.time())),
                )
                conn.commit()
                if CONFIG["wx_appid"] and CONFIG["wx_secret"]:
                    redirect = urllib.parse.quote(f"{base_url(self)}/api/wechat/callback", safe="")
                    qr_url = (
                        "https://open.weixin.qq.com/connect/qrconnect?appid=" + CONFIG["wx_appid"]
                        + "&redirect_uri=" + redirect
                        + "&response_type=code&scope=snsapi_login&state=" + state
                        + "#wechat_redirect"
                    )
                    mode = "wechat"
                else:
                    qr_url = f"{base_url(self)}/dev/wechat-scan?state={state}"
                    mode = "dev"
                return self._send(200, {"state": state, "qrUrl": qr_url, "mode": mode})
            finally:
                conn.close()

        return self._send(404, {"error": "未知接口"})


def load_app_release():
    """读取 app-release.json（发版时更新；与配置文件同目录）；不存在或损坏返回 None。"""
    try:
        with open(APP_RELEASE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("latest"):
            return data
    except Exception:
        pass
    return None


def fetch_github_latest():
    """兜底：服务端尝试 GitHub Releases API；失败返回 None。"""
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/btrencai/zhaoxi/releases?per_page=5",
            headers={"User-Agent": "zhaoxi-cloud", "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            items = json.loads(resp.read().decode("utf-8"))
        for it in items if isinstance(items, list) else []:
            if not it.get("draft") and it.get("tag_name"):
                return {
                    "latest": str(it["tag_name"]).lstrip("vV"),
                    "date": str(it.get("published_at") or "")[:10],
                    "urls": {"github": {"page": it.get("html_url") or ""}},
                    "source": "github",
                }
    except Exception:
        pass
    return None


def main():
    global DB_PATH, APP_RELEASE_FILE
    parser = argparse.ArgumentParser(description="朝夕云同步服务器（开发/自建版）")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--db", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "zhaoxi-cloud.db"))
    parser.add_argument("--config", default="", help="配置文件路径（默认使用脚本同目录 cloud-config.json）")
    args = parser.parse_args()
    DB_PATH = args.db

    cfg_path = args.config or os.path.join(os.path.dirname(os.path.abspath(__file__)), "cloud-config.json")
    APP_RELEASE_FILE = os.path.join(os.path.dirname(os.path.abspath(cfg_path)), "app-release.json")
    if os.path.exists(cfg_path):
        try:
            loaded = json.load(open(cfg_path, encoding="utf-8"))
            for key, default in CONFIG.items():
                val = loaded.get(key)
                if isinstance(default, bool):
                    if isinstance(val, bool):
                        CONFIG[key] = val
                elif isinstance(default, int):
                    if isinstance(val, (int, float)):
                        CONFIG[key] = int(val)
                elif isinstance(val, str):
                    CONFIG[key] = val.strip()
            print(
                f"已加载配置: {cfg_path} · 邮件服务: {'已配置（' + CONFIG['smtp_host'] + '）' if CONFIG['smtp_host'] else '未配置'}",
                flush=True,
            )
        except Exception as exc:
            print("配置读取失败（使用默认配置）:", exc, flush=True)

    conn = db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"朝夕云同步服务器已启动: http://{args.host}:{args.port}  (db: {DB_PATH})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("已停止", flush=True)


if __name__ == "__main__":
    main()
