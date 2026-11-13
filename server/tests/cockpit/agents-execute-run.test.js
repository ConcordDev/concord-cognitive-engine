import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import { runAgentOnCore } from "../../lib/cockpit/agents-run.js";
import { planRun } from "../../lib/cockpit/planner.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const saved = process.env.CONCORD_COCKPIT_RUNS;
before(() => { process.env.CONCORD_COCKPIT_RUNS = "1"; });
after(() => { if (saved === undefined) delete process.env.CONCORD_COCKPIT_RUNS; else process.env.CONCORD_COCKPIT_RUNS = saved; });

const st = (i, tool, goal) => ({ key: `s${i}`, goal, tool, args: null, expects: [], dependsOn: [], required: true });

test("a tool-less agent plans one step with no tool", async () => {
  const r = await planRun({ db: memDb(), userId: "u1", goal: "write me a haiku", profile: "local-2b", lensActions: new Map(), allowTools: [] });
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].tool, null);
});

test("goal-shaped steps with different goals run in order", async () => {
  const db = memDb();
  const exec = fakeExec({ dtu_read: [{ tool: "dtu_read", ok: true, result: { title: "Beams", total: 1 } }], summarize: [{ tool: "summarize", ok: true, result: { text: "Beams carry load." } }] });
  const mock = createMockModel({ steps: {} });
  const r = await runAgentOnCore({
    db, userId: "u1", goal: "summarize my notes on beams", allowTools: ["dtu_read", "summarize"], maxSteps: 5,
    runMacro: async () => ({ ok: true }), lensActions: new Map(),
    deps: { planRun: async () => ({ ok: true, source: "template", steps: [st(1, "dtu_read", "read my notes on beams"), st(2, "summarize", "summarize what was read")] }), engineDeps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } },
  });
  assert.ok(r.cockpitRunId);
  assert.equal(r.steps.length, 2);
  assert.notEqual(r.steps[0].input, r.steps[1].input);
  assert.equal(r.steps[0].tool, "dtu_read");
  assert.ok(!r.steps.some((s) => s.tool === "classify"));
});

test("maxSteps caps the plan", async () => {
  const db = memDb();
  const exec = fakeExec({ dtu_read: [{ tool: "dtu_read", ok: true, result: { total: 1 } }] });
  const mock = createMockModel({ steps: {} });
  const r = await runAgentOnCore({
    db, userId: "u1", goal: "read a lot", allowTools: ["dtu_read"], maxSteps: 2,
    runMacro: async () => ({ ok: true }), lensActions: new Map(),
    deps: { planRun: async () => ({ ok: true, source: "template", steps: [1, 2, 3, 4].map((i) => st(i, "dtu_read", `read ${i}`)) }), engineDeps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } },
  });
  assert.ok(r.steps.length <= 2);
});
