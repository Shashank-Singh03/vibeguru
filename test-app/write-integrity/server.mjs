// Purpose-built local reliability fixture. This is not a production payments API.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const fixtureId = "vibeguru-write-integrity";
export const modes = ["vulnerable", "idempotent"];
const sku = "reliability-seat";
const unitPriceCents = 2500;
const tokenPattern = /^[a-zA-Z0-9-]{1,100}$/;

class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    throw new InputError("Expected application/json", 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new InputError("Request body exceeds the fixture limit", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    return value;
  } catch { throw new InputError("Expected a JSON object"); }
}

function requireToken(value, label) {
  if (typeof value !== "string" || !tokenPattern.test(value)) throw new InputError(`Invalid ${label}`);
  return value;
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ fixture: fixtureId, ...payload }));
}

// Commit and idempotency lookup happen together before the first await. Concurrent
// requests cannot both pass a check and then create separate orders in this process.
export function createWriteIntegrityServer({ responseDelayMs = 80 } = {}) {
  if (!Number.isInteger(responseDelayMs) || responseDelayMs < 0 || responseDelayMs > 1000) {
    throw new Error("responseDelayMs must be an integer from 0 through 1000");
  }
  const namespaces = new Map();
  let sequence = 0;
  const stateKey = (mode, namespace) => `${mode}:${namespace}`;
  const getState = (mode, namespace) => {
    const key = stateKey(mode, namespace);
    if (!namespaces.has(key)) namespaces.set(key, { orders: [], attempts: [], keys: new Map(), inflight: 0 });
    return namespaces.get(key);
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        return send(response, 200, { modes, sku, unit_price_cents: unitPriceCents, persistence: "isolated in-memory process" });
      }
      const api = url.pathname.match(/^\/api\/(vulnerable|idempotent)\/(orders|state)$/);
      if (api) {
        const [, mode, resource] = api;
        if (resource === "state") {
          const namespace = requireToken(url.searchParams.get("namespace"), "namespace");
          const state = namespaces.get(stateKey(mode, namespace));
          if (request.method === "GET") return send(response, 200, {
            mode, namespace, orders: state?.orders || [], attempts: state?.attempts || [], inflight: state?.inflight || 0,
          });
          if (request.method === "DELETE") {
            if (state?.inflight) return send(response, 409, { error: "Writes are still in flight", mode, namespace });
            namespaces.delete(stateKey(mode, namespace));
            return send(response, 200, { mode, namespace, cleared: true,
              removed_orders: state?.orders.length || 0, removed_attempts: state?.attempts.length || 0 });
          }
          return send(response, 405, { error: "Method not allowed" });
        }
        if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" });
        const body = await readJson(request);
        const namespace = requireToken(body.namespace, "namespace");
        const intentId = requireToken(body.intent_id, "intent ID");
        const attemptId = requireToken(body.attempt_id, "attempt ID");
        if (body.sku !== sku || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 5) {
          throw new InputError("Invalid fixture product or quantity");
        }
        const key = request.headers["idempotency-key"];
        if (mode === "idempotent") {
          requireToken(key, "idempotency key");
          if (key !== intentId) throw new InputError("The idempotency key must identify the logical order intent");
        }
        const state = getState(mode, namespace);
        if (state.attempts.some(attempt => attempt.attempt_id === attemptId)) throw new InputError("Attempt IDs must identify physical requests uniquely", 409);
        const fingerprint = JSON.stringify([intentId, body.sku, body.quantity]);
        const cached = mode === "idempotent" ? state.keys.get(key) : null;
        const attempt = { attempt_id: attemptId, intent_id: intentId, idempotency_key: typeof key === "string" ? key : null,
          sku: body.sku, quantity: body.quantity, replayed: false, status: 201, order_id: null };
        state.attempts.push(attempt);
        let order;
        if (cached) {
          if (cached.fingerprint !== fingerprint) {
            attempt.status = 409;
            return send(response, 409, { error: "Idempotency key already used with a different payload", mode, namespace, attempt_id: attemptId });
          }
          order = cached.order;
          attempt.replayed = true;
          attempt.status = 200;
        } else {
          order = { id: `order-${++sequence}`, intent_id: intentId, idempotency_key: typeof key === "string" ? key : null,
            sku: body.sku, quantity: body.quantity, unit_price_cents: unitPriceCents,
            total_cents: unitPriceCents * body.quantity, created_at: new Date().toISOString() };
          state.orders.push(order);
          if (mode === "idempotent") state.keys.set(key, { fingerprint, order });
        }
        attempt.order_id = order.id;
        state.inflight++;
        try {
          if (responseDelayMs) await new Promise(done => setTimeout(done, responseDelayMs));
          send(response, attempt.status, { mode, namespace, attempt_id: attemptId, replayed: attempt.replayed, order });
        } finally { state.inflight--; }
        return;
      }
      if (request.method === "GET" && ["/", "/index.html", "/app.js", "/styles.css"].includes(url.pathname)) {
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const content = await readFile(new URL(name, import.meta.url));
        const types = { "index.html": "text/html", "app.js": "text/javascript", "styles.css": "text/css" };
        response.writeHead(200, { "Content-Type": `${types[name]}; charset=utf-8`, "Cache-Control": "no-store" });
        response.end(content);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      if (!response.headersSent) send(response, error instanceof InputError ? error.status : 500,
        { error: error instanceof InputError ? error.message : "Fixture server error" });
      else response.destroy(error);
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 65325);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be an integer from 1024 through 65535");
  const server = createWriteIntegrityServer();
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ fixture: fixtureId, url: `http://127.0.0.1:${port}`, modes, port, vibeguru_lab_ready: process.env.VIBEGURU_LAB_INSTANCE || null })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
}
