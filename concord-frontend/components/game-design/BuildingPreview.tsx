'use client';

/**
 * BuildingPreview — standalone Three.js canvas that renders the EXACT
 * geometry `createBuilding()` (lib/world-lens/procedural-buildings.ts)
 * produces for the current authoring params, using the SAME
 * `scale.set(width/10, height/8, depth/8)` formula the live world applies
 * (BuildingRenderer3D.tsx). This is what makes "preview == in-world" a real
 * guarantee rather than a claim: both call the same pure function with the
 * same options and apply the same post-scale.
 *
 * Deliberately does NOT accept a color override — Increment 1 defers
 * factionStyle color to a fast-follow (see docs/lens-specs Asset Studio
 * contract), so this preview uses the archetype's own default palette,
 * same as an in-world building with no faction visual.
 *
 * Honesty notes:
 *  - No `archetype` selected yet -> explicit empty state, never a
 *    placeholder building.
 *  - WebGL unavailable (headless test environments, some browsers) ->
 *    explicit fallback text, never a silently blank canvas.
 *  - The only intentional approximation: the real in-world building is
 *    seeded with its eventual DTU id (so its procedural micro-jitter —
 *    exact door/window offsets — is stable forever); this preview can't
 *    know that id before publish, so it seeds off the archetype instead.
 *    Archetype, feature, dimensions, and palette all match exactly; only
 *    sub-meter jitter may differ slightly from the published building.
 *  - Auto-rotation is driven by THREE.Clock (elapsed wall time), never
 *    Math.random() — there is no randomness anywhere in this render path.
 */

import { useEffect, useRef, useState } from 'react';
import type { Group, PerspectiveCamera as PerspectiveCameraT, Scene as SceneT, WebGLRenderer as WebGLRendererT } from 'three';
import { Box, Loader2, AlertTriangle } from 'lucide-react';
import type { BuildingArchetype, IconicFeature } from '@/lib/world-lens/procedural-buildings';

export interface BuildingPreviewProps {
  archetype: BuildingArchetype | null;
  feature: IconicFeature | null;
  /** Meters. Non-positive/non-finite values fall back to the honest empty state. */
  widthM: number;
  heightM: number;
  depthM: number;
  /**
   * Stable per-draft seed. NOT regenerated per render/frame — pass a value
   * that only changes when the caller wants a different generated shape
   * (e.g. a draft id). Defaults to a deterministic string built from the
   * archetype so the preview never depends on Math.random().
   */
  seed?: string;
  className?: string;
}

/**
 * Mirrors `archStyleByArch` in BuildingRenderer3D.tsx — the default
 * architecture_style every in-world archetype building gets when it has no
 * custom faction visual. Reproduced here (not imported — BuildingRenderer3D
 * doesn't export it) so the preview's silhouette bias (wall height, parapet/
 * column chance) matches in-world exactly, not just its wall/roof color.
 */
const ARCH_STYLE_BY_ARCHETYPE: Record<
  BuildingArchetype,
  'fortified' | 'gracile' | 'crystalline' | 'organic' | 'industrial'
> = {
  tavern: 'organic',
  archive: 'gracile',
  forge: 'fortified',
  market: 'gracile',
  tower: 'fortified',
};

/**
 * Frees per-building geometry only. Materials come from procedural-buildings'
 * module-level `materialCache` (keyed by slot/color/pbrSeed) which is SHARED
 * across every building the app renders (including the live world, if it's
 * mounted in the same tab). Disposing a cached material here would silently
 * break any other consumer still holding a reference to it. Module-level
 * material disposal is `disposeBuildingArchetype()` in procedural-buildings.ts,
 * intended for a full world unmount — never call it from a single preview.
 */
function disposeGroupGeometries(group: Group): void {
  group.traverse((obj) => {
    const maybeMesh = obj as unknown as { isMesh?: boolean; geometry?: { dispose?: () => void } };
    if (maybeMesh.isMesh && maybeMesh.geometry?.dispose) {
      try { maybeMesh.geometry.dispose(); } catch { /* best-effort */ }
    }
  });
}

