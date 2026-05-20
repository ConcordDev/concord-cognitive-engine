'use client';

import { useEffect, useState } from 'react';
import { Award, Plus, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Status {
  bfr: { current: boolean; lastDate: string | null; daysSince: number | null; expiresInDays: number | null };
  ipc: { current: boolean; lastDate: string | null; daysSince: number | null };
  medical: { current: boolean; lastDate: string | null; daysSince: number | null; validityDays: number | null; kind: string | null };
  passenger90: { dayCurrent: boolean; dayCount: number; nightCurrent: boolean; nightCount: number };
  ifr180: { current: boolean; approaches: number };
}

const KINDS = [
  { value: 'flight_review', label: 'Flight review (BFR)' },
  { value: 'ipc', label: 'IPC' },
  { value: 'medical_first_class', label: 'Medical — 1st class' },
  { value: 'medical_second_class', label: 'Medical — 2nd class' },
  { value: 'medical_third_class', label: 'Medical — 3rd class' },
  { value: 'checkride', label: 'Checkride' },
  { value: 'training', label: 'Training' },
];

export function CurrencyPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ kind: 'flight_review', date: new Date().toISOString().slice(0, 10), cfi: '', notes: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'aviation', action: 'currency-status', input: {} });
      setStatus((res.data?.result as Status) || null);
    } catch (e) { console.error('[Currency] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    try {
      await lensRun({ domain: 'aviation', action: 'currency-event-add', input: form });
      setForm({ ...form, cfi: '', notes: '' });
      await refresh();
    } catch (e) { console.error('[Currency] add', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Award className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pilot currency</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.cfi} onChange={e => setForm({ ...form, cfi: e.target.value })} placeholder="CFI / AME name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log</button>
      </div>
      <div className="p-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !status ? null : (
          <ul className="space-y-2">
            <Row label="Flight review (BFR)" current={status.bfr.current} sub={status.bfr.lastDate ? `Last ${status.bfr.lastDate} · ${status.bfr.expiresInDays} days left` : 'Never logged'} />
            <Row label="IPC" current={status.ipc.current} sub={status.ipc.lastDate ? `Last ${status.ipc.lastDate}` : 'Never logged'} />
            <Row label={status.medical.kind ? `Medical — ${status.medical.kind.replace('medical_', '').replace('_', ' ')}` : 'Medical'} current={status.medical.current} sub={status.medical.lastDate ? `Last ${status.medical.lastDate} · ${status.medical.validityDays}d validity` : 'Never logged'} />
            <Row label="90-day pax (day)" current={status.passenger90.dayCurrent} sub={`${status.passenger90.dayCount}/3 takeoffs+landings in last 90 days`} />
            <Row label="90-day pax (night)" current={status.passenger90.nightCurrent} sub={`${status.passenger90.nightCount}/3 night takeoffs+landings in last 90 days`} />
            <Row label="IFR (6/180)" current={status.ifr180.current} sub={`${status.ifr180.approaches}/6 approaches in last 180 days`} />
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, current, sub }: { label: string; current: boolean; sub: string }) {
  return (
    <li className={cn('px-3 py-2 rounded-md border flex items-center gap-3', current ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5')}>
      {current ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white">{label}</div>
        <div className="text-[11px] text-gray-400">{sub}</div>
      </div>
      <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded', current ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>{current ? 'Current' : 'Lapsed'}</span>
    </li>
  );
}

export default CurrencyPanel;
