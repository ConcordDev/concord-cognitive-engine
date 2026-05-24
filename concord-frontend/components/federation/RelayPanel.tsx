'use client';

// Relay subscriptions — subscribe to a relay for broader discovery.
// Macros: federation.subscribeRelay, listRelays, pollRelay, unsubscribeRelay.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { Radio, Loader2, Plus, Trash2, RefreshCw } from 'lucide-react';

interface Relay {
  id: string;
  url: string;
  domain: string;
  name: string;
  status: string;
  subscribedAt: number;
  lastPullAt: number | null;
  discoveredPeers: number;
}

interface RelayResult {
  relays: Relay[];
  total: number;
}

export function RelayPanel() {
  const [data, setData] = useState<RelayResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<RelayResult>('federation', 'listRelays', {});
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const subscribe = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'subscribeRelay', {
        url: url.trim(), name: name.trim() || undefined,
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setUrl(''); setName('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [url, name, load]);

  const poll = useCallback(async (id: string) => {
    setActing(id);
    try {
      await lensRun('federation', 'pollRelay', { id });
      await load();
    } finally {
      setActing(null);
    }
  }, [load]);

  const unsubscribe = useCallback(async (id: string) => {
    setActing(id);
    try {
      await lensRun('federation', 'unsubscribeRelay', { id });
      await load();
    } finally {
      setActing(null);
    }
  }, [load]);

  return (
    <section className="rounded-lg border border-indigo-500/30 bg-black/60 p-4">
      <h2 className="text-indigo-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Radio className="w-4 h-4" /> Relay subscriptions
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Subscribe to a relay to discover peers beyond your direct neighbours.
        Poll a relay to run a discovery pass.
      </p>

      {/* Subscribe form */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://relay.example"
          className="flex-1 min-w-[220px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-400"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="display name (optional)"
          className="flex-1 min-w-[160px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <button
          type="button"
          onClick={subscribe}
          disabled={busy || !url.trim()}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Subscribe
        </button>
      </div>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading relays…</p>
      ) : !data || data.relays.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No relay subscriptions.</p>
      ) : (
        <ul className="space-y-2">
          {data.relays.map((r) => (
            <li key={r.id} className="border border-white/10 rounded p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-100 truncate">{r.name}</span>
                  <span className="text-[10px] uppercase tracking-wide bg-indigo-900/40 border border-indigo-500/30 text-indigo-300 rounded px-1.5 py-0.5">
                    {r.status}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 truncate">{r.url}</div>
                <div className="text-[10px] text-gray-400 mt-1">
                  discovered peers: {r.discoveredPeers} · last pull:{' '}
                  {r.lastPullAt ? new Date(r.lastPullAt).toLocaleString() : 'never'}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => poll(r.id)}
                  disabled={acting === r.id}
                  className="px-2 py-1 text-xs bg-indigo-700/60 hover:bg-indigo-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {acting === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Poll
                </button>
                <button
                  type="button"
                  onClick={() => unsubscribe(r.id)}
                  disabled={acting === r.id}
                  className="px-2 py-1 text-xs bg-rose-700/60 hover:bg-rose-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" /> Drop
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
