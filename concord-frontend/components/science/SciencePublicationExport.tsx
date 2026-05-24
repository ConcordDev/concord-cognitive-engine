'use client';

import { useState } from 'react';
import { FileText, Plus, Trash2, Download } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { RunButton } from '@/components/science/ScienceWorkbench';

interface Figure { caption: string; chartKind: string; ref: string }
interface ExportResult {
  format: string;
  bundle: string | Record<string, unknown>;
  figureCount: number;
  wordCount: number;
  exportedAt: string;
  filename: string;
}

const inputCls = 'w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100';
const taCls = inputCls + ' resize-none';

/**
 * Publication export — bundles methods + results + figures into a
 * Markdown or JSON manuscript package, downloadable as a file.
 */
export function SciencePublicationExport() {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [keywords, setKeywords] = useState('');
  const [abstract, setAbstract] = useState('');
  const [methods, setMethods] = useState('');
  const [results, setResults] = useState('');
  const [figures, setFigures] = useState<Figure[]>([]);
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ExportResult | null>(null);

  const run = async () => {
    if (!title.trim()) { setError('Title required'); return; }
    setBusy(true); setError(null); setOutput(null);
    const r = await lensRun<ExportResult>('science', 'publication-export', {
      title: title.trim(),
      authors: authors.split(',').map((a) => a.trim()).filter(Boolean),
      keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      abstract,
      methods,
      results,
      figures: figures.filter((f) => f.caption.trim() || f.ref.trim()),
      format,
    });
    if (r.data?.ok && r.data.result) setOutput(r.data.result);
    else setError(r.data?.error || 'Export failed');
    setBusy(false);
  };

  const download = () => {
    if (!output) return;
    const content = typeof output.bundle === 'string'
      ? output.bundle
      : JSON.stringify(output.bundle, null, 2);
    const blob = new Blob([content], {
      type: output.format === 'markdown' ? 'text/markdown' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = output.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
        <FileText className="w-4 h-4 text-teal-400" /> Publication Export
      </h3>

      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Manuscript title" className={inputCls} />
      <input value={authors} onChange={(e) => setAuthors(e.target.value)}
        placeholder="Authors, comma separated" className={inputCls} />
      <input value={keywords} onChange={(e) => setKeywords(e.target.value)}
        placeholder="Keywords, comma separated" className={inputCls} />
      <textarea value={abstract} onChange={(e) => setAbstract(e.target.value)} rows={3}
        placeholder="Abstract" className={taCls} />
      <textarea value={methods} onChange={(e) => setMethods(e.target.value)} rows={4}
        placeholder="Methods" className={taCls} />
      <textarea value={results} onChange={(e) => setResults(e.target.value)} rows={4}
        placeholder="Results" className={taCls} />

      <div className="space-y-1.5">
        <p className="text-[10px] text-gray-400 uppercase">Figures</p>
        {figures.map((f, i) => (
          <div key={i} className="flex gap-1">
            <input value={f.caption}
              onChange={(e) => setFigures((fs) =>
                fs.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
              placeholder="Caption"
              className="flex-1 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
            <input value={f.chartKind}
              onChange={(e) => setFigures((fs) =>
                fs.map((x, j) => (j === i ? { ...x, chartKind: e.target.value } : x)))}
              placeholder="Chart kind"
              className="w-24 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
            <input value={f.ref}
              onChange={(e) => setFigures((fs) =>
                fs.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))}
              placeholder="Ref"
              className="w-24 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
            <button type="button" onClick={() => setFigures((fs) => fs.filter((_, j) => j !== i))}
              className="text-gray-600 hover:text-red-400" aria-label="Remove figure">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button"
          onClick={() => setFigures((fs) => [...fs, { caption: '', chartKind: '', ref: '' }])}
          className="text-[11px] text-teal-400 hover:text-teal-200">
          <Plus className="w-3 h-3 inline" /> Add figure
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="markdown">Markdown</option>
          <option value="json">JSON</option>
        </select>
        <RunButton onClick={run} busy={busy}>Build Bundle</RunButton>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {output && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>{output.wordCount} words · {output.figureCount} figures</span>
            <button type="button" onClick={download}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-teal-500/40 text-teal-200">
              <Download className="w-3 h-3" /> {output.filename}
            </button>
          </div>
          <pre className="text-[10px] text-gray-300 font-mono whitespace-pre-wrap max-h-64 overflow-auto bg-black/30 rounded p-2">
            {typeof output.bundle === 'string'
              ? output.bundle
              : JSON.stringify(output.bundle, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default SciencePublicationExport;
