// An app-specific reconnect experiment against the unchanged copied multiplayer app.
// The intervention is a browser transport gate, not a source edit or simulated server.
import { randomUUID } from "node:crypto";
import { isolate } from "./common.mjs";

export const checks = [
  "initial-roster-agreement", "disconnect-observed", "peer-change-acknowledged",
  "transport-reconnected", "rejoin-snapshot-current", "identity-preserved", "roster-converged",
];
const sessions = new WeakMap();
const expectationMs = 2000;
const infrastructureMs = 5000;

export class ReconnectInfrastructureError extends Error {
  constructor(message) { super(message); this.name = "ReconnectInfrastructureError"; }
}

// False means an observable expectation missed its deadline. Read/transport exceptions
// propagate; they must not be recast as an asserted application defect.
export async function boundedObservation(read, matches, timeoutMs = expectationMs) {
  const started = Date.now();
  let observed;
  let attempts = 0;
  do {
    observed = await read();
    attempts++;
    if (matches(observed)) return { matched: true, observed, attempts, elapsed_ms: Date.now() - started, timeout_ms: timeoutMs };
    if (Date.now() - started >= timeoutMs) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(40, timeoutMs)));
  } while (true);
  return { matched: false, observed, attempts, elapsed_ms: Date.now() - started, timeout_ms: timeoutMs };
}

// A recorded application assertion and a failed restoration are separate failures.
// Preserve both so an expected negative assertion cannot certify an invalid harness.
export async function restoreNegativeControl(restore, { record, primaryError = null }) {
  try {
    const restored = await restore();
    if (!restored || typeof restored.matched !== "boolean") {
      throw new ReconnectInfrastructureError("Negative-control transport cleanup returned no bounded observation");
    }
    await record("reconnect-cleanup", restored);
    if (!restored.matched) throw new ReconnectInfrastructureError("Negative-control transport cleanup could not restore observable preconditions");
    return restored;
  } catch (cleanupError) {
    let failure = cleanupError;
    try {
      await record("reconnect-cleanup-error", { error: String(cleanupError?.message || cleanupError), original_failure_preserved: primaryError !== null });
    } catch (observationError) {
      failure = new AggregateError([cleanupError, observationError], "Negative-control restoration and cleanup diagnostic recording both failed");
    }
    if (primaryError !== null) {
      throw new AggregateError([primaryError, failure], "Reconnect experiment and negative-control restoration both failed");
    }
    throw failure;
  }
}

export function rostersAgree(left, right) {
  const state = roster => roster.entries.map(({ id, name, away }) => ({ id, name, away })).sort((a, b) => a.id.localeCompare(b.id));
  const valid = roster => roster.entries.length === 2 &&
    new Set(roster.entries.map(entry => entry.id)).size === 2 &&
    roster.entries.every(entry => typeof entry.id === "string" && entry.id && typeof entry.name === "string" && entry.name && entry.away === false) &&
    roster.entries.filter(entry => entry.self).length === 1;
  return valid(left) && valid(right) && left.room === right.room &&
    left.entries.find(entry => entry.self).id !== right.entries.find(entry => entry.self).id &&
    JSON.stringify(state(left)) === JSON.stringify(state(right));
}

// Installed Playwright types document that onMessage disables automatic forwarding.
// Every nonsuppressed frame is therefore explicitly forwarded to the real client.
export async function routeTransport(page, url) {
  const target = new URL(url);
  let blocked = false;
  let releaseGate = null;
  let gate = Promise.resolve();
  let active = null;
  let attempts = 0;
  let connected = 0;
  let suppressWelcome = false;
  let suppressed = 0;
  let latestWelcome = null;
  let latestAway = null;
  const renames = new Map();
  await page.routeWebSocket(socketUrl => socketUrl.host === target.host && socketUrl.pathname === "/ws", async socket => {
    const attempt = ++attempts;
    if (blocked) await gate;
    const server = socket.connectToServer();
    connected++;
    active = { socket, server, attempt };
    server.onMessage(frame => {
      let message;
      try { message = JSON.parse(String(frame)); } catch { socket.send(frame); return; }
      if (message.t === "welcome") {
        latestWelcome = { attempt, you: message.you, participants: message.participants, room: message.room };
        if (suppressWelcome) { suppressed++; return; }
      }
      if (message.t === "rename") renames.set(message.id, message.name);
      if (message.t === "away") latestAway = { id: message.id, grace_ms: message.graceMs };
      socket.send(frame);
    });
  });
  return {
    setWelcomeSuppression(value) { suppressWelcome = value === true; },
    async disconnect() {
      if (!active) throw new ReconnectInfrastructureError("No observed socket is available to disconnect");
      blocked = true;
      gate = new Promise(resolve => { releaseGate = resolve; });
      const previous = active;
      // close() acts on one side. Close both endpoints so the server observes departure
      // before the peer changes state; subsequent connections wait behind the gate.
      // Playwright's server-side proxy uses a browser WebSocket: close() permits
      // 1000 or application codes3000-4999, not arbitrary server close codes1012.
      await previous.server.close({ code: 4001, reason: "vibeguru bounded reconnect experiment" });
      await previous.socket.close({ code: 4001, reason: "vibeguru bounded reconnect experiment" });
    },
    release() {
      blocked = false;
      releaseGate?.();
      releaseGate = null;
    },
    snapshot() {
      return { attempts, connected, gate_blocked: blocked, suppressed_welcomes: suppressed,
        latest_welcome: latestWelcome, latest_away: latestAway, renames: Object.fromEntries(renames) };
    },
  };
}

