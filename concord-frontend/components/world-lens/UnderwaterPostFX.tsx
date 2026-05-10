'use client';

/**
 * UnderwaterPostFX — Sprint C / Track C4
 *
 * Cheap CSS-overlay underwater effect activated when the player's
 * swim_depth exceeds the surface threshold. Reads the same swim state
 * the existing world-gathering code uses (`window.__concordia_swim_state`).
 *
 *   - blue-green tint (depth-scaled)
 *   - distance fog vignette (radial gradient that grows with depth)
 *   - oxygen vignette (red ring at < 30%)
 *   - low-oxygen heartbeat pulse (CSS animation, 1.5s cycle)
 *
 * No EffectComposer / WebGL postprocessing — pure DOM overlay + CSS.
 * Cheap on integrated GPUs, immediately ships, can swap to GPU later.
 */

import React, { useEffect, useState } from 'react';

interface SwimSnapshot {
  depth: number;       // metres below water surface
  isSwimming: boolean;
}

interface OxygenSnapshot {
  oxygen_pct: number;
}

interface Props {
  worldId: string;
  /** Polling interval in ms for swim/oxygen reads. */
  intervalMs?: number;
}

export default function UnderwaterPostFX({ worldId, intervalMs = 200 }: Props) {
  const [swim, setSwim] = useState<SwimSnapshot>({ depth: 0, isSwimming: false });
  const [oxygen, setOxygen] = useState<OxygenSnapshot>({ oxygen_pct: 100 });

  // Poll swim state from window globals (set by AvatarSystem3D's
  // physics-world swim integration).
  useEffect(() => {
    const interval = window.setInterval(() => {
      const s = (window as unknown as { __concordia_swim_state?: SwimSnapshot }).__concordia_swim_state;
      if (s) setSwim(s);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);

  // Poll oxygen via macro every 2 seconds while submerged.
  useEffect(() => {
    if (!swim.isSwimming || swim.depth <= 0.3) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: 'oxygen', name: 'tick',
            input: { worldId, depth: swim.depth },
          }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && typeof j?.oxygen_pct === 'number') {
          setOxygen({ oxygen_pct: j.oxygen_pct });
        }
      } catch { /* fine */ }
    };
    void tick();
    const interval = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [worldId, swim.isSwimming, swim.depth]);

  // Surface refresh: oxygen quietly refills to 100 server-side; mirror that.
  useEffect(() => {
    if (!swim.isSwimming || swim.depth <= 0.3) {
      setOxygen({ oxygen_pct: 100 });
    }
  }, [swim.isSwimming, swim.depth]);

  if (!swim.isSwimming || swim.depth < 0.3) return null;

  // Tint intensity scales with depth (cap at 15m).
  const depthFactor = Math.min(1, swim.depth / 15);
  const tintAlpha = 0.15 + depthFactor * 0.35;
  const fogStrength = 0.3 + depthFactor * 0.4;
  const lowOxygen = oxygen.oxygen_pct < 30;
  const heartbeatPulse = lowOxygen ? `pulse 1.5s ease-in-out infinite` : 'none';

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9,
      }}
    >
      {/* Blue-green tint */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `rgba(60, 110, 130, ${tintAlpha})`,
        mixBlendMode: 'multiply',
      }} />
      {/* Distance fog vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at 50% 50%, transparent 25%, rgba(20, 50, 70, ${fogStrength}) 75%)`,
      }} />
      {/* Caustics-like soft flicker */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at ${30 + Math.sin(Date.now() / 800) * 15}% ${20 + Math.cos(Date.now() / 1100) * 10}%, rgba(180,220,230,0.06), transparent 60%)`,
        opacity: 0.6,
      }} />
      {/* Low oxygen vignette */}
      {lowOxygen && (
        <>
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 0.8; }
            }
          `}</style>
          <div style={{
            position: 'absolute', inset: 0,
            boxShadow: 'inset 0 0 220px rgba(180, 30, 30, 0.85)',
            animation: heartbeatPulse,
          }} />
        </>
      )}
      {/* Oxygen HUD */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.6)', padding: '6px 14px',
        borderRadius: 4, border: `1px solid ${lowOxygen ? '#a44' : '#446'}`,
        color: lowOxygen ? '#f88' : '#dde',
        font: '12px/1.2 -apple-system, system-ui, sans-serif', letterSpacing: '0.05em',
      }}>
        OXYGEN {oxygen.oxygen_pct.toFixed(0)}% · DEPTH {swim.depth.toFixed(1)}m
      </div>
    </div>
  );
}
