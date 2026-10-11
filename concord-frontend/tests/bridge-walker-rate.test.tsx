/**
 * Concord-Link walker rows do not include a per-kilometre rate.
 *
 * GET /api/concord-link/walkers returns id, npc_id, home_world,
 * current_world, status, reputation. The bridge lens used to render a
 * missing costPerKm as "?/km".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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

import { ConcordLinkWalkers, walkerRateLabel } from '@/components/bridge/ConcordLinkWalkers';

const API_WALKER = {
  id: 'walker_ada',
  npc_id: 'ada',
  home_world: 'concordia-hub',
  current_world: 'concordia-hub',
  status: 'available',
  reputation: 80,
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

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation((path: unknown) => {
    const url = String(path);
    if (url.includes('/api/concord-link/walkers')) {
      return Promise.resolve({ data: { ok: true, walkers: [API_WALKER, { ...API_WALKER, id: 'walker_basil', npc_id: 'basil' }] } });
    }
    if (url.includes('/api/concord-link/anchors')) {
      return Promise.resolve({ data: { ok: true, anchors: [] } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
});

afterEach(() => {
  cleanup();
});

describe('walkerRateLabel', () => {
  it('says not reported when the list row has no rate', () => {
    expect(walkerRateLabel(API_WALKER)).toBe('not reported');
    expect(walkerRateLabel({})).toBe('not reported');
    expect(walkerRateLabel({ costPerKm: '?' })).toBe('not reported');
    expect(walkerRateLabel({ costPerKm: '' })).toBe('not reported');
  });

  it('shows a rate when the row actually carries one', () => {
    expect(walkerRateLabel({ costPerKm: 4 })).toBe('4/km');
    expect(walkerRateLabel({ costPerKm: 0 })).toBe('0/km');
    expect(walkerRateLabel({ cost_per_km: 2.5 })).toBe('2.5/km');
  });
});

describe('ConcordLinkWalkers rate column', () => {
  it('labels the API row as not reported instead of ?/km', async () => {
    const view = mount();
    await waitFor(() => expect(view.getByText('walker_ada')).toBeInTheDocument());
    expect(view.getAllByText('not reported')).toHaveLength(2);
    expect(view.queryByText('?/km')).toBeNull();
    expect(view.container.textContent).not.toContain('?/km');
  });
});