export async function roster(page) {
  return page.evaluate(() => {
    const list = document.querySelector("#people");
    const status = document.querySelector("#status");
    const room = document.querySelector("#room-name");
    if (!list || !status || !room) throw new Error("Multiplayer observation selectors are unavailable");
    return { status: status.dataset.state || "unknown", room: room.textContent,
      entries: [...list.querySelectorAll("li")].map(li => ({ id: li.dataset.id || "", name: li.querySelector(".person-name")?.textContent || "",
        self: li.classList.contains("is-self"), away: li.dataset.away === "true" })) };
  });
}

async function ready(page, transport) {
  const state = await boundedObservation(async () => ({ ui: await roster(page), transport: transport.snapshot() }),
    value => value.ui.status === "open" && value.ui.entries.some(entry => entry.self) && !!value.transport.latest_welcome, infrastructureMs);
  if (!state.matched) throw new ReconnectInfrastructureError("Initial protocol welcome/application roster was not observable within the infrastructure deadline");
  return state.observed;
}

export async function setup(page, { config }) {
  const variant = process.env.VIBEGURU_LAB_VARIANT || "baseline";
  if (!["baseline", "fixed", "reconnect-broken"].includes(variant)) throw new Error(`Unsupported reconnect variant: ${variant}`);
  const browser = page.context().browser();
  if (!browser) throw new ReconnectInfrastructureError("A browser is required for isolated peer contexts");
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  const room = `lab-reconnect-${randomUUID().slice(0, 8)}`;
  // Set the room through the app's public URL input while retaining config.url/run
  // identity. No app internals, shared session storage, or original files are changed.
  for (const client of [page, peer]) {
    await isolate(client, config);
    await client.addInitScript(({ room, origin }) => {
      if (location.origin !== origin) return;
      const url = new URL(location.href); url.searchParams.set("room", room);
      history.replaceState(history.state, "", url.href);
    }, { room, origin: new URL(config.url).origin });
  }
  const mainTransport = await routeTransport(page, config.url);
  const peerTransport = await routeTransport(peer, config.url);
  sessions.set(page, { peer, peerContext, mainTransport, peerTransport, variant, room });
  await peer.goto(config.url);
  await ready(peer, peerTransport);
  await peer.locator("#network").selectOption("perfect");
}

export async function cleanup(page) {
  const session = sessions.get(page);
  if (!session) return;
  session.mainTransport.release();
  await session.peerContext.close();
  sessions.delete(page);
}

