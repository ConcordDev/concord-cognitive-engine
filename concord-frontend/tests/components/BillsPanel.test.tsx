/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Wave 4 (docs/lens-specs/accounting-capability-map.md "ai-suggest-vendor
 * has no UI" closure) — pins that the New-bill vendor field is a real
 * free-text combobox backed by the `accounting.ai-suggest-vendor` macro:
 * it debounces, surfaces a real AI-match suggestion (score comes from the
 * macro, never invented client-side), lets the user select an existing
 * vendor by typing/matching, offers to create a brand-new vendor from a
 * macro-suggested name, and never force-locks the field to only the
 * suggested/existing values (the user can still type any free text and
 * submit against whatever vendor gets selected).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { BillsPanel } from '@/components/accounting/BillsPanel';

const VENDORS = [
  { id: 'v_acme', name: 'Acme Supplies', defaultExpenseAccountId: 'acct_supplies' },
];
const ACCOUNTS = [
  { id: 'acct_supplies', code: '5100', name: 'Supplies expense', category: 'expense', archived: false },
];

interface LensSpec { domain: string; action: string; input?: Record<string, unknown> }

function mockDefaultImpl(extra?: (spec: LensSpec) => unknown) {
  lensRunMock.mockImplementation((spec: LensSpec) => {
    const override = extra?.(spec);
    if (override !== undefined) return Promise.resolve(override);
    if (spec.domain !== 'accounting') return Promise.resolve({ data: { ok: false, error: 'unexpected domain' } });
    switch (spec.action) {
      case 'bills-list':
        return Promise.resolve({ data: { ok: true, result: { bills: [] } } });
      case 'vendors-list':
        return Promise.resolve({ data: { ok: true, result: { vendors: VENDORS } } });
      case 'coa-list':
        return Promise.resolve({ data: { ok: true, result: { accounts: ACCOUNTS } } });
      case 'aging-ap':
        return Promise.resolve({ data: { ok: true, result: { buckets: [], totalOpen: 0 } } });
      default:
        return Promise.resolve({ data: { ok: false, error: 'unmocked action ' + spec.action } });
    }
  });
}

async function openNewBill() {
  render(<BillsPanel />);
  await waitFor(() => expect(screen.getByText('New bill')).toBeInTheDocument());
  fireEvent.click(screen.getByText('New bill'));
  return screen.getByPlaceholderText(/Vendor \* \(type to search or add\)/i);
}

describe('BillsPanel vendor autocomplete', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('is a free-text input, not a locked dropdown', async () => {
    mockDefaultImpl();
    const input = await openNewBill();
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, { target: { value: 'Some Brand New Vendor Co' } });
    // The field accepts arbitrary free text — never force-locked to an
    // existing/suggested value.
    expect((input as HTMLInputElement).value).toBe('Some Brand New Vendor Co');
  });

  it('debounces and calls ai-suggest-vendor with the typed text', async () => {
    mockDefaultImpl((spec) => {
      if (spec.domain === 'accounting' && spec.action === 'ai-suggest-vendor') {
        return { data: { ok: true, result: { matched: false, suggestedNewVendor: 'Staples Co' } } };
      }
      return undefined;
    });
    const input = await openNewBill();
    fireEvent.change(input, { target: { value: 'staples' } });

    // Not called yet — still inside the debounce window.
    const callsBefore = lensRunMock.mock.calls.filter(([s]) => s.action === 'ai-suggest-vendor').length;
    expect(callsBefore).toBe(0);

    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find(([s]) => s.action === 'ai-suggest-vendor');
      expect(call).toBeTruthy();
      expect((call![0] as LensSpec).input?.description).toBe('staples');
    });
  });

  it('shows a real AI-match suggestion with the macro-reported score and fills the field on select', async () => {
    mockDefaultImpl((spec) => {
      if (spec.domain === 'accounting' && spec.action === 'ai-suggest-vendor') {
        return { data: { ok: true, result: { matched: true, vendorId: 'v_acme', vendorName: 'Acme Supplies', score: 0.83 } } };
      }
      return undefined;
    });
    // A description that doesn't locally substring-match the vendor name
    // (so the plain existing-vendor list stays empty and only the real
    // AI-match suggestion — with the macro's own score — is on screen).
    const input = await openNewBill();
    fireEvent.change(input, { target: { value: 'ACME-INV-2291' } });
    await vi.advanceTimersByTimeAsync(400);

    const match = await screen.findByText(/AI match: Acme Supplies · 83%/);
    expect(match).toBeInTheDocument();

    fireEvent.mouseDown(match);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('Acme Supplies'));
  });

  it('offers to create a brand-new vendor from the macro-suggested name when nothing matches', async () => {
    mockDefaultImpl((spec) => {
      if (spec.domain === 'accounting' && spec.action === 'ai-suggest-vendor') {
        return { data: { ok: true, result: { matched: false, suggestedNewVendor: 'Riverside Print' } } };
      }
      if (spec.domain === 'accounting' && spec.action === 'vendors-create') {
        return { data: { ok: true, result: { vendor: { id: 'v_new', name: 'Riverside Print', defaultExpenseAccountId: '' } } } };
      }
      return undefined;
    });
    const input = await openNewBill();
    fireEvent.change(input, { target: { value: 'riverside printing invoice' } });
    await vi.advanceTimersByTimeAsync(400);

    const createBtn = await screen.findByText(/Create vendor "Riverside Print"/);
    await act(async () => { fireEvent.mouseDown(createBtn); });

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find(([s]) => s.action === 'vendors-create');
      expect(call).toBeTruthy();
      expect((call![0] as LensSpec).input?.name).toBe('Riverside Print');
    });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('Riverside Print'));
  });
});
