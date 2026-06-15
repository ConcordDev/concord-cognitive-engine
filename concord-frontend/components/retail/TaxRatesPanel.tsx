'use client';

/**
 * TaxRatesPanel — surfaces the retail lens's tax-rate table (the retail.tax-rates-*
 * macros existed backend-side but had no UI). Set a sales-tax rate per region,
 * list, delete. A core commerce feature. tax-rates-set returns the full updated list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Percent, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TaxRate { id: string; region: string; ratePct: number }

export function TaxRatesPanel({ className }: { className?: string }) {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [region, setRegion] = useState('');
  const [ratePct, setRatePct] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((list: unknown) => {
    setRates(Array.isArray(list) ? (list as TaxRate[]) : []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('retail', 'tax-rates-list', {});
      apply(r?.data?.result?.rates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tax rates');
    } finally { setLoading(false); }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const set = useCallback(async () => {
    const reg = region.trim();
    const pct = Number(ratePct);
    if (!reg || !Number.isFinite(pct)) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun('retail', 'tax-rates-set', { region: reg, ratePct: pct });
      if (r?.data?.error) setError(String(r.data.error));
      else { setRegion(''); setRatePct(''); apply(r?.data?.result?.rates); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set tax rate');
    } finally { setSaving(false); }
  }, [region, ratePct, apply]);

  const remove = useCallback(async (id: string) => {
    setRates((prev) => prev.filter((r) => r.id !== id));
    try { const r = await lensRun('retail', 'tax-rates-delete', { id }); apply(r?.data?.result?.rates); } catch { void load(); }
  }, [apply, load]);

  return (
    <div className={cn('rounded-xl border border-emerald-900/30 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Percent className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Sales-tax rates</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {rates.length === 0 && !loading && <p className="text-xs text-zinc-500">No tax rates configured.</p>}
        {rates.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs group">
            <span className="text-zinc-100 font-medium flex-1">{r.region}</span>
            <span className="text-emerald-300 font-mono">{r.ratePct}%</span>
            <button type="button" onClick={() => void remove(r.id)} aria-label="Delete rate"
              className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void set(); }} className="flex flex-wrap items-center gap-2">
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region (e.g. CA)" maxLength={40}
          className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none" />
        <input value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="rate %" type="number" min="0" max="100" step="0.01"
          className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none" />
        <button type="submit" disabled={saving || !region.trim() || ratePct === ''}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Set
        </button>
      </form>
    </div>
  );
}

export default TaxRatesPanel;
