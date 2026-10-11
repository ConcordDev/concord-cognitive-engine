/**
 * Calendar day in the viewer's local timezone, YYYY-MM-DD.
 *
 * `Date#toISOString()` is UTC, so a snapshot taken at night in US Eastern
 * lands on tomorrow. This uses the local calendar fields instead.
 *
 * PR #1123 (open) adds `lib/calendar-date.ts` as the shared helper for this.
 * Finance keeps this file so the two branches do not both create that module.
 * When #1123 merges, SnapshotModal should import the shared helper.
 */
export function localCalendarDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
