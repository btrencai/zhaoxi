import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import tauriLogo from "./assets/tauri.svg";
import rustLogo from "./assets/rust.svg";
import webview2Logo from "./assets/webview2.png";
import typescriptLogo from "./assets/typescript.svg";
import viteLogo from "./assets/vite.svg";
import { readText as clipReadText, writeText as clipWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  disable as autostartDisable,
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  isRegistered as hotkeyIsRegistered,
  register as hotkeyRegister,
  unregister as hotkeyUnregister,
} from "@tauri-apps/plugin-global-shortcut";
import { listen } from "@tauri-apps/api/event";
import { CloudClient, pruneTombstones, type CloudState, type SyncNote, type SyncTodo, type Tombstone } from "./cloud";
import { CHANGELOG } from "./changelog";
import "./styles.css";

declare const __TS_VERSION__: string;
declare const __VITE_VERSION__: string;
declare const __CLOUD_SERVER__: string;

type RepeatKind = "daily" | "weekly" | "monthly" | "weekday";

const REPEAT_LABELS: Record<RepeatKind, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  weekday: "工作日",
};

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  priority: number;
  due: number | null;
  completedAt: number | null;
  repeat: RepeatKind | null;
  tags: string[];
}

/** 从文本解析 #标签（去重、最多 6 个、单个 ≤16 字） */
function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/#([^\s#]{1,16})/g)) {
    const tag = match[1];
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

interface Note {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

interface ClipEntry {
  id: string;
  text: string;
  ts: number;
}

interface AppMeta {
  tauri: string;
  rustc: string;
  version: string;
  exeSize: number;
}

// ── DOM 引用 ───────────────────────────────────────────

const $id = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  list: $id<HTMLUListElement>("todo-list"),
  empty: $id("empty-state"),
  input: $id<HTMLInputElement>("todo-input"),
  addBtn: $id<HTMLButtonElement>("add-btn"),
  clearDone: $id<HTMLButtonElement>("clear-done"),
  statDone: $id("stat-done"),
  statTotal: $id("stat-total"),
  progressFill: $id("progress-fill"),
  segThumb: $id("seg-thumb"),
  toast: $id("toast"),
  toastMsg: $id("toast-msg"),
  toastAction: $id<HTMLButtonElement>("toast-action"),
  appVersion: $id("app-version"),
  stackGrid: $id("stack-grid"),
  stackPill: $id("stack-pill"),
  stackChip: $id("stack-chip"),
  pageDate: $id("page-date"),
  themeThumb: $id("theme-thumb"),
  statSize: $id("stat-size"),
  barApp: $id("bar-app"),
  barRef: $id("bar-ref"),
  barAppVal: $id("bar-app-val"),
  copyDiag: $id<HTMLButtonElement>("copy-diag"),
  verCurrent: $id("ver-current"),
  verCheck: $id<HTMLButtonElement>("ver-check"),
  verLogToggle: $id<HTMLButtonElement>("ver-log-toggle"),
  verStatus: $id("ver-status"),
  verLog: $id("ver-log"),
  cloudBtn: $id<HTMLButtonElement>("cloud-btn"),
  cloudSettings: $id("cloud-settings"),
  authOverlay: $id("auth-overlay"),
  authClose: $id<HTMLButtonElement>("auth-close"),
  authTabs: $id("auth-tabs"),
  authForm: $id<HTMLFormElement>("auth-form"),
  authServer: $id<HTMLInputElement>("auth-server"),
  authEmail: $id<HTMLInputElement>("auth-email"),
  authPassword: $id<HTMLInputElement>("auth-password"),
  authConfirm: $id<HTMLInputElement>("auth-confirm"),
  authConfirmField: $id("auth-confirm-field"),
  authError: $id("auth-error"),
  authSubmit: $id<HTMLButtonElement>("auth-submit"),
  authTitle: $id("auth-title"),
  authSub: $id("auth-sub"),
  authAdv: $id<HTMLButtonElement>("auth-adv"),
  authAdvBack: $id<HTMLButtonElement>("auth-adv-back"),
  authHint: $id("auth-hint"),
  authCodeStep: $id("auth-code-step"),
  authCodeInfo: $id("auth-code-info"),
  authCode: $id<HTMLInputElement>("auth-code"),
  authCodeError: $id("auth-code-error"),
  authVerifyBtn: $id<HTMLButtonElement>("auth-verify-btn"),
  authResend: $id<HTMLButtonElement>("auth-resend"),
  authEditBack: $id<HTMLButtonElement>("auth-edit-back"),
  authQuit: $id<HTMLButtonElement>("auth-quit"),
  searchInput: $id<HTMLInputElement>("search-input"),
  searchClear: $id<HTMLButtonElement>("search-clear"),
  sortBtn: $id<HTMLButtonElement>("sort-btn"),
  sortLabel: $id("sort-label"),
  tagFilter: $id<HTMLButtonElement>("tag-filter"),
  exportData: $id<HTMLButtonElement>("export-data"),
  noteAdd: $id<HTMLButtonElement>("note-add"),
  notesList: $id("notes-list"),
  noteInput: $id<HTMLTextAreaElement>("note-input"),
  noteDelete: $id<HTMLButtonElement>("note-delete"),
  noteEditorTime: $id("note-editor-time"),
  focusTime: $id("focus-time"),
  focusPhase: $id("focus-phase"),
  focusStart: $id<HTMLButtonElement>("focus-start"),
  focusReset: $id<HTMLButtonElement>("focus-reset"),
  focusPresets: $id("focus-presets"),
  focusSkip: $id<HTMLButtonElement>("focus-skip"),
  focusDots: $id("focus-dots"),
  focusContext: $id("focus-context"),
  focusTaskSelect: $id<HTMLSelectElement>("focus-task-select"),
  focusToday: $id("focus-today"),
  focusSettingsToggle: $id<HTMLButtonElement>("focus-settings-toggle"),
  focusSettings: $id("focus-settings"),
  fsAutoBreak: $id("fs-auto-break"),
  fsAutoNext: $id("fs-auto-next"),
  fsSound: $id("fs-sound"),
  clipList: $id<HTMLUListElement>("clip-list"),
  clipEmpty: $id("clip-empty"),
  clipToggle: $id<HTMLButtonElement>("clip-toggle"),
  clipClear: $id<HTMLButtonElement>("clip-clear"),
  stTotal: $id("st-total"),
  stToday: $id("st-today"),
  stTodayDate: $id("st-today-date"),
  stStreak: $id("st-streak"),
  stWeek: $id("st-week"),
  stFocusToday: $id("st-focus-today"),
  stFocusTotal: $id("st-focus-total"),
  heatGrid: $id("heat-grid"),
};

const focusRing = document.getElementById("focus-ring-fill") as unknown as SVGCircleElement;

const emptyP = els.empty.querySelector("p") as HTMLParagraphElement;
const emptySpan = els.empty.querySelector("span") as HTMLSpanElement;

const segBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".seg-btn"));
const navBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"));
const themeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".theme-btn"));
const appWindow = getCurrentWindow();

const FILTER_KEY = "simple-todo.filter";
const THEME_KEY = "simple-todo.theme.v3";
const SORT_KEY = "simple-todo.sort";
const FILTERS = ["all", "active", "done"] as const;
type Filter = (typeof FILTERS)[number];
const SORTS = ["manual", "priority", "due"] as const;
type SortMode = (typeof SORTS)[number];
const SORT_LABELS: Record<SortMode, string> = {
  manual: "默认排序",
  priority: "按优先级",
  due: "按到期日",
};
const PRIORITY_NAMES = ["无", "低", "中", "高"];

let todos: Todo[] = [];
let filter: Filter = "all";
let sortMode: SortMode = "manual";
let query = "";
let queryRaw = "";
let editingId: string | null = null;
let toastTimer: number | null = null;
let toastActionRun: (() => void) | null = null;
let undo: { todo: Todo; index: number }[] | null = null;
let undoTimer: number | null = null;
let duePopTodoId: string | null = null;
let tagFilter: string | null = null;
let focusStats: Record<string, number> = {};
let currentView = "todos";
// 便签
let notes: Note[] = [];
let activeNoteId: string | null = null;
let noteSaveTimer: number | null = null;
// 专注（番茄钟）
type FocusPhase = "focus" | "short" | "long";
let focusPhase: FocusPhase = "focus";
let timerRunning = false;
let timerEndsAt = 0;
let timerRemainingSec = 25 * 60;
let timerInterval: number | null = null;
let roundDone = 0;
let focusTaskId: string | null = null;

// 剪贴板
let clips: ClipEntry[] = [];
let clipListening = true;
let lastClipText = "";

// 设置
interface AppSettings {
  trayEnabled: boolean;
  closeAction: "tray" | "quit";
  startMinimized: boolean;
  quickHotkey: boolean;
  alwaysOnTop: boolean;
  focusWork: number;
  focusShort: number;
  focusLong: number;
  focusRounds: number;
  focusAutoBreak: boolean;
  focusAutoNext: boolean;
  focusSound: boolean;
}

let settings: AppSettings = {
  trayEnabled: true,
  closeAction: "tray",
  startMinimized: false,
  quickHotkey: false,
  alwaysOnTop: false,
  focusWork: 25,
  focusShort: 5,
  focusLong: 15,
  focusRounds: 4,
  focusAutoBreak: true,
  focusAutoNext: false,
  focusSound: true,
};

// ── 图标 ───────────────────────────────────────────────

const CHECK_SVG =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 6.4l2.3 2.3 4.5-5.3"/></svg>';
const EDIT_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20.2l3.9-.9L19.3 8a2.4 2.4 0 0 0 0-3.4l-.4-.4a2.4 2.4 0 0 0-3.4 0L4.9 16.3 4 20.2Z"/><path d="M13.4 5.6l4.9 4.9"/></svg>';
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V5.6c0-.9.7-1.6 1.6-1.6h1.8c.9 0 1.6.7 1.6 1.6V7"/><path d="M6.6 7l.8 12.2c.05 1 .9 1.8 1.9 1.8h5.4c1 0 1.85-.8 1.9-1.8L17.4 7"/></svg>';
const CAL_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v3.4M16 3v3.4M3.5 10h17"/></svg>';
const COPY_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11.5" height="11.5" rx="2.6"/><path d="M6.5 15H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 3h7a2.5 2.5 0 0 1 2.5 2.5V7"/></svg>';

interface StackItem {
  key: string;
  name: string;
  color: string;
  role: string;
  icon: string;
  version: string;
  group: string;
}

const ICONS: Record<string, string> = {
  // 官方 Logo（Tauri / Rust / WebView2 / TypeScript / Vite）
  tauri: tauriLogo,
  rust: rustLogo,
  webview2: webview2Logo,
  typescript: typescriptLogo,
  vite: viteLogo,
  // 功能性图标（非品牌项）
  ipc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h12.5M13.8 5.2l3.3 3.3-3.3 3.3"/><path d="M20 15.5H7.5M10.2 12.2l-3.3 3.3 3.3 3.3"/></svg>',
  storage:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.6" rx="7.4" ry="2.7"/><path d="M4.6 5.6v12.8c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7V5.6"/><path d="M4.6 12c0 1.5 3.3 2.7 7.4 2.7s7.4-1.2 7.4-2.7"/></svg>',
  single:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="3.4" width="11.6" height="11.6" rx="3.4"/><path d="M9.6 20.6h7.6a3.4 3.4 0 0 0 3.4-3.4V9.6"/></svg>',
};

