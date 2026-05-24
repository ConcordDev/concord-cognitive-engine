'use client';

/**
 * RetainerManager — recurring-revenue retainers distinct from fixed-fee
 * engagements: create, bill a period (with overage hours), pause / end,
 * and see total MRR. Wires consulting.retainer-create / retainer-list /
 * retainer-bill / retainer-update / retainer-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Repeat, Loader2, Trash2, Plus, Receipt, Pause, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Period { id: string; amount: number; hoursUsed: number; includedHours: number; overageHours: number; billedAt: string; status: string }
interface Retainer {
  id: string; client: string; label: string; monthlyAmount: number; cadence: string;
  includedHours: number; status: string; periods: Period[]; nextBillDate: string;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-500/10',
  paused: 'text-amber-400 bg-amber-500/10',
  ended: 'text-zinc-400 bg-zinc-800',
};

export function RetainerManager() {
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [mrr, setMrr] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client: '', label: '', monthlyAmount: '', cadence: 'monthly', includedHours: '' });
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [billHours, setBillHours] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'retainer-list', {});
    const res = r.data?.result as { retainers?: Retainer[]; mrr?: number } | null;
    setRetainers(res?.retainers || []);
    setMrr(res?.mrr || 0);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    setError('');
    if (!form.client.trim() || !form.monthlyAmount) { setError('Client and amount required'); return; }
    const r = await lensRun('consulting', 'retainer-create', {
      client: form.client.trim(), label: form.label.trim(),
      monthlyAmount: Number(form.monthlyAmount), cadence: form.cadence,
      includedHours: form.includedHours ? Number(form.includedHours) : 0,
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Failed'); return; }
    setForm({ client: '', label: '', monthlyAmount: '', cadence: 'monthly', includedHours: '' });
    setOpen(false);
    await refresh();
  }
  async function bill(id: string) {
    await lensRun('consulting', 'retainer-bill', { id, hoursUsed: billHours ? Number(billHours) : 0 });
    setBillHours('');
    await refresh();
  }
  async function toggleStatus(r: Retainer) {
    const next = r.status === 'active' ? 'paused' : 'active';
    await lensRun('consulting', 'retainer-update', { id: r.id, status: next });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('consulting', 'retainer-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-center">
          <p className="text-base font-bold text-emerald-400">${mrr.toLocaleString()}</p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Monthly Recurring Revenue</p>
        </div>
        <button onClick={() => { setOpen(true); setError(''); }}
          className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New Retainer
        </button>
      </div>

      <ul className="space-y-1.5">
        {retainers.length === 0 && <li className="text-xs text-zinc-500 italic py-3 text-center">No retainers yet.</li>}
        {retainers.map(r => (
          <li key={r.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <Repeat className="w-4 h-4 text-indigo-400 shrink-0" />
              <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{r.label}</p>
                <p className="text-[10px] text-zinc-500">{r.client} · ${r.monthlyAmount.toLocaleString()}/{r.cadence} · {r.includedHours}h incl · next {r.nextBillDate}</p>
              </button>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${STATUS_COLOR[r.status] || 'text-zinc-400 bg-zinc-800'}`}>{r.status}</span>
              {r.status !== 'ended' && (
                <button onClick={() => toggleStatus(r)} aria-label="Toggle status" className="text-zinc-500 hover:text-amber-400">
                  {r.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
              )}
              <button onClick={() => del(r.id)} aria-label="Delete" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {expanded === r.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1.5">
                {r.periods.map(p => (
                  <p key={p.id} className="text-[10px] text-zinc-400">
                    {p.billedAt} · ${p.amount.toLocaleString()} · {p.hoursUsed}h used
                    {p.overageHours > 0 && <span className="text-amber-400"> · {p.overageHours}h overage</span>}
                  </p>
                ))}
                {r.periods.length === 0 && <p className="text-[10px] text-zinc-600 italic">No billing periods yet.</p>}
                {r.status === 'active' && (
                  <div className="flex gap-1">
                    <input value={billHours} onChange={e => setBillHours(e.target.value)} placeholder="hours used"
                      className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                    <button onClick={() => bill(r.id)}
                      className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
                      <Receipt className="w-3 h-3" />Bill Period
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-xl p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-bold text-zinc-100 mb-3">New Retainer</h4>
            <div className="space-y-2">
              <input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="Client"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Label (optional)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={form.monthlyAmount} onChange={e => setForm({ ...form, monthlyAmount: e.target.value })} placeholder="Amount per period ($)"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
              <input value={form.includedHours} onChange={e => setForm({ ...form, includedHours: e.target.value })} placeholder="Included hours per period"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            </div>
            {error && <p className="text-[11px] text-rose-400 mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
              <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
