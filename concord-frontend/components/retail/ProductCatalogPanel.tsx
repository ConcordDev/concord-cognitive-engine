'use client';

/**
 * ProductCatalogPanel — the real product-management surface, extended for
 * the fourth and final Wave-4 "Genuinely missing, deferred" retail item
 * (docs/lens-specs/retail-capability-map.md "Richer product schema":
 * "variants (size/color/style sub-SKUs), price-change history, supplier +
 * lead-time fields, daily-sales-rate/turnover-rate for ABC-analysis-style
 * inventory forecasting").
 *
 * This REPLACES RetailWorkbench's old thin `CatalogTab` (name/price/stock/
 * category/barcode only) rather than standing beside it as a second,
 * competing catalog surface — same coherent single-catalog discipline the
 * capability-map audit required. Every field here reads/writes through the
 * real `retail.product-*` / `retail.product-variant-*` macros:
 *   - supplier / lead-time days / daily sales rate: real optional catalog
 *     fields on `product-upsert`, non-destructively preserved when a caller
 *     (like this panel's own inline stock/price-only edits) omits them.
 *   - turnover rate + ABC class: SERVER-COMPUTED (never derived client-side)
 *     — turnover rate ships inline on the product record, ABC class ships
 *     inline on `product-list` (it needs the whole catalog to rank against,
 *     so a lone product record can't self-classify).
 *   - price history: SERVER-COMPUTED audit trail, read-only here — there is
 *     no "edit price history" affordance anywhere in this panel by design.
 *   - variants: genuine sub-SKU records via `product-variant-*`, listed
 *     underneath their parent product, with their own add/edit/remove.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Trash2, Save, Pencil, X, History, Layers, ChevronDown, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface PriceHistoryEntry { oldPrice: number | null; newPrice: number; changedAt: string }
export type AbcClass = 'A' | 'B' | 'C' | null;

export interface CatalogProduct {
  sku: string; name: string; price: number; stock: number; category: string; barcode: string;
  supplier: string; leadTimeDays: number | null; dailySalesRate: number; turnoverRate: number | null;
  priceHistory: PriceHistoryEntry[]; abcClass: AbcClass;
  createdAt: string; updatedAt: string;
}

export interface ProductVariant {
  sku: string; parentSku: string; size: string; color: string; style: string;
  stock: number; priceDelta: number; price: number; createdAt: string; updatedAt: string;
}

interface AbcSummary { A: number; B: number; C: number; unclassified: number }

const emptyDraft = {
  sku: '', name: '', price: '', stock: '', category: '', barcode: '',
  supplier: '', leadTimeDays: '', dailySalesRate: '',
};
type Draft = typeof emptyDraft;

const ABC_BADGE: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  B: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  C: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProductCatalogPanel() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [abcSummary, setAbcSummary] = useState<AbcSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [variantsBySku, setVariantsBySku] = useState<Record<string, ProductVariant[]>>({});
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantDraft, setVariantDraft] = useState({ sku: '', size: '', color: '', style: '', stock: '', priceDelta: '' });
  const [variantError, setVariantError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun({ domain: 'retail', action: 'product-list', input: {} });
      const data = r.data as { ok?: boolean; error?: string; result?: { products?: CatalogProduct[]; abcSummary?: AbcSummary } };
      if (data.ok === false) { setError(data.error || 'Failed to load catalog'); setProducts([]); }
      else {
        setProducts(data.result?.products || []);
        setAbcSummary(data.result?.abcSummary || null);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startCreate = () => {
    setDraft(emptyDraft);
    setEditingSku(null);
    setSaveError(null);
    setFormOpen(true);
  };

  const startEdit = (p: CatalogProduct) => {
    setDraft({
      sku: p.sku, name: p.name, price: String(p.price), stock: String(p.stock),
      category: p.category, barcode: p.barcode, supplier: p.supplier,
      leadTimeDays: p.leadTimeDays === null ? '' : String(p.leadTimeDays),
      dailySalesRate: String(p.dailySalesRate),
    });
    setEditingSku(p.sku);
    setSaveError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const input: Record<string, unknown> = {
        sku: draft.sku, name: draft.name, price: Number(draft.price), stock: Number(draft.stock),
        category: draft.category, barcode: draft.barcode,
        supplier: draft.supplier,
        leadTimeDays: draft.leadTimeDays === '' ? null : Number(draft.leadTimeDays),
        dailySalesRate: draft.dailySalesRate === '' ? 0 : Number(draft.dailySalesRate),
      };
      const r = await lensRun({ domain: 'retail', action: 'product-upsert', input });
      const data = r.data as { ok?: boolean; error?: string };
      if (data.ok === false) { setSaveError(data.error || 'Save failed'); return; }
      setFormOpen(false);
      setEditingSku(null);
      setDraft(emptyDraft);
      await refresh();
    } catch (e) { setSaveError((e as Error).message); }
    finally { setSaving(false); }
  };

  const remove = async (sku: string) => {
    try {
      await lensRun({ domain: 'retail', action: 'product-delete', input: { sku } });
      if (expandedSku === sku) setExpandedSku(null);
      await refresh();
    } catch (e) { console.error(e); }
  };

  const toggleExpand = async (sku: string) => {
    if (expandedSku === sku) { setExpandedSku(null); return; }
    setExpandedSku(sku);
    setVariantError(null);
    setVariantDraft({ sku: '', size: '', color: '', style: '', stock: '', priceDelta: '' });
    if (!variantsBySku[sku]) {
      setVariantLoading(true);
      try {
        const r = await lensRun({ domain: 'retail', action: 'product-variant-list', input: { parentSku: sku } });
        const data = r.data as { result?: { variants?: ProductVariant[] } };
        setVariantsBySku((prev) => ({ ...prev, [sku]: data.result?.variants || [] }));
      } catch (e) { console.error(e); }
      finally { setVariantLoading(false); }
    }
  };

  const addVariant = async (parentSku: string) => {
    setVariantError(null);
    try {
      const r = await lensRun({
        domain: 'retail', action: 'product-variant-upsert',
        input: {
          sku: variantDraft.sku, parentSku,
          size: variantDraft.size, color: variantDraft.color, style: variantDraft.style,
          stock: Number(variantDraft.stock || 0),
          priceDelta: Number(variantDraft.priceDelta || 0),
        },
      });
      const data = r.data as { ok?: boolean; error?: string; result?: { variant?: ProductVariant } };
      if (data.ok === false) { setVariantError(data.error || 'Failed to add variant'); return; }
      const listR = await lensRun({ domain: 'retail', action: 'product-variant-list', input: { parentSku } });
      const listData = listR.data as { result?: { variants?: ProductVariant[] } };
      setVariantsBySku((prev) => ({ ...prev, [parentSku]: listData.result?.variants || [] }));
      setVariantDraft({ sku: '', size: '', color: '', style: '', stock: '', priceDelta: '' });
    } catch (e) { setVariantError((e as Error).message); }
  };

  const removeVariant = async (parentSku: string, sku: string) => {
    try {
      await lensRun({ domain: 'retail', action: 'product-variant-delete', input: { sku } });
      const listR = await lensRun({ domain: 'retail', action: 'product-variant-list', input: { parentSku } });
      const listData = listR.data as { result?: { variants?: ProductVariant[] } };
      setVariantsBySku((prev) => ({ ...prev, [parentSku]: listData.result?.variants || [] }));
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={startCreate}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200">
          <Plus className="w-3 h-3" /> Add product
        </button>
        {abcSummary && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono" data-testid="abc-summary">
            <span className={cn('px-1.5 py-0.5 rounded border', ABC_BADGE.A)}>A {abcSummary.A}</span>
            <span className={cn('px-1.5 py-0.5 rounded border', ABC_BADGE.B)}>B {abcSummary.B}</span>
            <span className={cn('px-1.5 py-0.5 rounded border', ABC_BADGE.C)}>C {abcSummary.C}</span>
            {abcSummary.unclassified > 0 && (
              <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-500">
                {abcSummary.unclassified} unranked
              </span>
            )}
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-[11px] text-rose-400">{error}</p>}

      {formOpen && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase text-gray-400">{editingSku ? `Edit ${editingSku}` : 'New product'}</p>
            <button type="button" onClick={() => setFormOpen(false)} aria-label="Cancel" className="text-gray-500 hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={draft.sku} disabled={Boolean(editingSku)}
              onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
              placeholder="SKU" maxLength={32}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono disabled:opacity-50" />
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Product name"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={draft.price} step="0.01" onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="Price" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
              placeholder="Stock" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="text" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Category" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          </div>
          <p className="text-[10px] uppercase text-gray-500 pt-1">Sourcing &amp; forecasting</p>
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              placeholder="Supplier" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
            <input type="number" value={draft.leadTimeDays} onChange={(e) => setDraft({ ...draft, leadTimeDays: e.target.value })}
              placeholder="Lead time (days)" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.dailySalesRate} step="0.01" onChange={(e) => setDraft({ ...draft, dailySalesRate: e.target.value })}
              placeholder="Daily sales rate" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </div>
          {saveError && <p role="alert" className="text-[11px] text-rose-400">{saveError}</p>}
          <button type="button" onClick={save} disabled={!draft.sku.trim() || !draft.name.trim() || saving}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-rose-500/40 bg-rose-500/15 text-xs text-rose-100 disabled:opacity-40">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
      ) : products.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No products yet. Add one above.</p>
      ) : (
        products.map((p) => {
          const expanded = expandedSku === p.sku;
          const variants = variantsBySku[p.sku] || [];
          return (
            <div key={p.sku} className="rounded border border-white/10 bg-black/20 group">
              <div className="p-3 flex items-center justify-between">
                <button type="button" onClick={() => toggleExpand(p.sku)} className="flex-1 text-left flex items-center gap-2">
                  {expanded ? <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />}
                  <div>
                    <p className="text-sm text-gray-100 flex items-center gap-2">
                      {p.name} <code className="text-[10px] text-gray-400">{p.sku}</code>
                      {p.abcClass && (
                        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono', ABC_BADGE[p.abcClass])} title="ABC inventory class (by revenue contribution)">
                          {p.abcClass}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      ${p.price} · {p.stock} in stock · {p.category || 'uncategorized'}
                      {p.supplier && <> · {p.supplier}</>}
                      {p.leadTimeDays !== null && <> · {p.leadTimeDays}d lead</>}
                      {p.turnoverRate !== null && <> · turnover {p.turnoverRate}×/yr</>}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button type="button" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}
                    className="p-1 text-gray-600 hover:text-rose-300"><Pencil className="w-3 h-3" /></button>
                  <button type="button" onClick={() => remove(p.sku)} aria-label={`Delete ${p.name}`}
                    className="p-1 text-gray-600 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-white/10 p-3 space-y-3">
                  <div>
                    <p className="text-[10px] uppercase text-gray-400 flex items-center gap-1 mb-1"><History className="w-3 h-3" /> Price history</p>
                    {p.priceHistory.length === 0 ? (
                      <p className="text-[11px] text-gray-500">No price changes recorded.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {p.priceHistory.slice().reverse().map((h, i) => (
                          <li key={i} className="text-[11px] text-gray-400 font-mono flex items-center gap-2">
                            <span className="text-gray-600">{new Date(h.changedAt).toLocaleDateString()}</span>
                            {h.oldPrice === null ? <span>{money(h.newPrice)} (initial)</span> : <span>{money(h.oldPrice)} → {money(h.newPrice)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-[10px] uppercase text-gray-400 flex items-center gap-1 mb-1"><Layers className="w-3 h-3" /> Variants</p>
                    {variantLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
                    ) : variants.length === 0 ? (
                      <p className="text-[11px] text-gray-500">No variants.</p>
                    ) : (
                      <ul className="space-y-1 mb-2">
                        {variants.map((v) => (
                          <li key={v.sku} className="flex items-center justify-between text-[11px] text-gray-300 bg-black/20 rounded px-2 py-1">
                            <span>
                              <code className="text-gray-400">{v.sku}</code>{' '}
                              {[v.size, v.color, v.style].filter(Boolean).join(' / ')} · {v.stock} in stock · {money(v.price)}
                            </span>
                            <button type="button" onClick={() => removeVariant(p.sku, v.sku)} aria-label={`Remove variant ${v.sku}`}
                              className="text-gray-600 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="grid grid-cols-6 gap-1">
                      <input type="text" value={variantDraft.sku} onChange={(e) => setVariantDraft({ ...variantDraft, sku: e.target.value })}
                        placeholder="Variant SKU" className="col-span-2 px-1.5 py-1 text-[10px] bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                      <input type="text" value={variantDraft.size} onChange={(e) => setVariantDraft({ ...variantDraft, size: e.target.value })}
                        placeholder="Size" className="px-1.5 py-1 text-[10px] bg-black/40 border border-white/10 rounded text-gray-100" />
                      <input type="text" value={variantDraft.color} onChange={(e) => setVariantDraft({ ...variantDraft, color: e.target.value })}
                        placeholder="Color" className="px-1.5 py-1 text-[10px] bg-black/40 border border-white/10 rounded text-gray-100" />
                      <input type="number" value={variantDraft.stock} onChange={(e) => setVariantDraft({ ...variantDraft, stock: e.target.value })}
                        placeholder="Stock" className="px-1.5 py-1 text-[10px] bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                      <input type="number" value={variantDraft.priceDelta} onChange={(e) => setVariantDraft({ ...variantDraft, priceDelta: e.target.value })}
                        placeholder="Δ price" className="px-1.5 py-1 text-[10px] bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                    </div>
                    {variantError && <p role="alert" className="text-[11px] text-rose-400 mt-1">{variantError}</p>}
                    <button type="button" onClick={() => addVariant(p.sku)} disabled={!variantDraft.sku.trim()}
                      className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200 disabled:opacity-40">
                      <Plus className="w-3 h-3" /> Add variant
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export default ProductCatalogPanel;