const GRIP_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';

// ── 截止日期弹层 ───────────────────────────────────────

const duePop = document.createElement("div");
duePop.className = "due-pop";
duePop.id = "due-pop";
duePop.hidden = true;
duePop.innerHTML =
  '<div class="due-pop-row due-quick-row">' +
  '<button type="button" class="due-opt" data-days="0">今天</button>' +
  '<button type="button" class="due-opt" data-days="1">明天</button>' +
  '<button type="button" class="due-opt" data-days="7">一周后</button>' +
  "</div>" +
  '<div class="due-cal">' +
  '<div class="due-cal-head">' +
  '<button type="button" class="due-cal-nav due-cal-prev" aria-label="上个月">‹</button>' +
  '<span class="due-cal-label"></span>' +
  '<button type="button" class="due-cal-nav due-cal-next" aria-label="下个月">›</button>' +
  "</div>" +
  '<div class="due-cal-week">' +
  ["一", "二", "三", "四", "五", "六", "日"].map((w) => `<span>${w}</span>`).join("") +
  "</div>" +
  '<div class="due-cal-grid"></div>' +
  "</div>" +
  '<div class="due-pop-label">重复</div>' +
  '<div class="due-pop-row due-repeat-row">' +
  '<button type="button" class="due-opt repeat-opt" data-repeat="">不重复</button>' +
  '<button type="button" class="due-opt repeat-opt" data-repeat="daily">每天</button>' +
  '<button type="button" class="due-opt repeat-opt" data-repeat="weekly">每周</button>' +
  '<button type="button" class="due-opt repeat-opt" data-repeat="monthly">每月</button>' +
  '<button type="button" class="due-opt repeat-opt" data-repeat="weekday">工作日</button>' +
  "</div>" +
  '<button type="button" class="due-remove">清除截止日期</button>';
document.body.appendChild(duePop);

function closeDuePop() {
  duePop.hidden = true;
  duePopTodoId = null;
}

function openDuePopover(todo: Todo, anchor: HTMLElement) {
  duePopTodoId = todo.id;
  (duePop.querySelector(".due-remove") as HTMLButtonElement).hidden = !todo.due;
  duePop.querySelectorAll<HTMLButtonElement>(".repeat-opt").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.repeat ?? "") === (todo.repeat ?? ""));
  });
  duePop.querySelectorAll<HTMLButtonElement>(".due-quick-row .due-opt").forEach((btn) => {
    const days = Number(btn.dataset.days ?? "-1");
    btn.classList.toggle("active", todo.due !== null && days >= 0 && todo.due === dayStart(days));
  });
  renderDueCalendar(todo);

  duePop.hidden = false;
  duePop.style.visibility = "hidden";
  const rect = anchor.getBoundingClientRect();
  const w = duePop.offsetWidth;
  const h = duePop.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - w - 12);
  left = Math.max(12, left);
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 12) {
    top = Math.max(12, rect.top - h - 8);
  }
  duePop.style.left = `${left}px`;
  duePop.style.top = `${top}px`;
  duePop.style.visibility = "visible";
}

function toDateInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 自绘月历（Apple 风格，替代原生日期控件） ───────────

let dueCalYear = new Date().getFullYear();
let dueCalMonth = new Date().getMonth();

function renderDueCalendar(todo: Todo) {
  const base = todo.due ? new Date(todo.due) : new Date();
  dueCalYear = base.getFullYear();
  dueCalMonth = base.getMonth();
  paintDueCalendar(todo);
}

function paintDueCalendar(todo: Todo) {
  const label = duePop.querySelector(".due-cal-label");
  if (label) label.textContent = `${dueCalYear}年${dueCalMonth + 1}月`;
  const grid = duePop.querySelector(".due-cal-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const first = new Date(dueCalYear, dueCalMonth, 1);
  const offset = (first.getDay() + 6) % 7; // 周一为一周起始
  const start = new Date(dueCalYear, dueCalMonth, 1 - offset);
  const today0 = dayStart(0);
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "due-cal-day";
    cell.textContent = String(d.getDate());
    if (d.getMonth() !== dueCalMonth) cell.classList.add("outside");
    if (d.getTime() === today0) cell.classList.add("today");
    if (todo.due !== null && d.getTime() === todo.due) cell.classList.add("selected");
    cell.addEventListener("click", () => {
      const target = todos.find((t) => t.id === duePopTodoId);
      if (target) void setDue(target, d.getTime());
    });
    grid.appendChild(cell);
  }
}

function dayStart(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

function formatDue(due: number, done: boolean): { label: string; cls: string } {
  const today = dayStart(0);
  const diff = Math.round((due - today) / 86400000);
  let label: string;
  if (diff === 0) {
    label = "今天";
  } else if (diff === 1) {
    label = "明天";
  } else if (diff === -1) {
    label = "昨天";
  } else {
    const d = new Date(due);
    label =
      d.getFullYear() === new Date().getFullYear()
        ? `${d.getMonth() + 1}月${d.getDate()}日`
        : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  const cls = done ? "normal" : diff < 0 ? "overdue" : diff === 0 ? "today" : "normal";
  return { label, cls };
}

// ── 小工具 ─────────────────────────────────────────────

function toast(
  message: string,
  kind: "info" | "error" = "info",
  action?: { label: string; run: () => void },
  duration = 3200
) {
  els.toastMsg.textContent = message;
  els.toast.classList.toggle("error", kind === "error");
  if (action) {
    els.toastAction.textContent = action.label;
    els.toastAction.hidden = false;
    toastActionRun = action.run;
  } else {
    els.toastAction.hidden = true;
    toastActionRun = null;
  }
  els.toast.classList.add("show");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => hideToast(), duration);
}

function hideToast() {
  els.toast.classList.remove("show");
  els.toastAction.hidden = true;
  toastActionRun = null;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatToday(): string {
  const d = new Date();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `今天 · ${d.getMonth() + 1}月${d.getDate()}日 ${week}`;
}

function shortText(text: string, max = 14): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function persist(): Promise<boolean> {
  try {
    const ok = await invoke<boolean>("save_todos", { todos });
    if (!ok) toast("保存失败：无法写入本地数据文件", "error");
    else scheduleCloudSync();
    return ok;
  } catch (err) {
    console.error("保存失败：", err);
    toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
    return false;
  }
}

// ── 撤销 ───────────────────────────────────────────────

function scheduleUndo(message: string, items: { todo: Todo; index: number }[]) {
  undo = items;
  if (undoTimer !== null) window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    undo = null;
  }, 6500);
  toast(message, "info", { label: "撤销", run: () => void doUndo() }, 6000);
}

async function doUndo() {
  if (!undo) return;
  const items = [...undo];
  undo = null;
  if (undoTimer !== null) window.clearTimeout(undoTimer);
  items
    .sort((a, b) => a.index - b.index)
    .forEach(({ todo, index }) => {
      todos.splice(Math.min(index, todos.length), 0, todo);
    });
  removeTombstones(
    items.map((i) => i.todo.id),
    "todos"
  );
  hideToast();
  render();
  await persist();
}

// ── 云端账户与同步 ─────────────────────────────────────

const cloud = new CloudClient();
let tombstones: Tombstone[] = [];
let cloudSyncTimer: number | null = null;
let cloudSyncing = false;
let authTab: "login" | "register" = "login";
let authGate = false;
let authServerManual = false;
let pendingReg: { email: string; password: string } | null = null;
let resendTimer: number | null = null;

async function loadMeta() {
  try {
    const raw = await invoke<{ tombstones?: Tombstone[] } | null>("load_meta");
    tombstones = raw && Array.isArray(raw.tombstones) ? raw.tombstones : [];
  } catch {
    tombstones = [];
  }
}

async function persistMeta() {
  try {
    await invoke("save_meta", { meta: { tombstones: pruneTombstones(tombstones) } });
  } catch {
    /* 忽略 */
  }
}

function addTombstones(ids: string[], table: "todos" | "notes") {
  const now = Date.now();
  ids.forEach((id) => {
    tombstones = tombstones.filter((t) => !(t.table === table && t.id === id));
    tombstones.push({ table, id, deletedAt: now });
  });
  void persistMeta();
}

function removeTombstones(ids: string[], table: "todos" | "notes") {
  tombstones = tombstones.filter((t) => !(t.table === table && ids.includes(t.id)));
  void persistMeta();
}

function scheduleCloudSync() {
  const state = cloud.current;
  if (!state.account || !state.autoSync) return;
  if (cloudSyncTimer !== null) window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => void syncWithCloud(false), 4500);
}

function inlineEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.closest("#todo-list") !== null || el.closest("#note-input") !== null;
}

// ── 本地空间归属（换账号不串数据）────────────────────────

type SpaceOwner = { userId: string; email: string };

async function loadOwner(): Promise<SpaceOwner | null> {
  try {
    const raw = await invoke<SpaceOwner | null>("load_owner");
    return raw && raw.userId ? raw : null;
  } catch {
    return null;
  }
}

async function saveOwner(owner: SpaceOwner): Promise<void> {
  try {
    await invoke("save_owner", { owner });
  } catch {
    /* 忽略 */
  }
}

