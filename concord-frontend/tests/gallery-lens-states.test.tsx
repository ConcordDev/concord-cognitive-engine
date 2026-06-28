/**
 * /lenses/gallery — four-UX-state contract.
 *
 * Pins that the Gallery lens renders genuine loading / error (role=alert + a
 * working Retry) / empty / populated states against its real macro surface
 * (POST /api/lens/run { domain: 'compression_art', name: 'list_for_user' }),
 * plus a11y (loading is role=status with aria-busy, load-error is role=alert).
 *
 * No fabricated data: every state is driven by a mocked `fetch` standing in for
 * the real backend, exactly the shape compression_art.list_for_user returns
 * ({ ok, sigils: [...] }). The headless LensShell + every gallery child panel
 * (MET / CMA / SavedCollections / GalleryActionPanel / tab surfaces) are
 * render-only stubs so the test stays on the page's own fetch-driven state
 * machine for the sigil gallery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens substrate: render-only stubs ──────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/art/MetMuseumPanel', () => ({ MetMuseumPanel: () => null }));
vi.mock('@/components/gallery/CmaBrowser', () => ({ CmaBrowser: () => null }));
vi.mock('@/components/gallery/SavedCollections', () => ({ SavedCollections: () => null }));
vi.mock('@/components/gallery/GalleryActionPanel', () => ({ GalleryActionPanel: () => null }));
vi.mock('@/components/gallery/DeepZoomViewer', () => ({ DeepZoomViewer: () => null }));
vi.mock('@/components/gallery/VisualSearch', () => ({ VisualSearch: () => null }));
vi.mock('@/components/gallery/CuratedExhibits', () => ({ CuratedExhibits: () => null }));
vi.mock('@/components/gallery/ArtworkCompare', () => ({ ArtworkCompare: () => null }));
vi.mock('@/components/gallery/ArtistPage', () => ({ ArtistPage: () => null }));
vi.mock('@/components/gallery/VirtualRooms', () => ({ VirtualRooms: () => null }));
vi.mock('@/components/gallery/Recommendations', () => ({ Recommendations: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// Import AFTER mocks are registered.
import GalleryPage from '@/app/lenses/gallery/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

// A real compression_art.list_for_user sigil row (MEGA-tier consolidated DTU).
const SIGIL = {
  id: 1,
  mega_dtu_id: 'mega_abc123',
  tier: 'MEGA',
  shape_seed: '7c3aed06b6d110b981f5',
  dominant_element: 'fire',
  created_at: Math.floor(Date.now() / 1000),
  title: 'Consolidated: combat theory',
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('gallery lens — four UX states', () => {
  it('LOADING: shows a role=status (aria-busy) indicator while sigils are in flight', async () => {
    // list_for_user never resolves → page stays in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<GalleryPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toMatch(/loading/i);
    expect(status?.getAttribute('aria-busy')).toBe('true');
  });

  it('ERROR: a failed sigil load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    const fetchMock = vi.fn(() => {
      if (fail) return Promise.resolve(null as unknown as Response); // network error → macro() returns null
      return jsonOk({ ok: true, sigils: [SIGIL] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<GalleryPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/could not load|retry/i);

    const callsBefore = fetchMock.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    // recovers to the populated sigil gallery
    await waitFor(() => expect(getByText(SIGIL.title)).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('ERROR: an ok:false macro response is an honest load failure (no fake sigils, no empty CTA)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: false, error: 'compression_art store unavailable' })));
    const { container } = render(<GalleryPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unavailable/i);
    // the empty-state sigil CTA must NOT show when the load actually errored.
    expect(container.textContent).not.toMatch(/No sigils yet/i);
  });

  it('EMPTY: shows the honest "No sigils yet" CTA when the user has zero consolidated DTUs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, sigils: [] })));
    const { getByText, container } = render(<GalleryPage />);
    await waitFor(() => expect(getByText(/No sigils yet/i)).toBeInTheDocument());
    // populated/loading/error states are absent
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
    expect(container.querySelector('[role="status"]')).toBeFalsy();
  });

  it('POPULATED: renders a real sigil row with its title + tier/element, no fabrication', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, sigils: [SIGIL] })));
    const { getByText, container } = render(<GalleryPage />);
    await waitFor(() => expect(getByText(SIGIL.title)).toBeInTheDocument());
    // tier + dominant element come straight from the (mocked) backend row.
    expect(container.textContent).toMatch(/MEGA/);
    expect(container.textContent).toMatch(/fire/);
    // a procedural sigil SVG is rendered for the row.
    expect(container.querySelector('svg')).toBeTruthy();
    // no loading / error states linger once populated.
    expect(container.querySelector('[role="status"]')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('A11Y: the gallery tab nav exposes an accessible name + aria-current on the active tab', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, sigils: [SIGIL] })));
    const { container, getByText } = render(<GalleryPage />);
    await waitFor(() => expect(getByText(SIGIL.title)).toBeInTheDocument());
    const nav = container.querySelector('nav[aria-label="Gallery sections"]');
    expect(nav).toBeTruthy();
    // the default "Browse" tab is marked current.
    const current = nav?.querySelector('[aria-current="page"]');
    expect(current?.textContent).toMatch(/Browse/i);
  });
});
