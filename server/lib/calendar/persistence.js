// server/lib/calendar/persistence.js
//
// Calendar Sprint A — DB persistence layer for migration 217.
// Helpers used by domains/calendar.js (the new register()-style
// rewrite) + the future sync / agent / mint domains.

import { randomUUID } from "node:crypto";
import { expand as expandRrule } from "./recurrence.js";

const TITLE_MAX = 240;
const DESC_MAX = 100_000;

function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

// ─── Calendars (multi-calendar overlay) ──────────────────────────

export function createCalendar(db, { ownerId, name, kind = "personal", color = "#22d3ee", icon = null, visibility = "private", projectId = null, sourceKind = null, sourceUri = null }) {
  if (!db || !ownerId || !name) return { ok: false, reason: "missing_args" };
  const id = `cal:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO calendars (id, owner_id, name, kind, color, icon, visibility, project_id, source_kind, source_uri, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, String(name).slice(0, 120), kind, color, icon, visibility, projectId, sourceKind, sourceUri, _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getCalendar(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM calendars WHERE id = ?`).get(id);
  return row ? { ...row, settings: _safeJson(row.settings_json, {}) } : null;
}

export function listCalendarsForOwner(db, ownerId) {
  if (!db || !ownerId) return [];
  return db.prepare(`SELECT * FROM calendars WHERE owner_id = ? ORDER BY enabled DESC, updated_at DESC`).all(ownerId);
}

export function ensureDefaultCalendar(db, ownerId) {
  if (!db || !ownerId) return null;
  const existing = db.prepare(`SELECT * FROM calendars WHERE owner_id = ? AND kind = 'personal' ORDER BY created_at LIMIT 1`).get(ownerId);
  if (existing) return existing;
  const r = createCalendar(db, { ownerId, name: "Personal", kind: "personal" });
  return r.ok ? getCalendar(db, r.id) : null;
}

