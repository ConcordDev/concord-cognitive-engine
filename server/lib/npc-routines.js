// server/lib/npc-routines.js
//
// Phase 4a — NPC Daily Lives.
//
// Each NPC has a deterministic 24h schedule: 8 three-hour blocks, each
// with an activity_kind + location_kind + target (x, z). The
// npc-routine-cycle heartbeat advances the routine, nudging the NPC's
// position toward the target and writing embodied signals (Layer 7) per
// activity. Phase 2 preoccupations bias the schedule (war preoccupation
// shortens sleep, adds training; personal_loss adds temple visits).
//
// All schedule generation is deterministic from
// sha1(npc_id + day_seed + preoccupation_signature) so reruns produce
// the same schedule and content authors can predict NPC behavior.

import crypto from "node:crypto";
import logger from "../logger.js";
// WS4 — the motivated-movement layer (needs → utility goal among real POIs).
import { getNeeds, setNeeds, decayNeeds, satisfyFromAdvertisement } from "./npc-needs.js";
import { nearbyPOIs } from "./npc-pois.js";
import { chooseNextGoal } from "./npc-utility.js";

const NEED_ADVANCE_HOURS = Number(process.env.CONCORD_NEED_ADVANCE_HOURS) || 0.06; // need pressure per advance
const POI_ARRIVE_SATISFY_M = 6; // satisfy a POI's needs when within this of it

// ── Config ──────────────────────────────────────────────────────────────────

const BLOCKS_PER_DAY = 8;                  // 3-hour blocks: 0=00:00, 1=03:00, …, 7=21:00
const BLOCK_HOURS = 24 / BLOCKS_PER_DAY;
const NUDGE_M_PER_TICK = 6;                // distance NPC moves toward target per advance
const ARRIVAL_RADIUS_M = 4;
const SIGNAL_EMIT_INTERVAL_S = 120;        // throttle env signal writes per NPC
// Living Society WS0 — idle ambient motion. An NPC that has ARRIVED at its
// activity station must not freeze as a statue (a priest communing at the
// temple stood perfectly still — the first playtester's bug). When arrived it
// instead PACES toward a gentle, deterministic point within this radius of the
// station. < ARRIVAL_RADIUS_M so the NPC stays "arrived" (signals keep firing).
const IDLE_WANDER_RADIUS_M = Number(process.env.CONCORD_IDLE_WANDER_RADIUS_M) || 2.5;
const IDLE_NUDGE_M_PER_TICK = Number(process.env.CONCORD_IDLE_NUDGE_M) || 1.2; // slow amble at station
const IDLE_WANDER_PERIOD_S = Number(process.env.CONCORD_IDLE_WANDER_PERIOD_S) || 18; // re-pick a pace point ~every 18s

// Activity → embodied signal table (channel, delta, ttlSeconds).
// Reuses Layer 7 channels; values are deltas added on top of baseline.
const ACTIVITY_SIGNALS = {
  craft: [
    { channel: "tactile_force_os.structural_stress", value: 0.05, ttlSeconds: 300 },
    { channel: "sonic_os.ambient_db",               value: 8,    ttlSeconds: 240 },
    { channel: "thermal_os.ambient_temp",           value: 0.3,  ttlSeconds: 600 },
  ],
  gather: [
    { channel: "sonic_os.ambient_db",       value: 3,     ttlSeconds: 180 },
    { channel: "chemical_os.air_quality",   value: -0.05, ttlSeconds: 300 },
  ],
  train: [
    { channel: "sonic_os.ambient_db",   value: 12,  ttlSeconds: 240 },
    { channel: "chemical_os.humidity",  value: 1.0, ttlSeconds: 360 },
    { channel: "thermal_os.ambient_temp", value: 0.5, ttlSeconds: 600 },
  ],
  trade: [
    { channel: "sonic_os.ambient_db", value: 6, ttlSeconds: 240 },
  ],
  socialize: [
    { channel: "sonic_os.ambient_db", value: 5, ttlSeconds: 240 },
  ],
  commune: [
    // resonance is a custom channel; the env-sensor doesn't write a
    // baseline, so signalsForWorld will fold it as-is when present.
    { channel: "resonance.commune_signal", value: 1.0, ttlSeconds: 600 },
  ],
  patrol: [
    { channel: "sonic_os.ambient_db", value: 2, ttlSeconds: 180 },
  ],
  // Living Society Phase 1 — civilian labor activities. These are the
  // production verbs the Phase-2 labor loop reads to write visible world-state.
  farm: [
    { channel: "chemical_os.humidity",   value: 0.5, ttlSeconds: 360 },
    { channel: "sonic_os.ambient_db",    value: 2,   ttlSeconds: 180 },
  ],
  build: [
    { channel: "tactile_force_os.structural_stress", value: 0.08, ttlSeconds: 360 },
    { channel: "sonic_os.ambient_db",                value: 14,   ttlSeconds: 240 },
  ],
  log: [
    { channel: "sonic_os.ambient_db",     value: 10,   ttlSeconds: 240 },
    { channel: "chemical_os.air_quality", value: -0.03, ttlSeconds: 300 },
  ],
  mine: [
    { channel: "sonic_os.ambient_db",                value: 11,   ttlSeconds: 240 },
    { channel: "tactile_force_os.structural_stress", value: 0.06, ttlSeconds: 300 },
    { channel: "chemical_os.air_quality",            value: -0.08, ttlSeconds: 360 },
  ],
  mill: [
    { channel: "sonic_os.ambient_db", value: 9, ttlSeconds: 240 },
  ],
  fish: [
    { channel: "chemical_os.humidity", value: 0.8, ttlSeconds: 300 },
    { channel: "sonic_os.ambient_db",  value: 1,   ttlSeconds: 180 },
  ],
  cook: [
    { channel: "thermal_os.ambient_temp", value: 0.8,  ttlSeconds: 600 },
    { channel: "chemical_os.air_quality", value: -0.04, ttlSeconds: 300 },
    { channel: "sonic_os.ambient_db",     value: 5,    ttlSeconds: 240 },
  ],
  wander: [],
  rest:   [],
  sleep:  [],
};

