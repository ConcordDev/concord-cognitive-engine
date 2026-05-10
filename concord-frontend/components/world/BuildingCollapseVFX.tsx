'use client';

/**
 * BuildingCollapseVFX — Sprint C / Track B4
 *
 * Subscribes to `world:building-state` socket events (already emitted by
 * `applyStructuralStress`) and renders phased visual feedback:
 *   standing → damaged: cracks decal + brief dust puff
 *   damaged  → collapsed: 1.5s gravity-fall on procedural debris + dust
 *
 * Lightweight DOM canvas overlay (no R3F integration) — collapse renders
 * as projected screen-space chunks above the building's last known position.
 * Caller (world page) supplies a getCamera() projection so the dust lands
 * where the building actually was.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface BuildingStateEvent {
  worldId?: string;
  buildingId: string;
  fromState?: 'standing' | 'damaged' | 'collapsed';
  toState: 'standing' | 'damaged' | 'collapsed';
  position?: { x: number; y: number; z: number };
}

interface CameraSnapshot {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  fov: number;
  width: number; height: number;
}

interface VFXItem {
  id: string;
  worldX: number; worldY: number; worldZ: number;
  startedAt: number;
  kind: 'crack-puff' | 'collapse';
}

interface Props {
  worldId: string;
  getCamera: () => CameraSnapshot | null;
}

const COLLAPSE_DURATION_MS = 1500;
const PUFF_DURATION_MS = 600;

export default function BuildingCollapseVFX({ worldId, getCamera }: Props) {
  const [items, setItems] = useState<VFXItem[]>([]);
  const itemsRef = useRef<VFXItem[]>([]);
  itemsRef.current = items;

  const handle = useCallback((e: Event) => {
    const ce = e as CustomEvent<BuildingStateEvent>;
    const ev = ce.detail;
    if (!ev || (ev.worldId && ev.worldId !== worldId)) return;
    const pos = ev.position || { x: 0, y: 0, z: 0 };
    const id = `${ev.buildingId}_${Date.now()}`;
    const kind = ev.toState === 'collapsed' ? 'collapse' : 'crack-puff';
    setItems((prev) => [...prev, {
      id, worldX: pos.x, worldY: pos.y, worldZ: pos.z,
      startedAt: performance.now(), kind,
    }]);
    const ttl = kind === 'collapse' ? COLLAPSE_DURATION_MS + 500 : PUFF_DURATION_MS + 200;
    setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
    }, ttl);
  }, [worldId]);

  useEffect(() => {
    window.addEventListener('concordia:building-state', handle as EventListener);
    return () => window.removeEventListener('concordia:building-state', handle as EventListener);
  }, [handle]);

  // Drive re-render to animate.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (items.length === 0) return;
    let raf: number;
    const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [items.length]);

  const cam = getCamera();
  if (!cam || items.length === 0) return null;
  const now = performance.now();

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 7 }}>
      {items.map((it) => {
        const elapsed = now - it.startedAt;
        const screen = project(it.worldX, it.worldY + 1.5, it.worldZ, cam);
        if (!screen.visible) return null;

        if (it.kind === 'crack-puff') {
          const t = Math.min(1, elapsed / PUFF_DURATION_MS);
          const r = 12 + t * 24;
          return (
            <div key={it.id} style={{
              position: 'absolute',
              left: screen.x - r, top: screen.y - r,
              width: r * 2, height: r * 2,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(160,140,120,0.55), transparent 70%)',
              opacity: 1 - t,
            }} />
          );
        }

        // collapse
        const t = Math.min(1, elapsed / COLLAPSE_DURATION_MS);
        const dustOpacity = t < 0.7 ? Math.min(1, t / 0.7) : Math.max(0, 1 - (t - 0.7) / 0.3);
        const dustR = 30 + t * 80;
        return (
          <React.Fragment key={it.id}>
            {Array.from({ length: 6 }).map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              const r = t * 60;
              const fall = t * t * 80;
              const sx = screen.x + Math.cos(angle) * r;
              const sy = screen.y + Math.sin(angle) * r * 0.4 + fall;
              return (
                <div key={i} style={{
                  position: 'absolute',
                  left: sx - 4, top: sy - 4,
                  width: 8, height: 8, background: '#7a6a5a',
                  transform: `rotate(${i * 60 + t * 180}deg)`,
                  opacity: 1 - t * 0.8,
                }} />
              );
            })}
            <div style={{
              position: 'absolute',
              left: screen.x - dustR, top: screen.y - dustR,
              width: dustR * 2, height: dustR * 2,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(160,140,120,0.6), transparent 70%)',
              opacity: dustOpacity,
            }} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function project(wx: number, wy: number, wz: number, cam: CameraSnapshot) {
  const dx = wx - cam.x, dy = wy - cam.y, dz = wz - cam.z;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  let rx = dx * cy + dz * sy;
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
