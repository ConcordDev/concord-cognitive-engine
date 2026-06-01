// server/lib/liveness-report.js
//
// F2 (backend) — substrate liveness: the one operator read that answers "is real
// data accumulating here, and are people sticking?" — the question the whole
// architecture lives or dies on (a system-of-record is only a moat once people's
// records actually live in it; form-of-the-moat without mass is just schema).
//
// Composes the instrumentation spine already built:
//   • substrate gravity  — records living here per real creator + recent growth (the MASS)
//   • funnel (F1)         — are new players reaching first-win (cold-watcher)
//   • distribution (F5)   — viral K-factor (is it spreading)
//   • economy (F4)        — royalty-cascade solvency (is the economic record trustworthy)
//
// Observe-only, pure-ish, never throws. Every sub-report is injectable for tests.

import { coldWatchReport } from "./cold-watcher.js";
import { referralReport } from "./referral-metrics.js";
import { royaltySolvencyReport } from "./royalty-solvency.js";

function safe(fn, fallback) {
  try { const r = fn(); return r ?? fallback; } catch { return fallback; }
}

/**
 * Substrate gravity — the "mass of the moat": how many real records live here,
 * spread across how many real creators, and how fast it's growing. Reads the SQL
 * `dtus` table (owner_user_id, created_at). Guarded — zeros if the table's absent.
 */
export function computeSubstrateGravity(db, { nowMs = Date.now() } = {}) {
  if (!db) return { ok: false, reason: "no_db", totalRecords: 0, creators: 0, recordsPerCreator: 0, last7dRecords: 0 };
  try {
    const totalRecords = db.prepare(`SELECT COUNT(*) AS n FROM dtus`).get().n || 0;
    const creators = db.prepare(`SELECT COUNT(DISTINCT owner_user_id) AS n FROM dtus WHERE owner_user_id IS NOT NULL`).get().n || 0;
    const last7dRecords = db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE created_at >= datetime('now','-7 days')`).get().n || 0;
    const recordsPerCreator = creators ? Math.round((totalRecords / creators) * 100) / 100 : 0;
    return { ok: true, totalRecords, creators, recordsPerCreator, last7dRecords };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), totalRecords: 0, creators: 0, recordsPerCreator: 0, last7dRecords: 0 };
  }
}

/**
 * One operator snapshot of substrate liveness.
 * @param {object} [opts] — each sub-report injectable for tests.
 * @returns {{ok:boolean, generatedAt:number, headline:object, substrate:object, funnel:object, distribution:object, economy:object}}
 */
export function livenessReport(db, { nowMs = Date.now(), gravity, funnel, distribution, economy } = {}) {
  const sg = gravity ?? safe(() => computeSubstrateGravity(db, { nowMs }), { ok: false });
  const cw = funnel ?? safe(() => coldWatchReport(db, { nowMs }), { ok: false });
  const rf = distribution ?? safe(() => referralReport(db), { ok: false });
  const ec = economy ?? safe(() => royaltySolvencyReport(), { ok: false });

  return {
    ok: true,
    generatedAt: nowMs,
    headline: {
      recordsLiving: sg?.totalRecords ?? 0,
      recordsPerCreator: sg?.recordsPerCreator ?? 0,
      last7dRecords: sg?.last7dRecords ?? 0,
      conversionRate: cw?.conversionRate ?? null,
      abandonRate: cw?.abandonRate ?? null,
      kFactor: rf?.kFactor ?? null,
      viral: rf?.viral ?? false,
      economySolvent: ec?.alwaysSolvent ?? null,
    },
    substrate: sg,
    funnel: cw,
    distribution: rf,
    economy: ec,
  };
}

export default livenessReport;
