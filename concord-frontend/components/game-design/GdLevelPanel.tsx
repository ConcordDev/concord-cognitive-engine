'use client';

/**
 * GdLevelPanel — a Tiled + LDtk shape tilemap level editor. Levels hold
 * tile / object / IntGrid layers; tile layers paint greybox or custom
 * tiles, IntGrid layers paint integer collision/region values that
 * auto-layer rules turn into tiles, object layers place named instances.
 * Every edit persists through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, Grid3x3, ArrowLeft, Eye, EyeOff, PaintBucket, Eraser,
  Copy, ChevronUp, ChevronDown, Wand2, Maximize2, Download, Layers,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type LayerKind = 'tile' | 'object' | 'intgrid';
interface Tile { id: string; name: string; color: string; category: string }
interface GdObject {
  id: string; name: string; x: number; y: number; w: number; h: number;
  entityId: string | null; color: string; props: Record<string, unknown>;
}
interface Layer {
  id: string; name: string; kind: LayerKind; visible: boolean; opacity: number;
  tiles?: (string | number | null)[]; objects?: GdObject[];
}
interface Level {
  id: string; name: string; gameId: string; cols: number; rows: number;
  tileSize: number; orientation: string; layers: Layer[];
}
interface LevelMeta { id: string; name: string; cols: number; rows: number; layerCount: number }
interface AutoRule { id: string; intValue: number; tile: string }
interface EntityLite { id: string; name: string; kind: string }

const CELL = 26;
const ORIENTATIONS = ['orthogonal', 'isometric', 'hexagonal'];
const INT_COLORS = ['#000', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#84cc16'];

export function GdLevelPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [levels, setLevels] = useState<LevelMeta[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', cols: 20, rows: 14, orientation: 'orthogonal' });

  const refreshList = useCallback(async () => {
    const r = await lensRun('game-design', 'level-list', { gameId });
    setLevels(r.data?.result?.levels || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const createLevel = async () => {
    const r = await lensRun('game-design', 'level-create', {
      gameId, name: form.name.trim() || 'New level', cols: form.cols, rows: form.rows,
      orientation: form.orientation,
    });
    setForm({ name: '', cols: 20, rows: 14, orientation: 'orthogonal' });
    await refreshList();
    if (r.data?.result?.level?.id) setOpen(r.data.result.level.id);
  };

  const delLevel = async (id: string) => {
    await lensRun('game-design', 'level-delete', { id });
    if (open === id) setOpen(null);
    await refreshList();
  };

  const dupLevel = async (id: string) => {
    await lensRun('game-design', 'level-duplicate', { id });
    await refreshList();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (open) {
    return <LevelEditor levelId={open} gameId={gameId} onExit={() => { setOpen(null); void refreshList(); }} />;
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Level name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <label className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-400">
          Cols
          <input type="number" min={4} max={64} value={form.cols}
            onChange={(e) => setForm({ ...form, cols: Math.max(4, Math.min(64, Number(e.target.value) || 20)) })}
            className="w-full bg-transparent py-1.5 text-xs text-zinc-100" />
        </label>
        <label className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-400">
          Rows
          <input type="number" min={4} max={64} value={form.rows}
            onChange={(e) => setForm({ ...form, rows: Math.max(4, Math.min(64, Number(e.target.value) || 14)) })}
            className="w-full bg-transparent py-1.5 text-xs text-zinc-100" />
        </label>
        <select value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {ORIENTATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" onClick={createLevel}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New level
        </button>
      </section>

      {levels.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No levels yet. Create one to open the tilemap editor.</p>
      ) : (
        <ul className="space-y-1.5">
          {levels.map((l) => (
            <li key={l.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <Grid3x3 className="w-4 h-4 text-lime-400 shrink-0" />
              <button type="button" onClick={() => setOpen(l.id)} className="flex-1 text-left">
                <span className="text-xs text-zinc-100">{l.name}</span>
                <span className="text-[10px] text-zinc-400 ml-2">{l.cols}×{l.rows} · {l.layerCount} layers</span>
              </button>
              <button type="button" onClick={() => setOpen(l.id)}
                className="text-[11px] px-2 py-0.5 bg-lime-600 hover:bg-lime-500 text-white rounded">Edit</button>
              <button type="button" onClick={() => dupLevel(l.id)} className="text-zinc-600 hover:text-sky-400" title="Duplicate">
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button aria-label="Delete" type="button" onClick={() => delLevel(l.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LevelEditor({ levelId, gameId, onExit }: { levelId: string; gameId: string; onExit: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [entities, setEntities] = useState<EntityLite[]>([]);
  const [autoRules, setAutoRules] = useState<AutoRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState('');
  const [activeTile, setActiveTile] = useState<string | null>('grass');
  const [activeInt, setActiveInt] = useState(1);
  const [selectedObj, setSelectedObj] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'rules' | 'resize' | 'export'>('none');
  const [newTile, setNewTile] = useState({ name: '', color: '#94a3b8' });
  const [resize, setResize] = useState({ cols: 0, rows: 0 });
  const [exportJson, setExportJson] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const dragObjRef = useRef<string | null>(null);
  const dirtyRef = useRef<Map<number, string | number | null>>(new Map());
  const colorMap = useRef<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    const [lv, tl, gg, ar] = await Promise.all([
      lensRun('game-design', 'level-get', { id: levelId }),
      lensRun('game-design', 'tile-list', { gameId }),
      lensRun('game-design', 'game-get', { id: gameId }),
      lensRun('game-design', 'autotile-rule-list', { gameId }),
    ]);
    const lvl = (lv.data?.result?.level as Level) || null;
    const ts = (tl.data?.result?.all as Tile[]) || [];
    colorMap.current = Object.fromEntries(ts.map((t) => [t.id, t.color]));
    setLevel(lvl);
    setTiles(ts);
    setEntities((gg.data?.result?.entities as EntityLite[]) || []);
    setAutoRules((ar.data?.result?.rules as AutoRule[]) || []);
    if (lvl) {
      setActiveLayer((prev) => (lvl.layers.some((l) => l.id === prev) ? prev : lvl.layers[lvl.layers.length - 1]?.id || ''));
      setResize({ cols: lvl.cols, rows: lvl.rows });
    }
    setLoading(false);
  }, [levelId, gameId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const layer = level?.layers.find((l) => l.id === activeLayer) || null;

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !level) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const ly of level.layers) {
      if (!ly.visible) continue;
      ctx.globalAlpha = ly.opacity ?? 1;
      if (ly.kind === 'object') {
        for (const o of ly.objects || []) {
          const ox = (o.x / level.tileSize) * CELL;
          const oy = (o.y / level.tileSize) * CELL;
          const ow = (o.w / level.tileSize) * CELL;
          const oh = (o.h / level.tileSize) * CELL;
          ctx.fillStyle = `${o.color}33`;
          ctx.fillRect(ox, oy, ow, oh);
          ctx.strokeStyle = o.id === selectedObj ? '#fff' : o.color;
          ctx.lineWidth = o.id === selectedObj ? 2 : 1.5;
          ctx.strokeRect(ox + 1, oy + 1, ow - 2, oh - 2);
          ctx.fillStyle = '#e4e4e7';
          ctx.font = '9px sans-serif';
          ctx.fillText(o.name.slice(0, 10), ox + 3, oy + 11);
        }
      } else {
        for (let i = 0; i < (ly.tiles?.length || 0); i++) {
          const t = ly.tiles![i];
          if (t == null || t === 0) continue;
          const col = i % level.cols;
          const row = Math.floor(i / level.cols);
          if (ly.kind === 'intgrid') {
            const v = Number(t);
            ctx.fillStyle = `${INT_COLORS[v % INT_COLORS.length]}88`;
            ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(String(v), col * CELL + CELL / 2 - 3, row * CELL + CELL / 2 + 4);
          } else {
            ctx.fillStyle = colorMap.current[String(t)] || '#52525b';
            ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(113,113,122,0.25)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= level.cols; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, level.rows * CELL); ctx.stroke();
    }
    for (let r = 0; r <= level.rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(level.cols * CELL, r * CELL); ctx.stroke();
    }
  }, [level, selectedObj]);

  useEffect(() => { render(); }, [render]);

  const cellAt = (e: React.PointerEvent): { col: number; row: number; index: number } | null => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cv.width;
    const y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    if (!level || col < 0 || row < 0 || col >= level.cols || row >= level.rows) return null;
    return { col, row, index: row * level.cols + col };
  };

  const paintCell = (index: number) => {
    if (!level || !layer || layer.kind === 'object') return;
    const value: string | number | null = layer.kind === 'intgrid' ? activeInt : activeTile;
    setLevel((prev) => prev && ({
      ...prev,
      layers: prev.layers.map((l) => {
        if (l.id !== activeLayer) return l;
        const next = [...(l.tiles || [])];
        next[index] = value;
        return { ...l, tiles: next };
      }),
    }));
    dirtyRef.current.set(index, value);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const c = cellAt(e);
    if (!c || !level || !layer) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (layer.kind === 'object') {
      const px = c.col * level.tileSize;
      const py = c.row * level.tileSize;
      const hit = (layer.objects || []).find((o) =>
        px >= o.x - level.tileSize / 2 && px <= o.x + o.w && py >= o.y - level.tileSize / 2 && py <= o.y + o.h);
      if (hit) { setSelectedObj(hit.id); dragObjRef.current = hit.id; }
      else { void placeObject(c.col, c.row); }
      return;
    }
    paintingRef.current = true;
    dirtyRef.current = new Map();
    paintCell(c.index);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = cellAt(e);
    if (!c) return;
    if (dragObjRef.current && level) {
      const id = dragObjRef.current;
      const nx = c.col * level.tileSize, ny = c.row * level.tileSize;
      setLevel((prev) => prev && ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === activeLayer
          ? { ...l, objects: (l.objects || []).map((o) => (o.id === id ? { ...o, x: nx, y: ny } : o)) } : l)),
      }));
      return;
    }
    if (!paintingRef.current) return;
    paintCell(c.index);
  };

  const onPointerUp = async () => {
    if (dragObjRef.current && level) {
      const id = dragObjRef.current;
      dragObjRef.current = null;
      const obj = layer?.objects?.find((o) => o.id === id);
      if (obj) await lensRun('game-design', 'level-object-update', { levelId: level.id, id, x: obj.x, y: obj.y });
      return;
    }
    if (!paintingRef.current || !level) return;
    paintingRef.current = false;
    const cells = [...dirtyRef.current.entries()].map(([index, tile]) => ({ index, tile }));
    dirtyRef.current = new Map();
    if (cells.length) {
      await lensRun('game-design', 'level-paint-batch', { levelId: level.id, layerId: activeLayer, cells });
    }
  };

  const placeObject = async (col: number, row: number) => {
    if (!level || !layer || layer.kind !== 'object') return;
    const r = await lensRun('game-design', 'level-object-add', {
      levelId: level.id, layerId: activeLayer, name: 'Object',
      x: col * level.tileSize, y: row * level.tileSize, w: level.tileSize, h: level.tileSize,
    });
    const obj = r.data?.result?.object as GdObject | undefined;
    if (obj) {
      setLevel({ ...level, layers: level.layers.map((l) => (l.id === activeLayer ? { ...l, objects: [...(l.objects || []), obj] } : l)) });
      setSelectedObj(obj.id);
    }
  };

  const updateObject = async (id: string, patch: Partial<GdObject>) => {
    if (!level) return;
    setLevel({
      ...level,
      layers: level.layers.map((l) => (l.id === activeLayer
        ? { ...l, objects: (l.objects || []).map((o) => (o.id === id ? { ...o, ...patch } : o)) } : l)),
    });
    await lensRun('game-design', 'level-object-update', { levelId: level.id, id, ...patch });
  };

  const deleteObject = async (id: string) => {
    if (!level) return;
    setLevel({ ...level, layers: level.layers.map((l) => ({ ...l, objects: (l.objects || []).filter((o) => o.id !== id) })) });
    if (selectedObj === id) setSelectedObj(null);
    await lensRun('game-design', 'level-object-delete', { levelId: level.id, id });
  };

  const toggleVisible = async (ly: Layer) => {
    if (!level) return;
    setLevel({ ...level, layers: level.layers.map((l) => (l.id === ly.id ? { ...l, visible: !l.visible } : l)) });
    await lensRun('game-design', 'level-layer-update', { levelId: level.id, layerId: ly.id, visible: !ly.visible });
  };

  const setOpacity = async (ly: Layer, opacity: number) => {
    if (!level) return;
    setLevel({ ...level, layers: level.layers.map((l) => (l.id === ly.id ? { ...l, opacity } : l)) });
    await lensRun('game-design', 'level-layer-update', { levelId: level.id, layerId: ly.id, opacity });
  };

  const addLayer = async (kind: LayerKind) => {
    if (!level) return;
    const r = await lensRun('game-design', 'level-layer-add', { levelId: level.id, kind });
    const ly = r.data?.result?.layer as Layer | undefined;
    if (ly) { setLevel({ ...level, layers: [...level.layers, ly] }); setActiveLayer(ly.id); }
  };

  const dupLayer = async (ly: Layer) => {
    if (!level) return;
    await lensRun('game-design', 'level-layer-duplicate', { levelId: level.id, layerId: ly.id });
    await loadAll();
  };

  const delLayer = async (ly: Layer) => {
    if (!level || level.layers.length <= 1) return;
    await lensRun('game-design', 'level-layer-delete', { levelId: level.id, layerId: ly.id });
    await loadAll();
  };

  const moveLayer = async (ly: Layer, dir: -1 | 1) => {
    if (!level) return;
    const idx = level.layers.findIndex((l) => l.id === ly.id);
    const swap = idx + dir;
    if (swap < 0 || swap >= level.layers.length) return;
    const order = level.layers.map((l) => l.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    setLevel({ ...level, layers: order.map((id) => level.layers.find((l) => l.id === id)!) });
    await lensRun('game-design', 'level-layer-reorder', { levelId: level.id, order });
  };

  const fillLayer = async () => {
    if (!level || !layer || layer.kind === 'object') return;
    const value = layer.kind === 'intgrid' ? activeInt : activeTile;
    setLevel({
      ...level,
      layers: level.layers.map((l) => (l.id === activeLayer
        ? { ...l, tiles: new Array(level.cols * level.rows).fill(value) } : l)),
    });
    await lensRun('game-design', 'level-fill-layer', { levelId: level.id, layerId: activeLayer, tile: value });
  };

  const createTile = async () => {
    if (!newTile.name.trim()) return;
    const r = await lensRun('game-design', 'tile-create', { gameId, name: newTile.name.trim(), color: newTile.color });
    const t = r.data?.result?.tile as Tile | undefined;
    if (t) { colorMap.current[t.id] = t.color; setTiles([...tiles, t]); setActiveTile(t.id); setNewTile({ name: '', color: '#94a3b8' }); }
  };

  const addRule = async (intValue: number, tile: string) => {
    const r = await lensRun('game-design', 'autotile-rule-add', { gameId, intValue, tile });
    if (r.data?.result?.rule) setAutoRules([...autoRules, r.data.result.rule]);
  };
  const delRule = async (id: string) => {
    await lensRun('game-design', 'autotile-rule-delete', { id });
    setAutoRules(autoRules.filter((r) => r.id !== id));
  };

  const applyAutotile = async (sourceLayerId: string) => {
    if (!level || !layer || layer.kind !== 'tile') return;
    await lensRun('game-design', 'level-autotile', { levelId: level.id, sourceLayerId, targetLayerId: activeLayer });
    await loadAll();
  };

  const doResize = async () => {
    if (!level) return;
    await lensRun('game-design', 'level-resize', { levelId: level.id, cols: resize.cols, rows: resize.rows });
    setPanel('none');
    await loadAll();
  };

  const doExport = async () => {
    if (!level) return;
    const r = await lensRun('game-design', 'level-export', { id: level.id });
    setExportJson((r.data?.result?.json as string) || '');
    setPanel('export');
  };

  const setOrientation = async (orientation: string) => {
    if (!level) return;
    setLevel({ ...level, orientation });
    await lensRun('game-design', 'level-update', { id: level.id, orientation });
  };

  if (loading || !level) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const intLayers = level.layers.filter((l) => l.kind === 'intgrid');
  const selObj = layer?.kind === 'object' ? (layer.objects || []).find((o) => o.id === selectedObj) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExit}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> Levels
        </button>
        <span className="text-sm font-semibold text-zinc-100 truncate">{level.name}</span>
        <span className="text-[11px] text-zinc-400">{level.cols}×{level.rows}</span>
        <select value={level.orientation} onChange={(e) => setOrientation(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-200 capitalize">
          {ORIENTATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={() => setPanel(panel === 'rules' ? 'none' : 'rules')}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <Wand2 className="w-3.5 h-3.5" /> Auto-layer
        </button>
        <button type="button" onClick={() => setPanel(panel === 'resize' ? 'none' : 'resize')}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <Maximize2 className="w-3.5 h-3.5" /> Resize
        </button>
        <button type="button" onClick={doExport}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {panel === 'resize' && (
        <div className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg p-2">
          <label className="text-[11px] text-zinc-400 flex items-center gap-1">Cols
            <input type="number" min={4} max={64} value={resize.cols}
              onChange={(e) => setResize({ ...resize, cols: Number(e.target.value) || level.cols })}
              className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100" /></label>
          <label className="text-[11px] text-zinc-400 flex items-center gap-1">Rows
            <input type="number" min={4} max={64} value={resize.rows}
              onChange={(e) => setResize({ ...resize, rows: Number(e.target.value) || level.rows })}
              className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100" /></label>
          <button type="button" onClick={doResize}
            className="px-2.5 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 text-white rounded-lg">Apply resize</button>
        </div>
      )}

      {panel === 'export' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2">
          <textarea readOnly value={exportJson} rows={8}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[10px] text-zinc-300 font-mono resize-y" />
        </div>
      )}

      {panel === 'rules' && (
        <AutoRulePanel rules={autoRules} tiles={tiles} intLayers={intLayers}
          canApply={layer?.kind === 'tile'} onAdd={addRule} onDelete={delRule} onApply={applyAutotile} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-3">
        <div className="bg-zinc-900 rounded-xl p-2 overflow-auto">
          <canvas
            ref={canvasRef}
            width={level.cols * CELL}
            height={level.rows * CELL}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="rounded cursor-crosshair"
            style={{ maxWidth: '100%', touchAction: 'none', imageRendering: 'pixelated' }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300"><Layers className="w-3.5 h-3.5" /> Layers</h3>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button type="button" onClick={() => addLayer('tile')}
              className="px-1.5 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">+ Tile</button>
            <button type="button" onClick={() => addLayer('object')}
              className="px-1.5 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">+ Object</button>
            <button type="button" onClick={() => addLayer('intgrid')}
              className="px-1.5 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">+ IntGrid</button>
          </div>
          <ul className="space-y-1">
            {[...level.layers].reverse().map((l) => (
              <li key={l.id}
                className={cn('rounded-lg border px-2 py-1.5 space-y-1',
                  activeLayer === l.id ? 'border-lime-600 bg-lime-950/30' : 'border-zinc-800 bg-zinc-900/70')}>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => toggleVisible(l)} className="text-zinc-400 hover:text-zinc-200">
                    {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" onClick={() => setActiveLayer(l.id)} className="flex-1 text-left text-xs text-zinc-200 truncate">
                    {l.name}
                    <span className="ml-1 text-[9px] text-zinc-400 uppercase">{l.kind}</span>
                  </button>
                  <button aria-label="Collapse" type="button" onClick={() => moveLayer(l, 1)} className="text-zinc-600 hover:text-zinc-300"><ChevronUp className="w-3 h-3" /></button>
                  <button aria-label="Expand" type="button" onClick={() => moveLayer(l, -1)} className="text-zinc-600 hover:text-zinc-300"><ChevronDown className="w-3 h-3" /></button>
                  <button aria-label="Copy" type="button" onClick={() => dupLayer(l)} className="text-zinc-600 hover:text-sky-400"><Copy className="w-3 h-3" /></button>
                  {level.layers.length > 1 && (
                    <button aria-label="Delete" type="button" onClick={() => delLayer(l)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
                <input type="range" min={0} max={1} step={0.1} value={l.opacity ?? 1}
                  onChange={(e) => setOpacity(l, Number(e.target.value))}
                  className="w-full h-1 accent-lime-500" />
              </li>
            ))}
          </ul>
          {layer && layer.kind !== 'object' && (
            <button type="button" onClick={fillLayer}
              className="flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <PaintBucket className="w-3.5 h-3.5" /> Fill layer
            </button>
          )}
        </div>
      </div>

      {/* Brush — depends on active layer kind */}
      {layer?.kind === 'tile' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300">Tiles</h3>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setActiveTile(null)}
              className={cn('flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border',
                activeTile === null ? 'border-lime-500 bg-lime-950/40 text-lime-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300')}>
              <Eraser className="w-3 h-3" /> Erase
            </button>
            {tiles.map((t) => (
              <button key={t.id} type="button" onClick={() => setActiveTile(t.id)}
                className={cn('flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg border',
                  activeTile === t.id ? 'border-lime-500 bg-lime-950/40 text-lime-100' : 'border-zinc-700 bg-zinc-800 text-zinc-300')}>
                <span className="w-3.5 h-3.5 rounded border border-black/30" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
            <input placeholder="Custom tile name" value={newTile.name}
              onChange={(e) => setNewTile({ ...newTile, name: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
            <input type="color" value={newTile.color} onChange={(e) => setNewTile({ ...newTile, color: e.target.value })}
              className="w-8 h-7 bg-zinc-950 border border-zinc-700 rounded" />
            <button type="button" onClick={createTile}
              className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">+ Tile</button>
          </div>
        </div>
      )}

      {layer?.kind === 'intgrid' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
          <h3 className="text-xs font-semibold text-zinc-300">IntGrid value</h3>
          <p className="text-[10px] text-zinc-400">Paint integer values, then map them to tiles in Auto-layer.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setActiveInt(0)}
              className={cn('flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border',
                activeInt === 0 ? 'border-lime-500 bg-lime-950/40 text-lime-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300')}>
              <Eraser className="w-3 h-3" /> 0
            </button>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => (
              <button key={v} type="button" onClick={() => setActiveInt(v)}
                className={cn('flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border',
                  activeInt === v ? 'border-lime-500 bg-lime-950/40 text-lime-100' : 'border-zinc-700 bg-zinc-800 text-zinc-300')}>
                <span className="w-3 h-3 rounded" style={{ background: INT_COLORS[v] }} />{v}
              </button>
            ))}
          </div>
        </div>
      )}

      {layer?.kind === 'object' && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300">Objects</h3>
          <p className="text-[10px] text-zinc-400">Click an empty cell to place an object; click + drag an object to move it.</p>
          {(layer.objects || []).length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No objects on this layer yet.</p>
          ) : (
            <ul className="space-y-1">
              {(layer.objects || []).map((o) => (
                <li key={o.id}
                  className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5',
                    selectedObj === o.id ? 'border-lime-600 bg-lime-950/30' : 'border-zinc-800 bg-zinc-950/60')}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: o.color }} />
                  <input value={o.name} onChange={(e) => updateObject(o.id, { name: e.target.value })}
                    onFocus={() => setSelectedObj(o.id)}
                    className="flex-1 bg-transparent text-[11px] text-zinc-100 focus:outline-none" />
                  <select value={o.entityId || ''} onChange={(e) => updateObject(o.id, { entityId: e.target.value || null })}
                    className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300 max-w-[110px]">
                    <option value="">— entity —</option>
                    {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <span className="text-[10px] text-zinc-400">{Math.round(o.x / level.tileSize)},{Math.round(o.y / level.tileSize)}</span>
                  <button aria-label="Delete" type="button" onClick={() => deleteObject(o.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selObj && (
            <p className="text-[10px] text-lime-400/80">Selected: {selObj.name} — drag on the grid to reposition.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AutoRulePanel({
  rules, tiles, intLayers, canApply, onAdd, onDelete, onApply,
}: {
  rules: AutoRule[]; tiles: Tile[]; intLayers: Layer[]; canApply: boolean;
  onAdd: (v: number, tile: string) => void; onDelete: (id: string) => void; onApply: (sourceLayerId: string) => void;
}) {
  const [draft, setDraft] = useState({ intValue: 1, tile: tiles[0]?.id || 'grass' });
  const [source, setSource] = useState(intLayers[0]?.id || '');
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 space-y-2">
      <h3 className="text-xs font-semibold text-zinc-300">Auto-layer rules — IntGrid value → tile</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select value={draft.intValue} onChange={(e) => setDraft({ ...draft, intValue: Number(e.target.value) })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => <option key={v} value={v}>value {v}</option>)}
        </select>
        <span className="text-zinc-400 text-xs">→</span>
        <select value={draft.tile} onChange={(e) => setDraft({ ...draft, tile: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100">
          {tiles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button type="button" onClick={() => onAdd(draft.intValue, draft.tile)}
          className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">+ Rule</button>
      </div>
      {rules.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-300">
              <span className="font-bold">{r.intValue}</span>
              <span className="text-zinc-400">→</span>
              <span className="w-3 h-3 rounded border border-black/30" style={{ background: tiles.find((t) => t.id === r.tile)?.color || '#52525b' }} />
              <span>{tiles.find((t) => t.id === r.tile)?.name || r.tile}</span>
              <button aria-label="Delete" type="button" onClick={() => onDelete(r.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
        <span className="text-[11px] text-zinc-400">Apply to active tile layer from:</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100">
          {intLayers.length === 0 && <option value="">no IntGrid layers</option>}
          {intLayers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" disabled={!canApply || !source}
          onClick={() => onApply(source)}
          className={cn('px-2.5 py-1 text-[11px] rounded-lg',
            canApply && source ? 'bg-lime-600 hover:bg-lime-500 text-white' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed')}>
          Auto-fill
        </button>
      </div>
      {!canApply && <p className="text-[10px] text-amber-500/80">Select a tile layer as the active layer to auto-fill it.</p>}
    </div>
  );
}