// Archetype → base routine (block_idx → { activity, location_kind }).
// Block indexing: 0=midnight, 1=03h, 2=06h, 3=09h, 4=noon, 5=15h, 6=18h, 7=21h
const ARCHETYPE_ROUTINES = {
  warrior: [
    { activity: "sleep",     location_kind: "home" },      // 00-03
    { activity: "sleep",     location_kind: "home" },      // 03-06
    { activity: "train",     location_kind: "plaza" },     // 06-09
    { activity: "patrol",    location_kind: "wilds" },     // 09-12
    { activity: "trade",     location_kind: "market" },    // 12-15
    { activity: "train",     location_kind: "plaza" },     // 15-18
    { activity: "socialize", location_kind: "tavern" },    // 18-21
    { activity: "rest",      location_kind: "home" },      // 21-24
  ],
  scholar: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "rest",      location_kind: "home" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "trade",     location_kind: "market" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "commune",   location_kind: "temple" },
    { activity: "rest",      location_kind: "home" },
  ],
  trader: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "trade",     location_kind: "market" },
    { activity: "trade",     location_kind: "market" },
    { activity: "trade",     location_kind: "market" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  mystic: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "commune",   location_kind: "temple" },
    { activity: "commune",   location_kind: "temple" },
    { activity: "wander",    location_kind: "grove" },
    { activity: "trade",     location_kind: "market" },
    { activity: "commune",   location_kind: "grove" },
    { activity: "commune",   location_kind: "temple" },
    { activity: "rest",      location_kind: "home" },
  ],
  guard: [
    { activity: "patrol",    location_kind: "plaza" },
    { activity: "rest",      location_kind: "home" },
    { activity: "patrol",    location_kind: "plaza" },
    { activity: "patrol",    location_kind: "plaza" },
    { activity: "trade",     location_kind: "market" },
    { activity: "patrol",    location_kind: "plaza" },
    { activity: "patrol",    location_kind: "plaza" },
    { activity: "socialize", location_kind: "tavern" },
  ],
  healer: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "gather",    location_kind: "grove" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "trade",     location_kind: "market" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "commune",   location_kind: "temple" },
    { activity: "rest",      location_kind: "home" },
  ],
  hunter: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "rest",      location_kind: "home" },
    { activity: "patrol",    location_kind: "wilds" },
    { activity: "patrol",    location_kind: "wilds" },
    { activity: "trade",     location_kind: "market" },
    { activity: "patrol",    location_kind: "wilds" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  // ── Living Society Phase 1 — civilian roster (the labor floor) ───────────
  farmer: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "farm",      location_kind: "farm" },
    { activity: "farm",      location_kind: "farm" },
    { activity: "trade",     location_kind: "market" },
    { activity: "farm",      location_kind: "farm" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  builder: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "build",     location_kind: "construction" },
    { activity: "build",     location_kind: "construction" },
    { activity: "trade",     location_kind: "market" },
    { activity: "build",     location_kind: "construction" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  miner: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "mine",      location_kind: "mine" },
    { activity: "mine",      location_kind: "mine" },
    { activity: "trade",     location_kind: "market" },
    { activity: "mine",      location_kind: "mine" },
    { activity: "rest",      location_kind: "home" },
    { activity: "socialize", location_kind: "tavern" },
  ],
  logger: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "log",       location_kind: "wilds" },
    { activity: "log",       location_kind: "wilds" },
    { activity: "trade",     location_kind: "market" },
    { activity: "log",       location_kind: "wilds" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  miller: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "mill",      location_kind: "mill" },
    { activity: "mill",      location_kind: "mill" },
    { activity: "trade",     location_kind: "market" },
    { activity: "mill",      location_kind: "mill" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  fisher: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "fish",      location_kind: "dock" },
    { activity: "fish",      location_kind: "dock" },
    { activity: "fish",      location_kind: "dock" },
    { activity: "trade",     location_kind: "market" },
    { activity: "rest",      location_kind: "home" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  cook: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "gather",    location_kind: "market" },
    { activity: "cook",      location_kind: "tavern" },
    { activity: "cook",      location_kind: "tavern" },
    { activity: "cook",      location_kind: "tavern" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  laborer: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "build",     location_kind: "construction" },
    { activity: "gather",    location_kind: "wilds" },
    { activity: "trade",     location_kind: "market" },
    { activity: "build",     location_kind: "construction" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
  default: [
    { activity: "sleep",     location_kind: "home" },
    { activity: "sleep",     location_kind: "home" },
    { activity: "rest",      location_kind: "home" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "trade",     location_kind: "market" },
    { activity: "craft",     location_kind: "workplace" },
    { activity: "socialize", location_kind: "tavern" },
    { activity: "rest",      location_kind: "home" },
  ],
};

