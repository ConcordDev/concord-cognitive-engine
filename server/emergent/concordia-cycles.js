// server/emergent/concordia-cycles.js
//
// Concordia heartbeat module — wires Phase 8, 10, 12, 16 systems onto
// the existing heartbeat clock.
//
// Each handler is exception-safe (returns { ok, ... } always; never
// throws) so a single faulty migration / table-missing doesn't stop
// the governorTick. Frequencies are conservative; tune per Sprint.
//
// Heartbeats registered (caller does the registerHeartbeat()):
//   aging-cycle              freq=480  (~2h) — advances NPC ages, marks death
//   ration-floor-cycle       freq=1440 (~6h) — mints monthly rations
//   council-session-cycle    freq=480  (~2h) — opens new seasonal sessions
//   underwater-threat-cycle  (caller — invoked from dive-pos handler)
//
// `runAgingCycle(STATE)` reads current Concordia day from
// seasons.js (best-effort) and emits onNpcDeath for due NPCs.
// `runRationFloorCycle(STATE)` calls mintRationsForEligible with the
// wallet's mintCoins fn.
// `runCouncilSessionCycle(STATE)` walks every realm and opens a
// session if one isn't already open for the current season+year.

import logger from "../logger.js";
import { npcNameFromRow } from "../lib/npc-name.js";

const SECONDS_PER_CONCORDIA_DAY = 86400;

function safeRun(label, fn) {
  return async (state) => {
    try {
      const r = await fn(state);
      return { ok: true, ...r };
    } catch (err) {
      try { logger.warn?.("concordia_cycle_failed", { cycle: label, error: err?.message }); } catch { /* noop */ }
      return { ok: false, reason: "exception", error: err?.message };
    }
  };
}

function currentConcordiaDay(_db) {
  // world_seasons carries no per-day counter (season_idx/year_n/transitioned_at
  // only); the Concordia day is derived deterministically from epoch.
  return Math.floor(Date.now() / 1000 / SECONDS_PER_CONCORDIA_DAY);
}

function currentSeasonId(db) {
  try {
    const row = db.prepare(`SELECT season_idx AS season_index FROM world_seasons ORDER BY transitioned_at DESC LIMIT 1`).get();
    if (row && Number.isFinite(row.season_index)) return Number(row.season_index);
  } catch { /* table absent */ }
  return 1;
}

function currentYear(db) {
  try {
    const row = db.prepare(`SELECT year_n AS year FROM world_seasons ORDER BY transitioned_at DESC LIMIT 1`).get();
    if (row && Number.isFinite(row.year)) return Number(row.year);
  } catch { /* table absent */ }
  return 1;
}

