"use strict";
(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "vulnerable";
  const namespace = params.get("namespace") || `manual-${crypto.randomUUID()}`;
  const $ = id => document.getElementById(id);
  let intent = "";
  let pending = 0;
  let attempts = [];
  let orders = [];
  let failed = false;

  function showError(error) {
    failed = true;
    $("error").hidden = false;
    $("error").textContent = error.message;
  }

  function render() {
    $("status").dataset.pending = String(pending);
    $("status").dataset.settled = String(attempts.length);
    $("status").dataset.state = failed ? "error" : pending ? "pending" : "ready";
    $("status").textContent = pending ? `${pending} request(s) in flight` : `${attempts.length} request(s) settled`;
    $("new-order").disabled = pending > 0;
    $("retry-order").disabled = pending > 0 || attempts.length === 0;
    $("quantity").disabled = pending > 0 || attempts.length > 0;
    $("persisted-count").textContent = String(orders.length);
    $("attempts").replaceChildren(...attempts.map(attempt => {
      const item = document.createElement("li");
      item.textContent = attempt.error ? `${attempt.attempt_id}: ${attempt.error}` : `${attempt.attempt_id}: ${attempt.replayed ? "reused existing order" : "created order"} ${attempt.order_id}`;
      return item;
    }));
    $("orders").replaceChildren(...orders.map(order => {
      const item = document.createElement("li");
      item.textContent = `${order.id} · ${order.quantity} seat(s) · $${(order.total_cents / 100).toFixed(2)}`;
      return item;
    }));
  }

  async function readOrders(forIntent) {
    const response = await fetch(`/api/${mode}/state?${new URLSearchParams({ namespace })}`);
    if (!response.ok) throw new Error(`Backend readback returned HTTP ${response.status}`);
    const state = await response.json();
    if (intent === forIntent) orders = state.orders.filter(order => order.intent_id === forIntent);
  }

  function newIntent() {
    if (pending) return;
    intent = crypto.randomUUID();
    attempts = [];
    orders = [];
    failed = false;
    $("error").hidden = true;
    $("intent-token").value = intent;
    $("quantity").value = "1";
    render();
  }

  async function submit() {
    const currentIntent = intent;
    const attemptId = crypto.randomUUID();
    const quantity = Number($("quantity").value);
    pending++;
    render();
    try {
      const response = await fetch(`/api/${mode}/orders`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": currentIntent },
        body: JSON.stringify({ namespace, intent_id: currentIntent, attempt_id: attemptId, sku: "reliability-seat", quantity }) });
      const receipt = await response.json();
      if (!response.ok) throw new Error(`Order write returned HTTP ${response.status}: ${receipt.error || "unknown error"}`);
      attempts.push({ attempt_id: attemptId, order_id: receipt.order.id, replayed: receipt.replayed });
    } catch (error) {
      attempts.push({ attempt_id: attemptId, error: error.message });
      showError(error);
    } finally {
      try { await readOrders(currentIntent); } catch (error) { showError(error); }
      pending--;
      render();
    }
  }

  $("order-form").addEventListener("submit", event => { event.preventDefault(); void submit(); });
  $("retry-order").addEventListener("click", () => { void submit(); });
  $("new-order").addEventListener("click", newIntent);
  if (!["vulnerable", "idempotent"].includes(mode)) {
    showError(new Error("Unknown implementation mode"));
    $("order-form").hidden = true;
    render();
    return;
  }
  $("mode-label").textContent = mode === "idempotent" ? "Corrected mode · atomic idempotency" : "Vulnerable mode · duplicate writes allowed";
  newIntent();
})();