export function updateCalendar(db, id, patch = {}) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const updates = [];
  const args = [];
  if (patch.name !== undefined)       { updates.push("name = ?"); args.push(String(patch.name).slice(0, 120)); }
  if (patch.color !== undefined)      { updates.push("color = ?"); args.push(patch.color); }
  if (patch.icon !== undefined)       { updates.push("icon = ?"); args.push(patch.icon); }
  if (patch.visibility !== undefined && ["private","team","workspace","public"].includes(patch.visibility)) {
    updates.push("visibility = ?"); args.push(patch.visibility);
  }
  if (patch.enabled !== undefined)    { updates.push("enabled = ?"); args.push(patch.enabled ? 1 : 0); }
  if (patch.settings !== undefined)   { updates.push("settings_json = ?"); args.push(JSON.stringify(patch.settings || {})); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);
  db.prepare(`UPDATE calendars SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function deleteCalendar(db, id, actorId) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const cal = db.prepare(`SELECT owner_id FROM calendars WHERE id = ?`).get(id);
  if (!cal) return { ok: false, reason: "not_found" };
  if (cal.owner_id !== actorId) return { ok: false, reason: "forbidden" };
  db.prepare(`DELETE FROM calendars WHERE id = ?`).run(id);
  return { ok: true };
}

// ─── Events ──────────────────────────────────────────────────────

export function createEvent(db, {
  calendarId, organizerId, title, descriptionHtml = null, location = null,
  startAt, endAt, allDay = false, timezone = null, status = "confirmed",
  visibility = "default", category = null, color = null, rrule = null,
  conferencingUrl = null, externalUid = null, recurringParentId = null, metaJson = null,
}) {
  if (!db || !calendarId || !organizerId || !title) return { ok: false, reason: "missing_args" };
  if (typeof startAt !== "number" || typeof endAt !== "number") return { ok: false, reason: "startAt_endAt_required_seconds" };
  if (endAt < startAt) return { ok: false, reason: "endAt_before_startAt" };
  const id = `evt:${randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO calendar_events
        (id, calendar_id, organizer_id, title, description_html, location, start_at, end_at,
         all_day, timezone, status, visibility, category, color, rrule, recurring_parent_id,
         external_uid, conferencing_url, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, calendarId, organizerId,
      String(title).slice(0, TITLE_MAX),
      descriptionHtml ? String(descriptionHtml).slice(0, DESC_MAX) : null,
      location ? String(location).slice(0, 240) : null,
      Math.floor(startAt), Math.floor(endAt),
      allDay ? 1 : 0, timezone, status, visibility, category, color,
      rrule ? String(rrule).slice(0, 1000) : null,
      recurringParentId, externalUid, conferencingUrl, metaJson,
      _now(), _now());
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getEvent(db, id) {
  if (!db || !id) return null;
  const row = db.prepare(`SELECT * FROM calendar_events WHERE id = ? AND deleted_at IS NULL`).get(id);
  return row ? { ...row, meta: _safeJson(row.meta_json, {}) } : null;
}

export function updateEvent(db, id, patch = {}) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const updates = [];
  const args = [];
  if (patch.title !== undefined)            { updates.push("title = ?"); args.push(String(patch.title).slice(0, TITLE_MAX)); }
  if (patch.descriptionHtml !== undefined)  { updates.push("description_html = ?"); args.push(patch.descriptionHtml ? String(patch.descriptionHtml).slice(0, DESC_MAX) : null); }
  if (patch.location !== undefined)         { updates.push("location = ?"); args.push(patch.location ? String(patch.location).slice(0, 240) : null); }
  if (patch.startAt !== undefined)          { updates.push("start_at = ?"); args.push(Math.floor(patch.startAt)); }
  if (patch.endAt !== undefined)            { updates.push("end_at = ?"); args.push(Math.floor(patch.endAt)); }
  if (patch.allDay !== undefined)           { updates.push("all_day = ?"); args.push(patch.allDay ? 1 : 0); }
  if (patch.timezone !== undefined)         { updates.push("timezone = ?"); args.push(patch.timezone); }
  if (patch.status !== undefined && ["confirmed","tentative","cancelled"].includes(patch.status)) {
    updates.push("status = ?"); args.push(patch.status);
  }
  if (patch.visibility !== undefined && ["default","public","busy_only","private"].includes(patch.visibility)) {
    updates.push("visibility = ?"); args.push(patch.visibility);
  }
  if (patch.category !== undefined)         { updates.push("category = ?"); args.push(patch.category); }
  if (patch.color !== undefined)            { updates.push("color = ?"); args.push(patch.color); }
  if (patch.rrule !== undefined)            { updates.push("rrule = ?"); args.push(patch.rrule ? String(patch.rrule).slice(0, 1000) : null); }
  if (patch.conferencingUrl !== undefined)  { updates.push("conferencing_url = ?"); args.push(patch.conferencingUrl); }
  if (patch.metaJson !== undefined)         { updates.push("meta_json = ?"); args.push(patch.metaJson); }
  if (updates.length === 0) return { ok: false, reason: "nothing_to_update" };
  updates.push("updated_at = ?"); args.push(_now());
  args.push(id);
  db.prepare(`UPDATE calendar_events SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function softDeleteEvent(db, id) {
  if (!db || !id) return { ok: false, reason: "missing_args" };
  const r = db.prepare(`UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(_now(), _now(), id);
  return { ok: r.changes > 0 };
}

/**
 * Range query — returns base events whose [start_at, end_at] overlaps
 * [windowStart, windowEnd]. Recurring events whose RRULE could produce
 * occurrences in the window are also returned (caller expands them).
 *
 * calendarIds optional; default = all of owner's enabled calendars.
 */
export function listEventsInRange(db, { ownerId, calendarIds = null, windowStartTs, windowEndTs, includeRecurring = true, limit = 1000 }) {
  if (!db || !ownerId || !windowStartTs || !windowEndTs) return [];
  let calIds = calendarIds;
  if (!calIds) {
    calIds = db.prepare(`SELECT id FROM calendars WHERE owner_id = ? AND enabled = 1`).all(ownerId).map((r) => r.id);
  }
  if (calIds.length === 0) return [];
  const placeholders = calIds.map(() => "?").join(", ");
  // Non-recurring + recurring (no rrule OR rrule started before window end + no until-before-window-start).
  // Simplification: pull anything that could possibly fire in window; caller expands.
  const rows = db.prepare(`
    SELECT * FROM calendar_events
    WHERE calendar_id IN (${placeholders})
      AND deleted_at IS NULL
      AND (
        (rrule IS NULL AND start_at < ? AND end_at > ?)
        OR (rrule IS NOT NULL AND start_at < ?)
      )
    ORDER BY start_at ASC
    LIMIT ?
  `).all(...calIds, windowEndTs, windowStartTs, windowEndTs, Math.min(limit, 5000));
  return rows;
}

/**
 * Expand a recurring event into all instances within [windowStart, windowEnd].
 * Handles overrides via calendar_event_overrides table.
 */
export function expandEvent(db, event, { windowStartTs, windowEndTs }) {
  if (!event?.rrule) {
    if (event.start_at < windowEndTs && event.end_at > windowStartTs) {
      return [{ ...event, original_start_at: event.start_at }];
    }
    return [];
  }
  const result = expandRrule(event.start_at, event.rrule, {
    windowStart: new Date(windowStartTs * 1000),
    windowEnd: new Date(windowEndTs * 1000),
    maxOccurrences: 500,
  });
  if (!result.ok) return [];
  const duration = event.end_at - event.start_at;
  const overrides = db.prepare(`SELECT * FROM calendar_event_overrides WHERE parent_event_id = ?`).all(event.id);
  const overrideMap = new Map(overrides.map((o) => [o.original_start_at, o]));
  const expanded = [];
  for (const occ of result.occurrences) {
    const orig = overrideMap.get(occ.start);
    if (orig?.status === "cancelled") continue;
    const startAt = orig?.new_start_at ?? occ.start;
    const endAt = orig?.new_end_at ?? (startAt + duration);
    expanded.push({
      ...event,
      start_at: startAt,
      end_at: endAt,
      title: orig?.new_title ?? event.title,
      description_html: orig?.new_description_html ?? event.description_html,
      original_start_at: occ.start,
      instance_id: `${event.id}:${occ.start}`,
      is_recurring_instance: true,
    });
  }
  return expanded;
}

// ─── Attendees ───────────────────────────────────────────────────

export function addAttendee(db, { eventId, userId = null, email = null, name = null, role = "required", invitedBy = null }) {
  if (!db || !eventId || (!userId && !email)) return { ok: false, reason: "userId_or_email_required" };
  try {
    db.prepare(`
      INSERT INTO calendar_attendees (event_id, user_id, email, name, role, invited_by, invited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, COALESCE(user_id, email)) DO UPDATE SET role = excluded.role, name = excluded.name
    `).run(eventId, userId, email, name, role, invitedBy, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function setRsvp(db, { eventId, userId, rsvp }) {
  if (!db || !eventId || !userId) return { ok: false, reason: "missing_args" };
  if (!["needs_action","accepted","declined","tentative"].includes(rsvp)) return { ok: false, reason: "invalid_rsvp" };
  const r = db.prepare(`
    UPDATE calendar_attendees SET rsvp = ?, responded_at = ? WHERE event_id = ? AND user_id = ?
  `).run(rsvp, _now(), eventId, userId);
  return { ok: r.changes > 0 };
}

export function listAttendees(db, eventId) {
  if (!db || !eventId) return [];
  return db.prepare(`SELECT * FROM calendar_attendees WHERE event_id = ? ORDER BY invited_at`).all(eventId);
}

export function removeAttendee(db, { eventId, userId = null, email = null }) {
  if (!db || !eventId) return { ok: false, reason: "missing_args" };
  const r = userId
    ? db.prepare(`DELETE FROM calendar_attendees WHERE event_id = ? AND user_id = ?`).run(eventId, userId)
    : db.prepare(`DELETE FROM calendar_attendees WHERE event_id = ? AND email = ?`).run(eventId, email);
  return { ok: r.changes > 0 };
}

// ─── Reminders ───────────────────────────────────────────────────

export function addReminder(db, { eventId, userId, minutesBefore, method = "push" }) {
  if (!db || !eventId || !userId || minutesBefore == null) return { ok: false, reason: "missing_args" };
  const evt = db.prepare(`SELECT start_at FROM calendar_events WHERE id = ?`).get(eventId);
  if (!evt) return { ok: false, reason: "event_not_found" };
  const fireAt = evt.start_at - Math.floor(minutesBefore) * 60;
  const r = db.prepare(`
    INSERT INTO calendar_reminders (event_id, user_id, minutes_before, method, fire_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, userId, Math.floor(minutesBefore), method, fireAt, _now());
  return { ok: true, id: r.lastInsertRowid, fireAt };
}

export function listReminders(db, eventId) {
  if (!db) return [];
  return db.prepare(`SELECT * FROM calendar_reminders WHERE event_id = ? ORDER BY minutes_before DESC`).all(eventId);
}

export function pendingReminders(db, userId, cutoffTs = _now()) {
  if (!db) return [];
  return db.prepare(`
    SELECT r.*, e.title, e.start_at, e.calendar_id
    FROM calendar_reminders r
    INNER JOIN calendar_events e ON e.id = r.event_id
    WHERE r.user_id = ? AND r.fired_at IS NULL AND r.fire_at <= ? AND e.deleted_at IS NULL
    ORDER BY r.fire_at ASC LIMIT 100
  `).all(userId, cutoffTs);
}

export function markReminderFired(db, id) {
  return db.prepare(`UPDATE calendar_reminders SET fired_at = ? WHERE id = ?`).run(_now(), id).changes > 0;
}

// ─── Overrides (per-instance recurring edits) ───────────────────

export function setOverride(db, { parentEventId, originalStartAt, status, newStartAt = null, newEndAt = null, newTitle = null, newDescriptionHtml = null, createdBy }) {
  if (!db || !parentEventId || !originalStartAt) return { ok: false, reason: "missing_args" };
  try {
    db.prepare(`
      INSERT INTO calendar_event_overrides
        (parent_event_id, original_start_at, status, new_start_at, new_end_at, new_title, new_description_html, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(parent_event_id, original_start_at) DO UPDATE SET
        status = excluded.status,
        new_start_at = excluded.new_start_at,
        new_end_at = excluded.new_end_at,
        new_title = excluded.new_title,
        new_description_html = excluded.new_description_html,
        created_at = excluded.created_at
    `).run(parentEventId, Math.floor(originalStartAt), status,
      newStartAt ? Math.floor(newStartAt) : null,
      newEndAt ? Math.floor(newEndAt) : null,
      newTitle, newDescriptionHtml, createdBy, _now());
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}
