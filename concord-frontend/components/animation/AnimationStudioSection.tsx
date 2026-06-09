'use client';

/**
 * AnimationStudioSection — FlipaClip + Pencil2D shape frame-by-frame
 * animator. Gallery of animations; the studio hydrates via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Plus, Loader2, Trash2, Film, LayoutTemplate } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { AnimStudio } from './AnimStudio';

interface AnimMeta {
  id: string; title: string; width: number; height: number; fps: number;
  background: string; thumbnail: string | null; frameCount: number; durationFrames: number;
}

interface AnimTemplate {
  id: string; label: string; description: string;
  width: number; height: number; fps: number; frames: number; layers: string[];
}

interface CanvasPreset { id: string; label: string; width: number; height: number; fps: number }

export function AnimationStudioSection() {
  const [animations, setAnimations] = useState<AnimMeta[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<CanvasPreset[]>([]);
  const [templates, setTemplates] = useState<AnimTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [form, setForm] = useState({ title: '', preset: 0, fps: 12 });

  const refresh = useCallback(async () => {
    const r = await lensRun('animation', 'anim-list', {});
    setAnimations(r.data?.result?.animations || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    void lensRun('animation', 'canvas-presets', {}).then((r) => {
      if (r.data?.ok) setPresets((r.data.result as { presets: CanvasPreset[] }).presets || []);
    });
    void lensRun('animation', 'template-list', {}).then((r) => {
      if (r.data?.ok) setTemplates((r.data.result as { templates: AnimTemplate[] }).templates || []);
    });
  }, []);

  const create = async () => {
    const preset = presets[form.preset];
    if (!preset) { setError('Presets still loading.'); return; }
    const r = await lensRun('animation', 'anim-create', {
      title: form.title.trim() || 'Untitled animation',
      width: preset.width, height: preset.height, fps: form.fps,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', preset: 0, fps: 12 });
    setError(null);
    await refresh();
    if (r.data?.result?.animation?.id) setOpen(r.data.result.animation.id);
  };

  const createFromTemplate = async (templateId: string) => {
    const r = await lensRun('animation', 'anim-from-template', { templateId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    setShowTemplates(false);
    await refresh();
    if (r.data?.result?.animation?.id) setOpen(r.data.result.animation.id);
  };

  const del = async (id: string) => {
    await lensRun('animation', 'anim-delete', { id });
    if (open === id) setOpen(null);
    await refresh();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-cyan-600/15 to-transparent">
        <Clapperboard className="w-5 h-5 text-cyan-400" />
        <h2 className="text-sm font-bold text-zinc-100">Animation Studio</h2>
        <span className="text-[11px] text-zinc-400">FlipaClip + Pencil2D shape · frame-by-frame, onion skin</span>
      </header>

      <div className="p-4">
        {open ? (
          <AnimStudio animId={open} onExit={() => { setOpen(null); void refresh(); }} />
        ) : (
          <div className="space-y-4">
            {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

            {/* New animation */}
            <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                <select value={form.preset} onChange={(e) => setForm({ ...form, preset: Number(e.target.value) })}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                  {presets.length === 0
                    ? <option value={0}>Loading presets…</option>
                    : presets.map((p, i) => (
                      <option key={p.id} value={i}>{p.label} ({p.width}×{p.height})</option>
                    ))}
                </select>
                <label className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-xs text-zinc-400">
                  fps
                  <input type="number" min={1} max={60} value={form.fps}
                    onChange={(e) => setForm({ ...form, fps: Math.max(1, Number(e.target.value) || 12) })}
                    className="w-full bg-transparent py-1.5 text-xs text-zinc-100" />
                </label>
                <button type="button" onClick={create}
                  className="flex items-center justify-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Create
                </button>
              </div>
              <button type="button" onClick={() => setShowTemplates((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300">
                <LayoutTemplate className="w-3.5 h-3.5" />
                {showTemplates ? 'Hide templates' : 'Start from a template'}
              </button>
              {showTemplates && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  {templates.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic col-span-3">Loading templates…</p>
                  ) : templates.map((t) => (
                    <button key={t.id} type="button" onClick={() => createFromTemplate(t.id)}
                      className="text-left bg-zinc-950/60 border border-zinc-800 hover:border-cyan-600 rounded-lg p-2.5">
                      <p className="text-xs font-medium text-zinc-100">{t.label}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">{t.description}</p>
                      <p className="text-[10px] text-cyan-400 mt-1">
                        {t.width}×{t.height} · {t.fps}fps · {t.frames} frame{t.frames === 1 ? '' : 's'} · {t.layers.length} layer{t.layers.length === 1 ? '' : 's'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Gallery */}
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : animations.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic py-6 text-center">No animations yet. Create one above and start drawing frames.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {animations.map((a) => (
                  <div key={a.id} className="group bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                    <button type="button" onClick={() => setOpen(a.id)}
                      className="block w-full aspect-video bg-zinc-800 overflow-hidden">
                      {a.thumbnail ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={a.thumbnail} alt={a.title} className="w-full h-full object-contain" />
                      ) : (
                        <span className="flex items-center justify-center h-full text-zinc-600"><Film className="w-6 h-6" /></span>
                      )}
                    </button>
                    <div className="flex items-center justify-between px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-100 truncate">{a.title}</p>
                        <p className="text-[10px] text-zinc-400">{a.frameCount} frames · {a.fps} fps</p>
                      </div>
                      <button aria-label="Delete" type="button" onClick={() => del(a.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
