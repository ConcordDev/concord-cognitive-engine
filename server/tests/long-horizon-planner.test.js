// server/tests/long-horizon-planner.test.js
//
// Long-Horizon Planner (#14) — time-phases a goal tree's actionable leaves into
// dated milestones and fires contingencies when they slip. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createGoalTree, addSubgoals } from "../lib/goal-decomposition.js";
import {
  draftPlan, addContingency, setMilestoneStatus, getPlan, sweepOverdue,
} from "../lib/long-horizon-planner.js";
import registerPlannerMacros from "../domains/planner.js";
import { runPlanHorizonCycle } from "../emergent/plan-horizon-cycle.js";

const DAY = 86400;

describe("Long-Horizon Planner (#14)", () => {
  let db, macros, treeId, start;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    const t = createGoalTree(db, { userId: "u1", title: "Launch", mintDtu: false });
    addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["alpha", "beta", "ga"] });
    treeId = t.treeId;
    start = 1_000_000;
    macros = new Map();
    registerPlannerMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("drafts dated milestones evenly phased across the horizon from the tree leaves", () => {
    const r = draftPlan(db, { userId: "u1", treeId, title: "Launch plan", horizonDays: 30, startTs: start });
    assert.equal(r.ok, true);
    assert.equal(r.milestones.length, 3, "one per actionable leaf");
    // Evenly phased: last milestone due at start + horizon.
    assert.equal(r.milestones[2].dueTs, start + 30 * DAY);
    assert.equal(r.milestones[0].dueTs, start + 10 * DAY);
    const view = getPlan(db, r.planId, { nowTs: start });
    assert.equal(view.milestones.length, 3);
    assert.equal(view.overdueCount, 0);
  });

  it("accepts explicit milestones when no tree is given", () => {
    const r = draftPlan(db, { userId: "u1", title: "Manual", horizonDays: 10, startTs: start, milestones: ["x", "y"] });
    assert.equal(r.ok, true);
    assert.equal(r.milestones.length, 2);
  });

  it("a contingency fires when its milestone goes overdue", () => {
    const r = draftPlan(db, { userId: "u1", title: "Risky", horizonDays: 4, startTs: start, milestones: ["ship"] });
    const ms = r.milestones[0];
    addContingency(db, { milestoneId: ms.id, condition: "overdue", fallback: "escalate to council" });
    // Sweep at a time AFTER the due date.
    const swept = sweepOverdue(db, { nowTs: ms.dueTs + 1 });
    assert.equal(swept.slipped, 1);
    assert.equal(swept.triggered, 1, "the overdue contingency fired");
    const view = getPlan(db, r.planId, { nowTs: ms.dueTs + 1 });
    assert.equal(view.milestones[0].status, "slipped");
    assert.ok(view.contingencies[0].triggeredAt, "triggered_at stamped");
  });

  it("completing all milestones completes the plan", () => {
    const r = draftPlan(db, { userId: "u1", title: "Finish", horizonDays: 5, startTs: start, milestones: ["only"] });
    const out = setMilestoneStatus(db, { planId: r.planId, milestoneId: r.milestones[0].id, status: "done" });
    assert.equal(out.planDone, true);
    const p = db.prepare("SELECT status FROM lh_plans WHERE id = ?").get(r.planId);
    assert.equal(p.status, "done");
  });

  it("the heartbeat sweeps without throwing", async () => {
    const r = await runPlanHorizonCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(typeof r.slipped, "number");
  });

  it("planner macros round-trip", async () => {
    const d = await macros.get("planner.draft")({ db, actor: { userId: "u2" } }, { title: "macro plan", horizonDays: 7, startTs: start, milestones: ["a"] });
    assert.equal(d.ok, true);
    const view = await macros.get("planner.plan")({ db }, { planId: d.planId, nowTs: start });
    assert.equal(view.ok, true);
    assert.equal(view.milestones.length, 1);
  });
});
