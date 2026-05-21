'use client';

/**
 * CwCompilePanel — format-aware manuscript compile. Picks an export
 * format (Markdown / HTML / EPUB-XHTML / plain text / Fountain) and a
 * formatting preset, then builds a real downloadable document body via
 * the `compile-export` macro and offers it as a Blob download.
 */

import { useCallback, useState } from 'react';
import { Loader2, FileDown, FileText, Settings2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Compiled {
  format: string; preset: string; mime: string; fileName: string; extension: string;
  body: string; wordCount: number;
  chapters: { heading: string; scenes: number }[];
  sceneCount: number;
}

const FORMATS: { id: string; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'epub', label: 'EPUB (XHTML)' },
  { id: 'text', label: 'Plain text' },
  { id: 'fountain', label: 'Fountain' },
];
const PRESETS: { id: string; label: string; hint: string }[] = [
  { id: 'manuscript', label: 'Manuscript', hint: 'numbered chapters, * * * scene breaks' },
  { id: 'ebook', label: 'E-book', hint: 'titled chapters, ornament breaks' },
  { id: 'proof', label: 'Proof', hint: 'numbered, monospace, [scene break] markers' },
];

export function CwCompilePanel({ projectId }: { projectId: string }) {
  const [format, setFormat] = useState('markdown');
  const [preset, setPreset] = useState('manuscript');
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [includeSynopsis, setIncludeSynopsis] = useState(false);
  const [result, setResult] = useState<Compiled | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compile = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun('creative-writing', 'compile-export', {
      projectId, format, preset, includeDrafts, includeSynopsis,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Compile failed'); setResult(null); }
    else setResult((r.data?.result as Compiled) || null);
    setBusy(false);
  }, [projectId, format, preset, includeDrafts, includeSynopsis]);

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.body], { type: `${result.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Settings2 className="w-3.5 h-3.5 text-amber-400" /> Compile settings
        </h3>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase mb-1">Format</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFormat(f.id)}
                className={cn('text-[11px] px-2.5 py-1 rounded-lg',
                  format === f.id ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase mb-1">Preset</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPreset(p.id)} title={p.hint}
                className={cn('text-[11px] px-2.5 py-1 rounded-lg',
                  preset === p.id ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">{PRESETS.find((p) => p.id === preset)?.hint}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} />
            Include draft / outline scenes
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={includeSynopsis} onChange={(e) => setIncludeSynopsis(e.target.checked)} />
            Include scene synopses
          </label>
        </div>
        <button type="button" onClick={compile} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Compile manuscript
        </button>
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </section>

      {result && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-zinc-200">{result.fileName}</p>
              <p className="text-[10px] text-zinc-500">
                {result.wordCount.toLocaleString()} words · {result.sceneCount} scenes · {result.chapters.length} chapters · {result.format}
              </p>
            </div>
            <button type="button" onClick={download}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
              <FileDown className="w-3.5 h-3.5" /> Download
            </button>
          </div>
          {result.chapters.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {result.chapters.map((c, i) => (
                <li key={i} className="text-[10px] text-zinc-400 bg-zinc-950/60 rounded px-2 py-0.5">
                  {c.heading} <span className="text-zinc-600">· {c.scenes}</span>
                </li>
              ))}
            </ul>
          )}
          <textarea readOnly value={result.body} rows={12}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 font-mono resize-y" />
        </section>
      )}
    </div>
  );
}
