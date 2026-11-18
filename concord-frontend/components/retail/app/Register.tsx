'use client';

/**
 * Register — "The Stall". The lens's working surface.
 *
 * Crates (the catalog: photo, hanging price tag, how full the crate looks
 * = real stock), a hand-written price tag for open-price items, and the
 * till roll (the sale) that inks each line in when the server confirms it.
 * Taps are optimistic — a line appears at once in pencil-grey and inks in
 * on confirmation, or is rubbed out with the server's reason.
 *
 * Every figure is a retail.* macro result: product-list, product-set-image,
 * cart-open/get/add-line/add-custom-line/set-line-qty/void/set-customer,
 * cart-total, discounts-apply, cart-list, customer-insights, and the
 * tender paths in TenderSheet. Stamps on the receipt are the server's
 * (cart-tender computes them when the order is created).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ScanLine, Loader2, Minus, Plus, X, Tag, PauseCircle, Trash2, Camera, Clock, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { onRetailCatalogChanged, announceRetailCatalogChanged } from '../retailCatalogEvents';
import { retail, money, fmtRate, timeAgo, tenderLabel, imageUrl, uploadProductPhoto, type Product, type Cart, type CartTotals, type Order, type ParkedCart } from './retailApi';
import { TenderSheet } from './TenderSheet';
import { CustomerPicker } from './CustomerPicker';
import { RegularsCard } from './RegularsCard';
import { DayBoard } from './DayBoard';
import { ShopSign } from './ShopSign';
import { playBell, playChaChing } from './stallSound';
import type { RetailSection } from './sections';

const CART_KEY = 'retail:register:cart';
const LOW_STOCK = 5;
/** A crate reads "full" at this many units; the exact count is always printed. */
const FULL_CRATE = 24;

function readSavedCart(): string | null {
  try { return window.sessionStorage.getItem(CART_KEY); } catch { return null; }
}
function saveCartId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(CART_KEY, id);
    else window.sessionStorage.removeItem(CART_KEY);
  } catch { /* storage unavailable — the sale is still parked server-side */ }
}

