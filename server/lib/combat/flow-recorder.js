// server/lib/combat/flow-recorder.js
//
// Append-only recorder for combat actions. Every hit/miss/parry/spell-cast
// becomes one row in combat_flows. The flow engine reads aggregates over
// these rows to learn a fighter's style and emit procedural combos.
//
// Hot-path: this is called inside the combat:attack socket handler. Keep
// the work O(1) per call. Aggregation happens in flow-engine, not here.

import crypto from "node:crypto";
import logger from "../../logger.js";

const ACTIONS = new Set([
  "attack-light", "attack-heavy", "parry", "block", "dodge",
  "spell", "combo-step", "ranged", "throw", "grapple",
  // Phase 4 — keyboard input controller verbs:
  "kick", "modifier-boost",
]);

/**
 * Record one combat action.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {Object}  evt
 * @param {string}  evt.fighterId
 * @param {string}  [evt.fighterKind="player"]    — "player" | "npc"
 * @param {string}  evt.context                   — from context-engine
 * @param {string}  [evt.style]                   — style hint ("ufc", "aerial-chain", ...)
 * @param {string}  evt.action                    — must be in ACTIONS
 * @param {Object}  [evt.actionMeta={}]
 * @param {string}  [evt.targetId]
 * @param {boolean} [evt.hit=false]
 * @param {number}  [evt.damage=0]
 * @param {boolean} [evt.isCrit=false]
 * @param {string}  [evt.chainId]                 — same chainId across consecutive actions
 * @param {number}  [evt.stepIndex=0]
 * @returns {{ ok: boolean, flowId?: string, error?: string }}
 */
export function recordCombatFlow(db, evt = {}) {
  if (!db || !evt.fighterId || !evt.context || !evt.action) {
    return { ok: false, error: "missing_required" };
  }
  if (!ACTIONS.has(evt.action)) {
    return { ok: false, error: "unknown_action" };
  }

  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO combat_flows
        (id, fighter_id, fighter_kind, context, style, action, action_meta,
         target_id, hit, damage, is_crit, chain_id, step_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(evt.fighterId),
      String(evt.fighterKind || "player"),
      String(evt.context),
      evt.style ? String(evt.style) : null,
      String(evt.action),
      JSON.stringify(evt.actionMeta || {}),
      evt.targetId ? String(evt.targetId) : null,
      evt.hit ? 1 : 0,
      Number(evt.damage || 0),
      evt.isCrit ? 1 : 0,
      evt.chainId ? String(evt.chainId) : null,
      Math.max(0, Math.floor(Number(evt.stepIndex || 0))),
    );
    return { ok: true, flowId: id };
  } catch (err) {
    logger.warn?.("combat_flow", "record_failed", { err: err.message, fighterId: evt.fighterId });
    return { ok: false, error: err.message };
  }
}

/**
 * Read recent flows for a fighter, optionally filtered by context. Returns
 * raw rows with action_meta parsed. Used by the flow engine to evolve combos
 * and by the suggest endpoint to hint the next action.
 */
export function getRecentFlows(db, fighterId, opts = {}) {
  if (!db || !fighterId) return [];
  const limit   = Math.max(1, Math.min(500, Number(opts.limit ?? 100)));
  const context = opts.context ? String(opts.context) : null;
  const sinceTs = typeof opts.sinceTs === "number" ? opts.sinceTs : null;
  const rows = context
    ? db.prepare(`
        SELECT * FROM combat_flows
        WHERE fighter_id = ? AND context = ? ${sinceTs ? "AND ts >= ?" : ""}
        ORDER BY ts DESC LIMIT ?
      `).all(...[fighterId, context, ...(sinceTs ? [sinceTs] : []), limit])
    : db.prepare(`
        SELECT * FROM combat_flows
        WHERE fighter_id = ? ${sinceTs ? "AND ts >= ?" : ""}
        ORDER BY ts DESC LIMIT ?
      `).all(...[fighterId, ...(sinceTs ? [sinceTs] : []), limit]);
  return rows.map((r) => {
    let meta = {};
    try { meta = JSON.parse(r.action_meta); } catch { meta = {}; }
    return { ...r, action_meta: meta };
  });
}

/**
 * Aggregate flows into a fighter profile — totals + per-context style
 * preference. Used by the hotbar UI to surface "your favourite style here is X"
 * and by the flow engine to decide when to emit a procedural combo.
 *
 * Returns:
 *   {
 *     fighterId,
 *     totalActions,
 *     hits, misses, parries, blocks, dodges, spells,
 *     accuracy,
 *     byContext: {
 *       [context]: {
 *         actions, hits, accuracy,
 *         topStyles: [{ style, count }],
 *         topActions: [{ action, count }],
 *       }
 *     }
 *   }
 */
export function getFighterFlowProfile(db, fighterId) {
  if (!db || !fighterId) return null;

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS hits,
      SUM(CASE WHEN action = 'parry' THEN 1 ELSE 0 END) AS parries,
      SUM(CASE WHEN action = 'block' THEN 1 ELSE 0 END) AS blocks,
      SUM(CASE WHEN action = 'dodge' THEN 1 ELSE 0 END) AS dodges,
      SUM(CASE WHEN action = 'spell' THEN 1 ELSE 0 END) AS spells
    FROM combat_flows
    WHERE fighter_id = ?
  `).get(fighterId);

  const total   = totals?.total ?? 0;
  const hits    = totals?.hits ?? 0;
  const misses  = Math.max(0, total - hits);

  const byContext = {};
  const ctxRows = db.prepare(`
    SELECT context, COUNT(*) AS n,
           SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS h
    FROM combat_flows
    WHERE fighter_id = ?
    GROUP BY context
  `).all(fighterId);
  for (const r of ctxRows) {
    const styleRows = db.prepare(`
      SELECT style, COUNT(*) AS c
      FROM combat_flows
      WHERE fighter_id = ? AND context = ? AND style IS NOT NULL
      GROUP BY style ORDER BY c DESC LIMIT 5
    `).all(fighterId, r.context);
    const actionRows = db.prepare(`
      SELECT action, COUNT(*) AS c
      FROM combat_flows
      WHERE fighter_id = ? AND context = ?
      GROUP BY action ORDER BY c DESC LIMIT 5
    `).all(fighterId, r.context);
    byContext[r.context] = {
      actions: r.n,
      hits: r.h,
      accuracy: r.n > 0 ? r.h / r.n : 0,
      topStyles: styleRows.map((s) => ({ style: s.style, count: s.c })),
      topActions: actionRows.map((a) => ({ action: a.action, count: a.c })),
    };
  }

  return {
    fighterId,
    totalActions: total,
    hits,
    misses,
    parries: totals?.parries ?? 0,
    blocks:  totals?.blocks ?? 0,
    dodges:  totals?.dodges ?? 0,
    spells:  totals?.spells ?? 0,
    accuracy: total > 0 ? hits / total : 0,
    byContext,
  };
}

export const _internal = { ACTIONS };
