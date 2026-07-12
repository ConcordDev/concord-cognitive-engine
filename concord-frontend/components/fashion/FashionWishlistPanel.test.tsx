/// <reference types="@testing-library/jest-dom/vitest" />
// Behavior test for FashionWishlistPanel — the real, persistent replacement
// for the old page's pure-useState "Wishlist" tab (see
// docs/lens-specs/fashion-capability-map.md checklist #14). Mocks the
// fashion.wishlist-* macro calls (lensRun) and pins: render of saved
// entries, the add flow, the remove flow, and the "bought it — move to
// closet" convert flow (which calls wishlist-convert-to-item, not a local
// client-side item creation).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { FashionWishlistPanel } from './FashionWishlistPanel';

interface WishlistEntry {
  id: string; name: string; price: number | null; link: string | null;
  note: string | null; category: string | null; createdAt: string;
}

function mockWishlistMacros(opts: {
  entries: WishlistEntry[];
  totalValue?: number;
  onAdd?: (input: Record<string, unknown>) => { ok: boolean; error?: string; entry?: WishlistEntry };
  onRemove?: (input: Record<string, unknown>) => { ok: boolean; error?: string; deleted?: string };
  onConvert?: (input: Record<string, unknown>) => { ok: boolean; error?: string; item?: Record<string, unknown>; removedWishlistId?: string };
}) {
  lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
    if (action === 'wishlist-list') {
      return { data: { ok: true, result: { wishlist: opts.entries, count: opts.entries.length, totalValue: opts.totalValue ?? 0 }, error: null } };
    }
    if (action === 'wishlist-add') {
      const r = opts.onAdd ? opts.onAdd(input) : { ok: true, entry: { id: 'wsh_new', name: String(input.name), price: null, link: null, note: null, category: null, createdAt: 'now' } };
      return { data: { ok: r.ok, result: r, error: r.error ?? null } };
    }
    if (action === 'wishlist-remove') {
      const r = opts.onRemove ? opts.onRemove(input) : { ok: true, deleted: String(input.id) };
      return { data: { ok: r.ok, result: r, error: r.error ?? null } };
    }
    if (action === 'wishlist-convert-to-item') {
      const r = opts.onConvert ? opts.onConvert(input) : { ok: true, item: { id: 'itm_new' }, removedWishlistId: String(input.id) };
      return { data: { ok: r.ok, result: r, error: r.error ?? null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
}

const SAMPLE: WishlistEntry = {
  id: 'wsh_1', name: 'Wool coat', price: 220, link: 'https://example.com/coat',
  note: 'For winter', category: 'outerwear', createdAt: '2026-01-01T00:00:00.000Z',
};

describe('FashionWishlistPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders saved wishlist entries with price, link, and note', async () => {
    mockWishlistMacros({ entries: [SAMPLE], totalValue: 220 });
    render(<FashionWishlistPanel />);

    await waitFor(() => expect(screen.getByText('Wool coat')).toBeInTheDocument());
    expect(screen.getByText('$220')).toBeInTheDocument();
    expect(screen.getByText('For winter')).toBeInTheDocument();
    expect(screen.getByText('~$220 total')).toBeInTheDocument();
  });

  it('shows an honest empty state with zero entries', async () => {
    mockWishlistMacros({ entries: [] });
    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());
  });

  it('adds a new entry via the structured form (not a JSON blob) and refreshes the list', async () => {
    let entries: WishlistEntry[] = [];
    mockWishlistMacros({
      entries: [],
      onAdd: (input) => {
        const entry: WishlistEntry = {
          id: 'wsh_2', name: String(input.name), price: input.price != null ? Number(input.price) : null,
          link: (input.link as string) || null, note: (input.note as string) || null,
          category: (input.category as string) || null, createdAt: 'now',
        };
        entries = [entry];
        return { ok: true, entry };
      },
    });
    // wishlist-list should reflect the post-add state on the next refresh call.
    lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
      if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
      if (action === 'wishlist-list') return { data: { ok: true, result: { wishlist: entries, count: entries.length, totalValue: 0 }, error: null } };
      if (action === 'wishlist-add') {
        const entry: WishlistEntry = {
          id: 'wsh_2', name: String(input.name), price: input.price != null ? Number(input.price) : null,
          link: (input.link as string) || null, note: null, category: null, createdAt: 'now',
        };
        entries = [entry];
        return { data: { ok: true, result: { entry }, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: 'Denim jacket' } });
    fireEvent.change(screen.getByPlaceholderText('Price ($)'), { target: { value: '85' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }));

    await waitFor(() => expect(screen.getByText('Denim jacket')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('fashion', 'wishlist-add', expect.objectContaining({ name: 'Denim jacket', price: 85 }));
  });

  it('rejects add with no name and never calls the macro', async () => {
    mockWishlistMacros({ entries: [] });
    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }));

    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalledWith('fashion', 'wishlist-add', expect.anything());
  });

  it('removes an entry and refreshes the list', async () => {
    let entries: WishlistEntry[] = [SAMPLE];
    lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
      if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
      if (action === 'wishlist-list') return { data: { ok: true, result: { wishlist: entries, count: entries.length, totalValue: entries.length ? 220 : 0 }, error: null } };
      if (action === 'wishlist-remove') {
        entries = entries.filter((e) => e.id !== input.id);
        return { data: { ok: true, result: { deleted: input.id }, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText('Wool coat')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Remove'));

    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('fashion', 'wishlist-remove', { id: 'wsh_1' });
  });

  it('converts a wishlist entry to a closet item via wishlist-convert-to-item and removes it from the list', async () => {
    let entries: WishlistEntry[] = [SAMPLE];
    const onConvert = vi.fn((input: Record<string, unknown>) => {
      entries = entries.filter((e) => e.id !== input.id);
      return { ok: true, item: { id: 'itm_9', name: 'Wool coat' }, removedWishlistId: String(input.id) };
    });
    lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
      if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
      if (action === 'wishlist-list') return { data: { ok: true, result: { wishlist: entries, count: entries.length, totalValue: entries.length ? 220 : 0 }, error: null } };
      if (action === 'wishlist-convert-to-item') {
        const r = onConvert(input);
        return { data: { ok: true, result: r, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText('Wool coat')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Bought it/i));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onConvert).toHaveBeenCalledWith(expect.objectContaining({ id: 'wsh_1' })));
    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());
  });

  it('surfaces an honest backend error instead of silently succeeding', async () => {
    mockWishlistMacros({
      entries: [],
      onAdd: () => ({ ok: false, error: 'item name required' }),
    });
    render(<FashionWishlistPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    fireEvent.change(screen.getByPlaceholderText('Item name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }));

    await waitFor(() => expect(screen.getByText('item name required')).toBeInTheDocument());
  });
});
