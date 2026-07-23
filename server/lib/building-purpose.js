// server/lib/building-purpose.js
//
// Purposeful-building framework (master-spec A3+A4) — "no dead facades."
// The Concordia Hub is meant to read as a dense commerce city where EVERY
// building has a real, nameable function; major lenses are enterable
// brick-and-mortar buildings. This module is the honest data layer behind
// that pillar: it loads the authored `content/world/concordia-hub/
// city-layout.json` (which maps each hub building to a real district +
// purpose +, where applicable, a real lens) and exposes query helpers so
// callers — scene export, the Godot/Three.js clients, gameplay systems —
// can ask "what is this building for" and get a truthful answer instead of
// an empty facade.
//
// Two building "sources" exist in the authored layout, and they are
// deliberately NOT joined the same way:
//
//   - `station` / `service` — REAL `world_buildings` rows (seeded by
//     `server/lib/world-seeder.js`'s STATIONS + SEED_CITIES tables). Each of
//     these `building_type` strings is unique among itself, so it is a safe
//     join key against a `world_buildings.building_type` column (which is
//     exactly what `scene-export.js` exposes per node). `buildingPurposeForType`
//     is the join surface for this class.
//
//   - `lens_portal` — conceptual portal shells (`server/lib/
//     lens-portal-registry.js`, seeded into the separate `lens_portals` +
//     `lens_portal_npcs` tables, NOT into `world_buildings`). By that
//     registry's own pre-existing design, several lenses intentionally
//     SHARE a generic shell `building_type` (e.g. "studio", "lab", "hall",
//     "office", "library" each host multiple lensIds). Because that
//     `building_type` is ambiguous among several lenses, this module never
//     pretends one shell type resolves to one specific lens via
//     `buildingPurposeForType` — that would be exactly the kind of
//     fabrication "honest by construction" forbids. Portal entries are only
//     resolvable by their own unique authored `id` (`lensForBuilding`,
//     `buildingPurpose`), never by the shared shell `building_type`.
//
// No new table, no migration — this is JSON content + a read-only lookup
// module over the existing `world_buildings` table.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const CITY_LAYOUT_PATH = join(__dir, "../../content/world/concordia-hub/city-layout.json");

// The layout is authored for exactly one world today (mirrors
// districts.js#seedDefaultDistricts, which is also concordia-hub-only).
// Never fabricate purpose data for a world with no authored layout.
export const CITY_LAYOUT_WORLD_ID = "concordia-hub";

// Placeholder/thin-purpose detector for assertNoDeadFacades — a purpose
// string this short or this generic isn't a real, nameable function.
const MIN_PURPOSE_LEN = 12;
const BANNED_PLACEHOLDER_RE = /^(tbd|todo|placeholder|n\/a|none|unknown|building|generic|facade)$/i;

let _cache = null;

function _load() {
  if (_cache) return _cache;
  let raw;
  try {
    raw = readFileSync(CITY_LAYOUT_PATH, "utf8");
  } catch (err) {
    logger.warn("building-purpose", "city_layout_read_failed", { err: err?.message });
    _cache = { worldId: CITY_LAYOUT_WORLD_ID, buildings: [], conceptsByDistrict: {} };
    return _cache;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn("building-purpose", "city_layout_parse_failed", { err: err?.message });
    _cache = { worldId: CITY_LAYOUT_WORLD_ID, buildings: [], conceptsByDistrict: {} };
    return _cache;
  }
  parsed.buildings = Array.isArray(parsed.buildings) ? parsed.buildings : [];
  parsed.conceptsByDistrict = parsed.conceptsByDistrict && typeof parsed.conceptsByDistrict === "object"
    ? parsed.conceptsByDistrict
    : {};
  _cache = parsed;
  return _cache;
}

// Test-only escape hatch so a test can point at a fixture file or force a
// re-read after editing content on disk. Never called from production code.
export function _resetCacheForTest() {
  _cache = null;
}

/** All authored district ids the layout knows about (the 6 real districts). */
export function validDistrictIds() {
  return Object.keys(_load().conceptsByDistrict);
}

/** The master-spec concept ("Creation"/"Knowledge"/...) for a district id. */
export function conceptForDistrict(districtId) {
  return _load().conceptsByDistrict[districtId] || null;
}

/** Every authored building entry, verbatim. */
export function allBuildings() {
  return _load().buildings.slice();
}

/**
 * Look up a single authored building by its own unique `id`
 * (e.g. "station-courthouse", "portal-studio", "service-inn").
 * @param {string} buildingId
 * @returns {object|null}
 */
export function buildingPurpose(buildingId) {
  if (!buildingId) return null;
  return _load().buildings.find((b) => b.id === buildingId) || null;
}

/** All authored buildings assigned to a given district id. */
export function buildingsForDistrict(districtId) {
  if (!districtId) return [];
  return _load().buildings.filter((b) => b.district_id === districtId);
}

/**
 * The lens a building opens, by its authored `id` — or null if it isn't a
 * lens building (a service/infra building has no lens by design).
 * @param {string} buildingId
 * @returns {string|null}
 */
export function lensForBuilding(buildingId) {
  const b = buildingPurpose(buildingId);
  return b?.lens ?? null;
}

