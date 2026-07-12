/**
 * EmployerBrowser — the NPC employer directory + propose-contract flow
 * (checklist item 6, docs/lens-specs/careers-capability-map.md).
 *
 * Drives the component against a mocked lensRun standing in for the real
 * `careers.employers` / `careers.offer` macros, exactly the shape
 * server/domains/careers.js returns. No fabricated data: employer rows come
 * straight from the mocked macro response, never hardcoded in the component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const addToast = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
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

import { EmployerBrowser } from '@/components/careers/EmployerBrowser';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const EMPLOYERS = [
  {
    npcId: 'npc-trader-1', name: 'Vell the Trader', archetype: 'trader', faction: 'Merchants Guild',
    trackId: 'trader', category: 'Mercantile', tier: 3, tierTitle: 'Trader', suggestedWage: 26, level: 8,
  },
];

beforeEach(() => {
  lensRun.mockReset();
  addToast.mockReset();
  mockUser = { id: 'player-1' };
});

describe('EmployerBrowser', () => {
  it('LOADING: shows an aria-busy status indicator while employers are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    const { getByText } = render(<EmployerBrowser trackId="trader" />);
    expect(getByText(/Finding employers/i)).toBeInTheDocument();
  });

  it('fetches careers.employers for the given trackId and renders real employer data (not fabricated)', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'employers' ? reply({ ok: true, employers: EMPLOYERS }) : reply({ ok: true }));
    const { getByText } = render(<EmployerBrowser trackId="trader" />);

    await waitFor(() => expect(getByText(/Vell the Trader/)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[0] === 'careers' && c[1] === 'employers' && c[2]?.trackId === 'trader')).toBe(true);
    expect(getByText(/trader · Merchants Guild/)).toBeInTheDocument();
    expect(getByText(/tier 3 · Trader · 26 sparks\/shift/)).toBeInTheDocument();
  });

  it('EMPTY: shows an honest "no NPCs hiring" message, never a fabricated listing', async () => {
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'employers' ? reply({ ok: true, employers: [] }) : reply({ ok: true }));
    const { getByText } = render(<EmployerBrowser trackId="chef" />);
    await waitFor(() => expect(getByText(/No NPCs are currently hiring for chef/i)).toBeInTheDocument());
  });

  it('PROPOSE: opens the terms form, then sends a real careers.offer with the discovered NPC as employer + the signed-in player as worker', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'employers') return reply({ ok: true, employers: EMPLOYERS });
      if (name === 'offer') return reply({ ok: true, contractId: 'ctr_new' });
      return reply({ ok: true });
    });
    const onContractProposed = vi.fn();
    const { getByLabelText } = render(<EmployerBrowser trackId="trader" onContractProposed={onContractProposed} />);
    await waitFor(() => expect(getByLabelText('Propose a contract to Vell the Trader')).toBeInTheDocument());

    fireEvent.click(getByLabelText('Propose a contract to Vell the Trader'));
    fireEvent.change(getByLabelText('Base wage offered to Vell the Trader'), { target: { value: '40' } });
    fireEvent.change(getByLabelText('Signing bonus offered to Vell the Trader'), { target: { value: '15' } });
    fireEvent.click(getByLabelText('Send contract offer to Vell the Trader'));

    await waitFor(() => expect(onContractProposed).toHaveBeenCalled());
    const offerCall = lensRun.mock.calls.find((c) => c[1] === 'offer');
    expect(offerCall?.[2]).toMatchObject({
      employerKind: 'npc', employerId: 'npc-trader-1',
      workerKind: 'player', workerId: 'player-1',
      trackId: 'trader', tier: 3, baseWage: 40, signingBonus: 15,
    });
    expect(addToast.mock.calls.some((c) => c[0]?.type === 'success')).toBe(true);
  });

  it('PROPOSE (rejected): a reputation_too_low rejection surfaces the real server reason, not a silently-accepted offer', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'employers') return reply({ ok: true, employers: EMPLOYERS });
      if (name === 'offer') return reply({ ok: false, reason: 'reputation_too_low' });
      return reply({ ok: true });
    });
    const onContractProposed = vi.fn();
    const { getByLabelText } = render(<EmployerBrowser trackId="trader" onContractProposed={onContractProposed} />);
    await waitFor(() => expect(getByLabelText('Propose a contract to Vell the Trader')).toBeInTheDocument());
    fireEvent.click(getByLabelText('Propose a contract to Vell the Trader'));
    fireEvent.click(getByLabelText('Send contract offer to Vell the Trader'));

    await waitFor(() => expect(addToast.mock.calls.some((c) => c[0]?.type === 'error' && /reputation_too_low/.test(c[0]?.message))).toBe(true));
    expect(onContractProposed).not.toHaveBeenCalled();
  });

  it('requires sign-in to propose a contract', async () => {
    mockUser = null;
    lensRun.mockImplementation((_d: string, name: string) =>
      name === 'employers' ? reply({ ok: true, employers: EMPLOYERS }) : reply({ ok: true }));
    const { getByLabelText, queryByLabelText } = render(<EmployerBrowser trackId="trader" />);
    await waitFor(() => expect(getByLabelText('Propose a contract to Vell the Trader')).toBeInTheDocument());
    fireEvent.click(getByLabelText('Propose a contract to Vell the Trader'));
    fireEvent.click(getByLabelText('Send contract offer to Vell the Trader'));

    await waitFor(() => expect(addToast.mock.calls.some((c) => c[0]?.type === 'error' && /Sign in/i.test(c[0]?.message))).toBe(true));
    // no offer macro call was ever attempted without a signed-in user
    expect(lensRun.mock.calls.some((c) => c[1] === 'offer')).toBe(false);
    expect(queryByLabelText('Cancel proposing a contract')).toBeInTheDocument();
  });

  it('re-fetches when trackId changes', async () => {
    lensRun.mockImplementation((_d: string, name: string, input?: Record<string, unknown>) => {
      if (name === 'employers') {
        return reply({ ok: true, employers: input?.trackId === 'smith' ? [] : EMPLOYERS });
      }
      return reply({ ok: true });
    });
    const { rerender, getByText, queryByText } = render(<EmployerBrowser trackId="trader" />);
    await waitFor(() => expect(getByText(/Vell the Trader/)).toBeInTheDocument());

    rerender(<EmployerBrowser trackId="smith" />);
    await waitFor(() => expect(queryByText(/Vell the Trader/)).toBeNull());
    expect(lensRun.mock.calls.some((c) => c[1] === 'employers' && c[2]?.trackId === 'smith')).toBe(true);
  });
});
