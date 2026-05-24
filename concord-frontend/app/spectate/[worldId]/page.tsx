'use client';

/**
 * /spectate/[worldId] — read-only world feed.
 *
 * Phase 9.2 #9: live-streamable Concordia. Subscribes to a world
 * via spectator.subscribe + heartbeats every 30s. Shows ambient
 * stats overlay + real-time event feed. No combat, no intervention.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Spectator {
  id: number;
  viewer_user_id: string | null;
  started_at: number;
}

interface Dispatch {
  id: number;
  tone: string;
  body: string;
  composed_at: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SpectatePage() {
  const params = useParams<{ worldId: string }>();
  const worldId = params?.worldId || 'concordia-hub';
  const [token, setToken] = useState<string | null>(null);
  const [spectators, setSpectators] = useState<Spectator[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);

  useEffect(() => {
    let alive = true;
    let heartbeatInterval: number | null = null;
    let refreshInterval: number | null = null;

    (async () => {
      const sub = await macro('spectator', 'subscribe', { worldId });
      if (!alive || !sub?.ok) return;
      setToken(sub.sessionToken);

      heartbeatInterval = window.setInterval(() => {
        macro('spectator', 'heartbeat', { sessionToken: sub.sessionToken });
      }, 30_000);

      const refresh = async () => {
        const [s, d] = await Promise.all([
          macro('spectator', 'list_for_world', { worldId }),
          macro('goddess', 'recent', { worldId, limit: 10 }),
        ]);
        if (!alive) return;
        if (s?.ok) setSpectators(s.spectators || []);
        if (d?.ok) setDispatches(d.dispatches || []);
      };
      void refresh();
      refreshInterval = window.setInterval(refresh, 15_000);
    })();

    return () => {
      alive = false;
      if (heartbeatInterval) window.clearInterval(heartbeatInterval);
      if (refreshInterval) window.clearInterval(refreshInterval);
    };
  }, [worldId]);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Top stats strip */}
      <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-2 flex items-center gap-4 text-xs">
        <span className="text-zinc-100 font-bold uppercase tracking-wider">Spectating</span>
        <span className="text-zinc-300 font-mono">{worldId}</span>
        <span className="text-zinc-400">·</span>
        <span className="text-zinc-400">{spectators.length} viewers</span>
        {token && <span className="text-[10px] text-zinc-400 font-mono ml-auto">session {token.slice(0, 8)}</span>}
      </div>

      <div className="grid md:grid-cols-3 gap-4 p-4">
        {/* World scene placeholder — full ConcordiaScene mount in follow-up */}
        <div className="md:col-span-2 bg-zinc-900/60 border border-zinc-800 rounded-xl aspect-video flex items-center justify-center">
          <p className="text-zinc-400 italic text-sm">
            World renderer (read-only) mounts here when the spectator-mode ConcordiaScene flag is set.
          </p>
        </div>

        {/* Goddess feed */}
        <aside className="bg-zinc-900/80 border border-purple-800/40 rounded-xl p-3 max-h-[70vh] overflow-y-auto">
          <h2 className="text-xs font-bold uppercase tracking-wider text-purple-300 mb-2">Goddess Feed</h2>
          {dispatches.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">The goddess is silent.</p>
          ) : (
            <ul className="space-y-2">
              {dispatches.map(d => (
                <li key={d.id} className="text-[11px] border-l-2 border-purple-700/50 pl-2 py-1">
                  <p className="text-purple-200 italic">{d.body}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-400 font-mono">{d.tone} · {new Date(d.composed_at * 1000).toLocaleTimeString()}</p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
