/* 通用 CDP 求值工具：CDP_PORT=端口 EXPR=表达式 node cdp_eval.js
 * 用法示例：CDP_PORT=9222 EXPR='document.querySelectorAll(".todo-item").length' node cdp_eval.js
 * 依赖：Node >= 22（内置 fetch 与 WebSocket）。 */
const PORT = process.env.CDP_PORT || 9222;
const EXPR = process.env.EXPR || "document.title";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPage(timeoutMs = 45000) {
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

  for (let i = 0; i < 120; i++) {
    const r = await send("Runtime.evaluate", {
      expression: 'document.readyState + "|" + (document.getElementById("stat-done") ? "app" : "blank")',
      returnByValue: true,
    });
    if (r.result && r.result.result && r.result.result.value === "complete|app") break;
    await sleep(300);
  }

  const res = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
  const r = res.result || {};
  if (r.exceptionDetails) {
    console.error("页面内异常:", JSON.stringify(r.exceptionDetails.exception));
    process.exit(1);
  }
  const value = r.result ? r.result.value : undefined;
  console.log(typeof value === "object" ? JSON.stringify(value) : String(value));
  ws.close();
  process.exit(0);
})().catch((err) => {
  console.error("EVAL_FAIL:", err.message);
  process.exit(1);
});