type EditResult = { ok: boolean; result?: { cart: Cart; stockWarning?: string; discountDropped?: string; discountDroppedReason?: string }; error?: string };

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

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean) as string[])).sort(), [products]);

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
  const [pendingSkus, setPendingSkus] = useState<Set<string>>(new Set());
  const [tenderOpen, setTenderOpen] = useState(false);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [parked, setParked] = useState<ParkedCart[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [discountBusy, setDiscountBusy] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const [ringKey, setRingKey] = useState(0);
  const totalsSeq = useRef(0);
  const cartRef = useRef<Cart | null>(null);
  cartRef.current = cart;

  const markPending = (sku: string, on: boolean) => setPendingSkus((prev) => {
    const next = new Set(prev);
    if (on) next.add(sku); else next.delete(sku);
    return next;
  });

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

  const handleEditResult = useCallback((r: EditResult, rollback: Cart | null) => {
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
    if (before) {
      const lines = before.lines.some((l) => l.sku === p.sku)
        ? before.lines.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l))
        : [...before.lines, { sku: p.sku, name: p.name, unitPrice: p.price, qty: 1 }];
      setCart({ ...before, lines });
    }
    markPending(p.sku, true);
    const r = await retail<EditResult['result']>('cart-add-line', { cartId: c.id, sku: p.sku, qty: 1 }) as EditResult;
    markPending(p.sku, false);
    handleEditResult(r, before);
  }, [ensureCart, handleEditResult]);

  const setQty = useCallback(async (sku: string, qty: number) => {
    const before = cartRef.current;
    if (!before) return;
    const lines = qty <= 0 ? before.lines.filter((l) => l.sku !== sku) : before.lines.map((l) => (l.sku === sku ? { ...l, qty } : l));
    setCart({ ...before, lines });
    markPending(sku, true);
    const r = await retail<EditResult['result']>('cart-set-line-qty', { cartId: before.id, sku, qty: Math.max(0, qty) }) as EditResult;
    markPending(sku, false);
    handleEditResult(r, before);
  }, [handleEditResult]);

  const addCustom = async (name: string, price: number): Promise<string | null> => {
    setReceipt(null);
    const c = await ensureCart();
    if (!c) return 'Could not start a sale.';
    const r = await retail<{ cart: Cart; discountDropped?: string; discountDroppedReason?: string }>('cart-add-custom-line', { cartId: c.id, name, price });
    if (!r.ok || !r.result) return r.error || 'That price tag was not accepted.';
    handleEditResult(r as EditResult, cartRef.current);
    return null;
  };

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
    setBoardKey((k) => k + 1);
    playChaChing();
    if (order.stamps?.some((s) => s.id === 'goal_hit')) { setRingKey((k) => k + 1); window.setTimeout(playBell, 450); }
    loadProducts(); // stock moved
    loadParked();
  };

  const onPhoto = async (p: Product, file: File) => {
    setNotice(null);
    const r = await uploadProductPhoto(p.sku, file);
    if (r.ok && r.result) {
      setProducts((ps) => ps.map((x) => (x.sku === p.sku ? { ...x, imageDtuId: r.result!.product.imageDtuId } : x)));
      announceRetailCatalogChanged();
    } else setNotice({ tone: 'error', text: r.error || 'Photo upload failed.' });
  };

  // Scan / type then Enter: exact SKU or barcode wins, else a single match.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.sku.toLowerCase() === q || (p.barcode || '').toLowerCase() === q);
    const hit = exact || (visible.length === 1 ? visible[0] : null);
    if (hit) { addProduct(hit); setQuery(''); }
    else setNotice({ tone: 'warn', text: visible.length ? `${visible.length} crates match "${query.trim()}" — pick one.` : `No product with SKU or barcode "${query.trim()}".` });
  };

  const canCharge = !!cart && cart.lines.length > 0 && !!totals && pendingSkus.size === 0;

  useLensCommand(
    [
      { id: 'reg-search', keys: '/', description: 'Register: search / scan product', category: 'navigation', action: () => searchRef.current?.focus() },
      { id: 'reg-new', keys: 'n', description: 'Register: new sale (parks the current one)', category: 'actions', action: newSale },
      { id: 'reg-tag', keys: 't', description: 'Register: hand-written price tag', category: 'actions', action: () => setTagOpen(true) },
      { id: 'reg-charge', keys: 'mod+enter', description: 'Register: ring it up', category: 'actions', global: true, enabled: canCharge, action: () => setTenderOpen(true) },
    ],
    { lensId: 'retail' },
  );

  const inCart = useMemo(() => new Map((cart?.lines || []).map((l) => [l.sku, l.qty])), [cart]);
  const otherParked = parked.filter((p) => p.id !== cart?.id);
  const itemCount = (cart?.lines || []).reduce((n, l) => n + l.qty, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ShopSign refreshKey={boardKey} />
      <DayBoard refreshKey={boardKey} ringKey={ringKey} onNavigate={onNavigate} />

      {/* Phones: one scrolling page (crates, then the till roll) with a
          sticky sale bar. Desktop: crates and till roll side by side. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* ── Crates ──────────────────────────────────────────────── */}
        <section aria-label="Products" className="flex flex-col lg:min-h-0 lg:flex-1">
          <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Search or scan a product</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--stall-chalk-faint)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search, or scan SKU / barcode and press Enter"
                className="h-10 w-full rounded-lg border border-[color:var(--stall-line)] bg-black/20 pl-9 pr-16 text-[14px] text-[color:var(--stall-chalk)] placeholder:text-[color:var(--stall-chalk-faint)] focus:border-[color:var(--stall-brass)] focus:outline-none"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-[color:var(--stall-chalk-faint)]">
                <ScanLine className="h-3.5 w-3.5" /> <kbd className="rounded border border-[color:var(--stall-line)] px-1 font-mono">/</kbd>
              </span>
            </label>
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1 overflow-x-auto px-4 pb-3" role="tablist" aria-label="Category">
              {['all', ...categories].map((c) => (
                <button key={c} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
                  className={cn('whitespace-nowrap rounded-full px-3 py-0.5 font-[family-name:var(--stall-font-hand)] text-[18px] transition-colors',
                    category === c ? 'bg-[color:var(--stall-chalk)] text-[color:var(--stall-board)]' : 'text-[color:var(--stall-chalk-dim)] hover:bg-white/5 hover:text-[color:var(--stall-chalk)]')}>
                  {c === 'all' ? `Everything · ${products.length}` : c}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-busy={catalogState === 'loading'}>
            {catalogState === 'loading' ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="stall-crate h-[176px] animate-pulse rounded-xl" />)}
              </div>
            ) : catalogState === 'error' ? (
              <div role="alert" className="rounded-lg bg-[color:var(--stall-tomato-dim)] p-4 text-[13px] text-[color:var(--stall-tomato)]">
                {catalogError} <button type="button" onClick={loadProducts} className="ml-2 underline">Retry</button>
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="font-[family-name:var(--stall-font-marker)] text-[26px]">The stall is empty.</p>
                <p className="font-[family-name:var(--stall-font-hand)] text-[20px] text-[color:var(--stall-chalk-dim)]">Stock a crate and it shows up here, ready to sell.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => onNavigate('products')} className="rounded-lg bg-[color:var(--stall-brass)] px-4 py-2 text-[13px] font-semibold text-[color:var(--stall-ink)]">Stock your first crate</button>
                  <button type="button" onClick={() => setTagOpen(true)} className="rounded-lg px-4 py-2 text-[13px] text-[color:var(--stall-chalk)] hover:bg-white/5">Or sell with a price tag</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((p) => <Crate key={p.sku} p={p} qty={inCart.get(p.sku) || 0} onAdd={() => addProduct(p)} onPhoto={(f) => onPhoto(p, f)} />)}
                <PriceTagTile open={tagOpen} setOpen={setTagOpen} onAdd={addCustom} />
                {visible.length === 0 && <p className="col-span-full py-6 text-center font-[family-name:var(--stall-font-hand)] text-[20px] text-[color:var(--stall-chalk-dim)]">Nothing on the stall matches &ldquo;{query}&rdquo;.</p>}
              </div>
            )}
          </div>
        </section>

        {/* ── Till roll ───────────────────────────────────────────── */}
        <aside id="retail-current-sale" aria-label="Current sale" className="flex w-full flex-col border-t border-[color:var(--stall-line)] pb-16 lg:min-h-0 lg:w-[400px] lg:border-l lg:border-t-0 lg:pb-0">
          <header className="flex items-center gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-[family-name:var(--stall-font-marker)] text-[18px] leading-tight">{receipt ? 'Sold!' : cart ? 'On the roll' : 'New sale'}</div>
              <div className="font-mono text-[11px] text-[color:var(--stall-chalk-faint)]">
                {receipt ? receipt.number : cart ? `#${cart.id.slice(-6)} · opened ${timeAgo(cart.openedAt)}` : 'Tap a crate to start'}
              </div>
            </div>
            <div className="relative">
              <button type="button" onClick={() => { setParkedOpen((o) => !o); loadParked(); }} aria-expanded={parkedOpen} title="Parked sales"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-[color:var(--stall-chalk-dim)] hover:bg-white/5">
                <Clock className="h-3.5 w-3.5" /> Parked{otherParked.length ? ` · ${otherParked.length}` : ''}
              </button>
              {parkedOpen && (
                <div className="stall-board absolute right-0 top-9 z-20 w-72 rounded-lg border border-[color:var(--stall-line)] p-1 shadow-2xl" role="menu">
                  {otherParked.length === 0 ? (
                    <p className="px-3 py-3 text-[12px] text-[color:var(--stall-chalk-dim)]">No parked sales. <kbd className="rounded border border-[color:var(--stall-line)] px-1 font-mono">N</kbd> parks this one and starts fresh.</p>
                  ) : otherParked.map((p) => (
                    <button key={p.id} type="button" role="menuitem" onClick={() => resume(p.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left hover:bg-white/5">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{p.customerName || `#${p.id.slice(-6)}`}</span>
                        <span className="block text-[11px] text-[color:var(--stall-chalk-faint)]">{p.itemCount} item{p.itemCount === 1 ? '' : 's'} · {timeAgo(p.openedAt)}{p.cardPending ? ' · card started' : ''}</span>
                      </span>
                      <span className="font-[family-name:var(--stall-font-till)] text-[13px] tabular-nums">{money(p.subtotal)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {cart && !receipt && (
              <>
                <button type="button" onClick={newSale} className="rounded-md p-1.5 text-[color:var(--stall-chalk-dim)] hover:bg-white/5" title="Park this sale and start a new one (N)" aria-label="Park sale"><PauseCircle className="h-4 w-4" /></button>
                <button type="button" onClick={voidSale} className="rounded-md p-1.5 text-[color:var(--stall-chalk-dim)] hover:bg-[color:var(--stall-tomato-dim)] hover:text-[color:var(--stall-tomato)]" title="Void this sale" aria-label="Void sale"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </header>

          {receipt ? (
            <ReceiptPanel order={receipt} onNewSale={newSale} onViewOrders={() => onNavigate('orders')} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              <div className="stall-paper stall-perf-top flex min-h-[260px] flex-1 flex-col rounded-b-md pt-3 font-[family-name:var(--stall-font-till)] shadow-[0_6px_18px_rgba(0,0,0,0.35)] lg:min-h-0">
                {cart && (
                  <div className="px-3">
                    <CustomerPicker cart={cart} onChange={(c) => adopt(c)} onError={(t) => setNotice({ tone: 'error', text: t })} />
                    {cart.customerId && <RegularsCard customerId={cart.customerId} />}
                  </div>
                )}

                <div className="px-2 py-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {!cart || cart.lines.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
                      <p className="font-[family-name:var(--stall-font-hand)] text-[22px] leading-snug text-[color:var(--stall-ink-dim)]">Tap a crate, scan a barcode,<br />or write a price tag.</p>
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {cart.lines.map((l) => {
                        const pending = pendingSkus.has(l.sku);
                        return (
                          <li key={`${l.sku}:${pending ? 'p' : 'c'}`} className={cn('group flex items-center gap-2 rounded px-2 py-1.5', pending ? 'opacity-45' : 'stall-ink-in')} aria-busy={pending}>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-bold uppercase tracking-tight">{l.name}</div>
                              <div className="text-[11px] tabular-nums text-[color:var(--stall-ink-dim)]">{money(l.unitPrice)}{l.custom ? ' · price tag' : ` · ${l.sku}`}</div>
                            </div>
                            <div className="flex items-center rounded border border-black/20">
                              <button type="button" onClick={() => setQty(l.sku, l.qty - 1)} className="p-1.5 text-[color:var(--stall-ink-dim)] hover:text-[color:var(--stall-ink)]" aria-label={`One less ${l.name}`}><Minus className="h-3 w-3" /></button>
                              <span className="min-w-[22px] text-center text-[13px] font-bold tabular-nums">{l.qty}</span>
                              <button type="button" onClick={() => setQty(l.sku, l.qty + 1)} className="p-1.5 text-[color:var(--stall-ink-dim)] hover:text-[color:var(--stall-ink)]" aria-label={`One more ${l.name}`}><Plus className="h-3 w-3" /></button>
                            </div>
                            <span className="w-[72px] text-right text-[13px] font-bold tabular-nums">{money(l.qty * l.unitPrice)}</span>
                            <button type="button" onClick={() => setQty(l.sku, 0)} className="rounded p-1 text-[color:var(--stall-ink-dim)] opacity-0 hover:text-[color:var(--stall-tomato)] focus:opacity-100 group-hover:opacity-100" aria-label={`Remove ${l.name}`}><X className="h-3.5 w-3.5" /></button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {notice && (
                  <div role={notice.tone === 'error' ? 'alert' : 'status'}
                    className={cn('mx-3 mb-2 rounded px-3 py-2 font-sans text-[12px]',
                      notice.tone === 'error' && 'bg-[color:var(--stall-tomato-dim)] text-[color:var(--stall-tomato)]',
                      notice.tone === 'warn' && 'bg-[color:var(--stall-brass-dim)] text-[color:var(--stall-wood-dark)]',
                      notice.tone === 'ok' && 'bg-[color:var(--stall-leaf-dim)] text-[color:var(--stall-leaf-strong)]')}>
                    {notice.text}
                  </div>
                )}

                <footer className="px-4 pb-3">
                  {cart && cart.lines.length > 0 && (
                    <div className="mb-2">
                      {cart.appliedDiscountCode ? (
                        <div className="flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--stall-leaf-strong)]"><Tag className="h-3.5 w-3.5" /> {cart.appliedDiscountCode}</div>
                      ) : (
                        <form onSubmit={(e) => { e.preventDefault(); applyDiscount(); }} className="flex gap-1.5">
                          <input aria-label="Discount code" value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} placeholder="Discount code"
                            className="h-8 min-w-0 flex-1 rounded border border-black/20 bg-transparent px-2.5 text-[12px] placeholder:text-[color:var(--stall-ink-dim)] focus:outline-none" />
                          <button type="submit" disabled={!discountCode.trim() || discountBusy} className="h-8 rounded px-3 text-[12px] font-bold hover:bg-black/5 disabled:opacity-40">
                            {discountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                  <div className="stall-dashed pt-2" />
                  <dl className="space-y-0.5 text-[13px] tabular-nums">
                    <div className="flex justify-between"><dt>SUBTOTAL</dt><dd>{money(totals?.subtotal)}</dd></div>
                    {!!totals?.discount && <div className="flex justify-between text-[color:var(--stall-leaf-strong)]"><dt>DISCOUNT</dt><dd>−{money(totals.discount)}</dd></div>}
                    <div className="flex justify-between">
                      <dt>{totals?.taxRateSource === 'none'
                        ? <button type="button" onClick={() => onNavigate('store', 'taxes')} className="underline decoration-dotted underline-offset-2">TAX · NO RATE SET</button>
                        : `TAX${totals ? ` ${fmtRate(totals.taxRate)}%` : ''}`}</dt>
                      <dd>{money(totals?.tax)}</dd>
                    </div>
                    <div className="flex justify-between pt-1 text-[16px] font-bold"><dt>TOTAL</dt><dd>{money(totals?.total)}</dd></div>
                  </dl>
                </footer>
              </div>

              <button type="button" onClick={() => setTenderOpen(true)} disabled={!canCharge}
                className="mt-3 flex h-14 w-full items-center justify-between rounded-xl bg-[color:var(--stall-leaf)] px-5 text-[color:var(--stall-ink)] shadow-[inset_0_-4px_0_rgba(0,0,0,0.18)] transition-[filter,transform] hover:brightness-105 active:translate-y-px disabled:bg-white/[0.06] disabled:text-[color:var(--stall-chalk-faint)] disabled:shadow-none">
                <span className="flex items-center gap-2 font-[family-name:var(--stall-font-marker)] text-[20px]">
                  {pendingSkus.size > 0 && <Loader2 className="h-4 w-4 animate-spin" />} Ring it up
                  <kbd className="rounded bg-black/15 px-1 font-mono text-[10px]">⌘↵</kbd>
                </span>
                <span className="font-[family-name:var(--stall-font-till)] text-[20px] font-bold tabular-nums">{money(totals?.total)}</span>
              </button>
            </div>
          )}
        </aside>
      </div>

      {cart && cart.lines.length > 0 && !receipt && (
        <div className="stall-board sticky bottom-0 z-10 flex items-center gap-3 border-t border-[color:var(--stall-line)] px-4 py-2.5 lg:hidden">
          <button type="button" onClick={() => document.getElementById('retail-current-sale')?.scrollIntoView({ behavior: 'smooth' })} className="min-w-0 flex-1 text-left">
            <span className="block text-[12px] text-[color:var(--stall-chalk-dim)]">{itemCount} item{itemCount === 1 ? '' : 's'}{cart.customerName ? ` · ${cart.customerName}` : ''}</span>
            <span className="font-[family-name:var(--stall-font-hand)] text-[16px] text-[color:var(--stall-chalk)] underline decoration-dotted underline-offset-2">See the roll</span>
          </button>
          <button type="button" onClick={() => setTenderOpen(true)} disabled={!canCharge} className="flex h-11 items-center gap-3 rounded-lg bg-[color:var(--stall-leaf)] px-4 text-[color:var(--stall-ink)] disabled:opacity-40">
            <span className="font-[family-name:var(--stall-font-marker)] text-[15px]">Ring it up</span>
            <span className="font-[family-name:var(--stall-font-till)] text-[15px] font-bold tabular-nums">{money(totals?.total)}</span>
          </button>
        </div>
      )}

      {tenderOpen && cart && totals && <TenderSheet cart={cart} totals={totals} onClose={() => setTenderOpen(false)} onComplete={onSaleComplete} />}
    </div>
  );
}

// ── A crate ───────────────────────────────────────────────────────────────
function Crate({ p, qty, onAdd, onPhoto }: { p: Product; qty: number; onAdd: () => void; onPhoto: (f: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const out = p.stock <= 0;
  const low = !out && p.stock <= LOW_STOCK;
  const fill = Math.max(0, Math.min(1, p.stock / FULL_CRATE));
  const initial = p.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="group relative">
      <button type="button" onClick={onAdd} data-in-cart={qty > 0} title={`${p.name} — ${money(p.price)} · ${p.stock} in stock`}
        className={cn('stall-crate flex h-[176px] w-full flex-col overflow-hidden rounded-xl text-left transition-transform active:scale-[0.97]', out && 'opacity-60')}>
        <div className="relative h-[104px] w-full overflow-hidden bg-black/25">
          {out ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="stall-stamp rounded px-2.5 py-0.5 font-[family-name:var(--stall-font-marker)] text-[18px] mix-blend-normal">SOLD OUT</span>
            </div>
          ) : p.imageDtuId ? (
            // eslint-disable-next-line @next/next/no-img-element -- owner-gated artifact stream, not a static asset
            <img src={imageUrl(p.imageDtuId)} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-[family-name:var(--stall-font-marker)] text-[44px] text-[color:var(--stall-chalk-faint)]">{initial}</div>
          )}
          {/* Stock fill: how full the crate looks is how much is on hand. */}
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/40" aria-hidden>
            <div className={cn('h-full', out ? 'bg-transparent' : low ? 'bg-[color:var(--stall-brass)]' : 'bg-[color:var(--stall-leaf)]')} style={{ width: `${fill * 100}%` }} />
          </div>
          <span className="stall-tag absolute right-2 top-2 rounded-sm py-0.5 pl-4 pr-2 font-[family-name:var(--stall-font-hand)] text-[19px] font-bold leading-tight tabular-nums">{money(p.price)}</span>
          {qty > 0 && <span key={qty} className="stall-ink-in absolute left-2 top-2 min-w-[26px] rounded-full bg-[color:var(--stall-leaf)] px-2 text-center font-[family-name:var(--stall-font-till)] text-[13px] font-bold leading-[22px] text-[color:var(--stall-ink)]">×{qty}</span>}
        </div>
        <div className="flex flex-1 flex-col justify-between px-3 py-2">
          <span className="line-clamp-2 text-[13px] leading-snug text-[color:var(--stall-chalk)]">{p.name}</span>
          <span className={cn('font-[family-name:var(--stall-font-till)] text-[11px] tabular-nums', out ? 'text-[color:var(--stall-tomato)]' : low ? 'text-[color:var(--stall-brass)]' : 'text-[color:var(--stall-chalk-faint)]')}>
            {out ? 'none left' : `${p.stock} left`}
          </span>
        </div>
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
        className="absolute bottom-[78px] right-2 rounded-full bg-black/55 p-1.5 text-[color:var(--stall-chalk)] opacity-0 transition-opacity hover:bg-black/75 focus:opacity-100 group-hover:opacity-100"
        aria-label={`${p.imageDtuId ? 'Change' : 'Add'} photo for ${p.name}`} title={p.imageDtuId ? 'Change photo' : 'Add a photo'}>
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-hidden tabIndex={-1}
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setUploading(true); await onPhoto(f); setUploading(false); }} />
    </div>
  );
}

// ── Hand-written price tag (open-price item) ──────────────────────────────
function PriceTagTile({ open, setOpen, onAdd }: { open: boolean; setOpen: (o: boolean) => void; onAdd: (name: string, price: number) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    const e = await onAdd(name.trim(), Number(price));
    setBusy(false);
    if (e) { setErr(e); return; }
    setName(''); setPrice(''); setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Hand-write a price tag (T)"
        className="flex h-[176px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[color:var(--stall-line)] text-[color:var(--stall-chalk-dim)] transition-colors hover:border-[color:var(--stall-brass)] hover:text-[color:var(--stall-chalk)]">
        <PenLine className="h-6 w-6" />
        <span className="font-[family-name:var(--stall-font-hand)] text-[22px] leading-none">Price tag</span>
        <span className="text-[11px] text-[color:var(--stall-chalk-faint)]">any item, any price · <kbd className="font-mono">T</kbd></span>
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stall-paper flex h-[176px] flex-col gap-2 rounded-xl p-3" aria-label="Hand-written price tag">
      <input autoFocus aria-label="Item" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="What is it?"
        className="h-8 w-full border-b border-dashed border-[color:var(--stall-ink-dim)] bg-transparent font-[family-name:var(--stall-font-hand)] text-[20px] text-[color:var(--stall-ink)] placeholder:text-[color:var(--stall-ink-dim)] focus:outline-none" />
      <div className="flex items-baseline gap-1">
        <span className="font-[family-name:var(--stall-font-hand)] text-[26px] text-[color:var(--stall-ink)]">$</span>
        <input aria-label="Tag price" type="number" inputMode="decimal" min={0.01} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
          className="h-9 w-full bg-transparent font-[family-name:var(--stall-font-hand)] text-[28px] font-bold text-[color:var(--stall-ink)] placeholder:text-[color:var(--stall-ink-dim)] focus:outline-none" />
      </div>
      {err && <p role="alert" className="text-[11px] text-[color:var(--stall-tomato)]">{err}</p>}
      <div className="mt-auto flex gap-1.5">
        <button type="submit" disabled={busy || !name.trim() || !(Number(price) > 0)} className="h-8 flex-1 rounded bg-[color:var(--stall-ink)] text-[12px] font-semibold text-[color:var(--stall-paper)] disabled:opacity-40">{busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Add to sale'}</button>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="h-8 rounded px-2 text-[12px] text-[color:var(--stall-ink-dim)]">Cancel</button>
      </div>
    </form>
  );
}

// ── Receipt, torn off the roll ────────────────────────────────────────────
function ReceiptPanel({ order, onNewSale, onViewOrders }: { order: Order; onNewSale: () => void; onViewOrders: () => void }) {
  const change = Number(order.change) || 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="stall-paper stall-perf-top relative flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 font-[family-name:var(--stall-font-till)]">
        <div className="px-5 text-center" role="status">
          {change > 0 ? (
            <>
              <div className="text-[12px] tracking-widest text-[color:var(--stall-ink-dim)]">CHANGE DUE</div>
              <div className="stall-ink-in text-[44px] font-bold leading-none tabular-nums">{money(change)}</div>
              <div className="mt-1 text-[12px] text-[color:var(--stall-ink-dim)]">{money(order.tendered)} on {money(order.total)}</div>
            </>
          ) : (
            <>
              <div className="stall-ink-in text-[34px] font-bold tabular-nums">{money(order.total)}</div>
              <div className="text-[12px] text-[color:var(--stall-ink-dim)]">PAID IN FULL</div>
            </>
          )}
        </div>
        {!!order.stamps?.length && (
          <div className="mt-3 flex flex-wrap justify-center gap-2 px-4" aria-label="Milestones">
            {order.stamps.map((s, i) => (
              <span key={s.id} className="stall-stamp stall-stamp-in rounded px-2.5 py-0.5 font-[family-name:var(--stall-font-marker)] text-[16px] uppercase" style={{ animationDelay: `${200 + i * 160}ms` }}>{s.label}</span>
            ))}
          </div>
        )}
        <div className="stall-dashed mx-4 mt-4" />
        <div className="px-5 py-2 text-[12px]">
          {order.customerName && <div className="mb-1.5">CUSTOMER: {order.customerName.toUpperCase()}</div>}
          <ul className="space-y-0.5">
            {order.lines.map((l) => (
              <li key={l.sku} className="flex justify-between gap-2 tabular-nums"><span className="truncate">{l.qty} × {l.name.toUpperCase()}</span><span>{money(l.qty * l.unitPrice)}</span></li>
            ))}
          </ul>
          <div className="stall-dashed mt-2 space-y-0.5 pt-2 tabular-nums text-[color:var(--stall-ink-dim)]">
            {(order.tenders || []).map((t, i) => <div key={i} className="flex justify-between"><span>{tenderLabel(t).toUpperCase()}</span><span>{money(t.amount)}</span></div>)}
          </div>
          <div className="mt-3 text-center text-[11px] text-[color:var(--stall-ink-dim)]">{order.number} · {new Date(order.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
        <div className="stall-torn-bottom h-3 w-full bg-[color:var(--stall-paper)]" aria-hidden />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onNewSale} autoFocus className="h-12 flex-1 rounded-xl bg-[color:var(--stall-brass)] font-[family-name:var(--stall-font-marker)] text-[18px] text-[color:var(--stall-ink)] hover:brightness-110">
          Next customer <kbd className="ml-1 rounded bg-black/10 px-1 font-mono text-[10px]">N</kbd>
        </button>
        <button type="button" onClick={onViewOrders} className="h-12 rounded-xl px-3 text-[13px] text-[color:var(--stall-chalk-dim)] hover:bg-white/5">Orders</button>
        <SaveAsDtuButton
          compact
          apiSource="retail-pos"
          title={`Receipt ${order.number || order.id} — ${money(order.total)}`}
          content={`${order.number || order.id} · ${order.completedAt}\n${order.lines.map((l) => `${l.qty} × ${l.name} @ ${money(l.unitPrice)}`).join('\n')}\nTotal ${money(order.total)} · ${(order.tenders || []).map((t) => `${tenderLabel(t)} ${money(t.amount)}`).join(' + ')}${change > 0 ? ` · change ${money(change)}` : ''}${order.stamps?.length ? `\nStamps: ${order.stamps.map((s) => s.label).join(', ')}` : ''}`}
          extraTags={['retail', 'pos', 'receipt']}
          rawData={order}
        />
      </div>
    </div>
  );
}

export default Register;
