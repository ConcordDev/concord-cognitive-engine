'use client';

/**
 * CombatBridges — adapters that listen to `combat:polish` socket events
 * and fan them out to the user's animation / audio / camera / VFX
 * asset systems. Each bridge exposes a tiny public hook so the asset
 * integrator can swap in their own implementation without touching the
 * substrate.
 *
 * The pattern: each bridge calls a globalThis hook with a typed
 * payload. If the hook is unset, the bridge is a no-op. The substrate
 * + HUD work without any of these wired; the bridges are the polish.
 *
 * Hooks (set these on globalThis in your asset system bootstrap):
 *
 *   __CONCORD_ANIMATION_HOOK__ ({ actorId, animation, opts })
 *     animation ∈ "combo_strike" | "rocked_in" | "rocked_out" |
 *                 "parry_perfect" | "dodge_perfect" | "stance_change" |
 *                 "finisher" | "grapple_slam" | "gassed_out"
 *
 *   __CONCORD_AUDIO_HOOK__ ({ actorId, sound, opts })
 *     sound ∈ "strike_hit" | "combo_chime" | "perfect_parry" |
 *             "perfect_dodge" | "rocked_thud" | "gassed_wheeze" |
 *             "finisher_boom" | "grapple_slam"
 *
 *   __CONCORD_CAMERA_HOOK__ ({ effect, opts })
 *     effect ∈ "time_dilation" | "rocked_shake" | "finisher_dolly" |
 *              "grapple_zoom"
 *
 *   __CONCORD_VFX_HOOK__ ({ actorId, vfx, opts })
 *     vfx ∈ "combo_trail" | "perfect_parry_spark" |
 *           "sandevistan_shader" | "finisher_burst" |
 *           "gas_low_pulse" | "rocked_aura"
 *
 * The bridges are pure event-routing. No DOM manipulation, no asset
 * loading. Drop them next to your existing asset orchestrator and
 * point the hooks at it.
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function callAnimation(actorId: string, animation: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_ANIMATION_HOOK__?: AnimationHook }).__CONCORD_ANIMATION_HOOK__;
  if (typeof hook === 'function') {
    try { hook({ actorId, animation, opts }); } catch { /* asset system errors don't break the bridge */ }
  }
}

function callAudio(actorId: string, sound: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_AUDIO_HOOK__?: AudioHook }).__CONCORD_AUDIO_HOOK__;
  if (typeof hook === 'function') {
    try { hook({ actorId, sound, opts }); } catch { /* ignore */ }
  }
}

function callCamera(effect: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_CAMERA_HOOK__?: CameraHook }).__CONCORD_CAMERA_HOOK__;
  if (typeof hook === 'function') {
    try { hook({ effect, opts }); } catch { /* ignore */ }
  }
}

function callVFX(actorId: string, vfx: string, opts: Record<string, unknown> = {}) {
  const hook = (globalThis as { __CONCORD_VFX_HOOK__?: VFXHook }).__CONCORD_VFX_HOOK__;
  if (typeof hook === 'function') {
    try { hook({ actorId, vfx, opts }); } catch { /* ignore */ }
  }
}

// ── Animation Bridge ────────────────────────────────────────────────────────

/**
 * Listens to combat events and triggers animation hooks on the
 * user's asset system. The mapping below is the integration point —
 * adjust to your animation library's clip names.
 */
export function CombatAnimationBridge() {
  useEffect(() => {
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev?.actorId) return;

      switch (ev.eventKind) {
        case 'combo_start':
        case 'combo_extend':
          callAnimation(ev.actorId, 'combo_strike', { combo: ev.detail.combo });
          break;
        case 'combo_finish':
          callAnimation(ev.actorId, 'finisher', { combo: ev.detail.combo, multiplier: ev.detail.multiplier });
          break;
        case 'rocked':
          callAnimation(ev.actorId, 'rocked_in', { magnitude: ev.detail.magnitude, until_ms: ev.detail.until });
          break;
        case 'parry_perfect':
          callAnimation(ev.actorId, 'parry_perfect', { lead_ms: ev.detail.lead_ms });
          break;
        case 'parry':
          callAnimation(ev.actorId, 'parry', { lead_ms: ev.detail.lead_ms });
          break;
        case 'dodge_perfect':
          callAnimation(ev.actorId, 'dodge_perfect', { lead_ms: ev.detail.lead_ms });
          break;
        case 'dodge':
          callAnimation(ev.actorId, 'dodge', { lead_ms: ev.detail.lead_ms });
          break;
        case 'stance_change':
          callAnimation(ev.actorId, 'stance_change', { from: ev.detail.from, to: ev.detail.to });
          break;
        case 'grapple_environmental':
          callAnimation(ev.actorId, 'grapple_slam', {
            target: ev.detail.target_id,
            surface: ev.detail.surface,
            damage: ev.detail.env_damage,
          });
          break;
        case 'gassed_out':
          callAnimation(ev.actorId, 'gassed_out', { gas_after: ev.detail.gas_after });
          break;
      }
    });
    return () => off?.();
  }, []);
  return null;
}

