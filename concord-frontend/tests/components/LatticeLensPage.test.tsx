import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// The lattice lens is a REST-backed brain-self-training dashboard. It fetches
// /api/lattice/* + /api/brains/* directly (fetch + react-query), so this test
// stubs the lens chrome + heavy child panels and drives the page's own four UX
// states (LOADING / EMPTY / ERROR+Retry / LOADED) by controlling global fetch.

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => undefined }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => undefined }));

// Heavy tab panels each fetch independently — stub to markers.
vi.mock('@/components/lattice/LatticeRepos', () => ({ LatticeRepos: () => null }));
vi.mock('@/components/lattice/TrainingRuns', () => ({ TrainingRuns: () => React.createElement('div', { 'data-testid': 'training-runs' }) }));
vi.mock('@/components/lattice/RefreshSchedule', () => ({ RefreshSchedule: () => React.createElement('div', { 'data-testid': 'refresh-schedule' }) }));
vi.mock('@/components/lattice/AuditAndDrift', () => ({ AuditAndDrift: () => React.createElement('div', { 'data-testid': 'audit-drift' }) }));

// framer-motion → passthrough so the AnimatePresence tab switch is synchronous.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement('div', props, children),
  }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const STATS_OK = {
  ok: true,
  tables: [
    { name: 'dtus', total: 10, consented: 4, ratio: 0.4, regime: 'user_opt_in' },
    { name: 'brain_interactions', total: 6, consented: 2, ratio: 0.3333, regime: 'platform_default_in' },
  ],
  totals: { total: 16, consented: 6, ratio: 0.375 },
};

function makeFetch(handler: (url: string) => unknown) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = handler(url);
    if (body === '__pending__') return new Promise(() => {}); // never resolves
    if (body === '__error__') {
      return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable', json: () => Promise.resolve({}) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response);
  });
}

async function renderPage() {
  const { default: LatticeLensPage } = await import('@/app/lenses/lattice/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(LatticeLensPage)),
  );
}

describe('LatticeLensPage — four UX states + a11y', () => {
  beforeEach(() => { vi.resetModules(); window.localStorage.clear(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('a11y: header is a single labelled landmark with an h1', async () => {
    vi.stubGlobal('fetch', makeFetch(() => STATS_OK));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /lattice/i })).toBeInTheDocument();
    });
  });

  it('LOADING: Overview shows a role=status loader while corpus stats are in flight', async () => {
    vi.stubGlobal('fetch', makeFetch((u) => (u.includes('/api/lattice/corpus/stats') ? '__pending__' : STATS_OK)));
    await renderPage();
    await waitFor(() => {
      const status = screen.getAllByRole('status');
      expect(status.some((s) => /loading corpus stats/i.test(s.textContent || ''))).toBe(true);
    });
  });

  it('EMPTY: Overview shows an honest empty state when there are no consent tables', async () => {
    vi.stubGlobal('fetch', makeFetch((u) =>
      u.includes('/api/lattice/corpus/stats')
        ? { ok: true, tables: [], totals: { total: 0, consented: 0, ratio: 0 } }
        : STATS_OK));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no consent-tracking tables present/i)).toBeInTheDocument();
    });
  });

  it('ERROR: Overview shows a role=alert with a working Retry when corpus stats fail', async () => {
    let fail = true;
    let statsCalls = 0;
    const fetchMock = makeFetch((u) => {
      if (!u.includes('/api/lattice/corpus/stats')) return STATS_OK;
      statsCalls += 1;
      return fail ? '__error__' : STATS_OK;
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      // fetchJSON throws Error("503 …"); the ErrorState surfaces it with a Retry.
      expect(alerts.some((a) => /503/.test(a.textContent || '') && /retry/i.test(a.textContent || ''))).toBe(true);
    });
    // The alert exposes a keyboard-operable Retry that re-issues the request.
    const retryBtn = screen.getAllByRole('button', { name: /retry/i })[0];
    expect(retryBtn).toBeInTheDocument();
    const before = statsCalls;
    fail = false;
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(statsCalls).toBeGreaterThan(before); // Retry re-fetched
    });
    // and the populated view recovers after the retry succeeds.
    await waitFor(() => {
      expect(screen.getByText(/per-table consent/i)).toBeInTheDocument();
    });
  });

  it('LOADED: Overview renders real totals + per-table rows from the REST response', async () => {
    vi.stubGlobal('fetch', makeFetch(() => STATS_OK));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/per-table consent/i)).toBeInTheDocument();
    });
    // totals surfaced
    expect(screen.getByText('16')).toBeInTheDocument(); // total rows
    expect(screen.getByText('37.5%')).toBeInTheDocument(); // consent ratio
    // per-table rows
    expect(screen.getByText('dtus')).toBeInTheDocument();
    expect(screen.getByText('brain_interactions')).toBeInTheDocument();
  });
});
