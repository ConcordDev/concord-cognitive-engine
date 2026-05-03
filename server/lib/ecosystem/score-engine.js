// server/lib/ecosystem/score-engine.js
//
// Per-player metrics for the four reactivity scalars. Updated via small
// hooks scattered across gather, kill, craft, publish, vote, etc. Designed
// so each call site is a one-liner — no parallel ecosystem-tracking logic.
//
// Reactivity bindings (lore-anchored):
//   - Concordia (goddess) reads ecosystem_score
//   - Concord reads concord_alignment
//   - The Sovereign reads refusal_debt + total imbalance
//   - Coalition NPCs (Enforcer, Luminary) read concord_alignment as a
//     residual-grudge proxy (Coalition members distrusted Sovereign loyalty)

const SOFT_FLOOR = -100;
const SOFT_CEILING = 100;

function clamp(v) {
  if (v < SOFT_FLOOR) return SOFT_FLOOR;
  if (v > SOFT_CEILING) return SOFT_CEILING;
  return v;
}

function ensureRow(db, userId, worldId) {
  db.prepare(`
    INSERT OR IGNORE INTO player_world_metrics (user_id, world_id)
    VALUES (?, ?)
  `).run(userId, worldId);
}

/**
 * Apply a metrics delta. Pass any subset of the four axes; missing axes
 * are left untouched. All values are clamped to [-100, 100].
 *
 * Examples:
 *   adjust(db, u, w, { ecosystem_score: +1, source: 'gather:herb' })
 *   adjust(db, u, w, { ecosystem_score: -3, source: 'overhunt:deer' })
 *   adjust(db, u, w, { refusal_debt: +5, source: 'pvp:no_consent' })
 */
export function adjust(db, userId, worldId, delta = {}) {
  if (!db || !userId || !worldId) return;
  ensureRow(db, userId, worldId);
  const sets = [];
  const params = [];
  for (const axis of ["ecosystem_score", "concord_alignment", "concordia_alignment", "refusal_debt"]) {
    if (typeof delta[axis] === "number" && Number.isFinite(delta[axis])) {
      sets.push(`${axis} = MAX(${SOFT_FLOOR}, MIN(${SOFT_CEILING}, ${axis} + ?))`);
      params.push(delta[axis]);
    }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = unixepoch()`);
  params.push(userId, worldId);
  db.prepare(`UPDATE player_world_metrics SET ${sets.join(", ")} WHERE user_id = ? AND world_id = ?`).run(...params);
}

/**
 * Read the current four-axis metrics for a player in a world.
 * Lazy-creates the row on first read so callers don't have to.
 */
export function getMetrics(db, userId, worldId) {
  if (!db || !userId || !worldId) {
    return { ecosystem_score: 0, concord_alignment: 0, concordia_alignment: 0, refusal_debt: 0 };
  }
  ensureRow(db, userId, worldId);
  const row = db.prepare(`
    SELECT ecosystem_score, concord_alignment, concordia_alignment, refusal_debt, updated_at
    FROM player_world_metrics WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);
  return row ?? { ecosystem_score: 0, concord_alignment: 0, concordia_alignment: 0, refusal_debt: 0 };
}

/**
 * Heartbeat-friendly decay sweep. refusal_debt slowly relaxes back to 0;
 * the alignment scalars don't decay (player choices accumulate).
 */
export function runMetricsDecay({ state: _state, db, tickCount: _tickCount }) {
  if (!db) return { ok: false };
  // 1% relative decay per pass on refusal_debt; tiny absolute floor so
  // very high values come back to baseline within ~50 passes.
  const r = db.prepare(`
    UPDATE player_world_metrics
    SET refusal_debt = CASE
      WHEN refusal_debt > 0 THEN MAX(0, refusal_debt * 0.99 - 0.05)
      WHEN refusal_debt < 0 THEN MIN(0, refusal_debt * 0.99 + 0.05)
      ELSE 0
    END,
    updated_at = unixepoch()
    WHERE refusal_debt != 0
  `).run();
  return { ok: true, decayed: r.changes };
}

/**
 * Compute the Sovereign-visit signal: high refusal_debt OR strong imbalance
 * between concord_alignment and concordia_alignment. Returns a score 0..1.
 * Caller decides on threshold.
 */
export function sovereignVisitSignal(metrics) {
  const debt = Math.abs(metrics.refusal_debt) / SOFT_CEILING;
  const tension = Math.abs(metrics.concord_alignment - metrics.concordia_alignment) / (2 * SOFT_CEILING);
  return clamp(Math.max(debt, tension));
}

/**
 * Compute the Concord-visit signal: pure concord_alignment dominance.
 */
export function concordVisitSignal(metrics) {
  if (metrics.concord_alignment <= 0) return 0;
  return Math.min(1, metrics.concord_alignment / SOFT_CEILING);
}

/**
 * Compute the Concordia-visit signal: high |ecosystem_score| in either
 * direction (warm or cold encounter).
 */
export function concordiaVisitSignal(metrics) {
  return Math.min(1, Math.abs(metrics.ecosystem_score) / SOFT_CEILING);
}
