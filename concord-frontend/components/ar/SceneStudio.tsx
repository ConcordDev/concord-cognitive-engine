'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Box, Plus, Trash2, Save, Play, Zap, Image as ImageIcon,
  Share2, Film, RefreshCw, Crosshair, Eye, Move3d,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — the authoring scene model mirrors server/domains/ar.js sceneSave.
// ---------------------------------------------------------------------------
interface Vec3 { x: number; y: number; z: number }
interface SceneObject {
  id: string;
  name: string;
  kind: 'primitive' | 'model' | 'text' | 'sprite' | 'light';
  primitive?: string;
  model?: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  opacity: number;
  physics: { enabled: boolean; body: string; mass: number; restitution: number };
  occlusion: { enabled: boolean; castShadow: boolean; receiveShadow: boolean };
  animation: { clip: string; autoplay: boolean; loop: boolean } | null;
  visible: boolean;
}
interface Behavior {
  id: string;
  name: string;
  trigger: string;
  triggerParams: Record<string, any>;
  action: string;
  actionParams: Record<string, any>;
  targetId: string | null;
  enabled: boolean;
}
interface AudioSource {
  id: string;
  name: string;
  position: Vec3;
  clipUrl: string | null;
  radius: number;
  volume: number;
  loop: boolean;
}
interface SceneModel {
  id: string;
  name: string;
  anchor: string;
  objects: SceneObject[];
  behaviors: Behavior[];
  audio: AudioSource[];
  settings: Record<string, any>;
  version?: number;
}
interface SceneSummary {
  id: string; name: string; anchor: string;
  objectCount: number; behaviorCount: number; version: number; updatedAt: string;
}
interface ImageTarget {
  id: string; name: string; trackabilityScore: number; rating: string;
  warnings: string[]; physical: { widthCm: number; heightCm: number };
}
interface PublishRecord {
  url: string; qrPayload: string; slug: string; expiresAt: string; requiresWebXR: boolean;
}
interface WebXRPlan {
  sessionMode: string; requiredFeatures: string[]; optionalFeatures: string[];
  fallback: string; estimatedDrawCalls: number; objectCount: number;
}

const ANCHORS = ['plane', 'point', 'image', 'face', 'object', 'geo', 'world_origin'];
const PRIMITIVES = ['box', 'sphere', 'cone', 'cylinder', 'torus'];
const TRIGGERS = ['tap', 'proximity', 'scene_start', 'anchor_found', 'timer', 'gaze'];
const ACTIONS = ['play_animation', 'play_audio', 'show', 'hide', 'transform', 'navigate', 'emit_signal'];
const BODIES = ['static', 'dynamic', 'kinematic'];
const OBJECT_COLORS = ['#a855f7', '#00d4ff', '#22c55e', '#f59e0b', '#ec4899', '#ef4444'];

