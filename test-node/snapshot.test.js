"use strict";

// The snapshot parser reads V8's own binary-ish layout: nodes are a flat integer array,
// the column names live in `meta.node_fields`, and names index into a string table. That
// is exactly the kind of code that breaks silently when a field moves — it keeps
// returning numbers, they are just the wrong numbers.
//
// So the parser is a pure function over the format and is tested directly, with snapshots
// built to shape here rather than captured from a browser.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../driver-node/lib/snapshot.js");

/**
 * Build a snapshot in V8's real layout.
 *
 * `objects` is [constructorName, selfSize] pairs. The column order is deliberately NOT
 * the one the parser might assume — reading the layout from the file is the property
 * under test.
 */
function snapshot(objects, { extraNodes = [] } = {}) {
  const node_fields = ["type", "name", "id", "self_size", "edge_count"];
  const node_types = [["hidden", "array", "string", "object", "closure"], "string", "number", "number", "number"];
  const objectType = node_types[0].indexOf("object");

  const strings = [""];
  const stringIndex = (s) => {
    const at = strings.indexOf(s);
    if (at !== -1) return at;
    strings.push(s);
    return strings.length - 1;
  };

  const nodes = [];
  let id = 1;

  for (const [name, size] of objects) {
    nodes.push(objectType, stringIndex(name), id++, size, 0);
  }

  // Nodes of other types (strings, closures) must be ignored — only objects carry a
  // constructor name.
  for (const [type, name] of extraNodes) {
    nodes.push(node_types[0].indexOf(type), stringIndex(name), id++, 16, 0);
  }

  return { snapshot: { meta: { node_fields, node_types }, node_count: id - 1 }, nodes, strings };
}

test("counts objects by constructor name", async () => {
  const { summarize } = await load();

  const result = summarize(
    snapshot([
      ["Chart", 400],
      ["Chart", 400],
      ["Chart", 400],
      ["Widget", 100],
    ])
  );

  assert.equal(result.constructors.Chart.count, 3);
  assert.equal(result.constructors.Chart.bytes, 1200);
  assert.equal(result.constructors.Widget.count, 1);
});

test("only object nodes are counted", async () => {
  // A string named "Chart" is not a Chart.
  const { summarize } = await load();

  const result = summarize(
    snapshot([["Chart", 400]], {
      extraNodes: [
        ["string", "Chart"],
        ["closure", "Chart"],
        ["array", "Chart"],
      ],
    })
  );

  assert.equal(result.constructors.Chart.count, 1);
});

test("the column layout is read from the file, not assumed", async () => {
  // V8 has changed this layout before. A parser that hardcodes offsets keeps returning
  // numbers after such a change; they are just wrong.
  const { summarize } = await load();
  const snap = snapshot([["Chart", 400]]);

  // Move `name` to the end and rebuild the rows to match.
  const fields = snap.snapshot.meta.node_fields;
  const nameAt = fields.indexOf("name");
  const stride = fields.length;
  const reordered = [];

  for (let i = 0; i < snap.nodes.length; i += stride) {
    const row = snap.nodes.slice(i, i + stride);
    const [name] = row.splice(nameAt, 1);
    reordered.push(...row, name);
  }

  const types = snap.snapshot.meta.node_types;
  const [nameType] = types.splice(nameAt, 1);

  const moved = {
    ...snap,
    snapshot: {
      meta: {
        node_fields: [...fields.filter((f) => f !== "name"), "name"],
        node_types: [...types, nameType],
      },
    },
    nodes: reordered,
  };

  assert.equal(summarize(moved).constructors.Chart.count, 1);
});

test("engine bookkeeping is filtered out", async () => {
  const { summarize } = await load();

  const result = summarize(
    snapshot([
      ["system / Context", 100],
      ["(closure)", 100],
      ["Object", 100],
      ["Chart", 400],
    ])
  );

  assert.deepEqual(Object.keys(result.constructors), ["Chart"]);
});

test("a requested class survives the filter and reports zero when absent", async () => {
  // "absent from the heap" is a real answer here — the snapshot saw everything. It must
  // not be confused with the census's null, which means "never asked".
  const { summarize } = await load();

  const result = summarize(snapshot([["Widget", 100]]), { targets: ["Chart", "Object"] });

  assert.equal(result.constructors.Chart.count, 0);
  assert.ok("Object" in result.constructors, "a targeted class beats the noise filter");
});

test("the long tail is dropped, biggest first", async () => {
  const { summarize } = await load();
  const many = [];
  for (let n = 0; n < 60; n++) for (let c = 0; c <= n; c++) many.push([`Class${n}`, 10]);

  const result = summarize(snapshot(many), { topN: 5 });
  const names = Object.keys(result.constructors);

  assert.equal(names.length, 5);
  assert.equal(names[0], "Class59", "the most numerous constructor comes first");
});

test("a malformed snapshot fails with a sentence, not a type error", async () => {
  const { summarize } = await load();

  assert.throws(() => summarize({}), /not a V8 heap snapshot/);
  assert.throws(() => summarize(null), /not a V8 heap snapshot/);
  assert.throws(
    () =>
      summarize({
        snapshot: { meta: { node_fields: ["id", "self_size"], node_types: [[], ""] } },
        nodes: [1, 2],
        strings: [""],
      }),
    /missing the type or name column/
  );
});

// --- growth ---------------------------------------------------------------

test("growth reports only what increased, per visit", async () => {
  const { growth } = await load();

  const result = growth(
    { Chart: { count: 1, bytes: 400 }, Stable: { count: 5, bytes: 100 } },
    { Chart: { count: 5, bytes: 2000 }, Stable: { count: 5, bytes: 100 } },
    4
  );

  assert.deepEqual(result.Chart, { retained: 4, perVisit: 1, bytes: 1600 });
  assert.ok(!("Stable" in result), "a flat count is not growth");
});

test("a class absent from the baseline counts as zero, not unknown", async () => {
  // The snapshot looked at the whole heap, so absence really is zero — unlike the
  // census, where an unreachable prototype means the question was never asked.
  const { growth } = await load();

  const result = growth({}, { WebSocket: { count: 3, bytes: 300 } }, 3);

  assert.equal(result.WebSocket.retained, 3);
  assert.equal(result.WebSocket.perVisit, 1);
});

test("a shrinking count is not reported as a leak", async () => {
  const { growth } = await load();

  const result = growth({ Cache: { count: 10, bytes: 1000 } }, { Cache: { count: 2, bytes: 200 } }, 3);

  assert.deepEqual(result, {});
});

test("fractional growth is kept rather than rounded to zero", async () => {
  // One instance retained across four visits is still a leak, and reporting it as
  // "0 per visit" would read as clean.
  const { growth } = await load();

  const result = growth({ Leaky: { count: 0, bytes: 0 } }, { Leaky: { count: 1, bytes: 50 } }, 4);

  assert.equal(result.Leaky.perVisit, 0.25);
  assert.equal(result.Leaky.retained, 1);
});
