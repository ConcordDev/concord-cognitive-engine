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
import { actorId, requireActor } from "../lib/lens-authz.js";

export default function registerPlannerMacros(register) {
  register("planner", "draft", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const auth = requireActor(ctx);
    if (!auth.ok) return auth;
    // Identity comes from the authenticated actor; never trust input.userId.
    return draftPlan(db, { userId: auth.actorId, treeId: input.treeId, title: input.title, horizonDays: input.horizonDays, startTs: input.startTs, milestones: input.milestones });
  }, { note: "draft a long-horizon plan from a goal tree (or explicit milestones) (#14)" });

  register("planner", "contingency", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const auth = requireActor(ctx);
    if (!auth.ok) return auth;
    return addContingency(db, { milestoneId: input.milestoneId, condition: input.condition, fallback: input.fallback, actor: ctx });
  }, { note: "attach an if-this-slips fallback to a milestone (#14)" });

  register("planner", "advance", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const auth = requireActor(ctx);
    if (!auth.ok) return auth;
    return setMilestoneStatus(db, { planId: input.planId, milestoneId: input.milestoneId, status: input.status, actor: ctx });
  }, { note: "set a milestone's status; completing all completes the plan (#14)" });

  register("planner", "plan", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const auth = requireActor(ctx);
    if (!auth.ok) return auth;
    return getPlan(db, input.planId, { nowTs: input.nowTs, actor: ctx });
  }, { note: "full plan view with milestones, contingencies, overdue flags (#14)" });

  register("planner", "sweep", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const auth = requireActor(ctx);
    if (!auth.ok) return auth;
    // A manual sweep is scoped to the actor's own plans and uses server time;
    // ignore any client-supplied nowTs to prevent mass-slip attacks.
    return { ok: true, ...sweepOverdue(db, { nowTs: Math.floor(Date.now() / 1000), userId: actorId(ctx) }) };
  }, { note: "manually sweep the actor's overdue milestones + fire contingencies (#14)" });
}
