/** Date classification for an event. Today is the UTC day, same clock as isToday. */

export type EventWhen = 'past' | 'upcoming' | 'undated';

export function eventDay(date: unknown): string {
  if (typeof date !== 'string') return '';
  const day = date.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A day before today is past. Today and later are upcoming. A missing day is neither. */
export function classifyEventDate(date: unknown, today: string): EventWhen {
  const day = eventDay(date);
  if (!day) return 'undated';
  return day < today ? 'past' : 'upcoming';
}

export function countsAsPast(date: unknown, today: string): boolean {
  return classifyEventDate(date, today) === 'past';
}

/** Cancelled events are not upcoming. A past date is not upcoming, whatever the status. */
export function countsAsUpcoming(date: unknown, status: unknown, today: string): boolean {
  if (status === 'cancelled') return false;
  return classifyEventDate(date, today) === 'upcoming';
}
