// server/emergent/faction-strategy-cycle.js
//
// Layer 11 heartbeat: faction emergent strategy.
//
// Frequency: every 200 ticks (~50 minutes). Each pass:
//   1. Reads all faction_strategy_state rows whose next_move_at <= now.
//   2. For each, snapshots peer states, asks pickMove() for the move
//      and applyMove() to persist + log + update relations.
//   3. Wraps each faction in try/catch — one failure doesn't stop others.
//
// Discovery: factions are file-driven (content/world/**/factions.json).
// We don't enumerate them here — instead we trust that ensureFactionState
// has been called by some external seeder OR by an explicit /admin/
// endpoint when worlds are seeded. The cycle only advances factions
// that already have a strategy_state row, which is the right behaviour
// for builds without seeded factions: zero work, zero error.

import logger from "../logger.js";
import { pickMove, applyMove } from "../lib/embodied/faction-strategy.js";
import { ethicsEnabled, getSharedValueRuleIndex, factionMoveBias } from "../lib/viability/value-rule-index.js";
import { collapseCascadeEnabled, cascadeCollapse } from "../lib/viability/collapse-cascade.js";

const CASCADE_DRAG = 0.2; // bounded momentum drag applied to a contagion-collapsed faction
import { getAuthoredFaction } from "../lib/content-seeder.js";
import { resolveFactionClash } from "../lib/faction-strength.js";
import { maybeEmitPersonalStake } from "../lib/personal-stake.js";

// WS5: structural strength decides wars/raids. Kill-switch CONCORD_FACTION_STRENGTH=0.
function factionStrengthEnabled() { return process.env.CONCORD_FACTION_STRENGTH !== "0"; }

function nudgeMomentum(db, factionId, delta) {
  try {
    db.prepare(`
      UPDATE faction_strategy_state
      SET momentum = MAX(-1.0, MIN(1.0, momentum + ?)), updated_at = unixepoch()
      WHERE faction_id = ?
    `).run(delta, factionId);
  } catch { /* best-effort */ }
}

/**
 * Sprint C / Track A1 — resolve a faction's current leader coping trait
 * (if any). Returns null on any miss; pickMove treats null as no bias.
 */
function resolveLeaderCopingTrait(db, factionId) {
  try {
    const f = getAuthoredFaction(factionId);
    const leaderId = f?.leader_npc_id || f?.leader || null;
    if (!leaderId) return null;
    const row = db.prepare(`
      SELECT coping_trait, coping_until FROM npc_stress WHERE npc_id = ?
    `).get(leaderId);
    if (!row?.coping_trait) return null;
    const now = Math.floor(Date.now() / 1000);
    if (row.coping_until && row.coping_until < now) return null;
    return row.coping_trait;
  } catch { return null; }
}

