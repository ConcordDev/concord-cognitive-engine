/**
 * /lenses/sponsorship — four-UX-state contract (Discover + Billing surfaces).
 *
 * Pins that the Sponsorship lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('sponsorship', 'discover' | 'billing', …) → POST /api/lens/run that
 * server/domains/sponsorship.js answers), plus a11y (loading is role=status,
 * error is role=alert with a working Retry, the tab controls are real buttons).
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, in exactly the { creators, count, worlds } / billing shape
 * the macros return. The headless LensShell + sibling tabs that fetch on their
 * own are stubbed inert so each assertion stays on one tab's state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the lens's single backend channel ────────────────────────
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
// SponsorRepos hits the GitHub API via react-query; keep it inert.
vi.mock('@/components/sponsorship/SponsorRepos', () => ({ SponsorRepos: () => null }));
// Sibling tabs that fetch on their own — inert unless under test.
vi.mock('@/components/sponsorship/MySponsorships', () => ({ MySponsorships: () => React.createElement('div', { 'data-testid': 'tab-memberships' }) }));
vi.mock('@/components/sponsorship/SponsorInbox', () => ({ SponsorInbox: () => React.createElement('div', { 'data-testid': 'tab-inbox' }) }));
vi.mock('@/components/sponsorship/CreatorHub', () => ({ CreatorHub: () => React.createElement('div', { 'data-testid': 'tab-creator' }) }));
// ChartKit (used by BillingDashboard) — render a stub so the billing surface mounts headless.
vi.mock('@/components/viz', () => ({ ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }) }));

// Import AFTER mocks are registered.
import SponsorshipPage from '@/app/lenses/sponsorship/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const CREATOR = {
  creatorId: 'npc_vael', name: 'Vael Stormcaller', world: 'fantasy',
  craft: 'glyph spells', blurb: 'Composes new base-6 spell glyphs each season.',
  baseMonthly: 8, sponsorCount: 3, lowestTierCc: 8,
  tiers: [
    { tierId: 'npc_vael_bronze', name: 'Bronze', monthlyCc: 8, benefits: ['Periodic dispatches'], dispatchFreqHours: 168 },
    { tierId: 'npc_vael_silver', name: 'Silver', monthlyCc: 16, benefits: ['Sponsor-only posts'], dispatchFreqHours: 72 },
    { tierId: 'npc_vael_gold', name: 'Gold', monthlyCc: 32, benefits: ['Direct thank-you messages'], dispatchFreqHours: 24 },
  ],
};

beforeEach(() => { lensRun.mockReset(); });

describe('sponsorship lens — Discover tab four UX states', () => {
  it('LOADING: shows a role=status indicator while discover is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByText(/Loading creators/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the honest "no creators match" message when the catalog is empty', async () => {
    lensRun.mockImplementation(() => reply({ creators: [], count: 0, worlds: [] }));
    const { getByText } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByText(/No creators match/i)).toBeInTheDocument());
  });

  it('ERROR: a failed discover shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'discovery offline' } });
      return reply({ creators: [CREATOR], count: 1, worlds: ['fantasy'] });
    });
    const { getByText, container } = render(<SponsorshipPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/discovery offline/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Vael Stormcaller')).toBeInTheDocument());
  });

  it('POPULATED: renders the real creator row with the real lowest-tier CC + sponsor count', async () => {
    lensRun.mockImplementation(() => reply({ creators: [CREATOR], count: 1, worlds: ['fantasy'] }));
    const { getByText } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByText('Vael Stormcaller')).toBeInTheDocument());
    // the row carries the real lowest tier price from the macro
    expect(getByText(/8 CC\/mo/)).toBeInTheDocument();
    expect(getByText(/3 sponsors/)).toBeInTheDocument();
  });

  it('a11y: the tab controls are real buttons with accessible text', async () => {
    lensRun.mockImplementation(() => reply({ creators: [], count: 0, worlds: [] }));
    const { getByRole } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByRole('button', { name: /Discover/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /My Memberships/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Billing/i })).toBeInTheDocument();
  });
});

describe('sponsorship lens — Billing tab four UX states', () => {
  async function openBilling(getByRole: (role: string, opts: { name: RegExp }) => HTMLElement) {
    await act(async () => { fireEvent.click(getByRole('button', { name: /^Billing$/i })); });
  }

  it('LOADING: billing shows a role=status indicator while in flight', async () => {
    // discover resolves empty so the page mounts; billing never resolves.
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'billing') return new Promise(() => {});
      return reply({ creators: [], count: 0, worlds: [] });
    });
    const { getByRole, getByText, container } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByRole('button', { name: /^Billing$/i })).toBeInTheDocument());
    await openBilling(getByRole);
    await waitFor(() => expect(getByText(/Loading billing/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: a failed billing load shows role=alert + Retry; POPULATED shows the real rollups', async () => {
    let fail = true;
    const billing = {
      monthlyCommitted: 26, totalContributed: 42, activeCount: 2, pausedCount: 1,
      upcomingCharges: [{ creatorName: 'Vael Stormcaller', amountCc: 16, dueAt: 1893456000, tier: 'Silver' }],
      paymentHistory: [{ id: 'chg_1', creatorName: 'Vael Stormcaller', amountCc: 16, kind: 'charge', at: 1700000000, note: 'Subscribed to Silver' }],
      trend: [0, 1, 2, 3, 4, 5].map((i) => ({ monthsAgo: 5 - i, totalCc: i })),
    };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'billing') {
        if (fail) return Promise.resolve({ data: { ok: false, error: 'billing unavailable' } });
        return reply(billing);
      }
      return reply({ creators: [], count: 0, worlds: [] });
    });
    const { getByRole, getByText, container } = render(<SponsorshipPage />);
    await waitFor(() => expect(getByRole('button', { name: /^Billing$/i })).toBeInTheDocument());
    await openBilling(getByRole);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/billing unavailable/i)).toBeInTheDocument();

    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    // real rollups from the macro: monthly committed 26 CC, total contributed 42 CC
    await waitFor(() => expect(getByText(/26 CC/)).toBeInTheDocument());
    expect(getByText(/42 CC/)).toBeInTheDocument();
  });
});
