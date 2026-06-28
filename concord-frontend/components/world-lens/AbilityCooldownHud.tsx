'use client';

/**
 * AbilityCooldownHud — bottom-center ability hotbar with live cooldown sweeps.
 *
 * Polls the REAL combat-prefs backend (world.combat-prefs-get) every 500ms and
 * renders the bound abilities sorted by slot. Each tile's cooldown overlay is a
 * pure function of the server's cooldownRemainingMs / cooldownMs — this is live
 * cooldown state, NOT a fake setInterval progress animation. When the bound
 * ability list is empty we render nothing (no placeholder abilities).
 */

import { useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface Ability {
  id: string;
  name: string;
  slot: number;
  element?: string;
  cooldownMs: number;
  cooldownRemainingMs: number;
  ready: boolean;
}

interface CombatPrefs {
  lockOn?: boolean;
  dodgeStyle?: string;
  blockEnabled?: boolean;
  abilities?: Ability[];
}

const POLL_MS = 500;

// Element → border tint. Falls back to neutral.
const ELEMENT_BORDER: Record<string, string> = {
  fire: 'border-orange-500/70',
  ice: 'border-cyan-400/70',
  frost: 'border-cyan-400/70',
  water: 'border-blue-400/70',
  lightning: 'border-yellow-300/70',
  bio: 'border-emerald-400/70',
  poison: 'border-lime-500/70',
  energy: 'border-violet-400/70',
  physical: 'border-stone-400/70',
};

function elementBorder(element?: string): string {
  if (!element) return 'border-white/20';
  return ELEMENT_BORDER[element.toLowerCase()] || 'border-white/20';
}

export function AbilityCooldownHud({ enabled = true }: { enabled?: boolean }) {
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAbilities([]);
      return;
    }
    let active = true;

    const poll = async () => {
      try {
        const { data } = await lensRun<CombatPrefs>('world', 'combat-prefs-get', {});
        if (active && mounted.current && data.ok && data.result) {
          setAbilities(Array.isArray(data.result.abilities) ? data.result.abilities : []);
        }
      } catch {
        /* transient — keep last good state, never fabricate */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [enabled]);

  if (!enabled || abilities.length === 0) return null;

  const sorted = [...abilities].sort((a, b) => a.slot - b.slot);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-end gap-2 rounded-lg border border-white/10 bg-black/80 px-3 py-2 backdrop-blur-sm">
        {sorted.map((ab) => {
          const onCooldown = ab.cooldownRemainingMs > 0 && !ab.ready;
          const sweepPct =
            onCooldown && ab.cooldownMs > 0
              ? Math.min(100, Math.max(0, (ab.cooldownRemainingMs / ab.cooldownMs) * 100))
              : 0;
          const remainingSec = Math.ceil(ab.cooldownRemainingMs / 1000);
          return (
            <div
              key={ab.id}
              data-testid={`ability-${ab.id}`}
              className={`relative h-14 w-14 overflow-hidden rounded-md border-2 bg-white/5 text-white ${elementBorder(
                ab.element
              )} ${onCooldown ? 'opacity-70 saturate-50' : 'opacity-100'}`}
              title={ab.name}
            >
              {/* Vertical cooldown sweep — darkens from the top, sized by remaining ratio */}
              {onCooldown && (
                <div
                  data-testid={`ability-${ab.id}-sweep`}
                  className="absolute inset-x-0 top-0 bg-black/70"
                  style={{ height: `${sweepPct}%` }}
                />
              )}

              {/* Slot number */}
              <span className="absolute left-1 top-0.5 text-[10px] font-bold leading-none text-white/70">
                {ab.slot}
              </span>

              {/* Name */}
              <span className="absolute inset-x-0 bottom-0.5 truncate px-1 text-center text-[9px] leading-tight text-white/85">
                {ab.name}
              </span>

              {/* Remaining-seconds countdown */}
              {onCooldown && (
                <span
                  data-testid={`ability-${ab.id}-cd`}
                  className="absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums text-white drop-shadow"
                >
                  {remainingSec}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AbilityCooldownHud;