// Preoccupation → block-level overrides. Applied on top of archetype base.
// kind:'faction_phase' with stance 'war' makes the whole faction visibly
// busier; 'rebuild' makes them rest more; 'expand' adds wanderer blocks.
function preoccupationOverrides(preoccupation) {
  if (!preoccupation) return [];
  const narr = String(preoccupation.narrative || "").toLowerCase();
  const kind = preoccupation.kind || "";

  const overrides = [];
  if (kind === "faction_phase") {
    if (narr.includes("war") || narr.includes("blade")) {
      // War: shorten sleep, add training in late-night, swap socialize for train.
      overrides.push({ block_idx: 1, activity: "train",  location_kind: "plaza" });
      overrides.push({ block_idx: 6, activity: "train",  location_kind: "plaza" });
    } else if (narr.includes("rebuild") || narr.includes("rationing")) {
      overrides.push({ block_idx: 4, activity: "rest",   location_kind: "home" });
      overrides.push({ block_idx: 5, activity: "rest",   location_kind: "home" });
    } else if (narr.includes("pushing") || narr.includes("expect new territory")) {
      // Expand: add wanderer to wilds.
      overrides.push({ block_idx: 3, activity: "wander", location_kind: "wilds" });
      overrides.push({ block_idx: 6, activity: "wander", location_kind: "wilds" });
    } else if (narr.includes("withdrawn") || narr.includes("silence")) {
      // Isolation: cut market visit; commune at temple.
      overrides.push({ block_idx: 4, activity: "commune", location_kind: "temple" });
    }
  }
  if (kind === "personal_loss") {
    // Add temple visit at dusk regardless of archetype.
    overrides.push({ block_idx: 6, activity: "commune", location_kind: "temple" });
  }
  return overrides;
}

// Pseudo-deterministic offset for the target x/z by sha1 of identity.
// We don't know real building positions on minimal builds, so we hash
// a stable point relative to the NPC's spawn location (or origin if
// none) and ±35m offset to disperse same-archetype NPCs.
function deterministicOffset(npc, dayBlockKey) {
  const seed = crypto.createHash("sha1").update(`${npc.id}|${dayBlockKey}|loc`).digest();
  const dx = ((seed[0] / 255) * 2 - 1) * 35;
  const dz = ((seed[1] / 255) * 2 - 1) * 35;
  return { dx, dz };
}

