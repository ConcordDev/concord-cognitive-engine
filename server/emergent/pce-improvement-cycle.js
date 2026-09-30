// server/emergent/pce-improvement-cycle.js
//
// Heartbeat — run ConcordBench + failure→pattern learning loop.

import { runPceImprovementCycle } from "../lib/pce/pce-improvement-cycle.js";

export async function runPceImprovementHeartbeat({ db } = {}) {
  if (process.env.CONCORD_PCE_IMPROVEMENT === "0") {
    return { ok: true, reason: "disabled" };
  }

  const database = db || globalThis._concordDB || globalThis.STATE?.db;
  if (!database) return { ok: false, reason: "no_db" };

  try {
    const result = await runPceImprovementCycle({
      db: database,
      runToyBench: process.env.CONCORD_PCE_IMPROVEMENT_TOY === "1",
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, reason: "cycle_error", error: e?.message || String(e) };
  }
}
