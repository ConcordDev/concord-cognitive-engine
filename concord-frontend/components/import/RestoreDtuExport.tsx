'use client';

/**
 * RestoreDtuExport — restores a DTU corpus previously produced by the
 * export lens's JSON or Markdown format (`export.json` / `export.markdown`
 * in server/server.js) back into the corpus via the matching `import.json`
 * / `import.markdown` macros (server/server.js, lines ~35637-35707).
 *
 * Distinct from UniversalImport above: UniversalImport turns an arbitrary
 * file into one generic DTU. This restores a whole previously-exported
 * batch, preserving each DTU's original id/tier/tags/lineage, and skips
 * (or optionally overwrites) any id already present — a real round-trip
 * with the export lens, not a duplicate of it.
 *
 * Found unsurfaced in the Wave 3 audit: both macros existed with zero
 * frontend call sites anywhere in the codebase.
 */

import { useCallback, useRef, useState } from 'react';
import { FileJson, FileText, Upload, RotateCcw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface JsonImportResult { ok: boolean; imported: number; skipped: number; total: number; }
// Mirrors server.js `register("import", "markdown", ...)` exactly — the
// field is `parsed` (count of DTUs parsed from the markdown), not `total`.
interface MarkdownImportResult { ok: boolean; imported: number; parsed: number; }

export function RestoreDtuExport() {
  const [format, setFormat] = useState<'json' | 'markdown'>('json');
  const [content, setContent] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(() => fileRef.current?.click(), []);
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFormat(f.name.endsWith('.md') || f.name.endsWith('.markdown') ? 'markdown' : 'json');
    f.text().then(setContent);
    e.target.value = '';
  }, []);

  const restore = useCallback(async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      if (format === 'json') {
        let parsed: { dtus?: unknown[] };
        try { parsed = JSON.parse(content); } catch { throw new Error('Not valid JSON — expected the payload from Export → JSON.'); }
        if (!Array.isArray(parsed.dtus)) throw new Error('Expected a { dtus: [...] } export payload.');
        const r = await lensRun<JsonImportResult>('import', 'json', { dtus: parsed.dtus, overwrite });
        if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'Import failed.');
        setResult({ imported: r.data.result.imported, skipped: r.data.result.skipped, total: r.data.result.total });
      } else {
        const r = await lensRun<MarkdownImportResult>('import', 'markdown', { content });
        if (!r.data.ok || !r.data.result) throw new Error(r.data.error || 'Import failed.');
        setResult({ imported: r.data.result.imported, skipped: 0, total: r.data.result.parsed });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  }, [format, content, overwrite]);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <RotateCcw className="w-4 h-4 text-neon-purple" />
        <h2 className="font-semibold text-white">Restore from export</h2>
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">import.json · import.markdown</span>
      </header>
      <p className="text-xs text-gray-400">
        Paste or upload a file produced by the Export lens (JSON or Markdown
        format) to restore that DTU batch back into your corpus. Existing
        ids are skipped unless &quot;overwrite&quot; is checked — never
        silently overwritten.
      </p>

      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-lattice-border overflow-hidden">
          <button
            onClick={() => setFormat('json')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${format === 'json' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'}`}
          >
            <FileJson className="w-3.5 h-3.5" /> JSON
          </button>
          <button
            onClick={() => setFormat('markdown')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-l border-lattice-border ${format === 'markdown' ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'}`}
          >
            <FileText className="w-3.5 h-3.5" /> Markdown
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,.md,.markdown,.txt" onChange={onFile} className="hidden" />
        <button onClick={pickFile} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-lattice-border text-xs text-gray-300 hover:border-neon-cyan/40">
          <Upload className="w-3.5 h-3.5" /> Upload file
        </button>
        {format === 'json' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-auto">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            overwrite existing ids
          </label>
        )}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={format === 'json' ? '{"dtus": [...]}  — paste the payload from Export → JSON' : '# Concord DTU Export\n## Title\n**ID:** ... | **Tier:** ... | **Tags:** ...\n\n> summary\n### Definitions\n- ...'}
        rows={8}
        className="input-lattice w-full text-xs font-mono resize-y"
      />

      <button
        onClick={restore}
        disabled={!content.trim() || busy}
        className="btn-neon purple text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        Restore
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {result && (
        <div className="flex items-center gap-3 rounded-lg border border-neon-green/20 bg-neon-green/5 px-3 py-2 text-xs text-gray-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-neon-green shrink-0" />
          <span><span className="text-neon-green font-semibold">{result.imported}</span> imported</span>
          {result.skipped > 0 && <span><span className="text-yellow-400 font-semibold">{result.skipped}</span> skipped (already present)</span>}
          <span className="text-gray-500">of {result.total} total</span>
        </div>
      )}
    </div>
  );
}
