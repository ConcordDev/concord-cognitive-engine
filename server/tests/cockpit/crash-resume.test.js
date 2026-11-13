import test from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { driveRun } from "../../lib/cockpit/engine.js";
import { runTool } from "../../lib/cockpit/executor.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";
import { preapprove } from "./_helpers.js";

const mock = createMockModel({ steps: {} });
const mkDeps = (exec, extra = {}) => ({ exec, sleep: async () => {}, stepCall: (x) => mock.next(x), ...extra });

function oneStepRun(tool, args) {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, [{ id: "stp_1", goal: "do it", tool, args, expects: [] }]);
  preapprove(db, run.id, tool);
  return { db, run: store.getRun(db, run.id) };
}

test("1. a completed write is replayed, not repeated", async () => {
  const { db, run } = oneStepRun("create_dtu", { title: "A" });
  let n = 0;
  const exec = fakeExec({ create_dtu: () => { n++; return { tool: "create_dtu", ok: true, result: { dtuId: "d1" } }; } });
  await driveRun({ db, runId: run.id, owner: "A", deps: mkDeps(exec) });
  assert.equal(store.getRun(db, run.id).status, "done");
  const step = store.listSteps(db, run.id)[0];
  const again = await runTool({ db, run, step, call: { tool: "create_dtu", args: { title: "A" } }, deps: mkDeps(exec) });
  assert.equal(n, 1);
  assert.equal(again.replayed, true);
});

test("2. a crash mid-write asks the person instead of writing twice", async () => {
  const { db, run } = oneStepRun("create_dtu", { title: "A" });
  let n = 0;
  const hang = fakeExec({ create_dtu: () => { n++; return new Promise(() => {}); } });
  await Promise.race([
    driveRun({ db, runId: run.id, owner: "A", deps: mkDeps(hang) }),
    new Promise((r) => setTimeout(r, 200)),
  ]);
  assert.equal(store.listSteps(db, run.id)[0].status, "running");
  assert.equal(db.prepare("SELECT status FROM cockpit_effects").get().status, "claimed");
  const later = Date.now() + 200 * 1000;
  const exec2 = fakeExec({ create_dtu: () => { n++; return { tool: "create_dtu", ok: true, result: { dtuId: "d2" } }; } });
  await driveRun({ db, runId: run.id, owner: "B", deps: mkDeps(exec2, { now: () => later }) });
  const after = store.getRun(db, run.id);
  assert.equal(after.status, "awaiting_confirm");
  assert.equal(after.statusReason, "maybe_done");
  assert.equal(n, 1);
});

test("3. an interrupted idempotent step is simply run again", async () => {
  const { db, run } = oneStepRun("run_compute", { key: "symbolic.evaluate", input: { expression: "2+2" } });
  let n = 0;
  const hang = fakeExec({ run_compute: () => { n++; return new Promise(() => {}); } });
  await Promise.race([
    driveRun({ db, runId: run.id, owner: "A", deps: mkDeps(hang) }),
    new Promise((r) => setTimeout(r, 200)),
  ]);
  const later = Date.now() + 200 * 1000;
  const exec2 = fakeExec({ run_compute: () => { n++; return { tool: "run_compute", ok: true, result: { value: 4 } }; } });
  await driveRun({ db, runId: run.id, owner: "B", deps: mkDeps(exec2, { now: () => later }) });
  assert.equal(store.getRun(db, run.id).status, "done");
  assert.equal(n, 2);
});

test("4. negative control: a read tool creates no effect row", async () => {
  const { db, run } = oneStepRun("web_search", { query: "q" });
  const exec = fakeExec({ web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }] });
  await driveRun({ db, runId: run.id, owner: "A", deps: mkDeps(exec) });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM cockpit_effects").get().c, 0);
});
