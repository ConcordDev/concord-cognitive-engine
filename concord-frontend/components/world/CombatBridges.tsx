'use client';

/**
 * CombatBridges — Phase 8 polish events wired to the actual asset
 * systems already in the codebase:
 *
 *   AnimationManager.tsx     listens to `concordia:combat-anim` +
 *                            `concordia:hit-reaction` CustomEvents.
 *   AvatarSystem3D.tsx       listens to the same events for avatar
 *                            animation transitions.
 *   GameJuice.tsx            exposes useGameJuice().triggerJuice()
 *                            which routes to SoundscapeEngine for SFX
 *                            and renders camera shake / pulse / cinematic
 *                            overlays.
 *   SoundscapeEngine.tsx     also listens to `concordia:hit-reaction`
 *                            for spatial combat audio.
 *
 * Plus a small set of additional CustomEvents this layer introduces:
 *
 *   concordia:time-dilation  { factor, duration_ms } — perfect-dodge
 *                            slow-mo. Camera + scene root listen.
 *   concordia:vfx-shader     { shader, duration_ms, target } — sande-
 *                            vistan + finisher-burst shader passes.
 *   concordia:combat-stance  { entityId, stance } — stance changes.
 *
 * The four globalThis hooks remain as a SECONDARY integration point
 * for asset systems that aren't already wired into the existing
 * substrate — set them and the bridge double-fires (cheap; idempotent
 * on the receiver side).
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface CombatPolishEvent {
  id: string;
  worldId: string;
  actorKind: 'player' | 'npc';
  actorId: string;
  eventKind: string;
  detail: Record<string, unknown>;
  ts: number;
}

type AnimationHook = (args: { actorId: string; animation: string; opts: Record<string, unknown> }) => void;
type AudioHook = (args: { actorId: string; sound: string; opts: Record<string, unknown> }) => void;
type CameraHook = (args: { effect: string; opts: Record<string, unknown> }) => void;
type VFXHook = (args: { actorId: string; vfx: string; opts: Record<string, unknown> }) => void;

// ── Custom-event helpers (the real wire to existing asset systems) ──────────

function dispatchCombatAnim(entityId: string, animation: string) {
  window.dispatchEvent(new CustomEvent('concordia:combat-anim', { detail: { entityId, animation } }));
}

function dispatchHitReaction(targetId: string, severity: 'light' | 'heavy' | 'crit') {
  window.dispatchEvent(new CustomEvent('concordia:hit-reaction', { detail: { targetId, severity } }));
}

function dispatchTimeDilation(factor: number, durationMs: number) {
  window.dispatchEvent(new CustomEvent('concordia:time-dilation', { detail: { factor, duration_ms: durationMs } }));
}

function dispatchVFXShader(shader: string, target: string, durationMs: number) {
  window.dispatchEvent(new CustomEvent('concordia:vfx-shader', { detail: { shader, target, duration_ms: durationMs } }));
}

function dispatchStanceChange(entityId: string, stance: string) {
  window.dispatchEvent(new CustomEvent('concordia:combat-stance', { detail: { entityId, stance } }));
}

// GameJuice listens to `concordia:game-juice` (see GameJuice.tsx:181). This
// lets us trigger the existing juice system without being inside its React
// context — drop-in equivalent of useGameJuice().triggerJuice(...).
type JuiceTrigger =
  | 'combat-hit' | 'combat-crit' | 'combat-kill' | 'combat-dodge' | 'combat-block'
  | 'place-dtu' | 'validate-pass' | 'validate-fail' | 'earn-royalty' | 'get-cited'
  | 'milestone' | 'disaster' | 'construction-complete' | 'competition-win' | 'quest-complete';

function fireJuice(trigger: JuiceTrigger, opts: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('concordia:game-juice', { detail: { trigger, opts } }));
}

// ── Optional secondary hooks (asset systems wired via globalThis) ───────────

function callAnimation(actorId: string, animation: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_ANIMATION_HOOK__?: AnimationHook }).__CONCORD_ANIMATION_HOOK__;
  if (typeof hook === 'function') { try { hook({ actorId, animation, opts }); } catch { /* */ } }
}
function callAudio(actorId: string, sound: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_AUDIO_HOOK__?: AudioHook }).__CONCORD_AUDIO_HOOK__;
  if (typeof hook === 'function') { try { hook({ actorId, sound, opts }); } catch { /* */ } }
}
function callCamera(effect: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_CAMERA_HOOK__?: CameraHook }).__CONCORD_CAMERA_HOOK__;
  if (typeof hook === 'function') { try { hook({ effect, opts }); } catch { /* */ } }
}
function callVFX(actorId: string, vfx: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_VFX_HOOK__?: VFXHook }).__CONCORD_VFX_HOOK__;
  if (typeof hook === 'function') { try { hook({ actorId, vfx, opts }); } catch { /* */ } }
}

