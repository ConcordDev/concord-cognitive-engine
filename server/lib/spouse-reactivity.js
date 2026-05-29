// server/lib/spouse-reactivity.js
//
// E4 — the spouse as a complicating force. Gift preferences (Stardew "knowing
// the person") already shipped in gifting.js; what was missing is the
// benchmark's other half: a married NPC who REACTS to who the player is in the
// wider world — the factions they serve, the plots they run, the lives they
// take, and their own death. "Bigger than the love story."
//
// Reactivity moves the courtship affinity (player_courtship, mig 206) and, when
// it sours far enough, estranges the marriage. Deterministic — the delta is a
// function of the spouse's own faction + opinions, never RNG. Guarded so a
// minimal build (no courtship/opinion tables) is a clean no-op.

import { getOpinion } from "./npc-opinions.js";

// ── Reaction dials (playtest fodder — docs/BALANCE_DIALS.md) ─────────────────
const D = Object.freeze({
  faction_join_aligned:   Number(process.env.CONCORD_SPOUSE_FACTION_ALIGN)   || 0.06,
  faction_join_rival:     Number(process.env.CONCORD_SPOUSE_FACTION_RIVAL)   || -0.08,
  faction_join_neutral:   0.02,
  faction_betray_own:     Number(process.env.CONCORD_SPOUSE_BETRAY_OWN)      || -0.14,
  faction_betray_other:   0.03,
  kill_liked:             Number(process.env.CONCORD_SPOUSE_KILL_LIKED)      || -0.10,
  kill_kin:               Number(process.env.CONCORD_SPOUSE_KILL_KIN)        || -0.22,
  kill_enemy:             0.05,
  kill_neutral:           -0.03,
  scheme_exposed:         Number(process.env.CONCORD_SPOUSE_SCHEME)          || -0.05,
  scheme_admired:         0.04, // cruel/paranoid spouses admire ambition
});
const ESTRANGE_THRESHOLD = Number(process.env.CONCORD_SPOUSE_ESTRANGE_THRESHOLD) || -0.3;
const LIKED_OPINION = 20;
const DISLIKED_OPINION = -20;

function tablesReady(db) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_marriages'").get();
  } catch { return false; }
}

/** Active NPC spouses of a player. */
export function getSpouses(db, userId) {
  if (!db || !userId || !tablesReady(db)) return [];
  try {
    return db.prepare(`
      SELECT partner_id AS npcId FROM player_marriages
      WHERE player_user_id = ? AND partner_kind = 'npc' AND dissolved_at IS NULL
    `).all(userId);
  } catch { return []; }
}

function spouseRow(db, npcId) {
  try { return db.prepare(`SELECT id, faction, world_id FROM world_npcs WHERE id = ?`).get(npcId) || null; }
  catch { return null; }
}

function isKin(db, spouseNpcId, otherNpcId) {
  try {
    const r = db.prepare(`
      SELECT 1 FROM npc_relations
      WHERE (npc_id = ? AND related_npc_id = ?) OR (npc_id = ? AND related_npc_id = ?)
      LIMIT 1
    `).get(spouseNpcId, otherNpcId, otherNpcId, spouseNpcId);
    return !!r;
  } catch { return false; }
}

function factionsAtOdds(db, a, b) {
  if (!a || !b || a === b) return false;
  try {
    // faction_relations is a sorted-pair table (kind in war|tension|...).
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const r = db.prepare(`SELECT kind FROM faction_relations WHERE faction_a = ? AND faction_b = ?`).get(lo, hi);
    return r ? ["war", "tension"].includes(r.kind) : false;
  } catch { return false; }
}

/**
 * Compute the affinity delta + a human reason for one spouse reacting to one
 * player event. Pure (reads spouse state, returns a number). Exported for the
 * contract test.
 */
