// server/domains/whiteboard-perms.js
//
// Whiteboard Sprint B Item #12 — granular permissions.
// Builds on Sprint A's persistence.inviteParticipant (which the legacy
// whiteboard.js#participant-invite already wraps for admin+) by adding
// list / update-role / revoke macros so the UI can manage the team.

import { inviteParticipant, revokeParticipant, listParticipants, hasRole, getRole } from "../lib/whiteboard/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerWhiteboardPermsMacros(register) {
  register("whiteboard", "perms_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!hasRole(db, boardId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    return { ok: true, participants: listParticipants(db, boardId), myRole: getRole(db, boardId, userId) };
  }, { note: "List participants + their roles for a board" });

  register("whiteboard", "perms_invite", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const targetUserId = String(input.userId || "");
    const role = String(input.role || "editor");
    if (!boardId || !targetUserId) return { ok: false, reason: "boardId_and_userId_required" };
    if (!hasRole(db, boardId, userId, "admin")) return { ok: false, reason: "forbidden" };
    return inviteParticipant(db, { boardId, userId: targetUserId, role, invitedBy: userId });
  }, { destructive: true, note: "Invite a user to a board (admin+)" });

  register("whiteboard", "perms_update_role", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const targetUserId = String(input.userId || "");
    const role = String(input.role || "");
    if (!boardId || !targetUserId || !role) return { ok: false, reason: "missing_args" };
    if (!hasRole(db, boardId, userId, "admin")) return { ok: false, reason: "forbidden" };
    // Can't reassign owner (owner role only changes via explicit transfer);
    // can't demote an owner via this path either.
    if (role === "owner") return { ok: false, reason: "use_perms_transfer_owner" };
    if (getRole(db, boardId, targetUserId) === "owner") return { ok: false, reason: "cannot_demote_owner" };
    return inviteParticipant(db, { boardId, userId: targetUserId, role, invitedBy: userId });
  }, { destructive: true, note: "Update a participant's role (admin+; owner role excluded)" });

  register("whiteboard", "perms_revoke", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const targetUserId = String(input.userId || "");
    if (!boardId || !targetUserId) return { ok: false, reason: "missing_args" };
    // Admin+ can revoke anyone except owner; users can revoke themselves.
    if (targetUserId !== userId && !hasRole(db, boardId, userId, "admin")) return { ok: false, reason: "forbidden" };
    return revokeParticipant(db, { boardId, userId: targetUserId });
  }, { destructive: true, note: "Revoke a participant (admin+, or user revoking self; never the owner)" });
}
