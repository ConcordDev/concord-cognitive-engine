'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ShoppingCart, Package, Receipt, AlertTriangle, Plus, Trash2, Save, DollarSign, CreditCard } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { StripePaymentForm } from '@/components/payment/StripePaymentForm';

export interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  barcode: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'pos' | 'catalog' | 'orders' | 'lowstock';

export function RetailWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('pos');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[660px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-rose-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-rose-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-semibold text-gray-200">Retail Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'pos',      label: 'POS',         icon: ShoppingCart },
          { id: 'catalog',  label: 'Catalog',     icon: Package },
          { id: 'orders',   label: 'Orders',      icon: Receipt },
          { id: 'lowstock', label: 'Low stock',   icon: AlertTriangle },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-rose-500/15 text-rose-200 border border-rose-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'pos' && <POSTab />}
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'lowstock' && <LowStockTab />}
      </div>
    </div>
  );
}

function POSTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cartId, setCartId] = useState<string | null>(null);
  const [cart, setCart] = useState<{ lines: { sku: string; name: string; unitPrice: number; qty: number }[] } | null>(null);
  const [totals, setTotals] = useState<{ subtotal: number; tax: number; total: number; itemCount: number } | null>(null);
  const [tenderAmount, setTenderAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [cardIntent, setCardIntent] = useState<{ clientSecret: string; paymentIntentId: string; total: number } | null>(null);

  const refreshProducts = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'retail', action: 'product-list', input: {} });
      setProducts(((r.data as { result?: { products?: Product[] } }).result?.products) || []);
    } catch (e) { console.error(e); }
  }, []);

  const openCart = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'retail', action: 'cart-open', input: {} });
      const c = (r.data as { result?: { cart?: { id: string; lines: [] } } }).result?.cart;
      if (c) {
        setCartId(c.id);
        setCart({ lines: c.lines });
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { refreshProducts(); openCart(); }, [refreshProducts, openCart]);

  const addToCart = async (sku: string) => {
    if (!cartId) return;
    try {
      const r = await lensRun({ domain: 'retail', action: 'cart-add-line', input: { cartId, sku, qty: 1 } });
      const c = (r.data as { result?: { cart?: typeof cart } }).result?.cart;
      if (c) setCart(c);
      computeTotal();
    } catch (e) { console.error(e); }
  };

  const computeTotal = async () => {
    if (!cartId) return;
    try {
      const r = await lensRun({ domain: 'retail', action: 'cart-total', input: { cartId, taxRate: 8 } });
      setTotals(((r.data as { result?: typeof totals }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { computeTotal(); }, [cart]);  // eslint-disable-line react-hooks/exhaustive-deps

  const tender = async () => {
    if (!cartId) return;
    try {
      const r = await lensRun({
        domain: 'retail', action: 'cart-tender',
        input: { cartId, taxRate: 8, tenders: [{ kind: 'cash', amount: Number(tenderAmount) }] },
      });
      const data = r.data as { ok?: boolean; error?: string; result?: { order?: { number: string; change: number } } };
      if (data.ok) {
        setMessage(`✓ ${data.result?.order?.number} · change $${data.result?.order?.change}`);
        await openCart();
        setTenderAmount('');
      } else {
        setMessage(data.error || 'Failed');
      }
    } catch (e) { setMessage((e as Error).message); }
  };

  const tenderWithCard = async () => {
    if (!cartId) return;
    try {
      const r = await lensRun({
        domain: 'retail', action: 'cart-create-payment-intent',
        input: { cartId, taxRate: 8 },
      });
      const data = r.data as { ok?: boolean; error?: string; result?: { clientSecret: string; paymentIntentId: string; total: number } };
      if (data.ok && data.result) {
        setCardIntent({ clientSecret: data.result.clientSecret, paymentIntentId: data.result.paymentIntentId, total: data.result.total });
      } else {
        setMessage(data.error || 'Card payment unavailable');
      }
    } catch (e) { setMessage((e as Error).message); }
  };

  const onCardSuccess = async ({ paymentIntentId }: { paymentIntentId: string }) => {
    if (!cartId) return;
    try {
      const r = await lensRun({
        domain: 'retail', action: 'cart-confirm-paid-with-intent',
        input: { cartId, paymentIntentId },
      });
      const data = r.data as { ok?: boolean; error?: string; result?: { order?: { number: string } } };
      if (data.ok) {
        setMessage(`✓ Card payment captured · ${data.result?.order?.number}`);
        await openCart();
        setCardIntent(null);
      } else {
        setMessage(data.error || 'Capture failed (payment may need manual reconcile)');
      }
    } catch (e) { setMessage((e as Error).message); }
  };

  return (
    <div className="grid grid-cols-2 gap-2 p-3 h-full">
      <div className="space-y-1 overflow-y-auto">
        <p className="text-[10px] uppercase text-gray-400 mb-1">Tap to add</p>
        {products.length === 0 ? <p className="text-xs text-gray-400">No products. Add some in Catalog tab.</p> :
          products.map((p) => (
            <button key={p.sku} type="button" onClick={() => addToCart(p.sku)}
              className="w-full text-left rounded border border-white/10 bg-black/20 hover:bg-rose-500/10 p-2">
              <p className="text-sm text-gray-100">{p.name}</p>
              <div className="flex justify-between text-[11px]">
                <span className="font-mono text-rose-300">${p.price}</span>
                <span className="text-gray-400">{p.stock} in stock</span>
              </div>
            </button>
          ))
        }
      </div>

      <div className="border-l border-white/10 pl-3 flex flex-col">
        <p className="text-[10px] uppercase text-gray-400 mb-1">Cart</p>
        <div className="flex-1 overflow-y-auto">
          {cart?.lines.length === 0 ? <p className="text-xs text-gray-400">Empty.</p> :
            cart?.lines.map((l) => (
              <div key={l.sku} className="flex justify-between text-xs py-1 border-b border-white/5">
                <span className="text-gray-200">{l.qty}× {l.name}</span>
                <span className="font-mono text-gray-300">${(l.qty * l.unitPrice).toFixed(2)}</span>
              </div>
            ))
          }
        </div>
        {totals && (
          <div className="mt-2 border-t border-white/10 pt-2 text-xs space-y-0.5 font-mono">
            <div className="flex justify-between"><span className="text-gray-400">Subtotal</span><span>${totals.subtotal}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Tax (8%)</span><span>${totals.tax}</span></div>
            <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="text-rose-300">${totals.total}</span></div>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <input type="number" value={tenderAmount} onChange={(e) => setTenderAmount(e.target.value)}
            placeholder="Tender" className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          <button type="button" onClick={tender} disabled={!tenderAmount}
            className="px-3 py-1 rounded-md border border-rose-500/40 bg-rose-500/15 text-xs text-rose-100 disabled:opacity-40">
            <DollarSign className="w-3 h-3 inline" /> Cash
          </button>
          <button type="button" onClick={tenderWithCard} disabled={!totals || totals.total <= 0}
            className="px-3 py-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100 disabled:opacity-40">
            <CreditCard className="w-3 h-3 inline" /> Card
          </button>
        </div>
        {message && <p className="text-[11px] text-emerald-300 mt-2">{message}</p>}
        {cardIntent && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <StripePaymentForm
              clientSecret={cardIntent.clientSecret}
              amountUsd={cardIntent.total}
              description="Cart checkout"
              onSuccess={onCardSuccess}
              onCancel={() => setCardIntent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ sku: '', name: '', price: 0, stock: 0, category: '', barcode: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'retail', action: 'product-list', input: {} });
      setProducts(((r.data as { result?: { products?: Product[] } }).result?.products) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'retail', action: 'product-upsert', input: draft });
      setCreating(false); setDraft({ sku: '', name: '', price: 0, stock: 0, category: '', barcode: '' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (sku: string) => {
    try {
      await lensRun({ domain: 'retail', action: 'product-delete', input: { sku } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200">
        <Plus className="w-3 h-3" /> Add product
      </button>
      {creating && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
              placeholder="SKU" maxLength={32}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Product name"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={draft.price} step="0.01" onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
              placeholder="Price" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })}
              placeholder="Stock" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="text" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Category" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          </div>
          <button type="button" onClick={save} disabled={!draft.sku.trim() || !draft.name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-rose-500/40 bg-rose-500/15 text-xs text-rose-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        products.map((p) => (
          <div key={p.sku} className="rounded border border-white/10 bg-black/20 p-3 flex items-center justify-between group">
            <div>
              <p className="text-sm text-gray-100">{p.name} <code className="text-[10px] text-gray-400 ml-2">{p.sku}</code></p>
              <p className="text-[11px] text-gray-400">${p.price} · {p.stock} in stock · {p.category || 'uncategorized'}</p>
            </div>
            <button type="button" onClick={() => remove(p.sku)} aria-label="Delete product"
              className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))
      }
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<{ id: string; number: string; total: number; itemCount?: number; completedAt: string; lines: { sku: string; name: string; qty: number }[] }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'retail', action: 'orders-list', input: {} });
        setOrders(((r.data as { result?: { orders?: typeof orders } }).result?.orders) || []);
      } catch (e) { console.error(e); }
    })();
  }, []);

  return (
    <div className="p-3 space-y-2">
      {orders.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No orders yet. Use POS to ring one up.</p> :
        orders.map((o) => (
          <div key={o.id} className="rounded border border-white/10 bg-black/20 p-3">
            <div className="flex justify-between">
              <span className="font-mono text-rose-300">{o.number}</span>
              <span className="font-mono text-gray-100">${o.total}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{new Date(o.completedAt).toLocaleString()}</p>
            <p className="text-[11px] text-gray-400 mt-1">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</p>
          </div>
        ))
      }
    </div>
  );
}

function LowStockTab() {
  const [items, setItems] = useState<Product[]>([]);
  const [threshold] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'retail', action: 'low-stock', input: { threshold } });
        setItems(((r.data as { result?: { lowStock?: Product[] } }).result?.lowStock) || []);
      } catch (e) { console.error(e); }
    })();
  }, [threshold]);

  return (
    <div className="p-3 space-y-2">
      <p className="text-[11px] text-gray-400">Products with stock ≤ {threshold}</p>
      {items.length === 0 ? <p className="text-center text-xs text-emerald-300 py-8">✓ All stock above threshold.</p> :
        items.map((p) => (
          <div key={p.sku} className="rounded border border-amber-500/20 bg-amber-500/5 p-3 flex justify-between">
            <div>
              <p className="text-sm text-gray-100">{p.name}</p>
              <p className="text-[11px] text-gray-400">{p.sku}</p>
            </div>
            <span className="font-mono text-amber-300 text-lg">{p.stock}</span>
          </div>
        ))
      }
    </div>
  );
}

export default RetailWorkbench;