/** 账号切换保护：本机数据属于其他账号时，先归档清空，再加载新账号的云端数据。 */
async function ensureSpaceForAccount(account: { userId: string; email: string }): Promise<void> {
  const owner = await loadOwner();
  const same = !!owner && owner.userId === account.userId;
  // 仅当本机数据明确属于"另一个已记录账号"时归档；从未登录过（或无标记）时，数据直接归当前账号（保护旧版导入/首登数据）
  if (owner && !same && (todos.length > 0 || notes.length > 0 || tombstones.length > 0)) {
    try {
      const backup = await invoke<string>("archive_and_clear_data", {
        reason: (owner && owner.email) || account.email,
      });
      todos = [];
      notes = [];
      tombstones = [];
      await persist();
      await persistNotes();
      await persistMeta();
      render();
      renderNotes();
      const short = String(backup).split(/[\\/]/).pop() ?? "";
      toast(`已切换账号 · 旧数据已归档到 backups/${short}`);
    } catch (err) {
      toast(`切换账号时归档本地数据失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }
  await saveOwner({ userId: account.userId, email: account.email });
}

async function syncWithCloud(manual: boolean) {
  if (cloudSyncing || !cloud.current.account) return;
  cloudSyncing = true;
  try {
    const outcome = await cloud.sync();
    if (outcome.changed) {
      todos = outcome.snapshot.todos as unknown as Todo[];
      notes = outcome.snapshot.notes as unknown as Note[];
      tombstones = outcome.snapshot.tombstones;
      await persist();
      await persistNotes();
      await persistMeta();
      if (!inlineEditing()) {
        render();
        renderNotes();
      }
    }
    if (manual) {
      toast(outcome.pulled > 0 ? `同步完成 · 拉取 ${outcome.pulled} 条更新` : "同步完成 · 已是最新");
    }
  } catch (err) {
    if (manual) toast(`同步失败：${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    cloudSyncing = false;
  }
}

function phaseLabel(state: CloudState): string {
  switch (state.phase) {
    case "signedOut":
      return "未登录 · 点击登录启用云同步";
    case "syncing":
      return "正在同步…";
    case "synced":
      return state.account ? `已同步 · ${state.account.email}` : "已同步";
    case "offline":
      return "服务器不可达 · 稍后自动重试";
    case "error":
      return `同步出错：${state.lastError}`;
  }
}

function renderCloudChip(state: CloudState) {
  els.cloudBtn.dataset.phase = state.phase;
  els.cloudBtn.title = phaseLabel(state);
}

function cloudStatus(state: CloudState): { text: string; cls: string } {
  switch (state.phase) {
    case "syncing":
      return { text: "正在同步…", cls: "cloud-warn" };
    case "synced":
      return { text: state.account?.lastSync ? "已同步" : "等待首次同步", cls: "cloud-ok" };
    case "offline":
      return { text: "服务器不可达，稍后自动重试", cls: "cloud-warn" };
    case "error":
      return { text: `同步出错：${state.lastError}`, cls: "cloud-bad" };
    default:
      return { text: "未登录", cls: "" };
  }
}

function renderCloudSettings(state: CloudState) {
  const box = els.cloudSettings;
  box.innerHTML = "";
  const row = document.createElement("div");
  row.className = "setting-row";
  const info = document.createElement("div");
  info.className = "setting-info";
  const name = document.createElement("span");
  name.className = "setting-name";
  const desc = document.createElement("span");
  desc.className = "setting-desc";
  info.append(name, desc);

  if (!state.account) {
    name.textContent = "未登录";
    desc.textContent = "登录后可在多台设备间同步（本地优先：数据始终保留在本机）";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-ghost";
    btn.textContent = "登录 / 注册";
    btn.addEventListener("click", () => openAuth());
    row.append(info, btn);
    box.appendChild(row);
    return;
  }

  const st = cloudStatus(state);
  const host = state.account.server.replace(/^https?:\/\//, "");
  const last = state.account.lastSync ? formatTime(state.account.lastSync) : "尚未同步";
  name.textContent = state.account.email;
  const line = document.createElement("span");
  line.className = "setting-desc";
  line.textContent = `服务器 ${host} · 上次同步 ${last} · `;
  const stEl = document.createElement("span");
  stEl.className = st.cls;
  stEl.textContent = st.text;
  line.appendChild(stEl);
  info.removeChild(desc);
  info.append(line);
  const spaceLine = document.createElement("span");
  spaceLine.className = "setting-desc";
  spaceLine.textContent = "切换账号时，本机当前账号的数据会自动归档备份，并加载新账号的云端数据";
  info.append(spaceLine);

  const actions = document.createElement("div");
  actions.className = "cloud-row-actions";
  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.className = "btn-ghost";
  syncBtn.textContent = "立即同步";
  syncBtn.addEventListener("click", () => void syncWithCloud(true));
  const outBtn = document.createElement("button");
  outBtn.type = "button";
  outBtn.className = "btn-ghost";
  outBtn.textContent = "退出登录";
  outBtn.addEventListener("click", () => {
    void cloud.logout().then(() => {
      toast("已退出登录 · 本机数据保留，登录其他账号时自动归档切换");
      openAuth(true);
    });
  });
  actions.append(syncBtn, outBtn);
  row.append(info, actions);
  box.appendChild(row);

  const row2 = document.createElement("div");
  row2.className = "setting-row";
  const info2 = document.createElement("div");
  info2.className = "setting-info";
  const name2 = document.createElement("span");
  name2.className = "setting-name";
  name2.textContent = "自动同步";
  const desc2 = document.createElement("span");
  desc2.className = "setting-desc";
  desc2.textContent = "数据变更后自动同步（约 5 秒防抖），手动同步始终可用";
  info2.append(name2, desc2);
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", state.autoSync ? "true" : "false");
  sw.setAttribute("aria-label", "自动同步");
  sw.innerHTML = "<i></i>";
  sw.addEventListener("click", () => cloud.setAutoSync(!cloud.current.autoSync));
  row2.append(info2, sw);
  box.appendChild(row2);
}

function openAuth(gate = false) {
  if (gate) authGate = true;
  els.authOverlay.hidden = false;
  els.authClose.hidden = authGate && !cloud.current.account;
  let savedServer = "";
  try {
    savedServer = localStorage.getItem("simple-todo.cloud.server") ?? "";
  } catch {
    /* 忽略 */
  }
  const builtin = (__CLOUD_SERVER__ || "").trim();
  const field = els.authServer.closest(".auth-field") as HTMLElement | null;
  if (builtin) {
    // 官方模式下绝不把官方地址写进输入框，避免任何形式的展示
    if (!authServerManual) els.authServer.value = "";
    if (field) field.hidden = !authServerManual;
    els.authAdv.hidden = authServerManual;
    els.authAdvBack.hidden = !authServerManual;
    els.authHint.textContent = "已连接官方服务器 · 注册需邮箱验证";
  } else {
    if (!els.authServer.value) els.authServer.value = savedServer;
    if (field) field.hidden = false;
    els.authAdv.hidden = true;
    els.authAdvBack.hidden = true;
  }
  showCodeStep(false);
  pendingReg = null;
  els.authCode.value = "";
  els.authCodeInfo.textContent = "";
  els.authCodeError.hidden = true;
  setAuthTab(authTab);
  els.authQuit.hidden = !!cloud.current.account; // 未登录（登录门）时提供「退出应用」
  window.setTimeout(() => {
    if (authServerManual) els.authServer.focus();
    else els.authEmail.focus();
  }, 80);
}

/** 当前应使用的服务器：自定义模式下用输入框内容，否则用内置官方地址 */
function resolveAuthServer(): string {
  const builtin = (__CLOUD_SERVER__ || "").trim();
  const typed = els.authServer.value.trim();
  if (authServerManual && typed) return typed;
  return builtin || typed;
}

// ── 注册第二步：邮箱验证码 ─────────────────────────────

function stopResendTimer() {
  if (resendTimer !== null) {
    window.clearInterval(resendTimer);
    resendTimer = null;
  }
}

function startResendCountdown() {
  let left = 60;
  els.authResend.disabled = true;
  els.authResend.textContent = `重新发送（${left}s）`;
  stopResendTimer();
  resendTimer = window.setInterval(() => {
    left -= 1;
    if (left <= 0) {
      stopResendTimer();
      els.authResend.disabled = false;
      els.authResend.textContent = "重新发送";
    } else {
      els.authResend.textContent = `重新发送（${left}s）`;
    }
  }, 1000);
}

function showCodeStep(show: boolean) {
  els.authCodeStep.hidden = !show;
  els.authForm.hidden = show;
  els.authTabs.hidden = show;
  if (!show) stopResendTimer();
}

function enterCodeStep(email: string, devCode?: string) {
  els.authCodeInfo.textContent = devCode
    ? `验证码已发送至 ${email}（开发联调验证码：${devCode}）`
    : `验证码已发送至 ${email} · 10 分钟内有效；没收到请检查垃圾邮件文件夹，倒计时结束后可重新发送`;
  els.authCode.value = "";
  els.authCodeError.hidden = true;
  els.authVerifyBtn.textContent = "验证并登录";
  showCodeStep(true);
  startResendCountdown();
  window.setTimeout(() => els.authCode.focus(), 80);
}

async function submitVerify() {
  if (!pendingReg) return;
  const code = els.authCode.value.trim();
  if (!/^\d{6}$/.test(code)) {
    els.authCodeError.textContent = "请输入 6 位数字验证码";
    els.authCodeError.hidden = false;
    return;
  }
  els.authCodeError.hidden = true;
  els.authVerifyBtn.disabled = true;
  els.authVerifyBtn.textContent = "验证中…";
  try {
    await cloud.registerVerify(resolveAuthServer(), pendingReg.email, code);
    const regAccount = cloud.current.account;
    if (regAccount) await ensureSpaceForAccount(regAccount);
    pendingReg = null;
    authGate = false;
    stopResendTimer();
    els.authOverlay.hidden = true;
    showCodeStep(false);
    toast("注册成功，正在首次同步…");
    void syncWithCloud(true);
  } catch (err) {
    els.authCodeError.textContent = err instanceof Error ? err.message : String(err);
    els.authCodeError.hidden = false;
    els.authVerifyBtn.textContent = "验证并登录";
  } finally {
    els.authVerifyBtn.disabled = false;
  }
}

async function resendCode() {
  if (!pendingReg) return;
  els.authResend.disabled = true;
  try {
    const { devCode } = await cloud.registerStart(resolveAuthServer(), pendingReg.email, pendingReg.password);
    enterCodeStep(pendingReg.email, devCode);
    toast("验证码已重新发送");
  } catch (err) {
    els.authCodeError.textContent = err instanceof Error ? err.message : String(err);
    els.authCodeError.hidden = false;
    startResendCountdown();
  }
}

function closeAuth() {
  if (authGate && !cloud.current.account) return; // 登录门：登录前不可关闭
  els.authOverlay.hidden = true;
  els.authError.hidden = true;
  showCodeStep(false);
  pendingReg = null;
  els.authCode.value = "";
  els.authCodeInfo.textContent = "";
  els.authCodeError.hidden = true;
}

function setAuthTab(tab: "login" | "register") {
  authTab = tab;
  els.authTabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const isReg = tab === "register";
  els.authConfirmField.hidden = !isReg;
  if (authGate && !cloud.current.account) {
    els.authTitle.textContent = isReg ? "注册「朝夕」账户" : "登录后即可开始使用";
    els.authSub.textContent = "「朝夕」需登录后使用；数据始终保存在本机，云端仅用于多设备同步";
  } else {
    els.authTitle.textContent = isReg ? "注册「朝夕」账户" : "登录到「朝夕」";
    els.authSub.textContent = isReg
      ? "注册后即可在多设备间同步（数据仍以本机为准）"
      : "本地优先：数据始终保存在本机，登录仅用于多设备云同步";
  }
  els.authSubmit.textContent = isReg ? "注册" : "登录";
  els.authPassword.setAttribute("autocomplete", isReg ? "new-password" : "current-password");
  els.authError.hidden = true;
}

async function submitAuth() {
  const server = resolveAuthServer();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (authTab === "register" && password !== els.authConfirm.value) {
    els.authError.textContent = "两次输入的密码不一致";
    els.authError.hidden = false;
    return;
  }
  els.authError.hidden = true;
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = authTab === "register" ? "注册中…" : "登录中…";
  try {
    if (authTab === "register") {
      const { devCode } = await cloud.registerStart(server, email, password);
      pendingReg = { email, password };
      els.authSubmit.textContent = "注册";
      enterCodeStep(email, devCode);
      return;
    }
    await cloud.login(server, email, password);
    const loginAccount = cloud.current.account;
    if (loginAccount) await ensureSpaceForAccount(loginAccount);
    try {
      localStorage.setItem("simple-todo.cloud.server", cloud.current.account?.server ?? "");
    } catch {
      /* 忽略 */
    }
    authGate = false;
    closeAuth();
    toast("欢迎回来，正在同步…");
    void syncWithCloud(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (authTab === "register" && msg.includes("已注册")) {
      // 最常见的困惑：其实早已注册过 → 自动切换到登录（登录无需验证码）
      setAuthTab("login");
      els.authError.textContent = "该邮箱已注册，已为你切换到登录（登录无需验证码）";
      els.authError.hidden = false;
      els.authSubmit.textContent = "登录";
    } else {
      els.authError.textContent = msg;
      els.authError.hidden = false;
      els.authSubmit.textContent = authTab === "register" ? "注册" : "登录";
    }
  } finally {
    els.authSubmit.disabled = false;
  }
}

// ── 渲染 ───────────────────────────────────────────────

function sortTodos(list: Todo[]): Todo[] {
  if (sortMode === "manual") return list;
  const copy = [...list];
  if (sortMode === "priority") {
    copy.sort((a, b) => b.priority - a.priority);
  } else {
    copy.sort((a, b) => (a.due ?? Number.MAX_SAFE_INTEGER) - (b.due ?? Number.MAX_SAFE_INTEGER));
  }
  return copy;
}

function visibleTodos(): Todo[] {
  let list = todos;
  if (filter === "active") list = list.filter((t) => !t.done);
  else if (filter === "done") list = list.filter((t) => t.done);
  if (tagFilter) list = list.filter((t) => t.tags.includes(tagFilter as string));
  if (query) list = list.filter((t) => t.text.toLowerCase().includes(query));
  return sortTodos(list);
}

function updateSegThumb() {
  const active = segBtns.find((b) => b.classList.contains("active"));
  if (!active || active.offsetWidth === 0) return;
  els.segThumb.style.width = `${active.offsetWidth}px`;
  els.segThumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

function render() {
  closeDuePop();

  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  els.statDone.textContent = String(done);
  els.statTotal.textContent = String(total);
  els.progressFill.style.width = total === 0 ? "0%" : `${Math.round((done / total) * 100)}%`;
  els.clearDone.disabled = done === 0;

  els.list.innerHTML = "";
  const items = visibleTodos();
  els.empty.classList.toggle("show", items.length === 0);

  if (items.length === 0) {
    if (queryRaw) {
      emptyP.textContent = `没有匹配「${shortText(queryRaw, 18)}」的待办`;
      emptySpan.textContent = "换个关键词试试";
    } else if (filter === "done") {
      emptyP.textContent = "还没有已完成的待办";
      emptySpan.textContent = "完成的待办会显示在这里";
    } else if (filter === "active") {
      emptyP.textContent = "没有进行中的待办";
      emptySpan.textContent = "全部搞定了，休息一下";
    } else {
      emptyP.textContent = "列表空空如也";
      emptySpan.textContent = "在上方输入内容，开始记录第一项待办";
    }
  }

  items.forEach((todo, index) => {
    const li = document.createElement("li");
    li.className = `todo-item${todo.done ? " done" : ""}`;
    li.dataset.id = todo.id;
    li.style.animationDelay = `${Math.min(index, 7) * 24}ms`;

    // 拖拽把手（仅「默认排序 + 无筛选 + 无搜索」时可用）
    const sortable = sortMode === "manual" && filter === "all" && !query && !tagFilter;
    if (sortable) {
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "icon-btn drag-grip";
      grip.dataset.act = "drag";
      grip.title = "按住拖拽排序";
      grip.setAttribute("aria-label", "拖拽排序");
      grip.innerHTML = GRIP_SVG;
      li.append(grip);
    }

    const check = document.createElement("label");
    check.className = "check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = todo.done;
    checkbox.setAttribute("aria-label", `${todo.done ? "标记未完成" : "标记完成"}：${todo.text}`);
    checkbox.addEventListener("change", () => void toggleTodo(todo.id));
    const box = document.createElement("span");
    box.className = "box";
    box.innerHTML = CHECK_SVG;
    check.append(checkbox, box);

    const prio = document.createElement("button");
    prio.type = "button";
    prio.className = `priority-btn p${todo.priority}`;
    prio.dataset.act = "priority";
    prio.title = `优先级：${PRIORITY_NAMES[todo.priority]}（点击切换）`;
    prio.setAttribute("aria-label", `优先级：${PRIORITY_NAMES[todo.priority]}，点击切换`);
    prio.addEventListener("click", () => void cyclePriority(todo.id));

    const text = document.createElement("div");
    text.className = "todo-text";
    text.textContent = todo.text;
    text.title = "双击或点击编辑按钮修改";
    text.addEventListener("dblclick", () => startEdit(todo, text));

    const actions = document.createElement("div");
    actions.className = "todo-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.dataset.act = "edit";
    editBtn.title = "编辑";
    editBtn.setAttribute("aria-label", `编辑：${todo.text}`);
    editBtn.innerHTML = EDIT_SVG;
    editBtn.addEventListener("click", () => startEdit(todo, text));

    const dueBtn = document.createElement("button");
    dueBtn.type = "button";
    dueBtn.className = "icon-btn";
    dueBtn.dataset.act = "due";
    dueBtn.title = "设置截止日期";
    dueBtn.setAttribute("aria-label", `设置截止日期：${todo.text}`);
    dueBtn.innerHTML = CAL_SVG;
    dueBtn.addEventListener("click", () => openDuePopover(todo, dueBtn));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.dataset.act = "delete";
    delBtn.title = "删除";
    delBtn.setAttribute("aria-label", `删除：${todo.text}`);
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", () => void removeTodo(todo.id));

    actions.append(editBtn, dueBtn, delBtn);

    const meta = document.createElement("div");
    meta.className = "todo-meta";
    meta.textContent = formatTime(todo.createdAt);
    meta.title = "创建时间";

    li.append(check, prio, text);
    todo.tags.forEach((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `tag-chip${tagFilter === tag ? " active" : ""}`;
      chip.textContent = `#${tag}`;
      chip.title = `按 #${tag} 筛选`;
      chip.setAttribute("aria-label", `按标签 ${tag} 筛选`);
      chip.addEventListener("click", () => toggleTagFilter(tag));
      li.append(chip);
    });
    if (todo.due) {
      const due = document.createElement("span");
      const info = formatDue(todo.due, todo.done);
      due.className = `due-chip ${info.cls}`;
      due.textContent = info.label;
      due.title = `截止日期：${toDateInputValue(todo.due)}`;
      li.append(due);
    }
    if (todo.repeat) {
      const rep = document.createElement("span");
      rep.className = "repeat-chip";
      rep.textContent = `↻ ${REPEAT_LABELS[todo.repeat]}`;
      rep.title = `重复：${REPEAT_LABELS[todo.repeat]}`;
      li.append(rep);
    }
    li.append(meta, actions);
    els.list.appendChild(li);
  });

  renderTagFilter();
  requestAnimationFrame(updateSegThumb);
}

// ── 编辑 ───────────────────────────────────────────────

function startEdit(todo: Todo, textEl: HTMLElement) {
  if (editingId !== null) return;
  editingId = todo.id;
  closeDuePop();

  const input = document.createElement("input");
  input.className = "todo-edit";
  input.value = todo.text;
  input.maxLength = 120;
  input.setAttribute("aria-label", "编辑待办内容");

  let finished = false;
  const finish = async (save: boolean) => {
    if (finished) return;
    finished = true;
    editingId = null;
    const next = input.value.replace(/\s+/g, " ").trim();
    if (save && next && next !== todo.text) {
      todo.text = next;
      todo.tags = parseTags(next);
      todo.updatedAt = Date.now();
      render();
      await persist();
    } else {
      render();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void finish(false);
    }
  });
  input.addEventListener("blur", () => void finish(true));

  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ── 数据操作 ───────────────────────────────────────────

async function addTodo() {
  const text = els.input.value.replace(/\s+/g, " ").trim();
  if (!text) {
    els.input.focus();
    return;
  }
  const now = Date.now();
  todos.unshift({
    id: uid(),
    text,
    done: false,
    createdAt: now,
    updatedAt: now,
    priority: 0,
    due: null,
    completedAt: null,
    repeat: null,
    tags: parseTags(text),
  });
  els.input.value = "";
  els.input.focus();
  render();
  await persist();
}

async function toggleTodo(id: string) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.completedAt = todo.done ? Date.now() : null;
  todo.updatedAt = Date.now();
  let spawned: Todo | null = null;
  if (todo.done && todo.repeat) {
    const index = todos.findIndex((t) => t.id === id);
    spawned = {
      id: uid(),
      text: todo.text,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      priority: todo.priority,
      due: nextOccurrence(todo.due ?? dayStart(0), todo.repeat),
      completedAt: null,
      repeat: todo.repeat,
      tags: [...todo.tags],
    };
    todos.splice(Math.max(0, index), 0, spawned);
  }
  render();
  await persist();
  if (spawned) {
    const d = new Date(spawned.due ?? Date.now());
    toast(`已完成，下一项已排到 ${d.getMonth() + 1}月${d.getDate()}日`);
  }
}

/** 计算下一次重复日期（严格晚于今天） */
function nextOccurrence(from: number, kind: RepeatKind): number {
  const today = dayStart(0);
  const d = new Date(from);
  const step = () => {
    if (kind === "daily") {
      d.setDate(d.getDate() + 1);
    } else if (kind === "weekly") {
      d.setDate(d.getDate() + 7);
    } else if (kind === "monthly") {
      d.setMonth(d.getMonth() + 1);
    } else {
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    }
  };
  let guard = 0;
  do {
    step();
    guard += 1;
  } while (d.getTime() <= today && guard < 400);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function setRepeat(todo: Todo, kind: RepeatKind | null) {
  todo.repeat = kind;
  if (kind && !todo.due) {
    todo.due = dayStart(0);
  }
  todo.updatedAt = Date.now();
  closeDuePop();
  render();
  await persist();
}

async function cyclePriority(id: string) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.priority = todo.priority === 0 ? 3 : todo.priority - 1;
  todo.updatedAt = Date.now();
  render();
  await persist();
}

async function setDue(todo: Todo, ts: number | null) {
  todo.due = ts;
  todo.updatedAt = Date.now();
  closeDuePop();
  render();
  await persist();
}

async function removeTodo(id: string) {
  const index = todos.findIndex((t) => t.id === id);
  if (index < 0) return;
  const [todo] = todos.splice(index, 1);
  addTombstones([todo.id], "todos");
  render();
  await persist();
  scheduleUndo(`已删除「${shortText(todo.text)}」`, [{ todo, index }]);
}

async function clearDone() {
  const removed: { todo: Todo; index: number }[] = [];
  todos.forEach((t, i) => {
    if (t.done) removed.push({ todo: t, index: i });
  });
  if (removed.length === 0) return;
  todos = todos.filter((t) => !t.done);
  addTombstones(
    removed.map((r) => r.todo.id),
    "todos"
  );
  render();
  await persist();
  scheduleUndo(`已清除 ${removed.length} 条已完成`, removed);
}

// ── 视图 / 筛选 / 排序 / 主题 ──────────────────────────

function switchView(name: string) {
  currentView = name;
  navBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
  if (name === "todos") {
    els.input.focus();
    requestAnimationFrame(() => {
      updateSegThumb();
      if (editingId === null) render();
    });
  } else if (name === "notes") {
    renderNotes();
  } else if (name === "clipboard") {
    renderClips();
  } else if (name === "stats") {
    void updateStats();
  }
}

function applyFilter(next: Filter) {
  filter = next;
  try {
    localStorage.setItem(FILTER_KEY, next);
  } catch {
    /* 存储不可用时忽略 */
  }
  segBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === next);
  });
  render();
}

function applySort(next: SortMode) {
  sortMode = SORTS.includes(next) ? next : "manual";
  try {
    localStorage.setItem(SORT_KEY, sortMode);
  } catch {
    /* 忽略 */
  }
  els.sortBtn.dataset.sort = sortMode;
  els.sortLabel.textContent = SORT_LABELS[sortMode];
  render();
}

function applySearch(raw: string) {
  queryRaw = raw.trim();
  query = queryRaw.toLowerCase();
  els.searchClear.hidden = queryRaw === "";
  render();
}

type ThemeMode = "auto" | "light" | "dark";

let themeMode: ThemeMode = "auto";
let systemTheme: "light" | "dark" = "light";

/** 读取系统外观（Tauri 优先，matchMedia 兜底） */
async function resolveSystemTheme(): Promise<"light" | "dark"> {
  try {
    const t = await appWindow.theme();
    if (t === "dark" || t === "light") return t;
  } catch {
    /* 忽略 */
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(mode: ThemeMode) {
  themeMode = mode;
  const resolved: "light" | "dark" = mode === "auto" ? systemTheme : mode;
  document.documentElement.dataset.theme = resolved;
  themeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeVal === mode);
  });
  els.themeThumb.dataset.pos = mode === "light" ? "0" : mode === "dark" ? "1" : "2";
  document.querySelectorAll<HTMLButtonElement>("#set-theme button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.val === mode);
  });
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* 忽略 */
  }
}

