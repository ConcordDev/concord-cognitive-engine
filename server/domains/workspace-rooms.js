// server/domains/workspace-rooms.js
//
// V1.2 Wave A (Society & Presence), capability 3 — shared DTU spaces.
//
// Three discovery macros over the metadata layer in
// server/lib/workspace-rooms.js. These macros never touch the Yjs doc —
// they only create/find rows that let a room be discovered by name,
// district, or ownership. Once a client has a room id (from create-room
// or one of the list macros), it hands that id straight to
// <SharedWorkspaceRoom roomId={id} .../> which talks to the real
// 'workspace:room' Yjs scope directly over its own socket path.

import { createRoom, listInDistrict, listMine } from "../lib/workspace-rooms.js";

export default function registerWorkspaceRoomMacros(register) {
  /**
   * workspace.create-room — mint a new room id + metadata row.
   * input: { name, worldId, districtId? }
   */
  register("workspace", "create-room", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { name, worldId, districtId } = input;
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return createRoom(db, { ownerId: userId, worldId, districtId: districtId || null, name });
  }, { note: "create a shared workspace room (metadata only — the DTU list + presence live in the workspace:room Yjs doc)" });

  /**
   * workspace.list-in-district — rooms anchored to a (worldId, districtId).
   * input: { worldId, districtId, limit? }
   */
  register("workspace", "list-in-district", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, districtId, limit } = input;
    if (!worldId || !districtId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, rooms: listInDistrict(db, worldId, districtId, { limit }) };
  }, { note: "list rooms anchored to a world+district, mirroring ambient-chat.js#listRecentInDistrict's scoping" });

  /**
   * workspace.list-mine — rooms owned by the caller (ownership-only
   * first cut; see lib/workspace-rooms.js header for why "has been in"
   * isn't an available honest signal to widen this against).
   * input: { userId?, limit? }
   */
  register("workspace", "list-mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input?.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, rooms: listMine(db, userId, { limit: input?.limit }) };
  }, { note: "list rooms the caller owns" });
}
