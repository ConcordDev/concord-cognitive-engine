// The hub world's id, in one place.
//
// The hub is "concordia-hub": the worlds row, content/world/concordia-hub,
// the Unity client and the web lens all use it. Older code defaulted to a
// bare "concordia" (migration 098 moved the data once, but the code kept
// writing the old id), so systems ran the hub twice under two ids — e.g. the
// world-event scheduler ticked only "concordia", every user's current_world
// was "concordia", and /api/world/bazaar returned no stalls for
// "concordia-hub". Use HUB_WORLD_ID for the hub and canonicalWorldId() on any
// world id that may come from old data or an old client.

export const HUB_WORLD_ID = "concordia-hub";

/** Ids that mean the hub. */
export const HUB_WORLD_ALIASES = new Set([HUB_WORLD_ID, "concordia"]);

export function isHubWorld(worldId) {
  return HUB_WORLD_ALIASES.has(String(worldId || ""));
}

/** Map a legacy hub id to the canonical one; other ids pass through. */
export function canonicalWorldId(worldId) {
  return isHubWorld(worldId) ? HUB_WORLD_ID : worldId;
}
