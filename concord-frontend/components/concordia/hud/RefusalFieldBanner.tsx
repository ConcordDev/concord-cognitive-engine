'use client';

// Refusal Field Banner — top-of-screen indicator that fires when the
// Sovereign (or his quest beats / mass-raid phase progression) declares
// a Refusal Field for the current world. Reads /api/world/refusal-fields/
// :worldId and listens to the realtime world:refusal-field event so the
// banner pops the moment a field is declared.

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useSocket } from '@/hooks/useSocket';

interface Field {
  id: string;
  kind: string;
  reason?: string;
  glyphHint?: string | null;
  expiresAt: number;
}

const KIND_LABEL: Record<string, string> = {
  death_suspended:  'Death is refused',
  harvest_disabled: 'Harvest is refused',
  hostility_paused: 'Violence is refused',
  consequence_held: 'Consequence is refused',
  numbers_refused:  'Numbers are refused',
  dome_collapse:    'The arena collapses',
  win_refused:      'Victory is refused',
};

export default function RefusalFieldBanner({ worldId = 'concordia-hub' }: { worldId?: string }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const socket = useSocket();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/api/world/refusal-fields/${encodeURIComponent(worldId)}`);
      setFields((r.data?.fields ?? []) as Field[]);
    } catch { /* offline-tolerant */ }
  }, [worldId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onApply = (...args: unknown[]) => {
      const payload = args[0] as Field | undefined;
      if (!payload?.id) return;
      setFields((prev) => [...prev.filter((p) => p.id !== payload.id), payload]);
    };
    socket.on('world:refusal-field', onApply);
    return () => {
      const off = (socket as unknown as { off?: (event: string, cb: (...args: unknown[]) => void) => void }).off;
      if (off) off.call(socket, 'world:refusal-field', onApply);
    };
  }, [socket]);

  const live = fields.filter((f) => f.expiresAt > now);
  if (live.length === 0) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-1 max-w-[28rem]">
      {live.map((f) => {
        const remaining = Math.max(0, Math.floor((f.expiresAt - now) / 1000));
        return (
          <div
            key={f.id}
            className="bg-black/85 border border-amber-500/40 rounded-lg px-3 py-2 text-white text-xs flex items-center gap-3 shadow-2xl"
          >
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold tracking-wide">{KIND_LABEL[f.kind] ?? f.kind}</p>
              {f.reason && <p className="text-[10px] text-white/50 truncate">{f.reason}</p>}
            </div>
            <span className="text-[10px] text-amber-300 tabular-nums">{remaining}s</span>
          </div>
        );
      })}
    </div>
  );
}