// ── Animation Bridge ────────────────────────────────────────────────────────

/**
 * Phase 8 events → AnimationManager + AvatarSystem3D via
 * `concordia:combat-anim` and `concordia:hit-reaction` CustomEvents.
 *
 * Animation map (matches AvatarAnimation type in AnimationManager.tsx):
 *   combo_start / combo_extend → 'attack-light' (combo ≤ 3) / 'attack-heavy' (combo ≥ 4)
 *   combo_finish               → 'attack-heavy' + 'celebrate' chain
 *   parry / parry_perfect       → 'parry'
 *   dodge / dodge_perfect       → 'dodge-back'
 *   rocked                     → hit-reaction with severity by magnitude
 *   stance_change              → 'concordia:combat-stance' event
 *   grapple_environmental      → 'attack-heavy' (the slam itself)
 *   gassed_out                 → 'idle' (caller will see the breath cycle)
 */
export function CombatAnimationBridge() {
  useEffect(() => {
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev?.actorId) return;

      switch (ev.eventKind) {
        case 'combo_start':
        case 'combo_extend': {
          const combo = Number(ev.detail.combo) || 1;
          dispatchCombatAnim(ev.actorId, combo >= 4 ? 'attack-heavy' : 'attack-light');
          callAnimation(ev.actorId, 'combo_strike', { combo });
          break;
        }
        case 'combo_finish':
          dispatchCombatAnim(ev.actorId, 'attack-heavy');
          // Brief celebrate after the finisher swings.
          setTimeout(() => dispatchCombatAnim(ev.actorId, 'celebrate'), 700);
          callAnimation(ev.actorId, 'finisher', {
            combo: ev.detail.combo,
            multiplier: ev.detail.multiplier,
          });
          break;
        case 'rocked': {
          // AvatarSystem3D hit-reaction: 'crit' triggers 'death' anim
          // (visual death-recovery cycle), 'heavy' triggers 'hit-flinch'.
          const mag = Number(ev.detail.magnitude) || 0;
          const severity: 'light' | 'heavy' | 'crit' = mag > 80 ? 'crit' : mag > 40 ? 'heavy' : 'light';
          dispatchHitReaction(ev.actorId, severity);
          callAnimation(ev.actorId, 'rocked_in', { magnitude: mag, until_ms: ev.detail.until });
          break;
        }
        case 'parry_perfect':
        case 'parry':
          dispatchCombatAnim(ev.actorId, 'parry');
          callAnimation(ev.actorId, ev.eventKind, { lead_ms: ev.detail.lead_ms });
          break;
        case 'dodge_perfect':
        case 'dodge':
          dispatchCombatAnim(ev.actorId, 'dodge-back');
          callAnimation(ev.actorId, ev.eventKind, { lead_ms: ev.detail.lead_ms });
          break;
        case 'stance_change': {
          const to = String(ev.detail.to || 'high');
          dispatchStanceChange(ev.actorId, to);
          callAnimation(ev.actorId, 'stance_change', { from: ev.detail.from, to });
          break;
        }
        case 'grapple_environmental':
          dispatchCombatAnim(ev.actorId, 'attack-heavy');
          // Target gets a 'crit' hit-reaction (the slam is brutal).
          if (ev.detail.target_id) dispatchHitReaction(String(ev.detail.target_id), 'crit');
          callAnimation(ev.actorId, 'grapple_slam', {
            target: ev.detail.target_id,
            surface: ev.detail.surface,
            damage: ev.detail.env_damage,
          });
          break;
      }
    });
    return () => off?.();
  }, []);
  return null;
}

