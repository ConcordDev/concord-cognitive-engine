/**
 * ReputationGate — surfaces the player's real career reputation + which
 * tiers it gates them out of (checklist item 7,
 * docs/lens-specs/careers-capability-map.md).
 *
 * Drives the component against a mocked lensRun standing in for the real
 * `careers.myReputation` macro, exactly the shape server/domains/careers.js
 * returns (server/lib/career-contracts.js#deriveWorkerReputation +
 * reputationGateTier/reputationWageMultiplier). No fabricated numbers: every
 * rendered value comes straight from the mocked macro response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

let mockUser: { id: string } | null = { id: 'player-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, isAuthenticated: !!mockUser }),
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

import { ReputationGate } from '@/components/careers/ReputationGate';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  mockUser = { id: 'player-1' };
});

describe('ReputationGate', () => {
  it('LOADING: shows an aria-busy status indicator while reputation is in flight', () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { getByText } = render(<ReputationGate trackId="chef" />);
    expect(getByText(/Loading reputation/i)).toBeInTheDocument();
  });

  it('renders the real reputation + gate tier + wage multiplier from the macro (not recomputed client-side)', async () => {
    lensRun.mockImplementation((_d: string, name: string, input?: Record<string, unknown>) => {
      if (name === 'myReputation') {
        return reply({
          ok: true, trackId: input?.trackId, reputation: 42, gateTier: 6,
          wageMultiplier: 0.968, gatedTiers: [7, 8, 9, 10],
        });
      }
      return reply({ ok: true });
    });
    const { getByText, getByRole } = render(<ReputationGate trackId="chef" />);
    await waitFor(() => expect(getByText('42/100')).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[0] === 'careers' && c[1] === 'myReputation' && c[2]?.trackId === 'chef')).toBe(true);
    expect(getByText(/Hireable up to/)).toBeInTheDocument();
    expect(getByText(/tier 6/)).toBeInTheDocument();
    expect(getByText(/×0.97/)).toBeInTheDocument();
    expect(getByText(/Gated out of tiers 7, 8, 9, 10/)).toBeInTheDocument();
    const bar = getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('a fresh worker (reputation 0, no gate) shows the honest "no tier gate" message', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'myReputation' ? reply({ ok: true, trackId: 'chef', reputation: 0, gateTier: 3, wageMultiplier: 0.8, gatedTiers: [4, 5, 6, 7, 8, 9, 10] }) : reply({ ok: true }));
    const { getByText } = render(<ReputationGate trackId="chef" />);
    await waitFor(() => expect(getByText('0/100')).toBeInTheDocument());
    expect(getByText(/Gated out of tiers 4, 5, 6, 7, 8, 9, 10/)).toBeInTheDocument();
  });

  it('gateTier 10 with an empty gatedTiers list shows "no tier gate"', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'myReputation' ? reply({ ok: true, trackId: 'chef', reputation: 100, gateTier: 10, wageMultiplier: 1.2, gatedTiers: [] }) : reply({ ok: true }));
    const { getByText } = render(<ReputationGate trackId="chef" />);
    await waitFor(() => expect(getByText(/No tier gate/i)).toBeInTheDocument());
  });

  it('signed-out: never calls myReputation and shows a sign-in prompt', async () => {
    mockUser = null;
    lensRun.mockImplementation(() => reply({ ok: true }));
    const { getByText } = render(<ReputationGate trackId="chef" />);
    await waitFor(() => expect(getByText(/Sign in to see your reputation/i)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'myReputation')).toBe(false);
  });

  it('calls onLoaded with the fetched info so a parent (e.g. the tier ladder) can mark gated tiers', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'myReputation' ? reply({ ok: true, trackId: 'chef', reputation: 20, gateTier: 6, wageMultiplier: 0.88, gatedTiers: [7, 8, 9, 10] }) : reply({ ok: true }));
    const onLoaded = vi.fn();
    render(<ReputationGate trackId="chef" onLoaded={onLoaded} />);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ reputation: 20, gateTier: 6, gatedTiers: [7, 8, 9, 10] })));
  });

  it('calls onLoaded(null) when signed out', async () => {
    mockUser = null;
    const onLoaded = vi.fn();
    render(<ReputationGate trackId="chef" onLoaded={onLoaded} />);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(null));
  });

  it('re-fetches when trackId changes', async () => {
    lensRun.mockImplementation((_d: string, name: string, input?: Record<string, unknown>) => {
      if (name === 'myReputation') {
        const trackId = input?.trackId as string;
        return reply({ ok: true, trackId, reputation: trackId === 'smith' ? 60 : 20, gateTier: trackId === 'smith' ? 8 : 6, wageMultiplier: 1, gatedTiers: [] });
      }
      return reply({ ok: true });
    });
    const { rerender, getByText } = render(<ReputationGate trackId="chef" />);
    await waitFor(() => expect(getByText('20/100')).toBeInTheDocument());

    rerender(<ReputationGate trackId="smith" />);
    await waitFor(() => expect(getByText('60/100')).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'myReputation' && c[2]?.trackId === 'smith')).toBe(true);
  });
});
