// Contract tests for server/domains/agents.js — the agent runtime:
// autonomous run loop, tool-call inspector, orchestration graphs,
// scheduled/triggered runs, conversation threads, cost/token budgets,
// and template-marketplace import. Pure-compute macros also covered.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgentsActions from "../domains/agents.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`agents.${name}`);
  if (!fn) throw new Error(`agents.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerAgentsActions(register); });

const ctxA = { actor: { userId: "agents_user_a" }, userId: "agents_user_a" };
const ctxB = { actor: { userId: "agents_user_b" }, userId: "agents_user_b" };

beforeEach(() => {
  // Fresh per-user runtime state for each test.
  globalThis._concordSTATE = { agentsLens: {} };
});

describe("agents — pure-compute macros", () => {
  it("evaluateCapability scores an agent from task history", () => {
    const r = call("evaluateCapability", ctxA, {}, {
      id: "a1", title: "Researcher",
      data: { name: "Researcher", skills: ["search", "summarize"], taskHistory: [
        { success: true, latencyMs: 1000 }, { success: false, latencyMs: 2000 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.capabilityScore === "number");
    assert.ok(["Elite", "Proficient", "Developing", "Novice"].includes(r.result.tier));
  });

  it("routeTask ranks agents by skill match", () => {
    const r = call("routeTask", ctxA, {}, {
      id: "a1", data: {
        task: { name: "Summarize", requiredSkills: ["summarize"] },
        agents: [
          { name: "A", skills: ["summarize"], reliability: 0.9 },
          { name: "B", skills: ["paint"], reliability: 0.5 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.bestAgent, "A");
  });

  it("swarmStatus aggregates agent states", () => {
    const r = call("swarmStatus", ctxA, {}, {
      id: "a1", data: { agents: [
        { status: "active", tasksCompleted: 5 }, { status: "error" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAgents, 2);
    assert.equal(r.result.errored, 1);
  });

  it("benchmarkAgent grades performance metrics", () => {
    const r = call("benchmarkAgent", ctxA, {}, {
      id: "a1", title: "Bench",
      data: { metrics: { tasksPerMinute: 8, accuracy: 0.9, uptimePercent: 99, memoryMB: 256 } },
    });
    assert.equal(r.ok, true);
    assert.ok(["A", "B", "C", "D", "F"].includes(r.result.grade));
  });
});

describe("agents — autonomous run loop + tool inspector", () => {
  it("executeRun runs a real multi-step task and records steps", () => {
    const r = call("executeRun", ctxA, { agentId: "ag1", agentName: "Runner", goal: "Do work", maxSteps: 5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.run.steps.length >= 1);
    assert.ok(r.result.run.totalTokens > 0);
    for (const st of r.result.run.steps) {
      assert.ok(st.tool && st.output && typeof st.tokens === "number");
    }
  });

  it("executeRun rejects missing agentId", () => {
    const r = call("executeRun", ctxA, { goal: "x" });
    assert.equal(r.ok, false);
  });

  it("listRuns returns the user's runs and getRunTrace yields a tree", () => {
    const ex = call("executeRun", ctxA, { agentId: "ag1", agentName: "Runner", goal: "Trace me" });
    assert.equal(ex.ok, true);
    const list = call("listRuns", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.runs.length >= 1);
    const trace = call("getRunTrace", ctxA, { runId: ex.result.run.id });
    assert.equal(trace.ok, true);
    assert.ok(Array.isArray(trace.result.tree.children));
  });

  it("getRunTrace rejects unknown runId", () => {
    const r = call("getRunTrace", ctxA, { runId: "nope" });
    assert.equal(r.ok, false);
  });

  it("runs are isolated per user", () => {
    call("executeRun", ctxA, { agentId: "ag1", goal: "A run" });
    const bList = call("listRuns", ctxB, {});
    assert.equal(bList.result.runs.length, 0);
  });
});

describe("agents — orchestration graphs", () => {
  it("saveGraph + listGraphs + runGraph round-trip", () => {
    const save = call("saveGraph", ctxA, {
      name: "Crew",
      nodes: [
        { id: "n1", label: "Boss", role: "orchestrator" },
        { id: "n2", label: "Worker", role: "worker" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    assert.equal(save.ok, true);
    const list = call("listGraphs", ctxA, {});
    assert.equal(list.result.graphs.length, 1);
    const run = call("runGraph", ctxA, { graphId: save.result.graph.id, goal: "Ship it" });
    assert.equal(run.ok, true);
    assert.ok(run.result.orchestration.dispatched.length >= 1);
  });

  it("saveGraph rejects empty node list and deleteGraph removes", () => {
    assert.equal(call("saveGraph", ctxA, { name: "Empty", nodes: [] }).ok, false);
    const save = call("saveGraph", ctxA, { name: "G", nodes: [{ id: "n1", label: "X" }] });
    const del = call("deleteGraph", ctxA, { id: save.result.graph.id });
    assert.equal(del.ok, true);
  });
});

describe("agents — scheduled / triggered runs", () => {
  it("createSchedule + listSchedules + fireSchedule executes a run", () => {
    const sch = call("createSchedule", ctxA, { agentId: "ag1", agentName: "Sched", kind: "interval", spec: "60000", goal: "poll" });
    assert.equal(sch.ok, true);
    const list = call("listSchedules", ctxA, {});
    assert.equal(list.result.schedules.length, 1);
    const fire = call("fireSchedule", ctxA, { id: sch.result.schedule.id });
    assert.equal(fire.ok, true);
    assert.ok(fire.result.run.steps.length === 4);
    assert.equal(fire.result.schedule.fireCount, 1);
  });

  it("toggleSchedule disables and a disabled schedule cannot fire", () => {
    const sch = call("createSchedule", ctxA, { agentId: "ag1", kind: "webhook", spec: "/hook" });
    call("toggleSchedule", ctxA, { id: sch.result.schedule.id });
    const fire = call("fireSchedule", ctxA, { id: sch.result.schedule.id });
    assert.equal(fire.ok, false);
  });

  it("createSchedule rejects missing spec", () => {
    assert.equal(call("createSchedule", ctxA, { agentId: "ag1" }).ok, false);
  });
});

describe("agents — conversation threads", () => {
  it("postMessage creates a thread with a reply and getThread reads it", () => {
    const post = call("postMessage", ctxA, { agentId: "ag1", agentName: "Chatty", text: "Hello" });
    assert.equal(post.ok, true);
    assert.equal(post.result.thread.messages.length, 2);
    const get = call("getThread", ctxA, { agentId: "ag1" });
    assert.equal(get.result.thread.messages.length, 2);
  });

  it("clearThread empties the thread", () => {
    call("postMessage", ctxA, { agentId: "ag1", text: "hi" });
    const cleared = call("clearThread", ctxA, { agentId: "ag1" });
    assert.equal(cleared.ok, true);
    const get = call("getThread", ctxA, { agentId: "ag1" });
    assert.equal(get.result.thread.messages.length, 0);
  });

  it("postMessage rejects empty text", () => {
    assert.equal(call("postMessage", ctxA, { agentId: "ag1", text: "" }).ok, false);
  });
});

describe("agents — cost / token budgets", () => {
  it("setBudget + getBudget reports usage and enforcement", () => {
    const set = call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 10000, costPer1k: 3, enforce: true });
    assert.equal(set.ok, true);
    const get = call("getBudget", ctxA, { agentId: "ag1" });
    assert.equal(get.result.budget.tokenLimit, 10000);
    assert.equal(get.result.remaining, 10000);
  });

  it("executeRun spends against a budget and resetBudget clears usage", () => {
    call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 100000, enforce: true });
    call("executeRun", ctxA, { agentId: "ag1", goal: "spend" });
    let get = call("getBudget", ctxA, { agentId: "ag1" });
    assert.ok(get.result.budget.tokensUsed > 0);
    const reset = call("resetBudget", ctxA, { agentId: "ag1" });
    assert.equal(reset.ok, true);
    get = call("getBudget", ctxA, { agentId: "ag1" });
    assert.equal(get.result.budget.tokensUsed, 0);
  });

  it("a tight enforced budget halts a run", () => {
    call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 1, enforce: true });
    const r = call("executeRun", ctxA, { agentId: "ag1", goal: "halt", maxSteps: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.status, "halted");
    assert.equal(r.result.run.stoppedReason, "token_budget_exceeded");
  });

  it("setBudget rejects non-positive limit", () => {
    assert.equal(call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 0 }).ok, false);
  });
});

describe("agents — templates / marketplace import", () => {
  it("listTemplates returns the catalog", () => {
    const r = call("listTemplates", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.length >= 5);
  });

  it("importTemplate produces a fully-formed agent definition", () => {
    const list = call("listTemplates", ctxA, {});
    const tplId = list.result.templates[0].id;
    const r = call("importTemplate", ctxA, { templateId: tplId });
    assert.equal(r.ok, true);
    assert.ok(r.result.agentDefinition.name);
    assert.ok(Array.isArray(r.result.agentDefinition.tools));
    assert.equal(r.result.agentDefinition.status, "dormant");
  });

  it("importTemplate rejects unknown templateId", () => {
    assert.equal(call("importTemplate", ctxA, { templateId: "nope" }).ok, false);
  });
});

describe("agents — runtime overview", () => {
  it("runtimeOverview aggregates runs, schedules, graphs and budgets", () => {
    call("executeRun", ctxA, { agentId: "ag1", goal: "work" });
    call("createSchedule", ctxA, { agentId: "ag1", kind: "interval", spec: "60000" });
    call("saveGraph", ctxA, { name: "G", nodes: [{ id: "n1", label: "X" }] });
    call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 10000 });
    const r = call("runtimeOverview", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRuns, 1);
    assert.equal(r.result.totalSchedules, 1);
    assert.equal(r.result.graphCount, 1);
    assert.equal(r.result.budgetedAgents, 1);
  });
});
