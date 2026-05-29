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
import { requestHitPause } from '@/lib/concordia/hit-pause';
import { computeImpactCameraPunch } from '@/lib/concordia/combat-camera';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import CombatVFXBridge from '@/components/world/CombatVFXBridge';
import { ImpactMomentumBridge } from '@/components/world/ImpactMomentumBridge';
// Phase 8 add-ons: the ImpactFeedback layer exposes three global emit
// functions the bridges call inline. ImpactFeedback itself is mounted
// once at app/lenses/world/page.tsx; the emitters are no-ops until
// then. See components/world/ImpactFeedback.tsx.
import {
  emitHitNumber,
  emitScreenShake,
  emitHitStop,
} from '@/components/world/ImpactFeedback';

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
          // Phase 8 add-ons: hit-stop + screen shake + damage number.
          // Damage estimate from event detail when present, else fallback by combo.
          {
            const damage = Number(ev.detail.magnitude) || Number(ev.detail.damage) || 12;
            const element = String(ev.detail.element || 'physical') as 'physical';
            emitHitNumber(Math.round(damage), element, false);
            emitScreenShake(Math.min(10, Math.max(1, Math.round(damage / 10))));
            emitHitStop(80, 'light');
          }
          break;
        case 'combo_extend': {
          const combo = Number(ev.detail.combo) || 1;
          const isCrit = combo >= 5;
          if (isCrit) {
            fireJuice('combat-crit', { magnitude: 30 + combo * 2, targetId: ev.actorId });
          } else {
            fireJuice('combat-hit', { magnitude: 12 + combo * 3, targetId: ev.actorId });
          }
          callAudio(ev.actorId, 'combo_chime', { combo, pitch_step: Math.min(12, combo) });
          // Phase 8 add-ons: damage scales with combo; crit branch gets longer hit-stop + bigger shake.
          {
            const damage = Number(ev.detail.magnitude) || (isCrit ? 30 + combo * 4 : 12 + combo * 3);
            const element = String(ev.detail.element || 'physical') as 'physical';
            emitHitNumber(Math.round(damage), element, isCrit);
            emitScreenShake(Math.min(10, Math.max(1, Math.round(damage / 10))));
            emitHitStop(isCrit ? 120 : 80, isCrit ? 'heavy' : 'light');
          }
          break;
        }
        case 'combo_finish':
          fireJuice('combat-kill', { magnitude: 50, targetId: ev.actorId });
          callAudio(ev.actorId, 'finisher_boom', { combo: ev.detail.combo });
          // Phase 8: finisher gets the strongest juice — kill-tier hit-stop + max shake + crit number.
          {
            const damage = Number(ev.detail.magnitude) || 50;
            const element = String(ev.detail.element || 'physical') as 'physical';
            emitHitNumber(Math.round(damage), element, true);
            emitScreenShake(10);
            emitHitStop(220, 'kill');
          }
          break;
        case 'parry':
        case 'parry_perfect':
          fireJuice('combat-block', { targetId: ev.actorId });
          callAudio(ev.actorId, ev.eventKind === 'parry_perfect' ? 'perfect_parry' : 'strike_hit', {});
          // Phase 8: parry_perfect freezes the frame harder than a regular parry.
          emitHitStop(ev.eventKind === 'parry_perfect' ? 140 : 60, ev.eventKind === 'parry_perfect' ? 'crit' : 'light');
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
          // Phase 8 add-ons: rocked is the hit-reaction event — biggest perceptible feedback.
          // Magnitude > 80 triggers death clip via dispatchHitReaction (knockback ragdoll).
          {
            const element = String(ev.detail.element || 'physical') as 'physical';
            emitHitNumber(Math.round(mag), element, mag > 50);
            emitScreenShake(Math.min(10, Math.max(3, Math.round(mag / 10))));
            emitHitStop(mag > 80 ? 180 : mag > 50 ? 140 : 100, mag > 80 ? 'kill' : mag > 50 ? 'crit' : 'heavy');
            // Knockback ragdoll on near-fatal hits — combat-clips.ts already has 'death'.
            if (mag > 80) {
              dispatchHitReaction(String(ev.detail.target_id || ev.actorId), 'crit');
            }
          }
          break;
        }
        case 'grapple_environmental':
          fireJuice('combat-crit', {
            magnitude: Number(ev.detail.env_damage) || 30,
            targetId: String(ev.detail.target_id || ev.actorId),
          });
          callAudio(ev.actorId, 'grapple_slam', { surface: ev.detail.surface, damage: ev.detail.env_damage });
          // Phase 8: environmental grapple = guaranteed crit feel — full kill-tier juice.
          {
            const dmg = Number(ev.detail.env_damage) || 30;
            emitHitNumber(Math.round(dmg), 'physical', true);
            emitScreenShake(8);
            emitHitStop(160, 'crit');
          }
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

