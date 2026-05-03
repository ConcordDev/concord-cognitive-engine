// server/lib/sovereign/raid-event.js
//
// The Great Refusal — Sovereign Mass Raid Event scaffold.
//
// Lore: every 3-4 months the Sovereign opens a portal above the hub and
// invites everyone who wants to test him. There is no party limit. The
// raid has friendly-fire immunity — players can't damage each other.
// Player-vs-player damage is gated by isFriendlyFireImmune() so no
// combat code path needs to special-case the raid. The Sovereign cannot
// be defeated; eventually he declares Phase 4's Eternal Refusal and the
// instance collapses, kicking everyone out with the Mark of the Refused.
//
// This module is a scaffold: it owns the raid lifecycle (open / close /
// participant list) and exposes hooks the world systems consult (FF
// immunity, scaling). Phase progression and damage logic are out of
// scope for this drop — they slot in when raid combat is wired.

import crypto from "node:crypto";
import { applyTemporaryRefusal } from "../refusal-field.js";

const RAID_KIND = "great_refusal_mass_raid";
const PORTAL_OPEN_HOURS = 48;

/**
 * Phase scaling thresholds — read by raid combat to ramp the Sovereign's
 * power and unlock new Refusal Field declarations.
 */
const PHASE_THRESHOLDS = Object.freeze({
  tester:   { minParticipants: 1,    maxParticipants: 50,   refusals: [] },
  refusal:  { minParticipants: 51,   maxParticipants: 200,  refusals: ["consequence_held"] },
  archive:  { minParticipants: 201,  maxParticipants: 1000, refusals: ["consequence_held"] },
  eternal:  { minParticipants: 1001, maxParticipants: Infinity, refusals: ["numbers_refused", "dome_collapse", "win_refused"] },
});

/**
 * state.activeSovereignRaid : { id, worldId, openedAt, closesAt, participants: Set, phase }
 * (single instance — the lore says there's one Sovereign event open at a time)
 */

function ensureRaid(state) {
  return state.activeSovereignRaid ?? null;
}

/**
 * Open a new Sovereign raid event. Call from a scheduler or admin tool.
 * @returns {object} the raid record
 */
export function openSovereignRaid(state, worldId = "concordia-hub") {
  if (!state) throw new Error("state required");
  // Only one raid open at a time per the lore — return the existing one.
  if (state.activeSovereignRaid && state.activeSovereignRaid.closesAt > Date.now()) {
    return state.activeSovereignRaid;
  }
  const raid = {
    id: `raid_${crypto.randomUUID()}`,
    kind: RAID_KIND,
    worldId,
    openedAt: Date.now(),
    closesAt: Date.now() + PORTAL_OPEN_HOURS * 60 * 60 * 1000,
    participants: new Set(),
    phase: "tester",
    declaredRefusals: [],
  };
  state.activeSovereignRaid = raid;
  return raid;
}

/**
 * Close the raid (or auto-close if past closesAt). Returns the final
 * roster so the caller can mint Marks of the Refused for each participant.
 */
export function closeSovereignRaid(state) {
  const raid = ensureRaid(state);
  if (!raid) return null;
  state.activeSovereignRaid = null;
  return {
    id: raid.id,
    participants: Array.from(raid.participants),
    finalPhase: raid.phase,
    durationMs: Date.now() - raid.openedAt,
  };
}

/**
 * Add a player to the raid roster. Idempotent. Delegates phase
 * progression to maybeAdvancePhase so the Refusal Field declarations
 * tied to each phase fire automatically.
 */
export function joinSovereignRaid(state, userId) {
  const raid = ensureRaid(state);
  if (!raid) return { ok: false, reason: "no_open_raid" };
  if (raid.closesAt < Date.now()) return { ok: false, reason: "raid_closed" };
  raid.participants.add(userId);
  const phase = maybeAdvancePhase(state);
  return { ok: true, phase, participants: raid.participants.size };
}

/** Determine the current raid phase from participant count. */
export function computePhase(count) {
  for (const [name, range] of Object.entries(PHASE_THRESHOLDS)) {
    if (count >= range.minParticipants && count <= range.maxParticipants) return name;
  }
  return "eternal";
}

/**
 * Friendly-fire immunity gate. Combat code consults this before applying
 * player→player damage. Inside the raid, attacks pass through allies.
 */
export function isFriendlyFireImmune(state, attackerId, targetId) {
  const raid = ensureRaid(state);
  if (!raid) return false;
  if (raid.closesAt < Date.now()) return false;
  return raid.participants.has(attackerId) && raid.participants.has(targetId);
}

/**
 * Phase progression hook — called as participants enter or as the raid
 * runner advances. When entering 'eternal', declare the three signature
 * refusal fields that make the raid unwinnable (per the canon: the
 * Sovereign refuses the very idea of being defeated by numbers).
 */
export function maybeAdvancePhase(state) {
  const raid = ensureRaid(state);
  if (!raid) return null;
  const newPhase = computePhase(raid.participants.size);
  if (newPhase === raid.phase) return raid.phase;
  raid.phase = newPhase;

  // Declare the phase's signature refusal fields. They auto-expire via the
  // refusal-field-sweep heartbeat if the phase is left.
  const range = PHASE_THRESHOLDS[newPhase];
  raid.declaredRefusals = [];
  for (const kind of range.refusals) {
    const entry = applyTemporaryRefusal(state, raid.worldId, kind, {
      durationMs: 30 * 60 * 1000,
      reason: `sovereign_raid_${newPhase}`,
    });
    if (entry) raid.declaredRefusals.push(entry.id);
  }
  return raid.phase;
}

/**
 * Sovereign scaling factor — combat code multiplies his outgoing damage
 * + cooldown reduction by this. Approximate, monotone in participant
 * count. The 'eternal' phase additionally fires win_refused so victory
 * is mechanically impossible.
 */
export function sovereignScalingFactor(state) {
  const raid = ensureRaid(state);
  if (!raid) return 1.0;
  const n = raid.participants.size;
  if (n <= 50)    return 1.0;
  if (n <= 200)   return 1.5;
  if (n <= 1000)  return 2.5;
  return 4.0; // eternal — not a number balance can solve
}

export const SOVEREIGN_RAID_KIND = RAID_KIND;
export const PHASE_TABLE = PHASE_THRESHOLDS;
