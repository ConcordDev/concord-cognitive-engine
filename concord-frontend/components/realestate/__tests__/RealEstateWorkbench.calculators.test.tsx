// FIX-housing-003 — the Search drawer's calculator (RealEstateWorkbench):
// the Mortgage tab computes on open and the Rent vs Buy tab switches in
// and computes, both through the macros' own field names. Pins the
// "calculator opens" leg against the lensRun envelope the client helper
// actually returns (already unwrapped to the payload).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: h.lensRun }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  h.lensRun.mockReset();
  h.lensRun.mockImplementation(async (spec: { action?: string }) => {
    if (spec.action === 'calc-mortgage') {
      return { data: { ok: true, error: null, result: { monthly: { total: 3400, principalAndInterest: 2661, tax: 458, insurance: 100, pmi: 0, hoa: 0 }, ltvPercent: 80, totalInterest: 557960, totalCostOverTerm: 1224000 } } };
    }
    if (spec.action === 'calc-rent-vs-buy') {
      return { data: { ok: true, error: null, result: { breakEvenYear: 6, verdict: 'Buying wins after 6 years.', chartPoints: [{ year: 1, buyNet: 50000, rentNet: 30000 }] } } };
    }
    return { data: { ok: true, error: null, result: { searches: [] } } };
  });
});
afterEach(() => { cleanup(); });

describe('RealEstateWorkbench calculators (FIX-housing-003)', () => {
  it('opens on Mortgage with a computed PITI, then Rent vs Buy switches in and computes', async () => {
    const { RealEstateWorkbench } = await import('../RealEstateWorkbench');
    render(<RealEstateWorkbench open onClose={() => {}} />);
    await settle();
    expect(await screen.findByText(/Monthly total:/)).toBeTruthy();
    expect(screen.getByText('$3,400')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /rent vs buy/i }));
    await settle();
    expect(await screen.findByText('Buying wins after 6 years.')).toBeTruthy();
    expect(screen.getByText(/Break-even: year 6/)).toBeTruthy();
    const rentCall = h.lensRun.mock.calls.find((c) => (c[0] as { action?: string }).action === 'calc-rent-vs-buy');
    expect(rentCall).toBeTruthy();
    expect((rentCall[0] as { input: Record<string, unknown> }).input).toMatchObject({ price: 500000, rent: 2500, downPercent: 20, rate: 7 });
  });

  it('renders nothing while closed', async () => {
    const { RealEstateWorkbench } = await import('../RealEstateWorkbench');
    const { container } = render(<RealEstateWorkbench open={false} onClose={() => {}} />);
    await settle();
    expect(container.textContent).toBe('');
  });
});
