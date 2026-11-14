/**
 * FIX-marketplace-004 currency leg (founder ruling (5), 2026-11-13) —
 * shopfront prices display in CC, display only. Pins: the shared price
 * formatter denominates in CC (never a $ sign on CC amounts), the
 * shopfront chrome falls back to CC, and the seller/buyer price renders
 * carry CC. Stored fields (priceUsd etc.) and order math are untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatPrice } from '@/components/marketplace/types';

const read = (p: string) => readFileSync(`components/marketplace/${p}`, 'utf8');

describe('FIX-marketplace-004 CC display', () => {
  it('formatPrice denominates in CC and keeps the Free case', () => {
    expect(formatPrice(25)).toBe('25 CC');
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(25)).not.toContain('$');
  });

  it('shopfront chrome and price renders carry CC, not USD/$', () => {
    expect(read('ShopfrontShell.tsx')).toContain("currency || 'CC'");
    expect(read('ShopfrontShell.tsx')).not.toContain("|| 'USD'");
    const listings = read('ListingsPanel.tsx');
    expect(listings).toContain('{l.priceUsd.toFixed(2)} CC');
    expect(listings).not.toContain('placeholder="Price USD');
    const storefront = read('StorefrontPanel.tsx');
    expect(storefront).toContain('{l.priceUsd.toFixed(2)} CC');
    expect(storefront).not.toContain('${l.priceUsd.toFixed(2)}');
    expect(read('ShopDashboard.tsx')).toContain('CC AOV');
  });
});
