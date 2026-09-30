// server/lib/concordia-session.js
//
// MVP shared server-authoritative session. Not Netcode/Mirror/FishNet —
// two (or more) /unity-ws clients join the same world room and see the
// same member list. Presence is the existing gateway room:join surface.

/** @type {Map<string, Map<string, {joinedAt:number, x:number, z:number}>>} */
const sessions = new Map();

export function joinSession(worldId, userId, meta = {}) {
  const wid = String(worldId || "concordia-hub");
  const uid = String(userId || "").slice(0, 128);
  if (!uid) return { ok: false, reason: "missing_user" };
  if (!sessions.has(wid)) sessions.set(wid, new Map());
  const room = sessions.get(wid);
  room.set(uid, { joinedAt: Date.now(), x: Number(meta.x || 0), z: Number(meta.z || 0) });
  return snapshotSession(wid);
}

export function leaveSession(worldId, userId) {
  const room = sessions.get(String(worldId || "concordia-hub"));
  if (room) room.delete(String(userId || ""));
  return snapshotSession(worldId);
}

export function snapshotSession(worldId) {
  const wid = String(worldId || "concordia-hub");
  const room = sessions.get(wid);
  const members = room ? [...room.entries()].map(([id, m]) => ({ id, ...m })) : [];
  return { ok: true, worldId: wid, members, count: members.length, authority: "concordia-session" };
}

export function resetSessionsForTest() {
  sessions.clear();
}

export default { joinSession, leaveSession, snapshotSession, resetSessionsForTest };
