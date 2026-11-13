import test from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { driveRun } from "../../lib/cockpit/engine.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

test("a run resumes after a simulated restart without repeating finished steps", async () => {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "four searches", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, [1, 2, 3, 4].map((n) => ({ id: `stp_${n}`, goal: `search ${n}`, tool: "web_search", args: { query: `q${n}` }, expects: [] })));
  const calls = [];
  const execA = fakeExec({ web_search: (c) => { calls.push(c.params.query); return { tool: "web_search", ok: true, result: { n: 1 } }; } });
  const mock = createMockModel({ steps: {} });
  const mkDeps = (exec) => ({ exec, sleep: async () => {}, stepCall: (a) => mock.next(a) });

  await driveRun({ db, runId: run.id, owner: "before", deps: mkDeps(execA), maxTicks: 2 });
  assert.equal(store.listSteps(db, run.id).filter((s) => s.status === "done").length, 2);

  const execB = fakeExec({ web_search: (c) => { calls.push(c.params.query); return { tool: "web_search", ok: true, result: { n: 1 } }; } });
  await driveRun({ db, runId: run.id, owner: "after", deps: mkDeps(execB) });

  assert.equal(store.getRun(db, run.id).status, "done");
  assert.deepEqual(calls, ["q1", "q2", "q3", "q4"]);
  assert.equal(mock.calls.length, 0);
});