// ─── aging-cycle ────────────────────────────────────────────────────────
export const runAgingCycle = safeRun("aging-cycle", async (state) => {
  const db = state?.db;
  if (!db) return { reason: "no_db" };
  const { advanceAging } = await import("../lib/aging-engine.js");
  const day = currentConcordiaDay(db);
  const r = advanceAging(db, day);
  if (!r.ok) return r;

  // Fire onNpcDeath for each due NPC. Hoist the dynamic import + per-NPC
  // statements out of the loop (was re-importing + re-preparing per death).
  let killed = 0, failed = 0;
  const { onNpcDeath } = await import("../lib/npc-legacy.js");
  const selDecStmt = db.prepare(`SELECT id, faction, archetype, npc_type, state FROM world_npcs WHERE id = ?`);
  const markDeadStmt = db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`);
  for (const due of r.dueForDeath || []) {
    try {
      const dec = selDecStmt.get(due.npcId);
      if (dec) {
        dec.name = npcNameFromRow(dec); // world_npcs has no `name` column — derive from state
        // Mark dead.
        markDeadStmt.run(due.npcId);
        onNpcDeath(db, dec, { cause: "natural", killerId: null });
        killed++;
      }
    } catch { failed++; }
  }
  return { day, considered: r.dueForDeath?.length || 0, killed, failed };
});

// ─── ration-floor-cycle ─────────────────────────────────────────────────
export const runRationFloorCycle = safeRun("ration-floor-cycle", async (state) => {
  const db = state?.db;
  if (!db) return { reason: "no_db" };
  const { mintRationsForEligible } = await import("../lib/tunyan-jobs.js");
  // Best-effort wallet mint.
  const mintFn = async (db2, uid, sparks, opts) => {
    try {
      const w = await import("../lib/world-events.js");
      if (typeof w.mintCoins === "function") return w.mintCoins(db2, uid, sparks, opts);
    } catch { /* not present */ }
    return { ok: false, reason: "no_wallet_module" };
  };
  return mintRationsForEligible(db, { mintFn });
});

// ─── council-session-cycle ──────────────────────────────────────────────
export const runCouncilSessionCycle = safeRun("council-session-cycle", async (state) => {
  const db = state?.db;
  if (!db) return { reason: "no_db" };
  const { openSession, closeSession, listOpenSessions } = await import("../lib/council-engine.js");

  // Close any session whose season has advanced past it.
  const seasonId = currentSeasonId(db);
  const year = currentYear(db);

  // Try to enumerate realms; fall back gracefully if the table is missing.
  let realms = [];
  try {
    realms = db.prepare(`SELECT id FROM realms`).all() || [];
  } catch { /* realms not yet seeded */ }
  if (realms.length === 0) return { opened: 0, closed: 0, reason: "no_realms" };

  let opened = 0;
  for (const realm of realms) {
    try {
      const r = openSession(db, realm.id, seasonId, year);
      if (r.action === "opened") opened++;
    } catch { /* skip per-realm failure */ }
  }
  // Close stale sessions from prior seasons.
  let closed = 0;
  try {
    const stale = db.prepare(`SELECT id FROM council_sessions WHERE status = 'open' AND (season_id != ? OR year != ?)`).all(seasonId, year);
    for (const s of stale) {
      try { closeSession(db, s.id); closed++; } catch { /* skip */ }
    }
  } catch { /* table missing */ }

  const open = listOpenSessions(db);
  return { opened, closed, currentlyOpen: open.length };
});

// ─── underwater-threat-cycle ────────────────────────────────────────────
// Heartbeat-driven sweep: enumerate online players in worlds with
// authored aggressive features. If a player's position falls inside a
// pursuit window, decideAttackOnPlayer rolls; on attack, recordPain
// is invoked for somatic feedback.
export const runUnderwaterThreatCycle = safeRun("underwater-threat-cycle", async (state) => {
  const db = state?.db;
  if (!db) return { reason: "no_db" };
  const { decideAttackOnPlayer } = await import("../lib/underwater-content.js");

  // Pull players currently underwater (player_oxygen.last_depth_m > 4).
  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT user_id, world_id, last_depth_m, last_x, last_z
      FROM player_oxygen WHERE last_depth_m > 4
    `).all();
  } catch { return { reason: "no_oxygen_table", attacks: 0 }; }

  let attacks = 0;
  for (const c of candidates) {
    if (!Number.isFinite(c.last_x) || !Number.isFinite(c.last_z)) continue;
    try {
      const r = decideAttackOnPlayer(db, {
        worldId: c.world_id,
        userId: c.user_id,
        position: { x: c.last_x, z: c.last_z },
        depth_m: c.last_depth_m,
      });
      if (r?.attacker) {
        attacks++;
        try {
          const { recordPain, regionForElement } = await import("../lib/embodied/pain.js");
          recordPain(db, {
            userId: c.user_id,
            region: regionForElement?.("water") || "systemic",
            source: "environment",
            intensity: r.painIntensity || 0.2,
          });
        } catch { /* pain table optional */ }
      }
    } catch { /* skip */ }
  }
  return { candidates: candidates.length, attacks };
});

export const CONCORDIA_CYCLE_CONSTANTS = Object.freeze({
  SECONDS_PER_CONCORDIA_DAY,
});
