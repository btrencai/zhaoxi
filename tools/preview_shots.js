/* 界面预览截图：驱动运行中的应用生成 PNG（需以 --remote-debugging-port 启动）。
 * 环境变量：CDP_PORT=端口 OUT_DIR=输出目录 */
import fs from "node:fs";
import path from "node:path";
const PORT = process.env.CDP_PORT || "9222";
const OUT = process.env.OUT_DIR || ".";

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
      /* 未就绪 */
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
    if (r.exceptionDetails) throw new Error("页面内异常: " + JSON.stringify(r.exceptionDetails.exception));
    return r.result ? r.result.value : undefined;
  };

  const shot = async (name) => {
    await sleep(320); // 等待视图入场动画结束
    const res = await send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(OUT, { recursive: true });
    const buf = Buffer.from(res.result.data, "base64");
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log("saved", name, buf.length, "bytes");
  };

  for (let i = 0; i < 200; i++) {
    const state = await evalJS(
      'document.readyState + "|" + (document.getElementById("stat-done") ? "app" : "blank")'
    );
    if (state === "complete|app") break;
    await sleep(300);
  }
  await sleep(600);

  // 准备演示数据
  await evalJS(
    '(() => { const add = (t) => { const i = document.getElementById("todo-input"); i.value = t; document.getElementById("add-btn").click(); }; ' +
      'add("#开发 和团队同步这周的开发进度"); add("给新版本设计一张发布海报"); add("整理 Tauri 迁移的技术说明 #文档"); return true; })()'
  );
  await sleep(900);
  // 演示：优先级 + 截止日期 + 完成状态
  await evalJS(
    '(() => { const items = document.querySelectorAll(".todo-item .check input"); if (items[2]) items[2].click(); return true; })()'
  );
  await sleep(700);
  await evalJS(
    '(() => { const prios = document.querySelectorAll(".todo-item .priority-btn"); if (prios[0]) prios[0].click(); return true; })()' // 高
  );
  await sleep(500);
  await evalJS(
    '(() => { const prios = document.querySelectorAll(".todo-item .priority-btn"); if (prios[1]) { prios[1].click(); prios[1].click(); } return true; })()' // 中
  );
  await sleep(500);
  await evalJS(
    '(() => { const due = document.querySelector(".todo-item .icon-btn[data-act=due]"); if (due) due.click(); return true; })()'
  );
  await sleep(400);
  await evalJS(
    '(() => { const opt = document.querySelector("#due-pop .due-opt[data-days=\'1\']"); if (opt) opt.click(); return true; })()' // 明天
  );
  await sleep(700);

  // 给第一项加上「每天」重复
  await evalJS(
    '(() => { const due = document.querySelector(".todo-item .icon-btn[data-act=due]"); if (due) due.click(); return true; })()'
  );
  await sleep(400);
  await evalJS(
    '(() => { const opt = document.querySelector("#due-pop .repeat-opt[data-repeat=daily]"); if (opt) opt.click(); return true; })()'
  );
  await sleep(600);

  // 1) 深色 · 待办
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=dark]").click(); return true; })()');
  await sleep(500);
  await shot("01-dark-todos.png");

  // 2) 浅色 · 待办
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=light]").click(); return true; })()');
  await sleep(500);
  await shot("02-light-todos.png");

  // 12) 浅色 · 日期选择弹层（自绘月历 + 重复）
  await evalJS('(() => { document.querySelector(".todo-item .icon-btn[data-act=due]").click(); return true; })()');
  await sleep(800);
  await shot("12-light-duepop.png");
  await evalJS('(() => { document.getElementById("due-pop").hidden = true; return true; })()');
  await sleep(300);

  // 3) 浅色 · 技术栈
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stack]").click(); return true; })()');
  await sleep(600);
  await shot("03-light-stack.png");

  // 4) 深色 · 技术栈
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=dark]").click(); return true; })()');
  await sleep(500);
  await shot("04-dark-stack.png");

  // 5) 深色 · 技术栈（滚动到底部，展示运行架构）
  await evalJS('(() => { const view = document.getElementById("view-stack"); view.scrollTop = view.scrollHeight; return true; })()');
  await sleep(500);
  await shot("05-dark-stack-bottom.png");

  // 6) 深色 · 专注（启动计时中截图）
  await evalJS('(() => { document.querySelector(".nav-item[data-view=focus]").click(); return true; })()');
  await sleep(400);
  await evalJS('(() => { document.getElementById("focus-start").click(); return true; })()');
  await sleep(1600);
  await shot("06-dark-focus.png");
  await evalJS('(() => { document.getElementById("focus-start").click(); return true; })()');
  await sleep(300);
  await evalJS('(() => { document.getElementById("focus-reset").click(); return true; })()');
  await sleep(300);

  // 7) 深色 · 便签（预置两张演示便签）
  await evalJS('(() => { document.querySelector(".nav-item[data-view=notes]").click(); return true; })()');
  await sleep(400);
  await evalJS(
    '(() => { const t = document.getElementById("note-input"); document.getElementById("note-add").click(); ' +
      't.value = "发布前检查清单：\\n- 图标与文案替换完成\\n- 数据目录权限确认\\n- 打包体积与启动时间基线"; ' +
      't.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await sleep(1200);
  await evalJS(
    '(() => { const t = document.getElementById("note-input"); document.getElementById("note-add").click(); ' +
      't.value = "读书笔记：Rust 所有权\\n\\n- 借用检查器在编译期拦截问题\\n- 生命周期标注只在必要时出现\\n- 零成本抽象是核心理念"; ' +
      't.dispatchEvent(new Event("input", { bubbles: true })); return true; })()'
  );
  await sleep(1200);
  await shot("07-dark-notes.png");

  // 8) 深色 · 统计（多完成一条让今日计数更真实）
  await evalJS('(() => { document.querySelector(".nav-item[data-view=todos]").click(); return true; })()');
  await sleep(400);
  await evalJS(
    '(() => { const items = document.querySelectorAll(".todo-item .check input"); if (items[0]) items[0].click(); return true; })()'
  );
  await sleep(700);
  await evalJS('(() => { document.querySelector(".nav-item[data-view=stats]").click(); return true; })()');
  await sleep(600);
  await shot("08-dark-stats.png");

  // 9) 深色 · 剪贴板（系统剪贴板由编排脚本预置）
  await evalJS('(() => { document.querySelector(".nav-item[data-view=clipboard]").click(); return true; })()');
  await sleep(2200);
  await shot("09-dark-clipboard.png");

  // 10) 深色 · 设置
  await evalJS('(() => { document.querySelector(".nav-item[data-view=settings]").click(); return true; })()');
  await sleep(500);
  await shot("10-dark-settings.png");

  // 11) 浅色 · 设置
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=light]").click(); return true; })()');
  await sleep(500);
  await shot("11-light-settings.png");

  // 13) 登录门（登出后出现，必须登录）—— 从设置页点「退出登录」
  await evalJS(
    '(() => { localStorage.setItem("simple-todo.cloud.server", "http://127.0.0.1:8787"); return true; })()'
  );
  await evalJS(
    '(() => { const b = [...document.querySelectorAll("#cloud-settings button")].find((x) => x.textContent === "退出登录"); if (b) { b.click(); return true; } return false; })()'
  );
  await sleep(1000);
  await shot("13-auth-login.png");

  // 14) 注册页
  await evalJS('(() => { document.querySelector("#auth-tabs button[data-tab=register]").click(); return true; })()');
  await sleep(450);
  await shot("14-auth-register.png");

  // 15) 注册 · 邮箱验证码步骤（本地联调服务器回显验证码）
  await evalJS(
    '(() => {' +
      ' document.getElementById("auth-email").value = "shot-' + Date.now() + '@test.local";' +
      ' document.getElementById("auth-password").value = "preview-secret";' +
      ' document.getElementById("auth-confirm").value = "preview-secret";' +
      ' document.getElementById("auth-adv").click();' +
      ' document.getElementById("auth-server").value = "http://127.0.0.1:8787";' +
      ' document.getElementById("auth-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));' +
      ' return true; })()'
  );
  await sleep(2000);
  await shot("15-auth-code.png");

  // 回到「自动」模式（跟随系统，保持默认状态持久化）
  await evalJS('(() => { document.querySelector(".theme-btn[data-theme-val=auto]").click(); return true; })()');
  await sleep(400);

  await evalJS('(() => { document.querySelector(".nav-item[data-view=todos]").click(); return true; })()');
  ws.close();
  process.exit(0);
})().catch((err) => {
  console.error("SHOT_FAIL:", err.message);
  process.exit(1);
});
