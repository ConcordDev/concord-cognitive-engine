/**
 * /lenses/billing — four-UX-state contract for the SubscriptionBillingSuite, the
 * billing lens's single lensRun('billing', …) surface
 * (concord-frontend/components/billing/SubscriptionBillingSuite.tsx → POST
 * /api/lens/run that server/domains/billing.js answers).
 *
 * Pins that the Plans & Subscriptions tab (the default surface) renders genuine
 * loading (role=status) / error (role=alert with a WORKING Retry that re-fetches)
 * / empty (CTA) / populated states against the real macro shape — plan-list +
 * subscription-list. No fabricated data: every state is driven by a mocked lensRun
 * standing in for the backend, returning exactly the { plans } / { subscriptions,
 * mrr, arr, … } shape the macros emit. The error path is the load failure the page
 * could otherwise swallow into a silent-empty render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the suite's single backend channel ───────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
// ChartKit (used by the Analytics tab) — inert stub so nothing else fetches.
vi.mock('@/components/viz', () => ({ ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }) }));

// Import AFTER mocks are registered.
import { SubscriptionBillingSuite } from '@/components/billing/SubscriptionBillingSuite';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

// Default-tab loader fires plan-list + subscription-list in parallel.
function bothEmpty() {
  return (_d: string, action: string) => {
    if (action === 'plan-list') return reply({ plans: [] });
    if (action === 'subscription-list') return reply({ subscriptions: [], mrr: 0, arr: 0, activeCount: 0, trialingCount: 0 });
    return reply({});
  };
}

beforeEach(() => { lensRun.mockReset(); });

describe('billing lens — SubscriptionBillingSuite four UX states', () => {
  it('LOADING: shows a role=status indicator while the initial load is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { getByText, container } = render(<SubscriptionBillingSuite />);
    await waitFor(() => expect(getByText(/Loading plans/i)).toBeInTheDocument());
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('EMPTY: shows the "No recurring plans yet" CTA when the catalog is empty', async () => {
    lensRun.mockImplementation(bothEmpty());
    const { getByText } = render(<SubscriptionBillingSuite />);
    await waitFor(() => expect(getByText(/No recurring plans yet/i)).toBeInTheDocument());
    // CTA points the user at the create action
    expect(getByText(/Create your first plan/i)).toBeInTheDocument();
  });

  it('ERROR: a failed load shows role=alert + a working Retry that re-fetches and recovers', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (fail) return Promise.resolve({ data: { ok: false, error: 'billing backend unreachable' } });
      if (action === 'plan-list') return reply({ plans: [{ id: 'plan_1', name: 'Pro', interval: 'monthly', amount: 30, currency: 'USD', trialDays: 0 }] });
      if (action === 'subscription-list') return reply({ subscriptions: [], mrr: 0, arr: 0, activeCount: 0, trialingCount: 0 });
      return reply({});
    });
    const { getByText, container } = render(<SubscriptionBillingSuite />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/billing backend unreachable/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated — the real plan row + price from the macro
    await waitFor(() => expect(getByText(/USD 30\.00 \/ monthly/)).toBeInTheDocument());
  });

  it('POPULATED: renders the real plan row + the MRR/ARR rollups from the macro', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'plan-list') return reply({ plans: [{ id: 'plan_1', name: 'Pro', interval: 'monthly', amount: 30, currency: 'USD', trialDays: 0 }] });
      if (action === 'subscription-list') {
        return reply({
          subscriptions: [{ id: 'sub_1', planId: 'plan_1', customerName: 'Acme Inc', quantity: 2, status: 'active', plan: { name: 'Pro' } }],
          mrr: 60, arr: 720, activeCount: 1, trialingCount: 0,
        });
      }
      return reply({});
    });
    const { getByText, getAllByText, queryByText } = render(<SubscriptionBillingSuite />);
    // real plan price + interval (unique to the plan row)
    await waitFor(() => expect(getByText(/USD 30\.00 \/ monthly/)).toBeInTheDocument());
    // real subscription (appears in the list + proration dropdown) + macro-computed MRR/ARR
    expect(getAllByText('Acme Inc').length).toBeGreaterThan(0);
    expect(getByText('USD 60.00')).toBeInTheDocument();   // MRR
    expect(getByText('USD 720.00')).toBeInTheDocument();  // ARR
    // no empty CTA when populated
    expect(queryByText(/No recurring plans yet/i)).toBeNull();
  });

  it('a11y: the tab controls are real buttons with accessible text', async () => {
    lensRun.mockImplementation(bothEmpty());
    const { getByRole } = render(<SubscriptionBillingSuite />);
    await waitFor(() => expect(getByRole('button', { name: /Plans & Subscriptions/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Metered Usage/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Revenue Analytics/i })).toBeInTheDocument();
  });
});
