// server/emergent/plan-horizon-cycle.js
//
// Long-Horizon Planner (#14) — bounded, try/catch-isolated heartbeat that sweeps
// overdue milestones across all active plans, marks them slipped, and fires
// their 'overdue' contingencies. Kill-switch CONCORD_PLAN_HORIZON_CYCLE=0.

import { sweepOverdue } from "../lib/long-horizon-planner.js";

export async function runPlanHorizonCycle({ db } = {}) {
  if (process.env.CONCORD_PLAN_HORIZON_CYCLE === "0") return { ok: true, skipped: "disabled" };
  if (!db) return { ok: true, skipped: "no_db" };
  try {
    const r = sweepOverdue(db, {});
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default runPlanHorizonCycle;
