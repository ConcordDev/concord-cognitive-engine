'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSoundscape } from './SoundscapeEngine';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import { requestHitPause } from '@/lib/concordia/hit-pause';
import { knockbackForTrigger } from '@/lib/concordia/knockback-feel';
// The 2D HUD shake is a SEPARATE render target from the in-scene 3D camera shake,
// but it shares the one trauma authority's severity→magnitude curve so a kill shakes
// harder than a hit consistently across both surfaces (see lib/concordia/screen-trauma.ts).
import { traumaForSeverity } from '@/lib/concordia/screen-trauma';

/* ── Types ─────────────────────────────────────────────────────── */

type JuiceTrigger =
  | 'place-dtu'
  | 'validate-pass'
  | 'validate-fail'
  | 'earn-royalty'
  | 'get-cited'
  | 'milestone'
  | 'disaster'
  | 'construction-complete'
  | 'competition-win'
  // combat
  | 'combat-hit'
  | 'combat-crit'
  | 'combat-kill'
  | 'combat-dodge'
  | 'combat-block'
  | 'quest-complete';

interface JuiceFeedback {
  sound: string;
  visual: string;
  camera: string;
  duration: number;
}

interface JuiceOverlay {
  id: string;
  type: 'pulse-green' | 'pulse-red' | 'shake' | 'float-number' | 'glow' | 'cinematic';
  value?: string;
  opacity: number;
  x?: number;
  y?: number;
}

interface GameJuiceContextValue {
  triggerJuice: (trigger: JuiceTrigger, opts?: { magnitude?: number; value?: string; targetId?: string }) => void;
  setIntensity: (intensity: number) => void;
  isEnabled: boolean;
}

const GameJuiceContext = createContext<GameJuiceContextValue>({
  triggerJuice: () => {},
  setIntensity: () => {},
  isEnabled: true,
});

export function useGameJuice(): GameJuiceContextValue {
  return useContext(GameJuiceContext);
}

/* ── Feedback map ─────────────────────────────────────────────── */

const FEEDBACK_MAP: Record<JuiceTrigger, JuiceFeedback> = {
  'place-dtu': { sound: 'snap-click', visual: 'particle-burst', camera: 'settle', duration: 400 },
  'validate-pass': { sound: 'ascending-chime', visual: 'pulse-green', camera: 'none', duration: 600 },
  'validate-fail': { sound: 'low-thud', visual: 'pulse-red', camera: 'none', duration: 500 },
  'earn-royalty': { sound: 'coin-clink', visual: 'float-number', camera: 'none', duration: 1200 },
  'get-cited': { sound: 'notification-glow', visual: 'glow', camera: 'none', duration: 800 },
  milestone: { sound: 'fanfare-short', visual: 'cinematic', camera: 'cinematic-pan', duration: 2000 },
  disaster: { sound: 'rumble', visual: 'shake', camera: 'shake', duration: 1500 },
  'construction-complete': { sound: 'build-finish', visual: 'particle-burst', camera: 'settle', duration: 600 },
  'competition-win': { sound: 'victory-sting', visual: 'cinematic', camera: 'cinematic-pan', duration: 2500 },
  // combat feel
  'combat-hit':   { sound: 'hit-light',    visual: 'pulse-red',   camera: 'shake', duration: 180 },
  'combat-crit':  { sound: 'hit-crit',     visual: 'shake',       camera: 'shake', duration: 300 },
  'combat-kill':  { sound: 'kill-blow',    visual: 'cinematic',   camera: 'shake', duration: 700 },
  'combat-dodge': { sound: 'dodge-whoosh', visual: 'pulse-green', camera: 'none',  duration: 180 },
  'combat-block': { sound: 'block-clang',  visual: 'glow',        camera: 'none',  duration: 220 },
  'quest-complete': { sound: 'gather-success', visual: 'pulse-green', camera: 'none', duration: 600 },
};

/* ── Component ─────────────────────────────────────────────────── */

interface GameJuiceProps {
  children: React.ReactNode;
  enabled?: boolean;
  intensity?: number;
}

// Map JuiceTrigger → SFX id from SoundscapeEngine SFX_MAP
const TRIGGER_SFX: Record<JuiceTrigger, string> = {
  'place-dtu':             'snap-click',
  'validate-pass':         'ascending-chime',
  'validate-fail':         'low-thud',
  'earn-royalty':          'coin-clink',
  'get-cited':             'notification-glow',
  'milestone':             'fanfare-short',
  'disaster':              'rumble',
  'construction-complete': 'build-finish',
  'competition-win':       'victory-sting',
  'combat-hit':            'hit-confirm-light',
  'combat-crit':            'hit-confirm-crit',
  'combat-kill':            'hit-confirm-kill',
  'combat-dodge':          'dodge-whoosh',
  'combat-block':          'block-clang',
  'quest-complete':        'gather-success',
};

