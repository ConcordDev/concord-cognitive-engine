/**
 * /lenses/retail — the redesigned Retail lens (one app: section rail +
 * Register as the default working surface).
 *
 * Pins:
 *  - the page is a thin mount of RetailApp inside LensShell — no shared
 *    lens chrome (NorthStarFrame / ShellPreview / RealtimeDataPanel) and no
 *    generic artifact-CRUD hooks;
 *  - the Register renders the real catalog from retail.product-list, adds a
 *    tapped product through retail.cart-open + retail.cart-add-line, and
 *    shows the server's cart-total (never a client-computed total);
 *  - the section rail is the one navigation state and swaps whole views;
 *  - the cash quick-amount helper offers exact change then the next bills up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

type Call = { action: string; input: Record<string, unknown> };
const calls: Call[] = [];

const PRODUCTS = [
  { sku: 'MUG-1', name: 'Stoneware Mug', price: 12, stock: 9, category: 'Kitchen' },
  { sku: 'TEA-1', name: 'Loose Leaf Tea', price: 8.5, stock: 2, category: 'Pantry' },
];

function respond(action: string, input: Record<string, unknown>) {
  switch (action) {
    case 'product-list': return { products: PRODUCTS, abcSummary: {} };
    case 'cart-list': return { carts: [] };
    case 'cart-open': return { cart: { id: 'cart_abc123', lines: [], discountPercent: 0, openedAt: new Date().toISOString() } };
    case 'cart-add-line': return { cart: { id: 'cart_abc123', lines: [{ sku: input.sku, name: 'Stoneware Mug', unitPrice: 12, qty: 1 }], discountPercent: 0 } };
    case 'cart-total': return { subtotal: 12, discount: 0, subtotalAfterDiscount: 12, tax: 0.96, taxRate: 8, taxRateSource: 'configured', total: 12.96, lineCount: 1, itemCount: 1 };
    case 'analytics-summary': return { salesBasis: 'Order totals', totalRevenue: 0, totalOrders: 0, ordersToday: 3, revenueToday: 41.5, revenue7d: 120, revenue30d: 300, avgOrderValue: 13.83, productCount: 2, customerCount: 0, activeCarts: 0 };
    case 'low-stock': return { lowStock: [PRODUCTS[1]], threshold: 5 };
    case 'orders-list': return { orders: [] };
    default: return {};
  }
}

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: {
    lens: {
      runDomain: vi.fn((_domain: string, action: string, body?: { input?: Record<string, unknown> }) => {
        const input = body?.input || {};
        calls.push({ action, input });
        return Promise.resolve({ data: { ok: true, result: respond(action, input) } });
      }),
    },
  },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null }) }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/payment/StripePaymentForm', () => ({ StripePaymentForm: () => null }));
// Section panels own their own data contracts and tests; stub them to markers.
const { stub } = vi.hoisted(() => ({
  stub: (id: string) => ({ default: () => require('react').createElement('div', { 'data-testid': id }) }),
}));
vi.mock('@/components/retail/ProductCatalogPanel', () => ({ ProductCatalogPanel: () => React.createElement('div', { 'data-testid': 'catalog-panel' }) }));
vi.mock('@/components/retail/CustomersPanel', () => stub('customers-panel'));
vi.mock('@/components/retail/SalesAnalytics', () => stub('sales-analytics'));
vi.mock('@/components/retail/DiscountsManager', () => stub('discounts-panel'));

import RetailLens from '@/app/lenses/retail/page';
import { quickCashAmounts } from '@/components/retail/app/TenderSheet';

beforeEach(() => {
  calls.length = 0;
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* jsdom */ }
});

describe('retail lens — redesigned app', () => {
  it('opens on the Register with the real catalog and today figures', async () => {
    render(<RetailLens />);
    expect(screen.getByTestId('lens-shell')).toBeInTheDocument();
    expect(await screen.findByText('Stoneware Mug')).toBeInTheDocument();
    expect(screen.getByText('Loose Leaf Tea')).toBeInTheDocument();
    expect(await screen.findByText('$41.50')).toBeInTheDocument(); // revenueToday from analytics-summary
    expect(calls.some((c) => c.action === 'product-list')).toBe(true);
  });

  it('tapping a product opens a cart, adds the line, and shows the server total', async () => {
    render(<RetailLens />);
    fireEvent.click(await screen.findByTitle(/Stoneware Mug/));
    await waitFor(() => expect(calls.some((c) => c.action === 'cart-add-line' && c.input.sku === 'MUG-1' && c.input.cartId === 'cart_abc123')).toBe(true));
    expect(calls.findIndex((c) => c.action === 'cart-open')).toBeLessThan(calls.findIndex((c) => c.action === 'cart-add-line'));
    expect((await screen.findAllByText('$12.96')).length).toBeGreaterThan(0); // cart-total.total on the Charge button(s)
  });

  it('rapid taps on an empty register share one cart (no second cart-open race)', async () => {
    render(<RetailLens />);
    fireEvent.click(await screen.findByTitle(/Stoneware Mug/));
    fireEvent.click(screen.getByTitle(/Loose Leaf Tea/));
    await waitFor(() => expect(calls.filter((c) => c.action === 'cart-add-line').length).toBe(2));
    expect(calls.filter((c) => c.action === 'cart-open').length).toBe(1);
  });

  it('scan-to-add: Enter on an exact SKU adds that product', async () => {
    render(<RetailLens />);
    await screen.findByText('Loose Leaf Tea');
    const search = screen.getByPlaceholderText(/scan SKU/i);
    fireEvent.change(search, { target: { value: 'tea-1' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(calls.some((c) => c.action === 'cart-add-line' && c.input.sku === 'TEA-1')).toBe(true));
  });

  it('the section rail swaps the whole view', async () => {
    render(<RetailLens />);
    await screen.findByText('Stoneware Mug');
    fireEvent.click(screen.getByRole('button', { name: /Customers/ }));
    expect(screen.getByTestId('customers-panel')).toBeInTheDocument();
    expect(screen.queryByText('Stoneware Mug')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Marketing/ }));
    expect(screen.getByTestId('discounts-panel')).toBeInTheDocument();
  });

  it('the page is a thin mount: no shared lens chrome, no artifact-CRUD hooks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../app/lenses/retail/page.tsx'), 'utf8');
    expect(source).toMatch(/RetailApp/);
    expect(source).not.toMatch(/NorthStarFrame|ShellPreview|RealtimeDataPanel/);
    expect(source).not.toMatch(/useLensData|useRunArtifact/);
  });
});

describe('quickCashAmounts', () => {
  it('offers exact, then the next whole dollar and bills up', () => {
    expect(quickCashAmounts(12.34)).toEqual([12.34, 13, 15, 20, 50]);
  });
  it('a whole-dollar due does not repeat itself', () => {
    expect(quickCashAmounts(20)).toEqual([20, 50, 100]);
  });
  it('nothing due, nothing offered', () => {
    expect(quickCashAmounts(0)).toEqual([]);
  });
});
