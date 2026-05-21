'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ReportExport — exports the full pain-point analysis (prioritized pains,
 * themes, interventions, snapshots) as a Markdown or JSON report and
 * downloads it. Wires the export-report macro.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { FileDown, Loader2, FileJson, FileText } from 'lucide-react';

export function ReportExport() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const doExport = useCallback(async (format: 'markdown' | 'json') => {
    setBusy(true);
    setErr(null);
    setPreview(null);
    const res = await lensRun<any>('suffering', 'export-report', { format });
    setBusy(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Export failed'); return; }
    const r = res.data.result;
    let content: string;
    let mime: string;
    let ext: string;
    if (format === 'markdown') {
      content = r.markdown;
      mime = 'text/markdown';
      ext = 'md';
      setPreview(content);
    } else {
      content = JSON.stringify(r.report, null, 2);
      mime = 'application/json';
      ext = 'json';
      setPreview(content.slice(0, 4000));
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pain-point-analysis-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <FileDown className="w-4 h-4 text-neon-cyan" /> Export Analysis Report
          {busy && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => doExport('markdown')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" /> Markdown
          </button>
          <button
            onClick={() => doExport('json')}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-purple/20 text-neon-purple rounded-lg text-sm hover:bg-neon-purple/30 disabled:opacity-50"
          >
            <FileJson className="w-4 h-4" /> JSON
          </button>
        </div>
      </div>
      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      {preview ? (
        <pre className="text-[11px] text-gray-400 bg-black/40 border border-white/10 rounded-lg p-3 max-h-72 overflow-auto whitespace-pre-wrap">
          {preview}
        </pre>
      ) : (
        <p className="text-xs text-gray-500">
          Generate a downloadable report of every pain point, theme, intervention, and trend snapshot.
        </p>
      )}
    </div>
  );
}
