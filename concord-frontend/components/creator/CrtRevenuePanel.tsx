'use client';

/**
 * CrtRevenuePanel — revenue logging with a by-source breakdown.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, DollarSign } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RevenueEntry { id: string; source: string; amount: number; note: string | null; date: string }
interface Summary { total: number; thisMonth: number; bySource: Record<string, number> }

const SOURCES = ['ad_revenue', 'sponsorship', 'memberships', 'merch', 'tips', 'affiliate', 'other'];

export function CrtRevenuePanel({ onChange }: { onChange: () => void }) {
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ source: 'sponsorship', amount: '', note: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, s] = await Promise.all([
      lensRun('creator', 'revenue-list', { days: 180 }),
      lensRun('creator', 'revenue-summary', {}),
    ]);
    setEntries(e.data?.result?.entries || []);
    setSummary((s.data?.result as Summary | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addRevenue = async () => {
    const amt = Number(form.amount);
    if (!(amt > 0)) { setError('Enter a positive amount.'); return; }
    const r = await lensRun('creator', 'revenue-add', { source: form.source, amount: amt, note: form.note.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ source: 'sponsorship', amount: '', note: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const maxSource = summary ? Math.max(1, ...Object.values(summary.bySource)) : 1;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-emerald-300">${summary.thisMonth.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-500 uppercase">This month</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-zinc-100">${summary.total.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-500 uppercase">All time</p>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input placeholder="Amount" inputMode="decimal" value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addRevenue}
          className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </section>

      {/* By source */}
      {summary && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">By source</h3>
          <ul className="space-y-1.5">
            {SOURCES.filter((s) => summary.bySource[s] > 0).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-24 text-[11px] text-zinc-400 capitalize">{s.replace(/_/g, ' ')}</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${(summary.bySource[s] / maxSource) * 100}%` }} />
                </div>
                <span className="text-[10px] text-zinc-400 w-16 text-right">${summary.bySource[s].toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {Object.values(summary.bySource).every((v) => v === 0) && (
            <p className="text-[11px] text-zinc-500 italic">No revenue logged yet.</p>
          )}
        </div>
      )}

      {/* Recent */}
      {entries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Recent</h3>
          <ul className="space-y-1">
            {entries.slice(0, 20).map((e) => (
              <li key={e.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs text-zinc-200 capitalize flex-1">
                  {e.source.replace(/_/g, ' ')}{e.note && <span className="text-zinc-500"> · {e.note}</span>}
                </span>
                <span className="text-[10px] text-zinc-500">{e.date}</span>
                <span className="text-xs text-emerald-300 font-medium">${e.amount.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
