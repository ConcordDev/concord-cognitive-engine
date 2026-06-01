// server/lib/npc/purpose.js
//
// NPC purpose — the cold-start guarantee that EVERY npc (authored + procgen +
// migrated) belongs to a world/faction and has either a HOME + a WORKPLACE that
// matches their job (blacksmith→forge, innkeeper→tavern, clerk→city hall,
// builder→construction yard, …) OR an explicit roamer purpose (explorer /
// adventurer / hunter — no fixed workplace).
//
// This is mostly a WIRING layer over substrate that already existed but was
// never populated:
//   - npc-jobs.js `assignJob()` already picks a job from archetype + finds a
//     matching workplace ROOM and writes the `npc_jobs` row. We reuse it.
//   - building-interiors.js `seedRoomsForBuilding()` + `BUILDING_ROOM_BLUEPRINTS`
//     already turn a building_type into rooms. We reuse them.
//   - `world_buildings.npc_occupant`, `world_npcs.home_building_id`, and
//     `realm_citizens` (mig 158) all exist but were never written. We write them.
// The genuinely-new piece is `buildSettlement()` — without buildings in a world
// there is no forge to assign a blacksmith to.
//
// Everything is table-guarded + idempotent + behind CONCORD_NPC_PURPOSE.

import crypto from "node:crypto";
import { JOB_TYPES, assignJob } from "../npc-jobs.js";
import { seedRoomsForBuilding, BUILDING_ROOM_BLUEPRINTS } from "../building-interiors.js";

export const PURPOSE_ENABLED = () => process.env.CONCORD_NPC_PURPOSE !== "0";

// Archetypes whose PURPOSE is to roam — they get no fixed workplace (Skyrim/RDR2
// "the wilds are their job"). They still get a home to return to.
export const ROAMER_ARCHETYPES = new Set([
  "explorer", "adventurer", "hunter", "ranger", "nomad", "wanderer",
  "scout", "pilgrim", "drifter", "ranger", "pioneer",
]);

const HOUSE_CAPACITY = 4; // generic homes hold a small household

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

/** Deterministic job type for an archetype (mirrors assignJob's selection so the
 *  settlement builder can compute needed workplaces before assignment). */
export function pickJobType(archetype, criminalRep = 0) {
  if ((Number(criminalRep) || 0) > 0.5) return "criminal";
  const a = String(archetype || "generic");
  for (const [type, def] of Object.entries(JOB_TYPES)) {
    if (Array.isArray(def.archetype_match) && def.archetype_match.includes(a)) return type;
  }
  return "generic";
}

export function isRoamer(archetype) {
  return ROAMER_ARCHETYPES.has(String(archetype || "").toLowerCase());
}

// Invert BUILDING_ROOM_BLUEPRINTS → { room_type: building_type } so we can place
// the building that PROVIDES a needed workplace room.
const ROOM_PROVIDER = (() => {
  const map = Object.create(null);
  for (const [buildingType, rooms] of Object.entries(BUILDING_ROOM_BLUEPRINTS)) {
    for (const r of rooms) {
      if (r?.room_type && !(r.room_type in map)) map[r.room_type] = buildingType;
    }
  }
  return map;
})();

/** Building type that provides a given workplace room_type (or null). */
export function buildingTypeForRoom(roomType) {
  return roomType ? (ROOM_PROVIDER[roomType] ?? null) : null;
}

// Deterministic, spread-out position for a settlement building so a town reads
// as laid-out, not stacked. Seeded by (world, building_type, index).
function placePosition(worldId, key, idx) {
  const h = crypto.createHash("sha1").update(`${worldId}::${key}::${idx}`).digest();
  const ang = (h.readUInt32BE(0) / 0xffffffff) * Math.PI * 2;
  const rad = 20 + (h[4] / 255) * 80; // 20–100m ring around the town centre
  return { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad };
}

