'use client';

/**
 * DeepZoomViewer — gigapixel "Art Camera" style high-resolution viewer.
 * Backs gallery `deep-zoom` macro: resolves CMA print/full-res image
 * sources for a given artwork id and drives a pan + zoom canvas.
 */

import { useState, useRef, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ZoomIn, ZoomOut, Maximize2, Move, Loader2, AlertTriangle } from 'lucide-react';

interface ZoomLevel { label: string; url: string; note: string }
interface DeepZoomResult {
  id: number;
  title: string;
  artist: string;
  deepZoomImage: string;
  previewImage: string;
  levels: ZoomLevel[];
  dimensions?: string;
}

export function DeepZoomViewer() {
  const [id, setId] = useState('');
  const [data, setData] = useState<DeepZoomResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeLevel, setActiveLevel] = useState(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    const n = Number(id.trim());
    if (!Number.isFinite(n) || n <= 0) { setError('Enter a valid CMA artwork id.'); return; }
    setLoading(true); setError(null); setData(null);
    const r = await lensRun<DeepZoomResult>('gallery', 'deep-zoom', { id: n });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
      setActiveLevel(Math.max(0, r.data.result.levels.length - 1));
      setZoom(1); setPan({ x: 0, y: 0 });
    } else {
      setError(r.data?.error || 'Could not load deep-zoom image.');
    }
    setLoading(false);
  }, [id]);

  const onMouseDown = (e: React.MouseEvent) => { dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = () => { dragRef.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.min(8, Math.max(1, z + (e.deltaY < 0 ? 0.3 : -0.3))));
  };

  const activeUrl = data?.levels[activeLevel]?.url || data?.deepZoomImage;

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Maximize2 className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Deep-zoom viewer</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Gigapixel</span>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="text" value={id} inputMode="numeric"
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono"
          placeholder="CMA artwork id (e.g. 94979)"
        />
        <button
          type="button" onClick={load} disabled={loading}
          className="rounded bg-cyan-600/80 hover:bg-cyan-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Load'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="py-8 text-center text-[12px] text-zinc-500 italic">
          No artwork loaded yet. Enter a Cleveland Museum artwork id to inspect it at full resolution.
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">{data.title}</h4>
              <p className="text-[11px] text-zinc-400">{data.artist}{data.dimensions ? ` · ${data.dimensions}` : ''}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="rounded bg-zinc-800 p-1.5 hover:bg-zinc-700" aria-label="Zoom out">
                <ZoomOut className="w-3.5 h-3.5 text-zinc-300" />
              </button>
              <span className="text-[11px] font-mono text-zinc-400 w-12 text-center">{zoom.toFixed(1)}×</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(8, z + 0.5))} className="rounded bg-zinc-800 p-1.5 hover:bg-zinc-700" aria-label="Zoom in">
                <ZoomIn className="w-3.5 h-3.5 text-zinc-300" />
              </button>
              <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="rounded bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-300 hover:bg-zinc-700">Reset</button>
            </div>
          </div>

          {data.levels.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              {data.levels.map((lvl, i) => (
                <button
                  key={lvl.label} type="button"
                  onClick={() => setActiveLevel(i)}
                  className={`rounded px-2 py-0.5 text-[10px] border ${i === activeLevel ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          )}

          <div
            className="relative h-[420px] overflow-hidden rounded border border-cyan-500/20 bg-zinc-950 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            onWheel={onWheel}
          >
            {activeUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host */}
                <img
                  src={activeUrl} alt={data.title} draggable={false}
                  className="absolute left-1/2 top-1/2 max-w-none transition-transform"
                  style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
                />
                <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[10px] text-zinc-300">
                  <Move className="w-3 h-3" /> drag to pan · scroll to zoom
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-zinc-500 italic">No zoomable image.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
