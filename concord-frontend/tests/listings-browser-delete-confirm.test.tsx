// FIX-housing-004 — deleting a Real Estate listing takes two clicks:
// the trash icon arms a per-row "Confirm delete"; only the second
// click calls realestate listings-delete.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { ListingsBrowser } from '@/components/realestate/ListingsBrowser';

const LISTING = {
  id: 'lst-1', address: '12 Main St', city: 'Poughkeepsie', state: 'NY', zip: '12601',
  price: 350000, beds: 3, baths: 2, sqft: 1500, yearBuilt: 1990,
  kind: 'single_family' as const, status: 'for_sale' as const, daysOnMarket: 4,
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (arg: { action: string }) => {
    if (arg.action === 'listings-list') return { data: { ok: true, result: { listings: [LISTING] } } };
    if (arg.action === 'favourites-list') return { data: { ok: true, result: { ids: [] } } };
    return { data: { ok: true, result: {} } };
  });
});
afterEach(() => cleanup());

describe('ListingsBrowser delete confirmation', () => {
  it('first trash click only arms the confirm; second click deletes', async () => {
    render(<ListingsBrowser />);
    const trash = await screen.findByRole('button', { name: 'Delete' });
    await act(async () => { fireEvent.click(trash); });
    expect(lensRunMock.mock.calls.some((c) => (c[0] as { action: string }).action === 'listings-delete')).toBe(false);
    const confirm = await screen.findByRole('button', { name: 'Confirm delete' });
    await act(async () => { fireEvent.click(confirm); });
    const del = lensRunMock.mock.calls.find((c) => (c[0] as { action: string }).action === 'listings-delete');
    expect((del?.[0] as { input: { id: string } }).input).toMatchObject({ id: 'lst-1' });
  });
});
