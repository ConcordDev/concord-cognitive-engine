/**
 * Council ↔ World Bridge
 *
 * When a CRI summit resolves with decisions, this bridge:
 *   1. Writes a `referendum` world event so players see the outcome surface in-world.
 *   2. Persists the decision into `faction_policy_state` for any factions named in
 *      the summit's metadata, so NPC dialogue + behavior can react.
 *
 * Decoupled from cri-system to keep the council module pure (no DB, no world
 * dependencies). cri-system imports this lazily and ignores any bridge failure.
 *
 * The faction_policy_state table is created by migration 078.
 */

import logger from "../logger.js";

const MAX_POLICY_HISTORY = 20;

/**
 * Persist a referendum outcome to a faction's policy state. Idempotent on
 * duplicate (summit_id, decision) pairs — they overwrite the timestamp.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} factionId
 * @param {{ topic: string, outcome: string, summit_id: string }} entry
 */
export function recordFactionPolicy(db, factionId, entry) {
  if (!db || !factionId || !entry?.outcome) return false;

  const ts = Math.floor(Date.now() / 1000);
  const row = db.prepare(`SELECT policy_state_json FROM faction_policy_state WHERE faction_id = ?`).get(factionId);

  let history = [];
  if (row?.policy_state_json) {
    try { history = JSON.parse(row.policy_state_json); } catch { history = []; }
    if (!Array.isArray(history)) history = [];
  }

  // Drop any prior entry from the same summit + decision so the bridge is idempotent
  history = history.filter(h => !(h.summit_id === entry.summit_id && h.outcome === entry.outcome));
  history.unshift({ ...entry, ts });
  if (history.length > MAX_POLICY_HISTORY) history = history.slice(0, MAX_POLICY_HISTORY);

  db.prepare(`
    INSERT INTO faction_policy_state (faction_id, policy_state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(faction_id) DO UPDATE SET
      policy_state_json = excluded.policy_state_json,
      updated_at        = excluded.updated_at
  `).run(factionId, JSON.stringify(history), ts);

  return true;
}

/**
 * Read a faction's resolved-referendum history. Used by NPC dialogue/behavior
 * shifts so the world reacts to council decisions.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} factionId
 * @returns {Array<{topic: string, outcome: string, summit_id: string, ts: number}>}
 */
export function getFactionPolicyState(db, factionId) {
  if (!db || !factionId) return [];
  const row = db.prepare(`SELECT policy_state_json FROM faction_policy_state WHERE faction_id = ?`).get(factionId);
  if (!row?.policy_state_json) return [];
  try {
    const parsed = JSON.parse(row.policy_state_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * Bridge a completed CRI summit into the world. Called by cri-system.completeSummit
 * inside a try/catch — failure here is silent and never blocks the summit completion.
 *
 * @param {object} args
 * @param {import('better-sqlite3').Database} args.db
 * @param {object} args.summit  - the summit object after outcomes applied
 * @param {object} args.cri     - the parent CRI (for domain → city mapping)
 * @param {Function} args.createEvent  - world-events.createEvent (injected to avoid circular deps)
 * @param {Array<string>} [args.factionIds] - optional list of factions affected
 * @returns {{ ok: boolean, eventId?: string, factionsUpdated?: number, error?: string }}
 */
export function bridgeSummitToWorld({ db, summit, cri, createEvent, factionIds = [] }) {
  try {
    const decisions = Array.isArray(summit?.outcomes?.decisionsReached)
      ? summit.outcomes.decisionsReached
      : [];
    if (decisions.length === 0) return { ok: true, eventId: null, factionsUpdated: 0 };

    const cityId   = (cri?.domain && `cri:${cri.domain}`) || "concordia";
    const summary  = decisions.slice(0, 3).join("; ");
    const fullList = decisions.join("\n• ");

    let eventId = null;
    if (typeof createEvent === "function") {
      const event = createEvent({
        cityId,
        hostId:      "system_council",
        type:        "referendum",
        name:        `Referendum: ${summary.slice(0, 60)}`,
        description: `The ${cri?.name || "Council"} resolved the following:\n• ${fullList}`,
        tags:        ["referendum", "council", `cri:${cri?.id || "unknown"}`, `summit:${summit.id}`],
        rewards:     [],
        visibility:  "public",
        entryFee:    0,
      });
      eventId = event?.id || null;
    }

    let factionsUpdated = 0;
    for (const factionId of factionIds) {
      for (const decision of decisions) {
        if (recordFactionPolicy(db, factionId, {
          topic:     summit.title || "council_decision",
          outcome:   decision,
          summit_id: summit.id,
        })) factionsUpdated++;
      }
    }

    return { ok: true, eventId, factionsUpdated };
  } catch (err) {
    try { logger?.warn?.({ err: err?.message }, "council_world_bridge_failed"); } catch { /* logger best-effort */ }
    return { ok: false, error: err?.message || "bridge_failed" };
  }
}
