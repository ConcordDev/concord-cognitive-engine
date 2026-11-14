import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-fashion-002: wear-log entries and packing lists gain
// confirmed deletes (the FIX-fashion-003 cascade is pinned server-side
// in server/tests/slice-b7-fashion-drive.test.js).

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { FashionCalendarPanel } from '@/components/fashion/FashionCalendarPanel';
import { FashionPlanPanel } from '@/components/fashion/FashionPlanPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(domain: string, action: string) {
  return lensRun.mock.calls.filter((c) => c[0] === domain && c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('FashionCalendarPanel — wear log delete (FIX-fashion-002)', () => {
  it('a calendar entry deletes behind a two-step confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'outfit-list') return ok({ outfits: [] });
      if (action === 'item-list') return ok({ items: [] });
      if (action === 'calendar-view') return ok({ entries: [{ id: 'wl_1', date: '2026-11-12', label: 'qa-zt4 coat', kind: 'item' }] });
      if (action === 'calendar-delete') return ok({ deleted: 'wl_1' });
      return ok({});
    });
    render(<FashionCalendarPanel onChange={() => {}} />);
    expect(await screen.findByText('qa-zt4 coat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete wear log for qa-zt4 coat' }));
    expect(calls('fashion', 'calendar-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('fashion', 'calendar-delete')).toHaveLength(1));
    expect(calls('fashion', 'calendar-delete')[0][2]).toMatchObject({ id: 'wl_1' });
  });
});

describe('FashionPlanPanel — packing list delete (FIX-fashion-002)', () => {
  it('an opened packing list deletes behind a two-step confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'packing-list') return ok({ packingLists: [{ id: 'pk_1', name: 'qa-zt4-fashion trip', destination: null, itemCount: 2 }] });
      if (action === 'packing-detail') return ok({ packingList: { id: 'pk_1', name: 'qa-zt4-fashion trip', itemIds: [] }, items: [] });
      if (action === 'packing-delete') return ok({ deleted: 'pk_1' });
      if (action === 'wear-insights') return ok(null);
      return ok({});
    });
    render(<FashionPlanPanel />);
    fireEvent.click(await screen.findByText('qa-zt4-fashion trip'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete packing list qa-zt4-fashion trip' }));
    expect(calls('fashion', 'packing-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('fashion', 'packing-delete')).toHaveLength(1));
    expect(calls('fashion', 'packing-delete')[0][2]).toMatchObject({ id: 'pk_1' });
  });
});
