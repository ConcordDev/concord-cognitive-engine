import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-retail-007: Customers gain search, a detail view,
// and an edit form wired to customers-update.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { CustomersPanel } from '@/components/retail/CustomersPanel';

const CUST = {
  id: 'cust_1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-1', city: 'Troy', state: 'NY',
  totalSpent: 250, orderCount: 3, lastOrderAt: '2026-11-01T00:00:00Z', acceptsMarketing: true, tags: ['early'],
};
function actionOf(call: unknown[]) {
  const a = call[0] as { action?: string } | string;
  return typeof a === 'object' ? a.action : call[1];
}
function inputOf(call: unknown[]) {
  const a = call[0] as { input?: unknown };
  return (typeof a === 'object' && a.input) || call[2] || {};
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => actionOf(c as unknown[]) === action);
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((...args: unknown[]) => {
    const action = actionOf(args);
    if (action === 'customers-list') return Promise.resolve({ data: { ok: true, result: { customers: [CUST] } } });
    if (action === 'customers-segments') return Promise.resolve({ data: { ok: true, result: { segments: { new: 0, repeat: 1, vip: 0, atRisk: 0, dormant: 0, marketingOptIn: 1 } } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('FIX-retail-007 customers', () => {
  it('search filters the list and names a no-match', async () => {
    render(<CustomersPanel />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No customers match "zzz".')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'ada@' } });
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });

  it('detail view opens and edit saves through customers-update', async () => {
    render(<CustomersPanel />);
    fireEvent.click(await screen.findByLabelText('View customer Ada Lovelace'));
    expect(await screen.findByText(/Lifetime: \$250\.00 across 3 orders/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Edit customer Ada Lovelace'));
    fireEvent.change(await screen.findByLabelText('Edit customer city'), { target: { value: 'Albany' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(calls('customers-update')).toHaveLength(1));
    expect(inputOf(calls('customers-update')[0] as unknown[])).toMatchObject({ id: 'cust_1', city: 'Albany', name: 'Ada Lovelace' });
  });
});
