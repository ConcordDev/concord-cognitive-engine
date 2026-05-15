// server/lib/session-access.js
//
// Defense-in-depth check for STATE.sessions reads/writes. Refuses
// cross-user session access while staying permissive for anonymous
// (no-ownerId) sessions, which are per-browser + localStorage-scoped.
//
// Pre-extraction this lived inline in server.js. The audit-4 sweep
// found 4 more session-access endpoints across routes/{chat,domain,
// system}.js that ALSO needed the check but couldn't import it from
// server.js. Pulling to a shared module so every route can gate.
//
// Usage:
//   import { assertSessionAccessible } from "../lib/session-access.js";
//   const sess = STATE.sessions.get(sessionId);
//   if (!assertSessionAccessible(sess, req.user?.id)) {
//     return res.status(403).json({ ok: false, error: "session_forbidden" });
//   }
//
// Sessions created before commit d15cc1c won't have ownerId — for
// those we fall back to permissive (legacy) behavior so existing chats
// keep working. New sessions all carry ownerId.

export function assertSessionAccessible(sess, userId) {
  if (!sess) return false;
  if (!sess.ownerId) return true; // legacy / anonymous session — pre-ownership-tracking
  if (!userId) return false;
  if (sess.ownerId === userId) return true;
  if (sess.participantIds?.has?.(userId)) return true;
  return false;
}
