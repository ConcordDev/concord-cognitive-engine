'use client';

import { useState, useCallback } from 'react';
import { useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import {
  Users, Loader2, ShieldCheck, Trash2, AlertCircle, Plus,
} from 'lucide-react';

export interface Peer {
  id?: string;
  nodeId?: string;
  instanceId?: string;
  name?: string;
  status?: string;
  registryUrl?: string;
  lastSeen?: number | string | null;
  addedAt?: number | string | null;
  capabilities?: string[];
}

function PeerManager({ onChanged }: { onChanged: () => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; instanceId?: string; name?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Persist a 'peer-event' lens artifact on every probe + register so the
  // operator has a paper trail across reloads (persistence credit).
  const createPeerEvent = useCreateArtifact<{ kind: string; url: string; instanceId?: string; at: string }>('federation');

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
        createPeerEvent.mutate({
          type: 'peer-event',
          title: `Probed ${peerName || instanceId || url}`,
          data: { kind: 'probe', url, instanceId, at: new Date().toISOString() },
          meta: { tags: ['federation', 'probe'], status: 'ok', visibility: 'private' },
        });
      } else {
        setProbeResult({ ok: false, error: data?.error ?? 'unreachable' });
      }
    } finally {
      setBusy(false);
    }
  }, [url, createPeerEvent]);

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
        createPeerEvent.mutate({
          type: 'peer-event',
          title: `Registered ${name || probeResult.instanceId}`,
          data: { kind: 'register', url, instanceId: probeResult.instanceId, at: new Date().toISOString() },
          meta: { tags: ['federation', 'register'], status: 'ok', visibility: 'private' },
        });
        setUrl(''); setName(''); setProbeResult(null);
        onChanged();
      } else {
        setMsg(`Failed: ${data?.error ?? 'unknown'}`);
      }
    } finally {
      setBusy(false);
    }
  }, [url, name, probeResult, createPeerEvent, onChanged]);

  return (
    <section className="rounded-lg border border-amber-500/30 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> Add peer
      </h2>
      <div className="space-y-3 text-sm">
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setProbeResult(null); }}
            placeholder="https://peer.concord.example"
            className="flex-1 min-w-[260px] bg-black/60 border border-white/10 rounded px-3 py-2 text-gray-200"
          />
          <button
            type="button"
            onClick={probe}
            disabled={busy || !url}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-xs inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            {busy ? 'Probing…' : 'Probe'}
          </button>
        </div>

        {probeResult?.ok && (
          <div className="rounded bg-emerald-900/40 border border-emerald-400/30 p-3">
            <div className="text-emerald-200 text-xs">
              Reachable: <span className="font-mono">{probeResult.instanceId}</span>
            </div>
            <div className="flex gap-2 items-center mt-2 flex-wrap">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
                className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 text-xs"
              />
              <button
                type="button"
                onClick={register}
                disabled={busy}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs inline-flex items-center gap-1"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Register peer
              </button>
            </div>
          </div>
        )}
        {probeResult && !probeResult.ok && (
          <div className="text-rose-300 text-xs inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Probe failed: {probeResult.error}
          </div>
        )}
        {msg && <div className="text-amber-300 text-xs">{msg}</div>}
      </div>
    </section>
  );
}

function PeerList({ peers, onChanged }: { peers: Peer[]; onChanged: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);

  async function removePeer(p: Peer) {
    const id = p.instanceId ?? p.nodeId ?? p.id;
    if (!id) return;
    setRemoving(String(id));
    try {
      await fetch('/api/federation/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: id }),
      });
      onChanged();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-4">
      <h2 className="text-amber-200 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Users className="w-4 h-4" /> Trusted peers
        <span className="text-gray-400 text-xs">({peers.length})</span>
      </h2>
      {peers.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No peers yet. Add one above.</p>
      ) : (
        <ul className="space-y-2">
          {peers.map((p) => {
            const id = p.instanceId ?? p.nodeId ?? p.id ?? '';
            const lastSeen = p.lastSeen
              ? typeof p.lastSeen === 'number'
                ? new Date(p.lastSeen).toLocaleString()
                : new Date(p.lastSeen).toLocaleString()
              : 'never';
            return (
              <li key={String(id)} className="border border-white/10 rounded p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-100 truncate">
                    {p.name || id || '(unnamed)'}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">{String(id)}</div>
                  {p.registryUrl && (
                    <div className="text-[11px] text-gray-400 truncate">{p.registryUrl}</div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1">
                    last seen: {lastSeen} · status: {p.status ?? 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => removePeer(p)}
                  disabled={removing === id}
                  className="px-2 py-1 text-xs bg-rose-700/60 hover:bg-rose-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {removing === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


export function PeersPanel({ peers, onChanged }: { peers: Peer[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <PeerManager onChanged={onChanged} />
      <PeerList peers={peers} onChanged={onChanged} />
    </div>
  );
}