/**
 * Living Society WS0 — a gentle pacing point within IDLE_WANDER_RADIUS_M of an
 * NPC's station. Deterministic (seeded by npc id + a slow time-bucket) so it's
 * testable and changes only ~every IDLE_WANDER_PERIOD_S — a slow amble, not a
 * jitter. Returns the absolute world point to drift toward.
 */
export function idlePaceTarget(npcId, baseX, baseZ, now) {
  const bucket = Math.floor((Number(now) || 0) / IDLE_WANDER_PERIOD_S);
  const seed = crypto.createHash("sha1").update(`${npcId}|${bucket}|pace`).digest();
  const angle = (seed[0] / 255) * Math.PI * 2;
  const radius = (seed[1] / 255) * IDLE_WANDER_RADIUS_M;
  return { x: baseX + Math.cos(angle) * radius, z: baseZ + Math.sin(angle) * radius };
}

// ── Public: deterministic schedule generation ───────────────────────────────

/**
 * Deterministic schedule for one NPC for one day. Pure: same inputs
 * always yield the same blocks. Caller persists.
 *
 * Returns: array of length 8: [{ block_idx, activity, location_kind, target_x, target_z }]
 */
export function composeScheduleForNpc(npc, daySeed, preoccupation = null) {
  const archetype = String(npc.archetype || "default").toLowerCase();
  const base = ARCHETYPE_ROUTINES[archetype] || ARCHETYPE_ROUTINES.default;
  const overrides = preoccupationOverrides(preoccupation);
  const overrideMap = new Map(overrides.map(o => [o.block_idx, o]));

  const spawn = parseLocation(npc.spawn_location) || parseLocation(npc.current_location) || { x: 0, z: 0 };

  return base.map((slot, idx) => {
    const ov = overrideMap.get(idx);
    const activity = ov?.activity || slot.activity;
    const location_kind = ov?.location_kind || slot.location_kind;
    const { dx, dz } = deterministicOffset(npc, `${daySeed}|${idx}`);
    return {
      block_idx: idx,
      activity_kind: activity,
      location_kind,
      target_x: spawn.x + dx,
      target_z: spawn.z + dz,
    };
  });
}

