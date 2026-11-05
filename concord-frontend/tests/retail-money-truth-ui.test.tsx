// StorefrontShell nav (F9): every nav item renders its own real view — the
// shell's main area used to render the Home panel whatever was selected.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorefrontShell } from '@/components/retail/StorefrontShell';

const base = {
  storeName: 'Test Store',
  revenueToday: 12.5,
  ordersToday: 2,
  revenue7dSeries: [1, 2, 3],
  recentOrders: [
    { id: 'o1', number: 'ORD-00001', total: 12.5, status: 'refunded' as const, itemCount: 2, timestamp: new Date().toISOString() },
  ],
  products: [{ sku: 'SKU-1', name: 'Widget', price: 3, stock: 7 }],
  customers: [{ id: 'c1', name: 'Pat', email: 'pat@example.com', orderCount: 2, totalSpent: 40 }],
  discounts: [{ id: 'd1', code: 'SAVE10', kind: 'percentage', value: 10, usageCount: 3, active: true }],
  shippingZones: [{ id: 'z1', name: 'Domestic', countries: ['US'], rate: 5 }],
  storefront: { name: 'Test Store', slug: 'test-store', published: false },
};

describe('StorefrontShell nav views', () => {
  it('home shows the metrics and the recent orders', () => {
    render(<StorefrontShell {...base} activeNav="home" />);
    expect(screen.getByText('Total sales')).toBeTruthy();
    expect(screen.getByText('Recent orders')).toBeTruthy();
    expect(screen.getByText('ORD-00001')).toBeTruthy();
    expect(screen.getByText('refunded')).toBeTruthy();
  });

  it('products view lists the catalog, not the home panel', () => {
    render(<StorefrontShell {...base} activeNav="products" />);
    expect(screen.getByText('Widget')).toBeTruthy();
    expect(screen.getByText(/7 in stock/)).toBeTruthy();
    expect(screen.queryByText('Recent orders')).toBeNull();
  });

  it('customers view lists customers', () => {
    render(<StorefrontShell {...base} activeNav="customers" />);
    expect(screen.getByText('pat@example.com')).toBeTruthy();
    expect(screen.queryByText('Recent orders')).toBeNull();
  });

  it('discounts view shows redemption counts', () => {
    render(<StorefrontShell {...base} activeNav="discounts" />);
    expect(screen.getByText('SAVE10')).toBeTruthy();
    expect(screen.getByText(/3 redeemed/)).toBeTruthy();
  });

  it('shipping view lists zones', () => {
    render(<StorefrontShell {...base} activeNav="shipping" />);
    expect(screen.getByText('Domestic')).toBeTruthy();
  });

  it('settings view shows the publish state and where publishing lives', () => {
    render(<StorefrontShell {...base} activeNav="settings" />);
    expect(screen.getByText('Storefront settings')).toBeTruthy();
    expect(screen.getByText('Not published')).toBeTruthy();
    expect(screen.getByText(/\/shop\/test-store/)).toBeTruthy();
  });

  it('orders view keeps the orders table', () => {
    render(<StorefrontShell {...base} activeNav="orders" />);
    expect(screen.getByText('ORD-00001')).toBeTruthy();
  });
});
