// server/domains/dungeon.js
//
// C3 / F5.1 — instanced dungeon/raid surface. Domain key: 'dungeon'.
//   dungeon.encounters — the authored phased-boss catalog
//   dungeon.open       — open an instance for the caller's party
//   dungeon.hit        — land a hit on the boss (advances phases, clears at 0)
//   dungeon.down       — mark the caller downed (all-downed = wipe)
//   dungeon.state      — live instance state for the HUD
//   dungeon.active     — Wave 4: the caller's current in-progress instance (or null)
//   dungeon.lockouts   — Wave 4: the caller's active encounter lockouts

import {
  openInstance, recordHit, downParticipant, getInstance, DUNGEON_ENCOUNTERS,
  getActiveInstanceForUser, getLockoutsForUser,
} from "../lib/dungeon-instance.js";

export default function registerDungeonMacros(register) {
  register("dungeon", "encounters", async () => ({ ok: true, encounters: Object.values(DUNGEON_ENCOUNTERS) }));

  register("dungeon", "open", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.encounterId || !input.worldId) return { ok: false, reason: "missing_inputs" };
    // Pull party members from the caller's live party when present.
    let members = Array.isArray(input.members) ? input.members.map(String) : [];
    try {
      const { getMyParty } = await import("../lib/parties.js");
      const party = getMyParty(db, userId);
      if (party?.members) members = party.members.map((m) => m.userId);
    } catch { /* parties optional — solo instance */ }
    return openInstance(db, {
      leaderUserId: userId, worldId: String(input.worldId), encounterId: String(input.encounterId),
      tier: input.tier || "finder", members, roles: input.roles || {},
    });
  });

  register("dungeon", "hit", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.instanceId) return { ok: false, reason: "missing_inputs" };
    return recordHit(db, String(input.instanceId), userId, Number(input.damage) || 0);
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  register("dungeon", "down", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.instanceId) return { ok: false, reason: "missing_inputs" };
    return downParticipant(db, String(input.instanceId), userId);
  });

  register("dungeon", "state", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.instanceId) return { ok: false, reason: "missing_inputs" };
    const inst = getInstance(db, String(input.instanceId));
    return inst ? { ok: true, instance: inst } : { ok: false, reason: "no_instance" };
  });

  // Wave 4 gap-closure — lets the frontend HUD discover an in-progress
  // instance without persisting an instanceId client-side (page reload,
  // a party member who didn't call `open` themselves, etc).
  register("dungeon", "active", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "missing_inputs" };
    const inst = getActiveInstanceForUser(db, userId, input.worldId ? String(input.worldId) : undefined);
    return { ok: true, instance: inst };
  });

  register("dungeon", "lockouts", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, lockouts: getLockoutsForUser(db, userId) };
  });
}
