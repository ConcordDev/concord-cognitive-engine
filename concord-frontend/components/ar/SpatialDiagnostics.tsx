'use client';

/**
 * SpatialDiagnostics — designed surface for the three pure-compute AR
 * analysis macros that had zero frontend callers before this rebuild:
 * `ar.spatialMapping`, `ar.markerDetection`, `ar.sceneGraph` (see
 * `server/domains/ar.js`). All three are stateless compute tools (no
 * persistence macro backs an "anchor set"/"marker set"/"node graph" as a
 * saved resource) — so this component holds the input rows as local,
 * user-editable scratch state and dispatches the real macro on demand via
 * `useMacroDispatchFeedback`, rendering the REAL response shape back
 * verbatim. Nothing here is fabricated: every number shown after a run
 * comes straight from the macro's computed result.
 *
 * This is intentionally a different job from `SceneStudio`'s object
 * authoring: `ar.sceneGraph` operates on an explicit parent/child node
 * hierarchy (no such concept exists in the flat `SceneStudio` object
 * model), and `spatialMapping`/`markerDetection` are diagnostic tools for
 * anchor/marker sets a creator might import from an external pipeline
 * (ARKit/ARCore plane-detection exports, a printed AprilTag/ArUco set)
 * before wiring them into a scene — not scene-authoring itself.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Boxes, ScanLine, Network, Plus, Trash2, Play, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';

type Tool = 'spatial' | 'marker' | 'graph';

const TOOLS: { id: Tool; label: string; icon: typeof Boxes; blurb: string }[] = [
  { id: 'spatial', label: 'Spatial Mapping', icon: Boxes, blurb: 'AABB / volume / surface classification / proximity + occlusion for a set of spatial anchors.' },
  { id: 'marker', label: 'Marker Detection', icon: ScanLine, blurb: 'Hamming-distance validation, bit-balance, rotational uniqueness, and corner-based pose estimation for fiducial markers.' },
  { id: 'graph', label: 'Scene Graph', icon: Network, blurb: 'World-transform propagation, depth, branching factor, and overlap detection for a parent/child node hierarchy.' },
];

function newRowId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function n(v: string, fallback = 0): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Spatial mapping ─────────────────────────────────────────────────────

interface AnchorRow {
  id: string; x: string; y: string; z: string;
  w: string; h: string; d: string; surfaceType: string;
}

const SURFACE_TYPES = ['unknown', 'horizontal-plane', 'vertical-plane', 'volumetric', 'slab'];

function blankAnchorRow(): AnchorRow {
  return { id: newRowId('anchor'), x: '0', y: '0', z: '0', w: '1', h: '0.05', d: '1', surfaceType: 'unknown' };
}

// ── Marker detection ────────────────────────────────────────────────────

interface MarkerRow { id: string; code: string; cornersText: string }

function blankMarkerRow(): MarkerRow {
  return { id: newRowId('marker'), code: '1010110010100101', cornersText: '' };
}

function parseCorners(text: string): { x: number; y: number }[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const pairs = trimmed.split(';').map((p) => p.trim()).filter(Boolean);
  if (pairs.length !== 4) return undefined;
  const parsed = pairs.map((p) => {
    const [x, y] = p.split(',').map((v) => Number(v.trim()));
    return { x, y };
  });
  return parsed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? parsed : undefined;
}

// ── Scene graph ──────────────────────────────────────────────────────────

interface NodeRow {
  id: string; parentId: string; x: string; y: string; z: string;
  sx: string; sy: string; sz: string; type: string; meshVertexCount: string;
}

function blankNodeRow(existing: NodeRow[]): NodeRow {
  return {
    id: newRowId('node'), parentId: '', x: '0', y: '0', z: '0',
    sx: '1', sy: '1', sz: '1', type: existing.length === 0 ? 'root' : 'mesh', meshVertexCount: '0',
  };
}

// ── Result types (subset of the real macro response shapes we render) ───

interface SpatialResult {
  message?: string;
  anchorCount?: number;
  anchors?: { id: string; classification: string; volume: number; surfaceArea: number }[];
  spatialGrid?: { occupiedCells: number };
  proximityPairs?: { anchorA: string; anchorB: string; distance: number }[];
  occlusionZones?: { anchorA: string; anchorB: string; overlapVolume: number }[];
  sceneVolume?: number;
}

interface MarkerResult {
  message?: string;
  markerCount?: number;
  setIsValid?: boolean;
  minHammingDistance?: number;
  maxHammingDistance?: number;
  confusablePairs?: { markerA: string; markerB: string; distance: number }[];
  validation?: { id: string; bitBalance: number; isBalanced: boolean; rotationallyUnique: boolean }[];
  poseEstimates?: { id: string; center: { x: number; y: number }; area: number; estimatedDistance: number | null; rotationDeg: number }[];
}

interface GraphResult {
  message?: string;
  totalNodes?: number;
  rootCount?: number;
  maxDepth?: number;
  leafCount?: number;
  avgBranchingFactor?: number;
  totalVertices?: number;
  typeCounts?: Record<string, number>;
  overlappingPairs?: { nodeA: string; nodeB: string; distance: number }[];
  complexity?: { composite: number };
}

export function SpatialDiagnostics() {
  const [tool, setTool] = useState<Tool>('spatial');

  const [anchors, setAnchors] = useState<AnchorRow[]>([blankAnchorRow()]);
  const [gridCellSize, setGridCellSize] = useState('1');
  const [proximityRadius, setProximityRadius] = useState('2');
  const spatial = useMacroDispatchFeedback<SpatialResult>();

  const [markers, setMarkers] = useState<MarkerRow[]>([blankMarkerRow()]);
  const [codeLength, setCodeLength] = useState('16');
  const [minHamming, setMinHamming] = useState('4');
  const markerFb = useMacroDispatchFeedback<MarkerResult>();

  const [nodes, setNodes] = useState<NodeRow[]>([blankNodeRow([])]);
  const graphFb = useMacroDispatchFeedback<GraphResult>();

  const patchAnchor = useCallback((id: string, patch: Partial<AnchorRow>) => {
    setAnchors((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const patchMarker = useCallback((id: string, patch: Partial<MarkerRow>) => {
    setMarkers((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const patchNode = useCallback((id: string, patch: Partial<NodeRow>) => {
    setNodes((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const runSpatial = useCallback(() => {
    spatial.dispatch('ar', 'spatialMapping', {
      anchors: anchors.map((r) => ({
        id: r.id,
        position: { x: n(r.x), y: n(r.y), z: n(r.z) },
        extent: { width: n(r.w, 0.1), height: n(r.h, 0.1), depth: n(r.d, 0.1) },
        surfaceType: r.surfaceType,
      })),
      gridCellSize: n(gridCellSize, 1),
      proximityRadius: n(proximityRadius, 2),
    });
  }, [anchors, gridCellSize, proximityRadius, spatial]);

  const runMarker = useCallback(() => {
    markerFb.dispatch('ar', 'markerDetection', {
      markers: markers.map((r) => ({ id: r.id, code: r.code, corners: parseCorners(r.cornersText) })),
      codeLength: n(codeLength, 16),
      minHammingDistance: n(minHamming, 4),
    });
  }, [markers, codeLength, minHamming, markerFb]);

  const runGraph = useCallback(() => {
    graphFb.dispatch('ar', 'sceneGraph', {
      nodes: nodes.map((r) => ({
        id: r.id,
        parentId: r.parentId || undefined,
        position: { x: n(r.x), y: n(r.y), z: n(r.z) },
        scale: { x: n(r.sx, 1), y: n(r.sy, 1), z: n(r.sz, 1) },
        type: r.type || undefined,
        meshVertexCount: n(r.meshVertexCount),
      })),
    });
  }, [nodes, graphFb]);

  const activeTool = useMemo(() => TOOLS.find((t) => t.id === tool)!, [tool]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
              tool === t.id ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
            )}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>
      <p className={ds.textMuted}>{activeTool.blurb}</p>

      {tool === 'spatial' && (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className={cn(ds.panel, 'space-y-2')}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Anchors ({anchors.length})</span>
              <button onClick={() => setAnchors((r) => [...r, blankAnchorRow()])} className={ds.btnGhost} aria-label="Add anchor">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {anchors.map((r) => (
              <div key={r.id} className="rounded-md border border-lattice-border p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-400">{r.id}</span>
                  <button onClick={() => setAnchors((rows) => rows.filter((x) => x.id !== r.id))} className={ds.btnGhost} aria-label={`Remove anchor ${r.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <input key={axis} type="number" step={0.1} className={cn(ds.input, 'text-xs px-2 py-1')}
                      value={r[axis]} onChange={(e) => patchAnchor(r.id, { [axis]: e.target.value } as Partial<AnchorRow>)}
                      aria-label={`position ${axis}`} placeholder={`pos ${axis}`} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <input type="number" step={0.05} className={cn(ds.input, 'text-xs px-2 py-1')} value={r.w} onChange={(e) => patchAnchor(r.id, { w: e.target.value })} aria-label="width" placeholder="width" />
                  <input type="number" step={0.05} className={cn(ds.input, 'text-xs px-2 py-1')} value={r.h} onChange={(e) => patchAnchor(r.id, { h: e.target.value })} aria-label="height" placeholder="height" />
                  <input type="number" step={0.05} className={cn(ds.input, 'text-xs px-2 py-1')} value={r.d} onChange={(e) => patchAnchor(r.id, { d: e.target.value })} aria-label="depth" placeholder="depth" />
                </div>
                <select className={cn(ds.select, 'text-xs')} value={r.surfaceType} onChange={(e) => patchAnchor(r.id, { surfaceType: e.target.value })}>
                  {SURFACE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div><label className={ds.label}>Grid cell size</label><input type="number" step={0.1} className={ds.input} value={gridCellSize} onChange={(e) => setGridCellSize(e.target.value)} /></div>
              <div><label className={ds.label}>Proximity radius</label><input type="number" step={0.1} className={ds.input} value={proximityRadius} onChange={(e) => setProximityRadius(e.target.value)} /></div>
            </div>
            <button onClick={runSpatial} className={cn(ds.btnPrimary, 'w-full')} disabled={spatial.status === 'dispatched' || spatial.status === 'running'}>
              <Play className="w-4 h-4" /> {spatial.status === 'dispatched' || spatial.status === 'running' ? 'Analyzing…' : 'Run spatial mapping'}
            </button>
            {spatial.status === 'error' && <p className="text-xs text-red-400">{spatial.error}</p>}
          </div>

          <div className={cn(ds.panel, 'space-y-2')}>
            <span className="text-sm text-gray-300">Result</span>
            {!spatial.result && spatial.status !== 'error' && <p className={ds.textMuted}>Run the analysis to see AABB, volume, surface classification, proximity pairs, and occlusion zones.</p>}
            {spatial.result?.message && <p className={ds.textMuted}>{spatial.result.message}</p>}
            {spatial.result?.anchorCount != null && (
              <div className="text-xs space-y-2">
                <p className="text-gray-300">{spatial.result.anchorCount} anchor(s) &middot; {spatial.result.spatialGrid?.occupiedCells ?? 0} occupied grid cell(s) &middot; scene volume {spatial.result.sceneVolume?.toFixed(3)}</p>
                <div className="space-y-1">
                  {spatial.result.anchors?.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded bg-black/20 px-2 py-1">
                      <span className="font-mono text-gray-400">{a.id}</span>
                      <span className="text-neon-cyan">{a.classification}</span>
                      <span className="text-gray-400">vol {a.volume} &middot; area {a.surfaceArea}</span>
                    </div>
                  ))}
                </div>
                {(spatial.result.proximityPairs?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-gray-400 mt-1">Proximity pairs</p>
                    {spatial.result.proximityPairs!.map((p, i) => (
                      <p key={i} className="text-gray-500">{p.anchorA} ↔ {p.anchorB}: {p.distance}m</p>
                    ))}
                  </div>
                )}
                {(spatial.result.occlusionZones?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-1.5 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{spatial.result.occlusionZones!.length} occlusion zone(s) detected (overlapping bounding volumes).</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tool === 'marker' && (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className={cn(ds.panel, 'space-y-2')}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Markers ({markers.length})</span>
              <button onClick={() => setMarkers((r) => [...r, blankMarkerRow()])} className={ds.btnGhost} aria-label="Add marker">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {markers.map((r) => (
              <div key={r.id} className="rounded-md border border-lattice-border p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-400">{r.id}</span>
                  <button onClick={() => setMarkers((rows) => rows.filter((x) => x.id !== r.id))} className={ds.btnGhost} aria-label={`Remove marker ${r.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
                <div>
                  <label className={ds.label}>Binary code</label>
                  <input className={cn(ds.input, 'text-xs font-mono')} value={r.code} onChange={(e) => patchMarker(r.id, { code: e.target.value.replace(/[^01]/g, '') })} placeholder="1010110010100101" />
                </div>
                <div>
                  <label className={ds.label}>Corners (optional, x,y;x,y;x,y;x,y)</label>
                  <input className={cn(ds.input, 'text-xs')} value={r.cornersText} onChange={(e) => patchMarker(r.id, { cornersText: e.target.value })} placeholder="0,0; 40,0; 40,40; 0,40" />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div><label className={ds.label}>Code length (bits)</label><input type="number" className={ds.input} value={codeLength} onChange={(e) => setCodeLength(e.target.value)} /></div>
              <div><label className={ds.label}>Min Hamming distance</label><input type="number" className={ds.input} value={minHamming} onChange={(e) => setMinHamming(e.target.value)} /></div>
            </div>
            <button onClick={runMarker} className={cn(ds.btnPrimary, 'w-full')} disabled={markerFb.status === 'dispatched' || markerFb.status === 'running'}>
              <Play className="w-4 h-4" /> {markerFb.status === 'dispatched' || markerFb.status === 'running' ? 'Analyzing…' : 'Run marker detection'}
            </button>
            {markerFb.status === 'error' && <p className="text-xs text-red-400">{markerFb.error}</p>}
          </div>

          <div className={cn(ds.panel, 'space-y-2')}>
            <span className="text-sm text-gray-300">Result</span>
            {!markerFb.result && markerFb.status !== 'error' && <p className={ds.textMuted}>Run detection to see Hamming distances, bit-balance validation, and (if corners were given) pose estimates.</p>}
            {markerFb.result?.message && <p className={ds.textMuted}>{markerFb.result.message}</p>}
            {markerFb.result?.markerCount != null && (
              <div className="text-xs space-y-2">
                <div className={cn('flex items-center gap-1.5', markerFb.result.setIsValid ? 'text-emerald-300' : 'text-amber-400')}>
                  {markerFb.result.setIsValid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{markerFb.result.markerCount} marker(s) &middot; {markerFb.result.setIsValid ? 'set is distinguishable' : `${markerFb.result.confusablePairs?.length ?? 0} confusable pair(s)`} &middot; Hamming range {markerFb.result.minHammingDistance}–{markerFb.result.maxHammingDistance}</span>
                </div>
                <div className="space-y-1">
                  {markerFb.result.validation?.map((v) => (
                    <div key={v.id} className="flex items-center justify-between rounded bg-black/20 px-2 py-1">
                      <span className="font-mono text-gray-400">{v.id}</span>
                      <span className={v.isBalanced ? 'text-emerald-300' : 'text-amber-400'}>bit balance {v.bitBalance}</span>
                      <span className="text-gray-400">{v.rotationallyUnique ? 'rotation-unique' : 'rotation-ambiguous'}</span>
                    </div>
                  ))}
                </div>
                {(markerFb.result.poseEstimates?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-gray-400 mt-1">Pose estimates</p>
                    {markerFb.result.poseEstimates!.map((p) => (
                      <p key={p.id} className="text-gray-500 font-mono">{p.id}: center ({p.center.x}, {p.center.y}) &middot; area {p.area} &middot; ~{p.estimatedDistance ?? '—'}cm &middot; {p.rotationDeg}°</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tool === 'graph' && (
        <div className="grid lg:grid-cols-2 gap-3">
          <div className={cn(ds.panel, 'space-y-2')}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Nodes ({nodes.length})</span>
              <button onClick={() => setNodes((r) => [...r, blankNodeRow(r)])} className={ds.btnGhost} aria-label="Add node">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {nodes.map((r) => (
              <div key={r.id} className="rounded-md border border-lattice-border p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-400">{r.id}</span>
                  <button onClick={() => setNodes((rows) => rows.filter((x) => x.id !== r.id))} className={ds.btnGhost} aria-label={`Remove node ${r.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input className={cn(ds.input, 'text-xs')} value={r.type} onChange={(e) => patchNode(r.id, { type: e.target.value })} placeholder="type (mesh, light, …)" />
                  <select className={cn(ds.select, 'text-xs')} value={r.parentId} onChange={(e) => patchNode(r.id, { parentId: e.target.value })}>
                    <option value="">— root (no parent) —</option>
                    {nodes.filter((n2) => n2.id !== r.id).map((n2) => <option key={n2.id} value={n2.id}>{n2.id}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <input key={axis} type="number" step={0.1} className={cn(ds.input, 'text-xs px-2 py-1')} value={r[axis]} onChange={(e) => patchNode(r.id, { [axis]: e.target.value } as Partial<NodeRow>)} aria-label={`local position ${axis}`} placeholder={`pos ${axis}`} />
                  ))}
                </div>
                <input type="number" className={cn(ds.input, 'text-xs')} value={r.meshVertexCount} onChange={(e) => patchNode(r.id, { meshVertexCount: e.target.value })} placeholder="mesh vertex count" />
              </div>
            ))}
            <button onClick={runGraph} className={cn(ds.btnPrimary, 'w-full')} disabled={graphFb.status === 'dispatched' || graphFb.status === 'running'}>
              <Play className="w-4 h-4" /> {graphFb.status === 'dispatched' || graphFb.status === 'running' ? 'Analyzing…' : 'Analyze scene graph'}
            </button>
            {graphFb.status === 'error' && <p className="text-xs text-red-400">{graphFb.error}</p>}
          </div>

          <div className={cn(ds.panel, 'space-y-2')}>
            <span className="text-sm text-gray-300">Result</span>
            {!graphFb.result && graphFb.status !== 'error' && <p className={ds.textMuted}>Analyze to see world-transform propagation, tree depth, branching factor, and overlap detection.</p>}
            {graphFb.result?.message && <p className={ds.textMuted}>{graphFb.result.message}</p>}
            {graphFb.result?.totalNodes != null && (
              <div className="text-xs space-y-2">
                <p className="text-gray-300">{graphFb.result.totalNodes} node(s) &middot; {graphFb.result.rootCount} root(s) &middot; depth {graphFb.result.maxDepth} &middot; {graphFb.result.leafCount} leaf(ves)</p>
                <p className="text-gray-400">branching {graphFb.result.avgBranchingFactor} &middot; {graphFb.result.totalVertices?.toLocaleString()} total vertices &middot; complexity {graphFb.result.complexity?.composite}</p>
                {graphFb.result.typeCounts && (
                  <p className="text-gray-500">{Object.entries(graphFb.result.typeCounts).map(([k, v]) => `${k}×${v}`).join(', ')}</p>
                )}
                {(graphFb.result.overlappingPairs?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-1.5 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{graphFb.result.overlappingPairs!.length} overlapping node pair(s) in world space.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
