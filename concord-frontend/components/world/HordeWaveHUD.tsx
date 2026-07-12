'use client';

// Phase DB4 — Bullet heaven horde HUD + upgrade picker.
//
// Wave 4 gap-closure: the wave-upgrade offering used to be 9 cosmetic
// strings with no mechanical effect. It now offers structured {stat,value}
// boons (server/lib/run-draft.js) whose picked effect genuinely modifies
// this player's combat damage for the rest of the run (server/lib/
// run-modifiers.js). Every number shown below (modifiers, synergy hints)
// comes straight from the /api/horde/* response — nothing is invented
// client-side.

import { useCallback, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Zap, X, Sparkles } from 'lucide-react';
import { describeBoonEffect, describeModifierBundle, type BoonEffect } from '@/lib/run-boon-format';

interface ActiveHorde {
  id: string;
  world_id: string;
  started_at: number;
  wave_reached: number;
  kills: number;
  score: number;
  auto_attack: number;
  modifiers?: Record<string, number>;
  synergies?: { id: string; name: string }[];
}

interface Upgrade { id: string; name: string; effect: BoonEffect; tags?: string[]; }
interface SynergyHint { id: string; name: string; missingBoonId: string; }

export function HordeWaveHUD() {
  const [horde, setHorde] = useState<ActiveHorde | null>(null);
  const [choices, setChoices] = useState<Upgrade[]>([]);
  const [synergyHints, setSynergyHints] = useState<SynergyHint[]>([]);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch('/api/horde/active', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      setHorde(j?.ok ? (j.run || null) : null);
    } catch { /* swallow */ }
  }, []);

  useRealtimeRefresh(['horde:state'], refresh, { backstopMs: 3000 });

  // Listen for wave-advance from server (e.g. concordia:horde-wave-advance)
  // or trigger next wave on demand.
  const nextWave = useCallback(async () => {
    if (!horde) return;
    const r = await fetch(`/api/horde/${horde.id}/wave`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ killsThisWave: 0 }),
    });
    const j = await r.json();
    if (j?.ok && j.upgradeChoices) setChoices(j.upgradeChoices);
    if (j?.ok && j.synergyHints) setSynergyHints(j.synergyHints);
    refresh();
  }, [horde, refresh]);

  const pickUpgrade = useCallback(async (upgradeId: string) => {
    if (!horde) return;
    await fetch(`/api/horde/${horde.id}/upgrade`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upgradeId }),
    });
    setChoices([]);
    setSynergyHints([]);
    refresh();
  }, [horde, refresh]);

  const endRun = useCallback(async () => {
    if (!horde) return;
    await fetch(`/api/horde/${horde.id}/end`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    });
    refresh();
  }, [horde, refresh]);

  if (!horde) return null;

  const activeBoonLines = describeModifierBundle(horde.modifiers);

  return (
    <>
      <div className="concordia-hud-slide-right pointer-events-auto fixed bottom-24 right-4 z-30 w-52 rounded-lg border border-amber-500/40 bg-black/80 p-2 shadow-lg backdrop-blur-sm">
        <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300/70">
          <Zap size={11} />
          Horde — auto-attack
        </header>
        <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
          <div>
            <div className="text-[9px] text-amber-300/60">wave</div>
            <div className="font-mono text-lg text-amber-100">{horde.wave_reached}</div>
          </div>
          <div>
            <div className="text-[9px] text-amber-300/60">kills</div>
            <div className="font-mono text-lg text-amber-100">{horde.kills}</div>
          </div>
          <div>
            <div className="text-[9px] text-amber-300/60">score</div>
            <div className="font-mono text-lg text-amber-100">{horde.score}</div>
          </div>
        </div>
        {/* Wave 4 — the accumulated draft-pick modifier bundle. Real numbers
            straight off getActiveHorde()'s server-computed run.modifiers. */}
        {activeBoonLines.length > 0 && (
          <div className="mt-2 space-y-0.5 border-t border-amber-500/20 pt-1">
            {activeBoonLines.map((line) => (
              <div key={line} className="flex items-center gap-1 text-[9px] text-amber-200/90">
                <Sparkles size={9} className="text-amber-400" />
                {line}
              </div>
            ))}
            {(horde.synergies || []).map((s) => (
              <div key={s.id} className="text-[9px] font-semibold text-emerald-300">★ {s.name} synergy active</div>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-1">
          <button onClick={nextWave} className="flex-1 rounded bg-amber-500/30 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/40">
            Next wave
          </button>
          <button onClick={endRun} className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-700">
            End
          </button>
        </div>
      </div>

      {/* Upgrade picker modal */}
      {choices.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur">
          <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-zinc-950/95 p-4 shadow-2xl">
            <header className="mb-3 flex items-center justify-between border-b border-amber-500/20 pb-2">
              <h2 className="text-sm font-semibold text-amber-200">Wave {horde.wave_reached} cleared — pick a boon</h2>
              <button aria-label="Close" onClick={() => setChoices([])} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X size={12} /></button>
            </header>
            <div className="grid grid-cols-3 gap-2">
              {choices.map((u) => {
                const hint = synergyHints.find((h) => h.missingBoonId === u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => pickUpgrade(u.id)}
                    className="relative rounded border border-amber-500/30 bg-amber-500/5 p-3 text-left hover:border-amber-500/60 hover:bg-amber-500/15"
                  >
                    <div className="text-sm font-semibold text-amber-100">{u.name}</div>
                    <div className="mt-1 text-[10px] text-amber-300/80">{describeBoonEffect(u.effect)}</div>
                    {hint && (
                      <div className="mt-1 text-[9px] font-semibold text-emerald-300">
                        completes {hint.name}!
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