// ── 技术栈页 ───────────────────────────────────────────

let appMetaCache: AppMeta | null = null;
let tauriVersionCache = "";
let appVersionCache = "";

function buildStackItems(meta: AppMeta | null): StackItem[] {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/(\d+(?:\.\d+)?)/);
  const webviewVersion = edge ? `v${edge[1]}` : "系统内核";
  const rustcMatch = meta ? meta.rustc.match(/(\d+\.\d+\.\d+)/) : null;
  const rustc = rustcMatch ? `v${rustcMatch[1]}` : "—";
  return [
    {
      key: "tauri",
      name: "Tauri",
      color: "#FFC131",
      role: "桌面框架",
      icon: ICONS.tauri,
      version: meta ? `v${meta.tauri}` : "—",
      group: "框架与语言",
    },
    {
      key: "rust",
      name: "Rust",
      color: "#E4734A",
      role: "核心语言",
      icon: ICONS.rust,
      version: rustc,
      group: "框架与语言",
    },
    {
      key: "typescript",
      name: "TypeScript",
      color: "#3178C6",
      role: "前端语言",
      icon: ICONS.typescript,
      version: `v${__TS_VERSION__}`,
      group: "框架与语言",
    },
    {
      key: "vite",
      name: "Vite",
      color: "#9A7BFF",
      role: "构建工具",
      icon: ICONS.vite,
      version: `v${__VITE_VERSION__}`,
      group: "框架与语言",
    },
    {
      key: "webview2",
      name: "WebView2",
      color: "#4EA0F2",
      role: "渲染引擎",
      icon: ICONS.webview2,
      version: webviewVersion,
      group: "运行与保障",
    },
    {
      key: "ipc",
      name: "IPC 命令通道",
      color: "#7B8CFA",
      role: "进程通信",
      icon: ICONS.ipc,
      version: "invoke / command",
      group: "运行与保障",
    },
    {
      key: "storage",
      name: "原子存储",
      color: "#E8B04B",
      role: "数据持久化",
      icon: ICONS.storage,
      version: "JSON · 本地",
      group: "运行与保障",
    },
    {
      key: "single",
      name: "单实例保障",
      color: "#3ED598",
      role: "运行保障",
      icon: ICONS.single,
      version: "single-instance",
      group: "运行与保障",
    },
  ];
}

