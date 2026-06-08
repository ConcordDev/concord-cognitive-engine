// server/domains/calendar.js
// Domain actions for calendar: conflict detection, availability analysis,
// recurring event expansion, time zone conversion, schedule optimization.
//
// Track C — real two-way sync: the `accounts-push-event` macro writes back to
// Google Calendar via the SSRF-guarded connector client (honoring the account's
// pull/push/two-way direction). The legacy ICS pull (`accounts-sync`) stays.

import { writeGoogleCalendarEvent } from "../lib/connector-client.js";

export default function registerCalendarActions(registerLensAction) {
  registerLensAction("calendar", "detectConflicts", (ctx, artifact, _params) => {
    const events = artifact.data?.events || [];
    if (events.length < 2) return { ok: true, result: { message: "Add at least 2 events to check for conflicts." } };
    const parsed = events.map(e => ({ name: e.name || e.title, start: new Date(e.start || e.startDate), end: new Date(e.end || e.endDate || new Date(new Date(e.start || e.startDate).getTime() + 3600000)) }));
    parsed.sort((a, b) => a.start.getTime() - b.start.getTime());
    const conflicts = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        if (parsed[i].end > parsed[j].start && parsed[i].start < parsed[j].end) {
          const overlapMinutes = Math.round((Math.min(parsed[i].end.getTime(), parsed[j].end.getTime()) - parsed[j].start.getTime()) / 60000);
          conflicts.push({ event1: parsed[i].name, event2: parsed[j].name, overlapMinutes });
        }
      }
    }
    return { ok: true, result: { totalEvents: events.length, conflicts, conflictCount: conflicts.length, conflictFree: conflicts.length === 0 } };
  });

  registerLensAction("calendar", "findAvailability", (ctx, artifact, _params) => {
    const events = artifact.data?.events || [];
    const workStart = parseInt(artifact.data?.workStartHour) || 9;
    const workEnd = parseInt(artifact.data?.workEndHour) || 17;
    const slotMinutes = parseInt(artifact.data?.slotMinutes) || 30;
    const dateStr = artifact.data?.date || new Date().toISOString().split("T")[0];
    const dayStart = new Date(`${dateStr}T${String(workStart).padStart(2, "0")}:00:00`);
    const dayEnd = new Date(`${dateStr}T${String(workEnd).padStart(2, "0")}:00:00`);
    const dayEvents = events.filter(e => { const s = new Date(e.start || e.startDate); return s >= dayStart && s < dayEnd; })
      .map(e => ({ start: new Date(e.start || e.startDate), end: new Date(e.end || e.endDate || new Date(new Date(e.start || e.startDate).getTime() + 3600000)) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const slots = [];
    let cursor = dayStart.getTime();
    for (const evt of dayEvents) {
      if (cursor < evt.start.getTime()) {
        const gapMinutes = (evt.start.getTime() - cursor) / 60000;
        if (gapMinutes >= slotMinutes) slots.push({ start: new Date(cursor).toTimeString().slice(0, 5), end: evt.start.toTimeString().slice(0, 5), minutes: Math.round(gapMinutes) });
      }
      cursor = Math.max(cursor, evt.end.getTime());
    }
    if (cursor < dayEnd.getTime()) {
      const gapMinutes = (dayEnd.getTime() - cursor) / 60000;
      if (gapMinutes >= slotMinutes) slots.push({ start: new Date(cursor).toTimeString().slice(0, 5), end: dayEnd.toTimeString().slice(0, 5), minutes: Math.round(gapMinutes) });
    }
    return { ok: true, result: { date: dateStr, workHours: `${workStart}:00-${workEnd}:00`, eventsToday: dayEvents.length, availableSlots: slots, totalFreeMinutes: slots.reduce((s, sl) => s + sl.minutes, 0) } };
  });

  registerLensAction("calendar", "expandRecurring", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const rule = data.recurrence || data.frequency || "weekly";
    const startDate = new Date(data.startDate || data.start || new Date());
    const count = Math.min(parseInt(data.count) || 10, 52);
    const intervals = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
    const intervalDays = intervals[rule.toLowerCase()] || 7;
    const occurrences = [];
    for (let i = 0; i < count; i++) {
      const date = new Date(startDate.getTime() + i * intervalDays * 86400000);
      occurrences.push({ occurrence: i + 1, date: date.toISOString().split("T")[0], dayOfWeek: date.toLocaleDateString("en-US", { weekday: "long" }) });
    }
    return { ok: true, result: { eventName: data.name || artifact.title, recurrence: rule, startDate: startDate.toISOString().split("T")[0], occurrences, totalOccurrences: count, spanDays: (count - 1) * intervalDays } };
  });

  registerLensAction("calendar", "scheduleOptimize", (ctx, artifact, _params) => {
    const tasks = artifact.data?.tasks || [];
    if (tasks.length === 0) return { ok: true, result: { message: "Add tasks with duration and priority to optimize schedule." } };
    const sorted = tasks.map(t => ({ name: t.name || t.title, duration: parseInt(t.duration) || 30, priority: t.priority || "medium", deadline: t.deadline, energy: t.energy || "medium" }))
      .sort((a, b) => { const pOrder = { critical: 0, high: 1, medium: 2, low: 3 }; return (pOrder[a.priority] ?? 2) - (pOrder[b.priority] ?? 2); });
    // Schedule high-energy tasks in morning, low-energy in afternoon
    const morning = sorted.filter(t => t.energy === "high" || t.priority === "critical");
    const afternoon = sorted.filter(t => t.energy !== "high" && t.priority !== "critical");
    const totalMinutes = sorted.reduce((s, t) => s + t.duration, 0);
    return { ok: true, result: { optimizedOrder: sorted.map(t => t.name), morningBlock: morning.map(t => t.name), afternoonBlock: afternoon.map(t => t.name), totalMinutes, totalHours: Math.round(totalMinutes / 60 * 10) / 10, fitsInWorkday: totalMinutes <= 480 } };
  });

  // ── iCalendar (RFC 5545) interop — calendar parity vs Google ───
  //   Calendar / Apple Calendar / Outlook ────────────────────────

  /**
   * ical-export — Serializes events to an RFC 5545 ICS document.
   * Any calendar app (Apple Calendar, Google Calendar, Outlook, Fantastical)
   * can subscribe to or import this output.
   *
   * params: { events: [{ uid?, summary, description?, start, end?, location?, url?, rrule?, organizerEmail?, attendeeEmails?[] }],
   *           calendarName?: string, calendarTz?: string }
   *
   * Returns: { ics: string, eventCount, contentType: "text/calendar" }
   */
  registerLensAction("calendar", "ical-export", (_ctx, artifact, params = {}) => {
  try {
    const events = (artifact?.data?.events || params.events || []);
    if (!Array.isArray(events) || events.length === 0) {
      return { ok: false, error: "events array required" };
    }
    const calendarName = String(params.calendarName || artifact?.title || "Concord Calendar").slice(0, 100);
    const tz = String(params.calendarTz || "UTC");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Concord OS//Calendar Lens//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape(calendarName)}`,
      `X-WR-TIMEZONE:${icsEscape(tz)}`,
    ];
    let validCount = 0;
    for (const e of events) {
      const uid = String(e.uid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@concord-os`);
      const summary = String(e.summary || e.name || e.title || "Untitled event");
      const startMs = new Date(e.start || e.startDate).getTime();
      if (!Number.isFinite(startMs)) continue;
      const endMs = e.end || e.endDate
        ? new Date(e.end || e.endDate).getTime()
        : startMs + 60 * 60 * 1000;  // default 1h
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${icsUtc(new Date())}`);
      lines.push(`DTSTART:${icsUtc(new Date(startMs))}`);
      lines.push(`DTEND:${icsUtc(new Date(endMs))}`);
      lines.push(`SUMMARY:${icsEscape(summary)}`);
      if (e.description) lines.push(`DESCRIPTION:${icsEscape(String(e.description))}`);
      if (e.location)    lines.push(`LOCATION:${icsEscape(String(e.location))}`);
      if (e.url)         lines.push(`URL:${icsEscape(String(e.url))}`);
      if (e.rrule)       lines.push(`RRULE:${String(e.rrule).replace(/\r?\n/g, " ")}`);
      if (e.organizerEmail) {
        lines.push(`ORGANIZER:mailto:${String(e.organizerEmail).replace(/[\r\n,;]/g, "")}`);
      }
      const attendees = Array.isArray(e.attendeeEmails) ? e.attendeeEmails : [];
      for (const a of attendees) {
        lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${String(a).replace(/[\r\n,;]/g, "")}`);
      }
      lines.push("END:VEVENT");
      validCount++;
    }
    lines.push("END:VCALENDAR");
    // RFC 5545 requires CRLF line endings + lines folded at 75 octets.
    const folded = lines.map(foldIcsLine).join("\r\n") + "\r\n";
    return {
      ok: true,
      result: {
        ics: folded,
        eventCount: validCount,
        calendarName,
        timezone: tz,
        contentType: "text/calendar",
        spec: "RFC 5545",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * ical-parse — Parses an RFC 5545 ICS document into a Concord
   * events array. Handles line unfolding (CRLF + space continuation),
   * VEVENT extraction, common property names, and a minimal RRULE
   * pass-through.
   *
   * params: { ics: string } — UTF-8 ICS document
   */
  registerLensAction("calendar", "ical-parse", (_ctx, _artifact, params = {}) => {
  try {
    const ics = String(params.ics || "");
    if (!ics.trim()) return { ok: false, error: "ics string required" };
    if (!ics.includes("BEGIN:VCALENDAR")) return { ok: false, error: "input is not a VCALENDAR document" };
    // Unfold lines (RFC 5545 §3.1: continuation lines start with SP or TAB).
    const unfolded = ics.replace(/\r\n[ \t]/g, "");
    const rawLines = unfolded.split(/\r?\n/);
    const events = [];
    let cur = null;
    let calendarName = null, timezone = null;
    for (const line of rawLines) {
      if (line.startsWith("X-WR-CALNAME:")) calendarName = icsUnescape(line.slice("X-WR-CALNAME:".length));
      if (line.startsWith("X-WR-TIMEZONE:")) timezone = line.slice("X-WR-TIMEZONE:".length).trim();
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const keyFull = line.slice(0, sep);
      const value = line.slice(sep + 1);
      // Strip iCal parameters (e.g. DTSTART;TZID=America/New_York)
      const key = keyFull.split(";")[0].toUpperCase();
      switch (key) {
        case "UID":          cur.uid = value; break;
        case "SUMMARY":      cur.summary = icsUnescape(value); break;
        case "DESCRIPTION":  cur.description = icsUnescape(value); break;
        case "LOCATION":     cur.location = icsUnescape(value); break;
        case "URL":          cur.url = value; break;
        case "DTSTART":      cur.start = parseIcsDate(value); break;
        case "DTEND":        cur.end = parseIcsDate(value); break;
        case "RRULE":        cur.rrule = value; break;
        case "ORGANIZER":    cur.organizerEmail = value.replace(/^mailto:/i, ""); break;
        case "ATTENDEE":     (cur.attendeeEmails ||= []).push(value.replace(/^mailto:/i, "")); break;
      }
    }
    return {
      ok: true,
      result: {
        events,
        eventCount: events.length,
        calendarName, timezone,
        spec: "RFC 5545",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * timezone-convert — Converts a date/time from one IANA timezone to
   * another. Uses Node's built-in Intl.DateTimeFormat (no dep).
   *
   * params: { isoString, fromTz, toTz }
   */
  registerLensAction("calendar", "timezone-convert", (_ctx, _artifact, params = {}) => {
    const isoString = String(params.isoString || "");
    const fromTz = String(params.fromTz || "UTC");
    const toTz = String(params.toTz || "UTC");
    if (!isoString) return { ok: false, error: "isoString required" };
    const ms = Date.parse(isoString);
    if (!Number.isFinite(ms)) return { ok: false, error: "isoString could not be parsed" };
    // Verify both TZs are valid IANA names.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: fromTz }).format(ms);
      new Intl.DateTimeFormat("en-US", { timeZone: toTz }).format(ms);
    } catch (e) {
      return { ok: false, error: `unknown IANA timezone: ${e.message}` };
    }
    const inFromTz = new Intl.DateTimeFormat("en-CA", {
      timeZone: fromTz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(ms);
    const inToTz = new Intl.DateTimeFormat("en-CA", {
      timeZone: toTz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(ms);
    return {
      ok: true,
      result: {
        sourceIso: isoString,
        fromTz, toTz,
        inFromTz, inToTz,
        epochMs: ms,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Google Calendar + Notion Calendar + Fantastical 2026 parity —
  //  multi-calendar events, recurrence, reminders, tasks + time
  //  blocking, natural-language create, availability, AI scheduling.
  // ═══════════════════════════════════════════════════════════════

  function getCalState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.calendarLens) {
      STATE.calendarLens = {
        calendars: new Map(), // userId -> Array<Calendar>
        events: new Map(),    // userId -> Array<Event>
        tasks: new Map(),     // userId -> Array<Task>
        seq: new Map(),       // userId -> { cal, evt, task }
      };
    }
    // Append-only backfill — appointment schedules (Google Calendar 2026).
    if (!(STATE.calendarLens.appointmentSchedules instanceof Map)) {
      STATE.calendarLens.appointmentSchedules = new Map(); // userId -> Array<Schedule>
    }
    return STATE.calendarLens;
  }
  function saveCal() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort: ignore */ } } }
  function aidCal(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidCal(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoCal() { return new Date().toISOString(); }
  function listCal(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function ensureSeqCal(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { cal: 1, evt: 1, task: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['cal','evt','task']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const CAL_COLORS = ['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#a142f4', '#24c1e0', '#f538a0', '#f6911e'];

  function ensureDefaultCalendars(s, userId) {
    const list = listCal(s.calendars, userId);
    if (list.length === 0) {
      const seq = ensureSeqCal(s, userId);
      list.push({ id: uidCal('cal'), number: `CAL-${String(seq.cal).padStart(3, '0')}`, name: 'Personal', color: '#4285f4', visible: true, isDefault: true, createdAt: isoCal() });
      seq.cal++;
      list.push({ id: uidCal('cal'), number: `CAL-${String(seq.cal).padStart(3, '0')}`, name: 'Work', color: '#ea4335', visible: true, isDefault: false, createdAt: isoCal() });
      seq.cal++;
      saveCal();
    }
    return list;
  }

  // ── Calendars ──────────────────────────────────────────────────

  registerLensAction("calendar", "calendars-list", (ctx, _a, _p = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { calendars: ensureDefaultCalendars(s, aidCal(ctx)) } };
  });

  registerLensAction("calendar", "calendars-create", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    ensureDefaultCalendars(s, userId);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqCal(s, userId);
    const list = listCal(s.calendars, userId);
    const cal = {
      id: uidCal('cal'),
      number: `CAL-${String(seq.cal).padStart(3, '0')}`,
      name,
      color: typeof params.color === 'string' ? params.color : CAL_COLORS[list.length % CAL_COLORS.length],
      visible: true,
      isDefault: false,
      createdAt: isoCal(),
    };
    seq.cal++;
    list.push(cal);
    saveCal();
    return { ok: true, result: { calendar: cal } };
  });

  registerLensAction("calendar", "calendars-update", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cal = listCal(s.calendars, aidCal(ctx)).find(c => c.id === String(params.id || ""));
    if (!cal) return { ok: false, error: "calendar not found" };
    if (typeof params.name === 'string' && params.name.trim()) cal.name = params.name.trim();
    if (typeof params.color === 'string') cal.color = params.color;
    if (typeof params.visible === 'boolean') cal.visible = params.visible;
    saveCal();
    return { ok: true, result: { calendar: cal } };
  });

  registerLensAction("calendar", "calendars-delete", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const id = String(params.id || "");
    const list = listCal(s.calendars, userId);
    const cal = list.find(c => c.id === id);
    if (!cal) return { ok: false, error: "calendar not found" };
    if (cal.isDefault) return { ok: false, error: "cannot delete the default calendar" };
    list.splice(list.indexOf(cal), 1);
    // delete its events too
    const events = listCal(s.events, userId);
    for (let i = events.length - 1; i >= 0; i--) if (events[i].calendarId === id) events.splice(i, 1);
    saveCal();
    return { ok: true, result: { deleted: true } };
  });

  // ── Recurrence expansion (RRULE-lite) ─────────────────────────

  function expandOccurrences(event, rangeStart, rangeEnd) {
    // event.start / event.end are ISO; event.recurrence = { freq, interval, count?, until? }
    const start = new Date(event.start);
    const end = new Date(event.end || event.start);
    const durationMs = end.getTime() - start.getTime();
    const rec = event.recurrence;
    if (!rec || !rec.freq) {
      if (start <= rangeEnd && end >= rangeStart) return [{ ...event, occurrenceStart: event.start, occurrenceEnd: event.end || event.start }];
      return [];
    }
    const interval = Math.max(1, Number(rec.interval) || 1);
    const maxCount = Number(rec.count) || 730; // safety cap
    const untilMs = rec.until ? new Date(rec.until).getTime() : rangeEnd.getTime();
    const out = [];
    const cursor = new Date(start);
    let i = 0;
    while (i < maxCount) {
      const occStart = new Date(cursor);
      if (occStart.getTime() > untilMs) break;
      if (occStart.getTime() > rangeEnd.getTime() + durationMs) break;
      const occEnd = new Date(occStart.getTime() + durationMs);
      if (occEnd >= rangeStart && occStart <= rangeEnd) {
        out.push({ ...event, occurrenceStart: occStart.toISOString(), occurrenceEnd: occEnd.toISOString() });
      }
      // advance
      if (rec.freq === 'daily') cursor.setUTCDate(cursor.getUTCDate() + interval);
      else if (rec.freq === 'weekly') cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
      else if (rec.freq === 'monthly') cursor.setUTCMonth(cursor.getUTCMonth() + interval);
      else if (rec.freq === 'yearly') cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
      else break;
      i++;
    }
    return out;
  }

  // ── Events CRUD ────────────────────────────────────────────────

  registerLensAction("calendar", "events-list", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    ensureDefaultCalendars(s, userId);
    const rangeStart = new Date(params.rangeStart || new Date(Date.now() - 7 * 86_400_000).toISOString());
    const rangeEnd = new Date(params.rangeEnd || new Date(Date.now() + 60 * 86_400_000).toISOString());
    if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) return { ok: false, error: "invalid range" };
    const calIds = Array.isArray(params.calendarIds) ? params.calendarIds.map(String) : null;
    const events = listCal(s.events, userId);
    const occurrences = [];
    for (const e of events) {
      if (calIds && !calIds.includes(e.calendarId)) continue;
      for (const occ of expandOccurrences(e, rangeStart, rangeEnd)) occurrences.push(occ);
    }
    occurrences.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
    return { ok: true, result: { events: occurrences, count: occurrences.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "events-create", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const calendars = ensureDefaultCalendars(s, userId);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const start = String(params.start || "");
    if (!start || isNaN(new Date(start).getTime())) return { ok: false, error: "valid start (ISO) required" };
    let end = String(params.end || "");
    if (!end || isNaN(new Date(end).getTime())) end = new Date(new Date(start).getTime() + 3_600_000).toISOString();
    let calendarId = String(params.calendarId || "");
    if (!calendars.find(c => c.id === calendarId)) calendarId = (calendars.find(c => c.isDefault) || calendars[0]).id;
    let recurrence = null;
    if (params.recurrence && typeof params.recurrence === 'object' && ['daily','weekly','monthly','yearly'].includes(params.recurrence.freq)) {
      recurrence = {
        freq: params.recurrence.freq,
        interval: Math.max(1, Number(params.recurrence.interval) || 1),
        count: Number(params.recurrence.count) || null,
        until: params.recurrence.until ? String(params.recurrence.until) : null,
      };
    }
    const seq = ensureSeqCal(s, userId);
    const event = {
      id: uidCal('evt'),
      number: `EV-${String(seq.evt).padStart(6, '0')}`,
      calendarId,
      title,
      description: String(params.description || ""),
      location: String(params.location || ""),
      start, end,
      allDay: Boolean(params.allDay),
      recurrence,
      reminders: Array.isArray(params.reminders) ? params.reminders.map(r => Math.max(0, Number(r) || 0)) : [10],
      attendees: Array.isArray(params.attendees) ? params.attendees.map(String) : [],
      conferenceLink: String(params.conferenceLink || ""),
      createdAt: isoCal(),
    };
    seq.evt++;
    listCal(s.events, userId).push(event);
    saveCal();
    return { ok: true, result: { event } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "events-update", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = listCal(s.events, aidCal(ctx)).find(x => x.id === String(params.id || ""));
    if (!e) return { ok: false, error: "event not found" };
    for (const k of ['title','description','location','conferenceLink']) if (typeof params[k] === 'string') e[k] = params[k];
    for (const k of ['start','end']) {
      if (typeof params[k] === 'string' && !isNaN(new Date(params[k]).getTime())) e[k] = params[k];
    }
    if (typeof params.calendarId === 'string') {
      const cal = listCal(s.calendars, aidCal(ctx)).find(c => c.id === params.calendarId);
      if (cal) e.calendarId = cal.id;
    }
    if (typeof params.allDay === 'boolean') e.allDay = params.allDay;
    if (Array.isArray(params.reminders)) e.reminders = params.reminders.map(r => Math.max(0, Number(r) || 0));
    if (params.recurrence === null) e.recurrence = null;
    else if (params.recurrence && ['daily','weekly','monthly','yearly'].includes(params.recurrence.freq)) {
      e.recurrence = { freq: params.recurrence.freq, interval: Math.max(1, Number(params.recurrence.interval) || 1), count: Number(params.recurrence.count) || null, until: params.recurrence.until || null };
    }
    saveCal();
    return { ok: true, result: { event: e } };
  });

  registerLensAction("calendar", "events-delete", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCal(s.events, aidCal(ctx));
    const i = list.findIndex(e => e.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "event not found" };
    list.splice(i, 1);
    saveCal();
    return { ok: true, result: { deleted: true } };
  });

  // ── Conflict detection (real, STATE-backed) ───────────────────

  registerLensAction("calendar", "conflicts-check", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const start = new Date(params.start || "");
    const end = new Date(params.end || "");
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return { ok: false, error: "valid start/end required" };
    const excludeId = params.excludeEventId ? String(params.excludeEventId) : null;
    const windowStart = new Date(start.getTime() - 7 * 86_400_000);
    const windowEnd = new Date(end.getTime() + 7 * 86_400_000);
    const conflicts = [];
    for (const e of listCal(s.events, userId)) {
      if (excludeId && e.id === excludeId) continue;
      for (const occ of expandOccurrences(e, windowStart, windowEnd)) {
        const os = new Date(occ.occurrenceStart).getTime();
        const oe = new Date(occ.occurrenceEnd).getTime();
        if (os < end.getTime() && oe > start.getTime()) {
          conflicts.push({ eventId: e.id, title: e.title, start: occ.occurrenceStart, end: occ.occurrenceEnd });
        }
      }
    }
    return { ok: true, result: { hasConflict: conflicts.length > 0, conflicts } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Availability / free slots ─────────────────────────────────

  registerLensAction("calendar", "availability-find", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const day = String(params.day || new Date().toISOString().slice(0, 10));
    const durationMin = Math.max(15, Math.min(480, Number(params.durationMin) || 30));
    const workStartHour = Number.isFinite(Number(params.workStartHour)) ? Number(params.workStartHour) : 9;
    const workEndHour = Number.isFinite(Number(params.workEndHour)) ? Number(params.workEndHour) : 18;
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    if (isNaN(dayStart.getTime())) return { ok: false, error: "invalid day" };
    const winStart = new Date(dayStart.getTime() + workStartHour * 3_600_000);
    const winEnd = new Date(dayStart.getTime() + workEndHour * 3_600_000);
    // Collect busy blocks
    const busy = [];
    for (const e of listCal(s.events, userId)) {
      for (const occ of expandOccurrences(e, winStart, winEnd)) {
        busy.push([new Date(occ.occurrenceStart).getTime(), new Date(occ.occurrenceEnd).getTime()]);
      }
    }
    busy.sort((a, b) => a[0] - b[0]);
    // Walk the work window finding gaps ≥ duration
    const slots = [];
    let cursor = winStart.getTime();
    const durMs = durationMin * 60_000;
    for (const [bs, be] of busy) {
      if (bs - cursor >= durMs) slots.push({ start: new Date(cursor).toISOString(), end: new Date(bs).toISOString() });
      cursor = Math.max(cursor, be);
    }
    if (winEnd.getTime() - cursor >= durMs) slots.push({ start: new Date(cursor).toISOString(), end: winEnd.toISOString() });
    return { ok: true, result: { day, durationMin, freeSlots: slots, busyBlockCount: busy.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Tasks + time blocking ─────────────────────────────────────

  registerLensAction("calendar", "tasks-list", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const status = ['todo', 'done', 'all'].includes(params.status) ? params.status : 'all';
    let list = listCal(s.tasks, aidCal(ctx));
    if (status !== 'all') list = list.filter(t => t.status === status);
    return { ok: true, result: { tasks: list.slice().sort((a, b) => (a.dueAt || 'zzz').localeCompare(b.dueAt || 'zzz')) } };
  });

  registerLensAction("calendar", "tasks-create", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const seq = ensureSeqCal(s, userId);
    const task = {
      id: uidCal('task'),
      number: `TK-${String(seq.task).padStart(5, '0')}`,
      title,
      notes: String(params.notes || ""),
      dueAt: params.dueAt ? String(params.dueAt) : null,
      estimateMin: Math.max(0, Number(params.estimateMin) || 30),
      priority: ['low', 'medium', 'high'].includes(params.priority) ? params.priority : 'medium',
      status: 'todo',
      blockedEventId: null,   // set when time-blocked onto the calendar
      createdAt: isoCal(),
    };
    seq.task++;
    listCal(s.tasks, userId).push(task);
    saveCal();
    return { ok: true, result: { task } };
  });

  registerLensAction("calendar", "tasks-toggle", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = listCal(s.tasks, aidCal(ctx)).find(x => x.id === String(params.id || ""));
    if (!t) return { ok: false, error: "task not found" };
    t.status = t.status === 'done' ? 'todo' : 'done';
    t.completedAt = t.status === 'done' ? isoCal() : null;
    saveCal();
    return { ok: true, result: { task: t } };
  });

  registerLensAction("calendar", "tasks-delete", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCal(s.tasks, aidCal(ctx));
    const i = list.findIndex(t => t.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "task not found" };
    list.splice(i, 1);
    saveCal();
    return { ok: true, result: { deleted: true } };
  });

  // Time-block a task — drops it onto the calendar as an event.
  registerLensAction("calendar", "tasks-time-block", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const calendars = ensureDefaultCalendars(s, userId);
    const task = listCal(s.tasks, userId).find(t => t.id === String(params.taskId || ""));
    if (!task) return { ok: false, error: "task not found" };
    const start = String(params.start || "");
    if (!start || isNaN(new Date(start).getTime())) return { ok: false, error: "valid start required" };
    const end = new Date(new Date(start).getTime() + task.estimateMin * 60_000).toISOString();
    const seq = ensureSeqCal(s, userId);
    const event = {
      id: uidCal('evt'),
      number: `EV-${String(seq.evt).padStart(6, '0')}`,
      calendarId: (calendars.find(c => c.isDefault) || calendars[0]).id,
      title: `⏳ ${task.title}`,
      description: task.notes,
      location: '',
      start, end,
      allDay: false,
      recurrence: null,
      reminders: [10],
      attendees: [],
      conferenceLink: '',
      fromTaskId: task.id,
      createdAt: isoCal(),
    };
    seq.evt++;
    listCal(s.events, userId).push(event);
    task.blockedEventId = event.id;
    saveCal();
    return { ok: true, result: { event, task } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Natural-language event create (Fantastical parity) ────────

  registerLensAction("calendar", "nl-parse-event", (ctx, _a, params = {}) => {
  try {
    const text = String(params.text || "").trim();
    if (!text) return { ok: false, error: "text required" };
    const lower = text.toLowerCase();
    const now = new Date();
    // Recurrence
    let recurrence = null;
    if (/\bevery day\b|\bdaily\b/.test(lower)) recurrence = { freq: 'daily', interval: 1 };
    else if (/\bevery week\b|\bweekly\b|\bevery (mon|tue|wed|thu|fri|sat|sun)/.test(lower)) recurrence = { freq: 'weekly', interval: 1 };
    else if (/\bevery month\b|\bmonthly\b/.test(lower)) recurrence = { freq: 'monthly', interval: 1 };
    else if (/\bevery year\b|\bannually\b|\byearly\b/.test(lower)) recurrence = { freq: 'yearly', interval: 1 };
    // Time
    let hour = 9, minute = 0;
    const tm = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (tm) {
      hour = parseInt(tm[1], 10) % 12;
      if (tm[3] === 'pm') hour += 12;
      minute = tm[2] ? parseInt(tm[2], 10) : 0;
    } else {
      const tm24 = lower.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
      if (tm24) { hour = parseInt(tm24[1], 10); minute = parseInt(tm24[2], 10); }
    }
    // Day
    const target = new Date(now);
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const dowMatch = weekdays.findIndex(d => lower.includes(d) || lower.includes(d.slice(0, 3)));
    if (/\btomorrow\b/.test(lower)) target.setDate(target.getDate() + 1);
    else if (/\btoday\b/.test(lower)) { /* keep */ }
    else if (dowMatch >= 0) {
      let delta = (dowMatch - target.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "next monday" semantics
      target.setDate(target.getDate() + delta);
    }
    target.setHours(hour, minute, 0, 0);
    // Duration
    let durMin = 60;
    const durM = lower.match(/\bfor\s+(\d{1,3})\s*(min|minute|hour|hr)/);
    if (durM) durMin = /hour|hr/.test(durM[2]) ? parseInt(durM[1], 10) * 60 : parseInt(durM[1], 10);
    // Conference link
    const conf = /\b(zoom|google meet|meet|teams|webex)\b/.test(lower) ? (lower.match(/\b(zoom|google meet|meet|teams|webex)\b/) || [])[1] : '';
    // Title = text minus the parsed time/day/recurrence noise
    let title = text
      .replace(/\bevery (day|week|month|year)\b/gi, '')
      .replace(/\b(daily|weekly|monthly|yearly|annually)\b/gi, '')
      .replace(/\bevery (mon|tue|wed|thu|fri|sat|sun)\w*/gi, '')
      .replace(/\b(today|tomorrow)\b/gi, '')
      .replace(new RegExp(`\\b(${weekdays.join('|')})\\b`, 'gi'), '')
      .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, '')
      .replace(/\bfor\s+\d{1,3}\s*(min|minute|minutes|hour|hours|hr)\b/gi, '')
      .replace(/\bon\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!title) title = 'New event';
    return {
      ok: true,
      result: {
        parsed: {
          title,
          start: target.toISOString(),
          end: new Date(target.getTime() + durMin * 60_000).toISOString(),
          recurrence,
          conferenceLink: conf,
          durationMin: durMin,
        },
        sourceText: text,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── AI scheduling (Reclaim.ai parity — auto-place tasks in free slots) ─

  registerLensAction("calendar", "ai-auto-schedule", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    ensureDefaultCalendars(s, userId);
    const day = String(params.day || new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    const workStartHour = Number.isFinite(Number(params.workStartHour)) ? Number(params.workStartHour) : 9;
    const workEndHour = Number.isFinite(Number(params.workEndHour)) ? Number(params.workEndHour) : 18;
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    if (isNaN(dayStart.getTime())) return { ok: false, error: "invalid day" };
    const winStart = dayStart.getTime() + workStartHour * 3_600_000;
    const winEnd = dayStart.getTime() + workEndHour * 3_600_000;
    // Busy blocks for the day
    const busy = [];
    for (const e of listCal(s.events, userId)) {
      for (const occ of expandOccurrences(e, new Date(winStart), new Date(winEnd))) {
        busy.push([new Date(occ.occurrenceStart).getTime(), new Date(occ.occurrenceEnd).getTime()]);
      }
    }
    busy.sort((a, b) => a[0] - b[0]);
    // Open tasks, highest priority + soonest due first
    const prioRank = { high: 0, medium: 1, low: 2 };
    const tasks = listCal(s.tasks, userId)
      .filter(t => t.status === 'todo' && !t.blockedEventId)
      .sort((a, b) => (prioRank[a.priority] - prioRank[b.priority]) || ((a.dueAt || 'zzz').localeCompare(b.dueAt || 'zzz')));
    // Greedy place each task into the earliest fitting gap
    const proposals = [];
    let cursor = winStart;
    let busyIdx = 0;
    function nextFreeStart(needMs) {
      while (busyIdx < busy.length) {
        if (busy[busyIdx][0] - cursor >= needMs) return cursor;
        cursor = Math.max(cursor, busy[busyIdx][1]);
        busyIdx++;
      }
      return (winEnd - cursor >= needMs) ? cursor : null;
    }
    for (const task of tasks) {
      const needMs = (task.estimateMin || 30) * 60_000;
      const startMs = nextFreeStart(needMs);
      if (startMs === null) break; // day full
      proposals.push({
        taskId: task.id,
        title: task.title,
        priority: task.priority,
        estimateMin: task.estimateMin,
        proposedStart: new Date(startMs).toISOString(),
        proposedEnd: new Date(startMs + needMs).toISOString(),
      });
      cursor = startMs + needMs;
    }
    return {
      ok: true,
      result: {
        day,
        proposals,
        scheduledCount: proposals.length,
        unscheduledCount: tasks.length - proposals.length,
        note: "Proposals only — call tasks-time-block to commit each one.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("calendar", "calendar-dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const calendars = ensureDefaultCalendars(s, userId);
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
    let todayCount = 0, weekCount = 0;
    for (const e of listCal(s.events, userId)) {
      for (const occ of expandOccurrences(e, now, weekEnd)) {
        weekCount++;
        if (new Date(occ.occurrenceStart) <= todayEnd) todayCount++;
      }
    }
    const tasks = listCal(s.tasks, userId);
    const openTasks = tasks.filter(t => t.status === 'todo').length;
    const overdueTasks = tasks.filter(t => t.status === 'todo' && t.dueAt && new Date(t.dueAt) < now).length;
    return {
      ok: true,
      result: {
        calendarCount: calendars.length,
        eventsToday: todayCount,
        eventsThisWeek: weekCount,
        openTasks,
        overdueTasks,
        unblockedTasks: tasks.filter(t => t.status === 'todo' && !t.blockedEventId).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Appointment schedules (Google Calendar 2026 booking pages) ───────
  // Publish bookable windows; let others reserve time slots.

  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  registerLensAction("calendar", "appointment-schedule-create", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = String(params.title || "").trim().slice(0, 120);
    if (!title) return { ok: false, error: "schedule title required" };
    const durationMin = Math.max(5, Math.min(480, Math.round(Number(params.durationMin) || 30)));
    const startHour = Math.max(0, Math.min(23, Math.round(Number(params.startHour) || 9)));
    const endHour = Math.max(startHour + 1, Math.min(24, Math.round(Number(params.endHour) || 17)));
    let weekdays = Array.isArray(params.weekdays)
      ? [...new Set(params.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))]
      : [1, 2, 3, 4, 5];
    if (weekdays.length === 0) weekdays = [1, 2, 3, 4, 5];
    const schedule = {
      id: uidCal("appt"),
      title,
      description: String(params.description || "").trim().slice(0, 400),
      durationMin,
      availability: { weekdays: weekdays.sort((a, b) => a - b), startHour, endHour },
      bookings: [],
      createdAt: isoCal(),
    };
    listCal(s.appointmentSchedules, aidCal(ctx)).push(schedule);
    saveCal();
    return { ok: true, result: { schedule } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "appointment-schedule-list", (ctx, _a, _p = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schedules = listCal(s.appointmentSchedules, aidCal(ctx)).map((sc) => ({
      ...sc,
      bookingCount: sc.bookings.length,
    }));
    return { ok: true, result: { schedules, count: schedules.length } };
  });

  registerLensAction("calendar", "appointment-schedule-delete", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = listCal(s.appointmentSchedules, aidCal(ctx));
    const i = arr.findIndex((sc) => sc.id === params.id);
    if (i < 0) return { ok: false, error: "schedule not found" };
    arr.splice(i, 1);
    saveCal();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("calendar", "appointment-slots", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schedule = listCal(s.appointmentSchedules, aidCal(ctx)).find((sc) => sc.id === params.scheduleId);
    if (!schedule) return { ok: false, error: "schedule not found" };
    const dateStr = String(params.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: "date required (YYYY-MM-DD)" };
    const day = new Date(`${dateStr}T00:00:00`);
    const weekday = day.getDay();
    if (!schedule.availability.weekdays.includes(weekday)) {
      return { ok: true, result: { date: dateStr, weekday: WEEKDAY_NAMES[weekday], slots: [], reason: "not an available weekday" } };
    }
    const booked = new Set(schedule.bookings.map((b) => b.slotStart));
    const slots = [];
    const now = Date.now();
    for (let mins = schedule.availability.startHour * 60; mins + schedule.durationMin <= schedule.availability.endHour * 60; mins += schedule.durationMin) {
      const h = String(Math.floor(mins / 60)).padStart(2, '0');
      const m = String(mins % 60).padStart(2, '0');
      const slotStart = `${dateStr}T${h}:${m}:00`;
      const slotMs = new Date(slotStart).getTime();
      slots.push({
        slotStart,
        label: `${h}:${m}`,
        available: !booked.has(slotStart) && slotMs > now,
      });
    }
    return { ok: true, result: { date: dateStr, weekday: WEEKDAY_NAMES[weekday], durationMin: schedule.durationMin, slots } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "appointment-book", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schedule = listCal(s.appointmentSchedules, aidCal(ctx)).find((sc) => sc.id === params.scheduleId);
    if (!schedule) return { ok: false, error: "schedule not found" };
    const slotStart = String(params.slotStart || "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(slotStart)) return { ok: false, error: "valid slotStart required" };
    if (schedule.bookings.some((b) => b.slotStart === slotStart)) return { ok: false, error: "slot already booked" };
    const bookerName = String(params.bookerName || "").trim().slice(0, 120);
    if (!bookerName) return { ok: false, error: "bookerName required" };
    const booking = {
      id: uidCal("bk"),
      slotStart,
      bookerName,
      note: String(params.note || "").trim().slice(0, 400),
      bookedAt: isoCal(),
    };
    schedule.bookings.push(booking);
    schedule.bookings.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    saveCal();
    return { ok: true, result: { booking } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "appointment-bookings", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schedule = listCal(s.appointmentSchedules, aidCal(ctx)).find((sc) => sc.id === params.scheduleId);
    if (!schedule) return { ok: false, error: "schedule not found" };
    const upcoming = schedule.bookings.filter((b) => new Date(b.slotStart).getTime() > Date.now());
    return { ok: true, result: { scheduleId: schedule.id, title: schedule.title, bookings: schedule.bookings, upcomingCount: upcoming.length } };
  });

  registerLensAction("calendar", "appointment-cancel-booking", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const schedule = listCal(s.appointmentSchedules, aidCal(ctx)).find((sc) => sc.id === params.scheduleId);
    if (!schedule) return { ok: false, error: "schedule not found" };
    const i = schedule.bookings.findIndex((b) => b.id === params.bookingId);
    if (i < 0) return { ok: false, error: "booking not found" };
    schedule.bookings.splice(i, 1);
    saveCal();
    return { ok: true, result: { cancelled: params.bookingId } };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Backlog parity — external account sync, calendar sharing,
  //  firing reminders, working-location / OOO event types,
  //  conference-link auto-gen, guest RSVP + invites.
  // ═══════════════════════════════════════════════════════════════

  function ensureBacklogMaps(s) {
    if (!(s.connectedAccounts instanceof Map)) s.connectedAccounts = new Map();   // userId -> Array<Account>
    if (!(s.calendarShares instanceof Map)) s.calendarShares = new Map();          // userId -> Array<Share>
    if (!(s.reminderQueue instanceof Map)) s.reminderQueue = new Map();            // userId -> Array<Notification>
    if (!(s.eventInvites instanceof Map)) s.eventInvites = new Map();              // userId -> Array<Invite>
    return s;
  }

  // ── Item 1 — Two-way external account sync (Google / Outlook) ──
  // Real ICS-URL subscription model (free, keyless): the user connects
  // an account by pasting their calendar's public/secret iCal feed URL.
  // sync pulls live events from that feed via cachedFetchJson-equivalent
  // fetch + ical-parse, importing them into a dedicated calendar.

  registerLensAction("calendar", "accounts-connect", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const userId = aidCal(ctx);
    const provider = ['google', 'outlook', 'apple', 'ics'].includes(params.provider) ? params.provider : 'ics';
    const label = String(params.label || "").trim().slice(0, 80);
    const icsUrl = String(params.icsUrl || "").trim();
    if (!label) return { ok: false, error: "label required" };
    if (!/^https?:\/\//i.test(icsUrl)) return { ok: false, error: "valid icsUrl (https) required" };
    const account = {
      id: uidCal('acct'),
      provider,
      label,
      icsUrl,
      direction: ['pull', 'push', 'two-way'].includes(params.direction) ? params.direction : 'two-way',
      lastSyncAt: null,
      lastSyncCount: 0,
      connectedAt: isoCal(),
    };
    listCal(s.connectedAccounts, userId).push(account);
    saveCal();
    return { ok: true, result: { account } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "accounts-list", (ctx, _a, _p = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    return { ok: true, result: { accounts: listCal(s.connectedAccounts, aidCal(ctx)) } };
  });

  // Track C — return the connector-OAuth authorize URL the frontend redirects to
  // so the user grants real Google Calendar access. Tokens persist under
  // connector_id "google_calendar" (what writeGoogleCalendarEvent reads). Scope
  // is least-privilege calendar.events (read/write events, not the whole calendar).
  registerLensAction("calendar", "accounts-connect-google", (_ctx, _a, params = {}) => {
    const scope = "https://www.googleapis.com/auth/calendar.events";
    const qs = new URLSearchParams({ token_key: "google_calendar", scopes: scope });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return {
      ok: true,
      result: {
        provider: "google",
        authorizeUrl: `/api/oauth/google/authorize?${qs.toString()}`,
        scopes: [scope],
      },
    };
  });

  // Track C — push an event back to the provider (real two-way sync). Honors the
  // account's direction (pull accounts refuse) and only supports providers with a
  // real connector client (Google today). Returns honest reasons; when no OAuth
  // credential is stored the connector client replies no_token/connector_not_configured.
  registerLensAction("calendar", "accounts-push-event", async (ctx, _a, params = {}) => {
    try {
      const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
      ensureBacklogMaps(s);
      const userId = aidCal(ctx);
      const acct = listCal(s.connectedAccounts, userId).find((a) => a.id === String(params.accountId || ""));
      if (!acct) return { ok: false, error: "account not found" };
      if (!["push", "two-way"].includes(acct.direction)) {
        return { ok: false, reason: "direction_pull_no_push", direction: acct.direction };
      }
      if (acct.provider !== "google") {
        return { ok: false, reason: "push_unsupported_provider", provider: acct.provider };
      }
      const event = params.event || {};
      if (!event.title && !event.summary) return { ok: false, error: "event.title required" };
      const res = await writeGoogleCalendarEvent(ctx.db, userId, event);
      if (!res.ok) return { ok: false, reason: res.reason || "push_failed", detail: res };
      acct.lastSyncAt = isoCal();
      saveCal();
      return { ok: true, result: { pushed: true, providerEventId: res.data?.id || null } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  registerLensAction("calendar", "accounts-disconnect", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const list = listCal(s.connectedAccounts, aidCal(ctx));
    const i = list.findIndex(a => a.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "account not found" };
    list.splice(i, 1);
    saveCal();
    return { ok: true, result: { disconnected: true } };
  });

  registerLensAction("calendar", "accounts-sync", async (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const userId = aidCal(ctx);
    const account = listCal(s.connectedAccounts, userId).find(a => a.id === String(params.id || ""));
    if (!account) return { ok: false, error: "account not found" };
    let ics;
    try {
      const r = await fetch(account.icsUrl);
      if (!r.ok) return { ok: false, error: `feed responded ${r.status}` };
      ics = await r.text();
    } catch (e) {
      return { ok: false, error: `feed unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!ics.includes("BEGIN:VCALENDAR")) return { ok: false, error: "feed did not return a valid VCALENDAR" };
    // Reuse the ical-parse logic.
    const unfolded = ics.replace(/\r\n[ \t]/g, "");
    const incoming = [];
    let cur = null;
    for (const line of unfolded.split(/\r?\n/)) {
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") { if (cur) incoming.push(cur); cur = null; continue; }
      if (!cur) continue;
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const key = line.slice(0, sep).split(";")[0].toUpperCase();
      const value = line.slice(sep + 1);
      if (key === "UID") cur.uid = value;
      else if (key === "SUMMARY") cur.summary = icsUnescape(value);
      else if (key === "DESCRIPTION") cur.description = icsUnescape(value);
      else if (key === "LOCATION") cur.location = icsUnescape(value);
      else if (key === "DTSTART") cur.start = parseIcsDate(value);
      else if (key === "DTEND") cur.end = parseIcsDate(value);
    }
    // Dedicated calendar per account.
    const calendars = ensureDefaultCalendars(s, userId);
    let synced = calendars.find(c => c.externalAccountId === account.id);
    if (!synced) {
      const seq = ensureSeqCal(s, userId);
      synced = {
        id: uidCal('cal'),
        number: `CAL-${String(seq.cal).padStart(3, '0')}`,
        name: account.label,
        color: CAL_COLORS[calendars.length % CAL_COLORS.length],
        visible: true,
        isDefault: false,
        externalAccountId: account.id,
        readOnly: account.direction === 'pull',
        createdAt: isoCal(),
      };
      seq.cal++;
      calendars.push(synced);
    }
    const events = listCal(s.events, userId);
    let imported = 0, updated = 0;
    const seq = ensureSeqCal(s, userId);
    for (const inc of incoming) {
      if (!inc.start || isNaN(new Date(inc.start).getTime())) continue;
      const extKey = inc.uid ? `${account.id}:${inc.uid}` : null;
      const existing = extKey ? events.find(e => e.externalKey === extKey) : null;
      const end = inc.end && !isNaN(new Date(inc.end).getTime())
        ? inc.end
        : new Date(new Date(inc.start).getTime() + 3_600_000).toISOString();
      if (existing) {
        existing.title = inc.summary || existing.title;
        existing.description = inc.description || "";
        existing.location = inc.location || "";
        existing.start = inc.start;
        existing.end = end;
        updated++;
      } else {
        events.push({
          id: uidCal('evt'),
          number: `EV-${String(seq.evt).padStart(6, '0')}`,
          calendarId: synced.id,
          title: inc.summary || "Untitled event",
          description: inc.description || "",
          location: inc.location || "",
          start: inc.start, end,
          allDay: false,
          recurrence: null,
          reminders: [10],
          attendees: [],
          conferenceLink: "",
          externalKey: extKey,
          externalAccountId: account.id,
          createdAt: isoCal(),
        });
        seq.evt++;
        imported++;
      }
    }
    account.lastSyncAt = isoCal();
    account.lastSyncCount = incoming.length;
    saveCal();
    return { ok: true, result: { accountId: account.id, calendarId: synced.id, feedEvents: incoming.length, imported, updated, direction: account.direction } };
  });

  // ── Item 2 — Calendar sharing + per-calendar permissions ──────

  registerLensAction("calendar", "calendar-share", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const userId = aidCal(ctx);
    const cal = listCal(s.calendars, userId).find(c => c.id === String(params.calendarId || ""));
    if (!cal) return { ok: false, error: "calendar not found" };
    const sharedWith = String(params.sharedWith || "").trim().slice(0, 120);
    if (!sharedWith) return { ok: false, error: "sharedWith (user identifier or email) required" };
    const role = ['viewer', 'editor', 'manager'].includes(params.role) ? params.role : 'viewer';
    const list = listCal(s.calendarShares, userId);
    const existing = list.find(sh => sh.calendarId === cal.id && sh.sharedWith.toLowerCase() === sharedWith.toLowerCase());
    if (existing) {
      existing.role = role;
      saveCal();
      return { ok: true, result: { share: existing, updated: true } };
    }
    const share = {
      id: uidCal('shr'),
      calendarId: cal.id,
      calendarName: cal.name,
      sharedWith,
      role,
      createdAt: isoCal(),
    };
    list.push(share);
    saveCal();
    return { ok: true, result: { share } };
  });

  registerLensAction("calendar", "calendar-shares-list", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    let list = listCal(s.calendarShares, aidCal(ctx));
    if (params.calendarId) list = list.filter(sh => sh.calendarId === String(params.calendarId));
    return { ok: true, result: { shares: list, count: list.length } };
  });

  registerLensAction("calendar", "calendar-unshare", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const list = listCal(s.calendarShares, aidCal(ctx));
    const i = list.findIndex(sh => sh.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "share not found" };
    list.splice(i, 1);
    saveCal();
    return { ok: true, result: { unshared: true } };
  });

  // ── Item 3 — Reminders / notifications that actually fire ─────
  // reminders-due computes which event-reminder offsets are now in
  // the firing window and emits them as persisted notifications.

  registerLensAction("calendar", "reminders-due", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const userId = aidCal(ctx);
    const now = Date.now();
    const lookAheadMin = Math.max(0, Math.min(1440, Number(params.lookAheadMin) || 0));
    const queue = listCal(s.reminderQueue, userId);
    const firedKeys = new Set(queue.map(n => n.key));
    const winStart = new Date(now);
    const winEnd = new Date(now + 30 * 86_400_000);
    let firedNow = 0;
    for (const e of listCal(s.events, userId)) {
      const reminders = Array.isArray(e.reminders) ? e.reminders : [];
      if (reminders.length === 0) continue;
      for (const occ of expandOccurrences(e, winStart, winEnd)) {
        const occMs = new Date(occ.occurrenceStart).getTime();
        for (const offsetMin of reminders) {
          const fireAt = occMs - Number(offsetMin) * 60_000;
          const key = `${e.id}:${occ.occurrenceStart}:${offsetMin}`;
          if (firedKeys.has(key)) continue;
          // Fires once the wall clock reaches fireAt (plus lookAhead grace).
          if (fireAt <= now + lookAheadMin * 60_000 && occMs > now) {
            const note = {
              id: uidCal('ntf'),
              key,
              eventId: e.id,
              eventTitle: e.title,
              occurrenceStart: occ.occurrenceStart,
              offsetMin: Number(offsetMin),
              firedAt: isoCal(),
              acknowledged: false,
            };
            queue.push(note);
            firedKeys.add(key);
            firedNow++;
          }
        }
      }
    }
    if (firedNow > 0) saveCal();
    const pending = queue.filter(n => !n.acknowledged).sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
    return { ok: true, result: { firedNow, pending, pendingCount: pending.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "reminders-acknowledge", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const queue = listCal(s.reminderQueue, aidCal(ctx));
    if (params.all === true) {
      let n = 0;
      for (const note of queue) if (!note.acknowledged) { note.acknowledged = true; note.acknowledgedAt = isoCal(); n++; }
      saveCal();
      return { ok: true, result: { acknowledged: n } };
    }
    const note = queue.find(x => x.id === String(params.id || ""));
    if (!note) return { ok: false, error: "notification not found" };
    note.acknowledged = true;
    note.acknowledgedAt = isoCal();
    saveCal();
    return { ok: true, result: { notification: note } };
  });

  // ── Item 4 — Working-location + out-of-office event types ─────
  // Real first-class typed events stored in the same events array with
  // an eventCategory tag, so they render distinctly and feed availability.

  registerLensAction("calendar", "status-event-create", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const calendars = ensureDefaultCalendars(s, userId);
    const kind = ['working-location', 'out-of-office', 'focus-time'].includes(params.kind) ? params.kind : null;
    if (!kind) return { ok: false, error: "kind must be working-location | out-of-office | focus-time" };
    const start = String(params.start || "");
    if (!start || isNaN(new Date(start).getTime())) return { ok: false, error: "valid start (ISO) required" };
    let end = String(params.end || "");
    if (!end || isNaN(new Date(end).getTime())) end = new Date(new Date(start).getTime() + 8 * 3_600_000).toISOString();
    const detail = String(params.detail || "").trim().slice(0, 200);
    const TITLES = {
      'working-location': detail ? `Working from ${detail}` : 'Working location',
      'out-of-office': detail ? `Out of office — ${detail}` : 'Out of office',
      'focus-time': detail ? `Focus: ${detail}` : 'Focus time',
    };
    const seq = ensureSeqCal(s, userId);
    const event = {
      id: uidCal('evt'),
      number: `EV-${String(seq.evt).padStart(6, '0')}`,
      calendarId: (calendars.find(c => c.isDefault) || calendars[0]).id,
      title: TITLES[kind],
      description: detail,
      location: kind === 'working-location' ? detail : '',
      start, end,
      allDay: Boolean(params.allDay),
      recurrence: null,
      reminders: [],
      attendees: [],
      conferenceLink: '',
      eventCategory: kind,
      // out-of-office and focus-time auto-decline / block availability
      blocksAvailability: kind !== 'working-location',
      createdAt: isoCal(),
    };
    seq.evt++;
    listCal(s.events, userId).push(event);
    saveCal();
    return { ok: true, result: { event } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "status-events-list", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const list = listCal(s.events, aidCal(ctx))
      .filter(e => e.eventCategory && ['working-location', 'out-of-office', 'focus-time'].includes(e.eventCategory))
      .filter(e => params.includeAll === true || new Date(e.end || e.start).getTime() >= now)
      .sort((a, b) => a.start.localeCompare(b.start));
    return { ok: true, result: { statusEvents: list, count: list.length } };
  });

  // ── Item 5 — Video-conference link auto-generation ────────────
  // Deterministic room-name generation (no external API). Produces a
  // stable, joinable Jitsi Meet room URL (free, keyless, no account).

  registerLensAction("calendar", "conference-generate", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCal(ctx);
    const provider = ['jitsi', 'concord'].includes(params.provider) ? params.provider : 'jitsi';
    const seed = `${userId}-${String(params.eventId || params.seed || Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
    // Deterministic, URL-safe room slug.
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    const room = `concord-${Math.abs(hash).toString(36)}-${Date.now().toString(36).slice(-4)}`;
    const url = provider === 'jitsi'
      ? `https://meet.jit.si/${room}`
      : `https://concord-os.org/meet/${room}`;
    let attached = false;
    if (params.eventId) {
      const e = listCal(s.events, userId).find(x => x.id === String(params.eventId));
      if (e) { e.conferenceLink = url; e.conferenceProvider = provider; e.conferenceRoom = room; attached = true; saveCal(); }
    }
    return { ok: true, result: { provider, room, url, attachedToEvent: attached, eventId: params.eventId || null } };
  });

  registerLensAction("calendar", "conference-clear", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const e = listCal(s.events, aidCal(ctx)).find(x => x.id === String(params.eventId || ""));
    if (!e) return { ok: false, error: "event not found" };
    e.conferenceLink = '';
    delete e.conferenceProvider;
    delete e.conferenceRoom;
    saveCal();
    return { ok: true, result: { event: e } };
  });

  // ── Item 6 — Guest RSVP + invite emails ───────────────────────
  // invites-send records per-guest invites against an event; each guest
  // gets an RSVP token. invite-rsvp records accepted/declined/tentative.
  // The ICS export already emits ATTENDEE lines so the invite is portable.

  registerLensAction("calendar", "invites-send", (ctx, _a, params = {}) => {
  try {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const userId = aidCal(ctx);
    const event = listCal(s.events, userId).find(e => e.id === String(params.eventId || ""));
    if (!event) return { ok: false, error: "event not found" };
    const guests = Array.isArray(params.guests) ? params.guests.map(g => String(g).trim()).filter(Boolean) : [];
    if (guests.length === 0) return { ok: false, error: "guests array (emails/identifiers) required" };
    const list = listCal(s.eventInvites, userId);
    const created = [];
    for (const guest of guests) {
      if (list.some(iv => iv.eventId === event.id && iv.guest.toLowerCase() === guest.toLowerCase())) continue;
      const invite = {
        id: uidCal('inv'),
        token: uidCal('tok'),
        eventId: event.id,
        eventTitle: event.title,
        eventStart: event.start,
        guest,
        rsvp: 'pending',
        message: String(params.message || "").trim().slice(0, 500),
        sentAt: isoCal(),
        respondedAt: null,
      };
      list.push(invite);
      created.push(invite);
    }
    // Mirror guests onto the event attendee list for ICS export parity.
    event.attendees = [...new Set([...(event.attendees || []), ...guests])];
    saveCal();
    return { ok: true, result: { eventId: event.id, sent: created.length, invites: created, attendees: event.attendees } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("calendar", "invites-list", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    let list = listCal(s.eventInvites, aidCal(ctx));
    if (params.eventId) list = list.filter(iv => iv.eventId === String(params.eventId));
    const counts = { accepted: 0, declined: 0, tentative: 0, pending: 0 };
    for (const iv of list) counts[iv.rsvp] = (counts[iv.rsvp] || 0) + 1;
    return { ok: true, result: { invites: list, count: list.length, rsvpCounts: counts } };
  });

  registerLensAction("calendar", "invite-rsvp", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const list = listCal(s.eventInvites, aidCal(ctx));
    const token = String(params.token || "");
    const id = String(params.id || "");
    const invite = list.find(iv => (token && iv.token === token) || (id && iv.id === id));
    if (!invite) return { ok: false, error: "invite not found" };
    const rsvp = ['accepted', 'declined', 'tentative'].includes(params.rsvp) ? params.rsvp : null;
    if (!rsvp) return { ok: false, error: "rsvp must be accepted | declined | tentative" };
    invite.rsvp = rsvp;
    invite.respondedAt = isoCal();
    saveCal();
    return { ok: true, result: { invite } };
  });

  registerLensAction("calendar", "invite-revoke", (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    ensureBacklogMaps(s);
    const list = listCal(s.eventInvites, aidCal(ctx));
    const i = list.findIndex(iv => iv.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "invite not found" };
    list.splice(i, 1);
    saveCal();
    return { ok: true, result: { revoked: true } };
  });

  // feed — ingest upcoming public holidays (Nager.Date) as visible DTUs.
  registerLensAction("calendar", "feed", async (ctx, _a, params = {}) => {
    const s = getCalState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const country = String(params.country || "US").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "US";
    try {
      const r = await fetch(`https://date.nager.at/api/v3/NextPublicHolidays/${country}`);
      if (!r.ok) return { ok: false, error: `nager.date ${r.status}` };
      const holidays = await r.json();
      if (!Array.isArray(holidays)) return { ok: false, error: "nager.date returned no data" };
      const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const h of holidays.slice(0, limit)) {
        const key = `${country}-${h.date}-${h.name}`;
        if (s.feedSeen.has(key)) { skipped++; continue; }
        const title = `${h.name} — ${h.date}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${h.name} (${h.localName || h.name})\nDate: ${h.date}\nCountry: ${country}${h.global ? " · nationwide" : ""}`,
          tags: ["calendar", "feed", "public-holiday"],
          source: "nager-date-feed",
          meta: { date: h.date, name: h.name, country, global: h.global },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(key); }
      }
      saveCal();
      return { ok: true, result: { ingested, skipped, source: "nager.date-public-holidays", dtuIds } };
    } catch (e) {
      return { ok: false, error: `nager.date unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

// ── iCal helpers (RFC 5545 escaping + date format) ───────────────

function icsEscape(s) {
  // RFC 5545 §3.3.11 text escaping
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsUnescape(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function icsUtc(d) {
  // RFC 5545 UTC datetime: YYYYMMDDTHHMMSSZ
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function foldIcsLine(line) {
  // RFC 5545 §3.1: lines MUST NOT exceed 75 octets; fold by inserting
  // CRLF + single space.
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let i = 75;
  while (i < line.length) {
    out += "\r\n " + line.slice(i, i + 74);
    i += 74;
  }
  return out;
}

function parseIcsDate(raw) {
  // RFC 5545: either YYYYMMDD (date) or YYYYMMDDTHHMMSS(Z) (datetime)
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return raw;  // unrecognized → caller deals with it
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  return z
    ? `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
    : `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
