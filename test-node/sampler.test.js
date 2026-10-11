"use strict";

// sampler.js decides what "memory" means for this whole product. Every finding is
// downstream of it, and the analyzers cannot tell a bad measurement from a good one —
// hand them samples taken without a forced GC and they will confidently report a
// healthy app. So the properties worth pinning here are not the happy path but the
// failure modes, because those are the ones that fail silently.

const test = require("node:test");
const assert = require("node:assert/strict");

const { fakePage, fakeClient } = require("./helpers/fake-page");

const load = () => import("../driver-node/lib/sampler.js");

test("GC is requested through the heap profiler, which is the one that actually collects", async () => {
  const { collectGarbage } = await load();
  const client = fakeClient();

  await collectGarbage(client);

  assert.deepEqual(client.sent, ["HeapProfiler.collectGarbage"]);
});

test("when the heap profiler is unavailable it falls back to a forced purge", async () => {
  const { collectGarbage } = await load();
  const client = fakeClient({ fail: new Set(["HeapProfiler.collectGarbage"]) });

  await collectGarbage(client);

  assert.deepEqual(client.sent, [
    "HeapProfiler.collectGarbage",
    "Memory.forciblyPurgeJavaScriptMemory",
  ]);
});

test("a total GC failure does not throw — but the caller can tell", async () => {
  // This is the dangerous one. Without a forced GC, a sample measures transient
  // garbage rather than retained memory, every leak washes out, and the run reports
  // a clean app. Swallowing the error is right (a run should not die here), but
  // swallowing it *silently* would make a broken measurement indistinguishable from
  // a healthy app — the worst failure this product has.
  const { collectGarbage } = await load();
  const client = fakeClient({
    fail: new Set(["HeapProfiler.collectGarbage", "Memory.forciblyPurgeJavaScriptMemory"]),
  });

  const result = await collectGarbage(client);

  assert.equal(result, false, "collectGarbage must report that it could not collect");
});

test("a successful collection reports success", async () => {
  const { collectGarbage } = await load();

  assert.equal(await collectGarbage(fakeClient()), true);
  assert.equal(
    await collectGarbage(fakeClient({ fail: new Set(["HeapProfiler.collectGarbage"]) })),
    true,
    "the fallback still counts as having collected"
  );
});

test("a sample carries the metrics every analyzer signature depends on", async () => {
  const { sample } = await load();
  const s = await sample(fakePage(), fakeClient());

  // Each of these is load-bearing: nodes drives detached_dom_leak, listeners drives
  // listener_leak, heapUsed drives route_heap_growth and initial_bundle_heap.
  for (const key of ["nodes", "listeners", "heapUsed", "heapTotal", "documents", "canvases"]) {
    assert.ok(key in s, `sample is missing ${key}`);
  }
});

test("DOM counters come from CDP, not from the page", async () => {
  // Reading node counts via JS would only see the document; the renderer's own
  // counter is what catches detached nodes still held in memory.
  const { sample } = await load();
  const client = fakeClient({ counters: { documents: 2, nodes: 9001, jsEventListeners: 17 } });

  const s = await sample(fakePage(), client);

  assert.equal(s.nodes, 9001);
  assert.equal(s.listeners, 17);
  assert.equal(s.documents, 2);
  assert.ok(client.sent.includes("Memory.getDOMCounters"));
});

test("a CDP failure yields nulls, never zeros", async () => {
  // A zero would be read by the analyzer as a real measurement — and a route whose
  // node count "dropped to zero" is indistinguishable from one that was never
  // measured. Null is skipped by the delta chain; zero would invent a finding.
  const { sample } = await load();
  const s = await sample(fakePage(), fakeClient({ fail: new Set(["Memory.getDOMCounters"]) }));

  assert.equal(s.nodes, null);
  assert.equal(s.listeners, null);
  assert.equal(s.documents, null);
});

test("a page that cannot be evaluated still returns a usable sample", async () => {
  const { sample } = await load();
  const broken = fakePage();
  broken.evaluate = async () => {
    throw new Error("execution context destroyed");
  };

  const s = await sample(broken, fakeClient());

  assert.equal(s.heapUsed, null);
  assert.equal(s.canvases, null);
  // CDP still answered, so those numbers survive — a partial sample beats no sample.
  assert.equal(s.nodes, 1200);
});

test("sampling never throws, whatever the browser is doing", async () => {
  // A sample runs between a mount and an unmount; if it can throw, one flaky route
  // takes down a run that had already gathered most of its evidence.
  const { sample } = await load();
  const dead = fakePage();
  dead.evaluate = async () => {
    throw new Error("target closed");
  };

  await assert.doesNotReject(() =>
    sample(dead, fakeClient({ fail: new Set(["Memory.getDOMCounters"]) }))
  );
});
