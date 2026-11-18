'use client';

/**
 * Register — the retail lens's primary working surface.
 *
 * Reference: Shopify POS. Product grid on the left (search + scan-to-add +
 * category filter), the sale on the right (customer, editable lines,
 * discount, server-computed totals, one Charge action), a tender sheet for
 * cash / gift card / card, and a receipt state with change due.
 *
 * Every number on screen is a retail.* macro result: product-list,
 * cart-open/get/add-line/set-line-qty/void/set-customer, cart-total,
 * discounts-apply, cart-tender, cart-create-payment-intent,
 * cart-confirm-paid-with-intent. Line edits are optimistic (the stepper
 * moves instantly) and reconcile to the server cart, or roll back visibly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ScanLine, Loader2, Minus, Plus, X, Tag, PauseCircle, Trash2, CheckCircle2, ShoppingBag, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { onRetailCatalogChanged } from '../retailCatalogEvents';
import { retail, money, fmtRate, timeAgo, tenderLabel, type Product, type Cart, type CartTotals, type Order, type ParkedCart } from './retailApi';
import { TenderSheet } from './TenderSheet';
import { CustomerPicker } from './CustomerPicker';
import { TodayStrip } from './TodayStrip';
import type { RetailSection } from './sections';

const CART_KEY = 'retail:register:cart';
const LOW_STOCK = 5;

function readSavedCart(): string | null {
  try { return window.sessionStorage.getItem(CART_KEY); } catch { return null; }
}
function saveCartId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(CART_KEY, id);
    else window.sessionStorage.removeItem(CART_KEY);
  } catch { /* storage unavailable — the sale is still parked server-side */ }
}

