// server/lib/event-rsvp.js
//
// Phase V4 — durable event RSVPs + reminder sweep.

import logger from "../logger.js";

export function rsvpToEvent(db, opts) {
  if (!db) return { ok: false, error: "no_db" };
  const eventId = String(opts?.eventId || "").trim();
  const userId = String(opts?.userId || "").trim();
  if (!eventId || !userId) return { ok: false, error: "missing_inputs" };
  const role = ["attendee", "interested", "host"].includes(opts?.role) ? opts.role : "attendee";
  const worldId = opts?.worldId || null;
  const startsAt = Number(opts?.startsAt) || null;
  const title = String(opts?.title || "").slice(0, 120);

  try {
    db.prepare(`
      INSERT INTO world_event_rsvps (event_id, user_id, role, world_id, starts_at, title, rsvp_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(event_id, user_id) DO UPDATE SET
        role = excluded.role,
        starts_at = COALESCE(excluded.starts_at, starts_at),
        title = COALESCE(NULLIF(excluded.title, ''), title)
    `).run(eventId, userId, role, worldId, startsAt, title);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function cancelRsvp(db, eventId, userId) {
  if (!db || !eventId || !userId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`DELETE FROM world_event_rsvps WHERE event_id = ? AND user_id = ?`).run(eventId, userId);
    return r.changes > 0 ? { ok: true } : { ok: false, error: "not_rsvpd" };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listMyUpcomingEvents(db, userId, sinceMs = 0) {
  if (!db || !userId) return [];
  const cutoff = Math.floor((Date.now() - sinceMs) / 1000);
  try {
    return db.prepare(`
      SELECT event_id AS eventId, role, world_id AS worldId, starts_at AS startsAt, title, rsvp_at AS rsvpAt
      FROM world_event_rsvps
      WHERE user_id = ? AND (starts_at IS NULL OR starts_at >= ?)
      ORDER BY starts_at ASC NULLS LAST
    `).all(userId, cutoff);
  } catch {
    return [];
  }
}

/**
 * Reminder sweep — fires `event:reminder` realtime to every user whose
 * RSVP'd event starts in the next 10min and hasn't been reminded.
 */
export function sweepEventReminders(db) {
  if (!db) return { reminded: 0 };
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = now + 600;
  let reminded = 0;
  try {
    const rows = db.prepare(`
      SELECT event_id, user_id, world_id, starts_at, title
      FROM world_event_rsvps
      WHERE starts_at IS NOT NULL
        AND starts_at > ?
        AND starts_at <= ?
        AND reminded_at IS NULL
      LIMIT 200
    `).all(now, windowEnd);
    for (const r of rows) {
      try {
        globalThis._concordRealtimeEmit?.("event:reminder", {
          eventId: r.event_id,
          worldId: r.world_id,
          startsAt: r.starts_at,
          title: r.title,
        }, { targetUserId: r.user_id });
      } catch { /* emit best-effort */ }
      try {
        db.prepare(`
          UPDATE world_event_rsvps SET reminded_at = unixepoch()
          WHERE event_id = ? AND user_id = ?
        `).run(r.event_id, r.user_id);
      } catch { /* update best-effort */ }
      reminded++;
    }
  } catch (err) {
    logger.debug?.("event-rsvp", "sweep_failed", { error: err?.message });
  }
  return { reminded };
}
