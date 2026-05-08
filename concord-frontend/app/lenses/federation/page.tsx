'use client';

import { useState, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import dynamic from 'next/dynamic';

const TrustGraphView = dynamic(
  () => import('@/components/federation/TrustGraphView'),
  { ssr: false },
);

interface SearchHit {
  id?: string;
  dtuId?: string;
  title?: string;
  source?: string;
  peerName?: string;
  score?: number;
  snippet?: string;
}

export default function FederationPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [meta, setMeta] = useState<{ total?: number; fanout?: number } | null>(null);

  const runSearch = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/federation/search?q=${encodeURIComponent(q)}&limit=30`, {
        credentials: 'include',
      });
      const data = await r.json();
      setResults(data.results || []);
      setMeta({ total: data.total, fanout: data.fanout });
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [q]);

  return (
    <LensShell lensId="federation" asMain={false}>
      <ManifestActionBar />
    <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-amber-300">Federation</h1>
        <p className="text-gray-400 mt-1">
          Concord nodes peer with each other to share knowledge, trust, and DTU lineage.
          The graph below shows your peers and their trust scores. Use the search to
          query across all connected instances.
        </p>
      </header>

      <section className="mb-8">
        <TrustGraphView />
      </section>

      <section className="mb-8 rounded-lg border border-amber-500/30 bg-black/60 p-4">
        <h2 className="text-amber-300 font-semibold mb-3">Manage peers</h2>
        <PeerManager />
      </section>

      <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
        <h2 className="text-violet-300 font-semibold mb-3">Cross-instance search</h2>
        <div className="flex gap-2 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder='Try "drought-tolerant agriculture" or "post-quantum signing"...'
            className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searching || !q.trim()}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {meta && (
          <div className="text-xs text-gray-500 mb-3">
            {meta.total} result{meta.total === 1 ? '' : 's'} across {meta.fanout} instance{meta.fanout === 1 ? '' : 's'}.
          </div>
        )}

        {results === null ? null : results.length === 0 ? (
          <div className="text-gray-500 italic">No matches.</div>
        ) : (
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li
                key={`${r.dtuId ?? r.id ?? i}`}
                className="border-l-2 border-violet-400/40 pl-3 py-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-100 text-sm font-medium">{r.title ?? '(untitled)'}</span>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    r.source === 'self'
                      ? 'bg-amber-700/60 text-amber-200'
                      : 'bg-violet-700/60 text-violet-100'
                  }`}>
                    {r.source === 'self' ? 'local' : (r.peerName ?? r.source)}
                  </span>
                  {typeof r.score === 'number' && (
                    <span className="text-[10px] text-gray-500">{r.score.toFixed(3)}</span>
                  )}
                </div>
                {r.snippet && (
                  <div className="text-xs text-gray-400 mt-1">{r.snippet}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </LensShell>
  );
}

function PeerManager() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; instanceId?: string; name?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const probe = useCallback(async () => {
    if (!url) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/federation/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (data?.ok) {
        const peerName = data.peer?.name ?? data.peer?.federation?.name;
        const instanceId = data.peer?.instanceId ?? data.peer?.federation?.instanceId;
        setProbeResult({ ok: true, instanceId, name: peerName });
        setName(peerName ?? instanceId ?? '');
      } else {
        setProbeResult({ ok: false, error: data?.error ?? 'unreachable' });
      }
    } finally {
      setBusy(false);
    }
  }, [url]);

  const register = useCallback(async () => {
    if (!url || !probeResult?.ok || !probeResult.instanceId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/federation/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          instanceId: probeResult.instanceId,
          name: name || probeResult.instanceId,
          registryUrl: url,
        }),
      });
      const data = await r.json();
      if (data?.ok) {
        setMsg(`Peered with ${name || probeResult.instanceId}`);
        setUrl(''); setName(''); setProbeResult(null);
      } else {
        setMsg(`Failed: ${data?.error ?? 'unknown'}`);
      }
    } finally {
      setBusy(false);
    }
  }, [url, name, probeResult]);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2 items-center">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setProbeResult(null); }}
          placeholder="https://peer.concord.example"
          className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-2 text-gray-200"
        />
        <button
          type="button"
          onClick={probe}
          disabled={busy || !url}
          className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-xs"
        >
          {busy ? 'Probing...' : 'Probe'}
        </button>
      </div>

      {probeResult?.ok && (
        <div className="rounded bg-emerald-900/40 border border-emerald-400/30 p-3">
          <div className="text-emerald-200 text-xs">
            Reachable: <span className="font-mono">{probeResult.instanceId}</span>
          </div>
          <div className="flex gap-2 items-center mt-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 text-xs"
            />
            <button
              type="button"
              onClick={register}
              disabled={busy}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs"
            >
              Register peer
            </button>
          </div>
        </div>
      )}
      {probeResult && !probeResult.ok && (
        <div className="text-rose-300 text-xs">Probe failed: {probeResult.error}</div>
      )}
      {msg && <div className="text-amber-300 text-xs">{msg}</div>}
    </div>
  );
}
