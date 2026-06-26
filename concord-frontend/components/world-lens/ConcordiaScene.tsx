'use client';

import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from 'react';
import { Activity, Monitor, Settings } from 'lucide-react';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';
import { getStoredSensitivity } from '@/lib/world-lens/quality-preset';
import { decideVisible } from '@/lib/world-lens/cull';
import { mountPerfMonitor, attachRenderer as attachPerfRenderer, tickPerfMonitor } from '@/lib/world-lens/perf-monitor';
import { createTraumaShake, type TraumaShake } from '@/lib/concordia/screen-trauma';

// Track 1 — camera shake is the shared trauma engine (`lib/concordia/screen-trauma.ts`,
// the Eiserloh GDC model): trauma accumulates per event, decays linearly, and the
// per-frame offset is trauma² × COHERENT Simplex noise (smooth, deterministic,
// slow-mo-safe). This is the SINGLE trauma authority — the scene constructs one with
// world-unit amplitudes, the 2D HUD layer (GameJuice) constructs its own with px
// amplitudes; both share the model + the `traumaForSeverity` mapping rather than each
// re-implementing noise + decay (the prior three-systems fragmentation).

// ── Device capability detection ────────────────────────────────────
function detectInitialQuality(): QualityPreset {
  if (typeof window === 'undefined') return 'medium';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return 'low';

    // GPU tier via renderer string
    const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbgInfo
      ? (gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) as string).toLowerCase()
      : '';

    // Explicit low-end GPU patterns
    if (/swiftshader|llvmpipe|software|microsoft basic/.test(renderer)) return 'low';
    // Workstation / Blackwell-class hardware — match strings unique to
    // pro / desktop discrete cards that can comfortably render at ultra
    // (4096 shadow maps, 6M tris, 2x pixel ratio). RTX PRO 4500 Blackwell
    // is the Concord production target, but the pattern catches the
    // broader workstation class (RTX A-series Quadro, RTX 4090/5090 Ti,
    // Apple M-series Max/Ultra) so consumer high-end desktops also get
    // the ultra preset without needing to discover the settings toggle.
    if (/(rtx\s*(pro|a\d|40[89]0|5090)|quadro|m[234]\s*(max|ultra)|m5\s*(pro|max|ultra))/.test(renderer)) return 'ultra';
    // Explicit high-end consumer patterns (RTX 30/40/50 mid-range, etc.)
    if (/rtx|radeon rx [56789]|apple m[234]|a1[5-9] gpu/.test(renderer)) return 'high';

    // RAM-based fallback (deviceMemory API — Chrome/Android)
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (mem !== undefined) {
      if (mem <= 2) return 'low';
      if (mem >= 8) return 'high';
    }

    // Core count fallback
    const cores = navigator.hardwareConcurrency ?? 4;
    if (cores <= 4) return 'low';
    if (cores >= 10) return 'high';

    return 'medium';
  } catch {
    return 'medium';
  }
}

// ── Types ──────────────────────────────────────────────────────────

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface SceneLayer {
  terrain: unknown; // THREE.Group at runtime
  buildings: unknown;
  infrastructure: unknown;
  avatars: unknown;
  weather: unknown;
  ui: unknown;
  water: unknown;
  particles: unknown;
}

export interface PerformanceBudget {
  drawCalls: number;
  maxDrawCalls: number;
  triangles: number;
  maxTriangles: number;
  textureMemory: number; // MB
  maxTextureMemory: number;
  fps: number;
  frameTime: number;
}

export interface ConcordiaSceneAPI {
  scene: unknown; // THREE.Scene
  camera: unknown; // THREE.PerspectiveCamera
  addBuilding: (buildingGroup: unknown, position: { x: number; y: number; z: number }) => void;
  removeBuilding: (id: string) => void;
  setWeather: (type: string, intensity: number) => void;
  setTimeOfDay: (hour: number) => void;
  getIntersectedObject: (screenX: number, screenY: number) => unknown | null;
}

interface ConcordiaSceneProps {
  districtId: string;
  quality?: QualityPreset;
  theme?: import('@/lib/world-lens/concordia-theme').ConcordiaThemeId;
  renderStyle?: 'pbr' | 'toon';
  questObjectives?: import('@/components/world-lens/QuestMarker3D').QuestObjective[];
  onBuildingClick?: (buildingId: string, intersection: unknown) => void;
  onTerrainClick?: (position: { x: number; y: number; z: number }) => void;
  onWeatherModifiers?: (
    modifiers: import('@/lib/world-lens/world-deformation').WeatherPhysicsModifiers
  ) => void;
  onSceneReady?: (
    lookup: (
      entityId: string
    ) => { visible: boolean; userData: Record<string, unknown> } | undefined
  ) => void;
  width?: number | string;
  height?: number | string;
  /**
   * Camera mode (Skyrim-style follow, first-person, or fixed isometric).
   * Drives the per-frame camera transform via getPlayerPose. Defaults to
   * 'isometric' (the previous hardcoded behavior) when not supplied.
   */
  cameraMode?: 'isometric' | 'follow' | 'first-person' | 'free' | 'interior' | 'cinematic';
  /** Per-frame player position + yaw, used for follow + first-person camera. */
  getPlayerPose?: () => { x: number; y: number; z: number; yaw: number } | null;
}

// ── Quality Presets ──────────────────────────────────────────────

const QUALITY_SETTINGS: Record<
  QualityPreset,
  {
    shadowMapSize: number;
    maxDrawCalls: number;
    maxTriangles: number;
    maxTextureMemory: number;
    antialias: boolean;
    pixelRatio: number;
    particleDensity: number;
  }
> = {
  low: {
    shadowMapSize: 512,
    maxDrawCalls: 200,
    maxTriangles: 500_000,
    maxTextureMemory: 128,
    antialias: false,
    pixelRatio: 0.75,
    particleDensity: 0.25,
  },
  medium: {
    shadowMapSize: 1024,
    maxDrawCalls: 500,
    maxTriangles: 1_500_000,
    maxTextureMemory: 256,
    antialias: true,
    pixelRatio: 1.0,
    particleDensity: 0.5,
  },
  high: {
    shadowMapSize: 2048,
    maxDrawCalls: 1000,
    maxTriangles: 3_000_000,
    maxTextureMemory: 512,
    antialias: true,
    pixelRatio: 1.5,
    particleDensity: 0.75,
  },
  ultra: {
    shadowMapSize: 4096,
    maxDrawCalls: 2000,
    maxTriangles: 6_000_000,
    maxTextureMemory: 1024,
    antialias: true,
    pixelRatio: 2.0,
    particleDensity: 1.0,
  },
};

const LAYER_NAMES = [
  'terrain',
  'buildings',
  'infrastructure',
  'avatars',
  'weather',
  'ui',
  'water',
  'particles',
] as const;

// ── Context ──────────────────────────────────────────────────────

const ConcordiaSceneContext = createContext<ConcordiaSceneAPI | null>(null);

export function useConcordiaScene(): ConcordiaSceneAPI {
  const ctx = useContext(ConcordiaSceneContext);
  if (!ctx) throw new Error('useConcordiaScene must be used within ConcordiaScene');
  return ctx;
}

// ── Styling ──────────────────────────────────────────────────────

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Component ────────────────────────────────────────────────────

