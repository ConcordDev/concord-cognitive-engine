'use client';

// E0#3 — Boss health-bar + phase HUD.
//
// Subscribes to the server `boss:state` event (emitted from the combat NPC-hit
// path when the target is a boss) and renders a top-center boss name + HP bar +
// current phase, the way Elden Ring/Sekiro surface a boss fight. Auto-hides a
// few seconds after the last hit, or shortly after the boss is defeated.
//
// boss:state payload: { npcId, worldId, name, hpPct, currentHp, maxHp, phase,
//                       phaseAdvanced, defeated }

import { useEffect, useRef, useState } from 'react';
import { Skull } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';

interface BossState {
  npcId: string;
  name: string;
  hpPct: number;
  phase: string | null;
  phaseAdvanced?: boolean;
  defeated?: boolean;
}

const HIDE_AFTER_MS = 7000;     // hide if no hit lands for this long
const DEFEAT_LINGER_MS = 2500;  // keep the bar up briefly after a kill

const PHASE_LABEL: Record<string, string> = {
  'enraged-1': 'Enraged',
  'enraged-2': 'Furious',
  'death-throes': 'Death Throes',
};

export function BossHealthBar() {
  const { on, off } = useSocket({ autoConnect: true });
  const [boss, setBoss] = useState<BossState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    const scheduleHide = (ms: number) => {
      clear();
      hideTimer.current = setTimeout(() => setBoss(null), ms);
    };

    const handler = (...args: unknown[]) => {
      const s = args[0] as BossState;
      if (!s || typeof s.npcId !== 'string') return;
      setBoss(s);
      scheduleHide(s.defeated ? DEFEAT_LINGER_MS : HIDE_AFTER_MS);
    };

    on('boss:state', handler);
    return () => { clear(); off('boss:state', handler); };
  }, [on, off]);

  if (!boss) return null;

  const pct = Math.max(0, Math.min(1, boss.hpPct)) * 100;
  const phaseLabel = boss.phase ? (PHASE_LABEL[boss.phase] || boss.phase) : null;
  const dead = !!boss.defeated || pct <= 0;

  return (
    <div className="pointer-events-none fixed top-12 left-1/2 z-30 w-[min(520px,80vw)] -translate-x-1/2">
      <div className="flex items-center justify-center gap-2 text-xs">
        <Skull size={13} className={dead ? 'text-zinc-400' : 'text-rose-400'} />
        <span className="font-semibold tracking-wide text-rose-100 drop-shadow">{boss.name}</span>
        {phaseLabel && !dead && (
          <span className="rounded-sm bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
            {phaseLabel}
          </span>
        )}
        {dead && <span className="text-[10px] font-medium text-zinc-400">Defeated</span>}
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/50">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
            dead ? 'bg-zinc-600' : pct < 25 ? 'bg-rose-600' : pct < 50 ? 'bg-orange-500' : 'bg-rose-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default BossHealthBar;
