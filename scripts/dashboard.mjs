#!/usr/bin/env node
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCollector, artifactPath } from "./lib/dashboard-data.mjs";
import { repositoryRoot } from "./lib/test-history.mjs";

export async function createDashboardServer({ root = repositoryRoot, port = 4545, pollMs = 3000 } = {}) {
  const collector = createCollector(root), clients = new Set();
  let current = null, pending = null;
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const next = await collector.snapshot();
      const changed = current?.revision !== next.revision;
      current = next;
      if (changed) for (const client of clients) client.write(`event: refresh\ndata: ${JSON.stringify({ revision: current.revision })}\n\n`);
      return current;
    })();
    try { return await pending; } finally { pending = null; }
  }
  await refresh();
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const host = request.headers.host || "";
    const expected = `127.0.0.1:${server.address()?.port}`;
    const allowed = new Set([expected, `localhost:${server.address()?.port}`]);
    let validOrigin = !request.headers.origin;
    try { if (request.headers.origin) validOrigin = new URL(request.headers.origin).protocol === "http:" && allowed.has(new URL(request.headers.origin).host); } catch {}
    if (!allowed.has(host) || !validOrigin) {
      response.writeHead(403); response.end("Local dashboard origin required"); return;
    }
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
    const send = (status, body, type = "application/json; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    try {
      const url = new URL(request.url, `http://${expected}`);
      if (url.pathname === "/api/dashboard") { send(200, JSON.stringify(await refresh())); return; }
      if (url.pathname === "/api/case") {
        const result = await collector.caseDetail(url.searchParams.get("id"));
        send(result ? 200 : 404, JSON.stringify(result || { error: "Case no longer available; refresh the dashboard" })); return;
      }
      if (url.pathname === "/api/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
        response.write(`event: refresh\ndata: ${JSON.stringify({ revision: current.revision })}\n\n`);
        clients.add(response); request.on("close", () => clients.delete(response)); return;
      }
      if (url.pathname === "/artifact") {
        let path;
        try { path = await artifactPath(root, url.searchParams.get("path")); } catch { send(404, JSON.stringify({ error: "Artifact unavailable or outside report directories" })); return; }
        response.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-downloads");
        send(200, await readFile(path), types[extname(path)] || "text/plain; charset=utf-8"); return;
      }
      const assets = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/styles.css": "styles.css" };
      const asset = assets[url.pathname];
      if (!asset) { send(404, JSON.stringify({ error: "Not found" })); return; }
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
      send(200, await readFile(join(root, "dashboard", asset)), types[extname(asset)]);
    } catch (error) {
      send(500, JSON.stringify({ error: "Dashboard refresh failed", message: String(error.message).slice(0, 200) }));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const timer = setInterval(() => refresh().catch(error => console.error("Dashboard refresh:", error.message)), pollMs);
  const heartbeat = setInterval(() => { for (const client of clients) client.write(": heartbeat\n\n"); }, 20000);
  return { server, url: `http://127.0.0.1:${server.address().port}`, refresh,
    close: async () => { clearInterval(timer); clearInterval(heartbeat); for (const client of clients) client.end();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const flag = process.argv.indexOf("--port");
  const port = flag >= 0 ? Number(process.argv[flag + 1]) : 4545;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Dashboard port must be from 1024 through 65535");
  const app = await createDashboardServer({ port });
  console.log(`Vibe Guru dashboard: ${app.url}`);
  console.log("Local results and source changes refresh automatically. Ctrl+C stops the dashboard.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await app.close(); process.exit(0); });
}