export function BuildingPreview({
  archetype, feature, widthM, heightM, depthM, seed, className,
}: BuildingPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const safeW = Number.isFinite(widthM) && widthM > 0 ? widthM : 0;
  const safeH = Number.isFinite(heightM) && heightM > 0 ? heightM : 0;
  const safeD = Number.isFinite(depthM) && depthM > 0 ? depthM : 0;
  const hasValidDims = safeW > 0 && safeH > 0 && safeD > 0;

  useEffect(() => {
    setReady(false);
    setPreviewError(null);
    if (!archetype || !hasValidDims) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let disposed = false;
    let rafId: number | null = null;
    let renderer: WebGLRendererT | null = null;
    let buildingGroup: Group | null = null;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      try {
        const THREE = await import('three');
        const { createBuilding } = await import('@/lib/world-lens/procedural-buildings');
        if (disposed) return;

        const width = Math.max(1, container.clientWidth || 320);
        const height = Math.max(1, container.clientHeight || 256);

        const scene: SceneT = new THREE.Scene();
        scene.background = new THREE.Color('#0b0b12');

        const camera: PerspectiveCameraT = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);

        const rig = new THREE.Group();
        scene.add(rig);

        const ambient = new THREE.AmbientLight(0x8080a0, 0.75);
        const key = new THREE.DirectionalLight(0xffffff, 1.15);
        key.position.set(6, 10, 6);
        const rim = new THREE.DirectionalLight(0x6699ff, 0.4);
        rim.position.set(-6, 4, -4);
        scene.add(ambient, key, rim);

        const grid = new THREE.GridHelper(60, 30, 0x2a2a3a, 0x1a1a24);
        scene.add(grid);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
        renderer.setSize(width, height, false);
        try { renderer.outputColorSpace = THREE.SRGBColorSpace; } catch { /* older three fallback */ }

        // Mirror BuildingRenderer3D's default (no faction visual) options
        // exactly, EXCEPT withInterior is always forced false for a preview
        // (interior decor is an in-world zoom feature, not an exterior review).
        buildingGroup = createBuilding(THREE, {
          archetype,
          seed: seed || `asset-studio-preview:${archetype}`,
          feature: feature ?? undefined,
          withInterior: false,
          factionStyle: { architecture_style: ARCH_STYLE_BY_ARCHETYPE[archetype] },
        });
        // The SAME scale formula the live world applies to an authored
        // building (BuildingRenderer3D.tsx) — this is what makes the
        // preview WYSIWYG rather than a guess.
        buildingGroup.scale.set(safeW / 10, safeH / 8, safeD / 8);
        rig.add(buildingGroup);

        // Frame the camera from the real (scaled) bounding box so wildly
        // different dimensions always fit the frame — computed from actual
        // geometry, not a fixed guess.
        const box = new THREE.Box3().setFromObject(buildingGroup);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(1, size.length() / 2);
        camera.position.set(center.x + radius * 1.3, center.y + radius * 0.85, center.z + radius * 1.3);
        camera.lookAt(center);

        const clock = new THREE.Clock();
        const tick = () => {
          if (disposed || !renderer) return;
          const dt = clock.getDelta();
          // Deterministic time-based auto-orbit — never Math.random().
          rig.rotation.y += dt * 0.35;
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
      if (buildingGroup) disposeGroupGeometries(buildingGroup);
      if (renderer) {
        try { renderer.forceContextLoss?.(); } catch { /* best-effort */ }
        try { renderer.dispose(); } catch { /* best-effort */ }
      }
    };
  }, [archetype, feature, seed, safeW, safeH, safeD, hasValidDims]);

  if (!archetype || !hasValidDims) {
    return (
      <div className={className}>
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-zinc-500 border border-dashed border-zinc-700 rounded-xl bg-zinc-950/40">
          <Box className="w-7 h-7" />
          <p className="text-[11px] italic px-4 text-center">
            {!archetype
              ? 'Pick an archetype to preview the building.'
              : 'Enter a positive width, height, and depth to preview the building.'}
          </p>
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
        <div className="absolute bottom-1.5 left-2 text-[10px] font-mono text-zinc-300 bg-black/60 rounded px-1.5 py-0.5 capitalize">
          {archetype}{feature ? ` · ${feature}` : ''} · {safeW.toFixed(1)}×{safeH.toFixed(1)}×{safeD.toFixed(1)}m
        </div>
        <div className="absolute top-1.5 right-2 text-[9px] uppercase tracking-wide text-zinc-500 bg-black/50 rounded px-1.5 py-0.5">
          live preview
        </div>
      </div>
    </div>
  );
}

export default BuildingPreview;