// ── Audio Bridge ────────────────────────────────────────────────────────────

export function CombatAudioBridge() {
  useEffect(() => {
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      if (!ev?.actorId) return;

      switch (ev.eventKind) {
        case 'combo_start':
          callAudio(ev.actorId, 'strike_hit', { combo: 1 });
          break;
        case 'combo_extend':
          callAudio(ev.actorId, 'combo_chime', { combo: ev.detail.combo, pitch_step: Math.min(12, Number(ev.detail.combo) || 1) });
          break;
        case 'combo_finish':
          callAudio(ev.actorId, 'finisher_boom', { combo: ev.detail.combo });
          break;
        case 'parry_perfect':
          callAudio(ev.actorId, 'perfect_parry', {});
          break;
        case 'dodge_perfect':
          callAudio(ev.actorId, 'perfect_dodge', {});
          break;
        case 'rocked':
          callAudio(ev.actorId, 'rocked_thud', { magnitude: ev.detail.magnitude });
          break;
        case 'gassed_out':
          callAudio(ev.actorId, 'gassed_wheeze', {});
          break;
        case 'grapple_environmental':
          callAudio(ev.actorId, 'grapple_slam', { surface: ev.detail.surface, damage: ev.detail.env_damage });
          break;
      }
    });
    return () => off?.();
  }, []);
  return null;
}

// ── Camera Director ─────────────────────────────────────────────────────────

/**
 * Reacts to global combat events with camera-level effects:
 *   - perfect dodge → time-dilation slow-mo (durations ~time_dilation_pct × 1000ms)
 *   - rocked → screen shake
 *   - finisher → cinematic dolly-in
 *   - grapple → quick zoom-in on the slam point
 *
 * Only triggers for the local player's events (the camera is the
 * player's POV).
 */
export function CombatCameraDirector({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (!userId) return;
    const off = subscribe('combat:polish' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatPolishEvent;
      // Camera is per-player; only react if THIS player is involved.
      if (!ev || (ev.actorId !== userId && !isCrowdEvent(ev))) return;

      switch (ev.eventKind) {
        case 'dodge_perfect': {
          const dilation = Number(ev.detail.time_dilation) || 0;
          if (dilation > 0) {
            callCamera('time_dilation', {
              factor: 1 - dilation,
              duration_ms: Math.round(dilation * 1000),
            });
          }
          break;
        }
        case 'rocked':
          if (ev.actorId === userId) {
            callCamera('rocked_shake', { magnitude: ev.detail.magnitude, duration_ms: 600 });
          }
          break;
        case 'combo_finish':
          if (ev.actorId === userId) {
            callCamera('finisher_dolly', { combo: ev.detail.combo, duration_ms: 800 });
          }
          break;
        case 'grapple_environmental':
          if (ev.actorId === userId) {
            callCamera('grapple_zoom', { surface: ev.detail.surface, duration_ms: 500 });
          }
          break;
      }
    });
    return () => off?.();
  }, [userId]);
  return null;
}

function isCrowdEvent(ev: CombatPolishEvent): boolean {
  // Events that warrant a camera reaction even when YOU aren't the actor —
  // e.g., a nearby NPC's finisher or a major slam visible to crowds.
  return ev.eventKind === 'combo_finish' || ev.eventKind === 'grapple_environmental';
}

// ── VFX Layer ───────────────────────────────────────────────────────────────

/**
 * Spawns particle effects + shader passes per event. Hands off via the
 * VFX hook to the user's particle system.
 */
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
          break;
        case 'parry_perfect':
          callVFX(ev.actorId, 'perfect_parry_spark', { lead_ms: ev.detail.lead_ms });
          break;
        case 'dodge_perfect': {
          const dilation = Number(ev.detail.time_dilation) || 0;
          if (dilation >= 0.3) {
            // High-dilation dodges (Cyberpunk profile) get the
            // sandevistan post-process shader.
            callVFX(ev.actorId, 'sandevistan_shader', { duration_ms: Math.round(dilation * 1000) });
          }
          break;
        }
        case 'combo_finish':
          callVFX(ev.actorId, 'finisher_burst', { combo: ev.detail.combo });
          break;
        case 'gassed_out':
          // Local-only: gas-low pulse around the player.
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

// ── Convenience: mount all four bridges + the HUD with one component ────────

export function CombatPolishLayer({ userId }: { userId: string | null }) {
  return (
    <>
      <CombatAnimationBridge />
      <CombatAudioBridge />
      <CombatCameraDirector userId={userId} />
      <CombatVFXLayer userId={userId} />
    </>
  );
}
