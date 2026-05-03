'use client';

// Active Effects Bar — small HUD widget showing the player's currently
// active buffs/debuffs from /api/world/effects/me. Listens to the
// realtime 'player:effect-applied' event so a freshly-eaten consumable
// shows up immediately without a poll round-trip.
//
// Each effect row renders a countdown that ticks locally; we resync
// from the server every 10s to keep clocks honest.

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useSocket } from '@/hooks/useSocket';
import { Sparkles, Skull } from 'lucide-react';

interface Effect {
  effect_id: string;
  kind: 'buff' | 'debuff';
  magnitude: number;
  source_dtu_id?: string;
  started_at: number;
  expires_at: number;
}

function fmtTime(s: number): string {
  if (s <= 0) return '0s';
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export default function ActiveEffectsBar() {
  const [effects, setEffects] = useState<Effect[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const socket = useSocket();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/api/world/effects/me');
      setEffects((r.data?.effects ?? []) as Effect[]);
    } catch { /* offline-tolerant */ }
  }, []);

  // Initial load + 10s resync.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  // 1s local clock so countdowns animate.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime push from the consume endpoint. useSocket types `on` as
  // (...args: unknown[]) so we narrow defensively at the boundary.
  useEffect(() => {
    if (!socket) return;
    const onApplied = (...args: unknown[]) => {
      const payload = args[0] as { userId?: string; effect?: Partial<Effect> & { expires_in_s?: number } } | undefined;
      const e = payload?.effect;
      if (!e?.effect_id) return;
      const expiresAt = e.expires_at ?? Math.floor(Date.now() / 1000) + Number(e.expires_in_s ?? 60);
      setEffects((prev) => {
        const filtered = prev.filter((p) => p.effect_id !== e.effect_id);
        return [
          ...filtered,
          {
            effect_id: e.effect_id!,
            kind: (e.kind as 'buff' | 'debuff') ?? 'buff',
            magnitude: e.magnitude ?? 1,
            source_dtu_id: e.source_dtu_id,
            started_at: e.started_at ?? Math.floor(Date.now() / 1000),
            expires_at: expiresAt,
          },
        ];
      });
    };
    socket.on('player:effect-applied', onApplied);
    return () => {
      const off = (socket as unknown as { off?: (event: string, cb: (...args: unknown[]) => void) => void }).off;
      if (off) off.call(socket, 'player:effect-applied', onApplied);
    };
  }, [socket]);

  // Drop expired effects from local state without waiting for a refetch.
  const live = effects.filter((e) => e.expires_at > now);

  if (live.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-40 flex flex-col gap-1 bg-black/70 border border-white/10 rounded-lg p-2 text-white text-xs max-w-[14rem]">
      {live.map((e) => {
        const remaining = e.expires_at - now;
        const isBuff = e.kind === 'buff';
        return (
          <div key={`${e.effect_id}_${e.started_at}`} className="flex items-center gap-2">
            {isBuff ? <Sparkles className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> : <Skull className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
            <span className="flex-1 truncate font-mono">{e.effect_id}</span>
            <span className={`tabular-nums ${remaining < 10 ? 'text-amber-300' : 'text-white/60'}`}>{fmtTime(remaining)}</span>
          </div>
        );
      })}
    </div>
  );
}
