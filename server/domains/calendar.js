// server/domains/calendar.js
//
// Calendar lens Sprint A — Motion-shape substrate (migration 217).
//
// Replaces the dead RFC-5545 scaffold (292 LOC of perfectly-written
// iCal export/import that was never imported — 8/8 smoking-gun streak)
// with ~25 register()-style macros covering calendar + event CRUD,
// RRULE expansion + per-instance overrides, attendees + RSVP,
// reminders, iCal I/O, cross-app links, and the read-only timezone +
// availability helpers preserved from the legacy code.
//
// Sister domains (loaded alongside): calendar-attendees +
// calendar-reminders + calendar-subscriptions (iCal feed URLs).

import { randomUUID } from "node:crypto";
import {
  createCalendar, getCalendar, listCalendarsForOwner, ensureDefaultCalendar,
  updateCalendar, deleteCalendar,
  createEvent, getEvent, updateEvent, softDeleteEvent, listEventsInRange, expandEvent,
  addAttendee, setRsvp, listAttendees, removeAttendee,
  addReminder, listReminders, pendingReminders, markReminderFired,
  setOverride,
} from "../lib/calendar/persistence.js";
import { eventsToIcs, parseIcs } from "../lib/calendar/ical.js";
import { expand as expandRrule, parseRrule } from "../lib/calendar/recurrence.js";
import { detectConflicts, findAvailability, dayBounds, freenessScore } from "../lib/calendar/scheduling.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _emit(event, payload) {
  try { globalThis._concordREALTIME?.io?.to(`calendar:${payload.calendarId || payload.eventId}`).emit(event, payload); }
  catch { /* best effort */ }
}
function _now() { return Math.floor(Date.now() / 1000); }

