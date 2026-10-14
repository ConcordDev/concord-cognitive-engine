/**
 * Mentorship program KPI invalidation — panels that mutate create/complete/
 * check-in notify the header strip (and Program tab) so they refetch
 * `program-report` without a manual Refresh click.
 */

export const MENTORSHIP_PROGRAM_CHANGED = 'mentorship:program-changed';

export function notifyMentorshipProgramChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MENTORSHIP_PROGRAM_CHANGED));
}
