// server/lib/calendar/recurrence.js
//
// Minimal RRULE expansion. Supports the RFC 5545 subset that covers
// 95% of real calendar usage:
//   FREQ = DAILY | WEEKLY | MONTHLY | YEARLY
//   INTERVAL = N (default 1)
//   COUNT = N
//   UNTIL = YYYYMMDD or YYYYMMDDTHHMMSSZ
//   BYDAY = MO,TU,WE,TH,FR,SA,SU (WEEKLY only)
//   BYMONTHDAY = N (MONTHLY only)
//
// No external dep (rrule.js would be 200KB). Implemented in ~120 LOC
// against ourselves' unit tests + the existing dead calendar.js
// pass-through. Returns instances in chronological order.

const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function parseRrule(rrule) {
  if (!rrule || typeof rrule !== "string") return null;
  const parts = rrule.replace(/^RRULE:/i, "").split(";");
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    const key = k.trim().toUpperCase();
    switch (key) {
      case "FREQ":       out.freq = v.trim().toUpperCase(); break;
      case "INTERVAL":   out.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case "COUNT":      out.count = Math.max(1, parseInt(v, 10) || 0); break;
      case "UNTIL":      out.until = parseRruleDate(v.trim()); break;
      case "BYDAY":      out.byDay = v.split(",").map((d) => d.trim().toUpperCase()).filter((d) => d in DAY_MAP); break;
      case "BYMONTHDAY": out.byMonthDay = v.split(",").map((n) => parseInt(n, 10)).filter(Number.isFinite); break;
      case "WKST":       out.wkst = v.trim().toUpperCase(); break;
    }
  }
  if (!out.freq) return null;
  out.interval = out.interval || 1;
  return out;
}

function parseRruleDate(s) {
  // YYYYMMDD or YYYYMMDDTHHMMSSZ
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
}

/**
 * Expand a recurring event into individual occurrence start times.
 *
 * Inputs:
 *   start: Date | number (epoch seconds | ms)
 *   rrule: RFC 5545 RRULE string
 *   options: { until?: Date, maxOccurrences?: number, windowStart?: Date, windowEnd?: Date }
 *
 * Returns: { ok, occurrences: [{ index, start (epoch sec) }], total }
 *
 * maxOccurrences caps the expansion for safety (default 500). For
 * UNLIMITED rules (no COUNT/UNTIL), use windowEnd to bound.
 */
export function expand(start, rrule, options = {}) {
  const parsed = parseRrule(rrule);
  if (!parsed) return { ok: false, error: "invalid_rrule" };
  const startDate = start instanceof Date ? start : new Date(typeof start === "number" && start < 1e12 ? start * 1000 : start);
  if (Number.isNaN(startDate.getTime())) return { ok: false, error: "invalid_start" };

  const maxOcc = Math.min(Number(options.maxOccurrences) || 500, 5000);
  const windowEnd = options.windowEnd instanceof Date ? options.windowEnd
    : options.windowEnd ? new Date(options.windowEnd) : null;
  const explicitUntil = parsed.until || (options.until instanceof Date ? options.until : null);
  const totalCap = parsed.count || maxOcc;

  const occurrences = [];
  let cursor = new Date(startDate);
  let i = 0;
  const step = parsed.interval;

  while (i < totalCap && occurrences.length < maxOcc) {
    if (explicitUntil && cursor > explicitUntil) break;
    if (windowEnd && cursor > windowEnd) break;

    if (parsed.freq === "DAILY") {
      _push(occurrences, i, cursor, options);
      cursor = _addDays(cursor, step);
    } else if (parsed.freq === "WEEKLY") {
      if (parsed.byDay && parsed.byDay.length > 0) {
        // Expand each week into the byDay matches
        const weekStart = _addDays(cursor, -((cursor.getUTCDay() + 6) % 7)); // Monday-anchored
        for (const dayCode of parsed.byDay) {
          const dayNum = DAY_MAP[dayCode];
          const dayOff = (dayNum + 6) % 7; // Monday=0
          const inst = _addDays(weekStart, dayOff);
          if (inst < startDate) continue;
          if (explicitUntil && inst > explicitUntil) continue;
          if (windowEnd && inst > windowEnd) continue;
          _push(occurrences, i, inst, options);
          if (occurrences.length >= maxOcc) break;
        }
      } else {
        _push(occurrences, i, cursor, options);
      }
      cursor = _addDays(cursor, 7 * step);
    } else if (parsed.freq === "MONTHLY") {
      if (parsed.byMonthDay && parsed.byMonthDay.length > 0) {
        for (const md of parsed.byMonthDay) {
          const dt = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), md,
            cursor.getUTCHours(), cursor.getUTCMinutes(), cursor.getUTCSeconds()));
          if (dt < startDate) continue;
          if (explicitUntil && dt > explicitUntil) continue;
          if (windowEnd && dt > windowEnd) continue;
          _push(occurrences, i, dt, options);
          if (occurrences.length >= maxOcc) break;
        }
      } else {
        _push(occurrences, i, cursor, options);
      }
      cursor = _addMonths(cursor, step);
    } else if (parsed.freq === "YEARLY") {
      _push(occurrences, i, cursor, options);
      cursor = _addYears(cursor, step);
    } else {
      return { ok: false, error: `unsupported_freq_${parsed.freq}` };
    }
    i++;
  }

  // Trim by windowStart
  const ws = options.windowStart instanceof Date ? options.windowStart : null;
  const filtered = ws ? occurrences.filter((o) => o.start * 1000 >= ws.getTime()) : occurrences;
  filtered.sort((a, b) => a.start - b.start);
  return { ok: true, occurrences: filtered, total: filtered.length, rule: parsed };
}

function _push(arr, index, date, options) {
  const ws = options.windowStart instanceof Date ? options.windowStart : null;
  if (ws && date < ws) return;
  arr.push({ index, start: Math.floor(date.getTime() / 1000) });
}

function _addDays(d, n) { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }
function _addMonths(d, n) { const c = new Date(d); c.setUTCMonth(c.getUTCMonth() + n); return c; }
function _addYears(d, n) { const c = new Date(d); c.setUTCFullYear(c.getUTCFullYear() + n); return c; }
