# 朝夕 · 云端账户与同步设计（v1）

> 目标：在「本地优先」前提下引入账号体系与多设备云同步。
> 原则：**本地是唯一事实源（local-first）**；云端只是多设备之间的一台中转；
> 断网 / 不登录 / 服务器下线，应用全部功能不受影响。

## 1. 总体架构

```
┌─────────────────────────── 本机（朝夕 exe）───────────────────────────┐
│  TypeScript UI（WebView2）                                             │
│      │  invoke（IPC）                                                  │
│  Rust 核心 ── 原子写入 %APPDATA%\com.simple.todo\                      │
│      │            todos.json / notes.json / settings.json / focus.json │
│      │            meta.json（墓碑） · account.json（账户与游标）        │
│      │                                                                 │
│  src/cloud.ts（同步引擎，前端 fetch）                                  │
└──────────────┬────────────────────────────────────────────────────────┘
               │  HTTPS（Bearer Token）
        ┌──────▼──────┐
        │  云同步服务器  │  <产品不绑定任何厂商：自建 / 托管 / 局域网均可>
        │  tools/cloud-server.py（参考实现，单文件可部署）
        └──────────────┘
```

- **不引入任何第三方 SDK**：协议是普通 REST + JSON，任何一台机器都能当服务器。
- 客户端所有请求走 WebView 的 fetch；Rust 只负责本地文件的原子读写（含凭据与同步元数据）。

## 2. 数据模型与同步算法（LWW + 墓碑）

每条记录（todo / note）带 `id`（生成即稳定）与 `updatedAt`（毫秒时间戳）：

- **推送**：永远上传当前完整快照（todos + notes + tombstones）。幂等，不需要操作队列。
- **拉取**：按 `cursor`（服务器自增 seq）拉取增量；合并规则：
  - 同一 `id`：`updatedAt` 更大者胜（Last-Write-Wins）；
  - 删除：写墓碑 `{table, id, deletedAt}`，`deletedAt ≥ 记录.updatedAt` 时删除生效；
  - 撤销删除会**移除本地墓碑**，远端以「新版本」覆盖旧墓碑。
- 合并是纯函数（`mergeSnapshots`，见 `src/cloud.ts`），可单测；合并结果回写本地文件，
  游标与登录态写入 `account.json`。
- 墓碑保留 60 天后自动清理（`pruneTombstones`）。

局限性（v1 有意为之）：无字段级合并、无 CRDT；同一条目在两台设备**同时**修改时新者胜，
被覆盖方在下次同步后丢失其修改（文本内容级冲突）。对个人待办场景足够；后续可升级为
字段级合并或 CRDT（Yjs/Automerge），协议层不需要变。

## 3. 接口契约（REST）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET  | `/api/health` | — | `{ ok, name, version }` |
| POST | `/api/register` | `{email, password}` | `201 { token, userId, email }` |
| POST | `/api/login` | `{email, password}` | `200 { token, userId, email }` |
| POST | `/api/logout` | Bearer | `{ ok }` |
| GET  | `/api/sync?since=<seq>` | Bearer | `{ seq, changes: { todos, notes, tombstones } }` |
| POST | `/api/sync` | Bearer，`{ changes }` | `{ seq, applied }` |

- 认证：`Authorization: Bearer <64 hex token>`；服务端为每用户维护自增 `seq`。
- 服务器单条记录仅存最新版本（LWW 在服务端同样生效，避免回放旧数据）。

## 4. 客户端行为

- **登录 / 注册**：标题栏云状态胶囊 → 弹层（登录 / 注册切换、服务器地址可填）；
  注册即自动首次同步。凭据存于 `account.json`（本机）。
- **自动同步**：数据变更（todos / notes）落盘后 ~5 秒防抖触发；可在设置页开关。
- **手动同步**：点标题栏云状态 / 设置页「立即同步」；状态胶囊五态：
  未登录（灰）· 同步中（紫脉冲）· 已同步（绿）· 服务器不可达（琥珀）· 出错（红）。
- **冲突与并发**：同一时刻只允许一个同步在途；合并过程中若正在行内编辑则延后重绘。
- **退出登录**：清除本机凭据（`account.json`），**本地数据一律不动**。

## 5. 安全（当前实现 vs 生产建议）

当前（v1）：
- 密码 PBKDF2-SHA256（20 万次迭代 + 随机盐）；令牌 32 字节随机。
- 令牌明文存于本机 `account.json`（与数据同目录，权限由用户目录保护）。
- 传输默认 HTTP（局域网/本机联调）；连公网时**必须**配 HTTPS。

生产建议（部署清单）：
1. 用 Caddy/Nginx 反代加 TLS（Caddy 两行配置自动签证书）；
2. 反向代理层加限流（登录接口防爆破）与请求体上限；
3. 建议把令牌迁移到 Windows 凭据管理器（DPAPI），后续版本实现；
4. 定期备份服务器 sqlite 数据库；服务器只存同步数据，不存设备本机导出。

## 6. 已知边界

- 邮箱验证、找回密码（邮件通道）未实现——需要邮件服务，属于部署侧选项；
- 便签/待办之外（设置、专注统计）暂不同步；
- 首次同步为全量传输；数据量到万级条目时再做分片。

## 7. 部署指引（自建服务器）

```bash
# 任意一台可被多设备访问的机器（VPS / 家里的旧电脑 / 学校服务器均可）
python tools/cloud-server.py --port 8787
# 公网部署：加 Nginx/Caddy 反代 https://todo.example.com -> 127.0.0.1:8787

# 客户端：登录弹层里填服务器地址 https://todo.example.com
```

联调/测试：`python tools/cloud-server.py --port 8787 --db %TEMP%\cloud-test.db`。