// ── Phase 8 add-on: weapon glow during combat:telegraph anticipation ────────

/**
 * Phase 8 add-on: when an attacker telegraphs a strike, the weapon
 * mesh emits a ramp-up glow during the anticipationMs window. Pure
 * CustomEvent dispatch — AvatarSystem3D's weapon-mesh listener
 * (`concordia:weapon-glow`) reads it and tweaks the material
 * `emissiveIntensity` for the duration. The substrate event already
 * carries the timing window from combat-biomechanics.ts (anticipationMs
 * scales with skill tier).
 *
 * If the attacker mesh isn't loaded yet (NPC outside view chunk), the
 * dispatch is a no-op — the weapon-mesh listener filters by entityId.
 */
export function CombatTelegraphGlowBridge() {
  useEffect(() => {
    const off = subscribe('combat:telegraph' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        attackerId?: string;
        anticipationMs?: number;
        severity?: number;
        style?: string;
        tier?: number;
      };
      if (!ev?.attackerId || !ev?.anticipationMs) return;
      // Severity 1–10 → glow intensity 0.4–1.6 (0.4 baseline so even a
      // light telegraph reads as "something is happening").
      const intensity = 0.4 + Math.min(1.2, (Number(ev.severity) || 1) / 8);
      window.dispatchEvent(new CustomEvent('concordia:weapon-glow', {
        detail: {
          entityId: ev.attackerId,
          duration_ms: Math.max(60, Math.min(400, Number(ev.anticipationMs))),
          intensity,
          style: ev.style || 'default',
        },
      }));
    });
    return () => off?.();
  }, []);
  return null;
}

// ── Phase 8 add-on: post-stagger camera punch-in ────────────────────────────

/**
 * Phase 8 add-on: combat:stagger fires when a high-magnitude hit
 * (≥30) projects through a building (DBZ-style). The substrate has
 * the data (durationMs, structuralStress); the camera should punch
 * in for the stagger window — slight zoom + roll toward the
 * impacted building so the player perceives the world responding.
 *
 * Local-relevance gate (per codex review P1, 2026-05-09): the server
 * broadcasts `combat:stagger` to the entire `world:${worldId}` room.
 * Without a locality filter, every connected client would camera-punch
 * for every staggered NPC anywhere in the world. We require that the
 * local player is the attacker OR target — `combat:stagger` now
 * carries `attackerId` (server emit augmented at routes/worlds.js:2127).
 * Other staggers are still dispatched as a CustomEvent (the scene's
 * mesh-effects can decide to render dust particles in the distance,
 * for example) but the camera-punch + screen-shake stay scoped to the
 * local player.
 */
