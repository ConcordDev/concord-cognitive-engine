// server/lib/npc-building-affinity.js
//
// Audit item #16 — three real-but-unwired systems (npc-simulator.js's NPC
// behavior loop, building-purpose.js's 60 tagged purposeful buildings, and
// dtu-props.js's DTU world-props) with zero cross-references. This module
// is the connective tissue: it lets an NPC on its daily schedule
// (server/lib/npc-routines.js) pick a REAL building whose authored purpose
// (server/lib/building-purpose.js) matches its current activity, and — on
// arrival — notice a REAL DTU-prop placed there (server/domains/dtu-props.js
// / server/lib/dtu-props.js) and record an honest interaction with it.
//
// Honest-by-construction, three ways:
//   1. `pickBuildingForNpc` only ever returns a building whose `building_type`
//      appears BOTH in the authored purpose layout AND as a real
//      `world_buildings` row for the world — never a fabricated location.
//      No match → an honest `{ ok:true, buildingId:null, reason }`, never a
//      guessed building.
//   2. `npcUseProp` only records an interaction when `propPlacementsForWorld`
//      (the same read path the player-facing `dtu_props.list` macro uses)
//      actually returns a placement scoped to that building. No prop → an
//      honest `{ ok:false, reason:'no_prop_at_building' }`, never a
//      fabricated "the NPC picked something up."
//   3. The interaction itself is `inspectProp` — the exact governance-gated
//      read path a player uses, called with `userId:null` (NPCs don't own
//      wallets/citations, so only the read-only action applies to them;
//      take/leave/arrange stay player-only by design).
//
// No migration: NPC "currently using a prop" state is process-local (an
// LruMap, same pattern server/lib/npc-simulator.js already uses for
// `_npcCombatState`) — a hard fact about right-now, not a persisted claim,
// so no schema is needed and nothing survives restart pretending to be
// more durable than it is.
//
// Registration: see server/emergent/npc-building-affinity-cycle.js. That
// file is NOT wired into server.js by this unit — see its own header
// comment for the exact two lines an orchestrator adds, mirroring the
// documented "built, NOT mounted" precedent in server/domains/dtu-props.js.

import crypto from "node:crypto";
import { buildingsForDistrict, validDistrictIds, buildingPurposeForType, CITY_LAYOUT_WORLD_ID } from "./building-purpose.js";
import { propPlacementsForWorld, inspectProp } from "./dtu-props.js";
import { currentDaySeed } from "./npc-routines.js";
import { LruMap } from "./lru-map.js";

// ── Activity → purpose match table ──────────────────────────────────────────
//
// Each entry is an ordered list of REAL `world_buildings.building_type`
// values (verified against `content/world/concordia-hub/city-layout.json`)
// that genuinely serve that activity — not a generic "any building will do"
// fallback. `wander` is deliberately absent: aimless wandering has no
// purposeful destination, and inventing one would be exactly the kind of
// fabrication "honest by construction" forbids.
export const ACTIVITY_BUILDING_TYPES = Object.freeze({
  trade:     ["trading_floor", "market", "auction_house", "bank_house", "ledger_desk"],
  socialize: ["agora", "forum_hall", "inn", "newsroom", "counsel_room"],
  commune:   ["sanctuary", "ethics_hall", "philosophy_porch"],
  craft:     ["workshop", "atelier", "forge", "mill", "gallery_hall", "engineers_hall", "powerhouse"],
  gather:    ["depot", "warehouse", "survey_camp"],
  train:     ["gymnasium", "academy", "schoolhouse"],
  patrol:    ["watch_house", "courthouse"],
  rest:      ["house", "inn"],
  sleep:     ["house"],
  // wander: intentionally no entry — see comment above.
});

const MAX_CANDIDATE_ROWS = 20;

function seededIndex(seed, modulo) {
  if (modulo <= 0) return 0;
  const hash = crypto.createHash("sha1").update(String(seed)).digest();
  return hash[0] % modulo;
}

