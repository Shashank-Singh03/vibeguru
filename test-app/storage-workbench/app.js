// Authored vulnerable and defensive implementations; fault flags belong to the
// benchmark and inject DOMExceptions only for this editor's own storage key.
const params = new URLSearchParams(location.search);
const key = params.get("key"), mode = params.get("mode");
if (!key?.startsWith("vibeguru-storage:") || !["vulnerable", "defensive"].includes(mode)) throw new Error("Invalid editor configuration");
document.body.dataset.boot = "started";
window.__storageOperations = [];
window.__storageFault = { kind: params.get("fault") || "none", enabled: true };
const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
Storage.prototype.getItem = function (name) {
  const blocked = name === key && window.__storageFault.enabled && window.__storageFault.kind === "denied";
  window.__storageOperations.push({ op: "read", key: name, blocked });
  if (blocked) throw new DOMException("Controlled storage access denial", "SecurityError");
  return get.call(this, name);
};
Storage.prototype.setItem = function (name, value) {
  const blocked = name === key && window.__storageFault.enabled && ["denied", "quota"].includes(window.__storageFault.kind);
  window.__storageOperations.push({ op: "write", key: name, blocked });
  if (blocked) throw new DOMException("Controlled storage write failure", window.__storageFault.kind === "quota" ? "QuotaExceededError" : "SecurityError");
  return set.call(this, name, value);
};
const defensive = mode === "defensive";
const valid = value => value && value.version === 1 && typeof value.text === "string" && Object.keys(value).length === 2;
let draft;
if (defensive) {
  try {
    const raw = localStorage.getItem(key);
    draft = raw === null ? { version: 1, text: "" } : JSON.parse(raw);
    if (!valid(draft)) throw new Error("Unsupported stored draft");
  } catch {
    draft = { version: 1, text: "" };
    document.querySelector("#notice").textContent = "Recovered editor; stored draft could not be read. Save explicitly to replace it.";
  }
} else {
  const raw = localStorage.getItem(key);
  draft = raw === null ? { version: 1, text: "" } : JSON.parse(raw);
}
const text = document.createElement("textarea"); text.id = "draft"; text.setAttribute("aria-label", "Draft"); text.value = draft.text;
const save = document.createElement("button"); save.id = "save"; save.textContent = "Save draft";
const status = document.createElement("p"); status.id = "save-status"; status.setAttribute("role", "status"); status.textContent = "Ready";
document.querySelector("#editor").append(text, save, status);
text.oninput = () => { status.textContent = "Unsaved changes"; };
save.onclick = () => {
  status.textContent = "Saving";
  const persist = () => localStorage.setItem(key, JSON.stringify({ version: 1, text: text.value }));
  if (defensive) {
    try { persist(); status.textContent = "Saved"; }
    catch { status.textContent = "Unsaved: storage unavailable. Keep this editor open and retry."; }
  } else { persist(); status.textContent = "Saved"; }
};
document.body.dataset.boot = "ready";
