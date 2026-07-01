/**
 * /lenses/civic-bonds — four-UX-state contract.
 *
 * Pins that the civic-bonds lens renders genuine loading (role=status,
 * aria-busy) / error (role=alert + a working Retry) / empty / ready states
 * against the real `civic_bonds` macro surface (driven by a mocked lensRun
 * standing in for POST /api/lens/run → the civic_bonds domain), plus a11y
 * (the pledge input + the pledge/vote/fund buttons carry accessible names) and
 * the disabled coming-soon note (kill-switch off).
 *
 * No fabricated data: every state is driven by the exact shapes the
 * civic_bonds.{list,pledge,vote,fund} macros return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// The toast store — stub addToast so success/error paths are observable and
// hermetic (no real zustand store / DOM toast rendering needed).
const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}));

// LensShell is a presentational wrapper — stub to keep the render focused.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import CivicBondsLens from '@/app/lenses/civic-bonds/page';

const BOND = {
  id: 'b_1',
  world_id: 'concordia-hub',
  realm_id: null,
  title: 'New Aqueduct',
  description: 'Fund the eastern aqueduct.',
  status: 'voting',
  target_amount: 1000,
  current_pledged: 1200,
  denomination: 100,
  funding_gate_pct: 1.1,
  return_rate: 0.05,
  votes_for: 3,
  votes_against: 1,
  labor_source: 'guild',
};

beforeEach(() => {
  lensRunMock.mockReset();
  addToastMock.mockClear();
});

describe('civic-bonds lens — four UX states', () => {
  it('LOADING: shows a role=status / aria-busy notice while the list is in flight', async () => {
    // list never resolves → stuck loading.
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });
    const loading = view!.getByTestId('civic-bonds-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('EMPTY: shows an honest empty state once the list loads with no bonds', async () => {
    lensRunMock.mockResolvedValue({ data: { result: { ok: true, bonds: [] } } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });
    await waitFor(() => expect(view!.getByTestId('civic-bonds-empty')).toBeInTheDocument());
    expect(view!.getByTestId('civic-bonds-empty').textContent).toMatch(/no civic bonds/i);
    expect(view!.getByLabelText('Refresh civic bonds')).toBeInTheDocument();
  });

  it('DISABLED: shows the coming-soon note when the kill-switch is off', async () => {
    lensRunMock.mockResolvedValue({ data: { result: { ok: false, reason: 'disabled' } } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });
    await waitFor(() => expect(view!.getByTestId('civic-bonds-disabled')).toBeInTheDocument());
    expect(view!.getByTestId('civic-bonds-disabled').textContent).toMatch(/coming soon/i);
  });

  it('READY: renders real active bonds with accessible pledge / vote controls', async () => {
    lensRunMock.mockResolvedValue({ data: { result: { ok: true, bonds: [BOND] } } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });
    await waitFor(() => expect(view!.getByTestId('civic-bonds-list')).toBeInTheDocument());
    expect(view!.getByText('New Aqueduct')).toBeInTheDocument();
    // a11y: input + buttons carry accessible names.
    expect(view!.getByLabelText('Pledge amount (sparks)')).toBeInTheDocument();
    expect(view!.getByLabelText('Pledge to New Aqueduct')).toBeInTheDocument();
    expect(view!.getByLabelText('Vote for New Aqueduct')).toBeInTheDocument();
    expect(view!.getByLabelText('Vote against New Aqueduct')).toBeInTheDocument();
    // gate cleared (1200 >= 1000 * 1.1) → Fund button shows.
    expect(view!.getByLabelText('Fund New Aqueduct')).toBeInTheDocument();
  });

  it('READY → ACTION: a successful pledge fires a success toast and re-lists', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'list') return Promise.resolve({ data: { result: { ok: true, bonds: [BOND] } } });
      return Promise.resolve({ data: { result: { ok: true } } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });
    await waitFor(() => expect(view!.getByTestId('civic-bonds-list')).toBeInTheDocument());

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'list').length;
    await act(async () => { fireEvent.click(view!.getByLabelText('Pledge to New Aqueduct')); });

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'list').length;
    expect(after).toBeGreaterThan(before); // re-listed after the action
  });

  it('ERROR: shows role=alert + a Retry that re-issues the list call', async () => {
    let calls = 0;
    lensRunMock.mockImplementation(() => {
      calls += 1;
      return Promise.reject(new Error('network down'));
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CivicBondsLens />); });

    await waitFor(() => expect(view!.getByTestId('civic-bonds-error')).toBeInTheDocument());
    expect(view!.getByTestId('civic-bonds-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('civic-bonds-error').textContent).toMatch(/failed to load/i);

    const before = calls;
    await act(async () => { fireEvent.click(view!.getByLabelText('Retry loading civic bonds')); });
    expect(calls).toBeGreaterThan(before);
  });
});