export default function ConcordiaScene({
  districtId,
  quality: initialQuality = 'medium',
  theme: themeProp = 'neon-punk',
  renderStyle = 'pbr',
  questObjectives = [],
  onBuildingClick,
  onTerrainClick,
  onWeatherModifiers,
  onSceneReady,
  width = '100%',
  height = '100%',
  cameraMode = 'isometric',
  getPlayerPose,
}: ConcordiaSceneProps) {
  // Mirror cameraMode + getPlayerPose into refs so the game loop can read
  // the latest values without re-running the heavy init effect on each
  // mode change. Updated on every render via the small effect below.
  const cameraModeRef = useRef(cameraMode);
  const getPlayerPoseRef = useRef(getPlayerPose);
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  useEffect(() => { getPlayerPoseRef.current = getPlayerPose; }, [getPlayerPose]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const physicsRef = useRef<{
    step: (dt: number) => void;
    destroy: () => void;
    registerBuildingFromObject?: (obj: unknown, id: string) => string | null;
    removeBuildingCollider?: (key: string) => void;
    syncFromScene?: (root: unknown) => number;
  } | null>(null);
  const rendererRef = useRef<unknown>(null);
  const sceneRef = useRef<unknown>(null);
  const cameraRef = useRef<unknown>(null);
  // Sprint 1 (juice) — camera-punch impulse. concordia:camera-punch is already
  // dispatched (CombatStaggerCameraBridge / BuildingCollapseBridge) but had no
  // consumer; the render loop reads this decaying impulse and adds positional
  // jitter + a brief FOV kick after the base camera transform each frame.
  const cameraPunchRef = useRef<{ until: number; start: number; shake: number; fov: number }>(
    { until: 0, start: 0, shake: 0, fov: 0 },
  );
  // Phase BE1 — photo-mode freecam. PhotoMode dispatches `concordia:freecam`
  // with positional/yaw/zoom offsets; the render loop reads this ref and layers
  // the offset onto the base camera transform (active is reset to false when
  // PhotoMode closes, which re-zeroes the offsets via the off-detail).
  const freecamRef = useRef<{ active: boolean; x: number; y: number; z: number; yaw: number; zoom: number }>(
    { active: false, x: 0, y: 0, z: 0, yaw: 0, zoom: 1 },
  );
  // The shared trauma engine for the 3D camera (world-unit amplitudes). The
  // camera-punch handler feeds it trauma; the render loop applies its decaying
  // offset. FOV stays on cameraPunchRef (a lens effect, not part of the trauma
  // model). One engine, one decay curve — replaces the prior inline noise math.
  const traumaShakeRef = useRef<TraumaShake>(
    createTraumaShake({ maxTranslatePx: 0.16, maxRotateRad: 0.012, decayPerSec: 1.6, frequency: 22 }),
  );
  const composerRef = useRef<{
    render: (delta: number) => void;
    setSize: (w: number, h: number) => void;
  } | null>(null);
  const layersRef = useRef<Record<string, unknown>>({});
  const frameIdRef = useRef<number>(0);
  const clockRef = useRef<unknown>(null);
  const raycasterRef = useRef<unknown>(null);
  const buildingMapRef = useRef<Map<string, unknown>>(new Map());
  const weatherSysRef = useRef<
    import('@/lib/world-lens/world-deformation').WeatherTransitionSystem | null
  >(null);
  const ssgiPassRef = useRef<{
    dispose: () => void;
    setSize: (w: number, h: number) => void;
    render: (t: null) => void;
  } | null>(null);
  // Visual-polish Wave 5 — extra post passes layered on the composer.
  // Typed as a loose record because each sub-API has its own signature
  // shape (THREE.Matrix4 vs unknown vs WebGLRenderer); concrete typing
  // lives at the call site via import('@/lib/world-lens/...').
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polishPassesRef = useRef<Record<string, any> | null>(null);
  const polishMatRef = useRef<{ prev: unknown | null; cur: unknown | null }>({ prev: null, cur: null });
  // Sovereign Mass Raid Phase 4 dome — listener cleanup. Set in scene init,
  // invoked during teardown so the listener disposes with the scene.
  const domeCleanupRef = useRef<(() => void) | null>(null);
  // WS2 — world-state renderers (resource nodes / crops / claims / VFX) mounted
  // into the infrastructure + particles layers; disposed with the scene.
  const worldRenderersRef = useRef<{ dispose(): void } | null>(null);
  // WS-A3 — terrain-deformation orchestrator (mesh re-push + collider rebuild
  // from server deltas); disposed with the scene.
  const terrainDeformRef = useRef<{ dispose(): void } | null>(null);
  // WS-A4 — dynamic water-grid surface renderer; disposed with the scene.
  const waterGridRef = useRef<{ update(d: number, e: number): void; dispose(): void } | null>(null);
  const probeManagerRef = useRef<
    import('@/lib/world-lens/reflection-probes').ReflectionProbeManager | null
  >(null);
  const onWeatherModifiersRef = useRef(onWeatherModifiers);
  const onSceneReadyRef = useRef(onSceneReady);
  useEffect(() => {
    onWeatherModifiersRef.current = onWeatherModifiers;
  }, [onWeatherModifiers]);
  useEffect(() => {
    onSceneReadyRef.current = onSceneReady;
  }, [onSceneReady]);

  const [quality, setQuality] = useState<QualityPreset>(() =>
    initialQuality === 'medium' ? detectInitialQuality() : initialQuality
  );
  const lowFpsCountRef = useRef(0); // consecutive low-FPS frames for auto-downgrade
  const [showFps, setShowFps] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [perfBudget, setPerfBudget] = useState<PerformanceBudget>({
    drawCalls: 0,
    maxDrawCalls: QUALITY_SETTINGS[initialQuality].maxDrawCalls,
    triangles: 0,
    maxTriangles: QUALITY_SETTINGS[initialQuality].maxTriangles,
    textureMemory: 0,
    maxTextureMemory: QUALITY_SETTINGS[initialQuality].maxTextureMemory,
    fps: 0,
    frameTime: 0,
  });
  const [isReady, setIsReady] = useState(false);

  // ── Initialize Three.js scene ──────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const buildingMap = buildingMapRef.current;
    let THREE: typeof import('three');
    let renderer: InstanceType<typeof import('three').WebGLRenderer>;
    let scene: InstanceType<typeof import('three').Scene>;
    let camera: InstanceType<typeof import('three').PerspectiveCamera>;
    let clock: InstanceType<typeof import('three').Clock>;
    let raycaster: InstanceType<typeof import('three').Raycaster>;

    const fpsBuffer: number[] = [];
    let lastTime = globalThis.performance.now();

    async function init() {
      THREE = await import('three');
      if (disposed) return;

      // Physics world — init Rapier WASM, terrain collider registered via event
      const { physicsWorld } = await import('@/lib/world-lens/physics-world');
      await physicsWorld.init();
      // Cast: PhysicsWorld instance has narrower argument types (Object3DLike)
      // than the union we accept here (unknown). Structurally compatible at
      // call sites; the cast just bridges contravariance.
      physicsRef.current = physicsWorld as unknown as typeof physicsRef.current;
      if (disposed) {
        physicsWorld.destroy();
        physicsRef.current = null;
        return;
      }
      // Phase B2 — attach ragdoll bridge so concordia:lethal-hit
      // CustomEvents spawn ragdolls in this world's physics. Detacher
      // is stored on physicsRef.current for cleanup on unmount.
      try {
        const { attachRagdollBridge } = await import('@/lib/concordia/ragdoll-bridge');
        const detach = attachRagdollBridge(physicsWorld as unknown as { spawnRagdoll: (id: string, p: { x: number; y: number; z: number }, imp?: { x: number; y: number; z: number }) => unknown; despawnRagdoll?: (id: string) => void; removeCharacter?: (id: string) => void });
        // Stash detach on the global so the disposer below can call it.
        (physicsRef.current as unknown as { __detachRagdoll?: () => void }).__detachRagdoll = detach;
      } catch { /* ragdoll bridge optional */ }

      // Listen for terrain-ready to register heightfield collider
      let currentTerrainGroup: unknown = null;
      function onTerrainPhysics(e: Event) {
        const { hmData, hmWidth, hmHeight, terrainGroup, getElevationAt } = (e as CustomEvent).detail ?? {};
        if (hmData) {
          physicsWorld.createHeightfieldCollider(hmData, hmWidth, hmHeight, {
            x: 2000, // TERRAIN_SIZE
            y: 80, // maxElevation
            z: 2000,
          });
        }
        // Add the terrain MESH (with its district zone-splat materials) to the
        // visible 'terrain' layer. TerrainRenderer builds it and dispatches it
        // here, but previously it was only consumed for physics/deformation —
        // never displayed (same dead-bridge the buildings layer had). The
        // 'terrain' layer is otherwise empty (it's the raycast target), so no
        // doubling. Replace on re-dispatch (e.g. when district zones change).
        if (terrainGroup) {
          const layer = layersRef.current['terrain'] as
            | { add: (c: unknown) => void; remove: (c: unknown) => void }
            | undefined;
          if (layer) {
            if (currentTerrainGroup) { try { layer.remove(currentTerrainGroup); } catch { /* ignore */ } }
            layer.add(terrainGroup);
            currentTerrainGroup = terrainGroup;
          }
        }
        // WS-A3 — once terrain + its collider exist, attach the deformation
        // orchestrator: replay GET /terrain + live concordia:terrain-deformed →
        // deform the mesh chunks + debounced collider rebuild. Kill-switch
        // CONCORD_TERRAIN_DEFORM_RENDER (default on). One-shot per scene.
        if (terrainGroup && !terrainDeformRef.current) {
          void (async () => {
            try {
              const [{ attachTerrainDeformation }, { getSocket }] = await Promise.all([
                import('@/lib/world-lens/attach-terrain-deformation'),
                import('@/lib/realtime/socket'),
              ]);
              if (disposed) return;
              const worldId =
                (typeof window !== 'undefined' && window.localStorage?.getItem('concordia:activeWorldId')) ||
                'concordia-hub';
              const enabled = (window as { __concordClientConfig?: { CONCORD_TERRAIN_DEFORM_RENDER?: unknown } })
                .__concordClientConfig?.CONCORD_TERRAIN_DEFORM_RENDER !== 0;
              terrainDeformRef.current = attachTerrainDeformation({
                worldId,
                getTerrainGroup: () => terrainGroup as { children: unknown[] },
                physicsWorld: physicsWorld as unknown as {
                  rebuildHeightfieldWithDeltas?: (m: Map<string, number>, cell?: number, maxElev?: number) => void;
                },
                socket: getSocket() as unknown as { on(ev: string, cb: (p: unknown) => void): void; off(ev: string, cb: (p: unknown) => void): void },
                enabled,
              });
            } catch { /* deformation is progressive enhancement */ }
          })();
        }
        // WS-A4 — dynamic water surface from world_water_cells, placed on the
        // (deformed) terrain top via getElevationAt. Kill-switch
        // CONCORD_HYDRO_RENDER (default on). One-shot per scene.
        if (!waterGridRef.current) {
          void (async () => {
            try {
              const [{ createWaterGridRenderer }, { getSocket }, { getInjectedJwt }] = await Promise.all([
                import('@/lib/world-lens/water-grid-renderer'),
                import('@/lib/realtime/socket'),
                import('@/lib/auth-bridge'),
              ]);
              if (disposed) return;
              const hydroEnabled = (window as { __concordClientConfig?: { CONCORD_HYDRO_RENDER?: unknown } })
                .__concordClientConfig?.CONCORD_HYDRO_RENDER !== 0;
              if (!hydroEnabled) return;
              const worldId =
                (typeof window !== 'undefined' && window.localStorage?.getItem('concordia:activeWorldId')) ||
                'concordia-hub';
              const waterLayer = (layersRef.current?.['water'] ?? layersRef.current?.['particles']) as
                InstanceType<typeof import('three').Group> | undefined;
              if (!waterLayer) return;
              const handle = createWaterGridRenderer(waterLayer as unknown as import('three').Group, {
                worldId,
                authToken: () => getInjectedJwt(),
                elevationAt: typeof getElevationAt === 'function'
                  ? (gx: number, gz: number) => getElevationAt(gx, gz)
                  : undefined,
                socket: getSocket() as unknown as { on(ev: string, cb: (p: unknown) => void): void; off(ev: string, cb: (p: unknown) => void): void },
              });
              waterGridRef.current = handle;
              // Drive its per-frame update via the water layer's userData.update
              // (the render loop's LAYER_NAMES fan-out calls this).
              (waterLayer.userData as { update?: (d: number, e: number) => void }).update = (d: number, en: number) =>
                handle.update(d, en);
            } catch { /* hydrology is progressive enhancement */ }
          })();
        }
      }
      // @resource-leak-ok: terrain-ready is a one-shot scene-init signal; ConcordiaScene unmounts the whole canvas, not the listener individually
      window.addEventListener('concordia:terrain-ready', onTerrainPhysics);

      // Lens-as-Station — consume the React BuildingRenderer3D layer's output.
      // It builds a fully-positioned group of all world buildings (with iconic
      // silhouettes) and dispatches concordia:buildings-ready; without this the
      // group was dispatched into the void (only a no-op event-router stub
      // listened), so 3D buildings never reached the scene. Add it to the
      // 'buildings' layer (otherwise empty — addBuilding has no caller — so no
      // doubling); replace on re-dispatch when the building set changes.
      let currentBuildingsGroup: unknown = null;
      function onBuildingsReady(e: Event) {
        const g = (e as CustomEvent).detail?.buildingGroup as unknown;
        const layer = layersRef.current['buildings'] as
          | { add: (c: unknown) => void; remove: (c: unknown) => void }
          | undefined;
        if (!g || !layer) return;
        if (currentBuildingsGroup) { try { layer.remove(currentBuildingsGroup); } catch { /* ignore */ } }
        layer.add(g);
        currentBuildingsGroup = g;
      }
      // @resource-leak-ok: same one-shot scene lifecycle as terrain-ready above.
      window.addEventListener('concordia:buildings-ready', onBuildingsReady);

      // Consume the AvatarSystem3D layer's output — the player + NPC meshes.
      // AvatarSystem3D builds the avatar group and dispatches
      // concordia:avatars-ready, but the only listener was a no-op stub, so the
      // player character + NPC bodies never reached the scene (they showed only
      // as 2D HTML name-tags). Add the group to the 'avatars' scene layer and
      // route its per-frame update through the layer (the LAYER_NAMES fan-out in
      // the render loop calls layers.avatars.userData.update each frame), so the
      // avatars both RENDER and ANIMATE/move. Replace on re-dispatch.
      let currentAvatarGroup: unknown = null;
      function onAvatarsReady(e: Event) {
        const ag = (e as CustomEvent).detail?.avatarGroup as
          | { userData?: { update?: (d: number, en: number) => void } }
          | null;
        const layer = layersRef.current['avatars'] as
          | { add: (c: unknown) => void; remove: (c: unknown) => void; userData: { update?: (d: number, en: number) => void } }
          | undefined;
        if (!ag || !layer) return;
        if (currentAvatarGroup) { try { layer.remove(currentAvatarGroup); } catch { /* ignore */ } }
        layer.add(ag);
        currentAvatarGroup = ag;
        layer.userData.update = (d: number, en: number) => { try { ag.userData?.update?.(d, en); } catch { /* per-frame, never throw */ } };
      }
      // @resource-leak-ok: same one-shot scene lifecycle as terrain-ready above.
      window.addEventListener('concordia:avatars-ready', onAvatarsReady);

      // Answer scene-request-ready: TreeLayer / RockLayer / QuestMarker3D (and
      // other self-adding overlays) ping this when they mount AFTER our one-shot
      // scene-ready already fired, asking for the scene. With no responder they
      // never received it and silently never rendered (a mount-order race). Re-
      // emit scene-ready WITH {scene, camera} so a late layer can self-add.
      function onSceneRequest() {
        const s = sceneRef.current, c = cameraRef.current;
        if (s && c) {
          window.dispatchEvent(new CustomEvent('concordia:scene-ready', { detail: { scene: s, camera: c } }));
        }
      }
      // @resource-leak-ok: same one-shot scene lifecycle as terrain-ready above.
      window.addEventListener('concordia:scene-request-ready', onSceneRequest);

      // Theme 6 deferred follow-up (game-feel pass): water plane + swim
      // registration. Adds a translucent blue plane at y=2 that covers
      // the river-bluff valley west of origin, plus a Fall Kill Creek
      // strip slightly south. Registers the water-Y so AvatarSystem3D's
      // swim-mode toggle activates when the player walks below.
      try {
        const worldId = (typeof window !== 'undefined' && window.localStorage?.getItem('concordia:activeWorldId')) || 'concordia-hub';
        const waterY = 2.0;
        physicsWorld.registerWaterPlane?.(worldId, waterY);
        const waterMat = new THREE.MeshStandardMaterial({
          color: 0x2c6ea1,
          transparent: true,
          opacity: 0.55,
          metalness: 0.1,
          roughness: 0.35,
          side: THREE.DoubleSide,
        });
        // River bluff: large strip west of origin, ~120m × 600m
        const river = new THREE.Mesh(new THREE.PlaneGeometry(120, 600, 1, 1), waterMat);
        river.rotation.x = -Math.PI / 2;
        river.position.set(-700, waterY, 0);
        river.name = 'water:river';
        scene.add(river);
        // Fall Kill Creek: small strip south of origin, 50m × 220m
        const creek = new THREE.Mesh(new THREE.PlaneGeometry(50, 220, 1, 1), waterMat);
        creek.rotation.x = -Math.PI / 2;
        creek.position.set(150, waterY, -260);
        creek.name = 'water:creek';
        scene.add(creek);
      } catch { /* water plane is cosmetic; never block scene init */ }

      const settings = QUALITY_SETTINGS[quality];

      // ── Renderer ─────────────────────────────────────────────────
      // Attempt WebGPU first if available + opted-in, fall back to WebGL2.
      // Opt-in (Sprint 7): localStorage.setItem('concordia:renderer', 'webgpu')
      // We default to WebGL2 to avoid surprising current users; WebGPU is
      // production-ready in three.js r171+ but our installed r0.160 ships
      // it as an experimental module under examples/jsm/renderers/webgpu.
      // The opt-in lets early adopters get the 2-10× draw-call gains
      // while the safe default keeps everyone else happy.
      let useWebGPU = false;
      const optIn = typeof window !== 'undefined' &&
        window.localStorage?.getItem('concordia:renderer') === 'webgpu';
      if (optIn && typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
          const adapter = await (
            navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown | null> } }
          ).gpu.requestAdapter();
          if (adapter) useWebGPU = true;
        } catch {
          // WebGPU not available, fall back
        }
      }

      if (useWebGPU) {
        try {
          // Lazy import to avoid bundling WebGPU module into WebGL-only path.
          const webGpuModule = await import(
            'three/examples/jsm/renderers/webgpu/WebGPURenderer.js'
          );
          const WebGPURendererCtor = (webGpuModule as unknown as {
            default: new (opts: { canvas?: HTMLCanvasElement; antialias?: boolean; powerPreference?: string }) => unknown;
          }).default;
          // The WebGPURenderer surfaces a WebGLRenderer-compatible API for
          // scene rendering. SSGI / TAA / post-processing chain still
          // operates against the (compatible) shape. Some advanced WebGL-
          // specific paths (raw GL state pokes) will silently no-op.
          const gpuRenderer = new WebGPURendererCtor({
            canvas: canvas!,
            antialias: settings.antialias,
            powerPreference: 'high-performance',
          });
          await (gpuRenderer as { init?: () => Promise<void> }).init?.();
          renderer = gpuRenderer as unknown as THREE.WebGLRenderer;
          console.info('[ConcordiaScene] WebGPU renderer activated (opt-in)');
        } catch (gpuErr) {
          console.warn('[ConcordiaScene] WebGPU init failed, falling back to WebGL2:', gpuErr);
          useWebGPU = false;
        }
      }

      if (!useWebGPU) {
        renderer = new THREE.WebGLRenderer({
          canvas: canvas!,
          antialias: settings.antialias,
          powerPreference: 'high-performance',
          alpha: false,
        });
      }
      // Sentinel so other systems can branch on the active backend.
      (renderer as unknown as { __isWebGPU?: boolean }).__isWebGPU = useWebGPU;
      // Track 2 — register the renderer so the KTX2/Basis texture loader can
      // detectSupport() and decode GPU-compressed textures when present.
      try {
        const { registerRendererForKtx2 } = await import('@/lib/world-lens/texture-loader');
        registerRendererForKtx2(renderer);
      } catch { /* KTX2 optional */ }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
      renderer.setSize(canvas!.clientWidth, canvas!.clientHeight);
      // Phase AA — mount Stats.js widget when ?perf=1 or NODE_ENV=development.
      try { mountPerfMonitor({ dev: process.env.NODE_ENV === 'development' }); } catch { /* SSR */ }
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      // Phase 8.3 — WebXR for Vision Pro + Quest 4. Enable the XR layer
      // upfront so an "Enter VR" button (mounted separately) can hand
      // the renderer's session reference straight to navigator.xr.
      // visionOS Safari supports immersive-vr by default since v2;
      // Quest 4 the same. AR module (immersive-ar) not yet on visionOS
      // so we stay vr-only for now.
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local-floor');
      // Expose to window so the EnterVRButton component (mounted in
      // app/lenses/world/page.tsx) can hand the active session to
      // renderer.xr.setSession() without needing prop-drilling
      // through the entire scene tree.
      (window as unknown as { __concordiaRenderer?: unknown }).__concordiaRenderer = renderer;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;

      // ── Post-Processing ─────────────────────────────────────────
      // Bloom disabled in toon mode (toon + bloom conflicts visually).
      // Vignette always on for medium+.
      if (quality !== 'low') {
        try {
          const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] =
            await Promise.all([
              import('three/examples/jsm/postprocessing/EffectComposer.js'),
              import('three/examples/jsm/postprocessing/RenderPass.js'),
              import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
              import('three/examples/jsm/postprocessing/ShaderPass.js'),
            ]);
          const composer = new EffectComposer(renderer);
          composer.addPass(new RenderPass(scene, camera));
          // Bloom: PBR only — toon shading looks wrong with bloom
          if (renderStyle !== 'toon') {
            const bloom = new UnrealBloomPass(
              new THREE.Vector2(canvas!.clientWidth, canvas!.clientHeight),
              quality === 'high' || quality === 'ultra' ? 1.2 : 0.7,
              0.4,
              0.3
            );
            composer.addPass(bloom);
          }
          // Vignette: always on for cinematic framing
          const vignetteShader = {
            uniforms: {
              tDiffuse: { value: null },
              darkness: { value: 0.55 },
              offset: { value: 0.5 },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform sampler2D tDiffuse; uniform float darkness; uniform float offset; varying vec2 vUv;
              void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
                float vignette = clamp(dot(uv, uv) * darkness * 4.0, 0.0, 1.0);
                gl_FragColor = vec4(mix(color.rgb, vec3(0.0), vignette), color.a);
              }`,
          };
          composer.addPass(new ShaderPass(vignetteShader));

          // Phase 13 polish-to-ten: color grading pass.
          // Cheap shader that lifts blacks slightly, warms highlights, and
          // crushes saturation in shadows. Composes after vignette so the
          // grade applies to the already-darkened edges.
          const colorGradeShader = {
            uniforms: {
              tDiffuse:    { value: null },
              gradeWarm:   { value: quality === 'ultra' ? 0.06 : 0.04 },
              gradeLift:   { value: 0.02 },
              gradeShadowDesat: { value: 0.85 },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform float gradeWarm;
              uniform float gradeLift;
              uniform float gradeShadowDesat;
              varying vec2 vUv;
              void main() {
                vec4 c = texture2D(tDiffuse, vUv);
                vec3 col = c.rgb;
                // Lift blacks
                col = col + vec3(gradeLift);
                // Luminance-based shadow desat
                float lum = dot(col, vec3(0.299, 0.587, 0.114));
                float shadowMix = smoothstep(0.0, 0.4, 1.0 - lum);
                vec3 gray = vec3(lum);
                col = mix(col, mix(col, gray, shadowMix * (1.0 - gradeShadowDesat)), 1.0);
                // Warm highlights — push R+G in bright regions
                float hi = smoothstep(0.5, 1.0, lum);
                col.r += gradeWarm * hi;
                col.g += gradeWarm * 0.5 * hi;
                gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
              }`,
          };
          composer.addPass(new ShaderPass(colorGradeShader));

          // ── Visual-polish Wave 5: motion blur + chromatic aberration + LUT
          // The shader-pass constructor is given to each builder so we
          // don't have to re-import from three/examples in this file.
          try {
            const [{ createMotionBlurPass }, { createChromaticAberrationPass }, { createLUTPass }] =
              await Promise.all([
                import('@/lib/world-lens/post-motion-blur'),
                import('@/lib/world-lens/post-chromatic-aberration'),
                import('@/lib/world-lens/lut-loader'),
              ]);
            const motionBlur = createMotionBlurPass(ShaderPass as unknown as new (s: unknown) => unknown);
            motionBlur.setStrength(quality === 'ultra' ? 0.55 : 0.35);
            composer.addPass(motionBlur.shaderPass as unknown as InstanceType<typeof ShaderPass>);

            const chromAb = createChromaticAberrationPass(ShaderPass as unknown as new (s: unknown) => unknown);
            chromAb.setAmbient(quality === 'ultra' ? 0.0035 : 0.002);
            composer.addPass(chromAb.shaderPass as unknown as InstanceType<typeof ShaderPass>);
            const detachChromAb = chromAb.attachWindowEvents();

            const lut = createLUTPass(THREE, ShaderPass as unknown as new (s: unknown) => unknown);
            // No LUT loaded by default; .cube files dropped in public/luts/
            // can be loaded by callers via setLut + setEnabled(true).
            composer.addPass(lut.shaderPass as unknown as InstanceType<typeof ShaderPass>);

            polishPassesRef.current = polishPassesRef.current ?? {};
            polishPassesRef.current.motionBlur = motionBlur;
            polishPassesRef.current.chromAb = { ...chromAb, detach: detachChromAb };
            polishPassesRef.current.lut = lut;

            // Track 2 — edge-detection outline: a luminance Sobel ink pass that
            // adds interior toon linework the inverted-hull outline can't draw.
            // On in toon mode (where it belongs and bloom is skipped), or when
            // window.__CONCORD_EDGE_OUTLINE__ === true. Off → PBR unchanged.
            try {
              const edgeOn = renderStyle === 'toon'
                || (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__CONCORD_EDGE_OUTLINE__ === true);
              if (edgeOn) {
                const { createEdgeOutlinePass } = await import('@/lib/world-lens/post-edge-outline');
                const edge = createEdgeOutlinePass(
                  THREE as unknown as { Vector2: new (x: number, y: number) => unknown; Color: new (hex: number) => unknown },
                  ShaderPass as unknown as new (s: unknown) => unknown,
                  { width: canvas!.clientWidth, height: canvas!.clientHeight },
                );
                edge.setStrength(quality === 'ultra' ? 0.85 : 0.6);
                composer.addPass(edge.shaderPass as unknown as InstanceType<typeof ShaderPass>);
                polishPassesRef.current.edgeOutline = edge;
              }
            } catch (edgeErr) {
              console.warn('[ConcordiaScene] Edge-outline pass unavailable:', edgeErr);
            }

            // Auto-exposure does not need a ShaderPass — it samples the
            // back buffer + sets renderer.toneMappingExposure directly.
            try {
              const { createAutoExposure } = await import('@/lib/world-lens/post-auto-exposure');
              polishPassesRef.current.autoExposure = createAutoExposure({
                blendFactor: quality === 'ultra' ? 0.06 : 0.04,
              });
            } catch (aeErr) {
              console.warn('[ConcordiaScene] Auto-exposure unavailable:', aeErr);
            }
          } catch (polishErr) {
            console.warn('[ConcordiaScene] Polish passes unavailable:', polishErr);
          }

          // Wave 1 deferral 1: depth-of-field pass for cinematic dialogue.
          // Cheap radial blur centered on screen — not true depth-aware DoF
          // (which needs a separate depth render-target setup), but visually
          // close enough for dialogue framing where the player's focus is
          // the NPC at center. Off by default; activates when the
          // `concordia:cinematic-mode` window event flips it on.
          const dofShader = {
            uniforms: {
              tDiffuse:    { value: null },
              dofStrength: { value: 0.0 },
              dofRadius:   { value: 0.20 },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
              uniform sampler2D tDiffuse;
              uniform float dofStrength;
              uniform float dofRadius;
              varying vec2 vUv;
              void main() {
                vec4 c = texture2D(tDiffuse, vUv);
                if (dofStrength < 0.001) { gl_FragColor = c; return; }
                vec2 center = vec2(0.5, 0.5);
                float d = distance(vUv, center) / 0.7071;
                float blurAmt = smoothstep(dofRadius, 1.0, d) * dofStrength;
                vec2 px = vec2(1.0 / 1920.0, 1.0 / 1080.0) * blurAmt * 4.0;
                vec3 acc = c.rgb;
                acc += texture2D(tDiffuse, vUv + vec2( px.x,  0.0)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2(-px.x,  0.0)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2( 0.0,  px.y)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2( 0.0, -px.y)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2( px.x,  px.y)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2(-px.x, -px.y)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2( px.x, -px.y)).rgb;
                acc += texture2D(tDiffuse, vUv + vec2(-px.x,  px.y)).rgb;
                gl_FragColor = vec4(acc / 9.0, c.a);
              }`,
          };
          const dofPass = new ShaderPass(dofShader);
          composer.addPass(dofPass);

          // ── Sprint 7: TAA — temporal anti-aliasing ────────────────
          // Three.js TAARenderPass accumulates jittered camera samples
          // across frames. Static scenes converge to 16×MSAA-equivalent
          // quality after 16 frames at zero per-frame cost. Eliminates
          // the shimmer on thin geometry at distance that the audit
          // flagged as a current pain point. Activated at high+ quality.
          if (quality === 'high' || quality === 'ultra') {
            try {
              const { TAARenderPass } = await import('three/examples/jsm/postprocessing/TAARenderPass.js');
              const taaPass = new TAARenderPass(scene, camera);
              taaPass.unbiased = false;
              taaPass.sampleLevel = quality === 'ultra' ? 3 : 2; // 8 / 4 samples
              composer.addPass(taaPass);
            } catch (taaErr) {
              console.warn('[ConcordiaScene] TAA unavailable:', taaErr);
            }
          }

          // ── Sprint 7: Volumetric fog (ultra only) ─────────────────
          // Ray-marched fog in a post-pass — cheap depth-blended density
          // approximation. Doesn't use a true depth target; rides the
          // existing fragment color luminance as a soft proxy. Real depth-
          // based volumetric requires a depth-render-target setup which is
          // a follow-on; this pass gives ~80% of the atmospheric depth
          // payoff for ~20% of the integration cost.
          if (quality === 'ultra') {
            // Default cool-blue fog tint. Real per-theme color is applied
            // by ConcordiaScene's theme setup after this pass is created —
            // we expose a setter via composer._volFogSetColor so the theme
            // change handler can drive it. Default works as a safe pre-theme.
            const fogColor = new THREE.Color(0x66aacc);
            const volumetricFogShader = {
              uniforms: {
                tDiffuse:        { value: null },
                fogColor:        { value: new THREE.Vector3(fogColor.r, fogColor.g, fogColor.b) },
                fogDensity:      { value: 0.18 },
                fogHeight:       { value: 0.42 }, // screen-y band where fog peaks
                fogBandWidth:    { value: 0.35 },
                time:            { value: 0.0 },
              },
              vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
              fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec3 fogColor;
                uniform float fogDensity;
                uniform float fogHeight;
                uniform float fogBandWidth;
                uniform float time;
                varying vec2 vUv;
                // Cheap 2D hash for breathing animation
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                void main() {
                  vec4 c = texture2D(tDiffuse, vUv);
                  // Vertical fog band — densest at fogHeight, falls off
                  // smoothly above and below.
                  float dy = abs(vUv.y - fogHeight);
                  float bandFalloff = 1.0 - smoothstep(0.0, fogBandWidth, dy);
                  // Distance proxy — darker pixels are usually further.
                  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                  float depthProxy = 1.0 - lum;
                  // Breathing — slow density modulation across screen for life.
                  float breath = 0.85 + 0.15 * sin(time * 0.3 + hash(floor(vUv * 12.0)) * 6.28);
                  float density = fogDensity * bandFalloff * depthProxy * breath;
                  density = clamp(density, 0.0, 0.8);
                  vec3 finalColor = mix(c.rgb, fogColor, density);
                  gl_FragColor = vec4(finalColor, c.a);
                }
              `,
            };
            const volFogPass = new ShaderPass(volumetricFogShader);
            composer.addPass(volFogPass);
            // Animate time uniform so the breathing pass shifts visibly.
            const animateFog = () => {
              try { volFogPass.uniforms.time.value = globalThis.performance.now() / 1000; } catch { /* noop */ }
            };
            (composer as unknown as { _volFogAnimate?: () => void })._volFogAnimate = animateFog;
            (composer as unknown as { _volFogSetColor?: (hex: number) => void })._volFogSetColor = (hex: number) => {
              try {
                const c = new THREE.Color(hex);
                volFogPass.uniforms.fogColor.value = new THREE.Vector3(c.r, c.g, c.b);
              } catch { /* noop */ }
            };
          }

          // Bind dofPass.uniforms.dofStrength to a window event so any
          // component can toggle cinematic mode without a prop chain.
          const dofHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { active?: boolean; strength?: number } | undefined;
            const target = detail?.active ? (detail.strength ?? 0.6) : 0;
            try { dofPass.uniforms.dofStrength.value = target; } catch { /* noop */ }
          };
          window.addEventListener('concordia:cinematic-mode', dofHandler);
          // Stash a cleanup hook so the existing dispose flow can detach.
          (composer as unknown as { _dofCleanup?: () => void })._dofCleanup = () =>
            window.removeEventListener('concordia:cinematic-mode', dofHandler);

          composerRef.current = composer;
        } catch (ppErr) {
          console.warn('[ConcordiaScene] Post-processing unavailable:', ppErr);
        }
      }

      // ── Scene ───────────────────────────────────────────────────
      const { CONCORDIA_THEMES } = await import('@/lib/world-lens/concordia-theme');
      const activeTheme = CONCORDIA_THEMES[themeProp] || CONCORDIA_THEMES['neon-punk'];
      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(activeTheme.fog.color, activeTheme.fog.near, activeTheme.fog.far);
      sceneRef.current = scene;

      // ── Visual-polish Wave 6: procedural sky dome + (optional) clouds.
      try {
        const { createSkyDome } = await import('@/lib/world-lens/sky-shader');
        const sky = createSkyDome(THREE, { radius: 2200, segments: 28 });
        scene.add(sky.mesh);
        (scene as unknown as { __concordSky?: unknown }).__concordSky = sky;
        // Default time-of-day = afternoon
        sky.setTimeOfDayHour(15);
        if (quality === 'high' || quality === 'ultra') {
          const { createCloudLayer } = await import('@/lib/world-lens/cloud-raymarch');
          const clouds = createCloudLayer(THREE, { radius: 1600 });
          clouds.setWeatherDensity(0.55);
          scene.add(clouds.mesh);
          (scene as unknown as { __concordClouds?: unknown }).__concordClouds = clouds;
        }
      } catch (skyErr) {
        console.warn('[ConcordiaScene] Sky / clouds unavailable:', skyErr);
      }

      // ── I3: procedural per-world landmarks (stylized canon identity) ──
      // Real CC0 GLB/PBR drops would mount through the same group; until then
      // these procedural silhouettes are the deliberate identity per world.
      try {
        const { createWorldLandmarks } = await import('@/lib/world-lens/landmarks');
        // themeProp shares ids with canon world ids (tunya, concordia-hub, …).
        const landmarks = createWorldLandmarks(THREE, themeProp, activeTheme);
        scene.add(landmarks);
        (scene as unknown as { __concordLandmarks?: unknown }).__concordLandmarks = landmarks;
      } catch (lmErr) {
        console.warn('[ConcordiaScene] Landmarks unavailable:', lmErr);
      }
      // Sprint 9 — expose scene globally so the QuestWaypointBeacon
      // can attach its 3D objects without prop-drilling through the
      // entire scene tree. Same pattern as __concordiaRenderer.
      (window as unknown as { __concordiaScene?: unknown }).__concordiaScene = scene;
      // Sprint 7 — sync volumetric fog color to active theme.
      try {
        const setVolFogColor = (composerRef.current as unknown as { _volFogSetColor?: (hex: number) => void } | null)?._volFogSetColor;
        if (setVolFogColor) {
          const themeFogHex = typeof activeTheme.fog.color === 'number'
            ? activeTheme.fog.color
            : new THREE.Color(activeTheme.fog.color as unknown as string).getHex();
          setVolFogColor(themeFogHex);
        }
      } catch { /* noop */ }

      // ── Camera ──────────────────────────────────────────────────
      const aspect = canvas!.clientWidth / canvas!.clientHeight;
      camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 5000);
      camera.position.set(200, 150, 200);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      // ── Scene Layers as THREE.Group ─────────────────────────────
      const layers: Record<string, InstanceType<typeof import('three').Group>> = {};
      for (const name of LAYER_NAMES) {
        const group = new THREE.Group();
        group.name = name;
        scene.add(group);
        layers[name] = group;
      }
      layersRef.current = layers;

      // ── WS2 world-state renderers ───────────────────────────────
      // Mount the resource-node / crop-field / claim-boundary renderers into the
      // reserved `infrastructure` layer and the VFX bridge into `particles`. The
      // per-frame fan-out below (LAYER_NAMES loop) calls each layer group's
      // userData.update, so wiring the handle's update onto the infrastructure
      // group is all that's needed to drive every data renderer; the VFX bridge
      // is driven from the same handle (one update fans out to all four).
      try {
        const { attachWorldRenderers } = await import('@/lib/world-lens/attach-world-renderers');
        const worldId =
          (typeof window !== 'undefined' && window.localStorage?.getItem('concordia:activeWorldId')) ||
          'concordia-hub';
        const handle = attachWorldRenderers(layers.infrastructure, layers.particles, { worldId });
        worldRenderersRef.current = handle;
        (layers.infrastructure.userData as { update?: (d: number, e: number) => void }).update = (
          d: number,
          e: number,
        ) => handle.update(d, e);
      } catch {
        // Renderers are progressive enhancement — a mount failure leaves the
        // base scene (terrain/buildings/avatars) fully functional.
      }

      // ── Sovereign Mass Raid Phase 4 dome ────────────────────────
      // Subscribes to world:refusal-field; when a dome_collapse field
      // fires, attaches a shrinking sphere mesh to the scene for the
      // duration of the field. Cleanup runs in the teardown block below.
      try {
        const { attachDomeBarrier } = await import('@/lib/world-lens/dome-barrier');
        domeCleanupRef.current = attachDomeBarrier(scene as unknown as {
          add: (mesh: unknown) => void;
          remove: (mesh: unknown) => void;
        });
      } catch { /* dome VFX is best-effort */ }

      // ── Clock & Raycaster ───────────────────────────────────────
      clock = new THREE.Clock();
      clockRef.current = clock;
      raycaster = new THREE.Raycaster();
      raycasterRef.current = raycaster;

      // ── Ambient + default directional light ─────────────────────
      const ambient = new THREE.AmbientLight(
        activeTheme.ambientLight.color,
        activeTheme.ambientLight.intensity
      );
      scene.add(ambient);

      const sun = new THREE.DirectionalLight(
        activeTheme.sunLight.color,
        activeTheme.sunLight.intensity
      );
      sun.position.set(100, 200, 80);
      sun.castShadow = true;
      sun.shadow.mapSize.width = settings.shadowMapSize;
      sun.shadow.mapSize.height = settings.shadowMapSize;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 600;
      sun.shadow.camera.left = -300;
      sun.shadow.camera.right = 300;
      sun.shadow.camera.top = 300;
      sun.shadow.camera.bottom = -300;
      scene.add(sun);

      // ── Portal glow lights — 5 retained (was 15); intensity +30% to compensate ──
      // Removed lights rely on building emissive (0.08) beyond 15m — imperceptible
      const PORTAL_POSITIONS = [
        [8, 4],
        [4, 6],
        [12, 3],
        [2, 8],
        [16, 7],
      ];
      for (const [px, pz] of PORTAL_POSITIONS) {
        const pl = new THREE.PointLight(activeTheme.portalGlow, 2.6, 15);
        pl.position.set(px, 2, pz);
        scene.add(pl);
      }
      // ── Street lamp point lights — 3 retained (was 8); intensity +30% ──
      const LAMP_POSITIONS = [
        [3, 3],
        [7, 7],
        [11, 2],
      ];
      for (const [lx, lz] of LAMP_POSITIONS) {
        const lamp = new THREE.PointLight(activeTheme.streetLamp, 1.95, 20);
        lamp.position.set(lx, 4, lz);
        scene.add(lamp);
      }

      // ── PCSS soft shadows (quality ≥ medium) ────────────────────
      if (quality !== 'low') {
        try {
          const { upgradeShadowMap, configurePCSSLight, applyPCSSToScene } =
            await import('@/lib/world-lens/pcss-shadows');
          upgradeShadowMap(renderer);
          configurePCSSLight(sun, settings.shadowMapSize, 200);
          if (!disposed) applyPCSSToScene(scene);
        } catch {
          /* PCSS optional — silently skip if shader compile fails */
        }
      }

      // ── Reflection probes (quality ≥ high) ─────────────────────
      if (quality === 'high' || quality === 'ultra') {
        try {
          const { ReflectionProbeManager, placeCityProbes } =
            await import('@/lib/world-lens/reflection-probes');
          const pm = new ReflectionProbeManager(renderer, scene);
          placeCityProbes(pm, new THREE.Vector3(0, 0, 0), 400, 3, 8);
          probeManagerRef.current = pm;
        } catch {
          /* probes optional */
        }
      }

      // ── SSGI (quality = ultra) ──────────────────────────────────
      if (quality === 'ultra') {
        try {
          const { SSGIPass } = await import('@/lib/world-lens/ssgi');
          // Polish-pass tuning: bumped intensity 0.4 → 0.55 (more visible
          // indirect-light bounce, especially in shaded districts like the
          // Forge), samples 8 → 12 (less noise on roughness > 0.6), and
          // dropped temporalBlend 0.10 → 0.08 (slightly less ghost-trail
          // when the camera moves quickly).
          ssgiPassRef.current = new SSGIPass(
            renderer,
            scene,
            camera,
            canvas!.clientWidth,
            canvas!.clientHeight,
            { intensity: 0.55, numSamples: 12, temporalBlend: 0.08 }
          );
        } catch {
          /* SSGI optional */
        }
      }

      // ── WeatherTransitionSystem ─────────────────────────────────
      const { WeatherTransitionSystem } = await import('@/lib/world-lens/world-deformation');
      const weatherSys = new WeatherTransitionSystem({
        type: 'clear',
        intensity: 0,
        windSpeed: 0,
        windDir: 0,
        temperature: 20,
        visibility: 500,
      });
      weatherSysRef.current = weatherSys;

      // Retroactively register colliders for any building meshes that the
      // scene loader placed before our addBuilding API was wired (e.g.
      // pre-existing buildings loaded async from DB after physics init).
      // syncFromScene is idempotent — buildings already registered are skipped.
      try {
        physicsRef.current?.syncFromScene?.(scene);
      } catch {
        // never block scene-ready on physics sync errors
      }

      // Notify QuestMarker3D and other overlays that scene + camera are ready
      window.dispatchEvent(
        new CustomEvent('concordia:scene-ready', {
          detail: { scene, camera },
        })
      );

      // Expose a worldToScreen projector for HTML overlay layers (BazaarLayer,
      // marker variants). Lives off-thread of the main render loop.
      const _projectVec = new THREE.Vector3();
      const projectFn = (world: { x: number; y: number; z: number }) => {
        _projectVec.set(world.x, world.y, world.z);
        _projectVec.project(camera);
        const visible = _projectVec.z > -1 && _projectVec.z < 1;
        const x = (_projectVec.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-_projectVec.y * 0.5 + 0.5) * window.innerHeight;
        return { x, y, visible };
      };
      // Also stash on window so overlays that mount AFTER this one-shot event
      // (dynamic imports — e.g. LockOnController) can still pick up the projector.
      (window as unknown as { __concordiaProject?: typeof projectFn }).__concordiaProject = projectFn;
      window.dispatchEvent(
        new CustomEvent('concordia:projector-ready', {
          detail: { project: projectFn },
        })
      );

      // Expose building lookup for deformation replay
      onSceneReadyRef.current?.((entityId: string) => {
        const obj = buildingMapRef.current.get(entityId);
        return obj as { visible: boolean; userData: Record<string, unknown> } | undefined;
      });

      setIsReady(true);
      // Phase J — signal the travel hook that the new scene's first frame
      // is about to render. The hook resolves its `travel()` Promise and
      // hides the portal load screen.
      try {
        if (typeof window !== 'undefined') {
          // Fire on the next animation frame so React has a chance to paint
          // the scene before we hide the overlay.
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('concordia:scene-ready'));
          });
        }
      } catch { /* SSR */ }

      // Camera follow / collision support refs (reused across frames)
      const cameraLookStateRef = cameraLookState;
      cameraLookStateRef.sensitivity = getStoredSensitivity();
      const cameraRaycaster = new THREE.Raycaster();

      // ── Game loop ───────────────────────────────────────────────
      function gameLoop() {
        if (disposed) return;

        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();

        // Step physics simulation
        physicsRef.current?.step(delta);

        // ── Camera follow / first-person ──────────────────────────
        // Drive the camera transform from the player's pose every frame.
        // In first-person, mouse yaw drives the player's facing too (via
        // the shared cameraLookState module that AvatarSystem3D reads).
        // In follow, a raycast against the buildings layer pulls the camera
        // forward when it would clip into a wall.
        const mode = cameraModeRef.current;
        const getPose = getPlayerPoseRef.current;
        if (mode !== 'isometric' && mode !== 'cinematic' && getPose) {
          const pose = getPose();
          if (pose) {
            // In first-person, the camera yaw IS the player yaw — we don't
            // add to it. In follow, the player's body rotates with WASD
            // independently and the camera orbits via mouse-look.
            const yaw = mode === 'first-person'
              ? cameraLookStateRef.yaw
              : pose.yaw + cameraLookStateRef.yaw;
            const pitch = cameraLookStateRef.pitch;
            if (mode === 'first-person') {
              const eyeY = pose.y + 1.6;
              camera.position.set(pose.x, eyeY, pose.z);
              const lookX = pose.x + Math.sin(yaw) * Math.cos(pitch);
              const lookY = eyeY + Math.sin(pitch);
              const lookZ = pose.z + Math.cos(yaw) * Math.cos(pitch);
              camera.lookAt(lookX, lookY, lookZ);
            } else if (mode === 'follow' || mode === 'interior') {
              const dist = mode === 'interior' ? 3 : 6;
              const height = mode === 'interior' ? 1.6 : 3.2;
              let cx = pose.x - Math.sin(yaw) * dist * Math.cos(pitch);
              let cy = pose.y + height + Math.sin(-pitch) * dist;
              let cz = pose.z - Math.cos(yaw) * dist * Math.cos(pitch);

              // Camera collision: raycast from chest to desired camera
              // position. If a building is in the way, pull the camera
              // forward to the hit point minus a small offset so we don't
              // see through walls.
              const eyeX = pose.x;
              const eyeY2 = pose.y + 1.4;
              const eyeZ = pose.z;
              const dx = cx - eyeX;
              const dy = cy - eyeY2;
              const dz = cz - eyeZ;
              const desired = Math.hypot(dx, dy, dz);
              if (desired > 0.01) {
                const dirN = { x: dx / desired, y: dy / desired, z: dz / desired };
                cameraRaycaster.set(
                  new THREE.Vector3(eyeX, eyeY2, eyeZ),
                  new THREE.Vector3(dirN.x, dirN.y, dirN.z),
                );
                cameraRaycaster.far = desired;
                const buildingsLayer = layers.buildings;
                if (buildingsLayer) {
                  const hits = cameraRaycaster.intersectObject(buildingsLayer, true);
                  if (hits.length > 0 && hits[0].distance < desired) {
                    const safe = Math.max(0.5, hits[0].distance - 0.3);
                    cx = eyeX + dirN.x * safe;
                    cy = eyeY2 + dirN.y * safe;
                    cz = eyeZ + dirN.z * safe;
                  }
                }
              }

              // Lerp toward target for smooth follow.
              const lerp = Math.min(1, delta * 8);
              camera.position.x += (cx - camera.position.x) * lerp;
              camera.position.y += (cy - camera.position.y) * lerp;
              camera.position.z += (cz - camera.position.z) * lerp;
              // T2.3 — lock-on framing: when a combat target is locked, look at
              // the player→target midpoint (weighted toward the player) instead
              // of straight at the player, so the locked enemy stays framed.
              // Uses the lock position LockOnController already maintains; no
              // lock → unchanged (look at the player).
              const lock = cameraLookState.lockedTargetId ? cameraLookState.lockedTargetPos : null;
              if (lock) {
                const b = 0.4; // bias toward the target (0 = all player)
                camera.lookAt(
                  pose.x + (lock.x - pose.x) * b,
                  (pose.y + 1.4) + ((lock.y ?? pose.y) + 1.0 - (pose.y + 1.4)) * b,
                  pose.z + (lock.z - pose.z) * b,
                );
              } else {
                camera.lookAt(pose.x, pose.y + 1.4, pose.z);
              }
            }
          }
        }

        // Sprint 1 (juice) — apply the camera-punch impulse on top of the base
        // transform. Shake comes from the shared trauma engine (decaying, coherent
        // noise); the brief FOV kick rides the cameraPunchRef window. Read after the
        // camera transform so it layers, not fights it.
        {
          const off = traumaShakeRef.current.update(delta);
          if (off.x || off.y || off.rot) {
            camera.position.x += off.x;
            camera.position.y += off.y;
            camera.position.z += off.x * 0.6; // a touch of dolly so it reads in 3D
            camera.rotation.z += off.rot; // subtle roll sells it
          }
          const punch = cameraPunchRef.current;
          const nowMs = performance.now();
          if (nowMs < punch.until && punch.fov > 0) {
            const remain = (punch.until - nowMs) / Math.max(1, punch.until - punch.start);
            const k = remain * remain; // ease-out (the trauma² falloff)
            const baseFov = 55;
            camera.fov = baseFov - punch.fov * baseFov * k; // brief zoom-in
            camera.updateProjectionMatrix();
          } else if (punch.fov > 0 && Math.abs(camera.fov - 55) > 0.01) {
            // Settle FOV back to base once the punch ends.
            camera.fov = 55;
            camera.updateProjectionMatrix();
          }
        }

        // Phase BE1 — photo-mode freecam. Layer the PhotoMode offsets on top of
        // the base camera transform (positional dolly + yaw rotation + a zoom
        // that maps to FOV). Only active while PhotoMode is open.
        {
          const fc = freecamRef.current;
          if (fc.active) {
            camera.position.x += fc.x;
            camera.position.y += fc.y;
            camera.position.z += fc.z;
            if (fc.yaw) camera.rotation.y += fc.yaw;
            // zoom 0.5..3 → FOV ~75..30 (narrower FOV = zoomed in).
            const fcFov = Math.max(25, Math.min(80, 55 / Math.max(0.5, fc.zoom)));
            if (Math.abs(camera.fov - fcFov) > 0.01) {
              camera.fov = fcFov;
              camera.updateProjectionMatrix();
            }
          }
        }

        // Update weather transition + emit modifiers
        weatherSys.update(delta);
        onWeatherModifiersRef.current?.(weatherSys.getModifiers());

        // Update reflection probes (round-robin LOD)
        if (probeManagerRef.current) {
          probeManagerRef.current.updateLOD(camera.position);
          probeManagerRef.current.update(renderer, []);
        }

        // Update avatars / NPCs / weather / particles per layer
        for (const name of LAYER_NAMES) {
          const group = layers[name];
          if (group && (group.userData as { update?: (d: number, e: number) => void }).update) {
            (group.userData as { update: (d: number, e: number) => void }).update(delta, elapsed);
          }
        }

        // Sprint 7 — drive volumetric fog time uniform if present.
        const volFogAnim = (composerRef.current as unknown as { _volFogAnimate?: () => void } | null)?._volFogAnimate;
        if (volFogAnim) volFogAnim();

        // Phase O — broadcast camera state so R3FOverlayLayer can mirror it.
        // Throttled to ~10 Hz to keep dispatch cheap; overlay's per-frame
        // lookAt() smooths between samples.
        const _now = globalThis.performance.now();
        const _last = (camera as unknown as { __concordLastSync?: number }).__concordLastSync ?? 0;
        if (_now - _last > 100) {
          (camera as unknown as { __concordLastSync?: number }).__concordLastSync = _now;
          const target = new THREE.Vector3();
          camera.getWorldDirection(target);
          target.multiplyScalar(20).add(camera.position);
          try {
            window.dispatchEvent(new CustomEvent('concordia:camera-sync', {
              detail: {
                position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                target:   { x: target.x,         y: target.y,         z: target.z         },
                fov: (camera as unknown as { fov?: number }).fov ?? 55,
              },
            }));
          } catch { /* SSR-safe */ }
        }

        // ── Visual-polish Wave 6: drive cloud-layer animation
        try {
          const clouds = (scene as unknown as { __concordClouds?: { tick: (dt: number) => void } }).__concordClouds;
          if (clouds) clouds.tick(delta);
        } catch { /* noop */ }

        // ── Visual-polish Wave 5: drive motion-blur matrices + chromAb tick + auto-exposure
        try {
          const polish = polishPassesRef.current;
          if (polish?.motionBlur && cameraRef.current) {
            const cam = cameraRef.current as InstanceType<typeof import('three').PerspectiveCamera>;
            const curVP = new THREE.Matrix4()
              .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
            const prevVP = polishMatRef.current.prev ?? curVP.clone();
            polish.motionBlur.setMatrices(prevVP, curVP);
            polishMatRef.current.prev = curVP.clone();
          }
          if (polish?.chromAb) polish.chromAb.tick(globalThis.performance.now());
          if (polish?.autoExposure) {
            polish.autoExposure.tick(
              renderer as unknown as Parameters<typeof polish.autoExposure.tick>[0],
              canvas!.clientWidth,
              canvas!.clientHeight,
            );
          }
        } catch { /* polish passes optional */ }

        // Render: SSGI > EffectComposer > plain renderer
        if (ssgiPassRef.current) {
          ssgiPassRef.current.render(null);
        } else if (composerRef.current) {
          composerRef.current.render(delta);
        } else {
          renderer.render(scene, camera);
        }

        // Phase AA — feed perf-monitor (Stats.js + budget snapshot).
        try {
          attachPerfRenderer(renderer as unknown as { info: { render: { calls: number; triangles: number } } });
          tickPerfMonitor();
        } catch { /* perf-monitor optional */ }

        // Performance budget monitoring
        const info = renderer.info;
        const now = globalThis.performance.now();
        const frameTime = now - lastTime;
        lastTime = now;
        fpsBuffer.push(1000 / frameTime);
        if (fpsBuffer.length > 60) fpsBuffer.shift();

        const avgFps = fpsBuffer.reduce((a, b) => a + b, 0) / fpsBuffer.length;

        // ── G1: frustum + distance culling with CACHED bounding spheres ──
        // Buildings are static placements, so we compute each one's world-space
        // bounding sphere exactly once (on first sight / after addBuilding sets
        // __boundsDirty) and cache it on userData. The per-frame test is then a
        // cheap O(1) frustum.intersectsSphere + squared-distance check — no
        // per-frame setFromObject geometry traversal, so frame cost no longer
        // scales with hidden/complex geometry.
        if (THREE && cameraRef.current && layersRef.current?.buildings) {
          const cam = cameraRef.current as InstanceType<typeof import('three').PerspectiveCamera>;
          cam.updateMatrixWorld();
          const frustum = new THREE.Frustum();
          frustum.setFromProjectionMatrix(
            new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
          );
          const buildingsGroup = layersRef.current.buildings as InstanceType<
            typeof import('three').Group
          >;
          const camPos = cam.position;
          // Hard render distance scales with camera far plane (default 5000).
          const maxDist = Math.min(2200, (cam.far ?? 5000) * 0.5);
          const tmpBox = new THREE.Box3();
          buildingsGroup.children.forEach((obj) => {
            const o = obj as unknown as {
              visible: boolean;
              userData?: Record<string, unknown>;
            };
            if (!o) return;
            const ud = (o.userData ??= {});
            let sphere = ud.__boundsSphere as InstanceType<typeof import('three').Sphere> | undefined;
            if (!sphere || ud.__boundsDirty) {
              tmpBox.setFromObject(obj);
              sphere = new THREE.Sphere();
              tmpBox.getBoundingSphere(sphere);
              ud.__boundsSphere = sphere;
              ud.__boundsDirty = false;
            }
            const inFrustum = frustum.intersectsSphere(sphere);
            const c = sphere.center;
            const dSq = (c.x - camPos.x) ** 2 + (c.y - camPos.y) ** 2 + (c.z - camPos.z) ** 2;
            o.visible = decideVisible(inFrustum, dSq, maxDist);
          });
        }

        // ── Auto-downgrade quality when FPS sustained below 50 ──────
        if (fpsBuffer.length >= 60 && avgFps < 50) {
          lowFpsCountRef.current += 1;
          if (lowFpsCountRef.current >= 3) {
            lowFpsCountRef.current = 0;
            setQuality((prev) => {
              const order: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
              const idx = order.indexOf(prev);
              return idx > 0 ? order[idx - 1] : prev;
            });
          }
        } else {
          lowFpsCountRef.current = 0;
        }

        setPerfBudget({
          drawCalls: info.render.calls,
          maxDrawCalls: settings.maxDrawCalls,
          triangles: info.render.triangles,
          maxTriangles: settings.maxTriangles,
          textureMemory: (info.memory?.textures ?? 0) * 4,
          maxTextureMemory: settings.maxTextureMemory,
          fps: Math.round(avgFps),
          frameTime: Math.round(frameTime * 10) / 10,
        });

        // Telemetry feed for the PerformanceOverlay + server aggregator.
        try {
          window.dispatchEvent(new CustomEvent('concordia:perf-budget', {
            detail: {
              fps: avgFps,
              frameTime,
              drawCalls: info.render.calls,
              triangles: info.render.triangles,
              textureMemory: (info.memory?.textures ?? 0) * 4,
            },
          }));
        } catch { /* event dispatch silent */ }

        frameIdRef.current = requestAnimationFrame(gameLoop);
      }

      frameIdRef.current = requestAnimationFrame(gameLoop);
    }

    init();

    // ── Resize handler ────────────────────────────────────────────
    function handleResize() {
      if (!canvas || disposed) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (rendererRef.current && cameraRef.current) {
        const r = rendererRef.current as InstanceType<typeof import('three').WebGLRenderer>;
        const c = cameraRef.current as InstanceType<typeof import('three').PerspectiveCamera>;
        c.aspect = w / h;
        c.updateProjectionMatrix();
        r.setSize(w, h);
        composerRef.current?.setSize(w, h);
        ssgiPassRef.current?.setSize(w, h);
        // Keep the edge-outline Sobel kernel sampling at the new resolution.
        polishPassesRef.current?.edgeOutline?.setResolution?.(w, h);
      }
    }
    window.addEventListener('resize', handleResize);

    // Sprint 1 (juice) — camera-punch consumer. Sets a decaying impulse the
    // render loop reads after the base camera transform. Locality is already
    // gated by the dispatcher (local_relevance); we honour it here too.
    const handleCameraPunch = (e: Event) => {
      const d = (e as CustomEvent).detail as
        { duration_ms?: number; shake?: number; zoom?: number; local_relevance?: boolean } | undefined;
      if (!d || d.local_relevance === false) return;
      const now = performance.now();
      const dur = Math.max(120, Math.min(2000, Number(d.duration_ms) || 300));
      const shake = Math.max(0, Math.min(12, Number(d.shake) || 4));
      cameraPunchRef.current = {
        start: now,
        until: now + dur,
        shake,
        fov: Math.max(0, Math.min(0.25, (Number(d.zoom) || 1.05) - 1)),
      };
      // Feed the shared trauma engine — normalize the 0–12 shake amplitude to a
      // 0–1 trauma add (a hit ≈ 0.33, a kill/heavy ≈ 0.8+). The engine handles
      // decay + coherent-noise sampling each frame.
      traumaShakeRef.current.addTrauma(shake / 12);
    };
    window.addEventListener('concordia:camera-punch', handleCameraPunch);

    // Phase BE1 — photo-mode freecam consumer. PhotoMode (WASD/QE/RF/wheel)
    // dispatches positional + yaw + zoom offsets; we accumulate them onto a ref
    // the render loop layers on top of the base camera transform. The offsets
    // are absolute (PhotoMode owns the running total), so we just mirror them.
    const handleFreecam = (e: Event) => {
      const d = (e as CustomEvent).detail as
        { x?: number; y?: number; z?: number; yaw?: number; zoom?: number } | undefined;
      if (!d) return;
      freecamRef.current = {
        active: true,
        x: Number(d.x) || 0,
        y: Number(d.y) || 0,
        z: Number(d.z) || 0,
        yaw: Number(d.yaw) || 0,
        zoom: Math.max(0.5, Math.min(3, Number(d.zoom) || 1)),
      };
    };
    // PhotoMode's hide-HUD close re-shows the HUD; reuse it to clear freecam.
    const handleHideHud = (e: Event) => {
      const d = (e as CustomEvent).detail as { hide?: boolean } | undefined;
      if (d && d.hide === false) {
        freecamRef.current = { active: false, x: 0, y: 0, z: 0, yaw: 0, zoom: 1 };
      }
    };
    window.addEventListener('concordia:freecam', handleFreecam);
    window.addEventListener('concordia:hide-hud', handleHideHud);

    // ── Click handler ─────────────────────────────────────────────
    function handleCanvasClick(e: MouseEvent) {
      if (disposed || !THREE) return;
      const rect = canvas!.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const rc = raycasterRef.current as InstanceType<typeof import('three').Raycaster>;
      const cam = cameraRef.current as InstanceType<typeof import('three').PerspectiveCamera>;
      rc.setFromCamera(mouse, cam);

      // Check NPC avatars first — clicking an NPC opens dialogue.
      // AvatarSystem3D tags meshes with userData.isNPC + userData.avatarId.
      // We dispatch a window event so the world page (which owns dialogue
      // state) can react without ConcordiaScene needing to know about it.
      const avatarsGroup = layersRef.current['avatars'] as InstanceType<
        typeof import('three').Group
      > | undefined;
      if (avatarsGroup) {
        const hits = rc.intersectObjects(avatarsGroup.children, true);
        if (hits.length > 0) {
          let obj = hits[0].object as InstanceType<typeof import('three').Object3D>;
          // Walk up to find the avatar root (the group AvatarSystem3D added).
          // Stop when we hit something tagged as either an NPC or another
          // player so the userData lookup below sees the right tags.
          while (
            obj.parent && obj.parent !== avatarsGroup &&
            !(obj.userData as { isNPC?: boolean; isOtherPlayer?: boolean })?.isNPC &&
            !(obj.userData as { isNPC?: boolean; isOtherPlayer?: boolean })?.isOtherPlayer
          ) {
            obj = obj.parent as typeof obj;
          }
          const ud = obj.userData as
            | { isNPC?: boolean; isOtherPlayer?: boolean; avatarId?: string; name?: string; occupation?: string }
            | undefined;
          if (ud?.isNPC && ud.avatarId) {
            // Phase DA1 — NPC click opens a contextual action menu near
            // the cursor; the menu's "Talk" action forwards to dialogue.
            // Backward compat: legacy listeners on concordia:open-dialogue
            // still work via the menu's onTalk callback.
            try {
              window.dispatchEvent(new CustomEvent('concordia:npc-context-menu', {
                detail: {
                  npcId:      ud.avatarId,
                  npcName:    ud.name ?? ud.avatarId,
                  occupation: ud.occupation ?? null,
                  screenX:    e.clientX,
                  screenY:    e.clientY,
                },
              }));
            } catch { /* dispatch best-effort */ }
            return;
          }
          // Other-player click → contextual action menu (Wave / Trade /
          // Inspect / Invite to Party). Dispatched at viewport coords so
          // the menu can position itself near the cursor.
          if (ud?.isOtherPlayer && ud.avatarId) {
            try {
              window.dispatchEvent(new CustomEvent('concordia:click-player', {
                detail: {
                  playerId:   ud.avatarId,
                  playerName: ud.name ?? ud.avatarId,
                  screenX:    e.clientX,
                  screenY:    e.clientY,
                },
              }));
            } catch { /* dispatch best-effort */ }
            return;
          }
        }
      }

      // Check buildings layer next
      const buildingsGroup = layersRef.current['buildings'] as InstanceType<
        typeof import('three').Group
      >;
      if (buildingsGroup) {
        const hits = rc.intersectObjects(buildingsGroup.children, true);
        if (hits.length > 0) {
          const hit = hits[0];
          let obj = hit.object;
          while (obj.parent && obj.parent !== buildingsGroup) obj = obj.parent as typeof obj;
          const buildingId = obj.userData?.buildingId as string | undefined;
          if (buildingId && onBuildingClick) {
            onBuildingClick(buildingId, hit);
            return;
          }
        }
      }

      // Check terrain layer
      const terrainGroup = layersRef.current['terrain'] as InstanceType<
        typeof import('three').Group
      >;
      if (terrainGroup) {
        const hits = rc.intersectObjects(terrainGroup.children, true);
        if (hits.length > 0 && onTerrainClick) {
          const p = hits[0].point;
          onTerrainClick({ x: p.x, y: p.y, z: p.z });
        }
      }
    }
    canvas.addEventListener('click', handleCanvasClick);

    // Right-click → fire concordia:gather-request with the world point.
    // World page handles the network call + inventory update.
    function handleContextMenu(e: MouseEvent) {
      e.preventDefault();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const rc2 = raycasterRef.current as InstanceType<typeof import('three').Raycaster>;
      const cam2 = cameraRef.current as InstanceType<typeof import('three').PerspectiveCamera>;
      rc2.setFromCamera(mouse, cam2);
      const tg = layersRef.current['terrain'] as InstanceType<typeof import('three').Group> | undefined;
      if (!tg) return;
      const hits = rc2.intersectObjects(tg.children, true);
      if (!hits.length) return;
      const p = hits[0].point;
      try {
        window.dispatchEvent(new CustomEvent('concordia:gather-request', {
          detail: { x: p.x, y: p.y, z: p.z },
        }));
      } catch { /* dispatch best-effort */ }
    }
    canvas.addEventListener('contextmenu', handleContextMenu);

    // ── Mouse-look (pointer lock) for follow + first-person ─────
    // Click the canvas to enter pointer lock when in a player-tracking
    // mode; mousemove drives yaw + pitch additive offsets that the game
    // loop applies to the camera. Esc / outside-click releases.
    function maybeRequestPointerLock() {
      const mode = cameraModeRef.current;
      if (mode !== 'follow' && mode !== 'first-person' && mode !== 'interior') return;
      try {
        (canvas as HTMLCanvasElement & { requestPointerLock?: () => void }).requestPointerLock?.();
      } catch { /* pointer lock may be unsupported */ }
    }
    function handleMouseMove(e: MouseEvent) {
      if (document.pointerLockElement !== canvas) return;
      const sens = cameraLookState.sensitivity;
      const yawDelta = -(e.movementX || 0) * sens;
      const pitchDelta = -(e.movementY || 0) * sens;
      cameraLookState.yaw = (cameraLookState.yaw + yawDelta) % (Math.PI * 2);
      cameraLookState.pitch = Math.max(-1.2, Math.min(1.2, cameraLookState.pitch + pitchDelta));
    }
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', maybeRequestPointerLock);
    document.addEventListener('mousemove', handleMouseMove);

    // ── Cleanup ───────────────────────────────────────────────────
    // Capture the stable ref object so the cleanup doesn't read a possibly-changed
    // ref.current (identity is fixed; only its fields mutate).
    const polishMat = polishMatRef.current;
    return () => {
      disposed = true;
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('concordia:camera-punch', handleCameraPunch);
      window.removeEventListener('concordia:freecam', handleFreecam);
      window.removeEventListener('concordia:hide-hud', handleHideHud);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('mousedown', maybeRequestPointerLock);
      document.removeEventListener('mousemove', handleMouseMove);
      try { document.exitPointerLock?.(); } catch { /* no-op */ }

      // Dispose all geometries, materials, and textures in scene
      if (sceneRef.current) {
        const sc = sceneRef.current as InstanceType<typeof import('three').Scene>;
        sc.traverse((obj) => {
          const mesh = obj as unknown as {
            geometry?: { dispose: () => void };
            material?:
              | { dispose: () => void; map?: { dispose: () => void } }
              | { dispose: () => void; map?: { dispose: () => void } }[];
          };
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of materials) {
              if (mat.map) mat.map.dispose();
              mat.dispose();
            }
          }
        });
      }

      try { domeCleanupRef.current?.(); } catch { /* ignore */ }
      domeCleanupRef.current = null;
      try { worldRenderersRef.current?.dispose(); } catch { /* ignore */ }
      worldRenderersRef.current = null;
      try { terrainDeformRef.current?.dispose(); } catch { /* ignore */ }
      terrainDeformRef.current = null;
      try { waterGridRef.current?.dispose(); } catch { /* ignore */ }
      waterGridRef.current = null;

      ssgiPassRef.current?.dispose();
      ssgiPassRef.current = null;
      try {
        polishPassesRef.current?.chromAb?.detach?.();
        polishPassesRef.current?.autoExposure?.dispose();
      } catch { /* idempotent */ }
      polishPassesRef.current = null;
      polishMat.prev = null;
      try {
        const sky = (sceneRef.current as unknown as { __concordSky?: { mesh: unknown; dispose: () => void } } | null)?.__concordSky;
        const clouds = (sceneRef.current as unknown as { __concordClouds?: { mesh: unknown; dispose: () => void } } | null)?.__concordClouds;
        if (sky?.dispose) sky.dispose();
        if (clouds?.dispose) clouds.dispose();
      } catch { /* idempotent */ }
      probeManagerRef.current?.dispose();
      probeManagerRef.current = null;
      weatherSysRef.current = null;

      if (rendererRef.current) {
        (rendererRef.current as { dispose: () => void }).dispose();
      }
      physicsRef.current?.destroy();
      physicsRef.current = null;

      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      layersRef.current = {};
      buildingMap.clear();
      setIsReady(false);
      // Phase J — signal the travel hook that the previous scene is fully
      // disposed so it can safely set activeWorldId + wait for the next
      // scene to mount.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('concordia:scene-disposed'));
        }
      } catch { /* SSR */ }
    };
  }, [districtId, quality, themeProp, renderStyle, onBuildingClick, onTerrainClick]);

  // ── Scene API ──────────────────────────────────────────────────

  const addBuilding = useCallback(
    (buildingGroup: unknown, position: { x: number; y: number; z: number }) => {
      const group = buildingGroup as {
        position: { set: (x: number, y: number, z: number) => void };
        userData?: Record<string, unknown>;
      };
      group.position.set(position.x, position.y, position.z);
      if (!group.userData) (group as { userData: Record<string, unknown> }).userData = {};
      const userData = group.userData as Record<string, unknown>;
      const id = (userData.buildingId as string) ?? `building_${Date.now()}`;
      userData.buildingId = id;
      userData.isBuilding = true;
      // G1 — invalidate the cached bounding sphere so the cull loop recomputes
      // it once (buildings are static, so we never recompute again after that).
      userData.__boundsDirty = true;
      buildingMapRef.current.set(id, buildingGroup);
      const layer = layersRef.current['buildings'] as { add: (child: unknown) => void } | undefined;
      layer?.add(buildingGroup);

      // Register a Rapier collider so the player and NPCs collide with this building.
      const physics = physicsRef.current as
        | { registerBuildingFromObject?: (obj: unknown, id: string) => string | null }
        | null;
      physics?.registerBuildingFromObject?.(group, id);
    },
    []
  );

  const removeBuilding = useCallback((id: string) => {
    const group = buildingMapRef.current.get(id) as
      | {
          parent?: { remove: (child: unknown) => void };
          userData?: Record<string, unknown>;
        }
      | undefined;
    if (group?.parent) {
      group.parent.remove(group);
    }
    const physicsKey = group?.userData?.physicsKey as string | undefined;
    if (physicsKey) {
      const physics = physicsRef.current as
        | { removeBuildingCollider?: (key: string) => void }
        | null;
      physics?.removeBuildingCollider?.(physicsKey);
    }
    buildingMapRef.current.delete(id);
  }, []);

  const setWeather = useCallback((type: string, intensity: number) => {
    weatherSysRef.current?.transitionTo(
      {
        type: type as import('@/lib/world-lens/world-deformation').WeatherType,
        intensity,
        windSpeed: intensity * 8,
        windDir: 0,
        temperature: 15,
        visibility: Math.max(10, 500 - intensity * 450),
      },
      15
    );
  }, []);

  const setTimeOfDay = useCallback((hour: number) => {
    const weatherGroup = layersRef.current['weather'] as
      | { userData: Record<string, unknown> }
      | undefined;
    if (weatherGroup) {
      weatherGroup.userData.timeOfDay = hour;
    }
  }, []);

  const getIntersectedObject = useCallback((screenX: number, screenY: number): unknown | null => {
    if (!raycasterRef.current || !cameraRef.current || !sceneRef.current) return null;
    const rc = raycasterRef.current as {
      setFromCamera: (v: unknown, c: unknown) => void;
      intersectObjects: (o: unknown[], r: boolean) => { object: unknown }[];
    };
    const cam = cameraRef.current;
    const sc = sceneRef.current as { children: unknown[] };
    rc.setFromCamera({ x: screenX, y: screenY }, cam);
    const hits = rc.intersectObjects(sc.children, true);
    return hits.length > 0 ? hits[0].object : null;
  }, []);

  const sceneAPI: ConcordiaSceneAPI = {
    scene: sceneRef.current,
    camera: cameraRef.current,
    addBuilding,
    removeBuilding,
    setWeather,
    setTimeOfDay,
    getIntersectedObject,
  };

  // ── Budget bar helper ──────────────────────────────────────────

  const budgetBar = (label: string, value: number, max: number) => {
    const pct = Math.min(100, (value / max) * 100);
    const color = pct < 60 ? 'bg-green-500' : pct < 85 ? 'bg-yellow-500' : 'bg-red-500';
    return (
      <div key={label} className="flex items-center gap-2 text-[10px]">
        <span className="w-16 text-white/50">{label}</span>
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full ${color} rounded-full transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-20 text-right text-white/40">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────

  // ── Quest marker container ref ──────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  // Lazy import QuestMarker3D to avoid SSR issues
  const [QuestMarker3DComp, setQuestMarker3DComp] = React.useState<React.ComponentType<{
    objectives: import('@/components/world-lens/QuestMarker3D').QuestObjective[];
    containerEl: HTMLElement | null;
  }> | null>(null);
  useEffect(() => {
    import('@/components/world-lens/QuestMarker3D').then((m) => {
      setQuestMarker3DComp(() => m.default as typeof QuestMarker3DComp);
    });
  }, []);

  return (
    <ConcordiaSceneContext.Provider value={sceneAPI}>
      <div ref={containerRef} className="relative" style={{ width, height }}>
        <canvas ref={canvasRef} className="w-full h-full block" style={{ touchAction: 'none' }} />
        {/* 3D quest objective markers — CSS2DRenderer overlay */}
        {QuestMarker3DComp && questObjectives.length > 0 && (
          <QuestMarker3DComp objectives={questObjectives} containerEl={containerRef.current} />
        )}

        {/* Loading overlay */}
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90">
            <div className="text-center space-y-3">
              <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto" />
              <p className="text-white/60 text-sm">Initializing Concordia 3D...</p>
              <p className="text-white/30 text-xs">District: {districtId}</p>
            </div>
          </div>
        )}

        {/* FPS counter */}
        {showFps && (
          <div
            className={`absolute top-2 left-2 p-2 ${panel} text-[10px] font-mono space-y-1 min-w-[200px]`}
          >
            <div className="flex items-center gap-1.5 text-green-400 text-xs font-bold">
              <Activity className="w-3 h-3" />
              {perfBudget.fps} FPS
              <span className="text-white/30 font-normal ml-1">{perfBudget.frameTime}ms</span>
            </div>
            <div className="space-y-0.5 pt-1 border-t border-white/5">
              {budgetBar('Draw calls', perfBudget.drawCalls, perfBudget.maxDrawCalls)}
              {budgetBar('Triangles', perfBudget.triangles, perfBudget.maxTriangles)}
              {budgetBar('Tex Memory', perfBudget.textureMemory, perfBudget.maxTextureMemory)}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={() => setShowFps(!showFps)}
            className={`p-1.5 rounded ${panel} text-white/60 hover:text-white transition-colors`}
            title="Toggle FPS counter"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowQualitySelector(!showQualitySelector)}
              className={`p-1.5 rounded ${panel} text-white/60 hover:text-white transition-colors`}
              title="Quality settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {showQualitySelector && (
              <div className={`absolute right-0 top-full mt-1 ${panel} p-1.5 min-w-[120px] z-50`}>
                <p className="text-[10px] text-white/40 px-2 py-0.5 mb-0.5">Quality Preset</p>
                {(['low', 'medium', 'high', 'ultra'] as QualityPreset[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuality(q);
                      setShowQualitySelector(false);
                    }}
                    className={`block w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                      q === quality
                        ? 'bg-blue-600/40 text-blue-300'
                        : 'text-white/60 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Monitor className="w-3 h-3 inline mr-1.5" />
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ConcordiaSceneContext.Provider>
  );
}
