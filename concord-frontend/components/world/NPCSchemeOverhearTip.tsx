'use client';

// Phase F3.4 — overhear-tip for resolved NPC schemes.
// Subscribes to the npc:scheme-resolved event from F3.1. When a scheme
// resolves and the player is within 30m of the plotting NPC, surfaces
// a 4-second toast with a flavor line.
//
// Dedup-by-id pattern borrowed from DriftAlertToast.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';

interface SchemeEvent {
  schemeId: string;
  plotterKind: 'npc' | 'player';
  plotterId: string;
  targetKind: string;
  targetId: string;
  kind: string;
  outcome: 'complete' | 'exposed' | 'abandoned';
}

interface Toast {
  id: string;
  npcId: string;
  text: string;
  expiresAt: number;
}

const PROXIMITY_M = 30;
const TOAST_TTL_MS = 4000;

function flavorLine(scheme: SchemeEvent): string {
  const verbByKind: Record<string, string> = {
    assassinate: 'a debt that ends in a knife',
    blackmail: 'a name held over a head',
    sabotage: 'a planned ruin',
    elope: 'a journey by night',
    forge: 'a paper that should not exist',
    rumour: 'a story that just changed',
  };
  const verbByOutcome: Record<string, string> = {
    complete: 'finished',
    exposed: 'discovered',
    abandoned: 'abandoned',
  };
  const what = verbByKind[scheme.kind] || `a private affair (${scheme.kind})`;
  const how = verbByOutcome[scheme.outcome] || scheme.outcome;
  return `You overhear murmuring — ${what}, ${how}.`;
}

export function NPCSchemeOverhearTip() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());

  const surfaceToast = useCallback((scheme: SchemeEvent) => {
    if (seen.current.has(scheme.schemeId)) return;
    seen.current.add(scheme.schemeId);

    // Proximity gate. window.__concordiaPlayerPos is set by AvatarSystem3D.
    // If the player isn't placed yet, we still show the toast (player
    // could be in a non-world surface). The 30m gate matters only when
    // a position is available.
    const playerPos = (typeof window !== 'undefined' && (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos) || null;
    const npcPos = (typeof window !== 'undefined' && (window as { __concordiaNpcPositions?: Record<string, { x: number; z: number }> }).__concordiaNpcPositions?.[scheme.plotterId]) || null;
    if (playerPos && npcPos) {
      const d = Math.hypot(playerPos.x - npcPos.x, playerPos.z - npcPos.z);
      if (d > PROXIMITY_M) return; // out of earshot
    }

    const toast: Toast = {
      id: scheme.schemeId,
      npcId: scheme.plotterId,
      text: flavorLine(scheme),
      expiresAt: Date.now() + TOAST_TTL_MS,
    };
    setToasts((t) => [...t, toast]);

    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== toast.id));
    }, TOAST_TTL_MS);
  }, []);

  useEffect(() => {
    const onResolved = (e: Event) => {
      const detail = (e as CustomEvent<SchemeEvent>).detail;
      if (detail?.schemeId && detail.plotterKind === 'npc') surfaceToast(detail);
    };
    window.addEventListener('concordia:npc-scheme-resolved', onResolved);
    return () => window.removeEventListener('concordia:npc-scheme-resolved', onResolved);
  }, [surfaceToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="concordia-hud-fade pointer-events-none fixed bottom-32 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-md border border-purple-500/40 bg-zinc-950/90 px-3 py-1.5 text-[11px] italic text-purple-100 shadow-md backdrop-blur"
        >
          <Eye size={11} className="mr-1 inline text-purple-300" /> {t.text}
        </div>
      ))}
    </div>
  );
}
