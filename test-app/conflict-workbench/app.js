import { changedFields, mergeChangedFields } from "./model.mjs";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "vulnerable";
let namespace = params.get("namespace") || `manual-${crypto.randomUUID()}`;
const client = params.get("client") || "A";
const $ = id => document.getElementById(id);
let base = null, latest = null, pending = null, state = "loading", lastStatus = 0;
const receipts = [];
const doc = value => ({ title: value.title, note: value.note });
const draft = () => ({ title: $("title").value, note: $("note").value });
const dirty = () => pending?.fields || (base ? changedFields(doc(base), draft()) : []);

function render() {
  $("identity").textContent = `Client ${client} / ${mode} / ${namespace}`;
  $("identity").dataset.client = client;
  $("status").dataset.state = state;
  $("status").dataset.lastStatus = String(lastStatus);
  $("status").dataset.settled = String(receipts.length);
  $("status").textContent = { loading: "Loading document", empty: "No document seeded", ready: "Document ready", saving: "Saving document", conflict: "Version conflict; local draft retained", error: "Request failed" }[state];
  $("base-version").textContent = String(base?.version || 0);
  $("server-version").textContent = String(latest?.version || 0);
  $("server-title").textContent = latest?.title || "";
  $("server-note").textContent = latest?.note || "";
  $("pending-fields").textContent = dirty().join(", ") || "none";
  const busy = ["loading", "saving"].includes(state);
  $("open").disabled = busy;
  $("namespace").disabled = busy;
  $("title").disabled = !base || busy || state === "conflict";
  $("note").disabled = !base || busy || state === "conflict";
  $("save").disabled = state !== "ready" || dirty().length === 0;
  $("reload").disabled = busy;
  $("conflict").hidden = state !== "conflict";
  $("reconcile").disabled = state !== "conflict";
  $("conflict-message").textContent = "The server rejected this stale snapshot. Your pending fields remain visible. Reconcile reloads the latest version and reapplies only those local fields.";
  $("receipts").replaceChildren(...receipts.map(receipt => {
    const item = document.createElement("li");
    item.dataset.receipt = JSON.stringify(receipt);
    item.textContent = `${receipt.attempt_id}: HTTP ${receipt.status}, base ${receipt.base_version}, server ${receipt.result_version}`;
    return item;
  }));
}
function fail(error) { state = "error"; $("error").hidden = false; $("error").textContent = error.message; render(); }
async function request(resource, options) {
  const response = await fetch(`/api/${mode}/${resource}`, options);
  const body = await response.json();
  if (body.fixture !== "vibeguru-conflict-workbench" || body.mode !== mode || body.namespace !== namespace) throw new Error("Invalid fixture response identity");
  return { response, body };
}
function loadDraft(value) { base = { ...value }; $("title").value = value.title; $("note").value = value.note; }
async function reload() {
  state = "loading"; render();
  const { response, body } = await request(`state?${new URLSearchParams({ namespace })}`);
  if (!response.ok) throw new Error(`Document read returned HTTP ${response.status}`);
  latest = body.document; pending = null;
  if (latest) { loadDraft(latest); state = "ready"; } else { base = null; state = "empty"; }
  $("error").hidden = true; render();
}
async function openDocument() {
  const next = $("namespace").value;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(next)) throw new Error("Invalid document namespace");
  namespace = next;
  base = null; latest = null; pending = null; lastStatus = 0; receipts.length = 0;
  $("title").value = ""; $("note").value = "";
  await reload();
}
async function write(local, localFields) {
  state = "saving"; render();
  const body = { namespace, client_id: client, attempt_id: crypto.randomUUID(), base_version: base.version,
    document: local, changed_fields: localFields };
  const result = await request("document", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (![200, 409].includes(result.response.status) || !result.body.attempt || result.body.attempt.attempt_id !== body.attempt_id) {
    throw new Error(`Document save returned invalid acknowledgement (HTTP ${result.response.status})`);
  }
  lastStatus = result.response.status;
  receipts.push({ ...result.body.attempt }); latest = result.body.document;
  if (lastStatus === 409) { pending = { draft: { ...local }, fields: [...localFields] }; state = "conflict"; }
  else { pending = null; loadDraft(latest); state = "ready"; }
  render();
}
async function reconcile() {
  if (!pending) throw new Error("No pending conflict to reconcile");
  const saved = { draft: { ...pending.draft }, fields: [...pending.fields] };
  state = "loading"; render();
  const { response, body } = await request(`state?${new URLSearchParams({ namespace })}`);
  if (!response.ok || !body.document) throw new Error("Latest document could not be loaded for reconciliation");
  latest = body.document;
  const merged = mergeChangedFields(doc(latest), saved.draft, saved.fields);
  base = { ...latest }; $("title").value = merged.title; $("note").value = merged.note;
  // Preserve the same intended fields even if another writer conflicts again.
  pending = saved;
  await write(merged, saved.fields);
}
$("document-form").addEventListener("submit", event => { event.preventDefault(); void write(draft(), dirty()).catch(fail); });
$("reload").addEventListener("click", () => { void reload().catch(fail); });
$("open").addEventListener("click", () => { void openDocument().catch(fail); });
$("reconcile").addEventListener("click", () => { void reconcile().catch(fail); });
for (const field of ["title", "note"]) $(field).addEventListener("input", render);
$("namespace").value = namespace;
if (!["vulnerable", "versioned"].includes(mode)) fail(new Error("Unknown mode"));
else void reload().catch(fail);