export function computeReaction(db, spouseNpcId, event) {
  const sp = spouseRow(db, spouseNpcId);
  const spouseFaction = sp?.faction || null;
  switch (event.kind) {
    case "faction_join": {
      if (spouseFaction && event.factionId === spouseFaction) return { delta: D.faction_join_aligned, reason: "proud you joined our cause" };
      if (factionsAtOdds(db, spouseFaction, event.factionId)) return { delta: D.faction_join_rival, reason: "you threw in with our rivals" };
      return { delta: D.faction_join_neutral, reason: "noted your new allegiance" };
    }
    case "faction_betray": {
      if (spouseFaction && event.factionId === spouseFaction) return { delta: D.faction_betray_own, reason: "you betrayed my people" };
      return { delta: D.faction_betray_other, reason: "your enemies are fewer now" };
    }
    case "npc_killed": {
      if (event.targetNpcId && isKin(db, spouseNpcId, event.targetNpcId)) return { delta: D.kill_kin, reason: "you killed my kin" };
      const op = getOpinion(db, spouseNpcId, "npc", event.targetNpcId)?.score ?? 0;
      if (op >= LIKED_OPINION) return { delta: D.kill_liked, reason: "you killed someone I cared for" };
      if (op <= DISLIKED_OPINION) return { delta: D.kill_enemy, reason: "you rid us of an enemy" };
      return { delta: D.kill_neutral, reason: "your hands are bloodied again" };
    }
    case "scheme_exposed": {
      let coping = null;
      try { coping = db.prepare(`SELECT coping_trait FROM npc_stress WHERE npc_id = ?`).get(spouseNpcId)?.coping_trait || null; } catch { /* ignore */ }
      if (coping === "cruel" || coping === "paranoid") return { delta: D.scheme_admired, reason: "admires your ruthlessness" };
      return { delta: D.scheme_exposed, reason: "your scheming shames our house" };
    }
    case "player_death":
      // Grief, not an affinity move — the marriage isn't damaged by your dying.
      return { delta: 0, reason: "grieves and waits for your return" };
    default:
      return { delta: 0, reason: null };
  }
}

/**
 * Apply a player event to every NPC spouse: shift affinity, possibly estrange
 * the marriage, emit `spouse:reaction`. Returns { ok, reactions:[...] }.
 */
export function reactToPlayerEvent(db, userId, event = {}) {
  if (!db || !userId || !event.kind || !tablesReady(db)) return { ok: false, reason: "noop", reactions: [] };
  const spouses = getSpouses(db, userId);
  if (spouses.length === 0) return { ok: true, reactions: [] };
  const emit = typeof globalThis._concordRealtimeEmit === "function" ? globalThis._concordRealtimeEmit : null;
  const reactions = [];

  for (const { npcId } of spouses) {
    const { delta, reason } = computeReaction(db, npcId, event);
    let affinity = null, estranged = false;
    try {
      const row = db.prepare(`
        SELECT affinity, status FROM player_courtship
        WHERE player_user_id = ? AND partner_kind = 'npc' AND partner_id = ?
      `).get(userId, npcId);
      if (row) {
        affinity = Math.max(-1, Math.min(1, row.affinity + delta));
        let status = row.status;
        // Souring a marriage past the threshold estranges it (a real cost).
        if (status === "married" && affinity < ESTRANGE_THRESHOLD) { status = "estranged"; estranged = true; }
        db.prepare(`
          UPDATE player_courtship SET affinity = ?, status = ?, last_interaction = unixepoch()
          WHERE player_user_id = ? AND partner_kind = 'npc' AND partner_id = ?
        `).run(affinity, status, userId, npcId);
        if (estranged) {
          try {
            db.prepare(`
              UPDATE player_marriages SET dissolved_at = unixepoch(), dissolved_reason = 'estranged'
              WHERE player_user_id = ? AND partner_kind = 'npc' AND partner_id = ? AND dissolved_at IS NULL
            `).run(userId, npcId);
          } catch { /* column optional */ }
        }
      }
    } catch { /* courtship row optional */ }

    const reaction = { npcId, kind: event.kind, delta, reason, affinity, estranged };
    reactions.push(reaction);
    if (emit && (delta !== 0 || event.kind === "player_death")) {
      try { emit("spouse:reaction", { userId, ...reaction }); } catch { /* best-effort */ }
    }
  }
  return { ok: true, reactions };
}

export const SPOUSE_REACTIVITY_CONSTANTS = Object.freeze({ ...D, ESTRANGE_THRESHOLD, LIKED_OPINION, DISLIKED_OPINION });
