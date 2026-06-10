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
 * T1.1 — seed strategy state + initial relations for a set of authored
 * factions, so the faction-strategy cycle (which only advances rows that
 * already exist) actually does work on a fresh boot. Idempotent: ensureFactionState
 * no-ops if a row exists, and setRelation upserts.
 *
 * Without this the EVE-style "factions war while you sleep" layer is fully
 * built (cycle + sockets + EmergentEventFeed) but dark — zero rows means zero
 * moves, forever.
 *
 * Derivation (all deterministic):
 *   - stance: an authored faction.stance if it's a valid engine stance; else a
 *     hash-stable lean (rival-bearing factions split expand/consolidate so wars
 *     can emerge; others consolidate).
 *   - relations: rival_factions / rivalries → tension (-0.2); allied_factions /
 *     alliances → truce (+0.45). Only seeded when BOTH factions are authored,
 *     so every relation has two live strategy rows behind it. NB the rival
 *     score is a *mild* tension on purpose: pickMove's DECLARE_WAR branch only
 *     fires against an expanding rival whose relation is still >= -0.3 (wars
 *     emerge from expansion collisions, not from pre-existing deep enmity), so
 *     seeding -0.9 would paradoxically prevent the war it's meant to enable.
 */
export function seedFactionStrategyState(db, factions) {
  if (!db || !Array.isArray(factions) || factions.length === 0) {
    return { ok: true, seeded: 0, relations: 0 };
  }
  const ids = new Set(factions.map(f => f?.id).filter(Boolean));
  let seeded = 0, relations = 0;

  const stanceFor = (f) => {
    const explicit = String(f.stance || "").toLowerCase();
    if (STANCES.includes(explicit)) return explicit;
    const rivals = [].concat(f.rival_factions || [], f.rivalries || []).filter(Boolean);
    if (rivals.length > 0) {
      // Deterministic split: ~half the rival-bearing factions start expansionist
      // so DECLARE_WAR becomes reachable; the rest consolidate.
      let h = 0; const s = String(f.id);
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return (Math.abs(h) % 2) === 0 ? "expand" : "consolidate";
    }
    return "consolidate";
  };

  const selState = db.prepare(`SELECT faction_id FROM faction_strategy_state WHERE faction_id = ?`);
  for (const f of factions) {
    if (!f?.id) continue;
    try {
      const before = selState.get(f.id);
      ensureFactionState(db, f.id, { stance: stanceFor(f) });
      if (!before) seeded++;
    } catch { /* table optional */ }
  }

  const seedRelations = (f, list, score, kind) => {
    for (const other of (Array.isArray(list) ? list : [])) {
      if (!other || other === f.id || !ids.has(other)) continue;
      try {
        // Don't clobber a relation already shaped by gameplay.
        const existing = getRelation(db, f.id, other);
        if (existing && existing.kind && existing.kind !== "neutral") continue;
        if (setRelation(db, f.id, other, { score, kind })) relations++;
      } catch { /* relations table optional */ }
    }
  };
  for (const f of factions) {
    if (!f?.id) continue;
    seedRelations(f, [].concat(f.rival_factions || [], f.rivalries || []), -0.2, "tension");
    seedRelations(f, [].concat(f.allied_factions || [], f.alliances || []), 0.45, "truce");
  }

  return { ok: true, seeded, relations };
}

/**
 * Pick a move for a faction given its state + the relations with peers.
 * Pure: returns the move spec; caller persists.
 *
 * @returns {{ move: string, summary: string, target?: string, deltaMomentum: number, newStance?: string, newKind?: string, newScore?: number }}
 */
