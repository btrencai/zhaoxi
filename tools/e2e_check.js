/* 端到端验证：通过 CDP 驱动打包后的 Tauri 应用（WebView2 调试端口）。
 * 启动方式：环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 * 依赖：Node >= 22（内置 fetch 与 WebSocket）。 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || 9222;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPage(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && !String(t.url).startsWith("devtools"));
      if (page) return page;
    } catch (err) {
      /* 端口未就绪 */
    }
    await sleep(800);
  }
  throw new Error("等待调试端口超时");
}

(async () => {
  const page = await waitForPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")));
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evalJS = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const r = res.result || {};
    if (r.exceptionDetails) {
      throw new Error("页面内异常: " + JSON.stringify(r.exceptionDetails.exception) + " | 表达式: " + expression);
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 200; i++) {
    const state = await evalJS(
      'document.readyState + "|" + (document.getElementById("stat-done") ? "app" : "blank")'
    );
    if (state === "complete|app") break;
    await sleep(300);
  }

  const report = {};
  report.title = await evalJS("document.title");
  // 首运行登录门：初始化是异步的（cloud.init 后开门），轮询等待最多 5 秒
  let gateUp = false;
  for (let i = 0; i < 25; i++) {
    gateUp = await evalJS(
      '!document.getElementById("auth-overlay").hidden && document.getElementById("auth-close").hidden'
    );
    if (gateUp) break;
    await sleep(200);
  }
  report.firstRunGate = gateUp;
  report.quitVisibleAtGate = await evalJS('!document.getElementById("auth-quit").hidden');
  report.titlebarClickableAtGate = await evalJS(`(() => {
    const btn = document.getElementById("win-close");
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && btn.contains(el);
  })()`);
  report.shell =
    (await evalJS("!!document.querySelector('.titlebar')")) &&
    (await evalJS("!!document.getElementById('theme-seg')"));
  report.itemsBefore = await evalJS('document.querySelectorAll(".todo-item").length');
  report.statsBefore = await evalJS(
    'document.getElementById("stat-done").textContent + "/" + document.getElementById("stat-total").textContent'
  );
  report.firstItemText = await evalJS(
    'document.querySelector(".todo-item .todo-text") ? document.querySelector(".todo-item .todo-text").textContent : ""'
  );
  report.progressBefore = await evalJS('document.getElementById("progress-fill").style.width');

  // 添加一项
  await evalJS(
    '(() => { const i = document.getElementById("todo-input"); i.value = "E2E-Tauri-测试条目"; document.getElementById("add-btn").click(); return true; })()'
  );
  await sleep(700);
  report.itemsAfterAdd = await evalJS('document.querySelectorAll(".todo-item").length');
  report.statsAfterAdd = await evalJS(
    'document.getElementById("stat-done").textContent + "/" + document.getElementById("stat-total").textContent'
  );

  // 勾选第一项（新增项在顶部）
  await evalJS('(() => { document.querySelector(".todo-item .check input").click(); return true; })()');
  await sleep(700);
  report.statsAfterToggle = await evalJS(
    'document.getElementById("stat-done").textContent + "/" + document.getElementById("stat-total").textContent'
  );
  report.progressAfterToggle = await evalJS('document.getElementById("progress-fill").style.width');

  // 编辑第一项：点编辑按钮 → 改文本 → 回车提交
  await evalJS('(() => { document.querySelector(".todo-item .todo-actions .icon-btn").click(); return true; })()');
  await sleep(400);
  report.editInputShown = await evalJS('!!document.querySelector(".todo-item .todo-edit")');
  await evalJS(
    '(() => { const input = document.querySelector(".todo-item .todo-edit"); ' +
      'input.value = "E2E-已编辑条目"; ' +
      'input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); ' +
      "return true; })()"
  );
  await sleep(700);
  report.firstItemTextAfterEdit = await evalJS('document.querySelector(".todo-item .todo-text").textContent');

  // 过滤：进行中（此时全部已完成 → 0 条 + 空态）
  await evalJS('(() => { document.querySelector(".seg-btn[data-filter=active]").click(); return true; })()');
  await sleep(400);
  report.activeFilterCount = await evalJS('document.querySelectorAll(".todo-item").length');
  report.emptyShownOnActive = await evalJS('document.getElementById("empty-state").classList.contains("show")');
  await evalJS('(() => { document.querySelector(".seg-btn[data-filter=all]").click(); return true; })()');
  await sleep(300);

  // 主题切换：确保深色起点 → 浅色 → 验证 computed 背景变化 → 切回深色
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=dark]").click(); return true; })()');
  await sleep(500);
  const darkBg = await evalJS("getComputedStyle(document.body).backgroundColor");
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=light]").click(); return true; })()');
  await sleep(500);
  report.themeAfterSwitch = await evalJS("document.documentElement.dataset.theme");
  const lightBg = await evalJS("getComputedStyle(document.body).backgroundColor");
  report.themeChangedBg = darkBg !== lightBg;
  report.lightBg = lightBg;

  // 外观模式：自动（跟随系统）→ 侧栏与设置页应同步
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=auto]").click(); return true; })()');
  await sleep(700);
  report.themeAutoApplied = await evalJS("document.documentElement.dataset.theme");
  report.themeAutoActive = await evalJS('document.querySelector(".theme-btn.active").dataset.themeVal');
  report.settingsThemeSync = await evalJS('document.querySelector("#set-theme button.active").dataset.val');
  report.themeThumbPos = await evalJS('document.getElementById("theme-thumb").dataset.pos');
  await sleep(300);

  // 技术栈视图
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stack]").click(); return true; })()');
  await sleep(500);
  report.stackVisible = await evalJS('document.getElementById("view-stack").classList.contains("active")');
  report.stackPill = await evalJS('document.getElementById("stack-pill").textContent');
  report.stackCards = await evalJS('document.querySelectorAll(".stack-card").length');
  const cardVer = (name) =>
    `Array.from(document.querySelectorAll(".stack-card")).filter(c => c.querySelector("h3").textContent === "${name}")[0].querySelector(".stack-ver").textContent`;
  report.tauriVer = await evalJS(cardVer("Tauri"));
  report.rustVer = await evalJS(cardVer("Rust"));
  report.webviewVer = await evalJS(cardVer("WebView2"));
  report.tsVer = await evalJS(cardVer("TypeScript"));
  report.exeSize = await evalJS('document.getElementById("stat-size").textContent');
  report.stackGroups = await evalJS(
    'Array.from(document.querySelectorAll(".stack-group-label")).map((l) => l.textContent).join(" | ")'
  );
  report.barAppWidth = await evalJS('document.getElementById("bar-app").style.width');
  report.barRefWidth = await evalJS('document.getElementById("bar-ref").style.width');

  // ══ 新增功能测试 ══
  await evalJS('(() => { document.querySelector(".nav-item[data-view=todos]").click(); return true; })()');
  await sleep(400);
  await evalJS(
    '(() => { const i = document.getElementById("todo-input"); i.value = "E2E-功能测试"; document.getElementById("add-btn").click(); return true; })()'
  );
  await sleep(700);
  report.itemsBeforeNew = await evalJS('document.querySelectorAll(".todo-item").length');

  // 搜索
  await evalJS(
    '(() => { const s = document.getElementById("search-input"); s.value = "功能"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await sleep(400);
  report.searchHitCount = await evalJS('document.querySelectorAll(".todo-item").length');
  await evalJS(
    '(() => { const s = document.getElementById("search-input"); s.value = "xyz不存在的词"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await sleep(400);
  report.searchMissCount = await evalJS('document.querySelectorAll(".todo-item").length');
  report.searchMissEmptyShown = await evalJS('document.getElementById("empty-state").classList.contains("show")');
  await evalJS('(() => { document.getElementById("search-clear").click(); return true; })()');
  await sleep(400);
  report.searchResetCount = await evalJS('document.querySelectorAll(".todo-item").length');

  // 优先级：第一项 无 → 高（点击循环）
  report.prioBefore = await evalJS('document.querySelector(".todo-item .priority-btn").className');
  await evalJS('(() => { document.querySelector(".todo-item .priority-btn").click(); return true; })()');
  await sleep(400);
  report.prioAfter = await evalJS('document.querySelector(".todo-item .priority-btn").className');

  // 截止日期：明天 → 昨天（触发逾期样式）
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(400);
  report.duePopShown = await evalJS('!document.getElementById("due-pop").hidden');
  await evalJS('(() => { document.querySelector("#due-pop .due-opt[data-days=\'1\']").click(); return true; })()');
  await sleep(500);
  report.dueChipTomorrow = await evalJS(
    'document.querySelector(".todo-item .due-chip") ? document.querySelector(".todo-item .due-chip").textContent : "无"'
  );
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(500);
  // 用自绘月历选「昨天」（若昨天在上个月则先翻月）
  await evalJS(
    '(() => { const y = new Date(); y.setDate(y.getDate() - 1); const t = new Date(); if (y.getMonth() !== t.getMonth()) { document.querySelector("#due-pop .due-cal-prev").click(); } const cells = [...document.querySelectorAll("#due-pop .due-cal-day")].filter((c) => !c.classList.contains("outside")); const target = cells.find((c) => c.textContent === String(y.getDate())); if (target) target.click(); return true; })()'
  );
  await sleep(600);
  report.dueChipOverdueClass = await evalJS(
    'document.querySelector(".todo-item .due-chip") ? document.querySelector(".todo-item .due-chip").className : "无"'
  );

  // 撤销删除
  report.undoCountBefore = await evalJS('document.querySelectorAll(".todo-item").length');
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=delete]").click(); return true; })()');
  await sleep(600);
  report.undoCountAfterDelete = await evalJS('document.querySelectorAll(".todo-item").length');
  report.toastActionShown = await evalJS('!document.getElementById("toast-action").hidden');
  await evalJS('(() => { document.getElementById("toast-action").click(); return true; })()');
  await sleep(600);
  report.undoCountAfterUndo = await evalJS('document.querySelectorAll(".todo-item").length');
  report.undoFirstText = await evalJS('document.querySelector(".todo-item .todo-text").textContent');

  // 排序：第一项降为中、第二项升为高 → 切到优先级排序后第二项应排到第一
  await evalJS('(() => { document.querySelectorAll(".todo-item .priority-btn")[0].click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.querySelectorAll(".todo-item .priority-btn")[1].click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.getElementById("sort-btn").click(); return true; })()');
  await sleep(400);
  report.sortMode = await evalJS('document.getElementById("sort-btn").dataset.sort');
  report.firstItemAfterSort = await evalJS('document.querySelector(".todo-item .todo-text").textContent');

  // 导出数据
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stack]").click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.getElementById("export-data").click(); return true; })()');
  await sleep(800);
  report.exportToast = await evalJS('document.getElementById("toast-msg").textContent');

  // 复制诊断信息
  await evalJS('(() => { document.getElementById("copy-diag").click(); return true; })()');
  await sleep(900);
  report.diagToast = await evalJS('document.getElementById("toast-msg").textContent');
  let clip = "";
  try {
    clip = execSync(
      'powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw"',
      { encoding: "utf8" }
    );
  } catch (err) {
    clip = "";
  }
  report.diagClipboard = clip.includes("朝夕 · 诊断信息")
    ? "命中（含版本与体积）"
    : `未命中（${clip.slice(0, 40).replace(/\n/g, " ")}）`;

  // ══ 第三轮：便签 / 专注 / 剪贴板 / 统计 ══
  // 便签
  await evalJS('(() => { document.querySelector(".nav-item[data-view=notes]").click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.getElementById("note-add").click(); return true; })()');
  await sleep(300);
  await evalJS(
    '(() => { const t = document.getElementById("note-input"); t.value = "E2E-便签内容"; t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await sleep(1100);
  report.noteCount = await evalJS('document.querySelectorAll(".note-item").length');
  report.noteTitle = await evalJS('document.querySelector(".note-item .note-item-title").textContent');
  await evalJS('(() => { document.getElementById("note-add").click(); return true; })()');
  await sleep(300);
  await evalJS('(() => { document.getElementById("note-delete").click(); return true; })()');
  await sleep(500);
  report.noteCountAfterDelete = await evalJS('document.querySelectorAll(".note-item").length');

  // 专注（番茄钟）
  await evalJS('(() => { document.querySelector(".nav-item[data-view=focus]").click(); return true; })()');
  await sleep(400);
  report.focusInitial = await evalJS('document.getElementById("focus-time").textContent');
  await evalJS('(() => { document.querySelector(".preset-chip[data-min=\'15\']").click(); return true; })()');
  await sleep(300);
  report.focusAfterPreset = await evalJS('document.getElementById("focus-time").textContent');
  await evalJS('(() => { document.getElementById("focus-start").click(); return true; })()');
  await sleep(2600);
  report.focusStartLabel = await evalJS('document.getElementById("focus-start").textContent');
  report.focusTickedTime = await evalJS('document.getElementById("focus-time").textContent');
  await evalJS('(() => { document.getElementById("focus-start").click(); return true; })()');
  await sleep(300);
  await evalJS('(() => { document.getElementById("focus-reset").click(); return true; })()');
  await sleep(300);
  report.focusAfterReset = await evalJS('document.getElementById("focus-time").textContent');
  await evalJS('(() => { document.querySelector(".preset-chip[data-min=\'25\']").click(); return true; })()');

  // 剪贴板
  await evalJS('(() => { document.querySelector(".nav-item[data-view=clipboard]").click(); return true; })()');
  await sleep(2000);
  report.clipCount = await evalJS('document.querySelectorAll(".clip-item").length');
  report.clipFirstText = await evalJS(
    'document.querySelector(".clip-item .clip-text") ? document.querySelector(".clip-item .clip-text").textContent : "无"'
  );
  await evalJS('(() => { const btn = document.querySelector(".clip-item .icon-btn[data-act=copy]"); if (btn) btn.click(); return true; })()');
  await sleep(500);
  report.clipCopyToast = await evalJS('document.getElementById("toast-msg").textContent');
  await evalJS('(() => { document.getElementById("clip-clear").click(); return true; })()');
  await sleep(300);
  report.clipAfterClear = await evalJS('document.querySelectorAll(".clip-item").length');
  report.clipEmptyShown = await evalJS('document.getElementById("clip-empty").classList.contains("show")');

  // 统计
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stats]").click(); return true; })()');
  await sleep(500);
  report.statsTotal = await evalJS('document.getElementById("st-total").textContent');
  report.statsToday = await evalJS('document.getElementById("st-today").textContent');
  report.statsStreak = await evalJS('document.getElementById("st-streak").textContent');
  report.statsWeek = await evalJS('document.getElementById("st-week").textContent');
  report.heatCells = await evalJS('document.querySelectorAll("#heat-grid .heat-cell").length');
  report.navItems = await evalJS('document.querySelectorAll(".nav-item").length');

  // ══ 第四轮：设置 / 托盘 / 自启 / 快捷键 / 置顶 ══
  await evalJS('(() => { document.querySelector(".nav-item[data-view=settings]").click(); return true; })()');
  await sleep(600);

  // 设置页「外观」分段与侧栏双向同步
  await evalJS('(() => { document.querySelector("#set-theme button[data-val=dark]").click(); return true; })()');
  await sleep(600);
  report.settingsThemeDarkApplied = await evalJS("document.documentElement.dataset.theme");
  report.sidebarSegSyncDark = await evalJS('document.querySelector(".theme-btn.active").dataset.themeVal');
  await evalJS('(() => { document.querySelector("#set-theme button[data-val=auto]").click(); return true; })()');
  await sleep(600);
  report.settingsThemeAutoApplied = await evalJS("document.documentElement.dataset.theme");

  report.setTrayDefault = await evalJS('document.getElementById("set-tray").getAttribute("aria-checked")');
  report.setCloseDefault = await evalJS('document.querySelector("#set-close button.active").dataset.val');
  report.setHotkeyStateBefore = await evalJS('document.getElementById("set-hotkey-state").textContent');

  // 关闭行为切到「退出应用」再切回
  await evalJS('(() => { document.querySelector("#set-close button[data-val=quit]").click(); return true; })()');
  await sleep(500);
  report.setCloseAfterQuitClick = await evalJS('document.querySelector("#set-close button.active").dataset.val');

  // 全局快捷键打开
  await evalJS('(() => { document.getElementById("set-hotkey").click(); return true; })()');
  await sleep(1000);
  report.setHotkeyOn = await evalJS('document.getElementById("set-hotkey").getAttribute("aria-checked")');
  report.setHotkeyStateAfter = await evalJS('document.getElementById("set-hotkey-state").textContent');

  // 窗口置顶打开
  await evalJS('(() => { document.getElementById("set-ontop").click(); return true; })()');
  await sleep(700);
  report.setOnTopOn = await evalJS('document.getElementById("set-ontop").getAttribute("aria-checked")');

  // 托盘开关：关 → 开（验证切换不报错）
  await evalJS('(() => { document.getElementById("set-tray").click(); return true; })()');
  await sleep(700);
  report.setTrayOff = await evalJS('document.getElementById("set-tray").getAttribute("aria-checked")');
  await evalJS('(() => { document.getElementById("set-tray").click(); return true; })()');
  await sleep(700);
  report.setTrayOn = await evalJS('document.getElementById("set-tray").getAttribute("aria-checked")');

  // 开机自启打开（保持开启，注册表由外部脚本核验后关闭）
  await evalJS('(() => { document.getElementById("set-autostart").click(); return true; })()');
  await sleep(1600);
  report.setAutostartOn = await evalJS('document.getElementById("set-autostart").getAttribute("aria-checked")');
  report.setAutostartToast = await evalJS('document.getElementById("toast-msg").textContent');

  // 关闭行为最终保持「最小化到托盘」（后续 close 流程测试用）
  await evalJS('(() => { document.querySelector("#set-close button[data-val=tray]").click(); return true; })()');
  await sleep(500);
  report.setCloseFinal = await evalJS('document.querySelector("#set-close button.active").dataset.val');
  report.navItemsFinal = await evalJS('document.querySelectorAll(".nav-item").length');

  // ══ 第五轮：标签 / 重复 / 拖拽 / 专注统计 ══
  await evalJS('(() => { document.querySelector(".nav-item[data-view=todos]").click(); return true; })()');
  await sleep(700);
  await evalJS(
    '(() => { const b = document.getElementById("sort-btn"); let g = 0; while (b.dataset.sort !== "manual" && g < 5) { b.click(); g += 1; } return b.dataset.sort; })()'
  );
  await sleep(500);

  // 标签：添加带 # 的任务 → 显示标签块 → 点击筛选 → 工具栏可清除
  await evalJS(
    '(() => { const i = document.getElementById("todo-input"); i.value = "#E2E标签 整理文档"; document.getElementById("add-btn").click(); return true; })()'
  );
  await sleep(600);
  report.tagChipText = await evalJS('document.querySelector(".todo-item .tag-chip").textContent');
  await evalJS('(() => { document.querySelector(".todo-item .tag-chip").click(); return true; })()');
  await sleep(500);
  report.tagFilterCount = await evalJS('document.querySelectorAll(".todo-item").length');
  report.tagFilterChipShown = await evalJS('!document.getElementById("tag-filter").hidden');
  report.tagFilterChipText = await evalJS('document.getElementById("tag-filter").textContent');
  await evalJS('(() => { document.getElementById("tag-filter").click(); return true; })()');
  await sleep(500);
  report.tagFilterClearedCount = await evalJS('document.querySelectorAll(".todo-item").length');
  report.tagFilterChipHidden = await evalJS('document.getElementById("tag-filter").hidden');

  // 自绘月历：翻月 → 选 25 号 → 截止日期生效
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(500);
  report.calDayCells = await evalJS('document.querySelectorAll("#due-pop .due-cal-day").length');
  report.calLabelInitial = await evalJS('document.querySelector("#due-pop .due-cal-label").textContent');
  await evalJS('(() => { document.querySelector("#due-pop .due-cal-next").click(); return true; })()');
  await sleep(300);
  report.calLabelNext = await evalJS('document.querySelector("#due-pop .due-cal-label").textContent');
  await evalJS('(() => { document.querySelector("#due-pop .due-cal-prev").click(); return true; })()');
  await sleep(300);
  report.calLabelBack = await evalJS('document.querySelector("#due-pop .due-cal-label").textContent');
  await evalJS(
    '(() => { const cells = [...document.querySelectorAll("#due-pop .due-cal-day")].filter((c) => !c.classList.contains("outside")); const t = cells.find((c) => c.textContent === "25"); if (t) t.click(); return true; })()'
  );
  await sleep(700);
  report.calPopupClosed = await evalJS('document.getElementById("due-pop").hidden');
  report.calChip = await evalJS('document.querySelector(".todo-item .due-chip").textContent');

  // 重复：给第一项设置「明天 + 每天」，完成后应自动生成下一项
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.querySelector("#due-pop .due-opt[data-days=\'1\']").click(); return true; })()');
  await sleep(500);
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.querySelector("#due-pop .repeat-opt[data-repeat=daily]").click(); return true; })()');
  await sleep(600);
  report.repeatChip = await evalJS('document.querySelector(".todo-item .repeat-chip").textContent');
  report.itemsBeforeRepeatDone = await evalJS('document.querySelectorAll(".todo-item").length');
  const repeatText = await evalJS('document.querySelector(".todo-item .todo-text").textContent');
  await evalJS('(() => { document.querySelector(".todo-item .check input").click(); return true; })()');
  await sleep(700);
  report.itemsAfterRepeatDone = await evalJS('document.querySelectorAll(".todo-item").length');
  report.repeatToast = await evalJS('document.getElementById("toast-msg").textContent');
  report.repeatSpawnText = await evalJS('document.querySelector(".todo-item .todo-text").textContent');
  report.repeatSpawnDone = await evalJS('document.querySelector(".todo-item").classList.contains("done")');
  report.repeatSpawnSameText = report.repeatSpawnText === repeatText;

  // 拖拽：把第一项拖到第二项之后
  const dragGeom = await evalJS(
    '(() => { const items = document.querySelectorAll(".todo-item"); const grip = items[0].querySelector(".drag-grip"); if (!grip) return null; const g = grip.getBoundingClientRect(); const second = items[1].getBoundingClientRect(); return JSON.stringify({ x: g.left + g.width / 2, y0: g.top + g.height / 2, y1: second.bottom + 6 }); })()'
  );
  if (dragGeom) {
    const geom = JSON.parse(dragGeom);
    const beforeOrder = await evalJS(
      'JSON.stringify([...document.querySelectorAll(".todo-item")].slice(0, 3).map((el) => el.dataset.id))'
    );
    report.dragOrderBefore = JSON.parse(beforeOrder).map((id) => String(id).slice(0, 6));
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: geom.x, y: geom.y0, button: "left", buttons: 1, clickCount: 1 });
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: geom.x,
        y: geom.y0 + ((geom.y1 - geom.y0) * i) / steps,
        button: "left",
        buttons: 1,
      });
      await sleep(60);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: geom.x, y: geom.y1, button: "left", buttons: 0, clickCount: 1 });
    await sleep(800);
    const afterOrder = await evalJS(
      'JSON.stringify([...document.querySelectorAll(".todo-item")].slice(0, 3).map((el) => el.dataset.id))'
    );
    report.dragOrderAfter = JSON.parse(afterOrder).map((id) => String(id).slice(0, 6));
    report.dragMoved =
      afterOrder.length > 0 &&
      JSON.parse(afterOrder)[0] === JSON.parse(beforeOrder)[1] &&
      JSON.parse(afterOrder)[1] === JSON.parse(beforeOrder)[0];
  } else {
    report.dragMoved = "无拖拽把手";
  }

  // 专注统计：通过内部接口记录两次专注 → 统计页应显示
  report.focusInvoke = await evalJS(
    '(async () => { try { const inv = window.__TAURI_INTERNALS__.invoke; const d = new Date();' +
      ' const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");' +
      ' const a = await inv("add_focus_session", { day: key }); const b = await inv("add_focus_session", { day: key }); return a + "|" + b;' +
      ' } catch (e) { return "ERR:" + (e && e.message ? e.message : String(e)); } })()'
  );
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stats]").click(); return true; })()');
  await sleep(700);
  report.focusTodayCard = await evalJS('document.getElementById("st-focus-today").textContent');
  report.focusTotalCard = await evalJS('document.getElementById("st-focus-total").textContent');
  report.statCards = await evalJS('document.querySelectorAll(".stat-card").length');

  // ══ 云端同步（本地联调服务器 http://127.0.0.1:8787）══
  const cloudBase = "http://127.0.0.1:8787";
  const email = `e2e-${Date.now()}@test.local`;
  const pw = "e2e-secret-66";
  const acctPath = path.join(process.env.APPDATA, "com.simple.todo", "account.json");
  const readAcct = () => {
    try {
      return JSON.parse(fs.readFileSync(acctPath, "utf8"));
    } catch {
      return null;
    }
  };

  await evalJS('(() => { document.querySelector(".nav-item[data-view=todos]").click(); return true; })()');
  await sleep(300);
  await evalJS('(() => { document.getElementById("cloud-btn").click(); return true; })()');
  await sleep(400);
  report.authOpened = await evalJS('!document.getElementById("auth-overlay").hidden');
  report.loginConfirmHidden = await evalJS(
    'document.getElementById("auth-confirm-field").hidden && getComputedStyle(document.getElementById("auth-confirm-field")).display === "none"'
  );
  await evalJS('(() => { document.querySelector("#auth-tabs button[data-tab=register]").click(); return true; })()');
  await sleep(200);
  report.regConfirmShown = await evalJS(
    '!document.getElementById("auth-confirm-field").hidden && getComputedStyle(document.getElementById("auth-confirm-field")).display !== "none"'
  );
  report.authRegTitle = await evalJS('document.getElementById("auth-title").textContent');

  // ── 内置官方地址：不显示、不写入输入框；自定义/返回切换 ──
  report.serverFieldHiddenInitially = await evalJS(
    'document.getElementById("auth-server").closest(".auth-field").hidden === true'
  );
  report.serverValueNotExposed = await evalJS('document.getElementById("auth-server").value === ""');
  report.advBackHiddenInitially = await evalJS('document.getElementById("auth-adv-back").hidden === true');
  await evalJS('(() => { document.getElementById("auth-adv").click(); return true; })()');
  await sleep(200);
  report.customFieldShown = await evalJS(
    'document.getElementById("auth-server").closest(".auth-field").hidden === false'
  );
  report.customFieldEmpty = await evalJS('document.getElementById("auth-server").value === ""');
  report.advBackShownNow = await evalJS('document.getElementById("auth-adv-back").hidden === false');
  await evalJS('(() => { document.getElementById("auth-adv-back").click(); return true; })()');
  await sleep(200);
  report.backToOfficial = await evalJS(
    'document.getElementById("auth-server").closest(".auth-field").hidden === true && document.getElementById("auth-adv").hidden === false'
  );

  // 切到自定义服务器，指向本地联调服务器后提交注册（第一步：发验证码）
  await evalJS('(() => { document.getElementById("auth-adv").click(); return true; })()');
  await sleep(150);
  await evalJS(
    '(() => { document.getElementById("auth-server").value = "' + cloudBase + '";' +
      ' document.getElementById("auth-email").value = "' + email + '";' +
      ' document.getElementById("auth-password").value = "' + pw + '";' +
      ' document.getElementById("auth-confirm").value = "' + pw + '";' +
      ' document.getElementById("auth-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));' +
      ' return true; })()'
  );
  await sleep(600);
  let codeStepUp = false;
  for (let i = 0; i < 25; i++) {
    codeStepUp = await evalJS(
      '!document.getElementById("auth-code-step").hidden && document.getElementById("auth-code-info").textContent.indexOf("验证码已发送") >= 0'
    );
    if (codeStepUp) break;
    await sleep(200);
  }
  report.codeStepShown = codeStepUp;
  report.resendCountdown = await evalJS('document.getElementById("auth-resend").textContent.indexOf("重新发送（") === 0');

  // 从本地 SMTP 信封文件读取验证码（服务器真实发信路径）
  const sinkFile = path.join(process.env.LOCALAPPDATA, "Temp", "smtp_sink_mail.txt");
  let regCode = "";
  for (let i = 0; i < 40; i++) {
    try {
      const txt = fs.readFileSync(sinkFile, "utf8");
      const m = txt.match(/验证码是：(\d{6})/) || txt.match(/(\d{6})/);
      if (m) {
        regCode = m[1];
        break;
      }
    } catch (err) {
      /* 尚未生成 */
    }
    await sleep(250);
  }
  report.codeReceived = regCode ? "已收到" : "未收到";
  await evalJS(
    '(() => { document.getElementById("auth-code").value = "' + regCode + '"; document.getElementById("auth-verify-btn").click(); return true; })()'
  );
  await sleep(3000);
  report.authClosed = await evalJS('document.getElementById("auth-overlay").hidden');
  report.cloudPhase1 = await evalJS('document.getElementById("cloud-btn").dataset.phase');
  const acct = readAcct();
  report.accountFile = acct ? `${acct.email} @ ${acct.server}` : "缺失";

  // 推送验证：应用内新增 → 立即同步 → 服务器应有
  await evalJS(
    '(() => { const i = document.getElementById("todo-input"); i.value = "云端同步验证";' +
      ' i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await evalJS('(() => { document.getElementById("add-btn").click(); return true; })()');
  await sleep(600);
  await evalJS('(() => { document.getElementById("cloud-btn").click(); return true; })()');
  await sleep(2200);
  report.cloudToast = await evalJS('document.getElementById("toast-msg").textContent');
  report.cloudPhase2 = await evalJS('document.getElementById("cloud-btn").dataset.phase');

  let serverData = { changes: { todos: [], notes: [], tombstones: [] } };
  const serverGet = async () => {
    const r = await fetch(`${cloudBase}/api/sync?since=0`, { headers: { Authorization: `Bearer ${acct.token}` } });
    return r.json();
  };
  try {
    serverData = await serverGet();
  } catch (err) {
    /* 忽略 */
  }
  report.serverHasPushedTodo = serverData.changes.todos.some((t) => t.text === "云端同步验证");

  // 拉取验证：服务器直接写入一条（模拟另一台设备）→ 应用内同步 → 应出现在列表
  try {
    const now = Date.now();
    await fetch(`${cloudBase}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${acct.token}` },
      body: JSON.stringify({
        changes: {
          todos: [{ id: "remote-e2e-1", text: "来自云端", done: false, priority: 0, tags: [], createdAt: now, updatedAt: now }],
          notes: [],
          tombstones: [],
        },
      }),
    });
  } catch (err) {
    /* 忽略 */
  }
  await evalJS('(() => { document.getElementById("cloud-btn").click(); return true; })()');
  await sleep(2400);
  report.pulledTodo = await evalJS('[...document.querySelectorAll(".todo-text")].some((el) => el.textContent === "来自云端")');

  // 墓碑验证：应用内删除 → 同步 → 服务器应返回 tombstone 且不再返回该记录
  report.deletedInApp = await evalJS(
    '(() => { const row = [...document.querySelectorAll(".todo-item")].find((li) => li.querySelector(".todo-text") && li.querySelector(".todo-text").textContent === "来自云端");' +
      ' if (!row) return false; const del = row.querySelector(".icon-btn[data-act=delete]"); if (!del) return false; del.click(); return true; })()'
  );
  await sleep(500);
  await evalJS('(() => { document.getElementById("cloud-btn").click(); return true; })()');
  await sleep(2400);
  try {
    serverData = await serverGet();
  } catch (err) {
    /* 忽略 */
  }
  report.tombstoneOnServer = serverData.changes.tombstones.some((t) => t.id === "remote-e2e-1");
  report.deletedGoneOnServer = !serverData.changes.todos.some((t) => t.id === "remote-e2e-1");

  // 退出登录
  await evalJS('(() => { document.querySelector(".nav-item[data-view=settings]").click(); return true; })()');
  await sleep(400);
  report.logoutClicked = await evalJS(
    '(() => { const b = [...document.querySelectorAll("#cloud-settings button")].find((x) => x.textContent === "退出登录"); if (!b) return false; b.click(); return true; })()'
  );
  await sleep(1500);
  report.logoutPhase = await evalJS('document.getElementById("cloud-btn").dataset.phase');
  report.accountFileAfterLogout = fs.existsSync(acctPath) ? "仍存在" : "已清除";

  // 必须登录：登录门（不可关闭）
  await sleep(500);
  report.gateShown = await evalJS('!document.getElementById("auth-overlay").hidden');
  report.gateCloseHidden = await evalJS('document.getElementById("auth-close").hidden');
  report.gateTitle = await evalJS('document.getElementById("auth-title").textContent');

  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
})().catch((err) => {
  console.error("E2E_FAIL:", err.message);
  process.exit(1);
});