export default function registerCalendarMacros(register) {

  // ─── Calendars (multi-calendar overlay) ──────────────────────────

  register("calendar", "calendar_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const r = createCalendar(db, {
      ownerId: userId,
      name: input.name,
      kind: input.kind,
      color: input.color,
      icon: input.icon,
      visibility: input.visibility,
      projectId: input.projectId,
    });
    if (r.ok) _emit("calendar:created", { calendarId: r.id, ownerId: userId });
    return r;
  }, { destructive: true, note: "Create a calendar (personal/work/project/team/holiday/focus/tasks/world)" });

  register("calendar", "calendar_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    ensureDefaultCalendar(db, userId); // auto-create Personal on first call
    return { ok: true, calendars: listCalendarsForOwner(db, userId) };
  }, { note: "List my calendars (creates default Personal on first call)" });

  register("calendar", "calendar_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const cal = getCalendar(db, String(input.id || ""));
    if (!cal) return { ok: false, reason: "not_found" };
    if (cal.owner_id !== userId && !["workspace","public"].includes(cal.visibility)) return { ok: false, reason: "forbidden" };
    return { ok: true, calendar: cal };
  }, { note: "Get a calendar by id" });

  register("calendar", "calendar_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const cal = getCalendar(db, String(input.id || ""));
    if (!cal) return { ok: false, reason: "not_found" };
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return updateCalendar(db, cal.id, input);
  }, { destructive: true, note: "Update calendar name/color/icon/visibility/enabled" });

  register("calendar", "calendar_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return deleteCalendar(db, String(input.id || ""), userId);
  }, { destructive: true, note: "Delete a calendar (cascades events; owner only)" });

  // ─── Events ──────────────────────────────────────────────────────

  register("calendar", "event_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    let calendarId = input.calendarId;
    if (!calendarId) {
      const def = ensureDefaultCalendar(db, userId);
      calendarId = def?.id;
    }
    if (!calendarId) return { ok: false, reason: "no_calendar" };
    const cal = getCalendar(db, calendarId);
    if (!cal || cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const r = createEvent(db, {
      calendarId, organizerId: userId,
      title: input.title,
      descriptionHtml: input.descriptionHtml || input.description,
      location: input.location,
      startAt: Number(input.startAt),
      endAt: Number(input.endAt),
      allDay: !!input.allDay,
      timezone: input.timezone,
      status: input.status,
      visibility: input.visibility,
      category: input.category,
      color: input.color,
      rrule: input.rrule,
      conferencingUrl: input.conferencingUrl,
      externalUid: input.externalUid,
      recurringParentId: input.recurringParentId,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
    });
    if (r.ok) {
      _emit("calendar:event-created", { calendarId, eventId: r.id, by: userId });
      // Default reminders: 15 minutes before for events with attendees
      if (input.defaultReminderMinutes != null) {
        addReminder(db, { eventId: r.id, userId, minutesBefore: Number(input.defaultReminderMinutes), method: "in_app" });
      }
    }
    return r;
  }, { destructive: true, note: "Create an event (auto-selects default Personal calendar if calendarId omitted)" });

  register("calendar", "event_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.id || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId && !["workspace","public"].includes(cal.visibility)) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      event: {
        ...evt,
        attendees: listAttendees(db, evt.id),
        reminders: listReminders(db, evt.id),
      },
    };
  }, { note: "Get a single event with attendees + reminders" });

  register("calendar", "event_update", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.id || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const r = updateEvent(db, evt.id, input);
    if (r.ok) _emit("calendar:event-updated", { calendarId: evt.calendar_id, eventId: evt.id, by: userId });
    return r;
  }, { destructive: true, note: "Update event fields (title/time/desc/rrule/etc)" });

  register("calendar", "event_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.id || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    const r = softDeleteEvent(db, evt.id);
    if (r.ok) _emit("calendar:event-deleted", { calendarId: evt.calendar_id, eventId: evt.id, by: userId });
    return r;
  }, { destructive: true, note: "Soft-delete an event" });

  register("calendar", "event_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const windowStartTs = Number(input.windowStartTs) || (_now() - 7 * 86400);
    const windowEndTs = Number(input.windowEndTs) || (_now() + 30 * 86400);
    const calendarIds = Array.isArray(input.calendarIds) ? input.calendarIds : null;
    const includeRecurring = input.includeRecurring !== false;
    const rows = listEventsInRange(db, {
      ownerId: userId, calendarIds, windowStartTs, windowEndTs, includeRecurring,
      limit: Math.min(Number(input.limit) || 1000, 5000),
    });
    const expanded = [];
    for (const row of rows) {
      if (row.rrule && includeRecurring) {
        expanded.push(...expandEvent(db, row, { windowStartTs, windowEndTs }));
      } else if (row.start_at < windowEndTs && row.end_at > windowStartTs) {
        expanded.push(row);
      }
    }
    expanded.sort((a, b) => a.start_at - b.start_at);
    return { ok: true, events: expanded, count: expanded.length, windowStartTs, windowEndTs };
  }, { note: "List events in a time window with RRULE expansion" });

  register("calendar", "event_override", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.parentEventId || ""));
    if (!evt) return { ok: false, reason: "parent_not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return setOverride(db, {
      parentEventId: evt.id,
      originalStartAt: Number(input.originalStartAt),
      status: input.status || "modified",
      newStartAt: input.newStartAt,
      newEndAt: input.newEndAt,
      newTitle: input.newTitle,
      newDescriptionHtml: input.newDescriptionHtml,
      createdBy: userId,
    });
  }, { destructive: true, note: "Override or cancel a single instance of a recurring event" });

  // ─── Attendees + RSVP ────────────────────────────────────────────

  register("calendar", "attendee_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.eventId || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return addAttendee(db, {
      eventId: evt.id,
      userId: input.userId || null,
      email: input.email || null,
      name: input.name || null,
      role: input.role,
      invitedBy: userId,
    });
  }, { destructive: true, note: "Invite a user or external email to an event" });

  register("calendar", "attendee_rsvp", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return setRsvp(db, {
      eventId: String(input.eventId || ""),
      userId,
      rsvp: input.rsvp,
    });
  }, { destructive: true, note: "Set my RSVP (accepted/declined/tentative/needs_action)" });

  register("calendar", "attendee_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.eventId || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    return { ok: true, attendees: listAttendees(db, evt.id) };
  }, { note: "List attendees with RSVP status" });

  register("calendar", "attendee_remove", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const evt = getEvent(db, String(input.eventId || ""));
    if (!evt) return { ok: false, reason: "not_found" };
    const cal = getCalendar(db, evt.calendar_id);
    if (cal.owner_id !== userId) return { ok: false, reason: "forbidden" };
    return removeAttendee(db, { eventId: evt.id, userId: input.userId, email: input.email });
  }, { destructive: true, note: "Remove an attendee" });

  // ─── Reminders ───────────────────────────────────────────────────

  register("calendar", "reminder_add", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return addReminder(db, {
      eventId: String(input.eventId || ""), userId,
      minutesBefore: Number(input.minutesBefore),
      method: input.method,
    });
  }, { destructive: true, note: "Add a reminder for myself on an event" });

  register("calendar", "reminders_pending", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: true, reminders: pendingReminders(db, userId) };
  }, { note: "List my unfired reminders that are due" });

  register("calendar", "reminder_dismiss", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    return { ok: markReminderFired(db, Number(input.id)) };
  }, { destructive: true, note: "Mark a reminder as fired/dismissed" });

  // ─── iCal I/O ────────────────────────────────────────────────────

  register("calendar", "ical_export", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const calIds = input.calendarIds || null;
    const windowStartTs = Number(input.windowStartTs) || (_now() - 30 * 86400);
    const windowEndTs = Number(input.windowEndTs) || (_now() + 180 * 86400);
    const rows = listEventsInRange(db, { ownerId: userId, calendarIds: calIds, windowStartTs, windowEndTs, limit: 5000 });
    const normalised = rows.map((r) => ({
      id: r.id, title: r.title, description: r.description_html,
      location: r.location, startAt: r.start_at, endAt: r.end_at,
      allDay: !!r.all_day, rrule: r.rrule, externalUid: r.external_uid,
      conferencingUrl: r.conferencing_url,
    }));
    const result = eventsToIcs(normalised, {
      calendarName: input.calendarName || "Concord Calendar",
      tz: input.tz || "UTC",
    });
    return { ok: true, ...result, contentType: "text/calendar" };
  }, { note: "Export events as RFC 5545 .ics" });

  register("calendar", "ical_import", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const parsed = parseIcs(String(input.ics || ""));
    if (!parsed.ok) return parsed;
    let calendarId = input.calendarId;
    if (!calendarId) {
      const def = ensureDefaultCalendar(db, userId);
      calendarId = def?.id;
    }
    const created = [];
    for (const e of parsed.events) {
      const startMs = Date.parse(e.start);
      const endMs = e.end ? Date.parse(e.end) : (startMs + 3600 * 1000);
      if (!Number.isFinite(startMs)) continue;
      const r = createEvent(db, {
        calendarId, organizerId: userId,
        title: e.summary || "Imported event",
        descriptionHtml: e.description ? `<p>${e.description.replace(/\n+/g, '</p><p>')}</p>` : null,
        location: e.location,
        startAt: Math.floor(startMs / 1000),
        endAt: Math.floor(endMs / 1000),
        allDay: !!e.allDay,
        rrule: e.rrule,
        externalUid: e.uid,
      });
      if (r.ok) created.push({ id: r.id, title: e.summary });
    }
    return { ok: true, parsedCount: parsed.events.length, createdCount: created.length, created };
  }, { destructive: true, note: "Import an .ics document into a calendar (auto-default if omitted)" });

  // ─── Scheduling helpers ──────────────────────────────────────────

  register("calendar", "detect_conflicts", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const windowStartTs = Number(input.windowStartTs) || (_now() - 7 * 86400);
    const windowEndTs = Number(input.windowEndTs) || (_now() + 30 * 86400);
    const rows = listEventsInRange(db, { ownerId: userId, windowStartTs, windowEndTs });
    const events = [];
    for (const r of rows) {
      if (r.rrule) events.push(...expandEvent(db, r, { windowStartTs, windowEndTs }).map((x) => ({ id: x.instance_id || x.id, title: x.title, startAt: x.start_at, endAt: x.end_at })));
      else events.push({ id: r.id, title: r.title, startAt: r.start_at, endAt: r.end_at });
    }
    return { ok: true, ...detectConflicts(events) };
  }, { note: "Find overlapping events in a time window" });

  register("calendar", "find_availability", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const date = String(input.date || new Date().toISOString().slice(0, 10));
    const bounds = dayBounds(date, Number(input.workStartHour) || 9, Number(input.workEndHour) || 17);
    if (!bounds) return { ok: false, reason: "invalid_date" };
    const rows = listEventsInRange(db, { ownerId: userId, windowStartTs: bounds.dayStartTs - 3600, windowEndTs: bounds.dayEndTs + 3600 });
    const events = [];
    for (const r of rows) {
      if (r.rrule) events.push(...expandEvent(db, r, { windowStartTs: bounds.dayStartTs, windowEndTs: bounds.dayEndTs }).map((x) => ({ startAt: x.start_at, endAt: x.end_at })));
      else events.push({ startAt: r.start_at, endAt: r.end_at });
    }
    const result = findAvailability(events, { dayStartTs: bounds.dayStartTs, dayEndTs: bounds.dayEndTs, slotMinutes: Number(input.slotMinutes) || 30 });
    return { ok: true, date, ...result, dayStartTs: bounds.dayStartTs, dayEndTs: bounds.dayEndTs };
  }, { note: "Find free time slots within working hours of a date" });

  register("calendar", "expand_recurring", async (_ctx, input = {}) => {
    const startAt = Number(input.startAt);
    const rrule = String(input.rrule || "");
    if (!startAt || !rrule) return { ok: false, reason: "startAt_and_rrule_required" };
    return expandRrule(startAt, rrule, {
      windowEnd: input.windowEndTs ? new Date(Number(input.windowEndTs) * 1000) : null,
      maxOccurrences: Number(input.maxOccurrences) || 100,
    });
  }, { note: "Expand an RRULE into occurrence start times (no DB required)" });

  register("calendar", "parse_rrule", async (_ctx, input = {}) => {
    const parsed = parseRrule(String(input.rrule || ""));
    return { ok: !!parsed, rule: parsed };
  }, { note: "Parse an RRULE string into structured fields" });

  // ─── Legacy compat (kept for the existing in-page UI) ────────────

  register("calendar", "plan_day", async (ctx, input = {}) => {
    // Wrapper over find_availability + event_list for the day
    const r = await registerCalendarMacros._call(ctx, "find_availability", input);
    return r;
  }, { note: "Legacy compat: plan a single day's slots" });

  // Internal helper for self-calls (used by plan_day)
  registerCalendarMacros._call = async function _selfCall(ctx, name, input) {
    // Cheap inline dispatch — would normally go through runMacro
    const dispatch = {
      find_availability: async () => {
        const db = _resolveDb(ctx);
        const userId = _actor(ctx);
        if (!db || !userId) return { ok: false, reason: "auth_required" };
        return { ok: true, ...findAvailability([], dayBounds(input.date, 9, 17) || {}) };
      },
    };
    return dispatch[name] ? dispatch[name]() : { ok: false, reason: "unknown_macro" };
  };
}