export default async function flow(page, { cycle, check, mark, observe }) {
  const session = sessions.get(page);
  if (!session) throw new ReconnectInfrastructureError("Reconnect setup was not run");
  if (typeof observe !== "function") throw new ReconnectInfrastructureError("This experiment requires ctx.observe(id, data) to preserve observations");
  const { peer, mainTransport, peerTransport, variant } = session;
  const record = (id, data) => observe(id, { experiment: "multiplayer-reconnect", variant, ...data });
  await ready(page, mainTransport);
  await page.locator("#network").selectOption("perfect");
  const initial = await boundedObservation(async () => ({ main: await roster(page), peer: await roster(peer) }), value => rostersAgree(value.main, value.peer));
  await record("reconnect-before", initial);
  check("initial-roster-agreement", initial.matched, "Two isolated clients initially agree on participant IDs and names");
  const mainId = initial.observed.main.entries.find(entry => entry.self).id;
  const peerId = initial.observed.peer.entries.find(entry => entry.self).id;
  const originalPeerName = initial.observed.peer.entries.find(entry => entry.self).name;
  const changedName = `Peer-${cycle}-${randomUUID().slice(0, 6)}`;
  const previousAttempt = mainTransport.snapshot().attempts;
  mainTransport.setWelcomeSuppression(variant === "reconnect-broken");
  let interventionStarted = false;
  let primaryError = null;
  try {
    interventionStarted = true;
    await mainTransport.disconnect();
    const outage = await boundedObservation(async () => ({ main: await roster(page), peer: await roster(peer), transport: peerTransport.snapshot() }),
      value => value.main.status !== "open" && value.peer.status === "open" && value.peer.entries.some(entry => entry.id === mainId && entry.away));
    await record("reconnect-disconnected", outage);
    check("disconnect-observed", outage.matched, "Main client loses its socket while the isolated peer observes its away state");
    await peer.getByLabel("Your display name", { exact: true }).fill(changedName);
    await peer.getByLabel("Your display name", { exact: true }).blur();
    const changed = await boundedObservation(async () => ({ main: await roster(page), peer: await roster(peer), transport: peerTransport.snapshot() }),
      value => value.transport.renames[peerId] === changedName && value.peer.entries.some(entry => entry.id === peerId && entry.name === changedName) &&
        value.main.entries.some(entry => entry.id === peerId && entry.name === originalPeerName));
    await record("reconnect-peer-updated", { ...changed, expected: { peer_id: peerId, changed_name: changedName, old_name_on_disconnected_client: originalPeerName } });
    check("peer-change-acknowledged", changed.matched, "Real server acknowledges the peer rename while disconnected main still shows the previous name");
    mainTransport.release();
    const rejoined = await boundedObservation(async () => ({ main: await roster(page), transport: mainTransport.snapshot() }),
      value => value.main.status === "open" && value.transport.latest_welcome?.attempt > previousAttempt, infrastructureMs);
    await record("reconnect-rejoined", rejoined);
    if (!rejoined.matched) throw new ReconnectInfrastructureError("Reconnect socket and real server welcome were not observable within the infrastructure deadline");
    check("transport-reconnected", true, "A new real WebSocket connection receives the server's rejoin welcome");
    const welcome = rejoined.observed.transport.latest_welcome;
    check("rejoin-snapshot-current", welcome.participants.some(entry => entry.id === peerId && entry.name === changedName), "Server rejoin snapshot includes the peer update made during disconnection");
    check("identity-preserved", welcome.you.id === mainId && rejoined.observed.main.entries.some(entry => entry.self && entry.id === mainId), "Main retains its observed identity during the bounded grace-window reconnect");
    const convergence = await boundedObservation(async () => ({ main: await roster(page), peer: await roster(peer) }),
      value => value.main.status === "open" && value.peer.status === "open" && rostersAgree(value.main, value.peer) &&
        value.main.entries.some(entry => entry.id === peerId && entry.name === changedName));
    await record("reconnect-convergence", { ...convergence, expected: { peer_id: peerId, peer_name: changedName, main_id: mainId }, transport: mainTransport.snapshot() });
    await mark("multiplayer-reconnect");
    check("roster-converged", convergence.matched, `Both visible rosters must converge within ${expectationMs}ms after an observed rejoin welcome`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    mainTransport.release();
    // Restore the transport after the deliberately broken expectation so every cycle
    // can begin with the same observable preconditions. This is harness cleanup, not
    // an application fix, and does not retract a recorded failed assertion.
    if (interventionStarted && variant === "reconnect-broken") {
      await restoreNegativeControl(async () => {
        try {
          if (page.isClosed()) throw new ReconnectInfrastructureError("Negative-control transport cleanup cannot restore a closed page");
          mainTransport.setWelcomeSuppression(false);
          const lastAttempt = mainTransport.snapshot().attempts;
          await mainTransport.disconnect();
          mainTransport.release();
          return await boundedObservation(async () => ({ main: await roster(page), peer: await roster(peer), transport: mainTransport.snapshot() }),
            value => value.transport.latest_welcome?.attempt > lastAttempt && value.main.status === "open" && rostersAgree(value.main, value.peer), infrastructureMs);
        } finally {
          mainTransport.release();
        }
      }, { record, primaryError });
    }
  }
}
