'use client';

import { useEffect, useRef } from 'react';

/**
 * WorldSFXHooks — wires the polish-pass SFX library to the existing world
 * gameplay events. Mount once inside the world lens at the same level as
 * the SoundscapeEngine.
 *
 * It dispatches via the `concordia:soundscape-command` window channel
 * SoundscapeEngine already listens on, so it doesn't need to live inside
 * the SoundscapeContext provider tree.
 *
 * Inputs:
 *   - playerPos: live player position (x, y, z) — drives footsteps
 *   - districtId: drives surface variant (stone for paved districts,
 *     wood for the docks, grass for frontier, etc.)
 *   - moving: whether the player is currently moving (suppresses footsteps
 *     when stationary)
 *
 * Wired events (window):
 *   - concordia:ui-click            → ui-click sfx
 *   - concordia:inventory-opened    → inventory-rustle sfx
 *   - concordia:craft-success       → craft-ding sfx
 *   - concordia:sword-swing         → sword-swoosh / sword-swoosh-heavy
 *
 * Plus a global capture-phase document click that plays ui-click for any
 * <button> press (covers HUD buttons across panels and dialogs).
 */

const DISTRICT_TO_SURFACE: Record<string, 'grass' | 'stone' | 'wood' | 'water'> = {
  forge: 'stone',
  industrial: 'stone',
  academy: 'stone',
  exchange: 'stone',
  market: 'stone',
  observatory: 'wood',
  tech: 'stone',
  arena: 'stone',
  nexus: 'stone',
  civic: 'stone',
  arts: 'wood',
  commons: 'stone',
  docks: 'wood',
  grid: 'stone',
  frontier: 'grass',
  silent: 'grass',
};

interface Props {
  playerPos: { x: number; y: number; z: number };
  districtId: string;
  moving: boolean;
}

function dispatchSfx(sfxId: string, position?: { x: number; y: number; z: number }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('concordia:soundscape-command', {
      detail: position
        ? { action: 'playSpatialSFX', sfxId, position }
        : { action: 'triggerSFX', sfxId },
    }),
  );
}

export default function WorldSFXHooks({ playerPos, districtId, moving }: Props) {
  const lastStepPosRef = useRef<{ x: number; z: number; t: number }>({
    x: playerPos.x,
    z: playerPos.z,
    t: 0,
  });
  const lastClickAtRef = useRef(0);

  // ── Footsteps — distance + time gated, surface-aware ────────────────────────
  useEffect(() => {
    if (!moving) {
      lastStepPosRef.current = { x: playerPos.x, z: playerPos.z, t: lastStepPosRef.current.t };
      return;
    }
    const dx = playerPos.x - lastStepPosRef.current.x;
    const dz = playerPos.z - lastStepPosRef.current.z;
    const dist = Math.hypot(dx, dz);
    const now = performance.now();
    const surface = DISTRICT_TO_SURFACE[districtId] ?? 'stone';
    // ~1.4 world units between steps with 320–480ms minimum gap so sprinting
    // doesn't machine-gun footsteps. Water/grass cadence slightly slower.
    const minGap = surface === 'water' ? 480 : surface === 'grass' ? 380 : 320;
    if (dist >= 1.4 && now - lastStepPosRef.current.t >= minGap) {
      dispatchSfx(`footstep-${surface}`, { x: playerPos.x, y: playerPos.y, z: playerPos.z });
      lastStepPosRef.current = { x: playerPos.x, z: playerPos.z, t: now };
    }
  }, [playerPos.x, playerPos.z, playerPos.y, moving, districtId]);

  // ── Inventory open / craft success / sword swing window events ──────────────
  useEffect(() => {
    const onInventoryOpen = () => dispatchSfx('inventory-rustle');
    const onCraftSuccess = () => dispatchSfx('craft-ding');
    const onSwordSwing = (e: Event) => {
      const heavy = (e as CustomEvent).detail?.heavy;
      dispatchSfx(heavy ? 'sword-swoosh-heavy' : 'sword-swoosh');
    };
    const onUiClick = () => dispatchSfx('ui-click');
    window.addEventListener('concordia:inventory-opened', onInventoryOpen);
    window.addEventListener('concordia:craft-success', onCraftSuccess);
    window.addEventListener('concordia:sword-swing', onSwordSwing);
    window.addEventListener('concordia:ui-click', onUiClick);
    return () => {
      window.removeEventListener('concordia:inventory-opened', onInventoryOpen);
      window.removeEventListener('concordia:craft-success', onCraftSuccess);
      window.removeEventListener('concordia:sword-swing', onSwordSwing);
      window.removeEventListener('concordia:ui-click', onUiClick);
    };
  }, []);

  // ── Global button-click SFX ─────────────────────────────────────────────────
  // Capture-phase so we hit before any per-component handler. We only fire for
  // <button> / [role="button"], not arbitrary <div> click targets — keeps the
  // SFX from triggering on every world click. Components can opt out by
  // setting data-no-click-sfx="true" on the element.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest('button, [role="button"], a[role="button"]');
      if (!button) return;
      if ((button as HTMLElement).dataset.noClickSfx === 'true') return;
      const now = performance.now();
      if (now - lastClickAtRef.current < 60) return;
      lastClickAtRef.current = now;
      dispatchSfx('ui-click');
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, []);

  return null;
}
