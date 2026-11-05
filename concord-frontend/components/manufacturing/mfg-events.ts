'use client';

/**
 * Manufacturing mutation notify (Review 5 finding F8 — the header-lag
 * genus): the page's KPI strip reads four manufacturing macros through
 * react-query with a 15s staleTime, and nothing told it when a panel
 * changed the underlying objects, so the header counters sat at their
 * first-load values until a reload. Panels dispatch this event after a
 * successful mutation; the page refetches its KPIs on it. No polling.
 */
export const MFG_MUTATED_EVENT = 'manufacturing:mutated';

export function notifyManufacturingMutated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MFG_MUTATED_EVENT));
}
