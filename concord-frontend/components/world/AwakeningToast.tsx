'use client';

// WS4(b) — awakening opportunity toast.
//
// When a player SURVIVES a near-death hit, the server emits
// 'player:awakening-available' (MHA stress-trigger). This surfaces the moment:
// a dramatic toast offering to awaken a power. Accepting dispatches a
// 'concordia:awakening-offered' window event that the powers UI consumes to run
// the skill-awakening.awaken macro on the player's chosen skill, keeping skill
// selection in one place rather than guessing here. Auto-dismisses after 8s.

import { useEffect, useState } from 'react';
import { Flame, X } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface AwakeningPayload { worldId?: string; hp?: number; maxHp?: number; source?: string; }

export function AwakeningToast() {
  const [offer, setOffer] = useState<AwakeningPayload | null>(null);

  useEffect(() => {
    const off = subscribe<AwakeningPayload>('player:awakening-available', (payload) => {
      setOffer(payload || {});
      // Auto-dismiss so a missed awakening doesn't pin the UI.
      window.setTimeout(() => setOffer((cur) => (cur === payload ? null : cur)), 8000);
    });
    return () => { off(); };
  }, []);

  if (!offer) return null;

  const accept = () => {
    // Hand off to the powers UI to pick which skill to awaken + run the macro.
    try {
      window.dispatchEvent(new CustomEvent('concordia:awakening-offered', { detail: offer }));
    } catch { /* no-op */ }
    setOffer(null);
  };

  return (
    <div
      className="pointer-events-auto fixed bottom-28 left-1/2 z-50 -translate-x-1/2 animate-[fadeIn_0.3s_ease-out] rounded-lg border px-5 py-3 text-center shadow-xl backdrop-blur"
      style={{ borderColor: '#fb923c', background: 'rgba(20,10,4,0.82)' }}
      data-testid="awakening-toast"
    >
      <button
        onClick={() => setOffer(null)}
        className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-200"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
      <div className="flex items-center justify-center gap-2 text-sm font-semibold text-orange-300">
        <Flame size={16} className="text-orange-400" />
        Your power stirs at the brink of death
      </div>
      <div className="mt-0.5 text-xs text-slate-300">
        Surviving the edge has awakened something. Channel it into one of your skills.
      </div>
      <button
        onClick={accept}
        className="mt-2 rounded-md border border-orange-500/70 bg-orange-500/15 px-4 py-1 text-xs font-medium text-orange-200 hover:bg-orange-500/25"
      >
        Awaken a power
      </button>
    </div>
  );
}

export default AwakeningToast;
