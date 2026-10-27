// server/emergent/creature-flock-cycle.js
//
// Theme 2 (game-feel pass) — heartbeat that advances boid steering for
// ambient fauna spawned by `fauna-spawner.js`.
//
// Frequency: 4 ticks (~60s). Per pass:
//   1. Discover active worlds via world_visits (fall back to world_npcs).
//   2. For each, run tickFlock(db, state, worldId).
//
// Bounded by `world_npcs` per-world creature count; tickFlock itself does
// its own pre-filter and bulk DB flush. Per the heartbeat invariant: this
// module never throws.
//
// Kill-switch: CONCORD_CREATURE_FLOCK=0.

import logger from "../logger.js";
import { tickFlock } from "../lib/ecosystem/creature-behaviors.js";
import { recordEncounter } from "../lib/creature-crossbreeding.js";

const MAX_WORLDS_PER_PASS = 8;
const ENCOUNTER_RADIUS_M = 12;
const MAX_PAIRS_PER_WORLD = 6;
// INC-150: a pass used to tick up to 8 worlds back-to-back in one synchronous
// stretch (cold-cache passes measured 3.8 s on a prod DB clone, 4-5.5 s in
// prod logs). Now: yield to the event loop between worlds and stop once the
// pass has used FLOCK_BUDGET_MS of wall time; a rotating cursor makes the
// worlds that were skipped go first next pass, so every world still ticks.
const FLOCK_BUDGET_MS = Math.max(50, Number(process.env.CONCORD_FLOCK_BUDGET_MS) || 1500);
let _worldCursor = 0;
function _yieldLoop() { return new Promise((resolve) => { setImmediate(resolve); }); }
/** Test hook: reset the rotation cursor. */
export function _resetFlockCursorForTest() { _worldCursor = 0; }

/**
 * Sample up to MAX_PAIRS_PER_WORLD distinct-species creature pairs within
 * ENCOUNTER_RADIUS_M and bump their crossbreed bond. Heterospecific encounters
 * are what drive new-species hybrids in the existing creature-crossbreeding
 * substrate (mig 083). Same-species pairs are deliberately skipped — flocks
 * already pull conspecifics together via tickFlock cohesion, and we want bond
 * energy spent on the rarer cross-species meetings.
 */
function sampleEncountersForWorld(db, worldId) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, species_id, x, z FROM world_npcs
      WHERE world_id = ?
        AND is_dead = 0
        AND archetype LIKE 'creature:%'
        AND species_id IS NOT NULL
      LIMIT 80
    `).all(worldId);
  } catch {
    return { pairs: 0 };
  }
  if (!rows || rows.length < 2) return { pairs: 0 };

  let recorded = 0;
  const seen = new Set();
  for (let i = 0; i < rows.length && recorded < MAX_PAIRS_PER_WORLD; i++) {
    const a = rows[i];
    for (let j = i + 1; j < rows.length && recorded < MAX_PAIRS_PER_WORLD; j++) {
      const b = rows[j];
      if (a.species_id === b.species_id) continue;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      if (dx * dx + dz * dz > ENCOUNTER_RADIUS_M * ENCOUNTER_RADIUS_M) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        recordEncounter(db, {
          aId: a.id,
          bId: b.id,
          worldA: worldId,
          worldB: worldId,
          environment: null,
          sameEnvironmentBonus: true,
        });
        recorded++;
      } catch { /* best-effort */ }
    }
  }
  return { pairs: recorded };
}

export async function runCreatureFlockCycle({ db, state, io, tickCount: _t, budgetMs = FLOCK_BUDGET_MS } = {}) {
  if (process.env.CONCORD_CREATURE_FLOCK === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, worldsTouched: 0, totalMoved: 0, totalSpecies: 0, totalEncounterPairs: 0, totalKills: 0 };

  let worlds = [];
  try {
    worlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT ?
    `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (worlds.length === 0) {
    try {
      worlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0
          AND archetype LIKE 'creature:%'
        LIMIT ?
      `).all(MAX_WORLDS_PER_PASS).map((r) => r.world_id).filter(Boolean);
    } catch {
      return { ok: true, worldsTouched: 0, reason: "no_world_npcs_table" };
    }
  }
  if (worlds.length === 0) return { ok: true, worldsTouched: 0 };

  // Stable order, then start at the cursor and wrap.
  worlds.sort();
  const start = _worldCursor % worlds.length;
  const ordered = worlds.slice(start).concat(worlds.slice(0, start));
  const passStart = Date.now();
  let processed = 0;
  for (const worldId of ordered) {
    if (processed > 0) {
      if (Date.now() - passStart >= budgetMs) { stats.truncated = true; break; }
      await _yieldLoop();
    }
    processed++;
    (stats.worldIds ||= []).push(worldId);
    try {
      const r = tickFlock(db, state ?? {}, worldId);
      if (r?.ok) {
        stats.worldsTouched++;
        stats.totalMoved += r.moved ?? 0;
        stats.totalSpecies += r.species ?? 0;
        stats.totalKills += r.kills ?? 0;
        // Surface predation so the world reads as alive — "a deer bolting tells
        // you a predator's near". Players in the world get a transient marker at
        // the kill site. Best-effort; an emit failure never stops the cycle.
        if (r.killed && r.killed.length && io) {
          for (const k of r.killed) {
            try {
              io.to(`world:${worldId}`)?.emit?.("creature:predation", {
                worldId,
                predatorSpecies: k.predatorSpecies,
                preySpecies: k.preySpecies,
                x: k.x,
                z: k.z,
              });
            } catch { /* emit best-effort */ }
          }
        }
      }
    } catch (err) {
      logger?.warn?.("creature-flock-cycle: world failed", { worldId, err: err?.message });
    }
    try {
      const e = sampleEncountersForWorld(db, worldId);
      stats.totalEncounterPairs += e.pairs ?? 0;
    } catch (err) {
      logger?.warn?.("creature-flock-cycle: encounter sampling failed", { worldId, err: err?.message });
    }
  }

  _worldCursor = (start + Math.max(1, processed)) % worlds.length;
  stats.worldsProcessed = processed;
  stats.worldsTotal = worlds.length;
  return stats;
}
