'use client';

// Allowlist / blocklist / defederation controls — federation domain.
// Macros: federation.setPeerPolicy, listPeerPolicies, removePeerPolicy.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ShieldCheck, ShieldX, Clock, Trash2, Loader2, Plus, Filter } from 'lucide-react';

type Policy = 'allow' | 'block' | 'pending';

interface PolicyEntry {
  domain: string;
  policy: Policy;
  reason: string;
  addedAt: number;
  updatedAt: number;
}

interface PolicyResult {
  entries: PolicyEntry[];
  counts: Record<Policy, number>;
  total: number;
}

const POLICY_META: Record<Policy, { label: string; cls: string; icon: typeof ShieldCheck }> = {
  allow: { label: 'Allowed', cls: 'text-emerald-300 bg-emerald-900/40 border-emerald-500/30', icon: ShieldCheck },
  block: { label: 'Blocked', cls: 'text-rose-300 bg-rose-900/40 border-rose-500/30', icon: ShieldX },
  pending: { label: 'Pending', cls: 'text-amber-300 bg-amber-900/40 border-amber-500/30', icon: Clock },
};

export function PeerPolicyPanel() {
  const [data, setData] = useState<PolicyResult | null>(null);
  const [filter, setFilter] = useState<'' | Policy>('');
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState('');
  const [policy, setPolicy] = useState<Policy>('block');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<PolicyResult>('federation', 'listPeerPolicies', filter ? { filter } : {});
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'setPeerPolicy', {
        domain: domain.trim(), policy, reason: reason.trim(),
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setDomain(''); setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [domain, policy, reason, load]);

  const remove = useCallback(async (d: string) => {
    await lensRun('federation', 'removePeerPolicy', { domain: d });
    await load();
  }, [load]);

  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4" /> Allowlist / blocklist
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Defederation controls. Blocked domains never exchange DTUs or trust.
        Peers with no explicit policy default to allowed.
      </p>

      {/* Add policy */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="peer domain (e.g. peer.concord.example)"
          className="flex-1 min-w-[220px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-amber-400"
        />
        <select
          value={policy}
          onChange={(e) => setPolicy(e.target.value as Policy)}
          className="bg-black/60 border border-white/10 rounded px-2 py-2 text-sm text-gray-200"
        >
          <option value="allow">Allow</option>
          <option value="block">Block</option>
          <option value="pending">Pending</option>
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
          className="flex-1 min-w-[160px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !domain.trim()}
          className="px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Set
        </button>
      </div>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {/* Counts + filter */}
      <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
        <Filter className="w-3.5 h-3.5 text-gray-500" />
        {(['', 'allow', 'block', 'pending'] as const).map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded border ${
              filter === f
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            {f === '' ? 'All' : POLICY_META[f].label}
            {f !== '' && data ? ` (${data.counts[f] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-gray-500 italic">Loading policies…</p>
      ) : !data || data.entries.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No policies set. Default-allow is in effect.</p>
      ) : (
        <ul className="space-y-2">
          {data.entries.map((e) => {
            const meta = POLICY_META[e.policy];
            const Icon = meta.icon;
            return (
              <li key={e.domain} className="border border-white/10 rounded p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-100 font-mono truncate">{e.domain}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${meta.cls}`}>
                      <Icon className="w-3 h-3" /> {meta.label}
                    </span>
                  </div>
                  {e.reason && <div className="text-[11px] text-gray-500 mt-1">{e.reason}</div>}
                  <div className="text-[10px] text-gray-600 mt-1">
                    updated {new Date(e.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(e.domain)}
                  className="px-2 py-1 text-xs bg-rose-700/60 hover:bg-rose-700 rounded text-white inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
