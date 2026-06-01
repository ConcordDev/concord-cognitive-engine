// server/lib/cold-watcher.js
//
// F1 — the cold-watcher (fun-funnel health on top of the FTUE3 funnel).
//
// onboarding-funnel.js records FIRST-reach per step; this layer reads that table
// and answers the cold-start questions the funnel alone doesn't: who STALLED
// (reached a step, went quiet before the hook), who ABANDONED (entered, never
// reached the first meaningful action), and — split by acquisition source — does
// the TOOL path convert differently from the NETWORK path (the come-for-the-tool/
// stay-for-the-network thesis, COLD_START_STRATEGY.md).
//
// Observe-only, pure DB, never throws. The acquisition-source dimension isn't on
// the funnel table, so it's supplied by an injectable `sourceFor(userId)` →
// 'tool' | 'network' | 'unknown' (the route wires it to whatever's known; absent
// ⇒ everyone 'unknown', which still yields a valid — if unsplit — report).
//
// Surfaced read-only at GET /api/onboarding/cold-watch, kill-switched by
// CONCORD_FTUE_TELEMETRY (same flag as the funnel recorder).

import { FUNNEL_STEPS, funnelReport } from "./onboarding-funnel.js";

const HOOK_STEP = "first_win";          // the conversion target
const FIRST_ACT_STEP = "first_action";  // the "did they do anything" gate
const DEFAULT_STALL_BUDGET_MS = 10 * 60 * 1000;  // quiet ≥10m mid-funnel = stalled
const DEFAULT_ABANDON_AFTER_MS = 30 * 60 * 1000; // entered, no first_action in 30m, quiet = abandoned

function _median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Classify one user's cold-start outcome from their funnel rows.
 * @returns {'converted'|'stalled'|'abandoned'|'active'}
 */
export function classifyOutcome(db, userId, { nowMs = Date.now(), stallBudgetMs = DEFAULT_STALL_BUDGET_MS, abandonAfterMs = DEFAULT_ABANDON_AFTER_MS } = {}) {
  if (!db || !userId) return "active";
  try {
    const rows = db.prepare(`SELECT step, at FROM onboarding_funnel WHERE user_id=?`).all(String(userId));
    if (!rows.length) return "active";
    const steps = new Set(rows.map((r) => r.step));
    if (steps.has(HOOK_STEP)) return "converted";
    const start = Math.min(...rows.map((r) => r.at));
    const last = Math.max(...rows.map((r) => r.at));
    const quietMs = nowMs - last;
    // Abandoned: never did a first meaningful action, entered long ago, now quiet.
    if (!steps.has(FIRST_ACT_STEP) && (nowMs - start) >= abandonAfterMs && quietMs >= stallBudgetMs) return "abandoned";
    // Stalled: did something but went quiet past the budget before the hook.
    if (quietMs >= stallBudgetMs) return "stalled";
    return "active";
  } catch {
    return "active";
  }
}

/**
 * Fleet-level cold-watch report.
 * @param {object} [opts]
 * @param {number} [opts.nowMs]
 * @param {number} [opts.stallBudgetMs]
 * @param {number} [opts.abandonAfterMs]
 * @param {(userId:string)=>('tool'|'network'|'unknown')} [opts.sourceFor]
 * @returns {{ok:boolean, totalUsers?:number, outcomes?:object, abandonRate?:number, stallRate?:number, conversionRate?:number, hookMedianMs?:number|null, biggestStall?:object|null, bySource?:object, reason?:string}}
 */
export function coldWatchReport(db, { nowMs = Date.now(), stallBudgetMs = DEFAULT_STALL_BUDGET_MS, abandonAfterMs = DEFAULT_ABANDON_AFTER_MS, sourceFor } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const users = db.prepare(`SELECT DISTINCT user_id FROM onboarding_funnel`).all().map((r) => r.user_id);
    const total = users.length;
    const outcomes = { converted: 0, stalled: 0, abandoned: 0, active: 0 };
    const bySource = {}; // src → { total, converted, stalled, abandoned, active }

    const resolveSrc = (uid) => {
      if (typeof sourceFor !== "function") return "unknown";
      try { const s = sourceFor(uid); return s === "tool" || s === "network" ? s : "unknown"; } catch { return "unknown"; }
    };

    for (const uid of users) {
      const outcome = classifyOutcome(db, uid, { nowMs, stallBudgetMs, abandonAfterMs });
      outcomes[outcome]++;
      const src = resolveSrc(uid);
      const b = (bySource[src] ||= { total: 0, converted: 0, stalled: 0, abandoned: 0, active: 0 });
      b.total++; b[outcome]++;
    }

    // Median time-to-hook (cold-open speed) among converters.
    const hookTimes = db.prepare(`SELECT ms_since_start AS ms FROM onboarding_funnel WHERE step=?`).all(HOOK_STEP).map((r) => r.ms);
    const hookMedianMs = _median(hookTimes);

    // Biggest stall = the consecutive-step transition that loses the most users.
    let biggestStall = null;
    try {
      const fr = funnelReport(db);
      if (fr?.ok && Array.isArray(fr.dropOff) && fr.dropOff.length) {
        biggestStall = fr.dropOff.reduce((max, d) => (d.lost > (max?.lost ?? -1) ? d : max), null);
      }
    } catch { /* report best-effort */ }

    const rate = (n) => (total ? Math.round((n / total) * 10000) / 10000 : 0);

    // Per-source conversion rate (the tool-vs-network split).
    for (const src of Object.keys(bySource)) {
      const b = bySource[src];
      b.conversionRate = b.total ? Math.round((b.converted / b.total) * 10000) / 10000 : 0;
    }

    return {
      ok: true,
      totalUsers: total,
      outcomes,
      conversionRate: rate(outcomes.converted),
      stallRate: rate(outcomes.stalled),
      abandonRate: rate(outcomes.abandoned),
      hookMedianMs,
      biggestStall,
      bySource,
      canonicalSteps: FUNNEL_STEPS,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export default coldWatchReport;
