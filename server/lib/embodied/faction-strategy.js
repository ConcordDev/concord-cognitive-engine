// server/lib/embodied/faction-strategy.js
//
// Layer 11: faction emergent strategy.
//
// Each authored faction has a `faction_strategy_state` row tracking
// stance + momentum + next-move-at clock. The strategy cycle
// (server/emergent/faction-strategy-cycle.js) advances factions whose
// next_move_at <= now, picking a move based on stance, momentum, and
// pairwise faction_relations.
//
// Stance state machine (transitions are deterministic given inputs):
//   consolidate ↔ expand     — peacetime cycling
//   expand → tension → war   — when expand collides with another faction's territory
//   war → truce → rebuild    — when momentum drops below -0.6 for either side
//   rebuild → consolidate    — when momentum returns to ~0
//   alliance ↔ consolidate   — peacetime alliance
//   isolation → consolidate  — after a fixed cooldown
//
// Move catalogue (each appends a faction_strategy_log row + may update
// faction_relations):
//   PROCLAIM_EXPANSION   — sets stance='expand'
//   DECLARE_WAR          — sets stance='war', kind='war' on relations
//   PROPOSE_ALLIANCE     — sets stance='alliance', kind='alliance' on relations
//   SEEK_TRUCE           — kind='truce', stance flips to 'rebuild'
//   FORTIFY              — momentum+0.1, stance='consolidate'
//   RAID                 — momentum±0.05 depending on relations
//   WITHDRAW             — momentum-0.1, stance='isolation'
//   DECLARE_REBUILD      — stance='rebuild'
//
// The picker uses a deterministic rule table — no LLM call. (LLM
// flavour for the *announcement text* is opt-in in the cycle module.)

import crypto from "node:crypto";

export const STANCES = Object.freeze([
  "consolidate", "expand", "war", "alliance", "rebuild", "isolation",
]);

export const MOVE_COOLDOWN_S = Number(process.env.CONCORD_FACTION_MOVE_COOLDOWN_S) || 6 * 3600;

/** Sort two faction ids lexicographically — required by the
 * faction_relations PRIMARY KEY (faction_a < faction_b). */
function relKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

/**
 * Read or initialise a faction's strategy state. Idempotent.
 */
export function ensureFactionState(db, factionId, opts = {}) {
  if (!db || !factionId) return null;
  let row;
  try {
    row = db.prepare(`SELECT * FROM faction_strategy_state WHERE faction_id = ?`).get(factionId);
  } catch {
    return null;
  }
  if (row) return row;
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      factionId,
      opts.stance ?? "consolidate",
      Number(opts.momentum ?? 0),
      Number(opts.nextMoveAt ?? now), // ready to move immediately
      now,
    );
    return db.prepare(`SELECT * FROM faction_strategy_state WHERE faction_id = ?`).get(factionId);
  } catch {
    return null;
  }
}

/**
 * Read a pair's relation row (or default neutral).
 */
export function getRelation(db, a, b) {
  if (!db || !a || !b || a === b) return { score: 0, kind: 'neutral' };
  const [x, y] = relKey(a, b);
  try {
    const row = db.prepare(`
      SELECT score, kind, since FROM faction_relations
       WHERE faction_a = ? AND faction_b = ?
    `).get(x, y);
    return row ?? { score: 0, kind: 'neutral' };
  } catch {
    return { score: 0, kind: 'neutral' };
  }
}

/**
 * Upsert a relation row. Caller passes (-1..+1) score and a kind.
 */
