import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
export async function createWorkbench() {
  const assets = new Map(await Promise.all(["index.html", "app.js"].map(async file =>
    [file, await readFile(join(directory, file))])));
  let plan = { token: "initial", scenario: "normal" }, events = [], held = null, attempt = 0;
  const json = (res, value, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST" && url.pathname === "/__lab/plan") {
        let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error("Plan too large"); }
        const next = JSON.parse(body);
        if (held) return json(res, { error: "A held request must be drained first" }, 409);
        if (typeof next.token !== "string" || !["normal", "hold", "503-once", "disconnect-once", "malformed-once"].includes(next.scenario)) {
          return json(res, { error: "Invalid plan" }, 400);
        }
        plan = next; events = []; attempt = 0; return json(res, { ready: true });
      }
      if (url.pathname === "/__lab/state") return json(res, { plan, attempt, held: !!held, events });
      if (req.method === "POST" && url.pathname === "/__lab/release") {
        if (!held) return json(res, { error: "No held request" }, 409);
        const pending = held; held = null;
        events.push({ kind: "delivered", token: plan.token, status: 200 });
        json(pending, { value: plan.token }); return json(res, { released: true });
      }
      if (url.pathname === "/api/detail" || url.pathname === "/api/recover") {
        attempt++;
        events.push({ kind: "received", path: url.pathname, token: plan.token, attempt });
        if (plan.scenario === "hold") { held = res; return; }
        if (attempt === 1 && plan.scenario === "disconnect-once") {
          events.push({ kind: "delivered", status: "disconnect", token: plan.token });
          // A real transport failure rather than a mocked fetch rejection.
          // Deliver headers and an incomplete body before disconnecting. A bare
          // pre-header GET disconnect can be transparently retried by Chromium.
          res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
          res.flushHeaders(); res.write('{"value":');
          setTimeout(() => res.destroy(), 20); return;
        }
        if (attempt === 1 && plan.scenario === "503-once") {
          events.push({ kind: "delivered", status: 503, token: plan.token });
          return json(res, { error: "Controlled temporary outage" }, 503);
        }
        if (attempt === 1 && plan.scenario === "malformed-once") {
          events.push({ kind: "delivered", status: "malformed-json", token: plan.token });
          res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"value":'); return;
        }
        events.push({ kind: "delivered", status: 200, token: plan.token });
        return json(res, { value: plan.token });
      }
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (assets.has(file)) {
        res.writeHead(200, { "Content-Type": file.endsWith("html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(assets.get(file));
      }
      if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      json(res, { error: "Not found" }, 404);
    } catch (error) { if (!res.headersSent) json(res, { error: error.message }, 400); else res.destroy(); }
  });
  return { server, async close() { if (held) held.destroy(); server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createWorkbench();
  const port = Number(process.env.PORT || 65324);
  app.server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ fixture: "async-workbench", port, vibeguru_lab_ready: process.env.VIBEGURU_LAB_INSTANCE || null })));
}
