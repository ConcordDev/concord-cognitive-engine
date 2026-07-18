'use client';

// Wave 4 gap-closure — Size Scaling HUD (Foundry Phase-7 Ant-Man/Giant
// system, docs/lens-specs/foundry-capability-map.md "Honest residual").
//
// server/lib/foundry/size-scaling.js (clampScale / scaleEffects /
// scaledCombatProfile / setPlayerScale / getPlayerScale) + the size.get /
// size.set / size.combat_profile macros were real and tested but had zero
// frontend caller. This HUD is that caller.
//
// Config-gated: useFoundrySystemGate('size-scaling') reads the current
// world's real rule_modulators.foundry.systems + rule_modulators.size_scaling
// (both written at Foundry publish time from the worldspec's selected
// systems/config — server/lib/foundry/compiler.js) — this HUD renders
// nothing for a world whose worldspec never selected size-scaling, and the
// slider bounds + gameplay-effect claims (flight/destruction access) always
// come straight from the real size.get/size.set macro response, never
// computed client-side.

import { useCallback, useEffect, useState } from 'react';
import { Maximize2, Minimize2, X, Wind, Hammer } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useFoundrySystemGate } from './useFoundrySystemGate';

interface ScaleEffects {
  band: 'small' | 'normal' | 'large';
  scale: number;
  multiplier: number;
  canFly: boolean;
  canDestroy: boolean;
  stealthBonus: number;
  reachBonus: number;
}

interface Props {
  worldId: string;
}

export function SizeScalingHUD({ worldId }: Props) {
  const gate = useFoundrySystemGate(worldId, 'size-scaling');
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number | null>(null);
  const [effects, setEffects] = useState<ScaleEffects | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minScale = Number(gate.config.minScale ?? 15);
  const maxScale = Number(gate.config.maxScale ?? 800);

  const refresh = useCallback(async () => {
    if (!gate.enabled || !worldId) return;
    try {
      const r = await lensRun<{ scale: number; effects: ScaleEffects }>('size', 'get', { worldId });
      if (r.data?.ok && r.data.result) {
        setScale(r.data.result.scale);
        setEffects(r.data.result.effects);
        setPending(r.data.result.scale);
        setError(null);
      } else {
        setError(r.data?.error || 'Could not load current scale');
      }
    } catch {
      setError('Could not load current scale');
    }
  }, [gate.enabled, worldId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener('concordia:open-size-scaling', onOpen);
    return () => window.removeEventListener('concordia:open-size-scaling', onOpen);
  }, []);

  const apply = useCallback(async (requested: number) => {
    if (!worldId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<{ scale: number; effects: ScaleEffects; cost: string }>('size', 'set', {
        worldId, scale: requested,
      });
      if (r.data?.ok && r.data.result) {
        setScale(r.data.result.scale);
        setEffects(r.data.result.effects);
        setPending(r.data.result.scale);
      } else {
        setError(r.data?.error || 'Scale change rejected');
      }
    } catch {
      setError('Scale change failed');
    } finally {
      setBusy(false);
    }
  }, [worldId]);

  // Honest gate: renders nothing for a world that never selected size-scaling.
  if (!gate.loaded || !gate.enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Size scaling"
        className="pointer-events-auto fixed bottom-64 right-4 z-20 rounded-lg border border-teal-500/30 bg-black/70 px-2 py-1.5 text-center text-[10px] text-teal-200 backdrop-blur-sm hover:bg-teal-500/10"
      >
        <Maximize2 size={12} className="mb-0.5 inline" />
        <div>Size</div>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        >
          <div className="w-full max-w-sm rounded-xl border border-teal-500/40 bg-zinc-950/95 p-4 shadow-2xl">
            <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-teal-200">
                <Maximize2 size={14} /> Size scaling
              </h2>
              <button aria-label="Close" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
                <X size={12} />
              </button>
            </header>

            {error && <p className="mb-2 text-[11px] text-rose-300">{error}</p>}

            {scale === null ? (
              <p className="py-4 text-center text-[12px] text-zinc-500">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{minScale}%</span>
                  <span className="text-lg font-semibold text-teal-100">{scale}%</span>
                  <span>{maxScale}%</span>
                </div>
                <input
                  type="range"
                  min={minScale}
                  max={maxScale}
                  step={1}
                  value={pending ?? scale}
                  disabled={busy}
                  onChange={(e) => setPending(Number(e.target.value))}
                  className="w-full accent-teal-500"
                  aria-label="Requested scale percent"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply(minScale)}
                    className="flex flex-1 items-center justify-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[10px] text-teal-100 hover:bg-teal-500/20 disabled:opacity-40"
                  >
                    <Minimize2 size={10} /> Shrink
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply(100)}
                    className="flex-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply(maxScale)}
                    className="flex flex-1 items-center justify-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[10px] text-teal-100 hover:bg-teal-500/20 disabled:opacity-40"
                  >
                    <Maximize2 size={10} /> Grow
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy || pending === scale}
                  onClick={() => pending !== null && apply(pending)}
                  className="w-full rounded border border-teal-500/40 bg-teal-500/20 px-2 py-1.5 text-[11px] font-medium text-teal-100 hover:bg-teal-500/30 disabled:opacity-40"
                >
                  Apply {pending}%
                </button>

                {effects && (
                  <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[10px] text-zinc-300">
                    <div className="mb-1 uppercase tracking-wider text-zinc-500">Band: {effects.band}</div>
                    <ul className="space-y-0.5">
                      <li className="flex items-center gap-1.5">
                        <Wind size={10} className={effects.canFly ? 'text-sky-300' : 'text-zinc-600'} />
                        {effects.canFly ? 'Flight access granted' : 'No flight access at this scale'}
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Hammer size={10} className={effects.canDestroy ? 'text-amber-300' : 'text-zinc-600'} />
                        {effects.canDestroy ? 'Structural destruction unlocked' : 'No destruction access at this scale'}
                      </li>
                      {effects.stealthBonus > 0 && <li>Stealth bonus: +{Math.round(effects.stealthBonus * 100)}%</li>}
                      {effects.reachBonus > 0 && <li>Reach bonus: +{Math.round(effects.reachBonus * 100)}%</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SizeScalingHUD;
