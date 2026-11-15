'use client';

// useAqiData — shared geolocation + live AQI fetch for the eco lens.
// Extracted from AQIPanel so the Overview hero and the Air-quality tab
// read the exact same real Open-Meteo-backed `eco.aqi-current` response
// instead of duplicating the fetch/geolocation dance with two copies that
// could silently drift. `refresh()` triggers a genuine re-fetch (bumps a
// generation counter) — it does not fabricate a new reading, it re-asks
// the real macro.

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';

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
  /** True while the coordinates are still unresolved (geolocation phase). */
  locating: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  refresh: () => void;
}

const FALLBACK_COORDS = { lat: 37.7749, lng: -122.4194 };

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
    if (coords) return;
    // FIX-graph-010: the locating phase had no resolution guarantee — with
    // geolocation unavailable, or a browser that never answers the request,
    // coords stayed null forever: the hero sat on 'Locating…' perpetually
    // and the panel fell through to 'AQI failed: no data'. The denied
    // callback already falls back to default coords; the unavailable case
    // and a hard watchdog deadline now resolve the same way, so every
    // surface reaches data or an explained state.
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setCoords(FALLBACK_COORDS);
      return;
    }
    const watchdog = setTimeout(() => setCoords(FALLBACK_COORDS), 6000);
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setCoords(FALLBACK_COORDS),
      { maximumAge: 5 * 60 * 1000, timeout: 5000 }
    );
    return () => clearTimeout(watchdog);
  }, [coords]);

  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await lensRun<AqiData>('eco', 'aqi-current', { lat: coords.lat, lng: coords.lng });
        if (cancelled) return;
        if (!res.data.ok) {
          setError(res.data.error || 'Air-quality source unavailable.');
          setData(null);
        } else {
          setData(res.data.result || null);
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

  return { data, loading, locating: !coords, error: coords ? error : null, lastFetchedAt, refresh };
}
