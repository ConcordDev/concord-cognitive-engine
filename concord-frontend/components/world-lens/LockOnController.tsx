'use client';

/**
 * LockOnController — soft + hard combat lock-on.
 *
 * Soft lock: Tab key cycles through nearest-N enemies in the player's facing
 * cone. Auto-releases if the locked target leaves the lock-radius.
 *
 * Hard lock: holding the middle mouse button (or KeyT) maintains the lock
 * even if the target leaves the cone — useful for tracking a fleeing enemy.
 *
 * Renders a reticle DOM element over the locked target's screen position.
 * Combat input controller and camera both read `cameraLookState.lockedTargetId`.
 */

import { useEffect, useRef, useState } from 'react';
import { cameraLookState, setLockOnTarget, clearLockOnTarget } from '@/lib/world-lens/camera-look-state';

interface LockTarget {
  id: string;
  name?: string;
  position: { x: number; y: number; z?: number };
  isPlayer?: boolean;
}

interface LockOnControllerProps {
  playerPosition: { x: number; y: number; z?: number };
  /** Camera yaw in radians (forward direction). */
  cameraYaw: number;
  /** All lockable entities — NPCs and other players. */
  lockables: LockTarget[];
  /** Max lock-on distance in world units. */
  lockRadius?: number;
  /** Half-angle (radians) of the cone in front of the player to consider. */
  coneHalfAngle?: number;
}

const DEFAULT_LOCK_RADIUS = 25;
const DEFAULT_CONE_HALF_ANGLE = Math.PI / 3; // 60°

