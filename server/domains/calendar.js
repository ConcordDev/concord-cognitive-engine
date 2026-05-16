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
