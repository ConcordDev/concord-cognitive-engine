/**
 * FIX-byo-keys-010 — (a) BudgetPanel 'clear' removed all caps/limits
 * with one click and no confirm; (b) a 500-digit cap entry became
 * Infinity and saved with no error; (c) FallbackChainPanel saved an
 * emptied draft as a whole-chain removal with no confirm. Clear and
 * chain-clear are now two-step, and caps are bounded with the bound
 * named in the error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const H = vi.hoisted(() => ({ calls: [] as { action: string; input: Record<string, unknown> }[] }));
const lensRunMock = vi.hoisted(() => vi.fn(async (_d: string, action: string, input: Record<string, unknown> = {}) => {
  H.calls.push({ action, input });
  if (action === 'budget_status') {
    return { data: { ok: true, result: { month: '2026-11', slots: [
      { slot: 'conscious', budget: { monthlyUsdCap: 50, monthlyTokenCap: null }, spentUsd: 3, spentTokens: 0, usdPct: 0.06, tokenPct: null, exceeded: false },
    ] } } };
  }
  if (action === 'list_fallbacks') {
    return { data: { ok: true, result: { chains: { conscious: ['utility'] } } } };
  }
  return { data: { ok: true, result: {} } };
}));
vi.mock('@/lib/api/client', () => ({ lensRun: lensRunMock }));

import { BudgetPanel } from '@/components/byo-keys/BudgetPanel';
import { FallbackChainPanel } from '@/components/byo-keys/FallbackChainPanel';

describe('FIX-byo-keys-010', () => {
  beforeEach(() => { vi.clearAllMocks(); H.calls = []; });

  it('clearing caps takes two steps; the first click fires nothing', async () => {
    render(<BudgetPanel />);
    const arm = await screen.findByRole('button', { name: 'Clear budget caps for conscious' });
    fireEvent.click(arm);
    expect(H.calls.filter((c) => c.action === 'set_budget')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm clear budget caps' }));
    await waitFor(() => expect(H.calls.filter((c) => c.action === 'set_budget')).toHaveLength(1));
    expect(H.calls.find((c) => c.action === 'set_budget')!.input).toMatchObject({ slot: 'conscious', monthlyUsdCap: null, monthlyTokenCap: null });
  });

  it('an absurd-magnitude cap (the 500-digit class) is refused with the bound named', async () => {
    render(<BudgetPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /edit cap/ }));
    fireEvent.change(await screen.findByLabelText('Monthly USD cap'), { target: { value: '9'.repeat(30) } });
    fireEvent.click(screen.getByRole('button', { name: 'save cap' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no greater than 1,000,000');
    expect(H.calls.filter((c) => c.action === 'set_budget')).toHaveLength(0);
  });

  it('saving an emptied fallback chain arms first, then clears on the second click', async () => {
    render(<FallbackChainPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /edit chain/ }));
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    fireEvent.click(screen.getByRole('button', { name: 'save chain' }));
    expect(await screen.findByTestId('fallback-notice')).toHaveTextContent('removes the whole fallback chain');
    expect(H.calls.filter((c) => c.action === 'set_fallback')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'confirm clear chain' }));
    await waitFor(() => expect(H.calls.filter((c) => c.action === 'set_fallback')).toHaveLength(1));
    expect(H.calls.find((c) => c.action === 'set_fallback')!.input).toMatchObject({ slot: 'conscious', chain: [] });
  });
});
