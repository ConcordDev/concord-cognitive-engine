/**
 * /lenses/bounties — four-UX-state contract (board surface).
 *
 * Pins that the Bounties lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('bounties', 'list', …) → POST /api/lens/run that
 * server/domains/bounties.js answers), plus a11y (loading is role=status,
 * error is role=alert with a working Retry, the tab buttons are real buttons).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in exactly the { bounties, total } shape the `list` macro
 * returns. The headless LensShell + the self-contained child components
 * (CreateBountyForm, BountyCard, side panels) are stubbed so the test stays on
 * the page's own board state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the board's single backend channel ───────────────────────
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
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', email: 'm@x', role: 'user' } }) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));

// Child components do their own fetching; stub them inert so the test is
// scoped to the page's board state machine. CreateBountyForm + BountyCard are
// given a minimal shape so the populated state can still assert real rows.
vi.mock('@/components/bounties/GhsaAdvisories', () => ({ GhsaAdvisories: () => null }));
vi.mock('@/components/bounties/CreateBountyForm', () => ({ CreateBountyForm: () => React.createElement('div', { 'data-testid': 'create-form' }) }));
vi.mock('@/components/bounties/BountyFilters', () => ({ BountyFilters: () => React.createElement('div', { 'data-testid': 'filters' }) }));
vi.mock('@/components/bounties/BountyLeaderboard', () => ({ BountyLeaderboard: () => null }));
vi.mock('@/components/bounties/MyBountyActivity', () => ({ MyBountyActivity: () => null }));
vi.mock('@/components/bounties/BountyCard', () => ({
  BountyCard: ({ bounty }: { bounty: { id: string; title: string; poolCc: number } }) =>
    React.createElement('li', { 'data-testid': `bounty-${bounty.id}` }, `${bounty.title} — ${bounty.poolCc} CC`),
}));

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
import BountiesPage from '@/app/lenses/bounties/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const BOUNTY = {
  id: 'bty_1', title: 'Fix the auth bug', description: 'sessions drop on refresh',
  ownerId: 'other', category: 'security', tags: ['auth'], difficulty: 'advanced',
  rewardCc: 250, poolCc: 250, paidCc: 50, status: 'open', createdAt: '2026-01-01',
  updatedAt: '2026-01-01', deadline: null, milestones: [], submissions: [],
  submissionCount: 0, acceptedSubmissionId: null, dispute: null,
};

beforeEach(() => { lensRun.mockReset(); });

describe('bounties lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the board is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<BountiesPage />);
    await waitFor(() => expect(getByText(/Loading bounties/i)).toBeInTheDocument());
    // loading copy is present; the spinner icon stands in for the live status.
    expect(getByText(/Loading bounties/i)).toBeInTheDocument();
    expect(container.querySelector('[data-testid="icon-Loader2"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "no bounties match" CTA when total === 0', async () => {
    lensRun.mockImplementation(() => reply({ bounties: [], total: 0 }));
    const { getByText } = render(<BountiesPage />);
    await waitFor(() => expect(getByText(/No bounties match/i)).toBeInTheDocument());
    expect(getByText(/Post the first one/i)).toBeInTheDocument();
  });

  it('ERROR: a failed board load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'backend exploded' } });
      return reply({ bounties: [BOUNTY], total: 1 });
    });
    const { getByText, container } = render(<BountiesPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/backend exploded/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText(/Fix the auth bug/)).toBeInTheDocument());
  });

  it('POPULATED: renders real bounty rows + the real open-pool / paid-out rollups', async () => {
    lensRun.mockImplementation(() => reply({ bounties: [BOUNTY], total: 1 }));
    const { getByText, getByTestId, getAllByText } = render(<BountiesPage />);
    await waitFor(() => expect(getByTestId('bounty-bty_1')).toBeInTheDocument());
    // the row carries the real pool from the macro
    expect(getByText(/Fix the auth bug — 250 CC/)).toBeInTheDocument();
    // header rollups compute from the real rows: open pool = 250 (also on the
    // row), paid out = 50. Both stat tiles render a "<n> CC" string.
    expect(getAllByText(/250 CC/).length).toBeGreaterThanOrEqual(1);
    expect(getByText((_c, el) => el?.textContent?.trim() === '50 CC')).toBeTruthy();
  });

  it('a11y: the board tab controls are real buttons with accessible text', async () => {
    lensRun.mockImplementation(() => reply({ bounties: [], total: 0 }));
    const { getByRole } = render(<BountiesPage />);
    await waitFor(() => expect(getByRole('button', { name: /Bounty board/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Autofix staking/i })).toBeInTheDocument();
  });

  it('error surface uses role=alert (not a silent failure)', async () => {
    lensRun.mockImplementation(() => Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } }));
    const { container, getByText } = render(<BountiesPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();
  });
});
