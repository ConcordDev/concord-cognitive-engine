// server/emergent/pay-cycle.js
//
// Living Society — Phase 3: the payday heartbeat. Runs runPayday for every
// world that has employment edges. Pay moves along edges; skim diverts to
// collectors; unpaid flow deepens grievances. Never throws. scope:'world'.
// Kill-switch CONCORD_PAY_CYCLE=0.

import { runPayday } from "../lib/sparks-flow.js";

export function runPayCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_PAY_CYCLE === "0") return { ok: false, reason: "disabled" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM employment_edges WHERE active = 1`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; }
  let paid = 0, unpaid = 0, skimmed = 0;
  for (const w of worlds) {
    try {
      const r = runPayday(db, w);
      paid += r.paid || 0; unpaid += r.unpaid || 0; skimmed += r.skimmed || 0;
    } catch { /* per-world isolation */ }
  }
  return { ok: true, worlds: worlds.length, paid, unpaid, skimmed };
}
