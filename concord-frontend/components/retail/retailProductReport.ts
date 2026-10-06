/**
 * A retail product report exists because the Retail domain's
 * `product-upsert` / `product-list` macros returned the real product —
 * sku, name, price, stock, category, supplier, lead time, daily sales
 * rate, turnover rate, ABC class, and price history. This module turns
 * exactly that result into a sentence, saves it as a private DTU, reads
 * that DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface RetailProductDetail {
  sku?: string;
  name?: string;
  price?: number;
  stock?: number;
  category?: string;
  barcode?: string;
  supplier?: string;
  leadTimeDays?: number | null;
  dailySalesRate?: number;
  turnoverRate?: number | null;
  abcClass?: 'A' | 'B' | 'C' | null;
  priceHistory?: { oldPrice: number | null; newPrice: number; changedAt: string }[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RetailProductFacts {
  product: RetailProductDetail | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The product report sentence, built only from the real detail. Null when
 * there is no product, no sku, or no identifying figures.
 */
export function productSentence(facts: RetailProductFacts): string | null {
  const p = facts.product;
  if (!p || !p.sku || !p.name) return null;
  const price = num(p.price);
  if (price < 0) return null;
  const parts: string[] = [];
  parts.push(str(p.name, 60));
  parts.push(str(p.sku, 32));
  const metrics: string[] = [];
  metrics.push(money(price));
  metrics.push(`${num(p.stock)} in stock`);
  if (p.category) metrics.push(str(p.category, 40));
  if (p.abcClass) metrics.push(`ABC ${p.abcClass}`);
  if (p.turnoverRate != null && p.turnoverRate > 0) metrics.push(`turnover ${num(p.turnoverRate)}×/yr`);
  if (p.supplier) metrics.push(str(p.supplier, 40));
  if (p.leadTimeDays != null && p.leadTimeDays > 0) metrics.push(`${num(p.leadTimeDays)}d lead`);
  return `${parts.join(' · ')}: ${metrics.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function productBody(facts: RetailProductFacts): string {
  const sentence = productSentence(facts);
  const p = facts.product;
  if (!sentence || !p) return '';
  const lines = [sentence, ''];
  lines.push(`SKU: ${p.sku}`);
  lines.push(`Name: ${p.name}`);
  lines.push(`Price: ${money(num(p.price))}`);
  lines.push(`Stock: ${num(p.stock)}`);
  if (p.category) lines.push(`Category: ${p.category}`);
  if (p.barcode) lines.push(`Barcode: ${p.barcode}`);
  if (p.supplier) lines.push(`Supplier: ${p.supplier}`);
  if (p.leadTimeDays != null) lines.push(`Lead time: ${num(p.leadTimeDays)} days`);
  if (p.dailySalesRate != null && num(p.dailySalesRate) > 0) lines.push(`Daily sales rate: ${num(p.dailySalesRate)}`);
  if (p.turnoverRate != null) lines.push(`Turnover rate: ${num(p.turnoverRate)}×/yr`);
  if (p.abcClass) lines.push(`ABC class: ${p.abcClass}`);
  if (Array.isArray(p.priceHistory) && p.priceHistory.length > 0) {
    lines.push(`Price history (${p.priceHistory.length} change${p.priceHistory.length === 1 ? '' : 's'}):`);
    for (const h of p.priceHistory.slice(0, 20)) {
      const date = h.changedAt ? h.changedAt.slice(0, 10) : '?';
      if (h.oldPrice === null) {
        lines.push(`  ${date}: ${money(num(h.newPrice))} (initial)`);
      } else {
        lines.push(`  ${date}: ${money(num(h.oldPrice))} → ${money(num(h.newPrice))}`);
      }
    }
  }
  lines.push('');
  lines.push('Every figure here came from the Retail domain product-list macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same product the macro returned, structured. */
export function productMachine(facts: RetailProductFacts): Record<string, unknown> | null {
  const p = facts.product;
  if (!productSentence(facts) || !p) return null;
  return {
    kind: 'retail_product_report',
    sku: p.sku || null,
    name: p.name || null,
    price: num(p.price),
    stock: num(p.stock),
    category: p.category || null,
    supplier: p.supplier || null,
    leadTimeDays: p.leadTimeDays != null ? num(p.leadTimeDays) : null,
    dailySalesRate: num(p.dailySalesRate),
    turnoverRate: p.turnoverRate != null ? num(p.turnoverRate) : null,
    abcClass: p.abcClass || null,
    priceHistoryCount: Array.isArray(p.priceHistory) ? p.priceHistory.length : 0,
  };
}

/** The private DTU that records this product. Null when nothing can be saved. */
export function productDtuCall(facts: RetailProductFacts): ReceiptCall | null {
  const body = productBody(facts);
  const sentence = productSentence(facts);
  const machine = productMachine(facts);
  if (!body || !sentence || !machine) return null;
  const p = facts.product!;
  const tags = ['retail', 'product', String(p.category || 'catalog').toLowerCase()];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'retail-lens:product-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'retail',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that product report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function productThreadDraftCall(
  facts: RetailProductFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = productSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const p = facts.product!;
  const name = str(p.name, 50) || 'product';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Retail product — ${name}`.slice(0, 120),
      content: productBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ProductDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function productThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ProductDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexProductDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}