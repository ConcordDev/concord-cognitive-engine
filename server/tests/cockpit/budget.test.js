import test from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { tickRun, driveRun } from "../../lib/cockpit/engine.js";
import { checkBudget, budgetFromEnv, maxActiveRuns, retryAfterSec, raiseBudget } from "../../lib/cockpit/budget.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const base = (over = {}) => ({
  budget: { maxSteps: 60, maxToolCalls: 120, maxModelCalls: 150, maxTokensIn: 400000, wallMs: 3600000 },
  usage: { toolCalls: 0, modelCalls: 0, tokensIn: 0 }, createdAt: Math.floor(Date.now() / 1000), ...over,
});

test("each budget reason", () => {
  assert.deepEqual(checkBudget(base(), [], Date.now()), { ok: true });
  assert.equal(checkBudget(base({ budget: { ...base().budget, maxSteps: 1 } }), [{ status: "done" }]).reason, "steps");
  assert.equal(checkBudget(base({ usage: { toolCalls: 120 } }), []).reason, "tool_calls");
  assert.equal(checkBudget(base({ usage: { modelCalls: 150 } }), []).reason, "model_calls");
  assert.equal(checkBudget(base({ usage: { tokensIn: 400000 } }), []).reason, "tokens");
  assert.equal(checkBudget(base({ createdAt: 1 }), [], Date.now()).reason, "wall");
  assert.equal(checkBudget(base({ usage: { toolCalls: 120 } }), []).resumable, true);
});

test("env helpers", () => {
  assert.equal(maxActiveRuns({ CONCORD_COCKPIT_MAX_ACTIVE: "99" }), 10);
  assert.equal(maxActiveRuns({}), 2);
  assert.equal(maxActiveRuns({ CONCORD_COCKPIT_MAX_ACTIVE: "0" }), 2);
  assert.deepEqual(budgetFromEnv({ CONCORD_COCKPIT_MAX_STEPS: "9999", CONCORD_COCKPIT_MAX_TOOL_CALLS: "10" }), { maxSteps: 200, maxToolCalls: 10 });
  assert.equal(retryAfterSec({ retryAfter: 120 }), 120);
  assert.equal(retryAfterSec({ retry_after: 5 }), 30);
  assert.equal(retryAfterSec({}), 600);
});

test("raiseBudget grows an exhausted budget but not past the hard cap", () => {
  const r = raiseBudget(base({ usage: { toolCalls: 399 }, budget: { ...base().budget, maxToolCalls: 399 } }), 0, { maxSteps: 60, maxToolCalls: 120, maxModelCalls: 150, maxTokensIn: 400000, wallMs: 3600000 });
  assert.equal(r.maxToolCalls, 400);
});

function setup(table, steps = 1) {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, Array.from({ length: steps }, (_, i) => ({ id: `stp_${i + 1}`, goal: `s${i}`, tool: "web_search", args: { query: `q${i}` }, expects: [] })));
  const exec = fakeExec(table);
  const mock = createMockModel({ steps: {} });
  return { db, run, exec, deps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } };
}

test("a run paused on a budget does not advance", async () => {
  const t = setup({ web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }] }, 2);
  store.addUsage(t.db, t.run.id, { toolCalls: 120 });
  const r = await tickRun({ db: t.db, runId: t.run.id, owner: "A", deps: t.deps });
  assert.equal(r.advanced, false);
  const run = store.getRun(t.db, t.run.id);
  assert.equal(run.status, "paused");
  assert.equal(run.statusReason, "budget:tool_calls");
  const again = await tickRun({ db: t.db, runId: t.run.id, owner: "A", deps: t.deps });
  assert.equal(again.advanced, false);
  assert.equal(t.exec.calls.length, 0);
});

test("a rate limit pauses with resumeAt, the step stays ready, and it completes after the window", async () => {
  let n = 0;
  const t = setup({ web_search: () => (++n === 1 ? { tool: "web_search", ok: false, reason: "rate_limited", retryAfter: 120 } : { tool: "web_search", ok: true, result: { results: [1] } }) });
  await driveRun({ db: t.db, runId: t.run.id, owner: "A", deps: t.deps });
  const paused = store.getRun(t.db, t.run.id);
  assert.equal(paused.status, "paused");
  const soon = Math.floor(Date.now() / 1000);
  assert.ok(paused.resumeAt >= soon + 110 && paused.resumeAt <= soon + 130);
  assert.equal(store.listSteps(t.db, t.run.id)[0].status, "ready");
  const later = Date.now() + 200 * 1000;
  assert.deepEqual(store.findDueRuns(t.db, Math.floor(later / 1000)), [t.run.id]);
  await driveRun({ db: t.db, runId: t.run.id, owner: "A", deps: { ...t.deps, now: () => later } });
  assert.equal(store.getRun(t.db, t.run.id).status, "done");
});
