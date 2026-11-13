'use client';

import { useState } from 'react';
import { useArtifacts } from '@/lib/hooks/use-lens-artifacts';
import { Zap, Activity } from 'lucide-react';

export function SyncPanel({ onSynced: _onSynced }: { onSynced: () => void }) {
  const [result] = useState<string | null>(null);
  const [error] = useState<string | null>(null);

  // Recent sync events from the lens-artifact runtime.
  const recentEvents = useArtifacts<{ kind: string; result?: string; at: string }>('federation', {
    type: 'peer-event', limit: 10,
  });

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Zap className="w-4 h-4" /> Sync
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        {/* FIX-federation-001: this panel used to offer "Run sync now",
            POSTing /api/federation/sync — a route that does not exist —
            under copy describing an instance-wide pass a member cannot
            run. Federation sync runs on the server's own cycle; what a
            member can honestly be shown is the recorded event log. */}
        Federation sync runs on the server&apos;s own cycle — it is not a
        member action, and there is no manual trigger. Completed and failed
        passes are recorded in the event log below.
      </p>
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
