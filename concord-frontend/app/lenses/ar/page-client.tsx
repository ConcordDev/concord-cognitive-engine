'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // AR STUDIO — Wave 2 rebuild (Frontend Rebuild Program,
 * docs/FRONTEND_REBUILD_PROGRAM.md)
 * ─────────────────────────────────────────────────────────────────────────
 * Reference-parity target: Adobe Aero / 8th Wall Studio-class WebXR AR
 * scene authoring (see docs/lens-specs/ar-capability-map.md step-1.5
 * checklist). This lens is a genuine augmented-reality FEATURE-AUTHORING
 * tool (scenes, spatial anchors, 3D model placement, WebXR sessions,
 * marker/image targets) — not Concord's in-game world (that's the
 * separate "Concordia" / world lens).
 *
 * Honest-by-construction — every surface traces to a real macro:
 *   • Scene Studio         → ar.sceneSave/sceneList/sceneGet/sceneDelete,
 *                            ar.behaviorValidate, ar.animationTimeline,
 *                            ar.imageTargetCompile/imageTargetList,
 *                            ar.publishScene, ar.webxrPreview (all
 *                            DB-backed via migration 332 ar_scenes/
 *                            ar_image_targets/ar_publishes) — was ALREADY
 *                            real and complete (components/ar/SceneStudio.tsx,
 *                            904 LOC); untouched here beyond re-mounting.
 *   • Spatial Diagnostics  → ar.spatialMapping / ar.markerDetection /
 *                            ar.sceneGraph — three pure-compute macros with
 *                            ZERO frontend callers before this rebuild
 *                            (confirmed by grep). Now a real workbench.
 *   • Asset Library        → a real "My Models" catalog (generic
 *                            lens-artifact CRUD, Model3D type only) +
 *                            live Sketchfab search (components/ar/
 *                            SketchfabModels.tsx, real api.sketchfab.com
 *                            v3 call, no key) — was ALREADY real, kept.
 *   • AR Preview viewport   → ar.render (deterministic drawList + WebXR
 *                            session plan) driving a real Three.js
 *                            viewport, with an honest `navigator.xr
 *                            .isSessionSupported('immersive-ar')`
 *                            feature-detect gate before offering
 *                            immersive-ar — was already real, kept as-is.
 *
 * RESOLVED the SceneStudio-vs-generic-CRUD duplication flagged in the
 * rebuild brief: the old page's "Scenes" tab was a flat, disconnected
 * generic-artifact CRUD (useLensData('ar','Scene')) with NO relationship to
 * SceneStudio's real ar_scenes-backed authoring model (objects + behaviors
 * + audio + settings) — a strictly worse duplicate. RETIRED. The old
 * "Layers"/"Configs" tabs carried fields (`dtuDensity`, disconnected
 * `trackingMode`/`renderQuality`/`resolution`/`fps`) that no macro
 * anywhere reads — sliders that went nowhere, a real instance of the
 * "control presented as functional but wired to nothing" pattern this
 * program's audits were built to catch. RETIRED. "Anchors" is now a real
 * workbench input inside Spatial Diagnostics instead of a disconnected
 * catalog record. "Captures" had no backing capture pipeline (no macro,
 * no getUserMedia code anywhere) — honestly scoped as a future build
 * rather than shipped as an empty-looking feature; see the capability map.
 * "3D Models" survives, narrowed to real self-reported asset metadata,
 * folded into the new Asset Library tab alongside the (already-real)
 * Sketchfab search.
 *
 * RETIRED the entire generated-scaffold surface: ManifestActionBar,
 * AutoActionStrip, RecentMineCard, CrossLensRecentsPanel, LensVerticalHero,
 * UniversalActions, LensFeaturePanel. Also dropped the dead
 * `useRealtimeLens('ar')` panel/live-indicator — `ar` has no registered
 * realtime socket channel (`DOMAIN_EVENTS` in useRealtimeLens.ts has no
 * `ar` entry and the server never emits `ar:update`), so `isLive` was
 * permanently false and `realtimeData` permanently null — the same
 * dead-panel anti-pattern already fixed in the `history` lens rebuild.
 *
 * Full capability map + reference-parity checklist:
 * docs/lens-specs/ar-capability-map.md
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Glasses, Camera, Boxes, ScanEye, Library, X } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { DensityToggle, StatTile, StatTileGrid } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { SceneStudio } from '@/components/ar/SceneStudio';
import { SpatialDiagnostics } from '@/components/ar/SpatialDiagnostics';
import { AssetLibrary, type ArRenderPlan } from '@/components/ar/AssetLibrary';

