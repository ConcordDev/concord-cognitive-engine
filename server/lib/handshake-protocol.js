// server/lib/handshake-protocol.js
//
// The Handshake Protocol — concord-link-frontier's own bespoke mechanic,
// derived directly from that world's ALREADY-AUTHORED lore rather than
// invented fiction. Two citations ground every design decision below:
//
//   content/world/concord-link-frontier/lore.json → "frontier_lore_handshake_protocol"
//     (Year 91): "Temir negotiated the Handshake Protocol that allows a
//     Freenode and a Courier to bear witness to each other's parcels. The
//     Protocol is a piece of glyph-algebra borrowed from the Sovereign
//     Archive: a parcel's record cannot be valid unless both signatures
//     appear. The Protocol does not solve the rivalry, but it has
//     prevented a single lost parcel since."
//
//   content/world/concord-link-frontier/factions.json → both
//     `frontier_couriers_guild` and `frontier_freenodes` list
//     `"reputation_currency": "trust_marks"` — trust_marks is this
//     world's own native reputation resource, already authored on NPC
//     inventories (e.g. postmaster_ria carries 30, broker_temir 40).
//
//   content/world/concord-link-frontier/meta.json → `lore_anchor_to_
//     concordia`: "The Frontier is the only place where Concord-Link
//     walker journeys can be physically witnessed. Every walker that
//     connects two cities passes through here." — this is why the
//     mechanic is Frontier-EXCLUSIVE: only a from_world_id of
//     'concord-link-frontier' may witness a Handshake.
//
// Mechanic: a player spends trust_marks (this world's native currency)
// to formally WITNESS a cross-world resonance link — i.e. make the
// "both signatures" of the Handshake Protocol real by pushing an
// existing `cross_npc_relationships` edge's `resonance_strength` toward
// its cap and upgrading its `kind` to 'contracted' (a value the
// existing VALID_KINDS enum in cross-world-relationships.js already
// carries — no schema change needed for the relationship side).
//
// Honest failure, never partial effect: every rejection path below
// returns BEFORE any DB write. The debit + boost happen inside one
// db.transaction so a mid-way throw can never leave trust_marks spent
// without the resonance actually moving (or vice versa).

import { getKillSwitchMode } from "./cross-world-economy.js";
import { getRelation } from "./cross-world-relationships.js";

export const HANDSHAKE_CONSTANTS = Object.freeze({
  FRONTIER_WORLD_ID: "concord-link-frontier",
  TRUST_MARKS_PER_POINT: 5,     // cost of +1 resonance_strength
  MAX_BOOST_PER_CALL: 20,       // one Handshake session can't fully resolve a rivalry —
                                 // "The Protocol does not solve the rivalry" (lore, Year 91)
  WITNESSED_KIND: "contracted", // existing VALID_KINDS value in cross-world-relationships.js
});

const {
  FRONTIER_WORLD_ID,
  TRUST_MARKS_PER_POINT,
  MAX_BOOST_PER_CALL,
  WITNESSED_KIND,
} = HANDSHAKE_CONSTANTS;

function killSwitchAllowsCrossWorld(db) {
  return getKillSwitchMode(db) === "live";
}

/**
 * Sum of a user's trust_marks across every player_inventory slot.
 * Honest zero (never fabricated) when the table is missing or the
 * player holds none.
 */
