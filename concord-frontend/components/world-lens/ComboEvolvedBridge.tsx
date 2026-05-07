'use client';

/**
 * ComboEvolvedBridge — make `combat:combo-evolved` LOUD.
 *
 * Subscribes to the socket event the server emits whenever
 * `evolveFighterCombos` produces a new branch. For each evolved combo:
 *
 *   1. Dispatches `concordia:combo-evolved` window event so the existing
 *      CombatFlowHotbar refreshes its combo list (it already listens).
 *   2. Triggers the GameJuice fanfare for the player so the moment lands
 *      with audio + cinematic emphasis (tier-5 → cinematic letterbox).
 *   3. Fires `dispatchComboVfx(tier)` from lib/combat/combo-vfx so the
 *      tier-appropriate particle / shake / hit-stop polish channels run.
 *   4. Posts a toast naming the new combo.
 *
 * The combo name comes from `pickName(agg, fighterId)` server-side
 * (lib/combat/flow-engine.js) — a deterministic-procedural composition
 * of step verbs (Hammer→Strike→Slam style). Future: optionally
 * round-trip through the conscious brain for more poetic naming.
 *
 * Mount once near GameJuice in the world page. No JSX surface — purely
 * a socket→window-event + UI bridge component.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';
import { dispatchComboVfx } from '@/lib/combat/combo-vfx';
import { emitHitStop, emitScreenShake } from '@/components/world/ImpactFeedback';

interface EvolvedCombo {
  id: string;
  name: string;
  context: string;
  tier: number;
  uses: number;
  successRate: number;
  evolvedNow: boolean;
}

export function ComboEvolvedBridge() {
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;

    const off = subscribe<{ userId: string; evolved: EvolvedCombo[] }>(
      'combat:combo-evolved',
      (payload) => {
        const newOnes = (payload.evolved ?? []).filter((e) => e.evolvedNow);
        if (newOnes.length === 0) return;

        // Refresh the hotbar via the window event it already listens for.
        try {
          window.dispatchEvent(new CustomEvent('concordia:combo-evolved'));
        } catch { /* ok */ }

        for (const combo of newOnes) {
          // Tier-driven polish channels: particles, shake, hit-stop, flash,
          // optional cinematic letterbox + slow-mo at tier 5.
          try {
            dispatchComboVfx({
              tier: combo.tier,
              comboName: combo.name,
            });
          } catch { /* vfx is best-effort */ }

          // Pile on the existing impact feedback so the moment is felt
          // even if dispatchComboVfx isn't fully wired in this build.
          const stopMs = combo.tier >= 5 ? 320 : combo.tier >= 4 ? 220 : 140;
          const severity =
            combo.tier >= 5 ? 'kill' :
            combo.tier >= 4 ? 'crit' :
            combo.tier >= 2 ? 'heavy' : 'light';
          try { emitHitStop(stopMs, severity); } catch { /* ok */ }
          try { emitScreenShake(Math.min(10, 4 + combo.tier)); } catch { /* ok */ }

          // GameJuice fanfare. milestone for tier-5, validate-pass for
          // smaller evolutions so the audio escalates with the moment.
          try {
            window.dispatchEvent(new CustomEvent('concordia:game-juice', {
              detail: {
                trigger: combo.tier >= 5 ? 'milestone' : 'fanfare',
                opts: { value: combo.name },
              },
            }));
          } catch { /* ok */ }

          // Toast naming the combo so the player knows what evolved.
          addToast({
            type: 'success',
            message: `New combo: ${combo.name} · T${combo.tier} · ${combo.context}`,
            duration: 7000,
          });
        }
      },
    );

    return off;
  }, []);

  return null;
}