export function Register({ onNavigate }: { onNavigate: (s: RetailSection, sub?: string) => void }) {
  // ── catalog ───────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async () => {
    const r = await retail<{ products: Product[] }>('product-list');
    if (r.ok && r.result) { setProducts(r.result.products); setCatalogState('ready'); setCatalogError(null); }
    else { setCatalogState('error'); setCatalogError(r.error || 'Could not load the catalog.'); }
  }, []);

  useEffect(() => {
    loadProducts();
    return onRetailCatalogChanged(() => { loadProducts(); });
  }, [loadProducts]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) =>
      (category === 'all' || p.category === category) &&
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').toLowerCase() === q),
    );
  }, [products, query, category]);

  // ── sale ──────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<Cart | null>(null);
  const [totals, setTotals] = useState<CartTotals | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warn' | 'ok'; text: string } | null>(null);
  const [pending, setPending] = useState(0); // in-flight line edits
  const [tenderOpen, setTenderOpen] = useState(false);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [parked, setParked] = useState<ParkedCart[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [discountBusy, setDiscountBusy] = useState(false);
  const [todayKey, setTodayKey] = useState(0);
  const totalsSeq = useRef(0);
  const cartRef = useRef<Cart | null>(null);
  cartRef.current = cart;

  const refreshTotals = useCallback(async (cartId: string) => {
    const seq = ++totalsSeq.current;
    const t = await retail<CartTotals>('cart-total', { cartId });
    if (seq !== totalsSeq.current) return; // a newer edit superseded this read
    setTotals(t.ok && t.result ? t.result : null);
  }, []);

  const adopt = useCallback((c: Cart | null) => {
    setCart(c);
    saveCartId(c?.id ?? null);
    if (c) refreshTotals(c.id); else setTotals(null);
  }, [refreshTotals]);

  const loadParked = useCallback(async () => {
    const r = await retail<{ carts: ParkedCart[] }>('cart-list');
    if (r.ok && r.result) setParked(r.result.carts);
  }, []);

  // Resume this tab's sale after a reload; otherwise start empty.
  useEffect(() => {
    const id = readSavedCart();
    if (id) {
      retail<{ cart: Cart }>('cart-get', { cartId: id }).then((r) => {
        if (r.ok && r.result) adopt(r.result.cart); else saveCartId(null);
      });
    }
    loadParked();
  }, [adopt, loadParked]);

  // Rapid taps on an empty register must share ONE cart-open, not race into
  // two carts (each tap's line landing in a different sale).
  const openingRef = useRef<Promise<Cart | null> | null>(null);
  const ensureCart = useCallback(async (): Promise<Cart | null> => {
    if (cartRef.current) return cartRef.current;
    if (openingRef.current) return openingRef.current;
    openingRef.current = (async () => {
      const r = await retail<{ cart: Cart }>('cart-open');
      if (!r.ok || !r.result) { setNotice({ tone: 'error', text: r.error || 'Could not start a sale.' }); return null; }
      adopt(r.result.cart);
      cartRef.current = r.result.cart;
      return r.result.cart;
    })();
    try { return await openingRef.current; } finally { openingRef.current = null; }
  }, [adopt]);

  const handleEditResult = useCallback((r: { ok: boolean; result?: { cart: Cart; stockWarning?: string; discountDropped?: string; discountDroppedReason?: string }; error?: string }, rollback: Cart | null) => {
    if (r.ok && r.result) {
      adopt(r.result.cart);
      if (r.result.discountDropped) setNotice({ tone: 'warn', text: `${r.result.discountDropped} removed: ${r.result.discountDroppedReason}.` });
      else if (r.result.stockWarning) setNotice({ tone: 'warn', text: r.result.stockWarning });
      else setNotice(null);
    } else {
      setCart(rollback);
      setNotice({ tone: 'error', text: r.error || 'That change did not save.' });
    }
  }, [adopt]);

  const addProduct = useCallback(async (p: Product) => {
    setReceipt(null);
    const c = await ensureCart();
    if (!c) return;
    const before = cartRef.current;
    // Optimistic: the line appears / ticks up immediately.
    if (before) {
      const lines = before.lines.some((l) => l.sku === p.sku)
        ? before.lines.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l))
        : [...before.lines, { sku: p.sku, name: p.name, unitPrice: p.price, qty: 1 }];
      setCart({ ...before, lines });
    }
    setPending((n) => n + 1);
    const r = await retail<{ cart: Cart; stockWarning?: string; discountDropped?: string; discountDroppedReason?: string }>('cart-add-line', { cartId: c.id, sku: p.sku, qty: 1 });
    setPending((n) => n - 1);
    handleEditResult(r, before);
  }, [ensureCart, handleEditResult]);

  const setQty = useCallback(async (sku: string, qty: number) => {
    const before = cartRef.current;
    if (!before) return;
    const lines = qty <= 0 ? before.lines.filter((l) => l.sku !== sku) : before.lines.map((l) => (l.sku === sku ? { ...l, qty } : l));
    setCart({ ...before, lines });
    setPending((n) => n + 1);
    const r = await retail<{ cart: Cart; stockWarning?: string; discountDropped?: string; discountDroppedReason?: string }>('cart-set-line-qty', { cartId: before.id, sku, qty: Math.max(0, qty) });
    setPending((n) => n - 1);
    handleEditResult(r, before);
  }, [handleEditResult]);

  const applyDiscount = async () => {
    if (!cart || !discountCode.trim()) return;
    setDiscountBusy(true);
    const r = await retail<{ cart: Cart; discountAmount: number }>('discounts-apply', { cartId: cart.id, code: discountCode.trim() });
    setDiscountBusy(false);
    if (r.ok && r.result) {
      adopt(r.result.cart);
      setDiscountCode('');
      setNotice({ tone: 'ok', text: `${r.result.cart.appliedDiscountCode} applied — ${money(r.result.discountAmount)} off.` });
    } else setNotice({ tone: 'error', text: r.error || 'That code was not accepted.' });
  };

  const newSale = useCallback(() => {
    // The current cart (if any) stays open server-side as a parked sale.
    setCart(null); setTotals(null); saveCartId(null); setReceipt(null); setNotice(null); setTenderOpen(false);
    loadParked();
    searchRef.current?.focus();
  }, [loadParked]);

  const voidSale = async () => {
    if (!cart) return;
    const r = await retail<{ voided: string }>('cart-void', { cartId: cart.id });
    if (r.ok) { setCart(null); setTotals(null); saveCartId(null); setNotice({ tone: 'ok', text: 'Sale voided.' }); loadParked(); }
    else setNotice({ tone: 'error', text: r.error || 'Could not void this sale.' });
  };

  const resume = async (id: string) => {
    const r = await retail<{ cart: Cart }>('cart-get', { cartId: id });
    setParkedOpen(false);
    if (r.ok && r.result) { setReceipt(null); adopt(r.result.cart); setNotice(null); }
    else { setNotice({ tone: 'error', text: r.error || 'That sale is no longer open.' }); loadParked(); }
  };

  const onSaleComplete = (order: Order) => {
    setTenderOpen(false);
    setReceipt(order);
    setCart(null); setTotals(null); saveCartId(null); setNotice(null);
    setTodayKey((k) => k + 1);
    loadProducts(); // stock moved
    loadParked();
  };

  // Scan / type then Enter: exact SKU or barcode wins, else a single match.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.sku.toLowerCase() === q || (p.barcode || '').toLowerCase() === q);
    const hit = exact || (visible.length === 1 ? visible[0] : null);
    if (hit) { addProduct(hit); setQuery(''); }
    else setNotice({ tone: 'warn', text: visible.length ? `${visible.length} products match "${query.trim()}" — pick one.` : `No product with SKU or barcode "${query.trim()}".` });
  };

  const canCharge = !!cart && cart.lines.length > 0 && !!totals && pending === 0;

  useLensCommand(
    [
      { id: 'reg-search', keys: '/', description: 'Register: search / scan product', category: 'navigation', action: () => searchRef.current?.focus() },
      { id: 'reg-new', keys: 'n', description: 'Register: new sale (parks the current one)', category: 'actions', action: newSale },
      { id: 'reg-charge', keys: 'mod+enter', description: 'Register: charge', category: 'actions', global: true, enabled: canCharge, action: () => setTenderOpen(true) },
    ],
    { lensId: 'retail' },
  );

  const inCart = useMemo(() => new Map((cart?.lines || []).map((l) => [l.sku, l.qty])), [cart]);
  const otherParked = parked.filter((p) => p.id !== cart?.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TodayStrip refreshKey={todayKey} onNavigate={onNavigate} />

      {/* Phones: one scrolling page (products, then the sale) with a sticky
          sale bar. Desktop: products and sale side by side, each scrolling. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── Catalog ─────────────────────────────────────────────── */}
        <section aria-label="Products" className="flex flex-col border-white/[0.06] lg:min-h-0 lg:flex-1 lg:border-r">
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-3">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Search or scan a product</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search, or scan SKU / barcode and press Enter"
                className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] pl-9 pr-16 text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-zinc-600">
                <ScanLine className="h-3.5 w-3.5" /> <kbd className="rounded border border-white/10 px-1 font-mono">/</kbd>
              </span>
            </label>
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1 overflow-x-auto px-4 pb-3" role="tablist" aria-label="Category">
              {['all', ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] transition-colors',
                    category === c ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                  )}
                >
                  {c === 'all' ? `All · ${products.length}` : c}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-busy={catalogState === 'loading'}>
            {catalogState === 'loading' ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-lg bg-white/[0.03]" />)}
              </div>
            ) : catalogState === 'error' ? (
              <div role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-[13px] text-rose-200">
                {catalogError} <button type="button" onClick={loadProducts} className="ml-2 underline">Retry</button>
              </div>
            ) : products.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
                <ShoppingBag className="h-8 w-8 text-zinc-600" />
                <p className="text-[14px] text-zinc-300">No products to sell yet.</p>
                <button type="button" onClick={() => onNavigate('products')} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-[13px] font-medium text-zinc-900 hover:bg-white">Add your first product</button>
              </div>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-zinc-500">Nothing matches &ldquo;{query}&rdquo;.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {visible.map((p) => {
                  const q = inCart.get(p.sku) || 0;
                  const out = p.stock <= 0;
                  const low = !out && p.stock <= LOW_STOCK;
                  return (
                    <button
                      key={p.sku}
                      type="button"
                      onClick={() => addProduct(p)}
                      title={`${p.name} — ${money(p.price)} · ${p.stock} in stock`}
                      className={cn(
                        'group relative flex h-[92px] flex-col justify-between rounded-lg border p-3 text-left transition-[border-color,background-color,transform] active:scale-[0.98]',
                        q > 0 ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
                      )}
                    >
                      {q > 0 && (
                        <span className="absolute right-2 top-2 min-w-[22px] rounded-full bg-emerald-500 px-1.5 text-center font-mono text-[11px] font-semibold leading-[18px] text-zinc-950">{q}</span>
                      )}
                      <span className="line-clamp-2 pr-6 text-[13px] leading-snug text-zinc-100">{p.name}</span>
                      <span className="flex items-baseline justify-between">
                        <span className="font-mono text-[15px] tabular-nums text-zinc-50">{money(p.price)}</span>
                        <span className={cn('font-mono text-[11px] tabular-nums', out ? 'text-rose-400' : low ? 'text-amber-400' : 'text-zinc-500')}>
                          {out ? 'out' : `${p.stock} left`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── Sale ────────────────────────────────────────────────── */}
        <aside id="retail-current-sale" aria-label="Current sale" className="flex w-full flex-col border-t border-white/[0.06] bg-black/20 pb-16 lg:min-h-0 lg:w-[400px] lg:border-t-0 lg:pb-0">
          <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-zinc-100">{receipt ? 'Sale complete' : cart ? 'Current sale' : 'New sale'}</div>
              <div className="font-mono text-[11px] text-zinc-500">
                {receipt ? receipt.number : cart ? `#${cart.id.slice(-6)} · opened ${timeAgo(cart.openedAt)}` : 'Tap a product to start'}
              </div>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => { setParkedOpen((o) => !o); loadParked(); }}
                aria-expanded={parkedOpen}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                title="Parked sales"
              >
                <Clock className="h-3.5 w-3.5" /> Parked{otherParked.length ? ` · ${otherParked.length}` : ''}
              </button>
              {parkedOpen && (
                <div className="absolute right-0 top-9 z-20 w-72 rounded-lg border border-white/10 bg-zinc-950 p-1 shadow-2xl" role="menu">
                  {otherParked.length === 0 ? (
                    <p className="px-3 py-3 text-[12px] text-zinc-500">No parked sales. <kbd className="rounded border border-white/10 px-1 font-mono">N</kbd> parks the current sale and starts a new one.</p>
                  ) : otherParked.map((p) => (
                    <button key={p.id} type="button" role="menuitem" onClick={() => resume(p.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left hover:bg-white/5">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-zinc-200">{p.customerName || `#${p.id.slice(-6)}`}</span>
                        <span className="block text-[11px] text-zinc-500">{p.itemCount} item{p.itemCount === 1 ? '' : 's'} · {timeAgo(p.openedAt)}{p.cardPending ? ' · card started' : ''}</span>
                      </span>
                      <span className="font-mono text-[13px] tabular-nums text-zinc-300">{money(p.subtotal)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {cart && !receipt && (
              <>
                <button type="button" onClick={newSale} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200" title="Park this sale and start a new one (N)" aria-label="Park sale">
                  <PauseCircle className="h-4 w-4" />
                </button>
                <button type="button" onClick={voidSale} className="rounded-md p-1.5 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300" title="Void this sale" aria-label="Void sale">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </header>

          {receipt ? (
            <ReceiptPanel order={receipt} onNewSale={newSale} onViewOrders={() => onNavigate('orders')} />
          ) : (
            <>
              {cart && (
                <CustomerPicker
                  cart={cart}
                  onChange={(c) => adopt(c)}
                  onError={(t) => setNotice({ tone: 'error', text: t })}
                />
              )}

              <div className="px-2 py-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {!cart || cart.lines.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-6 py-6 text-center lg:py-10">
                    <p className="text-[13px] text-zinc-500">Tap a product or scan a barcode to add it to the sale.</p>
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {cart.lines.map((l) => (
                      <li key={l.sku} className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-white/[0.03]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-zinc-100">{l.name}</div>
                          <div className="font-mono text-[11px] tabular-nums text-zinc-500">{money(l.unitPrice)} · {l.sku}</div>
                        </div>
                        <div className="flex items-center rounded-md border border-white/10">
                          <button type="button" onClick={() => setQty(l.sku, l.qty - 1)} className="p-1.5 text-zinc-400 hover:text-zinc-100" aria-label={`One less ${l.name}`}><Minus className="h-3 w-3" /></button>
                          <span className="min-w-[24px] text-center font-mono text-[13px] tabular-nums text-zinc-100">{l.qty}</span>
                          <button type="button" onClick={() => setQty(l.sku, l.qty + 1)} className="p-1.5 text-zinc-400 hover:text-zinc-100" aria-label={`One more ${l.name}`}><Plus className="h-3 w-3" /></button>
                        </div>
                        <span className="w-20 text-right font-mono text-[13px] tabular-nums text-zinc-100">{money(l.qty * l.unitPrice)}</span>
                        <button type="button" onClick={() => setQty(l.sku, 0)} className="rounded p-1 text-zinc-600 opacity-0 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100" aria-label={`Remove ${l.name}`}><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {notice && (
                <div
                  role={notice.tone === 'error' ? 'alert' : 'status'}
                  className={cn(
                    'mx-3 mb-2 rounded-md px-3 py-2 text-[12px]',
                    notice.tone === 'error' && 'bg-rose-500/10 text-rose-200',
                    notice.tone === 'warn' && 'bg-amber-500/10 text-amber-200',
                    notice.tone === 'ok' && 'bg-emerald-500/10 text-emerald-200',
                  )}
                >
                  {notice.text}
                </div>
              )}

              <footer className="border-t border-white/[0.06] px-4 pb-4 pt-3">
                {cart && cart.lines.length > 0 && (
                  <div className="mb-3">
                    {cart.appliedDiscountCode ? (
                      <div className="flex items-center gap-1.5 text-[12px] text-emerald-300"><Tag className="h-3.5 w-3.5" /> {cart.appliedDiscountCode}</div>
                    ) : (
                      <form onSubmit={(e) => { e.preventDefault(); applyDiscount(); }} className="flex gap-1.5">
                        <input
                          aria-label="Discount code"
                          value={discountCode}
                          onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                          placeholder="Discount code"
                          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2.5 font-mono text-[12px] text-zinc-100 placeholder:font-sans placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
                        />
                        <button type="submit" disabled={!discountCode.trim() || discountBusy} className="h-8 rounded-md px-3 text-[12px] text-zinc-300 hover:bg-white/5 disabled:opacity-40">
                          {discountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                <dl className="space-y-1 text-[13px] tabular-nums">
                  <div className="flex justify-between text-zinc-400"><dt>Subtotal</dt><dd className="font-mono">{money(totals?.subtotal)}</dd></div>
                  {!!totals?.discount && <div className="flex justify-between text-emerald-300"><dt>Discount</dt><dd className="font-mono">−{money(totals.discount)}</dd></div>}
                  <div className="flex justify-between text-zinc-400">
                    <dt>{totals?.taxRateSource === 'none' ? <button type="button" onClick={() => onNavigate('store', 'taxes')} className="underline decoration-dotted underline-offset-2 hover:text-zinc-200">Tax · no rate set</button> : `Tax${totals ? ` · ${fmtRate(totals.taxRate)}%` : ''}`}</dt>
                    <dd className="font-mono">{money(totals?.tax)}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => setTenderOpen(true)}
                  disabled={!canCharge}
                  className="mt-3 flex h-12 w-full items-center justify-between rounded-lg bg-emerald-500 px-4 text-zinc-950 transition-colors hover:bg-emerald-400 disabled:bg-white/[0.06] disabled:text-zinc-600"
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    {pending > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Charge
                    <kbd className="rounded bg-black/15 px-1 font-mono text-[10px] font-normal">⌘↵</kbd>
                  </span>
                  <span className="font-mono text-[17px] font-semibold tabular-nums">{money(totals?.total)}</span>
                </button>
              </footer>
            </>
          )}
        </aside>
      </div>

      {cart && cart.lines.length > 0 && !receipt && (
        <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-white/10 bg-zinc-950/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <button type="button" onClick={() => document.getElementById('retail-current-sale')?.scrollIntoView({ behavior: 'smooth' })} className="min-w-0 flex-1 text-left">
            <span className="block text-[12px] text-zinc-400">{cart.lines.reduce((n, l) => n + l.qty, 0)} items{cart.customerName ? ` · ${cart.customerName}` : ''}</span>
            <span className="text-[12px] text-zinc-500 underline decoration-dotted underline-offset-2">Review sale</span>
          </button>
          <button type="button" onClick={() => setTenderOpen(true)} disabled={!canCharge} className="flex h-11 items-center gap-3 rounded-lg bg-emerald-500 px-4 text-zinc-950 disabled:bg-white/[0.06] disabled:text-zinc-600">
            <span className="text-[13px] font-semibold">Charge</span>
            <span className="font-mono text-[15px] font-semibold tabular-nums">{money(totals?.total)}</span>
          </button>
        </div>
      )}

      {tenderOpen && cart && totals && (
        <TenderSheet cart={cart} totals={totals} onClose={() => setTenderOpen(false)} onComplete={onSaleComplete} />
      )}
    </div>
  );
}

function ReceiptPanel({ order, onNewSale, onViewOrders }: { order: Order; onNewSale: () => void; onViewOrders: () => void }) {
  const change = Number(order.change) || 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col items-center border-b border-white/[0.06] px-6 py-8 text-center" role="status">
        <CheckCircle2 className="mb-3 h-8 w-8 text-emerald-400" />
        {change > 0 ? (
          <>
            <div className="text-[12px] uppercase tracking-wider text-zinc-500">Change due</div>
            <div className="mt-1 font-mono text-[40px] font-semibold leading-none tabular-nums text-zinc-50">{money(change)}</div>
            <div className="mt-2 text-[12px] text-zinc-500">of {money(order.tendered)} tendered on {money(order.total)}</div>
          </>
        ) : (
          <>
            <div className="font-mono text-[32px] font-semibold tabular-nums text-zinc-50">{money(order.total)}</div>
            <div className="mt-1 text-[12px] text-zinc-500">paid in full</div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px]">
        {order.customerName && <div className="mb-2 text-zinc-400">Customer · <span className="text-zinc-200">{order.customerName}</span></div>}
        <ul className="space-y-1">
          {order.lines.map((l) => (
            <li key={l.sku} className="flex justify-between gap-2 tabular-nums text-zinc-300">
              <span className="truncate">{l.qty} × {l.name}</span><span className="font-mono">{money(l.qty * l.unitPrice)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-0.5 border-t border-white/[0.06] pt-2 font-mono tabular-nums text-zinc-500">
          {(order.tenders || []).map((t, i) => (
            <div key={i} className="flex justify-between"><span className="font-sans">{tenderLabel(t)}</span><span>{money(t.amount)}</span></div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
        <button type="button" onClick={onNewSale} autoFocus className="h-10 flex-1 rounded-lg bg-zinc-100 text-[13px] font-semibold text-zinc-900 hover:bg-white">
          New sale <kbd className="ml-1 rounded bg-black/10 px-1 font-mono text-[10px] font-normal">N</kbd>
        </button>
        <button type="button" onClick={onViewOrders} className="h-10 rounded-lg px-3 text-[13px] text-zinc-300 hover:bg-white/5">Orders</button>
        <SaveAsDtuButton
          compact
          apiSource="retail-pos"
          title={`Receipt ${order.number || order.id} — ${money(order.total)}`}
          content={`${order.number || order.id} · ${order.completedAt}\n${order.lines.map((l) => `${l.qty} × ${l.name} @ ${money(l.unitPrice)}`).join('\n')}\nTotal ${money(order.total)} · ${(order.tenders || []).map((t) => `${tenderLabel(t)} ${money(t.amount)}`).join(' + ')}${change > 0 ? ` · change ${money(change)}` : ''}`}
          extraTags={['retail', 'pos', 'receipt']}
          rawData={order}
        />
      </div>
    </div>
  );
}

export default Register;
