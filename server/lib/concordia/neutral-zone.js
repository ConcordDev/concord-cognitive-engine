// server/lib/concordia/neutral-zone.js
//
// The Great Refusal: Concordia (the goddess) claimed the main hub world
// as a neutral zone where no one can attack without her permission. We
// enforce that here as a single function used by combat / hostile-action
// endpoints. Any world where this returns false rejects the action.
//
// Concordia can grant per-player exemptions via grantExemption(); the
// gate (checkHostilityAllowed) consumes them. Wiring is end-to-end.
// What's still unwired is the AUTHORED DIALOGUE PATH — no goddess
// dialogue tree currently calls grantExemption() in response to player
// behavior. That's a content-authoring gap, not a code gap; once
// content/dialogues/concordia_*.json adds an "exempt:user" outcome the
// mechanic activates without further code changes.

const HUB_WORLD_IDS = new Set(["concordia-hub", "concordia"]);

/**
 * @param {object} state            — STATE.exemptionsByWorld may exist
 * @param {string} worldId
 * @param {string} actorUserId
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkHostilityAllowed(state, worldId, actorUserId) {
  if (!HUB_WORLD_IDS.has(worldId)) return { allowed: true };
  const exemptions = state?.neutralZoneExemptions?.[worldId];
  if (exemptions && exemptions instanceof Set && exemptions.has(actorUserId)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "neutral_zone_concordia",
  };
}

/**
 * Concordia's grant. Used by her dialogue tree to issue an exemption when
 * a player's ecosystem_score is high enough that she trusts them to wield
 * violence in her hub.
 */
export function grantExemption(state, worldId, userId) {
  if (!state) return;
  if (!state.neutralZoneExemptions) state.neutralZoneExemptions = {};
  if (!state.neutralZoneExemptions[worldId]) state.neutralZoneExemptions[worldId] = new Set();
  state.neutralZoneExemptions[worldId].add(userId);
}

export const HUB_WORLDS = HUB_WORLD_IDS;
