/**
 * /lenses/tournaments — four-UX-state contract (bracket-platform surface).
 *
 * Pins that the Tournaments lens renders genuine loading (role=status) /
 * error (role=alert with a WORKING Retry that re-fetches) / empty (CTA) /
 * populated states against the real macro surface
 * (lensRun('tournaments', 'list', …) → POST /api/lens/run that
 * server/domains/tournaments.js answers).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in
 * for the real backend, in exactly the { tournaments, counts } shape the
 * `list` macro returns. The headless LensShell + the self-contained child
 * components (EsportsFeed, recents panels, hero/badge chrome) are stubbed so
 * the test stays on the page's own list state machine. The error case also
 * pins the federation-defect fix: a THROWN transport failure surfaces an
 * alert instead of silently emptying the page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the list board's single backend channel ──────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
// EsportsFeed does its own external Reddit fetch — stub inert so the test is
// scoped to the page's tournament-list state machine.
vi.mock('@/components/tournaments/EsportsFeed', () => ({ EsportsFeed: () => null }));
vi.mock('@/components/tournaments/BracketView', () => ({ BracketView: () => null }));
vi.mock('@/components/tournaments/EntrantsManager', () => ({ EntrantsManager: () => null }));
vi.mock('@/components/tournaments/StandingsPanel', () => ({ StandingsPanel: () => null }));
vi.mock('@/components/tournaments/SpectatorBar', () => ({ SpectatorBar: () => null }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import TournamentsPage from '@/app/lenses/tournaments/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const TOURNEY = {
  id: 'tour_1', title: 'Spring Cup', game: 'Concord PvP', format: 'single_elimination',
  mode: 'solo', teamSize: 1, status: 'upcoming', maxEntrants: 8, prizePoolCc: 1000,
  payoutSplit: [60, 25, 15], swissRounds: 5, startsAt: 0, checkinOpensAt: null,
  shareSlug: 'abc', createdAt: 0, completedAt: null, winnerId: null,
  entrants: [{ id: 'e1', name: 'Ann', seed: 1, rating: 1000, checkedIn: false, eliminated: false, roster: [] }],
  matches: [], standings: [], payouts: [], locked: false, log: [],
};

beforeEach(() => { lensRun.mockReset(); });

describe('tournaments lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container, getByText } = render(<TournamentsPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading tournaments/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "create one" CTA when the list is empty', async () => {
    lensRun.mockImplementation(() => reply({ tournaments: [], counts: {} }));
    const { getByText } = render(<TournamentsPage />);
    await waitFor(() => expect(getByText(/No tournaments here/i)).toBeInTheDocument());
    expect(getByText(/Create one to start a competitive scene/i)).toBeInTheDocument();
  });

  it('ERROR: a failed list load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'backend exploded' } });
      return reply({ tournaments: [TOURNEY], counts: { upcoming: 1 } });
    });
    const { getByText, container } = render(<TournamentsPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/backend exploded/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Spring Cup')).toBeInTheDocument());
  });

  it('ERROR (federation defect): a THROWN transport failure surfaces an alert, not a silent empty page', async () => {
    lensRun.mockImplementation(() => Promise.reject(new Error('network down')));
    const { container, queryByText } = render(<TournamentsPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    // The empty-state CTA must NOT render when the load actually failed.
    expect(queryByText(/No tournaments here/i)).toBeNull();
  });

  it('POPULATED: renders real tournament rows with the real prize pool + entrant count', async () => {
    lensRun.mockImplementation(() => reply({ tournaments: [TOURNEY], counts: { upcoming: 1 } }));
    const { getByText } = render(<TournamentsPage />);
    await waitFor(() => expect(getByText('Spring Cup')).toBeInTheDocument());
    // the row carries the real pool + entrant fraction from the macro
    expect(getByText('1000')).toBeInTheDocument();
    expect(getByText('1/8')).toBeInTheDocument();
  });

  it('a11y: the Browse / Create header controls are real buttons', async () => {
    lensRun.mockImplementation(() => reply({ tournaments: [], counts: {} }));
    const { getByRole } = render(<TournamentsPage />);
    await waitFor(() => expect(getByRole('button', { name: /Browse/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Create/i })).toBeInTheDocument();
  });
});
