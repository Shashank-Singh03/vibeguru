// Isolated, authored lost-update fixture. No database, authentication or durability.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fields, validateDocument, validateChangedFields, changedFields } from "./model.mjs";

export const fixtureId = "vibeguru-conflict-workbench";
export const modes = ["vulnerable", "versioned"];
class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const token = (value, name) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new InputError(`Invalid ${name}`);
  return value;
};
async function json(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw new InputError("Expected application/json", 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new InputError("Request body exceeds the fixture limit", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new InputError("Expected a JSON object"); }
}
function send(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ fixture: fixtureId, ...data }));
}
function checked(fn, value) {
  try { return fn(value); } catch (error) { throw new InputError(error.message); }
}

export function createConflictWorkbenchServer({ responseDelayMs = 20 } = {}) {
  if (!Number.isInteger(responseDelayMs) || responseDelayMs < 0 || responseDelayMs > 1000) throw new Error("Invalid responseDelayMs");
  const namespaces = new Map();
  const key = (mode, namespace) => `${mode}:${namespace}`;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200,
        { modes, fields, persistence: "isolated in-memory process", conflict_status: 409 });
      const api = url.pathname.match(/^\/api\/(vulnerable|versioned)\/(state|seed|document)$/);
      if (api) {
        const [, mode, resource] = api;
        if (resource === "state") {
          const namespace = token(url.searchParams.get("namespace"), "namespace");
          const state = namespaces.get(key(mode, namespace));
          if (request.method === "GET") return send(response, 200, { mode, namespace,
            document: state?.document || null, history: state?.history || [], attempts: state?.attempts || [], inflight: state?.inflight || 0 });
          if (request.method === "DELETE") {
            if (state?.inflight) return send(response, 409, { mode, namespace, error: "Writes are still in flight" });
            namespaces.delete(key(mode, namespace));
            return send(response, 200, { mode, namespace, cleared: true, removed_document: Boolean(state?.document),
              removed_history: state?.history.length || 0, removed_attempts: state?.attempts.length || 0 });
          }
          return send(response, 405, { error: "Method not allowed" });
        }
        if (request.method !== (resource === "seed" ? "POST" : "PUT")) return send(response, 405, { error: "Method not allowed" });
        const body = await json(request), namespace = token(body.namespace, "namespace");
        const document = checked(validateDocument, body.document);
        if (resource === "seed") {
          if (namespaces.has(key(mode, namespace))) return send(response, 409, { mode, namespace, error: "Namespace is already seeded" });
          const initial = { ...document, version: 1 };
          namespaces.set(key(mode, namespace), { document: initial, history: [{ version: 1, base_version: null,
            client_id: "seed", attempt_id: null, changed_fields: [], document: { ...document } }], attempts: [], inflight: 0 });
          return send(response, 201, { mode, namespace, document: initial });
        }
        const clientId = token(body.client_id, "client ID"), attemptId = token(body.attempt_id, "attempt ID");
        const dirty = checked(validateChangedFields, body.changed_fields);
        if (!Number.isInteger(body.base_version) || body.base_version < 1) throw new InputError("Invalid base_version");
        const state = namespaces.get(key(mode, namespace));
        if (!state) return send(response, 404, { mode, namespace, error: "Namespace is not seeded" });
        if (state.attempts.some(attempt => attempt.attempt_id === attemptId)) throw new InputError("Attempt IDs must be unique", 409);
        if (body.base_version > state.document.version) throw new InputError("base_version is ahead of the document");
        const previousVersion = state.document.version;
        const stale = body.base_version !== previousVersion;
        // Comparison and commit are synchronous before any response delay. A
        // concurrent request cannot also win the same version in this process.
        const status = mode === "versioned" && stale ? 409 : 200;
        if (mode === "versioned" && !stale) {
          const actual = changedFields({ title: state.document.title, note: state.document.note }, document);
          if (actual.length !== dirty.length || actual.some(field => !dirty.includes(field))) {
            throw new InputError("changed_fields must match the actual changes at the accepted base version");
          }
        }
        const attempt = { attempt_id: attemptId, client_id: clientId, base_version: body.base_version,
          previous_version: previousVersion, result_version: status === 200 ? previousVersion + 1 : previousVersion,
          changed_fields: [...dirty], document: { ...document }, status, stale };
        state.attempts.push(attempt);
        if (status === 200) {
          // The vulnerable mode intentionally replaces the complete stale snapshot.
          state.document = { ...document, version: previousVersion + 1 };
          state.history.push({ version: state.document.version, base_version: body.base_version,
            client_id: clientId, attempt_id: attemptId, changed_fields: [...dirty], document: { ...document } });
        }
        const receipt = { mode, namespace, attempt: structuredClone(attempt), document: { ...state.document },
          ...(status === 409 ? { error: "Version conflict; pending local edits were not persisted" } : {}) };
        state.inflight++;
        try {
          if (responseDelayMs) await new Promise(done => setTimeout(done, responseDelayMs));
          send(response, status, receipt);
        } finally { state.inflight--; }
        return;
      }
      if (request.method === "GET" && ["/", "/index.html", "/app.js", "/model.mjs", "/styles.css"].includes(url.pathname)) {
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const content = await readFile(new URL(name, import.meta.url));
        const type = name.endsWith("html") ? "text/html" : name.endsWith("css") ? "text/css" : "text/javascript";
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
        response.end(content); return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) send(response, error instanceof InputError ? error.status : 500,
        { error: error instanceof InputError ? error.message : "Fixture server error" });
      else response.destroy(error);
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 65327);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PORT");
  const server = createConflictWorkbenchServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ fixture: fixtureId, url: `http://127.0.0.1:${port}`, modes, port, vibeguru_lab_ready: process.env.VIBEGURU_LAB_INSTANCE || null })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
