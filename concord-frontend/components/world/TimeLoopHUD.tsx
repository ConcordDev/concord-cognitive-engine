'use client';

// Phase DB13 — Time loop indicator HUD.
// Top-right banner when player has an active time_loop_session in the
// current world. Shows loop_number + remaining time. As the loop nears
// expiry, dispatches `concordia:world-tint` events for shader-driven red
// shift (existing avatar shader pipeline consumes these).

import { useCallback, useEffect, useState } from 'react';
import { Hourglass, RotateCcw } from 'lucide-react';

interface ActiveLoop {
  id: string;
  loop_number: number;
  duration_s: number;
  started_at: number;
}

const POLL_MS = 2000;

export function TimeLoopHUD() {
  const [loop, setLoop] = useState<ActiveLoop | null>(null);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    setWorldId(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!worldId) return;
    try {
      const j = await fetch(`/api/time-loop/active/${worldId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      setLoop(j?.ok && j.session ? j.session : null);
    } catch { /* swallow */ }
  }, [worldId]);

  useEffect(() => {
    if (!worldId) return;
    refresh();
    const r = setInterval(refresh, POLL_MS);
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearInterval(r); clearInterval(t); };
  }, [worldId, refresh]);

  // Shader tint dispatch based on remaining-time ratio (1.0 fresh, 0.0 expired).
  useEffect(() => {
    if (!loop) return;
    const elapsed = now - loop.started_at;
    const ratio = Math.max(0, Math.min(1, 1 - (elapsed / loop.duration_s)));
    // ratio 1 → no tint, 0 → full red.
    const intensity = 1 - ratio;
    window.dispatchEvent(new CustomEvent('concordia:world-tint', {
      detail: { source: 'time-loop', color: [intensity * 0.4, 0, 0], intensity },
    }));
  }, [loop, now]);

  if (!loop) return null;

  const elapsed = now - loop.started_at;
  const remaining = Math.max(0, loop.duration_s - elapsed);
  const ratio = remaining / loop.duration_s;
  const critical = ratio < 0.15;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="concordia-hud-slide-right pointer-events-auto fixed right-4 top-24 z-25 w-52 rounded-lg border border-violet-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
      <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-300/70">
        <RotateCcw size={11} />
        Time loop #{loop.loop_number}
      </header>
      <div className="text-center">
        <div className={['flex items-center justify-center gap-1 font-mono text-2xl', critical ? 'text-red-300' : 'text-violet-100'].join(' ')}>
          <Hourglass size={16} />
          {mins}:{String(secs).padStart(2, '0')}
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
          <div
            className={critical ? 'h-full bg-red-500 transition-all' : 'h-full bg-violet-400 transition-all'}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <a
          href={`/api/time-loop/memories/${worldId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[10px] text-violet-300 hover:text-violet-100"
        >
          loop {loop.loop_number} memory
        </a>
      </div>
    </div>
  );
}
