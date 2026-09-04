// @sql-loop-ok: crossbreed loop has order-dependent agent spawning side effects
// server/lib/npc-simulator.js
// Per-world NPC simulation. One NPCSimulator instance per active world.
// Two NPC types:
//   - Autonomous NPCs (is_conscious=0): needs-based AI, can be killed, world-native archetypes
//   - Conscious Emergents (is_conscious=1, is_immortal=1): emergent-AI-backed, untouchable,
//     serve as world Jarls/Bosses/Governors, generate main quests

import crypto from "crypto";
import logger from "../logger.js";
import { adjustSimulationDensity } from "./population-scaling.js";
import { TASK_PROMPTS } from "./prompt-registry.js";
import {
  buildStructure,
  practiceSkill,
  npcEvaluateNearbyCreation,
  npcObserveSkillUse,
} from "./npc-behaviors.js";
import { NavGrid } from "./nav-grid.js";
import { getSpawnConfig, pickEnemyArchetype } from "./npc-archetypes.js";
import { wealthIncomeFor, evaluateGearUpgrade, seedStarterGear, leaderEnsuresFactionGear, updateUserGearCeiling, enforceGearCeiling } from "./npc-gear.js";
import { decayGrief, attemptCrossbreed } from "./npc-family.js";
import { tickRecruitment } from "./npc-spawning.js";
import { shouldAssist } from "./temperament-spread.js";
import { combatRuleFor } from "./world-zones.js";
import { npcGatherFromNode, respawnExpiredNodes } from "./world-gathering.js";
import { detectiveTick, guardTick } from "./world-crime.js";
import { executeScheduledTask, assignJob, seedJobsForWorld, getCurrentPhase } from "./npc-jobs.js";
import { broadcastOpinionEvent } from "./npc-relations.js";
import { applyDamageToPlayer, computeDamage } from "./combat/damage-calculator.js";
import { resolveAggro, temperamentEnabled } from "./npc-temperament.js";
import { targetRung, stepRung, isEngaged, barkFor } from "./temperament-ladder.js";
import { bountyTier, arrestOffer, wantedLevelFor } from "./authority-heat.js";
import { LruMap, LruSet } from "./lru-map.js";

// ──────────────────────────────────────────────────────────────────────────────
// NPC Combat AI — state machine for alert/pursue/attack/retreat behavior
// ──────────────────────────────────────────────────────────────────────────────

// Module-level map: npcId → combat state object
// { state, target, startPosition, helpCalled, alertedAt, _lastAttack }
const _npcCombatState = new LruMap();