export function pickMove(state, peers = [], opts = {}) {
  const rng = _rng(state.faction_id + ":" + state.phase);
  const stance = state.stance ?? "consolidate";
  const momentum = Number(state.momentum ?? 0);

  // Wave 4 — NPC ethics (#16) at the faction scale: an optional, bounded
  // "institutional restraint" bias (computed by the caller from the value-rule
  // corpus, behind CONCORD_VIABILITY_ETHICS) folds into the SAME additive-RNG
  // seam as the coping-trait bias — never a new gate. Negative on hostile
  // moves, positive on cooperative ones. Absent / flag off → 0 → today.
  const eb = (move) => Number(opts.ethicsBias?.[move] || 0);

  // Sprint C / Track A1 — leader coping trait biases probabilities.
  // bias is a float in [-1, +1] that nudges the rng() comparison; positive
  // makes the move more likely.
  const coping = state.coping_trait ?? null;
  const biasFor = (move) => {
    switch (coping) {
      case "paranoid": if (move === "RAID") return 0.25; if (move === "DECLARE_WAR") return 0.20; if (move === "SEEK_TRUCE") return -0.20; break;
      case "reckless": if (move === "PROCLAIM_EXPANSION") return 0.30; if (move === "RAID") return 0.15; if (move === "FORTIFY") return -0.15; break;
      case "cruel":    if (move === "RAID") return 0.20; if (move === "DECLARE_WAR") return 0.15; break;
      case "withdraw": if (move === "WITHDRAW") return 0.40; if (move === "FORTIFY") return 0.20; if (move === "PROCLAIM_EXPANSION") return -0.20; break;
      case "drink":    if (move === "FORTIFY") return 0.10; if (move === "PROCLAIM_EXPANSION") return -0.10; break;
    }
    return 0;
  };

  // 1) War-state machine — momentum-driven exits.
  if (stance === "war") {
    // A1 bias: paranoid leader resists truce even when worn (-0.20 makes
    // the threshold harder to hit); reckless leader same.
    const truceThreshold = -0.6 + (biasFor("SEEK_TRUCE") * -1);
    if (momentum <= truceThreshold) {
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
    if (rival && rng() < (0.4 + biasFor("DECLARE_WAR") + eb("DECLARE_WAR"))) {
      return {
        move: "DECLARE_WAR",
        target: rival.faction_id,
        summary: `${state.faction_id} crosses ${rival.faction_id}'s territory; war is declared.`,
        deltaMomentum: 0.1,
        newStance: "war",
        newKind: "war", newScore: -1,
      };
    }
    if (rng() < (0.3 + biasFor("FORTIFY"))) {
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
  if (friend && rng() < (0.2 + eb("PROPOSE_ALLIANCE"))) {
    return {
      move: "PROPOSE_ALLIANCE",
      target: friend.faction_id,
      summary: `${state.faction_id} proposes alliance with ${friend.faction_id}.`,
      deltaMomentum: 0.04,
      newStance: "alliance",
      newKind: "alliance", newScore: 0.7,
    };
  }
  if (rng() < (0.35 + biasFor("PROCLAIM_EXPANSION"))) {
    return {
      move: "PROCLAIM_EXPANSION",
      summary: `${state.faction_id} announces a season of expansion.`,
      deltaMomentum: 0.02,
      newStance: "expand",
    };
  }
  if (rng() < (0.05 + biasFor("WITHDRAW"))) {
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
 * W3 — derive a human-legible cause tag for a move from its kind + the state
 * that provoked it. Surfaced in news bodies + personal-stake headlines so a
 * "War Declared" reads as "War Declared — retaliation, after the truce collapsed."
 */
function _triggerFor(move, prevMomentum, relationScore) {
  const m = String(move || "").toUpperCase();
  if (m === "DECLARE_WAR" || m === "RAID") {
    return (typeof relationScore === "number" && relationScore <= -0.5) ? "retaliation" : "expansion_collision";
  }
  if (m === "SEEK_TRUCE") return "momentum_collapse";
  if (m === "PROPOSE_ALLIANCE") return "shared_interest";
  if (m === "PROCLAIM_EXPANSION") return "ambition";
  if (m === "WITHDRAW") return prevMomentum < -0.3 ? "rout" : "overextension";
  if (m === "FORTIFY") return "consolidation";
  return "opportunity";
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
    // Wave 8 / Legibility W3 — thread the CAUSE into the move record. Read the
    // prior state + the relation to the target BEFORE logging so the payload
    // carries why this move happened (the news/personal-stake surfaces read it):
    // previous momentum, the relation score that provoked it, and a trigger tag.
    const cur = db.prepare(`SELECT * FROM faction_strategy_state WHERE faction_id = ?`).get(factionId);
    const prevMomentum = Number(cur?.momentum ?? 0);
    let relationScore = null;
    if (picked.target) {
      try { relationScore = getRelation(db, factionId, picked.target)?.score ?? null; } catch { /* relation optional */ }
    }
    const trigger = _triggerFor(picked.move, prevMomentum, relationScore);

    db.prepare(`
      INSERT INTO faction_strategy_log
        (id, faction_id, move, target_id, summary, payload_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      moveId, factionId,
      picked.move,
      picked.target ?? null,
      picked.summary,
      JSON.stringify({
        deltaMomentum: picked.deltaMomentum,
        newStance: picked.newStance ?? null,
        previous_momentum: prevMomentum,
        relation_score: relationScore,
        trigger,
      }),
      now,
    );

    // Compute new momentum + stance from the state read above.
    const newMomentum = Math.max(-1, Math.min(1, prevMomentum + Number(picked.deltaMomentum ?? 0)));
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

  // Phase F3.1 — fire realtime event so the player sees factions doing
  // things. Three event names for the three high-impact move classes.
  // Best-effort; never blocks the cycle.
  try {
    const emitFn = globalThis._concordRealtimeEmit;
    if (typeof emitFn === "function" && picked.move) {
      if (picked.move === "DECLARE_WAR" || picked.move === "RAID") {
        emitFn("faction:war-declared", {
          factionId, targetFactionId: picked.target ?? null,
          move: picked.move, summary: picked.summary, moveId,
        });
      } else if (picked.move === "PROPOSE_ALLIANCE" || picked.move === "FORM_ALLIANCE") {
        emitFn("faction:alliance-formed", {
          factionId, targetFactionId: picked.target ?? null,
          summary: picked.summary, moveId,
        });
      } else if (picked.move === "SEEK_TRUCE") {
        emitFn("faction:truce-sought", {
          factionId, targetFactionId: picked.target ?? null,
          summary: picked.summary, moveId,
        });
      }
    }
  } catch { /* emit failure never affects the cycle */ }

  // Phase 2 — refresh NPC preoccupations when the faction's stance changes.
  // Best-effort; never throws back into the strategy cycle.
  if (picked.newStance && picked.newStance !== "consolidate") {
    (async () => {
      try {
        const asymmetry = await import("../npc-asymmetry.js");
        if (asymmetry?.refreshFactionPreoccupations) {
          await asymmetry.refreshFactionPreoccupations(db, factionId, picked.newStance);
        }
      } catch { /* asymmetry tables may be missing on minimal builds */ }
    })();
  }

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
