/// <reference types="@testing-library/jest-dom/vitest" />
// Behavior test for FashionClosetPanel's laundry/availability status
// feature (capability-map #20 — clean/dirty/at_cleaner/lent_out). Mocks
// the fashion.item-* macro calls (lensRun) and pins: the status badge
// renders per item, changing it calls item-update with the real
// laundryStatus param (not a client-only toggle), and the "what can I
// wear" status filter re-queries item-list with laundryStatus.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { FashionClosetPanel } from './FashionClosetPanel';

interface Item {
  id: string; name: string; category: string; brand: string | null; color: string | null;
  season: string; cost: number; timesWorn: number; costPerWear: number | null; valueRating: string;
  photo: string | null; laundryStatus: 'clean' | 'dirty' | 'at_cleaner' | 'lent_out';
}

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'itm_1', name: 'White tee', category: 'top', brand: null, color: null,
    season: 'all', cost: 30, timesWorn: 0, costPerWear: null, valueRating: 'unworn',
    photo: null, laundryStatus: 'clean', ...over,
  };
}

function mockClosetMacros(opts: {
  items: Item[];
  onUpdate?: (input: Record<string, unknown>) => { ok: boolean; error?: string; item?: Item };
  onList?: (input: Record<string, unknown>) => Item[];
}) {
  lensRun.mockImplementation(async (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'fashion') return { data: { ok: true, result: {}, error: null } };
    if (action === 'item-list') {
      const items = opts.onList ? opts.onList(input) : opts.items;
      return { data: { ok: true, result: { items, count: items.length }, error: null } };
    }
    if (action === 'item-update') {
      const r = opts.onUpdate
        ? opts.onUpdate(input)
        : { ok: true, item: { ...opts.items.find((i) => i.id === input.id)!, laundryStatus: input.laundryStatus as Item['laundryStatus'] } };
      return { data: { ok: r.ok, result: r, error: r.error ?? null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
}

describe('FashionClosetPanel — laundry status', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders a laundry status selector for each item, defaulting to Clean', async () => {
    mockClosetMacros({ items: [makeItem()] });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('White tee')).toBeInTheDocument());
    const select = screen.getByLabelText('Laundry status for White tee') as HTMLSelectElement;
    expect(select.value).toBe('clean');
    // All four documented statuses are selectable.
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['clean', 'dirty', 'at_cleaner', 'lent_out']);
  });

  it('renders a non-default status from the backend', async () => {
    mockClosetMacros({ items: [makeItem({ laundryStatus: 'dirty' })] });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('White tee')).toBeInTheDocument());
    const select = screen.getByLabelText('Laundry status for White tee') as HTMLSelectElement;
    expect(select.value).toBe('dirty');
  });

  it('changing the selector calls fashion.item-update with the real laundryStatus param', async () => {
    let currentStatus: Item['laundryStatus'] = 'clean';
    mockClosetMacros({
      items: [makeItem()],
      onList: () => [makeItem({ laundryStatus: currentStatus })],
      onUpdate: (input) => {
        currentStatus = input.laundryStatus as Item['laundryStatus'];
        return { ok: true, item: makeItem({ laundryStatus: currentStatus }) };
      },
    });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('White tee')).toBeInTheDocument());
    const select = screen.getByLabelText('Laundry status for White tee') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'dirty' } });

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fashion', 'item-update', { id: 'itm_1', laundryStatus: 'dirty' }));
    await waitFor(() => expect((screen.getByLabelText('Laundry status for White tee') as HTMLSelectElement).value).toBe('dirty'));
  });

  it('surfaces an honest backend error if the status update is rejected', async () => {
    mockClosetMacros({
      items: [makeItem()],
      onUpdate: () => ({ ok: false, error: 'invalid laundryStatus (must be one of clean, dirty, at_cleaner, lent_out)' }),
    });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('White tee')).toBeInTheDocument());
    const select = screen.getByLabelText('Laundry status for White tee') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'dirty' } });

    await waitFor(() => expect(screen.getByText(/invalid laundryStatus/)).toBeInTheDocument());
  });

  it('the "what can I wear" filter re-queries item-list with laundryStatus and narrows the grid', async () => {
    const clean = makeItem({ id: 'itm_clean', name: 'Clean shirt', laundryStatus: 'clean' });
    const dirty = makeItem({ id: 'itm_dirty', name: 'Dirty jeans', category: 'bottom', laundryStatus: 'dirty' });
    mockClosetMacros({
      items: [clean, dirty],
      onList: (input) => {
        if (input.laundryStatus) return [clean, dirty].filter((i) => i.laundryStatus === input.laundryStatus);
        return [clean, dirty];
      },
    });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('Clean shirt')).toBeInTheDocument());
    expect(screen.getByText('Dirty jeans')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clean' }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fashion', 'item-list', expect.objectContaining({ laundryStatus: 'clean' })));
    await waitFor(() => expect(screen.queryByText('Dirty jeans')).not.toBeInTheDocument());
    expect(screen.getByText('Clean shirt')).toBeInTheDocument();
  });

  it('"Any status" clears the laundry filter', async () => {
    const clean = makeItem({ id: 'itm_clean', name: 'Clean shirt', laundryStatus: 'clean' });
    const dirty = makeItem({ id: 'itm_dirty', name: 'Dirty jeans', category: 'bottom', laundryStatus: 'dirty' });
    mockClosetMacros({
      items: [clean, dirty],
      onList: (input) => {
        if (input.laundryStatus) return [clean, dirty].filter((i) => i.laundryStatus === input.laundryStatus);
        return [clean, dirty];
      },
    });
    render(<FashionClosetPanel onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('Clean shirt')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dirty' }));
    await waitFor(() => expect(screen.queryByText('Clean shirt')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Any status' }));
    await waitFor(() => expect(screen.getByText('Clean shirt')).toBeInTheDocument());
    expect(screen.getByText('Dirty jeans')).toBeInTheDocument();
  });
});
