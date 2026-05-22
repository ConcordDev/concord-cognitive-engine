'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { Listing } from './ListingsBrowser';

interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  alertCadence: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastMatchCount?: number;
}
interface AlertResult {
  searchId: string;
  searchName: string;
  totalMatches: number;
  newMatches: Listing[];
  newMatchCount: number;
  checkedAt: string;
}

const CADENCES = ['instant', 'daily', 'weekly', 'never'] as const;

export function SavedSearchAlerts({ onSelect }: { onSelect?: (l: Listing) => void }) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', minPrice: '', maxPrice: '', minBeds: '', city: '', alertCadence: 'weekly' as string });
  const [alerts, setAlerts] = useState<Record<string, AlertResult>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'saved-searches-list', input: {} });
      if (r.data?.ok) setSearches((r.data.result?.searches as SavedSearch[]) || []);
    } catch (e) {
      console.error('[SavedSearchAlerts] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addSearch = async () => {
    if (!form.name.trim()) return;
    setError(null);
    const filters: Record<string, unknown> = {};
    if (form.minPrice) filters.minPrice = Number(form.minPrice);
    if (form.maxPrice) filters.maxPrice = Number(form.maxPrice);
    if (form.minBeds) filters.minBeds = Number(form.minBeds);
    if (form.city.trim()) filters.city = form.city.trim();
    try {
      const r = await lensRun({
        domain: 'realestate', action: 'save-search',
        input: { name: form.name.trim(), filters, alertCadence: form.alertCadence },
      });
      if (r.data?.ok) {
        setForm({ name: '', minPrice: '', maxPrice: '', minBeds: '', city: '', alertCadence: 'weekly' });
        setAdding(false);
        await refresh();
      } else {
        setError(r.data?.error || 'Could not save search.');
      }
    } catch (e) {
      console.error('[SavedSearchAlerts] add failed', e);
      setError('Could not save search.');
    }
  };

  const removeSearch = async (id: string) => {
    try {
      const r = await lensRun({ domain: 'realestate', action: 'delete-search', input: { id } });
      if (r.data?.ok) {
        setSearches((prev) => prev.filter((s) => s.id !== id));
        setAlerts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      }
    } catch (e) {
      console.error('[SavedSearchAlerts] delete failed', e);
    }
  };

  const checkAlerts = async (searchId: string) => {
    setChecking(searchId);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'saved-search-check-alerts', input: { searchId } });
      if (r.data?.ok) {
        setAlerts((prev) => ({ ...prev, [searchId]: r.data!.result as AlertResult }));
        await refresh();
      }
    } catch (e) {
      console.error('[SavedSearchAlerts] check failed', e);
    } finally {
      setChecking(null);
    }
  };

  const describeFilters = (f: Record<string, unknown>) => {
    const parts: string[] = [];
    if (f.minPrice) parts.push(`≥ $${Number(f.minPrice).toLocaleString()}`);
    if (f.maxPrice) parts.push(`≤ $${Number(f.maxPrice).toLocaleString()}`);
    if (f.minBeds) parts.push(`${f.minBeds}+ bd`);
    if (f.city) parts.push(String(f.city));
    return parts.length > 0 ? parts.join(' · ') : 'any listing';
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Saved-search alerts</span>
        <span className="ml-auto text-[10px] text-gray-500">{searches.length} search{searches.length === 1 ? '' : 'es'}</span>
        <button onClick={() => setAdding((v) => !v)} className="p-1 text-gray-400 hover:text-white" title="New saved search"><Plus className="w-4 h-4" /></button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 space-y-2 text-xs">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Search name (e.g. 3BR Austin under $600K)" className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <div className="grid grid-cols-4 gap-2">
            <input type="number" value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} placeholder="Min $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={form.maxPrice} onChange={(e) => setForm({ ...form, maxPrice: e.target.value })} placeholder="Max $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={form.minBeds} onChange={(e) => setForm({ ...form, minBeds: e.target.value })} placeholder="Min beds" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <div className="flex gap-2">
            <select value={form.alertCadence} onChange={(e) => setForm({ ...form, alertCadence: e.target.value })} className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
              {CADENCES.map((c) => <option key={c} value={c}>Alert: {c}</option>)}
            </select>
            <button onClick={addSearch} className="px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save</button>
          </div>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : searches.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />No saved searches. Save one and we'll notify you of new matching listings.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {searches.map((s) => {
              const a = alerts[s.id];
              return (
                <li key={s.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{s.name}</div>
                      <div className="text-[10px] text-gray-500">{describeFilters(s.filters)} · {s.alertCadence} alerts</div>
                    </div>
                    <button onClick={() => checkAlerts(s.id)} disabled={checking === s.id} className="px-2 py-1 text-[10px] rounded bg-white/5 text-cyan-300 hover:bg-white/10 inline-flex items-center gap-1 disabled:opacity-40">
                      {checking === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <BellRing className="w-3 h-3" />} Check
                    </button>
                    <button onClick={() => removeSearch(s.id)} className="p-1 text-gray-500 hover:text-rose-400" aria-label="Delete search"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {a && (
                    <div className={cn('mt-2 rounded-md border p-2 text-xs', a.newMatchCount > 0 ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.02]')}>
                      <div className="text-[11px] text-gray-300">
                        {a.newMatchCount > 0
                          ? <span className="text-emerald-300 font-semibold">{a.newMatchCount} new match{a.newMatchCount === 1 ? '' : 'es'}</span>
                          : <span className="text-gray-500">No new matches</span>}
                        {' · '}{a.totalMatches} total · checked {new Date(a.checkedAt).toLocaleString()}
                      </div>
                      {a.newMatches.length > 0 && (
                        <ul className="mt-1.5 space-y-1">
                          {a.newMatches.map((l) => (
                            <li key={l.id} className="flex items-center gap-2 cursor-pointer hover:text-cyan-300" onClick={() => onSelect?.(l)}>
                              <span className="font-mono tabular-nums text-white">${l.price.toLocaleString()}</span>
                              <span className="text-gray-400 truncate">{l.address}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="px-3 py-1.5 text-[11px] text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

export default SavedSearchAlerts;
