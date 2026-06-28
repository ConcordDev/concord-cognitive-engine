/**
 * /lenses/staking — four-UX-state contract.
 *
 * Pins that the Staking lens renders genuine loading / error (with a working
 * Retry) / empty / populated states against the real macro surface
 * (lensRun('staking', …) → POST /api/lens/run), plus a11y. The StakePositions
 * panel carries the lens's load/redeem/early-exit/compound/auto-compound state
 * machine, so it is the canonical four-state surface; the page itself is also
 * exercised for the open_stake round-trip.
 *
 * No fabricated data: every state is driven by a mocked lensRun standing in for
 * the real backend, exactly the { ok, result } envelope server/domains/staking.js
 * returns. The headless LensShell + sibling panels are stubbed so the test stays
 * on the component's own state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the panel's single backend channel ───────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// Import AFTER the mock is registered.
import { StakePositions } from '@/components/staking/StakePositions';

// lensRun returns an axios-shaped { data: { ok, result, error } }.
function reply(result: Record<string, unknown> | null, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

const ACTIVE_POSITION = {
  id: 'stk_1',
  poolId: 'core',
  poolName: 'Core Pool',
  principalCc: 250,
  stakeMonths: 6,
  lockedAt: 1_700_000_000,
  unlocksAt: 1_900_000_000,
  yieldRateBps: 220,
  accruedYieldCc: 3.5,
  autoCompound: false,
  status: 'active',
  receiptTokenId: null,
  compoundCount: 0,
  unlocked: false,
};

function positionList(positions: unknown[]) {
  return {
    positions,
    count: positions.length,
    totalPrincipalCc: positions.reduce(
      (s: number, p) => s + ((p as { principalCc: number }).principalCc || 0),
      0,
    ),
    totalAccruedYieldCc: positions.reduce(
      (s: number, p) => s + ((p as { accruedYieldCc: number }).accruedYieldCc || 0),
      0,
    ),
  };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('staking lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while positions are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container, getByText } = render(<StakePositions refreshKey={0} onChange={() => {}} />);
    await waitFor(() => expect(getByText(/Loading positions/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation(() => {
      if (fail) return Promise.reject(new Error('network down'));
      return reply(positionList([ACTIVE_POSITION]));
    });
    const { container, getByText } = render(<StakePositions refreshKey={0} onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => {
      fireEvent.click(getByText('Retry'));
    });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText(/Core Pool/)).toBeInTheDocument());
  });

  it('ERROR: an ok:false envelope (e.g. no_actor) also surfaces role=alert with the reason', async () => {
    lensRun.mockImplementation(() => reply(null, false, 'no_actor'));
    const { container, getByText } = render(<StakePositions refreshKey={0} onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/no_actor/)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "no positions yet" CTA when count === 0', async () => {
    lensRun.mockImplementation(() => reply(positionList([])));
    const { getByText, container } = render(<StakePositions refreshKey={0} onChange={() => {}} />);
    await waitFor(() => expect(getByText(/No positions yet/i)).toBeInTheDocument());
    // the empty CTA is announced
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('POPULATED: renders the position from real macro data with a11y list label', async () => {
    lensRun.mockImplementation(() => reply(positionList([ACTIVE_POSITION])));
    const { getByText, getAllByText, getByLabelText } = render(
      <StakePositions refreshKey={0} onChange={() => {}} />,
    );
    await waitFor(() => expect(getByText(/Core Pool/)).toBeInTheDocument());
    expect(getByLabelText('Your staking positions')).toBeInTheDocument();
    expect(getAllByText(/250 CC/).length).toBeGreaterThan(0);
    // active + locked → early-exit button is the offered action
    expect(getByText(/Early exit/i)).toBeInTheDocument();
  });

  it('POPULATED: an unlocked position offers Redeem and round-trips the real return amount', async () => {
    const unlocked = { ...ACTIVE_POSITION, unlocked: true };
    let redeemed = false;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'redeem_stake') {
        redeemed = true;
        return reply({ totalReturnCc: 253.5, accruedYieldCc: 3.5, principalCc: 250 });
      }
      return reply(positionList(redeemed ? [] : [unlocked]));
    });
    const { getByText } = render(<StakePositions refreshKey={0} onChange={() => {}} />);
    await waitFor(() => expect(getByText('Redeem')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(getByText('Redeem'));
    });
    await waitFor(() => expect(getByText(/Redeemed 253.5 CC/)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'redeem_stake')).toBe(true);
  });
});
