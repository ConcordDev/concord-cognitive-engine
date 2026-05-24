'use client';

// Per-peer sync policy — what content classes flow which direction.
// Macros: federation.setSyncPolicy, listSyncPolicies.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ArrowLeftRight, ArrowDown, ArrowUp, Loader2, Save } from 'lucide-react';

interface SyncPolicyEntry {
  domain: string;
  inbound: boolean;
  outbound: boolean;
  classes: string[];
  updatedAt: number;
}

interface SyncPolicyResult {
  entries: SyncPolicyEntry[];
  total: number;
  validClasses: string[];
}

export function SyncPolicyPanel() {
  const [data, setData] = useState<SyncPolicyResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [domain, setDomain] = useState('');
  const [inbound, setInbound] = useState(true);
  const [outbound, setOutbound] = useState(true);
  const [classes, setClasses] = useState<string[]>(['dtu']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const validClasses = data?.validClasses ?? ['dtu', 'trust', 'activity', 'moderation', 'media', 'lineage'];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<SyncPolicyResult>('federation', 'listSyncPolicies', {});
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleClass = useCallback((c: string) => {
    setClasses((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }, []);

  const submit = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'setSyncPolicy', {
        domain: domain.trim(), inbound, outbound, classes,
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setDomain('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [domain, inbound, outbound, classes, load]);

  return (
    <section className="rounded-lg border border-cyan-500/30 bg-black/60 p-4">
      <h2 className="text-cyan-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <ArrowLeftRight className="w-4 h-4" /> Per-peer sync policy
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Control which content classes flow in each direction with a given peer.
      </p>

      {/* Form */}
      <div className="space-y-2 mb-3">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="peer domain"
          className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-400"
        />
        <div className="flex gap-3 flex-wrap text-xs">
          <label className="inline-flex items-center gap-1.5 text-gray-300">
            <input type="checkbox" checked={inbound} onChange={(e) => setInbound(e.target.checked)} />
            <ArrowDown className="w-3.5 h-3.5 text-emerald-400" /> Inbound
          </label>
          <label className="inline-flex items-center gap-1.5 text-gray-300">
            <input type="checkbox" checked={outbound} onChange={(e) => setOutbound(e.target.checked)} />
            <ArrowUp className="w-3.5 h-3.5 text-amber-400" /> Outbound
          </label>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {validClasses.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleClass(c)}
              className={`px-2 py-1 rounded text-[11px] border ${
                classes.includes(c)
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !domain.trim()}
          className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save policy
        </button>
      </div>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading policies…</p>
      ) : !data || data.entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No sync policies set.</p>
      ) : (
        <ul className="space-y-2">
          {data.entries.map((e) => (
            <li key={e.domain} className="border border-white/10 rounded p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono text-gray-100 truncate">{e.domain}</span>
                {e.inbound && (
                  <span className="text-[10px] bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                    <ArrowDown className="w-3 h-3" /> in
                  </span>
                )}
                {e.outbound && (
                  <span className="text-[10px] bg-amber-900/40 border border-amber-500/30 text-amber-300 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                    <ArrowUp className="w-3 h-3" /> out
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                classes: <span className="font-mono">{e.classes.join(', ')}</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                updated {new Date(e.updatedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
