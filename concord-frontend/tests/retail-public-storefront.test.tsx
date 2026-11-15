/**
 * Public storefront page (FIX-retail-013).
 *
 * storefront-publish returns publicUrl /shop/<slug> and the manager
 * UI prints "Published at /shop/<slug>", but no /shop route existed
 * and the only catalog read (storefront-catalog) was owner-scoped —
 * the shared URL 404'd for everyone. These pins drive the REAL
 * PublicStorefront component against the REAL retail lens actions:
 * the merchant seeds and publishes through the real macros, then the
 * page reads as a different, signed-in visitor and as the public by
 * slug. Unselected products (FIX-retail-002) never render.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

// The real server lens actions, captured through their registrar.
import registerRetailActions from '../../server/domains/retail.js';

const serverActions: Record<string, (ctx: unknown, artifact: unknown, params: never) => unknown> = {};
registerRetailActions((domain: string, name: string, fn: never) => {
  serverActions[`${domain}.${name}`] = fn as never;
});

type Ctx = { userId: string; actor: { userId: string } };
const MERCHANT: Ctx = { userId: 'merchant-1', actor: { userId: 'merchant-1' } };
const VISITOR: Ctx = { userId: 'visitor-9', actor: { userId: 'visitor-9' } };

function serverCall(name: string, ctx: Ctx, input: Record<string, unknown>) {
  const fn = serverActions[`retail.${name}`];
  if (!fn) return { ok: false, result: null, error: `no action retail.${name}` };
  const out = fn(ctx, { data: input }, input as never) as { ok: boolean; result?: unknown; error?: string };
  return { ok: out.ok, result: out.result ?? null, error: out.error ?? null };
}

// The page's transport: lensRun dispatches into the real actions with
// the VISITOR's identity — the page is public, the read is by slug.
const lensRun = vi.fn(async (domain: string, action: string, input: Record<string, unknown>) => {
  return { data: serverCall(action, VISITOR, input) };
});
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
}));

import { PublicStorefront } from '@/components/retail/PublicStorefront';

async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => {
  lensRun.mockClear();
  (globalThis as Record<string, unknown>)._concordSTATE = { dtus: new Map() };
  (globalThis as Record<string, unknown>)._concordSaveStateDebounced = () => {};
  // Merchant seeds a two-product catalog and publishes ONE of them.
  serverCall('product-upsert', MERCHANT, { sku: 'SEL', name: 'Selected Widget', price: 12.5, stock: 4 });
  serverCall('product-upsert', MERCHANT, { sku: 'UNSEL', name: 'Hidden Widget', price: 99, stock: 9 });
  serverCall('storefront-configure', MERCHANT, { name: 'Slug Shop', tagline: 'Open for business' });
});
afterEach(() => { cleanup(); });

describe('public storefront page (FIX-retail-013)', () => {
  it('renders the published store by slug for a visitor — selected products only', async () => {
    serverCall('storefront-publish', MERCHANT, { published: true, publishedSkus: ['SEL'] });
    render(<PublicStorefront slug="slug-shop" />);
    await until(() => screen.queryByText('Slug Shop') != null);
    expect(screen.getByText('Open for business')).toBeInTheDocument();
    expect(screen.getByText('Selected Widget')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText(/4 in stock/)).toBeInTheDocument();
    // FIX-retail-002: the unselected product is not public anywhere.
    expect(screen.queryByText('Hidden Widget')).toBeNull();
  });

  it('an unknown slug gets an honest not-found state, not a blank page', async () => {
    render(<PublicStorefront slug="no-such-store" />);
    await until(() => screen.queryByText('Store not found') != null);
    expect(screen.getByText(/no storefront at/i)).toBeInTheDocument();
  });

  it('an unpublished store says so plainly and shows no products', async () => {
    render(<PublicStorefront slug="slug-shop" />);
    await until(() => screen.queryByText('This store is not published') != null);
    expect(screen.queryByText('Selected Widget')).toBeNull();
  });
});
