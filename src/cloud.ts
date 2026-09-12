/* 云端账户与同步引擎 v1
 * 设计：本地优先 + 增量同步（LWW 合并 + 墓碑删除）+ 可插拔服务端。
 * 服务端契约见 docs/cloud-design.md；开发联调服务器 tools/cloud-server.py。
 * 说明：v1 采用「整库推、增量拉」策略——推送始终上传本地快照（幂等），
 * 拉取按 cursor 拉取服务器增量，合并后回写本地文件。 */
import { invoke } from "@tauri-apps/api/core";

// ── 类型 ───────────────────────────────────────────────

export interface SyncTodo {
  id: string;
  updatedAt: number;
  [key: string]: unknown;
}

export interface SyncNote {
  id: string;
  updatedAt: number;
  [key: string]: unknown;
}

export interface Tombstone {
  table: "todos" | "notes";
  id: string;
  deletedAt: number;
}

export interface LocalSnapshot {
  todos: SyncTodo[];
  notes: SyncNote[];
  tombstones: Tombstone[];
}

export interface RemoteChanges {
  todos: SyncTodo[];
  notes: SyncNote[];
  tombstones: Tombstone[];
}

export interface MergeOutcome {
  snapshot: LocalSnapshot;
  changed: boolean;
  pulled: number;
}

export interface CloudAccount {
  server: string;
  email: string;
  token: string;
  userId: string;
  lastSync: number;
  cursor: number;
}

export type CloudPhase = "signedOut" | "syncing" | "synced" | "offline" | "error";

export interface CloudState {
  account: CloudAccount | null;
  phase: CloudPhase;
  lastError: string;
  autoSync: boolean;
}

// ── 合并算法（纯函数，便于测试） ────────────────────────

const keyOf = (t: Tombstone) => `${t.table}:${t.id}`;

export function mergeSnapshots(local: LocalSnapshot, remote: RemoteChanges): MergeOutcome {
  let changed = false;
  let pulled = 0;

  const tombstones = new Map<string, Tombstone>();
  for (const t of local.tombstones) tombstones.set(keyOf(t), t);
  for (const t of remote.tombstones) {
    const prev = tombstones.get(keyOf(t));
    if (!prev || t.deletedAt > prev.deletedAt) {
      tombstones.set(keyOf(t), t);
      changed = true;
    }
  }

  const mergeList = <T extends SyncTodo>(
    localList: T[],
    remoteList: T[],
    table: "todos" | "notes"
  ): T[] => {
    const map = new Map<string, T>();
    for (const item of localList) map.set(item.id, item);
    for (const item of remoteList) {
      const ts = tombstones.get(`${table}:${item.id}`);
      if (ts && ts.deletedAt >= item.updatedAt) continue; // 已被更新的墓碑删除
      const mine = map.get(item.id);
      if (!mine || item.updatedAt > mine.updatedAt) {
        map.set(item.id, item);
        changed = true;
        pulled += 1;
      }
    }
    // 本地已被本地墓碑删除的项在此清掉（远端未删除也以本地墓碑为准推给服务器）
    for (const [id, item] of [...map]) {
      const ts = tombstones.get(`${table}:${id}`);
      if (ts && ts.deletedAt >= item.updatedAt) {
        map.delete(id);
        changed = true;
      }
    }
    return [...map.values()];
  };

  const todos = mergeList(local.todos, remote.todos, "todos");
  const notes = mergeList(local.notes, remote.notes, "notes");
  return {
    snapshot: { todos, notes, tombstones: [...tombstones.values()] },
    changed,
    pulled,
  };
}

export function pruneTombstones(tombstones: Tombstone[], maxAgeMs = 60 * 24 * 3600 * 1000): Tombstone[] {
  const limit = Date.now() - maxAgeMs;
  return tombstones.filter((t) => t.deletedAt >= limit);
}

// ── 客户端 ─────────────────────────────────────────────

const AUTO_KEY = "simple-todo.cloud.auto";

