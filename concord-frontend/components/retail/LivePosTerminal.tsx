'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShoppingCart, Plus, Loader2, CreditCard, AlertTriangle, Receipt } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Product { sku: string; name: string; price: number; stock: number }
interface CartLine { sku: string; name: string; unitPrice: number; qty: number }
interface Cart { id: string; lines: CartLine[]; discountPercent: number }
interface Order { id: string; total: number; lines: CartLine[]; tenders?: { kind: string; amount: number }[]; closedAt: string; stripe?: { paymentIntentId?: string } }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('retail', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function LivePosTerminal() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [total, setTotal] = useState<{ subtotal: number; tax: number; total: number } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stripePending, setStripePending] = useState(false);
  const [stripeIntent, setStripeIntent] = useState<{ clientSecret?: string; paymentIntentId?: string } | null>(null);

  const refresh = useMutation({
    mutationFn: async () => {
      const [p, o, ls] = await Promise.all([
        callMacro<{ products: Product[] }>('product-list', {}),
        callMacro<{ orders: Order[] }>('orders-list', {}),
        callMacro<{ lowStock: Product[] }>('low-stock', { threshold: 5 }),
      ]);
      if (p.ok && p.result) setProducts(p.result.products);
      if (o.ok && o.result) setOrders(o.result.orders);
      if (ls.ok && ls.result) setLowStock(ls.result.lowStock);
    },
  });

  useEffect(() => {
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCart = useMutation({
    mutationFn: async () => callMacro<{ cart: Cart }>('cart-open', {}),
    onSuccess: (env) => { if (env.ok && env.result) { setCart(env.result.cart); setTotal(null); setStripeIntent(null); setError(null); } else setError(env.error || 'failed'); },
  });

  const addLine = async (sku: string) => {
    if (!cart) { await openCart.mutateAsync(); }
    const cartId = cart?.id;
    if (!cartId) return;
    const env = await callMacro<{ cart: Cart }>('cart-add-line', { cartId, sku, qty: 1 });
    if (env.ok && env.result) {
      setCart(env.result.cart);
      const t = await callMacro<{ subtotal: number; tax: number; total: number }>('cart-total', { cartId, taxRate: 8.875 });
      if (t.ok && t.result) setTotal({ subtotal: t.result.subtotal, tax: t.result.tax, total: t.result.total });
    } else setError(env.error || 'add failed');
  };

  const tenderCash = async () => {
    if (!cart || !total) return;
    const env = await callMacro<{ order: Order }>('cart-tender', { cartId: cart.id, taxRate: 8.875, tenders: [{ kind: 'cash', amount: total.total }] });
    if (env.ok && env.result) {
      setCart(null); setTotal(null);
      refresh.mutate();
    } else setError(env.error || 'tender failed');
  };

  const createStripeIntent = async () => {
    if (!cart) return;
    setStripePending(true);
    setError(null);
    const env = await callMacro<{ clientSecret: string; paymentIntentId: string }>('cart-create-payment-intent', { cartId: cart.id, taxRate: 8.875 });
    setStripePending(false);
    if (env.ok && env.result) setStripeIntent(env.result);
    else setError(env.error || 'Stripe unavailable');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Live POS Terminal</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">stripe terminal · real backend</span>
        </div>
        <button onClick={() => openCart.mutate()} disabled={openCart.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {openCart.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
          New cart
        </button>
      </header>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {lowStock.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
          <div>
            <div className="font-semibold">Low stock — restock soon</div>
            <div className="font-mono text-amber-300/80">{lowStock.slice(0, 6).map((p) => `${p.sku}(${p.stock})`).join(' · ')}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-200">
            <span>Catalog ({products.length})</span>
            <span className="text-[10px] text-zinc-500">click to add</span>
          </div>
          {products.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No products yet — add some via the workbench above.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {products.map((p) => (
                <button key={p.sku} onClick={() => addLine(p.sku)} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-left hover:border-cyan-500/30">
                  <div className="line-clamp-1 text-[11px] text-zinc-200">{p.name}</div>
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <span className="font-mono text-xs text-cyan-300">${p.price.toFixed(2)}</span>
                    <span className="text-[10px] text-zinc-500">stock {p.stock}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-200">
            <span>Cart {cart ? `#${cart.id.slice(-6)}` : ''}</span>
            {cart && <span className="text-[10px] text-zinc-500">{cart.lines.length} line{cart.lines.length === 1 ? '' : 's'}</span>}
          </div>
          {!cart ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">Start a new cart to ring up an order.</div>
          ) : (
            <>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {cart.lines.map((l) => (
                  <div key={l.sku} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 p-1.5 text-[11px]">
                    <div className="flex-1">
                      <div className="line-clamp-1 text-zinc-200">{l.name}</div>
                      <div className="font-mono text-[10px] text-zinc-500">{l.qty} × ${l.unitPrice.toFixed(2)}</div>
                    </div>
                    <span className="font-mono text-xs text-cyan-300">${(l.qty * l.unitPrice).toFixed(2)}</span>
                  </div>
                ))}
                {cart.lines.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">Tap a catalog tile to add it.</div>}
              </div>
              {total && (
                <div className="mt-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2 text-[11px]">
                  <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="font-mono">${total.subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>Tax (8.875%)</span><span className="font-mono">${total.tax.toFixed(2)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-cyan-500/20 pt-1 text-sm font-semibold text-cyan-200"><span>Total</span><span className="font-mono">${total.total.toFixed(2)}</span></div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={tenderCash} disabled={!total || cart.lines.length === 0} className="inline-flex items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[11px] text-green-300 hover:bg-green-500/20 disabled:opacity-50">
                  <Plus className="h-3 w-3" /> Cash tender
                </button>
                <button onClick={createStripeIntent} disabled={!total || stripePending} className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 hover:bg-violet-500/20 disabled:opacity-50">
                  {stripePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />} Card via Stripe
                </button>
              </div>
              {stripeIntent && (
                <div className="mt-2 rounded border border-violet-500/20 bg-violet-500/5 p-2 font-mono text-[10px] text-violet-200">
                  PaymentIntent {stripeIntent.paymentIntentId?.slice(0, 18)}…<br />
                  Use Stripe.js Elements/Terminal SDK on the device with the returned clientSecret.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs font-semibold text-zinc-200">
            <Receipt className="h-3.5 w-3.5 text-cyan-400" /> Recent orders ({orders.length})
          </div>
          {orders.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="retail-pos"
              title={`POS snapshot — ${orders.length} order${orders.length === 1 ? '' : 's'}`}
              content={`Orders ledger (latest ${Math.min(orders.length, 10)}):\n${orders.slice(0, 10).map((o) => `  #${o.id.slice(-6)} $${o.total?.toFixed(2)} ${o.tenders?.map(t => t.kind).join('+') || 'pending'} ${o.closedAt}`).join('\n')}\n\nLow stock: ${lowStock.map(p => `${p.sku}(${p.stock})`).join(', ') || 'none'}`}
              extraTags={['retail', 'pos', 'orders']}
              rawData={{ orders: orders.slice(0, 50), lowStock, productsCount: products.length }}
            />
          )}
        </div>
        {orders.length === 0 ? (
          <div className="text-[11px] text-zinc-500">No orders yet — ring one up to see it here.</div>
        ) : (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 max-h-44 overflow-y-auto">
            {orders.slice(0, 12).map((o) => (
              <div key={o.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[10px]">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-cyan-300">#{o.id.slice(-6)}</span>
                  <span className="font-mono text-zinc-200">${o.total?.toFixed(2)}</span>
                </div>
                <div className="text-zinc-500">{o.lines.length} line{o.lines.length === 1 ? '' : 's'} · {o.tenders?.map(t => t.kind).join(' + ') || '—'}</div>
                {o.stripe?.paymentIntentId && <div className="font-mono text-violet-300/70">{o.stripe.paymentIntentId.slice(0, 18)}…</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
