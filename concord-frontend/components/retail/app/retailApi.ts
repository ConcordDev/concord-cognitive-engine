/**
 * Typed client for the retail domain macros the redesigned lens drives.
 *
 * Every call goes through `/api/lens/run` → `server/domains/retail.js`. The
 * envelope is unwrapped once here so views get `{ ok, result, error }` and
 * never render a half-parsed response. Nothing in this file invents data.
 */

import { apiHelpers } from '@/lib/api/client';

export interface Envelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export async function retail<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    const r = await apiHelpers.lens.runDomain('retail', action, { input });
    const data = (r as { data?: { ok: boolean; result?: unknown; error?: string; message?: string } }).data;
    if (!data) return { ok: false, error: 'No response from the store backend.' };
    // Handler refusals arrive nested as { ok:true, result:{ ok:false, error } }.
    if (data.ok && data.result && typeof data.result === 'object' && 'ok' in (data.result as object)) {
      const inner = data.result as { ok: boolean; result?: T; error?: string; message?: string };
      return { ok: inner.ok, result: inner.result, error: inner.message || inner.error };
    }
    return { ok: data.ok, result: data.result as T, error: data.message || data.error };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Request failed' };
  }
}

// ── Shapes (only the fields the backend actually returns) ───────────────────

export interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
  category?: string;
  barcode?: string;
  /** Owned image DTU linked by retail.product-set-image. */
  imageDtuId?: string;
}

export interface CartLine { sku: string; name: string; unitPrice: number; qty: number; custom?: boolean }

export interface Cart {
  id: string;
  lines: CartLine[];
  discountPercent: number;
  appliedDiscountCode?: string;
  freeShipping?: boolean;
  openedAt?: string;
  customerId?: string;
  customerName?: string;
  pendingPaymentIntentId?: string;
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  subtotalAfterDiscount: number;
  tax: number;
  taxRate: number;
  taxRateSource: 'override' | 'configured' | 'none' | string;
  total: number;
  lineCount: number;
  itemCount: number;
}

export interface ParkedCart {
  id: string;
  openedAt: string;
  lineCount: number;
  itemCount: number;
  subtotal: number;
  customerId: string | null;
  customerName: string | null;
  appliedDiscountCode: string | null;
  cardPending: boolean;
}

export interface Tender { kind: 'cash' | 'gift_card' | 'card' | string; amount: number; code?: string; provider?: string; paymentIntentId?: string }

export interface Order {
  id: string;
  number?: string;
  lines: CartLine[];
  subtotal?: number;
  discount?: number;
  tax?: number;
  taxRate?: number;
  total: number;
  tenders?: Tender[];
  tendered?: number;
  change?: number;
  completedAt: string;
  status?: 'paid' | 'refunded' | 'partially_refunded' | string;
  refundedAmount?: number;
  customerId?: string;
  customerName?: string;
  stripePaymentIntentId?: string;
  paidVia?: string;
  tillSessionId?: string;
  /** Milestones the server stamped when this order was created. */
  stamps?: Stamp[];
}

export interface Stamp { id: 'first_sale' | 'order_milestone' | 'goal_hit' | 'best_day' | 'streak' | string; label: string }

export interface HourBucket { hour: number; revenue: number; orders: number }
export interface Hourly {
  salesBasis: string;
  currentHour: number;
  today: HourBucket[];
  yesterday: HourBucket[];
  todayTotal: number;
  todayOrders: number;
  yesterdayTotal: number;
  yesterdaySameTime: number;
  goal: number;
  goalProgress: number | null;
}

export interface Insights {
  customerId: string;
  name: string;
  visits: number;
  totalSpent: number;
  avgOrder: number;
  favorite: { sku: string; name: string; qty: number; revenue: number } | null;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
}

export interface TillFigures {
  orderCount: number;
  grossSales: number;
  cashIn: number;
  changeGiven: number;
  cashSales: number;
  cardSales: number;
  giftCardSales: number;
  otherSales: number;
  refundsOnSessionOrders: number;
  expectedCash: number;
}
export interface TillSession {
  id: string;
  status: 'open' | 'closed';
  float: number;
  openedAt: string;
  closedAt?: string;
  countedCash?: number;
  variance?: number;
  note?: string;
  figures?: TillFigures;
  ledgerDtuId?: string;
  ledgerMintError?: string;
}
export interface TillStatus { open: boolean; session: TillSession | null; figures: TillFigures | null; lastClosed: TillSession | null }

export interface Storefront { name: string; tagline?: string; slug: string | null; published: boolean }

/** Browser's UTC−local offset, which the day board and stamps bucket by. */
export const tzOffsetMinutes = () => new Date().getTimezoneOffset();

export const imageUrl = (dtuId: string) => `/api/artifact/${encodeURIComponent(dtuId)}/stream`;

/**
 * Upload a product photo through the platform's real upload route (type
 * sniffing + storage quota, one owned DTU), then link it to the product.
 */
export async function uploadProductPhoto(sku: string, file: File): Promise<Envelope<{ product: Product }>> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { ok: false, error: 'Use a PNG, JPEG or WebP photo.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'Photos must be under 5 MB.' };
  try {
    const csrf = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/)?.[1] : undefined;
    const res = await fetch('/api/artifact/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type,
        'X-Filename': encodeURIComponent(file.name),
        'X-Title': encodeURIComponent(`Product photo — ${sku}`),
        'X-Domain': 'retail',
        ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
      },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; dtuId?: string; error?: string };
    if (!res.ok || !body.dtuId) return { ok: false, error: body.error || 'Photo upload failed.' };
    return retail<{ product: Product }>('product-set-image', { sku, dtuId: body.dtuId });
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Photo upload failed.' };
  }
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  totalSpent?: number;
  orderCount?: number;
  lastOrderAt?: string | null;
}

export interface Summary {
  salesBasis: string;
  totalRevenue: number;
  totalOrders: number;
  ordersToday: number;
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  avgOrderValue: number;
  productCount: number;
  customerCount: number;
  activeCarts: number;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export const money = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 8.875 stays 8.875, 5.00 renders as 5 — the rate the server actually charged. */
export const fmtRate = (r: number) => String(Math.round(r * 1000) / 1000);

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The status label a merchant reads, from the order's real status field. */
export function orderStatusLabel(o: Pick<Order, 'status'>): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (o.status === 'refunded') return { label: 'Refunded', tone: 'muted' };
  if (o.status === 'partially_refunded') return { label: 'Partly refunded', tone: 'warn' };
  return { label: 'Paid', tone: 'ok' };
}

export function tenderLabel(t: Tender): string {
  if (t.kind === 'gift_card') return `Gift card${t.code ? ` ${t.code}` : ''}`;
  if (t.kind === 'card') return 'Card';
  if (t.kind === 'cash') return 'Cash';
  return t.kind;
}
