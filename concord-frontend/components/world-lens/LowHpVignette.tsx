'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LowHpVignette — full-screen red vignette pulse + heartbeat SFX when the
 * player's HP drops below 25% of max. Pulse rate accelerates as HP drops
 * further: 70 BPM at 25%, 95 BPM at 10%.
 *
 * Mounts inside the world lens. Reads health/maxHealth as props rather than
 * subscribing to state directly so it can be reused for any HP-bar context
 * (boss fights, mounts, allies). Dispatches concordia:soundscape-command
 * heartbeat triggers via the same window channel WorldSFXHooks uses.
 *
 * Suppresses entirely when isDead so the death overlay can take over.
 */

interface Props {
  health: number;
  maxHealth: number;
  isDead?: boolean;
}

function dispatchSfx(sfxId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('concordia:soundscape-command', {
      detail: { action: 'triggerSFX', sfxId },
    }),
  );
}

export default function LowHpVignette({ health, maxHealth, isDead }: Props) {
  const ratio = Math.max(0, maxHealth > 0 ? health / maxHealth : 1);
  const lowHp = !isDead && ratio < 0.25 && ratio > 0;
  const criticalHp = !isDead && ratio < 0.10 && ratio > 0;

  // Pulse cycle ms — 70bpm = 857ms at 25%, 95bpm = 631ms at 10%
  // Linear interpolation between 0.25 and 0.05 ratio
  const cycleMs = lowHp
    ? Math.max(580, 857 - Math.max(0, (0.25 - ratio) / 0.20) * 280)
    : 1000;

  const [pulse, setPulse] = useState(0); // monotonically incremented to retrigger CSS animation

  // Heartbeat SFX scheduler — fires lub then dub +120ms each cycle
  useEffect(() => {
    if (!lowHp) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      dispatchSfx('heartbeat-lub');
      setTimeout(() => { if (alive) dispatchSfx('heartbeat-dub'); }, 120);
      setPulse((p) => p + 1);
    };
    // Fire immediately so the visual + audio sync from the moment we enter low HP
    tick();
    const id = setInterval(tick, cycleMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lowHp, cycleMs]);

  if (!lowHp) return null;

  // Vignette opacity & color intensity — stronger as ratio drops
  const baseOpacity = criticalHp ? 0.55 : 0.35;
  const tint = criticalHp ? 'rgba(220,38,38,0.55)' : 'rgba(185,28,28,0.40)';

  return (
    <div
      key={pulse}
      className="fixed inset-0 z-[6] pointer-events-none"
      style={{
        background: `radial-gradient(ellipse at center, transparent 30%, ${tint} 100%)`,
        opacity: 0,
        animation: `heartbeatVignette ${cycleMs}ms ease-in-out`,
      }}
    >
      <style jsx>{`
        @keyframes heartbeatVignette {
          0%   { opacity: 0; }
          12%  { opacity: ${baseOpacity}; }
          22%  { opacity: 0; }
          34%  { opacity: ${baseOpacity * 0.85}; }
          44%  { opacity: 0; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
