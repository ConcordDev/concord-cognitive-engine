import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell + the cross-lens/recents panels + a11y hooks pull in next/dynamic,
// the UI store, the panel registry, etc. Stub them to passthroughs / no-ops so
// this test isolates the death-insurance PAGE's own four UX states + a11y.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// The child components are exercised in their own units; here we keep the
// PactWriter real (it renders the create form — the editor UX state) but stub
// the data-rendering children so we assert the page's own state branches.
vi.mock('@/components/death-insurance/InsuranceChatter', () => ({ InsuranceChatter: () => null }));
vi.mock('@/components/death-insurance/PactCard', () => ({
  PactCard: ({ pact }: { pact: { id: string } }) =>
    React.createElement('li', { 'data-testid': 'pact-card' }, pact.id),
}));
vi.mock('@/components/death-insurance/BeneficiaryPactCard', () => ({
  BeneficiaryPactCard: ({ pact }: { pact: { id: string } }) =>
    React.createElement('li', { 'data-testid': 'bene-pact-card' }, pact.id),
}));
vi.mock('@/components/death-insurance/PactNotifications', () => ({ PactNotifications: () => null }));
vi.mock('@/components/death-insurance/PayoutHistory', () => ({ PayoutHistory: () => null }));

// The page calls the real insurance.pact-* macros through lensRun. Each test
// installs its own resolution.
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

function envelope(ok: boolean, result: unknown, error: string | null = null) {
  return { data: { ok, result, error } };
}

// Resolve the three Promise.all macros by (domain, action) name.
function installResolver(map: Record<string, ReturnType<typeof envelope>>) {
  lensRun.mockImplementation((_domain: string, action: string) =>
    Promise.resolve(map[action] ?? envelope(true, {})),
  );
}

const emptyList = envelope(true, { written: [], beneficiaryOf: [], count: 0 });
const emptyNotif = envelope(true, { notifications: [], count: 0, unreadHigh: 0 });
const emptyHist = envelope(true, {
  paidOut: [], received: [], totalPaidOutSparks: 0, totalReceivedSparks: 0,
});

async function renderPage() {
  const { default: DeathInsurancePage } = await import('@/app/lenses/death-insurance/page');
  render(React.createElement(DeathInsurancePage));
}

describe('DeathInsurancePage — four UX states + a11y', () => {
  beforeEach(() => { vi.resetModules(); lensRun.mockReset(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('LOADING: marks the workspace aria-busy + shows an a11y status while macros are in flight', async () => {
    lensRun.mockReturnValue(new Promise(() => {})); // never resolves
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('death-insurance-root')).toHaveAttribute('aria-busy', 'true');
    });
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('EMPTY: renders the honest empty state when the user has no pacts', async () => {
    installResolver({
      'pact-list': emptyList,
      'pact-notifications': emptyNotif,
      'pact-payout-history': emptyHist,
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('death-insurance-written-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/no pacts yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('death-insurance-root')).toHaveAttribute('aria-busy', 'false');
    // No error banner in the happy/empty path.
    expect(screen.queryByTestId('death-insurance-error')).not.toBeInTheDocument();
  });

  it('DATA: renders a real pact the backend returned', async () => {
    installResolver({
      'pact-list': envelope(true, {
        written: [{ id: 'pct_abc' }],
        beneficiaryOf: [{ id: 'pct_xyz' }],
        count: 2,
      }),
      'pact-notifications': emptyNotif,
      'pact-payout-history': emptyHist,
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('pct_abc')).toBeInTheDocument();
    });
    expect(screen.getByText('pct_xyz')).toBeInTheDocument();
    expect(screen.queryByTestId('death-insurance-written-empty')).not.toBeInTheDocument();
  });

  it('ERROR: shows an honest role=alert with a Retry button when pact-list fails, then recovers', async () => {
    installResolver({
      'pact-list': envelope(false, null, 'unknown_macro'),
      'pact-notifications': emptyNotif,
      'pact-payout-history': emptyHist,
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByTestId('death-insurance-error')).toHaveTextContent(/unknown_macro/i);
    const retry = screen.getByRole('button', { name: /retry/i });

    // Retry re-invokes the macros — this time pact-list succeeds + clears the error.
    installResolver({
      'pact-list': emptyList,
      'pact-notifications': emptyNotif,
      'pact-payout-history': emptyHist,
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('death-insurance-written-empty')).toBeInTheDocument();
  });

  it('wires every read to the REAL insurance.pact-* macros (not phantom lens.death-insurance.*)', async () => {
    installResolver({
      'pact-list': emptyList,
      'pact-notifications': emptyNotif,
      'pact-payout-history': emptyHist,
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('death-insurance-written-empty')).toBeInTheDocument();
    });
    const calledWith = lensRun.mock.calls.map((c) => [c[0], c[1]]);
    expect(calledWith).toContainEqual(['insurance', 'pact-list']);
    expect(calledWith).toContainEqual(['insurance', 'pact-notifications']);
    expect(calledWith).toContainEqual(['insurance', 'pact-payout-history']);
    // No phantom lens.death-insurance.* call.
    expect(lensRun.mock.calls.every((c) => c[0] === 'insurance')).toBe(true);
  });
});
