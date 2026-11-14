// server/lib/idle-budget.js
//
// IDLE-01 (GB-1540): the idle-life throttle's hard half. idle-behavior's
// weights make idle actions deterministic-first by construction; this
// module is the guarantee behind them — a per-citizen per-day model-call
// budget, counted in the database so it survives restarts (the 5-minute
// cooldown it complements lives in an in-process Map and resets).
//
// One counter row per (citizen, day) also classifies every idle tick's
// outcome, so the 90/10 split the ticket requires is a query over these
// rows — model-carried idle actions ÷ all idle actions — not an estimate
// derived from the weights.
//
// The budget value is an operational parameter (office-set at 12/day,
// env-overridable); the mechanism does not depend on it.

export const IDLE_DAILY_BUDGET_DEFAULT = 12;

export function idleDailyBudget(env = process.env) {
  const n = Number(env.CONCORD_IDLE_DAILY_BUDGET);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : IDLE_DAILY_BUDGET_DEFAULT;
}

/** UTC day key (YYYY-MM-DD) for a timestamp. */
export function idleDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

let _ensured = new WeakSet();

export function ensureIdleTables(db) {
  if (!db || _ensured.has(db)) return !!db;
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS emergent_idle_daily (
        emergent_id TEXT NOT NULL,
        day TEXT NOT NULL,
        model_calls INTEGER NOT NULL DEFAULT 0,
        deterministic_actions INTEGER NOT NULL DEFAULT 0,
        budget_blocks INTEGER NOT NULL DEFAULT 0,
        cooldown_blocks INTEGER NOT NULL DEFAULT 0,
        degenerate_skips INTEGER NOT NULL DEFAULT 0,
        last_sample_sig TEXT,
        PRIMARY KEY (emergent_id, day)
      )
    `).run();
    _ensured.add(db);
    return true;
  } catch {
    return false;
  }
}

function bump(db, emergentId, day, column) {
  try {
    db.prepare(`
      INSERT INTO emergent_idle_daily (emergent_id, day, ${column})
      VALUES (?, ?, 1)
      ON CONFLICT(emergent_id, day) DO UPDATE SET ${column} = ${column} + 1
    `).run(emergentId, day);
  } catch { /* counters never break the tick */ }
}

const OUTCOME_COLUMNS = {
  model: "model_calls",
  deterministic: "deterministic_actions",
  budget: "budget_blocks",
  cooldown: "cooldown_blocks",
  degenerate: "degenerate_skips",
};

/** Classify one idle tick's outcome. Classes: model | deterministic | budget | cooldown | degenerate. */
export function recordIdleOutcome(db, emergentId, cls, ts = Date.now()) {
  if (!db || !emergentId || !OUTCOME_COLUMNS[cls]) return;
  if (!ensureIdleTables(db)) return;
  bump(db, emergentId, idleDayKey(ts), OUTCOME_COLUMNS[cls]);
}

/** Model calls spent by this citizen today (UTC day). */
export function idleModelCallsToday(db, emergentId, ts = Date.now()) {
  if (!db || !emergentId || !ensureIdleTables(db)) return 0;
  try {
    const row = db.prepare(
      "SELECT model_calls FROM emergent_idle_daily WHERE emergent_id = ? AND day = ?",
    ).get(emergentId, idleDayKey(ts));
    return row?.model_calls || 0;
  } catch { return 0; }
}

/**
 * Spend one model call against today's budget. Returns true when the
 * call is admitted (and counted); false when the budget is exhausted
 * (the block is counted instead). The driver is synchronous, so the
 * read-then-spend cannot interleave.
 */
export function trySpendIdleModelCall(db, emergentId, budget = idleDailyBudget(), ts = Date.now()) {
  if (!emergentId) return false;
  if (!db) return true; // no store → the cooldown remains the throttle (pre-budget behaviour)
  if (!ensureIdleTables(db)) return true;
  if (idleModelCallsToday(db, emergentId, ts) >= budget) {
    recordIdleOutcome(db, emergentId, "budget", ts);
    return false;
  }
  recordIdleOutcome(db, emergentId, "model", ts);
  return true;
}

/** The citizen's last observe-sample signature (IDLE-02's repeat leg). */
export function lastIdleSampleSig(db, emergentId, ts = Date.now()) {
  if (!db || !emergentId || !ensureIdleTables(db)) return null;
  try {
    const row = db.prepare(
      "SELECT last_sample_sig FROM emergent_idle_daily WHERE emergent_id = ? AND day = ?",
    ).get(emergentId, idleDayKey(ts));
    return row?.last_sample_sig || null;
  } catch { return null; }
}

export function setIdleSampleSig(db, emergentId, sig, ts = Date.now()) {
  if (!db || !emergentId || !ensureIdleTables(db)) return;
  try {
    db.prepare(`
      INSERT INTO emergent_idle_daily (emergent_id, day, last_sample_sig)
      VALUES (?, ?, ?)
      ON CONFLICT(emergent_id, day) DO UPDATE SET last_sample_sig = excluded.last_sample_sig
    `).run(emergentId, idleDayKey(ts), sig);
  } catch { /* never break the tick */ }
}

/**
 * The 90/10 measurement: model-carried vs deterministic idle actions over
 * a trailing window of whole UTC days (including today).
 * @returns {{model: number, deterministic: number, modelShare: number|null}}
 */
export function idleSplit(db, days = 1, ts = Date.now()) {
  if (!db || !ensureIdleTables(db)) return { model: 0, deterministic: 0, modelShare: null };
  try {
    const keys = [];
    for (let i = 0; i < Math.max(1, days); i++) keys.push(idleDayKey(ts - i * 86400_000));
    const placeholders = keys.map(() => "?").join(",");
    const row = db.prepare(`
      SELECT COALESCE(SUM(model_calls), 0) AS model,
             COALESCE(SUM(deterministic_actions), 0) AS deterministic
      FROM emergent_idle_daily WHERE day IN (${placeholders})
    `).get(...keys);
    const model = row?.model || 0;
    const deterministic = row?.deterministic || 0;
    const total = model + deterministic;
    return { model, deterministic, modelShare: total ? model / total : null };
  } catch {
    return { model: 0, deterministic: 0, modelShare: null };
  }
}
