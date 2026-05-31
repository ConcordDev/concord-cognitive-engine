// server/lib/plague-event.js
//
// Phase W3 — plague declaration + quarantine refusal field.
//
// When an active world's infection ratio crosses PLAGUE_INFECTION_RATIO
// (default 0.15), fire `world:plague-declared`. Activates the
// `quarantine_active` refusal-field kind so entry to specific districts
// is gated. NPCs in avoid_infected mode flee.

import { getInfectionRatio, PLAGUE_INFECTION_RATIO } from "./disease-engine.js";
import logger from "../logger.js";

/** @type {Map<string, { startedAt: number, ratio: number }>} */
const _activePlagues = new Map();

export function isPlagueActive(worldId) {
  return _activePlagues.has(worldId);
}

export function listActivePlagues() {
  const out = [];
  for (const [worldId, info] of _activePlagues) {
    out.push({ worldId, ...info });
  }
  return out;
}

/** Heartbeat handler — registered scope: 'world'. */
export function plagueWatch(ctx = {}) {
  const db = ctx?.db;
  const worldId = ctx?.worldId;
  if (!db) return { ok: false, reason: "no_db" };

  // When ctx.worldId is set we're inside a world shard; otherwise scan all.
  const targets = worldId ? [worldId] : _discoverActiveWorlds(db);

  for (const wid of targets) {
    const ratio = getInfectionRatio(db, wid);
    const wasActive = _activePlagues.has(wid);

    if (ratio >= PLAGUE_INFECTION_RATIO && !wasActive) {
      _declarePlague(db, wid, ratio);
    } else if (ratio < PLAGUE_INFECTION_RATIO * 0.5 && wasActive) {
      // Resolve when infection drops well below threshold.
      _resolvePlague(db, wid);
    } else if (wasActive) {
      // Update tracked ratio.
      const info = _activePlagues.get(wid);
      info.ratio = ratio;
    }
  }
  return { ok: true, watched: targets.length, activePlagues: _activePlagues.size };
}

function _discoverActiveWorlds(db) {
  try {
    return db.prepare(`SELECT DISTINCT world_id FROM world_visits LIMIT 20`).all().map(r => r.world_id).filter(Boolean);
  } catch {
    return [];
  }
}

function _declarePlague(db, worldId, ratio) {
  _activePlagues.set(worldId, { startedAt: Math.floor(Date.now() / 1000), ratio });
  logger.info?.("plague-event", "plague_declared", { worldId, ratio });
  try {
    globalThis._concordRealtimeEmit?.("world:plague-declared", { worldId, ratio });
  } catch { /* emit best-effort */ }

  // Activate quarantine refusal field (best-effort — refusal-field lib
  // accepts arbitrary kinds in some builds).
  try {
    db.prepare(`
      INSERT INTO refusal_fields (id, world_id, kind, expires_at, reason, glyph_hint)
      VALUES (?, ?, 'quarantine_active', unixepoch() + 86400, 'plague outbreak', '⚕')
      ON CONFLICT DO NOTHING
    `).run(`quarantine_${worldId}`, worldId);
  } catch { /* table schema may differ */ }
}

function _resolvePlague(db, worldId) {
  _activePlagues.delete(worldId);
  logger.info?.("plague-event", "plague_resolved", { worldId });
  try {
    globalThis._concordRealtimeEmit?.("plague:resolved", { worldId });
  } catch { /* emit best-effort */ }
  try {
    db.prepare(`
      DELETE FROM refusal_fields WHERE world_id = ? AND kind = 'quarantine_active'
    `).run(worldId);
  } catch { /* table optional */ }
}
