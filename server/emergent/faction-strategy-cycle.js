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

// P0 (2026-07-11 politics-capability-map audit) — an autonomous DECLARE_WAR/RAID
// move used to only ever update faction_strategy_state/faction_relations + emit
// events; the real, fully-built joinable-combat pipeline in
// server/lib/combat/faction-war.js (spawnFactionWar/tickAllFactionWars) had
// exactly one caller in the whole codebase: the admin/test-only
// POST /api/faction-war/spawn route. Nothing autonomous ever created a war a
// player could walk up to and fight in. Kill-switch CONCORD_FACTION_WAR_SPAWN=0.
function factionWarSpawnEnabled() { return process.env.CONCORD_FACTION_WAR_SPAWN !== "0"; }

/**
 * Best-effort resolve a "home" cityId/worldId for a faction from its living
 * NPCs. Purely cosmetic metadata on the spawned faction_wars row (surfaced by
 * FactionWarBanner/FactionWarIntel) — never gates the spawn itself.
 */
function resolveFactionWorld(db, factionId) {
  try {
    const row = db.prepare(`
      SELECT world_id FROM world_npcs WHERE faction = ? AND world_id IS NOT NULL LIMIT 1
    `).get(factionId);
    return row?.world_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Wire-the-unwired hook: when the strategy cycle picks (and persists)
 * DECLARE_WAR or RAID against a target faction, spawn the real, joinable
 * faction-war combat encounter — unless one between this exact pair is
 * already active, so a faction sitting in `war` stance doesn't spawn a fresh
 * encounter on every ~50-minute RAID tick. Thin orchestrator: never edits
 * spawnFactionWar itself, always try/catch-isolated, never throws back into
 * the cycle.
 */
async function maybeSpawnFactionWarEncounter(db, { factionId, targetId, move, moveId }) {
  if (!factionWarSpawnEnabled() || !targetId) return null;
  try {
    const fw = await import("../lib/combat/faction-war.js");
    const existing = fw.findActiveWarBetween(db, factionId, targetId);
    if (existing) return { ok: true, warId: existing.id, reused: true };
    const result = fw.spawnFactionWar(db, {
      sideA: factionId,
      sideB: targetId,
      eventId: moveId ?? null,
      cityId: resolveFactionWorld(db, factionId) ?? resolveFactionWorld(db, targetId),
    });
    if (result?.ok) {
      try {
        logger.info("faction-strategy-cycle", "faction_war_spawned", {
          warId: result.warId, factionId, targetId, move,
        });
      } catch { /* ignore */ }
    }
    return result;
  } catch (err) {
    try { logger.warn("faction-strategy-cycle", "faction_war_spawn_failed", { factionId, targetId, error: err?.message }); } catch { /* ignore */ }
    return null;
  }
}

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
      // getRelationScore() inside pickMove needs a live db handle to read
      // real faction_relations pairs (PROPOSE_ALLIANCE friend-search,
      // DECLARE_WAR rival-filter) instead of the pre-fix always-0 stub.
      const picked = pickMove(stateWithBias, peers, { db, ...(ethicsBias ? { ethicsBias } : {}) });
      const applied = applyMove(db, f.faction_id, picked, allStates);
      if (applied) {
        advanced++;
        const entry = { factionId: f.faction_id, move: applied.move, target: applied.target };
        // Surface the (previously dark) CK3-style stance machine: every strategic
        // move — not just the wars/clashes below — emits a lightweight event so
        // the EmergentEventFeed can show "the world's factions are scheming"
        // (consolidate / expand / propose-alliance / seek-truce / …). Best-effort.
        io?.emit?.("faction:strategy-move", {
          factionId: f.faction_id,
          move: applied.move,
          target: applied.target ?? null,
          ts: Date.now(),
        });
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
        // P0 — the missing connector: turn the autonomous DECLARE_WAR/RAID
        // decision above into a real, joinable faction-war combat encounter
        // (server/lib/combat/faction-war.js), not just a state/relation
        // update. Idempotent on the (factionId, target) pair via
        // findActiveWarBetween — a RAID against an already-warring rival
        // reuses the live encounter instead of spawning a duplicate.
        if (applied.target && (applied.move === "RAID" || applied.move === "DECLARE_WAR")) {
          const warResult = await maybeSpawnFactionWarEncounter(db, {
            factionId: f.faction_id,
            targetId: applied.target,
            move: applied.move,
            moveId: applied.moveId,
          });
          if (warResult?.ok) {
            entry.warId = warResult.warId;
            entry.warReused = !!warResult.reused;
          }
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
