// Labels for a flat ESPN scoreboard event. The handler returns status as
// a string plus completed, state, clock, and date. A finished game with
// no description still reads Final.

export interface ScoreEvent {
  status?: string | null;
  completed?: boolean | null;
  state?: string | null;
  clock?: string | null;
  date?: string | null;
}

export function isLiveScore(e: ScoreEvent): boolean {
  return e.state === 'in' && e.completed !== true;
}

export function isFinalScore(e: ScoreEvent): boolean {
  return e.completed === true || e.state === 'post';
}

export function scoreboardStatusLabel(e: ScoreEvent): string {
  const text = typeof e.status === 'string' && e.status.trim() ? e.status.trim() : '';
  if (isFinalScore(e)) return text || 'Final';
  if (isLiveScore(e)) {
    const clock = typeof e.clock === 'string' && e.clock.trim() ? e.clock.trim() : '';
    const head = text || 'Live';
    return clock ? `${head} · ${clock}` : head;
  }
  return text || 'Scheduled';
}

export function scoreboardDateLabel(date?: string | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}
