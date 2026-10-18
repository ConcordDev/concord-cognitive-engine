// server/tests/long-task.test.js
//
// Long tasks: Chat / ConKay hand big jobs to a marathon session
// (lib/long-task.js + lib/agent-marathon.js) and get the result posted back.
// Real in-memory DB, scripted brain, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { tickMarathon, findDueMarathons } from "../lib/agent-marathon.js";
import {
  startLongTask, longTaskStatus, isLongTaskAsk, isLongTaskStatusAsk, takePendingLongTaskNotices,
  inferLongTaskMode, LONG_TASK_DEFAULTS, formatLongTaskStatus,
} from "../lib/long-task.js";
import { chatAgentRoute, answerLongTaskRoute } from "../lib/chat/agent-route.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";
import { executeToolCall } from "../lib/chat-agent.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT, created_at INTEGER, updated_at INTEGER, msg_count INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  db.exec(`CREATE TABLE initiatives (id TEXT PRIMARY KEY, user_id TEXT, trigger_type TEXT, priority TEXT, message TEXT, status TEXT, metadata_json TEXT, created_at INTEGER)`);
  return db;
}

const harvestOnly = async (domain, name) => {
  if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
  if (domain === "tools" && name === "web_search") return { ok: true, results: [{ title: "Servo guide", url: "https://example.com/servos", snippet: "MG90S 2.2 kg-cm" }] };
  return { ok: true };
};

function scriptedBrain(responses, seen = []) {
  return async ({ messages }) => {
    seen.push(messages);
    const text = responses.shift() ?? "Progress notes: nothing new.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
}

const RESEARCH = "research the best small hobby servos for a robot arm and write me a report";

describe("routing", () => {
  it("sends big jobs to the long route and status asks to jobs", () => {
    assert.equal(isLongTaskAsk(RESEARCH), true);
    assert.equal(chatAgentRoute(RESEARCH), "long");
    assert.equal(chatAgentRoute("do a deep research dive on solid-state batteries"), "long");
    assert.equal(chatAgentRoute("how's my research job going?"), "jobs");
    assert.equal(chatAgentRoute("is the report done yet?"), "jobs");
    assert.equal(isLongTaskStatusAsk("add a task to call mom"), false);
    assert.equal(chatAgentRoute("search the web for MG90S price"), "web");
    assert.equal(chatAgentRoute("add a task to call mom tomorrow"), "action");
    assert.equal(inferLongTaskMode(RESEARCH), "research");
  });
  it("ConKay plans long/jobs with a start_long_task fallback", () => {
    const plan = conkayTurnPlan(RESEARCH, []);
    assert.equal(plan.route, "long");
    assert.equal(plan.fallbackCall.tool, "start_long_task");
    assert.equal(conkayTurnPlan("how are my background jobs going", []).route, "jobs");
  });
});

describe("startLongTask", () => {
  it("creates a running marathon with budget, origin and mode", () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH, origin: { surface: "chat", sessionId: "s1" } });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(r.jobId);
    assert.equal(row.status, "running");
    assert.equal(row.budget_cap, LONG_TASK_DEFAULTS.budgetCap);
    assert.equal(row.max_turns, LONG_TASK_DEFAULTS.maxTurns);
    const meta = JSON.parse(row.meta_json);
    assert.equal(meta.longTask, 1);
    assert.equal(meta.mode, "research");
    assert.deepEqual(meta.origin, { surface: "chat", sessionId: "s1" });
    assert.equal(findDueMarathons(db)[0].id, r.jobId);
  });
  it("caps active jobs per user", () => {
    const db = setup();
    for (let i = 0; i < LONG_TASK_DEFAULTS.maxActivePerUser; i++) assert.equal(startLongTask(db, { userId: "u1", goal: `${RESEARCH} ${i}` }).ok, true);
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_many_active");
    assert.equal(startLongTask(db, { userId: "u2", goal: RESEARCH }).ok, true);
  });
  it("lists due long tasks before other marathons", () => {
    const db = setup();
    db.prepare(`INSERT INTO agent_marathon_sessions (id, user_id, goal, status, next_tick_at) VALUES ('mar_old', 'agent', 'g', 'running', 1)`).run();
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH });
    assert.equal(findDueMarathons(db)[0].id, r.jobId);
  });
});

