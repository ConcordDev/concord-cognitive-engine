'use client';

/**
 * GdLevelPanel — a grid tilemap level editor. Levels hold paintable
 * layers of greybox tiles; every paint persists through lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, Grid3x3, ArrowLeft, Eye, EyeOff, PaintBucket, Eraser,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Tile { id: string; name: string; color: string; category: string }
interface Layer { id: string; name: string; visible: boolean; tiles: (string | null)[] }
interface Level { id: string; name: string; cols: number; rows: number; layers: Layer[] }
interface LevelMeta { id: string; name: string; cols: number; rows: number; layerCount: number }

const CELL = 26;

export function GdLevelPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [levels, setLevels] = useState<LevelMeta[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', cols: 20, rows: 14 });

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
    });
    setForm({ name: '', cols: 20, rows: 14 });
    await refreshList();
    if (r.data?.result?.level?.id) setOpen(r.data.result.level.id);
  };

  const delLevel = async (id: string) => {
    await lensRun('game-design', 'level-delete', { id });
    if (open === id) setOpen(null);
    await refreshList();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (open) {
    return <LevelEditor levelId={open} onExit={() => { setOpen(null); void refreshList(); }} />;
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
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
        <button type="button" onClick={createLevel}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New level
        </button>
      </section>

      {levels.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No levels yet. Create one to open the tilemap editor.</p>
      ) : (
        <ul className="space-y-1.5">
          {levels.map((l) => (
            <li key={l.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <Grid3x3 className="w-4 h-4 text-lime-400 shrink-0" />
              <button type="button" onClick={() => setOpen(l.id)} className="flex-1 text-left">
                <span className="text-xs text-zinc-100">{l.name}</span>
                <span className="text-[10px] text-zinc-500 ml-2">{l.cols}×{l.rows} · {l.layerCount} layers</span>
              </button>
              <button type="button" onClick={() => setOpen(l.id)}
                className="text-[11px] px-2 py-0.5 bg-lime-600 hover:bg-lime-500 text-white rounded">Edit</button>
              <button type="button" onClick={() => delLevel(l.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LevelEditor({ levelId, onExit }: { levelId: string; onExit: () => void }) {
  const [level, setLevel] = useState<Level | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState('');
  const [activeTile, setActiveTile] = useState<string | null>('grass');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const dirtyRef = useRef<Map<number, string | null>>(new Map());
  const colorMap = useRef<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const [lv, pal] = await Promise.all([
        lensRun('game-design', 'level-get', { id: levelId }),
        lensRun('game-design', 'tile-palette', {}),
      ]);
      if (!active) return;
      const lvl = (lv.data?.result?.level as Level) || null;
      const ts = (pal.data?.result?.tiles as Tile[]) || [];
      colorMap.current = Object.fromEntries(ts.map((t) => [t.id, t.color]));
      setLevel(lvl);
      setTiles(ts);
      setActiveLayer(lvl?.layers?.[lvl.layers.length - 1]?.id || '');
      setLoading(false);
    })();
    return () => { active = false; };
  }, [levelId]);

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !level) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const layer of level.layers) {
      if (!layer.visible) continue;
      for (let i = 0; i < layer.tiles.length; i++) {
        const tile = layer.tiles[i];
        if (!tile) continue;
        const col = i % level.cols;
        const row = Math.floor(i / level.cols);
        ctx.fillStyle = colorMap.current[tile] || '#52525b';
        ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(113,113,122,0.25)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= level.cols; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, level.rows * CELL); ctx.stroke();
    }
    for (let r = 0; r <= level.rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(level.cols * CELL, r * CELL); ctx.stroke();
    }
  }, [level]);

  useEffect(() => { render(); }, [render]);

  const cellAt = (e: React.PointerEvent): number => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * cv.width;
    const y = ((e.clientY - rect.top) / rect.height) * cv.height;
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    if (!level || col < 0 || row < 0 || col >= level.cols || row >= level.rows) return -1;
    return row * level.cols + col;
  };

  const paintCell = (index: number) => {
    if (index < 0 || !level || !activeLayer) return;
    setLevel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers: prev.layers.map((l) => {
          if (l.id !== activeLayer) return l;
          const next = [...l.tiles];
          next[index] = activeTile;
          return { ...l, tiles: next };
        }),
      };
    });
    dirtyRef.current.set(index, activeTile);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    paintingRef.current = true;
    dirtyRef.current = new Map();
    paintCell(cellAt(e));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!paintingRef.current) return;
    paintCell(cellAt(e));
  };
  const onPointerUp = async () => {
    if (!paintingRef.current || !level) return;
    paintingRef.current = false;
    const cells = [...dirtyRef.current.entries()].map(([index, tile]) => ({ index, tile }));
    dirtyRef.current = new Map();
    if (cells.length) {
      await lensRun('game-design', 'level-paint-batch', { levelId: level.id, layerId: activeLayer, cells });
    }
  };

  const toggleLayerVisible = async (layer: Layer) => {
    if (!level) return;
    setLevel({ ...level, layers: level.layers.map((l) => (l.id === layer.id ? { ...l, visible: !l.visible } : l)) });
    await lensRun('game-design', 'level-layer-update', { levelId: level.id, layerId: layer.id, visible: !layer.visible });
  };

  const addLayer = async () => {
    if (!level) return;
    const r = await lensRun('game-design', 'level-layer-add', { levelId: level.id });
    const layer = r.data?.result?.layer as Layer | undefined;
    if (layer) {
      setLevel({ ...level, layers: [...level.layers, { ...layer, tiles: new Array(level.cols * level.rows).fill(null) }] });
      setActiveLayer(layer.id);
    }
  };

  const fillLayer = async () => {
    if (!level || !activeLayer) return;
    setLevel({
      ...level,
      layers: level.layers.map((l) => (l.id === activeLayer
        ? { ...l, tiles: new Array(level.cols * level.rows).fill(activeTile) } : l)),
    });
    await lensRun('game-design', 'level-fill-layer', { levelId: level.id, layerId: activeLayer, tile: activeTile });
  };

  if (loading || !level) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExit}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <ArrowLeft className="w-3.5 h-3.5" /> Levels
        </button>
        <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">{level.name}</span>
        <span className="text-[11px] text-zinc-500">{level.cols}×{level.rows}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-3">
        {/* Grid */}
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

        {/* Layers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-300">Layers</h3>
            <button type="button" onClick={addLayer} className="text-zinc-400 hover:text-lime-300">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <ul className="space-y-1">
            {[...level.layers].reverse().map((l) => (
              <li key={l.id}
                className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-1.5',
                  activeLayer === l.id ? 'border-lime-600 bg-lime-950/30' : 'border-zinc-800 bg-zinc-900/70')}>
                <button type="button" onClick={() => toggleLayerVisible(l)} className="text-zinc-400 hover:text-zinc-200">
                  {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => setActiveLayer(l.id)}
                  className="flex-1 text-left text-xs text-zinc-200 truncate">{l.name}</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={fillLayer}
            className="flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            <PaintBucket className="w-3.5 h-3.5" /> Fill layer
          </button>
        </div>
      </div>

      {/* Tile palette */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Tiles</h3>
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
      </div>
    </div>
  );
}
