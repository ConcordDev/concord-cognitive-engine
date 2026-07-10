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

// The rebuild (Frontend Rebuild Program) moved catalog/species/catches off
// raw `fetch` onto the real macro channel — `lensRun('fishing', 'catalog' |
// 'species' | 'catches', input)` → POST /api/lens/run, answered by
// server/domains/fishing.js. Mock that channel directly rather than raw
// fetch (see tests/detective-lens-states.test.tsx for the same convention).
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import FishingLensPage from '@/app/lenses/fishing/page';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const CATALOG_FISH = [
  { id: 'river-trout', name: 'River Trout', rarity: 'common', biome: 'water', subBiome: 'river' },
  { id: 'mythril-koi', name: 'Mythril Koi', rarity: 'legendary', biome: 'water', subBiome: 'lake' },
];

/** Wires catalog/species/catches with sensible defaults, overridable per test. */
function wireLensRun(overrides: Partial<Record<'catalog' | 'species' | 'catches', () => Promise<unknown>>> = {}) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain !== 'fishing') return ok({ ok: true });
    if (action === 'catalog') return (overrides.catalog ?? (() => ok({ ok: true, fish: CATALOG_FISH })))();
    if (action === 'species') return (overrides.species ?? (() => ok({ ok: true, fish: CATALOG_FISH })))();
    if (action === 'catches') return (overrides.catches ?? (() => ok({ ok: true, catches: [] })))();
    return ok({ ok: true });
  });
}

describe('FishingLensPage — four UX states', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('LOADING: shows busy skeletons before macros resolve', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    render(React.createElement(FishingLensPage));
    // The skeleton's status text is screen-reader-only (sr-only) — visually
    // hidden by design, so the accessible-name query needs `hidden: true` to
    // include it (RTL's default role query excludes visually-hidden nodes).
    const statuses = await screen.findAllByRole('status', { hidden: true });
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('POPULATED: renders the real catalog and catch log', async () => {
    wireLensRun({
      catches: () => ok({
        ok: true,
        catches: [
          { id: 'inv1', world_id: 'concordia-hub', item_id: 'raw_fish:river-trout', item_name: 'River Trout (90%)', acquired_at: 1_700_000_000 },
        ],
      }),
    });
    render(React.createElement(FishingLensPage));
    expect(await screen.findByText('River Trout')).toBeInTheDocument();
    expect(screen.getByText('Mythril Koi')).toBeInTheDocument();
    expect(screen.getByText('legendary')).toBeInTheDocument();
    // Catch log shows the real minted item.
    expect(screen.getByText('River Trout (90%)')).toBeInTheDocument();
  });

  it('EMPTY: honest empty states for no fish and no catches', async () => {
    wireLensRun({ catalog: () => ok({ ok: true, fish: [] }) });
    render(React.createElement(FishingLensPage));
    expect(await screen.findByText(/no fish authored for these waters yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no catches yet/i)).toBeInTheDocument();
  });

  it('ERROR: surfaces an honest error with a working retry', async () => {
    let attempt = 0;
    wireLensRun({
      catalog: () => {
        attempt += 1;
        return attempt === 1 ? err('HTTP 500') : ok({ ok: true, fish: CATALOG_FISH });
      },
    });
    render(React.createElement(FishingLensPage));
    await waitFor(() => expect(screen.getByText(/couldn.t load|http 500/i)).toBeInTheDocument());
    // Retry recovers into the populated state.
    fireEvent.click(screen.getByText(/retry/i));
    await waitFor(() => expect(screen.getByText('River Trout')).toBeInTheDocument());
  });

  it('CAST opens the minigame overlay', async () => {
    wireLensRun();
    render(React.createElement(FishingLensPage));
    const btn = await screen.findByRole('button', { name: /cast line/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('minigame')).toBeInTheDocument());
  });
});
