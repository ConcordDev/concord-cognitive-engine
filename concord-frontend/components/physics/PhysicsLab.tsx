'use client';

/**
 * PhysicsLab — PhET / Algodoo parity surface for the physics lens.
 *
 * Wires the server-side physics engine (server/domains/physics.js) end to end:
 *  - Persistent scene editor (scene-list / scene-save / scene-get / scene-delete)
 *  - Drag-place bodies, set mass / velocity / restitution interactively
 *  - Extended body types: circle, box, ramp, fixed anchor + spring/rod/rope/pin
 *    constraints + fluid volumes
 *  - Authoritative server simulation (scene-run) with per-body time-series
 *  - ChartKit graphs of position / velocity / energy over time
 *  - Curriculum modules (curriculum-list / curriculum-get) — guided labs
 *  - Live physics parameters panel (gravity, air density, time scale)
 *  - Share / embed (scene-share / scene-load-shared)
 *  - Measurement tools — ruler, protractor, force vectors (measure)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Plus, Trash2, Save, Play, FolderOpen, Share2, Download,
  Ruler, Loader2, GraduationCap, SlidersHorizontal, Move, Box as BoxIcon,
  Circle as CircleIcon, Triangle, Anchor, Link2, Waves, X,
} from 'lucide-react';

// ─── Scene model (mirrors server/domains/physics.js normalize* shapes) ───

type BodyType = 'circle' | 'box' | 'ramp' | 'fixed';
type ConstraintType = 'spring' | 'rod' | 'rope' | 'pin';

interface SceneBody {
  id: string;
  name: string;
  type: BodyType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  w: number;
  h: number;
  angle: number;
  restitution: number;
  friction: number;
  isStatic: boolean;
  color: string;
}

interface SceneConstraint {
  id: string;
  type: ConstraintType;
  a: string;
  b: string;
  restLength: number;
  stiffness: number;
  damping: number;
}

interface SceneFluid {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  density: number;
  drag: number;
}

interface SceneSettings {
  gravityX: number;
  gravityY: number;
  airDensity: number;
  timeScale: number;
  restitutionGlobal: number | null;
  wallBounce: boolean;
  bounds: { w: number; h: number };
}

interface Scene {
  id: string;
  name: string;
  bodies: SceneBody[];
  constraints: SceneConstraint[];
  fluids: SceneFluid[];
  settings: SceneSettings;
  shareCode?: string | null;
  updatedAt?: string;
}

interface SceneSummary {
  id: string;
  name: string;
  bodyCount: number;
  constraintCount: number;
  fluidCount: number;
  updatedAt: string;
  shareCode: string | null;
}

interface BodySeriesPoint {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

interface SimBodyResult {
  id: string;
  name: string;
  type: BodyType;
  final: { x: number; y: number; vx: number; vy: number };
  maxSpeed: number;
  series: BodySeriesPoint[];
}

interface SimResult {
  duration: number;
  sampleCount: number;
  bodies: SimBodyResult[];
  energyTrace: Array<{ t: number; kinetic: number; potential: number; total: number }>;
  collisions: number;
  energyDrift: number;
}

interface CurriculumSummary {
  id: string;
  title: string;
  topic: string;
  difficulty: string;
  description: string;
  stepCount: number;
}

interface CurriculumModule extends CurriculumSummary {
  steps: string[];
  scene: Partial<Scene> & { name: string };
}

const BOUNDS = { w: 800, h: 600 };
const PALETTE = ['#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#60a5fa'];

function defaultSettings(): SceneSettings {
  return {
    gravityX: 0,
    gravityY: 9.81,
    airDensity: 0,
    timeScale: 1,
    restitutionGlobal: null,
    wallBounce: true,
    bounds: { ...BOUNDS },
  };
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function newBody(type: BodyType, x: number, y: number, idx: number): SceneBody {
  return {
    id: uid('b'),
    name: `${type[0].toUpperCase()}${type.slice(1)} ${idx + 1}`,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    mass: type === 'fixed' ? 1 : 2,
    radius: type === 'fixed' ? 8 : 24,
    w: 56,
    h: type === 'ramp' ? 24 : 56,
    angle: type === 'ramp' ? 0.5 : 0,
    restitution: 0.7,
    friction: 0.1,
    isStatic: type === 'fixed' || type === 'ramp',
    color: PALETTE[idx % PALETTE.length],
  };
}

function emptyScene(): Scene {
  return {
    id: '',
    name: 'Untitled Scene',
    bodies: [],
    constraints: [],
    fluids: [],
    settings: defaultSettings(),
  };
}

type Tool = BodyType | 'select' | 'fluid' | 'ruler' | 'protractor';

export function PhysicsLab() {
  const [scene, setScene] = useState<Scene>(emptyScene);
  const [savedScenes, setSavedScenes] = useState<SceneSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [sim, setSim] = useState<SimResult | null>(null);
  const [graphBody, setGraphBody] = useState<string | null>(null);
  const [graphMetric, setGraphMetric] = useState<'position' | 'velocity' | 'energy'>('energy');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [modules, setModules] = useState<CurriculumSummary[]>([]);
  const [activeModule, setActiveModule] = useState<CurriculumModule | null>(null);
  const [shareCode, setShareCode] = useState('');
  const [importCode, setImportCode] = useState('');
  const [showCurriculum, setShowCurriculum] = useState(false);

  // Measurement tools
  const [rulerPts, setRulerPts] = useState<Array<{ x: number; y: number }>>([]);
  const [protractorPts, setProtractorPts] = useState<Array<{ x: number; y: number }>>([]);
  const [measureResult, setMeasureResult] = useState<string>('');

  // Drag state
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selected = scene.bodies.find((b) => b.id === selectedId) || null;

  // ── Scene CRUD ──

  const refreshScenes = useCallback(async () => {
    const r = await lensRun<{ scenes: SceneSummary[] }>('physics', 'scene-list', {});
    if (r.data.ok && r.data.result) setSavedScenes(r.data.result.scenes);
  }, []);

  useEffect(() => {
    refreshScenes();
    lensRun<{ modules: CurriculumSummary[] }>('physics', 'curriculum-list', {}).then((r) => {
      if (r.data.ok && r.data.result) setModules(r.data.result.modules);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveScene = useCallback(async () => {
    setBusy('save');
    try {
      const r = await lensRun<{ scene: Scene }>('physics', 'scene-save', {
        id: scene.id || undefined,
        name: scene.name,
        bodies: scene.bodies,
        constraints: scene.constraints,
        fluids: scene.fluids,
        settings: scene.settings,
      });
      if (r.data.ok && r.data.result) {
        setScene((s) => ({ ...s, id: r.data.result!.scene.id }));
        setStatus(`Saved "${scene.name}"`);
        await refreshScenes();
      } else {
        setStatus(`Save failed: ${r.data.error || 'unknown'}`);
      }
    } finally {
      setBusy(null);
    }
  }, [scene, refreshScenes]);

  const loadScene = useCallback(async (id: string) => {
    setBusy('load');
    try {
      const r = await lensRun<{ scene: Scene }>('physics', 'scene-get', { id });
      if (r.data.ok && r.data.result) {
        const sc = r.data.result.scene;
        setScene({ ...sc, settings: { ...defaultSettings(), ...sc.settings } });
        setSim(null);
        setSelectedId(null);
        setActiveModule(null);
        setStatus(`Loaded "${sc.name}"`);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const deleteScene = useCallback(async (id: string) => {
    await lensRun('physics', 'scene-delete', { id });
    if (scene.id === id) setScene(emptyScene());
    await refreshScenes();
    setStatus('Scene deleted');
  }, [scene.id, refreshScenes]);

  // ── Run simulation on the server ──

  const runSim = useCallback(async () => {
    if (scene.bodies.length === 0) {
      setStatus('Add at least one body before running.');
      return;
    }
    setBusy('run');
    try {
      const r = await lensRun<SimResult>('physics', 'simulate-scene', {
        bodies: scene.bodies,
        constraints: scene.constraints,
        fluids: scene.fluids,
        settings: scene.settings,
        steps: 900,
        substeps: 6,
      });
      if (r.data.ok && r.data.result) {
        setSim(r.data.result);
        setGraphBody(r.data.result.bodies[0]?.id || null);
        setStatus(
          `Simulated ${r.data.result.duration}s · ${r.data.result.collisions} collisions · energy drift ${r.data.result.energyDrift}`,
        );
      } else {
        setStatus(`Simulation failed: ${r.data.error || 'unknown'}`);
      }
    } finally {
      setBusy(null);
    }
  }, [scene]);

  // ── Share / import ──

  const shareScene = useCallback(async () => {
    if (!scene.id) {
      setStatus('Save the scene before sharing.');
      return;
    }
    setBusy('share');
    try {
      const r = await lensRun<{ shareCode: string; embed: string }>('physics', 'scene-share', {
        id: scene.id,
      });
      if (r.data.ok && r.data.result) {
        setShareCode(r.data.result.shareCode);
        setScene((s) => ({ ...s, shareCode: r.data.result!.shareCode }));
        setStatus(`Share code created: ${r.data.result.shareCode}`);
      }
    } finally {
      setBusy(null);
    }
  }, [scene.id]);

  const importScene = useCallback(async () => {
    if (!importCode.trim()) return;
    setBusy('import');
    try {
      const r = await lensRun<{ scene: Scene }>('physics', 'scene-load-shared', {
        shareCode: importCode.trim(),
      });
      if (r.data.ok && r.data.result) {
        setScene({ ...r.data.result.scene, settings: { ...defaultSettings(), ...r.data.result.scene.settings } });
        setImportCode('');
        setSim(null);
        await refreshScenes();
        setStatus('Imported shared scene.');
      } else {
        setStatus(`Import failed: ${r.data.error || 'unknown'}`);
      }
    } finally {
      setBusy(null);
    }
  }, [importCode, refreshScenes]);

  // ── Curriculum ──

  const openModule = useCallback(async (id: string) => {
    setBusy('module');
    try {
      const r = await lensRun<{ module: CurriculumModule }>('physics', 'curriculum-get', { id });
      if (r.data.ok && r.data.result) {
        const m = r.data.result.module;
        setActiveModule(m);
        const sc = m.scene;
        setScene({
          id: '',
          name: sc.name,
          bodies: (sc.bodies || []).map((b, i) => ({ ...newBody('circle', 0, 0, i), ...b } as SceneBody)),
          constraints: (sc.constraints || []) as SceneConstraint[],
          fluids: (sc.fluids || []) as SceneFluid[],
          settings: { ...defaultSettings(), ...sc.settings },
        });
        setSim(null);
        setSelectedId(null);
        setShowCurriculum(false);
        setStatus(`Loaded curriculum: ${m.title}`);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  // ── Canvas placement / drag ──

  const canvasPos = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * BOUNDS.w,
      y: ((e.clientY - rect.top) / rect.height) * BOUNDS.h,
    };
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    const p = canvasPos(e);
    if (tool === 'select') return;
    if (tool === 'ruler') {
      setRulerPts((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
      return;
    }
    if (tool === 'protractor') {
      setProtractorPts((pts) => (pts.length >= 3 ? [p] : [...pts, p]));
      return;
    }
    if (tool === 'fluid') {
      setScene((s) => ({
        ...s,
        fluids: [
          ...s.fluids,
          { id: uid('fl'), x: Math.max(0, p.x - 100), y: Math.max(0, p.y - 60), w: 200, h: 140, density: 1, drag: 0.5 },
        ],
      }));
      return;
    }
    // body tool
    setScene((s) => {
      const b = newBody(tool as BodyType, p.x, p.y, s.bodies.length);
      setSelectedId(b.id);
      return { ...s, bodies: [...s.bodies, b] };
    });
  }, [tool, canvasPos]);

  const handleBodyDown = useCallback((e: React.MouseEvent, b: SceneBody) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    const p = canvasPos(e);
    setSelectedId(b.id);
    dragRef.current = { id: b.id, ox: p.x - b.x, oy: p.y - b.y };
  }, [tool, canvasPos]);

  const handleCanvasMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = canvasPos(e);
    setScene((s) => ({
      ...s,
      bodies: s.bodies.map((b) =>
        b.id === d.id
          ? { ...b, x: Math.max(0, Math.min(BOUNDS.w, p.x - d.ox)), y: Math.max(0, Math.min(BOUNDS.h, p.y - d.oy)) }
          : b,
      ),
    }));
  }, [canvasPos]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Measurement tools ──

  const runMeasure = useCallback(async () => {
    if (tool === 'ruler' && rulerPts.length === 2) {
      const r = await lensRun<{ meters: number; pixels: number; angleDeg: number }>('physics', 'measure', {
        tool: 'ruler',
        a: rulerPts[0],
        b: rulerPts[1],
        pixelsPerMeter: 50,
      });
      if (r.data.ok && r.data.result) {
        setMeasureResult(
          `Ruler: ${r.data.result.meters} m (${r.data.result.pixels} px) at ${r.data.result.angleDeg}°`,
        );
      }
    } else if (tool === 'protractor' && protractorPts.length === 3) {
      const r = await lensRun<{ angleDeg: number; interiorDeg: number }>('physics', 'measure', {
        tool: 'protractor',
        vertex: protractorPts[0],
        a: protractorPts[1],
        b: protractorPts[2],
      });
      if (r.data.ok && r.data.result) {
        setMeasureResult(`Protractor: ${r.data.result.interiorDeg}° interior angle`);
      }
    } else {
      setMeasureResult('Place all measurement points on the canvas first.');
    }
  }, [tool, rulerPts, protractorPts]);

  const measureForce = useCallback(async () => {
    if (!selected) return;
    const r = await lensRun<{
      netForce: number;
      components: { fx: number; fy: number };
      acceleration: number;
      netAngleDeg: number;
    }>('physics', 'measure', {
      tool: 'force',
      mass: selected.mass,
      gravity: scene.settings.gravityY,
    });
    if (r.data.ok && r.data.result) {
      const f = r.data.result;
      setMeasureResult(
        `Force on ${selected.name}: net ${f.netForce} N at ${f.netAngleDeg}° → a = ${f.acceleration} m/s²`,
      );
    }
  }, [selected, scene.settings.gravityY]);

  // ── Body / constraint editing ──

  const patchBody = useCallback((id: string, patch: Partial<SceneBody>) => {
    setScene((s) => ({ ...s, bodies: s.bodies.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  }, []);

  const removeBody = useCallback((id: string) => {
    setScene((s) => ({
      ...s,
      bodies: s.bodies.filter((b) => b.id !== id),
      constraints: s.constraints.filter((c) => c.a !== id && c.b !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const addConstraint = useCallback((type: ConstraintType) => {
    if (scene.bodies.length < 2) {
      setStatus('Need at least two bodies to connect.');
      return;
    }
    const [a, b] = scene.bodies;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    setScene((s) => ({
      ...s,
      constraints: [
        ...s.constraints,
        { id: uid('c'), type, a: a.id, b: b.id, restLength: Math.round(dist), stiffness: 0.5, damping: 0.05 },
      ],
    }));
  }, [scene.bodies]);

  const patchConstraint = useCallback((id: string, patch: Partial<SceneConstraint>) => {
    setScene((s) => ({ ...s, constraints: s.constraints.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  }, []);

  // ── Graph data ──

  const graphSeries = useMemo(() => {
    if (!sim) return { data: [] as Array<Record<string, unknown>>, series: [] as { key: string; label: string }[], xKey: 't' };
    if (graphMetric === 'energy') {
      return {
        data: sim.energyTrace as unknown as Array<Record<string, unknown>>,
        series: [
          { key: 'kinetic', label: 'Kinetic (J)' },
          { key: 'potential', label: 'Potential (J)' },
          { key: 'total', label: 'Total (J)' },
        ],
        xKey: 't',
      };
    }
    const body = sim.bodies.find((b) => b.id === graphBody) || sim.bodies[0];
    if (!body) return { data: [], series: [], xKey: 't' };
    if (graphMetric === 'position') {
      return {
        data: body.series as unknown as Array<Record<string, unknown>>,
        series: [
          { key: 'x', label: 'x (px)' },
          { key: 'y', label: 'y (px)' },
        ],
        xKey: 't',
      };
    }
    return {
      data: body.series as unknown as Array<Record<string, unknown>>,
      series: [
        { key: 'vx', label: 'vx (px/s)' },
        { key: 'vy', label: 'vy (px/s)' },
        { key: 'speed', label: 'speed' },
      ],
      xKey: 't',
    };
  }, [sim, graphBody, graphMetric]);

  // ── Render ──

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Physics Lab — Scene Editor &amp; Simulator</h2>
        </div>
        <input
          value={scene.name}
          onChange={(e) => setScene((s) => ({ ...s, name: e.target.value }))}
          className="px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-zinc-100 w-48"
          placeholder="Scene name"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        {([
          { id: 'select', icon: Move, label: 'Select / drag' },
          { id: 'circle', icon: CircleIcon, label: 'Circle' },
          { id: 'box', icon: BoxIcon, label: 'Box' },
          { id: 'ramp', icon: Triangle, label: 'Ramp' },
          { id: 'fixed', icon: Anchor, label: 'Fixed anchor' },
          { id: 'fluid', icon: Waves, label: 'Fluid volume' },
          { id: 'ruler', icon: Ruler, label: 'Ruler' },
          { id: 'protractor', icon: Triangle, label: 'Protractor' },
        ] as const).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => setTool(t.id)}
              className={`p-2 rounded transition ${
                tool === t.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-zinc-400 hover:bg-white/5 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        <div className="w-px h-6 bg-white/10 mx-1" />
        {(['spring', 'rod', 'rope', 'pin'] as ConstraintType[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => addConstraint(c)}
            className="px-2 py-1.5 text-[11px] rounded text-zinc-300 hover:bg-white/5 border border-white/10 flex items-center gap-1"
          >
            <Link2 className="w-3 h-3" /> {c}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={runSim}
          disabled={busy === 'run'}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 flex items-center gap-1 disabled:opacity-50"
        >
          {busy === 'run' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Run
        </button>
        <button
          type="button"
          onClick={saveScene}
          disabled={busy === 'save'}
          className="px-3 py-1.5 text-xs rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 flex items-center gap-1 disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
        <button
          type="button"
          onClick={shareScene}
          disabled={busy === 'share'}
          className="px-3 py-1.5 text-xs rounded bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/40 flex items-center gap-1 disabled:opacity-50"
        >
          <Share2 className="w-3 h-3" /> Share
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Canvas */}
        <div className="lg:col-span-3 space-y-3">
          <div
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            className="relative w-full rounded-lg border border-cyan-500/20 bg-[#070b14] overflow-hidden"
            style={{ aspectRatio: `${BOUNDS.w} / ${BOUNDS.h}`, cursor: tool === 'select' ? 'default' : 'crosshair' }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            {/* Fluids */}
            {scene.fluids.map((f) => (
              <div
                key={f.id}
                className="absolute bg-cyan-400/10 border border-cyan-400/30"
                style={{
                  left: `${(f.x / BOUNDS.w) * 100}%`,
                  top: `${(f.y / BOUNDS.h) * 100}%`,
                  width: `${(f.w / BOUNDS.w) * 100}%`,
                  height: `${(f.h / BOUNDS.h) * 100}%`,
                }}
              />
            ))}
            {/* Constraints */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${BOUNDS.w} ${BOUNDS.h}`}>
              {scene.constraints.map((c) => {
                const a = scene.bodies.find((b) => b.id === c.a);
                const b = scene.bodies.find((bb) => bb.id === c.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={c.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={c.type === 'spring' ? '#fbbf24' : c.type === 'rod' ? '#a3a3a3' : '#6b7280'}
                    strokeWidth={2}
                    strokeDasharray={c.type === 'spring' ? '6 4' : c.type === 'rope' ? '3 3' : undefined}
                  />
                );
              })}
              {rulerPts.length === 2 && (
                <line x1={rulerPts[0].x} y1={rulerPts[0].y} x2={rulerPts[1].x} y2={rulerPts[1].y} stroke="#f472b6" strokeWidth={2} />
              )}
              {protractorPts.length >= 2 &&
                protractorPts.slice(1).map((p, i) => (
                  <line key={i} x1={protractorPts[0].x} y1={protractorPts[0].y} x2={p.x} y2={p.y} stroke="#34d399" strokeWidth={2} />
                ))}
            </svg>
            {/* Bodies */}
            {scene.bodies.map((b) => {
              const sel = b.id === selectedId;
              const left = `${(b.x / BOUNDS.w) * 100}%`;
              const top = `${(b.y / BOUNDS.h) * 100}%`;
              if (b.type === 'circle' || b.type === 'fixed') {
                const d = b.type === 'fixed' ? 14 : b.radius * 2;
                return (
                  <div
                    key={b.id}
                    onMouseDown={(e) => handleBodyDown(e, b)}
                    className="absolute rounded-full"
                    style={{
                      left,
                      top,
                      width: `${(d / BOUNDS.w) * 100}%`,
                      height: `${(d / BOUNDS.w) * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      background: b.type === 'fixed' ? '#52525b' : b.color,
                      border: sel ? '2px solid #fff' : `1px solid ${b.color}`,
                      boxShadow: sel ? `0 0 12px ${b.color}` : undefined,
                    }}
                  />
                );
              }
              const w = b.type === 'ramp' ? b.w : b.w;
              const h = b.type === 'ramp' ? b.h : b.h;
              return (
                <div
                  key={b.id}
                  onMouseDown={(e) => handleBodyDown(e, b)}
                  className="absolute"
                  style={{
                    left,
                    top,
                    width: `${(w / BOUNDS.w) * 100}%`,
                    height: `${(h / BOUNDS.h) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${b.type === 'ramp' ? b.angle : 0}rad)`,
                    background: b.color + (b.type === 'ramp' ? '55' : 'cc'),
                    border: sel ? '2px solid #fff' : `1px solid ${b.color}`,
                  }}
                />
              );
            })}
            <div className="absolute bottom-2 left-2 text-[10px] text-zinc-400 font-mono">
              {scene.bodies.length} bodies · {scene.constraints.length} constraints · {scene.fluids.length} fluids
            </div>
          </div>

          {status && <p className="text-[11px] text-cyan-300 font-mono">{status}</p>}

          {/* Measurement output */}
          {(tool === 'ruler' || tool === 'protractor') && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runMeasure}
                className="px-3 py-1.5 text-xs rounded bg-pink-500/20 text-pink-200 border border-pink-500/40 flex items-center gap-1"
              >
                <Ruler className="w-3 h-3" /> Measure
              </button>
              <button
                type="button"
                onClick={() => {
                  setRulerPts([]);
                  setProtractorPts([]);
                  setMeasureResult('');
                }}
                className="px-2 py-1.5 text-xs rounded text-zinc-400 hover:bg-white/5 border border-white/10"
              >
                Clear points
              </button>
              {measureResult && <span className="text-[11px] text-zinc-200 font-mono">{measureResult}</span>}
            </div>
          )}

          {/* Simulation graphs */}
          {sim && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-semibold text-zinc-200">Time-series graphs</span>
                <div className="flex items-center gap-1">
                  {(['energy', 'position', 'velocity'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGraphMetric(m)}
                      className={`px-2 py-1 text-[11px] rounded ${
                        graphMetric === m ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:bg-white/5'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  {graphMetric !== 'energy' && (
                    <select
                      value={graphBody || ''}
                      onChange={(e) => setGraphBody(e.target.value)}
                      className="px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-zinc-200"
                    >
                      {sim.bodies.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <ChartKit kind="line" data={graphSeries.data} xKey={graphSeries.xKey} series={graphSeries.series} height={220} />
              <p className="text-[10px] text-zinc-400 font-mono">
                {sim.duration}s simulated · {sim.collisions} collisions · energy drift {sim.energyDrift} J
              </p>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-3">
          {/* Live parameters panel */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" /> Parameters
            </div>
            {([
              { key: 'gravityY', label: 'Gravity Y', min: -20, max: 20, step: 0.1 },
              { key: 'gravityX', label: 'Gravity X', min: -20, max: 20, step: 0.1 },
              { key: 'airDensity', label: 'Air density', min: 0, max: 5, step: 0.05 },
              { key: 'timeScale', label: 'Time scale', min: 0.1, max: 3, step: 0.1 },
            ] as const).map((p) => (
              <label key={p.key} className="block">
                <span className="text-[10px] text-zinc-400 flex justify-between">
                  {p.label}
                  <span className="font-mono text-zinc-200">{scene.settings[p.key].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={scene.settings[p.key]}
                  onChange={(e) =>
                    setScene((s) => ({ ...s, settings: { ...s.settings, [p.key]: Number(e.target.value) } }))
                  }
                  className="w-full accent-amber-400"
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={scene.settings.wallBounce}
                onChange={(e) => setScene((s) => ({ ...s, settings: { ...s.settings, wallBounce: e.target.checked } }))}
                className="accent-amber-400"
              />
              Wall bounce
            </label>
          </div>

          {/* Selected body editor */}
          {selected && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-200">{selected.name}</span>
                <button aria-label="Delete" type="button" onClick={() => removeBody(selected.id)} className="text-zinc-400 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {([
                { key: 'mass', label: 'Mass (kg)', min: 0.1, max: 50, step: 0.1 },
                { key: 'radius', label: 'Radius', min: 5, max: 80, step: 1 },
                { key: 'vx', label: 'Velocity X', min: -300, max: 300, step: 5 },
                { key: 'vy', label: 'Velocity Y', min: -300, max: 300, step: 5 },
                { key: 'restitution', label: 'Restitution', min: 0, max: 1, step: 0.05 },
                { key: 'friction', label: 'Friction', min: 0, max: 1, step: 0.05 },
              ] as const).map((f) => (
                <label key={f.key} className="block">
                  <span className="text-[10px] text-zinc-400 flex justify-between">
                    {f.label}
                    <span className="font-mono text-zinc-200">{selected[f.key]}</span>
                  </span>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={selected[f.key]}
                    onChange={(e) => patchBody(selected.id, { [f.key]: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </label>
              ))}
              {selected.type === 'ramp' && (
                <label className="block">
                  <span className="text-[10px] text-zinc-400 flex justify-between">
                    Ramp angle (rad)
                    <span className="font-mono text-zinc-200">{selected.angle.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={-1.4}
                    max={1.4}
                    step={0.05}
                    value={selected.angle}
                    onChange={(e) => patchBody(selected.id, { angle: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </label>
              )}
              <label className="flex items-center gap-2 text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={selected.isStatic}
                  onChange={(e) => patchBody(selected.id, { isStatic: e.target.checked })}
                  className="accent-cyan-400"
                />
                Static body
              </label>
              <button
                type="button"
                onClick={measureForce}
                className="w-full px-2 py-1 text-[11px] rounded bg-pink-500/15 text-pink-200 border border-pink-500/30"
              >
                Measure net force
              </button>
            </div>
          )}

          {/* Constraint list */}
          {scene.constraints.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
              <span className="text-xs font-semibold text-zinc-200">Constraints</span>
              {scene.constraints.map((c) => (
                <div key={c.id} className="text-[11px] space-y-1 border-b border-white/5 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300 capitalize">{c.type}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setScene((s) => ({ ...s, constraints: s.constraints.filter((x) => x.id !== c.id) }))
                      }
                      className="text-zinc-400 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {(c.type === 'spring' || c.type === 'rope' || c.type === 'rod') && (
                    <label className="block">
                      <span className="text-[9px] text-zinc-400">rest length {c.restLength}</span>
                      <input
                        type="range"
                        min={10}
                        max={400}
                        value={c.restLength}
                        onChange={(e) => patchConstraint(c.id, { restLength: Number(e.target.value) })}
                        className="w-full accent-yellow-400"
                      />
                    </label>
                  )}
                  {c.type === 'spring' && (
                    <label className="block">
                      <span className="text-[9px] text-zinc-400">stiffness {c.stiffness.toFixed(2)}</span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={c.stiffness}
                        onChange={(e) => patchConstraint(c.id, { stiffness: Number(e.target.value) })}
                        className="w-full accent-yellow-400"
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Saved scenes */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> Saved scenes
              </span>
              <button
                type="button"
                onClick={() => {
                  setScene(emptyScene());
                  setSim(null);
                  setSelectedId(null);
                }}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            {savedScenes.length === 0 && <p className="text-[11px] text-zinc-400">No saved scenes yet.</p>}
            {savedScenes.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-[11px] group">
                <button
                  type="button"
                  onClick={() => loadScene(s.id)}
                  className="text-zinc-300 hover:text-cyan-300 truncate text-left flex-1"
                >
                  {s.name}{' '}
                  <span className="text-zinc-600">
                    ({s.bodyCount}b/{s.constraintCount}c)
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteScene(s.id)}
                  className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Share / import */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
              <Share2 className="w-3.5 h-3.5 text-fuchsia-400" /> Share &amp; embed
            </span>
            {shareCode && (
              <div className="text-[10px] font-mono bg-black/40 border border-white/10 rounded px-2 py-1 text-fuchsia-200 break-all">
                {shareCode}
              </div>
            )}
            <div className="flex gap-1">
              <input
                value={importCode}
                onChange={(e) => setImportCode(e.target.value)}
                placeholder="Paste share code"
                className="flex-1 px-2 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-zinc-100"
              />
              <button
                type="button"
                onClick={importScene}
                disabled={busy === 'import'}
                className="px-2 py-1 text-[11px] rounded bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/30 flex items-center gap-1 disabled:opacity-50"
              >
                <Download className="w-3 h-3" /> Load
              </button>
            </div>
          </div>

          {/* Curriculum */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowCurriculum((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-zinc-200"
            >
              <span className="flex items-center gap-1">
                <GraduationCap className="w-3.5 h-3.5 text-emerald-400" /> Curriculum labs
              </span>
              <span className="text-zinc-400">{modules.length}</span>
            </button>
            {showCurriculum &&
              modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openModule(m.id)}
                  className="w-full text-left rounded border border-white/5 hover:border-emerald-500/30 hover:bg-emerald-500/5 p-2 transition"
                >
                  <p className="text-[11px] font-medium text-zinc-200">{m.title}</p>
                  <p className="text-[10px] text-zinc-400">
                    {m.topic} · {m.difficulty} · {m.stepCount} steps
                  </p>
                </button>
              ))}
          </div>

          {/* Active module steps */}
          {activeModule && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
              <p className="text-xs font-semibold text-emerald-200">{activeModule.title}</p>
              <p className="text-[10px] text-zinc-400">{activeModule.description}</p>
              <ol className="list-decimal list-inside space-y-1 mt-1">
                {activeModule.steps.map((step, i) => (
                  <li key={i} className="text-[11px] text-zinc-300">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PhysicsLab;
