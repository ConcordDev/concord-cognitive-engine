'use client';

/**
 * ObligationTracker — surfaces renewal / expiry / payment dates across
 * every contract as a single actionable task list, sorted by urgency.
 * Backlog item 4. Wires law.obligation-tracker / -add / -complete.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, Loader2, CheckCircle2, Circle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Task {
  id: string; contractId: string; contractTitle: string; label: string;
  kind: string; dueDate: string; amount: number; done: boolean;
  daysRemaining: number; priority: 'overdue' | 'urgent' | 'upcoming' | 'completed';
  implicit?: boolean;
}
interface TrackerResult {
  tasks: Task[];
  summary: { total: number; overdue: number; urgent: number; upcoming: number; completed: number };
}

const KINDS = ['renewal', 'expiry', 'payment', 'delivery', 'review', 'other'];
const PRIORITY_STYLE: Record<string, string> = {
  overdue: 'border-rose-500/40 bg-rose-500/5 text-rose-300',
  urgent: 'border-amber-500/40 bg-amber-500/5 text-amber-300',
  upcoming: 'border-white/10 bg-black/40 text-gray-300',
  completed: 'border-white/5 bg-black/20 text-gray-400',
};

export function ObligationTracker({ contracts }: { contracts: { id: string; title: string }[] }) {
  const [result, setResult] = useState<TrackerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ contractId: '', label: '', kind: 'renewal', dueDate: '', amount: '' });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('law', 'obligation-tracker', {});
    if (r.data?.ok) setResult(r.data.result as TrackerResult);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!form.contractId || !form.label.trim() || !form.dueDate) { setErr('Contract, label and due date are required.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('law', 'obligation-add', {
      contractId: form.contractId, label: form.label.trim(), kind: form.kind,
      dueDate: form.dueDate, amount: form.amount ? Number(form.amount) : 0,
    });
    setBusy(false);
    if (r.data?.ok) { setShowAdd(false); setForm({ contractId: '', label: '', kind: 'renewal', dueDate: '', amount: '' }); await load(); }
    else { setErr(r.data?.error || 'Could not add obligation.'); }
  }

  async function toggle(t: Task) {
    if (t.implicit) return;
    await lensRun('law', 'obligation-complete', { contractId: t.contractId, obligationId: t.id });
    await load();
  }

  const s = result?.summary;

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-amber-300" />
        <h2 className="font-semibold text-white">Obligation Tracker</h2>
        <button onClick={() => setShowAdd((v) => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add obligation
        </button>
      </div>

      {s && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Overdue', s.overdue, 'text-rose-400'], ['Urgent', s.urgent, 'text-amber-300'],
             ['Upcoming', s.upcoming, 'text-gray-300'], ['Done', s.completed, 'text-neon-green']] as const).map(([l, v, c]) => (
            <div key={l} className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-center">
              <p className={cn('text-sm font-bold', c)}>{v}</p>
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="bg-black/40 border border-amber-500/20 rounded-lg p-3 mb-3 space-y-2">
          <div className="flex gap-2">
            <select value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white">
              <option value="">Select contract…</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white capitalize">
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Obligation label"
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="Amount"
              className="w-24 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <button onClick={add} disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
            </button>
          </div>
          {err && <p className="text-xs text-rose-400">{err}</p>}
        </div>
      )}

      {!result || result.tasks.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-4 text-center">No obligations yet.</p>
      ) : (
        <ul className="space-y-1">
          {result.tasks.map((t) => (
            <li key={t.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', PRIORITY_STYLE[t.priority])}>
              <button onClick={() => toggle(t)} disabled={t.implicit}
                className={cn('shrink-0', t.implicit && 'opacity-40 cursor-default')}>
                {t.done ? <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" /> : <Circle className="w-3.5 h-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs font-medium truncate', t.done && 'line-through')}>{t.label}</p>
                <p className="text-[9px] text-gray-400">{t.contractTitle} · {t.kind}{t.amount > 0 ? ` · $${t.amount.toLocaleString()}` : ''}</p>
              </div>
              <span className="text-[10px] shrink-0">{t.dueDate}</span>
              <span className="text-[10px] font-semibold shrink-0 w-16 text-right">
                {t.done ? 'done' : t.daysRemaining < 0 ? `${Math.abs(t.daysRemaining)}d overdue` : `${t.daysRemaining}d left`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
