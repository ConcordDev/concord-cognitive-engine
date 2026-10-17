// server/tests/inc-93-authz.test.js
//
// INC-93 regression: planner domain enforces ownership. Account B must not be
// able to read, modify, attach contingencies to, or sweep A's long-horizon
// plans. Anonymous callers are refused. Owners (and admins) still work.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerPlannerMacros from "../domains/planner.js";

const DAY = 86400;

function ctx(db, userId, role = null) {
  return { db, actor: role ? { userId, role } : { userId } };
}

function planOwner(db, planId) {
  return db.prepare(`SELECT user_id FROM lh_plans WHERE id = ?`).get(planId)?.user_id;
}

function milestoneStatus(db, milestoneId) {
  return db.prepare(`SELECT status FROM lh_milestones WHERE id = ?`).get(milestoneId)?.status;
}

function contingencyCount(db, milestoneId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM lh_contingencies WHERE milestone_id = ?`).get(milestoneId)?.n ?? 0;
}

describe("INC-93 planner authorization", () => {
  let db, macros, now;

  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerPlannerMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
    now = Math.floor(Date.now() / 1000);
  });

  it("draft ignores client-supplied userId and records the actor as owner", async () => {
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "A plan", userId: "B", horizonDays: 7, startTs: now, milestones: ["m1"],
    });
    assert.equal(aPlan.ok, true);
    assert.equal(planOwner(db, aPlan.planId), "A", "plan is owned by the actor, not the spoofed userId");

    const bPlan = await macros.get("planner.draft")(ctx(db, "B"), {
      title: "B plan", userId: "A", horizonDays: 7, startTs: now, milestones: ["m2"],
    });
    assert.equal(bPlan.ok, true);
    assert.equal(planOwner(db, bPlan.planId), "B", "B cannot forge a plan owned by A");
  });

  it("refuses anonymous draft, read, contingency, advance, and sweep", async () => {
    const anonCtx = { db };
    const draft = await macros.get("planner.draft")(anonCtx, { title: "x", milestones: ["m"] });
    assert.equal(draft.ok, false);
    assert.equal(draft.reason, "auth_required");

    const read = await macros.get("planner.plan")(anonCtx, { planId: "does-not-matter" });
    assert.equal(read.ok, false);
    assert.equal(read.reason, "auth_required");

    const con = await macros.get("planner.contingency")(anonCtx, { milestoneId: "x", fallback: "y" });
    assert.equal(con.ok, false);
    assert.equal(con.reason, "auth_required");

    const adv = await macros.get("planner.advance")(anonCtx, { planId: "x", milestoneId: "y", status: "done" });
    assert.equal(adv.ok, false);
    assert.equal(adv.reason, "auth_required");

    const sweep = await macros.get("planner.sweep")(anonCtx, {});
    assert.equal(sweep.ok, false);
    assert.equal(sweep.reason, "auth_required");
  });

  it("B cannot read A's plan", async () => {
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "Read gate", horizonDays: 7, startTs: now, milestones: ["m"],
    });
    const bRead = await macros.get("planner.plan")(ctx(db, "B"), { planId: aPlan.planId, nowTs: now });
    assert.equal(bRead.ok, false);
    assert.equal(bRead.reason, "forbidden");

    const aRead = await macros.get("planner.plan")(ctx(db, "A"), { planId: aPlan.planId, nowTs: now });
    assert.equal(aRead.ok, true);
    assert.equal(aRead.plan.userId, "A");
  });

  it("B cannot attach a contingency to A's milestone", async () => {
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "Contingency gate", horizonDays: 7, startTs: now, milestones: ["m"],
    });
    const ms = aPlan.milestones[0];
    const bCon = await macros.get("planner.contingency")(ctx(db, "B"), {
      milestoneId: ms.id, condition: "overdue", fallback: "take over",
    });
    assert.equal(bCon.ok, false);
    assert.equal(bCon.reason, "forbidden");
    assert.equal(contingencyCount(db, ms.id), 0, "no contingency row is created");

    const aCon = await macros.get("planner.contingency")(ctx(db, "A"), {
      milestoneId: ms.id, condition: "overdue", fallback: "escalate",
    });
    assert.equal(aCon.ok, true);
    assert.equal(contingencyCount(db, ms.id), 1);
  });

  it("B cannot advance A's milestone", async () => {
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "Advance gate", horizonDays: 7, startTs: now, milestones: ["m"],
    });
    const ms = aPlan.milestones[0];
    const bAdv = await macros.get("planner.advance")(ctx(db, "B"), {
      planId: aPlan.planId, milestoneId: ms.id, status: "done",
    });
    assert.equal(bAdv.ok, false);
    assert.equal(bAdv.reason, "forbidden");
    assert.equal(milestoneStatus(db, ms.id), "pending", "milestone is untouched");

    const aAdv = await macros.get("planner.advance")(ctx(db, "A"), {
      planId: aPlan.planId, milestoneId: ms.id, status: "done",
    });
    assert.equal(aAdv.ok, true);
    assert.equal(aAdv.planDone, true);
    assert.equal(milestoneStatus(db, ms.id), "done");
  });

  it("sweep is scoped to the actor's own plans and ignores a client-supplied nowTs", async () => {
    // A's plan is far in the future.
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "Future plan", horizonDays: 1, startTs: now + 400 * DAY, milestones: ["future"],
    });
    const aMs = aPlan.milestones[0];

    // B's plan is already overdue.
    const bPlan = await macros.get("planner.draft")(ctx(db, "B"), {
      title: "Overdue plan", horizonDays: 1, startTs: now - 10 * DAY, milestones: ["past"],
    });
    const bMs = bPlan.milestones[0];

    // B tries to use a far-future nowTs to slip A's milestones.
    const bSweep = await macros.get("planner.sweep")(ctx(db, "B"), { nowTs: now + 400 * DAY });
    assert.equal(bSweep.ok, true);
    assert.ok(bSweep.slipped >= 1, "B's own overdue milestone slips");
    assert.equal(milestoneStatus(db, bMs.id), "slipped");
    assert.equal(milestoneStatus(db, aMs.id), "pending", "A's future milestone is not touched");
  });

  it("admins can read another user's plan", async () => {
    const aPlan = await macros.get("planner.draft")(ctx(db, "A"), {
      title: "Admin readable", horizonDays: 7, startTs: now, milestones: ["m"],
    });
    const adminRead = await macros.get("planner.plan")(ctx(db, "admin1", "admin"), { planId: aPlan.planId, nowTs: now });
    assert.equal(adminRead.ok, true);
    assert.equal(adminRead.plan.userId, "A");
  });
});
