// server/lib/calendar/scheduling.js
//
// Conflict detection + availability slot finding. Promoted from the
// dead domains/calendar.js and extended to work against the
// migration-217 calendar_events table (not just in-memory artifacts).
//
// detectConflicts: pairs of events whose time windows overlap.
// findAvailability: free slots within working hours of N consecutive days.
// busyMap: per-minute occupancy bitmap for fast intersection checks.

/**
 * Find overlap pairs in a sorted-by-start event array.
 *
 * Events: [{ id, title, startAt, endAt }]
 */
export function detectConflicts(events) {
  if (!Array.isArray(events) || events.length < 2) return { conflicts: [], total: events?.length || 0 };
  const sorted = [...events].sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
  const conflicts = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (a.endAt > b.startAt && a.startAt < b.endAt) {
        const overlapSeconds = Math.min(a.endAt, b.endAt) - b.startAt;
        conflicts.push({
          eventA: { id: a.id, title: a.title },
          eventB: { id: b.id, title: b.title },
          overlapMinutes: Math.round(overlapSeconds / 60),
          overlapSeconds,
        });
      } else if (b.startAt > a.endAt + 4 * 3600) {
        // No more potentially-overlapping events for `a`
        break;
      }
    }
  }
  return { conflicts, total: sorted.length, conflictCount: conflicts.length, conflictFree: conflicts.length === 0 };
}

/**
 * Find free slots within working hours of a given day. Returns slots
 * larger than or equal to `slotMinutes`.
 *
 * Events: pre-filtered to that calendar day.
 *
 * Options: { dayStartTs, dayEndTs, slotMinutes = 30 }
 */
export function findAvailability(events, { dayStartTs, dayEndTs, slotMinutes = 30 } = {}) {
  if (!dayStartTs || !dayEndTs) return { slots: [], error: "missing_day_bounds" };
  const slotSeconds = slotMinutes * 60;
  const dayEvents = (events || [])
    .map((e) => ({ startAt: e.startAt, endAt: e.endAt }))
    .filter((e) => e.startAt < dayEndTs && e.endAt > dayStartTs)
    .map((e) => ({ startAt: Math.max(e.startAt, dayStartTs), endAt: Math.min(e.endAt, dayEndTs) }))
    .sort((a, b) => a.startAt - b.startAt);
  const slots = [];
  let cursor = dayStartTs;
  for (const evt of dayEvents) {
    if (cursor < evt.startAt) {
      const gap = evt.startAt - cursor;
      if (gap >= slotSeconds) {
        slots.push({ startAt: cursor, endAt: evt.startAt, minutes: Math.round(gap / 60) });
      }
    }
    cursor = Math.max(cursor, evt.endAt);
  }
  if (cursor < dayEndTs) {
    const gap = dayEndTs - cursor;
    if (gap >= slotSeconds) {
      slots.push({ startAt: cursor, endAt: dayEndTs, minutes: Math.round(gap / 60) });
    }
  }
  const totalFreeMinutes = slots.reduce((s, sl) => s + sl.minutes, 0);
  return { slots, totalFreeMinutes, eventsConsidered: dayEvents.length };
}

/**
 * Compute working-hour day bounds in UTC seconds for a given date.
 *
 * date: 'YYYY-MM-DD'
 * workStartHour / workEndHour: 0–24 local-clock hours interpreted in UTC
 *   (calendar lens stores everything in epoch seconds; timezone overlay
 *   is handled at render time, not at slot computation).
 */
export function dayBounds(date, workStartHour = 9, workEndHour = 17) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return null;
  const [, y, mo, d] = m;
  const dayStartTs = Math.floor(Date.UTC(+y, +mo - 1, +d, workStartHour, 0, 0) / 1000);
  const dayEndTs = Math.floor(Date.UTC(+y, +mo - 1, +d, workEndHour, 0, 0) / 1000);
  return { dayStartTs, dayEndTs };
}

/**
 * Score how "free" a 24h period is. Used by ai_auto_schedule for
 * ranking candidate slots when fitting tasks. Higher score = better
 * (longer continuous blocks, fewer fragmented gaps).
 */
export function freenessScore(events, dayStartTs, dayEndTs) {
  const totalSeconds = dayEndTs - dayStartTs;
  if (totalSeconds <= 0) return 0;
  const dayEvents = (events || [])
    .filter((e) => e.startAt < dayEndTs && e.endAt > dayStartTs)
    .sort((a, b) => a.startAt - b.startAt);
  const busySeconds = dayEvents.reduce((s, e) => s + Math.max(0, Math.min(e.endAt, dayEndTs) - Math.max(e.startAt, dayStartTs)), 0);
  const freePct = 1 - busySeconds / totalSeconds;
  // Continuity bonus: longest free block
  let longest = 0, cursor = dayStartTs;
  for (const evt of dayEvents) {
    const start = Math.max(evt.startAt, dayStartTs);
    if (start > cursor) longest = Math.max(longest, start - cursor);
    cursor = Math.max(cursor, evt.endAt);
  }
  if (cursor < dayEndTs) longest = Math.max(longest, dayEndTs - cursor);
  const continuity = longest / totalSeconds;
  return Math.round((freePct * 50 + continuity * 50) * 10) / 10;
}
