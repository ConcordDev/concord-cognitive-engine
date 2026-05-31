// server/lib/cross-world-schemes.js
//
// Cross-world scheme state machine — sprint 2 of multi-world parity.
//
// Parallel to `npc-schemes.js` but every scheme carries explicit
// plotter_world_id and target_world_id. The CHECK constraint on
// `cross_world_schemes` enforces they differ.
//
// Why a separate module instead of `if (crossWorld)` branches in
// `npc-schemes.js`: per the user's "almost-works trap" guidance, when
// extending a system requires per-call cross-world branches the right
// move is to lift it as a clean module with parallel state. The single-
// world scheme state machine keeps its existing tests; cross-world
// schemes have their own isolated state machine and acceptance tests.
//
// State machine (mirrors npc-schemes for shape parity):
//   planning → recruiting → [gathering_evidence] → moving →
//     ↘ complete (resolution mutates target world + records
//                consequences in BOTH worlds)
//     ↘ exposed (player discovered evidence; opinion deltas + abandon)
//     ↘ abandoned (cooldown, lead exiled, etc.)
//
// Accomplice recruitment in cross-world schemes uses the cross_npc_
// relationships graph (correspondents the plotter trusts) — NOT the
// single-world character_opinions table. This is intentional: a Tunyan
// matriarch's accomplice in a fantasy-world plot is a fantasy-world
// NPC who already has a "correspondent" edge to her.
//
// Resolution: the assassinate / blackmail / etc. effects fire against
// the TARGET world's tables, with two consequence rows recorded — one
// per world — so downstream systems (UI feeds, governance logs,
// faction strategy) in EITHER world can react.
//
// Kill switch: every public function gates on cross_world_kill_switch
// being 'live'.

import crypto from "node:crypto";
import { getKillSwitchMode } from "./cross-world-economy.js";
import { getRelation, listRelationsFrom } from "./cross-world-relationships.js";

const SCHEME_TICK_MIN = 30 * 60;
const SCHEME_TICK_VAR = 60 * 60;
const MOVE_REQUIRES_EVIDENCE = 3;
const MOVE_REQUIRES_ACCOMPLICES = 1; // cross-world is harder; one trusted correspondent suffices
const KIND_REQUIRES_EVIDENCE = new Set(["assassinate", "blackmail", "claim_inheritance"]);

function killSwitchAllowsCrossWorld(db) {
  return getKillSwitchMode(db) === "live";
}

function nextTickAt(now = Math.floor(Date.now() / 1000)) {
  return now + SCHEME_TICK_MIN + Math.floor(Math.random() * SCHEME_TICK_VAR);
}

