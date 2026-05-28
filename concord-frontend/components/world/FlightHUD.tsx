'use client';

// Phase CA1 — Flight HUD instruments.
//
// AvatarSystem3D Phase B3 already runs flight physics (airspeed,
// heading, roll/pitch, vy, stall). It dispatches concordia:flight-state
// on every frame the player is airborne. This component subscribes,
// renders altimeter / airspeed indicator / artificial horizon / stall
// warning. No new substrate — pure HUD overlay.
//
// Auto-shows when a flight-state event arrives; auto-hides after 2s of
// silence (player landed).

import { useEffect, useState, useRef } from 'react';
import { Plane, AlertTriangle } from 'lucide-react';

interface FlightState {
  airspeed: number;
  heading: number;     // radians
  rollRad: number;
  pitchRad: number;
  vy: number;
  stalled: boolean;
  stallTimerMs: number;
}

const SILENCE_MS = 2000;

export function FlightHUD() {
  const [state, setState] = useState<FlightState | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    function onFlight(e: Event) {
      const detail = (e as CustomEvent<FlightState>).detail;
      if (!detail) return;
      setState(detail);
      lastUpdateRef.current = Date.now();
    }
    window.addEventListener('concordia:flight-state', onFlight);
    const t = setInterval(() => {
      if (lastUpdateRef.current && Date.now() - lastUpdateRef.current > SILENCE_MS) {
        setState(null);
      }
    }, 500);
    return () => {
      window.removeEventListener('concordia:flight-state', onFlight);
      clearInterval(t);
    };
  }, []);

  if (!state) return null;

  const headingDeg = Math.round(((state.heading * 180) / Math.PI + 360) % 360);
  const rollDeg = Math.round((state.rollRad * 180) / Math.PI);
  const pitchDeg = Math.round((state.pitchRad * 180) / Math.PI);

  return (
    <div className="fixed bottom-32 right-4 z-30 w-56 rounded-lg border border-cyan-500/40 bg-zinc-950/95 p-3 text-cyan-100 shadow-xl backdrop-blur">
      <header className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300/70">
        <Plane size={11} />
        Flight instruments
      </header>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Reading label="Airspeed" value={`${state.airspeed.toFixed(1)} m/s`} />
        <Reading label="Heading" value={`${headingDeg}°`} />
        <Reading label="Vertical" value={`${state.vy >= 0 ? '+' : ''}${state.vy.toFixed(1)} m/s`} />
        <Reading label="Roll" value={`${rollDeg}°`} />
        <Reading label="Pitch" value={`${pitchDeg}°`} />
        <Reading
          label="Stall"
          value={state.stalled ? `${Math.round(state.stallTimerMs)}ms` : 'OK'}
          warn={state.stalled}
        />
      </div>
      {state.stalled && (
        <div className="mt-2 flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/20 px-2 py-1 text-[10px] text-rose-200">
          <AlertTriangle size={10} />
          STALL — pitch down to recover
        </div>
      )}
    </div>
  );
}

function Reading({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded border px-1.5 py-1 ${warn ? 'border-rose-500/40 bg-rose-500/10' : 'border-cyan-500/20 bg-cyan-500/5'}`}>
      <div className="text-[9px] uppercase text-cyan-300/60">{label}</div>
      <div className={`font-mono text-[12px] ${warn ? 'text-rose-200' : 'text-cyan-100'}`}>{value}</div>
    </div>
  );
}