async function request<T>(url: string, init: RequestInit, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const msg = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export function normalizeServer(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export class CloudClient {
  private state: CloudState = { account: null, phase: "signedOut", lastError: "", autoSync: true };
  private listeners: Array<(s: CloudState) => void> = [];
  private snapshotProvider: (() => LocalSnapshot) | null = null;

  /** 数据快照提供者（由主应用注册，返回当前本地用户数据） */
  setSnapshotProvider(fn: () => LocalSnapshot) {
    this.snapshotProvider = fn;
  }

  onState(cb: (s: CloudState) => void) {
    this.listeners.push(cb);
    cb(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(patch: Partial<CloudState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((cb) => cb(this.state));
  }

  get current(): CloudState {
    return this.state;
  }

  /** 启动时加载已保存的账户 */
  async init() {
    let auto = true;
    try {
      auto = localStorage.getItem(AUTO_KEY) !== "0";
    } catch {
      /* 忽略 */
    }
    let account: CloudAccount | null = null;
    try {
      const raw = await invoke<CloudAccount | null>("load_cloud_account");
      if (raw && typeof raw === "object" && raw.token && raw.server) account = raw;
    } catch {
      /* 忽略 */
    }
    this.emit({ account, autoSync: auto, phase: account ? "synced" : "signedOut" });
  }

  setAutoSync(on: boolean) {
    try {
      localStorage.setItem(AUTO_KEY, on ? "1" : "0");
    } catch {
      /* 忽略 */
    }
    this.emit({ autoSync: on });
  }

  private async saveAccount(account: CloudAccount) {
    await invoke("save_cloud_account", { account });
    this.emit({ account, phase: "synced", lastError: "" });
  }

  async login(server: string, email: string, password: string) {
    const base = normalizeServer(server);
    if (!base) throw new Error("请填写服务器地址");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
    if (password.length < 6) throw new Error("密码至少 6 位");
    const data = await request<{ token: string; userId: string; email: string }>(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const account: CloudAccount = {
      server: base,
      email: data.email || email,
      token: data.token,
      userId: data.userId,
      lastSync: 0,
      cursor: 0,
    };
    await this.saveAccount(account);
    return account;
  }

  /** 注册第一步：请求邮箱验证码（服务器发邮件） */
  async registerStart(server: string, email: string, password: string): Promise<{ devCode?: string }> {
    const base = normalizeServer(server);
    if (!base) throw new Error("请填写服务器地址");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("邮箱格式不正确");
    if (password.length < 6) throw new Error("密码至少 6 位");
    try {
      const data = await request<{ ok: boolean; needCode: boolean; devCode?: string }>(
        `${base}/api/register/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }
      );
      return { devCode: data.devCode };
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        throw new Error("服务器版本过旧：注册需邮箱验证，请更新服务器上的 cloud-server.py");
      }
      throw err;
    }
  }

  /** 注册第二步：校验验证码，通过即完成注册并登录 */
  async registerVerify(server: string, email: string, code: string) {
    const base = normalizeServer(server);
    if (!base) throw new Error("请填写服务器地址");
    const data = await request<{ token: string; userId: string; email: string }>(`${base}/api/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const account: CloudAccount = {
      server: base,
      email: data.email || email,
      token: data.token,
      userId: data.userId,
      lastSync: 0,
      cursor: 0,
    };
    await this.saveAccount(account);
    return account;
  }

  /** 认领一个外部获取的会话（如微信扫码登录）：保存账户并进入已登录状态 */
  async adopt(server: string, data: { token: string; userId: string; email: string }) {
    const account: CloudAccount = {
      server: normalizeServer(server),
      email: data.email,
      token: data.token,
      userId: data.userId,
      lastSync: 0,
      cursor: 0,
    };
    await this.saveAccount(account);
    return account;
  }

  async logout() {
    const account = this.state.account;
    if (account) {
      try {
        await request(`${account.server}/api/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.token}` },
        });
      } catch {
        /* 服务器不可达也允许本地退出 */
      }
    }
    try {
      await invoke("clear_cloud_account");
    } catch {
      /* 忽略 */
    }
    this.emit({ account: null, phase: "signedOut", lastError: "" });
  }

  /** 执行一次完整同步：推本地快照 + 拉远端增量 + 合并。返回合并结果。 */
  async sync(): Promise<MergeOutcome> {
    const account = this.state.account;
    if (!account) throw new Error("尚未登录");
    if (!this.snapshotProvider) throw new Error("同步未就绪");
    this.emit({ phase: "syncing" });
    const local = this.snapshotProvider();
    try {
      const pulled = await request<{ seq: number; changes: RemoteChanges }>(
        `${account.server}/api/sync?since=${account.cursor}`,
        { method: "GET", headers: { Authorization: `Bearer ${account.token}` } }
      );
      const outcome = mergeSnapshots(local, pulled.changes);

      await request(
        `${account.server}/api/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
          body: JSON.stringify({ changes: outcome.snapshot }),
        }
      );

      const next: CloudAccount = { ...account, lastSync: Date.now(), cursor: pulled.seq };
      await this.saveAccount(next);
      return outcome;
    } catch (err) {
      const offline = err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
      this.emit({ phase: offline ? "offline" : "error", lastError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
