'use client';

/**
 * LightroomExportPanel — reusable export presets (format, quality,
 * long-edge resize, watermark).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Download, Droplet } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ExportPreset {
  id: string; name: string; format: string; quality: number;
  longEdge: number | null; watermark: boolean;
}

export function LightroomExportPanel() {
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', format: 'jpeg', quality: '90', longEdge: '', watermark: false });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('photography', 'export-preset-list', {});
    setPresets(r.data?.result?.presets || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!form.name.trim()) { setError('Preset name is required.'); return; }
    const r = await lensRun('photography', 'export-preset-save', {
      name: form.name.trim(), format: form.format,
      quality: Number(form.quality) || 90,
      longEdge: Number(form.longEdge) || 0,
      watermark: form.watermark,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', format: 'jpeg', quality: '90', longEdge: '', watermark: false });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Preset name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {['jpeg', 'png', 'tiff', 'webp', 'dng'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
        <input placeholder="Quality (1-100)" inputMode="numeric" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Long edge (px, 0 = original)" inputMode="numeric" value={form.longEdge} onChange={(e) => setForm({ ...form, longEdge: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" checked={form.watermark} onChange={(e) => setForm({ ...form, watermark: e.target.checked })}
            className="accent-indigo-500" />
          Watermark
        </label>
        <button type="button" onClick={save}
          className="col-span-2 flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Save export preset
        </button>
      </div>

      {presets.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No export presets. Save one for one-click exports.</p>
      ) : (
        <ul className="space-y-2">
          {presets.map((p) => (
            <li key={p.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-indigo-400" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{p.name}</p>
                  <p className="text-[11px] text-zinc-400">
                    {p.format.toUpperCase()} · quality {p.quality}
                    {p.longEdge ? ` · ${p.longEdge}px long edge` : ' · full size'}
                  </p>
                </div>
              </div>
              {p.watermark && <Droplet className="w-3.5 h-3.5 text-zinc-400" aria-label="Watermark" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
