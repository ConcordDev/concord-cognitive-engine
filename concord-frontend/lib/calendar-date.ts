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
