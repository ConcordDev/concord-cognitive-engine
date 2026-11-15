// CB-0500 — counts that lie, cluster E pin (FIX-concord-link-frontier-002).
//
// The Concord-Link walkers/anchors panel typed its anchor rows as
// { label, x, y, z } — fields the anchors endpoint never returns (rows
// are concord_link_anchors verbatim: name, access_method, location,
// stability, …; there are no coordinates in the data model) — so every
// anchor rendered its id as the title and '(?, ?, ?)' as its values.
// Walker rows carry status + reputation, which the panel never
// rendered. And both header counts rendered a definitive 0 while the
// first fetch was still pending, while the anchors list never
// refetched after mount. Pins:
//   - anchors render name / location / access / stability from the
//     real payload, and no '(?, ?, ?)' appears;
//   - walkers render their status + reputation;
//   - header counts show '—' while pending, never a premature 0.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
  },
  apiHelpers: {},
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { ConcordLinkWalkers } from '@/components/bridge/ConcordLinkWalkers';

const API_WALKER = {
  id: 'walker_ada',
  npc_id: 'ada',
  home_world: 'concordia-hub',
  current_world: 'concordia-hub',
  status: 'available',
  reputation: 80,
};

const API_ANCHOR = {
  id: 'anch_hub_gate',
  world_id: 'concordia-hub',
  name: 'Hub Gate',
  access_method: 'portal',
  description: 'The main gate anchor.',
  location: 'North plaza',
  controlled_by_faction: null,
  stability: 0.9,
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConcordLinkWalkers />
    </QueryClientProvider>,
  );
}

// Ancestor elements share textContent with the leaf they wrap, so
// presence is asserted as "at least one element carries it".
const hasText = async (pred: (t: string) => boolean) =>
  (await screen.findAllByText((_, el) => pred(el?.textContent ?? ''))).length > 0;

describe('frontier-002 — walkers/anchors render the real payload', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation((path: unknown) => {
      const url = String(path);
      if (url.includes('/api/concord-link/walkers')) {
        return Promise.resolve({ data: { ok: true, walkers: [API_WALKER] } });
      }
      if (url.includes('/api/concord-link/anchors')) {
        return Promise.resolve({ data: { ok: true, anchors: [API_ANCHOR] } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  });
  afterEach(cleanup);

  it('renders anchor name/location/access/stability and walker status/reputation — no (?, ?, ?)', async () => {
    mount();
    expect(await screen.findByText('Hub Gate')).toBeTruthy();
    expect(await screen.findByText('North plaza')).toBeTruthy();
    expect(await hasText((t) => t === 'access=portal · stability=90%')).toBe(true);
    expect(await hasText((t) => t.includes('status=available'))).toBe(true);
    expect(await hasText((t) => t.includes('rep=80'))).toBe(true);
    expect(screen.queryByText(/\(\?, \?, \?\)/)).toBeNull();
    // Counts agree with the rendered lists once loaded.
    expect(await hasText((t) => t === 'Walker contracts in concordia-hub (1)')).toBe(true);
    expect(await hasText((t) => t.includes('Anchors in concordia-hub (1)'))).toBe(true);
  });

  it('shows — for both counts while the first fetch is pending, never a premature 0', async () => {
    let resolveWalkers!: (v: unknown) => void;
    apiGet.mockImplementation((path: unknown) => {
      const url = String(path);
      if (url.includes('/api/concord-link/walkers')) {
        return new Promise((res) => { resolveWalkers = res; });
      }
      if (url.includes('/api/concord-link/anchors')) {
        return Promise.resolve({ data: { ok: true, anchors: [] } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    mount();
    expect(await hasText((t) => t === 'Walker contracts in concordia-hub (—)')).toBe(true);
    expect(screen.queryByText((_, el) => el?.textContent === 'Walker contracts in concordia-hub (0)')).toBeNull();
    resolveWalkers({ data: { ok: true, walkers: [API_WALKER] } });
    expect(await hasText((t) => t === 'Walker contracts in concordia-hub (1)')).toBe(true);
  });
});
