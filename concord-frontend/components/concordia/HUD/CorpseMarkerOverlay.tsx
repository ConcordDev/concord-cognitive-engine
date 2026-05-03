'use client';

// Simple overlay that polls /api/world/creature/corpses/:worldId and
// shows clickable cards for each unclaimed corpse the player can
// butcher. Click → opens ButcheringMinigame → on complete posts to
// /api/world/creature/:corpseId/butcher with the quality multiplier.
//
// Lives next to ActiveEffectsBar in the world HUD. We render as a
// flat list rather than projecting world-space markers because the
// projection layer (WorldMarkers) deserves its own integration that
// reads camera state — this overlay is the "just gets the job done"
// version that ships now.

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { Skull, Loader2, Sparkles } from 'lucide-react';

const ButcheringMinigame = dynamic(() => import('@/components/concordia/crafting/ButcheringMinigame'), { ssr: false });

interface Corpse {
  id: string;
  world_id: string;
  species_id: string;
  killer_user_id: string | null;
  x: number; y: number; z: number;
  expires_at: number;
}

interface Props {
  worldId?: string;
  toolTier?: number;
}

export default function CorpseMarkerOverlay({ worldId = 'concordia-hub', toolTier = 1 }: Props) {
  const [corpses, setCorpses] = useState<Corpse[]>([]);
  const [active, setActive] = useState<Corpse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [last, setLast] = useState<{ id: string; drops: { item: string; quantity: number; quality: string }[] } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get(`/api/world/creature/corpses/${encodeURIComponent(worldId)}`);
      setCorpses((r.data?.corpses ?? []) as Corpse[]);
    } catch { /* offline-tolerant */ }
  }, [worldId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8_000); // 8s polling — corpses last ~30 min
    return () => clearInterval(t);
  }, [refresh]);

  async function complete(qualityMultiplier: number) {
    if (!active) return;
    setSubmitting(true);
    try {
      const r = await api.post(`/api/world/creature/${encodeURIComponent(active.id)}/butcher`, { qualityMultiplier });
      setLast({ id: active.id, drops: r.data?.drops ?? [] });
      setCorpses((prev) => prev.filter((c) => c.id !== active.id));
    } catch { /* swallow — refresh will reconcile */ }
    finally {
      setSubmitting(false);
      setActive(null);
    }
  }

  const recent = corpses.slice(0, 4);
  if (recent.length === 0 && !active && !last) return null;

  return (
    <>
      <div className="fixed bottom-3 right-3 z-30 flex flex-col gap-1 max-w-[18rem]">
        {recent.map((c) => {
          const remaining = Math.max(0, c.expires_at - Math.floor(Date.now() / 1000));
          const minutes = Math.floor(remaining / 60);
          return (
            <button
              key={c.id}
              onClick={() => setActive(c)}
              className="bg-black/70 border border-red-500/30 hover:border-red-400 rounded-lg p-2 text-white text-xs flex items-center gap-2 transition-colors"
            >
              <Skull className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="flex-1 truncate font-mono">{c.species_id}</span>
              <span className="text-white/40 tabular-nums text-[10px]">{minutes}m</span>
            </button>
          );
        })}
        {last && (
          <div className="bg-black/85 border border-emerald-500/40 rounded-lg p-2 text-white text-xs">
            <div className="inline-flex items-center gap-1 text-emerald-300 mb-1">
              <Sparkles className="w-3.5 h-3.5" /> Butchered
            </div>
            <ul className="space-y-0.5 text-[11px] text-white/70">
              {last.drops.map((d, i) => (
                <li key={i}>{d.quantity}× {d.item.replace(/-/g, ' ')} <span className="text-white/40">({d.quality})</span></li>
              ))}
            </ul>
            <button onClick={() => setLast(null)} className="text-[10px] text-white/40 hover:text-white mt-1">dismiss</button>
          </div>
        )}
      </div>

      {active && !submitting && (
        <ButcheringMinigame
          toolTier={toolTier}
          speciesName={active.species_id}
          onComplete={complete}
          onCancel={() => setActive(null)}
        />
      )}
      {submitting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
      )}
    </>
  );
}
