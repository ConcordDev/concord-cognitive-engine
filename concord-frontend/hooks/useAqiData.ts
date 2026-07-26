'use client';

// useAqiData — shared geolocation + live AQI fetch for the eco lens.
// Extracted from AQIPanel so the Overview hero and the Air-quality tab
// read the exact same real Open-Meteo-backed `eco.aqi-current` response
// instead of duplicating the fetch/geolocation dance with two copies that
// could silently drift. `refresh()` triggers a genuine re-fetch (bumps a
// generation counter) — it does not fabricate a new reading, it re-asks
// the real macro.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';

export interface AqiData {
  aqi: number;
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  co: number;
  so2: number;
  category: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';
  recommendation: string;
  source: string;
  lat: number;
  lng: number;
}

interface UseAqiDataOptions {
  lat?: number;
  lng?: number;
}

interface UseAqiDataResult {
  data: AqiData | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  refresh: () => void;
}

export function useAqiData({ lat, lng }: UseAqiDataOptions = {}): UseAqiDataResult {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null
  );
  const [data, setData] = useState<AqiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!coords && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCoords({ lat: 37.7749, lng: -122.4194 }),
        { maximumAge: 5 * 60 * 1000, timeout: 5000 }
      );
    }
  }, [coords]);

  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', {
          domain: 'eco', action: 'aqi-current',
          input: { lat: coords.lat, lng: coords.lng },
        });
        if (cancelled) return;
        const node = res.data?.result as (AqiData & { ok?: boolean; error?: string }) | null;
        if (node && node.ok === false) {
          setError(node.error || 'Air-quality source unavailable.');
          setData(null);
        } else {
          setData((node as AqiData) || null);
          setLastFetchedAt(Date.now());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [coords, gen]);

  const refresh = useCallback(() => {
    generation.current += 1;
    setGen(generation.current);
  }, []);

  return { data, loading, error: coords ? error : null, lastFetchedAt, refresh };
}
