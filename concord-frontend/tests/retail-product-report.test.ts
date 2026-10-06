import { describe, it, expect } from 'vitest';
import {
  productSentence,
  productBody,
  productDtuCall,
  productThreadDraftCall,
  productThreadDraftOutcome,
  indexProductDrafts,
  type RetailProductFacts,
} from '@/components/retail/retailProductReport';

const facts: RetailProductFacts = {
  product: {
    sku: 'WIDGET-001',
    name: 'Widget Pro',
    price: 29.99,
    stock: 150,
    category: 'Electronics',
    barcode: '0123456789012',
    supplier: 'Acme Corp',
    leadTimeDays: 14,
    dailySalesRate: 2.5,
    turnoverRate: 6.08,
    abcClass: 'A',
    priceHistory: [
      { oldPrice: null, newPrice: 24.99, changedAt: '2026-09-01T00:00:00Z' },
      { oldPrice: 24.99, newPrice: 29.99, changedAt: '2026-10-01T00:00:00Z' },
    ],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
};

describe('retail product report', () => {
  it('states only the figures the backend reported', () => {
    const s = productSentence(facts)!;
    expect(s).toContain('Widget Pro');
    expect(s).toContain('WIDGET-001');
    expect(s).toContain('$29.99');
    expect(s).toContain('150 in stock');
    expect(s).toContain('Electronics');
    expect(s).toContain('ABC A');
    expect(s).toContain('turnover 6.08×/yr');
    expect(s).toContain('Acme Corp');
    expect(s).toContain('14d lead');
  });

  it('refuses to summarise a product with no sku, name, or negative price', () => {
    expect(productSentence({ product: null })).toBeNull();
    expect(productSentence({ product: { sku: '', name: 'X' } })).toBeNull();
    expect(productSentence({ product: { sku: 'SKU1', name: '', price: 10 } })).toBeNull();
    expect(productBody({ product: null })).toBe('');
    expect(productDtuCall({ product: null })).toBeNull();
  });

  it('builds a private DTU call with retail/product tags and retail-lens source', () => {
    const call = productDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('retail-lens:product-report');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('retail');
    expect(tags).toContain('product');
    expect(tags).toContain('electronics');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('retail_product_report');
    expect(machine.sku).toBe('WIDGET-001');
    expect(machine.price).toBe(29.99);
    expect(machine.stock).toBe(150);
    expect(machine.abcClass).toBe('A');
    expect(machine.priceHistoryCount).toBe(2);
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = productThreadDraftCall(facts, 'dtu_r1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_r1');
    expect(String(input.title)).toContain('Widget Pro');
    expect(String(input.content)).toContain('Widget Pro');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(productThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(productThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(productThreadDraftCall({ product: null }, 'dtu_r1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = productThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_r1' } } },
      'dtu_r1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_r1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(productThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_r1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(productThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_r1' } } },
      'dtu_r1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexProductDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_r1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_r2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_r1: 'th_1', dtu_r2: 'th_2' });
  });

  it('includes price history in the body when present', () => {
    const body = productBody(facts);
    expect(body).toContain('Price history (2 changes):');
    expect(body).toContain('$24.99 (initial)');
    expect(body).toContain('$24.99 → $29.99');
  });
});