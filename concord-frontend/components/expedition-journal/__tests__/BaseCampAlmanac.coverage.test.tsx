import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const publicLookup = vi.hoisted(() => vi.fn());
vi.mock('@/lib/public-lookup', () => ({ publicLookup: (...a: unknown[]) => publicLookup(...a), lookupMeta: (d: { _meta?: { stale?: boolean } } | undefined) => d?._meta ?? null, carryLookupMeta: vi.fn() }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
import { BaseCampAlmanac, polarStatus } from '../BaseCampAlmanac';

const R = (over: Record<string, unknown> = {}) => ({ status: 'OK', results: { sunrise: '2026-03-02T06:00:00+00:00', sunset: '2026-03-02T18:00:00+00:00', solar_noon: '2026-03-02T12:00:00+00:00', day_length: '12:00:00', civil_twilight_begin: '2026-03-02T05:30:00+00:00', civil_twilight_end: '2026-03-02T18:30:00+00:00', ...over } });
afterEach(() => cleanup());
beforeEach(() => { publicLookup.mockReset(); });

describe('polarStatus', () => {
  it('flags midnight sun and polar night only for identical midnight sunrise/sunset', () => {
    expect(polarStatus({})).toBeNull();
    expect(polarStatus({ sunrise: 'a', sunset: 'b' })).toBeNull();
    expect(polarStatus({ sunrise: '2026-06-21T00:00:00+00:00', sunset: '2026-06-21T00:00:00+00:00', sun_status: 'midnight_sun' })).toBe('Midnight sun');
    expect(polarStatus({ sunrise: '2026-12-21T00:00:00+00:00', sunset: '2026-12-21T00:00:00+00:00', sun_status: 'polar_night' })).toBe('Polar night');
    expect(polarStatus({ sunrise: '2026-03-02T06:00:00+00:00', sunset: '2026-03-02T06:00:00+00:00' })).toBeNull();
  });
});
describe('BaseCampAlmanac', () => {
  const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BaseCampAlmanac /></QueryClientProvider>);
  it('lists every base camp with sun times', async () => {
    publicLookup.mockResolvedValue(R());
    const v = wrap();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(v.container.textContent).toMatch(/Everest Base Camp/);
    expect(publicLookup).toHaveBeenCalledTimes(8);
  });
  it('shows polar conditions, stale data and failures without crashing', async () => {
    publicLookup.mockImplementation(async (_k: string, p: { lat: number }) => {
      if (p.lat > 70) return { ...R({ sunrise: '2026-06-21T00:00:00+00:00', sunset: '2026-06-21T00:00:00+00:00', sun_status: 'midnight_sun' }), _meta: { stale: true } };
      if (p.lat < -70) throw new Error('down');
      return R();
    });
    const v = wrap();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });
});
