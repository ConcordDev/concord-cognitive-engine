'use client';

// Phase E7 — Brawl matchmaking queue UI.
// Listens for `concordia:open-brawl-queue` (dispatched from the
// command palette + the GameModesHotbarGroup brawl button). Shows
// current queue status; lets the player join or leave.
// On pair, the existing BrawlInviteToast surfaces the synthesised
// invite via the `concordia:brawl-invited` socket event.

import { useCallback, useEffect, useState } from 'react';
import { Swords, X, Loader2 } from 'lucide-react';
import { successJuice, sfx } from '@/lib/concordia/juice';

interface QueueStatus { ok: boolean; size?: number; inQueue?: boolean; joinedAt?: number | null; }

export function BrawlMatchmakingQueue() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [waitSec, setWaitSec] = useState(0);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('concordia:open-brawl-queue', handler);
    return () => window.removeEventListener('concordia:open-brawl-queue', handler);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/brawl/queue/status', { credentials: 'include' }).then(r => r.json());
      setStatus(j);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 3000);
    const w = setInterval(() => setWaitSec((s) => s + 1), 1000);
    return () => { clearInterval(t); clearInterval(w); };
  }, [open, refresh]);

  // Reset wait clock when in/out state flips.
  useEffect(() => { if (!status?.inQueue) setWaitSec(0); }, [status?.inQueue]);

  const join = useCallback(async () => {
    setPending(true);
    try {
      const r = await fetch('/api/brawl/queue/join', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j?.ok) successJuice('ui_brawl_queue_join');
      refresh();
    } finally { setPending(false); }
  }, [refresh]);

  const leave = useCallback(async () => {
    setPending(true);
    try {
      await fetch('/api/brawl/queue/leave', { method: 'POST', credentials: 'include' });
      sfx('ui_brawl_queue_leave');
      refresh();
    } finally { setPending(false); }
  }, [refresh]);

  // Auto-close when invite gets accepted elsewhere (BrawlInviteToast
  // handles the actual invite; we just step out of the way).
  useEffect(() => {
    if (!open) return;
    const onInvite = () => setOpen(false);
    window.addEventListener('concordia:brawl-invited', onInvite);
    return () => window.removeEventListener('concordia:brawl-invited', onInvite);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="concordia-hud-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
    >
      <div className="w-80 rounded-xl border border-rose-500/40 bg-zinc-950/95 p-4 shadow-2xl">
        <header className="mb-3 flex items-center justify-between border-b border-rose-500/20 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-200">
            <Swords size={14} /> Brawl matchmaker
          </h2>
          <button aria-label="Open" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={14} />
          </button>
        </header>

        <div className="space-y-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-rose-300/70">queue size</div>
          <div className="font-mono text-3xl text-rose-100">{status?.size ?? '—'}</div>

          {status?.inQueue ? (
            <>
              <div className="text-xs text-rose-200">
                In queue · waiting {Math.floor(waitSec / 60)}:{String(waitSec % 60).padStart(2, '0')}
              </div>
              <p className="text-[10px] text-rose-300/70">
                Heartbeat pops pairs every minute. Once you&apos;re paired, the brawl-invite toast appears in the lower right.
              </p>
              <button
                onClick={leave}
                disabled={pending}
                className="w-full rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="inline animate-spin" size={12} /> : 'Leave queue'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-rose-200">Find a sparring partner. Sifu-brawler 1v1, no death.</p>
              <button
                onClick={join}
                disabled={pending}
                className="w-full rounded bg-rose-500/40 px-3 py-1.5 text-xs text-rose-50 hover:bg-rose-500/60 disabled:opacity-50"
              >
                {pending ? <Loader2 className="inline animate-spin" size={12} /> : 'Join queue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
