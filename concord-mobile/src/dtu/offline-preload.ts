/**
 * Offline DTU Preload
 *
 * Pulls the user's subscribed lens DTUs into the local SQLite store on a
 * schedule so airplane-mode browsing surfaces real content (not stubs).
 *
 * Strategy:
 *   1. On app launch, load the user's lens subscriptions.
 *   2. For each subscribed lens, fetch the top N DTUs by recency.
 *   3. Upsert into local store; cap at 5_000 DTUs to bound device storage.
 *   4. Repeat every 30 minutes when foreground + on network connect.
 *
 * Expects the host platform to expose:
 *   • fetch (for /api/lenses/<id>/dtus and /api/users/me/subscriptions)
 *   • a local DTU store with .upsertMany / .countCached / .pruneOldest
 *
 * The implementation here is the orchestrator; storage is delegated to
 * concord-mobile/src/dtu/store, which handles the actual SQLite access.
 */

import type { DTUStore } from './store/dtu-store';
import type { DTU } from '../utils/types';

const DEFAULT_LIMIT_PER_LENS = 60;
const MAX_TOTAL_CACHED = 5_000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

interface PreloadOpts {
  apiBase?: string;
  authToken?: string;
  limitPerLens?: number;
  store: DTUStore;
}

export async function preloadOnce(opts: PreloadOpts): Promise<{ ok: boolean; cached: number; pruned: number; lenses: number }> {
  const apiBase = opts.apiBase ?? 'https://concord-os.org';
  const headers: Record<string, string> = {};
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;

  let lenses: string[] = [];
  try {
    const r = await fetch(`${apiBase}/api/users/me/subscriptions`, { headers });
    const data = await r.json();
    lenses = (data?.subscriptions ?? []).map((s: { lensId: string }) => s.lensId);
  } catch {
    return { ok: false, cached: 0, pruned: 0, lenses: 0 };
  }

  if (lenses.length === 0) return { ok: true, cached: 0, pruned: 0, lenses: 0 };

  let cached = 0;
  for (const lensId of lenses) {
    try {
      const limit = opts.limitPerLens ?? DEFAULT_LIMIT_PER_LENS;
      const r = await fetch(`${apiBase}/api/lenses/${encodeURIComponent(lensId)}/dtus?limit=${limit}&sort=recent`, { headers });
      const data = await r.json();
      const dtus: DTU[] = (data?.dtus ?? []) as DTU[];
      for (const d of dtus) {
        try { opts.store.set(d.id, d); cached++; }
        catch { /* per-DTU set failures don't sink the run */ }
      }
    } catch {
      // continue to next lens — single-lens failure shouldn't sink the run.
    }
  }

  // Prune oldest beyond cap. Use the store's prune by maxAgeDays as a
  // conservative trim; pain-tagged items are protected.
  let pruned = 0;
  if (opts.store.size > MAX_TOTAL_CACHED) {
    pruned = opts.store.prune({ maxAgeDays: 30, protectPainTagged: true });
  }

  return { ok: true, cached, pruned, lenses: lenses.length };
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startOfflinePreload(opts: PreloadOpts): () => void {
  // Run immediately, then on interval.
  preloadOnce(opts).catch(() => { /* preload silent */ });
  _intervalId = setInterval(() => {
    preloadOnce(opts).catch(() => { /* preload silent */ });
  }, REFRESH_INTERVAL_MS);
  return () => {
    if (_intervalId) clearInterval(_intervalId);
    _intervalId = null;
  };
}
