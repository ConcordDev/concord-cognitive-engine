// server/tests/browser-agent-ai.test.js
//
// Tier-2 contract tests for Sprint B AI surface.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerBrowserAgentMacros from "../domains/browser-agent.js";
import registerBrowserAgentAiMacros from "../domains/browser-agent-ai.js";
import { deterministicPlan } from "../lib/browser-agent/ai-helpers.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["220_browser_agent", "221_browser_agent_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerBrowserAgentMacros(register);
  registerBrowserAgentAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_ai", llm = null) { return { db, actor: { userId }, llm }; }
async function makeTask(userId, title, goal) {
  const r = await MACROS.get("task_create")(ctx(userId), { title, goal });
  return r.id;
}

describe("deterministicPlan", () => {
  it("produces 4 steps from a goal", () => {
    const p = deterministicPlan("scrape Hacker News");
    assert.equal(p.length, 4);
    assert.equal(p[0].action, "navigate");
  });
  it("returns null for empty goal", () => {
    assert.equal(deterministicPlan(""), null);
  });
});

describe("ai_compose_plan", () => {
  it("falls back to deterministic plan without LLM", async () => {
    const tid = await makeTask("u_p1", "Plan test", "Just plan this");
    const r = await MACROS.get("ai_compose_plan")(ctx("u_p1"), { taskId: tid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic");
    assert.ok(r.steps.length >= 3);
    assert.equal(r.revision, 1);
  });

  it("uses LLM JSON when available + supersedes prior pending plan", async () => {
    const tid = await makeTask("u_p2", "Plan test", "Plan with LLM");
    const llm = { chat: async () => ({ content: '[{"step":1,"action":"navigate","expected":"go to site"}]' }) };
    const r1 = await MACROS.get("ai_compose_plan")(ctx("u_p2"), { taskId: tid });
    assert.equal(r1.revision, 1);
    const r2 = await MACROS.get("ai_compose_plan")({ db, actor: { userId: "u_p2" }, llm }, { taskId: tid });
    assert.equal(r2.source, "llm");
    assert.equal(r2.revision, 2);
    const list = await MACROS.get("plan_list")(ctx("u_p2"), { taskId: tid });
    const prior = list.plans.find((p) => p.revision === 1);
    assert.equal(prior.status, "superseded");
  });

  it("forbidden for other users", async () => {
    const tid = await makeTask("u_owner_p", "T", "g");
    const r = await MACROS.get("ai_compose_plan")(ctx("u_thief"), { taskId: tid });
    assert.equal(r.ok, false); assert.equal(r.reason, "not_found");
  });
});

describe("plan_decide", () => {
  it("approve transitions task to running", async () => {
    const tid = await makeTask("u_d1", "T", "g");
    const plan = await MACROS.get("ai_compose_plan")(ctx("u_d1"), { taskId: tid });
    const r = await MACROS.get("plan_decide")(ctx("u_d1"), { planId: plan.planId, decision: "approved" });
    assert.equal(r.ok, true);
    const t = await MACROS.get("task_get")(ctx("u_d1"), { id: tid });
    assert.equal(t.task.status, "running");
  });

  it("reject cancels the task", async () => {
    const tid = await makeTask("u_d2", "T", "g");
    const plan = await MACROS.get("ai_compose_plan")(ctx("u_d2"), { taskId: tid });
    await MACROS.get("plan_decide")(ctx("u_d2"), { planId: plan.planId, decision: "rejected" });
    const t = await MACROS.get("task_get")(ctx("u_d2"), { id: tid });
    assert.equal(t.task.status, "cancelled");
  });

  it("already_decided guard prevents double-approve", async () => {
    const tid = await makeTask("u_d3", "T", "g");
    const plan = await MACROS.get("ai_compose_plan")(ctx("u_d3"), { taskId: tid });
    await MACROS.get("plan_decide")(ctx("u_d3"), { planId: plan.planId, decision: "approved" });
    const second = await MACROS.get("plan_decide")(ctx("u_d3"), { planId: plan.planId, decision: "rejected" });
    assert.equal(second.ok, false); assert.equal(second.reason, "already_decided");
  });
});

describe("ai_voice_task", () => {
  it("fallback path creates a task from raw transcript", async () => {
    const r = await MACROS.get("ai_voice_task")(ctx("u_v1"), { transcript: "Look up the latest Bitcoin price and tell me" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.created?.id);
    assert.ok(r.spec.goal.includes("Bitcoin"));
  });

  it("LLM path parses structured spec", async () => {
    const llm = { chat: async () => ({ content: '{"title":"BTC price","goal":"check coinbase","approvalMode":"destructive_only","maxSteps":5}' }) };
    const r = await MACROS.get("ai_voice_task")({ db, actor: { userId: "u_v2" }, llm }, { transcript: "raw" });
    assert.equal(r.source, "llm");
    assert.equal(r.spec.title, "BTC price");
  });

  it("autoCreate=false returns spec without creating", async () => {
    const r = await MACROS.get("ai_voice_task")(ctx("u_v3"), { transcript: "do X", autoCreate: false });
    assert.equal(r.created, null);
    assert.ok(r.spec);
  });

  it("requires transcript", async () => {
    const r = await MACROS.get("ai_voice_task")(ctx("u_v4"), {});
    assert.equal(r.ok, false); assert.equal(r.reason, "transcript_required");
  });
});

describe("ai_run_step", () => {
  it("requires task in running status", async () => {
    const tid = await makeTask("u_s1", "T", "g");
    const r = await MACROS.get("ai_run_step")(ctx("u_s1"), { taskId: tid });
    assert.equal(r.ok, false); assert.equal(r.reason, "not_running");
  });

  it("deterministic step records action from plan when no LLM", async () => {
    const tid = await makeTask("u_s2", "T", "g");
    const plan = await MACROS.get("ai_compose_plan")(ctx("u_s2"), { taskId: tid });
    await MACROS.get("plan_decide")(ctx("u_s2"), { planId: plan.planId, decision: "approved" });
    const r = await MACROS.get("ai_run_step")(ctx("u_s2"), { taskId: tid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic");
    assert.equal(r.stepIndex, 0);
  });

  it("LLM 'complete' action transitions to completed", async () => {
    const tid = await makeTask("u_s3", "T", "g");
    const plan = await MACROS.get("ai_compose_plan")(ctx("u_s3"), { taskId: tid });
    await MACROS.get("plan_decide")(ctx("u_s3"), { planId: plan.planId, decision: "approved" });
    const llm = { chat: async () => ({ content: '{"kind":"complete","thought":"all done"}' }) };
    const r = await MACROS.get("ai_run_step")({ db, actor: { userId: "u_s3" }, llm }, { taskId: tid });
    assert.equal(r.completed, true);
    const t = await MACROS.get("task_get")(ctx("u_s3"), { id: tid });
    assert.equal(t.task.status, "completed");
  });
});

describe("ai_summarize_run", () => {
  it("fallback produces summary string + writes to result_summary", async () => {
    const tid = await makeTask("u_sum", "T", "g");
    const r = await MACROS.get("ai_summarize_run")(ctx("u_sum"), { taskId: tid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    const t = await MACROS.get("task_get")(ctx("u_sum"), { id: tid });
    assert.ok(t.task.result_summary?.includes("T"));
  });
});

describe("cost_dashboard", () => {
  it("returns totals + byTask + byDay + byKind shapes", async () => {
    const tid = await makeTask("u_cd", "T", "g");
    await MACROS.get("action_record")(ctx("u_cd"), { taskId: tid, action: { kind: "navigate", url: "https://x.com" } });
    const r = await MACROS.get("cost_dashboard")(ctx("u_cd"));
    assert.equal(r.ok, true);
    assert.ok(typeof r.totals.cents === "number");
    assert.ok(Array.isArray(r.byTask));
    assert.ok(Array.isArray(r.byDay));
    assert.ok(Array.isArray(r.byKind));
  });
});

describe("ai_reschedule (Devin-style 'keep doing it')", () => {
  it("re-queues a completed task as a fresh one", async () => {
    const tid = await makeTask("u_rsc", "Original", "Run me again");
    // Force the original to completed
    await MACROS.get("task_complete")(ctx("u_rsc"), { id: tid, summary: "done" });
    const r = await MACROS.get("ai_reschedule")(ctx("u_rsc"), { taskId: tid });
    assert.equal(r.ok, true);
    assert.notEqual(r.id, tid);
    assert.equal(r.source, tid);
  });

  it("refuses to reschedule an in-flight task", async () => {
    const tid = await makeTask("u_rsc2", "Active", "g");
    const r = await MACROS.get("ai_reschedule")(ctx("u_rsc2"), { taskId: tid });
    assert.equal(r.ok, false); assert.equal(r.reason, "task_not_finished");
  });
});

describe("ai_runs_recent ledger", () => {
  it("writes after compose_plan + reads back", async () => {
    const tid = await makeTask("u_led", "T", "g");
    await MACROS.get("ai_compose_plan")(ctx("u_led"), { taskId: tid });
    const r = await MACROS.get("ai_runs_recent")(ctx("u_led"));
    assert.ok(r.runs.length >= 1);
    assert.equal(r.runs[0].kind, "compose_plan");
  });

  it("scoped by user + optionally by task", async () => {
    const tid = await makeTask("u_led2", "T", "g");
    await MACROS.get("ai_compose_plan")(ctx("u_led2"), { taskId: tid });
    const tonly = await MACROS.get("ai_runs_recent")(ctx("u_led2"), { taskId: tid });
    assert.ok(tonly.runs.every((r) => r.task_id === tid));
  });
});
