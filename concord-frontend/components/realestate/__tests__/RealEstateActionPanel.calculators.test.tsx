// FIX-housing-003 — the Desk Property workbench's Mortgage and Rent v buy
// buttons spoke a second dialect ({ homePrice, monthlyRent,
// downPaymentPct, interestRate/100 }, and no taxRate/insurance), so every
// click failed server-side and no result tile ever appeared. Pins the
// aligned call shapes (the macros' own field names, annual-% rate) and
// the tiles rendering the macros' real result fields, plus the
// say-what's-missing guard on Mortgage.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  runDomain: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: h.runDomain } },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: null, error: null } })),
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), ctl: {} }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));
vi.mock('@/lib/agent-reply', () => ({ readAgentReply: () => ({ ok: false, reason: 'no reply' }) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => <div onClick={p.onClick as React.MouseEventHandler}>{children}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const RESULTS: Record<string, unknown> = {
  'calc-rent-vs-buy': { breakEvenYear: 6, verdict: 'Buying wins after 6 years.', monthlyBuyTotal: 3100, monthlyRent: 2500, chartPoints: [] },
  'calc-mortgage': { monthly: { total: 3400, principalAndInterest: 2661, tax: 458, insurance: 100, pmi: 0, hoa: 0 }, totalInterest: 557960, totalCostOverTerm: 1224000, ltvPercent: 80 },
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function mount() {
  const { RealEstateActionPanel } = await import('../RealEstateActionPanel');
  return render(<RealEstateActionPanel />);
}

function fill(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

beforeEach(() => {
  h.runDomain.mockReset();
  h.runDomain.mockImplementation(async (_domain: string, action: string) => ({
    data: { ok: true, result: { ok: true, result: RESULTS[action] } },
  }));
});
afterEach(() => { cleanup(); });

describe('RealEstateActionPanel calculators (FIX-housing-003)', () => {
  it('Rent v buy sends the macro dialect and renders its verdict tile', async () => {
    await mount();
    fill('Price $', '500000');
    fill('Comp rent $/mo', '2500');
    fill('Down %', '20');
    fill('APR %', '7');
    fireEvent.click(screen.getByRole('button', { name: /rent v buy/i }));
    await settle();
    expect(await screen.findByText('Break-even')).toBeTruthy();
    // The verdict renders twice: the feedback line and the tile's sub.
    expect(screen.getAllByText(/Buying wins after 6 years\./).length).toBeGreaterThan(0);
    const call = h.runDomain.mock.calls.find((c) => c[1] === 'calc-rent-vs-buy');
    expect(call).toBeTruthy();
    expect(call[0]).toBe('realestate');
    expect(call[2]).toEqual({ input: { price: 500000, rent: 2500, downPercent: 20, rate: 7 } });
  });

  it('Mortgage sends price/downPercent/rate/taxRate/insurance and renders the PITI tile', async () => {
    await mount();
    fill('Price $', '500000');
    fill('Down %', '20');
    fill('APR %', '7');
    fill('Term yrs', '30');
    fill('Tax %/yr', '1.1');
    fill('Insurance $/yr', '1200');
    fireEvent.click(screen.getByRole('button', { name: /mortgage/i }));
    await settle();
    // The tile's big figure is the PITI total; its label duplicates the
    // button's, so assert on the figures.
    expect(await screen.findByText('$3400')).toBeTruthy();
    expect(screen.getByText(/P&I \$2661/)).toBeTruthy();
    const call = h.runDomain.mock.calls.find((c) => c[1] === 'calc-mortgage');
    expect(call).toBeTruthy();
    expect(call[2]).toEqual({ input: { price: 500000, downPercent: 20, rate: 7, termYears: 30, taxRate: 1.1, insurance: 1200 } });
  });

  it('Mortgage with empty fields says what is missing and calls nothing', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /mortgage/i }));
    await settle();
    expect(await screen.findByText(/Mortgage needs price, down %, APR, term, tax %\/yr and insurance \$\/yr/)).toBeTruthy();
    expect(h.runDomain.mock.calls.filter((c) => c[1] === 'calc-mortgage')).toHaveLength(0);
  });

  it('Rent v buy with no price/rent says what is missing and calls nothing', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /rent v buy/i }));
    await settle();
    expect(await screen.findByText(/Rent vs Buy needs a price and a comparable monthly rent\./)).toBeTruthy();
    expect(h.runDomain.mock.calls.filter((c) => c[1] === 'calc-rent-vs-buy')).toHaveLength(0);
  });
});