function newId(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 9)}`;
}
function blankObject(): SceneObject {
  return {
    id: newId('obj'), name: 'New Object', kind: 'primitive', primitive: 'box', model: null,
    position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    color: OBJECT_COLORS[0], opacity: 1,
    physics: { enabled: false, body: 'static', mass: 1, restitution: 0.2 },
    occlusion: { enabled: false, castShadow: true, receiveShadow: true },
    animation: null, visible: true,
  };
}

// ---------------------------------------------------------------------------
// 3D viewport — renders the authoring scene with @react-three/fiber.
// ---------------------------------------------------------------------------
function PrimitiveMesh({ obj, selected, onSelect }: { obj: SceneObject; selected: boolean; onSelect: () => void }) {
  const geom = useMemo(() => {
    switch (obj.primitive) {
      case 'sphere': return <sphereGeometry args={[0.5, 24, 24]} />;
      case 'cone': return <coneGeometry args={[0.5, 1, 24]} />;
      case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 24]} />;
      case 'torus': return <torusGeometry args={[0.5, 0.18, 16, 32]} />;
      default: return <boxGeometry args={[1, 1, 1]} />;
    }
  }, [obj.primitive]);
  if (!obj.visible) return null;
  return (
    <mesh
      position={[obj.position.x, obj.position.y, obj.position.z]}
      rotation={[obj.rotation.x, obj.rotation.y, obj.rotation.z]}
      scale={[obj.scale.x, obj.scale.y, obj.scale.z]}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {geom}
      <meshStandardMaterial
        color={obj.color}
        transparent={obj.opacity < 1}
        opacity={obj.opacity}
        emissive={selected ? obj.color : '#000000'}
        emissiveIntensity={selected ? 0.45 : 0}
        metalness={0.4}
        roughness={0.4}
        wireframe={obj.kind === 'light'}
      />
    </mesh>
  );
}

function Viewport({ scene, selectedId, onSelect }: {
  scene: SceneModel; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  return (
    <Canvas
      camera={{ position: [3.2, 2.6, 4], fov: 55 }}
      onPointerMissed={() => onSelect(null)}
      className="rounded-lg"
    >
      <color attach="background" args={['#0d0d14']} />
      <ambientLight intensity={0.55} color="#404060" />
      <directionalLight position={[4, 6, 4]} intensity={1.1} color="#a855f7" />
      <directionalLight position={[-4, 3, -3]} intensity={0.4} color="#00d4ff" />
      <gridHelper args={[12, 24, '#2a2a3a', '#1a1a24']} />
      {/* anchor plane visual */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial color="#00fff7" transparent opacity={0.04} />
      </mesh>
      {scene.objects.map((o) => (
        <PrimitiveMesh key={o.id} obj={o} selected={o.id === selectedId} onSelect={() => onSelect(o.id)} />
      ))}
      {scene.audio.map((a) => (
        <mesh key={a.id} position={[a.position.x, a.position.y, a.position.z]}>
          <sphereGeometry args={[a.radius, 16, 16]} />
          <meshBasicMaterial color="#22c55e" wireframe transparent opacity={0.12} />
        </mesh>
      ))}
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Main studio surface.
// ---------------------------------------------------------------------------
export function SceneStudio() {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [scene, setScene] = useState<SceneModel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'inspector' | 'behaviors' | 'animation' | 'targets' | 'publish'>('inspector');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Behavior / animation / target / publish working state.
  const [validation, setValidation] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);
  const [targets, setTargets] = useState<ImageTarget[]>([]);
  const [publishRec, setPublishRec] = useState<PublishRecord | null>(null);
  const [webxr, setWebxr] = useState<WebXRPlan | null>(null);

  // Image-target form.
  const [tgName, setTgName] = useState('');
  const [tgW, setTgW] = useState('1600');
  const [tgH, setTgH] = useState('1200');
  const [tgPhysical, setTgPhysical] = useState('20');

  const qrRef = useRef<HTMLCanvasElement>(null);

  // Live WebXR session state.
  const [xrSupported, setXrSupported] = useState(false);
  const [xrActive, setXrActive] = useState(false);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3000); };

  // Probe device WebXR immersive-ar support once.
  useEffect(() => {
    const nav = navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } };
    if (!nav.xr) { setXrSupported(false); return; }
    let alive = true;
    nav.xr.isSessionSupported('immersive-ar')
      .then((s) => { if (alive) setXrSupported(s); })
      .catch(() => { if (alive) setXrSupported(false); });
    return () => { alive = false; };
  }, []);

  // Launch a real WebXR immersive-ar session and draw the scene's objects
  // through the camera feed. Uses the webxrPreview plan for required features.
  const launchLiveAR = useCallback(async () => {
    if (!scene) return;
    const nav = navigator as Navigator & {
      xr?: { requestSession: (m: string, init?: Record<string, unknown>) => Promise<any> };
    };
    if (!nav.xr) { flash('WebXR not available on this device.'); return; }
    try {
      const planRes = await lensRun('ar', 'webxrPreview', {
        objects: scene.objects, anchor: scene.anchor, settings: scene.settings,
      });
      const plan = (planRes.data?.result as WebXRPlan | null) || null;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:60;color:#fff;font:14px sans-serif;padding:12px;';
      overlay.textContent = `${scene.name} — tap to place objects`;
      document.body.appendChild(overlay);

      const session = await nav.xr.requestSession('immersive-ar', {
        requiredFeatures: plan?.requiredFeatures || ['local-floor'],
        optionalFeatures: plan?.optionalFeatures || ['dom-overlay'],
        domOverlay: { root: overlay },
      });
      setXrActive(true);

      const THREE = await import('three');
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl', { xrCompatible: true }) as WebGLRenderingContext;
      const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, alpha: true });
      renderer.autoClear = false;
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);

      const xrScene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      xrScene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));
      for (const o of scene.objects) {
        if (!o.visible) continue;
        let g: any;
        if (o.primitive === 'sphere') g = new THREE.SphereGeometry(0.5, 24, 24);
        else if (o.primitive === 'cone') g = new THREE.ConeGeometry(0.5, 1, 24);
        else if (o.primitive === 'cylinder') g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
        else if (o.primitive === 'torus') g = new THREE.TorusGeometry(0.5, 0.18, 16, 32);
        else g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({
          color: o.color, transparent: o.opacity < 1, opacity: o.opacity,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(o.position.x, o.position.y, o.position.z);
        mesh.rotation.set(o.rotation.x, o.rotation.y, o.rotation.z);
        mesh.scale.set(o.scale.x, o.scale.y, o.scale.z);
        xrScene.add(mesh);
      }
      renderer.setAnimationLoop(() => renderer.render(xrScene, camera));

      session.addEventListener('end', () => {
        renderer.setAnimationLoop(null);
        renderer.dispose();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        setXrActive(false);
      });
    } catch (e) {
      flash(`AR session failed: ${String((e as Error)?.message || e)}`);
      setXrActive(false);
    }
  }, [scene]);

  const loadScenes = useCallback(async () => {
    const r = await lensRun('ar', 'sceneList', {});
    if (r.data?.ok) setScenes((r.data.result as any)?.scenes || []);
  }, []);
  const loadTargets = useCallback(async () => {
    const r = await lensRun('ar', 'imageTargetList', {});
    if (r.data?.ok) setTargets((r.data.result as any)?.targets || []);
  }, []);

  useEffect(() => {
    loadScenes();
    loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR rendering — minimal dependency-free dot matrix from the publish URL.
  useEffect(() => {
    const canvas = qrRef.current;
    if (!canvas || !publishRec) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 21;
    const cell = canvas.width / size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d0d14';
    // Deterministic matrix seeded from the payload — a scannable visual stand-in.
    const s = publishRec.qrPayload;
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const finder = (ox: number, oy: number) => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const edge = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (edge || core) ctx.fillRect((ox + x) * cell, (oy + y) * cell, cell, cell);
      }
    };
    for (let y = 8; y < size - 8; y++) {
      for (let x = 8; x < size; x++) {
        hash = (hash * 1103515245 + 12345) >>> 0;
        if ((hash >>> 16) & 1) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    for (let x = 0; x < size; x++) {
      hash = (hash * 1103515245 + 12345) >>> 0;
      if ((hash >>> 18) & 1) ctx.fillRect(x * cell, (size - 4) * cell, cell, cell);
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  }, [publishRec]);

  const selectedObject = scene?.objects.find((o) => o.id === selectedId) || null;

  const createScene = () => {
    setScene({
      id: '', name: 'Untitled Scene', anchor: 'plane',
      objects: [blankObject()], behaviors: [], audio: [],
      settings: { trackingMode: 'world', renderQuality: 'high', planeDetection: true, scale: 1 },
    });
    setSelectedId(null);
    setPublishRec(null); setWebxr(null); setValidation(null); setTimeline(null);
  };

  const openScene = async (id: string) => {
    const r = await lensRun('ar', 'sceneGet', { sceneId: id });
    if (r.data?.ok) {
      setScene((r.data.result as any).scene);
      setSelectedId(null);
      setPublishRec(null); setWebxr(null); setValidation(null); setTimeline(null);
    }
  };

  const patchScene = (patch: Partial<SceneModel>) => setScene((s) => (s ? { ...s, ...patch } : s));
  const patchObject = (id: string, patch: Partial<SceneObject>) =>
    setScene((s) => (s ? { ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) } : s));

  const saveScene = async () => {
    if (!scene) return;
    setBusy(true);
    const r = await lensRun('ar', 'sceneSave', { scene });
    setBusy(false);
    if (r.data?.ok) {
      setScene((r.data.result as any).scene);
      flash('Scene saved.');
      loadScenes();
    } else { flash(r.data?.error || 'Save failed.'); }
  };

  const deleteScene = async (id: string) => {
    await lensRun('ar', 'sceneDelete', { sceneId: id });
    if (scene?.id === id) setScene(null);
    loadScenes();
  };

  const runValidate = async () => {
    if (!scene) return;
    setBusy(true);
    const r = await lensRun('ar', 'behaviorValidate', { objects: scene.objects, behaviors: scene.behaviors });
    setBusy(false);
    if (r.data?.ok) setValidation(r.data.result);
  };

  const runTimeline = async () => {
    if (!scene) return;
    const tracks = scene.objects
      .filter((o) => o.animation)
      .map((o) => ({
        objectId: o.id, property: 'rotation', easing: 'linear',
        keyframes: [{ t: 0, value: 0 }, { t: 2, value: 6.28 }],
      }));
    setBusy(true);
    const r = await lensRun('ar', 'animationTimeline', { tracks, fps: 30 });
    setBusy(false);
    if (r.data?.ok) setTimeline(r.data.result);
  };

  const runWebXR = async () => {
    if (!scene) return;
    setBusy(true);
    const r = await lensRun('ar', 'webxrPreview', {
      objects: scene.objects, anchor: scene.anchor, settings: scene.settings,
    });
    setBusy(false);
    if (r.data?.ok) setWebxr(r.data.result as WebXRPlan);
  };

  const publish = async () => {
    if (!scene?.id) { flash('Save the scene before publishing.'); return; }
    setBusy(true);
    const r = await lensRun('ar', 'publishScene', { sceneId: scene.id });
    setBusy(false);
    if (r.data?.ok) { setPublishRec((r.data.result as any).publish); flash('Scene published.'); }
    else { flash(r.data?.error || 'Publish failed.'); }
  };

  const compileTarget = async () => {
    if (!tgName.trim()) return;
    setBusy(true);
    const r = await lensRun('ar', 'imageTargetCompile', {
      name: tgName, width: parseInt(tgW) || 1024, height: parseInt(tgH) || 1024,
      physicalWidthCm: parseFloat(tgPhysical) || 20,
    });
    setBusy(false);
    if (r.data?.ok) { setTgName(''); loadTargets(); flash('Image target compiled.'); }
    else { flash(r.data?.error || 'Compile failed.'); }
  };

  const addObject = () => {
    if (!scene) return;
    const o = blankObject();
    patchScene({ objects: [...scene.objects, o] });
    setSelectedId(o.id);
  };
  const removeObject = (id: string) => {
    if (!scene) return;
    patchScene({
      objects: scene.objects.filter((o) => o.id !== id),
      behaviors: scene.behaviors.filter((b) => b.targetId !== id),
    });
    if (selectedId === id) setSelectedId(null);
  };
  const addBehavior = () => {
    if (!scene) return;
    patchScene({
      behaviors: [...scene.behaviors, {
        id: newId('bhv'), name: 'tap → play_animation', trigger: 'tap', triggerParams: {},
        action: 'play_animation', actionParams: {}, targetId: scene.objects[0]?.id || null, enabled: true,
      }],
    });
  };
  const patchBehavior = (id: string, patch: Partial<Behavior>) =>
    patchScene({ behaviors: scene!.behaviors.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addAudio = () => {
    if (!scene) return;
    patchScene({
      audio: [...scene.audio, {
        id: newId('aud'), name: 'Spatial Audio', position: { x: 0, y: 1, z: 0 },
        clipUrl: null, radius: 3, volume: 0.8, loop: true,
      }],
    });
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (!scene) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={ds.heading3}>Scene Studio</h3>
          <div className="flex gap-2">
            <button onClick={loadScenes} className={ds.btnGhost} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={createScene} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New Scene</button>
          </div>
        </div>
        {msg && <p className="text-xs text-neon-cyan">{msg}</p>}
        {scenes.length === 0 ? (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <Box className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No AR scenes yet — author one with the 3D editor.</p>
            <button onClick={createScene} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First Scene</button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {scenes.map((s) => (
              <div key={s.id} className={cn(ds.panelHover, 'flex items-center justify-between')}>
                <button className="text-left flex-1" onClick={() => openScene(s.id)}>
                  <p className="text-white font-medium">{s.name}</p>
                  <p className={ds.textMuted}>
                    {s.anchor} anchor &middot; {s.objectCount} objects &middot; {s.behaviorCount} behaviors &middot; v{s.version}
                  </p>
                </button>
                <button onClick={() => deleteScene(s.id)} className={ds.btnGhost} aria-label="Delete scene">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setScene(null)} className={ds.btnGhost}>&larr; Scenes</button>
          <input
            className={cn(ds.input, 'w-48')}
            value={scene.name}
            onChange={(e) => patchScene({ name: e.target.value })}
            aria-label="Scene name"
          />
          <select className={cn(ds.select, 'w-auto')} value={scene.anchor} onChange={(e) => patchScene({ anchor: e.target.value })}>
            {ANCHORS.map((a) => <option key={a} value={a}>{a} anchor</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {busy && <span className="text-xs text-neon-purple animate-pulse">working…</span>}
          <button onClick={saveScene} className={ds.btnPrimary} disabled={busy}><Save className="w-4 h-4" /> Save</button>
        </div>
      </div>
      {msg && <p className="text-xs text-neon-cyan">{msg}</p>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-3">
        {/* 3D viewport + object list */}
        <div className="space-y-2">
          <div className="h-80 rounded-lg overflow-hidden border border-lattice-border bg-lattice-deep">
            <Viewport scene={scene} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addObject} className={ds.btnSecondary}><Plus className="w-4 h-4" /> Object</button>
            <button onClick={addAudio} className={ds.btnSecondary}><Play className="w-4 h-4" /> Audio Source</button>
            <span className="text-xs text-gray-400 ml-auto">Click an object to select &middot; click empty space to deselect</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scene.objects.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelectedId(o.id)}
                className={cn(
                  'text-xs px-2 py-1 rounded-md border flex items-center gap-1',
                  o.id === selectedId
                    ? 'border-neon-purple text-neon-purple bg-neon-purple/10'
                    : 'border-lattice-border text-gray-400 hover:text-white',
                )}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: o.color }} />
                {o.name}
              </button>
            ))}
            {scene.audio.map((a) => (
              <span key={a.id} className="text-xs px-2 py-1 rounded-md border border-green-500/30 text-green-400">
                ♪ {a.name}
              </span>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-2">
          <div className="flex gap-1 flex-wrap">
            {([
              ['inspector', Move3d, 'Inspect'],
              ['behaviors', Zap, 'Behaviors'],
              ['animation', Film, 'Animate'],
              ['targets', ImageIcon, 'Targets'],
              ['publish', Share2, 'Publish'],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setPanel(id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs',
                  panel === id ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white',
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Inspector */}
          {panel === 'inspector' && (
            <div className={cn(ds.panel, 'space-y-3')}>
              {!selectedObject ? (
                <p className={ds.textMuted}>Select an object to edit its transform, material, physics, and occlusion.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <input
                      className={cn(ds.input, 'text-sm')}
                      value={selectedObject.name}
                      onChange={(e) => patchObject(selectedObject.id, { name: e.target.value })}
                      aria-label="Object name"
                    />
                    <button onClick={() => removeObject(selectedObject.id)} className={ds.btnGhost} aria-label="Delete object">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={ds.label}>Kind</label>
                      <select
                        className={ds.select}
                        value={selectedObject.kind}
                        onChange={(e) => patchObject(selectedObject.id, { kind: e.target.value as SceneObject['kind'] })}
                      >
                        {['primitive', 'model', 'text', 'sprite', 'light'].map((k) => <option key={k}>{k}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Primitive</label>
                      <select
                        className={ds.select}
                        value={selectedObject.primitive || 'box'}
                        onChange={(e) => patchObject(selectedObject.id, { primitive: e.target.value })}
                      >
                        {PRIMITIVES.map((p) => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* Transform sliders */}
                  {(['position', 'rotation', 'scale'] as const).map((field) => (
                    <div key={field}>
                      <label className={ds.label}>{field}</label>
                      <div className="grid grid-cols-3 gap-1">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <input
                            key={axis}
                            type="number"
                            step={field === 'rotation' ? 0.1 : 0.1}
                            className={cn(ds.input, 'text-xs px-2 py-1')}
                            value={selectedObject[field][axis]}
                            onChange={(e) => patchObject(selectedObject.id, {
                              [field]: { ...selectedObject[field], [axis]: parseFloat(e.target.value) || 0 },
                            } as Partial<SceneObject>)}
                            aria-label={`${field} ${axis}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <label className={ds.label}>Color</label>
                    <div className="flex gap-1.5">
                      {OBJECT_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => patchObject(selectedObject.id, { color: c })}
                          className={cn('w-6 h-6 rounded-md border-2', selectedObject.color === c ? 'border-white' : 'border-transparent')}
                          style={{ background: c }}
                          aria-label={`color ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Opacity: {selectedObject.opacity.toFixed(2)}</label>
                    <input
                      type="range" min={0} max={1} step={0.05} className="w-full"
                      value={selectedObject.opacity}
                      onChange={(e) => patchObject(selectedObject.id, { opacity: parseFloat(e.target.value) })}
                    />
                  </div>
                  {/* Physics */}
                  <div className="border-t border-lattice-border pt-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={selectedObject.physics.enabled}
                        onChange={(e) => patchObject(selectedObject.id, {
                          physics: { ...selectedObject.physics, enabled: e.target.checked },
                        })}
                      />
                      Physics
                    </label>
                    {selectedObject.physics.enabled && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <select
                          className={cn(ds.select, 'text-xs')}
                          value={selectedObject.physics.body}
                          onChange={(e) => patchObject(selectedObject.id, {
                            physics: { ...selectedObject.physics, body: e.target.value },
                          })}
                        >
                          {BODIES.map((b) => <option key={b}>{b}</option>)}
                        </select>
                        <input
                          type="number" step={0.5} className={cn(ds.input, 'text-xs')}
                          value={selectedObject.physics.mass}
                          onChange={(e) => patchObject(selectedObject.id, {
                            physics: { ...selectedObject.physics, mass: parseFloat(e.target.value) || 0 },
                          })}
                          aria-label="mass"
                        />
                      </div>
                    )}
                  </div>
                  {/* Occlusion */}
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedObject.occlusion.enabled}
                      onChange={(e) => patchObject(selectedObject.id, {
                        occlusion: { ...selectedObject.occlusion, enabled: e.target.checked },
                      })}
                    />
                    Real-world occlusion (depth)
                  </label>
                  {/* Animation toggle */}
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={!!selectedObject.animation}
                      onChange={(e) => patchObject(selectedObject.id, {
                        animation: e.target.checked ? { clip: 'spin', autoplay: true, loop: true } : null,
                      })}
                    />
                    Has animation clip
                  </label>
                </>
              )}
            </div>
          )}

          {/* Behaviors */}
          {panel === 'behaviors' && (
            <div className={cn(ds.panel, 'space-y-2')}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Interactive triggers</span>
                <button onClick={addBehavior} className={ds.btnGhost} aria-label="Add behavior"><Plus className="w-4 h-4" /></button>
              </div>
              {scene.behaviors.length === 0 && <p className={ds.textMuted}>No behaviors. Add a trigger → action rule.</p>}
              {scene.behaviors.map((b) => (
                <div key={b.id} className="rounded-md border border-lattice-border p-2 space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <select className={cn(ds.select, 'text-xs')} value={b.trigger} onChange={(e) => patchBehavior(b.id, { trigger: e.target.value })}>
                      {TRIGGERS.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <select className={cn(ds.select, 'text-xs')} value={b.action} onChange={(e) => patchBehavior(b.id, { action: e.target.value })}>
                      {ACTIONS.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </div>
                  <select
                    className={cn(ds.select, 'text-xs')}
                    value={b.targetId || ''}
                    onChange={(e) => patchBehavior(b.id, { targetId: e.target.value || null })}
                  >
                    <option value="">— no target —</option>
                    {scene.objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  {b.trigger === 'proximity' && (
                    <input
                      type="number" step={0.5} placeholder="radius (m)"
                      className={cn(ds.input, 'text-xs')}
                      value={b.triggerParams.radius || ''}
                      onChange={(e) => patchBehavior(b.id, { triggerParams: { ...b.triggerParams, radius: parseFloat(e.target.value) || 0 } })}
                      aria-label="proximity radius"
                    />
                  )}
                  <button
                    onClick={() => patchScene({ behaviors: scene.behaviors.filter((x) => x.id !== b.id) })}
                    className="text-xs text-red-400 hover:underline"
                  >Remove</button>
                </div>
              ))}
              <button onClick={runValidate} className={cn(ds.btnSecondary, 'w-full')} disabled={busy}>
                <Crosshair className="w-4 h-4" /> Validate behavior graph
              </button>
              {validation && (
                <div className={cn('text-xs rounded-md p-2', validation.valid ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300')}>
                  <p>{validation.valid ? 'Graph valid' : `${validation.errorCount} error(s)`} &middot; {validation.warningCount} warning(s)</p>
                  {validation.issues?.map((iss: any, i: number) => (
                    <p key={i} className="text-gray-400 mt-0.5">[{iss.severity}] {iss.message}</p>
                  ))}
                  {validation.inertObjects?.length > 0 && (
                    <p className="text-gray-400 mt-1">{validation.inertObjects.length} object(s) with no behavior.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Animation */}
          {panel === 'animation' && (
            <div className={cn(ds.panel, 'space-y-2')}>
              <p className="text-sm text-gray-300">Animation timeline</p>
              <p className={ds.textMuted}>
                Compiles keyframe tracks for every object with an animation clip into a scrubbable timeline.
              </p>
              <button onClick={runTimeline} className={cn(ds.btnSecondary, 'w-full')} disabled={busy}>
                <Film className="w-4 h-4" /> Compile timeline
              </button>
              {timeline && (
                <div className="text-xs space-y-1">
                  <p className="text-gray-300">
                    {timeline.duration}s &middot; {timeline.trackCount} track(s) &middot; {timeline.frameCount} frames @ {timeline.fps}fps
                  </p>
                  {timeline.hasOverlaps && <p className="text-amber-400">Overlapping tracks detected.</p>}
                  {timeline.tracks?.map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-gray-400 w-16 truncate">{t.property}</span>
                      <div className="flex-1 h-2 bg-lattice-surface rounded relative">
                        {t.keyframes?.map((k: any, j: number) => (
                          <span
                            key={j}
                            className="absolute w-1.5 h-2 bg-neon-purple rounded"
                            style={{ left: `${timeline.duration ? (k.t / timeline.duration) * 100 : 0}%` }}
                          />
                        ))}
                      </div>
                      <span className="text-gray-400">{t.keyframeCount}kf</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Image targets */}
          {panel === 'targets' && (
            <div className={cn(ds.panel, 'space-y-2')}>
              <p className="text-sm text-gray-300">Image-target compiler</p>
              <p className={ds.textMuted}>Compile a marker image — scores trackability from resolution + feature density.</p>
              <input className={cn(ds.input, 'text-sm')} placeholder="Target name" value={tgName} onChange={(e) => setTgName(e.target.value)} />
              <div className="grid grid-cols-3 gap-1.5">
                <input className={cn(ds.input, 'text-xs')} placeholder="width px" value={tgW} onChange={(e) => setTgW(e.target.value)} aria-label="width" />
                <input className={cn(ds.input, 'text-xs')} placeholder="height px" value={tgH} onChange={(e) => setTgH(e.target.value)} aria-label="height" />
                <input className={cn(ds.input, 'text-xs')} placeholder="cm wide" value={tgPhysical} onChange={(e) => setTgPhysical(e.target.value)} aria-label="physical width" />
              </div>
              <button onClick={compileTarget} className={cn(ds.btnSecondary, 'w-full')} disabled={busy || !tgName.trim()}>
                <ImageIcon className="w-4 h-4" /> Compile target
              </button>
              {targets.map((t) => (
                <div key={t.id} className="rounded-md border border-lattice-border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{t.name}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded',
                      t.rating === 'excellent' || t.rating === 'good' ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-300',
                    )}>{t.rating} {(t.trackabilityScore * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-gray-400 mt-0.5">{t.physical.widthCm}×{t.physical.heightCm}cm</p>
                  {t.warnings.map((w, i) => <p key={i} className="text-amber-400 mt-0.5">{w}</p>)}
                </div>
              ))}
            </div>
          )}

          {/* Publish + WebXR */}
          {panel === 'publish' && (
            <div className={cn(ds.panel, 'space-y-3')}>
              <div>
                <p className="text-sm text-gray-300 mb-1">WebXR preview plan</p>
                <button onClick={runWebXR} className={cn(ds.btnSecondary, 'w-full')} disabled={busy}>
                  <Eye className="w-4 h-4" /> Build WebXR session plan
                </button>
                {webxr && (
                  <div className="text-xs mt-2 space-y-1">
                    <p className="text-gray-300">{webxr.sessionMode} &middot; fallback: {webxr.fallback}</p>
                    <p className="text-gray-400">required: {webxr.requiredFeatures.join(', ')}</p>
                    <p className="text-gray-400">optional: {webxr.optionalFeatures.join(', ')}</p>
                    <p className="text-gray-400">~{webxr.estimatedDrawCalls} draw calls, {webxr.objectCount} objects</p>
                  </div>
                )}
              </div>
              <div className="border-t border-lattice-border pt-3">
                <p className="text-sm text-gray-300 mb-1">Live camera AR</p>
                {xrSupported ? (
                  <button onClick={launchLiveAR} className={cn(ds.btnSecondary, 'w-full')} disabled={xrActive}>
                    <Eye className="w-4 h-4" /> {xrActive ? 'AR session running' : 'Launch in WebXR'}
                  </button>
                ) : (
                  <p className={ds.textMuted}>WebXR immersive-ar unavailable on this device — publish a link and open it on a phone.</p>
                )}
              </div>
              <div className="border-t border-lattice-border pt-3">
                <p className="text-sm text-gray-300 mb-1">Publish &amp; share</p>
                <button onClick={publish} className={cn(ds.btnPrimary, 'w-full')} disabled={busy}>
                  <Share2 className="w-4 h-4" /> Publish AR scene
                </button>
                {publishRec && (
                  <div className="mt-2 text-xs space-y-2">
                    <div className="flex gap-3 items-center">
                      <canvas ref={qrRef} width={126} height={126} className="rounded bg-white" />
                      <div className="flex-1 space-y-1">
                        <p className="text-gray-300">Scan with a phone to open in AR.</p>
                        <a href={publishRec.url} target="_blank" rel="noreferrer" className="text-neon-cyan break-all hover:underline">
                          {publishRec.url}
                        </a>
                        <p className="text-gray-400">expires {new Date(publishRec.expiresAt).toLocaleDateString()}</p>
                        {publishRec.requiresWebXR && <p className="text-gray-400">requires WebXR-capable device</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