// Index built lazily: building_type -> entries, restricted to sources that
// are REAL world_buildings rows (station/service). Built once per cache
// generation so repeated scene-export calls don't re-scan the array.
let _typeIndexCache = null;
function _typeIndex() {
  if (_typeIndexCache) return _typeIndexCache;
  const idx = new Map();
  for (const b of _load().buildings) {
    if (b.source !== "station" && b.source !== "service") continue; // portals are ambiguous shells, never indexed by type
    if (!idx.has(b.building_type)) idx.set(b.building_type, []);
    idx.get(b.building_type).push(b);
  }
  _typeIndexCache = idx;
  return idx;
}

/**
 * Resolve purpose/district/lens/levels for a REAL world_buildings row by its
 * `building_type`, scoped to the world the layout is authored for. Returns
 * null (never a guess) when:
 *   - worldId isn't the authored world (no fabricated data for other worlds)
 *   - the type isn't in the layout at all
 *   - the type is ambiguous among multiple ENTRIES with source station/service
 *     (shouldn't happen for station/service types — each is unique in
 *     world-seeder.js — but stays defensive rather than picking arbitrarily)
 *
 * @param {string} buildingType
 * @param {string} worldId
 * @returns {{purpose:string, district_id:string, lens:string|null, levels:object, name:string}|null}
 */
export function buildingPurposeForType(buildingType, worldId) {
  if (!buildingType || worldId !== CITY_LAYOUT_WORLD_ID) return null;
  const candidates = _typeIndex().get(buildingType);
  if (!candidates || candidates.length !== 1) return null;
  const b = candidates[0];
  return { purpose: b.purpose, district_id: b.district_id, lens: b.lens ?? null, levels: b.levels || {}, name: b.name };
}

function _isRealPurpose(purpose) {
  if (typeof purpose !== "string") return false;
  const trimmed = purpose.trim();
  if (trimmed.length < MIN_PURPOSE_LEN) return false;
  if (BANNED_PLACEHOLDER_RE.test(trimmed)) return false;
  return true;
}

/**
 * Audit the authored layout for "dead facades" — buildings with no real
 * purpose, or an invalid district assignment. Returns an array of
 * { id, reason } for every offending entry; empty array means the layout is
 * honest by construction. Never throws.
 * @returns {Array<{id:string, reason:string}>}
 */
export function assertNoDeadFacades() {
  const layout = _load();
  const validDistricts = new Set(Object.keys(layout.conceptsByDistrict));
  const offenders = [];
  for (const b of layout.buildings) {
    if (!b.id) { offenders.push({ id: "(missing id)", reason: "missing_id" }); continue; }
    if (!_isRealPurpose(b.purpose)) { offenders.push({ id: b.id, reason: "no_real_purpose" }); continue; }
    if (!b.district_id || !validDistricts.has(b.district_id)) { offenders.push({ id: b.id, reason: "invalid_district" }); continue; }
    if (b.lens != null && (typeof b.lens !== "string" || b.lens.trim().length === 0)) {
      offenders.push({ id: b.id, reason: "empty_lens_field" });
    }
  }
  return offenders;
}

/**
 * Idempotent boot-time seed helper — kept read-only by design. This does
 * NOT insert into `world_buildings`: building creation for concordia-hub
 * already happens in `server/lib/world-seeder.js` (STATIONS + SEED_CITIES),
 * and duplicating that here would risk a second, competing building-
 * placement path for the same world. Inserting fabricated building rows
 * just to make the purpose framework "complete" would itself violate
 * honest-by-construction.
 *
 * Instead this validates the authored content is internally sound (no dead
 * facades) and reports coverage against whatever `world_buildings` rows
 * already exist for `worldId` — an honest diagnostic, not a mutation. Safe
 * to call before any buildings exist (a fresh install reports 0 matched,
 * which is simply true, not an error).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [worldId]
 * @returns {{ok:boolean, total:number, deadFacades:number, matchedBuildings?:number, reason?:string}}
 */
export function seedCityLayout(db, worldId = CITY_LAYOUT_WORLD_ID) {
  const layout = _load();
  const deadFacades = assertNoDeadFacades();
  if (deadFacades.length > 0) {
    logger.warn("building-purpose", "dead_facades_found", { count: deadFacades.length, offenders: deadFacades.slice(0, 5) });
  }
  if (worldId !== CITY_LAYOUT_WORLD_ID) {
    return { ok: true, total: layout.buildings.length, deadFacades: deadFacades.length, reason: "no_authored_layout_for_world" };
  }
  if (!db) {
    return { ok: true, total: layout.buildings.length, deadFacades: deadFacades.length, reason: "no_db_diagnostic_only" };
  }
  let matchedBuildings = 0;
  try {
    const typeCounts = db.prepare(
      `SELECT building_type, COUNT(*) AS n FROM world_buildings WHERE world_id = ? GROUP BY building_type`
    ).all(worldId);
    const present = new Set(typeCounts.map((r) => r.building_type));
    for (const b of layout.buildings) {
      if ((b.source === "station" || b.source === "service") && present.has(b.building_type)) matchedBuildings++;
    }
  } catch (err) {
    logger.warn("building-purpose", "seed_city_layout_diagnostic_failed", { err: err?.message });
    return { ok: true, total: layout.buildings.length, deadFacades: deadFacades.length, reason: "diagnostic_query_failed" };
  }
  return { ok: true, total: layout.buildings.length, deadFacades: deadFacades.length, matchedBuildings };
}

export default {
  CITY_LAYOUT_WORLD_ID,
  validDistrictIds,
  conceptForDistrict,
  allBuildings,
  buildingPurpose,
  buildingsForDistrict,
  lensForBuilding,
  buildingPurposeForType,
  assertNoDeadFacades,
  seedCityLayout,
  _resetCacheForTest,
};