function renderStack(meta: AppMeta | null) {
  els.stackGrid.innerHTML = "";
  let lastGroup = "";
  buildStackItems(meta).forEach((item) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      const label = document.createElement("div");
      label.className = "stack-group-label";
      label.textContent = item.group;
      els.stackGrid.appendChild(label);
    }
    const card = document.createElement("article");
    card.className = "stack-card";
    card.style.setProperty("--c", item.color);

    const icon = document.createElement("div");
    icon.className = "stack-icon";
    if (item.icon.startsWith("<svg")) {
      icon.innerHTML = item.icon;
    } else {
      const img = document.createElement("img");
      img.src = item.icon;
      img.alt = "";
      img.draggable = false;
      icon.appendChild(img);
    }

    const info = document.createElement("div");
    info.className = "stack-info";
    const title = document.createElement("h3");
    title.className = "stack-name";
    title.textContent = item.name;
    const role = document.createElement("span");
    role.className = "stack-role";
    role.textContent = item.role;
    const ver = document.createElement("span");
    ver.className = "stack-ver";
    ver.textContent = item.version;
    info.append(title, role, ver);

    card.append(icon, info);
    els.stackGrid.appendChild(card);
  });
}

// ── 便签 ───────────────────────────────────────────────

function noteTitle(note: Note): string {
  const first = note.text.split("\n")[0].trim();
  return first || "空白便签";
}

function renderNotes() {
  els.notesList.innerHTML = "";
  const emptyHint = document.getElementById("notes-empty");
  if (emptyHint) emptyHint.style.display = notes.length === 0 ? "block" : "none";

  [...notes]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((note) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `note-item${note.id === activeNoteId ? " active" : ""}`;
      const title = document.createElement("span");
      title.className = "note-item-title";
      title.textContent = noteTitle(note);
      const time = document.createElement("span");
      time.className = "note-item-time";
      time.textContent = formatTime(note.updatedAt);
      item.append(title, time);
      item.addEventListener("click", () => selectNote(note.id));
      els.notesList.appendChild(item);
    });

  const active = notes.find((n) => n.id === activeNoteId) ?? null;
  els.noteInput.disabled = active === null;
  els.noteDelete.disabled = active === null;
  els.noteInput.value = active ? active.text : "";
  els.noteEditorTime.textContent = active ? `最近保存 ${formatTime(active.updatedAt)}` : "未选择便签";
}

function selectNote(id: string) {
  activeNoteId = id;
  renderNotes();
  els.noteInput.focus();
}

