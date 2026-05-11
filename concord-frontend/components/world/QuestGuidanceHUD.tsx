'use client';

/**
 * QuestGuidanceHUD — Sprint 9 player-facing guidance surface.
 *
 * Two parts:
 *   1. A small floating "?" recovery button bottom-right (always on).
 *      Click → reveals the current active objective + hint text +
 *      pings the 3D waypoint beacon for 4 s ("look HERE if you lost it").
 *   2. A persistent active-objective card top-left when an objective
 *      exists (collapsed to a chip; click to expand).
 *
 * Backed by `guidance_waypoint.active_objective` macro. Polls every 8s.
 * Posts a `concordia:waypoint-pulse` window event when the recovery
 * button is pressed; the 3D beacon listens and amplifies its pulse for
 * the 4 s window.
 */

import { useEffect, useState, useCallback } from 'react';

interface Objective {
  kind: string;
  questId: number | null;
  questTitle?: string;
  description?: string;
  worldId: string;
  worldPos: { x: number; y?: number; z: number } | null;
  npcId: string | null;
}

interface ActiveObjectiveResponse {
  ok: boolean;
  objective: Objective | null;
  hint: string;
  worldId: string;
}

export default function QuestGuidanceHUD() {
  const [objective, setObjective] = useState<Objective | null>(null);
  const [hint, setHint] = useState<string>('');
  const [showHint, setShowHint] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);

  const fetchObjective = useCallback(async () => {
    try {
      const worldId = typeof window !== 'undefined'
        ? localStorage.getItem('concordia:activeWorldId') || 'concordia-hub'
        : 'concordia-hub';
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'guidance_waypoint', name: 'active_objective',
          input: { worldId },
        }),
      });
      if (!r.ok) return;
      const j = await r.json();
      const payload = (j.result || j) as ActiveObjectiveResponse;
      if (payload?.ok) {
        setObjective(payload.objective);
        setHint(payload.hint || '');
      }
    } catch { /* offline — silent */ }
  }, []);

  useEffect(() => {
    fetchObjective();
    const id = setInterval(fetchObjective, 8000);
    return () => clearInterval(id);
  }, [fetchObjective]);

  const onRecover = () => {
    setShowHint(true);
    // Broadcast a pulse event the 3D beacon listens for.
    try {
      window.dispatchEvent(new CustomEvent('concordia:waypoint-pulse', {
        detail: { durationMs: 4000 },
      }));
    } catch { /* noop */ }
    // Auto-hide the hint after 12s so it doesn't linger.
    setTimeout(() => setShowHint(false), 12000);
  };

  const objKindColor = objective?.kind === 'premonition'
    ? 'bg-purple-500/85 text-purple-50'
    : objective?.kind === 'lattice_born'
      ? 'bg-orange-500/85 text-orange-50'
      : 'bg-emerald-500/85 text-emerald-50';
  const objKindLabel = objective?.kind === 'premonition'
    ? 'Premonition'
    : objective?.kind === 'lattice_born'
      ? 'World Stirring'
      : 'Active Quest';

  return (
    <>
      {/* Active-objective card (top-left, only when objective exists) */}
      {objective && (
        <div className="fixed top-4 left-4 z-30 select-none" data-testid="quest-guidance-card">
          <button
            onClick={() => setCardExpanded(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/85 backdrop-blur ring-1 ring-zinc-700/60 shadow-lg text-xs font-medium text-zinc-100 hover:bg-zinc-800/95 transition-colors"
          >
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${objKindColor}`}>
              {objKindLabel}
            </span>
            <span className="text-zinc-200">
              {objective.questTitle || objective.description?.slice(0, 50) || 'Follow the beacon'}
            </span>
            {objective.npcId && (
              <span className="text-[10px] text-zinc-500">→ {objective.npcId}</span>
            )}
          </button>
          {cardExpanded && (
            <div className="mt-2 w-72 px-4 py-3 rounded-xl bg-zinc-900/95 backdrop-blur ring-1 ring-zinc-700/60 shadow-2xl text-xs text-zinc-100">
              <div className="font-medium mb-1.5">{objective.questTitle || 'Active Objective'}</div>
              {objective.description && (
                <p className="text-zinc-300 leading-snug mb-2">{objective.description}</p>
              )}
              {objective.worldPos && (
                <div className="text-[10px] text-zinc-500 font-mono">
                  beacon at ({Math.round(objective.worldPos.x)},{' '}
                  {Math.round(objective.worldPos.z)})
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recovery "?" button (bottom-right, always on) */}
      <div className="fixed bottom-6 right-6 z-30 select-none flex flex-col items-end gap-2">
        {showHint && hint && (
          <div className="max-w-sm px-4 py-2.5 rounded-xl bg-zinc-900/95 backdrop-blur ring-1 ring-zinc-700/60 shadow-2xl text-xs text-zinc-100 leading-relaxed">
            {hint}
          </div>
        )}
        <button
          onClick={onRecover}
          className="w-12 h-12 rounded-full bg-zinc-900/85 backdrop-blur ring-2 ring-amber-500/40 shadow-lg text-xl font-semibold text-amber-300 hover:bg-zinc-800/95 hover:ring-amber-500/70 transition-all"
          title="Where am I supposed to go? Concordia will tell you."
          data-testid="quest-guidance-recover"
        >
          ?
        </button>
      </div>
    </>
  );
}
