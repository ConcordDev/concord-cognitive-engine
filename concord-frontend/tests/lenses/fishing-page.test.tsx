import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell wraps children in an a11y context provider that registers with a
// UI store; stub it to a plain pass-through so the page renders in isolation.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));

// The minigame overlay does its own fetch/socket work; stub it — this test
// exercises the hub page's four UX states, not the overlay.
vi.mock('@/components/world-lens/FishingMinigameOverlay', () => ({
  FishingMinigameOverlay: ({ open }: { open: boolean }) =>
    open ? React.createElement('div', { 'data-testid': 'minigame' }, 'minigame') : null,
}));

import FishingLensPage from '@/app/lenses/fishing/page';

const CATALOG = {
  ok: true,
  fish: [
    { id: 'river-trout', name: 'River Trout', rarity: 'common', biome: 'water', subBiome: 'river' },
    { id: 'mythril-koi', name: 'Mythril Koi', rarity: 'legendary', biome: 'water', subBiome: 'lake' },
  ],
};

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const r = impl(String(url), init);
    return Promise.resolve(r as Response);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200): Partial<Response> {
  return { ok, status, json: async () => body };
}

describe('FishingLensPage — four UX states', () => {
  beforeEach(() => {
    // jsdom localStorage exists; ensure a known world.
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('LOADING: shows a busy status before fetches resolve', async () => {
    // Never-resolving fetch keeps the page in the loading state.
    mockFetch(() => new Promise(() => {}) as unknown as Response);
    render(React.createElement(FishingLensPage));
    expect(await screen.findByRole('status')).toHaveTextContent(/loading/i);
  });

  it('POPULATED: renders the real catalog and catch log', async () => {
    mockFetch((url) => {
      if (url.includes('/api/fishing/catalog')) return jsonResponse(CATALOG);
      if (url.includes('/api/fishing/catches/mine')) {
        return jsonResponse({ ok: true, catches: [
          { id: 'inv1', world_id: 'concordia-hub', item_id: 'raw_fish:river-trout', item_name: 'River Trout (90%)', acquired_at: 1_700_000_000 },
        ] });
      }
      return jsonResponse({ ok: true });
    });
    render(React.createElement(FishingLensPage));
    expect(await screen.findByText('River Trout')).toBeInTheDocument();
    expect(screen.getByText('Mythril Koi')).toBeInTheDocument();
    expect(screen.getByText('legendary')).toBeInTheDocument();
    // Catch log shows the real minted item.
    expect(screen.getByText('River Trout (90%)')).toBeInTheDocument();
  });

  it('EMPTY: honest empty states for no fish and no catches', async () => {
    mockFetch((url) => {
      if (url.includes('/api/fishing/catalog')) return jsonResponse({ ok: true, fish: [] });
      if (url.includes('/api/fishing/catches/mine')) return jsonResponse({ ok: true, catches: [] });
      return jsonResponse({ ok: true });
    });
    render(React.createElement(FishingLensPage));
    expect(await screen.findByText(/no fish defined for this world/i)).toBeInTheDocument();
    expect(screen.getByText(/no catches yet/i)).toBeInTheDocument();
  });

  it('ERROR: surfaces an honest error with a working retry', async () => {
    let attempt = 0;
    mockFetch((url) => {
      if (url.includes('/api/fishing/catalog')) {
        attempt += 1;
        if (attempt === 1) return jsonResponse({ ok: false }, false, 500);
        return jsonResponse(CATALOG);
      }
      if (url.includes('/api/fishing/catches/mine')) return jsonResponse({ ok: true, catches: [] });
      return jsonResponse({ ok: true });
    });
    render(React.createElement(FishingLensPage));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load fishing data/i);
    // Retry recovers into the populated state.
    fireEvent.click(screen.getByText(/retry/i));
    await waitFor(() => expect(screen.getByText('River Trout')).toBeInTheDocument());
  });

  it('CAST dispatches concordia:open-fishing and opens the minigame', async () => {
    mockFetch((url) => {
      if (url.includes('/api/fishing/catalog')) return jsonResponse(CATALOG);
      if (url.includes('/api/fishing/catches/mine')) return jsonResponse({ ok: true, catches: [] });
      if (url.includes('/api/fishing/cast')) return jsonResponse({ ok: true, sessionId: 'fish_x', biteAtEpochMs: Date.now() + 4000 });
      return jsonResponse({ ok: true });
    });
    render(React.createElement(FishingLensPage));
    const btn = await screen.findByRole('button', { name: /cast line/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('minigame')).toBeInTheDocument());
  });
});
