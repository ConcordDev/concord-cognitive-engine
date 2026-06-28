import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell pulls in next/dynamic + the UI store + a11y hooks; stub it to a
// passthrough so this test isolates the civic-bonds page's own four states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

// The page reaches its backend ONLY through lensRun('civic_bonds', …) — the
// real fix for the hyphen/underscore domain-name mismatch. Mock lensRun so we
// can assert (a) it is called with the UNDERSCORE domain and (b) the four
// UX states render from the unwrapped { ok, result } envelope.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// envelope shape lensRun returns: { data: { result } }
function env(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

const sampleBond = {
  id: 'cbond_1', world_id: 'concordia-hub', realm_id: 'r1', title: 'Ember Bridge',
  description: 'Span the river.', status: 'funding', target_amount: 10000,
  current_pledged: 6000, denomination: 100, funding_gate_pct: 1.1, return_rate: 0.005,
  votes_for: 3, votes_against: 1, labor_source: 'in_house',
};

async function renderPage() {
  const { default: CivicBondsLens } = await import('@/app/lenses/civic-bonds/page');
  render(React.createElement(CivicBondsLens));
}

describe('CivicBondsLens — domain wiring + four UX states', () => {
  beforeEach(() => { vi.resetModules(); lensRunMock.mockReset(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('WIRING: calls lensRun with the UNDERSCORE backend domain civic_bonds (not the hyphen lens id)', async () => {
    lensRunMock.mockResolvedValue(env({ ok: true, bonds: [] }));
    await renderPage();
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const [domain, action] = lensRunMock.mock.calls[0];
    expect(domain).toBe('civic_bonds');
    expect(action).toBe('list');
  });

  it('LOADING: shows a loading status while the list call is in flight', async () => {
    lensRunMock.mockReturnValue(new Promise(() => {})); // never resolves
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('ERROR: shows an alert with a Retry button when the call throws', async () => {
    lensRunMock.mockRejectedValue(new Error('network'));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/failed to load civic bonds/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('EMPTY: shows a genuine empty state when there are no bonds', async () => {
    lensRunMock.mockResolvedValue(env({ ok: true, bonds: [] }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no civic bonds in this world yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('POPULATED: renders a real bond with its progress, gate state, and actions', async () => {
    lensRunMock.mockResolvedValue(env({ ok: true, bonds: [sampleBond] }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Ember Bridge')).toBeInTheDocument();
    });
    // Real pledged/target rendered from the data (6,000 / 10,000).
    expect(screen.getByText(/6,000 \/ 10,000 sparks/i)).toBeInTheDocument();
    // 6000 < 11000 gate → not cleared.
    expect(screen.getByText(/needs 110%/i)).toBeInTheDocument();
    // Pledge control + its labelled amount input are present.
    expect(screen.getByLabelText(/pledge amount/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^pledge$/i })).toBeInTheDocument();
  });

  it('DISABLED: shows the coming-soon note when the kill-switch reports disabled', async () => {
    lensRunMock.mockResolvedValue(env({ ok: false, reason: 'disabled' }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    });
  });

  it('FAIL-CLOSED: a bad pledge amount is rejected client-side without calling pledge', async () => {
    lensRunMock.mockResolvedValue(env({ ok: true, bonds: [sampleBond] }));
    await renderPage();
    await waitFor(() => expect(screen.getByText('Ember Bridge')).toBeInTheDocument());
    const input = screen.getByLabelText(/pledge amount/i) as HTMLInputElement;
    // 150 is not a multiple of the 100 denomination → guard trips.
    fireEvent.change(input, { target: { value: '150' } });
    const pledgeBtn = screen.getByRole('button', { name: /^pledge$/i }) as HTMLButtonElement;
    expect(pledgeBtn).toBeDisabled();
    const callsBefore = lensRunMock.mock.calls.length;
    fireEvent.click(pledgeBtn);
    // disabled button → no new pledge call fired.
    expect(lensRunMock.mock.calls.length).toBe(callsBefore);
  });
});