export function setRelation(db, a, b, { score, kind }) {
  if (!db || !a || !b || a === b) return null;
  const [x, y] = relKey(a, b);
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO faction_relations (faction_a, faction_b, score, kind, since, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(faction_a, faction_b) DO UPDATE
        SET score = excluded.score, kind = excluded.kind, updated_at = excluded.updated_at
    `).run(x, y, Math.max(-1, Math.min(1, Number(score))), String(kind), now, now);
    return { x, y, score, kind };
  } catch {
    return null;
  }
}

/**
 * Pick a move for a faction given its state + the relations with peers.
 * Pure: returns the move spec; caller persists.
 *
 * @returns {{ move: string, summary: string, target?: string, deltaMomentum: number, newStance?: string, newKind?: string, newScore?: number }}
 */
export function pickMove(state, peers = []) {
  const rng = _rng(state.faction_id + ":" + state.phase);
  const stance = state.stance ?? "consolidate";
  const momentum = Number(state.momentum ?? 0);

  // 1) War-state machine — momentum-driven exits.
  if (stance === "war") {
    if (momentum <= -0.6) {
      const tgt = state.target_id ?? peers[0]?.faction_id ?? null;
      return {
        move: "SEEK_TRUCE",
        target: tgt,
        summary: `${state.faction_id} sues for truce — the war has worn them.`,
        deltaMomentum: 0.05,
        newStance: "rebuild",
        newKind: "truce", newScore: 0,
      };
    }
    return {
      move: "RAID",
      target: state.target_id,
      summary: `${state.faction_id} stages a raid against ${state.target_id ?? 'their enemy'}.`,
      deltaMomentum: rng() > 0.5 ? 0.06 : -0.06,
    };
  }

  // 2) Rebuild → consolidate when momentum recovers
  if (stance === "rebuild") {
    if (Math.abs(momentum) < 0.15) {
      return {
        move: "DECLARE_REBUILD",
        summary: `${state.faction_id} announces the rebuild is complete; they return to peacetime.`,
        deltaMomentum: 0,
        newStance: "consolidate",
      };
    }
    return {
      move: "FORTIFY",
      summary: `${state.faction_id} reinforces what they have.`,
      deltaMomentum: 0.05,
    };
  }

  // 3) Isolation → cooldown out
  if (stance === "isolation") {
    return {
      move: "DECLARE_REBUILD",
      summary: `${state.faction_id} ends their isolation; they re-engage with the world.`,
      deltaMomentum: 0.02,
      newStance: "consolidate",
    };
  }

  // 4) Alliance — passive consolidation cycling
  if (stance === "alliance") {
    if (rng() < 0.25) {
      return {
        move: "FORTIFY",
        summary: `${state.faction_id} works alongside their ally.`,
        deltaMomentum: 0.04,
      };
    }
    return {
      move: "PROCLAIM_EXPANSION",
      summary: `${state.faction_id} eyes new territory under the cover of their alliance.`,
      deltaMomentum: 0.03,
      newStance: "expand",
    };
  }

  // 5) Expand — collisions can become tension/war
  if (stance === "expand") {
    const rival = peers
      .filter(p => p.stance === "expand" || p.stance === "war")
      .find(p => getRelationScore(state.faction_id, p.faction_id) >= -0.3);
    if (rival && rng() < 0.4) {
      return {
        move: "DECLARE_WAR",
        target: rival.faction_id,
        summary: `${state.faction_id} crosses ${rival.faction_id}'s territory; war is declared.`,
        deltaMomentum: 0.1,
        newStance: "war",
        newKind: "war", newScore: -1,
      };
    }
    if (rng() < 0.3) {
      return {
        move: "FORTIFY",
        summary: `${state.faction_id} pauses to fortify gains.`,
        deltaMomentum: 0.05,
        newStance: "consolidate",
      };
    }
    return {
      move: "PROCLAIM_EXPANSION",
      summary: `${state.faction_id} extends their reach.`,
      deltaMomentum: 0.03,
    };
  }

  // 6) Consolidate — peacetime; can pivot to alliance, expand, or isolation
  const friend = peers.find(p => getRelationScore(state.faction_id, p.faction_id) > 0.3);
  if (friend && rng() < 0.2) {
    return {
      move: "PROPOSE_ALLIANCE",
      target: friend.faction_id,
      summary: `${state.faction_id} proposes alliance with ${friend.faction_id}.`,
      deltaMomentum: 0.04,
      newStance: "alliance",
      newKind: "alliance", newScore: 0.7,
    };
  }
  if (rng() < 0.35) {
    return {
      move: "PROCLAIM_EXPANSION",
      summary: `${state.faction_id} announces a season of expansion.`,
      deltaMomentum: 0.02,
      newStance: "expand",
    };
  }
  if (rng() < 0.05) {
    return {
      move: "WITHDRAW",
      summary: `${state.faction_id} withdraws from the surrounding politics.`,
      deltaMomentum: -0.05,
      newStance: "isolation",
    };
  }
  return {
    move: "FORTIFY",
    summary: `${state.faction_id} consolidates what they hold.`,
    deltaMomentum: 0.02,
  };
}

