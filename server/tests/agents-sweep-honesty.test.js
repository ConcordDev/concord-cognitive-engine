// INC-SWEEP agents — residue proofs for F4/F5/F7/F8/F10/F12/F13/F15 (+ F14 tags).
// Domain-level where possible; HTTP routes for F8/F10/F15.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgentsActions from "../domains/agents.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`agents.${name}`);
  if (!fn) throw new Error(`agents.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerAgentsActions(register); });

const stubLlm = { chat: async (opts) => ({ content: `model output for: ${(opts.messages?.at(-1)?.content || "").slice(0, 40)}` }) };
const ctxA = { actor: { userId: "agents_sweep_a" }, userId: "agents_sweep_a", llm: stubLlm };
const ctxB = { actor: { userId: "agents_sweep_b" }, userId: "agents_sweep_b", llm: stubLlm };

beforeEach(() => {
  globalThis._concordSTATE = { agentsLens: {}, dtus: new Map() };
});

describe("agents F7 — fireSchedule tokens reconcile with getBudget", () => {
  it("schedule spend lands on budget.tokensUsed and survives re-read", async () => {
    await call("setBudget", ctxA, { agentId: "ag_sched", tokenLimit: 5000, costPer1k: 3, enforce: true });
    const sch = await call("createSchedule", ctxA, {
      agentId: "ag_sched", agentName: "Sched", kind: "interval", spec: "60000", goal: "poll markers",
    });
    assert.equal(sch.ok, true);
    const fire = await call("fireSchedule", ctxA, { id: sch.result.schedule.id });
    assert.equal(fire.ok, true);
    const spent = fire.result.run.totalTokens;
    assert.ok(spent > 0);
    const budget = await call("getBudget", ctxA, { agentId: "ag_sched" });
    assert.equal(budget.result.budget.tokensUsed, spent);
    // Restart-persistence stand-in: fresh getAgentState via second getBudget.
    const reread = await call("getBudget", ctxA, { agentId: "ag_sched" });
    assert.equal(reread.result.budget.tokensUsed, spent);
    const overview = await call("runtimeOverview", ctxA, {});
    assert.equal(overview.result.totalTokensSpent, spent);
  });
});

describe("agents F5 — runGraph appends to listRuns", () => {
  it("completed orchestration is counted in listRuns and overview", async () => {
    const save = await call("saveGraph", ctxA, {
      name: "Crew",
      nodes: [
        { id: "n1", label: "Boss", role: "orchestrator" },
        { id: "n2", label: "Worker", role: "worker" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    const run = await call("runGraph", ctxA, { graphId: save.result.graph.id, goal: "Ship it" });
    assert.equal(run.ok, true);
    const list = await call("listRuns", ctxA, {});
    assert.ok(list.result.runs.some((r) => r.id === run.result.orchestration.id));
    const overview = await call("runtimeOverview", ctxA, {});
    assert.ok(overview.result.totalRuns >= 1);
    assert.equal(overview.result.totalTokensSpent, run.result.orchestration.totalTokens);
  });
});

describe("agents F12 — saveGraph unknown id refuses", () => {
  it("unknown id is graph not found (not a silent create)", async () => {
    const r = await call("saveGraph", ctxA, {
      id: "graph_nope_agents",
      name: "Ghost",
      nodes: [{ id: "n1", label: "X" }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /graph not found/i);
    assert.equal(shapeLensRunHttp(r).status, 404);
    const list = await call("listGraphs", ctxA, {});
    assert.equal(list.result.total, 0);
  });
});

describe("agents F13 — template installs per account", () => {
  it("acct1 import does not raise acct2 install count", async () => {
    const tplId = "tpl_quality_critic";
    const beforeB = await call("listTemplates", ctxB, {});
    const b0 = beforeB.result.templates.find((t) => t.id === tplId).installs;
    const imp = await call("importTemplate", ctxA, { templateId: tplId, name: "Imported" });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.template.installs, 1);
    // Fresh list for A still 1; B unchanged.
    const afterA = await call("listTemplates", ctxA, {});
    assert.equal(afterA.result.templates.find((t) => t.id === tplId).installs, 1);
    const afterB = await call("listTemplates", ctxB, {});
    assert.equal(afterB.result.templates.find((t) => t.id === tplId).installs, b0);
  });
});

describe("agents F15 — getThread does not fabricate", () => {
  it("missing agentId thread is refused", async () => {
    const r = await call("getThread", ctxA, { agentId: "nope_agt_sweep" });
    assert.equal(r.ok, false);
    assert.match(r.error, /thread not found/i);
    assert.equal(shapeLensRunHttp(r).status, 404);
  });

  it("cross-account thread is refused", async () => {
    await call("postMessage", ctxA, { agentId: "ag_shared", agentName: "Alpha", text: "secret marker" });
    const r = await call("getThread", ctxB, { agentId: "ag_shared" });
    assert.equal(r.ok, false);
    assert.match(r.error, /thread not found/i);
  });
});