async function persistNotes() {
  try {
    const ok = await invoke<boolean>("save_notes", { notes });
    if (!ok) toast("便签保存失败", "error");
    else scheduleCloudSync();
  } catch (err) {
    toast(`便签保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

async function addNote() {
  const now = Date.now();
  const note: Note = { id: uid(), text: "", createdAt: now, updatedAt: now };
  notes.unshift(note);
  activeNoteId = note.id;
  renderNotes();
  els.noteInput.focus();
  await persistNotes();
}

function onNoteInput() {
  const active = notes.find((n) => n.id === activeNoteId);
  if (!active) return;
  active.text = els.noteInput.value;
  active.updatedAt = Date.now();
  if (noteSaveTimer !== null) window.clearTimeout(noteSaveTimer);
  noteSaveTimer = window.setTimeout(() => {
    noteSaveTimer = null;
    void persistNotes().then(() => renderNotes());
  }, 600);
}

async function deleteNote() {
  const active = notes.find((n) => n.id === activeNoteId);
  if (!active) return;
  notes = notes.filter((n) => n.id !== active.id);
  activeNoteId = notes.length > 0 ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null;
  addTombstones([active.id], "notes");
  renderNotes();
  await persistNotes();
  toast("便签已删除");
}

// ── 专注（番茄钟） ─────────────────────────────────────

const RING_CIRCUMFERENCE = 2 * Math.PI * 104;

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseMinutes(phase: FocusPhase): number {
  if (phase === "focus") return Math.max(1, settings.focusWork || 25);
  if (phase === "short") return Math.max(1, settings.focusShort || 5);
  return Math.max(1, settings.focusLong || 15);
}

function phaseTotalSec(): number {
  return phaseMinutes(focusPhase) * 60;
}

const PHASE_LABEL: Record<FocusPhase, string> = { focus: "专注时间", short: "短休息", long: "长休息" };

function updateFocusToday() {
  const key = toDateInputValue(Date.now());
  const done = focusStats[key] ?? 0;
  const mins = done * (settings.focusWork || 25);
  els.focusToday.textContent =
    done > 0 ? `今日已完成 ${done} 个番茄 · 约 ${mins} 分钟专注` : "今日还没有完成的番茄，开始第一个吧";
}

function populateFocusSelect() {
  if (focusTaskId && !todos.some((t) => t.id === focusTaskId && !t.done)) focusTaskId = null;
  const sel = els.focusTaskSelect;
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "不关联";
  sel.appendChild(none);
  for (const t of todos.filter((x) => !x.done).slice(0, 30)) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.text.length > 28 ? `${t.text.slice(0, 28)}…` : t.text;
    sel.appendChild(opt);
  }
  sel.value = focusTaskId ?? "";
}

function renderFocus() {
  els.focusTime.textContent = fmtClock(timerRemainingSec);
  const total = phaseTotalSec();
  const fraction = total > 0 ? timerRemainingSec / total : 0;
  focusRing.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  focusRing.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
  els.focusPhase.textContent = PHASE_LABEL[focusPhase];
  els.focusPresets.classList.toggle("dimmed", focusPhase !== "focus");
  const rounds = Math.max(2, settings.focusRounds || 4);
  if (focusPhase === "focus") {
    const linked = todos.find((t) => t.id === focusTaskId && !t.done);
    els.focusContext.textContent = linked
      ? `专注：${linked.text.length > 16 ? `${linked.text.slice(0, 16)}…` : linked.text}`
      : `第 ${(roundDone % rounds) + 1} 个番茄 · 每 ${rounds} 个番茄后长休息`;
  } else if (focusPhase === "short") {
    els.focusContext.textContent = "短休息 · 起来活动一下";
  } else {
    els.focusContext.textContent = "长休息 · 好好放松";
  }
  const atStart = timerRemainingSec === total;
  els.focusStart.textContent = timerRunning
    ? "暂停"
    : atStart
      ? focusPhase === "focus"
        ? "开始专注"
        : "开始休息"
      : "继续";
  const filled = focusPhase === "long" ? rounds : roundDone % rounds;
  els.focusDots.innerHTML = "";
  for (let i = 0; i < rounds; i += 1) {
    const dot = document.createElement("i");
    if (i < filled) dot.classList.add("on");
    els.focusDots.appendChild(dot);
  }
  els.focusPresets.querySelectorAll<HTMLButtonElement>(".preset-chip").forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.min) === settings.focusWork);
  });
  document.querySelectorAll<HTMLButtonElement>("#fs-short-chips .preset-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.short) === settings.focusShort)
  );
  document.querySelectorAll<HTMLButtonElement>("#fs-long-chips .preset-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.long) === settings.focusLong)
  );
  document.querySelectorAll<HTMLButtonElement>("#fs-rounds-chips .preset-chip").forEach((c) =>
    c.classList.toggle("active", Number(c.dataset.rounds) === settings.focusRounds)
  );
  els.fsAutoBreak.setAttribute("aria-checked", String(settings.focusAutoBreak));
  els.fsAutoNext.setAttribute("aria-checked", String(settings.focusAutoNext));
  els.fsSound.setAttribute("aria-checked", String(settings.focusSound));
}

async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    /* 系统通知不可用时忽略（界面内已有提示与提示音） */
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    osc.addEventListener("ended", () => void ctx.close());
  } catch {
    /* 忽略音频不可用 */
  }
}

function persistFocusState() {
  const state = {
    mode: focusPhase,
    running: timerRunning,
    endsAt: timerEndsAt,
    remaining: timerRemainingSec,
    roundDone,
    taskId: focusTaskId,
    savedAt: Date.now(),
  };
  void invoke("save_focus_state", { state }).catch(() => undefined);
}

function startTimer() {
  if (timerRunning || timerRemainingSec <= 0) return;
  timerRunning = true;
  timerEndsAt = Date.now() + timerRemainingSec * 1000;
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = window.setInterval(tickTimer, 250);
  renderFocus();
  persistFocusState();
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRemainingSec = Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
  renderFocus();
  persistFocusState();
}

function resetTimer() {
  timerRunning = false;
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  focusPhase = "focus";
  timerRemainingSec = phaseMinutes("focus") * 60;
  renderFocus();
  persistFocusState();
}

function skipPhase() {
  timerRunning = false;
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  focusPhase = focusPhase === "focus" ? "short" : "focus";
  timerRemainingSec = phaseTotalSec();
  renderFocus();
  persistFocusState();
  toast(focusPhase === "focus" ? "已跳过，准备下一轮专注" : "已跳过，开始休息");
}

function tickTimer() {
  timerRemainingSec = Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
  if (timerRemainingSec <= 0) {
    void completePhase();
    return;
  }
  renderFocus();
}

async function completePhase() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
  if (settings.focusSound) beep();
  if (focusPhase === "focus") {
    roundDone += 1;
    void invoke<number>("add_focus_session", { day: toDateInputValue(Date.now()) }).catch(() => undefined);
    const rounds = Math.max(2, settings.focusRounds || 4);
    const isLong = roundDone % rounds === 0;
    focusPhase = isLong ? "long" : "short";
    const mins = phaseMinutes(focusPhase);
    timerRemainingSec = mins * 60;
    void notify("专注完成 🍅", isLong ? `完成 ${rounds} 个番茄，长休息 ${mins} 分钟，好好放松一下` : `休息 ${mins} 分钟，起来活动活动`);
    toast(isLong ? "本轮番茄达成，进入长休息 🎉" : "专注完成，短休息一下");
    renderFocus();
    void (async () => {
      try {
        focusStats = await invoke<Record<string, number>>("load_focus_stats");
      } catch {
        /* 忽略 */
      }
      updateFocusToday();
    })();
    persistFocusState();
    if (settings.focusAutoBreak) startTimer();
  } else {
    focusPhase = "focus";
    timerRemainingSec = phaseMinutes("focus") * 60;
    void notify("休息结束", "开始下一个番茄吧");
    toast("休息结束，准备下一轮");
    renderFocus();
    persistFocusState();
    if (settings.focusAutoNext) startTimer();
  }
}

async function restoreFocusState() {
  try {
    const st = await invoke<null | Record<string, unknown>>("load_focus_state");
    if (!st || typeof st !== "object") return;
    const mode = String(st.mode ?? "focus");
    if (mode !== "focus" && mode !== "short" && mode !== "long") return;
    focusPhase = mode as FocusPhase;
    roundDone = Number(st.roundDone ?? 0) || 0;
    focusTaskId = typeof st.taskId === "string" && st.taskId ? st.taskId : null;
    const running = Boolean(st.running);
    const endsAt = Number(st.endsAt ?? 0);
    const remaining = Number(st.remaining ?? 0);
    if (running && endsAt > Date.now() + 500) {
      timerRunning = true;
      timerEndsAt = endsAt;
      timerRemainingSec = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      timerInterval = window.setInterval(tickTimer, 250);
      renderFocus();
      toast("已恢复进行中的计时");
      return;
    }
    if (running && endsAt > 0 && endsAt <= Date.now()) {
      if (focusPhase === "focus") {
        roundDone += 1;
        const day = toDateInputValue(endsAt || Date.now());
        void invoke<number>("add_focus_session", { day }).catch(() => undefined);
        const rounds = Math.max(2, settings.focusRounds || 4);
        focusPhase = roundDone % rounds === 0 ? "long" : "short";
      } else {
        focusPhase = "focus";
      }
      timerRemainingSec = phaseTotalSec();
      renderFocus();
      toast("上一阶段在应用关闭期间已完成");
      persistFocusState();
      return;
    }
    if (remaining > 0 && remaining < phaseTotalSec()) {
      timerRemainingSec = Math.round(remaining);
      renderFocus();
    }
  } catch {
    /* 状态不可用则忽略 */
  }
}

function setFocusPreset(minutes: number) {
  if (timerRunning) {
    toast("计时进行中，请先暂停或重置", "error");
    return;
  }
  settings.focusWork = minutes;
  focusPhase = "focus";
  timerRemainingSec = minutes * 60;
  renderFocus();
  void persistSettings();
}

// ── 剪贴板历史 ─────────────────────────────────────────

async function pollClipboard() {
  if (!clipListening) return;
  try {
    const text = await clipReadText();
    if (typeof text === "string" && text.length > 0 && text !== lastClipText) {
      lastClipText = text;
      clips.unshift({ id: uid(), text, ts: Date.now() });
      if (clips.length > 60) clips = clips.slice(0, 60);
      if (currentView === "clipboard") renderClips();
    }
  } catch {
    /* 读取失败则忽略 */
  }
}

function renderClips() {
  els.clipList.innerHTML = "";
  els.clipEmpty.classList.toggle("show", clips.length === 0);
  clips.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "clip-item";

    const text = document.createElement("div");
    text.className = "clip-text";
    text.textContent = entry.text;
    text.title = "点击复制到剪贴板";
    text.addEventListener("click", () => void copyClip(entry.text));

    const meta = document.createElement("div");
    meta.className = "clip-meta";
    meta.textContent = formatTime(entry.ts);

    const actions = document.createElement("div");
    actions.className = "clip-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "icon-btn";
    copyBtn.dataset.act = "copy";
    copyBtn.title = "复制";
    copyBtn.setAttribute("aria-label", "复制到剪贴板");
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener("click", () => void copyClip(entry.text));
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.dataset.act = "clip-delete";
    delBtn.title = "删除这条记录";
    delBtn.setAttribute("aria-label", "删除这条记录");
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", () => {
      clips = clips.filter((c) => c.id !== entry.id);
      renderClips();
    });
    actions.append(copyBtn, delBtn);

    li.append(text, meta, actions);
    els.clipList.appendChild(li);
  });
}

async function copyClip(text: string) {
  try {
    await clipWriteText(text);
    lastClipText = text;
    toast("已复制到剪贴板");
  } catch (err) {
    toast(`复制失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

// ── 统计 ───────────────────────────────────────────────

function startOfDayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function mondayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

async function updateStats() {
  try {
    focusStats = await invoke<Record<string, number>>("load_focus_stats");
  } catch {
    /* 忽略 */
  }
  const doneItems = todos.filter((t) => t.done && typeof t.completedAt === "number" && t.completedAt > 0);
  const dayCount = new Map<number, number>();
  doneItems.forEach((t) => {
    const key = startOfDayOf(t.completedAt as number);
    dayCount.set(key, (dayCount.get(key) ?? 0) + 1);
  });

  const today0 = dayStart(0);
  const todayCount = dayCount.get(today0) ?? 0;

  let streak = 0;
  let cursor = dayCount.has(today0) ? today0 : today0 - 86400000;
  while (dayCount.has(cursor)) {
    streak += 1;
    cursor -= 86400000;
  }

  const weekStart = mondayOf(today0);
  const weekCount = doneItems.filter((t) => (t.completedAt as number) >= weekStart).length;
  const now = new Date();

  els.stTotal.textContent = String(doneItems.length);
  els.stToday.textContent = String(todayCount);
  els.stTodayDate.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
  els.stStreak.textContent = String(streak);
  els.stWeek.textContent = String(weekCount);

  const focusToday = focusStats[toDateInputValue(Date.now())] ?? 0;
  const focusTotal = Object.values(focusStats).reduce((sum, n) => sum + n, 0);
  els.stFocusToday.textContent = String(focusToday);
  els.stFocusTotal.textContent = String(focusTotal);
  updateFocusToday();

  els.heatGrid.innerHTML = "";
  const thisMonday = mondayOf(today0);
  for (let w = 11; w >= 0; w -= 1) {
    const colMonday = thisMonday - w * 7 * 86400000;
    for (let dIdx = 0; dIdx < 7; dIdx += 1) {
      const day = colMonday + dIdx * 86400000;
      const cell = document.createElement("i");
      cell.className = "heat-cell";
      const count = dayCount.get(day) ?? 0;
      const dd = new Date(day);
      if (day > today0) {
        cell.classList.add("heat-future");
      } else {
        const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
        cell.classList.add(`heat-${level}`);
        if (day === today0) {
          cell.classList.add("heat-today");
        }
      }
      cell.title = `${dd.getMonth() + 1}月${dd.getDate()}日 · ${count} 项完成`;
      els.heatGrid.appendChild(cell);
    }
  }
}

// ── 设置 ───────────────────────────────────────────────

const HOTKEY = "Ctrl+Alt+Space";

function renderSettings() {
  const flip = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute("aria-checked", on ? "true" : "false");
  };
  flip("set-tray", settings.trayEnabled);
  flip("set-start-min", settings.startMinimized);
  flip("set-hotkey", settings.quickHotkey);
  flip("set-ontop", settings.alwaysOnTop);
  document.querySelectorAll<HTMLButtonElement>("#set-close button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.val === settings.closeAction);
  });
}

async function refreshHotkeyState() {
  const el = document.getElementById("set-hotkey-state");
  if (!el) return;
  try {
    const registered = await hotkeyIsRegistered(HOTKEY);
    el.textContent = registered ? `已注册 · ${HOTKEY}` : "未启用";
  } catch {
    el.textContent = "状态未知";
  }
}

async function refreshAutostartState() {
  const el = document.getElementById("set-autostart");
  if (!el) return;
  try {
    el.setAttribute("aria-checked", (await autostartIsEnabled()) ? "true" : "false");
  } catch {
    /* 读取失败保持原样 */
  }
}

async function applySettings() {
  try {
    await invoke("set_tray_visible", { visible: settings.trayEnabled });
  } catch (err) {
    toast(`托盘设置失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
  try {
    await getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop);
  } catch {
    /* 忽略 */
  }
  try {
    const registered = await hotkeyIsRegistered(HOTKEY);
    if (settings.quickHotkey && !registered) {
      await hotkeyRegister(HOTKEY, () => {
        void summonMain();
      });
    } else if (!settings.quickHotkey && registered) {
      await hotkeyUnregister(HOTKEY);
    }
  } catch (err) {
    toast(`快捷键设置失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
  await refreshHotkeyState();
}

async function persistSettings() {
  renderSettings();
  try {
    await invoke("save_settings", { settings });
  } catch (err) {
    toast(`设置保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
  await applySettings();
}

async function summonMain() {
  try {
    await invoke("show_main_window");
  } catch {
    /* 忽略 */
  }
  switchView("todos");
  els.input.focus();
}

async function toggleAutostart(on: boolean) {
  try {
    if (on) {
      await autostartEnable();
      toast("已开启开机自启");
    } else {
      await autostartDisable();
      toast("已关闭开机自启");
    }
  } catch (err) {
    toast(`开机自启设置失败：${err instanceof Error ? err.message : String(err)}`, "error");
  }
  await refreshAutostartState();
}

// ── 标签筛选 ───────────────────────────────────────────

function toggleTagFilter(tag: string) {
  tagFilter = tagFilter === tag ? null : tag;
  render();
}

function renderTagFilter() {
  if (tagFilter) {
    els.tagFilter.hidden = false;
    els.tagFilter.textContent = `#${tagFilter} ×`;
    els.tagFilter.title = "清除标签筛选";
  } else {
    els.tagFilter.hidden = true;
  }
}

// ── 拖拽排序（指针实现，仅默认排序模式） ───────────────

let dragState: { id: string; pointerId: number; startY: number; active: boolean } | null = null;
let dragInsertIndex = -1;

function onDragPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  const grip = target.closest<HTMLElement>(".drag-grip");
  if (!grip) return;
  const item = grip.closest<HTMLElement>(".todo-item");
  if (!item || !item.dataset.id) return;
  event.preventDefault();
  dragState = { id: item.dataset.id, pointerId: event.pointerId, startY: event.clientY, active: false };
  grip.setPointerCapture(event.pointerId);
}

function onDragPointerMove(event: PointerEvent) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (!dragState.active && Math.abs(event.clientY - dragState.startY) < 5) return;
  if (!dragState.active) {
    dragState.active = true;
    els.list.querySelector<HTMLElement>(`.todo-item[data-id="${dragState.id}"]`)?.classList.add("dragging");
    document.body.classList.add("is-dragging");
  }
  const items = Array.from(els.list.querySelectorAll<HTMLElement>(".todo-item"));
  items.forEach((el) => el.classList.remove("drop-above", "drop-below"));
  dragInsertIndex = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      items[i].classList.add("drop-above");
      dragInsertIndex = i;
      return;
    }
  }
  if (items.length > 0) {
    items[items.length - 1].classList.add("drop-below");
  }
}

