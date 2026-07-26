// server/lib/workspace-rooms.js
//
// V1.2 Wave A — discovery metadata for MU2's Shared Workspace Room.
//
// This module is deliberately thin and deliberately NOT a content store.
// The `workspace:room` Yjs scope (server/lib/yjs-realtime.js) already
// owns the real thing: the shared `Y.Array` of DTU references and the
// live Awareness-based presence, both rendered by
// concord-frontend/components/workspace/SharedWorkspaceRoom.tsx. Nothing
// here reads or writes that Y.Doc, and nothing here is required for a
// room to function — a room id shared out-of-band still works with zero
// rows in `workspace_rooms`, exactly like it did before this file existed.
//
// What this module adds: rooms can now be CREATED (mint an id + record
// who made it / where it's anchored) and DISCOVERED (list what's nearby,
// list what's mine) instead of only joinable by a hand-copied id.
//
// `listMine` is ownership-only by design, not "owned or been in": MU2's
// Awareness presence is intentionally ephemeral (the y-protocols spec's
// own design — states drop if not refreshed every ~30s) and the Yjs doc
// itself is in-memory-only per yjs-realtime.js's own header comment ("the
// doc state is lost on server restart"). There is no durable, honest
// signal anywhere in the stack for "this user was once present in this
// room" to widen the scope against — inventing one here (e.g. a
// best-effort join-log) would be exactly the kind of parallel
// membership/ACL substrate MU2's own design notes decline to build.
// If a durable visit history is wanted later, it belongs as its own
// explicit table/decision, not smuggled into this metadata layer.

import crypto from "node:crypto";
import { createGoalTree, getGoalTree, assignNode } from "./goal-decomposition.js";
import { startMarathon, getMarathon } from "./agent-marathon.js";
import { KNOWN_SCOPES } from "./yjs-realtime.js";

const NAME_MAX_LEN = 80;
const OBJECTIVE_MAX_LEN = 500;

// Conservative default tool-domain allowlist for a ConKay session working
// inside a shared workspace room (mig 379 governance envelope, enforced by
// agent-marathon.js#createToolGate). "dtu" is create_dtu's resolved domain,
// "decomp" is the goal-decomposition macro domain (server/domains/decomp.js)
// — together they let ConKay read/advance the room's linked goal tree and
// mint DTUs from what it finds, WITHOUT the full unrestricted tool surface
// (web_search, mcp_call, run_lens_action across every other macro domain)
// a bare `agent_marathon.start` gets by default. Callers may still pass
// their own `allowedDomains` to widen or narrow this.
export const CONKAY_ASSIST_DEFAULT_DOMAINS = Object.freeze(["dtu", "decomp"]);

