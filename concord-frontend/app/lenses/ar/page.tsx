'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Glasses, Camera, Scan, Settings, Layers, Eye, Maximize } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

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
  useLensNav('ar');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('ar');

  const [activeTab, setActiveTab] = useState<ModeTab>('scenes');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ARArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
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

      // Torus knot
      const geometry = new THREE.TorusKnotGeometry(1, 0.35, 128, 32);
      const material = new THREE.MeshStandardMaterial({
        color: 0xa855f7, // neon-purple
        emissive: 0x4a1a8a,
        emissiveIntensity: 0.3,
        metalness: 0.6,
        roughness: 0.25,
      });
      const torusKnot = new THREE.Mesh(geometry, material);
      scene.add(torusKnot);

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

        torusKnot.rotation.x = elapsed * 0.3;
        torusKnot.rotation.y = elapsed * 0.5;

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
        geometry.dispose();
        material.dispose();
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
  }, [arEnabled]);

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
    try { await runAction.mutateAsync({ id: targetId, action }); } catch (err) { console.error('Action failed:', err); }
  }, [filtered, runAction]);

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
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="ar" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🥽</span>
          <div>
            <h1 className="text-xl font-bold">AR Lens</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <p className="text-sm text-gray-400">
              Augmented reality overlay for DTU visualization
            </p>
          </div>
        </div>
        <button
          onClick={() => setArEnabled(!arEnabled)}
          className={`btn-neon ${arEnabled ? 'pink' : 'purple'}`}
        >
          {arEnabled ? (
            <>
              <Camera className="w-4 h-4 mr-2 inline" />
              Stop AR
            </>
          ) : (
            <>
              <Glasses className="w-4 h-4 mr-2 inline" />
              Start AR
            </>
          )}
        </button>
      </header>

      <RealtimeDataPanel domain="ar" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="ar" data={{}} compact />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Layers, color: 'text-neon-purple', value: layers.filter((l) => arLayers?.active?.includes(l.id)).length, label: 'Active Layers' },
          { icon: Eye, color: 'text-neon-cyan', value: arEnabled ? 'LIVE' : 'OFF', label: 'AR Status' },
          { icon: Scan, color: 'text-neon-green', value: arEnabled ? '60' : '--', label: 'FPS' },
          { icon: Maximize, color: 'text-neon-blue', value: '1920x1080', label: 'Viewport' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* AR Viewport */}
      <div className="panel p-4">
        <div className="graph-container relative overflow-hidden">
          {arEnabled ? (
            <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/10 to-neon-blue/10 flex items-center justify-center">
              <div className="text-center">
                <Scan className="w-24 h-24 mx-auto text-neon-cyan animate-pulse mb-4" />
                <p className="text-lg font-medium">AR Mode Active</p>
                <p className="text-sm text-gray-400">
                  Camera feed would render here
                </p>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Glasses className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Enable AR to begin visualization</p>
              </div>
            </div>
          )}

          {/* AR Status Overlay */}
          {arEnabled && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              <span className="text-xs text-neon-cyan">3D Viewport Active</span>
              <span className="text-xs text-gray-500 ml-auto">Move pointer to orbit</span>
            </div>
          )}
        </div>
      </div>
    );
  };

      {/* AR Layers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {layers.map((layer, i) => {
          const isActive = arLayers?.active?.includes(layer.id);
          return (
            <motion.button
              key={layer.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => setSelectedLayer(layer.id)}
              className={`lens-card text-left transition-all ${
                isActive ? 'border-neon-cyan shadow-[0_0_15px_rgba(0,212,255,0.3)]' : ''
              } ${selectedLayer === layer.id ? 'ring-2 ring-neon-cyan shadow-[0_0_20px_rgba(0,212,255,0.4)]' : ''}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{layer.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">{layer.name}</h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        isActive
                          ? 'bg-neon-green/20 text-neon-green'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1">{layer.description}</p>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* AR Scene Statistics */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="panel p-4"
      >
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Glasses className="w-4 h-4 text-neon-purple" />
          Scene Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'DTU Anchors', value: 24, color: 'text-neon-cyan' },
            { label: 'Tracked Planes', value: 3, color: 'text-neon-green' },
            { label: 'Light Probes', value: 8, color: 'text-amber-400' },
            { label: 'Render Calls', value: 142, color: 'text-neon-purple' },
          ].map((item) => (
            <div key={item.label} className="bg-lattice-deep rounded-lg p-3 text-center">
              <p className={`text-xl font-bold font-mono ${item.color}`}>{item.value}</p>
              <p className="text-xs text-gray-500">{item.label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* AR Settings */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-neon-purple" />
          AR Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Render Quality</label>
            <select className="input-lattice">
              <option value="low">Low (Better Performance)</option>
              <option value="medium">Medium</option>
              <option value="high">High (Better Quality)</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Tracking Mode</label>
            <select className="input-lattice">
              <option value="world">World Tracking</option>
              <option value="face">Face Tracking</option>
              <option value="image">Image Tracking</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">DTU Density</label>
            <input
              type="range"
              min="1"
              max="100"
              defaultValue="50"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Opacity</label>
            <input
              type="range"
              min="0"
              max="100"
              defaultValue="75"
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button><button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button></div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" /><input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
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
                <button onClick={e => { e.stopPropagation(); handleAction('render', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-purple" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="ar" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center"><Glasses className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>AR</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Scenes, layers, anchors, 3D models, configs, and captures</p></div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-purple animate-pulse">AI processing...</span>}
          <DTUExportButton domain="ar" data={{}} compact />
          <button onClick={() => setArEnabled(!arEnabled)} className={cn(arEnabled ? ds.btnPrimary : ds.btnSecondary)}>
            {arEnabled ? <><Camera className="w-4 h-4" /> Stop AR</> : <><Glasses className="w-4 h-4" /> Start AR</>}
          </button>
          <button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button>
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

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="ar" /></div>}
      </div>
    </div>
  );
}
