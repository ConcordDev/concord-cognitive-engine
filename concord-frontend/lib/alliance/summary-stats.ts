/**
 * Alliance summary KPI invalidation — workspace mutations that change
 * alliance membership / proposal / unread counts notify the header strip
 * so it refetches `alliance-list` + `notifications` without a manual Refresh.
 */

export const ALLIANCE_SUMMARY_CHANGED = 'alliance:summary-changed';

export function notifyAllianceSummaryChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ALLIANCE_SUMMARY_CHANGED));
}
