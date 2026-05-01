'use client';

import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from 'react';
import { Activity, Monitor, Settings } from 'lucide-react';

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
    // Explicit high-end patterns
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
}: ConcordiaSceneProps) {
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
  const [performance, setPerformance] = useState<PerformanceBudget>({
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

      // Listen for terrain-ready to register heightfield collider
      function onTerrainPhysics(e: Event) {
        const { hmData, hmWidth, hmHeight } = (e as CustomEvent).detail ?? {};
        if (hmData) {
          physicsWorld.createHeightfieldCollider(hmData, hmWidth, hmHeight, {
            x: 2000, // TERRAIN_SIZE
            y: 80, // maxElevation
            z: 2000,
          });
        }
      }
      window.addEventListener('concordia:terrain-ready', onTerrainPhysics);

      const settings = QUALITY_SETTINGS[quality];

      // ── Renderer ─────────────────────────────────────────────────
      // Attempt WebGPU first if available, fall back to WebGL2
      let useWebGPU = false;
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
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
        // WebGPU renderer can be loaded dynamically from three/addons when stable
        // For now we use WebGL2 as primary renderer with WebGPU readiness flag
        console.info(
          '[ConcordiaScene] WebGPU adapter found, but using WebGL2 renderer for stability'
        );
      }

      renderer = new THREE.WebGLRenderer({
        canvas: canvas!,
        antialias: settings.antialias,
        powerPreference: 'high-performance',
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
      renderer.setSize(canvas!.clientWidth, canvas!.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
          ssgiPassRef.current = new SSGIPass(
            renderer,
            scene,
            camera,
            canvas!.clientWidth,
            canvas!.clientHeight,
            { intensity: 0.4, numSamples: 8, temporalBlend: 0.1 }
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

      // Expose building lookup for deformation replay
      onSceneReadyRef.current?.((entityId: string) => {
        const obj = buildingMapRef.current.get(entityId);
        return obj as { visible: boolean; userData: Record<string, unknown> } | undefined;
      });

      setIsReady(true);

      // ── Game loop ───────────────────────────────────────────────
      function gameLoop() {
        if (disposed) return;

        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();

        // Step physics simulation
        physicsRef.current?.step(delta);

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

        // Render: SSGI > EffectComposer > plain renderer
        if (ssgiPassRef.current) {
          ssgiPassRef.current.render(null);
        } else if (composerRef.current) {
          composerRef.current.render(delta);
        } else {
          renderer.render(scene, camera);
        }

        // Performance budget monitoring
        const info = renderer.info;
        const now = globalThis.performance.now();
        const frameTime = now - lastTime;
        lastTime = now;
        fpsBuffer.push(1000 / frameTime);
        if (fpsBuffer.length > 60) fpsBuffer.shift();

        const avgFps = fpsBuffer.reduce((a, b) => a + b, 0) / fpsBuffer.length;

        // ── Frustum culling — hide buildings outside camera view ────
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
          const box = new THREE.Box3();
          buildingsGroup.children.forEach((obj) => {
            if (!obj) return;
            box.setFromObject(obj);
            obj.visible = frustum.intersectsBox(box);
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

        setPerformance({
          drawCalls: info.render.calls,
          maxDrawCalls: settings.maxDrawCalls,
          triangles: info.render.triangles,
          maxTriangles: settings.maxTriangles,
          textureMemory: (info.memory?.textures ?? 0) * 4,
          maxTextureMemory: settings.maxTextureMemory,
          fps: Math.round(avgFps),
          frameTime: Math.round(frameTime * 10) / 10,
        });

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
      }
    }
    window.addEventListener('resize', handleResize);

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

      // Check buildings layer first
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

    // ── Cleanup ───────────────────────────────────────────────────
    return () => {
      disposed = true;
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('click', handleCanvasClick);

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

      ssgiPassRef.current?.dispose();
      ssgiPassRef.current = null;
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
              {performance.fps} FPS
              <span className="text-white/30 font-normal ml-1">{performance.frameTime}ms</span>
            </div>
            <div className="space-y-0.5 pt-1 border-t border-white/5">
              {budgetBar('Draw calls', performance.drawCalls, performance.maxDrawCalls)}
              {budgetBar('Triangles', performance.triangles, performance.maxTriangles)}
              {budgetBar('Tex Memory', performance.textureMemory, performance.maxTextureMemory)}
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
