'use client';

// Phase DC14 — NPC asymmetry inspector.
// Modal listening for `concordia:open-trait-inspector` { npcId } events
// (dispatched from DA1 NPC menu "Inspect Traits"). Reads
// /api/npc/:npcId/asymmetry and surfaces persistent_grudge /
// current_preoccupation / asymmetric_desire toward THIS player.

import { useCallback, useEffect, useState } from 'react';
import { Eye, X, Skull, Flame, Heart, Loader2 } from 'lucide-react';

interface Asymmetry {
  grudge?: { kind?: string; intensity?: number; rationale?: string; } | null;
  preoccupation?: { kind?: string; weight?: number; rationale?: string; } | null;
  desire?: { kind?: string; intensity?: number; rationale?: string; } | null;
}

export function NPCTraitInspector() {
  const [npcId, setNpcId] = useState<string | null>(null);
  const [asym, setAsym] = useState<Asymmetry | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (id: string) => {
    setNpcId(id);
    setAsym(null);
    setPending(true);
    try {
      const j = await fetch(`/api/npc/${id}/asymmetry`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setAsym(j.asymmetry || {});
    } finally { setPending(false); }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { npcId?: string };
      if (detail?.npcId) load(detail.npcId);
    };
    window.addEventListener('concordia:open-trait-inspector', handler);
    window.addEventListener('concordia:inspect-npc-traits', handler);
    return () => {
      window.removeEventListener('concordia:open-trait-inspector', handler);
      window.removeEventListener('concordia:inspect-npc-traits', handler);
    };
  }, [load]);

  const close = () => { setNpcId(null); setAsym(null); };

  if (!npcId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur" onClick={close}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-center justify-between border-b border-zinc-700 pb-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Eye size={14} /> Inspect traits
            </h2>
            <p className="text-[10px] text-zinc-500 font-mono">{npcId}</p>
          </div>
          <button onClick={close} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={14} />
          </button>
        </header>

        {pending ? (
          <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-zinc-400" size={20} /></div>
        ) : !asym ? (
          <p className="py-6 text-center text-xs text-zinc-500">No asymmetry data.</p>
        ) : (
          <div className="space-y-2">
            <TraitRow icon={<Skull size={14} />} label="Persistent grudge" color="red" t={asym.grudge} />
            <TraitRow icon={<Flame size={14} />} label="Current preoccupation" color="amber" t={asym.preoccupation} />
            <TraitRow icon={<Heart size={14} />} label="Asymmetric desire (toward you)" color="pink" t={asym.desire} />
            {!asym.grudge && !asym.preoccupation && !asym.desire && (
              <p className="text-center text-xs text-zinc-500">This NPC has neutral feelings toward you.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TraitRow({ icon, label, color, t }: { icon: React.ReactNode; label: string; color: 'red' | 'amber' | 'pink'; t?: { kind?: string; intensity?: number; weight?: number; rationale?: string; } | null; }) {
  if (!t || (!t.kind && !t.rationale)) return null;
  const palette: Record<string, string> = {
    red: 'border-red-500/40 bg-red-950/30 text-red-200',
    amber: 'border-amber-500/40 bg-amber-950/30 text-amber-200',
    pink: 'border-pink-500/40 bg-pink-950/30 text-pink-200',
  };
  const mag = t.intensity ?? t.weight;
  return (
    <div className={['rounded border p-2', palette[color]].join(' ')}>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider opacity-70">
        <span className="flex items-center gap-1">{icon} {label}</span>
        {mag != null && <span className="font-mono">{Math.round(mag * 100)}%</span>}
      </div>
      {t.kind && <div className="text-sm font-semibold">{t.kind}</div>}
      {t.rationale && <div className="mt-1 text-[10px] opacity-80">{t.rationale}</div>}
    </div>
  );
}
