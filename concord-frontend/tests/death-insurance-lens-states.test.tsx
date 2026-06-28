/**
 * /lenses/death-insurance — four-UX-state contract.
 *
 * Pins that the Death-Insurance (inheritance-pact) lens renders genuine
 * loading / error (with a working Retry) / empty / populated states against
 * the real macro surface (the page calls lensRun('insurance', …) → POST
 * /api/lens/run that server/domains/insurance.js answers; the lens DIR is
 * `death-insurance` but the backend DOMAIN is `insurance`).
 *
 * a11y: loading is role=status, error is role=alert with a working Retry that
 * re-fetches. No fabricated data — every state is driven by a mocked lensRun
 * standing in for the real backend in exactly the { written, beneficiaryOf,
 * count } / notifications / payout-history shapes the macros return. The
 * headless LensShell + self-contained children (PactWriter, PactCard, …) are
 * stubbed so the test stays on the page's own state machine.
 *
 * Guards against the silent-empty regression (a swallowed pact-list fetch
 * rendering an empty workspace instead of surfacing the backend reason): the
 * page treats pact-list as load-bearing and routes its failure to role=alert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the page's backend channel ──────────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// ── headless shell + lens chrome: render-only stubs ────────────────────────
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

// death-insurance children — stub the writer + chatter inert; give PactCard /
// BeneficiaryPactCard a minimal shape so the populated state asserts real rows.
vi.mock('@/components/death-insurance/PactWriter', () => ({
  PactWriter: () => React.createElement('div', { 'data-testid': 'pact-writer' }, 'Write Inheritance Pact'),
}));
vi.mock('@/components/death-insurance/InsuranceChatter', () => ({ InsuranceChatter: () => null }));
vi.mock('@/components/death-insurance/PactNotifications', () => ({
  PactNotifications: ({ notifications }: { notifications: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'notifications' }, `notes:${notifications.length}`),
}));
vi.mock('@/components/death-insurance/PayoutHistory', () => ({
  PayoutHistory: ({ totalPaidOutSparks }: { totalPaidOutSparks: number }) =>
    React.createElement('div', { 'data-testid': 'payout-history' }, `paidOut:${totalPaidOutSparks}`),
}));
vi.mock('@/components/death-insurance/PactCard', () => ({
  PactCard: ({ pact }: { pact: { id: string; payoutSparks: number } }) =>
    React.createElement('li', { 'data-testid': `pact-${pact.id}` }, `${pact.payoutSparks} sparks`),
}));
vi.mock('@/components/death-insurance/BeneficiaryPactCard', () => ({
  BeneficiaryPactCard: ({ pact }: { pact: { id: string } }) =>
    React.createElement('li', { 'data-testid': `bene-${pact.id}` }, pact.id),
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
import DeathInsurancePage from '@/app/lenses/death-insurance/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}
// The page fires three parallel reads: pact-list, pact-notifications,
// pact-payout-history. Route each by its macro name.
function routed(byMacro: Record<string, () => Promise<unknown>>) {
  return (_domain: string, macro: string) => {
    const fn = byMacro[macro];
    if (!fn) throw new Error(`unexpected macro: ${macro}`);
    return fn();
  };
}

const PACT = {
  id: 'pct_1', insuredUserId: 'me', payoutSparks: 1000, premiumSparks: 50,
  premiumFrequency: 'upfront', autoRenew: false, requireHandshake: true,
  writtenAt: 1700000000, durationDays: 30, expiresAt: 1702592000,
  status: 'active', renewCount: 0, premiumPaidSparks: 50, nextPremiumDueAt: null,
  beneficiaries: [{ userId: 'friend_1', sharePct: 100, accepted: false, respondedAt: null }],
};
const EMPTY_LIST = { written: [], beneficiaryOf: [], count: 0 };
const EMPTY_NOTIF = { notifications: [], count: 0, unreadHigh: 0 };
const EMPTY_HIST = { paidOut: [], received: [], totalPaidOutSparks: 0, totalReceivedSparks: 0 };

beforeEach(() => { lensRun.mockReset(); });

describe('death-insurance lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the reads are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByRole } = render(<DeathInsurancePage />);
    await waitFor(() => expect(getByRole('status')).toBeInTheDocument());
    expect(getByRole('status').textContent).toMatch(/Loading/i);
  });

  it('EMPTY: shows the honest "no pacts yet — write one above" CTA when nothing exists', async () => {
    lensRun.mockImplementation(routed({
      'pact-list': () => reply(EMPTY_LIST),
      'pact-notifications': () => reply(EMPTY_NOTIF),
      'pact-payout-history': () => reply(EMPTY_HIST),
    }));
    const { getByTestId, getByText } = render(<DeathInsurancePage />);
    await waitFor(() => expect(getByTestId('death-insurance-written-empty')).toBeInTheDocument());
    expect(getByText(/No pacts yet — write one above/i)).toBeInTheDocument();
    // The CTA target (PactWriter) is present above the empty list.
    expect(getByTestId('pact-writer')).toBeInTheDocument();
  });

  it('ERROR: a failed pact-list shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(routed({
      'pact-list': () =>
        fail
          ? Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } })
          : reply({ written: [PACT], beneficiaryOf: [], count: 1 }),
      'pact-notifications': () => reply(EMPTY_NOTIF),
      'pact-payout-history': () => reply(EMPTY_HIST),
    }));
    const { container, getByText, getByTestId } = render(<DeathInsurancePage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated — the real pact row appears, the alert clears.
    await waitFor(() => expect(getByTestId('pact-pct_1')).toBeInTheDocument());
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('ERROR: a network reject (thrown) also surfaces role=alert, not a silent empty', async () => {
    lensRun.mockImplementation(() => Promise.reject(new Error('network down')));
    const { container, getByText } = render(<DeathInsurancePage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network down/i)).toBeInTheDocument();
  });

  it('POPULATED: renders real pact rows + the real payout/notification rollups', async () => {
    lensRun.mockImplementation(routed({
      'pact-list': () => reply({ written: [PACT], beneficiaryOf: [{ ...PACT, id: 'pct_b' }], count: 2 }),
      'pact-notifications': () => reply({ notifications: [{ kind: 'expiring', severity: 'high' }], count: 1, unreadHigh: 1 }),
      'pact-payout-history': () => reply({ paidOut: [], received: [], totalPaidOutSparks: 600, totalReceivedSparks: 0 }),
    }));
    const { getByTestId } = render(<DeathInsurancePage />);
    await waitFor(() => expect(getByTestId('pact-pct_1')).toBeInTheDocument());
    // real values flow into the row + the rollup children
    expect(getByTestId('pact-pct_1').textContent).toMatch(/1000 sparks/);
    expect(getByTestId('bene-pct_b')).toBeInTheDocument();
    expect(getByTestId('notifications').textContent).toBe('notes:1');
    expect(getByTestId('payout-history').textContent).toBe('paidOut:600');
  });

  it('a11y: the page root reflects aria-busy while loading', async () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { getByTestId } = render(<DeathInsurancePage />);
    await waitFor(() => expect(getByTestId('death-insurance-root')).toHaveAttribute('aria-busy', 'true'));
  });
});