// Aggression profiles per archetype.
// Covers every archetype defined in npc-archetypes.js#UNIVERSE_ARCHETYPES
// (all 8 universes × enemies/civilians/bosses) plus the GENERIC fallbacks.
// Civilians are intentionally passive: aggro 0.0 + pursuitRadius 0 + melee 0
// routes them onto the flee path (farmer pattern). Ranges: alertRadius 6–18,
// pursuitRadius 0–30, melee 0–3, aggro 0.0–0.95. Boss archetypes get entries
// even though conscious/immortal agents skip updateNPCCombatAI — cheap, and
// covers procedurally-spawned killable variants + keeps coverage simple.
// Exported for the coverage test (npc-aggro-coverage.test.js).
export const AGGRO_PROFILE = {
  guard:     { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.8, canCallHelp: true },
  soldier:   { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.9, canCallHelp: true },
  bandit:    { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.7, canCallHelp: false },
  criminal:  { alertRadius: 8,  pursuitRadius: 15, melee: 2, aggro: 0.6, canCallHelp: false },
  farmer:    { alertRadius: 6,  pursuitRadius: 0,  melee: 0, aggro: 0.0, canCallHelp: false },
  merchant:  { alertRadius: 6,  pursuitRadius: 0,  melee: 0, aggro: 0.0, canCallHelp: false },
  // Frontier hostile creatures — aggressive on sight, longer pursuit.
  wraith:      { alertRadius: 12, pursuitRadius: 22, melee: 2, aggro: 0.85, canCallHelp: false },
  drift_eater: { alertRadius: 18, pursuitRadius: 30, melee: 3, aggro: 0.95, canCallHelp: true },
  shard_husk:  { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.8,  canCallHelp: false },

  // ── superhero ──────────────────────────────────────────────────────────────
  henchman:         { alertRadius: 10, pursuitRadius: 16, melee: 2, aggro: 0.6,  canCallHelp: true },
  mutant_brute:     { alertRadius: 8,  pursuitRadius: 20, melee: 3, aggro: 0.9,  canCallHelp: false },
  tech_villain:     { alertRadius: 14, pursuitRadius: 18, melee: 2, aggro: 0.65, canCallHelp: true },
  alien_soldier:    { alertRadius: 12, pursuitRadius: 22, melee: 2, aggro: 0.85, canCallHelp: true },
  corrupted_hero:   { alertRadius: 14, pursuitRadius: 24, melee: 2, aggro: 0.8,  canCallHelp: false },
  robot_enforcer:   { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.75, canCallHelp: true },
  vigilante:        { alertRadius: 12, pursuitRadius: 18, melee: 2, aggro: 0.5,  canCallHelp: false },
  journalist:       { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  scientist:        { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  politician:       { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  crime_lord:       { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.75, canCallHelp: true },
  dimension_ruler:  { alertRadius: 16, pursuitRadius: 26, melee: 3, aggro: 0.85, canCallHelp: false },
  shadow_government:{ alertRadius: 8,  pursuitRadius: 12, melee: 2, aggro: 0.4,  canCallHelp: true },

  // ── fantasy ────────────────────────────────────────────────────────────────
  goblin:           { alertRadius: 8,  pursuitRadius: 14, melee: 2, aggro: 0.75, canCallHelp: true },
  orc_warrior:      { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.85, canCallHelp: true },
  dark_wizard:      { alertRadius: 17, pursuitRadius: 20, melee: 1, aggro: 0.7,  canCallHelp: false },
  undead:           { alertRadius: 8,  pursuitRadius: 16, melee: 2, aggro: 0.8,  canCallHelp: false },
  dragon_cultist:   { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.8,  canCallHelp: true },
  troll:            { alertRadius: 6,  pursuitRadius: 14, melee: 3, aggro: 0.95, canCallHelp: false },
  blacksmith:       { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  bard:             { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  lich_king:        { alertRadius: 18, pursuitRadius: 28, melee: 2, aggro: 0.9,  canCallHelp: true },
  dragon_lord:      { alertRadius: 18, pursuitRadius: 30, melee: 3, aggro: 0.9,  canCallHelp: false },
  dark_jarl:        { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.8,  canCallHelp: true },

  // ── scifi ──────────────────────────────────────────────────────────────────
  rogue_android:    { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.8,  canCallHelp: false },
  alien_scout:      { alertRadius: 16, pursuitRadius: 24, melee: 2, aggro: 0.6,  canCallHelp: true },
  pirate:           { alertRadius: 10, pursuitRadius: 16, melee: 2, aggro: 0.65, canCallHelp: true },
  corporate_enforcer:{ alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.75, canCallHelp: true },
  combat_drone:     { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.85, canCallHelp: true },
  engineer:         { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  medic:            { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  pilot:            { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  hacker:           { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  ai_overlord:      { alertRadius: 18, pursuitRadius: 30, melee: 2, aggro: 0.9,  canCallHelp: true },
  alien_queen:      { alertRadius: 14, pursuitRadius: 26, melee: 3, aggro: 0.9,  canCallHelp: true },
  mega_corp_ceo:    { alertRadius: 8,  pursuitRadius: 10, melee: 1, aggro: 0.3,  canCallHelp: true },

  // ── cyberpunk ──────────────────────────────────────────────────────────────
  street_gang:      { alertRadius: 9,  pursuitRadius: 15, melee: 2, aggro: 0.65, canCallHelp: true },
  cyborg_enforcer:  { alertRadius: 12, pursuitRadius: 20, melee: 2, aggro: 0.8,  canCallHelp: true },
  netrunner:        { alertRadius: 14, pursuitRadius: 14, melee: 1, aggro: 0.5,  canCallHelp: false },
  corpo_assassin:   { alertRadius: 15, pursuitRadius: 25, melee: 2, aggro: 0.9,  canCallHelp: false },
  fixer:            { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  street_doc:       { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  techie:           { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  gang_warlord:     { alertRadius: 12, pursuitRadius: 22, melee: 3, aggro: 0.85, canCallHelp: true },
  corp_chairman:    { alertRadius: 8,  pursuitRadius: 10, melee: 1, aggro: 0.3,  canCallHelp: true },

  // ── horror ─────────────────────────────────────────────────────────────────
  zombie:           { alertRadius: 7,  pursuitRadius: 20, melee: 2, aggro: 0.9,  canCallHelp: false },
  cultist:          { alertRadius: 10, pursuitRadius: 16, melee: 2, aggro: 0.7,  canCallHelp: true },
  demon:            { alertRadius: 14, pursuitRadius: 26, melee: 3, aggro: 0.95, canCallHelp: false },
  possessed:        { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.85, canCallHelp: false },
  survivor:         { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  priest:           { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  hunter:           { alertRadius: 13, pursuitRadius: 18, melee: 2, aggro: 0.45, canCallHelp: false },
  elder_god:        { alertRadius: 18, pursuitRadius: 30, melee: 3, aggro: 0.9,  canCallHelp: false },
  cult_leader:      { alertRadius: 12, pursuitRadius: 18, melee: 2, aggro: 0.7,  canCallHelp: true },

  // ── western ────────────────────────────────────────────────────────────────
  outlaw:           { alertRadius: 10, pursuitRadius: 17, melee: 2, aggro: 0.7,  canCallHelp: true },
  bounty_hunter:    { alertRadius: 15, pursuitRadius: 24, melee: 2, aggro: 0.55, canCallHelp: false },
  bandit_gang:      { alertRadius: 10, pursuitRadius: 16, melee: 2, aggro: 0.7,  canCallHelp: true },
  sheriff:          { alertRadius: 14, pursuitRadius: 22, melee: 2, aggro: 0.6,  canCallHelp: true },
  saloon_keeper:    { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  miner:            { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  doctor:           { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  outlaw_king:      { alertRadius: 12, pursuitRadius: 22, melee: 2, aggro: 0.8,  canCallHelp: true },
  railroad_baron:   { alertRadius: 7,  pursuitRadius: 8,  melee: 1, aggro: 0.2,  canCallHelp: true },

  // ── medieval ───────────────────────────────────────────────────────────────
  knight_rogue:     { alertRadius: 11, pursuitRadius: 18, melee: 2, aggro: 0.75, canCallHelp: false },
  mercenary:        { alertRadius: 10, pursuitRadius: 18, melee: 2, aggro: 0.7,  canCallHelp: true },
  plague_bearer:    { alertRadius: 8,  pursuitRadius: 14, melee: 2, aggro: 0.75, canCallHelp: false },
  assassin:         { alertRadius: 16, pursuitRadius: 24, melee: 2, aggro: 0.9,  canCallHelp: false },
  knight:           { alertRadius: 13, pursuitRadius: 20, melee: 2, aggro: 0.6,  canCallHelp: true },
  innkeeper:        { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  monk:             { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  dark_king:        { alertRadius: 14, pursuitRadius: 24, melee: 2, aggro: 0.85, canCallHelp: true },
  assassin_master:  { alertRadius: 17, pursuitRadius: 26, melee: 2, aggro: 0.9,  canCallHelp: false },

  // ── modern ─────────────────────────────────────────────────────────────────
  crime_syndicate:  { alertRadius: 9,  pursuitRadius: 15, melee: 2, aggro: 0.6,  canCallHelp: true },
  corrupt_officer:  { alertRadius: 12, pursuitRadius: 18, melee: 2, aggro: 0.65, canCallHelp: true },
  hitman:           { alertRadius: 15, pursuitRadius: 24, melee: 2, aggro: 0.9,  canCallHelp: false },
  detective:        { alertRadius: 13, pursuitRadius: 18, melee: 2, aggro: 0.4,  canCallHelp: true },
  mechanic:         { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  godfather:        { alertRadius: 10, pursuitRadius: 14, melee: 2, aggro: 0.5,  canCallHelp: true },
  intelligence_chief:{ alertRadius: 10, pursuitRadius: 12, melee: 1, aggro: 0.35, canCallHelp: true },

  // ── generic fallbacks (npc-archetypes.js GENERIC_ARCHETYPES) ─────────────────
  wanderer:         { alertRadius: 8,  pursuitRadius: 12, melee: 2, aggro: 0.25, canCallHelp: false },
  citizen:          { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },
  elder:            { alertRadius: 7,  pursuitRadius: 0,  melee: 0, aggro: 0.0,  canCallHelp: false },

  default:   { alertRadius: 8,  pursuitRadius: 12, melee: 2, aggro: 0.3, canCallHelp: false },
};

// Base NPC attack damage by archetype (added on top of 8-15 base roll).
// Passive civilians + low-threat authority figures carry no bonus (they fall
// back to the base roll on the rare occasion they ever attack). Exported for
// the coverage test — every key here must have a matching AGGRO_PROFILE entry.
export const ARCHETYPE_DAMAGE_BONUS = {
  guard: 5, soldier: 8, bandit: 4,
  wraith: 6, drift_eater: 12, shard_husk: 8,
  // superhero
  henchman: 3, mutant_brute: 10, tech_villain: 6, alien_soldier: 8,
  corrupted_hero: 9, robot_enforcer: 7, vigilante: 5, crime_lord: 8, dimension_ruler: 12,
  // fantasy
  goblin: 2, orc_warrior: 7, dark_wizard: 9, undead: 3, dragon_cultist: 5,
  troll: 12, lich_king: 14, dragon_lord: 15, dark_jarl: 10,
  // scifi
  rogue_android: 7, alien_scout: 4, pirate: 4, corporate_enforcer: 6,
  combat_drone: 6, ai_overlord: 14, alien_queen: 13,
  // cyberpunk
  street_gang: 3, cyborg_enforcer: 8, netrunner: 5, corpo_assassin: 11, gang_warlord: 11,
  // horror
  zombie: 2, cultist: 3, demon: 12, possessed: 6, hunter: 6, elder_god: 15, cult_leader: 8,
  // western
  outlaw: 4, bounty_hunter: 7, bandit_gang: 4, sheriff: 6, outlaw_king: 9,
  // medieval
  knight_rogue: 8, mercenary: 6, plague_bearer: 4, assassin: 10, knight: 7,
  dark_king: 12, assassin_master: 12,
  // modern
  crime_syndicate: 3, corrupt_officer: 5, hitman: 10, detective: 4, godfather: 6,
};

// Rate-limit: minimum ms between NPC attacks on same target
const NPC_ATTACK_COOLDOWN_MS = 1500;

/**
 * Fetch active player positions from the database for a given world.
 * Returns array of { userId, x, z }.
 */
function _getPlayerPositions(db, worldId) {
  try {
    // world_visits stores last_position as JSON; fall back to player_world_state
    const visits = db.prepare(`
      SELECT wv.user_id, wv.last_position, pws.x as sx, pws.z as sz
      FROM world_visits wv
      LEFT JOIN player_world_state pws ON pws.user_id = wv.user_id
      WHERE wv.world_id = ? AND wv.departed_at IS NULL
    `).all(worldId);

    return visits.map(v => {
      const pos = _parseJSON(v.last_position, null);
      const x = pos?.x ?? v.sx ?? null;
      const z = pos?.z ?? v.sz ?? null;
      if (x === null || z === null) return null;
      return { userId: v.user_id, x, z };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Euclidean distance between two {x,z} points.
 */
function _dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ──────────────────────────────────────────────────────────────────────────────
// Line-of-sight — a defensive occlusion gate on target ACQUISITION only.
// An NPC can't be alerted to (or begin pursuing) a player it can't see through
// a standing building. Once engaged (pursuing/attacking/retreating) the NPC
// keeps target memory — no LOS re-check there, by design. Fail-open: any DB or
// geometry error returns true (radius-only behavior), so a defensive feature
// can never make combat *worse* than before it existed.
// ──────────────────────────────────────────────────────────────────────────────

// Per-world building geometry cache: worldId → { at: ms, rows: [...] }
const _losBuildingsCache = new Map();
const _LOS_CACHE_TTL_MS = 5000;

/**
 * Pure 2D segment-vs-axis-aligned-AABB (building footprint) intersection test.
 * The footprint is the rect centred on (bld.x, bld.z) spanning ±width/2 × ±depth/2.
 * Rotation is intentionally ignored (axis-aligned approximation) — a coarse but
 * cheap occluder good enough for an alert gate.
 *
 * If either endpoint is INSIDE the rect, returns false — an NPC or player
 * standing in a building's interior/doorway should not be blinded by that
 * building's own walls. Returns false for a degenerate (zero-area) footprint.
 *
 * Uses the slab method (Liang–Barsky style) for the segment a→b against the box.
 *
 * @param {{x:number,z:number}} a  segment endpoint (e.g. NPC position)
 * @param {{x:number,z:number}} b  segment endpoint (e.g. player position)
 * @param {{x:number,z:number,width:number,depth:number}} bld  building footprint
 * @returns {boolean} true if the segment crosses the footprint (i.e. blocks LOS)
 */
export function segmentIntersectsFootprint(a, b, bld) {
  if (!a || !b || !bld) return false;
  const ax = Number(a.x), az = Number(a.z);
  const bx = Number(b.x), bz = Number(b.z);
  const cx = Number(bld.x), cz = Number(bld.z);
  const w  = Number(bld.width), d = Number(bld.depth);
  if (![ax, az, bx, bz, cx, cz, w, d].every(Number.isFinite)) return false;
  if (w <= 0 || d <= 0) return false; // degenerate footprint occludes nothing

  const minX = cx - w / 2, maxX = cx + w / 2;
  const minZ = cz - d / 2, maxZ = cz + d / 2;

  const inside = (px, pz) => px >= minX && px <= maxX && pz >= minZ && pz <= maxZ;
  // Either endpoint inside → not treated as an occluder (see doc above).
  if (inside(ax, az) || inside(bx, bz)) return false;

  // Liang–Barsky clip of the parametric segment p(t)=a+t*(b-a), t∈[0,1].
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    // For p*t <= q along one boundary.
    if (p === 0) return q >= 0; // parallel to slab: inside iff q>=0
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, ax - minX)) return false;
  if (!clip( dx, maxX - ax)) return false;
  if (!clip(-dz, az - minZ)) return false;
  if (!clip( dz, maxZ - az)) return false;
  // A crossing exists if the clipped interval is non-empty within [0,1].
  return t0 <= t1;
}

/**
 * Load (and cache, ~5s TTL) the standing/damaged building footprints for a
 * world. Mirrors skill-environment.js#shouldStaggerOnTerrain's query convention
 * (state IN ('standing','damaged'), try/catch). Capped at 300 rows. Returns
 * null on any DB error so hasLineOfSight can fail open.
 */
function _getWorldBuildings(db, worldId) {
  const cached = _losBuildingsCache.get(worldId);
  const now = Date.now();
  if (cached && (now - cached.at) < _LOS_CACHE_TTL_MS) return cached.rows;
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, x, z, width, depth
        FROM world_buildings
       WHERE world_id = ?
         AND state IN ('standing', 'damaged')
       LIMIT 300
    `).all(worldId);
  } catch {
    return null;
  }
  _losBuildingsCache.set(worldId, { at: now, rows });
  return rows;
}

/**
 * True if `from` can see `to` in world `worldId` — i.e. no standing/damaged
 * building footprint sits across the sight segment. Fail-open: returns true on
 * any DB/query/geometry failure (radius-only fallback), so LOS never blinds an
 * NPC more than the pre-existing distance gate did.
 */
export function hasLineOfSight(db, worldId, from, to) {
  try {
    if (!from || !to) return true;
    const rows = _getWorldBuildings(db, worldId);
    if (!rows || rows.length === 0) return true;
    for (const bld of rows) {
      if (segmentIntersectsFootprint(from, to, bld)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Test-only helper — clears the per-world building geometry cache so back-to-back
 * scenarios sharing a worldId aren't served a stale snapshot.
 */
export function _losCacheClear() {
  _losBuildingsCache.clear();
}

/**
 * Test-only helper — read the private combat-state entry for an NPC id so the
 * LOS/FSM test can assert transitions without reaching into module internals.
 */
export function _combatStateFor(npcId) {
  return _npcCombatState.get(npcId) || null;
}

/**
 * Core combat AI function — runs once per NPC per tick.
 * Accesses io lazily via globalThis._concordREALTIME.
 * Exported (additive) so the LOS test can drive the real FSM.
 *
 * @param {Array<{userId,x,z}>} [cachedPlayers] — optional pre-fetched
 *   _getPlayerPositions(db, worldId) result. When omitted, fetches it
 *   itself (unchanged behavior for every pre-existing caller). Callers that
 *   invoke this per-NPC in a loop over one world/tick (NPCSimulator#tick)
 *   should pass the same array for every NPC — the position list doesn't
 *   change within one synchronous tick, so re-querying it per NPC is pure
 *   redundant DB work. Real production finding, 2026-08-23.
 */
export function updateNPCCombatAI(npc, worldId, db, cachedPlayers) {
  // Graceful skip if NPC has no position
  if (!npc || !npc.location) return;

  const archetype = npc.archetype || 'default';
  let   profile   = AGGRO_PROFILE[archetype] || AGGRO_PROFILE.default;

  // Fetch NPC DB row for HP / is_wanted / criminal_rep
  let npcRow;
  try {
    npcRow = db.prepare(
      'SELECT current_hp, max_hp, is_wanted, criminal_rep FROM world_npcs WHERE id = ?'
    ).get(npc.id);
  } catch { return; }

  if (!npcRow) return;

  const hpRatio    = (npcRow.current_hp ?? 100) / Math.max(1, npcRow.max_hp ?? 100);
  const isWanted   = !!npcRow.is_wanted;

  // Get player positions + nearest player once (reused by flee logic + FSM below).
  const players = cachedPlayers !== undefined ? cachedPlayers : _getPlayerPositions(db, worldId);
  let nearestPlayer = null;
  let nearestDist   = Infinity;
  for (const p of players) {
    const d = _dist2d(npc.location, p);
    if (d < nearestDist) {
      nearestDist   = d;
      nearestPlayer = p;
    }
  }

  // Wanted NPCs are always maximally aggressive
  let effectiveAggro = isWanted ? 0.9 : profile.aggro;

  // Temperament gate (Phase 1) — modulate aggro by the NPC's emotional/social
  // state toward the nearest player, and grant a pacifist the capacity to engage
  // when emotion carries it into hostility. Off by default (CONCORD_TEMPERAMENT);
  // when off, effectiveAggro + profile stay exactly the archetype values above.
  if (temperamentEnabled() && nearestPlayer) {
    try {
      const r = resolveAggro(
        db, npc, { kind: 'player', id: nearestPlayer.userId },
        profile.aggro, isWanted, profile, { worldId }
      );
      effectiveAggro = r.effectiveAggro;
      profile        = r.profile;
    } catch { /* non-fatal: keep archetype aggro */ }
  }

  // Non-aggro NPCs (farmer, merchant) — never attack, may flee (handled separately)
  if (effectiveAggro === 0.0 && !isWanted) {
    // Non-aggro flee logic: if a player is very close, path away
    for (const player of players) {
      const d = _dist2d(npc.location, player);
      if (d < profile.alertRadius) {
        // Flee: move opposite direction from the player
        _fleeFromPoint(npc, player);
        break;
      }
    }
    return;
  }

  // Ensure combat state entry
  if (!_npcCombatState.has(npc.id)) {
    _npcCombatState.set(npc.id, {
      state: 'idle',
      target: null,
      startPosition: { x: npc.location.x, z: npc.location.z },
      helpCalled: false,
      alertedAt: 0,
      _lastAttack: 0,
      rung: 'neutral',
    });
  }

  const cs        = _npcCombatState.get(npc.id);
  const now       = Date.now();
  const prevState = cs.state;

  // Temperament ladder (Phase 2) — graded intent rung + escalation barks. Off by
  // default (CONCORD_TEMPERAMENT); when off, cs.rung is untouched and the attack
  // path below behaves exactly as before. The climb forces a THREATENING (final
  // warning) tick before HOSTILE, so an NPC always warns before it strikes.
  if (temperamentEnabled()) {
    const tgt = targetRung({
      effectiveAggro,
      nearestDist,
      alertRadius:   profile.alertRadius,
      pursuitRadius: profile.pursuitRadius,
      melee:         profile.melee,
    });
    const prevRung = cs.rung || 'neutral';
    const stepped  = stepRung(prevRung, tgt);
    cs.rung = stepped.rung;
    if (stepped.transition === 'up' && stepped.rung !== prevRung) {
      // At THREATENING, an authority NPC offers arrest to a wanted target
      // instead of just warning (Part 4 arrest gate). null for everyone else.
      let arrest = null;
      if (stepped.rung === 'threatening'
          && (archetype === 'guard' || archetype === 'soldier')
          && nearestPlayer) {
        try {
          const tier = bountyTier(wantedLevelFor(db, worldId, nearestPlayer.userId));
          arrest = arrestOffer('threatening', tier);
        } catch { /* law table absent */ }
      }
      _emitBark(npc, worldId, stepped.rung, barkFor(stepped.rung, archetype), arrest);
    }
  }

  // ── State machine transitions ──────────────────────────────────────────────

  if (cs.state === 'idle') {
    // idle → alerted: player within alert radius AND conditions met AND visible.
    // LOS is an ADDITIONAL conjunct on acquisition — a wall between NPC and
    // player keeps the NPC idle (fail-open on DB error, see hasLineOfSight).
    if (nearestPlayer && nearestDist <= profile.alertRadius && effectiveAggro > 0
        && hasLineOfSight(db, worldId, npc.location, nearestPlayer)) {
      cs.state     = 'alerted';
      cs.target    = nearestPlayer;
      cs.alertedAt = now;
      cs.startPosition = { x: npc.location.x, z: npc.location.z };
    }

  } else if (cs.state === 'alerted') {
    // alerted → pursuing: target confirmed within pursuit radius AND still
    // visible. No-LOS falls through to the 10s alertedAt timeout back to idle.
    if (nearestPlayer && nearestDist <= profile.pursuitRadius
        && hasLineOfSight(db, worldId, npc.location, nearestPlayer)) {
      cs.target = nearestPlayer;
      if (profile.pursuitRadius > 0) {
        cs.state = 'pursuing';
        // Emit calling_help once when first entering combat
        if (!cs.helpCalled && profile.canCallHelp) {
          cs.helpCalled = true;
          _callForHelp(npc, worldId, db);
        }
      }
    } else if (now - cs.alertedAt > 10000) {
      // Timed out — go back to idle
      cs.state  = 'idle';
      cs.target = null;
    }

  } else if (cs.state === 'pursuing') {
    if (!nearestPlayer || nearestDist > profile.pursuitRadius + 5) {
      // Lost target — return to idle
      cs.state  = 'idle';
      cs.target = null;
    } else {
      cs.target = nearestPlayer;

      // HP retreat check
      if (hpRatio < 0.25) {
        cs.state = 'retreating';
      } else if (nearestDist <= profile.melee) {
        // In melee range — attack
        cs.state = 'attacking';
        if (!cs.helpCalled && profile.canCallHelp) {
          cs.helpCalled = true;
          _callForHelp(npc, worldId, db);
        }
      } else {
        // Move toward target
        _moveToward(npc, nearestPlayer, db, worldId);
      }
    }

  } else if (cs.state === 'attacking') {
    if (!nearestPlayer) {
      cs.state = 'idle';
    } else if (hpRatio < 0.25) {
      cs.state = 'retreating';
    } else if (nearestDist > profile.melee + 1) {
      // Target moved out of range — pursue again
      cs.state = 'pursuing';
    } else {
      // Attack! Rate-limited to once per NPC_ATTACK_COOLDOWN_MS.
      // Temperament: hold fire until the NPC has climbed to HOSTILE — the
      // THREATENING final-warning tick must pass first. Off => attack now.
      if (now - cs._lastAttack >= NPC_ATTACK_COOLDOWN_MS
          && (!temperamentEnabled() || isEngaged(cs.rung))) {
        cs._lastAttack = now;
        _performNPCAttack(npc, nearestPlayer, worldId, db, archetype);
      }
    }

  } else if (cs.state === 'retreating') {
    const distFromStart = _dist2d(npc.location, cs.startPosition);
    if (distFromStart > 30) {
      // Gave up — too far from start
      cs.state  = 'idle';
      cs.target = null;
      cs.helpCalled = false;
    } else if (hpRatio >= 0.5) {
      // Recovered enough — go back to idle
      cs.state  = 'idle';
      cs.target = null;
    } else {
      // Pathfind back toward start position
      _moveToward(npc, cs.startPosition, db, worldId);
    }
  }

  // Temperament: announce the break when the NPC first retreats (HP collapse) —
  // the FLEEING rung of the ladder. One bark on the transition into retreating.
  if (temperamentEnabled() && cs.state === 'retreating' && prevState !== 'retreating') {
    _emitBark(npc, worldId, 'fleeing', barkFor('fleeing', archetype));
  }
}

/**
 * Emit a world:npc-bark socket event — the legibility channel for the graded
 * escalation ladder. Externalizes the NPC's intent (the F.E.A.R. lesson): one
 * bark per rung transition so the player can read the decision, not be
 * tripwired. A blank text (monsters, civilian HOSTILE) still emits the rung so
 * the audio/snarl layer can voice it. Never throws.
 */
function _emitBark(npc, worldId, rung, text, arrest = null) {
  try {
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-bark', {
      worldId,
      npcId:    npc.id,
      position: npc.location,
      rung,
      text:     text || '',
      arrest:   arrest || null,
    });
  } catch { /* non-fatal */ }
}

/**
 * Emit world:npc-gather socket event — the World Lens's only signal that
 * an NPC gathering was previously a silent DB write (activity_resources +
 * world_resource_nodes updated, nothing else). Mirrors `_emitBark`'s
 * pattern exactly. `nodeType` drives which tool-swing reads correctly
 * (axe for tree, pickaxe for ore/stone/crystal/fuel, sickle/hoe for
 * herb/soil — same table `world-gathering.js`'s TOOL_COMPAT already
 * encodes for the player-facing yield-estimate path).
 */
function _emitGather(npc, worldId, gathered) {
  if (!gathered) return;
  try {
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-gather', {
      worldId,
      npcId:        npc.id,
      // Node position, NOT npc.location — the tool-swing/particle burst
      // should land at the resource node the NPC is actually gathering
      // from, which can be up to 30m away (getNearbyNodes' search radius),
      // not "wherever the NPC happens to be standing" per npc.location.
      x:            gathered.x,
      y:            gathered.y,
      z:            gathered.z,
      nodeId:       gathered.nodeId,
      nodeType:     gathered.nodeType ?? null,
      resourceId:   gathered.resourceId,
      resourceName: gathered.resourceName,
      amount:       gathered.amount,
    });
  } catch { /* non-fatal */ }
}

/**
 * Emit world:npc-alert socket event and mark nearby NPCs as alerted.
 */
function _callForHelp(npc, worldId, db) {
  const HELP_RADIUS = 15;
  try {
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-alert', {
      worldId,
      npcId:    npc.id,
      position: npc.location,
      radius:   HELP_RADIUS,
    });

    // Alert nearby NPCs by setting their combat state to alerted
    const nearbyNpcs = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND is_dead = 0 AND id != ?
      LIMIT 20
    `).all(worldId, npc.id);

    for (const nearby of nearbyNpcs) {
      const nearbyLoc = _parseNPCLocation(db, nearby.id);
      if (!nearbyLoc) continue;
      const d = _dist2d(npc.location, nearbyLoc);
      if (d <= HELP_RADIUS) {
        // Temperament P7 — assistance-gate: only an ally answers (and never a
        // child/non-combatant or someone in a sanctuary). Off (CONCORD_TEMPERAMENT
        // unset) → shouldAssist returns true for everyone, i.e. today's
        // indiscriminate alert, byte-identical.
        try {
          if (!shouldAssist(db, { callerId: npc.id, responderId: nearby.id, worldId, responderLoc: { x: nearbyLoc.x, z: nearbyLoc.z }, combatRuleFor }).assist) continue;
        } catch { /* gate best-effort — fall through to legacy alert */ }
        // If this nearby NPC doesn't have combat state yet, set it to alerted
        if (!_npcCombatState.has(nearby.id)) {
          _npcCombatState.set(nearby.id, {
            state: 'alerted',
            target: null,
            startPosition: { x: nearbyLoc.x, z: nearbyLoc.z },
            helpCalled: false,
            alertedAt: Date.now(),
            _lastAttack: 0,
          });
        } else {
          const nearbyCs = _npcCombatState.get(nearby.id);
          if (nearbyCs.state === 'idle') {
            nearbyCs.state     = 'alerted';
            nearbyCs.alertedAt = Date.now();
          }
        }
      }
    }
  } catch { /* non-fatal */ }
}

/**
 * Get location of an NPC from DB (lightweight read).
 */
function _parseNPCLocation(db, npcId) {
  try {
    const row = db.prepare('SELECT current_location FROM world_npcs WHERE id = ?').get(npcId);
    return row ? _parseJSON(row.current_location, null) : null;
  } catch { return null; }
}

/**
 * Set NPC path toward a target point using NavGrid A*.
 */
function _moveToward(npc, target, db, worldId) {
  try {
    const navGrid = getNavGrid();
    const path    = navGrid.findPath(npc.location.x, npc.location.z, target.x, target.z);
    if (path && path.length > 0) {
      npc.state.currentPath = path;
      npc.state.pathIndex   = 0;
    }
  } catch { /* non-fatal */ }
}

/**
 * Move NPC away from a point (flee behavior).
 */
function _fleeFromPoint(npc, from) {
  try {
    const dx    = npc.location.x - from.x;
    const dz    = npc.location.z - from.z;
    const len   = Math.sqrt(dx * dx + dz * dz) || 1;
    const fleeX = npc.location.x + (dx / len) * 20;
    const fleeZ = npc.location.z + (dz / len) * 20;

    const navGrid = getNavGrid();
    const path    = navGrid.findPath(npc.location.x, npc.location.z, fleeX, fleeZ);
    if (path && path.length > 0) {
      npc.state.currentPath = path;
      npc.state.pathIndex   = 0;
    }
  } catch { /* non-fatal */ }
}

/**
 * Perform one NPC melee attack on a player.
 */
function _performNPCAttack(npc, target, worldId, db, archetype) {
  try {
    const baseDamage  = 8 + Math.floor(Math.random() * 8); // 8-15
    const bonus       = ARCHETYPE_DAMAGE_BONUS[archetype] || 0;
    const totalDamage = baseDamage + bonus;

    const attackerStats = {
      skillLevel: 1,
      element: 'none',
      basePower: totalDamage,
      enchantmentBonus: 0,
      worldMultiplier: 1.0,
    };

    // Minimal defender stats (no armor lookup to keep tick fast)
    const defenderStats = {
      physical_resistance: 0,
      current_hp: 100,
      max_hp: 100,
      status_effects: '[]',
    };

    const damageResult = computeDamage(attackerStats, defenderStats, {});
    const { kill } = applyDamageToPlayer(db, worldId, npc.id, 'npc', target.userId, damageResult, {
      element: 'none', bar_used: 'hp', bar_cost: damageResult.finalDamage,
      // Hit position → the attacking NPC's live simulated location. This is the
      // same `npc.location` the simulator pathfinds, checks line-of-sight, and
      // range-gates this very attack from, and the same value it already ships
      // on its own socket events — i.e. the authoritative "where this creature
      // is", not a reconstruction. Feeds damage_events.{x,z} → footprint feed.
      x: npc.location?.x, z: npc.location?.z,
    });

    // Wave 4 (Gap C) — autonomous NPC heartbeat attacks are a second real
    // source of lethal damage to a player (independent of the HTTP
    // combat/npc-attack route, which only fires on an explicit client call).
    // A roguelite run's purchased revive must cover this path too, or a
    // player fighting wilderness NPCs during a run could die here with a
    // banked revive charge that never gets the chance to fire.
    // `_performNPCAttack` is synchronous by design (called fire-and-forget,
    // no callers await it) — use the same .then()-chain style the flow-
    // recorder block below already uses for its own optional async work,
    // rather than making this whole function async.
    if (kill) {
      import("./roguelite.js").then(({ maybeReviveRoguelitePlayer }) => {
        const rev = maybeReviveRoguelitePlayer(db, target.userId, worldId);
        if (rev.revived) {
          try {
            globalThis._concordREALTIME?.io?.to(`user:${target.userId}`)?.emit?.("roguelite:revived", {
              worldId, revivesRemaining: rev.revivesRemaining, reviveHp: rev.reviveHp,
            });
          } catch { /* emit best-effort */ }
        }
      }).catch(() => { /* roguelite substrate optional — a kill without an active run is unaffected */ });
    }

    // Flow Combat: NPCs evolve their own styles. Record this attack into the
    // flow substrate so the flow engine can derive personalized combos for
    // this specific NPC + bias them toward whichever style worked best
    // against this specific player. The recorder + engine handle
    // fighter_kind='npc' identically to players.
    try {
      import("./combat/context-engine.js").then(({ detectCombatContext }) => {
        const ctx = detectCombatContext({
          position: { x: npc.location.x, y: npc.location.y ?? 0, z: npc.location.z },
          groundY: 0,
          grounded: true,
        });
        return import("./combat/flow-recorder.js").then(({ recordCombatFlow }) => {
          // Per-player NPC memory: target id is stamped on every flow row so
          // the engine can later query "what worked against this specific
          // player?" via getRecentFlows({ context, targetId } filter).
          const npcCombatState = _npcCombatState.get(npc.id);
          const chainId = npcCombatState?._currentChain || `npc:${npc.id}:${target.userId}:${Date.now()}`;
          if (npcCombatState) {
            npcCombatState._currentChain = chainId;
            npcCombatState._stepIndex = (npcCombatState._stepIndex || 0) + 1;
          }
          recordCombatFlow(db, {
            fighterId:  npc.id,
            fighterKind:'npc',
            context:    ctx.context,
            style:      archetype || ctx.styleHints[0] || null,
            action:     totalDamage > 12 ? 'attack-heavy' : 'attack-light',
            actionMeta: { archetype, vs: target.userId },
            targetId:   target.userId,
            hit:        damageResult.finalDamage > 0,
            damage:     Number(damageResult.finalDamage || 0),
            isCrit:     !!damageResult.isCrit,
            chainId,
            stepIndex:  npcCombatState?._stepIndex ?? 0,
          });
          // 1-in-12 attacks trigger an evolution pass for this NPC. Lower
          // frequency than players to keep per-tick CPU bounded across many
          // NPCs simultaneously.
          if (Math.random() < 0.083) {
            return import("./combat/flow-engine.js").then(({ evolveFighterCombos }) => {
              const r = evolveFighterCombos(db, npc.id, "npc");
              if (r?.ok && r.evolved.some((e) => e.evolvedNow)) {
                const io = globalThis._concordREALTIME?.io;
                io?.to(`user:${target.userId}`).emit("combat:npc-combo-evolved", {
                  npcId: npc.id,
                  evolved: r.evolved.filter((e) => e.evolvedNow),
                });
              }
            });
          }
        });
      }).catch(() => { /* flow record best-effort */ });
    } catch { /* dynamic import guard */ }

    // Emit real-time attack notification to the target player's session
    const io = globalThis._concordREALTIME?.io;
    io?.to(`world:${worldId}`).emit('world:npc-attack', {
      worldId,
      npcId:      npc.id,
      targetId:   target.userId,
      damage:     damageResult.finalDamage,
      archetype,
      kill:       damageResult.kill,
    });
  } catch { /* non-fatal */ }
}

// ── Heightmap generation (mirrors TerrainRenderer.tsx deterministic algo) ──
// Resolution kept low (128) for server — A* is the bottleneck, not sample count.
const HM_RES = 128;

function _generateHeightmap(res) {
  const data = new Float32Array(res * res);
  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      const nx = x / res; const nz = z / res;
      let elev = 0;
      if (nx < 0.1)      elev = 2 + nx * 30;
      else if (nx < 0.2) elev = 5 + Math.pow((nx - 0.1) / 0.1, 2) * 35;
      else if (nx < 0.6) elev = 40 + Math.sin(nx * Math.PI * 3) * 5;
      else               {
        elev = 45 + (nx - 0.6) * 80;
        elev += Math.sin(nx * 12 + nz * 8) * 6 + Math.sin(nx * 7 - nz * 5) * 4;
      }
      const creekCenterX = 0.35 + nz * 0.15;
      const distFromCreek = Math.abs(nx - creekCenterX);
      if (distFromCreek < 0.04) elev -= 12 * (1 - distFromCreek / 0.04);
      elev += Math.sin(nx * 47.3 + nz * 31.7) * 0.5 + Math.sin(nx * 97.1 + nz * 73.3) * 0.3;
      data[z * res + x] = Math.max(0, Math.min(80, elev)) / 80;
    }
  }
  return data;
}

// Shared NavGrid — built once, reused across all NPC agents
let _navGrid = null;
function getNavGrid() {
  if (!_navGrid) {
    const hm = _generateHeightmap(HM_RES);
    _navGrid  = new NavGrid(hm, HM_RES, HM_RES, 2000 / HM_RES); // cellSize ≈ 15.6m
    _navGrid.buildGrid();
  }
  return _navGrid;
}

const NPC_WALK_SPEED   = 1.4;  // m/s
const WAYPOINT_REACH_M = 2.0;  // metres — consider waypoint reached

// Map of worldId → NPCSimulator instance
export const simulators = new Map();

// ──────────────────────────────────────────────────────────────────────────────
// NPCAgent
// ──────────────────────────────────────────────────────────────────────────────

export class NPCAgent {
  constructor(row, worldId, db, selectBrain) {
    this.id          = row.id;
    this.worldId     = worldId;
    this.npcType     = row.npc_type;
    this.archetype   = row.archetype || 'generic';
    this.faction     = row.faction || 'neutral';
    this.level       = row.level || 1;
    this.isConscious = !!row.is_conscious;
    this.isImmortal  = !!row.is_immortal;
    this.location    = _parseJSON(row.current_location, { x: 0, y: 0, z: 0 });
    this.spawnLoc    = _parseJSON(row.spawn_location,   { x: 0, y: 0, z: 0 });
    this.state       = _parseJSON(row.state, {});
    this.needs       = this.state.needs || _defaultNeeds();
    this.goals       = this.state.goals || [];
    this.currentActivity = this.state.currentActivity || null;
    this._db         = db;
    this._selectBrain = selectBrain;
    // Queued wealth income, applied + reset to 0 by
    // NPCSimulator#_flushPendingPersists — see that method and the
    // tick()-site comment near wealthIncomeFor for why this is queued
    // rather than written immediately.
    this._pendingWealthIncome = 0;
  }

  /** Tick for conscious emergents — lighter, just updates goals from emergent AI */
  async tickConscious() {
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:emergent-npc:tick",
      });
      const raw = await handle.generate(
        TASK_PROMPTS.npcDirective({ name: this.state.name, archetype: this.archetype, worldId: this.worldId, goals: this.goals })
      );
      if (raw) {
        this.goals = [{ directive: raw.slice(0, 200), updatedAt: Date.now() }];
        this._persistState();
      }
    } catch { /* non-fatal */ }
  }

  /** Faction leader coordinates tactics with other members */
  async _coordinateFaction(members) {
    if (members.length < 2) return;
    const memberSummary = members.map(m => `${m.archetype}(lvl${m.level})`).join(', ');
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:faction:coordinate",
      });
      const raw = await handle.generate(
        TASK_PROMPTS.npcSimulatorFactionTactic({
          archetype: this.archetype,
          faction: this.faction,
          worldId: this.worldId,
          memberSummary,
        })
      );
      const match = raw?.match(/\{[\s\S]*?\}/);
      if (match) {
        const tactic = JSON.parse(match[0]);
        // Distribute tactic to all faction members
        for (const member of members) {
          member.state.factionTactic = tactic;
        }
      }
    } catch { /* non-fatal */ }
  }

  /** NPC speaks to another NPC or conscious emergent */
  async _speakTo(partner) {
    const myName      = this.state.name || this.archetype;
    const partnerName = partner.state?.name || partner.archetype || 'stranger';
    const topic       = this.state.factionTactic?.tactic || this.goals[0]?.directive || 'the world around us';

    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious", callerId: "world:npc:conversation",
      });
      const raw = await handle.generate(
        TASK_PROMPTS.npcSimulatorPartnerDialogue({
          myName,
          archetype: this.archetype,
          faction: this.faction,
          partnerName,
          partnerArch: partner.archetype,
          topic,
          worldId: this.worldId,
        })
      );

      if (!raw) return;

      // Partner hears and may update their goals based on what was said
      if (partner.goals !== undefined) {
        partner.goals = partner.goals || [];
        partner.goals.push({ heardFrom: myName, said: raw.slice(0, 200), at: Date.now() });
        if (partner.goals.length > 10) partner.goals = partner.goals.slice(-10);
        partner._persistState?.();
      }

      // Log the conversation as a world event (mig-315 world_events schema:
      // event_type/kind/title/description — the actor + payload ride in description).
      this._db.prepare(
        "INSERT OR IGNORE INTO world_events (id, world_id, event_type, kind, title, description, created_at) VALUES (?,?,?,?,?,?,unixepoch())"
      ).run(
        crypto.randomUUID(), this.worldId, 'npc_conversation', 'conversation',
        `${myName} → ${partnerName}`,
        JSON.stringify({ actorId: this.id, speaker: myName, listener: partnerName, line: raw.slice(0, 200) })
      );
    } catch { /* non-fatal */ }
  }

  // cachedPlayers: optional, pre-fetched _getPlayerPositions(db, worldId)
  // result for this whole world-tick — see NPCSimulator#tick's doc comment.
  // Left undefined, updateNPCCombatAI falls back to fetching it itself
  // (matches every pre-existing direct caller, e.g. tests/npc-combat-los.test.js).
  async tick(dtMs = 3000, cachedPlayers = undefined) {
    this._updateNeeds();
    // Advance along active path first (position update each tick)
    this._tickPath(dtMs / 1000);

    // ── Combat AI (runs before action selection so combat can override movement) ──
    if (!this.isConscious && !this.isImmortal) {
      try { updateNPCCombatAI(this, this.worldId, this._db, cachedPlayers); } catch { /* non-fatal */ }
    }

    // Only choose a new action if not currently walking AND not in active combat
    const combatState = _npcCombatState.get(this.id);
    const inCombat    = combatState && combatState.state !== 'idle';
    if (!inCombat && (!this.state.currentPath || this.state.pathIndex >= (this.state.currentPath?.length ?? 0))) {
      const action = await this._chooseAction();
      await this._executeAction(action);
    }
    await this._maybeEvaluateCreations();

    // Wealth accumulation — earn income based on occupation each tick
    // Queued, not written immediately — folded into the SAME batched
    // transaction _flushPendingPersists applies for _persistState below.
    // Real production follow-up, 2026-08-23: a live CPU profile taken
    // AFTER the _persistState batching fix landed showed this exact call
    // (previously accumulateWealth(db, id, archetype), an immediate
    // single-column UPDATE) as the next-hottest unbatched write in the
    // same per-agent tick — same bug shape, just a different write this
    // fix's original scope didn't cover.
    try { this._pendingWealthIncome += wealthIncomeFor(this.archetype); } catch { /* non-fatal */ }

    // Gear upgrade evaluation — every ~20 ticks (random to stagger NPC upgrades)
    if (Math.random() < 0.05) {
      try { evaluateGearUpgrade(this._db, this.id); } catch { /* non-fatal */ }
    }

    this._persistState();
  }

  _tickPath(dtSec) {
    const path  = this.state.currentPath;
    if (!path || !path.length) return;
    let   idx   = this.state.pathIndex ?? 0;
    if (idx >= path.length) { this.state.currentPath = null; return; }

    // Walk toward current waypoint at NPC_WALK_SPEED
    let remaining = NPC_WALK_SPEED * dtSec; // metres this tick
    while (remaining > 0 && idx < path.length) {
      const wp  = path[idx];
      const dx  = wp.x - this.location.x;
      const dz  = wp.z - this.location.z;
      const d   = Math.sqrt(dx * dx + dz * dz);
      if (d <= WAYPOINT_REACH_M || d < remaining) {
        this.location.x = wp.x;
        this.location.z = wp.z;
        remaining      -= d;
        idx++;
      } else {
        this.location.x += (dx / d) * remaining;
        this.location.z += (dz / d) * remaining;
        remaining = 0;
      }
    }
    this.state.pathIndex = idx;
    if (idx >= path.length) this.state.currentPath = null;
  }

  _updateNeeds() {
    const decay = { hunger: 0.05, rest: 0.03, social: 0.02, purpose: 0.01, safety: 0.01 };
    for (const [k, d] of Object.entries(decay)) {
      this.needs[k] = Math.max(0, (this.needs[k] ?? 1) - d);
    }
  }

  async _chooseAction() {
    // Most urgent need drives action
    const urgentNeed = Object.entries(this.needs)
      .filter(([, v]) => v < 0.3)
      .sort(([, a], [, b]) => a - b)[0];

    if (urgentNeed) {
      return _needToAction(urgentNeed[0]);
    }

    // Otherwise use subconscious brain for richer decision
    try {
      const { handle } = await this._selectBrain("subconscious", {
        brainOverride: "subconscious",
        callerId: "world:npc:decision",
      });

      const prompt = `NPC type: ${this.npcType}
World: ${this.worldId}
Needs: ${JSON.stringify(this.needs)}
Goals: ${JSON.stringify(this.goals)}
Location: ${JSON.stringify(this.location)}

Choose one action for this NPC. Return JSON only:
{ "action": "<gather_resource|build_structure|practice_skill|socialize|travel|trade|rest|create>", "target": "<optional string>" }`;

      const raw   = await handle.generate(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_e) {
      // fallback
    }

    return { action: "rest" };
  }

  async _executeAction({ action, target }) {
    this.currentActivity = action;

    // Map action → DB activity string for loot generator
    const activityMap = {
      gather_resource: 'gathering', build_structure: 'crafting', practice_skill: 'crafting',
      trade: 'trading', rest: 'resting', socialize: 'resting', travel: 'patrolling',
      create: 'crafting', default: 'idle',
    };
    const dbActivity = activityMap[action] || 'idle';
    try {
      this._db.prepare('UPDATE world_npcs SET current_activity = ? WHERE id = ?').run(dbActivity, this.id);
    } catch { /* column may not exist yet pre-migration */ }

    switch (action) {
      case "rest":
        this.needs.rest = Math.min(1, this.needs.rest + 0.3);
        break;
      case "gather_resource": {
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.15);
        // Attempt to gather from a real nearby resource node first
        try {
          const npcRow  = this._db.prepare('SELECT activity_resources, level FROM world_npcs WHERE id = ?').get(this.id);
          const posRow  = _parseJSON(this.location, {});
          const npcX    = posRow.x ?? 1000, npcZ = posRow.z ?? 1000;
          const npcLvl  = npcRow?.level || 1;
          const preferred = [_archetypeResource(this.archetype)];

          const gathered = npcGatherFromNode(this._db, this.worldId, npcX, npcZ, npcLvl, preferred);
          const resourceId = gathered?.resourceId ?? _archetypeResource(this.archetype);
          const amount     = gathered?.amount ?? (1 + Math.floor(Math.random() * 2));

          const resources = _parseJSON(npcRow?.activity_resources, {});
          resources[resourceId] = Math.min(50, (resources[resourceId] || 0) + amount);
          this._db.prepare('UPDATE world_npcs SET activity_resources = ? WHERE id = ?')
            .run(JSON.stringify(resources), this.id);

          // Only a real node hit (not the always-succeeds abstract fallback
          // above) is worth broadcasting — the frontend swing/particle
          // reads against a real node position.
          if (gathered) _emitGather(this, this.worldId, gathered);
        } catch { /* non-fatal */ }
        break;
      }
      case "socialize":
        this.needs.social = Math.min(1, this.needs.social + 0.25);
        break;
      case "build_structure":
        await buildStructure(this, target || "shelter", this.location, this._db);
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.2);
        break;
      case "practice_skill": {
        const skills = this._db.prepare(
          "SELECT id FROM dtus WHERE creator_id = ? AND type = 'skill' LIMIT 1"
        ).get(this.id);
        if (skills) await practiceSkill(this, skills.id, this._db);
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.1);
        break;
      }
      case "travel": {
        // NavGrid A* pathfinding — pick a destination 30-80m away, walk there
        const angle   = Math.random() * Math.PI * 2;
        const dist    = 30 + Math.random() * 50;
        const goalX   = this.location.x + Math.cos(angle) * dist;
        const goalZ   = this.location.z + Math.sin(angle) * dist;
        const navGrid = getNavGrid();
        const path    = navGrid.findPath(this.location.x, this.location.z, goalX, goalZ);
        if (path.length > 0) {
          this.state.currentPath  = path;
          this.state.pathIndex    = 0;
          this.state.pathGoal     = { x: goalX, z: goalZ };
        }
        break;
      }
      case "trade":
        this.needs.social   = Math.min(1, this.needs.social   + 0.1);
        this.needs.purpose  = Math.min(1, this.needs.purpose  + 0.1);
        break;
      case "create":
        this.needs.purpose = Math.min(1, this.needs.purpose + 0.2);
        break;
      default:
        break;
    }
  }

  async _maybeEvaluateCreations() {
    if (Math.random() > 0.1) return; // 10% chance per tick
    const nearby = this._db.prepare(`
      SELECT * FROM dtus
      WHERE type = 'concordia_creation' AND world_id = ?
      LIMIT 5
    `).all(this.worldId);

    for (const creation of nearby) {
      await npcEvaluateNearbyCreation(this, creation, this._db, this._selectBrain);
    }
  }

  async _maybeGenerateQuests() {
    if (Math.random() > 0.05) return; // 5% chance per tick
    // Sprint 32 - per-tick global cap. Symptom: heartbeat_block_slow
    // module=forgetting ms=33241 and event_loop_lag_spike maxMs=17515
    // trace back to detectQuestOpportunities -> createQuestFromNeed ->
    // selectBrain("subconscious") firing hundreds of LLM calls per
    // heartbeat tick when many NPCSimulator worlds each call this in
    // parallel via Promise.allSettled. Each call is a 5-30s Ollama
    // inference; 200 NPCs at 5% rate = 10 LLM calls = 50-300s of
    // sequential brain work on the main loop. Cap so the tick can
    // drain within CONCORD_NPC_QUEST_BUDGET_MS (default 2000ms - fits
    // inside a 15s heartbeat with margin). Quests skipped this tick
    // spill to the next - no data loss, just slower cadence.
    if (NPC_QUEST_TICK_CALLS >= NPC_QUEST_TICK_LIMIT) return;
    NPC_QUEST_TICK_CALLS++;
    try {
      const { detectQuestOpportunities } = await import("./quest-emergence.js");
      await detectQuestOpportunities(this, this._db, this._selectBrain);
    } catch (_e) { /* non-fatal */ }
  }

  // Computes this agent's row write and QUEUES it rather than writing
  // immediately. NPCSimulator.tick() flushes every agent's queued write in
  // ONE transaction at the very end of the world-tick (_flushPendingPersists
  // below) — see that method's doc comment for the measured reason this
  // exists. This method's external contract is unchanged: same fields
  // computed from the same state, at the same point in tick()/tickConscious()/
  // a post-conversation call; only the DB write itself moved from "happens
  // synchronously right here" to "happens once, batched, after the whole
  // world-tick's other work is done." Safe because nothing in this file (or
  // npc-gear.js/npc-jobs.js/npc-relations.js, audited 2026-08-23) reads
  // world_npcs.state/current_location for a DIFFERENT agent mid-tick — every
  // cross-agent read in the hot path touches other columns (wealth_sparks,
  // gear_level, archetype, criminal_rep, activity_resources, current_task).
  _persistState() {
    this.state.needs           = this.needs;
    this.state.goals           = this.goals;
    this.state.currentActivity = this.currentActivity;

    this._pendingPersist = {
      stateJson: JSON.stringify(this.state),
      locationJson: JSON.stringify(this.location),
    };
  }
}

// Sprint 32 - per-tick budget counter for _maybeGenerateQuests. Reset each
// governor tick (see server.js governorTick) so the cap resets per heartbeat
// cycle, not per NPCSimulator instance.
export let NPC_QUEST_TICK_CALLS = 0;
export const NPC_QUEST_TICK_LIMIT = Number(process.env.CONCORD_NPC_QUEST_BUDGET_LIMIT) || 3;
export function resetNpcQuestTickCounter() { NPC_QUEST_TICK_CALLS = 0; }

// ──────────────────────────────────────────────────────────────────────────────
// NPCSimulator
// ──────────────────────────────────────────────────────────────────────────────

export class NPCSimulator {
  constructor(worldId, db, selectBrain) {
    this.worldId      = worldId;
    this._db          = db;
    this._selectBrain = selectBrain;
    this._agents      = [];
    this._timer       = null;
    this._tickRate    = 60000; // will be updated on first player count
  }

  async initialize() {
    const rows = this._db.prepare(
      "SELECT * FROM world_npcs WHERE world_id = ? AND is_dead = 0"
    ).all(this.worldId);

    this._agents = rows.map(r => new NPCAgent(r, this.worldId, this._db, this._selectBrain));

    // Seed NPCs from world archetypes if empty
    if (this._agents.length === 0) {
      await this._seedWorldNPCs();
    }
  }

  async _seedWorldNPCs() {
    const world = this._db.prepare("SELECT * FROM worlds WHERE id = ?").get(this.worldId);
    const universeType = world?.universe_type || 'generic';
    const config = getSpawnConfig(universeType);

    // Spawn bosses (conscious, immortal — backed by emergent AI)
    for (const boss of config.bosses) {
      this._spawnNpc({ ...boss, npc_type: boss.archetype, universe_type: universeType });
    }
    // Spawn civilians
    for (const civ of config.civilians) {
      for (let i = 0; i < (civ.count || 2); i++) {
        this._spawnNpc({ ...civ, npc_type: civ.archetype, universe_type: universeType });
      }
    }
    // Spawn enemies
    for (const enemy of config.enemies) {
      const count = enemy.count || 3;
      for (let i = 0; i < count; i++) {
        this._spawnNpc({ ...enemy, npc_type: enemy.archetype, universe_type: universeType });
      }
    }
  }

  _spawnNpc(opts = {}) {
    const id = crypto.randomUUID();
    const spawnX = (Math.random() - 0.5) * 400;
    const spawnZ = (Math.random() - 0.5) * 400;
    const spawnLoc = JSON.stringify({ x: spawnX, y: 0, z: spawnZ });

    this._db.prepare(`
      INSERT INTO world_npcs
        (id, world_id, npc_type, archetype, body_type, universe_type, faction,
         is_conscious, is_immortal, quest_giver, level, spawn_location, current_location, state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, this.worldId,
      opts.npc_type || 'generic',
      opts.archetype || 'generic',
      opts.body_type || 'humanoid',
      opts.universe_type || '',
      opts.faction || 'neutral',
      opts.is_conscious ? 1 : 0,
      opts.is_immortal ? 1 : 0,
      opts.quest_giver ? 1 : 0,
      opts.level || (opts.level_range ? opts.level_range[0] : 1),
      spawnLoc,
      spawnLoc,
      JSON.stringify({ name: opts.archetype }),
    );


    const row = this._db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
    if (row) {
      // Seed starter gear for this NPC
      try { seedStarterGear(this._db, id, opts.archetype || 'generic', opts.level || 1); } catch { /* non-fatal */ }
      this._agents.push(new NPCAgent(row, this.worldId, this._db, this._selectBrain));
    }
  }

  /** Spawn a new enemy at a target level — called when player enters an area */
  spawnEnemy(targetLevel = 1) {
    const world = this._db.prepare("SELECT universe_type FROM worlds WHERE id = ?").get(this.worldId);
    const archetype = pickEnemyArchetype(world?.universe_type || 'generic', targetLevel);
    this._spawnNpc({ ...archetype, npc_type: archetype.archetype, level: targetLevel });
  }

  async tick() {
    // Separate conscious (emergent-backed) from autonomous agents
    const autonomousAgents = this._agents.filter(a => !a.isConscious);
    const consciousAgents  = this._agents.filter(a =>  a.isConscious);

    // Fetch player positions ONCE for the whole world-tick, not once per
    // NPC. Real production finding, 2026-08-23 (see
    // #_flushPendingPersists's doc comment for the sibling write-side
    // fix's full rationale): a live CPU profile showed updateNPCCombatAI's
    // _getPlayerPositions call — a world_visits/player_world_state JOIN —
    // as a real, meaningful cost, and it's called unconditionally by EVERY
    // non-conscious, non-immortal agent's tick() every cycle, always
    // returning the identical result within one synchronous world-tick
    // (players don't move between one agent's combat check and the next).
    // Threaded through as an argument rather than cached on `this` so a
    // stale value can never survive past the tick that fetched it.
    const cachedPlayers = _getPlayerPositions(this._db, this.worldId);

    // Autonomous NPCs: needs-based tick + faction coordination
    await Promise.allSettled(autonomousAgents.map(a => a.tick(3000, cachedPlayers)));
    await Promise.allSettled(autonomousAgents.map(a => a._maybeGenerateQuests()));

    // Faction coordination: enemy NPCs strategize together + leader gear enforcement
    await this._tickFactionCoordination(autonomousAgents);

    // Conscious emergents: emergent-AI tick (lighter — just goal updates)
    await Promise.allSettled(consciousAgents.map(a => a.tickConscious()));

    // NPC ↔ NPC / NPC ↔ Emergent conversations (5% chance per tick group)
    if (Math.random() < 0.05) {
      await this._tickNPCConversations(autonomousAgents, consciousAgents);
    }

    // Grief decay — slow healing over time
    try { decayGrief(this._db, this.id); } catch { /* non-fatal */ }

    // Every ~50 ticks: update user gear ceiling + enforce caps
    if (Math.random() < 0.02) {
      try {
        updateUserGearCeiling(this._db);
        enforceGearCeiling(this._db);
      } catch { /* non-fatal */ }
    }

    // Rare: civilian recruitment tick across world
    if (Math.random() < 0.005) {
      try { tickRecruitment(this._db, this.worldId); } catch { /* non-fatal */ }
    }

    // Rare: crossbreeding check for spouse pairs
    if (Math.random() < 0.01) {
      try { this._tickCrossbreeding(); } catch { /* non-fatal */ }
    }

    // Periodic: respawn depleted resource nodes (runs every ~1% of ticks ≈ once per minute at 1Hz)
    if (Math.random() < 0.01) {
      try { respawnExpiredNodes(this._db); } catch { /* non-fatal */ }
    }

    // Periodic: NPC job schedule execution (time-of-day tasks)
    if (Math.random() < 0.1) {
      try {
        const phase = getCurrentPhase(this._tickCount || 0);
        for (const agent of autonomousAgents.slice(0, 10)) {
          const jobType = agent.state?.job_type || 'generic';
          await executeScheduledTask(agent, jobType, phase, this._db, this.worldId)
            .catch(() => {});
        }
        this._tickCount = (this._tickCount || 0) + 1;
      } catch { /* non-fatal */ }
    }

    // Periodic: detective/guard crime tick (2% of ticks)
    if (Math.random() < 0.02) {
      try {
        for (const agent of autonomousAgents) {
          const archetype = agent.archetype || '';
          const jobType = agent.state?.job_type || '';
          if (archetype === 'guard' || archetype === 'detective' || jobType === 'detective') {
            detectiveTick(this._db, agent.id, this.worldId);
          } else if (archetype === 'guard' || jobType === 'guard') {
            guardTick(this._db, agent.id, this.worldId, agent.location);
          }
        }
      } catch { /* non-fatal */ }
    }

    // Very rare: directive voting tick (0.5% of ticks)
    if (Math.random() < 0.005) {
      try {
        const { tickDirectiveVoting } = await import('./world-governance.js');
        tickDirectiveVoting(this._db, this.worldId);
      } catch { /* non-fatal */ }
    }

    // Very rare: seed jobs for NPCs without assignments (0.2% of ticks)
    if (Math.random() < 0.002) {
      try { seedJobsForWorld(this._db, this.worldId); } catch { /* non-fatal */ }
    }

    // Very rare: seed NPC-to-NPC archetype opinions (0.1% of ticks)
    if (Math.random() < 0.001) {
      try {
        const { seedNPCOpinions } = await import('./npc-relations.js');
        seedNPCOpinions(this._db, this.worldId);
      } catch { /* non-fatal */ }
    }

    // Placed last, deliberately: this must run after EVERY call site that
    // can queue a write via NPCAgent#_persistState() (the main per-agent
    // tick() above, tickConscious(), and the conversation partner inside
    // _tickNPCConversations() above) — see that method's own comment.
    this._flushPendingPersists();
  }

  // Batches every agent's state/current_location/wealth_sparks write queued
  // this tick into ONE transaction instead of each NPCAgent#_persistState()
  // (and, as of this update, wealth-income) call committing its own
  // separate write. Real production finding, 2026-08-23: a live CPU profile
  // taken while investigating auth-request event-loop lag showed this
  // simulator's per-tick work as ~38% of all CPU time in a 2-minute sample,
  // with this write among the single largest contributors — each
  // individual better-sqlite3 call carries real per-statement overhead
  // (WAL frame write + lock acquisition) even under the fast
  // journal_mode=WAL + synchronous=NORMAL config this DB already runs, and
  // that overhead is what N separate commits pay N times instead of once.
  // A FOLLOW-UP profile after the original fix landed showed
  // npc-gear.js#wealthIncomeFor's caller (formerly accumulateWealth,
  // called unconditionally from the same tick() as _persistState — see
  // that call site) as the next-hottest unbatched write in this exact
  // loop, so it's folded into this same statement/transaction rather than
  // left as a second N-separate-commits cost. better-sqlite3's
  // db.transaction() is sync-only (can't wrap the agents' own async tick()
  // calls), so this flushes AFTER all of them resolve instead — an
  // architecturally different but behavior-preserving fix; see
  // NPCAgent#_persistState for the correctness argument (no code reads
  // another agent's state/current_location mid-tick). wealth_sparks IS
  // read cross-agent elsewhere (npc-gear.js#leaderEnsuresFactionGear, the
  // faction-leader wealth-transfer logic, called from
  // _tickFactionCoordination) — and that DOES change timing here, worth
  // being honest about rather than asserting no change: _tickFactionCoordination
  // runs BEFORE this flush (see tick()'s call order), so previously (wealth
  // written immediately inside each agent's own tick()) it saw THIS tick's
  // freshly-accumulated wealth; now it sees the PRIOR tick's committed
  // value, one tick stale. Accepted: ticks are 60s+ apart, per-tick income
  // is 1-4 sparks, and the transfer logic already operates on a coarse,
  // periodic cadence — a one-tick-stale read changes a wealth-transfer
  // decision by at most one tick's income, not a correctness break.
  _flushPendingPersists() {
    const pending = this._agents.filter((a) => a._pendingPersist);
    if (pending.length === 0) return;
    try {
      const stmt = this._db.prepare(
        "UPDATE world_npcs SET state = ?, current_location = ?, wealth_sparks = wealth_sparks + ?, last_tick_at = unixepoch() WHERE id = ?"
      );
      const flush = this._db.transaction((agents) => {
        for (const a of agents) {
          stmt.run(a._pendingPersist.stateJson, a._pendingPersist.locationJson, a._pendingWealthIncome || 0, a.id);
          a._pendingPersist = null;
          a._pendingWealthIncome = 0;
        }
      });
      flush(pending);
    } catch (_e) { /* non-fatal — matches this file's existing try/catch convention */ }
  }

  _tickCrossbreeding() {
    const spousePairs = this._db.prepare(`
      SELECT r.npc_id, r.related_id FROM npc_relationships r
      WHERE r.rel_type = 'spouse'
        AND r.npc_id IN (SELECT id FROM world_npcs WHERE world_id = ? AND is_dead = 0)
      LIMIT 10
    `).all(this.worldId);
    for (const pair of spousePairs) {
      const offspring = attemptCrossbreed(this._db, pair.npc_id, pair.related_id, this.worldId);
      if (offspring) {
        const row = this._db.prepare('SELECT * FROM world_npcs WHERE id = ?').get(offspring.id);
        if (row) this._agents.push(new NPCAgent(row, this.worldId, this._db, this._selectBrain));
        logger.info('npc-simulator', 'crossbreed_born', { id: offspring.id, species: offspring.species });
      }
    }
  }

  /** Faction coordination: pick a leader, generate shared tactics */
  async _tickFactionCoordination(agents) {
    const byFaction = new Map();
    for (const agent of agents) {
      const faction = agent.faction || 'neutral';
      if (faction === 'neutral') continue;
      if (!byFaction.has(faction)) byFaction.set(faction, []);
      byFaction.get(faction).push(agent);
    }

    for (const [faction, members] of byFaction) {
      if (members.length < 2) continue;
      // Leader = highest level in faction
      const leader = members.sort((a, b) => (b.level || 1) - (a.level || 1))[0];
      try {
        await leader._coordinateFaction(members);
        // Leader ensures undergeared members receive wealth transfers
        const memberIds = members.filter(m => m.id !== leader.id).map(m => m.id);
        leaderEnsuresFactionGear(this._db, leader.id, memberIds);
      } catch { /* non-fatal */ }
    }
  }

  /** NPC ↔ NPC and NPC ↔ Emergent conversations */
  async _tickNPCConversations(autonomousAgents, consciousAgents) {
    if (!autonomousAgents.length) return;

    const speaker = autonomousAgents[Math.floor(Math.random() * autonomousAgents.length)];
    // Pick a conversation partner: another NPC or a conscious emergent
    const partners = [...autonomousAgents.filter(a => a.id !== speaker.id), ...consciousAgents];
    if (!partners.length) return;

    const partner = partners[Math.floor(Math.random() * partners.length)];
    await speaker._speakTo(partner).catch(() => {});

    // Update mutual opinion from conversation (slight warmth from interaction)
    try {
      const { recordNPCToNPCInteraction } = await import('./npc-relations.js');
      recordNPCToNPCInteraction(this._db, speaker.id, partner.id, 0.01, 'conversation');
    } catch { /* non-fatal */ }
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.tick().catch(err => logger?.debug?.('[npc-simulator] background op failed', { err: err?.message }));
    }, this._tickRate);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  updatePopulation(playerCount) {
    const { tickRate } = adjustSimulationDensity({ id: this.worldId }, playerCount);
    if (tickRate !== this._tickRate) {
      this._tickRate = tickRate;
      if (this._timer) {
        this.stop();
        this.start();
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function _defaultNeeds() {
  return { hunger: 1, rest: 1, social: 1, purpose: 1, safety: 1 };
}

function _needToAction(need) {
  const map = { hunger: "gather_resource", rest: "rest", social: "socialize", purpose: "create", safety: "travel" };
  return { action: map[need] || "rest" };
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function _archetypeResource(archetype) {
  const map = {
    blacksmith: 'iron-ore', engineer: 'circuit-board', farmer: 'herb-bundle',
    hunter: 'leather-strip', scientist: 'data-chip', medic: 'herb-bundle',
    trader: 'gold-coin', guard: 'stone-block', default: 'wood-planks',
  };
  return map[archetype] || map.default;
}
