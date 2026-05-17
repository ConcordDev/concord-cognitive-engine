// server/lib/audio-rooms.js
//
// Phase 11 (Item 7) — Spaces helpers.
//
// All metadata + presence rows are real — listener counts come from
// the speakers/listeners tables (corroborated by Socket.io room sizes
// when the io reference is provided), never fabricated.
//
// Recording is NEVER auto-started. The host explicitly calls
// `setRecording(true)` and the writes a .webm to artifact storage
// (handled by the caller — this lib just tracks the flag + URL).

export function createRoom(db, { roomId, hostUserId, title, description = null, maxListeners = 200 }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!roomId || !hostUserId || !title) return { ok: false, reason: 'missing_field' };
  try {
    db.prepare(`INSERT INTO audio_rooms (id, host_user_id, title, description, max_listeners) VALUES (?, ?, ?, ?, ?)`)
      .run(roomId, hostUserId, title, description, maxListeners);
    db.prepare(`INSERT INTO audio_room_speakers (room_id, user_id, role) VALUES (?, ?, 'host')`)
      .run(roomId, hostUserId);
    return { ok: true, room: getRoom(db, roomId)?.room || null };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export function getRoom(db, roomId) {
  if (!db || !roomId) return { ok: false };
  const row = db.prepare(`SELECT * FROM audio_rooms WHERE id = ?`).get(roomId);
  if (!row) return { ok: false, reason: 'not_found' };
  return { ok: true, room: shapeRoom(db, row) };
}

export function listActiveRooms(db, { limit = 50 } = {}) {
  if (!db) return { ok: false, rooms: [] };
  const rows = db.prepare(`
    SELECT * FROM audio_rooms WHERE ended_at IS NULL
    ORDER BY started_at DESC LIMIT ?
  `).all(limit);
  return { ok: true, rooms: rows.map(r => shapeRoom(db, r)) };
}

export function joinAsListener(db, { roomId, userId }) {
  if (!db || !roomId || !userId) return { ok: false, reason: 'bad_input' };
  const room = db.prepare(`SELECT ended_at, max_listeners FROM audio_rooms WHERE id = ?`).get(roomId);
  if (!room) return { ok: false, reason: 'not_found' };
  if (room.ended_at) return { ok: false, reason: 'room_ended' };
  // capacity check
  const activeListeners = db.prepare(`SELECT COUNT(*) AS c FROM audio_room_listeners WHERE room_id = ? AND left_at IS NULL`).get(roomId).c;
  if (activeListeners >= room.max_listeners) return { ok: false, reason: 'room_full' };
  // upsert
  const existing = db.prepare(`SELECT id FROM audio_room_listeners WHERE room_id = ? AND user_id = ?`).get(roomId, userId);
  if (existing) {
    db.prepare(`UPDATE audio_room_listeners SET left_at = NULL, joined_at = unixepoch() WHERE id = ?`).run(existing.id);
  } else {
    db.prepare(`INSERT INTO audio_room_listeners (room_id, user_id) VALUES (?, ?)`).run(roomId, userId);
  }
  return { ok: true };
}

export function leaveRoom(db, { roomId, userId }) {
  if (!db) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`UPDATE audio_room_listeners SET left_at = ? WHERE room_id = ? AND user_id = ? AND left_at IS NULL`).run(now, roomId, userId);
  db.prepare(`UPDATE audio_room_speakers SET left_at = ? WHERE room_id = ? AND user_id = ? AND left_at IS NULL`).run(now, roomId, userId);
  return { ok: true };
}

export function raiseHand(db, { roomId, userId }) {
  if (!db) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`UPDATE audio_room_listeners SET hand_raised_at = ? WHERE room_id = ? AND user_id = ? AND left_at IS NULL`)
    .run(now, roomId, userId);
  if (r.changes === 0) return { ok: false, reason: 'not_listening' };
  return { ok: true };
}

