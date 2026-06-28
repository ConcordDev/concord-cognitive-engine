/**
 * /lenses/fishing — four-UX-state contract for the Fishing hub lens.
 *
 * The fishing page is a GAME lens: its load-bearing data is the world's fish
 * CATALOG (primary read) + the player's CATCH LOG (secondary, auth-gated). It
 * drives them through the REAL REST surface (thin wrappers over
 * server/lib/fishing.js, also surfaced as the fishing.* macros):
 *   GET /api/fishing/catalog?worldId=<id>  → { ok, fish:[…] }
 *   GET /api/fishing/catches/mine          → { ok, catches:[…] }
 *   POST /api/fishing/cast                 → opens the minigame overlay
 *
 * This pins genuine loading / error (role=alert + a WORKING Retry that
 * RE-FETCHES) / empty (honest CTA) / populated states against that real channel
 * — no fabricated rows. Critically it pins the SILENT-EMPTY defect class: a
 * catalog handler rejection ({ ok:false }) must surface as a real ERROR, NOT
 * collapse into the empty-state CTA (an empty catalog and a failed catalog load
 * are different truths). The catch log is secondary: a 401 / { ok:false } there
 * degrades to an empty log without failing the whole lens, by design.
 *
 * No fabricated data: every state is driven by a mocked `fetch` returning
 * exactly the { fish } / { catches } shapes the fishing routes return. The
 * reaction-timed minigame overlay + headless LensShell are render-only stubs so
 * the test stays on the page's own fetch-driven state machine.
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

// Import AFTER mocks are registered.
import FishingLensPage from '@/app/lenses/fishing/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

// Real authored-shape fish descriptor (matches content/world/*/fauna/fish.json).
const FISH = {
  id: 'ocean-tuna',
  name: 'Ocean Tuna',
  rarity: 'rare' as const,
  biome: 'water',
  subBiome: 'ocean',
};
// Real catch row (matches the /catches/mine SELECT projection).
const CATCH = {
  id: 'inv_1',
  world_id: 'concordia-hub',
  item_id: 'ocean-tuna',
  item_name: 'Ocean Tuna (90%)',
  acquired_at: Math.floor(Date.now() / 1000),
  meta_json: '{"qualityScore":0.9}',
};

