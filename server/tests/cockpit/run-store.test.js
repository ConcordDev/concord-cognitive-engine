import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { memDb } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";

const mkRun = (db, over = {}) => store.createRun(db, { userId: "u1", surface: "chat", goal: "do things", modelProfile: "local-2b", ...over });

test("create a run with defaults", () => {
  const db = memDb();
  const r = mkRun(db);
  assert.equal(r.ok, true);
  assert.match(r.run.id, /^run_[0-9a-f]{16}$/);
  assert.equal(r.run.status, "planned");
  assert.equal(r.run.budget.maxSteps, 60);
  assert.deepEqual(r.run.usage, { toolCalls: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, humanInterventions: 0 });
});

test("maxSteps is capped at 200 and goal at 2000 chars", () => {
  const db = memDb();
  const r = mkRun(db, { budget: { maxSteps: 9999 }, goal: "g".repeat(5000) });
  assert.equal(r.run.budget.maxSteps, 200);
  assert.equal(r.run.goal.length, 2000);
});

test("invalid input and missing tables", () => {
  assert.deepEqual(store.createRun(memDb(), { surface: "chat", goal: "x" }), { ok: false, reason: "invalid_input" });
  assert.deepEqual(store.createRun(new Database(":memory:"), { userId: "u1", surface: "chat", goal: "x" }), { ok: false, reason: "no_table" });
});

test("insert 3 steps and read them back in order with parsed expects", () => {
  const db = memDb();
  const { run } = mkRun(db);
  store.insertSteps(db, run.id, 1, [
    { goal: "a", tool: "web_search", args: { query: "q" }, expects: [{ kind: "ok" }] },
    { goal: "b", tool: null, args: null, expects: [], required: false },
    { goal: "c", tool: "create_dtu", args: null, expects: [{ kind: "nonempty", path: "id" }], dependsOn: ["x"] },
  ]);
  const steps = store.listSteps(db, run.id);
  assert.deepEqual(steps.map((s) => s.seq), [1, 2, 3]);
  assert.deepEqual(steps[0].expects, [{ kind: "ok" }]);
  assert.deepEqual(steps[0].args, { query: "q" });
  assert.equal(steps[1].required, false);
  assert.deepEqual(steps[2].dependsOn, ["x"]);
});

test("updateRun refuses an unknown status", () => {
  const db = memDb();
  const { run } = mkRun(db);
  assert.equal(store.updateRun(db, run.id, { status: "bogus" }), false);
  assert.equal(store.getRun(db, run.id).status, "planned");
  assert.equal(store.updateRun(db, run.id, { status: "running" }), true);
});

test("getRunForUser hides another user's run", () => {
  const db = memDb();
  const { run } = mkRun(db);
  assert.equal(store.getRunForUser(db, run.id, "other"), null);
  assert.equal(store.getRunForUser(db, run.id, "u1").id, run.id);
});

test("lease: A wins, B loses, B wins after the TTL", () => {
  const db = memDb();
  const { run } = mkRun(db);
  assert.equal(store.acquireLease(db, run.id, "A", 90, 1000), true);
  assert.equal(store.acquireLease(db, run.id, "B", 90, 1010), false);
  assert.equal(store.acquireLease(db, run.id, "B", 90, 1200), true);
  assert.equal(store.releaseLease(db, run.id, "B"), true);
});

test("findDueRuns: paused only once resume_at has passed", () => {
  const db = memDb();
  const { run } = mkRun(db);
  store.updateRun(db, run.id, { status: "paused", resumeAt: 2000 });
  assert.deepEqual(store.findDueRuns(db, 1999), []);
  assert.deepEqual(store.findDueRuns(db, 2000), [run.id]);
});

test("a 20,000-byte result is stored as inline-truncated", () => {
  const db = memDb();
  const { run } = mkRun(db);
  const [s] = store.insertSteps(db, run.id, 1, [{ goal: "a" }]);
  store.updateStep(db, s.id, { result: { blob: "x".repeat(20000) }, resultSummary: { values: {}, text: "short" } });
  const got = store.getStep(db, s.id);
  assert.equal(got.resultRef, "inline-truncated");
  assert.deepEqual(got.result, { truncated: true, summary: "short" });
  store.updateStep(db, s.id, { result: { ok: 1 } });
  assert.equal(store.getStep(db, s.id).resultRef, "inline");
});

test("addUsage sums", () => {
  const db = memDb();
  const { run } = mkRun(db);
  store.addUsage(db, run.id, { toolCalls: 1, tokensIn: 100 });
  store.addUsage(db, run.id, { toolCalls: 2 });
  const u = store.getRun(db, run.id).usage;
  assert.equal(u.toolCalls, 3);
  assert.equal(u.tokensIn, 100);
});

test("findWaitingRun and countActiveRuns", () => {
  const db = memDb();
  const a = mkRun(db, { chatSessionId: "t1" }).run;
  const b = mkRun(db, { chatSessionId: "t1" }).run;
  store.updateRun(db, a.id, { status: "awaiting_confirm" });
  store.updateRun(db, b.id, { status: "done" });
  assert.equal(store.findWaitingRun(db, "u1", "t1").id, a.id);
  assert.equal(store.findWaitingRun(db, "u1", "other"), null);
  assert.equal(store.countActiveRuns(db, "u1"), 1);
});
