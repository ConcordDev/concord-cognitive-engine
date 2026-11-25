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

export function AnimationStudioSection({ onOpenScreening }: { onOpenScreening?: (releaseId: string) => void } = {}) {
  const [animations, setAnimations] = useState<AnimMeta[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<CanvasPreset[]>([]);
  const [templates, setTemplates] = useState<AnimTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [form, setForm] = useState({ title: '', preset: 0, fps: 12 });
  // F5 (unconfirmed-destructive): the gallery card's Delete used to
  // fire anim-delete on a single click. The family's two-step
  // applies (cf. Gallery F6 / game-design F5): the first click arms
  // an in-place confirm; the delete call fires only from the confirm.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('animation', 'anim-list', {});
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Could not load animations.');
      setLoading(false);
      return;
    }
    setError(null);
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
    // FIX-animation-002: a blank title silently became 'Untitled
    // animation'. The title is required, and the form says so.
    if (!form.title.trim()) { setError('Give the animation a title.'); return; }
    const r = await lensRun('animation', 'anim-create', {
      title: form.title.trim(),
      width: preset.width, height: preset.height, fps: form.fps,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', preset: 0, fps: 12 });
    setError(null);
    await refresh();
    const newAnimId = r.data?.result?.animation?.id;
    if (newAnimId) setOpen(newAnimId);
  };

  const createFromTemplate = async (templateId: string) => {
    const r = await lensRun('animation', 'anim-from-template', { templateId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    setShowTemplates(false);
    await refresh();
    const newAnimId = r.data?.result?.animation?.id;
    if (newAnimId) setOpen(newAnimId);
  };

  const del = async (id: string) => {
    await lensRun('animation', 'anim-delete', { id });
    setConfirmDeleteId(null);
    if (open === id) setOpen(null);
    await refresh();
  };

  if (open) {
    return <AnimStudio animId={open} onExit={() => { setOpen(null); void refresh(); }} onOpenScreening={onOpenScreening} />;
  }
  return (
    <div className="lt-sheet overflow-hidden" data-testid="lt-shots">
      <header className="flex items-baseline gap-3 border-b border-[var(--lt-line-2)] px-4 py-3">
        <Clapperboard className="h-5 w-5 self-center text-[var(--lt-red)]" />
        <h2 className="lt-title text-[18px] text-[var(--lt-graphite)]">Your shots</h2>
        <span className="text-[12px] text-[var(--lt-muted)]">Frame by frame, on the light table</span>
      </header>

      <div className="p-4">
        {(
          <div className="space-y-4">
            {error && <div className="text-xs text-[var(--lt-bad,#fb7185)] bg-[#fff2ef] border border-[#f2c3bc] rounded-lg px-3 py-2">{error}</div>}

            {/* New animation */}
            <section className="bg-[var(--lt-paper-2,rgba(24,24,27,0.7))] border border-[var(--lt-line-2,#27272a)] rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input id="anim-new-title" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]" />
                <select aria-label="Canvas preset" onChange={(e) => setForm({ ...form, preset: Number(e.target.value) })}
                  className="min-h-11 bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]">
                  {presets.length === 0
                    ? <option value={0}>Loading presets…</option>
                    : presets.map((p, i) => (
                      <option key={p.id} value={i}>{p.label} ({p.width}×{p.height})</option>
                    ))}
                </select>
                <label className="flex items-center gap-1.5 bg-[var(--lt-input,#09090b)] border border-[var(--lt-line,#3f3f46)] rounded-lg px-2 text-xs text-[var(--lt-muted,#a1a1aa)]">
                  fps
                  <input type="number" min={1} max={60} value={form.fps}
                    onChange={(e) => setForm({ ...form, fps: Math.max(1, Number(e.target.value) || 12) })}
                    className="w-full bg-transparent py-1.5 text-xs text-[var(--lt-graphite,#f4f4f5)]" />
                </label>
                <button type="button" onClick={create}
                  className="flex items-center justify-center gap-1 bg-[var(--lt-red,#0e7490)] hover:bg-[#b42c20] text-white text-xs font-medium rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Create
                </button>
              </div>
              <button type="button" onClick={() => setShowTemplates((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-[var(--lt-blue,#22d3ee)] hover:text-[var(--lt-blue,#22d3ee)]">
                <LayoutTemplate className="w-3.5 h-3.5" />
                {showTemplates ? 'Hide templates' : 'Start from a template'}
              </button>
              {showTemplates && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  {templates.length === 0 ? (
                    <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)] italic col-span-3">Loading templates…</p>
                  ) : templates.map((t) => (
                    <button key={t.id} type="button" onClick={() => createFromTemplate(t.id)}
                      className="text-left bg-[var(--lt-paper-2,rgba(9,9,11,0.5))] border border-[var(--lt-line-2,#27272a)] hover:border-[var(--lt-blue,#0891b2)] rounded-lg p-2.5">
                      <p className="text-xs font-medium text-[var(--lt-graphite,#f4f4f5)]">{t.label}</p>
                      <p className="text-[10px] text-[var(--lt-muted,#a1a1aa)] mt-0.5">{t.description}</p>
                      <p className="text-[10px] text-[var(--lt-blue,#22d3ee)] mt-1">
                        {t.width}×{t.height} · {t.fps}fps · {t.frames} frame{t.frames === 1 ? '' : 's'} · {t.layers.length} layer{t.layers.length === 1 ? '' : 's'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Gallery */}
            {loading ? (
              <div className="flex items-center justify-center py-8 text-[var(--lt-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : animations.length === 0 ? (
              <p className="text-[11px] text-[var(--lt-muted,#a1a1aa)] italic py-6 text-center">No animations yet. Create one above and start drawing frames.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {animations.map((a) => (
                  <div key={a.id} className="group bg-[var(--lt-paper-2,rgba(24,24,27,0.7))] border border-[var(--lt-line-2,#27272a)] rounded-xl overflow-hidden">
                    <button type="button" aria-label={`Open ${a.title}`} onClick={() => { setOpen(a.id); setConfirmDeleteId(null); }}
                      className="block w-full aspect-video bg-[var(--lt-chip,#27272a)] overflow-hidden">
                      {a.thumbnail ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={a.thumbnail} alt={a.title} className="w-full h-full object-contain" />
                      ) : (
                        <span className="flex items-center justify-center h-full text-[var(--lt-faint,#52525b)]"><Film className="w-6 h-6" /></span>
                      )}
                    </button>
                    <div className="flex items-center justify-between px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs text-[var(--lt-graphite,#f4f4f5)] truncate">{a.title}</p>
                        <p className="text-[10px] text-[var(--lt-muted,#a1a1aa)]">{a.frameCount} frames · {a.fps} fps</p>
                      </div>
                      {confirmDeleteId === a.id ? (
                        <button type="button" onClick={() => del(a.id)} className="text-[11px] font-semibold text-[var(--lt-bad,#fb7185)] shrink-0">Delete?</button>
                      ) : (
                        <button aria-label={`Delete ${a.title}`} type="button" onClick={() => setConfirmDeleteId(a.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--lt-muted,#a1a1aa)] hover:text-[var(--lt-bad,#fb7185)] shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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
