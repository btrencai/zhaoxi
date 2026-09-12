/* 校验：热力图最后一列 7 格（周一→周日）的类名与提示，确认今天标记位置正确。
 * 环境变量：CDP_PORT=端口 */
import fs from "node:fs";

const PORT = process.env.CDP_PORT || "9222";

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
    } catch {
      /* 未就绪 */
    }
    await sleep(800);
  }
  throw new Error("等待调试端口超时");
}

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

for (let i = 0; i < 60; i++) {
  if ((await evalJS("document.readyState")) === "complete") break;
  await sleep(300);
}
await evalJS('(() => { document.querySelector(".nav-item[data-view=stats]").click(); return true; })()');
await sleep(600);
const cells = await evalJS(
  'JSON.stringify([...document.querySelectorAll("#heat-grid .heat-cell")].slice(-7).map((c) => [c.className, c.title]))'
);
console.log("最后一列(周一→周日):");
for (const [cls, title] of JSON.parse(cells)) {
  console.log(`  ${title}  ->  ${cls}`);
}
const todayInfo = await evalJS(
  '(() => { const t = document.querySelectorAll("#heat-grid .heat-cell.heat-today"); return t.length + "|" + (t[0] ? t[0].title : "无"); })()'
);
console.log("heat-today 标记数量|所在格:", todayInfo);
ws.close();
process.exit(0);
