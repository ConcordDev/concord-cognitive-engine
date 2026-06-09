'use client';

/**
 * TravelWatchesPanel — Hopper-shape price watches for flights and
 * hotels with buy/wait recommendations.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, TrendingDown, TrendingUp, Minus, Trash2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Watch {
  id: string; subject: string; kind: string; targetPrice: number;
  currentPrice: number; lowestSeen: number; changeFromStart: number;
  observations: number; trend: string; belowTarget: boolean; recommendation: string;
}

const REC_LABEL: Record<string, { text: string; color: string }> = {
  buy_now: { text: 'Buy now', color: 'text-emerald-400' },
  buy_soon: { text: 'Buy soon — rising', color: 'text-amber-400' },
  wait: { text: 'Wait — falling', color: 'text-sky-400' },
  watch: { text: 'Keep watching', color: 'text-zinc-400' },
};

export function TravelWatchesPanel({ onChange }: { onChange: () => void }) {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: '', kind: 'flight', targetPrice: '', currentPrice: '' });
  const [priceInput, setPriceInput] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'price-watch-list', {});
    setWatches(r.data?.result?.watches || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.subject.trim()) { setError('Subject is required (e.g. SFO→NRT).'); return; }
    if (!(Number(form.currentPrice) > 0)) { setError('Current price must be greater than zero.'); return; }
    const r = await lensRun('travel', 'price-watch-create', {
      subject: form.subject.trim(), kind: form.kind,
      targetPrice: Number(form.targetPrice) || 0, currentPrice: Number(form.currentPrice),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ subject: '', kind: 'flight', targetPrice: '', currentPrice: '' });
    setError(null);
    await refresh();
  };
  const recordPrice = async (id: string) => {
    const price = Number(priceInput[id]);
    if (!price || price <= 0) { setError('Enter a price greater than zero.'); return; }
    await lensRun('travel', 'price-watch-update', { id, price });
    setPriceInput((p) => ({ ...p, [id]: '' }));
    setError(null);
    await refresh();
  };
  const del = async (id: string) => { await lensRun('travel', 'price-watch-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Subject (SFO→NRT)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {['flight', 'hotel', 'car'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Target $" inputMode="decimal" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Current $" inputMode="decimal" value={form.currentPrice} onChange={(e) => setForm({ ...form, currentPrice: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </div>
      <button type="button" onClick={create}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg">
        <Plus className="w-3.5 h-3.5" /> Watch a price
      </button>

      {watches.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No price watches. Track a flight or hotel to get buy/wait guidance.
        </div>
      ) : (
        <ul className="space-y-2">
          {watches.map((w) => {
            const TrendIcon = w.trend === 'rising' ? TrendingUp : w.trend === 'falling' ? TrendingDown : Minus;
            const rec = REC_LABEL[w.recommendation] || REC_LABEL.watch;
            return (
              <li key={w.id} className={cn('bg-zinc-900/70 border rounded-xl p-3',
                w.belowTarget ? 'border-emerald-900/50' : 'border-zinc-800')}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{w.subject}</p>
                    <p className="text-[11px] text-zinc-400 capitalize">
                      {w.kind} · target ${w.targetPrice || '—'} · low ${w.lowestSeen} · {w.observations} checks
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center gap-1 text-sm font-bold text-zinc-100">
                      <TrendIcon className={cn('w-3.5 h-3.5',
                        w.trend === 'falling' ? 'text-emerald-400' : w.trend === 'rising' ? 'text-rose-400' : 'text-zinc-400')} />
                      ${w.currentPrice}
                    </p>
                    <p className={cn('text-[10px] font-medium', rec.color)}>{rec.text}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <input placeholder="New observed price" inputMode="decimal"
                    value={priceInput[w.id] || ''} onChange={(e) => setPriceInput((p) => ({ ...p, [w.id]: e.target.value }))}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                  <button type="button" onClick={() => recordPrice(w.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                    <RefreshCw className="w-3 h-3" /> Update
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => del(w.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
