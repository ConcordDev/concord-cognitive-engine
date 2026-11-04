// ocean-build-slices.test.tsx — Ocean full-build (B9, 2026-11-03) pins.
//
// S1 — NoaaTidesPanel reads the live_tides result through the envelope:
// predictions render; a handler refusal surfaces its own reason under a
// line naming the predictions feed (Review 2's F2: the panel read the
// fields off the envelope and settled at 'fetch_failed' beside live
// siblings).
// S4 — the CalcPanel panels render a NOT_COMPUTED result's message
// instead of blank fields, and the tidal side is wired to the verb's
// real NOAA contract (station input; next high/low render) (F5).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const stub = vi.hoisted(() => ({
  tidesMode: 'ok' as 'ok' | 'refuse',
  runDomain: null as null | ((domain: string, action: string, payload: unknown) => Promise<unknown>),
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: async () => (stub.tidesMode === 'ok'
    ? { data: { ok: true, result: { ok: true, source: 'NOAA CO-OPS Tides & Currents', fetchedAt: 1762000000, station: '8443970', predictions: [{ time: '2026-11-04 06:12', heightMeters: 1.78, type: 'high' }, { time: '2026-11-04 00:05', heightMeters: -0.22, type: 'low' }] }, error: null } }
    : { data: { ok: true, result: { ok: false, reason: 'noaa_unreachable' }, error: null } }),
  // The pristine panel's raw post: hand it the real server envelope.
  api: {
    post: async () => ({ data: { ok: true, result: { ok: true, predictions: [{ time: '2026-11-04 06:12', heightMeters: 1.78, type: 'high' }], fetchedAt: 1762000000 }, error: null } }),
  },
  apiHelpers: { lens: { runDomain: (d: string, a: string, p: unknown) => stub.runDomain!(d, a, p) } },
}));

// The mirror env has no @/store/ui (SaveAsDtuButton's toast store);
// the save button is not what these pins exercise, so it is stubbed
// out of the graph (it renders only after a successful Analyze anyway).
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { NoaaTidesPanel } from '@/components/ocean/NoaaTidesPanel';
import { WaveEcosystemPanel } from '@/components/ocean/WaveEcosystemPanel';
import { TidalSalinityPanel } from '@/components/ocean/TidalSalinityPanel';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('S1 — the Boston panel lands', () => {
  beforeEach(() => { stub.tidesMode = 'ok'; });

  it('predictions render from the handler result', async () => {
    wrap(<NoaaTidesPanel />);
    // '1.78 m' renders twice (next-high block + the prediction row).
    expect((await screen.findAllByText('1.78 m')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Next high')).toBeTruthy();
    expect(screen.queryByText(/unreachable/)).toBeNull();
  });

  it('a handler refusal surfaces its own reason, naming the feed', async () => {
    stub.tidesMode = 'refuse';
    wrap(<NoaaTidesPanel />);
    expect(await screen.findByText('NOAA tide predictions unreachable (noaa_unreachable)')).toBeTruthy();
  });
});

describe('S4 — analyzer honesty at the panels', () => {
  beforeEach(() => {
    stub.runDomain = async (_d: string, action: string) => {
      if (action === 'waveAnalysis') return { data: { ok: true, result: { ok: true, result: { status: 'NOT_COMPUTED', missingInputs: ['waveHeightMeters'], message: 'Wave analysis needs significant wave height (m) and period (s).' } }, error: null } };
      if (action === 'marineEcosystem') return { data: { ok: true, result: { ok: true, result: { status: 'NOT_COMPUTED', missingInputs: ['species'], message: 'Add at least one species to score the ecosystem — an empty inventory has no health verdict.' } }, error: null } };
      if (action === 'tidalPrediction') return { data: { ok: true, result: { ok: true, result: { location: 'San Francisco', stationId: '9414290', beginDate: '20261104', endDate: '20261105', count: 2, predictions: [{ time: '2026-11-04 06:12', height: 1.78, type: 'high' }, { time: '2026-11-04 00:05', height: -0.13, type: 'low' }], nextHigh: { time: '2026-11-04 06:12', height: 1.78, type: 'high' }, nextLow: { time: '2026-11-04 00:05', height: -0.13, type: 'low' } } }, error: null } };
      if (action === 'salinityProfile') return { data: { ok: true, result: { ok: true, result: { readings: [], avgSalinity: 34.8, maxDepth: 50, haloclineDepth: 'none detected', waterMass: 'temperate' } }, error: null } };
      throw new Error(`unexpected action ${action}`);
    };
  });

  it('NOT_COMPUTED results render their refusal messages, not blank fields', async () => {
    wrap(<WaveEcosystemPanel />);
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(await screen.findByText(/Wave analysis needs significant wave height/)).toBeTruthy();
    expect(await screen.findByText(/empty inventory has no health verdict/)).toBeTruthy();
  });

  it('the tidal side takes a station and renders the real prediction shape', async () => {
    wrap(<TidalSalinityPanel />);
    const station = screen.getByPlaceholderText('9414290');
    fireEvent.change(station, { target: { value: '9414290' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze/i }));
    expect(await screen.findByText(/1\.78 m · 2026-11-04 06:12/)).toBeTruthy();
    expect(await screen.findByText(/-0\.13 m · 2026-11-04 00:05/)).toBeTruthy();
    expect(await screen.findByText('34.8')).toBeTruthy();
  });
});

