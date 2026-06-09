'use client';

/**
 * InsuranceClaimsPanel — file claims, advance their status and record
 * payouts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Claim {
  id: string; carrier: string; description: string; kind: string;
  status: string; claimAmount: number; payoutAmount?: number;
  submittedDate: string; daysSinceSubmit?: number;
}

const STATUS_FLOW: Record<string, string> = {
  submitted: 'under_review', under_review: 'approved', approved: 'paid',
};
const STATUS_COLOR: Record<string, string> = {
  submitted: 'text-sky-400', under_review: 'text-amber-400', approved: 'text-blue-400',
  denied: 'text-rose-400', paid: 'text-emerald-400', closed: 'text-zinc-400',
};

export function InsuranceClaimsPanel({ onChange }: { onChange: () => void }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ carrier: '', description: '', kind: 'collision', claimAmount: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('insurance', 'claim-list', {});
    setClaims(r.data?.result?.claims || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const fileClaim = async () => {
    if (!form.carrier.trim() || !form.description.trim()) { setError('Carrier and description are required.'); return; }
    const r = await lensRun('insurance', 'claim-file', {
      carrier: form.carrier.trim(), description: form.description.trim(),
      kind: form.kind, claimAmount: Number(form.claimAmount) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ carrier: '', description: '', kind: 'collision', claimAmount: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const advance = async (c: Claim) => {
    const next = STATUS_FLOW[c.status];
    if (!next) return;
    const payoutAmount = next === 'paid' ? c.claimAmount : undefined;
    await lensRun('insurance', 'claim-update', { id: c.id, status: next, payoutAmount });
    await refresh();
  };
  const deny = async (c: Claim) => { await lensRun('insurance', 'claim-update', { id: c.id, status: 'denied' }); await refresh(); };
  const del = async (id: string) => { await lensRun('insurance', 'claim-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{claims.length}</span> claims</span>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> File claim
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Carrier" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['collision', 'comprehensive', 'property', 'health', 'life', 'liability', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Claim amount ($)" inputMode="decimal" value={form.claimAmount} onChange={(e) => setForm({ ...form, claimAmount: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={fileClaim}
            className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Submit claim</button>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No claims filed.
        </div>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => (
            <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{c.description}</p>
                  <p className="text-[11px] text-zinc-400 capitalize">
                    {c.carrier} · {c.kind} · ${c.claimAmount}
                    {c.payoutAmount != null ? ` · paid $${c.payoutAmount}` : ''}
                    {c.daysSinceSubmit != null ? ` · ${c.daysSinceSubmit}d ago` : ''}
                  </p>
                </div>
                <span className={cn('text-[10px] uppercase', STATUS_COLOR[c.status] || 'text-zinc-400')}>
                  {c.status.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-2">
                {STATUS_FLOW[c.status] && (
                  <button type="button" onClick={() => advance(c)}
                    className="text-[11px] px-2 py-0.5 bg-blue-700/30 text-blue-300 rounded-lg capitalize">
                    → {STATUS_FLOW[c.status].replace(/_/g, ' ')}
                  </button>
                )}
                {['submitted', 'under_review'].includes(c.status) && (
                  <button type="button" onClick={() => deny(c)}
                    className="text-[11px] px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-lg">Deny</button>
                )}
                <button aria-label="Delete" type="button" onClick={() => del(c.id)} className="ml-auto text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
