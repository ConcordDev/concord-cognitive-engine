/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the retail richer-product-schema panel (Wave 4 larger-unit build,
// docs/lens-specs/retail-capability-map.md "Genuinely missing, deferred"
// item 4, the final one): supplier/lead-time/daily-sales-rate fields on
// product-upsert, server-computed price history + turnover rate + ABC
// class rendered read-only, and real product-variant-* sub-SKU CRUD.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ProductCatalogPanel } from '@/components/retail/ProductCatalogPanel';

const PRODUCT = {
  sku: 'WIDGET', name: 'Widget', price: 10, stock: 50, category: 'tools', barcode: '',
  supplier: 'Acme Supply Co', leadTimeDays: 14, dailySalesRate: 2, turnoverRate: 14.6,
  priceHistory: [{ oldPrice: null, newPrice: 10, changedAt: '2026-07-01T00:00:00.000Z' }],
  abcClass: 'A' as const,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
};

function listResponse(products: Array<Record<string, unknown>> = []) {
  const summary = { A: 0, B: 0, C: 0, unclassified: 0 };
  for (const p of products) {
    const cls = p.abcClass as 'A' | 'B' | 'C' | null;
    if (cls === 'A') summary.A++;
    else if (cls === 'B') summary.B++;
    else if (cls === 'C') summary.C++;
    else summary.unclassified++;
  }
  return { data: { ok: true, result: { products, abcSummary: summary } } };
}

describe('ProductCatalogPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via product-list and renders supplier/lead-time/turnover/ABC-class', async () => {
    lensRun.mockResolvedValueOnce(listResponse([PRODUCT]));
    render(<ProductCatalogPanel />);

    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'product-list', input: {} });
    expect(screen.getByText(/Acme Supply Co/)).toBeInTheDocument();
    expect(screen.getByText(/14d lead/)).toBeInTheDocument();
    expect(screen.getByText(/turnover 14.6×\/yr/)).toBeInTheDocument();
    // ABC badge on the card itself.
    const card = screen.getByText('Widget').closest('div')!;
    expect(within(card).getByText('A')).toBeInTheDocument();
  });

  it('renders the server-computed abcSummary header, never a client-invented count', async () => {
    const b = { ...PRODUCT, sku: 'B1', name: 'Bee', abcClass: 'B' as const };
    const c = { ...PRODUCT, sku: 'C1', name: 'Cee', abcClass: 'C' as const };
    lensRun.mockResolvedValueOnce(listResponse([PRODUCT, b, c]));
    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');

    const summary = screen.getByTestId('abc-summary');
    expect(summary).toHaveTextContent('A 1');
    expect(summary).toHaveTextContent('B 1');
    expect(summary).toHaveTextContent('C 1');
  });

  it('an empty catalog renders an honest empty state, not fabricated products', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<ProductCatalogPanel />);
    expect(await screen.findByText(/No products yet/)).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed load', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, error: 'STATE unavailable', result: null } });
    render(<ProductCatalogPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });

  it('create sends the new supplier/leadTimeDays/dailySalesRate fields to product-upsert', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { product: { ...PRODUCT, sku: 'NEW1', name: 'New thing' } } } })
      .mockResolvedValueOnce(listResponse([{ ...PRODUCT, sku: 'NEW1', name: 'New thing' }]));

    render(<ProductCatalogPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Add product'));
    fireEvent.change(screen.getByPlaceholderText('SKU'), { target: { value: 'NEW1' } });
    fireEvent.change(screen.getByPlaceholderText('Product name'), { target: { value: 'New thing' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '25' } });
    fireEvent.change(screen.getByPlaceholderText('Stock'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('Supplier'), { target: { value: 'Beta Corp' } });
    fireEvent.change(screen.getByPlaceholderText('Lead time (days)'), { target: { value: '7' } });
    fireEvent.change(screen.getByPlaceholderText('Daily sales rate'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'product-upsert',
        input: expect.objectContaining({
          sku: 'NEW1', name: 'New thing', price: 25, stock: 10,
          supplier: 'Beta Corp', leadTimeDays: 7, dailySalesRate: 3,
        }),
      }),
    );
    expect(await screen.findByText('New thing')).toBeInTheDocument();
  });

  it('a failed save surfaces an honest inline error and does not close the form', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: false, error: 'sku collides with an existing product SKU' } });

    render(<ProductCatalogPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Add product'));
    fireEvent.change(screen.getByPlaceholderText('SKU'), { target: { value: 'DUP' } });
    fireEvent.change(screen.getByPlaceholderText('Product name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('sku collides with an existing product SKU');
  });

  it('expanding a product loads and renders its price history and variants', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([PRODUCT]))
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: {
            variants: [
              { sku: 'WIDGET-RED-M', parentSku: 'WIDGET', size: 'M', color: 'Red', style: '', stock: 5, priceDelta: 2, price: 12, createdAt: '', updatedAt: '' },
            ],
          },
        },
      });

    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');
    fireEvent.click(screen.getByText('Widget'));

    expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'product-variant-list', input: { parentSku: 'WIDGET' } });
    expect(await screen.findByText(/\$10\.00 \(initial\)/)).toBeInTheDocument();
    expect(await screen.findByText(/WIDGET-RED-M/)).toBeInTheDocument();
    expect(screen.getByText(/M \/ Red/)).toBeInTheDocument();
  });

  it('adding a variant calls product-variant-upsert with the parent sku and refreshes the variant list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([PRODUCT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { variants: [] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { variant: { sku: 'WIDGET-L', parentSku: 'WIDGET', size: 'L', color: '', style: '', stock: 3, priceDelta: 0, price: 10 } } } })
      .mockResolvedValueOnce({
        data: { ok: true, result: { variants: [{ sku: 'WIDGET-L', parentSku: 'WIDGET', size: 'L', color: '', style: '', stock: 3, priceDelta: 0, price: 10, createdAt: '', updatedAt: '' }] } },
      });

    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');
    fireEvent.click(screen.getByText('Widget'));
    await waitFor(() => expect(screen.getByText(/No variants/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Variant SKU'), { target: { value: 'WIDGET-L' } });
    fireEvent.change(screen.getByPlaceholderText('Size'), { target: { value: 'L' } });
    fireEvent.click(screen.getByText('Add variant'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'product-variant-upsert',
        input: expect.objectContaining({ sku: 'WIDGET-L', parentSku: 'WIDGET', size: 'L' }),
      }),
    );
    expect(await screen.findByText(/WIDGET-L/)).toBeInTheDocument();
  });

  it('removing a variant calls product-variant-delete', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([PRODUCT]))
      .mockResolvedValueOnce({
        data: { ok: true, result: { variants: [{ sku: 'WIDGET-M', parentSku: 'WIDGET', size: 'M', color: '', style: '', stock: 5, priceDelta: 0, price: 10, createdAt: '', updatedAt: '' }] } },
      })
      .mockResolvedValueOnce({ data: { ok: true, result: { sku: 'WIDGET-M', deleted: true } } })
      .mockResolvedValueOnce({ data: { ok: true, result: { variants: [] } } });

    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');
    fireEvent.click(screen.getByText('Widget'));
    await screen.findByText(/WIDGET-M/);

    fireEvent.click(screen.getByLabelText('Remove variant WIDGET-M'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'product-variant-delete', input: { sku: 'WIDGET-M' } }),
    );
  });

  it('editing a product prefills the form with its current values and calls product-upsert on save', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([PRODUCT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { product: { ...PRODUCT, price: 15 } } } })
      .mockResolvedValueOnce(listResponse([{ ...PRODUCT, price: 15 }]));

    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');

    fireEvent.click(screen.getByLabelText('Edit Widget'));
    expect(screen.getByPlaceholderText('SKU')).toHaveValue('WIDGET');
    expect(screen.getByPlaceholderText('Supplier')).toHaveValue('Acme Supply Co');

    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({
        domain: 'retail',
        action: 'product-upsert',
        input: expect.objectContaining({ sku: 'WIDGET', price: 15 }),
      }),
    );
  });

  it('deleting a product calls product-delete and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([PRODUCT]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deleted: 'WIDGET' } } })
      .mockResolvedValueOnce(listResponse([]));

    render(<ProductCatalogPanel />);
    await screen.findByText('Widget');
    fireEvent.click(screen.getByLabelText('Delete Widget'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith({ domain: 'retail', action: 'product-delete', input: { sku: 'WIDGET' } }),
    );
    await waitFor(() => expect(screen.getByText(/No products yet/)).toBeInTheDocument());
  });
});
