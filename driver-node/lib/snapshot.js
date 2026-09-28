// snapshot.js — count live objects by constructor, including ones the census cannot see.
//
// `census.js` asks the page for instances of a class by prototype, which only works when
// that prototype is reachable from global scope. An ES module import is not:
// `import { Chart } from "chart.js"` is module-scoped, so a bundled app's own classes are
// structurally invisible there and always report null.
//
// A heap snapshot carries every object's constructor name regardless of scope, so this is
// the probe that answers the same question for bundled code. It costs seconds rather than
// milliseconds, which is exactly why it is not part of the survey pass — the investigation
// loop reaches for it only once something cheaper has narrowed the question.

// V8 streams the snapshot as JSON chunks. A dev-mode SPA is usually tens of MB; the cap
// exists so an unusually large heap fails with a sentence instead of an OOM kill.
const MAX_BYTES = 400 * 1024 * 1024;

// How many constructors to report. A snapshot names tens of thousands; almost all of them
// are noise, and shipping the long tail would cost more than the answer is worth.
const TOP_N = 40;

// Internal bookkeeping that is never the answer to "what is my app retaining".
const NOISE = /^(system \/|\(|Object$|Array$|string$|number$|symbol$)/;

/**
 * Capture a heap snapshot and return counts by constructor.
 *
 * The caller is expected to have forced a collection first, so what is counted is
 * retained rather than merely uncollected.
 */
export async function capture(client, { targets = [] } = {}) {
  const chunks = [];
  let bytes = 0;
  let overflowed = false;

  const onChunk = ({ chunk }) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      overflowed = true;
      return;
    }
    chunks.push(chunk);
  };

  client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);

  try {
    await client.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      // Without this, objects reachable only from the global object are reported as
      // unreachable — which would hide exactly what we are looking for.
      treatGlobalObjectsAsRoots: true,
    });
  } finally {
    client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }

  if (overflowed) {
    throw new Error(
      `heap snapshot exceeded ${Math.round(MAX_BYTES / 1024 / 1024)}MB and was not parsed`
    );
  }

  return summarize(JSON.parse(chunks.join("")), { targets });
}

/**
 * Turn a parsed V8 snapshot into `{ constructorName: { count, bytes } }`.
 *
 * Exported separately because it is a pure function over the snapshot format, which makes
 * it testable without launching a browser — the part most likely to break silently when
 * V8 changes its field layout.
 *
 * The format packs nodes into one flat integer array: `node_fields` names the columns and
 * doubles as the stride, `name` indexes into `strings`, and `type` indexes into the type
 * table. Reading the layout from the file rather than hardcoding it is what keeps this
 * working across V8 versions.
 */
export function summarize(snapshot, { targets = [], topN = TOP_N } = {}) {
  const meta = snapshot?.snapshot?.meta;
  const nodes = snapshot?.nodes;
  const strings = snapshot?.strings;

  if (!meta || !Array.isArray(nodes) || !Array.isArray(strings)) {
    throw new Error("not a V8 heap snapshot: missing meta, nodes or strings");
  }

  const fields = meta.node_fields;
  const stride = fields.length;
  const typeAt = fields.indexOf("type");
  const nameAt = fields.indexOf("name");
  const sizeAt = fields.indexOf("self_size");

  if (typeAt === -1 || nameAt === -1) {
    throw new Error("heap snapshot is missing the type or name column");
  }

  // Only "object" nodes carry a constructor name; strings, numbers and closures do not.
  const objectType = meta.node_types[typeAt].indexOf("object");
  const wanted = new Set(targets);
  const counts = new Map();

  for (let i = 0; i + stride <= nodes.length; i += stride) {
    if (nodes[i + typeAt] !== objectType) continue;

    const name = strings[nodes[i + nameAt]];
    if (!name) continue;
    if (NOISE.test(name) && !wanted.has(name)) continue;

    const entry = counts.get(name) || { count: 0, bytes: 0 };
    entry.count += 1;
    if (sizeAt !== -1) entry.bytes += nodes[i + sizeAt] || 0;
    counts.set(name, entry);
  }

  return {
    constructors: rank(counts, wanted, topN),
    nodeCount: Math.floor(nodes.length / stride),
  };
}

// Everything explicitly asked for is kept whatever its count, because a class the
// investigation is asking about is informative even at zero. The rest is the biggest
// offenders only.
function rank(counts, wanted, topN) {
  const entries = [...counts.entries()];
  const targeted = entries.filter(([name]) => wanted.has(name));

  const rest = entries
    .filter(([name]) => !wanted.has(name))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN);

  const out = {};
  for (const [name, value] of [...targeted, ...rest]) out[name] = value;

  // A target absent from the heap reports 0 rather than being missing — the census
  // reports null for "never asked", and these two must not be confused.
  for (const name of wanted) if (!(name in out)) out[name] = { count: 0, bytes: 0 };

  return out;
}

/**
 * Growth per visit, which is the shape the analyzer and the policy both want.
 *
 * A class absent from the baseline counts as 0 there, not as unknown: the snapshot looked
 * at the whole heap, so absence really is zero.
 */
export function growth(before, after, visits) {
  const classes = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = {};

  for (const name of classes) {
    const from = before[name]?.count ?? 0;
    const to = after[name]?.count ?? 0;
    const delta = to - from;

    if (delta > 0) {
      out[name] = {
        retained: delta,
        perVisit: visits > 0 ? Math.round((delta / visits) * 100) / 100 : delta,
        bytes: (after[name]?.bytes ?? 0) - (before[name]?.bytes ?? 0),
      };
    }
  }

  return out;
}
