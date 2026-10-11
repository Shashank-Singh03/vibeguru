import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createStorageWorkbenchServer() {
  const assets = new Map([["/", "index.html"], ["/editor.html", "editor.html"], ["/app.js", "app.js"]]);
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    const file = assets.get(url.pathname);
    if (request.method !== "GET" || !file) { response.writeHead(404); response.end("Not found"); return; }
    try {
      const body = await readFile(new URL(file, import.meta.url));
      response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(body);
    } catch { response.writeHead(500); response.end("Fixture asset unavailable"); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 65326);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PORT");
  const server = createStorageWorkbenchServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ fixture: "storage-workbench", port, vibeguru_lab_ready: process.env.VIBEGURU_LAB_INSTANCE || null })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
