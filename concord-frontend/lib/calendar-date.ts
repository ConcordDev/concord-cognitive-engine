/**
 * Calendar dates for user-facing day keys.
 *
 * `Date#toISOString().slice(0, 10)` is the UTC day. In the evening west of
 * UTC that is already tomorrow, so a journal header, an entry key, and a
 * calendar highlight land on a day the user is not in — and a reload that
 * looks the entry up by the local day finds nothing.
 *
 * These helpers name the calendar day in an IANA zone: the profile timezone
 * when one is set, otherwise the browser's zone.
 */

export interface CalendarProfile {
  timezone?: string | null;
  timeZone?: string | null;
  preferences?: { timezone?: string | null; timeZone?: string | null } | null;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Profile IANA zone when the account has one set, otherwise null. */
export function profileTimeZone(profile: CalendarProfile | null | undefined): string | null {
  if (!profile) return null;
  const prefs = profile.preferences;
  const candidates = [profile.timezone, profile.timeZone, prefs?.timezone, prefs?.timeZone];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && isValidTimeZone(candidate)) return candidate;
  }
  return null;
}

/** Profile zone if set and valid, otherwise the browser zone. */
export function resolveCalendarTimeZone(profileTz?: string | null): string {
  if (profileTz && isValidTimeZone(profileTz)) return profileTz;
  return browserTimeZone();
}

/**
 * YYYY-MM-DD for an instant in `timeZone` (default: the browser zone).
 * Pass `resolveCalendarTimeZone(profileTimeZone(user))` when a profile zone may be set.
 */
export function calendarDateKey(instant: Date = new Date(), timeZone?: string): string {
  if (Number.isNaN(instant.getTime())) return '';
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : browserTimeZone();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Add calendar days to a YYYY-MM-DD key. The key is a calendar day, not an instant. */
export function shiftDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY.exec(dateKey);
  if (!match) return dateKey;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A stored day key, or an ISO instant reinterpreted in `timeZone`.
 * Bare YYYY-MM-DD values are calendar keys and are not parsed as UTC instants.
 */
export function coerceDateKey(raw: unknown, timeZone?: string): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim();
  if (DATE_KEY.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return calendarDateKey(parsed, timeZone);
  }
  return '';
}

/** "Saturday, October 10" (or with the year) for a calendar-day key. */
export function formatDateKey(dateKey: string, opts?: { year?: boolean }): string {
  const match = DATE_KEY.exec(dateKey);
  if (!match) return dateKey;
  const utcNoon = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: opts?.year ? 'numeric' : undefined,
  }).format(utcNoon);
}

// ── Wall time in a zone ⇄ instant (S1: one true time) ─────────────────
// An event is authored as wall-clock time in its own IANA zone and stored
// as a true UTC instant. These helpers convert between the two without
// ever routing through UTC wall-clock strings (the old form binding used
// `toISOString().slice(0, 16)`, which displays UTC time in a local picker
// and stores the entered wall clock as if it were UTC).

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock fields of an instant as seen in `timeZone`. */
export function zonedParts(timeZone: string, instant: Date): ZonedParts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as unknown as ZonedParts;
}

/** Offset (wall − UTC) of `timeZone` at `utcMs`, in milliseconds. */
export function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const p = zonedParts(timeZone, new Date(utcMs));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant for a wall-clock time in `timeZone`. */
export function zonedWallTimeToUtc(
  timeZone: string,
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
): Date {
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  let utc = wallAsUtc - zoneOffsetMs(timeZone, wallAsUtc);
  const refined = wallAsUtc - zoneOffsetMs(timeZone, utc);
  if (refined !== utc) utc = refined; // transition-adjacent: use the offset in force at the result
  return new Date(utc);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` wall-clock string for an instant in `timeZone` — the
 *  value a `datetime-local` input must show when editing in that zone. */
export function toZonedInputValue(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) return '';
  const p = zonedParts(timeZone, instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

const INPUT_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parse a `datetime-local` value as wall time in `timeZone` → true instant.
 *  Returns null for empty/invalid input (callers keep the previous value). */
export function fromZonedInputValue(value: string, timeZone: string): Date | null {
  const m = INPUT_VALUE.exec(value || '');
  if (!m) return null;
  return zonedWallTimeToUtc(timeZone, {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] || 0),
  });
}

/** Short zone abbreviation for an instant, e.g. "EDT" / "PST". */
export function zoneAbbrev(timeZone: string, instant: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      timeZoneName: 'short',
    }).formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

/** "New York" from "America/New_York"; "UTC" stays "UTC". */
export function zoneCityLabel(timeZone: string): string {
  const tail = timeZone.split('/').pop() || timeZone;
  return tail.replace(/_/g, ' ');
}

/** Common zones offered by the event form's zone picker (the event's own
 *  zone and the viewer's zone are always added by the caller). */
export const COMMON_TIME_ZONES: string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];


/** The next clean one-hour slot in `timeZone`: the first full hour that
 *  starts comfortably after `now` (the probe jumps 90 minutes ahead and
 *  floors to the hour in the zone), plus the instant one hour later.
 *  Form defaults use this so a fresh form never opens with a
 *  zero-duration Start = End at the current instant (F13). */
export function nextHourSlotInZone(timeZone: string, now: Date = new Date()): { start: Date; end: Date } {
  const probe = new Date(now.getTime() + 90 * 60_000);
  const p = zonedParts(timeZone, probe);
  const start = zonedWallTimeToUtc(timeZone, {
    year: p.year, month: p.month, day: p.day, hour: p.hour, minute: 0, second: 0,
  });
  return { start, end: new Date(start.getTime() + 3_600_000) };
}
