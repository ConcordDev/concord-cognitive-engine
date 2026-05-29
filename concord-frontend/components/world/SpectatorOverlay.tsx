'use client';

// Phase E7 — Spectator overlay.
// Small badge that appears bottom-left when the player is spectating
// an active session. Triggered via `concordia:enter-spectator-mode`
// events; uses the existing `spectator.subscribe` macro to subscribe
// to the world's spectator channel. Dismiss via the close button or
// `concordia:exit-spectator-mode`.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Eye, X } from 'lucide-react';
import { sfx } from '@/lib/concordia/juice';

interface SpectatorPayload {
  worldId: string;
  context?: string; // 'brawl' | 'horror' | 'roguelite' | etc.
  participants?: string[];
  meta?: Record<string, unknown>;
}

export function SpectatorOverlay() {
  const [active, setActive] = useState<SpectatorPayload | null>(null);
  const [subscribers, setSubscribers] = useState<number | null>(null);

  useEffect(() => {
    const onEnter = (e: Event) => {
      const detail = (e as CustomEvent<SpectatorPayload>).detail;
      if (detail?.worldId) {
        setActive(detail);
        sfx('ui_spectate_join');
        // Best-effort: fire the spectator.subscribe macro so the server
        // knows we're watching. If the call fails (auth, network), we
        // still show the badge — it's a visual indication, not a gate.
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'spectator', name: 'subscribe', input: { worldId: detail.worldId } }),
        }).catch(() => {});
      }
    };
    const onExit = () => { setActive(null); setSubscribers(null); };
    window.addEventListener('concordia:enter-spectator-mode', onEnter);
    window.addEventListener('concordia:exit-spectator-mode', onExit);
    return () => {
      window.removeEventListener('concordia:enter-spectator-mode', onEnter);
      window.removeEventListener('concordia:exit-spectator-mode', onExit);
    };
  }, []);

  const refreshCount = useCallback(async () => {
    if (!active?.worldId) return;
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'spectator', name: 'list_for_world', input: { worldId: active.worldId } }),
      });
      const j = await r.json();
      const list = j?.data?.spectators || j?.spectators || [];
      if (Array.isArray(list)) setSubscribers(list.length);
    } catch { /* swallow */ }
  }, [active?.worldId]);

  useRealtimeRefresh(['spectator:count-updated'], refreshCount, { backstopMs: 15_000, enabled: !!active });

  const exit = () => {
    window.dispatchEvent(new CustomEvent('concordia:exit-spectator-mode'));
  };

  if (!active) return null;

  return (
    <div className="concordia-hud-slide-left pointer-events-auto fixed bottom-4 left-4 z-30 w-64 rounded-lg border border-purple-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-purple-300" />
          <div>
            <div className="text-xs font-semibold text-purple-200">Spectating</div>
            <div className="text-[10px] text-purple-300/70">
              {active.context ? `${active.context} · ` : ''}{active.worldId}
              {subscribers != null && ` · ${subscribers} watching`}
            </div>
          </div>
        </div>
        <button onClick={exit} className="rounded p-1 text-zinc-400 hover:bg-zinc-800" title="Stop spectating">
          <X size={11} />
        </button>
      </div>
      {active.participants && active.participants.length > 0 && (
        <div className="mt-2 text-[10px] text-purple-300/80">
          {active.participants.map((p) => p.slice(0, 12)).join(' · ')}
        </div>
      )}
    </div>
  );
}
