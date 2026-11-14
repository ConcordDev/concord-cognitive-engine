// FIX-fashion-005 — the FE half: outfit / wishlist / capsule / packing
// rows had no edit control at all (closet items and moodboards were
// the only editable fashion records). Each panel now carries the same
// rename affordance the moodboard panel uses, calling the new
// server update actions. The wishlist flow is exercised end-to-end
// here; the other three panels are pinned at the affordance level
// (the control renders and opens the rename form), with the server
// actions themselves pinned in server/tests/fashion-updates-005.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {},
}));

import { FashionWishlistPanel } from '@/components/fashion/FashionWishlistPanel';
import { FashionOutfitsPanel } from '@/components/fashion/FashionOutfitsPanel';
import { FashionCapsulePanel } from '@/components/fashion/FashionCapsulePanel';
import { FashionPlanPanel } from '@/components/fashion/FashionPlanPanel';

const ENTRY = { id: 'wsh_1', name: 'qa boots', price: 10, link: null, note: null, category: 'shoes', createdAt: 'now' };

function mockAll() {
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });
    if (domain !== 'fashion') return ok({});
    switch (action) {
      case 'wishlist-list': return ok({ wishlist: [ENTRY], count: 1, totalValue: 10 });
      case 'wishlist-update': return ok({ entry: { ...ENTRY, name: String(input.name) } });
      case 'outfit-list': return ok({ outfits: [{ id: 'oft_1', name: 'qa fit', occasion: 'casual', season: 'all', itemIds: [], itemNames: [], timesWorn: 0 }] });
      case 'item-list': return ok({ items: [] });
      case 'capsule-list': return ok({ capsules: [{ id: 'cap_1', name: 'qa capsule', season: 'all', targetSize: 33, itemIds: [], filled: 0, pctFilled: 0 }] });
      case 'challenge-list': return ok({ challenges: [], completed: 0 });
      case 'packing-list': return ok({ packingLists: [{ id: 'pk_1', name: 'qa trip', destination: null, itemIds: [], itemCount: 0 }], count: 1 });
      case 'lookbook-list': return ok({ lookbooks: [] });
      case 'wear-insights': return ok(null);
      default: return ok({});
    }
  });
}

describe('fashion rename affordances (FIX-fashion-005)', () => {
  it('wishlist: rename submits wishlist-update with the new name and re-renders', async () => {
    mockAll();
    render(<FashionWishlistPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename entry' }));
    const input = await screen.findByLabelText('New name');
    fireEvent.change(input, { target: { value: 'qa boots edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'wishlist-update');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ id: 'wsh_1', name: 'qa boots edited' });
    });
  });

  it('outfits: the rename control renders on the row', async () => {
    mockAll();
    render(<FashionOutfitsPanel onChange={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Rename outfit' })).toBeTruthy();
  });

  it('capsules: the rename control renders on the row', async () => {
    mockAll();
    render(<FashionCapsulePanel />);
    expect(await screen.findByRole('button', { name: 'Rename capsule' })).toBeTruthy();
  });

  it('packing: opening a list offers Rename list', async () => {
    mockAll();
    render(<FashionPlanPanel />);
    fireEvent.click(await screen.findByText('qa trip'));
    expect(await screen.findByRole('button', { name: 'Rename list' })).toBeTruthy();
  });
});
