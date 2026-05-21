'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calendar, Plus, Trash2, Check, AlertTriangle, Loader2, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  cadence: 'monthly' | 'annual' | 'weekly' | 'biweekly';
  autopay: boolean;
  category: string;
  paidThisCycle: boolean;
  lastPaidAt: string | null;
}

interface CashflowPoint {
  date: string;
  credit: number;
  debit: number;
  balance: number;
}

interface CashflowForecast {
  series: CashflowPoint[];
  startBalance: number;
  finalBalance: number;
  lowestBalance: number;
  lowestDate: string;
  alert: string | null;
}

export function BillsCalendar({ startBalance = 2000 }: { startBalance?: number }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [forecast, setForecast] = useState<CashflowForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', dueDay: '1', cadence: 'monthly', autopay: false });

  useEffect(() => { refresh(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (bills.length > 0) refreshForecast(); }, [bills.length, startBalance]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'bills-list', input: {} });
      setBills((res.data?.result?.bills || []) as Bill[]);
    } catch (e) { console.error('[Bills] list failed', e); }
    finally { setLoading(false); }
  }

  async function refreshForecast() {
    try {
      const res = await lensRun({
        domain: 'finance', action: 'cashflow-forecast',
        input: { startBalance, horizonDays: 60 },
      });
      setForecast(res.data?.result || null);
    } catch (e) { console.error('[Bills] forecast failed', e); }
  }

  async function create() {
    if (!form.name.trim() || !form.amount) return;
    try {
      await lensRun({
        domain: 'finance', action: 'bills-add',
        input: { name: form.name.trim(), amount: Number(form.amount), dueDay: Number(form.dueDay), cadence: form.cadence, autopay: form.autopay },
      });
      setForm({ name: '', amount: '', dueDay: '1', cadence: 'monthly', autopay: false });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Bills] create failed', e); }
  }

  async function pay(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'bills-pay', input: { id } });
      await refresh();
    } catch (e) { console.error('[Bills] pay failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'bills-delete', input: { id } });
      setBills(prev => prev.filter(b => b.id !== id));
    } catch (e) { console.error('[Bills] delete failed', e); }
  }

  const monthlyTotal = useMemo(() => bills.reduce((s, b) => s + (b.cadence === 'monthly' ? b.amount : b.cadence === 'annual' ? b.amount / 12 : 0), 0), [bills]);
  const upcoming = useMemo(() => bills.filter(b => !b.paidThisCycle).sort((a, b) => a.dueDay - b.dueDay), [bills]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Bills & cash flow</span>
        <span className="ml-auto text-[10px] text-gray-500 font-mono">${monthlyTotal.toFixed(0)}/mo</span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="New bill"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="$" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={1} max={31} value={form.dueDay} onChange={e => setForm({ ...form, dueDay: e.target.value })} placeholder="Day" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="annual">Annual</option>
          </select>
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
        </div>
      )}

      {forecast && (
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500">60-day cash-flow forecast</span>
            <span className={cn('text-xs font-mono', forecast.finalBalance >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              End: ${forecast.finalBalance.toFixed(0)}
            </span>
          </div>
          <CashflowChart series={forecast.series} />
          {forecast.alert && (
            <div className="mt-2 px-2 py-1.5 rounded bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {forecast.alert}
            </div>
          )}
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : bills.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No bills yet. Hit + to add.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {upcoming.map(b => (
              <li key={b.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-cyan-500/10 flex flex-col items-center justify-center text-[10px] text-cyan-300 font-mono">
                  <span className="text-[8px] uppercase">Due</span>
                  <span className="font-bold">{b.dueDay}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {b.name}
                    {b.autopay && <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />AUTOPAY</span>}
                  </div>
                  <div className="text-[10px] text-gray-500">{b.category} · {b.cadence}</div>
                </div>
                <span className="font-mono text-sm text-white tabular-nums">${b.amount.toFixed(0)}</span>
                <button onClick={() => pay(b.id)} className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-300" title="Mark paid"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(b.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
            {bills.filter(b => b.paidThisCycle).map(b => (
              <li key={b.id} className="px-3 py-2 opacity-50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-300"><Check className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate line-through">{b.name}</div>
                  <div className="text-[10px] text-gray-500">Paid {b.lastPaidAt ? new Date(b.lastPaidAt).toLocaleDateString() : ''}</div>
                </div>
                <span className="font-mono text-xs text-gray-400 tabular-nums">${b.amount.toFixed(0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CashflowChart({ series }: { series: CashflowPoint[] }) {
  if (!series || series.length === 0) return null;
  const balances = series.map(s => s.balance);
  const min = Math.min(...balances, 0);
  const max = Math.max(...balances);
  const span = max - min || 1;
  const w = 600, h = 80;
  const step = w / (series.length - 1);
  const linePoints = series.map((s, i) => `${(i * step).toFixed(2)},${(h - ((s.balance - min) / span) * h).toFixed(2)}`).join(' ');
  const zeroY = h - ((0 - min) / span) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-20">
      {min < 0 && <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="rgba(244,63,94,0.4)" strokeDasharray="2 2" />}
      <polyline fill="none" strokeWidth="1.5" stroke="#22d3ee" points={linePoints} />
    </svg>
  );
}

export default BillsCalendar;
