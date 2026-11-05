import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// F4 — Price Book Delete was instant: one click removed the row with no
// confirmation at any point, and the deletion persisted. Driven on the
// Price Book (the priced exhibit); the other six persisted delete sites
// in the suite ride the same ConfirmDelete contract (the certification
// site is pinned in ContractorSuiteInspectionsCerts.test.tsx).

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { ContractorSuite } from '@/components/masonry/ContractorSuite';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

const ITEM = { id: 'pb_1', sku: 'BRK-STD', name: 'TEST BRICK', unit: 'each', category: 'brick', unitCost: 0.75 };

function deleteCalls() {
  return lensRun.mock.calls.filter((c) => c[1] === 'pricebook-delete');
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'pricebook-list') return ok({ items: [ITEM] });
    if (action === 'pricebook-delete') return ok({ deleted: ITEM.id });
    return ok({});
  });
});

function renderSuite() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractorSuite />
    </QueryClientProvider>,
  );
}

describe('masonry price book delete confirmation (F4)', () => {
  it('the first click only arms a confirmation naming the item — nothing is deleted', async () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: /Price Book/ }));
    await screen.findByText('TEST BRICK');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete price item "TEST BRICK"?')).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('cancel disarms the confirmation and still nothing is deleted', async () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: /Price Book/ }));
    await screen.findByText('TEST BRICK');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete price item "TEST BRICK"?')).not.toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it('confirm runs the delete exactly once, with the item id', async () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: /Price Book/ }));
    await screen.findByText('TEST BRICK');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // The armed state's own Delete button (the row's idle button is gone).
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][2]).toEqual({ id: 'pb_1' });
  });
});