// Route a fetch URL to the right canned reply.
function routeFetch(handlers: {
  catalog?: () => Promise<unknown>;
  catches?: () => Promise<unknown>;
  cast?: () => Promise<unknown>;
}) {
  return vi.fn((url: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST' || /\/cast$/.test(url)) {
      return (handlers.cast ?? (() => jsonOk({ ok: true, sessionId: 'fish_x', biteAtEpochMs: Date.now() + 4000, candidateCount: 8 })))();
    }
    if (/\/catches\/mine$/.test(url)) {
      return (handlers.catches ?? (() => jsonOk({ ok: true, catches: [] })))();
    }
    return (handlers.catalog ?? (() => jsonOk({ ok: true, fish: [] })))();
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('fishing lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the catalog is in flight, no fabricated rows', async () => {
    // Catalog never resolves → page stays in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container, queryByText } = render(<FishingLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/loading/i);
    // empty / populated cues are absent mid-flight
    expect(queryByText(/No fish defined for this world yet/i)).toBeNull();
    expect(queryByText(/Ocean Tuna/i)).toBeNull();
  });

  it('EMPTY: an empty catalog shows the honest CTA, distinct from loading, with no rows', async () => {
    vi.stubGlobal('fetch', routeFetch({ catalog: () => jsonOk({ ok: true, fish: [] }) }));
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText(/No fish defined for this world yet/i)).toBeInTheDocument());
    // empty ≠ loading ≠ error: spinner + alert are gone.
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    // catch log shows its own honest empty CTA too
    expect(getByText(/No catches yet/i)).toBeInTheDocument();
  });

  it('ERROR (transport): a failed catalog load (HTTP error) surfaces role=alert, never silent-empty', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (/\/catches\/mine$/.test(url)) return jsonOk({ ok: true, catches: [] });
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: 'boom' }) });
    }));
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Couldn.t load fishing data/i)).toBeInTheDocument();
    expect(container.textContent).toMatch(/catalog 500/);
    // distinct from genuinely-empty — the empty CTA must NOT show
    expect(container.textContent).not.toMatch(/No fish defined for this world yet/i);
  });

  it('ERROR (handler reject): a 200 { ok:false } catalog is an honest failure, NOT silent-empty', async () => {
    // The SILENT-EMPTY defect class: a handler rejection delivered as HTTP 200
    // with { ok:false } must read as an ERROR, not collapse to the empty CTA.
    vi.stubGlobal('fetch', routeFetch({
      catalog: () => jsonOk({ ok: false, error: 'fauna index corrupt' }),
    }));
    const { container } = render(<FishingLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toMatch(/fauna index corrupt/);
    expect(container.textContent).not.toMatch(/No fish defined for this world yet/i);
  });

  it('ERROR (network throw): a rejected fetch surfaces an alert, not a stuck spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { container } = render(<FishingLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.textContent).toMatch(/network down/);
    expect(container.querySelector('[role="status"]')).toBeFalsy();
  });

  it('ERROR → Retry RE-FETCHES the catalog and recovers to populated', async () => {
    let fail = true;
    const fetchMock = vi.fn((url: string) => {
      if (/\/catches\/mine$/.test(url)) return jsonOk({ ok: true, catches: [] });
      if (fail) return Promise.reject(new Error('temporary outage'));
      return jsonOk({ ok: true, fish: [FISH] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());

    const catalogCallsBefore = fetchMock.mock.calls.filter(
      (c) => !/\/catches\/mine$/.test(String(c[0])) && !/\/cast$/.test(String(c[0])),
    ).length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });

    // Retry must re-invoke the backend (not window.reload) and recover.
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeFalsy());
    expect(
      fetchMock.mock.calls.filter(
        (c) => !/\/catches\/mine$/.test(String(c[0])) && !/\/cast$/.test(String(c[0])),
      ).length,
    ).toBeGreaterThan(catalogCallsBefore);
    expect(getByText(/Ocean Tuna/i)).toBeInTheDocument();
  });

  it('POPULATED: a real fish + catch render with their backend fields; no fabricated data', async () => {
    vi.stubGlobal('fetch', routeFetch({
      catalog: () => jsonOk({ ok: true, fish: [FISH] }),
      catches: () => jsonOk({ ok: true, catches: [CATCH] }),
    }));
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
    expect(container.textContent).not.toMatch(/No fish defined for this world yet/i);
    expect(container.textContent).not.toMatch(/No catches yet/i);
  });

  it('catch log is SECONDARY: a 401/{ok:false} catch log degrades to empty without failing the lens', async () => {
    // The catalog (primary) succeeds; the catches read 401s. The lens must
    // still render the catalog + an honest empty catch log, NOT an error.
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (/\/catches\/mine$/.test(url)) {
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ ok: false }) });
      }
      return jsonOk({ ok: true, fish: [FISH] });
    }));
    const { container, getByText } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(getByText(/No catches yet/i)).toBeInTheDocument();
  });

  it('CAST: clicking Cast POSTs /api/fishing/cast and opens the minigame overlay', async () => {
    const fetchMock = routeFetch({ catalog: () => jsonOk({ ok: true, fish: [FISH] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { getByText, getByRole, queryByTestId } = render(<FishingLensPage />);
    await waitFor(() => expect(getByText('Ocean Tuna')).toBeInTheDocument());
    expect(queryByTestId('fishing-minigame')).toBeNull();

    await act(async () => { fireEvent.click(getByRole('button', { name: /Cast line/i })); });

    // a real POST to the cast route fired, and the overlay opened.
    expect(fetchMock.mock.calls.some((c) => /\/cast$/.test(String(c[0])) && c[1]?.method === 'POST')).toBe(true);
    await waitFor(() => expect(queryByTestId('fishing-minigame')).toBeInTheDocument());
  });
});