// ── Audio + Camera + Visual Overlay Bridge (via GameJuice) ──────────────────

/**
 * Routes Phase 8 events through useGameJuice().triggerJuice(). This
 * gives us SFX (via SoundscapeEngine), camera shake, and the visual
 * overlay system (pulse-red / pulse-green / shake / cinematic) for
 * free — no new asset wiring needed.
 *
 * Mapping:
 *   combo_extend (combo < 5) → 'combat-hit'  (light SFX + pulse-red)
 *   combo_extend (combo ≥ 5) → 'combat-crit' (heavy SFX + screen shake)
 *   combo_finish             → 'combat-kill' (kill-blow SFX + cinematic)
 *   parry / parry_perfect     → 'combat-block' (block-clang + glow)
 *   dodge / dodge_perfect     → 'combat-dodge' (whoosh + pulse-green)
 *   rocked                   → 'combat-crit' (severity-flagged shake)
 *   gassed_out               → no GameJuice trigger (HUD owns it)
 */
export function CombatJuiceBridge({ userId }: { userId: string | null }) {
  useEffect(() => {
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev?.actorId) return;

      switch (ev.eventKind) {
        case 'combo_start':
          fireJuice('combat-hit', { magnitude: 10, targetId: ev.actorId });
          callAudio(ev.actorId, 'strike_hit', {});
          break;
        case 'combo_extend': {
          const combo = Number(ev.detail.combo) || 1;
          if (combo >= 5) {
            fireJuice('combat-crit', { magnitude: 30 + combo * 2, targetId: ev.actorId });
          } else {
            fireJuice('combat-hit', { magnitude: 12 + combo * 3, targetId: ev.actorId });
          }
          callAudio(ev.actorId, 'combo_chime', { combo, pitch_step: Math.min(12, combo) });
          break;
        }
        case 'combo_finish':
          fireJuice('combat-kill', { magnitude: 50, targetId: ev.actorId });
          callAudio(ev.actorId, 'finisher_boom', { combo: ev.detail.combo });
          break;
        case 'parry':
        case 'parry_perfect':
          fireJuice('combat-block', { targetId: ev.actorId });
          callAudio(ev.actorId, ev.eventKind === 'parry_perfect' ? 'perfect_parry' : 'strike_hit', {});
          break;
        case 'dodge':
        case 'dodge_perfect':
          fireJuice('combat-dodge', { targetId: ev.actorId });
          callAudio(ev.actorId, ev.eventKind === 'dodge_perfect' ? 'perfect_dodge' : 'strike_hit', {});
          break;
        case 'rocked': {
          const mag = Number(ev.detail.magnitude) || 0;
          fireJuice(mag > 50 ? 'combat-crit' : 'combat-hit', { magnitude: mag, targetId: ev.actorId });
          callAudio(ev.actorId, 'rocked_thud', { magnitude: mag });
          break;
        }
        case 'grapple_environmental':
          fireJuice('combat-crit', {
            magnitude: Number(ev.detail.env_damage) || 30,
            targetId: String(ev.detail.target_id || ev.actorId),
          });
          callAudio(ev.actorId, 'grapple_slam', { surface: ev.detail.surface, damage: ev.detail.env_damage });
          break;
        case 'gassed_out':
          if (ev.actorId === userId) callAudio(ev.actorId, 'gassed_wheeze', {});
          break;
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

// ── Camera Director (time dilation + cinematic dolly) ───────────────────────

/**
 * Time dilation is the one camera effect GameJuice doesn't directly
 * provide (the 'shake' camera mode covers most needs). Perfect dodges
 * with a profile-defined dilation factor (Cyberpunk 0.35, Sifu 0.15)
 * dispatch `concordia:time-dilation` for a CSS-level slow-mo wrapper
 * to consume. Existing camera shake on rocked + finisher comes from
 * GameJuice.
 *
 * The dilation is implemented as a CSS class toggle on the world
 * container (see app/lenses/world/page.tsx). When unset, no-op.
 */
export function CombatCameraDirector({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (!userId) return;
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev) return;

      if (ev.eventKind === 'dodge_perfect') {
        const dilation = Number(ev.detail.time_dilation) || 0;
        if (dilation > 0) {
          dispatchTimeDilation(1 - dilation, Math.round(dilation * 1000));
          callCamera('time_dilation', {
            factor: 1 - dilation,
            duration_ms: Math.round(dilation * 1000),
          });
        }
      } else if (ev.eventKind === 'rocked' && ev.actorId === userId) {
        callCamera('rocked_shake', { magnitude: ev.detail.magnitude, duration_ms: 600 });
        // GameJuice 'combat-crit' already shakes the camera; no extra dispatch.
      } else if (ev.eventKind === 'combo_finish' && ev.actorId === userId) {
        callCamera('finisher_dolly', { combo: ev.detail.combo, duration_ms: 800 });
      } else if (ev.eventKind === 'grapple_environmental' && ev.actorId === userId) {
        callCamera('grapple_zoom', { surface: ev.detail.surface, duration_ms: 500 });
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

// ── VFX Layer (sandevistan shader + combo trail + finisher burst) ───────────

export function CombatVFXLayer({ userId }: { userId: string | null }) {
  useEffect(() => {
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev?.actorId) return;

      switch (ev.eventKind) {
        case 'combo_extend':
        case 'combo_finish':
          callVFX(ev.actorId, 'combo_trail', {
            combo: ev.detail.combo,
            multiplier: ev.detail.multiplier,
          });
          if (ev.eventKind === 'combo_finish') {
            dispatchVFXShader('finisher_burst', ev.actorId, 800);
            callVFX(ev.actorId, 'finisher_burst', { combo: ev.detail.combo });
          }
          break;
        case 'parry_perfect':
          callVFX(ev.actorId, 'perfect_parry_spark', { lead_ms: ev.detail.lead_ms });
          break;
        case 'dodge_perfect': {
          const dilation = Number(ev.detail.time_dilation) || 0;
          if (dilation >= 0.3) {
            // Sandevistan-style shader pass for high-dilation dodges
            // (Cyberpunk profile = 0.35).
            dispatchVFXShader('sandevistan', ev.actorId, Math.round(dilation * 1000));
            callVFX(ev.actorId, 'sandevistan_shader', { duration_ms: Math.round(dilation * 1000) });
          }
          break;
        }
        case 'gassed_out':
          if (ev.actorId === userId) {
            callVFX(ev.actorId, 'gas_low_pulse', {});
          }
          break;
        case 'rocked':
          callVFX(ev.actorId, 'rocked_aura', { until_ms: ev.detail.until });
          break;
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

// ── Time-dilation CSS overlay (applies the slow-mo effect itself) ───────────

/**
 * Listens to `concordia:time-dilation` and applies a CSS class to
 * <body> for the duration. The class slows CSS animations + paints a
 * subtle blue tint. The 3D scene's own animation loop doesn't slow
 * (that would require a renderer hook); this is a CSS-only effect
 * for HUD / UI elements + a screen-space tint that reads as slow-mo.
 *
 * Asset systems with a renderer-level slow-mo can listen to the same
 * event from their renderer scope and apply the actual time scale.
 */
export function CombatTimeDilationOverlay() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ factor: number; duration_ms: number }>).detail;
      if (!detail) return;
      document.body.classList.add('concord-time-dilated');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        document.body.classList.remove('concord-time-dilated');
        timer = null;
      }, detail.duration_ms);
    };

    window.addEventListener('concordia:time-dilation', handler);
    return () => {
      window.removeEventListener('concordia:time-dilation', handler);
      if (timer) clearTimeout(timer);
      document.body.classList.remove('concord-time-dilated');
    };
  }, []);
  return null;
}

// ── Convenience: mount everything ───────────────────────────────────────────

export function CombatPolishLayer({ userId }: { userId: string | null }) {
  return (
    <>
      <CombatAnimationBridge />
      <CombatJuiceBridge userId={userId} />
      <CombatCameraDirector userId={userId} />
      <CombatVFXLayer userId={userId} />
      <CombatTimeDilationOverlay />
    </>
  );
}
