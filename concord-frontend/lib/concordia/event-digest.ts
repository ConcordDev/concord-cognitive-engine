// concord-frontend/lib/concordia/event-digest.ts
//
// Track 3 — event-feed curation (the DF lesson: never flood; batch into digests,
// prioritise). The feed subscribes to 60+ event kinds and streamed them flat at
// equal weight, so the "the world is alive" moment drowned in low-priority noise
// and a faction war read as 20 separate clash rows. This is the pure curation
// core: a priority tier per kind + a batcher that clusters a burst of the same
// kind into one digest row ("Faction clash ×6") while critical beats never batch
// and always sort to the top.

export type EventPriority = 'critical' | 'major' | 'ambient';

// Critical = a phase-change a player must not miss. Major = a discrete win/event.
// Ambient = background simulation texture (batched hardest, dropped first).
const CRITICAL = /(:fallen|:contested|faction-war|refusal-field|world:crisis|boss|:plague|uprising|:declared)/i;
const MAJOR = /(kingdom:founded|quest|:promoted|combo-evolved|tame-success|level-up|:enacted|scheme-resolved|prediction:realised)/i;

export function eventPriority(name: string, channel?: string): EventPriority {
  const n = String(name || '');
  if (CRITICAL.test(n) || channel === 'crisis') return 'critical';
  if (MAJOR.test(n)) return 'major';
  return 'ambient';
}

export interface FeedItem {
  id: string;
  name: string;
  channel?: string;
  label: string;
  priority: EventPriority;
  count: number;
  firstAt: number;
  lastAt: number;
}

export interface DigestOpts {
  batchWindowMs?: number; // same-kind events within this window coalesce
  max?: number;           // cap the feed length
  now?: number;
}

const PRIORITY_RANK: Record<EventPriority, number> = { critical: 3, major: 2, ambient: 1 };

/**
 * Ingest one event into the feed list, batching + prioritising. PURE (returns a
 * new array). Critical events always get their own row; ambient/major bursts of
 * the same kind coalesce into a single row with a count.
 */
export function ingestEvent(items: FeedItem[], ev: { name: string; channel?: string; label: string }, opts: DigestOpts = {}): FeedItem[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.batchWindowMs ?? 4000;
  const max = opts.max ?? 50;
  const priority = eventPriority(ev.name, ev.channel);

  // Critical never batches — each is its own beat.
  if (priority !== 'critical') {
    const idx = items.findIndex((it) => it.name === ev.name && it.priority !== 'critical' && now - it.lastAt <= windowMs);
    if (idx >= 0) {
      const next = items.slice();
      const cur = next[idx];
      next[idx] = { ...cur, count: cur.count + 1, lastAt: now, label: ev.label };
      return sortAndCap(next, max);
    }
  }

  const item: FeedItem = {
    id: `${ev.name}:${now}:${Math.random().toString(36).slice(2, 7)}`,
    name: ev.name, channel: ev.channel, label: ev.label,
    priority, count: 1, firstAt: now, lastAt: now,
  };
  return sortAndCap([item, ...items], max);
}

/** Critical first, then most-recent; cap length (ambient drops off the tail first). */
function sortAndCap(items: FeedItem[], max: number): FeedItem[] {
  const sorted = items.slice().sort((a, b) => {
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (pr !== 0) return pr;
    return b.lastAt - a.lastAt;
  });
  if (sorted.length <= max) return sorted;
  // Over cap: keep all critical + the most-recent of the rest.
  const critical = sorted.filter((i) => i.priority === 'critical');
  const rest = sorted.filter((i) => i.priority !== 'critical').slice(0, Math.max(0, max - critical.length));
  return [...critical, ...rest].sort((a, b) => {
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    return pr !== 0 ? pr : b.lastAt - a.lastAt;
  });
}

/** A human label for a digested row (adds the ×count when batched). */
export function digestLabel(item: FeedItem): string {
  return item.count > 1 ? `${item.label} ×${item.count}` : item.label;
}