function newRoomId() {
  return `wr_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Create a room's metadata row and mint the id the Yjs layer will use as
 * its docId. Returns the fresh room; the frontend passes `room.id` as
 * `roomId` straight into `<SharedWorkspaceRoom roomId={room.id} .../>`.
 */
export function createRoom(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const { ownerId, worldId, districtId = null, name } = opts;
  if (!ownerId || !worldId) return { ok: false, error: "missing_inputs" };
  const trimmedName = String(name || "").trim().slice(0, NAME_MAX_LEN);
  if (!trimmedName) return { ok: false, error: "empty_name" };

  const id = newRoomId();
  try {
    db.prepare(`
      INSERT INTO workspace_rooms (id, name, owner_id, world_id, district_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, trimmedName, ownerId, worldId, districtId || null);
    return { ok: true, room: getRoom(db, id) };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

export function getRoom(db, id) {
  if (!db || !id) return null;
  try {
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at, objective, goal_tree_id
      FROM workspace_rooms WHERE id = ?
    `).get(id) || null;
  } catch {
    return null;
  }
}

/** Rooms anchored to a (worldId, districtId) pair — mirrors the exact
 *  scoping shape of ambient-chat.js#listRecentInDistrict. */
export function listInDistrict(db, worldId, districtId, opts = {}) {
  if (!db || !worldId || !districtId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 25));
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at
      FROM workspace_rooms
      WHERE world_id = ? AND district_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(worldId, districtId, limit);
  } catch {
    return [];
  }
}

/** Rooms owned by a given user — see the module header for why this is
 *  ownership-only rather than "owned or has been in." */
export function listMine(db, ownerId, opts = {}) {
  if (!db || !ownerId) return [];
  try {
    const limit = Math.max(1, Math.min(100, opts.limit || 50));
    return db.prepare(`
      SELECT id, name, owner_id, world_id, district_id, created_at
      FROM workspace_rooms
      WHERE owner_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(ownerId, limit);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// V1.2 Wave B — "team mode": a room's shared objective + ConKay's bounded
// participation in working on it (mig 380). Everything below reuses two
// already-real, already-tested subsystems end to end — never a duplicate
// engine:
//   - server/lib/goal-decomposition.js (mig 340) for the durable subgoal
//     tree a room can link to.
//   - server/lib/agent-marathon.js (mig 171 + the mig-379 governance
//     envelope) for ConKay's actual execution loop.
// This mirrors exactly how server/lib/project-thread.js ties those same
// two subsystems into a single-user "project" — here the addressable unit
// is a shared ROOM instead of a per-user project, and a room can
// accumulate multiple ConKay work sessions over its life via
// `workspace_room_marathon_links`, same shape as `project_marathon_links`.
// ─────────────────────────────────────────────────────────────────────────

const ACTIVE_MARATHON_STATUSES = new Set(["pending", "running", "paused"]);

/**
 * Set (or clear) a room's shared objective, and optionally link it to a
 * real goal tree — either an existing one the caller owns, or a brand new
 * one minted right here via goal-decomposition.js's own `createGoalTree`
 * (no duplicated tree logic). A room with no objective/tree stays fully
 * usable for plain co-editing — this is purely additive.
 *
 * Ownership note: unlike a single-user `project` (mig 378), a workspace
 * room is inherently shared — anyone holding the room id can join it (see
 * this file's own header). Setting the plain-text objective is open to
 * any authenticated participant. LINKING A GOAL TREE is more sensitive —
 * once linked, its node detail becomes visible to everyone in the room —
 * so both "link an existing tree" and "mint + link a new tree" require
 * the caller to own that tree, exactly like project-thread.js#createProject's
 * own check. This stops one participant from leaking another user's
 * private goal tree into a shared room they don't control.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.objective] - new objective text, or `null` to clear it. Omit to leave unchanged.
 * @param {string} [opts.goalTreeId] - link an existing tree the caller owns.
 * @param {boolean} [opts.mintGoalTree] - mint + link a brand new tree titled from the objective (ignored if `goalTreeId` is also given).
 */
export function setRoomObjective(db, roomId, callerId, opts = {}) {
  if (!db || !roomId) return { ok: false, reason: "missing_inputs" };
  const uid = callerId ? String(callerId) : null;
  if (opts.objective === undefined && !opts.goalTreeId && !opts.mintGoalTree) {
    return { ok: false, reason: "missing_inputs" };
  }

  const room = getRoom(db, roomId);
  if (!room) return { ok: false, reason: "room_not_found" };

  let objectiveToSet = room.objective ?? null;
  if (opts.objective !== undefined) {
    if (opts.objective === null) {
      objectiveToSet = null;
    } else {
      const trimmed = String(opts.objective).trim().slice(0, OBJECTIVE_MAX_LEN);
      if (!trimmed) return { ok: false, reason: "empty_objective" };
      objectiveToSet = trimmed;
    }
  }

  let goalTreeIdToSet = room.goal_tree_id ?? null;
  if (opts.goalTreeId) {
    if (!uid) return { ok: false, reason: "no_user" };
    const gt = getGoalTree(db, String(opts.goalTreeId));
    if (!gt.ok) return { ok: false, reason: "goal_tree_not_found" };
    if (gt.tree.userId !== uid) return { ok: false, reason: "goal_tree_not_owned" };
    goalTreeIdToSet = String(opts.goalTreeId);
  } else if (opts.mintGoalTree) {
    if (!uid) return { ok: false, reason: "no_user" };
    const title = String(objectiveToSet || room.name || "Workspace objective").slice(0, 140);
    const created = createGoalTree(db, { userId: uid, title, description: objectiveToSet || "" });
    if (!created.ok) return { ok: false, reason: created.reason || "goal_tree_create_failed" };
    goalTreeIdToSet = created.treeId;
  }

  try {
    db.prepare(`UPDATE workspace_rooms SET objective = ?, goal_tree_id = ? WHERE id = ?`)
      .run(objectiveToSet, goalTreeIdToSet, roomId);
  } catch (err) {
    return { ok: false, reason: "db_error", error: err?.message || String(err) };
  }
  return { ok: true, room: getRoom(db, roomId) };
}

/**
 * Read a room's objective + the REAL current state of its linked goal
 * tree, via goal-decomposition.js's own getter (never a cached snapshot).
 * Honest-empty: a room with no objective/tree returns nulls, not a
 * fabricated placeholder; a dangling `goal_tree_id` (tree deleted after
 * linking) is reported plainly — mirrors project-thread.js#getProject.
 */
export function getRoomObjective(db, roomId) {
  if (!db || !roomId) return { ok: false, reason: "missing_inputs" };
  const room = getRoom(db, roomId);
  if (!room) return { ok: false, reason: "room_not_found" };

  let goalTree = null;
  if (room.goal_tree_id) {
    const gt = getGoalTree(db, room.goal_tree_id);
    goalTree = gt.ok ? gt : { ok: false, reason: gt.reason || "goal_tree_unavailable", treeId: room.goal_tree_id };
  }
  return {
    ok: true,
    roomId,
    objective: room.objective || null,
    goalTreeId: room.goal_tree_id || null,
    goalTree,
  };
}

/** Link a marathon session to a room (idempotent — re-linking the same
 *  pair is a no-op, not an error). Both sides must genuinely exist —
 *  mirrors project-thread.js#linkMarathonToProject exactly, just keyed by
 *  room instead of project. */
export function linkMarathonToRoom(db, roomId, marathonSessionId) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!roomId || !marathonSessionId) return { ok: false, reason: "missing_inputs" };

  const room = getRoom(db, roomId);
  if (!room) return { ok: false, reason: "room_not_found" };
  const session = getMarathon(db, marathonSessionId);
  if (!session) return { ok: false, reason: "marathon_not_found" };

  try {
    db.prepare(`
      INSERT OR IGNORE INTO workspace_room_marathon_links (room_id, marathon_session_id) VALUES (?, ?)
    `).run(roomId, marathonSessionId);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, roomId, marathonSessionId };
}

/**
 * The most recently linked marathon session for a room that is NOT in a
 * terminal state (completed/abandoned/failed/revoked) — i.e. "is ConKay
 * currently (or still) working on this room's objective," read live via
 * agent-marathon.js's own getter every call, never cached. Returns `null`
 * when there is no such session (honest-empty, never fabricated).
 */
export function getActiveRoomMarathon(db, roomId) {
  if (!db || !roomId) return null;
  let links;
  try {
    links = db.prepare(`
      SELECT marathon_session_id AS sessionId FROM workspace_room_marathon_links
      WHERE room_id = ? ORDER BY linked_at DESC
    `).all(roomId);
  } catch {
    return null;
  }
  for (const { sessionId } of links) {
    const session = getMarathon(db, sessionId);
    if (session && ACTIVE_MARATHON_STATUSES.has(session.status)) return session;
  }
  return null;
}

/**
 * Derive an honest, human-readable activity summary for a marathon
 * session, straight from its real stored turns — NEVER a fabricated
 * "thinking..." animation. A session between ticks (the common case: it's
 * `running` but idle, waiting for its next scheduled tick or an explicit
 * `workspace.conkay-assist`/`agent_marathon.tick` call) is described by
 * its last REAL recorded action, not a live-in-progress claim it can't
 * back up — `tickMarathon` only persists a turn's tool calls after the
 * whole tick completes, so there is no honest "mid-tool-call" signal to
 * show between ticks; this reports what genuinely happened last instead.
 */
export function describeRoomConkayActivity(session) {
  if (!session) return null;
  const turns = Array.isArray(session.turns) ? session.turns : [];
  const lastTurn = turns.length ? turns[turns.length - 1] : null;
  const lastToolCalls = Array.isArray(lastTurn?.tool_calls) ? lastTurn.tool_calls : [];
  const lastToolNames = lastToolCalls.map((c) => c?.tool).filter(Boolean);

  let label;
  if (session.status === "pending") {
    label = "Queued to start";
  } else if (session.status === "paused") {
    label = "Paused — blocked, waiting on the team";
  } else if (session.status === "running" && lastToolNames.length) {
    label = `Working — last action: ${lastToolNames[lastToolNames.length - 1]}`;
  } else if (session.status === "running") {
    label = "Working on the shared objective";
  } else {
    label = session.status;
  }

  return {
    sessionId: session.id,
    status: session.status,
    label,
    totalTurns: session.total_turns,
    maxTurns: session.max_turns,
    updatedAt: session.updated_at,
    lastToolCalls: lastToolNames,
  };
}

/**
 * workspace.conkay-assist's real logic: start (or resume) an
 * agent-marathon.js session scoped to a room's shared objective + linked
 * goal tree — reusing startMarathon/tickMarathon/getMarathon end to end,
 * exactly like project-thread.js reuses them for single-user projects.
 * No new execution engine is built here.
 *
 * Requires the room to already carry BOTH an objective and a linked
 * goal_tree_id (set via `setRoomObjective` first) — a bare co-editing
 * room with no stated shared goal is not something ConKay should
 * autonomously start working on.
 *
 * The session's `allowedDomains` default to `CONKAY_ASSIST_DEFAULT_DOMAINS`
 * (the mig-379 governance envelope's allowlist) unless the caller
 * explicitly widens/narrows it — this is what keeps a room-scoped ConKay
 * session BOUNDED instead of getting the full unrestricted tool surface a
 * bare `agent_marathon.start` gets by default.
 *
 * If an active (non-terminal) session is already linked to this room,
 * that EXACT session is returned (`resumed: true`) instead of starting a
 * duplicate worker.
 */
export function startOrResumeConkayAssist(db, roomId, callerId, opts = {}) {
  if (!db || !roomId) return { ok: false, reason: "missing_inputs" };
  const uid = callerId ? String(callerId) : null;
  if (!uid) return { ok: false, reason: "no_user" };

  const room = getRoom(db, roomId);
  if (!room) return { ok: false, reason: "room_not_found" };
  if (!room.objective) return { ok: false, reason: "objective_not_set" };
  if (!room.goal_tree_id) return { ok: false, reason: "goal_tree_not_linked" };

  const existing = getActiveRoomMarathon(db, roomId);
  if (existing) {
    return {
      ok: true, resumed: true, sessionId: existing.id, status: existing.status,
      activity: describeRoomConkayActivity(existing),
    };
  }

  const gt = getGoalTree(db, room.goal_tree_id);
  const treeSummary = gt.ok
    ? `Linked goal tree "${gt.tree.title}" — ${gt.done}/${gt.total} subgoals done (${Math.round(gt.progress * 100)}% complete).`
    : `Linked goal tree ${room.goal_tree_id} is currently unavailable (${gt.reason}).`;
  const goal = [
    `You are helping a team of humans in the shared workspace room "${room.name}" work toward their stated objective:`,
    `"${room.objective}"`,
    treeSummary,
    "Use the goal tree (decomp domain) to see and advance concrete subgoals, and mint DTUs (dtu domain) to record real findings/output for the room. Stay scoped to this objective.",
  ].join("\n");

  const allowedDomains = Array.isArray(opts.allowedDomains) && opts.allowedDomains.length > 0
    ? opts.allowedDomains
    : [...CONKAY_ASSIST_DEFAULT_DOMAINS];

  const start = startMarathon(db, uid, {
    goal,
    title: `ConKay assist: ${room.name}`.slice(0, 80),
    maxTurns: opts.maxTurns,
    allowedDomains,
    budgetCap: opts.budgetCap,
  });
  if (!start.ok) return start;

  linkMarathonToRoom(db, roomId, start.sessionId);
  const session = getMarathon(db, start.sessionId);
  return {
    ok: true, resumed: false, sessionId: start.sessionId, status: session?.status || "pending",
    activity: describeRoomConkayActivity(session),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// V1.2 Wave B follow-on — per-subgoal assignment. Grounding-audit finding:
// team mode lets multiple humans co-edit a room's shared objective + linked
// goal tree, but the tree itself (goal-decomposition.js, mig 340) had no way
// for one human to claim a piece of it. Closed by mig 386's
// `goal_nodes.assigned_to_user_id` + the functions below.
//
// Authorization deliberately does NOT invent a durable room-membership/ACL
// table — this module's own header already declines to build one (MU2's
// presence is intentionally ephemeral; there is no honest durable "was ever
// in this room" signal to check against). Instead it uses the one REAL,
// LIVE signal that already exists: which sockets are currently joined to
// this room's `workspace:room` Socket.IO channel (`socket.join` in
// server.js's `room:join` handler, driven by useYjsDoc.ts on the client —
// every SharedWorkspaceRoom mount joins this exact room to receive Yjs sync,
// independent of the separate Awareness-level "appear offline" toggle, so a
// participant who's merely hidden from the presence list is still correctly
// counted here). The room's owner is always included even if not currently
// connected — mirrors every other "owner can always manage their own room"
// check in this file (setRoomObjective's tree-ownership gate, etc).
// ─────────────────────────────────────────────────────────────────────────

/** The Socket.IO room name useYjsDoc.ts's clients actually join for a given
 *  workspace room id (see server.js's `room:join` handler + this module's
 *  SHARED_WORKSPACE scope). */
function socketRoomFor(roomId) {
  return `${KNOWN_SCOPES.SHARED_WORKSPACE}:${roomId}`;
}

/**
 * The real, current participant set for a room: its durable owner, plus
 * every distinct `userId` presently attached to its live Socket.IO channel.
 * Best-effort — if realtime isn't reachable (no `io` yet, e.g. a cold-start
 * macro call or a headless test), this honestly degrades to "owner only"
 * rather than fabricating a wider roster.
 */
export function realParticipantIds(room) {
  const ids = new Set();
  if (room?.owner_id) ids.add(String(room.owner_id));
  try {
    const io = globalThis?.__CONCORD_REALTIME__?.io;
    if (io && room?.id) {
      const socketIds = io.sockets?.adapter?.rooms?.get(socketRoomFor(room.id));
      if (socketIds) {
        for (const sid of socketIds) {
          const uid = io.sockets?.sockets?.get(sid)?.data?.userId;
          if (uid) ids.add(String(uid));
        }
      }
    }
  } catch { /* best-effort — the owner-only fallback above is still honest */ }
  return ids;
}

/**
 * Assign (or, with `assigneeUserId` null/omitted, unassign) a subgoal node
 * in a room's linked goal tree. Both the caller AND the assignee must be
 * real current participants (`realParticipantIds` above) — this never
 * accepts an arbitrary user id, and never lets a non-participant reach into
 * a room's tree they're not actually part of.
 */
export function assignSubgoal(db, roomId, callerId, { nodeId, assigneeUserId } = {}) {
  if (!db || !roomId) return { ok: false, reason: "missing_inputs" };
  const uid = callerId ? String(callerId) : null;
  if (!uid) return { ok: false, reason: "no_user" };
  if (!nodeId) return { ok: false, reason: "missing_node_id" };

  const room = getRoom(db, roomId);
  if (!room) return { ok: false, reason: "room_not_found" };
  if (!room.goal_tree_id) return { ok: false, reason: "goal_tree_not_linked" };

  const participants = realParticipantIds(room);
  if (!participants.has(uid)) return { ok: false, reason: "not_a_participant" };

  let target = null;
  if (assigneeUserId !== null && assigneeUserId !== undefined && assigneeUserId !== "") {
    target = String(assigneeUserId);
    if (!participants.has(target)) return { ok: false, reason: "assignee_not_a_participant" };
  }

  const result = assignNode(db, { treeId: room.goal_tree_id, nodeId, assigneeUserId: target });
  if (!result.ok) return result;
  return { ok: true, roomId, nodeId, assignedToUserId: target };
}

export { NAME_MAX_LEN };