function parseLocation(json) {
  if (!json) return null;
  if (typeof json === "object") return { x: Number(json.x) || 0, z: Number(json.z) || 0 };
  try {
    const p = JSON.parse(json);
    if (p && (Number.isFinite(Number(p.x)) || Number.isFinite(Number(p.z)))) {
      return { x: Number(p.x) || 0, z: Number(p.z) || 0 };
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Persist the 8 schedule rows for a (npc, day) pair. Idempotent: if a
 * row already exists with a different preoccupation_signature, it gets
 * overwritten. Returns the count of rows written.
 */
export function persistScheduleForNpc(db, npc, daySeed, preoccupation = null) {
  if (!db || !npc?.id) return 0;
  const slots = composeScheduleForNpc(npc, daySeed, preoccupation);
  const sig = preoccupation ? `${preoccupation.kind}:${(preoccupation.narrative || "").slice(0, 40)}` : null;

  let written = 0;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM npc_schedules WHERE npc_id = ? AND day_seed = ?`).run(npc.id, daySeed);
    for (const s of slots) {
      const id = `nps_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO npc_schedules
          (id, npc_id, block_idx, activity_kind, location_kind,
           target_x, target_z, day_seed, preoccupation_signature, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(id, npc.id, s.block_idx, s.activity_kind, s.location_kind,
             s.target_x, s.target_z, daySeed, sig);
      written++;
    }
  });
  try { tx(); }
  catch (err) {
    try { logger.warn?.("npc-routines", "persist_failed", { npcId: npc.id, error: err?.message }); }
    catch { /* ignore */ }
    return 0;
  }
  return written;
}

// ── Public: routine advancement ─────────────────────────────────────────────

export function currentDaySeed(now = Date.now()) {
  // Day seed = days since epoch — so all NPCs share the same day boundary.
  return Math.floor(now / 86400000);
}

export function currentBlockIdx(now = Date.now()) {
  const dayMs = now % 86400000;
  return Math.floor(dayMs / (BLOCK_HOURS * 3600000));
}

/**
 * Advance ONE NPC's routine. If the current block has changed since the
 * last advance, transitions the routine state. Otherwise nudges the NPC
 * toward the active target. Writes embodied signals if it's been
 * SIGNAL_EMIT_INTERVAL_S since the last emission for this NPC.
 *
 * Returns { ok, transitioned, arrived, signalsWritten }.
 */
export async function advanceRoutine(db, npc, opts = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const now = Math.floor(Date.now() / 1000);
  const daySeed = opts.daySeed ?? currentDaySeed();
  const blockIdx = opts.blockIdx ?? currentBlockIdx();

  // Make sure today's schedule exists.
  const block = db.prepare(`
    SELECT * FROM npc_schedules
    WHERE npc_id = ? AND day_seed = ? AND block_idx = ?
    LIMIT 1
  `).get(npc.id, daySeed, blockIdx);
  if (!block) return { ok: false, reason: "no_schedule" };

  const state = db.prepare(`SELECT * FROM npc_routine_state WHERE npc_id = ?`).get(npc.id) || null;
  const willTransition = !state || state.current_block !== blockIdx;

  // ── WS4: needs-driven goal selection (the motivated brain) ────────────────
  // Decay the NPC's needs each advance; on a block TRANSITION, re-pick a goal
  // among the REAL nearby buildings (smart-object POIs) by utility score and
  // OVERRIDE the schedule's random-offset target with that motivated
  // destination. The daily schedule becomes a bias (activity_kind), not a
  // script. Guarded + env-gated (CONCORD_NPC_NEEDS=0 → pure schedule).
  if (process.env.CONCORD_NPC_NEEDS !== "0") {
    try {
      let needs = decayNeeds(getNeeds(db, npc.id), NEED_ADVANCE_HOURS);
      if (willTransition && npc.world_id) {
        const pos = parseLocation(npc.current_location) || parseLocation(npc.spawn_location) || { x: block.target_x, z: block.target_z };
        const pois = nearbyPOIs(db, npc.world_id, pos.x, pos.z, 12);
        const goal = chooseNextGoal(npc, needs, pois, { activityKind: block.activity_kind, seedKey: `${npc.id}|${blockIdx}|${daySeed}` });
        if (goal?.poi) { block.target_x = goal.poi.x; block.target_z = goal.poi.z; }
      }
      setNeeds(db, npc.id, needs);
    } catch { /* needs layer best-effort */ }
  }

  // Block transition?
  let transitioned = false;
  if (!state || state.current_block !== blockIdx) {
    const expectedEnd = now + BLOCK_HOURS * 3600;
    db.prepare(`
      INSERT INTO npc_routine_state
        (npc_id, current_block, activity_kind, location_kind,
         target_x, target_z, started_at, arrived_at, expected_end_at, last_signal_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
      ON CONFLICT(npc_id) DO UPDATE SET
        current_block = excluded.current_block,
        activity_kind = excluded.activity_kind,
        location_kind = excluded.location_kind,
        target_x = excluded.target_x,
        target_z = excluded.target_z,
        started_at = excluded.started_at,
        arrived_at = NULL,
        expected_end_at = excluded.expected_end_at,
        last_signal_at = NULL
    `).run(npc.id, blockIdx, block.activity_kind, block.location_kind,
           block.target_x, block.target_z, now, expectedEnd);
    transitioned = true;
  }

  // The authoritative move target is the routine_state's — which holds the WS4
  // goal override picked on transition and PERSISTS across non-transition ticks
  // (the schedule block re-read above carries the old random offset, so we must
  // not move toward it once a goal was chosen).
  {
    const eff = db.prepare(`SELECT target_x, target_z FROM npc_routine_state WHERE npc_id = ?`).get(npc.id);
    if (eff && Number.isFinite(eff.target_x) && Number.isFinite(eff.target_z)) {
      block.target_x = eff.target_x;
      block.target_z = eff.target_z;
    }
  }

  // Nudge position toward the station — or, once arrived, PACE around it so the
  // NPC is never a frozen statue (WS0). Start position falls back to spawn, then
  // to the station itself (never the {0,0} garbage step the bare boot produced).
  const cur = parseLocation(npc.current_location)
    || parseLocation(npc.spawn_location)
    || { x: block.target_x, z: block.target_z };
  const dist = Math.hypot(block.target_x - cur.x, block.target_z - cur.z);
  const arrived = dist <= ARRIVAL_RADIUS_M;

  // Choose this tick's move target + step size.
  let moveX = block.target_x;
  let moveZ = block.target_z;
  let stepCap = NUDGE_M_PER_TICK;
  if (arrived && IDLE_WANDER_RADIUS_M > 0) {
    const pace = idlePaceTarget(npc.id, block.target_x, block.target_z, now);
    moveX = pace.x;
    moveZ = pace.z;
    stepCap = IDLE_NUDGE_M_PER_TICK; // slow amble at the station
  }
  const mdx = moveX - cur.x;
  const mdz = moveZ - cur.z;
  const mdist = Math.hypot(mdx, mdz);
  let nx = cur.x;
  let nz = cur.z;
  if (mdist > 0.05) {
    const step = Math.min(stepCap, mdist);
    const nrm = step / mdist;
    nx = cur.x + mdx * nrm;
    nz = cur.z + mdz * nrm;
  }
  db.prepare(`UPDATE world_npcs SET current_location = ? WHERE id = ?`)
    .run(JSON.stringify({ x: nx, z: nz }), npc.id);

  if (arrived) {
    db.prepare(`UPDATE npc_routine_state SET arrived_at = COALESCE(arrived_at, unixepoch()) WHERE npc_id = ?`)
      .run(npc.id);
    // WS4 — at the destination POI, performing the activity SATISFIES the needs
    // that POI advertises (lowers their deficit) — closing the goal→walk→act→
    // satisfy loop so needs visibly cycle. Guarded + env-gated.
    if (process.env.CONCORD_NPC_NEEDS !== "0" && npc.world_id) {
      try {
        const [poiHere] = nearbyPOIs(db, npc.world_id, nx, nz, 1);
        if (poiHere && poiHere.dist <= POI_ARRIVE_SATISFY_M) {
          setNeeds(db, npc.id, satisfyFromAdvertisement(getNeeds(db, npc.id), poiHere.advertises));
        }
      } catch { /* satisfy best-effort */ }
    }
  }

  // Embodied signal write — only if arrived AND throttle interval passed.
  let signalsWritten = 0;
  if (arrived) {
    const refreshed = db.prepare(`SELECT last_signal_at FROM npc_routine_state WHERE npc_id = ?`).get(npc.id);
    const last = Number(refreshed?.last_signal_at || 0);
    if (now - last >= SIGNAL_EMIT_INTERVAL_S) {
      try {
        const signals = await import("./embodied/signals.js");
        const writes = ACTIVITY_SIGNALS[block.activity_kind] || [];
        for (const w of writes) {
          signals.recordSignal?.(db, {
            worldId: npc.world_id,
            x: nx, z: nz,
            channel: w.channel,
            value: w.value,
            ttlSeconds: w.ttlSeconds,
            source: "npc_activity",
            sourceId: npc.id,
          });
          signalsWritten++;
        }
        db.prepare(`UPDATE npc_routine_state SET last_signal_at = unixepoch() WHERE npc_id = ?`).run(npc.id);
      } catch { /* signals optional on minimal builds */ }
    }
  }

  return { ok: true, transitioned, arrived, signalsWritten };
}

/**
 * Read the current activity for an NPC — used by the dialogue endpoint
 * to inject "you are currently {activity} at {location_kind}" into
 * the LLM prompt.
 */
export function getActiveRoutine(db, npcId) {
  if (!db || !npcId) return null;
  try {
    return db.prepare(`SELECT * FROM npc_routine_state WHERE npc_id = ?`).get(npcId) || null;
  } catch { return null; }
}

/**
 * Regenerate today's schedule for every NPC in a faction. Called by the
 * Phase 2 refreshFactionPreoccupations cascade so a faction phase change
 * propagates into the visible world within one tick.
 */
export function regenerateSchedulesForFaction(db, factionId, preoccupation) {
  if (!db || !factionId) return { ok: false, reason: "no_faction" };
  const npcs = db.prepare(`
    SELECT id, archetype, faction, current_location, spawn_location, world_id
    FROM world_npcs
    WHERE faction = ? AND COALESCE(is_dead, 0) = 0
    LIMIT 200
  `).all(factionId);
  const daySeed = currentDaySeed();
  let regenerated = 0;
  for (const npc of npcs) {
    const w = persistScheduleForNpc(db, npc, daySeed, preoccupation);
    if (w > 0) regenerated++;
  }
  return { ok: true, regenerated };
}

export const _internal = {
  BLOCKS_PER_DAY,
  BLOCK_HOURS,
  NUDGE_M_PER_TICK,
  ARRIVAL_RADIUS_M,
  SIGNAL_EMIT_INTERVAL_S,
  IDLE_WANDER_RADIUS_M,
  IDLE_NUDGE_M_PER_TICK,
  IDLE_WANDER_PERIOD_S,
  ACTIVITY_SIGNALS,
  ARCHETYPE_ROUTINES,
  preoccupationOverrides,
  parseLocation,
  deterministicOffset,
  idlePaceTarget,
};