function endDragVisuals() {
  els.list.querySelectorAll<HTMLElement>(".todo-item").forEach((el) => {
    el.classList.remove("drop-above", "drop-below", "dragging");
  });
  document.body.classList.remove("is-dragging");
}

async function finishDrag() {
  const state = dragState;
  const target = dragInsertIndex;
  dragState = null;
  dragInsertIndex = -1;
  endDragVisuals();
  if (!state || !state.active || target < 0) return;
  const fromIndex = todos.findIndex((t) => t.id === state.id);
  if (fromIndex < 0) return;
  const toIndex = target > fromIndex ? target - 1 : target;
  if (toIndex === fromIndex) return;
  const [moved] = todos.splice(fromIndex, 1);
  todos.splice(Math.min(toIndex, todos.length), 0, moved);
  moved.updatedAt = Date.now();
  render();
  await persist();
}

function cancelDrag() {
  dragState = null;
  dragInsertIndex = -1;
  endDragVisuals();
}

// ── 窗口控制 ───────────────────────────────────────────

async function syncMaximizedState() {
  try {
    const maximized = await appWindow.isMaximized();
    document.documentElement.classList.toggle("is-maximized", maximized);
  } catch {
    /* 忽略 */
  }
}

function bindWindowControls() {
  $id("win-min").addEventListener("click", () => void appWindow.minimize());
  $id("win-max").addEventListener("click", async () => {
    await appWindow.toggleMaximize();
    void syncMaximizedState();
  });
  $id("win-close").addEventListener("click", () => void appWindow.close());
  void appWindow.onResized(() => {
    void syncMaximizedState();
    updateSegThumb();
  });
  void syncMaximizedState();
}

// ── 事件绑定 ───────────────────────────────────────────

