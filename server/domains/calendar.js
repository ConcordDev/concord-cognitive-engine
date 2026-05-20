// server/domains/calendar.js
// Domain actions for calendar: conflict detection, availability analysis,
// recurring event expansion, time zone conversion, schedule optimization.

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
      .sort((a, b) => { const pOrder = { critical: 0, high: 1, medium: 2, low: 3 }; return (pOrder[a.priority] || 2) - (pOrder[b.priority] || 2); });
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
    return STATE.calendarLens;
  }
  function saveCal() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) {} } }
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
  });

  registerLensAction("calendar", "events-create", (ctx, _a, params = {}) => {
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
  });

  // ── Availability / free slots ─────────────────────────────────

  registerLensAction("calendar", "availability-find", (ctx, _a, params = {}) => {
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
  });

  // ── Natural-language event create (Fantastical parity) ────────

  registerLensAction("calendar", "nl-parse-event", (ctx, _a, params = {}) => {
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
  });

  // ── AI scheduling (Reclaim.ai parity — auto-place tasks in free slots) ─

  registerLensAction("calendar", "ai-auto-schedule", (ctx, _a, params = {}) => {
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
  });

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("calendar", "calendar-dashboard-summary", (ctx, _a, _p = {}) => {
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