/**
 * Read the NPC's current activity from the real routine-state table
 * (server/lib/npc-routines.js#advanceRoutine writes it). Read-only — never
 * fabricates an activity when no schedule/state row exists yet.
 */
export function currentActivityForNpc(db, npcId) {
  if (!db || !npcId) return null;
  try {
    const row = db.prepare(`SELECT activity_kind, location_kind, arrived_at FROM npc_routine_state WHERE npc_id = ?`).get(npcId);
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Read the NPC's active preoccupation (Phase 2 asymmetry substrate), if
 * any. Used only as an extra deterministic seed input — it never overrides
 * which activity->purpose table entry applies (that's already the daily
 * schedule's job in npc-routines.js); it just lets two NPCs sharing the
 * same activity in the same building-type pool disperse across candidate
 * buildings instead of piling onto the very first one.
 */
function activePreoccupationSignature(db, npcId) {
  if (!db || !npcId) return "";
  try {
    const row = db.prepare(`
      SELECT kind, narrative FROM npc_preoccupations
      WHERE npc_id = ? AND (fades_at IS NULL OR fades_at > unixepoch())
      ORDER BY established_at DESC LIMIT 1
    `).get(npcId);
    return row ? `${row.kind}:${(row.narrative || "").slice(0, 24)}` : "";
  } catch {
    return "";
  }
}

/**
 * Given an NPC's current schedule activity (+ preoccupation, as a
 * dispersal seed), pick a nearby REAL building whose authored purpose
 * matches. Deterministic per (npc, day) — reruns on the same day pick the
 * same building. Honest null when the world has no authored purpose layout,
 * the activity has no purposeful-building mapping (e.g. wander), or no real
 * `world_buildings` row of a matching type exists yet.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {{id:string}} npc
 * @returns {{ok:boolean, buildingId:string|null, buildingType?:string, activity?:string, districtId?:string, purpose?:string, reason?:string}}
 */
export function pickBuildingForNpc(db, worldId, npc) {
  if (!db) return { ok: false, buildingId: null, reason: "no_db" };
  if (!npc?.id) return { ok: false, buildingId: null, reason: "no_npc" };
  // The authored purpose layout exists for exactly one world today — see
  // building-purpose.js's own header. Never guess a purpose mapping for a
  // world it wasn't authored for.
  if (worldId !== CITY_LAYOUT_WORLD_ID) {
    return { ok: true, buildingId: null, reason: "no_authored_layout_for_world" };
  }

  const state = currentActivityForNpc(db, npc.id);
  const activity = state?.activity_kind || null;
  if (!activity) return { ok: true, buildingId: null, reason: "no_schedule" };

  const candidateTypes = ACTIVITY_BUILDING_TYPES[activity];
  if (!candidateTypes || candidateTypes.length === 0) {
    return { ok: true, buildingId: null, activity, reason: "no_purpose_for_activity" };
  }

  let rows;
  try {
    const placeholders = candidateTypes.map(() => "?").join(",");
    rows = db.prepare(`
      SELECT id, building_type, x, z FROM world_buildings
      WHERE world_id = ? AND building_type IN (${placeholders})
      ORDER BY id
      LIMIT ?
    `).all(worldId, ...candidateTypes, MAX_CANDIDATE_ROWS);
  } catch {
    return { ok: false, buildingId: null, activity, reason: "query_failed" };
  }
  if (!rows || rows.length === 0) {
    return { ok: true, buildingId: null, activity, reason: "no_matching_building" };
  }

  const daySeed = currentDaySeed();
  const preocc = activePreoccupationSignature(db, npc.id);
  const idx = seededIndex(`${npc.id}|${daySeed}|${activity}|${preocc}`, rows.length);
  const chosen = rows[idx];

  const purpose = buildingPurposeForType(chosen.building_type, worldId);
  return {
    ok: true,
    buildingId: chosen.id,
    buildingType: chosen.building_type,
    activity,
    districtId: purpose?.district_id || null,
    purpose: purpose?.purpose || null,
  };
}

// ── "Currently using a prop" — process-local, never persisted as more
// durable than it is (see header comment for why no migration exists). ────
const _npcPropUse = new LruMap(20_000);

/** Read-only accessor for tests / observability surfaces. */
export function getNpcPropUse(npcId) {
  return _npcPropUse.get(npcId) || null;
}

/**
 * On arrival at `buildingId`, look for a REAL dtu-prop placed there and, if
 * one exists, record the NPC "using" it (inspect-only — NPCs have no
 * wallet/citation identity, so take/leave/arrange stay player-only) and
 * emit a realtime event following the same
 * `globalThis._concordRealtimeEmit` fan-out pattern npc-routine-cycle.js
 * already uses. Honest null when no prop is actually placed there.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {{id:string, faction?:string}} npc
 * @param {string} buildingId
 * @returns {{ok:boolean, npcId?:string, dtuId?:string, buildingId?:string, slot?:string, title?:string, reason?:string}}
 */
export function npcUseProp(db, worldId, npc, buildingId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!npc?.id) return { ok: false, reason: "no_npc" };
  if (!buildingId) return { ok: false, reason: "no_building" };

  const placements = propPlacementsForWorld(db, worldId, { buildingId, requesterId: null, limit: 20 });
  if (!placements.ok) return { ok: false, reason: placements.reason || "placements_query_failed" };

  // propPlacementsForWorld is a WORLD-scoped query (dtus carry no building
  // foreign key) — passing buildingId only changes how a placement's
  // POSITION is computed, not which rows come back. A placement whose
  // `roomId` is set means it actually resolved into a real room belonging
  // to THIS building (either explicitly arranged there, or its slot's
  // preferred room type genuinely exists in this building's interior —
  // see server/lib/dtu-props.js#pickRoomForSlot). A null roomId means the
  // dtu landed on a generic plaza/rooftop ring that isn't specific to this
  // building at all, so it would be dishonest to call it "at" this
  // building. Only room-scoped placements count.
  const atThisBuilding = placements.placements.filter((p) => p.roomId);
  if (atThisBuilding.length === 0) {
    return { ok: false, reason: "no_prop_at_building" };
  }

  const daySeed = currentDaySeed();
  const idx = seededIndex(`${npc.id}|${buildingId}|${daySeed}`, atThisBuilding.length);
  const placement = atThisBuilding[idx];

  // Route through the SAME governance the player-facing macro uses. NPCs
  // have no owner identity, so only the read-only "inspect" gate applies —
  // an honest failure here (e.g. the prop's visibility changed between the
  // list read and this call) propagates rather than being papered over.
  const inspected = inspectProp(db, null, placement.dtuId);
  if (!inspected.ok) return { ok: false, reason: inspected.reason || "inspect_failed" };

  const record = {
    dtuId: placement.dtuId,
    buildingId,
    worldId,
    slot: placement.slot,
    title: placement.title,
    since: Date.now(),
  };
  _npcPropUse.set(npc.id, record);

  try {
    const emit = globalThis._concordRealtimeEmit;
    if (typeof emit === "function") {
      emit("npc:prop-interaction", {
        npcId: npc.id,
        faction: npc.faction || null,
        worldId,
        buildingId,
        dtuId: placement.dtuId,
        slot: placement.slot,
        action: "inspect",
      });
    }
  } catch { /* emit failures never affect the interaction outcome */ }

  return { ok: true, npcId: npc.id, dtuId: placement.dtuId, buildingId, slot: placement.slot, title: placement.title };
}

export const _internal = {
  ACTIVITY_BUILDING_TYPES,
  MAX_CANDIDATE_ROWS,
  seededIndex,
  activePreoccupationSignature,
  _npcPropUse,
  validDistrictIds,
  buildingsForDistrict,
};