export function LockOnController({
  playerPosition,
  cameraYaw,
  lockables,
  lockRadius = DEFAULT_LOCK_RADIUS,
  coneHalfAngle = DEFAULT_CONE_HALF_ANGLE,
}: LockOnControllerProps) {
  const [reticlePos, setReticlePos] = useState<{ x: number; y: number } | null>(null);
  const cycleIndexRef = useRef(0);

  // Compute candidates within radius + facing cone, sorted by distance
  const candidates = (() => {
    const out: { target: LockTarget; dist: number }[] = [];
    for (const t of lockables) {
      const dx = t.position.x - playerPosition.x;
      const dy = t.position.y - playerPosition.y;
      const dist = Math.hypot(dx, dy);
      if (dist > lockRadius || dist < 0.1) continue;
      const angleToTarget = Math.atan2(dy, dx);
      // Camera yaw conventions vary; allow ±cone around forward
      let delta = angleToTarget - cameraYaw;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) > coneHalfAngle) continue;
      out.push({ target: t, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  })();

  // Tab cycles through candidates (soft lock); KeyT toggles hard lock on
  // current candidate; Escape clears lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (candidates.length === 0) {
          clearLockOnTarget();
          return;
        }
        cycleIndexRef.current = (cycleIndexRef.current + 1) % candidates.length;
        const pick = candidates[cycleIndexRef.current];
        setLockOnTarget(
          pick.target.id,
          { x: pick.target.position.x, y: pick.target.position.z ?? 0, z: pick.target.position.y },
          'soft',
        );
      } else if (e.code === 'KeyT') {
        // Toggle hard lock on current candidate
        if (cameraLookState.lockedTargetId) {
          clearLockOnTarget();
        } else if (candidates.length > 0) {
          const pick = candidates[0];
          setLockOnTarget(
            pick.target.id,
            { x: pick.target.position.x, y: pick.target.position.z ?? 0, z: pick.target.position.y },
            'hard',
          );
        }
      } else if (e.code === 'Escape' && cameraLookState.lockedTargetId) {
        clearLockOnTarget();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [candidates]);

  // Soft-lock auto-release when the target leaves the cone or radius
  useEffect(() => {
    if (!cameraLookState.lockedTargetId) {
      setReticlePos(null);
      return;
    }
    const locked = lockables.find((t) => t.id === cameraLookState.lockedTargetId);
    if (!locked) {
      clearLockOnTarget();
      return;
    }
    // Soft lock auto-releases if out of cone/range; hard lock holds.
    if (cameraLookState.lockMode === 'soft') {
      const stillInCone = candidates.some((c) => c.target.id === locked.id);
      if (!stillInCone) {
        clearLockOnTarget();
        return;
      }
    } else {
      // Hard lock: still release if out of double radius (lost visual)
      const dist = Math.hypot(locked.position.x - playerPosition.x, locked.position.y - playerPosition.y);
      if (dist > lockRadius * 2) {
        clearLockOnTarget();
        return;
      }
    }
    // Update locked position so combat / camera read fresh data
    cameraLookState.lockedTargetPos = {
      x: locked.position.x,
      y: locked.position.z ?? 0,
      z: locked.position.y,
    };
  }, [lockables, playerPosition, candidates, lockRadius]);

  // T2.3 — project the locked target to screen for the reticle using the REAL
  // camera-matrix projector (was a Math.atan2 yaw approximation that used the
  // height axis as a ground axis and drifted badly at screen edges). Mirrors the
  // DamageBillboard projector pattern: cache the projector, rAF + throttle, and
  // place the reticle at the target's true projected screen position.
  const projectorRef = useRef<((w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean }) | null>(null);
  const lockablesRef = useRef(lockables);
  lockablesRef.current = lockables;
  useEffect(() => {
    type Proj = (w: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean };
    const win = window as unknown as { __concordiaProject?: Proj };
    if (win.__concordiaProject) projectorRef.current = win.__concordiaProject;
    const onProjector = (e: Event) => {
      const p = (e as CustomEvent).detail?.project as Proj | undefined;
      if (typeof p === 'function') projectorRef.current = p;
    };
    window.addEventListener('concordia:projector-ready', onProjector);

    let raf = 0;
    let lastAt = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastAt < 60) return; // throttle reticle updates to ~16Hz
      lastAt = now;
      const id = cameraLookState.lockedTargetId;
      const proj = projectorRef.current;
      if (!id || !proj) { setReticlePos((r) => (r ? null : r)); return; }
      const t = lockablesRef.current.find((x) => x.id === id);
      const pos = t ? t.position : cameraLookState.lockedTargetPos;
      if (!pos) { setReticlePos((r) => (r ? null : r)); return; }
      // World coords: x/z are the ground plane, y is height — lift to head level.
      const s = proj({ x: pos.x, y: (pos.y ?? 0) + 1.2, z: ('z' in pos ? (pos.z as number) : 0) ?? 0 });
      setReticlePos(s && s.visible ? { x: s.x, y: s.y } : null);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('concordia:projector-ready', onProjector);
    };
  }, []);

  if (!reticlePos || !cameraLookState.lockedTargetId) return null;

  const isHard = cameraLookState.lockMode === 'hard';
  const locked = lockables.find((t) => t.id === cameraLookState.lockedTargetId);
  const label = locked?.name || locked?.id || '';

  return (
    <div
      className="fixed pointer-events-none z-[40]"
      style={{
        left: reticlePos.x,
        top: reticlePos.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div
        className={`relative h-12 w-12 rounded-full border-2 ${
          isHard ? 'border-rose-400' : 'border-amber-300/80'
        } ${isHard ? 'animate-pulse' : ''}`}
        style={{
          boxShadow: isHard
            ? '0 0 18px rgba(251, 113, 133, 0.55)'
            : '0 0 12px rgba(252, 211, 77, 0.45)',
        }}
      >
        <div
          className={`absolute -top-1 left-1/2 h-2 w-0.5 -translate-x-1/2 ${
            isHard ? 'bg-rose-400' : 'bg-amber-300'
          }`}
        />
        <div
          className={`absolute -bottom-1 left-1/2 h-2 w-0.5 -translate-x-1/2 ${
            isHard ? 'bg-rose-400' : 'bg-amber-300'
          }`}
        />
        <div
          className={`absolute -left-1 top-1/2 h-0.5 w-2 -translate-y-1/2 ${
            isHard ? 'bg-rose-400' : 'bg-amber-300'
          }`}
        />
        <div
          className={`absolute -right-1 top-1/2 h-0.5 w-2 -translate-y-1/2 ${
            isHard ? 'bg-rose-400' : 'bg-amber-300'
          }`}
        />
      </div>
      {label && (
        <div
          className={`mt-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${
            isHard ? 'bg-rose-950/80 text-rose-200' : 'bg-amber-950/80 text-amber-200'
          }`}
          style={{ transform: 'translateX(-50%)', position: 'relative', left: '50%' }}
        >
          {label}
          {isHard && <span className="ml-1 opacity-60">[hard]</span>}
        </div>
      )}
    </div>
  );
}
