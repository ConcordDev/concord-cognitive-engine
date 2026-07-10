'use client';

/**
 * RxFormularyToolsPanel — structured homes for two real, stateless
 * pharmacy.js compute macros that had no designed UI before this rebuild:
 * `formularySearch` (insurance-formulary tier/coverage lookup against a
 * caller-supplied formulary list) and `inventoryAlert` (low-stock/expiry
 * scan against a caller-supplied inventory list). Both are pure functions
 * over structured input — no DB, no external API — so the honest surface
 * for them is a small structured-row editor, not a JSON textarea.
 *
 * Uses useMacroDispatchFeedback for real dispatch/running/done/error
 * lifecycle feedback (see hooks/useMacroDispatchFeedback.ts) instead of a
 * hand-rolled loading boolean.
 */

import { useState } from 'react';
import { Search, Package, Plus, Trash2, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { cn } from '@/lib/utils';

interface FormularyRow { generic: string; brand: string; tier: string; covered: boolean; priorAuth: boolean }
interface FormularyMatch { generic: string; brand: string; tier: string; covered: boolean; priorAuth: boolean }
interface FormularyResult { query: string; matches: FormularyMatch[]; found: number; formularySize: number; message?: string }

interface InventoryRow { name: string; quantity: string; reorderPoint: string; expiryDate: string }
interface InventoryAlertEntry { name: string; quantity: number; reorderPoint: number; lowStock: boolean; expired: boolean; nearExpiry: boolean; daysToExpiry: number | null }
interface InventoryResult { totalItems: number; lowStock: number; expired: number; nearExpiry: number; alerts: InventoryAlertEntry[]; allClear: boolean; message?: string }

const emptyFormularyRow = (): FormularyRow => ({ generic: '', brand: '', tier: '1', covered: true, priorAuth: false });
const emptyInventoryRow = (): InventoryRow => ({ name: '', quantity: '', reorderPoint: '', expiryDate: '' });

export function RxFormularyToolsPanel() {
  const [query, setQuery] = useState('');
  const [formularyRows, setFormularyRows] = useState<FormularyRow[]>([emptyFormularyRow()]);
  const formularyFeedback = useMacroDispatchFeedback<FormularyResult>();

  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([emptyInventoryRow()]);
  const inventoryFeedback = useMacroDispatchFeedback<InventoryResult>();

  const updateFormularyRow = (i: number, patch: Partial<FormularyRow>) =>
    setFormularyRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateInventoryRow = (i: number, patch: Partial<InventoryRow>) =>
    setInventoryRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const runFormularySearch = () => {
    const formulary = formularyRows
      .filter((r) => r.generic.trim())
      .map((r) => ({ genericName: r.generic.trim(), brandName: r.brand.trim(), tier: r.tier, covered: r.covered, priorAuth: r.priorAuth }));
    void formularyFeedback.dispatch('pharmacy', 'formularySearch', { artifact: { data: { query, formulary } } });
  };

  const runInventoryAlert = () => {
    const inventory = inventoryRows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), quantity: r.quantity, reorderPoint: r.reorderPoint, expiryDate: r.expiryDate.trim() || null }));
    void inventoryFeedback.dispatch('pharmacy', 'inventoryAlert', { artifact: { data: { inventory } } });
  };

  const formularyResult = formularyFeedback.result;
  const inventoryResult = inventoryFeedback.result;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Formulary search */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2.5">
        <header className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Formulary coverage check</h3>
        </header>
        <p className="text-[11px] text-zinc-400">
          Enter your plan&apos;s formulary rows (or a coupon/plan document&apos;s tier list), then search by drug name.
          This is a pure lookup against what you enter here — Concord does not hold a live insurance formulary feed.
        </p>

        <div className="space-y-1.5">
          {formularyRows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_56px_auto_auto_28px] gap-1.5 items-center">
              <input placeholder="Generic name" value={row.generic} onChange={(e) => updateFormularyRow(i, { generic: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <input placeholder="Brand (optional)" value={row.brand} onChange={(e) => updateFormularyRow(i, { brand: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <input placeholder="Tier" value={row.tier} onChange={(e) => updateFormularyRow(i, { tier: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100" />
              <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                <input type="checkbox" checked={row.covered} onChange={(e) => updateFormularyRow(i, { covered: e.target.checked })} /> Covered
              </label>
              <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                <input type="checkbox" checked={row.priorAuth} onChange={(e) => updateFormularyRow(i, { priorAuth: e.target.checked })} /> PA
              </label>
              <button type="button" aria-label="Remove row" onClick={() => setFormularyRows((rows) => rows.filter((_, idx) => idx !== i))}
                className="text-zinc-600 hover:text-rose-400 p-1">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setFormularyRows((rows) => [...rows, emptyFormularyRow()])}
            className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300">
            <Plus className="w-3 h-3" /> Add formulary row
          </button>
        </div>

        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search formulary…"
              onKeyDown={(e) => { if (e.key === 'Enter') runFormularySearch(); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded pl-8 pr-2 py-1.5 text-[11px] text-zinc-100" />
          </div>
          <button type="button" onClick={runFormularySearch} disabled={formularyFeedback.status === 'dispatched' || formularyFeedback.status === 'running'}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-emerald-700/40 hover:bg-emerald-700/60 disabled:opacity-40 text-emerald-200 rounded-lg">
            {(formularyFeedback.status === 'dispatched' || formularyFeedback.status === 'running') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Search
          </button>
        </div>

        {formularyFeedback.status === 'error' && (
          <p role="alert" className="text-[11px] text-rose-400">{formularyFeedback.error}</p>
        )}
        {formularyResult && !formularyResult.message && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5 text-[11px]">
            <p className="text-zinc-400 mb-1.5">{formularyResult.found} / {formularyResult.formularySize} rows matched &quot;{formularyResult.query}&quot;</p>
            {formularyResult.matches.length === 0 ? (
              <p className="italic text-zinc-500">No matches.</p>
            ) : (
              <ul className="space-y-1">
                {formularyResult.matches.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full shrink-0', m.covered ? 'bg-emerald-500' : 'bg-rose-500')} />
                    <span className="flex-1 text-zinc-200">{m.generic}{m.brand ? ` (${m.brand})` : ''}</span>
                    <span className="text-zinc-400">Tier {m.tier}</span>
                    {m.priorAuth && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px]">PA</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Inventory alerts */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2.5">
        <header className="flex items-center gap-2">
          <Package className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Inventory low-stock / expiry check</h3>
        </header>
        <p className="text-[11px] text-zinc-400">
          For household or clinic on-hand stock outside your tracked medications above — enter rows and scan for
          low stock and expiring items.
        </p>

        <div className="space-y-1.5">
          {inventoryRows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_70px_70px_1fr_28px] gap-1.5 items-center">
              <input placeholder="Item name" value={row.name} onChange={(e) => updateInventoryRow(i, { name: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <input placeholder="Qty" inputMode="numeric" value={row.quantity} onChange={(e) => updateInventoryRow(i, { quantity: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100" />
              <input placeholder="Reorder" inputMode="numeric" value={row.reorderPoint} onChange={(e) => updateInventoryRow(i, { reorderPoint: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100" />
              <input type="date" value={row.expiryDate} onChange={(e) => updateInventoryRow(i, { expiryDate: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100" />
              <button type="button" aria-label="Remove row" onClick={() => setInventoryRows((rows) => rows.filter((_, idx) => idx !== i))}
                className="text-zinc-600 hover:text-rose-400 p-1">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setInventoryRows((rows) => [...rows, emptyInventoryRow()])}
            className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300">
            <Plus className="w-3 h-3" /> Add inventory row
          </button>
        </div>

        <button type="button" onClick={runInventoryAlert} disabled={inventoryFeedback.status === 'dispatched' || inventoryFeedback.status === 'running'}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-amber-700/40 hover:bg-amber-700/60 disabled:opacity-40 text-amber-200 rounded-lg">
          {(inventoryFeedback.status === 'dispatched' || inventoryFeedback.status === 'running') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
          Scan inventory
        </button>

        {inventoryFeedback.status === 'error' && (
          <p role="alert" className="text-[11px] text-rose-400">{inventoryFeedback.error}</p>
        )}
        {inventoryResult && !inventoryResult.message && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5 text-[11px] space-y-1.5">
            <div className="flex items-center gap-3">
              <span className={cn('font-semibold', inventoryResult.allClear ? 'text-emerald-400' : 'text-amber-300')}>
                {inventoryResult.allClear ? 'All clear' : 'Action needed'}
              </span>
              <span className="text-zinc-400">{inventoryResult.totalItems} items scanned</span>
            </div>
            {inventoryResult.alerts.length > 0 && (
              <ul className="space-y-1">
                {inventoryResult.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <AlertTriangle className={cn('w-3 h-3 shrink-0', a.expired ? 'text-rose-400' : a.nearExpiry ? 'text-orange-400' : 'text-amber-400')} />
                    <span className="flex-1 text-zinc-200">{a.name}</span>
                    {a.expired && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300">Expired</span>}
                    {a.nearExpiry && !a.expired && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">{a.daysToExpiry}d</span>}
                    {a.lowStock && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Low ({a.quantity})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
