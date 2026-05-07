/**
 * useOfflineFirst — Offline-First Data Routing Hook
 *
 * Every data request follows:
 *   IndexedDB → Server → User Cloud → Offline fallback
 *
 * The fastest available source wins. No loading spinners for local data.
 * Network requests happen in background to refresh the cache.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDB, isOnline } from '@/lib/offline/db';
import { downloadArtifact, isCloudConnected } from '@/lib/offline/cloud-bridge';
import type { ExternalRef } from '@/lib/offline/cloud-bridge';
import { touchDTU } from '@/lib/offline/storage-manager';

// ── Types ─────────────────────────────────────────────────

type DataSource = 'cache' | 'server' | 'cloud' | 'offline';

interface OfflineFirstResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  source: DataSource;
  stale: boolean;         // true if showing cached data while refreshing
  refresh: () => void;    // manually trigger a refresh
}

interface UseOfflineFirstOptions {
  /** Cache key for IndexedDB lookup */
  cacheKey?: string;
  /** Whether to auto-refresh from server when online */
  backgroundRefresh?: boolean;
  /** Cloud ref for artifact fallback */
  cloudRef?: ExternalRef;
  /** TTL in ms for cache freshness (default: 5 minutes) */
  cacheTTL?: number;
}

// ── Generic cache in IndexedDB ────────────────────────────
// Uses the dtus table for DTU data, or a lightweight localStorage cache for other data

function getCacheTimestamp(key: string): number {
  try {
    return Number(localStorage.getItem(`_cache_ts_${key}`)) || 0;
  } catch {
    return 0;
  }
}

function setCacheTimestamp(key: string): void {
  try {
    localStorage.setItem(`_cache_ts_${key}`, String(Date.now()));
  } catch {
    // localStorage full — not critical
  }
}

// ── Hook ──────────────────────────────────────────────────

/**
 * Fetch a DTU with offline-first routing.
 * Instantly returns cached data, refreshes from server in background.
 */
export function useOfflineFirstDTU(dtuId: string | null) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('cache');
  const [stale, setStale] = useState(false);
  const mountedRef = useRef(true);

  const fetch_ = useCallback(async () => {
    if (!dtuId) return;

    // Layer 1: IndexedDB (instant, local)
    try {
      const cached = await getDB().dtus.get(dtuId);
      if (cached) {
        if (mountedRef.current) {
          setData(cached);
          setSource('cache');
          setLoading(false);
          setStale(true); // will refresh in background
          touchDTU(dtuId);
        }
      }
    } catch {
      // IDB not available — continue to server
    }

    // Layer 2: Server (if online)
    if (isOnline()) {
      try {
        const res = await globalThis.fetch(`/api/dtus/${dtuId}`);
        if (res.ok) {
          const serverData = await res.json();
          if (mountedRef.current) {
            setData(serverData);
            setSource('server');
            setStale(false);
            setLoading(false);
          }
          // Cache locally
          try {
            await getDB().dtus.put({ ...serverData, synced: true });
            touchDTU(dtuId);
          } catch {
            // Cache write failed — non-critical
          }
          return;
        }
      } catch {
        // Server unreachable — fall through
      }
    }

    // Layer 3: Already have cache data? We're done (stale but available)
    if (data) {
      if (mountedRef.current) {
        setStale(true);
        setLoading(false);
      }
      return;
    }

    // No data at all
    if (mountedRef.current) {
      setError('offline, data not cached locally');
      setSource('offline');
      setLoading(false);
    }
  }, [dtuId, data]);

  useEffect(() => {
    mountedRef.current = true;
    fetch_();
    return () => { mountedRef.current = false; };
  }, [fetch_]);

  return { data, loading, error, source, stale, refresh: fetch_ };
}

/**
 * Fetch any API endpoint with offline-first routing.
 * Uses localStorage as a lightweight cache for non-DTU data.
 */
export function useOfflineFirst<T = unknown>(
  endpoint: string | null,
  options: UseOfflineFirstOptions = {}
): OfflineFirstResult<T> {
  const {
    cacheKey,
    backgroundRefresh = true,
    cloudRef,
    cacheTTL = 5 * 60 * 1000,
  } = options;

  const key = cacheKey || endpoint || '';
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('cache');
  const [stale, setStale] = useState(false);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  const doFetch = useCallback(async () => {
    if (!endpoint || fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // Layer 1: Check cache (instant)
      const cached = localStorage.getItem(`_cache_${key}`);
      const cacheAge = Date.now() - getCacheTimestamp(key);
      const cacheValid = cached && cacheAge < cacheTTL;

      if (cached) {
        try {
          const parsed = JSON.parse(cached) as T;
          if (mountedRef.current) {
            setData(parsed);
            setSource('cache');
            setLoading(false);
            setStale(!cacheValid);
          }
          if (cacheValid && !backgroundRefresh) return;
        } catch {
          // Bad cache — ignore
        }
      }

      // Layer 2: Server (if online)
      if (isOnline()) {
        try {
          const res = await globalThis.fetch(endpoint, { credentials: 'include' });
          if (res.ok) {
            const serverData = await res.json() as T;
            if (mountedRef.current) {
              setData(serverData);
              setSource('server');
              setStale(false);
              setLoading(false);
              setError(null);
            }
            // Update cache
            try {
              localStorage.setItem(`_cache_${key}`, JSON.stringify(serverData));
              setCacheTimestamp(key);
            } catch {
              // localStorage full — non-critical
            }
            return;
          }
        } catch {
          // Network error — fall through
        }
      }

      // Layer 3: Cloud storage (for artifacts with external refs)
      if (cloudRef && isCloudConnected()) {
        try {
          const blob = await downloadArtifact(cloudRef);
          if (blob && mountedRef.current) {
            // For binary data, create an object URL
            const url = URL.createObjectURL(blob);
            setData({ url, blob, ref: cloudRef } as unknown as T);
            setSource('cloud');
            setStale(false);
            setLoading(false);
            return;
          }
        } catch {
          // Cloud unavailable — fall through
        }
      }

      // Layer 4: Offline fallback
      if (!data && mountedRef.current) {
        setError('offline, data not cached locally');
        setSource('offline');
        setLoading(false);
      }
    } finally {
      fetchingRef.current = false;
    }
  }, [endpoint, key, backgroundRefresh, cloudRef, cacheTTL, data]);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();
    return () => { mountedRef.current = false; };
  }, [doFetch]);

  return { data, loading, error, source, stale, refresh: doFetch };
}

/**
 * Hook to track sync queue status.
 * Shows sync indicator for offline-queued actions.
 */
export function useSyncStatus() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    // Check pending actions count
    const check = async () => {
      try {
        const db = getDB();
        const count = await db.pendingActions.filter(a => !a.quarantined).count();
        setPending(count);
      } catch {
        // IDB not available
      }
    };

    check();
    const interval = setInterval(check, 5000);

    const cleanup = (() => {
      const onOnline = () => { setOnline(true); check(); };
      const onOffline = () => setOnline(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    })();

    return () => {
      clearInterval(interval);
      cleanup();
    };
  }, []);

  return { pending, online, syncing: false };
}
