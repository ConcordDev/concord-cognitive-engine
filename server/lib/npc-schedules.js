/**
 * NPC Schedules — daily routines keyed off the world clock.
 *
 * Until now NPCs were always on the same job. With this module each NPC has
 * a structured schedule by day-segment: dawn / morning / midday / afternoon
 * / dusk / night. A baker wakes at dawn, runs the bakery midday, locks up
 * at dusk, and sleeps at night. A guard works dusk + night, sleeps morning
 * + midday.
 *
 * Schedules are AUTHORED per archetype (default below) and can be overridden
 * per-NPC. The npc-simulator's behavior tick reads the current segment via
 * getCurrentBehavior(npcId) and switches the NPC's active behavior.
 *
 * Procedural NPCs without a schedule fall back to the archetype default.
 */

import { getDayPhase, getWorldPhase } from "./world-clock.js";

/**
 * @typedef {Object} ScheduleSegment
 * @property {string} behavior   "work" | "rest" | "patrol" | "socialize" | "travel" | "guard" | "trade"
 * @property {string} [location] location key the NPC heads to during this segment
 * @property {number} [intensity] 0..1 — how strictly the NPC follows this
 */

/** Default daily schedule per archetype. */
const ARCHETYPE_SCHEDULES = {
  baker:    { dawn: "work",      morning: "trade",     midday: "trade",     afternoon: "rest",      dusk: "socialize", night: "rest" },
  smith:    { dawn: "rest",      morning: "work",      midday: "trade",     afternoon: "work",      dusk: "trade",     night: "rest" },
  guard:    { dawn: "patrol",    morning: "rest",      midday: "rest",      afternoon: "patrol",    dusk: "guard",     night: "guard" },
  scholar:  { dawn: "rest",      morning: "work",      midday: "work",      afternoon: "socialize", dusk: "work",      night: "work" },
  merchant: { dawn: "travel",    morning: "trade",     midday: "trade",     afternoon: "trade",     dusk: "socialize", night: "rest" },
  farmer:   { dawn: "work",      morning: "work",      midday: "rest",      afternoon: "work",      dusk: "trade",     night: "rest" },
  thief:    { dawn: "rest",      morning: "rest",      midday: "socialize", afternoon: "patrol",    dusk: "patrol",    night: "work" },
  bard:     { dawn: "rest",      morning: "rest",      midday: "travel",    afternoon: "socialize", dusk: "work",      night: "work" },
  // Crime-world flavors
  enforcer: { dawn: "rest",      morning: "rest",      midday: "patrol",    afternoon: "patrol",    dusk: "guard",     night: "guard" },
  // Cyber-world flavors
  hacker:   { dawn: "rest",      morning: "work",      midday: "work",      afternoon: "rest",      dusk: "work",      night: "work" },
  netrunner:{ dawn: "rest",      morning: "rest",      midday: "rest",      afternoon: "work",      dusk: "work",      night: "work" },
  // Default fallback
  default:  { dawn: "rest",      morning: "work",      midday: "work",      afternoon: "socialize", dusk: "rest",      night: "rest" },
};

const _customSchedules = new Map(); // npcId -> {dawn,...,night}

/** Override an NPC's default archetype schedule. Pass null to clear. */
export function setNPCSchedule(npcId, schedule) {
  if (schedule === null) _customSchedules.delete(npcId);
  else _customSchedules.set(npcId, schedule);
}

/**
 * What is this NPC supposed to be doing right now?
 * @param {object} npc   — { id, archetype }
 * @returns {string} behavior token
 */
export function getCurrentBehavior(npc) {
  const segment = getDayPhase();
  const custom  = _customSchedules.get(npc?.id);
  const sched   = custom ?? ARCHETYPE_SCHEDULES[npc?.archetype] ?? ARCHETYPE_SCHEDULES.default;
  return sched[segment] ?? "rest";
}

/**
 * Decide if an NPC's behavior should *change* now (vs at the previous tick).
 * Useful for the simulator: only re-plan when the segment crossed a boundary.
 */
export function hasSegmentChanged(prevPhase, nowPhase = getWorldPhase()) {
  return getDayPhase(prevPhase) !== getDayPhase(nowPhase);
}

/**
 * Bulk lookup: given a list of NPCs, return their current behaviors keyed
 * by id. Used by the simulator's behavior tick to compute its plan.
 */
export function batchCurrentBehaviors(npcs) {
  const out = {};
  for (const npc of npcs) out[npc.id] = getCurrentBehavior(npc);
  return out;
}

export const NPC_SCHEDULE_ARCHETYPES = Object.freeze(Object.keys(ARCHETYPE_SCHEDULES));
