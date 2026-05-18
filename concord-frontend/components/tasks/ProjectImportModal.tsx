'use client';

import { useState, useCallback, useRef } from 'react';
import { callTasksMacro } from '@/lib/api/tasks';
import { Upload, X, Loader2, Check } from 'lucide-react';

interface Props { open: boolean; onClose: () => void; projectId: string; onImported: () => void; }

export function ProjectImportModal({ open, onClose, projectId, onImported }: Props) {
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ provider?: string; parsedCount?: number; preview?: unknown[] } | null>(null);
  const [imported, setImported] = useState<{ createdCount?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsv(await f.text());
  }, []);

  const dryRun = useCallback(async () => {
    setBusy(true); setError(null); setPreview(null); setImported(null);
    try {
      const r = await callTasksMacro<{ ok?: boolean; reason?: string; provider?: string; parsedCount?: number; preview?: unknown[] }>('import_csv', {
        projectId, csv, dryRun: true,
      });
      if (!r.ok) setError(r.reason || 'preview_failed');
      else setPreview(r);
    } finally { setBusy(false); }
  }, [projectId, csv]);

  const realImport = useCallback(async () => {
    setBusy(true); setError(null); setImported(null);
    try {
      const r = await callTasksMacro<{ ok?: boolean; reason?: string; createdCount?: number }>('import_csv', { projectId, csv });
      if (!r.ok) setError(r.reason || 'import_failed');
      else { setImported(r); onImported(); }
    } finally { setBusy(false); }
  }, [projectId, csv, onImported]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-cyan-400" /> Import CSV (Linear / Jira / Asana / generic)
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/80 text-sm flex items-center gap-2">
            <Upload className="w-3.5 h-3.5" /> Choose .csv file
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="…or paste CSV here. Auto-detects Linear / Jira / Asana / generic formats."
            rows={12}
            className="w-full px-2 py-1.5 text-sm font-mono bg-black/40 border border-white/10 rounded text-white resize-none"
          />
          {preview && (
            <div className="border border-white/10 rounded p-2 text-sm space-y-1 bg-white/5">
              <div className="text-white">Detected provider: <span className="text-cyan-300 font-mono">{preview.provider}</span></div>
              <div className="text-white/70">Would create <span className="text-white font-mono">{preview.parsedCount}</span> tasks.</div>
              {Array.isArray(preview.preview) && (
                <div className="mt-1 max-h-32 overflow-y-auto text-xs text-white/60 space-y-0.5">
                  {(preview.preview as Array<Record<string, unknown>>).map((p, i) => (
                    <div key={i}>• {String(p.title || '')}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {imported && (
            <div className="border border-green-400/30 bg-green-500/10 rounded p-2 text-sm text-green-300 flex items-center gap-2">
              <Check className="w-4 h-4" /> Imported {imported.createdCount} tasks.
            </div>
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
          <button onClick={dryRun} disabled={busy || !csv.trim()} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/80 text-sm disabled:opacity-40 flex items-center gap-2">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Preview
          </button>
          <button onClick={realImport} disabled={busy || !csv.trim() || !!imported} className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40">Import</button>
        </div>
      </div>
    </div>
  );
}
