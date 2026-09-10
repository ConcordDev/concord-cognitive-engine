'use client';

import { useState } from 'react';
import {
  useArtifacts,
  useCreateArtifact,
} from '@/lib/hooks/use-lens-artifacts';
import { Zap, Loader2, Activity } from 'lucide-react';

export function SyncPanel({ onSynced }: { onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recent sync events from the lens-artifact runtime.
  const recentEvents = useArtifacts<{ kind: string; result?: string; at: string }>('federation', {
    type: 'peer-event', limit: 10,
  });
  const createSyncEvent = useCreateArtifact<{ kind: string; result?: string; at: string }>('federation');

  async function sync() {
    setSyncing(true); setError(null); setResult(null);
    try {
      const r = await fetch('/api/federation/sync', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || data?.ok === false) {
        const err = data?.error ?? `Sync failed (${r.status}).`;
        setError(err);
        createSyncEvent.mutate({
          type: 'peer-event',
          title: `Sync failed: ${err}`,
          data: { kind: 'sync', result: err, at: new Date().toISOString() },
          meta: { tags: ['federation', 'sync'], status: 'error', visibility: 'private' },
        });
      } else {
        const summary = JSON.stringify(data ?? {}).slice(0, 120);
        setResult(`Sync ok · ${summary}`);
        createSyncEvent.mutate({
          type: 'peer-event',
          title: 'Federation sync ok',
          data: { kind: 'sync', result: 'ok', at: new Date().toISOString() },
          meta: { tags: ['federation', 'sync'], status: 'ok', visibility: 'private' },
        });
        onSynced();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Zap className="w-4 h-4" /> Manual sync
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Triggers a federation pass: pulls new shadow DTUs from peers, pushes
        any pending posts queued locally, and refreshes peer last-seen timestamps.
      </p>
      <button
        onClick={sync}
        disabled={syncing}
        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {syncing ? 'Syncing…' : 'Run sync now'}
      </button>
      {result && <p className="mt-2 text-emerald-300 text-xs break-all">{result}</p>}
      {error  && <p className="mt-2 text-rose-300 text-xs">{error}</p>}

      <div className="mt-5 border-t border-white/10 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1">
          <Activity className="w-3 h-3" /> Recent federation events
        </div>
        {recentEvents.isLoading ? (
          <p className="text-xs text-gray-400 italic">Loading events…</p>
        ) : !recentEvents.data?.artifacts || recentEvents.data.artifacts.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No events yet. Probe a peer or trigger a sync to populate.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {recentEvents.data.artifacts.map((a) => {
              const data = a.data as { kind?: string; at?: string };
              const status = (a.meta?.status as string) || 'ok';
              return (
                <li key={a.id} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-rose-400' : 'bg-amber-400'
                  }`} />
                  <span className="text-gray-200 flex-1 truncate">{a.title}</span>
                  <span className="text-gray-400 text-[10px]">
                    {new Date(data?.at ?? a.createdAt).toLocaleString()}
                  </span>
                  {data?.kind && (
                    <span className="text-[10px] uppercase tracking-wide bg-white/5 border border-white/10 rounded px-1 text-gray-400">
                      {data.kind}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
