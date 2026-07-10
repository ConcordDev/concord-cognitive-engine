/**
 * /lenses/fishing — four-UX-state contract for the Fishing hub lens.
 *
 * The fishing page is a GAME lens: its load-bearing data is the world's fish
 * CATALOG (primary read) + the player's CATCH LOG (secondary, auth-gated).
 * The rebuild (Frontend Rebuild Program, per-lens loop — see the capability
 * map comment at the top of app/lenses/fishing/page.tsx) moved both off raw
 * REST `fetch` onto the real macro channel:
 *   lensRun('fishing', 'catalog', { worldId })  → { ok, fish:[…] }
 *   lensRun('fishing', 'catches', { limit })    → { ok, catches:[…] }
 * Casting itself is owned end-to-end by `FishingMinigameOverlay` (stubbed
 * here as a render-only stub) — this hub page no longer pre-fetches a
 * throwaway cast session before opening it (that used to double-cast; see
 * the capability map's "RETIRED" note), it just opens the overlay directly.
 *
 * This pins genuine loading / error (role=alert + a WORKING Retry that
 * RE-DISPATCHES) / empty (honest CTA) / populated states against that real
 * channel — no fabricated rows. Critically it pins the SILENT-EMPTY defect
 * class: a catalog macro rejection ({ ok:false, reason }) must surface as a
 * real ERROR, NOT collapse into the empty-state CTA (an empty catalog and a
 * failed catalog load are different truths). The catch log is secondary: a
 * failed/absent catches read degrades to an empty log without failing the
 * whole lens, by design.
 *
 * No fabricated data: every state is driven by a mocked `lensRun` returning
 * exactly the { fish } / { catches } shapes the fishing macros return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── headless shell + minigame overlay: render-only stubs ────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/world-lens/FishingMinigameOverlay', () => ({
  FishingMinigameOverlay: ({ open }: { open: boolean }) =>
    open ? React.createElement('div', { 'data-testid': 'fishing-minigame' }, 'minigame') : null,
}));

// ── the real macro channel, mocked per-test ─────────────────────────────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER mocks are registered.
import FishingLensPage from '@/app/lenses/fishing/page';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

// Real authored-shape fish descriptor (matches content/world/*/fauna/fish.json).
const FISH = {
  id: 'ocean-tuna',
  name: 'Ocean Tuna',
  rarity: 'rare' as const,
  biome: 'water',
  subBiome: 'ocean',
};
// Real catch row (matches the fishing.catches SELECT projection).
const CATCH = {
  id: 'inv_1',
  world_id: 'concordia-hub',
  item_id: 'ocean-tuna',
  item_name: 'Ocean Tuna (90%)',
  acquired_at: Math.floor(Date.now() / 1000),
  meta_json: '{"qualityScore":0.9}',
};

