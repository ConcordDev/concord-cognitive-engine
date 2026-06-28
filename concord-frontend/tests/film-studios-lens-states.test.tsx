/**
 * /lenses/film-studios — four-UX-state contract for the Film Studios lens.
 *
 * Pins that the Discover surface renders genuine loading / error (with a WORKING
 * Retry) / empty / populated states against its real backend channel
 * (apiHelpers.filmStudio.discover → GET /api/film-studio/discover).
 *
 * Defect this test guards against (fixed 2026-06-27): the discover queryFn used
 * to `.catch(() => return [])`, which RESOLVES the query successfully — so a
 * real network failure rendered as a silently-empty page and `isError` could
 * never fire. The catch was removed so the rejection propagates, the
 * role="alert" error state surfaces, and Retry re-fetches.
 *
 * a11y: loading is role="status", error is role="alert" with a Retry that
 * RE-FETCHES (we assert the underlying call count grows + the surface recovers).
 * No fabricated data — each state is driven by a mocked discover() standing in
 * for the real route, in the exact { films: [...] } shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── backend channel: apiHelpers.filmStudio.discover (+ constants) ────────────
const discover = vi.fn();
const constants = vi.fn(() => Promise.resolve({ data: {} }));
const components = vi.fn(() => Promise.resolve({ data: {} }));
const crew = vi.fn(() => Promise.resolve({ data: {} }));
const create = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    filmStudio: {
      discover: (...a: unknown[]) => discover(...a),
      constants: (...a: unknown[]) => constants(...a),
      components: (...a: unknown[]) => components(...a),
      crew: (...a: unknown[]) => crew(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

// ── lens data / artifact hooks (My-films + compute actions) — inert ──────────
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], create: vi.fn(), isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({ contextDTUs: [], isLoading: false }),
}));

// ── headless chrome + side panels: render-only / inert stubs ────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/media/UniversalPlayer', () => ({ UniversalPlayer: () => null }));
vi.mock('@/components/film-studios/FilmStackFeed', () => ({ FilmStackFeed: () => null }));
vi.mock('@/components/film-studios/FilmStudioSection', () => ({ FilmStudioSection: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import FilmStudiosPage from '@/app/lenses/film-studios/page';

const FILM = {
  id: 'film_1', title: 'Neon Tide', type: 'short_film', status: 'draft',
  duration: 600, resolution: '1080p', crew: [], components: [], createdAt: '2026-06-27',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(FilmStudiosPage)),
  );
}

beforeEach(() => {
  discover.mockReset();
  constants.mockReset(); constants.mockImplementation(() => Promise.resolve({ data: {} }));
});

describe('film-studios lens — Discover tab four UX states', () => {
  it('LOADING: shows a role=status indicator while discover is in flight', async () => {
    discover.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = renderPage();
    await waitFor(() => expect(getByText(/Loading films/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest empty CTA when the catalog is empty', async () => {
    discover.mockImplementation(() => Promise.resolve({ data: { films: [] } }));
    const { getByText, getByTestId, getByRole } = renderPage();
    await waitFor(() => expect(getByTestId('film-discover-empty')).toBeInTheDocument());
    expect(getByText(/No films found/i)).toBeInTheDocument();
    // the CTA is a real, clickable button
    expect(getByRole('button', { name: /Create your first film/i })).toBeInTheDocument();
  });

  it('ERROR: a failed discover shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    discover.mockImplementation(() => {
      if (fail) return Promise.reject(new Error('discovery offline'));
      return Promise.resolve({ data: { films: [FILM] } });
    });
    const { getByText, container } = renderPage();
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/discovery offline/i)).toBeInTheDocument();

    const before = discover.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(discover.mock.calls.length).toBeGreaterThan(before));
    // recovers to the populated row
    await waitFor(() => expect(getByText('Neon Tide')).toBeInTheDocument());
  });

  it('POPULATED: renders the real film row from the discover route', async () => {
    discover.mockImplementation(() => Promise.resolve({ data: { films: [FILM] } }));
    const { getByText } = renderPage();
    await waitFor(() => expect(getByText('Neon Tide')).toBeInTheDocument());
    // the "Featured" badge marks the first row + Preview action is present
    expect(getByText(/Featured/i)).toBeInTheDocument();
    expect(getByText(/Preview/i)).toBeInTheDocument();
  });

  it('a11y: the tab controls are real buttons with accessible text', async () => {
    discover.mockImplementation(() => Promise.resolve({ data: { films: [] } }));
    const { getByRole } = renderPage();
    await waitFor(() => expect(getByRole('button', { name: /Discover/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /My Films/i })).toBeInTheDocument();
  });
});
