# 朝夕 · 云服务部署指南

> 目标：在一台有公网地址的服务器上部署**官方后端**（数据库 + API + 微信扫码登录）。
> 参考实现是单文件 `tools/cloud-server.py`（Python 标准库 + SQLite），零外部依赖。

## 0. 需要准备什么

| 项目 | 要求 |
|---|---|
| 服务器 | 任意 Linux/Windows 机器，1 核 1G 起；能监听一个端口（默认 8787） |
| Python | 3.8+（Linux 一般自带；无需 pip install 任何包） |
| 域名（建议） | 一个指向服务器的域名，用于 HTTPS（微信登录**必须** HTTPS 回调） |
| 微信开放平台 | 「网站应用」审核通过后的 AppID / AppSecret（见文末说明） |

## 1. 部署（Linux，systemd）

```bash
# 1) 上传项目内的 tools/cloud-server.py 到服务器
sudo mkdir -p /opt/zhaoxi && sudo cp cloud-server.py /opt/zhaoxi/
sudo cp deploy/cloud-config.example.json /opt/zhaoxi/cloud-config.json
sudo nano /opt/zhaoxi/cloud-config.json     # 填 public_url / wx_appid / wx_secret

# 2) 安装服务
sudo cp deploy/zhaoxi-cloud.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zhaoxi-cloud

# 3) 验证
curl http://127.0.0.1:8787/api/health
# → {"ok": true, "name": "zhaoxi-cloud", "version": "1.0.0"}
```

数据库文件默认在 `/opt/zhaoxi/zhaoxi-cloud.db`（首次启动自动建表）。

## 2. HTTPS（必配，微信回调要求）

**Caddy（推荐，自动签证书，两行搞定）**：见 `deploy/Caddyfile`，把 `todo.example.com` 换成你的域名：

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**Nginx（备选）**：见 `deploy/nginx.conf`（配 certbot：`certbot --nginx -d todo.example.com`）。

## 3. 防火墙

只放行 22 / 80 / 443；**不要**把 8787 暴露到公网（仅本机反代访问）。

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

## 4. 数据备份（建议 cron 每日）

```bash
# 每天 3:30 备份 sqlite（sqlite3 .backup 为在线安全备份）
30 3 * * * sqlite3 /opt/zhaoxi/zhaoxi-cloud.db ".backup '/opt/zhaoxi/backup/$(date +\%F).db'"
```

## 5. 客户端连接

- 若使用「内置官方服务器」版本：把服务器地址通过构建参数打进去（见项目 README / `CLOUD_SERVER` 构建变量），用户端无需填写地址；
- 通用版：在应用内登录弹层中填 `https://todo.example.com`（设置页高级入口也可改）。

## 6. 关于微信登录（当前不启用）

产品定位为**邮箱注册 / 登录**（已完整实现、开箱即用）。服务端代码里保留了一套微信扫码
登录接口（需微信开放平台「网站应用」资质，通常要求企业主体），**默认不启用**，无需任何配置。
如未来需要启用：申请到 AppID/AppSecret 后填入 `cloud-config.json` 的 `wx_appid`/`wx_secret` 即可。

## 7. 运维速查

```bash
systemctl status zhaoxi-cloud      # 状态
journalctl -u zhaoxi-cloud -f      # 日志
curl https://todo.example.com/api/health   # 外部连通性
```

## 8. 安全清单（已内置）

- 密码 PBKDF2-SHA256（20 万次迭代 + 随机盐），令牌 32 字节随机；
- 认证接口按 IP 限流（60 次/分钟）；
- 数据按用户隔离（同步接口强制 Bearer 鉴权）；
- 建议：给 Nginx/Caddy 加 `limit_req`、定期更新服务器系统与 TLS 证书（Caddy 自动）。

## 9. 为什么不用 PostgreSQL / Redis？（何时才需要）

结论：**当前规模不需要，这是刻意取舍。**

| 组件 | 现在用什么 | 为什么够用 | 什么时候才需要升级 |
|---|---|---|---|
| 数据库 | **SQLite**（服务器上单文件，Python 自带） | 一个个人效率应用、几十~几千用户，每人几 KB~几 MB 数据、每次同步间隔数秒——这类负载对 SQLite 是"轻如鸿毛"；它是最广泛部署的关系数据库（手机、浏览器、飞机客舱系统都在用），不是玩具 | ① 需要**多台服务器**同时读写（SQLite 无法跨机共享）② 高并发写入出现锁等待（多人同时高频同步）③ 需要主从复制 / 时间点恢复 / 复杂 SQL 分析 |
| 缓存 | **不需要** | 响应体极小（增量同步每次几 KB）、查询是主键直查，缓存带来的收益为零，反而多一个要运维、要清缓存的组件 | 需要多实例共享会话/限流状态时（可上 Redis），或接口出现重查询热点 |
| 队列 | **不需要** | 没有后台任务（无邮件、无异步计算） | 未来加邮件找回密码、数据导出等异步任务时再引入 |

升级路径（承诺）：服务端逻辑与 API 契约完全独立于存储实现——
换成 PostgreSQL 只需要改写 `cloud-server.py` 里的存储层（约 60 行），
**客户端一行都不用改**。所以现在用最简形态上线，规模到了再做迁移，是成本最低的路线。

当前部署只需要：**1 台机器 + Python 3.8+ + 1 个 Python 文件 + 1 个 SQLite 文件**，
外加 systemd（进程守护）和 Caddy/Nginx（HTTPS），没有第二种服务需要安装。
备份 = 复制一个文件（第 4 节的 cron 已给出现成命令）。

## 10. 邮件服务（SMTP）—— 注册验证码必需

注册采用**邮箱验证码**两步式（`/api/register/start` 发码 → `/api/register/verify` 校验），
服务器需配置 SMTP 才能注册。在 `cloud-server.py` 同目录放 `cloud-config.json`：

```json
{
  "smtp_host": "smtp.qq.com",
  "smtp_port": 465,
  "smtp_tls": "ssl",
  "smtp_user": "你的邮箱@qq.com",
  "smtp_pass": "SMTP授权码",
  "smtp_from": "你的邮箱@qq.com"
}
```

- `smtp_tls`：`ssl`（465 端口）或 `starttls`（587 端口）；本地联调可 `none`。
- 未配置 SMTP 时注册接口返回 503；另有 `dev_echo_code: true` 的联调模式
  （验证码直接回显给客户端，**仅测试用，切勿在生产开启**）。
- 验证码 10 分钟有效、60 秒重发冷却、单邮箱最多错 5 次。
