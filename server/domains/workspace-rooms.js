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

import {
  createRoom, listInDistrict, listMine,
  setRoomObjective, getRoomObjective, startOrResumeConkayAssist,
  getActiveRoomMarathon, describeRoomConkayActivity, assignSubgoal,
} from "../lib/workspace-rooms.js";

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

  // ── V1.2 Wave B — "team mode": shared objective + ConKay participation ──
  // (lib/workspace-rooms.js, mig 380). See that file's header for the full
  // design; these four macros are thin wrappers, same shape as the three
  // above.

  /**
   * workspace.set-objective — set/clear a room's shared objective and,
   * optionally, link/mint a real goal_decomposition tree.
   * input: { roomId, objective?, goalTreeId?, mintGoalTree? }
   */
  register("workspace", "set-objective", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { roomId, objective, goalTreeId, mintGoalTree } = input;
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    return setRoomObjective(db, roomId, userId, { objective, goalTreeId, mintGoalTree });
  }, { note: "set/clear a room's shared objective; optionally link an existing goal tree the caller owns, or mint a fresh one" });

  /**
   * workspace.get-objective — read a room's objective + its linked goal
   * tree's REAL live state (never a snapshot). Honest-empty when neither
   * is set.
   * input: { roomId }
   */
  register("workspace", "get-objective", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { roomId } = input;
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    return getRoomObjective(db, roomId);
  }, { note: "read a room's shared objective + linked goal tree's live state" });

  /**
   * workspace.conkay-assist — give ConKay a real, bounded participant role
   * in a room's work: start (or resume) an agent-marathon.js session
   * scoped to the room's objective + goal tree, under the mig-379
   * governance envelope (allowedDomains defaults to the conservative
   * dtu+decomp allowlist — NOT the full tool surface a bare
   * agent_marathon.start gets). Requires the room to already have both an
   * objective and a linked goal tree set (via workspace.set-objective).
   * input: { roomId, allowedDomains?, budgetCap?, maxTurns? }
   */
  register("workspace", "conkay-assist", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { roomId, allowedDomains, budgetCap, maxTurns } = input;
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    return startOrResumeConkayAssist(db, roomId, userId, { allowedDomains, budgetCap, maxTurns });
  }, { note: "start or resume a bounded, room-scoped ConKay marathon session working toward the room's objective (reuses agent-marathon.js end to end — no new execution engine)" });

  /**
   * workspace.conkay-status — read-only poll: is ConKay actively working
   * on this room right now, and an honest summary of what it's doing
   * (derived from the real marathon session's real last recorded turn —
   * never a fabricated "thinking..."). Backs SharedWorkspaceRoom.tsx's
   * ConKay presence indicator.
   * input: { roomId }
   */
  register("workspace", "conkay-status", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { roomId } = input;
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    const session = getActiveRoomMarathon(db, roomId);
    if (!session) return { ok: true, active: false };
    return { ok: true, active: true, activity: describeRoomConkayActivity(session) };
  }, { note: "poll whether ConKay is actively working on this room's objective, with an honest activity summary" });

  /**
   * workspace.assign-subgoal — claim (or, with assigneeUserId omitted/null,
   * release) a node in the room's linked goal tree. Both the caller and the
   * assignee must be real current participants of the room (see
   * lib/workspace-rooms.js#realParticipantIds — the owner, plus whoever is
   * actually live-connected to the room's Socket.IO channel right now); an
   * arbitrary user id is rejected, not accepted on faith.
   * input: { roomId, nodeId, assigneeUserId? }
   */
  register("workspace", "assign-subgoal", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const { roomId, nodeId, assigneeUserId } = input;
    if (!roomId) return { ok: false, reason: "missing_room_id" };
    if (!nodeId) return { ok: false, reason: "missing_node_id" };
    return assignSubgoal(db, roomId, userId, { nodeId, assigneeUserId: assigneeUserId ?? null });
  }, { note: "assign or clear a subgoal's assignee; caller and assignee must both be real current room participants (mig 386)" });
}