describe("tickMarathon on a long task", () => {
  it("briefs the job, continues it, and posts the result to the chat session", async () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH, origin: { surface: "chat", sessionId: "chat_s1" } });
    const seen = [];
    const brain = scriptedBrain([
      `[TOOL_CALL: {"tool": "web_search", "params": {"query": "small hobby servo robot arm"}}]`,
      "Progress notes: MG90S is 2.2 kg-cm (https://example.com/servos). Left: compare torque.",
      "# Servo report\nMG90S: 2.2 kg-cm (https://example.com/servos)\n[TASK_COMPLETE]",
    ], seen);
    const t1 = await tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 2, brainChat: brain } });
    assert.equal(t1.ok, true);
    assert.equal(t1.status, "running");
    assert.match(seen[0][0].content, /BACKGROUND JOB/);
    db.prepare(`UPDATE agent_marathon_sessions SET next_tick_at = 0 WHERE id = ?`).run(r.jobId);
    const t2 = await tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 2, brainChat: brain } });
    assert.equal(t2.status, "completed");
    const lastCall = seen[seen.length - 1];
    assert.match(lastCall[lastCall.length - 1].content, /Continue the background job/);
    const msgs = db.prepare(`SELECT role, content, meta_json FROM chat_messages WHERE session_id = 'chat_s1'`).all();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].content, /Background job finished/);
    assert.match(msgs[0].content, /Servo report/);
    assert.doesNotMatch(msgs[0].content, /TASK_COMPLETE/);
    const st = longTaskStatus(db, "u1", r.jobId);
    assert.equal(st.jobs[0].status, "completed");
    assert.ok(st.jobs[0].steps >= 1);
    assert.equal(longTaskStatus(db, "u2", r.jobId).ok, false); // owner only
    assert.match(formatLongTaskStatus(st), /completed/);
  });
  it("queues a ConKay notice once, and retries a transient brain failure", async () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH, origin: { surface: "conkay" } });
    const failing = async () => ({ ok: false, text: "", error: "brain_down" });
    const t0 = await tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 1, brainChat: failing } });
    assert.equal(t0.retry, true);
    assert.equal(db.prepare(`SELECT status FROM agent_marathon_sessions WHERE id = ?`).get(r.jobId).status, "running");
    db.prepare(`UPDATE agent_marathon_sessions SET next_tick_at = 0 WHERE id = ?`).run(r.jobId);
    await tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 1, brainChat: scriptedBrain(["Done.\n[TASK_COMPLETE]"]) } });
    const n1 = takePendingLongTaskNotices(db, "u1", { surface: "conkay" });
    assert.equal(n1.length, 1);
    assert.match(n1[0].text, /Background job finished/);
    assert.equal(takePendingLongTaskNotices(db, "u1", { surface: "conkay" }).length, 0);
  });
  it("runs one tick per session at a time", async () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: RESEARCH });
    let release;
    const gate = new Promise((res) => { release = res; });
    const slow = async () => { await gate; return { ok: true, text: "Progress notes: x", provider: "t", model: "t" }; };
    const a = tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 1, brainChat: slow } });
    await new Promise((res) => setTimeout(res, 20));
    const b = await tickMarathon({ db, sessionId: r.jobId, runMacro: harvestOnly, lensActions: new Map(), opts: { tickTurns: 1, brainChat: slow } });
    assert.equal(b.skipped, true);
    release();
    const ra = await a;
    assert.equal(ra.ok, true);
  });
});

describe("agent tools", () => {
  it("start_long_task starts a job from Chat and is refused inside a job", async () => {
    const db = setup();
    const ctx = { db, actor: { userId: "u1", sessionId: "chat_s9" }, surface: "chat", userPrompt: RESEARCH };
    const r = await executeToolCall(ctx, null, new Map(), { tool: "start_long_task", params: { goal: RESEARCH, mode: "research" } });
    assert.equal(r.ok, true);
    assert.match(r.jobId, /^mar_/);
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id = ?`).get(r.jobId).meta_json);
    assert.deepEqual(meta.origin, { surface: "chat", sessionId: "chat_s9" });
    const inside = await executeToolCall({ ...ctx, marathonSessionId: r.jobId }, null, new Map(), { tool: "start_long_task", params: { goal: RESEARCH } });
    assert.equal(inside.ok, false);
    const chk = await executeToolCall(ctx, null, new Map(), { tool: "check_long_task", params: {} });
    assert.equal(chk.ok, true);
    assert.equal(chk.jobs[0].jobId, r.jobId);
  });
  it("answerLongTaskRoute starts and reports without a model call", () => {
    const db = setup();
    const ctx = { db, actor: { userId: "u1" } };
    const out = answerLongTaskRoute({ runMacro: null, ctx, prompt: RESEARCH, route: "long", sessionId: "s1" });
    assert.match(out.reply, /Started a research job/);
    assert.match(out.reply, /mar_/);
    const st = answerLongTaskRoute({ runMacro: null, ctx, prompt: "how's my job going", route: "jobs" });
    assert.match(st.reply, /running/);
    assert.equal(answerLongTaskRoute({ runMacro: null, ctx, prompt: "x", route: "web" }), null);
  });
});
