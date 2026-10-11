"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("response gates release an observed older request after a newer one without timing guesses", async () => {
  const { ResponseOrder } = await import("../benchmarks/response-order.mjs");
  const schedule = new ResponseOrder();
  const delivered = [];
  schedule.begin(["old", "new"]);
  const older = schedule.holdNext(async label => delivered.push(label));
  const newer = schedule.holdNext(async label => delivered.push(label));
  await schedule.waitFor("old"); await schedule.waitFor("new");
  assert.deepEqual(delivered, []);
  assert.throws(() => schedule.begin(["next"]), /not completed/);
  await schedule.release("new"); await newer;
  assert.deepEqual(delivered, ["new"]);
  await schedule.release("old"); await older;
  assert.deepEqual(delivered, ["new", "old"]);
  await assert.rejects(schedule.release("old"), /not pending/);
  await assert.rejects(schedule.waitFor("missing", 5), /did not arrive/);
  schedule.begin(["cleanup"]);
  const pending = schedule.holdNext(async label => delivered.push(label));
  await schedule.drain(); await pending;
  assert.equal(delivered.at(-1), "cleanup");
});

test("a failed response release unblocks cleanup while preserving its execution failure", async () => {
  const { ResponseOrder } = await import("../benchmarks/response-order.mjs");
  const schedule = new ResponseOrder();
  schedule.begin(["failed"]);
  const pending = schedule.holdNext(async () => { throw new Error("transport unavailable"); });
  await assert.rejects(schedule.release("failed"), /transport unavailable/);
  await pending;
  await schedule.drain();
  assert.equal(schedule.events.at(-1).event, "response-release-failed");
  schedule.begin(["never-requested"]);
  assert.throws(() => schedule.begin(["replacement"]), /not completed/);
  await schedule.drain();
  assert.equal(schedule.events.at(-1).event, "plan-abandoned");
});