export function CombatStaggerCameraBridge({ userId }: { userId: string | null }) {
  useEffect(() => {
    const off = subscribe('combat:stagger' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        worldId?: string;
        attackerId?: string;
        targetId?: string;
        buildingId?: string;
        durationMs?: number;
        structuralStress?: number;
      };
      if (!ev?.durationMs) return;

      const dur = Math.max(400, Math.min(4000, Number(ev.durationMs)));
      const stress = Math.max(0, Math.min(1, Number(ev.structuralStress) || 0.4));

      // Always dispatch the scene-side CustomEvent so distant mesh
      // effects (dust particles, secondary-physics rumble) can render
      // an ambient cue. Camera-punch + HUD shake are gated below.
      window.dispatchEvent(new CustomEvent('concordia:camera-punch', {
        detail: {
          duration_ms: dur,
          zoom: 1.05 + stress * 0.1,
          shake: stress * 6,
          buildingId: ev.buildingId || null,
          targetId: ev.targetId || null,
          attackerId: ev.attackerId || null,
          // Hint to the renderer: full effect or ambient-only.
          local_relevance: !!userId && (ev.attackerId === userId || ev.targetId === userId),
        },
      }));

      const isLocallyRelevant = !!userId && (ev.attackerId === userId || ev.targetId === userId);
      if (isLocallyRelevant) {
        emitScreenShake(Math.max(4, Math.round(stress * 10)));
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

// ── Phase 8 add-on: building collapse VFX on world:building-state ───────────

/**
 * Phase 8 add-on: when world:building-state transitions a building
 * to 'collapsed', dispatch a CustomEvent that the world scene's
 * BuildingCollapseVFX layer (mounted alongside the building meshes)
 * consumes — gravity-fall on the mesh + dust particle burst at the
 * impact point.
 *
 * The substrate emit at routes/worlds.js:2134 carries buildingId +
 * state + healthPct + (when available) position + attackerId.
 * We only react to the collapsed transition (the standing → damaged
 * transition gets a smaller VFX cue handled by CombatVFXLayer).
 *
 * Local-relevance gate (per codex review P1, 2026-05-09): the server
 * broadcasts `world:building-state` to the entire world room. Without
 * a filter, every client would max-shake + crit hit-stop on every
 * collapse anywhere in the world. We apply two gates:
 *   1. attackerId === userId → full feedback (you broke it, you feel it).
 *   2. Position within ~80m of the local player's last known position
 *      → full feedback (the collapse is in your scene).
 *   3. Otherwise → render a soft ambient cue (smaller shake, no
 *      hit-stop). The CustomEvent still dispatches so distant scene
 *      mesh-effects (dust on the horizon) can fire.
 *
 * Player position is read from a window-attached store
 * (`globalThis.__CONCORD_PLAYER_POS__`) that AvatarSystem3D updates.
 * Fallback: if no position is known, treat as ambient.
 */
export function BuildingCollapseBridge({ userId }: { userId: string | null }) {
  useEffect(() => {
    const off = subscribe('world:building-state' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        worldId?: string;
        buildingId?: string;
        state?: 'standing' | 'damaged' | 'collapsed';
        position?: { x?: number; z?: number } | null;
        attackerId?: string | null;
        healthPct?: number;
      };
      if (!ev?.buildingId || ev.state !== 'collapsed') return;

      // Local-relevance check.
      let localRelevance: 'full' | 'soft' = 'soft';
      if (userId && ev.attackerId === userId) {
        localRelevance = 'full';
      } else if (ev.position) {
        const playerPos = (globalThis as { __CONCORD_PLAYER_POS__?: { x: number; z: number } }).__CONCORD_PLAYER_POS__;
        if (playerPos && typeof ev.position.x === 'number' && typeof ev.position.z === 'number') {
          const dx = ev.position.x - playerPos.x;
          const dz = ev.position.z - playerPos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq <= 80 * 80) localRelevance = 'full';
        }
      }

      window.dispatchEvent(new CustomEvent('concordia:building-collapse', {
        detail: {
          buildingId: ev.buildingId,
          worldId: ev.worldId || null,
          position: ev.position || null,
          duration_ms: 2000,
          local_relevance: localRelevance,
        },
      }));

      if (localRelevance === 'full') {
        // The player is involved or close enough for the building
        // collapse to be a perceptible scene event.
        emitScreenShake(10);
        emitHitStop(180, 'crit');
      } else {
        // Distant collapse — ambient cue only. A small shake reads
        // as "something fell over there" without disorienting the
        // player. No hit-stop.
        emitScreenShake(3);
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

// ── Phase B2: socket combat:hit (lethal) → concordia:lethal-hit ────────────
/**
 * Listens for the `combat:hit` socket event and, when `lethal=true`,
 * dispatches `concordia:lethal-hit` so ragdoll-bridge can spawn a
 * ragdoll at the target's last known position. Mass multiplier comes
 * from the server's actor_physique compute (mig 153 npc_stress et al.).
 */
export function LethalHitBridge() {
  useEffect(() => {
    const off = subscribe('combat:hit' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        lethal?: boolean;
        targetId?: string;
        targetPosition?: { x: number; y?: number; z: number };
        impulse?: { x: number; y: number; z: number };
        massMultiplier?: number;
      };
      if (!ev?.lethal || !ev.targetId || !ev.targetPosition) return;
      window.dispatchEvent(new CustomEvent('concordia:lethal-hit', {
        detail: {
          targetId: ev.targetId,
          position: { x: ev.targetPosition.x, y: ev.targetPosition.y ?? 0, z: ev.targetPosition.z },
          impulse: ev.impulse,
          massMultiplier: ev.massMultiplier,
        },
      }));
    });
    return () => { off(); };
  }, []);
  return null;
}

// ── T1.4b: server-authoritative combat feel (impact → hitstop/knockback/wince) ─
/**
 * T1.4b — the server now resolves a real poise stagger from impact momentum
 * (T1.4a: bone-mass × angular-velocity × lever vs the recipient's poise
 * budget) and emits `combat:impact` carrying a `feel` block with the exact
 * hitstop windows, knockback magnitude, and wince severity the client should
 * apply. This bridge dispatches the very same CustomEvents the avatar update
 * loop already honours — `concordia:hit-pause` (mixer freeze window),
 * `concordia:knockback` (kinematic impulse via physicsWorld.knockbackKinematic),
 * and `concordia:hit-reaction` (wince/stagger reflex animation) — but now keyed
 * on physics, not the old `damage > 25` heuristic. GameJuice's local heuristic
 * still fires for instant optimistic feedback; this layer is the authoritative
 * correction (idempotent on the receiver — last-write-wins on the pause window).
 *
 * Direction is derived from attacker→target so the shove points away from the
 * source, matching the GameJuice knockback convention.
 */
export function CombatImpactFeelBridge({ userId = null }: { userId?: string | null } = {}) {
  const { effectiveReducedMotion } = useAccessibilitySettings();
  useEffect(() => {
    const off = subscribe('combat:impact' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as {
        attackerId?: string;
        targetId?: string;
        severity?: 'none' | 'flinch' | 'rocked' | 'knockdown';
        isKill?: boolean;
        targetPosition?: { x: number; y?: number; z: number } | null;
        attackerPosition?: { x: number; y?: number; z: number } | null;
        feel?: {
          targetPauseMs?: number;
          attackerPauseMs?: number;
          knockback?: number;
          knockMs?: number;
          wince?: 'none' | 'light' | 'heavy' | 'crit';
        };
      };
      if (!ev?.targetId || !ev.feel) return;
      const feel = ev.feel;

      // 1) Hitstop — freeze the target's (and briefly the attacker's) mixer.
      // T2.7 — through the single deduped authority so this server-authoritative
      // path and GameJuice's legacy path can't double-freeze the same strike.
      if ((feel.targetPauseMs ?? 0) > 0) requestHitPause(ev.targetId, feel.targetPauseMs ?? 0);
      if ((feel.attackerPauseMs ?? 0) > 0 && ev.attackerId) requestHitPause(ev.attackerId, feel.attackerPauseMs ?? 0);

      // 2) Knockback — kinematic impulse away from the attacker. Only when we
      // know both endpoints so the direction is real (matches GameJuice).
      if ((feel.knockback ?? 0) > 0 && ev.targetPosition && ev.attackerPosition) {
        const dx = ev.targetPosition.x - ev.attackerPosition.x;
        const dz = ev.targetPosition.z - ev.attackerPosition.z;
        const mag = Math.hypot(dx, dz) || 1;
        window.dispatchEvent(new CustomEvent('concordia:knockback', {
          detail: {
            entityId: ev.targetId,
            direction: { x: dx / mag, z: dz / mag },
            magnitude: feel.knockback,
            durationMs: feel.knockMs ?? 220,
          },
        }));
      }

      // 3) Wince / topple reflex — the recipient's hit-reaction animation,
      // graded by the server severity rather than the local damage threshold.
      const wince = feel.wince ?? 'none';
      if (wince !== 'none') {
        dispatchHitReaction(ev.targetId, wince === 'crit' ? 'crit' : wince === 'heavy' ? 'heavy' : 'light');
      }

      // 4) T2.8 — camera FOV punch on a HEAVY outcome, but ONLY for the local
      // player (attacker or target), severity-scaled, reduced-motion-gated. The
      // pure decision lives in computeImpactCameraPunch (unit-tested); NPC-vs-NPC
      // strikes the player merely witnesses never punch the camera. Reuses the
      // existing concordia:camera-punch consumer (ConcordiaScene, clamps applied).
      const punch = computeImpactCameraPunch(ev, { userId, reducedMotion: effectiveReducedMotion });
      if (punch) {
        window.dispatchEvent(new CustomEvent('concordia:camera-punch', { detail: punch }));
      }
    });
    return () => { off?.(); };
  }, [userId, effectiveReducedMotion]);
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
      {/* Phase 8 Sprint-B add-ons */}
      <CombatTelegraphGlowBridge />
      <CombatStaggerCameraBridge userId={userId} />
      <BuildingCollapseBridge userId={userId} />
      {/* Phase B2 — combat:hit (lethal) → ragdoll bridge */}
      <LethalHitBridge />
      {/* T1.4b — server-authoritative impact → hitstop/knockback/wince (NPC path) */}
      <CombatImpactFeelBridge userId={userId} />
      {/* T1.4b/T3.1b — live client momentum model on the PvP combat:hit path */}
      <ImpactMomentumBridge />
      {/* Visual polish — element bursts + blood decals on every combat hit */}
      <CombatVFXBridge />
    </>
  );
}
