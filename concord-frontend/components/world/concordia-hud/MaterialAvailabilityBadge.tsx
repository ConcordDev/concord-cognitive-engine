'use client';

/**
 * MaterialAvailabilityBadge — ambient HUD readout that surfaces the
 * per-world material constraints. Polls cross_world_effectiveness.for_player
 * every 12s and renders:
 *
 *   - a NO AMMO badge when ballistic_ammo is depleted in the current world
 *   - a SCARCE badge when ballistic_ammo is scarce
 *   - a small chip row showing the other three material kinds
 *
 * Distinct from skill_affinity (which dampens the skill itself). This is
 * about whether the CONSUMABLES the skill needs are available locally —
 * a gun fires the same in any world, but in tunya / fantasy you can't
 * find cartridges.
 *
 * Hidden in combat / dialogue / vehicle / photo modes.
 */

import { useEffect, useState } from 'react';
import { useHUDContext } from './HUDContextProvider';

type Tier = 'abundant' | 'moderate' | 'scarce' | 'depleted';

interface MaterialReadout {
  ballistic_ammo: { value: number; tier: Tier };
  magical_reagents: { value: number; tier: Tier };
  tech_parts: { value: number; tier: Tier };
  bloodline_fuel: { value: number; tier: Tier };
}

const KIND_LABELS: Record<string, string> = {
  ballistic_ammo: 'Ammo',
  magical_reagents: 'Reagents',
  tech_parts: 'Tech',
  bloodline_fuel: 'Bloodline',
};

const TIER_TONE: Record<Tier, string> = {
  abundant: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40',
  moderate: 'bg-zinc-900/40 text-zinc-300 border-zinc-700/40',
  scarce:   'bg-amber-900/40 text-amber-300 border-amber-700/50',
  depleted: 'bg-red-900/50 text-red-300 border-red-700/60',
};

export function MaterialAvailabilityBadge() {
  const mode = useHUDContext((s) => s.inputMode);
  const worldId = useHUDContext((s) => s.worldId);
  const [materials, setMaterials] = useState<MaterialReadout | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'cross_world_effectiveness', name: 'for_player', input: { worldId } }),
        });
        const j = await r.json();
        if (!cancelled && j?.ok && j.materials) setMaterials(j.materials as MaterialReadout);
      } catch { /* poll is best-effort */ }
    }
    poll();
    const id = setInterval(poll, 12000);
    return () => { cancelled = true; clearInterval(id); };
  }, [worldId]);

  if (mode === 'combat' || mode === 'dialogue' || mode === 'vehicle' || mode === 'photo') return null;
  if (!materials) return null;

  const ammoTier = materials.ballistic_ammo?.tier;
  const showAmmoWarning = ammoTier === 'depleted' || ammoTier === 'scarce';

  return (
    <div
      className="fixed left-3 top-[20rem] z-30 max-w-[14rem] space-y-1 pointer-events-none"
      data-testid="hud-material-availability"
      data-world-id={worldId}
    >
      {showAmmoWarning && (
        <div
          data-material-warning="ballistic_ammo"
          data-tier={ammoTier}
          className={`px-2 py-1 rounded border text-[10px] uppercase tracking-wider font-bold ${TIER_TONE[ammoTier]}`}
          role="status"
        >
          {ammoTier === 'depleted' ? '⚠ No ammo' : 'Ammo scarce'}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(['ballistic_ammo', 'magical_reagents', 'tech_parts', 'bloodline_fuel'] as const).map((kind) => {
          const m = materials[kind];
          if (!m) return null;
          return (
            <span
              key={kind}
              data-material-kind={kind}
              data-tier={m.tier}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${TIER_TONE[m.tier]}`}
            >
              {KIND_LABELS[kind]} {Math.round(m.value * 100)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}