type Tab = 'studio' | 'diagnostics' | 'library';

const TABS: { id: Tab; label: string; hotkey: string; icon: typeof Boxes; description: string }[] = [
  { id: 'studio', label: 'Scene Studio', hotkey: '1', icon: Boxes, description: 'Author objects, behaviors, animation, image targets, and publish AR scenes' },
  { id: 'diagnostics', label: 'Spatial Diagnostics', hotkey: '2', icon: ScanEye, description: 'Analyze spatial anchors, fiducial markers, and scene-graph hierarchies' },
  { id: 'library', label: 'Asset Library', hotkey: '3', icon: Library, description: 'Catalog reference models and search Sketchfab' },
];

export default function ARLensPage() {
  useLensNav('ar');

  const [tab, setTab] = useState<Tab>('studio');
  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.hotkey,
      description: t.label,
      category: 'navigation' as const,
      action: () => setTab(t.id),
    })),
    { lensId: 'ar' },
  );

  // Real, cheap header counts — deduped with AssetLibrary's own useLensData
  // call by react-query's shared cache (same queryKey), so this costs no
  // extra network round-trip beyond what the Asset Library tab already
  // fetches when mounted.
  const { items: models } = useLensData('ar', 'Model3D', { seed: [] });
  const [sceneCount, setSceneCount] = useState<number | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const refreshCounts = useCallback(() => {
    lensRun('ar', 'sceneList', {}).then((r) => {
      if (r.data?.ok) setSceneCount((r.data.result as { count?: number } | null)?.count ?? 0);
    }).catch((e) => console.warn('[ar] scene list load failed:', e));
    lensRun('ar', 'imageTargetList', {}).then((r) => {
      if (r.data?.ok) setTargetCount((r.data.result as { count?: number } | null)?.count ?? 0);
    }).catch((e) => console.warn('[ar] target list load failed:', e));
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  const switchTab = useCallback((next: Tab) => {
    setTab((prev) => {
      if (prev !== next) refreshCounts();
      return next;
    });
  }, [refreshCounts]);

  // ── Live AR preview viewport (Three.js) ──────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [arEnabled, setArEnabled] = useState(false);
  const [renderPlan, setRenderPlan] = useState<ArRenderPlan | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [arSupported, setArSupported] = useState(false);
  const renderPlanRef = useRef<ArRenderPlan | null>(null);
  renderPlanRef.current = renderPlan;

  // Feature-detect immersive-ar once (WebXR needs a secure context; defaults to `self`).
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported('immersive-ar').then((ok) => setArSupported(!!ok)).catch(() => setArSupported(false));
  }, []);

  useEffect(() => {
    if (!arEnabled || !viewportRef.current) return;

    const container = viewportRef.current;
    let disposed = false;

    interface RenderDrawItem { id?: string; kind?: string; model?: string | null; transform?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; scale?: number }; opacity?: number; color?: string }

    const initThree = async () => {
      const THREE = await import('three');
      if (disposed || !container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d0d14);

      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
      camera.position.set(0, 1.5, 4);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const ambient = new THREE.AmbientLight(0x404060, 0.6);
      scene.add(ambient);
      const dirLight = new THREE.DirectionalLight(0xa855f7, 1.2);
      dirLight.position.set(3, 5, 4);
      scene.add(dirLight);
      const fillLight = new THREE.DirectionalLight(0x00d4ff, 0.4);
      fillLight.position.set(-3, 2, -2);
      scene.add(fillLight);

      // Renderables: when ar.render produced a drawList, render those real
      // objects; otherwise show an idle demo torus-knot — a decorative
      // "nothing previewed yet" visual, never mistakable for real scene
      // content (no data/labels attached to it).
      const disposables: { dispose: () => void }[] = [];
      const spin: { obj: { rotation: { x: number; y: number } }; sx: number; sy: number }[] = [];
      const plan = renderPlanRef.current;
      const drawList = Array.isArray(plan?.drawList) ? (plan!.drawList as RenderDrawItem[]) : [];
      if (drawList.length > 0) {
        for (const d of drawList) {
          const isSphere = typeof d.model === 'string' && /sphere/i.test(d.model);
          const geo = isSphere ? new THREE.SphereGeometry(0.5, 32, 24) : new THREE.BoxGeometry(0.9, 0.9, 0.9);
          let color = 0xa855f7;
          try { color = new THREE.Color(d.color || '#a855f7').getHex(); } catch { /* default */ }
          const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, transparent: (d.opacity ?? 1) < 1, opacity: d.opacity ?? 1 });
          const mesh = new THREE.Mesh(geo, mat);
          const p = d.transform?.position; if (p) mesh.position.set(p.x || 0, p.y || 0, p.z || 0);
          const rot = d.transform?.rotation; if (rot) mesh.rotation.set((rot.x || 0) * Math.PI / 180, (rot.y || 0) * Math.PI / 180, (rot.z || 0) * Math.PI / 180);
          const s = d.transform?.scale; if (s) mesh.scale.setScalar(s);
          scene.add(mesh);
          disposables.push(geo, mat);
          spin.push({ obj: mesh, sx: 0.1, sy: 0.2 });
        }
      } else {
        const geometry = new THREE.TorusKnotGeometry(1, 0.35, 128, 32);
        const material = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x4a1a8a, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.25 });
        const torusKnot = new THREE.Mesh(geometry, material);
        scene.add(torusKnot);
        disposables.push(geometry, material);
        spin.push({ obj: torusKnot, sx: 0.3, sy: 0.5 });
      }

      const gridHelper = new THREE.GridHelper(10, 20, 0x2a2a3a, 0x1a1a24);
      gridHelper.position.y = -1.5;
      scene.add(gridHelper);

      const sphereGeo = new THREE.IcosahedronGeometry(3, 1);
      const wireframeMat = new THREE.MeshBasicMaterial({ color: 0x00fff7, wireframe: true, transparent: true, opacity: 0.06 });
      const wireSphere = new THREE.Mesh(sphereGeo, wireframeMat);
      scene.add(wireSphere);

      let mouseX = 0;
      let mouseY = 0;
      const onPointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      container.addEventListener('pointermove', onPointerMove);

      const clock = new THREE.Clock();
      const animate = () => {
        if (disposed) return;
        animFrameRef.current = requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();
        for (const s of spin) { s.obj.rotation.x = elapsed * s.sx; s.obj.rotation.y = elapsed * s.sy; }
        wireSphere.rotation.y = elapsed * 0.1;
        wireSphere.rotation.x = elapsed * 0.05;
        camera.position.x = 4 * Math.sin(elapsed * 0.2) + mouseX * 1.5;
        camera.position.y = 1.5 + mouseY * -0.8;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        if (disposed || !container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (container as any).__threeCleanup = () => {
        disposed = true;
        cancelAnimationFrame(animFrameRef.current);
        container.removeEventListener('pointermove', onPointerMove);
        resizeObserver.disconnect();
        for (const d of disposables) d.dispose();
        sphereGeo.dispose();
        wireframeMat.dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      };
    };

    initThree();
    return () => {
      const cleanup = (container as unknown as Record<string, unknown>).__threeCleanup as (() => void) | undefined;
      if (cleanup) cleanup();
    };
  }, [arEnabled, renderPlan]);

  const enterAR = useCallback(async () => {
    const plan = renderPlan;
    const xr = (navigator as Navigator & { xr?: { requestSession?: (m: string, o?: Record<string, unknown>) => Promise<unknown> } }).xr;
    if (!plan || !xr?.requestSession) return;
    try {
      const THREE = await import('three');
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: (plan.requiredFeatures as string[]) || ['local-floor'],
        optionalFeatures: ['dom-overlay'],
      }) as unknown;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { xrCompatible: true }) as WebGLRenderingContext;
      const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
      renderer.xr.enabled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await renderer.xr.setSession(session as any);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      for (const d of (plan.drawList as { color?: string; transform?: { position?: { x: number; y: number; z: number } } }[]) || []) {
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        let color = 0xa855f7; try { color = new THREE.Color(d.color || '#a855f7').getHex(); } catch { /* default */ }
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
        const p = d.transform?.position; if (p) mesh.position.set(p.x || 0, p.y || 0, (p.z || 0) - 1);
        scene.add(mesh);
      }
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1));
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).addEventListener?.('end', () => renderer.setAnimationLoop(null));
    } catch (err) { console.error('Enter AR failed:', err); }
  }, [renderPlan]);

  const handlePreview = useCallback((plan: ArRenderPlan, title: string) => {
    setRenderPlan(plan);
    setPreviewTitle(title);
    setArEnabled(true);
  }, []);

  return (
    <LensShell lensId="ar" asMain={false}>
      <FirstRunTour lensId="ar" />
      <div data-lens-theme="ar" className="p-6 space-y-5">
        {/* Header */}
        <header className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0">
              <Glasses className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                AR
                <DepthBadge lensId="ar" size="sm" />
              </h1>
              <p className="text-sm text-gray-400">
                WebXR augmented-reality scene authoring — spatial anchors, 3D placement, behaviors, and publish-to-phone.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <DensityToggle variant="dropdown" />
              <DTUExportButton domain="ar" data={{ scenes: sceneCount, models: models.length, imageTargets: targetCount }} compact />
              <button
                onClick={() => setArEnabled((v) => !v)}
                className={cn(arEnabled ? ds.btnPrimary : ds.btnSecondary)}
              >
                {arEnabled ? <><Camera className="w-4 h-4" /> Stop preview</> : <><Glasses className="w-4 h-4" /> Start preview</>}
              </button>
            </div>
          </div>

          <StatTileGrid columns={4}>
            <StatTile label="Scenes authored" value={sceneCount ?? '—'} icon={<Boxes className="w-4 h-4" />} />
            <StatTile label="Image targets" value={targetCount ?? '—'} icon={<ScanEye className="w-4 h-4" />} />
            <StatTile label="Cataloged models" value={models.length} icon={<Library className="w-4 h-4" />} />
            <StatTile label="Immersive-AR" value={arSupported ? 'Supported' : 'Screen-only'} caption={arSupported ? 'ARCore/ARKit detected' : 'no XR device — inline preview'} />
          </StatTileGrid>

          {/* AR preview viewport — driven by ar.render, either from a Model3D
              catalog preview (Asset Library) or a published scene link opened
              on-device. Not a scene editor viewport (SceneStudio has its own). */}
          {arEnabled && (
            <div className={ds.panel}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">{previewTitle ? `Previewing: ${previewTitle}` : 'AR preview'}</span>
                {previewTitle && (
                  <button onClick={() => { setRenderPlan(null); setPreviewTitle(null); }} className={ds.btnGhost} aria-label="Clear preview">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="h-64 relative overflow-hidden rounded-lg bg-lattice-deep">
                <div ref={viewportRef} className="w-full h-full" />
              </div>
              <div className="flex items-center gap-2 mt-2 px-1 flex-wrap">
                <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                <span className="text-xs text-neon-cyan">{renderPlan ? '3D viewport active' : 'Idle viewport — select "Preview in AR" on a model, or publish a scene'}</span>
                {renderPlan && <span className="text-xs text-gray-400">· {renderPlan.objectCount ?? (renderPlan.drawList as unknown[] | undefined)?.length ?? 0} object(s)</span>}
                {renderPlan && (
                  arSupported ? (
                    <button onClick={() => void enterAR()} className={cn(ds.btnPrimary, ds.btnSmall, 'ml-auto')}>
                      <Glasses className="w-3.5 h-3.5" /> Enter AR
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500 ml-auto" title="immersive-ar requires an AR-capable device (ARCore/ARKit) over HTTPS">Inline preview · immersive-ar unavailable on this device</span>
                  )
                )}
                {!renderPlan && <span className="text-xs text-gray-400 ml-auto">Move pointer to orbit</span>}
              </div>
            </div>
          )}
        </header>

        {/* Workspace nav */}
        <nav className="flex gap-1 flex-wrap border-b border-lattice-border pb-0" aria-label="AR workspace sections">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                title={t.description}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors',
                  active ? 'border-neon-purple text-neon-purple bg-neon-purple/5' : 'border-transparent text-gray-400 hover:text-white hover:bg-lattice-surface/50',
                )}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
                <kbd className="ml-1 hidden sm:inline text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-500 font-mono">{t.hotkey}</kbd>
              </button>
            );
          })}
        </nav>

        {/* Workspace body */}
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'studio' && (
            <section className="rounded-xl border border-lattice-border bg-zinc-950/40 p-4">
              <SceneStudio />
            </section>
          )}
          {tab === 'diagnostics' && (
            <section className="rounded-xl border border-lattice-border bg-zinc-950/40 p-4">
              <SpatialDiagnostics />
            </section>
          )}
          {tab === 'library' && <AssetLibrary onPreview={handlePreview} />}
        </div>
      </div>
    </LensShell>
  );
}
