'use client';

// concord-frontend/components/conkay/ConKayArtifactExploded.tsx
//
// ConKay Phase 3 — the "exploded view" of a REAL artifact. It loads an actual
// AR scene through the `ar.render` macro (the same render descriptor the AR
// lens uses) and separates its genuine sub-objects along their direction from
// the assembly's center of mass, animated with gsap. Click a part to inspect
// it. Honest-by-construction: the parts ARE the artifact's real objects (id /
// kind / color / authored position) — nothing is invented. When no real
// artifact is available it renders an explicit empty state, not a mock.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { lensRun } from '@/lib/api/client';

type Vec3 = [number, number, number];

interface DrawPart {
  id?: string;
  kind?: string;
  color?: string;
  transform?: { position?: { x?: number; y?: number; z?: number }; scale?: number | { x?: number } };
}

export interface ExplodedPart {
  id: string;
  kind: string;
  color: string;
  from: Vec3;
  to: Vec3;
  scale: number;
}

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * PURE — compute the exploded layout from a real `ar.render` drawList. Each
 * part's `from` is its authored position; `to` pushes it outward from the
 * assembly's center of mass by `factor`. Parts coincident with the center fan
 * out deterministically by index so nothing stays stacked. Exported for tests.
 */
export function computeExplodedLayout(drawList: DrawPart[], factor = 1.8): ExplodedPart[] {
  const parts = (Array.isArray(drawList) ? drawList : []).map((d, i) => {
    const p = d?.transform?.position || {};
    const s = d?.transform?.scale;
    const scale = typeof s === 'number' ? s : num((s as { x?: number })?.x, 1);
    return {
      id: String(d?.id ?? `part_${i}`),
      kind: String(d?.kind ?? 'object'),
      color: String(d?.color ?? '#a855f7'),
      pos: [num(p.x), num(p.y), num(p.z)] as Vec3,
      scale: scale || 1,
    };
  });
  if (!parts.length) return [];
  const center = parts.reduce(
    (acc, p) => [acc[0] + p.pos[0], acc[1] + p.pos[1], acc[2] + p.pos[2]] as Vec3,
    [0, 0, 0] as Vec3,
  ).map((v) => v / parts.length) as Vec3;

  return parts.map((p, i) => {
    let dir = [p.pos[0] - center[0], p.pos[1] - center[1], p.pos[2] - center[2]] as Vec3;
    let len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-4) {
      // Coincident with the centroid — fan out around a ring by index.
      const a = (i / parts.length) * Math.PI * 2;
      dir = [Math.cos(a), 0.15 * (i % 3), Math.sin(a)];
      len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    }
    const u: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    return {
      id: p.id,
      kind: p.kind,
      color: p.color,
      from: p.pos,
      to: [center[0] + u[0] * factor, center[1] + u[1] * factor, center[2] + u[2] * factor],
      scale: p.scale,
    };
  });
}

function PartMesh({ part, exploded, onPick, selected }: {
  part: ExplodedPart;
  exploded: boolean;
  onPick: (id: string) => void;
  selected: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const target = exploded ? part.to : part.from;
    const tween = gsap.to(ref.current.position, {
      x: target[0], y: target[1], z: target[2],
      duration: 0.9, ease: 'power3.inOut',
    });
    return () => { tween.kill(); };
  }, [exploded, part.from, part.to]);

  return (
    <mesh
      ref={ref}
      position={part.from}
      scale={part.scale}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(part.id); }}
    >
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial
        color={part.color}
        emissive={selected ? new THREE.Color(part.color) : new THREE.Color('#000000')}
        emissiveIntensity={selected ? 0.6 : 0}
        metalness={0.2}
        roughness={0.4}
        transparent
        opacity={0.92}
      />
    </mesh>
  );
}

export function ConKayArtifactExploded({ sceneId, objects, drawList, className }: {
  sceneId?: string;
  objects?: unknown[];
  /** Pre-resolved render descriptor (e.g. tests) — skips the macro fetch. */
  drawList?: DrawPart[];
  className?: string;
}) {
  const [parts, setParts] = useState<ExplodedPart[]>(() => (drawList ? computeExplodedLayout(drawList) : []));
  const [exploded, setExploded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('AR artifact');
  const [loading, setLoading] = useState(!drawList);

  useEffect(() => {
    if (drawList) return; // explicit descriptor — nothing to fetch
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Resolve a real artifact: an explicit scene/objects, else the user's
        // most-recent scene. ar.render returns the genuine part drawList.
        let input: Record<string, unknown> = {};
        if (sceneId) input = { sceneId };
        else if (Array.isArray(objects) && objects.length) input = { objects };
        else {
          const listed = await lensRun<{ scenes?: { id: string }[] }>('ar', 'sceneList', {});
          const first = listed?.data?.result?.scenes?.[0]?.id;
          if (first) input = { sceneId: first };
        }
        const r = await lensRun<{ drawList?: DrawPart[]; title?: string }>('ar', 'render', input);
        if (cancelled) return;
        const dl = r?.data?.result?.drawList || [];
        setParts(computeExplodedLayout(dl));
        if (r?.data?.result?.title) setTitle(String(r.data.result.title));
      } catch {
        if (!cancelled) setParts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sceneId, objects, drawList]);

  const selectedPart = useMemo(() => parts.find((p) => p.id === selected) || null, [parts, selected]);

  return (
    <div className={className}>
      <div className="pointer-events-auto absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-cyan-400/30 bg-black/60 px-3 py-1.5 text-[12px] text-cyan-100 backdrop-blur">
        <span className="font-medium">{title}</span>
        <span className="text-cyan-300/70">{parts.length} parts</span>
        <button
          onClick={() => setExploded((v) => !v)}
          disabled={!parts.length}
          className="rounded-full border border-cyan-400/40 px-2 py-0.5 text-cyan-100 transition hover:bg-cyan-500/20 disabled:opacity-40"
        >
          {exploded ? 'Collapse' : 'Explode'}
        </button>
      </div>

      {selectedPart && (
        <div className="pointer-events-auto absolute right-4 top-16 z-10 w-56 rounded-xl border border-cyan-400/20 bg-black/70 p-3 text-[12px] text-cyan-100 backdrop-blur">
          <div className="mb-1 font-medium">Part: {selectedPart.id}</div>
          <div className="text-cyan-300/80">kind: {selectedPart.kind}</div>
          <div className="text-cyan-300/80">color: {selectedPart.color}</div>
          <button onClick={() => setSelected(null)} className="mt-2 text-cyan-400 hover:underline">close</button>
        </div>
      )}

      <Canvas
        camera={{ position: [3.5, 2.5, 4.5], fov: 55 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
        onPointerMissed={() => setSelected(null)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 6, 3]} intensity={0.8} />
        {parts.map((p) => (
          <PartMesh key={p.id} part={p} exploded={exploded} onPick={setSelected} selected={selected === p.id} />
        ))}
        <OrbitControls enablePan={false} />
      </Canvas>

      {!loading && !parts.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-cyan-300/60">
          No AR artifact to inspect — author a scene in the AR lens first.
        </div>
      )}
    </div>
  );
}

export default ConKayArtifactExploded;
