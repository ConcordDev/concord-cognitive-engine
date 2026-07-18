'use client';

/**
 * CreaturePreview — standalone Three.js canvas that renders the EXACT
 * mesh `createCreatureMesh()` (lib/world-lens/creature-mesh-builder.ts)
 * produces for the current authoring params, and drives its per-frame
 * `tick(dt)` gait. This is the SAME pure builder the live world's
 * CreatureSystem calls to render every simulated creature, so
 * "preview == in-world" is a real guarantee, not a claim: both call the
 * same function with the same { topology, coatColor, variant } and get a
 * byte-identical silhouette + gait.
 *
 * Honesty notes:
 *  - No `topology` selected -> explicit empty state, never a placeholder
 *    creature.
 *  - WebGL unavailable (headless test environments, some browsers) ->
 *    explicit fallback text, never a silently blank canvas.
 *  - Auto-rotation and the gait tick are driven by THREE.Clock (elapsed
 *    wall time), never Math.random() — there is no randomness anywhere in
 *    this render path. (The mesh builder's own internal Math.cos/sin gait
 *    is a deterministic function of elapsed time, not RNG.)
 */

import { useEffect, useRef, useState } from 'react';
import type {
  Group,
  PerspectiveCamera as PerspectiveCameraT,
  Scene as SceneT,
  WebGLRenderer as WebGLRendererT,
} from 'three';
import { Rabbit, Loader2, AlertTriangle } from 'lucide-react';
import type { CreatureTopology } from '@/lib/world-lens/creature-mesh-builder';

export interface CreaturePreviewProps {
  topology: CreatureTopology | null;
  /** Hex coat colour — the same value the live creature is tinted with. */
  coatColor: string;
  /** Optional bred/reacted variant label — drives the faint emissive glow. */
  variant?: string | null;
  className?: string;
}

export function CreaturePreview({ topology, coatColor, variant, className }: CreaturePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setReady(false);
    setPreviewError(null);
    if (!topology) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let disposed = false;
    let rafId: number | null = null;
    let renderer: WebGLRendererT | null = null;
    let resizeObs: ResizeObserver | null = null;
    let creatureMesh: { group: Group; tick: (dt: number, speed?: number) => void; dispose: () => void } | null = null;

    (async () => {
      try {
        const THREE = await import('three');
        const { createCreatureMesh } = await import('@/lib/world-lens/creature-mesh-builder');
        if (disposed) return;

        const width = Math.max(1, container.clientWidth || 320);
        const height = Math.max(1, container.clientHeight || 256);

        const scene: SceneT = new THREE.Scene();
        scene.background = new THREE.Color('#0b0b12');

        const camera: PerspectiveCameraT = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);

        const rig = new THREE.Group();
        scene.add(rig);

        const ambient = new THREE.AmbientLight(0x8080a0, 0.8);
        const key = new THREE.DirectionalLight(0xffffff, 1.15);
        key.position.set(4, 8, 5);
        const rim = new THREE.DirectionalLight(0x6699ff, 0.4);
        rim.position.set(-5, 3, -4);
        scene.add(ambient, key, rim);

        const grid = new THREE.GridHelper(20, 20, 0x2a2a3a, 0x1a1a24);
        scene.add(grid);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
        renderer.setSize(width, height, false);
        try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch { /* older three fallback */ }

        // The SAME pure builder the live world's CreatureSystem uses — this
        // is what makes the preview WYSIWYG rather than a guess.
        creatureMesh = createCreatureMesh(THREE, {
          topology,
          coatColor,
          variant: variant ?? null,
        });
        rig.add(creatureMesh.group);

        // Frame the camera from the real bounding box so every topology
        // (a tall serpentine vs. a squat blob) always fits the frame.
        const box = new THREE.Box3().setFromObject(creatureMesh.group);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(1, size.length() / 2);
        camera.position.set(center.x + radius * 1.4, center.y + radius * 0.9, center.z + radius * 1.6);
        camera.lookAt(center);

        const clock = new THREE.Clock();
        const tick = () => {
          if (disposed || !renderer || !creatureMesh) return;
          const dt = clock.getDelta();
          // Drive the mesh's own gait tick (deterministic, time-based) and
          // a slow auto-orbit — never Math.random().
          creatureMesh.tick(dt);
          rig.rotation.y += dt * 0.4;
          renderer.render(scene, camera);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        if (typeof ResizeObserver !== 'undefined') {
          resizeObs = new ResizeObserver(() => {
            if (disposed || !renderer || !container) return;
            const w = Math.max(1, container.clientWidth || width);
            const h = Math.max(1, container.clientHeight || height);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
          });
          resizeObs.observe(container);
        }

        if (!disposed) setReady(true);
      } catch (e) {
        // Honest fallback — no fabricated/placeholder render. Most common
        // real cause: WebGL unavailable (headless browser, some devices).
        if (!disposed) {
          setPreviewError(e instanceof Error ? e.message : '3D preview unavailable in this environment.');
        }
      }
    })();

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObs?.disconnect();
      if (creatureMesh) {
        try { creatureMesh.dispose(); } catch { /* best-effort */ }
      }
      if (renderer) {
        try { renderer.forceContextLoss?.(); } catch { /* best-effort */ }
        try { renderer.dispose(); } catch { /* best-effort */ }
      }
    };
  }, [topology, coatColor, variant]);

  if (!topology) {
    return (
      <div className={className}>
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-zinc-500 border border-dashed border-zinc-700 rounded-xl bg-zinc-950/40">
          <Rabbit className="w-7 h-7" />
          <p className="text-[11px] italic px-4 text-center">Pick a topology to preview the creature.</p>
        </div>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className={className}>
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-amber-400/80 border border-dashed border-amber-900/50 rounded-xl bg-zinc-950/40 px-4 text-center">
          <AlertTriangle className="w-6 h-6" />
          <p className="text-[11px]">3D preview unavailable in this environment.</p>
          <p className="text-[10px] text-zinc-500">{previewError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div ref={containerRef} className="relative h-64 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        <div className="absolute bottom-1.5 left-2 text-[10px] font-mono text-zinc-300 bg-black/60 rounded px-1.5 py-0.5">
          {topology.replace(/_/g, ' ')}{variant ? ` · ${variant}` : ''}
        </div>
        <div className="absolute top-1.5 right-2 text-[9px] uppercase tracking-wide text-zinc-500 bg-black/50 rounded px-1.5 py-0.5">
          live preview
        </div>
      </div>
    </div>
  );
}

export default CreaturePreview;
