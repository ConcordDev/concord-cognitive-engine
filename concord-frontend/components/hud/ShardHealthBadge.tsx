'use client';

/**
 * ShardHealthBadge — Phase F.
 *
 * Polls /api/worlds/:worldId/health every 10s and renders a small corner
 * badge indicating shard status: `healthy`, `catching-up`, `crashed`, or
 * `in-process` (sharding disabled).
 *
 * Public-read endpoint — no auth header required (Gate 1 bypass in
 * server.js handles this).
 */

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';

interface ShardHealth {
  worldId: string;
  status: string;
  sharded?: boolean;
  pid?: number | null;
  lastTickAt?: number;
  lastTickCount?: number;
  restartCount?: number;
}

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  ready: { dot: 'bg-emerald-400', label: 'shard healthy', text: 'text-emerald-300' },
  starting: { dot: 'bg-amber-400 animate-pulse', label: 'shard starting', text: 'text-amber-300' },
  'catching-up': { dot: 'bg-amber-400', label: 'shard catching up', text: 'text-amber-300' },
  crashed: { dot: 'bg-red-500 animate-pulse', label: 'shard restarting', text: 'text-red-300' },
  'no-shard': { dot: 'bg-slate-400', label: 'in-process', text: 'text-slate-400' },
};

export function ShardHealthBadge({ worldId }: { worldId: string }) {
  const [health, setHealth] = useState<ShardHealth | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/health`, {
          credentials: 'include',
        });
        const j = await r.json();
        if (!cancelled) setHealth(j);
      } catch {
        if (!cancelled) setHealth({ worldId, status: 'unknown' });
      }
    };
    fetchHealth();
    const id = setInterval(fetchHealth, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [worldId]);

  if (!health || (!health.sharded && health.status === 'no-shard')) {
    // Sharding disabled — don't clutter the HUD.
    return null;
  }

  const style = STATUS_STYLES[health.status] ?? STATUS_STYLES['no-shard'];

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={`World shard status: ${style.label}`}
      className={`group fixed bottom-2 left-2 z-30 flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] backdrop-blur ${style.text} hover:bg-slate-900`}
    >
      <Globe className="h-3 w-3" />
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
      <span>{style.label}</span>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[180px] rounded-md border border-slate-700 bg-slate-950 p-2 text-left text-[10px] text-slate-300 shadow-lg">
          <div className="font-mono text-slate-200">{worldId}</div>
          <div>status: <span className={style.text}>{health.status}</span></div>
          {health.pid != null && <div>pid: {health.pid}</div>}
          {health.lastTickAt ? (
            <div>last tick: {Math.round((Date.now() - health.lastTickAt) / 1000)}s ago</div>
          ) : null}
          {health.restartCount != null && health.restartCount > 0 && (
            <div className="text-amber-300">restarts: {health.restartCount}</div>
          )}
        </div>
      )}
    </button>
  );
}