export default function GameJuice({ children, enabled = true, intensity: initialIntensity = 0.8 }: GameJuiceProps) {
  const [intensityValue, setIntensityValue] = useState(initialIntensity);
  const [overlays, setOverlays] = useState<JuiceOverlay[]>([]);
  const overlayCounter = useRef(0);
  const soundscape = useSoundscape();
  // G3.1 — respect reduced-motion: suppress the motion-sickness triggers
  // (screen shake, knockback impulse) while keeping audio + damage numbers.
  const { effectiveReducedMotion } = useAccessibilitySettings();

  const removeOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const triggerJuice = useCallback(
    (
      trigger: JuiceTrigger,
      opts?: {
        magnitude?: number;
        value?: string;
        targetId?: string;
        attackerId?: string;
        position?: { x: number; y: number; z: number };
        /** World position of the attacker — drives knockback direction. */
        sourcePosition?: { x: number; y: number; z: number };
      },
    ) => {
      if (!enabled) return;

      const feedback = FEEDBACK_MAP[trigger];
      if (!feedback) return;

      // Play audio SFX. Phase 14 polish-to-ten: route through spatial audio
      // when a world position is supplied so the SFX comes from the right
      // direction relative to the listener (HRTF + reverb + occlusion via
      // SoundscapeEngine.playSpatialSFX).
      // Heavy-hit variant: combat-hit with magnitude > 25 plays the heavier
      // confirmation stack (transient + heavy + thump-deep) for genuine weight.
      let sfxId = TRIGGER_SFX[trigger];
      const isHeavy = trigger === 'combat-hit' && (opts?.magnitude ?? 0) > 25;
      if (isHeavy) {
        sfxId = 'hit-confirm-heavy';
      }
      if (sfxId) {
        if (opts?.position) soundscape.playSpatialSFX(sfxId, opts.position);
        else soundscape.triggerSFX(sfxId);
      }

      // Theme 5 (game-feel pass): heavy hits emit hit-pause + knockback
      // window events so the avatar update loop can freeze its mixer
      // briefly and physics-world.knockbackKinematic can fold an impulse
      // into the kinematic capsule. Both are best-effort; consumers may
      // be absent during non-combat lenses.
      const isCombatLandedHit =
        trigger === 'combat-hit' || trigger === 'combat-crit' || trigger === 'combat-kill';
      if (isCombatLandedHit) {
        // T2.1 — even a light landed hit gets a short freeze so it isn't
        // weightless (was 0). Heavy/crit/kill keep their bigger windows.
        const targetMs = trigger === 'combat-kill' ? 200 : (isHeavy || trigger === 'combat-crit' ? 80 : 35);
        const attackerMs = trigger === 'combat-kill' ? 60 : (isHeavy || trigger === 'combat-crit' ? 50 : 0);
        // T2.7 — route through the single deduped hit-pause authority so this
        // (legacy/PvP) path and the server-authoritative impact path can't
        // double-freeze the same strike.
        if (opts?.targetId) requestHitPause(opts.targetId, targetMs);
        if (opts?.attackerId) requestHitPause(opts.attackerId, attackerMs);
        // Knockback only on heavy / crit / kill, only when both endpoints
        // known (so we can derive a direction that points away from the
        // attacker). Ignored for normal light hits.
        if (!effectiveReducedMotion &&
            (isHeavy || trigger === 'combat-crit' || trigger === 'combat-kill') &&
            opts?.targetId && opts?.position && opts?.sourcePosition) {
          const dx = opts.position.x - opts.sourcePosition.x;
          const dz = opts.position.z - opts.sourcePosition.z;
          const mag = Math.hypot(dx, dz) || 1;
          // T-feel parity: derive magnitude from the SAME severity→knockback table
          // the NPC path uses (impact-feel.js), so an equal strike knocks back the
          // same regardless of target type. (Was a separate 4/5/6 heuristic.)
          const m = knockbackForTrigger(trigger, isHeavy);
          if (m > 0) window.dispatchEvent(new CustomEvent('concordia:knockback', {
            detail: {
              entityId: opts.targetId,
              direction: { x: dx / mag, z: dz / mag },
              magnitude: m,
              durationMs: trigger === 'combat-kill' ? 340 : 220,
            },
          }));
        }
      }

      const scaledDuration = feedback.duration * intensityValue;
      const id = `juice-${overlayCounter.current++}`;

      // Determine overlay type from feedback. G3.1 — reduced-motion downgrades
      // the screen-shake overlay to a non-moving glow (keeps the feedback, drops
      // the motion).
      let overlayType: JuiceOverlay['type'] = 'glow';
      if (feedback.visual === 'pulse-green') overlayType = 'pulse-green';
      else if (feedback.visual === 'pulse-red') overlayType = 'pulse-red';
      else if ((feedback.visual === 'shake' || trigger === 'disaster') && !effectiveReducedMotion) overlayType = 'shake';
      else if (feedback.visual === 'float-number') overlayType = 'float-number';
      else if (feedback.visual === 'cinematic') overlayType = 'cinematic';

      const overlay: JuiceOverlay = {
        id,
        type: overlayType,
        value: opts?.value,
        opacity: intensityValue,
      };

      // Scale shake magnitude for disasters
      if (trigger === 'disaster' && opts?.magnitude) {
        overlay.opacity = Math.min(1, intensityValue * (opts.magnitude / 10));
      }
      // Shake overlays scale by the shared severity curve so a kill reads heavier
      // than a hit — coherent with the 3D camera trauma engine.
      if (overlayType === 'shake') {
        overlay.opacity = Math.min(1, overlay.opacity * (0.5 + traumaForSeverity(trigger)));
      }

      setOverlays((prev) => [...prev, overlay]);

      // Auto-remove after duration
      setTimeout(() => removeOverlay(id), scaledDuration);
    },
    [enabled, intensityValue, removeOverlay, soundscape, effectiveReducedMotion],
  );

  const setIntensity = useCallback((value: number) => {
    setIntensityValue(Math.max(0, Math.min(1, value)));
  }, []);

  const contextValue: GameJuiceContextValue = {
    triggerJuice,
    setIntensity,
    isEnabled: enabled,
  };

  // Allow sibling components to trigger juice via window event — avoids
  // requiring all consumers to live inside this provider.
  useEffect(() => {
    const handler = (e: Event) => {
      const { trigger, opts } = (e as CustomEvent).detail ?? {};
      if (trigger) triggerJuice(trigger as JuiceTrigger, opts);
    };
    window.addEventListener('concordia:game-juice', handler);
    return () => window.removeEventListener('concordia:game-juice', handler);
  }, [triggerJuice]);

  return (
    <GameJuiceContext.Provider value={contextValue}>
      <div className="relative">
        {children}

        {/* Green pulse overlay */}
        {overlays
          .filter((o) => o.type === 'pulse-green')
          .map((o) => (
            <div
              key={o.id}
              className="pointer-events-none fixed inset-0 z-[9999] bg-green-500/20 animate-pulse"
              style={{ opacity: o.opacity * 0.3 }}
            />
          ))}

        {/* Red pulse overlay */}
        {overlays
          .filter((o) => o.type === 'pulse-red')
          .map((o) => (
            <div
              key={o.id}
              className="pointer-events-none fixed inset-0 z-[9999] bg-red-500/25 animate-pulse"
              style={{ opacity: o.opacity * 0.35 }}
            />
          ))}

        {/* Screen shake overlay */}
        {overlays
          .filter((o) => o.type === 'shake')
          .map((o) => (
            <div
              key={o.id}
              className="pointer-events-none fixed inset-0 z-[9998]"
              style={{
                animation: `shake ${300 * o.opacity}ms ease-in-out`,
              }}
            />
          ))}

        {/* Floating numbers */}
        {overlays
          .filter((o) => o.type === 'float-number')
          .map((o) => (
            <div
              key={o.id}
              className="pointer-events-none fixed top-1/3 left-1/2 -translate-x-1/2 z-[9999] text-yellow-400 font-bold text-2xl"
              style={{
                animation: 'floatUp 1.2s ease-out forwards',
                opacity: o.opacity,
              }}
            >
              +{o.value || '0'}
            </div>
          ))}

        {/* Notification glow */}
        {overlays
          .filter((o) => o.type === 'glow')
          .map((o) => (
            <div
              key={o.id}
              className="pointer-events-none fixed top-4 right-4 z-[9999] w-3 h-3 rounded-full bg-cyan-400"
              style={{
                animation: 'glowPulse 0.8s ease-in-out',
                opacity: o.opacity,
                boxShadow: '0 0 20px 10px rgba(34,211,238,0.4)',
              }}
            />
          ))}

        {/* Cinematic overlay */}
        {overlays
          .filter((o) => o.type === 'cinematic')
          .map((o) => (
            <React.Fragment key={o.id}>
              <div
                className="pointer-events-none fixed top-0 left-0 right-0 z-[9999] bg-black h-12"
                style={{ animation: 'slideDown 0.3s ease-out forwards', opacity: o.opacity }}
              />
              <div
                className="pointer-events-none fixed bottom-0 left-0 right-0 z-[9999] bg-black h-12"
                style={{ animation: 'slideUp 0.3s ease-out forwards', opacity: o.opacity }}
              />
            </React.Fragment>
          ))}

        {/* Intensity settings debug (hidden by default) */}
        <style jsx>{`
          @keyframes floatUp {
            0% { transform: translate(-50%, 0); opacity: 1; }
            100% { transform: translate(-50%, -80px); opacity: 0; }
          }
          @keyframes glowPulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.5); opacity: 0.8; }
            100% { transform: scale(1); opacity: 0; }
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10% { transform: translateX(-4px) translateY(2px); }
            30% { transform: translateX(4px) translateY(-2px); }
            50% { transform: translateX(-3px) translateY(1px); }
            70% { transform: translateX(3px) translateY(-1px); }
            90% { transform: translateX(-1px); }
          }
          @keyframes slideDown {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
          @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    </GameJuiceContext.Provider>
  );
}