export function getTrustMarksBalance(db, userId) {
  if (!db || !userId) return 0;
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM player_inventory
      WHERE user_id = ? AND item_id = 'trust_marks'
    `).get(userId);
    return row?.total || 0;
  } catch {
    return 0;
  }
}

// FIFO consumption across slots — the same idiom `glyph-spells.js#mintSpell`
// uses for fuel items. User-global by design (per the player-inventory
// invariant in CLAUDE.md): trust_marks earned anywhere debits the same
// way; world_id on a slot, where present, is acquisition metadata only,
// never a consumption filter. In practice a UNIQUE(user_id, item_id)
// constraint (migration 093) means there is only ever one real slot per
// item per user today — the multi-slot loop below is defensive, not
// exercised by the current schema, and harmless either way.
function consumeTrustMarks(db, userId, amount) {
  let remaining = amount;
  const slots = db.prepare(`
    SELECT id, quantity FROM player_inventory
    WHERE user_id = ? AND item_id = 'trust_marks' AND quantity > 0
    ORDER BY acquired_at ASC
  `).all(userId);
  const dec = db.prepare(`UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`);
  const del = db.prepare(`DELETE FROM player_inventory WHERE id = ?`);
  for (const slot of slots) {
    if (remaining <= 0) break;
    const take = Math.min(slot.quantity, remaining);
    if (take >= slot.quantity) del.run(slot.id);
    else dec.run(take, slot.id);
    remaining -= take;
  }
}

/**
 * witnessHandshake — spend trust_marks to formally witness a cross-world
 * resonance edge FROM a concord-link-frontier NPC to another world's NPC,
 * pushing `resonance_strength` toward the cap and upgrading the edge's
 * `kind` to 'contracted' (a witnessed Handshake).
 *
 * opts: { userId, fromWorld, fromNpcId, toWorld, toNpcId, trustMarksToSpend }
 *
 * Honest failure states (no DB write on any of these — the resource
 * check + the relationship check both run before the transaction):
 *   missing_inputs | not_frontier_scoped | same_world |
 *   kill_switch_<mode> | no_relationship | already_at_cap |
 *   spend_too_small | insufficient_trust_marks
 */
export function witnessHandshake(db, opts = {}) {
  const { userId, fromWorld, fromNpcId, toWorld, toNpcId, trustMarksToSpend } = opts;

  if (!db || !userId || !fromWorld || !fromNpcId || !toWorld || !toNpcId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const spend = Number(trustMarksToSpend);
  if (!Number.isFinite(spend) || spend <= 0) {
    return { ok: false, reason: "missing_inputs" };
  }

  // Frontier-exclusive by design (meta.json lore_anchor_to_concordia: "The
  // Frontier is the only place where Concord-Link walker journeys can be
  // physically witnessed"). This is the scoping guard — it runs before any
  // other check so an off-world call never touches the DB.
  if (fromWorld !== FRONTIER_WORLD_ID) {
    return { ok: false, reason: "not_frontier_scoped" };
  }
  if (toWorld === fromWorld) {
    return { ok: false, reason: "same_world" };
  }

  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }

  // A Handshake WITNESSES an existing correspondence — it does not create
  // one out of nothing. Mirrors cross-world-schemes.js's own
  // "you can't plot against someone you have no resonance with" gate.
  const rel = getRelation(db, fromWorld, fromNpcId, toWorld, toNpcId);
  if (!rel) return { ok: false, reason: "no_relationship" };

  const headroom = 100 - rel.resonance_strength;
  if (headroom <= 0) return { ok: false, reason: "already_at_cap" };

  const affordablePoints = Math.floor(spend / TRUST_MARKS_PER_POINT);
  if (affordablePoints < 1) return { ok: false, reason: "spend_too_small" };

  const pointsGained = Math.min(affordablePoints, MAX_BOOST_PER_CALL, headroom);
  const cost = pointsGained * TRUST_MARKS_PER_POINT;

  const balance = getTrustMarksBalance(db, userId);
  if (balance < cost) {
    return { ok: false, reason: "insufficient_trust_marks", required: cost, available: balance };
  }

  const newStrength = rel.resonance_strength + pointsGained;

  const tx = db.transaction(() => {
    consumeTrustMarks(db, userId, cost);
    db.prepare(`
      UPDATE cross_npc_relationships
      SET resonance_strength = ?,
          kind = ?,
          established_via = 'handshake_witnessed',
          last_signal_at = unixepoch()
      WHERE from_world_id = ? AND from_npc_id = ? AND to_world_id = ? AND to_npc_id = ?
    `).run(newStrength, WITNESSED_KIND, fromWorld, fromNpcId, toWorld, toNpcId);
  });
  tx();

  return {
    ok: true,
    pointsGained,
    cost,
    newStrength,
    kind: WITNESSED_KIND,
    remainingTrustMarks: balance - cost,
  };
}