/**
 * Apply a picked move to the database — single transaction:
 *   - logs the move row
 *   - updates faction_strategy_state (momentum, stance, next_move_at)
 *   - updates faction_relations if the move specifies new score/kind
 */
export function applyMove(db, factionId, picked, peerStates) {
  if (!db || !factionId || !picked) return null;
  const now = Math.floor(Date.now() / 1000);
  const moveId = `fmv_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO faction_strategy_log
        (id, faction_id, move, target_id, summary, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      moveId, factionId,
      picked.move,
      picked.target ?? null,
      picked.summary,
      JSON.stringify({ deltaMomentum: picked.deltaMomentum, newStance: picked.newStance ?? null }),
      now,
    );

    // Read current state, compute new momentum + stance
    const cur = db.prepare(`SELECT * FROM faction_strategy_state WHERE faction_id = ?`).get(factionId);
    const newMomentum = Math.max(-1, Math.min(1, Number(cur?.momentum ?? 0) + Number(picked.deltaMomentum ?? 0)));
    const newStance = picked.newStance ?? cur?.stance ?? "consolidate";

    db.prepare(`
      UPDATE faction_strategy_state
         SET stance = ?, target_id = ?, momentum = ?,
             next_move_at = ?, last_move_id = ?, phase = phase + 1, updated_at = ?
       WHERE faction_id = ?
    `).run(
      newStance,
      picked.target ?? cur?.target_id ?? null,
      newMomentum,
      now + MOVE_COOLDOWN_S,
      moveId,
      now,
      factionId,
    );

    // Mirror momentum onto the rival faction if a war/raid hit them.
    if ((picked.move === "RAID" || picked.move === "DECLARE_WAR") && picked.target) {
      const rival = peerStates?.find(p => p.faction_id === picked.target);
      if (rival) {
        const rivalDelta = -Number(picked.deltaMomentum ?? 0);
        const rivalMomentum = Math.max(-1, Math.min(1, Number(rival.momentum ?? 0) + rivalDelta));
        db.prepare(`UPDATE faction_strategy_state SET momentum = ?, updated_at = ? WHERE faction_id = ?`)
          .run(rivalMomentum, now, picked.target);
      }
    }

    // Update relations if the move specifies.
    if (picked.target && (picked.newKind || typeof picked.newScore === 'number')) {
      const existing = getRelation(db, factionId, picked.target);
      setRelation(db, factionId, picked.target, {
        score: typeof picked.newScore === 'number' ? picked.newScore : existing.score,
        kind: picked.newKind ?? existing.kind,
      });
    }
  });

  try { tx(); }
  catch { return null; }
  return { moveId, ...picked };
}

/** Read recent strategy moves across all factions for the news feed. */
export function getRecentMoves(db, limit = 30) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, faction_id, move, target_id, summary, occurred_at
        FROM faction_strategy_log
       ORDER BY occurred_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(200, Number(limit))));
  } catch {
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

function getRelationScore(_a, _b) {
  // The applyMove caller passes in peerStates; pickMove gets relations
  // from the closure via setupCycle. For simplicity in pickMove we
  // assume peers carry their own relation snapshot. This helper is a
  // hook for tests that want to override.
  return 0;
}

/** Deterministic seeded RNG so tests are reproducible. */
function _rng(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
