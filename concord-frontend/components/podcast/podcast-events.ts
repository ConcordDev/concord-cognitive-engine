/**
 * podcast-events — one change signal for the whole lens.
 *
 * The lens's sections (creator desk, player section, listening hub,
 * iTunes search) each read the same server store but mount as siblings;
 * a mutation in one had no way to settle the others in-session, so
 * counters and headers only agreed after a full reload. Sections now
 * dispatch this event after a mutation lands, and sections that render
 * derived state subscribe and re-read. The server store stays the only
 * source of truth — this carries no data, just "read again".
 */

export const PODCAST_CHANGED_EVENT = 'podcast:changed';

export function notifyPodcastChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PODCAST_CHANGED_EVENT));
  }
}

export function onPodcastChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PODCAST_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PODCAST_CHANGED_EVENT, handler);
}
