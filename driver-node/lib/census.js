// census.js — count how many live instances of a given class survive a collection.
//
// The sampler answers "how much memory is retained". This answers "retained *as
// what*", which is the difference between a finding a developer has to go
// investigate and one they can act on:
//
//   before   /charts retains ~178KB of JS heap per visit
//   after    /charts retains one live Chart instance per visit
//
// Counting instances is a runtime-agnostic idea — the same question is `gc.get_objects()`
// in Python, a heap histogram on the JVM, idle-in-transaction rows in Postgres. Only the
// mechanism below is browser-specific; the analyzer that reasons about the counts is not,
// which is what lets a future Python or Postgres census reuse it unchanged.
//
// Mechanism: CDP's Runtime.queryObjects returns every live object with a given
// prototype. It is the only way to ask this — page JavaScript cannot enumerate
// instances of a class. Callers are expected to have forced a collection first, so
// what is counted is retained, not merely uncollected.
//
// LIMITATION worth knowing before extending this: the prototype has to be reachable
// from the page's global scope. Built-ins are (WebSocket, MutationObserver, Worker),
// and so are libraries loaded by script tag (window.THREE). A library pulled in as an
// ES module is NOT — `import { Chart } from "chart.js"` is module-scoped, so a bundled
// app's own classes are invisible here and always report null.
//
// That is a boundary, not a defect: this probe answers "are global resources being
// retained", and a heap-snapshot probe is what answers the same question for bundled
// classes, since snapshots carry constructor names regardless of scope. Two probes,
// two questions — which is exactly the shape the investigation is meant to take.

/**
 * Count live instances for each constructor name.
 *
 * A name that does not exist in the page reports **null**, never 0. Zero is a
 * measurement — "this class exists and nothing is alive" — and the analyzer would
 * treat a drop to zero as a real change. Null means "not asked", and is skipped.
 */
export async function census(client, targets) {
  const counts = {};

  for (const name of targets) {
    counts[name] = await countInstances(client, name);
  }

  return counts;
}

async function countInstances(client, name) {
  let prototypeId = null;
  let arrayId = null;

  try {
    // Reject anything that is not a plain identifier. These names reach us from
    // config, and they are about to be evaluated inside the page.
    if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(name)) return null;

    const proto = await client.send("Runtime.evaluate", {
      expression: `typeof ${name} === "function" ? ${name}.prototype : undefined`,
      returnByValue: false,
    });

    prototypeId = proto?.result?.objectId ?? null;

    // undefined prototype => the class is not present on this page. Not an error:
    // we census a superset of what any one app uses.
    if (!prototypeId) return null;

    const found = await client.send("Runtime.queryObjects", {
      prototypeObjectId: prototypeId,
    });

    arrayId = found?.objects?.objectId ?? null;
    if (!arrayId) return null;

    const length = await client.send("Runtime.callFunctionOn", {
      objectId: arrayId,
      functionDeclaration: "function () { return this.length; }",
      returnByValue: true,
    });

    const value = length?.result?.value;
    return typeof value === "number" ? value : null;
  } catch {
    // A census is supplementary evidence. A page that cannot answer must not take
    // down a run that has already gathered its memory samples.
    return null;
  } finally {
    // These handles pin the very objects we are counting. Leaving them behind would
    // make the tool leak inside the app it is measuring, and inflate every later count.
    await release(client, prototypeId);
    await release(client, arrayId);
  }
}

async function release(client, objectId) {
  if (!objectId) return;
  try {
    await client.send("Runtime.releaseObject", { objectId });
  } catch {
    /* the context may already be gone */
  }
}
