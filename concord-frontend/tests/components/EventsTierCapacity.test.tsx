// EventsTierCapacity.test.tsx
//
// FIX-events-006 + FIX-events-008 (the events Tickets view):
//  - 006: a tier with a blank Total Available (0) rendered SOLD OUT
//    with a "0 / 0" bar — 0 means NO CAP in the tier model, not an
//    instantly-exhausted tier.
//  - 008: the Remaining stat subtracted only paid sales; comps are
//    seats given away and consume capacity (50 available, 3 comps
//    read Remaining 50 instead of 47).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Me' } }) }));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => <span /> }));
vi.mock('@/components/common/EmptyState', () => ({
  ErrorState: ({ error }: { error?: string }) => <div role="alert">{String(error ?? 'error')}</div>,
}));

const tier = (id: string, data: Record<string, unknown>) => ({
  id, title: String(data.tierName || id),
  data: { eventName: 'Gala', price: 10, sold: 0, totalAvailable: 0, waitlist: 0, compTickets: 0, checkedIn: 0, perks: '', ...data },
  meta: { tags: [], status: 'planning', visibility: 'private' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1,
});
const TIERS = [
  tier('t-uncapped', { tierName: 'Open Tier', totalAvailable: 0, sold: 0 }),
  tier('t-gala', { tierName: 'Gala Tier', totalAvailable: 50, sold: 0, compTickets: 3 }),
  tier('t-full', { tierName: 'Full Tier', totalAvailable: 10, sold: 7, compTickets: 3 }),
];
const mutate = vi.fn(async () => ({}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: type === 'TicketTier' ? TIERS : [], total: type === 'TicketTier' ? TIERS.length : 0,
    isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: mutate, update: mutate, remove: mutate,
    createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
  }),
}));

import { EventsWorkbench } from '@/components/events/EventsWorkbench';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('events Tickets view capacity math (FIX-events-006 / 008)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: {}, error: null } });
  });
  afterEach(() => cleanup());

  it('blank Total Available is uncapped, not SOLD OUT 0/0; comps consume Remaining', async () => {
    render(React.createElement(EventsWorkbench, { mode: 'tickets', onOpenHost: vi.fn(), onSelectMode: vi.fn() }));
    await settle();
    const text = document.body.textContent || '';
    // 006: the uncapped tier shows its no-cap line and no SOLD OUT for it;
    // exactly ONE tier is sold out — the one filled by sales + comps (7+3=10).
    expect(screen.getByText(/No cap set · 0 sold/)).toBeTruthy();
    expect(text).not.toContain('0 / 0');
    expect(screen.getAllByText('SOLD OUT')).toHaveLength(1);
    // 008: totals — avail 60, sold 7, comps 6 → Remaining 47.
    const remainingLabel = screen.getByText('Remaining');
    expect(remainingLabel.parentElement?.textContent).toContain('47');
  });
});