function buildingCols(db) {
  return safe(() => new Set(db.prepare(`PRAGMA table_info(world_buildings)`).all().map((c) => c.name)), new Set());
}

function placeBuilding(db, worldId, buildingType, idx) {
  const pos = placePosition(worldId, buildingType, idx);
  const id = `wb_${crypto.randomUUID()}`;
  const name = `${buildingType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())}`;
  const ok = safe(() => {
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z, owner_type, is_seed, state)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'world', 1, 'standing')
    `).run(id, worldId, buildingType, name, pos.x, pos.z);
    return true;
  }, false);
  if (!ok) return null;
  safe(() => seedRoomsForBuilding(db, id, worldId, buildingType), null);
  return id;
}

/**
 * Ensure the world has a coherent building set: homes sized to the population +
 * a workplace building for every job its NPCs hold. Idempotent — only places
 * what's missing. Returns a summary.
 */
export function buildSettlement(db, worldId, opts = {}) {
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  const cols = buildingCols(db);
  if (!cols.has("building_type")) return { ok: false, reason: "no_world_buildings" };

  // Who lives here + what jobs they need.
  const npcs = safe(() => db.prepare(
    `SELECT id, archetype, criminal_rep FROM world_npcs WHERE world_id = ? AND COALESCE(is_dead,0)=0 AND archetype NOT LIKE 'creature:%'`
  ).all(worldId), []);
  if (npcs.length === 0) return { ok: true, placed: 0, reason: "no_npcs" };

  // Workplace building types needed (from each non-roamer NPC's job → room → provider).
  const neededBuildingTypes = new Set();
  let settlers = 0;
  for (const n of npcs) {
    if (isRoamer(n.archetype)) continue;
    settlers++;
    const job = pickJobType(n.archetype, n.criminal_rep);
    const room = JOB_TYPES[job]?.room_type_needed;
    const bt = buildingTypeForRoom(room);
    if (bt) neededBuildingTypes.add(bt);
  }

  const existingByType = safe(() => {
    const rows = db.prepare(`SELECT building_type, COUNT(*) c FROM world_buildings WHERE world_id = ? GROUP BY building_type`).all(worldId);
    const m = Object.create(null);
    for (const r of rows) m[r.building_type] = r.c;
    return m;
  }, Object.create(null));

  let placed = 0;
  // One workplace building per needed type (idempotent).
  for (const bt of neededBuildingTypes) {
    if ((existingByType[bt] || 0) > 0) continue;
    if (placeBuilding(db, worldId, bt, 0)) placed++;
  }
  // Homes: enough houses for the population (everyone, incl. roamers, sleeps).
  const housesNeeded = Math.max(1, Math.ceil(npcs.length / HOUSE_CAPACITY));
  const housesHave = existingByType["house"] || 0;
  for (let i = housesHave; i < housesNeeded; i++) {
    if (placeBuilding(db, worldId, "house", i)) placed++;
  }
  return { ok: true, placed, settlers, neededBuildingTypes: [...neededBuildingTypes] };
}

/** Register an NPC as a citizen of their faction's realm in this world (if one exists). */
function registerCitizen(db, npcId, worldId, faction) {
  if (!faction) return false;
  return safe(() => {
    const realm = db.prepare(`SELECT id FROM realms WHERE world_id = ? AND faction_id = ? LIMIT 1`).get(worldId, faction);
    if (!realm) return false;
    db.prepare(`INSERT OR IGNORE INTO realm_citizens (npc_id, kingdom_id) VALUES (?, ?)`).run(npcId, realm.id);
    return true;
  }, false);
}

/** Assign a home building with spare capacity (least-occupied house). */
function assignHome(db, npcId, worldId) {
  return safe(() => {
    const already = db.prepare(`SELECT home_building_id FROM world_npcs WHERE id = ?`).get(npcId)?.home_building_id;
    if (already) return already;
    const house = db.prepare(`
      SELECT b.id, (SELECT COUNT(*) FROM world_npcs o WHERE o.home_building_id = b.id) AS occ
        FROM world_buildings b
       WHERE b.world_id = ? AND b.building_type = 'house'
       ORDER BY occ ASC LIMIT 1
    `).get(worldId);
    if (!house) return null;
    db.prepare(`UPDATE world_npcs SET home_building_id = ? WHERE id = ?`).run(house.id, npcId);
    return house.id;
  }, null);
}

/**
 * Give one NPC a purpose in `worldId`: roamers get a roamer job + a home;
 * everyone else gets a matched workplace (via the existing assignJob), the
 * workplace's npc_occupant set, a home, and realm citizenship. Idempotent.
 */
export function assignPurpose(db, npcId, worldId) {
  if (!PURPOSE_ENABLED()) return { ok: false, reason: "disabled" };
  if (!db || !npcId || !worldId) return { ok: false, reason: "missing_inputs" };
  const npc = safe(() => db.prepare(`SELECT id, archetype, faction, criminal_rep FROM world_npcs WHERE id = ?`).get(npcId), null);
  if (!npc) return { ok: false, reason: "no_npc" };

  registerCitizen(db, npcId, worldId, npc.faction);
  const home = assignHome(db, npcId, worldId);

  if (isRoamer(npc.archetype)) {
    // Roamer: explicit purpose, no fixed workplace. Recorded as an npc_jobs row
    // so the routine system + dialogue can read it; work_building_id stays null.
    safe(() => {
      const existing = db.prepare(`SELECT id FROM npc_jobs WHERE npc_id = ?`).get(npcId);
      if (existing) {
        db.prepare(`UPDATE npc_jobs SET job_type = 'roamer', work_building_id = NULL, work_room_id = NULL WHERE npc_id = ?`).run(npcId);
      } else {
        db.prepare(`INSERT INTO npc_jobs (id, npc_id, world_id, job_type) VALUES (?,?,?, 'roamer')`).run(crypto.randomUUID(), npcId, worldId);
      }
    }, null);
    return { ok: true, purpose: "roam", home, workplace: null };
  }

  // Settler: reuse the existing matcher to pick the job + workplace room.
  const job = safe(() => assignJob(db, npcId, worldId), null);
  // Mark the workplace building as occupied (the dead npc_occupant column).
  if (job?.workBuildingId) {
    safe(() => db.prepare(`UPDATE world_buildings SET npc_occupant = ? WHERE id = ? AND (npc_occupant IS NULL OR npc_occupant = ?)`).run(npcId, job.workBuildingId, npcId), null);
  }
  return { ok: true, purpose: "work", jobType: job?.jobType ?? null, workplace: job?.workBuildingId ?? null, home };
}

/**
 * Cold-start reconcile pass for a whole world: build the settlement, then give
 * every settled NPC without a job a purpose. The single entry point callers use
 * (boot seed, post-migration, a low-frequency heartbeat). Idempotent.
 */
export function assignPurposesForWorld(db, worldId, opts = {}) {
  if (!PURPOSE_ENABLED()) return { ok: false, reason: "disabled" };
  if (!db || !worldId) return { ok: false, reason: "no_db_or_world" };
  const built = buildSettlement(db, worldId);
  const npcs = safe(() => db.prepare(
    `SELECT n.id, n.archetype FROM world_npcs n
      WHERE n.world_id = ? AND COALESCE(n.is_dead,0)=0 AND n.archetype NOT LIKE 'creature:%'
        AND (? = 1 OR NOT EXISTS (SELECT 1 FROM npc_jobs j WHERE j.npc_id = n.id))`
  ).all(worldId, opts.force ? 1 : 0), []);
  let assigned = 0;
  for (const n of npcs) {
    const r = assignPurpose(db, n.id, worldId);
    if (r.ok) assigned++;
  }
  return { ok: true, built, assigned, scanned: npcs.length };
}
