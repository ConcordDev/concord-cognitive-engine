// server/lib/cross-world-relationships.js
//
// Cross-world relationship graph — sprint 2 of multi-world parity.
//
// The single-world `character_opinions` table is intentionally untouched
// (see "almost-works trap" guidance). Cross-world feelings live here,
// keyed by the explicit (from_world, from_npc, to_world, to_npc) tuple.
//
// Seeding: every authored NPC roster has an optional `concord_link_resonance`
// field shaped like "world:npc_id" or "world:faction:elder". On migration-167
// install (or via `seedRelationshipsFromAuthored`) we walk the rosters and
// install one row per authored edge with `authored = 1`.
//
// Runtime additions: when a player carries a message between worlds,
// `recordCrossWorldSignal(...)` upserts the edge with `authored = 0` so we
// can tell organic edges from canon ones.
//
// Boundary discipline: every public function takes both world IDs
// explicitly. There is no implicit "current world." The CHECK constraint
// in the table layer enforces from_world <> to_world.
//
// Kill switch: the relationship-read functions are SAFE under all kill
// switch modes (reading a graph is not a cross-world transaction). Only
// signal-recording (writes) gates on the kill switch — cross-world
// communication is suspended when paused.

import { getKillSwitchMode } from "./cross-world-economy.js";

function killSwitchAllowsCrossWorld(db) {
  return getKillSwitchMode(db) === "live";
}

const VALID_KINDS = new Set([
  "correspondent","rival","mirror","blood_rune",
  "contracted","mentor","apprentice","unknown_to_each_other",
]);

// ── Read API ──────────────────────────────────────────────────────

export function getRelation(db, fromWorld, fromId, toWorld, toId) {
  if (!db || !fromWorld || !fromId || !toWorld || !toId) return null;
  if (fromWorld === toWorld) return null;
  try {
    return db.prepare(`
      SELECT * FROM cross_npc_relationships
      WHERE from_world_id = ? AND from_npc_id = ?
        AND to_world_id = ? AND to_npc_id = ?
    `).get(fromWorld, fromId, toWorld, toId) || null;
  } catch {
    return null;
  }
}

export function listRelationsFrom(db, fromWorld, fromId) {
  if (!db || !fromWorld || !fromId) return [];
  try {
    return db.prepare(`
      SELECT * FROM cross_npc_relationships
      WHERE from_world_id = ? AND from_npc_id = ?
      ORDER BY resonance_strength DESC
    `).all(fromWorld, fromId);
  } catch {
    return [];
  }
}

export function findCrossWorldTargets(db, plotterWorld, plotterId, opts = {}) {
  if (!db || !plotterWorld || !plotterId) return [];
  const minStrength = opts.minStrength ?? 0;
  const kindFilter = opts.kind || null;
  try {
    const params = [plotterWorld, plotterId, minStrength];
    let sql = `
      SELECT to_world_id AS target_world_id,
             to_npc_id   AS target_npc_id,
             kind, resonance_strength, established_via, authored
      FROM cross_npc_relationships
      WHERE from_world_id = ? AND from_npc_id = ?
        AND resonance_strength >= ?
    `;
    if (kindFilter) {
      sql += ` AND kind = ?`;
      params.push(kindFilter);
    }
    sql += ` ORDER BY resonance_strength DESC`;
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

// ── Write API ─────────────────────────────────────────────────────

export function setRelation(db, fromWorld, fromId, toWorld, toId, opts = {}) {
  if (!db || !fromWorld || !fromId || !toWorld || !toId) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (fromWorld === toWorld) return { ok: false, reason: "same_world" };

  const kind = opts.kind && VALID_KINDS.has(opts.kind) ? opts.kind : "correspondent";
  const strength = Math.max(0, Math.min(100, opts.resonanceStrength ?? 50));
  const authored = opts.authored ? 1 : 0;
  const established_via = opts.via || null;

  db.prepare(`
    INSERT INTO cross_npc_relationships
      (from_world_id, from_npc_id, to_world_id, to_npc_id,
       kind, resonance_strength, established_via, authored)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_world_id, from_npc_id, to_world_id, to_npc_id) DO UPDATE SET
      kind = excluded.kind,
      resonance_strength = excluded.resonance_strength,
      established_via = COALESCE(excluded.established_via, established_via),
      authored = MAX(authored, excluded.authored)
  `).run(fromWorld, fromId, toWorld, toId, kind, strength, established_via, authored);

  return { ok: true };
}

export function recordCrossWorldSignal(db, fromWorld, fromId, toWorld, toId, opts = {}) {
  if (!killSwitchAllowsCrossWorld(db)) {
    return { ok: false, reason: `kill_switch_${getKillSwitchMode(db)}` };
  }
  if (!db || !fromWorld || !fromId || !toWorld || !toId) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (fromWorld === toWorld) return { ok: false, reason: "same_world" };

  const exists = getRelation(db, fromWorld, fromId, toWorld, toId);
  if (!exists) {
    setRelation(db, fromWorld, fromId, toWorld, toId, {
      kind: opts.kind || "correspondent",
      resonanceStrength: opts.resonanceStrength ?? 30,
      via: opts.via || "carried_signal",
      authored: false,
    });
  }
  db.prepare(`
    UPDATE cross_npc_relationships
    SET last_signal_at = unixepoch(),
        resonance_strength = MIN(100, resonance_strength + ?)
    WHERE from_world_id = ? AND from_npc_id = ? AND to_world_id = ? AND to_npc_id = ?
  `).run(opts.strengthBoost ?? 1, fromWorld, fromId, toWorld, toId);
  return { ok: true };
}

// ── Authored seeding ──────────────────────────────────────────────

/**
 * Parse a `concord_link_resonance` string from authored content. Accepts:
 *   "world:npc_id"            → { world, id }
 *   "world:faction:elder"     → { world, id }  (elder shorthand)
 *   null / "" / undefined     → null
 */
export function parseResonance(spec) {
  if (!spec || typeof spec !== "string") return null;
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 2) return null;
  const world = parts[0];
  const id = parts.slice(1).join(":"); // re-join so faction-shorthand survives
  if (!world || !id) return null;
  return { world, id };
}

/**
 * Seed cross_npc_relationships from a list of authored NPC rows. Each row
 * should be `{ id, world_id, concord_link_resonance, ... }`. Idempotent —
 * re-runnable. Returns count of edges created.
 */
export function seedRelationshipsFromAuthored(db, npcRows) {
  if (!db || !Array.isArray(npcRows)) return { ok: false, reason: "missing_inputs" };
  let created = 0;
  for (const row of npcRows) {
    if (!row?.id || !row?.world_id) continue;
    const target = parseResonance(row.concord_link_resonance);
    if (!target) continue;
    if (target.world === row.world_id) continue; // boundary discipline
    const r = setRelation(db, row.world_id, row.id, target.world, target.id, {
      kind: "correspondent",
      resonanceStrength: 70,
      via: "authored_resonance",
      authored: true,
    });
    if (r.ok) created++;
  }
  return { ok: true, created };
}

export const RELATIONSHIP_CONSTANTS = Object.freeze({
  VALID_KINDS: Array.from(VALID_KINDS),
  DEFAULT_AUTHORED_STRENGTH: 70,
  DEFAULT_ORGANIC_STRENGTH: 30,
});