/** Wires catalog/species/catches with sensible defaults, overridable per test. */
function wireLensRun(overrides: Partial<Record<'catalog' | 'species' | 'catches', () => Promise<unknown>>> = {}) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain !== 'fishing') return ok({ ok: true });
    if (action === 'catalog') return (overrides.catalog ?? (() => ok({ ok: true, fish: [] })))();
    if (action === 'species') return (overrides.species ?? (() => ok({ ok: true, fish: [] })))();
    if (action === 'catches') return (overrides.catches ?? (() => ok({ ok: true, catches: [] })))();
    return ok({ ok: true });
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('fishing lens — four UX states', () => {
  it('LOADING: shows role=status skeletons while the catalog is in flight, no fabricated rows', async () => {
    // Catalog never resolves → page stays in the loading state.
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    const { queryByText, findAllByRole } = render(<FishingLensPage />);
    // The skeleton's status text is screen-reader-only (sr-only) — visually
    // hidden by design, so the accessible-name query needs `hidden: true` to
    // include it (RTL's default role query excludes visually-hidden nodes).
    const statuses = await findAllByRole('status', { hidden: true });
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]).toHaveAttribute('aria-busy', 'true');
    // empty / populated cues are absent mid-flight
    expect(queryByText(/no fish authored for these waters yet/i)).toBeNull();
    expect(queryByText(/Ocean Tuna/i)).toBeNull();
  });

  it('EMPTY: an empty catalog shows the honest CTA, distinct from loading, with no rows', async () => {
    wireLensRun();
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText(/no fish authored for these waters yet/i)).toBeInTheDocument());
    // empty ≠ loading ≠ error: spinner + alert are gone.
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    // catch log shows its own honest empty CTA too
    expect(getByText(/no catches yet/i)).toBeInTheDocument();
  });

  it('ERROR (transport): a failed catalog dispatch surfaces an error, never silent-empty', async () => {
    wireLensRun({ catalog: () => err('HTTP 500') });
    const { getByText, queryByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText(/http 500/i)).toBeInTheDocument());
    // distinct from genuinely-empty — the empty CTA must NOT show
    expect(queryByText(/no fish authored for these waters yet/i)).not.toBeInTheDocument();
  });

  it('ERROR (macro reject): an ok:false catalog result is an honest failure, NOT silent-empty', async () => {
    // The SILENT-EMPTY defect class: a macro-level rejection ({ ok:false,
    // reason }) delivered inside a successful HTTP response must read as an
    // ERROR, not collapse to the empty CTA.
    wireLensRun({ catalog: () => ok({ ok: false, reason: 'fauna index corrupt' }) });
    const { getByText, queryByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText(/fauna index corrupt/i)).toBeInTheDocument());
    expect(queryByText(/no fish authored for these waters yet/i)).not.toBeInTheDocument();
  });

  it('ERROR → Retry RE-DISPATCHES the catalog macro and recovers to populated', async () => {
    let attempt = 0;
    wireLensRun({
      catalog: () => {
        attempt += 1;
        return attempt === 1 ? err('temporary outage') : ok({ ok: true, fish: [FISH] });
      },
    });
    const { getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText(/temporary outage/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Retry')); });

    // Retry must re-invoke the macro (not window.reload) and recover.
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    expect(attempt).toBeGreaterThan(1);
  });

  it('POPULATED: a real fish + catch render with their backend fields; no fabricated data', async () => {
    wireLensRun({
      catalog: () => ok({ ok: true, fish: [FISH] }),
      catches: () => ok({ ok: true, catches: [CATCH] }),
    });
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    // fields come straight from the (mocked) backend rows
    expect(getByText('ocean')).toBeInTheDocument();       // subBiome
    expect(getByText('rare')).toBeInTheDocument();        // rarity badge
    expect(getByText('Ocean Tuna (90%)')).toBeInTheDocument(); // catch item_name
    // no loading / error linger once populated
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    // empty CTAs are gone
    expect(container.textContent).not.toMatch(/no fish authored for these waters yet/i);
    expect(container.textContent).not.toMatch(/no catches yet/i);
  });

  it('catch log is SECONDARY: a failed catches read scopes its own honest error, without failing the whole lens', async () => {
    // The catalog (primary) succeeds; the catches read fails. The lens must
    // still render the catalog — the catch log surfaces its own scoped,
    // honest inline error (never a silent-empty collapse, and never a
    // whole-page failure that would also hide the working catalog).
    wireLensRun({
      catalog: () => ok({ ok: true, fish: [FISH] }),
      catches: () => err('unauthorized'),
    });
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    // Exactly one alert on the page — scoped to the catch log, not the catalog.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(getByText(/couldn.t load your catch log \(unauthorized\)/i)).toBeInTheDocument();
  });

  it('CAST: clicking Cast opens the minigame overlay (no throwaway pre-cast dispatch)', async () => {
    wireLensRun({ catalog: () => ok({ ok: true, fish: [FISH] }) });
    const { getByText, getByRole, queryByTestId } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    expect(queryByTestId('fishing-minigame')).toBeNull();

    await act(async () => { fireEvent.click(getByRole('button', { name: /cast line/i })); });

    // The overlay opens directly — the old page's throwaway pre-cast dispatch
    // (which double-cast alongside the overlay's own internal cast) is gone.
    await waitFor(() => expect(queryByTestId('fishing-minigame')).toBeInTheDocument());
    expect(lensRunMock).not.toHaveBeenCalledWith('fishing', 'cast', expect.anything());
  });
});
