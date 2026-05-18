// server/tests/tasks-ai.test.js
//
// Tier-2 contract tests for the 8 Sprint B AI macros + triage rules
// + run ledger. We exercise the deterministic fallback paths + the
// LLM happy-path with a stub brain so tests run without Ollama.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerTasksMacros from "../domains/tasks.js";
import registerTasksAiMacros from "../domains/tasks-ai.js";
import { heuristicPriorityScore } from "../lib/tasks/ai-helpers.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["214_tasks", "215_tasks_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerTasksMacros(register);
  registerTasksAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_ai", llm = null) { return { db, actor: { userId }, llm }; }
async function makeProject(userId, key) {
  return (await MACROS.get("project_create")(ctx(userId), { key, name: key })).id;
}
async function makeTask(userId, projectId, title, extras = {}) {
  return (await MACROS.get("task_create")(ctx(userId), { projectId, title, ...extras })).id;
}

describe("heuristicPriorityScore", () => {
  it("boosts urgent priority + overdue + bug labels", () => {
    const now = 1_000_000;
    const urgent = heuristicPriorityScore({ priority: "urgent", due_at: now - 86400, labels: ["bug","urgent"], type: "bug" }, now);
    const sleepy = heuristicPriorityScore({ priority: "low", due_at: now + 30 * 86400, labels: [], type: "spike" }, now);
    assert.ok(urgent > sleepy + 40, `urgent=${urgent} sleepy=${sleepy}`);
    assert.ok(urgent <= 100);
    assert.ok(sleepy >= 0);
  });
});

