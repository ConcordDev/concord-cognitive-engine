/**
 * Creative dashboard bus — a tiny window CustomEvent so the production
 * tabs (ProductionSuite) and the Milanote-shape boards (CreativeBoardsSection)
 * can tell `CreativeDashboardStrip` its headline stats are stale, without a
 * shared store or a full react-query migration of either side.
 *
 * Fixes a real staleness gap: the strip only fetched once on mount, so its
 * counts were correct on a fresh page load/settled reading but silently
 * wrong for the rest of the session once the user created/changed anything
 * the strip summarizes (boards, review assets, call sheets, deliverables,
 * calendar events, proof links).
 */

const EVENT_NAME = 'creative:dashboard-dirty';

export function notifyCreativeDashboardDirty(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function onCreativeDashboardDirty(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
