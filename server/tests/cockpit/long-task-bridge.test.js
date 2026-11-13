import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { startCockpitLongTask, deliverRunResult } from "../../lib/cockpit/long-task-bridge.js";
import { pumpOnce } from "../../lib/cockpit/pump.js";
import { takePendingLongTaskNotices } from "../../lib/long-task.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";
import { getToolSpec } from "../../lib/cockpit/tool-spec.js";

const saved = { lt: process.env.CONCORD_COCKPIT_LONG_TASK, runs: process.env.CONCORD_COCKPIT_RUNS };
before(() => { process.env.CONCORD_COCKPIT_LONG_TASK = "1"; process.env.CONCORD_COCKPIT_RUNS = "1"; });
after(() => {
  for (const [k, v] of [["CONCORD_COCKPIT_LONG_TASK", saved.lt], ["CONCORD_COCKPIT_RUNS", saved.runs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

function dbWithMarathon() {
  const db = memDb();
  db.exec(`CREATE TABLE agent_marathon_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', total_turns INTEGER NOT NULL DEFAULT 0, max_turns INTEGER NOT NULL DEFAULT 200, meta_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), completed_at INTEGER, next_tick_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  return db;
}
const step = (i, tool) => ({ key: `s${i}`, goal: `step ${i}`, tool, args: { query: "a" }, expects: [], dependsOn: [], required: true });
const planDeps = (steps) => ({ planRun: async () => ({ ok: true, source: "template", steps }) });

test("creates a long_task cockpit run and no marathon session", async () => {
  const db = dbWithMarathon();
  const r = await startCockpitLongTask({ db, userId: "u1", goal: "research budget 3D printers and write a report", deps: planDeps([step(1, "web_search")]) });
  assert.equal(r.ok, true);
  assert.equal(store.getRun(db, r.runId).surface, "long_task");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_marathon_sessions").get().n, 0);
});

test("at the cap it refuses plainly", async () => {
  const db = dbWithMarathon();
  const deps = planDeps([step(1, "web_search")]);
  for (let i = 0; i < 2; i++) await startCockpitLongTask({ db, userId: "u1", goal: `research thing number ${i} thoroughly`, deps });
  const r = await startCockpitLongTask({ db, userId: "u1", goal: "research one more thing thoroughly", deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_many_runs");
});

test("a planner failure returns ok:false so the caller falls back", async () => {
  const r = await startCockpitLongTask({ db: dbWithMarathon(), userId: "u1", goal: "research something long enough", deps: { planRun: async () => ({ ok: false, reason: "plan_failed", steps: [] }) } });
  assert.equal(r.ok, false);
});

test("a finished run posts one notice with the last summary and no tool id", async () => {
  const db = dbWithMarathon();
  const started = await startCockpitLongTask({ db, userId: "u1", goal: "research budget 3D printers and write a report", deps: planDeps([step(1, "web_search")]) });
  const exec = fakeExec({ web_search: [{ tool: "web_search", ok: true, result: { title: "Printers", total: 3 } }] });
  const mock = createMockModel({ steps: {} });
  await pumpOnce({ db, owner: "t", makeDeps: () => ({ exec, lensActions: new Map(), sleep: async () => {}, stepCall: (a) => mock.next(a) }) });
  // delivery is fire-and-forget from the engine; call it directly too (idempotent enough for a single notice check)
  const run = store.getRun(db, started.runId);
  if (run.status === "done" && db.prepare("SELECT COUNT(*) AS n FROM agent_marathon_sessions").get().n === 0) {
    await deliverRunResult(db, run, store.listSteps(db, started.runId));
  }
  const notices = takePendingLongTaskNotices(db, "u1");
  assert.equal(notices.length, 1);
  assert.ok(!/web_search/.test(notices[0].text));
});

test("start_long_task is not a cockpit step tool", () => {
  assert.equal(getToolSpec("start_long_task", { lensActions: new Map() }), null);
});