export async function runFactionStrategyCycle({ db, io, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const now = Math.floor(Date.now() / 1000);

  let pending;
  try {
    pending = db.prepare(`
      SELECT * FROM faction_strategy_state WHERE next_move_at <= ?
    `).all(now);
  } catch {
    return { ok: false, reason: "faction_strategy_state_missing" };
  }
  if (!pending || pending.length === 0) return { ok: true, advanced: 0 };

  // Snapshot all peer states once (small list — 7 authored factions).
  let allStates;
  try {
    // @select-star-ok: faction_strategy_state — heartbeat reads all state
    allStates = db.prepare(`SELECT * FROM faction_strategy_state`).all();
  } catch {
    allStates = [];
  }

  // Wave 4 — institutional restraint: build the value-rule index once per pass
  // (memoized), only when the flag is on + the corpus is loaded. Off → no bias.
  const valueRuleIndex = (ethicsEnabled() && _state?.dtus) ? getSharedValueRuleIndex(_state.dtus) : null;

  let advanced = 0;
  const moves = [];
  for (const f of pending) {
    try {
      const peers = allStates.filter(s => s.faction_id !== f.faction_id);
      // Sprint C / A1 — leader coping trait biases the roll. Trait stays
      // separate from persisted state so it doesn't leak into the move log.
      const stateWithBias = { ...f, coping_trait: resolveLeaderCopingTrait(db, f.faction_id) };
      const ethicsBias = valueRuleIndex ? factionMoveBias(valueRuleIndex, f.faction_id) : null;
      const picked = pickMove(stateWithBias, peers, ethicsBias ? { ethicsBias } : {});
      const applied = applyMove(db, f.faction_id, picked, allStates);
      if (applied) {
        advanced++;
        const entry = { factionId: f.faction_id, move: applied.move, target: applied.target };
        // Legibility W2b — route a war move through any online player whose thread
        // it pulls on ("the faction you backed is on the move"). Global (factions
        // aren't per-world) → scans all online players. Best-effort, never blocks.
        if (applied.move === "DECLARE_WAR" || applied.move === "RAID") {
          maybeEmitPersonalStake(db, {
            kind: "faction_war",
            factionId: f.faction_id,
            targetFactionId: applied.target ?? null,
            headline: `${f.faction_id} ${applied.move === "RAID" ? "raids" : "declares war on"}${applied.target ? ` ${applied.target}` : ""}`,
          }).catch(() => {});
        }
        // WS5: a RAID or DECLARE_WAR is now decided by structural strength
        // (leaders + trained members + realm setup). The stronger faction gains
        // momentum, the weaker loses it, and a hot-event fires for the feed.
        if (factionStrengthEnabled() && applied.target &&
            (applied.move === "RAID" || applied.move === "DECLARE_WAR")) {
          try {
            const clash = resolveFactionClash(db, f.faction_id, applied.target);
            if (!clash.draw) {
              nudgeMomentum(db, clash.winner, clash.winnerMomentum);
              nudgeMomentum(db, clash.loser, clash.loserMomentum);
              entry.clash = {
                winner: clash.winner, loser: clash.loser,
                aStrength: clash.aStrength, bStrength: clash.bStrength, margin: clash.margin,
              };
              try {
                io?.emit?.("faction-war:clash", {
                  move: applied.move,
                  attacker: f.faction_id,
                  defender: applied.target,
                  winner: clash.winner,
                  loser: clash.loser,
                  margin: clash.margin,
                  strengths: { [f.faction_id]: clash.aStrength, [applied.target]: clash.bStrength },
                });
              } catch { /* emit best-effort */ }
            }
          } catch { /* strength resolution best-effort */ }
        }
        moves.push(entry);
      }
    } catch (err) {
      try { logger.warn("faction-strategy-cycle", "faction_failed", { factionId: f.faction_id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  // Wave 5 #22 — collapse cascade: after this pass's moves settle, an
  // over-extended faction whose allies/patrons have fallen is dragged toward
  // collapse too (the domino). Read fresh momenta (moves just changed them),
  // run the pure cascade, and apply a bounded momentum drag to each
  // contagion-collapsed faction + emit a feed event. Behind
  // CONCORD_COLLAPSE_CASCADE; flag off → this whole block is skipped (today).
  let cascade = null;
  if (collapseCascadeEnabled()) {
    try {
      const fresh = db.prepare(`SELECT faction_id, momentum FROM faction_strategy_state`).all();
      let relations = [];
      try { relations = db.prepare(`SELECT faction_a, faction_b, kind FROM faction_relations`).all(); } catch { /* relations optional */ }
      const result = cascadeCollapse(fresh, relations);
      for (const fid of result.cascaded) {
        nudgeMomentum(db, fid, -CASCADE_DRAG);
      }
      if (result.cascaded.length > 0) {
        try {
          io?.emit?.("faction:collapse-cascade", {
            seeds: result.seeds,
            cascaded: result.cascaded,
            systemicRiskClusterSize: result.systemicRiskClusterSize,
          });
        } catch { /* emit best-effort */ }
      }
      cascade = { cascaded: result.cascaded.length, systemicRiskClusterSize: result.systemicRiskClusterSize };
    } catch (err) {
      try { logger.warn("faction-strategy-cycle", "cascade_failed", { error: err?.message }); } catch { /* ignore */ }
    }
  }

  return { ok: true, advanced, total: pending.length, moves, ...(cascade ? { cascade } : {}) };
}