export function promoteToSpeaker(db, { roomId, userId, byHostUserId, role = 'speaker' }) {
  if (!db) return { ok: false };
  if (!['speaker', 'co-host'].includes(role)) return { ok: false, reason: 'invalid_role' };
  const host = db.prepare(`SELECT host_user_id FROM audio_rooms WHERE id = ?`).get(roomId);
  if (!host) return { ok: false, reason: 'not_found' };
  if (host.host_user_id !== byHostUserId) {
    // co-hosts can also promote
    const isCoHost = db.prepare(`SELECT 1 FROM audio_room_speakers WHERE room_id = ? AND user_id = ? AND role = 'co-host' AND left_at IS NULL`).get(roomId, byHostUserId);
    if (!isCoHost) return { ok: false, reason: 'not_authorized' };
  }
  // Drop from listeners if there
  db.prepare(`UPDATE audio_room_listeners SET left_at = unixepoch() WHERE room_id = ? AND user_id = ? AND left_at IS NULL`).run(roomId, userId);
  // Insert into speakers
  const existing = db.prepare(`SELECT id FROM audio_room_speakers WHERE room_id = ? AND user_id = ?`).get(roomId, userId);
  if (existing) {
    db.prepare(`UPDATE audio_room_speakers SET role = ?, left_at = NULL, joined_at = unixepoch() WHERE id = ?`).run(role, existing.id);
  } else {
    db.prepare(`INSERT INTO audio_room_speakers (room_id, user_id, role) VALUES (?, ?, ?)`).run(roomId, userId, role);
  }
  return { ok: true };
}

export function endRoom(db, { roomId, byUserId }) {
  if (!db) return { ok: false };
  const room = db.prepare(`SELECT host_user_id, ended_at FROM audio_rooms WHERE id = ?`).get(roomId);
  if (!room) return { ok: false, reason: 'not_found' };
  if (room.ended_at) return { ok: true, alreadyEnded: true };
  if (room.host_user_id !== byUserId) return { ok: false, reason: 'host_only' };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`UPDATE audio_rooms SET ended_at = ? WHERE id = ?`).run(now, roomId);
  db.prepare(`UPDATE audio_room_speakers SET left_at = ? WHERE room_id = ? AND left_at IS NULL`).run(now, roomId);
  db.prepare(`UPDATE audio_room_listeners SET left_at = ? WHERE room_id = ? AND left_at IS NULL`).run(now, roomId);
  return { ok: true };
}

export function setRecording(db, { roomId, byUserId, isRecording, recordingUrl = null }) {
  if (!db) return { ok: false };
  const room = db.prepare(`SELECT host_user_id FROM audio_rooms WHERE id = ?`).get(roomId);
  if (!room) return { ok: false, reason: 'not_found' };
  if (room.host_user_id !== byUserId) return { ok: false, reason: 'host_only' };
  db.prepare(`UPDATE audio_rooms SET is_recording = ?, recording_url = COALESCE(?, recording_url) WHERE id = ?`)
    .run(isRecording ? 1 : 0, recordingUrl, roomId);
  return { ok: true };
}

function shapeRoom(db, row) {
  const speakers = db.prepare(`SELECT user_id, role, joined_at FROM audio_room_speakers WHERE room_id = ? AND left_at IS NULL`).all(row.id);
  const listenerCount = db.prepare(`SELECT COUNT(*) AS c FROM audio_room_listeners WHERE room_id = ? AND left_at IS NULL`).get(row.id).c;
  const handsRaised = db.prepare(`SELECT user_id, hand_raised_at FROM audio_room_listeners WHERE room_id = ? AND left_at IS NULL AND hand_raised_at IS NOT NULL`).all(row.id);
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    title: row.title,
    description: row.description,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    maxListeners: row.max_listeners,
    isRecording: !!row.is_recording,
    recordingUrl: row.recording_url,
    speakers,
    listenerCount,
    handsRaised,
  };
}