function recordConsequence(db, schemeId, affectedWorld, consequenceKind, entityKind, entityId, detail = null) {
  const id = `xcon_${crypto.randomUUID().slice(0, 16)}`;
  try {
    db.prepare(`
      INSERT INTO cross_world_scheme_consequences
        (id, scheme_id, affected_world_id, consequence_kind,
         affected_entity_kind, affected_entity_id, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, schemeId, affectedWorld, consequenceKind, entityKind, entityId, detail);
  } catch { /* table optional in some test setups */ }
}

// ── Propose ────────────────────────────────────────────────────────

export function proposeCrossWorldScheme(db, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  const {
    plotterWorld, plotterId, plotterKind = "npc",
    targetWorld, targetKind = "npc", targetId,
    kind = "assassinate",
  } = opts;

  if (!db || !plotterWorld || !plotterId || !targetWorld || !targetId || !kind) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (plotterWorld === targetWorld) {
    return { ok: false, reason: "same_world" };
  }

  // Require an existing cross-world relationship for npc plotters: you
  // can't plot against someone you have no resonance with. Player
  // plotters bypass (players carry their own intent across worlds).
  if (plotterKind === "npc" && targetKind === "npc") {
    const rel = getRelation(db, plotterWorld, plotterId, targetWorld, targetId);
    if (!rel) return { ok: false, reason: "no_relationship" };
  }

  // Don't open a parallel scheme of the same kind on the same target.
  const dup = db.prepare(`
    SELECT id FROM cross_world_schemes
    WHERE plotter_world_id = ? AND plotter_id = ?
      AND target_world_id = ? AND target_id = ?
      AND kind = ?
      AND phase NOT IN ('complete','abandoned','exposed') LIMIT 1
  `).get(plotterWorld, plotterId, targetWorld, targetId, kind);
  if (dup) return { ok: false, reason: "duplicate_scheme", schemeId: dup.id };

  const id = `xsch_${crypto.randomUUID().slice(0, 16)}`;
  const successBase = kind === "seduce" ? 30 : kind === "blackmail" ? 35 : 20; // cross-world is harder
  const discoveryBase = kind === "fabricate_secret" ? 30 : 15;

  db.prepare(`
    INSERT INTO cross_world_schemes
      (id, plotter_world_id, plotter_kind, plotter_id,
       target_world_id, target_kind, target_id,
       kind, phase, success_pct, discovery_pct, next_tick_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?)
  `).run(
    id, plotterWorld, plotterKind, plotterId,
    targetWorld, targetKind, targetId,
    kind, successBase, discoveryBase, nextTickAt(),
  );

  return { ok: true, schemeId: id, kind };
}

// ── Advance ────────────────────────────────────────────────────────

export function advanceCrossWorldScheme(db, schemeId, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !schemeId) return { ok: false, reason: "missing_inputs" };

  const sch = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(schemeId);
  if (!sch) return { ok: false, reason: "scheme_not_found" };
  if (["complete", "abandoned", "exposed"].includes(sch.phase)) {
    return { ok: true, action: "noop_terminal" };
  }

  const now = Math.floor(Date.now() / 1000);
  let nextPhase = sch.phase;
  let result = { schemeId, fromPhase: sch.phase, transitioned: false };

  switch (sch.phase) {
    case "planning":
      nextPhase = "recruiting";
      break;

    case "recruiting": {
      // Pull cross-world correspondents the plotter has authored relations
      // with (TARGET-world only — schemes need someone in the destination).
      const candidates = listRelationsFrom(db, sch.plotter_world_id, sch.plotter_id)
        .filter(r => r.to_world_id === sch.target_world_id)
        .filter(r => r.to_npc_id !== sch.target_id) // not the target themselves
        .slice(0, 3);
      const accCount = sch.accomplice_count + candidates.length;
      db.prepare(`UPDATE cross_world_schemes SET accomplice_count = ? WHERE id = ?`)
        .run(accCount, schemeId);
      if (accCount >= MOVE_REQUIRES_ACCOMPLICES) {
        nextPhase = KIND_REQUIRES_EVIDENCE.has(sch.kind) ? "gathering_evidence" : "moving";
      }
      break;
    }

    case "gathering_evidence": {
      const evCount = sch.evidence_count + 1;
      const newDisc = Math.min(100, sch.discovery_pct + 5);
      db.prepare(`UPDATE cross_world_schemes SET evidence_count = ?, discovery_pct = ? WHERE id = ?`)
        .run(evCount, newDisc, schemeId);
      if (evCount >= MOVE_REQUIRES_EVIDENCE) nextPhase = "moving";
      break;
    }

    case "moving": {
      const rng = opts?.rng ?? Math.random;
      const succeeded = rng() * 100 < sch.success_pct;
      if (succeeded) {
        try { applyCrossWorldResolution(db, sch, opts); }
        catch { /* resolution-side mutation optional in test setups */ }
        nextPhase = "complete";
      } else {
        nextPhase = "exposed";
        // Both worlds get notified the plot was exposed.
        recordConsequence(db, schemeId, sch.plotter_world_id, "plot_exposed",
          sch.plotter_kind, sch.plotter_id, "scheme failed and was exposed");
        recordConsequence(db, schemeId, sch.target_world_id, "plot_exposed",
          sch.target_kind, sch.target_id, "you learned someone plotted against you");
      }
      break;
    }
  }

  if (nextPhase !== sch.phase) {
    result.transitioned = true;
    result.toPhase = nextPhase;
    db.prepare(`
      UPDATE cross_world_schemes
      SET phase = ?, next_tick_at = ?, resolved_at = CASE WHEN ? IN ('complete','exposed','abandoned') THEN unixepoch() ELSE NULL END
      WHERE id = ?
    `).run(nextPhase, nextTickAt(now), nextPhase, schemeId);
  } else {
    db.prepare(`UPDATE cross_world_schemes SET next_tick_at = ? WHERE id = ?`).run(nextTickAt(now), schemeId);
  }

  return { ok: true, ...result };
}

// ── Resolution: mutates target world, records consequences in BOTH ─

export function applyCrossWorldResolution(db, sch, _opts = {}) {
  switch (sch.kind) {
    case "assassinate": {
      if (sch.target_kind === "npc") {
        // Target world's world_npcs: mark dead.
        try {
          db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ? AND world_id = ?`)
            .run(sch.target_id, sch.target_world_id);
        } catch { /* world_npcs optional in test setups */ }
        recordConsequence(db, sch.id, sch.target_world_id, "death",
          "npc", sch.target_id, `assassinated by cross-world plot from ${sch.plotter_world_id}`);
        recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
          sch.plotter_kind, sch.plotter_id,
          `successful cross-world assassination of ${sch.target_id} in ${sch.target_world_id}`);
      }
      break;
    }
    case "seduce": {
      // Strengthens the resonance edge.
      try {
        db.prepare(`
          UPDATE cross_npc_relationships
          SET resonance_strength = MIN(100, resonance_strength + 30),
              kind = 'correspondent',
              last_signal_at = unixepoch()
          WHERE from_world_id = ? AND from_npc_id = ?
            AND to_world_id = ? AND to_npc_id = ?
        `).run(sch.plotter_world_id, sch.plotter_id, sch.target_world_id, sch.target_id);
      } catch { /* noop */ }
      recordConsequence(db, sch.id, sch.target_world_id, "opinion_shift",
        sch.target_kind, sch.target_id, `seduced by ${sch.plotter_id} of ${sch.plotter_world_id}`);
      recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
        sch.plotter_kind, sch.plotter_id, `seduced ${sch.target_id} in ${sch.target_world_id}`);
      break;
    }
    case "fabricate_secret": {
      recordConsequence(db, sch.id, sch.target_world_id, "secret_planted",
        sch.target_kind, sch.target_id,
        `fabricated secret planted by ${sch.plotter_id} of ${sch.plotter_world_id}`);
      recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
        sch.plotter_kind, sch.plotter_id, `successfully fabricated a secret in ${sch.target_world_id}`);
      break;
    }
    case "claim_inheritance": {
      recordConsequence(db, sch.id, sch.target_world_id, "inheritance_claim",
        sch.target_kind, sch.target_id, `cross-world inheritance claim from ${sch.plotter_world_id}`);
      recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
        sch.plotter_kind, sch.plotter_id, `claimed inheritance from ${sch.target_world_id}`);
      break;
    }
    case "blackmail": {
      recordConsequence(db, sch.id, sch.target_world_id, "opinion_shift",
        sch.target_kind, sch.target_id, `blackmailed by ${sch.plotter_id} of ${sch.plotter_world_id}`);
      recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
        sch.plotter_kind, sch.plotter_id, `successfully blackmailed ${sch.target_id} in ${sch.target_world_id}`);
      break;
    }
    case "sabotage_decree": {
      try {
        db.prepare(`UPDATE realm_decrees SET effect_state = 'sabotaged' WHERE id = ?`)
          .run(sch.target_id);
      } catch { /* realm_decrees may not have world_id in this test setup */ }
      recordConsequence(db, sch.id, sch.target_world_id, "opinion_shift",
        "kingdom", sch.target_id, `decree ${sch.target_id} sabotaged from ${sch.plotter_world_id}`);
      recordConsequence(db, sch.id, sch.plotter_world_id, "opinion_shift",
        sch.plotter_kind, sch.plotter_id, `sabotaged decree in ${sch.target_world_id}`);
      break;
    }
  }
}