describe("tasks-ai: fallback envelope shapes", () => {
  it("ai_compose_plan returns fallback plan structure without LLM", async () => {
    const pid = await makeProject("u_p", "PLN");
    const r = await MACROS.get("ai_compose_plan")(ctx("u_p"), { projectId: pid, goal: "Ship the docs lens" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(Array.isArray(r.plan.milestones));
  });

  it("ai_breakdown returns llm_unavailable without LLM", async () => {
    const pid = await makeProject("u_bd", "BRK");
    const tid = await makeTask("u_bd", pid, "Epic");
    const r = await MACROS.get("ai_breakdown")(ctx("u_bd"), { taskId: tid });
    assert.equal(r.ok, false); assert.equal(r.reason, "llm_unavailable");
  });

  it("ai_prioritize falls back to heuristic when no LLM", async () => {
    const pid = await makeProject("u_pri", "PRI");
    await makeTask("u_pri", pid, "Urgent bug", { priority: "urgent", labels: ["bug"] });
    await makeTask("u_pri", pid, "Low note", { priority: "low" });
    const r = await MACROS.get("ai_prioritize")(ctx("u_pri"), { projectId: pid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "deterministic");
    assert.equal(r.ranked[0].title, "Urgent bug");
  });

  it("ai_standup returns fallback summary without LLM", async () => {
    const pid = await makeProject("u_st", "STD");
    await makeTask("u_st", pid, "Open task", { assigneeId: "u_st" });
    const r = await MACROS.get("ai_standup")(ctx("u_st"), { projectId: pid });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.standup.includes("Open"));
  });

  it("ai_voice_to_task split-on-period fallback creates tasks", async () => {
    const pid = await makeProject("u_v", "VOC");
    const r = await MACROS.get("ai_voice_to_task")(ctx("u_v"), {
      projectId: pid,
      transcript: "Fix the login bug. Update onboarding copy. Ship the dashboard refresh.",
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.proposals.length >= 3);
    assert.ok(r.created.length >= 3);
  });

  it("ai_tone_polish returns text unchanged without LLM", async () => {
    const r = await MACROS.get("ai_tone_polish")(ctx("u_t"), { text: "Original text" });
    assert.equal(r.ok, true);
    assert.equal(r.polished, "Original text");
    assert.equal(r.source, "fallback");
  });
});

describe("tasks-ai: required-field validation", () => {
  it("ai_compose_plan requires goal", async () => {
    const pid = await makeProject("u_g", "GLE");
    const r = await MACROS.get("ai_compose_plan")(ctx("u_g"), { projectId: pid });
    assert.equal(r.reason, "goal_required");
  });
  it("ai_voice_to_task requires transcript", async () => {
    const pid = await makeProject("u_g2", "GLT");
    const r = await MACROS.get("ai_voice_to_task")(ctx("u_g2"), { projectId: pid });
    assert.equal(r.reason, "transcript_required");
  });
  it("ai_tone_polish requires text", async () => {
    const r = await MACROS.get("ai_tone_polish")(ctx("u_g3"), {});
    assert.equal(r.reason, "text_required");
  });
});

describe("tasks-ai: LLM happy path with stub brain", () => {
  it("ai_compose_plan returns plan when LLM emits valid JSON", async () => {
    const pid = await makeProject("u_llm", "PLN2");
    const llm = { chat: async () => ({ content: '{"milestones":[{"name":"M1","description":"x","taskTitles":["T1","T2"]}],"risks":["R1"],"totalEstimateHours":40}' }) };
    const r = await MACROS.get("ai_compose_plan")({ db, actor: { userId: "u_llm" }, llm }, { projectId: pid, goal: "Test" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "llm");
    assert.equal(r.plan.milestones[0].name, "M1");
  });

  it("ai_breakdown creates subtasks when LLM emits array", async () => {
    const pid = await makeProject("u_bd2", "BRK2");
    const tid = await makeTask("u_bd2", pid, "Epic 1");
    const llm = { chat: async () => ({ content: '[{"title":"Sub 1","description":"d1","estimatePoints":3},{"title":"Sub 2","estimatePoints":5}]' }) };
    const r = await MACROS.get("ai_breakdown")({ db, actor: { userId: "u_bd2" }, llm }, { taskId: tid });
    assert.equal(r.ok, true);
    assert.equal(r.proposals.length, 2);
    assert.equal(r.created.length, 2);
    // Verify subtask parent linkage
    const subs = await MACROS.get("task_subtasks")({ db, actor: { userId: "u_bd2" } }, { parentId: tid });
    assert.equal(subs.subtasks.length, 2);
  });

  it("ai_voice_to_task with LLM parses structured proposals", async () => {
    const pid = await makeProject("u_v2", "VOC2");
    const llm = { chat: async () => ({ content: '[{"title":"A","priority":"high","estimatePoints":3,"labels":["x"]}]' }) };
    const r = await MACROS.get("ai_voice_to_task")({ db, actor: { userId: "u_v2" }, llm }, {
      projectId: pid, transcript: "do A",
    });
    assert.equal(r.ok, true);
    assert.equal(r.proposals[0].title, "A");
    assert.equal(r.proposals[0].priority, "high");
  });

  it("ai_breakdown autoCreate=false returns proposals without creating", async () => {
    const pid = await makeProject("u_bd3", "BRK3");
    const tid = await makeTask("u_bd3", pid, "Epic preview");
    const llm = { chat: async () => ({ content: '[{"title":"Preview only","estimatePoints":2}]' }) };
    const r = await MACROS.get("ai_breakdown")({ db, actor: { userId: "u_bd3" }, llm }, { taskId: tid, autoCreate: false });
    assert.equal(r.ok, true);
    assert.equal(r.created.length, 0);
    assert.equal(r.proposals.length, 1);
  });
});

describe("tasks-ai: triage rules", () => {
  let pid;
  before(async () => { pid = await makeProject("u_trig", "TRG"); });

  it("triage_rule_create + list", async () => {
    const c = await MACROS.get("triage_rule_create")(ctx("u_trig"), {
      projectId: pid, name: "Bug → urgent",
      pattern: "crash", patternKind: "substring",
      action: { setPriority: "urgent", addLabels: ["bug"] },
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("triage_rule_list")(ctx("u_trig"), { projectId: pid });
    assert.ok(list.rules.find((r) => r.id === c.id));
  });

  it("ai_triage applies matching substring rule + bumps hit_count", async () => {
    const tid = await makeTask("u_trig", pid, "App crash on login");
    const r = await MACROS.get("ai_triage")(ctx("u_trig"), { taskId: tid, askLlm: false });
    assert.equal(r.ok, true);
    assert.ok(r.appliedRules.length >= 1);
    const task = await MACROS.get("task_get")(ctx("u_trig"), { id: tid });
    assert.equal(task.task.priority, "urgent");
    assert.ok(task.task.labels.includes("bug"));
  });

  it("ai_triage skips non-matching tasks", async () => {
    const tid = await makeTask("u_trig", pid, "Update docs");
    const r = await MACROS.get("ai_triage")(ctx("u_trig"), { taskId: tid, askLlm: false });
    assert.equal(r.appliedRules.length, 0);
  });

  it("triage_rule_delete cleans up", async () => {
    const c = await MACROS.get("triage_rule_create")(ctx("u_trig"), {
      projectId: pid, name: "Tmp", pattern: "x", action: { setPriority: "low" },
    });
    const d = await MACROS.get("triage_rule_delete")(ctx("u_trig"), { id: c.id });
    assert.equal(d.ok, true);
  });
});

describe("tasks-ai: semantic_search", () => {
  it("ranks bigram matches across user's member projects", async () => {
    const pid = await makeProject("u_sem", "SEM");
    await makeTask("u_sem", pid, "Improve render performance", { type: "task" });
    await makeTask("u_sem", pid, "Cooking recipe schema");
    const r = await MACROS.get("semantic_search")(ctx("u_sem"), { query: "render performance" });
    assert.equal(r.ok, true);
    assert.ok(r.results.length >= 1);
    assert.equal(r.results[0].title, "Improve render performance");
  });

  it("returns empty for short queries", async () => {
    const r = await MACROS.get("semantic_search")(ctx("u_sem"), { query: "x" });
    assert.equal(r.results.length, 0);
  });
});

describe("tasks-ai: ledger", () => {
  it("ai_runs_recent returns rows after a run", async () => {
    const pid = await makeProject("u_l", "LDR");
    await MACROS.get("ai_compose_plan")(ctx("u_l"), { projectId: pid, goal: "Ledger test" });
    const r = await MACROS.get("ai_runs_recent")(ctx("u_l"));
    assert.ok(r.runs.length >= 1);
    assert.equal(r.runs[0].kind, "compose_plan");
  });
});
