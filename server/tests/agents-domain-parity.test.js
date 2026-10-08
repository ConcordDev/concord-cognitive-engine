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

// A stub local LLM so LLM-backed steps (summarize/classify/text_generate)
// run for real against it; web_search/dtu_create have no runtime here and
// must fail honestly.
const llmCalls = [];
const stubLlm = { chat: async (opts) => { llmCalls.push(opts); return { content: `model output for: ${opts.messages.at(-1).content.slice(0, 40)}` }; } };
const ctxA = { actor: { userId: "agents_user_a" }, userId: "agents_user_a", llm: stubLlm };
const ctxB = { actor: { userId: "agents_user_b" }, userId: "agents_user_b" };

beforeEach(() => {
  // Fresh per-user runtime state for each test.
  globalThis._concordSTATE = { agentsLens: {}, dtus: new Map() };
  llmCalls.length = 0;
});

describe("agents — pure-compute macros", () => {
  it("evaluateCapability scores an agent from task history", async () => {
    const r = await call("evaluateCapability", ctxA, {}, {
      id: "a1", title: "Researcher",
      data: { name: "Researcher", skills: ["search", "summarize"], taskHistory: [
        { success: true, latencyMs: 1000 }, { success: false, latencyMs: 2000 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.capabilityScore === "number");
    assert.ok(["Elite", "Proficient", "Developing", "Novice"].includes(r.result.tier));
  });

  it("routeTask ranks agents by skill match", async () => {
    const r = await call("routeTask", ctxA, {}, {
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

  it("swarmStatus aggregates agent states", async () => {
    const r = await call("swarmStatus", ctxA, {}, {
      id: "a1", data: { agents: [
        { status: "active", tasksCompleted: 5 }, { status: "error" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAgents, 2);
    assert.equal(r.result.errored, 1);
  });

  it("benchmarkAgent grades performance metrics", async () => {
    const r = await call("benchmarkAgent", ctxA, {}, {
      id: "a1", title: "Bench",
      data: { metrics: { tasksPerMinute: 8, accuracy: 0.9, uptimePercent: 99, memoryMB: 256 } },
    });
    assert.equal(r.ok, true);
    assert.ok(["A", "B", "C", "D", "F"].includes(r.result.grade));
  });
});

describe("agents — autonomous run loop + tool inspector", () => {
  it("executeRun runs a real multi-step task and records steps", async () => {
    globalThis._concordSTATE.dtus.set("d1", { id: "d1", ownerId: "agents_user_a", title: "Quarterly revenue work", human: { summary: "Revenue rose 12%." } });
    globalThis._concordSTATE.dtus.set("d2", { id: "d2", ownerId: "someone_else", title: "Quarterly revenue secret", human: { summary: "x" } });
    const r = await call("executeRun", ctxA, { agentId: "ag1", agentName: "Runner", goal: "Review quarterly revenue work", maxSteps: 3 });
    assert.equal(r.ok, true);
    const [read, sum, cls] = r.result.run.steps;
    assert.equal(read.tool, "dtu_read");
    assert.equal(read.status, "ok");
    assert.deepEqual(read.output.dtus.map((d) => d.id), ["d1"], "only the caller's own DTUs are read");
    assert.equal(sum.status, "ok");
    assert.match(sum.output.text, /^model output for/);
    assert.match(llmCalls[0].messages[0].content, /Revenue rose 12%/, "later steps work from earlier step material");
    assert.equal(cls.status, "ok");
    assert.equal(r.result.run.status, "completed");
    assert.equal(r.result.run.tokensEstimated, true);
    for (const st of r.result.run.steps) assert.equal(typeof st.latencyMs, "number");
  });

  it("tools with no backing fail honestly instead of inventing output", async () => {
    const r = await call("executeRun", ctxA, { agentId: "ag1", goal: "Alert ops", tools: ["alert_send", "code_execute"], maxSteps: 2 });
    assert.equal(r.ok, true);
    for (const st of r.result.run.steps) {
      assert.equal(st.status, "not_connected");
      assert.equal(st.output, undefined);
      assert.equal(st.tokens, 0);
    }
    assert.equal(r.result.run.status, "failed");
  });

  it("LLM steps fail honestly when no model is available", async () => {
    const r = await call("executeRun", ctxB, { agentId: "ag1", goal: "x", tools: ["summarize"], maxSteps: 1 });
    assert.equal(r.result.run.steps[0].status, "error");
    assert.equal(r.result.run.steps[0].error, "llm_unavailable");
  });

  it("executeRun rejects missing agentId", async () => {
    const r = await call("executeRun", ctxA, { goal: "x" });
    assert.equal(r.ok, false);
  });

  it("listRuns returns the user's runs and getRunTrace yields a tree", async () => {
    const ex = await call("executeRun", ctxA, { agentId: "ag1", agentName: "Runner", goal: "Trace me" });
    assert.equal(ex.ok, true);
    const list = await call("listRuns", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.runs.length >= 1);
    const trace = await call("getRunTrace", ctxA, { runId: ex.result.run.id });
    assert.equal(trace.ok, true);
    assert.ok(Array.isArray(trace.result.tree.children));
  });

  it("getRunTrace rejects unknown runId", async () => {
    const r = await call("getRunTrace", ctxA, { runId: "nope" });
    assert.equal(r.ok, false);
  });

  it("runs are isolated per user", async () => {
    await call("executeRun", ctxA, { agentId: "ag1", goal: "A run" });
    const bList = await call("listRuns", ctxB, {});
    assert.equal(bList.result.runs.length, 0);
  });
});

describe("agents — orchestration graphs", () => {
  it("saveGraph + listGraphs + runGraph round-trip", async () => {
    const save = await call("saveGraph", ctxA, {
      name: "Crew",
      nodes: [
        { id: "n1", label: "Boss", role: "orchestrator" },
        { id: "n2", label: "Worker", role: "worker" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    assert.equal(save.ok, true);
    const list = await call("listGraphs", ctxA, {});
    assert.equal(list.result.graphs.length, 1);
    const run = await call("runGraph", ctxA, { graphId: save.result.graph.id, goal: "Ship it" });
    assert.equal(run.ok, true);
    assert.ok(run.result.orchestration.dispatched.length >= 1);
  });

  it("saveGraph rejects empty node list and deleteGraph removes", async () => {
    assert.equal((await call("saveGraph", ctxA, { name: "Empty", nodes: [] })).ok, false);
    const save = await call("saveGraph", ctxA, { name: "G", nodes: [{ id: "n1", label: "X" }] });
    const del = await call("deleteGraph", ctxA, { id: save.result.graph.id });
    assert.equal(del.ok, true);
  });
});

describe("agents — scheduled / triggered runs", () => {
  it("createSchedule + listSchedules + fireSchedule executes a run", async () => {
    const sch = await call("createSchedule", ctxA, { agentId: "ag1", agentName: "Sched", kind: "interval", spec: "60000", goal: "poll" });
    assert.equal(sch.ok, true);
    const list = await call("listSchedules", ctxA, {});
    assert.equal(list.result.schedules.length, 1);
    const fire = await call("fireSchedule", ctxA, { id: sch.result.schedule.id });
    assert.equal(fire.ok, true);
    assert.equal(fire.result.run.steps.length, 3);
    assert.ok(fire.result.run.steps.every((st) => st.status === "ok"));
    assert.equal(fire.result.schedule.fireCount, 1);
  });

  it("toggleSchedule disables and a disabled schedule cannot fire", async () => {
    const sch = await call("createSchedule", ctxA, { agentId: "ag1", kind: "webhook", spec: "/hook" });
    await call("toggleSchedule", ctxA, { id: sch.result.schedule.id });
    const fire = await call("fireSchedule", ctxA, { id: sch.result.schedule.id });
    assert.equal(fire.ok, false);
  });

  it("createSchedule rejects missing spec", async () => {
    assert.equal((await call("createSchedule", ctxA, { agentId: "ag1" })).ok, false);
  });
});

describe("agents — conversation threads", () => {
  it("postMessage creates a thread with a model reply and getThread reads it", async () => {
    const post = await call("postMessage", ctxA, { agentId: "ag1", agentName: "Chatty", text: "Hello" });
    assert.equal(post.ok, true);
    assert.equal(post.result.thread.messages.length, 2);
    assert.equal(post.result.replied, true);
    assert.match(post.result.thread.messages[1].text, /^model output for/);
    const get = await call("getThread", ctxA, { agentId: "ag1" });
    assert.equal(get.result.thread.messages.length, 2);
  });

  it("with no model there is no fabricated reply, and guidance reaches the next run", async () => {
    const ctxNoLlm = { actor: { userId: "agents_user_a" }, userId: "agents_user_a" };
    const post = await call("postMessage", ctxNoLlm, { agentId: "ag1", text: "Focus on churn" });
    assert.equal(post.result.replied, false);
    assert.equal(post.result.thread.messages.length, 1);
    await call("executeRun", ctxA, { agentId: "ag1", goal: "Report", tools: ["summarize"], maxSteps: 1 });
    assert.match(llmCalls.at(-1).system, /Focus on churn/);
  });

  it("clearThread empties the thread", async () => {
    await call("postMessage", ctxA, { agentId: "ag1", text: "hi" });
    const cleared = await call("clearThread", ctxA, { agentId: "ag1" });
    assert.equal(cleared.ok, true);
    const get = await call("getThread", ctxA, { agentId: "ag1" });
    assert.equal(get.result.thread.messages.length, 0);
  });

  it("postMessage rejects empty text", async () => {
    assert.equal((await call("postMessage", ctxA, { agentId: "ag1", text: "" })).ok, false);
  });
});

describe("agents — cost / token budgets", () => {
  it("setBudget + getBudget reports usage and enforcement", async () => {
    const set = await call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 10000, costPer1k: 3, enforce: true });
    assert.equal(set.ok, true);
    const get = await call("getBudget", ctxA, { agentId: "ag1" });
    assert.equal(get.result.budget.tokenLimit, 10000);
    assert.equal(get.result.remaining, 10000);
  });

  it("executeRun spends against a budget and resetBudget clears usage", async () => {
    await call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 100000, enforce: true });
    await call("executeRun", ctxA, { agentId: "ag1", goal: "spend" });
    let get = await call("getBudget", ctxA, { agentId: "ag1" });
    assert.ok(get.result.budget.tokensUsed > 0);
    const reset = await call("resetBudget", ctxA, { agentId: "ag1" });
    assert.equal(reset.ok, true);
    get = await call("getBudget", ctxA, { agentId: "ag1" });
    assert.equal(get.result.budget.tokensUsed, 0);
  });

  it("a tight enforced budget halts a run", async () => {
    await call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 1, enforce: true });
    const r = await call("executeRun", ctxA, { agentId: "ag1", goal: "halt", maxSteps: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.status, "halted");
    assert.equal(r.result.run.stoppedReason, "token_budget_exceeded");
  });

  it("setBudget rejects non-positive limit", async () => {
    assert.equal((await call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 0 })).ok, false);
  });
});

describe("agents — templates / marketplace import", () => {
  it("listTemplates returns the catalog", async () => {
    const r = await call("listTemplates", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.length >= 5);
  });

  it("importTemplate produces a fully-formed agent definition", async () => {
    const list = await call("listTemplates", ctxA, {});
    const tplId = list.result.templates[0].id;
    const r = await call("importTemplate", ctxA, { templateId: tplId });
    assert.equal(r.ok, true);
    assert.ok(r.result.agentDefinition.name);
    assert.ok(Array.isArray(r.result.agentDefinition.tools));
    assert.equal(r.result.agentDefinition.status, "dormant");
  });

  it("importTemplate rejects unknown templateId", async () => {
    assert.equal((await call("importTemplate", ctxA, { templateId: "nope" })).ok, false);
  });
});

describe("agents — runtime overview", () => {
  it("runtimeOverview aggregates runs, schedules, graphs and budgets", async () => {
    await call("executeRun", ctxA, { agentId: "ag1", goal: "work" });
    await call("createSchedule", ctxA, { agentId: "ag1", kind: "interval", spec: "60000" });
    await call("saveGraph", ctxA, { name: "G", nodes: [{ id: "n1", label: "X" }] });
    await call("setBudget", ctxA, { agentId: "ag1", tokenLimit: 10000 });
    const r = await call("runtimeOverview", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRuns, 1);
    assert.equal(r.result.totalSchedules, 1);
    assert.equal(r.result.graphCount, 1);
    assert.equal(r.result.budgetedAgents, 1);
  });
});