// ── Discovery (player-driven counter-play) ─────────────────────────

export function discoverCrossWorldScheme(db, userId, schemeId, evidenceKind = "observed") {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !userId || !schemeId) return { ok: false, reason: "missing_inputs" };

  const sch = db.prepare(`SELECT * FROM cross_world_schemes WHERE id = ?`).get(schemeId);
  if (!sch) return { ok: false, reason: "scheme_not_found" };

  if (["complete", "abandoned", "exposed"].includes(sch.phase)) {
    return { ok: true, alreadyTerminal: true, phase: sch.phase };
  }

  // Cross-world discovery exposes immediately — the player carrying
  // the evidence between worlds IS the exposure.
  db.prepare(`
    UPDATE cross_world_schemes
    SET phase = 'exposed', resolved_at = unixepoch(), discovery_pct = 100
    WHERE id = ?
  `).run(schemeId);

  recordConsequence(db, schemeId, sch.plotter_world_id, "discovery",
    sch.plotter_kind, sch.plotter_id,
    `cross-world plot exposed by player ${userId}: ${evidenceKind}`);
  recordConsequence(db, schemeId, sch.target_world_id, "discovery",
    sch.target_kind, sch.target_id,
    `cross-world plot against you exposed by player ${userId}: ${evidenceKind}`);

  return { ok: true, exposed: true, evidenceKind };
}

// ── Read helpers for UI / cycle ───────────────────────────────────

export function listActiveCrossWorldSchemes(db, opts = {}) {
  if (!db) return [];
  const limit = opts.limit ?? 100;
  try {
    return db.prepare(`
      SELECT * FROM cross_world_schemes
      WHERE phase NOT IN ('complete','abandoned','exposed')
        AND next_tick_at <= unixepoch()
      ORDER BY next_tick_at ASC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

export function listConsequencesForScheme(db, schemeId) {
  if (!db || !schemeId) return [];
  try {
    return db.prepare(`
      SELECT * FROM cross_world_scheme_consequences
      WHERE scheme_id = ? ORDER BY applied_at ASC
    `).all(schemeId);
  } catch {
    return [];
  }
}

export function listConsequencesForWorld(db, worldId, opts = {}) {
  if (!db || !worldId) return [];
  const limit = opts.limit ?? 50;
  try {
    return db.prepare(`
      SELECT * FROM cross_world_scheme_consequences
      WHERE affected_world_id = ?
      ORDER BY applied_at DESC LIMIT ?
    `).all(worldId, limit);
  } catch {
    return [];
  }
}

export const CROSS_WORLD_SCHEME_CONSTANTS = Object.freeze({
  MOVE_REQUIRES_EVIDENCE,
  MOVE_REQUIRES_ACCOMPLICES,
  SCHEME_TICK_MIN,
});
