'use client';

/**
 * VariationsPanel — per-listing size/color/material options.
 *
 * Pick a listing, then add variation rows (option name + value +
 * per-variant price + stock). Saves the whole set in one shot via the
 * `variations-set` macro. No seed data — variations start empty until
 * the seller adds them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Plus, Trash2, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Listing {
  id: string;
  title: string;
}

interface Variation {
  id: string;
  sku: string;
  optionName: string;
  optionValue: string;
  priceUsd: number;
  stockQty: number | null;
}

interface DraftVariation {
  id?: string;
  sku: string;
  optionName: string;
  optionValue: string;
  priceUsd: string;
  stockQty: string;
}

function toDraft(v: Variation): DraftVariation {
  return {
    id: v.id,
    sku: v.sku,
    optionName: v.optionName,
    optionValue: v.optionValue,
    priceUsd: String(v.priceUsd),
    stockQty: v.stockQty === null ? '' : String(v.stockQty),
  };
}

export function VariationsPanel() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState<DraftVariation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    lensRun('marketplace', 'listings-list', { status: 'all' })
      .then((r) => {
        if (r.data?.ok) {
          setListings(
            ((r.data.result?.listings || []) as Array<{ id: string; title: string }>).map((l) => ({
              id: l.id,
              title: l.title,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const loadVariations = useCallback(async (listingId: string) => {
    if (!listingId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const r = await lensRun('marketplace', 'variations-list', { listingId });
      if (r.data?.ok) {
        setRows(((r.data.result?.variations || []) as Variation[]).map(toDraft));
      }
    } catch (e) {
      console.error('[Variations] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVariations(selected);
  }, [selected, loadVariations]);

  function addRow() {
    setRows((r) => [
      ...r,
      { sku: '', optionName: 'Size', optionValue: '', priceUsd: '', stockQty: '' },
    ]);
  }

  function updateRow(i: number, patch: Partial<DraftVariation>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const variations = rows
        .filter((r) => r.optionValue.trim())
        .map((r) => ({
          id: r.id,
          sku: r.sku.trim() || undefined,
          optionName: r.optionName.trim() || 'Option',
          optionValue: r.optionValue.trim(),
          priceUsd: Number(r.priceUsd) || 0,
          stockQty: r.stockQty === '' ? null : Number(r.stockQty),
        }));
      const r = await lensRun('marketplace', 'variations-set', { listingId: selected, variations });
      if (r.data?.ok === false) {
        setError(r.data.error || 'Could not save variations');
        return;
      }
      setRows(((r.data?.result?.variations || []) as Variation[]).map(toDraft));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error('[Variations] save failed', e);
      setError('Could not save variations');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Layers className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Listing variations</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="ml-auto text-xs px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white max-w-[14rem]"
          >
            <option value="">Select a listing…</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </header>

        {!selected ? (
          <div className="px-3 py-12 text-center text-xs text-gray-500">
            <Layers className="w-6 h-6 mx-auto mb-2 opacity-30" />
            Pick a listing to manage its size / color / material options.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {rows.length === 0 && (
              <div className="text-xs text-gray-500 py-4 text-center">
                No variations yet. Add option rows below.
              </div>
            )}
            {rows.length > 0 && (
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase text-gray-500 px-1">
                <span className="col-span-3">Option</span>
                <span className="col-span-3">Value</span>
                <span className="col-span-2">SKU</span>
                <span className="col-span-2">Price $</span>
                <span className="col-span-1">Stock</span>
                <span className="col-span-1" />
              </div>
            )}
            {rows.map((row, i) => (
              <div key={row.id || `new-${i}`} className="grid grid-cols-12 gap-2">
                <input
                  value={row.optionName}
                  onChange={(e) => updateRow(i, { optionName: e.target.value })}
                  placeholder="Size"
                  className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <input
                  value={row.optionValue}
                  onChange={(e) => updateRow(i, { optionValue: e.target.value })}
                  placeholder="Large"
                  className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <input
                  value={row.sku}
                  onChange={(e) => updateRow(i, { sku: e.target.value })}
                  placeholder="auto"
                  className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <input
                  type="number"
                  step="0.01"
                  value={row.priceUsd}
                  onChange={(e) => updateRow(i, { priceUsd: e.target.value })}
                  placeholder="0.00"
                  className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <input
                  type="number"
                  value={row.stockQty}
                  onChange={(e) => updateRow(i, { stockQty: e.target.value })}
                  placeholder="∞"
                  className="col-span-1 px-1.5 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="col-span-1 p-1.5 rounded hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                  aria-label="Remove variation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {error && <div className="text-xs text-rose-300">{error}</div>}
            {saved && <div className="text-xs text-emerald-300">Variations saved.</div>}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={addRow}
                className="px-2.5 py-1.5 text-xs rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add variation
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="ml-auto px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-1"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save variations
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default VariationsPanel;
