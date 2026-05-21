'use client';

/**
 * LightroomDevelopPanel — pick a photo, move develop sliders and
 * save / apply develop presets.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, SlidersHorizontal, RotateCcw, Save, Wand2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Photo { id: string; title: string; develop: Record<string, number>; appliedPreset?: string | null }
interface Preset { id: string; name: string; category: string; adjustments: Record<string, number> }

const ADJ: { key: string; label: string; min: number; max: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100 },
  { key: 'temperature', label: 'Temp (K)', min: 2000, max: 50000 },
  { key: 'tint', label: 'Tint', min: -150, max: 150 },
];

export function LightroomDevelopPanel({ onChange }: { onChange: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [p, pr] = await Promise.all([
      lensRun('photography', 'photo-list', {}),
      lensRun('photography', 'preset-list', {}),
    ]);
    const list: Photo[] = p.data?.result?.photos || [];
    setPhotos(list);
    setPresets(pr.data?.result?.presets || []);
    setSelected((cur) => (cur && list.some((x) => x.id === cur)) ? cur : (list[0]?.id || ''));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const photo = photos.find((p) => p.id === selected);
    setAdjustments(photo ? { ...photo.develop } : {});
    setDirty(false);
  }, [selected, photos]);

  const photo = photos.find((p) => p.id === selected);

  const setAdj = (key: string, value: number) => {
    setAdjustments((a) => ({ ...a, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    if (!photo) return;
    const r = await lensRun('photography', 'develop-set', { id: photo.id, adjustments });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null); setDirty(false);
    await refresh(); onChange();
  };
  const reset = async () => {
    if (!photo) return;
    await lensRun('photography', 'develop-reset', { id: photo.id });
    await refresh(); onChange();
  };
  const applyPreset = async (presetId: string) => {
    if (!photo) return;
    await lensRun('photography', 'preset-apply', { photoId: photo.id, presetId });
    await refresh(); onChange();
  };
  const savePreset = async () => {
    const name = window.prompt('Preset name');
    if (!name) return;
    const r = await lensRun('photography', 'preset-create', { name, adjustments });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (photos.length === 0) {
    return <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">Import photos in the Library tab first.</div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <select value={selected} onChange={(e) => setSelected(e.target.value)}
        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
        {photos.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>

      {photo && (
        <>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" /> Develop
              {photo.appliedPreset && <span className="text-[10px] text-zinc-500">· preset: {photo.appliedPreset}</span>}
            </div>
            {ADJ.map((a) => {
              const val = adjustments[a.key] ?? (a.key === 'temperature' ? 5500 : 0);
              return (
                <div key={a.key} className="flex items-center gap-2">
                  <span className="w-20 text-[11px] text-zinc-400 shrink-0">{a.label}</span>
                  <input type="range" min={a.min} max={a.max} value={val}
                    onChange={(e) => setAdj(a.key, Number(e.target.value))}
                    className="flex-1 accent-indigo-500" />
                  <span className="w-12 text-right text-[11px] text-zinc-300 font-mono">{val}</span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={!dirty}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
              <Save className="w-3.5 h-3.5" /> Save edits
            </button>
            <button type="button" onClick={savePreset}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Wand2 className="w-3.5 h-3.5" /> Save as preset
            </button>
            <button type="button" onClick={reset}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>

          {presets.length > 0 && (
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">Apply a preset</p>
              <div className="flex flex-wrap gap-1">
                {presets.map((pr) => (
                  <button key={pr.id} type="button" onClick={() => applyPreset(pr.id)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 hover:border-indigo-700/50 hover:text-indigo-300">
                    {pr.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
