// server/lib/onboarding-funnel.js
//
// FTUE3 — the first-10-minutes funnel instrument. recordFunnelStep stamps the
// FIRST time a user reaches a named step + the elapsed ms from their funnel
// start; funnelReport aggregates reach + median time-to-step + drop-off between
// consecutive steps. This is the measurement foundation the experiential FTUE
// tightening (the ≤3-min hook, the load reduction) is judged against — the
// research's "track hesitation/quit, iterate relentlessly."
//
// Pure DB, no external deps. Free-text steps; the canonical early ones below
// give the report a stable spine, but any step is recorded + reported.

// The canonical early-funnel beats (ordering anchor for the report).
export const FUNNEL_STEPS = Object.freeze([
  "account_created",
  "entered_world",
  "first_action",   // first meaningful in-world act (target < 60s)
  "first_win",      // the hook — a juiced win (target < 3min)
  "tutorial_complete",
]);

function _median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Record a user FIRST reaching `step`. ms_since_start is the elapsed time from
 * the user's earliest funnel event (0 for the first). Idempotent per
 * (user, step) — a repeated step is a no-op (funnel = first reach).
 */
export function recordFunnelStep(db, userId, step, { nowMs = Date.now() } = {}) {
  if (!db || !userId || !step) return { ok: false, reason: "missing_inputs" };
  try {
    const dup = db.prepare(`SELECT 1 FROM onboarding_funnel WHERE user_id=? AND step=?`).get(String(userId), String(step));
    if (dup) return { ok: true, duplicate: true };
    const first = db.prepare(`SELECT MIN(at) AS t FROM onboarding_funnel WHERE user_id=?`).get(String(userId));
    const start = Number.isFinite(first?.t) ? first.t : nowMs;
    const ms = Math.max(0, nowMs - start);
    db.prepare(`INSERT OR IGNORE INTO onboarding_funnel (user_id, step, at, ms_since_start) VALUES (?,?,?,?)`)
      .run(String(userId), String(step), nowMs, ms);
    return { ok: true, msSinceStart: ms };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

/** Elapsed ms from a user's funnel start to their first reach of `step` (or null). */
export function timeToStep(db, userId, step) {
  if (!db || !userId || !step) return null;
  const r = db.prepare(`SELECT ms_since_start FROM onboarding_funnel WHERE user_id=? AND step=?`)
    .get(String(userId), String(step));
  return r ? r.ms_since_start : null;
}

/**
 * Aggregate funnel report: per-step reach (distinct users) + median time-to-step,
 * the steps ordered by median time (the funnel spine), and drop-off between
 * consecutive steps. The number the cold-open tightening is measured against.
 */
export function funnelReport(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM onboarding_funnel`).get().n;
  const stepNames = db.prepare(`SELECT DISTINCT step FROM onboarding_funnel`).all().map((r) => r.step);

  const perStep = stepNames.map((step) => {
    const reach = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM onboarding_funnel WHERE step=?`).get(step).n;
    const times = db.prepare(`SELECT ms_since_start AS ms FROM onboarding_funnel WHERE step=?`).all(step).map((r) => r.ms);
    return { step, reach, medianMs: _median(times) };
  });

  // Order by the canonical spine first (in FUNNEL_STEPS order), then any extra
  // steps by ascending median time.
  perStep.sort((a, b) => {
    const ia = FUNNEL_STEPS.indexOf(a.step), ib = FUNNEL_STEPS.indexOf(b.step);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return (a.medianMs ?? 1e12) - (b.medianMs ?? 1e12);
  });

  // Drop-off between consecutive ordered steps.
  const dropOff = [];
  for (let i = 0; i < perStep.length - 1; i++) {
    const from = perStep[i], to = perStep[i + 1];
    dropOff.push({ from: from.step, to: to.step, lost: Math.max(0, from.reach - to.reach) });
  }

  return { ok: true, totalUsers, steps: perStep, dropOff };
}