function bindEvents() {
  els.addBtn.addEventListener("click", () => void addTodo());
  els.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void addTodo();
  });
  els.clearDone.addEventListener("click", () => void clearDone());

  segBtns.forEach((btn) => {
    btn.addEventListener("click", () => applyFilter(btn.dataset.filter as Filter));
  });
  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view ?? "todos"));
  });
  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => applyTheme((btn.dataset.themeVal as ThemeMode) ?? "auto"));
  });
  document.querySelectorAll<HTMLButtonElement>("#set-theme button").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme((btn.dataset.val as ThemeMode) ?? "auto"));
  });

  // 搜索
  els.searchInput.addEventListener("input", () => applySearch(els.searchInput.value));
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.searchInput.value = "";
      applySearch("");
      els.searchInput.blur();
    }
  });
  els.searchClear.addEventListener("click", () => {
    els.searchInput.value = "";
    applySearch("");
    els.searchInput.focus();
  });

  // 排序
  els.sortBtn.addEventListener("click", () => {
    const idx = SORTS.indexOf(sortMode);
    applySort(SORTS[(idx + 1) % SORTS.length]);
  });

  // 撤销按钮
  els.toastAction.addEventListener("click", () => {
    const run = toastActionRun;
    if (run) run();
  });

  // 截止日期弹层
  (duePop.querySelectorAll<HTMLButtonElement>(".due-opt")).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("repeat-opt")) {
        const todo = todos.find((t) => t.id === duePopTodoId);
        if (todo) void setRepeat(todo, (btn.dataset.repeat || null) as RepeatKind | null);
        return;
      }
      const days = Number(btn.dataset.days ?? "0");
      const todo = todos.find((t) => t.id === duePopTodoId);
      if (todo) void setDue(todo, dayStart(days));
    });
  });
  (duePop.querySelector(".due-cal-prev") as HTMLButtonElement).addEventListener("click", () => {
    dueCalMonth -= 1;
    if (dueCalMonth < 0) {
      dueCalMonth = 11;
      dueCalYear -= 1;
    }
    const todo = todos.find((t) => t.id === duePopTodoId);
    if (todo) paintDueCalendar(todo);
  });
  (duePop.querySelector(".due-cal-next") as HTMLButtonElement).addEventListener("click", () => {
    dueCalMonth += 1;
    if (dueCalMonth > 11) {
      dueCalMonth = 0;
      dueCalYear += 1;
    }
    const todo = todos.find((t) => t.id === duePopTodoId);
    if (todo) paintDueCalendar(todo);
  });
  (duePop.querySelector(".due-remove") as HTMLButtonElement).addEventListener("click", () => {
    const todo = todos.find((t) => t.id === duePopTodoId);
    if (todo) void setDue(todo, null);
  });
  document.addEventListener("pointerdown", (event) => {
    if (duePop.hidden) return;
    const target = event.target as HTMLElement;
    if (duePop.contains(target)) return;
    if (target.closest(".icon-btn[data-act=due]")) return;
    closeDuePop();
  });

  // 导出数据
  els.exportData.addEventListener("click", async () => {
    try {
      const path = await invoke<string>("export_todos");
      toast(`已导出：${path}`);
    } catch (err) {
      toast(`导出失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });

  // 复制诊断信息
  els.copyDiag.addEventListener("click", async () => {
    const webview = (navigator.userAgent.match(/Edg\/([\d.]+)/) || [])[1] || "未知";
    const rustMatch = appMetaCache?.rustc?.match(/\d+\.\d+\.\d+/);
    const sizeTxt =
      appMetaCache && appMetaCache.exeSize > 0
        ? `${appMetaCache.exeSize.toLocaleString()} 字节（${(appMetaCache.exeSize / 1048576).toFixed(1)} MB）`
        : "未知";
    const lines = [
      "朝夕 · 诊断信息",
      "────────────────────",
      `版本：v${appMetaCache?.version ?? "未知"}`,
      `运行时：Tauri ${tauriVersionCache || appMetaCache?.tauri || "未知"} · Rust ${rustMatch ? rustMatch[0] : "未知"} · WebView2 Edg/${webview}`,
      `前端：TypeScript ${__TS_VERSION__} · Vite ${__VITE_VERSION__} · 原生 DOM 零框架`,
      `可执行文件：${sizeTxt}`,
      "数据目录：%APPDATA%\\com.simple.todo",
      `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    ];
    try {
      await clipWriteText(lines.join("\n"));
      toast("诊断信息已复制到剪贴板");
    } catch (err) {
      toast(`复制失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });

  // ── 版本与更新 ──
  const cmpVer = (a: string, b: string): number => {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  const setVerStatus = (html: string) => {
    els.verStatus.innerHTML = html;
    els.verStatus.hidden = false;
  };
  const renderChangelog = () => {
    els.verLog.innerHTML = CHANGELOG.map((entry, idx) => {
      const items = entry.highlights.map((h) => `<li>${h}</li>`).join("");
      const badge = idx === 0 ? '<span class="ver-latest">最新</span>' : "";
      return `<div class="ver-item"><div class="ver-head"><b>v${entry.version}</b><span>${entry.date}</span>${badge}</div><ul>${items}</ul></div>`;
    }).join("");
  };
  els.verLogToggle.addEventListener("click", () => {
    const show = els.verLog.hidden;
    els.verLog.hidden = !show;
    els.verLogToggle.setAttribute("aria-expanded", String(show));
    if (show && els.verLog.childElementCount === 0) renderChangelog();
  });
  type RelInfo = { latest: string; date: string; page: string; download: string };
  const fetchJson = async (url: string, ms: number): Promise<unknown> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  // 数据源 ①：官方服务器（国内直达，优先）
  const checkViaServer = async (): Promise<RelInfo | null> => {
    const vendor = (__CLOUD_SERVER__ || "").trim();
    if (!vendor) return null;
    try {
      const data = (await fetchJson(`${vendor}/api/app/latest`, 8000)) as {
        latest?: string;
        date?: string;
        urls?: { china?: { page?: string; portable?: string }; github?: { page?: string } };
      };
      if (!data || !data.latest) return null;
      const china = data.urls?.china ?? {};
      const github = data.urls?.github ?? {};
      return {
        latest: String(data.latest),
        date: String(data.date ?? ""),
        page: china.page || github.page || "",
        download: china.portable || china.page || github.page || "",
      };
    } catch {
      return null;
    }
  };
  // 数据源 ②：GitHub Releases（海外兜底）
  const checkViaGithub = async (): Promise<RelInfo | null> => {
    try {
      const list = (await fetchJson("https://api.github.com/repos/btrencai/zhaoxi/releases?per_page=10", 9000)) as Array<{
        draft?: boolean;
        tag_name?: string;
        html_url?: string;
        published_at?: string;
      }>;
      const release = list.find((r) => !r.draft && r.tag_name);
      if (!release || !release.tag_name) return null;
      const d = release.published_at ? new Date(release.published_at) : null;
      const date = d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : "";
      return {
        latest: release.tag_name.replace(/^v/i, ""),
        date,
        page: release.html_url ?? "",
        download: release.html_url ?? "",
      };
    } catch {
      return null;
    }
  };
  els.verCheck.addEventListener("click", async () => {
    els.verCheck.disabled = true;
    setVerStatus("正在检查更新…");
    try {
      const info = (await checkViaServer()) ?? (await checkViaGithub());
      if (!info) {
        setVerStatus(`<span class="ver-err">检查失败</span><span>无法连接更新服务器（网络受限或稍后再试）</span>`);
        return;
      }
      if (cmpVer(info.latest, appVersionCache || "0.0.0") > 0) {
        setVerStatus(
          `<span class="ver-new">发现新版本 v${info.latest}</span><span>（当前 v${appVersionCache}）</span>` +
            `<button class="btn-ghost" id="ver-download" type="button">前往下载</button>`
        );
        document.getElementById("ver-download")?.addEventListener("click", () => {
          void invoke("open_external", { url: info.download || info.page }).catch(() =>
            toast("打开链接失败", "error")
          );
        });
      } else {
        const hint =
          cmpVer(info.latest, appVersionCache || "0.0.0") === 0
            ? `<span>最近发布：v${info.latest}${info.date ? ` · ${info.date}` : ""}</span>`
            : "";
        setVerStatus(`<span class="ver-ok">已是最新版本（v${appVersionCache}）✓</span>${hint}`);
      }
    } finally {
      els.verCheck.disabled = false;
    }
  });

  // 云端同步
  els.cloudBtn.addEventListener("click", () => {
    if (cloud.current.account) {
      void syncWithCloud(true);
    } else {
      openAuth();
    }
  });
  els.authClose.addEventListener("click", closeAuth);
  els.authOverlay.addEventListener("mousedown", (e) => {
    if (e.target === els.authOverlay) closeAuth();
  });
  els.authTabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.addEventListener("click", () => setAuthTab(b.dataset.tab === "register" ? "register" : "login"));
  });
  els.authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitAuth();
  });
  els.authAdv.addEventListener("click", () => {
    authServerManual = true;
    els.authServer.value = ""; // 不预填，避免展示官方地址
    const field = els.authServer.closest(".auth-field") as HTMLElement | null;
    if (field) field.hidden = false;
    els.authAdv.hidden = true;
    els.authAdvBack.hidden = false;
    els.authServer.focus();
  });
  els.authAdvBack.addEventListener("click", () => {
    authServerManual = false;
    els.authServer.value = "";
    const field = els.authServer.closest(".auth-field") as HTMLElement | null;
    if (field) field.hidden = true;
    els.authAdv.hidden = false;
    els.authAdvBack.hidden = true;
  });
  els.authVerifyBtn.addEventListener("click", () => void submitVerify());
  els.authResend.addEventListener("click", () => void resendCode());
  els.authEditBack.addEventListener("click", () => showCodeStep(false));
  els.authQuit.addEventListener("click", () => {
    void invoke("quit_app");
  });
  els.authCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitVerify();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.authOverlay.hidden) {
      e.stopPropagation();
      closeAuth();
    }
  });

  // 便签
  els.noteAdd.addEventListener("click", () => void addNote());
  els.noteInput.addEventListener("input", onNoteInput);
  els.noteDelete.addEventListener("click", () => void deleteNote());

  // 专注
  els.focusStart.addEventListener("click", () => {
    if (timerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });
  els.focusReset.addEventListener("click", resetTimer);
  els.focusPresets.querySelectorAll<HTMLButtonElement>(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => setFocusPreset(Number(chip.dataset.min ?? "25")));
  });
  els.focusSkip.addEventListener("click", skipPhase);
  els.focusSettingsToggle.addEventListener("click", () => {
    const show = els.focusSettings.hidden;
    els.focusSettings.hidden = !show;
    els.focusSettingsToggle.setAttribute("aria-expanded", String(show));
  });
  els.focusTaskSelect.addEventListener("change", () => {
    focusTaskId = els.focusTaskSelect.value || null;
    persistFocusState();
    const t = todos.find((x) => x.id === focusTaskId);
    toast(t ? `已关联「${t.text.length > 16 ? `${t.text.slice(0, 16)}…` : t.text}」` : "已取消关联");
  });
  document.querySelectorAll<HTMLButtonElement>("#fs-short-chips .preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.focusShort = Number(chip.dataset.short ?? "5");
      renderFocus();
      void persistSettings();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("#fs-long-chips .preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.focusLong = Number(chip.dataset.long ?? "15");
      renderFocus();
      void persistSettings();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("#fs-rounds-chips .preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      settings.focusRounds = Number(chip.dataset.rounds ?? "4");
      renderFocus();
      void persistSettings();
    });
  });
  const wireFocusSwitch = (id: string, apply: (on: boolean) => void) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", () => {
      const on = el.getAttribute("aria-checked") !== "true";
      el.setAttribute("aria-checked", String(on));
      apply(on);
      void persistSettings();
    });
  };
  wireFocusSwitch("fs-auto-break", (on) => {
    settings.focusAutoBreak = on;
  });
  wireFocusSwitch("fs-auto-next", (on) => {
    settings.focusAutoNext = on;
  });
  wireFocusSwitch("fs-sound", (on) => {
    settings.focusSound = on;
    if (on) beep();
  });
  document.querySelectorAll<HTMLElement>('.nav-item[data-view="focus"]').forEach((el) => {
    el.addEventListener("click", () => {
      populateFocusSelect();
      updateFocusToday();
      renderFocus();
    });
  });
  // 测试钩子：仅当 localStorage 标记开启（E2E 快速走完阶段用）
  if (localStorage.getItem("simple-todo.dev.focus") === "1") {
    (window as unknown as Record<string, unknown>).__focusTest = {
      finish: () => {
        if (timerRunning) {
          timerEndsAt = Date.now() - 1500;
        } else {
          timerRemainingSec = 0;
          void completePhase();
        }
      },
      state: () => ({
        phase: focusPhase,
        running: timerRunning,
        remaining: timerRemainingSec,
        round: roundDone,
        taskId: focusTaskId,
      }),
    };
  }

  // 剪贴板
  els.clipToggle.addEventListener("click", () => {
    clipListening = !clipListening;
    els.clipToggle.textContent = clipListening ? "暂停监听" : "恢复监听";
    toast(clipListening ? "已恢复剪贴板监听" : "已暂停剪贴板监听");
  });
  els.clipClear.addEventListener("click", () => {
    clips = [];
    renderClips();
    toast("剪贴板历史已清空");
  });

  // 设置页
  const bindSwitch = (id: string, apply: (on: boolean) => void) => {
    document.getElementById(id)?.addEventListener("click", () => {
      const el = document.getElementById(id);
      const on = el?.getAttribute("aria-checked") !== "true";
      el?.setAttribute("aria-checked", on ? "true" : "false");
      apply(on);
    });
  };
  bindSwitch("set-tray", (on) => {
    settings.trayEnabled = on;
    void persistSettings();
  });
  bindSwitch("set-start-min", (on) => {
    settings.startMinimized = on;
    void persistSettings();
  });
  bindSwitch("set-ontop", (on) => {
    settings.alwaysOnTop = on;
    void persistSettings();
  });
  bindSwitch("set-hotkey", (on) => {
    settings.quickHotkey = on;
    void persistSettings();
  });
  bindSwitch("set-autostart", (on) => {
    void toggleAutostart(on);
  });
  document.querySelectorAll<HTMLButtonElement>("#set-close button").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.closeAction = btn.dataset.val === "quit" ? "quit" : "tray";
      void persistSettings();
    });
  });

  // 拖拽排序
  els.list.addEventListener("pointerdown", onDragPointerDown);
  els.list.addEventListener("pointermove", onDragPointerMove);
  els.list.addEventListener("pointerup", () => void finishDrag());
  els.list.addEventListener("pointercancel", cancelDrag);

  // 标签筛选清除
  els.tagFilter.addEventListener("click", () => {
    tagFilter = null;
    render();
  });

  // 快捷键
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "n") {
      event.preventDefault();
      switchView("todos");
      els.input.focus();
      els.input.select();
    } else if (key === "f") {
      event.preventDefault();
      switchView("todos");
      els.searchInput.focus();
      els.searchInput.select();
    } else if (key === "z" && undo) {
      event.preventDefault();
      void doUndo();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !duePop.hidden) {
      closeDuePop();
    }
  });

  document.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, .todo-text, .data-path, .due-pop")) return;
    event.preventDefault();
  });
}

// ── 初始化 ─────────────────────────────────────────────

async function init() {
  bindEvents();
  bindWindowControls();

  let savedMode: ThemeMode = "auto";
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "auto" || raw === "light" || raw === "dark") savedMode = raw;
  } catch {
    /* 忽略 */
  }
  systemTheme = await resolveSystemTheme();
  applyTheme(savedMode);
  void appWindow.onThemeChanged(({ payload }) => {
    if (payload === "light" || payload === "dark") {
      systemTheme = payload;
      if (themeMode === "auto") applyTheme("auto");
    }
  });
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      systemTheme = event.matches ? "dark" : "light";
      if (themeMode === "auto") applyTheme("auto");
    });
  } catch {
    /* 忽略 */
  }

  let savedFilter: Filter = "all";
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (raw === "all" || raw === "active" || raw === "done") savedFilter = raw;
  } catch {
    /* 忽略 */
  }
  applyFilter(savedFilter);

  let savedSort: SortMode = "manual";
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw === "manual" || raw === "priority" || raw === "due") savedSort = raw;
  } catch {
    /* 忽略 */
  }
  applySort(savedSort);

  els.pageDate.textContent = formatToday();

  const [appVersion, tauriVersion, meta] = await Promise.all([
    getVersion().catch(() => ""),
    getTauriVersion().catch(() => ""),
    invoke<AppMeta>("app_meta").catch(() => null),
  ]);
  if (appVersion) {
    appVersionCache = appVersion;
    els.appVersion.textContent = `v${appVersion}`;
    els.verCurrent.textContent = `v${appVersion}`;
  }
  if (tauriVersion) {
    tauriVersionCache = tauriVersion;
    els.stackChip.textContent = `Tauri ${tauriVersion} · Rust`;
    els.stackPill.textContent = `Tauri ${tauriVersion}`;
  }
  appMetaCache = meta;
  if (meta && meta.exeSize > 0) {
    const sizeMB = meta.exeSize / 1048576;
    els.statSize.textContent = `${sizeMB.toFixed(1)} MB`;
    const pct = Math.max(3, Math.min(100, (sizeMB / 80) * 100));
    els.barApp.style.width = `${pct.toFixed(1)}%`;
    els.barRef.style.width = "100%";
    els.barAppVal.textContent = `${sizeMB.toFixed(1)} MB`;
  }
  renderStack(meta);

  try {
    const loaded = await invoke<Todo[]>("load_todos");
    todos = Array.isArray(loaded) ? loaded : [];
  } catch (err) {
    console.error("读取待办失败：", err);
    toast(`读取本地数据失败：${err instanceof Error ? err.message : String(err)}`, "error");
    todos = [];
  }

  try {
    const loadedNotes = await invoke<Note[]>("load_notes");
    notes = Array.isArray(loadedNotes) ? loadedNotes : [];
    activeNoteId = notes.length > 0 ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null;
  } catch (err) {
    console.error("读取便签失败：", err);
    notes = [];
  }

  try {
    const loadedSettings = await invoke<AppSettings>("load_settings");
    if (loadedSettings && typeof loadedSettings === "object") {
      settings = { ...settings, ...loadedSettings };
    }
  } catch (err) {
    console.error("读取设置失败：", err);
  }
  renderSettings();
  void refreshAutostartState();
  void applySettings();

  await loadMeta();
  cloud.setSnapshotProvider(() => ({
    todos: todos as unknown as SyncTodo[],
    notes: notes as unknown as SyncNote[],
    tombstones,
  }));
  cloud.onState((state) => {
    renderCloudChip(state);
    renderCloudSettings(state);
  });
  await cloud.init();
  {
    // 迁移/校准本地空间归属标记（老版本数据默认归属当前登录账号；只写标记，不动任何数据）
    const startupAccount = cloud.current.account;
    if (startupAccount) {
      const owner = await loadOwner();
      if (!owner || owner.userId !== startupAccount.userId) {
        await saveOwner({ userId: startupAccount.userId, email: startupAccount.email });
      }
    }
  }
  if (!cloud.current.account) openAuth(true);

  void listen("focus-input", () => {
    void summonMain();
  });

  renderFocus();
  void restoreFocusState();
  void (async () => {
    try {
      focusStats = await invoke<Record<string, number>>("load_focus_stats");
    } catch {
      /* 忽略 */
    }
    updateFocusToday();
  })();
  window.setInterval(() => void pollClipboard(), 1500);
  window.setTimeout(() => void pollClipboard(), 400);

  render();
  els.input.focus();
}

void init();
