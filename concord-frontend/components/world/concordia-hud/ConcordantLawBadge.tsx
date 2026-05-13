'use client';

/**
 * ConcordantLawBadge — passive ambient indicator that shows ONLY when
 * the player is inside the Concordia hub. Surfaces the Three Above All's
 * decree: violence is refused in this city. The server enforces the
 * gate (combat/attack returns concordant_law_refusal 403); this badge
 * tells the player WHY their swing did nothing.
 *
 * Hidden in combat / dialogue / vehicle / photo modes (those screens
 * own the surface). Also hidden outside the hub.
 */

import { useHUDContext } from './HUDContextProvider';

const HUB_WORLD_IDS = new Set(['concordia-hub', 'concordia']);

export function ConcordantLawBadge() {
  const mode = useHUDContext((s) => s.inputMode);
  const worldId = useHUDContext((s) => s.worldId);

  if (!HUB_WORLD_IDS.has(worldId)) return null;
  if (mode === 'combat' || mode === 'dialogue' || mode === 'vehicle' || mode === 'photo') return null;

  return (
    <div
      className="fixed left-3 bottom-20 z-30 max-w-[18rem] bg-zinc-950/85 border border-indigo-700/50 rounded-md backdrop-blur-md px-3 py-2 pointer-events-none"
      data-testid="hud-concordant-law-badge"
      role="status"
      aria-label="Concordant Law in effect"
    >
      <p className="text-[10px] uppercase tracking-wider text-indigo-300/90 font-bold">Concordant Law</p>
      <p className="mt-0.5 text-[10px] text-zinc-400 leading-snug">
        The Three Above All refuse violence within Concordia. Travel out via Concord Link to engage in combat.
      </p>
    </div>
  );
}
