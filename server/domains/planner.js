// server/domains/planner.js
//
// Long-Horizon Planner (#14) — macros over the schedule + contingency layer
// (lib/long-horizon-planner.js, mig 341). Time-phases a goal tree's actionable
// leaves into dated milestones and attaches "if this slips, do that" fallbacks.
//
// Registered from server.js: registerPlannerMacros(register).

import {
  draftPlan, addContingency, setMilestoneStatus, getPlan, sweepOverdue,
} from "../lib/long-horizon-planner.js";

export default function registerPlannerMacros(register) {
  register("planner", "draft", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return draftPlan(db, { userId, treeId: input.treeId, title: input.title, horizonDays: input.horizonDays, startTs: input.startTs, milestones: input.milestones });
  }, { note: "draft a long-horizon plan from a goal tree (or explicit milestones) (#14)" });

  register("planner", "contingency", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return addContingency(db, { milestoneId: input.milestoneId, condition: input.condition, fallback: input.fallback });
  }, { note: "attach an if-this-slips fallback to a milestone (#14)" });

  register("planner", "advance", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return setMilestoneStatus(db, { planId: input.planId, milestoneId: input.milestoneId, status: input.status });
  }, { note: "set a milestone's status; completing all completes the plan (#14)" });

  register("planner", "plan", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return getPlan(db, input.planId, { nowTs: input.nowTs });
  }, { note: "full plan view with milestones, contingencies, overdue flags (#14)" });

  register("planner", "sweep", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, ...sweepOverdue(db, { nowTs: input.nowTs }) };
  }, { note: "manually sweep overdue milestones + fire contingencies (#14)" });
}
