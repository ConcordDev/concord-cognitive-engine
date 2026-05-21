'use client';

/**
 * CrtPayoutPanel — itemized payout history ledger. The creator records
 * past withdrawals (amount, method, status, reference) and the panel
 * lists them with completed / pending / failed totals. All real input.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Banknote, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Payout {
  id: string;
  amount: number;
  method: string;
  status: 'pending' | 'completed' | 'failed';
  reference: string | null;
  note: string | null;
  at: string;
  completedAt: string | null;
}
interface PayoutResult {
  payouts: Payout[];
  count: number;
  totals: { completed: number; pending: number; failed: number };
}

const METHODS = ['bank', 'stripe', 'paypal', 'crypto', 'other'];
const STATUS_FILTERS: { id: 'all' | 'pending' | 'completed' | 'failed'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
];
const STATUS_ICON = {
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  pending: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  failed: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
};

export function CrtPayoutPanel() {
  const [result, setResult] = useState<PayoutResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all');
  const [form, setForm] = useState({ amount: '', method: 'bank', status: 'pending', reference: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'payout-history', { status: filter });
    if (r.data?.ok) setResult(r.data.result as PayoutResult);
    else setResult(null);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const record = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) { setError('Amount must be positive.'); return; }
    const r = await lensRun('creator', 'payout-record', {
      amount,
      method: form.method,
      status: form.status,
      reference: form.reference.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ amount: '', method: 'bank', status: 'pending', reference: '' });
    setError(null);
    await refresh();
  };

  const advanceStatus = async (id: string, status: 'completed' | 'failed') => {
    const r = await lensRun('creator', 'payout-update-status', { id, status });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const payouts = result?.payouts ?? [];

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {result && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Completed" value={`$${result.totals.completed.toLocaleString()}`} accent="text-emerald-300" />
          <Stat label="Pending" value={`$${result.totals.pending.toLocaleString()}`} accent="text-amber-300" />
          <Stat label="Failed" value={`$${result.totals.failed.toLocaleString()}`} accent="text-rose-300" />
        </div>
      )}

      {/* Record a payout. */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5 text-red-400" /> Record payout
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input
            placeholder="Amount"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <select
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize"
          >
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize"
          >
            <option value="pending">pending</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
          </select>
          <input
            placeholder="Reference"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <button
            type="button"
            onClick={record}
            className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Record
          </button>
        </div>
      </section>

      {/* Filter + ledger. */}
      <div className="flex rounded-lg border border-zinc-700 overflow-hidden w-fit">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium',
              filter === f.id ? 'bg-red-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {payouts.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No payouts recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {payouts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              {STATUS_ICON[p.status]}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-100">
                  ${p.amount.toLocaleString()}
                  <span className="text-zinc-500 capitalize"> · {p.method}</span>
                  {p.reference && <span className="text-zinc-500"> · {p.reference}</span>}
                </p>
                <p className="text-[10px] text-zinc-600">
                  {new Date(p.at).toLocaleDateString()}
                  {p.completedAt && ` · completed ${new Date(p.completedAt).toLocaleDateString()}`}
                </p>
              </div>
              {p.status === 'pending' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => advanceStatus(p.id, 'completed')}
                    className="text-[10px] px-1.5 py-0.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded"
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => advanceStatus(p.id, 'failed')}
                    className="text-[10px] px-1.5 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded"
                  >
                    Fail
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className={cn('text-lg font-bold', accent)}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
    </div>
  );
}
