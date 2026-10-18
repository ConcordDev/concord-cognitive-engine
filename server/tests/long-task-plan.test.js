// server/tests/long-task-plan.test.js
//
// Long tasks get a plan when they start (lib/long-task-plan.js): goal tree,
// linked project, dated milestones, calendar tasks; every tick then runs with
// the plan context and plan-sync. Real in-memory DB, scripted brain.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig340 } from "../migrations/340_goal_decomposition.js";
import { up as upMig341 } from "../migrations/341_long_horizon_plans.js";
import { up as upMig378 } from "../migrations/378_projects.js";
import { up as upMig386 } from "../migrations/386_goal_node_assignee.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { tickMarathon, startMarathon } from "../lib/agent-marathon.js";
import { startLongTask, tickLongTask, longTaskStatus, formatLongTaskStatus, inferLongTaskMode, isLongTaskAsk } from "../lib/long-task.js";
import { parseHorizonDays, wantsTimeBlocks, parseSubgoals, planLongTask } from "../lib/long-task-plan.js";
import { getGoalTree } from "../lib/goal-decomposition.js";
import { chatAgentRoute } from "../lib/chat/agent-route.js";
import { conkayTurnPlan } from "../lib/conkay/agent-turn.js";
import { linkedProjectId } from "../emergent/agent-marathon-cycle.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig340(db); upMig341(db); upMig378(db); upMig379(db); upMig386(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE initiatives (id TEXT PRIMARY KEY, user_id TEXT, trigger_type TEXT, priority TEXT, message TEXT, status TEXT, metadata_json TEXT, created_at INTEGER)`);
  return db;
}

const SUBGOALS = JSON.stringify({ subgoals: [
  { title: "Pick servos and a controller", detail: "Compare MG90S vs MG996R.", estimateHours: 3 },
  { title: "Design the arm links in CAD", estimateHours: 6 },
  { title: "Print and assemble the arm", estimateHours: 8 },
  { title: "Wire and test the servos", estimateHours: 4 },
] });

function fakeCalendar() {
  const tasks = [];
  const blocks = [];
  const m = new Map();
  m.set("calendar.tasks-create", (ctx, _a, p) => { const task = { id: `t${tasks.length + 1}`, userId: ctx.actor.userId, ...p }; tasks.push(task); return { ok: true, result: { task } }; });
  m.set("calendar.tasks-time-block", (_ctx, _a, p) => { blocks.push(p); return { ok: true, result: {} }; });
  return { m, tasks, blocks };
}

const noMacro = async (domain, name) => (domain === "chat" && name === "harvest" ? { ok: true, dtus: [] } : { ok: true });

describe("long-task plan helpers", () => {
  it("parses horizons, time-block asks and subgoal lists", () => {
    assert.equal(parseHorizonDays("plan a 2-week build of a desktop robot arm"), 14);
    assert.equal(parseHorizonDays("in three days"), 3);
    assert.equal(parseHorizonDays("a month-long plan"), 30);
    assert.equal(parseHorizonDays("plan my robot"), null);
    assert.ok(wantsTimeBlocks("and put it on my calendar"));
    assert.ok(!wantsTimeBlocks("plan a 2-week build"));
    assert.equal(parseSubgoals(SUBGOALS).length, 4);
    assert.deepEqual(parseSubgoals("1. Buy servos\n2. Print parts\n- Test it all").map((s) => s.title), ["Buy servos", "Print parts", "Test it all"]);
  });

  it("routes plan asks to a planning long task in Chat and ConKay", () => {
    const ask = "plan a 2-week build of a desktop robot arm";
    assert.ok(isLongTaskAsk(ask));
    assert.equal(inferLongTaskMode(ask), "plan");
    assert.equal(chatAgentRoute(ask), "long");
    assert.equal(conkayTurnPlan(ask, [])?.route, "long");
    assert.ok(!isLongTaskAsk("plan my day"));
    assert.notEqual(conkayTurnPlan("design a desktop robot arm", [])?.route, "long");
  });
});

