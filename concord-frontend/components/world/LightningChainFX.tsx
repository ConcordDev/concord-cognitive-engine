'use client';

/**
 * LightningChainFX — renders the visual chain when `combat:chain-batch`
 * fires from server. Reads from the consolidated batch event (one per
 * chain cast) which includes the source position + up to 5 target
 * positions + the player's attacker position.
 *
 * Pattern mirrors BuildingCollapseVFX:
 *   - DOM overlay (no R3F integration), pointer-events: none
 *   - Camera projection passed in via getCamera prop
 *   - Auto-cull on TTL
 *
 * Two visual modes:
 *   1. Camera available → render SVG polylines between projected
 *      world positions for each arc (attacker → main target → fan
 *      out to chain targets). Crackle effect via sin-wave perturbation
 *      driven by elapsed time.
 *   2. Camera null → fallback screen-edge flash so the player still
 *      sees that something happened.
 *
 * Lifecycle: ~600ms per arc, no allocation in render loop (state
 * filter on TTL handles cleanup).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe, SocketEvent } from '@/lib/realtime/socket';

interface ChainTarget {
  id: string;
  kind: 'npc' | 'player';
  x: number;
  z: number;
  distance: number;
}

interface ChainBatchEvent {
  worldId?: string;
  sourceTargetId: string;
  sourceX?: number;
  sourceZ?: number;
  attackerId?: string | null;
  attackerX?: number;
  attackerZ?: number;
  chainDamage: number;
  element: string;
  targets: ChainTarget[];
}

interface CameraSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  width: number;
  height: number;
}

interface Props {
  worldId: string;
  getCamera: () => CameraSnapshot | null;
}

interface ActiveChain {
  id: string;
  startedAt: number;
  attackerX?: number;
  attackerZ?: number;
  sourceX?: number;
  sourceZ?: number;
  targets: ChainTarget[];
  chainDamage: number;
}

const TTL_MS = 600;

export default function LightningChainFX({ worldId, getCamera }: Props) {
  const [active, setActive] = useState<ActiveChain[]>([]);

  const handle = useCallback((payload: unknown) => {
    const ev = payload as ChainBatchEvent;
    if (!ev || (ev.worldId && ev.worldId !== worldId)) return;
    if (!Array.isArray(ev.targets) || ev.targets.length === 0) return;
    const id = `chain_${ev.sourceTargetId}_${Date.now()}`;
    setActive((prev) => [
      ...prev,
      {
        id,
        startedAt: performance.now(),
        attackerX: ev.attackerX,
        attackerZ: ev.attackerZ,
        sourceX: ev.sourceX,
        sourceZ: ev.sourceZ,
        targets: ev.targets,
        chainDamage: ev.chainDamage || 0,
      },
    ]);
    setTimeout(() => {
      setActive((prev) => prev.filter((c) => c.id !== id));
    }, TTL_MS + 100);
  }, [worldId]);

  useEffect(() => {
    const off = subscribe('combat:chain-batch' as Parameters<typeof subscribe>[0], handle);
    return () => { off?.(); };
  }, [handle]);

  // Drive re-render while any chain is active (crackle animation).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (active.length === 0) return;
    let raf: number;
    const loop = () => { setTick((t) => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active.length]);

  if (active.length === 0) return null;
  const cam = getCamera();
  const now = performance.now();

  // Fallback flash when no camera (pre-camera-wire) — full-screen blue
  // pulse so the player still sees the chain hit.
  if (!cam) {
    const newest = active[active.length - 1];
    const elapsed = now - newest.startedAt;
    const t = Math.min(1, elapsed / TTL_MS);
    return (
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 8,
          background: `radial-gradient(circle at 50% 50%, rgba(180, 220, 255, ${0.18 * (1 - t)}) 0%, transparent 60%)`,
          boxShadow: `inset 0 0 ${120 * (1 - t)}px ${40 * (1 - t)}px rgba(140, 200, 255, ${0.4 * (1 - t)})`,
        }}
      />
    );
  }

  return (
    <svg
      aria-hidden
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 8 }}
      width={cam.width}
      height={cam.height}
      viewBox={`0 0 ${cam.width} ${cam.height}`}
    >
      <defs>
        <filter id="lightning-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {active.map((chain) => {
        const elapsed = now - chain.startedAt;
        const t = Math.min(1, elapsed / TTL_MS);
        const opacity = 1 - t;
        // Source endpoint: prefer attacker → main target → chain target.
        // Anchored at the main target's projection (the strike point).
        if (chain.sourceX == null || chain.sourceZ == null) return null;
        const src = project(chain.sourceX, 1.5, chain.sourceZ, cam);
        if (!src.visible) return null;

        return (
          <g key={chain.id}>
            {chain.targets.map((target, i) => {
              const dst = project(target.x, 1.5, target.z, cam);
              if (!dst.visible) return null;
              // Crackle: 3 segments with sin-perturbed midpoints.
              const midX1 = src.x + (dst.x - src.x) * 0.33;
              const midY1 = src.y + (dst.y - src.y) * 0.33;
              const midX2 = src.x + (dst.x - src.x) * 0.66;
              const midY2 = src.y + (dst.y - src.y) * 0.66;
              const jitter = 14 * (1 - t);
              const phase = now / 30 + i * 0.7;
              const j1x = midX1 + Math.sin(phase) * jitter;
              const j1y = midY1 + Math.cos(phase * 1.3) * jitter;
              const j2x = midX2 + Math.sin(phase * 1.7 + 0.5) * jitter;
              const j2y = midY2 + Math.cos(phase * 1.1 + 0.2) * jitter;
              const path = `M ${src.x} ${src.y} L ${j1x} ${j1y} L ${j2x} ${j2y} L ${dst.x} ${dst.y}`;
              return (
                <g key={target.id} filter="url(#lightning-glow)">
                  {/* Outer glow */}
                  <path d={path} stroke="rgba(140, 200, 255, 0.6)" strokeWidth={6} fill="none" opacity={opacity * 0.7} strokeLinecap="round" strokeLinejoin="round" />
                  {/* Core bolt */}
                  <path d={path} stroke="white" strokeWidth={2} fill="none" opacity={opacity} strokeLinecap="round" strokeLinejoin="round" />
                  {/* Endpoint spark */}
                  <circle cx={dst.x} cy={dst.y} r={6 * (1 - t * 0.6)} fill="rgba(200, 230, 255, 0.9)" opacity={opacity} />
                </g>
              );
            })}
            {/* Source-strike flash */}
            <circle cx={src.x} cy={src.y} r={10 * (1 - t * 0.4)} fill="rgba(180, 220, 255, 0.85)" opacity={opacity} filter="url(#lightning-glow)" />
          </g>
        );
      })}
    </svg>
  );
}

function project(wx: number, wy: number, wz: number, cam: CameraSnapshot) {
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  const rx = dx * cy + dz * sy;
  let rz = -dx * sy + dz * cy;
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  const ry = dy * cp - rz * sp;
  rz = dy * sp + rz * cp;
  if (rz <= 0.5) return { x: 0, y: 0, visible: false };
  const f = (cam.height / 2) / Math.tan(cam.fov / 2);
  return {
    x: (rx / rz) * f + cam.width / 2,
    y: (-ry / rz) * f + cam.height / 2,
    visible: true,
  };
}
