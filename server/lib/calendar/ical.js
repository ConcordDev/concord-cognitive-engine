// server/lib/calendar/ical.js
//
// RFC 5545 (iCalendar) serialization + parsing. Promoted from the
// dead server/domains/calendar.js — full line-folding + escaping +
// VEVENT round-trip. No external deps. Used by the docs.export_ical
// macro + the public /calendar/:token.ics subscription feed route.

export function icsEscape(s) {
  // RFC 5545 §3.3.11 text escaping
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function icsUnescape(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function icsUtc(d) {
  // RFC 5545 UTC datetime: YYYYMMDDTHHMMSSZ
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function icsDateOnly(d) {
  // RFC 5545 DATE (no time)
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function foldIcsLine(line) {
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

export function parseIcsDate(raw) {
  // RFC 5545: either YYYYMMDD or YYYYMMDDTHHMMSS(Z)
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return raw;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  if (h === "00" && mi === "00" && s === "00" && !z && raw.length === 8) {
    return `${y}-${mo}-${d}`;
  }
  return z
    ? `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
    : `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/**
 * Serialize a normalised event array to an RFC 5545 .ics document.
 *
 * Events: [{ id, title, description, location, startAt (sec), endAt (sec),
 *            allDay, organizerEmail, attendeeEmails, rrule, conferencingUrl,
 *            externalUid }]
 */
export function eventsToIcs(events, { calendarName = "Concord Calendar", tz = "UTC" } = {}) {
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
    const startMs = (e.startAt ?? e.start ?? 0) * (e.startAt != null ? 1000 : 1);
    const endMs = (e.endAt ?? e.end ?? 0) * (e.endAt != null ? 1000 : 1);
    if (!Number.isFinite(startMs) || startMs === 0) continue;
    const uid = String(e.externalUid || e.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@concord-os`);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${icsUtc(new Date())}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(new Date(startMs))}`);
      if (endMs && endMs > startMs) lines.push(`DTEND;VALUE=DATE:${icsDateOnly(new Date(endMs))}`);
    } else {
      lines.push(`DTSTART:${icsUtc(new Date(startMs))}`);
      lines.push(`DTEND:${icsUtc(new Date(endMs || startMs + 3600 * 1000))}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title || e.summary || "Untitled event")}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(String(e.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(String(e.location))}`);
    if (e.conferencingUrl) lines.push(`URL:${icsEscape(String(e.conferencingUrl))}`);
    if (e.rrule) lines.push(`RRULE:${String(e.rrule).replace(/\r?\n/g, " ")}`);
    if (e.organizerEmail) lines.push(`ORGANIZER:mailto:${String(e.organizerEmail).replace(/[\r\n,;]/g, "")}`);
    for (const a of (e.attendeeEmails || [])) {
      lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${String(a).replace(/[\r\n,;]/g, "")}`);
    }
    lines.push("END:VEVENT");
    validCount++;
  }
  lines.push("END:VCALENDAR");
  const folded = lines.map(foldIcsLine).join("\r\n") + "\r\n";
  return { ics: folded, eventCount: validCount, calendarName, timezone: tz };
}

/**
 * Parse an RFC 5545 .ics document into a normalised event array.
 */
export function parseIcs(ics) {
  if (!ics || typeof ics !== "string") return { ok: false, error: "ics required" };
  if (!ics.includes("BEGIN:VCALENDAR")) return { ok: false, error: "not a VCALENDAR document" };
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  let calendarName = null, timezone = null;
  for (const line of lines) {
    if (line.startsWith("X-WR-CALNAME:")) calendarName = icsUnescape(line.slice("X-WR-CALNAME:".length));
    if (line.startsWith("X-WR-TIMEZONE:")) timezone = line.slice("X-WR-TIMEZONE:".length).trim();
    if (line === "BEGIN:VEVENT") { cur = { attendeeEmails: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const keyFull = line.slice(0, sep);
    const value = line.slice(sep + 1);
    const key = keyFull.split(";")[0].toUpperCase();
    const allDay = keyFull.includes("VALUE=DATE");
    switch (key) {
      case "UID":         cur.uid = value; break;
      case "SUMMARY":     cur.summary = icsUnescape(value); break;
      case "DESCRIPTION": cur.description = icsUnescape(value); break;
      case "LOCATION":    cur.location = icsUnescape(value); break;
      case "URL":         cur.url = value; break;
      case "DTSTART":     cur.start = parseIcsDate(value); cur.allDay = cur.allDay || allDay; break;
      case "DTEND":       cur.end = parseIcsDate(value); break;
      case "RRULE":       cur.rrule = value; break;
      case "ORGANIZER":   cur.organizerEmail = value.replace(/^mailto:/i, ""); break;
      case "ATTENDEE":    cur.attendeeEmails.push(value.replace(/^mailto:/i, "")); break;
    }
  }
  return { ok: true, events, eventCount: events.length, calendarName, timezone };
}
