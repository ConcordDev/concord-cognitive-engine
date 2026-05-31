// server/lib/day-clock.js
//
// Slice-of-Life keystone — the day-clock time-economy. The day is a finite
// budget of SLOTS, and every life verb (work a shift, hang out, court, train,
// drink) costs slots. This is a VIABILITY CONE OVER TIME: the day's allocations
// must sum within the budget (the dtu_362 simplex Σα≤1), which is exactly what
// makes social compete with combat/work for the player's finite day — the thing
// that turns a pile of activities into a life with trade-offs. Pure model +
// a thin per-player/per-day DB ledger. Behind CONCORD_SOCIAL_LIFE.

export const SLOTS_PER_DAY = () => Math.max(1, Number(process.env.CONCORD_DAY_SLOTS) || 6);

// Canonical verb costs (slots). Tunable later; a work shift is the heavy commit.
export const VERB_COST = Object.freeze({
  work_shift: 3, hang_out: 1, share_meal: 1, go_drinking: 2, court: 1, gift: 1,
  spend_evening: 2, train: 2, quest: 2, default: 1,
});
export function costOf(verb) { return VERB_COST[verb] ?? VERB_COST.default; }

// ── pure model ───────────────────────────────────────────────────────────────
/** Remaining slots given used + budget. */
export function remaining(slotsUsed, budget = SLOTS_PER_DAY()) {
  return Math.max(0, budget - Math.max(0, Number(slotsUsed) || 0));
}
/** Can this verb be afforded with the slots left? */
export function canAfford(verb, slotsUsed, budget = SLOTS_PER_DAY()) {
  return costOf(verb) <= remaining(slotsUsed, budget);
}
/** The day-as-simplex: fraction of the day each logged verb consumed (Σ ≤ 1). */
export function dayAllocation(log = [], budget = SLOTS_PER_DAY()) {
  const out = {};
  for (const e of log) out[e.verb] = (out[e.verb] || 0) + (Number(e.slots) || 0) / budget;
  return out;
}

// ── DB ledger ────────────────────────────────────────────────────────────────
function row(db, userId, dayIdx) {
  try { return db.prepare(`SELECT * FROM player_day_budget WHERE user_id=? AND day_idx=?`).get(userId, dayIdx) || null; } catch { return null; }
}

/** Slots used by a player today (0 if no row / fresh day). */
export function slotsUsed(db, userId, dayIdx) {
  return Math.max(0, Number(row(db, userId, dayIdx)?.slots_used) || 0);
}

/**
 * Spend slots on a verb for (user, day). Returns { ok, remaining } or
 * { ok:false, reason:'day_full', remaining }. Atomic upsert. A new day (dayIdx
 * advance) starts fresh automatically (no row → 0 used).
 */
export function spendSlots(db, userId, dayIdx, verb, opts = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  const budget = opts.budget ?? SLOTS_PER_DAY();
  const cost = opts.cost ?? costOf(verb);
  const r = row(db, userId, dayIdx);
  const used = Math.max(0, Number(r?.slots_used) || 0);
  if (cost > remaining(used, budget)) return { ok: false, reason: "day_full", remaining: remaining(used, budget) };
  const log = (() => { try { return JSON.parse(r?.log_json || "[]"); } catch { return []; } })();
  log.push({ verb, slots: cost, at: Math.floor(Date.now() / 1000) });
  const nextUsed = used + cost;
  try {
    db.prepare(`
      INSERT INTO player_day_budget (user_id, day_idx, slots_used, log_json, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, day_idx) DO UPDATE SET slots_used = excluded.slots_used, log_json = excluded.log_json, updated_at = unixepoch()
    `).run(userId, dayIdx, nextUsed, JSON.stringify(log));
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
  return { ok: true, spent: cost, remaining: remaining(nextUsed, budget), slotsUsed: nextUsed };
}

/** The day's allocation simplex for a player (for the UI / the SL viability read). */
export function dayState(db, userId, dayIdx, budget = SLOTS_PER_DAY()) {
  const r = row(db, userId, dayIdx);
  let log = []; try { log = JSON.parse(r?.log_json || "[]"); } catch { /* noop */ }
  const used = Math.max(0, Number(r?.slots_used) || 0);
  return { slotsUsed: used, remaining: remaining(used, budget), budget, allocation: dayAllocation(log, budget), log };
}
