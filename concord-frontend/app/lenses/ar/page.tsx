'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Glasses, Camera, Settings2, Layers, Eye, Plus,
  Search, Trash2, X, BarChart3, Zap, ChevronDown, Box,
  MapPin, Globe, Monitor,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { SketchfabModels } from '@/components/ar/SketchfabModels';
import { SceneStudio } from '@/components/ar/SceneStudio';

type ModeTab = 'scenes' | 'layers' | 'anchors' | 'models' | 'configs' | 'captures';
type ArtifactType = 'Scene' | 'Layer' | 'Anchor' | 'Model3D' | 'Config' | 'Capture';
type Status = 'active' | 'inactive' | 'rendering' | 'published' | 'draft' | 'archived';

interface ARArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  layerType?: string; opacity?: number; visible?: boolean; zIndex?: number;
  trackingMode?: string; renderQuality?: string; dtuDensity?: number;
  position?: string; rotation?: string; scale?: number;
  format?: string; fileSize?: string; polyCount?: number;
  resolution?: string; fps?: number; codec?: string;
  anchorType?: string; surfaceType?: string; confidence?: number;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Glasses; artifactType: ArtifactType }[] = [
  { id: 'scenes', label: 'Scenes', icon: Globe, artifactType: 'Scene' },
  { id: 'layers', label: 'Layers', icon: Layers, artifactType: 'Layer' },
  { id: 'anchors', label: 'Anchors', icon: MapPin, artifactType: 'Anchor' },
  { id: 'models', label: '3D Models', icon: Box, artifactType: 'Model3D' },
  { id: 'configs', label: 'Configs', icon: Settings2, artifactType: 'Config' },
  { id: 'captures', label: 'Captures', icon: Camera, artifactType: 'Capture' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' }, inactive: { label: 'Inactive', color: 'gray-400' },
  rendering: { label: 'Rendering', color: 'blue-400' }, published: { label: 'Published', color: 'emerald-400' },
  draft: { label: 'Draft', color: 'yellow-400' }, archived: { label: 'Archived', color: 'gray-400' },
};

const LAYER_TYPES = ['DTU Overlay', 'Resonance Field', 'Lattice Grid', 'Temporal Markers', 'Spatial Audio', 'Data Visualization', 'Navigation', 'Custom'];
const TRACKING_MODES = ['World', 'Face', 'Image', 'Object', 'Body', 'Geo'];
const RENDER_QUALITIES = ['Low', 'Medium', 'High', 'Ultra'];
const ANCHOR_TYPES = ['Plane', 'Point', 'Image', 'Face', 'Object', 'Geo'];
const MODEL_FORMATS = ['GLTF', 'GLB', 'USDZ', 'OBJ', 'FBX', 'STL'];

export default function ARLensPage() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },
    ],
    { lensId: "ar" }
  );

  useLensNav('ar');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('ar');

  const [activeTab, setActiveTab] = useState<ModeTab>('scenes');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ARArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showStudio, setShowStudio] = useState(true);
  const [showFeatures, setShowFeatures] = useState(true);
  const [arEnabled, setArEnabled] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formLayerType, setFormLayerType] = useState(LAYER_TYPES[0]);
  const [formOpacity, setFormOpacity] = useState('75');
  const [formTrackingMode, setFormTrackingMode] = useState(TRACKING_MODES[0]);
  const [formRenderQuality, setFormRenderQuality] = useState(RENDER_QUALITIES[1]);
  const [formDtuDensity, setFormDtuDensity] = useState('50');
  const [formPosition, setFormPosition] = useState('');
  const [formRotation, setFormRotation] = useState('');
  const [formScale, setFormScale] = useState('1');
  const [formFormat, setFormFormat] = useState(MODEL_FORMATS[0]);
  const [formPolyCount, setFormPolyCount] = useState('');
  const [formResolution, setFormResolution] = useState('1920x1080');
  const [formFps, setFormFps] = useState('60');
  const [formAnchorType, setFormAnchorType] = useState(ANCHOR_TYPES[0]);
  const [formConfidence, setFormConfidence] = useState('');
  const [formZIndex, setFormZIndex] = useState('0');

  // Three.js viewport
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<unknown>(null);
  const animFrameRef = useRef<number>(0);

  // ar.render descriptor (drawList + WebXR session plan) + immersive-ar capability.
  interface RenderDrawItem { id?: string; kind?: string; model?: string | null; transform?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; scale?: number }; opacity?: number; color?: string }
  interface RenderPlan { sessionMode?: string; requiredFeatures?: string[]; optionalFeatures?: string[]; referenceSpace?: string; drawList?: RenderDrawItem[]; objectCount?: number; assets?: string[]; inlineFallback?: boolean; title?: string }
  const [renderPlan, setRenderPlan] = useState<RenderPlan | null>(null);
  const [arSupported, setArSupported] = useState(false);
  const renderPlanRef = useRef<RenderPlan | null>(null);
  renderPlanRef.current = renderPlan;

  // Feature-detect immersive-ar once (WebXR needs a secure context; defaults to `self`).
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported('immersive-ar').then((ok) => setArSupported(!!ok)).catch(() => setArSupported(false));
  }, []);

  useEffect(() => {
    if (!arEnabled || !viewportRef.current) {
      return;
    }

    const container = viewportRef.current;
    let disposed = false;

    const initThree = async () => {
      const THREE = await import('three');

      if (disposed || !container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d0d14); // lattice-deep

      // Camera
      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
      camera.position.set(0, 1.5, 4);
      camera.lookAt(0, 0, 0);

      // Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lights
      const ambient = new THREE.AmbientLight(0x404060, 0.6);
      scene.add(ambient);

      const dirLight = new THREE.DirectionalLight(0xa855f7, 1.2); // neon-purple tinted
      dirLight.position.set(3, 5, 4);
      scene.add(dirLight);

      const fillLight = new THREE.DirectionalLight(0x00d4ff, 0.4); // neon-blue
      fillLight.position.set(-3, 2, -2);
      scene.add(fillLight);

      // Renderables: when ar.render produced a drawList, render those real objects;
      // otherwise show the idle demo knot. Track disposables either way.
      const disposables: { dispose: () => void }[] = [];
      const spin: { obj: { rotation: { x: number; y: number } }; sx: number; sy: number }[] = [];
      const plan = renderPlanRef.current;
      const drawList = Array.isArray(plan?.drawList) ? plan!.drawList! : [];
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

      // Grid helper for ground reference
      const gridHelper = new THREE.GridHelper(10, 20, 0x2a2a3a, 0x1a1a24);
      gridHelper.position.y = -1.5;
      scene.add(gridHelper);

      // Subtle wireframe sphere for AR-like atmosphere
      const sphereGeo = new THREE.IcosahedronGeometry(3, 1);
      const wireframeMat = new THREE.MeshBasicMaterial({
        color: 0x00fff7, // neon-cyan
        wireframe: true,
        transparent: true,
        opacity: 0.06,
      });
      const wireSphere = new THREE.Mesh(sphereGeo, wireframeMat);
      scene.add(wireSphere);

      // Mouse interaction (simple orbit via pointer)
      let mouseX = 0;
      let mouseY = 0;
      const onPointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      };
      container.addEventListener('pointermove', onPointerMove);

      // Animation loop
      const clock = new THREE.Clock();
      const animate = () => {
        if (disposed) return;
        animFrameRef.current = requestAnimationFrame(animate);

        const elapsed = clock.getElapsedTime();

        for (const s of spin) { s.obj.rotation.x = elapsed * s.sx; s.obj.rotation.y = elapsed * s.sy; }

        wireSphere.rotation.y = elapsed * 0.1;
        wireSphere.rotation.x = elapsed * 0.05;

        // Gentle camera orbit influenced by mouse
        camera.position.x = 4 * Math.sin(elapsed * 0.2) + mouseX * 1.5;
        camera.position.y = 1.5 + mouseY * -0.8;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
      };
      animate();

      // Handle resize
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

      // Cleanup references stored for the dispose closure
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
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        rendererRef.current = null;
      };
    };

    initThree();

    return () => {
      const cleanup = (container as unknown as Record<string, unknown>).__threeCleanup as (() => void) | undefined;
      if (cleanup) cleanup();
    };
  }, [arEnabled, renderPlan]);

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Scene';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ARArtifact>('ar', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('ar');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as ARArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as ARArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      // The render button drives the live viewport with the computed descriptor.
      if (action === 'render') {
        const plan = ((res as { result?: RenderPlan })?.result ?? res) as RenderPlan;
        if (plan && Array.isArray(plan.drawList)) { setRenderPlan(plan); setArEnabled(true); }
      }
    } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

  // Launch an immersive-ar WebXR session from the current render plan (reuses the
  // existing SceneStudio pattern: requestSession → renderer.xr.setSession → setAnimationLoop).
  const enterAR = useCallback(async () => {
    const plan = renderPlan;
    const xr = (navigator as Navigator & { xr?: { requestSession?: (m: string, o?: Record<string, unknown>) => Promise<unknown> } }).xr;
    if (!plan || !xr?.requestSession) return;
    try {
      const THREE = await import('three');
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: plan.requiredFeatures || ['local-floor'],
        optionalFeatures: plan.optionalFeatures || ['dom-overlay'],
      }) as unknown;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { xrCompatible: true }) as WebGLRenderingContext;
      const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
      renderer.xr.enabled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await renderer.xr.setSession(session as any);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      for (const d of plan.drawList || []) {
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

  const resetForm = () => {
    setFormName(''); setFormDescription(''); setFormStatus('active'); setFormNotes('');
    setFormLayerType(LAYER_TYPES[0]); setFormOpacity('75');
    setFormTrackingMode(TRACKING_MODES[0]); setFormRenderQuality(RENDER_QUALITIES[1]);
    setFormDtuDensity('50'); setFormPosition(''); setFormRotation('');
    setFormScale('1'); setFormFormat(MODEL_FORMATS[0]); setFormPolyCount('');
    setFormResolution('1920x1080'); setFormFps('60');
    setFormAnchorType(ANCHOR_TYPES[0]); setFormConfidence(''); setFormZIndex('0');
  };

  const openCreate = () => { setEditingItem(null); resetForm(); setEditorOpen(true); };
  const openEdit = (item: LensItem<ARArtifact>) => {
    const d = item.data as unknown as ARArtifact;
    setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || '');
    setFormStatus(d.status || 'active'); setFormNotes(d.notes || '');
    setFormLayerType(d.layerType || LAYER_TYPES[0]); setFormOpacity(d.opacity?.toString() || '75');
    setFormTrackingMode(d.trackingMode || TRACKING_MODES[0]);
    setFormRenderQuality(d.renderQuality || RENDER_QUALITIES[1]);
    setFormDtuDensity(d.dtuDensity?.toString() || '50');
    setFormPosition(d.position || ''); setFormRotation(d.rotation || '');
    setFormScale(d.scale?.toString() || '1'); setFormFormat(d.format || MODEL_FORMATS[0]);
    setFormPolyCount(d.polyCount?.toString() || '');
    setFormResolution(d.resolution || '1920x1080'); setFormFps(d.fps?.toString() || '60');
    setFormAnchorType(d.anchorType || ANCHOR_TYPES[0]);
    setFormConfidence(d.confidence?.toString() || ''); setFormZIndex(d.zIndex?.toString() || '0');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus,
      description: formDescription, notes: formNotes,
      layerType: formLayerType, opacity: formOpacity ? parseInt(formOpacity) : undefined,
      trackingMode: formTrackingMode, renderQuality: formRenderQuality,
      dtuDensity: formDtuDensity ? parseInt(formDtuDensity) : undefined,
      position: formPosition, rotation: formRotation,
      scale: formScale ? parseFloat(formScale) : undefined,
      format: formFormat, polyCount: formPolyCount ? parseInt(formPolyCount) : undefined,
      resolution: formResolution, fps: formFps ? parseInt(formFps) : undefined,
      anchorType: formAnchorType,
      confidence: formConfidence ? parseFloat(formConfidence) : undefined,
      zIndex: formZIndex ? parseInt(formZIndex) : undefined,
    };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as ARArtifact);
    const activeLayers = all.filter(a => a.status === 'active').length;
    const totalAnchors = all.filter(a => a.anchorType).length;
    const modelCount = all.filter(a => a.format).length;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Layers className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Active Layers</p><p className="text-xl font-bold text-white">{activeLayers}</p></div>
          <div className={ds.panel}><Eye className="w-5 h-5 text-neon-cyan mb-2" /><p className={ds.textMuted}>AR Status</p><p className="text-xl font-bold text-white">{arEnabled ? 'LIVE' : 'OFF'}</p></div>
          <div className={ds.panel}><MapPin className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Anchors</p><p className="text-xl font-bold text-white">{totalAnchors}</p></div>
          <div className={ds.panel}><Box className="w-5 h-5 text-neon-blue mb-2" /><p className={ds.textMuted}>3D Models</p><p className="text-xl font-bold text-white">{modelCount}</p></div>
        </div>
        {/* AR Viewport Preview */}
        <div className={ds.panel}>
          <div className="h-64 relative overflow-hidden rounded-lg bg-lattice-deep">
            {arEnabled ? (
              <div ref={viewportRef} className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center text-gray-400"><Glasses className="w-12 h-12 mx-auto mb-2 opacity-50" /><p className="text-sm">Enable AR to begin</p></div>
              </div>
            )}
          </div>
          {arEnabled && (
            <div className="flex items-center gap-2 mt-2 px-1 flex-wrap">
              <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              <span className="text-xs text-neon-cyan">3D Viewport Active</span>
              {renderPlan && (
                <span className="text-xs text-gray-400">· {renderPlan.objectCount ?? renderPlan.drawList?.length ?? 0} object(s) · {(renderPlan.requiredFeatures || []).join(', ')}</span>
              )}
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
          )}
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>

            {(activeArtifactType === 'Scene' || activeArtifactType === 'Config') && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Tracking Mode</label><select className={ds.select} value={formTrackingMode} onChange={e => setFormTrackingMode(e.target.value)}>{TRACKING_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                <div><label className={ds.label}>Render Quality</label><select className={ds.select} value={formRenderQuality} onChange={e => setFormRenderQuality(e.target.value)}>{RENDER_QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>DTU Density</label><input type="number" className={ds.input} value={formDtuDensity} onChange={e => setFormDtuDensity(e.target.value)} min="1" max="100" /></div>
                <div><label className={ds.label}>Target FPS</label><input type="number" className={ds.input} value={formFps} onChange={e => setFormFps(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Resolution</label><input className={ds.input} value={formResolution} onChange={e => setFormResolution(e.target.value)} /></div>
            </>)}

            {activeArtifactType === 'Layer' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Layer Type</label><select className={ds.select} value={formLayerType} onChange={e => setFormLayerType(e.target.value)}>{LAYER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={ds.label}>Z-Index</label><input type="number" className={ds.input} value={formZIndex} onChange={e => setFormZIndex(e.target.value)} /></div>
              </div>
              <div><label className={ds.label}>Opacity (%)</label><input type="number" className={ds.input} value={formOpacity} onChange={e => setFormOpacity(e.target.value)} min="0" max="100" /></div>
            </>)}

            {activeArtifactType === 'Anchor' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Anchor Type</label><select className={ds.select} value={formAnchorType} onChange={e => setFormAnchorType(e.target.value)}>{ANCHOR_TYPES.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                <div><label className={ds.label}>Confidence (0-1)</label><input type="number" step="0.01" className={ds.input} value={formConfidence} onChange={e => setFormConfidence(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Position (x,y,z)</label><input className={ds.input} value={formPosition} onChange={e => setFormPosition(e.target.value)} placeholder="0, 0, 0" /></div>
                <div><label className={ds.label}>Rotation</label><input className={ds.input} value={formRotation} onChange={e => setFormRotation(e.target.value)} placeholder="0, 0, 0" /></div>
              </div>
            </>)}

            {activeArtifactType === 'Model3D' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Format</label><select className={ds.select} value={formFormat} onChange={e => setFormFormat(e.target.value)}>{MODEL_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                <div><label className={ds.label}>Poly Count</label><input type="number" className={ds.input} value={formPolyCount} onChange={e => setFormPolyCount(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Scale</label><input type="number" step="0.1" className={ds.input} value={formScale} onChange={e => setFormScale(e.target.value)} /></div>
                <div><label className={ds.label}>Position</label><input className={ds.input} value={formPosition} onChange={e => setFormPosition(e.target.value)} placeholder="0, 0, 0" /></div>
              </div>
            </>)}

            {activeArtifactType === 'Capture' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Resolution</label><input className={ds.input} value={formResolution} onChange={e => setFormResolution(e.target.value)} /></div>
                <div><label className={ds.label}>Format</label><select className={ds.select} value={formFormat} onChange={e => setFormFormat(e.target.value)}><option value="PNG">PNG</option><option value="JPEG">JPEG</option><option value="MP4">MP4</option><option value="WebM">WebM</option></select></div>
              </div>
            </>)}

            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button><button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button></div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Status</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Glasses className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as ARArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Glasses className="w-5 h-5 text-neon-purple" /><div>
                <p className="text-white font-medium">{d.name || item.title}</p>
                <p className={ds.textMuted}>
                  {d.layerType && <span>{d.layerType} </span>}
                  {d.trackingMode && <span>{d.trackingMode} tracking </span>}
                  {d.anchorType && <span>{d.anchorType} anchor </span>}
                  {d.format && <span>{d.format} </span>}
                  {d.polyCount && <span>{d.polyCount.toLocaleString()} polys </span>}
                  {d.renderQuality && <span>&middot; {d.renderQuality} </span>}
                </p>
              </div></div>
              <div className="flex items-center gap-2">
                {d.opacity !== undefined && <span className="text-xs text-neon-cyan">{d.opacity}%</span>}
                {d.confidence !== undefined && <span className="text-xs text-neon-green">{(d.confidence * 100).toFixed(0)}%</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('render', item.id); }} className={ds.btnGhost} aria-label="Activate"><Zap className="w-4 h-4 text-neon-purple" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost} aria-label="Delete"><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <LensShell lensId="ar" asMain={false}>
      <FirstRunTour lensId="ar" />
      <ManifestActionBar />
      <DepthBadge lensId="ar" size="sm" className="ml-2" />
      <LensVerticalHero lensId="ar" className="mx-6 mt-4" />
    <div data-lens-theme="ar" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center"><Glasses className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>AR</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Scenes, layers, anchors, 3D models, configs, and captures</p></div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-purple animate-pulse">AI processing...</span>}
          <DTUExportButton domain="ar" data={{}} compact />
          <button onClick={() => { setShowStudio(!showStudio); setShowDashboard(false); }} className={cn(showStudio ? ds.btnPrimary : ds.btnSecondary)}><Box className="w-4 h-4" /> Scene Studio</button>
          <button onClick={() => setArEnabled(!arEnabled)} className={cn(arEnabled ? ds.btnPrimary : ds.btnSecondary)}>
            {arEnabled ? <><Camera className="w-4 h-4" /> Stop AR</> : <><Glasses className="w-4 h-4" /> Start AR</>}
          </button>
          <button onClick={() => { setShowDashboard(!showDashboard); setShowStudio(false); }} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button>
        </div>
      </header>
      <RealtimeDataPanel domain="ar" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="ar" artifactId={items[0]?.id} compact />

      {(() => { const all = items.map(i => i.data as unknown as ARArtifact); return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Layers className="w-5 h-5 text-neon-purple mb-2" /><p className={ds.textMuted}>Total Items</p><p className="text-xl font-bold text-white">{items.length}</p></div>
          <div className={ds.panel}><Eye className="w-5 h-5 text-neon-cyan mb-2" /><p className={ds.textMuted}>AR Status</p><p className="text-xl font-bold text-white">{arEnabled ? 'LIVE' : 'OFF'}</p></div>
          <div className={ds.panel}><MapPin className="w-5 h-5 text-neon-green mb-2" /><p className={ds.textMuted}>Active</p><p className="text-xl font-bold text-white">{all.filter(a => a.status === 'active').length}</p></div>
          <div className={ds.panel}><Monitor className="w-5 h-5 text-neon-blue mb-2" /><p className={ds.textMuted}>Rendering</p><p className="text-xl font-bold text-white">{all.filter(a => a.status === 'rendering').length}</p></div>
        </div>
      ); })()}

      {showStudio ? (
        <section className="rounded-xl border border-lattice-border bg-zinc-950/40 p-4">
          <SceneStudio />
        </section>
      ) : (<>
        <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
        {showDashboard ? renderDashboard() : renderLibrary()}
        {renderEditor()}
      </>)}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="ar" /></div>}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SketchfabModels />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#ar-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to ar content</a>
          <RecentMineCard domain="ar" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="ar" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="ar" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