describe("planLongTask", () => {
  it("builds a goal tree, linked project, dated plan and calendar tasks, once", async () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: "plan a 2-week build of a desktop robot arm" });
    assert.equal(r.mode, "plan");
    const cal = fakeCalendar();
    let calls = 0;
    const brain = async () => { calls++; return { ok: true, text: SUBGOALS }; };
    const p = await planLongTask(db, { jobId: r.jobId, brain, lensActions: cal.m });
    assert.ok(p.ok, JSON.stringify(p));
    const gt = getGoalTree(db, p.goalTreeId);
    assert.equal(gt.total >= 4, true);
    assert.equal(linkedProjectId(db, r.jobId), p.projectId);
    assert.equal(p.milestones.length, 4);
    const span = p.milestones[3].dueTs - Math.floor(Date.now() / 1000);
    assert.ok(span > 13 * 86400 && span <= 14 * 86400 + 5, `last milestone ~14 days out (${span})`);
    assert.equal(cal.tasks.length, 4);
    assert.equal(cal.tasks[0].userId, "u1");
    assert.equal(cal.tasks[0].estimateMin, 180);
    assert.ok(cal.tasks[0].dueAt);
    assert.equal(cal.blocks.length, 0, "no time blocks unless asked");
    const again = await planLongTask(db, { jobId: r.jobId, brain, lensActions: cal.m });
    assert.ok(again.skipped);
    assert.equal(calls, 1);
    const status = formatLongTaskStatus(longTaskStatus(db, "u1", r.jobId));
    assert.match(status, /Plan: 0\/\d+ subgoals done, 4 tasks on your calendar/);
  });

  it("time-blocks when asked, and records a failed decomposition honestly", async () => {
    const db = setup();
    const cal = fakeCalendar();
    const r = startLongTask(db, { userId: "u1", goal: "plan a 1-week robot arm build and put it on my calendar" });
    const p = await planLongTask(db, { jobId: r.jobId, brain: async () => ({ ok: true, text: SUBGOALS }), lensActions: cal.m });
    assert.ok(p.ok);
    assert.equal(cal.blocks.length, 4);
    const r2 = startLongTask(db, { userId: "u2", goal: "research servos and write me a report" });
    const bad = await planLongTask(db, { jobId: r2.jobId, brain: async () => ({ ok: true, text: "sure!" }) });
    assert.equal(bad.ok, false);
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(r2.jobId).meta_json);
    assert.equal(meta.planError, "decomposition_failed");
    assert.ok(!meta.goalTreeId);
  });
});

describe("tickLongTask runs ticks against the plan", () => {
  it("plans first, injects the plan context, and applies [SUBGOAL_COMPLETE]", async () => {
    const db = setup();
    const r = startLongTask(db, { userId: "u1", goal: "plan a 2-week build of a desktop robot arm" });
    const seen = [];
    let nodeId = null;
    const brainChat = async ({ messages }) => {
      seen.push(messages);
      const sys = messages.map((m) => m.content).join("\n");
      nodeId = nodeId || (sys.match(/- \[(gn_[^\]]+)\] Pick servos/) || [])[1];
      return { ok: true, text: `Picked MG996R. Progress notes: servos chosen. [SUBGOAL_COMPLETE: ${nodeId}]`, provider: "t", model: "t" };
    };
    const planner = (db2, args) => planLongTask(db2, { ...args, brain: async () => ({ ok: true, text: SUBGOALS }) });
    await tickLongTask({ db, jobId: r.jobId, runMacro: noMacro, lensActions: new Map(), tick: tickMarathon, brainChat, planner });
    const flat = seen.flat().map((m) => m.content).join("\n");
    assert.match(flat, /Linked project plan/);
    assert.ok(nodeId, "brain saw node ids");
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(r.jobId).meta_json);
    const gt = getGoalTree(db, meta.goalTreeId);
    assert.ok(gt.done >= 1, `a subgoal was marked done (done=${gt.done})`);
  });

  it("the cycle finds a linked project for any marathon", () => {
    const db = setup();
    const m = startMarathon(db, "u1", { title: "t", goal: "g" });
    assert.equal(linkedProjectId(db, m.sessionId), null);
    db.prepare(`INSERT INTO project_marathon_links (project_id, marathon_session_id) VALUES ('proj_1', ?)`).run(m.sessionId);
    assert.equal(linkedProjectId(db, m.sessionId), "proj_1");
  });
});
