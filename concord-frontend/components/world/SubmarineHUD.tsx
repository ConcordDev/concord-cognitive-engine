'use client';

// Phase CA2 — Submarine HUD.
//
// Subsystems already shipped:
//   - player_oxygen (mig 157): oxygen_pct, max_depth_explored,
//     drowning_damage. Decays at 1%/s while swim_depth>0.3m, refills 5%/s
//     at surface.
//   - world_visits.swim_depth + is_swimming (mig 063).
//   - creature_swim_depth (mig 156) gates which creatures spawn at which
//     depth bands — visible sonar contacts come from this.
//
// HUD polls GET /api/players/me/dive-state every 1s; auto-hides when
// is_swimming = 0.

import { useEffect, useState } from 'react';
import { Anchor, AlertTriangle, Activity } from 'lucide-react';

interface DiveState {
  isSwimming: boolean;
  swimDepth: number;          // metres
  oxygenPct: number;
  maxDepthExplored: number;
  drowningDamage: number;
  sonarContacts: Array<{ id: string; speciesId: string; distance: number; depth: number }>;
}

const POLL_MS = 1000;

export function SubmarineHUD() {
  const [state, setState] = useState<DiveState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('/api/players/me/dive-state', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j?.ok && j.diveState?.isSwimming) {
          setState(j.diveState);
        } else if (!cancelled) {
          setState(null);
        }
      } catch { /* network blip */ }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!state || !state.isSwimming) return null;

  const lowOx = state.oxygenPct < 30;
  const criticalOx = state.oxygenPct < 10;

  return (
    <div className="fixed bottom-32 left-4 z-30 w-56 rounded-lg border border-cyan-500/40 bg-zinc-950/95 p-3 text-cyan-100 shadow-xl backdrop-blur">
      <header className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300/70">
        <Anchor size={11} />
        Dive instruments
      </header>

      {/* Oxygen meter */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className={criticalOx ? 'text-rose-300' : lowOx ? 'text-amber-300' : 'text-cyan-300/70'}>
            O₂
          </span>
          <span className={`font-mono ${criticalOx ? 'text-rose-200' : lowOx ? 'text-amber-200' : 'text-cyan-100'}`}>
            {state.oxygenPct.toFixed(1)}%
          </span>
        </div>
        <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-zinc-800">
          <div
            className={`h-full transition-all ${criticalOx ? 'bg-rose-500' : lowOx ? 'bg-amber-500' : 'bg-cyan-500'}`}
            style={{ width: `${state.oxygenPct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Reading label="Depth" value={`${state.swimDepth.toFixed(1)} m`} />
        <Reading label="Max ever" value={`${state.maxDepthExplored.toFixed(0)} m`} />
      </div>

      {/* Sonar */}
      {state.sonarContacts && state.sonarContacts.length > 0 && (
        <div className="mt-2 rounded border border-cyan-500/20 bg-cyan-500/5 p-1.5">
          <div className="mb-1 flex items-center gap-1 text-[9px] uppercase text-cyan-300/60">
            <Activity size={9} />
            Sonar — {state.sonarContacts.length} contacts
          </div>
          {state.sonarContacts.slice(0, 4).map((c) => (
            <div key={c.id} className="flex justify-between text-[10px] text-cyan-200/80">
              <span>{c.speciesId}</span>
              <span className="font-mono">{c.distance.toFixed(0)}m @ −{c.depth.toFixed(0)}m</span>
            </div>
          ))}
        </div>
      )}

      {criticalOx && (
        <div className="mt-2 flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/20 px-2 py-1 text-[10px] text-rose-200">
          <AlertTriangle size={10} />
          CRITICAL — surface now
        </div>
      )}
      {state.drowningDamage > 0 && (
        <div className="mt-1 text-[10px] text-rose-300/80">
          Drowning damage: {state.drowningDamage} HP
        </div>
      )}
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-cyan-500/20 bg-cyan-500/5 px-1.5 py-1">
      <div className="text-[9px] uppercase text-cyan-300/60">{label}</div>
      <div className="font-mono text-[12px] text-cyan-100">{value}</div>
    </div>
  );
}
