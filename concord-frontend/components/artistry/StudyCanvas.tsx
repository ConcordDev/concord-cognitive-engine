'use client';

/**
 * StudyCanvas — a real drawing medium for Artistry.
 *
 * lens-reviews/artistry.md F2 ("an art lens with no art surface") scopes
 * S2 to the Kleki floor as ONE INDIVISIBLE MINIMUM: canvas + brushes +
 * layers + undo + save/reopen. This component is that minimum: a stack of
 * real <canvas> layers the user draws into with a color/size brush, with
 * per-layer undo and add/toggle-visibility layer controls.
 *
 * Save does not need a new backend surface: the composited result is
 * rasterized to a PNG and uploaded through the existing
 * artistry.project-image-upload macro — the SAME native blob-storage
 * pipeline ProjectStudio's file-picker image upload already uses — so a
 * drawn piece becomes a project image exactly like an uploaded photo, and
 * reopening the project (ProjectStudio's ResolvedImage) already knows how
 * to resolve and render the resulting `artistry-img:<id>` reference.
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Undo2, Trash2, Layers, Plus, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export const STUDY_CANVAS_W = 640;
export const STUDY_CANVAS_H = 440;
const MAX_UNDO = 30;

interface LayerState {
  id: string;
  name: string;
  visible: boolean;
}

export function StudyCanvas({ onSaved, onClose }: { onSaved: (ref: string, fileName: string) => void; onClose: () => void }) {
  const [layers, setLayers] = useState<LayerState[]>([{ id: 'layer-1', name: 'Layer 1', visible: true }]);
  const [activeLayerId, setActiveLayerId] = useState('layer-1');
  const [color, setColor] = useState('#e4e4e7');
  const [brushSize, setBrushSize] = useState(6);
  const [canUndo, setCanUndo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const undoStacks = useRef<Map<string, ImageData[]>>(new Map());
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const bindCanvasRef = useCallback((id: string) => (el: HTMLCanvasElement | null) => {
    if (el) canvasRefs.current.set(id, el);
    else canvasRefs.current.delete(id);
  }, []);

  const pushUndo = useCallback((layerId: string) => {
    const el = canvasRefs.current.get(layerId);
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const stack = undoStacks.current.get(layerId) || [];
    stack.push(ctx.getImageData(0, 0, STUDY_CANVAS_W, STUDY_CANVAS_H));
    if (stack.length > MAX_UNDO) stack.shift();
    undoStacks.current.set(layerId, stack);
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStacks.current.get(activeLayerId);
    if (!stack || stack.length === 0) return;
    const snapshot = stack.pop();
    const el = canvasRefs.current.get(activeLayerId);
    const ctx = el?.getContext('2d');
    if (ctx && snapshot) ctx.putImageData(snapshot, 0, 0);
    setCanUndo((stack?.length ?? 0) > 0);
  }, [activeLayerId]);

  const pointFromEvent = useCallback((el: HTMLCanvasElement, e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const el = canvasRefs.current.get(activeLayerId);
    if (!el) return;
    pushUndo(activeLayerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(el, e);
    el.setPointerCapture?.(e.pointerId);
  }, [activeLayerId, pointFromEvent, pushUndo]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const el = canvasRefs.current.get(activeLayerId);
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !lastPointRef.current) return;
    const point = pointFromEvent(el, e);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }, [activeLayerId, brushSize, color, pointFromEvent]);

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  const addLayer = useCallback(() => {
    setLayers((prev) => {
      const id = `layer-${prev.length + 1}-${Date.now()}`;
      const next = [...prev, { id, name: `Layer ${prev.length + 1}`, visible: true }];
      setActiveLayerId(id);
      return next;
    });
    setCanUndo(false);
  }, []);

  const toggleLayerVisible = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, []);

  const selectLayer = useCallback((id: string) => {
    setActiveLayerId(id);
    setCanUndo((undoStacks.current.get(id)?.length ?? 0) > 0);
  }, []);

  const clearActiveLayer = useCallback(() => {
    const el = canvasRefs.current.get(activeLayerId);
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    pushUndo(activeLayerId);
    ctx.clearRect(0, 0, STUDY_CANVAS_W, STUDY_CANVAS_H);
  }, [activeLayerId, pushUndo]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const composite = document.createElement('canvas');
      composite.width = STUDY_CANVAS_W;
      composite.height = STUDY_CANVAS_H;
      const ctx = composite.getContext('2d');
      if (!ctx) throw new Error('Could not compose the drawing.');
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, STUDY_CANVAS_W, STUDY_CANVAS_H);
      for (const layer of layers) {
        if (!layer.visible) continue;
        const el = canvasRefs.current.get(layer.id);
        if (el) ctx.drawImage(el, 0, 0);
      }
      const dataUrl = composite.toDataURL('image/png');
      const fileName = `study-drawing-${Date.now()}.png`;
      const r = await lensRun<{ image?: { ref?: string } }>('artistry', 'project-image-upload', {
        fileName, mimeType: 'image/png', data: dataUrl,
      });
      const ref = r.data?.result?.image?.ref;
      if (!r.data?.ok || !ref) throw new Error(r.data?.error || 'Could not save the drawing.');
      onSaved(ref, fileName);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the drawing.');
    } finally {
      setSaving(false);
    }
  }, [layers, onSaved]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={onClose}>
      <div
        data-testid="study-canvas"
        role="dialog"
        aria-modal="true"
        aria-label="Draw a new study"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        className="w-full max-w-2xl rounded-lg border border-white/10 bg-gray-900 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4 text-neon-pink" /> Draw</h3>
          <button type="button" onClick={onClose} aria-label="Close drawing tool"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            Color
            <input
              data-testid="study-canvas-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Brush
            <input
              data-testid="study-canvas-size"
              type="range"
              min={1}
              max={40}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={undo} disabled={!canUndo} data-testid="study-canvas-undo" className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/10 disabled:opacity-40">
            <Undo2 className="h-3 w-3" /> Undo
          </button>
          <button type="button" onClick={clearActiveLayer} className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/10">
            <Trash2 className="h-3 w-3" /> Clear layer
          </button>
        </div>

        <div className="relative mb-3 overflow-hidden rounded border border-white/10" style={{ width: STUDY_CANVAS_W, height: STUDY_CANVAS_H, maxWidth: '100%' }}>
          {layers.map((layer) => (
            <canvas
              key={layer.id}
              ref={bindCanvasRef(layer.id)}
              data-testid={`study-canvas-layer-${layer.id}`}
              width={STUDY_CANVAS_W}
              height={STUDY_CANVAS_H}
              className="absolute left-0 top-0"
              style={{
                display: layer.visible ? 'block' : 'none',
                pointerEvents: layer.id === activeLayerId ? 'auto' : 'none',
                touchAction: 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerLeave={endStroke}
            />
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-400">Layers:</span>
          {layers.map((layer) => (
            <div key={layer.id} className={`flex items-center gap-1 rounded border px-2 py-1 ${layer.id === activeLayerId ? 'border-neon-pink/50 bg-neon-pink/10' : 'border-white/10'}`}>
              <button type="button" onClick={() => selectLayer(layer.id)} data-testid={`study-canvas-select-${layer.id}`} className="font-medium">{layer.name}</button>
              <button type="button" onClick={() => toggleLayerVisible(layer.id)} aria-label={`Toggle ${layer.name} visibility`} data-testid={`study-canvas-toggle-${layer.id}`}>
                {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-gray-500" />}
              </button>
            </div>
          ))}
          <button type="button" onClick={addLayer} data-testid="study-canvas-add-layer" className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/10">
            <Plus className="h-3 w-3" /> Layer
          </button>
        </div>

        {saveError && <p role="alert" className="mb-2 text-xs text-rose-400">{saveError}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => { void save(); }} disabled={saving} data-testid="study-canvas-save" className="flex items-center gap-1 rounded border border-neon-pink/30 bg-neon-pink/20 px-3 py-1.5 text-xs hover:bg-neon-pink/30 disabled:opacity-50">
            {saving ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</> : 'Add to project'}
          </button>
        </div>
      </div>
    </div>
  );
}
