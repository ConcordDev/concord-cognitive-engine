/**
 * GB-1538 / FIX-graph-010 (Air leg) — the eco surfaces' locating phase
 * had no resolution guarantee: with geolocation unavailable, or a
 * browser that never answers getCurrentPosition, coords stayed null
 * forever — EcoOverviewHero sat on 'Locating…' perpetually, WeatherRadar
 * on 'Locating you…', and AQIPanel fell through to 'AQI failed: no
 * data'. The hook (and WeatherRadar's local copy) now resolve to the
 * same default location the denied callback uses, on a hard deadline.
 * The Meta/Health leg of the ticket is already cured at head —
 * components/meta/SystemHealth.tsx reads the nested health envelope
 * (its header comment records the flat-key defect) and does not render
 * data-less tiles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { useAqiData } from '@/hooks/useAqiData';

const AQI = {
  aqi: 42, pm25: 10, pm10: 12, o3: 30, no2: 5, co: 0.3, so2: 2,
  category: 'good', recommendation: 'Fine.', source: 'test', lat: 37.77, lng: -122.42,
};

const geoDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'geolocation');

function setGeolocation(value: unknown) {
  Object.defineProperty(window.navigator, 'geolocation', { value, configurable: true });
}

describe('useAqiData locating resolution (FIX-graph-010)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: AQI } });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (geoDescriptor) Object.defineProperty(window.navigator, 'geolocation', geoDescriptor);
  });

  it('a geolocation request that is never answered still resolves via the watchdog', async () => {
    setGeolocation({ getCurrentPosition: () => { /* never calls back */ } });
    const { result } = renderHook(() => useAqiData());
    expect(result.current.locating).toBe(true);
    expect(lensRunMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(6000); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.locating).toBe(false);
    expect(lensRunMock).toHaveBeenCalledWith('eco', 'aqi-current', { lat: 37.7749, lng: -122.4194 });
    expect(result.current.data?.aqi).toBe(42);
  });

  it('geolocation unavailable resolves to the default location immediately', async () => {
    setGeolocation(undefined);
    const { result } = renderHook(() => useAqiData());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.locating).toBe(false);
    expect(lensRunMock).toHaveBeenCalledWith('eco', 'aqi-current', { lat: 37.7749, lng: -122.4194 });
  });

  it('a real position is used as-is (no fallback regression)', async () => {
    setGeolocation({
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 42.03, longitude: -93.63 } } as GeolocationPosition),
    });
    const { result } = renderHook(() => useAqiData());
    await act(async () => { await Promise.resolve(); });
    expect(lensRunMock).toHaveBeenCalledWith('eco', 'aqi-current', { lat: 42.03, lng: -93.63 });
    expect(result.current.data?.aqi).toBe(42);
  });
});
